// The smooth cover on the game's Kip (Dan, 2026-11-04: "default kip should have hat or hair, we should use the smooth cover if not hair or hat, or hide the studs").
//
// The cover is the forge's `smooth_cover` (shared/forgeCover.ts, spec forge-ai section "The smooth cover"): a flat-bottomed dome that clips onto the head's two crown studs, so a head with no
// hat and no hair looks smooth on top instead of showing two knobs. The forge makes the real part with the CAD (`sdk.cover_addon`); this builds the same shape for the game's renderer from the
// same numbers: the universal footprint (24.4 x 11.9 mm, the 2x1 pad), the superellipse profile (exponent 2.4), the height (0.45 x depth + 2, between 8 and 10 mm) and the corner rule.
// The forge keeps five slices; the game samples the same curve at eleven so the dome is round on screen. tests/kip-cover.test.ts fails if the two drift.
//
// Pure: positions and indices only (no three.js), in the head STL's own frame (x across, y front to back, z up from the head's stud plane), so the loader can hang it on the head with the
// same `scadMesh` turn as every other STL part.
import { COVER_MIN_MM, coverRecipe } from "../../../../../shared/forgeCover";

export interface CoverMesh {
  /** x, y, z per vertex (mm). */
  positions: Float32Array;
  /** Triangles, counter-clockwise seen from outside. The underside is left open: it sits on the head. */
  indices: Uint32Array;
  width: number;
  depth: number;
  height: number;
}

/** The superellipse exponent of the forge's dome profile (forgeCover.ts `coverRecipe`). */
export const COVER_PROFILE_EXP = 2.4;
/** Where along the height the game takes a ring (0 = the base, 1 = the apex). The forge's own five are 0, .35, .65, .85 and .97, and all of them are in here. */
export const COVER_T: readonly number[] = [0, 0.15, 0.35, 0.5, 0.65, 0.75, 0.85, 0.92, 0.97, 0.99];
/** Points on each rounded corner (so a ring has 4 x (this + 1) points). */
export const COVER_CORNER_SEGMENTS = 6;

/** The half-profile factor at height share `t`: how much of the base footprint is left. */
export const coverProfile = (t: number): number => (1 - t ** COVER_PROFILE_EXP) ** (1 / COVER_PROFILE_EXP);

/** A rounded rectangle `w` by `d` with corner radius `r`, as a closed ring of points (counter-clockwise from above), centred on the origin. */
export function roundedRing(w: number, d: number, r: number, segments = COVER_CORNER_SEGMENTS): [number, number][] {
  const rr = Math.max(0, Math.min(r, w / 2, d / 2));
  const hx = w / 2 - rr;
  const hy = d / 2 - rr;
  const pts: [number, number][] = [];
  // corners in counter-clockwise order, each starting where the previous side ends
  const corners: [number, number, number][] = [[hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI], [hx, -hy, (3 * Math.PI) / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + ((Math.PI / 2) * i) / segments;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return pts;
}

/** The dome for a footprint `w` x `d` (clamped to the forge's allowed range by `coverRecipe`). The default is the universal cover, which fits every head. */
export function coverMesh(footprintW: number = COVER_MIN_MM.w, footprintD: number = COVER_MIN_MM.d): CoverMesh {
  const slices = (coverRecipe(footprintW, footprintD).shape as { slices: { z: number; w: number; d: number }[] }).slices;
  const base = slices[0]!;
  const w = base.w;
  const d = base.d;
  const height = Math.max(...slices.map((s) => s.z)) / 0.97;
  const corner = Math.min(w, d) * 0.42;

  const pos: number[] = [];
  const idx: number[] = [];
  const ringStart: number[] = [];
  let ringLen = 0;
  for (const t of COVER_T) {
    const f = coverProfile(t);
    const sw = w * f;
    const sd = d * f;
    const ring = roundedRing(sw, sd, Math.min(0.48 * Math.min(sw, sd), corner * f));
    ringLen = ring.length;
    ringStart.push(pos.length / 3);
    for (const [x, y] of ring) pos.push(x, y, height * t);
  }
  for (let k = 0; k + 1 < ringStart.length; k++) {
    const lo = ringStart[k]!;
    const hi = ringStart[k + 1]!;
    for (let j = 0; j < ringLen; j++) {
      const j2 = (j + 1) % ringLen;
      idx.push(lo + j, lo + j2, hi + j2, lo + j, hi + j2, hi + j);
    }
  }
  // the apex: a fan over the last ring
  const apex = pos.length / 3;
  pos.push(0, 0, height);
  const last = ringStart[ringStart.length - 1]!;
  for (let j = 0; j < ringLen; j++) idx.push(last + j, last + ((j + 1) % ringLen), apex);

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), width: w, depth: d, height };
}
