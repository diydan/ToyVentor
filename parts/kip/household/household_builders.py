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
    # a short blunt peg (6.8 mm across, the shape many toy tops have) instead of a sharp point: the shaft meets a flat patch (71 of 72 mm3 of contact,
    # where a 3.2 mm point gave 33) and it still reads as a top
    return _one(revolve([(0, 0), (3.4, 0), (5.2, 4), (13, 14), (25, 26), (23.6, 31), (16, 36), (6, 39), (4, 41), (4, 53), (7, 53), (7, 57), (0, 57)]))


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


# ==== phase 3: the other 31 items ====================================================================================================
# Built at about prop scale (the longest side near the prop size; `fit_longest` makes it exact). Every item stands on its grip: the lowest part is
# under the origin, so the shaft meets material (the build refuses an item whose grip misses). Flat items (fork, comb, ruler, ...) are plates with
# their faces to +y (the front, where a photo is projected). Items held by their handle stand with the handle down and the working end up.

# ---- shared shape helpers (phase 3) ----

def box(w: float, d: float, h: float, z0: float = 0.0) -> Manifold:
    """A box centred in x and y, from height z0 up by h."""
    return Manifold.cube((w, d, h)).translate((-w / 2, -d / 2, z0))


def rbox(w: float, d: float, h: float, r: float, segs: int = 8, z0: float = 0.0) -> Manifold:
    """A box with rounded edges (the hull of eight spheres), centred in x and y, from height z0 up by h."""
    xs, ys, zs = (-w / 2 + r, w / 2 - r), (-d / 2 + r, d / 2 - r), (z0 + r, z0 + h - r)
    return Manifold.batch_hull([Manifold.sphere(r, segs).translate((x, y, z)) for x in xs for y in ys for z in zs])


def cyl(r: float, h: float, segs: int = SEG, r_top: Optional[float] = None, z0: float = 0.0) -> Manifold:
    """A (tapered) upright cylinder from height z0 up by h."""
    return Manifold.cylinder(h, r, r if r_top is None else r_top, segs, False).translate((0.0, 0.0, z0))


def between(p: Tuple[float, float, float], q: Tuple[float, float, float], r0: float, r1: Optional[float] = None, segs: int = 12) -> Manifold:
    """A (tapered) round rod from point p to point q, radius r0 at p and r1 at q."""
    dx, dy, dz = q[0] - p[0], q[1] - p[1], q[2] - p[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    rod = Manifold.cylinder(length, r0, r0 if r1 is None else r1, segs, False)
    tilt = math.degrees(math.acos(dz / length))
    turn = math.degrees(math.atan2(dy, dx))
    return rod.rotate((0.0, tilt, 0.0)).rotate((0.0, 0.0, turn)).translate((float(p[0]), float(p[1]), float(p[2])))


def poly2d(pts: List[Tuple[float, float]]) -> CrossSection:
    """A profile in the plate frame: (x right, z up). Counter-clockwise."""
    return CrossSection([[(float(x), float(z)) for x, z in pts]])


def rect2d(x0: float, z0: float, x1: float, z1: float) -> CrossSection:
    return poly2d([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])


def disc2d(cx: float, cz: float, r: float, segs: int = 24) -> CrossSection:
    return CrossSection.circle(r, segs).translate((float(cx), float(cz)))


def capsule2d(p: Tuple[float, float], q: Tuple[float, float], r0: float, r1: Optional[float] = None, segs: int = 14) -> CrossSection:
    """A rounded bar from p to q (the hull of two discs): radius r0 at p and r1 at q."""
    return CrossSection.batch_hull([disc2d(p[0], p[1], r0, segs), disc2d(q[0], q[1], r0 if r1 is None else r1, segs)])


def bar2d(p: Tuple[float, float], q: Tuple[float, float], w0: float, w1: Optional[float] = None) -> CrossSection:
    """A bar with level ends: width w0 (in x) at p and w1 at q."""
    w1 = w0 if w1 is None else w1
    return poly2d([(p[0] - w0 / 2, p[1]), (p[0] + w0 / 2, p[1]), (q[0] + w1 / 2, q[1]), (q[0] - w1 / 2, q[1])])


def union2d(parts: List[CrossSection]) -> CrossSection:
    out = parts[0]
    for p in parts[1:]:
        out = out + p
    return out


def union3d(parts: List[Manifold]) -> Manifold:
    out = parts[0]
    for p in parts[1:]:
        out = out + p
    return out


def flat(cs: CrossSection, thick: float) -> Manifold:
    """Extrude a plate-frame profile to a plate `thick` mm deep, centred on y = 0, its faces towards +y (the front) and -y."""
    return Manifold.extrude(cs, thick).translate((0.0, 0.0, -thick / 2)).rotate((90.0, 0.0, 0.0))


# ---- revolved composites (family RC) ----

def bucket() -> List[Piece]:
    h, rb, rt, wall = 56.0, 26.0, 32.0, 2.6
    body = revolve([(0, 0), (rb, 0), (rt, h), (rt - wall, h), (rb - 2.2, 2.4), (0, 2.4)])
    arc = Manifold.revolve(CrossSection.circle(1.9, 10).translate((rt - 1.3, 0.0)), 22, 180.0)  # half a ring, flat on the floor, ...
    arc = arc.rotate((90.0, 0.0, 0.0)).translate((0.0, 0.0, h - 1.0))  # ... stood up over the rim, its ends in the wall
    return [("body", body), ("handle", arc)]


def watering_can() -> List[Piece]:
    body = revolve([(0, 0), (23, 0), (25, 2), (25, 42), (22, 46), (0, 46)])
    spout = between((22.0, 0.0, 10.0), (60.0, 0.0, 52.0), 4.8, 3.4)
    rose = between((58.0, 0.0, 50.0), (63.5, 0.0, 56.0), 4.2, 9.0)
    handle = flat(disc2d(-20, 34, 23, 22) - disc2d(-20, 34, 17.5, 22), 6.0)
    return [("body", body + spout), ("handle", handle), ("rose", rose)]


def potted_plant() -> List[Piece]:
    pot = revolve([(0, 0), (13, 0), (15, 1.6), (21, 27), (23, 27), (23, 31), (0, 31)], 24)
    soil = cyl(20.5, 2.0, 24, z0=30.0)
    leaves = []
    for az, c, tilt in ((18, 27, 24), (90, 31, 30), (162, 25, 22), (234, 29, 34), (306, 23, 28)):
        leaves.append(ellipsoid(6.5, 1.5, c, 8).translate((0, 0, c)).rotate((-tilt, 0, 0)).rotate((0, 0, az)).translate((0, 0, 30.5)))
    return [("pot", pot), ("soil", soil), ("leaves", union3d(leaves))]


def flashlight() -> List[Piece]:
    pieces = revolve_banded(
        [(0, 0), (8.4, 0), (9, 2), (9, 48), (10.4, 56), (13.5, 70), (14.2, 82), (0, 82)],
        [("body", None, 56.0), ("head", 56.0, None)],
    )
    switch = rbox(5.0, 4.0, 11.0, 1.4, 8, z0=24.0).translate((0.0, 9.6, 0.0))
    lens = cyl(12.6, 3.0, z0=81.0)
    return pieces + [("head", switch), ("lens", lens)]


def tape_measure() -> List[Piece]:
    corners = [disc2d(x, z, 14.0, 20) for x in (-14.0, 14.0) for z in (14.0, 42.0)]
    case = flat(CrossSection.batch_hull(corners), 24.0)
    strip = box(40.0, 15.0, 1.6, z0=7.0).translate((44.0, 0.0, 0.0))  # the blade, coming out of the case's front edge
    hook = box(2.4, 15.0, 9.0, z0=4.0).translate((62.0, 0.0, 0.0))
    return [("case", case), ("tape", strip + hook)]


def alarm_clock() -> List[Piece]:
    disc = on_edge(revolve([(0, 0), (28, 0), (30, 2), (30, 20), (28, 22), (0, 22)], 28))  # stands on its rim, face to +y; spans z 0 to 60, y +-11
    face = cyl(25.0, 1.4, 28).rotate((-90.0, 0.0, 0.0)).translate((0.0, 10.4, 30.0))
    hands = [box(2.4, 1.8, 13.0).rotate((0.0, -35.0, 0.0)).translate((0.0, 11.5, 30.0)),  # hour hand
             box(1.8, 1.8, 19.0).rotate((0.0, 150.0, 0.0)).translate((0.0, 11.5, 30.0))]  # minute hand
    feet = [cyl(5.0, 12.0, 10, r_top=2.2).translate((sx * 20.0, 0.0, 0.0)) for sx in (-1.0, 1.0)]
    dome = Manifold.sphere(10.0, 14) ^ Manifold.cube((30.0, 30.0, 12.0)).translate((-15.0, -15.0, 0.0))  # a half dome, flat side down
    bells = [dome.rotate((0.0, sx * 30.0, 0.0)).translate((sx * 17.0, 0.0, 53.0)) for sx in (-1.0, 1.0)]
    clapper = between((0.0, 0.0, 58.0), (0.0, 0.0, 66.0), 1.3) + Manifold.sphere(2.6, 10).translate((0.0, 0.0, 67.0))
    return [("body", union3d([disc] + feet + hands)), ("face", face), ("bells", union3d(bells + [clapper]))]


def desk_lamp() -> List[Piece]:
    base = cyl(22.0, 4.0, 28)
    joint_a, joint_b = (-10.0, 0.0, 52.0), (22.0, 0.0, 70.0)
    arms = between((0.0, 0.0, 3.0), joint_a, 2.6) + between(joint_a, joint_b, 2.2) + Manifold.sphere(4.0, 10).translate(joint_a) + Manifold.sphere(3.6, 10).translate(joint_b)
    outer = revolve([(0, 0), (17.6, 0), (5.6, 26.5), (0, 28)], 28)
    inner = revolve([(0, -1), (16.0, -1), (4.0, 23.5), (0, 24.5)], 28)
    shade = (outer - inner) + cyl(2.4, 12.0, 10, z0=16.0)  # a socket from the shade's top down to the bulb
    shade = shade.translate((0.0, 0.0, -28.0)).rotate((0.0, -20.0, 0.0)).translate(joint_b)
    bulb = Manifold.sphere(7.0, 12).translate((0.0, 0.0, 12.0)).translate((0.0, 0.0, -28.0)).rotate((0.0, -20.0, 0.0)).translate(joint_b)
    return [("body", base + arms), ("shade", shade), ("bulb", bulb)]


# ---- fruit and vegetables ----

def apple() -> List[Piece]:
    body = revolve([(0, 0), (9, 0), (20, 2), (30, 10), (35.5, 22), (36, 34), (32.5, 46), (24, 56), (13, 60.5), (6, 58.2), (0, 56.5)])
    stem = between((0.0, 0.0, 54.0), (1.5, 0.0, 70.0), 2.1, 1.7, 8)
    leaf = ellipsoid(10.0, 1.0, 4.6, 10).rotate((0.0, 22.0, 0.0)).translate((8.5, 0.0, 66.5))
    return [("body", body), ("stem", stem), ("leaf", leaf)]


def carrot() -> List[Piece]:
    """Held by its blunt tip (the leaves are the high end), as the spinning top is held by its point: a 3.6 mm tip is the grip."""
    body = revolve([(0, 0), (3.6, 0), (5.0, 6), (8.0, 22), (10.5, 40), (11.5, 52), (10.0, 58), (5.0, 61), (0, 61.5)], 24)
    leaves = [between(base, tip, 2.2, 0.9, 8) for base, tip in (((1.4, 0.0, 56.0), (8.0, 0.0, 90.0)), ((-1.0, 1.3, 56.0), (-6.0, 5.0, 88.0)), ((-1.0, -1.3, 56.0), (-4.5, -6.0, 86.0)))]  # fanned apart, so no two touch edge on
    return [("body", body), ("leaf", union3d(leaves))]


def avocado() -> List[Piece]:
    """A halved avocado standing on its flat base: skin, flesh and a pit that stands proud of the front face (+y)."""
    prof = [(0, 0), (9, 0), (17, 2), (23, 8), (26, 18), (26, 26), (23, 34), (18, 42), (13, 50), (9, 56), (5, 60), (0, 62)]
    whole = revolve(prof, 20)
    inner = whole.scale((0.87, 0.87, 0.9)).translate((0.0, 0.0, 2.6))
    half = Manifold.cube((100.0, 40.0, 100.0)).translate((-50.0, -40.0, -10.0))  # keeps y <= 0: the cut face is the front
    skin = (whole ^ half) - inner
    flesh = inner ^ half
    pit = Manifold.sphere(10.5, 16).translate((0.0, -4.0, 22.0))
    return [("skin", skin), ("flesh", flesh), ("pit", pit)]


# ---- cutlery, grooming and kitchen plates (family E: a plate with its face to +y) ----

def fork() -> List[Piece]:
    handle = poly2d([(-3.6, 0), (3.6, 0), (4.6, 44), (-4.6, 44)])
    neck = poly2d([(-4.6, 42), (4.6, 42), (8.8, 62), (-8.8, 62)])
    tines = [capsule2d((x, 60.0), (x, 88.4), 1.6) for x in (-7.2, -2.4, 2.4, 7.2)]  # round-ended, 3.2 mm wide: blunt
    return _one(flat(union2d([handle, neck] + tines), 4.6))


def key() -> List[Piece]:
    bow = disc2d(0, 14, 14, 24) - disc2d(0, 16, 5, 16)
    shaft = rect2d(-5, 26, 5, 30) + rect2d(-3.6, 28, 3.6, 59.4) + disc2d(0, 58.0, 3.6, 10)
    bits = rect2d(3.0, 34, 8.2, 40) + rect2d(3.0, 45, 6.6, 50)
    return _one(flat(bow + shaft + bits, 4.2))


def comb() -> List[Piece]:
    n, width = 20, 90.0
    pitch = (width - 2.2) / (n - 1)
    spine = rect2d(-width / 2, 0, width / 2, 16)
    teeth = [rect2d(-width / 2 + i * pitch, 14, -width / 2 + i * pitch + 2.2, 36) for i in range(n)]
    return _one(flat(union2d([spine] + teeth), 3.6))


def hairbrush() -> List[Piece]:
    handle = revolve([(0, 0), (4.2, 0), (5.0, 10), (6.0, 40), (0, 40)])
    head = rbox(38.0, 7.0, 44.0, 3.0, 8, z0=36.0)
    tufts = [between((x, 3.0, z), (x, 7.4, z), 1.25, 1.0, 6) for x in (-13.5, -4.5, 4.5, 13.5) for z in (43.0, 52.0, 61.0, 70.0)]
    return [("handle", handle), ("head", head), ("bristles", union3d(tufts))]


def toothbrush() -> List[Piece]:
    body = union2d([bar2d((0, 0), (0, 50), 8.0, 6.4), bar2d((0, 48), (0, 69), 4.4), capsule2d((0, 70.0), (0, 85.0), 4.2)])
    tufts = [between((x, 2.0, z), (x, 8.0, z), 1.5, 1.3, 6) for x in (-2.2, 2.2) for z in (72.0, 76.0, 80.0, 84.0)]
    return [("handle", flat(body, 4.6)), ("bristles", union3d(tufts))]


# ---- stationery (family C) ----

def paintbrush() -> List[Piece]:
    handle = revolve([(0, 0), (3.0, 0), (3.4, 4), (4.4, 20), (4.8, 34), (3.6, 46), (3.4, 50), (0, 50)], 20)
    ferrule = cyl(4.6, 16.0, 20, r_top=4.0, z0=48.0)
    bristles = revolve([(0, 62), (4.0, 62), (4.4, 70), (3.4, 80), (1.6, 88), (0, 90)], 20)
    return [("handle", handle), ("ferrule", ferrule), ("bristles", bristles)]


def marker() -> List[Piece]:
    pieces = revolve_banded(
        [(0, 0), (5.2, 0), (5.2, 48), (6.2, 48), (6.2, 84), (4.8, 87), (2.4, 90), (0, 90)],
        [("body", None, 48.0), ("cap", 48.0, None)],
        20,
    )
    clip = box(1.4, 3.2, 28.0, z0=54.0).translate((6.6, 0.0, 0.0))
    return pieces + [("cap", clip)]


def crayon() -> List[Piece]:
    body = revolve([(0, 0), (4.5, 0), (4.5, 64), (2.6, 80), (1.2, 88), (0, 90)], 20)
    wrapper = revolve([(4.0, 6), (4.9, 6), (4.9, 56), (4.0, 56)], 20)
    return [("body", body), ("wrapper", wrapper)]


def eraser() -> List[Piece]:
    return [("body", rbox(60.0, 12.0, 22.0, 2.5, 8)), ("sleeve", rbox(26.0, 13.2, 23.2, 2.8, 8, z0=-0.6))]


def ruler() -> List[Piece]:
    plate = box(18.0, 3.2, 90.0)
    ticks = []
    for i in range(21):
        z = 6.0 + 4.0 * i
        w = 9.0 if i % 5 == 0 else 5.0
        ticks.append(box(w, 1.2, 0.9, z0=z).translate((-9.0 + w / 2 + 0.0, 1.6, 0.0)))  # ribs standing 0.6 mm proud of the front face
    return [("body", plate), ("ticks", union3d(ticks))]


def scissors() -> List[Piece]:
    rings = [disc2d(sx * 10.0, 13.0, 10.5, 22) - disc2d(sx * 10.0, 13.0, 5.5, 18) for sx in (-1.0, 1.0)]
    web = rect2d(-10.0, 0.0, 10.0, 7.0)
    handles = union2d(rings + [web])
    shanks = [capsule2d((sx * 10.0, 22.0), (0.0, 44.0), 3.0, 3.4) for sx in (-1.0, 1.0)]
    blades = [capsule2d((0.0, 44.0), (sx * 21.0, 88.3), 3.6, 1.7) for sx in (-1.0, 1.0)]  # tips 3.4 mm across: blunt
    pivot = disc2d(0.0, 44.0, 4.2, 14)
    return [("handle", flat(handles, 5.0)), ("blade", flat(union2d(shanks + blades + [pivot]), 3.4))]


def glue_stick() -> List[Piece]:
    return [("body", cyl(9.0, 62.0, 24)), ("cap", revolve([(0, 58), (9.6, 58), (9.6, 84), (7.0, 90), (0, 90)], 24))]


def stapler() -> List[Piece]:
    base = flat(poly2d([(-45, 0), (42, 0), (45, 3), (45, 7), (-45, 7)]), 16.0)
    arm = flat(poly2d([(-30, 7), (-30, 11), (45, 11), (45, 14), (41, 20), (28, 25), (-39, 27), (-45, 22), (-45, 7)]), 14.0)
    return [("body", arm), ("base", base)]


def tape_dispenser() -> List[Piece]:
    base = flat(poly2d([(-42, 0), (46, 0), (46, 9), (36, 14), (-42, 16)]), 22.0)
    hub = flat(disc2d(-10, 40, 9, 22), 22.0)
    core = flat(disc2d(-10, 40, 14, 24) - disc2d(-10, 40, 8, 22), 14.0)
    tape = flat(disc2d(-10, 40, 27, 28) - disc2d(-10, 40, 13.6, 24), 14.0)
    return [("body", base + hub), ("tape", tape), ("core", core)]


def dice() -> List[Piece]:
    cube = rbox(40.0, 40.0, 40.0, 4.0, 8)
    pip = cyl(3.4, 1.6, 8).translate((0.0, 0.0, -0.8))  # a flat disc half sunk into the face
    spots = {1: [(0, 0)], 2: [(-10, -10), (10, 10)], 3: [(-10, -10), (0, 0), (10, 10)],
             4: [(-10, -10), (-10, 10), (10, -10), (10, 10)], 5: [(-10, -10), (-10, 10), (0, 0), (10, -10), (10, 10)]}
    pips = []
    for n, normal in ((1, "+z"), (3, "+y"), (4, "-y"), (2, "+x"), (5, "-x")):  # opposite faces add to seven; the bottom (6) is the grip, left plain
        for u, v in spots[n]:
            if normal == "+z":
                pips.append(pip.translate((u, v, 40.0)))
            elif normal == "+y":
                pips.append(pip.rotate((-90.0, 0.0, 0.0)).translate((u, 20.0, 20.0 + v)))
            elif normal == "-y":
                pips.append(pip.rotate((90.0, 0.0, 0.0)).translate((u, -20.0, 20.0 + v)))
            elif normal == "+x":
                pips.append(pip.rotate((0.0, 90.0, 0.0)).translate((20.0, u, 20.0 + v)))
            else:
                pips.append(pip.rotate((0.0, -90.0, 0.0)).translate((-20.0, u, 20.0 + v)))
    return [("body", cube), ("pips", union3d(pips))]


def toy_brick() -> List[Piece]:
    brick = box(32.0, 16.0, 9.6)
    studs = [cyl(2.4, 2.7, 10, z0=8.9).translate((x, y, 0.0)) for x in (-12.0, -4.0, 4.0, 12.0) for y in (-4.0, 4.0)]
    return _one(brick + union3d(studs))


def bubble_wand() -> List[Piece]:
    handle = cyl(3.6, 56.0, 16, r_top=3.0)
    ring = flat(disc2d(0, 70, 17.5, 28) - disc2d(0, 70, 12.5, 28), 5.0)
    return [("handle", handle), ("ring", ring)]


def toy_sword() -> List[Piece]:
    blade = flat(CrossSection.batch_hull([rect2d(-4.6, 34.0, 4.6, 34.4), disc2d(0, 88.3, 1.7, 12)]), 4.0)
    guard = box(26.0, 6.0, 5.4, z0=29.0)
    pommel = cyl(5.2, 5.0, 16)
    grip = cyl(3.4, 30.0, 14, z0=4.0)
    return [("blade", blade), ("grip", grip), ("hilt", pommel + guard)]


# ---- garage tools ----

def hammer() -> List[Piece]:
    handle = cyl(3.8, 70.0, 16, r_top=3.2)
    claw = union2d([capsule2d((-6.0, 75.0), (-20.0, 73.0), 8.0, 5.6), capsule2d((-20.0, 73.0), (-30.0, 67.0), 5.6, 3.4), capsule2d((-30.0, 67.0), (-34.5, 60.0), 3.4, 1.7)])
    head = flat(union2d([rect2d(1.0, 62.0, 20.0, 88.0), claw]), 12.0)
    return [("handle", handle), ("head", head)]


def screwdriver() -> List[Piece]:
    handle = revolve([(0, 0), (5.5, 0), (9.0, 6), (9.6, 14), (8.6, 34), (6.5, 40), (0, 40)], 20)
    shaft = cyl(4.2, 6.0, 12, z0=38.0) + cyl(2.3, 44.0, 12, z0=40.0)
    tip = Manifold.batch_hull([cyl(2.3, 0.3, 12, z0=82.0), box(4.6, 1.8, 0.4, z0=89.6)])  # a flat blade with a blunt end, not a point
    return [("handle", handle), ("shaft", shaft + tip)]


def pliers() -> List[Piece]:
    grips = union2d([bar2d((sx * 5.75, 0.0), (sx * 6.5, 36.0), 12.5, 8.5) for sx in (-1.0, 1.0)])
    links = [capsule2d((sx * 6.5, 34.0), (0.0, 46.0), 4.2, 3.8) for sx in (-1.0, 1.0)]
    jaws = [capsule2d((0.0, 46.0), (sx * 4.0, 86.0), 5.2, 2.0) for sx in (-1.0, 1.0)]
    return [("grip", flat(grips, 7.0)), ("steel", flat(union2d(links + jaws + [disc2d(0.0, 46.0, 4.6, 14)]), 7.0))]


# ==== phase 5: the next ten (plain boxes, a puzzle piece, the first soft things) ================================================================

def board_game() -> List[Piece]:
    """A box on its edge; the lid carries a four by four board (the dark squares are a colour zone standing 0.8 mm proud)."""
    lid = rbox(90.0, 20.0, 90.0, 3.0, 8)
    # 14 mm cells on a 15 mm pitch: cells that meet diagonally must not touch along an edge (a pinched, non-manifold line)
    cells = [box(14.0, 1.6, 14.0, z0=15.5 + 15.0 * j).translate((-30.0 + 15.0 * i + 7.5, 10.0, 0.0)) for i in range(4) for j in range(4) if (i + j) % 2 == 0]
    return [("box", lid), ("squares", union3d(cells))]


def jigsaw() -> List[Piece]:
    """One edge piece for the puzzle: a knob out on the left and on top, a socket in on the right, and a flat bottom edge to hold."""
    square = rect2d(-30, 0, 30, 60)
    knob_left = rect2d(-34.5, 26.5, -29, 33.5) + disc2d(-40, 30, 8.5, 20)
    knob_top = rect2d(-3.5, 59, 3.5, 64.5) + disc2d(0, 70, 8.5, 20)
    socket = rect2d(24, 26.5, 31, 33.5) + disc2d(20, 30, 8.5, 20)
    return _one(flat(square + knob_left + knob_top - socket, 8.0))


def notebook() -> List[Piece]:
    """Two boards and a spine round a block of pages, with an elastic strap: cover, pages and strap are the zones."""
    boards = [box(60.0, 1.6, 90.0).translate((0.0, 3.7, 0.0)), box(60.0, 1.6, 90.0).translate((0.0, -3.7, 0.0)), box(1.6, 9.0, 90.0).translate((-29.2, 0.0, 0.0))]
    pages = box(58.0, 6.2, 88.4, z0=0.8)  # into the boards by 0.2 mm (no slit), and 1 mm short of the right edge and 0.8 mm of the top and bottom, so the page edges show
    strap = box(3.0, 9.4, 90.0).translate((17.0, 0.0, 0.0))
    return [("cover", union3d(boards)), ("pages", pages), ("strap", strap)]


def book() -> List[Piece]:
    """A hardback: rounded spine, boards, pages, and a plain label (no title) on the front."""
    boards = [box(54.0, 1.6, 90.0).translate((4.0, 7.2, 0.0)), box(54.0, 1.6, 90.0).translate((4.0, -7.2, 0.0)), cyl(8.0, 90.0, 18).translate((-23.0, 0.0, 0.0))]
    pages = box(51.0, 13.2, 88.4, z0=0.8).translate((2.7, 0.0, 0.0))  # into the boards by 0.2 mm, so there is no slit
    label = box(32.0, 1.6, 20.0, z0=52.0).translate((6.0, 8.0, 0.0))
    return [("cover", union3d(boards)), ("pages", pages), ("label", label)]


def cereal_box() -> List[Piece]:
    body = rbox(56.0, 18.0, 90.0, 1.2, 6)
    window = flat(CrossSection.circle(18.0, 24).scale((1.0, 1.2)).translate((0.0, 46.0)), 1.6).translate((0.0, 9.0, 0.0))
    band = box(56.6, 18.6, 8.0, z0=78.0)
    return [("box", body), ("window", window), ("band", band)]


def lunchbox() -> List[Piece]:
    base = rbox(90.0, 36.0, 28.0, 5.0, 8)
    lid = rbox(90.0, 36.0, 24.0, 7.0, 8, z0=26.0)
    handle = Manifold.revolve(CrossSection.circle(2.2, 8).translate((13.0, 0.0)), 18, 180.0).rotate((90.0, 0.0, 0.0)).translate((0.0, 0.0, 49.5))
    latch = box(14.0, 3.4, 12.0, z0=20.0).translate((0.0, 17.5, 0.0))
    return [("base", base), ("lid", lid), ("hardware", handle + latch)]


def pencil_case() -> List[Piece]:
    body = rbox(90.0, 30.0, 34.0, 12.0, 10)
    zip_ = box(78.0, 3.6, 2.0, z0=33.2) + rbox(6.0, 5.0, 8.0, 1.5, 6, z0=28.0).translate((38.0, 0.0, 0.0))
    return [("body", body), ("zip", zip_)]


def soap() -> List[Piece]:
    body = rbox(90.0, 26.0, 56.0, 9.0, 10)  # on its long edge, so the front is the big face
    emboss = flat(CrossSection.circle(22.0, 24).scale((1.3, 0.8)).translate((0.0, 28.0)), 1.6).translate((0.0, 13.0, 0.0))
    return [("body", body), ("emboss", emboss)]


def sponge() -> List[Piece]:
    pad = rbox(90.0, 60.0, 8.0, 2.5, 8)
    top = rbox(90.0, 60.0, 22.0, 4.0, 8, z0=6.0)
    for x, z, r in ((-32.0, 18.0, 2.6), (-14.0, 20.0, 3.0), (6.0, 16.0, 2.4), (22.0, 20.0, 3.2), (34.0, 16.0, 2.2)):
        top = top - Manifold.cylinder(6.0, r, r, 8, False).rotate((-90.0, 0.0, 0.0)).translate((x, 26.0, z))  # holes in the front face
    return [("sponge", top), ("pad", pad)]


def playing_cards() -> List[Piece]:
    """A squared deck standing on its short edge, with one heart on the top card. (One card is too thin to hold.)"""
    deck = rbox(63.0, 16.0, 90.0, 3.0, 8)
    heart = CrossSection.circle(7.4, 18).translate((-6.4, 55.5)) + CrossSection.circle(7.4, 18).translate((6.4, 55.5)) + poly2d([(-13.2, 52.0), (0.0, 31.0), (13.2, 52.0)])
    return [("cards", deck), ("heart", flat(heart, 1.6).translate((0.0, 8.0, 0.0)))]


# ---- the support tool (outside the 60): a chunky, rounded multi-purpose toy tool for the youngest bands ----

def support_tool() -> List[Piece]:
    """A fat handle, a big rounded block for a head (a mallet), and a gear standing proud on the front of it: it reads as 'a fix-it tool' for any job."""
    handle = cyl(6.5, 52.0, 20)
    head = rbox(44.0, 22.0, 26.0, 5.0, 8, z0=45.0)
    gear = disc2d(0, 58, 7.6, 24) + union2d([rect2d(-2.3, 6.6, 2.3, 11.6).rotate(45.0 * k).translate((0.0, 0.0)) for k in range(8)]).translate((0.0, 58.0))
    gear = gear - disc2d(0, 58, 3.0, 12)
    return [("handle", handle), ("head", head), ("gear", flat(gear, 1.8).translate((0.0, 11.0, 0.0)))]


BUILDERS.update({
    "support_tool": support_tool,
    "bucket": bucket,
    "watering_can": watering_can,
    "potted_plant": potted_plant,
    "apple": apple,
    "carrot": carrot,
    "avocado": avocado,
    "fork": fork,
    "key": key,
    "comb": comb,
    "hairbrush": hairbrush,
    "toothbrush": toothbrush,
    "paintbrush": paintbrush,
    "marker": marker,
    "crayon": crayon,
    "eraser": eraser,
    "ruler": ruler,
    "scissors": scissors,
    "glue_stick": glue_stick,
    "stapler": stapler,
    "tape_dispenser": tape_dispenser,
    "dice": dice,
    "toy_brick": toy_brick,
    "bubble_wand": bubble_wand,
    "toy_sword": toy_sword,
    "hammer": hammer,
    "screwdriver": screwdriver,
    "pliers": pliers,
    "flashlight": flashlight,
    "tape_measure": tape_measure,
    "alarm_clock": alarm_clock,
    "desk_lamp": desk_lamp,
    "board_game": board_game,
    "jigsaw": jigsaw,
    "notebook": notebook,
    "book": book,
    "playing_cards": playing_cards,
    "pencil_case": pencil_case,
    "soap": soap,
    "sponge": sponge,
    "cereal_box": cereal_box,
    "lunchbox": lunchbox,
})

COLOURS.update({
    "support_tool": {"handle": "#F2A22C", "head": "#3B6FD4", "gear": "#F5E050"},
    "bucket": {"body": "#3FA7D6", "handle": "#B8BEC6"},
    "watering_can": {"body": "#4FA36B", "handle": "#2F7A4B", "rose": "#D9DDE0"},
    "potted_plant": {"pot": "#C8693A", "soil": "#5A3E2B", "leaves": "#4FAE4A"},
    "apple": {"body": "#D93A3A", "stem": "#6B4A2A", "leaf": "#4FA84A"},
    "carrot": {"body": "#F28A1E", "leaf": "#4FA84A"},
    "avocado": {"skin": "#2F5D34", "flesh": "#C9DE7A", "pit": "#7A4A2A"},
    "fork": {"body": "#C9CDD3"},
    "key": {"body": "#D9B24C"},
    "comb": {"body": "#4A8FE0"},
    "hairbrush": {"handle": "#B5763E", "head": "#E08FB0", "bristles": "#F4EFE6"},
    "toothbrush": {"handle": "#2FB5B0", "bristles": "#F4F4F0"},
    "paintbrush": {"handle": "#D9A441", "ferrule": "#C9CDD3", "bristles": "#2E6FD8"},
    "marker": {"body": "#2E86DE", "cap": "#F2F2F2"},
    "crayon": {"body": "#E8483A", "wrapper": "#F5E6C8"},
    "eraser": {"body": "#F2A7B8", "sleeve": "#3B6FD4"},
    "ruler": {"body": "#F2D16B", "ticks": "#2A2A2A"},
    "scissors": {"blade": "#C9CDD3", "handle": "#E8483A"},
    "glue_stick": {"body": "#F5F1E8", "cap": "#3B6FD4"},
    "stapler": {"body": "#D13B3B", "base": "#2B2B2B"},
    "tape_dispenser": {"body": "#2B2B2B", "tape": "#F2E2A0", "core": "#B07A4A"},
    "dice": {"body": "#F5F1E8", "pips": "#222222"},
    "toy_brick": {"body": "#D93A3A"},
    "bubble_wand": {"handle": "#8E5BD9", "ring": "#4FC3F7"},
    "toy_sword": {"blade": "#C9CDD3", "grip": "#8A5A2B", "hilt": "#D4A22C"},
    "hammer": {"handle": "#B5763E", "head": "#8D949C"},
    "screwdriver": {"handle": "#F2A22C", "shaft": "#B8BEC6"},
    "pliers": {"grip": "#D93A3A", "steel": "#A9B0B8"},
    "flashlight": {"body": "#F2C230", "head": "#3A3A3A", "lens": "#FFF1A8"},
    "tape_measure": {"case": "#F2C230", "tape": "#C9CDD3"},
    "alarm_clock": {"body": "#E24A3B", "face": "#F5F1E8", "bells": "#C9CDD3"},
    "desk_lamp": {"body": "#3A3A3A", "shade": "#E8A322", "bulb": "#FFF1A8"},
    "board_game": {"box": "#3B6FD4", "squares": "#F5F1E8"},
    "jigsaw": {"body": "#2FB5B0"},
    "notebook": {"cover": "#E8483A", "pages": "#F5F1E8", "strap": "#2B2B2B"},
    "book": {"cover": "#2F7A4B", "pages": "#F5E6C8", "label": "#D4A22C"},
    "playing_cards": {"cards": "#F5F1E8", "heart": "#D93A3A"},
    "pencil_case": {"body": "#3FA7D6", "zip": "#2B2B2B"},
    "soap": {"body": "#F2A7B8", "emboss": "#F5F1E8"},
    "sponge": {"sponge": "#F5E050", "pad": "#4FA84A"},
    "cereal_box": {"box": "#F2C230", "window": "#F5F1E8", "band": "#D13B3B"},
    "lunchbox": {"base": "#E8483A", "lid": "#3FA7D6", "hardware": "#B8BEC6"},
})
