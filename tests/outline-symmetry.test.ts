import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AXIS_MAX_DEG, detectSymmetry, LUMP_MAX_SHARE, MAX_MOVE_MM, symmetrizeOutline } from "../shared/outlineSymmetry";
import { parseScanOutline, parseScanOutlineRequest, scanOutline, type ScanOutlineSuccess } from "../shared/outlineScan";
import { preparePhotoAccessory } from "../shared/photoAccessory";
import { applyAffine, invertAffine, legalizeOutline, type OutlineOptions, type OutlineSuccess, withFlipped, withScaled } from "../shared/photoOutline";
import { cropToObject, disc, randomBlob, type Raster, rasterize, rect, rotated, SHAPES, union } from "./fixtures/outlineMasks";
import { realCup, realSpoon, SPOON_PHOTO } from "./fixtures/realCupMask";

// Detecting the axis rasterises the outline a few hundred times and the legalizer takes 0.1 s a call; the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 90_000 });

type Pt = [number, number];

// ---- checks that do not use the module -----------------------------------------------------------------------------------

/** The furthest any vertex is from a vertex at (-x, z): 0 means every vertex has an exact twin. */
function twinError(points: readonly Pt[]): number {
  let worst = 0;
  for (const [x, z] of points) {
    let best = Infinity;
    for (const [x2, z2] of points) best = Math.min(best, Math.hypot(x2 + x, z2 - z));
    worst = Math.max(worst, best);
  }
  return worst;
}

function inside(poly: readonly Pt[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Overlap of a polygon with its own mirror image about the plane x = 0, by sampling on a 0.2 mm grid. */
function mirrorOverlapAboutZero(poly: readonly Pt[]): number {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const xa = Math.max(...xs.map(Math.abs)) + 1;
  let inter = 0;
  let uni = 0;
  for (let z = Math.min(...zs) - 1; z <= Math.max(...zs) + 1; z += 0.2) {
    for (let x = -xa; x <= xa; x += 0.2) {
      const a = inside(poly, x, z);
      const b = inside(poly, -x, z);
      if (a && b) inter++;
      if (a || b) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

/** Left and right edge of a polygon at height z (null where there is not exactly one piece). */
function edgesAt(poly: readonly Pt[], z: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z) xs.push(xi + ((z - zi) * (xj - xi)) / (zj - zi));
  }
  xs.sort((a, b) => a - b);
  return xs.length === 2 ? [xs[0]!, xs[1]!] : null;
}

const signedArea = (p: readonly Pt[]) => p.reduce((a, q, i) => a + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0) / 2;

/** Overlap of the outline carried back through its photo map with the mask, in mask pixels. */
function maskIoU(o: OutlineSuccess, mask: Raster): number {
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < mask.height; y += 2) {
    for (let x = 0; x < mask.width; x += 2) {
      const [px, pz] = applyAffine(o.photoToPlate, x, y);
      const a = inside(o.points as Pt[], px, pz);
      const b = mask.data[y * mask.width + x] !== 0;
      if (a && b) inter++;
      if (a || b) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

const made = (mask: Raster, options: OutlineOptions = {}): OutlineSuccess => {
  const o = legalizeOutline(mask, { targetHeightMm: 54, ...options });
  if (!o.ok) throw new Error(`legalize failed: ${o.reason}`);
  return o;
};

/** A narrow part: the narrowest width over the middle of the outline's height. */
function narrowest(o: { points: readonly (readonly [number, number])[]; heightMm: number }, from = 0.3, to = 0.9): number {
  let best = Infinity;
  for (let z = o.heightMm * from; z < o.heightMm * to; z += 0.5) {
    const e = edgesAt(o.points as Pt[], z);
    if (e) best = Math.min(best, e[1] - e[0]);
  }
  return best;
}

// Shapes. The synthetic ones are drawn on a 400 px canvas and scaled to 54 mm by the legalizer.
const LOLLIPOP = rasterize(400, 400, union(disc(200, 100, 80), rect(185, 170, 215, 380)));
const L_SHAPE = rasterize(400, 400, union(rect(100, 60, 170, 340), rect(100, 270, 300, 340)));
const MUG = rasterize(400, 400, union(rect(100, 120, 260, 340), disc(285, 230, 50)));
/** A symmetric paddle with bumps on its left edge only: the two sides differ by up to about 1 mm. */
const BUMPY = rasterize(400, 400, union(disc(200, 90, 70), rect(185, 150, 215, 380), disc(131, 90, 7), disc(190, 250, 5), disc(176, 330, 4)));

const SYMMETRIC: [string, () => Raster, OutlineOptions][] = [
  ["a disc", () => SHAPES.disc(), {}],
  ["a paddle", () => SHAPES.paddle(), {}],
  ["a blade", () => SHAPES.blade(), {}],
  ["a lollipop", () => LOLLIPOP, {}],
  ["a star, whose side arms leave two pieces in a row", () => SHAPES.star(), {}],
];

// ---- detecting symmetry --------------------------------------------------------------------------------------------------

describe("detectSymmetry", () => {
  it.each(SYMMETRIC)("%s is symmetric, about an upright axis", (_name, make, opts) => {
    const r = detectSymmetry(made(make(), opts));
    expect(r.symmetric).toBe(true);
    expect(r.reason).toBe("symmetric");
    expect(r.lumpShare).toBeLessThanOrEqual(LUMP_MAX_SHARE);
    expect(r.overlap).toBeGreaterThan(0.94);
    expect(Math.abs(r.axis.angleDeg)).toBeLessThanOrEqual(0.5); // a disc is symmetric about every axis: the upright one wins the tie
    expect(Math.abs(r.axis.offsetMm)).toBeLessThan(0.3);
  });

  it("tells a skewed symmetric object (the real spoon, its bowl off its handle) from one with a lump (the real cup, its handle)", async () => {
    const spoon = detectSymmetry(made((await realSpoon()).raster, { fillet_r_mm: 1.0, keepThinParts: true }));
    const cup = detectSymmetry(made((await realCup()).raster, { keepThinParts: true }));
    // Their raw overlap with the mirror image is about the same (0.86 and 0.87): only the shape of the mismatch tells them apart.
    expect(Math.abs(spoon.overlap - cup.overlap)).toBeLessThan(0.05);
    expect(spoon.overlap).toBeLessThan(0.9);
    expect(spoon.symmetric).toBe(true);
    expect(spoon.lumpShare).toBe(0); // slivers along the edges: all of it goes when the mismatch is opened
    expect(cup.symmetric).toBe(false);
    expect(cup.reason).toBe("lump");
    expect(cup.lumpShare).toBeGreaterThan(0.05); // the handle survives
  });

  it.each([
    ["an L", L_SHAPE],
    ["a mug: a body with a handle on one side", MUG],
    ["a random blob", randomBlob(1)],
  ] as const)("%s is not symmetric", (_name, mask) => {
    const r = detectSymmetry(made(mask));
    expect(r.symmetric).toBe(false);
    expect(r.reason).toBe("lump");
  });

  it("finds an axis that leans: a lollipop left tilted by 8 degrees is symmetric about an axis 8 degrees off upright", () => {
    const tilted = rasterize(400, 400, rotated(union(disc(200, 100, 80), rect(185, 170, 215, 380)), 200, 200, 8));
    const r = detectSymmetry(made(tilted, { orient: "as-photographed" }));
    expect(r.symmetric).toBe(true);
    expect(Math.abs(Math.abs(r.axis.angleDeg) - 8)).toBeLessThan(1);
    expect(Math.abs(r.axis.angleDeg)).toBeLessThanOrEqual(AXIS_MAX_DEG);
  });

  it("says nothing about an outline that is too small to judge", () => {
    const tiny = { points: [[0, 0], [2, 0], [2, 3], [0, 3]] as Pt[], fillet_r_mm: 1.6 };
    expect(detectSymmetry(tiny).reason).toBe("too_small");
    expect(detectSymmetry({ points: [[0, 0], [1, 1]] as Pt[], fillet_r_mm: 1.6 }).symmetric).toBe(false);
  });
});

// ---- making it symmetric -------------------------------------------------------------------------------------------------

describe("symmetrizeOutline: the outline that comes out", () => {
  it.each(SYMMETRIC)("%s: every vertex has an exact twin, it is simple and counter-clockwise, centred, standing on z = 0, and barely moved", (_name, make, opts) => {
    const before = made(make(), opts);
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    expect(twinError(outline.points as Pt[])).toBe(0); // not nearly: exactly
    expect(mirrorOverlapAboutZero(outline.points as Pt[])).toBeGreaterThan(0.9995); // checked again without the module
    expect(signedArea(outline.points as Pt[])).toBeGreaterThan(0);
    expect(Math.min(...outline.points.map((p) => p[1]))).toBe(0);
    expect(Math.max(...outline.points.map((p) => p[0]))).toBe(-Math.min(...outline.points.map((p) => p[0])));
    expect(outline.points.length).toBeLessThanOrEqual(240);
    expect(report.moveMm).toBeLessThan(0.3);
    expect(Math.abs(outline.widthMm - before.widthMm)).toBeLessThan(0.3);
    expect(Math.abs(outline.heightMm - before.heightMm)).toBeLessThan(0.3);
    expect(outline.changes.at(-1)).toMatchObject({ step: "C4", code: "made_symmetric", value: report.moveMm });
    expect(outline.points.every((p) => !Object.is(p[0], -0) && !Object.is(p[1], -0))).toBe(true); // the vertices on the axis are 0, never -0
  });

  it.each(SYMMETRIC)("%s: the photo map still puts the outline on the mask", (_name, make, opts) => {
    const mask = make();
    const before = made(mask, opts);
    const { outline } = symmetrizeOutline(before);
    expect(maskIoU(outline, mask)).toBeGreaterThan(maskIoU(before, mask) - 0.01);
    expect(maskIoU(outline, mask)).toBeGreaterThan(0.97);
  });

  it("the symmetric half-width at each height is the average of the two sides: the left and right edges meet halfway", () => {
    const before = made(BUMPY);
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    let compared = 0;
    let offCentre = 0;
    for (let z = before.heightMm * 0.1; z < before.heightMm * 0.9; z += 1.1) {
      const e = edgesAt(before.points as Pt[], z);
      const n = edgesAt(outline.points as Pt[], z);
      if (!e || !n) continue;
      offCentre = Math.max(offCentre, Math.abs((e[0] + e[1]) / 2));
      expect(n[1], `right edge at z ${z.toFixed(1)}`).toBeCloseTo((e[1] - e[0]) / 2, 1); // within 0.05 mm
      expect(n[0], `left edge at z ${z.toFixed(1)}`).toBeCloseTo(-(e[1] - e[0]) / 2, 1);
      compared++;
    }
    expect(compared).toBeGreaterThan(30);
    expect(offCentre).toBeGreaterThan(0.15); // guard: the bumps really did put the rows off the axis, by several times the 0.05 mm checked above
  });

  it("keeps a thin part that sits off the axis: a 3 mm stick shifted 0.9 mm sideways is as wide afterwards (a field average lost it)", () => {
    const off = rasterize(400, 400, union(disc(200, 100, 80), rect(195, 180, 218, 410)));
    const before = made(off, { keepThinParts: true });
    expect(narrowest(before, 0.5, 0.95)).toBeGreaterThan(2.3); // guard: there is a stick
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    expect(narrowest(outline, 0.5, 0.95)).toBeGreaterThan(narrowest(before, 0.5, 0.95) - 0.15);
    expect(twinError(outline.points as Pt[])).toBe(0);
  });

  it("the real spoon: made symmetric with its handle as wide as it was, no edge moved by a millimetre, and still on the photo's spoon", async () => {
    const { raster } = await realSpoon();
    const before = made(raster, { fillet_r_mm: 1.0, keepThinParts: true });
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    expect(report.moveMm).toBeLessThan(MAX_MOVE_MM);
    expect(twinError(outline.points as Pt[])).toBe(0);
    expect(narrowest(outline)).toBeGreaterThan(narrowest(before) - 0.1); // the neck is no narrower
    expect(Math.abs(outline.heightMm - before.heightMm)).toBeLessThan(0.3);
    expect(maskIoU(outline, raster)).toBeGreaterThan(0.9); // the bowl no longer leans, so it overlaps the lopsided mask a little less (0.93 measured)
    expect(outline.fidelity).toBeGreaterThan(0.9); // and is not reported as a poor fit
  });

  it("straightens a leaning axis and carries the photo map with it: the tilted lollipop ends upright and on the mask", () => {
    const tilted = rasterize(400, 400, rotated(union(disc(200, 100, 80), rect(185, 170, 215, 380)), 200, 200, 8));
    const before = made(tilted, { orient: "as-photographed" });
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    expect(twinError(outline.points as Pt[])).toBe(0);
    expect(mirrorOverlapAboutZero(outline.points as Pt[])).toBeGreaterThan(0.999);
    expect(mirrorOverlapAboutZero(before.points as Pt[])).toBeLessThan(0.97); // guard: it was leaning
    expect(outline.orientation.rotationDeg).toBeCloseTo(before.orientation.rotationDeg + report.axis.angleDeg, 1);
    expect(maskIoU(outline, tilted)).toBeGreaterThan(0.97); // the photo map was rotated with the outline
  });

  it("works on an outline whose rows split in two (a star's side arms), by blending the outline with its mirror image", () => {
    const before = made(SHAPES.star());
    expect([...Array(60).keys()].some((k) => {
      const z = (before.heightMm * (k + 0.5)) / 60;
      return edgesAt(before.points as Pt[], z) === null;
    })).toBe(true); // guard: some row has more than one piece
    const { outline, report } = symmetrizeOutline(before);
    expect(report.applied).toBe(true);
    expect(twinError(outline.points as Pt[])).toBe(0);
    expect(maskIoU(outline, SHAPES.star())).toBeGreaterThan(0.97);
  });
});

// ---- when it leaves an outline alone -------------------------------------------------------------------------------------

describe("symmetrizeOutline: when it leaves an outline alone", () => {
  it.each([
    ["an L", L_SHAPE],
    ["a mug", MUG],
    ["a random blob", randomBlob(1)],
  ] as const)("%s comes back as the same object, with the reason", (_name, mask) => {
    const before = made(mask);
    const { outline, report } = symmetrizeOutline(before);
    expect(outline).toBe(before);
    expect(report.applied).toBe(false);
    expect(report.reason).toBe("lump");
  });

  it("the real cup keeps its handle", async () => {
    const before = made((await realCup()).raster, { keepThinParts: true });
    const { outline, report } = symmetrizeOutline(before);
    expect(outline).toBe(before);
    expect(report.reason).toBe("lump");
  });

  it("will not move an edge past the limit in automatic mode: with 0.2 mm allowed the real spoon is left as it is, with 'mirror' it is made symmetric", async () => {
    const before = made((await realSpoon()).raster, { fillet_r_mm: 1.0, keepThinParts: true });
    const auto = symmetrizeOutline(before, { maxMoveMm: 0.2 });
    expect(auto.outline).toBe(before);
    expect(auto.report.reason).toBe("moved_too_far");
    expect(auto.report.moveMm).toBeGreaterThan(0.2);
    const forced = symmetrizeOutline(before, { mode: "mirror", maxMoveMm: 0.2 });
    expect(forced.report.applied).toBe(true); // mirror mode has a looser limit of its own, 15% of the size
    expect(twinError(forced.outline.points as Pt[])).toBe(0);
  });

  it("'mirror' mode still refuses an L: it overlaps its own mirror image by less than 70%, too little to call it a lopsided symmetric object", () => {
    const before = made(L_SHAPE);
    const { outline, report } = symmetrizeOutline(before, { mode: "mirror" });
    expect(outline).toBe(before);
    expect(report.applied).toBe(false);
  });

  it("does it once: an outline that was made symmetric is returned as it is, and says it is symmetric", () => {
    const once = symmetrizeOutline(made(SHAPES.paddle())).outline;
    const again = symmetrizeOutline(once);
    expect(again.outline).toBe(once);
    expect(again.report).toMatchObject({ applied: false, symmetric: true, reason: "symmetric" });
    expect(once.changes.filter((c) => c.code === "made_symmetric")).toHaveLength(1);
  });

  it("keeps to the point budget it is given, and the polygon is still exactly symmetric", () => {
    const before = made(SHAPES.disc());
    expect(before.points.length).toBeGreaterThan(100);
    const { outline, report } = symmetrizeOutline(before, { maxPoints: 64 });
    expect(report.applied).toBe(true);
    expect(outline.points.length).toBeLessThanOrEqual(64);
    expect(twinError(outline.points as Pt[])).toBe(0);
    expect(maskIoU(outline, SHAPES.disc())).toBeGreaterThan(0.98);
  });
});

// ---- mirror mode on outlines drawn by hand ---------------------------------------------------------------------------------
// The legalizer's own outlines cannot reach some of these cases (it drops a thin spike, and its corner ripple sends a shape to the blend), so the
// outlines here are polygons written out by hand, put into a real outline for everything else.

/** A body 20 mm wide and 40 mm tall, with an optional lump on its left side: [outer x, bottom z, top z]. */
function hand(lump?: readonly [number, number, number]): OutlineSuccess {
  const base = made(SHAPES.paddle());
  const points: Pt[] = lump
    ? [[-10, 0], [10, 0], [10, 40], [-10, 40], [-10, lump[2]], [lump[0], lump[2]], [lump[0], lump[1]], [-10, lump[1]]]
    : [[-10, 0], [10, 0], [10, 40], [-10, 40]];
  const xs = points.map((p) => p[0]);
  return { ...base, points, widthMm: Math.max(...xs) - Math.min(...xs), heightMm: 40, fidelity: 1, warnings: [], changes: [], photoToPlate: [1, 0, 0, 1, 0, 0] };
}

/** Where a point of the outline as it was ends up in the symmetric outline: back to the photo by the old map, forward by the new one. */
function carried(before: OutlineSuccess, after: OutlineSuccess, [x, z]: Pt): Pt {
  const [u, v] = applyAffine(invertAffine(before.photoToPlate)!, x, z);
  return applyAffine(after.photoToPlate, u, v) as Pt;
}

function centroid(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    const w = x0 * z1 - x1 * z0;
    a += w;
    cx += (x0 + x1) * w;
    cz += (z0 + z1) * w;
  }
  return [cx / (3 * a), cz / (3 * a)];
}

function polygonIoU(a: readonly Pt[], b: readonly Pt[]): number {
  let inter = 0;
  let uni = 0;
  for (let z = -1; z <= 45; z += 0.1) {
    for (let x = -30; x <= 30; x += 0.1) {
      const p = inside(a, x, z);
      const q = inside(b, x, z);
      if (p && q) inter++;
      if (p || q) uni++;
    }
  }
  return inter / uni;
}

describe("mirror mode on hand-drawn outlines", () => {
  const LUMP: readonly [number, number, number] = [-18, 12, 28]; // 8 mm out, 16 mm tall
  const SMALL: readonly [number, number, number] = [-13, 14, 26]; // 3 mm out, 12 mm tall
  const SPIKE: readonly [number, number, number] = [-26, 18, 22]; // 16 mm out, 4 mm tall

  it("what auto mode refuses, mirror mode does: the body with a lump is a lump to auto and gets averaged by mirror", () => {
    const before = hand(LUMP);
    const auto = symmetrizeOutline(before);
    expect(auto.outline).toBe(before);
    expect(auto.report.reason).toBe("lump");
    const { outline, report } = symmetrizeOutline(before, { mode: "mirror" });
    expect(report.applied).toBe(true);
    expect(twinError(outline.points as Pt[])).toBe(0);
    const areaBefore = signedArea(before.points as Pt[]);
    expect(Math.abs(signedArea(outline.points as Pt[]) - areaBefore) / areaBefore).toBeLessThan(0.005); // row widths are kept, so is the area
  });

  it("keeps the object's centre of mass where it was: carried through the photo map, the old centroid lands on the new axis", () => {
    const before = hand(LUMP);
    const { outline } = symmetrizeOutline(before, { mode: "mirror" });
    const [cx0] = centroid(before.points as Pt[]);
    expect(Math.abs(cx0)).toBeGreaterThan(1.5); // guard: the lump really pulls the centre of mass off the axis
    const [cx, cz] = carried(before, outline, centroid(before.points as Pt[]));
    expect(Math.abs(cx)).toBeLessThan(0.1);
    expect(Math.abs(cz - centroid(outline.points as Pt[])[1])).toBeLessThan(0.1);
  });

  it("the same on the real spoon, whose map is not the identity", async () => {
    const before = made((await realSpoon()).raster, { fillet_r_mm: 1.0, keepThinParts: true });
    const { outline } = symmetrizeOutline(before);
    const [cx0] = centroid(before.points as Pt[]);
    const [cx, cz] = carried(before, outline, centroid(before.points as Pt[]));
    expect(Math.abs(cx)).toBeLessThan(0.1);
    expect(Math.abs(cx)).toBeLessThan(Math.abs(cx0) + 0.1);
    expect(Math.abs(cz - centroid(outline.points as Pt[])[1])).toBeLessThan(0.15);
  });

  it("the fidelity drops by how much the outline changed, and a change over a tenth is a warning", () => {
    const before = hand(LUMP);
    const { outline } = symmetrizeOutline(before, { mode: "mirror" });
    const iou = polygonIoU((before.points as Pt[]).map((p) => carried(before, outline, p)), outline.points as Pt[]);
    expect(iou).toBeLessThan(0.9); // guard: the lump is big enough for the warning
    expect(Math.abs(outline.fidelity - iou)).toBeLessThan(0.02);
    expect(outline.warnings).toContain("LOW_FIDELITY");
  });

  it("a small change costs a little fidelity and no warning", () => {
    const before = hand(SMALL);
    const { outline, report } = symmetrizeOutline(before, { mode: "mirror" });
    expect(report.applied).toBe(true);
    const iou = polygonIoU((before.points as Pt[]).map((p) => carried(before, outline, p)), outline.points as Pt[]);
    expect(iou).toBeGreaterThan(0.9);
    expect(iou).toBeLessThan(0.99); // guard: it did change
    expect(Math.abs(outline.fidelity - iou)).toBeLessThan(0.02);
    expect(outline.warnings).toEqual([]);
  });

  it("a long spike on one side would have to be moved by more than 15% of the size: mirror mode leaves it alone", () => {
    const before = hand(SPIKE);
    const { outline, report } = symmetrizeOutline(before, { mode: "mirror" });
    expect(outline).toBe(before);
    expect(report.reason).toBe("moved_too_far");
    expect(report.moveMm).toBeGreaterThan(0.15 * 40);
    const shorter = symmetrizeOutline(hand([-20, 18, 22]), { mode: "mirror" }); // 10 mm: half of it is under 6
    expect(shorter.report.applied).toBe(true);
  });

  it("a part that the blend would lose is refused, not dropped: a step beside a notch in a body that needs the blend", () => {
    const step = rasterize(400, 400, union(disc(200, 90, 70), rect(185, 150, 215, 380), rect(100, 65, 135, 115)));
    const before = made(step);
    const { outline, report } = symmetrizeOutline(before, { mode: "mirror" });
    expect(outline).toBe(before);
    expect(report.reason).toBe("parts_lost");
  });
});

// ---- what comes after ----------------------------------------------------------------------------------------------------

describe("a symmetric outline through the rest of the pipeline", () => {
  const symmetric = () => symmetrizeOutline(made(SHAPES.paddle())).outline;

  it("is still symmetric after the kid's flip and a resize (to a hundredth of a millimetre: the rounding of the points)", () => {
    const o = symmetric();
    expect(twinError(withFlipped(o).points as Pt[])).toBeLessThan(0.011);
    expect(twinError(withScaled(o, 1.037).outline.points as Pt[])).toBeLessThan(0.011);
    expect(twinError(withScaled(withFlipped(o), 0.6).outline.points as Pt[])).toBeLessThan(0.011);
  });

  it("survives JSON unchanged, which is how it reaches the device", () => {
    const o = symmetric();
    expect(JSON.parse(JSON.stringify(o.points))).toEqual(o.points);
  });

  it("stays inside the module's limits: only the outline module is imported, and nothing of the browser", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "outlineSymmetry.ts"), "utf8");
    expect([...src.matchAll(/^import[\s\S]*?from "(.*)";$/gm)].map((m) => m[1])).toEqual(["./photoOutline"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length).toBeGreaterThan(3000);
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|\bprocess\.|\bfetch\b|Math\.random|Date\.now/);
  });
});

// ---- in the scan and at the print step -------------------------------------------------------------------------------------

const PHOTO = { width: 640, height: 480 };
function scanOf(shape: Parameters<typeof rasterize>[2], request: Parameters<typeof scanOutline>[3] = { targetHeightMm: 54 }) {
  const photo = rasterize(PHOTO.width, PHOTO.height, shape);
  const c = cropToObject(photo);
  const o = scanOutline(c.raster, c.bounds, PHOTO, request);
  if (!o.ok) throw new Error(`no outline: ${o.reason}`);
  return { o, photo };
}
function photoIoU(o: ScanOutlineSuccess, photo: Raster): number {
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < photo.height; y += 2) {
    for (let x = 0; x < photo.width; x += 2) {
      const [px, pz] = applyAffine(o.photoToPlate, x, y);
      const a = inside(o.points as Pt[], px, pz);
      const b = photo.data[y * photo.width + x] !== 0;
      if (a && b) inter++;
      if (a || b) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

describe("scanOutline: symmetry on request", () => {
  const PADDLE = union(disc(320, 130, 80), rect(305, 200, 335, 420));
  const L = union(rect(200, 60, 270, 400), rect(200, 330, 460, 400));

  it("makes a symmetric object symmetric by itself, and the photo map still puts it on the photo", () => {
    const { o, photo } = scanOf(PADDLE);
    expect(o.changes.map((c) => c.code)).toContain("made_symmetric");
    expect(twinError(o.points as Pt[])).toBe(0);
    expect(photoIoU(o, photo)).toBeGreaterThan(0.95);
    expect(parseScanOutline(JSON.parse(JSON.stringify(o)))).toEqual(o); // and the reply survives the wire
  });

  it("leaves it as traced with symmetry off, and says nothing about an object that is not symmetric", () => {
    expect(scanOf(PADDLE, { targetHeightMm: 54, symmetry: "off" }).o.changes.map((c) => c.code)).not.toContain("made_symmetric");
    const l = scanOf(L).o;
    expect(l.changes.map((c) => c.code)).not.toContain("made_symmetric");
    expect(l.warnings).not.toContain("NOT_SYMMETRIC"); // automatic mode is silent about what it did not do
  });

  it("with 'mirror' on an object that cannot be made symmetric says so in a warning and changes nothing", () => {
    const plain = scanOf(L, { targetHeightMm: 54, symmetry: "off" }).o;
    const asked = scanOf(L, { targetHeightMm: 54, symmetry: "mirror" }).o;
    expect(asked.warnings).toContain("NOT_SYMMETRIC");
    expect(asked.points).toEqual(plain.points);
  });

  it("the real spoon is made symmetric by default and keeps its handle", async () => {
    const { raster, bounds } = await realSpoon();
    const off = scanOutline(raster, bounds, SPOON_PHOTO, { targetHeightMm: 54, symmetry: "off" });
    const on = scanOutline(raster, bounds, SPOON_PHOTO, { targetHeightMm: 54 });
    if (!off.ok || !on.ok) throw new Error("no outline");
    expect(on.changes.map((c) => c.code)).toContain("made_symmetric");
    expect(twinError(on.points as Pt[])).toBe(0);
    expect(on.warnings).toEqual([]);
    expect(narrowest(on)).toBeGreaterThan(narrowest(off) - 0.1);
  });

  it("'mirror' does what 'auto' will not: a body with a step on one side is left alone by auto and made symmetric by mirror", () => {
    const STEP = union(disc(320, 130, 70), rect(305, 190, 335, 420), rect(232, 110, 255, 150));
    const auto = scanOf(STEP).o;
    const mirror = scanOf(STEP, { targetHeightMm: 54, symmetry: "mirror" }).o;
    expect(auto.changes.map((c) => c.code)).not.toContain("made_symmetric");
    expect(mirror.changes.map((c) => c.code)).toContain("made_symmetric");
    expect(mirror.warnings).not.toContain("NOT_SYMMETRIC");
    expect(twinError(mirror.points as Pt[])).toBe(0);
  });

  it("takes the option as written, and refuses anything else", () => {
    for (const symmetry of ["auto", "off", "mirror"] as const) expect(parseScanOutlineRequest({ symmetry })).toEqual({ ok: true, request: { symmetry } });
    for (const bad of ["on", "yes", true, 1, null, ["mirror"]]) expect(parseScanOutlineRequest({ symmetry: bad }).ok).toBe(false);
  });
});

describe("preparePhotoAccessory: the symmetry button", () => {
  const gate = async () => ({ status: "pass" as const, failures: [] as string[] });
  const PADDLE = union(disc(320, 130, 80), rect(305, 200, 335, 420));
  const L = union(rect(200, 60, 270, 400), rect(200, 330, 460, 400));

  it("makes a scan that was left as traced symmetric, and reports what it found", async () => {
    const { o } = scanOf(PADDLE, { targetHeightMm: 54, symmetry: "off" });
    expect(twinError(o.points as Pt[])).toBeGreaterThan(0.02); // guard: it was not symmetric
    const a = await preparePhotoAccessory(o, gate, { symmetry: "mirror" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.symmetry).toMatchObject({ applied: true, symmetric: true });
    expect(twinError(a.recipe.shape.kind === "profile2d" ? (a.recipe.shape.points as Pt[]) : [])).toBeLessThan(0.011);
  });

  it("goes further than the scan did: a step on one side is averaged away by the button, where automatic mode left it", async () => {
    const STEP = union(disc(320, 130, 70), rect(305, 190, 335, 420), rect(232, 110, 255, 150));
    const { o } = scanOf(STEP);
    expect(o.changes.map((c) => c.code)).not.toContain("made_symmetric"); // guard: the scan left it
    const a = await preparePhotoAccessory(o, gate, { symmetry: "mirror" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.symmetry).toMatchObject({ applied: true });
    expect(a.outline.changes.map((c) => c.code)).toContain("made_symmetric");
  });

  it("is harmless on a scan that is already symmetric: nothing is done twice", async () => {
    const { o } = scanOf(PADDLE);
    const a = await preparePhotoAccessory(o, gate, { symmetry: "mirror" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.symmetry).toMatchObject({ applied: false, symmetric: true });
    expect(a.outline.changes.filter((c) => c.code === "made_symmetric")).toHaveLength(1);
  });

  it("is refused, before any gate call, for an object that cannot be made symmetric", async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return { status: "pass" as const, failures: [] as string[] };
    };
    const { o } = scanOf(L, { targetHeightMm: 54, symmetry: "off" });
    const r = await preparePhotoAccessory(o, counting, { symmetry: "mirror" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cannot_symmetrize");
    expect(calls).toBe(0);
  });

  it("does nothing unless asked: the option is off by default", async () => {
    const { o } = scanOf(PADDLE, { targetHeightMm: 54, symmetry: "off" });
    const a = await preparePhotoAccessory(o, gate);
    expect(a.ok && "symmetry" in a).toBe(false);
  });
});
