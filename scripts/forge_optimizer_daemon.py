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
from typing import Any

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
# Feature ops (docs/specs/forge-ai-spec.md, "Recipe v1"): every number is clamped, nothing is rejected.
# The loft is one convex hull, so a brim, an ear, a horn or a row of points can only come from these.
# ---------------------------------------------------------------------------
AUTO_MINIMAL_FOR_OVERHANG = True  # `--no-auto-minimal` turns the none -> minimal promotion off
SLAB_THICKNESS_MM = 0.8  # `sdk.loft_slabs` default slab thickness
FEATURE_OPS = ("knob", "brim", "ears", "horns", "spikes", "snout")
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
            "width_mm": _clamp(feat.get("width_mm"), 5.0, 16.0, w0, "width_mm"),
            "thickness_mm": _clamp(feat.get("thickness_mm"), 2.4, 6.0, 3.6, "thickness_mm"),
            "tilt_deg": _clamp(feat.get("tilt_deg"), 0.0, 35.0, t0, "tilt_deg"),
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
    # spikes: a row of points along x on top of a crown or back piece (the head top is the crown seat)
    if slot not in ("crown", "back"):
        return None
    return {
        "op": "spikes",
        "count": int(_clamp(feat.get("count"), 2, 7, 5, "count")),
        "height_mm": _clamp(feat.get("height_mm"), 3.0, 16.0, 7.0, "height_mm"),
        "base_mm": _clamp(feat.get("base_mm"), 2.5, 7.0, 4.0, "base_mm"),
        "center_boost_mm": _clamp(feat.get("center_boost_mm"), 0.0, 6.0, 0.0, "center_boost_mm"),
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


def _root_fill(rb: float, x_root: float, z_root: float, hw: float, y_scale: float) -> manifold3d.Manifold:
    """A teardrop under a root sphere, tangent to the body wall, so the root's underside is steep enough to print.
    Without it the sphere's lower half hangs off the wall and fails P1 (steeper than 45 degrees)."""
    r_low = 0.8 * rb
    x_low = max(0.0, hw - r_low) - x_root
    drop = sdk.hull([sdk.sphere(rb, (0.0, 0.0, 0.0)), sdk.sphere(r_low, (x_low, 0.0, -2.0 * rb))])
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


def _ears_or_horns_solid(
    op: str,
    slot: str,
    body: manifold3d.Manifold,
    rows: list[tuple[float, float, float, float, float, float]],
    feat: dict[str, Any],
    head_height_mm: float,
    fs: float,
) -> manifold3d.Manifold | None:
    """A mirrored pair on the upper corners of the body. The root sits inside the body (clamped to its
    width at that height), so the pair always fuses with it; the tilt carries the tip clear of the crown pad."""
    if slot == "head":
        z_root = head_height_mm - 5.0  # just under the crown seat
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
        x_root = max(2.0, hw - 0.35 * rb)
        ear = sdk.hull([sdk.sphere(rb, (0.0, 0.0, 0.0)), sdk.sphere(tip, (0.0, 0.0, height))])
        ear = ear.scale((1.0, thick / width, 1.0)).rotate((0.0, float(feat["tilt_deg"]), 0.0))
        fill = _root_fill(rb, x_root, z_root, hw, thick / width)
        return _mirror_pair(ear.translate((x_root, 0.0, z_root)) + fill)
    length = float(feat["length_mm"]) * fs
    rb = float(feat["base_mm"]) * fs / 2.0
    curl = float(feat["curl"])
    n = 6
    phi0 = math.radians(55.0)  # steeper than 45 degrees from the wall so the underside prints
    phi1 = phi0 + curl * math.radians(90.0 - 55.0)
    x_root = max(2.0, hw - 0.8 * rb)
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
    return _mirror_pair(horn + _root_fill(rb, x_root, z_root, hw, 1.0))


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
    body: manifold3d.Manifold, feat: dict[str, Any], head_height_mm: float, fs: float
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
    z_top = min(z_c + height / 2.0, head_height_mm - 2.5)
    z_top = max(z_top, 2.0 + 2.0 * r_up)  # the upper root sphere's bottom stays above the collar
    if z_top > head_height_mm - 2.5:
        return None
    z_up = z_top - r_up
    y_ref = _wall_y(body, z_up)
    cs = body.slice(z_up)
    if y_ref is None or cs.is_empty():
        return None
    x0, _y0, x1, _y1 = cs.bounds()
    cx = 0.5 * (x0 + x1)
    width = min(width, 1.7 * 0.5 * (x1 - x0))
    if width < 3.0:
        return None
    tip_r = max(0.9, tip_r_frac * height / 2.0)
    ramp = None
    while length >= 3.0:  # shorten until a printable ramp fits above the collar
        for slope in (SNOUT_MIN_SLOPE_DEG, SNOUT_FALLBACK_SLOPE_DEG):
            ramp = _snout_ramp(body, length, tip_r, z_top, y_ref, slope)
            if ramp is not None:
                break
        if ramp is not None:
            break
        length -= 0.5
    if ramp is None:
        return None
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

    # Pre-validate and legalize parameters eagerly before returning `part_spec`
    if slot == "hand":
        grip_tu = max(2, min(4, int(shape.get("grip_tu", 2))))
        if kind == "profile2d":
            pts_raw = shape.get("points")
            if not isinstance(pts_raw, list) or not (3 <= len(pts_raw) <= 64):
                raise ValueError("profile2d requires 3..64 points")
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

    def build_for(
        rows: list[tuple[float, float, float, float, float, float]],
        fs: float = 1.0,
    ) -> tuple[manifold3d.Manifold, list[dict[str, Any]], dict[str, Any]]:
        """`fs` scales every feature's size (L2 passes the same factor it applies to the slices)."""
        features_dropped.clear()
        if slot == "hand":
            if kind == "profile2d":
                cs = sdk.polygon_2d(pts_clamped, fillet_r=fillet_r)
            else:
                cs = sdk.star_2d(points=n_pts, r_outer=r_out, r_inner=r_in, fillet_r=fillet_r)
            return sdk.handheld_prop(cs, grip_tu=grip_tu)

        body = sdk.loft_slabs(rows)
        after_builder: list[manifold3d.Manifold] = []  # head ears and horns: `character_head` clips above the seat
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
                body = body + _spikes_solid(rows, feat, fs)
            elif op == "snout":
                snout = _snout_solid(body, feat, head_height_mm, fs)
                if snout is not None:
                    after_builder.append(snout)
                else:
                    features_dropped.append(
                        {"op": "snout", "why": "no printable underside fits this front wall; keep the head's front upright (depth d about 12 to 16, y offsets 0)"}
                    )
            elif op in ("ears", "horns"):
                solid = _ears_or_horns_solid(op, slot, body, rows, feat, head_height_mm, fs)
                if solid is None:
                    features_dropped.append({"op": op, "why": "the body is too narrow where this op attaches"})
                elif slot == "head":
                    after_builder.append(solid)
                else:
                    body = body + solid

        if slot == "crown":
            return sdk.crown_addon(body, support_policy=support_policy)
        if slot == "head":
            m, conns, ex = sdk.character_head(body, height_mm=head_height_mm, support_policy=support_policy)
            if after_builder:
                keepout = _socket_keepout(m)
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
    if slot != "hand":
        # What the L1/L3 clamps changed (they used to be silent), plus what L2 needs to rebuild.
        spec["legalizer_notes"] = _legalizer_notes(shape.get("slices"), slices_legal)
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
    return spec


_SLICE_DEFAULTS = {"z": 0.0, "w": 16.0, "d": 12.0, "r": 3.0, "x": 0.0, "y": 0.0}


def _legalizer_notes(raw: Any, rows: list[tuple[float, float, float, float, float, float]]) -> dict[str, Any]:
    """List what the L1 slope clamp and L3 bounds changed, so the eval can count them."""
    if not isinstance(raw, list):
        return {}
    try:
        ordered = sorted((s for s in raw if isinstance(s, dict)), key=lambda s: float(s.get("z", 0.0)))
    except (TypeError, ValueError):
        return {}
    changes: list[dict[str, Any]] = []
    for i, (s, row) in enumerate(zip(ordered, rows)):
        for j, key in enumerate(("z", "w", "d", "r", "x", "y")):
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


def l2_rescale(spec: dict[str, Any], measured_mm: float | None = None) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Find the smallest shrink that takes a marginal part under the small-parts cylinder.

    Heads never shrink in height: `character_head` puts the crown studs at z = height_mm, so a
    shorter body leaves them floating. Returns (rebuilt spec or None, note for the job response)."""
    ctx = spec.get("_l2")
    t0 = time.perf_counter()
    if not ctx:
        return None, {"applied": False, "reason": "L2 only handles loft slots"}
    target = _small_cylinder_mm() - L2_MARGIN_MM
    rows0 = ctx["rows"]
    paths = ("xy",) if ctx["slot"] == "head" else ("height", "xy", "both")
    evals = 0

    def diameter(rows: list[tuple[float, float, float, float, float, float]], fs: float) -> float:
        nonlocal evals
        evals += 1
        return float(_measure_small(ctx["rebuild"](rows, fs))["min_enclosing_diameter_mm"])

    for path in paths:
        try:
            # Features (brim, ears, horns, points) shrink with the slices; a height-only shrink leaves them alone.
            fs_of = (lambda f: f) if path in ("xy", "both") else (lambda f: 1.0)
            lo, hi = L2_MIN_SCALE, 1.0
            d_lo = diameter(_l2_candidate(rows0, path, lo), fs_of(lo))
            if d_lo > target:
                continue  # even the full shrink does not clear the band on this path
            for _ in range(L2_BISECT_STEPS):
                mid = (lo + hi) / 2
                d_mid = diameter(_l2_candidate(rows0, path, mid), fs_of(mid))
                if d_mid <= target:
                    lo, d_lo = mid, d_mid
                else:
                    hi = mid
            rows = _l2_candidate(rows0, path, lo)
            new_spec = ctx["rebuild"](rows, fs_of(lo))
            new_spec["legalizer_notes"] = dict(spec.get("legalizer_notes") or {})
            new_spec["_features_dropped"] = spec.get("_features_dropped") or []
            new_spec["_l2"] = {**ctx, "rows": rows}
            return new_spec, {
                "applied": True,
                "path": path,
                "scale": round(lo, 3),
                "from_mm": measured_mm,
                "to_mm": round(d_lo, 2),
                "target_mm": round(target, 2),
                "evals": evals,
                "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
            }
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[forge-optimizer] L2 path {path} failed: {exc}\n")
            continue
    return None, {
        "applied": False,
        "reason": "no shrink of at most 40% reached the target",
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
