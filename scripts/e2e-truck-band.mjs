#!/usr/bin/env node
// Stage 3A, the Pull-Back Band Core (Workshop, 2026-11-03): the viewer's demo is a kinematic model of the decided design (pull back to wind; no key,
// latch pawl or bumper), and this checks the kinematics are sound by stepping the 6 s loop frame by frame in the real bench.
// Run: npm run e2e:truck-band     Exits nonzero on any failing check.
//
// What it proves (angles in the page's own units: the PTO gear turns at minus the wheel angle, the spool at spoolSpin):
//   - while pulling back and while released the spool is LOCKED to the PTO gear (spool - gear is constant: the clutch drives, nothing slips);
//   - once the band is slack the spool stops and the gear keeps turning in the direction that FREEWHEELS the clutch (spool - gear only ever grows);
//   - the band winds exactly as far as the wheels roll backward (spool = distance / wheel radius) and is fully unwound when the truck passes the line;
//   - the wheels roll without slip whenever they are on the floor, and while the truck is lifted and set back nothing winds or turns;
//   - the dropped parts are gone: no key, latch pin, bumper or bollard in the stage, and no 3B bellows stage;
//   - nothing throws.
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("truck band e2e");
const server = await startServer();
const chrome = await launchChrome();
try {
  // a small window: this check is about numbers, and software rendering of a big one is slow
  const t = await chrome.open(`${server.base}/kip/Truck-Mockup.html?stage=band&ui=0`, { width: 480, height: 320 });
  check("the Truck loads on the band stage", await t.waitFor("window.__TRUCK_READY__ === true && !!window.__truckBand", 240000), "never ready");
  check("the stage list has no bellows button any more, and 2a is the pull-back band", await t.evaluate(`!document.querySelector('[data-stage="bellows"]') && /Pull-Back/.test(document.querySelector('[data-stage="band"]').textContent)`));
  const meshes = await t.evaluate(`JSON.stringify(window.__truckProbe().map((r) => r.geo))`);
  const geos = JSON.parse(meshes);
  check("the band stage draws no wind key, no latch pawl, no bumper trigger, no bellows part", !geos.some((g) => /wind_key|latch_pawl|bumper_trigger|bellows/.test(g)), JSON.stringify(geos.filter((g) => /wind|latch|bumper|bellows/.test(g))));
  check("it does draw the pull-back core: tray, lid, PTO gear and spool", ["mom_band_core_tray", "mom_band_core_lid", "mom_pto_gear_z10", "mom_band_spool_pawl"].every((g) => geos.includes(g)), JSON.stringify(geos.filter((g) => /mom_/.test(g))));

  // step the whole loop, 25 ms at a time, twice (the second lap proves the loop closes cleanly)
  const run = await t.evaluate(`(async () => {
    const B = window.__truckBand, rows = [];
    for (let k = 0; k <= 480; k++) {   // 0 .. 12 s in 25 ms steps = two laps (the largest move per step is under 4 mm, inside the wheel-roll model's 20 mm limit)
      B.step(k * 0.025);
      rows.push(B.snap());
    }
    return rows;
  })()`);
  const rows = run;
  const wRad = rows[0].wRad;
  check("the loop ran: 481 steps, all on the band stage", rows.length === 481 && rows.every((r) => r.stage === "band"));
  const phases = [...new Set(rows.map((r) => r.phase))];
  check("it goes through every phase: set, pull, hold, drive, coast, set back", ["set", "pull", "hold", "drive", "coast", "setback"].every((p) => phases.includes(p)), JSON.stringify(phases));

  const eps = 1e-6;
  const lap = rows.filter((r) => r.t <= 6.0 + 1e-9);
  let lockedWorst = 0, windMismatch = 0, slipWorst = 0, freewheelBad = 0, spoolMax = 0, spoolMin = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const rel = b.spool - b.gear - (a.spool - a.gear); // change in (spool - gear)
    if (["pull", "hold", "drive"].includes(b.phase) && a.phase === b.phase) lockedWorst = Math.max(lockedWorst, Math.abs(rel));
    if (b.phase === "coast" && a.phase === "coast" && rel < -eps) freewheelBad++;
    const dz = b.z - a.z, dWheel = (b.wheelSpin - a.wheelSpin) * wRad;
    if (b.y === 0 && a.y === 0 && Math.abs(dz) < 20) slipWorst = Math.max(slipWorst, Math.abs(dz - dWheel));
    spoolMax = Math.max(spoolMax, b.spool);
    spoolMin = Math.min(spoolMin, b.spool);
  }
  for (const r of rows) if (["pull", "drive"].includes(r.phase)) windMismatch = Math.max(windMismatch, Math.abs(r.spool - (20.0 - r.z) / wRad));
  check(`locked while winding and unwinding: spool minus PTO gear never changes (worst step ${lockedWorst.toExponential(1)} rad)`, lockedWorst < eps);
  check(`the band winds exactly as far as the wheels roll backward: spool = distance / wheel radius (worst error ${windMismatch.toExponential(1)} rad)`, windMismatch < eps);
  check(`never more than 1.25 turns wound (${(spoolMax / (2 * Math.PI)).toFixed(3)}) and never negative (min ${spoolMin})`, spoolMax <= 1.25 * 2 * Math.PI + eps && spoolMin >= 0);
  // 50 ms steps are coarse for the stop, so the stop check below allows for it
  check(`the clutch only freewheels in its free direction while coasting: spool minus gear never decreases (${freewheelBad} violations)`, freewheelBad === 0);
  check(`wheels roll without slip on the floor (worst per-frame error ${slipWorst.toExponential(1)} mm)`, slipWorst < eps);

  // the band is slack when the truck passes the line on the way forward, and slack for the whole coast
  const driveEnd = lap.filter((r) => r.phase === "drive").pop();
  const coasting = lap.filter((r) => r.phase === "coast");
  // the last frame labelled "drive" is up to one 25 ms step (4 mm) before the line; the first slack frame is at it
  check("fully unwound at the line: the last drive frame is almost there and the first slack frame has the spool at zero on the line", driveEnd.spool < 0.25 && driveEnd.spool >= 0 && coasting[0].spool === 0 && Math.abs(coasting[0].z - 20.0) < 1e-6, JSON.stringify({ driveEnd: [driveEnd.spool, driveEnd.z], coast0: [coasting[0].spool, coasting[0].z] }));
  check("slack for the whole coast: the spool stays at zero while the truck rolls on past the line", coasting.every((r) => r.spool === 0) && coasting.at(-1).z > 20 + 40, `end z ${coasting.at(-1).z.toFixed(1)}`);
  check("the truck stops on its own: forward speed falls to zero by the end of the coast", Math.abs(coasting.at(-1).z - coasting.at(-2).z) < 0.3 && coasting.at(-1).z > coasting.at(0).z, JSON.stringify(coasting.slice(-3).map((r) => r.z)));

  // set back: lifted, and nothing winds or turns
  const setback = lap.filter((r) => r.phase === "setback");
  const sbWheel = setback.map((r) => r.wheelSpin), sbSpool = setback.map((r) => r.spool);
  check("lifted and set back on the line: the truck rises, and neither the wheels nor the spool turn", setback.some((r) => r.y > 5) && new Set(sbWheel).size === 1 && sbSpool.every((v) => v === 0) && Math.abs(setback.at(-1).z - 20.0) < 1.0, JSON.stringify({ maxLift: Math.max(...setback.map((r) => r.y)), z: setback.at(-1).z }));
  const lap2 = rows.filter((r) => r.t >= 6.0 && r.phase === "pull");
  check("the second lap winds again from the line (the loop closes)", lap2.length > 10 && Math.max(...lap2.map((r) => r.spool)) > 5);
  check("the status line explains each phase in words", ["set", "pull", "hold", "drive", "coast", "setback"].every((p) => rows.some((r) => r.phase === p && r.status.length > 20)), "");
  check("no uncaught exception", t.exceptions.length === 0, t.exceptions.slice(0, 2).join(" | "));
  t.close();
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome.close();
  server.close();
  finish();
}
