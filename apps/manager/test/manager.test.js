import assert from 'node:assert/strict';
import test from 'node:test';
import { createBroadcastSettings } from '../src/settings.js';
import { createManagerServer } from '../src/server.js';
import { createOverlayServer } from '../../overlay/src/server.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const token = 'operator-secret-01234567890123456789';
test('setting changes are validated and atomically applied', () => {
  const settings = createBroadcastSettings();
  assert.equal(settings.get().showRoster, true);
  assert.throws(() => settings.update({ ctName: '<script>' }));
  assert.throws(() => settings.update({ ctColor: 'red' }));
  assert.throws(() => settings.update({ unknown: true }));
  assert.throws(() => settings.update({ showRoster: 'false' }));
  assert.equal(settings.get().ctName, 'COUNTER-TERRORISTS');
  settings.update({ ctName: 'AnoCore', ctColor: '#12aA99', showRoster: false });
  assert.deepEqual(settings.get(), {
    ctName: 'AnoCore', tName: 'TERRORISTS',
    ctColor: '#12aA99', tColor: '#dcbb5b', showRoster: false,
  });
  const copy = settings.get();
  copy.ctName = 'Changed';
  assert.equal(settings.get().ctName, 'AnoCore');
});
test('manager rejects public interface and missing credentials', () => {
  assert.throws(() => createManagerServer({
    token, settings: createBroadcastSettings(), host: '0.0.0.0',
  }), /loopback/);
  assert.throws(() => createManagerServer({
    token: 'short', settings: createBroadcastSettings(),
  }), /token/);
});
test('operator HTTP contract rejects unauthorized and cross-origin mutations', async t => {
  const settings = createBroadcastSettings();
  const instance = createManagerServer({ settings, token, port: 0 });
  const address = await instance.listen();
  t.after(() => instance.close());
  const base = 'http://127.0.0.1:' + address.port;
  const auth = { authorization: 'Bearer ' + token };
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/config')).status, 401);
  assert.equal((await fetch(base + '/api/config', { headers: auth })).status, 200);
  assert.equal((await fetch(base + '/api/config', {
    method: 'POST', headers: { ...auth, origin: 'https://evil.test', 'content-type': 'application/json' },
    body: JSON.stringify({ ctName: 'Bad' }),
  })).status, 403);
  assert.equal(settings.get().ctName, 'COUNTER-TERRORISTS');
  assert.equal((await fetch(base + '/api/config', {
    method: 'POST', headers: { ...auth, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ ctName: '<img src=x>', showRoster: false }),
  })).status, 400);
  assert.equal(settings.get().showRoster, true);
  const result = await fetch(base + '/api/config', {
    method: 'POST', headers: { ...auth, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ ctName: 'AnoCore', ctColor: '#ab12cd', showRoster: false }),
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).ctName, 'AnoCore');
  assert.equal(settings.get().showRoster, false);
  const response = await fetch(base + '/api/config', { headers: auth });
  assert.equal(JSON.stringify(await response.json()).includes(token), false);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('operator controls immediately affect the read-only OBS state without a restart', async t => {
  const settings = createBroadcastSettings();
  const overlay = createOverlayServer({
    port: 0,
    scoreboard: () => {
      const config = settings.get();
      return { status: 'live', ctScore: 2, tScore: 1,
        settings: config, players: config.showRoster ? [{ name: 'Nille', team: 'CT' }] : [] };
    },
  });
  const observer = await overlay.listen();
  t.after(() => overlay.close());
  const manager = createManagerServer({ settings, token, port: 0 });
  const operator = await manager.listen();
  t.after(() => manager.close());
  const overlayUrl = 'http://127.0.0.1:' + observer.port + '/api/state';
  const opUrl = 'http://127.0.0.1:' + operator.port;
  assert.equal((await (await fetch(overlayUrl)).json()).players.length, 1);
  const updated = await fetch(opUrl + '/api/config', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token, origin: opUrl,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ctName: 'Team Alpha', showRoster: false }),
  });
  assert.equal(updated.status, 200);
  const projected = await (await fetch(overlayUrl)).json();
  assert.equal(projected.settings.ctName, 'Team Alpha');
  assert.deepEqual(projected.players, []);
  assert.equal(JSON.stringify(projected).includes(token), false);
});

test('operator configuration round-trips through a versioned private file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'anocore-operator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'operator.json');
  const first = createBroadcastSettings({ filePath });
  first.update({ ctName: 'Team One', showRoster: false, tColor: '#11aa99' });
  const persisted = readFileSync(filePath, 'utf8');
  assert.equal(persisted.includes('Team One'), true);
  assert.equal(persisted.includes(token), false);
  const reopened = createBroadcastSettings({ filePath });
  assert.deepEqual(reopened.get(), first.get());
  reopened.update({ ctName: 'Updated' });
  assert.equal(createBroadcastSettings({ filePath }).get().ctName, 'Updated');
});

test('refuses corrupted and unsupported operator configs rather than guessing defaults', t => {
  const dir = mkdtempSync(join(tmpdir(), 'anocore-operator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'operator.json');
  writeFileSync(filePath, '{broken');
  assert.throws(() => createBroadcastSettings({ filePath }), /Invalid operator configuration file/);
  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1, settings: { ctName: '<script>' },
  }));
  assert.throws(() => createBroadcastSettings({ filePath }), /Invalid operator configuration file/);
  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2, settings: {},
  }));
  assert.throws(() => createBroadcastSettings({ filePath }), /Invalid operator configuration file/);
});

test('failed persistence does not change in-memory configuration', () => {
  const filePath = join(tmpdir(), 'no-such-directory-' + Date.now(), 'settings.json');
  const settings = createBroadcastSettings({ filePath });
  const before = settings.get();
  assert.throws(() => settings.update({ ctName: 'Changed' }));
  assert.deepEqual(settings.get(), before);
});
