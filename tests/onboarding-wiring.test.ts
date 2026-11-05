// How the new-player setup is wired into the game (docs/specs/accounts-and-new-user-spec.md section 8). Source checks, because the game's shell is too big to mount in a unit test; the real
// page was driven in headless Chrome (every step, the validation, the shirt colour, the profile, the song request).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_ENTRIES } from "../src/features/game/world/titleEntries";
import { BUILD_DONE_MS, GRAB_EVENT, GRAB_MAX_MS, PROGRESS_EVENT, TAP_IDLE_AFTER_TAP_MS, TAP_IDLE_MS } from "../src/features/game/world/OnboardingSheet";

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
    expect(engine).toContain('onbStage: (op: "hide" | "dress" | "pile" | "build" | "land" | "abort" | "end" | "phonesShow" | "phones" | "phonesOff", hex?: string) => void;');
    expect(engine).toContain("hooks()?.onbStage?.(op, hex);");
    expect(world).toContain("onbStage:function(op,hex){ONBS(op,hex)},");
    expect(world).toContain("function ONBS(op: string,hex?: string){");
  });
  it("the pile paints the shirt itself, turns Kip to the screen, waits for his real STL parts, keeps the real Kip hidden until he arrives, and gives him back on every exit", () => {
    expect(world).toContain("save();buildPlayer(null)}"); // the stock look is saved and the rig rebuilt before he is laid out
    expect(world).toContain("P.face=P.tface=-Math.PI/2;");
    expect(world).toContain('P.rig&&P.rig.stlMode==="stl"'); // his real parts are fetched: no pile of stand-ins
    expect(world).toContain("new T.Mesh(it.o.geometry,it.o.material)"); // every part is a clone sharing the real geometry and material
    expect(world).toContain("P.model.visible=false;blob.visible=false;");
    expect(world).toContain("if(gg&&(ONBG!==gg||tk!==ONBT))return;"); // a rebuilt or ended scene is never finished by a stale animation
    expect(world).toMatch(/if\(op==="end"\)\{ONBT\+\+;ONBPRE=null;show\(\);dropPhones\(\);return\}/);
    expect(world).toMatch(/if\(op==="abort"\)\{ONBT\+\+;var pre=ONBPRE;ONBPRE=null;show\(\);.*return\}/); // closing part-way keeps headphones that are already on (dropPhones is only in "end"), and puts the look back
    expect(world).toContain("if(reduce){onbArrive(null,ONBT,0);return}"); // reduced motion: no pile and no flights, he stands on the table at once
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
  it("the song is asked for at the grown-up's yes (after Kip is dressed, so it carries what he wears), held from the first moment, never again at the intro, and the yes ends the stage", () => {
    expect(sheet).toContain("if (idea) { onHold(true); onSong(idea); }");
    expect(sheet.match(/\bonSong\(idea\)/g)).toHaveLength(1);
    expect(sheet).not.toMatch(/startIntro = \(\) => \{[^}]*onSong/);
    expect(sheet).toContain('onStage("land"); laid.current = false; staged.current = false; built.current = false;');
    expect(sheet).toMatch(/const startIntro = \(\) => \{ onIntroStart\(\); setSlide\(0\); setIntroPart\("tour"\); \};/);
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
    expect(sheet).toContain('const phonesOk = songReady && step === "intro";');
    expect(canvas).toContain('flow={onboardOpen && songFlow && songFlow.phase !== "dancing" && songFlow.phase !== "over" ? null : songFlow}');
  });
});

describe("no Kip before the pile, headphones on the head, no hovering dance", () => {
  const idle = read("src/features/game/world/runtime/idleBehavior.ts");
  it("Kip is hidden from the first frame of the build step and held hidden every frame until he arrives on the turntable, then shown only once his parts have loaded", () => {
    expect(canvas).toContain('engineRef.current.onbStage("hide"); if (titleOpen) chooseTitle("play");');
    expect(world).toContain('if(op==="hide"){ONBW=true;if(P.model)P.model.visible=false;blob.visible=false;return}');
    expect(world).toContain(" IDLEB.update();\n if(ONBW){var rdy=ONBV&&!!P.rigReady;if(P.model)P.model.visible=rdy;blob.visible=rdy||(ONBV&&!!ONBGH);"); // enforced every frame (Kip and the Toy Room), so a rebuilt model or room is never seen
    expect(world).toContain("var show=function(){var hd=BG.cancel();if(hd)ONBDONE(hd,false);ONBFOCUS=null;ONBW=false;ONBV=false;ONBY=0;ONBLAND=false;"); // and every way out (land, abort, end) gives him back (and lets go of a brick in the hand)
    expect(world).toContain("ONBW=true;ONBY=TURNTABLE.top;if(hex){onbOutfit(hex);save();buildPlayer(null)}"); // the pile keeps him hidden: no show() between the hide and the arrival
    expect(world).toContain("function idleOk(){return !disposed&&!reduce&&!ONBW&&"); // no idle gesture while the stage holds
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
    expect(world).toContain('import { blueprintRegion, buildWorkshop, disposeWorkshop, regionFractions, setBlueprintState, type BrickPart } from "./workshopScene";');
    expect(world).toContain("if(!ONBK){ONBK=buildWorkshop({x:P.pos.x,z:P.pos.z,accent:S.col.c1});scene.add(ONBK)}");
    expect(world).toContain("ONBW=false;ONBV=false;ONBY=0;ONBLAND=false;if(ONBGH){if(ONBGH.parent)ONBGH.parent.remove(ONBGH);ONBGH=null}if(ONBK){disposeWorkshop(ONBK);ONBK=null}if(W.root)W.root.visible=true;");
  });
});

describe("the avatar", () => {
  it("gets no picture while Kip is held hidden for the build (it would be an empty scene, kept under a colour signature), so the avatar's poll waits and takes it when he is built", () => {
    expect(world).toContain("portraitSig:function(){return P.rigReady&&!ONBW?String(P.rigSig):null},");
  });
});

describe("dress your Kip", () => {
  it("is a step of its own AFTER the build and before the song; the shirt starts as the favourite colour; the pile is the stock look and the picks go on the built Kip as one JSON object", () => {
    expect(sheet).toContain('{step === "dress" && (');
    expect(sheet).toContain("setCfg((c) => ({ ...c, shirt: colourOf(colour)?.hex ?? c.shirt }));");
    expect(sheet).toContain('const outfit = () => JSON.stringify(cleanKipConfig(cfg) ?? defaultKipConfig(colourOf(colour)?.hex));');
    expect(sheet).toContain("const stockOutfit = () => JSON.stringify(defaultKipConfig(colourOf(colour)?.hex));");
    expect(sheet).toContain('onStage("pile", stockOutfit());');
    expect(sheet).not.toContain('onStage("pile", outfit());');                                   // the pile never carries the child's picks: they are made after he is built
    expect(sheet).toContain("<KipPreview cfg={cfg} />"); // the plain-blocks preview stays for a page with no game
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
    expect(world).toContain("if(hex){onbOutfit(hex);save();buildPlayer(null)}"); // the pile applies its (stock) outfit through the same helper, and the Dress step does too (chd)
    expect(world).toContain("var chd=onbOutfit(hex||\"\");");
  });
});


describe("the Dress step shows the real Kip (kid bench, spec section 9)", () => {
  const canvas = readFileSync(new URL("../src/features/game/world/GameCanvas.tsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../src/features/game/world/engine.ts", import.meta.url), "utf8");
  it("the sheet enters the workshop at the BUILD step (the game's workshop, the Toy Room hidden), sends the picks to the built Kip on every change in Dress, and Dress never enters again", () => {
    expect(sheet).toContain('if (!there && onStage("enter") === false) { setEngineOk(false); built.current = true; setScene("built"); return; }');
    expect(sheet).toContain('const t = window.setTimeout(() => onStage("dress", outfit()), 40);');
    expect(sheet).toContain("}, [step, cfg, engineOk]);");
    expect(sheet).toContain('if (step !== "dress" || !engineOk || !built.current) return;');
    expect(sheet).toContain("const there = staged.current;");
    expect(sheet).toContain("}, there ? 350 : 1700);");
    expect(sheet.match(/onStage\("enter"\)/g)).toHaveLength(1);
  });
  it("Back from Dress returns to the built Kip (nothing is torn down), Back from the build and closing the sheet put everything back (the world restores the look the child had), and the song's yes lands the stage", () => {
    expect(sheet).toContain('if (built.current) { setScene("built"); return; }');
    expect(sheet).toContain('onClick={back} data-onb-back>Back</button>');
    expect(sheet).toContain('useEffect(() => () => { if (laid.current || staged.current) onStage("abort"); }, []);');
    expect(sheet).toContain('const backFromBuild = () => { onStage("abort"); laid.current = false; staged.current = false; built.current = false; back(); };');
    expect(sheet.match(/onClick=\{backFromBuild\} data-onb-back>Back<\/button>/g)).toHaveLength(2);        // the pile card and the built card
    expect(world).toContain('if(op==="abort"){ONBT++;var pre=ONBPRE;ONBPRE=null;show();');
    expect(world).toContain("if(!ONBPRE){var sl1=cur();ONBPRE={col:{c1:S.col.c1,c2:S.col.c2,boots:S.col.boots,skin:S.col.skin,hair:S.col.hair},sel:{hair:sl1.hair,hat:sl1.hat,tail:sl1.tail}}}");
  });
  it("the plain-blocks preview stays only when there is no game to show Kip in; the stage styling is on only when there is", () => {
    expect(sheet).toContain("{!engineOk && <KipPreview cfg={cfg} />}");
    expect(sheet).toContain("const stageDress = step === \"dress\" && engineOk;");
    expect(sheet).toContain('${stageDress ? " tv-onb-dressing" : ""}');
    expect(canvas).toContain("if (!engineRef.current) return false; // no game to show it in");
    expect(canvas).toContain('"enter" | "dress" | "pile" | "build" | "land" | "abort" | "end" | "phonesShow"');
    expect(engine).toContain('"hide" | "dress" | "pile"');
  });
  it("the Dress step happens on the BUILT Kip standing on the turntable (Dan, 2026-11-05: build first, then spin the table and dress): every pick rebuilds him with the last Kip kept on show, so nothing blinks", () => {
    expect(world).toContain('if(op==="dress"){');
    expect(world).toContain("if(!ONBV)return;");                                                    // nothing to dress before he is built
    expect(world).toContain("if(chd){save();var old=(!ONBGH&&P.model&&P.rigReady)?P.model:null;buildPlayer(null);if(old){ONBGH=old;P.root.add(old)}");
    expect(world).toContain("if(rdy){if(ONBGH.parent)ONBGH.parent.remove(ONBGH);ONBGH=null}else ONBGH.visible=true");
    expect(world).not.toMatch(/\bONBD\b/);                                                 // the old dress-holds-the-stage flag is gone
    expect(world).toContain("portraitSig:function(){return P.rigReady&&!ONBW?String(P.rigSig):null},");
  });
  it("one lay function makes the pile: a newer lay cancels an older one, the old pile stays until the new is ready, and the layout is onbStage.ts's (far to the left of the turntable, a function of the part's place in the rig)", () => {
    expect(world).toContain("function onbLay(){");
    expect(world).toContain("if(tk!==ONBL||ot!==ONBT||!ONBW)return;");
    expect(world).toContain("var oldG=ONBG;ONBG=g;scene.add(g);if(oldG&&oldG.parent)oldG.parent.remove(oldG);");
    expect(world).toContain("hx=P.pos.x+PILE_DX,hz=P.pos.z+PILE_DZ");
    expect(world).toContain("sp=pileSpot(i)");
    expect(world).toContain("it.pp=new T.Vector3(hx+sp.dx,sp.dy,hz+sp.dz);");
    expect(world).toContain('import { ARRIVE_MS, LAND_S, PILE_DX, PILE_DZ, PLACE_S, TURNTABLE, buildTiming, landPose, pileSpot, stageZoom } from "./onbStage";');
    expect(world.split("onbLay()").length - 1).toBeGreaterThanOrEqual(2);                        // the function and its caller
  });
  it("the Dress card is one row of tiles at a time, with the shoes row and every pick named as before", () => {
    for (const part of ["shirt", "pants", "boots", "skin", "hair", "hairColour", "hat", "tail"]) expect(sheet).toContain(`part === "${part}" &&`);
    expect(sheet).toContain('<Tiles label="Shoes" items={SHOE_COLOURS}');
  });
});

describe("tap-to-build (kid bench slice 2)", () => {
  it("a tap on the stage (the pile, the turntable, Dress) is the setup's: a part, or nothing, never a walk", () => {
    expect(world).toContain('canvas.addEventListener("pointerdown",function(e: PointerEvent){ctx();IDLEB.cancel();if(ONBG||ONBW){ONBTAP(e);return}');
  });
  it("a tapped part (or the nearest to the ray within half a unit) is carried to its seat, reported through the window event, and the last one is the build's own arrival", () => {
    expect(world).toContain("function onbPlace(gg: any,it: any){");
    expect(world).toContain('window.dispatchEvent(new CustomEvent("tv-onb-progress",{detail:{placed:placed,total:seats.length,done:false}}));'); // "done" comes with the arrival, after a moment on the finished blueprint
    expect(world).toContain('if(all)ONBS("finish")})}');
    expect(world).toContain("var best=.55;open.forEach(");
    expect(world).toContain('if(op==="finish"){var gf=ONBG;if(!gf)return;');
    expect(world).toContain('detail:{placed:total,total:total,done:true}');
    expect(PROGRESS_EVENT).toBe("tv-onb-progress");
  });
  it("the build op carries only the parts not yet seated, stops the taps, and still finishes when none is left", () => {
    expect(world).toContain("gg.userData.running=true;");
    expect(world).toContain("var sAll=gg.userData.seats,seats2=sAll.filter(function(s: any){return !s.done&&!s.fly}),n=seats2.length,TM=buildTiming(n),TOT=TM.total,DUR=TM.dur,STAG=TM.stag;");
  });
  it("the sheet listens for the progress, counts it, and a finished pile shows the built Kip", () => {
    expect(sheet).toContain("window.addEventListener(PROGRESS_EVENT, on);");
    expect(sheet).toContain('if (d.done) { built.current = true; setScene("built"); }');
    expect(sheet).toContain("}, [scene, placed, held]);");
    expect(sheet).toContain("onClick={buildKip} data-onb-build");
  });
});

describe("the blueprint fills in and a brick can be dragged (kid bench slice 2, 2026-11-05)", () => {
  it("every brick learns its region when the pile is laid, from where it hangs in the rig (hat, tail, head, a shoe's foot or boot, an arm or a leg holder, else the torso), not from its height", () => {
    expect(world).toContain("function onbPart(o: any): {part: BrickPart;side: number}{");
    for (const part of ['a.userData&&a.userData.hatCad)return {part:"hat"', 'r.tail&&a===r.tail)return {part:"tail"', 'a===r.head)return {part:"head"', 'a===lg.foot||a===lg.boot))return {part:"shoe"', 'a===r.arms[i])return {part:"arm"', 'a===r.feet[i])return {part:"leg"', 'return {part:"torso",side:0}}']) expect(world, part).toContain(part);
    expect(world).toContain("it.region=blueprintRegion(pt.part,pt.side,{dx:it.p.x-P.pos.x,y:it.p.y})");
  });
  it("the poster is redrawn when the pile is laid (outline only in Dress), when a brick lands, when a build tween lands one, and when everything is in", () => {
    expect(world).toContain("function onbBP(){");
    expect(world).toContain("setBlueprintState(ONBK,{fill:regionFractions(seats.map(function(s: any){return {region:s.region,lit:!!s.lit}})),focus:ONBFOCUS})");
    expect(world).toContain("P.model.visible=false;blob.visible=false;onbBP()};");                    // the lay
    expect(world).toContain("it.fly=false;it.done=true;it.lit=true;onbBP();");                        // a tapped or dragged brick lands
    expect(world).toContain("if(u>=1&&!it.lit){it.lit=true;lit=true}}if(lit)onbBP()");                 // the build's bricks land one by one
    expect(world).toContain("sAll.forEach(function(s: any){s.lit=true});onbBP();");                   // all in: gold, BUILT
  });
  it("he arrives on the turntable after a moment on the finished blueprint (0.7 s), at once for reduced motion, in the build and in the all-tapped finish", () => {
    expect(world).toContain("if(reduce)onbArrive(gg,tk2,sAll.length);else setTimeout(function(){onbArrive(gg,tk2,sAll.length)},ARRIVE_MS)");
    expect(world).toContain("if(reduce)onbArrive(gf,tkf,nf);else setTimeout(function(){onbArrive(gf,tkf,nf)},ARRIVE_MS);return}");
  });
  it("a press on a brick is a grab (the tap places it on release), a drag lifts it under the finger with a ghost at its seat and its region dashed, and the ghost's geometry is never disposed", () => {
    expect(world).toContain("if(pick)ONBGRAB(e,gg,pick)}");
    expect(world).toContain('import { createBrickGrab } from "./brickGrab";');
    expect(world).toContain("var BG=createBrickGrab<any>({threshold:9,maxMs:20000,onExpire:function(h: any){ONBDONE(h,true)}});");
    expect(world).toContain("if(v===\"start\"){ONBGHOST=onbGhost(it);ONBFOCUS=it.region;onbBP();sfx.pop()}");
    expect(world).toContain("ONBGHOST.material.dispose();");
    expect(world).not.toContain("ONBGHOST.geometry.dispose");
    expect(world).toContain('canvas.addEventListener("pointermove",ONBMOVE);canvas.addEventListener("pointerup",ONBUP);canvas.addEventListener("pointercancel",ONBUP);canvas.addEventListener("lostpointercapture",ONBUP);');
  });
  it("every way a hold ends carries the brick on: release, cancel and lost pointer all go through ONBUP, the expiry through onExpire, a second finger through down(), the build and abort through show()", () => {
    expect(world).toContain("function ONBUP(e: PointerEvent){var hd=BG.up(e.pointerId);if(hd)ONBDONE(hd,true)}");
    expect(world).toContain("var prev=BG.down(it,e.pointerId,e.clientX,e.clientY);if(prev)ONBDONE(prev,true);");
    expect(world).toContain("if(place&&ONBG===gg&&!gg.userData.running&&!it.done&&!it.fly){if(hd.moved){it.pp.copy(it.m.position);it.pq.copy(it.m.quaternion)}onbPlace(gg,it)}");
    expect(world).toContain("seats2.forEach(function(s: any){if(s.held){s.pp.copy(s.m.position);s.pq.copy(s.m.quaternion)}});");   // a held brick is carried from the hand when the build starts
  });
  it("the sheet waits for a held brick (and stops waiting after 25 s), builds himself again on release, and says drag as well as tap", () => {
    expect(GRAB_EVENT).toBe("tv-onb-grab");
    expect(GRAB_MAX_MS).toBeGreaterThan(20000);
    expect(sheet).toContain('if (scene !== "pile" || held) return;');
    expect(sheet).toContain("if (h) cap = window.setTimeout(() => setHeld(false), GRAB_MAX_MS);");
    expect(sheet).toContain("Tap or drag the parts to build Kip");
    expect(sheet).toContain('window.setTimeout(() => setScene((sc) => (sc === "building" ? "built" : sc)), BUILD_DONE_MS)');
    expect(BUILD_DONE_MS).toBeGreaterThanOrEqual(6400 + 700);                                        // the longest build plus the moment on the finished blueprint
  });
});
