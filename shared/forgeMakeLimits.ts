/**
 * The few numbers and names text to part shares between the Worker's prompt (shared/forgeMakePrompt.ts) and the browser's loop
 * (shared/forgeMakeFlow.ts). Kept apart on purpose: the browser bundle must not carry the prompt text, and a constant here is read by both.
 * Pure: no imports, no DOM, no network.
 */
/** At most this many model calls for one wish: the first, then up to three repairs (the spec's F1 budget of 4). */
export const MAKE_MAX_CALLS = 4;
export const MAKE_MAX_TEXT_CHARS = 120;
/** What the model may build from words today: the two slots the prompt and the eval cover (a hat, a head). */
export const MAKE_SLOTS = ["crown", "head"] as const;
export type MakeSlot = (typeof MAKE_SLOTS)[number];
