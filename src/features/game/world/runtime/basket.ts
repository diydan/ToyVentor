// The fruit basket (docs/specs/playful-interactions-spec.md section 4: "a basket counts fruit"): a wicker basket in the Garden. Drag a fruit onto it and let go: it drops in, a number floats over the basket
// and counts what is in it, a note rises with each one, and when it holds BASKET_MAX it is full: a happy flourish, then the fruit go and it starts again from nothing. The basket is a prop like any other
// (it has a name, a tap squashes it); `userData.stash(mesh, kind)` is what propReactions.ts `stashFruit` calls when a fruit is let go over it, `userData.tick(t, dt)` runs every frame.
// The pure part (`basketSpot`, `enterPose`, `createBasketCount`) is numbers only so a test can run it; `buildBasket` is the meshes.
import * as THREE from "three";
import { T, M, rbox, plastic } from "./worldScene";

export const BASKET_MAX = 6;
/** How long a fruit takes to settle into its place in the basket. */
export const ENTER_S = 0.28;
/** After the last fruit goes in: how long the full basket shows off before it empties, and how long emptying takes. */
export const FULL_HOLD_S = 1.5;
export const EMPTY_S = 0.4;
/** A note for each fruit as the basket fills: a major scale up (C D E G A C). */
export const COUNT_NOTES: readonly number[] = [262, 294, 330, 392, 440, 523];

/** Where the i-th fruit sits in the basket (local x, y, z): two rows of three, the back row a little higher, peeking over the rim. */
export function basketSpot(i: number): readonly [number, number, number] {
  const k = Math.max(0, Math.min(BASKET_MAX - 1, Math.floor(i)));
  const row = k < 3 ? 0 : 1, col = k % 3;
  return [(col - 1) * 0.36 + (row ? 0.1 : -0.04), 0.5 + row * 0.07, row ? -0.14 : 0.14];
}

/** The pose of a fruit `age` seconds after it was let go over the basket: it drops in from where it was, shrinking to its resting size. `from` is where it was (local to the basket). */
export function enterPose(age: number, from: readonly [number, number, number], to: readonly [number, number, number]): { x: number; y: number; z: number; scale: number } {
  const k = age >= ENTER_S ? 1 : age <= 0 ? 0 : age / ENTER_S;
  const e = k * k * (3 - 2 * k);
  return { x: from[0] + (to[0] - from[0]) * e, y: from[1] + (to[1] - from[1]) * e + 0.35 * Math.sin(Math.PI * k), z: from[2] + (to[2] - from[2]) * e, scale: 1.15 + (0.8 - 1.15) * e };
}

export type BasketPhase = "filling" | "full" | "emptying";
/** The basket's count, as a small state machine: `add()` says whether the fruit was taken (not while full or emptying). */
export function createBasketCount(max = BASKET_MAX) {
  let count = 0;
  let phase: BasketPhase = "filling";
  let age = 0;
  return {
    get count(): number { return count; },
    get phase(): BasketPhase { return phase; },
    /** How far the fruit have shrunk away while emptying (0 = all there, 1 = gone). */
    get emptied(): number { return phase === "emptying" ? Math.min(1, age / EMPTY_S) : phase === "full" ? 0 : 0; },
    add(): boolean {
      if (phase !== "filling") return false;
      count++;
      if (count >= max) { phase = "full"; age = 0; }
      return true;
    },
    update(dt: number): void {
      const d = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (phase === "full") { age += d; if (age >= FULL_HOLD_S) { phase = "emptying"; age = 0; } }
      else if (phase === "emptying") { age += d; if (age >= EMPTY_S) { phase = "filling"; count = 0; age = 0; } }
    },
  };
}

function digitSprite(): { sprite: THREE.Sprite; show(n: number): void } {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  if (canvas) { canvas.width = canvas.height = 128; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex ?? undefined, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.setScalar(0.8);
  sprite.renderOrder = 10;
  sprite.visible = false;
  sprite.userData.noPick = true;
  return {
    sprite,
    show(n: number) {
      sprite.visible = n > 0;
      if (!ctx || !tex || n <= 0) return;
      ctx.clearRect(0, 0, 128, 128);
      ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2);
      ctx.fillStyle = "#fff6ea"; ctx.fill();
      ctx.lineWidth = 8; ctx.strokeStyle = "#ff9d5c"; ctx.stroke();
      ctx.font = "bold 76px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#5a3a22"; ctx.fillText(String(n), 64, 70);
      tex.needsUpdate = true;
    },
  };
}

export function buildBasket(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const wicker = plastic("#c98d5a", { roughness: 0.8, clearcoat: 0.05 }), dark = plastic("#9a6a3c", { roughness: 0.85, clearcoat: 0 });
  g.add(M(rbox(1.5, 0.5, 0.95, 0.14), wicker, 0, 0.25, 0));
  for (let i = -2; i <= 2; i++) g.add(M(rbox(0.07, 0.46, 0.99, 0.02), dark, i * 0.28, 0.25, 0));                  // the weave
  g.add(M(rbox(1.56, 0.07, 1.01, 0.03), dark, 0, 0.5, 0));                                                          // the rim
  const handle = M(new T.TorusGeometry(0.62, 0.045, 8, 24, Math.PI), wicker, 0, 0.55, 0);
  g.add(handle);
  const { sprite, show } = digitSprite();
  sprite.position.set(0, 1.45, 0.3);
  g.add(sprite);
  const count = createBasketCount();
  interface Held { mesh: THREE.Object3D; spot: readonly [number, number, number]; from: readonly [number, number, number]; age: number; stretch: number }
  const held: Held[] = [];
  /** A fruit is let go over the basket: it drops in. False (the fruit just falls) when the basket is full or emptying. */
  g.userData.stash = (mesh: THREE.Object3D, _kind: string): boolean => {
    if (count.phase !== "filling" || held.length >= BASKET_MAX) return false;
    const spot = basketSpot(held.length);
    g.attach(mesh);
    const from: [number, number, number] = [mesh.position.x, mesh.position.y, mesh.position.z];
    held.push({ mesh, spot, from, age: 0, stretch: mesh.scale.x ? mesh.scale.y / mesh.scale.x : 1 });       // (a pear is tall and a pumpkin squat: keep each one's own shape)
    count.add();
    show(count.count);
    g.userData.lastNote = COUNT_NOTES[Math.min(count.count, COUNT_NOTES.length) - 1];
    return true;
  };
  g.userData.count = () => count.count;
  g.userData.held = held;
  g.userData.tick = (t: number, dt: number) => {
    const before = count.phase;
    count.update(dt);
    for (const h of held) {
      h.age += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      const p = enterPose(h.age, h.from, h.spot);
      const shrink = count.phase === "emptying" ? 1 - count.emptied : 1;
      h.mesh.position.set(p.x, p.y, p.z);
      const s = Math.max(0.001, p.scale * shrink);
      h.mesh.scale.set(s, s * h.stretch, s);
    }
    if (before === "emptying" && count.phase === "filling") {                                   // empty again: the fruit are gone
      for (const h of held) h.mesh.parent?.remove(h.mesh);
      held.length = 0;
      show(0);
    }
    if (count.phase === "full") sprite.scale.setScalar(0.8 + 0.12 * Math.sin(t * 9));          // the number dances while the basket is full
    else sprite.scale.setScalar(0.8);
  };
  return g;
}
