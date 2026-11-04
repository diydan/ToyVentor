// The dog follows Kip and sits when Kip stops (docs/specs/playful-interactions-spec.md section 6). It stays at home until Kip first comes close (they have met: it hops, delighted); after that, when Kip
// walks off, it trots after it and stops a couple of units behind it (opposite to the way Kip last walked, so it is never in the way of where Kip is going), and when Kip has stood still for a
// while it sits down facing Kip. If a prop is standing where it stopped it tries the next place: the other side of Kip, then a little further out on each side. When Kip walks again it gets up.
// This is the state machine, with no rendering in it: the world says where the dog and Kip are and how to place the dog (the adapter), and this decides what happens next. Something else having the dog
// (a fetch, Kip petting it, an act, sleep, the pause screen) always wins: following just waits and starts again from standing.
import { DOG_BOUNDS } from "./dogFetch";

export type FollowPhase = "home" | "standing" | "trotting" | "sitting";

export interface FollowAdapter {
  /** Where the dog is along the floor, or null if the room has no dog. */
  dogX(): number | null;
  /** Where Kip is along the floor. */
  toyX(): number;
  /** Is Kip standing still (not walking)? */
  toyStill(): boolean;
  /**
   * How much room there is for the dog to stand at this place along the floor: the distance to the nearest prop (not the dog) beyond what the dog needs, so 0 or more is a free place and
   * less than 0 is standing that far inside a prop. Infinity when there is nothing near.
   */
  clearance(x: number): number;
  /** Place the dog along the floor, facing right (+1) or left (-1). */
  moveDog(x: number, dir: 1 | -1): void;
  /** What the dog is doing, for its animation. */
  cue(name: "run" | "sit" | "lie" | "idle" | "happy"): void;
  /** Where Kip is in depth, and tell the dog to walk to a depth (its own lane is Kip's): once it has met Kip it keeps to his path, side by side along the floor, not a room behind. Optional: absent, the dog keeps its depth. */
  toyZ?(): number;
  laneTo?(z: number): void;
  /** False while something else has the dog or Kip: a fetch, an act, sleep, the pause screen, the editor. */
  allowed(): boolean;
}

/** Kip coming this close the first time is "meeting" the dog: from then on it follows. */
export const ENGAGE_X = 3.2;
/** Kip gets this far from the dog (along the floor) and the dog trots after it. */
export const FOLLOW_START = 4.2;
/** It stops this far from Kip, behind it. */
export const FOLLOW_GAP = 2.2;
/**
 * Its choices of place, best first: behind Kip, the other side of Kip at the same distance, then both sides a little further out, SPOT_COUNT in all. When it arrives at the first it looks at all
 * of them and goes to the first that is free, or, if every one has a prop in it (a crowded room), the one with the most room, so it never ends up standing inside a toy it could have avoided.
 * Even the furthest must be well inside FOLLOW_START: a dog standing where Kip counts as "far" would set off again at once and never settle.
 */
export const SPOT_STEP = 1.6;
export const SPOT_COUNT = 4;
/** How far from Kip the dog stands at its `k`th choice of place (negative: in front of Kip's heading). */
const spotOffset = (k: number, behind: 1 | -1) => (k % 2 === 0 ? behind : -behind) * (FOLLOW_GAP + SPOT_STEP * Math.floor(k / 2));
export const ARRIVE = 0.15;
/** How long Kip has to stand still, with the dog by it, before the dog sits. */
export const SIT_AFTER_S = 1.8;
/** How much longer Kip stays still, with the dog sitting by him, before it settles onto its belly. It gets up again as soon as Kip walks. */
export const LIE_AFTER_S = 12;
export const TROT_SPEED = 4.2;
/** It slows down over the last stretch so it does not stop dead. */
const SLOW_WITHIN = 1.0, SLOW_SPEED = 1.3;

const clamp = (x: number) => Math.max(DOG_BOUNDS[0], Math.min(DOG_BOUNDS[1], x));
const sign = (x: number): 1 | -1 => (x < 0 ? -1 : 1);

export function createFollow(a: FollowAdapter) {
  let phase: FollowPhase = "home";
  let x = 0;                                                   // where the dog is while it trots (the adapter is told, not asked, so the dog moves at a steady speed)
  let behind: 1 | -1 = -1;                                     // which side of Kip is "behind" it for this trot
  let spot = 0;                                                // which of its choices of place it is making for
  let chosen = false;                                          // it has looked at all its choices and picked (once per trot, so it never goes back and forth)
  let heading: 1 | -1 = 1;                                     // the way Kip last walked
  let lastToy: number | null = null;
  let stillFor = 0;
  let sitFor = 0;                                              // how long it has been sitting with Kip still (it lies down after LIE_AFTER_S)
  let lying = false;
  let wasAllowed = true;

  /** The first choice of place with nothing in it, or if there is none the one with the most room (the earlier choice wins a tie). */
  const bestSpot = (toy: number): number => {
    let best = 0, bestRoom = -Infinity;
    for (let k = 0; k < SPOT_COUNT; k++) {
      const room = a.clearance(clamp(toy + spotOffset(k, behind)));
      if (room >= 0) return k;
      if (room > bestRoom) { best = k; bestRoom = room; }
    }
    return best;
  };
  const faceKip = (dx: number) => { a.moveDog(dx, sign(a.toyX() - dx)); };
  const startTrot = (dx: number) => { x = dx; behind = heading === 1 ? -1 : 1; spot = 0; chosen = false; a.cue("run"); phase = "trotting"; stillFor = 0; lying = false; };

  return {
    get phase(): FollowPhase { return phase; },
    /** Has the dog met Kip (and so follows it)? */
    get engaged(): boolean { return phase !== "home"; },
    /** Is the dog lying on its belly (it was sitting by Kip for LIE_AFTER_S while he stood still)? `phase` stays "sitting". */
    get lying(): boolean { return lying; },
    update(dt: number): void {
      const ok = a.allowed();
      const dx0 = a.dogX();
      if (dx0 === null) { phase = "home"; wasAllowed = ok; return; }
      if (!ok) {
        if (wasAllowed) {                                      // something else has the dog: stop whatever this was doing and begin again from standing when it is free
          if (phase === "trotting") a.cue("idle");
          if (phase !== "home") phase = "standing";
          stillFor = 0; lying = false;
        }
        wasAllowed = false;
        return;
      }
      wasAllowed = true;
      const toy = a.toyX();
      if (lastToy !== null && Math.abs(toy - lastToy) > 1e-4) heading = sign(toy - lastToy);
      lastToy = toy;
      if (phase !== "home") a.laneTo?.(a.toyZ?.() ?? 0);
      if (phase === "home") {
        if (Math.abs(toy - dx0) <= ENGAGE_X) { phase = "standing"; stillFor = 0; a.cue("happy"); }
        return;
      }
      if (phase === "trotting") {
        const target = clamp(toy + spotOffset(spot, behind));
        const d = target - x;
        const speed = Math.abs(d) < SLOW_WITHIN ? Math.max(SLOW_SPEED, TROT_SPEED * Math.abs(d)) : TROT_SPEED;
        const move = Math.min(Math.abs(d), speed * Math.max(0, dt));
        if (Math.abs(d) > 1e-9) { x += Math.sign(d) * move; a.moveDog(x, sign(d)); }
        if (Math.abs(target - x) <= ARRIVE) {
          if (!chosen) {
            chosen = true;
            const best = bestSpot(toy);
            if (best !== spot) { spot = best; return; }                                                // a better place than this one: go there instead
          }
          phase = "standing"; stillFor = 0; a.cue("idle"); faceKip(x);
        }
        return;
      }
      const dx = dx0;
      const far = Math.abs(toy - dx) > FOLLOW_START;
      if (phase === "sitting") {
        if (far) startTrot(dx);
        else if (!a.toyStill()) { phase = "standing"; stillFor = 0; lying = false; a.cue("idle"); }
        else {
          sitFor += Math.max(0, dt);
          if (!lying && sitFor >= LIE_AFTER_S) { lying = true; a.cue("lie"); }           // Kip has been still a long while: it settles onto its belly
        }
        return;
      }
      // standing
      if (far) { startTrot(dx); return; }
      if (a.toyStill()) {
        stillFor += Math.max(0, dt);
        if (stillFor >= SIT_AFTER_S) { faceKip(dx); a.cue("sit"); phase = "sitting"; sitFor = 0; lying = false; }
      } else stillFor = 0;
    },
    /** A world change or a new toy: it forgets Kip (it has not met it) and stands about. */
    reset(): void {
      if (phase === "trotting" || phase === "sitting") a.cue("idle");
      phase = "home"; stillFor = 0; lying = false; wasAllowed = true;
    },
  };
}

export type DogFollow = ReturnType<typeof createFollow>;
