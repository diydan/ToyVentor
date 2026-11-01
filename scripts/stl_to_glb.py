#!/usr/bin/env python3
"""Convert ASCII or binary STL files to indexed, quantized binary glTF (.glb).

Standard library only, on purpose: the parts pipeline must run anywhere
`npm run parts` or `npm run bridge` runs, even without a Python virtualenv.

Default output (v2):
- Scales STL millimetres -> glTF metres and maps Z-up (x, y, z) -> Y-up (x, z, -y).
- Welds coincident vertices, splits sharp edges above `--crease-deg` (default 34 deg),
  and computes area-weighted smooth normals so cylinders/domes shade cleanly.
- Emits uint16 (or uint32) triangle indices and `KHR_mesh_quantization` attributes
  (`UNSIGNED_SHORT` normalized `POSITION` with uniform node `scale` + `translation`,
  and `BYTE` normalized `NORMAL`), decoded natively by Three.js / WebGL2 with 0 KB
  external WASM decoder overhead.

Pass `--legacy-float32` for unindexed float32 debug output.

Usage: stl_to_glb.py <input-dir> <output-dir> [--crease-deg 34] [--manifest path] [--legacy-float32]
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

SCALE = 0.001  # STL millimetres to glTF metres
BINARY_STL_PREFIX_BYTES = 84  # 80-byte header + 4-byte triangle count
BINARY_STL_RECORD_BYTES = 50
WELD_QUANT_PER_METRE = 10_000_000.0  # 1e-7 m = 0.0001 mm weld grid


def _transform_point(point: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = (coordinate * SCALE for coordinate in point)
    # glTF is Y-up; STL here is Z-up. Map (x, y, z) -> (x, z, -y).
    return (x, z, -y)


def _transform_normal(normal: tuple[float, float, float]) -> tuple[float, float, float]:
    return (normal[0], normal[2], -normal[1])


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
            point = values[offset : offset + 3]
            positions.extend(_transform_point(point))
            normals.extend(_transform_normal(normal))
    return positions, normals


def parse_stl(data: bytes):
    if _is_binary_stl(data):
        return parse_binary_stl(data)
    return parse_ascii_stl(data.decode())


def pad4(data: bytes, pad_byte: bytes = b"\x00") -> bytes:
    rem = len(data) % 4
    return data if rem == 0 else data + pad_byte * (4 - rem)


def _normalize(vx: float, vy: float, vz: float) -> tuple[float, float, float]:
    length = math.sqrt(vx * vx + vy * vy + vz * vz)
    if length <= 1e-20:
        return (0.0, 1.0, 0.0)
    inv = 1.0 / length
    return (vx * inv, vy * inv, vz * inv)


def build_indexed_creased_mesh(
    positions: list[float],
    facet_normals: list[float],
    crease_deg: float = 34.0,
) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]], list[int]]:
    """Weld coincident positions and compute area-weighted crease-split normals."""
    if len(positions) % 9 != 0:
        raise ValueError("positions length must be a multiple of 9 (3 vertices * 3 coords)")
    tri_count = len(positions) // 9
    cos_thresh = math.cos(math.radians(max(0.0, min(180.0, crease_deg))))

    welded_coords: list[tuple[float, float, float]] = []
    weld_map: dict[tuple[int, int, int], int] = {}
    # Per welded vertex: list of (tri_idx, corner_slot, unit_fn, weighted_fn)
    incident: list[
        list[tuple[int, int, tuple[float, float, float], tuple[float, float, float]]]
    ] = []
    tri_welded = [0] * (tri_count * 3)

    for t in range(tri_count):
        base = t * 9
        p0 = (positions[base], positions[base + 1], positions[base + 2])
        p1 = (positions[base + 3], positions[base + 4], positions[base + 5])
        p2 = (positions[base + 6], positions[base + 7], positions[base + 8])

        ex1, ey1, ez1 = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        ex2, ey2, ez2 = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        cx = ey1 * ez2 - ez1 * ey2
        cy = ez1 * ex2 - ex1 * ez2
        cz = ex1 * ey2 - ey1 * ex2
        area2 = math.sqrt(cx * cx + cy * cy + cz * cz)
        if area2 > 1e-20:
            inv = 1.0 / area2
            unit_fn = (cx * inv, cy * inv, cz * inv)
            weighted_fn = (cx, cy, cz)
        else:
            fn_raw = (facet_normals[base], facet_normals[base + 1], facet_normals[base + 2])
            unit_fn = _normalize(*fn_raw)
            weighted_fn = unit_fn

        for corner, pt in enumerate((p0, p1, p2)):
            key = (
                round(pt[0] * WELD_QUANT_PER_METRE),
                round(pt[1] * WELD_QUANT_PER_METRE),
                round(pt[2] * WELD_QUANT_PER_METRE),
            )
            wid = weld_map.get(key)
            if wid is None:
                wid = len(welded_coords)
                weld_map[key] = wid
                welded_coords.append(pt)
                incident.append([])
            tri_welded[t * 3 + corner] = wid
            incident[wid].append((t, corner, unit_fn, weighted_fn))

    out_positions: list[tuple[float, float, float]] = []
    out_normals: list[tuple[float, float, float]] = []
    out_indices = [0] * (tri_count * 3)

    for wid, corners in enumerate(incident):
        pos = welded_coords[wid]
        if len(corners) == 1:
            t, c, unit_fn, _ = corners[0]
            out_indices[t * 3 + c] = len(out_positions)
            out_positions.append(pos)
            out_normals.append(unit_fn)
            continue

        # Bucket identical/near-identical face normals first so high-valence poles
        # (e.g. 96-gon dome caps) cluster in microseconds via union-find.
        buckets: dict[tuple[int, int, int], int] = {}
        unique_unit: list[tuple[float, float, float]] = []
        unique_sum: list[list[float]] = []
        corner_bucket: list[int] = []

        for _, _, ufn, wfn in corners:
            bkey = (round(ufn[0] * 2000.0), round(ufn[1] * 2000.0), round(ufn[2] * 2000.0))
            bid = buckets.get(bkey)
            if bid is None:
                bid = len(unique_unit)
                buckets[bkey] = bid
                unique_unit.append(ufn)
                unique_sum.append([wfn[0], wfn[1], wfn[2]])
            else:
                acc = unique_sum[bid]
                acc[0] += wfn[0]
                acc[1] += wfn[1]
                acc[2] += wfn[2]
            corner_bucket.append(bid)

        u_count = len(unique_unit)
        if u_count == 1:
            norm = _normalize(*unique_sum[0])
            v_idx = len(out_positions)
            out_positions.append(pos)
            out_normals.append(norm)
            for t, c, _, _ in corners:
                out_indices[t * 3 + c] = v_idx
            continue

        parent = list(range(u_count))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i in range(u_count):
            ui = unique_unit[i]
            for j in range(i + 1, u_count):
                uj = unique_unit[j]
                if ui[0] * uj[0] + ui[1] * uj[1] + ui[2] * uj[2] >= cos_thresh:
                    ri, rj = find(i), find(j)
                    if ri != rj:
                        parent[rj] = ri

        root_to_vert: dict[int, int] = {}
        root_sum: dict[int, list[float]] = {}
        for bid in range(u_count):
            r = find(bid)
            s = unique_sum[bid]
            acc = root_sum.get(r)
            if acc is None:
                root_sum[r] = [s[0], s[1], s[2]]
            else:
                acc[0] += s[0]
                acc[1] += s[1]
                acc[2] += s[2]

        for r, acc in root_sum.items():
            root_to_vert[r] = len(out_positions)
            out_positions.append(pos)
            out_normals.append(_normalize(acc[0], acc[1], acc[2]))

        for idx_in_list, (t, c, _, _) in enumerate(corners):
            r = find(corner_bucket[idx_in_list])
            out_indices[t * 3 + c] = root_to_vert[r]

    return out_positions, out_normals, out_indices


def _write_glb_chunks(path: Path, gltf: dict, buffer: bytes) -> None:
    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = pad4(buffer)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))  # glTF magic
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))  # JSON
        f.write(json_chunk)
        f.write(struct.pack("<II", len(bin_chunk), 0x004E4942))  # BIN\0
        f.write(bin_chunk)


def write_glb_legacy_float32(path: Path, positions: list[float], normals: list[float]) -> None:
    if not positions:
        raise ValueError("no vertices parsed")
    pos_bytes = struct.pack(f"<{len(positions)}f", *positions)
    nor_bytes = struct.pack(f"<{len(normals)}f", *normals)
    buffer = pad4(pos_bytes) + nor_bytes
    count = len(positions) // 3
    xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
    gltf = {
        "asset": {"version": "2.0", "generator": "toyventor stl_to_glb.py (legacy-float32)"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": path.stem}],
        "meshes": [
            {
                "name": path.stem,
                "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "material": 0, "mode": 4}],
            }
        ],
        "materials": [
            {
                "name": "part",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.92, 0.45, 0.16, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.75,
                },
                "doubleSided": True,
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": count,
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            },
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes)},
            {"buffer": 0, "byteOffset": len(pad4(pos_bytes)), "byteLength": len(nor_bytes)},
        ],
        "buffers": [{"byteLength": len(buffer)}],
    }
    _write_glb_chunks(path, gltf, buffer)


def write_glb(
    path: Path,
    positions: list[float],
    normals: list[float],
    crease_deg: float = 34.0,
    legacy_float32: bool = False,
) -> tuple[int, int]:
    """Write binary GLB and return (vertex_count, triangle_count)."""
    if not positions:
        raise ValueError("no vertices parsed")
    if legacy_float32:
        write_glb_legacy_float32(path, positions, normals)
        return len(positions) // 3, len(positions) // 9

    verts, norms, indices = build_indexed_creased_mesh(positions, normals, crease_deg=crease_deg)
    vert_count = len(verts)
    tri_count = len(indices) // 3

    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)

    # Uniform isotropic scale preserves exact unit normal directions under normalMatrix
    # while keeping 16-bit precision (~1.5 um on a 100 mm part).
    span = max(max_x - min_x, max_y - min_y, max_z - min_z)
    if span <= 1e-12:
        span = 1.0
    inv_span = 65535.0 / span

    pos_buf = bytearray(vert_count * 8)
    nor_buf = bytearray(vert_count * 4)
    q_min = [65535, 65535, 65535]
    q_max = [0, 0, 0]

    for i, ((vx, vy, vz), (nx, ny, nz)) in enumerate(zip(verts, norms)):
        qx = min(65535, max(0, round((vx - min_x) * inv_span)))
        qy = min(65535, max(0, round((vy - min_y) * inv_span)))
        qz = min(65535, max(0, round((vz - min_z) * inv_span)))
        if qx < q_min[0]:
            q_min[0] = qx
        if qy < q_min[1]:
            q_min[1] = qy
        if qz < q_min[2]:
            q_min[2] = qz
        if qx > q_max[0]:
            q_max[0] = qx
        if qy > q_max[1]:
            q_max[1] = qy
        if qz > q_max[2]:
            q_max[2] = qz
        struct.pack_into("<HHHH", pos_buf, i * 8, qx, qy, qz, 0)

        qnx = min(127, max(-127, round(nx * 127.0)))
        qny = min(127, max(-127, round(ny * 127.0)))
        qnz = min(127, max(-127, round(nz * 127.0)))
        struct.pack_into("<bbbb", nor_buf, i * 4, qnx, qny, qnz, 0)

    if vert_count <= 65535:
        idx_component_type = 5123  # UNSIGNED_SHORT
        idx_raw = struct.pack(f"<{len(indices)}H", *indices)
    else:
        idx_component_type = 5125  # UNSIGNED_INT
        idx_raw = struct.pack(f"<{len(indices)}I", *indices)

    pos_offset = 0
    nor_offset = len(pos_buf)  # multiple of 8 -> 4-byte aligned
    idx_offset = nor_offset + len(nor_buf)  # multiple of 4 -> 4-byte aligned
    buffer = bytes(pos_buf) + bytes(nor_buf) + pad4(idx_raw)

    gltf = {
        "asset": {"version": "2.0", "generator": "toyventor stl_to_glb.py v2"},
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {
                "mesh": 0,
                "name": path.stem,
                "translation": [min_x, min_y, min_z],
                "scale": [span, span, span],
            }
        ],
        "meshes": [
            {
                "name": path.stem,
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1},
                        "indices": 2,
                        "material": 0,
                        "mode": 4,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": "part",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.92, 0.45, 0.16, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.75,
                },
                "doubleSided": True,
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5123,
                "normalized": True,
                "count": vert_count,
                "type": "VEC3",
                "min": q_min,
                "max": q_max,
            },
            {
                "bufferView": 1,
                "componentType": 5120,
                "normalized": True,
                "count": vert_count,
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": idx_component_type,
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": pos_offset,
                "byteLength": len(pos_buf),
                "byteStride": 8,
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": nor_offset,
                "byteLength": len(nor_buf),
                "byteStride": 4,
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": idx_offset,
                "byteLength": len(idx_raw),
                "target": 34963,
            },
        ],
        "buffers": [{"byteLength": len(buffer)}],
    }
    _write_glb_chunks(path, gltf, buffer)
    return vert_count, tri_count


def _load_manifest_creases(manifest_path: Path | None, default_crease: float) -> tuple[float, dict[str, float]]:
    if manifest_path is None or not manifest_path.exists():
        return default_crease, {}
    doc = json.loads(manifest_path.read_text("utf-8"))
    base = float(doc.get("defaults", {}).get("web_crease_deg", default_crease))
    per_part: dict[str, float] = {}
    for pid, entry in (doc.get("parts") or {}).items():
        if isinstance(entry, dict) and "web_crease_deg" in entry:
            per_part[pid] = float(entry["web_crease_deg"])
    return base, per_part


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Convert STL directory to quantized indexed GLB.")
    ap.add_argument("input_dir", nargs="?", help="Directory containing .stl files")
    ap.add_argument("output_dir", nargs="?", help="Directory to write .glb files")
    ap.add_argument("--crease-deg", type=float, default=34.0, help="Crease split angle in degrees")
    ap.add_argument("--manifest", type=Path, default=None, help="Optional asset_optimization_manifest.json")
    ap.add_argument("--legacy-float32", action="store_true", help="Emit unindexed float32 GLB")
    args = ap.parse_args(argv)

    if not args.input_dir or not args.output_dir:
        print(__doc__)
        return 2

    src, dst = Path(args.input_dir), Path(args.output_dir)
    dst.mkdir(parents=True, exist_ok=True)
    base_crease, part_creases = _load_manifest_creases(args.manifest, args.crease_deg)

    count = 0
    total_bytes = 0
    for stl in sorted(src.glob("*.stl")):
        positions, normals = parse_stl(stl.read_bytes())
        out = dst / (stl.stem + ".glb")
        crease = part_creases.get(stl.stem, base_crease)
        v_count, t_count = write_glb(
            out,
            positions,
            normals,
            crease_deg=crease,
            legacy_float32=args.legacy_float32,
        )
        sz = out.stat().st_size
        total_bytes += sz
        print(f"glb: {stl.name} -> {out.name} ({v_count} verts, {t_count} tris, {sz / 1024:.1f} KB)")
        count += 1
    print(f"stl_to_glb: {count} file(s), {total_bytes / (1024 * 1024):.2f} MB total")
    return 0 if count else 1


if __name__ == "__main__":
    raise SystemExit(main())
