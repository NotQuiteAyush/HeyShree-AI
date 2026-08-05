# Shree Mark 12 privacy summary

Shree is a local Windows desktop application created by Ayush. This document describes the behavior of version 1.1.39; it is not a substitute for the terms of the external services a user chooses to connect.

## Data that stays on the computer

- Settings, conversations, reminders, memories, audit records, and logs are stored under the current Windows user's local Shree data directory.
- Gemini API keys are stored in Windows Credential Manager and are not written to Shree's settings database, logs, memory, or packaged source.
- Desktop automation, screen capture, clipboard operations, file access, and Windows control are performed locally.
- Floating desktop awareness reads the foreground process name and window title locally. It is disabled by default, and proactive suggestions require a separate opt-in. It does not capture the screen.
- Shree contains no product analytics, advertising SDK, or telemetry service.

## Data sent outside the computer

- During an active Gemini Live voice session, microphone audio, conversation context, enabled memories, and necessary structured tool results are sent to Google Gemini for processing. Screen captures remain local unless the user separately shares them through another configured integration.
- Plugins and MCP servers can communicate with the sites or services explicitly configured for those features.
- Shree does not provide an external cloud account or cloud memory service of its own.

## User controls

- AI, voice, memory, screen understanding, desktop control, clipboard access, plugins, and MCP connections can be disabled in Settings.
- Floating Companion can be disabled entirely; always-on-top, fullscreen hiding, opacity, click-through, subtitles, awareness, animations, voice volume, and its activation shortcut are individually configurable.
- Stored memories can be viewed, edited, exported, deleted individually, or cleared.
- Chat history, logs, permissions, and cache can be cleared from Settings.
- Destructive and privileged desktop actions retain confirmation requirements.

Before public distribution, the publisher should add contact information and links to the final hosted privacy policy and support page.
