// "Tap the bed and the toy goes to sleep" (docs/specs/playful-interactions-spec.md section 6), as a state machine with no rendering in it.
//
//   awake -> walking (to the bed) -> climbing (a hop up onto the mattress) -> lying (settles, the room starts to dim) -> asleep (Zzz bubbles, room fully dusk)
//   asleep or lying: a tap on the bed or anywhere else -> waking (stretch and yawn on the mattress, the room brightens) -> descending (a hop back to where it stood) -> awake.
//
// The world supplies an adapter (where the toy is, how to walk it, how to lay it down, and so on) and reads `level` every frame: how asleep the ROOM is, 0 to 1,
// which `lampScale`, `musicGain` and `tintAmount` turn into the lamp brightness, the music volume and the dusk-blue tint. Nothing here knows three.js.
// Safe by construction: the walk gives up after a few seconds (a toy that cannot get to the bed stays awake), a vehicle never sleeps, a tap while the toy is mid-hop
// is ignored (no half-poses), and `reset()` puts everything back at once for a world change.

export type SleepPhase = "awake" | "walking" | "climbing" | "lying" | "asleep" | "waking" | "descending";
export type Rig = "character" | "robot" | "vehicle";
export interface P3 { x: number; y: number; z: number }

export interface SleepAdapter {
  /** What the toy is. A vehicle does not sleep on a bed. */
  rig(): Rig;
  /** Where the toy is now (rig origin, on its feet). */
  position(): P3;
  /** Start walking to this floor point. */
  walkTo(x: number, z: number): void;
  /** Has the walk got there? */
  arrived(): boolean;
  /** Stop walking (the sleep was given up on). */
  stopWalk(): void;
  /** Place the toy during a hop, up or down (the controller moves it along the arc). */
  setPosition(x: number, y: number, z: number): void;
  /** Lie down and hold: a character plays the held `sleep` clip, a robot powers down with a slow blue glow. */
  lieDown(): void;
  /** Get up: a character plays the yawn, a robot powers up. */
  getUp(): void;
  /** One "Zzz" bubble drifts up. */
  zzz(): void;
  /** Optional: told on every phase change (for sounds, the toast, the e2e). */
  onPhase?(phase: SleepPhase, previous: SleepPhase): void;
}

export const WALK_TIMEOUT_S = 8;       // give up walking to the bed after this long
export const CLIMB_S = 0.7;            // the hop up onto the mattress
export const HOP_HEIGHT = 0.9;         // how far above the higher end of the hop the toy rises
export const LYING_S = 1.2;            // from landing to fully asleep (lamp already dimming)
export const FIRST_ZZZ_S = 0.8;        // after falling asleep
export const ZZZ_EVERY_S = 1.6;
export const WAKING_S = 1.8;           // the yawn clip's length
export const DOWN_S = 0.5;             // the hop back down to the floor after the yawn
export const LEVEL_UP_PER_S = 1 / 2.5; // the room darkens over 2.5 s
export const LEVEL_DOWN_PER_S = 1 / 1.2;

/** The hop: from `a` to `b` at progress u in [0, 1]: x and z ease, y eases and arcs up by `height`. u = 0 is `a`, u = 1 is exactly `b`. */
export function hopPoint(a: P3, b: P3, u: number, height = HOP_HEIGHT): P3 {
  if (!(u > 0)) return { ...a };            // also a NaN: stay where it is
  if (u >= 1) return { ...b };              // exactly b (the arc's sine would leave a 1e-16 of float dust)
  const k = u;
  const e = k * k * (3 - 2 * k);
  const arc = Math.sin(Math.PI * k) * height;
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e + arc, z: a.z + (b.z - a.z) * e };
}

/** The lamp's brightness as a share of normal (1 awake, 0.15 deepest). */
export const lampScale = (level: number) => 1 - 0.85 * clamp01(level);
/** The music volume as a share of normal (1 awake, 0.2 asleep: a lullaby, not silence). */
export const musicGain = (level: number) => 1 - 0.8 * clamp01(level);
/** How much of the dusk-blue tint to mix in (0 awake, 0.6 asleep). */
export const tintAmount = (level: number) => 0.6 * clamp01(level);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function createSleep(a: SleepAdapter, opts: { spot: P3 }) {
  let phase: SleepPhase = "awake";
  let t = 0;                       // seconds in this phase
  let level = 0;                   // how asleep the room is
  let nextZzz = 0;
  let from: P3 = { x: 0, y: 0, z: 0 };   // where the current hop starts
  let home: P3 = { x: 0, y: 0, z: 0 };   // where the toy stood when it climbed (beside the bed): it hops back down to here

  const go = (next: SleepPhase) => { const prev = phase; phase = next; t = 0; a.onPhase?.(next, prev); };

  const startWake = () => { a.getUp(); go("waking"); };

  return {
    get phase(): SleepPhase { return phase; },
    /** How asleep the room is, 0 to 1. Feed it to lampScale, musicGain and tintAmount. */
    get level(): number { return level; },
    /** True from the tap until the toy is back on the floor and awake. */
    get busy(): boolean { return phase !== "awake"; },
    /**
     * The bed was tapped. Awake: start for the bed (returns true), unless the toy is a vehicle (returns false: the caller plays its "no, thank you"). Walking: change of heart,
     * stay awake. Lying or asleep: wake up. Climbing, waking or descending: ignored, the toy is mid-move. Returns whether the tap was used.
     */
    tapBed(): boolean {
      if (phase === "awake") {
        if (a.rig() === "vehicle") return false;
        a.walkTo(opts.spot.x, a.position().z);       // along its own lane, to the bed's x
        go("walking");
        return true;
      }
      return this.tapElsewhere();
    },
    /**
     * Something else was tapped. Walking: the player wants to go elsewhere, so the sleep is dropped. Lying or asleep: wake up. Otherwise ignored. While `busy` the world must
     * hand taps here and NOT also walk the toy (a toy asleep on the mattress is not walking anywhere); it returns true when the tap was used.
     */
    tapElsewhere(): boolean {
      if (phase === "walking") { a.stopWalk(); go("awake"); return true; }
      if (phase === "lying" || phase === "asleep") { startWake(); return true; }
      return false;
    },
    /** Advance by `dt` seconds (the world's frame step). */
    update(dt: number): void {
      t += dt;
      const target = phase === "lying" || phase === "asleep" ? 1 : 0;
      const rate = target > level ? LEVEL_UP_PER_S : LEVEL_DOWN_PER_S;
      level = target > level ? Math.min(target, level + rate * dt) : Math.max(target, level - rate * dt);
      if (phase === "walking") {
        if (a.arrived()) { home = from = a.position(); go("climbing"); }
        else if (t >= WALK_TIMEOUT_S) { a.stopWalk(); go("awake"); }
      } else if (phase === "climbing") {
        const p = hopPoint(from, opts.spot, t / CLIMB_S);
        a.setPosition(p.x, p.y, p.z);
        if (t >= CLIMB_S) { a.lieDown(); go("lying"); }       // the last sample (u >= 1) was exactly the spot
      } else if (phase === "lying") {
        if (t >= LYING_S) { nextZzz = FIRST_ZZZ_S; go("asleep"); }
      } else if (phase === "asleep") {
        if (t >= nextZzz) { a.zzz(); nextZzz += ZZZ_EVERY_S; }
      } else if (phase === "waking") {
        // The yawn plays where the toy stands on the mattress; then it hops back down.
        if (t >= WAKING_S) { from = opts.spot; go("descending"); }
      } else if (phase === "descending") {
        const p = hopPoint(from, home, t / DOWN_S);
        a.setPosition(p.x, p.y, p.z);
        if (t >= DOWN_S) go("awake");                             // the last sample was exactly home
      }
    },
    /** A world change or a new toy: forget everything, light and sound back to normal at once. */
    reset(): void {
      if (phase === "walking") a.stopWalk();
      phase = "awake"; t = 0; level = 0;
    },
  };
}
