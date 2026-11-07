import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const controlsSource = readFileSync(new URL('../src/controls.js', import.meta.url), 'utf8');
const controlsPage = readFileSync(new URL('../src/controls.html', import.meta.url), 'utf8');
const ids = [...controlsPage.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

function renderer() {
  const calls = [];
  const elements = Object.fromEntries(ids.map(id => [id, {
    id, value: '', textContent: '', checked: false, disabled: false, dataset: {},
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
  }]));
  const settings = {
    ctName: 'COUNTER-TERRORISTS', tName: 'TERRORISTS',
    ctColor: '#67addd', tColor: '#dcbb5b', showRoster: true,
  };
  let mode = 'demo';
  let diagnosticCode = 'demo';
  const api = {
    async getSettings() { calls.push('settings:get'); return { ...settings }; },
    async updateSettings(changes) {
      calls.push('settings:update');
      if (changes.ctName === '<script>') throw new Error('Invalid team name');
      Object.assign(settings, changes);
      return { ...settings };
    },
    async getStatus() {
      calls.push('status:get');
      return {
        mode,
        diagnostics: { code: diagnosticCode, ageSeconds: diagnosticCode === 'connected' ? 2 : null },
      };
    },
    async switchMode(value) {
      calls.push('mode:' + value);
      if (!['demo', 'live'].includes(value)) throw new Error('Invalid mode');
      mode = value;
      diagnosticCode = value === 'demo' ? 'demo' : 'waiting';
      return { ok: true, mode };
    },
    async exportGsi() { calls.push('export'); return { ok: true }; },
    async copyObs() { calls.push('copy'); return { ok: true }; },
    async copySafeDiagnostics() { calls.push('copy-safe-report'); return { ok: true }; },
  };
  const intervals = [];
  runInNewContext(controlsSource, {
    document: {
      getElementById(id) { return elements[id] ?? null; },
    },
    window: { broadcastControls: api },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    Object, Number,
  }, { timeout: 1000 });
  async function flush() {
    await new Promise(resolve => setImmediate(resolve));
  }
  async function click(id) {
    const element = elements[id];
    assert.ok(element, 'missing DOM control ' + id);
    assert.equal(element.disabled, false, 'disabled ' + id);
    const handler = element.listeners.get('click');
    assert.equal(typeof handler, 'function', 'missing click handler for ' + id);
    await handler();
    await flush();
  }
  async function submit(changes) {
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'showRoster') elements[key].checked = value;
      else elements[key].value = value;
    }
    const callback = elements.controls.listeners.get('submit');
    assert.equal(typeof callback, 'function');
    await callback({ preventDefault() {} });
    await flush();
  }
  return { elements, calls, api, intervals, flush, click, submit, setDiagnostic(code) {
    diagnosticCode = code;
  } };
}

test('real operator renderer initializes correctly with sandboxed IPC facade', async () => {
  const ui = renderer();
  await ui.flush();
  assert.equal(ui.elements.ctName.value, 'COUNTER-TERRORISTS');
  assert.equal(ui.elements.showRoster.checked, true);
  assert.match(ui.elements['session-status'].textContent, /DEMO/);
  assert.equal(ui.elements['setup-demo'].disabled, true);
  assert.equal(ui.elements['setup-live'].disabled, false);
  assert.equal(ui.elements['setup-export'].disabled, true);
  assert.equal(ui.intervals.length, 1);
  assert.equal(ui.intervals[0].ms, 2000);
});

test('click Live, export GSI, copy OBS, and return to Demo through actual handlers', async () => {
  const ui = renderer();
  await ui.flush();
  await ui.click('setup-live');
  assert.ok(ui.calls.includes('mode:live'));
  assert.equal(ui.elements['setup-result'].textContent.includes('Live Observer started'), true);
  assert.equal(ui.elements['setup-export'].disabled, false);
  assert.match(ui.elements['session-status'].textContent, /WAITING/);
  await ui.click('setup-export');
  assert.ok(ui.calls.includes('export'));
  assert.match(ui.elements['setup-result'].textContent, /CFG saved/);
  await ui.click('setup-obs');
  assert.ok(ui.calls.includes('copy'));
  assert.match(ui.elements['setup-result'].textContent, /copied/);
  await ui.click('setup-demo');
  assert.ok(ui.calls.includes('mode:demo'));
  assert.equal(ui.elements['setup-export'].disabled, true);
  assert.match(ui.elements['session-status'].textContent, /DEMO/);
});

test('cancellation and failures never report CFG export success', async () => {
  const ui = renderer();
  await ui.flush();
  await ui.click('setup-live');
  ui.api.exportGsi = async () => ({ ok: false, reason: 'cancelled' });
  await ui.click('setup-export');
  assert.match(ui.elements['setup-result'].textContent, /Cancelled/);
  ui.api.exportGsi = async () => { throw new Error('secret details must not be exposed'); };
  await ui.click('setup-export');
  assert.match(ui.elements['setup-result'].textContent, /Could not complete/);
  assert.doesNotMatch(ui.elements['setup-result'].textContent, /secret details|CFG saved/);
  await ui.click('setup-obs');
  assert.match(ui.elements['setup-result'].textContent, /copied/);
});

test('operator settings retain valid edits and reject invalid changes', async () => {
  const ui = renderer();
  await ui.flush();
  await ui.submit({ ctName: 'Ano Blue', tName: 'Ano Gold', showRoster: false });
  assert.match(ui.elements.message.textContent, /Applied and saved/);
  assert.ok(ui.calls.includes('settings:update'));
  assert.equal(ui.elements.showRoster.checked, false);
  await ui.submit({ ctName: '<script>' });
  assert.match(ui.elements.message.textContent, /rejected/);
  assert.equal(ui.elements.apply.disabled, false);
});

test('busy setup actions cannot launch concurrent mode switches', async () => {
  const ui = renderer();
  await ui.flush();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  ui.api.switchMode = async mode => {
    ui.calls.push('mode:' + mode);
    await gate;
    return { ok: true, mode };
  };
  const first = ui.elements['setup-live'].listeners.get('click')();
  assert.equal(ui.elements['setup-live'].disabled, true);
  // Invoke the event handler directly to test the in-flight guard.
  await ui.elements['setup-live'].listeners.get('click')();
  assert.equal(ui.calls.filter(x => x === 'mode:live').length, 1);
  release();
  await first;
  await ui.flush();
});

test('safe diagnostics copy is disabled in Demo and enabled only in Live', async () => {
  const ui = renderer();
  await ui.flush();
  assert.equal(ui.elements['setup-diagnostics'].disabled, true);
  await ui.click('setup-live');
  assert.equal(ui.elements['setup-diagnostics'].disabled, false);
  await ui.click('setup-diagnostics');
  assert.ok(ui.calls.includes('copy-safe-report'));
  assert.match(ui.elements['setup-result'].textContent, /Privacy-safe/);
  ui.api.copySafeDiagnostics = async () => ({ ok: false, reason: 'unavailable' });
  await ui.click('setup-diagnostics');
  assert.match(ui.elements['setup-result'].textContent, /Could not complete/);
  await ui.click('setup-demo');
  assert.equal(ui.elements['setup-diagnostics'].disabled, true);
});
