// The character's own moves, from the Mixamo clips the repo ships (public/kip/mixamo/baked/): the JUMP and the SHOVE (Dan, 2026-11-04: "fix the walking and jump shoving animation using the
// Mixamo we added to the repo", then "it's not a proper rigged Mixamo animation").
//
// They are played the way the dances are: as the bench's own JOINT data (`jointClipToGame(..., { joints: true })`), so the Snap figure bends its elbows and knees, turns about the hips and
// takes the clip's exact rotations, exactly as the Kip bench does. NOTHING is cut, joined, eased, sped up or flattened:
//
//   jump   react_jump.json ("Jump", 0.93 s): a crouch, the take-off at 0.2 s, the apex at 0.3 to 0.4 s, the landing at 0.65 s and a settle. Played whole.
//   shove  act_push.json ("Push", 8 s): the arms reach out by about 0.7 s and press for seven seconds. A shove only needs the start of it, so the clip is played from its first frame as
//          authored and ended `SHOVE_PLAY_S` in with the driver's own ease-out (`trigger(..., { until })`), never spliced.
//
//   idle, walk and run  loco_idle / loco_walk / loco_run.json: the Mixamo Xbot's own idle, walk and run, baked to the same joint data (scripts/mixamo-bake.mjs with scripts/mixamo-loco-clips.json),
//          replace the bank's rigid-limb versions, so walking bends the elbows and knees and plants the feet like the bench's figure. All three or none, so the cycles always match.
//
// Pure apart from `loadMoves`, which fetches the two files the way the dance library does: every file CHECKED field by field (bakedDance.ts), a missing or bad one just leaves the old
// procedural move in place, never a broken one.
import { jointClipToGame, parseJointClip } from "./bakedDance";
import type { BakedClip } from "./mixamo";

export const MOVE_FILES = { jump: "react_jump", shove: "act_push" } as const;
/** The locomotion cycles, by the bank name they replace. */
export const LOCO_FILES = { idle: "loco_idle", walk: "loco_walk", run: "loco_run" } as const;

const MAX_FILE_CHARS = 900_000;

/** Seconds per frame of a clip (the driver maps time to frame as t / duration * (frames - 1)). */
export const framePeriod = (c: BakedClip): number => (c.frames > 1 ? c.duration / (c.frames - 1) : c.duration);

/** Where in the shove the arms are out at full reach (the shove "lands"): the first frame whose right arm points 0.8 or more forward. */
export function shoveContactSeconds(c: BakedClip): number {
  for (let i = 0; i < c.frames; i++) if (c.armR[i * 3 + 2]! >= 0.8) return i * framePeriod(c);
  return 0.6;
}

/** How much of the 8 s Push a shove plays: the reach, the contact and a moment of pressing, then the driver eases out of it. */
export const SHOVE_PLAY_S = 2.2;
/** The shove's ease out (seconds): the push is let go of smoothly, not snapped back. */
export const SHOVE_FADE_S = 0.3;

export interface MoveDeps {
  fetchImpl: typeof fetch;
  /** Put the converted clips into the character's bank. */
  addClips(clips: Record<string, BakedClip>): void;
  /** Where the baked files are (default /kip/mixamo/baked/). */
  base?: string;
}

export interface MovesLoaded {
  /** The names that are now in the bank (`jump`, `shove`). */
  loaded: string[];
  /** Seconds into the shove at which the arms are out (when the push "lands"), and how long of it is played (both in the clip's own time, which is the game's: nothing is sped up). */
  shoveContactS: number;
  shoveDurationS: number;
}

/** The two files, checked and converted as joint clips named `jump` and `shove`. Whatever fails is left out. */
export async function loadMoves(deps: MoveDeps): Promise<MovesLoaded> {
  const base = (deps.base ?? "/kip/mixamo/baked/").replace(/\/*$/, "/");
  const result: MovesLoaded = { loaded: [], shoveContactS: 0.6, shoveDurationS: SHOVE_PLAY_S };
  async function read(id: string): Promise<ReturnType<typeof parseJointClip>> {
    try {
      const res = await deps.fetchImpl(`${base}${id}.json`);
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > MAX_FILE_CHARS) return null;
      const joint = parseJointClip(JSON.parse(text));
      return joint && joint.id === id ? joint : null;
    } catch { return null; }
  }
  const [jumpFile, pushFile, idleFile, walkFile, runFile] = await Promise.all([read(MOVE_FILES.jump), read(MOVE_FILES.shove), read(LOCO_FILES.idle), read(LOCO_FILES.walk), read(LOCO_FILES.run)]);
  const clips: Record<string, BakedClip> = {};
  if (jumpFile) { const c = jointClipToGame(jumpFile, "jump", { joints: true }); c.loop = false; clips.jump = c; result.loaded.push("jump"); }
  if (pushFile) {
    const c = jointClipToGame(pushFile, "shove", { joints: true });
    c.loop = false;
    clips.shove = c;
    result.loaded.push("shove");
    result.shoveContactS = shoveContactSeconds(c);
    result.shoveDurationS = Math.min(SHOVE_PLAY_S, c.duration);
  }
  if (idleFile && walkFile && runFile) {
    for (const [name, file] of [["idle", idleFile], ["walk", walkFile], ["run", runFile]] as const) { const c = jointClipToGame(file, name, { joints: true }); c.loop = true; clips[name] = c; result.loaded.push(name); }
  }
  if (result.loaded.length) deps.addClips(clips);
  return result;
}
