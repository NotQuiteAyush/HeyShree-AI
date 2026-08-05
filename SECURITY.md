# Security model

- The service binds only to `127.0.0.1`; browser origins are allow-listed.
- Electron uses `contextIsolation`, renderer sandboxing, no Node integration, denied pop-up creation, and a small typed preload API.
- API secrets are written to Windows Credential Manager and never returned by the backend.
- Long-term personal memory requires an explicit `consent: true` request.
- Recycle Bin operations, overwrite operations, and force-close actions require a random one-time token that expires after five minutes. Every accepted or denied action is audited.
- SHREE intentionally exposes no lock, sleep, restart, or shutdown tools.
- File tools refuse protected Windows and Program Files directories and can be restricted to explicit user-selected roots.
- Keyboard and text input verify the foreground target before sending input. Text is sent incrementally so Emergency Stop can interrupt it.
- Optional clipboard history is disabled by default and filters likely passwords, OTPs, tokens, secrets, and API keys.
- Application launch is allow-listed. Commands are argument arrays and are not passed through a command shell.
- Web fetching validates every redirect and rejects non-public IP addresses, credentials in URLs, unsupported content, and bodies larger than 3 MB.
- The embedded web viewer omits `allow-same-origin`, preventing proxied scripts from escaping the iframe sandbox.
- MCP and plugin capabilities are not treated as trusted merely because they are installed; their declared permissions must be surfaced before activation.

For public releases, sign the installer and executable with an Authenticode certificate and serve update artifacts over HTTPS. Never commit `.env`, the SQLite database, logs, build caches, or signing credentials.
