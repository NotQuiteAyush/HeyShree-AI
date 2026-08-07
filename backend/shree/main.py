import asyncio
import json
import logging
import platform
import secrets
import shutil
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from uuid import uuid4
import keyring
import psutil
from google import genai
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import __version__
from .automation import ACTIONS, confirm_action, request_action
from .config import get_settings
from .database import connect, initialize_database, utcnow
from .identity import identity_payload
from .live import handle_live
from .mcp import mcp_manager
from .memory import add_memory, import_memories, list_memories, update_memory
from .mobile import (
    PairingDecision,
    PairingPoll,
    PairingRequest,
    PhoneCommand,
    check_pairing_rate_limit,
    connection_manager,
    decide_pairing,
    handle_control_socket,
    list_devices,
    list_pairings,
    pairing_status,
    prepare_live_socket,
    request_pairing,
    revoke_device,
    start_pairing,
)
from .mobile_relay import relay_manager
from .models import ApplicationSettings, ConfirmationRequest, DesktopControlSettings, ForgetMemory, McpServerCreate, MemoryCreate, MemoryImport, MemoryUpdate, PermissionUpdate, ReminderCreate, ReminderPatch, SettingValue, SettingsImport, SettingsPatch, SetupComplete, ToolRequest
from .plugins import discover_plugins, install_plugin_archive, remove_plugin, sdk_manifest_schema
from .reminders import claim_due_reminders, create_reminder, delete_reminder, list_reminders, update_reminder
from .tools import registry
from .tools.applications import get_foreground_context
from .settings_store import export_application_settings, get_application_settings, import_application_settings, reset_application_settings, update_application_settings

settings = get_settings()
PROTECTED_SETTINGS = {"setup_completed", "gemini_api_validated_at"}
logger = logging.getLogger("shree")
logger.setLevel(settings.log_level)
handler = RotatingFileHandler(settings.data_dir / "logs" / "shree.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logger.addHandler(handler)

class ApiKeyUpdate(BaseModel):
    api_key: str = Field(min_length=20, max_length=500)

class MessageCreate(BaseModel):
    conversation_id: str | None = None
    role: str = Field(pattern="^(user|model|system|tool)$")
    content: str = Field(min_length=1, max_length=100_000)

async def validate_gemini_key(api_key: str) -> dict[str, Any]:
    client = genai.Client(api_key=api_key)
    try:
        model = await client.aio.models.get(model=settings.gemini_live_model)
        return {"valid": True, "provider": "gemini", "model": getattr(model, "name", settings.gemini_live_model)}
    except Exception as error:
        logger.warning("Gemini credential validation failed: %s", type(error).__name__)
        raise HTTPException(400, "Gemini rejected this API key or the required Live model is unavailable for it") from error
    finally:
        await client.aio.aclose()

async def setup_status() -> dict[str, Any]:
    app_settings = await get_application_settings()
    configured = bool(settings.resolved_gemini_api_key())
    validated = bool(app_settings.gemini_api_validated_at)
    ready = configured and validated and app_settings.setup_completed
    return {
        "ready": ready,
        "requires_setup": not ready,
        "setup_completed": app_settings.setup_completed,
        "required_providers": ["gemini"],
        "missing_providers": [] if configured else ["gemini"],
        "providers": {"gemini": {"configured": configured, "validated": validated, "validated_at": app_settings.gemini_api_validated_at}},
    }

async def restore_mcp_servers() -> None:
    app_settings = await get_application_settings()
    for server in app_settings.mcp_servers:
        if not server.enabled:
            continue
        try:
            raw_env = keyring.get_password("SHREE Desktop AI", f"MCP_ENV_{server.name}") or "{}"
            await mcp_manager.connect(server.name, server.command, server.args, json.loads(raw_env))
        except Exception as error:
            logger.warning("Could not restore MCP server %s: %s", server.name, error)

@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    await restore_mcp_servers()
    relay_manager.set_live_handler(lambda websocket: handle_live(websocket, trusted_mobile=True))
    await relay_manager.restore()
    logger.info("SHREE backend %s started", __version__)
    yield
    await relay_manager.close()
    await mcp_manager.disconnect_all()
    logger.info("SHREE backend stopped")

app = FastAPI(title="Shree — Mark 12", version=__version__, lifespan=lifespan, docs_url="/api/docs", redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "X-Shree-Token"])

@app.middleware("http")
async def require_local_session_token(request, call_next):
    if request.url.path.startswith("/mobile/pairing/"):
        return await call_next(request)
    expected = settings.backend_token or ""
    if expected and request.method != "OPTIONS":
        provided = request.headers.get("X-Shree-Token", "")
        if not provided or not secrets.compare_digest(provided, expected):
            return JSONResponse({"detail": "Unauthorized local Shree session"}, status_code=401)
    return await call_next(request)

@app.middleware("http")
async def optional_api_request_logging(request, call_next):
    response = await call_next(request)
    try:
        if (await get_application_settings()).api_request_logs:
            logger.info("API %s %s -> %s", request.method, request.url.path, response.status_code)
    except Exception:
        pass
    return response

@app.get("/api/health")
async def health():
    status = await setup_status()
    return {"status": "ok", "version": __version__, "database": str(settings.database_path), "gemini_configured": bool(settings.resolved_gemini_api_key()), "setup_ready": status["ready"]}

@app.get("/api/desktop/foreground")
async def foreground_desktop_context():
    return await asyncio.to_thread(get_foreground_context)

@app.get("/api/setup/status")
async def get_setup_status(): return await setup_status()

@app.post("/api/setup/complete")
async def complete_setup(item: SetupComplete):
    status = await setup_status()
    if item.completed and (status["missing_providers"] or not status["providers"]["gemini"]["validated"]):
        raise HTTPException(409, "Validate the required Gemini API key before finishing setup")
    updated = await update_application_settings({"setup_completed": item.completed})
    return {"completed": updated.setup_completed, "ready": (await setup_status())["ready"]}

@app.get("/api/memories")
async def memories(query: str | None = None): return await list_memories(query)

@app.post("/api/memories", status_code=201)
async def remember(item: MemoryCreate):
    if not (await get_application_settings()).memory_enabled:
        raise HTTPException(403, "Memory is disabled in Settings")
    return await add_memory(item)

@app.post("/api/memories/forget")
async def forget(item: ForgetMemory):
    return await request_action("delete_memory", {"category": item.category, "content": item.contentToForget})

@app.put("/api/memories/{memory_id}")
async def edit_memory(memory_id: str, item: MemoryUpdate):
    try: return await update_memory(memory_id, item)
    except KeyError as error: raise HTTPException(404, "Memory not found") from error

@app.delete("/api/memories/{memory_id}")
async def remove_memory(memory_id: str):
    return await request_action("delete_memory", {"memory_id": memory_id})

@app.get("/api/memories/export")
async def export_memories():
    return {"format": "shree-memories", "version": 1, "memories": await list_memories(limit=5000)}

@app.post("/api/memories/import")
async def load_memories(item: MemoryImport): return await import_memories(item.memories)

@app.delete("/api/memories", status_code=200)
async def remove_all_memories(): return await request_action("delete_memory", {"all": True})

@app.get("/api/reminders")
async def reminders(): return await list_reminders()

@app.post("/api/reminders", status_code=201)
async def add_reminder(item: ReminderCreate): return await create_reminder(item)

@app.post("/api/reminders/due")
async def due_reminders():
    preferences = await get_application_settings()
    reminders = await claim_due_reminders() if preferences.notifications_enabled and preferences.reminder_notifications else []
    return {
        "reminders": reminders,
        "desktop_notifications": preferences.desktop_notifications,
        "sound_notifications": preferences.sound_notifications,
        "language": preferences.language,
    }

@app.patch("/api/reminders/{reminder_id}")
async def patch_reminder(reminder_id: str, item: ReminderPatch):
    result = await update_reminder(reminder_id, item)
    if not result: raise HTTPException(404, "Reminder not found")
    return result

@app.delete("/api/reminders/{reminder_id}", status_code=204)
async def remove_reminder(reminder_id: str):
    if not await delete_reminder(reminder_id): raise HTTPException(404, "Reminder not found")

@app.get("/api/tools")
async def tools(): return registry.schemas()

@app.post("/api/tools/execute")
async def execute_tool(item: ToolRequest):
    try: return await request_action(item.action, item.arguments)
    except PermissionError as error: raise HTTPException(403, str(error)) from error
    except (ValueError, FileNotFoundError, FileExistsError, RuntimeError) as error: raise HTTPException(400, str(error)) from error

@app.post("/api/tools/confirm/{token}")
async def confirm_tool(token: str, item: ConfirmationRequest):
    try: return await confirm_action(token, item.approved)
    except ValueError as error: raise HTTPException(400, str(error)) from error

@app.post("/api/tools/emergency-stop")
async def emergency_stop(): return await registry.emergency_stop()

@app.post("/api/tools/emergency-stop/reset")
async def reset_emergency_stop(): return registry.reset_stop()

@app.get("/api/system/update-readiness")
async def update_readiness():
    return registry.update_readiness()

@app.post("/api/system/prepare-update")
async def prepare_update():
    result = await registry.prepare_update()
    if result["ready"]:
        async with connect() as db:
            await db.execute("PRAGMA wal_checkpoint(FULL)")
            await db.commit()
    return result

@app.get("/api/desktop-control/settings")
async def desktop_control_settings():
    defaults=DesktopControlSettings().model_dump()
    app_settings=(await get_application_settings()).model_dump(mode="json")
    async with connect() as db:
        cursor=await db.execute("SELECT capability,decision FROM permissions ORDER BY capability"); permissions={row["capability"]:row["decision"] for row in await cursor.fetchall()}
    return {"settings":{key:app_settings.get(key,value) for key,value in defaults.items()},"permissions":permissions,"emergency_stop_active":registry.cancel_event.is_set()}

@app.put("/api/desktop-control/settings")
async def update_desktop_control_settings(item: DesktopControlSettings):
    await update_application_settings(item.model_dump(mode="json"))
    return item

@app.put("/api/desktop-control/permissions/{capability}")
async def update_permission(capability:str,item:PermissionUpdate):
    allowed={definition.capability for definition in registry.tools.values()}
    if capability not in allowed: raise HTTPException(404,"Unknown capability")
    async with connect() as db:
        await db.execute("INSERT INTO permissions VALUES(?,?,?) ON CONFLICT(capability) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at",(capability,item.decision,utcnow())); await db.commit()
    return {"capability":capability,"decision":item.decision}

@app.delete("/api/desktop-control/permissions",status_code=204)
async def reset_permissions():
    async with connect() as db: await db.execute("DELETE FROM permissions"); await db.commit()

@app.get("/api/audit")
async def audit(limit: int = Query(100, ge=1, le=1000)):
    async with connect() as db:
        cursor = await db.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(row) for row in await cursor.fetchall()]

@app.get("/api/settings")
async def get_all_settings():
    values = (await get_application_settings()).model_dump(mode="json")
    status = await setup_status()
    return {"values": values, "api_keys": status["providers"], "gemini_api_key": status["providers"]["gemini"]}

@app.put("/api/settings/{key}")
async def put_setting(key: str, item: SettingValue):
    if key in PROTECTED_SETTINGS: raise HTTPException(403, "This setting is managed by SHREE's secure setup flow")
    try: updated = await update_application_settings({key: item.value})
    except ValueError as error: raise HTTPException(400, str(error)) from error
    return {"key": key, "value": getattr(updated, key)}

@app.put("/api/settings")
async def put_settings(item: SettingsPatch):
    if PROTECTED_SETTINGS & set(item.values): raise HTTPException(403, "Setup and credential validation state cannot be edited directly")
    try: return {"values": (await update_application_settings(item.values)).model_dump(mode="json")}
    except (ValueError, RuntimeError) as error: raise HTTPException(400, str(error)) from error

@app.post("/api/settings/reset")
async def reset_settings(): return {"values": (await reset_application_settings()).model_dump(mode="json")}

@app.get("/api/settings/export")
async def export_settings(): return await export_application_settings()

@app.post("/api/settings/import")
async def import_settings(item: SettingsImport):
    try: return {"values": (await import_application_settings(item.values)).model_dump(mode="json")}
    except (ValueError, RuntimeError) as error: raise HTTPException(400, str(error)) from error

@app.post("/api/settings/reload")
async def reload_settings(): return {"values": (await get_application_settings()).model_dump(mode="json")}

@app.put("/api/secrets/gemini")
async def set_gemini_key(item: ApiKeyUpdate):
    validation = await validate_gemini_key(item.api_key)
    try: keyring.set_password("SHREE Desktop AI", "GEMINI_API_KEY", item.api_key)
    except Exception as error: raise HTTPException(500, "Windows Credential Manager could not store the key") from error
    validated_at = datetime.now(UTC).isoformat()
    await update_application_settings({"gemini_api_validated_at": validated_at})
    return {"configured": True, "validated": True, "validated_at": validated_at, **validation}

@app.post("/api/secrets/gemini/test")
async def test_gemini_key():
    api_key = settings.resolved_gemini_api_key()
    if not api_key: raise HTTPException(404, "Gemini API key is not configured")
    validation = await validate_gemini_key(api_key)
    validated_at = datetime.now(UTC).isoformat()
    await update_application_settings({"gemini_api_validated_at": validated_at})
    return {"configured": True, "validated": True, "validated_at": validated_at, **validation}

@app.delete("/api/secrets/gemini", status_code=204)
async def delete_gemini_key():
    try: keyring.delete_password("SHREE Desktop AI", "GEMINI_API_KEY")
    except keyring.errors.PasswordDeleteError: pass
    await update_application_settings({"gemini_api_validated_at": None, "setup_completed": False})

@app.get("/api/plugins")
async def plugins():
    app_settings = await get_application_settings()
    return [{**plugin, "enabled": app_settings.plugins_enabled and app_settings.plugin_states.get(plugin["id"], True)} for plugin in discover_plugins()]

@app.get("/api/plugins/sdk/manifest-schema")
async def plugin_schema(): return sdk_manifest_schema()

@app.post("/api/plugins/install", status_code=201)
async def install_plugin(file: UploadFile = File(...), replace: bool = Form(False)):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Select a ZIP plugin package")
    try: return install_plugin_archive(await file.read(), replace)
    except (ValueError, FileExistsError, json.JSONDecodeError) as error: raise HTTPException(400, str(error)) from error

@app.delete("/api/plugins/{plugin_id}")
async def uninstall_plugin(plugin_id: str):
    try:
        if not remove_plugin(plugin_id): raise HTTPException(404, "Plugin not found")
    except ValueError as error: raise HTTPException(400, str(error)) from error
    app_settings = await get_application_settings()
    states = dict(app_settings.plugin_states); states.pop(plugin_id, None)
    await update_application_settings({"plugin_states": states})
    return {"removed": True, "id": plugin_id}

@app.post("/api/plugins/{plugin_id}/test")
async def test_plugin(plugin_id: str):
    plugin = next((item for item in discover_plugins() if item.get("id") == plugin_id), None)
    if not plugin: raise HTTPException(404, "Plugin not found")
    return {"valid": plugin.get("status") == "available", "plugin": plugin}

@app.post("/api/mcp/connect")
async def connect_mcp(item: McpServerCreate):
    try:
        result = await mcp_manager.connect(item.name, item.command, item.args, item.env)
        app_settings = await get_application_settings()
        servers = [server for server in app_settings.mcp_servers if server.name != item.name]
        servers.append({"name":item.name,"command":item.command,"args":item.args,"enabled":True})
        await update_application_settings({"mcp_servers":[server.model_dump() if hasattr(server,"model_dump") else server for server in servers]})
        keyring.set_password("SHREE Desktop AI", f"MCP_ENV_{item.name}", json.dumps(item.env))
        return result
    except Exception as error: raise HTTPException(400, f"MCP connection failed: {error}") from error

@app.get("/api/mcp/servers")
async def mcp_servers():
    configured = (await get_application_settings()).mcp_servers
    return [{**server.model_dump(), "connected": server.name in mcp_manager.servers and mcp_manager.servers[server.name].process is not None and mcp_manager.servers[server.name].process.returncode is None} for server in configured]

@app.post("/api/mcp/{name}/test")
async def test_mcp(name: str):
    server = next((item for item in (await get_application_settings()).mcp_servers if item.name == name), None)
    if not server: raise HTTPException(404, "MCP server not found")
    try:
        raw_env = keyring.get_password("SHREE Desktop AI", f"MCP_ENV_{name}") or "{}"
        result = await mcp_manager.connect(name, server.command, server.args, json.loads(raw_env))
        return {"connected": True, "tool_count": len(result.get("tools", [])), **result}
    except Exception as error: raise HTTPException(400, f"MCP connection failed: {error}") from error

@app.delete("/api/mcp/{name}")
async def remove_mcp(name: str):
    await mcp_manager.disconnect(name)
    app_settings = await get_application_settings()
    remaining = [server.model_dump() for server in app_settings.mcp_servers if server.name != name]
    if len(remaining) == len(app_settings.mcp_servers): raise HTTPException(404, "MCP server not found")
    await update_application_settings({"mcp_servers": remaining})
    try: keyring.delete_password("SHREE Desktop AI", f"MCP_ENV_{name}")
    except keyring.errors.PasswordDeleteError: pass
    return {"removed": True, "name": name}

@app.post("/api/conversations/messages", status_code=201)
async def save_message(item: MessageCreate):
    conversation_id, now = item.conversation_id or f"conv_{uuid4().hex}", utcnow()
    async with connect() as db:
        await db.execute("INSERT OR IGNORE INTO conversations VALUES(?,?,?,?)", (conversation_id, item.content[:80], now, now))
        message_id = f"msg_{uuid4().hex}"
        await db.execute("INSERT INTO messages VALUES(?,?,?,?,?)", (message_id, conversation_id, item.role, item.content, now))
        await db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, conversation_id))
        await db.commit()
    return {"id": message_id, "conversation_id": conversation_id, "role": item.role, "content": item.content, "created_at": now}

@app.get("/api/conversations")
async def conversations():
    async with connect() as db:
        cursor = await db.execute("SELECT c.*,count(m.id) message_count FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.updated_at DESC")
        return [dict(row) for row in await cursor.fetchall()]

@app.delete("/api/conversations")
async def clear_conversations():
    async with connect() as db:
        messages = (await db.execute("DELETE FROM messages")).rowcount
        conversations = (await db.execute("DELETE FROM conversations")).rowcount
        await db.commit()
    return {"messages_deleted": messages, "conversations_deleted": conversations}

@app.get("/api/logs")
async def read_logs(limit: int = Query(200, ge=1, le=2000)):
    path = settings.data_dir / "logs" / "shree.log"
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:] if path.exists() else []
    return {"lines": lines, "path": str(path)}

@app.delete("/api/logs")
async def clear_logs():
    handler.acquire()
    try:
        handler.flush()
        if handler.stream:
            handler.stream.seek(0)
            handler.stream.truncate(0)
    finally:
        handler.release()
    removed = 0
    for backup in (settings.data_dir / "logs").glob("shree.log.*"):
        try: backup.unlink(); removed += 1
        except OSError: pass
    logger.info("Logs cleared by user")
    return {"cleared": True, "backups_removed": removed}

@app.delete("/api/cache")
async def clear_cache():
    cache = settings.data_dir / "cache"
    if cache.exists(): shutil.rmtree(cache)
    cache.mkdir(parents=True, exist_ok=True)
    return {"cleared": True, "path": str(cache)}

@app.get("/api/diagnostics")
async def diagnostics():
    process = psutil.Process()
    disk = psutil.disk_usage(str(settings.data_dir.anchor or settings.data_dir))
    return {
        "platform": platform.platform(), "python": platform.python_version(), "pid": process.pid,
        "memory_mb": round(process.memory_info().rss / 1024 / 1024, 1),
        "cpu_percent": process.cpu_percent(interval=0.05), "threads": process.num_threads(),
        "disk_free_gb": round(disk.free / 1024 ** 3, 1), "database": str(settings.database_path),
        "tool_count": len(registry.tools), "plugin_count": len(discover_plugins()),
        "mcp_connected": len(mcp_manager.servers), "setup": await setup_status(),
    }

@app.post("/api/diagnostics/test")
async def test_modules():
    async with connect() as db:
        database_ok = (await (await db.execute("SELECT 1 value")).fetchone())["value"] == 1
    plugins = discover_plugins()
    return {
        "database": database_ok,
        "credential_manager": bool(settings.resolved_gemini_api_key()),
        "desktop_tools": {"healthy": len(registry.tools) >= 30, "count": len(registry.tools)},
        "plugins": {"healthy": all(item.get("status") == "available" for item in plugins), "count": len(plugins)},
        "mcp": {"connected": len(mcp_manager.servers)},
        "data_directory": {"writable": settings.data_dir.is_dir(), "path": str(settings.data_dir)},
    }

@app.get("/api/about")
async def about():
    status = await setup_status()
    return {
        **identity_payload(__version__), "version": __version__, "build": "2026.08.05",
        "license": "Proprietary — all rights reserved", "credits": "Created by Ayush",
        "installed_modules": ["Gemini Live", "Windows Desktop Tools", "Android Companion", "Memory", "Reminders", "Plugins", "MCP"],
        "connected_providers": [name for name, provider in status["providers"].items() if provider["configured"]],
    }

@app.get("/api/identity")
async def identity():
    return identity_payload(__version__)

@app.post("/api/mobile/pairing/start")
async def create_mobile_pairing():
    return await start_pairing()

@app.get("/api/mobile/pairings")
async def get_mobile_pairings():
    return await list_pairings()

@app.post("/api/mobile/pairings/{pairing_id}/decision")
async def set_mobile_pairing_decision(pairing_id: str, item: PairingDecision):
    return await decide_pairing(pairing_id, item.approved)

@app.get("/api/mobile/devices")
async def get_mobile_devices():
    return await list_devices()

@app.delete("/api/mobile/devices/{device_id}")
async def delete_mobile_device(device_id: str):
    if not await revoke_device(device_id):
        raise HTTPException(404, "Paired phone not found")
    return {"revoked": True}

@app.post("/api/mobile/devices/{device_id}/command")
async def send_mobile_command(device_id: str, item: PhoneCommand):
    return await connection_manager.command(device_id, item)

@app.post("/mobile/pairing/request")
async def mobile_pairing_request(item: PairingRequest, request: Request):
    check_pairing_rate_limit(request.client.host if request.client else "unknown")
    return await request_pairing(item)

@app.post("/mobile/pairing/status")
async def mobile_pairing_status(item: PairingPoll, request: Request):
    check_pairing_rate_limit(request.client.host if request.client else "unknown")
    return await pairing_status(item)

@app.websocket("/mobile/control/{device_id}")
async def mobile_control_socket(websocket: WebSocket, device_id: str):
    await handle_control_socket(websocket, device_id)

@app.websocket("/mobile/live/{device_id}")
async def mobile_live_socket(websocket: WebSocket, device_id: str):
    try:
        encrypted_socket = await prepare_live_socket(websocket, device_id)
        await handle_live(encrypted_socket, trusted_mobile=True)
    except Exception as error:
        logger.warning("Rejected mobile voice connection for %s: %s", device_id, error)
        try:
            await websocket.close(code=1008, reason="Mobile device authentication failed")
        except Exception:
            pass

@app.websocket("/live")
async def live_socket(websocket: WebSocket): await handle_live(websocket)

dist = Path(__file__).resolve().parents[2] / "dist"
if dist.exists():
    assets = dist / "assets"
    if assets.exists(): app.mount("/assets", StaticFiles(directory=assets), name="assets")
    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        target = (dist / path).resolve()
        if dist.resolve() in target.parents and target.is_file(): return FileResponse(target)
        return FileResponse(dist / "index.html")
