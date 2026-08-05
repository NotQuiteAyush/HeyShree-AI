import asyncio
import json
import os
from typing import Any

class McpProcess:
    def __init__(self, command: str, args: list[str], env: dict[str, str] | None = None):
        self.command, self.args, self.env = command, args, env or {}
        self.process: asyncio.subprocess.Process | None = None
        self._id = 0
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self.process and self.process.returncode is None: return
        self.process = await asyncio.create_subprocess_exec(self.command, *self.args, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, **self.env},
            creationflags=0x08000000 if os.name == "nt" else 0)
        await self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "shree", "version": "1.1.39"}})
        await self.notify("notifications/initialized", {})

    async def request(self, method: str, params: dict[str, Any]) -> Any:
        async with self._lock:
            if not self.process or not self.process.stdin or not self.process.stdout: raise RuntimeError("MCP server is not running")
            self._id += 1
            payload = json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}, separators=(",", ":"))
            self.process.stdin.write((payload + "\n").encode())
            await self.process.stdin.drain()
            while True:
                line = await asyncio.wait_for(self.process.stdout.readline(), 30)
                if not line: raise RuntimeError("MCP server closed the connection")
                message = json.loads(line)
                if message.get("id") != self._id: continue
                if "error" in message: raise RuntimeError(message["error"].get("message", "MCP request failed"))
                return message.get("result")

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        if not self.process or not self.process.stdin: raise RuntimeError("MCP server is not running")
        self.process.stdin.write((json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n").encode())
        await self.process.stdin.drain()

    async def close(self) -> None:
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try: await asyncio.wait_for(self.process.wait(), 3)
            except TimeoutError: self.process.kill()

class McpManager:
    def __init__(self): self.servers: dict[str, McpProcess] = {}
    async def connect(self, name: str, command: str, args: list[str], env: dict[str, str]) -> dict:
        if name in self.servers: await self.servers[name].close()
        server = McpProcess(command, args, env)
        await server.start()
        self.servers[name] = server
        tools = await server.request("tools/list", {})
        return {"name": name, "tools": tools.get("tools", [])}
    async def disconnect(self, name: str) -> bool:
        server = self.servers.pop(name, None)
        if not server:
            return False
        await server.close()
        return True
    async def disconnect_all(self) -> None:
        await asyncio.gather(*(server.close() for server in self.servers.values()), return_exceptions=True)
        self.servers.clear()

mcp_manager = McpManager()
