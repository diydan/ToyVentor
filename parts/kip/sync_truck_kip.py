#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Refresh the Kip driver wardrobe used by Truck-Mockup.html in assembly orientation (matching sync_truck_parts.py).

The truck viewer seats the real Kip Pro (8+) / Snap (3+) rig at 0.68x cockpit scale and mounts head, face plate, hair and hat
with toyventor_assembly connector offsets (under_sockets at z = 0, face_slot axis) on neck_turret_2x1, so every STL in
partspec/mockup/ must be in ASSEMBLY orientation (lib.geometry(pid)), not the z-rebased print-bed orientation of parts/partspec/out.

    python3 parts/kip/sync_truck_kip.py
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PS = ROOT / "parts" / "partspec"
DESTS = [ROOT / "public" / "kip" / "partspec" / "mockup", ROOT / "parts" / "kip" / "viewer" / "partspec" / "mockup"]

HEADS = [
    "char_head_kid", "char_head_chibi", "char_head_tall", "char_head_jumbo",
    "robot_head_visor", "robot_head_scout",
    "char_head_fox", "char_head_bear", "char_head_cat",
    "char_head_dragon", "char_head_alien", "char_head_imp",
]
BODY = ["char_faceplate"]
HATS = ["hat_hardhat", "hat_ballcap", "hat_beanie", "hat_cowboy", "hat_ranger", "hat_tophat", "hat_pirate", "wobble_hat"]
RETIRED = ["char_legs_seated.stl", "robot_torso_core.stl", "robot_arms_grabber.stl"]


def main():
    sys.path.insert(0, str(PS))
    os.chdir(PS)
    import numpy as np
    import trimesh
    import toyventor_assembly as asm

    man_path = PS / "toyventor_parts.json"
    man = json.loads(man_path.read_text())
    parts = {p["id"]: p for p in man["parts"]}
    lib = asm.Library(str(man_path))
    hairs = sorted(i for i in parts if i.startswith("hair_"))

    def conn(pid, cid):
        return next((c for c in parts[pid]["connectors"] if c["id"] == cid), None)

    def top_z(pid):
        c = conn(pid, "top_studs")
        return None if c is None else c["frame"]["origin"][2]

    table = {"heads": {}, "hairs": {}, "hats": HATS}
    for h in HEADS:
        fs = conn(h, "face_slot")
        table["heads"][h] = {
            "top": top_z(h),
            "boreY": None if fs is None else fs["frame"]["origin"][1],
            "boreZ": None if fs is None else fs["frame"]["origin"][2],
            "human": fs is not None,
        }
    for h in hairs:
        table["hairs"][h] = {"top": top_z(h)}   # null = sculpted-top wig, no hat studs

    wanted = BODY + HEADS + hairs + HATS
    meshes = {}
    for pid in wanted:
        mesh = lib.geometry(pid).to_mesh()
        meshes[pid] = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)

    for d in DESTS:
        if not d.parent.exists():
            continue
        d.mkdir(parents=True, exist_ok=True)
        for old in RETIRED:
            (d / old).unlink(missing_ok=True)
        for pid, fresh in meshes.items():
            fresh.export(d / f"{pid}.stl", file_type="stl")
        (d / "kip_stack.json").write_text(json.dumps(table, indent=1))
        print(f"synced {len(wanted)} assembly-frame STLs + kip_stack.json -> {d}")


if __name__ == "__main__":
    main()
