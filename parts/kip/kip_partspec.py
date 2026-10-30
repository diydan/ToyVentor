#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Conforming PartSpec v2 exporter + assembly validator for Kip's Wardrobe & Modular Vehicles.

All 18 Wave 9 (`W9`) Kip wardrobe & modular TU vehicle parts are canonically defined in
`parts/partspec/catalog.json` and `parts/partspec/toyventor_parts.py` (never duplicating
`interfaces.json` constants or CAD geometry). This module re-exports the drift-proof helpers
for `parts/kip/sdk/kip_partspec_sdk.py` and generates Kip's viewer STLs + sidecar manifest
(`public/kip/kip-partspec-manifest.json`).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
PARTSPEC_DIR = HERE.parent / "partspec"
if str(PARTSPEC_DIR) not in sys.path:
    sys.path.insert(0, str(PARTSPEC_DIR))

import toyventor_assembly as asm  # noqa: E402
import toyventor_parts as tp  # noqa: E402
import toyventor_pro as pro  # noqa: E402, F401

# Re-export shared CAD & drift-proof connector helpers for `parts/kip/sdk/kip_partspec_sdk.py`
_rr = tp._rr
_flat_box = tp._flat_box
_xz_to_layflat = tp._xz_to_layflat
_half = tp._half
def _crown_pad_2x1(size: str = "small"):
    return tp._foot(size, (2, 1), "integrated", ((-0.5, 0.0), (0.5, 0.0)))
add_studs_at = tp.add_studs_at
cut_vertical_bore = tp.cut_vertical_bore
cut_x_axle_bore = tp.cut_x_axle_bore

# Re-export all 18 Wave 9 (`W9`) builders from `toyventor_parts.py`
char_head_kid = tp.char_head_kid
char_head_fox = tp.char_head_fox
char_head_bear = tp.char_head_bear
hair_swoosh = tp.hair_swoosh
hair_pigtails = tp.hair_pigtails
hair_curly = tp.hair_curly
hair_mohawk = tp.hair_mohawk
pack_explorer = tp.pack_explorer
prop_wrench = tp.prop_wrench
prop_star_shield = tp.prop_star_shield
prop_skateboard_deck = tp.prop_skateboard_deck
char_legs_seated = tp.char_legs_seated
veh_car_chassis = tp.veh_car_chassis
veh_steering_wheel = tp.veh_steering_wheel
veh_truck_chassis = tp.veh_truck_chassis
veh_scooter_frame = tp.veh_scooter_frame
veh_handlebar_fork = tp.veh_handlebar_fork
veh_moto_cowling = tp.veh_moto_cowling

W9_ROWS = [r for r in tp.CATALOG["parts"] if r.get("wave") == "W9"]
KIP_PARTS = [tp.BY_ID[r["id"]] for r in W9_ROWS]
KIP_BY_ID = {p["id"]: p for p in KIP_PARTS}


def verify_assemblies(kip_entries: list[dict]) -> list[tuple[str, dict]]:
    """Build combined Library from `parts/partspec` + `kip_entries` and validate all 9 Kip assemblies."""
    base_manifest_path = PARTSPEC_DIR / "out" / "toyventor_parts.json"
    if not base_manifest_path.exists():
        base_manifest_path = PARTSPEC_DIR / "toyventor_parts.json"
    if not base_manifest_path.exists():
        tp.main(str(PARTSPEC_DIR / "out"))
        base_manifest_path = PARTSPEC_DIR / "out" / "toyventor_parts.json"

    base_manifest = json.loads(base_manifest_path.read_text())
    kip_ids = {e["id"] for e in kip_entries}
    combined = {
        "standard": base_manifest["standard"],
        "version": base_manifest["version"],
        "status": base_manifest["status"],
        "units": "mm",
        "parts": [p for p in base_manifest["parts"] if p["id"] not in kip_ids] + kip_entries,
    }
    out_dir = PARTSPEC_DIR / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_manifest = out_dir / "kip_combined_test_manifest.json"
    tmp_manifest.write_text(json.dumps(combined, indent=2))

    builders = {p["id"]: p["fn"] for p in KIP_PARTS}
    lib = asm.Library(tmp_manifest, builders=builders)

    results = []

    # 1. Character Wardrobe + Seated Snap stack on Wave 8 Bolt body + Jetpack + Hair
    b_seated = [asm.place("char_legs_seated", pid="legs")]
    b_seated.append(asm.attach(lib, b_seated[0], "top_studs", "robot_torso_core", "under_sockets", pid="torso"))
    b_seated.append(asm.attach(lib, b_seated[1], "top_studs", "robot_arms_grabber", "under_sockets", pid="arms"))
    b_seated.append(asm.attach(lib, b_seated[2], "top_studs", "char_head_kid", "under_sockets", parent_cell=(0, 0), child_cell=(0, 0), pid="head"))
    b_seated.append(asm.attach(lib, b_seated[2], "top_studs", "robot_back_jetpack", "under_sockets", parent_cell=(0, 1), child_cell=(0, 0), pid="jetpack"))
    b_seated.append(asm.attach(lib, b_seated[3], "top_studs", "hair_pigtails", "under_sockets", pid="hair"))
    results.append(("seated_kid_with_pigtails_and_jetpack", asm.validate(lib, b_seated)))

    # 2. All 3 new heads + all 4 hairs + pointy_ears compatibility check
    for head_id, crown_id in [
        ("char_head_kid", "hair_swoosh"),
        ("char_head_kid", "hair_curly"),
        ("char_head_fox", "pointy_ears"),
        ("char_head_bear", "hair_mohawk"),
    ]:
        h_build = [asm.place(head_id, pid="head")]
        h_build.append(asm.attach(lib, h_build[0], "top_studs", crown_id, "under_sockets", pid="crown"))
        results.append((f"{head_id}_with_{crown_id}", asm.validate(lib, h_build)))

    # 3. Full Roadster Car + ALL 5 Wave 6 Racer Add-Ons + Steering Wheel + Seated Driver + 4x Wave 5 Wheels
    car = asm.place("veh_car_chassis", pid="car")
    b_car = [
        car,
        asm.attach(lib, car, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
        asm.attach(lib, car, "hood_studs", "racer_hood_scoop", "under_sockets", pid="hood_scoop"),
        asm.attach(lib, car, "rollbar_studs", "racer_light_bar", "under_sockets", pid="light_bar"),
        asm.attach(lib, car, "spoiler_studs", "racer_spoiler", "under_sockets", pid="spoiler"),
        asm.attach(lib, car, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
        asm.attach(lib, car, "top_studs", "char_legs_seated", "under_sockets", parent_cell=(1, 0), child_cell=(0, 0), pid="driver_legs"),
        asm.place_on_axis(lib, car, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
    ]
    W_car = 49.6
    L_shaft7 = 87.5
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, car, bore_id, "shaft_tu07", "axis", along=(W_car - L_shaft7) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "wheel_tu04", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "wheel_tu04", "hub", along=L_shaft7 - 12.5, pid=f"wr_{tag}")
        b_car.extend([ax, wl, wr])
    results.append(("roadster_car_full_w6_kit_and_wheels", asm.validate(lib, b_car)))

    # 4. Hauler Truck + Roof Rack + Bull Bar + Cargo Bed Crate + Monster 75 mm (`wheel_tu06`) Wheels
    trk = asm.place("veh_truck_chassis", pid="truck")
    b_trk = [
        trk,
        asm.attach(lib, trk, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
        asm.attach(lib, trk, "roof_studs", "racer_roof_rack", "under_sockets", pid="roof_rack"),
        asm.attach(lib, trk, "cargo_studs", "pack_explorer", "under_sockets", parent_cell=(1, 0), child_cell=(0, 0), pid="cargo_pack"),
        asm.place_on_axis(lib, trk, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
    ]
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, trk, bore_id, "shaft_tu07", "axis", along=(W_car - L_shaft7) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "wheel_tu06", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "wheel_tu06", "hub", along=L_shaft7 - 12.5, pid=f"wr_{tag}")
        b_trk.extend([ax, wl, wr])
    results.append(("hauler_truck_monster_wheels_and_cargo", asm.validate(lib, b_trk)))

    # 5. 2-in-1 Scooter -> Sport Motorbike (`veh_scooter_frame` + `veh_handlebar_fork` + `veh_moto_cowling` + `racer_twin_exhaust` + `wheel_tu04`)
    sc = asm.place("veh_scooter_frame", pid="scooter")
    W_sc = 24.6
    L_shaft5 = 62.5
    b_moto = [
        sc,
        asm.attach(lib, sc, "top_studs", "veh_moto_cowling", "under_sockets", pid="moto_cowling"),
        asm.attach(lib, sc, "seat_studs", "char_legs_seated", "under_sockets", pid="rider_legs"),
        asm.attach(lib, sc, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
        asm.place_on_axis(lib, sc, "headtube", "veh_handlebar_fork", "axis", along=0.0, pid="handlebars"),
    ]
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, sc, bore_id, "shaft_tu05", "axis", along=(W_sc - L_shaft5) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "wheel_tu04", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "wheel_tu04", "hub", along=L_shaft5 - 12.5, pid=f"wr_{tag}")
        b_moto.extend([ax, wl, wr])
    results.append(("sport_motorbike_2in1_full_build", asm.validate(lib, b_moto)))

    # 6. Skateboard Deck + Real Wave 6 `racer_axle` + `racer_wheel`
    sk = asm.place("prop_skateboard_deck", pid="deck")
    b_sk = [sk]
    L_rax = 37.5
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, sk, bore_id, "racer_axle", "axis", along=(W_sc - L_rax) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "racer_wheel", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "racer_wheel", "hub", along=L_rax - 6.0, pid=f"wr_{tag}")
        b_sk.extend([ax, wl, wr])
    results.append(("skateboard_with_w6_racer_wheels", asm.validate(lib, b_sk)))
    tmp_manifest.unlink(missing_ok=True)

    return results


def main() -> int:
    stl_out_dir = HERE.parent.parent / "public" / "kip" / "partspec"
    manifest_out = HERE.parent.parent / "public" / "kip" / "kip-partspec-manifest.json"
    stl_out_dir.mkdir(parents=True, exist_ok=True)

    validator = Draft202012Validator(tp.SCHEMA)
    entries = []
    all_ok = True

    print(f"=== Evaluating {len(KIP_PARTS)} Wave 9 Kip Wardrobe & Vehicle Parts through PartSpec v2 Gate ===")
    for part in KIP_PARTS:
        entry, tm, blocking_fail, small = tp.evaluate(part, validator)
        verified = entry["design_status"] == "verified"
        all_ok &= verified and (not blocking_fail)
        tm.export(stl_out_dir / entry["file"])
        entries.append(entry)
        warns = [c["id"] for c in entry["checks"] if c["result"] == "fail" and tp.level_of(c["id"]) == "warn"]
        tag = "PASS" if verified else "FAIL"
        print(
            f"{tag:4s}  {entry['file']:40s} status={entry['design_status']:18s} "
            f"bbox={entry['bbox_mm']}  small={small['status']}({small['margin_pct']:+.1f}%)  warn={warns}"
        )
        for c in blocking_fail:
            print(f"      BLOCKING FAIL: {c['id']} -> {c['detail']}")
        if not verified and not blocking_fail:
            print(f"      MARGINAL SMALL-PART: {small}")

    print("\n=== Validating Multi-Part Assemblies via toyventor_assembly.validate() ===")
    asm_results = verify_assemblies(entries)
    for name, res in asm_results:
        all_ok &= res["ok"] and (not res["warnings"])
        print(f"{'PASS' if (res['ok'] and not res['warnings']) else 'FAIL':4s}  assembly:{name:42s} edges={len(res['edges'])} warnings={len(res['warnings'])}")
        for err in res["errors"]:
            print(f"      ASM ERROR: {err}")
        for w in res["warnings"]:
            print(f"      ASM WARN:  {w}")

    out_doc = {
        "standard": tp.IF["standard"],
        "version": tp.IF["version"],
        "status": "verified" if all_ok else "needs_reproportion",
        "units": "mm",
        "parts": entries,
        "assemblies": [
            {"id": name, "ok": res["ok"], "edges": len(res["edges"]), "errors": res["errors"], "warnings": res["warnings"]}
            for name, res in asm_results
        ],
    }
    manifest_out.write_text(json.dumps(out_doc, indent=2))
    (HERE / "kip-partspec-manifest.json").write_text(json.dumps(out_doc, indent=2))
    print(f"\nExported {len(entries)} STLs -> {stl_out_dir} and manifest -> {manifest_out}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
