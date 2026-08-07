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

- Full duplex SHREE voice conversation through the PC's Gemini Live session
- Open installed apps or URLs
- Media play/pause, next, previous, and stop
- Exact phone media volume
- Battery status and flashlight
- Open Wi-Fi, Bluetooth, display, sound, battery, and notification settings
- Clipboard write and permitted notification summaries
- Calls and prepared SMS messages with confirmation
- Alarms, camera, Android share sheet
- Optional visible-element clicking, focused-field typing, and coordinate taps through Accessibility
- Voice requests from the phone can use all existing permitted SHREE Windows tools

Android intentionally prevents silent Wi-Fi/Bluetooth toggling, private file access, app installation, account changes, and lock-screen bypass for ordinary apps. SHREE opens the official system UI or reports the limitation instead of claiming success.

## Build

Open this folder in Android Studio, install Android SDK 35, use JDK 17, and build the `app` module. The project uses Android Gradle Plugin 8.7.3 and Gradle 8.9 compatibility. A public APK/AAB must be signed with Ayush's release keystore; never commit that keystore or its passwords.

The app reuses `../src/assets/branding/shree-mark.png` at build time so desktop and Android branding stay synchronized.
