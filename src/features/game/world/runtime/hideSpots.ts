// The hiding spots (the dark bush, the rock, the scarecrow, the crates, the scrap pile ...) are set back behind Kip's walking lane when a world is built, the way the props are (Dan, 2026-11-04: "items off the
// main walking rail, currently many items are on Kip's walking path"). The props got it in the landscape HUD; the hiding spots' big shapes were left on the lane, and this is the same rule for them.
//
// A spot's own depth comes from the catalog (HIDE: -0.6 to -1.4 for most, +2 for the lily pond), which is INSIDE the lane (z -1.2 to 1.2). `setBackSpot` gives the built spot a COPY of its data with z at
// `clearZ` (never the catalog object: the editor and the saved worlds read the original). Not moved: the spots that are up in the air (the "speed" ones, a branch, an island, a crane at y 3.75, nothing on the
// ground to walk into) and anything already behind `clearZ` or in front of the lane (the lily pond is a flat disc at z +2).
//
// `near()` asks whether Kip is close enough to a spot to see it glow, peek at it or open it with an ability: it compares depths with a window of 2. With the shapes at -2.8 and Kip's lane ending at -1.2 that
// window would only touch the back 0.4 of the lane, so a spot's depth is measured from the DEEPEST point of the lane when it is further back than that (`isNearDepth`): Kip's usual line (z = 0) is 1.2
// from it (it was 0.7 from a shape at -0.7), and the back three quarters of the lane is "near". Only the very front of the lane (z above 0.8, where Kip hardly ever stands) no longer counts.
//
// Pure numbers, so a test can walk every spot in the catalog.

/** The deepest the toy can stand (clampPathZ in visitRoutine.ts is +-1.2). */
export const LANE_BACK_Z = -1.2;
/** How close in depth Kip must be to a spot (the window `near()` always used). */
export const NEAR_DEPTH_WINDOW = 2;

interface SpotData { t?: string; z?: number }

/** Does this spot stand on the ground inside the lane (so it has to be moved)? */
export function standsInLane(d: SpotData, clearZ: number): boolean {
  if (d.t === "speed") return false;                  // up in the air
  const z = d.z ?? 0;
  return z < 0 && z > clearZ;                          // behind the middle of the lane, not yet behind `clearZ` (z >= 0: the flat pond in front stays)
}

/** The spot as it is built: a copy with z set back to `clearZ` when it stands in the lane, otherwise the same object. */
export function setBackSpot<T extends SpotData>(d: T, clearZ: number): T {
  return standsInLane(d, clearZ) ? { ...d, z: clearZ } : d;
}

/** The depth `near()` compares Kip's z with: the spot's own, but never further back than the back of the lane. */
export function nearDepth(spotZ: number): number {
  return Math.max(spotZ, LANE_BACK_Z);
}

/** Is Kip (at `playerZ`) within the depth window of a spot at `spotZ`? */
export function isNearDepth(playerZ: number, spotZ: number): boolean {
  return Math.abs(playerZ - nearDepth(spotZ)) < NEAR_DEPTH_WINDOW;
}
