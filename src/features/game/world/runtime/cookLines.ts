// The lines the cooking level says out loud (docs/specs/play-design-spec.md, "Activity levels", activity 2: pancakes). One line per beat, the count itself, and the kind answers to a missed flip and a
// plate that already has its pancake. "It's hot" is a grown-up's line: it asks for a grown-up and is never a promise that the pan is safe to touch.
//
// Every line is in the closed list (scripts/lib/scene-prompts-enum.ts reads COOK_PROMPT_LINES; `npx tsx scripts/scene-prompts.ts --check` fails if they drift) and every one is ALSO shown as text (a
// toast, or the card), so a muted game, a device with no audio and a clip that failed to load all still carry the words.
//
// No imports: the enumerator script and the tests read this file without loading the game.

export const COOK_INTRO = "Let's make pancakes!";
export const COOK_CRACK = "Crack the egg!";
export const COOK_POUR = "Pour the batter. Count with me!";
/** The count, said as each spoon goes in: spoon 1 says "One!", spoon 6 says "Six!". */
export const COOK_COUNT: readonly string[] = ["One!", "Two!", "Three!", "Four!", "Five!", "Six!"];
/** The pan is on the heat: a grown-up helps. Said when the batter is in; the card then waits for the grown-up's hold. */
export const COOK_HOT = "The pan is hot! A grown-up helps here.";
export const COOK_HOT_OK = "Thank you! Now flip it.";
export const COOK_FLIP = "Flip it up!";
/** A missed flip, and a flip that went the wrong way: the same kind answer. */
export const COOK_FLIP_AGAIN = "Almost! Flip it again.";
export const COOK_SERVE = "One pancake for each plate.";
/** A pancake put on a plate that already has one. */
export const COOK_SERVE_AGAIN = "One pancake on each plate.";
export const COOK_DONE = "Yummy pancakes! Hooray!";

export const COOK_PROMPT_LINES: readonly string[] = [
  COOK_INTRO, COOK_CRACK, COOK_POUR, ...COOK_COUNT, COOK_HOT, COOK_HOT_OK, COOK_FLIP, COOK_FLIP_AGAIN, COOK_SERVE, COOK_SERVE_AGAIN, COOK_DONE,
];

/** Text only (never spoken, so not in the closed list): the buttons and the counts on the card. */
export const COOK_TEXT = {
  group: "Cook pancakes",
  crack: "Crack it",
  spoon: "Pour a spoon",
  hot: "Grown-up: hold",
  hotAria: "Grown-up: hold this button for about a second to say you are here with the hot pan",
  flip: "Flip it",
  serve: "Serve one",
  /** "Pour 3 spoons" (the target the child counts to), and "2 of 3" as the batter goes in. */
  target: (n: number): string => `Pour ${n} spoon${n === 1 ? "" : "s"}`,
  progress: (k: number, n: number): string => `${k} of ${n}`,
} as const;
