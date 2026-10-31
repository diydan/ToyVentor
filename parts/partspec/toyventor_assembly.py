#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Connector-driven assembly for ToyVentor parts.

The pattern (borrowed from brick-building tools and CAD joint systems):
  * parts carry typed, gendered CONNECTORS (point + direction + grid), stored as metadata
  * a generator (human or AI) proposes placements as "attach connector A to connector B"
  * a validator accepts or rejects each build with specific, machine-readable errors

The AI never writes coordinates. It picks parts, connectors and grid cells; attach()
computes the pose, so alignment is correct by construction. validate() then checks
what construction cannot: size classes, floating parts, collisions.
"""
import json
import math
import sys
from itertools import combinations
from pathlib import Path

import numpy as np

import toyventor_parts as tp
import toyventor_pro as pro
from toyventor_fit import fit_report
from toyventor_index import complementary   # one definition of 'can these mate'

TOL_XY, TOL_Z, COLLISION_MM3 = 0.05, 0.01, 1.0
ENFORCED_MATES = [("stud_grid", "socket_grid"), ("pin", "bore_grid")]


def rot_xy(x, y, rot):
    return [(x, y), (-y, x), (-x, -y), (y, -x)][rot % 4]


class Library:
    def __init__(self, manifest_path, builders=None):
        man = json.loads(Path(manifest_path).read_text())
        self.parts = {p["id"]: p for p in man["parts"] if p.get("file")}
        self.builders = builders or {}      # id -> fn() for parts outside the catalog registry (test fixtures)
        self._geo = {}

    def conn(self, part_id, conn_id):
        for c in self.parts[part_id]["connectors"]:
            if c["id"] == conn_id:
                return c
        raise KeyError(f"{part_id} has no connector '{conn_id}'")

    def geometry(self, part_id):
        if part_id not in self._geo:
            self._geo[part_id] = (self.builders[part_id]() if part_id in self.builders else tp.build(part_id))[0]
        return self._geo[part_id]

    def catalog(self):
        """Compact description for an AI prompt."""
        rows = []
        for p in self.parts.values():
            cs = [f"{c['id']}:{c['kind']}/{c['gender']}/{c['size_class']}" + (f"/{c['grid']['nx']}x{c['grid']['ny']}" if 'grid' in c else "")
                  for c in p["connectors"]]
            rows.append(f"{p['id']} [{p['line']}, {p['size_class']}] tags={','.join(p['tags'])} stat={p['stat']} connectors=({'; '.join(cs)})")
        return "\n".join(rows)

    def compat_graph(self):
        """Which connector can mate with which (type + gender + size class)."""
        edges = []
        for a in self.parts.values():
            for ca in a["connectors"]:
                for b in self.parts.values():
                    for cb in b["connectors"]:
                        if complementary(ca, cb) and ca["gender"] == "M":
                            edges.append({"male": f"{a['id']}.{ca['id']}", "female": f"{b['id']}.{cb['id']}"})
        return edges




def cell_local(conn, i, j):
    g = conn["grid"]
    if g.get("anchor") == "corner":                    # Pro grids start at the first bore / the pin axis
        return conn["frame"]["origin"][0] + i * g["pitch"], conn["frame"]["origin"][1] + j * g["pitch"]
    return (i + 0.5 - g["nx"] / 2) * g["pitch"], (j + 0.5 - g["ny"] / 2) * g["pitch"]


def world_cells(conn, pose):
    g, out = conn["grid"], []
    omit = {tuple(c) for c in g.get("omit_cells", [])}
    for i in range(g["nx"]):
        for j in range(g["ny"]):
            if (i, j) in omit:
                continue
            lx, ly = rot_xy(*cell_local(conn, i, j), pose["rot"])
            out.append((pose["x"] + lx, pose["y"] + ly, pose["z"] + conn["frame"]["origin"][2]))
    return out


def place(part, x=0.0, y=0.0, z=0.0, rot=0, pid=None, tilt=(0, 0)):
    """tilt = (rx, ry) degrees, applied before the quarter turn about z (same order as Manifold.rotate). Most parts stay flat (tilt 0)."""
    pose = {"x": x, "y": y, "z": z, "rot": rot % 4}
    if tilt and any(tilt):
        pose["tilt"] = [float(tilt[0]), float(tilt[1])]
    return {"id": pid or part, "part": part, "pose": pose}


def pose_R(pose):
    rx, ry = pose.get("tilt", [0, 0])
    return pro.rot_matrix(rx, ry, 90 * pose["rot"])


def conn_axis(conn, pose, i=0, j=0):
    """World point and direction of a pin's or bore's axis at grid cell (i, j)."""
    R = pose_R(pose)
    lx, ly = cell_local(conn, i, j)
    p = R @ np.array([lx, ly, conn["frame"]["origin"][2]]) + np.array([pose["x"], pose["y"], pose["z"]])
    return p, R @ np.asarray(conn["frame"].get("normal", [0, 0, 1]), dtype=float)


def place_on_axis(lib, parent, parent_conn, child_part, child_conn, along=0.0, pid=None, parent_cell=(0, 0)):
    """Seat a pin, shaft or hub on any axis: turn child_part in quarter turns until its connector's axis runs along the parent's, then slide
    it `along` mm from the parent connector's origin."""
    cp, cc = lib.conn(parent["part"], parent_conn), lib.conn(child_part, child_conn)
    if not complementary(cp, cc):
        raise ValueError(f"cannot mate {parent['part']}.{parent_conn} with {child_part}.{child_conn}")
    P, u = conn_axis(cp, parent["pose"], *parent_cell)
    nc = np.asarray(cc["frame"].get("normal", [0, 0, 1]), dtype=float)
    fp, fc = pro.flats_normal(cp), pro.flats_normal(cc)
    fp_w = pose_R(parent["pose"]) @ fp if fp is not None and fc is not None else None
    for rx in (0, 90, 180, 270):
        for ry in (0, 90, 180, 270):
            for rot in range(4):
                R = pro.rot_matrix(rx, ry, 90 * rot)
                if fp_w is not None and abs(abs(float((R @ fc) @ fp_w)) - 1) > 1e-6:
                    continue                                   # a flat-sided shaft only fits a fixed bore with the flats lined up
                if np.allclose(R @ nc, u, atol=1e-6):
                    o = R @ np.asarray(cc["frame"]["origin"], dtype=float)
                    t = P + u * along - o
                    return place(child_part, float(t[0]), float(t[1]), float(t[2]), rot, pid, (rx, ry))
    raise ValueError("no quarter-turn pose lines these axes up")


def attach(lib, parent, parent_conn, child_part, child_conn, parent_cell=(0, 0), child_cell=(0, 0), rot=0, pid=None, dz=0.0):
    """Place child_part so that child_conn mates with parent's parent_conn. The child's
    cell child_cell lands on the parent's cell parent_cell. rot is 0..3 quarter turns
    relative to the parent."""
    cp, cc = lib.conn(parent["part"], parent_conn), lib.conn(child_part, child_conn)
    if not complementary(cp, cc):
        raise ValueError(f"cannot mate {parent['part']}.{parent_conn} ({cp['kind']}/{cp['gender']}/{cp['size_class']}) "
                         f"with {child_part}.{child_conn} ({cc['kind']}/{cc['gender']}/{cc['size_class']})")
    for conn, cell, who in ((cp, parent_cell, parent["part"]), (cc, child_cell, child_part)):
        g = conn["grid"]
        if not (0 <= cell[0] < g["nx"] and 0 <= cell[1] < g["ny"]):
            raise ValueError(f"cell {cell} is outside {who}.{conn['id']} ({g['nx']}x{g['ny']})")
        if list(cell) in g.get("omit_cells", []):
            raise ValueError(f"cell {cell} on {who}.{conn['id']} has no connector (omitted)")
    pp = parent["pose"]
    lx, ly = rot_xy(*cell_local(cp, *parent_cell), pp["rot"])
    wx, wy = pp["x"] + lx, pp["y"] + ly
    total_rot = (pp["rot"] + rot) % 4
    cx, cy = rot_xy(*cell_local(cc, *child_cell), total_rot)
    z = pp["z"] + cp["frame"]["origin"][2] - cc["frame"]["origin"][2] + dz      # dz slides a pin along its bore
    return place(child_part, wx - cx, wy - cy, z, total_rot, pid)


def placed_geometry(lib, item):
    p = item["pose"]
    rx, ry = p.get("tilt", [0, 0])
    return lib.geometry(item["part"]).rotate((rx, ry, 90 * p["rot"])).translate((p["x"], p["y"], p["z"]))


def pin_bore_edge(lib, ma, cm, fb, cf):
    """A pin (male) and a bore (female) mate when their axes are parallel and coincide and their lengths overlap, on any axis. Returns {} when they
    do not touch, else an edge, plus an error (profile_mismatch), a fit warning, or a collision exemption (friction fins interfere by design)."""
    P, u = conn_axis(cm, ma["pose"])
    hit = None
    g = cf["grid"]
    omit = {tuple(c) for c in g.get("omit_cells", [])}
    for i in range(g["nx"]):
        for j in range(g["ny"]):
            if (i, j) in omit:
                continue
            B, v = conn_axis(cf, fb["pose"], i, j)
            if np.linalg.norm(np.cross(u, v)) > 1e-6:
                return {}
            d = (B - P) - ((B - P) @ u) * u
            if np.linalg.norm(d) < TOL_XY:
                hit = (B, v)
                break
        if hit:
            break
    if not hit:
        return {}
    B, v = hit
    p0 = P @ u
    b0, b1 = sorted([B @ u, (B + v * cf["depth_mm"]) @ u])
    lo, hi = max(p0, b0), min(p0 + cm["length_mm"], b1)
    if hi - lo < 0.5:
        return {}
    rule = next((r for r in pro.RULES if r["pin"] == cm["interface"] and r["bore"] == cf["bore_class"]), None)
    if rule is None:
        return {"error": {"code": "profile_mismatch", "detail": f"{ma['id']}.{cm['id']} ({cm['interface']}) cannot mate with {fb['id']}.{cf['id']} ({cf['bore_class']} bore)"}}
    out = {"edge": {"male": f"{ma['id']}.{cm['id']}", "female": f"{fb['id']}.{cf['id']}", "engaged_studs": 1, "fit": rule["fit"]}}
    if rule["fit"] == "friction":
        out["exempt"] = True
        out["rule"], out["rep"] = rule, None
        return out
    Ra = pro.align_to_z(u)                                   # measure in a frame where the shared axis points up
    T = np.c_[Ra, np.zeros(3)].tolist()
    mid = P + u * ((lo + hi) / 2 - p0)
    rep = fit_report(placed_geometry(lib, ma).transform(T), placed_geometry(lib, fb).transform(T), float((Ra @ mid)[2]))
    v_ = pro.pair_verdict(rule, rep)
    out["rule"], out["rep"] = rule, rep
    if rep["studs"]:
        out["edge"].update(gap_min_mm=round(rep["gap_min"], 3), gap_max_mm=round(rep["gap_max"], 3))
    if not v_["as_designed"]:
        out["warning"] = {"code": "fit_out_of_tolerance", "detail": f"{out['edge']['male']} with {out['edge']['female']}: measured gap {out['edge'].get('gap_min_mm')} to {out['edge'].get('gap_max_mm')} mm is outside the {rule['fit']} limits"}
    return out


def gear_mesh(lib, a, b):
    """Two gears (or a gear and a rack or ring) mesh when they share a z band and their pitch circles touch: centre distance m (z1 + z2) / 2,
    m (z_ring - z) / 2 for a gear inside a ring, or the pitch radius from a rack's pitch line. Returns {} when they are apart, an edge when they
    mesh, or a gear_mesh_distance error when the teeth reach each other at the wrong distance. Tooth phase is set at assembly, so meshing pairs
    are exempt from the collision check."""
    ga, gb = lib.parts[a["part"]].get("gear"), lib.parts[b["part"]].get("gear")
    if not ga or not gb or a["pose"].get("tilt") or b["pose"].get("tilt"):
        return {}
    ta, tb = ga.get("thickness_mm", pro.GEAR["thickness_tu"] * pro.TU), gb.get("thickness_mm", pro.GEAR["thickness_tu"] * pro.TU)
    if min(a["pose"]["z"] + ta, b["pose"]["z"] + tb) - max(a["pose"]["z"], b["pose"]["z"]) < 0.5:
        return {}
    ka, kb = ga.get("kind", "spur"), gb.get("kind", "spur")
    if ka == kb and ka in ("rack", "ring") or {ka, kb} == {"rack", "ring"}:
        return {}
    mod = pro.GEAR["module_mm"]
    if "rack" in (ka, kb):
        (rg, rp), (gg, gp) = ((ga, a), (gb, b)) if ka == "rack" else ((gb, b), (ga, a))
        ang = math.radians(90 * rp["pose"]["rot"])
        ux, uy = math.cos(ang), math.sin(ang)
        dx, dy = gp["pose"]["x"] - (rp["pose"]["x"] - uy * rg["pitch_line_mm"]), gp["pose"]["y"] - (rp["pose"]["y"] + ux * rg["pitch_line_mm"])
        d, along, want = -dx * uy + dy * ux, dx * ux + dy * uy, gg["pitch_d_mm"] / 2
        if abs(along) > rg["length_mm"] / 2 + want or d < -mod * 1.25 or d > want + mod * 1.25:
            return {}
        touching = True
    else:
        d = math.hypot(a["pose"]["x"] - b["pose"]["x"], a["pose"]["y"] - b["pose"]["y"])
        if "ring" in (ka, kb):
            (rg, _), (gg, _) = ((ga, a), (gb, b)) if ka == "ring" else ((gb, b), (ga, a))
            want = mod * (rg["teeth"] - gg["teeth"]) / 2
            touching = d + gg["outer_d_mm"] / 2 > rg["outer_d_mm"] / 2 - 0.01
        else:
            want = mod * (ga["teeth"] + gb["teeth"]) / 2
            touching = d < (ga["outer_d_mm"] + gb["outer_d_mm"]) / 2
    if abs(d - want) <= 0.05:
        if not _clocked_gear_clears(lib, a, ga, b, gb, ka, kb):
            return {"error": {"code": "gear_tooth_interference", "detail": f"{a['id']} and {b['id']} interfere during conjugate rotation at {d:.2f} mm"}}
        return {"edge": {"male": f"{a['id']}.teeth", "female": f"{b['id']}.teeth", "engaged_studs": 1, "fit": "mesh"}, "exempt": True}
    if touching:
        return {"error": {"code": "gear_mesh_distance", "detail": f"{a['id']} and {b['id']} are {d:.2f} mm apart; their teeth meet but they mesh at {want:.2f} mm"}}
    return {}


def _clocked_gear_clears(lib, a, ga, b, gb, ka, kb):
    """Verify real 3D conjugate tooth clearance: find a meshing phase across one tooth pitch and check 8 roll steps for < 0.05 mm^3 overlap."""
    # Pick the spur gear to phase-search around its Z axis
    if ka == "spur":
        sa, sg, ob, og, ok = a, ga, b, gb, kb
    else:
        sa, sg, ob, og, ok = b, gb, a, ga, ka
    zs = sg["teeth"]
    pitch_deg = 360.0 / zs
    pa, pb = sa["pose"], ob["pose"]
    ga_raw, gb_raw = lib.geometry(sa["part"]), lib.geometry(ob["part"])
    mb0 = gb_raw.rotate((0, 0, 90 * pb["rot"])).translate((pb["x"], pb["y"], pb["z"]))
    phi0 = None
    for s in range(32):
        ph = 90 * pa["rot"] + pitch_deg * s / 32
        ma0 = ga_raw.rotate((0, 0, ph)).translate((pa["x"], pa["y"], pa["z"]))
        if (ma0 ^ mb0).volume() < 0.05:
            phi0 = ph
            break
    if phi0 is None:
        return False
    for rstep in range(1, 8):
        da = pitch_deg * rstep / 8
        ma = ga_raw.rotate((0, 0, phi0 + da)).translate((pa["x"], pa["y"], pa["z"]))
        if ok == "spur":
            db = -da * (zs / og["teeth"])
            mb = gb_raw.rotate((0, 0, 90 * pb["rot"] + db)).translate((pb["x"], pb["y"], pb["z"]))
        elif ok == "ring":
            db = da * (zs / og["teeth"])
            mb = gb_raw.rotate((0, 0, 90 * pb["rot"] + db)).translate((pb["x"], pb["y"], pb["z"]))
        else:  # rack: slide along rack tangent by pitch_radius * radians(da)
            ang = math.radians(90 * pb["rot"])
            ux, uy = math.cos(ang), math.sin(ang)
            dx, dy = pa["x"] - pb["x"], pa["y"] - pb["y"]
            # Sign of rack motion matching +da rotation of gear at (pa - pb)
            side = 1.0 if (-dx * uy + dy * ux) >= 0 else -1.0
            ds = side * (sg["pitch_d_mm"] / 2) * math.radians(da)
            mb = gb_raw.rotate((0, 0, 90 * pb["rot"])).translate((pb["x"] + ux * ds, pb["y"] + uy * ds, pb["z"]))
        if (ma ^ mb).volume() >= 0.05:
            return False
    return True


def validate(lib, build):
    errors, warnings, edges = [], [], []
    ids = [b["id"] for b in build]
    if len(set(ids)) != len(ids):
        errors.append({"code": "duplicate_id", "detail": "placement ids must be unique"})
    for b in build:
        if b["part"] not in lib.parts:
            errors.append({"code": "unknown_part", "detail": b["part"]})
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "edges": edges}
    for b in build:
        status = lib.parts[b["part"]].get("design_status", "unknown")
        if status != "verified":
            warnings.append({"code": "unverified_part", "detail": f"{b['id']} ({b['part']}) is '{status}': not re-proportioned to the current lattice, so geometry results are unreliable"})

    exempt = set()      # pairs allowed to overlap: friction-pin fins interfere with the bore by design
    for it in build:
        if it["pose"].get("tilt") and it["part"] in lib.parts and any(c["kind"] in ("stud_grid", "socket_grid") for c in lib.parts[it["part"]]["connectors"]):
            errors.append({"code": "unsupported_pose", "detail": f"{it['id']} has studs or sockets and is tipped over; stud parts stay upright"})
    for ga_, gb_ in combinations(build, 2):
        r = gear_mesh(lib, ga_, gb_)
        if r.get("edge"):
            edges.append(r["edge"])
            exempt.add(frozenset((ga_["id"], gb_["id"])))
        if r.get("error"):
            errors.append(r["error"])
    # 1. connections between every pair
    for a, b in combinations(build, 2):
        for ca in lib.parts[a["part"]]["connectors"]:
            for cb in lib.parts[b["part"]]["connectors"]:
                if {ca["kind"], cb["kind"]} == {"pin", "bore_grid"} and ca["gender"] != cb["gender"]:
                    (ma, cm), (fb, cf) = ((a, ca), (b, cb)) if ca["kind"] == "pin" else ((b, cb), (a, ca))
                    r = pin_bore_edge(lib, ma, cm, fb, cf)
                    if r.get("error"):
                        errors.append(r["error"])
                    if r.get("edge"):
                        edges.append(r["edge"])
                    if r.get("warning"):
                        warnings.append(r["warning"])
                    if r.get("exempt"):
                        exempt.add(frozenset((a["id"], b["id"])))
                    continue
                if {ca["kind"], cb["kind"]} != {"stud_grid", "socket_grid"} or ca["gender"] == cb["gender"]:
                    continue
                ma, fb = (a, b) if ca["gender"] == "M" else (b, a)
                cm, cf = (ca, cb) if ca["gender"] == "M" else (cb, ca)
                cells_m, cells_f = world_cells(cm, ma["pose"]), world_cells(cf, fb["pose"])
                same_plane = abs(cells_m[0][2] - cells_f[0][2]) < TOL_Z
                if not same_plane:
                    continue
                fx = [c[0] for c in cells_f]; fy = [c[1] for c in cells_f]
                near = [m for m in cells_m if min(fx) - 8 <= m[0] <= max(fx) + 8 and min(fy) - 8 <= m[1] <= max(fy) + 8]
                if not near:
                    continue
                if cm["size_class"] != cf["size_class"]:
                    errors.append({"code": "size_mismatch", "detail": f"{ma['id']}.{cm['id']} ({cm['size_class']}) vs {fb['id']}.{cf['id']} ({cf['size_class']})"})
                    continue
                engaged_xy = [(m[0], m[1]) for m in cells_m if any(abs(m[0] - f[0]) < TOL_XY and abs(m[1] - f[1]) < TOL_XY for f in cells_f)]
                engaged = len(engaged_xy)
                if engaged:
                    rep = fit_report(placed_geometry(lib, ma), placed_geometry(lib, fb), cells_m[0][2] + tp.STUD[cm["size_class"]]["stud_h"] / 2, only=engaged_xy)
                    v = tp.fit_verdict(rep, cm["size_class"])
                    edge = {"male": f"{ma['id']}.{cm['id']}", "female": f"{fb['id']}.{cf['id']}", "engaged_studs": engaged}
                    if rep["studs"]:
                        edge.update(gap_min_mm=round(rep["gap_min"], 3), gap_max_mm=round(rep["gap_max"], 3))
                    edges.append(edge)
                    if not v["as_designed"]:
                        warnings.append({"code": "fit_out_of_tolerance", "detail": f"{edge['male']} with {edge['female']}: measured gap "
                                         f"{edge.get('gap_min_mm')} to {edge.get('gap_max_mm')} mm is outside the allowed {v['allowed']} mm"})
                else:
                    errors.append({"code": "misaligned", "detail": f"{ma['id']} and {fb['id']} touch on the same plane but no studs line up"})

    # 2. everything reachable from the first placement
    adj = {i: set() for i in ids}
    for e in edges:
        u, v = e["male"].split(".")[0], e["female"].split(".")[0]
        adj[u].add(v); adj[v].add(u)
    seen, stack = {ids[0]}, [ids[0]]
    while stack:
        for n in adj[stack.pop()]:
            if n not in seen:
                seen.add(n); stack.append(n)
    for i in ids:
        if i not in seen:
            errors.append({"code": "floating", "detail": f"{i} is not connected to {ids[0]}"})

    # 3. collisions (exact, via the part meshes)
    geos = {b["id"]: placed_geometry(lib, b) for b in build}
    for a, b in combinations(build, 2):
        if frozenset((a["id"], b["id"])) in exempt:
            continue
        ga, gb = geos[a["id"]], geos[b["id"]]
        ba, bb = ga.bounding_box(), gb.bounding_box()
        if any(ba[i] >= bb[i + 3] or bb[i] >= ba[i + 3] for i in range(3)):
            continue
        vol = (ga ^ gb).volume()
        if vol > COLLISION_MM3:
            errors.append({"code": "collision", "detail": f"{a['id']} and {b['id']} overlap by {vol:.0f} mm3"})

    return {"ok": not errors, "errors": errors, "warnings": warnings, "edges": edges}


def _first_cell(conn):
    g = conn["grid"]
    omit = [tuple(c) for c in g.get("omit_cells", [])]
    return next((i, j) for j in range(g["ny"]) for i in range(g["nx"]) if (i, j) not in omit)


def fit_matrix(lib):
    """Seat every male stud connector on every complementary female connector in the catalog and measure the fit.
    Proves each intended connection fits as designed, and lists connectors that have no partner at all."""
    pairs, partnered = [], set()
    for a_id, a in lib.parts.items():
        for cm in a["connectors"]:
            if cm["kind"] == "pin":
                for b_id, b in lib.parts.items():
                    for cf in b["connectors"]:
                        if cf["kind"] != "bore_grid" or not complementary(cm, cf):
                            continue
                        rule = next((r for r in pro.RULES if r["pin"] == cm["interface"] and r["bore"] == cf["bore_class"]), None)
                        if rule is None:
                            continue
                        pb = place(b_id, pid="b")                      # seat the pin centred in the bore, on whatever axis the bore runs
                        pa = place_on_axis(lib, pb, cf["id"], a_id, cm["id"], along=(cf["depth_mm"] - cm["length_mm"]) / 2, pid="a", parent_cell=_first_cell(cf))
                        res = pin_bore_edge(lib, pa, cm, pb, cf)
                        rep = res.get("rep")
                        v = pro.pair_verdict(rule, rep)
                        partnered |= {(a_id, cm["id"]), (b_id, cf["id"])}
                        pairs.append({"male": f"{a_id}.{cm['id']}", "female": f"{b_id}.{cf['id']}", "size_class": "pro", "fit": rule["fit"],
                                      "studs": 0 if rep is None else rep["studs"],
                                      "gap_min_mm": None if rep is None or not rep["studs"] else round(rep["gap_min"], 3),
                                      "gap_max_mm": None if rep is None or not rep["studs"] else round(rep["gap_max"], 3),
                                      "as_designed": v["as_designed"], "in_window": v["in_window"], "window_mm": v["window"], "measured": v["measured"]})
                continue
            if cm["kind"] != "stud_grid":
                continue
            for b_id, b in lib.parts.items():
                for cf in b["connectors"]:
                    if not complementary(cm, cf):
                        continue
                    pa = place(a_id, pid="a")
                    pb = attach(lib, pa, cm["id"], b_id, cf["id"], _first_cell(cm), _first_cell(cf), pid="b")
                    cells_m, cells_f = world_cells(cm, pa["pose"]), world_cells(cf, pb["pose"])
                    engaged_xy = [(m[0], m[1]) for m in cells_m if any(abs(m[0] - f[0]) < TOL_XY and abs(m[1] - f[1]) < TOL_XY for f in cells_f)]
                    z = pa["pose"]["z"] + cm["frame"]["origin"][2] + tp.STUD[cm["size_class"]]["stud_h"] / 2
                    rep = fit_report(placed_geometry(lib, pa), placed_geometry(lib, pb), z, only=engaged_xy)
                    v = tp.fit_verdict(rep, cm["size_class"])
                    partnered |= {(a_id, cm["id"]), (b_id, cf["id"])}
                    pairs.append({"male": f"{a_id}.{cm['id']}", "female": f"{b_id}.{cf['id']}", "size_class": cm["size_class"], "studs": rep["studs"],
                                  "gap_min_mm": None if rep["gap_min"] is None else round(rep["gap_min"], 3),
                                  "gap_max_mm": None if rep["gap_max"] is None else round(rep["gap_max"], 3),
                                  "as_designed": v["as_designed"], "in_window": v["in_window"], "window_mm": v["window"]})
    orphans = [f"{pid}.{c['id']}" for pid, p in lib.parts.items() for c in p["connectors"]
               if c["kind"] in ("stud_grid", "socket_grid", "pin", "bore_grid") and (pid, c["id"]) not in partnered]
    return {"pairs": pairs, "orphans": orphans}


# --------------------------------------------------------------------------
def pro_gear_scene(lib):
    """The demo's Pro moment: the Pro Forge Mount with a 5-hole beam pinned on top, two shafts from the mount's base up through the beam,
    and a 10- and a 20-tooth gear meshing above it (3 holes apart = their exact centre distance). Returns (items, readout)."""
    fmp = place("forge_mount_pro", pid="mount")
    beam = place("beam_str_tu05", 0, -25.0, 12.5, pid="beam")
    pins = [attach(lib, fmp, "bores", "pin_friction", "axis", (i, 0), (0, 0), pid=f"pin{i}") for i in (1, 2)]
    s_drive = attach(lib, fmp, "bores", "shaft_tu03", "axis", (0, 0), (0, 0), pid="shaftA")
    s_driven = attach(lib, fmp, "bores", "shaft_tu03", "axis", (3, 0), (0, 0), pid="shaftB")
    g_drive = attach(lib, s_drive, "axis", "gear_spur_z10", "hub", (0, 0), (0, 0), pid="gearA", dz=25.0)
    g_driven = attach(lib, s_driven, "axis", "gear_spur_z20", "hub", (0, 0), (0, 0), pid="gearB", dz=25.0)
    za, zb = lib.parts["gear_spur_z10"]["gear"]["teeth"], lib.parts["gear_spur_z20"]["gear"]["teeth"]
    readout = {"driver": {"item": "gearA", "teeth": za}, "driven": {"item": "gearB", "teeth": zb}, "ratio": zb / za, "ratio_text": f"{zb // za} : 1",
               "explain": "Turn the small gear twice and the big gear turns once: half the speed, twice the turning force. They spin in opposite directions.",
               "module_mm": lib.parts["gear_spur_z10"]["gear"]["module_mm"], "centre_distance_mm": 37.5,
               "spin": [{"items": ["gearA", "shaftA"], "speed": 1.0}, {"items": ["gearB", "shaftB"], "speed": -za / zb}]}
    return [fmp, beam, *pins, s_drive, s_driven, g_drive, g_driven], readout


def robot_bolt(lib):
    """Bolt, the first Snap robot, stacked on studs: legs -> torso -> arms (shoulder yoke) -> head on the yoke's front row and the back
    pack on its rear row. Returns the build items in stacking order."""
    legs = place("robot_legs_stomper", pid="legs")
    torso = attach(lib, legs, "top_studs", "robot_torso_core", "under_sockets", (0, 0), (0, 0), pid="torso")
    arms = attach(lib, torso, "top_studs", "robot_arms_grabber", "under_sockets", (0, 0), (0, 0), pid="arms")
    head = attach(lib, arms, "top_studs", "robot_head_visor", "under_sockets", (0, 0), (0, 0), pid="head")
    pack = attach(lib, arms, "top_studs", "robot_back_jetpack", "under_sockets", (0, 1), (0, 0), pid="pack")
    return [legs, torso, arms, head, pack]


def demo(manifest_path, out_dir):
    lib = Library(manifest_path)
    cases = {}

    ring = place("forge_mount_ring", pid="ring")
    brick = attach(lib, ring, "top_studs", "big_blue_brick", "under_sockets", (0, 0), (0, 0), pid="brick")
    tail = attach(lib, brick, "top_studs", "waddle_tail", "under_sockets", (0, 0), (0, 0), pid="tail")
    cases["valid_ring_brick_tail"] = [ring, brick, tail]

    plate = place("mini_plate", pid="plate")
    glow = attach(lib, plate, "top_studs", "glow_capsule", "under_sockets", (0, 0), (0, 0), pid="glow")
    wings = attach(lib, plate, "top_studs", "cloud_wings", "under_sockets", (2, 0), (0, 0), pid="wings")
    cases["valid_plate_glow"] = [plate, glow]
    cases["valid_plate_wings"] = [plate, wings]
    cases["INVALID_glow_and_wings_collide"] = [plate, glow, wings]   # caught by the validator, not planned

    b1 = place("big_blue_brick", pid="b1")
    b2 = attach(lib, b1, "top_studs", "big_blue_brick", "under_sockets", (1, 0), (0, 0), pid="b2")
    cases["valid_offset_stack_2_studs"] = [b1, b2]

    if "beam_str_tu05" in lib.parts:                         # Pro core (W2)
        b1, b2 = place("beam_str_tu05", pid="b1"), place("beam_str_tu05", 0, 0, 12.5, pid="b2")
        cases["valid_beams_friction_pin"] = [b1, b2, attach(lib, b1, "bores", "pin_friction", "axis", (0, 0), (0, 0), pid="fp")]
        bm = place("beam_str_tu03", pid="bm")
        sh = attach(lib, bm, "bores", "shaft_tu03", "axis", (1, 0), (0, 0), pid="sh")
        cases["valid_shaft_beam_bushing"] = [bm, sh, attach(lib, sh, "axis", "bushing_half", "hub", (0, 0), (0, 0), pid="bu", dz=12.5)]
        if "gear_spur_z20" in lib.parts:                 # W4: gears, rack, ring, adapter, Pro Forge Mount
            bm = place("beam_str_tu05", pid="bm")
            s0, s3, s2 = (attach(lib, bm, "bores", "shaft_tu03", "axis", (i, 0), (0, 0), pid=f"s{i}") for i in (0, 3, 2))
            g10 = attach(lib, s0, "axis", "gear_spur_z10", "hub", (0, 0), (0, 0), pid="g10", dz=12.5)
            cases["valid_gear_pair_3tu"] = [bm, s0, s3, g10, attach(lib, s3, "axis", "gear_spur_z20", "hub", (0, 0), (0, 0), pid="g20", dz=12.5)]
            cases["INVALID_gears_2tu_apart"] = [bm, s0, s2, g10, attach(lib, s2, "axis", "gear_spur_z20", "hub", (0, 0), (0, 0), pid="g20", dz=12.5)]
            cases["valid_rack_and_pinion"] = [place("gear_rack_tu05", pid="rack"), place("gear_spur_z10", 0, 25.0, 0, pid="g10")]
            cases["valid_ring_and_pinion"] = [place("gear_ring_z40", pid="ring"), place("gear_spur_z10", 37.5, 0, 0, pid="g10")]
            bb, ad = place("beam_str_tu03", pid="beam"), place("adapter_snap_pro", 0, 0, 12.5, pid="adapter")
            cases["valid_snap_on_pro_adapter"] = [bb, ad, attach(lib, bb, "bores", "pin_friction", "axis", (1, 0), (0, 0), pid="pin"),
                                                  attach(lib, ad, "top_studs", "brick_s_2x2", "under_sockets", pid="brick")]
            fmp = place("forge_mount_pro", pid="mount")
            cases["valid_beam_on_pro_mount"] = [fmp, place("beam_str_tu05", 0, -25.0, 12.5, pid="beam"), attach(lib, fmp, "bores", "pin_friction", "axis", (0, 0), (0, 0), pid="pin")]
            cases["valid_pro_gear_scene"] = pro_gear_scene(lib)[0]
        if "robot_torso_core" in lib.parts:
            cases["valid_robot_bolt"] = robot_bolt(lib)
        if "hinge_tu02" in lib.parts:                      # W5: parts on any axis
            la, lb = place("hinge_tu02", pid="leafA"), place("hinge_tu02", 0, 2 * pro.TU, 0, rot=2, pid="leafB")
            cases["valid_hinge"] = [la, lb, place_on_axis(lib, la, "knuckle0", "pin_free", "axis", along=-pro.HINGE_CLEAR / 2, pid="pin")]
            bm5 = place("beam_str_tu05", pid="beam")
            cc = place("cross_connector_tu01", -2 * pro.TU + pro.TU / 2, 0, pro.TU, pid="cross")
            post = attach(lib, bm5, "bores", "shaft_tu03", "axis", (0, 0), (0, 0), pid="post")
            axle = place_on_axis(lib, cc, "axle_y", "shaft_tu05", "axis", along=(pro.TU - 5 * pro.TU) / 2, pid="axle")
            wa = place_on_axis(lib, axle, "axis", "wheel_tu04", "hub", along=0.0, pid="wheelA")
            wb = place_on_axis(lib, axle, "axis", "wheel_tu04", "hub", along=4 * pro.TU, pid="wheelB")
            cases["valid_cart_axle"] = [bm5, cc, post, axle, wa, wb]
            off = dict(axle, pose=dict(axle["pose"], x=axle["pose"]["x"] + 2.0))
            cases["INVALID_axle_off_its_bore"] = [bm5, cc, post, off]
            rolled = place_on_axis(lib, cc, "axle_y", "shaft_tu05", "axis", along=(pro.TU - 5 * pro.TU) / 2, pid="axle")
            rolled["pose"]["tilt"] = [rolled["pose"]["tilt"][0], 90.0 if not rolled["pose"]["tilt"][1] else 0.0]
            cases["INVALID_shaft_flats_crosswise"] = [bm5, cc, post, rolled]
            cases["INVALID_tipped_brick"] = [place("big_blue_brick", tilt=(90, 0), pid="brick")]
        if "racer_axle_block" in lib.parts:                # W6: the Racer wheel set
            blk = place("racer_axle_block", pid="block")
            axl = place_on_axis(lib, blk, "axle", "racer_axle", "axis", along=(blk_len := lib.conn("racer_axle_block", "axle")["depth_mm"]) / 2 - 37.5 / 2, pid="axle")
            w1 = place_on_axis(lib, axl, "axis", "racer_wheel", "hub", along=0.0, pid="wheelL")
            w2 = place_on_axis(lib, axl, "axis", "racer_wheel", "hub", along=37.5 - 6.0, pid="wheelR")
            top = attach(lib, blk, "top_studs", "plate_s_2x2", "under_sockets", (0, 0), (0, 0), pid="chassis")
            cases["valid_racer_wheels"] = [blk, axl, w1, w2, top]
        if "veh_car_chassis" in lib.parts:                 # W9: Kip wardrobe & modular TU vehicles
            s_legs = place("char_legs_seated", pid="legs")
            s_torso = attach(lib, s_legs, "top_studs", "robot_torso_core", "under_sockets", pid="torso")
            s_arms = attach(lib, s_torso, "top_studs", "robot_arms_grabber", "under_sockets", pid="arms")
            s_head = attach(lib, s_arms, "top_studs", "char_head_kid", "under_sockets", (0, 0), (0, 0), pid="head")
            s_face = place_on_axis(lib, s_head, "face_slot", "char_faceplate", "axis", along=0.0, pid="faceplate")
            s_hair = attach(lib, s_head, "top_studs", "hair_short_swept", "under_sockets", pid="hair")
            s_hat = attach(lib, s_hair, "top_studs", "wobble_hat", "under_sockets", pid="hat")
            cases["valid_kip_seated_wardrobe"] = [s_legs, s_torso, s_arms, s_head, s_face, s_hair, s_hat]

            j_legs = place("char_legs_seated", pid="legs")
            j_torso = attach(lib, j_legs, "top_studs", "robot_torso_core", "under_sockets", pid="torso")
            j_arms = attach(lib, j_torso, "top_studs", "robot_arms_grabber", "under_sockets", pid="arms")
            j_head = attach(lib, j_arms, "top_studs", "char_head_jumbo", "under_sockets", (0, 0), (0, 0), pid="head")
            j_face = place_on_axis(lib, j_head, "face_slot", "char_faceplate", "axis", along=0.0, pid="faceplate")
            j_hat = attach(lib, j_head, "top_studs", "hat_ballcap", "under_sockets", pid="hat")
            cases["valid_kip_seated_jumbo"] = [j_legs, j_torso, j_arms, j_head, j_face, j_hat]

            r_legs = place("char_legs_seated", pid="legs")
            r_torso = attach(lib, r_legs, "top_studs", "robot_torso_core", "under_sockets", pid="torso")
            r_arms = attach(lib, r_torso, "top_studs", "robot_arms_grabber", "under_sockets", pid="arms")
            r_head = attach(lib, r_arms, "top_studs", "char_head_tall", "under_sockets", (0, 0), (0, 0), pid="head")
            r_face = place_on_axis(lib, r_head, "face_slot", "char_faceplate", "axis", along=0.0, pid="faceplate")
            r_hair = attach(lib, r_head, "top_studs", "hair_short_swept", "under_sockets", pid="hair")
            r_hat = attach(lib, r_hair, "top_studs", "hat_ballcap", "under_sockets", pid="hat")
            cases["valid_kip_seated_tall"] = [r_legs, r_torso, r_arms, r_head, r_face, r_hair, r_hat]

            car = place("veh_car_chassis", pid="car")
            c_hood = attach(lib, car, "hood_studs", "veh_car_hood_cover", "under_sockets", pid="hood_cover")
            c_cab = attach(lib, car, "rollbar_studs", "veh_cab_roof_cover", "under_sockets", pid="cab_cover")
            b_car = [
                car, c_hood, c_cab,
                attach(lib, car, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
                attach(lib, c_hood, "top_studs", "racer_hood_scoop", "under_sockets", pid="hood_scoop"),
                attach(lib, c_cab, "top_studs", "racer_light_bar", "under_sockets", (0, 0), (0, 0), pid="light_bar"),
                attach(lib, car, "spoiler_studs", "racer_spoiler", "under_sockets", pid="spoiler"),
                attach(lib, car, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
                attach(lib, car, "top_studs", "char_legs_seated", "under_sockets", (1, 0), (0, 0), pid="driver_legs"),
                place_on_axis(lib, car, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
            ]
            w_car = lib.conn("veh_car_chassis", "axle_front")["depth_mm"]
            for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
                ax = place_on_axis(lib, car, bore_id, "shaft_tu05", "axis", along=(w_car - 62.5) / 2, pid=f"ax_{tag}")
                b_car += [ax, place_on_axis(lib, ax, "axis", "veh_wheel_sport", "hub", along=0.0, pid=f"wl_{tag}"),
                          place_on_axis(lib, ax, "axis", "veh_wheel_sport", "hub", along=62.5 - 13.5, pid=f"wr_{tag}")]
            cases["valid_kip_roadster_car"] = b_car

            trk = place("veh_truck_chassis", pid="truck")
            t_hood = attach(lib, trk, "hood_studs", "veh_car_hood_cover", "under_sockets", pid="hood_cover")
            t_cab = attach(lib, trk, "roof_studs", "veh_cab_roof_cover", "under_sockets", pid="cab_cover")
            t_bed = attach(lib, trk, "cargo_studs", "veh_truck_bed_cover", "under_sockets", pid="bed_cover")
            b_trk = [
                trk, t_hood, t_cab, t_bed,
                attach(lib, trk, "front_studs", "racer_bull_bar", "under_sockets", pid="bull_bar"),
                attach(lib, t_cab, "top_studs", "racer_roof_rack", "under_sockets", pid="roof_rack"),
                attach(lib, t_bed, "bed_studs", "pack_explorer", "under_sockets", pid="cargo_pack"),
                attach(lib, trk, "top_studs", "char_legs_seated", "under_sockets", (1, 0), (0, 0), pid="driver_legs"),
                place_on_axis(lib, trk, "dash_bore", "veh_steering_wheel", "axis", along=-7.0, pid="wheel_steer"),
            ]
            w_trk = lib.conn("veh_truck_chassis", "axle_front")["depth_mm"]
            for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
                ax = place_on_axis(lib, trk, bore_id, "shaft_tu05", "axis", along=(w_trk - 62.5) / 2, pid=f"ax_{tag}")
                b_trk += [ax, place_on_axis(lib, ax, "axis", "veh_wheel_offroad", "hub", along=0.0, pid=f"wl_{tag}"),
                          place_on_axis(lib, ax, "axis", "veh_wheel_offroad", "hub", along=62.5 - 14.0, pid=f"wr_{tag}")]
            cases["valid_kip_hauler_truck"] = b_trk

            sc = place("veh_scooter_frame", pid="scooter")
            b_sc = [
                sc,
                attach(lib, sc, "fairing_studs", "veh_scooter_fairing", "under_sockets", pid="fairing"),
                attach(lib, sc, "seat_studs", "char_legs_seated", "under_sockets", pid="rider_legs"),
                attach(lib, sc, "exhaust_studs", "racer_twin_exhaust", "under_sockets", pid="exhaust"),
                place_on_axis(lib, sc, "headtube", "veh_handlebar_fork", "axis", along=0.0, pid="handlebars"),
            ]
            for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
                ax = place_on_axis(lib, sc, bore_id, "racer_axle", "axis", along=0.0, pid=f"ax_{tag}")
                b_sc += [ax, place_on_axis(lib, ax, "axis", "veh_wheel_moto", "hub", along=(37.5 - 14.0) / 2, pid=f"wm_{tag}")]
            cases["valid_kip_motor_scooter"] = b_sc

            cowling = attach(lib, sc, "top_studs", "veh_moto_cowling", "under_sockets", pid="moto_cowling")
            cases["valid_kip_sport_moto"] = list(b_sc) + [
                cowling,
                attach(lib, cowling, "tank_studs", "glow_capsule", "under_sockets", pid="tank_pod"),
            ]

            sk = place("prop_skateboard_deck", pid="deck")
            w_sk = lib.conn("prop_skateboard_deck", "axle_front")["depth_mm"]
            b_sk = [sk]
            for tag, bore_id in (("f", "axle_front"), ("r", "axle_rear")):
                ax = place_on_axis(lib, sk, bore_id, "racer_axle", "axis", along=(w_sk - 37.5) / 2, pid=f"ax_{tag}")
                b_sk += [ax, place_on_axis(lib, ax, "axis", "racer_wheel", "hub", along=0.0, pid=f"wl_{tag}"),
                         place_on_axis(lib, ax, "axis", "racer_wheel", "hub", along=37.5 - 6.0, pid=f"wr_{tag}")]
            cases["valid_kip_skateboard"] = b_sk
        if "kit_keel_base" in lib.parts:                    # W10 & W11: Flat-pack modular craft & progressive power
            k_rc = place("kit_keel_base", pid="keel")
            rc_wedge = attach(lib, k_rc, "top_studs", "kit_aero_wedge", "under_sockets", (1, 0), (0, 0), pid="nose_wedge")
            rc_wind = attach(lib, k_rc, "top_studs", "kit_windscreen", "under_sockets", (0, 3), (0, 0), pid="windscreen")
            rc_legs = attach(lib, k_rc, "top_studs", "char_legs_seated", "under_sockets", (1, 4), (0, 0), pid="pilot_legs")
            rc_wing = attach(lib, k_rc, "top_studs", "kit_foil_wing", "under_sockets", (0, 9), (2, 3), rot=1, pid="gt_wing")
            rc_yoke = place_on_axis(lib, rc_wedge, "mast_bore", "kit_yoke_hbar", "axis", along=0.0, pid="yoke")
            cases["valid_kit_race_car"] = [k_rc, rc_wedge, rc_wind, rc_legs, rc_wing, rc_yoke]

            k_dt = place("kit_keel_base", pid="keel")
            dt_wind = attach(lib, k_dt, "top_studs", "kit_windscreen", "under_sockets", (0, 3), (0, 0), pid="windscreen")
            dt_legs = attach(lib, k_dt, "top_studs", "char_legs_seated", "under_sockets", (1, 4), (0, 0), pid="driver_legs")
            dt_tub = attach(lib, k_dt, "top_studs", "kit_tilting_tub", "under_sockets", (0, 6), (0, 0), pid="dump_tub")
            dt_yoke = place_on_axis(lib, k_dt, "steer_bore", "kit_yoke_hbar", "axis", along=0.0, pid="yoke")
            cases["valid_kit_dump_truck"] = [k_dt, dt_wind, dt_legs, dt_tub, dt_yoke]

            k_hl = place("kit_keel_base", pid="keel")
            hl_legs = attach(lib, k_hl, "top_studs", "char_legs_seated", "under_sockets", (1, 4), (0, 0), pid="pilot_legs")
            hl_turn = attach(lib, k_hl, "top_studs", "kit_turntable", "under_sockets", (0, 6), (0, 0), pid="mast_deck")
            hl_house = attach(lib, hl_turn, "top_studs", "kit_aero_wedge", "under_sockets", (1, 1), (0, 0), pid="mast_house")
            hl_mast = place_on_axis(lib, hl_house, "mast_bore", "mom_spindle_shaft", "axis", along=0.0, pid="rotor_mast")
            hl_rotor = place_on_axis(lib, hl_mast, "axis", "kit_rotor_blade", "hub", along=78.0 - 6.0, pid="main_rotor")
            cases["valid_kit_helicopter"] = [k_hl, hl_legs, hl_turn, hl_house, hl_mast, hl_rotor]

            k_st = place("kit_keel_base", pid="keel")
            st_br = attach(lib, k_st, "top_studs", "pro_steer_bridge", "under_sockets", (1, 0), (0, 0), pid="steer_bridge")
            st_stem = place_on_axis(lib, k_st, "steer_bore", "shaft_tu03", "axis", along=0.0, pid="steer_stem")
            st_pin = place_on_axis(lib, st_stem, "axis", "gear_spur_z10", "hub", along=28.0, pid="steer_pinion")
            st_rack = place("pro_steer_rack", 0.0, -56.25, 28.0, pid="steer_rack")
            cases["valid_pro_steered_racer"] = [k_st, st_br, st_stem, st_pin, st_rack]

            k_mb = place("kit_keel_base", pid="keel")
            mb_tray = attach(lib, k_mb, "top_studs", "mom_band_core_tray", "under_sockets", (0, 6), (0, 0), pid="band_tray")
            mb_lid = attach(lib, mb_tray, "rim_studs", "mom_band_core_lid", "under_sockets", (0, 0), (0, 0), pid="band_lid")
            mb_tub = attach(lib, mb_lid, "top_studs", "kit_tilting_tub", "under_sockets", (0, 0), (0, 0), pid="dump_tub")
            cases["valid_mom_band_truck"] = [k_mb, mb_tray, mb_lid, mb_tub]
        bu = place("bushing_tu01", pid="bu")
        cases["INVALID_round_pin_in_bushing"] = [bu, place("pin_free", 0, 0, -lib.conn("pin_free", "axis")["frame"]["origin"][2], pid="pin")]   # attach() refuses it

    p = lib.parts["mini_plate"]
    plate_h = tp.STUD["small"]["plate_h"]
    cases["INVALID_large_tail_on_small_plate"] = [place("mini_plate", pid="plate"), place("waddle_tail", 0, 0, plate_h, pid="tail")]
    cases["INVALID_floating_wings"] = [place("mini_plate", pid="plate"), place("cloud_wings", 0, 0, 40, pid="wings")]
    cases["INVALID_overlapping_bricks"] = [place("big_blue_brick", pid="b1"), place("big_blue_brick", 16, 0, 0, pid="b2")]

    results = {}
    for name, build in cases.items():
        r = validate(lib, build)
        results[name] = {"build": build, **r}
        tag = "OK   " if r["ok"] else "REJECT"
        detail = [f"{e['male']}->{e['female']} x{e['engaged_studs']}" for e in r["edges"]] if r["ok"] else [f"{e['code']}: {e['detail']}" for e in r["errors"]]
        note = f"  [{len(r['warnings'])} warning(s): unverified parts]" if r["warnings"] else ""
        print(f"{tag} {name:38s} {detail}{note}")
    out = Path(out_dir)
    (out / "build_examples.json").write_text(json.dumps(results, indent=2))
    (out / "connection_graph.json").write_text(json.dumps(lib.compat_graph(), indent=2))
    fm = fit_matrix(lib)
    (out / "fit_matrix.json").write_text(json.dumps(fm, indent=2))
    bad = [f"{r['male']} x {r['female']}" for r in fm["pairs"] if not r["as_designed"]]
    print(f"fit matrix: {len(fm['pairs'])} mating pairs, {len(bad)} out of tolerance, {len(fm['orphans'])} connectors with no partner")
    (out / "ai_catalog.txt").write_text(lib.catalog() + "\n")
    return results


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    demo(Path(out) / "toyventor_parts.json", out)
