from __future__ import annotations

import asyncio
import json
import sys
from time import monotonic

import websockets


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8780/live"
    started = monotonic()
    async with websockets.connect(url, max_size=16 * 1024 * 1024) as socket:
        while True:
            message = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
            if message.get("state") == "connected":
                break
        await socket.send(json.dumps({
            "type": "text_input",
            "text": "Call get_system_volume now and report the verified result briefly.",
        }))
        while monotonic() - started < 45:
            message = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
            message_type = message.get("type")
            if message_type == "model_fallback":
                print(f"fallback={message.get('reason')}")
            if message_type == "tool_result":
                result = message.get("result") or {}
                print(f"tool={message.get('name')} status={result.get('status')} latency_ms={round((monotonic() - started) * 1000)}")
                return 0 if message.get("name") == "get_system_volume" else 2
            if message.get("error"):
                print(f"error={message.get('error_code')}: {message.get('error')}")
                return 3
    print("error=No tool result within 45 seconds")
    return 4


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
