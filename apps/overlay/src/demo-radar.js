import { createRadarCalibration } from '../../../services/engine/src/calibration.js';

// Example-only grid transform. Do not export for use by a real broadcast.
const demoCalibration = createRadarCalibration({
  mapId: 'de_nuke',
  approved: true,
  anchors: [
    { world: [-1000, -1000], image: [0, 0] },
    { world: [1000, -1000], image: [1, 0] },
  ],
});

/**
 * Projects synthetic spectator fixtures into an explicitly marked preview.
 * This function is imported exclusively by demo.js, never by live broadcast.
 * Coordinates and raw GSI payloads are not exposed to the browser.
 */
export function createDemoRadar(view) {
  if (!view || typeof view !== 'object') return null;
  const live = Object.entries(view.freshness ?? {}).filter(([sourceId, status]) =>
    status?.status === 'live' && view.snapshots?.[sourceId]);
  if (live.length !== 1) return null;
  const snapshot = view.snapshots[live[0][0]];
  if (snapshot?.map?.name !== 'de_nuke' || !Array.isArray(snapshot.players)) return null;

  const markers = [];
  for (const player of snapshot.players.slice(0, 10)) {
    if (!player || !['CT', 'T'].includes(player.team)) continue;
    const point = demoCalibration.project({
      map: snapshot.map.name,
      position: player.position,
      forward: player.forward,
    });
    if (!point) continue;
    markers.push({
      x: point.x,
      y: point.y,
      heading: point.heading,
      team: player.team,
      label: typeof player.name === 'string' ? player.name.slice(0, 12) : 'Player',
      alive: player.health !== 0,
    });
  }
  return {
    kind: 'synthetic',
    label: 'SYNTHETIC GRID · NOT MAP ACCURATE',
    markers,
  };
}
