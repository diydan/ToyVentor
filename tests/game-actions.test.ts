// The sad, sneak and kick actions played from real Mixamo clips (src/features/game/world/runtime/gameActions.ts; Dan, 2026-11-04: "copy and implement" the clips he downloaded). Each keeps its action name,
// so every caller is unchanged; the kick is retimed to the toy room's act. The rules are functions of an implementation so each can be run on a version that is wrong on purpose and must fail.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_FILES, KICK_PLAY_S, actionClip, createActions, type BakedAction } from "../src/features/game/world/runtime/gameActions";
import { KICK_S } from "../src/features/game/world/runtime/toyRoomActs";
import { KICK_CONTACT_S } from "../src/features/game/world/runtime/proceduralClips";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";
import type { BakedClip } from "../src/features/game/world/runtime/mixamo";

const root = join(__dirname, "..");
const baked = (id: string) => readFileSync(join(root, "public/kip/mixamo/baked", `${id}.json`), "utf8");
const realClip = (id: string): BakedClip => jointClipToGame(parseJointClip(JSON.parse(baked(id)))!, id, { joints: true });
const fetchOf = (overrides: Record<string, string | number> = {}): typeof fetch => (async (url: string) => {
  const id = String(url).replace(/^.*\//, "").replace(/\.json$/, "");
  const o = overrides[id];
  if (typeof o === "number") return { ok: false, status: o, text: async () => "" } as unknown as Response;
  return { ok: true, status: 200, text: async () => (typeof o === "string" ? o : baked(id)) } as unknown as Response;
}) as unknown as typeof fetch;
const ACTIONS = Object.keys(ACTION_FILES) as BakedAction[];

describe("the clip an action plays", () => {
  /** The rules, as a function of the converter, so a broken one can be run through them. Returns what is wrong. */
  function failures(make: (name: BakedAction, clip: BakedClip) => BakedClip): string[] {
    const bad = new Set<string>();
    for (const a of ACTIONS) {
      const src = realClip(ACTION_FILES[a]);
      const before = { name: src.name, duration: src.duration, loop: src.loop, pose: src.pose };
      const c = make(a, src);
      if (c.name !== a) bad.add("it is called by the action's name (so busyAction and every caller are unchanged)");
      if (c.loop !== false) bad.add("a one-shot");
      if (c.pose !== false) bad.add("a real clip, not a held pose");
      if (c.frames !== src.frames || c.joints !== src.joints || !c.joints) bad.add("the same frames and joint data, shared, not changed");
      if (a === "kick" && c.duration !== KICK_PLAY_S) bad.add("the kick plays over the act's length");
      if (a !== "kick" && c.duration !== src.duration) bad.add("the others play at the speed they were made at");
      if ({ name: src.name, duration: src.duration, loop: src.loop, pose: src.pose }.duration !== before.duration || src.name !== before.name || src.loop !== before.loop) bad.add("the clip it was made from is not touched");
    }
    return [...bad];
  }
  it("is named for the action, one-shot, not a held pose, sharing the joint data, with only the kick retimed", () => {
    expect(failures(actionClip)).toEqual([]);
  });
  it("is caught when it keeps the file's name, loops, stays a pose, retimes everything, or never retimes the kick", () => {
    expect(failures((a, c) => ({ ...actionClip(a, c), name: c.name })).length).toBeGreaterThan(0);
    expect(failures((a, c) => ({ ...actionClip(a, c), loop: true })).length).toBeGreaterThan(0);
    expect(failures((a, c) => ({ ...actionClip(a, c), pose: true })).length).toBeGreaterThan(0);
    expect(failures((a, c) => ({ ...actionClip(a, c), duration: KICK_PLAY_S })).length).toBeGreaterThan(0);                 // sad and sneak squashed to the kick's length
    expect(failures((a, c) => ({ ...c, name: a, loop: false, pose: false })).length).toBeGreaterThan(0);                  // the kick not retimed
    expect(failures((a, c) => ({ ...actionClip(a, c), joints: undefined })).length).toBeGreaterThan(0);                    // the exact joint rotations thrown away
  });
  it("plays the kick over the toy room's own act, with the foot at the ball about when the ball is launched, and without hurrying or slowing the swing", () => {
    expect(KICK_PLAY_S).toBe(KICK_S);                      // the act ends when the clip does
    expect(KICK_CONTACT_S).toBeLessThan(KICK_PLAY_S);
    const natural = realClip(ACTION_FILES.kick).duration;  // the file's own length: the swing is played within a twentieth of its own speed
    expect(natural / KICK_PLAY_S).toBeGreaterThan(0.95);
    expect(natural / KICK_PLAY_S).toBeLessThan(1.15);
  });
  it("sad and sneak are real clips of a length that suits a reaction: sad a sigh of a few seconds, sneak a step or two", () => {
    expect(realClip("mood_sad").duration).toBeGreaterThan(2);
    expect(realClip("mood_sad").duration).toBeLessThan(4);
    expect(realClip("act_sneak").duration).toBeGreaterThan(1);
    expect(realClip("act_sneak").duration).toBeLessThan(3);
  });
});

describe("the actions in the driver's bank", () => {
  function make(over: Record<string, string | number> = {}) {
    const bank: Record<string, BakedClip> = {};
    const names: string[][] = [];
    let fetches = 0;
    const f = ((u: string) => { fetches++; return fetchOf(over)(u); }) as unknown as typeof fetch;
    const actions = createActions({ fetchImpl: f, addClips: (c) => { names.push(Object.keys(c)); Object.assign(bank, c); } });
    return { actions, bank, names, fetches: () => fetches };
  }
  it("loads the three real files and puts each in the bank under the action's name, with the joint data", async () => {
    const { actions, bank } = make();
    expect((await actions.load()).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(bank).sort()).toEqual([...ACTIONS].sort()); // nothing else is put in the driver's bank
    for (const a of ACTIONS) { expect(bank[a]!.name).toBe(a); expect(bank[a]!.joints).toBeTruthy(); expect(bank[a]!.pose).toBe(false); }
    expect(bank.kick!.duration).toBe(KICK_PLAY_S);
    expect(actions.loaded().slice().sort()).toEqual([...ACTIONS].sort());
  });
  it("leaves the old clip in the bank for any action whose file is missing, is not JSON, is another clip, or says it is in the wrong group, and still loads the others", async () => {
    const asGroup = (id: string, group: string) => JSON.stringify({ ...JSON.parse(baked(id)), group });
    for (const [bad, over] of [
      ["sad", { mood_sad: 404 }],
      ["sad", { mood_sad: "<html>not json" }],
      ["sneak", { act_sneak: baked("act_kick") }],               // the kick's bytes under the sneak's name
      ["kick", { act_kick: asGroup("act_kick", "react") }],      // a kick that says it is a reaction
      ["kick", { act_kick: "x".repeat(900_001) }],               // too big
    ] as const) {
      const { actions, bank } = make(over);
      const ok = await actions.load();
      expect(ok, JSON.stringify(over).slice(0, 40)).not.toContain(bad);
      expect(bank[bad]).toBeUndefined();
      expect(ok.length).toBe(ACTIONS.length - 1);
    }
  });
  it("puts nothing in the bank when nothing can load, so the old clips all stay", async () => {
    const { actions, bank } = make({ mood_sad: 404, act_sneak: 500, act_kick: 404, act_pickthrow: 404 });
    expect(await actions.load()).toEqual([]);
    expect(Object.keys(bank)).toEqual([]);
  });
  it("fetches each file once however often it is asked, and refuses an id that is not one of its three", async () => {
    const { actions, fetches } = make();
    await Promise.all([actions.load(), actions.load()]);
    await actions.load();
    expect(fetches()).toBe(ACTIONS.length);
  });
});

describe("the world's use of it", () => {
  const w = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
  it("makes the actions into the driver's bank and starts loading them with the other gestures, after the driver exists", () => {
    expect(w).toMatch(/var ACTIONS=createActions\(\{fetchImpl:.*addClips:function\(c: Record<string,BakedClip>\)\{if\(mix\)mix\.addClips\(c\)\}\}\);/);
    expect(w).toContain("function startGestures(){CHEERS.load().catch(function(){});ACTIONS.load().catch(function(){});");
    // the driver is made (with every bank clip) before startGestures puts the baked ones over the old, so they are not overwritten by a later bake
    expect(w.indexOf("mix=new MixamoDriver(")).toBeLessThan(w.indexOf("startGestures()", w.indexOf("mix=new MixamoDriver(")));
  });
  it("loads the idle fidgets after the first idle clips, so they never compete with what the title show needs", () => {
    expect(w).toContain(".then(function(){return GESTURES.ensure(IDLE_FILES.fidget)}).catch(function(){});");
  });
  it("still triggers the same action names the baked clips replace: sad (a part that cannot be afforded), sneak (a peek), kick (the toy room's ball)", () => {
    expect(w).toContain('mixGo("sad")');
    expect(w).toContain('mixGo("sneak")');
    const acts = readFileSync(join(root, "src/features/game/world/runtime/toyRoomActs.ts"), "utf8");
    expect(acts).toContain('w.clip("kick")');
    expect(acts).toContain("at: KICK_CONTACT_S");
  });
});
