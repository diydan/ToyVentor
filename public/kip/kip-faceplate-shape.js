// Universal human face plate, front view: one source for the plate outline, the selfie window cut inside it, and the
// sticker cut line. No imports, no DOM, so the viewer, the SDK's 2D art and the unit tests all read the same numbers.
//
// Frame: x across the plate (0 = centre line, mm), zb up from the chin edge (mm). The plate is symmetric.
// PLATE_HALF_WIDTH mirrors `face_outline_hw(zb)` in parts/partspec/toyventor_parts.py (FACE_ROUND_* constants): the plate
// is 24.2 mm at its widest (zb 6.75), 13.8 mm across the chin edge, and 13.2 mm tall. tests/kip-faceplate-shape.test.ts
// checks this table against the exported plate STL, so a CAD change that is not copied here fails a test.

export const PLATE_TOP_ZB = 13.2;
/** [zb, half width] every 0.25 mm. */
export const PLATE_HALF_WIDTH = [
  [0.0, 6.905], [0.25, 7.82], [0.5, 8.15], [0.75, 8.382], [1.0, 8.607], [1.25, 8.832], [1.5, 9.057], [1.75, 9.282], [2.0, 9.507],
  [2.25, 9.732], [2.5, 9.957], [2.75, 10.182], [3.0, 10.407], [3.25, 10.632], [3.5, 10.856], [3.75, 11.062], [4.0, 11.242],
  [4.25, 11.401], [4.5, 11.54], [4.75, 11.66], [5.0, 11.765], [5.25, 11.854], [5.5, 11.928], [5.75, 11.989], [6.0, 12.036],
  [6.25, 12.07], [6.5, 12.091], [6.75, 12.1], [7.0, 12.096], [7.25, 12.08], [7.5, 12.051], [7.75, 12.009], [8.0, 11.954],
  [8.25, 11.885], [8.5, 11.802], [8.75, 11.704], [9.0, 11.59], [9.25, 11.459], [9.5, 11.308], [9.75, 11.137], [10.0, 10.942],
  [10.25, 10.722], [10.5, 10.497], [10.75, 10.259], [11.0, 10.039], [11.25, 9.817], [11.5, 9.591], [11.75, 9.364], [12.0, 9.138],
  [12.25, 8.899], [12.5, 8.634], [12.75, 7.971], [13.0, 6.093],
];

/** Whole plate in mm (width x height as printed standing on its chin edge). */
export const PLATE_MM = { w: 24.2, h: PLATE_TOP_ZB };

/** Half width of the plate at height `zb` (linear between stations; 0 outside the plate). */
export function plateHalfWidth(zb) {
  const t = PLATE_HALF_WIDTH;
  if (zb < 0 || zb > PLATE_TOP_ZB) return 0;
  if (zb >= t[t.length - 1][0]) {
    const [z0, h0] = t[t.length - 1];
    return Math.max(0, h0 * (1 - (zb - z0) / (PLATE_TOP_ZB - z0)));
  }
  let i = Math.min(t.length - 2, Math.max(0, Math.floor(zb / 0.25)));
  while (i > 0 && t[i][0] > zb) i--;
  while (i < t.length - 2 && t[i + 1][0] < zb) i++;
  const [za, ha] = t[i], [zc, hc] = t[i + 1];
  return ha + (hc - ha) * ((zb - za) / (zc - za));
}

// ---- the selfie window -------------------------------------------------------------------------------------
// The picture covers exactly the plate's own shape, pulled in by a small bezel margin, so the picture, the plate and the sticker
// cut line are one shape (an earlier squircle cut inside the plate did not match it: its top corners left plate showing).
/** Bezel margin between the picture and the plate edge (the plate sits 0.3 mm below the skull lip all round). */
export const WINDOW_INSET_MM = 0.5;
/** Lowest and highest plate height the picture uses. The plate is visible up to its dome top at zb 13.2 (measured through the real head pockets). */
export const WINDOW_ZB = { min: 0.5, max: 12.9 };

const winMid = (WINDOW_ZB.min + WINDOW_ZB.max) / 2;
const widest = PLATE_HALF_WIDTH.reduce((m, [, h]) => Math.max(m, h), 0) - WINDOW_INSET_MM;

/** Half width of the window at plate height `zb`: the plate outline less the bezel (0 outside [min, max]). */
export function windowHalfWidth(zb) {
  if (zb < WINDOW_ZB.min - 1e-9 || zb > WINDOW_ZB.max + 1e-9) return 0;
  return Math.max(0, plateHalfWidth(zb) - WINDOW_INSET_MM);
}

// ---- where a face's features sit on the plate --------------------------------------------------------------
// The flat insert carries a moulded smile ridge (crest at zb 1.25, corners 1.75) and the 2D art puts its eyes at zb 5.8, x +-5.3.
// A photo or sample face that has its eyes and mouth on these marks lines up with the printed smile and fills the plate with the
// face (the chin falls below the plate, the forehead runs up under the brow).
/** Eye-line height, half the eye spacing (mm), and mouth height on the plate. */
export const FACE_TARGET_MM = { eyeZb: 5.8, eyeHalfSpan: 5.3, mouthZb: 1.5 };

/** Window size in mm: the bounding box of the outline (what the picture canvas covers). */
export const WINDOW_MM = { w: +(2 * widest).toFixed(2), h: +(WINDOW_ZB.max - WINDOW_ZB.min).toFixed(2) };
/** Where the picture sits on the plate: the conformal decal plane `buildConformalFaceplateDecalGeo(width, height, centerY)`. */
export const FACEPLATE_DECAL = { width: WINDOW_MM.w, height: WINDOW_MM.h, centerY: +winMid.toFixed(3) };

/**
 * The window outline as a closed polygon in millimetres, origin top-left of the bounding box, x right, y down (canvas
 * and SVG convention).
 */
export function windowPolygon(step = 0.1) {
  const rows = [];
  const n = Math.max(2, Math.round((WINDOW_ZB.max - WINDOW_ZB.min) / step));
  for (let i = 0; i <= n; i++) {
    const zb = WINDOW_ZB.min + ((WINDOW_ZB.max - WINDOW_ZB.min) * i) / n;
    rows.push([windowHalfWidth(zb), zb]);
  }
  const toBox = ([hw, zb], side) => [+(widest + side * hw).toFixed(3), +(WINDOW_ZB.max - zb).toFixed(3)];
  const poly = [];
  for (let i = rows.length - 1; i >= 0; i--) poly.push(toBox(rows[i], 1)); // down the right side, top to bottom
  for (let i = 0; i < rows.length; i++) poly.push(toBox(rows[i], -1)); // up the left side; the flat bottom and top edges close the shape
  return poly;
}

/** SVG path data for the window outline in mm (for the sticker cut line). */
export function windowPathD(polygon = windowPolygon()) {
  return `M${polygon.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
}

/** Area of the window in mm^2 (shoelace). */
export function windowAreaMm2(polygon = windowPolygon()) {
  let a = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i], [x1, y1] = polygon[(i + 1) % polygon.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** Trace the window outline into a canvas 2D context, scaled `sx` x `sy` pixels per mm (sy defaults to sx). */
export function traceWindow(g, sx, sy = sx, polygon = windowPolygon()) {
  g.beginPath();
  polygon.forEach(([x, y], i) => (i ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)));
  g.closePath();
}

/** The feature marks as fractions of the window box (x right, y down): left eye, right eye, mouth. */
export function faceTargetFractions() {
  const w = WINDOW_MM.w, h = WINDOW_MM.h, t = FACE_TARGET_MM;
  const y = (zb) => (WINDOW_ZB.max - zb) / h;
  return {
    leftEye: { x: 0.5 - t.eyeHalfSpan / w, y: y(t.eyeZb) },
    rightEye: { x: 0.5 + t.eyeHalfSpan / w, y: y(t.eyeZb) },
    mouth: { x: 0.5, y: y(t.mouthZb) },
  };
}
