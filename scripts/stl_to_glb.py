#!/usr/bin/env python3
"""Convert ASCII or binary STL files to minimal binary glTF (.glb).

Standard library only, on purpose: the parts pipeline must run anywhere
`npm run parts` runs, with no Python environment to maintain. Geometry is
written non-indexed (positions + normals), scaled mm -> m (glTF units),
with one neutral material; the viewer tints parts itself.

Usage: stl_to_glb.py <input-dir> <output-dir>
"""
import json
import math
import struct
import sys
from pathlib import Path

SCALE = 0.001  # STL millimetres to glTF metres
BINARY_STL_PREFIX_BYTES = 84  # 80-byte header + 4-byte triangle count
BINARY_STL_RECORD_BYTES = 50


def _transform_point(point: tuple[float, float, float]) -> list[float]:
    x, y, z = (coordinate * SCALE for coordinate in point)
    # glTF is Y-up; STL here is Z-up. Map (x, y, z) -> (x, z, -y).
    return [x, z, -y]


def _transform_normal(normal: tuple[float, float, float]) -> list[float]:
    return [normal[0], normal[2], -normal[1]]


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
            point = (float(parts[1]), float(parts[2]), float(parts[3]))
            positions.extend(_transform_point(point))
            normals.extend(_transform_normal(normal))
    return positions, normals


def _is_binary_stl(data: bytes) -> bool:
    if len(data) < BINARY_STL_PREFIX_BYTES:
        return False
    triangles = struct.unpack_from("<I", data, 80)[0]
    if len(data) != BINARY_STL_PREFIX_BYTES + triangles * BINARY_STL_RECORD_BYTES:
        return False
    # Binary headers may also begin with "solid". An early facet line is the
    # reliable sign that this size match belongs to an ASCII file instead.
    sample = data[:512].lower()
    return not (sample.lstrip().startswith(b"solid") and b"facet normal" in sample)


def parse_binary_stl(data: bytes):
    positions: list[float] = []
    normals: list[float] = []
    for record in struct.iter_unpack("<3f3f3f3fH", data[BINARY_STL_PREFIX_BYTES:]):
        values = record[:12]
        if not all(math.isfinite(value) for value in values):
            raise ValueError("binary STL contains a non-finite coordinate")
        normal = values[0:3]
        for offset in (3, 6, 9):
            point = values[offset:offset + 3]
            positions.extend(_transform_point(point))
            normals.extend(_transform_normal(normal))
    return positions, normals


def parse_stl(data: bytes):
    if _is_binary_stl(data):
        return parse_binary_stl(data)
    return parse_ascii_stl(data.decode())


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
        positions, normals = parse_stl(stl.read_bytes())
        out = dst / (stl.stem + ".glb")
        write_glb(out, positions, normals)
        print(f"glb: {stl.name} -> {out.name} ({len(positions) // 3} vertices)")
        count += 1
    print(f"stl_to_glb: {count} file(s)")
    return 0 if count else 1


if __name__ == "__main__":
    raise SystemExit(main())
