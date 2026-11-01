// Universal human face plate, front view: one source for the plate outline, the selfie window cut inside it, and the
// sticker cut line. No imports, no DOM, so the viewer, the SDK's 2D art and the unit tests all read the same numbers.
//
// Frame: x across the plate (0 = centre line, mm), zb up from the printed chin edge on the bed (mm). The plate is symmetric.
// PLATE_HALF_WIDTH mirrors `face_outline_hw(zb + 0.4)` in parts/partspec/toyventor_parts.py after the 0.4 mm chin trim
// (`FACE_STEM_ZB - FACE_STEM_FLAT_HALF`, commit 6b20bed): the plate is 24.2 mm at its widest (zb 6.4), 16.07 mm across the
// trimmed chin edge, and 12.8 mm tall (loft top 12.75 mm). tests/kip-faceplate-shape.test.ts checks this table against the
// exported plate STL, so a CAD change that is not copied here fails a test.

export const PLATE_CHIN_TRIM_MM = 0.4;
export const PLATE_TOP_ZB = 12.8;
/** [zb, half width] every 0.25 mm up from the trimmed bed edge (plus peak 6.4 and shoulder 12.6). */
export const PLATE_HALF_WIDTH = [
  [0.0, 8.037], [0.25, 8.292], [0.5, 8.517], [0.75, 8.742], [1.0, 8.967], [1.25, 9.192], [1.5, 9.417], [1.75, 9.642],
  [2.0, 9.867], [2.25, 10.092], [2.5, 10.317], [2.75, 10.542], [3.0, 10.767], [3.25, 10.983], [3.5, 11.173], [3.75, 11.34],
  [4.0, 11.486], [4.25, 11.614], [4.5, 11.725], [4.75, 11.82], [5.0, 11.9], [5.25, 11.966], [5.5, 12.018], [5.75, 12.058],
  [6.0, 12.084], [6.25, 12.098], [6.4, 12.1], [6.5, 12.099], [6.75, 12.088], [7.0, 12.064], [7.25, 12.027], [7.5, 11.977],
  [7.75, 11.914], [8.0, 11.837], [8.25, 11.745], [8.5, 11.638], [8.75, 11.513], [9.0, 11.371], [9.25, 11.208], [9.5, 11.023],
  [9.75, 10.812], [10.0, 10.587], [10.25, 10.347], [10.5, 10.127], [10.75, 9.906], [11.0, 9.681], [11.25, 9.455], [11.5, 9.228],
  [11.75, 8.997], [12.0, 8.744], [12.25, 8.402], [12.5, 6.873], [12.6, 6.093],
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
/** Lowest and highest plate height the picture uses. The plate is visible up to its dome top at zb 12.8 (13.2 less 0.4 mm chin trim). */
export const WINDOW_ZB = { min: 0.1, max: 12.5 };

const winMid = (WINDOW_ZB.min + WINDOW_ZB.max) / 2;
const widest = PLATE_HALF_WIDTH.reduce((m, [, h]) => Math.max(m, h), 0) - WINDOW_INSET_MM;

/** Half width of the window at plate height `zb`: the plate outline less the bezel (0 outside [min, max]). */
export function windowHalfWidth(zb) {
  if (zb < WINDOW_ZB.min - 1e-9 || zb > WINDOW_ZB.max + 1e-9) return 0;
  return Math.max(0, plateHalfWidth(zb) - WINDOW_INSET_MM);
}

// ---- where a face's features sit on the plate --------------------------------------------------------------
// The flat insert carries a moulded smile ridge (crest at zb 0.85, corners 1.35 above trimmed bed) and the 2D art puts its eyes at zb 5.4, x +-5.3.
// A photo or sample face that has its eyes and mouth on these marks lines up with the printed smile and fills the plate with the
// face (the chin falls below the plate, the forehead runs up under the brow).
/** Eye-line height, half the eye spacing (mm), and mouth height on the plate. */
export const FACE_TARGET_MM = { eyeZb: 5.4, eyeHalfSpan: 5.3, mouthZb: 1.1 };

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
