// Kip faces the player (Dan, 2026-11-04, playing: "Kip looks left and right but never towards the user?").
//
// The camera sits side-on to the lane, so Kip is only ever seen in profile while he walks, and the one time he turned to the screen was a dance or an idle gesture, which
// start 30 to 60 seconds after he stops (runtime/idleBehavior.ts). Two small rules fix that:
//   1. Once he has stood still and free for a few seconds, he turns to face the screen and stays that way until he is asked to do something.
//   2. A win cheer is played facing the screen (the world sets the facing when `cheer` starts: `world.ts mixGo`).
//
// This file is rule 1 as a pure little state machine: no timers, no three.js, the caller says how long a frame took and what Kip is doing. It never fights another owner of the
// facing: a dance, an idle gesture, a clip, the title or the Create screen own it ("owned"), and then the machine forgets what it was doing and touches nothing.
//
// Facing is the world's `P.tface`, radians about the up axis: 0 faces right (+x), PI left, and -PI/2 the camera (the same angle the dance uses).

/** The facing that looks at the screen. */
export const FACE_CAMERA = -Math.PI / 2;
/** Standing still and free for this long (seconds, drawn each time so it is never a metronome) before he turns to you. */
export const FACE_USER_AFTER_S = [2.5, 4.5] as const;

/** What Kip is doing, as far as this rule cares. */
export type FaceMode =
  | "free" // standing still with nothing to do: he may turn to you
  | "away" // walking, on his way to a target, or doing something in place: if he was turned to you by this rule, he turns back
  | "owned"; // a dance, an idle gesture, a clip, the title or the Create screen has the facing: leave it alone

export const facingCamera = (tface: number): boolean => Math.abs(Math.atan2(Math.sin(tface - FACE_CAMERA), Math.cos(tface - FACE_CAMERA))) < 1e-6;

export interface FaceUser {
  /**
   * Call every frame. Returns the facing to set now, or null for no change. `tface` is the facing as it stands (after whatever else moved it this frame).
   */
  step(dt: number, mode: FaceMode, tface: number): number | null;
  /** Forget everything (a new world, the title screen). */
  reset(): void;
  /** True while he is turned to you by this rule and would turn back. */
  readonly turned: boolean;
}

export function createFaceUser(rng: () => number = Math.random): FaceUser {
  const draw = (): number => {
    const r = rng();
    const k = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0.5; // a draw that is not a number must not stop the turn for good
    return FACE_USER_AFTER_S[0] + k * (FACE_USER_AFTER_S[1] - FACE_USER_AFTER_S[0]);
  };
  let still = 0;
  let wait = draw();
  let back: number | null = null;
  return {
    step(dt, mode, tface) {
      if (mode !== "free") {
        if (still !== 0 || back !== null) { still = 0; wait = draw(); } // a fresh wait for the next time he stands free
        const r = mode === "away" && back !== null && facingCamera(tface) ? back : null; // walking sets its own facing, so only a Kip still looking at the screen turns back
        back = null;
        return r;
      }
      if (!(dt > 0) || !Number.isFinite(dt)) return null;
      if (back !== null && !facingCamera(tface)) { back = null; still = 0; } // somebody else turned him (a new world, a walk): what this rule remembers is stale
      still += dt;
      if (back === null && still >= wait) {
        if (facingCamera(tface)) { back = null; still = -Infinity; return null; } // already looking at you (a win cheer, a dance): nothing to undo, and no second turn
        back = tface;
        return FACE_CAMERA;
      }
      return null;
    },
    reset() { still = 0; back = null; wait = draw(); },
    get turned() { return back !== null; },
  };
}
