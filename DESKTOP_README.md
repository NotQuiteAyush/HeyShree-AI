# Shree Mark 12 Windows installation

The generated installer is `release-1.1.39/Shree-Setup-1.1.39-x64.exe`.

1. Run the installer and select an installation directory.
2. Launch SHREE from the Start menu or desktop shortcut.
3. Open Settings and confirm that Gemini is configured. If not, paste a current Gemini API key; SHREE stores it in Windows Credential Manager.
4. Enable “Run when Windows starts” if desired.
5. In Settings → Desktop Control, choose per-capability permissions and allowed file folders, then test tools with the built-in schema-aware tester. The single Power & session controls switch enables shutdown, restart, lock, sign out, switch user, sleep, and hibernate; each request still needs explicit confirmation.

The default emergency shortcut is `Ctrl+Alt+Shift+Escape`. The red Stop button and shortcut immediately cancel active desktop workflows and typing.

Floating Companion is enabled by default after setup. Closing the full window returns to the companion instead of ending SHREE. Single-click the avatar for quick controls, double-click it for the full app, right-click for the companion menu, or use `Ctrl+Alt+Space` to show Shree and start listening. All companion behavior can be changed under Settings â†’ Floating Companion. Local data is stored under `%LOCALAPPDATA%\SHREE`; uninstalling the application does not silently delete memories or settings.

Public distribution should be Authenticode-signed. Configure `CSC_LINK` and `CSC_KEY_PASSWORD` before `npm.cmd run package:win`. Configure `SHREE_UPDATE_URL` to an HTTPS electron-builder update feed to enable automatic update checks.
