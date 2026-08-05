const assert = require('node:assert/strict');
const { normalizeChannel, isSuppressed, validateFeedUrl, VERSION_PATTERN } = require('../electron/updater-policy.cjs');

assert.equal(normalizeChannel('beta'), 'beta');
assert.equal(normalizeChannel('unknown'), 'stable');
assert.equal(VERSION_PATTERN.test('1.2.3'), true);
assert.equal(VERSION_PATTERN.test('1.2.3-beta.2'), true);
assert.equal(VERSION_PATTERN.test('../bad'), false);
assert.equal(isSuppressed('2.0.0', { update_skipped_version: '2.0.0' }), true);
assert.equal(isSuppressed('2.0.0', { update_remind_after: new Date(Date.now() + 60_000).toISOString() }), true);
assert.equal(isSuppressed('2.0.0', {}), false);
assert.throws(() => validateFeedUrl('http://updates.example.com'), /HTTPS/);
assert.equal(validateFeedUrl('https://updates.example.com/'), 'https://updates.example.com/');
console.log('Updater policy tests passed.');
