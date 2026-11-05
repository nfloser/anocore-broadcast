/**
 * Basic event envelope for the CS2 broadcast ingest boundary.
 * Payload schemas and authentication are separate responsibilities.
 */
export const PROTOCOL_VERSION = 1;

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;
const EVENT_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function isObject(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateEnvelope(value) {
  const errors = [];
  if (!isObject(value)) return { ok: false, errors: ['Envelope must be a plain object'] };

  if (value.version !== PROTOCOL_VERSION) errors.push('Unsupported protocol version');
  for (const field of ['eventId', 'matchId', 'sourceId']) {
    if (typeof value[field] !== 'string' || !ID_PATTERN.test(value[field])) {
      errors.push(`Invalid ${field}`);
    }
  }
  if (typeof value.type !== 'string' || !EVENT_PATTERN.test(value.type)) {
    errors.push('Invalid event type');
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    errors.push('Invalid sequence');
  }
  if (!Number.isSafeInteger(value.occurredAt) ||
      value.occurredAt < 0 || value.occurredAt > MAX_TIMESTAMP) {
    errors.push('Invalid occurredAt');
  }
  if (!isObject(value.payload)) errors.push('Payload must be a plain object');
  if (value.tick !== undefined &&
      (!Number.isSafeInteger(value.tick) || value.tick < 0)) {
    errors.push('Invalid tick');
  }
  const allowed = new Set(['version', 'eventId', 'matchId', 'sourceId',
    'type', 'sequence', 'occurredAt', 'tick', 'payload']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    errors.push('Unknown envelope field');
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}
