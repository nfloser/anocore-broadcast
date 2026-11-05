import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_SEGMENT_BYTES = 4 * 1024 * 1024;

/**
 * Single-writer JSONL event journal. The operator-selected base filename is
 * followed by numbered segments: events.jsonl, events.jsonl.000001, etc.
 * Total storage is bounded. No data is deleted during rotation.
 */
export function createEventJournal({
  filePath, maxBytes = DEFAULT_MAX_BYTES, segmentBytes = DEFAULT_SEGMENT_BYTES,
} = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('A journal file path is required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128 ||
      !Number.isSafeInteger(segmentBytes) || segmentBytes < 128) {
    throw new TypeError('Invalid journal size limits');
  }

  const path = resolve(filePath);
  const folder = dirname(path);
  const name = basename(path);
  const fileFor = index => index === 0 ? path :
    join(folder, `${name}.${String(index).padStart(6, '0')}`);

  function segments() {
    const suffixes = readdirSync(folder)
      .filter(filename => filename.startsWith(name + '.') &&
        /^\d{6}$/.test(filename.slice(name.length + 1)))
      .map(filename => Number(filename.slice(name.length + 1)));
    suffixes.sort((a, b) => a - b);
    if (suffixes.length && (!existsSync(path) || suffixes[0] !== 1)) {
      throw new Error('Journal segment chain is missing its beginning');
    }
    for (let i = 0; i < suffixes.length; i++) {
      if (suffixes[i] !== i + 1) throw new Error('Journal segment gap or duplicate');
    }
    return [ ...(existsSync(path) ? [path] : []),
      ...suffixes.map(fileFor) ];
  }

  function parseFiles(paths) {
    const events = [];
    let totalBytes = 0;
    for (const file of paths) {
      const data = readFileSync(file);
      totalBytes += data.length;
      if (totalBytes > maxBytes) throw new Error('Journal exceeds maximum size');
      if (!data.length) {
        // A zero-length base can be a fresh empty journal, but a numbered
        // segment with no records is an interrupted rotation.
        if (file !== path) throw new Error('Empty journal segment');
        continue;
      }
      if (data[data.length - 1] !== 10) {
        throw new Error('Journal contains an incomplete trailing record');
      }
      const lines = data.toString('utf8').slice(0, -1).split('\n');
      for (let i = 0; i < lines.length; i++) {
        try {
          const value = JSON.parse(lines[i]);
          if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Not a JSON object');
          }
          events.push(value);
        } catch {
          throw new Error(`Corrupted journal record in ${basename(file)} at line ${i + 1}`);
        }
      }
    }
    return { events, totalBytes };
  }

  const initialFiles = segments();
  const initial = parseFiles(initialFiles);
  let totalBytes = initial.totalBytes;
  let index = initialFiles.length ? initialFiles.length - 1 : 0;
  let activeBytes = initialFiles.length ? statSync(fileFor(index)).size : 0;

  function read() {
    return parseFiles(segments()).events;
  }

  function append(events) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new TypeError('Nonempty events array required');
    }
    const bytes = Buffer.from(events.map(event => JSON.stringify(event) + '\n').join(''), 'utf8');
    if (bytes.length > segmentBytes) throw new Error('Event batch exceeds segment capacity');
    if (totalBytes + bytes.length > maxBytes) throw new Error('Journal capacity reached');

    const activeFile = fileFor(index);
    const actualSize = existsSync(activeFile) ? statSync(activeFile).size : 0;
    if (actualSize !== activeBytes) {
      throw new Error('Journal modified by another process');
    }

    const rotate = activeBytes > 0 && activeBytes + bytes.length > segmentBytes;
    const targetIndex = rotate ? index + 1 : index;
    const target = fileFor(targetIndex);
    if (rotate && existsSync(target)) {
      throw new Error('Journal segment already exists');
    }
    // Flush to disk before the caller can acknowledge the event.
    appendFileSync(target, bytes, { mode: 0o600, flag: 'a', flush: true });
    if (rotate) {
      index = targetIndex;
      activeBytes = 0;
    }
    activeBytes += bytes.length;
    totalBytes += bytes.length;
  }

  function stats() {
    return { totalBytes, maxBytes, segmentBytes, segmentCount: index + 1 };
  }
  return { read, append, stats };
}
