import assert from 'node:assert/strict';
import test from 'node:test';
import { createBroadcastSettings } from '../src/settings.js';
import { createManagerServer } from '../src/server.js';

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
