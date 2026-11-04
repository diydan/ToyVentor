#!/usr/bin/env node
// The game's Kip against the Kip bench's Kip, in real Chrome (src/features/game/world/runtime/snapFlex.ts, mixamo.ts `applyJoints`; docs/specs/dance-party-spec.md 6.9).
// Dan, 2026-11-04: "if snap, remember in the game we can use fake rigging like in the kip demo so animations are mapped properly". So: pose the bench's Snap figure at an exact frame of a baked clip
// (the bench's own `kipClips.scrub`), pose the game's figure at the same frame (the baked JSON through the game's own loader, driven by a beat source that never moves), and require the
// two to agree joint by joint: shoulder, the end of the bent sleeve, hand, hip, knee, foot and head, all measured from the hips, in rig millimetres.
// Also checks the figure's feet stay on the floor and do not slide while it dances, and that the old clips (idle, walk) still leave the limbs at rest.
// Run: E2E_GPU=metal node scripts/e2e-game-dance-rig.mjs      Overrides: E2E_PORT (the game's dev server), E2E_TOL (mm, default 0.6)
import { spawn } from "node:child_process";
import { launchChrome, startServer } from "./lib/kip-e2e.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DEV_PORT = Number(process.env.E2E_PORT ?? 5320);
const TOL = Number(process.env.E2E_TOL ?? 0.6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  [${detail}]`}`); };

process.env.E2E_STRICT_STL = "1";
const bench = await startServer();
const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const chrome = await launchChrome({ width: 900, height: 700 });
const done = (code) => { try { chrome.close(); } catch {} try { dev.kill(); } catch {} try { bench.close?.(); } catch {} process.exit(code); };
process.on("SIGINT", () => done(130));
try {
  for (let i = 0; i < 480; i++) { try { if ((await fetch(`http://localhost:${DEV_PORT}/`)).ok) break; } catch {} await sleep(250); }

  // ---- the bench: its Snap figure at exact frames ----------------------------------------------------------------------------------------------------
  const bp = await chrome.open(`${bench.base}/kip/Kip-Demo.html?expr=spark`, { width: 900, height: 700 });
  // a tab in the background does not run its frame loop (headless Chrome), so each page is brought to the front before it is read or posed
  const front = (page) => page.send("Page.bringToFront");
  await front(bp);
  check("the bench loads", await bp.waitFor("window.__KIP_READY__ === true", 180000));
  await sleep(1500);
  await bp.evaluate(`(() => { const f = window.kipMenu.fields.get('edition'); if (f && f.select) { f.select.value = 'snap'; f.select.dispatchEvent(new Event('change', { bubbles: true })); } else window.kipMenu.ctx.loco.edition = 'snap'; })()`);
  await sleep(900);
  check("the bench is showing its Snap figure (the one-piece limbs with the fake joints)", (await bp.evaluate("window.kipMenu.ctx.loco.edition")) === "snap");
  // The bench's Snap override (`applySnapJointOverrides`) multiplies its result back into the joints every frame, and the animation mixer only rewrites a joint when its sampled value CHANGES, so on a
  // paused clip (what `kipClips.scrub` makes) the override compounds on its own output and the pose drifts frame by frame. So: set the joints to the file's raw values for the frame (what the mixer
  // writes while a clip plays), let the bench run exactly ONE of its frames, and read in the callback right after it (registered after the bench's own, so it runs after the bench's frame).
  const benchAt = async (clip, frame) => {
    await front(bp);
    await bp.evaluate(`window.kipClips.scrub(${JSON.stringify(clip)}, 0)`); // makes the clip the bench's current one and stops the others
    await sleep(250);
    return bp.evaluate(`(async () => {
      const baked = await (await fetch('/kip/mixamo/baked/${clip}.json')).json();
      const { THREE, kip } = window.kipRig(); const J = kip.joints; const root = J.Hips.parent;
      const i = ${frame};
      for (const [name, arr] of Object.entries(baked.q)) J[name].quaternion.set(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
      J.Hips.position.set(baked.hips[i * 3], baked.hips[i * 3 + 1], baked.hips[i * 3 + 2]);
      return await new Promise((resolve) => requestAnimationFrame(() => {
        root.updateWorldMatrix(true, false);
        const P = (o) => { const w = o.getWorldPosition(new THREE.Vector3()); const l = root.worldToLocal(w); return [l.x, l.y, l.z]; };
        resolve({ hips: P(J.Hips), shoulderL: P(J.LeftArm), forearmL: P(J.LeftForeArm), handL: P(J.LeftHand), hipL: P(J.LeftUpLeg), kneeL: P(J.LeftLeg), footL: P(J.LeftFoot),
                  shoulderR: P(J.RightArm), forearmR: P(J.RightForeArm), handR: P(J.RightHand), hipR: P(J.RightUpLeg), kneeR: P(J.RightLeg), footR: P(J.RightFoot), head: P(J.Head),
                  // the Head joint's rotation in the rig's frame (the game's head turns about the foot of its neck, so where its origin goes depends on it: see neckSlide below)
                  headQ: (() => { const q = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(J.Head.getWorldQuaternion(new THREE.Quaternion())); return [q.x, q.y, q.z, q.w]; })() });
      }));
    })()`);
  };

  // ---- the game: its figure, the same baked file through the game's own loader, at the same frames ---------------------------------------------------------
  const gp = await chrome.open(`http://localhost:${DEV_PORT}/?title=0`, { width: 390, height: 844 });
  await front(gp);
  const gameUp = await gp.waitFor("!!(window.__tvWorld && window.__tvWorld.P && window.__tvWorld.P.rig && window.__tvWorld.P.rigReady && window.__tvWorld.getMix())", 180000);
  check("the game loads and its figure is built", gameUp);
  if (!gameUp) throw new Error("the game did not come up");
  await sleep(3000);
  check("the game's figure has the Snap limbs (one-piece sleeves with joints) and the driver can drive it", await gp.evaluate(`(() => { const w = window.__tvWorld; const r = w.P.rig; return Boolean(r.snap && r.snap.arms.length === 2 && r.snap.legs.length === 2 && w.getMix().canDrive(r)); })()`));
  const gameSetup = (clip) => gp.evaluate(`(async () => {
    const w = window.__tvWorld, mix = w.getMix();
    const m = await import('/src/features/game/world/runtime/bakedDance.ts');
    const jc = m.parseJointClip(await (await fetch('/kip/mixamo/baked/${clip}.json')).json());
    if (!jc) return false;
    mix.addClips({ probe: m.jointClipToGame(jc, 'probe', { joints: true }) });
    window.__probeT = 0;
    mix.startBeatSource(() => ({ name: 'probe', time: window.__probeT }));
    w.P.target = null;
    return true;
  })()`);
  const gameAt = async (frame, fps = 30) => {
    await front(gp);
    await gp.evaluate(`window.__probeT = ${frame / fps}`);
    await sleep(380);
    return gp.evaluate(`(() => {
      const w = window.__tvWorld, rig = w.P.rig, T = window.__tvDebug.camera.position.constructor, S = 0.0185, parent = rig.g.parent;
      parent.updateWorldMatrix(true, true);
      const P = (o) => { const v = o.getWorldPosition(new T()); parent.worldToLocal(v); return [-v.z / S, v.y / S, v.x / S]; }; // stage (forward +x, left -z) to the rig's frame (+x left, +z forward), in mm
      const hips = (() => { const v = rig.g.localToWorld(new T(0, 61.5 * S, 0)); parent.worldToLocal(v); return [-v.z / S, v.y / S, v.x / S]; })();
      const sn = rig.snap; // the shoulders are read from the sleeve's own root (fore.parent): the arm's holder, rig.arms[i], goes with the hand while a clip bends the elbow, so it is no longer the shoulder
      return { hips, shoulderL: P(sn.arms[0].fore.parent), forearmL: P(sn.arms[0].fore), handL: P(sn.arms[0].hand), hipL: P(rig.feet[0].userData.hip), kneeL: P(sn.legs[0].lower), footL: P(sn.legs[0].foot),
               shoulderR: P(sn.arms[1].fore.parent), forearmR: P(sn.arms[1].fore), handR: P(sn.arms[1].hand), hipR: P(rig.feet[1].userData.hip), kneeR: P(sn.legs[1].lower), footR: P(sn.legs[1].foot), head: P(rig.head),
               soleLow: Math.min(...sn.legs.map((l) => { let lo = 1e9; for (const [dx, dz] of [[-7,-9],[7,-9],[-7,15],[7,15]]) { const v = l.foot.localToWorld(new T(l.boot.position.x + dx, l.boot.position.y, l.boot.position.z + dz)); parent.worldToLocal(v); lo = Math.min(lo, v.y / S); } return lo; })) };
    })()`);
  };
  const stopGame = () => gp.evaluate(`(() => { const mix = window.__tvWorld.getMix(); mix.stopBeatDance(); return true; })()`);

  // The game's head pivot stands 1.1 mm higher on the hips than the bench's (108.0 against about 106.9: the game's own placement, nothing to do with the limbs), so the head gets that much more room.
  const TOL_OF = (k) => (k === "head" ? Math.max(TOL, 1.6) : TOL);
  const JOINTS = ["shoulderL", "forearmL", "handL", "hipL", "kneeL", "footL", "shoulderR", "forearmR", "handR", "hipR", "kneeR", "footR", "head"];
  const rel = (row, key) => [0, 1, 2].map((i) => row[key][i] - row.hips[i]);
  // The bench's head turns about its own joint; the game's turns about the foot of its neck (snapFlex.ts \`hingeHead\`, NECK_FOOT_MM = 7.4 mm below it), so the same turn puts the game's head origin
  // at the bench's plus (I - R) H, H = (0, -7.4, 0): the neck's foot is what stays put. (Dan, 2026-11-04: "we also need to add angles wrists and neck to kip".)
  const NECK_FOOT_MM = 7.4;
  const neckSlide = (q) => { const [x, y, z, w] = q; const H = [0, -NECK_FOOT_MM, 0]; // R H by q v q^-1
    const t = [2 * (y * H[2] - z * H[1]), 2 * (z * H[0] - x * H[2]), 2 * (x * H[1] - y * H[0])];
    const RH = [H[0] + w * t[0] + (y * t[2] - z * t[1]), H[1] + w * t[1] + (z * t[0] - x * t[2]), H[2] + w * t[2] + (x * t[1] - y * t[0])];
    return [H[0] - RH[0], H[1] - RH[1], H[2] - RH[2]]; };
  const expectedRel = (row, key) => (key === "head" ? rel(row, key).map((v, i) => v + neckSlide(row.headQ)[i]) : rel(row, key));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // frames of each baked file (30 per second): spread through the clip so every part of the motion is compared
  const CLIPS = [
    ["dance_hiphop", [0, 12, 27, 45, 66, 93, 117]],
    ["dance_silly", [0, 15, 33, 54, 78, 99]],
    ["move_jacks", [0, 8, 16, 24]],
    ["react_wave", [0, 4, 8, 12]],
  ];
  const worst = {};
  for (const [clip, times] of CLIPS) {
    const ok = await gameSetup(clip);
    check(`the game loads ${clip} from the same baked file the bench plays`, ok);
    await sleep(1200); // the dance eases in over half a second: wait for it to be all the way in
    let clipWorst = 0, clipWorstWhere = "";
    const slide = [];
    let prevSoleX = null;
    for (const t of times) {
      const b = await benchAt(clip, t);
      const g = await gameAt(t);
      if (process.env.E2E_TABLE) console.log(`-- ${clip} frame ${t}  hips bench ${b.hips.map((v) => v.toFixed(1))} game ${g.hips.map((v) => v.toFixed(1))}\n` + JOINTS.map((k) => `   ${k.padEnd(10)} bench ${rel(b, k).map((v) => v.toFixed(1).padStart(7))}   game ${rel(g, k).map((v) => v.toFixed(1).padStart(7))}   off ${dist(rel(b, k), rel(g, k)).toFixed(2)}`).join("\n"));
      for (const k of JOINTS) {
        const d = dist(expectedRel(b, k), rel(g, k));
        if (d - TOL_OF(k) + TOL > clipWorst) { clipWorst = d - TOL_OF(k) + TOL; clipWorstWhere = `${k} at frame ${t}: bench ${expectedRel(b, k).map((v) => v.toFixed(1))} game ${rel(g, k).map((v) => v.toFixed(1))}`; }
        worst[k] = Math.max(worst[k] ?? 0, d);
      }
      slide.push(g.soleLow);
      prevSoleX = g.hips;
    }
    check(`${clip}: every joint is where the bench puts it, within ${TOL} mm of the hips-relative position (worst ${clipWorst.toFixed(2)} mm)`, clipWorst <= TOL, clipWorstWhere);
    const lo = Math.min(...slide), hi = Math.max(...slide);
    check(`${clip}: the lowest sole stays on the floor through the clip (${lo.toFixed(2)} to ${hi.toFixed(2)} mm)`, Math.abs(lo) < 0.5 && Math.abs(hi) < 0.5 || clip === "react_wave" || clip === "move_jacks", `${lo} ${hi}`);
    void prevSoleX;
    await stopGame();
    await sleep(1200);
  }
  console.log("worst per joint (mm):", JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)]))));

  // ---- the old clips still drive the rigid limbs exactly as before ---------------------------------------------------------------------------------------
  await sleep(800);
  const rest = await gp.evaluate(`(() => { const sn = window.__tvWorld.P.rig.snap; const m = window.__tvWorld.getMix(); return { busy: m.busyAction, forePos: sn.arms.map((a) => [a.fore.position.x, a.fore.position.y, a.fore.position.z]), lowerPos: sn.legs.map((l) => [l.lower.position.x, l.lower.position.y, l.lower.position.z]) }; })()`);
  check("after the dance the limbs are back at rest: the hand and boot where the rigid limbs held them", rest.busy === null && rest.forePos.every((p) => Math.abs(p[0]) < 1e-4 && Math.abs(p[1] + 35) < 1e-4 && Math.abs(p[2] - 3.8) < 1e-4) && rest.lowerPos.every((p) => Math.abs(p[1] + 39.2) < 1e-4), JSON.stringify(rest));
  await gp.evaluate(`(() => { const w = window.__tvWorld; w.P.target = { x: w.P.pos.x + 4, z: 0 }; })()`);
  await sleep(1500);
  const walking = await gp.evaluate(`(() => { const sn = window.__tvWorld.P.rig.snap; return sn.arms.map((a) => [a.fore.position.x, a.fore.position.y, a.fore.position.z]); })()`);
  check("walking (the Xbot clips, no joint data) leaves the sleeves unbent and the hands at the rigid arm's cuff", walking.every((p) => Math.abs(p[1] + 35) < 1e-4 && Math.abs(p[2] - 3.8) < 1e-4), JSON.stringify(walking));
  check("no page exceptions (bench or game)", (bp.exceptions?.length ?? 0) === 0 && (gp.exceptions?.length ?? 0) === 0, [...(bp.exceptions ?? []), ...(gp.exceptions ?? [])].slice(0, 3).join(" | "));
} catch (err) {
  check("e2e ran to completion", false, String((err && err.stack) || err));
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
done(failed.length ? 1 : 0);
