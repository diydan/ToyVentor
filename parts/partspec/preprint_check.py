#!/usr/bin/env python3
"""Pre-print validation for any STL, before it is printed or ordered.

Stage 1 (always, pure Python: trimesh + manifold3d, both permissively licensed) checks the mesh as a printer would see it:
  V1 mesh is sound, V2 sits on the bed, V3 fits the bed, V4 no steep overhangs, V5 no islands that start in mid-air,
  V6 bridges within the limit, V7 no features thinner than the nozzle, V8 wall thickness, V9 bed contact and slenderness.
Stage 2 (when a slicer is installed) slices the part with PrusaSlicer's command line and records filament, time, cost, layers and
  the slicer's own stability warnings. If it reports low bed adhesion, the part is re-sliced with a growing brim and the smallest brim
  that clears it is recommended as a per-part print setting.

Usage:
  python3 preprint_check.py part.stl [more.stl ...] [--profile print_profiles/fdm_pla_0.4.json] [--out validation] [--no-slice]
  python3 preprint_check.py --catalog            # every catalog part listed in toyventor_parts.json
In code:
  from preprint_check import check_stl; report = check_stl("part.stl", profile)
The report format is defined in validation_report.schema.json.
"""
import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import CrossSection, JoinType, Manifold, Mesh

HERE = Path(__file__).parent
VERSION = "1.2.0"
SLICE_LOGIC = "1"          # bump only when the slicing stage itself changes; a cached slice is reused while this, the file and the profile match
DEFAULT_PROFILE = HERE / "print_profiles" / "fdm_pla_0.4.json"


# ---------------------------------------------------------------- loading
def load(path):
    tm = trimesh.load(str(path), force="mesh", process=True)
    mani = None
    if tm.is_watertight:
        m = Manifold(Mesh(vert_properties=np.asarray(tm.vertices, dtype=np.float32), tri_verts=np.asarray(tm.faces, dtype=np.uint32)))
        if m.status().name == "NoError" and not m.is_empty():
            mani = m
    return tm, mani


def _check(cid, level, ok, value=None, limit=None, detail=""):
    return {"id": cid, "level": level, "result": "pass" if ok else ("fail" if level == "block" else "warn"), "value": value, "limit": limit, "detail": detail}


# ---------------------------------------------------------------- stage 1: geometry
def steep_overhang_area(tm, lim):
    n, c, a = tm.face_normals, tm.triangles_center, tm.area_faces
    down = (n[:, 2] < -math.sin(math.radians(lim["max_overhang_deg"]))) & (c[:, 2] > lim["first_layer_exclusion_mm"])
    flat = n[:, 2] < -0.98                                  # flat ceilings are bridges, judged by V6
    return float(a[down & ~flat].sum())


def _inscribed_span(cs):
    """Twice the largest distance any point of the region sits from its edge: how far the bridge must reach from a support."""
    lo, hi = 0.0, 200.0
    for _ in range(18):
        mid = (lo + hi) / 2
        if cs.offset(-mid, JoinType.Round).is_empty():
            hi = mid
        else:
            lo = mid
    return 2 * lo


def flat_regions(tm, lim):
    """Connected flat downward regions above the first layers, each as (height, 2D region)."""
    from manifold3d import FillRule
    n, c = tm.face_normals, tm.triangles_center
    sel = np.where((n[:, 2] < -0.98) & (c[:, 2] > lim["first_layer_exclusion_mm"]))[0]
    if len(sel) == 0:
        return []
    idx = {f: k for k, f in enumerate(sel)}
    adj = [(idx[a], idx[b]) for a, b in tm.face_adjacency if a in idx and b in idx]
    out = []
    for g in trimesh.graph.connected_components(adj, nodes=np.arange(len(sel)), min_len=1):
        tris = tm.vertices[tm.faces[sel[g]]][:, :, :2]
        region = CrossSection([t[::-1].astype(float) for t in tris], FillRule.NonZero)
        if not region.is_empty() and region.area() >= 0.05:
            out.append((float(c[sel[g], 2].mean()), region))
    return out


def bridge_spans(tm, lim):
    """Each flat downward region is a bridge. Its span is twice the largest distance from any of its points to the region's edge (the walls
    or tubes it hangs from), so a roof held up by inner tubes is measured between supports."""
    return [{"z_mm": round(z, 2), "span_mm": round(_inscribed_span(r), 2), "area_mm2": round(r.area(), 1)} for z, r in flat_regions(tm, lim)]


def layer_analysis(mani, lh, lim, height):
    """Slice at every layer centre. Islands: material that does not rest, layer by layer, on something that reaches the bed. A spike
    hanging from a roof starts as a speck in mid-air and grows on itself, so support is tracked up through the layers, and the island is
    reported (at the height it began) once it is bigger than a speck.
    Thin features: pieces narrower than the nozzle that carry on into the layer above (a dome's very top is narrow for one layer
    and slicers simply skip it, so summits are not counted)."""
    tol = lh * math.tan(math.radians(lim["max_overhang_deg"])) + 0.05
    half = lim["min_feature_mm"] / 2
    zs = np.arange(lh / 2, height, lh)
    layers = [mani.slice(float(z)) for z in zs]
    islands, thin = [], []
    supported = None                      # material in the layer below that itself rests on the bed, through the layers
    chain_start = {}                      # unsupported chains: z where each began, so a growing hanging spike is reported once it is real
    for k, (z, cs) in enumerate(zip(zs, layers)):
        above = layers[k + 1] if k + 1 < len(layers) else None
        now = CrossSection()
        if cs.is_empty():
            supported = now
            continue
        grown = supported.offset(tol, JoinType.Round) if supported is not None else None
        for piece in cs.decompose():
            if grown is None or (piece ^ grown).area() > 1e-3:
                now = now + piece
            else:
                start = next((z0 for z0, prev in chain_start.items() if (piece ^ prev.offset(tol, JoinType.Round)).area() > 1e-3), float(z))
                chain_start[start] = piece
                if piece.area() > 0.05 and not any(i["z_mm"] == round(start, 2) for i in islands):
                    islands.append({"z_mm": round(start, 2), "area_mm2": round(piece.area(), 2)})
            if piece.area() > 0.01 and piece.offset(-half, JoinType.Round).is_empty():
                if above is not None and not above.is_empty() and (piece ^ above).area() > 1e-4:
                    thin.append({"z_mm": round(float(z), 2), "area_mm2": round(piece.area(), 3)})
        supported = now
    return islands, thin, (layers[0] if layers else None), len(zs)


def _face_centre(tm, t, k):
    return [round(float(v), 2) for v in tm.triangles_center[_SAMPLED[0][k]]] if _SAMPLED else None


_SAMPLED = []


def wall_thickness(tm, max_faces=6000):
    """Cast a ray inward from each sampled face to the opposite wall. Returns (thickness per sampled face, sampled face areas)."""
    rng = np.random.default_rng(0)
    faces = np.arange(len(tm.faces))
    if len(faces) > max_faces:
        p = tm.area_faces / tm.area_faces.sum()
        faces = np.unique(rng.choice(faces, max_faces, replace=False, p=p))
    _SAMPLED[:] = [faces]                                   # [faces, hit face per ray] for callers that need them
    origins = tm.triangles_center[faces] - tm.face_normals[faces] * 1e-3
    dirs = -tm.face_normals[faces]
    t = np.full(len(faces), np.inf)
    hit = np.full(len(faces), -1)
    def _cast(a, b):
        """Cast rays a..b. A batch whose rays each graze millions of candidate triangles (long thin fans on a smooth dome) can run out of
        memory: on MemoryError the batch is halved and retried, down to single rays, so the result never depends on available memory."""
        try:
            locs, ray_idx, tri_idx = tm.ray.intersects_location(origins[a:b], dirs[a:b], multiple_hits=False)
        except MemoryError:
            if b - a <= 1:
                return
            mid = (a + b) // 2
            _cast(a, mid)
            _cast(mid, b)
            return
        t[a + ray_idx] = np.linalg.norm(locs - origins[a:b][ray_idx], axis=1) + 1e-3
        hit[a + ray_idx] = tri_idx
    for a in range(0, len(faces), 1000):                    # chunks keep memory flat on dense meshes
        _cast(a, min(a + 1000, len(faces)))
    _SAMPLED.append(hit)
    return t, tm.area_faces[faces]


def _meets_at_edge(tm, faces, hits, reach):
    """True where the ray's own face and the face it hit are joined along the surface within `reach` mm: the two sides meet at an edge
    close by, so the 'thin wall' is just the approach to a sharp edge, which slicers handle. A skin over a hole is different: its two
    sides are near in space but far apart along the surface (down the hole, across the bed, back up)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    e = tm.edges_unique
    w = tm.edges_unique_length
    n = len(tm.vertices)
    g = coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    out = np.zeros(len(faces), dtype=bool)
    for k, (f, h) in enumerate(zip(faces, hits)):
        if h < 0:
            continue
        d = dijkstra(g, indices=tm.faces[f], limit=reach, min_only=True)
        out[k] = bool(np.isfinite(d[tm.faces[h]]).any())
    return out


def thin_regions(tm, min_wall):
    """Thin faces (inward ray meets the opposite wall within min_wall), grouped into connected regions. A sharp edge gives a few thin
    faces right at its tip; a skin over a hole or a thin floor gives a connected region with real area. Sorted thinnest first."""
    t, _ = wall_thickness(tm, max_faces=len(tm.faces))
    hit = _SAMPLED[1]
    thin = np.where(t < min_wall)[0]
    if len(thin) == 0:
        return []
    thin = thin[~_meets_at_edge(tm, thin, hit[thin], reach=3.0)]
    if len(thin) == 0:
        return []
    idx = {f: k for k, f in enumerate(thin)}
    adj = [(idx[a], idx[b]) for a, b in tm.face_adjacency if a in idx and b in idx]
    out = []
    for g in trimesh.graph.connected_components(adj, nodes=np.arange(len(thin)), min_len=1):
        faces = thin[g]
        k = faces[np.argmin(t[faces])]
        out.append({"area_mm2": round(float(tm.area_faces[faces].sum()), 2), "min_mm": round(float(t[k]), 3),
                    "at_mm": [round(float(v), 2) for v in tm.triangles_center[k]]})
    return sorted(out, key=lambda r: r["min_mm"])


def geometry_checks(tm, mani, prof):
    lim, pr = prof["limits"], prof["process"]
    lo, hi = tm.bounds
    size = hi - lo
    checks, metrics = [], {"bbox_mm": size.round(2).tolist(), "volume_cm3": round(float(tm.volume) / 1000, 2) if tm.is_watertight else None,
                           "surface_cm2": round(float(tm.area) / 100, 2), "triangles": int(len(tm.faces))}
    bodies = len(tm.split(only_watertight=False))
    sound = bool(tm.is_watertight and tm.is_winding_consistent and bodies == 1 and mani is not None)
    checks.append(_check("V1_mesh_sound", "block", sound, None, None,
                         f"watertight {tm.is_watertight}, consistent winding {tm.is_winding_consistent}, {bodies} body(ies)"))
    checks.append(_check("V2_on_bed", "block", abs(lo[2]) < 1e-3, round(float(lo[2]), 4), 0.0, "lowest point must be on the bed (z = 0)"))
    bed = prof["printer"]["bed_mm"]
    checks.append(_check("V3_fits_bed", "block", all(size[i] <= bed[i] for i in range(3)), size.round(1).tolist(), bed))
    steep = steep_overhang_area(tm, lim)
    checks.append(_check("V4_no_steep_overhang", "block", steep < lim["steep_area_tolerance_mm2"], round(steep, 2), lim["steep_area_tolerance_mm2"],
                         f"mm2 of downward surface steeper than {lim['max_overhang_deg']} deg (flat bridges excluded)"))
    if mani is not None:
        import toyventor_ledge as _tl
        _tl.CANTILEVER_MM = lim.get("ledge_cantilever_mm", 1.0)
        ledge_area, ledge_regions = _tl.ledges(tm, mani, lim["max_bridge_mm"], lim["first_layer_exclusion_mm"])
        metrics["ledges"] = ledge_regions[:5]
        checks.append(_check("V10_no_ledges", "block", ledge_area < lim.get("ledge_max_mm2", 1.0), ledge_area, lim.get("ledge_max_mm2", 1.0),
                             "mm2 of flat underside held on one side only (a ledge over air, not a bridge)"
                             + (f"; worst at z {ledge_regions[0]['z_mm']} mm near {ledge_regions[0]['at_mm']}" if ledge_regions else "")))
        fc_issues = _tl.floating_contours(
            tm, mani,
            max_bridge_mm=lim["max_bridge_mm"],
            exclusion_mm=lim["first_layer_exclusion_mm"],
            min_loop_mm=lim.get("floating_loop_min_mm", 12.0),
            ledge_max_mm2=lim.get("ledge_max_mm2", 1.0),
        )
        metrics["floating_contours"] = fc_issues[:5]
        checks.append(_check(
            "V11_floating_contour", "block", not fc_issues, len(fc_issues), 0,
            "unanchored interior hole loops in bridge ceilings or low-Z hovering cantilevers"
            + (f"; first ({fc_issues[0]['kind']}) at z {fc_issues[0]['z_mm']} mm near {fc_issues[0]['at_mm']}" if fc_issues else ""),
        ))
    spans = bridge_spans(tm, lim)
    worst = max((s["span_mm"] for s in spans), default=0.0)
    checks.append(_check("V6_bridge_span", "block", worst <= lim["max_bridge_mm"], worst, lim["max_bridge_mm"], f"{len(spans)} bridge(s); widest unsupported span in mm"))
    if mani is not None:
        islands, thin, contact, layers = layer_analysis(mani, pr["layer_height_mm"], lim, float(size[2]))
        checks.append(_check("V5_no_floating_islands", "block", not islands, len(islands), 0,
                             "material not resting, layer by layer, on anything that reaches the bed" + (f"; first at z {islands[0]['z_mm']} mm" if islands else "")))
        checks.append(_check("V7_min_feature", "warn", not thin, len(thin), 0,
                             f"layer pieces narrower than {lim['min_feature_mm']} mm" + (f"; first at z {thin[0]['z_mm']} mm" if thin else "")))
        area = contact.area() if contact is not None else 0.0
        metrics.update(layers=layers, bed_contact_mm2=round(area, 1), height_mm=round(float(size[2]), 2),
                       slenderness=round(float(size[2]) / math.sqrt(area), 2) if area > 0 else None)
        com = tm.center_mass[:2] if tm.is_watertight else None
        inside = None
        if contact is not None and not contact.is_empty() and com is not None:
            hull = contact.hull()
            inside = bool((hull ^ CrossSection.square((0.01, 0.01), center=True).translate(tuple(com))).area() > 0)
        metrics["centre_of_mass_over_contact"] = inside
        checks.append(_check("V9_bed_contact", "info", bool(area > 0 and inside is not False), metrics["bed_contact_mm2"], None,
                             f"height / sqrt(contact) = {metrics['slenderness']}; above about 3 the slicer often asks for a brim"))
    else:
        checks.append(_check("V5_no_floating_islands", "block", False, None, 0, "skipped: mesh is not sound"))
    if tm.is_watertight:
        regions = thin_regions(tm, lim["min_wall_mm"])
        big = [r for r in regions if r["area_mm2"] >= lim["thin_wall_area_tolerance_mm2"]
               or (r["min_mm"] < lim["min_feature_mm"] and r["area_mm2"] >= lim["thin_wall_severe_area_tolerance_mm2"])]
        metrics["min_wall_mm"] = regions[0]["min_mm"] if regions else None
        metrics["thin_wall_regions"] = big[:5]
        checks.append(_check("V8_wall_thickness", "warn", not big, len(big), 0,
                             f"regions where the wall is under {lim['min_wall_mm']} mm (two nozzle widths) over {lim['thin_wall_area_tolerance_mm2']} mm2, or under {lim['min_feature_mm']} mm (one nozzle width) over {lim['thin_wall_severe_area_tolerance_mm2']} mm2"
                             + (f"; worst {big[0]['min_mm']} mm at {big[0]['at_mm']}" if big else "; sharp edges and slivers are ignored")))
    return checks, metrics, spans


# ---------------------------------------------------------------- stage 2: slicer
def find_slicer():
    for c in (os.environ.get("PRUSASLICER"), shutil.which("prusa-slicer"), shutil.which("PrusaSlicer"), "/tmp/squashfs-root/AppRun"):
        if c and Path(c).exists():
            return c
    return None


def _slicer_args(prof, brim=0):
    p, pr, f = prof["printer"], prof["process"], prof["filament"]
    bx, by, bz = p["bed_mm"]
    args = ["--nozzle-diameter", str(p["nozzle_mm"]), "--filament-diameter", str(p["filament_diameter_mm"]),
            "--layer-height", str(pr["layer_height_mm"]), "--first-layer-height", str(pr["first_layer_height_mm"]),
            "--perimeters", str(pr["perimeters"]), "--fill-density", f"{pr['infill_pct']}%",
            "--top-solid-layers", str(pr["top_layers"]), "--bottom-solid-layers", str(pr["bottom_layers"]),
            "--bed-shape", f"0x0,{bx}x0,{bx}x{by},0x{by}", "--max-print-height", str(bz), "--center", f"{bx / 2},{by / 2}",
            "--filament-density", str(f["density_g_cm3"]), "--filament-cost", str(f["cost_per_kg_usd"]), "--brim-width", str(brim)]
    args.append("--support-material" if pr["supports"] else "--no-support-material")
    return args


def _parse_time(s):
    secs = 0
    for v, u in re.findall(r"(\d+)\s*([dhms])", s):
        secs += int(v) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[u]
    return secs


def _slice_once(exe, stl, prof, brim):
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "part.gcode"
        t0 = time.time()
        r = subprocess.run([exe, *_slicer_args(prof, brim), "--export-gcode", "--output", str(out), str(stl)], capture_output=True, text=True, timeout=600)
        log = r.stdout + r.stderr
        res = {"ok": r.returncode == 0 and out.exists(), "brim_mm": brim, "seconds_to_slice": round(time.time() - t0, 1)}
        warn, grab = [], False
        for line in log.splitlines():
            s = line.strip()
            if "Detected print stability issues" in s:
                grab = True
                continue
            if grab:
                if not s or s.endswith(".stl"):
                    continue
                if s.startswith(("Consider", "Also consider")):
                    grab = False
                    continue
                warn += [w.strip() for w in s.split(",") if w.strip()]
            elif re.search(r"(?i)empty layer", s) and "=>" not in s:
                warn.append("Empty layer")
            elif re.search(r"(?i)\berror\b", s) and "=>" not in s:
                warn.append(s)
        res["warnings"] = sorted(set(warn))
        if res["ok"]:
            g = out.read_text(errors="ignore")
            def grab_val(pat):
                m = re.search(pat, g)
                return m.group(1).strip() if m else None
            res["filament_g"] = float(grab_val(r"; (?:total )?filament used \[g\] = ([\d.]+)") or 0)
            res["filament_m"] = round(float(grab_val(r"; filament used \[mm\] = ([\d.]+)") or 0) / 1000, 2)
            res["filament_cost_usd"] = float(grab_val(r"; (?:total )?filament cost = ([\d.]+)") or 0)
            ts = grab_val(r"; estimated printing time \(normal mode\) = (.+)")
            res["print_time_s"] = _parse_time(ts) if ts else None
            res["layers"] = g.count(";LAYER_CHANGE")
            # Post-slice G-code static preflight: count bridge sections and flag ultra-short layers (< 4 s) with cooling risk
            res["bridge_sections"] = len(re.findall(r";(?:TYPE|FEATURE):\s*Bridge", g, re.IGNORECASE))
            layer_times = []
            cur_t = 0.0
            has_ext = False
            for gl in g.splitlines():
                if gl.startswith(";LAYER_CHANGE"):
                    if has_ext and cur_t > 0:
                        layer_times.append(cur_t)
                    cur_t, has_ext = 0.0, False
                elif gl.startswith("G1 "):
                    fm = re.search(r"F([\d.]+)", gl)
                    if fm:
                        last_f = float(fm.group(1))
                    if "E" in gl and "last_f" in locals() and last_f > 1.0:
                        has_ext = True
                        xm = re.search(r"X([-\d.]+)", gl)
                        ym = re.search(r"Y([-\d.]+)", gl)
                        if xm and ym and "lx" in locals():
                            cur_t += math.hypot(float(xm.group(1)) - lx, float(ym.group(1)) - ly) / (last_f / 60.0)
                        if xm:
                            lx = float(xm.group(1))
                        if ym:
                            ly = float(ym.group(1))
            if len(layer_times) > 2:
                # Ignore final summit cap layer
                core_lt = layer_times[:-1]
                res["min_layer_time_s"] = round(min(core_lt), 2)
                res["short_cooling_layers"] = sum(1 for lt in core_lt if lt < 4.0)
        else:
            res["error"] = log.strip().splitlines()[-3:] if log.strip() else ["slicer failed"]
        return res


def slice_check(stl, prof, exe):
    """Slice; if the slicer reports low bed adhesion, try each brim step and keep the smallest one that clears it."""
    first = _slice_once(exe, stl, prof, 0)
    final, tried = first, [0]
    if first["ok"] and any("bed adhesion" in w.lower() for w in first["warnings"]):
        for b in prof.get("brim_steps_mm", []):
            r = _slice_once(exe, stl, prof, b)
            tried.append(b)
            if r["ok"] and not any("bed adhesion" in w.lower() for w in r["warnings"]):
                final = r
                break
            final = r
    final["warnings_without_brim"] = first["warnings"]
    final["brims_tried_mm"] = tried
    return final


def slicer_version(exe):
    r = subprocess.run([exe, "--help"], capture_output=True, text=True, timeout=60)
    first = (r.stdout.strip().splitlines() or ["PrusaSlicer"])[0]
    m = re.match(r"(PrusaSlicer-[\d.]+)", first)
    return m.group(1) if m else first[:40]


# ---------------------------------------------------------------- report
def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_stl(path, prof, exe=None, part_id=None, cached=None):
    """cached: an earlier report for this file. Its slice is reused when the file fingerprint, profile and validator match."""
    path = Path(path)
    sha = file_sha256(path)
    tm, mani = load(path)
    checks, metrics, spans = geometry_checks(tm, mani, prof)
    report = {"validator": f"preprint_check {VERSION}", "file": path.name, "file_sha256": sha, "part_id": part_id or path.stem, "profile": prof["id"],
              "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "metrics": metrics, "bridges": spans, "checks": checks,
              "print_settings": {}, "slicer": None}
    reuse = cached and cached.get("file_sha256") == sha and cached.get("profile") == prof["id"] and cached.get("slicer") \
        and cached["slicer"].get("slice_logic", "1") == SLICE_LOGIC
    if exe or reuse:
        if reuse:
            s = dict(cached["slicer"], reused_from=cached["checked_at"])
        else:
            s = slice_check(path, prof, exe)
            s["engine"] = slicer_version(exe)
            s["slice_logic"] = SLICE_LOGIC
        report["slicer"] = s
        report["checks"].append(_check("S1_slices", "block", s["ok"], None, None, "; ".join(s.get("error", [])) or "sliced without errors"))
        levels = {k: v for k, v in prof.get("slicer_warning_levels", {}).items() if not k.startswith("_")}
        def level(w):
            return next((v for k, v in levels.items() if k.lower() in w.lower()), "warn")
        left = s["warnings"]
        fixed_by_brim = s["brim_mm"] > 0 and not any(level(w) == "brim" for w in left)
        if fixed_by_brim:
            report["print_settings"]["brim_width_mm"] = s["brim_mm"]
        hard = [w for w in left if level(w) == "block"]
        soft = [w for w in left if level(w) in ("warn", "brim")]
        notes = [w for w in left if level(w) == "info"]
        report["checks"].append(_check("S2_slicer_stability", "warn", not soft, soft or None, None,
                                       ("; ".join(filter(None, [f"low bed adhesion without a brim; a {s['brim_mm']} mm brim clears it" if fixed_by_brim else "",
                                                                 ("noted: " + ", ".join(notes)) if notes else ""])) or "no stability warnings")))
        report["checks"].append(_check("S3_slicer_blocking", "block", not hard, hard or None, None,
                                       "slicer found parts that would print in mid-air" if hard else "nothing the slicer would print in mid-air"))

    blocks = [c for c in report["checks"] if c["result"] == "fail"]
    warns = [c for c in report["checks"] if c["result"] == "warn"]
    report["verdict"] = "fail" if blocks else ("pass_with_warnings" if warns else ("pass_with_settings" if report["print_settings"] else "pass"))
    report["summary"] = ("Blocked: " + ", ".join(c["id"] for c in blocks)) if blocks else \
                        ("Warnings: " + ", ".join(c["id"] for c in warns)) if warns else \
                        ("Prints with " + ", ".join(f"{k} = {v}" for k, v in report["print_settings"].items())) if report["print_settings"] else "Prints as is"
    return report


def _row(rep):
    s = rep["slicer"] or {}
    return {"part_id": rep["part_id"], "file": rep["file"], "verdict": rep["verdict"], "summary": rep["summary"],
            "filament_g": s.get("filament_g"), "print_time_min": round(s["print_time_s"] / 60, 1) if s.get("print_time_s") else None,
            "filament_cost_usd": s.get("filament_cost_usd"), "brim_mm": rep["print_settings"].get("brim_width_mm", 0),
            "height_mm": rep["metrics"].get("height_mm"), "bed_contact_mm2": rep["metrics"].get("bed_contact_mm2"),
            "slenderness": rep["metrics"].get("slenderness"), "min_wall_mm": rep["metrics"].get("min_wall_mm")}


def summarize(out):
    """Rebuild summary.json and summary.csv from every report in `out` (so parts can be checked one at a time, as the app will)."""
    out = Path(out)
    reps = [json.loads(f.read_text()) for f in sorted(out.glob("*.json")) if f.name != "summary.json"]
    rows = [_row(r) for r in reps]
    counts = {v: sum(r["verdict"] == v for r in rows) for v in ("pass", "pass_with_settings", "pass_with_warnings", "fail")}
    engines = sorted({(r["slicer"] or {}).get("engine") for r in reps} - {None})
    summary = {"validator": f"preprint_check {VERSION}", "profile": reps[0]["profile"] if reps else None, "slicer": engines[0] if engines else None,
               "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "counts": counts, "parts": rows}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if rows:
        with open(out / "summary.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    return summary


def run(files, prof, out, exe, ids=None):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for k, f in enumerate(files):
        pid = ids[k] if ids else Path(f).stem
        prev = out / f"{pid}.json"
        cached = json.loads(prev.read_text()) if prev.exists() else None
        rep = check_stl(f, prof, exe, pid, cached)
        (out / f"{rep['part_id']}.json").write_text(json.dumps(rep, indent=2) + "\n")
        print(f"{rep['verdict']:20s} {rep['part_id']:28s} {rep['summary'][:90]}")
    return summarize(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="*")
    ap.add_argument("--catalog", action="store_true", help="check every printable catalog part")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE))
    ap.add_argument("--out", default=str(HERE / "validation"))
    ap.add_argument("--no-slice", action="store_true", help="geometry checks only")
    ap.add_argument("--part", action="append", help="with --catalog: only these part ids (repeatable)")
    ap.add_argument("--summarize", action="store_true", help="only rebuild summary.json / summary.csv from the reports in --out")
    a = ap.parse_args(argv)
    prof = json.loads(Path(a.profile).read_text())
    if a.summarize:
        print(json.dumps(summarize(a.out)["counts"]))
        return 0
    files, ids = list(a.files), None
    if a.catalog:
        man = json.loads((HERE / "toyventor_parts.json").read_text())
        parts = [p for p in man["parts"] if p.get("file") and (not a.part or p["id"] in a.part)]
        files = [(HERE / p["file"]) if (HERE / p["file"]).exists() else (HERE / "out" / p["file"]) for p in parts]
        ids = [p["id"] for p in parts]
    if not files:
        ap.error("give STL files or --catalog")
    exe = None if a.no_slice else find_slicer()
    if not a.no_slice and not exe:
        print("no slicer found (set PRUSASLICER to its path); running geometry checks only")
    s = run(files, prof, a.out, exe, ids)
    print(json.dumps(s["counts"]))
    return 0 if s["counts"]["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
