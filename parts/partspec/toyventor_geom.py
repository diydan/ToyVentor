# SPDX-License-Identifier: Apache-2.0
"""Shared geometry primitives used by Snap and Motion parts."""
from manifold3d import CrossSection, Manifold

SEG = 32


def rrect(w, d, r):
    return CrossSection.square((w - 2 * r, d - 2 * r), center=True).offset(r, 1, 2, 24)


def rbox(w, d, h, r, c):
    """Rounded box on z=0. Vertical corners and top edges are rounded (radius r);
    the bed-contact edge gets a small 45 deg chamfer c instead of a fillet, so the
    first layers print cleanly (no tangent-to-bed overhang)."""
    bottom = Manifold.extrude(rrect(w - 2 * c, d - 2 * c, max(r - c, 0.3)), 0.01)
    mid = Manifold.extrude(rrect(w, d, r), h - r - c).translate((0, 0, c))
    tops = [Manifold.sphere(r, SEG).translate((sx * (w / 2 - r), sy * (d / 2 - r), h - r))
            for sx in (-1, 1) for sy in (-1, 1)]
    return Manifold.batch_hull([bottom, mid] + tops)
