// What the cooking level is made of (docs/specs/play-design-spec.md, "Activity levels", activity 2): the kitchen counter with its hob and pan, the bowl, the egg, the pancakes, the plates, the spatula
// Kip holds and the hob that is the Toy Room prop. Meshes only, primitive-built stand-ins (the printable spatula and frying pan are not shown in the game yet); the numbers are cookModel.ts, and
// cook.ts moves them.
//
//   createCookSet(n)    the whole counter and its n plates, centred on (0, 0, 0): `place(x, z)` puts it in the world; `parts` are what the child touches (userData.part: "egg", "bowl", "pan")
//   buildSpatulaMesh()  the spatula Kip holds (head on the floor at the origin, handle up, like the mop)
//   buildHobProp(x, z)  the Toy Room prop: a little counter with a hob and a pan on it
//
// The pan is hot: the burner glows and steam rises while `setHeat(true)`. Nothing here is ever drawn as something to touch while it is hot: the child flicks the pan from a distance and Kip uses the spatula.
import { T, M, rbox, plastic } from "./worldScene";
import { BOWL, COUNTER, EGG, HOB_X, PAN, PANCAKE_H, PANCAKE_R, PLATE_R, flipPose, panSlot, plateOffset, servePath, spoonPose } from "./cookModel";
import type * as THREE from "three";

const RAW = "#fff0c4", COOKED = "#d98a3d", BATTER = "#ffe9a6";

/** An invisible, finger-sized target on a part: a phone shows about 62 px to the unit, so an egg 0.3 across is 18 px, and a fingertip is not. (A mesh with an invisible material is still hit by a ray.) */
const hitArea = (radius: number, y = 0): THREE.Mesh => {
  const m = new T.Mesh(new T.SphereGeometry(radius, 8, 6), new T.MeshBasicMaterial({ visible: false }));
  m.position.y = y;
  return m;
};

export interface CookSet {
  group: THREE.Group;
  /** What the child can touch, by `userData.part`. */
  parts: { egg: THREE.Object3D; bowl: THREE.Object3D; pan: THREE.Object3D };
  /** Put the set in the world: the middle of the counter on the floor at (x, z). */
  place(x: number, z: number): void;
  setHeat(on: boolean): void;
  /** The egg `shake` radians off true, the halves `split` apart (0 to 1), the yolk `drop` of the way into the bowl (0 to 1). */
  setEgg(shake: number, split: number, drop: number): void;
  /** The bowl has batter in it (after the egg goes in). */
  setBatter(on: boolean): void;
  /** Pancake `i` (of the n) `t` seconds after its spoon: in flight, then spreading in the pan. `t` < 0 hides it. */
  setSpoon(i: number, t: number): void;
  /** Every pancake in the pan `t` seconds into the flip (and golden on top once `toasted`). */
  setFlip(t: number, toasted: boolean): void;
  /** Pancake `i` on its way to plate `j`, `u` 0 to 1 (0 = in the pan, 1 = on the plate). */
  setServe(i: number, j: number, u: number): void;
  /** The flip's timing ring round the pan: 0 = hidden, up to 1 = the moment to flip. */
  setRing(v: number): void;
  /** Lift pancake `i` a little above the pan (the child has picked it up), or put it down. */
  setHeld(i: number, on: boolean): void;
  /** Put every pancake back: hidden (the level starts again). */
  clearPancakes(): void;
  readonly pancakeCount: number;
  /** Is pancake `i` showing at all? */
  pancakeShown(i: number): boolean;
  update(dt: number, reduced: boolean): void;
  dispose(): void;
}

export function createCookSet(n: number): CookSet {
  const group = new T.Group();
  const counterMat = plastic("#fff6ea", { roughness: 0.6 });
  group.add(M(rbox(COUNTER.width, COUNTER.height - 0.08, COUNTER.depth, 0.05), counterMat, 0, (COUNTER.height - 0.08) / 2, COUNTER.z));
  group.add(M(rbox(COUNTER.width + 0.1, 0.1, COUNTER.depth + 0.1, 0.04), plastic("#52b7ff", { roughness: 0.4 }), 0, COUNTER.height - 0.05, COUNTER.z));   // the worktop

  // the hob: a dark plate with a burner ring that glows when it is on
  group.add(M(rbox(1.25, 0.05, 1.0, 0.03), plastic("#2a2440", { roughness: 0.5 }), HOB_X, COUNTER.height + 0.025, COUNTER.z));
  const burnerMat = new T.MeshStandardMaterial({ color: "#5a4a60", emissive: "#ff5a1a", emissiveIntensity: 0, roughness: 0.5 });
  const burner = new T.Mesh(new T.TorusGeometry(0.46, 0.05, 8, 28), burnerMat);
  burner.rotation.x = Math.PI / 2;
  burner.position.set(HOB_X, COUNTER.height + 0.06, COUNTER.z);
  burner.userData.noPick = true;
  group.add(burner);

  // the pan: dark, with a handle toward the camera's right, standing on the burner
  const pan = new T.Group();
  pan.position.set(PAN.x, PAN.y, PAN.z);
  pan.add(M(new T.CylinderGeometry(PAN.r, PAN.r * 0.9, 0.14, 24), plastic("#3a3446", { roughness: 0.4, metalness: 0.2 }), 0, -0.1, 0));
  pan.add(M(new T.CylinderGeometry(PAN.r * 0.86, PAN.r * 0.86, 0.02, 24), plastic("#5a5468", { roughness: 0.5 }), 0, -0.02, 0));
  pan.add(M(rbox(0.62, 0.06, 0.09, 0.02), plastic("#ff9d5c", { roughness: 0.5 }), PAN.r + 0.26, -0.08, 0));
  pan.add(hitArea(PAN.r + 0.14, 0.05));
  pan.userData.part = "pan";
  group.add(pan);
  // steam (hidden until hot)
  const steam: THREE.Mesh[] = [];
  for (let k = 0; k < 4; k++) {
    const s = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
    s.userData.noPick = true;
    s.position.set(PAN.x + (k - 1.5) * 0.2, PAN.y + 0.2, PAN.z);
    group.add(s);
    steam.push(s);
  }

  // the bowl, with a wooden spoon, and batter once the egg has gone in
  const bowl = new T.Group();
  bowl.position.set(BOWL.x, BOWL.y, BOWL.z);
  bowl.add(M(new T.CylinderGeometry(BOWL.r, BOWL.r * 0.72, 0.34, 22), plastic("#ffd24d", { roughness: 0.4 }), 0, 0.17, 0));
  const batter = M(new T.CylinderGeometry(BOWL.r * 0.9, BOWL.r * 0.9, 0.02, 22), plastic(BATTER, { roughness: 0.2 }), 0, 0.3, 0);
  batter.visible = false;
  bowl.add(batter);
  const spoon = M(new T.CylinderGeometry(0.025, 0.025, 0.6, 8), plastic("#c98a4a", { roughness: 0.7 }), BOWL.r * 0.35, 0.5, 0);
  spoon.rotation.z = -0.35;
  bowl.add(spoon);
  bowl.add(hitArea(BOWL.r + 0.2, 0.25));
  bowl.userData.part = "bowl";
  group.add(bowl);

  // the egg: a whole one, and two halves and a yolk for the crack
  const egg = new T.Group();
  egg.position.set(EGG.x, EGG.y + 0.14, EGG.z);
  const shell = plastic("#fffaf0", { roughness: 0.5 });
  const whole = M(new T.SphereGeometry(0.15, 14, 10), shell);
  whole.scale.set(0.82, 1.1, 0.82);
  egg.add(whole);
  const topHalf = M(new T.SphereGeometry(0.15, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  const botHalf = M(new T.SphereGeometry(0.15, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell);
  for (const h of [topHalf, botHalf]) { h.scale.set(0.82, 1.1, 0.82); h.visible = false; egg.add(h); }
  const yolk = M(new T.SphereGeometry(0.09, 10, 8), plastic("#ffb800", { roughness: 0.2 }));
  yolk.visible = false;
  egg.add(yolk);
  egg.add(hitArea(0.45));
  egg.userData.part = "egg";
  group.add(egg);
  const eggCup = M(new T.CylinderGeometry(0.1, 0.07, 0.08, 12), plastic("#ff5a4d", { roughness: 0.5 }), EGG.x, EGG.y + 0.04, EGG.z);
  group.add(eggCup);

  // plates
  const plates: THREE.Mesh[] = [];
  for (let j = 0; j < n; j++) {
    const o = plateOffset(j, n);
    const plate = M(new T.CylinderGeometry(PLATE_R, PLATE_R * 0.85, 0.05, 20), plastic("#ffffff", { roughness: 0.3 }), o.x, 0.03, o.z);
    plate.userData.part = `plate${j}`;
    plate.userData.noPick = true;
    group.add(plate);
    plates.push(plate);
  }

  // pancakes: a golden body with a top that is pale until it is flipped
  const bodyGeo = new T.CylinderGeometry(PANCAKE_R, PANCAKE_R, PANCAKE_H, 18);
  const topGeo = new T.CylinderGeometry(PANCAKE_R * 0.96, PANCAKE_R * 0.96, 0.012, 18);
  const cakes: Array<{ g: THREE.Group; top: THREE.Mesh; mat: THREE.Material }> = [];
  for (let i = 0; i < n; i++) {
    const g = new T.Group();
    g.add(M(bodyGeo, plastic(COOKED, { roughness: 0.7, clearcoat: 0.05 }), 0, 0, 0));
    const topMat = plastic(RAW, { roughness: 0.7, clearcoat: 0.05 });
    const top = M(topGeo, topMat, 0, PANCAKE_H / 2 + 0.006, 0);
    g.add(top);
    g.visible = false;
    g.userData.part = `pancake${i}`;
    g.userData.noPick = true;
    group.add(g);
    cakes.push({ g, top, mat: topMat });
  }
  const slotPos = (i: number) => { const s = panSlot(i, n); return { x: PAN.x + s.x, y: PAN.y + PANCAKE_H / 2 + 0.01, z: PAN.z + s.z }; };
  const platePos = (j: number) => { const o = plateOffset(j, n); return { x: o.x, y: 0.07 + PANCAKE_H / 2, z: o.z }; };
  const goldenTop = plastic(COOKED, { roughness: 0.7, clearcoat: 0.05 });
  const rawTop = (i: number) => cakes[i]!.mat;
  const putAt = (i: number, p: { x: number; y: number; z: number }) => cakes[i]!.g.position.set(p.x, p.y, p.z);

  const ringMat = new T.MeshBasicMaterial({ color: "#ffd24d", transparent: true, opacity: 0, depthWrite: false });
  const ring = new T.Mesh(new T.TorusGeometry(PAN.r + 0.12, 0.035, 8, 36), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(PAN.x, PAN.y + 0.02, PAN.z);
  ring.visible = false;
  ring.userData.noPick = true;
  group.add(ring);
  let steamT = 0, heat = false;
  return {
    group,
    parts: { egg, bowl, pan },
    place(x, z) { group.position.set(x, 0, z); },
    setHeat(on) { heat = on; burnerMat.emissiveIntensity = on ? 1.6 : 0; if (!on) for (const s of steam) (s.material as THREE.MeshBasicMaterial).opacity = 0; },
    setEgg(shake, split, drop) {
      const cracked = split > 0 || drop > 0;
      whole.visible = !cracked;
      topHalf.visible = botHalf.visible = cracked && drop < 1;
      yolk.visible = cracked && drop < 1;
      egg.visible = !(drop >= 1);
      egg.rotation.z = shake;
      topHalf.position.set(-0.18 * split, 0.03 * split, 0);
      botHalf.position.set(0.18 * split, -0.03 * split, 0);
      topHalf.rotation.z = 0.7 * split; botHalf.rotation.z = -0.7 * split;
      yolk.position.set(0, 0.02 - drop * 0.35, 0);
    },
    setBatter(on) { batter.visible = on; },
    setSpoon(i, t) {
      const c = cakes[i];
      if (!c) return;
      if (t < 0) { c.g.visible = false; return; }
      const p = spoonPose(t);
      const from = { x: BOWL.x, y: BOWL.y + 0.45, z: BOWL.z }, to = slotPos(i);
      c.g.visible = true;
      c.g.position.set(from.x + (to.x - from.x) * p.f, from.y + (to.y - from.y) * p.f + p.arc, from.z + (to.z - from.z) * p.f);
      c.g.scale.set(0.35 + 0.65 * p.spread, 1, 0.35 + 0.65 * p.spread);
      c.g.rotation.set(0, 0, 0);
    },
    setFlip(t, toasted) {
      const f = flipPose(t);
      for (let i = 0; i < n; i++) {
        const c = cakes[i]!;
        if (!c.g.visible) continue;
        const s = slotPos(i);
        c.g.position.set(s.x, s.y + f.lift, s.z);
        c.g.rotation.set(f.turn, 0, 0);
        c.g.scale.set(1, 1, 1);
        c.top.material = toasted && f.turn >= Math.PI - 1e-6 ? goldenTop : rawTop(i);
      }
      if (toasted) for (let i = 0; i < n; i++) if (cakes[i]!.g.visible && t >= 0.5) { cakes[i]!.top.material = goldenTop; }
    },
    setServe(i, j, u) {
      const c = cakes[i];
      if (!c) return;
      c.g.visible = true;
      c.g.rotation.set(0, 0, 0);
      c.g.scale.set(1, 1, 1);
      putAt(i, servePath(u, slotPos(i), platePos(j)));
    },
    setRing(v) {
      ring.visible = v > 0.001;
      ringMat.opacity = 0.25 + 0.7 * Math.min(1, Math.max(0, v));
      ring.scale.setScalar(1 + (1 - Math.min(1, Math.max(0, v))) * 0.35);
    },
    setHeld(i, on) {
      const c = cakes[i];
      if (!c) return;
      const s0 = slotPos(i);
      c.g.position.set(s0.x, s0.y + (on ? 0.32 : 0), s0.z + (on ? 0.1 : 0));
    },
    clearPancakes() { for (let i = 0; i < n; i++) { cakes[i]!.g.visible = false; cakes[i]!.g.scale.set(1, 1, 1); cakes[i]!.g.rotation.set(0, 0, 0); cakes[i]!.top.material = rawTop(i); } },
    get pancakeCount() { return n; },
    pancakeShown(i) { return Boolean(cakes[i]?.g.visible); },
    update(dt, reduced) {
      if (!heat || reduced) return;
      steamT += dt;
      steam.forEach((s, k) => {
        const u = (steamT * 0.5 + k * 0.25) % 1;
        s.position.y = PAN.y + 0.2 + u * 0.7;
        s.position.x = PAN.x + (k - 1.5) * 0.2 + Math.sin(u * 6 + k) * 0.06;
        (s.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.sin(Math.PI * u);
      });
    },
    dispose() { group.parent?.remove(group); },
  };
}

/** A spatula standing on its head: the flat head's middle on the floor at the origin, the handle going up (+y). */
export function buildSpatulaMesh(): THREE.Group {
  const g = new T.Group();
  g.add(M(rbox(0.34, 0.04, 0.4, 0.02), plastic("#c98a4a", { roughness: 0.7 }), 0, 0.06, 0));              // the blade
  g.add(M(new T.CylinderGeometry(0.03, 0.035, 1.1, 10), plastic("#c98a4a", { roughness: 0.7 }), 0, 0.62, 0));  // the handle
  g.add(M(new T.CylinderGeometry(0.045, 0.045, 0.3, 10), plastic("#ff5a4d", { roughness: 0.5 }), 0, 1.0, 0));  // the grip
  return g;
}

/** The Toy Room prop: a little counter with a hob and a pan on it, its centre on the floor at (x, 0, z). The activity's own counter rolls out beside it. */
export function buildHobProp(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.add(M(rbox(1.5, COUNTER.height - 0.08, 1.0, 0.05), plastic("#fff6ea", { roughness: 0.6 }), 0, (COUNTER.height - 0.08) / 2, 0));
  g.add(M(rbox(1.6, 0.1, 1.1, 0.04), plastic("#52b7ff", { roughness: 0.4 }), 0, COUNTER.height - 0.05, 0));
  g.add(M(rbox(0.95, 0.05, 0.8, 0.03), plastic("#2a2440", { roughness: 0.5 }), -0.08, COUNTER.height + 0.025, 0));
  const pan = new T.Group();
  pan.position.set(-0.08, COUNTER.height + 0.14, 0);
  pan.add(M(new T.CylinderGeometry(0.36, 0.32, 0.12, 20), plastic("#3a3446", { roughness: 0.4, metalness: 0.2 }), 0, 0, 0));
  pan.add(M(rbox(0.4, 0.05, 0.08, 0.02), plastic("#ff9d5c", { roughness: 0.5 }), 0.58, 0, 0));
  g.add(pan);
  const cake = M(new T.CylinderGeometry(0.2, 0.2, 0.06, 16), plastic(COOKED, { roughness: 0.7, clearcoat: 0.05 }), -0.08, COUNTER.height + 0.2, 0);
  g.add(cake);
  g.userData.hob = true;
  return g;
}
