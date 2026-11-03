#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""ToyVentor Flat-Pack Modular Craft, Progressive Power & Drop-In Pro Powered Add-On Kit-Cards (Waves W10, W11, W13).

Implements:
  - Wave W10 (Cards A-D, 19 parts): 16 rigid Snap/Pro modular craft modules (including enclosed barrel hinge knuckles on #11 dump tub)
    + 3 smooth 0.80 mm PETG/TPU flex skins (printed show-face-down on z = 0) unlocking all 9 canonical craft.
  - Wave W11 (Cards E1-E3, 30 parts): captive Stage-2 Pro row-0 Ackermann rack steering linkage (bridge with fixed kingpins,
    rack guide and travel stop, rack, tall-tower knuckles, tie-rod link, headed captive drive pins, steering column and wheel),
    rear barrel dump-tub hinge adapter, raked bike fork adapter, and functional Motion stored-energy cores.
  - Wave W13 (Card F, 11 parts): PETG Add-On drop-in RC and robotics housings for N20 micro gearmotors, 9g micro servos
    (stock nylon horn capture, zero printed micro-splines), XIAO ESP32 / H-bridge electronics, and tool-locked 1S LiPo cells.
  - Kit-card plate exporter (`export_kitcards`) producing `card_<id>_loose.stl` and `card_<id>_sprue.stl` across Cards A-F.
  - Gate G1 (`verify_gate_g1`): deterministic 3D boolean pose-sweep, pneumatic air-path connectivity, and COTS Pro Powered Add-On keep-out audit.

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
    outer = pro._tapered_dd_extrude(pro.BORE["shaft_d"], pro.BORE["shaft_flats"], total_len, bot_tip=True, top_tip=False).translate((0.0, 0.0, z0))
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
    - rows 6..9: 49.8 mm rear power/cargo bay (10 perimeter studs) + 10.0 x 31.4 mm PTO through-slot;
    - Closed 360-deg z_axle = 6.25 mm Pro `free` through-bores at row 0 and rows 7, 8 + rear transom hinge mortises.
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

    # Closed z_axle = 6.25 mm horizontal Pro `free` axle through-bores at row 0 (nose) and rows 7, 8 (rear cheeks):
    m, c_a0 = tp.cut_x_axle_bore(m, "axle_row0", -56.25, 6.25, 24.8, "free")
    m, c_a7 = tp._cut_clevis_x_bores(m, "axle_row7_l", "axle_row7_r", 24.9, 5.0, 31.25, 6.25, "free")
    m, c_a8 = tp._cut_clevis_x_bores(m, "axle_row8_l", "axle_row8_r", 24.9, 5.0, 43.75, 6.25, "free")

    # Twin support-free rear transom mortise pockets at x = +-12.50, y in [54.40, 62.60], z = 4.40..7.70 (+ 48-deg gable to 10.25):
    mort_prof = _ccw_poly([(-2.30, 4.40), (2.30, 4.40), (2.30, 7.70), (0.0, 10.25), (-2.30, 7.70)])
    for sx in (-1, 1):
        mort = Manifold.extrude(mort_prof, 8.20).rotate((90, 0, 0)).translate((sx * 12.50, 62.60, 0.0))
        m = m - mort

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
    return m, [c_top, c_steer, c_a0, *c_a7, *c_a8], {}


def kit_clevis_spine(size="small", grid=(2, 8), **_):
    """#2 Universal 2x8 TU Clevis Spine (27.8 x 99.8 x 15.3 mm).
    Twin 15.0 mm end clevis slots with 6.4 mm free-bore cheeks (y = +-40.625, z = 6.25),
    central 2x2 saddle studs, vertical front steering headtube bore, and closed horizontal kickstand bore.
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

    # Central 2x2 saddle studs at cy = +6.25 (y = 0.0, +12.5):
    m, c_top = _add_stud_grid(m, size, 2, 2, H, cx=0.0, cy=6.25, cid="top_studs")
    # Vertical front steering bore at (0.0, -12.50) = -1.0 TU (+6.8 mm to Ø36 tire, 8.0 mm solid web to slot_f):
    m, c_head = tp.cut_vertical_bore(m, "headtube", 0.0, -12.5, 0.0, H, "free")
    c_head["lattice"] = "centre"
    # Closed horizontal kickstand / outrigger Pro `free` through-bore across central waist at (y = +12.5, z = 6.25):
    m, c_ks = tp.cut_x_axle_bore(m, "kickstand_bore", 12.5, 6.25, 24.8, "free")
    # Double-cheek clevis bores at y = +-40.625 (+-26/8 TU), z = 6.25 (4/8 TU), strictly inside +-13.90 cheeks:
    m, c_cf = tp._cut_clevis_x_bores(m, "clevis_front_l", "clevis_front_r", 13.80, 7.60, -40.625, 6.25, "free")
    m, c_cr = tp._cut_clevis_x_bores(m, "clevis_rear_l", "clevis_rear_r", 13.80, 7.60, 40.625, 6.25, "free")
    return m, [c_top, c_head, c_ks, *c_cf, *c_cr], {}


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


# Free-hub front wheel. A Double-D stub in the keyed wheels' Double-D bore is a key (the wheel could only rock +-1.35 deg), so the STEERED front wheels
# (Pro and the Pro add-on) turn on a round pin_free stub instead: a round free bore plus an O8.0 x 2.0 snap counterbore in the outer face that takes the
# stub's barb (see _barbed_wheel_stub). The rear and Snap/Motion wheels stay keyed (they drive the axle). Same tyre, same envelope, so every sweep holds.
FREE_HUB_CB_D, FREE_HUB_CB_DEPTH = 8.0, 2.0


def _wheel_bore(hub_kind, H):
    if hub_kind == "fixed":
        return pro.bore_cutter("fixed", H)
    cb = Manifold.cylinder(FREE_HUB_CB_DEPTH + 0.2, FREE_HUB_CB_D / 2, FREE_HUB_CB_D / 2, 64).translate((0.0, 0.0, H - FREE_HUB_CB_DEPTH))
    return pro.bore_cutter("free", H) + cb


def _wheel_hub_conn(hub_kind, H):
    c = pro._hub_conn(H)
    return {**c, "bore_class": "free"} if hub_kind == "free" else c


def _wheel_med(hub_kind):
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
    body = (tire - dish + hub + spokes) - _wheel_bore(hub_kind, H)
    return body, [_wheel_hub_conn(hub_kind, H)], {}


def kit_wheel_med(**_):
    """#4 Medium 1-TU Modular Wheel (36.0 x 36.0 x 12.3 mm, 5.25 mm fixed hub)."""
    return _wheel_med("fixed")


def kit_wheel_med_free(**_):
    """#4f Medium 1-TU Free-Hub Front Wheel (36.0 x 36.0 x 12.3 mm, round free hub + O8.0 snap counterbore for the steering knuckle's barbed stub)."""
    return _wheel_med("free")


def _wheel_giant(hub_kind):
    """#5 Giant 1-TU Tractor / Monster / Paddle Wheel (50.0 x 50.0 x 12.3 mm, fixed or free hub + 4x O7.0 face bores).

    Dished like the medium wheel: a four-arm cross carries the hub and the four crank bosses, between them four open windows down to a 5.8 mm floor,
    inside a stepped-tread tyre. The whole wheel is the old solid disc with material REMOVED (nothing added outside the old envelope: the new solid
    is intersected with the old tyre hull), so the envelope is the old wheel's, and it prints face-down on z = 0 without supports (the pocket walls
    lean outward going up; the arms and bosses rise from the floor; every tread groove that opens onto the bed has a gabled roof, see below).
    Checked in OrcaSlicer 2.4.2 with the Ender-3 Pro profile (supports on, auto, 30 deg): 0 support and 0 overhang-wall moves."""
    D, H = 50.0, 12.3
    R = D / 2
    hull = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 1.6, R - 1.6, 112),
        Manifold.cylinder(H - 3.4, R, R, 112).translate((0.0, 0.0, 1.7)),
        Manifold.cylinder(0.02, R - 1.8, R - 1.8, 112).translate((0.0, 0.0, H - 0.02)),
    ])
    # Staggered shoulder blocks: 20 stations, lower-half grooves and upper-half grooves offset by half a pitch, a continuous centre rib between.
    # (A chevron would be handed: the left and right wheels are the same part turned round, so it would point the wrong way on one side.
    # This pattern looks the same from either side.)
    tire = hull
    # The lower-half grooves open onto the bed, so a flat 1.9 mm roof gets slicer supports (OrcaSlicer 2.4.2, supports auto at 30 deg: 3400 support moves
    # in the 20 notches, which the part gate's ledge check missed because each roof is held on both sides). Each groove therefore has a steep gable:
    # vertical walls to 5.05 mm, then roof faces rising 1.1 mm over 0.95 mm (49 deg from flat, normal z -0.66 against the -0.707 limit) to a ridge at
    # 6.15 mm, the old roof height.
    groove = Manifold.batch_hull([
        Manifold.cube((2.6, 1.9, 5.05 + 0.7)).translate((R - 1.5, -0.95, -0.7)),
        Manifold.cube((2.6, 0.02, 0.02)).translate((R - 1.5, -0.01, H / 2 - 0.01)),
    ])
    groove_hi = Manifold.cube((2.6, 1.9, H / 2 + 0.7)).translate((R - 1.5, -0.95, H / 2))
    for k in range(20):
        tire = tire - groove.rotate((0.0, 0.0, 18.0 * k)) - groove_hi.rotate((0.0, 0.0, 18.0 * k + 9.0))
    # Dished face: conical pocket, floor O34.8 at z 5.8 opening to O42.8 at the top, leaving a 1.8 mm rim at the top edge.
    dish = Manifold.batch_hull([
        Manifold.cylinder(0.05, 17.4, 17.4, 112).translate((0.0, 0.0, 5.8)),
        Manifold.cylinder(0.8, 21.4, 21.4, 112).translate((0.0, 0.0, H - 0.5)),
    ])
    body = tire - dish
    # Hub collar, four arms along the axes (11.2 wide: a 2.1 mm wall round each O7.0 crank bore) and a domed boss on each bore.
    hub = Manifold.cylinder(H, 7.4, 7.4, 64)
    arms = None
    for k in range(4):
        arm = rbox(11.2, 20.0, 5.7, 1.2, 0.3).translate((0.0, 15.0, 5.0)).rotate((0.0, 0.0, 90.0 * k))
        arms = arm if arms is None else arms + arm
    bosses = None
    for x, y in [(-TU, 0.0), (TU, 0.0), (0.0, -TU), (0.0, TU)]:
        b = Manifold.cylinder(H - 0.8 - 5.8, 5.6, 5.0, 64).translate((x, y, 5.8))
        bosses = b if bosses is None else bosses + b
    body = body + ((hub + arms + bosses) ^ hull)
    # The arms start at z 5.0 and fill the top of the lower groove at the four axis stations, which would leave a flat 5.0 mm roof: cut the gabled
    # lower grooves again so all 20 stations are self-supporting.
    for k in range(20):
        body = body - groove.rotate((0.0, 0.0, 18.0 * k))
    body = body - _wheel_bore(hub_kind, H)
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
    return body, [_wheel_hub_conn(hub_kind, H), c_crank], {}


def kit_wheel_giant(**_):
    """#5 Giant 1-TU Tractor / Monster / Paddle Wheel (50.0 x 50.0 x 12.3 mm, fixed hub + 4x O7.0 face bores)."""
    return _wheel_giant("fixed")


def kit_wheel_giant_free(**_):
    """#5f Giant 1-TU Free-Hub Front Wheel (50.0 x 50.0 x 12.3 mm, round free hub + O8.0 snap counterbore + 4x O7.0 face bores)."""
    return _wheel_giant("free")


def kit_barbell_shaft_wide(**_):
    """#3c Wide-Track Barbell Shaft (6.6 x 103.0 x 5.0 mm LAY_FLAT): the 78.0 mm barbell's long brother. 49.8 mm keel + 2 x (24.8 mm drum + 1.8 mm gap)
    = 103.0 mm, so a 2 TU road-roller drum, or a 12.3 mm wheel plus a 12.3 mm dozer arm, fits outboard of the keel on each side."""
    m, conn = _cruciform_tip_shaft(103.0, conn_len=103.0, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def kit_barbell_shaft_9tu(**_):
    """#3d 9 TU Dozer Barbell Shaft (6.6 x 112.5 x 5.0 mm LAY_FLAT): the bulldozer's rear axle. A medium wheel (12.3 mm), a 1.0 mm gap and a 12.5 mm kit
    beam (the lift arm) fit outboard of the 49.8 mm keel on each side: 2 x (39.0 + 1.0 + 12.5) = 105.0 mm, and 112.5 mm = 9 TU leaves 3.75 mm of shaft beyond
    each beam for a retainer (not designed yet). The 103.0 mm wide-track shaft would leave the beam touching the wheel face (39.0 + 12.5 = 51.5)."""
    m, conn = _cruciform_tip_shaft(112.5, conn_len=112.5, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def kit_drum_roller(**_):
    """#5b Smooth 2-TU Road-Roller Drum (50.0 x 50.0 x 24.8 mm, fixed hub). A smooth tyre-less drum, dished from the open face like the wheels so it is
    about a third of the mass of a solid one: a 4.0 mm floor on the bed side, a hub collar and four ribs, inside a 2.4 mm wall. Prints face-down on z = 0
    with no overhang (the pocket wall leans outward going up; hub and ribs rise from the floor)."""
    D, H = 50.0, 24.8
    R = D / 2
    hull = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 1.6, R - 1.6, 112),
        Manifold.cylinder(H - 3.2, R, R, 112).translate((0.0, 0.0, 1.6)),
        Manifold.cylinder(0.02, R - 1.6, R - 1.6, 112).translate((0.0, 0.0, H - 0.02)),
    ])
    dish = Manifold.batch_hull([
        Manifold.cylinder(0.05, 20.2, 20.2, 112).translate((0.0, 0.0, 4.0)),
        Manifold.cylinder(0.8, 22.6, 22.6, 112).translate((0.0, 0.0, H - 0.5)),
    ])
    body = hull - dish
    hub = Manifold.cylinder(H, 7.4, 7.4, 64)
    ribs = None
    for k in range(4):
        rib = rbox(5.0, 20.0, H - 4.0 - 2.0, 1.0, 0.3).translate((0.0, 15.0, 4.0)).rotate((0.0, 0.0, 90.0 * k))
        ribs = rib if ribs is None else ribs + rib
    body = body + ((hub + ribs) ^ hull)
    body = body - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(H)], {}


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
    - 2x3 self-roofing conical socket_small base;
    - Horizontal 50-deg teardrop front free prop_bore at z_local = 26.5625 mm (17/8 TU, depth 23.0 mm);
    - Vertical top free mast_bore at (0.0, +12.50, 20.25..33.25 mm, depth 13.0 mm).
    """
    p = tp.STUD[size]
    fh = p["plate_h"]
    foot = rbox(24.8, 37.3, fh, p["edge_r"], p["bed_chamfer"])
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
    cut_s = tp._conical_socket_cutter(p)
    m = m - tp.union([cut_s.translate(((i - 0.5) * p["pitch"], (j - 1.0) * p["pitch"], 0.0)) for i in range(2) for j in range(3)])
    return m, [tp.socket_conn(size, 2, 3), c_prop, c_mast], {}


def kit_windscreen(size="small", grid=(4, 3), lock=True, **_):
    """#8 Open-Top Windscreen & Wire-Trough Sill Frame (49.8 x 37.3 x 23.5 mm).
    - 12.3 mm side bolsters on cols 0, 3 leaving 25.20 mm clear inner Kip leg/torso corridor;
    - 8 integrated stud holes (row 3 all 4 cols + rows 4..5 cols 0, 3);
    - 6.0 x 4.1 mm open-top wire troughs above conical socket ceilings (z = 7.4..11.5 mm);
    - Swept open-top front windscreen pillars rising to z = 20.7 mm (+ 2.8 mm corner studs = 23.5 mm).
    """
    u_plan = rrect(49.8, 37.3, 2.2) - rrect(25.2, 28.0, 1.6).translate((0.0, 7.65))
    base_u = Manifold.extrude(u_plan, 6.4)
    mid_plan = rrect(49.6, 37.1, 2.1) - rrect(25.4, 30.6, 1.6).translate((0.0, 6.45))
    mid_u = Manifold.extrude(mid_plan, 5.4).translate((0.0, 0.0, 6.0))
    # Front cowl rising from z = 10.4 to 20.7 (strictly inset inside mid_plan, y_rear = -8.95 -> +0.50 mm ahead of Kip toes!):
    cowl_hi = Manifold.extrude(rrect(49.4, 9.5, 2.0).translate((0.0, -13.70)), 10.3).translate((0.0, 0.0, 10.4))
    # Pinion dip: floor at z = 12.5 (world 25.0 on the keel) so the Z10 steering pinion, which now runs 0.2 mm above the bridge deck at
    # world z = 25.2, clears the cowl (the floor used to sit at z = 15.5, world 28.0, the old pinion height).
    dip = Manifold.extrude(rrect(21.0, 14.0, 3.0).translate((0.0, -13.70)), 9.1).translate((0.0, 0.0, 12.5))
    post_s = [
        (10.4, 11.8, 17.6, 2.0, 0.0, 9.2, 0.2),
        (20.7, 11.6, 12.0, 2.0, 0.0, 12.5, 0.2),
    ]
    posts = tp._hull_slices(post_s).translate((-18.75, 0.0, 0.0)) + tp._hull_slices(post_s).translate((18.75, 0.0, 0.0))
    raw = base_u + mid_u + (cowl_hi - dip) + posts
    m, conns, ex = tp.integrated_sockets(raw, size, lock)

    # Cut 6.0 mm wide x 4.1 mm deep open-top wire troughs along x = +-18.75 at z = 7.4..11.5 mm (above 6.08 mm conical socket apex!):
    for sx in (-1, 1):
        trough = Manifold.cube((6.0, 24.0, 4.1)).translate((sx * 18.75 - 3.0, -5.0, 7.4))
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


TUB_TRUNNION_Y = 30.95
TUB_TRUNNION_Z = 5.75
LID_CRADLE_Z = 5.20 + TUB_TRUNNION_Z  # 10.95 mm: matches #11 stowed on a 5.20 mm lid (0.00 mm strain)

# Tub tip relief (found by the Truck motion test, 2026-11-02). The tub's 16 under-sockets stay on the deck studs (keel or stage lid) while it
# tips about the barrel hinge. The axis is 5.75 mm above the deck, so a socket wall slides e * sin(tip) (0.1 mm at 1 deg) into a 0.05 mm
# gap, and the rear row only lifts clear of its studs near 18 deg: 7.84 mm3 of overlap on the keel and 15.7 mm3 on a 4x4 lid at 1..17 deg.
# The sockets are therefore relieved by the swept envelope of the stud grid over the first TUB_RELIEF_MAX_DEG of tip (hulls of 1 deg poses,
# which can only over-cut). The swept body is the socket cutter itself, so the slots keep the sockets' 0.05 mm seat gap and their self-roofing 42-deg cone.
TUB_RELIEF_MAX_DEG = 20.0
TUB_RELIEF_STEP_DEG = 1.0
TUB_RELIEF_BACK = 0.12   # extra clearance on the hinge side of each slot (the side the stud presses on)
# The tub's lower front edge also swings 0.25 mm forward at 5 deg into the windscreen's rear wall (0.20 mm rest gap): shave the front face
# 0.40 mm over the wall height (z 0..6.0, then a 56-deg run-out) so the rest gap is 0.60 mm.
TUB_FRONT_SHAVE = 0.40
WIND_WALL_H = 6.4


def _tub_stud_relief(size="small"):
    """Union of the 4 x 4 socket cutters (tub frame, z from the tub underside) swept about the hinge axis for 0..TUB_RELIEF_MAX_DEG of tip."""
    p = tp.STUD[size]
    pitch = p["pitch"]
    # Convex core of the socket cutter (cylinder, then the same 42-deg self-roofing cone), capped 0.15 mm above the stud tip because the cone above
    # that is never touched, and without the lead-in flare (a hull of two poses would fill the flare's neck and widen every socket). Radius 0.02 mm
    # inside the socket wall, junction and base heights off the socket's, and a half-segment turn, so the core shares no coplanar face and no
    # vertex ring with the sockets (coincident rings left 144 zero-area slivers that broke watertightness after the STL vertex merge).
    r_core = (p["stud_d"] + p["fit"]) / 2 / math.cos(math.pi / (2 * tp.SOCKET_SEG)) - 0.02
    z_j, z_cap = p["stud_h"] - 0.35 + 0.07, p["stud_h"] + 0.15
    prof = [(0.0, -0.05), (r_core, -0.05), (r_core, z_j), (r_core - (z_cap - z_j) * math.tan(math.radians(42.0)), z_cap), (0.0, z_cap)]
    stud = Manifold.revolve(CrossSection([np.array(prof)]), tp.SOCKET_SEG).rotate((0.0, 0.0, 180.0 / tp.SOCKET_SEG)).translate((0.0, TUB_RELIEF_BACK, 0.0))
    n = int(round(TUB_RELIEF_MAX_DEG / TUB_RELIEF_STEP_DEG))
    sweeps = []
    for i in range(4):
        for j in range(4):
            s0 = stud.translate(((i - 1.5) * pitch, (j - 1.5) * pitch, 0.0))
            poses = [
                s0.translate((0.0, -TUB_TRUNNION_Y, -TUB_TRUNNION_Z)).rotate((k * TUB_RELIEF_STEP_DEG, 0.0, 0.0)).translate((0.0, TUB_TRUNNION_Y, TUB_TRUNNION_Z))
                for k in range(n + 1)
            ]
            sweeps += [Manifold.batch_hull([a, b]) for a, b in zip(poses, poses[1:])]
    return tp.union(sweeps)


def _tub_front_shave(width=52.0, y_front=24.9):
    """Front-face setback (full width) for the windscreen's rear wall: z -0.1..6.0 at TUB_FRONT_SHAVE, 56-deg run-out up to z 6.6."""
    t = TUB_FRONT_SHAVE
    return Manifold.batch_hull([
        Manifold.cube((width, t + 0.1, WIND_WALL_H - 0.3)).translate((-width / 2, -y_front - 0.1, -0.1)),
        Manifold.cube((width, 0.1, 0.1)).translate((-width / 2, -y_front - 0.1, WIND_WALL_H + 0.1)),
    ])


def _bellows_knuckle(x0, x1, axis_y, axis_z, rk=5.65, y_fuse=23.2, h_bridge=5.2):
    """Flat-bottomed (z >= 0), cylindrical-topped horizontal X hinge knuckle (0.35 mm bed chamfer, 0 overhang)."""
    w = x1 - x0
    prof = CrossSection.batch_hull([
        CrossSection.square((2 * (rk - 0.35), 0.08)).translate((-(rk - 0.35), 0.0)),
        CrossSection.square((2 * rk, max(0.2, axis_z - 0.40))).translate((-rk, 0.40)),
        CrossSection.circle(rk, 64).translate((0.0, axis_z)),
    ])
    kn = Manifold.extrude(prof.rotate(90), w).rotate((0, 90, 0)).translate((x0, axis_y, 0.0))
    br = rbox(w, axis_y - y_fuse, h_bridge, 0.8, 0.35).translate(((x0 + x1) / 2, (y_fuse + axis_y) / 2, 0.0))
    return kn + br


def _rear_lid_hinge_knuckles(m, h_bridge=5.2, y_fuse=23.2):
    """Twin enclosed cylindrical dump-tub hinge knuckles in the stud-free |X| in [10.30, 14.70] corridor,
    interleaving with #11 kit_tilting_tub's outer knuckles (|X| in [15.10, 19.50]) on a 37.5 mm shaft_tu03 pin.
    """
    knuckles = (
        _bellows_knuckle(-14.70, -10.30, TUB_TRUNNION_Y, LID_CRADLE_Z, rk=5.65, y_fuse=y_fuse, h_bridge=h_bridge)
        + _bellows_knuckle(10.30, 14.70, TUB_TRUNNION_Y, LID_CRADLE_Z, rk=5.65, y_fuse=y_fuse, h_bridge=h_bridge)
    )
    m = (m + knuckles) - pro.bore_cutter_axis("free", 31.0, (0.0, TUB_TRUNNION_Y, LID_CRADLE_Z), "x")
    c_h = pro._axis_bore_conn("hinge_bore", "free", (-12.50, TUB_TRUNNION_Y, LID_CRADLE_Z), "x", 4.4, lattice="pivot")
    return m, c_h


def _lid_with_pto_gear_relief(size="small", lock=True, extra_cut=None, include_knuckles=True):
    """Shared 4x4 integrated lid (5.20 mm plate) with a bridged underside PTO Z10 gear dome (x in [-5.4, +5.4],
    y in [-1.2, +13.7], z = 0..2.20 mm, 50-deg side bevels -> 7.1 mm bridge <= 20 mm, 3.0 mm solid roof) and
    relief holes at (+-6.25, +6.25) so Ø30 PTO gears at z_tray = 18.75 (tip 33.75) spin with +0.75 mm clearance.
    """
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    raw, c_top = _add_stud_grid(raw, size, 4, 4, H, cid="top_studs")
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    # Mark cells [1,2] and [2,2] ((+-6.25, +6.25)) as reliefs in socket_conn (trays only have 4 corner studs,
    # and the holes stay bored in geometry so I3_seats_on_reference clears all 16 reference-plate studs):
    for c in conns:
        if c.get("kind") == "socket_grid":
            c["grid"]["omit_cells"] = [[1, 2], [2, 2]]
    if "sockets" in ex:
        ex["sockets"]["holes"] = 14
        ex["sockets"]["reliefs"] = ex["sockets"].get("reliefs", 0) + 2
    dome_prof = _ccw_poly([(-5.4, -0.2), (5.4, -0.2), (3.55, 2.20), (-3.55, 2.20)])
    dome = Manifold.extrude(dome_prof, 14.9).rotate((90, 0, 0)).translate((0.0, 13.7, 0.0))
    m = m - dome
    if extra_cut is not None:
        m = m - extra_cut
    out_conns = conns + [c_top]
    if include_knuckles:
        m, c_h = _rear_lid_hinge_knuckles(m, h_bridge=H)
        out_conns.append(c_h)
    return m, out_conns, ex


def kit_tilting_tub(size="small", grid=(4, 4), **_):
    """#11 4x4 TU Sculpted Rock-Body Tipping Dump Tub & Payload Bay (49.8 x 61.5 x 18.0 mm).
    Features an 18.0 mm front cab-shield headboard (-Y), exterior vertical stiffener ribs,
    40-deg flared top coaming rails, an angled open rear scow dump chute (+Y), and twin outer
    enclosed cylindrical hinge knuckles at |X| in [15.10, 19.50], (y = +30.95, z = +5.75) that
    interleave with pro_tub_hinge or core lids around a 37.5 mm `shaft_tu03` pin for 0..55-deg tipping.
    """
    p = tp.STUD[size]
    fh = p["plate_h"]
    foot = rbox(49.8, 49.8, fh, p["edge_r"], p["bed_chamfer"])
    shell_main = Manifold.extrude(rrect(47.6, 49.8, 2.0), 14.8 - fh + 0.4).translate((0.0, 0.0, fh - 0.4))
    ribs = None
    for yc in (-21.5, -10.5, 0.5, 11.5):
        rb = Manifold.extrude(rrect(49.8, 3.4, 1.0), 14.8 - fh + 0.4).translate((0.0, yc, fh - 0.4))
        ribs = rb if ribs is None else ribs + rb
    rail = Manifold.batch_hull([
        Manifold.extrude(rrect(47.6, 49.8, 2.0), 0.2).translate((0.0, 0.0, 12.2)),
        Manifold.extrude(rrect(49.8, 49.8, 2.1), 1.3).translate((0.0, 0.0, 13.5)),
    ])
    headboard = Manifold.batch_hull([
        Manifold.extrude(rrect(49.8, 13.6, 2.1), 0.3).translate((0.0, -18.1, 14.5)),
        Manifold.extrude(rrect(49.8, 10.2, 2.1), 0.4).translate((0.0, -19.8, 17.6)),
    ])
    rear_trim = Manifold.batch_hull([
        Manifold.cube((52.0, 11.0, 0.2)).translate((-26.0, 18.0, 15.2)),
        Manifold.cube((52.0, 4.0, 6.2)).translate((-26.0, 24.8, 9.2)),
    ])
    # 55-deg rear lower heel bevel so tipping to 55 deg clears the lid/keel deck and pro_tub_hinge behind the hinge:
    heel_bevel = Manifold.batch_hull([
        Manifold.cube((52.0, 5.2, 0.2)).translate((-26.0, 20.0, -0.1)),
        Manifold.cube((52.0, 0.4, 6.6)).translate((-26.0, 24.8, -0.1)),
    ])
    outer = (((shell_main + ribs + rail) - rear_trim) + headboard) - heel_bevel
    cav = Manifold.batch_hull([
        Manifold.extrude(rrect(43.2, 35.6, 1.8), 0.2).translate((0.0, -4.0, 7.35)),
        Manifold.extrude(rrect(43.2, 43.2, 1.8), 9.6).translate((0.0, -0.2, 9.4)),
        Manifold.extrude(rrect(43.2, 12.0, 1.2), 9.6).translate((0.0, 21.0, 9.4)),
    ])
    cav_top = Manifold.extrude(rrect(43.2, 46.2, 1.8), 6.0).translate((0.0, 1.2, 14.0))
    knuckles = (
        _bellows_knuckle(-19.50, -15.10, TUB_TRUNNION_Y, TUB_TRUNNION_Z, rk=5.65, y_fuse=23.2, h_bridge=6.5)
        + _bellows_knuckle(15.10, 19.50, TUB_TRUNNION_Y, TUB_TRUNNION_Z, rk=5.65, y_fuse=23.2, h_bridge=6.5)
    )
    m = (foot + (outer - cav - cav_top) + knuckles) - pro.bore_cutter_axis("free", 41.0, (0.0, TUB_TRUNNION_Y, TUB_TRUNNION_Z), "x")
    cut_s = tp._conical_socket_cutter(p)
    m = m - tp.union([cut_s.translate(((i - 1.5) * p["pitch"], (j - 1.5) * p["pitch"], 0.0)) for i in range(4) for j in range(4)])
    m = m - _tub_stud_relief(size) - _tub_front_shave()   # tip relief: see TUB_RELIEF_MAX_DEG above
    c_h = pro._axis_bore_conn("hinge_bore", "free", (-17.30, TUB_TRUNNION_Y, TUB_TRUNNION_Z), "x", 4.4, lattice="pivot")
    return m, [tp.socket_conn(size, 4, 4), c_h], {}


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
    stem = pro.pin_solid("flats", 26.5, z0=0.0, tip_chamfer=(True, False))
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
    grip = pro.pin_solid("flats", L + 4.0, tip_chamfer=(True, False))
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
    """Build a smooth 0.80 mm PETG/TPU flex skin (`z_assy = 3.60..4.40`) printed exterior-face-down on `z = 0`
    (`print_rotation_deg = [180, 0, 0]`) so all blind cylindrical female stud sockets open upward (+Z_print) with
    0 overhangs, 0 bridges, and 0 slicer supports. Rib-free 0.60 mm fold webs run strictly along the boss-free
    inter-column lanes (`x = +-6.25` for 9-col Book-Fold, `x = +-18.75` for 7-col wrap-around).
    """
    p = tp.STUD[size]
    pitch, hole_r, wall = p["pitch"], (p["stud_d"] + p["fit"]) / 2, p["wall"]
    H = 4.40
    fp = rrect(w, d, 1.8)
    x0, y0, x1, y1 = fp.bounds()
    best = None
    for px in (0.0, 0.5):
        for py in (0.0, 0.5):
            full, relief = [], []
            for i in range(math.floor(x0 / pitch - px) - 1, math.ceil(x1 / pitch - px) + 2):
                for j in range(math.floor(y0 / pitch - py) - 1, math.ceil(y1 / pitch - py) + 2):
                    x, y = (i + px) * pitch, (j + py) * pitch
                    if (fp ^ CrossSection.circle(p["stud_d"] / 2 + 0.3, 48).translate((x, y))).area() < 0.01:
                        continue
                    ring = CrossSection.circle(hole_r + wall, 64).translate((x, y))
                    (full if (ring - fp).area() < 0.05 else relief).append((x, y))
            key = (len(full), -len(relief))
            if best is None or key > best[0]:
                best = (key, full, relief)
    _, full, relief = best

    sheet = Manifold.batch_hull([
        Manifold.extrude(fp, 0.45).translate((0.0, 0.0, H - 0.80)),
        Manifold.extrude(rrect(w - 0.70, d - 0.70, 1.45), 0.05).translate((0.0, 0.0, H - 0.05)),
    ])
    r_b = hole_r + wall
    boss_prof = [(0.0, 0.0), (r_b - 0.35, 0.0), (r_b, 0.35), (r_b, H - 0.40), (0.0, H - 0.40)]
    boss_unit = Manifold.revolve(CrossSection([np.array(boss_prof)]), tp.SOCKET_SEG)
    clip_prism = Manifold.extrude(fp.offset(-0.05, JoinType.Round), H - 0.35)
    bosses = tp.union([(boss_unit.translate((x, y, 0.0)) ^ clip_prism) for x, y in full])
    cut_b = tp._blind_tile_socket_cutter(p)
    cuts = tp.union([cut_b.translate((x, y, 0.0)) for x, y in full + relief])
    m = (sheet + bosses) - cuts

    corridors = [-6.25, 6.25] if center_book_fold else [-18.75, 18.75]
    gr_prof = _ccw_poly([(-0.90, 3.50), (0.90, 3.50), (0.70, 3.80), (-0.70, 3.80)])
    for xc in corridors:
        groove = Manifold.extrude(gr_prof, d + 1.0).rotate((90, 0, 0)).translate((xc, (d + 1.0) / 2, 0.0))
        m = m - groove

    nx = int(round(2 * max(abs(x) for x, _ in full) / pitch)) + 1
    ny = int(round(2 * max(abs(y) for _, y in full) / pitch)) + 1
    cells = {(int(round(x / pitch + nx / 2 - 0.5)), int(round(y / pitch + ny / 2 - 0.5))) for x, y in full}
    conn = tp.socket_conn(size, nx, ny)
    conn["style"] = "holes"
    omit = [[i, j] for i in range(nx) for j in range(ny) if (i, j) not in cells]
    if omit:
        conn["grid"]["omit_cells"] = omit
    return m, [conn], {
        "print_rotation_deg": [180.0, 0.0, 0.0],
        "sockets": {"holes": len(full), "reliefs": len(relief), "locked": True},
    }


def skin_aero_cowl(size="small", grid=(8, 3), **_):
    """#16 Smooth 0.80 mm PETG/TPU Wrap-Around Aero Nose Cowl (96.0 x 37.3 x 4.4 mm, show-face-down)."""
    return _build_flex_skin(96.0, 37.3, size=size, center_book_fold=False)


def skin_windscreen(size="small", grid=(8, 3), **_):
    """#17 Smooth 0.80 mm PETG/TPU Wrap-Around Front Windscreen / Visor (96.0 x 36.0 x 4.4 mm, show-face-down)."""
    return _build_flex_skin(96.0, 36.0, size=size, center_book_fold=False)


def skin_cargo_shroud(size="small", grid=(9, 4), **_):
    """#18 Smooth 0.80 mm PETG/TPU Book-Fold Shuttle Doors & Canopy Shroud (112.0 x 49.8 x 4.4 mm, show-face-down)."""
    return _build_flex_skin(112.0, 49.8, size=size, center_book_fold=True)


# ==========================================================================
# WAVE W11: Pro Steering & Motion Power (Cards E1-E2, 23 parts)
# ==========================================================================
# --- Stage-2 steering geometry shared by the bridge, rack, tie-rod link and Gate G1 (world frame: front = -Y, z up) ---
BRIDGE_Y, BRIDGE_Z, BRIDGE_H = -50.0, 12.5, 12.5   # bridge origin on kit_keel_base rows 0..1 and its body height
DECK_Z = BRIDGE_Z + BRIDGE_H                       # 25.0: top of the bridge body
STEER_KP_X, STEER_KP_Y, STEER_ARM = 18.75, -56.25, 12.5   # kingpin axes (+-x, y) and the knuckle tie-rod arm radius
RACK_Y = -56.25                                    # rack origin y; the Z10 pinion pitch line sits 6.25 mm ahead of it (y = -50)
RACK_FRONT_MM, RACK_T = 6.35, 6.25                 # the rack body reaches 6.35 mm in front of its origin; rack thickness
RACK_LIFT = 0.20                                   # rack and pinion run this far above the deck
RACK_Z = DECK_Z + RACK_LIFT                        # 25.2: underside of the rack and the Z10 pinion
LINK_T, LINK_R, LINK_LIFT = 4.0, 5.7, 0.20         # tie-rod link plate thickness, boss radius, clearance over the rack top
LINK_Z = RACK_Z + RACK_T + LINK_LIFT               # 31.65: underside of the link plate (it runs over the rack, guide wall and stop)
LINK_TOP_Z = LINK_Z + LINK_T                       # 35.65
GUIDE_CLEAR, GUIDE_T, GUIDE_HALF_W = 0.30, 2.4, 8.2   # rack guide wall: running clearance to the rack's front face, thickness, half width
STOP_CLEAR = 0.20                                  # clearance between the rack travel stop and a link plate at the end of travel
KNUCKLE_TOWER_Z = 21.80                            # world Z top of the knuckle's forward fixed tie-rod tower (cuts pin bending >73%, stays S1 small_part)


def _tierod_pivots(side, dx):
    """World xy of the (rack bore, knuckle tie-rod bore) ends of the `side` link (-1 = -X) with the rack `dx` mm toward +X."""
    ang = _tierod_angles(dx)[0 if side < 0 else 1]
    a = math.radians(-90.0 + ang)
    return ((side * RACK_TIEROD_X + dx, RACK_Y + RACK_BORE_DY),
            (side * STEER_KP_X + STEER_ARM * math.cos(a), STEER_KP_Y + STEER_ARM * math.sin(a)))


def _link_plate_cs(side, dx):
    """Outline (world xy) of the `side` tie-rod link plate: the hull of its two R = LINK_R bosses."""
    p_rack, p_arm = _tierod_pivots(side, dx)
    return CrossSection.batch_hull([CrossSection.circle(LINK_R, 96).translate(p_rack), CrossSection.circle(LINK_R, 96).translate(p_arm)])


def _stop_wedge_cs():
    """Footprint (world xy) of the rack travel stop: the gap between the two link plates at +-RACK_STOP, STOP_CLEAR off each. The plate
    edges move monotonically toward the centre, so a plate touches the stop only at the end of travel (checked by Gate G1)."""
    keep_out = (_link_plate_cs(-1, RACK_STOP) + _link_plate_cs(1, -RACK_STOP)).offset(STOP_CLEAR, JoinType.Round)
    return CrossSection.square((14.4, 4.6)).translate((-7.2, -69.0)) - keep_out        # y -69.0 .. -64.4


def pro_steer_bridge(size="small", grid=(2, 2), lock=True, **_):
    """T-Planform Stage-2 Pro Row-0 Steering Bridge with rack guide, travel stop & kingpin snap pockets (48.4 x 31.8 x 23.2 mm).
    - Central 24.8 x 24.8 x 12.5 mm nose hub with 2x2 under_sockets (holes) and R = 4.40 mm rear stem/pilot relief;
    - Swept front row-0 outrigger arms out to Ø10.90 mm (R = 5.45 mm) kingpin bosses at (+-18.75, -6.25) with 9.00 mm
      `fixed` anti-rotation bores + 3.50 mm top Ø8.00 mm snap-barb latch counterbores (0 overhang, open for pinch release);
    - Front prow carrying a 2.4 mm guide wall 0.3 mm off the rack's front face and a wedge travel stop at +-5.20 mm.
    """
    H = BRIDGE_H
    arm_cs = CrossSection.batch_hull([
        CrossSection.circle(5.45, 64).translate((-18.75, -6.25)),
        CrossSection.circle(5.45, 64).translate((18.75, -6.25)),
    ])
    t_plan = (rrect(24.8, 24.8, 2.4) + arm_cs) - CrossSection.circle(4.40, 48).translate((0.0, 12.50))
    raw = Manifold.extrude(t_plan, H)

    p = tp.STUD[size]
    cut_s = tp._conical_socket_cutter(p)
    m = raw
    for ix in (-0.5, 0.5):
        for iy in (-0.5, 0.5):
            m = m - cut_s.translate((ix * 12.5, iy * 12.5, 0.0))
    c_sock = tp.socket_conn(size, 2, 2)
    c_sock["style"] = "holes"

    # Kingpin fixed bores (z = 4.20..9.00 mm) with orthogonal planar Y-flat stud-relief prisms (|x| <= 2.35 inside fixed chord):
    prof_yz = _ccw_poly([
        (-3.85, -0.05), (3.85, -0.05), (3.45, 0.35), (3.45, 2.95),
        (1.80, 4.95), (-1.80, 4.95), (-3.45, 2.95), (-3.45, 0.35),
    ])
    y_rel = Manifold.extrude(prof_yz.rotate(90), 4.70).rotate((0, 90, 0)).translate((-2.35, 0.0, 0.0))
    m = m - pro.bore_cutter("fixed", H, -18.75, -6.25, 0.0) - pro.bore_cutter("fixed", H, 18.75, -6.25, 0.0)
    for sx in (-18.75, 18.75):
        m = m - Manifold.cylinder(H - 9.00 + 0.2, 4.00, 4.00, 64).translate((sx, -6.25, 9.00))
        m = m - y_rel.translate((sx, -6.25, 0.0))
    c_kp = {
        "id": "kingpins",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "fixed",
        "depth_mm": 4.80,
        "lattice": "axis8",
        "frame": {"origin": [-18.75, -6.25, 4.20], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 37.5, "anchor": "corner"},
    }
    # Front prow, rack guide wall and travel stop. Local frame: world = (0, BRIDGE_Y, BRIDGE_Z) + local.
    wall_in = (RACK_Y - RACK_FRONT_MM - GUIDE_CLEAR) - BRIDGE_Y                  # -12.9: wall face 0.3 mm ahead of the rack's front face
    rack_top = RACK_Z + RACK_T - BRIDGE_Z                                        # 18.95: guide wall is flush with the rack top
    stop_top = LINK_TOP_Z - BRIDGE_Z                                             # 23.15: stop reaches the top of the link plates
    prow = Manifold.extrude(rrect(13.2, 7.4, 1.0).translate((0.0, -15.7)), H)    # y -19.4 .. -12.0, fused 0.4 mm into the hub front
    y_out, y_hub = wall_in - GUIDE_T, -12.0                                      # wall's outer face; 0.4 mm inside the hub's front face
    guide_base = Manifold.extrude(rrect(2 * GUIDE_HALF_W, y_hub - y_out, 1.0).translate((0.0, (y_out + y_hub) / 2)), H)
    guide_wall = Manifold.extrude(rrect(2 * GUIDE_HALF_W, GUIDE_T, 0.6).translate((0.0, wall_in - GUIDE_T / 2)), rack_top - H).translate((0.0, 0.0, H - 0.01))
    stop = Manifold.extrude(_stop_wedge_cs().translate((0.0, -BRIDGE_Y)), stop_top - H + 0.01).translate((0.0, 0.0, H - 0.01))
    m = m + prow + guide_base + guide_wall + stop
    for sx in (-6.25, 6.25):
        m = m - cut_s.translate((sx, -18.75, 0.0))
    return m, [c_sock, c_kp], {"sockets": {"holes": 4, "reliefs": 4, "locked": bool(lock)}}


KNUCKLE_FACE_RELIEF = 0.4  # mm shaved off the inboard (print-bed) cheek face (holds >= 0.355 mm keel nose gap across +-5.2 mm sweep).


# Barbed round wheel stub. The wheel's outer face carries an O8.0 x 2.0 counterbore (FREE_HUB_CB_*); the stub is a round O6.60 pin_free shaft whose tip is a
# slotted split cantilever with an O7.30 barb (0.15 mm over the wheel's O7.00 free bore, so each half flexes 0.15 mm to pass) that sits in the counterbore.
# The knuckle prints stub-up, so the barb's underside is a 50-degree cone (no flat ledge, past the 45-degree overhang limit) and the tip is a lead-in cone.
# Retention is a snap, not a lock: estimated pull-off about 1 kgf, to be confirmed by a print (spec functional 2.2).
STUB_BARB_R = 3.65
STUB_SLOT_W, STUB_SLOT_L = 1.6, 11.0
STUB_BARB_UNDER_DEG = 50.0


def _barbed_wheel_stub(x, z0, z_seat, z_tip, wheel_h=12.3):
    r0 = pro.BORE["shaft_d"] / 2
    z_floor = z_seat + wheel_h - FREE_HUB_CB_DEPTH          # counterbore floor
    z_sh = z_floor + 0.2                                    # barb shoulder: 0.2 mm axial play above the floor
    dz_cone = (STUB_BARB_R - r0) * math.tan(math.radians(STUB_BARB_UNDER_DEG))
    z_cyl_top = z_sh + dz_cone + 0.5
    seg = pro.SEGS
    stub = (
        Manifold.cylinder(z_sh - z0, r0, r0, seg).translate((0.0, 0.0, z0))
        + Manifold.cylinder(dz_cone, r0, STUB_BARB_R, seg).translate((0.0, 0.0, z_sh))
        + Manifold.cylinder(z_cyl_top - z_sh - dz_cone, STUB_BARB_R, STUB_BARB_R, seg).translate((0.0, 0.0, z_sh + dz_cone))
        + Manifold.cylinder(z_tip - z_cyl_top, STUB_BARB_R, 2.9, seg).translate((0.0, 0.0, z_cyl_top))
    )
    # The slot runs on the 45-degree diagonal, so the stub's x and y extents stay O6.60 (I5 measures them) and the two halves flex symmetrically.
    slot = Manifold.cube((STUB_SLOT_W, 2 * STUB_BARB_R + 2.0, STUB_SLOT_L + 0.2)).translate((-STUB_SLOT_W / 2, -STUB_BARB_R - 1.0, z_tip - STUB_SLOT_L)).rotate((0.0, 0.0, 45.0))
    return (stub - slot).translate((x, 0.0, 0.0))


def _steer_knuckle(side):
    """Bellcrank steering knuckle (25.6 x 25.6 x 27.1 mm printed stub-up on flat cheek, side = -1 for L, +1 for R).
    - Stepped crank strap (y in [+6.40, +10.05] -> Z_world < 0 below keel nose) + 42-deg beveled kingpin free boss;
    - Tall forward tie-rod tower (y in [-15.55, +10.05] -> Z_world_top = 21.80 mm) with an 11.50 mm `fixed` bore above
      a horizontal Ø8.00 mm snap-barb latch pocket (y >= -4.05 -> Z_world <= 10.30 mm) positively retaining `pro_captive_pin_28`;
    - Tapered hub riser up to z = 15.00 mm topped with a vertical +Z round pin_free wheel stub with a snap barb (15.00 mm scrub offset); the steered
      front wheel is the free-hub variant, which turns on it (the keyed wheel could not: a Double-D stub in a Double-D bore is a key).
    """
    W, D_kp, H_base = 25.6, 16.0, 12.5
    xk = -side * 6.25
    xt = side * 6.25
    yc_kp = 2.05
    y_tr_top = -(KNUCKLE_TOWER_Z - 6.25)  # -15.55 mm -> Z_world = 21.80 mm
    D_tr = 10.05 - y_tr_top               # 25.60 mm total tower length
    yc_tr = (10.05 + y_tr_top) / 2        # -2.75 mm
    strap = Manifold.extrude(rrect(W, 3.65, 1.4).translate((0.0, 8.225)), H_base - 0.4).translate((0.0, 0.0, 0.4))
    strap_foot = Manifold.batch_hull([
        Manifold.extrude(rrect(W - 0.8, 2.85, 1.0).translate((0.0, 8.225)), 0.05),
        Manifold.extrude(rrect(W, 3.65, 1.4).translate((0.0, 8.225)), 0.1).translate((0.0, 0.0, 0.4)),
    ])
    bosses = None
    for xc, dd, yc, bw in ((xk, D_kp, yc_kp, 10.6), (xt, D_tr, yc_tr, 11.2)):
        b0 = Manifold.extrude(rrect(2.4, dd - 0.8, 0.9).translate((xc, yc)), 0.05)
        b1 = Manifold.extrude(rrect(2.8, dd, 1.1).translate((xc, yc)), 0.2).translate((0.0, 0.0, 0.45))
        b2 = Manifold.extrude(rrect(bw, dd, 2.2).translate((xc, yc)), H_base - 4.8).translate((0.0, 0.0, 4.8))
        b = Manifold.batch_hull([b0, b1]) + Manifold.batch_hull([b1, b2])
        bosses = b if bosses is None else bosses + b
    riser = Manifold.batch_hull([
        Manifold.cylinder(0.4, 5.3, 5.3, 64).translate((xk, 0.0, H_base - 0.4)),
        Manifold.cylinder(0.4, 5.1, 5.1, 64).translate((xk, 0.0, 15.00 - 0.4)),
    ])
    stub = _barbed_wheel_stub(xk, 14.50, 15.00, 27.50)
    # Horizontal Ø8.00 mm 50-deg teardrop snap-barb latch pocket for y in [-4.15, +10.50] (Z_world <= +10.40 mm, 0 overhang):
    latch_sec = pro._teardrop(8.00, roof_deg=50, segs=48)
    latch_pocket = Manifold.extrude(latch_sec, 14.65).rotate((90, 0, 0)).translate((xt, 10.50, 6.25))
    m = (
        (strap + strap_foot + bosses + riser + stub)
        - pro.bore_cutter_axis("free", 22.0, (xk, yc_kp, 6.25), "y")
        - pro.bore_cutter_axis("fixed", D_tr + 4.0, (xt, yc_tr, 6.25), "y")
        - latch_pocket
    )
    if KNUCKLE_FACE_RELIEF > 0.0:
        m = m ^ Manifold.cube((100.0, 100.0, 100.0)).translate((-50.0, -50.0, KNUCKLE_FACE_RELIEF))
        m = m.translate((0.0, 0.0, -KNUCKLE_FACE_RELIEF))
    z_bore = 6.25 - KNUCKLE_FACE_RELIEF
    c_kp = pro._axis_bore_conn("kingpin_bore", "free", (xk, 0.0, z_bore), "y", 11.4, lattice="pivot")
    c_tr = pro._axis_bore_conn("tierod_bore", "fixed", (xt, -9.85, z_bore), "y", 11.4, lattice="pivot")
    c_ax = {
        "id": "wheel_stub",
        "kind": "pin",
        "gender": "M",
        "interface": "pin_free",
        "size_class": "pro",
        "fit_class": tp.IF["interfaces"]["pin_free"]["fit_class"],
        "profile": "round",
        "length_mm": 12.5,
        "frame": {"origin": [xk, 0.0, round(15.00 - KNUCKLE_FACE_RELIEF, 4)], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [c_kp, c_tr, c_ax], {}


def pro_tub_hinge(**_):
    """Rear Barrel Dump-Tub Hinge Adapter (29.4 x 19.5 x 19.4 mm, printed flat on z = 0).
    Placed at world (0.0, +62.40, +4.50): twin forward transom tenons (x = +-12.50, y in [-7.80, +0.40], z = 0..3.10)
    seat into #1 kit_keel_base's rear transom mortises, while the 29.4 mm rear bar behind #1 carries a central vertical
    tow-hitch bore at (0.0, +6.25) and twin enclosed inner hinge knuckles at |X| in [10.30, 14.70], (y = +6.05, z = +13.75)
    -> world (+68.45, +18.25) interleaving with #11 kit_tilting_tub around a 37.5 mm `shaft_tu03` pin.
    """
    rear_bar = rbox(29.4, 11.65, 8.0, 1.4, 0.4).translate((0.0, 5.875, 0.0))
    tenons = None
    for sx in (-1, 1):
        tn = rbox(4.30, 8.20, 3.10, 0.65, 0.30).translate((sx * 12.50, -3.70, 0.0))
        tenons = tn if tenons is None else tenons + tn
    knuckles = (
        _bellows_knuckle(-14.70, -10.30, 6.05, 13.75, rk=5.65, y_fuse=2.0, h_bridge=8.0)
        + _bellows_knuckle(10.30, 14.70, 6.05, 13.75, rk=5.65, y_fuse=2.0, h_bridge=8.0)
    )
    m = (
        (rear_bar + tenons + knuckles)
        - pro.bore_cutter("free", 8.0, 0.0, 6.25, 0.0)
        - pro.bore_cutter_axis("free", 31.0, (0.0, 6.05, 13.75), "x")
    )
    c_hitch = {
        "id": "hitch_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": 8.0,
        "lattice": "axis8",
        "frame": {"origin": [0.0, 6.25, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    c_hinge = pro._axis_bore_conn("hinge_bore", "free", (-12.50, 6.05, 13.75), "x", 4.4, lattice="pivot")
    return m, [c_hitch, c_hinge], {}


def _captive_drive_pin(head_w, head_h, latch_span, conn_len):
    """Build a 1-piece self-retaining LAY_FLAT headed shaft_drive pin with a split-cantilever distal snap-barb tip.
    - Head [0, head_h] blocks travel in +insertion direction;
    - Pure shaft_drive shank [head_h, z_slot] provides standard 0.05 mm/side anti-rotation fit (measured at z_mid by I4/I5);
    - Twin 2.40 mm-thick cantilever tines [z_slot, z_tip] carry +-X Ø7.60 mm (+0.30 mm/side) snap-barbs above z_latch + 0.14
      (< 0.97% PLA strain during insertion, 0.00% seated strain, ~20 N pull-out lock, pinch/push-out releasable, 0 overhangs).
    """
    flats = pro.BORE["shaft_flats"]
    hy = flats / 2
    z_latch = head_h + latch_span
    z_tip = z_latch + 2.85
    z_slot = z_latch - 10.50
    head = Manifold.extrude(pro._double_d(head_w, flats, corners=False), head_h)
    shank = Manifold.extrude(pro._double_d(pro.BORE["shaft_d"], flats), z_latch + 0.16 - (head_h - 0.15)).translate((0.0, 0.0, head_h - 0.15))
    barb = Manifold.batch_hull([
        Manifold.extrude(pro._double_d(pro.BORE["shaft_d"], flats), 0.06).translate((0.0, 0.0, z_latch + 0.12)),
        Manifold.extrude(pro._double_d(7.60, flats, corners=False), 0.65).translate((0.0, 0.0, z_latch + 0.24)),
        Manifold.extrude(pro._double_d(5.70, flats - 0.80), 0.15).translate((0.0, 0.0, z_tip - 0.15)),
    ])
    hole_stop = max(3.0, z_slot - 2.2)
    center_hole = Manifold.batch_hull([
        Manifold.extrude(pro._teardrop(pro.BORE["shaft_center_hole"]), hole_stop - 1.2).translate((0.0, 0.0, -0.5)),
        Manifold.extrude(pro._teardrop(0.30), 0.1).translate((0.0, 0.0, hole_stop)),
    ])
    slot_cs = rrect(1.80, z_tip - z_slot + 1.80, 0.85).translate((0.0, (z_slot + z_tip + 1.80) / 2))
    slot = Manifold.extrude(slot_cs, flats + 2.0).rotate((90, 0, 0)).translate((0.0, hy + 1.0, 0.0))
    m = ((head + shank + barb) - center_hole) - slot
    conn = pro._pin_conn("shaft_drive", "flats", conn_len, z0=round(head_h + 0.30, 3))
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def pro_captive_pin_28(**_):
    """Headed 28.2 mm Self-Retaining Split-Barb Captive Drive Pin (9.6 x 29.7 x 5.0 mm LAY_FLAT).
    9.6 x 5.0 x 1.5 mm stop head + 25.35 mm seated span to Ø7.60 mm split-cantilever snap-barbs: locks kingpins,
    tie-rod pins, latch pawls, bumper mounts, and slam stops bi-directionally with zero loose C-clips.
    """
    return _captive_drive_pin(head_w=9.6, head_h=1.50, latch_span=25.35, conn_len=22.0)


def pro_steer_column(**_):
    """Captive 44.5 mm Self-Retaining Split-Barb Steering Column Stem (10.6 x 46.5 x 5.0 mm LAY_FLAT).
    Enters upward through #1 steer_bore (bottom head at Z = -2.0..0.0), drives gear_spur_z10 (Z = 25.2..31.45),
    and snap-latches over pro_steer_wheel's top dish shoulder at Z = 41.65 so neither wheel nor column can pull out or drop.
    """
    return _captive_drive_pin(head_w=10.6, head_h=2.00, latch_span=41.70, conn_len=38.0)


def pro_steer_wheel(**_):
    """Fluted Ø23.0 x 13.0 mm Pro Steering Wheel & Rear Rack Keeper (fixed hub bore, printed flat on z = 0).
    Lower Ø23.0 mm skirt (R = 11.50 mm) at Z_world = 31.65 caps gear_spur_z10 and overlaps pro_steer_rack's rear
    tooth tips (-47.5 mm) out to Y = -49.0 mm (+1.50 mm capture) while leaving +1.10 mm clearance to #8 cowl (-24.9 mm);
    internal z = 10.00 mm dish floor provides the upward-facing snap-latch shoulder for pro_steer_column.
    """
    H = 13.0
    skirt = Manifold.batch_hull([
        Manifold.cylinder(0.05, 11.1, 11.1, 96),
        Manifold.cylinder(2.0, 11.5, 11.5, 96).translate((0.0, 0.0, 0.4)),
        Manifold.cylinder(0.2, 8.6, 8.6, 84).translate((0.0, 0.0, 5.6)),
    ])
    rim = Manifold.batch_hull([
        Manifold.cylinder(0.2, 8.6, 8.6, 84).translate((0.0, 0.0, 5.4)),
        Manifold.cylinder(3.4, 11.5, 11.5, 96).translate((0.0, 0.0, 8.8)),
        Manifold.cylinder(0.05, 10.8, 10.8, 96).translate((0.0, 0.0, H - 0.05)),
    ])
    flutes = None
    for k in range(12):
        fl = Manifold.cylinder(5.0, 1.25, 1.25, 24).translate((11.7, 0.0, 8.2)).rotate((0.0, 0.0, 30.0 * k))
        flutes = fl if flutes is None else flutes + fl
    dish = Manifold.cylinder(3.2, 7.2, 8.0, 72).translate((0.0, 0.0, 10.00))
    body = ((skirt + rim) - flutes - dish) - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(10.00)], {}


def pro_steer_knuckle_l(**_):
    """Left Stage-2 Pro 15 mm-Scrub Bellcrank Steering Knuckle (25.6 x 25.6 x 27.1 mm)."""
    return _steer_knuckle(-1)


def pro_steer_knuckle_r(**_):
    """Right Stage-2 Pro 15 mm-Scrub Bellcrank Steering Knuckle (25.6 x 25.6 x 27.1 mm)."""
    return _steer_knuckle(1)


RACK_TIEROD_X = 7.8125  # 5 axis8 steps. Solved with the rigid tie-rod closure (_tierod_angles): 26.0 deg inner at 4.35 mm of rack
                        # travel with the outer wheel at 17.7 deg (Ackermann ideal 22.4; worst-case error 4.8 deg). The old +-12.50 gave
                        # 26.2 / 14.1 (error 8.4 deg) and needed only 3.68 mm; its circle was 86 cm at 26 deg lock (Gate G2 <= 62.0 cm).
RACK_STOP = 5.20        # mm of rack travel each way. With the +-7.8125 bores that is 33.9 deg inner / 20.8 outer: wall-to-wall turning
                        # circle 60.6 cm (G2 <= 62.0). Ø36 tires keep >= 3.12 mm clearance to keel/bridge/rack there; first contact is at
                        # ~6.4 mm. (At the old 4.40 mm stop the circle would be 69.6 cm and fail G2.) The stop is a wedge on the bridge
                        # prow that the two tie-rod link plates touch at exactly this travel (_stop_wedge_cs; Gate G1 checks it).
GIANT_LOCK_DEG = 25.0   # Ø50 tires: keel clearance is 1.81 mm at 26 deg inner (gate >= 1.80), and G2 (<= 75 cm) needs >= ~24 deg.
RACK_BORE_DY = -1.5625  # rack tie-rod bores sit this far ahead of the rack origin: y = -57.8125
TIEROD_LINK_MM = math.hypot(STEER_KP_X - RACK_TIEROD_X, (STEER_KP_Y - STEER_ARM) - (RACK_Y + RACK_BORE_DY))   # 15.468: rigid, bore to bore
LINK_STUB_MM = 6.05     # rack-end stub: through the 0.2 mm link lift and the 6.25 mm rack, ending 0.4 mm above the rack underside


def _tierod_angles(dx):
    """Rigid tie-rod closure for rack travel `dx` mm (+ = toward +X). Returns knuckle angles in degrees (+ = toward +X) for
    (the -X knuckle, the +X knuckle). Each knuckle's tie-rod bore orbits its vertical kingpin at 12.5 mm; the tie-rod keeps the
    planar bore-to-bore length it has at dx = 0 (TIEROD_LINK_MM, the length of the printed pro_tie_rod_link). Same closed form as STEER in
    viewer/Truck-Mockup.html."""
    kp_x, kp_y, arm = STEER_KP_X, STEER_KP_Y, STEER_ARM
    rack_y = RACK_Y + RACK_BORE_DY
    link = TIEROD_LINK_MM
    wrap = lambda v: math.atan2(math.sin(v), math.cos(v))
    out = []
    for side in (-1, 1):
        ex, ey = side * RACK_TIEROD_X + dx - side * kp_x, rack_y - kp_y
        r = math.hypot(ex, ey)
        q = max(-1.0, min(1.0, (arm * arm + r * r - link * link) / (2 * arm * r)))
        phi, a = math.atan2(ey, ex), math.asin(q)
        r1, r2 = wrap(phi + a), wrap(phi + math.pi - a)
        out.append(math.degrees(r1 if abs(r1) < abs(r2) else r2))
    return out[0], out[1]


def _dx_for_inner(inner_deg, stop=RACK_STOP):
    """Rack travel at which the inner knuckle reaches `inner_deg` (bisection), capped at the rack stop."""
    lo, hi = 0.0, stop
    if max(abs(a) for a in _tierod_angles(hi)) <= inner_deg:
        return hi
    for _ in range(50):
        mid = (lo + hi) / 2
        if max(abs(a) for a in _tierod_angles(mid)) < inner_deg:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def pro_steer_rack(**_):
    """Stage-2 Pro Module-2.5 Toothed Steering Rack (36.0 x 15.1 x 6.2 mm).
    Full-length conjugate teeth at y_pitch = +6.25 mm (0.5 TU), tip line at y = +8.75 mm, tie-rod free bores at (+-7.8125, -1.5625).
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
    m = Manifold.extrude(sec, T) - pro.bore_cutter("free", T, -RACK_TIEROD_X, -1.5625, 0.0) - pro.bore_cutter("free", T, RACK_TIEROD_X, -1.5625, 0.0)
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
        "frame": {"origin": [-RACK_TIEROD_X, -1.5625, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 2 * RACK_TIEROD_X, "anchor": "corner"},
    }
    return m, [conn], {"gear": {"kind": "rack", "module_mm": mod, "pitch_line_mm": yp, "length_mm": L, "thickness_mm": T,
                                "pressure_angle_deg": pro.GEAR["pressure_angle_deg"]}}


def pro_tie_rod_link(**_):
    """Stage-2 Pro Tie-Rod Link (26.9 x 11.4 x 10.1 mm), the missing rod between the rack and a steering knuckle.
    A 4.0 mm plate with two R5.7 bosses TIEROD_LINK_MM (15.468 mm) apart. Rack end: an integral Ø6.6 stub, 6.05 mm long, that drops into a
    rack tie-rod bore. Knuckle end: a free 7.0 mm bore for a 3 TU `pin_free_tu03` (head on top) that runs through the plate and down into
    the knuckle's tie-rod bore. The plate rides over the rack, so the stub is the only thing that has to be short; the knuckle pin is long.
    Built in assembly orientation (plate on top, stub down) and printed turned over: plate on the bed, stub standing 6 mm up.
    """
    L, r_stub = TIEROD_LINK_MM, pro.BORE["shaft_d"] / 2
    plate = Manifold.extrude(CrossSection.batch_hull([CrossSection.circle(LINK_R, 96), CrossSection.circle(LINK_R, 96).translate((L, 0.0))]), LINK_T)
    tip = Manifold.cylinder(0.5, r_stub - 0.5, r_stub, pro.SEGS).translate((0.0, 0.0, -LINK_STUB_MM))      # 0.5 mm lead-in chamfer
    shank = Manifold.cylinder(LINK_STUB_MM - 0.5 + 0.2, r_stub, r_stub, pro.SEGS).translate((0.0, 0.0, -LINK_STUB_MM + 0.5))
    m = (plate + tip + shank) - pro.bore_cutter("free", LINK_T, L, 0.0, 0.0)
    c_stub = dict(pro._pin_conn("pin_free", "round", LINK_STUB_MM), id="rack_stub", frame={"origin": [0.0, 0.0, 0.0], "normal": [0, 0, -1]})
    c_bore = {
        "id": "pivot_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": LINK_T,
        "lattice": "pivot",    # 15.468 mm from the stub: set by the linkage closure, not the lattice (existence is still probed by I4)
        "frame": {"origin": [L, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [c_stub, c_bore], {"print_rotation_deg": [180.0, 0.0, 0.0]}


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


def _cut_tray_sockets(m, size="small"):
    """Subtract 4x4 self-roofing 42-deg conical female stud sockets through a 5.20 mm tray/base floor."""
    p = tp.STUD[size]
    cut_s = tp._conical_socket_cutter(p)
    return m - tp.union([cut_s.translate(((i - 1.5) * p["pitch"], (j - 1.5) * p["pitch"], 0.0)) for i in range(4) for j in range(4)])


def _power_core_tray_shell(size="small", omit_studs=None):
    """Shared 4x4x3 TU Power Core Tray shell (49.8 x 49.8 x 32.3 mm; +5.2 mm lid = 37.5 mm = 3 TU).
    Clear internal cavity: 45.8 x 45.8 mm above z = 5.20 mm floor, with corbeled corner stud posts at z = 32.30 mm.
    """
    H_tray = 32.3
    p = tp.STUD[size]
    foot = rbox(49.8, 49.8, 5.2, p["edge_r"], p["bed_chamfer"])
    walls = (
        Manifold.extrude(rrect(49.8, 49.8, 2.2), H_tray - 5.0).translate((0.0, 0.0, 5.0))
        - Manifold.extrude(rrect(45.8, 45.8, 1.2), H_tray - 4.6).translate((0.0, 0.0, 5.2))
    )
    if omit_studs is None:
        omit_studs = [[i, j] for i in range(4) for j in range(4) if not (i in (0, 3) and j in (0, 3))]
    keep = {(i, j) for i in range(4) for j in range(4)} - {tuple(c) for c in omit_studs}
    posts = None
    for i, j in sorted(keep):
        xc = -18.75 + i * 12.5
        yc = -18.75 + j * 12.5
        sx = -1 if i == 0 else 1
        sy = -1 if j == 0 else (1 if j == 3 else 0)
        is_corner = (i in (0, 3) and j in (0, 3))
        px = (sx * 23.3 if is_corner else sx * 23.85) if i in (0, 3) else xc
        py = sy * 23.3 if j in (0, 3) else yc
        r_lo = 1.6 if is_corner else 0.95
        z_lo = 16.5 if is_corner else 21.2
        p_lo = Manifold.cylinder(0.2, r_lo, r_lo, 48).translate((px, py, z_lo))
        p_hi = Manifold.cylinder(2.0, 4.5, 4.5, 48).translate((xc, yc, H_tray - 2.0))
        post = Manifold.batch_hull([p_lo, p_hi])
        posts = post if posts is None else posts + post
    m = foot + walls + (posts if posts is not None else Manifold())
    m, c_top = _add_stud_grid(m, size, 4, 4, H_tray, cid="rim_studs", omit=omit_studs)
    return m, [tp.socket_conn(size, 4, 4), c_top]


def mom_band_core_tray(size="small", grid=(4, 4), **_):
    """Motion Self-Contained #64 Band Power Core Tray (49.8 x 49.8 x 32.3 mm + 2.8 studs).
    - Twin front R=4.0 mm elastomer anchor posts at (+-16.0, -16.0);
    - Internal drop-in PTO spool saddles (x in [-15.1, -9.9] & [+17.1, +22.3], z = 18.75) + axial end-stops
      capturing a standard 37.5 mm `shaft_tu03` (x in [-15.20, +22.30]) inside the enclosed lid with zero exterior protrusion;
    - Right-wall winding-key dog ports (y = 6.25 +- 7.80, z = 18.75) straddling the right saddle;
    - Double-shear X sear-pawl bearings at (y = -13.50, z = 23.50; x = -2.10..+23.25 = 25.35 mm span for pro_captive_pin_28).
    """
    m, conns = _power_core_tray_shell(size)
    m = m + Manifold.cylinder(21.0, 4.0, 4.0, 48).translate((-16.0, -16.0, 5.0))
    m = m + Manifold.cylinder(12.5, 4.0, 4.0, 48).translate((16.0, -16.0, 5.0))
    # Internal drop-in PTO spool pedestals + left axial shaft stop wall at x in [-17.10, -15.45]:
    # Closed 360-deg saddle bores (2026-11-02): the open C-jaw throat lost +Z capture twice per turn
    # when a shaft flat faced up; closed 50-deg teardrop bores (support-free roof) retain the shaft
    # at every angle (tilt-in assembly).
    jaw_2d = pro._teardrop(pro.BORE["free_d"], roof_deg=50, segs=64).rotate(90)
    for x0, x1 in ((-15.10, -9.90), (17.10, 22.30)):
        w = x1 - x0
        ped = rbox(w, 10.0, 18.8, 1.0, 0.0).translate(((x0 + x1) / 2, 6.25, 5.0))  # top z=23.8: >=1.5 mm wall over the closed bore crown (22.25)
        cut = Manifold.extrude(jaw_2d, w + 0.6).rotate((0, 90, 0)).translate((x0 - 0.3, 6.25, 18.75))
        m = m + (ped - cut)
    stop_l = rbox(1.65, 10.0, 16.8, 0.7, 0.0).translate((-16.275, 6.25, 5.0))
    m = m + stop_l
    # Centered bottom PTO gear window (10.0 x 26.0 mm at x = 0.0, y = +6.25 -> clears row-8 Z10 gear):
    m = m - Manifold.extrude(rrect(10.0, 26.0, 1.6), 6.0).translate((0.0, 6.25, -0.4))
    # (Sear-pawl boss/bore, winding-key ports and bumper-trip window removed 2026-11-02, pull-back-only Option B.)
    m = _cut_tray_sockets(m, size)
    return m, conns, {}


def mom_band_core_lid(size="small", grid=(4, 4), lock=True, **_):
    """Motion Enclosed Band Core Safety Lid With PTO Gear Dome & Barrel Hinge (49.8 x 61.5 x 16.6 mm).
    (Sear toggle slot removed 2026-11-02, pull-back-only Option B.)"""
    return _lid_with_pto_gear_relief(size, lock, extra_cut=None, include_knuckles=True)


def mom_pto_gear_z10(**_):
    """Motion Z10 PTO Spur Gear With Internal 8-Tooth Radial Freewheel Cup (30.0 x 30.0 x 9.6 mm).
    - z = 0.00..6.25: module-2.5 Z10 spur gear (fixed double-D bore locks onto internal PTO shaft);
    - z = 6.25..9.60: 45-deg corbeled cup (OD 24.4 mm, R_valley = 10.55 mm, R_crest = 9.60 mm, alpha = 6.9 deg)
      engaging mom_band_spool_pawl's spiral XY cantilever pawls (0.78 mm nominal radial bite, 0.69% PLA strain).
    """
    T_gear = pro.GEAR["thickness_tu"] * TU  # 6.25 mm
    H = 9.60
    g = pro.gear_numbers(10)
    gear_body = Manifold.extrude(pro.spur_section(10), T_gear)
    cup_outer = Manifold.batch_hull([
        Manifold.cylinder(0.3, 9.30, 9.30, 96).translate((0.0, 0.0, T_gear - 0.3)),
        Manifold.cylinder(0.6, 12.20, 12.20, 96).translate((0.0, 0.0, H - 0.6)),
    ])
    # Internal 8-tooth radial sawtooth cavity (mirrored so the clutch locks on pull-back;
    # R_crest = 9.60 mm at sector end ramping outward to R_valley = 10.55 mm at sector start):
    cav_pts = []
    for k in range(8):
        a0 = math.radians(45.0 * k)
        cav_pts.append((10.55 * math.cos(a0), 10.55 * math.sin(a0)))
        for s in range(1, 7):
            ang = math.radians(45.0 * k + 43.0 * s / 6.0)
            rr = 10.55 - 0.95 * (s / 6.0)
            cav_pts.append((rr * math.cos(ang), rr * math.sin(ang)))
    cup_cav = Manifold.extrude(_ccw_poly(cav_pts), 3.10).translate((0.0, 0.0, H - 2.90))
    m = ((gear_body + cup_outer) - cup_cav) - pro.bore_cutter("fixed", H)
    ex = {"gear": {"kind": "spur", "module_mm": g["m"], "teeth": 10, "pitch_d_mm": round(2 * g["r"], 3),
                   "outer_d_mm": round(2 * g["ra"], 3), "pressure_angle_deg": pro.GEAR["pressure_angle_deg"],
                   "backlash_mm": pro.GEAR["backlash_mm"], "thickness_mm": T_gear}}
    return m, [pro._hub_conn(H)], ex


def mom_band_spool_pawl(**_):
    """Motion Coaxial Freewheel Band Spool & Spiral XY Pawl Hub (20.3 x 20.8 x 13.0 mm, printed pawl-down on z = 0).
    - Free Ø7.00 mm center bore so the spool halts at slack while the PTO shaft and wheels coast freely;
    - Bottom z = 0.0..2.30 deck carrying twin 1.28 mm-thick x 14.7 mm-long free-flexing spiral XY cantilever pawl arms
      (R_tip = 10.38 mm over R_crest = 9.60 mm -> 0.78 mm nominal bite, 0.69% peak PLA strain, 0 overhangs, 0 bridges);
    - Central Ø12.8 x 6.6 mm drum with 43-deg captive T-hook anchor and a R7.2 mm retaining lip (48-deg printable underside) keeping a slack band out of the pawls;
    - Upper 41.8-deg smooth convex hub cone (z = 6.2..13.0, pull-back-only architecture).
    """
    H = 13.0
    pawl_hub_cs = CrossSection.circle(5.80, 96)
    arm_pts = []
    for s in range(11):
        t = s / 10.0
        ang = math.radians(-112.0 * t)  # mirrored 2026-11-02 to match the mirrored pocket (locks on pull-back)
        rr = 5.30 + 4.44 * t  # spirals from R = 5.30 out to R = 9.74 (with r=0.64 -> R_outer = 10.38 mm in R_valley = 10.55 mm)
        arm_pts.append((rr * math.cos(ang), rr * math.sin(ang)))
    arm_cs = _stroke(arm_pts, 0.64)
    pawl_top_cs = pawl_hub_cs + arm_cs + arm_cs.rotate(180.0)
    pawl_bed = Manifold.extrude(pawl_top_cs, 2.30)
    drum = Manifold.cylinder(4.60, 5.75, 6.40, 96).translate((0.0, 0.0, 2.00))
    hook_up = Manifold.batch_hull([
        Manifold.cube((1.3, 2.8, 0.2)).translate((4.2, -1.4, 2.60)),
        Manifold.cube((4.1, 3.4, 1.8)).translate((4.2, -1.7, 5.60)),
    ])
    # 41.8-deg convex hub cone (R = 6.35 -> 10.15 over z = 6.20..10.50) + 8 buried-root convex ratchet teeth (R_tip = 10.8):
    flare_cone = Manifold.batch_hull([
        Manifold.cylinder(0.30, 6.35, 6.35, 96).translate((0.0, 0.0, 6.20)),
        Manifold.cylinder(2.50, 10.15, 10.15, 96).translate((0.0, 0.0, 10.50)),
    ])
    # Drum left retaining lip (2026-11-03): keeps a slack band out of the pawls. The pawl zone below z = 2.3 is open
    # (hub + two arms), so the lip must undercut at >= 45 deg: a 48-deg conical underside rising from the hub top
    # (R5.6, z2.3) to a R7.2 rim underside at z4.1, then a 0.5 mm rim and a flat top at z4.6. The first draft (lens disc
    # R8.4, 21-deg underside) left 124 mm2 steeper than 45 deg (P1), and its R5.8 base nearly coincided with the
    # R5.75..5.79 drum and R5.80 hub, which made the exported mesh non-manifold (G1/G3). Revolved, base buried at R5.6.
    # (Hold-ratchet teeth + winding-key sockets removed with the pull-back-only decision, Option B.)
    flange = Manifold.revolve(
        CrossSection([[(5.2, 2.3), (5.6, 2.3), (7.2, 4.1), (7.2, 4.6), (5.2, 4.6)]]), 96,
    )
    m = (pawl_bed + drum + hook_up + flare_cone + flange) - pro.bore_cutter("free", H)
    c_hub = {
        "id": "hub",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [c_hub], {}


def mom_latch_pawl(**_):
    """Motion Armed/Pull-Back Ratchet Sear Pawl (26.0 x 16.0 x 5.2 mm, printed flat on z = 0)."""
    H = 5.2
    pts = [
        (-13.0, -2.0), (-4.0, -5.8), (5.5, -5.8),
        (9.5, -8.0), (13.0, -5.0), (8.0, 2.0),
        (4.5, 8.0), (-1.5, 8.0), (-4.5, 3.8), (-13.0, 1.5),
    ]
    plan = _ccw_poly(pts).offset(-0.9, JoinType.Round).offset(0.9, JoinType.Round)
    m = Manifold.extrude(plan, H) - pro.bore_cutter("free", H, 0.0, 0.0, 0.0)
    conn = {
        "id": "pivot_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def mom_wind_key(**_):
    """Motion Removable Band Winding Key (28.0 x 30.0 x 5.0 mm LAY_FLAT)."""
    hy = pro.BORE["shaft_flats"] / 2
    wing_cs = (
        rrect(28.0, 9.0, 2.4).translate((0.0, 4.5))
        + rrect(19.0, 4.5, 1.2).translate((0.0, 9.5))
        + rrect(2.8, 6.5, 0.8).translate((-7.80, 13.0))
        + rrect(2.8, 6.5, 0.8).translate((7.80, 13.0))
    )
    handle = tp._xz_to_layflat(wing_cs, hy)
    stem = pro.pin_solid("flats", 21.5, z0=8.5, tip_chamfer=(False, True))
    conn = pro._pin_conn("shaft_drive", "flats", 12.5, z0=17.0)
    return handle + stem, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def mom_bumper_trigger(**_):
    """Motion Compliant Parallelogram Bumper Trigger (48.0 x 42.0 x 12.5 mm, printed flat on z = 0).
    Stationary anchor block seats over #1 kit_keel_base's nose studs (rows 0..2) and locks into #1's (0, -37.5)
    steer_bore via pro_captive_pin_28, while twin S-curved 1.44 mm compliant flexure leaves hold the 48.0 mm front
    impact bar ahead of Ø36 tires and deflect +4.2 mm aft on obstacle contact.
    """
    H = 12.5
    p = tp.STUD["small"]
    cut_s = tp._conical_socket_cutter(p)
    front_bar = rrect(48.0, 6.4, 2.2).translate((0.0, -21.3))
    anchor_blk = rrect(24.6, 31.6, 2.2).translate((0.0, 1.7))
    striker_arm = (
        rrect(12.0, 4.0, 1.0).translate((0.0, -17.0))
        + rrect(4.2, 7.0, 1.0).translate((0.0, -13.0))
    )
    leaves = None
    for sx in (-1, 1):
        leaf = _stroke([(sx * 18.0, -19.0), (sx * 20.5, -13.0), (sx * 16.5, -7.5), (sx * 11.2, -3.5)], 0.72)
        leaves = leaf if leaves is None else leaves + leaf
    plan = front_bar + anchor_blk + striker_arm + leaves
    m = Manifold.extrude(plan, H) - pro.bore_cutter("free", H, 0.0, 12.50, 0.0)
    for sx in (-6.25, 6.25):
        for sy in (-6.25, 6.25, 18.75):
            m = m - cut_s.translate((sx, sy, 0.0))
    conn = {
        "id": "mount_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "centre",
        "frame": {"origin": [0.0, 12.50, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def mom_slam_base(**_):
    """Motion Captive Slam-Launcher Base With Upright Gabled Barrel & Horizontal Stop Pin (62.3 x 38.0 x 21.0 mm).
    - Flush tabletop base (z = 0) with enclosed 5.6 x 13.4 mm upright plunger barrel along X (50-deg gabled roof, 0 bridges);
    - Horizontal +Y `fixed` stop-pin bore (y = -19.0..+6.35) + rear Ø8.00 mm snap-latch pocket locking pro_captive_pin_28
      permanently through mom_slam_plunger's 43.0 x 7.0 mm slot;
    - Twin front #64 band posts + 2 vertical free tabletop/track anchor bores at (+-18.75, +12.50).
    """
    H = 21.0
    body = rbox(62.3, 38.0, H, 2.6, 0.4)
    # Upright 5.6 mm wide x 13.4 mm clear vertical-wall barrel along X at y in [-2.80, +2.80], z = 2.6..16.0 (+ 50-deg gable to 19.35):
    barrel_prof = _ccw_poly([(-2.80, 2.6), (2.80, 2.6), (2.80, 16.0), (0.0, 19.35), (-2.80, 16.0)]).rotate(90)
    barrel = Manifold.extrude(barrel_prof, 66.0).rotate((0, 90, 0)).translate((-33.0, 0.0, 0.0))
    grooves = None
    for sx in (-1, 1):
        gr = Manifold.batch_hull([
            Manifold.cylinder(0.2, 6.8, 6.8, 48).translate((sx * 24.5, -12.5, 12.2)),
            Manifold.cylinder(1.4, 5.2, 5.2, 48).translate((sx * 24.5, -12.5, 13.8)),
            Manifold.cylinder(0.2, 6.8, 6.8, 48).translate((sx * 24.5, -12.5, 16.8)),
        ]) - Manifold.cylinder(6.0, 4.0, 4.0, 48).translate((sx * 24.5, -12.5, 11.5))
        grooves = gr if grooves is None else grooves + gr
    # Horizontal +Y stop-pin bore at (x = 0, z = 9.375): y = -19.0..+6.35 fixed + y = +6.35..+19.5 Ø8.00 teardrop snap pocket:
    latch_pocket = Manifold.extrude(pro._teardrop(8.00, roof_deg=50, segs=48), 13.2).rotate((90, 0, 0)).translate((0.0, 19.55, 9.375))
    m = (
        (body - barrel - grooves)
        - pro.bore_cutter_axis("fixed", 39.0, (0.0, 0.0, 9.375), "y")
        - latch_pocket
        - pro.bore_cutter("free", H, -18.75, 12.5, 0.0)
        - pro.bore_cutter("free", H, 18.75, 12.5, 0.0)
    )
    c_stop = pro._axis_bore_conn("stop_bore", "fixed", (0.0, -11.3, 9.375), "y", 15.0, lattice="axis8")
    c_anchor = {
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
    return m, [c_stop, c_anchor], {}


def mom_slam_plunger(**_):
    """Motion Captive 35 mm-Stroke Slotted Slam Plunger (94.0 x 18.0 x 5.0 mm LAY_FLAT).
    12.6 mm-wide slide bar around the closed 43.0 x 7.0 mm oblong stop slot gives 2.80 mm solid side walls (7 perimeters,
    >> 1.60 mm rule) while riding upright inside mom_slam_base's enclosed barrel with a 12.5 mm shaft_drive tail.
    """
    flats = pro.BORE["shaft_flats"]
    hy = flats / 2
    head_cs = rrect(18.0, 7.5, 1.8).translate((0.0, 3.75))
    bar_cs = rrect(12.6, 74.5, 1.4).translate((0.0, 43.75)) - rrect(7.0, 43.0, 3.4).translate((0.0, 57.0))
    body = tp._xz_to_layflat(head_cs + bar_cs, hy)
    tail_outer = pro._tapered_dd_extrude(pro.BORE["shaft_d"], flats, 14.5, bot_tip=False, top_tip=True).translate((0.0, 0.0, 79.5))
    tail_hole = Manifold.batch_hull([
        Manifold.extrude(pro._teardrop(pro.BORE["shaft_center_hole"]), 0.1).translate((0.0, 0.0, 81.2)),
        Manifold.extrude(pro._teardrop(pro.BORE["shaft_center_hole"]), 11.4).translate((0.0, 0.0, 82.0)),
        Manifold.extrude(pro._teardrop(1.20), 0.8).translate((0.0, 0.0, 93.8)),
    ])
    conn = pro._pin_conn("shaft_drive", "flats", 12.5, z0=81.2)
    return (body + tail_outer) - tail_hole, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def _flat_floor_teardrop(d, floor_y):
    """50-deg top teardrop clipped to `y >= floor_y` with automatic 45-deg bottom corbel so LAY_FLAT plugs have 0 overhang."""
    td = pro._teardrop(d, roof_deg=50, segs=64)
    r, f = d / 2, -floor_y
    s45 = r * math.sin(math.pi / 4)
    if f <= s45:
        return td ^ CrossSection.square((d + 4.0, 24.0)).translate((-(d + 4.0) / 2, floor_y))
    upper = td ^ CrossSection.square((d + 4.0, 24.0)).translate((-(d + 4.0) / 2, -s45))
    xc = max(0.4, s45 - (f - s45))
    foot = CrossSection([[(-xc, floor_y), (xc, floor_y), (xc, -s45 + 0.05), (-xc, -s45 + 0.05)]])
    return CrossSection.batch_hull([upper, foot])


def mom_jet_valve_body(size="small", grid=(4, 2), lock=True, **_):
    """Motion Self-Wedging Taper-Sealed Balloon Jet & Valve Body (49.8 x 27.8 x 28.0 mm, 0 mouthpiece).
    - Low 5.4 mm side mounting wings + central 24.0 mm-wide valve turret (z = 0..20.6) & smooth top balloon collar at (0, -3.0);
    - Continuous Ø8.0 mm (50.1 mm2) vertical inlet (y = -4.70, z = 12.8..28.8) + 8.36 mm (52.6 mm2) flat-floor teardrop +Y tunnel;
    - 3.5-deg tapered flat-floor 50-deg teardrop transverse X valve seat (x in [-4.0, +12.3], d = 8.30 -> 9.30 mm) giving 360-deg
      CLOSED seal contact adjacent to an 8.0 mm Pro `free` guide bore (x in [-12.0, -4.0]);
    - Rear 4.0-deg tapered female 50-deg teardrop Luer socket (y = +8.5..+14.7, z = 12.50, d = 9.60 -> 10.45 mm) seating mom_nozzle_set.
    """
    wings = tp._flat_box(49.8, 24.8, 5.4, r=2.4, bed_ch=0.4)
    turret = Manifold.batch_hull([
        Manifold.extrude(rrect(24.0, 24.8, 2.2), 0.4).translate((0.0, 0.0, 5.0)),
        Manifold.extrude(rrect(24.0, 26.8, 2.2).translate((0.0, 1.0)), 13.0).translate((0.0, 0.0, 7.6)),
    ])
    collar = Manifold.batch_hull([
        Manifold.cylinder(6.8, 9.6, 9.6, 64).translate((0.0, -3.0, 19.8)),
        Manifold.cylinder(1.6, 10.4, 10.4, 64).translate((0.0, -3.0, 26.4)),
    ])
    m, conns, ex = tp.integrated_sockets(wings + turret + collar, size, lock)
    inlet = Manifold.cylinder(16.0, 4.00, 4.00, 48).translate((0.0, -4.70, 12.8))  # O8.0 inlet offset aft so its front rim (y=-0.70) stays 0.60 mm behind the tunnel lip (y=-0.10) in CLOSED
    tun_sec = _flat_floor_teardrop(8.36, -2.50)  # matches the spool plug tip profile (8.36 mm) so CLOSED covers 100% of the tunnel cross-section
    tunnel = Manifold.extrude(tun_sec, 9.30).rotate((90, 0, 0)).translate((0.0, 9.2, 12.50))
    # Rear 4-deg tapered 50-deg teardrop female nozzle socket (y = +8.5..+14.7, d = 9.60 -> 10.45 mm, clearing full O8.0 bore):
    noz_lo = Manifold.extrude(pro._teardrop(9.60, roof_deg=50, segs=64), 0.1).rotate((90, 0, 0)).translate((0.0, 8.5, 12.50))
    noz_hi = Manifold.extrude(pro._teardrop(10.45, roof_deg=50, segs=64), 0.1).rotate((90, 0, 0)).translate((0.0, 14.7, 12.50))
    noz_sock = Manifold.batch_hull([noz_lo, noz_hi])
    # Transverse X valve bore at (y = -3.0, z = 12.50): -X free Ø7.00 guide bore + [-4.0, +12.3] 3.5-deg tapered flat-floor teardrop seat:
    v_lo = Manifold.extrude(_flat_floor_teardrop(8.30, -2.48).rotate(90), 0.1).rotate((0, 90, 0)).translate((-4.0, -3.0, 12.50))
    v_hi = Manifold.extrude(_flat_floor_teardrop(9.30, -2.48).rotate(90), 0.1).rotate((0, 90, 0)).translate((12.3, -3.0, 12.50))
    valve_taper = Manifold.batch_hull([v_lo, v_hi])
    valve_guide = pro.bore_cutter_axis("free", 8.4, (-8.1, -3.0, 12.50), "x")
    m = m - inlet - tunnel - noz_sock - valve_taper - valve_guide
    c_valve = pro._axis_bore_conn("valve_bore", "free", (-8.0, -3.0, 12.50), "x", 7.6, lattice="pivot")
    return m, conns + [c_valve], ex


def mom_jet_slide_valve(**_):
    """Motion Taper-Wedging Jet Shutoff Spool (9.6 x 38.0 x 8.5 mm LAY_FLAT).
    - z = 2.0..18.0: 3.5-deg tapered flat-floor 50-deg-gabled sealing plug (d = 9.38 -> 8.36 mm) that wedges 360 deg tight across
      both sides of the balloon inlet when pushed CLOSED (0 topological gap in CAD);
    - z = 21.5: fully enclosed 38.1 mm2 (O6.96 mm equiv) flat-floor 50-deg teardrop cross-port aligning OPEN;
    - z = 26.5..38.0: pure Ø6.60 mm Pro pin_free guide stem.
    """
    pf = tp.IF["interfaces"]["pin_free"]
    flats = pf["shaft_flats"]
    fy = -flats / 2
    head_cs = pro._double_d(9.6, flats, corners=False)
    s_lo_cs = _flat_floor_teardrop(9.38, fy)
    s_hi_cs = _flat_floor_teardrop(8.36, fy)
    rod_cs = pro._double_d(pro.BORE["shaft_d"], flats)
    head = Manifold.extrude(head_cs, 2.2)
    taper_plug = Manifold.batch_hull([
        Manifold.extrude(s_lo_cs, 0.2).translate((0.0, 0.0, 2.0)),
        Manifold.extrude(s_hi_cs, 0.2).translate((0.0, 0.0, 18.0)),
    ])
    port_zone = Manifold.extrude(s_hi_cs, 7.6).translate((0.0, 0.0, 17.8))
    ramp_to_rod = Manifold.batch_hull([
        Manifold.extrude(_flat_floor_teardrop(8.20, fy), 0.2).translate((0.0, 0.0, 25.2)),
        Manifold.extrude(rod_cs, 0.2).translate((0.0, 0.0, 26.8)),
    ])
    rod = pro._tapered_dd_extrude(pro.BORE["shaft_d"], flats, 11.5, bot_tip=False, top_tip=True).translate((0.0, 0.0, 26.5))
    # Fully enclosed flat-floor 50-deg teardrop cross-port (38.1 mm2 = O6.96 mm equiv; solid bed floor y=-2.50..-1.70 and solid top bridge):
    port_cs = _flat_floor_teardrop(7.30, -1.85).translate((0.0, 0.15))
    port = Manifold.extrude(port_cs, 10.0).rotate((0, 90, 0)).translate((-5.0, 0.0, 21.5))
    m = (head + taper_plug + port_zone + ramp_to_rod + rod) - port
    conn = pro._pin_conn("pin_free", "round", 11.0, z0=27.0, flats_mm=flats)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


def mom_nozzle_set(**_):
    """Motion Individual Rear-Orifice Nozzle Inserts (63.0 x 14.1 x 8.2 mm sprue: Ø3.0 / Ø4.5 / Ø6.0 / Ø8.0 mm).
    Four individual 4-deg Luer-tapered inserts on 1.80 x 0.60 mm breakaway tabs flanking a central Ø10.4 mm storage hub (free bore, stores on a pin);
    each insert's taper plug (teardrop 10.40 -> 9.65, z = 2.0..8.2) press-wedges alone into mom_jet_valve_body's rear socket
    (9.60 -> 10.45) with an unblocked Ø8.0 mm front entry converging cleanly to its rear exit orifice (Ø3.0 / Ø4.5 / Ø6.0 / Ø8.0).
    """
    inserts = None
    for xc, d_exit in ((-25.5, 3.0), (-12.0, 4.5), (12.0, 6.0), (25.5, 8.0)):
        # Flange = hull of the R6.0 grip disc and the plug's own teardrop footprint, so the plug apex (y up to +8.1) stands on
        # flange instead of overhanging it (P4: 5.1 mm2 of flat underside at z = 2.0 with a plain R6.0 disc).
        flange = Manifold.batch_hull([
            Manifold.cylinder(2.0, 6.0, 6.0, 64),
            Manifold.extrude(pro._teardrop(10.40, roof_deg=50, segs=64), 2.0),
        ]).translate((xc, 0.0, 0.0))
        p_lo = Manifold.extrude(pro._teardrop(10.40, roof_deg=50, segs=64), 0.2).translate((xc, 0.0, 2.0))
        p_hi = Manifold.extrude(pro._teardrop(9.65, roof_deg=50, segs=64), 0.2).translate((xc, 0.0, 8.0))
        plug = Manifold.batch_hull([p_lo, p_hi])
        bore = Manifold.cylinder(8.6, d_exit / 2, 4.00, 64).translate((xc, 0.0, -0.2))
        ins = (flange + plug) - bore
        inserts = ins if inserts is None else inserts + ins
    hub = Manifold.cylinder(2.0, 5.2, 5.2, 64) - pro.bore_cutter("free", 2.4, 0.0, 0.0, 0.0)
    tabs = None
    for x0, x1 in ((-19.7, -17.8), (-6.2, -5.0), (5.0, 6.2), (17.8, 19.7)):
        tab = Manifold.cube((x1 - x0, 1.8, 0.6)).translate((x0, -0.9, 0.7))
        tabs = tab if tabs is None else tabs + tab
    m = inserts + hub + tabs
    conn = {
        "id": "mount_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": 2.0,
        "lattice": "axis8",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


BELLOWS_HINGE_Y = 38.25
BELLOWS_BASE_HINGE_Z = 13.50
BELLOWS_LEAF_HINGE_Z = 5.75


def mom_bellows_base(size="small", grid=(4, 4), **_):
    """Motion 4x4 TU Hinged Balloon Bellows Base (49.8 x 68.8 x 19.1 mm).
    - Tapered side balloon containment curtains (16.5 mm at front rest bar sloping to 7.5 mm aft) + 8.0 mm rear neck U-slot;
    - Interleaved rear X-hinge knuckles at |X| in [4.2, 9.6] & [15.4, 18.75] (pinned flush by 37.5 mm shaft_tu03).
    """
    p = tp.STUD[size]
    fh = 5.2
    foot = rbox(49.8, 49.8, fh, p["edge_r"], p["bed_chamfer"])
    u_rim = rrect(49.2, 46.0, 2.0) - rrect(42.0, 41.0, 1.5)
    curt_raw = Manifold.extrude(u_rim, 17.0 - fh + 0.4).translate((0.0, 0.0, fh - 0.4))
    slope_cut = Manifold.batch_hull([
        Manifold.cube((54.0, 2.0, 14.0)).translate((-27.0, -23.0, 16.5)),
        Manifold.cube((54.0, 4.0, 18.0)).translate((-27.0, 22.0, 7.5)),
    ])
    neck_slot = Manifold.cube((8.0, 10.0, 14.0)).translate((-4.0, 18.0, fh + 0.2))
    knuckles = None
    for x0, x1 in ((-18.75, -15.40), (-9.60, -4.20), (4.20, 9.60), (15.40, 18.75)):
        kn = _bellows_knuckle(x0, x1, BELLOWS_HINGE_Y, BELLOWS_BASE_HINGE_Z, rk=5.65, y_fuse=23.2, h_bridge=7.5)
        knuckles = kn if knuckles is None else knuckles + kn
    m = (foot + ((curt_raw - slope_cut) - neck_slot) + knuckles) - pro.bore_cutter_axis("free", 40.0, (0.0, BELLOWS_HINGE_Y, BELLOWS_BASE_HINGE_Z), "x")
    m = _cut_tray_sockets(m, size)
    c_h = pro._axis_bore_conn("hinge_bore", "free", (-6.90, BELLOWS_HINGE_Y, BELLOWS_BASE_HINGE_Z), "x", 5.4, lattice="pivot")
    return m, [tp.socket_conn(size, 4, 4), c_h], {}


def mom_bellows_leaf(size="small", grid=(4, 4), lock=True, **_):
    """Motion 4x4 TU Hinged Upper Bellows Leaf (49.8 x 68.8 x 11.4 mm).
    Twin rear cheeks strictly in the stud-free |X| in [10.30, 14.70] corridor carry interleaved 50-deg teardrop
    barrel hinge knuckles at (y = +38.25, z = +5.75) pinned by shaft_tu03 (I3 = 0.000 mm3).
    """
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    raw, c_top = _add_stud_grid(raw, size, 4, 4, H, cid="top_studs")
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    knuckles = (
        _bellows_knuckle(-14.70, -10.30, BELLOWS_HINGE_Y, BELLOWS_LEAF_HINGE_Z, rk=5.65, y_fuse=23.2, h_bridge=H)
        + _bellows_knuckle(10.30, 14.70, BELLOWS_HINGE_Y, BELLOWS_LEAF_HINGE_Z, rk=5.65, y_fuse=23.2, h_bridge=H)
    )
    m = (m + knuckles) - pro.bore_cutter_axis("free", 34.0, (0.0, BELLOWS_HINGE_Y, BELLOWS_LEAF_HINGE_Z), "x")
    c_h = pro._axis_bore_conn("hinge_bore", "free", (-12.50, BELLOWS_HINGE_Y, BELLOWS_LEAF_HINGE_Z), "x", 4.4, lattice="pivot")
    return m, conns + [c_top, c_h], ex


def mom_flywheel_tray(size="small", grid=(4, 4), **_):
    """Motion Un-Jammed Shrouded Vertical-Spindle Turbine Core Tray (49.8 x 49.8 x 32.3 mm + 2.8 studs).
    - Lowered z = 10.5 mm step bearing pedestal leaves 21.8 mm vertical cavity so the 12.0 mm Ø42 rotor + 6.25 mm
      Z10 pinion spin with +2.65 mm axial clearance under mom_flywheel_lid;
    - Enlarged 6.8 x 12.8 mm bridged side rip-cord ports at y in [-22.3, -9.5], z = 23.0..29.8 tangent to Z10 pitch y = -12.50.
    """
    omit_fw = [[i, j] for i in range(4) for j in range(4) if (i, j) not in {(0, 2), (3, 2), (0, 3), (3, 3)}]
    m, conns = _power_core_tray_shell(size, omit_studs=omit_fw)
    ped = Manifold.cylinder(5.5, 7.8, 6.2, 64).translate((0.0, 0.0, 5.0))
    m = m + ped
    m, c_sp = tp.cut_vertical_bore(m, "spindle_step", 0.0, 0.0, 5.0, 5.5, "free")
    c_sp["lattice"] = "axis"
    # 12.8 mm wide x 6.8 mm tall rip-cord port (y in [-22.3, -9.5] <= 20 mm bridge limit, front tray wall backs rack at y = -22.9):
    rack_slot = Manifold.cube((54.0, 12.8, 6.8)).translate((-27.0, -22.3, 23.0))
    vent_prof = _ccw_poly([(-1.2, 0.0), (1.2, 0.0), (1.2, 11.2), (0.0, 12.6), (-1.2, 11.2)])
    for sx in (-9.0, 0.0, 9.0):
        for y0 in (26.3, -21.8):
            vent = Manifold.extrude(vent_prof, 4.5).rotate((90, 0, 0)).translate((sx, y0, 9.5))
            m = m - vent
    m = _cut_tray_sockets(m - rack_slot, size)
    return m, conns + [c_sp], {}


# ==========================================================================
# WAVE W13: Pro Powered Add-On Drop-In Printable RC Housings (Card F, PETG, 11 parts)
# ==========================================================================
def mech_drive_tray(size="small", grid=(4, 4), **_):
    """Add-On PETG 4x4x3 TU N20 Double-Shear Drive Core Tray (49.8 x 49.8 x 32.3 mm + 2.8 studs, zero -X bulge).
    - Precision saddle clamping a standard 12 x 10 x 24 mm N20 gearmotor at x in [-23.50, +0.50], y = +6.25, z = 18.75
      (leaving a 1.30 mm solid -X wall inside x = -24.90 so Giant Ø50 tires keep +1.80 mm clearance);
    - Internal +X Ø7.00 mm `free` outboard pilot bearing boss (`x in [+11.50, +17.50]`) putting mech_n20_pinion_z10
      in true double shear directly over #1's centered x in [-5.00, +5.00] PTO slot;
    - Inter-stud Ø5.0 mm vertical wire chimney at (-12.50, -12.50).
    """
    m, conns = _power_core_tray_shell(size)
    # Motor saddle walls buried 0.6 mm into -X outer wall (x in [-23.50, -3.50]) so boolean union has 0 coplanar faces:
    saddle = rbox(20.0, 16.4, 19.0, 1.2, 0.0).translate((-13.5, 6.25, 5.0))
    n20_cut = Manifold.cube((24.25, 12.30, 12.5)).translate((-23.60, 6.25 - 6.15, 13.60))
    gear_well = Manifold.cylinder(9.0, 16.0, 16.0, 72).rotate((0, 90, 0)).translate((-4.50, 6.25, 18.75))
    pilot_post = rbox(6.0, 12.4, 19.5, 1.4, 0.0).translate((14.50, 6.25, 5.0))
    chimney = Manifold.cylinder(6.2, 2.50, 2.50, 48).translate((-12.50, -12.50, -0.4))
    m = ((m + saddle + pilot_post) - n20_cut - gear_well - chimney)
    m = m - Manifold.extrude(rrect(10.0, 28.0, 1.6), 9.0).translate((0.0, 6.25, -0.4))
    m = m - pro.bore_cutter_axis("free", 7.0, (14.50, 6.25, 18.75), "x")
    m = _cut_tray_sockets(m, size)
    c_pilot = pro._axis_bore_conn("pto_pilot_bore", "free", (14.50, 6.25, 18.75), "x", 6.0, lattice="pivot")
    return m, conns + [c_pilot], {}


def mech_drive_lid(size="small", grid=(4, 4), lock=True, **_):
    """Add-On PETG 4x4 TU Drive Core Intermediate Lid With PTO Gear Dome & Wire Chimney (49.8 x 49.8 x 8.0 mm)."""
    chimney = Manifold.cylinder(6.0, 2.50, 2.50, 48).translate((-12.50, -12.50, -0.3))
    return _lid_with_pto_gear_relief(size, lock, extra_cut=chimney, include_knuckles=False)


def mech_n20_pinion_z10(**_):
    """Add-On PETG Centered Double-Shear N20 Motor Z10 Pinion (30.0 x 28.9 x 20.0 mm, printed gear-down on z = 0).
    - z = 0.0..6.25: module-2.5 Z10 involute spur gear centered at x in [-3.125, +3.125] over #1's PTO slot, with an
      internal R = 8.00 mm bell pocket (z = 0..3.65, 44-deg self-supporting cone roof) clearing the N20 gearbox nose;
    - z = 10.25..13.85: dogbone-relieved Ø3.16 mm / 2.56 mm-flat N20 D-shaft bore + radial M2.5 set-screw hole at z = 12.0;
    - z = 14.50..20.00: integral Ø6.60 mm Pro `pin_free` pilot journal riding in mech_drive_tray's outboard bearing.
    """
    T_gear = pro.GEAR["thickness_tu"] * TU  # 6.25 mm
    g = pro.gear_numbers(10)
    gear_body = Manifold.extrude(pro.spur_section(10), T_gear)
    collar = Manifold.batch_hull([
        Manifold.cylinder(0.80, 8.80, 8.80, pro.SEGS).translate((0.0, 0.0, 5.50)),
        Manifold.cylinder(4.80, 5.60, 5.60, pro.SEGS).translate((0.0, 0.0, 9.70)),
    ])
    journal = Manifold.cylinder(6.50, pro.BORE["shaft_d"] / 2, pro.BORE["shaft_d"] / 2, pro.SEGS).translate((0.0, 0.0, 13.50))
    # R = 8.00 mm N20 nose bell + 44.2-deg self-supporting cone to R = 0.60 inside d_bore (single hull -> 0 coplanar seams):
    bell = Manifold.batch_hull([
        Manifold.cylinder(0.10, 8.00, 8.00, pro.SEGS).translate((0.0, 0.0, -0.20)),
        Manifold.cylinder(0.10, 8.00, 8.00, pro.SEGS).translate((0.0, 0.0, 3.55)),
        Manifold.cylinder(0.10, 0.60, 0.60, pro.SEGS).translate((0.0, 0.0, 11.20)),
    ])
    d_cs = (CrossSection.circle(1.58, 64) ^ CrossSection.square((4.0, 3.20)).translate((-2.0, -2.22)))
    for sx in (-1, 1):
        d_cs = d_cs + CrossSection.circle(0.32, 32).translate((sx * 1.00, 0.98))
    d_cs = d_cs.offset(-0.08, JoinType.Round, 2.0, 24).offset(0.08, JoinType.Round, 2.0, 24)
    d_bore = Manifold.batch_hull([
        Manifold.extrude(d_cs, 5.25).translate((0.0, 0.0, 8.60)),
        Manifold.cylinder(0.10, 0.25, 0.25, 32).translate((0.0, -0.10, 15.75)),
    ])
    set_screw = Manifold.extrude(pro._teardrop(2.2, roof_deg=50, segs=32), 8.0).rotate((90, 0, 0)).translate((0.0, 7.0, 12.0))
    m = (gear_body + collar + journal) - bell - d_bore - set_screw
    conn = pro._pin_conn("pin_free", "round", 5.2, z0=14.6)
    ex = {"gear": {"kind": "spur", "module_mm": g["m"], "teeth": 10, "pitch_d_mm": round(2 * g["r"], 3),
                   "outer_d_mm": round(2 * g["ra"], 3), "pressure_angle_deg": pro.GEAR["pressure_angle_deg"],
                   "backlash_mm": pro.GEAR["backlash_mm"], "thickness_mm": T_gear}}
    return m, [conn], ex


def mech_brain_tray(size="small", grid=(4, 4), **_):
    """Add-On PETG 4x4x2 TU Low-CG Brain & LiPo Core Tray (49.8 x 49.8 x 19.8 mm + 2.8 studs; +5.2 lid = 25.0 mm = 2 TU).
    - Intact 4x4 socket_small floor + open-top rear lengthwise 602535 LiPo drawer (26.2 x 36.0 x 7.0 mm, 0 bridges, 0 ledges)
      closed from behind by mech_bat_door_screw (M2.5 captive screw into right-rear boss at x = +14.8);
    - 45-deg corbeled PCB/MCU ledges at z = 12.8 mm holding 38x38 carrier PCB or XIAO ESP32 + DRV8833;
    - Left-wall USB-C port, front servo wire exit at x = +10.5, and (-12.5, -12.5) floor wire chimney.
    """
    H_tray = 19.8
    foot = tp.block(size, 4, 4, 5.2, 2.0, studs=False)
    walls = (
        Manifold.extrude(rrect(49.8, 49.8, 2.2), H_tray - 5.0).translate((0.0, 0.0, 5.0))
        - Manifold.extrude(rrect(45.8, 45.8, 1.2), H_tray - 4.6).translate((0.0, 0.0, 5.2))
    )
    posts = None
    for sx in (-1, 1):
        l_lo = Manifold.cube((1.2, 27.0, 0.2)).translate(((22.3 if sx > 0 else -23.5), -13.5, 7.2))
        l_hi = Manifold.cube((4.8, 27.0, 0.8)).translate(((18.7 if sx > 0 else -23.5), -13.5, 12.0))
        ledge = Manifold.batch_hull([l_lo, l_hi])
        posts = ledge if posts is None else posts + ledge
        for sy in (-1, 1):
            p_lo = Manifold.cylinder(0.2, 2.2, 2.2, 48).translate((sx * 22.5, sy * 22.5, 5.0))
            p_hi = Manifold.cylinder(2.0, 4.5, 4.5, 48).translate((sx * 18.75, sy * 18.75, H_tray - 2.0))
            posts = posts + Manifold.batch_hull([p_lo, p_hi])
    m = foot + walls + posts
    omit = [[i, j] for i in range(4) for j in range(4) if not (i in (0, 3) and j in (0, 3))]
    m, c_top = _add_stud_grid(m, size, 4, 4, H_tray, cid="rim_studs", omit=omit)
    # Rear open-top U-portal for lengthwise 602535 LiPo insertion (x in [-13.1, +13.1], clear of rear corner studs -> 0 overhang/ledge!):
    bat_portal = Manifold.cube((26.2, 6.0, 15.0)).translate((-13.1, 21.0, 5.4))
    usbc = Manifold.cube((6.0, 12.0, 7.2)).translate((-26.0, -13.5, 13.2))
    sill_notch = Manifold.cube((6.0, 6.0, 6.2)).translate((7.5, -26.0, 14.0))
    chimney = Manifold.extrude(rrect(5.2, 5.2, 1.0), 6.2).translate((-12.50, -12.50, -0.4))
    m25 = Manifold.extrude(pro._teardrop(2.2, roof_deg=50, segs=32), 6.0).rotate((90, 0, 0)).translate((14.8, 25.2, 10.8))
    m = m - bat_portal - usbc - sill_notch - chimney - m25
    return m, [tp.socket_conn(size, 4, 4), c_top], {}


def mech_brain_lid(size="small", grid=(4, 4), lock=True, **_):
    """Add-On PETG 4x4 TU Vented RF-Clear Brain Lid With Rear Barrel Hinges (49.8 x 61.5 x 16.6 mm)."""
    H = 5.2
    raw = tp._flat_box(49.8, 49.8, H, r=2.2, bed_ch=0.4)
    raw, c_top = _add_stud_grid(raw, size, 4, 4, H, cid="top_studs")
    m, conns, ex = tp.integrated_sockets(raw, size, lock)
    for xc in (-12.5, 0.0, 12.5):
        v = Manifold.extrude(rrect(2.2, 18.0, 0.9), H + 0.6).translate((xc, 0.0, -0.3))
        m = m - v
    m, c_h = _rear_lid_hinge_knuckles(m, h_bridge=H)
    return m, conns + [c_top, c_h], ex


def mech_bat_door_screw(**_):
    """Add-On PETG Tool-Locked LiPo Battery Door (33.6 x 10.6 x 4.2 mm, ASTM F963-23 battery lock).
    Left plug tab keys inside mech_brain_tray's 26.2 mm rear battery portal while a captive M2.5 screw at x = +14.8 locks
    the door flush above mech_drive_lid's dump cradles; central free Pro bore takes rear tow hitches or flags.
    """
    H = 4.20
    body = rbox(33.6, 10.6, H, 1.8, 0.4)
    tab = rbox(2.6, 7.6, 1.8, 0.6, 0.0).translate((-11.4, 0.0, H - 0.2))
    screw_bore = Manifold.cylinder(H + 0.4, 1.45, 1.45, 32).translate((14.8, 0.0, -0.2))
    csk = Manifold.cylinder(1.8, 2.7, 2.7, 32).translate((14.8, 0.0, -0.1))
    m = (body + tab) - screw_bore - csk - pro.bore_cutter("free", H, 0.0, 0.0, 0.0)
    conn = {
        "id": "hitch_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": H,
        "lattice": "axis",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    return m, [conn], {}


def mech_servo_mount(size="small", grid=(2, 2), lock=True, **_):
    """Add-On PETG Row-2 Coaxial 9g Servo Bridge (48.0 x 21.8 x 32.8 mm, printed flat on z = 0, 0 ledges/bridges).
    - Local origin sits at world (0, -37.50, 12.50): rear pedestal (y in [+0.25, +12.40], |X| <= 12.20) seats onto
      #1 kit_keel_base Row-2 studs (+-6.25, -31.25), strictly clear of pro_steer_bridge (y <= -0.10), Kip (y >= +13.0),
      and Giant Ø50 front tires (+0.8 mm vertical clearance under clamp pins at +-25 deg lock);
    - Forward-oriented (-Y) shaft-down 9g SG90 cradle corbels above z = 20.0 (servo bottom at Z_world = 38.50 > link top 35.65,
      mounting ears at Z_world = 42.8..45.3), with 41-deg side clamp wings at (+-18.75, +6.25) for 2x `pro_captive_pin_28`.
    """
    H = 32.8
    p = tp.STUD[size]
    cut_s = tp._conical_socket_cutter(p)
    ped = rbox(24.4, 12.15, 20.8, 1.6, 0.4).translate((0.0, 6.325, 0.0))
    cradle = Manifold.batch_hull([
        Manifold.extrude(rrect(24.4, 11.40, 1.6).translate((0.0, 6.25)), 0.4).translate((0.0, 0.0, 24.6)),
        Manifold.extrude(rrect(24.4, 18.60, 2.0).translate((0.0, 2.65)), 0.4).translate((0.0, 0.0, 32.4)),
    ])
    clamp_bar = Manifold.batch_hull([
        Manifold.extrude(rrect(24.4, 11.40, 1.6).translate((0.0, 6.25)), 0.4).translate((0.0, 0.0, 11.4)),
        Manifold.extrude(rrect(48.0, 11.40, 2.4).translate((0.0, 6.25)), 8.2).translate((0.0, 0.0, 24.6)),
    ])
    m = ped + cradle + clamp_bar
    pilot_clear = Manifold.cylinder(12.2, 4.40, 4.40, 64).translate((0.0, 0.0, -0.2))
    gear_clear = Manifold.batch_hull([
        Manifold.cylinder(0.1, 15.6, 15.6, 64).translate((0.0, 0.0, 12.0)),
        Manifold.cylinder(0.1, 15.6, 15.6, 64).translate((0.0, 0.0, 19.5)),
        Manifold.cylinder(0.1, 6.1, 6.1, 64).translate((0.0, 0.0, 29.8)),
    ])
    sg90_well = Manifold.cube((12.6, 23.0, 8.0)).translate((-6.3, -16.8, 25.8))
    sg90_ears = Manifold.cube((12.6, 33.0, 3.5)).translate((-6.3, -21.7, 30.1))
    m = m - pilot_clear - gear_clear - sg90_well - sg90_ears
    for sx in (-6.25, 6.25):
        m = m - cut_s.translate((sx, 6.25, 0.0))
    c_sock = tp.socket_conn(size, 2, 2)
    c_sock["style"] = "holes"
    c_sock["grid"]["omit_cells"] = [[0, 0], [1, 0]]
    # 3-TU (x = +-18.75, y = +6.25) `fixed` bores + 45-deg conical head seats (z = 11.45 -> 36.80 lid shoulder = 25.35 mm!):
    for sx in (-18.75, 18.75):
        m = m - pro.bore_cutter("fixed", H - 11.40, sx, 6.25, 11.40)
        m = m - (Manifold.cylinder(12.1, 5.10, 5.10, 48).translate((sx, 6.25, -0.60))
                 + Manifold.cylinder(1.90, 5.10, 3.25, 48).translate((sx, 6.25, 11.45)))
    c_clamp = {
        "id": "clamp_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "fixed",
        "depth_mm": 19.0,
        "lattice": "axis8",
        "frame": {"origin": [-18.75, 6.25, 13.6], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 37.5, "anchor": "corner"},
    }
    return m, [c_sock, c_clamp], {"sockets": {"holes": 2, "reliefs": 0, "locked": bool(lock)}}


def mech_servo_lid(**_):
    """Add-On PETG Screwless 9g Servo Clamp Cap (48.0 x 12.4 x 6.25 mm, printed flat on z = 0).
    Clamps down onto the rear SG90 mounting ear via 2x upward pro_captive_pin_28 at (+-18.75, 0) while straddling
    the upper SG90 body and staying strictly ahead of Y = -25.05 mm (0.000 mm3 overlap with Kip and mech_sill_duct).
    """
    H = 6.25
    plan = rrect(48.0, 12.4, 2.2) - rrect(13.2, 8.0, 1.0).translate((0.0, -3.5))
    m = Manifold.extrude(plan, H) - pro.bore_cutter("fixed", H, -18.75, 0.0, 0.0) - pro.bore_cutter("fixed", H, 18.75, 0.0, 0.0)
    for sx in (-18.75, 18.75):
        m = m - Manifold.cylinder(H - 4.00 + 0.2, 4.00, 4.00, 64).translate((sx, 0.0, 4.00))
    conn = {
        "id": "clamp_bores",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "fixed",
        "depth_mm": 4.00,
        "lattice": "axis8",
        "frame": {"origin": [-18.75, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 2, "ny": 1, "pitch": 37.5, "anchor": "corner"},
    }
    return m, [conn], {}


def mech_servo_pinion_z10(**_):
    """Add-On PETG Horn-Pocket Z10 Steering Servo Pinion (30.0 x 28.9 x 8.8 mm, printed gear-down on z = 0).
    - z = 0.0..6.60: module-2.5 Z10 involute spur gear + bottom Ø7.00 mm `free` Pro pilot bore (z = 0..5.10, 45-deg cone roof);
    - z = 6.45..8.80: Ø23.0 mm rack-keeper flange (0.20 mm clear above 6.25 mm rack, traps rack +Z) with an upward-opening
      cross pocket capturing the 9g servo's factory-molded nylon horn + M2 center screw hole (zero printed micro-splines).
    """
    T_gear = pro.GEAR["thickness_tu"] * TU  # 6.25 mm
    H = 8.80
    g = pro.gear_numbers(10)
    gear_body = Manifold.extrude(pro.spur_section(10), 6.60)
    keeper = Manifold.cylinder(H - 6.45, 11.50, 11.50, pro.SEGS).translate((0.0, 0.0, 6.45))
    horn_cs = rrect(20.2, 5.4, 2.2) + rrect(5.4, 20.2, 2.2) + CrossSection.circle(4.2, 48)
    horn_pocket = Manifold.extrude(horn_cs, 3.0).translate((0.0, 0.0, 6.40))
    pilot_bore = pro.bore_cutter("free", 5.10, 0.0, 0.0, 0.0) - Manifold.cube((20.0, 20.0, 5.0)).translate((-10.0, -10.0, 5.10))
    cone_roof = Manifold.cylinder(2.30, pro.BORE["free_d"] / 2, 1.25, pro.SEGS).translate((0.0, 0.0, 5.05))
    m2_hole = Manifold.cylinder(H + 0.4, 1.30, 1.30, 32).translate((0.0, 0.0, -0.2))
    m = (gear_body + keeper) - horn_pocket - pilot_bore - cone_roof - m2_hole
    c_pilot = {
        "id": "pilot_bore",
        "kind": "bore_grid",
        "gender": "F",
        "interface": "bore_grid",
        "size_class": "pro",
        "fit_class": "PIN",
        "bore_class": "free",
        "depth_mm": 5.10,
        "lattice": "axis",
        "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
        "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"},
    }
    ex = {"gear": {"kind": "spur", "module_mm": g["m"], "teeth": 10, "pitch_d_mm": round(2 * g["r"], 3),
                   "outer_d_mm": round(2 * g["ra"], 3), "pressure_angle_deg": pro.GEAR["pressure_angle_deg"],
                   "backlash_mm": pro.GEAR["backlash_mm"], "thickness_mm": T_gear}}
    return m, [c_pilot], ex


def pro_pilot_pin(**_):
    """Add-On Self-Retaining Lantern-Barb Under-Keel Servo Pilot Pin (9.6 x 31.5 x 5.6 mm LAY_FLAT).
    - z = 0.0..1.50: 9.6 x 5.6 mm stop head under #1 kit_keel_base (blocks +Z pull-through);
    - z = 3.50..24.30: compliant PETG lantern bowspring (1.30 mm leaves, < 1.51% insertion strain, 0.00% seated strain)
      with +-X Ø7.70 mm (+0.35 mm/side) snap-barbs at z = 14.15..15.50 locking over #1's z = 12.50 steer_bore deck;
    - z = 24.50..31.50: solid Ø6.60 mm Pro `pin_free` upper pilot journal supporting mech_servo_pinion_z10 in double shear.
    """
    pf = tp.IF["interfaces"]["pin_free"]
    hh, flats = 1.50, pf["shaft_flats"]
    hy = flats / 2
    head = Manifold.extrude(pro._double_d(9.6, flats, corners=False), hh)
    shank = pro._tapered_dd_extrude(pro.BORE["shaft_d"], flats, 30.10, bot_tip=False, top_tip=True).translate((0.0, 0.0, hh - 0.10))
    barb = Manifold.batch_hull([
        Manifold.extrude(pro._double_d(pro.BORE["shaft_d"], flats), 0.06).translate((0.0, 0.0, 14.12)),
        Manifold.extrude(pro._double_d(7.70, flats, corners=False), 0.65).translate((0.0, 0.0, 14.24)),
        Manifold.extrude(pro._double_d(pro.BORE["shaft_d"], flats), 0.06).translate((0.0, 0.0, 15.60)),
    ])
    slot_cs = rrect(4.00, 20.80, 1.80).translate((0.0, 13.90))
    slot = Manifold.extrude(slot_cs, flats + 2.0).rotate((90, 0, 0)).translate((0.0, hy + 1.0, 0.0))
    m = (head + shank + barb) - slot
    return m, [pro._pin_conn("pin_free", "round", 6.60, z0=24.70, flats_mm=flats)], {"print_rotation_deg": pro.LAY_FLAT}


def mech_sill_duct(size="small", grid=(4, 3), lock=True, **_):
    """Add-On PETG Low-Profile Cockpit Wire-Trough Sill Frame (49.8 x 37.3 x 11.6 mm).
    Replaces #8 kit_windscreen on open-cockpit RC builds while keeping 6.0 x 4.0 mm side cable troughs clear of Kip.
    """
    u_plan = rrect(49.8, 37.3, 2.2) - rrect(25.2, 28.0, 1.6).translate((0.0, 7.65))
    base_u = Manifold.extrude(u_plan, 6.4)
    mid_plan = rrect(49.6, 37.1, 2.1) - rrect(25.4, 30.6, 1.6).translate((0.0, 6.45))
    mid_u = Manifold.extrude(mid_plan, 5.6).translate((0.0, 0.0, 6.0))
    m, conns, ex = tp.integrated_sockets(base_u + mid_u, size, lock)
    for sx in (-1, 1):
        trough = Manifold.cube((6.0, 32.0, 5.0)).translate((sx * 18.75 - 3.0, -14.0, 7.55))
        m = m - trough
    return m, conns, ex


def mom_flywheel_lid(size="small", grid=(4, 4), lock=True, **_):
    """Motion Shrouded Turbine Core Lid With Upper Spindle Journal (49.8 x 49.8 x 8.0 mm)."""
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
    """Motion 1-Piece Solid Ø42.0 x 12.0 mm PLA Inertial Rotor (fixed hub, S1 +32.3%)."""
    D, H = 42.0, 12.0
    R = D / 2
    body = Manifold.batch_hull([
        Manifold.cylinder(0.02, R - 0.8, R - 0.8, 112),
        Manifold.cylinder(H - 1.6, R, R, 112).translate((0.0, 0.0, 0.8)),
        Manifold.cylinder(0.02, R - 0.8, R - 0.8, 112).translate((0.0, 0.0, H - 0.02)),
    ]) - pro.bore_cutter("fixed", H)
    return body, [pro._hub_conn(H)], {}


def mom_ripcord_rack_150(**_):
    """Motion 150.0 mm Module-2.5 Toothed Rip-Cord Rack (150.0 x 12.0 x 6.2 mm)."""
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
    """Motion 78.0 mm Vertical Turbine & Helicopter Rotor Spindle Shaft (6.6 x 78.0 x 5.0 mm LAY_FLAT)."""
    m, conn = _cruciform_tip_shaft(78.0, conn_len=78.0, z0=0.0)
    return m, [conn], {"print_rotation_deg": pro.LAY_FLAT}


# ==========================================================================
# Verified Kit-Card Layouts (Cards A-D <= 170 mm, Cards E1-E3 & F <= 164 mm)
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
            ("tub_1", "kit_tilting_tub", 104.9, 3.0, 61.5, 49.8),
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
        "name": "Card E1 — Captive Pro Steering, Free-Hub Front Wheels, Steering Wheel & Enclosed Barrel Dump Hinge",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("fork_rake", "pro_fork_rake_adpt", 3.0, 3.0, 27.8, 24.8),
            ("z10_b", "gear_spur_z10", 35.8, 3.0, 30.0, 30.0),
            ("wheel_f50_1", "kit_wheel_giant_free", 70.8, 3.0, 50.0, 50.0),
            ("z10_a", "gear_spur_z10", 125.8, 3.0, 30.0, 30.0),
            ("steer_col", "pro_steer_column", 3.0, 32.8, 10.6, 46.6),
            ("link_b", "pro_tie_rod_link", 18.6, 32.8, 11.4, 26.9),
            ("tub_hinge", "pro_tub_hinge", 35.0, 38.0, 29.4, 19.5),
            ("knuckle_l", "pro_steer_knuckle_l", 125.8, 38.0, 25.6, 25.6),
            ("knuckle_r", "pro_steer_knuckle_r", 78.7, 58.0, 25.6, 25.6),
            ("cpin_4", "pro_captive_pin_28", 18.6, 64.7, 29.7, 9.6),
            ("steer_bridge", "pro_steer_bridge", 109.3, 68.6, 48.4, 31.8),
            ("wheel_f36_2", "kit_wheel_med_free", 37.7, 79.3, 36.0, 36.0),
            ("cpin_3", "pro_captive_pin_28", 3.0, 84.4, 9.6, 29.7),
            ("steer_rack", "pro_steer_rack", 17.6, 84.4, 15.1, 36.0),
            ("steer_wheel", "pro_steer_wheel", 78.7, 88.6, 23.0, 23.0),
            ("wheel_f50_2", "kit_wheel_giant_free", 106.7, 105.4, 50.0, 50.0),
            ("link_a", "pro_tie_rod_link", 78.7, 116.6, 11.4, 26.9),
            ("tub_pin", "shaft_tu03", 95.1, 116.6, 6.6, 37.5),
            ("cpin_2", "pro_captive_pin_28", 3.0, 119.1, 9.6, 29.7),
            ("wheel_f36_1", "kit_wheel_med_free", 37.7, 120.3, 36.0, 36.0),
            ("cpin_1", "pro_captive_pin_28", 17.6, 125.4, 9.6, 29.7),
        ],
    },
    "card_e2": {
        "name": "Card E2 — Motion Pull-Back Band Core (mirrored clutch) & Slam Launcher",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("band_tray", "mom_band_core_tray", 3.0, 3.0, 49.8, 49.8),
            ("band_lid", "mom_band_core_lid", 57.8, 3.0, 49.8, 61.5),
            ("pto_z10", "mom_pto_gear_z10", 112.6, 3.0, 30.0, 28.9),
            ("pto_shaft", "shaft_tu03", 147.6, 3.0, 6.6, 37.5),
            ("slam_base", "mom_slam_base", 3.0, 69.5, 62.3, 38.0),
            ("axle_z10", "gear_spur_z10", 70.3, 69.5, 30.0, 30.0),
            ("band_spool", "mom_band_spool_pawl", 123.3, 80.5, 20.3, 20.3),
            ("slam_plunger", "mom_slam_plunger", 3.0, 116.5, 94.0, 18.0),
            ("cpin_e2_1", "pro_captive_pin_28", 3.0, 139.5, 29.7, 9.6),
            ("cpin_e2_2", "pro_captive_pin_28", 37.7, 139.5, 29.7, 9.6),
        ],
    },
    "card_e3": {
        "name": "Card E3 — Motion Balloon Jet (O8 passages, individual inserts) & Shrouded Rip-Cord Turbine Core",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("ripcord", "mom_ripcord_rack_150", 3.0, 3.0, 150.0, 12.0),
            ("nozzles", "mom_nozzle_set", 44.0, 20.0, 63.0, 14.1),
            ("fw_tray", "mom_flywheel_tray", 3.0, 93.8, 49.8, 49.8),
            ("fw_lid", "mom_flywheel_lid", 57.8, 93.8, 49.8, 49.8),
            ("spindle", "mom_spindle_shaft", 3.0, 148.6, 78.0, 6.6),
            ("rotor_fw", "mom_flywheel_rotor", 112.6, 20.0, 42.0, 42.0),
            ("z10_c", "gear_spur_z10", 112.6, 67.0, 30.0, 28.9),
            ("jet_slide", "mom_jet_slide_valve", 147.6, 67.0, 9.6, 38.0),
            ("jet_valve", "mom_jet_valve_body", 131.6, 110.0, 27.8, 49.8),
        ],
    },
    "card_f": {
        "name": "Card F — Pro Powered Add-On (PETG): RC Drive, Low-CG Brain & Coaxial Servo Housings",
        "limit_mm": 164.0,
        "material": "PETG",
        "items": [
            ("drive_tray", "mech_drive_tray", 3.0, 3.0, 49.8, 49.8),
            ("drive_lid", "mech_drive_lid", 3.0, 57.8, 49.8, 49.8),
            ("servo_lid", "mech_servo_lid", 3.0, 113.0, 48.0, 12.4),
            ("bat_door", "mech_bat_door_screw", 3.0, 131.0, 33.6, 10.6),
            ("brain_tray", "mech_brain_tray", 57.8, 3.0, 49.8, 49.8),
            ("brain_lid", "mech_brain_lid", 57.8, 57.8, 49.8, 61.5),
            ("cpin_f_2", "pro_captive_pin_28", 57.8, 124.5, 29.7, 9.6),
            ("tub_pin_f", "shaft_tu03", 57.8, 139.5, 37.5, 6.6),
            ("servo_mount", "mech_servo_mount", 112.6, 3.0, 48.0, 19.0),
            ("n20_pinion", "mech_n20_pinion_z10", 112.6, 30.3, 30.0, 28.9),
            ("pilot_pin", "pro_pilot_pin", 147.6, 30.3, 9.6, 31.5),
            ("servo_pinion", "mech_servo_pinion_z10", 112.6, 66.8, 30.0, 28.9),
            ("cpin_f_1", "pro_captive_pin_28", 147.6, 66.8, 9.6, 29.7),
            ("sill_duct", "mech_sill_duct", 112.6, 101.5, 37.3, 49.8),
        ],
    },
    "card_g": {
        "name": "Card G — Construction: Road-Roller Drums, Wide-Track Axles & Dozer Axle",
        "limit_mm": 164.0,
        "material": "PLA/PETG",
        "items": [
            ("drum_1", "kit_drum_roller", 3.0, 3.0, 50.0, 50.0),
            ("drum_2", "kit_drum_roller", 58.0, 3.0, 50.0, 50.0),
            ("drum_3", "kit_drum_roller", 3.0, 58.0, 50.0, 50.0),
            ("drum_4", "kit_drum_roller", 58.0, 58.0, 50.0, 50.0),
            ("wide_axle_1", "kit_barbell_shaft_wide", 3.0, 113.0, 103.0, 6.6),
            ("wide_axle_2", "kit_barbell_shaft_wide", 3.0, 124.6, 103.0, 6.6),
            ("dozer_axle", "kit_barbell_shaft_9tu", 3.0, 136.2, 112.5, 6.6),
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
    """Sample interior anchor points >= 0.80..1.60 mm inside m_part's bed slice so sprue gates always fuse cleanly."""
    inset = m_part.slice(0.30).offset(-1.60, JoinType.Round)
    if inset.is_empty():
        inset = m_part.slice(0.30).offset(-0.80, JoinType.Round)
    if inset.is_empty():
        inset = m_part.slice(0.45).offset(-0.35, JoinType.Round)
    if inset.is_empty():
        inset = m_part.slice(0.45)
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
# Gate G1: 9-Craft 3D Boolean Pose-Sweep & Kip / Pro Powered Add-On Keep-Out Collision Audit
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
        # hair seats on the head's top studs: head z 53.5 + head top_studs 31.4 = 84.9 (matches toyventor_assembly.attach; was a stale 82.3)
        parts.append(_raw_geo(hair_id, cache).translate((0.0, -6.25, 84.9)))
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


PINION_Y = -37.5                                    # steering stem / pinion axis y (kit_keel_base steer_bore)
PINION_PITCH_R = pro.GEAR["module_mm"] * 10 / 2     # Z10 pitch radius, 12.5 mm


def _pinion_phase_deg(cache):
    """Pinion angle (deg, about its own axis) that meshes with the rack at straight ahead: the centre of the widest run of clear phases over
    one tooth pitch, so the +-RACK_STOP roll sweep stays inside the window instead of starting at its edge."""
    rack = _raw_geo("pro_steer_rack", cache).translate((0.0, RACK_Y, RACK_Z))
    gear = _raw_geo("gear_spur_z10", cache)
    steps, pitch = 144, 36.0
    clear = {s for s in range(steps) if (gear.rotate((0, 0, pitch * s / steps)).translate((0.0, PINION_Y, RACK_Z)) ^ rack).volume() < 0.05}
    if not clear:
        raise ValueError("no clear pinion phase against the rack at straight ahead")
    best_start, best_len = 0, 0
    for s in clear:
        if (s - 1) % steps in clear:
            continue                                  # not the start of a run
        n = 1
        while (s + n) % steps in clear and n < steps:
            n += 1
        if n > best_len:
            best_start, best_len = s, n
    return pitch * (best_start + (best_len - 1) / 2) / steps


def _steer_linkage_solids(cache, dx, phase0):
    """(name, solid) for everything the captive Stage-2 rack-steering linkage moves or holds, posed with the rack `dx` mm toward +X:
    bridge, rack, Z10 pinion + pro_steer_column + Ø23 mm pro_steer_wheel, both captive kingpins, knuckles, tie-rod links and captive tie-rod pins."""
    g = lambda pid: _raw_geo(pid, cache)
    rot_col = phase0 + math.degrees(dx / PINION_PITCH_R)
    pinion = g("gear_spur_z10").rotate((0, 0, rot_col)).translate((0.0, PINION_Y, RACK_Z))
    col = g("pro_steer_column").rotate((0, 0, rot_col)).translate((0.0, PINION_Y, -2.025))
    wheel = g("pro_steer_wheel").rotate((0, 0, rot_col)).translate((0.0, PINION_Y, RACK_Z + RACK_T + 0.20))
    out = [
        ("bridge", g("pro_steer_bridge").translate((0.0, BRIDGE_Y, BRIDGE_Z))),
        ("rack", g("pro_steer_rack").translate((dx, RACK_Y, RACK_Z))),
        ("steer_col", col),
        ("pinion", pinion),
        ("steer_wheel", wheel),
    ]
    angles = _tierod_angles(dx)
    for side, tag, ang in ((-1, "l", angles[0]), (1, "r", angles[1])):
        kn = (g(f"pro_steer_knuckle_{tag}").translate((side * 6.25, 0.0, -6.25 + KNUCKLE_FACE_RELIEF)).rotate((-90, 0, 0))
              .rotate((0, 0, -90 * side)).rotate((0, 0, ang)).translate((side * STEER_KP_X, STEER_KP_Y, 6.25)))
        p_rack, p_arm = _tierod_pivots(side, dx)
        yaw = math.degrees(math.atan2(p_arm[1] - p_rack[1], p_arm[0] - p_rack[0]))
        out += [
            (f"kn_{tag}", kn),
            # Self-retaining kingpin from below: head flush under knuckle (-3.80), snap-barbs locked in bridge counterbore (> 21.50)
            (f"kp_{tag}", g("pro_captive_pin_28").translate((side * STEER_KP_X, STEER_KP_Y, -5.325))),
            (f"link_{tag}", g("pro_tie_rod_link").rotate((0, 0, yaw)).translate((p_rack[0], p_rack[1], LINK_Z))),
            # Self-retaining tie-rod pin from above: head over link plate (35.65), snap-barbs locked in knuckle pocket (< 10.40)
            (f"tpin_{tag}", g("pro_captive_pin_28").rotate((180, 0, 0)).rotate((0, 0, 90.0 + ang)).translate((p_arm[0], p_arm[1], 37.20))),
        ]
    return out


def _gear_phase_x(gear_raw, axle_gear, y_c, z_c, x_pos=0.0):
    """Find a clear tooth phase (deg around X) for an X-axis Z10 pinion at (x_pos, y_c, z_c) meshing with axle_gear."""
    for s in range(72):
        ang = 36.0 * s / 72.0
        cand = gear_raw.rotate((0, 0, ang)).rotate((0, 90, 0)).translate((x_pos, y_c, z_c))
        if (cand ^ axle_gear).volume() < 0.05:
            return ang
    return 0.0


def _pneumatic_jet_check(cache):
    """3D boolean fluid-domain topology check for D3 (mom_jet_valve_body + mom_jet_slide_valve + mom_nozzle_set):
    1. OPEN (+7.0 mm spool pull): top balloon inlet connects continuously to rear nozzle exit;
    2. CLOSED (0.0 mm spool push): 3.5-deg tapered teardrop spool severs inlet-to-exhaust air connectivity completely;
    3. Bottom socket_small holes remain 100% isolated from the air passage in both poses.
    """
    vb = _raw_geo("mom_jet_valve_body", cache)
    sv = _raw_geo("mom_jet_slide_valve", cache)
    ns = _raw_geo("mom_nozzle_set", cache)
    # Seat the Ø4.5 mm insert (sprue xc = -12.0, snapped off its tabs: window = its R6.0 flange) coaxially into the rear
    # 4-deg Luer socket (y = 8.5..14.7, z = 12.50), tip toward -Y reaching y ~= 9.0:
    ins45 = ns ^ Manifold.cube((11.9, 16.0, 10.0)).translate((-12.0 - 5.95, -8.0, 0.0))
    noz_seated = ins45.rotate((90, 0, 0)).translate((12.0, 17.2, 12.50))
    # Seating assertion (2026-11-02): the insert must actually enter the socket with ~0 overlap.
    _seat_fail = []
    _ibb = noz_seated.bounding_box()
    _v_seat = (noz_seated ^ vb).volume()
    if _ibb[1] > 10.0:
        _seat_fail.append(("jet_seat", "insert_tip_outside_socket", f"tip y={_ibb[1]:.2f} > 10.0"))
    if _v_seat > 0.5:
        _seat_fail.append(("jet_seat", "insert_overlap", f"{_v_seat:.2f} mm3 > 0.5"))
    # Spool oriented along -X from +X side with 50-deg teardrop apex along +Z_world: p_world = (-z_sv, -x_sv, +y_sv) + (x0, -3.0, 12.50)
    spool_base = sv.rotate((0, -90, 0)).rotate((90, 0, 0))
    spool_closed = spool_base.translate((14.50, -3.0, 12.50))
    spool_open = spool_base.translate((21.50, -3.0, 12.50))
    # Enclosed internal fluid domain strictly inside collar, turret walls, seated nozzle plug, and bottom socket holes:
    inlet_fluid = Manifold.cylinder(15.0, 7.0, 7.0, 48).translate((0.0, -3.0, 12.0))
    chamber_fluid = Manifold.cube((14.0, 20.0, 11.0)).translate((-7.0, -9.0, 7.5))
    nozzle_fluid = Manifold.cylinder(9.0, 3.1, 3.1, 48).rotate((-90, 0, 0)).translate((0.0, 10.0, 12.50))
    sock_cyls = [Manifold.cylinder(4.2, 3.2, 3.2, 32).translate((sx, sy, 0.5)) for sx in (-18.75, -6.25, 6.25, 18.75) for sy in (-6.25, 6.25)]
    fluid_box = Manifold.batch_boolean([inlet_fluid, chamber_fluid, nozzle_fluid, *sock_cyls], OpType.Add)
    pt_inlet = np.array([[0.0, -3.0, 24.5]])
    pt_exhaust = np.array([[0.0, 17.5, 12.5]])
    pts_sockets = np.array([[sx, sy, 2.0] for sx in (-18.75, -6.25, 6.25, 18.75) for sy in (-6.25, 6.25)])

    issues = list(_seat_fail)
    for mode, spool in (("OPEN", spool_open), ("CLOSED", spool_closed)):
        air = fluid_box - (vb + noz_seated + spool)
        tm_air = tp.to_trimesh(air)
        comps = [c for c in tm_air.split(only_watertight=False) if c.is_watertight and c.volume > 0.5]
        inlet_idx = next((i for i, c in enumerate(comps) if c.contains(pt_inlet)[0]), None)
        exh_idx = next((i for i, c in enumerate(comps) if c.contains(pt_exhaust)[0]), None)
        if inlet_idx is None or exh_idx is None:
            issues.append(("jet_" + mode, "missing_air_cavity", f"inlet={inlet_idx}, exhaust={exh_idx}"))
            continue
        if mode == "OPEN" and inlet_idx != exh_idx:
            issues.append(("jet_OPEN", "blocked_flow", "inlet and exhaust are disconnected in OPEN pose"))
        if mode == "CLOSED" and inlet_idx == exh_idx:
            issues.append(("jet_CLOSED", "leak_path", "inlet and exhaust remain connected in CLOSED pose"))
        if any(comps[inlet_idx].contains(pts_sockets)) or any(comps[exh_idx].contains(pts_sockets)):
            issues.append(("jet_" + mode, "socket_leak", "air passage connects to bottom socket_small holes"))
    return issues


def verify_gate_g1():
    """Run deterministic 3D boolean overlap, capture, retention, pneumatic seal, and COTS keep-out checks across
    all 9 canonical craft, the road roller, G1-Steer, G1-Motion, and G1-AddOn.
    """
    cache = {}
    keel = _raw_geo("kit_keel_base", cache)
    spine = _raw_geo("kit_clevis_spine", cache)
    w_med = _raw_geo("kit_wheel_med", cache)
    w_gnt = _raw_geo("kit_wheel_giant", cache)
    w_med_f = _raw_geo("kit_wheel_med_free", cache)         # steered front wheels turn on the knuckle's round barbed stub
    w_gnt_f = _raw_geo("kit_wheel_giant_free", cache)
    wedge = _raw_geo("kit_aero_wedge", cache)
    wind = _raw_geo("kit_windscreen", cache)
    tub = _raw_geo("kit_tilting_tub", cache)
    turn = _raw_geo("kit_turntable", cache)
    rotor = _raw_geo("kit_rotor_blade", cache)
    skid = _raw_geo("kit_skid_runner", cache)
    kip = _kip_seated_ghost(cache)
    kip_mohawk = _kip_seated_ghost(cache, "hair_mohawk")

    def outboard_wheels(wheel_m, y_c):
        wl = wheel_m.rotate((0, 90, 0)).translate((-39.0, y_c, 6.25))
        wr = wheel_m.rotate((0, 90, 0)).translate((26.7, y_c, 6.25))
        return [("wl_" + str(y_c), wl), ("wr_" + str(y_c), wr)]

    results = {}

    # 1. Formula / GT Race Car + captive Stage-2 Pro rack-steering linkage swept across 9 rack steps in [-RACK_STOP, +RACK_STOP]:
    phase0 = _pinion_phase_deg(cache)
    res1 = []
    for dx in np.linspace(-RACK_STOP, RACK_STOP, 9):
        dx = float(dx)
        a_l, a_r = _tierod_angles(dx)
        w_st_l = w_med_f.rotate((0, -90, 0)).translate((-8.85, 0.0, 0.0)).rotate((0, 0, a_l)).translate((-STEER_KP_X, STEER_KP_Y, 6.25))
        w_st_r = w_med_f.rotate((0, 90, 0)).translate((8.85, 0.0, 0.0)).rotate((0, 0, a_r)).translate((STEER_KP_X, STEER_KP_Y, 6.25))
        res1 += _check_non_overlapping([
            ("keel", keel), *_steer_linkage_solids(cache, dx, phase0),
            ("windscreen", wind.translate((0.0, -6.25, 12.5))), ("kip", kip),
            (f"w_front_l_{a_l:+.1f}deg", w_st_l), (f"w_front_r_{a_r:+.1f}deg", w_st_r), *outboard_wheels(w_med, 43.75),
        ])
    results["1_race_car_steer_mech"] = res1

    # 1b. Rack travel stop + 3-point +Z rack capture (link_l, link_r, Ø23 mm steer_wheel skirt) + +-0.55 mm bi-directional pin lock proof:
    stop_fail = []
    for sgn in (1.0, -1.0):
        at_stop = dict(_steer_linkage_solids(cache, sgn * RACK_STOP, phase0))
        beyond = dict(_steer_linkage_solids(cache, sgn * (RACK_STOP + 0.5), phase0))
        for tag in ("link_l", "link_r"):
            gap = at_stop[tag].min_gap(at_stop["bridge"], 1.0)
            if gap < 0.15:
                stop_fail.append((tag, f"gap {gap:.3f} mm at {sgn * RACK_STOP:+.1f}", "< 0.15"))
        hit = max((beyond[t] ^ beyond["bridge"]).volume() for t in ("link_l", "link_r"))
        if hit < 0.5:
            stop_fail.append(("link", "bridge", f"no stop contact at {sgn * (RACK_STOP + 0.5):+.1f} mm ({hit:.2f} mm3)"))
    for dx_cap in (-RACK_STOP, 0.0, RACK_STOP):
        st_cap = dict(_steer_linkage_solids(cache, dx_cap, phase0))
        rack_lifted = st_cap["rack"].translate((0.0, 0.0, 0.50))
        for keeper in ("link_l", "link_r", "steer_wheel"):
            v_cap = (rack_lifted ^ st_cap[keeper]).volume()
            if v_cap < 0.05:
                stop_fail.append(("rack_+0.5z", keeper, f"untrapped at dx={dx_cap:+.1f} ({v_cap:.4f} mm3)"))
    st0 = dict(_steer_linkage_solids(cache, 0.0, phase0))
    pin_checks = [
        ("kp_l", ("kn_l", "bridge")),
        ("kp_r", ("kn_r", "bridge")),
        ("tpin_l", ("link_l", "kn_l")),
        ("tpin_r", ("link_r", "kn_r")),
        ("steer_col", ("keel", "steer_wheel")),
    ]
    st0["keel"] = keel
    for pname, partners in pin_checks:
        for dz in (0.55, -0.55):
            shifted = st0[pname].translate((0.0, 0.0, dz))
            v_lock = sum((shifted ^ st0[pt]).volume() for pt in partners)
            if v_lock < 0.05:
                stop_fail.append((pname, f"dz={dz:+.2f}", f"unretained ({v_lock:.4f} mm3)"))
    # The steered front wheels are held on the knuckle's barbed stub (free-hub snap): free over the stub's design play, stopped inboard by the knuckle riser,
    # held outboard by the barb (it overlaps the wheel's O7.0 bore by 0.15 mm, so the wheel only leaves by flexing the slotted tip). Both wheel sizes.
    for tag, w_free in (("O36", w_med_f), ("O50", w_gnt_f)):
        def _wheel_ov(shift, w_free=w_free):
            wl = w_free.rotate((0, -90, 0)).translate((-8.85 - shift, 0.0, 0.0)).translate((-STEER_KP_X, STEER_KP_Y, 6.25))
            return (wl ^ st0["kn_l"]).volume()
        free_ov = max(_wheel_ov(0.0), _wheel_ov(0.2))
        if free_ov > 0.05:
            stop_fail.append((f"front_wheel_{tag}", "seated", f"not free on the stub ({free_ov:.3f} mm3 at 0..0.2 mm outward)"))
        if _wheel_ov(1.0) < 0.5:
            stop_fail.append((f"front_wheel_{tag}", "outward +1.0 mm", "not held by the barb"))
        if _wheel_ov(-0.3) < 1.0:
            stop_fail.append((f"front_wheel_{tag}", "inward -0.3 mm", "not stopped by the knuckle riser"))
    results["1b_rack_travel_stop"] = stop_fail

    # 2. Dump / Tow Truck: zero-strain stowed + 55-deg dump tip on BOTH (#1 + pro_tub_hinge) AND (3-TU Core + Lid), pinned by shaft_tu03:
    tub_hinge = _raw_geo("pro_tub_hinge", cache).translate((0.0, 62.40, 4.50))
    tub_pin_s2 = _raw_geo("shaft_tu03", cache).rotate((0, 90, 0)).translate((-18.75, 37.5 + TUB_TRUNNION_Y, 12.5 + TUB_TRUNNION_Z))
    tub_stowed_s2 = tub.translate((0.0, 37.5, 12.5))
    tub_55_s2 = tub.translate((0.0, -TUB_TRUNNION_Y, -TUB_TRUNNION_Z)).rotate((-55.0, 0.0, 0.0)).translate((0.0, 37.5 + TUB_TRUNNION_Y, 12.5 + TUB_TRUNNION_Z))
    core_tray = _raw_geo("mom_band_core_tray", cache).translate((0.0, 37.5, 12.5))
    core_lid = _raw_geo("mom_band_core_lid", cache).translate((0.0, 37.5, 44.8))
    tub_pin_s3 = _raw_geo("shaft_tu03", cache).rotate((0, 90, 0)).translate((-18.75, 37.5 + TUB_TRUNNION_Y, 50.0 + TUB_TRUNNION_Z))
    tub_stowed_s3 = tub.translate((0.0, 37.5, 50.0))
    tub_55_s3 = tub.translate((0.0, -TUB_TRUNNION_Y, -TUB_TRUNNION_Z)).rotate((-55.0, 0.0, 0.0)).translate((0.0, 37.5 + TUB_TRUNNION_Y, 50.0 + TUB_TRUNNION_Z))
    results["2_dump_truck_stowed_and_55deg"] = (
        _check_non_overlapping([("keel", keel), ("hinge", tub_hinge), ("tub_pin", tub_pin_s2), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub_0", tub_stowed_s2)])
        + _check_non_overlapping([("keel", keel), ("hinge", tub_hinge), ("tub_pin", tub_pin_s2), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub_55_s2", tub_55_s2)])
        + _check_non_overlapping([("keel", keel), ("core_tray", core_tray), ("core_lid", core_lid), ("tub_pin", tub_pin_s3), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub_0_s3", tub_stowed_s3)])
        + _check_non_overlapping([("keel", keel), ("core_tray", core_tray), ("core_lid", core_lid), ("tub_pin", tub_pin_s3), ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip), ("tub_55_s3", tub_55_s3)])
    )

    # 2b. Tip sweep (stages 2 and 3): the first barrel-hinge build passed tip 0 and 55 yet overlapped 7.84 mm3 on the keel and 15.7 mm3 on a lid at 1..17 deg.
    def _tub_tipped(base_z, tip_deg):
        return tub.translate((0.0, -TUB_TRUNNION_Y, -TUB_TRUNNION_Z)).rotate((-tip_deg, 0.0, 0.0)).translate((0.0, 37.5 + TUB_TRUNNION_Y, base_z + TUB_TRUNNION_Z))
    wind_w = wind.translate((0.0, -6.25, 12.5))
    tip_bad = []
    for tip in range(1, 25):
        t2 = _tub_tipped(12.5, float(tip))
        t3 = _tub_tipped(50.0, float(tip))
        tip_bad += _check_non_overlapping([("keel", keel), ("hinge", tub_hinge), ("tub_pin", tub_pin_s2), ("wind", wind_w), (f"tub_s2_{tip}deg", t2)])
        tip_bad += _check_non_overlapping([("keel", keel), ("core_tray", core_tray), ("core_lid", core_lid), ("tub_pin", tub_pin_s3), (f"tub_s3_{tip}deg", t3)])
    results["2b_dump_truck_tip_sweep"] = tip_bad

    # 3. Farm / Loader Tractor: Giant Ø50 rear + Pro ±25 deg steered Ø50 front lock check:
    dx21 = _dx_for_inner(GIANT_LOCK_DEG)
    res3 = []
    for sgn in (1.0, 0.0, -1.0):
        a_l, a_r = _tierod_angles(sgn * dx21)
        w50_l = w_gnt_f.rotate((0, -90, 0)).translate((-8.85, 0.0, 0.0)).rotate((0, 0, a_l)).translate((-STEER_KP_X, STEER_KP_Y, 6.25))
        w50_r = w_gnt_f.rotate((0, 90, 0)).translate((15.0 - 6.15, 0.0, 0.0)).rotate((0, 0, a_r)).translate((STEER_KP_X, STEER_KP_Y, 6.25))
        res3 += _check_non_overlapping([
            ("keel", keel), *_steer_linkage_solids(cache, sgn * dx21, phase0),
            ("wind", wind.translate((0.0, -6.25, 12.5))), ("kip", kip),
            (f"w50_fl_{a_l:+.1f}deg", w50_l), (f"w50_fr_{a_r:+.1f}deg", w50_r), *outboard_wheels(w_gnt, 43.75),
        ])
    results["3_tractor_giant_steer"] = res3

    # 3b. G1-Motion: Band Core internal mechanism + Bumper + Slam Launcher + Hinged Bellows + Shrouded Flywheel + 3D Jet Valve seal:
    axle_z10 = _raw_geo("gear_spur_z10", cache).rotate((0, 90, 0)).translate((-3.125, 43.75, 6.25))
    pto_raw = _raw_geo("mom_pto_gear_z10", cache)
    ph_pto = _gear_phase_x(pto_raw, axle_z10, 43.75, 31.25, x_pos=-3.125)
    pto_placed = pto_raw.rotate((0, 0, ph_pto)).rotate((0, 90, 0)).translate((-3.125, 43.75, 31.25))
    spool_raw = _raw_geo("mom_band_spool_pawl", cache)
    spool_placed = None
    for s_ang in np.linspace(0.0, 45.0, 36):
        cand_sp = spool_raw.rotate((0, 0, float(s_ang))).rotate((0, 90, 0)).translate((3.85, 43.75, 31.25))
        if (cand_sp ^ pto_placed).volume() < 0.05:
            spool_placed = cand_sp
            break
    if spool_placed is None:
        spool_placed = spool_raw.rotate((0, 90, 0)).translate((3.85, 43.75, 31.25))
    pto_shaft = _raw_geo("shaft_tu03", cache).rotate((0, 0, ph_pto)).rotate((0, 90, 0)).translate((-15.20, 43.75, 31.25))
    res_mom = _check_non_overlapping([
        ("keel", keel), ("band_tray", core_tray), ("band_lid", core_lid),
        ("pto_shaft", pto_shaft), ("pto_gear", pto_placed), ("spool", spool_placed),
        ("axle_z10", axle_z10),
        *outboard_wheels(w_med, -56.25), *outboard_wheels(w_gnt, 43.75),
    ])
    # 3c. Band clutch direction + closed-saddle shaft capture (2026-11-02, pull-back-only Option B):
    # Mirrored clutch must lock when spool lags gear (relative rotation < 0) and overrun when > 0:
    # overlap growth under a -3 deg spool step must dominate the +3 deg step.
    clutch_fail = []
    if spool_placed is not None:
        def _about_shaft(solid, deg):
            return solid.translate((0.0, -43.75, -31.25)).rotate((deg, 0.0, 0.0)).translate((0.0, 43.75, 31.25))
        v_lock = (_about_shaft(spool_placed, -10.0) ^ pto_placed).volume()
        v_over = (_about_shaft(spool_placed, 10.0) ^ pto_placed).volume()
        if not (v_lock > 0.5 and v_lock > 2.0 * max(v_over, 0.01)):
            clutch_fail.append(("clutch_direction", f"lock {v_lock:.2f} vs overrun {v_over:.2f} mm3", "lock must dominate"))
        # Closed saddle bores: at every shaft angle, a +1.2 mm lift (past the 1.0 mm flat-up bore
        # clearance, at the lid-dome catch) must hit tray material -- the shaft can never escape.
        for k in range(12):
            spun = _about_shaft(pto_shaft, 30.0 * k)
            v_lift = (spun.translate((0.0, 0.0, 1.2)) ^ core_tray).volume()
            if v_lift < 0.05:
                clutch_fail.append(("shaft_capture", f"angle {30 * k} deg", f"lift uncaught ({v_lift:.3f} mm3)"))
    results["3c_band_clutch_and_shaft_capture"] = clutch_fail
    # Slam launcher 0..35 mm captive stroke check:
    slam_b = _raw_geo("mom_slam_base", cache)
    slam_pin = _raw_geo("pro_captive_pin_28", cache).rotate((-90, 0, 0)).translate((0.0, -20.525, 9.375))
    slam_pl_upright = _raw_geo("mom_slam_plunger", cache).rotate((0, 90, 0)).translate((-74.5, 0.0, 9.375))
    for s_dx in (0.0, 17.5, 35.0):
        res_mom += _check_non_overlapping([("slam_base", slam_b), ("slam_pin", slam_pin), (f"plunger_{s_dx}", slam_pl_upright.translate((s_dx, 0.0, 0.0)))])
    # (Bellows lift check removed 2026-11-02: bellows dropped from the decided ladder and Card E3.)
    # Shrouded flywheel turbine + ripcord check:
    fw_tray = _raw_geo("mom_flywheel_tray", cache)
    fw_lid = _raw_geo("mom_flywheel_lid", cache).translate((0.0, 0.0, 32.3))
    fw_spindle = _raw_geo("mom_spindle_shaft", cache).translate((0.0, 0.0, 5.2))
    fw_rotor = _raw_geo("mom_flywheel_rotor", cache).translate((0.0, 0.0, 11.0))
    fw_rack_raw = _raw_geo("mom_ripcord_rack_150", cache).translate((0.0, -18.75, 23.25))
    fw_z10 = _raw_geo("gear_spur_z10", cache).translate((0.0, 0.0, 23.25))
    for s_ph in range(72):
        ang_fw = 36.0 * s_ph / 72.0
        cand_fw = _raw_geo("gear_spur_z10", cache).rotate((0, 0, ang_fw)).translate((0.0, 0.0, 23.25))
        if (cand_fw ^ fw_rack_raw).volume() < 0.05:
            fw_z10 = cand_fw
            fw_spindle = _raw_geo("mom_spindle_shaft", cache).rotate((0, 0, ang_fw)).translate((0.0, 0.0, 5.2))
            fw_rotor = _raw_geo("mom_flywheel_rotor", cache).rotate((0, 0, ang_fw)).translate((0.0, 0.0, 11.0))
            break
    res_mom += _check_non_overlapping([
        ("fw_tray", fw_tray), ("fw_lid", fw_lid), ("fw_spindle", fw_spindle),
        ("fw_rotor", fw_rotor), ("fw_z10", fw_z10), ("fw_ripcord", fw_rack_raw),
    ])
    res_mom += _pneumatic_jet_check(cache)
    results["3b_motion_packs_and_jet_seal"] = res_mom

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

    # 9. Space Shuttle Orbiter + Pro Powered Add-On Printable RC Dump Truck (Card F + COTS N20/SG90/LiPo/XIAO + 55-deg dump tip):
    res9 = _check_non_overlapping([
        ("keel", keel), ("wedge", wedge.translate((0.0, -43.75, 12.5))), ("kip", kip),
    ])
    drv_tray = _raw_geo("mech_drive_tray", cache).translate((0.0, 37.5, 12.5))
    drv_lid = _raw_geo("mech_drive_lid", cache).translate((0.0, 37.5, 44.8))
    brn_tray = _raw_geo("mech_brain_tray", cache).translate((0.0, 37.5, 50.0))
    brn_lid = _raw_geo("mech_brain_lid", cache).translate((0.0, 37.5, 69.8))
    bat_door = _raw_geo("mech_bat_door_screw", cache).rotate((90, 0, 0)).translate((0.0, 62.45 + 4.20, 60.8))
    sill = _raw_geo("mech_sill_duct", cache).translate((0.0, -6.25, 12.5))
    srv_mount = _raw_geo("mech_servo_mount", cache).translate((0.0, -37.5, 12.5))
    srv_lid = _raw_geo("mech_servo_lid", cache).translate((0.0, -31.25, 45.3))
    srv_cpin_l = _raw_geo("pro_captive_pin_28", cache).translate((-18.75, -31.25, 22.425))
    srv_cpin_r = _raw_geo("pro_captive_pin_28", cache).translate((18.75, -31.25, 22.425))
    pilot_pin = _raw_geo("pro_pilot_pin", cache).translate((0.0, PINION_Y, -1.525))
    n20_pin_raw = _raw_geo("mech_n20_pinion_z10", cache)
    ph_n20 = _gear_phase_x(n20_pin_raw, axle_z10, 43.75, 31.25, x_pos=-3.125)
    n20_pin = n20_pin_raw.rotate((0, 0, ph_n20)).rotate((0, 90, 0)).translate((-3.125, 43.75, 31.25))
    # COTS datasheet solids in assembly frame:
    ghost_n20 = (
        Manifold.cube((24.0, 12.0, 10.0)).translate((-23.50, 43.75 - 6.0, 31.25 - 5.0))
        + (Manifold.cylinder(10.0, 1.50, 1.50, 48) ^ Manifold.cube((4.0, 3.0, 10.2)).translate((-2.0, -2.0, -0.1)))
        .rotate((0, 0, ph_n20)).rotate((0, 90, 0)).translate((0.50, 43.75, 31.25))
    )
    ghost_sg90 = (
        Manifold.cube((12.2, 22.5, 19.5)).translate((-6.1, -37.5 - 16.60, 38.5))
        + Manifold.cube((12.2, 32.2, 2.5)).translate((-6.1, -37.5 - 21.45, 42.8))
    )
    ghost_lipo = Manifold.cube((25.0, 35.0, 6.2)).translate((-12.5, 37.5 - 14.5, 55.5))
    ghost_pcb = Manifold.extrude(rrect(38.0, 38.0, 7.5), 1.6).translate((0.0, 37.5, 62.8))
    ghost_xiao = Manifold.cube((21.0, 17.8, 4.5)).translate((-10.5, 37.5 - 10.0, 64.5))
    tub_pin_s4 = _raw_geo("shaft_tu03", cache).rotate((0, 90, 0)).translate((-18.75, 37.5 + TUB_TRUNNION_Y, 75.0 + TUB_TRUNNION_Z))
    tub_stowed_s4 = tub.translate((0.0, 37.5, 75.0))
    tub_55_s4 = tub.translate((0.0, -TUB_TRUNNION_Y, -TUB_TRUNNION_Z)).rotate((-55.0, 0.0, 0.0)).translate((0.0, 37.5 + TUB_TRUNNION_Y, 75.0 + TUB_TRUNNION_Z))

    for sgn in (-1.0, 0.0, 1.0):
        dx_rc = sgn * dx21
        rot_srv = phase0 + math.degrees(dx_rc / PINION_PITCH_R)
        srv_pin = _raw_geo("mech_servo_pinion_z10", cache).rotate((0, 0, rot_srv)).translate((0.0, PINION_Y, RACK_Z))
        ghost_horn = Manifold.extrude(rrect(19.4, 4.6, 1.8) + rrect(4.6, 19.4, 1.8), 1.8).rotate((0, 0, rot_srv)).translate((0.0, PINION_Y, RACK_Z + 6.50))
        base_steer = [it for it in _steer_linkage_solids(cache, dx_rc, phase0) if it[0] not in ("steer_col", "pinion", "steer_wheel")]
        a_l, a_r = _tierod_angles(dx_rc)
        w50_l = w_gnt_f.rotate((0, -90, 0)).translate((-8.85, 0.0, 0.0)).rotate((0, 0, a_l)).translate((-STEER_KP_X, STEER_KP_Y, 6.25))
        w50_r = w_gnt_f.rotate((0, 90, 0)).translate((21.15 - 12.30, 0.0, 0.0)).rotate((0, 0, a_r)).translate((STEER_KP_X, STEER_KP_Y, 6.25))
        res9 += _check_non_overlapping([
            ("keel", keel), *base_steer,
            ("pilot_pin", pilot_pin), ("srv_pinion", srv_pin), ("ghost_horn", ghost_horn),
            ("srv_mount", srv_mount), ("srv_lid", srv_lid), ("srv_cpin_l", srv_cpin_l), ("srv_cpin_r", srv_cpin_r), ("ghost_sg90", ghost_sg90),
            ("sill", sill), ("kip", kip),
            ("drv_tray", drv_tray), ("ghost_n20", ghost_n20), ("n20_pinion", n20_pin), ("axle_z10", axle_z10), ("drv_lid", drv_lid),
            ("brn_tray", brn_tray), ("ghost_lipo", ghost_lipo), ("ghost_pcb", ghost_pcb), ("ghost_xiao", ghost_xiao), ("bat_door", bat_door), ("brn_lid", brn_lid),
            ("tub_pin_s4", tub_pin_s4),
            ("tub_0_s4" if sgn == 0.0 else "tub_55_s4", tub_stowed_s4 if sgn == 0.0 else tub_55_s4),
            (f"w50_fl_{sgn}", w50_l), (f"w50_fr_{sgn}", w50_r), *outboard_wheels(w_gnt, 43.75),
        ])
    # Also verify Ø23 mm servo pinion flange traps rack +0.50 mm in +Z and pilot_pin locks +-0.55 mm in Z:
    srv_pin0 = _raw_geo("mech_servo_pinion_z10", cache).rotate((0, 0, phase0)).translate((0.0, PINION_Y, RACK_Z))
    if (_raw_geo("pro_steer_rack", cache).translate((0.0, RACK_Y, RACK_Z + 0.50)) ^ srv_pin0).volume() < 0.05:
        res9.append(("rack_+0.5z", "mech_servo_pinion_z10", "untrapped"))
    for dz_p in (0.55, -0.55):
        if (pilot_pin.translate((0.0, 0.0, dz_p)) ^ keel).volume() < 0.05:
            res9.append(("pro_pilot_pin", f"dz={dz_p:+.2f}", "unretained on keel"))
    results["9_shuttle_and_mech_keepouts"] = res9

    # 10. Road roller (construction line, 2026-11-03): four smooth 2 TU drums, fixed to two 103 mm wide-track axles at rows 0 and 8, no rack steering.
    # Placement is the mirrored pair the viewer's wheels use: each drum's closed 4.0 mm floor (part z = 0) faces the keel, its dish opens outward.
    # The keel is NOT the same width at both axles. Row 8 is the full 49.8 mm hull: the drums sit 1.8 mm clear each side and that holds the axle
    # sideways. Row 0 is the 24.8 mm nose (half width 12.4): the drums sit 26.7 - 12.4 = 14.3 mm clear, so the axle floats +-14.3 mm until a
    # drum meets the nose; the unsteered 78 mm barbell front axle of the existing trucks has the same float. This check proves the float is
    # free over that whole travel and that the keel is what stops it (a dish turned toward the keel also stops at about 14.8 mm: orientation
    # is a looks choice, not what holds the axle).
    # Each wide axle must also end flush with its drums' outer faces (49.8 + 2 x (24.8 + 1.8) = 103.0 at the rear).
    drum = _raw_geo("kit_drum_roller", cache)
    wide = _raw_geo("kit_barbell_shaft_wide", cache)
    res10 = []
    cockpit = [("windscreen", wind.translate((0.0, -6.25, 12.5))), ("kip", kip)]
    for role, y_c, float_mm in (("rear", 43.75, 1.8), ("front", -56.25, 14.3)):
        dl = drum.rotate((0, -90, 0)).translate((-26.7, y_c, 6.25))
        dr = drum.rotate((0, 90, 0)).translate((26.7, y_c, 6.25))
        sh = wide.rotate((0, 90, 0)).translate((-51.5, y_c, 6.25))
        sx = (sh.bounding_box()[0], sh.bounding_box()[3])
        dx = (dl.bounding_box()[0], dr.bounding_box()[3])
        if abs(sx[0] - dx[0]) > 0.01 or abs(sx[1] - dx[1]) > 0.01:
            res10.append((f"{role}_wide_axle", "drums", f"shaft ends {sx[0]:.2f}..{sx[1]:.2f} are not flush with the drum faces {dx[0]:.2f}..{dx[1]:.2f}"))
        def float_set(shift):
            return [("keel", keel), *cockpit, (f"{role}_drum_l", dl.translate((shift, 0.0, 0.0))), (f"{role}_drum_r", dr.translate((shift, 0.0, 0.0))),
                    (f"{role}_shaft", sh.translate((shift, 0.0, 0.0)))]
        # free over the whole float (0.1 mm short of contact each way) ...
        for shift in (-(float_mm - 0.1), 0.0, float_mm - 0.1):
            res10 += [(f"{role}_float_{shift:+.1f}", b, v) for _, b, v in _check_non_overlapping(float_set(shift))]
        # ... and stopped just past it: the keel must be what ends the float, or the axle is not held sideways at all
        for shift in (-(float_mm + 0.5), float_mm + 0.5):
            hit = [p for p in _check_non_overlapping(float_set(shift)) if "drum" in p[0] + p[1] and "keel" in p[0] + p[1]]
            if not hit:
                res10.append((f"{role}_float_{shift:+.1f}", "keel", f"no contact at {shift:+.1f} mm: the {role} axle is not held sideways by the keel"))
    # both axles together: front drums against rear drums
    res10 += _check_non_overlapping([(f"{r}_{t}", drum.rotate((0, 90 if t == "r" else -90, 0)).translate((x, y, 6.25))) for r, y in (("front", -56.25), ("rear", 43.75)) for t, x in (("l", -26.7), ("r", 26.7))])
    results["10_road_roller"] = res10

    # 11. Dozer axle (construction line, 2026-11-03): the 112.5 mm (9 TU) rear axle carries a medium wheel, a 1.0 mm gap and a kit beam (the lift arm) on each
    # side. The roller's 103.0 mm axle would leave the beam touching the wheel face (39.0 + 12.5 = 51.5). Each arm is one beam_str_tu10 pivoting on the axle through
    # its first bore; across the lift range from the blade-on-ground pose to +25 deg it must keep 1.0 mm to every wheel, clear the keel and both axles, and not touch
    # the shaft, and the shaft must stand 3 mm or more beyond the beam for a retainer. (The crossbar and blades are not designed, so they are not in this craft.)
    axle9 = _raw_geo("kit_barbell_shaft_9tu", cache)
    beam11 = _raw_geo("beam_str_tu10", cache).transform([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0]])   # length -> -y, bores -> x
    bb11 = beam11.bounding_box()
    arms11 = [beam11.translate((x_lo - bb11[0], (43.75 + 6.25) - bb11[4], 6.25 - (bb11[2] + bb11[5]) / 2)) for x_lo in (-52.5, 40.0)]
    shaft9 = axle9.rotate((0, 90, 0)).translate((-56.25, 43.75, 6.25))
    shaft78 = _raw_geo("kit_barbell_shaft", cache).rotate((0, 90, 0)).translate((-39.0, -56.25, 6.25))
    res11 = []
    sb = shaft9.bounding_box()
    if abs(sb[0] + 56.25) > 0.01 or abs(sb[3] - 56.25) > 0.01:
        res11.append(("dozer_axle", "length", f"x {sb[0]:.2f}..{sb[3]:.2f}, expected -56.25..56.25"))
    if sb[3] - 52.5 < 3.0:
        res11.append(("dozer_axle", "retainer room", f"{sb[3] - 52.5:.2f} mm beyond the beam, need >= 3.0"))
    fixed11 = [("keel", keel), ("shaft9", shaft9), ("shaft78", shaft78), *outboard_wheels(w_med, -56.25), *outboard_wheels(w_med, 43.75)]
    for lift in (-4.5, 0.0, 10.0, 25.0):
        moved = [a.translate((0.0, -43.75, -6.25)).rotate((-lift, 0.0, 0.0)).translate((0.0, 43.75, 6.25)) for a in arms11]
        for i, arm_i in enumerate(moved):
            for nm, solid in fixed11:
                if nm.startswith("w"):
                    gap = arm_i.min_gap(solid, 5.0)
                    if gap < 0.95:
                        res11.append((f"arm{i}_lift{lift:+.1f}", nm, f"clearance {gap:.3f} mm, need >= 1.0"))
            gs = arm_i.min_gap(shaft9, 5.0)
            if gs < 0.15:
                res11.append((f"arm{i}_lift{lift:+.1f}", "shaft9", f"bore clearance {gs:.3f} mm, need >= 0.15"))
        res11 += _check_non_overlapping([(f"arm{i}", a) for i, a in enumerate(moved)] + fixed11)
    results["11_dozer_axle_beams"] = res11

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
