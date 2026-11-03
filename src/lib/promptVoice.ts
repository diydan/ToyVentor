// Says the Carousel scenes' prompts ("Where does the teddy go?", "Go get the ball.", "All done!") in the ONE voice of the game: the Gemini clip from /api/voice
// (worker/voice.ts, google/gemini-3.8-flash-lite-tts), asked for by the ID of the line in the closed list src/lib/scenePrompts.json. Dan, 2026-11-03: "no phone use
// (google/gemini-3.8-flash-lite-tts) for everything in the game". There is no fallback to the device's own speech voice anywhere: if the clip is unavailable (offline, not
// deployed, model error) nothing is said, the server is left alone for a minute, and the on-screen toast, which always shows, carries the line.
//
// Only a line that is in the list can be spoken, and it has to match EXACTLY: the server takes an ID, never text, so a line the list does not have is not said (and a
// console warning in development says which, so a new prompt gets added to the list: `npx tsx scripts/scene-prompts.ts`).
import { promptIdForText, scenePromptUrl } from "./scenePrompts";

/** After a failed clip request nothing is requested (or said) for this long before the server is tried again. */
export const PROMPT_BACKOFF_MS = 60_000;

let current: HTMLAudioElement | null = null;
let downUntil = 0;

/** Stop the prompt that is playing, if any (a new prompt, a tap on an object, mute, teardown). */
export function stopPrompt(): void {
  if (!current) return;
  const audio = current;
  current = null;
  try {
    audio.pause();
  } catch {
    // Already stopped.
  }
}

/** Test hook: forget a previous failure and whatever is playing. */
export function resetPromptVoice(): void {
  downUntil = 0;
  current = null;
}

/**
 * Say a scene prompt with its Gemini clip. One prompt at a time: a new one stops the one still playing. Returns "clip" when a clip was started (it may still fail
 * asynchronously, and then nothing is said and the server is left alone for a minute) and "none" when nothing was asked for: the text is not in the list, the server is
 * backed off, or there is no audio on this device. Never uses the device's own voice.
 */
export function sayPrompt(text: string, now: number = Date.now()): "clip" | "none" {
  const id = text ? promptIdForText(text) : null;
  if (!id) {
    if (text && isDevelopment()) console.warn(`sayPrompt: "${text}" is not in src/lib/scenePrompts.json, so it is not spoken. Run: npx tsx scripts/scene-prompts.ts`);
    return "none";
  }
  stopPrompt();
  if (now < downUntil || typeof Audio === "undefined") return "none";
  try {
    const audio = new Audio(scenePromptUrl(id));
    current = audio;
    const fail = (e?: unknown) => {
      if (current !== audio) return; // a newer prompt already replaced this one
      current = null;
      // The browser refusing to start a sound without a tap (NotAllowedError) or a pause cutting it off (AbortError) is not the server being down.
      const name = (e as { name?: string } | undefined)?.name;
      if (name === "NotAllowedError" || name === "AbortError") return;
      downUntil = Date.now() + PROMPT_BACKOFF_MS;
    };
    audio.addEventListener("error", () => fail(), { once: true });
    const started = audio.play();
    if (started && typeof started.catch === "function") started.catch(fail);
    return "clip";
  } catch {
    // No clip: the toast stands alone.
    return "none";
  }
}

function isDevelopment(): boolean {
  return Boolean(import.meta.env?.DEV); // undefined outside Vite (the scripts run under tsx), and false in a production build
}
