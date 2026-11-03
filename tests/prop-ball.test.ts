// The ball can be kicked (it flies, bounces, rolls and stays where it stops), any tap can be heard by the world, and a prop can be squished quietly.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BALL_BOUNDS, BALL_R } from "../src/features/game/world/runtime/ballKick";
import { createPropFx, type PropFxDeps } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

function room(over: Partial<PropFxDeps> = {}) {
  const world = new THREE.Group();
  const toast = vi.fn();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false, ...over });
  return { fx, world, toast };
}
function ball(c: ReturnType<typeof room>, x = 10) {
  const g = new THREE.Group();
  g.position.set(x, 0, -2);
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 12, 8), new THREE.MeshStandardMaterial());
  m.position.y = BALL_R;
  g.add(m);
  c.world.add(g);
  return c.fx.register("ball", [g])!;
}
function cushions(c: ReturnType<typeof room>) {
  const g = new THREE.Group();
  g.position.set(5, 0, -2);
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1), new THREE.MeshStandardMaterial());
  m.position.y = 0.3;
  g.add(m);
  c.world.add(g);
  return c.fx.register("cushions", [g])!;
}
const run = (fx: ReturnType<typeof createPropFx>, seconds: number, from = 0, dt = 1 / 60) => {
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; fx.update(dt, t); }
  return t;
};

describe("kickBall", () => {
  it("sends the ball flying: it moves along, rises, comes down, and ends up further along, at rest on the floor", () => {
    const c = room();
    const b = ball(c);
    expect(c.fx.kickBall(b, 5.8, 3.4)).toBe(true);
    const ys: number[] = [], xs: number[] = [];
    let t = 0;
    for (let i = 0; i < 600; i++) { t += 1 / 60; c.fx.update(1 / 60, t); ys.push(b.holder.position.y); xs.push(b.holder.position.x); }
    expect(Math.max(...ys)).toBeGreaterThan(0.4);                 // it left the floor
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);            // and never went through it
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
    expect(xs.at(-1)!).toBeGreaterThan(14);
    expect(b.kick).toBeNull();                                    // at rest again
    expect(b.holder.position.x).toBeCloseTo(b.base.px, 6);        // where it stopped is where it is now
    expect(b.holder.position.y).toBeCloseTo(0, 6);
    expect(Math.abs(b.pivot!.rotation.z)).toBeGreaterThan(2);     // it rolled, and keeps the turn it ended with
  });

  it("stays inside the play area when kicked at a wall", () => {
    const c = room();
    const b = ball(c, 42);
    c.fx.kickBall(b, 9, 2);
    let t = 0;
    for (let i = 0; i < 600; i++) { t += 1 / 60; c.fx.update(1 / 60, t); expect(b.holder.position.x).toBeLessThanOrEqual(BALL_BOUNDS[1] + 1e-9); }
    const l = ball(c, 2);
    c.fx.kickBall(l, -9, 2);
    for (let i = 0; i < 600; i++) { t += 1 / 60; c.fx.update(1 / 60, t); expect(l.holder.position.x).toBeGreaterThanOrEqual(BALL_BOUNDS[0] - 1e-9); }
  });

  it("only a ball can be kicked", () => {
    const c = room();
    const cu = cushions(c);
    expect(c.fx.kickBall(cu, 5, 3)).toBe(false);
    expect(cu.kick).toBeNull();
    run(c.fx, 1);
    expect(cu.holder.position.x).toBeCloseTo(5, 6);
  });

  it("cancels a roll in place that was already under way (no double movement)", () => {
    const c = room();
    const b = ball(c);
    c.fx.activate(b);                                             // the tap-roll starts
    run(c.fx, 0.3);
    expect(Math.abs(b.holder.position.x - b.base.px)).toBeGreaterThan(0.05);
    c.fx.kickBall(b, 4, 2);
    c.fx.update(1 / 60, 1);
    expect(b.holder.position.x).toBeCloseTo(b.base.px, 6);        // no leftover roll offset: the holder is exactly where the physics put it
  });

  it("a tap on a ball that is flying does not also roll it: it moves exactly as an untouched kicked ball does", () => {
    const a = room(), z = room();
    const ba = ball(a), bz = ball(z);
    a.fx.kickBall(ba, 5, 3);
    z.fx.kickBall(bz, 5, 3);
    run(a.fx, 0.3);
    run(z.fx, 0.3);
    a.fx.activate(ba);                                            // tapped mid-flight
    const ta = run(a.fx, 1.2, 0.3), tz = run(z.fx, 1.2, 0.3);
    void ta; void tz;
    expect(ba.holder.position.x).toBeCloseTo(bz.holder.position.x, 6);
    expect(ba.holder.position.y).toBeCloseTo(bz.holder.position.y, 6);
  });

  it("a ball at rest after a kick can be tapped and rolled again, and kicked again", () => {
    const c = room();
    const b = ball(c);
    c.fx.kickBall(b, 5, 3);
    run(c.fx, 10);
    expect(b.kick).toBeNull();
    const rest = b.base.px;
    c.fx.activate(b);
    run(c.fx, 0.5, 10);
    expect(Math.abs(b.holder.position.x - rest)).toBeGreaterThan(0.05);      // the tap-roll works again
    run(c.fx, 3, 10.5);
    expect(c.fx.kickBall(b, 5, 3)).toBe(true);
  });
});

describe("onTap and squish", () => {
  it("every tap on a prop is reported to the world once, after the prop has reacted and named itself", () => {
    let c!: ReturnType<typeof room>;
    const toastsWhenHeard: number[] = [];
    const onTap = vi.fn(() => { if (toastsWhenHeard.length === 0) toastsWhenHeard.push(c.toast.mock.calls.length); });
    c = room({ onTap });
    const b = ball(c);
    const cu = cushions(c);
    c.fx.activate(b);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0]![0]).toBe(b);
    expect(c.toast).toHaveBeenCalledWith("Red ball");
    expect(toastsWhenHeard).toEqual([1]);                          // it had already named itself when the world heard about the tap
    c.fx.activate(cu);
    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onTap.mock.calls[1]![0]).toBe(cu);
  });

  it("with nothing listening a tap is as before", () => {
    const c = room();
    const b = ball(c);
    expect(() => c.fx.activate(b)).not.toThrow();
  });

  it("squish squashes the prop and settles back, and says nothing", () => {
    const c = room();
    const cu = cushions(c);
    c.toast.mockClear();
    c.fx.squish(cu);
    let min = 1;
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 1 / 60; c.fx.update(1 / 60, t); min = Math.min(min, cu.holder.scale.y); }
    expect(min).toBeLessThan(0.95);
    run(c.fx, 1.2, t);
    expect(cu.holder.scale.y).toBeCloseTo(1, 6);
    expect(c.toast).not.toHaveBeenCalled();
  });
});
