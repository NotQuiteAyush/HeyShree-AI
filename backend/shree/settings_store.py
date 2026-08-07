from __future__ import annotations

import base64
import json
from typing import Any

from pydantic import ValidationError

from .database import connect, utcnow
from .models import ApplicationSettings

try:
    import win32crypt
except ImportError:  # pragma: no cover - SHREE is packaged for Windows
    win32crypt = None


_PREFIX = "dpapi:"
_PLAINTEXT_KEYS = {"encrypt_saved_settings"}
_DEFAULT_MOBILE_RELAY_URL = "https://shree-e2e-relay.shree-e2e-relay.workers.dev"


def encryption_available() -> bool:
    return win32crypt is not None


def _decode_value(value: str) -> Any:
    if value.startswith(_PREFIX):
        if win32crypt is None:
            raise RuntimeError("Windows DPAPI is unavailable; encrypted settings cannot be read")
        protected = base64.b64decode(value[len(_PREFIX):])
        _, clear = win32crypt.CryptUnprotectData(protected, None, None, None, 1)
        value = clear.decode("utf-8")
    return json.loads(value)


def _encode_value(value: Any, encrypt: bool) -> str:
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if not encrypt:
        return serialized
    if win32crypt is None:
        raise RuntimeError("Windows DPAPI is unavailable; settings encryption cannot be enabled")
    protected = win32crypt.CryptProtectData(serialized.encode("utf-8"), "SHREE setting", None, None, None, 1)
    return _PREFIX + base64.b64encode(protected).decode("ascii")


async def get_stored_settings() -> dict[str, Any]:
    async with connect() as db:
        cursor = await db.execute("SELECT key,value FROM settings ORDER BY key")
        rows = await cursor.fetchall()
    values: dict[str, Any] = {}
    for row in rows:
        values[row["key"]] = _decode_value(row["value"])
    return values


async def get_application_settings() -> ApplicationSettings:
    stored = await get_stored_settings()
    # Upgrade local-only companion installations once. The marker preserves a
    # user's later choice to turn worldwide access back off.
    if not stored.get("mobile_worldwide_migrated", False):
        stored["mobile_remote_access_enabled"] = True
        stored["mobile_relay_url"] = _DEFAULT_MOBILE_RELAY_URL
        stored["mobile_worldwide_migrated"] = True
    # Migrate the pre-1.1.15 shutdown-only switch into the unified power and
    # session control switch without enabling anything for existing users who
    # had shutdown disabled.
    if "power_controls_enabled" not in stored and "shutdown_enabled" in stored:
        stored["power_controls_enabled"] = bool(stored["shutdown_enabled"])
    # Restore the voice from the v1.1.20 talk-only/compact build once. The
    # marker lets users choose another voice afterwards without being reset.
    if not stored.get("v1_1_20_voice_restored", False):
        stored["assistant_voice"] = "Aoede"
        stored["v1_1_20_voice_restored"] = True
        if stored.get("floating_voice_volume", 100) == 100:
            stored["floating_voice_volume"] = 82
    known = {key: value for key, value in stored.items() if key in ApplicationSettings.model_fields}
    return ApplicationSettings.model_validate(known)


async def get_setting(key: str, default: Any = None) -> Any:
    if key not in ApplicationSettings.model_fields:
        return default
    settings = await get_application_settings()
    return getattr(settings, key, default)


async def save_application_settings(settings: ApplicationSettings) -> ApplicationSettings:
    values = settings.model_dump(mode="json")
    encrypt = settings.encrypt_saved_settings
    if encrypt and not encryption_available():
        raise RuntimeError("Windows DPAPI is unavailable; settings encryption cannot be enabled")
    async with connect() as db:
        now = utcnow()
        for key, value in values.items():
            encoded = _encode_value(value, encrypt and key not in _PLAINTEXT_KEYS)
            await db.execute(
                "INSERT INTO settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                (key, encoded, now),
            )
        await db.commit()
    return settings


async def update_application_settings(values: dict[str, Any]) -> ApplicationSettings:
    unknown = sorted(set(values) - set(ApplicationSettings.model_fields))
    if unknown:
        raise ValueError(f"Unknown setting(s): {', '.join(unknown)}")
    current = await get_application_settings()
    try:
        updated = ApplicationSettings.model_validate({**current.model_dump(), **values})
    except ValidationError as error:
        raise ValueError(str(error)) from error
    return await save_application_settings(updated)


async def reset_application_settings(*, preserve_setup: bool = True) -> ApplicationSettings:
    current = await get_application_settings()
    reset = ApplicationSettings()
    if preserve_setup:
        reset.setup_completed = current.setup_completed
        reset.gemini_api_validated_at = current.gemini_api_validated_at
    return await save_application_settings(reset)


async def export_application_settings() -> dict[str, Any]:
    values = (await get_application_settings()).model_dump(mode="json")
    values.pop("gemini_api_validated_at", None)
    values.pop("setup_completed", None)
    return {
        "format": "shree-settings",
        "version": 1,
        "contains_secrets": False,
        "values": values,
    }


async def import_application_settings(values: dict[str, Any]) -> ApplicationSettings:
    safe = dict(values)
    safe.pop("gemini_api_validated_at", None)
    safe.pop("setup_completed", None)
    safe.pop("ask_before_saving_memories", None)
    safe.pop("auto_save_preferences", None)
    for legacy_browser_setting in ("cookie_permissions", "download_folder", "homepage", "search_engine", "shutdown_enabled"):
        safe.pop(legacy_browser_setting, None)
    return await update_application_settings(safe)
