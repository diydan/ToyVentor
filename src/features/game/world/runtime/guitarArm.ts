// The link between the guitar act and the character's animation driver (mixamo.ts): the act owns a clock (how far into the guitar clip the arm is), the driver poses Kip from it every frame as a beat
// source. This keeps the bookkeeping in one small pure place: who started the beat, so the act only stops its OWN (a dance party or an idle dance that took the beat over since is left alone), and
// when it cannot start at all (reduced motion, no rig, the clip not in the bank) it says so and the act falls back to the canned `strum` clip.
import type { BeatSource } from "./mixamo";

export interface GuitarArmHost {
  /** Is this clip in the character's bank? */
  has(name: string): boolean;
  /** Can the character be driven now (a rig that is not in reduced motion)? */
  canStart(): boolean;
  /** Start a beat source with a label (`busyAction` reports the label, so nothing mistakes the guitar for a dance party); false if the driver refuses. */
  begin(source: BeatSource, label: string): boolean;
  /** Is this still the beat source the driver is playing? */
  owns(source: BeatSource): boolean;
  /** Ease the beat out. */
  end(): void;
}

/** The label the guitar's beat source carries: `busyAction` reads `strum`, as it did when the canned clip played. */
export const GUITAR_LABEL = "strum";

export function createGuitarArm(host: GuitarArmHost) {
  let own: BeatSource | null = null;
  return {
    has: (name: string): boolean => host.has(name),
    /** Pose Kip in `clip` at `time()` seconds into it, every frame. False if he cannot be (the caller plays the canned clip instead). */
    start(clip: string, time: () => number): boolean {
      if (!host.canStart() || !host.has(clip)) return false;
      const source: BeatSource = () => ({ name: clip, time: time() });
      if (!host.begin(source, GUITAR_LABEL)) return false;
      own = source;
      return true;
    },
    /** Let him go (his arms ease down). Leaves a beat that someone else has taken over alone. */
    stop(): void {
      const mine = own;
      own = null;
      if (mine && host.owns(mine)) host.end();
    },
  };
}
