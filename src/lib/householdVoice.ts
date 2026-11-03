// Saying a household item's name aloud ("cuchara"): the client half of the `h=` key of /api/voice (worker/voice.ts). The order is the one every spoken name
// in the game uses: the Gemini clip, then the device's own voice with an EXPLICIT language tag (so a word spelled the same in two languages cannot be
// mis-detected), and the caller's caption always shows the text either way. With no name in the chosen language yet, it says the English name, in English.
import { householdName, householdSpeech, householdTextHash } from "./householdNames";
import type { LangCode, PropLang } from "./propNames";
import { sayObject } from "./propVoice";
import { getPropLang } from "./propSpeech";

/**
 * The URL of an item's clip in a language, or null when there is no clip to ask for: that language has no name for it (the route would answer 404). The `v` is a
 * fingerprint of the spoken text: a noun a reviewer corrects gets a new URL, so a browser that cached the old clip for a year fetches the new one. (A noun that is
 * spelled the same in another language needs nothing special: the language's lead-in in worker/voice.ts tells the voice which language it is.)
 */
export function householdVoiceUrl(itemId: string, lang: LangCode): string | null {
  const text = householdName(itemId, lang);
  if (!text) return null;
  return `/api/voice?${new URLSearchParams({ lang, h: itemId, v: householdTextHash(text) }).toString()}`;
}

export interface HouseholdSpoken {
  /** "clip" (Gemini; it may still fail later, and then only the caption shows) or "none" (no clip could be asked for: only the caption). */
  via: "clip" | "none";
  /** The caption: what is being said. */
  text: string;
  /** The language it is actually said in (English when the chosen language has no name for the item yet). */
  lang: LangCode;
}

/**
 * Say a household item's name in the player's chosen language (or `opts.lang`). Returns what was said and how, or null when the player chose Off or the id is
 * not a household item. The Garage calls this from its `speakName` hook.
 */
export function speakHouseholdName(itemId: string, opts: { lang?: PropLang; now?: number } = {}): HouseholdSpoken | null {
  const chosen = opts.lang ?? getPropLang();
  if (chosen === "off") return null;
  const speech = householdSpeech(itemId, chosen);
  if (!speech) return null;
  const via = sayObject({ url: householdVoiceUrl(itemId, speech.lang) ?? undefined, lang: speech.lang, text: speech.text }, opts.now);
  return { via, text: speech.text, lang: speech.lang };
}
