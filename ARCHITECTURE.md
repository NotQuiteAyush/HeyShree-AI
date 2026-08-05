# Architecture

```text
Electron main process
  ├─ hardened BrowserWindow + preload allow-list
  ├─ tray, notifications, startup, updater
  └─ supervised shree-backend.exe
          ├─ FastAPI REST + /live WebSocket (loopback only)
          ├─ Gemini Live server-to-server session
          ├─ agent tool policy + confirmation tokens
          ├─ Windows automation handlers
          ├─ MCP stdio clients + plugin discovery
          └─ SQLite WAL: memory, reminders, history, settings, audit

React renderer
  ├─ PCM microphone stream (16 kHz) → /live
  ├─ PCM speech playback (24 kHz) ← /live
  └─ typed local APIs; no Node.js or filesystem access
```

The Gemini API key remains in the backend process. Audio crosses the local WebSocket as base64 PCM and is forwarded server-to-server. Gemini receives the validated schema for each desktop tool rather than a generic command shell. Privileged work never executes in React. Sensitive and destructive requests are persisted as expiring single-use actions and must be confirmed through a separate call before the handler is invoked.

Every tool follows one envelope: tool name, validated parameters, permission level, execution result, verification result, human-readable response, status, and duration. A completed status requires `verification_result.verified=true`; failures and timeouts are structured results. The registry owns timeouts, permission checks, allowed-folder enforcement, audit redaction, pending confirmations, and emergency cancellation.

MCP servers use JSON-RPC 2.0 over stdio. SHREE performs `initialize`, sends `notifications/initialized`, and discovers tools with `tools/list`. Plugin folders live under `%LOCALAPPDATA%\SHREE\plugins`; their manifests are schema-validated and entrypoints must remain inside their plugin directory.

Floating Companion is a second sandboxed renderer surface, not a second assistant backend. Electron owns its multi-monitor position, work-area clamping, edge snapping, always-on-top state, fullscreen hiding, activation shortcut, and native menu. React selects the compact companion renderer through a trusted window-mode query. Opening either the full app or companion sends a suspend event to the other, releases its microphone/audio pipeline, and prevents competing Gemini Live sessions.
