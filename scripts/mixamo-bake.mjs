#!/usr/bin/env node
// Bake downloaded Mixamo FBX files into the small joint-data JSON the Kip bench plays (docs/specs/dance-party-spec.md 3.1, phase 2).
//
//   node scripts/mixamo-bake.mjs                          # every clip in scripts/mixamo-clips.json
//   node scripts/mixamo-bake.mjs --only dance_silly       # one or more ids, comma separated
//   node scripts/mixamo-bake.mjs --dry                    # report only, write nothing
//   options: --in DIR (default .local/mixamo)  --out DIR (default public/kip/mixamo/baked)  --config FILE
//
// Per clip: parse the FBX (three's FBXLoader) -> optional trim -> take the hips' drift out -> retarget onto Kip's 14 joints with the SAME code the
// page uses (kip-mixamo-retarget.js) -> optionally close the loop -> cap the wrists (limitHands) -> plant the feet (plantBakedClip, unless `plant: false`) -> check -> write JSON. The raw FBX is only
// ever READ, from a git-ignored folder, and never copied anywhere: what ships is joint data. Prints the numbers the real-page gate
// (scripts/kip-dance-gate.mjs) also checks, so a bad clip shows up before the page is opened.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { retargetMixamoClipToKip } from "../parts/kip/viewer/kip-mixamo-retarget.js";
import { HIP_Y, LEG_RIG, REST_LEGS, limitHands, plantBakedClip } from "../parts/kip/viewer/kip-clips.js";
import { BAKED_JOINTS, checkBaked, clipToBaked, closeLoop, removeHipsDrift, trimClip } from "../parts/kip/viewer/kip-baked-clips.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function parseArgs(argv) {
  const a = { in: path.join(root, ".local/mixamo"), out: path.join(root, "public/kip/mixamo/baked"), config: path.join(here, "mixamo-clips.json"), only: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--dry") a.dry = true;
    else if (k === "--in") a.in = path.resolve(argv[++i]);
    else if (k === "--out") a.out = path.resolve(argv[++i]);
    else if (k === "--config") a.config = path.resolve(argv[++i]);
    else if (k === "--only") a.only = argv[++i].split(",");
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

// ---- the numbers (same definitions as the page gate: seam, floor slide, standing height, bare-hand wrist) ----------------------------------

const qOf = (arr, i) => new THREE.Quaternion(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);

function ankleAt(baked, i, side) {
  const names = REST_LEGS[side].names;
  const hips = qOf(baked.q.Hips, i);
  const hp = new THREE.Vector3(baked.hips[i * 3], baked.hips[i * 3 + 1], baked.hips[i * 3 + 2]);
  const qu = hips.clone().multiply(qOf(baked.q[names[0]], i));
  const qk = qu.clone().multiply(qOf(baked.q[names[1]], i));
  const hip = new THREE.Vector3(REST_LEGS[side].side * LEG_RIG.hipX, 0, 0).applyQuaternion(hips).add(hp);
  const knee = new THREE.Vector3(0, -LEG_RIG.thigh, 0).applyQuaternion(qu).add(hip);
  return new THREE.Vector3(...LEG_RIG.shin).applyQuaternion(qk).add(knee);
}

function measure(baked) {
  const n = baked.frames;
  let seam = 0;
  for (const j of BAKED_JOINTS) {
    const q = baked.q[j];
    const d = Math.abs(q[0] * q[(n - 1) * 4] + q[1] * q[(n - 1) * 4 + 1] + q[2] * q[(n - 1) * 4 + 2] + q[3] * q[(n - 1) * 4 + 3]);
    seam = Math.max(seam, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
  }
  let slide = 0, lowest = Infinity, hipsLo = Infinity, hipsHi = -Infinity, travel = 0;
  for (const side of ["L", "R"]) {
    const pts = Array.from({ length: n }, (_, i) => ankleAt(baked, i, side));
    const floor = Math.min(...pts.map((p) => p.y));
    lowest = Math.min(lowest, floor);
    let start = null;
    for (let i = 0; i < n; i++) {
      if (pts[i].y < floor + 2) { start ??= pts[i]; slide = Math.max(slide, Math.hypot(pts[i].x - start.x, pts[i].z - start.z)); } else start = null;
    }
  }
  for (let i = 0; i < n; i++) {
    hipsLo = Math.min(hipsLo, baked.hips[i * 3 + 1]); hipsHi = Math.max(hipsHi, baked.hips[i * 3 + 1]);
    travel = Math.max(travel, Math.hypot(baked.hips[i * 3] - baked.hips[0], baked.hips[i * 3 + 2] - baked.hips[2]));
  }
  let wrist = 0;
  // wrist BEND, as the page gate measures it: how far the hand's axis leaves the forearm's (a twist about the forearm does not count)
  for (const h of ["LeftHand", "RightHand"]) for (let i = 0; i < n; i++) wrist = Math.max(wrist, (Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(qOf(baked.q[h], i)).y)) * 180) / Math.PI);
  return { seam, slide, lowestAnkle: lowest, hipsLo, hipsHi, travel, wrist };
}

// ---- one clip --------------------------------------------------------------------------------------------------------------------------

function loadFbx(file) {
  const buf = fs.readFileSync(file);
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  if (!obj.animations?.length) throw new Error("no animation in the file");
  return obj;
}

/** A clip of a Mixamo character that ships in the repo as a GLB (public/kip/mixamo/Xbot.glb: idle, walk, run): `{ glb, clip }` in the config. The GLB has no textures, so it parses in node. */
async function loadGlb(file) {
  const buf = fs.readFileSync(file);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
  const obj = gltf.scene;
  obj.animations = gltf.animations;
  return obj;
}

export async function bakeOne(cfg, inDir) {
  const file = path.join(inDir, cfg.file ?? "");
  const obj = cfg.glb ? await loadGlb(path.join(root, cfg.glb)) : loadFbx(file);
  let clip = cfg.clip ? obj.animations.find((a) => a.name === cfg.clip) : obj.animations[0];
  if (!clip) throw new Error(`no clip "${cfg.clip}" in ${cfg.glb}`);
  const srcDuration = clip.duration;
  if (cfg.trim) clip = trimClip(THREE, clip, cfg.trim[0], cfg.trim[1]);
  const drift = removeHipsDrift(THREE, clip, { highpassSeconds: cfg.highpass ?? 0 });
  const kip = retargetMixamoClipToKip(THREE, clip, obj, { name: cfg.id, inPlace: cfg.inPlace ?? false });
  if (!kip) throw new Error("retarget failed: no Hips bone");
  if (cfg.closeLoop) closeLoop(THREE, kip, cfg.closeLoop);
  if (cfg.hands !== false) limitHands(THREE, kip);
  if (cfg.plant !== false) plantBakedClip(THREE, kip);
  const baked = clipToBaked(THREE, kip, { id: cfg.id, label: cfg.label, group: cfg.group, source: cfg.glb ? `Mixamo Xbot "${cfg.clip}"` : `Mixamo "${path.basename(cfg.file, ".fbx")}"`, beats: cfg.beats, planted: cfg.plant !== false });
  const problems = checkBaked(baked, { loop: Boolean(cfg.loop) });
  return { baked, problems, drift, srcDuration, metrics: measure(baked) };
}

// ---- main ------------------------------------------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = JSON.parse(fs.readFileSync(args.config, "utf8"));
  const todo = args.only ? list.filter((c) => args.only.includes(c.id)) : list;
  if (args.only) for (const id of args.only) if (!list.some((c) => c.id === id)) throw new Error(`no clip "${id}" in ${path.basename(args.config)}`);
  if (!args.dry) fs.mkdirSync(args.out, { recursive: true });
  const index = [];
  let failed = 0;
  for (const cfg of todo) {
    try {
      const { baked, problems, drift, srcDuration, metrics: m } = await bakeOne(cfg, args.in);
      const tag = problems.length ? "PROBLEMS" : "ok";
      console.log(`${tag.padEnd(8)} ${cfg.id.padEnd(16)} ${baked.dur.toFixed(2)} s${cfg.trim ? ` (of ${srcDuration.toFixed(1)})` : ""}, ${baked.frames} frames` +
        `${baked.bpm ? `, ${baked.beats} beats = ${baked.bpm} bpm` : ""} | seam ${m.seam.toFixed(1)} deg, slide ${m.slide.toFixed(1)} mm, ankle ${m.lowestAnkle.toFixed(1)} mm, ` +
        `hips ${m.hipsLo.toFixed(0)}..${m.hipsHi.toFixed(0)} mm, travel ${m.travel.toFixed(0)} mm, wrist ${m.wrist.toFixed(0)} deg | drift removed ${drift.ramp.toFixed(0)} + wander ${drift.wander.toFixed(0)} (source cm)`);
      for (const p of problems) console.log(`           ! ${p}`);
      if (problems.length) failed++;
      if (!args.dry && !problems.length) {
        fs.writeFileSync(path.join(args.out, `${cfg.id}.json`), JSON.stringify(baked));
        index.push({ id: baked.id, label: baked.label, group: baked.group, dur: baked.dur, ...(baked.beats ? { beats: baked.beats, bpm: baked.bpm } : {}), loop: Boolean(cfg.loop), planted: baked.planted, source: baked.source });
      }
    } catch (e) {
      failed++;
      console.log(`FAILED   ${cfg.id.padEnd(16)} ${e.message}`);
    }
  }
  if (!args.dry && !args.only) fs.writeFileSync(path.join(args.out, "index.json"), JSON.stringify({ v: 1, clips: index }, null, 1) + "\n");
  else if (!args.dry && args.only && index.length) console.log("(index.json not rewritten for a partial run)");
  console.log(`${todo.length - failed} of ${todo.length} baked${args.dry ? " (dry run: nothing written)" : ""}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
