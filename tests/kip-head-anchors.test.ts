import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as wardrobeMod from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const W = wardrobeMod as any;
const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const manifest = JSON.parse(read("public/kip/kip-partspec-manifest.json"));
const cad = read("parts/partspec/toyventor_parts.py");

const HUMAN = ["kid", "chibi", "tall", "jumbo"];

describe("viewer anchors follow the exported human heads and hats", () => {
  for (const id of HUMAN) {
    it(`${id}: crownY and faceY equal the exported head's top_studs and face_slot heights`, () => {
      const part = manifest.parts.find((p: any) => p.id === `char_head_${id}`);
      const studs = part.connectors.find((c: any) => c.id === "top_studs").frame.origin[2];
      const slot = part.connectors.find((c: any) => c.id === "face_slot").frame.origin[2];
      const head = W.WARDROBE_HEADS.find((h: any) => h.id === id);
      expect(head.crownY, `crownY for ${id}`).toBeCloseTo(studs, 2);
      expect(head.faceY, `faceY for ${id}`).toBeCloseTo(slot, 3);
    });
  }

  it("the hat rims and the wrap height are the CAD's HAT_RIM table", () => {
    const m = /^HAT_RIM = \{([^}]*)\}/m.exec(cad);
    expect(m, "HAT_RIM in toyventor_parts.py").toBeTruthy();
    const cadRim = Object.fromEntries([...m![1]!.matchAll(/"(\w+)":\s*([\d.]+)/g)].map((x) => [x[1], Number(x[2])]));
    expect(W.HAT_RIM_MM).toEqual(cadRim);
    expect(W.HAT_WRAP_MM).toBe(Math.max(...(Object.values(cadRim) as number[])));
  });

  it("the forehead is 5% lower than the original on all four human heads (FOREHEAD_SCALE 0.95)", () => {
    const m = /^FOREHEAD_SCALE\s*=\s*([\d.]+)/m.exec(cad);
    expect(m, "FOREHEAD_SCALE in toyventor_parts.py").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.9);
    expect(Number(m![1])).toBeLessThan(1);
    // original crowns: kid, chibi and jumbo 31.4, tall 33.4; brow 22.8 (24.36 on tall): the forehead above the brow is shorter by the scale
    const crown = (id: string) => W.WARDROBE_HEADS.find((h: any) => h.id === id).crownY;
    for (const id of ["kid", "chibi", "jumbo"]) expect(crown(id)).toBeLessThan(31.4);
    expect(crown("tall")).toBeLessThan(33.4);
    expect(crown("kid") - 22.8).toBeCloseTo((31.4 - 22.8) * Number(m![1]), 1);
  });
});
