// The new-player build stage (Dan, 2026-11-05: "leave the turntable but have it not spin; move the pile of bricks further left, then slowly move the bricks and build on the turntable"; "once built the turntable
// can spin and the player can Dress"). The turntable is real geometry in the workshop; the world's hooks reuse the title's turntable (TT, TTS, ttLive) once Kip is built; the sheet builds first and dresses after.
// Checked in a real Chrome from the real title screen at 844x390, 740x360, 932x430 and 667x375, with a mouse and with touch (docs/specs/accounts-and-new-user-spec.md sections 8 and 9).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TURNTABLE } from "../src/features/game/world/runtime/onbStage";
import { WORKSHOP, buildWorkshop, disposeWorkshop } from "../src/features/game/world/runtime/workshopScene";
import { stepsFor } from "../src/lib/newPlayer";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const world = read("src/features/game/world/runtime/world.ts");
const sheet = read("src/features/game/world/OnboardingSheet.tsx");
const canvas = read("src/features/game/world/GameCanvas.tsx");
const css = read("src/onboarding.css");

describe("the turntable in the workshop", () => {
  const g = buildWorkshop({ x: 10, z: 1 });
  const tt = g.userData.tt as THREE.Group;
  it("is a group centred on Kip's standing place, its top surface TURNTABLE.top high and its edge TURNTABLE.r out", () => {
    expect(tt).toBeInstanceOf(THREE.Group);
    expect(tt.name).toBe("turntable");
    expect(tt.position.x).toBe(10); expect(tt.position.z).toBe(1); expect(tt.position.y).toBe(0);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tt);
    expect(box.max.y).toBeGreaterThan(TURNTABLE.top); expect(box.max.y).toBeLessThan(TURNTABLE.top + 0.1);   // the top disc, the stripe and the rim lights, a hair above
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.x - 10).toBeCloseTo(TURNTABLE.r, 1); expect(10 - box.min.x).toBeCloseTo(TURNTABLE.r, 1);
    expect(g.userData.turntable).toEqual({ x: 10, z: 1, top: TURNTABLE.top, r: TURNTABLE.r });
  });
  it("has the title's ring of sixteen lights and a stripe, so a turn can be seen", () => {
    const lights = tt.children.filter((c) => (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity > 1);
    expect(lights).toHaveLength(16);
    for (const l of lights) expect(Math.hypot(l.position.x, l.position.z)).toBeCloseTo(TURNTABLE.r - 0.2, 5);
    expect(tt.children.some((c) => (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry)).toBe(true);
  });
  it("stays on the workshop floor (it must not hang over the front edge) and every part of it receives shadows", () => {
    expect(1 + TURNTABLE.r).toBeLessThanOrEqual(1 + WORKSHOP.floorFront);
    tt.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).receiveShadow).toBe(true); });
  });
  it("sinks under the floor when moved down by TURNTABLE.sink, and turns about its own middle", () => {
    tt.position.y = -TURNTABLE.sink; g.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(tt).max.y).toBeLessThan(0.02);                           // below the floor's top
    tt.position.y = 0; tt.rotation.y = 1.2; g.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(tt).getCenter(new THREE.Vector3());
    expect(c.x).toBeCloseTo(10, 1); expect(c.z).toBeCloseTo(1, 1);
  });
  it("is freed with the workshop", () => {
    let freed = 0;
    tt.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.addEventListener("dispose", () => { freed++; }); });
    disposeWorkshop(g);
    expect(freed).toBeGreaterThan(18);
  });
});

describe("the world reuses the title's turntable once Kip is built", () => {
  it("the table is live for a drag only when he is built on it and it is not sinking (never while the pile lies there)", () => {
    expect(world).toContain("||(ONBV&&!ONBLAND&&!!ONBK)}");
    expect(world).toContain("else if(ONBV&&!ONBLAND&&ONBK&&ONBK.userData.tt){var tts2=TT.step(dt);facA+=tts2.d;TTS.update(tts2);ONBK.userData.tt.rotation.y=facA}else{TT.park();TTS.quiet()}");
  });
  it("is the same TT and TTS as the title's (no second copy of the spin rules), with the rim measured on the workshop's own table", () => {
    expect(world.match(/createTurntable\(/g)).toHaveLength(1);
    expect(world.match(/createTurntableSound\(/g)).toHaveLength(1);
    expect(world).toContain("function ttRim(){var on=ONBV&&!!ONBK,");
    expect(world).toContain("tx+(on?TURNTABLE.r:2.1)");
  });
  it("Kip turns with the table, stands as high as its top, and his shadow with him; a rebuilt model is never seen before he is built", () => {
    expect(world).toContain("P.root.position.y=P.showcase?.36:((P.elev||0)+ONBY);P.root.rotation.y=(P.showcase||ONBV)?facA:P.face;");
    expect(world).toContain("P.showcase?.39:.025+ONBY");
  });
  it("while the pile lies there the table does not move at all: nothing but the built state steps it", () => {
    const stepLines = world.split("\n").filter((l) => l.includes("TT.step(dt)"));
    expect(stepLines.length).toBeGreaterThan(0);
    for (const l of stepLines) expect(l.includes("ONBV")).toBe(l.includes("tts2"));   // the title's own step is unchanged, the workshop's is behind ONBV
  });
});

describe("arriving, being dressed, and landing", () => {
  it("the arrival removes the pile, faces him to the screen, starts the table from there and tells the sheet he is done", () => {
    expect(world).toContain("function onbArrive(gg: any,tk: number,total: number){");
    expect(world).toContain("ONBFOCUS=null;ONBV=true;ONBLAND=false;facA=-Math.PI/2;TT.park();TTS.quiet();");
    expect(world).toContain('window.dispatchEvent(new CustomEvent("tv-onb-progress",{detail:{placed:total,total:total,done:true}}))}');
  });
  it("the pile op raises Kip by the table's top BEFORE the bricks are laid (their seats include it), keeps him hidden, and builds the workshop once", () => {
    const i = world.indexOf('if(op==="pile"){');
    const body = world.slice(i, world.indexOf('if(op==="build"){', i));
    expect(body.indexOf("ONBY=TURNTABLE.top")).toBeGreaterThan(0);
    expect(body.indexOf("ONBY=TURNTABLE.top")).toBeLessThan(body.indexOf("onbLay()"));
    expect(body).toContain("ONBV=false;");
    expect(world.match(/ONBK=buildWorkshop\(/g)).toHaveLength(1);
  });
  it("the landing sinks the table with him on it, turns him to the screen by the shortest way, and only then gives the Toy Room back", () => {
    const i = world.indexOf('if(op==="land"){');
    const body = world.slice(i, world.indexOf('if(op==="dress"){', i));
    expect(body).toContain("ONBLAND=true;");
    expect(body).toContain("tween(LAND_S,function(k: number){var lp=landPose(k,y0,f0,-Math.PI/2);ONBY=lp.y;facA=lp.face;if(ttg){ttg.position.y=lp.sink;ttg.rotation.y=facA}})");
    expect(body.indexOf("tween(LAND_S")).toBeLessThan(body.indexOf(".then(function(){if(tkl!==ONBT)return;show();"));
    expect(body).toContain("if(!ONBK||!ONBV||reduce){show();P.face=P.tface=-Math.PI/2;return}");  // no motion wanted, or nothing staged: straight to the Toy Room
    expect(world).toContain("function idleOk(){return !disposed&&!reduce&&!ONBW&&");                // no idle gesture while he stands on the table
  });
  it("a tap on the stage (the pile, the table, Dress) is never a walk", () => {
    expect(world).toContain("if(ONBG||ONBW){ONBTAP(e);return}");
  });
  it("the camera stands farther back while the stage holds, by the screen's shape, and comes back after", () => {
    expect(world).toContain("P.onz=(P.onz==null?1:P.onz)+((ONBW?stageZoom(asp):1)-(P.onz==null?1:P.onz))*Math.min(1,dt*3);var dd=dd0*P.zd*P.push*P.onz;");
  });
  it("the avatar's picture is taken when the stage lands (the poll that waited for him stops after 20 s, and the stage is longer)", () => {
    expect(canvas).toContain('if (op === "land") window.setTimeout(refreshPortrait, 1100);');
    expect(canvas).toContain("}, [titleOpen, chooseTitle, refreshPortrait]);");
  });
});

describe("the sheet builds first, dresses after, and lands the stage at the song's answer", () => {
  it("the steps are who, grown-up, names, favourites, BUILD, DRESS, song, intro", () => {
    expect(stepsFor(true)).toEqual(["who", "grownup", "names", "favourites", "build", "dress", "song", "intro"]);
    expect(stepsFor(false).indexOf("build")).toBeLessThan(stepsFor(false).indexOf("dress"));
    expect(stepsFor(false).indexOf("dress")).toBeLessThan(stepsFor(false).indexOf("song"));
  });
  it("the built card offers Dress Kip and Back (which takes everything down and restores the look), and the card says to spin the table", () => {
    expect(sheet).toContain("Kip is built and standing on his turntable. Give it a spin, then dress him how {name} likes!");
    expect(sheet).toContain('onClick={next} data-onb-next>Dress Kip</button>');
  });
  it("the Toy Room cards are the first part of the intro, the confetti and the tour the second, and the tour's own clock only runs in it", () => {
    expect(sheet).toContain('const [introPart, setIntroPart] = useState<"meet" | "tour">("meet");');
    expect(sheet).toContain('{step === "intro" && introPart === "meet" && (');
    expect(sheet).toContain('{step === "intro" && introPart === "tour" && !calm && (');
    expect(sheet).toContain('if (step !== "intro" || introPart !== "tour" || calm) return;');
    expect(sheet).toContain('setIntroPart("meet"); setMeet(0);');
  });
  it("the build's idle timer, the progress listener and the fallback timer all only run while there is something to wait for", () => {
    expect(sheet).toContain('if (scene !== "pile" && scene !== "building") return;');
    expect(sheet).toContain("if (d.done) { built.current = true; setScene(\"built\"); }");
    expect(sheet).toContain("const stockOutfit = () => JSON.stringify(defaultKipConfig(colourOf(colour)?.hex));");
  });
});

describe("the stage is the player's to touch", () => {
  it("the Dress overlay no longer takes the touches (a drag on the table reaches the canvas); only the card does", () => {
    const dressing = css.split("\n").filter((l) => l.startsWith(".tv-onb-dressing {"));
    expect(dressing).toHaveLength(1);
    expect(dressing[0]).not.toContain("pointer-events: auto");
    expect(css).toContain(".tv-onb-stage { background:");
    expect(css).toMatch(/\.tv-onb-stage \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.tv-onb-stage \.tv-onb-card \{[^}]*pointer-events: auto/);
  });
  it("the Dress card is no wider than the build card's 47% of the screen, so it never covers the table", () => {
    expect(css).toContain(".tv-onb-dressing .tv-onb-card { width: min(400px, 47%);");
  });
});
