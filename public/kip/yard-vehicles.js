// yard-vehicles.js: where each part of a Yard-bench vehicle sits (docs/specs/construction-vehicles-spec.md, section 8).
// Pure data and maths: no DOM, no three.js, so it is unit-tested in Node (tests/yard-vehicles.test.ts) and the bench only draws what it says.
//
// Frame: PartSpec CAD (X right, -Y front, +Z up), the one the Truck bench's `cadRoot` converts to three.js. Every number here is the placement
// Gate G1 craft 10 (`toyventor_kitcard.verify_gate_g1`, "10_road_roller") checks with booleans, so the picture and the proof cannot disagree.
// Rotations are about the CAD Y axis in radians, the three.js convention (rotation.y = +pi/2 maps a part's +Z to +X); a negative one mirrors a part.

/** Tabletop row pitch: one Technical Unit, 12.5 mm. */
export const TU = 12.5;
/** Axle height above the keel's bed face: row centre, z = 6.25. */
export const AXLE_Z = 6.25;
/** Rack-row 0 (front) and row 8 (rear) axle positions along Y. Wheelbase 100 mm. */
export const AXLE_Y = Object.freeze({ front: -56.25, rear: 43.75 });
/** Inner face of each drum (its closed floor) from the centreline: 24.9 (keel half width) + 1.8 clearance = 26.7. */
export const DRUM_INNER_X = 26.7;
/** `kit_drum_roller`: O50.0 x 24.8 mm. */
export const DRUM = Object.freeze({ id: 'kit_drum_roller', radius: 25.0, width: 24.8 });
/** `kit_barbell_shaft_wide`: 103.0 mm = 2 x (26.7 + 24.8). */
export const WIDE_AXLE = Object.freeze({ id: 'kit_barbell_shaft_wide', length: 103.0 });
/** Keel half width at the two axles [M, from kit_keel_base]: the full hull at row 8, the nose at row 0. */
export const KEEL_HALF_WIDTH = Object.freeze({ rear: 24.9, front: 12.4 });
/** Sideways travel of a fixed axle before a drum meets the keel: 1.8 mm at the rear, 14.3 mm at the front (spec section 8, "Front-axle float"). */
export const AXLE_FLOAT_MM = Object.freeze({
  rear: DRUM_INNER_X - KEEL_HALF_WIDTH.rear,
  front: DRUM_INNER_X - KEEL_HALF_WIDTH.front,
});
/** Windscreen / cockpit position on the keel. */
export const WINDSCREEN_POS = Object.freeze([0, -6.25, 12.5]);

/**
 * The parts of the double-drum road roller in the CAD frame.
 * `axle` names the rolling assembly a part belongs to (it spins together about the X axis); the keel and windscreen have none.
 * @returns {Array<{ id: string, role: string, axle: 'front' | 'rear' | null, pos: number[], rotY: number }>}
 */
export function rollerParts() {
  const parts = [
    { id: 'kit_keel_base', role: 'keel', axle: null, pos: [0, 0, 0], rotY: 0 },
    { id: 'kit_windscreen', role: 'windscreen', axle: null, pos: [...WINDSCREEN_POS], rotY: 0 },
  ];
  for (const axle of ['front', 'rear']) {
    const y = AXLE_Y[axle];
    parts.push(
      { id: WIDE_AXLE.id, role: 'axle', axle, pos: [-WIDE_AXLE.length / 2, y, AXLE_Z], rotY: Math.PI / 2 },
      // Mirrored pair: each drum's closed floor (part z = 0) faces the keel, its dish opens outward, as the Truck's wheel pair does.
      { id: DRUM.id, role: 'drum-left', axle, pos: [-DRUM_INNER_X, y, AXLE_Z], rotY: -Math.PI / 2 },
      { id: DRUM.id, role: 'drum-right', axle, pos: [DRUM_INNER_X, y, AXLE_Z], rotY: Math.PI / 2 },
    );
  }
  return parts;
}

/** The parts list as the bench shows it: one row per part id with a count, in a stable order. */
export function bom(parts) {
  const rows = new Map();
  for (const p of parts) rows.set(p.id, (rows.get(p.id) ?? 0) + 1);
  return [...rows].map(([id, count]) => ({ id, count }));
}

/** The part ids a vehicle needs loaded. */
export function partIds(parts) {
  return [...new Set(parts.map((p) => p.id))];
}

/** Rolling without slip: how far a drum has turned (rad) after the vehicle has moved `distance` mm. */
export function spinAfter(distance, radius = DRUM.radius) {
  return distance / radius;
}

/** Clamp a front-axle slide to the keel's travel; `which` is 'front' or 'rear'. */
export function clampFloat(offset, which) {
  const lim = AXLE_FLOAT_MM[which];
  return Math.max(-lim, Math.min(lim, offset));
}
