// The one-shot options the jump and the shove need (docs: gameMoves.ts): `lift` (how much of the clip's own hips lift is used), `fade` (how fast it eases in) and `rate` (how fast it plays).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MixamoDriver, type BakedClip, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy } from "../src/features/game/world/runtime/playerRig";

/** A clip of `frames` frames over `duration` s: the limbs at rest and the hips following `lift(t)` (0 to 1 over the clip). */
function clip(name: string, duration: number, lift: (u: number) => number, frames = 31): BakedClip {
  const c: BakedClip = {
    name, duration, loop: false, pose: false, frames,
    hips: new Float32Array(frames * 3), body: new Float32Array(frames * 4), head: new Float32Array(frames * 4),
    armL: new Float32Array(frames * 3), armR: new Float32Array(frames * 3), legL: new Float32Array(frames * 3), legR: new Float32Array(frames * 3),
  };
  for (let i = 0; i < frames; i++) {
    c.hips[i * 3 + 1] = lift(i / (frames - 1));
    c.hips[i * 3 + 2] = 0.5 * lift(i / (frames - 1));                       // forward as well, to check x and z scale with the lift too
    c.body[i * 4 + 3] = 1; c.head[i * 4 + 3] = 1;
    for (const ch of ["armL", "armR", "legL", "legR"] as const) c[ch][i * 3 + 1] = -1;
  }
  return c;
}
const rest = (name: string) => ({ ...clip(name, 1, () => 0, 2), loop: true });
const bank = (): ClipBank => ({ idle: rest("idle"), walk: rest("walk"), jump: clip("jump", 1, (u) => Math.sin(Math.PI * u)) });

function rigAndDriver() {
  const rig = buildToy("character", stockSel().character as never, stockCol());
  rig.arms.length = 0; rig.arms.push(new THREE.Group(), new THREE.Group());
  rig.head = new THREE.Group();
  const d = new MixamoDriver(bank());
  expect(d.canDrive(rig)).toBe(true);
  return { rig, d };
}
/** The rig's height above where it stands at rest, after running the driver for `t` seconds in 1/60 steps. */
const heightAfter = (rig: ReturnType<typeof rigAndDriver>["rig"], d: MixamoDriver, t: number) => { for (let k = 0; k < Math.round(t * 60); k++) d.update(rig, 1 / 60, 0); return rig.g.position.y; };
const peakOf = (rig: ReturnType<typeof rigAndDriver>["rig"], d: MixamoDriver, seconds: number) => { let peak = 0, at = 0; for (let k = 0; k < Math.round(seconds * 60); k++) { d.update(rig, 1 / 60, 0); if (rig.g.position.y > peak) { peak = rig.g.position.y; at = (k + 1) / 60; } } return { peak, at }; };

describe("trigger returns whether the clip is in the bank", () => {
  it("true for a clip it has (with or without options), false for one it has not", () => {
    const { d } = rigAndDriver();
    expect(d.trigger("jump")).toBe(true);
    expect(d.trigger("jump", { lift: 0, fade: 0.05, rate: 1.3 })).toBe(true);
    expect(d.trigger("shove")).toBe(false);
  });
});

describe("lift: how much of the clip's own height the toy takes", () => {
  it("1 (the default) lifts the rig by the clip's hips; 0 not at all; half is half", () => {
    const run = (opts?: { lift?: number }) => { const { rig, d } = rigAndDriver(); d.trigger("jump", opts); return peakOf(rig, d, 1.0); };
    const full = run(), none = run({ lift: 0 }), half = run({ lift: 0.5 });
    expect(full.peak).toBeGreaterThan(1);                                    // hips 1.0 x hip height x gain, near the apex
    expect(none.peak).toBeLessThan(0.02);
    expect(half.peak).toBeGreaterThan(full.peak * 0.4);
    expect(half.peak).toBeLessThan(full.peak * 0.6);
    expect(run({}).peak).toBeCloseTo(full.peak, 9);
  });
  it("scales the forward lean of the hips too (a clip played in place for the pose does not walk Kip forward)", () => {
    const run = (lift: number) => { const { rig, d } = rigAndDriver(); d.trigger("jump", { lift }); let m = 0; for (let k = 0; k < 60; k++) { d.update(rig, 1 / 60, 0); m = Math.max(m, Math.abs(rig.g.position.x)); } return m; };
    expect(run(1)).toBeGreaterThan(0.3);
    expect(run(0)).toBeLessThan(0.01);
  });
  it("junk values are harmless: NaN and undefined mean 1, negatives mean 0, above 1 means 1", () => {
    const peak = (lift: unknown) => { const { rig, d } = rigAndDriver(); d.trigger("jump", { lift } as never); return peakOf(rig, d, 1.0).peak; };
    const one = peak(1);
    expect(peak(Number.NaN)).toBeCloseTo(one, 9);
    expect(peak(undefined)).toBeCloseTo(one, 9);
    expect(peak("x")).toBeCloseTo(one, 9);
    expect(peak(7)).toBeCloseTo(one, 9);
    expect(peak(-3)).toBeLessThan(0.02);
  });
});

describe("fade: how fast the clip takes hold", () => {
  it("a short fade has the toy up sooner than the default (a jump leaves the ground suddenly)", () => {
    const at = (opts?: { fade?: number }) => { const { rig, d } = rigAndDriver(); d.trigger("jump", opts); return heightAfter(rig, d, 0.2); };
    expect(at({ fade: 0.05 })).toBeGreaterThan(at() * 1.3);
    expect(at({ fade: 0.28 })).toBeCloseTo(at(), 9);
  });
  it("it never fades slower than the default, and junk values mean the default", () => {
    const at = (fade: unknown) => { const { rig, d } = rigAndDriver(); d.trigger("jump", { fade } as never); return heightAfter(rig, d, 0.2); };
    const def = at(undefined);
    expect(at(5)).toBeCloseTo(def, 9);
    expect(at(0)).toBeCloseTo(def, 9);
    expect(at(-1)).toBeCloseTo(def, 9);
    expect(at(Number.NaN)).toBeCloseTo(def, 9);
  });
});

describe("rate: how fast it plays", () => {
  it("twice the rate reaches the apex in half the time and is over in half the time", () => {
    const run = (rate: number) => { const { rig, d } = rigAndDriver(); d.trigger("jump", { rate, fade: 0.05 }); const p = peakOf(rig, d, 1.2); let k = 0; const e = rigAndDriver(); e.d.trigger("jump", { rate, fade: 0.05 }); while (e.d.busyAction && k < 600) { e.d.update(e.rig, 1 / 60, 0); k++; } return { ...p, over: k / 60 }; };
    const one = run(1), two = run(2);
    expect(one.at).toBeGreaterThan(0.4); expect(one.at).toBeLessThan(0.6);
    expect(two.at).toBeGreaterThan(0.2); expect(two.at).toBeLessThan(0.3);
    expect(one.over).toBeGreaterThan(0.95); expect(one.over).toBeLessThan(1.1);
    expect(two.over).toBeGreaterThan(0.45); expect(two.over).toBeLessThan(0.6);
  });
  it("is kept between half speed and double speed, and junk means 1", () => {
    const over = (rate: unknown) => { const { rig, d } = rigAndDriver(); d.trigger("jump", { rate } as never); let k = 0; while (d.busyAction && k < 900) { d.update(rig, 1 / 60, 0); k++; } return k / 60; };
    expect(over(100)).toBeCloseTo(over(2), 1);
    expect(over(0.01)).toBeCloseTo(over(0.5), 1);
    for (const junk of [Number.NaN, undefined, "fast", null]) expect(over(junk)).toBeCloseTo(over(1), 1);
    expect(over(0.5)).toBeGreaterThan(1.9);
  });
});

describe("a one-shot with options is still a one-shot", () => {
  it("is reported while it plays, ends by itself, and walking pulls the toy out of it", () => {
    const { rig, d } = rigAndDriver();
    d.trigger("jump", { lift: 0, fade: 0.05, rate: 1.3 });
    d.update(rig, 0.2, 0);
    expect(d.busyAction).toBe("jump");
    for (let k = 0; k < 120; k++) d.update(rig, 1 / 60, 0);
    expect(d.busyAction).toBeNull();
    const w = rigAndDriver();
    w.d.trigger("jump", { fade: 0.05 });
    const calm = peakOf(rigAndDriver().rig, (() => { const x = rigAndDriver(); x.d.trigger("jump", { fade: 0.05 }); return x.d; })(), 1).peak;
    let peakWalking = 0;
    for (let k = 0; k < 60; k++) { w.d.update(w.rig, 1 / 60, 3.4); peakWalking = Math.max(peakWalking, w.rig.g.position.y); }
    expect(peakWalking).toBeLessThan(calm * 0.5);
  });
});

describe("until: play only the start of a long clip, as authored, and ease out of it", () => {
  /** A 4 s clip that stays "pushing" the whole time, so the end of it is only ever the `until`. */
  const long = (): ClipBank => ({ ...bank(), shove: { ...clip("shove", 4, () => 0.2, 121), loop: false } });
  const driver = () => { const rig = rigAndDriver().rig; const d = new MixamoDriver(long()); expect(d.canDrive(rig)).toBe(true); return { rig, d }; };
  const secondsBusy = (opts: object) => { const { rig, d } = driver(); d.trigger("shove", opts); let k = 0; while (d.busyAction && k < 1200) { d.update(rig, 1 / 60, 0); k++; } return k / 60; };

  it("ends that many seconds in (of the clip's own time), not at the end of the clip", () => {
    expect(secondsBusy({})).toBeGreaterThan(3.9);                                     // no `until`: the whole 4 s
    expect(secondsBusy({ until: 1.5 })).toBeGreaterThan(1.45);
    expect(secondsBusy({ until: 1.5 })).toBeLessThan(1.6);
  });
  it("eases out over `fade` before it ends: the pose is fading, not cut (half way into the ease it is about half there)", () => {
    const at = (t: number) => { const { rig, d } = driver(); d.trigger("shove", { until: 1.5, fade: 0.3 }); for (let k = 0; k < Math.round(t * 60); k++) d.update(rig, 1 / 60, 0); return rig.g.position.y; };
    const held = at(1.0);
    expect(held).toBeGreaterThan(0.01);
    expect(at(1.35)).toBeLessThan(held * 0.8);
    expect(at(1.35)).toBeGreaterThan(held * 0.2);
    expect(at(1.49)).toBeLessThan(held * 0.15);
  });
  it("it is in the clip's own time: a faster rate gets to its end sooner", () => {
    expect(secondsBusy({ until: 1.5, rate: 2 })).toBeLessThan(0.85);
  });
  it("junk values mean no `until` at all, and a tiny one is ignored too (a clip never ends before it starts)", () => {
    for (const junk of [Number.NaN, undefined, "soon", -2, 0, 0.05, Infinity]) expect(secondsBusy({ until: junk }), String(junk)).toBeGreaterThan(3.9);
  });
});

describe("lift on a clip with the bench's joint data: the hips' own height is scaled about standing", () => {
  /** The driver's sampled hips height (mm) while a joint clip plays: read from its working pose. */
  function jointClip(): BakedClip {
    const c = clip("jump", 1, (u) => Math.sin(Math.PI * u));
    const n = c.frames, q = () => { const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a[i * 4 + 3] = 1; return a; };
    c.joints = { shoulderL: q(), shoulderR: q(), elbowL: q(), elbowR: q(), wristL: q(), wristR: q(), hipL: q(), hipR: q(), kneeL: q(), kneeR: q(), ankleL: q(), ankleR: q(), hipsMm: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) { c.joints.hipsMm[i * 3] = 3; c.joints.hipsMm[i * 3 + 1] = 61.5 + 30 * Math.sin(Math.PI * (i / (n - 1))); c.joints.hipsMm[i * 3 + 2] = 0; }
    return c;
  }
  const hipsAtApex = (lift?: number) => {
    const rig = rigAndDriver().rig;
    const d = new MixamoDriver({ ...bank(), jump: jointClip() });
    d.trigger("jump", lift === undefined ? { fade: 0.05 } : { lift, fade: 0.05 });
    for (let k = 0; k < 30; k++) d.update(rig, 1 / 60, 0);                            // the apex, half way through
    return (d as unknown as { a: { j: { hipsMm: { x: number; y: number } } } }).a.j.hipsMm;
  };
  it("full lift leaves the clip's hips exactly as baked; none puts the hips back at standing; half is half-way", () => {
    expect(hipsAtApex().y).toBeCloseTo(91.5, 0);
    expect(hipsAtApex(0).y).toBeCloseTo(61.5, 6);
    expect(hipsAtApex(0.5).y).toBeCloseTo(76.5, 0);
  });
  it("only the height is scaled: the sideways position the clip gives is left as it is", () => {
    expect(hipsAtApex(0).x).toBeCloseTo(3, 6);
  });
});
