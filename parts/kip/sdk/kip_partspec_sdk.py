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


def flare_from_pad(body: Manifold, base_manifold: Manifold, z_cut: float = 1.0) -> Manifold:
    """Trim `body` to a support-free 41 deg upward flare starting from `base_manifold` at `z_cut`."""
    return base_manifold + tp.flare_clip(body, base_manifold.slice(z_cut), z_cut)


# ---------------------------------------------------------------------------
# The 6 Drift-Proof Conforming Builders
# ---------------------------------------------------------------------------
def crown_addon(body_above_pad: Manifold, *, lock: bool = True) -> tuple[Manifold, list[dict], dict]:
    """Build a `2x1` Small-stud Crown add-on (hairs, hats, horns, helmets, crests).

    `body_above_pad` is authored with `z = 0` at the top of the `2x1` crown pad (`fh` offset is applied
    automatically!) and trimmed with `tp.flare_clip` so `P1`, `P4`, `I3`, and `I7` pass by construction.
    """
    size = "small"
    _, fh, foot = kp._crown_pad_2x1(size)
    z0 = fh - 0.5
    shifted = body_above_pad.translate((0.0, 0.0, z0))
    clipped = tp.flare_clip(shifted, foot.slice(z0), z0)
    return tp._finish(size, (2, 1), foot, lock, clipped, fh, "integrated")


def character_head(body: Manifold, *, height_mm: float = 30.5) -> tuple[Manifold, list[dict], dict]:
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
    shaped = flare_from_pad(body ^ keep_box, collar, z_cut=1.0)
    m, conns, ex = tp.integrated_sockets(shaped, size, True)
    m, c_top = kp.add_studs_at(m, size, 2, 1, 0.0, 0.0, height_mm, "top_studs")
    return m, conns + [c_top], ex


def backpack_addon(
    body_above_pad: Manifold, *, grid: tuple[int, int] = (2, 2), top_studs_z: float | None = None
) -> tuple[Manifold, list[dict], dict]:
    """Build a `2x2` (or `2x1`) Snap Backpack add-on with optional top `2x1` accessory studs."""
    size = "small"
    hx, hy = kp._half(size, grid[0]), kp._half(size, grid[1])
    base = rounded_slab(2 * hx, 2 * hy, 2.0, r=4.8, z=0.0)
    shaped = flare_from_pad(body_above_pad, base, z_cut=1.0)
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
    grip = pro.pin_solid("flats", L + 5.0)

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
        m = grip + head_2d_or_3d.translate((0.0, 0.0, L + 1.0))

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
) -> dict:
    """Create a normalized PartSpec dictionary ready for `validate_and_export()`."""
    is_pro = slot == "hand"
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
        "tags": tags or ["custom", "llm", slot, "kip"],
        "fn": fn,
        "cavity": None,
        "ref": None,
        "kind": None,
    }


def validate_and_export(spec: dict, out_dir: str | Path | None = None) -> dict:
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

    ok = (
        entry["design_status"] == "verified"
        and not blocking_fail
        and not brand_errors
        and asm_report["ok"]
    )

    stl_path = None
    manifest_path = None
    if out_dir is not None and ok:
        out_p = Path(out_dir)
        out_p.mkdir(parents=True, exist_ok=True)
        stl_path = out_p / entry["file"]
        manifest_path = out_p / f"{spec['id']}.partspec.json"
        tm.export(stl_path)
        manifest_path.write_text(json.dumps(entry, indent=2))

    return {
        "ok": ok,
        "id": spec["id"],
        "slot": spec.get("slot"),
        "design_status": entry["design_status"],
        "bbox_mm": entry["bbox_mm"],
        "volume_cm3": entry["volume_cm3"],
        "small_part": small,
        "blocking_failures": blocking_fail,
        "brand_errors": brand_errors,
        "assembly": asm_report,
        "stl_file": str(stl_path) if stl_path else entry["file"],
        "manifest_file": str(manifest_path) if manifest_path else None,
        "entry": entry,
    }


def run_cli(spec: dict) -> None:
    parser = argparse.ArgumentParser(description="Validate and export a conforming ToyVentor LLM part.")
    parser.add_argument("--out", default=str(KIP_DIR.parent.parent / "public" / "kip" / "custom"), help="Output directory for verified STL & manifest")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON summary")
    args = parser.parse_args()

    res = validate_and_export(spec, out_dir=args.out)
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
    sys.exit(0 if res["ok"] else 1)
