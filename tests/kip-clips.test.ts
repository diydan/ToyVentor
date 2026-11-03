import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as clipsMod from "../parts/kip/viewer/kip-clips.js";
// @ts-expect-error untyped JS module
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";
import { MAX_BPM, MIN_BPM, TEMPO_RATE_MAX, TEMPO_RATE_MIN, pickDance, tempoRate } from "../shared/songBeat";
import { TEMPO_BPM, TEMPOS } from "../shared/songCards";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { KIP_CLIPS, KIP_CLIP_JOINTS, PROP_CLIPS, clipForProp, makeKipClip, HIP_Y, REST_LEGS, LEG_RIG, legFK, FLIPPED_PROP_CLIPS, buildKipClip, plantBakedClip, limitHands, softCap } = clipsMod as any;
const { PROP_OPTIONS, WORKSHOP_PROPS } = wardrobe as any;

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// Clip ids the page already registers (Kip-Demo.html clipLabels + vehicle clips + Samba/T-pose): a new id must not shadow one.
const EXISTING = ["idle", "walk", "run", "sneak_pose", "HeroWave", "sad_pose", "agree", "headShake", "drive_sit", "scooter_ride", "moto_straddle", "skate_cruise", "SambaDance", "TPose"];
// Props that deliberately have no prop clip. The skateboard already has skate_cruise.
const NO_CLIP_PROPS = ["off", "skateboard"];

const built = new Map<string, any>(KIP_CLIPS.map((c: any) => [c.id, makeKipClip(THREE, c)]));
const quatTrack = (clip: any, joint: string) => clip.tracks.find((t: any) => t.name === `kip_${joint}.quaternion`);
const frames = (track: any, size: number) => Array.from({ length: track.values.length / size }, (_, i) => Array.from(track.values.slice(i * size, i * size + size)) as number[]);
const angleBetween = (a: number[], b: number[]) => 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!)));
const deg = (r: number) => (r * 180) / Math.PI;

describe("kip clips: the registry", () => {
  it("adds 6 reactions, 4 dances and one clip per prop, with unique ids and labels that do not shadow an existing clip", () => {
    const by = (g: string) => KIP_CLIPS.filter((c: any) => c.group === g).length;
    expect([by("reaction"), by("dance")]).toEqual([6, 4]);
    expect(by("prop")).toBeGreaterThanOrEqual(15);
    const ids = KIP_CLIPS.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(KIP_CLIPS.map((c: any) => c.label)).size).toBe(ids.length);
    for (const id of ids) expect(EXISTING, `${id} shadows a clip the page already has`).not.toContain(id);
    for (const c of KIP_CLIPS) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(c.label.length, `${c.id} label too long for the menu`).toBeLessThanOrEqual(24);
    }
  });

  it("gives every handheld prop a clip, and every prop clip belongs to a real prop (add a prop: add its clip or list it in NO_CLIP_PROPS)", () => {
    const propIds = PROP_OPTIONS.map((p: any) => p.id);
    for (const id of propIds) {
      if (NO_CLIP_PROPS.includes(id)) continue;
      expect(clipForProp(id), `prop "${id}" has no clip in kip-clips.js`).not.toBeNull();
    }
    for (const [prop, clip] of Object.entries(PROP_CLIPS)) {
      expect(propIds, `clip ${clip} names prop "${prop}" that PROP_OPTIONS does not have`).toContain(prop);
    }
    expect(clipForProp("off")).toBeNull();
    expect(clipForProp("skateboard")).toBeNull();
    expect(clipForProp("wand")).toBeNull();
  });
});

describe("kip clips: every clip, numerically", () => {
  for (const entry of KIP_CLIPS as any[]) {
    const clip = built.get(entry.id);
    it(`${entry.id}: has all 14 joint tracks plus hips position, on the names the rig uses, with a clean timeline`, () => {
      expect(clip.name).toBe(entry.id);
      expect(clip.duration).toBeCloseTo(entry.dur, 5);
      expect(clip.tracks.map((t: any) => t.name).sort()).toEqual(["kip_Hips.position", ...KIP_CLIP_JOINTS.map((j: string) => `kip_${j}.quaternion`)].sort());
      const times = Array.from(clip.tracks[0].times as Float32Array);
      expect(times[0]).toBe(0);
      expect(times[times.length - 1]).toBeCloseTo(entry.dur, 5);
      for (let i = 1; i < times.length; i++) expect(times[i]! > times[i - 1]!).toBe(true);
      expect(times.length).toBeGreaterThanOrEqual(Math.round(entry.dur * 30)); // 30 frames a second, not the 6 of a coarse key set
    });

    it(`${entry.id}: loops seamlessly (last frame equals the first, nothing pops when it repeats)`, () => {
      for (const j of KIP_CLIP_JOINTS) {
        const f = frames(quatTrack(clip, j), 4);
        expect(angleBetween(f[0]!, f[f.length - 1]!), `${j} start vs end`).toBeLessThan(1e-3);
      }
      const p = frames(clip.tracks.find((t: any) => t.name === "kip_Hips.position"), 3);
      for (let k = 0; k < 3; k++) expect(Math.abs(p[0]![k]! - p[p.length - 1]![k]!), `hips position axis ${k}`).toBeLessThan(1e-3);
    });

    it(`${entry.id}: unit quaternions, no teleports between frames, no long-way-round flips`, () => {
      for (const j of KIP_CLIP_JOINTS) {
        const f = frames(quatTrack(clip, j), 4);
        for (let i = 0; i < f.length; i++) {
          const n = Math.hypot(...f[i]!);
          expect(Math.abs(n - 1), `${j} frame ${i} length`).toBeLessThan(1e-4);
          if (i > 0) {
            const dot = f[i]![0]! * f[i - 1]![0]! + f[i]![1]! * f[i - 1]![1]! + f[i]![2]! * f[i - 1]![2]! + f[i]![3]! * f[i - 1]![3]!;
            expect(dot, `${j} frame ${i} hemisphere`).toBeGreaterThanOrEqual(0);
            expect(deg(angleBetween(f[i - 1]!, f[i]!)), `${j} frame ${i} jump`).toBeLessThan(45); // 45 degrees in 1/30 s would be a snap
          }
        }
      }
    });

    it(`${entry.id}: knees never bend backwards or past 120 degrees, the hips stay in the retargeter's travel range`, () => {
      for (const j of ["LeftLeg", "RightLeg"]) {
        for (const [i, q] of frames(quatTrack(clip, j), 4).entries()) {
          expect(deg(2 * Math.acos(Math.min(1, Math.abs(q[3]!)))), `${j} frame ${i} bend`).toBeLessThanOrEqual(120);
          expect(q[0]!, `${j} frame ${i} bends backwards (rx < 0)`).toBeGreaterThanOrEqual(-0.0175); // sin(1 deg / 2) ~ 0.0087, with room for rounding
        }
      }
      for (const [i, p] of frames(clip.tracks.find((t: any) => t.name === "kip_Hips.position"), 3).entries()) {
        expect(Math.abs(p[0]!), `hips x frame ${i}`).toBeLessThanOrEqual(40);
        expect(Math.abs(p[2]!), `hips z frame ${i}`).toBeLessThanOrEqual(45);
        expect(p[1]!, `hips y frame ${i}`).toBeGreaterThanOrEqual(HIP_Y - 26);
        expect(p[1]!, `hips y frame ${i}`).toBeLessThanOrEqual(HIP_Y + 34);
      }
    });

    it(`${entry.id}: actually moves (a clip that never changes is a pose, not an animation)`, () => {
      let travelled = 0;
      for (const j of KIP_CLIP_JOINTS) {
        const f = frames(quatTrack(clip, j), 4);
        for (const q of f) travelled = Math.max(travelled, deg(angleBetween(f[0]!, q)));
      }
      expect(travelled).toBeGreaterThan(8);
    });
  }
});

describe("kip clips: planted feet and natural hands", () => {
  const q = (arr: number[]) => new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]);
  // ankle world position of one leg for frame i, straight from the baked quaternion tracks (the same chain the page's skeleton has)
  const ankle = (clip: any, i: number, side: "L" | "R") => {
    const names = REST_LEGS[side].names as string[];
    const hips = q(frames(quatTrack(clip, "Hips"), 4)[i]!);
    const hp = frames(clip.tracks.find((t: any) => t.name === "kip_Hips.position"), 3)[i]!;
    const qu = hips.clone().multiply(q(frames(quatTrack(clip, names[0]!), 4)[i]!));
    const qk = qu.clone().multiply(q(frames(quatTrack(clip, names[1]!), 4)[i]!));
    const hip = new THREE.Vector3(REST_LEGS[side].side * LEG_RIG.hipX, 0, 0).applyQuaternion(hips).add(new THREE.Vector3(hp[0], hp[1], hp[2]));
    const knee = new THREE.Vector3(0, -LEG_RIG.thigh, 0).applyQuaternion(qu).add(hip);
    return new THREE.Vector3(...(LEG_RIG.shin as [number, number, number])).applyQuaternion(qk).add(knee);
  };
  const stance = (side: "L" | "R") => legFK(THREE, [0, 0, 0], [0, HIP_Y, 0], REST_LEGS[side]).ankle as THREE.Vector3;

  it("keeps both feet where they started in every clip: reactions, dances and props (no sliding on the floor)", () => {
    const planted = (KIP_CLIPS as any[]).filter((c) => c.plant);
    expect(planted.length, "every clip is planted").toBe(KIP_CLIPS.length);
    for (const entry of planted) {
      const clip = built.get(entry.id);
      const n = quatTrack(clip, "Hips").values.length / 4;
      for (const side of ["L", "R"] as const) {
        let worst = 0;
        for (let i = 0; i < n; i++) {
          const a = ankle(clip, i, side), s = stance(side);
          worst = Math.max(worst, Math.hypot(a.x - s.x, a.z - s.z));
        }
        expect(worst, `${entry.id}: ${side} foot slides ${worst.toFixed(2)} mm across the floor`).toBeLessThan(0.5);
      }
    }
  });

  it("lifts a foot only straight up in the stepping dances (a knee lift that never slides, never sinks)", () => {
    for (const [id, minLift, maxLift] of [["dance_boogie", 5, 12], ["dance_disco", 4, 10], ["dance_sway", 3, 6]] as const) {
      const clip = built.get(id);
      const n = quatTrack(clip, "Hips").values.length / 4;
      for (const side of ["L", "R"] as const) {
        let hi = -1e9, lo = 1e9;
        for (let i = 0; i < n; i++) { const dy = ankle(clip, i, side).y - stance(side).y; hi = Math.max(hi, dy); lo = Math.min(lo, dy); }
        expect(hi, `${id}: ${side} foot never lifts`).toBeGreaterThanOrEqual(minLift);
        expect(hi, `${id}: ${side} foot lifts too far (${hi.toFixed(1)} mm)`).toBeLessThanOrEqual(maxLift);
        expect(lo, `${id}: ${side} foot sinks ${lo.toFixed(1)} mm below the floor`).toBeGreaterThanOrEqual(-0.6);
      }
    }
  });

  // A clip like a retargeted Mixamo dance: the hips wander 40 mm sideways (past the legs' reach) and bob above standing height, the legs are just the rest stance (so the feet skate), and the left knee
  // comes up in the middle. This is what `plantBakedClip` exists for.
  const bakedLike = () => buildKipClip(THREE, "baked_like", 2, (ph: number, setQ: any) => {
    setQ("Hips", 0, 10 * Math.sin(ph), 0);
    for (const k of ["L", "R"] as const) { const l = REST_LEGS[k]; setQ(l.names[0], ...l.up); setQ(l.names[1], l.knee, 0, 0); setQ(l.names[2], ...l.foot); }
    if (Math.sin(ph) > 0.3) { setQ("LeftUpLeg", -35, 3, 3); setQ("LeftLeg", 45, 0, 0); }              // a knee lift
    return [40 * Math.sin(ph), HIP_Y + 6 * Math.abs(Math.sin(ph * 2)), 0];
  });
  const worstXZ = (clip: any) => {
    let w = 0; const n = quatTrack(clip, "Hips").values.length / 4;
    for (const side of ["L", "R"] as const) for (let i = 0; i < n; i++) { const a = ankle(clip, i, side), s = stance(side); w = Math.max(w, Math.hypot(a.x - s.x, a.z - s.z)); }
    return w;
  };

  it("plants the feet of a baked clip: they skated more than 10 mm, now at most 1.5 mm, with the knee lift kept as a lift", () => {
    const before = bakedLike();
    expect(worstXZ(before), "the synthetic clip must skate, or this test proves nothing").toBeGreaterThan(10);
    const clip = plantBakedClip(THREE, bakedLike());
    expect(worstXZ(clip)).toBeLessThan(1.5);
    const n = quatTrack(clip, "Hips").values.length / 4;
    let liftL = 0, sinkL = 0, sinkR = 0;
    for (let i = 0; i < n; i++) {
      liftL = Math.max(liftL, ankle(clip, i, "L").y - stance("L").y);
      sinkL = Math.min(sinkL, ankle(clip, i, "L").y - stance("L").y); sinkR = Math.min(sinkR, ankle(clip, i, "R").y - stance("R").y);
    }
    expect(liftL, "the knee lift is gone").toBeGreaterThan(3);
    expect(liftL, "the lift is too tall").toBeLessThanOrEqual(14.5);
    expect(Math.min(sinkL, sinkR), "a foot sinks into the floor").toBeGreaterThanOrEqual(-0.6);
  });

  it("caps a baked clip's wrist bend and forearm twist, and keeps everything else", () => {
    const clip = buildKipClip(THREE, "wrists", 1, (_ph: number, setQ: any) => {
      setQ("RightHand", 20, 150, 70); setQ("LeftHand", 0, 30, 10);                    // a bent, twisted right hand; a gentle left one
      return [0, HIP_Y, 0];
    });
    const read = (name: string) => frames(quatTrack(clip, name), 4).map((f) => new THREE.Quaternion(f[0], f[1], f[2], f[3]));
    const leftBefore = read("LeftHand")[0]!.clone();
    const bend = (q: THREE.Quaternion) => deg(new THREE.Vector3(0, 1, 0).applyQuaternion(q).angleTo(new THREE.Vector3(0, 1, 0)));
    expect(bend(read("RightHand")[0]!), "the right wrist must start too bent").toBeGreaterThan(40);
    limitHands(THREE, clip, { maxBend: 35, maxTwist: 100 });
    const r = read("RightHand")[0]!;
    expect(bend(r)).toBeLessThanOrEqual(35.5);
    const twist = deg(2 * Math.atan2(r.y, r.w));
    expect(Math.abs(twist), "twist cap").toBeLessThanOrEqual(100.5);
    expect(read("LeftHand")[0]!.angleTo(leftBefore), "a hand inside the limits must not change").toBeLessThan(0.01);
  });

  /** A hand that sweeps from straight to 71 degrees of bend (about x) over 90 frames, 0.8 degrees a frame, as one frame-by-frame list of bends in degrees after `limit`. */
  function bendsAfter(limit: (clip: any) => void): number[] {
    const n = 90, times = new Float32Array(n), vals = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      times[i] = i / 30;
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (i * 0.8 * Math.PI) / 180).toArray(vals, i * 4);
    }
    const clip = new THREE.AnimationClip("h", -1, [new THREE.QuaternionKeyframeTrack("kip_RightHand.quaternion", times, vals)]);
    limit(clip);
    const v = clip.tracks[0]!.values;
    return Array.from({ length: n }, (_, i) => (2 * Math.acos(Math.min(1, Math.abs(v[i * 4 + 3]!))) * 180) / Math.PI);
  }

  /** The limiter's rules as a function of the limiter, so it can be run on a hard clamp. Returns the failures. */
  function limiterFailures(limit: (clip: any) => void): string[] {
    const bad: string[] = [];
    const b = bendsAfter(limit);
    for (let i = 0; i < b.length; i++) {
      const src = i * 0.8;
      if (src <= 24.5 && Math.abs(b[i]! - src) > 1e-3) { bad.push(`frame ${i}: a ${src.toFixed(1)} degree bend (under 70% of the cap) must be left alone, got ${b[i]!.toFixed(2)}`); break; }
    }
    if (Math.max(...b) > 35.001) bad.push(`the cap of 35 was passed: ${Math.max(...b).toFixed(2)}`);
    for (let i = 1; i < b.length; i++) if (b[i]! < b[i - 1]! - 1e-6) { bad.push("the bend must never go back while the source keeps rising"); break; }
    // a smooth wrist: its speed changes gently. A wall (the hand stops dead at the cap) makes the speed drop by the whole 0.8 degrees in one frame.
    let corner = 0;
    for (let i = 2; i < b.length; i++) corner = Math.max(corner, Math.abs(b[i]! - 2 * b[i - 1]! + b[i - 2]!));
    if (corner > 0.3) bad.push(`the wrist's speed has a corner of ${corner.toFixed(2)} degrees a frame`);
    return bad;
  }

  it("eases into the wrist cap: below 70 % untouched, never past it, never reversing, and no corner in the wrist's speed", () => {
    expect(limiterFailures((c) => limitHands(THREE, c))).toEqual([]);
    expect(softCap(10, 35)).toBe(10);
    expect(softCap(24.5, 35)).toBe(24.5);
    expect(softCap(1000, 35)).toBeLessThanOrEqual(35);
    expect(softCap(1000, 35)).toBeGreaterThan(34.99);
    for (let x = 0; x < 200; x += 0.5) expect(softCap(x + 0.5, 35), String(x)).toBeGreaterThanOrEqual(softCap(x, 35));
  });

  it("fails the same rules on a hard clamp (so the check can fail): the wrist stops dead at the cap", () => {
    const hard = (clip: any) => {
      const t = clip.tracks[0], q = new THREE.Quaternion();
      for (let i = 0; i < t.values.length / 4; i++) {
        q.set(t.values[i * 4], t.values[i * 4 + 1], t.values[i * 4 + 2], t.values[i * 4 + 3]);
        const bend = (2 * Math.acos(Math.min(1, q.w)) * 180) / Math.PI;
        if (bend > 35) new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (35 * Math.PI) / 180).toArray(t.values, i * 4);
      }
    };
    expect(limiterFailures(hard).join("|")).toMatch(/corner/);
  });

  it("never bends a wrist more than 20 degrees in a prop clip with a retargeted arm (a natural grip)", () => {
    const tracked = (KIP_CLIPS as any[]).filter((c) => c.group === "prop" && c.id !== "prop_shield" && c.id !== "prop_shaft");
    expect(tracked.length).toBeGreaterThanOrEqual(16);
    for (const entry of tracked) {
      const hand = frames(quatTrack(built.get(entry.id), "RightHand"), 4);
      let worst = 0;
      for (const f of hand) worst = Math.max(worst, deg(new THREE.Vector3(0, 1, 0).applyQuaternion(q(f)).angleTo(new THREE.Vector3(0, 1, 0))));
      expect(worst, `${entry.id}: wrist bent ${worst.toFixed(0)} degrees`).toBeLessThanOrEqual(20);
    }
  });

  it("mounts exactly the props the arm table was solved for end for end (wardrobe flip === table flip)", () => {
    for (const p of WORKSHOP_PROPS as any[]) {
      const clip = clipForProp(p.id);
      expect(Boolean(p.flip), `${p.id} flip flag disagrees with the arm table for ${clip}`).toBe(FLIPPED_PROP_CLIPS.includes(clip));
    }
    expect(FLIPPED_PROP_CLIPS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("kip clips: dance tempo (the party time-scales a dance to a song, spec 3.3)", () => {
  const dances = () => (KIP_CLIPS as any[]).filter((c) => c.group === "dance");

  it("every dance carries the tempo it was authored at, and its loop is a whole number of beats at that tempo", () => {
    for (const c of dances()) {
      expect(c.bpm, `${c.id} has no bpm`).toBeGreaterThanOrEqual(MIN_BPM);
      expect(c.bpm, `${c.id} bpm`).toBeLessThanOrEqual(MAX_BPM);
      expect(Number.isInteger(c.beats) && c.beats > 0, `${c.id} beats`).toBe(true);
      expect(c.dur * (c.bpm / 60), `${c.id}: ${c.dur} s at ${c.bpm} bpm is not ${c.beats} beats`).toBeCloseTo(c.beats, 9);
    }
  });

  it("only dances carry a tempo (a prop clip is not played to a song)", () => {
    for (const c of KIP_CLIPS as any[]) if (c.group !== "dance") expect(c.bpm, c.id).toBeUndefined();
  });

  it("some dance fits every song from 64 to 150 bpm, so the slow sway closes the gap the 120 bpm dances leave below 96", () => {
    const list = dances().map((c) => ({ id: c.id, bpm: c.bpm }));
    for (let bpm = 64; bpm <= 150; bpm++) expect(pickDance(bpm, list), `no dance for ${bpm} bpm`).not.toBeNull();
    // without the sway the same sweep has a hole
    const withoutSway = list.filter((c) => c.id !== "dance_sway");
    expect(pickDance(80, withoutSway)).toBeNull();
    expect(pickDance(90, withoutSway)).toBeNull();
  });

  it("each tempo card (shared/songCards.ts) gets a dance, and the slow card gets the sway", () => {
    const list = dances().map((c) => ({ id: c.id, bpm: c.bpm }));
    for (const t of TEMPOS) expect(pickDance(TEMPO_BPM[t], list), `no dance for the ${t} card`).not.toBeNull();
    expect(pickDance(TEMPO_BPM.slow, list)?.id).toBe("dance_sway");
    expect(["dance_boogie", "dance_disco", "dance_robot"]).toContain(pickDance(TEMPO_BPM.medium, list)?.id);
  });

  it("the sway is at its natural speed or within the quarter-either-way limit for a lullaby", () => {
    const sway = dances().find((c) => c.id === "dance_sway");
    for (const bpm of [64, 70, 80, 90, 100]) {
      const { rate, inRange } = tempoRate(bpm, sway.bpm);
      expect(inRange, `${bpm} bpm gives rate ${rate}`).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(TEMPO_RATE_MIN);
      expect(rate).toBeLessThanOrEqual(TEMPO_RATE_MAX);
    }
  });
});

describe("kip clips: wiring", () => {
  it("is copied by build:kip and covered by the brand scan, and the page imports it with the same ?v= as its siblings", () => {
    expect(read("scripts/build-kip.ts")).toContain("viewer/kip-clips.js");
    expect(read("tests/kip.test.ts")).toContain("parts/kip/viewer/kip-clips.js");
    const page = read("parts/kip/viewer/kip-bench.js"); // the page's script, since Workshop stage 4a
    const v = /kip-menu\.js\?v=([\d.]+)/.exec(page)?.[1];
    expect(page).toContain(`'/kip/kip-clips.js?v=${v}'`);
  });

  it("stays pure: no page state, no DOM, no network", () => {
    const src = read("parts/kip/viewer/kip-clips.js");
    const code = src.replace(/\/\/.*$/gm, ""); // comments may name the page hooks; only code counts
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest)\b/);
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
