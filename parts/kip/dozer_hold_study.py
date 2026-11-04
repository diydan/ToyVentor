#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Bulldozer lift hold (docs/specs/construction-vehicles-spec.md, section 8): can friction at the pivot hold the blade up?

A scratch study, not a gate. It reuses the frame of `dozer_lift_sweep.py` (two `beam_str_tu10` arms, two `kit_scoop_blade`s, a plain 103 x 12.5 x 12.5 crossbar box)
and asks what torque the arms, bar and blades put on the rear axle at each lift angle, and so how hard a friction pivot would have to squeeze the shaft.

    parts/partspec/.venv/bin/python parts/kip/dozer_hold_study.py

Masses are PLA at 1.24 g/cm3 from the real volumes; the real crossbar is not designed, so it is shown solid and at 45 % (walls plus stud decks). Each part's
centroid is taken as the middle of its bounding box (a few mm off for the blades: an estimate, good to about 10 %). Friction: mu 0.3 (PLA on PLA), 2.5 mm
lever (half the cruciform's width).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dozer_lift_sweep as d  # noqa: E402  (changes into parts/partspec, as the sweep does)

RHO = 1.24e-3   # g/mm3
MU, LEVER_MM = 0.3, 2.5


def main():
    parts = d.frame
    mass = {k: v.volume() * RHO for k, v in parts.items()}
    print("mass g:", {k: round(m, 1) for k, m in mass.items()}, "| solid total", round(sum(mass.values()), 1), "g")
    for bar_frac in (0.45, 1.0):
        m_tot = {k: m * (bar_frac if k == "bar" else 1.0) for k, m in mass.items()}
        print(f"\ncrossbar at {int(bar_frac * 100)} % of the solid box, arms + bar + blades {sum(m_tot.values()):.1f} g")
        for deg in (-4.5, 0, 10, 25):
            torque = 0.0   # N*mm
            for k, m in m_tot.items():
                bb = d.lifted(parts[k], deg).bounding_box()
                torque += m * 9.81e-3 * abs((bb[1] + bb[4]) / 2 - d.YR)
            squeeze = torque / (MU * LEVER_MM)
            print(f"  lift {deg:5.1f} deg: holding torque {torque:5.1f} N*mm; a friction pivot would need a {squeeze:5.0f} N squeeze on the shaft")
    print("\nFor scale: a finger-and-thumb pinch is about 50 to 100 N, and a printed PLA bore creeps long before that. Friction cannot hold the blade.")


if __name__ == "__main__":
    main()
