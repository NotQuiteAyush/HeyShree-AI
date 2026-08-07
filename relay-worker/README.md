# SHREE end-to-end encrypted relay

Production endpoint: `https://shree-e2e-relay.shree-e2e-relay.workers.dev`

This Cloudflare Worker routes encrypted WebSocket frames between one SHREE desktop and its approved Android companion. The relay authenticates both endpoints but never receives the AES-GCM device key or plaintext message/audio content.

Deploy with `npm install` and `npm run deploy`, then place the resulting HTTPS URL in SHREE's release configuration. A production deployment requires a Cloudflare account and Durable Objects subscription. Do not substitute a temporary Quick Tunnel for public releases.

After deployment, run `../backend/.venv/Scripts/python.exe smoke_test.py` to verify bidirectional pairing, control, and live WebSocket lanes.
