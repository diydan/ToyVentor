#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Refresh the construction-line STLs that Yard-Bench.html loads, straight from the PartSpec generators.

Same contract as sync_truck_parts.py (assembly-frame solids, what `toyventor_kitcard._raw_geo` returns, written next to the Truck's mockup STLs), but
for the parts only the Yard bench draws, so adding a vehicle there never needs an edit to the Truck's list. The shared parts the roller also uses
(kit_keel_base, kit_windscreen) are the Truck's and come from its sync, not from here.

    parts/partspec/.venv/bin/python parts/kip/sync_yard_parts.py            # rewrite STLs that differ
    parts/partspec/.venv/bin/python parts/kip/sync_yard_parts.py --check    # exit 1 if any is stale (writes nothing)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PS = ROOT / "parts" / "partspec"
DESTS = [ROOT / "public" / "kip" / "partspec" / "mockup", ROOT / "parts" / "kip" / "viewer" / "partspec" / "mockup"]

# Assembly-frame parts only the Yard bench loads (docs/specs/construction-vehicles-spec.md).
PARTS = ["kit_barbell_shaft_wide", "kit_drum_roller"]


def main():
    check = "--check" in sys.argv[1:]
    sys.path.insert(0, str(PS))
    os.chdir(PS)
    import numpy as np
    import trimesh
    from manifold3d import Manifold, Mesh
    import toyventor_kitcard as kc

    cache = {}
    stale, wrote = [], 0
    for pid in PARTS:
        m = kc._raw_geo(pid, cache)
        mesh = m.to_mesh()
        fresh = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)
        for d in DESTS:
            f = d / f"{pid}.stl"
            if f.exists():
                old = trimesh.load(f)
                same = abs(old.volume - fresh.volume) < 0.05 and np.abs(old.bounds - fresh.bounds).max() < 0.005
                if same:
                    # Equal volume and bounds does not mean equal part (a mirrored part matches both): compare the solids themselves.
                    om = Manifold(Mesh(vert_properties=np.asarray(old.vertices, np.float32), tri_verts=np.asarray(old.faces, np.uint32)))
                    same = ((m - om).volume() + (om - m).volume()) <= 0.5
                if same:
                    continue
            stale.append(f"{pid} ({'missing' if not f.exists() else 'differs'}) in {d.relative_to(ROOT)}")
            if not check:
                d.mkdir(parents=True, exist_ok=True)
                fresh.export(f, file_type="stl")
                wrote += 1
    if check:
        for s in stale:
            print("STALE", s)
        print(f"{len(stale)} stale of {len(PARTS) * len(DESTS)} Yard mockup STLs")
        return 1 if stale else 0
    print(f"wrote {wrote} STLs ({len(PARTS)} parts x {len(DESTS)} dirs, unchanged ones skipped)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
