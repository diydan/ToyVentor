"""Tell a bridge from a ledge.

A flat downward face prints as a bridge only when the slicer can anchor straight extrusions across it on BOTH sides. A flat face held on
one side only (a ledge over air) is the worst overhang there is, yet a plain angle test calls it a bridge. This check rasterises each flat
downward region and the solid just below it, then asks of every point: is there a straight line through it with support on both sides
within the bridge limit, or is it within a short cantilever of support? Points that fail both are ledge.

Shared by the generator (P4_no_ledges) and the pre-print validator (V10_no_ledges).
"""
import math

import numpy as np
import trimesh
from matplotlib.path import Path
from manifold3d import CrossSection, FillRule

RES = 0.4              # mm per grid cell
CANTILEVER_MM = 1.0    # a flat overhang this short prints off the perimeter below it
DIRS = [(1, 0), (0, 1), (1, 1), (1, -1), (2, 1), (1, 2), (2, -1), (1, -2)]   # eight line directions through each point, each checked both ways


def _raster(polys, xs, ys):
    """Even-odd fill of a set of simple polygons on a grid (XOR of each polygon's inside)."""
    gx, gy = np.meshgrid(xs, ys)
    pts = np.c_[gx.ravel(), gy.ravel()]
    inside = np.zeros(len(pts), dtype=bool)
    for p in polys:
        if len(p) >= 3:
            inside ^= Path(np.asarray(p)).contains_points(pts)
    return inside.reshape(gy.shape)


def _steps_to(support, dy, dx, kmax):
    """For every cell, how many steps along (dy, dx) to the first support cell (inf if none within kmax)."""
    h, w = support.shape
    dist = np.full(support.shape, np.inf)
    for k in range(1, kmax + 1):
        oy, ox = dy * k, dx * k
        ys0, ys1 = max(0, -oy), min(h, h - oy)
        xs0, xs1 = max(0, -ox), min(w, w - ox)
        if ys0 >= ys1 or xs0 >= xs1:
            break
        hit = np.zeros(support.shape, dtype=bool)
        hit[ys0:ys1, xs0:xs1] = support[ys0 + oy:ys1 + oy, xs0 + ox:xs1 + ox]
        new = hit & np.isinf(dist)
        dist[new] = k
    return dist


def flat_regions(tm, exclusion_mm):
    """Connected flat downward regions above the first layers: [(z, CrossSection)]."""
    n, c = tm.face_normals, tm.triangles_center
    sel = np.where((n[:, 2] < -0.98) & (c[:, 2] > exclusion_mm))[0]
    if len(sel) == 0:
        return []
    idx = {f: k for k, f in enumerate(sel)}
    adj = [(idx[a], idx[b]) for a, b in tm.face_adjacency if a in idx and b in idx]
    out = []
    for g in trimesh.graph.connected_components(adj, nodes=np.arange(len(sel)), min_len=1):
        tris = tm.vertices[tm.faces[sel[g]]][:, :, :2]
        region = CrossSection([t[::-1].astype(float) for t in tris], FillRule.NonZero)
        if not region.is_empty() and region.area() > 0.05:
            out.append((float(c[sel[g], 2].mean()), region))
    return out


def ledges(tm, mani, max_bridge_mm=20.0, exclusion_mm=0.7):
    """Return (total ledge area in mm2, [{z_mm, area_mm2, at_mm}]) for the part. Needs the part as trimesh and as manifold."""
    found, total = [], 0.0
    kmax = int(math.ceil(max_bridge_mm / RES))
    for z, region in flat_regions(tm, exclusion_mm):
        x0, y0, x1, y1 = region.bounds()
        m = max_bridge_mm + 1.0
        xs = np.arange(x0 - m, x1 + m, RES)
        ys = np.arange(y0 - m, y1 + m, RES)
        R = _raster(region.to_polygons(), xs, ys)
        if not R.any():
            continue
        S = _raster(mani.slice(z - 0.1).to_polygons(), xs, ys) & ~R     # the solid just below the ceiling, outside the ceiling itself
        held = np.zeros(R.shape, dtype=bool)
        near = np.full(R.shape, np.inf)
        for dx, dy in DIRS:
            step = math.hypot(dx, dy) * RES
            a = _steps_to(S, dy, dx, kmax) * step
            b = _steps_to(S, -dy, -dx, kmax) * step
            held |= (a + b) <= max_bridge_mm + 2 * RES
            near = np.minimum(near, np.minimum(a, b))
        ledge = R & ~held & (near > CANTILEVER_MM)
        area = float(ledge.sum()) * RES * RES
        if area > 0:
            iy, ix = np.argwhere(ledge)[len(np.argwhere(ledge)) // 2]
            found.append({"z_mm": round(z, 2), "area_mm2": round(area, 1), "at_mm": [round(float(xs[ix]), 1), round(float(ys[iy]), 1)]})
            total += area
    return round(total, 1), sorted(found, key=lambda f: -f["area_mm2"])
