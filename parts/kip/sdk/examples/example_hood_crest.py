#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Example 3 (`slot="hood"`): Turbo Aero Hood Crest for Modular Car (`2x2` hood port)."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kip_partspec_sdk import *  # noqa: E402,F403


def build():
    base_cowl = loft_slabs([
        (0.0, 23.6, 23.6, 4.8, 0.0, 0.0),
        (5.5, 21.0, 24.5, 4.5, 0.0, -1.2),
        (8.5, 14.0, 20.0, 3.8, 0.0, 1.5),
    ])
    center_fin = loft_slabs([
        (4.0, 6.4, 20.0, 2.6, 0.0, -0.5),
        (13.5, 4.6, 15.0, 2.0, 0.0, 2.5),
    ])
    return vehicle_addon(base_cowl + center_fin, slot="hood")


PART = part_spec(
    id="custom_hood_crest",
    name="Turbo Aero Hood Crest",
    stat="Speed",
    behavior="Swept aero intake fin that snaps onto the Roadster Car 2x2 hood port",
    slot="hood",
    fn=build,
)

if __name__ == "__main__":
    run_cli(PART)
