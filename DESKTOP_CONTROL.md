# Desktop control contract

SHREE maps natural-language requests to individual Gemini function declarations. It never converts unrestricted model text into PowerShell or a command line.

Each execution returns:

```json
{
  "tool_name": "set_system_volume",
  "permission_level": "safe",
  "status": "completed",
  "execution_result": {"requested_percent": 43, "final_percent": 43},
  "verification_result": {
    "verified": true,
    "method": "Windows Core Audio set + readback",
    "observed": {"percent": 43},
    "message": "Readback matched the requested level."
  },
  "human_response": "System volume is now 43%.",
  "duration_ms": 28
}
```

## Tool families

- Audio: `get_system_volume`, `set_system_volume`, `change_system_volume`, `set_system_mute`, `set_application_volume`, `list_audio_devices`, `select_audio_device`.
- Applications/windows: `find_application`, `open_application`, `set_application_alias`, `close_application`, `force_close_application`, `list_windows`, `control_window`.
- Input/UI Automation: `type_text`, `press_keys`, `mouse_action`.
- Files: `find_file`, `create_file`, `create_folder`, `copy_item`, `move_item`, `rename_item`, `overwrite_item`, `recycle_item`, `compress_item`, `extract_archive`.
- Screen/clipboard: `capture_screen`, `inspect_screen`, `clipboard_action`.
- Media/system: `media_action`, `get_system_status`, `change_windows_setting`, `shutdown_system`, `restart_system`, `lock_workstation`, `sign_out_user`, `switch_user`, `sleep_system`, `hibernate_system`, `cancel_power_action`.
- Memory deletion: `delete_memory`. Saving is immediate when memory is enabled; every deletion uses a single-use destructive confirmation token.

## Windows limitations handled explicitly

- Windows has no supported public API for programmatically changing the default playback or recording endpoint. `select_audio_device` reports this limitation instead of using the undocumented PolicyConfig COM interface.
- Brightness depends on a hardware WMI monitor-brightness provider. Unsupported external monitors return a structured failure.
- Verified media state requires an application exposing a Windows Global System Media Transport Controls session. If that Windows service is unavailable, SHREE can send a browser media command through `WM_APPCOMMAND` but reports it as unverified unless a media-session readback becomes available.
- Window enumeration and UI Automation only see applications on the current interactive Windows desktop and cannot bypass elevation boundaries.
- Browser search, website navigation, page analysis, YouTube control, and Discord Web control are not implemented. SHREE can still launch an installed browser as a normal Windows application, but it does not claim to control website content.

Sensitive tools ask unless their capability is explicitly set to “Allow” in Settings. Recycle, overwrite, force-close, memory deletion, and every power/session transition always require confirmation. The single Power & session controls switch is disabled by default; shutdown, restart, lock, sign out, switch user, sleep, and hibernate are absent from the AI tool list until enabled. Protected system directories are blocked, and ordinary create/copy operations refuse to overwrite.
