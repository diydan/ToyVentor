// The new things to play with outside (docs/specs/playful-interactions-spec.md section 6, the backlog table): a low puffy cloud to bounce on (Sky Meadow), a patch of fresh snow for a snow angel
// (Snow Peak), a flower bed with a watering can, a bunny, a picnic blanket and a swing (the Garden), and the crate the junkyard crane drops. Each is a chunky toy in the same plastic as the other props
// (`plastic`, `rbox`) and gives its holder the hooks propReactions.ts and playthings.ts use (`userData.*`), in the way the xylophone and the dog do. What Kip DOES with each is in playthings.ts.
import { T, M, rbox, plastic, capsule } from "./worldScene";
import type * as THREE from "three";

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

// ---- the puffy cloud (Sky Meadow) -------------------------------------------------------------------------------------------

/** The top of the puffy cloud above the floor: where Kip lands when it bounces on it. */
export const PUFF_TOP = 0.95;
export function buildPuffCloud(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const white = plastic("#f6faff", { roughness: 0.9, clearcoat: 0.05 }), pink = plastic("#ffe3ef", { roughness: 0.9, clearcoat: 0.05 });
  ([[0, 0.6, 0, 0.95, 0.72, white], [1.05, 0.5, 0.1, 0.72, 0.62, pink], [-1.05, 0.48, 0, 0.7, 0.6, white], [0.45, 0.85, -0.1, 0.58, 0.55, white], [-0.5, 0.8, 0.15, 0.52, 0.55, pink], [1.7, 0.36, 0, 0.45, 0.5, white], [-1.7, 0.34, 0, 0.42, 0.5, pink]] as Array<[number, number, number, number, number, THREE.Material]>).forEach(([px, py, pz, r, sy, mat]) => {
    const s = M(new T.SphereGeometry(r, 22, 16), mat, px, py, pz);
    s.scale.y = sy;
    g.add(s);
  });
  g.userData.topY = PUFF_TOP;
  return g;
}

// ---- the snow angel patch (Snow Peak) ---------------------------------------------------------------------------------------

/** How big the angel's pad is, and how long the angel takes to appear. */
export const ANGEL_PAD_R = 1.8;
/** The angel as flat shapes on the snow: a round head, a long body ("gown"), and two wings, drawn standing up the screen (head away from the camera). */
export function buildAngelPatch(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const snow = plastic("#f6f9ff", { roughness: 0.85, clearcoat: 0.1 });
  g.add(M(new T.CylinderGeometry(ANGEL_PAD_R, ANGEL_PAD_R + 0.1, 0.1, 40), snow, 0, 0.05, 0));
  const imprint = new T.Group();
  const dent = plastic("#8fb2e0", { roughness: 0.95, clearcoat: 0 });
  const flat = (geo: THREE.BufferGeometry, px: number, pz: number, ry = 0, sx = 1, sz = 1) => {
    const m = M(geo, dent, px, 0.112, pz);
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.scale.set(sx, sz, 1); m.castShadow = false;
    return m;
  };
  imprint.add(flat(new T.CircleGeometry(0.26, 20), 0, -0.9));                                   // the head (away from the camera)
  imprint.add(flat(new T.CircleGeometry(0.3, 20), 0, -0.3, 0, 1, 2.3));                         // the long body
  imprint.add(flat(new T.CircleGeometry(0.28, 20), 0, 0.55, 0, 1.9, 1.2));                      // the gown, wider at the feet
  imprint.add(flat(new T.CircleGeometry(0.5, 20), -0.78, -0.45, 0.55, 1, 0.38));               // the wings, swept up
  imprint.add(flat(new T.CircleGeometry(0.5, 20), 0.78, -0.45, -0.55, 1, 0.38));
  imprint.scale.setScalar(0.001);
  imprint.visible = false;
  g.add(imprint);
  const IMPRINT_SCALE = 1.35;                                                                    // drawn about 2.5 units across so the camera's low view of the pad still reads it as an angel
  g.userData.imprint = imprint;
  /** 0 = clean snow, 1 = the angel is there in full. It stays until the next angel replaces it. */
  g.userData.setImprint = (k: number) => {
    const s = clamp01(k);
    imprint.visible = s > 0.001;
    imprint.scale.setScalar(Math.max(0.001, s * IMPRINT_SCALE));
  };
  return g;
}

// ---- the watering can (held, and standing by the flower bed) ----------------------------------------------------------------

/** A small watering can: a round body, a spout out to +x and a handle behind it; about 0.6 across. */
export function buildCanMesh(): THREE.Group {
  const g = new T.Group();
  const blue = plastic("#4fa8ff", { roughness: 0.4 }), rim = plastic("#2f7fd6", { roughness: 0.4 });
  g.add(M(new T.CylinderGeometry(0.2, 0.22, 0.34, 18), blue, 0, 0.17, 0));
  g.add(M(new T.CylinderGeometry(0.21, 0.21, 0.04, 18), rim, 0, 0.35, 0));
  const spout = M(new T.CylinderGeometry(0.035, 0.05, 0.42, 10), blue, 0.33, 0.3, 0);
  spout.rotation.z = -1.0;
  g.add(spout);
  g.add(M(new T.CylinderGeometry(0.06, 0.06, 0.05, 12), rim, 0.5, 0.45, 0).rotateZ(-1.0));          // the rose (the sprinkler head)
  const handle = M(new T.TorusGeometry(0.15, 0.025, 8, 16, Math.PI), rim, -0.2, 0.3, 0);
  handle.rotation.z = Math.PI / 2 + 0.2;
  g.add(handle);
  return g;
}

// ---- the flower bed ---------------------------------------------------------------------------------------------------------

export const FLOWER_COLORS: readonly string[] = ["#ff5a4d", "#ffd24d", "#ff7ac0"];
export const FLOWER_X: readonly number[] = [-0.85, 0, 0.85];
/** How big a flower is at growth k (0 = a bud on a short stem, 1 = open on a tall one): the stem's height and the head's size. */
export function flowerSize(k: number): { stem: number; head: number; open: number } {
  const e = clamp01(k);
  return { stem: lerp(0.25, 1.0, e), head: lerp(0.3, 1, e), open: e };
}
export function buildFlowerBed(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.add(M(rbox(2.7, 0.3, 1.0, 0.1), plastic("#7a4b2f", { roughness: 0.9, clearcoat: 0.05 }), 0, 0.15, 0));
  g.add(M(rbox(2.5, 0.06, 0.8, 0.05), plastic("#5a3a22", { roughness: 0.95, clearcoat: 0 }), 0, 0.3, 0));
  const green = plastic("#4fbf5a", { roughness: 0.7 });
  const plants: Array<{ stem: THREE.Mesh; head: THREE.Group; petals: THREE.Mesh[] }> = [];
  FLOWER_X.forEach((px, i) => {
    const stem = M(new T.CylinderGeometry(0.04, 0.05, 1, 8), green, px, 0.33, 0);
    g.add(stem);
    const head = new T.Group();
    head.position.set(px, 1.0, 0);
    const petals: THREE.Mesh[] = [];
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2;
      const pet = M(new T.SphereGeometry(0.17, 12, 10), plastic(FLOWER_COLORS[i]!, { roughness: 0.5 }), Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
      pet.scale.set(1, 1, 0.5);
      head.add(pet); petals.push(pet);
    }
    head.add(M(new T.SphereGeometry(0.14, 14, 10), plastic(i === 1 ? "#a8642a" : "#ffcf3a", { roughness: 0.5 }), 0, 0, 0.06));
    g.add(head);
    for (const side of [-1, 1]) {                                                                // two leaves on each stem
      const leaf = M(new T.SphereGeometry(0.16, 10, 8), green, px + side * 0.17, 0.55, 0);
      leaf.scale.set(1.3, 0.45, 0.6); leaf.rotation.z = side * 0.5;
      g.add(leaf);
    }
    plants.push({ stem, head, petals });
  });
  // Tap target: the flowers are tiny buds at first, so an invisible box as tall as the open flowers keeps the whole bed a good target (the tap box is sized from every mesh, seen or not)
  const reach = new T.Mesh(new T.BoxGeometry(2.7, 1.5, 1.0), new T.MeshBasicMaterial());
  reach.visible = false; reach.position.set(0, 0.8, 0);
  g.add(reach);
  const can = buildCanMesh();
  can.position.set(1.95, 0, 0.2);
  can.rotation.y = -0.3;
  g.add(can);
  let growth = 0;
  const setGrowth = (k: number) => {
    growth = clamp01(k);
    plants.forEach((p, i) => {
      const grow = clamp01(growth * 1.15 - i * 0.07);                                           // the three come up one after another
      const sz = flowerSize(grow);
      p.stem.scale.y = sz.stem;
      p.stem.position.y = 0.33 + sz.stem / 2;
      p.head.position.y = 0.33 + sz.stem + 0.06;
      p.head.scale.setScalar(sz.head);
      p.petals.forEach((pet, n) => { const a = (n / 6) * Math.PI * 2, r = 0.05 + 0.15 * sz.open; pet.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); });
    });
  };
  setGrowth(0);
  g.userData.setGrowth = setGrowth;
  g.userData.growth = () => growth;
  g.userData.can = can;
  /** Where the bed's plants are, for the water to fall on and for the bouquet to be picked from. */
  g.userData.flowerX = FLOWER_X;
  return g;
}

/** A bouquet to hold: three flowers in a bunch with a little ribbon, about 0.7 tall, standing along +y from the stems' ends (y = 0). */
export function buildBouquetMesh(): THREE.Group {
  const g = new T.Group();
  const green = plastic("#4fbf5a", { roughness: 0.7 });
  [-0.1, 0, 0.1].forEach((dx, i) => {
    const stem = M(new T.CylinderGeometry(0.02, 0.02, 0.5, 6), green, dx * 0.5, 0.25, 0);
    stem.rotation.z = -dx * 0.9;
    g.add(stem);
    const head = new T.Group();
    head.position.set(dx * 1.8, 0.58 + (i === 1 ? 0.06 : 0), 0);
    for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; const pet = M(new T.SphereGeometry(0.08, 8, 6), plastic(FLOWER_COLORS[i]!, { roughness: 0.5 }), Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); pet.scale.z = 0.5; head.add(pet); }
    head.add(M(new T.SphereGeometry(0.06, 8, 6), plastic("#ffcf3a"), 0, 0, 0.03));
    g.add(head);
  });
  g.add(M(new T.TorusGeometry(0.05, 0.015, 6, 12), plastic("#ff5a8a"), 0, 0.12, 0).rotateX(Math.PI / 2));
  return g;
}

// ---- the bunny --------------------------------------------------------------------------------------------------------------

/** A carrot to hold or to nibble: an orange cone, point down, with a green top, about 0.5 tall; its centre is at y = 0. */
export function buildCarrotMesh(): THREE.Group {
  const g = new T.Group();
  const cone = M(new T.ConeGeometry(0.08, 0.42, 12), plastic("#ff8a2a", { roughness: 0.5 }), 0, 0, 0);
  cone.rotation.x = Math.PI;
  g.add(cone);
  [-0.04, 0, 0.04].forEach((dx, i) => { const leaf = M(new T.ConeGeometry(0.03, 0.2, 6), plastic("#4fbf5a"), dx, 0.28, 0); leaf.rotation.z = dx * 5 + (i - 1) * 0.1; g.add(leaf); });
  return g;
}
/** The poses the bunny's own tick draws: `nibble` (a quick small head bob, 0 to 1 means how recently it started) and `hop`. Pure so a test can pin them. */
export const NIBBLE_S = 2.2;
export function bunnyPose(t: number, nibbleAge: number, hopAge: number): { breathe: number; earTwitch: number; headDip: number; hop: number } {
  const breathe = 1 + 0.025 * Math.sin(t * 2.4);
  const twitch = Math.max(0, Math.sin(t * 0.9)) ** 12;                                           // a flick of the ears every seven seconds or so
  const nib = nibbleAge >= 0 && nibbleAge < NIBBLE_S ? Math.abs(Math.sin(nibbleAge * 13)) * 0.16 * Math.min(1, (NIBBLE_S - nibbleAge) * 3) : 0;
  const hop = hopAge >= 0 && hopAge < 0.5 ? 0.45 * Math.sin((Math.PI * hopAge) / 0.5) : 0;
  return { breathe, earTwitch: twitch * 0.25, headDip: nib, hop };
}
export function buildBunny(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const fur = plastic("#f4efe9", { roughness: 0.9, clearcoat: 0.05 }), pinkIn = plastic("#ffb3c7", { roughness: 0.8, clearcoat: 0 }), ink = plastic("#2b1d14");
  const body = new T.Group();
  const torso = M(new T.SphereGeometry(0.4, 20, 16), fur, 0.15, 0.4, 0);
  torso.scale.set(1.25, 0.9, 0.9);
  body.add(torso);
  body.add(M(new T.SphereGeometry(0.15, 12, 10), fur, 0.66, 0.46, 0));                              // the tail puff
  [-1, 1].forEach((s) => { const foot = M(new T.SphereGeometry(0.13, 10, 8), fur, -0.3, 0.09, s * 0.2); foot.scale.set(1.6, 0.6, 0.8); body.add(foot); });
  g.add(body);
  const head = new T.Group();
  head.position.set(-0.5, 0.8, 0);
  head.add(M(new T.SphereGeometry(0.29, 18, 14), fur, 0, 0.1, 0));
  head.add(M(new T.SphereGeometry(0.05, 8, 6), plastic("#ff8aa8"), -0.29, 0.06, 0));                // the nose
  [-1, 1].forEach((s) => head.add(M(new T.SphereGeometry(0.06, 8, 6), ink, -0.17, 0.19, s * 0.2)));   // the eyes, on both sides so the side view shows one
  [-1, 1].forEach((s) => head.add(M(new T.SphereGeometry(0.085, 8, 6), pinkIn, -0.16, 0.0, s * 0.22)));  // the cheeks
  const ears: THREE.Group[] = [];
  [-1, 1].forEach((s) => {
    const ear = new T.Group();
    ear.position.set(0.04, 0.3, s * 0.12);
    const outer = capsule(0.085, 0.5, fur); outer.position.y = 0.34;
    const inner = capsule(0.045, 0.4, pinkIn); inner.position.set(-0.05, 0.34, s * 0.01);
    ear.add(outer, inner);
    ear.rotation.z = -0.28 + s * 0.04; ear.rotation.x = s * 0.22;
    head.add(ear); ears.push(ear);
  });
  g.add(head);
  const base = { head: head.position.y, ears: ears.map((e) => e.rotation.z) };
  let nibbleAt = -1, hopAt = -1, seen: unknown = null;
  g.userData.tick = (t: number, _dt: number) => {
    // what the world told it (propReactions.ts `cue`: the name and the clock when it was cued)
    const c = g.userData.cue as { name: string; at: number } | undefined;
    if (c && c !== seen) { seen = c; if (c.name === "nibble") nibbleAt = c.at; else if (c.name === "hop") hopAt = c.at; }
    const p = bunnyPose(t, nibbleAt >= 0 ? t - nibbleAt : -1, hopAt >= 0 ? t - hopAt : -1);
    body.scale.y = p.breathe;
    g.position.y = p.hop;
    head.position.y = base.head - p.headDip;
    head.rotation.z = p.headDip * 1.4;
    ears.forEach((e, i) => { e.rotation.z = base.ears[i]! + p.earTwitch * (i ? 1 : -1); });
  };
  return g;
}

// ---- the picnic blanket -----------------------------------------------------------------------------------------------------

export const SANDWICH_COUNT = 3;
export function buildSandwichMesh(): THREE.Group {
  const g = new T.Group();
  const bread = plastic("#e8b878", { roughness: 0.8, clearcoat: 0.05 });
  g.add(M(rbox(0.42, 0.07, 0.34, 0.03), bread, 0, 0, 0));
  g.add(M(rbox(0.4, 0.05, 0.32, 0.02), plastic("#6bd26f", { roughness: 0.7 }), 0, 0.06, 0));
  g.add(M(rbox(0.4, 0.04, 0.32, 0.02), plastic("#ff6b5a", { roughness: 0.7 }), 0, 0.1, 0));
  g.add(M(rbox(0.42, 0.07, 0.34, 0.03), bread, 0, 0.16, 0));
  return g;
}
export function buildPicnic(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.add(M(rbox(3.2, 0.07, 2.1, 0.03), plastic("#ff6b5a", { roughness: 0.95, clearcoat: 0 }), 0, 0.035, 0));
  const white = plastic("#fff6ea", { roughness: 0.95, clearcoat: 0 });
  for (let i = -3; i <= 3; i++) g.add(M(rbox(0.2, 0.01, 2.1, 0.004), white, i * 0.42, 0.075, 0));
  for (let i = -2; i <= 2; i++) g.add(M(rbox(3.2, 0.011, 0.2, 0.004), white, 0, 0.078, i * 0.4));
  const reach = new T.Mesh(new T.BoxGeometry(3.2, 0.9, 2.1), new T.MeshBasicMaterial());                // a taller tap box than the flat blanket
  reach.visible = false; reach.position.set(0, 0.45, 0);
  g.add(reach);
  const wicker = plastic("#c98d5a", { roughness: 0.8, clearcoat: 0.05 });
  g.add(M(rbox(0.85, 0.5, 0.6, 0.1), wicker, 1.0, 0.32, -0.5));
  const handle = M(new T.TorusGeometry(0.34, 0.03, 8, 20, Math.PI), wicker, 1.0, 0.57, -0.5);
  g.add(handle);
  g.add(M(new T.CylinderGeometry(0.34, 0.34, 0.03, 20), plastic("#ffffff"), -0.9, 0.1, 0.45));       // the plate
  const food: THREE.Group[] = [];
  for (let i = 0; i < SANDWICH_COUNT; i++) {
    const s = buildSandwichMesh();
    s.position.set(-0.9 + (i - 1) * 0.02, 0.15 + i * 0.2, 0.45);
    s.rotation.y = i * 0.5;
    g.add(s); food.push(s);
  }
  g.userData.setFood = (n: number) => food.forEach((f, i) => { f.visible = i < n; });
  g.userData.food = food;
  return g;
}

// ---- the swing --------------------------------------------------------------------------------------------------------------

export const SWING_TOP = 3.2;
export const SWING_ROPE = 2.35;
export const SEAT_THICK = 0.1;
/** Where the seat's top is when the swing is at `angle` (radians from straight down): the pivot at the top bar, along the rope. */
export function seatPoint(angle: number): { dx: number; y: number } {
  return { dx: Math.sin(angle) * (SWING_ROPE + SEAT_THICK / 2), y: SWING_TOP - Math.cos(angle) * (SWING_ROPE + SEAT_THICK / 2) + SEAT_THICK / 2 };
}
/** How far the swing is pushed `t` seconds into a ride of `total` seconds: it builds up, holds, and eases off (radians; positive = towards +x). */
export function swingAngle(t: number, total: number, max = 0.62): number {
  if (!(t > 0) || t >= total) return 0;
  const env = Math.min(1, t / 1.6) * Math.min(1, (total - t) / 1.2);
  return max * env * Math.sin(t * 3.3);
}
export function buildSwing(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const wood = plastic("#ff9d5c", { roughness: 0.6 }), steel = plastic("#4a5a8a", { roughness: 0.4 });
  const leg = (sx: number, sz: number) => {
    const len = Math.hypot(0.8, SWING_TOP);
    const m = M(new T.CylinderGeometry(0.07, 0.08, len, 10), wood, sx * 1.6, SWING_TOP / 2, sz * 0.4);
    m.rotation.x = -sz * Math.atan2(0.8, SWING_TOP);
    g.add(m);
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx, sz);
  g.add(M(new T.CylinderGeometry(0.09, 0.09, 3.5, 12), wood, 0, SWING_TOP, 0).rotateZ(Math.PI / 2));
  const pivot = new T.Group();
  pivot.position.set(0, SWING_TOP, 0);
  [-0.42, 0.42].forEach((rx) => pivot.add(M(new T.CylinderGeometry(0.018, 0.018, SWING_ROPE, 6), steel, rx, -SWING_ROPE / 2, 0)));
  pivot.add(M(rbox(1.15, SEAT_THICK, 0.5, 0.04), plastic("#ff5a8a", { roughness: 0.5 }), 0, -SWING_ROPE - SEAT_THICK / 2, 0));
  g.add(pivot);
  let rideAngle = 0;
  g.userData.pivot = pivot;
  g.userData.setAngle = (a: number) => { rideAngle = a; pivot.rotation.z = -a; };
  g.userData.angle = () => rideAngle;
  /** The swing moves a little by itself, so it looks alive; while somebody rides it the ride sets the angle. */
  g.userData.tick = (t: number, _dt: number) => { if (g.userData.riding) return; pivot.rotation.z = -rideAngle + Math.sin(t * 1.1 + x) * 0.035; };
  g.userData.riding = false;
  return g;
}

// ---- the pumpkin patch ------------------------------------------------------------------------------------------------------

/** Where the patch's pumpkins sit (local x, y, z): on the ground in front of the leaves, the pumpkins' own height (0.34 across, squat) so they rest on it. propReactions.ts reads this as `userData.fruitSlots`. */
export const PUMPKIN_SLOTS: ReadonlyArray<readonly [number, number, number]> = [[-0.95, 0.28, 0.5], [0.05, 0.28, 0.75], [1.0, 0.28, 0.4]];
export function buildPumpkinPatch(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const leaf = plastic("#3f9e4a", { roughness: 0.75, clearcoat: 0.05 }), leaf2 = plastic("#58b85a", { roughness: 0.75, clearcoat: 0.05 });
  ([[-1.0, 0.18, -0.3, 0.7, 0], [0.0, 0.22, -0.45, 0.8, 1], [1.05, 0.18, -0.25, 0.7, 0], [-0.4, 0.14, -0.05, 0.5, 1], [0.55, 0.14, -0.1, 0.5, 0]] as Array<[number, number, number, number, number]>).forEach(([px, py, pz, r, c]) => {
    const l = M(new T.SphereGeometry(r, 14, 10), c ? leaf2 : leaf, px, py, pz);
    l.scale.set(1.25, 0.32, 0.9);                                                                // big flat leaves
    l.rotation.y = px * 0.4;
    g.add(l);
  });
  const vine = plastic("#2e7d3a", { roughness: 0.7 });
  [[-0.5, 0.45], [0.55, -0.3], [1.2, 0.6]].forEach(([vx, vz]) => {                                // curly vines between the pumpkins
    const v = M(new T.TorusGeometry(0.22, 0.03, 6, 14, Math.PI * 1.5), vine, vx!, 0.05, vz!);
    v.rotation.x = Math.PI / 2;
    g.add(v);
  });
  g.userData.treeKind = "pumpkin";
  g.userData.fruitSlots = PUMPKIN_SLOTS.map((p) => [...p]);
  return g;
}

// ---- the crate the crane drops ----------------------------------------------------------------------------------------------

export const CRATE = 0.9;
export function buildCrateMesh(): THREE.Group {
  const g = new T.Group();
  const wood = plastic("#d49a58", { roughness: 0.7, clearcoat: 0.1 }), dark = plastic("#8a5a2e", { roughness: 0.8, clearcoat: 0 });
  g.add(M(rbox(CRATE, CRATE, CRATE, 0.07), wood, 0, 0, 0));
  g.add(M(rbox(CRATE + 0.02, 0.1, CRATE + 0.02, 0.02), dark, 0, 0.3, 0));
  g.add(M(rbox(CRATE + 0.02, 0.1, CRATE + 0.02, 0.02), dark, 0, -0.3, 0));
  const x1 = M(rbox(0.1, CRATE * 1.25, 0.06, 0.02), dark, 0, 0, CRATE / 2 + 0.01); x1.rotation.z = 0.78;
  const x2 = M(rbox(0.1, CRATE * 1.25, 0.06, 0.02), dark, 0, 0, CRATE / 2 + 0.01); x2.rotation.z = -0.78;
  g.add(x1, x2);
  return g;
}
