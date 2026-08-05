from __future__ import annotations
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Literal
import mss
from PIL import Image
from pydantic import BaseModel, Field, model_validator
import win32gui
from .base import ToolContext, Verification
from .input import active_window
from ..config import get_settings

class CaptureScreenParams(BaseModel):
    mode: Literal["all", "active_window", "region"] = "all"
    path: str | None = Field(default=None,max_length=2000)
    x: int | None=None; y: int | None=None; width: int | None=Field(default=None,gt=0); height: int | None=Field(default=None,gt=0)
    @model_validator(mode="after")
    def region(self):
        if self.mode=="region" and None in (self.x,self.y,self.width,self.height): raise ValueError("x, y, width, and height are required")
        return self
class InspectScreenParams(BaseModel):
    max_elements: int = Field(default=100,ge=1,le=500)

def _window_rect(hwnd:int):
    left,top,right,bottom=win32gui.GetWindowRect(hwnd)
    return {"left":left,"top":top,"width":right-left,"height":bottom-top}

async def capture_screen(params: CaptureScreenParams, context: ToolContext):
    context.ensure_active(); destination=Path(params.path or (get_settings().data_dir/"screenshots"/f"screen-{datetime.now():%Y%m%d-%H%M%S}.png")).expanduser().resolve(); destination.parent.mkdir(parents=True,exist_ok=True)
    def capture():
        with mss.mss() as source:
            box=source.monitors[0] if params.mode=="all" else _window_rect(win32gui.GetForegroundWindow()) if params.mode=="active_window" else {"left":params.x,"top":params.y,"width":params.width,"height":params.height}
            shot=source.grab(box); Image.frombytes("RGB",shot.size,shot.rgb).save(destination); return shot.size
    size=await asyncio.to_thread(capture); verified=destination.is_file() and destination.stat().st_size>0
    return {"path":str(destination),"width":size.width,"height":size.height,"mode":params.mode}, Verification(verified=verified,method="Desktop Duplication capture + PNG file readback",observed={"exists":verified,"bytes":destination.stat().st_size if verified else 0},message="Screenshot file verified." if verified else "Screenshot file missing."), f"Saved a {params.mode.replace('_',' ')} screenshot to {destination}." if verified else "Screenshot could not be verified."

def _inspect(limit:int):
    active=active_window(); elements=[]
    screenshot_dir=get_settings().data_dir/"screenshots"
    screenshot_dir.mkdir(parents=True,exist_ok=True)
    screenshot_path=screenshot_dir/f"inspection-{datetime.now():%Y%m%d-%H%M%S-%f}.jpg"
    screenshot={"path":str(screenshot_path),"width":0,"height":0,"captured":False}
    try:
        with mss.mss() as source:
            handle=int(active.get("handle") or 0)
            rect=_window_rect(handle) if handle else source.monitors[0]
            if rect["width"]<=0 or rect["height"]<=0: rect=source.monitors[0]
            shot=source.grab(rect)
            image=Image.frombytes("RGB",shot.size,shot.rgb)
            captured_width, captured_height = image.width, image.height
            image.thumbnail((1280,1280),Image.Resampling.LANCZOS)
            image.save(screenshot_path,format="JPEG",quality=78,optimize=True)
            screenshot.update({"width":image.width,"height":image.height,"capture_width":captured_width,"capture_height":captured_height,"origin_x":rect["left"],"origin_y":rect["top"],"captured":screenshot_path.is_file() and screenshot_path.stat().st_size>0})
    except Exception as error:
        screenshot["error"]=str(error)
    # Native child-window enumeration is bounded and does not stall on large
    # Chromium accessibility trees. Modern custom-drawn controls are understood
    # from the attached image; native controls also contribute metadata here.
    try:
        if not active.get("handle"): raise ValueError("No foreground application exposed native controls")
        def append_child(hwnd,_):
            if len(elements)>=limit: return False
            left,top,right,bottom=win32gui.GetWindowRect(hwnd)
            text=win32gui.GetWindowText(hwnd).strip()
            class_name=win32gui.GetClassName(hwnd)
            if text or class_name:
                elements.append({"name":text,"control_type":class_name,"automation_id":"","rectangle":f"(L{left}, T{top}, R{right}, B{bottom})","enabled":bool(win32gui.IsWindowEnabled(hwnd)),"visible":bool(win32gui.IsWindowVisible(hwnd))})
            return len(elements)<limit
        win32gui.EnumChildWindows(active["handle"],append_child,None)
    except Exception as error: active["accessibility_error"]=str(error)
    return active,elements,screenshot

async def inspect_screen(params: InspectScreenParams, context: ToolContext):
    context.ensure_active(); active,elements,screenshot=await asyncio.to_thread(_inspect,params.max_elements)
    verified=bool(screenshot["captured"])
    inspected_name=active["title"] or "the visible desktop"
    return {"active_window":active,"elements":elements,"screenshot":screenshot}, Verification(verified=verified,method="Win32 foreground window/control metadata + attached JPEG screenshot",observed={"active_window":active,"element_count":len(elements),"screenshot_captured":screenshot["captured"],"screenshot_size":{"width":screenshot["width"],"height":screenshot["height"]}},message="Active application, native control metadata, and visual screenshot inspected." if verified else "Screen inspection could not capture a verified active-window image."), f"Inspected {inspected_name} with {len(elements)} native control element(s) and attached its current screenshot." if verified else "The active window could not be fully inspected."
