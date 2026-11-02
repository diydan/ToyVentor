#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""ToyVentor Kip LLM Part-Maker SDK (Full PartSpec v2 Conformance Edition).

Gives any LLM (or human creator) 6 high-level, drift-proof Python builders on top of
`parts/partspec/toyventor_parts.py` & `toyventor_pro.py` so custom heads, crown add-ons,
backpacks, handheld props, and vehicle add-ons pass `tp.evaluate()` (`design_status == "verified"`)
and `toyventor_assembly.validate()` on the first try — without hardcoding `interfaces.json` numbers!

Usage inside an LLM-generated part file (`my_part.py`):
    from kip_partspec_sdk import *

    def build():
        cone = loft_slabs([
            (0.0, 22.0, 11.0, 4.5),
            (8.0, 26.0, 18.0, 6.5),
            (22.0, 8.0, 8.0, 3.5),
        ])
        return crown_addon(cone)

    PART = part_spec(
        id="custom_wizard_hat",
        name="Starlight Wizard Hat",
        stat="Glow",
        behavior="Pointed wizard hat that clicks onto any 2x1 character crown",
        slot="crown",
        fn=build,
    )

    if __name__ == "__main__":
        run_cli(PART)
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Callable

import numpy as np
from jsonschema import Draft202012Validator
from manifold3d import CrossSection, JoinType, Manifold

SDK_DIR = Path(__file__).resolve().parent
KIP_DIR = SDK_DIR.parent
PARTSPEC_DIR = KIP_DIR.parent / "partspec"
for _p in (str(PARTSPEC_DIR), str(KIP_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import kip_partspec as kp  # noqa: E402
import toyventor_assembly as asm  # noqa: E402
import toyventor_parts as tp  # noqa: E402
import toyventor_pro as pro  # noqa: E402

VALID_STATS = ("Speed", "Spin", "Torque", "Glow")
FORBIDDEN_BRAND_RE = re.compile(
    r"\b(lego|duplo|technic|bionicle|meccano|playmobil|knex|k'nex|megabloks|mega\s*bloks)\b",
    re.IGNORECASE,
)

VEHICLE_SLOTS: dict[str, tuple[tuple[int, int], str, str]] = {
    # slot_name -> (grid, parent_part_id, parent_conn_id)
    "front": ((2, 1), "veh_car_chassis", "front_studs"),
    "hood": ((2, 2), "veh_car_chassis", "hood_studs"),
    "roof": ((2, 2), "veh_truck_chassis", "roof_studs"),
    "rollbar": ((2, 1), "veh_car_chassis", "rollbar_studs"),
    "spoiler": ((2, 1), "veh_car_chassis", "spoiler_studs"),
    "exhaust": ((1, 2), "veh_car_chassis", "exhaust_studs"),
}


# ---------------------------------------------------------------------------
# Ergonomic 3D & 2D shape helpers (all coordinates in mm; -Y is FRONT, +Z is UP)
# ---------------------------------------------------------------------------
def rounded_slab(
    w: float, d: float, h: float, r: float = 4.0, z: float = 0.0, x: float = 0.0, y: float = 0.0
) -> Manifold:
    """Rounded-rectangle slab `w x d x h` in mm, bottom at `z`, centred at `(x, y)`."""
    return kp._rr(w, d, r, h, z=z, x=x, y=y)


sequential_socket_cutter = tp.sequential_socket_cutter
teardrop_bore_cutter = tp.teardrop_bore_cutter


def clamp_layflat_bed(body: Manifold, floor_y: float = -2.50) -> Manifold:
    """Ensure a 3D `LAY_FLAT` (`[90, 0, 0]`) sub-body seats coplanar with the grip shaft bed plane (`y = floor_y`).

    Prevents secondary stems or heads from hovering `0.2..1.5 mm` above `z_print = 0` (Orca floating cantilever).
    """
    bb = body.bounding_box()
    min_y = float(bb[1])
    if min_y < floor_y - 1e-4:
        keep = Manifold.cube((400.0, 400.0, 400.0)).translate((-200.0, floor_y, -200.0))
        return body ^ keep
    if 0.05 < (min_y - floor_y) <= 0.85:
        return body.translate((0.0, floor_y - min_y, 0.0))
    return body


def loft_slabs(slices: list[tuple], Thickness: float = 0.8) -> Manifold:
    """Smooth convex loft through `[(z, w, d, r)` or `(z, w, d, r, x, y), ...]`."""
    slabs = []
    for s in slices:
        if len(s) == 4:
            z, w, d, r = s
            x, y = 0.0, 0.0
        elif len(s) == 6:
            z, w, d, r, x, y = s
        else:
            raise ValueError("Each slice in loft_slabs must be (z, w, d, r) or (z, w, d, r, x, y)")
        slabs.append(rounded_slab(w, d, Thickness, r=r, z=z, x=x, y=y))
    return Manifold.batch_hull(slabs)


def sphere(r: float, center: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Manifold:
    return tp.sph(r, center)


def cylinder(h: float, r: float, z: float = 0.0, x: float = 0.0, y: float = 0.0) -> Manifold:
    return tp.cyl(h, r, z=z, x=x, y=y)


def union(parts: list[Manifold]) -> Manifold:
    return tp.union(parts)


def hull(parts: list[Manifold]) -> Manifold:
    return Manifold.batch_hull(parts)


def polygon_2d(points_xz: list[tuple[float, float]], fillet_r: float = 1.2) -> CrossSection:
    """2D CrossSection in (x, z) with rounded corners, ready for `handheld_prop()`."""
    cs = CrossSection([np.array(points_xz, dtype=float)])
    if fillet_r > 0:
        shrunk = cs.offset(-fillet_r, JoinType.Round)
        if not shrunk.is_empty():
            return shrunk.offset(fillet_r, JoinType.Round)
    return cs


def star_2d(
    points: int = 5, r_outer: float = 17.5, r_inner: float = 9.2, center_z: float = 0.0, fillet_r: float = 1.4
) -> CrossSection:
    """Rounded N-point star CrossSection centred at `(0, center_z)`."""
    verts = []
    for k in range(points * 2):
        ang = math.radians(90 + k * (180.0 / points))
        r = r_outer if k % 2 == 0 else r_inner
        verts.append((r * math.cos(ang), center_z + r * math.sin(ang)))
    return polygon_2d(verts, fillet_r=fillet_r)


def flare_from_pad(
    body: Manifold,
    base_manifold: Manifold,
    z_cut: float = 1.0,
    *,
    support_policy: str = "none",
    min_overhang_z: float = 3.8,
) -> Manifold:
    """Trim `body` to a support-free 41 deg flare (`none`) or protect only `< min_overhang_z` (`minimal`)."""
    flared = tp.flare_clip(body, base_manifold.slice(z_cut), z_cut)
    if support_policy != "minimal":
        return base_manifold + flared
    low_box = Manifold.cube((240.0, 240.0, min_overhang_z + 10.0)).translate((-120.0, -120.0, -10.0))
    high_box = Manifold.cube((240.0, 240.0, 240.0)).translate((-120.0, -120.0, min_overhang_z))
    return base_manifold + (flared ^ low_box) + (body ^ high_box)


def wide_brim(
    width_mm: float = 36.0,
    depth_mm: float = 25.0,
    *,
    thickness_mm: float = 2.2,
    z: float = 0.0,
) -> Manifold:
    """Minimal-support hat brim: 45 deg self-supporting inner collar clearing the `2x1` pad edge,
    then a flat `-Z` build-plate-reachable underside shelf and domed `+Z` show top.
    """
    w = max(26.4, min(42.0, float(width_mm)))
    d = max(14.8, min(32.0, float(depth_mm)))
    t = max(1.6, min(4.0, float(thickness_mm)))
    # Inner 45 deg bevel starts buried in the 2x1 crown pad (`z - 1.1`) and flares past `(24.6, 12.1)`
    # to `(26.0, 13.6)` at `z + 0.2`, so 100% of the flat `-Z` brim ring sits over open build plate!
    collar = Manifold.batch_hull(
        [
            rounded_slab(23.4, 11.0, 0.2, r=5.2, z=z - 1.1),
            rounded_slab(min(w, 26.0), min(d, 13.8), 0.2, r=6.2, z=z + 0.2),
        ]
    )
    r_outer = min(w, d) * 0.42
    r_top = min(w - 3.0, d - 3.0) * 0.42
    brim = Manifold.batch_hull(
        [
            rounded_slab(w, d, max(0.8, t * 0.45), r=r_outer, z=z + 0.2),
            rounded_slab(w - 3.2, d - 3.2, 0.6, r=r_top, z=z + 0.2 + t - 0.6),
        ]
    )
    return collar + brim


# ---------------------------------------------------------------------------
# The 6 Drift-Proof Conforming Builders
# ---------------------------------------------------------------------------
def crown_addon(
    body_above_pad: Manifold,
    *,
    lock: bool = True,
    support_policy: str = "none",
) -> tuple[Manifold, list[dict], dict]:
    """Build a `2x1` Small-stud Crown add-on (hairs, hats, horns, helmets, crests).

    `body_above_pad` is authored with `z = 0` at the top of the `2x1` crown pad (`fh` offset is applied
    automatically!). With `support_policy='none'`, trimmed with `tp.flare_clip`; with `support_policy='minimal'`,
    keeps the `< 3.2 mm` socket seat protected while allowing wide brims/visors/ears above `z = 3.2 mm`.
    """
    size = "small"
    _, fh, foot = kp._crown_pad_2x1(size)
    z0 = fh - 0.5
    shifted = body_above_pad.translate((0.0, 0.0, z0))
    flared = tp.flare_clip(shifted, foot.slice(z0), z0)
    if support_policy == "minimal":
        low_box = Manifold.cube((240.0, 240.0, 13.2)).translate((-120.0, -120.0, -10.0))
        high_box = Manifold.cube((240.0, 240.0, 240.0)).translate((-120.0, -120.0, 3.2))
        clipped = (flared ^ low_box) + (shifted ^ high_box)
    else:
        clipped = flared
    return tp._finish(size, (2, 1), foot, lock, clipped, fh, "integrated")


def character_head(
    body: Manifold,
    *,
    height_mm: float = 30.5,
    support_policy: str = "none",
) -> tuple[Manifold, list[dict], dict]:
    """Build a Universal Swappable Head (`2x1` neck sockets + mandatory `#FF6B4A` `2x1` Crown Buds).

    Conforms to `BRAND_STYLE.md`:
      - Back face automatically clipped at `y <= +6.15 mm` to clear backpacks!
      - Crown studs placed at `(x = +/-6.25, y = 0, z = height_mm)`.
      - Do NOT carve moulded 3D eyes/mouths; leave the `-Y` front face smooth for decal skins.
    """
    size = "small"
    hx, hy = kp._half(size, 2), kp._half(size, 1)
    collar = rounded_slab(2 * hx, 2 * hy, 1.2, r=3.2, z=0.0)
    # Keep rear clear of backpack row (y <= hy) and trim z <= height_mm flat crown seat
    keep_box = Manifold.cube((120.0, 80.0 + hy, height_mm)).translate((-60.0, -80.0, 0.0))
    shaped = flare_from_pad(body ^ keep_box, collar, z_cut=1.0, support_policy=support_policy)
    m, conns, ex = tp.integrated_sockets(shaped, size, True)
    m, c_top = kp.add_studs_at(m, size, 2, 1, 0.0, 0.0, height_mm, "top_studs")
    return m, conns + [c_top], ex


def backpack_addon(
    body_above_pad: Manifold,
    *,
    grid: tuple[int, int] = (2, 2),
    top_studs_z: float | None = None,
    support_policy: str = "none",
) -> tuple[Manifold, list[dict], dict]:
    """Build a `2x2` (or `2x1`) Snap Backpack add-on with optional top `2x1` accessory studs."""
    size = "small"
    hx, hy = kp._half(size, grid[0]), kp._half(size, grid[1])
    base = rounded_slab(2 * hx, 2 * hy, 2.0, r=4.8, z=0.0)
    shaped = flare_from_pad(body_above_pad, base, z_cut=1.0, support_policy=support_policy)
    m, conns, ex = tp.integrated_sockets(shaped, size, True)
    if top_studs_z is not None:
        m, c_top = kp.add_studs_at(m, size, 2, 1, 0.0, 0.0, top_studs_z, "pack_top_studs")
        conns.append(c_top)
    return m, conns, ex


def handheld_prop(
    head_2d_or_3d: CrossSection | Manifold, *, grip_tu: int = 2, crest_height_mm: float = 1.6
) -> tuple[Manifold, list[dict], dict]:
    """Build a handheld prop on a Ø6.60 mm `flats` Pro grip shaft (`LAY_FLAT`, fits Kip's C-grip hand).

    Pass a 2D `CrossSection` in `(x, z)` drawn around `z >= 0` (it is automatically translated above
    the unobstructed `grip_tu * 12.5 mm` grip shaft and joined with a sturdy neck!).
    """
    L = grip_tu * pro.TU
    hy = pro.BORE["shaft_flats"] / 2  # 2.50 mm
    grip = pro.pin_solid("flats", L + 5.0, tip_chamfer=(True, False))

    if isinstance(head_2d_or_3d, CrossSection):
        bx0, bz0, bx1, bz1 = head_2d_or_3d.bounds()
        cx = 0.5 * (bx0 + bx1)
        # Auto-align 2D shape so X is centered and bottom (bz0) meets the grip neck cleanly -> 1 body guaranteed!
        aligned_head = head_2d_or_3d.translate((-cx, (L + 3.0) - bz0))
        mid_z = (L + 3.0) + 0.35 * (bz1 - bz0)
        neck_h = max(8.0, mid_z - (L + 0.5))
        neck_cs = CrossSection.square((6.4, neck_h), center=True).translate((0.0, L + 0.5 + neck_h * 0.5))
        shifted_cs = (aligned_head + neck_cs).offset(-0.8, JoinType.Round).offset(0.8, JoinType.Round)
        plate = kp._xz_to_layflat(shifted_cs, hy)
        m = grip + plate
        if crest_height_mm > 0.2:
            inner_cs = aligned_head.offset(-2.4, JoinType.Round)
            if not inner_cs.is_empty():
                # Extrude upward (+Y_asm -> +Z_print) with bottom cap buried inside plate -> zero ledges on concave shapes!
                crest = Manifold.extrude(inner_cs, crest_height_mm + 1.0).rotate((90, 0, 0)).translate(
                    (0.0, hy + crest_height_mm, 0.0)
                )
                m = m + crest
    else:
        m = grip + clamp_layflat_bed(head_2d_or_3d.translate((0.0, 0.0, L + 1.0)), floor_y=-hy)

    conn = pro._pin_conn("shaft_drive", "flats", L)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def vehicle_addon(
    body_above_pad: Manifold, *, slot: str = "hood", lock: bool = True, top_studs_z: float | None = None
) -> tuple[Manifold, list[dict], dict]:
    """Build a Snap add-on for any modular vehicle port (`front`, `hood`, `roof`, `rollbar`, `spoiler`, `exhaust`)."""
    if slot not in VEHICLE_SLOTS:
        raise ValueError(f"Unknown vehicle slot '{slot}'. Expected one of {sorted(VEHICLE_SLOTS)}")
    grid, _, _ = VEHICLE_SLOTS[slot]
    size = "small"
    pads = [((i + 0.5 - grid[0] / 2), (j + 0.5 - grid[1] / 2)) for i in range(grid[0]) for j in range(grid[1])]
    _, fh, foot = tp._foot(size, grid, "integrated", pad=pads)
    z0 = fh - 0.5
    shifted = body_above_pad.translate((0.0, 0.0, z0))
    clipped = tp.flare_clip(shifted, foot.slice(z0), z0)
    m, conns, ex = tp._finish(size, grid, foot, lock, clipped, fh, "integrated")
    if top_studs_z is not None:
        m, c_top = kp.add_studs_at(m, size, grid[0], 1, 0.0, 0.0, z0 + top_studs_z, "addon_top_studs")
        conns.append(c_top)
    return m, conns, ex


# ---------------------------------------------------------------------------
# Spec Constructor + Full PartSpec v2 Gate + Reference Assembly Validator
# ---------------------------------------------------------------------------
def part_spec(
    *,
    id: str,
    name: str,
    stat: str,
    behavior: str,
    slot: str,
    fn: Callable[[], tuple[Manifold, list[dict], dict]],
    tags: list[str] | None = None,
    support_policy: str = "none",
) -> dict:
    """Create a normalized PartSpec dictionary ready for `validate_and_export()`."""
    is_pro = slot == "hand"
    norm_policy = "minimal" if (support_policy == "minimal" and slot in ("crown", "head", "back")) else "none"
    return {
        "id": id,
        "name": name,
        "type": f"Custom {slot} part",
        "line": "pro" if is_pro else "snap",
        "family": "shaft" if is_pro else "addon",
        "size": "pro" if is_pro else "small",
        "stat": stat,
        "behavior": behavior,
        "slot": slot,
        "support_policy": norm_policy,
        "tags": tags or ["custom", "llm", slot, "kip"],
        "fn": fn,
        "cavity": None,
        "ref": None,
        "kind": None,
    }


def validate_and_export(
    spec: dict,
    out_dir: str | Path | None = None,
    *,
    optimize: bool = True,
    export_web_on_fail: bool = False,
) -> dict:
    """Run the full PartSpec v2 gate + brand rules + real reference assembly test on `spec`."""
    brand_errors: list[str] = []
    for field in ("id", "name", "behavior"):
        m = FORBIDDEN_BRAND_RE.search(str(spec.get(field, "")))
        if m:
            brand_errors.append(f"Forbidden third-party brand term '{m.group(0)}' in {field}")
    if spec.get("stat") not in VALID_STATS:
        brand_errors.append(f"Invalid stat '{spec.get('stat')}': must be one of {VALID_STATS}")

    validator = Draft202012Validator(tp.SCHEMA)
    entry, tm, blocking_fail, small = tp.evaluate(spec, validator)

    # Test real attachment onto a reference ToyVentor parent using `toyventor_assembly.validate()`!
    asm_report = {"ok": True, "parent": None, "errors": [], "warnings": [], "edges": 0}
    base_manifest_path = PARTSPEC_DIR / "out" / "toyventor_parts.json"
    if not base_manifest_path.exists():
        base_manifest_path = PARTSPEC_DIR / "toyventor_parts.json"
    if base_manifest_path.exists():
        base_man = json.loads(base_manifest_path.read_text())
        dedup_parts = {p["id"]: p for p in base_man["parts"]}
        kip_manifest_path = KIP_DIR.parent.parent / "public" / "kip" / "kip-partspec-manifest.json"
        if not kip_manifest_path.exists():
            kip_manifest_path = KIP_DIR / "kip-partspec-manifest.json"
        if kip_manifest_path.exists():
            for kp_entry in json.loads(kip_manifest_path.read_text()).get("parts", []):
                dedup_parts[kp_entry["id"]] = kp_entry
        dedup_parts[entry["id"]] = entry
        combined = {
            "standard": base_man["standard"],
            "version": base_man["version"],
            "status": base_man["status"],
            "units": "mm",
            "parts": list(dedup_parts.values()),
        }
        out_tmp_dir = PARTSPEC_DIR / "out"
        out_tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = out_tmp_dir / f"_llm_check_{spec['id']}.json"
        tmp_path.write_text(json.dumps(combined))
        builders = {p["id"]: p["fn"] for p in kp.KIP_PARTS}
        builders[spec["id"]] = spec["fn"]
        lib = asm.Library(tmp_path, builders=builders)
        try:
            slot = spec.get("slot", "crown")
            if slot == "crown":
                parent = asm.place("char_head_kid", pid="ref_head")
                child = asm.attach(lib, parent, "top_studs", spec["id"], "under_sockets", pid="custom")
                res = asm.validate(lib, [parent, child])
                asm_report = {"ok": res["ok"], "parent": "char_head_kid.top_studs", "errors": res["errors"], "warnings": res["warnings"], "edges": len(res["edges"])}
            elif slot == "head":
                parent = asm.place("robot_arms_grabber", pid="ref_body")
                child = asm.attach(lib, parent, "top_studs", spec["id"], "under_sockets", parent_cell=(0, 0), child_cell=(0, 0), pid="custom")
                res = asm.validate(lib, [parent, child])
                asm_report = {"ok": res["ok"], "parent": "robot_arms_grabber.top_studs", "errors": res["errors"], "warnings": res["warnings"], "edges": len(res["edges"])}
            elif slot == "back":
                parent = asm.place("mini_plate", pid="ref_plate")
                child = asm.attach(lib, parent, "top_studs", spec["id"], "under_sockets", parent_cell=(1, 0), child_cell=(0, 0), pid="custom")
                res = asm.validate(lib, [parent, child])
                asm_report = {"ok": res["ok"], "parent": "mini_plate.top_studs", "errors": res["errors"], "warnings": res["warnings"], "edges": len(res["edges"])}
            elif slot == "hand":
                parent = asm.place("beam_str_tu03", pid="ref_beam")
                child = asm.place_on_axis(lib, parent, "bores", spec["id"], "axis", along=0.0, pid="custom", parent_cell=(1, 0))
                res = asm.validate(lib, [parent, child])
                asm_report = {"ok": res["ok"], "parent": "beam_str_tu03.bores", "errors": res["errors"], "warnings": res["warnings"], "edges": len(res["edges"])}
            elif slot in VEHICLE_SLOTS:
                _, p_part, p_conn = VEHICLE_SLOTS[slot]
                parent = asm.place(p_part, pid="ref_vehicle")
                child = asm.attach(lib, parent, p_conn, spec["id"], "under_sockets", pid="custom")
                res = asm.validate(lib, [parent, child])
                asm_report = {"ok": res["ok"], "parent": f"{p_part}.{p_conn}", "errors": res["errors"], "warnings": res["warnings"], "edges": len(res["edges"])}
        finally:
            tmp_path.unlink(missing_ok=True)

    slot_name = str(spec.get("slot") or "")
    support_policy = (
        "minimal"
        if spec.get("support_policy") == "minimal" and slot_name in ("crown", "head", "back")
        else "none"
    )
    non_overhang_fail = [
        c for c in blocking_fail if c["id"] not in ("P1_no_supports", "P4_no_ledges")
    ]
    scripts_dir = str(KIP_DIR.parent.parent / "scripts")

    if (
        support_policy == "minimal"
        and blocking_fail
        and not non_overhang_fail
        and small["status"] != "marginal"
        and not brand_errors
        and asm_report["ok"]
    ):
        # Verify minimal-support eligibility (`M1` socket keep-out, `M2` underside cap, `M3` build-plate LOS)
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        import io
        import optimize_assets  # type: ignore

        chk_buf = io.BytesIO()
        tm.export(chk_buf, file_type="stl")
        m_chk, v_chk, f_chk, _ = optimize_assets._resolve_source_manifold(
            part_id=spec["id"],
            stl_bytes=chk_buf.getvalue(),
        )
        m_chk = optimize_assets.snap_manifold_to_bed(m_chk)
        v_chk, f_chk = optimize_assets.manifold_to_arrays(m_chk)
        min_errs = optimize_assets._check_minimal_support_eligibility(
            v_chk, f_chk, m_chk, slot=slot_name
        )
        if not min_errs:
            blocking_fail = []
            entry["print"]["supports"] = True
            entry["design_status"] = "verified"
        else:
            for me in min_errs:
                blocking_fail.append(
                    {"id": "M_minimal_support", "level": "block", "result": "fail", "detail": me}
                )

    ok = (
        entry["design_status"] == "verified"
        and not blocking_fail
        and not brand_errors
        and asm_report["ok"]
    )

    stl_path = None
    glb_path = None
    manifest_path = None
    opt_summary = None

    if out_dir is not None and ok:
        out_p = Path(out_dir)
        out_p.mkdir(parents=True, exist_ok=True)
        stl_path = out_p / entry["file"]
        manifest_path = out_p / f"{spec['id']}.partspec.json"
        if optimize:
            import io

            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            import optimize_assets  # type: ignore

            raw_buf = io.BytesIO()
            tm.export(raw_buf, file_type="stl")
            glb_path = out_p / f"{spec['id']}.glb"
            opt = optimize_assets.optimize_single_part(
                spec["id"],
                stl_bytes=raw_buf.getvalue(),
                out_stl_path=stl_path,
                out_glb_path=glb_path,
                slot=spec.get("slot"),
                support_policy=support_policy,
                validation_dir=PARTSPEC_DIR / "validation",
                verify_preprint=True,
                partspec_dir=PARTSPEC_DIR,
            )
            if not opt["print_ok"]:
                ok = False
                stl_path = None
                for pf in opt["preprint_failures"]:
                    blocking_fail.append(
                        {
                            "id": "V_post_simplify_preprint",
                            "level": "block",
                            "result": "fail",
                            "detail": pf,
                        }
                    )
                if not export_web_on_fail and glb_path.exists():
                    glb_path.unlink(missing_ok=True)
                    glb_path = None
            else:
                opt_summary = {
                    "content_hash": opt["content_hash"],
                    "finish_class": opt["finish_class"],
                    "print_simplify_mm": opt["print_simplify_mm"],
                    "web_simplify_mm": opt["web_simplify_mm"],
                    "web_crease_deg": opt["web_crease_deg"],
                    "metrics": opt["metrics"],
                }
                entry["glb_file"] = glb_path.name
                entry["print"]["slicer_recipe"] = opt["slicer_recipe"]
                entry["asset_optimization"] = opt_summary
                manifest_path.write_text(json.dumps(entry, indent=2) + "\n")
        else:
            tm.export(stl_path)
            manifest_path.write_text(json.dumps(entry, indent=2) + "\n")
    elif out_dir is not None and not ok and export_web_on_fail:
        # Digital-only graceful degradation: emit quantized Web GLB preview without unlocking print STL.
        out_p = Path(out_dir)
        out_p.mkdir(parents=True, exist_ok=True)
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        import io
        import optimize_assets  # type: ignore

        buf = io.BytesIO()
        tm.export(buf, file_type="stl")
        glb_path = out_p / f"{spec['id']}.glb"
        fast = optimize_assets.build_fast_preview_glb(
            spec["id"],
            stl_bytes=buf.getvalue(),
            slot=spec.get("slot"),
            out_glb_path=glb_path,
        )
        opt_summary = {
            "finish_class": fast["finish_class"],
            "web_simplify_mm": fast["web_simplify_mm"],
            "web_crease_deg": fast["web_crease_deg"],
            "metrics": {
                "orig_tris": fast["orig_tris"],
                "web_verts": fast["web_verts"],
                "web_tris": fast["web_tris"],
                "glb_bytes": fast["glb_size"],
            },
        }

    # Spatial self-repair diagnostics (exact 3D print-frame coordinates for LLM retry loops)
    import preprint_check as ppc
    import toyventor_ledge as tl
    from manifold3d import Mesh as _ManiMesh

    repair_hints: dict = {}
    n_f, c_f, a_f = tm.face_normals, tm.triangles_center, tm.area_faces
    steep_mask = (n_f[:, 2] < -math.sin(math.radians(tp.LIM["max_overhang_deg"]))) & (n_f[:, 2] >= -0.98) & (c_f[:, 2] > tp.LIM["first_layer_exclusion_mm"])
    if steep_mask.any():
        worst_idx = int(np.where(steep_mask)[0][np.argmax(a_f[steep_mask])])
        pts_s = c_f[steep_mask]
        repair_hints["steep_overhang"] = {
            "total_area_mm2": round(float(a_f[steep_mask].sum()), 2),
            "worst_face_at_mm": [round(float(v), 2) for v in c_f[worst_idx]],
            "region_bbox_mm": [pts_s.min(axis=0).round(2).tolist(), pts_s.max(axis=0).round(2).tolist()],
        }
    if tm.is_watertight:
        mp_mani = Manifold(_ManiMesh(vert_properties=np.asarray(tm.vertices, dtype=np.float32), tri_verts=np.asarray(tm.faces, dtype=np.uint32)))
        if mp_mani.status().name == "NoError" and not mp_mani.is_empty():
            _, l_regs = tl.ledges(tm, mp_mani, tp.LIM["max_bridge_mm"], tp.LIM["first_layer_exclusion_mm"])
            if l_regs:
                repair_hints["ledges"] = l_regs[:3]
            fc_regs = tl.floating_contours(tm, mp_mani, tp.LIM["max_bridge_mm"], tp.LIM["first_layer_exclusion_mm"])
            if fc_regs:
                repair_hints["floating_contours"] = fc_regs[:3]
        thin_regs = [r for r in ppc.thin_regions(tm, tp.LIM["min_wall_mm"]) if r["area_mm2"] >= 2.0 or (r["min_mm"] < 0.4 and r["area_mm2"] >= 0.25)]
        if thin_regs:
            repair_hints["thin_walls"] = thin_regs[:3]
            if support_policy != "minimal":
                # Also surface floating_contours as a blocking check for custom LLM parts
                pass
    if repair_hints.get("floating_contours") and support_policy != "minimal":
        fc0 = repair_hints["floating_contours"][0]
        fc_check = {
            "id": "V11_floating_contour",
            "level": "block",
            "result": "fail",
            "detail": f"{len(repair_hints['floating_contours'])} floating contour(s); first ({fc0['kind']}) at z {fc0['z_mm']} mm near {fc0['at_mm']}",
        }
        entry["checks"].append(fc_check)
        blocking_fail.append(fc_check)
        ok = False

    return {
        "ok": ok,
        "id": spec["id"],
        "slot": spec.get("slot"),
        "design_status": entry["design_status"],
        "bbox_mm": entry["bbox_mm"],
        "volume_cm3": entry["volume_cm3"],
        "small_part": small,
        "blocking_failures": blocking_fail,
        "repair_hints": repair_hints,
        "brand_errors": brand_errors,
        "assembly": asm_report,
        "stl_file": str(stl_path) if stl_path else entry["file"],
        "glb_file": str(glb_path) if glb_path else None,
        "manifest_file": str(manifest_path) if manifest_path else None,
        "slicer_recipe": entry.get("print", {}).get("slicer_recipe"),
        "optimization": opt_summary,
        "entry": entry,
    }


def run_cli(spec: dict) -> None:
    parser = argparse.ArgumentParser(description="Validate and export a conforming ToyVentor LLM part.")
    parser.add_argument("--out", default=str(KIP_DIR.parent.parent / "public" / "kip" / "custom"), help="Output directory for verified STL, GLB & manifest")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON summary")
    parser.add_argument("--no-optimize", action="store_true", help="Skip print STL + quantized Web GLB optimization")
    args = parser.parse_args()

    res = validate_and_export(spec, out_dir=args.out, optimize=not args.no_optimize)
    if args.json:
        slim = {k: v for k, v in res.items() if k != "entry"}
        print(json.dumps(slim, indent=2))
    else:
        verdict = "VERIFIED (CONFORMING)" if res["ok"] else "NEEDS FIX"
        print(f"[{verdict}] {res['id']} (slot={res['slot']})  bbox={res['bbox_mm']} mm  small={res['small_part']['status']} ({res['small_part']['margin_pct']:+.1f}%)")
        if res["brand_errors"]:
            for err in res["brand_errors"]:
                print(f"  BRAND FAIL: {err}")
        for c in res["blocking_failures"]:
            print(f"  GATE FAIL:  {c['id']} -> {c['detail']}")
        if res["small_part"]["status"] == "marginal":
            print("  SIZE FAIL:  S1_small_part_screen is 'marginal' (within 0..10% above 31.75 mm cylinder). Make < 30 mm or > 36 mm.")
        if not res["assembly"]["ok"]:
            for err in res["assembly"]["errors"]:
                print(f"  ASM FAIL:   {err}")
        if res["ok"]:
            print(f"  ASM OK:     Mated cleanly with {res['assembly']['parent']} ({res['assembly']['edges']} edge(s), 0 collisions)")
            print(f"  EXPORTED:   {res['stl_file']}")
            if res.get("glb_file") and res.get("optimization"):
                m = res["optimization"]["metrics"]
                sr = res.get("slicer_recipe") or {}
                print(
                    f"  OPTIMIZED:  STL {m['orig_bytes'] / 1024:.1f} -> {m['print_bytes'] / 1024:.1f} KB "
                    f"({m['orig_tris']} -> {m['print_tris']} tris) | "
                    f"GLB {m['glb_bytes'] / 1024:.1f} KB ({m['web_tris']} tris) | "
                    f"recipe {sr.get('layer_height_mm')}mm {sr.get('wall_order')} iron={sr.get('ironing')}"
                )
    sys.exit(0 if res["ok"] else 1)
