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
    clean_features: list[dict[str, float | str]] = []
    for feat in raw_features:
        if not isinstance(feat, dict):
            continue
        op = str(feat.get("op", "")).lower()
        if op == "knob":
            clean_features.append(
                {"op": "knob", "radius_mm": max(1.8, min(6.0, _finite_float(feat.get("radius_mm", 3.2), "radius_mm")))}
            )
        elif op == "brim":
            clean_features.append(
                {
                    "op": "brim",
                    "width_mm": max(16.0, min(42.0, _finite_float(feat.get("width_mm", 28.0), "width_mm"))),
                    "depth_mm": max(12.0, min(32.0, _finite_float(feat.get("depth_mm", 18.0), "depth_mm"))),
                    "thickness_mm": max(1.6, min(4.0, _finite_float(feat.get("thickness_mm", 2.2), "thickness_mm"))),
                }
            )
    head_height_mm = max(24.0, min(38.0, _finite_float(shape.get("height_mm", 30.5), "height_mm")))

    def build_for(
        rows: list[tuple[float, float, float, float, float, float]],
    ) -> tuple[manifold3d.Manifold, list[dict[str, Any]], dict[str, Any]]:
        if slot == "hand":
            if kind == "profile2d":
                cs = sdk.polygon_2d(pts_clamped, fillet_r=fillet_r)
            else:
                cs = sdk.star_2d(points=n_pts, r_outer=r_out, r_inner=r_in, fillet_r=fillet_r)
            return sdk.handheld_prop(cs, grip_tu=grip_tu)

        body = sdk.loft_slabs(rows)
        for feat in clean_features:
            if feat["op"] == "knob":
                kr = float(feat["radius_mm"])
                top_z = float(rows[-1][0]) + kr * 0.65
                body = body + sdk.sphere(kr, (float(rows[-1][4]), float(rows[-1][5]), top_z))
            elif feat["op"] == "brim":
                bw = float(feat["width_mm"])
                bd = float(feat["depth_mm"])
                bt = float(feat["thickness_mm"])
                if support_policy == "minimal":
                    body = body + sdk.wide_brim(bw, bd, thickness_mm=bt, z=0.0)
                else:
                    body = body + sdk.rounded_slab(bw, bd, bt, r=min(bw, bd) * 0.35, z=1.5)

        if slot == "crown":
            return sdk.crown_addon(body, support_policy=support_policy)
        if slot == "head":
            return sdk.character_head(body, height_mm=head_height_mm, support_policy=support_policy)
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

        def rebuild(rows: list[tuple[float, float, float, float, float, float]]) -> dict[str, Any]:
            return sdk.part_spec(
                id=part_id,
                name=name,
                stat=stat,
                behavior=behavior,
                slot=slot,
                support_policy=support_policy,
                fn=lambda: build_for(rows),
            )

        spec["_l2"] = {"slot": slot, "rows": slices_legal, "rebuild": rebuild}
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

    def diameter(rows: list[tuple[float, float, float, float, float, float]]) -> float:
        nonlocal evals
        evals += 1
        return float(_measure_small(ctx["rebuild"](rows))["min_enclosing_diameter_mm"])

    for path in paths:
        try:
            lo, hi = L2_MIN_SCALE, 1.0
            d_lo = diameter(_l2_candidate(rows0, path, lo))
            if d_lo > target:
                continue  # even the full shrink does not clear the band on this path
            for _ in range(L2_BISECT_STEPS):
                mid = (lo + hi) / 2
                d_mid = diameter(_l2_candidate(rows0, path, mid))
                if d_mid <= target:
                    lo, d_lo = mid, d_mid
                else:
                    hi = mid
            rows = _l2_candidate(rows0, path, lo)
            new_spec = ctx["rebuild"](rows)
            new_spec["legalizer_notes"] = dict(spec.get("legalizer_notes") or {})
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
    args = ap.parse_args(argv)
    global L2_ENABLED
    if args.no_l2:
        L2_ENABLED = False

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
