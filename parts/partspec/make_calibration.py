#!/usr/bin/env python3
"""Calibration kit: turns the fit targets into measurements on one printer.

Each ladder is a row of 8 holes whose clearance steps up by 0.1 mm across (extra clearance D = -0.1, 0.0, ..., +0.6 mm).
Step 2 (D = 0) is the designed fit and carries a dimple. Step 1 is at the notched end.
The step that fits as intended gives the printer's surface offset: s = D / 4 (each surface grows by s, so the stud or shaft grows by 2s
across and the hole shrinks by 2s across). Set the slicer's XY / hole compensation to -s, then reprint a designed-fit part to confirm.

The holes reuse the catalog's own code (stud-hole size from interfaces.json, Pro bores from toyventor_pro.bore_cutter), so the ladder
tests what the parts will actually be. Outputs go to calibration/. Exit code is non-zero if any piece fails a print check.
"""
import json
import sys
from pathlib import Path

from manifold3d import Manifold

import toyventor_parts as tp
import toyventor_pro as pro
from toyventor_geom import rbox

HERE = Path(__file__).parent
STEPS = [round(-0.1 + 0.1 * k, 2) for k in range(8)]        # extra clearance across, mm
NOMINAL = STEPS.index(0.0)
TU = pro.TU
SEGS = 96


def marks(body, length, width, height, y_mark):
    """Notch the step-1 corner (vertical cut, prints clean) and dimple the designed-fit step."""
    notch = Manifold.cube((6, 6, height + 2), center=True).rotate((0, 0, 45)).translate((-length / 2, width / 2, height / 2))
    x_nom = -length / 2 + TU / 2 + NOMINAL * TU
    dimple = Manifold.sphere(1.2, 32).translate((x_nom, y_mark, height))
    return body - notch - dimple


def snap_ladder():
    p = tp.STUD["small"]
    L, W, H = 8 * TU, 2 * TU, p["plate_h"]
    depth = p["stud_h"] + 0.4                                   # same depth as an integrated base's stud hole
    body = rbox(L, W, H, p["edge_r"], p["bed_chamfer"])
    for k, d in enumerate(STEPS):
        r = (p["stud_d"] + p["fit"] + d) / 2                   # designed hole plus the step
        body = body - Manifold.cylinder(depth + 0.1, r, r, SEGS).translate((-L / 2 + TU / 2 + k * TU, TU / 2, H - depth))
    return marks(body, L, W, H, -TU / 2)


def stud_tester():
    """A 3 x 1 Small plate with one designed stud at the end; the rest is a handle."""
    p = tp.STUD["small"]
    body = tp.block("small", 3, 1, p["plate_h"], p["plate_top"], studs=False)
    return body + tp.stud(p).translate((-TU, 0, p["plate_h"]))


def pro_ladder():
    """Row y>0: fixed bores (test with a shaft). Row y<0: free bores (test with a free pin and a friction pin)."""
    L, W, H = 8 * TU, 2 * TU, pro.BEAM["section_tu"] * TU
    body = rbox(L, W, H, pro.BEAM["fillet_outer_mm"], pro.BEAM["bed_chamfer_mm"])
    saved = dict(pro.BORE)
    try:
        for k, d in enumerate(STEPS):
            x = -L / 2 + TU / 2 + k * TU
            pro.BORE["free_d"], pro.BORE["fixed_flats"] = saved["free_d"] + d, saved["fixed_flats"] + d
            body = body - pro.bore_cutter("fixed", H, x, TU / 2) - pro.bore_cutter("free", H, x, -TU / 2)
    finally:
        pro.BORE.clear()
        pro.BORE.update(saved)
    return marks(body, L, W, H, 0.0)


# ---------------------------------------------------------------- print-optimised experiment (cube cell + face plate)
RIB_W, RIB_BITE, CORE_GAP, PLUG_H, PLATE_T = 0.8, 0.25, 0.2, 4.0, 2.0


def cube_cell():
    """A 12.5 mm cube with a free bore through every face (sideways bores print as teardrops), so any face joins any face with
    the existing friction pin. Prints flat, no supports. Print two."""
    c = rbox(TU, TU, TU, 1.0, pro.BEAM["bed_chamfer_mm"])
    c = c - pro.bore_cutter("free", TU, 0.0, 0.0)
    for axis in ("x", "y"):
        c = c - pro.bore_cutter_axis("free", TU, (0.0, 0.0, TU / 2), axis)
    return c


def face_plate():
    """A smooth 12.5 mm face plate. Its plug grips a free bore by three crush ribs (0.8 mm wide, biting 0.25 mm into the bore wall),
    so it fits across printer error without calibration. Prints smooth face down: the visible face is the bed side."""
    plate = rbox(TU, TU, PLATE_T, 1.0, 0.4)
    R = pro.BORE["free_d"] / 2
    r0 = R - CORE_GAP
    core = Manifold.cylinder(PLUG_H - 0.8, r0, r0, SEGS) + Manifold.cylinder(0.8, r0, r0 - 0.6, SEGS).translate((0, 0, PLUG_H - 0.8))
    env = Manifold.cylinder(PLUG_H - 1.2, R + RIB_BITE, R + RIB_BITE, SEGS) + Manifold.cylinder(1.2, R + RIB_BITE, r0 - 0.6, SEGS).translate((0, 0, PLUG_H - 1.2))
    ribs = None
    for k in range(3):
        rib = Manifold.cube((R + RIB_BITE + 0.5 - (r0 - 0.3), RIB_W, PLUG_H)).translate((r0 - 0.3, -RIB_W / 2, 0)).rotate((0, 0, 120 * k))
        ribs = rib if ribs is None else ribs + rib
    plug = (core + (ribs ^ env)).translate((0, 0, PLATE_T - 0.01))
    return plate + plug


PIECES = {
    "toyventor_cal_snap_ladder.stl": (snap_ladder, "Snap stud-hole ladder, 8 steps"),
    "toyventor_cal_stud_tester.stl": (stud_tester, "One designed Small stud on a handle"),
    "toyventor_cal_pro_ladder.stl": (pro_ladder, "Pro ladder: fixed bores (top row) and free bores (bottom row), 8 steps"),
    "toyventor_cal_cube_cell.stl": (cube_cell, "Print-optimised experiment: cube cell with a hole in every face (print 2)"),
    "toyventor_cal_face_plate.stl": (face_plate, "Print-optimised experiment: face plate with a crush-rib plug (print 2)"),
}
FROM_CATALOG = {
    "toyventor_shaft_tu03_P.stl": "Shaft for the fixed-bore row",
    "toyventor_pin_free_P.stl": "Free pin for the free-bore row (should turn)",
    "toyventor_pin_friction_P.stl": "Friction pin for the free-bore row (should grip)",
}


def check(m):
    tm = tp.to_trimesh(m)
    steep, _ = tp.overhang_area(tm)
    lo, hi = tm.bounds
    bodies = len(tm.split(only_watertight=False))
    fails = [n for n, ok in (("not watertight", tm.is_watertight), ("not one body", bodies == 1), ("not on the bed", abs(lo[2]) < 1e-3),
                             (f"{steep:.1f} mm2 needs supports", steep < 1.0), ("too big for the bed", all((hi - lo) <= 180))) if not ok]
    return tm, fails


def main(out="calibration", src=None):
    out = Path(out) if Path(out).is_absolute() else HERE / out
    out.mkdir(parents=True, exist_ok=True)
    search_dirs = ([Path(src)] if src is not None else []) + [HERE, HERE / "out"]
    report, ok = [], True
    for name, (fn, what) in PIECES.items():
        tm, fails = check(fn())
        tm.export(out / name)
        ok &= not fails
        report.append({"file": name, "what": what, "size_mm": (tm.bounds[1] - tm.bounds[0]).round(1).tolist(),
                       "volume_cm3": round(tm.volume / 1000, 1), "checks": "pass" if not fails else fails})
        print(f"{'PASS' if not fails else 'FAIL'}  {name:34s} {report[-1]['size_mm']}  {report[-1]['volume_cm3']} cm3  {'' if not fails else fails}")
    for name in FROM_CATALOG:
        found = next((d / name for d in search_dirs if (d / name).exists()), None)
        if found is None:
            raise FileNotFoundError(f"{name} not found in {[str(d) for d in search_dirs]}; generate catalog STLs first")
        (out / name).write_bytes(found.read_bytes())
    (out / "calibration_kit.json").write_text(json.dumps({"steps_mm": STEPS, "nominal_step": NOMINAL + 1, "pieces": report,
                                                          "from_catalog": FROM_CATALOG, "offset_rule": "s = D / 4; slicer XY compensation = -s"}, indent=2) + "\n")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
