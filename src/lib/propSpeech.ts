// The "say what it is" setting and the speaking itself. Language is a per-device choice (a kid's, so it is one tap in the
// More menu, not behind the grown-ups gate). Speech uses the browser's own voices (offline, no network, no cost); when the
// device has none, the on-screen caption still shows, so nothing depends on audio working.
import { isPropLang, languageInfo, LANGUAGES, type LangCode, type PropLang } from "./propNames";

export const PROP_LANG_KEY = "toyforge:prop-lang:v1";
export const DEFAULT_PROP_LANG: PropLang = "en";

const listeners = new Set<(lang: PropLang) => void>();

export function getPropLang(): PropLang {
  try {
    const raw = localStorage.getItem(PROP_LANG_KEY);
    return isPropLang(raw) ? raw : DEFAULT_PROP_LANG;
  } catch {
    return DEFAULT_PROP_LANG;
  }
}

export function setPropLang(lang: PropLang): void {
  try {
    localStorage.setItem(PROP_LANG_KEY, lang);
  } catch {
    // Storage unavailable: the choice still holds for this session through the listeners.
  }
  for (const fn of listeners) fn(lang);
}

/** Subscribe to language changes (the picker and the world both listen). Returns the unsubscribe. */
export function onPropLangChange(fn: (lang: PropLang) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function propLangLabel(lang: PropLang): string {
  return lang === "off" ? "Off" : languageInfo(lang).label;
}

export const PROP_LANG_CHOICES: ReadonlyArray<{ value: PropLang; label: string }> = [
  ...LANGUAGES.map((l) => ({ value: l.code as PropLang, label: l.label })),
  { value: "off", label: "Off" },
];

/**
 * Speak a phrase in a language. Cancels anything still being said first, so quick taps never queue up into a long ramble.
 * Returns false when this device cannot speak (no speechSynthesis), so the caller can lean on the caption.
 */
export function speakPhrase(text: string, lang: LangCode): boolean {
  try {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = languageInfo(lang).bcp47;
    u.rate = 0.9; // a little slower and brighter than default, for small ears
    u.pitch = 1.1;
    synth.cancel();
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}
