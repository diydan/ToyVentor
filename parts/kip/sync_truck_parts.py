#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Refresh the kit and Pro hardware STLs that Truck-Mockup.html loads, straight from the PartSpec generators.

The truck viewer places each solid with the same offsets the verification gates use (toyventor_kitcard._steer_linkage_solids, G1), so every STL here
is the part in ASSEMBLY orientation, i.e. what `toyventor_kitcard._raw_geo` returns, not the print-bed orientation of parts/partspec/out. Run it
after changing a kit part (it was found stale for the windscreen and the steer bridge after the rack-steering rework):

    parts/partspec/.venv/bin/python parts/kip/sync_truck_parts.py            # rewrite STLs that differ
    parts/partspec/.venv/bin/python parts/kip/sync_truck_parts.py --check    # exit 1 if any is stale (writes nothing)

The wardrobe pieces (heads, hair, hats, torso, legs) come from sync_truck_kip.py instead. Builds read only the generator sources and
the generator sources in parts/partspec, never the shared out/ directory.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PS = ROOT / "parts" / "partspec"
DESTS = [ROOT / "public" / "kip" / "partspec" / "mockup", ROOT / "parts" / "kip" / "viewer" / "partspec" / "mockup"]

# Assembly-frame parts the viewer loads. char_* come from sync_truck_kip.py.
PARTS = [
    "kit_keel_base", "kit_barbell_shaft", "kit_wheel_med", "kit_wheel_giant", "kit_aero_wedge", "kit_windscreen", "kit_tilting_tub",
    "kit_scoop_blade", "kit_turntable", "kit_yoke_hbar", "pro_tub_hinge",
    "pro_steer_bridge", "pro_steer_knuckle_l", "pro_steer_knuckle_r", "pro_steer_rack", "pro_tie_rod_link",
    "pro_captive_pin_28", "pro_steer_column", "pro_steer_wheel", "pin_free_tu03", "pin_free",
    "gear_spur_z10", "shaft_tu03",
    "mom_band_core_tray", "mom_band_core_lid", "mom_pto_gear_z10", "mom_band_spool_pawl", "mom_latch_pawl", "mom_wind_key", "mom_bumper_trigger",
    "mom_bellows_base", "mom_bellows_leaf",
    "mom_jet_valve_body",   # Jet Car Lab (parts/kip/viewer/JetCar-Lab.html); the slide valve and nozzle set are print-orientation parts and are not drawn
    "mech_drive_tray", "mech_drive_lid", "mech_n20_pinion_z10",
    "mech_brain_tray", "mech_brain_lid", "mech_bat_door_screw",
    "mech_servo_mount", "mech_servo_lid", "mech_servo_pinion_z10", "pro_pilot_pin", "mech_sill_duct",
]


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
                    # Equal volume and bounds does not mean equal part: a MIRRORED part (the PTO gear pocket and spool pawls, 2026-11-02) matches both.
                    # Compare the solids themselves: the symmetric difference of the old STL and the fresh geometry (identical parts give ~0.00 mm3).
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
        print(f"{len(stale)} stale of {len(PARTS) * len(DESTS)} mockup STLs")
        return 1 if stale else 0
    print(f"wrote {wrote} STLs ({len(PARTS)} parts x {len(DESTS)} dirs, unchanged ones skipped)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
