import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { validateEnvelope, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_STALE_AFTER_MS = 5_000;
const MATCH_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function safeString(value, max = 128) {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * GSI spectator vectors are comma-separated x,y,z strings.
 * Reject malformed, non-finite and implausibly large coordinates.
 */
export function parseSpectatorVector(value) {
  if (typeof value !== 'string' || value.length > 96) return null;
  const parts = value.split(',');
  if (parts.length !== 3) return null;
  const values = [];
  for (const part of parts) {
    const cleaned = part.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,2})?$/.test(cleaned)) {
      return null;
    }
    const number = Number(cleaned);
    if (!Number.isFinite(number) || Math.abs(number) > 100_000) return null;
    values.push(number);
  }
  return values;
}

/**
 * Normalize a conservative, documented subset of GSI fields.
 * Absent data is omitted instead of fabricated.
 * This function does not infer rounds, timings, or operator permissions.
 */
export function normalizeGsiSnapshot(input) {
  if (!isRecord(input) || !isRecord(input.provider)) {
    throw new TypeError('GSI provider must be an object');
  }
  const source = input.provider;
  if (!['Counter-Strike 2', 'Counter-Strike: Global Offensive'].includes(source.name)) {
    throw new TypeError('Unsupported provider');
  }

  const snapshot = {
    provider: { name: source.name },
  };
  if (safeNumber(source.timestamp) !== undefined) {
    snapshot.provider.timestamp = source.timestamp;
  }

  if (isRecord(input.map)) {
    snapshot.map = {};
    for (const key of ['name', 'phase', 'round_wins']) {
      const value = input.map[key];
      if (key !== 'round_wins') {
        const str = safeString(value);
        if (str !== undefined) snapshot.map[key] = str;
      }
    }
    if (Number.isSafeInteger(input.map.round) && input.map.round >= 0) {
      snapshot.map.round = input.map.round;
    }
    if (isRecord(input.map.team_ct) && safeNumber(input.map.team_ct.score) !== undefined) {
      snapshot.map.ctScore = input.map.team_ct.score;
    }
    if (isRecord(input.map.team_t) && safeNumber(input.map.team_t.score) !== undefined) {
      snapshot.map.tScore = input.map.team_t.score;
    }
  }

  if (isRecord(input.phase_countdowns)) {
    const phase = safeString(input.phase_countdowns.phase, 32);
    const remaining = input.phase_countdowns.phase_ends_in;
    snapshot.phaseCountdown = {};
    if (phase !== undefined) snapshot.phaseCountdown.phase = phase;
    if (typeof remaining === 'number' && Number.isFinite(remaining) &&
        remaining >= 0 && remaining <= 600) {
      snapshot.phaseCountdown.seconds = remaining;
    }
  }

  if (isRecord(input.round)) {
    snapshot.round = {};
    for (const key of ['phase', 'win_team', 'bomb']) {
      const str = safeString(input.round[key]);
      if (str !== undefined) snapshot.round[key] = str;
    }
  }

  if (isRecord(input.player)) {
    snapshot.player = {};
    for (const key of ['steamid', 'name', 'team', 'activity']) {
      const str = safeString(input.player[key]);
      if (str !== undefined) snapshot.player[key] = str;
    }
    if (isRecord(input.player.state)) {
      snapshot.player.state = {};
      for (const key of ['health', 'armor', 'money', 'round_kills', 'round_killhs']) {
        const n = safeNumber(input.player.state[key]);
        if (n !== undefined) snapshot.player.state[key] = n;
      }
    }
  }

  if (isRecord(input.bomb)) {
    snapshot.bomb = {};
    const state = safeString(input.bomb.state);
    if (state !== undefined) snapshot.bomb.state = state;
    const countdown = safeNumber(input.bomb.countdown);
    if (countdown !== undefined) snapshot.bomb.countdown = countdown;
  }
  // Spectator-only GSI. Never preserve the source SteamID keys.
  if (isRecord(input.allplayers)) {
    const players = [];
    for (const entry of Object.values(input.allplayers).slice(0, 32)) {
      if (!isRecord(entry) || !['CT', 'T'].includes(entry.team)) continue;
      const state = isRecord(entry.state) ? entry.state : {};
      const stats = isRecord(entry.match_stats) ? entry.match_stats : {};
      const player = { team: entry.team, name: safeString(entry.name, 40) ?? 'Player' };
      if (Number.isSafeInteger(entry.observer_slot) &&
          entry.observer_slot >= 0 && entry.observer_slot <= 10) {
        player.slot = entry.observer_slot;
      }
      for (const field of ['health', 'armor', 'money']) {
        const value = state[field];
        if (Number.isSafeInteger(value) && value >= 0 && value <= 100000) {
          player[field] = value;
        }
      }
      for (const field of ['kills', 'assists', 'deaths']) {
        const value = stats[field];
        if (Number.isSafeInteger(value) && value >= 0 && value <= 9999) {
          player[field] = value;
        }
      }
      if (isRecord(entry.weapons)) {
        let activeWeapon = null;
        let utilityCount = 0;
        for (const weapon of Object.values(entry.weapons).slice(0, 32)) {
          if (!isRecord(weapon)) continue;
          const name = typeof weapon.name === 'string' &&
            /^weapon_[a-z0-9_]{1,27}$/.test(weapon.name) ? weapon.name : null;
          if (!name) continue;
          if (weapon.state === 'active') activeWeapon = name;
          if (weapon.type === 'Grenade') utilityCount = Math.min(8, utilityCount + 1);
        }
        player.activeWeapon = activeWeapon;
        player.utilityCount = utilityCount;
      }
      // Position coordinates remain internal until a verified map-specific
      // transform and spectator-safe projection are available.
      const position = parseSpectatorVector(entry.position);
      const forward = parseSpectatorVector(entry.forward);
      if (position !== null) player.position = position;
      if (forward !== null) player.forward = forward;
      players.push(player);
      if (players.length >= 10) break;
    }
    snapshot.players = players;
  }
  return snapshot;
}

/** Reduces GSI notifications to one explicitly session-scoped snapshot envelope. */
export function createGsiIngest({ matchId, sourceId = 'observer-1', token, onEvent = () => {},
  staleAfterMs = DEFAULT_STALE_AFTER_MS, clock = () => Date.now(), initialSequence = 0,
  onAcceptedShape = () => {} }) {
  if (!MATCH_ID_PATTERN.test(matchId ?? '') || !MATCH_ID_PATTERN.test(sourceId) || sourceId.length > 105) {
    throw new TypeError('matchId and sourceId must be valid IDs');
  }
  if (typeof token !== 'string' || Buffer.byteLength(token) < 16) {
    throw new TypeError('A random authentication token (at least 16 bytes) is required');
  }
  if (typeof onEvent !== 'function' || typeof clock !== 'function' ||
      typeof onAcceptedShape !== 'function' ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
    throw new TypeError('Invalid ingest options');
  }
  if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
    throw new TypeError('Invalid initialSequence');
  }
  let sequence = initialSequence;
  let lastReceivedAt = null;

  function freshness(now = clock()) {
    const ageMs = lastReceivedAt === null ? null : Math.max(0, now - lastReceivedAt);
    return { status: ageMs === null ? 'waiting' : ageMs > staleAfterMs ? 'stale' : 'live',
      lastReceivedAt, ageMs };
  }

  function accept(raw) {
    if (!isRecord(raw) || !isRecord(raw.auth) || !matchesToken(raw.auth.token, token)) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    let payload;
    try {
      payload = normalizeGsiSnapshot(raw);
    } catch {
      return { ok: false, status: 422, error: 'Invalid GSI payload' };
    }
    const now = clock();
    const next = sequence + 1;
    const envelope = {
      version: PROTOCOL_VERSION,
      eventId: `${sourceId}:${next}`,
      matchId,
      sourceId,
      type: 'observer.snapshot',
      sequence: next,
      occurredAt: now,
      payload,
    };
    if (!validateEnvelope(envelope).ok) {
      return { ok: false, status: 422, error: 'Invalid normalized event' };
    }
    try {
      onEvent(envelope);
    } catch {
      return { ok: false, status: 503, error: 'Event consumer unavailable' };
    }
    sequence = next;
    lastReceivedAt = now;
    // Diagnostic observation runs only after authentication and commit.
    // It cannot invalidate an already committed snapshot or change the HTTP response.
    try { onAcceptedShape({
      map: isRecord(raw.map), round: isRecord(raw.round),
      completeScoreboard: isRecord(raw.map) &&
        typeof raw.map.name === 'string' && raw.map.name.trim().length > 0 &&
        Number.isSafeInteger(raw.map.round) && raw.map.round >= 0 &&
        isRecord(raw.map.team_ct) && isRecord(raw.map.team_t) &&
        Number.isSafeInteger(raw.map.team_ct.score) && raw.map.team_ct.score >= 0 &&
        Number.isSafeInteger(raw.map.team_t.score) && raw.map.team_t.score >= 0,
      allplayers: isRecord(raw.allplayers),
      emptyAllplayers: isRecord(raw.allplayers) && Object.keys(raw.allplayers).length === 0,
      nonemptyAllplayers: isRecord(raw.allplayers) && Object.keys(raw.allplayers).length > 0,
      phaseCountdowns: isRecord(raw.phase_countdowns),
      previously: isRecord(raw.previously), added: isRecord(raw.added),
    }); } catch { /* Statistics are best-effort and never affect ingestion. */ }
    return { ok: true, status: 202, envelope };
  }
  return { accept, freshness };
}

function matchesToken(provided, expected) {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Local-only HTTP receiver. Never bind directly to a public interface:
 * GSI auth tokens are shared secrets transmitted without TLS by CS2.
 */
export function createGsiServer(ingest, { host = '127.0.0.1', port = 3008 } = {}) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new TypeError('Only loopback interfaces are supported');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('Invalid port');
  }
  const server = createServer(async (req, res) => {
    function reply(status, body) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    }
    if (req.url === '/health' && req.method === 'GET') {
      reply(200, ingest.freshness());
      return;
    }
    if (req.url !== '/gsi' || req.method !== 'POST') {
      reply(404, { error: 'Not found' });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
      reply(415, { error: 'Expected application/json' });
      return;
    }
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      reply(413, { error: 'Request too large' });
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reply(413, { error: 'Request too large' });
          return;
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = ingest.accept(input);
      reply(result.status, result.ok ? { accepted: true } : { error: result.error });
    } catch {
      if (!res.writableEnded) reply(400, { error: 'Malformed JSON or request' });
    }
  });
  return { server, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); });
  }) };
}
