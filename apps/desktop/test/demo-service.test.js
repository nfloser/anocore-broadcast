import assert from 'node:assert/strict';
import test from 'node:test';
import { startDesktopDemo } from '../src/demo-service.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('desktop demo drives the existing GSI/engine/HUD pipeline and cleans up', async () => {
  const started = await startDesktopDemo({ receiverPort: 0, overlayPort: 0, intervalMs: 250 });
  assert.equal(started.mode, 'demo');
  assert.deepEqual(started.getStatus(), {
    mode: 'demo', connection: 'synthetic', ageMs: null,
    diagnostics: { code: 'demo', ageSeconds: null },
  });
  const stateUrl = started.hudUrl + 'api/state';
  try {
    const response = await fetch(stateUrl);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.demo, true);
    assert.equal(data.status, 'live');
    assert.equal(data.players.length, 10);
    assert.equal(data.radar.kind, 'synthetic');
    assert.equal(data.radar.markers.length, 10);
    assert.equal(JSON.stringify(data).includes('auth'), false);
    assert.equal(JSON.stringify(data).includes('765611980'), false);
  } finally {
    await started.close();
    await started.close();
  }
  await assert.rejects(fetch(stateUrl));
});

test('a second desktop demo fails on occupied ports without interrupting the first', async () => {
  const first = await startDesktopDemo({ receiverPort: 0, overlayPort: 0 });
  const port = Number(new URL(first.hudUrl).port);
  try {
    await assert.rejects(startDesktopDemo({ receiverPort: 0, overlayPort: port }),
      /EADDRINUSE/);
    const result = await fetch(first.hudUrl + 'api/state');
    assert.equal((await result.json()).status, 'live');
  } finally {
    await first.close();
  }
});

test('desktop demo can restart after releasing its ports', async () => {
  const first = await startDesktopDemo({ receiverPort: 0, overlayPort: 0 });
  const port = Number(new URL(first.hudUrl).port);
  await first.close();
  const next = await startDesktopDemo({ receiverPort: 0, overlayPort: port });
  try {
    assert.equal((await (await fetch(next.hudUrl + 'api/state')).json()).demo, true);
  } finally {
    await next.close();
  }
});

test('invalid polling options reject before starting sockets', async () => {
  await assert.rejects(startDesktopDemo({ intervalMs: 0 }), /Invalid demo interval/);
});

test('desktop operator settings update the HUD immediately and persist across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'anocore-desktop-controls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, 'operator.json');
  const first = await startDesktopDemo({
    receiverPort: 0, overlayPort: 0, settingsPath, intervalMs: 250,
  });
  const firstUrl = first.hudUrl + 'api/state';
  try {
    const initial = await (await fetch(firstUrl)).json();
    assert.equal(initial.settings.ctName, 'COUNTER-TERRORISTS');
    assert.equal(initial.players.length, 10);
    assert.equal(first.getSettings().showRoster, true);

    const applied = first.updateSettings({
      ctName: 'Team Alpha', tName: 'Team Beta',
      ctColor: '#1277aA', tColor: '#e0b144', showRoster: false,
    });
    assert.equal(applied.ctName, 'Team Alpha');
    const after = await (await fetch(firstUrl)).json();
    assert.equal(after.settings.ctName, 'Team Alpha');
    assert.equal(after.settings.tName, 'Team Beta');
    assert.equal(after.settings.ctColor, '#1277aA');
    assert.equal(after.settings.showRoster, false);
    assert.deepEqual(after.players, []);
    assert.equal(after.demo, true);
    assert.equal(after.radar.kind, 'synthetic');
    assert.throws(() => first.updateSettings({ ctName: '<script>' }), /Invalid team name/);
    assert.equal(first.getSettings().ctName, 'Team Alpha');
    assert.equal(readFileSync(settingsPath, 'utf8').includes('desktop-demo'), false);
  } finally {
    await first.close();
  }

  const restarted = await startDesktopDemo({
    receiverPort: 0, overlayPort: 0, settingsPath,
  });
  try {
    assert.equal(restarted.getSettings().ctName, 'Team Alpha');
    assert.equal(restarted.getSettings().showRoster, false);
    const data = await (await fetch(restarted.hudUrl + 'api/state')).json();
    assert.equal(data.settings.tName, 'Team Beta');
    assert.deepEqual(data.players, []);
  } finally {
    await restarted.close();
  }
});

test('desktop IPC uses isolated controls renderer and never embeds reusable tokens', () => {
  const root = new URL('../src/', import.meta.url);
  const source = name => readFileSync(new URL(name, root), 'utf8');
  const main = source('main.cjs');
  const preload = source('controls-preload.cjs');
  const client = source('controls.js');
  const page = source('controls.html');
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /event\.senderFrame\s*!==\s*controlsWindow\.webContents\.mainFrame/);
  assert.match(main, /getSettings/);
  assert.match(main, /updateSettings/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /ipcRenderer\.invoke/);
  assert.match(preload, /broadcast:session:status/);
  assert.match(preload, /broadcast:diagnostics:copy/);
  assert.match(main, /requireControlsFrame\(event\);\s*return copySafeDiagnostics\(\)/);
  assert.match(main, /getDiagnosticReport\(\)/);
  assert.match(main, /Export CS2 GSI Config/);
  assert.match(main, /Start Live Observer/);
  assert.match(main, /safeStorage/);
  assert.match(main, /Reset saved GSI key/);
  assert.match(main, /credentialStore\.getOrCreate\(\)/);
  assert.match(main, /credentialStore\.reset\(\)/);
  assert.doesNotMatch(main, /console\.log/);
  assert.doesNotMatch(client, /innerHTML/);
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(main + preload + client, /7656119/);
});

test('live observer is unavailable until authenticated GSI arrives and hides demo radar', async () => {
  const { startDesktopLive } = await import('../src/live-service.js');
  const { createDemoFrame } = await import('../../overlay/src/demo-fixture.js');
  let now = 10_000;
  const key = 'desktop-live-test-secret-0123456789';
  const live = await startDesktopLive({
    receiverPort: 0, overlayPort: 0, token: key,
    clock: () => now, staleAfterMs: 1000,
  });
  try {
    assert.equal(live.getStatus().mode, 'live');
    assert.equal(live.getStatus().connection, 'waiting');
    const endpoint = live.hudUrl + 'api/state';
    const waiting = await (await fetch(endpoint)).json();
    assert.equal(waiting.status, 'unavailable');
    assert.equal(waiting.demo, undefined);
    assert.equal(waiting.radar, undefined);

    const config = live.getGsiConfig();
    assert.match(config, /gamestate_integration/i);
    assert.ok(config.includes(key));
    assert.ok(!JSON.stringify(waiting).includes(key));
    const result = await fetch(live.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createDemoFrame(3, key)),
    });
    assert.equal(result.status, 202);
    const state = await (await fetch(endpoint)).json();
    assert.equal(state.status, 'live');
    assert.equal(state.map, 'de_nuke');
    assert.equal(state.players.length, 10);
    assert.equal(state.demo, undefined);
    assert.equal(state.radar, undefined);
    assert.ok(!JSON.stringify(state).includes('position'));
    assert.ok(!JSON.stringify(state).includes(key));
    assert.equal(live.getStatus().connection, 'live');

    now = 11_001;
    const stale = await (await fetch(endpoint)).json();
    assert.deepEqual(stale.status, 'unavailable');
    assert.equal(live.getStatus().connection, 'stale');
  } finally {
    await live.close();
    await live.close();
  }
  await assert.rejects(fetch(live.hudUrl + 'api/state'));
});

test('live observer settings persist and malformed authentication is rejected', async t => {
  const { startDesktopLive } = await import('../src/live-service.js');
  const { createDemoFrame } = await import('../../overlay/src/demo-fixture.js');
  const dir = mkdtempSync(join(tmpdir(), 'anocore-live-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'operator.json');
  const live = await startDesktopLive({
    receiverPort: 0, overlayPort: 0,
    token: 'desktop-live-test-secret-0123456789', settingsPath: filePath,
  });
  try {
    assert.equal(live.updateSettings({ ctName: 'Live Team', showRoster: false }).ctName, 'Live Team');
    const unauthorized = createDemoFrame(1, 'wrong-token');
    assert.equal((await fetch(live.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(unauthorized),
    })).status, 401);
    const state = await (await fetch(live.hudUrl + 'api/state')).json();
    assert.equal(state.status, 'unavailable');
    assert.equal(state.settings.ctName, 'Live Team');
    assert.ok(!readFileSync(filePath, 'utf8').includes('desktop-live-test-secret'));
  } finally {
    await live.close();
  }
});

test('live config escapes no user data and rejects unsafe token and ports', async () => {
  const { createObserverConfig } = await import('../src/gsi-config.js');
  const key = 'a'.repeat(64);
  const config = createObserverConfig({ token: key, port: 3008 });
  assert.ok(config.includes('"token" "' + key + '"'));
  assert.ok(config.includes('http://127.0.0.1:3008/gsi'));
  assert.ok(config.includes('"allplayers_weapons" "1"'));
  for (const invalid of ['short', 'abc"\n"uri" "evil', ' '.repeat(40), 'ä'.repeat(40)]) {
    assert.throws(() => createObserverConfig({ token: invalid, port: 3008 }));
  }
  assert.throws(() => createObserverConfig({ token: key, port: 0 }));
  assert.throws(() => createObserverConfig({ token: key, port: 70000 }));
});

test('mode manager stops old service and restores demo after failed live launch', async () => {
  const { createDesktopModes } = await import('../src/modes.js');
  const calls = [];
  const manager = createDesktopModes({
    demo: async () => ({ mode: 'demo', close: async () => { calls.push('close demo'); } }),
    live: async () => { calls.push('start live'); throw new Error('Port occupied'); },
  });
  await manager.switchTo('demo');
  await assert.rejects(manager.switchTo('live'), /Port occupied/);
  assert.equal(manager.current?.mode, 'demo');
  assert.deepEqual(calls, ['close demo', 'start live']);
  await manager.close();
  assert.deepEqual(calls, ['close demo', 'start live', 'close demo']);
  await assert.rejects(manager.switchTo('invalid'), /Unknown broadcast mode/);
});

test('mode manager switches successfully with orderly cleanup', async () => {
  const { createDesktopModes } = await import('../src/modes.js');
  const calls = [];
  function factory(mode) {
    return async () => {
      calls.push('start ' + mode);
      return { mode, close: async () => { calls.push('stop ' + mode); } };
    };
  }
  const manager = createDesktopModes({ demo: factory('demo'), live: factory('live') });
  await manager.switchTo('demo');
  await manager.switchTo('live');
  assert.equal(manager.current.mode, 'live');
  await manager.close();
  assert.deepEqual(calls, ['start demo', 'stop demo', 'start live', 'stop live']);
});

test('desktop shutdown waits for an in-flight mode switch and closes new listeners', async () => {
  const { createDesktopModes } = await import('../src/modes.js');
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = createDesktopModes({
    demo: async () => ({ mode: 'demo', close: async () => calls.push('close demo') }),
    live: async () => {
      await gate;
      return { mode: 'live', close: async () => calls.push('close live') };
    },
  });
  await manager.switchTo('demo');
  const launch = manager.switchTo('live');
  const stop = manager.close();
  release();
  await launch;
  await stop;
  assert.equal(manager.current, null);
  assert.deepEqual(calls, ['close demo', 'close live']);
  await assert.rejects(manager.switchTo('demo'), /closed/);
});

test('real desktop services switch Demo -> Live -> Demo on the same ports', async () => {
  const { createDesktopModes } = await import('../src/modes.js');
  const { startDesktopLive } = await import('../src/live-service.js');
  const { createDemoFrame } = await import('../../overlay/src/demo-fixture.js');
  const { createServer } = await import('node:net');
  async function unusedPort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
  }
  const receiverPort = await unusedPort();
  const overlayPort = await unusedPort();
  const key = 'mode-switch-test-secret-0123456789';
  const modes = createDesktopModes({
    demo: () => startDesktopDemo({ receiverPort, overlayPort }),
    live: () => startDesktopLive({ receiverPort, overlayPort, token: key }),
  });
  try {
    const demo = await modes.switchTo('demo');
    assert.equal(demo.mode, 'demo');
    const endpoint = demo.hudUrl + 'api/state';
    const initial = await (await fetch(endpoint)).json();
    assert.equal(initial.demo, true);
    assert.equal(initial.radar.kind, 'synthetic');

    const live = await modes.switchTo('live');
    assert.equal(live.mode, 'live');
    const waiting = await (await fetch(endpoint)).json();
    assert.equal(waiting.status, 'unavailable');
    assert.equal(waiting.demo, undefined);
    assert.equal(waiting.radar, undefined);
    assert.equal((await fetch(live.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createDemoFrame(1, key)),
    })).status, 202);
    const observed = await (await fetch(endpoint)).json();
    assert.equal(observed.status, 'live');
    assert.equal(observed.demo, undefined);

    const restored = await modes.switchTo('demo');
    assert.equal(restored.mode, 'demo');
    const again = await (await fetch(endpoint)).json();
    assert.equal(again.demo, true);
    assert.equal(again.radar.kind, 'synthetic');
  } finally {
    await modes.close();
  }
});

test('guided setup IPC exposes only explicit safe actions to the trusted operator frame', () => {
  const source = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const main = source('main.cjs');
  const preload = source('controls-preload.cjs');
  const html = source('controls.html');
  const client = source('controls.js');
  for (const action of ['mode:switch', 'gsi:export', 'obs:copy']) {
    assert.ok(main.includes('broadcast:' + action));
    assert.ok(preload.includes('broadcast:' + action));
  }
  assert.match(main, /requireControlsFrame\(event\)/);
  assert.match(main, /return switchMode\(mode\)/);
  assert.match(main, /return exportGsiConfig\(\)/);
  assert.match(main, /return copyObsUrl\(\)/);
  for (const id of ['setup-demo', 'setup-live', 'setup-export', 'setup-obs', 'setup-result']) {
    assert.ok(html.includes('id="' + id + '"'));
    assert.ok(client.includes("'" + id + "'"));
  }
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(client, /innerHTML|eval\(/);
  assert.doesNotMatch(preload, /getGsiConfig|credentialStore|\btoken\b/);
});

test('operator controls map every DOM element they read and never remove controls on setup', () => {
  const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
  const client = source('controls.js');
  const page = source('controls.html');
  const list = client.match(/const ids = \[([^\]]+)\];/);
  assert.ok(list, 'Controls element mapping exists');
  for (const id of list[1].matchAll(/'([^']+)'/g)) {
    assert.ok(page.includes('id="' + id[1] + '"'), 'Missing control: ' + id[1]);
  }
  assert.ok(client.includes("elements['session-panel']"));
  assert.ok(client.includes("elements['setup-export']"));
  assert.ok(page.includes('id="controls"'));
  assert.ok(page.includes('id="ctName"'));
});
