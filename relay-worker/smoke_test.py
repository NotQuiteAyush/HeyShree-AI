"""End-to-end connectivity check for the deployed SHREE encrypted relay."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets

from websockets.asyncio.client import connect


RELAY_URL = os.getenv(
    "SHREE_RELAY_URL",
    "https://shree-e2e-relay.shree-e2e-relay.workers.dev",
).rstrip("/")


async def verify_lane(lane: str) -> None:
    room = secrets.token_urlsafe(32)
    desktop_token = secrets.token_urlsafe(40)
    phone_token = secrets.token_urlsafe(40)
    phone_hash = hashlib.sha256(phone_token.encode()).hexdigest()
    socket_url = f"{RELAY_URL.replace('https://', 'wss://', 1)}/v1/rooms/{room}/{lane}"
    desktop_headers = {
        "Authorization": f"Bearer {desktop_token}",
        "X-Shree-Role": "desktop",
        "X-Shree-Phone-Token-Hash": phone_hash,
    }
    phone_headers = {
        "Authorization": f"Bearer {phone_token}",
        "X-Shree-Role": "phone",
    }
    async with connect(socket_url, additional_headers=desktop_headers) as desktop:
        async with connect(socket_url, additional_headers=phone_headers) as phone:
            desktop_frame = json.dumps({"opaque": "desktop-to-phone"})
            await desktop.send(desktop_frame)
            assert await asyncio.wait_for(phone.recv(), timeout=5) == desktop_frame
            phone_frame = json.dumps({"opaque": "phone-to-desktop"})
            await phone.send(phone_frame)
            assert await asyncio.wait_for(desktop.recv(), timeout=5) == phone_frame


async def main() -> None:
    for lane in ("pairing", "control", "live"):
        await verify_lane(lane)
    print(f"SHREE relay smoke test passed for pairing, control, and live lanes: {RELAY_URL}")


if __name__ == "__main__":
    asyncio.run(main())
