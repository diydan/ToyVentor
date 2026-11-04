// The win cheer (Dan, 2026-11-04: "then start 2": the baked Mixamo cheer and fist pump in place of the hand-built cheer; later the same day Dan added Mixamo's "Cheering 2 hands" and "Victory").
//
// Every win moment in the game asks the driver for the action `cheer` (cooking, cleaning, the mop and the toy box, the toy room's jump): it used to be a 1.3 s two-armed clip built from limb
// directions. Mixamo's "Standing Cheering" and "Standing Fist Pump" are real performances, posed here with the bench's own joint rotations (runtime/snapFlex.ts), so the elbows and wrists
// bend. The first two are one-armed and 3.4 s long with half a second of lead-in; "Cheering 2 hands" (2.9 s) raises both arms and "Victory" (the 0.7 to 4.0 s of its 8.5 s: both hands up and a
// happy shimmy) is the big one. The win moments reserve 1.8 to 2.0 s (CLEAN_CHEER_S, COOK_CHEER_S), so each is played at CHEER_SECONDS, which is the clip's own motion at 1.5 to 1.8 times the
// speed: a quick "yes!". They take turns, so two wins in a row are not the same gesture.
//
// Nothing here moves any other lane's timing: the clip is still called `cheer`, still a one-shot, and about as long as the one it replaces. Until the files have loaded (or if one is missing or
// wrong) the hand-built cheer stays in the bank and plays as before. The world calls `roll()` just before it triggers `cheer`.
import { createGestureLibrary } from "./idleBehavior";
import type { BakedClip } from "./mixamo";

export const CHEER_FILES = ["react_cheer", "react_fistpump", "react_cheer2", "react_victory"] as const;
/** How long a win cheer lasts, seconds (the win moments reserve 1.8 s for cleaning, 2.0 s for cooking). */
export const CHEER_SECONDS = 1.9;
/** The name the driver knows it by: the same as the hand-built one, so every caller and every check that reads `busyAction` is unchanged. */
export const CHEER_ACTION = "cheer";

/** A copy of a baked clip as the win cheer: named `cheer`, one-shot, `seconds` long (the same frames, played faster). The original is not touched. */
export function cheerClip(clip: BakedClip, seconds: number = CHEER_SECONDS): BakedClip {
  const dur = Number.isFinite(seconds) && seconds > 0.2 ? seconds : CHEER_SECONDS;
  // planted: the bake left it unplanted, so the driver never stood the sole on the floor and every win cheer hovered (measured 2026-11-04: lowest sole a median 0.10 above it, up to 0.15)
  return { ...clip, name: CHEER_ACTION, duration: dur, loop: false, pose: false, planted: true };
}

/** Which of the loaded cheers comes next: one that is not the last (so two wins in a row are never the same), the only one if there is one, null if none. The first pick is random. */
export function nextCheer(last: string | null, have: readonly string[], rng: () => number): string | null {
  const ids = CHEER_FILES.filter((id) => have.includes(id));
  if (!ids.length) return null;
  const others = ids.filter((id) => id !== last);
  const pool = others.length ? others : ids;
  const r = rng();
  return pool[Math.min(pool.length - 1, Math.floor((Number.isFinite(r) ? Math.max(0, r) : 0) * pool.length))]!;
}

export interface CheerDeps {
  fetchImpl: typeof fetch;
  /** Put clips into the character's bank (the driver's `addClips`: a name already there is replaced). */
  addClips(clips: Record<string, BakedClip>): void;
  rng?: () => number;
  base?: string;
}
export interface Cheers {
  /** Fetch and check the baked files (all of them, once). A file that fails is simply left out. */
  load(): Promise<string[]>;
  /** Put the next cheer in the bank as `cheer`. False when none has loaded (the hand-built one is still there). Call it just before triggering `cheer`. */
  roll(): boolean;
  /** The cheers loaded so far. */
  loaded(): readonly string[];
}

export function createCheers(deps: CheerDeps): Cheers {
  const variants = new Map<string, BakedClip>();
  let last: string | null = null;
  const library = createGestureLibrary({
    fetchImpl: deps.fetchImpl,
    base: deps.base,
    allowed: CHEER_FILES,
    // the library hands over each clip under its file name: keep it as the win cheer it will be played as
    addClips: (c) => { for (const [id, clip] of Object.entries(c)) variants.set(id, cheerClip(clip)); },
  });
  return {
    load: () => library.ensure(),
    roll() {
      const id = nextCheer(last, [...variants.keys()], deps.rng ?? Math.random);
      if (!id) return false;
      last = id;
      deps.addClips({ [CHEER_ACTION]: variants.get(id)! });
      return true;
    },
    loaded: () => [...variants.keys()],
  };
}
