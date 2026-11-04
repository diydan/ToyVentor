import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCook, COOK_PROP, type Cook } from "../src/features/game/world/runtime/cook";
import { COOK_CHEER_S, COOK_WIN_AT_S, COUNT_GAP_S, CRACK_S, FLIP_S, SERVE_S, SPOON_S, cookPlan, plateOffset, spoonRange } from "../src/features/game/world/runtime/cookModel";
import {
  COOK_COUNT, COOK_CRACK, COOK_DONE, COOK_FLIP, COOK_FLIP_AGAIN, COOK_HOT, COOK_HOT_OK, COOK_INTRO, COOK_POUR, COOK_PROMPT_LINES, COOK_SERVE, COOK_SERVE_AGAIN,
} from "../src/features/game/world/runtime/cookLines";
import { HOLD_MS } from "../src/features/game/world/runtime/activityPrompt";
import { flickFor } from "../src/features/game/world/runtime/cookModel";
import { seededRandom } from "../src/features/game/world/runtime/scrub";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { SCENE_PROMPTS } from "../src/lib/scenePrompts";
import { fakeActivityWorld } from "./helpers/activityWorld";

type Fake = ReturnType<typeof fakeActivityWorld>;
const CLOSED = new Set<string>(COOK_PROMPT_LINES);

function setup(band: number, extra: Parameters<typeof fakeActivityWorld>[0] = {}) {
  const g = fakeActivityWorld({ band, ...extra });
  const act = createCook(g.world);
  return { g, act, tick: (s: number) => g.run(s, (dt) => act.update(dt)) };
}
type D = { plan: { spoons: number }; poured: number; hot: boolean; line: string; flick: { hits: number; misses: number; window: number }; served: number; placed: Record<string, string>; selected: number | null; parts: { plates: Array<{ x: number; y: number }> }; anchor: { x: number; z: number }; pancakesShown: boolean[] };
const detail = (act: Cook) => act.snapshot().detail as unknown as D;
/** Start the rung, run until the egg is waiting. */
function toEgg(band: number, start = 0, extra: Parameters<typeof fakeActivityWorld>[0] = {}) {
  const s = setup(band, extra);
  s.act.nextStart = start;
  expect(s.act.startRung()).toBe(true);
  s.tick(COOK_INTRO_PLUS);
  expect(s.act.phase).toBe("egg");
  return s;
}
const COOK_INTRO_PLUS = 2.6;
const click = (g: Fake, id: string) => { const b = g.button(id); expect(b, `button ${id}`).toBeDefined(); b!.click(); };
/** Hold the grown-up's button the whole time. */
function holdHot(g: Fake) {
  const b = g.button("hot")!;
  b.fire("pointerdown");
  g.timers.advance(HOLD_MS + 50);
}
/** The solver's whole play through the buttons (the switch form). */
function playButtons(g: Fake, act: Cook, tick: (s: number) => void) {
  const n = detail(act).plan.spoons;
  click(g, "crack"); tick(CRACK_S + 0.2);
  for (let i = 0; i < n; i++) { click(g, "spoon"); tick(0.2); }
  tick(SPOON_S + 0.4);
  holdHot(g);
  click(g, "flip"); tick(FLIP_S + 0.3);
  for (let i = 0; i < n; i++) { click(g, "serve"); tick(SERVE_S + 0.2); }
  tick(0.5);
}

describe("starting", () => {
  it("the rung door puts the kitchen where Kip stands, in front of Kip, says the intro and asks to crack the egg", () => {
    const { g, act, tick } = setup(2);
    expect(act.startRung()).toBe(true);
    tick(0.1);
    expect(act.phase).toBe("making");
    tick(COOK_INTRO_PLUS);
    expect(act.phase).toBe("egg");
    expect(g.says.slice(0, 2)).toEqual([COOK_INTRO, COOK_CRACK]);
    expect(g.toasts).toEqual(expect.arrayContaining([COOK_INTRO, COOK_CRACK]));
    expect(g.held).toContain("spatula");
    expect(g.root.children.length).toBe(1);
    expect(detail(act).anchor.x).toBeGreaterThan(g.state.kip.x + 1);
    expect(g.button("crack")).toBeDefined();
  });
  it("the prop door: only the hob starts it, and not while something else is under way", () => {
    const { g, act } = setup(0);
    const mk = (type: string) => ({ type, holder: new THREE.Group(), base: { px: 12, pz: -2 }, size: new THREE.Vector3(1, 1, 1) }) as unknown as PropInst;
    expect(act.visitFor(mk("cup"))).toBeNull();
    expect(act.visitFor(mk("cleancart"))).toBeNull();
    g.state.busy = true;
    expect(act.visitFor(mk(COOK_PROP))).toBeNull();
    g.state.busy = false;
    const v = act.visitFor(mk(COOK_PROP));
    expect(v!.standX).toBeCloseTo(12 + 1.6);
    expect(g.world.run(v!)).toBe(true);
    g.run(3, (dt) => act.update(dt));
    expect(act.phase).toBe("egg");
    expect(act.visitFor(mk(COOK_PROP))).toBeNull();
  });
  it("the rung keeps trying while Kip is busy, then gives up", () => {
    const { g, act, tick } = setup(0);
    g.state.canRun = false;
    expect(act.startRung()).toBe(false);
    g.state.canRun = true;
    tick(1);
    expect(act.phase).not.toBe("idle");
    const b = setup(0);
    b.g.state.canRun = false;
    b.act.startRung();
    b.tick(8);
    b.g.state.canRun = true;
    b.tick(2);
    expect(b.act.phase).toBe("idle");
  });
});

describe("the five beats, through the buttons (the switch form)", () => {
  it("crack, count, hot, flip, serve, cheer, at every band", () => {
    for (let band = 0; band <= 5; band++) {
      const { g, act, tick } = toEgg(band, 1);
      const n = detail(act).plan.spoons;
      click(g, "crack");
      expect(g.button("crack")).toBeUndefined();                       // the card is out of the way while the egg cracks
      tick(CRACK_S + 0.2);
      expect(act.phase, `band ${band}`).toBe("pour");
      expect(g.says).toContain(COOK_POUR);
      for (let i = 0; i < n; i++) { click(g, "spoon"); tick(COUNT_GAP_S + 0.1); }
      expect(detail(act).poured).toBe(n);
      expect(g.says).toEqual(expect.arrayContaining(COOK_COUNT.slice(0, n)));
      tick(SPOON_S + 0.4);
      expect(act.phase).toBe("hot");
      expect(g.says).toContain(COOK_HOT);
      holdHot(g);
      expect(act.phase).toBe("flip");
      expect(g.says).toEqual(expect.arrayContaining([COOK_HOT_OK, COOK_FLIP]));
      click(g, "flip");
      tick(FLIP_S + 0.3);
      expect(act.phase).toBe("serve");
      for (let i = 0; i < n; i++) { click(g, "serve"); tick(SERVE_S + 0.2); }
      expect(act.phase, `band ${band}`).toBe("cheer");
      expect(g.says.at(-1)).toBe(COOK_DONE);
      tick(COOK_WIN_AT_S + 0.1);
      expect(g.state.wins).toBe(1);
      tick(COOK_CHEER_S);
      expect(act.phase).toBe("idle");
      expect(g.state.wins).toBe(1);
      expect(g.root.children.length).toBe(0);
      expect(g.held.at(-1)).toBe("-");
    }
  });
  it("counts to exactly the number on the card: 1 to 3 for bands 0 to 2, 1 to 6 from band 3, never more", () => {
    for (let band = 0; band <= 5; band++) {
      const [lo, hi] = spoonRange(band);
      const seen = new Set<number>();
      for (let start = 0; start < 12; start++) {
        const { g, act, tick } = toEgg(band, start);
        const n = detail(act).plan.spoons;
        seen.add(n);
        click(g, "crack"); tick(CRACK_S + 0.2);
        for (let i = 0; i < n + 3; i++) { g.button("spoon")?.click(); tick(0.1); }       // a toddler taps far too often
        expect(detail(act).poured).toBe(n);
        expect(detail(act).pancakesShown.filter(Boolean).length).toBe(n);
      }
      expect([...seen].sort()).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    }
  });
  it("the count is said once per spoon, in order, and shown every time even when the taps come faster than the voice", () => {
    const { g, act, tick } = toEgg(3, 4);                              // five spoons
    click(g, "crack"); tick(CRACK_S + 0.2);
    for (let i = 0; i < 5; i++) click(g, "spoon");                     // all at once
    expect(g.toasts.filter((t) => COOK_COUNT.includes(t))).toEqual(COOK_COUNT.slice(0, 5));
    const said = g.says.filter((t) => COOK_COUNT.includes(t));
    expect(said[0]).toBe("One!");
    expect(said.at(-1)).toBe("Five!");                                 // the last number is always said
    expect(said.length).toBeLessThan(5);
    void act;
  });
});

describe("it's hot: the grown-up's hold", () => {
  it("the button needs the full 1.2 s hold: a short press does nothing, a click does nothing, a full hold does", () => {
    const { g, act, tick } = toEgg(2);
    click(g, "crack"); tick(CRACK_S + 0.2);
    const n = detail(act).plan.spoons;
    for (let i = 0; i < n; i++) { click(g, "spoon"); tick(0.2); }
    tick(SPOON_S + 0.4);
    expect(act.phase).toBe("hot");
    const b = g.button("hot")!;
    b.click();                                                         // a bare click is not a hold
    expect(act.phase).toBe("hot");
    b.fire("pointerdown"); g.timers.advance(HOLD_MS - 200); b.fire("pointerup");
    expect(act.phase).toBe("hot");
    expect(detail(act).hot).toBe(false);
    g.timers.advance(2000);
    expect(act.phase).toBe("hot");                                     // letting go cancelled it
    b.fire("pointerdown"); g.timers.advance(HOLD_MS - 100);
    expect(act.phase).toBe("hot");
    g.timers.advance(200);
    expect(act.phase).toBe("flip");
    expect(detail(act).hot).toBe(true);
  });
  it("the hot line asks for a grown-up and the hold button is a real, named, 56 px button", () => {
    const { g, act, tick } = toEgg(0);
    click(g, "crack"); tick(CRACK_S + 0.2);
    const n = detail(act).plan.spoons;
    for (let i = 0; i < n; i++) { click(g, "spoon"); tick(0.2); }
    tick(SPOON_S + 0.4);
    expect(g.line()).toBe(COOK_HOT);
    expect(COOK_HOT).toMatch(/grown-up/);
    const b = g.button("hot")!;
    expect(b.attrs["aria-label"]).toMatch(/grown-up/i);
    expect(b.style.cssText).toContain("min-height:60px");
  });
});

describe("the flip", () => {
  /** Run to the flip beat. */
  function toFlip(band: number, start = 0) {
    const s = toEgg(band, start);
    const n = detail(s.act).plan.spoons;
    click(s.g, "crack"); s.tick(CRACK_S + 0.2);
    for (let i = 0; i < n; i++) { click(s.g, "spoon"); s.tick(0.2); }
    s.tick(SPOON_S + 0.4);
    holdHot(s.g);
    expect(s.act.phase).toBe("flip");
    return s;
  }
  const pan = (g: Fake) => { g.state.pickPart = "pan"; };
  it("bands 0 and 1 cannot miss: a tap on the pan at any moment flips it", () => {
    for (const band of [0, 1]) for (const wait of [0, 0.3, 0.9, 1.3]) {
      const { g, act, tick } = toFlip(band);
      tick(wait);
      pan(g);
      expect(act.down(g.ptr(5, 5, 0, 7))).toBe(true);
      expect(act.up(g.ptr(5, 5, 50, 7))).toBe(true);
      expect(g.says).not.toContain(COOK_FLIP_AGAIN);
      tick(FLIP_S + 0.3);
      expect(act.phase, `band ${band} wait ${wait}`).toBe("serve");
    }
  });
  it("band 3: a swipe up at the sweet spot flips; a swipe at the wrong moment, or the wrong way, gets the kind line and the window widens", () => {
    const { g, act, tick } = toFlip(3);
    const f = flickFor(3);
    pan(g);
    // wrong way
    act.down(g.ptr(100, 300, 0, 7)); act.up(g.ptr(100, 380, 10, 7));                 // down the screen
    expect(g.says).toContain(COOK_FLIP_AGAIN);
    expect(g.toasts).toContain(COOK_FLIP_AGAIN);
    expect(detail(act).flick.misses).toBe(1);
    // right way, wrong moment (the cycle is 1.6 s, the spot at 1.2 s: just after the start of the cycle is the far side)
    const w0 = detail(act).flick.window;
    const t0 = (g.state as unknown as { t?: number }).t ?? 0; void t0;
    tick(0.3);
    act.down(g.ptr(100, 300, 0, 7)); act.up(g.ptr(100, 200, 10, 7));
    const d = detail(act).flick;
    expect(d.misses).toBeGreaterThanOrEqual(1);
    expect(d.window).toBeGreaterThanOrEqual(w0);
    expect(act.phase).toBe("flip");
    // keep trying: the window grows until a swipe up lands, whatever the moment
    let guard = 0;
    while (act.phase === "flip" && guard++ < 40) { tick(0.37); act.down(g.ptr(100, 300, 0, 7)); act.up(g.ptr(100, 200, 10, 7)); }
    tick(FLIP_S + 0.3);
    expect(act.phase).toBe("serve");
    expect(guard).toBeLessThan(40);
    void f;
  });
  it("a swipe that does not start on the pan is not the flip's, and a touch too short to be a swipe is only a touch", () => {
    const { g, act } = toFlip(3);
    g.state.pickPart = null;
    expect(act.down(g.ptr(100, 300, 0, 7))).toBe(false);
    g.state.pickPart = "pan";
    expect(act.down(g.ptr(100, 300, 0, 7))).toBe(true);
    act.up(g.ptr(101, 299, 10, 7));
    expect(act.phase).toBe("flip");
    expect(detail(act).flick.misses).toBe(0);
  });
});

describe("the serve: one pancake to each plate", () => {
  function toServe(band: number, start: number) {
    const s = toEgg(band, start);
    const n = detail(s.act).plan.spoons;
    click(s.g, "crack"); s.tick(CRACK_S + 0.2);
    for (let i = 0; i < n; i++) { click(s.g, "spoon"); s.tick(0.2); }
    s.tick(SPOON_S + 0.4);
    holdHot(s.g);
    click(s.g, "flip"); s.tick(FLIP_S + 0.3);
    expect(s.act.phase).toBe("serve");
    return { ...s, n };
  }
  const plateAtWorld = (act: Cook, j: number, n: number) => { const o = plateOffset(j, n); const a = detail(act).anchor; return { x: a.x + o.x, z: a.z + o.z }; };
  it("tap a pancake, tap a plate: it goes there, and a second pancake on the same plate is sent back with a kind line", () => {
    const { g, act, tick, n } = toServe(3, 2);                       // three pancakes
    expect(n).toBe(3);
    g.state.pickPart = "pan";
    act.down(g.ptr(0, 0, 0, 7)); act.up(g.ptr(0, 0, 5, 7));          // a tap on the pan picks one up
    expect(detail(act).selected).toBe(0);
    g.state.pickPart = null;
    const p0 = plateAtWorld(act, 1, n);
    expect(act.down(g.ptr(p0.x, p0.z, 20, 8))).toBe(true);
    act.up(g.ptr(p0.x, p0.z, 30, 8));
    expect(detail(act).placed).toEqual({ pancake0: "plate1" });
    tick(SERVE_S + 0.2);
    g.state.pickPart = "pan";
    act.down(g.ptr(0, 0, 40, 9)); act.up(g.ptr(0, 0, 45, 9));
    expect(detail(act).selected).toBe(1);
    g.state.pickPart = null;
    act.down(g.ptr(p0.x, p0.z, 60, 10));                             // the same plate again
    expect(g.says).toContain(COOK_SERVE_AGAIN);
    expect(g.toasts).toContain(COOK_SERVE_AGAIN);
    expect(detail(act).placed).toEqual({ pancake0: "plate1" });
    expect(detail(act).selected).toBeNull();                         // it went back to the pan
    expect(act.phase).toBe("serve");
  });
  it("drag a pancake from the pan to a plate", () => {
    const { g, act, tick, n } = toServe(3, 2);
    g.state.pickPart = "pan";
    expect(act.down(g.ptr(0, 0, 0, 7))).toBe(true);
    g.state.pickPart = null;
    const p = plateAtWorld(act, 2, n);
    expect(act.move(g.ptr(p.x, p.z, 10, 7))).toBe(true);
    expect(act.up(g.ptr(p.x, p.z, 20, 7))).toBe(true);
    expect(detail(act).placed).toEqual({ pancake0: "plate2" });
    tick(0.5);
  });
  it("a tap that misses every plate does nothing and the pancake stays in the hand", () => {
    const { g, act } = toServe(3, 2);
    g.state.pickPart = "pan";
    act.down(g.ptr(0, 0, 0, 7)); act.up(g.ptr(0, 0, 5, 7));
    g.state.pickPart = null;
    const a = detail(act).anchor;
    expect(act.down(g.ptr(a.x + 40, a.z + 40, 10, 8))).toBe(false);
    expect(detail(act).selected).toBe(0);
    expect(detail(act).served).toBe(0);
  });
  it("the cheer comes only when every plate has its pancake", () => {
    const { g, act, tick, n } = toServe(3, 5);                       // six
    for (let j = 0; j < n; j++) {
      g.state.pickPart = "pan";
      act.down(g.ptr(0, 0, j * 100, 7)); act.up(g.ptr(0, 0, j * 100 + 5, 7));
      g.state.pickPart = null;
      const p = plateAtWorld(act, j, n);
      act.down(g.ptr(p.x, p.z, j * 100 + 20, 8));
      tick(SERVE_S + 0.2);
      expect(act.phase).toBe(j < n - 1 ? "serve" : "cheer");
    }
    expect(g.says.at(-1)).toBe(COOK_DONE);
  });
});

describe("the robot playtest", () => {
  it("a random toddler finishes the level at every band, 12 starts each, speaking only closed-list lines and always showing them", () => {
    for (let band = 0; band <= 5; band++) for (let start = 0; start < 12; start++) {
      const { g, act, tick } = setup(band);
      act.nextStart = start;
      act.startRung();
      tick(COOK_INTRO_PLUS);
      const rand = seededRandom(band * 100 + start + 1);
      let guard = 0, ms = 0;
      const parts = ["egg", "bowl", "pan", null];
      while (act.phase !== "idle" && act.phase !== "cheer" && guard++ < 4000) {
        ms += 16;
        const roll = rand();
        const ids = act.snapshot().promptIds;
        if (roll < 0.25 && ids.length) {
          const id = ids[Math.floor(rand() * ids.length)]!;
          const b = g.button(id)!;
          if (id === "hot") { if (rand() < 0.5) { b.fire("pointerdown"); g.timers.advance(rand() < 0.5 ? 300 : HOLD_MS + 50); if (rand() < 0.5) b.fire("pointerup"); } }
          else b.click();
        } else {
          g.state.pickPart = parts[Math.floor(rand() * parts.length)] ?? null;
          const a = detail(act).anchor;
          const x = a.x + (rand() - 0.5) * 4, z = a.z + (rand() - 0.5) * 3;
          const id = g.newPointer();
          act.down(g.ptr(x, z, ms, id));
          act.move(g.ptr(x + 1, z, ms + 8, id));
          act.up(g.ptr(x + (rand() - 0.5) * 2, z + (rand() - 0.5) * 2, ms + 16, id));
          // a swipe is the toddler's own: a drag up or down over the pan
          if (rand() < 0.3) { g.state.pickPart = "pan"; const id2 = g.newPointer(); act.down(g.ptr(0, 300, ms, id2)); act.up(g.ptr(0, 300 + (rand() < 0.5 ? -60 : 60), ms + 10, id2)); }
        }
        tick(0.1 + rand() * 0.6);
      }
      expect(["cheer", "idle"], `band ${band} start ${start} after ${guard} in ${act.phase}`).toContain(act.phase);
      tick(COOK_WIN_AT_S + 0.1);
      expect(g.state.wins, `band ${band} start ${start}`).toBe(1);
      tick(COOK_CHEER_S);
      expect(act.phase).toBe("idle");
      for (const s of g.says) {
        expect(CLOSED.has(s), s).toBe(true);
        expect(g.toasts, `no toast twin for "${s}"`).toContain(s);
      }
      expect(g.root.children.length).toBe(0);
    }
  });

  it("every line is in the real closed list (src/lib/scenePrompts.json)", () => {
    const known = new Set(SCENE_PROMPTS.map((p) => p.text));
    for (const l of COOK_PROMPT_LINES) expect(known.has(l), l).toBe(true);
  });
});

describe("safety and cleanliness of the state machine", () => {
  it("reset mid-game puts everything right, at every beat: no kitchen, no card, nothing in hand, and a late visit end changes nothing", () => {
    for (const upto of ["making", "egg", "pour", "hot", "flip", "serve"] as const) {
      const { g, act, tick } = setup(2);
      act.startRung();
      tick(upto === "making" ? 0.2 : COOK_INTRO_PLUS);
      if (upto !== "making" && upto !== "egg") {
        const n = detail(act).plan.spoons;
        click(g, "crack"); tick(CRACK_S + 0.2);
        if (upto !== "pour") { for (let i = 0; i < n; i++) { click(g, "spoon"); tick(0.2); } tick(SPOON_S + 0.4); }
        if (upto === "flip" || upto === "serve") holdHot(g);
        if (upto === "serve") { click(g, "flip"); tick(FLIP_S + 0.3); }
      }
      expect(act.phase).toBe(upto);
      act.reset();
      expect(act.phase).toBe("idle");
      expect(g.root.children.length, upto).toBe(0);
      g.visitor.cancel();
      tick(2);
      expect(act.phase).toBe("idle");
      expect(g.cardCount(), upto).toBe(0);
    }
  });
  it("an interrupted visit still leaves the kitchen and asks (a kitchen that has begun is a kitchen)", () => {
    const { g, act, tick } = setup(0);
    act.startRung();
    tick(0.2);
    g.visitor.cancel();
    expect(act.phase).toBe("egg");
    expect(act.promptVisible).toBe(true);
  });
  it("reduced motion: every beat lands finished at once and the whole level still plays through", () => {
    const { g, act, tick } = setup(2, { reduced: true });
    act.startRung();
    tick(COOK_INTRO_PLUS);
    expect(act.phase).toBe("egg");
    const n = detail(act).plan.spoons;
    click(g, "crack");
    expect(act.phase).toBe("pour");
    for (let i = 0; i < n; i++) click(g, "spoon");
    tick(0.1);
    expect(act.phase).toBe("hot");
    holdHot(g);
    click(g, "flip");
    expect(act.phase).toBe("serve");
    expect(detail(act).pancakesShown.every(Boolean)).toBe(true);
    for (let i = 0; i < n; i++) click(g, "serve");
    tick(0.1);
    expect(act.phase).toBe("cheer");
    expect(g.clips.filter((c) => c !== "oops")).toEqual(expect.arrayContaining(["cheer"]));
  });
  it("with no stage element the game still plays by touch: no card, no crash", () => {
    const { g, act, tick } = setup(0);
    g.state.host = false;
    act.startRung();
    tick(COOK_INTRO_PLUS);
    expect(g.cardCount()).toBe(0);
    g.state.pickPart = "egg";
    expect(act.down(g.ptr(0, 0, 0, 3))).toBe(true);
    tick(CRACK_S + 0.2);
    expect(act.phase).toBe("pour");
  });
  it("the prop door does not pay the rung", () => {
    const { g, act, tick } = setup(0);
    const inst = { type: COOK_PROP, holder: new THREE.Group(), base: { px: 12, pz: -2 }, size: new THREE.Vector3(1, 1, 1) } as unknown as PropInst;
    g.world.run(act.visitFor(inst)!);
    tick(COOK_INTRO_PLUS);
    playButtons(g, act, tick);
    tick(COOK_WIN_AT_S + COOK_CHEER_S);
    expect(g.state.wins).toBe(0);
    expect(act.phase).toBe("idle");
  });
  it("the plan matches cookPlan for the band and start", () => {
    for (let band = 0; band <= 5; band++) {
      const { act } = toEgg(band, 3);
      expect(detail(act).plan.spoons).toBe(cookPlan(band, 3).spoons);
    }
  });
});
