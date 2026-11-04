// The lines the cleaning level says out loud (docs/specs/play-design-spec.md, "Activity levels", activity 1). The three framing lines are the Toy Room mess's own (messLines.ts: "Oh no, oh no!",
// "Clean?", "All clean! Hooray!"), so they are not repeated here. What this adds is the answer to a wrong tool, which used to be a toast in the Clean mission (CWHY in catalog.ts) and is now ALSO
// spoken, plus the soap step of the sticky jam.
//
// Every line is in the closed list (scripts/lib/scene-prompts-enum.ts reads CLEAN_PROMPT_LINES; `npx tsx scripts/scene-prompts.ts --check` fails if they drift) and every one is ALSO shown as text
// (a toast), so a muted game, a device with no audio and a clip that failed to load all still carry the words. The wrong-tool lines are kept word for word equal to CWHY (tests/clean-model.test.ts
// fails if they drift apart), so the mission and the level teach the same thing.
//
// No imports: the enumerator script and the tests read this file without loading the game.

/** "<tool in hand>><mess>" -> why that tool does not fit. */
export const CLEAN_WRONG_LINES: Readonly<Record<string, string>> = {
  "mop>crumbs": "Mopping crumbs just makes mush. Dry crumbs need the vacuum.",
  "sponge>crumbs": "Crumbs stick to the sponge. Dry crumbs need the vacuum.",
  "vacuum>puddle": "Vacuums are for dry things. A puddle is a liquid, so use the mop.",
  "sponge>puddle": "The sponge fills up fast. A big puddle needs the mop.",
  "vacuum>jam": "Jam is too sticky to suck up. Soap and water break sticky things apart.",
  "mop>jam": "The mop just smears sticky jam. Try the soapy sponge.",
};

/** The sponge on jam before the soapy water is mixed. */
export const SOAP_FIRST = "Mix the soapy water first.";
/** Mixed with too little soap, and with too much (band 3 up: the soap window). */
export const SOAP_LOW = "Not enough soap: the water would slide off the jam.";
export const SOAP_HIGH = "Too much soap makes slippery suds. Pour it out and try again.";
/** Shown, not spoken (it is the mission's own toast): the soap is right. */
export const SOAP_OK = "Perfect soapy water! Now clean the sticky jam.";

export const CLEAN_PROMPT_LINES: readonly string[] = [...Object.values(CLEAN_WRONG_LINES), SOAP_FIRST, SOAP_LOW, SOAP_HIGH];

/** Text only (never spoken, so not in the closed list): the buttons and the hints under them. */
export const CLEAN_TEXT = {
  cleanIt: "Clean it",
  pickTool: "Pick a tool first.",
  rubIt: "Rub it clean!",
  addSoap: "Add soap",
  mixSoap: "Mix the soap",
  pourOut: "Pour it out",
  mix: "Mix",
  tools: "Tools",
  /** What the card's buttons say (short, so the whole card is one row and stays out of the mess's way); the full names are their accessible names. */
  vacuum: "Vacuum",
  mop: "Mop",
  sponge: "Sponge",
  spongeFull: "Soapy sponge",
  group: "Clean up",
} as const;
