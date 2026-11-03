"""Which household items print, as a relief, through the real gates? (docs/specs/household-library-spec.md, "Printable versions")

Digital first, a printable version on demand: nothing here is part of the game build. This measures, for each item, what happens if a weekend asks for
a printed one: the item's FRONT surface (the side facing +y) is kept as a height field, so it has no undercut by construction, put on the Kip hand-prop
grip by the part SDK and run through the same gates every printed part passes. An item is called printable only if every blocking gate passes; the
reason it is not, otherwise, is kept.

    parts/partspec/.venv/bin/python3 parts/kip/household/printable_probe.py --out DIR [--only ball,mug] [--json report.json]

Slow (a few seconds an item) and not deterministic enough to commit its output, so the result is a table in the spec, not catalog data.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import List, Optional

import numpy as np
from manifold3d import Manifold

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "parts/kip/sdk"))

import household_builders as hb  # noqa: E402
import household_catalog as hc  # noqa: E402
import kip_partspec_sdk as sdk  # noqa: E402


def relief(head: Manifold, pitch: float = 0.7, floor_y: float = -2.5) -> Manifold:
    """Everything between the bed (y = floor_y) and the head's front surface (its top seen from +y), with the head's silhouette. Rays are cast down -y
    and the surface is rebuilt as a level set. (The pilot's method, kept as it was measured.)"""
    import trimesh

    mesh = head.to_mesh()
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts), process=False)
    x0, y0, z0, x1, y1, z1 = head.bounding_box()
    xs = np.arange(x0 - 2 * pitch, x1 + 2 * pitch, pitch)
    zs = np.arange(z0 - 2 * pitch, z1 + 2 * pitch, pitch)
    gx, gz = np.meshgrid(xs, zs, indexing="ij")
    origins = np.stack([gx.ravel(), np.full(gx.size, y1 + 5.0), gz.ravel()], axis=1)
    locs, ray_idx, _ = tm.ray.intersects_location(origins, np.tile([0.0, -1.0, 0.0], (len(origins), 1)), multiple_hits=True)
    top = np.full(gx.size, np.nan)
    for loc, r in zip(locs, ray_idx):
        if np.isnan(top[r]) or loc[1] > top[r]:
            top[r] = loc[1]
    heights = top.reshape(gx.shape)
    heights = np.where(np.isnan(heights), floor_y - 0.6, np.maximum(heights, floor_y))
    nx, nz = heights.shape

    def sdf(px: float, py: float, pz: float) -> float:
        fx, fz = (px - xs[0]) / pitch, (pz - zs[0]) / pitch
        if fx < 0 or fz < 0 or fx >= nx - 1 or fz >= nz - 1:
            return -1.0
        i, j = int(fx), int(fz)
        u, v = fx - i, fz - j
        h = (heights[i, j] * (1 - u) + heights[i + 1, j] * u) * (1 - v) + (heights[i, j + 1] * (1 - u) + heights[i + 1, j + 1] * u) * v
        return min(h - py, py - floor_y)

    bounds = (float(xs[0]), floor_y - 1.0, float(zs[0]), float(xs[-1]), float(y1 + 2.0), float(zs[-1]))
    return Manifold.level_set(sdf, bounds, pitch).simplify(0.05)


def probe(row: dict, out_dir: Path) -> dict:
    iid = row["id"]
    t0 = time.time()
    solid, _ = hb.assemble(hb.BUILDERS[iid]())
    head = hb.fit_longest(solid, row["propMm"])
    rel = relief(head)
    spec = sdk.part_spec(id=f"household_{iid}", name=row["label"], stat="Spin", behavior=f"A {row['label'].lower()} to hold", slot="hand",
                         fn=lambda r=rel: sdk.handheld_prop(r, grip_tu=2))
    d = out_dir / iid
    d.mkdir(parents=True, exist_ok=True)
    res = sdk.validate_and_export(spec, out_dir=str(d), optimize=False)
    blocking = [f"{c['id']}: {str(c.get('detail'))[:90]}" for c in res["blocking_failures"]]
    return {"id": iid, "printable": bool(res["ok"]) and not blocking, "blocking": blocking, "small_part": res["small_part"].get("status"),
            "assemblyOk": bool(res["assembly"]["ok"]), "seconds": round(time.time() - t0, 1)}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(",") if s]
    rows = [r for r in hc.static_rows() if not only or r["id"] in only]
    report = []
    for row in rows:
        try:
            r = probe(row, args.out)
        except Exception as e:  # noqa: BLE001
            r = {"id": row["id"], "printable": False, "blocking": [f"probe error: {type(e).__name__}: {str(e)[:120]}"], "small_part": None, "assemblyOk": False, "seconds": 0}
        report.append(r)
        print(f"{r['id']:15} {'PRINTS' if r['printable'] else 'digital only':13} small={r['small_part']} {r['seconds']:>5}s  {'; '.join(r['blocking'])[:200]}", flush=True)
        if args.json:
            args.json.write_text(json.dumps(report, indent=1))
    print(f"{sum(1 for r in report if r['printable'])} of {len(report)} pass every blocking gate as a relief")
    return 0


if __name__ == "__main__":
    sys.exit(main())
