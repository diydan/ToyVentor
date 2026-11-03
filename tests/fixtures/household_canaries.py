"""Deliberately broken household items, for tests/household-build.test.ts: the build's own checks must catch each one.
Prints one JSON object, key -> list of problems (or {"raised": message} where the right outcome is an exception).
Run with the partspec venv: parts/partspec/.venv/bin/python3 tests/fixtures/household_canaries.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "parts/kip/household"))
sys.path.insert(0, str(ROOT / "parts/kip/sdk"))

import numpy as np  # noqa: E402
from manifold3d import Manifold  # noqa: E402

import build_household as bh  # noqa: E402
import household_builders as hb  # noqa: E402
import household_catalog as hc  # noqa: E402
from household_glb import zoned_glb  # noqa: E402


def box(x, y, z, at):
    return Manifold.cube((x, y, z)).translate(at)


def row(iid):
    return next(r for r in hc.static_rows() if r["id"] == iid)


def raised(fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        return {"raised": str(e)}
    return {"raised": None}


out = {}

# a sound item passes
good, _ = hb.assemble(hb.BUILDERS["ball"]())
out["good"] = bh.solid_problems(hb.fit_longest(good, 40), 40)

# each of these breaks exactly one rule
out["floating_piece"] = bh.solid_problems(box(20, 20, 20, (-10, -10, 0)) + box(5, 5, 5, (30, 0, 0)), 45)
out["off_the_floor"] = bh.solid_problems(box(20, 20, 20, (-10, -10, 3)), 20)
out["wrong_size"] = bh.solid_problems(box(20, 20, 20, (-10, -10, 0)), 40)
out["grip_miss"] = bh.solid_problems(box(20, 20, 20, (20, -10, 0)), 20)          # 20 mm away from the origin
out["grip_graze"] = bh.solid_problems(box(20, 20, 20, (2.9, -10, 0)), 20)        # touches the shaft footprint by 0.1 mm only
out["empty"] = bh.solid_problems(Manifold(), 40)

# budgets and zones, on a real item, with the limit or the colours changed for the call
saved = (bh.MAX_TRIS, bh.MAX_BYTES, bh.MAX_ZONES, dict(hb.COLOURS["ball"]), dict(hb.COLOURS["pencil"]))
try:
    bh.MAX_TRIS = 100
    out["over_triangle_budget"] = bh.build_item(row("ball"))[2]
    bh.MAX_TRIS = saved[0]
    bh.MAX_BYTES = 1000
    out["over_byte_budget"] = bh.build_item(row("ball"))[2]
    bh.MAX_BYTES = saved[1]
    bh.MAX_ZONES = 1
    out["over_zone_budget"] = bh.build_item(row("ball"))[2]
    bh.MAX_ZONES = saved[2]
    hb.COLOURS["ball"] = {"body": "#E24A3B"}                                    # the stripe piece has no colour
    out["zone_not_coloured"] = bh.build_item(row("ball"))[2]
    hb.COLOURS["ball"] = {"body": "#E24A3B", "stripe": "red"}
    out["colour_not_hex"] = bh.build_item(row("ball"))[2]
    hb.COLOURS["ball"] = {"body": "#E24A3B", "stripe": "#ZZZZZZ"}              # right length and a hash, wrong digits: a problem, not a crash
    out["colour_bad_digits"] = bh.build_item(row("ball"))[2]
    hb.COLOURS["ball"] = saved[3]
finally:
    bh.MAX_TRIS, bh.MAX_BYTES, bh.MAX_ZONES = saved[0], saved[1], saved[2]
    hb.COLOURS["ball"], hb.COLOURS["pencil"] = saved[3], saved[4]

out["brand_in_note"] = bh.build_item({**row("ball"), "note": "a duplo ball"})[2]
out["unbuilt_item_is_not_an_error"] = [bh.build_item(row("bucket"))[0]["built"], bh.build_item(row("bucket"))[2]]

# triangles from a piece nobody tagged
solid, ids = hb.assemble(hb.BUILDERS["pencil"]())
_, _, _, untagged = bh.triangle_zones(solid, {})
out["untagged_pieces"] = untagged

# the GLB writer refuses a zone with no triangles and a triangle in an unlisted zone
verts = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], dtype=float)
faces = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]], dtype=np.uint32)
out["glb_empty_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233"), ("b", "#445566")]))
out["glb_unlisted_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a", "a", "a", "c"], [("a", "#112233")]))
out["glb_duplicate_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233"), ("a", "#445566")]))
out["glb_bad_colour"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "112233")]))
out["glb_ok"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233")]))

print(json.dumps(out))
