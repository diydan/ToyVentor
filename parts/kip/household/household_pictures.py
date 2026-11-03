"""Pictures of the household items for the Garage (docs/specs/household-library-spec.md, "In the Garage weekends"): what the weekend sheet, the grown-up's
confirm and the "Who's that shape?" game draw, written by the build as `public/kip/household/pictures.json`, plus the table of which items look alike.

For every item, in a 100 x 100 box (aspect kept, centred, y down as in SVG):
  - `front`        the whole item's outline seen from the front (+y, the side a photo is projected onto): the picture the grown-up's confirm shows;
  - `threeQuarter` the outline from a three-quarter view (turned 35 degrees, tipped 20): the picture the shape game shows, the most characteristic view;
  - `zones`        each colour zone's outline from the front, back to front, with its colour: the coloured picture on the sheet.
Paths are SVG path data, drawn with the even-odd rule (holes are extra sub-paths).

`confusable_with` lists, for each item, the items whose three-quarter outline overlaps its own by at least CONFUSABLE_IOU (intersection over union, both
fitted to the same box): a ball, a marble and an orange are all round, so the game must never ask for one with another as the wrong answer.
Standard library plus manifold3d; deterministic (coordinates rounded to 0.1).
"""
from __future__ import annotations

import itertools
from typing import Dict, List, Sequence, Tuple

from manifold3d import CrossSection, Manifold

BOX = 100.0
YAW_DEG, PITCH_DEG = 35.0, 20.0
CONFUSABLE_IOU = 0.75
SIMPLIFY_MM = 0.15  # in the item's own millimetres, before fitting to the box
MIN_DISTRACTORS = 3  # every item needs this many items it does not look like, in every pool it can be asked in


def silhouette(m: Manifold, yaw: float = 0.0, pitch: float = 0.0) -> CrossSection:
    """The outline of a solid seen from +y (x right, z up), after turning it `yaw` about z and tipping it `pitch` about x."""
    if yaw:
        m = m.rotate((0.0, 0.0, yaw))
    if pitch:
        m = m.rotate((pitch, 0.0, 0.0))
    return m.rotate((-90.0, 0.0, 0.0)).project().simplify(SIMPLIFY_MM)


def fit_box(cs: CrossSection) -> Tuple[float, float, float]:
    """(scale, shift x, shift y) that put an outline in the BOX, aspect kept and centred (before the y flip)."""
    x0, y0, x1, y1 = cs.bounds()
    k = BOX / max(x1 - x0, y1 - y0)
    return k, (BOX - (x1 - x0) * k) / 2 - x0 * k, (BOX - (y1 - y0) * k) / 2 - y0 * k


def to_box(cs: CrossSection, fit: Tuple[float, float, float]) -> CrossSection:
    k, tx, ty = fit
    return cs.scale((k, k)).translate((tx, ty))


def path(cs: CrossSection, fit: Tuple[float, float, float]) -> str:
    """SVG path data of an outline in the BOX (y flipped to point down), each contour closed, coordinates to 0.1."""
    k, tx, ty = fit
    parts: List[str] = []
    for poly in cs.to_polygons():
        pts = [(round(float(x) * k + tx, 1), round(BOX - (float(y) * k + ty), 1)) for x, y in poly]
        parts.append("M" + " L".join(f"{x:g} {y:g}" for x, y in pts) + " Z")
    return " ".join(parts)


def iou(a: CrossSection, b: CrossSection) -> float:
    union = (a + b).area()
    return float((a ^ b).area() / union) if union > 0 else 0.0  # in this manifold3d, ^ is intersection


def pictures_for(solid: Manifold, zone_solids: Sequence[Tuple[str, Manifold, str]]) -> Tuple[dict, CrossSection]:
    """(the item's pictures, its three-quarter outline fitted to the BOX). `zone_solids` is (zone, solid, #RRGGBB) in material order, already in the
    item's finished frame; the zones are drawn back to front by the middle of their depth."""
    front = silhouette(solid)
    quarter = silhouette(solid, YAW_DEG, PITCH_DEG)
    f_fit, q_fit = fit_box(front), fit_box(quarter)
    zones = []
    for order, (zone, m, hex_) in enumerate(zone_solids):
        _, y0, _, _, y1, _ = m.bounding_box()
        zones.append(((y0 + y1) / 2, order, {"zone": zone, "hex": hex_, "d": path(silhouette(m), f_fit)}))
    zones.sort(key=lambda z: (z[0], z[1]))  # smaller y is further back
    return (
        {"front": path(front, f_fit), "threeQuarter": path(quarter, q_fit), "zones": [z[2] for z in zones]},
        to_box(quarter, q_fit),
    )


def confusable_with(outlines: Dict[str, CrossSection]) -> Dict[str, List[str]]:
    """For each id, the ids whose fitted three-quarter outline overlaps it by at least CONFUSABLE_IOU (symmetric, sorted)."""
    out: Dict[str, List[str]] = {i: [] for i in outlines}
    for a, b in itertools.combinations(sorted(outlines), 2):
        if iou(outlines[a], outlines[b]) >= CONFUSABLE_IOU:
            out[a].append(b)
            out[b].append(a)
    return {i: sorted(v) for i, v in out.items()}


def distractor_problems(rows: Sequence[dict], confusable: Dict[str, List[str]]) -> List[str]:
    """Every item must have MIN_DISTRACTORS items it does not look like, drawn from the pool the youngest band that sees it may use: a simple item from
    the simple items only, any other from the items its own band may see (an item's wrong answers are never for an older band than its own)."""
    out: List[str] = []
    for r in rows:
        iid = r["id"]
        pool = [o for o in rows if o["id"] != iid and o["minBand"] <= r["minBand"] and (o["simple"] or not r["simple"])]
        free = [o["id"] for o in pool if o["id"] not in confusable.get(iid, [])]
        if len(free) < MIN_DISTRACTORS:
            out.append(f"{iid}: only {len(free)} items it does not look like to use as wrong answers (needs {MIN_DISTRACTORS})")
    return out
