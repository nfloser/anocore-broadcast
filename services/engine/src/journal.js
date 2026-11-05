import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Synchronous JSON-lines write-ahead journal.
 * Only operator-controlled paths should be supplied.
 * Fails closed on partial/corrupt records; never silently skips them.
 */
export function createEventJournal({ filePath, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('A journal file path is required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128) {
    throw new TypeError('Invalid maxBytes');
  }
  const path = resolve(filePath);

  function read() {
    if (!existsSync(path)) return [];
    const data = readFileSync(path);
    if (data.length > maxBytes) throw new Error('Journal exceeds maximum size');
    if (data.length === 0) return [];
    if (data[data.length - 1] !== 10) {
      throw new Error('Journal contains an incomplete trailing record');
    }
    return data.toString('utf8').trimEnd().split('\n').map((line, index) => {
      try {
        const value = JSON.parse(line);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Not an object');
        }
        return value;
      } catch {
        throw new Error(`Corrupted journal record at line ${index + 1}`);
      }
    });
  }

  function append(events) {
    if (!Array.isArray(events) || events.length === 0) throw new TypeError('Nonempty events array required');
    const bytes = Buffer.from(events.map(event => JSON.stringify(event) + '\n').join(''), 'utf8');
    const current = existsSync(path) ? readFileSync(path).length : 0;
    if (current + bytes.length > maxBytes) throw new Error('Journal capacity reached');
    appendFileSync(path, bytes, { mode: 0o600, flag: 'a', flush: true });
  }
  return { read, append };
}
