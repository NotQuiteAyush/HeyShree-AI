const { contextBridge, ipcRenderer } = require('electron');

const companionToggleListeners = new Set();
let companionTogglePending = false;
ipcRenderer.on('companion:toggle-session', () => {
  if (!companionToggleListeners.size) {
    companionTogglePending = true;
    return;
  }
  for (const listener of companionToggleListeners) listener();
});

contextBridge.exposeInMainWorld('shreeDesktop', {
  platform: process.platform,
  backendToken: process.env.SHREE_BACKEND_TOKEN || '',
  version: () => ipcRenderer.invoke('app:version'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('app:launch-at-login', Boolean(enabled)),
  getLaunchAtLogin: () => ipcRenderer.invoke('app:get-launch-at-login'),
  showNotification: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),
  minimizeToTray: () => ipcRenderer.invoke('window:minimize-to-tray'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  setEmergencyShortcut: (accelerator) => ipcRenderer.invoke('app:set-emergency-shortcut', accelerator),
  setCompanionShortcut: (accelerator) => ipcRenderer.invoke('companion:set-activation-shortcut', accelerator),
  openMain: (section = 'chat') => ipcRenderer.invoke('companion:open-main', section),
  showCompanion: () => ipcRenderer.invoke('companion:show'),
  showCompanionContextMenu: () => ipcRenderer.invoke('companion:context-menu'),
  setCompanionClickThrough: (enabled) => ipcRenderer.invoke('companion:set-click-through', Boolean(enabled)),
  toggleCompanionSession: () => ipcRenderer.invoke('companion:toggle-session'),
  getCompanionSessionState: () => ipcRenderer.invoke('companion:get-session-state'),
  reportCompanionSessionState: (state) => ipcRenderer.invoke('companion:report-session-state', state),
  startCompanionDrag: () => ipcRenderer.invoke('companion:drag-start'),
  endCompanionDrag: () => ipcRenderer.invoke('companion:drag-end'),
  getPreferences: () => ipcRenderer.invoke('app:get-preferences'),
  updatePreferences: (values) => ipcRenderer.invoke('app:update-preferences', values),
  clearCache: () => ipcRenderer.invoke('app:clear-cache'),
  getUpdateState: () => ipcRenderer.invoke('app:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: (background = false) => ipcRenderer.invoke('app:download-update', Boolean(background)),
  cancelUpdateDownload: () => ipcRenderer.invoke('app:cancel-update-download'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  remindUpdateLater: () => ipcRenderer.invoke('app:remind-update-later'),
  skipUpdateVersion: () => ipcRenderer.invoke('app:skip-update-version'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('app:set-update-channel', channel),
  restart: () => ipcRenderer.invoke('app:restart'),
  onOpenSettings: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('app:open-settings', handler);
    return () => ipcRenderer.removeListener('app:open-settings', handler);
  },
  onOpenMemory: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:open-memory', handler);
    return () => ipcRenderer.removeListener('app:open-memory', handler);
  },
  onOpenReminders: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:open-reminders', handler);
    return () => ipcRenderer.removeListener('app:open-reminders', handler);
  },
  onCompanionToggleSession: (listener) => {
    companionToggleListeners.add(listener);
    if (companionTogglePending) {
      companionTogglePending = false;
      queueMicrotask(listener);
    }
    return () => companionToggleListeners.delete(listener);
  },
  onCompanionSessionState: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('companion:session-state', handler);
    return () => ipcRenderer.removeListener('companion:session-state', handler);
  },
  onCompanionPreferences: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('companion:preferences', handler);
    return () => ipcRenderer.removeListener('companion:preferences', handler);
  },
  onEmergencyStop: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('desktop:emergency-stop', handler);
    return () => ipcRenderer.removeListener('desktop:emergency-stop', handler);
  },
  onReminderDue: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('reminder:due', handler);
    return () => ipcRenderer.removeListener('reminder:due', handler);
  },
  onBackendState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('backend:state', handler);
    return () => ipcRenderer.removeListener('backend:state', handler);
  },
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
  onPrepareUpdate: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('update:prepare-install', handler);
    return () => ipcRenderer.removeListener('update:prepare-install', handler);
  },
});
