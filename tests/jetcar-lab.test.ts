import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Jet Car Lab (parts/kip/viewer/JetCar-Lab.html): the page reads a clearance grid by (D, lean) and a snapshot of Kip's pose. These checks catch the
// ways that drifts silently: a grid that no longer covers the page's sliders, a missing field the page prints, a Kip pose that lost its meshes, and
// public copies that no longer match the viewer copies.
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const page = read("parts/kip/viewer/JetCar-Lab.html");
const data = JSON.parse(read("parts/kip/viewer/jetcar-clearance.json"));
const pose = JSON.parse(read("parts/kip/viewer/jetcar-kip-pose.json"));
const slider = (id: string) => {
  const m = new RegExp(`id="${id}" type="range" min="([\\d.]+)" max="([\\d.]+)" step="([\\d.]+)"`).exec(page);
  expect(m, `slider ${id}`).not.toBeNull();
  return { min: Number(m![1]), max: Number(m![2]), step: Number(m![3]) };
};

describe("jet car lab", () => {
  it("has a grid row for every (balloon diameter, lean) the sliders can reach", () => {
    const d = slider("bd"), l = slider("bl");
    for (let D = d.min; D <= d.max + 1e-9; D += d.step) {
      for (let lean = l.min; lean <= l.max + 1e-9; lean += l.step) {
        const row = data.grid.find((g: any) => g.D === D && g.lean === lean);
        expect(row, `no grid row for D=${D} lean=${lean}`).toBeTruthy();
        for (const k of ["kip", "w36", "w50", "jet"]) expect(typeof row[k], `D=${D} lean=${lean} ${k}`).toBe("number");
      }
    }
  });

  it("prints only fields the generator writes", () => {
    for (const k of ["keel_overlap_mm3", "windscreen_gap_mm", "axle_gear_overlap_mm3", "w36_gap_mm", "w50_gap_mm", "body_bbox", "mass_g_solid_pla"]) {
      expect(data.facts[k], `facts.${k}`).toBeDefined();
      expect(page, `page uses ${k}`).toContain(k);
    }
    expect(data.assumptions.neck_mm).toBeGreaterThan(0);
    expect(typeof data.kip_rear_y).toBe("number");
  });

  it("is a real sweep: a vertical balloon touches Kip and a 30 deg lean clears him", () => {
    const at = (D: number, lean: number) => data.grid.find((g: any) => g.D === D && g.lean === lean);
    expect(at(175, 0).kip).toBeLessThan(0);
    expect(at(175, 30).kip).toBeGreaterThan(5);
    expect(at(175, 30).jet).toBeGreaterThan(5);
    expect(at(175, 60).jet).toBeLessThan(0);   // too far back: the balloon reaches the jet stream
  });

  it("keeps Kip's pose snapshot complete, and every mesh it names exists as an STL the page can load", () => {
    expect(pose.rows.length).toBeGreaterThan(20);
    for (const r of pose.rows) {
      expect(r.m.length, r.geo).toBe(16);
      const f = r.geo.startsWith("stls/") ? `public/kip/${r.geo}.stl` : `public/kip/partspec/mockup/${r.geo}.stl`;
      expect(existsSync(join(root, f)), f).toBe(true);
    }
    expect(existsSync(join(root, "public/kip/partspec/mockup/mom_jet_valve_body.stl"))).toBe(true);
  });

  it("ships through build:kip, and the public copies match the viewer copies", () => {
    const build = read("scripts/build-kip.ts");
    for (const f of ["JetCar-Lab.html", "jetcar-clearance.json", "jetcar-kip-pose.json"]) {
      expect(build, f).toContain(f);
      expect(read(`public/kip/${f}`), `public/kip/${f} differs from the viewer copy`).toBe(read(`parts/kip/viewer/${f}`));
    }
    expect(read("parts/kip/sync_truck_parts.py")).toContain('"mom_jet_valve_body"');
  });
});
