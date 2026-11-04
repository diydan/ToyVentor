// Three of the character's one-shot actions, played from real Mixamo clips (Dan, 2026-11-04, after downloading "Sad Idle", "Sneaking Forward" and "kick": "copy and implement").
//
//   sad    the part that cannot be afforded (the world's `mixGo("sad")`): it was a 1.4 s held pose of the Xbot's slouch; now "Sad Idle", a 2.8 s sigh with the head dropping and the arms hanging.
//   sneak  the peek behind a hiding spot (`mixGo("sneak")`): it was a held crouch pose; now "Sneaking Forward", 1.7 s of a crouched, careful step in place.
//   kick   the toy room's ball (`w.clip("kick")`): it was 1.0 s built from limb directions with the foot meeting the ball at KICK_CONTACT_S (0.42 s), the cue the ball is launched on and that
//          every test of the act is written against. Mixamo's kick is 1.6 s with half a second of weight shift first and a long recovery, so the file is the 0.14 to 1.24 s of it (scripts/
//          mixamo-clips.json) and is played over KICK_PLAY_S, which puts the foot at the ball at about KICK_CONTACT_S: the act's timing, the ball and the dog's fetch are not touched.
//
// Each is posed with the bench's own joint rotations (the elbows, wrists and knees bend, runtime/snapFlex.ts), under the SAME action name as the clip it replaces, so every caller and every check
// that reads `busyAction` is unchanged. Until a file has loaded (or if it is missing or is the wrong clip) the old one stays in the bank and plays as before. The files are read by the shared checked
// loader (idleBehavior.ts `createGestureLibrary`, which checks every file field by field). Pure apart from the fetch.
import { createGestureLibrary } from "./idleBehavior";
import type { BakedClip } from "./mixamo";

/** The action the game triggers, and the baked file that plays it. */
export const ACTION_FILES = { sad: "mood_sad", sneak: "act_sneak", kick: "act_kick", throw: "act_pickthrow" } as const;
export type BakedAction = keyof typeof ACTION_FILES;
const FILE_IDS: readonly string[] = Object.values(ACTION_FILES);
const ACTION_OF: Readonly<Record<string, BakedAction>> = Object.fromEntries(Object.entries(ACTION_FILES).map(([a, f]) => [f, a as BakedAction]));

/** How long the kick plays, seconds: the toy room's act is KICK_S (1.0 s) long, and the foot has to meet the ball at KICK_CONTACT_S. (tests/game-actions.test.ts holds both to the act's own constants.) */
export const KICK_PLAY_S = 1.0;

/** A copy of a baked clip as the game's action `name`: one-shot, not a held pose, and (the kick) retimed to the act's length. The original is not touched; the frames and joint data are shared, not copied. */
export function actionClip(name: BakedAction, clip: BakedClip): BakedClip {
  const c: BakedClip = { ...clip, name, loop: false, pose: false };
  if (name === "kick") c.duration = KICK_PLAY_S;
  return c;
}

export interface ActionDeps {
  fetchImpl: typeof fetch;
  /** Put clips into the character's bank (the driver's `addClips`: a name already there is replaced). */
  addClips(clips: Record<string, BakedClip>): void;
  base?: string;
}
export interface BakedActions {
  /** Fetch and check the three files (once) and put each that is good in the bank under its action's name. Resolves the action names now in the bank; a file that fails is left out. */
  load(): Promise<BakedAction[]>;
  /** The actions that are now played from a baked clip. */
  loaded(): readonly BakedAction[];
}

export function createActions(deps: ActionDeps): BakedActions {
  const have = new Set<BakedAction>();
  const library = createGestureLibrary({
    fetchImpl: deps.fetchImpl,
    base: deps.base,
    allowed: FILE_IDS,
    // the library hands each clip over under its file name: it goes into the bank under the action's
    addClips: (c) => {
      const out: Record<string, BakedClip> = {};
      for (const [id, clip] of Object.entries(c)) {
        const a = ACTION_OF[id];
        if (a) { out[a] = actionClip(a, clip); have.add(a); }
      }
      deps.addClips(out);
    },
  });
  return {
    async load() { await library.ensure(); return [...have]; },
    loaded: () => [...have],
  };
}
