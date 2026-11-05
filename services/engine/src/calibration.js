const MAP_ID = /^(?:de|cs)_[a-z0-9_]{1,48}$/;
const EPSILON = 1e-9;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function validWorldXY(point) {
  return Array.isArray(point) && point.length === 2 &&
    point.every(value => finite(value) && Math.abs(value) <= 100000);
}
function validUV(point) {
  return Array.isArray(point) && point.length === 2 &&
    point.every(value => finite(value) && value >= 0 && value <= 1);
}
function validVector3(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every(v => finite(v) && Math.abs(v) <= 100000);
}

function validate(profile) {
  if (!isPlainObject(profile) ||
      Object.keys(profile).some(k => !['mapId', 'approved', 'anchors', 'floors'].includes(k)) ||
      !MAP_ID.test(profile.mapId ?? '') || profile.approved !== true ||
      !Array.isArray(profile.anchors) || profile.anchors.length !== 2) {
    throw new TypeError('Invalid or unapproved radar calibration');
  }
  for (const anchor of profile.anchors) {
    if (!isPlainObject(anchor) ||
        Object.keys(anchor).sort().join(',') !== 'image,world' ||
        !validWorldXY(anchor.world) || !validUV(anchor.image)) {
      throw new TypeError('Invalid radar anchor');
    }
  }
  const [a, b] = profile.anchors;
  const worldDistance = Math.hypot(b.world[0] - a.world[0], b.world[1] - a.world[1]);
  const imageDistance = Math.hypot(b.image[0] - a.image[0], b.image[1] - a.image[1]);
  if (worldDistance < EPSILON || imageDistance < EPSILON) {
    throw new TypeError('Degenerate radar anchor geometry');
  }
  if (profile.floors !== undefined) {
    if (!Array.isArray(profile.floors) || !profile.floors.length || profile.floors.length > 8) {
      throw new TypeError('Invalid radar floors');
    }
    for (let i = 0; i < profile.floors.length; i++) {
      const floor = profile.floors[i];
      if (!isPlainObject(floor) ||
          Object.keys(floor).sort().join(',') !== 'id,maxZ,minZ' ||
          typeof floor.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(floor.id) ||
          !finite(floor.minZ) || !finite(floor.maxZ) ||
          floor.minZ >= floor.maxZ ||
          Math.abs(floor.minZ) > 100000 || Math.abs(floor.maxZ) > 100000) {
        throw new TypeError('Invalid radar floor');
      }
      for (const earlier of profile.floors.slice(0, i)) {
        if (floor.id === earlier.id ||
            (floor.minZ < earlier.maxZ && floor.maxZ > earlier.minZ)) {
          throw new TypeError('Overlapping or duplicate radar floors');
        }
      }
    }
  }
}

/**
 * Strictly approved, two-anchor similarity transform.
 * Returns only normalized image coordinates. Raw world coordinates stay private.
 * Output is null for wrong map, unknown floor or outside image bounds.
 */
export function createRadarCalibration(profile) {
  validate(profile);
  const anchors = structuredClone(profile.anchors);
  const floors = profile.floors === undefined ? null : structuredClone(profile.floors);
  const [a, b] = anchors;
  const wx = b.world[0] - a.world[0], wy = b.world[1] - a.world[1];
  const ix = b.image[0] - a.image[0], iy = b.image[1] - a.image[1];
  const inverse = 1 / (wx * wx + wy * wy);
  const cosineScale = (wx * ix + wy * iy) * inverse;
  const sineScale = (wx * iy - wy * ix) * inverse;
  const mapId = profile.mapId;

  function project({ map, position, forward } = {}) {
    if (map !== mapId || !validVector3(position)) return null;
    const dx = position[0] - a.world[0], dy = position[1] - a.world[1];
    const x = a.image[0] + cosineScale * dx - sineScale * dy;
    const y = a.image[1] + sineScale * dx + cosineScale * dy;
    // Never clamp out-of-bounds positions, which would imply false locations.
    if (!finite(x) || !finite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    let floor = null;
    if (floors) {
      const match = floors.find(item =>
        position[2] >= item.minZ && position[2] < item.maxZ);
      if (!match) return null;
      floor = match.id;
    }
    let heading = null;
    if (validVector3(forward)) {
      const magnitude = Math.hypot(forward[0], forward[1]);
      if (magnitude > EPSILON) {
        const vx = cosineScale * forward[0] - sineScale * forward[1];
        const vy = sineScale * forward[0] + cosineScale * forward[1];
        heading = Math.atan2(vy, vx);
      }
    }
    return { x, y, floor, heading };
  }
  return Object.freeze({ mapId, project });
}
