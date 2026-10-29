import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

function expectArrayClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 7));
}

type GlbJson = {
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
};

function inspectGlb(bytes: Buffer): { gltf: GlbJson; positions: number[]; normals: number[] } {
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

  const readVec3 = (accessorIndex: number): number[] => {
    const view = gltf.bufferViews[accessorIndex];
    if (!view) throw new Error(`missing bufferView ${accessorIndex}`);
    const start = binaryStart + (view.byteOffset ?? 0);
    return Array.from({ length: view.byteLength / 4 }, (_, index) =>
      bytes.readFloatLE(start + index * 4),
    );
  };

  return { gltf, positions: readVec3(0), normals: readVec3(1) };
}

async function convert(filename: string, contents: string | Buffer): Promise<Buffer> {
  scratch = await mkdtemp(join(tmpdir(), "toyventor-stl-to-glb-"));
  const source = join(scratch, "input");
  const destination = join(scratch, "output");
  await mkdir(source);
  await writeFile(join(source, filename), contents);
  await run("python3", [SCRIPT, source, destination]);
  return readFile(join(destination, filename.replace(/\.stl$/i, ".glb")));
}

describe("stl_to_glb.py", () => {
  it("converts an ASCII STL with the existing axis and scale mapping", async () => {
    const { gltf, positions, normals } = inspectGlb(await convert("ascii-triangle.stl", asciiStl()));
    expect(gltf.accessors[0]?.count).toBe(3);
    expectArrayClose(positions, EXPECTED_POSITIONS);
    expectArrayClose(normals, EXPECTED_NORMALS);
  });

  it("converts a binary STL, including one whose header starts with solid", async () => {
    const { gltf, positions, normals } = inspectGlb(
      await convert("binary-triangle.stl", binaryStl()),
    );
    expect(gltf.accessors[0]?.count).toBe(3);
    expectArrayClose(gltf.accessors[0]?.min ?? [], [0, 0.01, -0.02]);
    expectArrayClose(gltf.accessors[0]?.max ?? [], [0.01, 0.01, 0]);
    expectArrayClose(positions, EXPECTED_POSITIONS);
    expectArrayClose(normals, EXPECTED_NORMALS);
  });
});
