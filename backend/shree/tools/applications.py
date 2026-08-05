from __future__ import annotations
import asyncio
import ctypes
import os
import shutil
import unicodedata
from ctypes import wintypes
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus
import psutil
import winreg
import win32api
import win32gui
import win32process
from pydantic import BaseModel, Field, model_validator
from .base import ToolContext, Verification
from ..settings_store import get_setting, update_application_settings

user32 = ctypes.windll.user32
SW_MINIMIZE, SW_MAXIMIZE, SW_RESTORE = 6, 3, 9
WM_CLOSE = 0x0010

ALIASES = {"code": "Visual Studio Code", "vscode": "Visual Studio Code", "explorer": "File Explorer", "files": "File Explorer", "calc": "Calculator"}
BUILTINS = {"notepad": "notepad.exe", "calculator": "calc.exe", "paint": "mspaint.exe", "task manager": "taskmgr.exe", "file explorer": "explorer.exe", "settings": "ms-settings:"}

class FindApplicationParams(BaseModel): name: str = Field(min_length=1, max_length=260)
class ApplicationAliasParams(BaseModel):
    alias: str=Field(min_length=1,max_length=80,pattern=r"^[\w .-]+$"); application: str=Field(min_length=1,max_length=260)
class OpenApplicationParams(BaseModel):
    name: str | None = Field(default=None, max_length=260)
    executable_path: str | None = Field(default=None, max_length=1000)
    arguments: list[str] = Field(default_factory=list, max_length=30)
    new_instance: bool = False
    browser_target: str | None = Field(default=None, min_length=1, max_length=2000, description="Optional URL, domain, or web search to open immediately when name is Chrome, Edge, or Firefox. This combines open-browser, new-tab, and navigate/search into one fast action.")
    @model_validator(mode="after")
    def target(self):
        if not self.name and not self.executable_path: raise ValueError("name or executable_path is required")
        if self.browser_target and (not self.name or self.executable_path): raise ValueError("browser_target requires a browser name rather than executable_path")
        if self.browser_target and self.arguments: raise ValueError("browser_target cannot be combined with unrestricted arguments")
        return self
class CloseApplicationParams(BaseModel):
    application: str = Field(min_length=1, max_length=260)
    timeout_seconds: float = Field(default=5, ge=1, le=20)
class WindowQuery(BaseModel): title: str | None = Field(default=None, max_length=300)
class ControlWindowParams(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    action: Literal["minimize", "maximize", "restore", "foreground", "move", "resize", "snap_left", "snap_right", "close"]
    x: int | None = None; y: int | None = None; width: int | None = Field(default=None, gt=50); height: int | None = Field(default=None, gt=50)

def _installed_apps() -> list[dict]:
    found: dict[str, dict] = {}
    roots = [(winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_64KEY), (winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_32KEY), (winreg.HKEY_CURRENT_USER, 0)]
    uninstall = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
    for hive, view in roots:
        try:
            with winreg.OpenKey(hive, uninstall, 0, winreg.KEY_READ | view) as root:
                for i in range(winreg.QueryInfoKey(root)[0]):
                    try:
                        with winreg.OpenKey(root, winreg.EnumKey(root, i)) as key:
                            name = str(winreg.QueryValueEx(key, "DisplayName")[0]).strip()
                            location = _reg_value(key, "InstallLocation"); icon = _reg_value(key, "DisplayIcon")
                            found[name.lower()] = {"name": name, "install_location": location, "display_icon": icon}
                    except OSError: continue
        except OSError: continue
    return sorted(found.values(), key=lambda item: item["name"].lower())

def _reg_value(key, name):
    try: return str(winreg.QueryValueEx(key, name)[0])
    except OSError: return ""

def _windows() -> list[dict]:
    items = []
    def callback(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
            title=win32gui.GetWindowText(hwnd); left,top,right,bottom=win32gui.GetWindowRect(hwnd); _,pid=win32process.GetWindowThreadProcessId(hwnd)
            try: process_name = psutil.Process(pid).name()
            except (psutil.Error, OSError): process_name = "unknown"
            items.append({"handle":int(hwnd),"title":title,"process":process_name,"pid":pid,"bounds":{"x":left,"y":top,"width":right-left,"height":bottom-top},"minimized":bool(user32.IsIconic(hwnd)),"maximized":bool(user32.IsZoomed(hwnd))})
    win32gui.EnumWindows(callback,None)
    return items

def get_foreground_context() -> dict:
    """Return verified active-window metadata without capturing screen content."""
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd or not win32gui.IsWindow(hwnd):
        return {"available": False, "fullscreen": False}
    title = win32gui.GetWindowText(hwnd)
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    try:
        process_name = psutil.Process(pid).name()
    except (psutil.Error, OSError):
        process_name = "unknown"
    monitor = win32api.MonitorFromWindow(hwnd, 2)
    monitor_rect = win32api.GetMonitorInfo(monitor)["Monitor"]
    tolerance = 3
    fullscreen = (
        not bool(user32.IsIconic(hwnd))
        and left <= monitor_rect[0] + tolerance
        and top <= monitor_rect[1] + tolerance
        and right >= monitor_rect[2] - tolerance
        and bottom >= monitor_rect[3] - tolerance
    )
    return {
        "available": True,
        "handle": int(hwnd),
        "title": title,
        "process": process_name,
        "pid": pid,
        "fullscreen": fullscreen,
        "bounds": {"x": left, "y": top, "width": right - left, "height": bottom - top},
    }

def normalize_window_text(value: str) -> str:
    """Normalize titles/process names without depending on invisible glyphs."""
    value = unicodedata.normalize("NFKC", value).casefold()
    return " ".join("".join(char if char.isalnum() else " " for char in value).split())

def window_matches(window: dict, query: str) -> bool:
    needle = normalize_window_text(query)
    if not needle:
        return False
    return needle in normalize_window_text(window.get("title", "")) or needle in normalize_window_text(window.get("process", ""))

async def find_application(params: FindApplicationParams, context: ToolContext):
    context.ensure_active(); query = ALIASES.get(params.name.lower(), params.name).lower()
    matches = [app for app in await asyncio.to_thread(_installed_apps) if query in app["name"].lower()]
    builtin = BUILTINS.get(params.name.lower())
    if builtin: matches.insert(0, {"name": params.name, "executable": builtin, "source": "Windows built-in"})
    return {"query": params.name, "matches": matches[:25]}, Verification(verified=True, method="Windows uninstall registry and built-in catalog", observed={"matches": len(matches)}, message="Application discovery completed."), f"Found {len(matches)} application match(es) for {params.name}."

def _resolve_executable(name: str) -> str:
    key = name.lower().strip(); target = BUILTINS.get(key)
    if target: return target
    common = {"chrome": "chrome.exe", "edge": "msedge.exe", "firefox": "firefox.exe", "spotify": "spotify.exe", "discord": "discord.exe", "steam": "steam.exe", "visual studio code": "code.cmd", "vscode": "code.cmd", "code": "code.cmd"}
    target = shutil.which(common.get(key, name))
    if target and not target.lower().endswith((".cmd", ".bat")): return target
    special = {
        "chrome": [Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")],
        "edge": [Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"), Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")],
        "visual studio code": [Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Microsoft VS Code/Code.exe", Path(r"C:\Program Files\Microsoft VS Code\Code.exe")],
        "vscode": [Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Microsoft VS Code/Code.exe"],
        "code": [Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Microsoft VS Code/Code.exe"],
    }
    for candidate in special.get(key, []):
        if candidate.is_file(): return str(candidate)
    for app in _installed_apps():
        if key in app["name"].lower() and app.get("display_icon"):
            candidate = app["display_icon"].split(",")[0].strip('"')
            if Path(candidate).is_file(): return candidate
    raise FileNotFoundError(f"Could not resolve installed application '{name}'")

def _browser_destination(value: str) -> str:
    target = value.strip()
    lowered = target.casefold()
    if lowered.startswith(("https://", "http://")):
        return target
    if " " not in target and "." in target:
        return f"https://{target}"
    return f"https://www.google.com/search?q={quote_plus(target)}"

async def open_application(params: OpenApplicationParams, context: ToolContext):
    context.ensure_active(); requested=params.name or ""
    if params.name:
        aliases = await get_setting("application_aliases", {})
        requested=aliases.get(params.name.lower(),params.name)
    target = params.executable_path or await asyncio.to_thread(_resolve_executable, requested)
    browser_destination = None
    browser_key = requested.casefold().strip()
    if params.browser_target:
        if not any(name in browser_key for name in ("chrome", "edge", "firefox")):
            raise ValueError("browser_target is supported only for Chrome, Edge, or Firefox")
        browser_destination = _browser_destination(params.browser_target)
    if target.startswith("ms-settings:"):
        code=ctypes.windll.shell32.ShellExecuteW(None,"open",target,None,None,1); verified=code>32
        return {"target":target,"shell_result":code}, Verification(verified=verified,method="Windows ShellExecute return code",observed={"uri":target,"code":code},message="Windows accepted the settings URI." if verified else "Windows rejected the settings URI."), "Opened Windows Settings." if verified else "Windows could not open Settings."
    if params.executable_path:
        path = Path(target).expanduser().resolve()
        if not path.is_file() or path.suffix.lower() not in {".exe", ".com", ".bat", ".cmd"}: raise ValueError("executable_path must reference an existing executable file")
        target = str(path)
    match_queries = [requested, params.name or "", Path(target).stem]
    existing = [w for w in await asyncio.to_thread(_windows) if any(query and window_matches(w, query) for query in match_queries)]
    if existing and browser_destination and not params.new_instance:
        focused = await asyncio.to_thread(_bring_to_foreground, existing[0]["handle"])
        new_tab_flag = "-new-tab" if "firefox" in browser_key else "--new-tab"
        handoff = await asyncio.create_subprocess_exec(target, new_tab_flag, browser_destination, creationflags=0x08000000)
        try:
            await asyncio.wait_for(handoff.wait(), timeout=1.5)
        except TimeoutError:
            pass
        await asyncio.sleep(.35)
        observed = [w for w in await asyncio.to_thread(_windows) if any(query and window_matches(w, query) for query in match_queries)]
        verified = bool(observed)
        return {"pid": handoff.pid, "target": target, "browser_destination": browser_destination, "windows": observed, "reused": True}, Verification(verified=verified, method="Browser new-tab process handoff + top-level window readback", observed={"window_count": len(observed), "foreground_requested": focused, "destination": browser_destination}, message="The normal browser profile accepted the new-tab request and its window remained available." if verified else "Windows accepted the browser launch, but no matching browser window was observed."), f"Opened {browser_destination} in a new {params.name} tab." if verified else f"Could not verify the new {params.name} tab."
    if existing and not params.new_instance and not params.arguments:
        focused = await asyncio.to_thread(_bring_to_foreground, existing[0]["handle"])
        return {"pid": existing[0]["pid"], "target": target, "windows": existing, "reused": True}, Verification(verified=focused, method="Existing top-level window + foreground-window readback", observed={"window": existing[0], "foreground": focused}, message="An existing application window was brought to the foreground." if focused else "The existing window was found but could not be foregrounded."), f"Brought {existing[0]['title']} to the foreground." if focused else f"Found {existing[0]['title']}, but Windows blocked foreground activation."
    before_handles = {w["handle"] for w in await asyncio.to_thread(_windows)}
    launch_arguments = list(params.arguments)
    if browser_destination:
        launch_arguments.extend(["-new-tab" if "firefox" in browser_key else "--new-tab", browser_destination])
    process = await asyncio.create_subprocess_exec(target, *launch_arguments, creationflags=0x08000000)
    deadline = asyncio.get_running_loop().time() + 5
    windows = []
    running = False
    while asyncio.get_running_loop().time() < deadline:
        context.ensure_active()
        all_windows = await asyncio.to_thread(_windows)
        windows = [w for w in all_windows if w["pid"] == process.pid or (w["handle"] not in before_handles and any(query and window_matches(w, query) for query in match_queries))]
        running = psutil.pid_exists(process.pid)
        if windows or running:
            break
        await asyncio.sleep(.2)
    verified = running or bool(windows)
    return {"pid": process.pid, "target": target, "browser_destination": browser_destination, "windows": windows, "reused": False}, Verification(verified=verified, method="Process existence + new top-level window enumeration", observed={"running": running, "window_count": len(windows), "destination": browser_destination}, message="Process or newly opened window was observed." if verified else "No running process or new window was observed."), f"Opened {browser_destination} in {params.name}." if verified and browser_destination else f"Opened {params.name or Path(target).stem} (PID {process.pid})." if verified else f"Windows did not confirm that {params.name or target} stayed open."

async def set_application_alias(params:ApplicationAliasParams,context:ToolContext):
    context.ensure_active()
    await asyncio.to_thread(_resolve_executable,params.application)
    aliases = dict(await get_setting("application_aliases", {})); aliases[params.alias.lower()]=params.application
    await update_application_settings({"application_aliases": aliases})
    final = await get_setting("application_aliases", {})
    verified=final.get(params.alias.lower())==params.application
    return {"alias":params.alias,"application":params.application},Verification(verified=verified,method="SQLite settings write + readback",observed={"mapping":final.get(params.alias.lower())},message="Alias mapping verified." if verified else "Alias mapping did not persist."),f"I'll use '{params.alias}' to mean {params.application}." if verified else "The application alias could not be saved."

async def list_windows(params: WindowQuery, context: ToolContext):
    context.ensure_active(); windows = await asyncio.to_thread(_windows)
    if params.title: windows = [w for w in windows if window_matches(w, params.title)]
    return {"windows": windows}, Verification(verified=True, method="EnumWindows", observed={"count": len(windows)}, message="Top-level Windows enumeration completed."), f"Found {len(windows)} matching open window(s)."

def _matching_windows(query: str): return [w for w in _windows() if window_matches(w, query)]

def _bring_to_foreground(hwnd: int) -> bool:
    if not user32.IsWindow(hwnd): return False
    # SW_RESTORE also converts a maximized window to its smaller restored
    # rectangle. Only restore windows that are actually minimized so bringing
    # Chrome forward never changes the user's chosen size/maximized state.
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    user32.BringWindowToTop(hwnd)
    if not user32.SetForegroundWindow(hwnd):
        # A real Alt key transition permits the user-requested foreground
        # activation under Windows' focus-stealing restrictions.
        user32.keybd_event(0x12, 0, 0, 0)
        user32.SetForegroundWindow(hwnd)
        user32.keybd_event(0x12, 0, 0x0002, 0)
    return user32.GetForegroundWindow() == hwnd

async def close_application(params: CloseApplicationParams, context: ToolContext):
    context.ensure_active(); matches = await asyncio.to_thread(_matching_windows, params.application)
    if not matches: raise ValueError(f"No open window matched '{params.application}'")
    for window in matches: win32gui.PostMessage(window["handle"], WM_CLOSE, 0, 0)
    deadline = asyncio.get_running_loop().time() + params.timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        context.ensure_active(); remaining = await asyncio.to_thread(_matching_windows, params.application)
        if not remaining: break
        await asyncio.sleep(.2)
    remaining = await asyncio.to_thread(_matching_windows, params.application); verified = not remaining
    return {"requested": len(matches), "remaining": remaining}, Verification(verified=verified, method="WM_CLOSE followed by EnumWindows readback", observed={"remaining": len(remaining)}, message="All matching windows closed gracefully." if verified else "Some windows remain, possibly due to an unsaved-work dialog."), f"Closed {len(matches)} {params.application} window(s) gracefully." if verified else f"Requested a graceful close, but {len(remaining)} window(s) remain. I did not force-close them."

async def force_close_application(params: CloseApplicationParams, context: ToolContext):
    context.ensure_active(); matches = await asyncio.to_thread(_matching_windows, params.application); pids = {w["pid"] for w in matches}
    if not pids: raise ValueError(f"No process matched '{params.application}'")
    for pid in pids:
        try: psutil.Process(pid).kill()
        except psutil.Error: pass
    processes=[]
    for pid in pids:
        try: processes.append(psutil.Process(pid))
        except psutil.Error: pass
    gone, alive = await asyncio.to_thread(psutil.wait_procs, processes, timeout=params.timeout_seconds)
    verified = not alive
    return {"terminated_pids": [p.pid for p in gone], "remaining_pids": [p.pid for p in alive]}, Verification(verified=verified, method="Process termination + PID readback", observed={"remaining": len(alive)}, message="Processes terminated." if verified else "Some processes remain."), f"Force-closed {len(gone)} process(es)." if verified else f"Some {params.application} processes could not be terminated."

async def control_window(params: ControlWindowParams, context: ToolContext):
    context.ensure_active(); matches = await asyncio.to_thread(_matching_windows, params.title)
    if not matches: raise ValueError(f"No open window matched '{params.title}'")
    window = matches[0]; hwnd = window["handle"]
    if params.action == "close":
        win32gui.PostMessage(hwnd, WM_CLOSE, 0, 0)
        for _ in range(25):
            context.ensure_active()
            if not win32gui.IsWindow(hwnd): break
            await asyncio.sleep(.2)
    elif params.action in {"minimize", "maximize", "restore"}: win32gui.ShowWindow(hwnd, {"minimize":SW_MINIMIZE,"maximize":SW_MAXIMIZE,"restore":SW_RESTORE}[params.action])
    elif params.action == "foreground": await asyncio.to_thread(_bring_to_foreground, hwnd)
    else:
        screen_w, screen_h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1); current = window["bounds"]
        if params.action == "snap_left": x,y,w,h = 0,0,screen_w//2,screen_h
        elif params.action == "snap_right": x,y,w,h = screen_w//2,0,screen_w//2,screen_h
        else: x,y,w,h = params.x if params.x is not None else current["x"], params.y if params.y is not None else current["y"], params.width or current["width"], params.height or current["height"]
        win32gui.MoveWindow(hwnd, x, y, w, h, True)
    await asyncio.sleep(.2); final = next((w for w in await asyncio.to_thread(_windows) if w["handle"] == hwnd), None)
    verified = final is None if params.action == "close" else final is not None and ((params.action != "minimize" or final["minimized"]) and (params.action != "maximize" or final["maximized"]))
    if params.action in {"restore","foreground","move","resize","snap_left","snap_right"}: verified = final is not None
    message = "Window closed and its handle no longer exists." if params.action == "close" and verified else "Window state was observed after the action." if verified else "Window remains open, possibly because it is showing an unsaved-work dialog." if params.action == "close" else "Window state could not be verified."
    response = f"Closed {window['title']} gracefully." if params.action == "close" and verified else f"{params.action.replace('_',' ').title()} completed for {window['title']}." if verified else f"Windows did not verify the requested change for {window['title']}."
    return {"window": final, "action": params.action}, Verification(verified=verified, method="WM_CLOSE + window handle readback" if params.action == "close" else "Win32 window state readback", observed={"window": final or {}}, message=message), response
