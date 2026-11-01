#!/usr/bin/env python3
"""Persistent warm fast-preview + background-optimization daemon for dynamic/AI parts.

Designed to run locally (`npm run forge:optimizer`) or inside a Cloudflare Container /
Sandbox behind `FORGE_OPTIMIZER_URL` (matching `docs/specs/forge-ai-spec.md` §Gatekeeper).

Pre-imports `manifold3d`, `trimesh`, `numpy`, `kip_partspec_sdk`, `optimize_assets`, and
`stl_to_glb` once at startup (`0 ms` cold-start penalty per request) and exposes two stages:

1. `POST /v1/fast-preview` (Synchronous hot path, ~80-350 ms):
   - Accepts either a schema-checked JSON `recipe` (`Recipe v1` — zero Python code execution)
     or a raw mesh (`stl_base64` / `stl_path`).
   - Builds the Manifold, applies sub-pixel Web LOD (`Manifold.simplify`), and encodes an
     indexed `KHR_mesh_quantization` `.glb` (~15-30 KB) in memory.
   - When `enqueue_background` is true (default), atomically enqueues Stage 2 and returns
     `{ status: "preview_ready", job_id, glb_base64, ... }` immediately so the UI renders
     the playable 3D part while print gates run in the background.

2. `POST /v1/jobs` & `GET /v1/jobs/<job_id>` (Asynchronous background optimizer):
   - Runs full printability verification (`validate_and_export` V1-V10 + CPSC small-part
     screen + reference host attach for `recipe` inputs, or `preprint_check` 0.20mm/0.16mm
     for raw STL inputs).
   - Runs `optimize_assets.optimize_single_part` (finish-class `0.006 / 0.005 / 0.016 mm`
     arc-safe `Manifold.simplify`, `z=0` bed snap, content-addressed `sha256[:12]` files,
     final quantized `.glb`, and deterministic `slicer_recipe`).
   - Transitions job status: `queued` -> `validating` -> `optimizing` -> `print_ready`
     (or `digital_only` if print gates fail, keeping Web GLB live while locking Print STL).
"""
from __future__ import annotations

import argparse
import base64
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import sys
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

# Warm imports at daemon startup (eliminates ~300 ms per-request import latency)
import kip_partspec_sdk as sdk  # type: ignore  # noqa: E402
import manifold3d  # noqa: E402
import optimize_assets  # type: ignore  # noqa: E402

SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,62}$")
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
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_JOB_HISTORY = 256


def sanitize_part_id(raw_id: Any, prefix_custom: bool = False) -> str:
    s = str(raw_id or "").strip().lower().replace("-", "_")
    s = re.sub(r"[^a-z0-9_]", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        s = f"part_{uuid.uuid4().hex[:8]}"
    if prefix_custom and not s.startswith("custom_"):
        s = f"custom_{s}"
    return s[:60]


def legalize_loft_slices(raw_slices: list[Any]) -> list[tuple[float, float, float, float, float, float]]:
    """Deterministic L1 legalizer (`forge-ai-spec.md`): sort by Z and clamp outward slope <= 0.78 * dz."""
    if not isinstance(raw_slices, list) or not (2 <= len(raw_slices) <= 16):
        raise ValueError("recipe.shape.slices must contain between 2 and 16 slices")

    parsed: list[list[float]] = []
    for s in raw_slices:
        if isinstance(s, dict):
            z = float(s.get("z", 0.0))
            w = max(3.6, min(90.0, float(s.get("w", 16.0))))
            d = max(3.6, min(90.0, float(s.get("d", 12.0))))
            r = max(0.8, min(0.48 * min(w, d), float(s.get("r", 3.0))))
            x = max(-35.0, min(35.0, float(s.get("x", 0.0))))
            y = max(-35.0, min(35.0, float(s.get("y", 0.0))))
        elif isinstance(s, (list, tuple)) and len(s) in (4, 6):
            z = float(s[0])
            w = max(3.6, min(90.0, float(s[1])))
            d = max(3.6, min(90.0, float(s[2])))
            r = max(0.8, min(0.48 * min(w, d), float(s[3])))
            x = float(s[4]) if len(s) == 6 else 0.0
            y = float(s[5]) if len(s) == 6 else 0.0
        else:
            raise ValueError(f"invalid loft slice: {s!r}")
        parsed.append([z, w, d, r, x, y])

    parsed.sort(key=lambda row: row[0])
    for i in range(1, len(parsed)):
        prev = parsed[i - 1]
        cur = parsed[i]
        if cur[0] <= prev[0] + 0.4:
            cur[0] = prev[0] + 0.5
        dz = cur[0] - prev[0]
        max_outward = 0.78 * dz  # <= 38 deg overhang per side
        max_w = prev[1] + 2.0 * max_outward
        max_d = prev[2] + 2.0 * max_outward
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
        raise ValueError(f"invalid recipe.slot {slot!r}; expected one of {VALID_SLOTS}")

    part_id = sanitize_part_id(recipe.get("id") or recipe.get("name"), prefix_custom=True)
    name = str(recipe.get("name") or part_id).strip()[:80]
    stat = str(recipe.get("stat") or "Glow").strip()
    if stat not in sdk.VALID_STATS:
        stat = "Glow"
    behavior = str(recipe.get("behavior") or f"Custom {slot} accessory").strip()[:160]

    shape = recipe.get("shape") or {}
    kind = str(shape.get("kind") or ("star2d" if slot == "hand" else "loft")).strip().lower()
    legalize = bool(recipe.get("legalize", True))

    def build_fn() -> tuple[manifold3d.Manifold, list[dict[str, Any]], dict[str, Any]]:
        if slot == "hand":
            if kind == "profile2d":
                pts_raw = shape.get("points") or []
                if not isinstance(pts_raw, list) or len(pts_raw) < 3:
                    raise ValueError("profile2d requires >= 3 [x, z] points")
                pts = [(float(p[0]), float(p[1])) for p in pts_raw[:64]]
                cs = sdk.polygon_2d(pts, fillet_r=float(shape.get("fillet_r_mm", 1.2)))
            else:
                n_pts = max(3, min(12, int(shape.get("points", 5))))
                r_out = max(10.0, min(28.0, float(shape.get("outer_r_mm", 18.0))))
                r_in = max(5.0, min(r_out - 2.0, float(shape.get("inner_r_mm", r_out * 0.52))))
                cs = sdk.star_2d(points=n_pts, r_outer=r_out, r_inner=r_in)
            grip_tu = max(2, min(4, int(shape.get("grip_tu", 2))))
            return sdk.handheld_prop(cs, grip_tu=grip_tu)

        raw_slices = shape.get("slices")
        if not raw_slices:
            raise ValueError("loft recipe requires shape.slices")
        if legalize:
            slices = legalize_loft_slices(raw_slices)
        else:
            slices = [
                (
                    float(s["z"]),
                    float(s["w"]),
                    float(s["d"]),
                    float(s.get("r", 3.0)),
                    float(s.get("x", 0.0)),
                    float(s.get("y", 0.0)),
                )
                if isinstance(s, dict)
                else tuple(float(v) for v in s)  # type: ignore[misc]
                for s in raw_slices
            ]
        body = sdk.loft_slabs(slices)

        # Optional bounded parametric features (`knob` / `brim`)
        for feat in (recipe.get("features") or [])[:4]:
            if not isinstance(feat, dict):
                continue
            op = str(feat.get("op", "")).lower()
            if op == "knob":
                kr = max(1.8, min(6.0, float(feat.get("radius_mm", 3.2))))
                top_z = float(slices[-1][0]) + kr * 0.65
                body = body + sdk.sphere(kr, (float(slices[-1][4]), float(slices[-1][5]), top_z))
            elif op == "brim":
                bw = max(16.0, min(42.0, float(feat.get("width_mm", 28.0))))
                bd = max(12.0, min(32.0, float(feat.get("depth_mm", 18.0))))
                bt = max(1.6, min(4.0, float(feat.get("thickness_mm", 2.2))))
                body = body + sdk.rounded_slab(bw, bd, bt, r=min(bw, bd) * 0.35, z=1.5)

        if slot == "crown":
            return sdk.crown_addon(body)
        if slot == "head":
            h_mm = max(24.0, min(38.0, float(shape.get("height_mm", 30.5))))
            return sdk.character_head(body, height_mm=h_mm)
        if slot == "back":
            return sdk.backpack_addon(body)
        return sdk.vehicle_addon(body, slot=slot)

    return sdk.part_spec(
        id=part_id,
        name=name,
        stat=stat,
        behavior=behavior,
        slot=slot,
        fn=build_fn,
    )


def build_print_pose_manifold(spec: dict[str, Any]) -> manifold3d.Manifold:
    m, _, extras = spec["fn"]()
    rot = (extras or {}).get("print_rotation_deg")
    if rot:
        m = m.rotate(tuple(rot))
        m = m.translate((0.0, 0.0, -float(m.bounding_box()[2])))
    return optimize_assets.snap_manifold_to_bed(m)


class OptimizerJobManager:
    def __init__(self, out_dir: Path, workers: int = 2) -> None:
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="forge-opt")
        self._lock = threading.Lock()
        self._jobs: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def active_count(self) -> int:
        with self._lock:
            return sum(
                1 for j in self._jobs.values() if j["status"] in ("queued", "validating", "optimizing")
            )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            j = self._jobs.get(job_id)
            return dict(j) if j is not None else None

    def _update_job(self, job_id: str, **patch: Any) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(patch)
                self._jobs[job_id]["updated_at"] = round(time.time(), 3)

    def enqueue(self, payload: dict[str, Any], compiled_spec: dict[str, Any] | None = None) -> str:
        job_id = f"fjob_{uuid.uuid4().hex[:12]}"
        part_id = (
            compiled_spec["id"]
            if compiled_spec is not None
            else sanitize_part_id(payload.get("part_id") or "custom_part")
        )
        now = round(time.time(), 3)
        record: dict[str, Any] = {
            "job_id": job_id,
            "part_id": part_id,
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "stl_file": None,
            "glb_file": None,
            "content_hash": None,
            "slicer_recipe": None,
            "metrics": None,
            "gate_report": None,
            "error": None,
            "elapsed_ms": None,
        }
        with self._lock:
            self._jobs[job_id] = record
            while len(self._jobs) > MAX_JOB_HISTORY:
                oldest_id, oldest = next(iter(self._jobs.items()))
                if oldest["status"] in ("queued", "validating", "optimizing"):
                    break
                self._jobs.pop(oldest_id, None)

        self._pool.submit(self._run_job, job_id, payload, compiled_spec)
        return job_id

    def _run_job(
        self,
        job_id: str,
        payload: dict[str, Any],
        compiled_spec: dict[str, Any] | None,
    ) -> None:
        t0 = time.perf_counter()
        try:
            self._update_job(job_id, status="validating")
            spec = compiled_spec
            if spec is None and isinstance(payload.get("recipe"), dict):
                spec = compile_recipe_to_partspec(payload["recipe"])

            if spec is not None:
                res = sdk.validate_and_export(
                    spec,
                    out_dir=self.out_dir,
                    optimize=True,
                    export_web_on_fail=True,
                )
                elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                opt_info = res.get("optimization") or {}
                c_hash = opt_info.get("content_hash")
                glb_out: str | None = res.get("glb_file")
                stl_out: str | None = res.get("stl_file") if res["ok"] else None

                # Also write content-addressed immutable filenames when print_ready
                if res["ok"] and c_hash and stl_out and glb_out:
                    hashed_stl = self.out_dir / f"{spec['id']}.{c_hash}.stl"
                    hashed_glb = self.out_dir / f"{spec['id']}.{c_hash}.glb"
                    hashed_stl.write_bytes(Path(stl_out).read_bytes())
                    hashed_glb.write_bytes(Path(glb_out).read_bytes())
                    stl_out = str(hashed_stl)
                    glb_out = str(hashed_glb)

                self._update_job(
                    job_id,
                    part_id=spec["id"],
                    status="print_ready" if res["ok"] else "digital_only",
                    stl_file=stl_out,
                    glb_file=glb_out,
                    content_hash=c_hash,
                    slicer_recipe=res.get("slicer_recipe"),
                    metrics=opt_info.get("metrics"),
                    gate_report={
                        "ok": res["ok"],
                        "design_status": res["design_status"],
                        "small_part": res["small_part"],
                        "blocking_failures": res["blocking_failures"],
                        "brand_errors": res["brand_errors"],
                        "assembly": res["assembly"],
                    },
                    elapsed_ms=elapsed_ms,
                )
                return

            # Raw STL / mesh input path
            part_id = sanitize_part_id(payload.get("part_id") or "custom_mesh")
            slot = payload.get("slot")
            stl_bytes: bytes | None = None
            stl_path: Path | None = None
            if isinstance(payload.get("stl_base64"), str):
                stl_bytes = base64.b64decode(payload["stl_base64"])
            elif isinstance(payload.get("stl_path"), str):
                stl_path = Path(payload["stl_path"])

            self._update_job(job_id, status="optimizing")
            opt = optimize_assets.optimize_single_part(
                part_id,
                stl_bytes=stl_bytes,
                stl_path=stl_path,
                slot=str(slot) if slot else None,
                validation_dir=PARTSPEC_DIR / "validation",
                verify_preprint=bool(payload.get("verify_preprint", True)),
                partspec_dir=PARTSPEC_DIR,
            )
            c_hash = opt["content_hash"]
            glb_dest = self.out_dir / f"{part_id}.{c_hash}.glb"
            glb_dest.write_bytes(opt["glb_bytes"])
            stl_dest_str: str | None = None
            if opt["print_ok"] and opt["stl_bytes"] is not None:
                stl_dest = self.out_dir / f"{part_id}.{c_hash}.stl"
                stl_dest.write_bytes(opt["stl_bytes"])
                stl_dest_str = str(stl_dest)

            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            self._update_job(
                job_id,
                part_id=part_id,
                status="print_ready" if opt["print_ok"] else "digital_only",
                stl_file=stl_dest_str,
                glb_file=str(glb_dest),
                content_hash=c_hash,
                slicer_recipe=opt["slicer_recipe"] if opt["print_ok"] else None,
                metrics=opt["metrics"],
                gate_report={
                    "ok": opt["print_ok"],
                    "preprint_failures": opt["preprint_failures"],
                },
                elapsed_ms=elapsed_ms,
            )
        except Exception as exc:  # noqa: BLE001
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            self._update_job(
                job_id,
                status="failed",
                error=str(exc),
                elapsed_ms=elapsed_ms,
            )


def make_handler(manager: OptimizerJobManager):
    class ForgeOptimizerHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            # Quiet structured stderr log
            sys.stderr.write(f"[forge-optimizer] {fmt % args}\n")

        def _send_json(self, data: dict[str, Any], status: int = 200) -> None:
            raw = json.dumps(data).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _read_json(self) -> dict[str, Any] | None:
            length = int(self.headers.get("content-length") or "0")
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send_json({"ok": False, "error": "invalid or oversized JSON body"}, 413 if length > MAX_BODY_BYTES else 400)
                return None
            raw = self.rfile.read(length)
            try:
                val = json.loads(raw.decode("utf-8"))
                if not isinstance(val, dict):
                    raise ValueError("expected JSON object")
                return val
            except Exception as exc:  # noqa: BLE001
                self._send_json({"ok": False, "error": f"invalid JSON: {exc}"}, 400)
                return None

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/health":
                self._send_json(
                    {
                        "ok": True,
                        "service": "forge-optimizer",
                        "warm": True,
                        "active_jobs": manager.active_count(),
                    }
                )
                return

            if path.startswith("/v1/jobs/"):
                job_id = path[len("/v1/jobs/") :].strip("/")
                job = manager.get_job(job_id)
                if job is None:
                    self._send_json({"ok": False, "error": "job not found"}, 404)
                    return
                self._send_json({"ok": True, **job})
                return

            self._send_json({"ok": False, "error": "not found"}, 404)

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            body = self._read_json()
            if body is None:
                return

            if path == "/v1/fast-preview":
                t0 = time.perf_counter()
                try:
                    compiled_spec: dict[str, Any] | None = None
                    manifold_obj: manifold3d.Manifold | None = None
                    stl_bytes: bytes | None = None
                    stl_path: Path | None = None

                    if isinstance(body.get("recipe"), dict):
                        compiled_spec = compile_recipe_to_partspec(body["recipe"])
                        part_id = compiled_spec["id"]
                        slot = compiled_spec.get("slot")
                        manifold_obj = build_print_pose_manifold(compiled_spec)
                    else:
                        part_id = sanitize_part_id(body.get("part_id") or "custom_preview")
                        slot = body.get("slot")
                        if isinstance(body.get("stl_base64"), str):
                            stl_bytes = base64.b64decode(body["stl_base64"])
                        elif isinstance(body.get("stl_path"), str):
                            stl_path = Path(body["stl_path"])
                        else:
                            self._send_json(
                                {"ok": False, "error": "expected recipe, stl_base64, or stl_path"},
                                422,
                            )
                            return

                    draft_dir = manager.out_dir / "draft"
                    draft_glb = draft_dir / f"{part_id}.draft.glb"
                    fast = optimize_assets.build_fast_preview_glb(
                        part_id,
                        manifold_obj=manifold_obj,
                        stl_bytes=stl_bytes,
                        stl_path=stl_path,
                        slot=str(slot) if slot else None,
                        web_simplify_mm=(
                            float(body["web_simplify_mm"]) if "web_simplify_mm" in body else None
                        ),
                        crease_deg=(float(body["crease_deg"]) if "crease_deg" in body else None),
                        out_glb_path=draft_glb,
                    )

                    job_id: str | None = None
                    if bool(body.get("enqueue_background", True)):
                        job_id = manager.enqueue(body, compiled_spec=compiled_spec)

                    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                    resp: dict[str, Any] = {
                        "ok": True,
                        "status": "preview_ready",
                        "part_id": part_id,
                        "job_id": job_id,
                        "draft_glb_file": str(draft_glb),
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
                except Exception as exc:  # noqa: BLE001
                    self._send_json({"ok": False, "error": str(exc)}, 422)
                return

            if path == "/v1/jobs":
                try:
                    compiled_spec = (
                        compile_recipe_to_partspec(body["recipe"])
                        if isinstance(body.get("recipe"), dict)
                        else None
                    )
                    job_id = manager.enqueue(body, compiled_spec=compiled_spec)
                    job = manager.get_job(job_id)
                    self._send_json({"ok": True, **(job or {"job_id": job_id, "status": "queued"})}, 202)
                except Exception as exc:  # noqa: BLE001
                    self._send_json({"ok": False, "error": str(exc)}, 422)
                return

            self._send_json({"ok": False, "error": "not found"}, 404)

    return ForgeOptimizerHandler


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run warm fast-preview + background optimizer HTTP daemon.")
    ap.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8791, help="Bind port (default: 8791; 0 for ephemeral)")
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT_DIR / "public" / "kip" / "custom",
        help="Output directory for draft/optimized GLB & STL artifacts",
    )
    ap.add_argument("--workers", type=int, default=2, help="Background worker threads (default: 2)")
    args = ap.parse_args(argv)

    manager = OptimizerJobManager(out_dir=args.out_dir, workers=args.workers)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(manager))
    actual_host, actual_port = server.server_address[:2]
    print(
        json.dumps(
            {
                "event": "forge_optimizer_listening",
                "url": f"http://{actual_host}:{actual_port}",
                "out_dir": str(args.out_dir),
                "workers": args.workers,
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
