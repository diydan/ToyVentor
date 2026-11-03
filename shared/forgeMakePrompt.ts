/**
 * The prompt the text-to-part route (worker/forgeMake.ts) sends: the Recipe v1 system prompt (shared/forgePrompt.ts, the same text the eval
 * harness measured) plus the child's wish, the reply envelope (the recipe AND the object's name in seven languages, in one call: Dan's design,
 * docs/specs/forge-ai-spec.md "Naming and the waiting state"), and on a repair the previous recipe with what the checker found.
 *
 * Pure: no DOM, no network, no clock. The words a child typed go in as data inside quotes; the Worker scrubs contact details and refuses unsafe
 * or brand words before this runs, and everything that comes back is validated field by field, so a prompt is never the only safeguard.
 */
import { systemPromptFor, type PromptVersion } from "./forgePrompt";

/** The prompt version the eval harness measured best (tests/forge/golden/prompt-v5.txt). */
export const MAKE_PROMPT_VERSION: PromptVersion = "v5";
/** At most this many model calls for one wish: the first, then up to three repairs (the spec's F1 budget of 4). */
export const MAKE_MAX_CALLS = 4;
export const MAKE_MAX_TEXT_CHARS = 120;
/** What the model may build from words today: the two slots the prompt and the eval cover (a hat, a head). */
export const MAKE_SLOTS = ["crown", "head"] as const;
export type MakeSlot = (typeof MAKE_SLOTS)[number];
export const NAME_LANGS = ["en", "es", "fr", "de", "it", "pt", "tr"] as const;

/** What a repair tells the model about one failed check (the same shape as FeedbackItem in scripts/lib/forgeEvalCore.ts). */
export interface MakeFeedback {
  gate: string;
  measured?: number | string;
  limit?: string;
  hint: string;
}

const ENVELOPE = `Answer with ONE JSON object with exactly two keys and nothing else: {"recipe": <the Recipe v1 described above>, "names": {"en": {"w": "..", "g": "m"}, "es": {"w": "..", "g": "m"}, "fr": .., "de": .., "it": .., "pt": .., "tr": ..}}.
"names" says what the object is, as a child would name it, in each of en, es, fr, de, it, pt and tr: a short noun phrase of one to three words, with no colour in it (the colour is added later) and none of the child's own sentence. Each entry is {"w": the words, "g": "m", "f" or "n" for the noun's grammatical gender in that language, "pl": true only when the name is plural}. English and Turkish always use "m". Spanish, French, Italian and Portuguese have no "n". Spell every name correctly for its language, with its accents and special letters (for example "chapéu", "şapka", "Zauberhut"), using letters only: no digits, symbols or emoji.`;

/** The child's words as one quoted line: control characters out, whitespace collapsed, double quotes softened, capped. */
export function quoteWish(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAKE_MAX_TEXT_CHARS);
}

export function feedbackLines(feedback: readonly MakeFeedback[]): string {
  return feedback
    .map((f) => `- ${f.gate}${f.measured !== undefined ? ` (measured ${f.measured})` : ""}${f.limit ? ` (limit ${f.limit})` : ""}: ${f.hint}`)
    .join("\n");
}

export interface MakePromptArgs {
  /** What the child typed (already scrubbed and checked by the Worker). */
  text: string;
  /** Left out: the model chooses between a hat (crown) and a head. */
  slot?: MakeSlot;
  /** A repair: the recipe that did not pass and what the checker said. */
  previous?: unknown;
  feedback?: readonly MakeFeedback[];
}

export function buildMakePrompt(a: MakePromptArgs): string {
  const wish = `Child's wish: "${quoteWish(a.text)}"\nSlot: ${a.slot ?? "choose crown (a hat that sits on a head) or head (a character's head)"}`;
  const repair =
    a.previous !== undefined && a.feedback && a.feedback.length > 0
      ? `\n\nYour previous recipe:\n${JSON.stringify(a.previous)}\n\nProblems the checker found:\n${feedbackLines(a.feedback)}\n\nReturn a corrected recipe (and the same names) in the same single JSON object.`
      : "";
  return `${systemPromptFor(MAKE_PROMPT_VERSION)}\n\n${wish}${repair}\n\n${ENVELOPE}`;
}
