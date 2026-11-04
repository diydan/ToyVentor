// A fake game for the activity levels' tests: the real Toy Room visitor (walk over, then act), a minimal DOM for the card, a floor that is the identity (a pointer at client (x, y) is on the floor at
// (x, y)), and logs of everything said, shown, played and held. Used by tests/clean.test.ts and tests/cook.test.ts.
import * as THREE from "three";
import { createVisitor, type Visit } from "../../src/features/game/world/runtime/visitRoutine";
import type { ActivityClip, ActivityHeld, ActivityWorld, PointerLike } from "../../src/features/game/world/runtime/activityTypes";

export class FakeEl {
  tag: string; children: FakeEl[] = []; attrs: Record<string, string> = {}; style: { cssText: string; display?: string } = { cssText: "" };
  hidden = false; textContent = ""; type = ""; parent: FakeEl | null = null; listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  get isConnected(): boolean { return this.parent !== null; }
  get ownerDocument() { return { createElement: (t: string) => new FakeEl(t) }; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...kids: FakeEl[]) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  appendChild(k: FakeEl) { this.append(k); return k; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t: string, fn: (e: unknown) => void) { (this.listeners[t] ??= []).push(fn); }
  fire(t: string, e: unknown = { preventDefault() {} }) { for (const f of this.listeners[t] ?? []) f(e); }
  click() { this.fire("click"); }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  /** Shown: not hidden itself, nor inside anything hidden. */
  get shown(): boolean { return !this.hidden && this.style.display !== "none" && (this.parent ? this.parent.shown : true); }
}

/** A hand-turned clock for the hold button. */
export function manualTimers() {
  let now = 0;
  const pending: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    timers: {
      set: (fn: () => void, ms: number) => { const id = nextId++; pending.push({ at: now + ms, fn, id }); return id; },
      clear: (h: unknown) => { const i = pending.findIndex((p) => p.id === h); if (i >= 0) pending.splice(i, 1); },
    },
    advance(ms: number) { now += ms; for (;;) { const i = pending.findIndex((p) => p.at <= now); if (i < 0) break; const [p] = pending.splice(i, 1); p!.fn(); } },
    get pending() { return pending.length; },
  };
}

export interface FakeOptions { band?: number; reduced?: boolean; busy?: boolean; kip?: { x: number; z: number }; canRun?: boolean }

export function fakeActivityWorld(opts: FakeOptions = {}) {
  const root = new THREE.Group();
  const stage = new FakeEl("div");
  const log: string[] = [], says: string[] = [], toasts: string[] = [], held: string[] = [], clips: string[] = [], tones: number[] = [];
  const timers = manualTimers();
  const s = { band: opts.band ?? 0, reduced: opts.reduced ?? false, busy: opts.busy ?? false, canRun: opts.canRun ?? true, kip: { ...(opts.kip ?? { x: 5, z: 0.4 }) }, target: null as null | { x: number; z: number }, wins: 0, host: true, pickPart: null as null | string };
  const visitor = createVisitor({
    position: () => ({ x: s.kip.x, y: 0, z: s.kip.z }), targetX: () => (s.target ? s.target.x : null),
    walkTo: (x, z) => { s.target = { x, z }; s.kip.x = x; s.kip.z = z; },       // the toy gets there at once
    stopWalk: () => { s.target = null; }, face: () => {},
  });
  const world: ActivityWorld = {
    root: () => root, host: () => (s.host ? (stage as unknown as HTMLElement) : null), reduced: () => s.reduced,
    say: (t) => { says.push(t); log.push(`say:${t}`); }, toast: (t) => { toasts.push(t); log.push(`toast:${t}`); },
    tone: (f) => { tones.push(f); },
    clip: (a: ActivityClip) => { clips.push(a); log.push(`clip:${a}`); return true; },
    hold: (i: ActivityHeld) => { held.push(i); log.push(`hold:${i}`); }, release: () => { held.push("-"); log.push("release"); },
    run: (v: Visit) => (s.canRun ? visitor.start(v) : false),
    kip: () => ({ ...s.kip }), band: () => s.band,
    floorAt: (x, y) => ({ x, z: y }),
    pick: (_x, _y, objs) => (s.pickPart ? objs.find((o) => o.userData.part === s.pickPart) ?? null : null),
    project: (x, _y, z) => ({ x, y: z }),
    busy: () => s.busy,
    rungWin: () => { s.wins++; log.push("rungWin"); },
    timers: timers.timers,
  };
  let t = 0;
  let id = 1;
  return {
    world, root, stage, log, says, toasts, held, clips, tones, state: s, timers, visitor,
    /** Advance `seconds` in frames; `each` is called with the activity's update for every frame. */
    run(seconds: number, update: (dt: number) => void, dt = 1 / 30) { for (let k = 0; k < Math.round(seconds / dt); k++) { visitor.update(dt); update(dt); t += dt; } },
    buttons(): FakeEl[] { return stage.all().filter((e) => e.tag === "button" && e.shown); },
    button(name: string): FakeEl | undefined { return stage.all().find((e) => e.tag === "button" && e.shown && e.attrs["data-testid"] === `activity-prompt-${name}`); },
    line(): string { return stage.all().find((e) => e.attrs["data-testid"] === "activity-prompt-line")?.textContent ?? ""; },
    cardCount(): number { return stage.all().filter((e) => e.attrs["data-testid"] === "activity-prompt").length; },
    /** A pointer event at the floor point (x, z). `ms` is its time stamp in milliseconds. */
    ptr(x: number, z: number, ms: number, pointerId = id): PointerLike { return { pointerId, clientX: x, clientY: z, timeStamp: ms }; },
    newPointer() { return ++id; },
  };
}
