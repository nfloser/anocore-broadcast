const elements = Object.fromEntries([
  'board', 'ct-score', 't-score', 'map', 'round', 'phase', 'notice'
].map(id => [id, document.getElementById(id)]));

function display(value, fallback = '—') {
  return value === null || value === undefined ? fallback : String(value);
}

function render(state) {
  const live = state?.status === 'live';
  elements.board.classList.toggle('is-unavailable', !live);
  elements['ct-score'].textContent = live ? display(state.ctScore) : '—';
  elements['t-score'].textContent = live ? display(state.tScore) : '—';
  elements.map.textContent = live ? display(state.map, 'UNKNOWN MAP') : 'NO LIVE MATCH';
  elements.round.textContent = live && state.round !== null ?
    'ROUND ' + state.round : 'WAITING FOR DATA';
  elements.phase.textContent = live ?
    [state.mapPhase, state.roundPhase, state.bombState].filter(Boolean).join(' · ').toUpperCase() : '';
  elements.notice.textContent = live ? '' :
    state?.status === 'ambiguous' ? 'MULTIPLE OBSERVERS — SOURCE SELECTION REQUIRED' : 'LIVE DATA UNAVAILABLE';
  elements.notice.hidden = live;
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Data unavailable');
    render(await response.json());
  } catch {
    render({ status: 'unavailable' });
  }
}
refresh();
setInterval(refresh, 500);
