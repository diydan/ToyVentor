import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as clipsMod from "../parts/kip/viewer/kip-clips.js";
// @ts-expect-error untyped JS module
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { KIP_CLIPS, KIP_CLIP_JOINTS, PROP_CLIPS, clipForProp, makeKipClip, HIP_Y } = clipsMod as any;
const { PROP_OPTIONS } = wardrobe as any;

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
  it("adds 6 reactions, 3 dances and one clip per prop, with unique ids and labels that do not shadow an existing clip", () => {
    const by = (g: string) => KIP_CLIPS.filter((c: any) => c.group === g).length;
    expect([by("reaction"), by("dance")]).toEqual([6, 3]);
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

describe("kip clips: wiring", () => {
  it("is copied by build:kip and covered by the brand scan, and the page imports it with the same ?v= as its siblings", () => {
    expect(read("scripts/build-kip.ts")).toContain("viewer/kip-clips.js");
    expect(read("tests/kip.test.ts")).toContain("parts/kip/viewer/kip-clips.js");
    const page = read("parts/kip/viewer/Kip-Demo.html");
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
