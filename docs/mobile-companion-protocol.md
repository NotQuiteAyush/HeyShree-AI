# Mobile companion protocol v1

The desktop FastAPI service listens on `0.0.0.0` for the companion while Electron continues to access it through `127.0.0.1` with `X-Shree-Token`. Only `/mobile/pairing/request` and `/mobile/pairing/status` are public HTTP routes; both require an HMAC proof derived from the short-lived QR secret and are rate limited.

The compact QR contains a random pairing ID, future device ID, 32-byte key, reachable private IPv4 fallback endpoints, an authenticated worldwide-relay descriptor, protocol version, and expiry. The phone proves possession, and the desktop user approves or denies the named device. Approval stores the key in OS credential storage and revokes any older device.

After approval:

- `/mobile/control/{device_id}` carries bidirectional tool messages.
- `/mobile/live/{device_id}` carries the same Gemini Live messages used by desktop voice.
- The first encrypted message is `hello` or `voice_hello` respectively.
- Every subsequent JSON message is wrapped as `{device_id,timestamp,nonce,ciphertext}`.
- `ciphertext` is AES-256-GCM over the compact JSON body, with `device_id|timestamp|nonce` as authenticated additional data.
- Timestamps have a 60-second window and nonces are accepted once.
- In worldwide mode the desktop and phone each make outbound WSS connections to a Durable Object relay. The relay authenticates each role, routes only opaque encrypted envelopes, never receives the AES key, and never exposes the Windows backend port to the internet.
- The Android client reconnects with bounded exponential backoff when Wi-Fi or mobile networks change. Local Wi-Fi/hotspot remains a fallback when worldwide mode is disabled.

PC-bound actions use the existing typed tool registry, permission decisions, confirmations, audit log, timeouts, and verification results. Phone-bound actions return an on-device result through the control socket. No layer converts unrestricted model text directly into shell or Android commands.
