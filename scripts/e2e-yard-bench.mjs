#!/usr/bin/env node
// Yard bench (the double-drum road roller): headless-Chrome checks of the real bench with the real CAD STLs (nothing mocked).
// Model: parts/kip/viewer/yard-vehicles.js (pure, unit-tested in tests/yard-vehicles.test.ts) and the Truck's hand-push model (truck-drive.js).
// Run: npm run e2e:yard-bench   (or node scripts/e2e-yard-bench.mjs)     Exits nonzero on any failing check.
//
// What it proves:
//   - the page loads the four CAD solids and draws the roller: 1 keel, 1 windscreen, 2 wide axles, 4 drums, in the places Gate G1 craft 10 proves
//     (axles at the 100 mm wheelbase, drums 26.7 to 51.5 mm out, each axle flush with its drums, a mirrored pair, standing on the ground);
//   - pushing rolls the drums without slip (spin = distance / 25), braking, reversing and coasting follow the hand-push model, and the camera travels with it;
//   - the keyboard and the on-screen buttons both drive it, and a bench switched away ignores them;
//   - the front-axle float control slides the front pair by 14.2 mm either way and never past the keel's nose;
//   - mounted on a host's shared stage it is "hosted" (one canvas, drawn by the stage's loop), and dispose() gives everything back;
//   - nothing throws.
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("yard bench e2e");
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;
const KEY = { w: [87, "KeyW"], s: [83, "KeyS"], r: [82, "KeyR"], " ": [32, "Space"] };
const down = (t, k) => t.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: KEY[k][1], windowsVirtualKeyCode: KEY[k][0], text: k.length === 1 && k !== " " ? k : undefined });
const up = (t, k) => t.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: KEY[k][1], windowsVirtualKeyCode: KEY[k][0] });
const Y = "window.__yardDrive";

const server = await startServer();
const chrome = await launchChrome();
try {
  // ---- A. standalone page ----
  console.log("A. the standalone page");
  const a = await chrome.open(`${server.base}/kip/Yard-Bench.html`);
  check("the Yard bench loads its CAD solids", await a.waitFor("window.__YARD_READY__ === true", 240000), "never ready");
  const urls = a.requests.map((r) => r.url);
  for (const id of ["kit_keel_base", "kit_windscreen", "kit_barbell_shaft_wide", "kit_drum_roller"]) {
    check(`it fetched ${id}.stl from the mockup set`, urls.some((u) => u.endsWith(`/partspec/mockup/${id}.stl`)));
  }
  const probe = JSON.parse(await a.evaluate("JSON.stringify(window.__yardProbe())"));
  const count = (g) => probe.filter((p) => p.geo === g).length;
  check("the roller is 1 keel, 1 windscreen, 2 wide axles and 4 drums", count("kit_keel_base") === 1 && count("kit_windscreen") === 1 && count("kit_barbell_shaft_wide") === 2 && count("kit_drum_roller") === 4, JSON.stringify(probe.map((p) => p.geo)));
  const drums = probe.filter((p) => p.geo === "kit_drum_roller");
  const axleY = { front: -56.25, rear: 43.75 };
  let drumsOk = true, detail = "";
  for (const d of drums) {
    const left = d.role === "drum-left";
    const xLo = left ? -51.5 : 26.7, xHi = left ? -26.7 : 51.5;
    const cy = (d.min[1] + d.max[1]) / 2, cz = (d.min[2] + d.max[2]) / 2;
    const ok = near(d.min[0], xLo) && near(d.max[0], xHi) && near(d.max[1] - d.min[1], 50) && near(d.max[2] - d.min[2], 50) && near(cy, axleY[d.axle]) && near(cz, 6.25);
    if (!ok) { drumsOk = false; detail += ` ${d.axle}/${d.role}: x ${d.min[0].toFixed(2)}..${d.max[0].toFixed(2)} y ${cy.toFixed(2)} z ${cz.toFixed(2)};`; }
  }
  check("each drum is O50 x 24.8, 26.7 mm out from the centreline, centred on its axle row at axle height", drumsOk, detail);
  check("the drums are a mirrored pair (rotation -90 and +90 degrees about Y)", drums.every((d) => (d.role === "drum-left" ? near(d.rotY, -Math.PI / 2, 1e-9) : near(d.rotY, Math.PI / 2, 1e-9))));
  const shafts = probe.filter((p) => p.geo === "kit_barbell_shaft_wide");
  check("each wide axle is 103.0 mm and ends flush with its drums' outer faces", shafts.every((s) => near(s.min[0], -51.5) && near(s.max[0], 51.5)), JSON.stringify(shafts.map((s) => [s.min[0], s.max[0]])));
  const bb = await a.evaluate(`${Y}.bbox()`);
  check("the drums stand on the ground (lowest point y = 0)", near(bb.min[1], 0, 0.02), JSON.stringify(bb));
  check("the readout and the parts list are drawn", await a.evaluate(`document.querySelectorAll('#yard-bom span').length === 8 && /Speed 0 mm\\/s/.test(document.getElementById('yard-readout').textContent)`));

  // ---- B. driving, step by step (the same code the frame loop runs) ----
  console.log("B. driving and rolling");
  const start = await a.evaluate(`${Y}.pose()`);
  check("it starts at rest at the origin", start.pz === 0 && start.v === 0 && start.spin === 0, JSON.stringify(start));
  const cam0 = await a.evaluate(`({ c: ${Y}.camera(), t: ${Y}.target() })`);
  await a.evaluate(`(() => { for (let i = 0; i < 240; i++) ${Y}.step(1 / 120, { throttle: 1, brake: false }); })()`);
  const pushed = await a.evaluate(`${Y}.pose()`);
  // 300 mm/s hand-push top speed, 800 mm/s^2: a 0.375 s ramp covers 56.25 mm, then 1.625 s at 300 = 487.5 mm
  check("two seconds of pushing reaches the hand-push top speed (300 mm/s)", near(pushed.v, 300, 1e-6), String(pushed.v));
  check("it covered the integral of the speed (ramp plus cruise, 543.75 mm, within 1 percent)", Math.abs(pushed.pz - 543.75) / 543.75 < 0.01, String(pushed.pz));
  check("the drums rolled without slip: spin = distance / 25 mm, on both axles", near(pushed.spin, pushed.pz / 25, 1e-9) && near(pushed.axleSpin.front, pushed.spin, 1e-9) && near(pushed.axleSpin.rear, pushed.spin, 1e-9), JSON.stringify(pushed));
  const moved = JSON.parse(await a.evaluate("JSON.stringify(window.__yardProbe())")).filter((p) => p.geo === "kit_drum_roller");
  check("the parts keep their places relative to the roller as it travels (travel and spin are taken out)", moved.every((m, i) => near(m.min[0], drums[i].min[0], 1e-3) && near(m.max[0], drums[i].max[0], 1e-3)), "");
  const cam1 = await a.evaluate(`({ c: ${Y}.camera(), t: ${Y}.target() })`);
  const off = (c, t) => c.map((v, i) => v - t[i]);
  check("the camera travelled with the roller (same view of it)", off(cam0.c, cam0.t).every((v, i) => near(v, off(cam1.c, cam1.t)[i], 1e-6)) && Math.abs(cam1.t[2] - cam0.t[2] - pushed.pz) < 1e-6, JSON.stringify({ cam0, cam1 }));
  await a.evaluate(`(() => { for (let i = 0; i < 24; i++) ${Y}.step(0.01, { throttle: 0, brake: false }); })()`); // 0.24 s of coasting
  const coast = await a.evaluate(`${Y}.pose().v`);
  check("letting go coasts down at the rolling drag (441.45 mm/s^2)", near(coast, 300 - 0.24 * 441.45, 0.5), String(coast));
  await a.evaluate(`(() => { for (let i = 0; i < 200; i++) ${Y}.step(0.01, { throttle: 0, brake: true }); })()`);
  check("braking stops it", (await a.evaluate(`${Y}.pose().v`)) === 0);
  await a.evaluate(`(() => { for (let i = 0; i < 600; i++) ${Y}.step(1 / 120, { throttle: -1, brake: false }); })()`);
  const rev = await a.evaluate(`${Y}.pose()`);
  check("reversing is slower than pushing (180 mm/s) and the drums turn back", near(rev.v, -180, 1e-6) && rev.spin < pushed.spin, JSON.stringify(rev));
  await a.evaluate(`${Y}.home()`);
  const homed = await a.evaluate(`${Y}.pose()`);
  check("Home puts it back at the start, stopped, with the drums at zero", homed.pz === 0 && homed.v === 0 && homed.spin === 0 && homed.axleSpin.front === 0, JSON.stringify(homed));

  // ---- C. the real keyboard and the on-screen buttons ----
  console.log("C. keyboard and buttons");
  await down(a, "w");
  check("holding W (a real key event) accelerates the roller", await a.waitFor(`${Y}.pose().v > 100`, 60000));
  await up(a, "w");
  check("letting go of W coasts to a stop on its own", await a.waitFor(`${Y}.pose().v === 0`, 60000));
  check("it moved forward while W was held", (await a.evaluate(`${Y}.pose().pz`)) > 10);
  await down(a, "r"); await up(a, "r");
  check("R (a real key event) sends it home", (await a.evaluate(`${Y}.pose().pz`)) === 0);
  await a.evaluate(`document.getElementById('btn-push').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, pointerType: 'touch' }))`);
  check("a held Push button counts as a held key (synthetic pointer events, not a real touch)", await a.evaluate(`${Y}.held().includes('push') && document.getElementById('btn-push').classList.contains('held')`));
  check("and the roller moves under it", await a.waitFor(`${Y}.pose().v > 100`, 60000));
  await a.evaluate(`document.getElementById('btn-push').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true, pointerType: 'touch' }))`);
  check("releasing it lets go", await a.evaluate(`!${Y}.held().includes('push') && !document.getElementById('btn-push').classList.contains('held')`));
  await a.waitFor(`${Y}.pose().v === 0`, 60000);
  await a.evaluate(`document.getElementById('btn-home').click()`);
  check("the Home button works", (await a.evaluate(`${Y}.pose().pz`)) === 0);

  // ---- D. the front-axle float ----
  console.log("D. the front-axle float");
  const front = (p) => p.filter((x) => x.axle === "front" && x.geo === "kit_drum_roller");
  const rear = (p) => p.filter((x) => x.axle === "rear" && x.geo === "kit_drum_roller");
  const base = JSON.parse(await a.evaluate("JSON.stringify(window.__yardProbe())"));
  await a.evaluate(`document.getElementById('btn-float').click()`);
  const l = JSON.parse(await a.evaluate("JSON.stringify(window.__yardProbe())"));
  const dl = front(l).map((d, i) => d.min[0] - front(base)[i].min[0]);
  check("the float button slides the front pair left by 14.2 mm and the rear pair not at all", dl.every((v) => near(v, -14.2, 1e-3)) && rear(l).every((d, i) => near(d.min[0], rear(base)[i].min[0], 1e-9)), JSON.stringify(dl));
  const innerRight = Math.min(...front(l).filter((d) => d.role === "drum-right").map((d) => d.min[0]));
  check("slid that far, the right drum's inner face is still outside the nose (half width 12.4)", innerRight > 12.4, String(innerRight));
  check("the button says so", /slid left 14\.2/.test(await a.evaluate(`document.getElementById('btn-float').textContent`)));
  await a.evaluate(`document.getElementById('btn-float').click()`);
  const r2 = JSON.parse(await a.evaluate("JSON.stringify(window.__yardProbe())"));
  check("the next click slides it right by 14.2 mm", front(r2).every((d, i) => near(d.min[0] - front(base)[i].min[0], 14.2, 1e-3)));
  await a.evaluate(`document.getElementById('btn-float').click()`);
  check("and the next centres it again", near((await a.evaluate(`${Y}.pose().frontFloat`)), 0, 1e-12));

  // a picture, so a person can look at it too
  const shotPath = process.env.YARD_SHOT;
  if (shotPath) { await a.shot(shotPath); console.log(`  (screenshot: ${shotPath})`); }

  // ---- E. hosted on a shared stage, and teardown ----
  console.log("E. hosted on a shared stage");
  const hostedOk = await a.evaluate(`(async () => {
    const { createStage } = await import('/kip/bench-stage.js');
    const { THREE, OrbitControls } = await import('/kip/vendor/three-kip.js');
    const { mountYardBench } = await import('/kip/yard-bench.js');
    // the standalone bench in the page is unmounted first: one host, one bench
    window.yardBench.dispose();
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.append(host);
    const stage = createStage({ THREE, OrbitControls, host });
    const bench = mountYardBench(host, { stage });
    stage.add('yard', bench);
    await bench.ready;
    const hiddenAtStart = bench.root.hidden;
    stage.activate('yard');
    stage.start();
    await new Promise((r) => setTimeout(r, 600));
    const out = {
      hosted: bench.hosted, hiddenAtStart, shownWhenActive: !bench.root.hidden,
      canvases: document.querySelectorAll('canvas').length, canvasInBench: bench.root.contains(stage.canvas),
      ready: window.__YARD_READY__ === true,
    };
    window.__stageTest = { stage, bench, host };
    return out;
  })()`);
  check("a bench given a stage is hosted, starts hidden and shows when the stage activates it", hostedOk.hosted === true && hostedOk.hiddenAtStart === true && hostedOk.shownWhenActive === true, JSON.stringify(hostedOk));
  check("there is exactly one canvas on the page and it sits under the active bench", hostedOk.canvases === 1 && hostedOk.canvasInBench === true, JSON.stringify(hostedOk));
  await a.evaluate(`window.__yardDrive.step(1 / 60, { throttle: 1, brake: false })`);
  check("a hosted bench still drives", (await a.evaluate(`window.__yardDrive.pose().pz`)) > 0);
  await down(a, "w");
  check("the stage's loop draws it and a held key pushes it", await a.waitFor(`window.__yardDrive.pose().v > 100`, 60000));
  await a.evaluate(`window.__stageTest.bench.setActive(false)`);
  check("standing the bench down releases its keys and stops it", await a.evaluate(`window.__yardDrive.held().length === 0 && window.__yardDrive.pose().v === 0`));
  await up(a, "w");
  const stoppedAt = await a.evaluate(`window.__yardDrive.pose().pz`);
  await down(a, "w");
  await new Promise((r) => setTimeout(r, 800));
  check("a bench switched away ignores the keyboard", (await a.evaluate(`window.__yardDrive.pose().pz`)) === stoppedAt);
  await up(a, "w");
  await a.evaluate(`(() => { const t = window.__stageTest; t.bench.dispose(); t.stage.remove('yard'); t.stage.dispose(); t.host.remove(); })()`);
  const gone = await a.evaluate(`({ hooks: [typeof window.__yardProbe, typeof window.__yardDrive, typeof window.__YARD_READY__], bench: !!document.querySelector('.yard-bench'), css: !!document.getElementById('yard-bench-css'), canvases: document.querySelectorAll('canvas').length })`);
  check("dispose gives everything back: hooks, markup, style and the canvas", gone.hooks.every((h) => h === "undefined") && !gone.bench && !gone.css && gone.canvases === 0, JSON.stringify(gone));

  check("nothing threw", a.exceptions.length === 0, a.exceptions.join(" | "));
  a.close();
} finally {
  chrome.close();
  server.close?.();
}
finish();
