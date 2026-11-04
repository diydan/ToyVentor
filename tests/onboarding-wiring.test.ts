// How the new-player setup is wired into the game (docs/specs/accounts-and-new-user-spec.md section 8). Source checks, because the game's shell is too big to mount in a unit test; the real
// page was driven in headless Chrome (every step, the validation, the shirt colour, the profile, the song request).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_ENTRIES } from "../src/features/game/world/titleEntries";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const canvas = read("src/features/game/world/GameCanvas.tsx");
const title = read("src/features/game/world/TitleMenu.tsx");
const grownUps = read("src/features/game/world/GrownUpsSheet.tsx");
const sheet = read("src/features/game/world/OnboardingSheet.tsx");
const css = read("src/index.css");
const world = read("src/features/game/world/runtime/world.ts");
const engine = read("src/features/game/world/engine.ts");

describe("the title screen", () => {
  it("still has exactly Play, Build and Create; the setup is a small link under them, not a fourth entry", () => {
    expect(TITLE_ENTRIES.map((e) => e.id)).toEqual(["play", "build", "create"]);
    expect(title).toContain("onNewPlayer");
    expect(title).toContain('className="tv-title-new"');
    expect(title).not.toMatch(/data-title-entry="new/);
  });
  it("hides every stage overlay while it is up EXCEPT the setup sheet (else the sheet opens invisibly behind the menu)", () => {
    expect(css).toContain(".tv-host--titled .tv-stage > :not(.tv-stage-canvas-host):not(.tv-title):not(.tv-onb) {");
  });
});

describe("the game opens it", () => {
  it("from the title link, the Grown-Ups sheet and ?onboarding=1, and only those", () => {
    expect(canvas).toContain("onNewPlayer={openOnboarding}");
    expect(canvas.match(/onNewPlayer=\{openOnboarding\}/g)).toHaveLength(2); // the title menu and the Grown-Ups sheet
    expect(canvas).toContain("/[?&]onboarding=1(&|$)/");
    expect(grownUps).toContain("onNewPlayer");
    expect(grownUps).toContain("Set up a new player");
  });
  it("starts the world when the intro begins, paints the shirt through the engine's own paint zone, and asks for the song through the game's song flow as a screened 'prompt'", () => {
    expect(canvas).toContain('if (titleOpen) chooseTitle("play")');
    expect(canvas).toContain('if (op === "enter") { if (titleOpen) chooseTitle("play"); engineRef.current?.goWorld("room"); return; }');
    expect(canvas).toContain("engineRef.current?.onbStage(op, hex);");
    expect(canvas).toContain('startFromSheet(() => void getSong().flow.start(idea, "prompt"))');
    expect(canvas).toContain("<OnboardingSheet");
  });
});

describe("the sheet keeps its promises", () => {
  it("never talks to a server itself: no fetch, no XMLHttpRequest, no sendBeacon; the only storage is the profile on the device", () => {
    expect(sheet).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(sheet).toContain("saveProfile(");
    expect(sheet).not.toMatch(/localStorage\.(set|get)Item/); // everything goes through newPlayer.ts
  });
  it("asks for the song only from a tap and only from the profile's own song idea (null without the grown-up's yes)", () => {
    expect(sheet).toContain("const idea = songIdea(made.profile);");
    expect(sheet).toContain("if (idea) { onHold(true); onSong(idea); }");
    expect(sheet.match(/\bonSong\(idea\)/g)).toHaveLength(1);
  });
  it("shows no price, no buy button and no sign-up field in the tour", () => {
    expect(sheet).not.toMatch(/type="email"|type="tel"|placeholder="[^"]*@/i);
  });
});

describe("the meet-Kip scene reaches the world", () => {
  it("is one hook all the way down: the sheet's onStage, GameCanvas onboardStage, the engine's onbStage, the world's ONBS", () => {
    expect(sheet).toContain("onStage(op:");
    expect(canvas).toContain("onStage={onboardStage}");
    expect(engine).toContain('onbStage: (op: "pile" | "build" | "abort" | "end" | "phonesShow" | "phones" | "phonesOff", hex?: string) => void;');
    expect(engine).toContain("hooks()?.onbStage?.(op, hex);");
    expect(world).toContain("onbStage:function(op,hex){ONBS(op,hex)},");
    expect(world).toContain("function ONBS(op: string,hex?: string){");
  });
  it("the pile paints the shirt itself, turns Kip to the screen, waits for his real STL parts, hides the real Kip until the last part lands, and gives him back on every exit", () => {
    expect(world).toContain("if(hex){S.col.c1=hex;save();buildPlayer(null)}");
    expect(world).toContain("P.face=P.tface=-Math.PI/2;");
    expect(world).toContain('P.rig&&P.rig.stlMode==="stl"'); // his real parts are fetched: no pile of stand-ins
    expect(world).toContain("new T.Mesh(it.o.geometry,it.o.material)"); // every part is a clone sharing the real geometry and material
    expect(world).toContain("P.model.visible=false;blob.visible=false;");
    expect(world).toContain("if(ONBG!==gg||tk2!==ONBT)return;show();"); // a rebuilt or ended scene is never finished by a stale animation
    expect(world).toMatch(/if\(op==="end"\)\{ONBT\+\+;show\(\);dropPhones\(\);return\}/);
    expect(world).toMatch(/if\(op==="abort"\)\{ONBT\+\+;show\(\);return\}/); // closing part-way keeps headphones that are already on
    expect(world).toContain("if(reduce)return;"); // reduced motion: no pile, Kip stays
    expect(world).toContain('if(S.type!=="character")return;'); // only Kip is a pile of parts
  });
  it("the headphones follow his head, turned ear to ear (his forward is +x, so ear to ear is z), and go when the song is over", () => {
    expect(world).toContain("h2.rotation.y=P.root.rotation.y+Math.PI/2");
    expect(world).toContain('if(op==="phonesOff"){dropPhones();return}');
    expect(canvas).toContain('useEffect(() => { if (songFlow?.phase === "over") engineRef.current?.onbStage("phonesOff"); }, [songFlow?.phase]);');
  });
});

describe("the song starts early and the dance waits for the headphones", () => {
  const flow = read("src/features/game/world/themeSongFlow.ts");
  it("the song is asked for at the grown-up's yes (before Kip is built), held from the first moment, and never again at the intro", () => {
    expect(sheet).toContain("if (idea) { onHold(true); onSong(idea); }");
    expect(sheet.match(/\bonSong\(idea\)/g)).toHaveLength(1);
    expect(sheet).not.toMatch(/startIntro = \(\) => \{[^}]*onSong/);
    expect(sheet).toMatch(/const startIntro = \(\) => \{ onIntroStart\(\); setSlide\(0\); go\("intro"\); \};/);
  });
  it("the party is held by the flow (holdParty), released and started by the pickup, and Kip builds himself with no button", () => {
    expect(flow).toContain("if (deps.holdParty?.()) { set({ phase: \"ready\", note: \"Your song is ready!\" }); return; }");
    expect(canvas).toContain("holdParty: () => onboardHoldRef.current,");
    expect(canvas).toContain("onboardHoldRef.current = false;\n    engineRef.current?.onbStage(\"phones\");\n    void getSong().flow.again();");
    expect(sheet).not.toContain("data-onb-build");
    expect(sheet).toContain("buildKip(), 1900");
  });
  it("the headphones button appears only when the song is complete (ready with a measured loop) and Kip is built, and the song card stays out of the way until the dance starts", () => {
    expect(sheet).toContain('const songReady = !!song && song.phase === "ready" && song.loop > 0;');
    expect(sheet).toContain('(step === "intro" || (step === "build" && (scene === "built" || scene === "meet")))');
    expect(canvas).toContain('flow={onboardOpen && songFlow && songFlow.phase !== "dancing" && songFlow.phase !== "over" ? null : songFlow}');
  });
});

