const ids = ['token','ctName','tName','ctColor','tColor','showRoster','result','operator','connect'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let authorizedToken = null;
const fields = ['ctName','tName','ctColor','tColor','showRoster'];
function say(message) { ui.result.textContent = message; }
function headers() { return { authorization: 'Bearer ' + authorizedToken }; }
function fill(data) {
  for (const key of fields) {
    if (key === 'showRoster') ui[key].checked = data[key] === true;
    else ui[key].value = data[key];
  }
}
ui.connect.addEventListener('click', async () => {
  authorizedToken = ui.token.value;
  ui.token.value = '';
  try {
    const response = await fetch('/api/config', { headers: headers(), cache: 'no-store' });
    if (!response.ok) throw new Error('Authorization failed (' + response.status + ')');
    fill(await response.json());
    say('Connected. You can edit the broadcast settings.');
  } catch (error) {
    authorizedToken = null;
    say(error.message);
  }
});
ui.operator.addEventListener('submit', async event => {
  event.preventDefault();
  if (!authorizedToken) { say('Connect with the operator token first.'); return; }
  const body = Object.fromEntries(fields.map(key => [
    key, key === 'showRoster' ? ui[key].checked : ui[key].value,
  ]));
  try {
    const response = await fetch('/api/config', {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Rejected settings (' + response.status + ')');
    fill(await response.json());
    say('Applied to the local HUD.');
  } catch (error) {
    say(error.message);
  }
});
