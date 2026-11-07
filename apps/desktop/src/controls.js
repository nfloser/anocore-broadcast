const ids = ['controls', 'ctName', 'tName', 'ctColor', 'tColor', 'showRoster', 'apply', 'message', 'session-status', 'session-help', 'session-panel', 'session-age', 'setup-demo', 'setup-live', 'setup-export', 'setup-obs', 'setup-result', 'setup-diagnostics'];
const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const fields = ['ctName', 'tName', 'ctColor', 'tColor', 'showRoster'];
function showStatus(message) { elements.message.textContent = message; }
function fill(settings) {
  for (const name of fields) {
    if (name === 'showRoster') elements[name].checked = settings[name] === true;
    else elements[name].value = settings[name];
  }
}
async function load() {
  try {
    fill(await window.broadcastControls.getSettings());
    showStatus('Operator controls ready');
  } catch {
    showStatus('Cannot load operator settings');
    elements.apply.disabled = true;
  }
}
elements.controls.addEventListener('submit', async event => {
  event.preventDefault();
  elements.apply.disabled = true;
  showStatus('Applying…');
  const changes = Object.fromEntries(fields.map(key => [
    key, key === 'showRoster' ? elements[key].checked : elements[key].value,
  ]));
  try {
    fill(await window.broadcastControls.updateSettings(changes));
    showStatus('Applied and saved');
  } catch {
    showStatus('Settings rejected. Check team names and colors.');
  } finally {
    elements.apply.disabled = false;
  }
});
const help = Object.freeze({
  demo: {
    heading: 'DEMO · SYNTHETIC DATA',
    message: 'The preview uses generated 5v5 data. Choose Broadcast → Start Live Observer to connect CS2.',
  },
  waiting: {
    heading: 'LIVE · WAITING FOR CS2',
    message: 'No authenticated GSI update has arrived yet. Verify that Live Observer is running, export the local CS2 GSI CFG into game/csgo/cfg, restart CS2 and join an observer/spectator session. This does not identify a specific connection failure.',
  },
  connected: {
    heading: 'LIVE · RECEIVING GSI',
    message: 'Authenticated GSI updates are arriving. This does not yet verify GOTV synchronization or broadcast accuracy.',
  },
  stale: {
    heading: 'LIVE · GSI INTERRUPTED',
    message: 'No recent authenticated update. Check whether CS2 is still running as observer, whether the match or connection changed, and whether the local GSI CFG still uses the saved key.',
  },
  unavailable: {
    heading: 'CONNECTION STATUS UNAVAILABLE',
    message: 'The operator connection state cannot be verified. Check that the desktop preview is still running.',
  },
});
let setupBusy = false;
function displayConnection(state) {
  const diagnostic = state && typeof state.diagnostics === 'object' ?
    state.diagnostics : {};
  const code = Object.hasOwn(help, diagnostic.code) ?
    diagnostic.code : 'unavailable';
  const display = help[code];
  const age = Number.isSafeInteger(diagnostic.ageSeconds) &&
    diagnostic.ageSeconds >= 0 && diagnostic.ageSeconds <= 86400 ?
      diagnostic.ageSeconds : null;
  elements['session-status'].textContent = display.heading;
  elements['session-help'].textContent = display.message;
  elements['session-age'].textContent =
    age === null || code === 'waiting' || code === 'demo' ?
      'No authenticated update timestamp available' :
      'Last authenticated GSI update: ' + age + ' s ago';
  elements['session-panel'].dataset.connection = code;
  if (!setupBusy) {
    elements['setup-export'].disabled = state?.mode !== 'live';
    elements['setup-demo'].disabled = state?.mode === 'demo';
    elements['setup-live'].disabled = state?.mode === 'live';
    elements['setup-diagnostics'].disabled = state?.mode !== 'live';
  }
}
async function refreshStatus() {
  try {
    displayConnection(await window.broadcastControls.getStatus());
  } catch {
    displayConnection({ diagnostics: { code: 'unavailable' } });
  }
}
load();
refreshStatus();
setInterval(refreshStatus, 2000);

function showSetupResult(value) {
  elements['setup-result'].textContent = value;
}
async function setupAction(action, successMessage) {
  if (setupBusy) return;
  setupBusy = true;
  for (const id of ['setup-demo', 'setup-live', 'setup-export', 'setup-obs', 'setup-diagnostics']) {
    elements[id].disabled = true;
  }
  showSetupResult('Working…');
  try {
    const result = await action();
    if (result?.ok === true) {
      showSetupResult(successMessage);
    } else if (result?.reason === 'cancelled') {
      showSetupResult('Cancelled. No changes were made.');
    } else {
      showSetupResult('Could not complete this step. Check the desktop dialog or connection.');
    }
  } catch {
    showSetupResult('Could not complete this step. Check the desktop connection.');
  } finally {
    setupBusy = false;
    await refreshStatus();
    elements['setup-obs'].disabled = false;
  }
}
elements['setup-demo'].addEventListener('click', () =>
  setupAction(() => window.broadcastControls.switchMode('demo'),
    'Demo mode enabled. Preview data is synthetic.'));
elements['setup-live'].addEventListener('click', () =>
  setupAction(() => window.broadcastControls.switchMode('live'),
    'Live Observer started. Export the CS2 GSI CFG if this is your first setup.'));
elements['setup-export'].addEventListener('click', () =>
  setupAction(() => window.broadcastControls.exportGsi(),
    'GSI CFG saved. Keep it private, restart CS2 and spectate a match.'));
elements['setup-obs'].addEventListener('click', () =>
  setupAction(() => window.broadcastControls.copyObs(),
    'OBS Browser Source URL copied to clipboard.'));

elements['setup-diagnostics'].addEventListener('click', () =>
  setupAction(() => window.broadcastControls.copySafeDiagnostics(),
    'Privacy-safe diagnostic summary copied. It contains no names, positions or credentials.'));
