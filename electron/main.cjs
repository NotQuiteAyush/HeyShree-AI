const { app, BrowserWindow, Menu, Notification, Tray, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require('electron');
const log = require('electron-log');
const { ShreeUpdater } = require('./updater.cjs');
const { spawn, spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { pathToFileURL } = require('url');

const PRODUCT_NAME = 'Shree';
const PRODUCT_LABEL = 'Shree — Mark 12';
const WINDOWS_APP_USER_MODEL_ID = 'ai.shree.mark12';
const BRAND_ASSET_DIR = path.join('src', 'assets', 'branding');

function brandAssetPath(filename) {
  return path.join(app.getAppPath(), BRAND_ASSET_DIR, filename);
}

const REQUESTED_BACKEND_PORT = Number(process.env.SHREE_BACKEND_PORT || 8765);
let backendPort = REQUESTED_BACKEND_PORT;
let backendUrl = process.env.SHREE_BACKEND_URL || `http://127.0.0.1:${backendPort}`;
let mainWindow;
let companionWindow;
let tray;
let backendProcess;
let quitting = false;
let restartCount = 0;
let reminderMonitor;
let reminderPollActive = false;
let reminderPollFailures = 0;
let fullscreenMonitor;
let companionSnapTimer;
let companionDragTimer;
let registeredEmergencyShortcut;
let registeredCompanionShortcut;
let updater;
let setupRequiredAtStartup = false;
let companionHiddenForFullscreen = false;
let latestCompanionSessionState = { state: 'idle', audioLevel: 0, muted: false, caption: '', captionRole: null };
let pendingCompanionToggle = false;
const backendToken = process.env.SHREE_BACKEND_TOKEN || (process.env.SHREE_BACKEND_URL ? '' : randomBytes(32).toString('base64url'));
if (backendToken) process.env.SHREE_BACKEND_TOKEN = backendToken;

app.setName(PRODUCT_NAME);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => revealMainWindow());

function sendToMainWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) return false;
  contents.send(channel, payload);
  return true;
}

function sendToCompanion(channel, payload) {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  const contents = companionWindow.webContents;
  if (!contents || contents.isDestroyed()) return false;
  contents.send(channel, payload);
  return true;
}

function requestCompanionSessionToggle() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.webContents.isLoadingMainFrame()) {
    pendingCompanionToggle = true;
    return true;
  }
  return sendToMainWindow('companion:toggle-session');
}

function broadcastToRenderers(channel, payload) {
  const mainDelivered = sendToMainWindow(channel, payload);
  const companionDelivered = sendToCompanion(channel, payload);
  return mainDelivered || companionDelivered;
}

function revealMainWindow(section = 'chat') {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return false;
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.hide();
  }
  mainWindow.show();
  mainWindow.focus();
  if (section === 'settings' || section === 'updates') sendToMainWindow('app:open-settings', { section });
  if (section === 'memory') sendToMainWindow('app:open-memory');
  if (section === 'reminders') sendToMainWindow('app:open-reminders');
  return true;
}

const desktopPreferencesPath = path.join(app.getPath('userData'), 'desktop-preferences.json');
const desktopPreferenceDefaults = {
  minimize_to_tray: true,
  start_minimized: false,
  remember_window_position: true,
  check_updates_automatically: true,
  automatic_download_updates: false,
  automatic_install_updates: false,
  update_channel: 'stable',
  update_skipped_version: null,
  update_remind_after: null,
  last_update_check: null,
  pending_update_version: null,
  update_history: [],
  notifications_enabled: true,
  hardware_acceleration: true,
  background_cpu_limit: 50,
  memory_usage_limit_mb: 1024,
  cache_size_mb: 256,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  floating_mode_enabled: true,
  start_in_floating_mode: false,
  floating_always_on_top: true,
  floating_auto_hide_fullscreen: true,
  floating_avatar_size: 'Medium',
  floating_opacity: 96,
  floating_click_through_idle: false,
  floating_show_subtitles: true,
  floating_show_speech_bubble: true,
  floating_idle_animations: true,
  floating_lip_sync: true,
  floating_desktop_awareness: false,
  floating_proactive_suggestions: false,
  floating_voice_volume: 82,
  floating_edge_snapping: true,
  floating_animation_quality: 'Balanced',
  floating_activation_shortcut: 'CommandOrControl+Alt+Space',
};

function readDesktopPreferences() {
  try { return { ...desktopPreferenceDefaults, ...JSON.parse(fs.readFileSync(desktopPreferencesPath, 'utf8')) }; }
  catch { return { ...desktopPreferenceDefaults }; }
}

function writeDesktopPreferences(next) {
  desktopPreferences = { ...desktopPreferences, ...next };
  fs.mkdirSync(path.dirname(desktopPreferencesPath), { recursive: true });
  fs.writeFileSync(desktopPreferencesPath, JSON.stringify(desktopPreferences, null, 2), { encoding: 'utf8', mode: 0o600 });
  return desktopPreferences;
}

let desktopPreferences = readDesktopPreferences();
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
if (!desktopPreferences.hardware_acceleration) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disk-cache-size', String(Math.max(32, Number(desktopPreferences.cache_size_mb) || 256) * 1024 * 1024));
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${Math.max(256, Number(desktopPreferences.memory_usage_limit_mb) || 1024)}`);

function inQuietHours() {
  if (!desktopPreferences.quiet_hours_enabled) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value) => { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; };
  const start = parse(desktopPreferences.quiet_hours_start), end = parse(desktopPreferences.quiet_hours_end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

log.initialize();

function backendHealth() {
  return new Promise((resolve) => {
    const headers = backendToken ? { 'X-Shree-Token': backendToken } : {};
    const request = http.get(`${backendUrl}/api/health`, { timeout: 1200, headers }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

function backendPost(pathname) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': 0, ...(backendToken ? { 'X-Shree-Token': backendToken } : {}) };
    const request = http.request(`${backendUrl}${pathname}`, { method: 'POST', headers, timeout: 2000 }, (response) => {
      let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => response.statusCode < 300 ? resolve(body ? JSON.parse(body) : {}) : reject(new Error(`Backend returned ${response.statusCode}`)));
    });
    request.on('error', reject); request.on('timeout', () => { request.destroy(); reject(new Error('Backend timeout')); }); request.end();
  });
}

function backendGet(pathname, timeout = 1800) {
  return new Promise((resolve, reject) => {
    const headers = backendToken ? { 'X-Shree-Token': backendToken } : {};
    const request = http.get(`${backendUrl}${pathname}`, { timeout, headers }, (response) => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => response.statusCode < 300 ? resolve(body ? JSON.parse(body) : {}) : reject(new Error(`Backend returned ${response.statusCode}`)));
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Backend timeout')); });
  });
}

async function prepareForUpdateInstall() {
  try {
    const readiness = await backendGet('/api/system/update-readiness', 3000);
    if (!readiness.ready) return readiness;
    const prepared = await backendPost('/api/system/prepare-update');
    if (!prepared.ready) return prepared;
    broadcastToRenderers('update:prepare-install', { version: updater?.publicState().availableVersion || null });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return prepared;
  } catch (error) {
    return { ready: false, message: `Shree could not safely prepare for the update: ${String(error.message || error)}` };
  }
}

async function pollDueReminders() {
  if (quitting || reminderPollActive || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) return;
  reminderPollActive = true;
  try {
    const batch = await backendPost('/api/reminders/due');
    reminderPollFailures = 0;
    const quiet = inQuietHours();
    for (const reminder of batch.reminders || []) {
      let desktopNotificationShown = false;
      if (!quiet && batch.desktop_notifications && desktopPreferences.notifications_enabled && Notification.isSupported()) {
        const notification = new Notification({
          title: reminder.urgent ? 'Urgent Shree Reminder' : 'Shree Reminder',
          body: String(reminder.text).slice(0, 500),
          icon: brandAssetPath('shree-mark.png'),
        });
        notification.on('click', () => revealMainWindow('reminders'));
        notification.show();
        desktopNotificationShown = true;
      }
      const payload = {
        reminder,
        announce: !quiet && Boolean(batch.sound_notifications),
        language: batch.language || 'Auto',
      };
      const rendererDelivered = sendToMainWindow('reminder:due', payload);
      if (desktopPreferences.floating_mode_enabled && !mainWindow?.isVisible()) showCompanion({ reminder: true });
      log.info('Reminder fired', { id: reminder.id, desktopNotificationShown, rendererDelivered, quiet });
    }
  } catch (error) {
    reminderPollFailures += 1;
    if (reminderPollFailures === 1 || reminderPollFailures % 20 === 0) log.warn('Reminder monitor could not reach the backend', error);
  } finally {
    reminderPollActive = false;
  }
}

function startReminderMonitor() {
  if (reminderMonitor) clearInterval(reminderMonitor);
  reminderMonitor = setInterval(pollDueReminders, 3000);
  reminderMonitor.unref?.();
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function selectBackendEndpoint() {
  if (process.env.SHREE_BACKEND_URL) {
    log.info(`Using configured SHREE backend at ${backendUrl}`);
    return;
  }
  for (let port = REQUESTED_BACKEND_PORT; port < REQUESTED_BACKEND_PORT + 50; port += 1) {
    if (await portIsAvailable(port)) {
      backendPort = port;
      backendUrl = `http://127.0.0.1:${port}`;
      log.info(`Reserved local backend endpoint ${backendUrl}`);
      return;
    }
  }
  throw new Error('SHREE could not find an available local backend port');
}

function registerEmergencyShortcut(accelerator = 'CommandOrControl+Alt+Shift+Escape') {
  if (registeredEmergencyShortcut) globalShortcut.unregister(registeredEmergencyShortcut);
  const registered = globalShortcut.register(accelerator, async () => {
    try { await backendPost('/api/tools/emergency-stop'); } catch (error) { log.error('Emergency stop request failed', error); }
    broadcastToRenderers('desktop:emergency-stop');
    if (Notification.isSupported()) new Notification({ title: 'Shree automation stopped', body: 'Keyboard, mouse, and active desktop workflows were cancelled.', icon: brandAssetPath('shree-mark.png') }).show();
  });
  if (!registered) throw new Error(`Windows could not register shortcut: ${accelerator}`);
  registeredEmergencyShortcut = accelerator;
  return accelerator;
}

function registerCompanionShortcut(accelerator = 'CommandOrControl+Alt+Space') {
  if (registeredCompanionShortcut) globalShortcut.unregister(registeredCompanionShortcut);
  const registered = globalShortcut.register(accelerator, () => {
    if (!desktopPreferences.floating_mode_enabled) return revealMainWindow();
    showCompanion({ force: true });
    requestCompanionSessionToggle();
  });
  if (!registered) throw new Error(`Windows could not register companion shortcut: ${accelerator}`);
  registeredCompanionShortcut = accelerator;
  return accelerator;
}

function backendCommand() {
  if (process.env.SHREE_BACKEND_EXECUTABLE) return [process.env.SHREE_BACKEND_EXECUTABLE, []];
  if (app.isPackaged) return [path.join(process.resourcesPath, 'backend', 'shree-backend.exe'), []];
  const project = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(app.getAppPath(), 'backend');
  return ['uv', ['run', '--project', project, 'uvicorn', 'shree.main:app', '--host', '0.0.0.0', '--port', String(backendPort)]];
}

const MOBILE_FIREWALL_RULE = 'Shree Mobile Companion';

function backendExecutablePath() {
  return backendCommand()[0];
}

function mobileFirewallStatus() {
  if (process.platform !== 'win32') return { supported: false, allowed: true, port: backendPort };
  const result = spawnSync('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${MOBILE_FIREWALL_RULE}`, 'verbose'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const expectedProgram = backendExecutablePath().toLowerCase();
  return {
    supported: true,
    allowed: result.status === 0 && output.toLowerCase().includes(expectedProgram),
    port: backendPort,
  };
}

function allowMobileFirewallAccess() {
  if (process.platform !== 'win32') return Promise.resolve({ supported: false, allowed: true, port: backendPort });
  const executable = backendExecutablePath();
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw new Error('The packaged SHREE backend was not found. Install or unpack SHREE before enabling phone access.');
  }
  const escapedExecutable = executable.replaceAll("'", "''");
  const escapedRule = MOBILE_FIREWALL_RULE.replaceAll("'", "''");
  const script = [
    `$rule = '${escapedRule}'`,
    `$program = '${escapedExecutable}'`,
    `& netsh.exe advfirewall firewall delete rule name=\"$rule\" | Out-Null`,
    `& netsh.exe advfirewall firewall add rule name=\"$rule\" dir=in action=allow program=\"$program\" protocol=TCP remoteip=LocalSubnet profile=private,public enable=yes`,
    `exit $LASTEXITCODE`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `try { $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode } catch { if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }; exit 1 }`,
    ], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(mobileFirewallStatus());
      else reject(new Error(code === 1223 ? 'Windows administrator approval was cancelled.' : 'Windows could not allow SHREE through the firewall.'));
    });
  });
}

async function startBackend() {
  if (await backendHealth()) return;
  const [command, args] = backendCommand();
  backendProcess = spawn(command, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SHREE_DESKTOP: '1', SHREE_BACKEND_HOST: '0.0.0.0', SHREE_BACKEND_PORT: String(backendPort) },
  });
  backendProcess.stdout.on('data', (data) => log.info(`[backend] ${String(data).trim()}`));
  backendProcess.stderr.on('data', (data) => log.warn(`[backend] ${String(data).trim()}`));
  backendProcess.on('error', (error) => log.error('Backend failed to start', error));
  backendProcess.on('exit', (code) => {
    backendProcess = undefined;
    broadcastToRenderers('backend:state', { online: false, code });
    if (!quitting && restartCount < 3) {
      restartCount += 1;
      setTimeout(startBackend, Math.min(1000 * 2 ** restartCount, 8000));
    }
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await backendHealth()) {
      restartCount = 0;
      broadcastToRenderers('backend:state', { online: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('SHREE backend did not become healthy in time');
}

function stopBackend() {
  const processToStop = backendProcess;
  backendProcess = undefined;
  if (!processToStop?.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5000,
    });
    if (result.error) log.error('Could not stop the SHREE backend process tree', result.error);
    return;
  }
  if (!processToStop.killed) processToStop.kill();
}

function configureSessionSecurity() {
  const isTrustedAudioRequest = (webContents, permission, details = {}) => {
    const trustedWindow = (mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents)
      || (companionWindow && !companionWindow.isDestroyed() && webContents === companionWindow.webContents);
    if (!trustedWindow || permission !== 'media') return false;
    const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    return !mediaTypes.includes('video') && (mediaTypes.length === 0 || mediaTypes.includes('audio'));
  };
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => isTrustedAudioRequest(webContents, permission, details));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(isTrustedAudioRequest(webContents, permission, details)));
}

function rendererTarget(mode = 'main') {
  const target = process.env.SHREE_DEV_URL
    ? new URL(process.env.SHREE_DEV_URL)
    : pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html'));
  target.searchParams.set('backendUrl', backendUrl);
  if (mode === 'companion') target.searchParams.set('mode', 'companion');
  return target.toString();
}

const companionSizes = {
  Small: { width: 170, height: 220 },
  Medium: { width: 205, height: 260 },
  Large: { width: 240, height: 300 },
};

function companionSize() {
  return companionSizes[desktopPreferences.floating_avatar_size] || companionSizes.Medium;
}

function companionBoundsForDisplay(existing) {
  const size = companionSize();
  const display = existing
    ? screen.getDisplayMatching({ x: existing.x, y: existing.y, width: existing.width || size.width, height: existing.height || size.height })
    : screen.getPrimaryDisplay();
  const work = display.workArea;
  const requestedX = Number.isFinite(existing?.x) ? existing.x : work.x + work.width - size.width - 24;
  const requestedY = Number.isFinite(existing?.y) ? existing.y : work.y + work.height - size.height - 24;
  return {
    x: Math.max(work.x, Math.min(requestedX, work.x + work.width - size.width)),
    y: Math.max(work.y, Math.min(requestedY, work.y + work.height - size.height)),
    ...size,
  };
}

function snapCompanionToWorkArea() {
  if (!companionWindow || companionWindow.isDestroyed() || companionWindow.isMaximized()) return;
  const current = companionWindow.getBounds();
  const display = screen.getDisplayMatching(current);
  const work = display.workArea;
  const edge = 28;
  let x = Math.max(work.x, Math.min(current.x, work.x + work.width - current.width));
  let y = Math.max(work.y, Math.min(current.y, work.y + work.height - current.height));
  if (desktopPreferences.floating_edge_snapping) {
    if (Math.abs(x - work.x) <= edge) x = work.x;
    if (Math.abs((x + current.width) - (work.x + work.width)) <= edge) x = work.x + work.width - current.width;
    if (Math.abs(y - work.y) <= edge) y = work.y;
    if (Math.abs((y + current.height) - (work.y + work.height)) <= edge) y = work.y + work.height - current.height;
  }
  if (x !== current.x || y !== current.y) companionWindow.setPosition(x, y, true);
  writeDesktopPreferences({ companion_position: { x, y } });
}

function centerCompanionWindow() {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  const display = screen.getDisplayMatching(companionWindow.getBounds());
  const { x, y, width, height } = display.workArea;
  const size = companionSize();
  const nextX = Math.round(x + (width - size.width) / 2);
  const nextY = Math.round(y + (height - size.height) / 2);
  companionWindow.setPosition(nextX, nextY, true);
  writeDesktopPreferences({ companion_position: { x: nextX, y: nextY } });
  return true;
}

function applyCompanionPreferences() {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  companionWindow.setAlwaysOnTop(Boolean(desktopPreferences.floating_always_on_top), 'floating');
  companionWindow.setOpacity(Math.max(0.35, Math.min(1, Number(desktopPreferences.floating_opacity || 96) / 100)));
  const current = companionWindow.getBounds();
  const next = companionBoundsForDisplay(current);
  companionWindow.setBounds(next, true);
  sendToCompanion('companion:preferences', desktopPreferences);
  if (!desktopPreferences.floating_mode_enabled) companionWindow.hide();
}

function createCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) return companionWindow;
  const bounds = companionBoundsForDisplay(desktopPreferences.companion_position);
  const target = rendererTarget('companion');
  companionWindow = new BrowserWindow({
    ...bounds,
    minWidth: companionSizes.Small.width,
    minHeight: companionSizes.Small.height,
    maxWidth: companionSizes.Large.width,
    maxHeight: companionSizes.Large.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    show: false,
    hasShadow: false,
    title: 'Shree Companion',
    icon: nativeImage.createFromPath(brandAssetPath('shree-mark.png')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      backgroundThrottling: true,
    },
  });
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  companionWindow.setResizable(false);
  companionWindow.on('will-resize', (event) => event.preventDefault());
  companionWindow.once('ready-to-show', () => {
    applyCompanionPreferences();
    if (desktopPreferences.floating_mode_enabled && desktopPreferences.start_in_floating_mode && !mainWindow?.isVisible() && !setupRequiredAtStartup) companionWindow.showInactive();
  });
  companionWindow.on('move', () => {
    clearTimeout(companionSnapTimer);
    companionSnapTimer = setTimeout(snapCompanionToWorkArea, 350);
  });
  companionWindow.on('closed', () => {
    clearTimeout(companionSnapTimer);
    companionWindow = undefined;
  });
  companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  companionWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== target) event.preventDefault();
  });
  companionWindow.webContents.on('render-process-gone', (_event, details) => log.error('Companion renderer exited unexpectedly', details));
  companionWindow.webContents.once('did-finish-load', () => {
    sendToCompanion('companion:preferences', desktopPreferences);
    sendToCompanion('companion:session-state', latestCompanionSessionState);
    const screenshotPath = process.env.SHREE_SMOKE_SCREENSHOT;
    if (!screenshotPath) return;
    setTimeout(async () => {
      try {
        const image = await companionWindow.webContents.capturePage();
        fs.writeFileSync(screenshotPath, image.toPNG());
        log.info('Saved companion smoke screenshot', screenshotPath);
      } catch (error) {
        log.error('Could not save companion smoke screenshot', error);
      }
    }, 1400).unref?.();
  });
  companionWindow.loadURL(target).catch(error => log.error('Could not load floating companion', error));
  configureSessionSecurity();
  return companionWindow;
}

function showCompanion(options = {}) {
  if (quitting || !desktopPreferences.floating_mode_enabled || setupRequiredAtStartup) return false;
  if (mainWindow?.isVisible() && !options.force) return false;
  if (mainWindow?.isVisible() && options.force) mainWindow.hide();
  const target = createCompanionWindow();
  companionHiddenForFullscreen = false;
  if (!target.isDestroyed()) {
    target.setIgnoreMouseEvents(false);
    applyCompanionPreferences();
    target.showInactive();
    sendToCompanion('companion:session-state', options.reminder
      ? { ...latestCompanionSessionState, state: 'reminder' }
      : latestCompanionSessionState);
    if (options.reminder) setTimeout(() => sendToCompanion('companion:session-state', latestCompanionSessionState), 2200).unref?.();
  }
  return true;
}

async function monitorFullscreenWindow() {
  if (quitting || !desktopPreferences.floating_mode_enabled || !desktopPreferences.floating_auto_hide_fullscreen || mainWindow?.isVisible()) return;
  try {
    const active = await backendGet('/api/desktop/foreground', 1200);
    const isShree = String(active.process || '').toLowerCase().includes('shree') || String(active.title || '').startsWith(PRODUCT_NAME);
    if (active.fullscreen && !isShree) {
      if (companionWindow?.isVisible()) {
        companionHiddenForFullscreen = true;
        companionWindow.hide();
      }
    } else if (companionHiddenForFullscreen) {
      companionHiddenForFullscreen = false;
      showCompanion();
    }
  } catch (error) {
    log.debug('Fullscreen detection skipped', String(error));
  }
}

function startFullscreenMonitor() {
  if (fullscreenMonitor) clearInterval(fullscreenMonitor);
  fullscreenMonitor = setInterval(monitorFullscreenWindow, 1600);
  fullscreenMonitor.unref?.();
}

function createWindow() {
  const savedBounds = desktopPreferences.remember_window_position && desktopPreferences.window_bounds ? desktopPreferences.window_bounds : {};
  const target = rendererTarget('main');
  const windowIcon = nativeImage.createFromPath(brandAssetPath('shree-mark.png'));
  mainWindow = new BrowserWindow({
    width: savedBounds.width || 1440, height: savedBounds.height || 900,
    ...(Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y) ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1100, minHeight: 700,
    title: PRODUCT_LABEL, icon: windowIcon, backgroundColor: '#03050c', autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      backgroundThrottling: Number(desktopPreferences.background_cpu_limit) < 100,
    },
  });
  mainWindow.once('ready-to-show', () => {
    const startFloating = desktopPreferences.floating_mode_enabled && desktopPreferences.start_in_floating_mode && !setupRequiredAtStartup;
    if (!startFloating) {
      if (!desktopPreferences.start_minimized || setupRequiredAtStartup) mainWindow.show();
      else if (!desktopPreferences.minimize_to_tray) { mainWindow.show(); mainWindow.minimize(); }
    }
  });
  mainWindow.on('close', (event) => {
    if (!quitting && (desktopPreferences.minimize_to_tray || desktopPreferences.floating_mode_enabled)) {
      event.preventDefault();
      mainWindow.hide();
      showCompanion();
    }
    else quitting = true;
  });
  mainWindow.on('show', () => {
    if (companionWindow && !companionWindow.isDestroyed()) {
      companionWindow.hide();
    }
  });
  mainWindow.on('hide', () => {
    showCompanion();
  });
  const saveBounds = () => {
    const targetWindow = mainWindow;
    if (!desktopPreferences.remember_window_position || !targetWindow || targetWindow.isDestroyed() || targetWindow.isMinimized() || targetWindow.isMaximized()) return;
    clearTimeout(saveBounds.timer);
    saveBounds.timer = setTimeout(() => {
      if (!targetWindow.isDestroyed()) writeDesktopPreferences({ window_bounds: targetWindow.getBounds() });
    }, 300);
  };
  saveBounds.timer = null;
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('closed', () => {
    clearTimeout(saveBounds.timer);
    mainWindow = undefined;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key === ',') { event.preventDefault(); sendToMainWindow('app:open-settings'); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const requested = new URL(url);
      const allowed = new URL(target);
      if (requested.protocol === allowed.protocol && requested.host === allowed.host && requested.pathname === allowed.pathname) return;
      event.preventDefault();
      if (['http:', 'https:'].includes(requested.protocol)) shell.openExternal(requested.toString());
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error('Renderer failed to load', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process exited unexpectedly', details);
  });
  mainWindow.webContents.on('console-message', (_event, levelOrDetails, legacyMessage, legacyLineNumber, legacySourceId) => {
    const details = typeof levelOrDetails === 'object'
      ? levelOrDetails
      : { level: levelOrDetails, message: legacyMessage, lineNumber: legacyLineNumber, sourceId: legacySourceId };
    const isError = details.level === 'error' || details.level === 3;
    const isWarning = details.level === 'warning' || details.level === 2;
    const write = isError ? log.error : isWarning ? log.warn : log.info;
    write.call(log, `[renderer] ${details.message || '(empty console message)'}`, { line: details.lineNumber, source: details.sourceId });
  });
  mainWindow.webContents.once('did-finish-load', async () => {
    if (pendingCompanionToggle) {
      pendingCompanionToggle = false;
      setTimeout(() => sendToMainWindow('companion:toggle-session'), 650).unref?.();
    }
    try {
      const state = await mainWindow.webContents.executeJavaScript(`({
        readyState: document.readyState,
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
        bodyText: document.body.innerText.slice(0, 120)
      })`);
      if (state.rootChildren === 0) log.error('Renderer loaded without mounting the React application', state);
      else log.info('Renderer loaded successfully', state);
    } catch (error) {
      log.error('Renderer verification failed', error);
    }
  });
  configureSessionSecurity();
  mainWindow.loadURL(target).catch((error) => log.error('Could not navigate to renderer', { target, error }));
}

function createTray() {
  const icon = nativeImage.createFromPath(brandAssetPath('shree-mark.png')).resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(PRODUCT_LABEL);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Floating Companion', click: () => showCompanion({ force: true }) },
    { label: 'Open Shree', click: () => revealMainWindow() },
    { label: 'Check for updates', click: () => updater?.check({ manual: true }).catch(log.error) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => revealMainWindow());
}

function showCompanionContextMenu() {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  Menu.buildFromTemplate([
    { label: 'Open Full SHREE', click: () => revealMainWindow('chat') },
    { label: 'Move to Center', click: () => centerCompanionWindow() },
    { label: 'Settings', click: () => revealMainWindow('settings') },
    { label: 'Exit Floating Mode', click: () => revealMainWindow('chat') },
  ]).popup({ window: companionWindow });
  return true;
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:get-launch-at-login', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('app:launch-at-login', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:notify', (_event, { title, body }) => {
  if (!desktopPreferences.notifications_enabled || inQuietHours() || !Notification.isSupported()) return false;
  new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 500), icon: brandAssetPath('shree-mark.png') }).show();
  return true;
});
ipcMain.handle('window:minimize-to-tray', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.hide();
  return true;
});
ipcMain.handle('shell:open-external', async (_event, url) => {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) URLs are allowed');
  await shell.openExternal(parsed.toString());
  return true;
});
ipcMain.handle('app:set-emergency-shortcut', (_event, accelerator) => registerEmergencyShortcut(String(accelerator)));
ipcMain.handle('companion:set-activation-shortcut', (_event, accelerator) => registerCompanionShortcut(String(accelerator)));
ipcMain.handle('app:get-preferences', () => desktopPreferences);
ipcMain.handle('app:update-preferences', async (_event, values) => {
  const allowed = Object.fromEntries(Object.entries(values || {}).filter(([key]) => key in desktopPreferenceDefaults));
  const restartRequired = ['hardware_acceleration', 'memory_usage_limit_mb', 'cache_size_mb'].some(key => key in allowed && allowed[key] !== desktopPreferences[key]);
  const previousShortcut = desktopPreferences.floating_activation_shortcut;
  if ('floating_activation_shortcut' in allowed && allowed.floating_activation_shortcut !== previousShortcut) {
    try { registerCompanionShortcut(String(allowed.floating_activation_shortcut)); }
    catch (error) {
      if (previousShortcut) registerCompanionShortcut(previousShortcut);
      throw error;
    }
  }
  const preferences = writeDesktopPreferences(allowed);
  if (updater && ['check_updates_automatically', 'automatic_download_updates', 'automatic_install_updates', 'update_channel'].some((key) => key in allowed)) {
    updater.preferencesChanged();
  }
  try { setupRequiredAtStartup = Boolean((await backendGet('/api/setup/status')).requires_setup); }
  catch (error) { log.debug('Setup state refresh skipped while applying preferences', String(error)); }
  applyCompanionPreferences();
  if ('floating_mode_enabled' in allowed) {
    if (preferences.floating_mode_enabled && !mainWindow?.isVisible()) showCompanion();
    else if (!preferences.floating_mode_enabled) {
      if (companionWindow && !companionWindow.isDestroyed()) companionWindow.hide();
      revealMainWindow();
    }
  }
  return { preferences, restart_required: restartRequired };
});
ipcMain.handle('companion:open-main', (_event, section) => revealMainWindow(String(section || 'chat')));
ipcMain.handle('companion:show', () => showCompanion({ force: true }));
ipcMain.handle('companion:context-menu', () => showCompanionContextMenu());
ipcMain.handle('companion:set-click-through', (_event, enabled) => {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  companionWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  return true;
});
ipcMain.handle('companion:toggle-session', () => requestCompanionSessionToggle());
ipcMain.handle('companion:get-session-state', () => latestCompanionSessionState);
ipcMain.handle('companion:report-session-state', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  const allowedStates = new Set(['idle', 'connecting', 'listening', 'thinking', 'speaking', 'working', 'success', 'error', 'reminder']);
  const state = allowedStates.has(payload?.state) ? payload.state : 'idle';
  latestCompanionSessionState = {
    state,
    audioLevel: Math.max(0, Math.min(1, Number(payload?.audioLevel) || 0)),
    muted: Boolean(payload?.muted),
    caption: String(payload?.caption || '').slice(0, 4000),
    captionRole: ['user', 'model'].includes(payload?.captionRole) ? payload.captionRole : null,
  };
  const active = !['idle', 'error'].includes(state);
  mainWindow.webContents.setBackgroundThrottling(active ? false : Number(desktopPreferences.background_cpu_limit) < 100);
  sendToCompanion('companion:session-state', latestCompanionSessionState);
  return true;
});
ipcMain.handle('companion:drag-start', () => {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  clearInterval(companionDragTimer);
  const lockedSize = companionSize();
  const currentBounds = companionWindow.getBounds();
  const bounds = { ...currentBounds, ...lockedSize };
  companionWindow.setBounds(bounds, false);
  companionWindow.setResizable(false);
  const cursor = screen.getCursorScreenPoint();
  const offset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  companionDragTimer = setInterval(() => {
    if (!companionWindow || companionWindow.isDestroyed()) return clearInterval(companionDragTimer);
    const current = screen.getCursorScreenPoint();
    companionWindow.setBounds({
      x: current.x - offset.x,
      y: current.y - offset.y,
      ...lockedSize,
    }, false);
  }, 16);
  return true;
});
ipcMain.handle('companion:drag-end', () => {
  clearInterval(companionDragTimer);
  companionDragTimer = undefined;
  snapCompanionToWorkArea();
  return true;
});
ipcMain.handle('app:clear-cache', async () => { await session.defaultSession.clearCache(); return true; });
ipcMain.handle('app:get-update-state', () => updater?.publicState() || null);
ipcMain.handle('app:check-updates', () => updater.check({ manual: true }));
ipcMain.handle('app:download-update', (_event, background = false) => updater.download({ background: Boolean(background) }));
ipcMain.handle('app:cancel-update-download', () => updater.cancelDownload());
ipcMain.handle('app:install-update', () => updater.install());
ipcMain.handle('app:remind-update-later', () => updater.remindLater());
ipcMain.handle('app:skip-update-version', () => updater.skipVersion());
ipcMain.handle('app:set-update-channel', (_event, channel) => updater.setChannel(String(channel)));
ipcMain.handle('app:restart', () => { quitting = true; app.relaunch(); app.exit(0); return true; });
ipcMain.handle('mobile:firewall-status', () => mobileFirewallStatus());
ipcMain.handle('mobile:allow-firewall', () => allowMobileFirewallAccess());

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  updater = new ShreeUpdater({
    log,
    broadcast: broadcastToRenderers,
    revealSettings: (section = 'updates') => revealMainWindow(section),
    readPreferences: () => desktopPreferences,
    writePreferences: writeDesktopPreferences,
    prepareInstall: prepareForUpdateInstall,
  });
  updater.recordCompletedUpdate();
  await selectBackendEndpoint();
  try { await startBackend(); } catch (error) { log.error(error); }
  try {
    const [setupState, applicationSettings] = await Promise.all([
      backendGet('/api/setup/status'),
      backendGet('/api/settings'),
    ]);
    setupRequiredAtStartup = Boolean(setupState.requires_setup);
    const desktopValues = Object.fromEntries(Object.entries(applicationSettings.values || {}).filter(([key]) => key in desktopPreferenceDefaults));
    writeDesktopPreferences(desktopValues);
  } catch (error) {
    setupRequiredAtStartup = true;
    log.warn('Could not load setup state and desktop preferences at startup', error);
  }
  createWindow();
  if (desktopPreferences.floating_mode_enabled && !setupRequiredAtStartup) createCompanionWindow();
  createTray();
  registerEmergencyShortcut();
  try { registerCompanionShortcut(desktopPreferences.floating_activation_shortcut); }
  catch (error) {
    log.warn('Configured companion shortcut was unavailable; restored the default shortcut', error);
    const fallback = desktopPreferenceDefaults.floating_activation_shortcut;
    writeDesktopPreferences({ floating_activation_shortcut: fallback });
    registerCompanionShortcut(fallback);
  }
  startReminderMonitor();
  startFullscreenMonitor();
  updater.schedule();
  const smokeQuitMs = Number(process.env.SHREE_SMOKE_QUIT_MS || 0);
  if (Number.isFinite(smokeQuitMs) && smokeQuitMs >= 1000) {
    setTimeout(() => { quitting = true; app.quit(); }, smokeQuitMs).unref?.();
  }
});
app.on('activate', () => revealMainWindow());
app.on('window-all-closed', () => {
  if (quitting || !desktopPreferences.minimize_to_tray) app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  updater?.stopSchedule();
  if (reminderMonitor) clearInterval(reminderMonitor);
  if (fullscreenMonitor) clearInterval(fullscreenMonitor);
  clearTimeout(companionSnapTimer);
  clearInterval(companionDragTimer);
  globalShortcut.unregisterAll();
  stopBackend();
});
