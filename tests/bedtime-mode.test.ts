// What the toy does about bedtime, and how the curtain looks for it (src/lib/bedtimeMode.ts, SleepCurtain.tsx `curtainLook`; Dan, 2026-11-05: "Kip going to bed by himself at quiet hours").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bedtimeModeFor } from "../src/lib/bedtimeMode";
import { curtainLook } from "../src/features/game/world/SleepCurtain";
import type { PlayStopReason } from "../shared/parent-time";

const st = (locked: boolean, reason: PlayStopReason, bedtime: boolean) => ({ locked, reason, bedtime });

describe("the mode: going in the last minute, now once the curtain is up, off otherwise", () => {
  it("the lead-in is going, whatever is stopping play (the status says whether it is a night)", () => {
    expect(bedtimeModeFor(st(false, "active", true), false)).toBe("going");
    expect(bedtimeModeFor(st(false, "active", false), false)).toBe("off");
    expect(bedtimeModeFor(st(false, "disabled", false), false)).toBe("off");
  });
  it("stopped for the night or for the day, with the curtain up: now", () => {
    expect(bedtimeModeFor(st(true, "quiet_hours", true), true)).toBe("now");
    expect(bedtimeModeFor(st(true, "daily_limit", true), true)).toBe("now");
  });
  it("a sitting limit is a break: he stays up", () => {
    expect(bedtimeModeFor(st(true, "session_limit", false), true)).toBe("off");
    expect(bedtimeModeFor(st(true, "session_limit", true), true)).toBe("off");
  });
  it("a mission or the Garage allowed to finish after the day's limit (no curtain yet) keeps him up until it is done", () => {
    expect(bedtimeModeFor(st(true, "daily_limit", true), false)).toBe("off");
  });
  it("a status from a server that does not send bedtime reads as off, and play coming back (unlocked) is off", () => {
    expect(bedtimeModeFor({ locked: false, reason: "active" } as never, false)).toBe("off");
    expect(bedtimeModeFor(st(false, "active", false), false)).toBe("off");
  });
});

describe("the curtain's look", () => {
  it("is see-through for the night and the day's end (he is in bed: show him) and heavy for a break", () => {
    expect(curtainLook({ reason: "quiet_hours" })).toBe("bed");
    expect(curtainLook({ reason: "daily_limit" })).toBe("bed");
    expect(curtainLook({ reason: "session_limit" })).toBe("break");
  });
  it("the stylesheet has the modifier and the component and the game use it", () => {
    const root = process.cwd();
    const css = readFileSync(join(root, "src/sleep-bed.css"), "utf8");
    expect(css).toContain(".tv-sleep-curtain.tv-sleep-curtain--bed");
    expect(css).toMatch(/backdrop-filter:\s*none/);
    expect(readFileSync(join(root, "src/features/game/world/SleepCurtain.tsx"), "utf8")).toContain('tv-sleep-curtain tv-sleep-curtain--bed');
    const canvas = readFileSync(join(root, "src/features/game/world/GameCanvas.tsx"), "utf8");
    expect(canvas).toContain("bedtimeModeFor(parentSnapshot.status, sleepActive)");
    expect(canvas).toContain("engine()?.setBedtime(bedtimeMode)");
  });
});

describe("the wiring from the game to the sleep hook", () => {
  const root = process.cwd();
  it("the engine hands setBedtime to the world, and the world to the sleep hook, which knows where the beds are and that the title owns the toy", () => {
    expect(readFileSync(join(root, "src/features/game/world/engine.ts"), "utf8")).toContain("hooks()?.setBedtime?.(mode);");
    const world = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
    expect(world).toContain('setBedtime:function(m){SLEEPH.setBedtime(m==="going"||m==="now"?m:"off")}');
    expect(world).toContain('beds:function(){return PFX.list().filter(function(i: any){return i.type==="bed"})');
    expect(world).toContain("bedtimeOk:function(){return !P.title}");
  });
});
