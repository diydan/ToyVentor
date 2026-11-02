#!/usr/bin/env python3
"""Face-plate rib-bite ladder: six face plates that differ only in RIB_BITE, 1-6 dots on the back to tell them apart.

Why: the first printed face plate was too tight in the 7.0 mm free bore, while the 6.6 mm snap stud fits. Bite is how far the
plug's crush ribs reach past the nominal bore (rib tips across = 7.0 + 2 * bite). The global limit for something pushed in by
hand is 0.1 mm interference, so the answer sits somewhere below the current RIB_BITE.

Uses make_calibration.face_plate() unchanged, only the module global RIB_BITE is varied (restored afterwards), so a ladder
plate with bite == make_calibration.RIB_BITE is the same plate as calibration/toyventor_cal_face_plate.stl plus its dots.
Dot 6 is that current bite on purpose: print it in the same batch as the reference.

    .venv/bin/python make_face_plate_ladder.py [out_dir]     # default: calibration/face_plate_bite_ladder

dots -> bite (mm per side):  1: -0.04   2: 0.00   3: 0.04   4: 0.08   5: 0.12   6: 0.16
Print all six face down (plate on the bed, plug up), no supports, the same profile as the other calibration prints.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np
import trimesh
from manifold3d import Manifold

import make_calibration as mc
import toyventor_parts as tp

BITES = [-0.04, 0.00, 0.04, 0.08, 0.12, 0.16]
FREE_BORE_D = 7.0                 # interfaces.json free_d; the bore these plugs are tried in
SLICE_Z = 3.5                     # straight part of the plug, above the 2.0 plate


def plate(bite, dots):
    """face_plate() at this bite, plus `dots` small bumps on the back (plug side), in a row clear of the plug."""
    mc.RIB_BITE = bite            # face_plate() reads the module global at call time
    m = mc.face_plate()
    for k in range(dots):
        x = (k - (dots - 1) / 2) * 1.6
        m = m + Manifold.cylinder(0.6, 0.5, 0.5, mc.SEGS).translate((x, -5.0, mc.PLATE_T - 0.01))
    return m


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    keep = mc.RIB_BITE
    try:
        # control: no dots, current bite, must equal the plate already in the calibration folder
        ref_path = HERE / "calibration" / "toyventor_cal_face_plate.stl"
        if ref_path.exists():
            ctrl, ref = tp.to_trimesh(plate(keep, 0)), trimesh.load(ref_path)
            print(f"control (bite {keep}, no dots): volume {ctrl.volume:.3f} vs {ref_path.name} {ref.volume:.3f} mm3; "
                  f"bounds equal: {np.allclose(ctrl.bounds, ref.bounds, atol=1e-3)}")
        if keep not in BITES:
            print(f"note: current RIB_BITE {keep} is not on the ladder, so no plate here is the in-batch reference")
        bad = 0
        for i, bite in enumerate(BITES, start=1):
            m = plate(bite, i)
            tm, fails = mc.check(m)
            name = f"face_plate_{i}dot_bite_{'m' if bite < 0 else 'p'}{abs(int(round(bite * 100))):03d}.stl"
            tm.export(out / name)
            tips = 2 * max(float(np.hypot(p[:, 0], p[:, 1]).max()) for p in m.slice(SLICE_Z).to_polygons())
            bad += bool(fails)
            print(f"{'PASS' if not fails else 'FAIL ' + str(fails)}  {name:34s} bite {bite:+.2f}  rib tips {tips:.2f} across "
                  f"({(tips - FREE_BORE_D) / 2:+.2f}/side vs the {FREE_BORE_D:.1f} bore)  "
                  f"bbox {np.round(tm.bounds[1] - tm.bounds[0], 1).tolist()}")
        return 1 if bad else 0
    finally:
        mc.RIB_BITE = keep


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "calibration" / "face_plate_bite_ladder"))
