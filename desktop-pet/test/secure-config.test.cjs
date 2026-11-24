const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryptToken, decryptToken } = require('../lib/secure-config.cjs');
test('uses asynchronous OS storage when available', async () => {
  const backend = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from('encrypted:' + text), decryptStringAsync: async bytes => ({ result: bytes.toString().slice(10), shouldReEncrypt: true }) };
  const stored = await encryptToken(backend, 'test-token');
  assert.equal(stored.encryption, 'async'); assert.equal(await decryptToken(backend, stored), 'test-token');
  assert.equal(JSON.stringify(stored).includes('test-token'), false);
});
test('Windows may use OS-protected synchronous fallback, never plaintext', async () => {
  const backend = { isAsyncEncryptionAvailable: async () => false, isEncryptionAvailable: () => true, encryptString: text => Buffer.from('encrypted:' + text), decryptString: bytes => bytes.toString().slice(10) };
  const stored = await encryptToken(backend, 'test-token');
  assert.equal(stored.encryption, 'os'); assert.equal(await decryptToken(backend, stored), 'test-token');
  assert.equal(JSON.stringify(stored).includes('test-token'), false);
});
test('unavailable OS storage returns no persisted credential', async () => {
  const backend = { isAsyncEncryptionAvailable: async () => false, isEncryptionAvailable: () => false };
  assert.deepEqual(await encryptToken(backend, 'test-token'), {});
  assert.equal(await decryptToken(backend, {}), null);
});
