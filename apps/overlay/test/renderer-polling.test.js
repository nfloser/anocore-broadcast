import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../static/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../static/overlay.js', import.meta.url), 'utf8');

function createHud() {
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
  function element() {
    return {
      textContent: '', hidden: false, dataset: {}, style: { setProperty() {} },
      classList: { toggle() {} }, replaceChildren() {}, append() {},
    };
  }
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const requests = [];
  const intervals = [];
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
  return { elements, requests, intervals, frame, complete, settle };
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
