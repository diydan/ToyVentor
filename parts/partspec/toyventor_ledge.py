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
from manifold3d import CrossSection, FillRule, JoinType

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


def floating_contours(tm, mani, max_bridge_mm=20.0, exclusion_mm=0.7, low_z_mm=0.18, min_loop_mm=12.0, ledge_max_mm2=1.0):
    """OrcaSlicer-parity floating-cantilever gate (`V11_floating_contour`).

    Catches the two failure modes missed by area-only `V4`/`V6`/`V10`:
      1. `unanchored_hole_loop`: an interior hole loop (`perimeter >= min_loop_mm`, e.g. circular sockets cut into
         an elevated vault ceiling) with zero support in the layer below (`z - 0.12 mm`), forcing mid-air loops.
      2. `low_z_cantilever`: a flat downward face hovering in the `low_z_mm < z <= exclusion_mm` band (e.g. a stem
         hovering 0.40 mm off the bed) that is neither bridged on two sides nor within `CANTILEVER_MM` of support.
    """
    issues = []
    kmax = int(math.ceil(max_bridge_mm / RES))
    for z, region in flat_regions(tm, low_z_mm):
        if region.area() < 0.5:
            continue
        # 1. Check interior hole loops across all heights above the first layer (`z > low_z_mm`)
        sup_cs = mani.slice(max(0.02, z - 0.12)).offset(0.45, JoinType.Round)
        sup_paths = [Path(np.asarray(sp)) for sp in sup_cs.to_polygons() if len(sp) >= 3]
        for poly in region.to_polygons():
            pts = np.asarray(poly, dtype=float)
            if len(pts) < 3:
                continue
            s_area = 0.5 * float(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1]))
            if s_area >= 0.0:
                continue  # outer boundary of ceiling; interior holes have negative signed area
            perim = float(np.sum(np.linalg.norm(np.roll(pts, -1, axis=0) - pts, axis=1)))
            if perim < min_loop_mm:
                continue
            dense = []
            for i in range(len(pts)):
                p0, p1 = pts[i], pts[(i + 1) % len(pts)]
                seg_len = float(np.linalg.norm(p1 - p0))
                steps = max(1, int(math.ceil(seg_len / 0.5)))
                for s in range(steps):
                    dense.append(p0 + (p1 - p0) * (s / steps))
            dense_arr = np.asarray(dense)
            inside_sup = np.zeros(len(dense_arr), dtype=bool)
            for sp in sup_paths:
                inside_sup ^= sp.contains_points(dense_arr)
            if not inside_sup.any():
                issues.append({
                    "kind": "unanchored_hole_loop",
                    "z_mm": round(z, 2),
                    "perimeter_mm": round(perim, 2),
                    "at_mm": [round(float(v), 1) for v in pts.mean(axis=0)],
                })

        # 2. Check low-Z hovering flat cantilevers (`low_z_mm < z <= exclusion_mm`) skipped by V10
        if z <= exclusion_mm + 1e-6:
            x0, y0, x1, y1 = region.bounds()
            pad = max_bridge_mm + 1.0
            xs = np.arange(x0 - pad, x1 + pad, RES)
            ys = np.arange(y0 - pad, y1 + pad, RES)
            R = _raster(region.to_polygons(), xs, ys)
            if not R.any():
                continue
            S = _raster(mani.slice(max(0.02, z - 0.1)).to_polygons(), xs, ys) & ~R
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
            if area >= ledge_max_mm2:
                iy, ix = np.argwhere(ledge)[len(np.argwhere(ledge)) // 2]
                issues.append({
                    "kind": "low_z_cantilever",
                    "z_mm": round(z, 2),
                    "area_mm2": round(area, 1),
                    "at_mm": [round(float(xs[ix]), 1), round(float(ys[iy]), 1)],
                })
    return issues
