import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Say it" in Create a world: the same microphone controller as the Workshop's Describe & build, mounted in the Create panel. The recording behaviour itself is tested in
// tests/describe-voice.test.ts; this file pins how the panel uses it (source checks, as the other panel wiring tests do) and what it must never do.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const panel = read("src/features/game/world/CreatePanel.tsx");
const css = read("src/index.css");

describe("Create a world: Say it", () => {
  it("loads the Workshop's own voice module on demand (a static /kip file, not a copy of it), and builds the button with the child-facing words", () => {
    expect(panel).toContain('const VOICE_MODULE = "/kip/kip-describe-voice.js"');
    expect(panel).toMatch(/import\(\/\* @vite-ignore \*\/ new URL\(VOICE_MODULE, window\.location\.origin\)\.href\)/);
    expect(panel).toContain('label: "Say it"');
    expect(panel).toContain('actionWord: "Make"');
    expect(panel).toContain('what: "your world"');
  });
  it("puts the words in the text box and NEVER makes a world from a voice: the only thing onText does is set the draft", () => {
    expect(panel).toContain("onText: (words: string) => setDraft(words.slice(0, 160))");
    const voiceBlock = panel.slice(panel.indexOf("mod.createVoiceInput({"), panel.indexOf("voice.node.classList.add"));
    expect(voiceBlock).not.toMatch(/onMake|submit\(|onAction/);
    expect(panel).toContain("maxLength={160}");   // the box's own limit, which the words are cut to
  });
  it("throws a recording away when Make is pressed, and frees the microphone when the panel goes away", () => {
    expect(panel).toMatch(/voiceRef\.current\?\.cancel\(\);[^\n]*\n\s*setVoiceMsg\(""\);\s*\n\s*onMake\(text\)/);
    expect(panel).toMatch(/return \(\) => \{\s*gone = true;\s*voiceRef\.current = null;\s*voice\?\.dispose\(\);/);
  });
  it("shows the browser's own Speak button only when OUR route is off (or the module cannot load); never both, and never before the route has answered", () => {
    expect(panel).toContain('snapshot.micAvailable && sayIt === "off" && (');
    expect(panel).toContain('useState<"checking" | "on" | "off">("checking")');
    expect(panel).toContain('if (!gone) setSayIt(ok ? "on" : "off")');
    expect(panel).toMatch(/catch \{\s*if \(!gone\) setSayIt\("off"\);/);
  });
  it("says what it heard in a live region, and only while Say it is the one in use", () => {
    expect(panel).toMatch(/sayIt === "on" && voiceMsg && \(\s*<p className="tv-cr-voice" role="status" aria-live="polite">/);
  });
  it("has the game's own button look, hides while the controller says hidden, and the module is shipped to /kip", () => {
    expect(css).toMatch(/\.tv-ctl\.kdb-mic\[hidden\] \{ display: none; \}/);
    expect(css).toMatch(/\.tv-ctl\.kdb-mic-on \{[^}]*background: var\(--gold\)/);
    expect(css).toContain(".tv-cr-voicehost { display: contents; }");
    expect(read("scripts/build-kip.ts")).toContain('"viewer/kip-describe-voice.js"');
    expect(readFileSync(join(root, "public/kip/kip-describe-voice.js"))).toEqual(readFileSync(join(root, "parts/kip/viewer/kip-describe-voice.js")));
  });
  it("leaves the engine alone: the world runtime has no part in it and still has its browser-speech fallback", () => {
    const world = read("src/features/game/world/runtime/world.ts");
    expect(world).not.toMatch(/api\/transcribe|kip-describe-voice|createVoiceInput/);
    expect(world).toContain("function crMicStart()");
  });
});
