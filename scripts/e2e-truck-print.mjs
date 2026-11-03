#!/usr/bin/env node
// The Truck's "Print plates" (Workshop, 2026-11-03): every part used to land on its own plate because the planner splits plates by colour and the Truck
// colours each part differently. By default the Truck now packs everything together, and "Plates" in the menu splits by colour again. Since stage 4c the
// controls are the ONE menu's Print group (the Truck's own print panel is gone) and the Kip driver sitting in the cab prints with the truck. Headless Chrome,
// the real bench and the real planner (nothing mocked).
// Run: npm run e2e:truck-print     Exits nonzero on any failing check.
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";
import { menu } from "./lib/menu-drive.mjs";

const { check, finish } = createChecks("truck print e2e");
const server = await startServer();
const chrome = await launchChrome();
const P = "window.truckPrint";
const info = (t) => t.evaluate(`(() => { const p = ${P}, s = p.summary(), pl = p.plannedPlates(); return {
  split: p.splitByColour(), parts: s.parts, plates: s.plates, busy: p.isBusy(), label0: p.plateLabel(0), errors: [...(s.errors || []), ...(s.unmapped || [])],
  perPlate: pl.map((x) => x.placed.length), colours: pl.map((x) => new Set(x.placed.map((q) => q.hex)).size),
  ids: pl.flatMap((x) => x.placed.map((q) => q.partId + '#' + q.instance)).sort(),
  legal: pl.every((x) => x.placed.every((q) => q.x >= -1e-6 && q.y >= -1e-6 && q.x + q.w <= x.boundMm + 1e-6 && q.y + q.h <= x.boundMm + 1e-6)),
  status: document.getElementById('km-printInfo')?.textContent ?? '', split_ctl: document.getElementById('km-plateSplit')?.value }; })()`);
const isDriver = (id) => /^(torso|snap_torso|upper_arm|forearm|thigh|shin|snap_arm|snap_leg|spark_peg_(big|sml)|snap_turret_(big|sml)|char_head_|robot_head_|char_faceplate|hair_|hat_)/.test(id);
try {
  for (const stage of ["pro", "mech"]) {
    console.log(`stage ${stage}`);
    const t = await chrome.open(`${server.base}/kip/Truck-Mockup.html?stage=${stage}&ui=0`, { width: 800, height: 500 });
    check(`${stage}: the Truck loads`, await t.waitFor("window.__TRUCK_READY__ === true && !!window.truckPrint", 240000));
    check(`${stage}: the menu has its Print group, and the Truck's old print panel and buttons are gone`, await t.evaluate(`!!document.getElementById('km-plateView') && !document.getElementById('print-panel') && !document.getElementById('btn-print')`));
    await t.evaluate(menu.toggle("plateView", true));
    check(`${stage}: the plate view opens and finishes planning`, await t.waitFor(`${P}.isOn() === true && !${P}.isBusy() && ${P}.summary().parts > 0`, 240000));
    const together = await info(t);
    check(`${stage}: by default everything is packed together (not split by colour), and the menu says so`, together.split === false && together.split_ctl === "together", JSON.stringify({ split: together.split, ctl: together.split_ctl }));
    const driverIds = together.ids.filter((id) => isDriver(id.split("#")[0]));
    check(`${stage}: the Kip driver prints with the truck (torso, head and limbs among ${together.parts} parts, beside the keel)`, driverIds.length >= 15 && driverIds.some((id) => /^(torso|snap_torso)#/.test(id)) && driverIds.some((id) => /^char_head_kid#/.test(id)) && together.ids.some((id) => /^kit_keel_base#/.test(id)), JSON.stringify({ driver: driverIds.slice(0, 6), all: together.ids.length }));
    check(`${stage}: the driver's face plate is counted once, not once from the cab and once from the Kip`, together.ids.filter((id) => id.startsWith("char_faceplate#")).length <= 1, "");
    check(`${stage}: stickers and stencils are not offered here (a mechanism has no artwork renderer)`, await t.evaluate(`${menu.visible("stencils")} === false && ${menu.visible("stickers")} === false`));
    check(`${stage}: ${together.parts} parts on ${together.plates} plate(s) when together: several parts per plate, far fewer plates than parts`, together.plates >= 1 && together.plates <= Math.ceil(together.parts / 3) && together.perPlate.some((n) => n > 1), JSON.stringify(together.perPlate));
    check(`${stage}: every part is on exactly one plate, inside the bed`, together.ids.length === together.parts && new Set(together.ids).size === together.parts && together.legal && together.errors.length === 0, JSON.stringify(together.errors));
    check(`${stage}: the plates are named "All parts" with no placeholder colour`, /^Plate 1 of \d+: All parts$/.test(together.label0), together.label0);
    check(`${stage}: the menu says how many parts are on how many plates`, new RegExp(`${together.parts} parts across ${together.plates} plate`).test(together.status), together.status);

    await t.evaluate(menu.select("plateSplit", "colour"));
    check(`${stage}: "Plates" splits by colour again (and the repack finds every part: the plate view hides the truck)`, await t.waitFor(`${P}.splitByColour() === true && !${P}.isBusy() && ${P}.summary().parts === ${together.parts}`, 240000), "parts after the repack: " + (await info(t)).parts);
    const split = await info(t);
    check(`${stage}: split by colour: ${split.plates} plates (one colour each), more than together's ${together.plates}`, split.plates > together.plates && split.colours.every((n) => n === 1), JSON.stringify(split.colours));
    check(`${stage}: the same parts, none lost or doubled, in both modes`, JSON.stringify(split.ids) === JSON.stringify(together.ids), "");
    check(`${stage}: split plates keep their colour names`, /^Plate 1 of \d+: .+ \(#[0-9A-F]{6}\)$/i.test(split.label0) && split.split_ctl === "colour", split.label0 + " | " + split.split_ctl);

    await t.evaluate(menu.select("plateSplit", "together"));
    check(`${stage}: and back to together`, await t.waitFor(`${P}.splitByColour() === false && !${P}.isBusy() && ${P}.summary().plates === ${together.plates}`, 240000));

    // The driver can be left out: "Kip driver" off, and the plates repack with the truck alone.
    await t.evaluate(menu.toggle("kip", false));
    check(`${stage}: with the Kip driver off the plates repack to the truck alone (fewer parts, none of the driver's, the keel still there)`, await t.waitFor(`${P}.isOn() && !${P}.isBusy() && ${P}.summary().parts < ${together.parts}`, 60000), "parts: " + (await info(t)).parts);
    const alone = await info(t);
    check(`${stage}: the truck alone is ${alone.parts} parts, the driver was the other ${together.parts - alone.parts}`, together.parts - alone.parts >= 15 && !alone.ids.some((id) => /^(torso|snap_torso|char_head_|char_faceplate)/.test(id)) && alone.ids.some((id) => /^kit_keel_base#/.test(id)), JSON.stringify(alone.ids.slice(0, 8)));
    await t.evaluate(menu.toggle("kip", true));
    check(`${stage}: and with it back on, the driver is on the plates again`, await t.waitFor(`${P}.isOn() && !${P}.isBusy() && ${P}.summary().parts === ${together.parts}`, 240000), "parts: " + (await info(t)).parts);

    // Leaving the plate view brings the truck back.
    await t.evaluate(menu.toggle("plateView", false));
    check(`${stage}: leaving the plate view shows the truck again`, await t.waitFor(`${P}.isOn() === false`, 20000));
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
