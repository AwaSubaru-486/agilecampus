const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLaunch, serverOrigin, validateAppearance, clampBounds } = require('../lib/protocol.cjs');
const ticket = 'acpair_' + 'a'.repeat(43);
test('deep links accept HTTPS and loopback only, with one purpose-bound ticket', () => {
  const url = 'agilecampus-pet://connect?server=' + encodeURIComponent('http://127.0.0.1:3000') + '&ticket=' + ticket;
  assert.equal(parseLaunch(url).origin, 'http://127.0.0.1:3000');
  for (const value of ['file:///secret', 'http://remote.test', 'https://user:pass@test/', 'https://test/some/path']) assert.throws(() => serverOrigin(value));
  assert.throws(() => parseLaunch(url + '&ticket=' + ticket));
  assert.throws(() => parseLaunch(url.replace('connect?', 'execute?')));
  assert.throws(() => parseLaunch(url + '&command=anything'));
});
test('appearance validation strips remote URLs and bounds sprite frames', () => {
  assert.deepEqual(validateAppearance({ type: 'image', src: 'https://ignored.test/a', width: 96, height: 128 }), { type: 'image', width: 96, height: 128 });
  assert.throws(() => validateAppearance({ type: 'image', width: Infinity, height: 128 }));
  assert.throws(() => validateAppearance({ type: 'spritesheet', frameWidth: 96, frameHeight: 96, columns: 2, rows: 2, idle: { start: 3, count: 2, fps: 8 } }));
});
test('off-screen bounds are restored into the current display work area', () => {
  assert.deepEqual(clampBounds({ x: -3000, y: 3000, width: 240, height: 280 }, { x: 0, y: 0, width: 1920, height: 1040 }), { x: 0, y: 760, width: 240, height: 280 });
});
