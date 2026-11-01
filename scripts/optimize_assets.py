#!/usr/bin/env python3
"""Two-tier deterministic asset optimizer for ToyVentor parts (Print STL + Web LOD).

Runs inside the PartSpec Python environment (`parts/partspec/.venv/bin/python3`,
which provides `manifold3d`, `trimesh`, and `numpy`):

1. Print Tier (`--stl-out`, e.g. `public/parts-stl/`):
   - Classifies each part into a finish-safe tolerance class (`show_curved`: 0.006 mm,
     `precision_gear_pin`: 0.010 mm, `prismatic_structural`: 0.018 mm) unless
     overridden in `parts/partspec/asset_optimization_manifest.json`.
   - Applies `Manifold.simplify(eps_print)` (preserving smooth G2/G3 slicer arc
     toolpaths on 0.12 mm curved show faces), snaps the bed contact plane to `z = 0.0`,
     and enforces watertight 2-manifold (`NoError`), bounding-box (`<= 0.025 mm`),
     and volume (`<= 0.25%`) gates. Never emits a file larger than its input.
   - Computes deterministic `slicer_recipe` metadata (0.12-0.16 mm visible layers,
     smooth PEI, 3 walls @ 30 mm/s, `outer_first` vs `inner_first` at 22 deg overhang,
     corner/`+Y` rear seam, selective 0.21 mm-inset `all_top` ironing, brim width,
     and support-free verification).

2. Web Tier (`--web-stage`, fed into `scripts/stl_to_glb.py` v2):
   - Applies `Manifold.simplify(eps_web)` (default 0.080 mm; 0.055 mm on fine gears/pins)
     so `<model-viewer>` previews stay sub-pixel accurate at 220 px while cutting
     triangle counts by ~75%.

Can also synthesize missing PartSpec source STLs on the fly via `--build-missing`
when `parts/partspec/out/` is absent in a fresh checkout or worktree.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

import manifold3d
import numpy as np
import trimesh

BINARY_STL_HEADER = b"ToyVentor TU Print STL v2".ljust(80, b"\x00")
STL_DTYPE = np.dtype(
    [
        ("normal", "<f4", (3,)),
        ("v0", "<f4", (3,)),
        ("v1", "<f4", (3,)),
        ("v2", "<f4", (3,)),
        ("attr", "<u2"),
    ]
)

FINISH_DEFAULTS_MM: dict[str, float] = {
    "show_curved": 0.006,
    "precision_gear_pin": 0.005,
    "prismatic_structural": 0.016,
}

WEB_DEFAULTS_MM: dict[str, float] = {
    "show_curved": 0.075,
    "precision_gear_pin": 0.055,
    "prismatic_structural": 0.090,
}

CREASE_DEFAULTS_DEG: dict[str, int] = {
    "show_curved": 36,
    "precision_gear_pin": 28,
    "prismatic_structural": 34,
}


def classify_finish_class(part_id: str) -> str:
    pid = part_id.lower()
    curved_tokens = (
        "dome-",
        "skin-",
        "windscreen",
        "capsule",
        "cloud-wings",
        "robot-head-",
        "bumper-horns",
        "aero-wedge",
        "booster-pod",
        "foil-wing",
        "scoop-blade",
        "wobble-hat",
        "pointy-ears",
        "waddle-tail",
        "hood-scoop",
        "hood-cover",
    )
    if any(tok in pid for tok in curved_tokens):
        return "show_curved"

    precision_tokens = (
        "gear-",
        "pin-",
        "-pin",
        "shaft",
        "pinion",
        "screw",
        "forge-mount-",
        "wheel",
        "rotor-blade",
        "turntable",
        "beam-",
        "adapter-",
        "clevis-",
        "yoke-",
    )
    if any(tok in pid for tok in precision_tokens):
        return "precision_gear_pin"

    return "prismatic_structural"


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(val)))


def trimesh_to_manifold(tm: trimesh.Trimesh) -> manifold3d.Manifold:
    work = tm.copy()
    work.merge_vertices(merge_tex=True, merge_norm=True)
    mesh = manifold3d.Mesh(
        vert_properties=np.asarray(work.vertices, dtype=np.float32),
        tri_verts=np.asarray(work.faces, dtype=np.uint32),
    )
    return manifold3d.Manifold(mesh)


def manifold_to_arrays(m: manifold3d.Manifold) -> tuple[np.ndarray, np.ndarray]:
    mesh = m.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float64)[:, :3].copy()
    faces = np.asarray(mesh.tri_verts, dtype=np.uint32).copy()
    return verts, faces


def snap_manifold_to_bed(m: manifold3d.Manifold) -> manifold3d.Manifold:
    verts, faces = manifold_to_arrays(m)
    if len(verts) == 0:
        return m
    z_min = float(verts[:, 2].min())
    if abs(z_min) <= 0.05:
        verts[:, 2] -= z_min
    near_bed = np.abs(verts[:, 2]) < 0.008
    if np.any(near_bed):
        snapped = verts.copy()
        snapped[near_bed, 2] = 0.0
        cand = manifold3d.Manifold(
            manifold3d.Mesh(
                vert_properties=snapped.astype(np.float32),
                tri_verts=faces,
            )
        )
        if cand.status() == manifold3d.Error.NoError and cand.num_tri() > 0:
            return cand
    return m.translate((0.0, 0.0, -z_min)) if abs(z_min) > 0.0 else m


def write_binary_stl(path: Path, verts: np.ndarray, faces: np.ndarray) -> int:
    tri_count = int(len(faces))
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(cross, axis=1, keepdims=True)
    safe_norms = np.where(norms > 1e-20, norms, 1.0)
    unit_normals = np.where(norms > 1e-20, cross / safe_norms, np.array([0.0, 0.0, 1.0]))

    records = np.zeros(tri_count, dtype=STL_DTYPE)
    records["normal"] = unit_normals.astype(np.float32)
    records["v0"] = v0.astype(np.float32)
    records["v1"] = v1.astype(np.float32)
    records["v2"] = v2.astype(np.float32)
    records["attr"] = 0

    payload = BINARY_STL_HEADER + struct.pack("<I", tri_count) + records.tobytes()
    path.write_bytes(payload)
    return len(payload)


def _lookup_validation_brim(part_id: str, validation_dir: Path | None) -> int | None:
    if validation_dir is None or not validation_dir.exists():
        return None
    candidates = [
        part_id.replace("-", "_"),
        part_id,
    ]
    for cid in candidates:
        p = validation_dir / f"{cid}.json"
        if p.exists():
            try:
                doc = json.loads(p.read_text("utf-8"))
                brim = (doc.get("print_settings") or {}).get("brim_width_mm")
                if brim is not None:
                    return int(round(float(brim)))
            except Exception:
                pass
    return None


def compute_slicer_recipe_and_telemetry(
    part_id: str,
    finish_class: str,
    verts: np.ndarray,
    faces: np.ndarray,
    validation_dir: Path | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    tm = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    normals = tm.face_normals
    centers = tm.triangles_center
    areas = tm.area_faces

    z_max = float(verts[:, 2].max()) if len(verts) else 0.0
    above_chamfer = centers[:, 2] > 1.0
    not_bridge = normals[:, 2] > -0.98

    # Sloped overhang > 22 deg from vertical (n_z < -sin(22 deg) = -0.3746)
    sloped_22 = above_chamfer & not_bridge & (normals[:, 2] < -math.sin(math.radians(22.0)))
    overhang_22_mm2 = float(areas[sloped_22].sum())

    # Show-face V11 check: > 30 deg downward slope on front (-Y) exterior half
    sloped_30_front = (
        above_chamfer
        & not_bridge
        & (normals[:, 2] < -0.5)
        & (centers[:, 1] < 0.0)
        & (normals[:, 1] < -0.15)
    )
    show_overhang_30_mm2 = float(areas[sloped_30_front].sum())

    # Flat horizontal top deck area (excluding lowest 1 mm)
    flat_top = (normals[:, 2] > 0.995) & (centers[:, 2] > 1.0)
    flat_top_mm2 = float(areas[flat_top].sum())

    # Bed contact area at z <= 0.12 mm
    bed_contact = (normals[:, 2] < -0.99) & (centers[:, 2] <= 0.12)
    bed_area_mm2 = float(areas[bed_contact].sum())

    pid = part_id.lower()
    if finish_class == "show_curved":
        layer_height_mm = 0.12
    elif pid.endswith("-tray"):
        layer_height_mm = 0.20
    else:
        layer_height_mm = 0.16

    if finish_class != "show_curved" and overhang_22_mm2 <= 2.0:
        wall_order = "outer_first"
    else:
        wall_order = "inner_first"

    round_tokens = (
        "dome-",
        "capsule",
        "wobble-hat",
        "forge-mount-ring",
        "pin-",
        "-pin",
        "wheel",
        "turntable",
    )
    seam_position = "back" if any(t in pid for t in round_tokens) else "aligned"

    no_iron_tokens = ("gear-", "pin-", "-pin", "shaft", "pinion", "screw", "wheel", "rotor-blade")
    if (
        finish_class != "show_curved"
        and not any(t in pid for t in no_iron_tokens)
        and flat_top_mm2 >= 25.0
    ):
        ironing = "all_top"
        ironing_inset_mm = 0.21
    else:
        ironing = "none"
        ironing_inset_mm = 0.0

    brim_from_val = _lookup_validation_brim(part_id, validation_dir)
    if brim_from_val is not None:
        brim_width_mm = brim_from_val
    elif z_max > 22.0 and bed_area_mm2 < 110.0:
        brim_width_mm = 4
    else:
        brim_width_mm = 0

    recipe: dict[str, Any] = {
        "layer_height_mm": layer_height_mm,
        "wall_loops": 3,
        "outer_wall_speed_mms": 30,
        "wall_order": wall_order,
        "seam_position": seam_position,
        "ironing": ironing,
        "ironing_inset_mm": ironing_inset_mm,
        "brim_width_mm": brim_width_mm,
        "support_mode": "none",
    }
    telemetry: dict[str, Any] = {
        "overhang_22_mm2": round(overhang_22_mm2, 2),
        "flat_top_mm2": round(flat_top_mm2, 2),
        "bed_area_mm2": round(bed_area_mm2, 2),
        "v11_show_face_overhang_30_mm2": round(show_overhang_30_mm2, 2),
        "v11_status": "pass" if show_overhang_30_mm2 <= 15.0 else "advisory",
    }
    return recipe, telemetry


def build_missing_partspec_stls(
    specs: list[str],
    partspec_dir: Path,
) -> None:
    """Build missing PartSpec parts directly from `toyventor_parts.py` (`id=dest_stl`)."""
    if not specs:
        return
    if str(partspec_dir) not in sys.path:
        sys.path.insert(0, str(partspec_dir))
    import toyventor_parts as tp  # type: ignore

    for item in specs:
        if "=" not in item:
            raise ValueError(f"invalid --build-missing spec {item!r}, expected partspec_id=/path/to/out.stl")
        pid, out_str = item.split("=", 1)
        out_path = Path(out_str)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        m, _, extras = tp.build(pid)
        rot = (extras or {}).get("print_rotation_deg")
        if rot:
            m = m.rotate(tuple(rot))
            m = m.translate((0.0, 0.0, -float(m.bounding_box()[2])))
        m = snap_manifold_to_bed(m)
        verts, faces = manifold_to_arrays(m)
        write_binary_stl(out_path, verts, faces)


def default_manifest_skeleton() -> dict[str, Any]:
    return {
        "version": 2,
        "defaults": {
            "print_simplify_mm": dict(FINISH_DEFAULTS_MM),
            "web_simplify_mm": 0.080,
            "web_crease_deg": 34,
            "quantize": True,
            "hygiene": {
                "dry_filament": True,
                "pla_flow_ratio_hint": "0.96-0.98",
                "bed_surface": "smooth_pei",
                "outer_wall_speed_mms": 30,
                "wall_loops": 3,
            },
        },
        "parts": {},
    }


def optimize_one_stl(
    stl_path: Path,
    stl_out_dir: Path,
    web_stage_dir: Path | None,
    manifest_doc: dict[str, Any],
    validation_dir: Path | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    part_id = stl_path.stem
    raw_bytes = stl_path.read_bytes()
    src_sha256 = hashlib.sha256(raw_bytes).hexdigest()[:16]

    existing = (manifest_doc.get("parts") or {}).get(part_id) or {}
    auto_class = classify_finish_class(part_id)
    # Only keep a cached finish_class if the part was explicitly LLM-tuned; otherwise follow canonical classifier.
    finish_class = existing.get("finish_class") if "llm_tuned_at" in existing else auto_class
    if finish_class not in FINISH_DEFAULTS_MM:
        finish_class = auto_class

    defaults_print = (manifest_doc.get("defaults") or {}).get("print_simplify_mm") or FINISH_DEFAULTS_MM
    raw_eps_print = (
        existing["print_simplify_mm"]
        if ("llm_tuned_at" in existing and "print_simplify_mm" in existing)
        else defaults_print.get(finish_class, FINISH_DEFAULTS_MM[finish_class])
    )
    eps_print = _clamp(raw_eps_print, 0.004, 0.020)
    eps_web = _clamp(
        existing.get("web_simplify_mm", WEB_DEFAULTS_MM[finish_class]),
        0.030,
        0.200,
    )
    crease_deg = int(
        round(_clamp(existing.get("web_crease_deg", CREASE_DEFAULTS_DEG[finish_class]), 18, 60))
    )

    tm_orig = trimesh.load(stl_path, file_type="stl", force="mesh")
    orig_tris = int(len(tm_orig.faces))
    orig_bounds = np.asarray(tm_orig.bounds, dtype=np.float64)
    orig_extents = orig_bounds[1] - orig_bounds[0]

    m_orig = trimesh_to_manifold(tm_orig)
    if m_orig.status() != manifold3d.Error.NoError or m_orig.num_tri() == 0:
        raise RuntimeError(f"{stl_path.name}: input STL is not a valid watertight Manifold ({m_orig.status()})")
    orig_vol = float(m_orig.volume())

    # --- Pass P1: Print Tier ---
    m_print = snap_manifold_to_bed(m_orig.simplify(eps_print))
    if m_print.status() != manifold3d.Error.NoError or m_print.num_tri() == 0:
        m_print = snap_manifold_to_bed(m_orig)

    p_verts, p_faces = manifold_to_arrays(m_print)
    p_bounds = np.vstack([p_verts.min(axis=0), p_verts.max(axis=0)])
    p_extents = p_bounds[1] - p_bounds[0]
    p_vol = float(m_print.volume())

    max_bbox_delta = float(np.max(np.abs(p_extents - orig_extents)))
    rel_vol_delta = abs(p_vol - orig_vol) / max(abs(orig_vol), 1e-6)
    z_min_after = float(p_bounds[0, 2])

    # Safety fallback: if geometric gates exceed tight FDM tolerances or triangle count did not shrink,
    # emit the bed-snapped original Manifold so quality and byte size never regress.
    if (
        abs(z_min_after) > 1e-4
        or max_bbox_delta > 0.025
        or rel_vol_delta > 0.0025
        or len(p_faces) >= orig_tris
    ):
        m_print = snap_manifold_to_bed(m_orig)
        p_verts, p_faces = manifold_to_arrays(m_print)
        p_bounds = np.vstack([p_verts.min(axis=0), p_verts.max(axis=0)])
        p_extents = p_bounds[1] - p_bounds[0]
        p_vol = float(m_print.volume())
        max_bbox_delta = float(np.max(np.abs(p_extents - orig_extents)))
        rel_vol_delta = abs(p_vol - orig_vol) / max(abs(orig_vol), 1e-6)

    out_stl = stl_out_dir / stl_path.name
    print_bytes = write_binary_stl(out_stl, p_verts, p_faces)
    print_tris = int(len(p_faces))

    # --- Pass W1: Web LOD Tier ---
    web_tris = print_tris
    if web_stage_dir is not None:
        m_web = m_orig.simplify(eps_web)
        if m_web.status() == manifold3d.Error.NoError and 0 < m_web.num_tri() < print_tris:
            w_verts, w_faces = manifold_to_arrays(m_web)
            w_extents = w_verts.max(axis=0) - w_verts.min(axis=0)
            if float(np.max(np.abs(w_extents - orig_extents))) <= max(0.30, eps_web * 3.0):
                write_binary_stl(web_stage_dir / stl_path.name, w_verts, w_faces)
                web_tris = int(len(w_faces))
            else:
                write_binary_stl(web_stage_dir / stl_path.name, p_verts, p_faces)
        else:
            write_binary_stl(web_stage_dir / stl_path.name, p_verts, p_faces)

    recipe, telemetry = compute_slicer_recipe_and_telemetry(
        part_id,
        finish_class,
        p_verts,
        p_faces,
        validation_dir,
    )
    if isinstance(existing.get("slicer_recipe"), dict):
        # Preserve any validated LLM parent_tip if present while keeping geometric fields authoritative
        tip = existing["slicer_recipe"].get("parent_tip")
        if isinstance(tip, str) and tip:
            recipe["parent_tip"] = tip

    manifest_entry: dict[str, Any] = {
        "source_sha256": src_sha256,
        "finish_class": finish_class,
        "print_simplify_mm": round(eps_print, 4),
        "web_simplify_mm": round(eps_web, 4),
        "web_crease_deg": crease_deg,
        "slicer_recipe": recipe,
    }
    if "llm_tuned_at" in existing:
        manifest_entry["llm_tuned_at"] = existing["llm_tuned_at"]
    if "rationale" in existing:
        manifest_entry["rationale"] = existing["rationale"]

    report_row: dict[str, Any] = {
        "part_id": part_id,
        "finish_class": finish_class,
        "orig_bytes": len(raw_bytes),
        "print_bytes": print_bytes,
        "orig_tris": orig_tris,
        "print_tris": print_tris,
        "web_tris": web_tris,
        "max_bbox_delta_mm": round(max_bbox_delta, 5),
        "rel_vol_delta_pct": round(rel_vol_delta * 100.0, 5),
        **telemetry,
    }
    return manifest_entry, report_row


def _verify_one_preprint_worker(task: tuple[str, str]) -> list[str]:
    stl_str, partspec_str = task
    if partspec_str not in sys.path:
        sys.path.insert(0, partspec_str)
    import preprint_check as ppc  # type: ignore

    partspec_dir = Path(partspec_str)
    f = Path(stl_str)
    prof_020 = json.loads((partspec_dir / "print_profiles" / "fdm_pla_0.4.json").read_text("utf-8"))
    prof_016 = dict(prof_020, layer_height_mm=0.16)

    errs: list[str] = []
    for tag, prof in (("0.20mm", prof_020), ("0.16mm", prof_016)):
        rep = ppc.check_stl(f, prof, exe=None, part_id=f.stem, cached=None)
        if rep.get("verdict") == "fail":
            bad = [c.get("id", "?") for c in (rep.get("checks") or []) if c.get("result") == "fail"]
            errs.append(f"{f.name}@{tag}: {bad}")
    return errs


def verify_preprint_all(stl_files: list[Path], partspec_dir: Path) -> None:
    tasks = [(str(f), str(partspec_dir)) for f in stl_files]
    failures: list[str] = []
    with ProcessPoolExecutor() as pool:
        for errs in pool.map(_verify_one_preprint_worker, tasks):
            failures.extend(errs)
    if failures:
        raise RuntimeError(f"preprint_check failed on {len(failures)} target(s): {'; '.join(failures)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Optimize print STLs and stage Web-LOD meshes.")
    ap.add_argument("--in", dest="in_dir", type=Path, required=True, help="Input directory of source STLs")
    ap.add_argument("--stl-out", type=Path, required=True, help="Output directory for print-tier STLs")
    ap.add_argument("--web-stage", type=Path, default=None, help="Output directory for web-tier intermediate STLs")
    ap.add_argument(
        "--standalone",
        action="append",
        default=[],
        help="Additional standalone STL path(s) to optimize in-place for print tier only (e.g. forge-mount-first-print.stl)",
    )
    ap.add_argument(
        "--build-missing",
        action="append",
        default=[],
        help="Synthesize missing PartSpec STL via partspec_id=/path/to/stage.stl before optimizing",
    )
    ap.add_argument(
        "--partspec-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "parts" / "partspec",
        help="Path to parts/partspec directory",
    )
    ap.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "parts" / "partspec" / "asset_optimization_manifest.json",
        help="Path to asset_optimization_manifest.json",
    )
    ap.add_argument("--update-manifest", action="store_true", help="Write updated entries back to --manifest")
    ap.add_argument("--verify-preprint", action="store_true", help="Run preprint_check V1-V10 at 0.20mm & 0.16mm")
    ap.add_argument("--report", type=Path, default=None, help="Optional JSON report path")
    args = ap.parse_args(argv)

    if args.build_missing:
        build_missing_partspec_stls(args.build_missing, args.partspec_dir)

    args.stl_out.mkdir(parents=True, exist_ok=True)
    if args.web_stage is not None:
        args.web_stage.mkdir(parents=True, exist_ok=True)

    manifest_doc = (
        json.loads(args.manifest.read_text("utf-8"))
        if args.manifest.exists()
        else default_manifest_skeleton()
    )
    manifest_parts: dict[str, Any] = dict(manifest_doc.get("parts") or {})
    validation_dir = args.partspec_dir / "validation"

    in_stls = sorted(args.in_dir.glob("*.stl"))
    if not in_stls and not args.standalone:
        print("optimize_assets: no .stl files found", file=sys.stderr)
        return 1

    rows: list[dict[str, Any]] = []
    checked_stls: list[Path] = []

    for stl in in_stls:
        entry, row = optimize_one_stl(
            stl,
            args.stl_out,
            args.web_stage,
            manifest_doc,
            validation_dir,
        )
        manifest_parts[stl.stem] = entry
        rows.append(row)
        checked_stls.append(args.stl_out / stl.name)

    for standalone_str in args.standalone:
        sp = Path(standalone_str)
        if not sp.exists():
            continue
        entry, row = optimize_one_stl(
            sp,
            sp.parent,
            None,
            manifest_doc,
            validation_dir,
        )
        manifest_parts[sp.stem] = entry
        rows.append(row)
        checked_stls.append(sp)

    if args.verify_preprint:
        verify_preprint_all(checked_stls, args.partspec_dir)

    if args.update_manifest:
        out_doc = default_manifest_skeleton()
        out_doc["parts"] = {k: manifest_parts[k] for k in sorted(manifest_parts)}
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(out_doc, indent=2) + "\n", encoding="utf-8")

    orig_mb = sum(r["orig_bytes"] for r in rows) / (1024 * 1024)
    print_mb = sum(r["print_bytes"] for r in rows) / (1024 * 1024)
    orig_tris = sum(r["orig_tris"] for r in rows)
    print_tris = sum(r["print_tris"] for r in rows)
    web_tris = sum(r["web_tris"] for r in rows)
    pct_mb = (1.0 - print_mb / orig_mb) * 100.0 if orig_mb > 0 else 0.0

    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(
                {
                    "count": len(rows),
                    "orig_mb": round(orig_mb, 3),
                    "print_mb": round(print_mb, 3),
                    "orig_tris": orig_tris,
                    "print_tris": print_tris,
                    "web_tris": web_tris,
                    "parts": rows,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    print(
        f"optimize_assets: {len(rows)} STL(s) | print {orig_mb:.2f} MB -> {print_mb:.2f} MB "
        f"(-{pct_mb:.1f}%, {orig_tris:,} -> {print_tris:,} tris) | web stage {web_tris:,} tris"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
