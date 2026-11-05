# Radar calibration core

The radar transform is a pure function and **does not publish live coordinates to an OBS browser**. The spectator GSI adapter already retains validated internal world-space positions. Map artwork, authoritative floor alignment, and video synchronization are not yet available.

## Define a map calibration

Supply exactly two *verified* world-to-image anchor pairs for a particular map. Each pair contains a CS2 world-space XY point and the corresponding normalized (0–1) pixel location measured on a radar image. Choose well-separated, unambiguous landmarks. The two pairs determine translation, rotation and uniform scale.

```js
import { createRadarCalibration } from './services/engine/src/calibration.js';

// EXAMPLE ONLY: invented geometry, NOT a valid real CS2 map calibration.
const calibration = createRadarCalibration({
  mapId: 'de_example',
  approved: true,
  anchors: [
    { world: [100, 200], image: [0.2, 0.3] },
    { world: [200, 200], image: [0.4, 0.3] },
  ],
  floors: [
    { id: 'lower', minZ: -100, maxZ: 0 },
    { id: 'upper', minZ: 0, maxZ: 100 },
  ],
});
const marker = calibration.project({
  map: 'de_example', position: [150, 250, 10], forward: [1, 0, 0],
});
// marker: { x: 0.3, y: 0.4, floor: 'upper', heading: 0 }
```

A profile is rejected unless explicitly `approved: true`; approval is an operator assertion, **not automated proof**. Coordinate output is hidden for incorrect maps, out-of-bounds points, unknown floors or invalid vectors. No extrapolation, clipping, guessed transforms, or built-in real map calibrations are provided.

## Validation required before broadcasting

Measure at least two real-world landmark pairs, then test multiple independent landmarks across each map and floor; record orientation and map image version. Confirm whether GSI positions and radar artwork use the same coordinate conventions. Verify that player markers follow an authorized observer's delayed video and do not leak privileged data to playing clients. Only then should a restricted, approved radar projection be connected to an OBS renderer.

The current in-memory module is not an automatic map calibrator, production radar overlay or live radar source.
