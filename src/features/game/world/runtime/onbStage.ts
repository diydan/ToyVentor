// The numbers of the new-player build stage (Dan, 2026-11-05: "leave the turntable but have it not spin; move the pile of bricks further left, then slowly move the bricks and build on the turntable";
// "once built the turntable can spin and the player can Dress"). Pure, so the rules can be tested without a browser; world.ts (ONBS) and workshopScene.ts use them.
//
// The stage: the workshop, a TURNTABLE where Kip will stand (still while the bricks are a pile and while they fly, spinnable once he is built), and the PILE far to its left. Kip stands on the table, so his
// root is raised by the table's top and the bricks' seats include that height. At the end the table sinks into the floor with him on it and he is standing on the floor.

/** The turntable: radius (the base disc; smaller than the title's 2.25 so it stays on the workshop floor, which ends 2 in front of Kip, and the whole stage fits beside the card), height of its top surface, and how far it sinks to vanish under the floor. */
export const TURNTABLE = { r: 1.8, top: 0.36, sink: 0.5 } as const;

/** How far a brick reaches from the centre it is thrown to (an arm or a leg is about a unit long). */
export const BRICK_REACH = 0.8;
/** The pile's scatter: the nearest and the widest a brick is from the pile's centre, and how much the depth is squashed (the formula in `pileSpot`). */
export const PILE_SPREAD = { rMin: 0.2, rSpan: 0.85, zScale: 0.7 } as const;
/** Where the pile's centre is, from Kip's standing place: far enough left that the farthest brick, with its own reach, is still clear of the table's edge by a hand's breadth. */
export const PILE_GAP = 0.25;
export const PILE_DX = -(TURNTABLE.r + PILE_GAP + BRICK_REACH + PILE_SPREAD.rMin + PILE_SPREAD.rSpan);
export const PILE_DZ = 0.3;

/** Where the i-th brick of the pile lies, from the pile's centre (x, z in the floor plane, y up). Depends only on the brick's place in the rig, so a colour change moves no brick. */
export function pileSpot(i: number): { dx: number; dy: number; dz: number } {
  const a = i * 2.399, r = PILE_SPREAD.rMin + (((i * 37) % 10) / 10) * PILE_SPREAD.rSpan;
  return { dx: Math.cos(a) * r, dy: 0.12 + ((i * 13) % 5) * 0.07, dz: Math.sin(a) * r * PILE_SPREAD.zScale };
}

/** The smallest gap, in world units, between the table's edge and any brick of a pile of `n` (a brick counts as a disc of `BRICK_REACH`). Negative means a brick touches the table. */
export function pileClearance(n: number = 120): number {
  let best = Infinity;
  for (let i = 0; i < Math.max(1, n); i++) {
    const s = pileSpot(i);
    const d = Math.hypot(PILE_DX + s.dx, PILE_DZ + s.dz);   // from Kip's standing place (the table's centre)
    best = Math.min(best, d - BRICK_REACH - TURNTABLE.r);
  }
  return best;
}

/** One brick's flight to its seat, in seconds (Dan: slowly), for the build and for a brick the child places (a tap or a drag). */
export const FLIGHT_S = 1.8;
export const PLACE_S = 1.8;
/** The build's total: flights start staggered, the last one lands at `total`. About 0.14 s between starts, at least a flight and a half, at most 6.4 s. */
export function buildTiming(n: number): { dur: number; stag: number; total: number } {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (count === 0) return { dur: FLIGHT_S, stag: 0, total: 0.2 };
  const total = Math.max(FLIGHT_S + 0.4, Math.min(6.4, FLIGHT_S + 0.14 * count));
  return { dur: FLIGHT_S, stag: count > 1 ? (total - FLIGHT_S) / (count - 1) : 0, total };
}
/**
 * While the stage holds the camera stands farther back (a wider view), so the pile, the table and Kip all fit left of the card on a phone held sideways. The stage is about 7.6 units wide and the card
 * keeps about half the screen, so the narrower the screen the farther back: 1.3 at 844 by 390 (aspect 2.16), 1.58 at 667 by 375, never nearer than 1.25 or farther than 2 (measured through the real camera
 * at 844x390, 740x360, 932x430 and 667x375, 2026-11-05).
 */
export const STAGE_ZOOM = 1.25;
export function stageZoom(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return STAGE_ZOOM;
  return Math.min(2, Math.max(STAGE_ZOOM, 2.81 / aspect));
}
/** After the last brick lands the blueprint is whole for this long, then Kip appears on the table. */
export const ARRIVE_MS = 700;
/** The most the sheet waits for the world to say Kip has arrived before it shows its own "built" card (the world normally tells it first). */
export const BUILT_FALLBACK_MS = Math.ceil((6.4 + ARRIVE_MS / 1000) * 1000) + 1900;

/** The sink: how long the table takes to go under the floor with Kip on it, in seconds. */
export const LAND_S = 0.7;
/** The turn nearest to `from` that points the way `to` does (the angles differ by whole turns): Kip lands without spinning a whole way round. */
export function nearestTurn(from: number, to: number): number {
  const f = Number.isFinite(from) ? from : 0, t = Number.isFinite(to) ? to : 0;
  return t + Math.round((f - t) / (2 * Math.PI)) * 2 * Math.PI;
}
/** The pose k of the way through the sink (0 to 1, eased): Kip's extra height goes to nothing, the table goes under the floor, and he turns to face the screen. */
export function landPose(k: number, top: number, face0: number, face1: number): { y: number; sink: number; face: number } {
  const x = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 1)), e = x * x * (3 - 2 * x);
  return { y: top * (1 - e), sink: -TURNTABLE.sink * e, face: face0 + (nearestTurn(face0, face1) - face0) * e };
}
