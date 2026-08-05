from __future__ import annotations
import asyncio
import json
from datetime import UTC,datetime,timedelta
from pathlib import Path
from secrets import token_urlsafe
from time import perf_counter
from typing import Any
from pydantic import ValidationError
from .base import PermissionLevel,ToolContext,ToolDefinition,ToolOutcome,Verification
from .audio import AudioDeviceParams,ApplicationVolumeParams,ChangeVolumeParams,EmptyParams, MuteParams,SelectAudioDeviceParams,SetVolumeParams,get_system_volume,set_system_volume,change_system_volume,set_mute,set_application_volume,list_audio_devices,select_audio_device
from .applications import ApplicationAliasParams,CloseApplicationParams,ControlWindowParams,FindApplicationParams,OpenApplicationParams,WindowQuery,find_application,open_application,close_application,force_close_application,list_windows,control_window,set_application_alias
from .clipboard import ClipboardParams,clipboard_action
from .computer_use import ComputerUseParams,computer_use
from .files import ArchiveParams,CreateFileParams,FindFileParams,OverwriteItemParams,PathParam,RenameParams,TransferParams,compress_item,copy_item,create_file,create_folder,extract_archive,find_file,move_item,overwrite_item,recycle_item,rename_item,resolved
from .input import MouseActionParams,PressKeysParams,TypeTextParams,WindowsSearchParams,mouse_action,press_keys,search_windows,type_text
from .screen import CaptureScreenParams,InspectScreenParams,capture_screen,inspect_screen
from .system import EmptyParams as SystemEmptyParams,ShutdownParams,WindowsSettingParams,cancel_power_action,cancel_shutdown,change_windows_setting,get_system_status,hibernate_system,lock_workstation,restart_system,shutdown_system,sign_out_user,sleep_system,switch_user
from .media import MediaActionParams,media_action
from .memory_control import DeleteMemoryParams,delete_memory
from ..database import connect,utcnow
from ..settings_store import get_setting

class ToolRegistry:
    def __init__(self):
        self.tools:dict[str,ToolDefinition]={}; self.cancel_event=asyncio.Event(); self.active_tasks:set[asyncio.Task]=set()
    def add(self,definition:ToolDefinition): self.tools[definition.name]=definition
    def schemas(self): return [definition.public_schema() for definition in self.tools.values()]
    async def _setting(self,key:str,default:Any):
        return await get_setting(key,default)
    async def _permission_decision(self,capability:str):
        async with connect() as db:
            cursor=await db.execute("SELECT decision FROM permissions WHERE capability=?",(capability,)); row=await cursor.fetchone()
            return row["decision"] if row else "ask"
    async def request(self,name:str,arguments:dict[str,Any]):
        definition=self.tools.get(name)
        if not definition: raise ValueError(f"Unknown desktop tool: {name}")
        if definition.capability != "memory" and not await self._setting("desktop_control_enabled",True): raise PermissionError("Desktop control is disabled in Settings")
        if definition.capability == "memory" and not await self._setting("memory_enabled",True): raise PermissionError("Memory is disabled in Settings")
        if definition.capability == "power_control" and name not in {"cancel_power_action", "cancel_shutdown"} and not await self._setting("power_controls_enabled",False): raise PermissionError("Power and session controls are disabled in Settings")
        if name in {"set_system_volume","change_system_volume","set_application_volume","set_system_mute"} and not await self._setting("exact_volume_enabled",True): raise PermissionError("Exact volume control is disabled in Settings")
        if name in {"type_text","press_keys","search_windows"} and not await self._setting("keyboard_automation_enabled",True): raise PermissionError("Keyboard automation is disabled in Settings")
        if name == "mouse_action" and not await self._setting("mouse_automation_enabled",True): raise PermissionError("Mouse automation is disabled in Settings")
        if definition.capability == "file_access" and not await self._setting("file_management_enabled",True): raise PermissionError("File management is disabled in Settings")
        if name in {"capture_screen","inspect_screen"} and (not await self._setting("screen_understanding_enabled",True) or not await self._setting("screen_capture_enabled",True)): raise PermissionError("Screen understanding is disabled in Settings")
        if name == "inspect_screen" and not await self._setting("ocr_enabled",True): raise PermissionError("OCR is disabled in Settings")
        if name == "clipboard_action" and not await self._setting("clipboard_access_enabled",True): raise PermissionError("Clipboard access is disabled in Settings")
        try: params=definition.parameters.model_validate(arguments)
        except ValidationError as error: raise ValueError(error.errors(include_url=False)) from error
        await self._validate_file_roots(definition,params.model_dump())
        decision=await self._permission_decision(definition.capability)
        if decision=="deny": raise PermissionError(f"{definition.capability} permission is disabled")
        confirmation=definition.permission in {PermissionLevel.DESTRUCTIVE,PermissionLevel.PRIVILEGED} or (definition.permission==PermissionLevel.SENSITIVE and decision!="allow_always")
        # Power and session transitions always need per-action confirmation,
        # even when the general power-control capability has been allowed.
        if definition.capability == "power_control" and name not in {"cancel_power_action", "cancel_shutdown"}:
            confirmation = True
        if confirmation:
            token,now=token_urlsafe(24),datetime.now(UTC); explanation=f"{definition.description} ({definition.permission.value} permission)"
            async with connect() as db:
                await db.execute("INSERT INTO pending_actions VALUES(?,?,?,?,?,?,?)",(token,name,json.dumps(params.model_dump(mode="json")),definition.permission.value,explanation,(now+timedelta(minutes=5)).isoformat(),now.isoformat())); await db.commit()
            return {"tool_name":name,"permission_level":definition.permission.value,"status":"confirmation_required","required_parameters":definition.parameters.model_json_schema().get("required",[]),"execution_result":{},"verification_result":{"verified":False,"method":"not executed","observed":{},"message":"Waiting for explicit user confirmation."},"human_response":f"Confirmation required: {explanation}","confirmation":{"token":token,"expires_in_seconds":300,"explanation":explanation}}
        return await self.execute(definition,params)
    async def confirm(self,token:str,approved:bool):
        async with connect() as db:
            cursor=await db.execute("SELECT * FROM pending_actions WHERE token=?",(token,)); pending=await cursor.fetchone(); await db.execute("DELETE FROM pending_actions WHERE token=?",(token,)); await db.commit()
        if not pending: raise ValueError("Confirmation is invalid or already used")
        if datetime.fromisoformat(pending["expires_at"])<datetime.now(UTC): raise ValueError("Confirmation has expired")
        definition=self.tools.get(pending["action"])
        if not definition: raise ValueError("Tool is no longer available")
        arguments=json.loads(pending["arguments"])
        if not approved:
            await self._audit(definition,False,arguments,"denied")
            return {"tool_name":definition.name,"permission_level":definition.permission.value,"status":"denied","execution_result":{},"verification_result":{"verified":False,"method":"not executed","observed":{},"message":"User denied the action."},"human_response":"The action was cancelled and nothing was changed.","duration_ms":0}
        params=definition.parameters.model_validate(arguments); return await self.execute(definition,params)
    async def execute(self,definition:ToolDefinition,params):
        if self.cancel_event.is_set(): raise asyncio.CancelledError("Emergency stop is active")
        started=perf_counter(); context=ToolContext(self.cancel_event)
        async def run(): return await definition.handler(params,context)
        task=asyncio.create_task(run(),name=f"tool:{definition.name}"); self.active_tasks.add(task)
        try:
            execution,verification,response=await asyncio.wait_for(task,definition.timeout_seconds)
            status="completed" if verification.verified else "unverified"
            outcome=ToolOutcome(tool_name=definition.name,permission_level=definition.permission,status=status,execution_result=execution,verification_result=verification,human_response=response,duration_ms=round((perf_counter()-started)*1000))
            await self._audit(definition,True,params.model_dump(mode="json"),status)
            return outcome.model_dump(mode="json")
        except asyncio.TimeoutError:
            await self._audit(definition,False,params.model_dump(mode="json"),"timeout")
            return ToolOutcome(tool_name=definition.name,permission_level=definition.permission,status="timeout",execution_result={"error":f"Exceeded {definition.timeout_seconds:g}s timeout"},verification_result=Verification(verified=False,method="timeout",observed={},message="The tool did not finish before its deadline."),human_response=f"{definition.name} timed out; no success was reported.",duration_ms=round((perf_counter()-started)*1000)).model_dump(mode="json")
        except asyncio.CancelledError:
            await self._audit(definition,False,params.model_dump(mode="json"),"cancelled"); raise
        except Exception as error:
            await self._audit(definition,False,params.model_dump(mode="json"),"failed")
            return ToolOutcome(tool_name=definition.name,permission_level=definition.permission,status="failed",execution_result={"error":str(error),"error_type":type(error).__name__},verification_result=Verification(verified=False,method="execution error",observed={},message="The action failed before it could be verified."),human_response=f"{definition.name} failed: {error}",duration_ms=round((perf_counter()-started)*1000)).model_dump(mode="json")
        finally: self.active_tasks.discard(task)
    async def emergency_stop(self):
        stopped_event=self.cancel_event; stopped_event.set(); tasks=list(self.active_tasks)
        for task in tasks: task.cancel()
        if tasks: await asyncio.gather(*tasks,return_exceptions=True)
        self.cancel_event=asyncio.Event()
        return {"stopped":len(tasks),"latched":False,"human_response":f"Emergency stop activated. Cancelled {len(tasks)} active desktop workflow(s)."}
    def update_readiness(self):
        active = sorted({task.get_name().removeprefix("tool:") for task in self.active_tasks if not task.done()})
        # These operations can leave user data incomplete if the application exits mid-flight.
        blocking_names = {
            "copy_item", "move_item", "overwrite_item", "recycle_item",
            "compress_item", "extract_archive", "create_file", "create_folder", "rename_item",
        }
        blocking = [name for name in active if name in blocking_names]
        return {
            "ready": not blocking,
            "active_tasks": active,
            "blocking_tasks": blocking,
            "message": (
                f"Wait for these file operations to finish before installing: {', '.join(blocking)}."
                if blocking else "Shree is ready to install the update."
            ),
        }

    async def prepare_update(self):
        readiness = self.update_readiness()
        if not readiness["ready"]:
            return readiness
        # Safe automation is cancelled before Electron shuts down. Blocking file operations
        # are never cancelled here; the readiness check above makes the installer wait.
        tasks = [task for task in self.active_tasks if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        readiness["cancelled_safe_tasks"] = len(tasks)
        return readiness
    def reset_stop(self): self.cancel_event=asyncio.Event(); return {"latched":False}
    async def _validate_file_roots(self,definition:ToolDefinition,arguments:dict):
        if definition.capability!="file_access": return
        protected=[Path(value).resolve() for value in [r"C:\Windows",r"C:\Program Files",r"C:\Program Files (x86)"]]
        for key in ("path","source","destination"):
            if value:=arguments.get(key):
                target=resolved(value)
                if any(target==root or root in target.parents for root in protected): raise PermissionError(f"Protected Windows directory is not available to desktop tools: {target}")
        configured=await self._setting("file_access_folders",[])
        if not configured:return
        roots=[resolved(item) for item in configured]
        for key in ("path","source","destination"):
            if value:=arguments.get(key):
                target=resolved(value)
                if not any(target==root or root in target.parents for root in roots): raise PermissionError(f"Path is outside allowed folders: {target}")
    async def _audit(self,definition:ToolDefinition,approved:bool,details:dict,status:str):
        redacted={key:("[redacted]" if key in {"text","content"} else value) for key,value in details.items()}
        for key in ("text", "content"):
            if isinstance(details.get(key), str): redacted[f"{key}_length"] = len(details[key])
        redacted["status"]=status
        async with connect() as db:
            await db.execute("INSERT INTO audit_log(action,risk,approved,details,created_at) VALUES(?,?,?,?,?)",(definition.name,definition.permission.value,int(approved),json.dumps(redacted,default=str),utcnow())); await db.commit()

registry=ToolRegistry()
def add(name,description,permission,params,handler,timeout=15,capability="desktop_control"):
    registry.add(ToolDefinition(name,description,permission,params,handler,timeout,capability))

add("get_system_volume","Read current Windows master volume and mute state",PermissionLevel.SAFE,EmptyParams,get_system_volume)
add("set_system_volume","Set exact Windows master volume from 0 to 100 percent",PermissionLevel.SAFE,SetVolumeParams,set_system_volume)
add("change_system_volume","Increase or decrease Windows master volume by an exact amount",PermissionLevel.SAFE,ChangeVolumeParams,change_system_volume)
add("set_system_mute","Mute, unmute, or toggle Windows master audio",PermissionLevel.SAFE,MuteParams,set_mute)
add("set_application_volume","Set volume for active Windows Core Audio sessions belonging to an application",PermissionLevel.SAFE,ApplicationVolumeParams,set_application_volume)
add("list_audio_devices","Enumerate Windows audio endpoints",PermissionLevel.SAFE,AudioDeviceParams,list_audio_devices)
add("select_audio_device","Select a Windows default audio endpoint when a supported API exists",PermissionLevel.SAFE,SelectAudioDeviceParams,select_audio_device)
add("find_application","Discover installed Windows applications",PermissionLevel.SAFE,FindApplicationParams,find_application)
add("open_application","Open an installed application or validated executable path. For Chrome, Edge, or Firefox, put the final URL/domain/search in browser_target to open the browser and target in one fast call using the user's normal profile",PermissionLevel.SAFE,OpenApplicationParams,open_application)
add("set_application_alias","Remember a user-defined alias for an installed application",PermissionLevel.SAFE,ApplicationAliasParams,set_application_alias)
add("close_application","Gracefully close application windows",PermissionLevel.SAFE,CloseApplicationParams,close_application)
add("force_close_application","Force terminate an application after confirmation",PermissionLevel.DESTRUCTIVE,CloseApplicationParams,force_close_application)
add("list_windows","List visible top-level Windows and their state",PermissionLevel.SAFE,WindowQuery,list_windows)
add("control_window","Move, resize, snap, minimize, maximize, restore, foreground, or gracefully close a window",PermissionLevel.SAFE,ControlWindowParams,control_window)
add("type_text","Type Unicode text into a confirmed foreground application",PermissionLevel.SAFE,TypeTextParams,type_text,120,"keyboard_mouse")
add("press_keys","Send a validated keyboard shortcut to the foreground application",PermissionLevel.SAFE,PressKeysParams,press_keys,15,"keyboard_mouse")
add("search_windows","Open Windows taskbar search, enter a query, and optionally launch the first result",PermissionLevel.SAFE,WindowsSearchParams,search_windows,15,"keyboard_mouse")
add("mouse_action","Use UI Automation or pointer input for a mouse action",PermissionLevel.SAFE,MouseActionParams,mouse_action,20,"keyboard_mouse")
add("find_file","Search allowed folders for files and folders",PermissionLevel.SAFE,FindFileParams,find_file,30,"file_access")
add("create_file","Create a new UTF-8 text file without overwriting",PermissionLevel.SAFE,CreateFileParams,create_file,20,"file_access")
add("create_folder","Create a new folder",PermissionLevel.SAFE,PathParam,create_folder,15,"file_access")
add("copy_item","Copy a file or folder without overwriting",PermissionLevel.SAFE,TransferParams,copy_item,120,"file_access")
add("move_item","Move a file or folder without overwriting",PermissionLevel.SENSITIVE,TransferParams,move_item,120,"file_access")
add("overwrite_item","Copy or move over an existing item after destructive confirmation",PermissionLevel.DESTRUCTIVE,OverwriteItemParams,overwrite_item,120,"file_access")
add("rename_item","Rename a file or folder without overwriting",PermissionLevel.SAFE,RenameParams,rename_item,20,"file_access")
add("recycle_item","Move a file or folder to the Windows Recycle Bin",PermissionLevel.DESTRUCTIVE,PathParam,recycle_item,60,"file_access")
add("compress_item","Create and CRC-verify a ZIP archive",PermissionLevel.SAFE,ArchiveParams,compress_item,120,"file_access")
add("extract_archive","Safely extract a ZIP archive into an empty folder",PermissionLevel.SAFE,ArchiveParams,extract_archive,120,"file_access")
add("capture_screen","Capture all displays, active window, or a selected region",PermissionLevel.SAFE,CaptureScreenParams,capture_screen,20,"screen_reading")
add("inspect_screen","Visually inspect the foreground app by attaching its current screenshot and bounded native Windows control metadata",PermissionLevel.SAFE,InspectScreenParams,inspect_screen,20,"screen_reading")
add("computer_use","Universal visual Windows control: observe the active application, launch apps or browser targets, type, press shortcuts, click UI elements or coordinates, drag, scroll, wait, and return a fresh screenshot after every action. Use iteratively for unfamiliar applications and websites",PermissionLevel.SAFE,ComputerUseParams,computer_use,30,"computer_use")
add("clipboard_action","Read, write, or clear the Windows clipboard",PermissionLevel.SAFE,ClipboardParams,clipboard_action,10,"clipboard")
add("media_action","Read or control the current Windows system media session",PermissionLevel.SAFE,MediaActionParams,media_action,15,"media_control")
add("get_system_status","Read battery, brightness, storage, and network status",PermissionLevel.SAFE,SystemEmptyParams,get_system_status)
add("change_windows_setting","Set supported brightness or open a Windows settings page",PermissionLevel.SAFE,WindowsSettingParams,change_windows_setting,8)
add("shutdown_system","Schedule a Windows shutdown after explicit confirmation",PermissionLevel.PRIVILEGED,ShutdownParams,shutdown_system,15,"power_control")
add("restart_system","Schedule a Windows restart after explicit confirmation",PermissionLevel.PRIVILEGED,ShutdownParams,restart_system,15,"power_control")
add("lock_workstation","Lock the current Windows session after explicit confirmation",PermissionLevel.SENSITIVE,SystemEmptyParams,lock_workstation,15,"power_control")
add("sign_out_user","Sign out the current Windows user after explicit confirmation; applications may ask to save work",PermissionLevel.DESTRUCTIVE,SystemEmptyParams,sign_out_user,15,"power_control")
add("switch_user","Disconnect the current session and show Windows sign-in after explicit confirmation",PermissionLevel.SENSITIVE,SystemEmptyParams,switch_user,15,"power_control")
add("sleep_system","Put this computer to sleep after explicit confirmation when Windows and hardware support it",PermissionLevel.SENSITIVE,SystemEmptyParams,sleep_system,15,"power_control")
add("hibernate_system","Hibernate this computer after explicit confirmation when Windows and hardware support it",PermissionLevel.SENSITIVE,SystemEmptyParams,hibernate_system,15,"power_control")
add("cancel_power_action","Cancel a pending SHREE Windows shutdown or restart",PermissionLevel.SAFE,SystemEmptyParams,cancel_power_action,15,"power_control")
add("cancel_shutdown","Backward-compatible alias that cancels a pending SHREE Windows shutdown or restart",PermissionLevel.SAFE,SystemEmptyParams,cancel_shutdown,15,"power_control")
add("delete_memory","Delete a selected long-term memory after explicit confirmation",PermissionLevel.DESTRUCTIVE,DeleteMemoryParams,delete_memory,15,"memory")
