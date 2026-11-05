// The character's Mixamo moves (runtime/gameMoves.ts): the jump, the shove, and the idle / walk / run cycles, all played as the bench's own joint data, never cut, joined or sped up.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";
import { CLIP_JOINT_KEYS, KIP_HIP_REST_MM, type BakedClip } from "../src/features/game/world/runtime/mixamo";
import { LOCO_FILES, MOVE_FILES, SHOVE_FADE_S, SHOVE_PLAY_S, framePeriod, loadMoves, shoveContactSeconds } from "../src/features/game/world/runtime/gameMoves";

const BAKED = join(process.cwd(), "public/kip/mixamo/baked");
const HAVE_BAKED = existsSync(join(BAKED, "index.json"));
const file = (id: string) => readFileSync(join(BAKED, `${id}.json`), "utf8");
const real = (id: string, name: string): BakedClip => jointClipToGame(parseJointClip(JSON.parse(file(id)))!, name, { joints: true });

describe("frames and times", () => {
  it.skipIf(!HAVE_BAKED)("a frame is duration / (frames - 1) long, as the driver maps time to frames", () => {
    const c = real(MOVE_FILES.jump, "jump");
    expect(framePeriod(c)).toBeCloseTo(c.duration / (c.frames - 1), 9);
    expect(framePeriod({ ...c, frames: 1 })).toBe(c.duration);
  });
});

/** Every joint rotation is a unit quaternion and every number is finite: what the Snap rig's solver needs. */
function jointsAreSound(c: BakedClip) {
  const J = c.joints!;
  for (const k of CLIP_JOINT_KEYS) {
    expect(J[k].length, k).toBe(c.frames * 4);
    for (let i = 0; i < c.frames; i++) expect(Math.hypot(J[k][i * 4]!, J[k][i * 4 + 1]!, J[k][i * 4 + 2]!, J[k][i * 4 + 3]!), `${k} frame ${i}`).toBeCloseTo(1, 3);
  }
  expect(J.hipsMm.length).toBe(c.frames * 3);
  for (const v of J.hipsMm) expect(Number.isFinite(v)).toBe(true);
}

describe.skipIf(!HAVE_BAKED)("the real jump clip (react_jump.json), as joint data", () => {
  const c = HAVE_BAKED ? real(MOVE_FILES.jump, "jump") : (null as unknown as BakedClip);
  it("has the bench's joint rotations (so the elbows and knees bend) and is not planted (it leaves the ground)", () => {
    expect(c.joints).toBeDefined();
    expect(c.planted).toBe(false);
    jointsAreSound(c);
  });
  it("is a short one-shot: a crouch, a take-off, an apex well up and a landing, in under a second", () => {
    expect(c.duration).toBeGreaterThan(0.8);
    expect(c.duration).toBeLessThan(1.1);
    const dt = framePeriod(c), y = (i: number) => c.joints!.hipsMm[i * 3 + 1]!;
    let peak = -Infinity, peakAt = 0, low = Infinity;
    for (let i = 0; i < c.frames; i++) { if (y(i) > peak) { peak = y(i); peakAt = i * dt; } low = Math.min(low, y(i)); }
    expect(peak - KIP_HIP_REST_MM).toBeGreaterThan(20);                      // mm up from standing: a real jump
    expect(peakAt).toBeGreaterThan(0.2); expect(peakAt).toBeLessThan(0.5);
    expect(low).toBeLessThan(KIP_HIP_REST_MM - 1);                           // the crouch before it
    expect(Math.abs(y(0) - KIP_HIP_REST_MM)).toBeLessThan(2);                // it starts standing
    expect(Math.abs(y(c.frames - 1) - KIP_HIP_REST_MM)).toBeLessThan(4);    // and lands standing
  });
  it("the limb directions the plain rig falls back on are still made, unit length", () => {
    for (const ch of ["armL", "armR", "legL", "legR"] as const) for (let i = 0; i < c.frames; i++) expect(Math.hypot(c[ch][i * 3]!, c[ch][i * 3 + 1]!, c[ch][i * 3 + 2]!)).toBeCloseTo(1, 3);
  });
});

describe.skipIf(!HAVE_BAKED)("the real push (act_push.json), as the shove", () => {
  const c = HAVE_BAKED ? real(MOVE_FILES.shove, "shove") : (null as unknown as BakedClip);
  it("is the whole eight-second clip as authored: 241 frames at 30 fps, joint data, planted", () => {
    expect(c.duration).toBeCloseTo(8, 6);
    expect(c.frames).toBe(241);
    expect(c.planted).toBe(true);
    jointsAreSound(c);
  });
  it("the arms reach out in front within the first second (the shove lands there), and the contact time says so", () => {
    const t = shoveContactSeconds(c);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(1.0);
    expect(c.armR[Math.round(t / framePeriod(c)) * 3 + 2]).toBeGreaterThanOrEqual(0.8);
  });
  it("the part that is played (SHOVE_PLAY_S) contains the reach and some of the press, and is a small part of the clip", () => {
    expect(SHOVE_PLAY_S).toBeGreaterThan(shoveContactSeconds(c) + 1);
    expect(SHOVE_PLAY_S).toBeLessThan(c.duration / 2);
    expect(SHOVE_FADE_S).toBeGreaterThan(0.1);
    expect(SHOVE_FADE_S).toBeLessThan(SHOVE_PLAY_S / 2);
  });
  it("the hips are the clip's own (not held still): the knees bend and the body dips as it pushes", () => {
    const y = (i: number) => c.joints!.hipsMm[i * 3 + 1]!;
    let low = Infinity;
    for (let i = 0; i < c.frames; i++) low = Math.min(low, y(i));
    expect(KIP_HIP_REST_MM - low).toBeGreaterThan(3);
  });
  it("a contact time falls back to a sensible one for a clip whose arm never reaches forward", () => {
    const flat = { ...c, armR: new Float32Array(c.armR.length).fill(0) };
    expect(shoveContactSeconds(flat)).toBe(0.6);
  });
});

describe.skipIf(!HAVE_BAKED)("the real idle, walk and run (loco_*.json), as joint data", () => {
  const idle = HAVE_BAKED ? real(LOCO_FILES.idle, "idle") : (null as unknown as BakedClip), walk = HAVE_BAKED ? real(LOCO_FILES.walk, "walk") : (null as unknown as BakedClip), run = HAVE_BAKED ? real(LOCO_FILES.run, "run") : (null as unknown as BakedClip);
  it("are the Mixamo Xbot's own cycles baked to the bench's joints: sound, and NOT planted (a planted foot would march in place while the toy travels)", () => {
    for (const [name, c] of [["idle", idle], ["walk", walk], ["run", run]] as const) {
      expect(c.joints, name).toBeDefined();
      expect(c.planted, name).toBe(false);
      jointsAreSound(c);
    }
  });
  it("have their natural lengths: a 2.5 s idle, a 0.97 s walk cycle and a 0.7 s run cycle", () => {
    expect(idle.duration).toBeCloseTo(2.5, 1);
    expect(walk.duration).toBeCloseTo(0.97, 2);
    expect(run.duration).toBeCloseTo(0.7, 2);
  });
  it("stand and move at the hips' own height (about 59 to 66 mm: no sinking into the floor and no floating)", () => {
    for (const c of [idle, walk, run]) for (let i = 0; i < c.frames; i++) { const y = c.joints!.hipsMm[i * 3 + 1]!; expect(y).toBeGreaterThan(54); expect(y).toBeLessThan(68); }
  });
  it("do not travel (in place: the toy moves, the cycle does not)", () => {
    for (const c of [walk, run]) {
      let travel = 0;
      for (let i = 0; i < c.frames; i++) travel = Math.max(travel, Math.hypot(c.joints!.hipsMm[i * 3]! - c.joints!.hipsMm[0]!, c.joints!.hipsMm[i * 3 + 2]! - c.joints!.hipsMm[2]!));
      expect(travel).toBeLessThan(8);
    }
  });
  it("loop: the last frame is close to the first, so the cycle does not jump when it comes round", () => {
    for (const c of [idle, walk, run]) for (const k of CLIP_JOINT_KEYS) {
      const a = c.joints![k], n = (c.frames - 1) * 4;
      const dot = Math.abs(a[0]! * a[n]! + a[1]! * a[n + 1]! + a[2]! * a[n + 2]! + a[3]! * a[n + 3]!);
      expect((2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI, k).toBeLessThan(3);
    }
  });
});

describe("loadMoves", () => {
  const ok = (body: string) => ({ ok: true, text: async () => body }) as unknown as Response;
  const ALL = ["react_jump", "act_push", "loco_idle", "loco_walk", "loco_run"] as const;
  const fetchOf = (files: Record<string, string | null | "throw">) => vi.fn(async (url: string) => {
    const id = /\/([a-z_]+)\.json$/.exec(url)![1]!;
    const f = files[id];
    if (f === "throw") throw new Error("offline");
    if (f === null || f === undefined) return { ok: false, text: async () => "" } as unknown as Response;
    return ok(f);
  });
  const everything = () => Object.fromEntries(ALL.map((id) => [id, file(id)]));

  it.skipIf(!HAVE_BAKED)("fetches the five files from the baked folder, converts them as joint clips and puts jump, shove, idle, walk and run in the bank in one go", async () => {
    const f = fetchOf(everything());
    const add = vi.fn();
    const r = await loadMoves({ fetchImpl: f as never, addClips: add });
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual(ALL.map((id) => `/kip/mixamo/baked/${id}.json`).sort());
    expect(r.loaded.sort()).toEqual(["idle", "jump", "run", "shove", "walk"]);
    expect(add).toHaveBeenCalledTimes(1);
    const clips = add.mock.calls[0]![0] as Record<string, BakedClip>;
    expect(Object.keys(clips).sort()).toEqual(["idle", "jump", "run", "shove", "walk"]);
    for (const [name, c] of Object.entries(clips)) { expect(c.name).toBe(name); expect(c.joints, name).toBeDefined(); }
    expect([clips.jump!.loop, clips.shove!.loop]).toEqual([false, false]);
    expect([clips.idle!.loop, clips.walk!.loop, clips.run!.loop]).toEqual([true, true, true]);
  });
  it.skipIf(!HAVE_BAKED)("the shove is the whole clip, never cut: its length is the file's and what the world plays of it is SHOVE_PLAY_S", async () => {
    const add = vi.fn();
    const r = await loadMoves({ fetchImpl: fetchOf(everything()) as never, addClips: add });
    const shove = (add.mock.calls[0]![0] as Record<string, BakedClip>).shove!;
    expect(shove.frames).toBe(241);
    expect(shove.duration).toBeCloseTo(8, 6);
    expect(r.shoveDurationS).toBe(SHOVE_PLAY_S);
    expect(r.shoveContactS).toBeCloseTo(shoveContactSeconds(shove), 9);
    expect(r.shoveContactS).toBeGreaterThan(0.3);
  });
  it.skipIf(!HAVE_BAKED)("a missing move leaves that move out and the others in", async () => {
    const add = vi.fn();
    const r = await loadMoves({ fetchImpl: fetchOf({ ...everything(), act_push: null }) as never, addClips: add });
    expect(r.loaded.sort()).toEqual(["idle", "jump", "run", "walk"]);
    const r2 = await loadMoves({ fetchImpl: fetchOf({ ...everything(), react_jump: null }) as never, addClips: vi.fn() });
    expect(r2.loaded.sort()).toEqual(["idle", "run", "shove", "walk"]);
  });
  it.skipIf(!HAVE_BAKED)("the locomotion cycles come all three or not at all (a joint walk with a rigid run would not match), and the moves still load", async () => {
    for (const missing of ["loco_idle", "loco_walk", "loco_run"]) {
      const add = vi.fn();
      const r = await loadMoves({ fetchImpl: fetchOf({ ...everything(), [missing]: null }) as never, addClips: add });
      expect(r.loaded.sort(), missing).toEqual(["jump", "shove"]);
      expect(Object.keys(add.mock.calls[0]![0]).sort(), missing).toEqual(["jump", "shove"]);
    }
  });
  it("nothing loaded means addClips is never called", async () => {
    const add = vi.fn();
    expect((await loadMoves({ fetchImpl: fetchOf({}) as never, addClips: add })).loaded).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
  it.skipIf(!HAVE_BAKED)("an offline fetch, a file that is not JSON, one that is not a joint clip and the wrong file's id are all just left out", async () => {
    for (const bad of ["throw", "not json {", "{}", "[]", JSON.stringify({ ...JSON.parse(file("react_jump")), id: "something_else" })] as const) {
      const add = vi.fn();
      const r = await loadMoves({ fetchImpl: fetchOf(Object.fromEntries(ALL.map((id) => [id, bad as string]))) as never, addClips: add });
      expect(r.loaded, String(bad).slice(0, 20)).toEqual([]);
      expect(add).not.toHaveBeenCalled();
    }
  });
  it.skipIf(!HAVE_BAKED)("a file over the size cap is refused", async () => {
    const add = vi.fn();
    const huge = file("react_jump") + " ".repeat(900_001);
    expect((await loadMoves({ fetchImpl: fetchOf({ react_jump: huge }) as never, addClips: add })).loaded).toEqual([]);
  });
  it("a different base folder is used, with or without a trailing slash", async () => {
    const f = fetchOf({});
    await loadMoves({ fetchImpl: f as never, addClips: vi.fn(), base: "/x/y/" });
    await loadMoves({ fetchImpl: f as never, addClips: vi.fn(), base: "/x/y" });
    expect(new Set(f.mock.calls.map((c) => c[0]))).toEqual(new Set(ALL.map((id) => `/x/y/${id}.json`)));
  });
  it("the files in the repo are the ones the loader asks for", () => {
    expect(MOVE_FILES).toEqual({ jump: "react_jump", shove: "act_push" });
    expect(LOCO_FILES).toEqual({ idle: "loco_idle", walk: "loco_walk", run: "loco_run" });
  });
  it.skipIf(!HAVE_BAKED)("the locomotion files are NOT in the clip index the Dance picker and the bench list (they are not dances)", () => {
    const index = JSON.parse(file("index")) as { clips: Array<{ id: string }> };
    for (const id of Object.values(LOCO_FILES)) expect(index.clips.map((c) => c.id)).not.toContain(id);
  });
});
