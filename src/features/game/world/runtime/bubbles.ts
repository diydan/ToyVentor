// Soap bubbles (docs/specs/playful-interactions-spec.md section 6): Kip blows them through a wand (toyRoomActs.ts) and any bubble can be popped with a tap. The motion is pure (`spawnBubble`, `stepBubble`);
// `createBubbles` draws them as camera-facing sprites in the world root, drifts them up and sideways, pops the ones that reach the end of their life (quietly) and the ones that are tapped (with a pop sound and a
// quick expanding ring). A cap keeps a child who blows for a minute from drowning the scene.
import * as THREE from "three";
import type { P3 } from "./sleepRoutine";

export const MAX_BUBBLES = 36;
export const POP_S = 0.22;
/** A bubble's radius, rise speed and life range (world units, units per second, seconds). */
export const BUBBLE_R: readonly [number, number] = [0.12, 0.3];
export const BUBBLE_RISE: readonly [number, number] = [0.5, 0.9];
export const BUBBLE_LIFE: readonly [number, number] = [4, 7];

export interface BubbleState {
  /** Where it started (the sway is around this x) and where it is now. */
  x0: number;
  x: number; y: number; z: number;
  r: number;
  rise: number;
  /** Sideways drift per second (a gentle breeze) and the sway's phase. */
  drift: number;
  phase: number;
  age: number;
  life: number;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** A new bubble leaving `from`, with its own size, speed and life drawn from `rng` (a function returning [0, 1), so tests can fix it). `dir` is the way it was blown (+1 right, -1 left). */
export function spawnBubble(from: P3, dir: 1 | -1, rng: () => number): BubbleState {
  return {
    x0: from.x, x: from.x, y: from.y, z: from.z,
    r: lerp(BUBBLE_R[0], BUBBLE_R[1], rng()),
    rise: lerp(BUBBLE_RISE[0], BUBBLE_RISE[1], rng()),
    drift: dir * lerp(0.15, 0.6, rng()),
    phase: rng() * Math.PI * 2,
    age: 0,
    life: lerp(BUBBLE_LIFE[0], BUBBLE_LIFE[1], rng()),
  };
}

/** A bubble `dt` seconds later (a NEW state): it rises, drifts and sways side to side, and grows a little as it goes. */
export function stepBubble(b: BubbleState, dt: number): BubbleState {
  if (!(dt > 0)) return { ...b };
  const age = b.age + dt;
  const x0 = b.x0 + b.drift * dt;
  return { ...b, age, x0, x: x0 + Math.sin(age * 1.7 + b.phase) * 0.22, y: b.y + b.rise * dt };
}
export const bubbleAlive = (b: BubbleState) => b.age < b.life;
/** The size it is drawn at: it swells slightly over its life, then thins into a pop. */
export const bubbleScale = (b: BubbleState) => b.r * (1 + 0.25 * Math.min(1, b.age / b.life));

export interface BubblesWorld {
  root(): THREE.Object3D;
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** A source of numbers in [0, 1) (Math.random in the game). */
  rng?: () => number;
}

interface Live { sprite: THREE.Sprite; s: BubbleState; popped: number | null }

const ringMaterial = (() => {
  let mat: THREE.SpriteMaterial | null = null;
  return (): THREE.SpriteMaterial => {
    if (mat) return mat;
    const opts: THREE.SpriteMaterialParameters = { color: 0xcfeaff, transparent: true, depthWrite: false, fog: false, opacity: 0.8 };
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(64, 64, 20, 64, 64, 62);
        grad.addColorStop(0, "rgba(190,225,255,0.05)");
        grad.addColorStop(0.8, "rgba(190,225,255,0.22)");
        grad.addColorStop(1, "rgba(255,255,255,0.9)");
        g.fillStyle = grad;
        g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 4;
        g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 6; g.lineCap = "round";
        g.beginPath(); g.arc(64, 64, 40, Math.PI * 1.1, Math.PI * 1.45); g.stroke();       // a highlight
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        opts.map = tex; opts.color = 0xffffff; opts.opacity = 1;
      }
    }
    mat = new THREE.SpriteMaterial(opts);
    return mat;
  };
})();

export function createBubbles(w: BubblesWorld) {
  const live: Live[] = [];
  const rng = w.rng ?? Math.random;

  function remove(i: number) {
    const b = live[i]!;
    b.sprite.parent?.remove(b.sprite);
    b.sprite.material.dispose();
    live.splice(i, 1);
  }
  function add(s: BubbleState) {
    // Make room by letting the oldest one go (quietly) rather than refusing to blow.
    while (live.length >= MAX_BUBBLES) remove(0);
    const sprite = new THREE.Sprite(ringMaterial().clone());
    sprite.renderOrder = 9;
    sprite.position.set(s.x, s.y, s.z);
    sprite.scale.setScalar(bubbleScale(s) * 2);
    w.root().add(sprite);
    live.push({ sprite, s, popped: null });
  }

  return {
    get count(): number { return live.filter((b) => b.popped === null).length; },
    /** The sprites of the bubbles that can still be popped (for the world's pointer handler). */
    get sprites(): THREE.Sprite[] { return live.filter((b) => b.popped === null).map((b) => b.sprite); },
    /** Blow `n` bubbles out from `from`, a little scattered, the way `dir` points. */
    blow(from: P3, dir: 1 | -1, n: number): void {
      for (let i = 0; i < n; i++) {
        const at = { x: from.x + (rng() - 0.5) * 0.25, y: from.y + (rng() - 0.5) * 0.2, z: from.z + (rng() - 0.5) * 0.3 };
        add(spawnBubble(at, dir, rng));
      }
      w.tone(700 + rng() * 200, 0, 0.05, "sine", 0.03, 1100);
    },
    /** Pop the nearest bubble the ray goes through, if any. Returns true when one was popped (the tap is used). */
    popAt(ray: THREE.Raycaster): boolean {
      const targets = live.filter((b) => b.popped === null).map((b) => b.sprite);
      if (!targets.length) return false;
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return false;
      const b = live.find((l) => l.sprite === hit.object)!;
      b.popped = 0;
      w.tone(900, 0, 0.07, "sine", 0.1, 280);
      return true;
    },
    update(dt: number): void {
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i]!;
        if (b.popped !== null) {
          b.popped += dt;
          const k = Math.min(1, b.popped / POP_S);
          b.sprite.scale.setScalar(bubbleScale(b.s) * 2 * (1 + 0.8 * k));
          b.sprite.material.opacity = 1 - k;
          if (k >= 1) remove(i);
          continue;
        }
        b.s = stepBubble(b.s, dt);
        b.sprite.position.set(b.s.x, b.s.y, b.s.z);
        b.sprite.scale.setScalar(bubbleScale(b.s) * 2);
        if (!bubbleAlive(b.s)) { b.popped = 0; }                         // the end of its life is a quiet pop
      }
    },
    /** Every bubble gone at once (a world change). */
    reset(): void { while (live.length) remove(live.length - 1); },
  };
}

export type Bubbles = ReturnType<typeof createBubbles>;
