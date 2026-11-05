import assert from 'node:assert/strict';
import test from 'node:test';
import { createRadarCalibration } from '../src/calibration.js';

const profile = () => ({
  mapId: 'de_example', approved: true,
  anchors: [
    { world: [100, 200], image: [0.2, 0.3] },
    { world: [200, 200], image: [0.4, 0.3] },
  ],
});
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} is not near ${expected}`);
}
test('applies translation and uniform scale without guessing a map origin', () => {
  const calibration = createRadarCalibration(profile());
  const p = calibration.project({
    map: 'de_example', position: [150, 250, 5], forward: [1, 0, 0],
  });
  near(p.x, 0.3);
  near(p.y, 0.4);
  near(p.heading, 0);
  assert.equal(p.floor, null);
});
test('rotates world-space position and facing into calibrated map axes', () => {
  const input = profile();
  input.anchors[1].image = [0.2, 0.5];
  const calibration = createRadarCalibration(input);
  const p = calibration.project({
    map: 'de_example', position: [100, 250, 0], forward: [0, 1, 0],
  });
  near(p.x, 0.1);
  near(p.y, 0.3);
  near(p.heading, Math.PI);
});
test('wrong map, missing data and outside-image coordinates fail closed', () => {
  const calibration = createRadarCalibration(profile());
  assert.equal(calibration.project({ map: 'de_nuke', position: [100, 200, 0] }), null);
  assert.equal(calibration.project({ map: 'de_example', position: null }), null);
  assert.equal(calibration.project({ map: 'de_example', position: [1000, 200, 0] }), null);
  assert.equal(calibration.project({ map: 'de_example', position: [NaN, 200, 0] }), null);
});
test('floor ranges are explicit, nonoverlapping and required when configured', () => {
  const input = profile();
  input.floors = [
    { id: 'lower', minZ: -100, maxZ: 0 },
    { id: 'upper', minZ: 0, maxZ: 100 },
  ];
  const calibration = createRadarCalibration(input);
  assert.equal(calibration.project({ map: input.mapId, position: [100, 200, -1] }).floor, 'lower');
  assert.equal(calibration.project({ map: input.mapId, position: [100, 200, 0] }).floor, 'upper');
  assert.equal(calibration.project({ map: input.mapId, position: [100, 200, 200] }), null);
  input.floors[1].minZ = -5;
  assert.throws(() => createRadarCalibration(input), /Overlapping/);
});
test('invalid and unapproved map transforms cannot be initialized', () => {
  for (const mutate of [
    p => { p.approved = false; },
    p => { p.mapId = '../secret'; },
    p => { p.anchors[1].world = [100, 200]; },
    p => { p.anchors[1].image = [0.2, 0.3]; },
    p => { p.anchors[1].image = [2, 0.3]; },
    p => { p.anchors[0].world = [Infinity, 0]; },
    p => { p.extraneous = 'unknown'; },
  ]) {
    const p = profile();
    mutate(p);
    assert.throws(() => createRadarCalibration(p));
  }
});
test('calibration deep copies anchors and floor data', () => {
  const p = profile();
  const calibration = createRadarCalibration(p);
  p.anchors[0].world[0] = 1000;
  p.anchors[1].image[0] = 0.9;
  const point = calibration.project({ map: 'de_example', position: [100, 200, 0] });
  near(point.x, 0.2);
  near(point.y, 0.3);
});
