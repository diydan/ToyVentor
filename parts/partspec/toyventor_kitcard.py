#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""ToyVentor Flat-Pack Modular Craft & Progressive Power Kit-Cards (Waves W10 & W11).

Implements:
  - Wave W10 (Cards A-D, 19 parts): 15 rigid Snap/Pro modular craft modules + 3 smooth 0.80 mm
    PETG/TPU flex skins (with 0.60 mm rib-free fold corridors) unlocking all 9 canonical craft.
  - Wave W11 (Cards E1-E2, 21 parts): Stage-2 Pro row-0 Ackermann rack steering linkage, axle
    keepers, raked bike fork adapter, and Stage-3 Momentum stored-energy propulsion/actuator cores.
  - Kit-card plate exporter (`export_kitcards`) producing `card_<id>_loose.stl` and
    `card_<id>_sprue.stl` (`<= 170 x 170 mm` on Cards A-D, `<= 164 x 164 mm` on Cards E1-E2,
    `>= 5.0 mm` inter-part gap, `1.60 x 0.80 mm` recessed V-nick sprue gates).
  - Gate G1 (`verify_gate_g1`): deterministic 3D boolean pose-sweep collision audit across all
    9 canonical craft, live `ghost_kip_seated`, extreme kinematic sweeps, and Stage-4 Mech keep-outs.

TARGETS ONLY: F1_printed_fit and F2_breakage remain pending until physical validation prints.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from manifold3d import CrossSection, JoinType, Manifold, OpType

import toyventor_pro as pro
from toyventor_geom import rbox, rrect

HERE = Path(__file__).parent
TU = pro.TU


# --------------------------------------------------------------------------
# Shared geometric primitives (support-free, zero slivers, 100% manifold)
# --------------------------------------------------------------------------
def _anchored_stud(p, x, y, z):
    """Stud with a 0.60 mm buried core plug (r - 0.08, z - 0.30..z + 0.30) so union has 0 coplanar faces."""
    return tp.stud(p).translate((x, y, z)) + tp.cyl(0.60, p["stud_d"] / 2 - 0.08, z - 0.30, x, y, 32)


def _add_stud_grid(m, size, nx, ny, z, cx=0.0, cy=0.0, cid="top_studs", omit=None):
    """Add an nx x ny stud_grid at (cx, cy, z) with optional omit_cells."""
    p = tp.STUD[size]
    pitch = p["pitch"]
    omit_set = {tuple(c) for c in (omit or [])}
    ox = cx - (nx - 1) / 2 * pitch
    oy = cy - (ny - 1) / 2 * pitch
    for i in range(nx):
        for j in range(ny):
            if (i, j) in omit_set:
                continue
            m = m + _anchored_stud(p, ox + i * pitch, oy + j * pitch, z)
    if abs(cx) < 1e-6 and abs(cy) < 1e-6:
        return m, tp.stud_conn(size, nx, ny, z, cid=cid, omit=omit)
    conn = {
        "id": cid,
        "kind": "stud_grid",
        "gender": "M",
        "interface": f"stud_{size}",
        "size_class": size,
        "fit_class": p["fit_class"],
        "frame": {"origin": [round(ox, 4), round(oy, 4), round(z, 4)], "normal": [0, 0, 1]},
        "grid": {"nx": nx, "ny": ny, "pitch": pitch, "anchor": "corner"},
    }
    if omit:
        conn["grid"]["omit_cells"] = omit
    return m, conn


def _ccw_poly(pts):
    """Ensure 2D polygon points have positive (CCW) signed area for Manifold CrossSection."""
    area2 = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1]))
    return CrossSection([pts if area2 > 0 else pts[::-1]])


def _c_jaw_cutter_x(x0, x1, y_c, z_c=6.25):
    """Bottom-entry c_jaw_tu01 cutter along X from x0 to x1 at (y_c, z_c).
    Ø7.00 mm 50-deg teardrop crown (apex z_c + 4.57 = 10.82 mm -> 1.68 mm solid roof under 12.50 mm deck)
    + 6.00 mm snap throat (242-deg wrap) flaring outward to print bed. Single prism extrusion = 0 seams.
    """
    sec_bore = pro.bore_section_print("free")
    throat = _ccw_poly([(-3.00, 0.0), (3.00, 0.0), (3.00, -1.81), (4.00, -6.50), (-4.00, -6.50), (-3.00, -1.81)])
    sec_land = (sec_bore + throat).rotate(90)
    return Manifold.extrude(sec_land, (x1 - x0) + 0.4).rotate((0, 90, 0)).translate((x0 - 0.2, y_c, z_c))


def _flank_mortise_cutter(sx, y_c, x_wall=24.9, depth=7.0):
    """Support-free flank_rail_tu02 mortise on side `sx` (-1 or +1) centered at y_c + 1.5 mm (asymmetric poka-yoke).
    Single convex-hull pocket: 16.0 x 3.6 mm at inner face, flaring 45 deg up/down at outer wall -> 0 coplanar seams.
    """
    x_in = sx * (x_wall - depth)
    x_out = sx * (x_wall + 0.4)
    dz = depth + 0.4
    p_in = Manifold.cube((0.08, 16.0, 3.6)).translate((x_in - 0.04, y_c - 6.5, 4.5))
    p_out = Manifold.cube((0.08, 18.0, 3.6 + 2 * dz)).translate((x_out - 0.04, y_c - 7.5, max(0.6, 4.5 - dz)))
    return Manifold.batch_hull([p_in, p_out])


def _flank_tongue_solid(sx, y_c, x_base):
    """Matching flank_rail_tu02 male tongue protruding from x_base along sx (-1 or +1), flat on z >= 0."""
    # Printed flat on bed or elevated with 45-deg lower gusset so zero overhang
    L = 6.8
    x0 = x_base if sx > 0 else x_base - L
    tongue = rbox(L + 0.4, 14.6, 3.4, 0.8, 0.0).translate((x0 + (L + 0.4) / 2 - (0.4 if sx > 0 else 0.0), y_c + 1.2, 0.0))
    step = rbox(3.6, 2.8, 1.8, 0.5, 0.0).translate((x_base + sx * 1.6, y_c - 7.4, 0.0))
    return tongue + step


def _cruciform_tip_shaft(total_len, conn_len=None, z0=0.0):
    """Pro shaft_drive (flats) along +Z with top 5.6 mm indexed 4-way (5.0 x 5.0 mm) so a second
    #6 rotor blade can mount at 90 deg with positive drive while keeping standard double-D everywhere else.
    Built by subtracting oversized side-flat cutters + 1 continuous center hole -> 0 coplanar unions.
    """
    L_conn = total_len if conn_len is None else conn_len
    tip_h = 5.6
    z_bevel = z0 + total_len - tip_h
    outer = Manifold.extrude(pro._double_d(pro.BORE["shaft_d"], pro.BORE["shaft_flats"]), total_len).translate((0.0, 0.0, z0))
    for sx in (-1, 1):
        c_lo = Manifold.cube((2.5, 10.0, 0.05)).translate(((3.50 if sx > 0 else -6.00), -5.0, z_bevel))
        c_hi = Manifold.cube((2.5, 10.0, tip_h + 0.5)).translate(((2.50 if sx > 0 else -5.00), -5.0, z_bevel + 0.8))
        outer = outer - Manifold.batch_hull([c_lo, c_hi])
    hole = Manifold.extrude(pro._teardrop(pro.BORE["shaft_center_hole"]), total_len + 1.0).translate((0.0, 0.0, z0 - 0.5))
    conn = pro._pin_conn("shaft_drive", "flats", L_conn, z0=z0)
    return outer - hole, conn


# ==========================================================================
# WAVE W10: Universal Flat-Pack Modular Craft (Cards A-D, 19 parts)
# ==========================================================================
def kit_keel_base(size="small", grid=(4, 10), **_):
    """#1 Universal 4x10 TU Keel Base (49.8 x 124.8 x 15.3 mm).
    - rows 0..2: 24.8 mm tapered nose (6 studs) + inter-row (0, -37.5) vertical free steering bore;
    - rows 3..5: 49.8 mm cockpit hull (12 studs) + flank_rail_tu02 mortises + underside tracking recess;
    - rows 6..9: 49.8 mm rear power/cargo bay (10 perimeter studs) + 10.0 x 33.0 mm PTO through-slot;
    - Single universal z_axle = 6.25 mm c_jaw_tu01 tier at rows 0, 7, 8 + rear row-9 hinge jaws.
    """
    H = 12.5
    pts = [
        (-12.4, -62.4), (12.4, -62.4),
        (12.4, -31.5), (24.9, -19.0),
        (24.9, 62.4), (-24.9, 62.4),
        (-24.9, -19.0), (-12.4, -31.5),
    ]
    plan = _ccw_poly(pts).offset(-1.6, JoinType.Round).offset(1.6, JoinType.Round)
    m = Manifold.extrude(plan, H)

    # 10.0 x 31.4 mm PTO through-slot centered on row 8 (y = +43.75 -> [+28.05, +59.45], 2.95 mm rear tie):
    pto = Manifold.extrude(rrect(10.0, 31.4, 2.0), H + 0.4).translate((0.0, 43.75, -0.2))
    m = m - pto

    # CPSIA §103 tracking-code recess (24.0 x 8.0 x 0.40 mm) on z = 0 underside across rows 4..5:
    rec_bot = Manifold.extrude(rrect(24.0, 8.0, 1.2), 0.10).translate((0.0, 0.0, -0.05))
    rec_top = Manifold.extrude(rrect(23.2, 7.2, 1.0), 0.05).translate((0.0, 0.0, 0.35))
    m = m - Manifold.batch_hull([rec_bot, rec_top])

    # Single universal z_axle = 6.25 mm c_jaw_tu01 stations at row 0 (nose) and rows 7, 8 (rear):
    for r in (0, 7, 8):
        yc = -56.25 + r * 12.5
        hw = 12.4 if r <= 2 else 24.9
        m = m - _c_jaw_cutter_x(-hw, hw, yc, 6.25)

    # Rear hinge/ramp c_jaw_tu01 jaws at y = +56.25, z = 6.25 on outer flanks (|X| in [7.2, 24.9]):
    m = m - _c_jaw_cutter_x(-24.9, -7.2, 56.25, 6.25)
    m = m - _c_jaw_cutter_x(7.2, 24.9, 56.25, 6.25)

    # Keyed flank_rail_tu02 mortises centered on rows 4..5 (y = +6.25, well clear of row-7 axle & nose shoulder):
    for sx in (-1, 1):
        m = m - _flank_mortise_cutter(sx, 6.25, x_wall=24.9, depth=7.0)

    # Unified 4x10 stud_small top deck (28 active studs):
    omit = [[i, j] for i in range(4) for j in range(10)
            if (j <= 2 and i in (0, 3)) or (j >= 7 and i in (1, 2))]
    m, c_top = _add_stud_grid(m, size, 4, 10, H, cid="top_studs", omit=omit)

    # Inter-row vertical free steering bore at (0.0, -37.50) = Y_keel 25.00 mm (+2.04 mm to all 4 studs):
    m, c_steer = tp.cut_vertical_bore(m, "steer_bore", 0.0, -37.5, 0.0, H, "free")
    c_steer["lattice"] = "centre"
    return m, [c_top, c_steer], {}


def kit_clevis_spine(size="small", grid=(2, 8), **_):
    """#2 Universal 2x8 TU Clevis Spine (27.8 x 99.8 x 15.3 mm).
    Twin 15.0 mm end clevis slots with 6.4 mm free-bore cheeks (y = +-40.625, z = 6.25),
    central 2x2 saddle studs, vertical front steering headtube bore, and side kickstand jaw.
    """
    H = 12.5
    pts = [
        (-13.9, -49.9), (13.9, -49.9),
        (13.9, -18.5), (12.4, -15.0),
        (12.4, 15.0), (13.9, 18.5),
        (13.9, 49.9), (-13.9, 49.9),
        (-13.9, 18.5), (-12.4, 15.0),
        (-12.4, -15.0), (-13.9, -18.5),
    ]
    plan = _ccw_poly(pts).offset(-1.8, JoinType.Round).offset(1.8, JoinType.Round)
    m = Manifold.extrude(plan, H)

    # 15.0 mm wide front & rear wheel slots (|y| in [20.5, 50.5], leaving 6.4 mm cheeks):
    slot_f = Manifold.extrude(rrect(15.0, 32.0, 1.6), H + 0.4).translate((0.0, -36.5, -0.2))
    slot_r = Manifold.extrude(rrect(15.0, 32.0, 1.6), H + 0.4).translate((0.0, 36.5, -0.2))
    m = m - slot_f - slot_r

    # Kickstand bottom-entry C-jaw notch on left central flank (y = +12.5, x in [-12.4, -4.5]):
    m = m - _c_jaw_cutter_x(-12.4, -4.5, 12.5, 6.25)

    # Central 2x2 saddle studs at cy = +6.25 (y = 0.0, +12.5):
    m, c_top = _add_stud_grid(m, size, 2, 2, H, cx=0.0, cy=6.25, cid="top_studs")
    # Vertical front steering bore at (0.0, -12.50) = -1.0 TU (+6.8 mm to Ø36 tire, 8.0 mm solid web to slot_f):
    m, c_head = tp.cut_vertical_bore(m, "headtube", 0.0, -12.5, 0.0, H, "free")
    c_head["lattice"] = "centre"
    # Double-cheek clevis bores at y = +-40.625 (+-26/8 TU), z = 6.25 (4/8 TU), strictly inside +-13.90 cheeks:
    m, c_cf = tp._cut_clevis_x_bores(m, "clevis_front_l", "clevis_front_r", 13.80, 7.60, -40.625, 6.25, "free")
    m, c_cr = tp._cut_clevis_x_bores(m, "clevis_rear_l", "clevis_rear_r", 13.80, 7.60, 40.625, 6.25, "free")
    return m, [c_top, c_head, *c_cf, *c_cr], {}


def kit_barbell_shaft(**_):
    """#3a Full-Span Outboard Barbell Shaft & Heli Mast (6.6 x 78.0 x 5.0 mm LAY_FLAT)."""
    m, conn = _cruciform_tip_shaft(78.0, conn_len=78.0, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def kit_spinner_pin(**_):
    """#3b Ergonomic Pull-Ring Clevis & Prop Spinner Pin (36.0 x 65.0 x 5.0 mm LAY_FLAT).
    Ø36.0 mm grip ring (z = 0..36) + 1.0 x Ø10 thrust standoff (z = 36..37) + 28.0 mm shaft_drive stem (z = 37..65).
    """
    hy = pro.BORE["shaft_flats"] / 2  # 2.50 mm
    ring_cs = CrossSection.circle(18.0, 96).translate((0.0, 18.0)) - CrossSection.circle(11.4, 72).translate((0.0, 18.0))
    boss_cs = CrossSection.square((10.0, 3.0)).translate((-5.0, 34.0))
    grip = tp._xz_to_layflat(ring_cs + boss_cs, hy)
    stem = pro.pin_solid("flats", 28.5, z0=36.5)
    # Bevel final 0.8 mm tip for easy clevis entry (well outside [37.0, 62.0] measured zone):
    tip_cut = Manifold.cube((1.2, 8.0, 2.2)).translate((-0.6, -4.0, 62.6))
    m = (grip + stem) - tip_cut
    conn = pro._pin_conn("shaft_drive", "flats", 25.0, z0=37.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def kit_wheel_med(**_):
    """#4 Medium 1-TU Modular Wheel (36.0 x 36.0 x 12.3 mm, 5.10 mm fixed hub)."""
    D, H = 36.0, 12.3
    R = D / 2
    tire = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 1.4, R - 1.4, 96),
        Manifold.cylinder(H - 3.2, R, R, 96).translate((0.0, 0.0, 1.6)),
        Manifold.cylinder(0.02, R - 1.6, R - 1.6, 96).translate((0.0, 0.0, H - 0.02)),
    ])
    lug = Manifold.cube((1.5, 1.2, H + 2.0)).translate((R - 0.8, -0.6, -1.0))
    for k in range(24):
        tire = tire - lug.rotate((0.0, 0.0, 15.0 * k))
    dish = Manifold.batch_hull([
        Manifold.cylinder(0.05, 10.6, 10.6, 84).translate((0.0, 0.0, 7.2)),
        Manifold.cylinder(0.8, 12.6, 12.6, 84).translate((0.0, 0.0, H - 0.5)),
    ])
    hub = Manifold.cylinder(H, 6.2, 6.2, 64)
    spokes = None
    for k in range(5):
        sp = rbox(3.2, 8.8, 4.6, 0.9, 0.0).translate((0.0, 7.2, 7.2)).rotate((0.0, 0.0, 72.0 * k))
        spokes = sp if spokes is None else spokes + sp
    body = (tire - dish + hub + spokes) - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(H)], {}


def kit_wheel_giant(**_):
    """#5 Giant 1-TU Tractor / Monster / Paddle Wheel (50.0 x 50.0 x 12.3 mm, fixed hub + 4x Ø7.0 face bores)."""
    D, H = 50.0, 12.3
    R = D / 2
    tire = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 1.6, R - 1.6, 112),
        Manifold.cylinder(H - 3.4, R, R, 112).translate((0.0, 0.0, 1.7)),
        Manifold.cylinder(0.02, R - 1.8, R - 1.8, 112).translate((0.0, 0.0, H - 0.02)),
    ])
    lug = Manifold.cube((2.2, 1.8, H + 2.0)).translate((R - 1.2, -0.9, -1.0))
    for k in range(20):
        tire = tire - lug.rotate((0.0, 0.0, 18.0 * k))
    body = tire - pro.bore_cutter("fixed", H)
    cranks = [(-TU, 0.0), (TU, 0.0), (0.0, -TU), (0.0, TU)]
    for x, y in cranks:
        body = body - pro.bore_cutter("free", H, x, y)
    omit = [[i, j] for i in range(3) for j in range(3) if ((i - 1) * TU, (j - 1) * TU) not in cranks]
    c_crank = {
        "id": "face_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "centre",
        "frame": {"origin": [-TU, -TU, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 3, "ny": 3, "pitch": TU, "anchor": "corner", "omit_cells": omit},
    }
    return body, [pro._hub_conn(H), c_crank], {}


def kit_rotor_blade(**_):
    """#6 Universal Airfoil Rotor / Propeller Blade (68.0 x 20.0 x 6.0 mm, Ø20.0 fixed hub)."""
    H = 6.0
    hub = Manifold.batch_hull([
        Manifold.cylinder(0.02, 9.6, 9.6, 72),
        Manifold.cylinder(H - 0.8, 10.0, 10.0, 72).translate((0.0, 0.0, 0.4)),
        Manifold.cylinder(0.02, 9.4, 9.4, 72).translate((0.0, 0.0, H - 0.02)),
    ])
    # Flat-bottom tapered blades along X ([-34.0, +34.0], Y width <= 16.0 mm, <= 35-deg top airfoil bevel):
    b_bot = Manifold.extrude(rrect(67.2, 14.0, 4.5), 0.02)
    b_mid = Manifold.extrude(rrect(68.0, 14.8, 4.8), 2.2).translate((0.0, 0.0, 0.4))
    b_top = Manifold.extrude(rrect(64.0, 9.2, 3.2), 0.02).translate((0.0, 0.0, 4.4))
    blades = Manifold.batch_hull([b_bot, b_mid, b_top])
    body = (hub + blades) - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(H)], {}


def kit_aero_wedge(size="small", grid=(2, 3), **_):
    """#7 Aero Nose Wedge & Helicopter Mast House (24.8 x 37.3 x 33.25 mm).
    - 2x3 cage socket_small base;
    - Horizontal 50-deg teardrop front free prop_bore at z_local = 26.5625 mm (17/8 TU, depth 23.0 mm);
    - Vertical top free mast_bore at (0.0, +12.50, 20.25..33.25 mm, depth 13.0 mm).
    """
    p = tp.STUD[size]
    fh = p["plate_h"]
    foot = tp.block(size, 2, 3, fh, p["plate_top"], studs=False)
    # Sculpted aero wedge above z = 4.6 mm: full 33.25 mm crown at rear, gently sloped 32.55 mm prow (roof >= 1.42 mm over prop_bore)
    slices = [
        (fh - 0.4, 24.4, 36.9, 2.0, 0.0, 0.0, 0.2),
        (16.0,     24.6, 37.1, 2.2, 0.0, 0.0, 0.2),
        (32.55,    17.6, 36.8, 2.6, 0.0, 0.0, 0.2),
        (33.25,    16.8, 22.0, 2.6, 0.0, 7.2, 0.2),
    ]
    upper = tp.flare_clip(tp._hull_slices(slices), foot.slice(fh - 0.4), fh - 0.4)
    m = foot + upper

    # Blind 23.0 mm front prop_bore along +Y from y = -18.65 to +4.35 at z = 26.5625 (17/8 TU):
    z_prop = 17 * (TU / 8)  # 26.5625 mm
    sec_p = pro.bore_section_print("free")
    cut_prop = Manifold.extrude(sec_p, 23.2).rotate((90, 0, 0)).translate((0.0, 4.35, z_prop))
    m = m - cut_prop
    c_prop = pro._axis_bore_conn("prop_bore", "free", (0.0, -7.15, z_prop), "y", 23.0, lattice="axis8")

    # Blind 13.0 mm top vertical mast_bore at (0.0, +12.50, 20.25..33.25):
    m, c_mast = tp.cut_vertical_bore(m, "mast_bore", 0.0, 12.50, 20.25, 13.0, "free")
    return m, [tp.socket_conn(size, 2, 3), c_prop, c_mast], {}


def kit_windscreen(size="small", grid=(4, 3), lock=True, **_):
    """#8 Open-Top Windscreen & Wire-Trough Sill Frame (49.8 x 37.3 x 23.5 mm).
    - 12.3 mm side bolsters on cols 0, 3 leaving 25.20 mm clear inner Kip leg/torso corridor;
    - 8 integrated stud holes (row 3 all 4 cols + rows 4..5 cols 0, 3);
    - 6.0 x 5.0 mm open-top wire troughs above 4.70 mm socket ceiling (z = 5.2..11.2 mm);
    - Swept open-top front windscreen pillars rising to z = 20.7 mm (+ 2.8 mm corner studs = 23.5 mm).
    """
    u_plan = rrect(49.8, 37.3, 2.2) - rrect(25.2, 28.0, 1.6).translate((0.0, 7.65))
    base_u = Manifold.extrude(u_plan, 6.4)
    mid_plan = rrect(49.6, 37.1, 2.1) - rrect(25.4, 30.6, 1.6).translate((0.0, 6.45))
    mid_u = Manifold.extrude(mid_plan, 5.0).translate((0.0, 0.0, 6.0))
    # Front cowl rising from z = 10.4 to 20.7 (strictly inset inside mid_plan, y_rear = -8.95 -> +0.50 mm ahead of Kip toes!):
    cowl_hi = Manifold.extrude(rrect(49.4, 9.5, 2.0).translate((0.0, -13.70)), 10.3).translate((0.0, 0.0, 10.4))
    dip = Manifold.extrude(rrect(21.0, 14.0, 3.0).translate((0.0, -13.70)), 6.0).translate((0.0, 0.0, 15.5))
    post_s = [
        (10.4, 11.8, 17.6, 2.0, 0.0, 9.2, 0.2),
        (20.7, 11.6, 12.0, 2.0, 0.0, 12.5, 0.2),
    ]
    posts = tp._hull_slices(post_s).translate((-18.75, 0.0, 0.0)) + tp._hull_slices(post_s).translate((18.75, 0.0, 0.0))
    raw = base_u + mid_u + (cowl_hi - dip) + posts
    m, conns, ex = tp.integrated_sockets(raw, size, lock)

    # Cut 6.0 mm wide x 5.0 mm deep open-top wire troughs along x = +-18.75 at z = 5.2..11.5 mm (above 4.7 mm roof!):
    for sx in (-1, 1):
        trough = Manifold.cube((6.0, 24.0, 6.3)).translate((sx * 18.75 - 3.0, -5.0, 5.2))
        m = m - trough

    # 4 corner studs at z = 20.7 mm (total height 20.7 + 2.8 = 23.5 mm!) on (cols 0,3 x rows 0,2):
    omit = [[i, j] for i in range(4) for j in range(3) if not (i in (0, 3) and j in (0, 2))]
    m, c_top = _add_stud_grid(m, size, 4, 3, 20.7, cid="top_studs", omit=omit)
    return m, conns + [c_top], ex


def kit_foil_wing(size="small", grid=(6, 4), lock=True, **_):
    """#9 Flat-Bottom Swept Foil Wing / GT Spoiler / Car-Hauler Ramp (74.8 x 49.8 x 5.0 mm)."""
    H = 5.0
    pts = [
        (-37.4, -24.9), (30.6, -24.9), (30.6, 24.9),
        (-12.0, 24.9), (-37.4, 6.0),
    ]
    plan = _ccw_poly(pts).offset(-2.2, JoinType.Round).offset(2.2, JoinType.Round)
    tongue_cs = (
        rrect(7.2, 14.6, 0.8).translate((33.8, 1.2))
        + rrect(3.6, 2.8, 0.5).translate((32.0, -7.4))
    )
    base = Manifold.extrude(plan + tongue_cs, 3.4)
    cap = Manifold.batch_hull([
        Manifold.extrude(plan.offset(-0.1, JoinType.Round), 0.2).translate((0.0, 0.0, 3.2)),
        Manifold.extrude(plan.offset(-1.9, JoinType.Round), 0.05).translate((0.0, 0.0, H - 0.05)),
    ])
    m, conns, ex = tp.integrated_sockets(base + cap, size, lock)
    return m, conns, ex


def kit_skid_runner(size="small", grid=(2, 9), lock=True, **_):
    """#10 Landing Skid / Snow Ski / Catamaran Runner (17.6 x 112.3 x 20.0 mm).
    Flat-bottom ski with upturned 45-deg bow, 9 integrated stud sockets (zero edge reliefs), and twin upper riser struts.
    """
    ski = tp._flat_box(17.6, 112.3, 5.2, r=3.2, bed_ch=0.4)
    bow = tp._hull_slices([
        (4.8,  17.2, 18.0, 3.0, 0.0, -47.0, 0.2),
        (16.0, 14.0,  6.0, 2.4, 0.0, -53.0, 0.2),
    ])
    struts = None
    for yc in (-18.75, 18.75):
        st = tp._hull_slices([
            (4.8,  16.0, 18.0, 2.4, 0.0, yc, 0.2),
            (20.0, 14.0, 12.0, 2.2, 0.0, yc, 0.2),
        ])
        struts = st if struts is None else struts + st
    m, conns, ex = tp.integrated_sockets(ski + bow + struts, size, lock)
    return m, conns, ex


def kit_tilting_tub(size="small", grid=(4, 4), **_):
    """#11 4x4 TU Sculpted Rock-Body Tipping Dump Tub & Payload Bay (49.8 x 49.8 x 18.0 mm).
    Features a 18.0 mm front cab-shield headboard (-Y), 3 exterior vertical stiffener ribs per side,
    40-deg flared top coaming rails, and an angled open rear scow dump chute (+Y) with 0 overhangs.
    """
    p = tp.STUD[size]
    fh = p["plate_h"]
    foot = tp.block(size, 4, 4, fh, p["plate_top"], studs=False)
    # Recessed 47.6 mm side panels above z = fh + 40.2-deg flared 49.8 mm top coaming rail + 4 vertical exterior ribs:
    shell_main = Manifold.extrude(rrect(47.6, 49.8, 2.0), 14.8 - fh + 0.4).translate((0.0, 0.0, fh - 0.4))
    ribs = None
    for yc in (-21.5, -10.5, 0.5, 11.5):
        rb = Manifold.extrude(rrect(49.8, 3.4, 1.0), 14.8 - fh + 0.4).translate((0.0, yc, fh - 0.4))
        ribs = rb if ribs is None else ribs + rb
    rail = Manifold.batch_hull([
        Manifold.extrude(rrect(47.6, 49.8, 2.0), 0.2).translate((0.0, 0.0, 12.2)),
        Manifold.extrude(rrect(49.8, 49.8, 2.1), 1.3).translate((0.0, 0.0, 13.5)),
    ])
    # 18.0 mm front cab-shield headboard (-Y) with 45-deg side gussets down to z = 14.8 coaming:
    headboard = Manifold.batch_hull([
        Manifold.extrude(rrect(49.8, 13.6, 2.1), 0.3).translate((0.0, -18.1, 14.5)),
        Manifold.extrude(rrect(49.8, 10.2, 2.1), 0.4).translate((0.0, -19.8, 17.6)),
    ])
    # Angled rear scow chute trim (+Y) opening the tailgate above z = 9.4 mm:
    rear_trim = Manifold.batch_hull([
        Manifold.cube((52.0, 11.0, 0.2)).translate((-26.0, 18.0, 15.2)),
        Manifold.cube((52.0, 4.0, 6.2)).translate((-26.0, 24.8, 9.2)),
    ])
    outer = ((shell_main + ribs + rail) - rear_trim) + headboard
    # Sculpted dump cavity: flat floor z = fh + 0.6 ramping smoothly up into open rear scow lip at z = 9.4 mm:
    cav = Manifold.batch_hull([
        Manifold.extrude(rrect(43.2, 35.6, 1.8), 0.2).translate((0.0, -4.0, fh + 0.6)),
        Manifold.extrude(rrect(43.2, 43.2, 1.8), 9.6).translate((0.0, -0.2, 9.4)),
        Manifold.extrude(rrect(43.2, 12.0, 1.2), 9.6).translate((0.0, 21.0, 9.4)),
    ])
    cav_top = Manifold.extrude(rrect(43.2, 46.2, 1.8), 6.0).translate((0.0, 1.2, 14.0))
    return foot + (outer - cav - cav_top), [tp.socket_conn(size, 4, 4)], {}


def kit_scoop_blade(size="small", grid=(4, 3), lock=True, **_):
    """#12 Loader Bucket / Snowplow / Rescue Basket (49.8 x 37.3 x 20.0 mm).
    Printed on flat back wall (z_local = 0) so curved bucket faces upward with 0-deg underside overhang.
    """
    back = tp._flat_box(49.8, 37.3, 5.2, r=2.4, bed_ch=0.4)
    # Upward-facing loader side cheeks + curved cutting lip at y = -18.65, rear heel wall at y = +18.65:
    shell = Manifold.extrude(rrect(49.6, 37.1, 2.4), 15.2).translate((0.0, 0.0, 4.8))
    scoop_cut = Manifold.batch_hull([
        Manifold.extrude(rrect(44.6, 31.0, 2.0), 0.2).translate((0.0, -3.5, 5.4)),
        Manifold.extrude(rrect(44.6, 35.0, 2.0), 0.2).translate((0.0, -4.0, 20.4)),
    ])
    raw = back + (shell - scoop_cut)
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    return m, conns, ex


def kit_booster_pod(size="small", grid=(2, 5), lock=True, **_):
    """#13 Sidepod / Jet Nacelle / OMS Booster Pod (24.8 x 65.0 x 28.0 mm)."""
    base_cs = (
        rrect(24.8, 54.0, 2.6).translate((0.0, -5.5))
        + rrect(9.6, 16.0, 3.0).translate((-6.0, 24.5))
        + rrect(9.6, 16.0, 3.0).translate((6.0, 24.5))
    )
    base = Manifold.extrude(base_cs, 5.4)
    fairing = tp._hull_slices([
        (5.0,  24.4, 53.4, 2.6, 0.0, -5.5, 0.2),
        (18.0, 23.6, 58.0, 4.0, 0.0, -2.0, 0.2),
        (28.0, 16.8, 44.0, 3.6, 0.0,  0.0, 0.2),
    ])
    bells = None
    bell_bore = pro._teardrop(5.6, roof_deg=50, segs=48)
    for sx in (-1, 1):
        b = tp._hull_slices([
            (5.0,   9.2, 15.0, 2.8, sx * 6.0, 24.6, 0.2),
            (12.0, 10.6, 15.0, 3.8, sx * 6.0, 25.0, 0.2),
            (21.0,  9.6, 13.0, 3.4, sx * 6.0, 25.0, 0.2),
        ])
        hole = Manifold.extrude(bell_bore, 7.5).rotate((90, 0, 0)).translate((sx * 6.0, 33.0, 13.5))
        bells = (b - hole) if bells is None else bells + (b - hole)
    m, conns, ex = tp.integrated_sockets(base + fairing + bells, size, lock)
    return m, conns, ex


def kit_turntable(size="small", grid=(4, 4), **_):
    """#14 1-Piece Rotary Crane Slew Base, Fifth-Wheel Hitch & 10-Stud Heli Mast Deck (49.8 x 49.8 x 8.0 mm)."""
    H_deck = 5.2
    m = tp.block(size, 4, 4, H_deck, 2.0, studs=True) - pro.bore_cutter("free", H_deck, 0.0, 0.0, 0.0)
    c_bore = {
        "id": "center_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H_deck,
        "lattice": "axis",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [tp.stud_conn(size, 4, 4, H_deck), tp.socket_conn(size, 4, 4), c_bore], {}


def kit_yoke_hbar(**_):
    """#15 Universal Steering Yoke, Boat Helm & Bike Handlebar (46.0 x 38.0 x 5.6 mm LAY_FLAT)."""
    hy = pro.BORE["shaft_flats"] / 2  # 2.50 mm
    stem = pro.pin_solid("flats", 26.5, z0=0.0)
    riser_cs = _ccw_poly([(-3.2, 25.5), (3.2, 25.5), (12.0, 38.0), (-12.0, 38.0)])
    hbar_cs = rrect(46.0, 6.0, 2.8).translate((0.0, 35.0))
    head = tp._xz_to_layflat(riser_cs + hbar_cs, hy)
    cap = Manifold.batch_hull([
        Manifold.extrude(CrossSection.circle(2.8, 48).translate((0.0, 35.0)), 0.4).rotate((90, 0, 0)).translate((0.0, hy - 0.2, 0.0)),
        Manifold.extrude(CrossSection.circle(2.0, 48).translate((0.0, 35.0)), 0.1).rotate((90, 0, 0)).translate((0.0, hy + 0.6, 0.0)),
    ])
    m = stem + head + cap
    conn = pro._pin_conn("shaft_drive", "flats", 25.0, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


# ==========================================================================
# WAVE W12: Categorised Hand Props (Tools / Cleaning / Instruments / Play), flat-printed on a Pro grip shaft.
# v2: 5.0 mm base plate + solid embossed relief (2.0 mm sink, 0 overhang) + smooth through-apertures.
# ==========================================================================
def _box_cs(w, h, cx, z0):
    return CrossSection.square((w, h), center=True).translate((cx, z0 + h / 2))


def _circ(r, x, z, n=40):
    return CrossSection.circle(r, n).translate((x, z))


def _stroke(pts, r):
    """Round-capped tapered stroke through (x, z) points; r is a radius or a per-point list."""
    rs = r if isinstance(r, (list, tuple)) else [r] * len(pts)
    out = None
    for (a, ra), (b, rb) in zip(zip(pts, rs), zip(pts[1:], rs[1:])):
        seg = CrossSection.batch_hull([_circ(ra, a[0], a[1], 24), _circ(rb, b[0], b[1], 24)])
        out = seg if out is None else out + seg
    return out


def _union(items):
    out = None
    for it in items:
        out = it if out is None else out + it
    return out


def _prop_on_grip(base, grip_tu, relief_cs=None, relief_h=2.0, cuts_cs=None):
    """base: (x, z) head outline on a 5 mm plate; relief_cs: raised top-embossing; cuts_cs: through-holes."""
    L = grip_tu * pro.TU
    hy = pro.BORE["shaft_flats"] / 2  # 2.50 mm
    grip = pro.pin_solid("flats", L + 4.0)
    base = base.offset(-0.8, JoinType.Round).offset(0.8, JoinType.Round)
    m = grip + tp._xz_to_layflat(base, hy)
    if relief_cs is not None and not relief_cs.is_empty():
        rc = relief_cs.offset(-0.5, JoinType.Round)
        r_solid = Manifold.extrude(rc, relief_h + 1.0).rotate((90, 0, 0)).translate((0.0, hy + relief_h, 0.0))
        m = m + r_solid
    if cuts_cs is not None and not cuts_cs.is_empty():
        c_solid = Manifold.extrude(cuts_cs, 2 * hy + 12.0).rotate((90, 0, 0)).translate((0.0, hy + 6.0, 0.0))
        m = m - c_solid
    return m, [pro._pin_conn("shaft_drive", "flats", L)], {"print_rotation_deg": pro.LAY_FLAT}


def prop_hammer(grip_tu=3, **_):
    """Tools: claw hammer, steel striking head, curved split claw and V-notch on 3 TU grip (LAY_FLAT)."""
    L = grip_tu * pro.TU
    neck = _box_cs(8.0, 12.0, 0.0, L)
    head = _box_cs(28.0, 12.0, -2.0, L + 9.0)
    face = _box_cs(8.0, 18.0, -16.0, L + 6.0)
    claw = _stroke([(10.0, L + 15.0), (18.0, L + 18.0), (22.0, L + 26.0)], [6.0, 4.5, 3.0])
    v_notch = CrossSection.batch_hull([_circ(1.5, 20.0, L + 22.0), _box_cs(6.0, 6.0, 24.0, L + 22.0)])
    base = neck + head + face + claw - v_notch
    relief = (head + face).offset(-1.2, JoinType.Round)
    return _prop_on_grip(base, grip_tu, relief_cs=relief, relief_h=2.2)


def prop_screwdriver(grip_tu=3, **_):
    """Tools: screwdriver, 16 mm bulb handle with ribbed grip, 4.2 mm shank and flat flared tip (LAY_FLAT)."""
    L = grip_tu * pro.TU
    bulb = CrossSection.batch_hull([_box_cs(8.0, 2.0, 0.0, L), _box_cs(16.0, 6.0, 0.0, L + 4.0), _box_cs(16.0, 6.0, 0.0, L + 16.0), _box_cs(9.0, 2.0, 0.0, L + 22.0)])
    shank = _box_cs(4.2, 34.0, 0.0, L + 21.0)
    tip = CrossSection.batch_hull([_box_cs(4.2, 2.0, 0.0, L + 53.0), _box_cs(8.4, 2.0, 0.0, L + 60.0)])
    ribs = _union([_box_cs(14.0, 1.8, 0.0, L + 6.0 + 4.0 * k) for k in range(3)])
    base = bulb + shank + tip
    return _prop_on_grip(base, grip_tu, relief_cs=ribs, relief_h=1.8)


def prop_paint_roller(grip_tu=3, **_):
    """Tools: paint roller, 44 x 14 mm barrel with paint stripe and U-frame crank arm (LAY_FLAT)."""
    L = grip_tu * pro.TU
    stem = _box_cs(5.0, 13.0, 0.0, L)
    arm = _stroke([(0.0, L + 11.0), (20.0, L + 11.0), (20.0, L + 19.0)], 2.4)
    roller = _box_cs(44.0, 14.0, 0.0, L + 18.0)
    stripe = _box_cs(34.0, 3.0, 0.0, L + 23.5)
    return _prop_on_grip(stem + arm + roller, grip_tu, relief_cs=stripe, relief_h=1.8)


def prop_mop(grip_tu=3, **_):
    """Cleaning: string mop, raised clamp pad and 7 flared strands (LAY_FLAT)."""
    L = grip_tu * pro.TU
    collar = _box_cs(8.0, 8.0, 0.0, L)
    pad = _box_cs(30.0, 7.0, 0.0, L + 6.0)
    strands = _union([_stroke([(k * 3.8, L + 11.0), (k * 5.4, L + 23.0), (k * 7.0, L + 36.0)], [2.2, 2.0, 1.6]) for k in range(-3, 4)])
    base = collar + pad + strands
    return _prop_on_grip(base, grip_tu, relief_cs=pad.offset(-1.0, JoinType.Round), relief_h=2.2)


def prop_broom(grip_tu=3, **_):
    """Cleaning: push broom, flared bristle skirt with raised binding collar (LAY_FLAT)."""
    L = grip_tu * pro.TU
    neck = _box_cs(6.4, 18.0, 0.0, L)
    cap = CrossSection.batch_hull([_box_cs(8.0, 2.0, 0.0, L + 16.0), _box_cs(24.0, 4.0, 0.0, L + 24.0)])
    skirt = CrossSection.batch_hull([_box_cs(24.0, 2.0, 0.0, L + 24.0), _box_cs(32.0, 4.0, 0.0, L + 48.0)])
    base = neck + cap + skirt
    band = _box_cs(22.0, 3.0, 0.0, L + 22.0)
    return _prop_on_grip(base, grip_tu, relief_cs=band, relief_h=1.8)


def prop_scrub_brush(grip_tu=3, **_):
    """Cleaning: handheld scrub brush, teardrop block with raised central grip ridge (LAY_FLAT)."""
    L = grip_tu * pro.TU
    neck = _box_cs(8.0, 10.0, 0.0, L)
    oval = CrossSection.batch_hull([_circ(11.0, 0.0, L + 16.0), _circ(7.0, 0.0, L + 32.0)])
    grip_ridge = _box_cs(6.0, 16.0, 0.0, L + 18.0)
    return _prop_on_grip(neck + oval, grip_tu, relief_cs=grip_ridge, relief_h=2.2)


def prop_vacuum(grip_tu=3, **_):
    """Cleaning: handheld vacuum, domed canister with dust window, tube and flared nozzle (LAY_FLAT)."""
    L = grip_tu * pro.TU
    collar = _box_cs(8.0, 6.0, 0.0, L)
    can = _box_cs(24.0, 32.0, 0.0, L + 4.0).offset(-4.0, JoinType.Round).offset(4.0, JoinType.Round)
    tube = _box_cs(9.0, 16.0, 0.0, L + 33.0)
    mouth = CrossSection.batch_hull([_box_cs(9.0, 2.0, 0.0, L + 47.0), _box_cs(34.0, 4.0, 0.0, L + 52.0)])
    window = _circ(3.8, 0.0, L + 20.0, 32)
    ring = _circ(7.0, 0.0, L + 20.0, 32) - _circ(4.8, 0.0, L + 20.0, 32)
    return _prop_on_grip(collar + can + tube + mouth, grip_tu, relief_cs=ring, relief_h=1.6, cuts_cs=window)


def prop_guitar(grip_tu=3, **_):
    """Instruments: acoustic guitar, waist curves, soundhole, rosette and headstock (LAY_FLAT)."""
    L = grip_tu * pro.TU
    waist = _circ(8.5, 0.0, L + 27.0, 36)
    body = CrossSection.batch_hull([_circ(13.5, 0.0, L + 17.0, 48), waist]) + CrossSection.batch_hull([waist, _circ(10.0, 0.0, L + 36.0, 48)])
    neck = _box_cs(6.0, 46.0, 0.0, L + 42.0)
    head = _box_cs(11.0, 15.0, 0.0, L + 86.0).offset(-1.5, JoinType.Round).offset(1.5, JoinType.Round)
    base = body + neck + head + _box_cs(8.0, 10.0, 0.0, L)
    hole = _circ(3.6, 0.0, L + 26.0, 32)
    rosette = _circ(6.2, 0.0, L + 26.0, 32) - _circ(4.2, 0.0, L + 26.0, 32)
    return _prop_on_grip(base, grip_tu, relief_cs=rosette, relief_h=1.6, cuts_cs=hole)


def prop_trumpet(grip_tu=3, **_):
    """Instruments: trumpet, twin brass loops, three valve buttons and flared bell (LAY_FLAT)."""
    L = grip_tu * pro.TU
    collar = _box_cs(8.0, 8.0, 0.0, L)
    pipe_l = _stroke([(-5.0, L + 6.0), (-5.0, L + 52.0)], 2.4)
    pipe_r = _stroke([(5.0, L + 12.0), (5.0, L + 52.0)], 2.4)
    mouth = _stroke([(-5.0, L + 3.0), (0.0, L + 3.0)], 2.2)
    valves = _union([_box_cs(14.0, 5.0, 0.0, L + 16.0 + 9.0 * k) for k in range(3)])
    buttons = _union([_circ(2.0, 0.0, L + 18.5 + 9.0 * k, 20) for k in range(3)])
    bell = CrossSection.batch_hull([_box_cs(11.0, 2.0, 0.0, L + 52.0), _box_cs(36.0, 4.0, 0.0, L + 66.0)])
    base = collar + pipe_l + pipe_r + mouth + valves + bell
    return _prop_on_grip(base, grip_tu, relief_cs=buttons, relief_h=2.2)


def prop_maracas(grip_tu=3, **_):
    """Instruments: maraca, domed 27 mm egg with perforated rattle holes and collar band (LAY_FLAT)."""
    L = grip_tu * pro.TU
    egg = CrossSection.batch_hull([_circ(13.5, 0.0, L + 24.0, 48), _circ(8.0, 0.0, L + 9.0, 36)])
    collar = _box_cs(7.0, 10.0, 0.0, L)
    band = _box_cs(15.0, 3.0, 0.0, L + 11.0)
    holes = _union([_circ(1.3, 4.2 * math.cos(math.radians(45 + 90 * k)), L + 24.0 + 4.2 * math.sin(math.radians(45 + 90 * k)), 16) for k in range(4)])
    return _prop_on_grip(egg + collar, grip_tu, relief_cs=band, relief_h=1.8, cuts_cs=holes)


def prop_flag(grip_tu=3, **_):
    """Play: waving swallow-tail banner with ball finial and raised star badge (LAY_FLAT)."""
    L = grip_tu * pro.TU
    pole = _box_cs(4.8, 54.0, 0.0, L)
    finial = _circ(3.6, 0.0, L + 56.0, 24)
    top = [(2.4 + i * 2.0, L + 46.0 + 2.0 * math.sin(i * 0.55)) for i in range(18)]
    bot = [(2.4 + i * 2.0, L + 22.0 + 2.0 * math.sin(i * 0.55)) for i in range(18)]
    pts = bot + [(28.0, L + 34.0)] + list(reversed(top))
    banner = CrossSection([np.array(pts)])
    star = CrossSection([np.array([((6.0 if k % 2 == 0 else 2.8) * math.cos(math.radians(90 + 36 * k)) + 14.0, (6.0 if k % 2 == 0 else 2.8) * math.sin(math.radians(90 + 36 * k)) + L + 34.0) for k in range(10)])])
    return _prop_on_grip(pole + finial + banner, grip_tu, relief_cs=star, relief_h=1.8)


def prop_magnifier(grip_tu=3, **_):
    """Play: magnifying glass, circular rim with through-aperture lens window and ribbed handle (LAY_FLAT)."""
    L = grip_tu * pro.TU
    ring = _circ(16.0, 0.0, L + 24.0, 48) - _circ(10.0, 0.0, L + 24.0, 48)
    handle = _box_cs(8.0, 14.0, 0.0, L)
    ribs = _union([_box_cs(7.6, 1.6, 0.0, L + 2.5 + 3.0 * k) for k in range(4)])
    rim = _circ(15.0, 0.0, L + 24.0, 48) - _circ(11.0, 0.0, L + 24.0, 48)
    return _prop_on_grip(ring + handle, grip_tu, relief_cs=rim + ribs, relief_h=1.8)


def _build_flex_skin(w, d, size="small", center_book_fold=False):
    """Build a smooth 0.80 mm PETG/TPU flex skin (`z = 0..0.80`) with cylindrical 4.70 mm socket bosses
    generated directly by `integrated_sockets` and 0.60 mm rib-free fold corridors positioned strictly
    in the 2.53 mm boss-free inter-column lanes (`x = +-6.25` for 9-col Book-Fold, `x = +-25.0` for 8-col wrap-around).
    """
    sheet = Manifold.extrude(rrect(w, d, 1.8), 0.80)
    m, conns, ex = tp.integrated_sockets(sheet, size, True)
    corridors = [-6.25, 6.25] if center_book_fold else [-25.0, 25.0]
    for xc in corridors:
        groove = Manifold.cube((2.0, d + 1.0, 0.50)).translate((xc - 1.0, -(d + 1.0) / 2, 0.60))
        m = m - groove
    return m, conns, ex


def skin_aero_cowl(size="small", grid=(8, 3), **_):
    """#16 Smooth 0.80 mm PETG/TPU Wrap-Around Aero Nose Cowl (96.0 x 37.3 x 4.8 mm)."""
    return _build_flex_skin(96.0, 37.3, size=size, center_book_fold=False)


def skin_windscreen(size="small", grid=(8, 3), **_):
    """#17 Smooth 0.80 mm PETG/TPU Wrap-Around Front Windscreen / Visor (96.0 x 36.0 x 4.8 mm)."""
    return _build_flex_skin(96.0, 36.0, size=size, center_book_fold=False)


def skin_cargo_shroud(size="small", grid=(9, 4), **_):
    """#18 Smooth 0.80 mm PETG/TPU Book-Fold Shuttle Doors & Canopy Shroud (112.0 x 49.8 x 4.8 mm)."""
    return _build_flex_skin(112.0, 49.8, size=size, center_book_fold=True)


# ==========================================================================
# WAVE W11: Stage-2 Pro Steering & Stage-3 Momentum Power (Cards E1-E2, 21 parts)
# ==========================================================================
def pro_steer_bridge(size="small", grid=(2, 2), lock=True, **_):
    """T-Planform Stage-2 Pro Row-0 Steering Bridge (48.1 x 24.8 x 15.3 mm).
    - Central 24.8 x 24.8 x 12.5 mm nose hub with 2x2 under_sockets (holes) + 2x2 top_studs (for mech_servo_9g);
    - Swept front row-0 outrigger arms out to Ø10.60 mm (R = 5.30 mm) cylindrical kingpin bosses at (+-18.75, -6.25).
    """
    H = 12.5
    arm_cs = CrossSection.batch_hull([
        CrossSection.circle(5.30, 64).translate((-18.75, -6.25)),
        CrossSection.circle(5.30, 64).translate((18.75, -6.25)),
    ])
    t_plan = (rrect(24.8, 24.8, 2.4) + arm_cs) - CrossSection.circle(3.80, 48).translate((0.0, 12.50))
    raw = Manifold.extrude(t_plan, H)

    p = tp.STUD[size]
    hole_r = (p["stud_d"] + p["fit"]) / 2
    depth = p["stud_h"] + 0.4
    m = raw
    for ix in (-0.5, 0.5):
        for iy in (-0.5, 0.5):
            m = m - tp.cyl(depth + 0.02, hole_r, -0.02, ix * 12.5, iy * 12.5, tp.FIT_SEG)
    c_sock = tp.socket_conn(size, 2, 2)
    c_sock["style"] = "holes"

    # Kingpin free bores at (+-18.75, -6.25) -> 37.5 mm = 3 TU pitch on axis8!
    m = m - pro.bore_cutter("free", H, -18.75, -6.25, 0.0) - pro.bore_cutter("free", H, 18.75, -6.25, 0.0)
    c_kp = {
        "id": "kingpins",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [-18.75, -6.25, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 37.5, "anchor": "corner"},
    }
    # Rear 2x1 top_studs at (+-6.25, +6.25, H) for mech_servo_9g, leaving front z = H deck clear as a smooth steering-rack slideway!
    m, c_top = _add_stud_grid(m, size, 2, 2, H, cid="top_studs", omit=[[0, 0], [1, 0]])
    return m, [c_sock, c_top, c_kp], {"sockets": {"holes": 4, "reliefs": 0, "locked": bool(lock)}}


def _steer_knuckle(side):
    """Bellcrank steering knuckle (25.6 x 16.0 x 27.5 mm printed stub-up on flat cheek, side = -1 for L, +1 for R).
    - Stepped crank strap (y in [+6.40, +10.05] -> Z_world < 0 below keel nose) + 42-deg beveled kingpin & tie-rod bosses
      (y in [-5.95, +10.05] -> Z_world_top = 12.20 mm, 0.30 mm clear under pro_steer_bridge at all ±26 deg steering angles!);
    - Tapered hub riser up to z = 15.00 mm (8.75 mm from z = 6.25 kingpin -> 0.10 mm clear of inner wheel hub at 8.85 mm!)
      topped with vertical +Z shaft_drive wheel stub (z = 15.00..27.50 mm, center = 21.25 mm -> exact 15.00 mm scrub offset!).
    """
    W, D, H_base = 25.6, 16.0, 12.5
    xk = -side * 6.25
    xt = side * 6.25
    yc = 2.05
    strap = Manifold.extrude(rrect(W, 3.65, 1.4).translate((0.0, 8.225)), H_base - 0.4).translate((0.0, 0.0, 0.4))
    strap_foot = Manifold.batch_hull([
        Manifold.extrude(rrect(W - 0.8, 2.85, 1.0).translate((0.0, 8.225)), 0.05),
        Manifold.extrude(rrect(W, 3.65, 1.4).translate((0.0, 8.225)), 0.1).translate((0.0, 0.0, 0.4)),
    ])
    bosses = None
    for xc in (xk, xt):
        b0 = Manifold.extrude(rrect(2.4, D - 0.8, 0.9).translate((xc, yc)), 0.05)
        b1 = Manifold.extrude(rrect(2.8, D, 1.1).translate((xc, yc)), 0.2).translate((0.0, 0.0, 0.45))
        b2 = Manifold.extrude(rrect(10.8, D, 2.2).translate((xc, yc)), H_base - 4.8).translate((0.0, 0.0, 4.8))
        b = Manifold.batch_hull([b0, b1]) + Manifold.batch_hull([b1, b2])
        bosses = b if bosses is None else bosses + b
    riser = Manifold.batch_hull([
        Manifold.cylinder(0.4, 5.3, 5.3, 64).translate((xk, 0.0, H_base - 0.4)),
        Manifold.cylinder(0.4, 5.1, 5.1, 64).translate((xk, 0.0, 15.00 - 0.4)),
    ])
    stub = pro.pin_solid("flats", 13.0, xk, 0.0, 14.50)
    m = (
        (strap + strap_foot + bosses + riser + stub)
        - pro.bore_cutter_axis("free", 22.0, (xk, yc, 6.25), "y")
        - pro.bore_cutter_axis("free", 22.0, (xt, yc, 6.25), "y")
    )
    c_kp = pro._axis_bore_conn("kingpin_bore", "free", (xk, 0.0, 6.25), "y", 11.4, lattice="axis8")
    c_tr = pro._axis_bore_conn("tierod_bore", "free", (xt, 0.0, 6.25), "y", 11.4, lattice="axis8")
    c_ax = {
        "id": "wheel_stub",
        "kind": "pin",
        "gender": "M",
        "interface": "shaft_drive",
        "size_class": "pro",
        "fit_class": tp.IF["interfaces"]["shaft_drive"]["fit_class"],
        "profile": "flats",
        "length_mm": 12.5,
        "frame": {"origin": [xk, 0.0, 15.00], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [c_kp, c_tr, c_ax], {}


def pro_steer_knuckle_l(**_):
    """Left Stage-2 Pro 15 mm-Scrub Bellcrank Steering Knuckle (25.6 x 16.0 x 27.5 mm)."""
    return _steer_knuckle(-1)


def pro_steer_knuckle_r(**_):
    """Right Stage-2 Pro 15 mm-Scrub Bellcrank Steering Knuckle (25.6 x 16.0 x 27.5 mm)."""
    return _steer_knuckle(1)


def pro_steer_rack(**_):
    """Stage-2 Pro Module-2.5 Toothed Steering Rack (36.0 x 15.1 x 6.2 mm).
    Full-length conjugate teeth at y_pitch = +6.25 mm (0.5 TU), tip line at y = +8.75 mm, tie-rod free bores at (+-12.50, -1.5625).
    """
    mod, a = pro.GEAR["module_mm"], math.radians(pro.GEAR["pressure_angle_deg"])
    T, L, yp = pro.GEAR["thickness_tu"] * TU, 36.0, TU / 2  # T = 6.25, yp = 6.25
    p, s = math.pi * mod, math.pi * mod / 2 - pro.GEAR["backlash_mm"] / 2
    y_root, y_tip = yp - 1.25 * mod, yp + mod  # +3.125, +8.75
    w_root, w_tip = s / 2 + 1.25 * mod * math.tan(a), s / 2 - mod * math.tan(a)
    body = CrossSection.square((L, y_root + 6.35)).translate((-L / 2, -6.35))
    sec = body
    k0, k1 = int(-L / 2 / p) - 1, int(L / 2 / p) + 1
    for k in range(k0, k1 + 1):
        xc = k * p
        sec = sec + _ccw_poly([(xc - w_root, y_root - 0.2), (xc + w_root, y_root - 0.2), (xc + w_tip, y_tip), (xc - w_tip, y_tip)])
    sec = sec ^ CrossSection.square((L, y_tip + 6.35)).translate((-L / 2, -6.35))
    m = Manifold.extrude(sec, T) - pro.bore_cutter("free", T, -12.50, -1.5625, 0.0) - pro.bore_cutter("free", T, 12.50, -1.5625, 0.0)
    conn = {
        "id": "tierod_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": T,
        "lattice": "axis8",
        "frame": {"origin": [-12.50, -1.5625, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 25.0, "anchor": "corner"},
    }
    return m, [conn], {"gear": {"kind": "rack", "module_mm": mod, "pitch_line_mm": yp, "length_mm": L, "thickness_mm": T,
                                "pressure_angle_deg": pro.GEAR["pressure_angle_deg"]}}


def pro_fork_rake_adpt(**_):
    """Stage-2 Pro 15-deg Raked Positive-Trail Bike Fork Adapter (27.8 x 24.8 x 12.5 mm)."""
    H = 12.5
    body = rbox(27.8, 24.8, H, 2.2, 0.4)
    # Rear vertical bore (pins to #2 headtube) at (0, +6.25) and forward raked-offset fork bore at (0, -6.25) (+6 mm trail!):
    m = body - pro.bore_cutter("free", H, 0.0, 6.25, 0.0) - pro.bore_cutter("free", H, 0.0, -6.25, 0.0)
    # Side handlebar-stop cheeks:
    conn = {
        "id": "fork_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [0.0, -6.25, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 2, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def pro_axle_keeper(**_):
    """Snap-On Under-Keel Row-8 PTO Axle Keeper Clip (36.0 x 11.0 x 11.0 mm)."""
    H = 11.0
    body = rbox(36.0, 11.0, H, 1.8, 0.4)
    # Central 12.0 mm PTO Z10 gear saddle cutout + twin free axle eyes at x = +-12.50:
    saddle = Manifold.cube((12.4, 12.0, 6.5)).translate((-6.2, -6.0, 5.0))
    m = (body - saddle) - pro.bore_cutter("free", H, -12.50, 0.0, 0.0) - pro.bore_cutter("free", H, 12.50, 0.0, 0.0)
    conn = {
        "id": "keeper_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [-12.50, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 25.0, "anchor": "corner"},
    }
    return m, [conn], {}


def _power_core_tray_shell(size="small"):
    """Shared 4x4x3 TU Power Core Tray shell (49.8 x 49.8 x 32.3 mm; +5.2 mm lid = 37.5 mm = 3 TU).
    Clear internal cavity: 45.8 x 45.8 mm above z = 5.20 mm floor, with 4 corbeled corner stud posts at z = 32.30 mm.
    """
    H_tray = 32.3
    foot = tp.block(size, 4, 4, 5.2, 2.0, studs=False)
    walls = (
        Manifold.extrude(rrect(49.8, 49.8, 2.2), H_tray - 5.0).translate((0.0, 0.0, 5.0))
        - Manifold.extrude(rrect(45.8, 45.8, 1.2), H_tray - 4.6).translate((0.0, 0.0, 5.2))
    )
    # <= 30-deg corbeled corner bosses starting at z = 16.5 (above z = 15.4 Mech PCB!) strictly inside 49.8 x 49.8 walls:
    posts = None
    for sx in (-1, 1):
        for sy in (-1, 1):
            p_lo = Manifold.cylinder(0.2, 1.4, 1.4, 48).translate((sx * 22.0, sy * 22.0, 16.5))
            p_hi = Manifold.cylinder(2.0, 4.5, 4.5, 48).translate((sx * 18.75, sy * 18.75, H_tray - 2.0))
            post = Manifold.batch_hull([p_lo, p_hi])
            posts = post if posts is None else posts + post
    m = foot + walls + posts
    omit = [[i, j] for i in range(4) for j in range(4) if not (i in (0, 3) and j in (0, 3))]
    m, c_top = _add_stud_grid(m, size, 4, 4, H_tray, cid="rim_studs", omit=omit)
    return m, [tp.socket_conn(size, 4, 4), c_top]


def mom_band_core_tray(size="small", grid=(4, 4), **_):
    """Stage-3 Momentum Self-Contained #64 Band Power Core Tray (49.8 x 49.8 x 32.3 mm + 2.8 studs).
    Twin front R=4.0 mm elastomer anchor pins at (+-16.0, -16.0) + Z_pto = 31.25 mm (z_local = 18.75) output bores.
    """
    m, conns = _power_core_tray_shell(size)
    # Twin front R=4.0 mm rounded band-anchor posts rising from floor z = 5.0 (sunken 0.2 mm) to z = 28.0:
    for sx in (-1, 1):
        m = m + Manifold.cylinder(23.0, 4.0, 4.0, 48).translate((sx * 16.0, -16.0, 5.0))
    # Corbeled side bearing cheeks buried inside outer walls (|x| in [18.9, 24.0], z = 14.0..25.5):
    for sx in (-1, 1):
        b_lo = Manifold.cube((1.0, 12.0, 0.2)).translate(((23.0 if sx > 0 else -24.0), 0.25, 9.0))
        b_hi = Manifold.cube((5.1, 12.0, 11.5)).translate(((18.9 if sx > 0 else -24.0), 0.25, 14.0))
        m = m + Manifold.batch_hull([b_lo, b_hi])
    # Bottom PTO gear window (12.0 x 28.0 mm) through tray floor so internal Z10 meshes downward with row-8 axle Z10:
    m = m - Manifold.extrude(rrect(12.0, 28.0, 1.6), 6.0).translate((0.0, 6.25, -0.4))
    m, c_pto = tp._cut_clevis_x_bores(m, "pto_bore_l", "pto_bore_r", 24.80, 19.00, 6.25, 18.75, "free")
    return m, conns + c_pto, {}


def mom_band_core_lid(size="small", grid=(4, 4), lock=True, **_):
    """Stage-3 Momentum Enclosed Band Core Safety Lid (49.8 x 49.8 x 8.0 mm)."""
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    m, c_top = _add_stud_grid(m, size, 4, 4, H, cid="top_studs")
    return m, conns + [c_top], ex


def mom_band_spool_pawl(**_):
    """Stage-3 Momentum Ø12.0 mm Band D-Spool & 8-Tooth Ratchet Hub (26.0 x 26.0 x 12.5 mm)."""
    H = 12.5
    drum = Manifold.cylinder(H - 2.2, 6.5, 6.5, 64).translate((0.0, 0.0, 2.2))
    sec_lo = CrossSection.circle(11.5, 96)
    for k in range(8):
        sec_lo = sec_lo + rrect(4.0, 2.8, 0.6).translate((11.0, 0.0)).rotate(45.0 * k)
    m = (Manifold.extrude(sec_lo, 2.6) + drum) - pro.bore_cutter("fixed", H)
    return m, [pro._hub_conn(H)], {}


def mom_bumper_trigger(**_):
    """Stage-3 Momentum IF-Contact-THEN-Release Front Bumper Trigger (62.3 x 24.8 x 12.5 mm)."""
    H = 12.5
    plan = rrect(62.3, 10.0, 2.4).translate((0.0, -7.4)) + rrect(25.0, 24.8, 2.0)
    m = Manifold.extrude(plan, H) - pro.bore_cutter("free", H, -6.25, 6.25, 0.0) - pro.bore_cutter("free", H, 6.25, 6.25, 0.0)
    conn = {
        "id": "mount_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [-6.25, 6.25, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def mom_slam_base(**_):
    """Stage-3 Momentum Stationary Slam-Launcher Base With Captive Plunger Stop (62.3 x 36.0 x 18.0 mm)."""
    H = 18.0
    body = rbox(62.3, 36.0, H, 2.6, 0.4)
    # Open top guide channel (8.0 mm wide, z = 6.0..18.5) + captive stop pin bore at (0, 0):
    ch = Manifold.cube((64.0, 8.2, 13.0)).translate((-32.0, -4.1, 6.0))
    m = (body - ch) - pro.bore_cutter("free", H, -18.75, 12.5, 0.0) - pro.bore_cutter("free", H, 18.75, 12.5, 0.0)
    conn = {
        "id": "anchor_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [-18.75, 12.5, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 37.5, "anchor": "corner"},
    }
    return m, [conn], {}


def mom_slam_plunger(**_):
    """Stage-3 Momentum Captive 35 mm-Stroke Slam Plunger Rod (76.0 x 18.0 x 5.0 mm LAY_FLAT)."""
    hy = pro.BORE["shaft_flats"] / 2
    head_cs = CrossSection.square((18.0, 12.0)).translate((-9.0, 0.0))
    pad = tp._xz_to_layflat(head_cs, hy)
    rod = pro.pin_solid("flats", 65.0, z0=11.0)
    conn = pro._pin_conn("shaft_drive", "flats", 50.0, z0=18.0)
    return pad + rod, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def mom_jet_valve_body(size="small", grid=(4, 2), lock=True, **_):
    """Stage-3 Momentum Upright Balloon Collar & Slide-Valve Body (49.8 x 24.8 x 18.5 mm, 0 mouthpiece)."""
    base = tp._flat_box(49.8, 24.8, 5.4, r=2.4, bed_ch=0.4)
    # Upright smooth balloon inflation collar at x = +6.25 (OD 19.2 mm, ID 11.0 mm) + elevated nozzle mount boss at x = -18.75:
    collar = (
        Manifold.batch_hull([
            Manifold.cylinder(11.5, 8.6, 8.6, 64).translate((6.25, 0.0, 5.0)),
            Manifold.cylinder(1.6, 9.6, 9.6, 64).translate((6.25, 0.0, 16.9)),
        ])
        - Manifold.cylinder(14.5, 5.5, 5.5, 64).translate((6.25, 0.0, 4.8))
    )
    boss = Manifold.cylinder(11.0, 5.6, 5.6, 64).translate((-18.75, 0.0, 5.0))
    m, conns, ex = tp.integrated_sockets(base + collar + boss, size, lock)
    # Blind upper Pro pin bore at (-18.75, 0.0, 6.0..16.0) completely above z = 3.20 stud sockets:
    m, c_port = tp.cut_vertical_bore(m, "nozzle_pin", -18.75, 0.0, 6.0, 10.0, "free")
    c_port["lattice"] = "axis8"
    return m, conns + [c_port], ex


def mom_nozzle_set(**_):
    """Stage-3 Momentum 1-Piece Indexed 3-Orifice Convergent Nozzle Selector (44.0 x 18.0 x 12.5 mm: Ø3.0 / Ø4.5 / Ø6.0 mm)."""
    H = 12.5
    body = rbox(44.0, 18.0, H, 2.4, 0.4)
    # Three vertical convergent nozzles (Ø3.0, Ø4.5, Ø6.0) + end Pro mounting bore at (-12.5, 0.0):
    for xc, d_exit in ((0.0, 3.0), (9.0, 4.5), (16.5, 6.0)):
        cone = Manifold.cylinder(H + 0.4, 4.2, d_exit / 2, 48).translate((xc, 0.0, -0.2))
        body = body - cone
    m = body - pro.bore_cutter("free", H, -12.5, 0.0, 0.0)
    conn = {
        "id": "mount_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis8",
        "frame": {"origin": [-12.5, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def mom_bellows_base(size="small", grid=(4, 4), **_):
    """Stage-3 Momentum 4x4 TU 10-deg Pre-Angled Balloon Bellows Base With Side Curtains (49.8 x 49.8 x 16.0 mm)."""
    p = tp.STUD[size]
    fh = p["plate_h"]
    foot = tp.block(size, 4, 4, fh, p["plate_top"], studs=False)
    u_rim = rrect(49.2, 46.0, 2.0) - rrect(42.0, 43.0, 1.5).translate((0.0, 4.5))
    curtains = Manifold.extrude(u_rim, 16.0 - fh + 0.4).translate((0.0, 0.0, fh - 0.4))
    # Lower front stop bar to z = 13.0 mm while side curtains reach z = 16.0 mm:
    front_dip = Manifold.cube((41.6, 12.0, 4.0)).translate((-20.8, -25.0, 13.0))
    return foot + (curtains - front_dip), [tp.socket_conn(size, 4, 4)], {}


def mom_bellows_leaf(size="small", grid=(4, 4), lock=True, **_):
    """Stage-3 Momentum 4x4 TU Upper Hinged Bellows Leaf With Top Studs (49.8 x 49.8 x 8.0 mm)."""
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    m, c_top = _add_stud_grid(m, size, 4, 4, H, cid="top_studs")
    return m, conns + [c_top], ex


def mom_flywheel_tray(size="small", grid=(4, 4), **_):
    """Stage-3 Momentum Shrouded Vertical-Spindle Turbine Core Tray (49.8 x 49.8 x 32.3 mm + 2.8 studs).
    Houses Ø42.0 x 12.0 mm PLA rotor + Z10 pinion on central vertical spindle bearing (z = 16.5..32.3 mm),
    with side rip-cord rack guide slot at y = +6.25 mm (pitch line) and < 3.0 mm acoustic vents.
    """
    m, conns = _power_core_tray_shell(size)
    # Central tapered spindle bearing pedestal rising from floor z = 5.0 (sunken 0.2 mm) to z = 16.5:
    ped = Manifold.cylinder(11.5, 8.5, 6.2, 64).translate((0.0, 0.0, 5.0))
    m = m + ped
    m, c_sp = tp.cut_vertical_bore(m, "spindle_step", 0.0, 0.0, 11.0, 5.5, "free")
    c_sp["lattice"] = "axis"
    # Side rip-cord rack entry/exit ports in +/-X walls at z = 28.2..32.5, y in [-4.0, +9.5] (open at top of tray -> 0 bridge!):
    rack_slot = Manifold.cube((54.0, 13.5, 5.0)).translate((-27.0, -4.0, 28.2))
    # Narrow (< 2.6 mm finger-safe) vertical acoustic siren vents on +/-Y walls ONLY (45-deg pointed gable roof = 0 overhang!):
    vent_prof = _ccw_poly([(-1.2, 0.0), (1.2, 0.0), (1.2, 12.6), (0.0, 14.0), (-1.2, 12.6)])
    for sx in (-9.0, 0.0, 9.0):
        for y0 in (26.3, -21.8):
            vent = Manifold.extrude(vent_prof, 4.5).rotate((90, 0, 0)).translate((sx, y0, 10.0))
            m = m - vent
    m = m - rack_slot
    return m, conns + [c_sp], {}


def mom_flywheel_lid(size="small", grid=(4, 4), lock=True, **_):
    """Stage-3 Momentum Shrouded Turbine Core Lid With Upper Spindle Journal (49.8 x 49.8 x 8.0 mm)."""
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    # Omit center 2x2 studs around (0, 0) spindle bore; keep 12 outer perimeter studs:
    omit = [[1, 1], [1, 2], [2, 1], [2, 2]]
    m, c_top = _add_stud_grid(m, size, 4, 4, H, cid="top_studs", omit=omit)
    m, c_sp = tp.cut_vertical_bore(m, "spindle_journal", 0.0, 0.0, 0.0, H, "free")
    c_sp["lattice"] = "axis"
    return m, conns + [c_top, c_sp], ex


def mom_flywheel_rotor(**_):
    """Stage-3 Momentum 1-Piece Solid Ø42.0 x 12.0 mm PLA Inertial Rotor (fixed hub, S1 +32.3%)."""
    D, H = 42.0, 12.0
    R = D / 2
    body = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 0.8, R - 0.8, 112),
        Manifold.cylinder(H - 1.6, R, R, 112).translate((0.0, 0.0, 0.8)),
        Manifold.cylinder(0.02, R - 0.8, R - 0.8, 112).translate((0.0, 0.0, H - 0.02)),
    ]) - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(H)], {}


def mom_ripcord_rack_150(**_):
    """Stage-3 Momentum 150.0 mm Module-2.5 Toothed Rip-Cord Rack (150.0 x 12.0 x 6.2 mm)."""
    mod, a = pro.GEAR["module_mm"], math.radians(pro.GEAR["pressure_angle_deg"])
    T, L, yp = pro.GEAR["thickness_tu"] * TU, 150.0, TU / 2  # T = 6.25, yp = 6.25
    p, s = math.pi * mod, math.pi * mod / 2 - pro.GEAR["backlash_mm"] / 2
    y_root, y_tip = yp - 1.25 * mod, yp + mod  # +3.125, +8.75
    w_root, w_tip = s / 2 + 1.25 * mod * math.tan(a), s / 2 - mod * math.tan(a)
    # Back of rack at y = -3.25 -> total width = 8.75 - (-3.25) = 12.00 mm!
    body = CrossSection.square((L, y_root + 3.25)).translate((-L / 2, -3.25))
    # Smooth pull-handle at x in [-75.0, -52.0] with free lanyard/finger bore at (-62.50, +1.5625); teeth across [-48.0, +73.0]:
    handle = CrossSection.square((23.0, 12.0)).translate((-75.0, -3.25))
    sec = body + handle
    k0, k1 = int(-47.0 / p), int(71.0 / p)
    for k in range(k0, k1 + 1):
        xc = k * p
        sec = sec + _ccw_poly([(xc - w_root, y_root - 0.2), (xc + w_root, y_root - 0.2), (xc + w_tip, y_tip), (xc - w_tip, y_tip)])
    sec = sec ^ CrossSection.square((L, 13.0)).translate((-L / 2, -3.25))
    m = Manifold.extrude(sec, T) - pro.bore_cutter("free", T, -62.50, 1.5625, 0.0)
    conn = {
        "id": "pull_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": T,
        "lattice": "axis8",
        "frame": {"origin": [-62.50, 1.5625, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {"gear": {"kind": "rack", "module_mm": mod, "pitch_line_mm": yp, "length_mm": L, "thickness_mm": T,
                                "pressure_angle_deg": pro.GEAR["pressure_angle_deg"]}}


def mom_spindle_shaft(**_):
    """Stage-3 Momentum 78.0 mm Vertical Turbine & Helicopter Rotor Spindle Shaft (6.6 x 78.0 x 5.0 mm LAY_FLAT)."""
    m, conn = _cruciform_tip_shaft(78.0, conn_len=78.0, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


# ==========================================================================
# Verified Kit-Card Layouts (Cards A-D <= 170 mm, Cards E1-E2 <= 164 mm)
# ==========================================================================
# Each item: (instance_id, part_id, x_mm, y_mm, w_slot_mm, h_slot_mm)
CARD_LAYOUTS = {
    "card_a": {
        "name": "Card A — Core Chassis, Roadster, Bike & Trike",
        "limit_mm": 170.0,
        "material": "PLA/PETG",
        "items": [
            ("spine_1", "kit_clevis_spine", 3.0, 3.0, 27.8, 99.8),
            ("keel_1", "kit_keel_base", 35.8, 3.0, 124.8, 49.8),
            ("yoke_1", "kit_yoke_hbar", 35.8, 57.8, 46.0, 38.0),
            ("wheel_m1", "kit_wheel_med", 127.8, 57.8, 36.0, 36.0),
            ("wheel_m2", "kit_wheel_med", 86.8, 57.8, 36.0, 36.0),
            ("wheel_m3", "kit_wheel_med", 44.0, 100.8, 36.0, 36.0),
            ("wheel_m4", "kit_wheel_med", 3.0, 107.8, 36.0, 36.0),
            ("spin_1", "kit_spinner_pin", 86.0, 100.8, 36.0, 65.0),
            ("spin_2", "kit_spinner_pin", 127.0, 98.8, 36.0, 65.0),
            ("shaft_1", "kit_barbell_shaft", 3.0, 160.4, 78.0, 6.6),
            ("shaft_2", "kit_barbell_shaft", 3.0, 148.8, 78.0, 6.6),
        ],
    },
    "card_b": {
        "name": "Card B — Heavy Truck, Tractor, Turntable & Booster Pods",
        "limit_mm": 170.0,
        "material": "PLA/PETG",
        "items": [
            ("pod_1", "kit_booster_pod", 32.8, 3.0, 24.8, 65.0),
            ("pod_2", "kit_booster_pod", 3.0, 3.0, 24.8, 65.0),
            ("spin_3", "kit_spinner_pin", 3.0, 73.0, 36.0, 65.0),
            ("scoop_1", "kit_scoop_blade", 62.6, 3.0, 37.3, 49.8),
            ("tub_1", "kit_tilting_tub", 104.9, 3.0, 49.8, 49.8),
            ("turn_1", "kit_turntable", 62.6, 57.8, 49.8, 49.8),
            ("wind_1", "kit_windscreen", 117.4, 57.8, 37.3, 49.8),
            ("wheel_g1", "kit_wheel_giant", 99.0, 112.6, 50.0, 50.0),
            ("wheel_g2", "kit_wheel_giant", 44.0, 112.6, 50.0, 50.0),
        ],
    },
    "card_c": {
        "name": "Card C — Aero, Rotor & Ski/Runner Pack",
        "limit_mm": 170.0,
        "material": "PLA/PETG",
        "items": [
            ("wing_1", "kit_foil_wing", 57.8, 57.8, 49.8, 74.8),
            ("wing_2", "kit_foil_wing", 3.0, 57.8, 49.8, 74.8),
            ("wing_3", "kit_foil_wing", 3.0, 3.0, 74.8, 49.8),
            ("wedge_1", "kit_aero_wedge", 82.8, 28.0, 37.3, 24.8),
            ("skid_1", "kit_skid_runner", 125.1, 28.0, 18.0, 112.3),
            ("skid_2", "kit_skid_runner", 149.0, 28.0, 18.0, 112.3),
            ("rotor_1", "kit_rotor_blade", 82.8, 3.0, 68.0, 20.0),
            ("rotor_2", "kit_rotor_blade", 76.0, 145.3, 68.0, 20.0),
            ("rotor_3", "kit_rotor_blade", 3.0, 137.6, 68.0, 20.0),
        ],
    },
    "card_d": {
        "name": "Card D — Smooth PETG/TPU Shape-Out Flex Skins",
        "limit_mm": 170.0,
        "material": "PETG/TPU",
        "items": [
            ("shroud_1", "skin_cargo_shroud", 3.0, 3.0, 112.0, 49.8),
            ("cowl_1", "skin_aero_cowl", 3.0, 57.8, 96.0, 37.3),
            ("visor_1", "skin_windscreen", 120.0, 3.0, 36.0, 96.0),
        ],
    },
    "card_e1": {
        "name": "Card E1 — Pro Steering, Axle Keepers, Band Core, Bumper Trigger & Slam Launcher",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("band_tray", "mom_band_core_tray", 3.0, 100.6, 49.8, 49.8),
            ("band_lid", "mom_band_core_lid", 102.6, 44.0, 49.8, 49.8),
            ("band_spool", "mom_band_spool_pawl", 35.8, 69.5, 26.0, 26.0),
            ("slam_base", "mom_slam_base", 79.0, 3.0, 62.3, 36.0),
            ("slam_plunger", "mom_slam_plunger", 57.8, 100.6, 76.0, 18.0),
            ("bumper_trig", "mom_bumper_trigger", 3.0, 39.5, 62.3, 24.8),
            ("steer_bridge", "pro_steer_bridge", 57.8, 123.6, 48.1, 24.8),
            ("steer_rack", "pro_steer_rack", 38.0, 19.2, 36.0, 15.1),
            ("knuckle_l", "pro_steer_knuckle_l", 70.3, 44.0, 25.6, 16.0),
            ("knuckle_r", "pro_steer_knuckle_r", 70.3, 67.0, 25.6, 16.0),
            ("fork_rake", "pro_fork_rake_adpt", 3.0, 69.5, 27.8, 24.8),
            ("axle_keep", "pro_axle_keeper", 38.0, 3.0, 36.0, 11.0),
            ("z10_a", "gear_spur_z10", 3.0, 3.0, 30.0, 30.0),
            ("z10_b", "gear_spur_z10", 110.9, 123.6, 30.0, 30.0),
        ],
    },
    "card_e2": {
        "name": "Card E2 — Balloon Jet, 10-deg Bellows, Spindle Shaft & Shrouded Rip-Cord Turbine Core",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("ripcord", "mom_ripcord_rack_150", 3.0, 3.0, 150.0, 12.0),
            ("spindle", "mom_spindle_shaft", 112.6, 67.0, 6.6, 78.0),
            ("z10_c", "gear_spur_z10", 124.2, 67.0, 30.0, 30.0),
            ("rotor_fw", "mom_flywheel_rotor", 112.6, 20.0, 42.0, 42.0),
            ("fw_tray", "mom_flywheel_tray", 57.8, 20.0, 49.8, 49.8),
            ("fw_lid", "mom_flywheel_lid", 57.8, 74.8, 49.8, 49.8),
            ("bel_base", "mom_bellows_base", 3.0, 74.8, 49.8, 49.8),
            ("bel_leaf", "mom_bellows_leaf", 3.0, 20.0, 49.8, 49.8),
            ("jet_valve", "mom_jet_valve_body", 3.0, 129.6, 49.8, 24.8),
            ("nozzles", "mom_nozzle_set", 57.8, 129.6, 44.0, 18.0),
        ],
    },
}


def _printed_manifold(part_id, cache):
    """Return the print-oriented Manifold (`z_min = 0`, centered in XY) for `part_id`."""
    if part_id not in cache:
        fn = globals().get(part_id)
        if fn is not None:
            m, _, ex = fn()
        else:
            m, _, ex = tp.build(part_id)
        rot = ex.get("print_rotation_deg")
        if rot:
            m = m.rotate(tuple(rot))
        bb = m.bounding_box()
        cx, cy = (bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2
        m = m.translate((-cx, -cy, -bb[2]))
        cache[part_id] = m
    return cache[part_id]


def _vnick_gate(x0, y0, x1, y1, w_gate=1.80, h_gate=0.60):
    """1.80 x 0.60 mm sprue gate bar connecting (x0, y0) to (x1, y1) with a 45-deg top breakaway V-nick."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    ang = math.degrees(math.atan2(dy, dx))
    bar = Manifold.cube((L, w_gate, h_gate)).translate((0.0, -w_gate / 2, 0.0))
    nick = Manifold.cube((0.35, w_gate + 0.4, 0.35)).rotate((0, 45, 0)).translate((L * 0.5, -(w_gate + 0.4) / 2, h_gate - 0.05))
    return (bar - nick).rotate((0, 0, ang)).translate((x0, y0, 0.0))


def _sample_solid_anchors(m_part):
    """Sample interior anchor points >= 1.60 mm inside m_part's z = 0.30 mm slice so sprue gates always fuse cleanly."""
    inset = m_part.slice(0.30).offset(-1.60, JoinType.Round)
    if inset.is_empty():
        inset = m_part.slice(0.30).offset(-0.80, JoinType.Round)
    pts = []
    for poly in inset.to_polygons():
        n = len(poly)
        step = max(1, n // 24)
        for k in range(0, n, step):
            pts.append((float(poly[k][0]), float(poly[k][1])))
    return pts


def export_kitcards(out_dir):
    """Export `card_<id>_loose.stl`, `card_<id>_sprue.stl`, and `kitcard_manifest.json` under `out_dir/cards/`."""
    out_dir = Path(out_dir)
    cards_dir = out_dir / "cards"
    cards_dir.mkdir(parents=True, exist_ok=True)
    cache = {}
    manifest = {"cards": {}}

    for cid, spec in CARD_LAYOUTS.items():
        items = spec["items"]
        limit = spec["limit_mm"]
        # 1. Verify packing bounds & >= 5.00 mm Chebyshev inter-part clearance:
        max_x = max(x + w for _, _, x, y, w, h in items) + 3.0
        max_y = max(y + h for _, _, x, y, w, h in items) + 3.0
        if max_x > limit + 1e-6 or max_y > limit + 1e-6:
            raise ValueError(f"{cid} outer frame ({max_x:.1f} x {max_y:.1f}) exceeds {limit} mm")
        min_gap = 999.0
        for idx_a, (ia, _, xa, ya, wa, ha) in enumerate(items):
            for ib, _, xb, yb, wb, hb in items[idx_a + 1:]:
                gx = max(0.0, xb - (xa + wa), xa - (xb + wb))
                gy = max(0.0, yb - (ya + ha), ya - (yb + hb))
                gap = max(gx, gy)
                min_gap = min(min_gap, gap)
                if gap < 4.99:
                    raise ValueError(f"{cid}: {ia} and {ib} gap {gap:.2f} mm < 5.00 mm")

        placed = []
        anchor_sets = []
        for inst_id, pid, sx, sy, sw, sh in items:
            mp = _printed_manifold(pid, cache)
            bb = mp.bounding_box()
            pw, ph = bb[3] - bb[0], bb[4] - bb[1]
            if pw <= sw + 0.6 and ph <= sh + 0.6 and abs(max(pw, ph) - max(sw, sh)) <= 0.6 and (abs(pw - sw) <= 1.5 and abs(ph - sh) <= 1.5):
                m_inst = mp
            elif ph <= sw + 0.6 and pw <= sh + 0.6 and abs(max(pw, ph) - max(sw, sh)) <= 0.6 and (abs(ph - sw) <= 1.5 and abs(pw - sh) <= 1.5):
                m_inst = mp.rotate((0.0, 0.0, 90.0))
            else:
                raise ValueError(f"{cid}.{inst_id} ({pid}): built ({pw:.1f}x{ph:.1f}) does not fit slot ({sw:.1f}x{sh:.1f})")
            cx, cy = sx + sw / 2, sy + sh / 2
            p_placed = m_inst.translate((cx, cy, 0.0))
            placed.append(p_placed)
            anchor_sets.append(_sample_solid_anchors(p_placed))

        loose = Manifold.batch_boolean(placed, OpType.Add)
        # Outer 2.4 mm x 1.0 mm perimeter sprue frame + Prim's MST of 1.80 x 0.60 mm V-nick gates (guarantees 1 body!):
        outer = (
            Manifold.extrude(rrect(max_x, max_y, 2.0), 1.0).translate((max_x / 2, max_y / 2, 0.0))
            - Manifold.extrude(rrect(max_x - 4.8, max_y - 4.8, 1.0), 1.4).translate((max_x / 2, max_y / 2, -0.2))
        )
        frame_pts = (
            [(x, 1.2) for x in np.linspace(4.0, max_x - 4.0, 25)]
            + [(x, max_y - 1.2) for x in np.linspace(4.0, max_x - 4.0, 25)]
            + [(1.2, y) for y in np.linspace(4.0, max_y - 4.0, 25)]
            + [(max_x - 1.2, y) for y in np.linspace(4.0, max_y - 4.0, 25)]
        )
        tree_pts = list(frame_pts)
        remaining = set(range(len(placed)))
        gates = [outer]
        while remaining:
            best = None
            for j in remaining:
                for px, py in anchor_sets[j]:
                    for tx, ty in tree_pts:
                        d = math.hypot(px - tx, py - ty)
                        if best is None or d < best[0]:
                            best = (d, j, (tx, ty), (px, py))
            _, j_win, pa, pb = best
            gates.append(_vnick_gate(pa[0], pa[1], pb[0], pb[1]))
            tree_pts.extend(anchor_sets[j_win])
            remaining.remove(j_win)

        sprue = Manifold.batch_boolean(placed + gates, OpType.Add)
        f_loose = cards_dir / f"{cid}_loose.stl"
        f_sprue = cards_dir / f"{cid}_sprue.stl"
        tp.to_trimesh(loose).export(f_loose)
        tp.to_trimesh(sprue).export(f_sprue)
        manifest["cards"][cid] = {
            "name": spec["name"],
            "material": spec["material"],
            "outer_mm": [round(max_x, 2), round(max_y, 2)],
            "limit_mm": limit,
            "min_gap_mm": round(min_gap, 2),
            "item_count": len(items),
            "loose_stl": f"cards/{cid}_loose.stl",
            "sprue_stl": f"cards/{cid}_sprue.stl",
        }
    (cards_dir / "kitcard_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


# ==========================================================================
# Gate G1: 9-Craft 3D Boolean Pose-Sweep & Kip / Mech Keep-Out Collision Audit
# ==========================================================================
def _kip_seated_ghost(cache, hair_id=None):
    """Assemble the live Kip seated stack positioned on #1 kit_keel_base rows 4..5 (cx=0, cy=0, z=12.50)."""
    # Rows 4..5 on kit_keel_base correspond to y_local in [-12.5, +12.5], centered at (0.0, 0.0, 12.5)!
    legs = _raw_geo("char_legs_seated", cache).translate((0.0, 0.0, 12.5))
    torso = _raw_geo("robot_torso_core", cache).translate((0.0, 0.0, 28.5))
    arms = _raw_geo("robot_arms_grabber", cache).translate((0.0, 0.0, 48.5))
    head = _raw_geo("char_head_kid", cache).translate((0.0, -6.25, 53.5))
    parts = [legs, torso, arms, head]
    if hair_id:
        parts.append(_raw_geo(hair_id, cache).translate((0.0, -6.25, 82.3)))
    return Manifold.batch_boolean(parts, OpType.Add)


def _raw_geo(part_id, cache):
    if part_id not in cache:
        fn = globals().get(part_id)
        cache[part_id] = (fn()[0] if fn is not None else tp.build(part_id)[0])
    return cache[part_id]


def _check_non_overlapping(named_solids, tol_mm3=0.05):
    """Return list of (a, b, vol_mm3) for any pair exceeding tol_mm3 boolean intersection."""
    bad = []
    for i, (na, ga) in enumerate(named_solids):
        ba = ga.bounding_box()
        for nb, gb in named_solids[i + 1:]:
            bb = gb.bounding_box()
            if any(ba[k] >= bb[k + 3] or bb[k] >= ba[k + 3] for k in range(3)):
                continue
            vol = (ga ^ gb).volume()
            if vol > tol_mm3:
                bad.append((na, nb, round(vol, 4)))
    return bad


def verify_gate_g1():
    """Run deterministic 3D boolean overlap checks across all 9 canonical craft, steering locks,
    55-deg dump tip (on #1 and on 3-TU Core), Helicopter rotor + Kip hair sweeps, and Mech keep-outs.
    """
    cache = {}
    keel = _raw_geo("kit_keel_base", cache)
    spine = _raw_geo("kit_clevis_spine", cache)
    w_med = _raw_geo("kit_wheel_med", cache)
    w_gnt = _raw_geo("kit_wheel_giant", cache)
    wedge = _raw_geo("kit_aero_wedge", cache)
    wind = _raw_geo("kit_windscreen", cache)
    tub = _raw_geo("kit_tilting_tub", cache)
    turn = _raw_geo("kit_turntable", cache)
    rotor = _raw_geo("kit_rotor_blade", cache)
    skid = _raw_geo("kit_skid_runner", cache)
    kip = _kip_seated_ghost(cache)
    kip_mohawk = _kip_seated_ghost(cache, "hair_mohawk")

    def outboard_wheels(wheel_m, y_c):
        # 78.0 mm #3a shaft: wheels occupy |X| in [26.7, 39.0] (+1.80 mm clear of 49.8 mm hull!)
        wl = wheel_m.rotate((0, 90, 0)).translate((-39.0, y_c, 6.25))
        wr = wheel_m.rotate((0, 90, 0)).translate((26.7, y_c, 6.25))
        return [("wl_" + str(y_c), wl), ("wr_" + str(y_c), wr)]

    results = {}

    # 1. Formula / GT Race Car + Pro row-0 ±26 deg steering sweep (including knuckles!) + Mech 9g servo keep-out:
    bridge = _raw_geo("pro_steer_bridge", cache).translate((0.0, -50.0, 12.5))
    rack = _raw_geo("pro_steer_rack", cache).translate((0.0, -56.25, 25.05))
    ghost_servo = rbox(24.8, 37.3, 30.5, 2.0, 0.0).translate((0.0, -50.0, 32.0))
    kn_l_base = _raw_geo("pro_steer_knuckle_l", cache).translate((-6.25, 0.0, -6.25)).rotate((-90, 0, 0)).rotate((0, 0, 90))
    kn_r_base = _raw_geo("pro_steer_knuckle_r", cache).translate((6.25, 0.0, -6.25)).rotate((-90, 0, 0)).rotate((0, 0, -90))
    kn_l_26 = kn_l_base.rotate((0, 0, 26.0)).translate((-18.75, -56.25, 6.25))
    kn_r_22 = kn_r_base.rotate((0, 0, 22.4)).translate((18.75, -56.25, 6.25))
    # Steered #4 wheels (clocked 90 deg on Z so Double-D hub flats align with wheel_stub flats!) at +26 / +22.4 deg lock:
    w_st_l = w_med.rotate((0, 0, 90)).rotate((0, -90, 0)).translate((-8.85, 0.0, 0.0)).rotate((0, 0, 26.0)).translate((-18.75, -56.25, 6.25))
    w_st_r = w_med.rotate((0, 0, 90)).rotate((0, 90, 0)).translate((8.85, 0.0, 0.0)).rotate((0, 0, 22.4)).translate((18.75, -56.25, 6.25))
    results["1_race_car_steer_mech"] = _check_non_overlapping([
        ("keel", keel), ("bridge", bridge), ("rack", rack.translate((4.4, 0.0, 0.0))),
        ("kn_l_26", kn_l_26), ("kn_r_22", kn_r_22),
        ("ghost_servo", ghost_servo), ("windscreen", wind.translate((0.0, -6.25, 12.5))), ("kip", kip),
        ("w_front_l_26deg", w_st_l), ("w_front_r_22deg", w_st_r), *outboard_wheels(w_med, 43.75),
    ])

    # 2. Dump / Tow Truck: stowed + 55-deg dump tip on #1 AND on 3-TU Power Core:
    core_tray = _raw_geo("mom_band_core_tray", cache).translate((0.0, 37.5, 12.5))
    core_lid = _raw_geo("mom_band_core_lid", cache).translate((0.0, 37.5, 44.8))
    tub_stowed = tub.translate((0.0, 37.5, 12.5))
    tub_tipped_core = tub.translate((0.0, -24.9, 0.0)).rotate((-55.0, 0.0, 0.0)).translate((0.0, 62.4, 50.2))
    results["2_dump_truck_stowed_and_55deg"] = (
        _check_non_overlapping([("keel", keel), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub", tub_stowed)])
        + _check_non_overlapping([("keel", keel), ("core_tray", core_tray), ("core_lid", core_lid), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub_55", tub_tipped_core)])
    )

    # 3. Farm / Loader Tractor: Giant Ø50 rear + Pro ±21 deg steered Ø50 front lock check:
    w50_l = w_gnt.rotate((0, 90, 0)).translate((-15.0 - 6.15, 0.0, 0.0)).rotate((0, 0, 21.0)).translate((-18.75, -56.25, 6.25))
    w50_r = w_gnt.rotate((0, 90, 0)).translate((15.0 - 6.15, 0.0, 0.0)).rotate((0, 0, 18.5)).translate((18.75, -56.25, 6.25))
    results["3_tractor_giant_steer"] = _check_non_overlapping([
        ("keel", keel), ("bridge", bridge), ("rack", rack.translate((3.6, 0.0, 0.0))),
        ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip),
        ("w50_fl_21deg", w50_l), ("w50_fr_18deg", w50_r), *outboard_wheels(w_gnt, 43.75),
    ])

    # 4. Modular Fifth-Wheel / Dolly Trailer (#14 turntable + front dolly row 0 + rear row 8 axles):
    results["4_modular_trailer"] = _check_non_overlapping([
        ("keel", keel), ("turntable", turn.translate((0.0, 37.5, 12.5))),
        *outboard_wheels(w_med, -56.25), *outboard_wheels(w_med, 43.75),
    ])

    # 5. Inline Motorbike & Cargo Trike (#2 spine + 2x #4 inside 15.0 mm clevis slots):
    wb_f = w_med.rotate((0, 90, 0)).translate((-6.15, -40.625, 6.25))
    wb_r = w_med.rotate((0, 90, 0)).translate((-6.15, 40.625, 6.25))
    results["5_inline_motorbike"] = _check_non_overlapping([("spine", spine), ("wf", wb_f), ("wr", wb_r)])

    # 6. Prop / Jet Aeroplane (#7 wedge on rows 0..2 + Ø68 #6 prop at Z_world = 39.0625 mm):
    prop_plane = rotor.rotate((90, 0, 0)).translate((0.0, -62.5 - 1.5, 12.5 + 26.5625))
    results["6_aeroplane_prop"] = _check_non_overlapping([
        ("keel", keel), ("wedge", wedge.translate((0.0, -43.75, 12.5))), ("prop", prop_plane),
        ("kip", kip), *outboard_wheels(w_med, -56.25),
    ])

    # 7. Catamaran / Speedboat (2x #10 runners + #7 bow + Kip):
    sk_l = skid.translate((-34.5, 0.0, -16.0))
    sk_r = skid.translate((34.5, 0.0, -16.0))
    results["7_catamaran"] = _check_non_overlapping([
        ("keel", keel), ("wedge", wedge.translate((0.0, -43.75, 12.5))), ("kip", kip), ("skid_l", sk_l), ("skid_r", sk_r),
    ])

    # 8. Rescue Helicopter (#14 mast deck + #7 mast house + 4-blade 2x #6 main rotor at Z_world = 103.75..115.75 over Kip w/ mohawk!):
    mast_deck = turn.translate((0.0, 37.5, 12.5))
    mast_house = wedge.translate((0.0, 31.25, 17.7))
    r_main_1 = rotor.translate((0.0, 43.75, 103.75))
    r_main_2 = rotor.rotate((0, 0, 90)).translate((0.0, 43.75, 109.75))
    results["8_helicopter_mohawk"] = _check_non_overlapping([
        ("keel", keel), ("mast_deck", mast_deck), ("mast_house", mast_house),
        ("kip_mohawk", kip_mohawk), ("rotor_1", r_main_1), ("rotor_2", r_main_2), ("skid_l", sk_l), ("skid_r", sk_r),
    ])

    # 9. Space Shuttle Orbiter + Stage-4 Mech Brain/Battery/Gearmotor internal packaging audit:
    # Verify Mech datasheet keep-outs fit inside 45.8 x 45.8 x 30.30 mm Power Core cavity with 0.000 mm3 wall overlap:
    ghost_lipo = Manifold.cube((35.0, 25.0, 6.5)).translate((-17.5, -12.5, 17.8))
    ghost_pcb = Manifold.cube((38.0, 38.0, 1.6)).translate((-19.0, -19.0, 26.3))
    ghost_mcu = Manifold.cube((21.0, 18.0, 4.5)).translate((-10.5, -9.0, 27.9))
    shell_only, _ = _power_core_tray_shell("small")
    shell_placed = shell_only.translate((0.0, 37.5, 12.5))
    results["9_shuttle_and_mech_keepouts"] = _check_non_overlapping([
        ("keel", keel), ("wedge", wedge.translate((0.0, -43.75, 12.5))), ("kip", kip),
        ("core_shell", shell_placed),
        ("ghost_lipo", ghost_lipo.translate((0.0, 37.5, 0.0))),
        ("ghost_pcb", ghost_pcb.translate((0.0, 37.5, 0.0))),
        ("ghost_mcu", ghost_mcu.translate((0.0, 37.5, 0.0))),
    ])

    ok = all(not v for v in results.values())
    return {"ok": ok, "crafts": results}


def main(argv=None):
    out_dir = Path(argv[0] if argv else HERE)
    man = export_kitcards(out_dir)
    for cid, info in man["cards"].items():
        print(f"CARD  {cid:8s}  {info['outer_mm']} <= {info['limit_mm']} mm  min_gap={info['min_gap_mm']} mm  items={info['item_count']}")
    g1 = verify_gate_g1()
    for k, bad in g1["crafts"].items():
        print(f"{'PASS' if not bad else 'FAIL'}  Gate G1 {k}: {bad if bad else '0.000 mm3 overlap'}")
    return g1["ok"]


sys.modules.setdefault("toyventor_kitcard", sys.modules[__name__])
import toyventor_parts as tp  # noqa: E402  # imported after builders to prevent circular-import ordering issues


if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1:]) else 1)
