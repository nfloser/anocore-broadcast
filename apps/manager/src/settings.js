import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULTS = Object.freeze({
  ctName: 'COUNTER-TERRORISTS',
  tName: 'TERRORISTS',
  ctColor: '#67addd',
  tColor: '#dcbb5b',
  showRoster: true,
});
const ALLOWED = new Set(Object.keys(DEFAULTS));
const NAME = /^[\p{L}\p{N} _-]{1,28}$/u;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function validate(changes, complete = false) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
      Object.getPrototypeOf(changes) !== Object.prototype) {
    throw new TypeError('Invalid settings object');
  }
  const keys = Object.keys(changes);
  if (!keys.length || keys.some(k => !ALLOWED.has(k)) ||
      (complete && keys.length !== ALLOWED.size)) {
    throw new TypeError('Unknown or missing settings');
  }
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'ctName' || key === 'tName') {
      if (typeof value !== 'string' || !NAME.test(value)) throw new TypeError('Invalid team name');
    } else if (key === 'ctColor' || key === 'tColor') {
      if (typeof value !== 'string' || !COLOR.test(value)) throw new TypeError('Invalid color');
    } else if (key === 'showRoster' && typeof value !== 'boolean') {
      throw new TypeError('Invalid roster setting');
    }
  }
}

export function createBroadcastSettings({ filePath } = {}) {
  if (filePath !== undefined && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new TypeError('Invalid operator configuration path');
  }
  const path = filePath === undefined ? null : resolve(filePath);
  let current = { ...DEFAULTS };

  if (path && existsSync(path)) {
    try {
      const document = JSON.parse(readFileSync(path, 'utf8'));
      if (!document || Object.getPrototypeOf(document) !== Object.prototype ||
          document.schemaVersion !== 1 || !document.settings ||
          Object.keys(document).sort().join(',') !== 'schemaVersion,settings') {
        throw new Error('Unsupported format');
      }
      validate(document.settings, true);
      current = { ...document.settings };
    } catch {
      throw new Error('Invalid operator configuration file');
    }
  }

  function persist(next) {
    if (!path) return;
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, settings: next }) + '\n',
        { flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  function get() { return { ...current }; }
  function update(changes) {
    validate(changes);
    const next = { ...current, ...changes };
    persist(next);
    current = next;
    return get();
  }
  return { get, update };
}
