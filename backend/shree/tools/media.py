from __future__ import annotations
import asyncio
from typing import Literal
from pydantic import BaseModel,Field
import win32gui
from winrt.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
)
from .base import ToolContext,Verification
from .applications import _bring_to_foreground,_windows

WM_APPCOMMAND=0x0319
APP_COMMANDS={"next":11,"previous":12,"stop":13,"toggle":14,"play":46,"pause":47,"seek_forward":49,"seek_backward":50}

class MediaActionParams(BaseModel):
    action:Literal["status","play","pause","toggle","stop","next","previous","seek_forward","seek_backward"]
    seconds:int=Field(default=10,ge=1,le=3600)

async def _current():
    manager=await GlobalSystemMediaTransportControlsSessionManager.request_async(); session=manager.get_current_session()
    if not session: raise RuntimeError("No application is exposing a Windows media session")
    return session

def _playback_status_name(value)->str:
    try:
        return GlobalSystemMediaTransportControlsSessionPlaybackStatus(int(value)).name.lower()
    except (TypeError,ValueError):
        return str(value).split(".")[-1].lower()

async def _snapshot(session):
    properties=await session.try_get_media_properties_async(); playback=session.get_playback_info(); timeline=session.get_timeline_properties()
    status=_playback_status_name(playback.playback_status)
    return {"source":session.source_app_user_model_id,"title":properties.title,"artist":properties.artist,"album":properties.album_title,
            "status":status,"position_seconds":round(timeline.position.total_seconds(),1),"end_seconds":round(timeline.end_time.total_seconds(),1)}

def _browser_media_fallback(action:str):
    browsers=[item for item in _windows() if item.get("process","").casefold() in {"chrome.exe","msedge.exe","firefox.exe"}]
    if not browsers: raise RuntimeError("Windows media sessions are unavailable and no browser window is open for a fallback media command")
    foreground=win32gui.GetForegroundWindow(); target=next((item for item in browsers if item["handle"]==foreground),browsers[0])
    _bring_to_foreground(target["handle"])
    result=win32gui.SendMessage(target["handle"],WM_APPCOMMAND,target["handle"],APP_COMMANDS[action]<<16)
    return {"window":target,"app_command":APP_COMMANDS[action],"send_result":int(result)}

async def media_action(params:MediaActionParams,context:ToolContext):
    context.ensure_active()
    try:
        session=await _current(); before=await _snapshot(session)
    except Exception as session_error:
        if params.action=="status":
            raise RuntimeError(f"Windows media-session status is unavailable: {session_error}") from session_error
        fallback=await asyncio.to_thread(_browser_media_fallback,params.action)
        await asyncio.sleep(.35)
        try:
            session=await _current(); after=await _snapshot(session)
        except Exception:
            return {"fallback":fallback,"media_session_error":str(session_error)},Verification(verified=False,method="WM_APPCOMMAND browser fallback; Windows media-session readback unavailable",observed=fallback,message="The Windows browser media command was sent, but this PC does not expose a media session for state verification."),f"Sent media {params.action.replace('_',' ')} to {fallback['window']['title']}, but Windows did not expose the final playback state, so I cannot confirm it succeeded."
        verified=(params.action=="play" and after["status"]=="playing") or (params.action in {"pause","stop"} and after["status"] in {"paused","stopped"})
        return {"fallback":fallback,"after":after},Verification(verified=verified,method="WM_APPCOMMAND browser fallback + Windows media-session readback",observed=after,message="The fallback media state change was verified." if verified else "The fallback command was sent, but its requested state was not observed."),f"Media {params.action.replace('_',' ')} completed for {after['title']}." if verified else f"Could not verify media {params.action.replace('_',' ')}."
    if params.action=="status": return before,Verification(verified=True,method="Windows Global System Media Transport Controls",observed=before,message="Current media session read."),f"{before['title'] or 'Media'} by {before['artist'] or 'unknown artist'} is {before['status']}."
    if params.action=="play": accepted=await session.try_play_async()
    elif params.action=="pause": accepted=await session.try_pause_async()
    elif params.action=="toggle":
        accepted=await (session.try_pause_async() if before["status"]=="playing" else session.try_play_async())
    elif params.action=="stop":
        accepted=await session.try_stop_async()
        if not accepted:
            # Chrome/Edge/YouTube commonly expose pause but not a distinct stop.
            # Pausing is the closest supported, reversible transport action.
            accepted=await session.try_pause_async()
    elif params.action=="next": accepted=await session.try_skip_next_async()
    elif params.action=="previous": accepted=await session.try_skip_previous_async()
    else:
        offset=params.seconds*(10_000_000 if params.action=="seek_forward" else -10_000_000); target=max(0,int(session.get_timeline_properties().position.total_seconds()*10_000_000)+offset); accepted=await session.try_change_playback_position_async(target)
    await asyncio.sleep(.3); after=await _snapshot(session)
    if params.action=="play": verified=after["status"]=="playing"
    elif params.action=="pause": verified=after["status"] in {"paused","stopped"}
    elif params.action=="toggle": verified=(before["status"]=="playing" and after["status"] in {"paused","stopped"}) or (before["status"]!="playing" and after["status"]=="playing")
    elif params.action=="stop": verified=after["status"] in {"paused","stopped"}
    elif params.action=="seek_forward": verified=after["position_seconds"]>before["position_seconds"]
    elif params.action=="seek_backward": verified=after["position_seconds"]<before["position_seconds"]
    else: verified=bool(accepted) and (after["title"]!=before["title"] or after["position_seconds"]!=before["position_seconds"])
    response = f"Media {params.action.replace('_',' ')} completed for {after['title']}." if verified else f"Could not verify media {params.action.replace('_',' ')}."
    if params.action=="stop" and verified and after["status"]=="paused":
        response=f"Paused {after['title']}; this browser media session does not expose a separate stop state."
    return {"accepted":bool(accepted),"before":before,"after":after},Verification(verified=verified,method="Windows GSMTC command + media-session readback",observed=after,message="Media state change verified." if verified else "The media session accepted the command but the requested state change was not observed."),response
