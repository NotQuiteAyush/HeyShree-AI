from __future__ import annotations
import asyncio
import ctypes
from ctypes import wintypes
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from pywinauto import Desktop, keyboard, mouse
import win32gui
import win32api
from .base import ToolContext, Verification
from .applications import window_matches

user32 = ctypes.windll.user32
INPUT_KEYBOARD, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 1, 0x0002, 0x0004

ULONG_PTR = wintypes.WPARAM

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]
class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]
class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]
class INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]
class INPUT(ctypes.Structure): _anonymous_ = ("u",); _fields_ = [("type", wintypes.DWORD), ("u", INPUT_UNION)]

def active_window() -> dict:
    hwnd=win32gui.GetForegroundWindow()
    return {"handle":int(hwnd),"title":win32gui.GetWindowText(hwnd)}

def cursor_position() -> tuple[int, int]:
    x, y = win32api.GetCursorPos()
    return int(x), int(y)

def _editable_target(hwnd: int):
    window = Desktop(backend="uia").window(handle=hwnd)
    candidates = []
    for control_type in ("Document", "Edit"):
        try: candidates.extend(window.descendants(control_type=control_type))
        except Exception: pass
    candidates = [item for item in candidates if item.is_visible() and item.is_enabled()]
    focused = []
    for item in candidates:
        try:
            if item.has_keyboard_focus(): focused.append(item)
        except Exception: pass
    target = focused[0] if focused else candidates[0] if len(candidates) == 1 else None
    if target is not None and not focused:
        target.set_focus()
    return target, len(candidates)

def prepare_text_target(hwnd: int) -> dict:
    target, candidate_count = _editable_target(hwnd)
    if target is None:
        return {"identified": False, "candidate_count": candidate_count}
    return {"identified": True, "candidate_count": candidate_count, "control_type": target.element_info.control_type, "name": target.window_text()}

def set_empty_text_target(hwnd: int, text: str) -> dict:
    """Write through UIA only when existing user content cannot be overwritten."""
    target, candidate_count = _editable_target(hwnd)
    if target is None:
        return {"applied": False, "verified": False, "reason": "no unambiguous editable target", "candidate_count": candidate_count}
    try:
        current = str(target.iface_value.CurrentValue)
    except Exception as error:
        return {"applied": False, "verified": False, "reason": f"ValuePattern unavailable: {error}", "candidate_count": candidate_count}
    if current:
        return {"applied": False, "verified": False, "reason": "editor is not empty", "candidate_count": candidate_count}
    target.iface_value.SetValue(text)
    observed = str(target.iface_value.CurrentValue)
    return {"applied": True, "verified": observed == text, "observed_length": len(observed), "candidate_count": candidate_count}

class TypeTextParams(BaseModel):
    text: str = Field(
        min_length=1,
        max_length=50_000,
        description="Literal Unicode text only. Do not place key expressions such as {ENTER} in this value.",
    )
    target_application: str = Field(min_length=1, max_length=300, description="Expected active window title or application")
    interval_ms: int = Field(default=2, ge=0, le=1000)
    submit: bool = Field(default=False, description="Press the real Enter key once after typing the text")

    @model_validator(mode="after")
    def normalize_trailing_submit_key(self):
        # Older model calls sometimes appended a pywinauto key expression to
        # Unicode text. Convert only an unambiguous trailing submit token so a
        # browser never receives the visible string "youtube.com{ENTER}".
        stripped = self.text.rstrip()
        upper = stripped.upper()
        for token in ("{ENTER}", "{RETURN}"):
            if upper.endswith(token):
                self.text = stripped[:-len(token)].rstrip()
                self.submit = True
                if not self.text:
                    raise ValueError("text must contain literal content before the submit key")
                break
        return self

class PressKeysParams(BaseModel):
    keys: str = Field(min_length=1, max_length=200, description="Validated pywinauto key expression, such as ^s or {TAB}")
    target_application: str | None = Field(default=None, max_length=300)

class WindowsSearchParams(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    launch_first_result: bool = False

class MouseActionParams(BaseModel):
    action: Literal["position", "move", "move_relative", "click", "double_click", "right_click", "scroll", "drag", "click_element"]
    x: int | None = None; y: int | None = None; end_x: int | None = None; end_y: int | None = None
    dx: int | None = Field(default=None, ge=-10_000, le=10_000); dy: int | None = Field(default=None, ge=-10_000, le=10_000)
    wheel_dist: int = Field(default=0, ge=-100, le=100)
    element_name: str | None = Field(default=None, max_length=300)
    control_type: str | None = Field(default=None, max_length=100)
    highlight: bool = True
    @model_validator(mode="after")
    def required_coordinates(self):
        if self.action in {"move","click","double_click","right_click","drag"} and (self.x is None or self.y is None): raise ValueError("x and y are required")
        if self.action == "move_relative" and self.dx is None and self.dy is None: raise ValueError("dx or dy is required for move_relative")
        if self.action == "drag" and (self.end_x is None or self.end_y is None): raise ValueError("end_x and end_y are required for drag")
        if self.action == "click_element" and not self.element_name: raise ValueError("element_name is required")
        return self

def _unicode_units(char: str) -> list[int]:
    codepoint = ord(char)
    if codepoint <= 0xFFFF:
        return [codepoint]
    return [0xD800 + ((codepoint - 0x10000) >> 10), 0xDC00 + ((codepoint - 0x10000) & 0x3FF)]

def _unicode_unit(unit: int, key_up: bool = False):
    flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if key_up else 0)
    item = INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(0, unit, flags, 0, 0))
    if user32.SendInput(1, ctypes.byref(item), ctypes.sizeof(INPUT)) != 1: raise ctypes.WinError()

def _unicode_key(char: str, key_up: bool = False):
    for unit in _unicode_units(char):
        _unicode_unit(unit, key_up)

async def type_text(params: TypeTextParams, context: ToolContext):
    before = await asyncio.to_thread(active_window)
    if not window_matches({"title": before["title"], "process": ""}, params.target_application):
        raise ValueError(f"Active window is '{before['title']}', not the confirmed target '{params.target_application}'")
    try:
        field = await asyncio.wait_for(asyncio.to_thread(prepare_text_target, before["handle"]), timeout=3)
    except TimeoutError:
        field = {"identified": False, "candidate_count": 0, "fallback": "UI Automation inspection timed out; foreground target was retained"}
    if not field["identified"] and field["candidate_count"] > 1:
        raise ValueError(f"The target window has {field['candidate_count']} editable fields and none is focused; refusing to guess where to type")
    try:
        direct = await asyncio.wait_for(asyncio.to_thread(set_empty_text_target, before["handle"], params.text), timeout=5)
    except TimeoutError:
        direct = {"applied": False, "verified": False, "reason": "UI Automation ValuePattern timed out"}
    if direct.get("applied"):
        if params.submit:
            context.ensure_active()
            await asyncio.to_thread(keyboard.send_keys, "{ENTER}", pause=.03)
            await asyncio.sleep(.2)
        after = await asyncio.to_thread(active_window)
        verified = bool(direct.get("verified")) and after["handle"] == before["handle"]
        execution = {"characters_sent": len(params.text), "submitted": params.submit, "target": after, "field": field, "input_method": "UI Automation ValuePattern", "readback": direct}
        verification = Verification(verified=verified, method="UI Automation ValuePattern write + exact readback + optional Enter + foreground-window continuity", observed={"characters_sent": len(params.text), "submitted": params.submit, "active_window": after, "field": field, "readback": direct}, message="The empty editor accepted the complete text and the requested submit key was dispatched." if verified and params.submit else "The empty editor accepted the complete text and exact UI Automation readback matched." if verified else "UI Automation wrote the editor, but exact readback or foreground verification failed.")
        return execution, verification, f"Typed and submitted {len(params.text)} character(s) in {after['title']}." if verified and params.submit else f"Typed and verified {len(params.text)} character(s) in {after['title']}." if verified else "The editor write could not be fully verified."
    typed = 0
    # Dispatch key-down and key-up separately. Modern Notepad's text host can
    # coalesce packet pairs emitted by the same worker into repeated glyphs.
    for char in params.text:
        context.ensure_active()
        await asyncio.to_thread(_unicode_key, char, False)
        await asyncio.to_thread(_unicode_key, char, True)
        typed += 1
        if params.interval_ms:
            await asyncio.sleep(params.interval_ms / 1000)
    if params.submit:
        context.ensure_active()
        await asyncio.to_thread(keyboard.send_keys, "{ENTER}", pause=.03)
        await asyncio.sleep(.2)
    after = await asyncio.to_thread(active_window); verified = after["handle"] == before["handle"] and typed == len(params.text)
    return {"characters_sent": typed, "submitted": params.submit, "target": after, "field": field, "input_method": "Unicode SendInput fallback", "readback": direct}, Verification(verified=verified, method="UI Automation field targeting + Unicode SendInput + optional Enter + foreground-window continuity", observed={"characters_sent": typed, "submitted": params.submit, "active_window": after, "field": field, "direct_write": direct}, message="All Unicode key events and the requested submit key were accepted while the confirmed window remained active." if verified and params.submit else "All Unicode key events were accepted while the confirmed field and window remained active." if verified else "The active window changed during typing."), f"Typed and submitted {typed} character(s) in {after['title']}." if verified and params.submit else f"Typed {typed} character(s) into {after['title']}." if verified else f"Typing stopped after {typed} character(s) because the target changed."

async def press_keys(params: PressKeysParams, context: ToolContext):
    context.ensure_active(); before = await asyncio.to_thread(active_window)
    if params.target_application and not window_matches({"title": before["title"], "process": ""}, params.target_application): raise ValueError(f"Active window is '{before['title']}', not '{params.target_application}'")
    await asyncio.to_thread(keyboard.send_keys, params.keys, pause=.03, with_spaces=True)
    after = await asyncio.to_thread(active_window); verified = after["handle"] == before["handle"]
    return {"keys": params.keys, "target": after}, Verification(verified=verified, method="Foreground-window continuity after SendInput", observed={"active_window": after}, message="Key sequence was sent to the same foreground window." if verified else "Foreground window changed during the shortcut."), f"Sent {params.keys} to {after['title']}." if verified else "The shortcut was sent, but the target window changed before verification."

async def search_windows(params: WindowsSearchParams, context: ToolContext):
    context.ensure_active(); before = await asyncio.to_thread(active_window)
    await asyncio.to_thread(keyboard.send_keys, "{VK_LWIN}", pause=.05)
    await asyncio.sleep(.35)
    for char in params.query:
        context.ensure_active(); await asyncio.to_thread(_unicode_key, char, False); await asyncio.to_thread(_unicode_key, char, True)
    await asyncio.sleep(.4)
    search_window = await asyncio.to_thread(active_window)
    if params.launch_first_result:
        await asyncio.to_thread(keyboard.send_keys, "{ENTER}", pause=.05)
        await asyncio.sleep(.8)
    final = await asyncio.to_thread(active_window)
    verified = len(params.query) > 0 and (search_window["handle"] != before["handle"] or final["handle"] != before["handle"])
    observed = {"query": params.query, "search_window": search_window, "final_window": final, "launched": params.launch_first_result}
    return observed, Verification(verified=verified, method="Windows key + Unicode SendInput + foreground-window readback", observed=observed, message="Windows Search opened and received the query." if verified else "The query was sent, but Windows Search activation could not be verified."), f"Searched Windows for {params.query}{' and opened the first result' if params.launch_first_result else ''}." if verified else "Windows Search did not expose a verifiable foreground window."

async def mouse_action(params: MouseActionParams, context: ToolContext):
    context.ensure_active()
    if params.action == "position":
        point = cursor_position(); observed={"x":point[0],"y":point[1]}
        return observed, Verification(verified=True, method="GetCursorPos", observed=observed, message="Cursor position read."), f"Cursor is at {point[0]}, {point[1]}."
    if params.action == "click_element":
        element = Desktop(backend="uia").window(active_only=True).child_window(title_re=f".*{params.element_name}.*", control_type=params.control_type).wrapper_object()
        if params.highlight: element.draw_outline(colour="red", thickness=3); await asyncio.sleep(.35); context.ensure_active()
        element.click_input(); observed={"name":element.window_text(),"control_type":element.element_info.control_type,"rectangle":str(element.rectangle())}
        return observed, Verification(verified=True, method="UI Automation element lookup and click_input completion", observed=observed, message="UI Automation located and invoked the element."), f"Clicked {element.window_text() or params.element_name}."
    if params.action == "move": mouse.move(coords=(params.x,params.y))
    elif params.action == "move_relative":
        current = cursor_position(); left=user32.GetSystemMetrics(76); top=user32.GetSystemMetrics(77); width=user32.GetSystemMetrics(78); height=user32.GetSystemMetrics(79)
        target=(max(left,min(left+width-1,current[0]+(params.dx or 0))),max(top,min(top+height-1,current[1]+(params.dy or 0))))
        mouse.move(coords=target)
    elif params.action == "click": mouse.click(coords=(params.x,params.y))
    elif params.action == "double_click": mouse.double_click(coords=(params.x,params.y))
    elif params.action == "right_click": mouse.right_click(coords=(params.x,params.y))
    elif params.action == "scroll":
        current=cursor_position(); mouse.scroll(coords=(params.x if params.x is not None else current[0], params.y if params.y is not None else current[1]), wheel_dist=params.wheel_dist)
    elif params.action == "drag": mouse.press(coords=(params.x,params.y)); context.ensure_active(); mouse.move(coords=(params.end_x,params.end_y)); mouse.release(coords=(params.end_x,params.end_y))
    point = cursor_position(); expected = target if params.action == "move_relative" else (params.end_x,params.end_y) if params.action == "drag" else (params.x,params.y); verified = params.action in {"click","double_click","right_click","scroll"} or (point[0],point[1])==expected
    observed={"x":point[0],"y":point[1]}
    return observed, Verification(verified=verified, method="Win32 cursor readback; click delivery cannot prove application semantics", observed=observed, message="Pointer position verified." if verified else "Pointer action was sent but semantic effect is unverified."), f"Mouse {params.action.replace('_',' ')} completed." if verified else "Mouse input was sent, but SHREE could not verify the application's response."
