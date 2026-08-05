# Shree — Mark 12

Shree is a Windows desktop AI assistant created by Ayush and built in-place from the original Google AI Studio voice companion. Mark 12 combines an Electron/React desktop interface with a local FastAPI service, Gemini Live voice, SQLite persistence, secure Windows automation, MCP connectivity, and a permission-aware plugin foundation.

See [PRIVACY.md](PRIVACY.md) for the application's data-handling behavior and public-release requirements.

## Run from source

Requirements: Windows 10/11 x64, Node.js 22+, and [uv](https://docs.astral.sh/uv/).

```powershell
npm.cmd install
uv sync --project backend
npm.cmd run dev
```

Copy `.env.example` to `.env` for development, or enter the Gemini key in SHREE Settings. The desktop settings route stores the key in Windows Credential Manager; it is never exposed through the settings API.

## Build the Windows installer

```powershell
npm.cmd run package:win
```

This builds the React application, freezes the Python service into a standalone executable, packages Electron, and creates a versioned NSIS installer under `release-<version>/`. The installed app does not require Node.js, Python, or uv.

## Implemented architecture

- Electron 43 main process with context isolation, sandboxed renderers, a strict preload bridge, system tray, startup registration, notifications, backend crash restart, external-link validation, and generic-provider auto-update support.
- Floating Companion is the default normal-use surface: a frameless draggable avatar with remembered multi-monitor position, edge snapping, always-on-top and fullscreen behavior, compact voice/type controls, live subtitles, reminders, active-app awareness, and one-click access to the full interface. The companion and full app never keep competing voice sessions open.
- React 19, TypeScript, TailwindCSS, Motion, Gemini Live audio streaming, interruption handling, transcripts, voice visualization, settings, memory manager, and reminders.
- FastAPI/WebSocket local service bound to `127.0.0.1`, with rotating logs, SQLite WAL storage, FTS5 memory search, persistent reminders/history/settings/audit data, and a standalone PyInstaller build.
- When memory is enabled, stable preferences and explicitly requested memories save locally without a second prompt. Every memory deletion uses a single-use destructive confirmation token.
- Typed Windows tools cover exact Core Audio volume, per-app audio sessions, application discovery/control, window management, cancellable keyboard/mouse input, UI Automation, file operations, Recycle Bin deletion, local screen capture/inspection, clipboard, Windows media sessions, brightness/status, and opt-in confirmed power/session transitions.
- Every tool returns its permission level, execution data, an independent verification result, a human response, and duration. Failed or unverified tools never report success.
- Emergency Stop in the main interface plus a configurable global shortcut. It cancels active tool tasks and interrupts character-by-character typing.
- MCP stdio initialization and tool discovery, plus validated permission-declaring plugin manifests.

## External production configuration

- `GEMINI_API_KEY`: Gemini Live access. Prefer the in-app Credential Manager UI.
- `SHREE_UPDATE_URL`: HTTPS base URL containing electron-builder update artifacts.
- `CSC_LINK` and `CSC_KEY_PASSWORD`: Authenticode certificate used by electron-builder for a trusted public release.

Gemini Live is a preview service and session/model availability can change. The model can be overridden with `GEMINI_LIVE_MODEL` without changing code. Transient opening-handshake failures receive a longer timeout and three bounded retries; authentication and policy errors are never retried blindly.

## Verification

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:backend
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) for the trust boundaries and extension model.
See [DESKTOP_CONTROL.md](DESKTOP_CONTROL.md) for the complete tool contract and supported Windows behavior.
