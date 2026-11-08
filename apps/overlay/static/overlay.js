const elements = Object.fromEntries([
  'board', 'ct-score', 't-score', 'map', 'round', 'phase', 'notice',
  'roster', 'ct-players', 't-players', 'roster-notice', 'demo-mark',
  'ct-name', 't-name', 'ct-roster-name', 't-roster-name', 'reported-timer',
  'radar-preview', 'radar-grid', 'radar-markers', 'radar-warning',
].map(id => [id, document.getElementById(id)]));

function display(value, fallback = '—') {
  return value === null || value === undefined ? fallback : String(value);
}

function createPlayerRow(player) {
  const row = document.createElement('div');
  row.className = 'player';
  row.classList.toggle('dead', player.health === 0);
  const fields = [
    ['player-name', player.name ?? 'Player'],
    ['player-health', player.health === null ? 'HP —' : 'HP ' + player.health],
    ['player-kda', [player.kills, player.assists, player.deaths]
      .map(number => number === null ? '—' : number).join('/')],
    ['player-economy', player.money === null ? '—' : String.fromCharCode(36) + player.money],
    ['player-weapon', player.activeWeapon ?
      player.activeWeapon.replace(/^weapon_/, '').replaceAll('_', ' ').toUpperCase() : 'WEAPON —'],
    ['player-utility', player.utilityCount == null ? 'UTIL —' : 'UTIL ' + player.utilityCount],
  ];
  for (const [className, value] of fields) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = String(value);
    if (className === 'player-health') {
      const meter = document.createElement('span');
      meter.className = 'hp-meter';
      const fill = document.createElement('span');
      fill.className = 'hp-fill';
      const hp = Number.isInteger(player.health) ?
        Math.max(0, Math.min(100, player.health)) : 0;
      fill.style.width = hp + '%';
      meter.append(fill);
      element.append(meter);
    }
    row.append(element);
  }
  return row;
}

function drawRadar(radar, allowed) {
  const markers = Array.isArray(radar?.markers) ? radar.markers : [];
  if (!allowed || radar?.kind !== 'synthetic') {
    elements['radar-preview'].hidden = true;
    elements['radar-markers'].replaceChildren();
    return;
  }
  elements['radar-preview'].hidden = false;
  elements['radar-warning'].textContent = 'NOT A REAL MAP · DEMO ONLY';
  const dots = [];
  for (const marker of markers.slice(0, 10)) {
    if (!marker || !['CT', 'T'].includes(marker.team) ||
        !Number.isFinite(marker.x) || !Number.isFinite(marker.y) ||
        marker.x < 0 || marker.x > 1 || marker.y < 0 || marker.y > 1) continue;
    const dot = document.createElement('span');
    dot.className = 'radar-dot ' + (marker.team === 'CT' ? 'radar-ct' : 'radar-t');
    dot.classList.toggle('radar-dead', marker.alive === false);
    dot.style.left = (marker.x * 100) + '%';
    dot.style.top = (marker.y * 100) + '%';
    const title = typeof marker.label === 'string' ? marker.label.slice(0, 12) : 'Player';
    dot.title = title;
    dot.textContent = marker.team === 'CT' ? 'C' : 'T';
    if (typeof marker.heading === 'number' && Number.isFinite(marker.heading)) {
      dot.style.setProperty('--direction', marker.heading + 'rad');
    }
    dots.push(dot);
  }
  elements['radar-markers'].replaceChildren(...dots);
}

function render(state) {
  // Keep the explicit synthetic warning through transient unavailable polls,
  // but remove it as soon as the source explicitly reports non-demo mode,
  // including Live waiting/stale frames before authenticated GSI arrives.
  if (state?.demo === true) elements['demo-mark'].dataset.demo = 'true';
  else if (state?.demo === false || state?.status === 'live') {
    elements['demo-mark'].dataset.demo = 'false';
  }
  elements['demo-mark'].hidden = elements['demo-mark'].dataset.demo !== 'true';
  const settings = state?.settings;
  if (settings) {
    elements['ct-name'].textContent = settings.ctName;
    elements['ct-roster-name'].textContent = settings.ctName;
    elements['t-name'].textContent = settings.tName;
    elements['t-roster-name'].textContent = settings.tName;
    document.documentElement.style.setProperty('--ct-color', settings.ctColor);
    document.documentElement.style.setProperty('--t-color', settings.tColor);
  }
  const live = state?.status === 'live';
  const radarVisible = live && state?.demo === true &&
    state?.radar?.kind === 'synthetic';
  document.querySelector('.broadcast-stage').classList.toggle('no-radar', !radarVisible);
  drawRadar(state?.radar, radarVisible);
  elements.board.classList.toggle('is-unavailable', !live);
  elements['ct-score'].textContent = live ? display(state.ctScore) : '—';
  elements['t-score'].textContent = live ? display(state.tScore) : '—';
  elements.map.textContent = live ? display(state.map, 'UNKNOWN MAP') : 'NO LIVE MATCH';
  elements.round.textContent = live && state.round !== null ?
    'ROUND ' + state.round : 'WAITING FOR DATA';
  elements.phase.textContent = live ?
    [state.mapPhase, state.roundPhase, state.bombState].filter(Boolean).join(' · ').toUpperCase() : '';
  const reportedSeconds = live && typeof state.countdownSeconds === 'number' &&
    Number.isFinite(state.countdownSeconds) ? state.countdownSeconds : null;
  elements['reported-timer'].textContent = reportedSeconds === null ?
    '' : 'GSI TIMER · ' + Math.floor(reportedSeconds / 60) + ':' +
    String(Math.floor(reportedSeconds % 60)).padStart(2, '0');
  elements.notice.textContent = live ? '' :
    state?.status === 'ambiguous' ? 'MULTIPLE OBSERVERS — SOURCE SELECTION REQUIRED' : 'LIVE DATA UNAVAILABLE';
  elements.notice.hidden = live;
  const players = live && settings?.showRoster !== false && Array.isArray(state.players) ?
    state.players : [];
  elements.roster.hidden = players.length === 0;
  elements['roster-notice'].hidden = !live || players.length > 0;
  for (const [team, target] of [['CT', 'ct-players'], ['T', 't-players']]) {
    elements[target].replaceChildren(...players.filter(player => player.team === team)
      .slice(0, 5).map(createPlayerRow));
  }
}

// Bound stuck OBS Browser Source requests. A missing HTTP response must
// never leave the last successful scoreboard on screen indefinitely.
const POLL_TIMEOUT_MS = 2000;
const STALE_FRAME_MS = 3000;
const MAX_PENDING_POLLS = 4;
let latestRefresh = 0;
let pendingPolls = 0;
let lastSuccessfulFrameAt = Date.now();

async function refresh() {
  // Preserve latest-request-wins behavior without accumulating endless
  // network requests when the local HUD server or browser network stack hangs.
  if (pendingPolls >= MAX_PENDING_POLLS) return;
  const request = ++latestRefresh;
  const abort = new AbortController();
  pendingPolls++;
  let deadlineTimer;
  const deadline = new Promise((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      abort.abort();
      reject(new Error('HUD state request timed out'));
    }, POLL_TIMEOUT_MS);
  });
  try {
    // The race also handles fetch adapters that ignore AbortSignal.
    const response = await Promise.race([
      fetch('/api/state', { cache: 'no-store', signal: abort.signal }),
      deadline,
    ]);
    if (!response.ok) throw new Error('Data unavailable');
    const state = await response.json();
    if (request === latestRefresh) {
      lastSuccessfulFrameAt = Date.now();
      render(state);
    }
  } catch {
    if (request === latestRefresh) render({ status: 'unavailable' });
  } finally {
    clearTimeout(deadlineTimer);
    pendingPolls--;
  }
}

function poll() {
  // Always run the freshness check, even if all network slots are occupied.
  if (Date.now() - lastSuccessfulFrameAt > STALE_FRAME_MS) {
    render({ status: 'unavailable' });
  }
  refresh();
}
refresh();
setInterval(poll, 500);
