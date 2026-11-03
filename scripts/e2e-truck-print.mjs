#!/usr/bin/env node
// The Truck's "Print plates" (Workshop, 2026-11-03): every part used to land on its own plate because the planner splits plates by colour and the Truck
// colours each part differently. By default the Truck now packs everything together, and "Colours" in the panel splits by colour again. Headless Chrome,
// the real bench and the real planner (nothing mocked).
// Run: npm run e2e:truck-print     Exits nonzero on any failing check.
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("truck print e2e");
const server = await startServer();
const chrome = await launchChrome();
const P = "window.truckPrint";
const info = (t) => t.evaluate(`(() => { const p = ${P}, s = p.summary(), pl = p.plannedPlates(); return {
  split: p.splitByColour(), parts: s.parts, plates: s.plates, busy: p.isBusy(), label0: p.plateLabel(0), errors: [...(s.errors || []), ...(s.unmapped || [])],
  perPlate: pl.map((x) => x.placed.length), colours: pl.map((x) => new Set(x.placed.map((q) => q.hex)).size),
  ids: pl.flatMap((x) => x.placed.map((q) => q.partId + '#' + q.instance)).sort(),
  legal: pl.every((x) => x.placed.every((q) => q.x >= -1e-6 && q.y >= -1e-6 && q.x + q.w <= x.boundMm + 1e-6 && q.y + q.h <= x.boundMm + 1e-6)),
  status: document.getElementById('print-status').textContent, btn: document.getElementById('print-colours').textContent }; })()`);
try {
  for (const stage of ["pro", "mech"]) {
    console.log(`stage ${stage}`);
    const t = await chrome.open(`${server.base}/kip/Truck-Mockup.html?stage=${stage}&ui=0`, { width: 800, height: 500 });
    check(`${stage}: the Truck loads`, await t.waitFor("window.__TRUCK_READY__ === true && !!window.truckPrint", 240000));
    await t.evaluate("document.getElementById('btn-print').click(); 0");
    check(`${stage}: the plate view opens and finishes planning`, await t.waitFor(`${P}.isOn() === true && !${P}.isBusy() && ${P}.summary().parts > 0`, 240000));
    const together = await info(t);
    check(`${stage}: by default everything is packed together (not split by colour), and the button says so`, together.split === false && /all together/i.test(together.btn), JSON.stringify({ split: together.split, btn: together.btn }));
    check(`${stage}: ${together.parts} parts on ${together.plates} plate(s) when together: several parts per plate, far fewer plates than parts`, together.plates >= 1 && together.plates <= Math.ceil(together.parts / 3) && together.perPlate.some((n) => n > 1), JSON.stringify(together.perPlate));
    check(`${stage}: every part is on exactly one plate, inside the bed`, together.ids.length === together.parts && new Set(together.ids).size === together.parts && together.legal && together.errors.length === 0, JSON.stringify(together.errors));
    check(`${stage}: the plates are named "All parts" with no placeholder colour`, /^Plate 1 of \d+: All parts$/.test(together.label0), together.label0);
    check(`${stage}: the panel says how many parts are on how many plates`, new RegExp(`${together.parts} parts on ${together.plates} plate`).test(together.status), together.status);

    await t.evaluate("document.getElementById('print-colours').click(); 0");
    check(`${stage}: "Colours" splits by colour again (and the repack finds every part: the plate view hides the truck)`, await t.waitFor(`${P}.splitByColour() === true && !${P}.isBusy() && ${P}.summary().parts === ${together.parts}`, 240000), "parts after the repack: " + (await info(t)).parts);
    const split = await info(t);
    check(`${stage}: split by colour: ${split.plates} plates (one colour each), more than together's ${together.plates}`, split.plates > together.plates && split.colours.every((n) => n === 1), JSON.stringify(split.colours));
    check(`${stage}: the same parts, none lost or doubled, in both modes`, JSON.stringify(split.ids) === JSON.stringify(together.ids), "");
    check(`${stage}: split plates keep their colour names`, /^Plate 1 of \d+: .+ \(#[0-9A-F]{6}\)$/i.test(split.label0) && /split by colour/i.test(split.btn), split.label0 + " | " + split.btn);

    await t.evaluate("document.getElementById('print-colours').click(); 0");
    check(`${stage}: and back to together`, await t.waitFor(`${P}.splitByColour() === false && !${P}.isBusy() && ${P}.summary().plates === ${together.plates}`, 240000));
    check(`${stage}: no uncaught exception`, t.exceptions.length === 0, t.exceptions.slice(0, 2).join(" | "));
    t.close();
  }
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome.close();
  server.close();
  finish();
}
