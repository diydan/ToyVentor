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
import { colorKeyFromHex, describeObject, languageInfo, type ColorKey, type Described, type LangCode, type NounKey } from "../../../../lib/propNames";
import { getPropLang } from "../../../../lib/propSpeech";
import { BALL_BOUNDS, BALL_R, kick as startKick, stepBall, type BallState } from "./ballKick";

/** A rolling tire turns this much for every turn the ball model does for the same distance: the ball is 0.55 across its radius, the tire 0.72. */
const TIRE_SPIN = BALL_R / 0.72;
import { kindById, kindFits, kindNoun, slotDirs } from "./treeKinds";
import { prefetchObjectVoices, sayObject } from "../../../../lib/propVoice";
import { sfx, sound, tone } from "./audio";

export const PROP_TYPES = [
  "lantern", "windmill", "cottage", "tree", "bushes", "cloud", "island", "tire", "drum", "shed", "cranebg", "palm", "umbrella",
  "sandcastle", "pine", "snowman", "igloo", "lamp", "blocks", "books", "chair", "plant", "teddy", "ball", "cushions", "bed", "guitar", "bubbles", "dog", "xylophone",
  "cup", "toybox", "cleancart", "hob",
  // Things to play with outside (runtime/playthings.ts, outdoorProps.ts).
  "puffcloud", "angelpatch", "flowerbed", "bunny", "picnic", "swing", "pumpkins", "basket",
] as const;
export type PropType = (typeof PROP_TYPES)[number];

type IdleKind = "sway" | "bob" | "none";
type PokeKind = "wiggle" | "hop" | "squash" | "shake" | "swing" | "none";
export type UseKind =
  | "light" | "fruit" | "coconuts" | "snow" | "berries" | "rain" | "sprout" | "topple" | "flutter" | "roll" | "settle" | "squish"
  | "spin" | "boom" | "windmill" | "hat" | "sleep" | "pluck" | "pop" | "bark" | "chime" | "stack" | "none";

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
  cranebg: { noun: "crane", color: "red", idle: "none", poke: "swing", use: "stack" },
  windmill: { noun: "windmill", color: "blue", idle: "none", poke: "wiggle", use: "windmill" },
  umbrella: { noun: "umbrella", color: "red", idle: "sway", poke: "wiggle", use: "spin" },
  // The sandcastle and the snowman are built up a piece at a time by taps and come down on the last one (runtime/buildUp.ts), the way the block tower does: the prop animates itself, so no poke.
  sandcastle: { noun: "sandcastle", color: "yellow", idle: "none", poke: "none", use: "stack" },
  snowman: { noun: "snowman", color: "white", idle: "none", poke: "none", use: "stack" },
  igloo: { noun: "igloo", color: "white", idle: "none", poke: "squash", use: "none" },
  blocks: { noun: "blocks", color: "colorful", idle: "none", poke: "none", use: "stack" },
  books: { noun: "books", color: "colorful", idle: "none", poke: "wiggle", use: "flutter" },
  chair: { noun: "chair", color: "orange", idle: "none", poke: "wiggle", use: "settle" },
  plant: { noun: "plant", color: "green", idle: "sway", poke: "squash", use: "sprout" },
  teddy: { noun: "teddy", color: "brown", idle: "none", poke: "squash", use: "squish" },
  ball: { noun: "ball", color: "red", idle: "none", poke: "hop", use: "roll" },
  cushions: { noun: "cushions", color: "colorful", idle: "none", poke: "squash", use: "squish" },
  // The Toy Room bed (runtime/bed.ts): a tap puts the toy to sleep (runtime/sleepRoutine.ts); the world decides what that means through `deps.onBed`.
  bed: { noun: "bed", color: "colorful", idle: "none", poke: "squash", use: "sleep" },
  // Things Kip plays with (runtime/toyRoomActs.ts): a tap makes the prop's own little sound at once and sends Kip over.
  guitar: { noun: "guitar", color: "orange", idle: "none", poke: "wiggle", use: "pluck" },
  bubbles: { noun: "bubbles", color: "blue", idle: "none", poke: "wiggle", use: "pop" },
  dog: { noun: "dog", color: "brown", idle: "none", poke: "hop", use: "bark" },
  xylophone: { noun: "xylophone", color: "colorful", idle: "none", poke: "wiggle", use: "chime" },
  // The Toy Room's mess mini-interactions (runtime/mess.ts): a tap names the prop and sends Kip over to knock the cup over / tip the toy box out. The prop itself does not move on a poke (the mess does).
  cup: { noun: "cup", color: "orange", idle: "none", poke: "none", use: "none" },
  toybox: { noun: "toybox", color: "blue", idle: "none", poke: "none", use: "none" },
  // The cleaning level's door in the Toy Room (runtime/clean.ts): a tap names the cart and sends Kip over; the prop itself stays put.
  cleancart: { noun: "cleancart", color: "blue", idle: "none", poke: "none", use: "none" },
  // The cooking level's door in the Toy Room (runtime/cook.ts): a little counter with a hob and a pan.
  hob: { noun: "hob", color: "blue", idle: "none", poke: "none", use: "none" },
  // The outside things (runtime/playthings.ts): a tap names the prop and sends Kip over to bounce on the cloud, make the angel, water the flowers, feed the bunny, eat the picnic, ride the swing.
  puffcloud: { noun: "cloud", color: "white", idle: "none", poke: "squash", use: "squish" },
  angelpatch: { noun: "snowangel", color: "white", idle: "none", poke: "squash", use: "none" },
  flowerbed: { noun: "flowers", color: "colorful", idle: "none", poke: "wiggle", use: "none" },
  bunny: { noun: "bunny", color: "white", idle: "none", poke: "hop", use: "none" },
  picnic: { noun: "picnic", color: "red", idle: "none", poke: "squash", use: "none" },
  swing: { noun: "swing", color: "pink", idle: "none", poke: "none", use: "none" },
  // The pumpkin patch: pumpkins sit on the ground in it; a tap shakes them loose and they roll (use "berries" drops the fruit slots like a bush).
  pumpkins: { noun: "pumpkin", color: "orange", idle: "none", poke: "squash", use: "berries" },
  // The fruit basket (runtime/basket.ts): drag a fruit onto it and let go, and it counts them.
  basket: { noun: "basket", color: "brown", idle: "none", poke: "squash", use: "none" },
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
  /** What it is called when tapped: its spec's noun, or for a tree, palm or bush of a kind (treeKinds.ts) the kind's own ("pear tree"). */
  noun: NounKey | null;
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
  /** Extra height (world units) the prop is held up at, over everything else: a ball in the dog's mouth. Set with `placeProp`. */
  lift: number;
  /** A ball that has been kicked and is still moving: where it is along the floor and how high; null when it is at rest. */
  kick: BallState | null;
  /** The fruit this prop grows and drops (a tree's `userData.treeKind` says which; apples otherwise) and how many hang at once. */
  fruit: FruitKind;
  fruitSlots: number;
  dir: number;
  taps: number;
  /** Invisible tap target, bigger than the prop. */
  proxy: THREE.Mesh | null;
}

interface Anim { inst: PropInst; kind: string; t: number; d: number; step: (k: number, o: Off, amp: number) => void; end?: () => void }
/**
 * Loose fruit. `state`: 0 falling or hopping, 1 resting on the ground (tidied after `rest` seconds), 2 shrinking away, 3 CARRIED (a finger owns it: no physics, no tidying),
 * 4 being EATEN (flying into a toy's mouth along `from` to `to` over `secs`, then gone).
 */
interface Faller { mesh: THREE.Mesh; vx: number; vy: number; vz: number; ground: number; t: number; state: 0 | 1 | 2 | 3 | 4; bounced: boolean; rain: boolean; kind: FruitKind; rest: number; from?: THREE.Vector3; to?: THREE.Vector3; secs?: number }

/** A fruit a finger has landed on: the mesh (a hanging fruit's mesh changes when it is lifted, so the holder keeps this object, not the mesh) and what it is. */
export interface FruitRef { mesh: THREE.Object3D; kind: FruitKind }
/** How much bigger a carried fruit is drawn, so it reads under a finger. */
export const CARRY_SCALE = 1.25;

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
  /** A bed was tapped: the world sends the toy to it (`inst.holder.position` is where the bed stands). */
  onBed?: (inst: PropInst) => void;
  /** Any prop was tapped (after it has reacted and named itself): the world may send the toy over to hug the teddy, jump on the cushions or kick the ball. */
  onTap?: (inst: PropInst) => void;
  /** A build-up prop took a tap (blocks, sandcastle, snowman, the crane): what happened. The world lets Kip react (cheer at a tall tower, startle at a crash). */
  onStack?: (inst: PropInst, result: { kind: "added"; layers?: number; sfx?: string } | { kind: "crash"; sfx?: string } | { kind: "busy" }) => void;
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

export type FruitKind =
  | "apple" | "greenapple" | "pear" | "orange" | "lemon" | "cherry" | "banana" | "plum" | "strawberry" | "blueberry" | "coconut" | "pumpkin"
  | "snow" | "berry" | "rain";
/**
 * `r` is the radius, `color` the material colour, `sy` a vertical stretch (a pear is tall, a pumpkin squat). `noun` and `say` are what a tap on it says
 * ("red apple"): a fruit with a `noun` is tappable; snow and rain have none and stay untouchable decoration. `glow`: a little emissive of its own colour so it
 * still reads against dark foliage (kept under 0.3, the level the lamp-glow scan treats as a light). Adding a fruit is one row here plus a noun in propNames.ts.
 */
export const FRUIT: Record<FruitKind, { r: number; color: string; rough: number; sy?: number; glow?: number; noun?: NounKey; say?: ColorKey }> = {
  // 0.24, up from 0.15 (2026-11-03): at 0.15 a hanging apple was about 9 px on a phone, dark red on a dark crown, and easy to miss.
  apple: { r: 0.24, color: "#e5392b", rough: 0.35, glow: 0.28, noun: "apple", say: "red" },
  greenapple: { r: 0.24, color: "#86d12f", rough: 0.35, glow: 0.2, noun: "apple", say: "green" },     // a colour variant of the apple: the same fruit, named for its colour
  pear: { r: 0.21, color: "#a8c23a", rough: 0.5, sy: 1.3, glow: 0.2, noun: "pear", say: "green" },
  orange: { r: 0.24, color: "#ff9a1f", rough: 0.6, glow: 0.2, noun: "orange" },   // no `say`: named for its colour, so it says "orange", never "orange orange"
  lemon: { r: 0.19, color: "#ffe23f", rough: 0.5, sy: 1.15, glow: 0.2, noun: "lemon", say: "yellow" },
  cherry: { r: 0.19, color: "#c4102f", rough: 0.3, glow: 0.2, noun: "cherries", say: "red" },
  banana: { r: 0.15, color: "#ffd83a", rough: 0.55, sy: 2.0, glow: 0.2, noun: "banana", say: "yellow" },
  plum: { r: 0.2, color: "#7a3b8f", rough: 0.35, glow: 0.2, noun: "plum", say: "purple" },
  strawberry: { r: 0.15, color: "#e8283c", rough: 0.45, sy: 1.15, glow: 0.2, noun: "strawberry", say: "red" },
  blueberry: { r: 0.11, color: "#3d5ad6", rough: 0.4, glow: 0.2, noun: "blueberries", say: "blue" },
  coconut: { r: 0.22, color: "#6b4423", rough: 0.8, noun: "coconut", say: "brown" },
  pumpkin: { r: 0.34, color: "#ff8a1f", rough: 0.6, sy: 0.8, glow: 0.2, noun: "pumpkin", say: "orange" },
  snow: { r: 0.2, color: "#f4f8ff", rough: 0.7 },
  berry: { r: 0.09, color: "#d62d4a", rough: 0.4, noun: "strawberry", say: "red" },
  rain: { r: 0.045, color: "#7ec8ff", rough: 0.2, sy: 2.4 },
};
/** How long a fallen fruit rests before it is tidied away: long enough to tap it, hear it and (next) feed it to a toy. It was 1.6 s, which was gone before a finger got there. */
export const FRUIT_REST_SECONDS = 12;
/** Size a fruit mesh at `k` times normal, keeping its own stretch (a pear is tall, a pumpkin squat): `setScalar` would flatten that. */
function setFruitScale(mesh: THREE.Object3D, kind: FruitKind, k: number) { mesh.scale.set(k, k * (FRUIT[kind].sy ?? 1), k); }

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
        : new THREE.MeshPhysicalMaterial({ color: f.color, roughness: f.rough, clearcoat: kind === "apple" || kind === "greenapple" ? 0.8 : 0.2, ...(f.glow ? { emissive: new THREE.Color(f.color), emissiveIntensity: f.glow } : {}) });
      k = { geo: new THREE.SphereGeometry(f.r, 14, 10), mat };
      kits.set(kind, k);
    }
    return k;
  };
  const makeFruit = (kind: FruitKind) => {
    const m = new THREE.Mesh(kit(kind).geo, kit(kind).mat);
    m.castShadow = kind !== "rain";
    if (FRUIT[kind].sy) m.scale.y = FRUIT[kind].sy!;
    if (FRUIT[kind].noun) m.userData.fruitKind = kind;   // tappable: says its name
    else m.userData.noPick = true;                       // snow and rain are decoration
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
  /** A xylophone note: a bell-like sine with a bright overtone, `delay` seconds from now. */
  function ring(freq: number, delay = 0) { tone(freq, delay, 0.5, "sine", 0.1); tone(freq * 3, delay, 0.12, "triangle", 0.03); }
  /**
   * Ring bar `i` of a prop that has bars (the xylophone: `holder.userData.strikeBar`), with its note. Returns the pitch, or null if the prop has no such bar.
   */
  function strike(inst: PropInst, i: number): number | null {
    const f = (inst.holder.userData.strikeBar as ((i: number) => number | null) | undefined)?.(i);
    if (f === null || f === undefined) return null;
    ring(f);
    return f;
  }
  /**
   * Tell a prop that animates itself (the dog: `holder.userData.tick`) that something happened. It reads `holder.userData.cue` ({ name, at }: the name and the clock when it was cued)
   * in its own tick, so what it does with it (a bark, a wag) lives with its builder, not here.
   */
  function cue(inst: PropInst, name: string) { inst.holder.userData.cue = { name, at: clock }; }
  /** The `n` named props nearest to x (not the ones whose type is in `exclude`), for Kip to read the names of. */
  function nearby(x: number, n: number, exclude: ReadonlyArray<string> = []): PropInst[] {
    return insts.filter((i) => i.spec.noun && !exclude.includes(i.type)).sort((a, b) => Math.abs(a.base.px - x) - Math.abs(b.base.px - x)).slice(0, Math.max(0, n));
  }
  /**
   * Move a prop along the floor (the dog running, the ball in its mouth): its place is `x` from now on, optionally turned to `ry` (the dog faces -x at pi and +x at 0) and held `lift` units off the ground.
   * What it was doing is left alone (a roll or a wag carries on from the new place).
   */
  function placeProp(inst: PropInst, x: number, opts: { ry?: number; lift?: number } = {}) {
    inst.base.px = x;
    if (opts.ry !== undefined) inst.base.ry = opts.ry;
    if (opts.lift !== undefined) inst.lift = opts.lift;
  }
  /** The prop gets a squish and nothing else (no name, no sound beyond its own chirp): the teddy being hugged, the cushions being landed on. */
  function squish(inst: PropInst) { useSquish(inst); }
  /**
   * Kick a ball: it flies off along the floor with the given speed and lift, bounces and rolls to a stop (ballKick.ts), staying wherever it ends up. Cancels a roll in place; ignored for a prop
   * that is not a ball. Returns false if it could not be kicked.
   */
  function kickBall(inst: PropInst, vx: number, vy: number): boolean {
    if (inst.type !== "ball" && inst.type !== "tire") return false;                       // (a tire is pushed and rolls like a ball, only farther round)
    for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]!; if (a.inst === inst && a.kind === "use") { anims.splice(i, 1); a.end?.(); } }
    inst.kick = startKick(inst.base.px, vx, vy);
    tone(180, 0, 0.09, "sine", 0.1, 110);
    return true;
  }
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
  /** Every light prop (the lanterns) on or off at once: lit at night, dark by day (worldLook.ts). Call it once the world is final: a prop's brightness is read at the moment it is switched off. */
  function setLights(on: boolean) { for (const inst of insts) if (inst.spec.use === "light" && inst.on !== on) setLight(inst, on); }
  function useLight(inst: PropInst) {
    setLight(inst, !inst.on);
    if (inst.on) tone(660, 0, 0.09, "triangle", 0.08, 990);
    else tone(440, 0, 0.09, "triangle", 0.06, 220);
  }

  function spawnFaller(kind: FruitKind, world: THREE.Vector3, vx: number, vy: number, vz: number): Faller {
    // Make room by dropping the oldest loose fruit, but never one a finger is carrying or a toy is eating.
    while (fallers.length >= MAX_FALLERS) {
      const i = fallers.findIndex((f) => f.state < 3);
      if (i < 0) break;
      const old = fallers.splice(i, 1)[0]!;
      old.mesh.parent?.remove(old.mesh);
    }
    const mesh = makeFruit(kind);
    mesh.position.copy(world);
    deps.root().add(mesh);
    const f: Faller = { mesh, vx, vy, vz, ground: FRUIT[kind].r * (FRUIT[kind].sy ?? 1), t: 0, state: 0, bounced: false, rain: kind === "rain", kind, rest: FRUIT[kind].noun ? FRUIT_REST_SECONDS : 1.6 };
    fallers.push(f);
    return f;
  }
  const worldOf = (inst: PropInst, local: THREE.Vector3) => inst.holder.localToWorld(local.clone());

  /** One hanging fruit comes loose: it leaves its slot, falls from where it hung, and the slot regrows in about 10 s. */
  function dropSlot(inst: PropInst, slot: Slot, kind: FruitKind) {
    if (!slot.mesh) return;
    const w = worldOf(inst, slot.local);
    slot.mesh.parent?.remove(slot.mesh);
    slot.mesh = null;
    slot.regrowAt = clock + 8 + Math.random() * 4;
    spawnFaller(kind, w, (Math.random() - 0.5) * 0.8, 0, 0.2 + Math.random() * 0.5);
  }
  function useFruit(inst: PropInst) {
    let dropped = 0;
    for (const slot of inst.slots) {
      if (!slot.mesh || dropped >= 2) continue;
      dropSlot(inst, slot, inst.fruit);
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
  // ---- bedtime: the room's lamps go out while the toy sleeps and come back exactly as they were (docs/specs/playful-interactions-spec.md section 6) ----
  let lampsOut: PropInst[] | null = null;
  /** `true`: every light that is on goes out (and is remembered). `false`: those lights come back on. A lamp the kid had switched off stays off. Idempotent. */
  function lightsOut(out: boolean) {
    if (out) {
      if (lampsOut) return;
      lampsOut = insts.filter((i) => i.on && i.lights.length > 0);
      for (const i of lampsOut) setLight(i, false);
    } else if (lampsOut) {
      const back = lampsOut;
      lampsOut = null;
      for (const i of back) setLight(i, true);
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
  /**
   * Blocks: a tap adds a block to the tower (`holder.userData.stack`, blockTower.ts: it falls, thuds, the tower wobbles, the notes climb a scale) and, on a full tower, brings it all down.
   * A blocks prop built some other way, with no tower, topples its top block instead.
   */
  function useStack(inst: PropInst) {
    const stack = inst.holder.userData.stack as (() => { kind: "added"; note: number; landsIn: number; sfx?: string } | { kind: "crash"; sfx?: string } | { kind: "busy" }) | undefined;
    if (!stack) { useTopple(inst); return; }
    const r = stack();
    deps.onStack?.(inst, r);
    if (r.kind === "added") {
      if (r.sfx === "clank") {                                                               // the crane's crate hitting the ground: a metal clank and a wooden bounce
        tone(140, r.landsIn, 0.12, "square", 0.09, 70);
        tone(880, r.landsIn, 0.3, "triangle", 0.07, 700);
        tone(110, r.landsIn + 0.32, 0.1, "square", 0.05, 70);
      } else if (r.sfx === "soft") {                                                         // sand or snow: a soft pat instead of a wooden thud
        tone(120, r.landsIn, 0.09, "sine", 0.07, 70);
        tone(r.note, r.landsIn, 0.32, "triangle", 0.1);
        tone(r.note * 1.5, r.landsIn + 0.05, 0.16, "sine", 0.04);
      } else {
        tone(150, r.landsIn, 0.07, "square", 0.05, 100);                                     // the thud
        tone(r.note, r.landsIn, 0.3, "triangle", 0.12);
        tone(r.note * 2, r.landsIn, 0.1, "sine", 0.04);
      }
    } else if (r.kind === "crash") {
      if (r.sfx === "crumble") {                                                             // sand sliding down
        for (let i = 0; i < 9; i++) tone(210 - i * 14, 0.02 + i * 0.07, 0.12, "sawtooth", 0.035, 70);
        tone(90, 0.05, 0.5, "sine", 0.07, 45);
      } else if (r.sfx === "poof") {                                                         // a soft puff and a falling giggle
        tone(300, 0, 0.35, "sine", 0.08, 90);
        tone(660, 0.05, 0.18, "triangle", 0.05, 330);
        tone(520, 0.2, 0.18, "triangle", 0.04, 260);
      } else {
        for (let i = 0; i < 7; i++) tone(95 + (i % 3) * 22, 0.1 + i * 0.11, 0.16, "sawtooth", 0.08, 45);        // blocks clattering down
        tone(70, 0.05, 0.5, "square", 0.06, 35);
      }
    }
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
    if (inst.kick) return;                                   // a ball already flying or rolling from a kick is not also rolled in place
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
      case "coconuts": if (inst.slots.length) useFruit(inst); else burst(inst, "coconut", 2, 0.95, Math.max(0.5, inst.size.x * 0.25), 0.4); break;
      case "snow": burst(inst, "snow", 3, 0.55, Math.max(0.6, inst.size.x * 0.3), 0.2); break;
      case "berries": if (inst.slots.length) useFruit(inst); else burst(inst, "berry", 4, 0.9, Math.max(0.5, inst.size.x * 0.3), 2.2); break;
      case "rain": useRain(inst); break;
      case "sprout": useSprout(inst); break;
      case "topple": useTopple(inst); break;
      case "stack": useStack(inst); break;
      case "flutter": useFlutter(inst); break;
      case "roll": useRoll(inst); break;
      case "settle": useSettle(inst); break;
      case "squish": useSquish(inst); break;
      case "spin": useSpin(inst); break;
      case "boom": useBoom(inst); break;
      case "windmill": deps.boostWindmill(); break;
      case "hat": useHat(inst); break;
      case "sleep": deps.onBed?.(inst); break;
      case "pluck": [262, 330, 392].forEach((f, i) => tone(f, i * 0.07, 0.35, "triangle", 0.09)); break;
      case "pop": tone(820, 0, 0.07, "sine", 0.08, 300); break;
      case "chime": [262, 330, 392, 523].forEach((f, i) => ring(f, i * 0.09)); break;
      case "bark": tone(300, 0, 0.09, "sawtooth", 0.08, 180); tone(260, 0.17, 0.1, "sawtooth", 0.08, 160); cue(inst, "bark"); break;
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
    return inst.noun ? describeObject({ noun: inst.noun, color }, lang) : describeObject({ label: inst.type, color }, lang);
  }
  /** Show a name as the toast and say it (the Gemini clip, the device voice, or just the caption). */
  function speakName(d: Described, noun: NounKey | undefined, color: ColorKey | undefined) {
    const now = performance.now();
    if (d.text === lastSay && now - lastSayAt < 900) return; // quick repeat taps do not stutter the same word
    lastSay = d.text; lastSayAt = now;
    deps.toast(cap(d.text, d.lang));
    if (deps.canSpeak ? deps.canSpeak() : sound) sayObject({ noun, color, lang: d.lang, text: d.text });
  }
  function announce(inst: PropInst) {
    const d = nameOf(inst);
    if (d) speakName(d, inst.noun ?? undefined, colorOf(inst));
  }
  const fruitKindOf = (o: THREE.Object3D): FruitKind | null => (o.userData.fruitKind as FruitKind | undefined) ?? null;
  /**
   * A tap on a fruit, hanging or fallen: it says its name ("red apple") and reacts. A hanging one is plucked (it drops and the slot regrows); a fallen one hops.
   * Feeding a fruit to a toy is the next step (a drag onto the character, docs/specs/playful-interactions-spec.md section 4).
   */
  function tapFruit(mesh: THREE.Object3D, kind: FruitKind) {
    const f = FRUIT[kind];
    const d = f.noun ? describeObject({ noun: f.noun, color: f.say }, getPropLang()) : null;
    if (d && f.noun) speakName(d, f.noun, f.say);
    tone(520, 0, 0.07, "triangle", 0.07, 780);
    const fall = fallers.find((x) => x.mesh === mesh);
    if (fall) {                       // a fallen fruit hops, and gets a fresh rest so it is not tidied away mid-hop
      setFruitScale(fall.mesh, fall.kind, 1);
      fall.state = 0; fall.t = 0; fall.vy = 2.2 * amp() + 0.4; fall.bounced = true; fall.vx = 0; fall.vz = 0;
      return;
    }
    const inst = instOf(mesh);
    const slot = inst?.slots.find((sl) => sl.mesh === mesh);
    if (inst && slot) dropSlot(inst, slot, kind);
  }

  // ---- drag to feed (docs/specs/playful-interactions-spec.md section 4) -----------------------------------------------------
  /** The fruit under a ray, hanging or fallen, WITHOUT acting on it: a press may turn out to be a tap or a carry. A fruit already carried or being eaten is not pickable. */
  function pickFruit(ray: THREE.Raycaster): FruitRef | null {
    if (!insts.length && !fallers.length) return null;
    const hits = ray.intersectObjects([...insts.map((i) => i.holder), ...fallers.filter((f) => f.state < 3).map((f) => f.mesh)], true);
    for (const h of hits) {
      const k = fruitKindOf(h.object);
      if (k && h.object.visible) return { mesh: h.object, kind: k };
    }
    return null;
  }
  const fallerOf = (ref: FruitRef) => fallers.find((f) => f.mesh === ref.mesh);
  /**
   * The carry begins: take the fruit out of the physics. A fallen fruit is simply held; a hanging one is plucked first (the slot regrows like any picked apple) and `ref.mesh`
   * becomes the new loose mesh. Returns false if the fruit is no longer there (a world change since the press).
   */
  function liftFruit(ref: FruitRef): boolean {
    let f = fallerOf(ref);
    if (!f) {
      const inst = instOf(ref.mesh);
      const slot = inst?.slots.find((sl) => sl.mesh === ref.mesh);
      if (!inst || !insts.includes(inst) || !slot) return false;      // a prop from a world that has since been reset is not ours any more
      const w = worldOf(inst, slot.local);
      slot.mesh!.parent?.remove(slot.mesh!);
      slot.mesh = null;
      slot.regrowAt = clock + 8 + Math.random() * 4;
      f = spawnFaller(ref.kind, w, 0, 0, 0);
      ref.mesh = f.mesh;
    }
    f.state = 3; f.t = 0; f.vx = f.vy = f.vz = 0;
    setFruitScale(f.mesh, f.kind, CARRY_SCALE);
    tone(440, 0, 0.05, "triangle", 0.05, 600);
    return true;
  }
  /** Where a fallen fruit lies, in world x, if it is loose on the ground (falling, hopping or resting: not carried, not being eaten and not on a tree); null otherwise. */
  function looseFruitX(ref: FruitRef): number | null {
    const f = fallerOf(ref);
    return f && f.state < 2 ? f.mesh.position.x : null;
  }
  /** The basket (a prop that takes fruit, runtime/basket.ts) under a ray, or null. */
  function basketAt(ray: THREE.Raycaster): PropInst | null {
    const targets = insts.filter((i) => typeof i.holder.userData.stash === "function").map((i) => i.holder);
    if (!targets.length) return null;
    const hit = ray.intersectObjects(targets, true).find((h) => !h.object.userData.noPick);
    return hit ? instOf(hit.object) : null;
  }
  /** A carried fruit is let go over a basket: it drops in and is counted. False when it was not being carried or the basket will not take it (full): the caller then lets it fall as usual. */
  function stashFruit(ref: FruitRef, basket: PropInst): boolean {
    const f = fallerOf(ref);
    const stash = basket.holder.userData.stash as ((mesh: THREE.Object3D, kind: string) => boolean) | undefined;
    if (!f || f.state !== 3 || !stash) return false;
    if (!stash(f.mesh, f.kind)) return false;
    fallers.splice(fallers.indexOf(f), 1);
    const n = basket.holder.userData.lastNote as number | undefined;
    if (n) { tone(n, 0, 0.35, "triangle", 0.1); tone(n * 2, 0.02, 0.12, "sine", 0.03); }
    play(basket, "use", 0.4, (k, o) => { o.dy -= Math.sin(k * Math.PI) * 0.05 * amp(); });
    return true;
  }
  /** Show a carried fruit at this world position. */
  function carryFruit(ref: FruitRef, at: THREE.Vector3) {
    const f = fallerOf(ref);
    if (f && f.state === 3) f.mesh.position.copy(at);
  }
  /** Let a carried fruit go from where it is: it falls, bounces once and rests like any other loose fruit. */
  function dropFruit(ref: FruitRef) {
    const f = fallerOf(ref);
    if (!f || f.state !== 3) return;
    setFruitScale(f.mesh, f.kind, 1);
    f.state = 0; f.t = 0; f.vx = f.vy = f.vz = 0; f.bounced = false; f.rest = FRUIT_REST_SECONDS;
  }
  /** A toy takes the carried fruit: it flies to `to` (the mouth), shrinking, and is gone. Returns false if it was not being carried. */
  function eatFruit(ref: FruitRef, to: THREE.Vector3, secs = 0.35): boolean {
    const f = fallerOf(ref);
    if (!f || f.state !== 3) return false;
    f.state = 4; f.t = 0; f.from = f.mesh.position.clone(); f.to = to.clone(); f.secs = Math.max(0.05, secs);
    return true;
  }

  /** The whole tap: react now, change state, then say the name. */
  function activate(inst: PropInst) {
    inst.taps++;
    poke(inst);
    use(inst);
    announce(inst);
    deps.onTap?.(inst);
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
    if (type === "ball" || type === "tire") {                                              // both turn about their own centre: the ball's is 0.55 up, the tire's holder already sits at its centre
      const rise = type === "ball" ? 0.55 : 0;
      pivot = new THREE.Group();
      pivot.position.y = rise;
      for (const c of [...holder.children]) { c.position.y -= rise; pivot.add(c); }
      holder.add(pivot);
    }
    holder.updateMatrixWorld(true);
    const box = meshBox(holder);
    const size = box.getSize(new THREE.Vector3());
    const inst: PropInst = {
      type, known: type in PROP_SPECS, spec, noun: spec.noun, holder, pivot,
      base: { px: holder.position.x, py: holder.position.y, pz: holder.position.z, rx: holder.rotation.x, ry: holder.rotation.y, rz: holder.rotation.z, sx: holder.scale.x, sy: holder.scale.y, sz: holder.scale.z },
      phase: Math.random() * Math.PI * 2, size, on: true,
      lightColor: type === "lantern" && typeof arg === "string" && /^#[0-9a-f]{6}$/i.test(arg) ? arg : null,
      lights: [], sprites: [], glows: [], kids: new Map(), slots: [], kick: null, lift: 0, fruit: "apple", fruitSlots: 3, dir: 1, taps: 0, proxy: null,
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
    if (type === "tree" || type === "palm" || type === "bushes" || type === "pumpkins") {
      // A tree, palm or bush built as a kind (treeKinds.ts) grows ITS fruit. A kind that does not fit the prop (a pear on a bush) is ignored; a plain tree grows apples as it always did.
      const tk = kindById(String(holder.userData.treeKind ?? ""));
      if (tk && kindFits(type, tk)) { inst.fruit = tk.fruit; inst.fruitSlots = tk.slots; inst.noun = kindNoun(tk) ?? inst.noun; hangFruit(inst); }
      else if (type === "tree") hangFruit(inst);
    }

    holder.userData.propInst = inst;
    insts.push(inst);
    if (inst.noun && getPropLang() !== "off" && (deps.canSpeak ? deps.canSpeak() : sound)) {
      const lang = getPropLang();
      if (lang !== "off") prefetchObjectVoices([{ noun: inst.noun, color: colorOf(inst) }], lang);
    }
    return inst;
  }

  function fruitAt(inst: PropInst, slot: Slot) {
    const m = makeFruit(inst.fruit);
    m.position.copy(slot.local);
    inst.holder.add(m);
    slot.mesh = m;
  }
  /**
   * Where each apple hangs: (azimuth from the front, elevation from the crown's centre), in degrees. All three face the camera, so none sits on the
   * silhouette edge, and all hang in the lower half of the crown: the toast bar that names a prop (and every "+1 scrap" line) covers the middle of the
   * crown on a phone, which hid two of the three when they hung higher (looked at in the real Garden, 2026-11-03). Lower is also where a kid can reach.
   */

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
  function hangFruit(inst: PropInst) {
    // A builder that knows exactly where its fruit hang (a palm: under the fronds) says so, as local positions in the holder; otherwise the fruit sits on the foliage surface.
    const fixed = inst.holder.userData.fruitSlots as ReadonlyArray<readonly [number, number, number]> | undefined;
    if (Array.isArray(fixed) && fixed.length) {
      for (const p of fixed.slice(0, inst.fruitSlots)) {
        const slot: Slot = { local: new THREE.Vector3(p[0], p[1], p[2]), mesh: null, regrowAt: 0 };
        fruitAt(inst, slot);
        inst.slots.push(slot);
      }
      return;
    }
    const W = Math.max(inst.size.x, inst.size.z), H = inst.size.y;
    const rx = W * 0.4, rz = W * 0.36, ry = H * 0.2;
    const centre = new THREE.Vector3(inst.proxy?.position.x ?? 0, H * 0.64, inst.proxy?.position.z ?? 0);
    slotDirs(inst.fruitSlots).forEach(([azi, el]) => {
      const phi = (azi * Math.PI) / 180, th = (el * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(th) * Math.sin(phi), Math.sin(th), Math.cos(th) * Math.cos(phi));
      const surface = foliageSurface(inst.holder, centre, dir, Math.max(W, H) * 2);
      // Resting on the foliage with about half of it outside, so it reads as hanging in front of the leaves. No hit (a crown the ray cannot see): the old fitted ellipsoid.
      const local = surface
        ? surface.addScaledVector(dir, FRUIT[inst.fruit].r * 0.5)
        : new THREE.Vector3(centre.x + rx * Math.cos(th) * Math.sin(phi) * 0.95, centre.y + ry * Math.sin(th), centre.z + rz * Math.cos(th) * Math.cos(phi) * 0.95);
      const slot: Slot = { local, mesh: null, regrowAt: 0 };
      fruitAt(inst, slot);
      inst.slots.push(slot);
    });
  }
  function growFruit(inst: PropInst, slot: Slot) {
    fruitAt(inst, slot);
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
    if (!insts.length && !fallers.length) return false;
    const hits = ray.intersectObjects([...insts.map((i) => i.holder), ...fallers.filter((f) => f.state < 3).map((f) => f.mesh)], true);
    // A fruit the finger landed on wins over the tree behind it: a child who aimed at an apple meant the apple.
    for (const h of hits) {
      const k = fruitKindOf(h.object);
      if (k && h.object.visible) { tapFruit(h.object, k); return true; }
    }
    // A prop with parts of its own (the xylophone's bars) rings the part that was tapped and nothing else; our own tap proxy around it is not a part (it has no bar), so the bar under the finger is found through it.
    for (const h of hits) {
      const part = instOf(h.object)?.holder.userData.tapPart as ((o: THREE.Object3D) => number | null) | undefined;
      const note = part ? part(h.object) : null;
      if (note !== null && note !== undefined) { ring(note); return true; }
    }
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
      const tick = inst.holder.userData.tick as ((t: number, dt: number) => void) | undefined;
      if (tick) tick(t, dt);                                  // a prop that animates its own parts (the dog)
      o.dy += inst.lift;
      if (inst.kick) {                                       // a kicked ball: along the floor and up, turning as it rolls
        const next = stepBall(inst.kick, dt, BALL_BOUNDS[0], BALL_BOUNDS[1]);
        inst.base.px = next.x;
        o.dy += next.h;
        if (inst.pivot) {
          inst.pivot.rotation.z = next.spin * (inst.type === "tire" ? TIRE_SPIN : 1);
          const tyre = inst.type === "tire" ? inst.pivot.children[0] : null;
          if (tyre) tyre.rotation.y *= Math.max(0, 1 - dt * 12);                          // a tire standing a little turned straightens as it starts to roll, so it turns about its own axis
        }
        inst.kick = next.resting ? null : next;
      }
      offs.set(inst, o);
      for (const slot of inst.slots) if (!slot.mesh && slot.regrowAt > 0 && t >= slot.regrowAt) { slot.regrowAt = 0; growFruit(inst, slot); }
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
        if (f.t > f.rest) { f.state = 2; f.t = 0; }
      } else if (f.state === 3) {
        // carried: the finger moves it (carryFruit); nothing here may fall, rest or tidy it
      } else if (f.state === 4) {
        const k = clamp01(f.t / (f.secs ?? 0.35)), e = k * k * (3 - 2 * k);
        f.mesh.position.lerpVectors(f.from!, f.to!, e);
        setFruitScale(f.mesh, f.kind, Math.max(0.001, CARRY_SCALE * (1 - 0.9 * e)));
        if (k >= 1) { f.mesh.parent?.remove(f.mesh); fallers.splice(i, 1); tone(330, 0, 0.06, "sine", 0.06, 220); }
      } else {
        const k = clamp01(f.t / (f.rain ? 0.12 : 0.35));
        setFruitScale(f.mesh, f.kind, Math.max(0.001, 1 - k));
        if (k >= 1) { f.mesh.parent?.remove(f.mesh); fallers.splice(i, 1); }
      }
    }
  }

  function reset() {
    for (const f of fallers) f.mesh.parent?.remove(f.mesh);
    fallers.length = 0; anims.length = 0; insts.length = 0; lastSay = ""; lampsOut = null;
  }

  /** Where an instance is on screen, in client pixels (for tests and the dev bench). `frac` is how far up the prop (0 the foot, 1 the top); a tree is tapped at its trunk, because its apples hang in the middle. */
  function screenPos(inst: PropInst, frac = 0.5): { x: number; y: number; visible: boolean } {
    const v = inst.holder.localToWorld(new THREE.Vector3(0, inst.size.y * frac, 0)).project(deps.camera());
    const r = deps.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  }

  return {
    register, tap, update, reset, activate, screenPos, nameOf, setLights,
    pickFruit, liftFruit, carryFruit, dropFruit, eatFruit, looseFruitX, basketAt, stashFruit, lightsOut, squish, kickBall, cue, nearby, placeProp, strike,
    /** Flutter a prop's pages (the book being read) without a tap. */
    flutter: useFlutter,
    /** Say a prop's name (caption and voice), exactly as a tap does, without reacting. */
    say: announce,
    /** Show or hide a prop (the guitar while Kip is playing it). */
    setVisible: (inst: PropInst, visible: boolean) => { inst.holder.visible = visible; },
    /** A tap on a fruit the drag handler already picked (it said "no move", so it was a tap): says its name and reacts like `tap` does. */
    tapFruitRef: (ref: FruitRef) => tapFruit(ref.mesh, ref.kind),
    list: () => insts.slice(),
    fallerCount: () => fallers.length,
    /** The loose fruit, live (not a copy), for tests and the dev bench. Read it; do not hold on to it across a reset. */
    get fallers(): readonly Faller[] { return fallers; },
    setLight,
  };
}

export type PropFx = ReturnType<typeof createPropFx>;
