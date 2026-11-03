// "No dead props" (carousel spec §11.7): every scene prop is tappable, reacts, and says what it is ("green tree").
//
//  * idle  - a calm loop (sway, bob, glow pulse); small enough to run under prefers-reduced-motion.
//  * poke  - a tap reaction that starts on the tap's own frame (well under 100 ms).
//  * use   - a state change where it makes sense: lights switch on/off, trees drop fruit, clouds rain, plants sprout, blocks
//            topple, the ball rolls, windmill blades spin up, and so on.
//
// Every prop placed through the level's `props` list is registered here, which is the one path used by authored levels, the level
// kit, Muse "describe a world" recipes, room photos and the level editor, so created and generated props behave exactly like
// built-in ones. A prop type nobody wrote a spec for still gets the generic wiggle and an English name (see FALLBACK_SPEC); the
// registry test (tests/prop-reactions.test.ts) fails if a built-in prop builder has no entry in PROP_SPECS.
import * as THREE from "three";
import { colorKeyFromHex, describeObject, languageInfo, type ColorKey, type LangCode, type NounKey } from "../../../../lib/propNames";
import { getPropLang } from "../../../../lib/propSpeech";
import { prefetchObjectVoices, sayObject } from "../../../../lib/propVoice";
import { sfx, sound, tone } from "./audio";

export const PROP_TYPES = [
  "lantern", "windmill", "cottage", "tree", "bushes", "cloud", "island", "tire", "drum", "shed", "cranebg", "palm", "umbrella",
  "sandcastle", "pine", "snowman", "igloo", "lamp", "blocks", "books", "chair", "plant", "teddy", "ball", "cushions",
] as const;
export type PropType = (typeof PROP_TYPES)[number];

type IdleKind = "sway" | "bob" | "none";
type PokeKind = "wiggle" | "hop" | "squash" | "shake" | "swing";
export type UseKind =
  | "light" | "fruit" | "coconuts" | "snow" | "berries" | "rain" | "sprout" | "topple" | "flutter" | "roll" | "settle" | "squish"
  | "spin" | "boom" | "windmill" | "hat" | "none";

export interface PropSpec {
  /** The vocabulary noun it is called; null only for the fallback spec of an unknown prop type. */
  noun: NounKey | null;
  /** What colour a kid would call it (picked by looking at what each builder draws). */
  color: ColorKey;
  idle: IdleKind;
  poke: PokeKind;
  use: UseKind;
}

export const PROP_SPECS: Record<PropType, PropSpec> = {
  lantern: { noun: "light", color: "blue", idle: "none", poke: "wiggle", use: "light" },
  lamp: { noun: "lamp", color: "yellow", idle: "none", poke: "wiggle", use: "light" },
  cottage: { noun: "house", color: "blue", idle: "none", poke: "squash", use: "light" },
  tree: { noun: "tree", color: "green", idle: "sway", poke: "shake", use: "fruit" },
  palm: { noun: "palm", color: "green", idle: "sway", poke: "shake", use: "coconuts" },
  pine: { noun: "pine", color: "green", idle: "sway", poke: "shake", use: "snow" },
  bushes: { noun: "bushes", color: "green", idle: "sway", poke: "shake", use: "berries" },
  cloud: { noun: "cloud", color: "white", idle: "bob", poke: "squash", use: "rain" },
  island: { noun: "island", color: "green", idle: "bob", poke: "hop", use: "none" },
  tire: { noun: "tire", color: "black", idle: "none", poke: "hop", use: "none" },
  drum: { noun: "drum", color: "pink", idle: "none", poke: "squash", use: "boom" },
  shed: { noun: "shed", color: "blue", idle: "none", poke: "shake", use: "none" },
  cranebg: { noun: "crane", color: "red", idle: "none", poke: "swing", use: "none" },
  windmill: { noun: "windmill", color: "blue", idle: "none", poke: "wiggle", use: "windmill" },
  umbrella: { noun: "umbrella", color: "red", idle: "sway", poke: "wiggle", use: "spin" },
  sandcastle: { noun: "sandcastle", color: "yellow", idle: "none", poke: "squash", use: "none" },
  snowman: { noun: "snowman", color: "white", idle: "none", poke: "wiggle", use: "hat" },
  igloo: { noun: "igloo", color: "white", idle: "none", poke: "squash", use: "none" },
  blocks: { noun: "blocks", color: "colorful", idle: "none", poke: "wiggle", use: "topple" },
  books: { noun: "books", color: "colorful", idle: "none", poke: "wiggle", use: "flutter" },
  chair: { noun: "chair", color: "orange", idle: "none", poke: "wiggle", use: "settle" },
  plant: { noun: "plant", color: "green", idle: "sway", poke: "squash", use: "sprout" },
  teddy: { noun: "teddy", color: "brown", idle: "none", poke: "squash", use: "squish" },
  ball: { noun: "ball", color: "red", idle: "none", poke: "hop", use: "roll" },
  cushions: { noun: "cushions", color: "colorful", idle: "none", poke: "squash", use: "squish" },
};

/** A prop type with no spec (something added later, or generated): it still reacts and is still named, in English. */
export const FALLBACK_SPEC: PropSpec = { noun: null, color: "gray", idle: "none", poke: "wiggle", use: "none" };

export function specFor(type: string): PropSpec {
  return (PROP_SPECS as Record<string, PropSpec | undefined>)[type] ?? FALLBACK_SPEC;
}

interface Off { dx: number; dy: number; dz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number }
const zeroOff = (): Off => ({ dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
interface ChildBase { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 }
interface Slot { local: THREE.Vector3; mesh: THREE.Mesh | null; regrowAt: number }

export interface PropInst {
  type: string;
  known: boolean;
  spec: PropSpec;
  holder: THREE.Group;
  /** Balls spin about their own centre, not the ground point. */
  pivot: THREE.Group | null;
  base: { px: number; py: number; pz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number };
  phase: number;
  size: THREE.Vector3;
  on: boolean;
  lightColor: string | null;
  lights: Array<{ l: THREE.Light; i: number }>;
  sprites: Array<{ s: THREE.Sprite; o: number; k: number }>;
  glows: Array<{ m: THREE.MeshStandardMaterial; i: number }>;
  kids: Map<THREE.Object3D, ChildBase>;
  slots: Slot[];
  dir: number;
  taps: number;
  /** Invisible tap target, bigger than the prop. */
  proxy: THREE.Mesh | null;
}

interface Anim { inst: PropInst; kind: string; t: number; d: number; step: (k: number, o: Off, amp: number) => void; end?: () => void }
interface Faller { mesh: THREE.Mesh; vx: number; vy: number; vz: number; ground: number; t: number; state: 0 | 1 | 2; bounced: boolean; rain: boolean }

export interface PropFxDeps {
  /** The world root: loose things (fruit, rain) live here so they do not sway with the prop they fell from. */
  root: () => THREE.Object3D;
  camera: () => THREE.Camera;
  canvas: HTMLElement;
  toast: (text: string) => void;
  boostWindmill: () => void;
  reduced: () => boolean;
  /** False when the kid has muted sound: no speech, no effects (the caption still shows). */
  canSpeak?: () => boolean;
}

/** World-space box around a prop's real meshes only: glow sprites (a lantern's is 4 units wide) and our own hit proxy do not count. */
function meshBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.noPick || o.userData.hitProxy) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  return box;
}

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOutBack = (k: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
/** Capitalise by the language's own rules (Turkish i -> İ, not I). */
const cap = (s: string, lang: LangCode) => s.charAt(0).toLocaleUpperCase(languageInfo(lang).bcp47) + s.slice(1);

type FruitKind = "apple" | "coconut" | "snow" | "berry" | "rain";
/** `glow`: a little emissive of its own colour so it still reads against dark foliage (kept under 0.3, the level the lamp-glow scan treats as a light). */
const FRUIT: Record<FruitKind, { r: number; color: string; rough: number; sy?: number; glow?: number }> = {
  // 0.24, up from 0.15 (2026-11-03): at 0.15 a hanging apple was about 9 px on a phone, dark red on a dark crown, and easy to miss.
  apple: { r: 0.24, color: "#e5392b", rough: 0.35, glow: 0.28 },
  coconut: { r: 0.17, color: "#6b4423", rough: 0.8 },
  snow: { r: 0.2, color: "#f4f8ff", rough: 0.7 },
  berry: { r: 0.09, color: "#d62d4a", rough: 0.4 },
  rain: { r: 0.045, color: "#7ec8ff", rough: 0.2, sy: 2.4 },
};

export function createPropFx(deps: PropFxDeps) {
  const insts: PropInst[] = [];
  const anims: Anim[] = [];
  const fallers: Faller[] = [];
  const kits = new Map<FruitKind, { geo: THREE.SphereGeometry; mat: THREE.Material }>();
  const MAX_FALLERS = 48;
  let lastSay = "";
  let lastSayAt = 0;
  let clock = 0;

  const amp = () => (deps.reduced() ? 0.4 : 1);
  const kit = (kind: FruitKind) => {
    let k = kits.get(kind);
    if (!k) {
      const f = FRUIT[kind];
      const mat = kind === "rain"
        ? new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.85 })
        : new THREE.MeshPhysicalMaterial({ color: f.color, roughness: f.rough, clearcoat: kind === "apple" ? 0.8 : 0.2, ...(f.glow ? { emissive: new THREE.Color(f.color), emissiveIntensity: f.glow } : {}) });
      k = { geo: new THREE.SphereGeometry(f.r, 14, 10), mat };
      kits.set(kind, k);
    }
    return k;
  };
  const makeFruit = (kind: FruitKind) => {
    const m = new THREE.Mesh(kit(kind).geo, kit(kind).mat);
    m.castShadow = kind !== "rain";
    if (FRUIT[kind].sy) m.scale.y = FRUIT[kind].sy!;
    m.userData.noPick = true;
    return m;
  };

  // ---- animation plumbing ----------------------------------------------------------------------------------------------
  function play(inst: PropInst, kind: string, d: number, step: Anim["step"], end?: () => void) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i]!;
      if (a.inst === inst && a.kind === kind) { anims.splice(i, 1); a.end?.(); } // restarting replaces, never stacks
    }
    anims.push({ inst, kind, t: 0, d, step, end });
  }
  const kidsOf = (inst: PropInst) => [...inst.kids.keys()];
  const restoreKid = (inst: PropInst, o: THREE.Object3D) => {
    const b = inst.kids.get(o);
    if (!b) return;
    o.position.copy(b.pos); o.rotation.copy(b.rot); o.scale.copy(b.scale);
  };
  const chirp = (inst: PropInst) => tone(360 + ((inst.phase * 37) % 220), 0, 0.07, "triangle", 0.05, 560 + ((inst.phase * 53) % 200));

  // ---- pokes (the immediate tap reaction) -------------------------------------------------------------------------------
  function poke(inst: PropInst) {
    const a = amp();
    chirp(inst);
    switch (inst.spec.poke) {
      case "wiggle": play(inst, "poke", 0.55, (k, o) => { o.rz += Math.sin(k * Math.PI * 5) * (1 - k) * 0.16 * a; }); break;
      case "shake": play(inst, "poke", 0.7, (k, o) => { const f = (1 - k) * a; o.rz += Math.sin(k * Math.PI * 9) * f * 0.09; o.rx += Math.cos(k * Math.PI * 7) * f * 0.05; }); break;
      case "hop": play(inst, "poke", 0.5, (k, o) => { o.dy += Math.sin(k * Math.PI) * 0.45 * a; }); break;
      case "squash": play(inst, "poke", 0.55, (k, o) => { const s = Math.sin(k * Math.PI * 2) * (1 - k) * 0.2 * a; o.sy *= 1 - s; o.sx *= 1 + s * 0.6; o.sz *= 1 + s * 0.6; }); break;
      case "swing": play(inst, "poke", 1.1, (k, o) => { o.rz += Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.12 * a; }); break;
    }
  }

  // ---- uses (the state change) ------------------------------------------------------------------------------------------
  function setLight(inst: PropInst, on: boolean) {
    // Remember how bright each part is RIGHT NOW when switching off: the world rescales and flickers light intensities after a prop
    // is registered, so the registration-time value would bring a lantern back dimmer than it was (the e2e caught 6.05 -> 2.6).
    if (!on && inst.on) {
      for (const l of inst.lights) l.i = l.l.intensity || l.i;
      for (const g of inst.glows) g.i = g.m.emissiveIntensity || g.i;
    }
    inst.on = on;
    for (const l of inst.lights) l.l.intensity = on ? l.i : 0;
    for (const s of inst.sprites) s.s.visible = on;
    for (const g of inst.glows) g.m.emissiveIntensity = on ? g.i : g.i * 0.06;
  }
  function useLight(inst: PropInst) {
    setLight(inst, !inst.on);
    if (inst.on) tone(660, 0, 0.09, "triangle", 0.08, 990);
    else tone(440, 0, 0.09, "triangle", 0.06, 220);
  }

  function spawnFaller(kind: FruitKind, world: THREE.Vector3, vx: number, vy: number, vz: number) {
    while (fallers.length >= MAX_FALLERS) { const old = fallers.shift()!; old.mesh.parent?.remove(old.mesh); }
    const mesh = makeFruit(kind);
    mesh.position.copy(world);
    deps.root().add(mesh);
    fallers.push({ mesh, vx, vy, vz, ground: FRUIT[kind].r * (FRUIT[kind].sy ?? 1), t: 0, state: 0, bounced: false, rain: kind === "rain" });
  }
  const worldOf = (inst: PropInst, local: THREE.Vector3) => inst.holder.localToWorld(local.clone());

  function useFruit(inst: PropInst) {
    let dropped = 0;
    for (const slot of inst.slots) {
      if (!slot.mesh || dropped >= 2) continue;
      const w = worldOf(inst, slot.local);
      slot.mesh.parent?.remove(slot.mesh);
      slot.mesh = null;
      slot.regrowAt = clock + 8 + Math.random() * 4;
      spawnFaller("apple", w, (Math.random() - 0.5) * 0.8, 0, 0.2 + Math.random() * 0.5);
      dropped++;
    }
  }
  function burst(inst: PropInst, kind: FruitKind, n: number, ySpot: number, spread: number, up: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + inst.phase;
      const local = new THREE.Vector3(Math.cos(a) * spread * (0.4 + Math.random() * 0.6), inst.size.y * ySpot, Math.sin(a) * spread * 0.5 + 0.2);
      spawnFaller(kind, worldOf(inst, local), Math.cos(a) * 0.5, up + Math.random() * 0.8, Math.sin(a) * 0.3 + 0.2);
    }
  }
  function useRain(inst: PropInst) {
    let acc = 0;
    const half = Math.max(0.6, Math.max(inst.size.x, inst.size.z) * 0.35);
    play(inst, "rain", 1.4, (k) => {
      acc += 0.9;
      while (acc >= 1) {
        acc -= 1;
        const local = new THREE.Vector3((Math.random() - 0.5) * 2 * half, 0.2, (Math.random() - 0.5) * half);
        const p = worldOf(inst, local);
        spawnFaller("rain", p, 0, -2 - Math.random(), 0);
      }
      void k;
    });
  }
  function useSprout(inst: PropInst) {
    const leaves = kidsOf(inst).filter((o) => (o as THREE.Mesh).geometry?.type === "SphereGeometry");
    play(inst, "use", 0.95, (k) => {
      const s = 0.25 + 0.75 * easeOutBack(clamp01(k));
      for (const o of leaves) {
        const b = inst.kids.get(o)!;
        o.scale.set(b.scale.x * s, b.scale.y * s, b.scale.z * s);
        o.position.y = b.pos.y * (0.55 + 0.45 * s);
      }
    }, () => leaves.forEach((o) => restoreKid(inst, o)));
  }
  function useTopple(inst: PropInst) {
    const top = kidsOf(inst).reduce<THREE.Object3D | null>((best, o) => (!best || o.position.y > best.position.y ? o : best), null);
    if (!top) return;
    const dir = (inst.dir *= -1);
    const b = inst.kids.get(top)!;
    play(inst, "use", 2.4, (k) => {
      const fall = k < 0.35 ? k / 0.35 : 1;
      const back = k > 0.75 ? (k - 0.75) / 0.25 : 0;
      const e = fall * (1 - back);
      top.position.set(b.pos.x + dir * 0.95 * e, b.pos.y - (b.pos.y - 0.45) * e + Math.sin(back * Math.PI) * 0.4, b.pos.z);
      top.rotation.set(b.rot.x, b.rot.y, b.rot.z - dir * 1.3 * e);
    }, () => restoreKid(inst, top));
    tone(160, 0.25, 0.14, "sine", 0.12, 80);
  }
  function useFlutter(inst: PropInst) {
    const ks = kidsOf(inst);
    play(inst, "use", 1.1, (k) => {
      ks.forEach((o, i) => {
        const b = inst.kids.get(o)!;
        o.rotation.z = b.rot.z + Math.sin(k * Math.PI * 6 + i * 0.9) * 0.09 * (1 - k) * amp();
        o.position.y = b.pos.y + Math.sin(k * Math.PI * 5 + i) * 0.05 * (1 - k) * amp();
      });
    }, () => ks.forEach((o) => restoreKid(inst, o)));
  }
  function useRoll(inst: PropInst) {
    const dir = (inst.dir *= -1);
    play(inst, "use", 1.7, (k, o) => {
      const dx = dir * 1.8 * Math.sin(k * Math.PI);
      o.dx += dx;
      if (inst.pivot) inst.pivot.rotation.z = -dir * (dx / 0.55);
    }, () => { if (inst.pivot) inst.pivot.rotation.z = 0; });
  }
  function useSettle(inst: PropInst) {
    play(inst, "use", 1.3, (k, o) => { const f = Math.pow(1 - k, 1.5) * amp(); o.rz += Math.sin(k * Math.PI * 6) * f * 0.2; o.rx += Math.sin(k * Math.PI * 5 + 1) * f * 0.1; });
  }
  function useSquish(inst: PropInst) {
    play(inst, "use", 0.8, (k, o) => { const s = Math.sin(k * Math.PI * 3) * (1 - k) * 0.3 * amp(); o.sy *= 1 - s; o.sx *= 1 + s * 0.5; o.sz *= 1 + s * 0.5; });
  }
  function useSpin(inst: PropInst) {
    play(inst, "use", 1.1, (k, o) => { o.ry += (1 - Math.pow(1 - k, 3)) * Math.PI * 2 * (deps.reduced() ? 0.5 : 1); });
  }
  function useBoom(inst: PropInst) {
    tone(95, 0, 0.35, "sine", 0.22, 55);
    play(inst, "use", 0.7, (k, o) => { const f = (1 - k) * amp(); o.dy += Math.abs(Math.sin(k * Math.PI * 3)) * 0.15 * f; o.rz += Math.sin(k * Math.PI * 8) * f * 0.07; });
  }
  function useHat(inst: PropInst) {
    const hat = kidsOf(inst).filter((o) => o.position.y > 2.25 && (o as THREE.Mesh).geometry?.type === "CylinderGeometry");
    if (!hat.length) return;
    play(inst, "use", 0.9, (k) => {
      for (const o of hat) {
        const b = inst.kids.get(o)!;
        o.position.y = b.pos.y + Math.sin(k * Math.PI) * 0.7 * amp();
        o.rotation.y = b.rot.y + k * Math.PI * 4;
      }
    }, () => hat.forEach((o) => restoreKid(inst, o)));
    sfx.pop();
  }

  function use(inst: PropInst) {
    switch (inst.spec.use) {
      case "light": useLight(inst); break;
      case "fruit": useFruit(inst); break;
      case "coconuts": burst(inst, "coconut", 2, 0.95, Math.max(0.5, inst.size.x * 0.25), 0.4); break;
      case "snow": burst(inst, "snow", 3, 0.55, Math.max(0.6, inst.size.x * 0.3), 0.2); break;
      case "berries": burst(inst, "berry", 4, 0.9, Math.max(0.5, inst.size.x * 0.3), 2.2); break;
      case "rain": useRain(inst); break;
      case "sprout": useSprout(inst); break;
      case "topple": useTopple(inst); break;
      case "flutter": useFlutter(inst); break;
      case "roll": useRoll(inst); break;
      case "settle": useSettle(inst); break;
      case "squish": useSquish(inst); break;
      case "spin": useSpin(inst); break;
      case "boom": useBoom(inst); break;
      case "windmill": deps.boostWindmill(); break;
      case "hat": useHat(inst); break;
      case "none": break;
    }
  }

  // ---- naming -----------------------------------------------------------------------------------------------------------
  function colorOf(inst: PropInst): ColorKey {
    return inst.type === "lantern" && inst.lightColor ? colorKeyFromHex(inst.lightColor) : inst.spec.color;
  }
  /** What a tap on this prop says, in the chosen language (null when the setting is Off). */
  function nameOf(inst: PropInst) {
    const lang = getPropLang();
    const color = colorOf(inst);
    return inst.spec.noun ? describeObject({ noun: inst.spec.noun, color }, lang) : describeObject({ label: inst.type, color }, lang);
  }
  function announce(inst: PropInst) {
    const d = nameOf(inst);
    if (!d) return;
    const now = performance.now();
    if (d.text === lastSay && now - lastSayAt < 900) return; // quick repeat taps do not stutter the same word
    lastSay = d.text; lastSayAt = now;
    deps.toast(cap(d.text, d.lang));
    if (deps.canSpeak ? deps.canSpeak() : sound) sayObject({ noun: inst.spec.noun ?? undefined, color: colorOf(inst), lang: d.lang, text: d.text });
  }

  /** The whole tap: react now, change state, then say the name. */
  function activate(inst: PropInst) {
    inst.taps++;
    poke(inst);
    use(inst);
    announce(inst);
  }

  // ---- registration -----------------------------------------------------------------------------------------------------
  function register(type: string, made: THREE.Object3D[], arg?: unknown): PropInst | null {
    const first = made[0];
    if (!first) return null;
    const spec = specFor(type);
    // Every builder returns ONE group whose children are the prop's parts (leaves, the top block, the hat...), and its position is
    // already the pivot at the prop's base. Use that group itself as the holder so those parts stay directly addressable. Only
    // when a builder adds several loose objects, or a bare mesh, wrap them in a holder pivoting at the first one.
    let holder: THREE.Group;
    if (made.length === 1 && (first as THREE.Group).isGroup) {
      holder = first as THREE.Group;
    } else {
      const parent = first.parent ?? deps.root();
      const anchor = first.position.clone();
      holder = new THREE.Group();
      holder.position.copy(anchor);
      parent.add(holder);
      for (const o of made) { o.position.sub(anchor); holder.add(o); }
    }

    let pivot: THREE.Group | null = null;
    if (type === "ball") {
      pivot = new THREE.Group();
      pivot.position.y = 0.55;
      for (const c of [...holder.children]) { c.position.y -= 0.55; pivot.add(c); }
      holder.add(pivot);
    }
    holder.updateMatrixWorld(true);
    const box = meshBox(holder);
    const size = box.getSize(new THREE.Vector3());
    const inst: PropInst = {
      type, known: type in PROP_SPECS, spec, holder, pivot,
      base: { px: holder.position.x, py: holder.position.y, pz: holder.position.z, rx: holder.rotation.x, ry: holder.rotation.y, rz: holder.rotation.z, sx: holder.scale.x, sy: holder.scale.y, sz: holder.scale.z },
      phase: Math.random() * Math.PI * 2, size, on: true,
      lightColor: type === "lantern" && typeof arg === "string" && /^#[0-9a-f]{6}$/i.test(arg) ? arg : null,
      lights: [], sprites: [], glows: [], kids: new Map(), slots: [], dir: 1, taps: 0, proxy: null,
    };
    for (const c of (pivot ?? holder).children) inst.kids.set(c, { pos: c.position.clone(), rot: c.rotation.clone(), scale: c.scale.clone() });

    // Taps hit an invisible box a little bigger than the prop, not its thin parts: a lantern pole or a lamp stem is a few pixels
    // wide, a tire is hollow, an umbrella is mostly pole. A child's fingertip needs the whole object to count.
    if (!box.isEmpty()) {
      const wsc = holder.getWorldScale(new THREE.Vector3());
      const dims = new THREE.Vector3(Math.max(size.x + 0.5, 1.4), size.y + 0.3, Math.max(size.z + 0.5, 1.4));
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(dims.x / wsc.x, dims.y / wsc.y, dims.z / wsc.z), new THREE.MeshBasicMaterial());
      proxy.visible = false;
      proxy.userData.hitProxy = true;
      proxy.position.copy(holder.worldToLocal(box.getCenter(new THREE.Vector3())));
      holder.add(proxy);
      inst.proxy = proxy;
    }

    if (spec.use === "light") {
      holder.traverse((o) => {
        const light = o as THREE.Light;
        if (light.isLight) inst.lights.push({ l: light, i: light.intensity });
        const sprite = o as THREE.Sprite;
        if (sprite.isSprite) inst.sprites.push({ s: sprite, o: sprite.material.opacity, k: sprite.scale.x });
        const mesh = o as THREE.Mesh;
        const mat = mesh.isMesh && !Array.isArray(mesh.material) ? (mesh.material as THREE.MeshStandardMaterial) : null;
        if (mat && mat.emissive && mat.emissive.getHex() !== 0 && mat.emissiveIntensity > 0.3) {
          const own = mat.clone(); // glow materials are cached and shared between props: switch THIS lamp off, not every lamp
          mesh.material = own;
          inst.glows.push({ m: own, i: own.emissiveIntensity });
        }
      });
    }
    if (type === "tree") hangApples(inst);

    holder.userData.propInst = inst;
    insts.push(inst);
    if (spec.noun && getPropLang() !== "off" && (deps.canSpeak ? deps.canSpeak() : sound)) {
      const lang = getPropLang();
      if (lang !== "off") prefetchObjectVoices([{ noun: spec.noun, color: colorOf(inst) }], lang);
    }
    return inst;
  }

  function appleAt(inst: PropInst, slot: Slot) {
    const m = makeFruit("apple");
    m.position.copy(slot.local);
    inst.holder.add(m);
    slot.mesh = m;
  }
  /**
   * Where each apple hangs: (azimuth from the front, elevation from the crown's centre), in degrees. All three face the camera, so none sits on the
   * silhouette edge, and all hang in the lower half of the crown: the toast bar that names a prop (and every "+1 scrap" line) covers the middle of the
   * crown on a phone, which hid two of the three when they hung higher (looked at in the real Garden, 2026-11-03). Lower is also where a kid can reach.
   */
  const APPLE_DIRS: ReadonlyArray<readonly [number, number]> = [[-38, -8], [12, -24], [50, -6]];

  /**
   * The point where a ray from the crown's centre leaves the real foliage, in the holder's own space, or null when nothing is hit. The crown is lumpy: a
   * point on a fitted ellipsoid is often INSIDE the leaves (that is where two of the three apples used to hang, which is why only one was ever visible).
   * Our own tap proxy and the fruit do not count as foliage.
   */
  function foliageSurface(holder: THREE.Group, centre: THREE.Vector3, dir: THREE.Vector3, reach: number): THREE.Vector3 | null {
    holder.updateWorldMatrix(true, true);
    const targets: THREE.Object3D[] = [];
    holder.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !o.userData.noPick && !o.userData.hitProxy) targets.push(o); });
    if (!targets.length) return null;
    const start = holder.localToWorld(centre.clone().addScaledVector(dir, reach));
    const middle = holder.localToWorld(centre.clone());
    const ray = new THREE.Raycaster(start, dir.clone().negate().transformDirection(holder.matrixWorld), 0, start.distanceTo(middle) * 1.05);
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? holder.worldToLocal(hit.point.clone()) : null;
  }
  function hangApples(inst: PropInst) {
    const W = Math.max(inst.size.x, inst.size.z), H = inst.size.y;
    const rx = W * 0.4, rz = W * 0.36, ry = H * 0.2;
    const centre = new THREE.Vector3(inst.proxy?.position.x ?? 0, H * 0.64, inst.proxy?.position.z ?? 0);
    APPLE_DIRS.forEach(([azi, el]) => {
      const phi = (azi * Math.PI) / 180, th = (el * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(th) * Math.sin(phi), Math.sin(th), Math.cos(th) * Math.cos(phi));
      const surface = foliageSurface(inst.holder, centre, dir, Math.max(W, H) * 2);
      // Resting on the foliage with about half of it outside, so it reads as hanging in front of the leaves. No hit (a crown the ray cannot see): the old fitted ellipsoid.
      const local = surface
        ? surface.addScaledVector(dir, FRUIT.apple.r * 0.5)
        : new THREE.Vector3(centre.x + rx * Math.cos(th) * Math.sin(phi) * 0.95, centre.y + ry * Math.sin(th), centre.z + rz * Math.cos(th) * Math.cos(phi) * 0.95);
      const slot: Slot = { local, mesh: null, regrowAt: 0 };
      appleAt(inst, slot);
      inst.slots.push(slot);
    });
  }
  function growApple(inst: PropInst, slot: Slot) {
    appleAt(inst, slot);
    const m = slot.mesh!;
    m.scale.setScalar(0.01);
    play(inst, `grow${inst.slots.indexOf(slot)}`, 0.6, (k) => { m.scale.setScalar(Math.max(0.01, easeOutBack(clamp01(k)))); }, () => m.scale.setScalar(1));
  }

  // ---- picking ----------------------------------------------------------------------------------------------------------
  function instOf(o: THREE.Object3D | null): PropInst | null {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.propInst) return p.userData.propInst as PropInst;
    return null;
  }
  /** Tap test on an already-aimed ray. Returns true (and reacts) when a prop was hit. */
  function tap(ray: THREE.Raycaster): boolean {
    if (!insts.length) return false;
    const hits = ray.intersectObjects(insts.map((i) => i.holder), true);
    for (const h of hits) {
      const o = h.object as THREE.Object3D & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
      if (o.isSprite || o.isPoints || o.isLine || o.userData.noPick) continue;
      const inst = instOf(o);
      if (inst) { activate(inst); return true; }
    }
    return false;
  }

  // ---- per-frame --------------------------------------------------------------------------------------------------------
  function update(dt: number, t: number) {
    clock = t;
    const a = amp();
    const offs = new Map<PropInst, Off>();
    for (const inst of insts) {
      const o = zeroOff();
      if (inst.spec.idle === "sway") o.rz += Math.sin(t * 0.9 + inst.phase) * 0.011 * a;
      else if (inst.spec.idle === "bob") o.dy += Math.sin(t * 0.7 + inst.phase) * 0.08 * a;
      if (inst.on) for (const s of inst.sprites) s.s.scale.setScalar(s.k * (1 + 0.05 * Math.sin(t * 2.6 + inst.phase)));
      offs.set(inst, o);
      for (const slot of inst.slots) if (!slot.mesh && slot.regrowAt > 0 && t >= slot.regrowAt) { slot.regrowAt = 0; growApple(inst, slot); }
    }
    for (let i = anims.length - 1; i >= 0; i--) {
      const an = anims[i]!;
      an.t += dt;
      const k = clamp01(an.t / an.d);
      const o = offs.get(an.inst);
      if (o) an.step(k, o, a);
      if (k >= 1) { anims.splice(i, 1); an.end?.(); }
    }
    for (const inst of insts) {
      const o = offs.get(inst)!, b = inst.base;
      inst.holder.position.set(b.px + o.dx, b.py + o.dy, b.pz + o.dz);
      inst.holder.rotation.set(b.rx + o.rx, b.ry + o.ry, b.rz + o.rz);
      inst.holder.scale.set(b.sx * o.sx, b.sy * o.sy, b.sz * o.sz);
    }
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i]!;
      f.t += dt;
      if (f.state === 0) {
        f.vy -= 9.8 * dt;
        f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt;
        if (f.mesh.position.y <= f.ground) {
          f.mesh.position.y = f.ground;
          if (f.rain) { f.state = 2; f.t = 0; }
          else if (!f.bounced) { f.bounced = true; f.vy = -f.vy * 0.35; f.vx *= 0.4; f.vz *= 0.4; tone(180, 0, 0.08, "sine", 0.09, 110); }
          else { f.state = 1; f.t = 0; f.vy = 0; }
        }
      } else if (f.state === 1) {
        if (f.t > 1.6) { f.state = 2; f.t = 0; }
      } else {
        const k = clamp01(f.t / (f.rain ? 0.12 : 0.35));
        f.mesh.scale.setScalar(Math.max(0.001, 1 - k));
        if (k >= 1) { f.mesh.parent?.remove(f.mesh); fallers.splice(i, 1); }
      }
    }
  }

  function reset() {
    for (const f of fallers) f.mesh.parent?.remove(f.mesh);
    fallers.length = 0; anims.length = 0; insts.length = 0; lastSay = "";
  }

  /** Where an instance is on screen, in client pixels (for tests and the dev bench). */
  function screenPos(inst: PropInst): { x: number; y: number; visible: boolean } {
    const v = inst.holder.localToWorld(new THREE.Vector3(0, inst.size.y * 0.5, 0)).project(deps.camera());
    const r = deps.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  }

  return {
    register, tap, update, reset, activate, screenPos, nameOf,
    list: () => insts.slice(),
    fallerCount: () => fallers.length,
    setLight,
  };
}

export type PropFx = ReturnType<typeof createPropFx>;
