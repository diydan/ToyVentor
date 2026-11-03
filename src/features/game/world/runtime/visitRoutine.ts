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
  stopWalk(): void;
  /** Turn the toy to face +x (1) or -x (-1). */
  face(dir: 1 | -1): void;
  /** Told on every phase change. */
  onPhase?(phase: VisitPhase, previous: VisitPhase): void;
}

export interface Visit {
  /** The x the toy stands at to do it. */
  standX: number;
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
      a.walkTo(next.standX, a.position().z);
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
        if (Math.abs(a.position().x - v.standX) < ARRIVE_X) { a.face(v.face); go("acting"); cue = 0; v.begin(); }
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
