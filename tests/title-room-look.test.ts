// The title's workshop (the turntable room: the title screen and the Build sheet's stage) has two looks, night and day, like the outdoor worlds (lib/timeOfDay.ts: the device's clock, 07:00 to 19:00 is day, a grown-up
// can pin one). Dan, 2026-11-05: "does the turntable page have a day and night version based on the user's time of day?". Checked in a real Chrome (title in both looks, a live swap when the pinned mode changes).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { timeOfDayFor } from "../src/lib/timeOfDay";

const world = readFileSync(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
const factory = world.slice(world.indexOf("function buildFactory("), world.indexOf("FAC=g}", world.indexOf("function buildFactory(")) + 6);
const lum = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };

describe("the room's two looks", () => {
  it("picks each colour with pk(night, day), and the night values are the original room, unchanged", () => {
    for (const night of ["#1a2460", "#14206a", "#23307e", "#4a66c8", "#7f9bff", "#22337e", "#3350b8", "#9bd4ff", "#3c55b8", "#2c3f94", "#0f1a4a", "#9bb0ff"]) expect(factory, night).toContain(`pk("${night}",`);
    expect(factory).toContain('pk("rgba(82,183,255,0.35)",');
  });
  it("the day look is lighter than the night one for the floor, the wall, the sky in the windows, the turntable and the belt (a day room, not a dark one)", () => {
    const pairs = [...factory.matchAll(/pk\("(#[0-9a-f]{6})","(#[0-9a-f]{6})"\)/gi)].map((m) => [m[1]!, m[2]!] as const);
    expect(pairs.length).toBeGreaterThanOrEqual(15);
    for (const [night, day] of pairs) if (["#1a2460", "#14206a", "#23307e", "#22337e", "#3350b8", "#0f1a4a"].includes(night)) expect(lum(day), `${night} -> ${day}`).toBeGreaterThan(lum(night) + 40);
  });
  it("day has a sun and clouds where night has its stars, and the lamps are dimmer by day", () => {
    expect(factory).toContain('glowMat("#fff1a8",2.2)');
    expect(factory).toContain("SphereGeometry(.24,10,8),glowMat(\"#ffffff\"");
    expect(factory).toContain("else for(var i=0;i<7;i++)g.add(M(new T.SphereGeometry(.04,6,4),glowMat(\"#ffffff\",2)");
    expect(factory).toContain("glowMat(\"#fff5c2\",pk(2.5,.7))");
  });
  it("the room remembers which look it was built in", () => {
    expect(factory).toContain("g.userData.tod=tod;");
    expect(factory).toContain('var tod=t==="day"||t==="night"?t:facTod()');
  });
});

describe("the room follows the clock", () => {
  it("is built in the clock's look at start, and a pinned mode wins over the clock", () => {
    expect(world).toContain("buildFactory();buildWorld(S.world);");
    expect(world).toContain('function facTod(m?: string): "day"|"night"{return timeOfDayFor(Date.now(),undefined,(m as any)||loadTimeOfDayMode())}');
    const noon = new Date(2026, 10, 5, 12, 0).getTime(), midnight = new Date(2026, 10, 5, 0, 30).getTime();
    expect(timeOfDayFor(noon, undefined, "auto")).toBe("day");
    expect(timeOfDayFor(midnight, undefined, "auto")).toBe("night");
    expect(timeOfDayFor(noon, undefined, "night")).toBe("night");
    expect(timeOfDayFor(midnight, undefined, "day")).toBe("day");
  });
  it("every second the room is swapped when the look it has is not the one wanted, freeing its geometry, and nothing happens when it is", () => {
    expect(world).toContain("lookAcc=0;var m=loadTimeOfDayMode();facSync(m);");
    expect(world).toContain("function facSync(m?: string){if(!FAC)return;var t=facTod(m);if(FAC.userData.tod===t)return;var old=FAC;scene.remove(old);old.traverse(function(o: any){if(o.geometry&&o.geometry.dispose)o.geometry.dispose()});FAC=null;buildFactory(t)}");
  });
});
