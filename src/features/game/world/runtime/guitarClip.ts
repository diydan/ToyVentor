// The Mixamo "Guitar Playing" clip for the game's Kip (Dan, 2026-11-05: "we have the Mixamo guitar animations we can use, right?").
//
// public/kip/mixamo/baked/music_guitar.json is the bench's joint data for it ("Guitar Strum", 4.77 s, 8 beats, 100.7 bpm, planted). Like the other Mixamo moves (gameMoves.ts) it is fetched, CHECKED
// field by field (bakedDance.ts) and converted to the game's joint clip under the bank name `guitar`. It is LOCAL ONLY: the baked files are derived from Mixamo clips, are not committed (public/kip/
// mixamo/baked/README.md) and may be absent from a fresh checkout or a deploy, so the guitar act must work without it: `loadGuitarClip` just leaves the bank alone when the file is missing or bad, and
// the act (toyRoomActs.ts) asks `hasClip("guitar")` and falls back to the hand-authored `strum` clip.
//
// Pure apart from the one fetch.
import { beatHit, jointClipToGame, parseJointClip } from "./bakedDance";
import type { ArmClipSpec } from "./guitarPlay";
import type { BakedClip } from "./mixamo";

/** The baked file's id and the name the clip has in the character's bank. */
export const GUITAR_FILE = "music_guitar";
export const GUITAR_CLIP = "guitar";
const MAX_FILE_CHARS = 900_000;

export interface GuitarClipDeps {
  fetchImpl: typeof fetch;
  /** Put the converted clip into the character's bank. */
  addClips(clips: Record<string, BakedClip>): void;
  /** Where the baked files are (default /kip/mixamo/baked/). */
  base?: string;
}

export interface GuitarClipLoaded {
  loaded: boolean;
  /** Seconds in one beat of the clip (its length over its counted beats), 0 when not loaded or not counted. */
  beatS: number;
}

/**
 * Where the strum arm's strokes are in a Mixamo guitar clip: it is counted in beats (8 in the 4.77 s loop, 100.7 bpm), two down strokes to a beat, so a key (a down stroke, then the up stroke between
 * it and the next) falls every beat / 4 and the clip repeats after beats * 4 of them. The down strokes land where the body dips (the hips' low points: `beatHit` at two to a beat), which this finds
 * from the clip itself. Null for a clip with no counted beats.
 */
export function armSpecFor(clip: Pick<BakedClip, "hips" | "frames" | "duration">, beats: number): ArmClipSpec | null {
  if (!Number.isInteger(beats) || beats < 1 || !(clip.duration > 0)) return null;
  const step = clip.duration / (beats * 4);
  const hit = beatHit(clip, beats * 2).offset;
  return { ready: hit - step, period: beats * 4, keyTime: (i) => hit + i * step };
}

let arm: ArmClipSpec | null = null;
/** The strum arm's strokes in the loaded Mixamo clip, or null when it is not loaded (the act then plays the hand-authored clip). */
export const guitarArmSpec = (): ArmClipSpec | null => arm;
/** Forget the loaded clip (a new world, the tests). */
export function forgetGuitarClip(): void { arm = null; }

/** Fetch, check and convert the clip. Whatever goes wrong (no file, a refused or oversized one, no network) leaves the bank as it was. */
export async function loadGuitarClip(deps: GuitarClipDeps): Promise<GuitarClipLoaded> {
  const none: GuitarClipLoaded = { loaded: false, beatS: 0 };
  const base = (deps.base ?? "/kip/mixamo/baked/").replace(/\/*$/, "/");
  try {
    const res = await deps.fetchImpl(`${base}${GUITAR_FILE}.json`);
    if (!res.ok) return none;
    const text = await res.text();
    if (text.length > MAX_FILE_CHARS) return none;
    const joint = parseJointClip(JSON.parse(text));
    if (!joint || joint.id !== GUITAR_FILE) return none;
    const clip = jointClipToGame(joint, GUITAR_CLIP, { joints: true });
    clip.loop = true;
    arm = joint.beats ? armSpecFor(clip, joint.beats) : null;
    deps.addClips({ [GUITAR_CLIP]: clip });
    return { loaded: true, beatS: joint.beats ? joint.dur / joint.beats : 0 };
  } catch {
    return none;
  }
}
