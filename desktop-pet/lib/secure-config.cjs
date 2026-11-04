/** Both modes use OS encryption. Never persist a token if no secure backend is available. */
async function encryptToken(storage, token) {
  if (await storage.isAsyncEncryptionAvailable()) return { encryptedToken: (await storage.encryptStringAsync(token)).toString('base64'), encryption: 'async' };
  // Electron 45's asynchronous backend is not enabled on every Windows installation.
  if (typeof storage.isEncryptionAvailable === 'function' && storage.isEncryptionAvailable()) return { encryptedToken: storage.encryptString(token).toString('base64'), encryption: 'os' };
  return {};
}
async function decryptToken(storage, stored) {
  if (!stored.encryptedToken) return null;
  const bytes = Buffer.from(stored.encryptedToken, 'base64');
  if (stored.encryption === 'os') {
    if (typeof storage.isEncryptionAvailable === 'function' && storage.isEncryptionAvailable()) return storage.decryptString(bytes);
    return null;
  }
  if (await storage.isAsyncEncryptionAvailable()) {
    const decrypted = await storage.decryptStringAsync(bytes);
    // Electron 45 includes key-rotation metadata alongside the decrypted result.
    return typeof decrypted === 'string' ? decrypted : typeof decrypted?.result === 'string' ? decrypted.result : null;
  }
  return null;
}
module.exports = { encryptToken, decryptToken };
