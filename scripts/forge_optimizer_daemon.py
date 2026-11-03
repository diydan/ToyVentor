#!/usr/bin/env python3
"""Persistent warm fast-preview + background-optimization daemon for dynamic/AI parts.

Security & reliability invariants:
1. Fail-closed print gates: `verify_preprint=True` is mandatory and cannot be disabled by
   any request field. Raw meshes failing V1-V10 degrade to `status="digital_only"` with
   `stl_artifact=None` and `slicer_recipe=None`.
2. Mandatory Recipe v1 clamps: slice count [2..16], coordinate bounds, and L1 overhang
   slope clamping (`<= 0.78 * dz`) always run unconditionally; there is no `legalize=false`.
3. Zero local file reads or path leaks: `stl_path` is never accepted over HTTP, errors use
   uniform client-safe messages, and responses expose only opaque content-addressed artifact
   names (`<part_id>.<hash12>.{glb,stl}`) stored inside an isolated cache directory
   (default `.forge-cache/`, never `public/kip/custom/`).
4. Timing-safe Bearer auth (`FORGE_OPTIMIZER_TOKEN` / `--token`): required whenever bound
   to a non-loopback address, and enforced via `hmac.compare_digest` whenever configured.
5. Bounded concurrency & queue backpressure: caps both active background jobs (`--max-queue`,
   returning `429 queue_full`) and concurrent HTTP handler threads (`--max-connections`,
   returning `503 busy`), dropping input buffers immediately once a job completes.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
import re
import socket
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
SDK_DIR = ROOT_DIR / "parts" / "kip" / "sdk"
KIP_DIR = ROOT_DIR / "parts" / "kip"
PARTSPEC_DIR = ROOT_DIR / "parts" / "partspec"

for _p in (str(SCRIPTS_DIR), str(SDK_DIR), str(KIP_DIR), str(PARTSPEC_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Warm imports at daemon startup (0 ms import penalty per request)
import kip_partspec_sdk as sdk  # type: ignore  # noqa: E402
import manifold3d  # noqa: E402
import numpy as np  # noqa: E402
import optimize_assets  # type: ignore  # noqa: E402

VALID_SLOTS = (
    "crown",
    "head",
    "back",
    "hand",
    "front",
    "hood",
    "roof",
    "rollbar",
    "spoiler",
    "exhaust",
)
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_STL_BYTES = 2_500_000
MAX_JOB_HISTORY = 256
ARTIFACT_NAME_RE = re.compile(
    r"^[a-z0-9_]{2,64}\.(?:[a-f0-9]{12}|[a-f0-9]{8}\.draft)\.(?:glb|stl)$"
)
JOB_ID_RE = re.compile(r"^fjob_[a-f0-9]{12}$")


def _finite_float(val: Any, name: str) -> float:
    f = float(val)
    if not math.isfinite(f):
        raise ValueError(f"{name} must be finite")
    return f


def sanitize_part_id(raw_id: Any, prefix_custom: bool = False) -> str:
    s = str(raw_id or "").strip().lower().replace("-", "_")
    s = re.sub(r"[^a-z0-9_]", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if len(s) < 2:
        s = f"part_{uuid.uuid4().hex[:8]}"
    if prefix_custom and not s.startswith("custom_"):
        s = f"custom_{s}"
    return s[:56]


def decode_stl_base64(raw_b64: Any) -> bytes:
    if not isinstance(raw_b64, str) or len(raw_b64) < 24:
        raise ValueError("invalid stl_base64")
    if len(raw_b64) > ((MAX_STL_BYTES + 2) // 3) * 4 + 64:
        raise ValueError("stl_base64 exceeds cap")
    try:
        data = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64") from exc
    if len(data) < 84 or len(data) > MAX_STL_BYTES:
        raise ValueError("decoded STL size out of bounds")
    return data


def legalize_loft_slices(raw_slices: Any) -> list[tuple[float, float, float, float, float, float]]:
    """Mandatory L1 legalizer: enforce 2..16 slices, finite bounds, and <= 0.78 * dz slope."""
    if not isinstance(raw_slices, list) or not (2 <= len(raw_slices) <= 16):
        raise ValueError("recipe.shape.slices must contain between 2 and 16 slices")

    parsed: list[list[float]] = []
    for s in raw_slices:
        if isinstance(s, dict):
            z = max(-20.0, min(140.0, _finite_float(s.get("z", 0.0), "z")))
            w = max(3.6, min(90.0, _finite_float(s.get("w", 16.0), "w")))
            d = max(3.6, min(90.0, _finite_float(s.get("d", 12.0), "d")))
            r = max(0.8, min(0.48 * min(w, d), _finite_float(s.get("r", 3.0), "r")))
            x = max(-35.0, min(35.0, _finite_float(s.get("x", 0.0), "x")))
            y = max(-35.0, min(35.0, _finite_float(s.get("y", 0.0), "y")))
        elif isinstance(s, (list, tuple)) and len(s) in (4, 6):
            z = max(-20.0, min(140.0, _finite_float(s[0], "z")))
            w = max(3.6, min(90.0, _finite_float(s[1], "w")))
            d = max(3.6, min(90.0, _finite_float(s[2], "d")))
            r = max(0.8, min(0.48 * min(w, d), _finite_float(s[3], "r")))
            x = max(-35.0, min(35.0, _finite_float(s[4], "x"))) if len(s) == 6 else 0.0
            y = max(-35.0, min(35.0, _finite_float(s[5], "y"))) if len(s) == 6 else 0.0
        else:
            raise ValueError("invalid loft slice")
        parsed.append([z, w, d, r, x, y])

    parsed.sort(key=lambda row: row[0])
    for i in range(1, len(parsed)):
        prev = parsed[i - 1]
        cur = parsed[i]
        if cur[0] <= prev[0] + 0.4:
            cur[0] = prev[0] + 0.5
        dz = cur[0] - prev[0]
        max_outward = 0.78 * dz
        max_w = min(90.0, prev[1] + 2.0 * max_outward)
        max_d = min(90.0, prev[2] + 2.0 * max_outward)
        if cur[1] > max_w:
            cur[1] = max_w
        if cur[2] > max_d:
            cur[2] = max_d
        cur[3] = max(0.8, min(0.48 * min(cur[1], cur[2]), cur[3]))

    return [(row[0], row[1], row[2], row[3], row[4], row[5]) for row in parsed]


# ---------------------------------------------------------------------------
# Symmetry (Dan, 2026-11-02: "check if there is symmetry and if so split in centers and make symmetrical").
# Most toy shapes are meant to be left-right symmetric, and a model's coordinates are never exactly even.
# A shape that overlaps its own mirror image by SYMMETRY_MIN_IOU or more is treated as meant-to-be-symmetric:
# it is split on its centre line and rebuilt from one half and that half's mirror. Below that it is left alone
# (a lightning bolt, a bent hat tip) and the job says so.
# ---------------------------------------------------------------------------
SYMMETRY_MIN_IOU = 0.93  # mirror overlap (intersection over union) that counts as "meant to be symmetric"
SYMMETRY_SNAP_X_MM = 1.0  # a centre line or loft slice offset this close to x = 0 is noise and snaps to 0
SYMMETRY_MAX_POINTS = 256  # the profile2d contract: 3 to 256 points (the check on `pts_raw` below, and the Worker's FORGE_MAX_PROFILE_POINTS)


def _mirror_x(cs: manifold3d.CrossSection, axis: float) -> manifold3d.CrossSection:
    return cs.translate((-axis, 0.0)).mirror((1.0, 0.0)).translate((axis, 0.0))


def _iou(a: manifold3d.CrossSection, b: manifold3d.CrossSection) -> float:
    union = (a + b).area()
    return float((a ^ b).area() / union) if union > 0.0 else 1.0


def _counter_clockwise(pts: list[tuple[float, float]]) -> tuple[list[tuple[float, float]], bool]:
    """`sdk.polygon_2d` fills counter-clockwise outlines only: a clockwise one builds an empty part without an error.
    Returns (points, whether they were reversed)."""
    area2 = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return (list(reversed(pts)), True) if area2 < 0.0 else (list(pts), False)


def _symmetrize_polygon(
    pts: list[tuple[float, float]],
) -> tuple[list[tuple[float, float]], dict[str, Any] | None]:
    """Split a profile on its vertical centre line and rebuild it from its larger half plus that half's mirror.
    Returns (points, note). The note is None when the profile is already symmetric."""
    cs = manifold3d.CrossSection([[(float(x), float(z)) for x, z in pts]])
    if cs.is_empty() or cs.area() < 1.0:
        return pts, None
    x0, _z0, x1, _z1 = cs.bounds()
    axis = 0.5 * (x0 + x1)
    if abs(axis) <= SYMMETRY_SNAP_X_MM:
        axis = 0.0
    iou = _iou(cs, _mirror_x(cs, axis))
    if iou >= 0.9995:
        return pts, None
    note: dict[str, Any] = {"kind": "profile2d", "axis_mm": round(axis, 2), "iou_before": round(iou, 3)}
    if iou < SYMMETRY_MIN_IOU:
        note["action"] = "kept_asymmetric"
        return pts, note
    big = 400.0
    right = cs ^ manifold3d.CrossSection.square((big, big)).translate((axis, -big / 2.0))
    left = cs ^ manifold3d.CrossSection.square((big, big)).translate((axis - big, -big / 2.0))
    keep, side = (right, "right") if right.area() >= left.area() else (left, "left")
    sym = keep + _mirror_x(keep, axis)
    out = sym
    eps = 0.02
    while out.num_vert() > SYMMETRY_MAX_POINTS and eps < 1.0:
        eps *= 1.6
        out = sym.simplify(eps)
    polys = out.to_polygons()
    if len(polys) != 1 or len(polys[0]) < 3 or len(polys[0]) > SYMMETRY_MAX_POINTS:
        note["action"] = "kept_asymmetric"
        note["why"] = "the mirrored profile is not one simple outline"
        return pts, note
    note["action"] = f"mirrored_{side}_half"
    note["iou_after"] = round(_iou(out, _mirror_x(out, axis)), 3)
    note["points"] = len(polys[0])
    return [(float(a), float(b)) for a, b in polys[0]], note


def _symmetrize_loft_rows(
    rows: list[tuple[float, float, float, float, float, float]],
) -> tuple[list[tuple[float, float, float, float, float, float]], dict[str, Any] | None]:
    """A loft is symmetric left to right when every slice is centred on x = 0. Offsets under 1 mm are noise and
    snap to 0; bigger ones are a deliberate lean (a bent hat tip) and stay, reported with the shape's mirror overlap."""
    mx = max((abs(r[4]) for r in rows), default=0.0)
    if mx < 1e-9:
        return rows, None
    body = sdk.loft_slabs(rows)
    both = [body, body.mirror((1.0, 0.0, 0.0))]
    inter = manifold3d.Manifold.batch_boolean(both, manifold3d.OpType.Intersect).volume()
    union = manifold3d.Manifold.batch_boolean(both, manifold3d.OpType.Add).volume()
    note: dict[str, Any] = {
        "kind": "loft",
        "max_x_offset_mm": round(mx, 2),
        "iou_before": round(float(inter / union) if union > 0 else 1.0, 3),
    }
    if mx <= SYMMETRY_SNAP_X_MM:
        note["action"] = "snapped_x_to_centre"
        return [(z, w, d, r, 0.0, y) for (z, w, d, r, _x, y) in rows], note
    note["action"] = "kept_asymmetric"
    return rows, note


# ---------------------------------------------------------------------------
# Feature ops (docs/specs/forge-ai-spec.md, "Recipe v1"): every number is clamped, nothing is rejected.
# The loft is one convex hull, so a brim, an ear, a horn or a row of points can only come from these.
# ---------------------------------------------------------------------------
AUTO_MINIMAL_FOR_OVERHANG = True  # `--no-auto-minimal` turns the none -> minimal promotion off
SLAB_THICKNESS_MM = 0.8  # `sdk.loft_slabs` default slab thickness
FEATURE_OPS = ("knob", "brim", "ears", "horns", "spikes", "snout", "hollow", "star", "ribs")
_EAR_STYLES = {
    # style: (height_mm, width_mm, tilt_deg) defaults; "round" is a flat disc, "pointy" a leaf, "tall" a bunny ear
    "round": (0.0, 11.0, 8.0),
    "pointy": (11.0, 9.0, 22.0),
    "tall": (22.0, 7.0, 12.0),
}
_SNOUT_STYLES = {
    # style: (length_mm, width_mm, height_mm, tip_width_frac, tip_radius_frac) defaults;
    # "muzzle" is a blunt dog/dino/bear snout, "beak" a narrow pointed one, "bill" a short wide duck bill
    "muzzle": (9.0, 12.0, 9.0, 0.75, 0.55),
    "beak": (10.0, 8.0, 11.0, 0.30, 0.15),
    "bill": (7.0, 18.0, 6.0, 0.90, 0.50),
}
SNOUT_MIN_SLOPE_DEG = 55.0  # the snout's underside should rise at least this steeply (from horizontal) to print without help
SNOUT_FALLBACK_SLOPE_DEG = 50.0  # tried when 55 does not fit; the gate's limit is 45, and the hull's facets wobble by a degree or two
SNOUT_ROOT_R = 0.8  # radius of the small root sphere the underside ramp ends in
SNOUT_ROOT_DEPTH = 1.2  # how far inside the wall its centre sits
SNOUT_ROOT_FLOOR_MM = 2.0  # its bottom stays at least this high, clear of the collar and the flare


def _clamp(val: Any, lo: float, hi: float, default: float, name: str) -> float:
    raw = default if val is None else val
    return max(lo, min(hi, _finite_float(raw, name)))


def _parse_feature(feat: dict[str, Any], slot: str) -> dict[str, Any] | None:
    """Clamp one feature to its bounds. Returns None when the op is unknown or not allowed on this slot."""
    op = str(feat.get("op", "")).lower()
    if op not in FEATURE_OPS:
        return None
    if op in ("knob", "brim") and slot == "head":
        return None  # `character_head` clips above the crown seat and flare-clips the sides: both would do nothing
    if op == "knob":
        return {"op": "knob", "radius_mm": _clamp(feat.get("radius_mm"), 1.8, 6.0, 3.2, "radius_mm")}
    if op == "brim":
        return {
            "op": "brim",
            "width_mm": _clamp(feat.get("width_mm"), 16.0, 42.0, 28.0, "width_mm"),
            "depth_mm": _clamp(feat.get("depth_mm"), 12.0, 32.0, 18.0, "depth_mm"),
            "thickness_mm": _clamp(feat.get("thickness_mm"), 1.6, 4.0, 2.2, "thickness_mm"),
        }
    if op == "ears":
        if slot not in ("head", "crown"):
            return None
        style = str(feat.get("style", "round")).lower()
        if style not in _EAR_STYLES:
            style = "round"
        h0, w0, t0 = _EAR_STYLES[style]
        return {
            "op": "ears",
            "style": style,
            "height_mm": _clamp(feat.get("height_mm"), 0.0, 26.0, h0, "height_mm") if style != "round" else 0.0,
            # round ears may be big (an elephant's flaps); the other styles stay narrow
            "width_mm": _clamp(feat.get("width_mm"), 5.0, 24.0 if style == "round" else 16.0, w0, "width_mm"),
            "thickness_mm": _clamp(feat.get("thickness_mm"), 2.4, 6.0, 3.6, "thickness_mm"),
            "tilt_deg": _clamp(feat.get("tilt_deg"), 0.0, 35.0, t0, "tilt_deg"),
            # where up the head the ear is rooted, as a fraction of its height (a head only): 0.84 is the top corner, 0.5 the
            # middle of the side (a monkey's or an elephant's ears). None keeps the top corner.
            "z_frac": _clamp(feat.get("z_frac"), 0.3, 0.9, 0.84, "z_frac") if feat.get("z_frac") is not None else None,
        }
    if op == "horns":
        if slot not in ("head", "crown"):
            return None
        return {
            "op": "horns",
            "length_mm": _clamp(feat.get("length_mm"), 8.0, 30.0, 18.0, "length_mm"),
            "base_mm": _clamp(feat.get("base_mm"), 3.0, 9.0, 6.0, "base_mm"),
            "curl": _clamp(feat.get("curl"), 0.0, 1.0, 0.6, "curl"),
        }
    if op == "snout":
        if slot != "head":
            return None
        style = str(feat.get("style", "muzzle")).lower()
        if style not in _SNOUT_STYLES:
            style = "muzzle"
        l0, w0, h0, _tw, _tr = _SNOUT_STYLES[style]
        return {
            "op": "snout",
            "style": style,
            "length_mm": _clamp(feat.get("length_mm"), 3.0, 16.0, l0, "length_mm"),
            "width_mm": _clamp(feat.get("width_mm"), 6.0, 22.0, w0, "width_mm"),
            "height_mm": _clamp(feat.get("height_mm"), 4.0, 16.0, h0, "height_mm"),
            "z_frac": _clamp(feat.get("z_frac"), 0.2, 0.65, 0.4, "z_frac"),
        }
    if op == "ribs":
        # vertical grooves round the sides of a head (a pumpkin, a melon, a beehive); the front stays smooth
        if slot != "head":
            return None
        return {
            "op": "ribs",
            "count": int(_clamp(feat.get("count"), 6, 12, 8, "count")),
            "depth_mm": _clamp(feat.get("depth_mm"), 0.8, 3.5, 2.4, "depth_mm"),
            "width_mm": _clamp(feat.get("width_mm"), 2.0, 6.0, 4.0, "width_mm"),
        }
    if op == "star":
        # a five-point star standing on the very top of a crown (a wizard hat's tip, a fairy's wand-top)
        if slot != "crown":
            return None
        return {
            "op": "star",
            "size_mm": _clamp(feat.get("size_mm"), 6.0, 16.0, 10.0, "size_mm"),
            "thickness_mm": _clamp(feat.get("thickness_mm"), 1.6, 3.6, 2.4, "thickness_mm"),
        }
    if op == "hollow":
        # an open-top pocket: a crown that is a ring, a chef hat or a pot that is a cup (crowns only)
        if slot != "crown":
            return None
        return {
            "op": "hollow",
            "wall_mm": _clamp(feat.get("wall_mm"), 1.6, 4.0, 2.4, "wall_mm"),
            "depth_mm": _clamp(feat.get("depth_mm"), 2.0, 20.0, 6.0, "depth_mm"),
        }
    # spikes: a row of points along x on top of a crown or back piece (the head top is the crown seat), or on a crown a
    # ring of points around its rim (`layout: "ring"`, which also hollows the top out into a ring)
    if slot not in ("crown", "back"):
        return None
    ring = slot == "crown" and str(feat.get("layout", "row")).strip().lower() == "ring"
    return {
        "op": "spikes",
        "layout": "ring" if ring else "row",
        "count": int(_clamp(feat.get("count"), 4 if ring else 2, 12 if ring else 7, 5, "count")),
        "height_mm": _clamp(feat.get("height_mm"), 3.0, 16.0, 7.0, "height_mm"),
        "base_mm": _clamp(feat.get("base_mm"), 3.0 if ring else 2.5, 9.0 if ring else 7.0, 5.0 if ring else 4.0, "base_mm"),
        "center_boost_mm": _clamp(feat.get("center_boost_mm"), 0.0, 6.0, 0.0, "center_boost_mm"),
        "wall_mm": _clamp(feat.get("wall_mm"), 1.6, 4.0, 2.4, "wall_mm"),
    }


def _half_width_at(body: manifold3d.Manifold, z: float) -> float:
    """Half the x extent of `body` at height z (0 when the body does not reach z)."""
    cs = body.slice(z)
    if cs.is_empty():
        return 0.0
    x0, _y0, x1, _y1 = cs.bounds()
    return max(0.0, min(abs(x0), abs(x1)))


def _mirror_pair(m: manifold3d.Manifold) -> manifold3d.Manifold:
    return m + m.mirror((1.0, 0.0, 0.0))


ROOT_RAMP_SLOPE = 1.7  # rise per run of an ear or horn root's ramp: 1.4 (54 degrees) left 1.3 to 1.8 mm2 on some sizes, over the gate's 1.0


def _root_fill(
    rb: float,
    x_root: float,
    z_root: float,
    hw: float,
    y_scale: float,
    hw_of: "Callable[[float], float] | None" = None,
) -> manifold3d.Manifold:
    """A teardrop under a root sphere, tangent to the body wall, so the root's underside is steep enough to print.
    Without it the sphere's lower half hangs off the wall and fails P1 (steeper than 45 degrees). A root moved well
    outside the wall gets a longer ramp (45 degrees plus). `hw_of(z)` is the body's half-width at height z: on a head
    that is 46 mm wide at the ear and 29 mm wide lower down, the ramp has to end inside the narrower wall, not at the
    width of the ear's own height (it hung 3 mm out of the wall and failed P1 with 7 to 10 mm2)."""
    r_low = 0.8 * rb if rb <= 7.5 else 6.0  # a big ear (an elephant's flap) gets a smaller ramp sphere that fits above the bed
    x_low = max(0.0, hw - r_low) - x_root
    # The ramp's outer edge is the tangent line from the big sphere's outer side to the small one's, so its run is the
    # centre distance plus the radius difference: measured from the centres alone it came out 43 degrees, not 52.
    depth = max(2.0 * rb, ROOT_RAMP_SLOPE * (-x_low + rb - r_low))
    if hw_of is not None:
        floor_depth = max(1.0, z_root - r_low - 3.0)  # the ramp's lowest sphere stays 3 mm above the bed (clear of the collar)
        for _ in range(3):
            # ...and the narrowest wall under the lowest sphere too: its bottom is r_low below its centre, where a head that
            # tapers in toward the collar is narrower still (the sphere stuck out 1.6 mm2 at z 8 on a 46 mm wide head)
            samples = [z_root - depth * f for f in (0.25, 0.5, 0.75, 1.0)] + [z_root - depth - r_low]
            hw_low = min(hw, *(hw_of(z) or hw for z in samples))
            x_low = max(0.0, hw_low - r_low) - x_root
            depth = min(max(2.0 * rb, ROOT_RAMP_SLOPE * (-x_low + rb - r_low)), floor_depth)
    drop = sdk.hull([sdk.sphere(rb, (0.0, 0.0, 0.0)), sdk.sphere(r_low, (x_low, 0.0, -depth))])
    return drop.scale((1.0, y_scale, 1.0)).translate((x_root, 0.0, z_root))


def _spikes_solid(
    rows: list[tuple[float, float, float, float, float, float]], feat: dict[str, Any], fs: float
) -> manifold3d.Manifold:
    """A row of points along x across the top slice. Vertical cones, so they print without help."""
    z, w, _d, _r, cx, cy = rows[-1]
    z_top = z + SLAB_THICKNESS_MM
    count = int(feat["count"])
    base = float(feat["base_mm"]) * fs
    height = float(feat["height_mm"]) * fs
    boost = float(feat["center_boost_mm"]) * fs
    span = max(0.0, w / 2.0 - base * 0.45)
    pts = []
    for i in range(count):
        t = i / (count - 1)
        x = cx - span + 2.0 * span * t
        h = height + boost * (1.0 - abs(2.0 * t - 1.0))
        pts.append(
            sdk.hull(
                [
                    sdk.sphere(base / 2.0, (x, cy, z_top - base * 0.15)),
                    sdk.sphere(max(0.4, base * 0.12), (x, cy, z_top + h)),
                ]
            )
        )
    return sdk.union(pts)


HOLLOW_MIN_FLOOR_MM = 4.0  # the pocket floor stays this far above the top of the crown pad (the socket seat is below)


def _hollow_pocket(
    body: manifold3d.Manifold, z_top: float, wall: float, depth: float
) -> manifold3d.Manifold | None:
    """An open-top pocket under the crown's top: the top outline inset by `wall`, `depth` deep. Open upward, so it prints
    without help. None when the wall leaves nothing or there is no room above the socket seat."""
    outline = body.slice(z_top - 0.3)
    if outline.is_empty():
        return None
    inner = outline.hull().offset(-wall, manifold3d.JoinType.Round)
    depth = min(depth, z_top - HOLLOW_MIN_FLOOR_MM)
    if inner.is_empty() or inner.area() < 6.0 or depth < 2.0:
        return None
    return manifold3d.Manifold.extrude(inner, depth + 3.0).translate((0.0, 0.0, z_top - depth))


def _ray_radii(poly: np.ndarray, cx: float, cy: float, thetas: np.ndarray) -> np.ndarray:
    """Distance from (cx, cy) along each angle in `thetas` to the outline `poly` (one convex outline round the centre)."""
    p = poly - np.array([cx, cy])
    e = np.roll(p, -1, axis=0) - p
    out = np.empty(len(thetas))
    for k, th in enumerate(thetas):
        d = np.array([math.cos(th), math.sin(th)])
        den = d[0] * e[:, 1] - d[1] * e[:, 0]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (p[:, 0] * e[:, 1] - p[:, 1] * e[:, 0]) / den
            u = (p[:, 0] * d[1] - p[:, 1] * d[0]) / den
        ok = (np.abs(den) > 1e-12) & (t > 0.0) & (u >= -1e-9) & (u <= 1.0 + 1e-9)
        out[k] = float(t[ok].min()) if ok.any() else float("nan")
    return out


def _ring_teeth(
    body: manifold3d.Manifold, z_top: float, feat: dict[str, Any], fs: float
) -> manifold3d.Manifold | None:
    """A crown's zigzag rim: `count` wide triangular points that touch their neighbours, standing on the wall of the
    round top (Dan, round 9: five thin thorns on a cup were "still not a crown", and "triangles are not smooth on seam
    to crown"). Each point is built straight, as a trapezoid with a flat 1 mm tip, then bent round the rim, so the
    rim is one smooth zigzag with no seam. The first point is at the front centre, so the crown is mirror symmetric."""
    outline = body.slice(z_top - 0.3)
    if outline.is_empty():
        return None
    wall = float(feat["wall_mm"])
    hull = outline.hull()
    # 0.1 mm inside the body's own wall (more than the simplify tolerance, or the step collapses into slivers)
    outer = hull.offset(-0.1, manifold3d.JoinType.Round)
    inner = hull.offset(-wall + 0.1, manifold3d.JoinType.Round)
    if outer.is_empty() or inner.is_empty():
        return None
    po, pi = np.asarray(outer.to_polygons()[0], dtype=float), np.asarray(inner.to_polygons()[0], dtype=float)
    x0, y0, x1, y1 = hull.bounds()
    cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
    height = float(feat["height_mm"]) * fs
    count = int(feat["count"])
    z_base, z_floor = -0.6, 0.3  # the points start 0.6 mm inside the wall; the valleys between them are 0.3 mm over it
    ov = 0.4  # neighbouring points overlap by this much along the rim
    teeth = []
    for k in range(count):
        a_k = -0.5 * math.pi + 2.0 * math.pi * k / count  # the first point at the front (-y)
        r_o, r_i = (float(_ray_radii(q, cx, cy, np.array([a_k]))[0]) for q in (po, pi))
        r_c = 0.5 * (r_o + r_i)
        half = math.pi * r_c / count  # half the arc one point takes up
        profile = manifold3d.CrossSection(
            [[(-half - ov, z_base), (half + ov, z_base), (half + ov, z_floor), (0.5, height), (-0.5, height), (-half - ov, z_floor)]]
        )
        band = manifold3d.Manifold.extrude(profile, 1.0).refine_to_length(1.5)

        def bend(v: np.ndarray, a_k: float = a_k, r_c: float = r_c) -> np.ndarray:
            s_, up, u = v[:, 0], v[:, 1], v[:, 2]  # along the rim, up, across the wall (0 inside, 1 outside)
            th = a_k + s_ / r_c
            ro, ri = _ray_radii(po, cx, cy, th), _ray_radii(pi, cx, cy, th)
            rad = ri + u * (ro - ri)
            return np.stack([cx + rad * np.cos(th), cy + rad * np.sin(th), z_top + up], axis=1)

        teeth.append(band.warp_batch(bend))
    crown = sdk.union(teeth).simplify(STUD_CUT_SIMPLIFY_MM)
    return crown if not crown.is_empty() else None


STAR_INNER_RATIO = 0.55  # inner radius / outer radius: a plump star, so no arm's underside is shallower than 45 degrees
STAR_EMBED_MM = 1.5  # how far the star's stem goes into the top of the hat


def _star_topper(rows: list[tuple[float, float, float, float, float, float]], feat: dict[str, Any], fs: float) -> manifold3d.Manifold:
    """An upright five-point star (in the x-z plane, facing the front) standing on top of the crown on a V-shaped stem.
    The star is plump (inner radius 0.55 of the outer one), which keeps the underside of each arm at 48 degrees or
    more; the stem fills the notch between the two lower legs and tapers at 54 degrees to a point that sits in the top
    of the hat, so nothing under the star is shallower than 45 degrees."""
    z, _w, _d, _r, cx, cy = rows[-1]
    z_top = z + SLAB_THICKNESS_MM
    R = 0.5 * float(feat["size_mm"]) * fs
    r = STAR_INNER_RATIO * R
    t = float(feat["thickness_mm"])
    leg_x, leg_z = R * math.cos(math.radians(234.0)), R * math.sin(math.radians(234.0))  # the lower left tip
    stem_depth = abs(leg_x) * 1.4  # the two inner edges of the lower legs fall 54 degrees from horizontal
    pts: list[tuple[float, float]] = []
    for k in range(5):
        a = math.radians(90.0 + 72.0 * k)
        pts.append((R * math.cos(a), R * math.sin(a)))
        b = math.radians(126.0 + 72.0 * k)
        # The inner vertex at the bottom (270 degrees) is pulled down into a point: that is the stem. Without it the two
        # lower legs have a shallow V-shaped underside (24 degrees), which does not print without support.
        pts.append((0.0, leg_z - stem_depth) if k == 2 else (r * math.cos(b), r * math.sin(b)))
    shape = manifold3d.CrossSection([pts]).simplify(0.01)
    c_z = z_top - STAR_EMBED_MM - (leg_z - stem_depth)  # the star's centre height: the stem's point is STAR_EMBED_MM into the hat
    solid = manifold3d.Manifold.extrude(shape, t).translate((0.0, 0.0, -0.5 * t))
    return solid.rotate((90.0, 0.0, 0.0)).translate((cx, cy, c_z)).simplify(STUD_CUT_SIMPLIFY_MM)


def _ears_or_horns_solid(
    op: str,
    slot: str,
    body: manifold3d.Manifold,
    rows: list[tuple[float, float, float, float, float, float]],
    feat: dict[str, Any],
    head_height_mm: float,
    fs: float,
    z_shift: float = 0.0,
    tilt_add: float = 0.0,
    x_shift: float = 0.0,
) -> manifold3d.Manifold | None:
    """A mirrored pair on the upper corners of the body. The root sits inside the body (clamped to its
    width at that height), so the pair always fuses with it; the tilt carries the tip clear of the crown pad.
    `z_shift` (negative = lower), `tilt_add` (degrees outward, ears only) and `x_shift` (mm further apart) let
    `_fit_head_pair` move a head's pair off the crown studs."""
    if slot == "head":
        zf = feat.get("z_frac") if op == "ears" else None
        z_root = (float(zf) * head_height_mm if zf is not None else head_height_mm - 5.0) + z_shift  # default: just under the crown seat
    else:
        z_lo, z_hi = float(rows[0][0]), float(rows[-1][0])
        z_root = z_hi - 0.12 * (z_hi - z_lo) if op == "ears" else z_lo + 0.62 * (z_hi - z_lo)
    hw = _half_width_at(body, z_root)
    if hw < 2.0:
        return None
    if op == "ears":
        width = float(feat["width_mm"]) * fs
        height = float(feat["height_mm"]) * fs
        thick = float(feat["thickness_mm"])
        rb = width / 2.0
        tip = {"round": rb, "pointy": max(0.9, rb * 0.28), "tall": max(1.4, rb * 0.7)}[str(feat["style"])]
        # an ear on the side of the head (z_frac given) stands mostly outside the wall, like a monkey's or an elephant's; one at
        # the top corner sits 35% into it, as before (the bear, bunny and cat were rated on that)
        x_root = (max(2.0, hw + 0.1 * rb) if zf is not None and str(feat["style"]) == "round" else max(2.0, hw - 0.35 * rb)) + x_shift
        ear = sdk.hull([sdk.sphere(rb, (0.0, 0.0, 0.0)), sdk.sphere(tip, (0.0, 0.0, height))])
        ear = ear.scale((1.0, thick / width, 1.0)).rotate((0.0, float(feat["tilt_deg"]) + tilt_add, 0.0))
        fill = _root_fill(rb, x_root, z_root, hw, thick / width, hw_of=lambda z: _half_width_at(body, z))
        return _mirror_pair((ear.translate((x_root, 0.0, z_root)) + fill).simplify(STUD_CUT_SIMPLIFY_MM))
    length = float(feat["length_mm"]) * fs
    rb = float(feat["base_mm"]) * fs / 2.0
    curl = float(feat["curl"])
    n = 6
    phi0 = math.radians(55.0)  # steeper than 45 degrees from the wall so the underside prints
    phi1 = phi0 + curl * math.radians(90.0 - 55.0)
    x_root = max(2.0, hw - 0.8 * rb) + x_shift
    px = pz = 0.0
    chain: list[tuple[float, float, float]] = []
    for k in range(n + 1):
        s = k / n
        chain.append((px, pz, max(0.9, rb * (1.0 - 0.85 * s))))
        ang = phi0 + (phi1 - phi0) * s
        px += (length / n) * math.cos(ang)
        pz += (length / n) * math.sin(ang)
    horn = sdk.union(
        [
            sdk.hull([sdk.sphere(r, (x_root + x, 0.0, z_root + z)) for (x, z, r) in chain[i : i + 2]])
            for i in range(n)
        ]
    )
    return _mirror_pair(horn + _root_fill(rb, x_root, z_root, hw, 1.0, hw_of=lambda z: _half_width_at(body, z)))


def _socket_keepout(head: manifold3d.Manifold) -> manifold3d.Manifold | None:
    """The neck-socket cavities of a built head, grown by 0.6 mm and extruded up through their roofs. Solids added
    after `character_head` (snout, ears, horns) are cut by this so they never fill or roof over a socket."""
    cs = head.slice(3.0)
    if cs.is_empty():
        return None
    holes = cs.hull() - cs
    if holes.is_empty():
        return None
    return manifold3d.Manifold.extrude(holes.offset(0.6, manifold3d.JoinType.Round), 10.0)


CROWN_SEAT_MARGIN_MM = 3.5  # clear space round the hat's whole 2x1 pad: 1.0 still "will block studs" (Dan, round 10: "move ears further apart"); the 26 mm round crown reaches 13.0 each side, a 30 mm hat 15
EAR_FIT_DROPS_MM = (0.0, 1.5, 3.0, 4.5, 6.0, 8.0, 10.0, -1.5, -3.0, -4.5, -6.0)  # how far down (or, negative, up) a head's ear or horn pair may move
EAR_FIT_TILTS_DEG = (0.0, 6.0, 12.0, 18.0)  # how far further out an ear may lean
EAR_FIT_SHIFTS_MM = (0.0, 1.5, 3.0, 4.5, 6.0, 7.5, 9.0)  # how far each side may move outward (the pair ends up twice as far apart)
# P1's own measure: a face whose underside is shallower than 45 degrees from horizontal. The check must count from z 1 up and
# the ramp must account for the sphere radii (see `_root_fill`), or it passes pairs the gate then rejects.
PAIR_STEEP_MAX_MM2 = 0.9  # the gate fails at 1.0
EAR_MIN_Z_MM = 3.0  # a pair's lowest point: below this it reaches the collar and the neck (G4 on the bed, I3 on the reference part)
OVERHANG_NZ = -0.7071
EAR_FIT_OVERHANG_MM2 = 0.8  # a placement that adds more than this much overhang is not used (a clean pair measures 0.6; 1.4 failed the gate at 1.8 after L2)
STUD_CUT_SIMPLIFY_MM = 0.03
EAR_FIT_MIN_KEPT = 0.3  # below this share of the asked-for visible volume the pair is reported as dropped


EAR_SLENDER_MAX = 2.4  # taller than this many widths, or taller than EAR_TALL_MAX_MM, and an ear snaps on a head
EAR_TALL_MAX_MM = 15.0
EAR_SLENDER_RATIO = 2.2  # the height a fragile ear is cut back to, in widths
EAR_MIN_WIDTH_MM = 8.0
EAR_MAX_TILT_FRAGILE = 3.0  # a fragile ear also stands up straight
HEAD_HORN_MIN_BASE_MM = 5.5  # a head's horn or antenna is at least this thick at its base


def _sturdy_head_ear(feat: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Dan, round 6, on the bunny: "looks fragile, not sure we need the bend, can we make shorter". A head ear that is
    tall and thin (over 15 mm, or over 2.4 widths) is cut back to at most 15 mm and 2.2 widths, widened to at least
    8 mm, and stood up straight. Ears that are already stout (the cat, the bear) are left exactly as asked."""
    if feat.get("op") == "horns":
        # Dan, round 8: "antenna are too thin" (the prompt told Spark base 3 mm for antennae)
        if float(feat["base_mm"]) >= HEAD_HORN_MIN_BASE_MM:
            return feat, None
        return dict(feat, base_mm=HEAD_HORN_MIN_BASE_MM), f"kept sturdy: base widened from {float(feat['base_mm']):g} to {HEAD_HORN_MIN_BASE_MM:g} mm"
    if feat.get("op") != "ears" or str(feat.get("style")) == "round":
        return feat, None
    h, w, tilt = float(feat["height_mm"]), float(feat["width_mm"]), float(feat["tilt_deg"])
    if h <= EAR_TALL_MAX_MM and h <= EAR_SLENDER_MAX * w:
        return feat, None
    w2 = max(w, EAR_MIN_WIDTH_MM)
    h2 = min(h, EAR_TALL_MAX_MM, EAR_SLENDER_RATIO * w2)
    t2 = min(tilt, EAR_MAX_TILT_FRAGILE)
    out = dict(feat, height_mm=h2, width_mm=w2, tilt_deg=t2)
    bits = [f"cut from {h:g} to {h2:g} mm tall"]
    if w2 != w:
        bits.append(f"widened from {w:g} to {w2:g} mm")
    if t2 != tilt:
        bits.append(f"stood up from {tilt:g} to {t2:g} degrees")
    return out, "kept sturdy: " + ", ".join(bits)


HEAD_TOPS = ("studs", "dome")
HEAD_DOME_MAX_MM = 5.0


def _domed_top(
    m: manifold3d.Manifold, conns: list[dict[str, Any]], height_mm: float
) -> tuple[manifold3d.Manifold, list[dict[str, Any]]]:
    """The no-studs head: cut the crown studs off and round the flat crown seat into an ellipsoidal dome that keeps
    the head's height. Above the start of the dome the head is rebuilt as the hull of its own outline shrinking to the
    apex, so it is smooth, convex and has no overhang. The `top_studs` connector goes with the studs."""
    x0, y0, x1, y1 = m.slice(height_mm - 1.0).bounds()
    dome_h = min(HEAD_DOME_MAX_MM, 0.9 * 0.5 * (y1 - y0))
    z0 = height_mm - dome_h
    # 0.03 mm inside the wall: an outline that coincides with the wall leaves hair-thin triangles at the seam
    outline = m.slice(z0).hull().offset(-0.03, manifold3d.JoinType.Round)
    cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
    below = m ^ manifold3d.Manifold.cube((400.0, 400.0, z0 + 50.0)).translate((-200.0, -200.0, -50.0))
    slabs = [manifold3d.Manifold.extrude(outline, 0.02).translate((0.0, 0.0, z0 - 0.5))]
    for deg in (0.0, 12.0, 24.0, 36.0, 48.0, 58.0, 68.0, 76.0, 83.0, 88.0):
        th = math.radians(deg)
        s = math.cos(th)
        cs = outline.translate((-cx, -cy)).scale((s, s)).translate((cx, cy))
        slabs.append(manifold3d.Manifold.extrude(cs, 0.02).translate((0.0, 0.0, z0 + dome_h * math.sin(th))))
    return below + sdk.hull(slabs), [c for c in conns if c.get("id") != "top_studs"]


RIB_Z_LOW_MM = 7.0  # grooves start above the neck sockets' roofs
RIB_Z_TOP_GAP_MM = 3.5  # and stop this far under the top of the head


def _rib_grooves(
    head: manifold3d.Manifold, feat: dict[str, Any], head_height_mm: float, fs: float
) -> manifold3d.Manifold | None:
    """Vertical grooves round the sides of a head, like the ribs of a pumpkin (Dan, round 10: the pumpkin was "blank").
    `count` grooves are spaced evenly from the front centre, which is skipped, so the front stays smooth for decals. Each
    follows the wall (the head tapers) as a chain of spheres that ends at the top in a point, so the groove's ceiling
    slopes 62 degrees and prints without help; the bottom end is an upward-facing floor."""
    count = int(feat["count"])
    r_g = 0.5 * float(feat["width_mm"]) * fs
    # A groove whose centre sits exactly on the wall meets the faceted loft wall at a graze and leaves hair-thin triangles
    # (40 zero-volume bodies), so the centre is at least 0.25 mm inside the wall.
    depth = max(float(feat["depth_mm"]) * fs, r_g + 0.25)
    z0 = RIB_Z_LOW_MM
    z_hi = head_height_mm - RIB_Z_TOP_GAP_MM
    if z_hi - z0 < 5.5 * r_g:  # a groove needs its pointed top (1.9 radii), a rounded floor and a little length between
        return None
    zs = [z0, 0.5 * (z0 + z_hi), z_hi - 1.9 * r_g]
    polys = []
    for z in zs:
        cs = head.slice(z)
        if cs.is_empty():
            return None
        hull = cs.hull()
        x0, y0, x1, y1 = hull.bounds()
        polys.append((np.asarray(hull.to_polygons()[0], dtype=float), 0.5 * (x0 + x1), 0.5 * (y0 + y1)))
    grooves = []
    for k in range(1, count):  # k = 0 is the front centre
        a = -0.5 * math.pi + 2.0 * math.pi * k / count
        centres = []
        for z, (poly, cx, cy) in zip(zs, polys):
            r = float(_ray_radii(poly, cx, cy, np.array([a]))[0])
            if not math.isfinite(r):
                return None
            rad = r + (r_g - depth)  # the groove's centre line sits r_g - depth outside the wall, so it cuts `depth` in
            centres.append((cx + rad * math.cos(a), cy + rad * math.sin(a), z))
        # the pointed top: a small sphere one cone-length above the last, still following the wall's slope
        (xa, ya, za), (xb, yb, zb) = centres[1], centres[2]
        t = 1.9 * r_g / max(zb - za, 1e-6)
        top = (xb + (xb - xa) * t, yb + (yb - ya) * t, zb + 1.9 * r_g)
        spheres = [sdk.sphere(r_g, c) for c in centres] + [sdk.sphere(0.45, top)]
        grooves.append(sdk.union([sdk.hull(spheres[i : i + 2]) for i in range(len(spheres) - 1)]))
    return sdk.union(grooves) if grooves else None


def _stud_keepout(head: manifold3d.Manifold, head_height_mm: float) -> manifold3d.Manifold | None:
    """The seat a hat needs on top of a head: the whole 2x1 crown pad footprint (24.4 x 11.9 mm, wider than the two
    studs it clips onto) plus a 1 mm margin, from the crown plane up past the pad's height. Dan, round 8: "ears will
    block studs" (on the Kip-sized heads the ears stood inside the pad column, where the hat's foot goes). One plain
    box: a rounded outline would leave hair-thin triangles on the cut face."""
    try:
        _, fh, foot = sdk.kp._crown_pad_2x1("small")
        fx0, fy0, _fz0, fx1, fy1, _fz1 = foot.bounding_box()
        pad_h = float(fh)
    except Exception:  # noqa: BLE001
        fx0, fy0, fx1, fy1, pad_h = -12.2, -5.95, 12.2, 5.95, 4.8
    m = CROWN_SEAT_MARGIN_MM
    x0, x1, y0, y1 = fx0 - m, fx1 + m, fy0 - m, fy1 + m
    return manifold3d.Manifold.cube((x1 - x0, y1 - y0, pad_h + 3.0)).translate((x0, y0, head_height_mm))


def _intersect_volume(a: manifold3d.Manifold, b: manifold3d.Manifold) -> float:
    return float(manifold3d.Manifold.batch_boolean([a, b], manifold3d.OpType.Intersect).volume())


def _overhang_area(m: manifold3d.Manifold, z_min: float = 6.0) -> float:
    """Area (mm2) of faces above z_min whose normal tilts down past 45 degrees from horizontal: what P1 rejects."""
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3]
    t = np.asarray(mesh.tri_verts)
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    n = np.cross(b - a, c - a)
    twice = np.linalg.norm(n, axis=1)
    nz = n[:, 2] / np.maximum(twice, 1e-12)
    zc = (a[:, 2] + b[:, 2] + c[:, 2]) / 3.0
    return float((0.5 * twice)[(nz < OVERHANG_NZ) & (zc > z_min)].sum())


def _fit_head_pair(
    op: str,
    body: manifold3d.Manifold,
    rows: list[tuple[float, float, float, float, float, float]],
    feat: dict[str, Any],
    head_height_mm: float,
    fs: float,
    studs: manifold3d.Manifold | None,
    head: manifold3d.Manifold | None = None,
    socket: manifold3d.Manifold | None = None,
) -> tuple[manifold3d.Manifold | None, dict[str, str] | None]:
    """Place a head's ear or horn pair so it clears the crown studs. A head's top is only about 18 to 20 mm wide and
    the studs fill most of it, so a pair rooted at the upper corners lands on them.

    Dan, round 5: "no cuts to the ears, just make the ears further apart". So the first pass looks for a placement
    that needs no cut at all: the pair as asked, then lower, leaning out, and moved further apart, cheapest change
    first, and it must still print (no new overhang) and keep the head out of the small-parts band that fails
    (31.75 to 34.9 mm wide). Only when no such placement exists does a second pass cut the pair by the stud keep-out.
    Returns (solid, note); the note says what moved."""
    base = _ears_or_horns_solid(op, "head", body, rows, feat, head_height_mm, fs)
    if base is None:
        return None, None
    if studs is None:
        studs = manifold3d.Manifold()  # no studs (the domed head): only the top-face rule for round ears applies

    def visible(m: manifold3d.Manifold) -> float:
        return float((m - body).volume())  # the part that shows outside the head

    def above_top_face(m: manifold3d.Manifold) -> bool:
        # Round ears sit on the side of the head, not above its top face (Dan, round 4).
        return op == "ears" and str(feat.get("style")) == "round" and m.bounding_box()[5] > head_height_mm - 0.2

    # The gate's own P1 measure (toyventor_parts.overhang_area, under 1.0 mm2) on the real head with the pair on it. The cheap
    # estimate above misjudged pairs by 0.5 to 1 mm2 (a larger head gave 1.2 mm2 for every candidate, yet some failed at 1.8).
    bare_steep = 0.0
    if head is not None:
        bare_steep = float(sdk.tp.overhang_area(sdk.tp.to_trimesh(head))[0])

    def steep_with(cand: manifold3d.Manifold) -> float:
        assert head is not None
        final = head + (cand - socket if socket is not None else cand)
        tm = sdk.tp.to_trimesh(final)
        # G1 and G3 fail on hair-thin triangles that export as zero-volume "bodies": count that as a failed candidate
        if not tm.is_watertight or len(tm.split(only_watertight=False)) != 1:
            return 1e9
        return float(sdk.tp.overhang_area(tm)[0])

    asked = visible(base)
    clear = _intersect_volume(base, studs) < 0.3 and not above_top_face(base)
    if asked < 1.0:
        return base, None  # nothing shows
    if clear and head is None:
        return base, None
    if clear and head is not None:
        # Already clear of the hat seat: keep it if it also prints, judged by the gate's own measure on the real head. A pair
        # on the side of the head (a monkey's or an elephant's ears) never touches the seat but can still have an overhang.
        if steep_with(base) < max(PAIR_STEEP_MAX_MM2, bare_steep + 0.05):
            return base, None
    x_small = (_small_cylinder_mm() - L2_MARGIN_MM) / 2.0  # a pair this narrow keeps the head a small part
    x_above = (_small_cylinder_mm() * 1.1) / 2.0 + 0.4  # a pair this wide puts it above the cylinder, clear of the marginal band
    tilts = EAR_FIT_TILTS_DEG if op == "ears" else (0.0,)
    # A placement may add no more overhang than the pair as asked has: even a clean pair measures 0.6 to 1.2 mm2 where it meets
    # the wall, and the figure grows with the head's size, so a fixed limit rejected every candidate on a larger head.
    ov_limit = max(EAR_FIT_OVERHANG_MM2, _overhang_area(base - body, z_min=1.0) + 0.15)

    def half_width_ok(m: manifold3d.Manifold, allow_wide: bool = True) -> bool:
        # Only the marginal band (31.75 to 34.9 mm across) fails the small-parts gate; a pair wider than it passes. The old
        # rule "never wider than asked" dropped the bear's ears on a head that widens downward, where lowering an ear
        # moves it outward (Dan, round 11: bear rated 1, no ears).
        x0, _y0, _z0, x1, _y1, _z1 = m.bounding_box()
        half = max(abs(x0), abs(x1))
        return half <= x_small or half >= x_above

    def describe(drop: float, tilt: float, shift: float, trimmed: bool) -> str:
        moved = []
        if drop > 0:
            moved.append(f"moved down {drop:g} mm")
        elif drop < 0:
            moved.append(f"moved up {-drop:g} mm")
        if shift > 0:
            moved.append(f"moved {2 * shift:g} mm further apart")
        if tilt > 0:
            moved.append(f"leaned out {tilt:g} degrees more")
        if trimmed:
            moved.append("trimmed where it met the crown studs")
        return ", ".join(moved)

    # Pass 1: no cut. Cheapest change first.
    combos = sorted(
        ((d, t, sh) for d in EAR_FIT_DROPS_MM for t in tilts for sh in EAR_FIT_SHIFTS_MM),
        key=lambda c: 0.02 * abs(c[0]) + 0.02 * c[1] + 0.02 * c[2],  # a lean costs as much as a move: no bend unless needed
    )
    # The pair as asked first; only when nothing prints at that size is it made 10, 20, 30 % smaller (a 22 mm elephant flap
    # on a 30 mm head cannot be held up without supports, a 15 mm one can).
    for scale in (1.0, 0.9, 0.8, 0.7):
        # each candidate costs a boolean and a mesh check, so a smaller pair is tried at its cheapest 60 placements only
        for drop, tilt, shift in (combos if scale == 1.0 else combos[:60]):
            cand = _ears_or_horns_solid(
                op, "head", body, rows, feat, head_height_mm, fs * scale, z_shift=-drop, tilt_add=tilt, x_shift=shift
            )
            if cand is None or above_top_face(cand) or not half_width_ok(cand) or cand.bounding_box()[2] < EAR_MIN_Z_MM:
                continue
            if _intersect_volume(cand, studs) > 0.3 or _overhang_area(cand - body, z_min=1.0) > ov_limit:
                continue
            kept = min(1.0, visible(cand) / asked)
            if kept < EAR_FIT_MIN_KEPT:
                continue
            if head is not None and steep_with(cand) >= max(PAIR_STEEP_MAX_MM2, bare_steep + 0.05):
                continue
            why = describe(drop, tilt, shift, False)
            if scale < 1.0:
                why = (why + ", " if why else "") + f"made {round((1.0 - scale) * 100)}% smaller so it prints without supports"
            return cand, {"op": op, "why": why, "kept_share": f"{kept:.2f}"}

    # Pass 2: nothing clears the studs without a cut. Keep the placement with the most ear showing, and cut it.
    best: tuple[float, float, float, manifold3d.Manifold, float, float] | None = None  # (score, drop, tilt, cut, kept, trimmed)
    for drop in EAR_FIT_DROPS_MM:
        for tilt in tilts:
            cand = _ears_or_horns_solid(op, "head", body, rows, feat, head_height_mm, fs, z_shift=-drop, tilt_add=tilt)
            if cand is None or not half_width_ok(cand) or above_top_face(cand) or cand.bounding_box()[2] < EAR_MIN_Z_MM:
                continue
            cut = cand - studs
            kept = min(1.0, visible(cut) / asked)
            trimmed = _intersect_volume(cand, studs) / asked
            score = kept - 0.5 * trimmed - 0.02 * abs(drop) - 0.005 * tilt  # a clean move beats a cut
            if best is None or score > best[0] + 1e-9:
                best = (score, drop, tilt, cut, kept, trimmed)
    if best is None:
        # Nothing clears the seat inside the limits. Losing the ears altogether is worse than ears that touch the hat's
        # seat (Dan, round 11: a bear with no ears scored 1), so the pair stays where it was asked, and the job says so.
        return base, {"op": op, "why": "no placement clears the hat seat inside the limits; left where asked"}
    _score, drop, tilt, cut, kept, trimmed = best
    # Drop pieces the cut left floating: a part that does not touch the body is a separate island.
    pieces = [c for c in cut.decompose() if _intersect_volume(c, body) > 0.5]
    solid = manifold3d.Manifold.batch_boolean(pieces, manifold3d.OpType.Add) if pieces else None
    if solid is not None:
        # The cut leaves hair-thin triangles that collapse to zero-volume "bodies" when the mesh is exported.
        solid = solid.simplify(STUD_CUT_SIMPLIFY_MM)
    if solid is None or kept < EAR_FIT_MIN_KEPT:
        return None, {"op": op, "why": "no room beside the crown studs; the part would be mostly cut away"}
    return solid, {"op": op, "why": describe(drop, tilt, 0.0, trimmed * asked > 0.3), "kept_share": f"{kept:.2f}"}


def _wall_y(body: manifold3d.Manifold, z: float) -> float | None:
    """The front (-y) wall of `body` at height z, or None when the body does not reach z."""
    cs = body.slice(z)
    if cs.is_empty():
        return None
    return float(cs.bounds()[1])


def _flat_front_half_width(body: manifold3d.Manifold, z: float) -> float:
    """Half the width of the flat part of the front wall at height z. A wider snout would hang its root spheres
    off the rounded corners, where the wall is further back, and print as floating islands."""
    cs = body.slice(z)
    if cs.is_empty():
        return 0.0
    x0, y0, x1, _y1 = cs.bounds()
    strip = manifold3d.CrossSection.square((x1 - x0 + 2.0, 0.05)).translate((x0 - 1.0, y0))
    inter = cs ^ strip  # in manifold3d `^` is intersection
    if inter.is_empty():
        return 0.0
    a, _b, c, _d = inter.bounds()
    return max(0.0, 0.5 * (c - a) - 0.5)


def _snout_root_y(body: manifold3d.Manifold, z_lo: float) -> float | None:
    """y of the snout's small root sphere at height z_lo: inside the wall at the sphere's centre and at its bottom
    (the wall leans, and a sphere bottom that sticks out of it shows up as a floating island in the first layers)."""
    walls = [_wall_y(body, z_lo), _wall_y(body, z_lo - SNOUT_ROOT_R)]
    if any(w is None for w in walls):
        return None
    return max(w for w in walls if w is not None) + SNOUT_ROOT_DEPTH


def _snout_ramp(
    body: manifold3d.Manifold, length: float, tip_r: float, z_top: float, y_ref: float, min_slope_deg: float
) -> tuple[float, float, float] | None:
    """Where the snout's printable underside lands. The top is flat at `z_top`; the underside is a ramp from the
    tip's bottom back to a small root sphere hidden just inside the wall, rising at least `min_slope_deg` from
    horizontal so it prints without supports. The wall leans (heads flare out from the collar), so the root sphere
    is anchored to the wall at its own height; a big sphere there would poke out under the ramp and fail P1.
    Returns (tip_y, tip_z, root_z), or None when the ramp would have to reach below the collar."""
    y_tip = y_ref - (length - tip_r)
    z_tip = z_top - tip_r
    min_slope = math.radians(min_slope_deg)
    z_lo = z_tip - tip_r
    while z_lo >= SNOUT_ROOT_FLOOR_MM + SNOUT_ROOT_R:
        y_root = _snout_root_y(body, z_lo)
        if y_root is not None:
            df = y_root - y_tip
            dz = z_tip - z_lo
            d = math.hypot(df, dz)
            slope = math.atan2(dz, df) + math.asin(max(-1.0, min(1.0, (SNOUT_ROOT_R - tip_r) / d)))
            if slope >= min_slope:
                return y_tip, z_tip, z_lo
        z_lo -= 0.25
    return None


def _snout_solid(
    body: manifold3d.Manifold,
    feat: dict[str, Any],
    head_height_mm: float,
    fs: float,
    info: dict[str, float] | None = None,
) -> manifold3d.Manifold | None:
    """A snout on the front (-y) of a head: a hull of a tip sphere and two root spheres at the wall.
    The head is clipped at z = height_mm, and the snout is added after `character_head` (like head ears) so
    its flare clip does not shave it back."""
    _l0, _w0, _h0, tip_w_frac, tip_r_frac = _SNOUT_STYLES[str(feat["style"])]
    length = float(feat["length_mm"]) * fs
    width = float(feat["width_mm"]) * fs
    height = float(feat["height_mm"]) * fs
    z_c = float(feat["z_frac"]) * head_height_mm
    r_up = min(height / 2.0, 4.5)
    z_top0 = min(z_c + height / 2.0, head_height_mm - 2.5)
    z_top0 = max(z_top0, 2.0 + 2.0 * r_up)  # the upper root sphere's bottom stays above the collar
    tip_r = max(0.9, tip_r_frac * height / 2.0)
    # A support-free underside rises at 55 degrees (50 as a fallback), so a snout of length L needs about 1.4 x L of wall
    # under its tip. Dan, round 10, on the dinosaur ("no snout"): the old code shortened a 14 mm snout to about 3 mm
    # rather than put it higher. Now the snout is first moved up the face (up to the top, 1.5 mm at a time) and only then
    # shortened.
    ramp = None
    length_used = length
    raised = 0.0
    z_top = z_top0
    y_ref = 0.0
    z_up = z_top0 - r_up
    width_cap = width
    cx = 0.0
    while length_used >= 3.0 and ramp is None:
        raise_mm = 0.0
        while z_top0 + raise_mm <= head_height_mm - 2.5:
            z_try = z_top0 + raise_mm
            z_up_try = z_try - r_up
            y_try = _wall_y(body, z_up_try)
            cs = body.slice(z_up_try)
            if y_try is None or cs.is_empty():
                raise_mm += 1.5
                continue
            for slope in (SNOUT_MIN_SLOPE_DEG, SNOUT_FALLBACK_SLOPE_DEG):
                ramp = _snout_ramp(body, length_used, tip_r, z_try, y_try, slope)
                if ramp is not None:
                    break
            if ramp is not None:
                z_top, z_up, y_ref, raised = z_try, z_up_try, y_try, raise_mm
                x0, _y0, x1, _y1 = cs.bounds()
                cx = 0.5 * (x0 + x1)
                width_cap = min(width, 1.7 * 0.5 * (x1 - x0))
                break
            raise_mm += 1.5
        if ramp is None:
            length_used -= 0.5
    if ramp is None or width_cap < 3.0:
        return None
    width = width_cap
    if info is not None:
        info.update({"length_asked": length, "length_used": length_used, "raised": raised})
    y_tip, z_tip, z_lo = ramp
    flat = min(_flat_front_half_width(body, z_up), _flat_front_half_width(body, z_lo))
    width = min(width, 2.0 * flat)
    if width < 3.0:
        return None

    def ball(r: float, y: float, z: float, half_w: float) -> manifold3d.Manifold:
        return sdk.sphere(r, (0.0, 0.0, 0.0)).scale((half_w / r, 1.0, 1.0)).translate((cx, y, z))

    root_up = ball(r_up, y_ref + r_up, z_up, width / 2.0)  # tangent to the wall, so its underside stays inside it
    root_lo = ball(SNOUT_ROOT_R, _snout_root_y(body, z_lo) or (y_ref + SNOUT_ROOT_DEPTH), z_lo, width / 2.0)
    tip = ball(tip_r, y_tip, z_tip, max(0.9, tip_w_frac * width / 2.0))
    return sdk.hull([root_up, root_lo, tip])


def compile_recipe_to_partspec(recipe: dict[str, Any]) -> dict[str, Any]:
    """Compile a JSON Recipe v1 object into a `kip_partspec_sdk.part_spec` (no eval/exec)."""
    slot = str(recipe.get("slot", "crown")).strip().lower()
    if slot not in VALID_SLOTS:
        raise ValueError("invalid slot")

    raw_policy = recipe.get("support_policy")
    if raw_policy is None:
        support_policy = "none"
    else:
        support_policy = str(raw_policy).strip().lower()
        if support_policy not in ("none", "minimal"):
            raise ValueError("invalid support_policy")
        if support_policy == "minimal" and slot not in ("crown", "head", "back"):
            raise ValueError("minimal support_policy is only allowed on crown, head, or back slots")

    part_id = sanitize_part_id(recipe.get("id") or recipe.get("name"), prefix_custom=True)
    name = str(recipe.get("name") or part_id).strip()[:80]
    stat = str(recipe.get("stat") or "Glow").strip()
    if stat not in sdk.VALID_STATS:
        stat = "Glow"
    behavior = str(recipe.get("behavior") or f"Custom {slot} accessory").strip()[:160]

    for field_val in (part_id, name, behavior):
        if sdk.FORBIDDEN_BRAND_RE.search(field_val):
            raise ValueError("forbidden brand term")

    shape = recipe.get("shape")
    if not isinstance(shape, dict):
        raise ValueError("recipe.shape must be an object")
    kind = str(shape.get("kind") or ("star2d" if slot == "hand" else "loft")).strip().lower()

    symmetry_note: dict[str, Any] | None = None
    profile_reversed = False
    # Pre-validate and legalize parameters eagerly before returning `part_spec`
    if slot == "hand":
        grip_tu = max(2, min(4, int(shape.get("grip_tu", 2))))
        if kind == "profile2d":
            pts_raw = shape.get("points")
            if not isinstance(pts_raw, list) or not (3 <= len(pts_raw) <= 256):
                raise ValueError("profile2d requires 3..256 points")
            pts_clamped = [
                (
                    max(-45.0, min(45.0, _finite_float(p[0], "px"))),
                    max(-45.0, min(90.0, _finite_float(p[1], "pz"))),
                )
                for p in pts_raw
                if isinstance(p, (list, tuple)) and len(p) == 2
            ]
            if len(pts_clamped) < 3:
                raise ValueError("invalid profile2d points")
            fillet_r = max(0.4, min(4.0, _finite_float(shape.get("fillet_r_mm", 1.2), "fillet_r_mm")))
            pts_clamped, profile_reversed = _counter_clockwise(pts_clamped)
            pts_clamped, symmetry_note = _symmetrize_polygon(pts_clamped)
        else:
            pts_clamped = []
            # 1.4 fails G1_watertight and G3_single_body on most stars (6 of 9 shapes tried);
            # 1.6 is what parts/kip/sdk/examples/example_star_wand.py uses and passes 8 of 9.
            fillet_r = 1.6
            n_pts = max(3, min(12, int(shape.get("points", 5))))
            r_out = max(10.0, min(28.0, _finite_float(shape.get("outer_r_mm", 18.0), "outer_r_mm")))
            r_in = max(5.0, min(r_out - 2.0, _finite_float(shape.get("inner_r_mm", r_out * 0.52), "inner_r_mm")))
        slices_legal: list[tuple[float, float, float, float, float, float]] = []
    else:
        slices_legal = legalize_loft_slices(shape.get("slices"))
        slices_legal, symmetry_note = _symmetrize_loft_rows(slices_legal)
        grip_tu = 2
        pts_clamped = []
        fillet_r = 1.2
        n_pts = 5
        r_out = 18.0
        r_in = 9.4

    raw_features = recipe.get("features") or []
    if not isinstance(raw_features, list) or len(raw_features) > 6:
        raise ValueError("recipe.features must be a list of at most 6 items")
    clean_features: list[dict[str, Any]] = []
    features_ignored: list[str] = []
    for feat in raw_features:
        if not isinstance(feat, dict):
            continue
        parsed_feat = _parse_feature(feat, slot)
        if parsed_feat is None:
            op_name = str(feat.get("op", "")).lower()
            if op_name:
                features_ignored.append(op_name)
        else:
            clean_features.append(parsed_feat)
    head_height_mm = max(24.0, min(38.0, _finite_float(shape.get("height_mm", 30.5), "height_mm")))
    # `studs` (default) is the brand head with its two crown buds and flat seat; `dome` has no studs and a rounded top.
    head_top = str(shape.get("top", "studs")).strip().lower()
    if head_top not in HEAD_TOPS:
        head_top = "studs"

    # A brim or a horn hangs in the air, and the support-free flare clip in the slot builders would
    # shave it back to a 41 degree cone. `minimal` keeps it, at the price of a few supports. This is a
    # print-plan decision, so it is reported on the job (`legalizer.support_policy_promoted`) and can be
    # switched off with `--no-auto-minimal`.
    support_policy_promoted = False
    if (
        AUTO_MINIMAL_FOR_OVERHANG
        and support_policy == "none"
        and slot in ("crown", "head", "back")
        and any(f["op"] in ("brim", "horns") for f in clean_features)
    ):
        support_policy = "minimal"
        support_policy_promoted = True

    # Ops the compiler accepted but could not build on this body (reported as `legalizer.features_dropped`).
    features_dropped: list[dict[str, str]] = []
    # Ops built, but moved or trimmed to fit (reported as `legalizer.features_adjusted`).
    features_adjusted: list[dict[str, str]] = []

    def build_for(
        rows: list[tuple[float, float, float, float, float, float]],
        fs: float = 1.0,
    ) -> tuple[manifold3d.Manifold, list[dict[str, Any]], dict[str, Any]]:
        """`fs` scales every feature's size (L2 passes the same factor it applies to the slices)."""
        features_dropped.clear()
        features_adjusted.clear()
        if slot == "hand":
            if kind == "profile2d":
                cs = sdk.polygon_2d(pts_clamped, fillet_r=fillet_r)
            else:
                cs = sdk.star_2d(points=n_pts, r_outer=r_out, r_inner=r_in, fillet_r=fillet_r)
            return sdk.handheld_prop(cs, grip_tu=grip_tu)

        body = sdk.loft_slabs(rows)
        hollow_feat: dict[str, Any] | None = None
        ring_spikes: dict[str, Any] | None = None
        ribs_feat: dict[str, Any] | None = None
        after_builder: list[manifold3d.Manifold] = []  # head snout: `character_head` clips above the seat
        head_pairs: list[dict[str, Any]] = []  # head ears and horns, placed once the crown studs exist
        for feat in clean_features:
            op = feat["op"]
            if op == "knob":
                kr = float(feat["radius_mm"]) * fs
                top_z = float(rows[-1][0]) + kr * 0.65
                body = body + sdk.sphere(kr, (float(rows[-1][4]), float(rows[-1][5]), top_z))
            elif op == "brim":
                bw = float(feat["width_mm"]) * fs
                bd = float(feat["depth_mm"]) * fs
                bt = float(feat["thickness_mm"])
                if support_policy == "minimal":
                    body = body + sdk.wide_brim(bw, bd, thickness_mm=bt, z=0.0)
                else:
                    body = body + sdk.rounded_slab(bw, bd, bt, r=min(bw, bd) * 0.35, z=1.5)
            elif op == "spikes":
                if feat.get("layout") == "ring":
                    ring_spikes = feat  # built after the pocket, from the finished top outline
                else:
                    body = body + _spikes_solid(rows, feat, fs)
            elif op == "hollow":
                hollow_feat = feat
            elif op == "ribs":
                ribs_feat = feat
            elif op == "star":
                body = body + _star_topper(rows, feat, fs)
            elif op == "snout":
                snout_info: dict[str, float] = {}
                snout = _snout_solid(body, feat, head_height_mm, fs, snout_info)
                if snout is not None:
                    after_builder.append(snout)
                    bits = []
                    if snout_info.get("raised", 0.0) > 0.0:
                        bits.append(f"moved up {snout_info['raised']:g} mm so a support-free ramp fits")
                    if snout_info.get("length_used", 0.0) < snout_info.get("length_asked", 0.0) - 0.4:
                        bits.append(f"shortened from {snout_info['length_asked']:g} to {snout_info['length_used']:g} mm")
                    if bits:
                        features_adjusted.append({"op": "snout", "why": ", ".join(bits)})
                else:
                    features_dropped.append(
                        {"op": "snout", "why": "no printable underside fits this front wall; keep the head's front upright (depth d about 12 to 16, y offsets 0)"}
                    )
            elif op in ("ears", "horns"):
                if slot == "head":
                    head_pairs.append(feat)
                    continue
                solid = _ears_or_horns_solid(op, slot, body, rows, feat, head_height_mm, fs)
                if solid is None:
                    features_dropped.append({"op": op, "why": "the body is too narrow where this op attaches"})
                else:
                    body = body + solid

        if slot == "crown":
            if hollow_feat is not None or ring_spikes is not None:
                # A ring of points implies a hollow top: a crown is a ring, not a cone with bumps.
                wall = float((hollow_feat or ring_spikes or {}).get("wall_mm", 2.4))
                depth = float(hollow_feat["depth_mm"]) if hollow_feat is not None else 6.0
                z_top = float(rows[-1][0]) + SLAB_THICKNESS_MM
                pocket = _hollow_pocket(body, z_top, wall, depth)
                if pocket is None:
                    features_dropped.append({"op": "hollow", "why": "the top is too small or too low to hollow out (needs a wall of %.1f mm and 4 mm above the socket seat)" % wall})
                else:
                    body = (body - pocket).simplify(STUD_CUT_SIMPLIFY_MM)  # the carve leaves hair-thin triangles
                if ring_spikes is not None:
                    teeth = _ring_teeth(body, z_top, ring_spikes, fs)
                    if teeth is None:
                        features_dropped.append({"op": "spikes", "why": "no room for a ring of points on this top"})
                    else:
                        body = (body + teeth).simplify(STUD_CUT_SIMPLIFY_MM)
            return sdk.crown_addon(body, support_policy=support_policy)
        if slot == "head":
            m, conns, ex = sdk.character_head(body, height_mm=head_height_mm, support_policy=support_policy)
            if head_top == "dome":
                m, conns = _domed_top(m, conns, head_height_mm)
            if ribs_feat is not None:
                grooves = _rib_grooves(m, ribs_feat, head_height_mm, fs)
                if grooves is None:
                    features_dropped.append({"op": "ribs", "why": "no room for grooves on this head (it needs about 14 mm of wall between the sockets and the top)"})
                else:
                    m = (m - grooves).simplify(STUD_CUT_SIMPLIFY_MM)
            socket_keepout = _socket_keepout(m)
            if head_pairs:
                # With studs, ears and horns keep off them; on the domed head there are none to avoid.
                studs = _stud_keepout(m, head_height_mm) if head_top == "studs" else None
                for feat in head_pairs:
                    feat, sturdy = _sturdy_head_ear(feat)
                    solid, note = _fit_head_pair(
                        feat["op"], body, rows, feat, head_height_mm, fs, studs, head=m, socket=socket_keepout
                    )
                    if solid is None:
                        features_dropped.append(
                            note or {"op": feat["op"], "why": "the body is too narrow where this op attaches"}
                        )
                    else:
                        after_builder.append(solid)
                        why = "; ".join(t for t in (sturdy, note["why"] if note else None) if t)
                        if why:
                            entry = {"op": feat["op"], "why": why}
                            if note and "kept_share" in note:
                                entry["kept_share"] = note["kept_share"]
                            features_adjusted.append(entry)
            if after_builder:
                keepout = socket_keepout
                for solid in after_builder:
                    m = m + (solid - keepout if keepout is not None else solid)
            return m, conns, ex
        if slot == "back":
            return sdk.backpack_addon(body, support_policy=support_policy)
        return sdk.vehicle_addon(body, slot=slot)

    def build_fn() -> tuple[manifold3d.Manifold, list[dict[str, Any]], dict[str, Any]]:
        return build_for(slices_legal)

    spec = sdk.part_spec(
        id=part_id,
        name=name,
        stat=stat,
        behavior=behavior,
        slot=slot,
        support_policy=support_policy,
        fn=build_fn,
    )
    if slot == "hand" and (symmetry_note is not None or profile_reversed):
        spec["legalizer_notes"] = {}
        if symmetry_note is not None:
            spec["legalizer_notes"]["symmetry"] = symmetry_note
        if profile_reversed:
            spec["legalizer_notes"]["profile2d_reversed"] = True  # the points ran clockwise; they were turned round
    if slot != "hand":
        # What the L1/L3 clamps changed (they used to be silent), plus what L2 needs to rebuild.
        spec["legalizer_notes"] = _legalizer_notes(
            shape.get("slices"), slices_legal, skip_x=bool(symmetry_note and symmetry_note.get("action") == "snapped_x_to_centre")
        )
        if symmetry_note is not None:
            spec["legalizer_notes"]["symmetry"] = symmetry_note
        if support_policy_promoted:
            spec["legalizer_notes"]["support_policy_promoted"] = "none->minimal"
        if features_ignored:
            spec["legalizer_notes"]["features_ignored"] = features_ignored

        def rebuild(rows: list[tuple[float, float, float, float, float, float]], fs: float = 1.0) -> dict[str, Any]:
            return sdk.part_spec(
                id=part_id,
                name=name,
                stat=stat,
                behavior=behavior,
                slot=slot,
                support_policy=support_policy,
                fn=lambda: build_for(rows, fs),
            )

        spec["_l2"] = {"slot": slot, "rows": slices_legal, "rebuild": rebuild}
        spec["_features_dropped"] = features_dropped  # filled by the build; the job copies it into `legalizer`
        spec["_features_adjusted"] = features_adjusted
    return spec


_SLICE_DEFAULTS = {"z": 0.0, "w": 16.0, "d": 12.0, "r": 3.0, "x": 0.0, "y": 0.0}


def _legalizer_notes(
    raw: Any, rows: list[tuple[float, float, float, float, float, float]], skip_x: bool = False
) -> dict[str, Any]:
    """List what the L1 slope clamp and L3 bounds changed, so the eval can count them. `skip_x` leaves out the x
    offsets the symmetry step snapped to the centre line; those are reported under `symmetry` instead."""
    if not isinstance(raw, list):
        return {}
    try:
        ordered = sorted((s for s in raw if isinstance(s, dict)), key=lambda s: float(s.get("z", 0.0)))
    except (TypeError, ValueError):
        return {}
    changes: list[dict[str, Any]] = []
    for i, (s, row) in enumerate(zip(ordered, rows)):
        for j, key in enumerate(("z", "w", "d", "r", "x", "y")):
            if skip_x and key == "x":
                continue
            try:
                before = float(s.get(key, _SLICE_DEFAULTS[key]))
            except (TypeError, ValueError):
                continue
            if abs(before - row[j]) > 1e-6:
                changes.append({"index": i, "field": key, "from": round(before, 3), "to": round(row[j], 3)})
    return {"l1_l3_changed": len(changes), "l1_l3_changes": changes[:12]}


# ---------------------------------------------------------------------------
# L2: move a marginal small-parts size out of the band (docs/specs/forge-ai-spec.md, "L2")
# ---------------------------------------------------------------------------
# The gate calls a part `marginal` (and fails it) between the small-parts cylinder diameter and
# diameter * (1 + marginal_pct / 100). Both numbers come from interfaces.json; nothing here
# restates them. L2 only runs after the gate has said `marginal`, so other jobs pay nothing.
L2_ENABLED = True
L2_MIN_SCALE = 0.6  # never shrink the part above its base by more than 40%
L2_MARGIN_MM = 0.75  # aim this far under the cylinder diameter, not at its edge
L2_BISECT_STEPS = 5


def _small_cylinder_mm() -> float:
    return float(sdk.tp.IF["safety"]["small_parts_cylinder"]["diameter_mm"])


def _measure_small(spec: dict[str, Any]) -> dict[str, Any]:
    """The gate's own small-parts measure (toyventor_parts.evaluate), without the other checks."""
    m, _conns, extras = spec["fn"]()
    rot = dict(extras or {}).get("print_rotation_deg")
    mp = m
    if rot:
        mp = m.rotate(tuple(rot))
        mp = mp.translate((0, 0, -mp.bounding_box()[2]))
    return sdk.tp.small_part_status(sdk.tp.to_trimesh(mp))


def _l2_candidate(
    rows: list[tuple[float, float, float, float, float, float]], path: str, f: float
) -> list[tuple[float, float, float, float, float, float]]:
    """Shrink everything above the base slice: `height` scales z, `xy` scales w, d, r, x, y, `both` does both.
    Slice 0 stays put so the part still seats on its pad. L1 and L3 run again on the result."""
    z0 = rows[0][0]
    out: list[dict[str, float]] = []
    for i, (z, w, d, r, x, y) in enumerate(rows):
        if i == 0:
            out.append({"z": z, "w": w, "d": d, "r": r, "x": x, "y": y})
            continue
        k = f if path in ("xy", "both") else 1.0
        nz = z0 + (z - z0) * f if path in ("height", "both") else z
        out.append({"z": nz, "w": w * k, "d": d * k, "r": r * k, "x": x * k, "y": y * k})
    return legalize_loft_slices(out)


L2_MAX_GROW = 1.25  # a head may grow at most 25% to clear the marginal band
L2_GROW_BIAS = 1.3  # grow when its change is under 1.3 x the shrink's: heads were too narrow, not too wide
L2_GROW_MARGIN_MM = 0.4  # aim this far over the band's upper edge (cylinder x 1.10), not at it


def l2_rescale(spec: dict[str, Any], measured_mm: float | None = None) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Move a marginal part out of the small-parts band by the smaller change: shrink it under the cylinder, or (heads
    only) grow it past the band's upper edge (cylinder x 1.10), whichever changes it less (growing wins up to 1.3 x the
    size of the shrink). Growing is for the Kip-sized
    heads: one measuring 34.8 mm sits 0.1 mm under the band's top, and shrinking it 11% to 31 mm would undo its size.

    Heads never shrink in height: `character_head` puts the crown studs at z = height_mm, so a
    shorter body leaves them floating. Returns (rebuilt spec or None, note for the job response)."""
    ctx = spec.get("_l2")
    t0 = time.perf_counter()
    if not ctx:
        return None, {"applied": False, "reason": "L2 only handles loft slots"}
    target = _small_cylinder_mm() - L2_MARGIN_MM
    target_hi = _small_cylinder_mm() * 1.10 + L2_GROW_MARGIN_MM
    rows0 = ctx["rows"]
    paths = ("xy",) if ctx["slot"] == "head" else ("height", "xy", "both")
    evals = 0

    def diameter(rows: list[tuple[float, float, float, float, float, float]], fs: float) -> float:
        nonlocal evals
        evals += 1
        return float(_measure_small(ctx["rebuild"](rows, fs))["min_enclosing_diameter_mm"])

    def finish(path: str, f: float, d_after: float, direction: str) -> tuple[dict[str, Any], dict[str, Any]]:
        fs = f if path in ("xy", "both") else 1.0
        rows = _l2_candidate(rows0, path, f)
        new_spec = ctx["rebuild"](rows, fs)
        new_spec["legalizer_notes"] = dict(spec.get("legalizer_notes") or {})
        new_spec["_features_dropped"] = spec.get("_features_dropped") or []
        new_spec["_features_adjusted"] = spec.get("_features_adjusted") or []
        new_spec["_l2"] = {**ctx, "rows": rows}
        return new_spec, {
            "applied": True,
            "path": path,
            "direction": direction,
            "scale": round(f, 3),
            "from_mm": measured_mm,
            "to_mm": round(d_after, 2),
            "target_mm": round(target if direction == "shrink" else target_hi, 2),
            "evals": evals,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        }

    for path in paths:
        try:
            # Features (brim, ears, horns, points) scale with the slices; a height-only shrink leaves them alone.
            fs_of = (lambda f: f) if path in ("xy", "both") else (lambda f: 1.0)
            shrink: tuple[float, float] | None = None
            lo, hi = L2_MIN_SCALE, 1.0
            d_lo = diameter(_l2_candidate(rows0, path, lo), fs_of(lo))
            if d_lo <= target:  # else even the full shrink does not clear the band on this path
                for _ in range(L2_BISECT_STEPS):
                    mid = (lo + hi) / 2
                    d_mid = diameter(_l2_candidate(rows0, path, mid), fs_of(mid))
                    if d_mid <= target:
                        lo, d_lo = mid, d_mid
                    else:
                        hi = mid
                shrink = (lo, d_lo)
            grow: tuple[float, float] | None = None
            if ctx["slot"] == "head" and path == "xy":
                g_lo, g_hi = 1.0, L2_MAX_GROW
                d_hi = diameter(_l2_candidate(rows0, path, g_hi), fs_of(g_hi))
                if d_hi >= target_hi:
                    for _ in range(L2_BISECT_STEPS):
                        mid = (g_lo + g_hi) / 2
                        d_mid = diameter(_l2_candidate(rows0, path, mid), fs_of(mid))
                        if d_mid >= target_hi:
                            g_hi, d_hi = mid, d_mid
                        else:
                            g_lo = mid
                    grow = (g_hi, d_hi)
            if grow is not None and (shrink is None or grow[0] - 1.0 < L2_GROW_BIAS * (1.0 - shrink[0])):
                return finish(path, grow[0], grow[1], "grow")
            if shrink is not None:
                return finish(path, shrink[0], shrink[1], "shrink")
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[forge-optimizer] L2 path {path} failed: {exc}\n")
            continue
    return None, {
        "applied": False,
        "reason": "no shrink of at most 40% (or growth of at most 25%) cleared the band",
        "evals": evals,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


def build_print_pose_manifold(spec: dict[str, Any]) -> manifold3d.Manifold:
    m, _, extras = spec["fn"]()
    rot = (extras or {}).get("print_rotation_deg")
    if rot:
        m = m.rotate(tuple(rot))
        m = m.translate((0.0, 0.0, -float(m.bounding_box()[2])))
    return optimize_assets.snap_manifold_to_bed(m)


class OptimizerJobManager:
    def __init__(self, out_dir: Path, workers: int = 2, max_queue: int = 8) -> None:
        self.out_dir = out_dir.resolve()
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.max_queue = max(1, max_queue)
        self._pool = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="forge-opt")
        self._lock = threading.Lock()
        self._jobs: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def _active_unlocked(self) -> int:
        return sum(1 for j in self._jobs.values() if j["status"] in ("queued", "validating", "optimizing"))

    def active_count(self) -> int:
        with self._lock:
            return self._active_unlocked()

    def has_capacity(self) -> bool:
        with self._lock:
            return self._active_unlocked() < self.max_queue

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            j = self._jobs.get(job_id)
            return dict(j) if j is not None else None

    def resolve_artifact(self, name: str) -> Path | None:
        if not ARTIFACT_NAME_RE.match(name):
            return None
        candidate = (self.out_dir / name).resolve()
        if candidate.parent != self.out_dir or not candidate.is_file():
            return None
        return candidate

    def _update_job(self, job_id: str, **patch: Any) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(patch)
                self._jobs[job_id]["updated_at"] = round(time.time(), 3)

    def try_enqueue(
        self,
        *,
        part_id: str,
        slot: str | None,
        support_policy: str = "none",
        compiled_spec: dict[str, Any] | None = None,
        stl_bytes: bytes | None = None,
    ) -> str | None:
        job_id = f"fjob_{uuid.uuid4().hex[:12]}"
        now = round(time.time(), 3)
        record: dict[str, Any] = {
            "job_id": job_id,
            "part_id": part_id,
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "stl_artifact": None,
            "glb_artifact": None,
            "content_hash": None,
            "slicer_recipe": None,
            "metrics": None,
            "gate_report": None,
            "legalizer": None,
            "error": None,
            "elapsed_ms": None,
        }
        with self._lock:
            if self._active_unlocked() >= self.max_queue:
                return None
            self._jobs[job_id] = record
            while len(self._jobs) > MAX_JOB_HISTORY:
                oldest_id, oldest = next(iter(self._jobs.items()))
                if oldest["status"] in ("queued", "validating", "optimizing"):
                    break
                self._jobs.pop(oldest_id, None)

        self._pool.submit(
            self._run_job, job_id, part_id, slot, support_policy, compiled_spec, stl_bytes
        )
        return job_id

    def _run_job(
        self,
        job_id: str,
        part_id: str,
        slot: str | None,
        support_policy: str,
        compiled_spec: dict[str, Any] | None,
        stl_bytes: bytes | None,
    ) -> None:
        t0 = time.perf_counter()
        try:
            self._update_job(job_id, status="validating")
            if compiled_spec is not None:
                legalizer: dict[str, Any] = dict(compiled_spec.get("legalizer_notes") or {})
                # Run SDK validation inside an isolated temp dir so canonical filenames
                # (`custom_wizard_hat.*`) can never collide across jobs or overwrite static files.
                with tempfile.TemporaryDirectory(prefix="tv-job-", dir=str(self.out_dir)) as tmp_job_dir:
                    res = sdk.validate_and_export(
                        compiled_spec,
                        out_dir=tmp_job_dir,
                        optimize=True,
                        export_web_on_fail=True,
                    )
                    if L2_ENABLED and res["small_part"]["status"] == "marginal" and compiled_spec.get("_l2"):
                        # L2: only when the gate has just said `marginal`. Rescale, then gate again.
                        new_spec, l2_note = l2_rescale(compiled_spec, res["small_part"].get("min_enclosing_diameter_mm"))
                        legalizer["l2"] = l2_note
                        if new_spec is not None:
                            compiled_spec = new_spec
                            res = sdk.validate_and_export(
                                compiled_spec,
                                out_dir=tmp_job_dir,
                                optimize=True,
                                export_web_on_fail=True,
                            )
                    if compiled_spec.get("_features_dropped"):
                        legalizer["features_dropped"] = [dict(d) for d in compiled_spec["_features_dropped"]]
                    if compiled_spec.get("_features_adjusted"):
                        legalizer["features_adjusted"] = [dict(d) for d in compiled_spec["_features_adjusted"]]
                    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                    opt_info = res.get("optimization") or {}
                    c_hash = opt_info.get("content_hash")
                    stl_artifact: str | None = None
                    glb_artifact: str | None = None

                    if res["ok"] and c_hash and res.get("stl_file") and res.get("glb_file"):
                        stl_artifact = f"{compiled_spec['id']}.{c_hash}.stl"
                        glb_artifact = f"{compiled_spec['id']}.{c_hash}.glb"
                        (self.out_dir / stl_artifact).write_bytes(Path(res["stl_file"]).read_bytes())
                        (self.out_dir / glb_artifact).write_bytes(Path(res["glb_file"]).read_bytes())
                    elif res.get("glb_file") and Path(res["glb_file"]).exists():
                        glb_raw = Path(res["glb_file"]).read_bytes()
                        glb_artifact = f"{compiled_spec['id']}.{job_id[-8:]}.draft.glb"
                        (self.out_dir / glb_artifact).write_bytes(glb_raw)

                self._update_job(
                    job_id,
                    part_id=compiled_spec["id"],
                    status="print_ready" if res["ok"] else "digital_only",
                    stl_artifact=stl_artifact,
                    glb_artifact=glb_artifact,
                    content_hash=c_hash if res["ok"] else None,
                    slicer_recipe=res.get("slicer_recipe") if res["ok"] else None,
                    metrics=opt_info.get("metrics"),
                    gate_report={
                        "ok": res["ok"],
                        "design_status": res["design_status"],
                        "small_part": res["small_part"],
                        "blocking_failures": res["blocking_failures"],
                        "brand_errors": res["brand_errors"],
                        "assembly": res["assembly"],
                    },
                    legalizer=legalizer or None,
                    elapsed_ms=elapsed_ms,
                )
                return

            if stl_bytes is None:
                raise ValueError("missing mesh bytes")

            self._update_job(job_id, status="optimizing")
            # Mandatory `verify_preprint=True` — never controlled by request body.
            opt = optimize_assets.optimize_single_part(
                part_id,
                stl_bytes=stl_bytes,
                slot=slot,
                support_policy=support_policy,
                validation_dir=PARTSPEC_DIR / "validation",
                verify_preprint=True,
                partspec_dir=PARTSPEC_DIR,
            )
            c_hash = opt["content_hash"]
            stl_artifact_name: str | None = None
            if opt["print_ok"] and c_hash and opt["stl_bytes"] is not None:
                stl_artifact_name = f"{part_id}.{c_hash}.stl"
                glb_artifact_name = f"{part_id}.{c_hash}.glb"
                (self.out_dir / stl_artifact_name).write_bytes(opt["stl_bytes"])
                (self.out_dir / glb_artifact_name).write_bytes(opt["glb_bytes"])
            else:
                glb_artifact_name = f"{part_id}.{job_id[-8:]}.draft.glb"
                (self.out_dir / glb_artifact_name).write_bytes(opt["glb_bytes"])

            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            self._update_job(
                job_id,
                part_id=part_id,
                status="print_ready" if opt["print_ok"] else "digital_only",
                stl_artifact=stl_artifact_name,
                glb_artifact=glb_artifact_name,
                content_hash=c_hash if opt["print_ok"] else None,
                slicer_recipe=opt["slicer_recipe"] if opt["print_ok"] else None,
                metrics=opt["metrics"],
                gate_report={
                    "ok": opt["print_ok"],
                    "preprint_failures": opt["preprint_failures"],
                },
                elapsed_ms=elapsed_ms,
            )
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[forge-optimizer] job {job_id} error: {exc}\n")
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            self._update_job(
                job_id,
                status="failed",
                error="optimization failed",
                elapsed_ms=elapsed_ms,
            )


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, server_address: tuple[str, int], handler_cls: Any, max_connections: int = 16) -> None:
        super().__init__(server_address, handler_cls)
        self._conn_sem = threading.BoundedSemaphore(max(2, max_connections))

    def process_request(self, request: socket.socket, client_address: Any) -> None:
        if not self._conn_sem.acquire(blocking=False):
            try:
                body = b'{"ok":false,"status":"busy"}'
                resp = (
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n"
                    b"Connection: close\r\n\r\n" + body
                )
                request.sendall(resp)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request: socket.socket, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._conn_sem.release()


def _authorized(auth_header: str | None, expected_token: str | None) -> bool:
    if not expected_token:
        # Even without a configured token (local loopback dev), reject unexpected bearer headers
        # if a caller sends a non-empty Authorization header expecting verification.
        return not auth_header
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    provided = auth_header[len("Bearer ") :].strip()
    if not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected_token.encode("utf-8"))


def make_handler(manager: OptimizerJobManager, expected_token: str | None):
    class ForgeOptimizerHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write(f"[forge-optimizer] {fmt % args}\n")

        def _send_json(
            self,
            data: dict[str, Any],
            status: int = 200,
            extra_headers: dict[str, str] | None = None,
        ) -> None:
            raw = json.dumps(data).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(raw)))
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(raw)

        def _check_auth(self) -> bool:
            if not _authorized(self.headers.get("authorization"), expected_token):
                self._send_json({"ok": False, "status": "unauthorized"}, 401)
                return False
            return True

        def _read_json(self) -> dict[str, Any] | None:
            try:
                length = int(self.headers.get("content-length") or "0")
            except ValueError:
                self._send_json({"ok": False, "status": "invalid"}, 400)
                return None
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send_json(
                    {"ok": False, "status": "too-large" if length > MAX_BODY_BYTES else "invalid"},
                    413 if length > MAX_BODY_BYTES else 400,
                )
                return None
            raw = self.rfile.read(length)
            try:
                val = json.loads(raw.decode("utf-8"))
                if not isinstance(val, dict):
                    raise ValueError("expected JSON object")
                return val
            except Exception:  # noqa: BLE001
                self._send_json({"ok": False, "status": "invalid"}, 400)
                return None

        def _parse_input_source(
            self, body: dict[str, Any]
        ) -> tuple[str, str | None, str, dict[str, Any] | None, bytes | None] | None:
            # Hard-reject forbidden / legacy fields (`stl_path`, `verify_preprint`, `legalize`)
            if "stl_path" in body:
                self._send_json({"ok": False, "status": "invalid", "error": "stl_path is not supported"}, 422)
                return None

            has_recipe = "recipe" in body and body["recipe"] is not None
            has_stl = "stl_base64" in body and body["stl_base64"] is not None
            if has_recipe == has_stl:
                self._send_json({"ok": False, "status": "invalid", "error": "expected recipe or stl_base64"}, 422)
                return None

            if has_recipe:
                if not isinstance(body["recipe"], dict):
                    self._send_json({"ok": False, "status": "invalid", "error": "invalid payload"}, 422)
                    return None
                spec = compile_recipe_to_partspec(body["recipe"])
                return spec["id"], spec.get("slot"), spec.get("support_policy", "none"), spec, None

            part_id = sanitize_part_id(body.get("part_id") or "custom_mesh", prefix_custom=True)
            slot_raw = body.get("slot")
            slot: str | None = None
            if slot_raw is not None:
                s = str(slot_raw).strip().lower()
                if s not in VALID_SLOTS:
                    raise ValueError("invalid slot")
                slot = s
            raw_policy = body.get("support_policy")
            if raw_policy is None:
                support_policy = "none"
            else:
                support_policy = str(raw_policy).strip().lower()
                if support_policy not in ("none", "minimal"):
                    raise ValueError("invalid support_policy")
                if support_policy == "minimal" and slot not in ("crown", "head", "back"):
                    raise ValueError("minimal support_policy requires crown, head, or back slot")
            stl_bytes = decode_stl_base64(body["stl_base64"])
            return part_id, slot, support_policy, None, stl_bytes

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/health":
                if self.headers.get("authorization") and not _authorized(
                    self.headers.get("authorization"), expected_token
                ):
                    self._send_json({"ok": False, "status": "unauthorized"}, 401)
                    return
                self._send_json({"ok": True, "service": "forge-optimizer", "warm": True})
                return

            if not self._check_auth():
                return

            if path.startswith("/v1/jobs/"):
                job_id = path[len("/v1/jobs/") :].strip("/")
                if not JOB_ID_RE.match(job_id):
                    self._send_json({"ok": False, "status": "invalid"}, 400)
                    return
                job = manager.get_job(job_id)
                if job is None:
                    self._send_json({"ok": False, "status": "not-found"}, 404)
                    return
                self._send_json({"ok": True, **job})
                return

            if path.startswith("/v1/artifacts/"):
                art_name = path[len("/v1/artifacts/") :].strip("/")
                art_path = manager.resolve_artifact(art_name)
                if art_path is None:
                    self._send_json({"ok": False, "status": "not-found"}, 404)
                    return
                data = art_path.read_bytes()
                ctype = "model/gltf-binary" if art_name.endswith(".glb") else "model/stl"
                self.send_response(200)
                self.send_header("content-type", ctype)
                self.send_header("content-length", str(len(data)))
                self.send_header(
                    "cache-control",
                    "no-store" if ".draft." in art_name else "public, max-age=31536000, immutable",
                )
                self.end_headers()
                self.wfile.write(data)
                return

            self._send_json({"ok": False, "status": "not-found"}, 404)

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if not self._check_auth():
                return

            if path not in ("/v1/fast-preview", "/v1/jobs"):
                self._send_json({"ok": False, "status": "not-found"}, 404)
                return

            body = self._read_json()
            if body is None:
                return

            enqueue_bg = path == "/v1/jobs" or bool(body.get("enqueue_background", True))
            if enqueue_bg and not manager.has_capacity():
                self._send_json(
                    {"ok": False, "status": "queue_full"},
                    429,
                    extra_headers={"retry-after": "5"},
                )
                return

            try:
                parsed_input = self._parse_input_source(body)
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write(f"[forge-optimizer] input validation failed: {exc}\n")
                self._send_json({"ok": False, "status": "invalid", "error": "invalid payload"}, 422)
                return
            if parsed_input is None:
                return
            part_id, slot, support_policy, compiled_spec, stl_bytes = parsed_input

            if path == "/v1/jobs":
                job_id = manager.try_enqueue(
                    part_id=part_id,
                    slot=slot,
                    support_policy=support_policy,
                    compiled_spec=compiled_spec,
                    stl_bytes=stl_bytes,
                )
                if job_id is None:
                    self._send_json(
                        {"ok": False, "status": "queue_full"},
                        429,
                        extra_headers={"retry-after": "5"},
                    )
                    return
                job = manager.get_job(job_id)
                self._send_json({"ok": True, **(job or {"job_id": job_id, "status": "queued"})}, 202)
                return

            # `/v1/fast-preview`
            t0 = time.perf_counter()
            try:
                manifold_obj = build_print_pose_manifold(compiled_spec) if compiled_spec is not None else None
                draft_tag = uuid.uuid4().hex[:8]
                draft_name = f"{part_id}.{draft_tag}.draft.glb"
                fast = optimize_assets.build_fast_preview_glb(
                    part_id,
                    manifold_obj=manifold_obj,
                    stl_bytes=stl_bytes,
                    slot=slot,
                    web_simplify_mm=(
                        _finite_float(body["web_simplify_mm"], "web_simplify_mm")
                        if "web_simplify_mm" in body
                        else None
                    ),
                    crease_deg=(
                        _finite_float(body["crease_deg"], "crease_deg") if "crease_deg" in body else None
                    ),
                    out_glb_path=manager.out_dir / draft_name,
                )
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write(f"[forge-optimizer] preview build failed: {exc}\n")
                self._send_json({"ok": False, "status": "invalid", "error": "invalid payload"}, 422)
                return

            job_id: str | None = None
            if enqueue_bg:
                job_id = manager.try_enqueue(
                    part_id=part_id,
                    slot=slot,
                    support_policy=support_policy,
                    compiled_spec=compiled_spec,
                    stl_bytes=stl_bytes,
                )
                if job_id is None:
                    self._send_json(
                        {"ok": False, "status": "queue_full"},
                        429,
                        extra_headers={"retry-after": "5"},
                    )
                    return

            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            resp: dict[str, Any] = {
                "ok": True,
                "status": "preview_ready",
                "part_id": part_id,
                "job_id": job_id,
                "draft_artifact": draft_name,
                "glb_size": fast["glb_size"],
                "orig_tris": fast["orig_tris"],
                "web_verts": fast["web_verts"],
                "web_tris": fast["web_tris"],
                "finish_class": fast["finish_class"],
                "elapsed_ms": elapsed_ms,
            }
            if bool(body.get("include_glb_base64", True)):
                resp["glb_base64"] = base64.b64encode(fast["glb_bytes"]).decode("ascii")
            self._send_json(resp, 200)

    return ForgeOptimizerHandler


def main(argv: list[str] | None = None) -> int:
    default_out = Path(os.environ.get("FORGE_OPTIMIZER_OUT_DIR") or (ROOT_DIR / ".forge-cache"))
    ap = argparse.ArgumentParser(description="Run warm fast-preview + background optimizer HTTP daemon.")
    ap.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8791, help="Bind port (default: 8791; 0 for ephemeral)")
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=default_out,
        help="Isolated output directory for content-addressed artifacts (default: .forge-cache)",
    )
    ap.add_argument(
        "--token",
        default=os.environ.get("FORGE_OPTIMIZER_TOKEN", ""),
        help="Bearer auth token (defaults to FORGE_OPTIMIZER_TOKEN env var; required for non-loopback --host)",
    )
    ap.add_argument("--workers", type=int, default=2, help="Background worker threads (default: 2)")
    ap.add_argument("--max-queue", type=int, default=8, help="Max queued+running background jobs before 429 (default: 8)")
    ap.add_argument("--max-connections", type=int, default=16, help="Max concurrent HTTP threads before 503 (default: 16)")
    ap.add_argument("--no-l2", action="store_true", help="Disable the L2 small-parts rescale (for A/B evals)")
    ap.add_argument(
        "--no-auto-minimal",
        action="store_true",
        help="Do not promote support_policy none -> minimal when a recipe has a brim or horns (they get clipped instead)",
    )
    args = ap.parse_args(argv)
    global L2_ENABLED, AUTO_MINIMAL_FOR_OVERHANG
    if args.no_l2:
        L2_ENABLED = False
    if args.no_auto_minimal:
        AUTO_MINIMAL_FOR_OVERHANG = False

    token = args.token.strip() or None
    if args.host.strip().lower() not in LOOPBACK_HOSTS and not token:
        sys.stderr.write(
            "[forge-optimizer] ERROR: refusing to bind to non-loopback host without --token / FORGE_OPTIMIZER_TOKEN\n"
        )
        return 2

    # Refuse writing runtime job artifacts directly into tracked `public/` asset directories
    resolved_out = args.out_dir.resolve()
    tracked_custom = (ROOT_DIR / "public" / "kip" / "custom").resolve()
    if resolved_out == tracked_custom:
        sys.stderr.write(
            "[forge-optimizer] ERROR: refusing --out-dir pointing at tracked public/kip/custom; use an isolated cache dir\n"
        )
        return 2

    manager = OptimizerJobManager(out_dir=resolved_out, workers=args.workers, max_queue=args.max_queue)
    server = BoundedThreadingHTTPServer(
        (args.host, args.port),
        make_handler(manager, expected_token=token),
        max_connections=args.max_connections,
    )
    actual_host, actual_port = server.server_address[:2]
    print(
        json.dumps(
            {
                "event": "forge_optimizer_listening",
                "url": f"http://{actual_host}:{actual_port}",
                "auth_required": bool(token),
                "workers": args.workers,
                "max_queue": args.max_queue,
            }
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
