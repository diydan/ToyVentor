#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""SPIKE, SUPERSEDED by `hat_headphones` in toyventor_parts.py (the real catalog part, 2026-11-03: cups raised to ear height with their tips embedded in the shell wall; see
docs/specs/dance-party-spec.md 6.2). Kept as the record of how the print route was found (docs/specs/dance-party-spec.md section 6.1): one-piece Kip headphones that print support-free.

What it is: the hat shell (`_hat_body` rings, so the same wig-envelope vault and the same sequential-bridge crown sockets as the wearable hats) cut to a 12 mm
strip, extended straight down the sides as legs, with a flat 4 mm roof whose edges close at about 50 degrees, and a small tapered teardrop-lofted cup on each leg.
It prints UPSIDE DOWN (`print_rotation_deg` [180, 0, 0], the standard Snap add-on orientation): the crown roof is the bed, the head cavity opens upward, so the
33 mm flat crown ceiling that a worn-orientation print could not bridge (limit 20 mm) becomes a flat floor.

Results (this file, default parameters): part gate `verified`; OrcaSlicer 2.4.2 with Dan's profile (supports on, auto, 30 degrees) 0 support, 0 overhang-wall and
0 bridge moves, 35 min, 3.7 g; zero interference with the four human heads, 470 to 770 mm3 with the animal heads (they are 45 to 55 mm wide, the humans 38 to 40).

Traps found: a point on a teardrop must be inserted in angular order or the polygon silently drops it (the cups then stay plain horizontal cylinders and fail P1/P4);
any shape that is joined to the legs at a different width than the shell becomes a downward ledge once flipped; a pointed cup tip that starts above the bed with nothing
under it is invisible to the part gate (it only measures face angles) and needs the Orca check; the cup apex must not rise above the leg top.

Run (from parts/partspec, venv python): python3 spikes/headphones_proto.py [name=value ...] [--stl out.stl]
Parameters: band_w (half width of the strip), grow, z_leg_bot, cup_mode (1 = printed teardrop-loft cups, 0 = teardrop stubs for a separate snap-on cup), oct_r, cup_taper,
cup_depth, cup_zc, stub_r, stub_len.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from manifold3d import CrossSection, Manifold
import toyventor_parts as tp
from toyventor_parts import (_hat_body, _hat_crown_cavity, _sequential_crown_socket_cutter, HAT_RIM, STUD, socket_conn, keep_above)

def _extrude_xz(points, y_half):
    """Polygon in (x, z) extruded symmetrically in y (counter-clockwise points)."""
    cs = CrossSection([points])
    m = Manifold.extrude(cs, 2 * y_half)               # local z 0..2h
    m = m.rotate((90, 0, 0))                            # (x,y,z) -> (x,-z,y): extrusion runs along -y
    return m.translate((0, y_half, 0))

def _teardrop_bar(zc, r, x_half, slope_deg=52.0):
    """A bar along x whose (y, z) section is a circle with a point on the +z side: printed upside down the point is the lowest part and its sides are
    `slope_deg` from horizontal, so a horizontal round cup prints without supports (the classic teardrop)."""
    phi = 90.0 - slope_deg                                   # the point's half angle from the vertical
    d = r / math.sin(math.radians(phi))
    a0, a1 = 90.0 + (90.0 - phi), 90.0 - (90.0 - phi) + 360.0   # exact tangent points, counter-clockwise from the left tangent around the bottom to the right one
    n = 24
    angs = [a0 + (a1 - a0) * k / n for k in range(n + 1)]
    pts = [(r * math.cos(math.radians(a)), zc + r * math.sin(math.radians(a))) for a in angs] + [(0.0, zc + d)]
    cs = CrossSection([pts])
    m = Manifold.extrude(cs, 2 * x_half).rotate((90, 0, 0)).rotate((0, 0, 90))     # local (u, v, w) -> world (w, u, v): section in (y, z), extruded along x
    return m.translate((-x_half, 0, 0))


def _cup_loft(zc, r0, r1, x0, x1, slope_deg=52.0):
    """Hull of a big teardrop slab at the leg and a small one at the outer face: every lower facet stays at or above `slope_deg` from horizontal."""
    a = _teardrop_bar(zc, r0, 0.5, slope_deg).translate((x0 + 0.5, 0, 0))
    b = _teardrop_bar(zc, r1, 0.25, slope_deg).translate((x1 - 0.25, 0, 0))
    return Manifold.batch_hull([a, b])


def headphones_proto(size="small", band_w=5.0, grow=0.9, head_half=22.2, leg_out=25.0, z_leg_bot=-27.0, cup_depth=6.0, cup_face=10.0, oct_r=9.0, leg_w=7.5, cup_taper=4.5, stub_r=3.2, stub_len=9.0, cup_mode=0, cup_zc=11.0, **_):
    rim = HAT_RIM["beanie"]
    gfn = (lambda z, g=grow: g)
    lower = tp._hat_rings_lower(-z_leg_bot, tp.HAT_WALL, 0, 0.0, 0.0, gfn)        # the hat's own shell, extended straight down as the legs
    w0, d0, p0, cy0 = tp._hat_dims(0.0); w0 += 2 * (tp.HAT_WALL + grow); d0 += 2 * (tp.HAT_WALL + grow)
    roof_t = 4.0
    roof = [(z, tp._strand_ring_pts(w0 - 1.7 * z, d0 - 1.7 * z, p_exp=p0, cy=cy0, n_pts=72, n_locks=0, lock_amp=0.0)) for z in (2.0, roof_t)]
    shell = tp._ring_stack_manifold(lower + roof)                                      # lower shell + a 4 mm roof whose edges close at 45 degrees
    slab = Manifold.cube((80, 2 * band_w, 60), center=True).translate((0, 0, 10))        # a narrow strip across the head
    strip = shell ^ slab
    legs = [None, None]
    head_half = tp.HAT_CAVITY_SLICES[0][1] / 2.0
    leg_out = head_half + tp.HAT_WALL + grow
    cups = []
    for sx in (-1, 1):
        if cup_mode == 1:     # printed with the band: a loft of two teardrops, wide at the leg and narrow at the outer face
            c = _cup_loft(z_leg_bot + cup_zc, oct_r, oct_r - cup_taper, leg_out - 1.0, leg_out + cup_depth)
        else:                 # a teardrop stub that a separate snap-on cup pushes onto (the cup prints with its axis vertical, so it can be round)
            zc = z_leg_bot + stub_r + 1.0
            c = _teardrop_bar(zc, stub_r, 0.5 * stub_len).translate((0.5 * stub_len + leg_out - 1.0, 0, 0))
        cups.append(c if sx > 0 else c.mirror((1, 0, 0)))
    outer = strip + cups[0] + cups[1]
    p = STUD[size]
    cav = _hat_crown_cavity()
    z_cav = tp.HAT_CAVITY_SLICES[0][0] - 0.8
    cav_tube = Manifold.cube((2 * head_half, 40.0, z_cav - (z_leg_bot - 2.0) + 0.01)).translate((-head_half, -20.0, z_leg_bot - 2.0))     # the same cavity, straight down between the legs
    body = keep_above(outer, z_leg_bot) - cav - cav_tube - _sequential_crown_socket_cutter(p, cav.slice(-0.02))
    return body, [socket_conn(size, 2, 1)], {"print_rotation_deg": [180, 0, 0], "sockets": {"holes": 2, "reliefs": 0, "locked": True}, "seat_z_mm": -z_leg_bot}

DEFAULTS = dict(band_w=6.0, cup_mode=1, oct_r=6.5, cup_taper=3.5, cup_depth=5.0, cup_zc=5.0)


if __name__ == "__main__":
    from jsonschema import Draft202012Validator

    kw, stl = dict(DEFAULTS), None
    args = sys.argv[1:]
    while args:
        a = args.pop(0)
        if a == "--stl":
            stl = args.pop(0)
        else:
            k, v = a.split("=")
            kw[k] = float(v)
    part = dict(tp.BY_ID["hat_beanie"], id="headphones_proto", name="Headphones (spike)", fn=lambda: headphones_proto(**kw))
    entry, tm, blocking, small = tp.evaluate(part, Draft202012Validator(tp.SCHEMA))
    print("status", entry["design_status"], "| printed bbox", entry["bbox_mm"], "| watertight", tm.is_watertight, "| volume cm3", entry["volume_cm3"])
    for c in entry["checks"]:
        if c["result"] not in ("pass", "pending", "n/a", "info"):
            print("  NOT PASS", c["id"], c["result"], "-", str(c.get("detail"))[:160])
    if stl:
        tm.export(stl)
        print("wrote", stl)
