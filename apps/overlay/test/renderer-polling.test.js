import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../static/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../static/overlay.js', import.meta.url), 'utf8');

function createHud() {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  function element() {
    return {
      textContent: '', hidden: false, dataset: {}, style: { setProperty() {} },
      classList: { toggle() {} }, replaceChildren() {}, append() {},
    };
  }
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const requests = [];
  const intervals = [];
  const deadlines = new Map();
  let currentTime = 0;
  let nextDeadlineId = 0;
  class FakeAbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  const document = {
    getElementById: id => elements[id] ?? null,
    querySelector: selector => selector === '.broadcast-stage' ? element() : null,
    documentElement: element(),
    createElement: () => element(),
  };
  runInNewContext(source, {
    document,
    fetch: (url, options) => new Promise((resolve, reject) => {
      requests.push({ url, options, resolve, reject });
    }),
    setInterval: (handler, ms) => { intervals.push({ handler, ms }); },
    setTimeout: (handler, ms) => {
      const id = ++nextDeadlineId;
      deadlines.set(id, { handler, due: currentTime + ms });
      return id;
    },
    clearTimeout: id => deadlines.delete(id),
    AbortController: FakeAbortController,
    Date: { now: () => currentTime },
    String, Number, Object, Array,
  }, { timeout: 1000 });
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 500);
  function frame({ round = 1, ctScore = 0, tScore = 0 } = {}) {
    return {
      status: 'live', map: 'de_inferno', mapPhase: 'live', round,
      ctScore, tScore, roundPhase: 'live', bombState: null,
      countdownSeconds: null, players: [],
    };
  }
  function complete(index, state) {
    requests[index].resolve({
      ok: true,
      async json() { return state; },
    });
  }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); }
  function advance(ms) {
    currentTime += ms;
    for (const [id, timer] of deadlines) {
      if (timer.due <= currentTime) {
        deadlines.delete(id);
        timer.handler();
      }
    }
  }
  return { elements, requests, intervals, deadlines, frame, complete, settle, advance };
}

test('old OBS fetch cannot replace a newer scoreboard', async () => {
  const hud = createHud();
  assert.equal(hud.requests.length, 1);
  hud.intervals[0].handler();
  hud.complete(1, hud.frame({ round: 12, ctScore: 8, tScore: 4 }));
  await hud.settle();
  assert.equal(hud.elements.round.textContent, 'ROUND 12');
  assert.equal(hud.elements['ct-score'].textContent, '8');
  hud.complete(0, hud.frame({ round: 11, ctScore: 7, tScore: 4 }));
  await hud.settle();
  assert.equal(hud.elements.round.textContent, 'ROUND 12');
  assert.equal(hud.elements['ct-score'].textContent, '8');
});

test('older OBS request failure cannot blank a newer successful frame', async () => {
  const hud = createHud();
  hud.intervals[0].handler();
  hud.complete(1, hud.frame({ round: 3, ctScore: 2, tScore: 1 }));
  await hud.settle();
  hud.requests[0].reject(new Error('old disconnected request'));
  await hud.settle();
  assert.equal(hud.elements.round.textContent, 'ROUND 3');
  assert.equal(hud.elements['ct-score'].textContent, '2');
  assert.equal(hud.elements.notice.hidden, true);
});

test('latest OBS request failure still blanks live graphics', async () => {
  const hud = createHud();
  hud.complete(0, hud.frame({ round: 3, ctScore: 2, tScore: 1 }));
  await hud.settle();
  hud.intervals[0].handler();
  hud.requests[1].reject(new Error('current disconnected request'));
  await hud.settle();
  assert.equal(hud.elements.round.textContent, 'WAITING FOR DATA');
  assert.equal(hud.elements['ct-score'].textContent, '—');
  assert.equal(hud.elements.notice.hidden, false);
});

test('synthetic watermark clears on real Live and returns on Demo without reload', async () => {
  const hud = createHud();
  hud.complete(0, { ...hud.frame(), demo: true, radar: { kind: 'synthetic', markers: [] } });
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, false);
  assert.equal(hud.elements['radar-preview'].hidden, false);

  hud.intervals[0].handler();
  hud.complete(1, hud.frame({ round: 15, ctScore: 9, tScore: 6 }));
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, true);
  assert.equal(hud.elements['radar-preview'].hidden, true);

  hud.intervals[0].handler();
  hud.complete(2, { ...hud.frame({ round: 2 }), demo: true,
    radar: { kind: 'synthetic', markers: [] } });
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, false);
  assert.equal(hud.elements['radar-preview'].hidden, false);
});

test('temporary unavailable response retains known synthetic warning without fake scores', async () => {
  const hud = createHud();
  hud.complete(0, { ...hud.frame(), demo: true });
  await hud.settle();
  hud.intervals[0].handler();
  hud.requests[1].reject(new Error('failed demo poll'));
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, false);
  assert.equal(hud.elements['ct-score'].textContent, '—');
  assert.equal(hud.elements.notice.hidden, false);
});

test('known Live waiting state clears Demo watermark before the first GSI frame', async () => {
  const hud = createHud();
  hud.complete(0, { ...hud.frame(), demo: true, radar: { kind: 'synthetic', markers: [] } });
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, false);
  hud.intervals[0].handler();
  hud.complete(1, { status: 'unavailable', demo: false, settings: {
    ctName: 'CT', tName: 'T', ctColor: '#123456', tColor: '#abcdef',
    showRoster: true,
  } });
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, true);
  assert.equal(hud.elements['radar-preview'].hidden, true);
  assert.equal(hud.elements['ct-score'].textContent, '—');
  assert.equal(hud.elements.notice.hidden, false);
  // A transport failure without a mode hint must not invent a source switch.
  hud.intervals[0].handler();
  hud.requests[2].reject(new Error('temporary polling failure'));
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, true);
  hud.intervals[0].handler();
  hud.complete(3, { ...hud.frame(), demo: true });
  await hud.settle();
  assert.equal(hud.elements['demo-mark'].hidden, false);
});

test('hung OBS fetches cannot leave previous live scores visible after silence threshold', async () => {
  const hud = createHud();
  hud.complete(0, hud.frame({ round: 18, ctScore: 11, tScore: 7 }));
  await hud.settle();
  assert.equal(hud.elements['ct-score'].textContent, '11');
  hud.advance(3001);
  hud.intervals[0].handler();
  await hud.settle();
  assert.equal(hud.elements['ct-score'].textContent, '—');
  assert.equal(hud.elements.round.textContent, 'WAITING FOR DATA');
  assert.equal(hud.elements.notice.hidden, false);
  // A healthy update after the outage restores the real, current score.
  hud.complete(1, hud.frame({ round: 19, ctScore: 12, tScore: 7 }));
  await hud.settle();
  assert.equal(hud.elements['ct-score'].textContent, '12');
  assert.equal(hud.elements.round.textContent, 'ROUND 19');
});

test('OBS polling enforces deadlines and caps outstanding requests that ignore abort', async () => {
  const hud = createHud();
  for (let i = 0; i < 20; i++) hud.intervals[0].handler();
  assert.ok(hud.requests.length <= 4, 'unbounded pending HTTP requests');
  assert.equal(hud.deadlines.size, hud.requests.length);
  hud.advance(2001);
  await hud.settle();
  assert.equal(hud.deadlines.size, 0);
  assert.ok(hud.requests.every(request => request.options.signal.aborted));
  const issuedBefore = hud.requests.length;
  hud.intervals[0].handler();
  assert.equal(hud.requests.length, issuedBefore + 1);
  hud.complete(0, hud.frame({ round: 6, ctScore: 3 }));
  await hud.settle();
  assert.notEqual(hud.elements.round.textContent, 'ROUND 6',
    'late completion after expiry resurrected an old result');
  hud.complete(issuedBefore, hud.frame({ round: 8, ctScore: 5 }));
  await hud.settle();
  assert.equal(hud.elements.round.textContent, 'ROUND 8');
  assert.equal(hud.elements['ct-score'].textContent, '5');
});
