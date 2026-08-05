from __future__ import annotations
import asyncio
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from pycaw.pycaw import AudioUtilities,EDataFlow
from .base import ToolContext, Verification

class EmptyParams(BaseModel): pass

class SetVolumeParams(BaseModel):
    percent: float = Field(description="Desired master volume percentage")
    @field_validator("percent", mode="before")
    @classmethod
    def clamp(cls, value): return max(0.0, min(100.0, float(value)))

class ChangeVolumeParams(BaseModel):
    amount: float = Field(gt=0, le=100)
    direction: Literal["increase", "decrease"]

class MuteParams(BaseModel):
    mode: Literal["mute", "unmute", "toggle"]

class ApplicationVolumeParams(BaseModel):
    application: str = Field(min_length=1, max_length=200)
    percent: float
    @field_validator("percent", mode="before")
    @classmethod
    def clamp(cls, value): return max(0.0, min(100.0, float(value)))

class AudioDeviceParams(BaseModel):
    flow: Literal["output", "input", "all"] = "all"

class SelectAudioDeviceParams(BaseModel):
    device: str = Field(min_length=1, max_length=300)
    flow: Literal["output", "input"]

def _master(): return AudioUtilities.GetSpeakers().EndpointVolume

async def get_system_volume(_: EmptyParams, context: ToolContext):
    context.ensure_active()
    endpoint = await asyncio.to_thread(_master)
    percent = round(await asyncio.to_thread(endpoint.GetMasterVolumeLevelScalar) * 100, 1)
    muted = bool(await asyncio.to_thread(endpoint.GetMute))
    observed = {"percent": percent, "muted": muted}
    return observed, Verification(verified=True, method="Windows Core Audio readback", observed=observed, message="Master endpoint state read successfully."), f"System volume is {percent:g}% and is {'muted' if muted else 'not muted'}."

async def set_system_volume(params: SetVolumeParams, context: ToolContext):
    context.ensure_active(); endpoint = await asyncio.to_thread(_master)
    await asyncio.to_thread(endpoint.SetMasterVolumeLevelScalar, params.percent / 100.0, None)
    final = round(await asyncio.to_thread(endpoint.GetMasterVolumeLevelScalar) * 100, 1)
    verified = abs(final - params.percent) <= 1.0
    result = {"requested_percent": params.percent, "final_percent": final}
    return result, Verification(verified=verified, method="Windows Core Audio set + readback", observed={"percent": final}, message="Readback matched the requested level." if verified else "Readback did not match the requested level."), f"System volume is now {final:g}%." if verified else f"Windows reported {final:g}% after requesting {params.percent:g}%."

async def change_system_volume(params: ChangeVolumeParams, context: ToolContext):
    endpoint = await asyncio.to_thread(_master); current = await asyncio.to_thread(endpoint.GetMasterVolumeLevelScalar) * 100
    target = current + params.amount if params.direction == "increase" else current - params.amount
    return await set_system_volume(SetVolumeParams(percent=target), context)

async def set_mute(params: MuteParams, context: ToolContext):
    context.ensure_active(); endpoint = await asyncio.to_thread(_master); before = bool(await asyncio.to_thread(endpoint.GetMute))
    desired = not before if params.mode == "toggle" else params.mode == "mute"
    await asyncio.to_thread(endpoint.SetMute, desired, None); final = bool(await asyncio.to_thread(endpoint.GetMute))
    verified = final == desired
    return {"requested_muted": desired, "muted": final}, Verification(verified=verified, method="Windows Core Audio mute readback", observed={"muted": final}, message="Mute state verified." if verified else "Mute state did not change."), f"System audio is {'muted' if final else 'unmuted'}."

async def set_application_volume(params: ApplicationVolumeParams, context: ToolContext):
    context.ensure_active(); query = params.application.lower(); matches = []
    for session in await asyncio.to_thread(AudioUtilities.GetAllSessions):
        process = session.Process
        if process and (query in process.name().lower() or query in str(process.exe()).lower()): matches.append(session)
    if not matches: raise ValueError(f"No active audio session matched '{params.application}'")
    for session in matches: await asyncio.to_thread(session.SimpleAudioVolume.SetMasterVolume, params.percent / 100.0, None)
    readings = [round(await asyncio.to_thread(session.SimpleAudioVolume.GetMasterVolume) * 100, 1) for session in matches]
    verified = all(abs(value - params.percent) <= 1 for value in readings)
    return {"application": params.application, "sessions": len(matches), "final_percentages": readings}, Verification(verified=verified, method="Core Audio session readback", observed={"percentages": readings}, message="All matching audio sessions were verified." if verified else "One or more sessions did not match."), f"Set {len(matches)} {params.application} audio session(s) to {params.percent:g}%."

async def list_audio_devices(params: AudioDeviceParams, context: ToolContext):
    context.ensure_active(); devices = []
    flows=[("output",EDataFlow.eRender.value),("input",EDataFlow.eCapture.value)] if params.flow=="all" else [(params.flow,EDataFlow.eRender.value if params.flow=="output" else EDataFlow.eCapture.value)]
    try: default_output=str((await asyncio.to_thread(AudioUtilities.GetSpeakers)).id)
    except Exception: default_output=""
    try: default_input=str((await asyncio.to_thread(AudioUtilities.GetMicrophone)).id)
    except Exception: default_input=""
    for flow,value in flows:
      for device in await asyncio.to_thread(AudioUtilities.GetAllDevices,value):
        state = getattr(device, "state", None); device_id=str(getattr(device,"id",""))
        devices.append({"id":device_id,"name":str(getattr(device,"FriendlyName","Unknown")),"flow":flow,"state":str(state),"default":device_id==(default_output if flow=="output" else default_input)})
    return {"devices": devices, "flow_filter": params.flow}, Verification(verified=True, method="Windows MMDevice enumeration", observed={"count": len(devices)}, message="Audio endpoint enumeration completed."), f"Found {len(devices)} Windows audio device(s)."

async def select_audio_device(params: SelectAudioDeviceParams, context: ToolContext):
    context.ensure_active()
    raise RuntimeError("Windows does not expose a supported public API for changing the system default audio endpoint. Open Sound Settings and select the device there; SHREE will not use the undocumented PolicyConfig COM interface.")
