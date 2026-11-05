const ids = ['controls', 'ctName', 'tName', 'ctColor', 'tColor', 'showRoster', 'apply', 'message'];
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
load();
