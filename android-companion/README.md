# SHREE Companion for Android

SHREE Companion is the Android 10+ client for the SHREE Windows application. It is not a separate AI account: the paired phone uses the Gemini credential and conversation/tool runtime configured on the user's own PC.

## Pairing

1. Ensure the Android phone and Windows PC are online. They may use different Wi-Fi networks or mobile data when worldwide access is enabled in desktop SHREE.
2. In desktop SHREE, open **Settings → Android Companion → Create pairing QR**.
3. Open SHREE Companion and scan the QR.
4. Confirm the phone model displayed in desktop SHREE.
5. Grant only the Android permissions the user wants to use.

The QR expires in five minutes. Pairing requires both possession of its 256-bit secret and an explicit desktop approval. One SHREE installation permits one active phone; approving a replacement revokes the prior phone.

## Security model

- Every control and voice WebSocket payload is encrypted and authenticated with AES-256-GCM.
- Pairing and device keys are stored with Android Keystore-backed encrypted preferences and Windows Credential Manager.
- Encrypted messages expire after 60 seconds and replayed nonces are rejected.
- The private desktop API remains protected by Electron's random per-launch token even though the backend listens on the LAN for the companion.
- Calls, messages, sensitive typing, deletion, installs, and account/security changes require a fresh on-phone confirmation. Unsupported actions fail clearly.
- Accessibility is optional. It is only used for visible UI interaction when Android exposes no official API, and it cannot bypass the lock screen or Android permission system.
- Worldwide mode uses an authenticated relay for opaque, end-to-end encrypted frames. The relay never receives the pairing key or plaintext content, and the Windows-control port is never exposed directly to the internet.
- Local Wi-Fi/hotspot remains available as a fallback when worldwide access is disabled.

## Supported Android actions

- Full duplex voice and typed SHREE conversation through the PC's Gemini Live session
- Shared desktop memory, reminders, and recent conversation cache; the last sync remains readable offline and survives normal app updates
- Open/search installed apps, URLs, Google, YouTube, Maps searches, and navigation
- Media play, pause, next, previous, stop, exact volume, volume adjustment, mute, and unmute
- Screen brightness/orientation (after Android's Modify system settings grant)
- Battery/charging, storage, basic device information, last-known location, and flashlight
- Open Wi-Fi, Bluetooth, mobile-data, hotspot, airplane-mode, display, sound, battery, file, and notification settings
- Clipboard write and foreground-permitted reads; notification summaries and replies when the source notification supports Android inline reply
- Contact lookup, direct calls, prepared SMS, and prepared WhatsApp messages with fresh confirmation for sensitive actions
- Alarms, timers, calendar event creation/readback, camera, gallery, files, audio recorder, and Android share sheet
- Local phone notes plus the desktop-backed SHREE memory and reminder tools
- Optional visible-element clicking, focused-field typing, and coordinate taps through Accessibility
- Voice requests from the phone can use all existing permitted SHREE Windows tools

Android intentionally prevents ordinary apps from silently ending calls, force-closing other apps, toggling many connectivity settings, reading the clipboard in the background, accessing private files, installing apps, changing accounts, or bypassing the lock screen. SHREE opens the official system UI or reports the limitation instead of claiming success. WhatsApp and SMS use their official composer UI, so the user makes the final send in the destination app.

Continuous wake-word listening, an always-on overlay bubble, default-dialer call termination, and lock-screen voice are not enabled by the normal companion permissions. They require separate, prominently disclosed Android roles/services and battery-impact controls before release; do not represent them as available in the current build.

## Build

Open this folder in Android Studio, install Android SDK 35, use JDK 17, and build the `app` module. The project uses Android Gradle Plugin 8.7.3 and Gradle 8.9 compatibility. A public APK/AAB must be signed with Ayush's release keystore; never commit that keystore or its passwords.

The app reuses `../src/assets/branding/shree-mark.png` at build time so desktop and Android branding stay synchronized.
