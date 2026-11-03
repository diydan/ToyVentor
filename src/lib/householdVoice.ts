// Saying a household item's name aloud ("cuchara"): the client half of the `h=` key of /api/voice (worker/voice.ts). The order is the one every spoken name
// in the game uses: the Gemini clip, then the device's own voice with an EXPLICIT language tag (so a word spelled the same in two languages cannot be
// mis-detected), and the caller's caption always shows the text either way. With no name in the chosen language yet, it says the English name, in English.
import { householdName, householdSpeech, householdTextHash, spelledInOtherLanguage } from "./householdNames";
import type { LangCode, PropLang } from "./propNames";
import { sayObject } from "./propVoice";
import { getPropLang } from "./propSpeech";

/**
 * The URL of an item's clip in a language, or null when there is no clip to ask for: that language has no name for it (the route would answer 404), or
 * the noun is spelled the same in another language, so the clip voice might speak it in the wrong accent and the device voice (with an explicit language
 * tag) says it instead. The `v` is a fingerprint of the spoken text: a noun a reviewer corrects gets a new URL, so a browser that cached the old clip for
 * a year fetches the new one.
 */
export function householdVoiceUrl(itemId: string, lang: LangCode): string | null {
  const text = householdName(itemId, lang);
  if (!text || spelledInOtherLanguage(text, lang)) return null;
  return `/api/voice?${new URLSearchParams({ lang, h: itemId, v: householdTextHash(text) }).toString()}`;
}

export interface HouseholdSpoken {
  /** "clip" (Gemini, may still fail later and fall back), "device" (the browser's voice), or "none" (only the caption is left). */
  via: "clip" | "device" | "none";
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
