/**
 * The SHORT prompt a tuned recipe writer would use (docs/specs/forge-ai-spec.md, "Tuning readiness"; runbook scripts/tuning/README.md).
 *
 * The base model needs the 10,000-character prompt in shared/forgeMakePrompt.ts, which teaches the Recipe v1 operations by description. A model trained on gate-verified examples has
 * learned them, so it needs only the task, the answer's shape and the child-safety line. That is also the speed win: the base prompt is about 3,600 tokens of prompt processing on every call.
 *
 * TRAINING AND SERVING MUST BE BYTE-IDENTICAL. scripts/tuning/lib/dataset.ts renders every training example with this function, and worker/forgeMake.ts uses it when the backend says
 * `SELF_TEXT_PROMPT=tuned` (off by default; never for the hosted API). Change the text and the version string below, rebuild the dataset and retrain: a model trained on one prompt and
 * served another is a different model. tests/tuning-prompt.test.ts pins the version to a hash of the text so an edit cannot go unnoticed.
 *
 * Pure: no DOM, no network, no clock. The child's words go in as data inside quotes, exactly as in the base prompt.
 */
import { feedbackLines, quoteWish, type MakeFeedback } from "./forgeMakePrompt";
import type { MakeSlot } from "./forgeMakeLimits";

export const TUNE_PROMPT_VERSION = "t1";

/** What the Worker sends as the system message for our own model (worker/modelBackend.ts askText, reasoning "low"). Training uses the same line. */
export const TUNE_SYSTEM_LINE = "Reasoning strength: low";

const HEAD = `You design ONE small printable accessory for a child's snap-together toy, and name it in seven languages.
Answer with ONE JSON object and nothing else: {"recipe": <a Recipe v1>, "names": {"en": {"w": "..", "g": "m"}, "es": .., "fr": .., "de": .., "it": .., "pt": .., "tr": ..}}.
Keep it kind and safe for a child aged 4 to 10: no brands, no real names, nothing rude or violent.`;

export interface TunePromptArgs {
  text: string;
  slot?: MakeSlot;
  /** A repair: the recipe that did not pass and what the checker said (the same shape as the base prompt's). */
  previous?: unknown;
  feedback?: readonly MakeFeedback[];
}

export function buildTunePrompt(a: TunePromptArgs): string {
  const wish = `Child's wish: "${quoteWish(a.text)}"\nSlot: ${a.slot ?? "choose crown or head"}`;
  const repair =
    a.previous !== undefined && a.feedback && a.feedback.length > 0
      ? `\n\nYour previous recipe:\n${JSON.stringify(a.previous)}\n\nProblems the checker found:\n${feedbackLines(a.feedback)}\n\nReturn a corrected recipe (and the same names) in the same single JSON object.`
      : "";
  return `${HEAD}\n\n${wish}${repair}`;
}

/** The fixed part of the prompt, for the version check in the tests. */
export const TUNE_PROMPT_HEAD = HEAD;
