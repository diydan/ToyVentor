// Plays what an object is called, in ONE voice: the Gemini clip from /api/voice (worker/voice.ts, google/gemini-3.8-flash-lite-tts), one cached WAV per
// (language, object, colour). Dan, 2026-11-03: "no phone use (google/gemini-3.8-flash-lite-tts) for everything in the game": there is no fallback to the
// device's own speech voice, so a child hears one voice for every name. If the clip is unavailable (offline, not deployed, model error) nothing is said and the
// on-screen caption, which always shows, carries the name.
import type { ColorKey, LangCode, NounKey } from "./propNames";

export interface SpokenObject {
  /** Vocabulary key; a name with neither this nor `url` has no clip and is only captioned. */
  noun?: NounKey;
  /** A ready-made /api/voice URL for a clip that is not a prop (a household item: see householdVoice.ts); wins over `noun`. */
  url?: string;
  color?: ColorKey | null;
  lang: LangCode;
  /** The caption text. */
  text: string;
}

/** After a failed clip request nothing is requested (or said) for this long before the server is tried again. */
export const SERVER_BACKOFF_MS = 60_000;

let current: HTMLAudioElement | null = null;
let downUntil = 0;

export function voiceUrl(noun: NounKey, color: ColorKey | null | undefined, lang: LangCode): string {
  const q = new URLSearchParams({ lang, n: noun });
  if (color) q.set("c", color);
  return `/api/voice?${q.toString()}`;
}

export function stopObjectVoice(): void {
  if (current) {
    try {
      current.pause();
    } catch {
      // Already stopped.
    }
    current = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // No device speech.
  }
}

/** Test hook: forget a previous failure. */
export function resetVoiceBackoff(): void {
  downUntil = 0;
}

/**
 * Say an object's name with its Gemini clip. Returns "clip" when a clip was started (it may still fail asynchronously, and then nothing is said and the server is
 * left alone for a minute) and "none" when no clip could be asked for (no URL, the server is backed off, no audio on this device): the caller's caption is all
 * there is. Never uses the device's own voice.
 */
export function sayObject(obj: SpokenObject, now: number = Date.now()): "clip" | "none" {
  stopObjectVoice();
  const clipUrl = obj.url ?? (obj.noun ? voiceUrl(obj.noun, obj.color, obj.lang) : null);
  if (clipUrl && now >= downUntil && typeof Audio !== "undefined") {
    try {
      const audio = new Audio(clipUrl);
      current = audio;
      const fail = () => {
        if (current !== audio) return; // a newer tap already replaced this one
        downUntil = Date.now() + SERVER_BACKOFF_MS;
        current = null;
      };
      audio.addEventListener("error", fail, { once: true });
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(fail);
      return "clip";
    } catch {
      // No clip: the caption stands alone.
    }
  }
  return "none";
}

/** Warm the browser cache with the clips a world will need, so the first tap on each object is instant. Fire and forget. */
export function prefetchObjectVoices(items: ReadonlyArray<{ noun: NounKey; color?: ColorKey | null }>, lang: LangCode): void {
  if (typeof fetch === "undefined" || Date.now() < downUntil) return;
  const seen = new Set<string>();
  for (const it of items) {
    const url = voiceUrl(it.noun, it.color, lang);
    if (seen.has(url)) continue;
    seen.add(url);
    fetch(url, { priority: "low" } as RequestInit).catch(() => {});
  }
}
