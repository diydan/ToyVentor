// The household library (docs/specs/household-library-spec.md, phase 2): public/kip/household/catalog.json and the GLBs it lists.
// Fast: no geometry is built. The GLBs are read back with a reader written here (not the writer's code) and checked as geometry: the right size,
// a closed and consistently oriented surface, the same volume as the solid they were made from. The catalog's rules are also run through the
// checker `household_catalog.py --verify` on deliberately broken copies, so the checker itself is shown to fail. Needs only a system python3 for
// those last tests; the venv-based rebuild test is tests/household-build.test.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "public/kip/household");
const CATALOG_PY = join(ROOT, "parts/kip/household/household_catalog.py");

interface Zone { name: string; hex: string; tris: number }
interface Item {
  id: string; label: string; scanRank: number | null; realMm: number; propMm: number; family: string; words: string[]; tags: string[]; note: string;
  built: boolean; glb: string | null;
  bytes?: number; sha256?: string; tris?: number; verts?: number; zones?: Zone[]; bboxMm?: [number, number, number]; volumeMm3?: number;
}
interface Catalog { version: number; budget: { maxTris: number; maxBytes: number; maxZones: number }; items: Item[] }

const CATALOG = JSON.parse(readFileSync(join(DIR, "catalog.json"), "utf8")) as Catalog;
const ITEMS = CATALOG.items;
const BUILT = ITEMS.filter((i) => i.built);
const SCAN = new Map(
  (JSON.parse(readFileSync(join(ROOT, "tests/fixtures/scan-targets.json"), "utf8")) as { items: { rank: number; lengthMm: number; widthMm: number }[] }).items.map((t) => [t.rank, t]),
);
const STATIC_FIELDS = ["id", "label", "scanRank", "realMm", "propMm", "family", "words", "tags", "note"] as const;

// ---- an independent GLB reader -------------------------------------------------------------------------------------------------------

interface Glb {
  gltf: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  lib: Float64Array; // vertex positions, library frame, mm
  normals: Float64Array;
  prims: { zone: string; tris: Uint32Array }[];
}

function readGlb(path: string): Glb {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  expect(dv.getUint32(0, true), "glTF magic").toBe(0x46546c67);
  expect(dv.getUint32(4, true), "glTF version").toBe(2);
  expect(dv.getUint32(8, true), "declared length").toBe(buf.length);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true), "first chunk is JSON").toBe(0x4e4f534a);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binHead = 20 + jsonLen;
  const binLen = dv.getUint32(binHead, true);
  expect(dv.getUint32(binHead + 4, true), "second chunk is BIN").toBe(0x004e4942);
  const bin0 = binHead + 8;
  expect(bin0 + binLen, "chunks fill the file").toBe(buf.length);

  const start = (ai: number) => {
    const a = gltf.accessors[ai];
    const v = gltf.bufferViews[a.bufferView];
    return { a, v, at: bin0 + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) };
  };
  const prim0 = gltf.meshes[0].primitives[0];
  const node = gltf.nodes[0];
  const P = start(prim0.attributes.POSITION);
  const N = start(prim0.attributes.NORMAL);
  expect(P.a.componentType, "positions are normalised u16").toBe(5123);
  expect(N.a.componentType, "normals are normalised i8").toBe(5120);
  const n = P.a.count as number;
  expect(N.a.count).toBe(n);
  const lib = new Float64Array(n * 3);
  const normals = new Float64Array(n * 3);
  const strideP = P.v.byteStride ?? 6;
  const strideN = N.v.byteStride ?? 3;
  for (let i = 0; i < n; i++) {
    const g = [0, 1, 2].map((k) => (dv.getUint16(P.at + i * strideP + 2 * k, true) / 65535) * node.scale[k] + node.translation[k]); // metres, y up
    lib[i * 3] = g[0]! * 1000; // library x = glTF x
    lib[i * 3 + 1] = -g[2]! * 1000; // library y = -glTF z
    lib[i * 3 + 2] = g[1]! * 1000; // library z = glTF y
    const q = [0, 1, 2].map((k) => dv.getInt8(N.at + i * strideN + k) / 127);
    normals[i * 3] = q[0]!;
    normals[i * 3 + 1] = -q[2]!;
    normals[i * 3 + 2] = q[1]!;
  }
  const prims = (gltf.meshes[0].primitives as any[]).map((p) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const I = start(p.indices);
    expect(I.a.type).toBe("SCALAR");
    const tris = new Uint32Array(I.a.count);
    for (let k = 0; k < I.a.count; k++) tris[k] = I.a.componentType === 5123 ? dv.getUint16(I.at + 2 * k, true) : dv.getUint32(I.at + 4 * k, true);
    return { zone: gltf.materials[p.material].name as string, tris };
  });
  return { gltf, lib, normals, prims };
}

const srgbToLinear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

// ---- catalog data ----------------------------------------------------------------------------------------------------------------------

describe("household catalog: data", () => {
  it("lists 50 items and states the budget the spec set", () => {
    expect(CATALOG.version).toBe(1);
    expect(CATALOG.budget).toEqual({ maxTris: 1000, maxBytes: 25 * 1024, maxZones: 3 });
    expect(ITEMS).toHaveLength(50);
  });

  it("gives every item a unique snake_case id and a label", () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of ITEMS) {
      expect(i.id, i.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(i.label.trim(), i.id).not.toBe("");
    }
  });

  it("maps every word to exactly one item, in trimmed lower case", () => {
    const owner = new Map<string, string>();
    for (const i of ITEMS) {
      expect(i.words.length, `${i.id} has no words`).toBeGreaterThan(0);
      for (const w of i.words) {
        expect(w, `${i.id}: ${w}`).toBe(w.trim().toLowerCase());
        expect(w, `${i.id}: empty word`).not.toBe("");
        expect(owner.get(w), `"${w}" is in both ${owner.get(w)} and ${i.id}`).toBeUndefined();
        owner.set(w, i.id);
      }
    }
  });

  it("uses only the five families and the three tags", () => {
    for (const i of ITEMS) {
      expect(["R", "RC", "E", "C", "L"], i.id).toContain(i.family);
      for (const t of i.tags) expect(["garage", "tool", "sharp-looking"], `${i.id}: ${t}`).toContain(t);
    }
  });

  it("links each scan item by a rank that exists, is used once, and carries the scan list's own size", () => {
    const ranks = ITEMS.map((i) => i.scanRank).filter((r): r is number => r !== null);
    expect(new Set(ranks).size, "a rank is claimed twice").toBe(ranks.length);
    for (const i of ITEMS) {
      if (i.scanRank === null) continue;
      const t = SCAN.get(i.scanRank);
      expect(t, `${i.id}: rank ${i.scanRank} is not in the scan list`).toBeDefined();
      expect(i.realMm, `${i.id} real size`).toBe(Math.max(t!.lengthMm, t!.widthMm));
    }
  });

  it("adds exactly the seven items the scan list lacks, each with its own size", () => {
    const added = ITEMS.filter((i) => i.scanRank === null);
    expect(added.map((i) => i.id).sort()).toEqual(["bucket", "flashlight", "hammer", "plate", "pliers", "screwdriver", "tape_measure"]);
    for (const i of added) expect(i.realMm, i.id).toBeGreaterThan(0);
  });

  it("draws every prop at its real size clamped to 40..90 mm", () => {
    for (const i of ITEMS) expect(i.propMm, i.id).toBe(Math.min(90, Math.max(40, i.realMm)));
  });

  it("tags the garage items and the sharp-looking ones as the spec lists them", () => {
    const tagged = (t: string) => ITEMS.filter((i) => i.tags.includes(t)).map((i) => i.id).sort();
    expect(tagged("sharp-looking")).toEqual(["fork", "scissors", "screwdriver", "toy_sword"]);
    expect(tagged("garage")).toEqual(["bucket", "flashlight", "hammer", "pliers", "screwdriver", "tape_measure"]);
  });
});

// ---- the built items and their files ---------------------------------------------------------------------------------------------------

describe("household catalog: built items", () => {
  it("builds every family R item (phase 2: the revolved ones)", () => {
    const r = ITEMS.filter((i) => i.family === "R");
    expect(r).toHaveLength(15);
    expect(r.filter((i) => !i.built).map((i) => i.id)).toEqual([]);
  });

  it("has a GLB for each built item and for nothing else", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".glb")).sort();
    expect(files).toEqual(BUILT.map((i) => i.glb!).sort());
    for (const i of ITEMS) if (!i.built) expect(i.glb, i.id).toBeNull();
    for (const i of BUILT) expect(i.glb, i.id).toBe(`${i.id}.glb`);
  });

  describe.each(BUILT.map((i) => [i.id, i] as const))("%s", (_id, item) => {
    const path = join(DIR, `${item.id}.glb`);
    const glb = readGlb(path);

    it("matches its recorded size and hash, within the budget", () => {
      const bytes = readFileSync(path);
      expect(bytes.length).toBe(item.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
      expect(statSync(path).size).toBeLessThanOrEqual(CATALOG.budget.maxBytes);
      expect(item.tris!).toBeLessThanOrEqual(CATALOG.budget.maxTris);
    });

    it("has at most three colour zones, each a material named for it, in the colour the catalog gives", () => {
      const zones = item.zones!;
      expect(zones.length).toBeGreaterThanOrEqual(1);
      expect(zones.length).toBeLessThanOrEqual(CATALOG.budget.maxZones);
      expect(new Set(zones.map((z) => z.name)).size).toBe(zones.length);
      expect(glb.gltf.materials.map((m: { name: string }) => m.name)).toEqual(zones.map((z) => z.name));
      glb.gltf.materials.forEach((m: any, k: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(zones[k]!.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
        const want = srgbToLinear(zones[k]!.hex);
        m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).forEach((c: number, j: number) => expect(c).toBeCloseTo(want[j]!, 4));
      });
      expect(glb.gltf.extensionsRequired).toContain("KHR_mesh_quantization");
    });

    it("has one primitive per zone, with the triangle counts the catalog records", () => {
      const zones = item.zones!;
      expect(glb.prims.map((p) => p.zone)).toEqual(zones.map((z) => z.name));
      glb.prims.forEach((p, k) => expect(p.tris.length / 3, zones[k]!.name).toBe(zones[k]!.tris));
      expect(zones.reduce((s, z) => s + z.tris, 0)).toBe(item.tris);
      const nv = glb.lib.length / 3;
      expect(nv).toBe(item.verts);
      for (const p of glb.prims) for (const idx of p.tris) expect(idx).toBeLessThan(nv);
    });

    it("stands on z = 0 and is as large as the catalog says, its longest side the prop size", () => {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < glb.lib.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, glb.lib[i + k]!);
          hi[k] = Math.max(hi[k]!, glb.lib[i + k]!);
        }
      const ext = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
      ext.forEach((e, k) => expect(Math.abs(e - item.bboxMm![k]!), `axis ${k}`).toBeLessThan(0.05));
      expect(Math.abs(lo[2]!), "lowest point").toBeLessThan(0.01);
      expect(Math.abs(Math.max(...ext) - item.propMm), "longest side").toBeLessThan(0.02);
    });

    it("is a closed, consistently oriented surface whose volume is the solid's", () => {
      // weld by quantised position (the file splits vertices at creases, so an edge's two ends are different vertices), then every directed edge
      // must occur exactly once and its reverse exactly once
      const key = (v: number) => `${Math.round(glb.lib[v * 3]! * 1e4)},${Math.round(glb.lib[v * 3 + 1]! * 1e4)},${Math.round(glb.lib[v * 3 + 2]! * 1e4)}`;
      const directed = new Map<string, number>();
      let volume = 0;
      for (const p of glb.prims)
        for (let t = 0; t < p.tris.length; t += 3) {
          const [a, b, c] = [p.tris[t]!, p.tris[t + 1]!, p.tris[t + 2]!];
          const ks = [key(a), key(b), key(c)];
          for (let e = 0; e < 3; e++) {
            const k = `${ks[e]}>${ks[(e + 1) % 3]}`;
            directed.set(k, (directed.get(k) ?? 0) + 1);
          }
          const v = (i: number) => [glb.lib[i * 3]!, glb.lib[i * 3 + 1]!, glb.lib[i * 3 + 2]!] as const;
          const [v0, v1, v2] = [v(a), v(b), v(c)];
          volume += (v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) - v0[1] * (v1[0] * v2[2] - v1[2] * v2[0]) + v0[2] * (v1[0] * v2[1] - v1[1] * v2[0])) / 6;
        }
      const bad: string[] = [];
      for (const [k, n] of directed) {
        const [from, to] = k.split(">");
        if (n !== 1) bad.push(`${k} x${n}`);
        else if (directed.get(`${to}>${from}`) !== 1) bad.push(`${k} has no single reverse`);
        if (bad.length > 3) break;
      }
      expect(bad, "open or inconsistently oriented edges").toEqual([]);
      expect(volume, "signed volume (positive = faces point outwards)").toBeGreaterThan(0);
      expect(Math.abs(volume - item.volumeMm3!) / item.volumeMm3!, "volume against the solid's").toBeLessThan(0.005);
    });

    it("has unit normals that point out of the surface", () => {
      let inward = 0;
      let tris = 0;
      for (const p of glb.prims)
        for (let t = 0; t < p.tris.length; t += 3) {
          const idx = [p.tris[t]!, p.tris[t + 1]!, p.tris[t + 2]!];
          const P = idx.map((i) => [glb.lib[i * 3]!, glb.lib[i * 3 + 1]!, glb.lib[i * 3 + 2]!]);
          const u = [P[1]![0]! - P[0]![0]!, P[1]![1]! - P[0]![1]!, P[1]![2]! - P[0]![2]!];
          const w = [P[2]![0]! - P[0]![0]!, P[2]![1]! - P[0]![1]!, P[2]![2]! - P[0]![2]!];
          const f = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
          if (Math.hypot(f[0]!, f[1]!, f[2]!) < 1e-9) continue;
          tris++;
          let dot = 0;
          for (const i of idx) {
            const len = Math.hypot(glb.normals[i * 3]!, glb.normals[i * 3 + 1]!, glb.normals[i * 3 + 2]!);
            expect(Math.abs(len - 1), "normal length").toBeLessThan(0.05);
            dot += glb.normals[i * 3]! * f[0]! + glb.normals[i * 3 + 1]! * f[1]! + glb.normals[i * 3 + 2]! * f[2]!;
          }
          if (dot <= 0) inward++;
        }
      expect(tris).toBeGreaterThan(0);
      expect(inward, "triangles whose normals point into the item").toBe(0);
    });
  });
});

// ---- the catalog checker, shown to fail ------------------------------------------------------------------------------------------------

function python3(): string | null {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return "python3";
  } catch {
    return null;
  }
}
const PY3 = python3();

describe.skipIf(!PY3)("household catalog: the checker (household_catalog.py)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "household-catalog-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const verify = (mutate: (doc: Catalog) => void) => {
    const doc = JSON.parse(JSON.stringify(CATALOG)) as Catalog;
    mutate(doc);
    const f = join(tmp, `c-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(doc));
    const r = spawnSync(PY3!, [CATALOG_PY, "--verify", f], { encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  };

  it("passes the committed catalog", () => {
    const r = verify(() => {});
    expect(r.out).toContain("50 items checked, 0 problems");
    expect(r.code).toBe(0);
  });

  it("agrees with the module's own rows: the committed catalog was built from the current data", () => {
    const rows = JSON.parse(execFileSync(PY3!, [CATALOG_PY, "--json"], { encoding: "utf8" })) as Item[];
    const pick = (i: Item) => Object.fromEntries(STATIC_FIELDS.map((f) => [f, i[f]]));
    expect(rows.map(pick)).toEqual(ITEMS.map(pick));
  });

  const cases: [string, (d: Catalog) => void, RegExp][] = [
    ["a word in two items", (d) => d.items[1]!.words.push(d.items[0]!.words[0]!), /word 'ball' is in both ball and mug/],
    ["a duplicate id", (d) => (d.items[1]!.id = d.items[0]!.id), /duplicate id ball/],
    ["a scan rank claimed twice", (d) => (d.items[1]!.scanRank = d.items[0]!.scanRank), /scan rank 6 is claimed by both/],
    ["an unknown family", (d) => (d.items[0]!.family = "Q"), /family 'Q'/],
    ["an unknown tag", (d) => d.items[0]!.tags.push("scary"), /unknown tag 'scary'/],
    ["an item with no words", (d) => (d.items[0]!.words = []), /ball: no words/],
    ["a word not in lower case", (d) => (d.items[0]!.words[0] = "Ball"), /not trimmed lower case/],
    ["a prop size that is not the clamped real size", (d) => (d.items[0]!.propMm = 95), /propMm 95/],
    ["a brand word in a note", (d) => (d.items[0]!.note = "like a Duplo ball"), /brand term 'Duplo'/],
    ["a brand word in a label", (d) => (d.items[0]!.label = "Frisbee"), /brand term 'Frisbee'/],
    ["a brand word in a word list", (d) => d.items[0]!.words.push("thermos"), /brand term 'thermos'/],
    ["an id that is not snake_case", (d) => (d.items[0]!.id = "Ball-1"), /bad id/],
    ["49 items", (d) => d.items.pop(), /49 items, not 50/],
  ];
  it.each(cases)("fails on %s", (_name, mutate, expected) => {
    const r = verify(mutate);
    expect(r.out).toMatch(expected);
    expect(r.code).toBe(1);
  });
});
