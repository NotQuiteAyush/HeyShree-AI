!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Keep your Shree memories, settings, reminders, conversations, logs, and saved API credential?$\r$\n$\r$\nChoose Yes to keep them for a future installation. Choose No to remove all Shree user data from this Windows account." IDYES keepShreeData
  ExecWait '"$INSTDIR\resources\backend\shree-backend.exe" --purge-user-data'
  RMDir /r "$APPDATA\Shree"
  RMDir /r "$LOCALAPPDATA\shree-desktop-ai-updater"
keepShreeData:
!macroend
