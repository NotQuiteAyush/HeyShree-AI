from __future__ import annotations
import asyncio
import ctypes
import shutil
from ctypes import wintypes
from pathlib import Path
from typing import Literal
import psutil
from pydantic import BaseModel, Field
from .base import ToolContext, Verification

class EmptyParams(BaseModel): pass
class BrightnessParams(BaseModel): percent: int=Field(ge=0,le=100)
class WindowsSettingParams(BaseModel): setting: Literal["brightness","display_settings","sound_settings","microphone_settings","default_apps","network_settings","bluetooth_settings"]; percent:int|None=Field(default=None,ge=0,le=100)
class ShutdownParams(BaseModel):
    delay_seconds: int = Field(default=10, ge=5, le=300)

def _wmi_brightness_values() -> list[int]:
    """Read integrated-display brightness through the official Windows WMI API."""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        service = win32com.client.GetObject(
            r"winmgmts:{impersonationLevel=impersonate}!\\.\root\WMI"
        )
        return [
            int(item.CurrentBrightness)
            for item in service.ExecQuery("SELECT CurrentBrightness FROM WmiMonitorBrightness")
        ]
    finally:
        pythoncom.CoUninitialize()


def _set_wmi_brightness(percent: int) -> int:
    """Set every integrated display exposed by WmiMonitorBrightnessMethods."""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        service = win32com.client.GetObject(
            r"winmgmts:{impersonationLevel=impersonate}!\\.\root\WMI"
        )
        methods = list(service.ExecQuery("SELECT * FROM WmiMonitorBrightnessMethods"))
        changed = 0
        last_error: Exception | None = None
        for method in methods:
            try:
                definition = method.Methods_("WmiSetBrightness")
                parameters = definition.InParameters.SpawnInstance_()
                parameters.Properties_.Item("Timeout").Value = 1
                parameters.Properties_.Item("Brightness").Value = int(percent)
                result = method.ExecMethod_("WmiSetBrightness", parameters)
                # Some WMI providers return no output object on success; COM
                # still raises for a rejected call, and the API read-back below
                # remains the source of truth.
                return_value = 0 if result is None else int(result.Properties_.Item("ReturnValue").Value or 0)
                if return_value != 0:
                    raise RuntimeError(f"WMI returned error {return_value}")
                changed += 1
            except Exception as error:
                last_error = error
        if changed:
            return changed
        if last_error:
            raise last_error
        return 0
    finally:
        pythoncom.CoUninitialize()


class _PhysicalMonitor(ctypes.Structure):
    _fields_ = [
        ("handle", wintypes.HANDLE),
        ("description", wintypes.WCHAR * 128),
    ]


def _physical_monitor_brightness(*, set_percent: int | None = None) -> list[int]:
    """Read or set DDC/CI monitors using Windows' High-Level Monitor API."""
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    dxva2 = ctypes.WinDLL("dxva2", use_last_error=True)
    monitors: list[int] = []
    callback_type = ctypes.WINFUNCTYPE(
        wintypes.BOOL,
        wintypes.HANDLE,
        wintypes.HDC,
        ctypes.POINTER(wintypes.RECT),
        wintypes.LPARAM,
    )

    @callback_type
    def collect(handle, _dc, _rect, _data):
        monitors.append(int(handle))
        return True

    user32.EnumDisplayMonitors.argtypes = [
        wintypes.HDC,
        ctypes.POINTER(wintypes.RECT),
        callback_type,
        wintypes.LPARAM,
    ]
    user32.EnumDisplayMonitors.restype = wintypes.BOOL
    dxva2.GetNumberOfPhysicalMonitorsFromHMONITOR.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.DWORD),
    ]
    dxva2.GetNumberOfPhysicalMonitorsFromHMONITOR.restype = wintypes.BOOL
    dxva2.GetPhysicalMonitorsFromHMONITOR.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(_PhysicalMonitor),
    ]
    dxva2.GetPhysicalMonitorsFromHMONITOR.restype = wintypes.BOOL
    dxva2.GetMonitorBrightness.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD),
    ]
    dxva2.GetMonitorBrightness.restype = wintypes.BOOL
    dxva2.SetMonitorBrightness.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    dxva2.SetMonitorBrightness.restype = wintypes.BOOL
    dxva2.DestroyPhysicalMonitors.argtypes = [
        wintypes.DWORD,
        ctypes.POINTER(_PhysicalMonitor),
    ]
    dxva2.DestroyPhysicalMonitors.restype = wintypes.BOOL
    if not user32.EnumDisplayMonitors(None, None, collect, 0):
        raise ctypes.WinError(ctypes.get_last_error())

    values: list[int] = []
    for monitor in monitors:
        count = wintypes.DWORD()
        if not dxva2.GetNumberOfPhysicalMonitorsFromHMONITOR(
            wintypes.HANDLE(monitor), ctypes.byref(count)
        ) or not count.value:
            continue
        physical = (_PhysicalMonitor * count.value)()
        if not dxva2.GetPhysicalMonitorsFromHMONITOR(
            wintypes.HANDLE(monitor), count, physical
        ):
            continue
        try:
            for item in physical:
                minimum, current, maximum = wintypes.DWORD(), wintypes.DWORD(), wintypes.DWORD()
                if not dxva2.GetMonitorBrightness(
                    item.handle,
                    ctypes.byref(minimum),
                    ctypes.byref(current),
                    ctypes.byref(maximum),
                ):
                    continue
                span = maximum.value - minimum.value
                if span <= 0:
                    continue
                if set_percent is not None:
                    raw = minimum.value + round(span * set_percent / 100)
                    if not dxva2.SetMonitorBrightness(item.handle, raw):
                        continue
                    current.value = raw
                values.append(round((current.value - minimum.value) * 100 / span))
        finally:
            dxva2.DestroyPhysicalMonitors(count, physical)
    return values


async def get_brightness() -> int:
    errors: list[str] = []
    for reader in (_wmi_brightness_values, _physical_monitor_brightness):
        try:
            values = await asyncio.to_thread(reader)
            if values:
                return round(sum(values) / len(values))
        except Exception as error:
            errors.append(str(error))
    detail = next((item for item in errors if item), "no controllable display was reported")
    raise RuntimeError(f"Windows brightness control is unavailable: {detail}")


async def set_brightness(percent: int) -> str:
    errors: list[str] = []
    try:
        changed = await asyncio.to_thread(_set_wmi_brightness, percent)
        if changed:
            return "Windows WMI brightness API"
    except Exception as error:
        errors.append(str(error))
    try:
        values = await asyncio.to_thread(_physical_monitor_brightness, set_percent=percent)
        if values:
            return "Windows High-Level Monitor Configuration API"
    except Exception as error:
        errors.append(str(error))
    detail = next((item for item in errors if item), "the display exposes no software brightness control")
    raise RuntimeError(
        "Windows cannot control brightness on this display. "
        f"The laptop panel or monitor may not expose WMI/DDC brightness control: {detail}"
    )

async def get_system_status(_:EmptyParams,context:ToolContext):
    context.ensure_active(); battery=psutil.sensors_battery(); root=Path.home().anchor; disk=shutil.disk_usage(root); network=psutil.net_if_stats()
    try: brightness=await get_brightness()
    except Exception: brightness=None
    observed={"battery":{"percent":battery.percent,"charging":bool(battery.power_plugged),"seconds_left":battery.secsleft} if battery else None,"brightness_percent":brightness,
              "storage":{"root":root,"total":disk.total,"used":disk.used,"free":disk.free},"network_interfaces":[{"name":name,"up":state.isup,"speed_mbps":state.speed} for name,state in network.items()]}
    return observed,Verification(verified=True,method="Windows battery WMI/psutil, disk and adapter APIs",observed={"battery_available":battery is not None,"brightness_available":brightness is not None,"interfaces":len(network)},message="System status APIs queried."),"Read battery, brightness, storage, and network status."

async def change_windows_setting(params:WindowsSettingParams,context:ToolContext):
    context.ensure_active()
    if params.setting=="brightness":
        if params.percent is None: raise ValueError("percent is required")
        method = await set_brightness(params.percent)
        final = params.percent
        for _ in range(4):
            await asyncio.sleep(.18)
            final = await get_brightness()
            if abs(final - params.percent) <= 2:
                break
        verified=abs(final-params.percent)<=2
        return {"requested_percent":params.percent,"final_percent":final,"api":method},Verification(verified=verified,method=f"{method} set + API readback",observed={"percent":final},message="Brightness readback matched." if verified else "Brightness readback differed."),f"Screen brightness is now {final}%." if verified else f"Windows reported brightness {final}% after the change."
    uris={"display_settings":"ms-settings:display","sound_settings":"ms-settings:sound","microphone_settings":"ms-settings:privacy-microphone","default_apps":"ms-settings:defaultapps","network_settings":"ms-settings:network-status","bluetooth_settings":"ms-settings:bluetooth"}
    uri=uris[params.setting]; code=ctypes.windll.shell32.ShellExecuteW(None,"open",uri,None,None,1); await asyncio.sleep(.4); verified=code>32
    return {"uri":uri,"shell_result":code},Verification(verified=verified,method="Windows ShellExecute return code",observed={"uri":uri,"code":code},message="Windows accepted the settings URI." if verified else "ShellExecute rejected the settings URI."),f"Opened {params.setting.replace('_',' ')}." if verified else f"Windows could not open {params.setting.replace('_',' ')}."

def _enable_shutdown_privilege() -> None:
    class Luid(ctypes.Structure):
        _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]

    token = wintypes.HANDLE()
    luid = Luid()

    class LuidAndAttributes(ctypes.Structure):
        _fields_ = [("Luid", Luid), ("Attributes", wintypes.DWORD)]

    class TokenPrivileges(ctypes.Structure):
        _fields_ = [("PrivilegeCount", wintypes.DWORD), ("Privileges", LuidAndAttributes * 1)]

    advapi32 = ctypes.windll.advapi32
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(Luid)]
    advapi32.LookupPrivilegeValueW.restype = wintypes.BOOL
    advapi32.AdjustTokenPrivileges.argtypes = [wintypes.HANDLE, wintypes.BOOL, ctypes.POINTER(TokenPrivileges), wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    advapi32.AdjustTokenPrivileges.restype = wintypes.BOOL
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0020 | 0x0008, ctypes.byref(token)):
        raise ctypes.WinError()
    try:
        if not advapi32.LookupPrivilegeValueW(None, "SeShutdownPrivilege", ctypes.byref(luid)):
            raise ctypes.WinError()
        privileges = TokenPrivileges(1, (LuidAndAttributes(luid, 0x00000002),))
        ctypes.set_last_error(0)
        if not advapi32.AdjustTokenPrivileges(token, False, ctypes.byref(privileges), 0, None, None):
            raise ctypes.WinError()
        if ctypes.get_last_error() == 1300:
            raise PermissionError("Windows did not grant the shutdown privilege to SHREE")
    finally:
        kernel32.CloseHandle(token)

async def _schedule_power_off(params: ShutdownParams, context: ToolContext, *, restart: bool):
    context.ensure_active()
    await asyncio.to_thread(_enable_shutdown_privilege)
    action = "restart" if restart else "shut down"
    message = f"Shree is about to {action} this PC after your confirmed request."
    initiate = ctypes.windll.advapi32.InitiateSystemShutdownExW
    initiate.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.BOOL, wintypes.DWORD]
    initiate.restype = wintypes.BOOL
    accepted = bool(await asyncio.to_thread(
        initiate,
        None, message, params.delay_seconds, True, restart, 0x80000000,
    ))
    if not accepted:
        raise ctypes.WinError()
    return (
        {"accepted": True, "action": "restart" if restart else "shutdown", "delay_seconds": params.delay_seconds},
        Verification(
            verified=True,
            method="Windows InitiateSystemShutdownExW return value",
            observed={"accepted": True, "restart": restart, "delay_seconds": params.delay_seconds},
            message=f"Windows accepted the scheduled {action} request. The final transition cannot be observed because Shree disconnects with Windows.",
        ),
        f"Windows accepted the confirmed {action} request. This PC will {action} in {params.delay_seconds} seconds.",
    )


async def shutdown_system(params: ShutdownParams, context: ToolContext):
    return await _schedule_power_off(params, context, restart=False)


async def restart_system(params: ShutdownParams, context: ToolContext):
    return await _schedule_power_off(params, context, restart=True)


async def cancel_power_action(_: EmptyParams, context: ToolContext):
    context.ensure_active()
    await asyncio.to_thread(_enable_shutdown_privilege)
    abort = ctypes.windll.advapi32.AbortSystemShutdownW
    abort.argtypes = [wintypes.LPCWSTR]
    abort.restype = wintypes.BOOL
    accepted = bool(await asyncio.to_thread(abort, None))
    if not accepted:
        raise RuntimeError("Windows reported that there is no cancellable shutdown request")
    return (
        {"cancelled": True},
        Verification(verified=True, method="Windows AbortSystemShutdownW return value", observed={"cancelled": True}, message="Windows accepted the pending shutdown or restart cancellation."),
        "Cancelled the pending Windows shutdown or restart.",
    )


async def cancel_shutdown(params: EmptyParams, context: ToolContext):
    """Backward-compatible alias retained for older Shree clients."""
    return await cancel_power_action(params, context)


async def lock_workstation(_: EmptyParams, context: ToolContext):
    context.ensure_active()
    lock = ctypes.windll.user32.LockWorkStation
    lock.argtypes = []
    lock.restype = wintypes.BOOL
    accepted = bool(await asyncio.to_thread(lock))
    if not accepted:
        raise ctypes.WinError()
    observed = {"accepted": True, "action": "lock"}
    return observed, Verification(verified=True, method="Windows LockWorkStation return value", observed=observed, message="Windows accepted the workstation lock request."), "Windows accepted the confirmed lock request."


async def sign_out_user(_: EmptyParams, context: ToolContext):
    context.ensure_active()
    exit_windows = ctypes.windll.user32.ExitWindowsEx
    exit_windows.argtypes = [wintypes.UINT, wintypes.DWORD]
    exit_windows.restype = wintypes.BOOL
    accepted = bool(await asyncio.to_thread(exit_windows, 0x00000000, 0x80000000))
    if not accepted:
        raise ctypes.WinError()
    observed = {"accepted": True, "action": "sign_out"}
    return observed, Verification(verified=True, method="Windows ExitWindowsEx return value", observed=observed, message="Windows accepted the user sign-out request. Applications may still ask to save work."), "Windows accepted the confirmed sign-out request."


async def switch_user(_: EmptyParams, context: ToolContext):
    context.ensure_active()
    disconnect = ctypes.windll.wtsapi32.WTSDisconnectSession
    disconnect.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.BOOL]
    disconnect.restype = wintypes.BOOL
    accepted = bool(await asyncio.to_thread(disconnect, wintypes.HANDLE(0), wintypes.DWORD(0xFFFFFFFF), False))
    if not accepted:
        raise ctypes.WinError()
    observed = {"accepted": True, "action": "switch_user"}
    return observed, Verification(verified=True, method="Windows WTSDisconnectSession return value", observed=observed, message="Windows accepted the session-disconnect request and will show the sign-in screen."), "Windows accepted the confirmed switch-user request."


def _power_capability(hibernate: bool) -> bool:
    powrprof = ctypes.windll.powrprof
    check = powrprof.IsPwrHibernateAllowed if hibernate else powrprof.IsPwrSuspendAllowed
    check.argtypes = []
    check.restype = wintypes.BOOLEAN
    return bool(check())


def _set_suspend_state(hibernate: bool) -> bool:
    suspend = ctypes.windll.powrprof.SetSuspendState
    suspend.argtypes = [wintypes.BOOLEAN, wintypes.BOOLEAN, wintypes.BOOLEAN]
    suspend.restype = wintypes.BOOLEAN
    return bool(suspend(hibernate, False, False))


async def _suspend_system(context: ToolContext, *, hibernate: bool):
    context.ensure_active()
    action = "hibernate" if hibernate else "sleep"
    if not await asyncio.to_thread(_power_capability, hibernate):
        raise RuntimeError(f"Windows reports that {action} is not supported on this computer")

    # SetSuspendState normally returns only after the machine resumes. Run it
    # on a worker so the request can be handed to Windows without freezing the
    # backend's event loop. An immediate False result is treated as failure.
    transition = asyncio.create_task(asyncio.to_thread(_set_suspend_state, hibernate))
    done, _ = await asyncio.wait({transition}, timeout=0.75)
    if done and not transition.result():
        raise ctypes.WinError()
    if not done:
        transition.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
    observed = {"accepted": True, "action": action, "supported": True, "api_call_in_progress": not bool(done)}
    return observed, Verification(verified=True, method="Windows power-capability check + SetSuspendState API handoff", observed=observed, message=f"Windows supports {action} and did not reject the power-transition request. Final state is not observable while Shree is suspended."), f"Windows accepted the confirmed {action} request."


async def sleep_system(_: EmptyParams, context: ToolContext):
    return await _suspend_system(context, hibernate=False)


async def hibernate_system(_: EmptyParams, context: ToolContext):
    return await _suspend_system(context, hibernate=True)
