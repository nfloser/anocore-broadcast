import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const MAX_BYTES = 8192;
const KEY = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The Electron main process passes electron.safeStorage. Windows safeStorage
 * uses user-scoped DPAPI. Never substitute an unencrypted fallback.
 *
 * A saved credential is deliberately reused across Live sessions and app
 * restarts. Losing the user's OS encryption context fails closed and requires
 * an explicit reset; it does not silently invalidate the installed CS2 CFG.
 */
export function createObserverCredentialStore({ filePath, encryption } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim() ||
      typeof encryption?.isEncryptionAvailable !== 'function' ||
      typeof encryption?.encryptString !== 'function' ||
      typeof encryption?.decryptString !== 'function') {
    throw new TypeError('Invalid credential store options');
  }
  const file = resolve(filePath);
  if (basename(file) !== 'observer-credential.json') {
    throw new TypeError('Invalid credential file name');
  }
  function secure() {
    if (!encryption.isEncryptionAvailable()) {
      throw new Error('Secure storage unavailable: Windows user encryption is required');
    }
  }
  function checkFile() {
    if (!existsSync(file)) return false;
    try {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
          info.size < 1 || info.size > MAX_BYTES) throw new Error('Unsafe credential file');
      return true;
    } catch {
      throw new Error('Saved observer key cannot be read safely');
    }
  }
  function load() {
    try {
      const raw = readFileSync(file, 'utf8');
      const record = JSON.parse(raw);
      if (!record || Array.isArray(record) || Object.getPrototypeOf(record) !== Object.prototype ||
          Object.keys(record).sort().join(',') !== 'ciphertext,provider,schemaVersion' ||
          record.schemaVersion !== 1 || record.provider !== 'electron-safe-storage' ||
          typeof record.ciphertext !== 'string' ||
          record.ciphertext.length > MAX_BYTES || !BASE64.test(record.ciphertext)) {
        throw new Error('Invalid credential format');
      }
      const encrypted = Buffer.from(record.ciphertext, 'base64');
      if (!encrypted.length || encrypted.toString('base64') !== record.ciphertext) {
        throw new Error('Invalid ciphertext');
      }
      const token = encryption.decryptString(encrypted);
      if (!KEY.test(token)) throw new Error('Invalid credential');
      return token;
    } catch {
      throw new Error('Saved observer key is unreadable or damaged; reset it explicitly from Demo mode');
    }
  }
  return {
    getOrCreate() {
      secure();
      if (checkFile()) return load();
      const token = randomBytes(32).toString('hex');
      const ciphertext = encryption.encryptString(token);
      if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 ||
          ciphertext.length > MAX_BYTES) {
        throw new Error('Secure credential encryption failed');
      }
      const record = JSON.stringify({
        schemaVersion: 1,
        provider: 'electron-safe-storage',
        ciphertext: ciphertext.toString('base64'),
      }) + '\n';
      try {
        writeFileSync(file, record, { flag: 'wx', mode: 0o600, flush: true });
      } catch (error) {
        // Another process or session could have created the key concurrently.
        // Never overwrite it or return a different in-memory token.
        if (error.code === 'EEXIST' && checkFile()) return load();
        throw new Error('Cannot safely save observer key');
      }
      return token;
    },
    reset() {
      secure();
      if (!checkFile()) return;
      try {
        unlinkSync(file);
      } catch {
        throw new Error('Saved observer key cannot be reset safely');
      }
    },
  };
}
