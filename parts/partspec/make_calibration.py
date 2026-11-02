#!/usr/bin/env python3
"""Calibration kit: turns the fit targets into measurements on one printer.

Includes two complementary pathways on the single 12.5 mm TU lattice:
1. Hidden user first-print selector (`forge_mount_first_print`): a 3x2 Small Forge Mount joined by 1.2 mm breakaway tabs
   to a 3-socket selector strip (1 / 2 / 3 embossed dots = snug 0.00 mm, standard 0.10 mm, easy 0.26 mm diametral clearance)
   and a 2x1 finger-grip test brick. Validated with `toyventor_fit.fit_report` so the 3 sockets continuously span
   printer surface offsets [-0.100, +0.115] mm (covering PartSpec's [-0.071, +0.079] mm fit window and +/-0.10 mm uncalibrated variance).
2. Engineering 8-step ladders (`snap_ladder`, `pro_ladder`, `stud_tester`): internal calibration tools whose hole clearances
   step by 0.1 mm across (extra clearance D = -0.1, 0.0, ..., +0.6 mm; s = D / 4).

Outputs go to calibration/. Exit code is non-zero if any piece fails a print or fit check.
"""
import json
import math
import sys
from pathlib import Path

from manifold3d import CrossSection, Manifold

import toyventor_fit as tf
import toyventor_parts as tp
import toyventor_pro as pro
from toyventor_geom import rbox

HERE = Path(__file__).parent
STEPS = [round(-0.1 + 0.1 * k, 2) for k in range(8)]        # extra clearance across, mm
NOMINAL = STEPS.index(0.0)
FIRST_PRINT_CLEARANCES = [0.00, 0.10, 0.26]                 # snug (1 dot), standard (2 dots), easy (3 dots), mm across
TU = pro.TU
SEGS = tp.FIT_SEG


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
    """A 3 x 1 Small solid-bottom handle with one designed stud at the end (zero underside cavities)."""
    p = tp.STUD["small"]
    body = rbox(3 * TU - 2 * p["gap"], TU - 2 * p["gap"], p["plate_h"], p["edge_r"], p["bed_chamfer"])
    return body + tp.stud(p).translate((-TU, 0, p["plate_h"]))


def _underside_socket_cutter(r_sock, depth):
    """Support-free underside socket: 0.4 mm 45-deg mouth lead-in, cylindrical grip wall covering mid-stud height,
    and a 40-deg conical roof (steeper than the 45-deg overhang limit, closed apex = zero flat bridge or internal ledge)."""
    lead = 0.4
    mouth = Manifold.cylinder(lead + 0.02, r_sock + lead, r_sock, SEGS).translate((0, 0, -0.02))
    bore = Manifold.cylinder(depth - lead + 0.02, r_sock, r_sock, SEGS).translate((0, 0, lead - 0.01))
    cone_h = (r_sock - 0.15) / math.tan(math.radians(40.0))
    roof = Manifold.cylinder(cone_h, r_sock, 0.15, SEGS).translate((0, 0, depth))
    return mouth + bore + roof


def _build_first_print_components():
    """Returns (combined_print, strip_centered_at_origin, reference_stud_at_origin, socket_ys)."""
    p = tp.STUD["small"]
    gap = p["gap"]
    plate_h = p["plate_h"]
    depth = p["stud_h"] + 0.4

    # 1. 3x2 Small Forge Mount (solid bottom for toy attachment, 6 Small studs on top)
    m_nx, m_ny = 3, 2
    w_m, d_m = m_nx * TU - 2 * gap, m_ny * TU - 2 * gap
    mount = rbox(w_m, d_m, plate_h, p["edge_r"], p["bed_chamfer"])
    st = tp.stud(p)
    for i in range(m_nx):
        for j in range(m_ny):
            mount = mount + st.translate(((i + 0.5 - m_nx / 2) * TU, (j + 0.5 - m_ny / 2) * TU, plate_h))

    # 2. Breakaway 3-socket selector strip (1 / 2 / 3 embossed dots on top, underside sockets on 12.5 mm TU pitch)
    bridge_gap = 3.6
    w_s, d_s, h_s = 15.0, 3 * TU - 2 * gap, 9.0
    x_s = w_m / 2 + bridge_gap + w_s / 2
    strip_local = rbox(w_s, d_s, h_s, p["edge_r"], p["bed_chamfer"])
    socket_ys = [-TU, 0.0, TU]
    for idx, (y_c, clr) in enumerate(zip(socket_ys, FIRST_PRINT_CLEARANCES)):
        r_sock = (p["stud_d"] + clr) / 2.0
        strip_local = strip_local - _underside_socket_cutter(r_sock, depth).translate((0.0, y_c, 0.0))
        dots = idx + 1
        for k in range(dots):
            dx = (k - (dots - 1) / 2.0) * 3.8
            dot = (Manifold.cylinder(0.6, 1.35, 1.35, 32)
                   + Manifold.cylinder(0.25, 1.35, 1.10, 32).translate((0, 0, 0.6))).translate((dx, y_c, h_s - 0.05))
            strip_local = strip_local + dot
    strip = strip_local.translate((x_s, 0.0, 0.0))

    # 3. 2x1 Small finger-grip test brick token (single stud at outer cell so the handle clears adjacent cells)
    w_t, d_t = 2 * TU - 2 * gap, 1 * TU - 2 * gap
    x_t = x_s + w_s / 2 + bridge_gap + w_t / 2
    token = rbox(w_t, d_t, plate_h, p["edge_r"], p["bed_chamfer"]).translate((x_t, 0.0, 0.0)) + st.translate((x_t + TU / 2.0, 0.0, plate_h))

    # 4. Breakaway bridges (1.2 mm tall x 3.2 mm wide, extending past bed chamfers into each body)
    tab_len, tab_w, tab_h = bridge_gap + 3.0, 3.2, 1.2
    tabs = (rbox(tab_len, tab_w, tab_h, 0.4, 0.3).translate((w_m / 2 + bridge_gap / 2, -6.25, 0.0))
            + rbox(tab_len, tab_w, tab_h, 0.4, 0.3).translate((w_m / 2 + bridge_gap / 2, +6.25, 0.0))
            + rbox(tab_len, tab_w, tab_h, 0.4, 0.3).translate((x_s + w_s / 2 + bridge_gap / 2, 0.0, 0.0)))

    center_shift = -((x_t + w_t / 2) - w_m / 2) / 2.0
    combined = (mount + strip + token + tabs).translate((center_shift, 0.0, 0.0))
    ref_stud = tp.block("small", 1, 1, plate_h, p["plate_top"], studs=False).translate((0, 0, -plate_h)) + st
    return combined, strip_local, ref_stud, socket_ys


def forge_mount_first_print():
    """Hidden-calibration first Forge Mount print on the 12.5 mm TU lattice (Decision 0005)."""
    return _build_first_print_components()[0]


def verify_first_print_selector():
    """Measures all 3 dotted selector sockets with toyventor_fit.fit_report and verifies continuous window coverage."""
    _, strip_local, ref_stud, socket_ys = _build_first_print_components()
    z_mid = tp.STUD["small"]["stud_h"] / 2.0
    ids = ("snug", "standard", "easy")
    sockets = []
    for idx, (fit_id, y_c, clr) in enumerate(zip(ids, socket_ys, FIRST_PRINT_CLEARANCES)):
        rep = tf.fit_report(ref_stud.translate((0.0, y_c, 0.0)), strip_local, z_mid, only=[(0.0, y_c)])
        verd = tp.fit_verdict(rep, "small")
        within = (rep["studs"] == 1
                  and rep["gap_max"] <= tp.TOL["max_play_mm"]
                  and rep["gap_min"] >= -tp.TOL["max_interference_mm"])
        sockets.append({
            "id": fit_id,
            "dots": idx + 1,
            "clearance_mm": clr,
            "measured_gap_mm": round(rep["gap_min"], 4) if rep["studs"] else None,
            "as_designed": verd["as_designed"],
            "within_limits": within,
            "surface_offset_window_mm": verd["window"],
        })
    windows = [s["surface_offset_window_mm"] for s in sockets if s["surface_offset_window_mm"]]
    combined = [min(w[0] for w in windows), max(w[1] for w in windows)] if len(windows) == 3 else [0.0, 0.0]
    contiguous = len(windows) == 3 and windows[0][1] > windows[1][0] and windows[1][1] > windows[2][0]
    ok = (all(s["within_limits"] for s in sockets)
          and sockets[1]["as_designed"]
          and contiguous
          and combined[0] <= -0.075
          and combined[1] >= 0.08)
    return {"ok": ok, "combined_window_mm": combined, "sockets": sockets}


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
RIB_W, RIB_BITE, CORE_GAP, PLUG_H, PLATE_T = 0.75, 0.16, 0.20, 4.5, 2.0


def _chamfered_horiz_bore(length, centre, axis):
    """Horizontal teardrop free bore with <=38-deg-from-vertical outer mouth lead-in chamfers at +-length/2."""
    ch = 0.45
    flare = ch * math.tan(math.radians(38.0))   # +0.352 mm per side -> Ø7.70 mm mouth (> Ø7.45 mm friction fin), 0 steep overhangs
    sec = pro.bore_section_print("free")
    sec_m = sec.offset(flare, 1, 2, SEGS)
    s_in, s_out = (sec.rotate(90), sec_m.rotate(90)) if axis == "x" else (sec, sec_m)
    z_a, z_b, z_c, z_d = -0.20, ch, length - ch, length + 0.20
    rod = (
        Manifold.batch_hull([Manifold.extrude(s_out, 0.20).translate((0, 0, z_a)), Manifold.extrude(s_in, 0.04).translate((0, 0, z_b))])
        + Manifold.extrude(s_in, z_c - z_b + 0.04).translate((0, 0, z_b))
        + Manifold.batch_hull([Manifold.extrude(s_in, 0.04).translate((0, 0, z_c)), Manifold.extrude(s_out, 0.20).translate((0, 0, z_d - 0.20))])
    )
    cut = rod.rotate((0, 90, 0)).translate((-length / 2, 0, 0)) if axis == "x" else rod.rotate((90, 0, 0)).translate((0, length / 2, 0))
    return cut.translate(centre)


def cube_cell():
    """A 12.5 mm cube with a chamfered free bore through every face (sideways bores print as teardrops) and a self-supporting
    38-deg internal throat drum across the 3-bore centre so friction-pin fins pass in and out without snagging. Prints flat, no supports. Print two."""
    c = rbox(TU, TU, TU, 1.0, pro.BEAM["bed_chamfer_mm"])
    c = c - pro.bore_cutter("free", TU, 0.0, 0.0)
    for axis in ("x", "y"):
        c = c - _chamfered_horiz_bore(TU, (0.0, 0.0, TU / 2), axis)
    r = pro.BORE["free_d"] / 2
    r_hub, r_in = r + 0.36, r - 0.20            # Ø7.72 mm internal lead-in (> Ø7.45 mm fin) tapering into the Ø7.00 mm vertical Z bore
    dz = (r_hub - r_in) / math.tan(math.radians(38.0))
    z_lo, z_hi = TU / 2 - r, TU / 2 + r
    hub_prof = [(0.0, z_lo - dz), (r_in, z_lo - dz), (r_hub, z_lo), (r_hub, z_hi), (r_in, z_hi + dz), (0.0, z_hi + dz)]
    hub = Manifold.revolve(CrossSection([hub_prof]), 72).rotate((0, 0, 2.5))
    return c - hub


def face_plate():
    """A smooth 12.5 mm face plate. Its hollow 4-petal slotted plug grips any vertical or sideways free bore via four diagonal
    (45/135/225/315 deg) crush ribs (0.75 mm wide, 0.16 mm radial bite), flexing elastically by hand across printer error. Prints smooth face down."""
    plate = rbox(TU, TU, PLATE_T, 1.0, 0.4)
    R = pro.BORE["free_d"] / 2
    r0 = R - CORE_GAP
    r_in = 1.45
    core = Manifold.cylinder(PLUG_H - 0.8, r0, r0, SEGS) + Manifold.cylinder(0.8, r0, r0 - 0.55, SEGS).translate((0, 0, PLUG_H - 0.8))
    env = Manifold.cylinder(PLUG_H - 1.0, R + RIB_BITE, R + RIB_BITE, SEGS) + Manifold.cylinder(1.0, R + RIB_BITE, r0 - 0.55, SEGS).translate((0, 0, PLUG_H - 1.0))
    ribs = None
    for k in range(4):
        rib = Manifold.cube((R + RIB_BITE + 0.5 - (r0 - 0.3), RIB_W, PLUG_H)).translate((r0 - 0.3, -RIB_W / 2, 0)).rotate((0, 0, 45 + 90 * k))
        ribs = rib if ribs is None else ribs + rib
    bore = (
        Manifold.cylinder(PLUG_H - 0.35, r_in, r_in, 48).translate((0, 0, 0.35))
        + Manifold.cylinder(0.25, r_in + 0.25, r_in, 48).translate((0, 0, PLUG_H - 0.20))
    )
    slot_w = 0.85
    slots = (
        Manifold.cube((2 * (R + 1.0), slot_w, PLUG_H - 0.55)).translate((-(R + 1.0), -slot_w / 2, 0.65))
        + Manifold.cube((slot_w, 2 * (R + 1.0), PLUG_H - 0.55)).translate((-slot_w / 2, -(R + 1.0), 0.65))
    )
    plug = ((core + (ribs ^ env)) - bore - slots).translate((0, 0, PLATE_T - 0.01))
    return plate + plug


def flex_skin_coupon():
    """Gate G7 Card-D fold endurance coupon: 5x2 TU 0.80 mm sheet with 0.60 mm-web Book-Fold corridors and upward-opening blind stud sockets (printed show-face-down on z = 0)."""
    import toyventor_kitcard as kc
    m, _, ex = kc._build_flex_skin(5 * TU - 0.2, 2 * TU - 0.2, size="small", center_book_fold=True)
    rot = ex.get("print_rotation_deg")
    if rot:
        m = m.rotate(tuple(rot))
        bb = m.bounding_box()
        m = m.translate((0.0, 0.0, -bb[2]))
    return m


PIECES = {
    "toyventor_cal_forge_mount_first_print.stl": (
        forge_mount_first_print,
        "Hidden-calibration 3x2 Small Forge Mount + 1/2/3-dot selector strip + 2x1 test brick",
    ),
    "toyventor_cal_snap_ladder.stl": (snap_ladder, "Snap stud-hole ladder, 8 steps"),
    "toyventor_cal_stud_tester.stl": (stud_tester, "One designed Small stud on a solid-bottom handle"),
    "toyventor_cal_pro_ladder.stl": (pro_ladder, "Pro ladder: fixed bores (top row) and free bores (bottom row), 8 steps"),
    "toyventor_cal_cube_cell.stl": (cube_cell, "Print-optimised experiment: cube cell with a hole in every face (print 2)"),
    "toyventor_cal_face_plate.stl": (face_plate, "Print-optimised experiment: face plate with a crush-rib plug (print 2)"),
    "toyventor_cal_flex_skin_coupon.stl": (flex_skin_coupon, "Gate G7 Card D 0.80/0.60 mm PETG Book-Fold endurance coupon (printed show-face-down, upward blind sockets, 500 folds)"),
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
        print(f"{'PASS' if not fails else 'FAIL'}  {name:42s} {report[-1]['size_mm']}  {report[-1]['volume_cm3']} cm3  {'' if not fails else fails}")
    selector_fit = verify_first_print_selector()
    ok &= selector_fit["ok"]
    print(f"{'PASS' if selector_fit['ok'] else 'FAIL'}  first_print_selector fit window {selector_fit['combined_window_mm']} mm")
    for name in FROM_CATALOG:
        found = next((d / name for d in search_dirs if (d / name).exists()), None)
        if found is None:
            raise FileNotFoundError(f"{name} not found in {[str(d) for d in search_dirs]}; generate catalog STLs first")
        (out / name).write_bytes(found.read_bytes())
    (out / "calibration_kit.json").write_text(json.dumps({
        "steps_mm": STEPS,
        "nominal_step": NOMINAL + 1,
        "first_print_selector": selector_fit,
        "pieces": report,
        "from_catalog": FROM_CATALOG,
        "offset_rule": "s = D / 4; slicer XY compensation = -s",
    }, indent=2) + "\n")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main(*(sys.argv[1:3])) else 1)
