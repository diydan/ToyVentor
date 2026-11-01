#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Write public/kip/partspec/describe/<id>.stl: the 30 curated parts in ASSEMBLY orientation, for the Describe & build viewer.

The reference poses (and every pose the real validator returns) apply to `Library.geometry(id)`, the part as the generators build it. The shipped
toyventor_<id>_S.stl files are print-bed orientation instead (four of these parts are printed turned 90 degrees) and the folder is rewritten by other
exports, so the viewer gets its own folder: placing an STL with a pose is then `rotate (tilt, rot) then translate`, with no per-part fix-ups.

    parts/partspec/.venv/bin/python parts/kip/viewer/tools/export_describe_stls.py           # rewrite changed files
    parts/partspec/.venv/bin/python parts/kip/viewer/tools/export_describe_stls.py --check   # exit 1 if any file is missing or stale

Reads parts/partspec (generators and manifest) and writes only public/kip/partspec/describe/.
"""
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
PS = ROOT / "parts" / "partspec"
OUT = ROOT / "public" / "kip" / "partspec" / "describe"
FIXTURES = ROOT / "parts" / "kip" / "viewer" / "kip-describe-recipes.json"


def main():
    check = "--check" in sys.argv[1:]
    sys.path.insert(0, str(PS))
    os.chdir(PS)
    import numpy as np
    import trimesh
    import toyventor_assembly as ta

    lib = ta.Library("toyventor_parts.json")
    ids = [a["id"] for a in json.loads(FIXTURES.read_text())["allowedParts"]]
    OUT.mkdir(parents=True, exist_ok=True)
    stale, wrote, total = [], 0, 0
    for pid in ids:
        mesh = lib.geometry(pid).to_mesh()
        fresh = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)
        f = OUT / f"{pid}.stl"
        if f.exists():
            old = trimesh.load(f)
            if abs(old.volume - fresh.volume) < 0.05 and np.abs(old.bounds - fresh.bounds).max() < 0.005:
                total += f.stat().st_size
                continue
        stale.append(pid)
        if not check:
            fresh.export(f, file_type="stl")
            wrote += 1
            total += f.stat().st_size
    if check:
        for pid in stale:
            print("STALE or missing:", pid)
        print(f"{len(stale)} of {len(ids)} describe STLs stale")
        return 1 if stale else 0
    print(f"wrote {wrote} of {len(ids)} STLs to {OUT.relative_to(ROOT)} ({total / 1e6:.1f} MB in the folder)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
