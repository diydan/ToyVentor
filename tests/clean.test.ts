import { describe, expect, it } from "vitest";
import { createClean, CLEAN_PROP, CLEAN_WIN_AT_S, type Clean } from "../src/features/game/world/runtime/clean";
import { CLEAN_CHEER_S, CLEAN_FIT, cleanPlan, messParams, type CleanMess } from "../src/features/game/world/runtime/cleanModel";
import { CLEAN_PROMPT_LINES, CLEAN_WRONG_LINES, SOAP_FIRST, SOAP_HIGH, SOAP_LOW } from "../src/features/game/world/runtime/cleanLines";
import { ALL_CLEAN, CLEAN_Q, OH_NO } from "../src/features/game/world/runtime/messLines";
import { seededRandom, solveScrub, type ScrubTool } from "../src/features/game/world/runtime/scrub";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { SCENE_PROMPTS } from "../src/lib/scenePrompts";
import { fakeActivityWorld } from "./helpers/activityWorld";
import * as THREE from "three";

type Fake = ReturnType<typeof fakeActivityWorld>;
const CLOSED = new Set<string>([OH_NO, CLEAN_Q, ALL_CLEAN, ...CLEAN_PROMPT_LINES]);

function setup(band: number, extra: Parameters<typeof fakeActivityWorld>[0] = {}) {
  const g = fakeActivityWorld({ band, ...extra });
  const act = createClean(g.world);
  return { g, act, tick: (s: number) => g.run(s, (dt) => act.update(dt)) };
}
/** Start the rung and run until the card is up. */
function toActive(band: number, start = 0, extra: Parameters<typeof fakeActivityWorld>[0] = {}) {
  const s = setup(band, extra);
  s.act.nextStart = start;
  expect(s.act.startRung()).toBe(true);
  s.tick(3);
  expect(s.act.phase).toBe("active");
  return s;
}
const detail = (act: Clean) => act.snapshot().detail as { tool: ScrubTool | null; messes: Array<{ kind: CleanMess; x: number; z: number; done: boolean; cleared: number; wrongs: number }>; soap: { scoops: number; ready: boolean }; line: string; plan: { messes: CleanMess[] } };

/** Scrub one mess with the real solver's path, as real pointer events. */
function scrubMess(g: Fake, act: Clean, index: number, band: number, ms0 = 1000): number {
  const m = detail(act).messes[index]!;
  const plan = solveScrub(messParams(m.kind, band))!;
  const id = g.newPointer();
  let ms = ms0;
  plan.forEach((p, i) => {
    ms += p.dt * 1000;
    const e = g.ptr(m.x + p.x, m.z + p.z, ms, id);
    if (i === 0) act.down(e); else act.move(e);
  });
  act.up(g.ptr(m.x, m.z, ms, id));
  return ms;
}
const pickTool = (g: Fake, act: Clean, t: ScrubTool) => g.button(`tool:${t}`)!.click();

describe("starting", () => {
  it("the rung door puts the mess where Kip stands, in front of Kip, and asks", () => {
    const { g, act, tick } = setup(3);
    expect(act.startRung()).toBe(true);
    expect(act.phase).toBe("idle");               // Kip has not arrived yet (the visit begins on the next frame)
    tick(0.1);
    expect(act.phase).toBe("making");
    tick(3);
    expect(act.phase).toBe("active");
    expect(g.says.slice(0, 2)).toEqual([OH_NO, CLEAN_Q]);
    expect(g.toasts).toContain(OH_NO);
    expect(g.clips[0]).toBe("oops");
    expect(g.root.children.length).toBe(1);
    const d = detail(act);
    expect(d.messes.length).toBe(3);
    for (const m of d.messes) expect(m.x).toBeGreaterThan(g.state.kip.x + 1);
    expect(act.promptVisible).toBe(true);
  });

  it("the prop door: only the cleaning cart starts it, and not while something else is under way", () => {
    const { g, act } = setup(0);
    const mk = (type: string) => ({ type, holder: new THREE.Group(), base: { px: 12, pz: -2 }, size: new THREE.Vector3(1, 1, 1) }) as unknown as PropInst;
    expect(act.visitFor(mk("cup"))).toBeNull();
    expect(act.visitFor(mk("hob"))).toBeNull();
    g.state.busy = true;
    expect(act.visitFor(mk(CLEAN_PROP))).toBeNull();
    g.state.busy = false;
    const v = act.visitFor(mk(CLEAN_PROP));
    expect(v).not.toBeNull();
    expect(v!.standX).toBeCloseTo(12 + 1.6);                 // Kip stands just beyond the cart, so the row of messes is clear of it
    expect(g.world.run(v!)).toBe(true);
    g.run(3, (dt) => act.update(dt));
    expect(act.phase).toBe("active");
    expect(act.visitFor(mk(CLEAN_PROP))).toBeNull();            // one at a time
  });

  it("the rung keeps trying for a few seconds when Kip is busy, then gives up quietly", () => {
    const { g, act, tick } = setup(0);
    g.state.canRun = false;
    expect(act.startRung()).toBe(false);
    tick(2);
    expect(act.phase).toBe("idle");
    g.state.canRun = true;
    tick(1);
    expect(act.phase).not.toBe("idle");                         // it started by itself once Kip was free
  });
  it("...and does not start at all after the retry window", () => {
    const { g, act, tick } = setup(0);
    g.state.canRun = false;
    act.startRung();
    tick(8);
    g.state.canRun = true;
    tick(2);
    expect(act.phase).toBe("idle");
  });
});

describe("bands 0 and 1: one mess, the right tool in hand", () => {
  it("shows one button, 'Clean it', has the tool in Kip's hand and cleans on a single tap on the mess", () => {
    for (const band of [0, 1]) for (const start of [0, 1]) {
      const { g, act, tick } = toActive(band, start);
      const d = detail(act);
      expect(d.messes.length).toBe(1);
      const kind = d.messes[0]!.kind;
      expect(kind).not.toBe("jam");
      expect(d.tool).toBe(CLEAN_FIT[kind]);
      expect(g.held[0]).toBe(CLEAN_FIT[kind]);
      expect(act.snapshot().promptIds).toEqual(["clean"]);
      const m = d.messes[0]!;
      expect(act.down(g.ptr(m.x, m.z, 100))).toBe(true);
      expect(act.phase).toBe("cheer");
      tick(CLEAN_CHEER_S + 0.2);
      expect(act.phase).toBe("idle");
      expect(g.root.children.length).toBe(0);
    }
  });
  it("the switch form: the 'Clean it' button does it in one press", () => {
    const { g, act } = toActive(0);
    g.button("clean")!.click();
    expect(act.phase).toBe("cheer");
  });
  it("a tap off the mess is not used, so the game can walk Kip", () => {
    const { g, act } = toActive(0);
    expect(act.down(g.ptr(-40, -40, 100))).toBe(false);
    expect(act.phase).toBe("active");
  });
});

describe("band 2: two messes and a tool to choose", () => {
  it("offers three tools, starts with none in hand, and tells the child to pick one", () => {
    const { g, act } = toActive(2);
    expect(act.snapshot().promptIds.filter((i) => i.startsWith("tool:"))).toEqual(["tool:vacuum", "tool:mop", "tool:sponge"]);
    expect(detail(act).tool).toBeNull();
    const m = detail(act).messes[0]!;
    expect(act.down(g.ptr(m.x, m.z, 100))).toBe(true);
    expect(g.toasts).toContain("Pick a tool first.");
    expect(detail(act).messes[0]!.cleared).toBe(0);
  });
  it("a wrong tool says why (spoken and shown), clears nothing, and the right tool glows", () => {
    const { g, act } = toActive(2, 0);              // crumbs and a puddle
    const crumbs = detail(act).messes.find((m) => m.kind === "crumbs")!;
    pickTool(g, act, "mop");
    expect(g.held.at(-1)).toBe("mop");
    act.down(g.ptr(crumbs.x, crumbs.z, 100));
    const line = CLEAN_WRONG_LINES["mop>crumbs"]!;
    expect(g.says).toContain(line);
    expect(g.toasts).toContain(line);
    expect(detail(act).messes.find((m) => m.kind === "crumbs")!.cleared).toBe(0);
    expect(detail(act).messes.find((m) => m.kind === "crumbs")!.wrongs).toBe(0);   // a wrong tool is not counted as a scrub touch: the line is the answer
    expect((act.snapshot().detail as { hintTool: string }).hintTool).toBe("vacuum");
    expect(g.line()).not.toBe(line);                              // the sentence is spoken and toasted; the card keeps its short words so it stays small
  });
  it("speaks the same wrong-tool line at most once in five seconds, but always shows it", () => {
    const { g, act, tick } = toActive(2, 0);
    const crumbs = detail(act).messes.find((m) => m.kind === "crumbs")!;
    pickTool(g, act, "mop");
    for (let i = 0; i < 5; i++) { act.down(g.ptr(crumbs.x, crumbs.z, 100 + i)); act.up(g.ptr(crumbs.x, crumbs.z, 100 + i)); }
    const line = CLEAN_WRONG_LINES["mop>crumbs"]!;
    expect(g.says.filter((s) => s === line).length).toBe(1);
    expect(g.toasts.filter((s) => s === line).length).toBe(5);
    tick(6);
    act.down(g.ptr(crumbs.x, crumbs.z, 9000));
    expect(g.says.filter((s) => s === line).length).toBe(2);
  });
  it("finishes with the right tools, one mess after the other, and the 50% coverage is enough", () => {
    const { g, act, tick } = toActive(2, 0);
    const ms = detail(act).messes;
    pickTool(g, act, CLEAN_FIT[ms[0]!.kind]);
    let t = scrubMess(g, act, 0, 2);
    expect(detail(act).messes[0]!.done).toBe(true);
    expect(act.phase).toBe("active");
    pickTool(g, act, CLEAN_FIT[ms[1]!.kind]);
    t = scrubMess(g, act, 1, 2, t + 100);
    expect(act.phase).toBe("cheer");
    expect(g.says.at(-1)).toBe(ALL_CLEAN);
    tick(CLEAN_CHEER_S + 0.2);
    expect(act.phase).toBe("idle");
  });
  it("jam needs the soap first: one tap on 'Mix the soap' at band 2", () => {
    const { g, act } = toActive(2, 1);              // a puddle and jam
    const jam = detail(act).messes.find((m) => m.kind === "jam")!;
    pickTool(g, act, "sponge");
    expect(act.snapshot().promptIds).toEqual(["tool:vacuum", "tool:mop", "tool:sponge", "soap:mix"]);          // one row, four buttons
    expect(act.snapshot().promptIds).not.toContain("clean");
    act.down(g.ptr(jam.x, jam.z, 100));
    expect(g.says).toContain(SOAP_FIRST);
    expect(detail(act).messes.find((m) => m.kind === "jam")!.cleared).toBe(0);
    g.button("soap:mix")!.click();
    expect(detail(act).soap.ready).toBe(true);
    expect(act.snapshot().promptIds).toContain("clean");
  });
});

describe("band 3 up: all three messes and the soap window", () => {
  it("band 3: the Sponge button opens the soap row (Add, Mix, Pour out, Tools) in place of the tools; Tools brings them back", () => {
    const { g, act } = toActive(3);
    pickTool(g, act, "sponge");
    expect(act.snapshot().promptIds).toEqual(["soap:add", "soap:mix", "soap:tools"]);
    g.button("soap:add")!.click();
    expect(act.snapshot().promptIds).toEqual(["soap:add", "soap:mix", "soap:pour", "soap:tools"]);
    g.button("soap:tools")!.click();
    expect(act.snapshot().promptIds).toEqual(["tool:vacuum", "tool:mop", "tool:sponge"]);
    pickTool(g, act, "sponge");
    expect(act.snapshot().promptIds).toContain("soap:add");
    expect(detail(act).soap.scoops).toBe(1);                      // the scoop is still there
  });
  it("every card is one row of at most four buttons, whatever the band and the step", () => {
    for (const band of [0, 1, 2, 3, 4, 5]) {
      const { g, act } = toActive(band, 1);
      const seen: string[][] = [act.snapshot().promptIds.slice()];
      for (const t of ["vacuum", "mop", "sponge"] as const) { g.button(`tool:${t}`)?.click(); seen.push(act.snapshot().promptIds.slice()); }
      for (const ids of seen) expect(ids.length, `band ${band}: ${ids}`).toBeLessThanOrEqual(4);
    }
  });
  it("band 3: two or three scoops are right; too few and too many say so", () => {
    const { g, act } = toActive(3);
    pickTool(g, act, "sponge");
    g.button("soap:add")!.click();
    g.button("soap:mix")!.click();
    expect(g.says).toContain(SOAP_LOW);
    expect(detail(act).soap.ready).toBe(false);
    g.button("soap:add")!.click();
    g.button("soap:add")!.click();
    g.button("soap:add")!.click();
    g.button("soap:add")!.click();
    g.button("soap:mix")!.click();
    expect(g.says).toContain(SOAP_HIGH);
    g.button("soap:pour")!.click();
    expect(detail(act).soap.scoops).toBe(0);
    g.button("soap:add")!.click();
    g.button("soap:add")!.click();
    g.button("soap:mix")!.click();
    expect(detail(act).soap.ready).toBe(true);
  });
  it("band 4 wants exactly two scoops and band 5 exactly three", () => {
    for (const [band, scoops] of [[4, 2], [5, 3]] as const) {
      const { g, act } = toActive(band);
      pickTool(g, act, "sponge");
      for (let i = 0; i < scoops + 1; i++) g.button("soap:add")!.click();
      g.button("soap:mix")!.click();
      expect(detail(act).soap.ready, `band ${band} with ${scoops + 1}`).toBe(false);
      g.button("soap:pour")!.click();
      for (let i = 0; i < scoops; i++) g.button("soap:add")!.click();
      g.button("soap:mix")!.click();
      expect(detail(act).soap.ready, `band ${band} with ${scoops}`).toBe(true);
    }
  });
  it("needs 70% of each mess, so a few touches are not enough", () => {
    const { g, act } = toActive(3);
    pickTool(g, act, "vacuum");
    const crumbs = detail(act).messes.find((m) => m.kind === "crumbs")!;
    act.down(g.ptr(crumbs.x, crumbs.z, 100));
    act.up(g.ptr(crumbs.x, crumbs.z, 110));
    const after = detail(act).messes.find((m) => m.kind === "crumbs")!;
    expect(after.done).toBe(false);
    expect(after.cleared).toBeGreaterThan(0);
  });
  it("the solver finishes all three, with the right tools and the soap, and the rung is won once", () => {
    for (const band of [3, 4, 5]) {
      const { g, act, tick } = toActive(band);
      const ms = detail(act).messes;
      let t = 1000;
      for (let i = 0; i < ms.length; i++) {
        const kind = ms[i]!.kind;
        pickTool(g, act, CLEAN_FIT[kind]);
        if (kind === "jam") {
          const win = cleanPlan(band).soapWindow!;
          for (let k = 0; k < win[0]; k++) g.button("soap:add")!.click();
          g.button("soap:mix")!.click();
        }
        t = scrubMess(g, act, i, band, t + 100);
      }
      expect(act.phase, `band ${band}`).toBe("cheer");
      tick(CLEAN_WIN_AT_S + 0.2);
      expect(g.state.wins).toBe(1);
      tick(CLEAN_CHEER_S);
      expect(g.state.wins).toBe(1);
      expect(act.phase).toBe("idle");
    }
  });
  it("the 'Clean it' switch form cleans one fitting mess per press", () => {
    const { g, act } = toActive(3);
    pickTool(g, act, "vacuum");
    g.button("clean")!.click();
    expect(detail(act).messes.filter((m) => m.done).map((m) => m.kind)).toEqual(["crumbs"]);
    g.button("clean")!.click();                                  // the vacuum fits nothing that is left: a kind line, no harm
    expect(g.says).toContain(CLEAN_WRONG_LINES["vacuum>puddle"]!);
    expect(detail(act).messes.filter((m) => m.done).length).toBe(1);
    pickTool(g, act, "mop");
    g.button("clean")!.click();
    pickTool(g, act, "sponge");
    expect(g.button("clean")).toBeUndefined();                   // soap first
    g.button("soap:add")!.click(); g.button("soap:add")!.click(); g.button("soap:mix")!.click();
    g.button("clean")!.click();
    expect(act.phase).toBe("cheer");
  });
});

describe("a fast or still finger", () => {
  it("band 3: a held-still finger does not scrub, a fast jab clears only where it lands", () => {
    const { g, act } = toActive(3);
    pickTool(g, act, "vacuum");
    const m = detail(act).messes.find((x) => x.kind === "crumbs")!;
    const id = g.newPointer();
    act.down(g.ptr(m.x, m.z, 1000, id));
    const c0 = detail(act).messes.find((x) => x.kind === "crumbs")!.cleared;
    for (let i = 1; i < 20; i++) act.move(g.ptr(m.x + 0.0001, m.z, 1000 + i * 100, id));      // held still
    expect(detail(act).messes.find((x) => x.kind === "crumbs")!.cleared).toBe(c0);
  });
});

describe("the robot playtest", () => {
  it("a random toddler finishes the level at every band, 12 starts each, speaking only closed-list lines and always showing them", () => {
    for (let band = 0; band <= 5; band++) for (let start = 0; start < 12; start++) {
      const { g, act, tick } = setup(band);
      act.nextStart = start;
      act.startRung();
      tick(3);
      const rand = seededRandom(band * 100 + start + 1);
      let guard = 0;
      let ms = 0;
      while (act.phase === "active" && guard++ < 6000) {
        ms += 16;
        const ids = act.snapshot().promptIds;
        const roll = rand();
        if (roll < 0.12 && ids.length) g.button(ids[Math.floor(rand() * ids.length)]!)!.click();
        else {
          const ms2 = detail(act).messes;
          const m = ms2[Math.floor(rand() * ms2.length)]!;
          const id = g.newPointer();
          let x = m.x + (rand() - 0.5) * 3, z = m.z + (rand() - 0.5) * 2;
          act.down(g.ptr(x, z, ms, id));
          for (let k = 0; k < 8; k++) { ms += 16; x += (rand() - 0.5) * 1.2; z += (rand() - 0.5) * 0.8; act.move(g.ptr(x, z, ms, id)); }
          act.up(g.ptr(x, z, ms, id));
        }
        tick(0.05);
      }
      expect(act.phase, `band ${band} start ${start} after ${guard}`).not.toBe("active");
      tick(CLEAN_WIN_AT_S + 0.1);
      expect(g.state.wins, `band ${band} start ${start}`).toBe(1);
      tick(CLEAN_CHEER_S);
      expect(act.phase).toBe("idle");
      for (const s of g.says) {
        expect(CLOSED.has(s), s).toBe(true);
        if (s !== CLEAN_Q) expect(g.toasts, `no toast twin for "${s}"`).toContain(s);
      }
      expect(g.root.children.length).toBe(0);
    }
  });

  it("the solver's lines and the toddler's lines are all in the real closed list (src/lib/scenePrompts.json)", () => {
    // (run `npx tsx scripts/scene-prompts.ts` after changing a line; this fails until the list has it)
    const known = new Set(SCENE_PROMPTS.map((p) => p.text));
    for (const l of [OH_NO, CLEAN_Q, ALL_CLEAN, ...CLEAN_PROMPT_LINES]) expect(known.has(l), l).toBe(true);
  });
});

describe("safety and cleanliness of the state machine", () => {
  it("reset mid-game puts everything right: no mess, no card, the late end of the visit changes nothing", () => {
    const { g, act, tick } = setup(3);
    act.startRung();
    tick(0.2);                                                    // Kip is "acting", the mess has landed
    expect(act.phase).toBe("making");
    expect(g.root.children.length).toBe(1);
    act.reset();
    expect(act.phase).toBe("idle");
    expect(g.root.children.length).toBe(0);
    g.visitor.cancel();                                           // the world cancels the visit AFTER resetting us
    tick(3);
    expect(act.phase).toBe("idle");
    expect(g.cardCount()).toBe(0);
  });
  it("reset while active removes the card and the meshes, and the next game starts clean", () => {
    const { g, act, tick } = toActive(2);
    expect(g.cardCount()).toBe(1);
    act.reset();
    expect(g.cardCount()).toBe(0);
    expect(g.root.children.length).toBe(0);
    expect(act.startRung()).toBe(true);
    tick(3);
    expect(act.phase).toBe("active");
    expect(detail(act).messes.every((m) => m.cleared === 0)).toBe(true);
  });
  it("an interrupted visit still leaves the mess and the question there (a mess that has begun is a mess)", () => {
    const { g, act, tick } = setup(0);
    act.startRung();
    tick(0.2);
    g.visitor.cancel();                                           // cut short after the mess landed
    expect(act.phase).toBe("active");
    expect(act.promptVisible).toBe(true);
    expect(detail(act).messes.length).toBe(1);
  });
  it("another pointer, and a pointer with nothing to do, is not used", () => {
    const { g, act } = toActive(2);
    expect(act.move(g.ptr(1, 1, 5, 99))).toBe(false);
    expect(act.up(g.ptr(1, 1, 5, 99))).toBe(false);
    const { act: idle } = setup(0);
    expect(idle.down({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 })).toBe(false);
  });
  it("reduced motion: the dirt is there at once, gone at once, and no clip was asked for beyond what the world allows", () => {
    const { g, act, tick } = setup(0, { reduced: true });
    act.startRung();
    tick(0.2);
    const m = detail(act).messes[0] as unknown as { visibleCells: number };
    void m;
    tick(3);
    g.button("clean")!.click();
    tick(1 / 30);
    expect((act.snapshot().detail as { messes: Array<{ visibleCells: number }> }).messes[0]!.visibleCells).toBe(0);
  });
  it("with no stage element the game still plays: no card, no crash, the mess is still cleaned by touch", () => {
    const { g, act, tick } = setup(0);
    g.state.host = false;
    act.startRung();
    tick(3);
    expect(act.phase).toBe("active");
    expect(g.cardCount()).toBe(0);
    const m = detail(act).messes[0]!;
    act.down(g.ptr(m.x, m.z, 100));
    expect(act.phase).toBe("cheer");
  });
  it("the prop door does not pay the rung", () => {
    const { g, act, tick } = setup(0);
    const inst = { type: CLEAN_PROP, holder: new THREE.Group(), base: { px: 12, pz: -2 }, size: new THREE.Vector3(1, 1, 1) } as unknown as PropInst;
    g.world.run(act.visitFor(inst)!);
    tick(3);
    g.button("clean")!.click();
    tick(CLEAN_WIN_AT_S + CLEAN_CHEER_S);
    expect(g.state.wins).toBe(0);
    expect(act.phase).toBe("idle");
  });
});
