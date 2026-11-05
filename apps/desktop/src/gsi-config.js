// CS2 reads the token from this user-installed CFG. Treat this file as
// confidential: it is the only intentionally exportable copy of this key.
export function createObserverConfig({ token, port = 3008 } = {}) {
  if (typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new TypeError('Invalid GSI authentication key');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid GSI port');
  }
  return `"gamestate_integration_anocore"
{
  "uri" "http://127.0.0.1:${port}/gsi"
  "timeout" "5.0"
  "buffer" "0.1"
  "throttle" "0.1"
  "heartbeat" "1.0"
  "auth"
  {
    "token" "${token}"
  }
  "data"
  {
    "provider" "1"
    "map" "1"
    "round" "1"
    "player_id" "1"
    "player_state" "1"
    "bomb" "1"
    "allplayers_id" "1"
    "allplayers_state" "1"
    "allplayers_match_stats" "1"
    "allplayers_weapons" "1"
    "allplayers_position" "1"
    "phase_countdowns" "1"
  }
}
`;
}
