const VALID_CHANNELS = new Set(['stable', 'beta', 'alpha']);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:\.\d+)?)?$/i;

function normalizeChannel(value) {
  const channel = String(value || 'stable').toLowerCase();
  return VALID_CHANNELS.has(channel) ? channel : 'stable';
}

function isSuppressed(version, preferences, now = Date.now()) {
  const remindAfter = Date.parse(preferences.update_remind_after || '');
  return preferences.update_skipped_version === version || (Number.isFinite(remindAfter) && remindAfter > now);
}

function validateFeedUrl(value, allowHttp = false) {
  const parsed = new URL(String(value));
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) throw new Error('The production update source must use HTTPS');
  return parsed.toString();
}

module.exports = { VALID_CHANNELS, VERSION_PATTERN, normalizeChannel, isSuppressed, validateFeedUrl };
