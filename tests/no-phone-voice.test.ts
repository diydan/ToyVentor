import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Dan, 2026-11-03: "no phone use (google/gemini-3.8-flash-lite-tts) for everything in the game". The game has ONE voice, the Gemini clip from /api/voice; the phone's own
 * speech engine (the Web Speech API's speechSynthesis) is not used anywhere. This reads the source and fails on any mention of it, so it cannot come back unnoticed.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src", "worker", "shared", "parts/kip/viewer"]; // the game, the Worker, what they share, and the Kip bench's own scripts
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const PHONE_VOICE = /speechSynthesis|SpeechSynthesis|SpeechSynthesisUtterance|webkitSpeechSynthesis|\bgetVoices\s*\(/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SOURCE.test(name)) yield path;
  }
}

/** The files that mention the phone's speech engine, as `path:line`. */
function phoneVoiceMentions(files: Iterable<string>, read: (p: string) => string = (p) => readFileSync(p, "utf8")): string[] {
  const out: string[] = [];
  for (const file of files) {
    read(file).split("\n").forEach((text, i) => {
      if (PHONE_VOICE.test(text)) out.push(`${relative(ROOT, file)}:${i + 1}: ${text.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe("no phone voice anywhere in the game", () => {
  const files = DIRS.flatMap((d) => [...walk(join(ROOT, d))]);

  it("looks at the whole game (the scan cannot pass by finding nothing to read)", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const must of ["src/features/game/world/runtime/audio.ts", "src/lib/propVoice.ts", "src/lib/promptVoice.ts", "worker/voice.ts", "shared/songParty.ts", "parts/kip/viewer/kip-menu.js"]) {
      expect(files.map((f) => relative(ROOT, f)), must).toContain(must);
    }
  });

  it("mentions neither speechSynthesis nor an utterance nor the phone's voice list in src/, worker/, shared/ or the Kip bench", () => {
    expect(phoneVoiceMentions(files)).toEqual([]);
  });

  it("the scan itself catches each way of reaching the phone's engine", () => {
    const sources: Record<string, string> = {
      "a.ts": "const s = window.speechSynthesis;",
      "b.ts": "new SpeechSynthesisUtterance(text)",
      "c.js": "globalThis['speechSynthesis'].speak(u)",
      "d.ts": "const v = synth.getVoices();",
      "e.ts": "window.webkitSpeechSynthesis",
      "f.ts": "const ok = 1; // fine\nconst bad = SPEECHSYNTHESIS;",
      "g.ts": "const clip = new Audio('/api/voice?s=x');",
    };
    const found = phoneVoiceMentions(Object.keys(sources).map((f) => join(ROOT, f)), (p) => sources[relative(ROOT, p)]!);
    expect(found.map((f) => f.split(":")[0])).toEqual(["a.ts", "b.ts", "c.js", "d.ts", "e.ts", "f.ts"]);
    expect(found.find((f) => f.startsWith("f.ts"))).toContain("f.ts:2:");
  });
});
