// Level kit: assemble toyventor.level/1 files from a seed out of reusable, already-tested components.
//
// A level is not authored here, it is *composed*: a theme (ground, hills, sky, lighting rig), a time of day,
// a rhythm of five hiding spots (one junk machine first, then at least three different moves), scenery clusters
// picked from the theme's prop vocabulary, and one or two free STEM stations. Everything comes from the closed
// catalogs the engine already knows (PROPS, HIDE/HKIND, MDEF, PART), so the engine needs no new code per level and
// every composed level passes the same checks the level editor applies to a child's hand-made one.
//
// Pure and deterministic: the same seed (+ options) always yields the same level, so a seed code can be shared.
import { HIDE, HKIND, PART, PROPS, THEMES, type LevelDef, type LevelMissionRef, type LevelPropRef, type LevelSpotRef } from "./catalog";

export type Mood = "day" | "dusk" | "night";
export const MOODS: Mood[] = ["day", "dusk", "night"];
export const THEME_IDS = ["garden", "sky", "junk", "beach", "snow", "room"] as const;

/** mulberry32: tiny, fast, good enough for layout choices. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed codes are short base-36 strings kids can type or share. */
export const seedToCode = (seed: number): string => (seed >>> 0).toString(36).toUpperCase().padStart(4, "0");
export const codeToSeed = (code: string): number => parseInt(code.trim().toLowerCase(), 36) >>> 0;

/**
 * Scenery clusters per theme: small reusable groups of props, positioned relative to the cluster's x. Mixing them
 * is what makes two Beach levels feel different while still being unmistakably the Beach.
 */
interface Cluster { props: Array<{ type: string; dx: number; z?: number; y?: number }> }
const CLUSTERS: Record<string, Cluster[]> = {
  garden: [
    { props: [{ type: "tree", dx: 0 }, { type: "bushes", dx: 2.2 }] },
    { props: [{ type: "lantern", dx: 0 }, { type: "lantern", dx: 3.4, z: -1.7 }] },
    { props: [{ type: "windmill", dx: 0 }] },
    { props: [{ type: "cottage", dx: 0 }, { type: "lantern", dx: -2.6 }] },
    { props: [{ type: "bushes", dx: 0 }, { type: "lantern", dx: 2 }] },
    { props: [{ type: "tree", dx: 0 }, { type: "tree", dx: 3.4, z: -5 }] },
  ],
  sky: [
    { props: [{ type: "cloud", dx: 0, z: -17 }, { type: "cloud", dx: 5, z: -20 }] },
    { props: [{ type: "island", dx: 0, y: 6 }] },
    { props: [{ type: "island", dx: 0, z: -20, y: 8 }, { type: "cloud", dx: 4 }] },
    { props: [{ type: "cloud", dx: 0, z: -19 }] },
    { props: [{ type: "island", dx: 0, z: -14, y: 5 }, { type: "cloud", dx: -4, z: -17 }] },
  ],
  junk: [
    { props: [{ type: "tire", dx: 0, z: -1.8 }, { type: "tire", dx: 2, z: -2.4 }] },
    { props: [{ type: "drum", dx: 0 }, { type: "lantern", dx: 2.4, z: -1.8 }] },
    { props: [{ type: "shed", dx: 0 }] },
    { props: [{ type: "cranebg", dx: 0 }] },
    { props: [{ type: "drum", dx: 0 }, { type: "tire", dx: 2.2, z: -1.9 }] },
  ],
  beach: [
    { props: [{ type: "palm", dx: 0 }, { type: "umbrella", dx: 2.6 }] },
    { props: [{ type: "sandcastle", dx: 0 }] },
    { props: [{ type: "palm", dx: 0, z: -4.5 }, { type: "sandcastle", dx: 3 }] },
    { props: [{ type: "umbrella", dx: 0 }] },
    { props: [{ type: "palm", dx: 0 }, { type: "palm", dx: 3, z: -3.6 }] },
  ],
  snow: [
    { props: [{ type: "pine", dx: 0 }, { type: "pine", dx: 2.4, z: -5 }] },
    { props: [{ type: "snowman", dx: 0 }] },
    { props: [{ type: "igloo", dx: 0 }] },
    { props: [{ type: "pine", dx: 0, z: -6 }, { type: "snowman", dx: 3 }] },
    { props: [{ type: "pine", dx: 0 }] },
  ],
  room: [
    { props: [{ type: "lamp", dx: 0 }, { type: "books", dx: 2.4 }] },
    { props: [{ type: "blocks", dx: 0 }] },
    { props: [{ type: "books", dx: 0 }, { type: "blocks", dx: 3, z: -4.2 }] },
    { props: [{ type: "lamp", dx: 0, z: -5.5 }] },
    { props: [{ type: "blocks", dx: 0 }, { type: "lamp", dx: 3 }] },
  ],
};

const NOUN: Record<string, string> = { garden: "Garden", sky: "Sky Meadow", junk: "Junkyard", beach: "Beach", snow: "Snow Peak", room: "Toy Room" };
const ADJ: Record<Mood, string[]> = {
  day: ["Sunny", "Bright", "Breezy", "Cheery", "Busy"],
  dusk: ["Golden", "Cosy", "Sleepy", "Glowing", "Amber"],
  night: ["Starry", "Moonlit", "Quiet", "Twinkly", "Midnight"],
};

/** Free STEM stations (no blueprints needed) any composed level can offer; mirrors the six Lab levels. */
const STATIONS = ["bridge", "lift", "measure", "balance", "logic", "lever", "circuit", "code", "pattern", "clean", "raft"];

export interface ComposeOptions {
  seed: number;
  /** Force a theme / mood instead of drawing them from the seed. */
  theme?: string;
  mood?: Mood;
  /** Part keys the child already found: composed levels hide other parts first so every find is new. */
  owned?: ReadonlySet<string>;
}
export interface ComposedLevel extends LevelDef { seed: string; mood: Mood }

const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
function shuffle<T>(r: () => number, a: readonly T[]): T[] {
  const o = a.slice();
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [o[i], o[j]] = [o[j]!, o[i]!];
  }
  return o;
}

/** The hide ids for each move kind, for one theme (HKIND stores them in THEMES order). */
function hideFor(kind: string, theme: string): string {
  const row = HKIND.find((k) => k[0] === kind)!;
  return row[3][THEMES[theme] ?? 0] ?? row[3][0]!;
}

export function composeLevel(opts: ComposeOptions): ComposedLevel {
  const r = rng(opts.seed);
  const theme = opts.theme && CLUSTERS[opts.theme] ? opts.theme : pick(r, THEME_IDS);
  const mood: Mood = opts.mood ?? pick(r, MOODS);
  const owned = opts.owned ?? new Set<string>();

  // 1. Rhythm: five spots on a jittered grid, always >= 4 apart and inside 4..42; the junk machine opens the level.
  const base = [6, 14, 22, 30, 38];
  const xs = base.map((b, i) => Math.round((b + (r() * 3 - 1.5) + (i === 0 ? -0.5 : 0)) * 2) / 2).map((x) => Math.max(4.5, Math.min(41.5, x)));
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i]!, xs[i - 1]! + 4.5);
  const overflow = xs[4]! - 41.5;
  if (overflow > 0) for (let i = 0; i < 5; i++) xs[i] = xs[i]! - overflow * (i / 4);

  // 2. Moves: junk first, then four spots drawn so at least three different moves appear.
  const moves = ["glow", "torque", "speed", "spin"];
  let rest: string[];
  do rest = [pick(r, moves), pick(r, moves), pick(r, moves), pick(r, moves)];
  while (new Set(rest).size < 3);
  const kinds = ["junk", ...rest];

  // 3. Parts: unowned world parts first, never repeated, never looks-only.
  const pool = Object.keys(PART).filter((k) => PART[k]!.w && PART[k]!.st !== "none");
  const fresh = shuffle(r, pool.filter((k) => !owned.has(k)));
  const seen = shuffle(r, pool.filter((k) => owned.has(k)));
  const parts = fresh.concat(seen);

  const spots: LevelSpotRef[] = kinds.map((k, i) => ({ part: parts[i]!, hide: hideFor(k, theme), x: xs[i]! }));

  // 4. Scenery: clusters in the gaps, never on top of a spot's cover.
  const props: LevelPropRef[] = [];
  const clusters = shuffle(r, CLUSTERS[theme]!);
  const gaps = [2, 10, 18, 26, 34, 41].map((g) => g + (r() * 2 - 1));
  gaps.forEach((gx, i) => {
    const c = clusters[i % clusters.length]!;
    for (const p of c.props) {
      const x = Math.round((gx + p.dx) * 2) / 2;
      if (x < 0 || x > 45) continue;
      if (spots.some((s) => Math.abs(s.x - x) < 1.6 && (PROPS[p.type]?.z ?? 0) > -3)) continue;
      const ref: LevelPropRef = { type: p.type, x };
      if (p.z != null) ref.z = p.z;
      if (p.y != null) ref.y = p.y;
      if (PROPS[p.type]) props.push(ref);
    }
  });

  // 5. Stations: one or two free STEM stations, kept clear of the spots.
  const missions: LevelMissionRef[] = [];
  const stationPool = shuffle(r, STATIONS);
  const want = r() < 0.5 ? 1 : 2;
  for (const type of stationPool) {
    if (missions.length >= want) break;
    for (let tries = 0; tries < 12; tries++) {
      const x = Math.round((10 + r() * 30) * 2) / 2;
      if (spots.every((s) => Math.abs(s.x - x) >= 3.5) && missions.every((m) => Math.abs(m.x - x) >= 6)) {
        missions.push({ type, x, free: true });
        break;
      }
    }
  }

  const code = seedToCode(opts.seed);
  return { format: "toyventor.level/1", id: `seed-${code.toLowerCase()}`, name: `${pick(r, ADJ[mood])} ${NOUN[theme]}`, theme, mood, seed: code, props, spots, missions };
}

export interface LevelCheck { ok: boolean; n: string; why: string }

/**
 * The editor's own acceptance rules (EditorPanel "Checks"), restated so composed levels and hand-made ones are held
 * to one bar. `strictFive` is off for levels that skip parts the child already owns.
 */
export function checkLevel(L: LevelDef, strictFive = true): LevelCheck[] {
  const sp = L.spots;
  const keys = sp.map((s) => s.part);
  const xs = sp.map((s) => s.x).sort((a, b) => a - b);
  const moves = new Set<string>();
  sp.forEach((s) => { const h = HIDE[s.hide]; if (h && h.t !== "junk") moves.add(h.t); });
  return [
    { ok: strictFive ? sp.length === 5 : sp.length >= 1 && sp.length <= 5, n: "Hidden parts", why: `${sp.length} placed` },
    { ok: sp.some((s) => HIDE[s.hide]?.t === "junk" && s.x <= 10), n: "A junk machine in the first 10 units", why: "The first find never needs a move" },
    { ok: keys.every((k, i) => !!PART[k] && PART[k]!.st !== "none" && keys.indexOf(k) === i), n: "Each spot hides a different real part", why: "No repeats, no looks-only parts" },
    { ok: xs.every((x, i) => !i || x - xs[i - 1]! >= 4), n: "Spots at least 4 units apart", why: "Two glints never overlap" },
    { ok: sp.every((s) => s.x >= 4 && s.x <= 42), n: "Spots between unit 4 and unit 42", why: "Clear of the start and the edge" },
    { ok: moves.size >= 3, n: "At least three different moves", why: "The level teaches more than one trick" },
    { ok: L.props.every((p) => !!PROPS[p.type] && p.x >= -6 && p.x <= 50), n: "Scenery is catalog props inside the world", why: "Nothing the engine cannot build" },
    { ok: !!L.mood || !!L.theme, n: "Has a theme", why: "Ground, hills, sky and lights come from it" },
  ];
}

/** How many distinct levels the kit can produce, as an honest lower bound (themes x moods x spot kinds x scenery order). */
export function kitSize(): number {
  const themes = THEME_IDS.length;
  const moods = MOODS.length;
  const moveCombos = 24 + 4 * (3 ** 4 - 3 * 2 ** 4 + 3); // 4 moves over 4 kinds using >= 3 distinct: 24 + 144 = 168
  const parts = Object.keys(PART).filter((k) => PART[k]!.w && PART[k]!.st !== "none").length;
  const partOrders = Array.from({ length: 5 }, (_, i) => parts - i).reduce((a, b) => a * b, 1);
  const sceneryOrders = 5 * 4 * 3 * 2; // choose-and-order clusters per gap, conservative
  return themes * moods * moveCombos * partOrders * sceneryOrders;
}

