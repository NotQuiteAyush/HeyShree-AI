from __future__ import annotations
import asyncio
import re
from typing import Literal
import win32clipboard
from pydantic import BaseModel, Field
from .base import ToolContext, Verification
from ..database import connect,utcnow
from ..settings_store import get_setting

class ClipboardParams(BaseModel):
    action: Literal["read_text", "write_text", "clear", "history", "clear_history"]
    text: str | None = Field(default=None, max_length=1_000_000)

def _read():
    win32clipboard.OpenClipboard()
    try:
        if not win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT): return None
        return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
    finally: win32clipboard.CloseClipboard()

def _write(text: str):
    win32clipboard.OpenClipboard()
    try: win32clipboard.EmptyClipboard(); win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
    finally: win32clipboard.CloseClipboard()

def _clear():
    win32clipboard.OpenClipboard()
    try: win32clipboard.EmptyClipboard()
    finally: win32clipboard.CloseClipboard()

async def clipboard_action(params: ClipboardParams, context: ToolContext):
    context.ensure_active()
    if params.action=="history":
        async with connect() as db:
            cursor=await db.execute("SELECT id,content,created_at FROM clipboard_history ORDER BY id DESC LIMIT 50"); items=[dict(row) for row in await cursor.fetchall()]
        return {"items":items},Verification(verified=True,method="Local SQLite clipboard history",observed={"count":len(items)},message="Clipboard history read."),f"Found {len(items)} local clipboard history item(s)."
    if params.action=="clear_history":
        async with connect() as db: await db.execute("DELETE FROM clipboard_history"); await db.commit(); cursor=await db.execute("SELECT count(*) count FROM clipboard_history"); count=(await cursor.fetchone())["count"]
        return {},Verification(verified=count==0,method="SQLite delete + count readback",observed={"count":count},message="Clipboard history cleared."),"Cleared local clipboard history."
    if params.action == "read_text":
        text = await asyncio.to_thread(_read); observed={"has_text":text is not None,"length":len(text or ""),"text":text}
        if text: await _maybe_remember(text)
        return observed, Verification(verified=True, method="Win32 clipboard Unicode format", observed={"has_text":text is not None,"length":len(text or "")}, message="Clipboard format was read."), "Read clipboard text." if text is not None else "The clipboard does not contain text."
    if params.action == "write_text":
        if params.text is None: raise ValueError("text is required for write_text")
        await asyncio.to_thread(_write, params.text); final=await asyncio.to_thread(_read); verified=final==params.text
        if verified: await _maybe_remember(params.text)
        return {"length":len(params.text)}, Verification(verified=verified, method="Win32 clipboard write + readback", observed={"length":len(final or "")}, message="Clipboard text matched." if verified else "Clipboard readback differed."), f"Copied {len(params.text)} character(s) to the clipboard." if verified else "Clipboard write could not be verified."
    await asyncio.to_thread(_clear); final=await asyncio.to_thread(_read); verified=final is None
    return {}, Verification(verified=verified, method="Win32 clipboard clear + format readback", observed={"has_text":final is not None}, message="Clipboard is empty." if verified else "Clipboard still contains text."), "Cleared the clipboard." if verified else "Windows did not confirm the clipboard was cleared."

async def _maybe_remember(text:str):
    enabled = await get_setting("clipboard_history_enabled", False)
    if not enabled:return
    async with connect() as db:
        sensitive=bool(re.search(r"(?i)(password|passwd|api[_ -]?key|secret|token|otp|cvv|authorization)\s*[:=]",text)) or bool(re.fullmatch(r"\d{6}",text.strip()))
        if sensitive or len(text)>20_000:return
        await db.execute("INSERT INTO clipboard_history(content,created_at) VALUES(?,?)",(text,utcnow())); await db.execute("DELETE FROM clipboard_history WHERE id NOT IN (SELECT id FROM clipboard_history ORDER BY id DESC LIMIT 100)"); await db.commit()
