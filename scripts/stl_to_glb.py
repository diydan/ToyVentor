#!/usr/bin/env python3
"""Convert OpenSCAD ASCII STL files to minimal binary glTF (.glb).

Standard library only, on purpose: the parts pipeline must run anywhere
`npm run parts` runs, with no Python environment to maintain. Geometry is
written non-indexed (positions + normals), scaled mm -> m (glTF units),
with one neutral material; the viewer tints parts itself.

Usage: stl_to_glb.py <input-dir> <output-dir>
"""
import json
import struct
import sys
from pathlib import Path

SCALE = 0.001  # STL millimetres to glTF metres


def parse_ascii_stl(text: str):
    positions: list[float] = []
    normals: list[float] = []
    normal = (0.0, 0.0, 1.0)
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "facet" and len(parts) >= 5:
            normal = (float(parts[2]), float(parts[3]), float(parts[4]))
        elif parts[0] == "vertex" and len(parts) >= 4:
            x, y, z = (float(parts[1]) * SCALE, float(parts[2]) * SCALE, float(parts[3]) * SCALE)
            # glTF is Y-up; OpenSCAD/STL here is Z-up. Map (x, y, z) -> (x, z, -y).
            positions.extend([x, z, -y])
            normals.extend([normal[0], normal[2], -normal[1]])
    return positions, normals


def pad4(data: bytes, pad_byte: bytes = b"\x00") -> bytes:
    while len(data) % 4:
        data += pad_byte
    return data


def write_glb(path: Path, positions: list[float], normals: list[float]) -> None:
    if not positions:
        raise ValueError("no vertices parsed")
    pos_bytes = struct.pack(f"<{len(positions)}f", *positions)
    nor_bytes = struct.pack(f"<{len(normals)}f", *normals)
    buffer = pad4(pos_bytes) + nor_bytes
    count = len(positions) // 3
    xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
    gltf = {
        "asset": {"version": "2.0", "generator": "toyventor stl_to_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": path.stem}],
        "meshes": [{
            "name": path.stem,
            "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "material": 0, "mode": 4}],
        }],
        "materials": [{
            "name": "part",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.92, 0.45, 0.16, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.75,
            },
            "doubleSided": True,
        }],
        "accessors": [
            {
                "bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)],
            },
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes)},
            {"buffer": 0, "byteOffset": len(pad4(pos_bytes)), "byteLength": len(nor_bytes)},
        ],
        "buffers": [{"byteLength": len(buffer)}],
    }
    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bin_chunk = pad4(buffer)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))  # glTF magic
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))  # JSON
        f.write(json_chunk)
        f.write(struct.pack("<II", len(bin_chunk), 0x004E4942))  # BIN\0
        f.write(bin_chunk)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    count = 0
    for stl in sorted(src.glob("*.stl")):
        positions, normals = parse_ascii_stl(stl.read_text())
        out = dst / (stl.stem + ".glb")
        write_glb(out, positions, normals)
        print(f"glb: {stl.name} -> {out.name} ({len(positions) // 3} vertices)")
        count += 1
    print(f"stl_to_glb: {count} file(s)")
    return 0 if count else 1


if __name__ == "__main__":
    raise SystemExit(main())
