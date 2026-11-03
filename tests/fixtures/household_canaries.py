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

# the spinning top's grip: held by a blunt peg it has 71 of the probe's 72 mm3 (a sharp point gave 33): the decision to blunt it must not be undone
probe = Manifold.cube((bh.GRIP_FOOTPRINT_MM, bh.GRIP_FOOTPRINT_MM, bh.GRIP_DEPTH_MM)).translate((-bh.GRIP_FOOTPRINT_MM / 2, -bh.GRIP_FOOTPRINT_MM / 2, 0.0))
top, _ = hb.assemble(hb.BUILDERS["spinning_top"]())
out["grip_spinning_top_mm3"] = round((hb.fit_longest(top, 60) ^ probe).volume(), 1)

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

# the real regression behind the zero-area rule: the first carrot, whose three leaves grew from one point and touched edge on
def carrot_with_touching_leaves():
    body = hb.revolve([(0, 0), (3.6, 0), (5.0, 6), (8.0, 22), (10.5, 40), (11.5, 52), (10.0, 58), (5.0, 61), (0, 61.5)], 24)
    leaves = [hb.between((0.0, 0.0, 56.0), tip, 2.6, 1.0, 8) for tip in ((6.0, 0.0, 90.0), (-4.5, 3.5, 88.0), (-3.0, -4.5, 86.0))]
    return [("body", body), ("leaf", hb.union3d(leaves))]


saved_carrot = hb.BUILDERS["carrot"]
try:
    hb.BUILDERS["carrot"] = carrot_with_touching_leaves
    out["sliver_carrot"] = bh.build_item(row("carrot"))[2]
finally:
    hb.BUILDERS["carrot"] = saved_carrot
out["real_carrot"] = bh.build_item(row("carrot"))[2]

# the real regression behind the open-edge rule: the first board game, whose dark squares met at their corners
def checkerboard_touching():
    lid = hb.rbox(90.0, 20.0, 90.0, 3.0, 8)
    cells = [hb.box(15.0, 1.6, 15.0, z0=15.0 + 15.0 * j).translate((-30.0 + 15.0 * i + 7.5, 10.0, 0.0)) for i in range(4) for j in range(4) if (i + j) % 2 == 0]
    return [("box", lid), ("squares", hb.union3d(cells))]


saved_board = hb.BUILDERS["board_game"]
try:
    hb.BUILDERS["board_game"] = checkerboard_touching
    out["pinched_checkerboard"] = bh.build_item(row("board_game"))[2]
finally:
    hb.BUILDERS["board_game"] = saved_board
out["real_board_game"] = bh.build_item(row("board_game"))[2]

out["brand_in_note"] = bh.build_item({**row("ball"), "note": "a duplo ball"})[2]
# a row whose id has no builder (every real item has one now): not built, and not an error
no_builder = {**row("ball"), "id": "no_builder_item"}
out["unbuilt_item_is_not_an_error"] = [bh.build_item(no_builder)[0]["built"], bh.build_item(no_builder)[2]]

# triangles from a piece nobody tagged
solid, ids = hb.assemble(hb.BUILDERS["pencil"]())
_, _, _, untagged = bh.triangle_zones(solid, {})
out["untagged_pieces"] = untagged

verts = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], dtype=float)
faces = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]], dtype=np.uint32)

# a triangle with no area IN THE FILE: the 16-bit grid collapses a float sliver (the carrot's leaves once touched edge on, leaving two)
sliver_verts = np.vstack([verts, [[10.0, 1e-5, 0.0]]])  # 1e-5 mm off the line from vertex 1 to vertex 0: a real triangle in floats, a line on the grid
sliver_faces = np.vstack([faces, [[0, 4, 1]]]).astype(np.uint32)
out["glb_sound_mesh"] = zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233")])[1]["zeroAreaTris"]
out["glb_sliver"] = zoned_glb("t", sliver_verts, sliver_faces, ["a"] * 5, [("a", "#112233")])[1]["zeroAreaTris"]
out["sliver_is_real_in_floats"] = float(np.linalg.norm(np.cross(sliver_verts[4] - sliver_verts[0], sliver_verts[1] - sliver_verts[0])) / 2)

# an edge that is not shared by exactly two faces: two cubes that touch only along a line (the first checkerboard did), and a surface with a hole
def mesh_of(m):
    mesh = m.to_mesh()
    return np.asarray(mesh.vert_properties, dtype=float)[:, :3].copy(), np.asarray(mesh.tri_verts, dtype=np.uint32).copy()


def open_edges_of(v, f):
    return zoned_glb("t", v, f, ["a"] * len(f), [("a", "#112233")])[1]["openEdges"]


cube_a = Manifold.cube((10, 10, 10))
out["open_edges_one_cube"] = open_edges_of(*mesh_of(cube_a))
out["open_edges_touching_along_a_line"] = open_edges_of(*mesh_of(cube_a + Manifold.cube((10, 10, 10)).translate((10, 10, 0))))
out["open_edges_overlapping_cubes"] = open_edges_of(*mesh_of(cube_a + Manifold.cube((10, 10, 10)).translate((8, 8, 0))))  # a proper union: no pinch
hole_v, hole_f = mesh_of(cube_a)
out["open_edges_hole"] = open_edges_of(hole_v, hole_f[:-1])  # one triangle missing

# the GLB writer refuses a zone with no triangles, a triangle in an unlisted zone, a repeated zone and a bad colour
out["glb_empty_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233"), ("b", "#445566")]))
out["glb_unlisted_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a", "a", "a", "c"], [("a", "#112233")]))
out["glb_duplicate_zone"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233"), ("a", "#445566")]))
out["glb_bad_colour"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "112233")]))
out["glb_ok"] = raised(lambda: zoned_glb("t", verts, faces, ["a"] * 4, [("a", "#112233")]))

print(json.dumps(out))
