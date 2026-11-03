"""Write a household item as a game GLB with one named material per colour zone.

The repo's `scripts/stl_to_glb.encode_quantized_glb_bytes` writes ONE material. A household item has up to three colour zones (a bottle's cap, a jar's
lid), so this writer does the same job with one primitive per zone over a shared vertex buffer:

  - the axis and unit change is the repo's own `optimize_assets.arrays_to_gltf_inputs` (z-up mm -> y-up metres: (x, y, z) -> (x, z, -y) / 1000);
  - welding and crease-split normals are the repo's own `stl_to_glb.build_indexed_creased_mesh` (it keeps the triangle order, so a triangle's zone
    survives it);
  - quantisation is the same as `encode_quantized_glb_bytes` (KHR_mesh_quantization, 16-bit positions in one uniform scale, 8-bit normals), and the
    material properties match it, so the game loads these as it loads every other part.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from optimize_assets import arrays_to_gltf_inputs  # noqa: E402
from stl_to_glb import _encode_glb_chunks, build_indexed_creased_mesh, pad4  # noqa: E402


HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def srgb_hex_to_linear(hex_colour: str) -> List[float]:
    """glTF's baseColorFactor is linear; the catalog's colours are sRGB hex, written exactly #RRGGBB."""
    if not HEX_RE.match(hex_colour):
        raise ValueError(f"colour must be #RRGGBB, got {hex_colour!r}")
    h = hex_colour[1:]
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(round(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4, 5))
    return out


def zoned_glb(
    name: str,
    verts_mm: np.ndarray,
    faces: np.ndarray,
    tri_zone: Sequence[str],
    zones: Sequence[Tuple[str, str]],
    crease_deg: float = 34.0,
    extras: Optional[dict] = None,
) -> Tuple[bytes, dict]:
    """Returns (glb bytes, {"verts": n, "tris": n, "zoneTris": {"<zone>": triangles in that zone, ...}}).
    `tri_zone[i]` names the zone of triangle i; `zones` lists (name, #RRGGBB) in material order. Every zone must own at least one triangle and every
    triangle a listed zone."""
    if len(tri_zone) != len(faces):
        raise ValueError("one zone per triangle")
    names = [z for z, _ in zones]
    if len(set(names)) != len(names):
        raise ValueError("duplicate zone name")
    unknown = set(tri_zone) - set(names)
    if unknown:
        raise ValueError(f"triangles in unlisted zones: {sorted(unknown)}")

    positions, normals = arrays_to_gltf_inputs(verts_mm, faces)
    verts, norms, indices = build_indexed_creased_mesh(positions, normals, crease_deg=crease_deg)
    v = np.asarray(verts, dtype=np.float64)
    n = np.asarray(norms, dtype=np.float64)
    count = len(v)

    mins = v.min(axis=0)
    span = float((v.max(axis=0) - mins).max())
    if span <= 1e-12:
        span = 1.0
    q = np.clip(np.rint((v - mins) * (65535.0 / span)), 0, 65535).astype("<u2")
    pos_buf = np.zeros((count, 4), dtype="<u2")
    pos_buf[:, :3] = q
    nq = np.clip(np.rint(n * 127.0), -127, 127).astype("i1")
    nor_buf = np.zeros((count, 4), dtype="i1")
    nor_buf[:, :3] = nq

    idx = np.asarray(indices, dtype=np.uint32).reshape(-1, 3)
    idx_dtype, idx_ctype = ("<u2", 5123) if count <= 65535 else ("<u4", 5125)

    chunks: List[bytes] = [pos_buf.tobytes(), nor_buf.tobytes()]
    buffer_views = [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(chunks[0]), "byteStride": 8, "target": 34962},
        {"buffer": 0, "byteOffset": len(chunks[0]), "byteLength": len(chunks[1]), "byteStride": 4, "target": 34962},
    ]
    offset = len(chunks[0]) + len(chunks[1])
    accessors = [
        {"bufferView": 0, "componentType": 5123, "normalized": True, "count": count, "type": "VEC3",
         "min": [int(x) for x in q.min(axis=0)], "max": [int(x) for x in q.max(axis=0)]},
        {"bufferView": 1, "componentType": 5120, "normalized": True, "count": count, "type": "VEC3"},
    ]
    primitives, materials = [], []
    zone_tris: Dict[str, int] = {}
    tri_zone_arr = np.asarray(list(tri_zone))
    for zi, (zname, zhex) in enumerate(zones):
        sel = idx[tri_zone_arr == zname]
        if len(sel) == 0:
            raise ValueError(f"zone {zname!r} has no triangles")
        zone_tris[zname] = int(len(sel))
        raw = pad4(sel.astype(idx_dtype).reshape(-1).tobytes())
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": 34963})
        accessors.append({"bufferView": len(buffer_views) - 1, "componentType": idx_ctype, "count": int(sel.size), "type": "SCALAR"})
        primitives.append({"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": len(accessors) - 1, "material": zi, "mode": 4})
        materials.append({
            "name": zname,
            "pbrMetallicRoughness": {"baseColorFactor": srgb_hex_to_linear(zhex) + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.75},
            "doubleSided": True,
        })
        chunks.append(raw)
        offset += len(raw)

    node = {"mesh": 0, "name": name, "translation": [float(x) for x in mins], "scale": [span, span, span]}
    if extras:
        node["extras"] = extras
    gltf = {
        "asset": {"version": "2.0", "generator": "toyventor household_glb.py"},
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [node],
        "meshes": [{"name": name, "primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": sum(len(c) for c in chunks)}],
    }
    glb = _encode_glb_chunks(gltf, b"".join(chunks))
    return glb, {"verts": int(count), "tris": int(len(idx)), "zoneTris": zone_tris}
