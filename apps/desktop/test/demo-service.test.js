import assert from 'node:assert/strict';
import test from 'node:test';
import { startDesktopDemo } from '../src/demo-service.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('desktop demo drives the existing GSI/engine/HUD pipeline and cleans up', async () => {
  const started = await startDesktopDemo({ receiverPort: 0, overlayPort: 0, intervalMs: 250 });
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
  assert.doesNotMatch(client, /innerHTML/);
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(main + preload + client, /7656119/);
});
