const { Notification, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { CancellationToken } = require('builder-util-runtime');
const { VALID_CHANNELS, VERSION_PATTERN, normalizeChannel, isSuppressed, validateFeedUrl } = require('./updater-policy.cjs');

const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 20 * 1000;
const REMIND_LATER_MS = 24 * 60 * 60 * 1000;

function releaseNotesText(notes) {
  if (typeof notes === 'string') return notes.slice(0, 20_000);
  if (Array.isArray(notes)) return notes.map((item) => item?.note || '').filter(Boolean).join('\n\n').slice(0, 20_000);
  return '';
}

function updateSize(info) {
  return Array.isArray(info?.files)
    ? info.files.reduce((total, file) => total + (Number(file?.size) || 0), 0)
    : null;
}

class ShreeUpdater {
  constructor({ log, broadcast, revealSettings, readPreferences, writePreferences, prepareInstall }) {
    this.log = log;
    this.broadcast = broadcast;
    this.revealSettings = revealSettings;
    this.readPreferences = readPreferences;
    this.writePreferences = writePreferences;
    this.prepareInstall = prepareInstall;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.cancellationToken = null;
    this.periodicTimer = null;
    this.startupTimer = null;
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      availableVersion: null,
      releaseDate: null,
      releaseNotes: '',
      downloadSize: null,
      channel: this.channel(),
      lastCheckedAt: null,
      progress: null,
      error: null,
      prompt: false,
      configured: false,
      developmentMode: !app.isPackaged,
    };
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    this.bindEvents();
  }

  channel() {
    const value = String(this.readPreferences()?.update_channel || 'stable').toLowerCase();
    return normalizeChannel(value);
  }

  configure() {
    const testUrl = process.env.SHREE_TEST_UPDATE_URL;
    const genericUrl = process.env.SHREE_UPDATE_URL;
    if (!app.isPackaged && !testUrl) {
      this.patch({ configured: false, developmentMode: true, status: 'development_disabled' });
      return false;
    }
    if (testUrl || genericUrl) {
      const value = String(testUrl || genericUrl);
      autoUpdater.setFeedURL({ provider: 'generic', url: validateFeedUrl(value, Boolean(testUrl)) });
    }
    const channel = this.channel();
    autoUpdater.channel = channel === 'stable' ? 'latest' : channel;
    autoUpdater.allowPrerelease = channel !== 'stable';
    this.patch({ configured: true, developmentMode: !app.isPackaged, channel });
    return true;
  }

  bindEvents() {
    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: null, progress: null }));
    autoUpdater.on('update-not-available', (info) => {
      const checked = new Date().toISOString();
      this.writePreferences({ last_update_check: checked });
      this.patch({ status: 'up_to_date', lastCheckedAt: checked, availableVersion: info?.version || null, prompt: false, error: null });
    });
    autoUpdater.on('update-available', (info) => {
      if (!VERSION_PATTERN.test(String(info?.version || ''))) {
        this.patch({ status: 'invalid_metadata', error: 'The update server returned an invalid version.', prompt: false });
        return;
      }
      const preferences = this.readPreferences();
      const suppressed = isSuppressed(info.version, preferences);
      const checked = new Date().toISOString();
      this.writePreferences({ last_update_check: checked });
      this.patch({
        status: 'update_available',
        availableVersion: info.version,
        releaseDate: info.releaseDate || null,
        releaseNotes: releaseNotesText(info.releaseNotes),
        downloadSize: updateSize(info),
        lastCheckedAt: checked,
        prompt: !suppressed,
        error: null,
      });
      if (!suppressed && preferences.update_notifications !== false && Notification.isSupported()) {
        const notification = new Notification({ title: `Shree ${info.version} is available`, body: 'Open Updates to review, download, and install it.' });
        notification.on('click', () => this.revealSettings('updates'));
        notification.show();
      }
      if (!suppressed && preferences.automatic_download_updates) {
        this.download({ background: true }).catch((error) => this.log.error('Automatic update download failed', error));
      }
    });
    autoUpdater.on('download-progress', (progress) => this.patch({
      status: 'downloading',
      progress: {
        percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
        transferred: Number(progress.transferred) || 0,
        total: Number(progress.total) || 0,
        bytesPerSecond: Number(progress.bytesPerSecond) || 0,
      },
      error: null,
    }));
    autoUpdater.on('update-downloaded', (info) => {
      this.cancellationToken = null;
      this.downloadPromise = null;
      this.patch({ status: 'downloaded', availableVersion: info?.version || this.state.availableVersion, progress: { ...(this.state.progress || {}), percent: 100 }, prompt: true, error: null });
      if (this.readPreferences().automatic_install_updates) {
        this.install().catch((error) => this.log.error('Automatic update installation could not start', error));
      }
    });
    autoUpdater.on('error', (error) => {
      const cancelled = Boolean(this.cancellationToken?.cancelled);
      this.cancellationToken = null;
      this.downloadPromise = null;
      this.patch({ status: cancelled ? 'download_cancelled' : 'error', error: cancelled ? null : String(error?.message || error).slice(0, 2000), progress: null });
      this.log.error('Updater error', { message: String(error?.message || error), code: error?.code });
    });
  }

  patch(values) {
    this.state = { ...this.state, ...values, currentVersion: app.getVersion(), channel: this.channel() };
    this.broadcast('update:state', this.publicState());
  }

  publicState() {
    const preferences = this.readPreferences();
    return JSON.parse(JSON.stringify({
      ...this.state,
      automaticChecks: preferences.check_updates_automatically !== false,
      automaticDownload: Boolean(preferences.automatic_download_updates),
      automaticInstall: Boolean(preferences.automatic_install_updates),
      history: Array.isArray(preferences.update_history) ? preferences.update_history : [],
    }));
  }

  async check({ manual = false } = {}) {
    if (this.checkPromise) return this.checkPromise;
    try {
      if (!this.configure()) return this.publicState();
    } catch (error) {
      this.patch({ status: 'not_configured', configured: false, error: String(error.message || error) });
      return this.publicState();
    }
    this.patch({ status: 'checking', error: null, prompt: manual ? this.state.prompt : false });
    this.checkPromise = autoUpdater.checkForUpdates()
      .then(() => this.publicState())
      .catch((error) => {
        this.patch({ status: 'error', error: String(error?.message || error).slice(0, 2000), prompt: manual });
        return this.publicState();
      })
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async download({ background = false } = {}) {
    if (this.downloadPromise) return this.downloadPromise;
    if (!['update_available', 'error', 'download_cancelled'].includes(this.state.status)) throw new Error('No update is ready to download');
    this.cancellationToken = new CancellationToken();
    this.patch({ status: 'downloading', progress: { percent: 0, transferred: 0, total: this.state.downloadSize || 0, bytesPerSecond: 0 }, error: null, prompt: !background });
    this.downloadPromise = autoUpdater.downloadUpdate(this.cancellationToken)
      .then(() => this.publicState())
      .finally(() => { if (this.state.status !== 'downloading') this.downloadPromise = null; });
    return this.downloadPromise;
  }

  cancelDownload() {
    if (!this.cancellationToken) return false;
    this.cancellationToken.cancel();
    this.patch({ status: 'download_cancelled', progress: null, error: null });
    return true;
  }

  remindLater() {
    this.writePreferences({ update_remind_after: new Date(Date.now() + REMIND_LATER_MS).toISOString() });
    this.patch({ prompt: false });
    return this.publicState();
  }

  skipVersion() {
    if (!this.state.availableVersion) return this.publicState();
    this.writePreferences({ update_skipped_version: this.state.availableVersion, update_remind_after: null });
    this.patch({ prompt: false, status: 'skipped' });
    return this.publicState();
  }

  setChannel(channel) {
    const normalized = String(channel).toLowerCase();
    if (!VALID_CHANNELS.has(normalized)) throw new Error('Update channel must be stable, beta, or alpha');
    this.writePreferences({ update_channel: normalized, update_skipped_version: null, update_remind_after: null });
    this.configure();
    this.patch({ channel: normalized, status: 'idle', availableVersion: null, prompt: false });
    return this.publicState();
  }

  preferencesChanged() {
    this.configure();
    this.schedule();
    this.patch({});
    return this.publicState();
  }

  async install() {
    if (this.state.status !== 'downloaded') throw new Error('The update has not finished downloading');
    this.patch({ status: 'waiting_for_tasks', error: null, prompt: true });
    const readiness = await this.prepareInstall();
    if (!readiness?.ready) {
      this.patch({ status: 'blocked_by_active_task', error: readiness?.message || 'An active task must finish before updating.', prompt: true });
      return this.publicState();
    }
    this.writePreferences({ pending_update_version: this.state.availableVersion, update_skipped_version: null, update_remind_after: null });
    this.patch({ status: 'installing', prompt: false });
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return this.publicState();
  }

  recordCompletedUpdate() {
    const preferences = this.readPreferences();
    if (!preferences.pending_update_version) return;
    const version = app.getVersion();
    const history = Array.isArray(preferences.update_history) ? preferences.update_history.slice(-19) : [];
    history.push({ version, completedAt: new Date().toISOString(), status: preferences.pending_update_version === version ? 'completed' : 'version_mismatch' });
    this.writePreferences({ pending_update_version: null, update_history: history });
    this.patch({ status: preferences.pending_update_version === version ? 'update_completed' : 'idle' });
  }

  schedule() {
    this.stopSchedule();
    if (!app.isPackaged || this.readPreferences().check_updates_automatically === false) return;
    this.startupTimer = setTimeout(() => this.check().catch((error) => this.log.warn('Startup update check failed', error)), STARTUP_CHECK_DELAY_MS);
    this.startupTimer.unref?.();
    this.periodicTimer = setInterval(() => this.check().catch((error) => this.log.warn('Periodic update check failed', error)), CHECK_INTERVAL_MS);
    this.periodicTimer.unref?.();
  }

  stopSchedule() {
    clearTimeout(this.startupTimer);
    clearInterval(this.periodicTimer);
    this.startupTimer = null;
    this.periodicTimer = null;
  }
}

module.exports = { ShreeUpdater, VALID_CHANNELS, VERSION_PATTERN };
