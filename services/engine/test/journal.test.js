import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventJournal } from '../src/journal.js';
import { createBroadcastRuntime } from '../src/runtime.js';

const secret = 'test-secret-0123456789';
const fixture = round => ({
  auth: { token: secret }, provider: { name: 'Counter-Strike 2' },
  map: { name: 'de_inferno', round, team_ct: { score: round }, team_t: { score: 0 } },
});
function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'anocore-journal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'events.jsonl');
}
async function launch(file, now) {
  const runtime = createBroadcastRuntime({
    matchId: 'match-1', token: secret, journalPath: file,
    port: 0, clock: () => now.value, staleAfterMs: 1000,
  });
  const address = await runtime.listen();
  return { runtime, url: `http://127.0.0.1:${address.port}/gsi` };
}
async function send(url, round) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture(round)) });
}

test('restart replays confirmed snapshots and continues source-local sequences', async t => {
  const path = tmp(t);
  const time = { value: 1000 };
  const first = await launch(path, time);
  t.after(() => first.runtime.close());
  assert.equal((await send(first.url, 1)).status, 202);
  assert.equal((await send(first.url, 2)).status, 202);
  await first.runtime.close();
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map(l => JSON.parse(l).sequence), [1, 2]);
  time.value = 10_000;
  const second = await launch(path, time);
  t.after(() => second.runtime.close());
  assert.equal(second.runtime.stats().eventCount, 2);
  assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2);
  assert.equal(second.runtime.view().snapshots['observer-1'], undefined);
  assert.equal(second.runtime.view().freshness['observer-1'].status, 'stale');
  assert.equal(second.runtime.freshness().status, 'waiting');
  assert.equal((await send(second.url, 3)).status, 202);
  assert.deepEqual(readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l).sequence), [1, 2, 3]);
  assert.equal(second.runtime.view().snapshots['observer-1'].map.round, 3);
});

test('corrupt, incomplete and wrong-match journals abort startup', t => {
  const path = tmp(t);
  writeFileSync(path, '{"incomplete":true}');
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token: secret, journalPath: path,
  }), /incomplete/);
  writeFileSync(path, '{broken}\n');
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token: secret, journalPath: path,
  }), /Corrupted/);
  const bad = { version: 1, matchId: 'other', sourceId: 'observer-1',
    eventId: 'observer-1:1', type: 'observer.snapshot', sequence: 1,
    occurredAt: 1000, payload: { provider: { name: 'Counter-Strike 2' } } };
  writeFileSync(path, JSON.stringify(bad) + '\n');
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token: secret, journalPath: path,
  }), /recovery failed/);
});

test('journal limit fails the HTTP write without changing engine sequence', async t => {
  const path = tmp(t);
  const time = { value: 1000 };
  const { runtime, url } = await launch(path, time);
  t.after(() => runtime.close());
  t.after(() => runtime.close());
  assert.equal((await send(url, 1)).status, 202);
  const firstLength = readFileSync(path).length;
  // A second restart with a limit barely larger than one record
  await runtime.close();
  const resumed = createBroadcastRuntime({
    matchId: 'match-1', token: secret, journalPath: path,
    maxJournalBytes: firstLength + 1, port: 0, clock: () => time.value,
  });
  const address = await resumed.listen();
  t.after(() => resumed.close());
  const endpoint = `http://127.0.0.1:${address.port}/gsi`;
  assert.equal((await send(endpoint, 2)).status, 503);
  assert.equal(resumed.stats().eventCount, 1);
  assert.equal(readFileSync(path).length, firstLength);
});

test('journal reads its persisted data without exposing the token', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path });
  journal.append([{ sequence: 1, matchId: 'match-1' }]);
  assert.deepEqual(journal.read(), [{ sequence: 1, matchId: 'match-1' }]);
  assert.equal(readFileSync(path, 'utf8').includes(secret), false);
});

test('automatically rotates journal segments and replays all records in order', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path, segmentBytes: 160, maxBytes: 3000 });
  const events = Array.from({ length: 12 }, (_, index) => ({
    sequence: index + 1, matchId: 'match-1', payload: 'data'.repeat(8),
  }));
  for (const event of events) journal.append([event]);
  assert.ok(journal.stats().segmentCount > 1);
  assert.deepEqual(journal.read(), events);
  const recovered = createEventJournal({ filePath: path, segmentBytes: 160, maxBytes: 3000 });
  assert.deepEqual(recovered.read(), events);
  recovered.append([{ sequence: 13, matchId: 'match-1' }]);
  assert.equal(createEventJournal({ filePath: path, segmentBytes: 160, maxBytes: 3000 })
    .read().at(-1).sequence, 13);
});

test('fails closed on missing or truncated journal segments', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path, segmentBytes: 160 });
  for (let i = 1; i <= 5; i++) {
    journal.append([{ sequence: i, payload: 'value'.repeat(8) }]);
  }
  const numbered = path + '.000001';
  assert.equal(readFileSync(numbered).length > 0, true);
  writeFileSync(numbered, '{"partial":true}');
  assert.throws(() => createEventJournal({ filePath: path, segmentBytes: 160 }), /incomplete/);
});

test('fails closed on missing intermediate segment', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path, segmentBytes: 140 });
  for (let i = 1; i <= 5; i++) {
    journal.append([{ sequence: i, payload: 'value'.repeat(8) }]);
  }
  assert.ok(journal.stats().segmentCount > 2);
  unlinkSync(path + '.000001');
  assert.throws(() => createEventJournal({ filePath: path, segmentBytes: 140 }), /gap/);
});

test('enforces an aggregate byte limit across segments', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path, maxBytes: 350, segmentBytes: 140 });
  let accepted = 0;
  while (true) {
    try {
      journal.append([{ sequence: ++accepted, payload: 'value'.repeat(8) }]);
    } catch (error) {
      assert.match(error.message, /capacity/);
      break;
    }
  }
  assert.ok(journal.stats().segmentCount > 1);
  assert.ok(journal.stats().totalBytes <= 350);
  assert.equal(journal.read().length, accepted - 1);
});

test('detects external changes to active journal before appending', t => {
  const path = tmp(t);
  const journal = createEventJournal({ filePath: path });
  journal.append([{ sequence: 1 }]);
  writeFileSync(path, 'tampered');
  assert.throws(() => journal.append([{ sequence: 2 }]), /modified/);
});
