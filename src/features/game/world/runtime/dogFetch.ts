// The dog fetches the kicked ball (docs/specs/playful-interactions-spec.md section 6): Kip kicks the ball across the room, and once it has stopped the dog runs to it, picks it up in its mouth, brings it back
// and drops it near Kip's feet with a woof, ready to be kicked again. This is the state machine, with no rendering in it: the world says where the dog, the ball and Kip are and how to place the dog and the ball
// (the adapter), and this decides what happens next. Safe by construction: it waits for the ball to stop (and gives up after a while if it never does), a second kick starts it afresh, a world change puts the
// ball down wherever it is, and nothing can run the dog out of the room.
export type FetchPhase = "idle" | "waiting" | "chasing" | "returning" | "dropping";

export interface FetchAdapter {
  dogX(): number;
  ballX(): number;
  /** Has the kicked ball stopped moving? */
  ballResting(): boolean;
  /** Where Kip is along the floor. */
  toyX(): number;
  /** Place the dog along the floor, facing right (+1) or left (-1). */
  moveDog(x: number, dir: 1 | -1): void;
  /** Place the ball along the floor at this height above it (0 on the floor), without any physics (the dog is carrying it). */
  moveBall(x: number, lift: number): void;
  /** Let the ball go from where it is: it drops, bounces a little and rests. */
  dropBall(): void;
  /** What the dog is doing, for its animation: running, delighted, or just standing about. */
  cue(name: "run" | "happy" | "idle"): void;
  /** A woof. */
  woof(): void;
}

export const DOG_SPEED = 4.4;
/** How far in front of the dog's centre its mouth is, and how high the ball is held. */
export const MOUTH = 1.15;
export const CARRY_LIFT = 0.55;
/** The dog stops this far from Kip when it brings the ball back, on the side it came from. */
export const RETURN_GAP = 1.9;
export const ARRIVE = 0.15;
/** A moment after the ball stops before the dog sets off; how long it stays delighted after dropping it; the longest it waits for a ball that will not stop. */
export const REACT_S = 0.5;
export const DROP_S = 1.2;
export const WAIT_MAX_S = 8;
/** The dog never goes outside these limits along the floor. */
export const DOG_BOUNDS: readonly [number, number] = [1.2, 42.8];

const clamp = (x: number) => Math.max(DOG_BOUNDS[0], Math.min(DOG_BOUNDS[1], x));
const sign = (x: number): 1 | -1 => (x < 0 ? -1 : 1);

export function createFetch(a: FetchAdapter) {
  let phase: FetchPhase = "idle";
  let t = 0;
  let facing: 1 | -1 = -1;
  let x = 0;                                                   // where the dog is while it runs (the adapter is told, not asked, so the dog moves at a steady speed)
  let resting = 0;                                             // how long the ball has been at rest while the dog waits

  const go = (next: FetchPhase) => { phase = next; t = 0; };
  const stepTo = (target: number, dt: number): boolean => {
    const d = target - x;
    const move = Math.min(Math.abs(d), DOG_SPEED * dt);
    if (Math.abs(d) > 1e-9) { x += Math.sign(d) * move; facing = sign(d); a.moveDog(x, facing); }
    return Math.abs(target - x) <= ARRIVE;
  };

  return {
    get phase(): FetchPhase { return phase; },
    get busy(): boolean { return phase !== "idle"; },
    /** The ball has just been kicked: the dog will fetch it once it stops. A kick while a fetch is under way starts it afresh (a ball being carried is set down first). */
    start(): void {
      if (phase === "returning") a.moveBall(a.ballX(), 0);
      x = a.dogX();
      resting = 0;
      go("waiting");
      a.cue("happy");
    },
    update(dt: number): void {
      if (phase === "idle") return;
      t += dt;
      if (phase === "waiting") {
        if (!a.ballResting()) {
          if (t >= WAIT_MAX_S) { a.cue("idle"); go("idle"); }
          resting = 0;
          return;
        }
        resting += dt;                                         // give it a beat after the ball stops
        if (resting >= REACT_S) { x = a.dogX(); a.cue("run"); go("chasing"); }
        return;
      }
      if (phase === "chasing") {
        const ball = a.ballX();
        const side = sign(ball - x);                           // which side of the ball the dog is on: it runs up to it from there
        if (stepTo(clamp(ball - side * MOUTH), dt)) { go("returning"); a.moveBall(ball, CARRY_LIFT); }
        return;
      }
      if (phase === "returning") {
        const toy = a.toyX();
        const side = sign(x - toy);                            // it stays on the side of Kip it is on
        const arrived = stepTo(clamp(toy + side * RETURN_GAP), dt);
        a.moveBall(x + facing * MOUTH, CARRY_LIFT);
        if (arrived) {
          a.dropBall();
          a.cue("happy");
          a.woof();
          go("dropping");
        }
        return;
      }
      if (phase === "dropping" && t >= DROP_S) { a.cue("idle"); go("idle"); }
    },
    /** Drop everything (a world change): a ball being carried is set down where it is, and the dog stands about. */
    cancel(): void {
      if (phase === "returning") a.moveBall(a.ballX(), 0);
      if (phase !== "idle") a.cue("idle");
      phase = "idle"; t = 0;
    },
  };
}

export type DogFetch = ReturnType<typeof createFetch>;
