# SPDX-License-Identifier: Apache-2.0
"""Shared geometry primitives used by Snap and Pro parts."""
from __future__ import annotations

import math

from manifold3d import CrossSection, Manifold

SEG = 32


def seg_for_radius(
    r_mm: float,
    max_sagitta_mm: float = 0.005,
    min_seg: int = 24,
    max_seg: int = 96,
) -> int:
    """Return a multiple-of-8 segment count bounding chord sagitta <= max_sagitta_mm.

    At the default 5 um sagitta (< half of slicers' 12 um G2/G3 arc-fitting window):
    - r = 1.5 mm corner fillet -> 40 segments (24 when max_sagitta_mm >= 0.012)
    - r = 3.3 mm Small TU stud -> 64 segments (<= 4.0 um chord error)
    - r >= 15 mm show shell    -> 96+ segments for slow 0.12 mm outer walls
    """
    r = abs(float(r_mm))
    e = max(1e-5, float(max_sagitta_mm))
    if r <= e:
        return max(8, int(min_seg))
    ratio = max(-1.0, min(1.0, 1.0 - e / r))
    half_angle = math.acos(ratio)
    if half_angle <= 1e-6:
        return int(max_seg)
    raw = math.ceil(math.pi / (8.0 * half_angle)) * 8
    return max(int(min_seg), min(int(max_seg), int(raw)))


def rrect(w, d, r):
    n_arc = max(16, seg_for_radius(r, max_sagitta_mm=0.010, min_seg=16, max_seg=64))
    return CrossSection.square((w - 2 * r, d - 2 * r), center=True).offset(r, 1, 2, n_arc)


def rbox(w, d, h, r, c):
    """Rounded box on z=0. Vertical corners and top edges are rounded (radius r);
    the bed-contact edge gets a small 45 deg chamfer c instead of a fillet, so the
    first layers print cleanly (no tangent-to-bed overhang)."""
    corner_seg = seg_for_radius(r, max_sagitta_mm=0.012, min_seg=24, max_seg=SEG)
    bottom = Manifold.extrude(rrect(w - 2 * c, d - 2 * c, max(r - c, 0.3)), 0.01)
    mid = Manifold.extrude(rrect(w, d, r), h - r - c).translate((0, 0, c))
    tops = [
        Manifold.sphere(r, corner_seg).translate((sx * (w / 2 - r), sy * (d / 2 - r), h - r))
        for sx in (-1, 1)
        for sy in (-1, 1)
    ]
    return Manifold.batch_hull([bottom, mid] + tops)
