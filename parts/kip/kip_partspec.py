#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Conforming PartSpec v2 exporter + assembly validator for Kip's Wardrobe & V2 Modular Vehicles.

All 30 Wave 9 (`W9`) Kip wardrobe, stylized wheel & V2 modular TU vehicle parts are canonically
defined in `parts/partspec/catalog.json` and `parts/partspec/toyventor_parts.py` (never duplicating
`interfaces.json` constants or CAD geometry). This module re-exports the drift-proof helpers for
`parts/kip/sdk/kip_partspec_sdk.py` and generates Kip's viewer STLs, two-tone visual companion
overlays, and sidecar manifest (`public/kip/kip-partspec-manifest.json`).
"""
from __future__ import annotations

import json
import shutil
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
_slice_plate = tp._slice_plate
_hull_slices = tp._hull_slices
_cut_clevis_x_bores = tp._cut_clevis_x_bores


def _crown_pad_2x1(size: str = "small"):
    return tp._foot(size, (2, 1), "integrated", ((-0.5, 0.0), (0.5, 0.0)))


add_studs_at = tp.add_studs_at
cut_vertical_bore = tp.cut_vertical_bore
cut_x_axle_bore = tp.cut_x_axle_bore

# Re-export all 30 Wave 9 (`W9`) builders from `toyventor_parts.py`
char_head_kid = tp.char_head_kid
char_faceplate = tp.char_faceplate
char_head_fox = tp.char_head_fox
char_head_bear = tp.char_head_bear
hair_short_swept = tp.hair_short_swept
hair_bob = tp.hair_bob
hair_swoosh = tp.hair_swoosh
hair_spiky = tp.hair_spiky
hair_pigtails = tp.hair_pigtails
hair_ponytail = tp.hair_ponytail
hair_curly = tp.hair_curly
hair_mohawk = tp.hair_mohawk
pack_explorer = tp.pack_explorer
prop_wrench = tp.prop_wrench
prop_star_shield = tp.prop_star_shield
prop_skateboard_deck = tp.prop_skateboard_deck
char_legs_seated = tp.char_legs_seated
veh_wheel_sport = tp.veh_wheel_sport
veh_wheel_offroad = tp.veh_wheel_offroad
veh_wheel_moto = tp.veh_wheel_moto
veh_car_chassis = tp.veh_car_chassis
veh_car_hood_cover = tp.veh_car_hood_cover
veh_cab_roof_cover = tp.veh_cab_roof_cover
veh_steering_wheel = tp.veh_steering_wheel
veh_truck_chassis = tp.veh_truck_chassis
veh_truck_bed_cover = tp.veh_truck_bed_cover
veh_scooter_frame = tp.veh_scooter_frame
veh_scooter_fairing = tp.veh_scooter_fairing
veh_handlebar_fork = tp.veh_handlebar_fork
veh_moto_cowling = tp.veh_moto_cowling

W9_ROWS = [r for r in tp.CATALOG["parts"] if r.get("wave") == "W9"]
KIP_PARTS = [tp.BY_ID[r["id"]] for r in W9_ROWS]
KIP_BY_ID = {p["id"]: p for p in KIP_PARTS}

SHARED_VIEWER_IDS = [
    "shaft_tu03", "shaft_tu05", "shaft_tu07", "pin_friction_tu02",
    "gear_spur_z10", "gear_spur_z20", "beam_str_tu03", "wheel_tu04", "wheel_tu06",
    "racer_axle", "racer_wheel", "racer_bull_bar", "racer_hood_scoop",
    "racer_light_bar", "racer_spoiler", "racer_twin_exhaust", "racer_roof_rack",
    "glow_capsule", "robot_head_visor", "robot_back_jetpack",
    "cloud_wings", "pointy_ears", "bumper_horns", "wobble_hat",
]


def _export_visual_overlays(stl_out_dir: Path) -> None:
    """Export Coral Spark 2x1 crown studs and alloy wheel-rim STLs for Three.js, pruning obsolete head overlays."""
    for stale in (
        "toyventor_char_head_boy_S.stl",
        "toyventor_char_head_bob_S.stl",
        "toyventor_char_head_curls_S.stl",
        "toyventor_char_head_boy_skin.stl",
        "toyventor_char_head_boy_hair.stl",
        "toyventor_char_head_bob_skin.stl",
        "toyventor_char_head_bob_hair.stl",
        "toyventor_char_head_curls_skin.stl",
        "toyventor_char_head_curls_hair.stl",
    ):
        (stl_out_dir / stale).unlink(missing_ok=True)

    p_sm = tp.STUD["small"]
    r_stud = p_sm["stud_d"] / 2 + 0.03
    h_stud = p_sm["stud_h"] + 0.04
    crown_buds = (
        tp.cyl(h_stud + 0.2, r_stud, -0.2, -6.25, 0.0, 72)
        + tp.cyl(h_stud + 0.2, r_stud, -0.2, 6.25, 0.0, 72)
    )
    overlays = {
        "toyventor_crown_buds_2x1.stl": crown_buds,
        "toyventor_veh_wheel_sport_rim.stl": tp.wheel_rim_sport(),
        "toyventor_veh_wheel_offroad_rim.stl": tp.wheel_rim_offroad(),
        "toyventor_veh_wheel_moto_rim.stl": tp.wheel_rim_moto(),
    }
    for fname, mani in overlays.items():
        tp.to_trimesh(mani).export(stl_out_dir / fname)


def verify_assemblies(kip_entries: list[dict]) -> list[tuple[str, dict]]:
    """Build combined Library from `parts/partspec` + `kip_entries` and validate all V2 Kip assemblies."""
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

    # 1. Seated human character + Swappable Emotion Face Plate + Hat-Ready Swept Hair + Wobble Hat stacked on top!
    b_seated = [asm.place("char_legs_seated", pid="legs")]
    b_seated.append(asm.attach(lib, b_seated[0], "top_studs", "robot_torso_core", "under_sockets", pid="torso"))
    b_seated.append(asm.attach(lib, b_seated[1], "top_studs", "robot_arms_grabber", "under_sockets", pid="arms"))
    b_seated.append(asm.attach(lib, b_seated[2], "top_studs", "char_head_kid", "under_sockets", parent_cell=(0, 0), child_cell=(0, 0), pid="head"))
    b_seated.append(asm.place_on_axis(lib, b_seated[3], "face_slot", "char_faceplate", "axis", along=0.0, pid="faceplate"))
    b_seated.append(asm.attach(lib, b_seated[3], "top_studs", "hair_short_swept", "under_sockets", pid="hair"))
    b_seated.append(asm.attach(lib, b_seated[5], "top_studs", "wobble_hat", "under_sockets", pid="hat"))
    results.append(("seated_human_faceplate_hat_ready_hair_and_hat", asm.validate(lib, b_seated)))

    # 2. All character heads, swappable faceplate, Hat-Ready hair + hat stacks, and Sculpted-Top hairs
    for asm_name, head_id, with_face, crown_id, hat_id in [
        ("kid_faceplate_bob_with_ears", "char_head_kid", True, "hair_bob", "pointy_ears"),
        ("kid_faceplate_swoosh_with_horns", "char_head_kid", True, "hair_swoosh", "bumper_horns"),
        ("kid_faceplate_with_hair_spiky", "char_head_kid", True, "hair_spiky", None),
        ("kid_faceplate_with_hair_pigtails", "char_head_kid", True, "hair_pigtails", None),
        ("kid_faceplate_with_hair_ponytail", "char_head_kid", True, "hair_ponytail", None),
        ("kid_faceplate_with_hair_curly", "char_head_kid", True, "hair_curly", None),
        ("char_head_fox_with_wobble_hat", "char_head_fox", False, "wobble_hat", None),
        ("char_head_bear_with_hair_mohawk", "char_head_bear", False, "hair_mohawk", None),
    ]:
        h_build = [asm.place(head_id, pid="head")]
        if with_face:
            h_build.append(asm.place_on_axis(lib, h_build[0], "face_slot", "char_faceplate", "axis", along=0.0, pid="faceplate"))
        hair_item = asm.attach(lib, h_build[0], "top_studs", crown_id, "under_sockets", pid="crown")
        h_build.append(hair_item)
        if hat_id:
            h_build.append(asm.attach(lib, hair_item, "top_studs", hat_id, "under_sockets", pid="hat_top"))
        results.append((asm_name, asm.validate(lib, h_build)))

    # 3. V2 Roadster Car + Snap-on Hood Cover + Cab Targa Cover + W6 Racer Kit + 4x 5-Spoke Sport Wheels on flush 5-TU Shafts
    car = asm.place("veh_car_chassis", pid="car")
    c_hood = asm.attach(lib, car, "hood_studs", "veh_car_hood_cover", "under_sockets", pid="hood_cover")
    c_cab = asm.attach(lib, car, "rollbar_studs", "veh_cab_roof_cover", "under_sockets", pid="cab_cover")
    b_car = [
        car, c_hood, c_cab,
        asm.attach(lib, car, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
        asm.attach(lib, c_hood, "top_studs", "racer_hood_scoop", "under_sockets", pid="hood_scoop"),
        asm.attach(lib, c_cab, "top_studs", "racer_light_bar", "under_sockets", parent_cell=(0, 0), child_cell=(0, 0), pid="light_bar"),
        asm.attach(lib, car, "spoiler_studs", "racer_spoiler", "under_sockets", pid="spoiler"),
        asm.attach(lib, car, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
        asm.attach(lib, car, "top_studs", "char_legs_seated", "under_sockets", parent_cell=(1, 0), child_cell=(0, 0), pid="driver_legs"),
        asm.place_on_axis(lib, car, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
    ]
    W_tun, L_shaft5 = 33.6, 62.5
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, car, bore_id, "shaft_tu05", "axis", along=(W_tun - L_shaft5) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "veh_wheel_sport", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "veh_wheel_sport", "hub", along=L_shaft5 - 13.5, pid=f"wr_{tag}")
        b_car.extend([ax, wl, wr])
    results.append(("roadster_car_v2_covers_and_sport_wheels", asm.validate(lib, b_car)))

    # 4. V2 Hauler Truck + Shared Hood Cover + Cab Roof Cover + Roof Rack + Bed Side-Rails Cover + 4x 6-Window Off-Road Wheels
    trk = asm.place("veh_truck_chassis", pid="truck")
    t_hood = asm.attach(lib, trk, "hood_studs", "veh_car_hood_cover", "under_sockets", pid="hood_cover")
    t_cab = asm.attach(lib, trk, "roof_studs", "veh_cab_roof_cover", "under_sockets", pid="cab_cover")
    t_bed = asm.attach(lib, trk, "cargo_studs", "veh_truck_bed_cover", "under_sockets", pid="bed_cover")
    b_trk = [
        trk, t_hood, t_cab, t_bed,
        asm.attach(lib, trk, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
        asm.attach(lib, t_cab, "top_studs", "racer_roof_rack", "under_sockets", pid="roof_rack"),
        asm.attach(lib, t_bed, "bed_studs", "pack_explorer", "under_sockets", pid="cargo_pack"),
        asm.attach(lib, trk, "top_studs", "char_legs_seated", "under_sockets", parent_cell=(1, 0), child_cell=(0, 0), pid="driver_legs"),
        asm.place_on_axis(lib, trk, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
    ]
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, trk, bore_id, "shaft_tu05", "axis", along=(W_tun - L_shaft5) / 2, pid=f"ax_{tag}")
        wl = asm.place_on_axis(lib, ax, "axis", "veh_wheel_offroad", "hub", along=0.0, pid=f"wl_{tag}")
        wr = asm.place_on_axis(lib, ax, "axis", "veh_wheel_offroad", "hub", along=L_shaft5 - 14.0, pid=f"wr_{tag}")
        b_trk.extend([ax, wl, wr])
    results.append(("hauler_truck_v2_covers_and_offroad_wheels", asm.validate(lib, b_trk)))

    # 5. V2 True 2-Wheel Inline Motor Scooter (`veh_scooter_frame` + `veh_scooter_fairing` + 2x inline `veh_wheel_moto`)
    sc = asm.place("veh_scooter_frame", pid="scooter")
    L_rax = 37.5
    b_sc = [
        sc,
        asm.attach(lib, sc, "fairing_studs", "veh_scooter_fairing", "under_sockets", pid="fairing"),
        asm.attach(lib, sc, "seat_studs", "char_legs_seated", "under_sockets", pid="rider_legs"),
        asm.attach(lib, sc, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
        asm.place_on_axis(lib, sc, "headtube", "veh_handlebar_fork", "axis", along=0.0, pid="handlebars"),
    ]
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, sc, bore_id, "racer_axle", "axis", along=0.0, pid=f"ax_{tag}")
        wm = asm.place_on_axis(lib, ax, "axis", "veh_wheel_moto", "hub", along=(L_rax - 14.0) / 2, pid=f"wm_{tag}")
        b_sc.extend([ax, wm])
    results.append(("motor_scooter_v2_inline_2wheel", asm.validate(lib, b_sc)))

    # 6. V2 True 2-Wheel Sport Motorbike (`veh_scooter_frame` + `veh_scooter_fairing` + `veh_moto_cowling` + `glow_capsule`)
    cowling = asm.attach(lib, sc, "top_studs", "veh_moto_cowling", "under_sockets", pid="moto_cowling")
    b_moto = list(b_sc) + [
        cowling,
        asm.attach(lib, cowling, "tank_studs", "glow_capsule", "under_sockets", pid="tank_pod"),
    ]
    results.append(("sport_motorbike_v2_inline_2wheel", asm.validate(lib, b_moto)))

    # 7. Skateboard Deck + Wave 6 `racer_axle` + `racer_wheel`
    sk = asm.place("prop_skateboard_deck", pid="deck")
    W_sk = 24.6
    b_sk = [sk]
    for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
        ax = asm.place_on_axis(lib, sk, bore_id, "racer_axle", "axis", along=(W_sk - L_rax) / 2, pid=f"ax_{tag}")
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

    print(f"=== Evaluating {len(KIP_PARTS)} Wave 9 Kip Wardrobe, Wheel & V2 Vehicle Parts through PartSpec v2 Gate ===")
    for part in KIP_PARTS:
        entry, tm, blocking_fail, small = tp.evaluate(part, validator)
        verified = entry["design_status"] == "verified"
        all_ok &= verified and (not blocking_fail)
        tm.export(stl_out_dir / entry["file"])
        entries.append(entry)
        warns = [c["id"] for c in entry["checks"] if c["result"] == "fail" and tp.level_of(c["id"]) == "warn"]
        tag = "PASS" if verified else "FAIL"
        print(
            f"{tag:4s}  {entry['file']:42s} status={entry['design_status']:18s} "
            f"bbox={entry['bbox_mm']}  small={small['status']}({small['margin_pct']:+.1f}%)  warn={warns}"
        )
        for c in blocking_fail:
            print(f"      BLOCKING FAIL: {c['id']} -> {c['detail']}")
        if not verified and not blocking_fail:
            print(f"      MARGINAL SMALL-PART: {small}")

    _export_visual_overlays(stl_out_dir)

    # Sync shared Wave 2-8 PartSpec STLs used by the 3D Kip viewer
    man_src = PARTSPEC_DIR / "out" / "toyventor_parts.json"
    if not man_src.exists():
        man_src = PARTSPEC_DIR / "toyventor_parts.json"
    if man_src.exists():
        by_id = {p["id"]: p for p in json.loads(man_src.read_text())["parts"]}
        for sid in SHARED_VIEWER_IDS:
            p = by_id.get(sid)
            if p and p.get("file"):
                src_stl = PARTSPEC_DIR / "out" / p["file"]
                if src_stl.exists():
                    shutil.copy2(src_stl, stl_out_dir / p["file"])

    print("\n=== Validating Multi-Part Assemblies via toyventor_assembly.validate() ===")
    asm_results = verify_assemblies(entries)
    for name, res in asm_results:
        all_ok &= res["ok"] and (not res["warnings"])
        print(f"{'PASS' if (res['ok'] and not res['warnings']) else 'FAIL':4s}  assembly:{name:44s} edges={len(res['edges'])} warnings={len(res['warnings'])}")
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
    print(f"\nExported {len(entries)} W9 STLs + two-tone visual overlays -> {stl_out_dir} and manifest -> {manifest_out}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
