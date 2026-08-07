from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import keyring
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .automation import confirm_action, request_action
from .database import connect, utcnow
from .memory import list_memories
from .models import ReminderCreate, ReminderPatch
from .reminders import create_reminder, delete_reminder, list_reminders, update_reminder

_SERVICE = "SHREE Mobile Companion"
_PAIRING_TTL = timedelta(minutes=5)
_MESSAGE_TTL_SECONDS = 60
_seen_nonces: dict[str, float] = {}
_pairing_attempts: dict[str, list[float]] = {}


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _key_name(kind: str, identifier: str) -> str:
    return f"{kind}:{identifier}"


def _store_key(kind: str, identifier: str, key: bytes) -> None:
    keyring.set_password(_SERVICE, _key_name(kind, identifier), _b64encode(key))


def _load_key(kind: str, identifier: str) -> bytes | None:
    encoded = keyring.get_password(_SERVICE, _key_name(kind, identifier))
    return _b64decode(encoded) if encoded else None


def _delete_key(kind: str, identifier: str) -> None:
    try:
        keyring.delete_password(_SERVICE, _key_name(kind, identifier))
    except keyring.errors.PasswordDeleteError:
        pass


def _proof(key: bytes, *pieces: str) -> str:
    message = "|".join(pieces).encode("utf-8")
    return _b64encode(hmac.new(key, message, hashlib.sha256).digest())


def _local_addresses() -> list[str]:
    addresses: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = result[4][0]
            if not address.startswith("127.") and not address.startswith("169.254."):
                addresses.add(address)
    except OSError:
        pass
    return sorted(addresses)


class PairingRequest(BaseModel):
    pairing_id: str = Field(min_length=20, max_length=80)
    device_name: str = Field(min_length=1, max_length=80)
    proof: str = Field(min_length=20, max_length=200)


class PairingPoll(BaseModel):
    pairing_id: str = Field(min_length=20, max_length=80)
    proof: str = Field(min_length=20, max_length=200)


class PairingDecision(BaseModel):
    approved: bool


class EncryptedEnvelope(BaseModel):
    device_id: str = Field(min_length=20, max_length=80)
    timestamp: int
    nonce: str = Field(min_length=16, max_length=32)
    ciphertext: str = Field(min_length=16, max_length=2_000_000)


class PhoneCommand(BaseModel):
    action: str = Field(min_length=1, max_length=80)
    arguments: dict[str, Any] = Field(default_factory=dict, max_length=50)


def check_pairing_rate_limit(client_id: str) -> None:
    """Permit at most 12 pairing requests per minute from one LAN client."""
    now = datetime.now(UTC).timestamp()
    recent = [stamp for stamp in _pairing_attempts.get(client_id, []) if now - stamp < 60]
    if len(recent) >= 12:
        raise HTTPException(429, "Too many pairing attempts. Wait one minute and try again.")
    recent.append(now)
    _pairing_attempts[client_id] = recent


def encrypt_payload(device_id: str, key: bytes, payload: dict[str, Any]) -> dict[str, Any]:
    timestamp = int(datetime.now(UTC).timestamp())
    nonce = secrets.token_bytes(12)
    nonce_text = _b64encode(nonce)
    aad = f"{device_id}|{timestamp}|{nonce_text}".encode("utf-8")
    clear = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, clear, aad)
    return {
        "device_id": device_id,
        "timestamp": timestamp,
        "nonce": nonce_text,
        "ciphertext": _b64encode(ciphertext),
    }


def decrypt_payload(envelope: EncryptedEnvelope, key: bytes, *, check_replay: bool = True) -> dict[str, Any]:
    now = int(datetime.now(UTC).timestamp())
    if abs(now - envelope.timestamp) > _MESSAGE_TTL_SECONDS:
        raise ValueError("Encrypted mobile message expired")
    replay_key = f"{envelope.device_id}:{envelope.nonce}"
    if check_replay and replay_key in _seen_nonces:
        raise ValueError("Encrypted mobile message was already used")
    nonce = _b64decode(envelope.nonce)
    if len(nonce) != 12:
        raise ValueError("Invalid mobile message nonce")
    aad = f"{envelope.device_id}|{envelope.timestamp}|{envelope.nonce}".encode("utf-8")
    clear = AESGCM(key).decrypt(nonce, _b64decode(envelope.ciphertext), aad)
    payload = json.loads(clear.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Mobile message must contain an object")
    if check_replay:
        _seen_nonces[replay_key] = float(now)
        expired = [item for item, seen_at in _seen_nonces.items() if now - seen_at > _MESSAGE_TTL_SECONDS]
        for item in expired:
            _seen_nonces.pop(item, None)
    return payload


async def start_pairing(port: int | None = None) -> dict[str, Any]:
    pairing_id = secrets.token_urlsafe(24)
    device_id = str(uuid4())
    key = secrets.token_bytes(32)
    expires_at = datetime.now(UTC) + _PAIRING_TTL
    _store_key("pairing", pairing_id, key)
    async with connect() as db:
        previous = await (await db.execute("SELECT id FROM mobile_pairings")).fetchall()
        await db.execute("DELETE FROM mobile_pairings")
        await db.execute(
            "INSERT INTO mobile_pairings(id,device_id,status,expires_at,created_at) VALUES(?,?,?,?,?)",
            (pairing_id, device_id, "created", expires_at.isoformat(), utcnow()),
        )
        await db.commit()
    for row in previous:
        _delete_key("pairing", row["id"])
        _delete_key("approved_pairing", row["id"])
    actual_port = port or int(os.environ.get("SHREE_BACKEND_PORT", "8765"))
    relay = None
    from .settings_store import get_application_settings
    runtime = await get_application_settings()
    if runtime.mobile_remote_access_enabled:
        if not runtime.mobile_relay_url.strip():
            raise HTTPException(409, "Remote phone access is enabled, but no SHREE relay URL is configured")
        from .mobile_relay import relay_manager
        relay = await relay_manager.begin_pairing(pairing_id, key, runtime.mobile_relay_url)
    payload = {
        "protocol": 1,
        "app": "Shree Companion",
        "pairing_id": pairing_id,
        "device_id": device_id,
        "key": _b64encode(key),
        "hosts": [f"http://{address}:{actual_port}" for address in _local_addresses()],
        "relay": relay,
        "expires_at": expires_at.isoformat(),
    }
    compact_relay = None if relay is None else {"u": relay["url"], "i": relay["room_id"], "t": relay["token"]}
    compact = {
        "p": 2, "i": pairing_id, "d": device_id, "k": _b64encode(key),
        "h": payload["hosts"], "r": compact_relay, "e": expires_at.isoformat(),
    }
    encoded = _b64encode(json.dumps(compact, separators=(",", ":")).encode("utf-8"))
    return {**payload, "key": None, "qr_payload": f"shree://pair?data={encoded}"}


async def request_pairing(item: PairingRequest) -> dict[str, Any]:
    key = _load_key("pairing", item.pairing_id)
    if key is None:
        raise HTTPException(404, "Pairing request is unavailable or expired")
    async with connect() as db:
        row = await (await db.execute("SELECT * FROM mobile_pairings WHERE id=?", (item.pairing_id,))).fetchone()
        if not row or datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC):
            raise HTTPException(410, "Pairing request expired")
        expected = _proof(key, item.pairing_id, item.device_name)
        if not secrets.compare_digest(expected, item.proof):
            raise HTTPException(401, "Invalid pairing proof")
        await db.execute(
            "UPDATE mobile_pairings SET requested_name=?,status='pending' WHERE id=?",
            (item.device_name, item.pairing_id),
        )
        await db.commit()
        return {"status": "pending", "device_id": row["device_id"]}


async def list_pairings() -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    async with connect() as db:
        expiring = await (
            await db.execute(
                "SELECT id FROM mobile_pairings WHERE status IN ('created','pending') AND expires_at<=?",
                (now.isoformat(),),
            )
        ).fetchall()
        await db.execute(
            "UPDATE mobile_pairings SET status='expired' WHERE status IN ('created','pending') AND expires_at<=?",
            (now.isoformat(),),
        )
        await db.commit()
        rows = await (
            await db.execute(
                "SELECT id,device_id,requested_name,status,expires_at,created_at "
                "FROM mobile_pairings ORDER BY created_at DESC LIMIT 20"
            )
        ).fetchall()
    for row in expiring:
        _delete_key("pairing", row["id"])
        _delete_key("approved_pairing", row["id"])
    return [dict(row) for row in rows]


async def pairing_status(item: PairingPoll) -> dict[str, Any]:
    key = _load_key("pairing", item.pairing_id) or _load_key("approved_pairing", item.pairing_id)
    if key is None or not secrets.compare_digest(_proof(key, item.pairing_id, "status"), item.proof):
        raise HTTPException(401, "Invalid pairing proof")
    async with connect() as db:
        row = await (await db.execute("SELECT * FROM mobile_pairings WHERE id=?", (item.pairing_id,))).fetchone()
    if not row:
        raise HTTPException(404, "Pairing request not found")
    return {"status": row["status"], "device_id": row["device_id"]}


async def decide_pairing(pairing_id: str, approved: bool) -> dict[str, Any]:
    key = _load_key("pairing", pairing_id)
    async with connect() as db:
        row = await (await db.execute("SELECT * FROM mobile_pairings WHERE id=?", (pairing_id,))).fetchone()
        if not row or row["status"] != "pending" or key is None:
            raise HTTPException(404, "Pending pairing request not found")
        status = "approved" if approved else "denied"
        await db.execute("UPDATE mobile_pairings SET status=? WHERE id=?", (status, pairing_id))
        old_device_ids: list[str] = []
        if approved:
            old_device_ids = [item["id"] for item in await (await db.execute("SELECT id FROM mobile_devices WHERE revoked=0")).fetchall()]
            await db.execute("UPDATE mobile_devices SET revoked=1")
            await db.execute(
                "INSERT INTO mobile_devices(id,name,platform,paired_at,revoked) VALUES(?,?,?,?,0) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name,paired_at=excluded.paired_at,revoked=0",
                (row["device_id"], row["requested_name"] or "Android phone", "android", utcnow()),
            )
        await db.commit()
    _store_key("approved_pairing", pairing_id, key)
    if approved:
        for old_device_id in old_device_ids:
            if old_device_id != row["device_id"]:
                _delete_key("device", old_device_id)
        _store_key("device", row["device_id"], key)
        from .mobile_relay import relay_manager
        await relay_manager.promote(pairing_id, row["device_id"])
    _delete_key("pairing", pairing_id)
    return {"status": status, "device_id": row["device_id"]}


async def list_devices() -> list[dict[str, Any]]:
    async with connect() as db:
        rows = await (await db.execute("SELECT * FROM mobile_devices ORDER BY paired_at DESC")).fetchall()
    return [{**dict(row), "connected": connection_manager.is_connected(row["id"])} for row in rows]


async def revoke_device(device_id: str) -> bool:
    async with connect() as db:
        changed = (await db.execute("UPDATE mobile_devices SET revoked=1 WHERE id=?", (device_id,))).rowcount
        await db.commit()
    _delete_key("device", device_id)
    from .mobile_relay import relay_manager
    await relay_manager.remove(device_id)
    await connection_manager.disconnect(device_id)
    return bool(changed)


async def require_device_key(device_id: str) -> bytes:
    async with connect() as db:
        row = await (await db.execute("SELECT revoked FROM mobile_devices WHERE id=?", (device_id,))).fetchone()
    key = _load_key("device", device_id)
    if not row or row["revoked"] or key is None:
        raise PermissionError("This mobile device is not paired")
    return key


@dataclass
class ConnectedDevice:
    websocket: WebSocket
    key: bytes


class MobileConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, ConnectedDevice] = {}
        self.pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

    def is_connected(self, device_id: str) -> bool:
        return device_id in self.connections

    async def register(self, device_id: str, websocket: WebSocket, key: bytes) -> None:
        previous = self.connections.pop(device_id, None)
        if previous:
            await previous.websocket.close(code=1000, reason="A newer phone connection replaced this one")
        self.connections[device_id] = ConnectedDevice(websocket, key)

    async def disconnect(self, device_id: str) -> None:
        connection = self.connections.pop(device_id, None)
        if connection:
            await connection.websocket.close(code=1000)
        for future in self.pending.values():
            if not future.done():
                future.set_exception(ConnectionError("The paired phone disconnected"))

    async def send(self, device_id: str, payload: dict[str, Any]) -> None:
        connection = self.connections.get(device_id)
        if not connection:
            raise HTTPException(409, "The paired phone is offline")
        await connection.websocket.send_json(encrypt_payload(device_id, connection.key, payload))

    async def command(self, device_id: str, command: PhoneCommand) -> dict[str, Any]:
        command_id = str(uuid4())
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.pending[command_id] = future
        try:
            await self.send(device_id, {"type": "phone_command", "id": command_id, **command.model_dump()})
            return await asyncio.wait_for(future, timeout=30)
        finally:
            self.pending.pop(command_id, None)

    def resolve(self, command_id: str, result: dict[str, Any]) -> None:
        future = self.pending.get(command_id)
        if future and not future.done():
            future.set_result(result)


connection_manager = MobileConnectionManager()


async def _dashboard_payload() -> dict[str, Any]:
    return {
        "type": "dashboard_sync",
        "memories": await list_memories(limit=100),
        "reminders": await list_reminders(),
        "system_status": {"online": True, "label": "All systems nominal"},
        "synced_at": utcnow(),
    }


async def handle_control_socket(websocket: WebSocket, device_id: str) -> None:
    await websocket.accept()
    try:
        key = await require_device_key(device_id)
        first = EncryptedEnvelope.model_validate(await websocket.receive_json())
        hello = decrypt_payload(first, key)
        if hello.get("type") != "hello":
            raise ValueError("The first mobile message must be hello")
        await connection_manager.register(device_id, websocket, key)
        async with connect() as db:
            await db.execute("UPDATE mobile_devices SET last_seen_at=? WHERE id=?", (utcnow(), device_id))
            await db.commit()
        await websocket.send_json(encrypt_payload(device_id, key, {"type": "connected"}))
        await websocket.send_json(encrypt_payload(device_id, key, await _dashboard_payload()))
        while True:
            envelope = EncryptedEnvelope.model_validate(await websocket.receive_json())
            message = decrypt_payload(envelope, key)
            kind = message.get("type")
            if kind == "tool_call":
                try:
                    result = await request_action(str(message.get("action", "")), dict(message.get("arguments") or {}))
                except Exception as error:
                    result = {"status": "failed", "error": str(error)}
                await websocket.send_json(encrypt_payload(device_id, key, {"type": "tool_result", "id": message.get("id"), "result": result}))
            elif kind == "confirm":
                try:
                    result = await confirm_action(str(message.get("token", "")), bool(message.get("approved")))
                except Exception as error:
                    result = {"status": "failed", "error": str(error)}
                await websocket.send_json(encrypt_payload(device_id, key, {"type": "confirmation_result", "result": result}))
            elif kind == "phone_command_result":
                connection_manager.resolve(str(message.get("id", "")), dict(message.get("result") or {}))
            elif kind == "refresh_dashboard":
                await websocket.send_json(encrypt_payload(device_id, key, await _dashboard_payload()))
            elif kind == "create_reminder":
                try:
                    await create_reminder(ReminderCreate.model_validate(message.get("reminder") or {}))
                    response = await _dashboard_payload()
                except Exception as error:
                    response = {"type": "dashboard_error", "error": str(error)}
                await websocket.send_json(encrypt_payload(device_id, key, response))
            elif kind == "update_reminder":
                try:
                    reminder_id = str(message.get("reminder_id", ""))
                    if not reminder_id or await update_reminder(reminder_id, ReminderPatch.model_validate(message.get("patch") or {})) is None:
                        raise ValueError("Reminder was not found")
                    response = await _dashboard_payload()
                except Exception as error:
                    response = {"type": "dashboard_error", "error": str(error)}
                await websocket.send_json(encrypt_payload(device_id, key, response))
            elif kind == "delete_reminder":
                try:
                    reminder_id = str(message.get("reminder_id", ""))
                    if not reminder_id or not await delete_reminder(reminder_id):
                        raise ValueError("Reminder was not found")
                    response = await _dashboard_payload()
                except Exception as error:
                    response = {"type": "dashboard_error", "error": str(error)}
                await websocket.send_json(encrypt_payload(device_id, key, response))
            elif kind == "ping":
                await websocket.send_json(encrypt_payload(device_id, key, {"type": "pong"}))
    except WebSocketDisconnect:
        pass
    except (PermissionError, ValueError) as error:
        try:
            await websocket.close(code=1008, reason=str(error)[:120])
        except Exception:
            pass
    finally:
        if connection_manager.connections.get(device_id, None) and connection_manager.connections[device_id].websocket is websocket:
            connection_manager.connections.pop(device_id, None)
            for future in connection_manager.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("The paired phone disconnected"))


class EncryptedMobileWebSocket:
    def __init__(self, websocket: WebSocket, device_id: str, key: bytes) -> None:
        self.websocket = websocket
        self.device_id = device_id
        self.key = key
        self.query_params: dict[str, str] = {}

    async def accept(self) -> None:
        return None

    async def receive_json(self) -> dict[str, Any]:
        envelope = EncryptedEnvelope.model_validate(await self.websocket.receive_json())
        return decrypt_payload(envelope, self.key)

    async def send_json(self, payload: dict[str, Any]) -> None:
        await self.websocket.send_json(encrypt_payload(self.device_id, self.key, payload))

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        await self.websocket.close(code=code, reason=reason or "")


async def prepare_live_socket(websocket: WebSocket, device_id: str) -> EncryptedMobileWebSocket:
    await websocket.accept()
    key = await require_device_key(device_id)
    first = EncryptedEnvelope.model_validate(await websocket.receive_json())
    hello = decrypt_payload(first, key)
    if hello.get("type") != "voice_hello":
        raise ValueError("The first mobile voice message must be voice_hello")
    return EncryptedMobileWebSocket(websocket, device_id, key)
