import base64
import hashlib
import hmac
import json

import pytest


@pytest.fixture(autouse=True)
def isolated_mobile_database(tmp_path, monkeypatch):
    from shree.config import get_settings
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


@pytest.mark.asyncio
async def test_mobile_encryption_rejects_tampering_and_replay():
    from shree.mobile import EncryptedEnvelope, decrypt_payload, encrypt_payload

    key = bytes(range(32))
    encoded = encrypt_payload("device-identifier-with-enough-length", key, {"type": "ping", "value": 7})
    assert decrypt_payload(EncryptedEnvelope.model_validate(encoded), key) == {"type": "ping", "value": 7}
    with pytest.raises(ValueError, match="already used"):
        decrypt_payload(EncryptedEnvelope.model_validate(encoded), key)
    changed = dict(encoded)
    changed["ciphertext"] = changed["ciphertext"][:-2] + "AA"
    with pytest.raises(Exception):
        decrypt_payload(EncryptedEnvelope.model_validate(changed), key, check_replay=False)


@pytest.mark.asyncio
async def test_pairing_requires_qr_secret_and_desktop_approval(monkeypatch):
    from shree.database import initialize_database
    from shree import mobile

    keys: dict[tuple[str, str], bytes] = {}
    monkeypatch.setattr(mobile, "_store_key", lambda kind, identifier, key: keys.__setitem__((kind, identifier), key))
    monkeypatch.setattr(mobile, "_load_key", lambda kind, identifier: keys.get((kind, identifier)))
    monkeypatch.setattr(mobile, "_delete_key", lambda kind, identifier: keys.pop((kind, identifier), None))
    await initialize_database()
    from shree.settings_store import update_application_settings
    await update_application_settings({"mobile_remote_access_enabled": False})

    started = await mobile.start_pairing(port=8765)
    data = started["qr_payload"].split("data=", 1)[1]
    decoded = json.loads(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
    key = base64.urlsafe_b64decode(decoded["k"] + "=" * (-len(decoded["k"]) % 4))
    proof = b64(hmac.new(key, f'{decoded["i"]}|Ayush phone'.encode(), hashlib.sha256).digest())

    requested = await mobile.request_pairing(
        mobile.PairingRequest(pairing_id=decoded["i"], device_name="Ayush phone", proof=proof)
    )
    assert requested["status"] == "pending"
    assert (await mobile.list_devices()) == []
    approved = await mobile.decide_pairing(decoded["i"], True)
    assert approved["status"] == "approved"
    devices = await mobile.list_devices()
    assert len(devices) == 1 and devices[0]["name"] == "Ayush phone" and devices[0]["revoked"] == 0
    assert await mobile.revoke_device(decoded["d"])


def test_phone_action_has_a_bounded_typed_contract():
    from shree.tools import registry
    tool = registry.tools["phone_action"]
    schema = tool.public_schema()["parameters"]
    assert set(schema["required"]) == {"action"}
    assert "open_url" in schema["properties"]["action"]["enum"]
    assert "send_sms" in schema["properties"]["action"]["enum"]


@pytest.mark.asyncio
async def test_mobile_dashboard_uses_shared_memories_and_reminders():
    from shree.database import initialize_database
    from shree.memory import add_memory
    from shree.mobile import _dashboard_payload
    from shree.models import MemoryCreate, ReminderCreate
    from shree.reminders import create_reminder

    await initialize_database()
    await add_memory(MemoryCreate(category="Preferences", content="Use concise Hinglish replies"))
    await create_reminder(ReminderCreate(text="Review the SHREE release"))

    payload = await _dashboard_payload()
    assert payload["type"] == "dashboard_sync"
    assert payload["system_status"] == {"online": True, "label": "All systems nominal"}
    assert any(item["content"] == "Use concise Hinglish replies" for item in payload["memories"])
    assert any(item["text"] == "Review the SHREE release" for item in payload["reminders"])
