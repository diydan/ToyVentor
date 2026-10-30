#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Example 2 (`slot="hand"`): Super Star Wand on a 2 TU Ø6.60 mm Pro grip shaft."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kip_partspec_sdk import *  # noqa: E402,F403


def build():
    star_head = star_2d(points=5, r_outer=19.0, r_inner=10.4, center_z=17.5, fillet_r=1.6)
    return handheld_prop(star_head, grip_tu=2, crest_height_mm=1.6)


PART = part_spec(
    id="custom_star_wand",
    name="Super Star Wand",
    stat="Glow",
    behavior="Five-point spark wand that clicks into Kip's C-grip hand or any Pro bore",
    slot="hand",
    fn=build,
)

if __name__ == "__main__":
    run_cli(PART)
