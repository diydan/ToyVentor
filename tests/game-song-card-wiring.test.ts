import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The end-of-level song card and the in-game dance party. Behaviour is covered in the real game by scripts/e2e-game-party.mjs (32 checks, including the MEASURED beat lock),
// the flow by tests/theme-song-flow.test.ts and the party by tests/game-party.test.ts; this file holds the wiring.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("GameCanvas offers the song when a mission is solved", () => {
  const canvas = read("src/features/game/world/GameCanvas.tsx");
  it("raises the offer from the missionSolved handler, with the mission's kind, after the XP is paid", () => {
    const handler = canvas.slice(canvas.indexOf('event.type === "missionSolved"'));
    expect(handler.indexOf("applySolve(")).toBeGreaterThan(0);
    expect(handler.indexOf("offerSongRef.current(type)")).toBeGreaterThan(handler.indexOf("showXpToast"));
  });
  it("is quiet unless the route says it is on, and does not offer over a song or a party already on", () => {
    expect(canvas).toMatch(/phase === "writing" \|\| phase === "making" \|\| phase === "ready" \|\| phase === "dancing"/);
    expect(canvas).toMatch(/void s\.flow\.canMake\(\)\.then\(\(on\) => \{[^\n]*\n\s*if \(!on\) return;/);
  });
  it("counts the tap on the offer as the gesture that lets the song play later", () => {
    expect(canvas).toMatch(/const makeSong = useCallback\(\(\) => \{\s*noteGesture\(\);/);
  });
  it("hands the party the game's own audio context and the engine's dance hooks", () => {
    expect(canvas).toContain("ctx: () => gameAudioCtx()");
    expect(canvas).toContain("engineRef.current?.partyDanceStart(source)");
    expect(canvas).toContain("engineRef.current?.partyAddClips(clips)");
    expect(canvas).toContain("createDanceLibrary(");
    expect(canvas).toContain("engineRef.current?.partyDanceStop()");
    expect(canvas).toContain("engineRef.current?.partyMusicDuck(on)");
  });
  it("ends the party when the Map opens and when the game unmounts, and renders the card", () => {
    expect(canvas).toMatch(/const openMap = useCallback\(\(\) => \{\s*songRef\.current\?\.party\.stop\("stopped"\);/);
    expect(canvas).toMatch(/useEffect\(\(\) => \(\) => \{\s*songRef\.current\?\.party\.stop\("stopped"\);\s*songRef\.current\?\.flow\.cancel\(\);/);
    expect(canvas).toContain("<ThemeSongCard");
    expect(canvas).toMatch(/\{!mapOpen && \(\s*\/\/ the card gives way to the Map[^\n]*\n\s*<ThemeSongCard/);
  });
});

describe("the engine and the world carry the dance hooks", () => {
  it("the world handle starts a beat dance from a source, turns the character to the camera like a celebration, loads dances into the bank, and fades its own music", () => {
    const world = read("src/features/game/world/runtime/world.ts");
    expect(world).toMatch(/partyDanceStart:function\(source: BeatSource\)\{if\(!\(mix&&!reduce&&P\.rig&&mix\.canDrive\(P\.rig\)&&mix\.startBeatSource\(source\)\)\)return false;if\(P\.danceBack==null\)\{P\.danceBack=P\.tface;P\.tface=-Math\.PI\/2\}return true\}/);
    expect(world).toContain("partyAddClips:function(clips: Record<string,BakedClip>){if(mix)mix.addClips(clips)}");
    expect(world).toContain("partyDanceStop:function(){if(mix)mix.stopBeatDance()}");
    expect(world).toMatch(/partyMusicDuck:function\(on: boolean\)\{if\(MUS\.on\)musGain\(on\?0:\(paused\?0:\(sound\?\.7:0\)\),\.4\)\}/);
  });
  it("the engine exposes them and they are safe after dispose", () => {
    const engine = read("src/features/game/world/engine.ts");
    expect(engine).toContain("partyDanceStart: (source) => (disposed ? false : (hooks()?.partyDanceStart?.(source) ?? false))");
    expect(engine).toMatch(/partyAddClips: \(clips\) => \{\s*if \(!disposed\) hooks\(\)\?\.partyAddClips\?\.\(clips\);/);
    expect(engine).toMatch(/partyDanceStop: \(\) => \{\s*if \(!disposed\) hooks\(\)\?\.partyDanceStop\?\.\(\);/);
    expect(engine).toMatch(/partyMusicDuck: \(on\) => \{\s*if \(!disposed\) hooks\(\)\?\.partyMusicDuck\?\.\(on\);/);
  });
});

describe("the card asks only the app's own route and offers nothing to a child it cannot serve", () => {
  const flow = read("src/features/game/world/themeSongFlow.ts");
  it("talks only to /api/theme-song and names no provider", () => {
    expect(flow).toContain('deps.url ?? "/api/theme-song"');
    expect(flow).not.toMatch(/mureka\.ai|api\.meta|authorization|MODEL_API_KEY/i);
  });
  it("sends only the sentence, the kind and one key per tap", () => {
    expect(flow).toContain("JSON.stringify({ description: text, kind, key: newKey() })");
  });
  it("the card has labelled controls and 56 px buttons", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/\.tv-song-make \{[^}]*min-height: 56px;/);
    expect(css).toMatch(/\.tv-song-btn \{\s*min-height: 56px;/);
    expect(read("src/features/game/world/ThemeSongCard.tsx")).toContain('aria-label="No thanks"');
  });
});

describe("the Map's Songs sheet", () => {
  const canvas = read("src/features/game/world/GameCanvas.tsx");
  it("is reached from both Map views, closes the Map when a song starts, and counts the tap as the audio gesture", () => {
    expect(read("src/features/game/world/MapCarousel.tsx")).toContain("onOpenSongs");
    expect(read("src/features/game/world/ExplorerMap.tsx")).toContain("onOpenSongs");
    expect(canvas.match(/onOpenSongs=\{openSongs\}/g)).toHaveLength(2);
    expect(canvas).toMatch(/const startFromSheet = useCallback\(\(begin: \(\) => void\) => \{\s*noteGesture\(\);[\s\S]*?setSongsOpen\(false\);\s*setMapOpen\(false\);\s*begin\(\);/);
  });
  it("makes an idea song with kind 'prompt' and dances a kept one through playKept; the Map always opens on its places", () => {
    expect(canvas).toContain('getSong().flow.start(idea, "prompt")');
    expect(canvas).toContain("getSong().flow.playKept(song)");
    expect(canvas).toMatch(/setSongsOpen\(false\); \/\/ the Map always opens on its places/);
  });
  it("hides the Map while the sheet is open, so the two never stack", () => {
    expect(canvas).toContain('mapOpen && !sleepActive && !songsOpen && mapView === "trail"');
    expect(canvas).toContain('mapOpen && !sleepActive && !songsOpen && mapView === "cards"');
  });
  it("offers only a short closed list of ideas and a short typed one, and keeps typing from moving the toy", () => {
    const sheet = read("src/features/game/world/SongStudioSheet.tsx");
    expect(sheet.match(/\{ emoji: "/g)).toHaveLength(6);
    expect(sheet).toContain("export const MAX_IDEA_CHARS = 60;");
    expect(sheet).toContain("maxLength={MAX_IDEA_CHARS}");
    expect(sheet).toContain("e.stopPropagation(); // typing here must not move the toy");
    expect(sheet).not.toMatch(/mureka|api\.meta|fetch\(/i);
  });
});

describe("our own song-writing model is woken before a song is asked for", () => {
  const read2 = (rel: string) => readFileSync(join(root, rel), "utf8");
  it("the game wakes it when the Songs sheet opens and when the end-of-level offer goes up", () => {
    const canvas = read2("src/features/game/world/GameCanvas.tsx");
    expect(canvas).toMatch(/probe\(true\)\.then\(\(p\) => \{ setSongsAvailable\(p\.enabled\); setSongsQuota\(p\.quota\); \}\);\s*void getSong\(\)\.flow\.warm\(\);/);
    expect(canvas).toMatch(/if \(!on\) return;\s*void s\.flow\.warm\(\);/);
  });
  it("the Describe tab wakes it when the panel opens, and a failure there never stops the panel", () => {
    const tab = read2("parts/kip/viewer/kip-describe-tab.js");
    expect(tab).toMatch(/setCharacterVisible\(false\);\s*theme\?\.warm\(\)\.catch\(\(\) => \{/);
    expect(read2("parts/kip/viewer/kip-theme-song.js")).toContain("await fetchImpl(`${url}/warm`, { method: 'POST', headers: themeHeaders(storage) });");
    for (const f of ["kip-theme-song.js", "kip-describe-tab.js"]) expect(readFileSync(join(root, "public/kip", f)), f).toEqual(readFileSync(join(root, "parts/kip/viewer", f)));
  });
  it("the Worker's warm-up is a POST to /api/theme-song/warm that answers 202 and is handed the runtime's context", () => {
    const worker = read2("worker/themeSong.ts");
    expect(worker).toContain('if (sub === "/warm")');
    expect(read2("worker/index.ts")).toContain("return handleThemeSong(request, env, ctx);");
  });
});
