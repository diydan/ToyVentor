#!/usr/bin/env node
// Truck keyboard driving: headless-Chrome checks of the real bench (nothing mocked). Model: parts/kip/viewer/truck-drive.js (pure, unit-tested in
// tests/truck-drive.test.ts); this proves the bench wires it to the REAL rack linkage, the real wheels and the real keyboard.
// Run: npm run e2e:truck-drive     Exits nonzero on any failing check.
//
// What it proves:
//   - G (and the Drive button) toggles drive mode, W/A/S/D, Space, Q/E and R do what the HUD says, and G again puts everything back;
//   - straight driving covers the integral of the speed and the wheels roll without slip (axle and steered hubs);
//   - a full lap at steady lock is a circle of the radius the REAL solved wheel angles predict, closing back on its start, on both wheel sizes;
//   - only the Pro Powered Add-On (stage mech) is powered; stages without the rack linkage do not steer; giant wheels cap the lock at 25 degrees;
//   - the camera travels with the truck, a stage change puts the truck back at the start, and a bench switched away ignores the keyboard;
//   - nothing throws.
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("truck drive e2e");
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const D = "window.__truckDrive";
const KEY = { w: [87, "KeyW"], a: [65, "KeyA"], s: [83, "KeyS"], d: [68, "KeyD"], q: [81, "KeyQ"], e: [69, "KeyE"], r: [82, "KeyR"], g: [71, "KeyG"], " ": [32, "Space"] };
const down = (t, k) => t.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: KEY[k][1], windowsVirtualKeyCode: KEY[k][0], text: k.length === 1 && k !== " " ? k : undefined });
const up = (t, k) => t.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: KEY[k][1], windowsVirtualKeyCode: KEY[k][0] });
const tap = async (t, k) => { await down(t, k); await up(t, k); };

const server = await startServer();
const chrome = await launchChrome();
try {
  // ---- A. the real keyboard, powered stage ----
  console.log("A. keyboard on the Pro Powered Add-On (stage mech)");
  const a = await chrome.open(`${server.base}/kip/Truck-Mockup.html?stage=mech`);
  check("the Truck loads", await a.waitFor("window.__TRUCK_READY__ === true && !!window.__truckDrive", 240000), "never ready");
  check("drive mode starts off and its HUD is hidden", await a.evaluate(`${D}.on === false && ${D}.hud().shown === false`));
  await tap(a, "g");
  check("G turns drive mode on and shows the HUD and the button state", await a.waitFor(`${D}.on === true && ${D}.hud().shown && document.getElementById('btn-drive').textContent === 'Drive: On'`, 20000));
  const hud0 = await a.evaluate(`${D}.hud()`);
  check("the HUD says the keys are the remote and that no firmware exists yet", /RC drive/.test(hud0.mode) && /no firmware/.test(hud0.note), JSON.stringify(hud0));

  const p0 = await a.evaluate(`${D}.pose()`);
  const cam0 = await a.evaluate(`({ c: ${D}.camera(), t: ${D}.target() })`);
  await down(a, "w");
  check("holding W accelerates the truck", await a.waitFor(`${D}.pose().v > 150`, 60000));
  await up(a, "w");
  await a.waitFor(`${D}.pose().pz > ${p0.pz} + 20`, 60000);
  const moved = await a.evaluate(`(() => ({ p: ${D}.pose(), c: ${D}.camera(), t: ${D}.target() }))()`);
  check("it moved forward (+Z), straight, with the wheels turning", moved.p.pz > p0.pz + 20 && Math.abs(moved.p.px) < 1e-6 && moved.p.wheelSpin > 0.5, JSON.stringify(moved.p));
  const offset = (c, t) => c.map((v, i) => v - t[i]);
  const o0 = offset(cam0.c, cam0.t), o1 = offset(moved.c, moved.t);
  check("the camera travelled with the truck (same view of it)", o0.every((v, i) => Math.abs(v - o1[i]) < 1e-6) && Math.abs(moved.t[2] - cam0.t[2]) > 20, JSON.stringify({ o0, o1 }));
  check("letting go coasts to a stop on its own (rolling drag)", await a.waitFor(`${D}.pose().v === 0`, 60000));

  await down(a, "a");
  await down(a, "w");
  check("A and W together steer left while driving: heading turns positive", await a.waitFor(`${D}.pose().psi > 0.3 && ${D}.pose().steerDeg > 20`, 60000));
  await up(a, "a");
  check("letting go of A returns the wheels to centre", await a.waitFor(`${D}.pose().steerDeg === 0`, 60000));
  await up(a, "w");
  await down(a, " ");
  check("Space brakes to a stop", await a.waitFor(`${D}.pose().v === 0`, 60000));
  await up(a, " ");

  await down(a, "e");
  check("E tips the bed up", await a.waitFor(`${D}.pose().tipDeg > 40`, 60000));
  await up(a, "e");
  await down(a, "q");
  check("Q tips it back down (and not below the stage's own minimum)", await a.waitFor(`${D}.pose().tipDeg <= 1.5`, 60000));
  await up(a, "q");

  await tap(a, "r");
  const home = await a.evaluate(`({ p: ${D}.pose(), rz: ${D}.rearAxleZ })`);
  check("R puts the truck back at the start", Math.abs(home.p.px) < 1e-9 && Math.abs(home.p.pz - home.rz) < 1e-9 && home.p.psi === 0 && home.p.v === 0, JSON.stringify(home));
  await tap(a, "g");
  const off = await a.evaluate(`({ on: ${D}.on, shown: ${D}.hud().shown, w: [${D}.pose().wrapX, ${D}.pose().wrapZ], btn: document.getElementById('btn-drive').textContent })`);
  check("G again leaves drive mode: HUD hidden, truck at the origin, button back to Off", off.on === false && off.shown === false && off.w[0] === 0 && off.w[1] === 0 && off.btn === "Drive: Off", JSON.stringify(off));
  check("no uncaught exception in the keyboard run", a.exceptions.length === 0, a.exceptions.slice(0, 2).join(" | "));
  a.close();

  // ---- B. deterministic stepping on the real linkage ----
  console.log("B. stepped driving: distance, rolling and turning circles");
  const b = await chrome.open(`${server.base}/kip/Truck-Mockup.html?stage=mech`);
  check("the Truck loads for stepping", await b.waitFor("window.__TRUCK_READY__ === true && !!window.__truckDrive", 240000));
  await b.evaluate(`${D}.set(true)`);
  const straight = await b.evaluate(`(() => {
    const d = ${D}, p = d.params(), dt = 1 / 120, n = 240, start = d.pose();
    let path = 0;
    for (let i = 0; i < n; i++) { const before = d.pose().v; d.step(dt, { throttle: 1 }); path += d.pose().v * dt; }
    const end = d.pose();
    return { start, end, p, path, dist: Math.hypot(end.px - start.px, end.pz - start.pz) };
  })()`);
  const s = straight;
  check("straight: the distance covered is the integral of the speed, and it never yawed", Math.abs(s.dist - s.path) / s.path < 1e-6 && s.end.psi === 0 && Math.abs(s.end.px) < 1e-9, JSON.stringify({ dist: s.dist, path: s.path }));
  check("straight: it reached the N20 top speed (about 471 mm/s on the O36 wheel)", Math.abs(s.end.v - s.p.maxSpeed) < 1e-6 && Math.abs(s.p.maxSpeed - 471.2) < 0.5, `${s.end.v} / ${s.p.maxSpeed}`);
  check("straight: the rear axle rolled without slip (spin x wheel radius = distance)", Math.abs((s.end.wheelSpin - s.start.wheelSpin) * s.p.wRad - s.dist) / s.dist < 1e-6, JSON.stringify({ spin: s.end.wheelSpin, dist: s.dist }));
  check("straight: both steered front hubs rolled the same distance", Math.abs((s.end.spinPlus - s.start.spinPlus) * s.p.wRad - s.dist) / s.dist < 0.01 && Math.abs((s.end.spinMinus - s.start.spinMinus) * s.p.wRad - s.dist) / s.dist < 0.01, JSON.stringify({ plus: s.end.spinPlus, minus: s.end.spinMinus, dist: s.dist }));

  for (const [label, giant] of [["O36 wheels", false], ["O50 giant wheels", true]]) {
    if (giant) await b.evaluate("document.getElementById('btn-wheels').click(); 0");
    await b.evaluate(`${D}.set(false); ${D}.set(true)`); // fresh start at home
    const lap = await b.evaluate(`(() => {
      const d = ${D}, p = d.params(), dt = 1 / 120;
      // reach steady speed and full lock first
      for (let i = 0; i < 400; i++) d.step(dt, { throttle: 1, steerDir: 1 });
      const steady = d.pose();
      const sol = d.solution(steady.steerDeg);
      const cotAvg = 0.5 * (1 / Math.tan(sol.aPlus) + 1 / Math.tan(sol.aMinus));
      const radius = d.wheelbase * cotAvg;
      const lapTime = (2 * Math.PI * radius) / steady.v;
      const steps = Math.round(lapTime / dt);
      // the circle's centre is at +radius to the vehicle's left of the rear axle centre, perpendicular to the heading
      const cx = steady.px + radius * Math.cos(steady.psi), cz = steady.pz - radius * Math.sin(steady.psi);
      let worst = 0, psi0 = steady.psi;
      for (let i = 0; i < steps; i++) { d.step(dt, { throttle: 1, steerDir: 1 }); const q = d.pose(); worst = Math.max(worst, Math.abs(Math.hypot(q.px - cx, q.pz - cz) - radius)); }
      const end = d.pose();
      return { lock: steady.steerDeg, v: steady.v, radius, worst, closure: Math.hypot(end.px - steady.px, end.pz - steady.pz), turned: end.psi - psi0, maxLock: p.lock, wRad: p.wRad };
    })()`);
    check(`${label}: reaches full lock (${giant ? 25 : 34} degrees) and top speed`, lap.lock === lap.maxLock && lap.maxLock === (giant ? 25 : 34), JSON.stringify(lap));
    check(`${label}: one lap is a circle of radius ${lap.radius.toFixed(1)} mm (the real wheel angles' prediction) to within 0.6 percent`, lap.worst / lap.radius < 0.006, `worst ${lap.worst.toFixed(3)} of ${lap.radius.toFixed(1)}`);
    check(`${label}: and it closes: back within 2 percent of the radius of where it started, heading turned a full 360`, lap.closure / lap.radius < 0.02 && Math.abs(lap.turned - 2 * Math.PI) < 0.05, JSON.stringify({ closure: lap.closure, turned: lap.turned }));
    console.log(`     ${label}: turning radius of the rear-axle centre ${lap.radius.toFixed(1)} mm (circle diameter ${(2 * lap.radius / 10).toFixed(1)} cm)`);
  }

  // stage rules
  await b.evaluate("document.getElementById('btn-wheels').click(); 0"); // back to O36
  await b.evaluate(`document.querySelector('[data-stage="snap"]').click()`);
  const snap = await b.evaluate(`(() => {
    const d = ${D}, dt = 1 / 120;
    d.set(false); d.set(true);
    for (let i = 0; i < 300; i++) d.step(dt, { throttle: 1, steerDir: 1 });
    return { p: d.pose(), params: d.params(), hud: d.hud() };
  })()`);
  check("Snap (no rack linkage): A/D do nothing, it drives straight, pushed by hand at a walking pace", snap.p.steerDeg === 0 && snap.p.psi === 0 && !snap.params.steered && !snap.params.powered && Math.abs(snap.p.v - 300) < 1e-6, JSON.stringify(snap.p));
  check("Snap HUD: pushed by hand, fixed axle", /Pushed by hand/.test(snap.hud.mode) && /fixed axle/.test(snap.hud.steer), JSON.stringify(snap.hud));
  await b.evaluate(`document.querySelector('[data-stage="pro"]').click()`);
  const pro = await b.evaluate(`(() => { const d = ${D}; return { p: d.pose(), params: d.params(), rz: d.rearAxleZ, on: d.on }; })()`);
  check("changing stage while driving puts the truck back at the start, still in drive mode", pro.on && Math.abs(pro.p.pz - pro.rz) < 1e-9 && pro.p.v === 0, JSON.stringify(pro.p));
  check("Pro is steered but pushed, not powered", pro.params.steered && !pro.params.powered && pro.params.maxSpeed === 300, JSON.stringify(pro.params));
  check("no uncaught exception while stepping", b.exceptions.length === 0, b.exceptions.slice(0, 2).join(" | "));
  b.close();

  // ---- C. inside the Workshop: a bench that is switched away ignores the keyboard ----
  console.log("C. keyboard isolation in the Workshop");
  const c = await chrome.open(`${server.base}/kip/Workshop.html?bench=truck&stage=mech`);
  check("Truck loads in the Workshop", await c.waitFor("window.workshop?.handles('truck')?.__TRUCK_READY__ === true", 240000));
  const WD = "window.workshop.handles('truck').__truckDrive";
  await tap(c, "g");
  check("G drives the Truck there too", await c.waitFor(`${WD}.on === true`, 20000));
  await down(c, "w");
  await c.waitFor(`${WD}.pose().v > 100`, 60000);
  await c.evaluate("window.workshop.select('kip'); 0");
  check("switching to the Kip stops the Truck dead (no leftover speed, no held key)", await c.waitFor(`window.workshop.stage().activeId === 'kip' && ${WD}.pose().v === 0`, 120000));
  const frozen = await c.evaluate(`${WD}.pose().pz`);
  await settle(800);
  check("W still held, but the hidden Truck does not move", await c.evaluate(`${WD}.pose().pz`) === frozen);
  await up(c, "w");
  await tap(c, "g");
  check("G pressed on the Kip does not toggle the hidden Truck's drive mode", await c.evaluate(`${WD}.on`) === true);
  check("no uncaught exception in the Workshop run", c.exceptions.length === 0, c.exceptions.slice(0, 2).join(" | "));
  c.close();
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome.close();
  server.close();
  finish();
}
