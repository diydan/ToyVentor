#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Bulldozer lift sweep (docs/specs/construction-vehicles-spec.md, section 8): arms from the kit's own Pro beams, swept through the lift range.

A scratch study, not a gate. Real CAD for the keel, wheels, axles, beams and the scoop blade (what `toyventor_kitcard._raw_geo` returns); the crossbar that
joins the two arm tips is a plain 103 x 12.5 x 12.5 box (the real part is not designed yet). Both arms are one `beam_str_tu10` each, outboard of the wheels,
pivoting on the 103 mm wide axle at the rear (row 8), blades in front of the crossbar. For each lift angle it prints the gaps that matter.

    parts/partspec/.venv/bin/python parts/kip/dozer_lift_sweep.py

Lift is positive when the blade goes up. Gaps are 3D distances (0.00 means touching, not necessarily overlapping); overlaps are boolean volumes.
"""
import math
import os
import sys
from pathlib import Path

PS = Path(__file__).resolve().parents[1] / "partspec"
sys.path.insert(0, str(PS))
os.chdir(PS)
from manifold3d import Manifold  # noqa: E402
import toyventor_kitcard as kc  # noqa: E402

YR, YF, ZA, R_W = 43.75, -56.25, 6.25, 18.0   # rear / front axle rows, axle height, medium wheel radius
GROUND = ZA - R_W
cache = {}
G = lambda pid: kc._raw_geo(pid, cache)  # noqa: E731

keel, wheel = G("kit_keel_base"), G("kit_wheel_med")
wheels = lambda y: [wheel.rotate((0, 90, 0)).translate((-39.0, y, ZA)), wheel.rotate((0, 90, 0)).translate((26.7, y, ZA))]  # noqa: E731
front_w, rear_w = wheels(YF), wheels(YR)
others = {
    "keel": keel, "front_wheel_l": front_w[0], "front_wheel_r": front_w[1], "rear_wheel_l": rear_w[0], "rear_wheel_r": rear_w[1],
    "front_shaft": G("kit_barbell_shaft").rotate((0, 90, 0)).translate((-39.0, YF, ZA)),
    "rear_shaft": G("kit_barbell_shaft_wide").rotate((0, 90, 0)).translate((-51.5, YR, ZA)),
}

# Arms: a beam's raw frame has its length on x and its bores on z; map length -> -y and bores -> x (a proper rotation; a beam is symmetric).
beam = G("beam_str_tu10").transform([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0]])


def place_arm(x_lo):
    b = beam.bounding_box()
    # first bore centre is 6.25 from the beam's rear end: put it on the rear axle, centre the beam on axle height
    return beam.translate((x_lo - b[0], (YR + 6.25) - b[4], ZA - (b[2] + b[5]) / 2))


arm_l, arm_r = place_arm(-51.5), place_arm(39.0)   # outboard of the wheels: x -51.5..-39.0 and 39.0..51.5 (zero gap to the wheel faces)
tip_y = arm_l.bounding_box()[1]
bar = Manifold.cube((103.0, 12.5, 12.5)).translate((-51.5, tip_y - 12.5, ZA - 6.25))
blade = G("kit_scoop_blade").rotate((90, 0, 0)).rotate((0, 0, 180))
bb = blade.bounding_box()
place_blade = lambda cx: blade.translate((cx - (bb[0] + bb[3]) / 2, (tip_y - 12.5) - bb[4], -bb[2]))  # noqa: E731
frame = {"armL": arm_l, "armR": arm_r, "bar": bar, "bladeL": place_blade(-24.9), "bladeR": place_blade(24.9)}


def lifted(m, deg):
    # rotating about +X by a positive angle sends the front tips (-y) DOWN, so the lift angle is the negative of the rotation
    return m.translate((0, -YR, -ZA)).rotate((-deg, 0, 0)).translate((0, YR, ZA))


def gap(mv, a_names, b_names):
    return min(mv[a].min_gap(others[b], 40.0) for a in a_names for b in b_names)


def main():
    fw, rw = ["front_wheel_l", "front_wheel_r"], ["rear_wheel_l", "rear_wheel_r"]
    print("lift  blade above ground | arm-front wheel  arm-rear wheel  arm-rear shaft  blade+bar-front wheels  arm-keel | overlap mm3 (all parts)")
    for deg in (-4.5, 0, 5, 10, 15, 20, 25):
        mv = {n: lifted(m, deg) for n, m in frame.items()}
        lo = min(mv["bladeL"].bounding_box()[2], mv["bladeR"].bounding_box()[2]) - GROUND
        ov = sum((mv[a] ^ others[b]).volume() for a in mv for b in others)
        print(f"{deg:5.1f}  {lo:9.2f}          | {gap(mv, ['armL', 'armR'], fw):8.2f}        {gap(mv, ['armL', 'armR'], rw):8.2f}       "
              f"{gap(mv, ['armL', 'armR'], ['rear_shaft']):8.2f}          {gap(mv, ['bar', 'bladeL', 'bladeR'], fw):8.2f}          {gap(mv, ['armL', 'armR'], ['keel']):6.2f} | {ov:8.3f}")
    lo, hi = -10.0, 0.0
    for _ in range(30):   # where the blade's lowest point meets the ground
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if lifted(frame["bladeL"], mid).bounding_box()[2] - GROUND < 0 else (lo, mid)
    print(f"\nblade bottom meets the ground at a lift of {hi:.2f} deg (arms {-tip_y + YR:.1f} mm long from the pivot to the tip); "
          f"at +25 deg it is {lifted(frame['bladeL'], 25).bounding_box()[2] - GROUND:.1f} mm up")
    print(f"wheel face to beam: 0.0 mm. A 1.0 mm gap needs a shaft of at least {2 * (39.0 + 1.0 + 12.5):.1f} mm before any retainer "
          f"(9 TU = 112.5 mm leaves {56.25 - (39.0 + 1.0 + 12.5):.2f} mm each end)")


if __name__ == "__main__":
    main()
