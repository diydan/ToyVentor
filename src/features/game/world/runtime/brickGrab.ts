// The child holding a brick of the Kip pile (the new-player build, kid bench slice 2): the decisions only, with nothing of three.js in them, so the rules can be tested and the 3D side (the lift, the ghost,
// the blueprint) can stay in world.ts. A press is a GRAB; if the finger stays within `threshold` pixels it is a TAP (the brick goes to its seat when the finger lifts, as it always did), and once it has moved
// further it is a DRAG. Whichever it is, letting go (or the pointer being cancelled or lost) ends the hold and the brick is carried to its seat: a hold never leaves a brick behind. A hold that nobody lets go of
// (a lost finger) is ended by itself after `maxMs`. A second press ends the first one the same way.
export interface BrickGrabOptions<T = unknown> {
  /** Pixels the finger may move and still be a tap. */
  threshold?: number;
  /** Longest a hold may last. */
  maxMs?: number;
  /** Called when the hold expires, with what was held; the caller carries the brick to its seat, as for a release. */
  onExpire?: (held: Held<T>) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}
export interface Held<T> { item: T; id: number; moved: boolean }
export type MoveVerdict = "ignore" | "start" | "drag";

export function createBrickGrab<T>(opts: BrickGrabOptions<T> = {}) {
  const threshold = opts.threshold !== undefined && opts.threshold >= 0 ? opts.threshold : 9;
  const maxMs = opts.maxMs !== undefined && opts.maxMs > 0 ? opts.maxMs : 20000;
  const setT = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let cur: (Held<T> & { x0: number; y0: number; timer: unknown }) | null = null;

  const end = (): Held<T> | null => {
    if (!cur) return null;
    const out: Held<T> = { item: cur.item, id: cur.id, moved: cur.moved };
    clearT(cur.timer);
    cur = null;
    return out;
  };
  return {
    /** Who is held now, if anyone. */
    get held(): Held<T> | null { return cur ? { item: cur.item, id: cur.id, moved: cur.moved } : null; },
    /** A press on a brick. Returns the hold it ended (a second finger), which the caller must carry to its seat like a release. */
    down(item: T, id: number, x: number, y: number): Held<T> | null {
      const previous = end();
      cur = { item, id, x0: x, y0: y, moved: false, timer: setT(() => { const h = end(); if (h) opts.onExpire?.(h); }, maxMs) };
      return previous;
    },
    /** The finger moved. "start" is the first move past the threshold (the drag begins), "drag" every one after, "ignore" for another finger or a wobble. */
    move(id: number, x: number, y: number): MoveVerdict {
      if (!cur || cur.id !== id || !Number.isFinite(x) || !Number.isFinite(y)) return "ignore";
      if (cur.moved) return "drag";
      if (Math.hypot(x - cur.x0, y - cur.y0) < threshold) return "ignore";
      cur.moved = true;
      return "start";
    },
    /** The finger lifted, or the pointer was cancelled or lost (`id` of that pointer; omit to end whatever is held). Returns what was held, or null for another finger. */
    up(id?: number): Held<T> | null {
      if (!cur || (id !== undefined && cur.id !== id)) return null;
      return end();
    },
    /** End the hold without a verdict (abort, the build started): the same object as `up`, kept apart so a caller can read the intent. */
    cancel(): Held<T> | null { return end(); },
  };
}
