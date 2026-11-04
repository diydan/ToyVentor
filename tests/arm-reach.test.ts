// Where Kip's fist goes when an arm is aimed and its elbow folded (runtime/proceduralClips.ts `REACH`, `fistOf`; Dan, 2026-11-04: the hug, read, strum, mallet, mop, pour, pick, offer and pet "still use
// straight arms"). The reaches were solved with a two-bone model of the arm; this holds the model to the REAL rig (built from the real STLs and driven by the real driver) and every reach in the table to the
// model, so a mistyped number or a change to the sleeve's flex is caught here, not found as a hand floating off the prop.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { MixamoDriver, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { buildToy, clearStlRigCache, upgradeRigWithStl, type RigSel } from "../src/features/game/world/runtime/playerRig";
import { PROCEDURAL_CLIPS, REACH, bake, fistOf, type Reach } from "../src/features/game/world/runtime/proceduralClips";
import { PLAY_CLIPS } from "../src/features/game/world/runtime/playClips";

const ROOT = process.cwd();
function diskFetcher(url: string): Promise<ArrayBuffer | null> {
  const full = resolve(ROOT, "public", (url.split("?")[0] ?? url).replace(/^\//, ""));
  if (!existsSync(full)) return Promise.resolve(null);
  const buf = readFileSync(full);
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const REACHES = Object.entries(REACH) as Array<[string, Reach]>;

describe("the table of reaches", () => {
  it("each reach's aim and bend put the fist where the table says, by the model, and the aim is a unit vector", () => {
    for (const [name, r] of REACHES) {
      expect(Math.hypot(...r.aim), `${name} aim`).toBeCloseTo(1, 2);
      const f = fistOf(r.aim, r.bend, r.roll ?? 0);
      for (let i = 0; i < 3; i++) expect(f[i]!, `${name} fist ${"xyz"[i]}`).toBeCloseTo(r.fist[i]!, 1);
      expect(Math.hypot(f[0] - r.fist[0], f[1] - r.fist[1], f[2] - r.fist[2]), `${name} miss`).toBeLessThan(0.012);
    }
  });
  it("every reach is a bent arm that stays inside what a straight one reaches (0.85), the elbow hangs below the shoulder, and the upper arm is on the arm's own side", () => {
    for (const [name, r] of REACHES) {
      expect(r.bend, `${name} bend`).toBeGreaterThan(0.3);
      expect(r.bend, `${name} bend`).toBeLessThan(2.0);
      expect(Math.hypot(...r.fist), `${name} reach`).toBeLessThan(0.85);
      expect(Math.hypot(...r.fist), `${name} reach`).toBeGreaterThan(0.5);
      expect(r.aim[1], `${name}: the elbow is below the shoulder`).toBeLessThan(0.15);
      expect(r.aim[0], `${name}: the right arm's outward is -x`).toBeLessThan(0);
    }
  });
  it("the clips use them: the nine clips (and the wand's, and the stretches and sweeps') hold a bent elbow, and every one of them ends straight again", () => {
    const bank: ClipBank = { ...PROCEDURAL_CLIPS, ...PLAY_CLIPS };
    for (const name of ["hug", "read", "strum", "mallet", "mop", "pet", "blow", "pour", "pick", "offer", "sour", "yawn", "oops", "tidy"]) {
      const c = bank[name]!;
      expect(c.bends, name).toBeDefined();
      const max = Math.max(...Array.from(c.bends!.elbowR), ...Array.from(c.bends!.elbowL));
      expect(max, `${name} bends an elbow`).toBeGreaterThan(0.8);
      expect(c.bends!.elbowR[c.frames - 1], `${name} ends with the right arm straight`).toBe(name === "pick" ? c.bends!.elbowR[c.frames - 1] : 0);   // pick ends holding the bouquet up: the driver fades the pose out
      expect(c.bends!.elbowL[c.frames - 1], `${name} ends with the left arm straight`).toBe(0);
    }
  });
});

describe("the yawn: the hands pass the face with the elbows folded, then the stretch is straight", () => {
  it("folded at the start of the lift, straight at the top of the stretch and through it", () => {
    const c = PROCEDURAL_CLIPS.yawn!;
    const at = (t: number) => Math.round((t / c.duration) * (c.frames - 1));
    expect(c.bends!.elbowR[at(0.28)]!, "folded as the hands pass the face").toBeGreaterThan(1.5);
    expect(c.bends!.elbowL[at(0.28)]!).toBeGreaterThan(1.5);
    for (const t of [0.6, 0.9, 1.1]) { expect(c.bends!.elbowR[at(t)]!, `straight in the stretch at ${t}`).toBeLessThan(0.15); expect(c.bends!.elbowL[at(t)]!).toBeLessThan(0.15); }
  });
});

describe("the model against the real rig", () => {
  afterEach(() => clearStlRigCache());
  /** Drive the real driver with a clip that holds the right arm at (aim, bend), and say where the right grip is from the right shoulder, in clip axes (x left, y up, z forward). */
  async function measure(aim: readonly [number, number, number], bend: number, roll = 0, side: "R" | "L" = "R"): Promise<[number, number, number]> {
    const sel = stockSel().character as unknown as RigSel, col = stockCol();
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    const bank: ClipBank = { idle: bake("idle", 1, true, [{ t: 0 }]), walk: bake("walk", 1, true, [{ t: 0 }]), probe: bake("probe", 3, false, [side === "R" ? { t: 0, armR: aim, elbowR: bend, rollR: roll } : { t: 0, armL: [-aim[0], aim[1], aim[2]], elbowL: bend, rollL: -roll }, { t: 3 }]) };
    const d = new MixamoDriver(bank);
    expect(d.trigger("probe" as never)).toBe(true);
    for (let i = 0; i < 90; i++) d.update(rig, 1 / 60, 0);
    rig.g.updateMatrixWorld(true);
    const k = side === "R" ? 1 : 0;
    const shoulder = rig.arms[k]!.getWorldPosition(new THREE.Vector3());
    const grip = (rig.grips as THREE.Object3D[])[k]!.getWorldPosition(new THREE.Vector3());
    // stage forward is +X and the figure's left is -Z: clip x = -stage z, y = stage y, z = stage x
    return [-(grip.z - shoulder.z), grip.y - shoulder.y, grip.x - shoulder.x];
  }
  const CASES: Array<[string, Reach]> = [["the hug's squeeze (rolled)", REACH.HUG_SQUEEZE], ["the hug's ease (rolled)", REACH.HUG_EASE], ["the hug's open arms", REACH.HUG_OPEN], ["the strum's neck", REACH.STRUM_NECK], ["the mallet's strike", REACH.MALLET_STRIKE], ["the pour", REACH.POUR_A], ["the pick's end", REACH.PICK_END], ["hands up by the face (rolled the other way)", REACH.HANDS_TO_FACE], ["the oops gasp", REACH.OOPS_GASP]];
  for (const [label, r] of CASES) {
    it(`${label}: the real fist is within 0.12 of the model's (an offset of 0.04 to 0.11, the most at the deepest folds: the fist anchor sits in the hand, which turns with the roll, and the sleeve's fold is spread over its band, against the model's point)`, async () => {
      const real = await measure(r.aim, r.bend, r.roll ?? 0);
      const model = fistOf(r.aim, r.bend, r.roll ?? 0);
      expect(Math.hypot(real[0] - model[0], real[1] - model[1], real[2] - model[2]), `real ${real.map((x) => x.toFixed(3))} model ${model.map((x) => x.toFixed(3))}`).toBeLessThan(0.12);
    });
  }
  it("the roll turns the fold plane: the same aim and bend with and without it put the fist in different places (the elbow out, the forearm round), and the left arm with the negated roll is the right's mirror image", async () => {
    const r = REACH.HUG_SQUEEZE;
    const plain = await measure(r.aim, r.bend, 0), rolled = await measure(r.aim, r.bend, r.roll!);
    expect(Math.hypot(rolled[0] - plain[0], rolled[1] - plain[1], rolled[2] - plain[2]), "a roll of 0.89 moves the fist").toBeGreaterThan(0.2);
    const left = await measure(r.aim, r.bend, r.roll!, "L");
    // the right arm's outward is clip -x and the left's is +x: the mirror image has x negated
    expect(Math.abs(left[0] + rolled[0]), "x mirrored").toBeLessThan(0.05);
    expect(Math.abs(left[1] - rolled[1]), "y the same").toBeLessThan(0.05);
    expect(Math.abs(left[2] - rolled[2]), "z the same").toBeLessThan(0.05);
  });
  it("a roll with no fold does nothing: a straight arm stays where it was however it is rolled", async () => {
    const aim = [-0.3, -0.9, 0.3] as const;
    const a = await measure(aim, 0, 0), b = await measure(aim, 0, 1.2);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.02);
  });
  it("a straight arm reaches 0.85 and a bent one less, on the real rig as in the model (the bend is not lost)", async () => {
    const straight = await measure([-0.2, -0.9, 0.4], 0);
    const bent = await measure([-0.2, -0.9, 0.4], 1.1);
    const len = (v: number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
    expect(len(straight)).toBeGreaterThan(0.8);
    expect(len(bent)).toBeLessThan(len(straight) - 0.08);
  });
});
