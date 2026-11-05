// How the new-player setup is wired into the game (docs/specs/accounts-and-new-user-spec.md section 8). Source checks, because the game's shell is too big to mount in a unit test; the real
// page was driven in headless Chrome (every step, the validation, the shirt colour, the profile, the song request).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_ENTRIES } from "../src/features/game/world/titleEntries";
import { PROGRESS_EVENT, TAP_IDLE_AFTER_TAP_MS, TAP_IDLE_MS } from "../src/features/game/world/OnboardingSheet";

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
    expect(canvas).toContain('if (op === "enter") { engineRef.current.onbStage("hide"); if (titleOpen) chooseTitle("play"); engineRef.current.goWorld("room"); return true; }');
    expect(canvas).toContain("engineRef.current.onbStage(op, hex);");
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
    expect(sheet).toContain("const idea = songIdea(made.profile, cleanKipConfig(cfg) ?? defaultKipConfig(colourOf(colour)?.hex));");
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
    expect(engine).toContain('onbStage: (op: "hide" | "dress" | "pile" | "build" | "abort" | "end" | "phonesShow" | "phones" | "phonesOff", hex?: string) => void;');
    expect(engine).toContain("hooks()?.onbStage?.(op, hex);");
    expect(world).toContain("onbStage:function(op,hex){ONBS(op,hex)},");
    expect(world).toContain("function ONBS(op: string,hex?: string){");
  });
  it("the pile paints the shirt itself, turns Kip to the screen, waits for his real STL parts, hides the real Kip until the last part lands, and gives him back on every exit", () => {
    expect(world).toContain("save();buildPlayer(null)}"); // the shirt (and, with the outfit, the rest) is saved and the rig rebuilt before he is laid out
    expect(world).toContain("P.face=P.tface=-Math.PI/2;");
    expect(world).toContain('P.rig&&P.rig.stlMode==="stl"'); // his real parts are fetched: no pile of stand-ins
    expect(world).toContain("new T.Mesh(it.o.geometry,it.o.material)"); // every part is a clone sharing the real geometry and material
    expect(world).toContain("P.model.visible=false;blob.visible=false;");
    expect(world).toContain("if(ONBG!==gg||tk2!==ONBT)return;show();"); // a rebuilt or ended scene is never finished by a stale animation
    expect(world).toMatch(/if\(op==="end"\)\{ONBT\+\+;ONBPRE=null;show\(\);dropPhones\(\);return\}/);
    expect(world).toMatch(/if\(op==="abort"\)\{ONBT\+\+;var pre=ONBD\?ONBPRE:null;ONBPRE=null;show\(\);.*return\}/); // closing part-way keeps headphones that are already on (dropPhones is only in "end")
    expect(world).toContain("if(reduce)return;"); // reduced motion: no pile, Kip stays
    expect(world).toContain('if(S.type!=="character")return;'); // only Kip is a pile of parts
  });
  it("the headphones follow his head, turned ear to ear (his forward is +x, so ear to ear is z), and go when the song is over", () => {
    expect(world).toContain("h2.rotation.y+=(P.root.rotation.y+Math.PI/2-h2.rotation.y)*Math.min(1,k)"); // turned ear to ear on the way (his forward is +x), then the head carries them
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
    // "Build it for me" is an optional shortcut: nothing waits for it, Kip still builds himself after a short idle
    expect(sheet).toContain("buildKip(), placed > 0 ? TAP_IDLE_AFTER_TAP_MS : TAP_IDLE_MS");
    expect(TAP_IDLE_MS).toBeLessThanOrEqual(6000);
    expect(TAP_IDLE_AFTER_TAP_MS).toBeLessThanOrEqual(TAP_IDLE_MS);
  });
  it("the headphones button appears only when the song is complete (ready with a measured loop) and Kip is built, and the song card stays out of the way until the dance starts", () => {
    expect(sheet).toContain('const songReady = !!song && song.phase === "ready" && song.loop > 0;');
    expect(sheet).toContain('(step === "intro" || (step === "build" && (scene === "built" || scene === "meet")))');
    expect(canvas).toContain('flow={onboardOpen && songFlow && songFlow.phase !== "dancing" && songFlow.phase !== "over" ? null : songFlow}');
  });
});

describe("no Kip before the pile, headphones on the head, no hovering dance", () => {
  const idle = read("src/features/game/world/runtime/idleBehavior.ts");
  it("Kip is hidden from the first frame of the build step and held hidden every frame until the last part lands", () => {
    expect(canvas).toContain('engineRef.current.onbStage("hide"); if (titleOpen) chooseTitle("play");');
    expect(world).toContain('if(op==="hide"){ONBW=true;if(P.model)P.model.visible=false;blob.visible=false;return}');
    expect(world).toContain(" IDLEB.update();\n if(ONBW){if(P.model)P.model.visible=false;blob.visible=false;if(W.root)W.root.visible=false}\n"); // enforced every frame (Kip and the Toy Room), so a rebuilt model or room is never seen
    expect(world).toContain("var show=function(){ONBW=false;"); // and every way out (build done, abort, end) gives him back
    expect(world).toContain("ONBGH=null}ONBW=true;if(hex){save();buildPlayer(null)}"); // the pile keeps him hidden: no show() between the hide and the last part
    expect(world).toContain("if(reduce){show();return}"); // reduced motion: no pile, so he must not stay hidden
  });
  it("the headphones are parented to the head the dance moves (the highest sizeable mesh's parent), and the floating bob stops when the pickup starts", () => {
    expect(world).toContain("(top&&top.parent?top.parent:head).attach(h2);");
    expect(world).toContain("hp.userData.flying=true;");
    expect(world).toContain("h.userData.worn||h.userData.flying");
  });
  it("the Samba (no foot grounding, hovers) is only the fallback: the party list, the idle pick and the win dance prefer the baked dances", () => {
    expect(canvas).toContain('baked = all.filter((d) => d.id !== "dance"); return baked.length ? baked : all;');
    expect(idle).toContain("bakedDances.length ? bakedDances : [SAMBA_CLIP]");
    expect(world).toContain('var dancing=mixGo("dance_silly" as MixAction)||mixGo("dance");');
  });
});



describe("the build starts in a workshop with a blueprint", () => {
  it("the workshop dressing is built when the pile is laid out, replaces the Toy Room while the build holds, and goes (with the room coming back) on every exit", () => {
    expect(world).toContain('import { buildWorkshop, disposeWorkshop } from "./workshopScene";');
    expect(world).toContain("if(!ONBK){ONBK=buildWorkshop({x:P.pos.x,z:P.pos.z,accent:S.col.c1});scene.add(ONBK)}");
    expect(world).toContain("var show=function(){ONBW=false;ONBD=false;if(ONBGH){if(ONBGH.parent)ONBGH.parent.remove(ONBGH);ONBGH=null}if(ONBK){disposeWorkshop(ONBK);ONBK=null}if(W.root)W.root.visible=true;");
  });
});

describe("the avatar", () => {
  it("gets no picture while Kip is held hidden for the build (it would be an empty scene, kept under a colour signature), so the avatar's poll waits and takes it when he is built", () => {
    expect(world).toContain("portraitSig:function(){return P.rigReady&&!ONBW&&!ONBD?String(P.rigSig):null},");
  });
});

describe("dress your Kip", () => {
  it("is a step of its own between the favourites and the song; the shirt starts as the favourite colour; the whole outfit goes to the world as one JSON object when the pile is laid out", () => {
    expect(sheet).toContain('{step === "dress" && (');
    expect(sheet).toContain("setCfg((c) => ({ ...c, shirt: colourOf(colour)?.hex ?? c.shirt }));");
    expect(sheet).toContain('const outfit = () => JSON.stringify(cleanKipConfig(cfg) ?? defaultKipConfig(colourOf(colour)?.hex));');
    expect(sheet).toContain('onStage("pile", outfit());');
    expect(sheet).toContain("<KipPreview cfg={cfg} />"); // a live preview, so a pick is seen at once
    expect(sheet).toContain('<Tiles label="Shoes" items={SHOE_COLOURS}');
  });
  it("the world applies only valid hex colours and plain strings, sets the colours, hair, hat and tail on the saved character, and rebuilds him", () => {
    expect(world).toContain('if(hex.charAt(0)==="{"){try{cf=JSON.parse(hex)}catch(e){cf=null}}');
    expect(world).toContain("function onbOutfit(hex: string): boolean{"); // one helper for the pile and the Dress step
    expect(world).toContain("/^#[0-9a-f]{6}$/i.test(v)");
    expect(world).toContain("S.col.c1=qq;");
    expect(world).toContain("S.col.c2=qq;");
    expect(world).toContain("S.col.boots=qq;");
    expect(world).toContain("S.col.skin=qq;");
    expect(world).toContain("S.col.hair=qq;");
    // the hair style, hat and tail are the CHARACTER's slots (cur() = S.sel.character): the first version wrote S.sel.hair/hat/tail, where nothing reads them, so those picks never reached the real Kip
    expect(world).toContain("sl.hair=cf.hair;");
    expect(world).toContain("sl.hat=cf.hat;");
    expect(world).toContain("sl.tail=cf.tail}");
    expect(world).not.toContain("S.sel.hair=cf.hair");
    expect(world).toContain("else if((qq=hexOk(hex)))S.col.c1=qq;"); // a plain hex is still just the shirt, and only a valid one
    expect(world).toContain("var chg=hex?onbOutfit(hex):false;"); // the pile applies the outfit through the same helper, and the Dress step does too (chd)
    expect(world).toContain("var chd=onbOutfit(hex||\"\");");
  });
});


describe("the Dress step shows the real Kip (kid bench, spec section 9)", () => {
  const canvas = readFileSync(new URL("../src/features/game/world/GameCanvas.tsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../src/features/game/world/engine.ts", import.meta.url), "utf8");
  it("the sheet enters the workshop when Dress opens, sends the outfit on every pick, and the build step does not enter again", () => {
    expect(sheet).toContain('if (onStage("enter") === false) { setEngineOk(false); return; }');
    expect(sheet).toContain('const t = window.setTimeout(() => onStage("dress", outfit()), 40);');
    expect(sheet).toContain("}, [step, live, cfg]);");
    expect(sheet).toContain("const there = staged.current;");
    expect(sheet).toContain('if (!there) onStage("enter");');
    expect(sheet).toContain("}, there ? 350 : 1700);");
  });
  it("Back from Dress, closing the sheet and Back from the build all take the workshop away (the world restores the old look when it is still the Dress step)", () => {
    expect(sheet).toContain('const backFromDress = () => { onStage("abort"); staged.current = false; setLive(false); back(); };');
    expect(sheet).toContain('useEffect(() => () => { if (laid.current || staged.current) onStage("abort"); }, []);');
    expect(sheet).toContain('const backFromBuild = () => { onStage("abort"); laid.current = false; staged.current = false; back(); };');
    expect(world).toContain('if(op==="abort"){ONBT++;var pre=ONBD?ONBPRE:null;ONBPRE=null;show();');
  });
  it("the plain-blocks preview stays only when there is no game to show Kip in; the stage styling is on only when there is", () => {
    expect(sheet).toContain("{!engineOk && <KipPreview cfg={cfg} />}");
    expect(sheet).toContain("const stageDress = step === \"dress\" && engineOk;");
    expect(sheet).toContain('${stageDress ? " tv-onb-dressing" : ""}');
    expect(canvas).toContain("if (!engineRef.current) return false; // no game to show it in");
    expect(canvas).toContain('"enter" | "dress" | "pile" | "build" | "abort" | "end" | "phonesShow"');
    expect(engine).toContain('"hide" | "dress" | "pile"');
  });
  it("the Dress step lays a PILE of Kip's real parts, not a standing Kip (Dan, 2026-11-05: we still don't start with a pile of bricks): Kip and the Toy Room stay hidden all through it, and every pick re-lays the pile", () => {
    expect(world).toContain("ONBD=true;ONBW=true}"); // the Dress step holds the stage hidden, like the pile
    expect(world).toContain("if(chd){save();buildPlayer(null);if(!first)sfx.pop()}\n  if(first||chd||!ONBG)onbLay();");
    expect(world).not.toContain("else if(ONBD){if(W.root)W.root.visible=false;var rdy=");   // no standing Kip is ever shown in Dress
    expect(world).not.toContain("ONBGH=old");
    expect(world).toContain("ONBPRE={col:{c1:S.col.c1,c2:S.col.c2,boots:S.col.boots,skin:S.col.skin,hair:S.col.hair},sel:{hair:sl1.hair,hat:sl1.hat,tail:sl1.tail}};");
    expect(world).toContain("portraitSig:function(){return P.rigReady&&!ONBW&&!ONBD?String(P.rigSig):null},");
  });
  it("one lay function makes the pile: a newer lay cancels an older one, the old pile stays until the new is ready, and the layout depends only on a part's place in the rig (a colour change moves no brick)", () => {
    expect(world).toContain("function onbLay(){");
    expect(world).toContain("if(tk!==ONBL||ot!==ONBT||!ONBW)return;");
    expect(world).toContain("var oldG=ONBG;ONBG=g;scene.add(g);if(oldG&&oldG.parent)oldG.parent.remove(oldG);");
    expect(world).toContain("a=i*2.399,r=.25+((i*37)%10)/10*.95;");
    expect(world.split("onbLay()").length - 1).toBeGreaterThanOrEqual(3);                        // the function and its two callers
  });
  it("the Dress card is one row of tiles at a time, with the shoes row and every pick named as before", () => {
    for (const part of ["shirt", "pants", "boots", "skin", "hair", "hairColour", "hat", "tail"]) expect(sheet).toContain(`part === "${part}" &&`);
    expect(sheet).toContain('<Tiles label="Shoes" items={SHOE_COLOURS}');
  });
});

describe("tap-to-build (kid bench slice 2)", () => {
  it("a tap on the stage during the pile or Dress is the setup's: a part, or nothing, never a walk", () => {
    expect(world).toContain('canvas.addEventListener("pointerdown",function(e: PointerEvent){ctx();IDLEB.cancel();if(ONBG||ONBD){ONBTAP(e);return}');
  });
  it("a tapped part (or the nearest to the ray within half a unit) is carried to its seat, reported through the window event, and the last one is the build's own arrival", () => {
    expect(world).toContain("function onbPlace(gg: any,it: any){");
    expect(world).toContain('window.dispatchEvent(new CustomEvent("tv-onb-progress",{detail:{placed:placed,total:seats.length,done:all}}));');
    expect(world).toContain('if(all)ONBS("finish")})}');
    expect(world).toContain("var best=.55;open.forEach(");
    expect(world).toContain('if(op==="finish"){if(!ONBG)return;show();burst(');
    expect(PROGRESS_EVENT).toBe("tv-onb-progress");
  });
  it("the build op carries only the parts not yet seated, stops the taps, and still finishes when none is left", () => {
    expect(world).toContain("gg.userData.running=true;");
    expect(world).toContain("var seats2=gg.userData.seats.filter(function(s: any){return !s.done&&!s.fly}),n=seats2.length,TOT=n>0?Math.max(1.4,Math.min(3.4,.9+.15*n)):.2,");
  });
  it("the sheet listens for the progress, counts it, and a finished pile shows the built Kip", () => {
    expect(sheet).toContain("window.addEventListener(PROGRESS_EVENT, on);");
    expect(sheet).toContain('if (d.done) setScene("built");');
    expect(sheet).toContain("}, [scene, placed]);");
    expect(sheet).toContain("onClick={buildKip} data-onb-build");
  });
});
