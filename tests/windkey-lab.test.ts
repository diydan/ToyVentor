import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Wind Key Lab (parts/kip/viewer/WindKey-Lab.html): the page and parts/kip/windkey_table.py each copy the Band-stage placements from
// Truck-Mockup.html, and the page reads the table by key. These checks catch the two ways that drifts silently: a part id on one side only,
// a table key the page cannot find (Python writes "20.0", JavaScript's String(20) is "20", which broke the first version of the page), and a table that
// keeps only the worst spin (the key's prongs sit 7.8 mm off the axis, so spin 0 and spin 90 are different poses: at 0 the rear wheel blocks, at 90 it does not).
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const page = read("parts/kip/viewer/WindKey-Lab.html");
const doc = JSON.parse(read("parts/kip/viewer/windkey-overlaps.json"));

describe("wind key lab", () => {
  const pageIds = [...page.matchAll(/\{ id: '([a-z_A-Z]+)', label:/g)].map((m) => m[1]!);
  const spins: number[] = Array.from({ length: 360 / doc.spin_step_deg }, (_, i) => i * doc.spin_step_deg);
  const at = (x: number, spin: number) => doc.table[x.toFixed(1)][String(spin)];

  it("lists every part the table has, and no other", () => {
    expect(pageIds.length).toBeGreaterThan(5);
    expect([...pageIds].sort()).toEqual(Object.keys(at(doc.xs[0], 0)).sort());
  });

  it("has a row for every x sample and every spin under the keys the page builds, with a number for every part", () => {
    expect(page).toContain("xs[i].toFixed(1)");
    expect(page).toContain("doc.spin_step_deg");
    expect(spins.length).toBeGreaterThan(3);
    for (const x of doc.xs) {
      for (const spin of spins) {
        const row = at(x, spin);
        expect(row, `no table row for x=${x} spin=${spin}`).toBeTruthy();
        for (const id of pageIds) expect(typeof row[id], `x=${x} spin=${spin} ${id}`).toBe("number");
      }
    }
    expect([...doc.xs].sort((a: number, b: number) => a - b)).toEqual(doc.xs);
  });

  it("is a per-spin sweep, not a worst-case one: spin 0 and spin 90 differ", () => {
    const differs = doc.xs.some((x: number) => JSON.stringify(at(x, 0)) !== JSON.stringify(at(x, 90)));
    expect(differs).toBe(true);
    expect(doc.key_reach_mm).toBe(30);
  });

  it("is a real sweep: the demo pose (x 25) is blocked by the shaft, the tray and the spool, and fully out (x 70) is clear at every spin", () => {
    for (const id of ["pto_shaft", "tray", "spool"]) expect(at(25, 90)[id], id).toBeGreaterThan(doc.min_overlap_mm3);
    for (const spin of spins) expect(Object.values(at(70, spin)).every((v) => v === 0), `spin ${spin}`).toBe(true);
  });

  it("ships through build:kip, and the public copies match the viewer copies", () => {
    const build = read("scripts/build-kip.ts");
    expect(build).toContain("viewer/WindKey-Lab.html");
    expect(build).toContain("viewer/windkey-overlaps.json");
    for (const f of ["WindKey-Lab.html", "windkey-overlaps.json"]) {
      expect(existsSync(join(root, "public/kip", f)), `${f} not in public/kip`).toBe(true);
      expect(read(`public/kip/${f}`)).toBe(read(`parts/kip/viewer/${f}`));
    }
  });
});
