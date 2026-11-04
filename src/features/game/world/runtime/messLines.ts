// The lines the Toy Room's mess mini-interactions say out loud (docs/specs/playful-interactions-spec.md, "Spill and clean up" and "Make a mess, clean it up"; Dan, 2026-11-03:
// "Oh no, oh no ... Followed by clean? Clean"). Kip says OH_NO when the juice spills or the toy box tips out, asks CLEAN_Q (the button under it says "Clean"), and says ALL_CLEAN when the
// last of the mess is gone.
//
// They are said through the game's one voice (the Gemini clip, by id, from the closed list src/lib/scenePrompts.json): scripts/lib/scene-prompts-enum.ts reads MESS_PROMPT_LINES, so the
// list has them and `npx tsx scripts/scene-prompts.ts --check` fails if they drift. Every one is ALSO shown as text (the toast, or the prompt button itself), so a muted game, a device
// with no audio and a clip that failed to load all still carry the words.
//
// No imports: the enumerator script and the tests read this file without loading the game.

/** Kip, the moment the mess happens. */
export const OH_NO = "Oh no, oh no!";
/** Kip asks; the child answers with the Clean button. */
export const CLEAN_Q = "Clean?";
/** The last of the mess is gone. */
export const ALL_CLEAN = "All clean! Hooray!";

export const MESS_PROMPT_LINES: readonly string[] = [OH_NO, CLEAN_Q, ALL_CLEAN];

/** The button under the question. */
export const CLEAN_BUTTON = "Clean";

/**
 * The count shown (not spoken: it is not a line in the closed list) as each toy goes back in the box: "1 toy home!", "2 toys home!", then "All 6 toys home!" for the last.
 * Out-of-range numbers are clamped, so a caption is always a plain sentence.
 */
export function countCaption(n: number, total: number): string {
  const t = Math.max(1, Math.floor(total));
  const k = Math.max(1, Math.min(t, Math.floor(Number.isFinite(n) ? n : 1)));
  return k === t ? `All ${t} toys home!` : `${k} toy${k === 1 ? "" : "s"} home!`;
}
