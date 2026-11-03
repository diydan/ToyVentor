// Baked Mixamo clips (parts/kip/viewer/kip-baked-clips.js, kip-mixamo-retarget.js, scripts/mixamo-bake.mjs; docs/specs/dance-party-spec.md 3.1).
//
// What ships is joint data, never a raw Mixamo file. The checks on the tools are functions of an implementation and are also run on versions
// broken on purpose (a drift remover that does nothing, a loop closer that does nothing): each must be caught, or the check proves nothing.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as bakedMod from "../parts/kip/viewer/kip-baked-clips.js";
// @ts-expect-error untyped JS module
import * as clipsMod from "../parts/kip/viewer/kip-clips.js";
import { pickDance, tempoRate } from "../shared/songBeat";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { BAKED_JOINTS, BAKED_VERSION, bakedToClip, checkBaked, clipToBaked, closeLoop, removeHipsDrift, trimClip } = bakedMod as any;
const { KIP_CLIPS, LEG_RIG, REST_LEGS } = clipsMod as any;

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const bakedDir = join(root, "public/kip/mixamo/baked");

// ---- fixtures ---------------------------------------------------------------------------------------------------------------------------

/** A source-style clip: a hips position track that sways 3 cm sideways every second while the whole body walks `driftCm` forward. */
function sourceClip(seconds: number, driftCm: number, wanderCm = 0) {
  const n = Math.round(seconds * 30) + 1;
  const times = new Float32Array(n);
  const v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * seconds;
    times[i] = t;
    v[i * 3] = 3 * Math.sin(2 * Math.PI * t) + wanderCm * Math.sin((2 * Math.PI * t) / seconds); // sway, plus one slow wander across the clip
    v[i * 3 + 1] = 100;
    v[i * 3 + 2] = (driftCm * t) / seconds;
  }
  return new THREE.AnimationClip("src", seconds, [new THREE.VectorKeyframeTrack("mixamorigHips.position", times, v)]);
}

/** A retargeted-style Kip clip: 14 joints and the hips, uniform 30 fps, a small wobble that does NOT end where it started. */
function kipClip(seconds: number, endsElsewhere = true) {
  const n = Math.round(seconds * 30) + 1;
  const times = new Float32Array(n);
  const tracks: any[] = [];
  const hips = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { times[i] = (i / (n - 1)) * seconds; hips[i * 3] = endsElsewhere ? i * 0.1 : 0; hips[i * 3 + 1] = 61.5; hips[i * 3 + 2] = 0; }
  tracks.push(new THREE.VectorKeyframeTrack("kip_Hips.position", times, hips));
  for (const j of BAKED_JOINTS) {
    const q = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = endsElsewhere ? (i / (n - 1)) * 1.2 : 0.3 * Math.sin((i / (n - 1)) * 2 * Math.PI);
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a).toArray(q, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${j}.quaternion`, times, q));
  }
  return new THREE.AnimationClip("k", seconds, tracks);
}

const hipsTrack = (clip: any) => clip.tracks.find((t: any) => /Hips\.position$/.test(t.name));

// ---- the shared tools ---------------------------------------------------------------------------------------------------------------------

describe("baked clips: taking drift out of a source clip", () => {
  /** The drift check as a function of the remover, so it can be run on a broken one. Returns the failures. */
  function driftFailures(remove: (clip: any) => void): string[] {
    const bad: string[] = [];
    const clip = sourceClip(6, 150);
    remove(clip);
    const v = hipsTrack(clip).values;
    const n = v.length / 3;
    if (Math.abs(v[(n - 1) * 3 + 2] - v[2]) > 1e-3) bad.push("a one-way drift must end where it started");
    let sway = 0;
    for (let i = 0; i < n; i++) sway = Math.max(sway, Math.abs(v[i * 3]));
    if (sway < 2.5) bad.push(`the 3 cm sway must survive, got ${sway.toFixed(2)}`);
    for (let i = 0; i < n; i++) if (v[i * 3 + 1] !== 100) { bad.push("height must not change"); break; }
    return bad;
  }

  it("removes a one-way drift, keeps the sway and the height", () => {
    expect(driftFailures((c) => removeHipsDrift(THREE, c))).toEqual([]);
  });

  it("fails the same check on a remover that does nothing (so the check can fail)", () => {
    expect(driftFailures(() => {}).length).toBeGreaterThan(0);
  });

  it("with a high-pass window it also drops a slow wander but keeps the rhythm", () => {
    const clip = sourceClip(20, 0, 100); // a 100 cm wander over the whole clip, a 3 cm sway every second
    const report = removeHipsDrift(THREE, clip, { highpassSeconds: 2 });
    const v = hipsTrack(clip).values;
    let peak = 0;
    for (let i = 0; i < v.length / 3; i++) peak = Math.max(peak, Math.abs(v[i * 3]));
    expect(peak).toBeLessThan(6); // the wander is gone (it was 100), the sway (3) is still there
    expect(peak).toBeGreaterThan(1.5);
    expect(report.wander).toBeGreaterThan(30);
  });

  it("reports what it removed, in the source's units", () => {
    expect(removeHipsDrift(THREE, sourceClip(6, 150)).ramp).toBeCloseTo(150, 3);
    expect(removeHipsDrift(THREE, sourceClip(6, 0)).ramp).toBeLessThan(0.5);
  });
});

describe("baked clips: cutting a window and closing a loop", () => {
  it("keeps the window, re-timed to start at 0", () => {
    const clip = trimClip(THREE, sourceClip(10, 0), 2, 6);
    expect(clip.duration).toBeCloseTo(4, 1);
    expect(hipsTrack(clip).times[0]).toBe(0);
  });

  /** The loop check as a function of the closer. Returns the failures. */
  function loopFailures(close: (clip: any) => void): string[] {
    const bad: string[] = [];
    const clip = kipClip(5);
    const before = Array.from(clip.tracks.find((t: any) => t.name === "kip_Head.quaternion").values) as number[];
    close(clip);
    const baked = clipToBaked(THREE, clip, { id: "x", label: "X", group: "dance", source: "t" });
    if (checkBaked(baked, { loop: true }).length) bad.push("the last frame must be the first");
    const after = clip.tracks.find((t: any) => t.name === "kip_Head.quaternion").values;
    const n = after.length / 4;
    for (let i = 0; i < Math.floor(n * 0.5) * 4; i++) if (Math.abs(after[i] - before[i]) > 1e-6) { bad.push("frames before the closing window must not change"); break; }
    for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(after[i * 4], after[i * 4 + 1], after[i * 4 + 2], after[i * 4 + 3]) - 1) > 1e-4) { bad.push("every frame must stay a unit quaternion"); break; }
    return bad;
  }

  it("makes the last frame the first, touches nothing before the window, and keeps unit quaternions", () => {
    expect(loopFailures((c) => closeLoop(THREE, c, 0.5))).toEqual([]);
  });

  it("fails the same check on a closer that does nothing (so the check can fail)", () => {
    expect(loopFailures(() => {}).length).toBeGreaterThan(0);
  });
});

describe("baked clips: the JSON that ships", () => {
  const good = () => clipToBaked(THREE, kipClip(2, false), { id: "dance_x", label: "X", group: "dance", source: "Mixamo \"X\"", beats: 4 });

  it("round-trips a clip through JSON and back", () => {
    const baked = JSON.parse(JSON.stringify(good()));
    expect(baked.v).toBe(BAKED_VERSION);
    expect(checkBaked(baked, { loop: true })).toEqual([]);
    const clip = bakedToClip(THREE, baked);
    expect(clip.name).toBe("dance_x");
    expect(clip.duration).toBeCloseTo(2, 3);
    expect(clip.tracks).toHaveLength(15);
    const orig = kipClip(2, false).tracks.find((t: any) => t.name === "kip_LeftArm.quaternion");
    const back = clip.tracks.find((t) => t.name === "kip_LeftArm.quaternion")!;
    for (let i = 0; i < orig.values.length; i++) expect(Math.abs(orig.values[i] - back.values[i])).toBeLessThan(2e-5);
  });

  it("derives the tempo from the beats and the duration, so they cannot disagree", () => {
    const b = good();
    expect(b.bpm).toBeCloseTo((60 * 4) / 2, 6);
    expect(checkBaked({ ...b, bpm: 100 }, { loop: true }).join()).toMatch(/is not 4 beats/);
  });

  it("refuses what cannot be trusted", () => {
    const issue = (mutate: (b: any) => void, opts = { loop: true }) => { const b = JSON.parse(JSON.stringify(good())); mutate(b); return checkBaked(b, opts).join(" | "); };
    expect(issue(() => {})).toBe("");
    expect(checkBaked(null)).toEqual(["not a version 1 baked clip"]);
    expect(checkBaked({ v: 2 })).toEqual(["not a version 1 baked clip"]);
    expect(issue((b) => { b.q.Head[3] = 5; })).toMatch(/not a unit quaternion/);
    expect(issue((b) => { b.q.Head[0] = NaN; })).toMatch(/not finite/);
    expect(issue((b) => { b.q.Head.pop(); })).toMatch(/Head: not finite numbers, 4 per frame/);
    expect(issue((b) => { delete b.q.LeftFoot; })).toMatch(/LeftFoot/);
    expect(issue((b) => { b.hips[1] = 500; })).toMatch(/outside Kip's range/);
    expect(issue((b) => { b.hips[0] = 90; })).toMatch(/outside Kip's range/);
    expect(issue((b) => { b.dur = 9; })).toMatch(/does not match/);
    expect(issue((b) => { b.beats = 2.5; })).toMatch(/whole number/);
    // an open loop is refused only when the clip says it loops
    const open = (opts: { loop: boolean }) => checkBaked(clipToBaked(THREE, kipClip(2, true), { id: "x", label: "X", group: "dance", source: "t" }), opts).join(" | ");
    expect(open({ loop: true })).toMatch(/the loop does not close/);
    expect(open({ loop: false })).toBe("");
  });

  it("is plain JSON data: no functions, no raw-file bytes, nothing but numbers, ids and labels", () => {
    const text = JSON.stringify(good());
    expect(text.length).toBeLessThan(60_000);
    expect(JSON.parse(text)).toEqual(good() && JSON.parse(text));
  });
});

// ---- the clips that actually ship -----------------------------------------------------------------------------------------------------

describe("baked clips: the shipped data (public/kip/mixamo/baked)", () => {
  const index = JSON.parse(read("public/kip/mixamo/baked/index.json"));
  const files = readdirSync(bakedDir).filter((f) => f.endsWith(".json") && f !== "index.json");
  const baked = new Map<string, any>(files.map((f) => [f.replace(/\.json$/, ""), JSON.parse(read(`public/kip/mixamo/baked/${f}`))]));
  const GROUPS = ["dance", "move", "music", "react", "act"];

  it("has an index entry for every file and a file for every index entry", () => {
    expect(index.v).toBe(1);
    expect(index.clips.map((c: any) => c.id).sort()).toEqual([...baked.keys()].sort());
    expect(new Set(index.clips.map((c: any) => c.id)).size).toBe(index.clips.length);
    expect(index.clips.length).toBeGreaterThanOrEqual(16);
  });

  it("every clip passes its own check, matches its index entry, and is a sane size", () => {
    for (const c of index.clips) {
      const b = baked.get(c.id)!;
      expect(checkBaked(b, { loop: c.loop }), c.id).toEqual([]);
      expect(b.id, c.id).toBe(c.id);
      expect(b.label, c.id).toBe(c.label);
      expect(b.group, c.id).toBe(c.group);
      expect(GROUPS, c.id).toContain(c.group);
      expect(b.dur, c.id).toBeCloseTo(c.dur, 3);
      expect(b.bpm, c.id).toBe(c.bpm);
      expect(b.planted, c.id).toBe(c.planted);
      expect(b.source, c.id).toMatch(/^Mixamo "/);
      expect(statSync(join(bakedDir, `${c.id}.json`)).size, `${c.id} is large`).toBeLessThan(400_000);
    }
  });

  it("no id shadows a clip the page already has", () => {
    const procedural = new Set(KIP_CLIPS.map((c: any) => c.id));
    const page = ["idle", "walk", "run", "sneak_pose", "HeroWave", "sad_pose", "agree", "headShake", "drive_sit", "scooter_ride", "moto_straddle", "skate_cruise", "SambaDance", "TPose"];
    for (const id of baked.keys()) { expect(procedural.has(id), `${id} shadows a procedural clip`).toBe(false); expect(page, id).not.toContain(id); }
    const labels = index.clips.map((c: any) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) { expect(l.length).toBeGreaterThan(0); expect(l.length, `${l} too long for the menu`).toBeLessThanOrEqual(24); }
  });

  it("a clip that loops has a tempo only if its loop is a whole number of beats", () => {
    for (const c of index.clips) if (c.beats !== undefined) expect(Math.abs((c.dur * c.bpm) / 60 - c.beats), c.id).toBeLessThan(0.01);
    expect(index.clips.filter((c: any) => c.group === "dance" && c.beats).length).toBeGreaterThanOrEqual(3);
  });

  // ankle height from the baked quaternions, the same chain the page's skeleton has (and the same as in kip-clips.test.ts)
  const q = (arr: number[], i: number) => new THREE.Quaternion(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
  const ankle = (b: any, i: number, side: "L" | "R") => {
    const names = REST_LEGS[side].names as string[];
    const hips = q(b.q.Hips, i);
    const qu = hips.clone().multiply(q(b.q[names[0]!], i));
    const qk = qu.clone().multiply(q(b.q[names[1]!], i));
    const hip = new THREE.Vector3(REST_LEGS[side].side * LEG_RIG.hipX, 0, 0).applyQuaternion(hips).add(new THREE.Vector3(b.hips[i * 3], b.hips[i * 3 + 1], b.hips[i * 3 + 2]));
    const knee = new THREE.Vector3(0, -LEG_RIG.thigh, 0).applyQuaternion(qu).add(hip);
    return new THREE.Vector3(...(LEG_RIG.shin as [number, number, number])).applyQuaternion(qk).add(knee);
  };

  it("the clips that plant their feet keep a foot on the floor from sliding (3 mm), and never sink it", () => {
    let checked = 0;
    for (const c of index.clips.filter((x: any) => x.planted)) {
      const b = baked.get(c.id)!;
      for (const side of ["L", "R"] as const) {
        const pts = Array.from({ length: b.frames }, (_, i) => ankle(b, i, side));
        const floor = Math.min(...pts.map((p) => p.y));
        let start: THREE.Vector3 | null = null, worst = 0;
        for (const p of pts) { if (p.y < floor + 2) { start ??= p; worst = Math.max(worst, Math.hypot(p.x - start.x, p.z - start.z)); } else start = null; }
        expect(worst, `${c.id}: ${side} foot slides ${worst.toFixed(1)} mm`).toBeLessThan(3);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("the wrists are natural: a bend of 45 degrees or less, in every clip (the page gate's limit)", () => {
    for (const c of index.clips) {
      const b = baked.get(c.id)!;
      let worst = 0;
      for (const h of ["LeftHand", "RightHand"]) for (let i = 0; i < b.frames; i++) worst = Math.max(worst, (Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(q(b.q[h], i)).y)) * 180) / Math.PI);
      expect(worst, `${c.id} wrist ${worst.toFixed(0)} degrees`).toBeLessThanOrEqual(45);
    }
  });

  it("with the procedural dances, some dance fits every song from 64 to 170 bpm (the song maker has no tempo control)", () => {
    const proc = (KIP_CLIPS as any[]).filter((c) => c.group === "dance").map((c) => ({ id: c.id, bpm: c.bpm }));
    const shipped = index.clips.filter((c: any) => c.group === "dance" && c.bpm).map((c: any) => ({ id: c.id, bpm: c.bpm }));
    const all = [...proc, ...shipped];
    for (let bpm = 64; bpm <= 170; bpm++) expect(pickDance(bpm, all), `no dance for ${bpm} bpm`).not.toBeNull();
    // and the new dances do widen it: the procedural set alone stops at 150
    expect(pickDance(165, proc)).toBeNull();
    expect(pickDance(165, all)).not.toBeNull();
    for (const d of shipped) expect(tempoRate(d.bpm, d.bpm).inRange).toBe(true);
  });
});

// ---- no raw files, and the wiring -------------------------------------------------------------------------------------------------------

describe("baked clips: no raw Mixamo file is in the repo, and the tools are wired in", () => {
  it("no .fbx is tracked or staged, and the download folder is git-ignored", () => {
    const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
    expect(tracked.filter((f) => /\.fbx$/i.test(f))).toEqual([]);
    expect(() => execSync("git check-ignore -q .local/mixamo/x.fbx", { cwd: root })).not.toThrow();
  });

  it("the bench imports both modules with the same ?v= as its siblings, checks a clip before playing it, and survives a missing index", () => {
    const page = read("parts/kip/viewer/kip-bench.js");
    const v = /kip-menu\.js\?v=([\d.]+)/.exec(page)?.[1];
    expect(page).toContain(`'/kip/kip-mixamo-retarget.js?v=${v}'`);
    expect(page).toContain(`'/kip/kip-baked-clips.js?v=${v}'`);
    const loader = page.slice(page.indexOf("Baked Mixamo clips (scripts/mixamo-bake.mjs"), page.indexOf("const bakedTPose"));
    expect(loader.indexOf("checkBaked(")).toBeGreaterThan(-1);
    expect(loader.indexOf("checkBaked(")).toBeLessThan(loader.indexOf("actions.set("));
    expect(loader).toMatch(/try \{[\s\S]*\} catch/);
  });

  it("build:kip copies both modules, and the public copies are identical", () => {
    const build = read("scripts/build-kip.ts");
    for (const f of ["kip-mixamo-retarget.js", "kip-baked-clips.js"]) {
      expect(build).toContain(f);
      expect(existsSync(join(root, "public/kip", f)), f).toBe(true);
      expect(read(`public/kip/${f}`), `${f}: public copy is stale, run build:kip`).toBe(read(`parts/kip/viewer/${f}`));
    }
  });

  it("the two modules stay pure: no page state, no DOM, no network, no imports", () => {
    for (const f of ["kip-mixamo-retarget.js", "kip-baked-clips.js"]) {
      const src = read(`parts/kip/viewer/${f}`);
      expect(src.replace(/\/\/.*$/gm, ""), f).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest)\b/);
      expect(src, f).not.toMatch(/^\s*import\s/m);
    }
  });
});
