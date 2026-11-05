const ids = ['controls', 'ctName', 'tName', 'ctColor', 'tColor', 'showRoster', 'apply', 'message', 'session-status', 'session-help'];
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
    showStatus('Connected to local demo');
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
async function refreshStatus() {
  try {
    const state = await window.broadcastControls.getStatus();
    const connection = state.connection === 'synthetic' ? 'Synthetic demo' :
      state.connection === 'waiting' ? 'Waiting for CS2 observer' :
      state.connection === 'live' ? 'Receiving observer data' :
      state.connection === 'stale' ? 'Observer data stale' : 'Unavailable';
    elements['session-status'].textContent =
      (state.mode === 'live' ? 'LIVE OBSERVER' : 'DEMO') + ' · ' + connection;
    elements['session-help'].textContent = state.mode === 'live' ?
      'Use Broadcast → Export CS2 GSI Config to connect a local CS2 spectator.' :
      'Synthetic fixture data. Use Broadcast → Start Live Observer for real GSI.';
  } catch {
    elements['session-status'].textContent = 'Connection status unavailable';
  }
}
load();
refreshStatus();
setInterval(refreshStatus, 2000);
