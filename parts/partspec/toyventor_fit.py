#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Design-time fit measurement between mated parts.

Both parts are sliced at mid-stud height in the seated pose. Each stud outline is compared with the
female outline and given a signed gap: positive is clearance, negative is interference depth. The gap is found
by growing or shrinking the stud outline until it touches, so it measures the geometry that was actually built
(not the parameters it was built from). Printer error uses the same idea: a surface offset e moves every
material surface by e, so a stud and a tube that both print oversize by e lose 2e of gap.

Pure measurement: no limits or verdicts here. toyventor_parts.fit_verdict applies the tolerance numbers.
"""
from manifold3d import CrossSection

EPS_MM2 = 1e-3   # overlap area that counts as touching
ARCS = 64        # circular segments for round offsets


def _touch(a, b):
    return (a ^ b).area() > EPS_MM2


def signed_gap(stud, female, limit=2.0, iters=20):
    """Clearance (+) or interference depth (-) between one stud outline and the female outline, in mm.
    Returns +limit when the nearest surface is at least that far away."""
    grow = lambda cs, d: cs.offset(d, 1, 2, ARCS)  # noqa: E731  (round joins)
    if _touch(stud, female):
        lo, hi = 0.0, limit
        for _ in range(iters):
            mid = (lo + hi) / 2
            if _touch(grow(stud, -mid), female):
                lo = mid
            else:
                hi = mid
        return -hi
    if not _touch(grow(stud, limit), female):
        return limit
    lo, hi = 0.0, limit
    for _ in range(iters):
        mid = (lo + hi) / 2
        if _touch(grow(stud, mid), female):
            hi = mid
        else:
            lo = mid
    return hi


def fit_report(male, female, z, only=None):
    """Slice both solids at height z and measure every engaged stud. A stud is engaged when its centre lies
    inside the female outline's bounding box. Returns studs (count), gap_min, gap_max (mm)."""
    ms, fs = male.slice(z), female.slice(z)
    if ms.is_empty() or fs.is_empty():
        return {"studs": 0, "gap_min": None, "gap_max": None}
    x0, y0, x1, y1 = fs.bounds()
    gaps = []
    for s in ms.decompose():
        sx0, sy0, sx1, sy1 = s.bounds()
        cx, cy = (sx0 + sx1) / 2, (sy0 + sy1) / 2
        if x0 < cx < x1 and y0 < cy < y1 and (only is None or any(abs(cx - ox) < 0.5 and abs(cy - oy) < 0.5 for ox, oy in only)):
            gaps.append(signed_gap(s, fs))
    if not gaps:
        return {"studs": 0, "gap_min": None, "gap_max": None}
    return {"studs": len(gaps), "gap_min": min(gaps), "gap_max": max(gaps)}
