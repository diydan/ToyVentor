import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../scripts/stl_to_glb.py", import.meta.url));

// One triangle at z=10 mm. The converter scales mm -> m and maps
// (x, y, z) -> (x, z, -y), so all expected GLB values below are in metres.
const NORMAL = [0, 0, 1] as const;
const VERTICES = [
  [0, 0, 10],
  [10, 0, 10],
  [0, 20, 10],
] as const;
const EXPECTED_POSITIONS = [0, 0.01, 0, 0.01, 0.01, 0, 0, 0.01, -0.02];
const EXPECTED_NORMALS = [0, 1, 0, 0, 1, 0, 0, 1, 0];

let scratch: string | undefined;

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function asciiStl(): string {
  const vertices = VERTICES.map((v) => `      vertex ${v.join(" ")}`).join("\n");
  return [
    "solid ascii-fixture",
    `  facet normal ${NORMAL.join(" ")}`,
    "    outer loop",
    vertices,
    "    endloop",
    "  endfacet",
    "endsolid ascii-fixture",
    "",
  ].join("\n");
}

function binaryStl(): Buffer {
  const header = Buffer.alloc(80);
  // Some binary STL writers put text beginning "solid" in the header; format
  // detection must use the record count/size, not that prefix alone.
  header.write("solid binary-fixture", "ascii");
  const count = Buffer.alloc(4);
  count.writeUInt32LE(1);
  const record = Buffer.alloc(50);
  const floats = [...NORMAL, ...VERTICES.flat()];
  floats.forEach((value, index) => record.writeFloatLE(value, index * 4));
  record.writeUInt16LE(0, 48);
  return Buffer.concat([header, count, record]);
}

function twoTriQuadAndCreaseStl(): string {
  // Two coplanar triangles on z=0 sharing edge (0,0,0)-(10,10,0), plus a third
  // perpendicular wall triangle sharing (0,0,0)-(10,0,0) at 90 deg crease.
  return [
    "solid quad-and-wall",
    "  facet normal 0 0 1",
    "    outer loop",
    "      vertex 0 0 0",
    "      vertex 10 0 0",
    "      vertex 10 10 0",
    "    endloop",
    "  endfacet",
    "  facet normal 0 0 1",
    "    outer loop",
    "      vertex 0 0 0",
    "      vertex 10 10 0",
    "      vertex 0 10 0",
    "    endloop",
    "  endfacet",
    "  facet normal 0 -1 0",
    "    outer loop",
    "      vertex 0 0 0",
    "      vertex 10 0 0",
    "      vertex 10 0 10",
    "    endloop",
    "  endfacet",
    "endsolid quad-and-wall",
    "",
  ].join("\n");
}

function expectArrayClose(actual: number[], expected: number[], digits = 5): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
}

type GlbJson = {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  nodes: Array<{ translation?: [number, number, number]; scale?: [number, number, number] }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number }> }>;
  accessors: Array<{
    bufferView: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number; target?: number }>;
};

function parseGlbEnvelope(bytes: Buffer): { gltf: GlbJson; bin: Buffer } {
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67); // glTF magic
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);

  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a); // JSON chunk
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;

  const binaryHeader = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  const binaryStart = binaryHeader + 8;
  expect(bytes.readUInt32LE(binaryHeader + 4)).toBe(0x004e4942); // BIN\0 chunk
  expect(binaryStart + binaryLength).toBe(bytes.length);
  return { gltf, bin: bytes.subarray(binaryStart, binaryStart + binaryLength) };
}

function decodeQuantizedGlb(bytes: Buffer): {
  gltf: GlbJson;
  positions: number[];
  normals: number[];
  indices: number[];
} {
  const { gltf, bin } = parseGlbEnvelope(bytes);
  expect(gltf.extensionsUsed).toContain("KHR_mesh_quantization");
  expect(gltf.extensionsRequired).toContain("KHR_mesh_quantization");

  const node = gltf.nodes[0]!;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  expect(sx).toBeCloseTo(sy, 9);
  expect(sy).toBeCloseTo(sz, 9);

  const posAcc = gltf.accessors[0]!;
  const norAcc = gltf.accessors[1]!;
  const idxAcc = gltf.accessors[2]!;
  expect(posAcc.componentType).toBe(5123); // UNSIGNED_SHORT
  expect(posAcc.normalized).toBe(true);
  expect(norAcc.componentType).toBe(5120); // BYTE
  expect(norAcc.normalized).toBe(true);
  expect(idxAcc.componentType).toBe(5123); // UNSIGNED_SHORT

  const posView = gltf.bufferViews[posAcc.bufferView]!;
  const norView = gltf.bufferViews[norAcc.bufferView]!;
  const idxView = gltf.bufferViews[idxAcc.bufferView]!;
  const posStride = posView.byteStride ?? 8;
  const norStride = norView.byteStride ?? 4;

  const indices: number[] = [];
  for (let i = 0; i < idxAcc.count; i++) {
    indices.push(bin.readUInt16LE((idxView.byteOffset ?? 0) + i * 2));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (const vi of indices) {
    const pBase = (posView.byteOffset ?? 0) + vi * posStride;
    const qx = bin.readUInt16LE(pBase) / 65535;
    const qy = bin.readUInt16LE(pBase + 2) / 65535;
    const qz = bin.readUInt16LE(pBase + 4) / 65535;
    positions.push(tx + qx * sx, ty + qy * sy, tz + qz * sz);

    const nBase = (norView.byteOffset ?? 0) + vi * norStride;
    normals.push(
      Math.max(-1, bin.readInt8(nBase) / 127),
      Math.max(-1, bin.readInt8(nBase + 1) / 127),
      Math.max(-1, bin.readInt8(nBase + 2) / 127),
    );
  }
  return { gltf, positions, normals, indices };
}

async function convert(
  filename: string,
  contents: string | Buffer,
  extraArgs: string[] = [],
): Promise<Buffer> {
  scratch = await mkdtemp(join(tmpdir(), "toyventor-stl-to-glb-"));
  const source = join(scratch, "input");
  const destination = join(scratch, "output");
  await mkdir(source);
  await writeFile(join(source, filename), contents);
  await run("python3", [SCRIPT, source, destination, ...extraArgs]);
  return readFile(join(destination, filename.replace(/\.stl$/i, ".glb")));
}

describe("stl_to_glb.py", () => {
  it("converts an ASCII STL to KHR_mesh_quantization with exact axis and scale mapping", async () => {
    const { gltf, positions, normals } = decodeQuantizedGlb(
      await convert("ascii-triangle.stl", asciiStl()),
    );
    expect(gltf.accessors[0]?.count).toBe(3);
    expectArrayClose(positions, EXPECTED_POSITIONS, 5);
    expectArrayClose(normals, EXPECTED_NORMALS, 2);
  });

  it("converts a binary STL (including solid-prefixed header) and decodes natively in Three.js GLTFLoader", async () => {
    const raw = await convert("binary-triangle.stl", binaryStl());
    const { gltf, positions, normals } = decodeQuantizedGlb(raw);
    expect(gltf.accessors[0]?.count).toBe(3);
    expectArrayClose(positions, EXPECTED_POSITIONS, 5);
    expectArrayClose(normals, EXPECTED_NORMALS, 2);

    const loader = new GLTFLoader();
    const ab = new Uint8Array(raw).buffer;
    const parsed = await loader.parseAsync(ab, "");
    parsed.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(parsed.scene);
    expectArrayClose([box.min.x, box.min.y, box.min.z], [0, 0.01, -0.02], 5);
    expectArrayClose([box.max.x, box.max.y, box.max.z], [0.01, 0.01, 0], 5);
  });

  it("welds coplanar shared edges while splitting sharp creases above crease_deg", async () => {
    const { gltf, indices } = decodeQuantizedGlb(
      await convert("quad-and-wall.stl", twoTriQuadAndCreaseStl()),
    );
    // 2 coplanar quad triangles share 2 vertices -> 4 unique vertices;
    // the 90-deg perpendicular wall triangle splits at the crease -> +3 vertices = 7 total (down from 9).
    expect(gltf.accessors[0]?.count).toBe(7);
    expect(indices).toHaveLength(9);
  });

  it("supports --legacy-float32 debug output", async () => {
    const bytes = await convert("legacy.stl", binaryStl(), ["--legacy-float32"]);
    const { gltf, bin } = parseGlbEnvelope(bytes);
    expect(gltf.extensionsUsed).toBeUndefined();
    expect(gltf.accessors[0]?.componentType).toBe(5126); // FLOAT
    const posView = gltf.bufferViews[0]!;
    const floats = Array.from({ length: posView.byteLength / 4 }, (_, i) =>
      bin.readFloatLE((posView.byteOffset ?? 0) + i * 4),
    );
    expectArrayClose(floats, EXPECTED_POSITIONS, 7);
  });
});
