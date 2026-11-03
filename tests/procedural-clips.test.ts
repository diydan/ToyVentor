import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { DEFAULT_TUNING, MixamoDriver, sampleClip, newPose, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { BLOW_PUFFS_S, HUG_SQUEEZE_S, KICK_CONTACT_S, MALLET_COUNT, MALLET_EVERY_S, MALLET_START_S, PET_STROKES_S, PROCEDURAL_ACTIONS, PROCEDURAL_CLIPS, READ_PAGES_S, STRUM_COUNT, STRUM_EVERY_S, bake, gainFor } from "../src/features/game/world/runtime/proceduralClips";
import { buildToy } from "../src/features/game/world/runtime/playerRig";

// Hand-authored clips (eat, sour, belly_pat, yawn, sleep) baked into the Mixamo clip format and played by the real MixamoDriver.
// Spec: docs/specs/playful-interactions-spec.md section 5. Nothing here needs a browser or the Mixamo files.
const REST_BANK: ClipBank = { idle: bake("idle", 1, true, [{ t: 0 }]), walk: bake("walk", 1, true, [{ t: 0 }]), ...PROCEDURAL_CLIPS };

function characterRig() {
  const rig = buildToy("character", stockSel().character as never, stockCol());
  rig.arms.length = 0;
  const armL = new THREE.Group(), armR = new THREE.Group();
  rig.arms.push(armL, armR);
  rig.head = new THREE.Group();
  return { rig, armL, armR, head: rig.head as THREE.Object3D };
}
const run = (d: MixamoDriver, rig: ReturnType<typeof characterRig>["rig"], seconds: number, speed = 0) => { for (let i = 0; i < Math.round(seconds * 60); i++) d.update(rig, 1 / 60, speed); };
const pose = (clip: ClipBank[string], t: number) => { const p = newPose(); sampleClip(clip, t, p); return p; };

describe("the baked clips are well formed", () => {
  it("has the thirteen actions and each is a real clip in the Mixamo format", () => {
    expect([...PROCEDURAL_ACTIONS].sort()).toEqual(["belly_pat", "blow", "cheer", "eat", "hug", "kick", "mallet", "pet", "read", "sleep", "sour", "strum", "yawn"]);
    for (const [name, c] of Object.entries(PROCEDURAL_CLIPS)) {
      expect(c.name).toBe(name);
      expect(c.frames).toBe(Math.round(c.duration * 30) + 1);
      expect(c.hips.length).toBe(c.frames * 3);
      expect(c.body.length).toBe(c.frames * 4);
      expect(c.head.length).toBe(c.frames * 4);
      for (const k of ["armL", "armR", "legL", "legR"] as const) expect(c[k].length).toBe(c.frames * 3);
      expect(c.pose).toBe(false);
    }
  });
  it("every frame is finite, every quaternion is a unit quaternion and every limb is a unit vector", () => {
    for (const [name, c] of Object.entries(PROCEDURAL_CLIPS)) {
      for (const arr of [c.hips, c.body, c.head, c.armL, c.armR, c.legL, c.legR]) for (const v of arr) expect(Number.isFinite(v), name).toBe(true);
      for (let i = 0; i < c.frames; i++) {
        for (const q of [c.body, c.head]) expect(Math.hypot(q[i * 4]!, q[i * 4 + 1]!, q[i * 4 + 2]!, q[i * 4 + 3]!), `${name} quat ${i}`).toBeCloseTo(1, 4);
        for (const l of [c.armL, c.armR, c.legL, c.legR]) expect(Math.hypot(l[i * 3]!, l[i * 3 + 1]!, l[i * 3 + 2]!), `${name} limb ${i}`).toBeCloseTo(1, 4);
      }
    }
  });
  it("one-shots start and end at rest so they blend in and out cleanly; sleep loops", () => {
    for (const n of ["eat", "sour", "belly_pat", "yawn", "hug", "kick", "cheer", "read", "strum", "blow", "pet", "mallet"] as const) {
      const c = PROCEDURAL_CLIPS[n]!;
      expect(c.loop, n).toBe(false);
      for (const t of [0, c.duration]) {
        const p = pose(c, t);
        expect(p.armR.y, `${n}@${t} armR`).toBeLessThan(-0.95);
        expect(p.armL.y, `${n}@${t} armL`).toBeLessThan(-0.95);
        expect(p.legR.y, `${n}@${t} legR`).toBeLessThan(-0.95);
        expect(p.legL.y, `${n}@${t} legL`).toBeLessThan(-0.95);
        expect(Math.abs(p.hips.y), `${n}@${t} hips`).toBeLessThan(1e-6);
        expect(p.head.w, `${n}@${t} head`).toBeGreaterThan(0.9999);
      }
    }
    const s = PROCEDURAL_CLIPS.sleep!;
    expect(s.loop).toBe(true);
    const a = pose(s, 0), b = pose(s, s.duration);
    expect(a.hips.distanceTo(b.hips)).toBeLessThan(1e-4);
    expect(a.head.angleTo(b.head)).toBeLessThan(1e-3);
  });
  it("bake keeps an omitted channel at its previous value and eases between keys", () => {
    const c = bake("t", 1, false, [{ t: 0 }, { t: 1, hips: [0, 1, 0] }]);
    expect(pose(c, 0).hips.y).toBeCloseTo(0, 6);
    expect(pose(c, 1).hips.y).toBeCloseTo(1, 6);
    const mid = pose(c, 0.5).hips.y;
    expect(mid).toBeCloseTo(0.5, 2);
    expect(pose(c, 0.25).hips.y).toBeLessThan(0.25); // eased: slower than linear at the start
  });
});

describe("eat: the hand goes to the mouth and the head chews", () => {
  const eat = PROCEDURAL_CLIPS.eat!;
  it("the figure's right hand comes up in front of the face, and the left stays down", () => {
    const p = pose(eat, 0.5);
    expect(p.armR.y).toBeGreaterThan(0.3); // up
    expect(p.armR.z).toBeGreaterThan(0.6); // forward
    expect(p.armL.y).toBeLessThan(-0.9);
  });
  it("the head bobs three times while chewing (three distinct nods down)", () => {
    let nods = 0, prev = 0, dir = 0;
    for (let t = 0.35; t <= 1.2; t += 1 / 30) {
      const pitch = new THREE.Euler().setFromQuaternion(pose(eat, t).head, "XYZ").x;
      if (dir <= 0 && pitch > prev + 1e-4) dir = 1;
      else if (dir > 0 && pitch < prev - 1e-4) { nods++; dir = -1; }
      prev = pitch;
    }
    expect(nods).toBeGreaterThanOrEqual(3);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0.4; t <= 1.2; t += 1 / 30) { const x = new THREE.Euler().setFromQuaternion(pose(eat, t).head, "XYZ").x; lo = Math.min(lo, x); hi = Math.max(hi, x); }
    expect(hi - lo).toBeGreaterThan(0.15);
  });
  it("plays through the real driver: the arm holder moves, the clip finishes by itself and the rig returns to rest", () => {
    const { rig, armR } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    expect(d.canDrive(rig)).toBe(true);
    expect(d.trigger("eat")).toBe(true);
    expect(d.busyAction).toBe("eat");
    let up = -1;
    for (let i = 0; i < 80; i++) { d.update(rig, 1 / 60, 0); up = Math.max(up, new THREE.Vector3(0, -1, 0).applyQuaternion(armR.quaternion).y * -1); }
    run(d, rig, 1.5);
    expect(d.busyAction).toBeNull();
    expect(up).toBeGreaterThan(0.1); // at some point the arm was raised (its "down" axis turned up)
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(armR.quaternion).y).toBeLessThan(-0.95); // and is back down
  });
});

describe("hug: both arms reach forward and close in", () => {
  const c = PROCEDURAL_CLIPS.hug!;
  it("the arms open forward, then squeeze closer together at HUG_SQUEEZE_S, both pointing forward and inward", () => {
    const open = pose(c, 0.35), squeeze = pose(c, HUG_SQUEEZE_S);
    for (const p of [open, squeeze]) {
      expect(p.armL.z).toBeGreaterThan(0.7);                    // forward (+z)
      expect(p.armR.z).toBeGreaterThan(0.7);
      expect(p.armL.x).toBeGreaterThan(0);                      // each on its own side: the figure's left is +x
      expect(p.armR.x).toBeLessThan(0);
    }
    expect(squeeze.armL.x).toBeLessThan(open.armL.x);           // closer in
    expect(-squeeze.armR.x).toBeLessThan(-open.armR.x);
    expect(squeeze.armL.x).toBeCloseTo(-squeeze.armR.x, 6);     // symmetric: a hug, not a one-armed wave
  });
  it("the body leans in and the head tips down at the squeeze, and squeezes twice (the arms come in, ease off, come in again)", () => {
    expect(pose(c, HUG_SQUEEZE_S).body.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.12);
    const xs = Array.from({ length: 41 }, (_, i) => pose(c, 0.35 + (i / 40) * 1.2).armL.x);
    let dips = 0;
    for (let i = 1; i < xs.length - 1; i++) if (xs[i]! < xs[i - 1]! && xs[i]! <= xs[i + 1]!) dips++;
    expect(dips).toBe(2);
  });
});

describe("kick: the right leg swings through to the front at the contact moment", () => {
  const c = PROCEDURAL_CLIPS.kick!;
  it("winds back, is furthest forward at KICK_CONTACT_S and the left leg stays planted", () => {
    expect(pose(c, 0.2).legR.z).toBeLessThan(-0.4);             // wound back
    const at = pose(c, KICK_CONTACT_S).legR;
    expect(at.z).toBeGreaterThan(0.9);                          // at the front
    let best = -1, bestT = 0;
    for (let i = 0; i <= 60; i++) { const t = (i / 60) * c.duration, z = pose(c, t).legR.z; if (z > best) { best = z; bestT = t; } }
    expect(Math.abs(bestT - KICK_CONTACT_S)).toBeLessThan(0.2); // the swing peaks at (just after, on follow-through) the contact moment
    for (let i = 0; i <= 60; i++) expect(pose(c, (i / 60) * c.duration).legL.y, "left leg stays down").toBeLessThan(-0.95);
  });
  it("leans back at the strike and hops a little", () => {
    const p = pose(c, KICK_CONTACT_S);
    expect(p.hips.y).toBeGreaterThan(0.02);
    expect(p.body.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.08);
  });
});

describe("cheer: both arms go up", () => {
  const c = PROCEDURAL_CLIPS.cheer!;
  it("both arms point up and out in the middle of the clip and the head tips back", () => {
    const p = pose(c, 0.55);
    expect(p.armL.y).toBeGreaterThan(0.7);
    expect(p.armR.y).toBeGreaterThan(0.7);
    expect(p.armL.x).toBeGreaterThan(0.2);
    expect(p.armR.x).toBeLessThan(-0.2);
    expect(p.hips.y).toBeGreaterThan(0.02);
  });
});

describe("the new clips play through the real driver and finish by themselves", () => {
  for (const name of ["hug", "kick", "cheer", "read", "strum", "blow", "pet", "mallet"] as const) {
    it(`${name}: triggers, plays for its length, then the driver is idle again`, () => {
      const { rig } = characterRig();
      const d = new MixamoDriver(REST_BANK);
      expect(d.trigger(name)).toBe(true);
      expect(d.busyAction).toBe(name);
      run(d, rig, PROCEDURAL_CLIPS[name]!.duration * 0.5);
      expect(d.busyAction).toBe(name);
      run(d, rig, PROCEDURAL_CLIPS[name]!.duration * 0.6);
      expect(d.busyAction).toBeNull();
    });
  }
});

describe("read: a book held in both hands, a page turned at each of READ_PAGES_S", () => {
  const c = PROCEDURAL_CLIPS.read!;
  it("holds the book forward at the chest with the head down on the page", () => {
    const p = pose(c, 2);
    expect(p.armL.z).toBeGreaterThan(0.7);
    expect(p.armR.z).toBeGreaterThan(0.7);
    expect(p.armL.y).toBeLessThan(-0.3);
    expect(2 * Math.asin(Math.abs(p.head.x))).toBeGreaterThan(0.2);          // head tipped down
  });
  it("at each page the right hand flicks up and the head lifts, and between pages the hand is back on the book", () => {
    for (const t of READ_PAGES_S) {
      const p = pose(c, t);
      expect(p.armR.y, `page at ${t}`).toBeGreaterThan(-0.2);
      expect(2 * Math.asin(Math.abs(p.head.x)), `head at ${t}`).toBeLessThan(0.15);
      const between = pose(c, t + 0.6);
      expect(between.armR.y, `between after ${t}`).toBeLessThan(-0.4);
    }
    expect(READ_PAGES_S).toHaveLength(3);
  });
  it("the left hand never leaves the book", () => {
    for (let t = 0.6; t <= 6.0; t += 0.2) expect(pose(c, t).armL.z, `at ${t}`).toBeGreaterThan(0.7);
  });
});

describe("strum: the left hand on the neck, the right hand strumming in time", () => {
  const c = PROCEDURAL_CLIPS.strum!;
  it("the left hand is out front on the neck the whole time", () => {
    for (let t = 0.3; t <= 4.0; t += 0.2) expect(pose(c, t).armL.z, `at ${t}`).toBeGreaterThan(0.9);
  });
  it("the right hand alternates down and up on every strum, STRUM_COUNT times", () => {
    const ys: number[] = [];
    for (let i = 0; i < STRUM_COUNT; i++) ys.push(pose(c, 0.2 + (i + 1) * STRUM_EVERY_S).armR.y);
    for (let i = 0; i < ys.length; i++) expect(ys[i]!, `strum ${i}`).toBeCloseTo(i % 2 === 0 ? -0.72 / Math.hypot(0.3, 0.72, 0.62) : -0.35 / Math.hypot(0.3, 0.35, 0.9), 1);                // (30 fps frames: a strum time between two frames is a hair off its key)
    expect(STRUM_COUNT * STRUM_EVERY_S + 0.2).toBeLessThan(c.duration);
  });
  it("the body sways side to side with the strumming and the hips bob", () => {
    const rolls = Array.from({ length: 8 }, (_, i) => pose(c, 0.2 + (i + 1) * STRUM_EVERY_S).body.z);
    for (let i = 1; i < rolls.length; i++) expect(Math.sign(rolls[i]!)).toBe(-Math.sign(rolls[i - 1]!));
    expect(Math.max(...Array.from({ length: 20 }, (_, i) => pose(c, 0.4 + i * 0.1).hips.y))).toBeGreaterThan(0.01);
  });
});

describe("blow: the wand at the mouth, four puffs", () => {
  const c = PROCEDURAL_CLIPS.blow!;
  it("the right hand comes up to the mouth and stays there through the puffs", () => {
    for (const t of BLOW_PUFFS_S) {
      const p = pose(c, t);
      expect(p.armR.y, `at ${t}`).toBeGreaterThan(0.3);
      expect(p.armR.z, `at ${t}`).toBeGreaterThan(0.7);
    }
    expect(pose(c, 0.1).armR.y).toBeLessThan(0);                              // still on its way up at the very start
  });
  it("leans in before each puff and back on it, four times", () => {
    for (const t of BLOW_PUFFS_S) {
      expect(pose(c, t - 0.12).body.x, `before ${t}`).toBeGreaterThan(0.02);
      expect(pose(c, t).body.x, `on ${t}`).toBeLessThan(-0.01);
    }
    expect(BLOW_PUFFS_S).toHaveLength(4);
  });
});

describe("pet: a crouch with the right hand stroking", () => {
  const c = PROCEDURAL_CLIPS.pet!;
  it("leans forward and crouches, the hand out in front and low, the head down", () => {
    const p = pose(c, 1.0);
    expect(2 * Math.asin(p.body.x)).toBeGreaterThan(0.25);
    expect(p.hips.y).toBeLessThan(-0.05);
    expect(p.armR.z).toBeGreaterThan(0.6);
    expect(p.armR.y).toBeLessThan(-0.4);
    expect(p.armR.y).toBeGreaterThan(-0.9);
    expect(pose(c, 0.45).armR.y).toBeLessThan(-0.4);           // already reaching down when the crouch is complete
  });
  it("strokes four times: the hand goes down and back up, once for each of PET_STROKES_S", () => {
    const ys = Array.from({ length: 61 }, (_, i) => pose(c, 0.5 + (i / 60) * 1.6).armR.y);
    let peaks = 0;
    for (let i = 1; i < ys.length - 1; i++) if (ys[i]! > ys[i - 1]! && ys[i]! >= ys[i + 1]!) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(3);
    expect(PET_STROKES_S).toHaveLength(4);
  });
});

describe("mallet: both hands strike in turn", () => {
  const c = PROCEDURAL_CLIPS.mallet!;
  it("the arms are out in front, and on every stroke one comes down hard while the other waits up: left on the even strokes, right on the odd", () => {
    for (let i = 0; i < MALLET_COUNT; i++) {
      const p = pose(c, MALLET_START_S + i * MALLET_EVERY_S);
      const [down, up] = i % 2 === 0 ? [p.armL, p.armR] : [p.armR, p.armL];
      expect(down.y, `stroke ${i} down`).toBeLessThan(-0.7);
      expect(up.y, `stroke ${i} up`).toBeGreaterThan(-0.5);
      expect(down.z, `stroke ${i} forward`).toBeGreaterThan(0.4);
      expect(up.z).toBeGreaterThan(0.8);
    }
  });
  it("the body sways with the beat, side to side, and the clip is longer than its last stroke", () => {
    const rolls = Array.from({ length: 6 }, (_, i) => pose(c, MALLET_START_S + i * MALLET_EVERY_S).body.z);
    for (let i = 1; i < rolls.length; i++) expect(Math.sign(rolls[i]!)).toBe(-Math.sign(rolls[i - 1]!));
    expect(c.duration).toBeGreaterThan(MALLET_START_S + (MALLET_COUNT - 1) * MALLET_EVERY_S);
  });
});

describe("sleep: lies down for real, stays until woken, gets up again", () => {
  it("authors the true angle and compensates for the driver's body gain", () => {
    expect(gainFor(Math.PI / 2)).toBeCloseTo(Math.PI / 2 / DEFAULT_TUNING.bodyGain, 9);
    expect(gainFor(Math.PI / 2)).toBeGreaterThan(Math.PI / 2);
  });
  it("after the driver's gain the rig is rotated a true 90 degrees onto its back: up is level, and what was forward points up", () => {
    const { rig } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    expect(d.holdAction("sleep")).toBe(true);
    run(d, rig, 2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.g.quaternion);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.g.quaternion); // stage +X is the character's front
    expect(Math.abs(up.y)).toBeLessThan(0.03);
    expect(fwd.y).toBeGreaterThan(0.97); // face up, not face down
    expect(rig.g.position.y).toBeGreaterThan(0.2); // lifted clear of the surface it lies on
    expect(rig.g.position.x).toBeGreaterThan(1); // moved forward so the lying body is centred where the figure stood, not stretched away behind its feet
  });
  it("the head stays on the shoulders (no look at the ceiling) and the limbs lie along the body", () => {
    const { rig, armL, armR, head } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    d.holdAction("sleep");
    run(d, rig, 2);
    expect(new THREE.Euler().setFromQuaternion(head.quaternion, "XYZ").x).toBeLessThan(0.2);
    expect(Math.abs(new THREE.Euler().setFromQuaternion(head.quaternion, "XYZ").x)).toBeLessThan(0.2);
    for (const arm of [armL, armR]) expect(new THREE.Vector3(0, -1, 0).applyQuaternion(arm.quaternion).y).toBeLessThan(-0.95);
  });
  it("holds without end: still lying after a long time, and walking does not cancel it", () => {
    const { rig } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    d.holdAction("sleep");
    expect(d.holding).toBe("sleep");
    run(d, rig, 3);
    run(d, rig, 5, 2.4);
    expect(d.holding).toBe("sleep");
    expect(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(rig.g.quaternion).y)).toBeLessThan(0.05);
  });
  it("eases in (not a snap) and, when released, eases out and the rig stands up again", () => {
    const { rig } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    d.holdAction("sleep");
    run(d, rig, 0.1);
    const early = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.g.quaternion).y;
    expect(early).toBeGreaterThan(0.6); // only a little way down after a tenth of a second
    run(d, rig, 2);
    d.releaseHold();
    expect(d.holding).toBeNull();
    run(d, rig, 1.2);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(rig.g.quaternion).y).toBeGreaterThan(0.98);
    expect(rig.g.position.y).toBeLessThan(0.05);
  });
  it("a held pose replaces a gesture in progress, an unknown clip is refused, and releasing nothing is safe", () => {
    const { rig } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    d.trigger("eat");
    expect(d.holdAction("sleep")).toBe(true);
    expect(d.busyAction).toBeNull();
    const bare = new MixamoDriver({ idle: REST_BANK.idle!, walk: REST_BANK.walk! });
    expect(bare.holdAction("sleep")).toBe(false);
    expect(bare.holding).toBeNull();
    expect(() => { bare.releaseHold(); d.releaseHold(); d.releaseHold(); }).not.toThrow();
    run(d, rig, 2);
  });
  it("a driver released for a new rig forgets the held pose", () => {
    const { rig } = characterRig();
    const d = new MixamoDriver(REST_BANK);
    d.update(rig, 1 / 60, 0);
    d.holdAction("sleep");
    run(d, rig, 1);
    d.release();
    expect(d.holding).toBeNull();
  });
});

describe("wiring", () => {
  it("the world merges the clips into the bank it loads, so mixGo and the driver can play them", async () => {
    const { readFileSync } = await import("node:fs");
    const world = readFileSync(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
    expect(world).toMatch(/from "\.\/proceduralClips"/);
    expect(world).toMatch(/new MixamoDriver\(\{\.\.\.b,\.\.\.PROCEDURAL_CLIPS\}\)/);
  });
});
