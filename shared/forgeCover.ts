/**
 * The smooth cover: a flat-bottomed dome that sits on a head's top face and clips onto its two crown studs.
 *
 * Dan, 2026-11-03: the curved, stud-free top is a cover that goes on any head (the printed version ships one head body with
 * studs plus a cover), and a head with no other head accessory wears it by default. It is a crown-slot recipe with
 * `shape.base: "flush"`, so it has no pad under it and no neck, and the daemon builds it with `sdk.cover_addon`.
 *
 * Pure: no DOM, no network, no clock. The footprint limits mirror `COVER_MIN_MM` and `COVER_MAX_MM` in
 * scripts/forge_optimizer_daemon.py (tests/forge-cover.test.ts fails if they drift). A cover narrower than the 2x1 pad cannot wrap a
 * stud socket with a full wall; one wider than 30 x 17.6 mm gets extra sockets or notch-making relief cuts from the 12.5 mm stud grid.
 */
import type { ForgeLoftSlice, ForgeRecipeV1 } from "./forgeOptimizer";

export const COVER_MIN_MM = { w: 24.4, d: 11.9 } as const;
export const COVER_MAX_MM = { w: 30, d: 17.6 } as const;
/** The cover keeps this clear of the head's top edge so it never overhangs it. */
export const COVER_EDGE_INSET_MM = 0.6;
/**
 * A socket is about 6 mm tall (a 2.84 mm stud plus its conical roof) and needs a roof over it, so a dome lower than about 8 mm shows
 * the sockets as two bumps. Measured on the render of the 24.4 x 11.9 cover at 5.3 mm tall (2026-11-03).
 */
export const COVER_DOME_MIN_MM = 8;
export const COVER_DOME_MAX_MM = 10;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** A cover recipe with the given footprint (clamped to the allowed range). The dome is a superellipse, fuller than an ellipse. */
export function coverRecipe(footprintW: number, footprintD: number, id = "smooth_cover"): ForgeRecipeV1 {
  const w = clamp(footprintW, COVER_MIN_MM.w, COVER_MAX_MM.w);
  const d = clamp(footprintD, COVER_MIN_MM.d, COVER_MAX_MM.d);
  const height = clamp(0.45 * d + 2, COVER_DOME_MIN_MM, COVER_DOME_MAX_MM);
  const corner = Math.min(w, d) * 0.42;
  const p = 2.4;
  const slices: ForgeLoftSlice[] = [0, 0.35, 0.65, 0.85, 0.97].map((t) => {
    const f = (1 - t ** p) ** (1 / p);
    const sw = w * f;
    const sd = d * f;
    return { z: round2(height * t), w: round2(sw), d: round2(sd), r: round2(Math.min(0.48 * Math.min(sw, sd), corner * f)) };
  });
  return {
    v: 1,
    id,
    name: "Smooth Cover",
    stat: "Glow",
    behavior: "Smooth curved cover that clips onto the studs of any head",
    slot: "crown",
    shape: { kind: "loft", base: "flush", slices },
  };
}

/** The one cover that fits every head: the footprint of the 2x1 pad. */
export const UNIVERSAL_COVER: ForgeRecipeV1 = coverRecipe(COVER_MIN_MM.w, COVER_MIN_MM.d);

/**
 * A cover sized to one head's top face (its highest loft slice, less a small inset), so it sits flush. A head whose top is no
 * bigger than the pad gets the universal cover. Not a head recipe (a profile2d or star2d shape, or no slices): null.
 */
export function coverRecipeForHead(head: ForgeRecipeV1): ForgeRecipeV1 | null {
  const shape = head.shape;
  if (head.slot !== "head" || shape.kind === "star2d" || shape.kind === "profile2d" || !("slices" in shape) || shape.slices.length < 2) {
    return null;
  }
  const top = shape.slices.reduce((hi, s) => (s.z > hi.z ? s : hi), shape.slices[0]!);
  const id = `smooth_cover_${(head.id ?? "head").replace(/[^a-z0-9_]/gi, "_")}`.slice(0, 64);
  return coverRecipe(top.w - COVER_EDGE_INSET_MM, top.d - COVER_EDGE_INSET_MM, id);
}
