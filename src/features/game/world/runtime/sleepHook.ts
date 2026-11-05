// The world-side half of "tap the bed and the toy goes to sleep" (docs/specs/playful-interactions-spec.md section 6): `sleepRoutine.ts` is the state machine, this is
// everything between it and the world that needs three.js or the game's own state: which bed, where the toy lies, the drifting Zzz letters, and what the room does as it
// falls asleep (the world turns `ambient(level)` into the dusk tint, the lamps and the music).
//
// world.ts supplies the facts through `SleepWorld`. The wiring there is: `onBed` (from the prop fx) calls `tapBed(bed)`; the pointerdown handler first asks `consume()`, which
// wakes a sleeping toy and swallows that tap; `update(dt)` each frame; `reset()` when the world is rebuilt.
//
// Bedtime (2026-11-05, the grown-ups' quiet hours or the day's limit: shared/parent-time.ts `PlayTimeStatus.bedtime`): `setBedtime("going")` in the last minute before play stops sends
// the toy to the nearest bed (or, in a world with no bed, lies it down where it stands); `"now"` once the curtain is up puts it to sleep at once if it is not yet; `"off"` wakes the
// sleep that bedtime started (never one the child started) when play comes back. A child who wakes it or walks it off during the lead-in is left alone until the curtain.
//
// Robots and vehicles do not sleep yet (a robot's power-down is a later piece): they politely refuse. A character with no clips to play (reduced motion, not loaded) still
// goes through the motions and simply stands on the bed while the room dims.
import * as THREE from "three";
import { sleepSpot } from "./bed";
import { createSleep, type P3, type SleepPhase } from "./sleepRoutine";
import type { EaterKind } from "./fruitAppetite";

export interface SleepWorld {
  /** Where the Zzz letters live (the world root, so a world change takes them away). */
  root(): THREE.Object3D;
  /** What the toy is. */
  eater(): EaterKind;
  /** Where the toy is now (rig origin on its feet). */
  position(): P3;
  /** The x the toy is currently walking to, or null if it is not walking. */
  targetX(): number | null;
  walkTo(x: number, z: number): void;
  stopWalk(): void;
  /** Place the toy (during a hop). */
  setPosition(x: number, y: number, z: number): void;
  /** Lie down and hold / get up and yawn. They also turn the toy to face +x for the lying pose. */
  lieDown(): void;
  getUp(): void;
  /** False while the toy must not start sleeping (paused, a mission cinematic, an ability running, the editor). */
  allowed(): boolean;
  /** The room is `level` asleep (0 to 1): apply the dusk tint, the lamps and the music. Called when it changes. */
  ambient(level: number): void;
  /** The phase changed (the world marks the toy busy while it is hopping or asleep). */
  phase(phase: SleepPhase, previous: SleepPhase): void;
  /** The toy was asked to sleep but cannot (a robot or a vehicle): say "no, thank you". */
  refuse(): void;
  /** Bedtime: where each bed in this world stands. None (or absent): the toy lies down where it is. */
  beds?(): ReadonlyArray<{ x: number; z: number }>;
  /** Bedtime: false while something owns the screen and the toy (the title). Absent: always fine. */
  bedtimeOk?(): boolean;
  /**
   * Is the lying pose actually held? False when the toy is asleep in the routine's eyes but the animation lost the pose (the player's rig was swapped for the finished one while it slept:
   * a game opened in quiet hours is put to bed before the rig has loaded). The hook then lies it down again. Absent: trust the routine.
   */
  holdsPose?(): boolean;
}

/** off: nothing; going: the lead-in before play stops (walk to bed, lie down); now: play has stopped (asleep at once if not already). */
export type BedtimeMode = "off" | "going" | "now";

/** How close (world units, along x) the toy must be to the bed to start climbing. */
export const ARRIVE_X = 0.45;
/** A walk target this far from the bed means the player sent the toy elsewhere: the sleep is dropped. */
export const REDIRECT_X = 0.6;
/** How often the Zzz drift looks: seconds up, how far up (world units), how far it drifts along x. */
export const ZZZ_RISE_S = 2.4;
export const ZZZ_RISE = 1.4;
export const ZZZ_DRIFT = 0.35;
/** Offsets from the sleeper's rig origin: the head is at the -x end, a little above the mattress. */
export const ZZZ_FROM: Readonly<P3> = { x: -0.75, y: 1.05, z: 0.15 };

const zzzMaterial = (() => {
  let mat: THREE.SpriteMaterial | null = null;
  return (): THREE.SpriteMaterial => {
    if (mat) return mat;
    const opts: THREE.SpriteMaterialParameters = { color: 0xffffff, transparent: true, depthWrite: false, fog: false };
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const g = c.getContext("2d");
      if (g) {
        g.font = "bold 72px system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = "rgba(140,170,255,0.95)"; g.shadowBlur = 14;
        g.fillStyle = "#ffffff";
        g.fillText("Z", 48, 52);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        opts.map = tex;
      }
    }
    mat = new THREE.SpriteMaterial(opts);
    return mat;
  };
})();

interface Bubble { sprite: THREE.Sprite; t: number; from: THREE.Vector3; size: number }

export function createSleepHook(w: SleepWorld) {
  let spot: P3 = { x: 0, y: 0, z: 0 };
  let bedAt = { x: Number.NaN, z: Number.NaN };
  let level = -1;
  const bubbles: Bubble[] = [];
  let ctrl = make({ x: 0, y: 0, z: 0 });
  let mode: BedtimeMode = "off";
  let owned = false;       // the sleep in progress is bedtime's, so "off" may wake it (a sleep the child started with a tap on the bed is not)
  let declined = false;    // the child woke it or walked it off during the lead-in: leave it be until the curtain

  function make(at: P3) {
    return createSleep({
      rig: () => "character",                                  // only characters get this far: `tapBed` refuses robots and vehicles first
      position: () => w.position(),
      walkTo: (x, z) => w.walkTo(x, z),
      arrived: () => Math.abs(w.position().x - at.x) < ARRIVE_X,
      stopWalk: () => w.stopWalk(),
      setPosition: (x, y, z) => w.setPosition(x, y, z),
      lieDown: () => w.lieDown(),
      getUp: () => w.getUp(),
      zzz: () => spawn(at),
      onPhase: (p, prev) => w.phase(p, prev),
    }, { spot: at });
  }

  /** Aim the routine at this bed (a fresh one for a different bed), unless it is mid-sleep. */
  function aimAt(bed: { x: number; z: number }): void {
    if (ctrl.busy) return;
    if (bedAt.x !== bed.x || bedAt.z !== bed.z) {
      bedAt = { x: bed.x, z: bed.z };
      spot = sleepSpot(bed);
      ctrl = make(spot);
    }
  }
  const nearestBed = (): { x: number; z: number } | null => {
    const beds = w.beds?.() ?? [];
    if (!beds.length) return null;
    const x = w.position().x;
    return beds.reduce((best, b) => (Math.abs(b.x - x) < Math.abs(best.x - x) ? b : best));
  };

  /** One look at what bedtime wants, every frame it is on: start, retry, or hurry. */
  function bedtimeStep(): void {
    if (mode === "off" || w.eater() !== "character" || (w.bedtimeOk && !w.bedtimeOk())) return;
    const ph = ctrl.phase;
    if (ph === "awake") owned = false;                         // the walk gave up, or it was woken: nothing in progress
    if (ph === "lying" || ph === "asleep" || ph === "climbing") { owned = true; return; }
    if (ph === "waking" || ph === "descending") return;       // finish getting up first
    if (mode === "going") {
      if (ph !== "awake" || declined || !w.allowed()) return;
      const bed = nearestBed();
      if (bed) { aimAt(bed); if (ctrl.tapBed()) owned = true; }
      else if (ctrl.lieHere()) owned = true;
      return;
    }
    // "now": the curtain is up
    if (ph === "awake" && !w.allowed()) return;               // busy with something that cannot be cut short; the next frame asks again
    const bed = nearestBed();
    if (bed) aimAt(bed);
    if (ctrl.sleepNow(Boolean(bed))) owned = true;
  }

  function spawn(at: P3) {
    const sprite = new THREE.Sprite(zzzMaterial().clone());
    const size = 0.34 + 0.12 * (bubbles.length % 3);
    sprite.scale.setScalar(size);
    const from = new THREE.Vector3(at.x + ZZZ_FROM.x, at.y + ZZZ_FROM.y, at.z + ZZZ_FROM.z);
    sprite.position.copy(from);
    sprite.renderOrder = 10;
    w.root().add(sprite);
    bubbles.push({ sprite, t: 0, from, size });
  }
  function clearBubbles() {
    for (const b of bubbles) { b.sprite.parent?.remove(b.sprite); b.sprite.material.dispose(); }
    bubbles.length = 0;
  }

  return {
    get phase(): SleepPhase { return ctrl.phase; },
    get busy(): boolean { return ctrl.busy; },
    get level(): number { return ctrl.level; },
    get bubbleCount(): number { return bubbles.length; },
    /** Where the toy lies, for the bed last asked for. */
    get spot(): P3 { return spot; },
    /**
     * A bed was tapped. Awake: the toy goes to sleep on that bed (true); a robot or vehicle refuses (false, and `refuse` is called). Asleep or lying: it wakes up. While the world says
     * a sleep must not start, nothing happens. `bed` is where the bed stands (its holder's position).
     */
    tapBed(bed: { x: number; z: number }): boolean {
      if (!ctrl.busy) {
        if (!w.allowed()) return false;
        if (w.eater() !== "character") { w.refuse(); return false; }
        aimAt(bed);                                              // a different bed: a fresh routine aimed at its mattress
      }
      return ctrl.tapBed();
    },
    /** What bedtime is doing now. */
    get bedtime(): BedtimeMode { return mode; },
    /** True while the sleep in progress is bedtime's (so "off" will wake it). */
    get bedtimeOwned(): boolean { return owned; },
    /** True after the child woke it or walked it off during the lead-in: bedtime waits for the curtain. */
    get bedtimeDeclined(): boolean { return declined; },
    /**
     * Bedtime on, off, or at once. The work is done a frame at a time in `update` (a toy that is busy simply waits). `"off"` wakes the sleep bedtime started, never one the child started; a
     * change of mode forgets that the child waved it off.
     */
    setBedtime(next: BedtimeMode): void {
      if (next === mode) return;
      mode = next;
      declined = false;
      if (next === "off") {
        if (owned && ctrl.busy) ctrl.tapElsewhere();             // asleep or lying: wakes; walking: stops; mid-hop: finishes (the call ignores it)
        owned = false;
      }
    },
    /**
     * Call first in the world's pointerdown: true means the tap woke the sleeper (or the toy is mid-hop) and the world must NOT also walk the toy or tap a prop. While the toy is still
     * walking to the bed it returns false and does nothing: the next tap is the player's own, and `update` drops the sleep if the toy is sent elsewhere.
     */
    consume(): boolean {
      if (!ctrl.busy) return false;
      if (ctrl.phase === "walking") return false;
      const wasBedtimes = owned && mode === "going";
      ctrl.tapElsewhere();
      if (wasBedtimes) { declined = true; owned = false; }       // the child woke it: it stays up until the curtain
      return true;
    },
    update(dt: number): void {
      if (ctrl.phase === "walking") {
        const tx = w.targetX();
        if (tx !== null && Math.abs(tx - spot.x) > REDIRECT_X) {
          ctrl.tapElsewhere();                                   // the player sent the toy somewhere else
          if (owned && mode === "going") { declined = true; owned = false; }
        }
      }
      bedtimeStep();
      if ((ctrl.phase === "lying" || ctrl.phase === "asleep") && w.holdsPose && !w.holdsPose()) w.lieDown();     // the pose was lost under him: lie down again
      ctrl.update(dt);
      const l = ctrl.level;
      if (Math.abs(l - level) > 0.004 || ((l === 0 || l === 1) && l !== level)) { level = l; w.ambient(l); }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!;
        b.t += dt;
        const k = Math.min(1, b.t / ZZZ_RISE_S);
        b.sprite.position.set(b.from.x + ZZZ_DRIFT * k, b.from.y + ZZZ_RISE * k, b.from.z);
        b.sprite.material.opacity = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.55) / 0.45));
        b.sprite.scale.setScalar(b.size * (0.8 + 0.5 * k));
        if (k >= 1) { b.sprite.parent?.remove(b.sprite); b.sprite.material.dispose(); bubbles.splice(i, 1); }
      }
    },
    /** A world change or a new toy: the room is awake at once, the Zzz are gone and nothing is remembered. */
    reset(): void {
      const was = ctrl.phase;
      owned = false; declined = false;                          // the mode stays: bedtime carries on in the next world
      ctrl.reset();
      if (was !== "awake") w.phase("awake", was);               // the world un-busies the toy and lets go of the lying pose
      clearBubbles();
      if (level !== 0) { level = 0; w.ambient(0); }
    },
  };
}

export type SleepHook = ReturnType<typeof createSleepHook>;
