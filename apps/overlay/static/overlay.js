const elements = Object.fromEntries([
  'board', 'ct-score', 't-score', 'map', 'round', 'phase', 'notice', 'roster', 'ct-players', 't-players', 'roster-notice'
].map(id => [id, document.getElementById(id)]));

function display(value, fallback = '—') {
  return value === null || value === undefined ? fallback : String(value);
}

function createPlayerRow(player) {
  const row = document.createElement('div');
  row.className = 'player';
  row.classList.toggle('dead', player.health === 0);
  for (const [className, value] of [
    ['player-name', player.name ?? 'Player'],
    ['player-health', player.health === null ? 'HP —' : 'HP ' + player.health],
    ['player-kda', [player.kills, player.assists, player.deaths]
      .map(number => number === null ? '—' : number).join('/')],
    ['player-economy', player.money === null ? '$—' : '
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
  const players = live && Array.isArray(state.players) ? state.players : [];
  elements.roster.hidden = players.length === 0;
  elements['roster-notice'].hidden = !live || players.length > 0;
  for (const [team, target] of [['CT', 'ct-players'], ['T', 't-players']]) {
    elements[target].replaceChildren(...players.filter(player => player.team === team)
      .slice(0, 5).map(createPlayerRow));
  }
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
 + player.money],
  ]) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = String(value);
    row.append(element);
  }
  return row;
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
