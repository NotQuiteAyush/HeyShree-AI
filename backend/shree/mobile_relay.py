from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import keyring
from websockets.asyncio.client import connect

logger = logging.getLogger("shree.mobile.relay")
_SERVICE = "SHREE Mobile Companion"


@dataclass
class RelayDescriptor:
    url: str
    room_id: str
    desktop_token: str
    phone_token: str

    def public(self) -> dict[str, str]:
        return {"url": self.url, "room_id": self.room_id, "token": self.phone_token}


class RelaySocket:
    def __init__(self, websocket) -> None:
        self.websocket = websocket
        self.query_params: dict[str, str] = {}

    async def accept(self) -> None:
        return None

    async def receive_json(self) -> dict[str, Any]:
        message = await self.websocket.recv()
        if not isinstance(message, str):
            message = bytes(message).decode("utf-8")
        value = json.loads(message)
        if not isinstance(value, dict):
            raise ValueError("Relay frame must be a JSON object")
        return value

    async def send_json(self, payload: dict[str, Any]) -> None:
        await self.websocket.send(json.dumps(payload, separators=(",", ":")))

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        await self.websocket.close(code=code, reason=reason or "")


class MobileRelayManager:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._pairings: dict[str, RelayDescriptor] = {}
        self._stopping = False
        self._live_handler: Callable[[Any], Awaitable[None]] | None = None

    def set_live_handler(self, handler: Callable[[Any], Awaitable[None]]) -> None:
        self._live_handler = handler

    async def begin_pairing(self, pairing_id: str, key: bytes, relay_url: str) -> dict[str, str]:
        normalized = relay_url.strip().rstrip("/")
        if not normalized.startswith("https://"):
            raise ValueError("Remote relay URL must use HTTPS")
        descriptor = RelayDescriptor(
            url=normalized,
            room_id=secrets.token_urlsafe(32),
            desktop_token=secrets.token_urlsafe(40),
            phone_token=secrets.token_urlsafe(40),
        )
        self._pairings[pairing_id] = descriptor
        ready = asyncio.Event()
        self._replace_task(f"pairing:{pairing_id}", self._pairing_loop(pairing_id, key, descriptor, ready))
        try:
            await asyncio.wait_for(ready.wait(), timeout=10)
        except TimeoutError as error:
            self._pairings.pop(pairing_id, None)
            task = self._tasks.pop(f"pairing:{pairing_id}", None)
            if task:
                task.cancel()
            raise ConnectionError("SHREE could not establish the remote relay") from error
        return descriptor.public()

    async def promote(self, pairing_id: str, device_id: str) -> None:
        descriptor = self._pairings.pop(pairing_id, None)
        if descriptor is None:
            return
        keyring.set_password(_SERVICE, f"relay:{device_id}", json.dumps(descriptor.__dict__, separators=(",", ":")))
        self._start_device(device_id, descriptor)

    async def restore(self) -> None:
        from .mobile import list_devices
        for device in await list_devices():
            if device.get("revoked"):
                continue
            raw = keyring.get_password(_SERVICE, f"relay:{device['id']}")
            if not raw:
                continue
            try:
                self._start_device(device["id"], RelayDescriptor(**json.loads(raw)))
            except Exception as error:
                logger.warning("Could not restore remote link for %s: %s", device["id"], error)

    async def remove(self, device_id: str) -> None:
        for lane in ("control", "live"):
            task = self._tasks.pop(f"{lane}:{device_id}", None)
            if task:
                task.cancel()
        try:
            keyring.delete_password(_SERVICE, f"relay:{device_id}")
        except keyring.errors.PasswordDeleteError:
            pass

    async def close(self) -> None:
        self._stopping = True
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _start_device(self, device_id: str, descriptor: RelayDescriptor) -> None:
        self._replace_task(f"control:{device_id}", self._device_loop(device_id, "control", descriptor))
        self._replace_task(f"live:{device_id}", self._device_loop(device_id, "live", descriptor))

    def _replace_task(self, name: str, coroutine) -> None:
        previous = self._tasks.pop(name, None)
        if previous:
            previous.cancel()
        task = asyncio.create_task(coroutine, name=f"shree-relay-{name}")
        self._tasks[name] = task

    def _headers(self, descriptor: RelayDescriptor) -> dict[str, str]:
        phone_hash = hashlib.sha256(descriptor.phone_token.encode()).hexdigest()
        return {
            "Authorization": f"Bearer {descriptor.desktop_token}",
            "X-Shree-Role": "desktop",
            "X-Shree-Phone-Token-Hash": phone_hash,
        }

    def _websocket_url(self, descriptor: RelayDescriptor, lane: str) -> str:
        root = descriptor.url.replace("https://", "wss://", 1)
        return f"{root}/v1/rooms/{descriptor.room_id}/{lane}"

    async def _pairing_loop(self, pairing_id: str, key: bytes, descriptor: RelayDescriptor, ready: asyncio.Event) -> None:
        from .mobile import EncryptedEnvelope, decrypt_payload, encrypt_payload, pairing_status, request_pairing, PairingPoll, PairingRequest
        while not self._stopping and pairing_id in self._pairings:
            try:
                async with connect(self._websocket_url(descriptor, "pairing"), additional_headers=self._headers(descriptor), max_size=2_100_000) as websocket:
                    ready.set()
                    while True:
                        raw = await websocket.recv()
                        message = decrypt_payload(EncryptedEnvelope.model_validate_json(raw), key)
                        kind = message.get("type")
                        if kind == "pairing_request":
                            result = await request_pairing(PairingRequest.model_validate(message))
                        elif kind == "pairing_poll":
                            result = await pairing_status(PairingPoll.model_validate(message))
                        else:
                            result = {"status": "error", "error": "Unsupported pairing relay message"}
                        await websocket.send(json.dumps(encrypt_payload(str(message.get("device_id", "remote-pairing-device")), key, {"type": "pairing_result", **result}), separators=(",", ":")))
                        if result.get("status") in {"approved", "denied", "expired"}:
                            return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Remote pairing relay reconnecting: %s", error)
                await asyncio.sleep(2)

    async def _device_loop(self, device_id: str, lane: str, descriptor: RelayDescriptor) -> None:
        from .mobile import handle_control_socket, prepare_live_socket
        while not self._stopping:
            try:
                async with connect(self._websocket_url(descriptor, lane), additional_headers=self._headers(descriptor), max_size=2_100_000) as websocket:
                    adapter = RelaySocket(websocket)
                    if lane == "control":
                        await handle_control_socket(adapter, device_id)
                    else:
                        encrypted = await prepare_live_socket(adapter, device_id)
                        if self._live_handler is None:
                            raise RuntimeError("SHREE live relay handler is unavailable")
                        await self._live_handler(encrypted)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.info("Remote %s link for %s reconnecting: %s", lane, device_id, error)
                await asyncio.sleep(2)


relay_manager = MobileRelayManager()
