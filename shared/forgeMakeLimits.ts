/**
 * The few numbers and names text to part shares between the Worker's prompt (shared/forgeMakePrompt.ts) and the browser's loop
 * (shared/forgeMakeFlow.ts). Kept apart on purpose: the browser bundle must not carry the prompt text, and a constant here is read by both.
 * Pure: no imports, no DOM, no network.
 */
/** At most this many model calls for one wish: the first, then up to three repairs (the spec's F1 budget of 4). */
export const MAKE_MAX_CALLS = 4;
export const MAKE_MAX_TEXT_CHARS = 120;
/**
 * Every slot a child (or a panel) may ASK for. Until 2026-11-04 this was only the hat and the head. The vehicle slots (back, front, rollbar, spoiler, hood, roof, exhaust) and the held
 * "prop" (hand: a flat shape on a stick) were added because the optimizer daemon already builds all ten and the production prompt (shared/forgePrompt.ts, SLOT_FACTS) already carries each slot's
 * socket sizes. NOTHING sends them yet: the Kip bench panel asks for crown or head only, and a vehicle panel (the Truck lane) is still to come. Quality on these slots is MEASURED, not assumed:
 * scripts/tuning/slot-probe.ts and its results in scripts/tuning/results/.
 */
export const MAKE_SLOTS = ["crown", "head", "back", "hand", "front", "rollbar", "spoiler", "hood", "roof", "exhaust"] as const;
export type MakeSlot = (typeof MAKE_SLOTS)[number];
/** What the model may CHOOSE between when no slot is asked for ("choose crown or head"): a model that picks anything else for such a wish is refused. */
export const MAKE_CHOICE_SLOTS = ["crown", "head"] as const;
