// The world-side half of drag-to-feed (docs/specs/playful-interactions-spec.md section 4): everything between a pointer event and `createFeeding` that needs three.js.
//
// It turns client pixels into rays, carries the fruit on a plane just in front of the toy so it follows the finger in perspective, decides "over the toy" from the toy's
// box projected onto the screen (plus a generous margin: a child's drop is not precise), flies an eaten fruit to the toy's mouth, and plays what the toy does about it:
// a character plays its clip (`eat`, `sour`, `belly_pat`), a robot crunches with a spark, a vehicle shakes and honks. world.ts supplies the facts and the little toy effects
// through `FeedWorld`, so this file has no idea what `P` or `S` are, and the whole thing runs in node tests with a real three.js camera and a real prop fx.
//
// The wiring in world.ts is: `down` first in the pointerdown handler (before the prop tap, so a press on a fruit is NOT a tap yet), `move` / `up` / `cancel` on the
// canvas, `update(dt)` each frame, `reset()` when the world is rebuilt.
import * as THREE from "three";
import { type EaterKind, type Reaction, type Verdict } from "./fruitAppetite";
import { createFeeding, reactionSteps, type FeedAdapter } from "./fruitFeeding";
import type { FruitRef, PropFx } from "./propReactions";

/** The little things a toy can be made to do. world.ts implements them on its own player rig. */
export interface ToyFx {
  /** Play a character clip. False when it cannot (reduced motion, the clips not loaded yet), so the caller falls back to a hop. */
  clip(action: "eat" | "sour" | "belly_pat"): boolean;
  /** A hop of this height (world units) over this many seconds. */
  hop(height: number, seconds: number): void;
  /** A quick side-to-side shake (a vehicle saying no). */
  wobble(): void;
  /** A beep: frequency, delay, duration, wave, volume, slide-to frequency. */
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** A small burst of sparks (a robot crunching). */
  spark(at: THREE.Vector3): void;
}

export interface FeedWorld {
  fx: Pick<PropFx, "pickFruit" | "tapFruitRef" | "liftFruit" | "carryFruit" | "dropFruit" | "eatFruit">;
  canvas: HTMLElement;
  camera(): THREE.Camera;
  /** Point the world's ray at a client position and return it. */
  rayAt(clientX: number, clientY: number): THREE.Raycaster;
  /** What the toy is right now. */
  eater(): EaterKind;
  /** The toy's box in world space (its rig), or null when there is nothing to feed. */
  toyBox(): THREE.Box3 | null;
  /** The z of the plane carried fruit travels in: just in front of the toy. */
  carryZ(): number;
  /** False while a feed must not start (paused, a showcase, a mission cinematic, the level editor). */
  allowed(): boolean;
  toy: ToyFx;
}

/** How far past the toy's own outline (CSS px) a release still counts as "over the toy". */
export const TOY_MARGIN_PX = 48;
/** Where along the toy's height its mouth is, from the feet: the fruit flies there. */
export const MOUTH_HEIGHT = 0.8;
/** How long the fruit takes to reach the mouth; the character's `eat` clip brings its hand up at the same moment. */
export const BITE_SECONDS = 0.35;
/** A carried fruit never goes below this height, so it is never dragged into the ground. */
export const CARRY_MIN_Y = 0.35;

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** The screen rectangle (client px) a world box covers, grown by `margin`. Null if the box is entirely behind the camera. */
export function toyScreenRect(box: THREE.Box3, camera: THREE.Camera, canvasRect: { left: number; top: number; width: number; height: number }, margin = TOY_MARGIN_PX): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = 0;
  const v = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    v.set(x, y, z).project(camera);
    if (v.z > 1) continue;                                   // behind the camera
    seen++;
    const px = canvasRect.left + (v.x * 0.5 + 0.5) * canvasRect.width;
    const py = canvasRect.top + (-v.y * 0.5 + 0.5) * canvasRect.height;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  if (!seen) return null;
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}
export const inRect = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Where a fruit goes when it is eaten: the middle of the toy, at mouth height, on the face nearest the camera. */
export function mouthOf(box: THREE.Box3): THREE.Vector3 {
  return new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * MOUTH_HEIGHT, box.max.z);
}

export function createFeedHook(w: FeedWorld) {
  let clock = 0;
  const later: Array<{ at: number; fn: () => void }> = [];
  /** Do `fn` in `seconds` seconds of the hook's own clock (`update`); at once when that is now. */
  const after = (seconds: number, fn: () => void) => { if (seconds <= 0) fn(); else later.push({ at: clock + seconds, fn }); };
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();

  /** The world point under a client position, on the carry plane. Null if the ray misses it (looking along it). */
  function carryPoint(x: number, y: number): THREE.Vector3 | null {
    plane.set(new THREE.Vector3(0, 0, 1), -w.carryZ());
    const p = w.rayAt(x, y).ray.intersectPlane(plane, hit);
    if (!p) return null;
    return new THREE.Vector3(p.x, Math.max(CARRY_MIN_Y, p.y), p.z);
  }

  function react(r: Reaction, at: THREE.Vector3) {
    const toy = w.toy;
    if (w.eater() === "character" && (r === "eat" || r === "sour" || r === "belly_pat") && toy.clip(r)) return;
    if (r === "decline") {                         // a vehicle: shake and honk twice, politely
      toy.wobble();
      toy.tone(300, 0, 0.16, "sawtooth", 0.05, 200);
      toy.tone(240, 0.2, 0.2, "sawtooth", 0.05, 150);
    } else if (r === "crunch") {                   // a robot: three crunches and a spark
      for (let i = 0; i < 3; i++) { toy.tone(220 + i * 30, i * 0.16, 0.08, "square", 0.04, 110); after(i * 0.16, () => toy.hop(0.1, 0.12)); }
      toy.spark(at);
    } else if (r === "belly_pat") {                // full: two happy pats
      toy.hop(0.16, 0.25);
      after(0.3, () => toy.hop(0.16, 0.25));
      toy.tone(392, 0, 0.1, "triangle", 0.06);
      toy.tone(330, 0.3, 0.12, "triangle", 0.06);
    } else {                                       // eat or sour with no clip to play: a happy hop
      toy.hop(0.25, 0.5);
      toy.tone(523, 0, 0.1, "triangle", 0.06, 784);
    }
  }

  const adapter: FeedAdapter<FruitRef> = {
    pick: (x, y) => (w.allowed() ? w.fx.pickFruit(w.rayAt(x, y)) : null),
    kindOf: (f) => f.kind,
    eater: () => w.eater(),
    now: () => clock,
    overToy: (x, y) => {
      const box = w.toyBox();
      return !!box && inRect(toyScreenRect(box, w.camera(), w.canvas.getBoundingClientRect()), x, y);
    },
    tap: (f) => w.fx.tapFruitRef(f),
    pickUp: (f) => { w.fx.liftFruit(f); },
    carry: (f, x, y) => { const p = carryPoint(x, y); if (p) w.fx.carryFruit(f, p); },
    lean: () => { /* the toy does not lean yet; the hover is reported so it can */ },
    drop: (f) => w.fx.dropFruit(f),
    eat: (f, v: Verdict) => {
      const box = w.toyBox();
      const mouth = box ? mouthOf(box) : new THREE.Vector3();
      if (!w.fx.eatFruit(f, mouth, BITE_SECONDS)) { w.fx.dropFruit(f); return; }   // it was no longer being carried: do not eat thin air
      for (const step of reactionSteps(v)) after(step.at, () => react(step.reaction, mouth));
    },
    refuse: (f, v: Verdict) => {
      const box = w.toyBox();
      w.fx.dropFruit(f);                                       // it falls at the toy's feet, where it was let go
      after(0, () => react(v.reaction, box ? mouthOf(box) : new THREE.Vector3()));
    },
  };
  const feeding = createFeeding(adapter);

  const capture = (e: PointerEvent, on: boolean) => {
    try { if (on) w.canvas.setPointerCapture?.(e.pointerId); else w.canvas.releasePointerCapture?.(e.pointerId); } catch { /* not captured: fine */ }
  };

  return {
    get state() { return feeding.drag.state; },
    /** True when this press landed on a fruit and the gesture is ours: the caller must NOT also tap the prop or walk the toy. */
    down(e: PointerEvent): boolean {
      if (!feeding.drag.down(e.clientX, e.clientY, e.pointerId)) return false;
      capture(e, true);
      return true;
    },
    /** True while a fruit is pressed or carried by this pointer (the caller can skip its own move handling). */
    move(e: PointerEvent): boolean { return feeding.drag.move(e.clientX, e.clientY, e.pointerId); },
    up(e: PointerEvent): boolean {
      const used = feeding.drag.up(e.clientX, e.clientY, e.pointerId);
      if (used) capture(e, false);
      return used;
    },
    cancel(): void { feeding.drag.cancel(); },
    /** Advance the hook's clock (the appetite's time, and the toy's reactions that were scheduled for later). */
    update(dt: number): void {
      clock += dt;
      for (let i = 0; i < later.length;) {
        if (later[i]!.at <= clock) { const [job] = later.splice(i, 1); job!.fn(); } else i++;
      }
    },
    /** A world change or a new toy: drop any gesture, forget fullness and everything scheduled. */
    reset(): void { feeding.reset(); later.length = 0; },
    get appetite() { return feeding.appetite; },
  };
}

export type FeedHook = ReturnType<typeof createFeedHook>;
