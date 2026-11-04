// The waiting display of the song card: what it SAYS and how far its bar is while a song is being written and sung (about a minute). Pure, so it is tested without a browser.
//
// HONESTY. Nobody knows how far along Mureka is, so the bar is not a measure: it eases towards done and can never reach it. It only fills completely when the song really is
// ready (the card passes `done`). The words are friendly steps of making a song, in a loop that ends on "Nearly ready", never on a claim that it is finished.

/** Seconds into the wait at which each line begins. The last one stays until the song is ready. */
export const WAIT_STAGES: readonly { at: number; text: string }[] = [
  { at: 0, text: "Thinking of the tune…" },
  { at: 8, text: "Picking the instruments…" },
  { at: 18, text: "Teaching the singer the words…" },
  { at: 30, text: "Adding the drums…" },
  { at: 44, text: "Practising the chorus…" },
  { at: 58, text: "Nearly ready…" },
];

/** The line to show `seconds` into the wait. Negative or not-a-number reads as the start. */
export function waitStage(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  let line = WAIT_STAGES[0]!.text;
  for (const st of WAIT_STAGES) if (s >= st.at) line = st.text;
  return line;
}

/** How full the bar is, 0 to 1. Eases towards `CAP` and never reaches it; `done` (the song really is ready) is the only way to 1. */
export const BAR_CAP = 0.92;
export const BAR_EASE_SECONDS = 35;
export function waitProgress(seconds: number, done = false): number {
  if (done) return 1;
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return BAR_CAP * (1 - Math.exp(-s / BAR_EASE_SECONDS));
}
