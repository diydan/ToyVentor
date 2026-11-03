"""Geometry builders for the household library (docs/specs/household-library-spec.md).

A builder returns the WHOLE object as a list of PIECES: `[(zone, manifold), ...]`. A zone is a named colour area (at most three per item). The
pieces are unioned into one watertight solid by `assemble`, and every triangle of the result remembers which piece it came from, so the GLB can
carry one named material per zone.

Frame of a finished item (after `finish`), in millimetres:
  - z is up and the object stands on z = 0;
  - the GRIP POINT, where a hand prop's shaft enters, is the origin (x = y = 0, z = 0);
  - the front, the side a photo is projected onto and the side a relief faces, is +y (the same as the pilot's spoon dish);
  - the longest side of the bounding box is exactly the item's `prop_mm`.
Revolved items are built around the z axis. Discs (plate, flying disc, yo-yo) stand on their edge with their face to +y.

`BUILDERS` maps an item id to its builder; `COLOURS` maps it to its zone colours (the fallback for an item with no photo).
"""
from __future__ import annotations

import math
from typing import Callable, Dict, List, Optional, Tuple

from manifold3d import CrossSection, Manifold

SEG = 28  # circular segments of a revolved surface: the triangle budget knob

Piece = Tuple[str, Manifold]


def revolve(profile_rz: List[Tuple[float, float]], segs: int = SEG) -> Manifold:
    """A solid of revolution about z from a closed (radius, z) polygon whose radii are >= 0 (closed along the axis)."""
    return Manifold.revolve(CrossSection([[tuple(map(float, p)) for p in profile_rz]]), segs)


def revolve_banded(profile_rz: List[Tuple[float, float]], bands: List[Tuple[str, Optional[float], Optional[float]]], segs: int = SEG) -> List[Piece]:
    """Revolve a profile in horizontal bands, one piece per band: `(zone, z_low, z_high)`, None meaning open ended.
    The profile is cut with exact rectangles, so cuts that fall on a profile vertex add no new vertex."""
    cs = CrossSection([[tuple(map(float, p)) for p in profile_rz]])
    _, _, x1, _ = cs.bounds()
    out: List[Piece] = []
    for zone, lo, hi in bands:
        lo_v = -1e4 if lo is None else lo
        hi_v = 1e4 if hi is None else hi
        slab = CrossSection.square((x1 + 1.0, hi_v - lo_v)).translate((0.0, lo_v))
        out.append((zone, Manifold.revolve(cs ^ slab, segs)))  # in this manifold3d, ^ is intersection
    return out


def ellipsoid(a: float, b: float, c: float, segs: int = SEG) -> Manifold:
    return Manifold.sphere(1.0, segs).scale((a, b, c))


def assemble(pieces: List[Piece]) -> Tuple[Manifold, Dict[int, str]]:
    """Union the pieces into one solid. Returns (solid, original id -> zone): each piece is tagged with its own original id, which the boolean
    keeps on the triangles that came from it (`Mesh.run_original_id`)."""
    tagged: List[Manifold] = []
    zone_of_id: Dict[int, str] = {}
    for zone, m in pieces:
        t = m.as_original()
        zone_of_id[int(t.original_id())] = zone
        tagged.append(t)
    solid = tagged[0]
    for t in tagged[1:]:
        solid = solid + t
    return solid, zone_of_id


def fit_longest(m: Manifold, longest_mm: float) -> Manifold:
    """Uniformly scale (about the origin, so the grip point stays put) so the longest side is `longest_mm`, then stand it on z = 0."""
    x0, y0, z0, x1, y1, z1 = m.bounding_box()
    k = longest_mm / max(x1 - x0, y1 - y0, z1 - z0)
    m = m.scale((k, k, k))
    return m.translate((0.0, 0.0, -m.bounding_box()[2]))


def on_edge(m: Manifold, grip_axial: Optional[float] = None) -> Manifold:
    """Turn a disc built flat (axis z, face up) to stand on its edge with its face towards +y: centred in x, the lowest rim point at z = 0.
    In y the disc is centred on its thickness, or, given `grip_axial` (a height on the flat disc's axis), on that height: pass the middle of the
    rim, so the shaft meets rim material instead of the empty middle of a dish."""
    m = m.rotate((-90.0, 0.0, 0.0))  # the flat axis z becomes y
    x0, y0, z0, x1, y1, z1 = m.bounding_box()
    y_grip = (y0 + y1) / 2 if grip_axial is None else float(grip_axial)
    return m.translate((-(x0 + x1) / 2, -y_grip, -z0))


def _one(m: Manifold) -> List[Piece]:
    return [("body", m)]


# ---- revolved items (family R): one profile, spun ----------------------------------------------------------------------------

def ball() -> List[Piece]:
    """A stripe ball: a semicircle spun, the middle band its own zone. The cuts fall on the 15 degree latitude rings, so no vertex is added."""
    r, n = 25.0, 12
    prof = [(r * math.sin(math.pi * i / n), -r * math.cos(math.pi * i / n)) for i in range(n + 1)]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    band = r * math.cos(math.radians(75.0))  # the ring 75 degrees from the pole: sin(15 deg) of the radius off the equator
    return revolve_banded(prof, [("body", None, -band), ("stripe", -band, band), ("body", band, None)], 24)


def water_bottle() -> List[Piece]:
    return revolve_banded(
        [(0, 0), (12.5, 0), (14, 1.5), (14, 54), (13.2, 59), (11, 63.5), (7.5, 67), (5.4, 69), (5.4, 80), (6.8, 80), (6.8, 90), (0, 90)],
        [("body", None, 80.0), ("cap", 80.0, None)],
    )


def flask() -> List[Piece]:
    return revolve_banded(
        [(0, 0), (13.5, 0), (15, 1.5), (15, 64), (14, 66), (14, 68), (14.8, 68), (14.8, 86), (12.5, 90), (0, 90)],
        [("body", None, 68.0), ("cap", 68.0, None)],
    )


def drinking_glass() -> List[Piece]:
    return _one(revolve([(0, 0), (17, 0), (17.6, 1.0), (21, 60), (19.4, 60), (16.4, 6.5), (0, 6.5)]))


def jam_jar() -> List[Piece]:
    return revolve_banded(
        [(0, 0), (23, 0), (24, 1.5), (24, 42), (23.2, 44.5), (22.4, 46.5), (23.6, 46.5), (23.6, 55), (0, 55)],
        [("body", None, 46.5), ("lid", 46.5, None)],
    )


def soda_can() -> List[Piece]:
    # a flat base, not a real can's dome: the shaft meets the middle of the base
    return _one(revolve([(0, 0), (15.5, 0), (17.4, 2.0), (18, 4), (18, 60), (16.6, 63), (14.8, 65), (14.8, 66.4), (15.6, 66.4), (15.6, 68), (13.6, 68), (13.6, 70), (0, 70)]))


def cookie_tin() -> List[Piece]:
    return _one(revolve([(0, 0), (34, 0), (35, 1), (35, 38), (36.4, 39), (36.4, 49), (35, 50), (0, 50)]))


def bowl() -> List[Piece]:
    return _one(revolve([(0, 0), (13, 0), (15, 1.5), (25, 9), (33.5, 19), (37.5, 34), (35.5, 34), (31, 24), (22, 13.5), (0, 11)]))


def plate() -> List[Piece]:
    flat = revolve([(0, 0), (22, 0), (24, 1.2), (34, 5), (39.5, 8.5), (40, 10), (38.8, 10), (33, 7.4), (24, 4.2), (0, 3.4)], 36)
    return _one(on_edge(flat, grip_axial=8.9))  # the rim is only about 2.5 mm thick, up near the face: grip it there


def spinning_top() -> List[Piece]:
    return _one(revolve([(0, 0), (1.6, 0), (4.5, 5), (13, 14), (25, 26), (23.6, 31), (16, 36), (6, 39), (4, 41), (4, 53), (7, 53), (7, 57), (0, 57)]))


def yo_yo() -> List[Piece]:
    # two thick halves with a narrow slot between them (not a V groove, which would leave nothing at the rim for the shaft to meet)
    flat = revolve([(0, 0), (25, 0), (28, 3), (28, 12.75), (22, 12.75), (22, 15.25), (28, 15.25), (28, 25), (25, 28), (0, 28)], 32)
    return _one(on_edge(flat))


def flying_disc() -> List[Piece]:
    flat = revolve([(0, 0), (32, 0), (38, 1), (40, 4.5), (40, 9), (37, 12.5), (26, 14), (0, 11)], 36)
    return _one(on_edge(flat, grip_axial=6.75))  # the middle of the full-radius rim


def marble() -> List[Piece]:
    return _one(Manifold.sphere(20.0, 32))


def orange() -> List[Piece]:
    body = ellipsoid(27.5, 27.5, 25.5, 30).translate((0, 0, 25.5))
    stem = Manifold.cylinder(4.2, 2.6, 1.8, 12, False).translate((0, 0, 49.0))  # starts inside the body (its top is z = 51), so it cannot float
    return [("body", body), ("stem", stem)]


def lemon() -> List[Piece]:
    body = ellipsoid(20, 20, 29, 30).translate((0, 0, 29))
    tip_top = Manifold.cylinder(6.0, 4.4, 1.4, 12, False).translate((0, 0, 55.0))
    tip_bottom = Manifold.cylinder(6.0, 1.4, 4.4, 12, False).translate((0, 0, -3.0))
    return _one(body + tip_top + tip_bottom)


# ---- pilot items kept in the library (families RC, E, C, L) ---------------------------------------------------------------------

def mug() -> List[Piece]:
    r, h = 19.0, 38.0
    body = revolve([(0, 0), (r - 1.5, 0), (r, 2.0), (r, h), (0, h)])
    body = body - revolve([(0, h - 14), (r - 3.0, h - 14), (r - 3.0, h + 1), (0, h + 1)])  # the opening
    ring = (CrossSection.circle(10.5, 24) - CrossSection.circle(5.5, 24)).scale((0.8, 1.0))
    handle = Manifold.extrude(ring, 7.0).translate((0, 0, -3.5)).rotate((90, 0, 0)).translate((r + 6.0, 0, h * 0.5))
    return _one(body + handle)


def wooden_spoon() -> List[Piece]:
    stick = Manifold.cylinder(60.0, 3.6, 2.6, 18, False) + Manifold.cylinder(14.0, 2.6, 2.2, 18, False).translate((0, 0, 58.0))
    bowl_ = ellipsoid(10.5, 7.0, 15.0).translate((0, 0, 80.0))
    dish = ellipsoid(8.4, 4.2, 12.6).translate((0, 4.2, 80.0))  # the dish opens towards +y, the front
    return _one(stick + (bowl_ - dish))


def pencil() -> List[Piece]:
    body = Manifold.cylinder(66.0, 4.2, 4.2, 6, False)
    tip = Manifold.cylinder(12.0, 0.9, 4.2, 12, False).translate((0, 0, -12.0))  # thin end away from the body
    ferrule = Manifold.cylinder(7.0, 4.4, 4.4, 14, False).translate((0, 0, 66.0))
    eraser = Manifold.cylinder(6.0, 3.8, 3.4, 14, False).translate((0, 0, 73.0))

    def held_by_the_eraser(m: Manifold) -> Manifold:  # the thick end meets the shaft, the tip points up
        return m.rotate((180, 0, 0))

    return [("body", held_by_the_eraser(body + tip)), ("ferrule", held_by_the_eraser(ferrule)), ("eraser", held_by_the_eraser(eraser))]


def banana() -> List[Piece]:
    """Held by its stalk, as a real one is: the stalk's bottom is the grip point and the lowest point, and the fruit rises from it, curving to +x.
    (An earlier version put the fruit's belly lowest, so the end that meets the shaft hung in the air.)"""
    n, radius_of_arc, sweep = 10, 62.0, math.radians(75.0)
    pts, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        a = sweep * t
        pts.append((radius_of_arc * (1 - math.cos(a)), 0.0, radius_of_arc * math.sin(a)))  # leaves the origin heading straight up
        radii.append(2.8 + 5.6 * math.sin(math.pi * t) ** 0.75)  # thin at both ends, full in the middle
    body = None
    for (p, r), (q, s) in zip(zip(pts, radii), zip(pts[1:], radii[1:])):
        seg = Manifold.batch_hull([Manifold.sphere(r, 14).translate(p), Manifold.sphere(s, 14).translate(q)])
        body = seg if body is None else body + seg
    stalk = Manifold.cylinder(9.0, 1.9, 2.3, 10, False).translate((0, 0, -8.2))  # its top is inside the first sphere, so it cannot float
    return [("body", body), ("stem", stalk)]


BUILDERS: Dict[str, Callable[[], List[Piece]]] = {
    "ball": ball,
    "water_bottle": water_bottle,
    "flask": flask,
    "drinking_glass": drinking_glass,
    "jam_jar": jam_jar,
    "soda_can": soda_can,
    "cookie_tin": cookie_tin,
    "bowl": bowl,
    "plate": plate,
    "spinning_top": spinning_top,
    "yo_yo": yo_yo,
    "flying_disc": flying_disc,
    "marble": marble,
    "orange": orange,
    "lemon": lemon,
    "mug": mug,
    "wooden_spoon": wooden_spoon,
    "pencil": pencil,
    "banana": banana,
}

# zone name -> sRGB hex, in the order the zones become materials. The photo projection overrides these in the game.
COLOURS: Dict[str, Dict[str, str]] = {
    "ball": {"body": "#E24A3B", "stripe": "#F5F1E8"},
    "water_bottle": {"body": "#4FA3E0", "cap": "#F5F5F0"},
    "flask": {"body": "#2E7D6B", "cap": "#D9DDE0"},
    "drinking_glass": {"body": "#BFE3F2"},
    "jam_jar": {"body": "#B8473F", "lid": "#D4A22C"},
    "soda_can": {"body": "#C9CDD3"},
    "cookie_tin": {"body": "#D4A22C"},
    "bowl": {"body": "#F2E3C6"},
    "plate": {"body": "#F4F0E8"},
    "spinning_top": {"body": "#E6B422"},
    "yo_yo": {"body": "#7E57C2"},
    "flying_disc": {"body": "#F57C00"},
    "marble": {"body": "#3F8EFC"},
    "orange": {"body": "#F28C28", "stem": "#4F8F3A"},
    "lemon": {"body": "#F5E050"},
    "mug": {"body": "#F5F5F0"},
    "wooden_spoon": {"body": "#A9743F"},
    "pencil": {"body": "#F2C230", "ferrule": "#B8BEC6", "eraser": "#E8837E"},
    "banana": {"body": "#F7DC4E", "stem": "#7A5C2E"},
}
