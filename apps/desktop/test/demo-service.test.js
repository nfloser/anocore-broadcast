import assert from 'node:assert/strict';
import test from 'node:test';
import { startDesktopDemo } from '../src/demo-service.js';

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
