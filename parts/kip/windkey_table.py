#!/usr/bin/env python3
"""Overlap table for the Wind Key Lab page (parts/kip/viewer/WindKey-Lab.html).

Places the Band-stage parts exactly as Truck-Mockup.html rebuildScene() does (same transforms, same PTO and spool phase), slides
`mom_wind_key` along the spool axis (world x) and records, for every part, the overlap volume at every key spin angle (30 deg steps).
Spin matters: the key's prongs sit 7.8 mm off the axis, so at spin 0/180 they point up and down (into the rear wheel) and at spin 90/270 they point
along +-y (where the holes in the tray wall are). A table that keeps only the worst spin shows the wheel as a blocker; per spin it is not.
Writes parts/kip/viewer/windkey-overlaps.json (build:kip copies it to public/kip/).

The placements below are COPIED from Truck-Mockup.html (band stage, giant wheels off). If that page moves a part, update them here and re-run.

  /Users/dan/Code/toyforge/parts/partspec/.venv/bin/python3 parts/kip/windkey_table.py        # from the repo root

Inputs are the assembly-frame STLs in public/kip/partspec/mockup/ (written by sync_truck_parts.py). Read-only on everything else.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import Manifold, Mesh

ROOT = Path(__file__).resolve().parents[2]
STL = ROOT / "public/kip/partspec/mockup"
OUT = ROOT / "parts/kip/viewer/windkey-overlaps.json"

PTO_PHASE, SPOOL_PHASE = math.radians(17.5), math.radians(27.0)   # Truck-Mockup.html STEER.ptoPhaseRad / spoolPhaseRad
SPIN_STEP = 30                                                    # key spin step (deg); every spin is kept, not the worst one
SPIN_ANGLES = tuple(range(0, 360, SPIN_STEP))
MIN_VOL = 0.05                                                    # mm3, the same threshold the motion checks use


def T(x, y, z):
    m = np.eye(4); m[:3, 3] = (x, y, z); return m


def Rx(a):
    c, s = math.cos(a), math.sin(a); m = np.eye(4); m[1, 1], m[1, 2], m[2, 1], m[2, 2] = c, -s, s, c; return m


def Ry(a):
    c, s = math.cos(a), math.sin(a); m = np.eye(4); m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c; return m


def Rz(a):
    c, s = math.cos(a), math.sin(a); m = np.eye(4); m[0, 0], m[0, 1], m[1, 0], m[1, 1] = c, -s, s, c; return m


_raw = {}


def _mesh(pid):
    if pid not in _raw:
        _raw[pid] = trimesh.load(STL / f"{pid}.stl")
    return _raw[pid]


def solid(pid, M):
    t = _mesh(pid).copy(); t.apply_transform(M)
    return Manifold(Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))


RA = T(0, 43.75, 6.25)   # rear axle group
PARTS = {                # key -> (part id, transform): everything the key can meet; order is the order the page lists them
    "pto_shaft": ("shaft_tu03", T(-15.20, 43.75, 31.25) @ Ry(math.pi / 2) @ Rz(PTO_PHASE)),
    "pto_gear": ("mom_pto_gear_z10", T(-3.125, 43.75, 31.25) @ Ry(math.pi / 2) @ Rz(PTO_PHASE)),
    "spool": ("mom_band_spool_pawl", T(3.85, 43.75, 31.25) @ Ry(math.pi / 2) @ Rz(SPOOL_PHASE)),
    "tray": ("mom_band_core_tray", T(0, 37.5, 12.5)),
    "lid": ("mom_band_core_lid", T(0, 37.5, 44.8)),
    "wheel_R": ("kit_wheel_med", RA @ T(26.7, 0, 0) @ Ry(math.pi / 2)),
    "wheel_L": ("kit_wheel_med", RA @ T(-26.7, 0, 0) @ Ry(-math.pi / 2)),
    "rear_axle": ("kit_barbell_shaft", RA @ T(-39, 0, 0) @ Ry(math.pi / 2)),
    "axle_gear": ("gear_spur_z10", RA @ T(-3.125, 0, 0) @ Ry(math.pi / 2)),
    "sear_pin": ("pro_captive_pin_28", T(24.775, 22.25, 36.0) @ Ry(-math.pi / 2)),
    "keel": ("kit_keel_base", np.eye(4)),
}


def key_matrix(x, spin):   # Truck-Mockup.html: wrap at (x, 43.75, 31.25), rotation.x = spin, orient rotation.y = -pi/2
    return T(x, 43.75, 31.25) @ Rx(spin) @ Ry(-math.pi / 2)


def main():
    xs = [round(20 + 0.5 * i, 1) for i in range(41)] + [float(v) for v in range(41, 71)]
    parts = {k: solid(pid, M) for k, (pid, M) in PARTS.items()}
    kb = solid("mom_wind_key", key_matrix(28.0, 0)).bounding_box()
    table = {}
    for x in xs:
        by_spin = {}
        for a in SPIN_ANGLES:
            k = solid("mom_wind_key", key_matrix(x, math.radians(a)))
            kbox, row = k.bounding_box(), {}
            for name, s in parts.items():
                sb = s.bounding_box()
                row[name] = 0.0 if (np.any(kbox[:3] > sb[3:]) or np.any(kbox[3:] < sb[:3])) else round((k ^ s).volume(), 1)
            by_spin[str(a)] = row
        table[f"{x:.1f}"] = by_spin
        print(x, {a: {k: v for k, v in r.items() if v > MIN_VOL} for a, r in by_spin.items() if a in ("0", "90")}, flush=True)
    doc = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "min_overlap_mm3": MIN_VOL,
        "spin_step_deg": SPIN_STEP,
        "spin_angles_deg": list(SPIN_ANGLES),
        "xs": xs,
        "key_reach_mm": round(28.0 - float(kb[0]), 2),    # the key spans x - reach .. x
        "table": table,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", OUT, f"({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
