#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Example 1 (`slot="crown"`): Starlight Wizard Hat for Kip's 2x1 Crown Buds."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kip_partspec_sdk import *  # noqa: E402,F403


def build():
    brim_and_cone = loft_slabs([
        (0.0, 23.6, 11.6, 4.8, 0.0, 0.0),
        (6.8, 28.0, 17.2, 6.5, 0.0, -1.5),
        (15.5, 13.0, 12.5, 5.2, 0.0, -0.4),
        (23.5, 6.2, 6.2, 2.8, 1.8, 1.2),
    ])
    tip_pom = sphere(3.6, (2.2, 1.4, 25.0))
    return crown_addon(brim_and_cone + hull([cylinder(1.5, 3.2, z=22.5, x=1.8, y=1.2), tip_pom]))


PART = part_spec(
    id="custom_wizard_hat",
    name="Starlight Wizard Hat",
    stat="Glow",
    behavior="Pointed starlight hat with pom-pom tip for any 2x1 character crown",
    slot="crown",
    fn=build,
)

if __name__ == "__main__":
    run_cli(PART)
