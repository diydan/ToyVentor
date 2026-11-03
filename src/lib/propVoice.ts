// Plays what an object is called. Preferred voice: the Gemini clip from /api/voice (worker/voice.ts), one cached WAV per
// (language, object, colour). If that is unavailable (offline, not deployed, model error) it falls back to the device's own
// speech voice, and the on-screen caption always shows either way, so nothing depends on any of this working.
import type { ColorKey, LangCode, NounKey } from "./propNames";
import { speakPhrase } from "./propSpeech";

export interface SpokenObject {
  /** Vocabulary key; absent for free-text (generated) names, which only the device voice can say. */
  noun?: NounKey;
  /** A ready-made /api/voice URL for a clip that is not a prop (a household item: see householdVoice.ts); wins over `noun`. */
  url?: string;
  color?: ColorKey | null;
  lang: LangCode;
  /** The caption / device-voice text. */
  text: string;
}

/** A failed clip request switches to the device voice for this long before the server is tried again. */
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
 * Say an object's name. Returns which voice was used: "clip" (Gemini, may still fail asynchronously and then falls back),
 * "device" (the browser's voice), or "none" (nothing could speak; the caller's caption is all there is).
 */
export function sayObject(obj: SpokenObject, now: number = Date.now()): "clip" | "device" | "none" {
  stopObjectVoice();
  const fallback = () => speakPhrase(obj.text, obj.lang);
  const clipUrl = obj.url ?? (obj.noun ? voiceUrl(obj.noun, obj.color, obj.lang) : null);
  if (clipUrl && now >= downUntil && typeof Audio !== "undefined") {
    try {
      const audio = new Audio(clipUrl);
      current = audio;
      const fail = () => {
        if (current !== audio) return; // a newer tap already replaced this one
        downUntil = Date.now() + SERVER_BACKOFF_MS;
        current = null;
        fallback();
      };
      audio.addEventListener("error", fail, { once: true });
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(fail);
      return "clip";
    } catch {
      // Fall through to the device voice.
    }
  }
  return fallback() ? "device" : "none";
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
