// "Walk over, then do something" (docs/specs/playful-interactions-spec.md section 6, the Toy Room interactions: hug the teddy, jump on the cushions, kick the ball), as a small state machine
// with no rendering in it. The world supplies an adapter (where the toy is, how to walk it, which way it faces); each interaction supplies a `Visit`: where to stand, how long the action takes,
// what happens on arrival, at certain moments and at the end. Safe by construction: the walk gives up after a few seconds, a toy sent somewhere else drops the visit, only one visit runs at a
// time, and cancelling an action in progress still calls its `end` so whatever it started is put right.
import type { P3 } from "./sleepRoutine";

export type VisitPhase = "idle" | "walking" | "acting";

export interface VisitAdapter {
  position(): P3;
  /** The x the toy is currently walking to, or null if it is not walking. */
  targetX(): number | null;
  walkTo(x: number, z: number): void;
  /** Like `walkTo` but the walk may go out past the lane's edge (to `z` as deep as -3.4), for a visit that stands at its prop's depth (`Visit.deep`). Absent: `walkTo` is used and the visit must step the rest itself. */
  walkDeep?(x: number, z: number): void;
  stopWalk(): void;
  /** Turn the toy to face +x (1) or -x (-1). */
  face(dir: 1 | -1): void;
  /** Told on every phase change. */
  onPhase?(phase: VisitPhase, previous: VisitPhase): void;
}

export interface Visit {
  /** The x the toy stands at to do it. */
  standX: number;
  /** Where in depth it stands, when that matters (a puddle in front of a table); absent: wherever it is now. The toy has arrived when it is within ARRIVE_X of both. */
  standZ?: number;
  /** The toy WALKS out to `standZ` even when that is beyond the lane (a prop set back in the scene), so there is no glide to hide: its feet carry it there and back. */
  deep?: boolean;
  /** Which way it faces while it does it. */
  face: 1 | -1;
  /** How long the action takes, in seconds. */
  seconds: number;
  /** The toy has arrived: start the action (play the clip). */
  begin(): void;
  /** Called every frame of the action with the seconds since `begin` (for a path the toy follows). */
  tick?(t: number): void;
  /** Things that happen at a moment, in seconds after `begin`; each happens once, in order. */
  cues?: ReadonlyArray<{ at: number; fn: () => void }>;
  /** The action is over: `completed` is false when it was cut short. */
  end(completed: boolean): void;
}

export const ARRIVE_X = 0.3;
/** How near a deep visit's stand depth the toy must be before it starts (the walk stops within 0.08 of its target, so this is reached): the depth is part of the act, so it is tighter than ARRIVE_X. */
export const ARRIVE_DEEP_Z = 0.1;
export const WALK_TIMEOUT_S = 8;
export const REDIRECT_X = 0.8;

export function createVisitor(a: VisitAdapter) {
  let phase: VisitPhase = "idle";
  let v: Visit | null = null;
  let t = 0;
  let cue = 0;

  const go = (next: VisitPhase) => { const prev = phase; phase = next; t = 0; a.onPhase?.(next, prev); };
  const finish = (completed: boolean) => {
    const done = v!;
    v = null;
    go("idle");
    done.end(completed);
  };

  return {
    get phase(): VisitPhase { return phase; },
    get busy(): boolean { return phase !== "idle"; },
    /** Start a visit. False (and nothing happens) if one is already under way. */
    start(next: Visit): boolean {
      if (phase !== "idle") return false;
      v = next;
      cue = 0;
      if (next.deep && a.walkDeep) a.walkDeep(next.standX, next.standZ ?? a.position().z);
      else a.walkTo(next.standX, next.standZ ?? a.position().z);
      go("walking");
      return true;
    },
    /** Something else was tapped. While walking to the prop the visit is dropped (returns false: the tap is the player's own); mid-action it is swallowed (true). */
    tapElsewhere(): boolean {
      if (phase === "walking") { a.stopWalk(); v = null; go("idle"); return false; }
      return phase === "acting";
    },
    /** Drop whatever is happening (a world change, a new toy). An action in progress is ended as cut short. */
    cancel(): void {
      if (phase === "walking") { a.stopWalk(); v = null; go("idle"); }
      else if (phase === "acting") finish(false);
    },
    update(dt: number): void {
      if (phase === "walking" && v) {
        const tx = a.targetX();
        if (tx !== null && Math.abs(tx - v.standX) > REDIRECT_X) { a.stopWalk(); v = null; go("idle"); return; }   // the player sent the toy elsewhere
        // The walk finishes first (the toy's last step ends with its feet together, and it stands exactly on its mark); the act starts when it has stopped walking, not when it first comes within reach.
        if (tx === null && Math.abs(a.position().x - v.standX) < ARRIVE_X && (v.standZ === undefined || Math.abs(a.position().z - v.standZ) < (v.deep ? ARRIVE_DEEP_Z : ARRIVE_X))) { a.face(v.face); go("acting"); cue = 0; v.begin(); }
        else { t += dt; if (t >= WALK_TIMEOUT_S) { a.stopWalk(); v = null; go("idle"); } }
        return;
      }
      if (phase === "acting" && v) {
        t += dt;
        v.tick?.(t);
        const cues = v.cues ?? [];
        while (cue < cues.length && cues[cue]!.at <= t) { cues[cue]!.fn(); cue++; }
        if (t >= v.seconds) finish(true);
      }
    },
  };
}

export type Visitor = ReturnType<typeof createVisitor>;
