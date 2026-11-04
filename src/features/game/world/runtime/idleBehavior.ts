// What the game's character does on its own when nothing is going on, and on the title screen (Dan, 2026-11-04: "like idle waves and random dances if nothing is going on").
//
// The world already has an idle tick (`idleAct`: a hop, a shake, a nod, a spin, an arm raised); it now comes after 30 to 60 s of standing still and then every 45 to 120 s (`idleGapSeconds`). This adds four more things it can do, from the Mixamo
// clips the repo ships (public/kip/mixamo/baked/): a WAVE, a CLAP, a DANCE, and a FIDGET (Dan, 2026-11-04, after downloading them: thinking, bored, a yawn, a shrug, a look around, an arm stretch; each played once, whole). They are played the way the dance party plays a dance: as a beat source, on a clock of their own, so the
// character turns to face the camera for them and back afterwards (the camera itself does not move), they fade in and out, and walking or a tap pulls the character out of them. They are posed with the bench's own joint
// rotations (runtime/snapFlex.ts), so the elbows, wrists and knees bend as in the Kip demo.
//
//   chooseIdle         pure: what to do now (or nothing: the old gestures then have their turn), given how long the character has been idle and which clips are loaded.
//   createGestureLibrary   fetches and checks the baked files (every one field by field, as the dance library does) and puts them in the character's bank.
//   createIdle         the controller: start, watch, stop. It never stops a dance that is not its own (the party's), and the title screen's show is the same machinery, running on.
//
// Pure apart from the library's fetch. No timers: the caller says what time it is.
import { jointClipToGame, parseJointClip } from "./bakedDance";
import type { BakedClip, BeatSource } from "./mixamo";

export type IdleKind = "wave" | "clap" | "dance" | "fidget";

/** The baked files a behaviour may use. The Samba, the character's own dance, is always in its bank (`SAMBA_CLIP`) and needs no file. */
export const IDLE_FILES: Readonly<Record<IdleKind, readonly string[]>> = {
  wave: ["react_wave"],
  clap: ["react_clap"],
  dance: ["dance_silly", "dance_hiphop", "dance_swing", "dance_locking", "dance_chicken"],
  fidget: ["mood_thinking", "mood_bored", "mood_yawn", "mood_shrug", "mood_look", "move_arms"],
};
/** The group a baked file says it is in, where that is not `react` (the library refuses a file whose group is not the one its name belongs to). The arm stretch is the movement break's clip; the kick and the sneak are acts (gameActions.ts). */
const GROUP_OF: Readonly<Record<string, string>> = { move_arms: "move", act_kick: "act", act_sneak: "act", act_pickthrow: "act" };
export const SAMBA_CLIP = "dance";
/** What the driver's `busyAction` says while one of these is playing, so the party's checks for `dance` (and every test that reads it) never mistake an idle wave for a party. */
export const IDLE_LABEL = "idle";
export const IDLE_IDS: readonly string[] = [...IDLE_FILES.wave, ...IDLE_FILES.clap, ...IDLE_FILES.dance, ...IDLE_FILES.fidget];

/** Of every idle tick: the share that becomes a dance (only once the character has been idle for a while), a wave, a clap, a fidget. The rest (a quarter) is left to the old gestures. */
export const IDLE_ODDS = { dance: 0.22, wave: 0.24, clap: 0.1, fidget: 0.2 } as const;
/** A dance is only offered from the Nth idle tick of one spell of standing still (the second: a minute and a half to three minutes in), so a wave or a clap comes first. */
export const DANCE_FROM_TICK = 1;

/**
 * How long he stands still before an idle tick, seconds. Dan, 2026-11-04, after seeing the first version (a tick every 6.5 s): "maybe a little busy, idle animations can be min 30 to 60 seconds or
 * even minutes". So the first tick of a spell of standing still comes after 30 to 60 s, and each one after it 45 to 120 s later (drawn each time, so it is never a metronome). This is the gap for
 * EVERY idle gesture, the old hop, shake, nod and spin included, not only the new ones. Touching, moving or doing anything starts the count again.
 */
export const IDLE_GAP_SECONDS = { first: [30, 60], later: [45, 120] } as const;
/** The gap before the next idle tick: `chain` is how many ticks this spell has had (0 before the first). */
export function idleGapSeconds(rng: () => number, chain: number): number {
  const [lo, hi] = chain <= 0 ? IDLE_GAP_SECONDS.first : IDLE_GAP_SECONDS.later;
  const d = rng();
  const r = Number.isFinite(d) ? Math.min(0.999999, Math.max(0, d)) : 0.5; // a draw that is not a number must not stop the ticks for good
  return lo + r * (hi - lo);
}
/** How long a behaviour runs, seconds: a wave and a clap about three, a dance about seven, always whole loops of the clip so it ends where it began (so a bit over: the 4.7 s Hip Hop plays twice, 9.5 s); a clip at least as long as the cap (the 21 s swing) is cut at the cap. A fidget is played once, whole (the longest, the 10.7 s Bored, is under `fidgetCap`). */
export const IDLE_SECONDS = { wave: 3, clap: 3.5, dance: 7, danceCap: 9, fidget: 5, fidgetCap: 11 } as const;

export interface IdleChoice { kind: IdleKind; clip: string; seconds: number }

/** Whole loops of a clip `dur` seconds long to cover at least `want` seconds (a clip longer than the cap, or `want`, is cut at the cap). */
export function playSeconds(kind: IdleKind, dur: number): number {
  if (!(dur > 0) || !Number.isFinite(dur)) return IDLE_SECONDS[kind];
  if (kind === "fidget") return Math.min(dur, IDLE_SECONDS.fidgetCap); // once, whole: it begins and ends standing
  const want = IDLE_SECONDS[kind];
  const cap = kind === "dance" ? IDLE_SECONDS.danceCap : want;
  if (dur >= cap) return cap;
  return Math.ceil(want / dur) * dur;
}

/**
 * What to do on this idle tick. `chain` counts the ticks in this spell of standing still (0 for the first); `have` maps each clip that is in the bank now to its length in seconds.
 * Returns null for "leave it to the old gestures" (and always when no clip is loaded yet).
 */
export function chooseIdle(rng: () => number, chain: number, have: ReadonlyMap<string, number>): IdleChoice | null {
  const r = rng();
  const pick = (kind: IdleKind): IdleChoice | null => {
    // the Samba has no foot grounding and hovers (measured 2026-11-04: its lowest sole median 0.23 above the floor, the baked dances within 2 mm): it is only the fallback while no baked dance is loaded
    const bakedDances = IDLE_FILES.dance.filter((id) => have.has(id));
    const ids = (kind === "dance" ? (bakedDances.length ? bakedDances : [SAMBA_CLIP]) : IDLE_FILES[kind]).filter((id) => have.has(id));
    if (!ids.length) return null;
    const clip = ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]!;
    return { kind, clip, seconds: playSeconds(kind, have.get(clip)!) };
  };
  let acc = 0;
  if (chain >= DANCE_FROM_TICK) { acc += IDLE_ODDS.dance; if (r < acc) return pick("dance"); }
  acc += IDLE_ODDS.wave; if (r < acc) return pick("wave");
  acc += IDLE_ODDS.clap; if (r < acc) return pick("clap");
  acc += IDLE_ODDS.fidget; if (r < acc) return pick("fidget");
  return null;
}

// ---- the files --------------------------------------------------------------------------------------------------------------------------

const ID = /^[a-z0-9_]{1,40}$/;
const MAX_FILE_CHARS = 900_000;

export interface GestureLibraryDeps {
  fetchImpl: typeof fetch;
  /** Put converted clips into the character's bank. */
  addClips(clips: Record<string, BakedClip>): void;
  /** Where the baked files are (default /kip/mixamo/baked/). */
  base?: string;
  /** The ids it may load (default: the idle behaviours' own, IDLE_IDS): anything else is refused. The win cheers (winCheer.ts) use the same checks with their own list. */
  allowed?: readonly string[];
}
export interface GestureLibrary {
  /** Fetch, check and convert these clips (default: all of IDLE_IDS) that are not loaded yet. Resolves the ids that are playable now; one that fails is simply left out. */
  ensure(ids?: readonly string[]): Promise<string[]>;
  /** Each clip loaded so far and its length in seconds. */
  durations(): ReadonlyMap<string, number>;
}

export function createGestureLibrary(deps: GestureLibraryDeps): GestureLibrary {
  const base = (deps.base ?? "/kip/mixamo/baked/").replace(/\/*$/, "/");
  const allowed = deps.allowed ?? IDLE_IDS;
  const loaded = new Map<string, number>();
  const loading = new Map<string, Promise<boolean>>();
  const groupOf = (id: string): string => (IDLE_FILES.dance.includes(id) ? "dance" : GROUP_OF[id] ?? "react");

  function load(id: string): Promise<boolean> {
    if (!ID.test(id) || !allowed.includes(id)) return Promise.resolve(false);
    if (loaded.has(id)) return Promise.resolve(true);
    let p = loading.get(id);
    if (!p) {
      p = (async () => {
        let text: string;
        try {
          const res = await deps.fetchImpl(`${base}${id}.json`);
          if (!res.ok) return false;
          text = await res.text();
        } catch { return false; }
        if (text.length > MAX_FILE_CHARS) return false;
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { return false; }
        const joint = parseJointClip(raw);
        // the file must be the clip its name says, in the group that clip belongs to: a mismatch is a different file
        if (!joint || joint.id !== id || joint.group !== groupOf(id)) return false;
        deps.addClips({ [id]: jointClipToGame(joint, id, { joints: true }) });
        loaded.set(id, joint.dur);
        return true;
      })().finally(() => loading.delete(id));
      loading.set(id, p);
    }
    return p;
  }

  return {
    async ensure(ids = allowed) {
      const r = await Promise.all(ids.map(async (id) => [id, await load(id)] as const));
      return r.filter(([, ok]) => ok).map(([id]) => id);
    },
    durations: () => loaded,
  };
}

// ---- the controller ---------------------------------------------------------------------------------------------------------------------

/** What the controller needs of the driver (mixamo.ts `MixamoDriver` has all of it). */
export interface IdleMix {
  startBeatSource(source: BeatSource, label?: string): boolean;
  stopBeatDance(): void;
  readonly busyAction: string | null;
  readonly beatSourceFn: BeatSource | null;
}
export interface IdleDeps {
  mix(): IdleMix | null;
  /** True while the character is free to do something on its own: a character the driver can drive, standing still, nothing else going on. NOT about the driver's own busy state. */
  ok(): boolean;
  /** Called as a behaviour begins (the world turns the character to face the camera). Not called for the title show. */
  begin(): void;
  rng(): number;
  /** Seconds, any steady clock. */
  now(): number;
  /** Every clip in the character's bank now, with its length: the library's, and the Samba. */
  durations(): ReadonlyMap<string, number>;
}
export interface Idle {
  /** An idle tick: maybe start something. Returns true if it did (the caller then skips the old gestures). */
  tryStart(chain: number): boolean;
  /** Once a frame: end a behaviour that has run its time, or that the character is no longer free for. */
  update(): void;
  /** End whatever is running now (a tap, a walk). Safe when nothing is. */
  cancel(): void;
  /** The title screen's show: a dance, then another, until `stopShow`. Returns false if there is nothing to play. */
  startShow(): boolean;
  stopShow(): void;
  readonly active: boolean;
  readonly showing: boolean;
  readonly clip: string | null;
}

export function createIdle(deps: IdleDeps): Idle {
  let cur: { source: BeatSource; until: number; clip: string } | null = null;
  let show: { source: BeatSource } | null = null;
  let showClip: string | null = null;

  const mine = (m: IdleMix | null, s: BeatSource | null): boolean => !!m && !!s && m.beatSourceFn === s;

  function tryStart(chain: number): boolean {
    const m = deps.mix();
    if (!m || cur || show || m.busyAction || !deps.ok()) return false;
    const choice = chooseIdle(deps.rng, chain, deps.durations());
    if (!choice) return false;
    const t0 = deps.now();
    const source: BeatSource = () => ({ name: choice.clip, time: deps.now() - t0 });
    if (!m.startBeatSource(source, IDLE_LABEL)) return false;
    cur = { source, until: t0 + choice.seconds, clip: choice.clip };
    deps.begin();
    return true;
  }

  function update(): void {
    const m = deps.mix();
    if (cur) {
      if (!mine(m, cur.source)) cur = null; // someone else's dance replaced it (the party): it is theirs now, leave it be
      else if (deps.now() >= cur.until || !deps.ok()) { m!.stopBeatDance(); cur = null; }
    }
    if (show && !mine(m, show.source)) { show = null; showClip = null; }
  }

  function cancel(): void {
    const m = deps.mix();
    if (cur && mine(m, cur.source)) m!.stopBeatDance();
    cur = null;
  }

  function startShow(): boolean {
    const m = deps.mix();
    if (!m || show || cur || m.busyAction) return false;
    const have = (): string[] => [SAMBA_CLIP, ...IDLE_FILES.dance].filter((id) => deps.durations().has(id));
    if (!have().length) return false;
    let clip = SAMBA_CLIP;
    let t0 = deps.now();
    let until = t0 + playSeconds("dance", deps.durations().get(clip) ?? 4);
    const next = (): void => {
      const all = have();
      const others = all.filter((id) => id !== clip);
      const pool = others.length ? others : all;
      clip = pool[Math.min(pool.length - 1, Math.floor(deps.rng() * pool.length))]!;
      t0 = deps.now();
      until = t0 + playSeconds("dance", deps.durations().get(clip) ?? 4);
    };
    const source: BeatSource = () => {
      if (deps.now() >= until) next();
      showClip = clip;
      return { name: clip, time: deps.now() - t0 };
    };
    if (!m.startBeatSource(source, IDLE_LABEL)) return false;
    show = { source };
    showClip = clip;
    return true;
  }

  function stopShow(): void {
    const m = deps.mix();
    if (show && mine(m, show.source)) m!.stopBeatDance();
    show = null;
    showClip = null;
  }

  return {
    tryStart, update, cancel, startShow, stopShow,
    get active() { return cur !== null; },
    get showing() { return show !== null; },
    get clip() { return cur ? cur.clip : showClip; },
  };
}
