#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""ToyVentor Pro: primitives, pin-and-bore fit, and the Pro rules (I4, I5, I6). Every number comes from interfaces.json.

Conventions (Pro parts print flat, bores and pins run along z):
  - bore_grid connector (F): grid anchored at the FIRST bore centre (frame origin), cells at origin + (i, j) * pitch, bore_class free|fixed.
  - pin connector (M): the pin axis at the frame origin, profile round|flats|friction, length_mm.
  - A pin and a bore mate when the axes coincide and the pair is listed in interfaces.json pin_bore.rules.
Fit uses the same slice-and-gap measurement as the Snap studs (toyventor_fit): sliced mid-engagement, signed radial gap per pin.
"""
import json
import math
from pathlib import Path

from manifold3d import CrossSection, Manifold, OpType

from toyventor_fit import fit_report
from toyventor_geom import rbox

HERE = Path(__file__).parent
IF = json.loads((HERE / "interfaces.json").read_text())
TU = IF["lattice"]["unit_mm"]
BORE = IF["interfaces"]["bore_grid"]
LIM, TOL = IF["limits"], IF["tolerance"]
SEGS = LIM["fit_segments"]
BEAM, GEAR = IF["pro"]["beam"], IF["pro"]["gear"]
RULES = IF["pin_bore"]["rules"]
DIM_TOL = 0.02          # mm: built pin/bore dimension vs interface (faceting plus rounding)


# ---------------------------------------------------------------- orientation (connectors on any axis)
import numpy as _np


def rot_matrix(rx=0.0, ry=0.0, rz=0.0):
    """Same convention as Manifold.rotate((rx, ry, rz)): about x, then y, then z (degrees)."""
    a, b, c = (_np.radians(v) for v in (rx, ry, rz))
    Rx = _np.array([[1, 0, 0], [0, _np.cos(a), -_np.sin(a)], [0, _np.sin(a), _np.cos(a)]])
    Ry = _np.array([[_np.cos(b), 0, _np.sin(b)], [0, 1, 0], [-_np.sin(b), 0, _np.cos(b)]])
    Rz = _np.array([[_np.cos(c), -_np.sin(c), 0], [_np.sin(c), _np.cos(c), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def align_to_z(n):
    """Rotation matrix taking unit vector n to +z (Rodrigues)."""
    n = _np.asarray(n, dtype=float) / _np.linalg.norm(n)
    z = _np.array([0.0, 0.0, 1.0])
    v, c = _np.cross(n, z), float(n @ z)
    if _np.linalg.norm(v) < 1e-12:
        return _np.eye(3) if c > 0 else _np.diag([1.0, -1.0, -1.0])
    k = _np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return _np.eye(3) + k + k @ k * (1 / (1 + c))


def to_z_frame(m, conn):
    """Turn the part so this connector's axis points up (+z); returns (part, connector) in that frame. Vertical connectors pass through."""
    n = conn["frame"].get("normal", [0, 0, 1])
    if abs(n[2] - 1) < 1e-9:
        return m, conn
    R = align_to_z(n)
    o = R @ _np.asarray(conn["frame"]["origin"], dtype=float)
    c2 = dict(conn, frame={"origin": [float(v) for v in o], "normal": [0, 0, 1]})
    return m.transform(_np.c_[R, _np.zeros(3)].tolist()), c2


# ---------------------------------------------------------------- sections and solids
def bore_section(bore_class):
    c = CrossSection.circle(BORE["free_d"] / 2, SEGS)
    if bore_class == "fixed":                       # double-D: round bore clipped to flats top and bottom
        c = c ^ CrossSection.square((BORE["free_d"] + 2, BORE["fixed_flats"]), center=True)
    return c


def _double_d(width, flats, corners=True):
    """Round section clipped to flats. With corners, the arcs next to each flat end in 45 degree tangents, so the section prints lying on a flat
    with nothing steeper than 45 degrees (adds at most a few microns outside the circle)."""
    r, f = width / 2, flats / 2
    circle = CrossSection.circle(r, SEGS)
    if not corners or f >= r * math.cos(math.pi / 4):
        return circle ^ CrossSection.square((width + 2, flats), center=True)
    s45 = r * math.sin(math.pi / 4)
    band = circle ^ CrossSection.square((width + 2, 2 * s45), center=True)
    xc = s45 - (f - s45)                        # where the 45 degree tangent from the arc meets the flat
    pts = CrossSection([[(-xc, -f), (xc, -f), (xc, f), (-xc, f)]])
    return CrossSection.batch_hull([band, pts])


def _teardrop(d, roof_deg=50, segs=48):
    """Hole that prints along a horizontal axis without support: round with a roof pointing +y. The roof lines are tangent to the circle and
    rise at roof_deg from horizontal (steeper than 45, so polygon facets never tip past the overhang limit). Only for holes that carry no fit."""
    r = d / 2
    apex = r / math.sin(math.radians(90 - roof_deg))      # tangent at circle angle (90 - roof_deg) meets the axis here
    return CrossSection.batch_hull([CrossSection.circle(r, segs), CrossSection([[(-0.01, apex), (0.01, apex), (0.0, apex + 0.01)]])])


def pin_section(profile):
    """Cross-section of a pin or shaft; None for profiles whose geometry belongs to a part (friction fins)."""
    if profile == "flats":
        return _double_d(BORE["shaft_d"], BORE["shaft_flats"]) - _teardrop(BORE["shaft_center_hole"])
    if profile == "round":
        return CrossSection.circle(BORE["shaft_d"] / 2, SEGS)
    return None


def bore_cutter(bore_class, h, x=0.0, y=0.0, z0=0.0):
    """Through-bore cutter with the hole-mouth chamfer on round bores (fixed bores keep flat mouths)."""
    cut = Manifold.extrude(bore_section(bore_class), h + 0.2).translate((x, y, z0 - 0.1))
    if bore_class == "free":
        ch, r = BEAM["hole_mouth_chamfer_mm"], BORE["free_d"] / 2
        top = Manifold.cylinder(ch, r, r + ch, SEGS).translate((x, y, z0 + h - ch))
        bot = Manifold.cylinder(ch, r + ch, r, SEGS).translate((x, y, z0))
        cut = cut + top + bot
    return cut


def pin_solid(profile, length, x=0.0, y=0.0, z0=0.0):
    return Manifold.extrude(pin_section(profile), length).translate((x, y, z0))


def beam_blank(n_tu, bore_class="free"):
    """1 TU square section, n_tu long, centred on the origin, one bore on the centre of every TU cell. Returns (solid, connector)."""
    L, T = n_tu * TU, BEAM["section_tu"] * TU
    body = rbox(L, T, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"])
    x0 = -(n_tu - 1) / 2 * TU
    for i in range(n_tu):
        body = body - bore_cutter(bore_class, T, x0 + i * TU, 0.0)
    conn = {"id": "bores", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN",
            "bore_class": bore_class, "depth_mm": T, "frame": {"origin": [round(x0, 3), 0.0, 0.0], "normal": [0, 0, 1]},
            "grid": {"nx": n_tu, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return body, conn


def pin_part(interface, profile, length):
    """A plain pin or shaft with its pin connector, on the bed and centred on the origin."""
    conn = {"id": "axis", "kind": "pin", "gender": "M", "interface": interface, "size_class": "pro", "fit_class": IF["interfaces"][interface]["fit_class"],
            "profile": profile, "length_mm": length, "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return pin_solid(profile, length), conn


def gear_blank(z):
    """Toothless gear body: tip-circle disc with a fixed-bore hub. Stands in until tooth geometry exists; the I6 rules apply to it."""
    od = GEAR["module_mm"] * (z + 2)
    body = Manifold.cylinder(TU, od / 2, od / 2, SEGS) - bore_cutter("fixed", TU)
    conn = {"id": "hub", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "fixed", "depth_mm": TU, "lattice": "axis",
            "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return body, conn, {"gear": {"module_mm": GEAR["module_mm"], "teeth": z, "pitch_d_mm": round(GEAR["module_mm"] * z, 3), "outer_d_mm": round(od, 3)}}


# ---------------------------------------------------------------- rules and fit
def rules_for_pin(interface):
    return [r for r in RULES if r["pin"] == interface]


def rules_for_bore(bore_class):
    return [r for r in RULES if r["bore"] == bore_class]


def profile_of(interface):
    return IF["interfaces"][interface].get("profile", "round")


def design_gap(rule):
    """Smallest radial clearance the interface numbers give for this pin and bore (flats and round both considered)."""
    prof = profile_of(rule["pin"])
    gaps = [(BORE["free_d"] - BORE["shaft_d"]) / 2]
    if rule["bore"] == "fixed" and prof == "flats":
        gaps.append((BORE["fixed_flats"] - BORE["shaft_flats"]) / 2)
    return min(gaps)


def facet_allowance():
    return (BORE["shaft_d"] / 2 + BORE["free_d"] / 2) * (1 - math.cos(math.pi / SEGS))


def limits_for(fit_class):
    if fit_class == "press":
        return TOL["max_interference_mm"], TOL["max_play_mm"]
    c = TOL["classes"][fit_class]
    return c["max_interference_mm"], c["max_play_mm"]


def _reference_bore(bore_class):
    T = BEAM["section_tu"] * TU
    return rbox(2 * TU, 2 * TU, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"]) - bore_cutter(bore_class, T)


def _centered(m, cx, cy, z_from, z_to):
    return m.translate((-cx, -cy, z_to - z_from))


def pair_reports(part_conns, m):
    out = []
    for c in part_conns:
        mm, cc = to_z_frame(m, c)
        out += _pair_reports([cc], mm)
    return out


def _pair_reports(part_conns, m):
    """Seat the part against the standard reference partner for every rule that applies, and measure the gap.
    Returns [{rule, rep}]. Friction rules are listed but not measured: their geometry belongs to the friction pin part."""
    T = BEAM["section_tu"] * TU
    out = []
    for c in part_conns:
        if c["kind"] == "pin":
            for r in rules_for_pin(c["interface"]):
                sec = pin_section(profile_of(c["interface"]))
                if sec is None:
                    out.append({"rule": r, "rep": None})
                    continue
                ox, oy = c["frame"]["origin"][0], c["frame"]["origin"][1]
                z_mid = c["frame"]["origin"][2] + c["length_mm"] / 2
                pin = m.translate((-ox, -oy, T / 2 - z_mid))
                out.append({"rule": r, "rep": fit_report(pin, _reference_bore(r["bore"]), T / 2)})
        elif c["kind"] == "bore_grid":
            for r in rules_for_bore(c["bore_class"]):
                if pin_section(profile_of(r["pin"])) is None:
                    out.append({"rule": r, "rep": None})
                    continue
                oz = c["frame"]["origin"][2]
                pins = None
                for (x, y, _) in cell_positions(c):          # declared bores only: omitted cells have no hole
                    p = pin_solid(profile_of(r["pin"]), c["depth_mm"] + 4, x, y, oz - 2)
                    pins = p if pins is None else pins + p
                out.append({"rule": r, "rep": fit_report(pins, m, oz + c["depth_mm"] / 2)})
    return out


def pair_verdict(rule, rep):
    """T1/T2 verdict for one pin-and-bore pair. Friction pairs (rep None) are not measured: retention needs a print."""
    if rep is None:
        return {"as_designed": True, "in_window": True, "window": None, "measured": False, "design_gap": None}
    if not rep["studs"]:
        return {"as_designed": False, "in_window": False, "window": None, "measured": True, "design_gap": design_gap(rule)}
    g0, fa = design_gap(rule), facet_allowance()
    i_max, p_max = limits_for(rule["fit"])
    as_designed = (g0 - TOL["design_gap_tol_mm"] <= rep["gap_min"] and rep["gap_max"] <= g0 + TOL["design_gap_tol_mm"] + fa
                   and rep["gap_max"] <= p_max and rep["gap_min"] >= -i_max)
    lo, hi = rep["gap_max"] - p_max, rep["gap_min"] + i_max
    e2 = 2 * TOL["surface_error_calibrated_mm"]
    return {"as_designed": as_designed, "in_window": lo <= -e2 and e2 <= hi, "window": [round(lo / 2, 3), round(hi / 2, 3)], "measured": True, "design_gap": g0}


def fit_summary(pairs):
    """Roll the per-rule verdicts up to one T1/T2 result and one manifest fit block."""
    vs = [(p, pair_verdict(p["rule"], p["rep"])) for p in pairs]
    measured = [(p, v) for p, v in vs if v["measured"]]
    wins = [v["window"] for _, v in measured if v["window"]]
    info = {"studs_measured": sum(p["rep"]["studs"] for p, _ in measured), "design_gap_mm": min([v["design_gap"] for _, v in measured], default=0.0),
            "pairs": [{"pin": p["rule"]["pin"], "bore": p["rule"]["bore"], "fit": p["rule"]["fit"],
                       **({"gap_min_mm": round(p["rep"]["gap_min"], 3), "gap_max_mm": round(p["rep"]["gap_max"], 3)} if p["rep"] and p["rep"]["studs"] else {"measured": False})} for p in pairs]}
    gaps = [p["rep"] for p, _ in measured if p["rep"] and p["rep"]["studs"]]
    if gaps:
        info.update(gap_min_mm=round(min(g["gap_min"] for g in gaps), 3), gap_max_mm=round(max(g["gap_max"] for g in gaps), 3),
                    surface_offset_window_mm=[max(w[0] for w in wins), min(w[1] for w in wins)], residual_error_mm=TOL["surface_error_calibrated_mm"])
    return {"as_designed": bool(measured or pairs) and all(v["as_designed"] for _, v in vs), "in_window": all(v["in_window"] for _, v in vs),
            "measured": len(measured), "listed": len(pairs), "info": info}


# ---------------------------------------------------------------- I4: bores on the grid and really there
def cell_positions(conn):
    g, (ox, oy, oz) = conn["grid"], conn["frame"]["origin"]
    omit = {tuple(c) for c in g.get("omit_cells", [])}
    return [(ox + i * g["pitch"], oy + j * g["pitch"], oz) for i in range(g["nx"]) for j in range(g["ny"]) if (i, j) not in omit]


def bores_on_grid(conns, m, bounds):
    oks, details = [], []
    for c in [c for c in conns if c["kind"] == "bore_grid"]:
        mm, cc = to_z_frame(m, c)
        b = mm.bounding_box()
        ok, d = _bores_on_grid([cc], mm, _np.array([b[:3], b[3:]]) if cc is not c else bounds)
        oks.append(ok)
        details.append(d)
    if not oks:
        return False, "no bores"
    n = sum(int(d.split()[0]) for d, ok in zip(details, oks) if ok and d.split()[0].isdigit())
    return all(oks), (f"{n} bore(s) on the lattice and present" if all(oks) else "; ".join(d for d, ok in zip(details, oks) if not ok))


def _bores_on_grid(conns, m, bounds):
    """Every declared bore is on the lattice and really exists. Lattice: a multiple of 1/8 TU apart, and either on the centre of a cell
    measured from the part's lower-left corner (lattice 'cell': beams, plates) or on the part's axis (lattice 'axis': gears, wheels).
    Existence: an empty probe inside the bore and material in a ring just outside it. Returns (ok, detail)."""
    n, n_pivot, bad = 0, 0, []
    lo = bounds[0]
    for c in conns:
        if c["kind"] != "bore_grid":
            continue
        g = c["grid"]
        pitch_steps = g["pitch"] / (TU / 8)
        if abs(pitch_steps - round(pitch_steps)) > 1e-6:
            bad.append(f"pitch {g['pitch']} mm is not a multiple of 1/8 TU")
        d = BORE["free_d"]
        probe_r = (min(d, BORE["fixed_flats"]) if c["bore_class"] == "fixed" else d) / 2 - 0.3
        for (x, y, z) in cell_positions(c):
            n += 1
            if c.get("lattice") == "pivot":
                n_pivot += 1  # steering pivot bore: position set by linkage geometry, existence still probed below
                on_lattice = True
                why = ""
            elif c.get("lattice", "cell") == "axis8":
                gx, gy = x / (TU / 8), y / (TU / 8)
                on_lattice = abs(gx - round(gx)) < 1e-3 and abs(gy - round(gy)) < 1e-3
                why = "not on the 1/8 TU lattice from the part axis"
            elif c.get("lattice", "cell") == "centre":
                gx, gy = x / g["pitch"], y / g["pitch"]
                on_lattice = abs(gx - round(gx)) < 1e-3 and abs(gy - round(gy)) < 1e-3
                why = "not a whole number of TU from the part axis"
            elif c.get("lattice", "cell") == "axis":
                on_lattice = abs(x) < 1e-3 and abs(y) < 1e-3
                why = "not on the part axis"
            else:
                base = min(g["pitch"], TU)                       # sparse bores (a ring's corner holes) still sit on TU cell centres
                gx, gy = (x - lo[0]) / (base / 2), (y - lo[1]) / (base / 2)
                on_lattice = all(abs(v - round(v)) < 1e-3 and round(v) % 2 == 1 for v in (gx, gy))   # odd multiples of half a pitch = cell centres
                why = "not on a cell centre"
            if not on_lattice:
                bad.append(f"({x:.2f},{y:.2f}) {why}")
                continue
            h = c["depth_mm"]
            inside = Manifold.cylinder(h - 4, probe_r, probe_r, 32).translate((x, y, z + 2))
            ring = Manifold.cylinder(h - 4, d / 2 + 0.6, d / 2 + 0.6, 48).translate((x, y, z + 2)) - Manifold.cylinder(h - 4, d / 2 + 0.3, d / 2 + 0.3, 48).translate((x, y, z + 2))
            if (m ^ inside).volume() > 0.5:
                bad.append(f"({x:.2f},{y:.2f}) no hole")
            elif (m ^ ring).volume() < 0.3 * ring.volume():
                bad.append(f"({x:.2f},{y:.2f}) hole larger than the bore")
    ok_msg = f"{n} bore(s) on the lattice and present" + (f" ({n_pivot} pivot-exempt, existence probed)" if n_pivot else "")
    return (not bad and n > 0), (ok_msg if not bad else "; ".join(bad[:3]))


# ---------------------------------------------------------------- I5: built dimensions and accepted pairs
def _outline_bounds(m, z, centre, mode, window=TU - 1.0):
    """Width and depth of the hole at `centre` (mode 'hole') or of the solid there (mode 'solid') in the slice at height z."""
    s = m.slice(z)
    sq = CrossSection.square((window, window), center=True).translate(centre)
    if mode == "solid":
        sol = s ^ sq
        if sol.is_empty():
            return None
        x0, y0, x1, y1 = sol.bounds()
        return x1 - x0, y1 - y0
    wx0, wy0, wx1, wy1 = sq.bounds()
    parts = [c for c in (sq - s).decompose() if c.bounds()[0] > wx0 + 0.01 and c.bounds()[1] > wy0 + 0.01 and c.bounds()[2] < wx1 - 0.01 and c.bounds()[3] < wy1 - 0.01]
    if not parts:
        return None
    comp = min(parts, key=lambda c: abs((c.bounds()[0] + c.bounds()[2]) / 2 - centre[0]) + abs((c.bounds()[1] + c.bounds()[3]) / 2 - centre[1]))
    x0, y0, x1, y1 = comp.bounds()
    return x1 - x0, y1 - y0


def pins_and_bores_built_right(conns, m):
    oks, details = [], []
    for c in [c for c in conns if c["kind"] in ("pin", "bore_grid")]:
        mm, cc = to_z_frame(m, c)
        ok, d = _pins_and_bores_built_right([cc], mm)
        oks.append(ok)
        details.append(d)
    if not oks:
        return False, "no pins or bores"
    n = sum(int(d.split()[0]) for d, ok in zip(details, oks) if ok and d.split()[0].isdigit())
    return all(oks), (f"{n} pin/bore feature(s) match the interface" if all(oks) else "; ".join(d for d, ok in zip(details, oks) if not ok))


def _pins_and_bores_built_right(conns, m):
    """Every pin and bore is accepted by at least one rule, and the built section matches the interface numbers. Returns (ok, detail)."""
    bad, n = [], 0
    for c in conns:
        if c["kind"] == "pin":
            n += 1
            if not rules_for_pin(c["interface"]):
                bad.append(f"{c['interface']} has no pin_bore rule")
                continue
            ox, oy, oz = c["frame"]["origin"]
            if profile_of(c["interface"]) == "friction":
                pf = IF["interfaces"]["pin_friction"]
                want_fin = BORE["free_d"] + pf["fin_oversize_mm"]
                for zf in c.get("fins_at_mm", []):
                    got = _outline_bounds(m, oz + zf, (ox, oy), "solid")
                    if got is None or abs(got[0] - want_fin) > 0.05:
                        bad.append(f"friction fin at {zf} mm built {None if got is None else round(got[0], 3)} across vs {want_fin}")
                gaps_z = [oz + (c["fins_at_mm"][i] + c["fins_at_mm"][i + 1]) / 2 for i in range(len(c["fins_at_mm"]) - 1)] or [oz + pf["slot_end_mm"] / 2]
                got = _outline_bounds(m, gaps_z[0], (ox, oy), "solid")
                if got is None or abs(got[0] - BORE["shaft_d"]) > DIM_TOL or abs(got[1] - BORE["shaft_flats"]) > DIM_TOL:
                    bad.append(f"friction core built {None if got is None else tuple(round(v, 3) for v in got)} vs {(BORE['shaft_d'], BORE['shaft_flats'])}")
                continue
            want = {"round": (BORE["shaft_d"], c.get("flats_mm", BORE["shaft_d"])), "flats": (BORE["shaft_d"], BORE["shaft_flats"])}[profile_of(c["interface"])]
            got = _outline_bounds(m, oz + c["length_mm"] / 2, (ox, oy), "solid")
            if got is None or any(abs(a - b) > DIM_TOL for a, b in zip(sorted(got), sorted(want))):
                bad.append(f"pin {c['interface']} built {None if got is None else tuple(round(v, 3) for v in got)} vs {want}")
        elif c["kind"] == "bore_grid":
            if not rules_for_bore(c["bore_class"]):
                bad.append(f"bore class {c['bore_class']} has no pin_bore rule")
                continue
            if c.get("print_profile") == "teardrop":
                r = BORE["free_d"] / 2
                want = (BORE["free_d"], r + r / math.sin(math.radians(90 - TEARDROP_ROOF_DEG)))
            else:
                want = (BORE["free_d"], BORE["fixed_flats"] if c["bore_class"] == "fixed" else BORE["free_d"])
            for (x, y, z) in cell_positions(c):
                n += 1
                got = _outline_bounds(m, z + c["depth_mm"] / 2, (x, y), "hole")
                if got is None or any(abs(a - b) > DIM_TOL for a, b in zip(sorted(got), sorted(want))):
                    bad.append(f"bore ({x:.1f},{y:.1f}) built {None if got is None else tuple(round(v, 3) for v in got)} vs {tuple(round(v, 3) for v in want)}")
    return (not bad and n > 0), (f"{n} pin/bore feature(s) match the interface" if not bad else "; ".join(bad[:3]))


# ---------------------------------------------------------------- I6: gears on the grid
def gear_on_grid(extras, tm_bounds, m=None):
    """A gear's module equals the interface module, its pitch diameter is a whole number of TU (so any two gears centre on the 0.5 TU grid),
    and the built tip diameter matches module x (teeth + 2). The tip is measured from the mesh: the farthest point from the hub axis."""
    g = extras.get("gear")
    if not g:
        return False, "no gear metadata"
    if g.get("kind") == "rack":
        import numpy as np
        top = float(np.max(np.asarray(m.to_mesh().vert_properties)[:, 1])) if m is not None else tm_bounds[1][1]
        steps = g["pitch_line_mm"] / (TU / 2)
        issues = [f"module {g['module_mm']} is not {GEAR['module_mm']}"] if abs(g["module_mm"] - GEAR["module_mm"]) > 1e-9 else []
        issues += [f"pitch line {g['pitch_line_mm']} mm is not on the 0.5 TU grid"] if abs(steps - round(steps)) > 1e-6 else []
        issues += [f"built tip line {top:.2f} vs {g['pitch_line_mm'] + g['module_mm']:.2f}"] if abs(top - (g["pitch_line_mm"] + g["module_mm"])) > 0.15 else []
        return not issues, (f"rack, module {g['module_mm']}, pitch line {g['pitch_line_mm']} mm from the bores ({steps / 2:.1f} TU), tip line {top:.2f} mm" if not issues else "; ".join(issues))
    mod, z = g["module_mm"], g["teeth"]
    pitch_tu = mod * z / TU
    ring = g.get("kind") == "ring"
    od = mod * (z - 2) if ring else mod * (z + 2)                 # a ring's teeth point inward: its tip circle is the inner one
    if m is not None:
        import numpy as np
        v = np.asarray(m.to_mesh().vert_properties)[:, :2]
        rr = np.hypot(v[:, 0], v[:, 1])
        built = 2 * float(np.min(rr) if ring else np.max(rr))
    else:
        built = max(tm_bounds[1][0] - tm_bounds[0][0], tm_bounds[1][1] - tm_bounds[0][1])
    issues = []
    if abs(mod - GEAR["module_mm"]) > 1e-9:
        issues.append(f"module {mod} is not {GEAR['module_mm']}")
    if abs(pitch_tu - round(pitch_tu)) > 1e-6:
        issues.append(f"pitch diameter {mod * z:.2f} mm is {pitch_tu:.3f} TU, not whole")
    if abs(built - od) > 0.15:
        issues.append(f"built tip diameter {built:.2f} vs {od:.2f}")
    return not issues, (f"module {mod}, {z} teeth, pitch {mod * z:.1f} mm = {pitch_tu:.0f} TU, tip {built:.2f} mm (design {od:.1f})" if not issues else "; ".join(issues))


# ---------------------------------------------------------------- gears
def _inv(phi):
    return math.tan(phi) - phi


def gear_numbers(z, m=None):
    m = m or GEAR["module_mm"]
    a = math.radians(GEAR["pressure_angle_deg"])
    r = m * z / 2
    return {"m": m, "a": a, "r": r, "rb": r * math.cos(a), "ra": r + m, "rf": r - 1.25 * m}


def spur_section(z, backlash=None):
    """Involute spur gear outline generated by conjugate basic-rack hobbing, teeth centred on angle 2*pi*k/z.
    Produces exact involute flanks above the base circle and true conjugate trochoid root clearance below rb (zero Z10/Z15 undercut interference)."""
    g = gear_numbers(z)
    mod, a, r = g["m"], g["a"], g["r"]
    bl = GEAR["backlash_mm"] if backlash is None else backlash
    s_cut = math.pi * mod / 2 + bl / 2
    h_add, h_ded = 1.25 * mod, 1.25 * mod
    w_tip, w_root = s_cut / 2 - h_add * math.tan(a), s_cut / 2 + h_ded * math.tan(a)
    one_tooth = CrossSection([[(r - h_add, -w_tip), (r + h_ded, -w_root), (r + h_ded, w_root), (r - h_add, w_tip)]])
    steps, phi_max = 48, 1.45 * (2 * math.pi / z)
    cuts = [one_tooth.translate((0, -r * phi_max * i / steps)).rotate(math.degrees(math.pi / z + phi_max * i / steps)) for i in range(-steps, steps + 1)]
    space_cut = CrossSection.batch_boolean(cuts, OpType.Add)
    all_cuts = CrossSection.batch_boolean([space_cut.rotate(360.0 * k / z) for k in range(z)], OpType.Add)
    return CrossSection.circle(g["ra"], max(SEGS, 160)) - all_cuts


def _hub_conn(depth):
    return {"id": "hub", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "fixed",
            "depth_mm": depth, "lattice": "axis", "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}


def spur_gear(teeth):
    """Spur gear on a fixed-bore hub (drives with a flat shaft). Prints flat; teeth are vertical walls."""
    T = GEAR["thickness_tu"] * TU
    g = gear_numbers(teeth)
    m = Manifold.extrude(spur_section(teeth), T) - bore_cutter("fixed", T)
    return m, [_hub_conn(T)], {"gear": {"kind": "spur", "module_mm": g["m"], "teeth": teeth, "pitch_d_mm": round(2 * g["r"], 3), "outer_d_mm": round(2 * g["ra"], 3),
                                        "pressure_angle_deg": GEAR["pressure_angle_deg"], "backlash_mm": GEAR["backlash_mm"], "thickness_mm": T}}


def _involute_outline(z, s_pitch, r_tip, r_root):
    """Closed outline of z involute teeth with tooth thickness s_pitch at the pitch circle, from r_root to r_tip."""
    g = gear_numbers(z)
    psi = s_pitch / (2 * g["r"])

    def half(rho):
        phi = math.acos(g["rb"] / max(rho, g["rb"]))
        return psi + _inv(g["a"]) - _inv(phi)
    rads = sorted(set([r_root] + [g["rb"]] * (r_root < g["rb"] < r_tip) + [r_root + (r_tip - r_root) * i / 16 for i in range(1, 17)]))
    pts = []
    for k in range(z):
        t0, t1 = 2 * math.pi * k / z, 2 * math.pi * (k + 1) / z
        pts += [(rho * math.cos(t0 - half(rho)), rho * math.sin(t0 - half(rho))) for rho in rads]
        h = half(r_tip)
        pts += [(r_tip * math.cos(t0 + u), r_tip * math.sin(t0 + u)) for u in (-h / 2, 0.0, h / 2)]
        pts += [(rho * math.cos(t0 + half(rho)), rho * math.sin(t0 + half(rho))) for rho in reversed(rads)]
        hr = half(r_root)
        pts += [(r_root * math.cos(u), r_root * math.sin(u)) for u in [t0 + hr + (t1 - t0 - 2 * hr) * i / 4 for i in range(1, 4)]]
    return CrossSection([pts])


def ring_gear(teeth, frame_tu):
    """Internal-tooth ring gear in a square frame frame_tu wide, held by four free bores on the corner cell centres.
    Its tooth spaces are the conjugate involute (a z-tooth outline from r - m to r + 1.25 m, spaces widened for backlash)."""
    g = gear_numbers(teeth)
    T, W = GEAR["thickness_tu"] * TU, frame_tu * TU
    cut = _involute_outline(teeth, math.pi * g["m"] / 2 + GEAR["backlash_mm"] / 2, g["r"] + 1.25 * g["m"], g["r"] - g["m"])
    m = rbox(W, W, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"]) - Manifold.extrude(cut, T + 0.2).translate((0, 0, -0.1))
    o = -W / 2 + TU / 2
    for x in (o, -o):
        for y in (o, -o):
            m = m - bore_cutter("free", T, x, y)
    conn = {"id": "frame_bores", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "free", "depth_mm": T,
            "frame": {"origin": [o, o, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 2, "ny": 2, "pitch": W - TU, "anchor": "corner"}}
    return m, [conn], {"gear": {"kind": "ring", "module_mm": g["m"], "teeth": teeth, "pitch_d_mm": round(2 * g["r"], 3), "outer_d_mm": round(2 * (g["r"] - g["m"]), 3),
                                "pressure_angle_deg": GEAR["pressure_angle_deg"], "backlash_mm": GEAR["backlash_mm"], "thickness_mm": T}}


def rack(length_tu):
    """Straight rack with free bores on the TU cell centres along y = 0 and teeth on the +y side. Its pitch line is 1 TU from the bore line,
    so a gear whose pitch radius is a whole number of half-TU meshes with its axis on the grid."""
    mod, a = GEAR["module_mm"], math.radians(GEAR["pressure_angle_deg"])
    T, L, yp = GEAR["thickness_tu"] * TU, length_tu * TU, TU
    p, s = math.pi * mod, math.pi * mod / 2 - GEAR["backlash_mm"] / 2
    y_root, y_tip = yp - 1.25 * mod, yp + mod
    w_root, w_tip = s / 2 + 1.25 * mod * math.tan(a), s / 2 - mod * math.tan(a)
    body = CrossSection.square((L, y_root + TU / 2)).translate((-L / 2, -TU / 2))
    k0, k1 = int(-L / 2 / p) - 1, int(L / 2 / p) + 1
    teeth = [CrossSection([[(xc - w_root, y_root - 0.2), (xc + w_root, y_root - 0.2), (xc + w_tip, y_tip), (xc - w_tip, y_tip)]]) for xc in [k * p for k in range(k0, k1 + 1)]]
    sec = (body + CrossSection.batch_hull([teeth[0]]) if False else body)
    for t in teeth:
        sec = sec + t
    sec = sec ^ CrossSection.square((L, y_tip + TU)).translate((-L / 2, -TU / 2 - 1))
    m = Manifold.extrude(sec, T)
    x0 = -L / 2 + TU / 2
    for i in range(length_tu):
        m = m - bore_cutter("free", T, x0 + i * TU, 0.0)
    conn = {"id": "bores", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "free", "depth_mm": T,
            "frame": {"origin": [x0, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": length_tu, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return m, [conn], {"gear": {"kind": "rack", "module_mm": mod, "pitch_line_mm": yp, "length_mm": L, "thickness_mm": T, "pressure_angle_deg": GEAR["pressure_angle_deg"]}}


# ---------------------------------------------------------------- catalog part builders (build.fn names one of these)
LAY_FLAT = [90, 0, 0]       # assembly axis z -> horizontal, flats (assembly y) -> top and bottom


def _pin_conn(interface, profile, length, z0=0.0, **extra):
    return {"id": "axis", "kind": "pin", "gender": "M", "interface": interface, "size_class": "pro", "fit_class": IF["interfaces"][interface]["fit_class"],
            "profile": profile, "length_mm": length, "frame": {"origin": [0.0, 0.0, z0], "normal": [0, 0, 1]},
            "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}, **extra}


def beam(length_tu, bore_class="free"):
    m, c = beam_blank(length_tu, bore_class)
    return m, [c], {}


def free_pin(length_tu=2):
    pf = IF["interfaces"]["pin_free"]
    L, hh, flats = length_tu * TU, pf["head_h_mm"], pf["shaft_flats"]
    head = Manifold.extrude(_double_d(pf["head_d_mm"], flats, corners=False), hh)
    shaft_body = Manifold.extrude(_double_d(BORE["shaft_d"], flats), L).translate((0, 0, hh - 0.01))
    m = head + shaft_body
    return m, [_pin_conn("pin_free", "round", L, z0=hh, flats_mm=flats)], {"print_rotation_deg": LAY_FLAT}


def shaft(length_tu):
    L = length_tu * TU
    return pin_solid("flats", L), [_pin_conn("shaft_drive", "flats", L)], {"print_rotation_deg": LAY_FLAT}


def friction_pin(length_tu=2, length_mm=None, fins_at_mm=None, slot_end_mm=None):
    """Friction pin with open insertion-end cantilever slots and solid center web(s) between TU modules (<2% PLA strain)."""
    pf = IF["interfaces"]["pin_friction"]
    L = length_mm or length_tu * TU
    fins_at = fins_at_mm or [(i + 0.5) * TU for i in range(length_tu)]
    se = pf["slot_end_mm"] if slot_end_mm is None else slot_end_mm
    core = Manifold.extrude(_double_d(BORE["shaft_d"], BORE["shaft_flats"]), L)
    w, yd = pf["slot_width_mm"], BORE["shaft_d"] + 2
    if len(fins_at) >= 2:
        webs = [(fins_at[i] + fins_at[i + 1]) / 2 for i in range(len(fins_at) - 1)]
        spans = [(-0.1, webs[0] - se)] + [(webs[i] + se, webs[i + 1] - se) for i in range(len(webs) - 1)] + [(webs[-1] + se, L + 0.1)]
    else:
        spans = [(2 * se, L + 0.1)]
    slots = [Manifold.cube((w, yd, z1 - z0)).translate((-w / 2, -yd / 2, z0)) for z0, z1 in spans if z1 > z0 + 0.05]
    slot = Manifold.batch_boolean(slots, OpType.Add) if len(slots) > 1 else slots[0]
    r_in, r_out = BORE["shaft_d"] / 2 - 0.3, (BORE["free_d"] + pf["fin_oversize_mm"]) / 2
    h, fl, W = r_out - BORE["shaft_d"] / 2, pf["fin_length_mm"], BORE["shaft_flats"]
    fins = None
    for zc in fins_at:
        prof = CrossSection([[(r_in, zc - fl / 2), (r_out, zc - fl / 2 + h), (r_out, zc + fl / 2 - h), (r_in, zc + fl / 2)]])
        fin = Manifold.extrude(prof, W).rotate((90, 0, 0)).translate((0, W / 2, 0))      # profile in x-z, extruded across the flats (y)
        pair = fin + fin.mirror((1, 0, 0))
        fins = pair if fins is None else fins + pair
    m = (core + fins) - slot
    return m, [_pin_conn("pin_friction", "friction", L, fins_at_mm=[round(z, 3) for z in fins_at])], {"print_rotation_deg": LAY_FLAT}


def bushing(thickness_tu):
    b = IF["pro"]["bushing"]
    T = thickness_tu * TU
    m = Manifold.cylinder(T, b["outer_d_mm"] / 2, b["outer_d_mm"] / 2, SEGS) - bore_cutter(b["bore_class"], T)
    conn = {"id": "hub", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": b["bore_class"],
            "depth_mm": T, "lattice": "axis", "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return m, [conn], {}


def _cells_conn(cells, bore_class="free", depth=None):
    nx, ny = max(i for i, _ in cells) + 1, max(j for _, j in cells) + 1
    omit = [[i, j] for i in range(nx) for j in range(ny) if (i, j) not in set(map(tuple, cells))]
    return {"id": "bores", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": bore_class,
            "depth_mm": depth or BEAM["section_tu"] * TU, "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0, 0, 1]},
            "grid": {"nx": nx, "ny": ny, "pitch": TU, "anchor": "corner", **({"omit_cells": omit} if omit else {})}}


def beam_cells(cells, bore_class="free"):
    """Rectilinear beam (L, T, ...) through the given TU cells, cell (i, j) centred at (i, j) * TU. Built from straight runs so the joints
    have no notches; one bore on every cell."""
    cells = [tuple(c) for c in cells]
    T = BEAM["section_tu"] * TU
    runs = []
    for axis in (0, 1):
        lines = {}
        for c in cells:
            lines.setdefault(c[1 - axis], []).append(c[axis])
        for k, vals in lines.items():
            vals, start = sorted(vals), None
            for v in vals + [None]:
                if start is None:
                    start = prev = v
                elif v is not None and v == prev + 1:
                    prev = v
                else:
                    if prev > start or axis == 0:
                        n = prev - start + 1
                        cx = ((start + prev) / 2 if axis == 0 else k) * TU
                        cy = (k if axis == 0 else (start + prev) / 2) * TU
                        w, d = (n * TU, TU) if axis == 0 else (TU, n * TU)
                        runs.append(rbox(w, d, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"]).translate((cx, cy, 0)))
                    start = prev = v
    m = runs[0]
    for r in runs[1:]:
        m = m + r
    for i, j in cells:
        m = m - bore_cutter(bore_class, T, i * TU, j * TU)
    return m, [_cells_conn(cells, bore_class)], {}


def beam_path(path, bore_class="free"):
    """Beam along a path of cells with rounded ends, so a 45 degree arm (cells one TU apart in x and y) keeps every bore on the lattice."""
    path = [tuple(c) for c in path]
    T = BEAM["section_tu"] * TU
    segs = [Manifold.extrude(CrossSection.batch_hull([CrossSection.circle(TU / 2, SEGS).translate((a[0] * TU, a[1] * TU)),
                                                       CrossSection.circle(TU / 2, SEGS).translate((b[0] * TU, b[1] * TU))]), T) for a, b in zip(path, path[1:])]
    m = segs[0]
    for s in segs[1:]:
        m = m + s
    for i, j in path:
        m = m - bore_cutter(bore_class, T, i * TU, j * TU)
    return m, [_cells_conn(path, bore_class)], {}


# ---------------------------------------------------------------- horizontal bores (W5)
TEARDROP_ROOF_DEG = 50


def bore_section_print(bore_class):
    """Section of a bore whose axis lies horizontal, +y up in print: a free bore becomes a teardrop with a 50 degree roof; a fixed bore keeps its
    flats, turned top and bottom, so the top flat is a short bridge."""
    if bore_class == "free":
        return _teardrop(BORE["free_d"], TEARDROP_ROOF_DEG, SEGS)        # fit-critical: fine circle, like every other bore
    r, f = BORE["free_d"] / 2, BORE["fixed_flats"] / 2
    s40 = r * math.sin(math.radians(40))
    band = CrossSection.circle(r, SEGS) ^ CrossSection.square((2 * r + 2, 2 * s40), center=True)
    xc = r * math.cos(math.radians(40)) - (f - s40) / math.tan(math.radians(50))       # 50 degree shoulder from 40 degrees up to the flat
    return CrossSection.batch_hull([band, CrossSection([[(-xc, -f), (xc, -f), (xc, f), (-xc, f)]])])


def bore_cutter_axis(bore_class, length, centre, axis):
    """Through-cutter for a horizontal bore along +x or +y, centred on `centre` (the middle of its length)."""
    sec = bore_section_print(bore_class)
    if axis == "x":
        cut = Manifold.extrude(sec.rotate(90), length + 0.2).rotate((0, 90, 0)).translate((-length / 2 - 0.1, 0, 0))
    elif axis == "y":
        cut = Manifold.extrude(sec, length + 0.2).rotate((90, 0, 0)).translate((0, length / 2 + 0.1, 0))
    else:
        raise ValueError("horizontal bores run along x or y")
    return cut.translate(centre)


def _axis_bore_conn(cid, bore_class, centre, axis, length, lattice="cell"):
    n = {"x": [1, 0, 0], "y": [0, 1, 0]}[axis]
    start = [centre[k] - (length / 2 if (axis == "x" and k == 0) or (axis == "y" and k == 1) else 0.0) for k in range(3)]
    c = {"id": cid, "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": bore_class,
         "depth_mm": length, "lattice": lattice, "frame": {"origin": [round(v, 4) for v in start], "normal": n}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}
    if bore_class == "free":
        c["print_profile"] = "teardrop"
    else:
        c["flats_normal"] = [0, 0, 1]          # printed with its flats top and bottom
    return c


def flats_normal(conn):
    """Which way a flat-sided pin's or a fixed bore's flats face, in the part's frame (local +y unless the connector says otherwise)."""
    if (conn["kind"] == "pin" and conn.get("profile") == "flats") or (conn["kind"] == "bore_grid" and conn.get("bore_class") == "fixed"):
        return _np.asarray(conn.get("flats_normal", [0, 1, 0]), dtype=float)
    return None


def wheel(diameter_tu):
    """Wheel on a fixed-bore hub (a flat shaft drives it, or it turns with a shaft in free beam bores). Crank bores on whole TU positions from the
    axis take pins. Tread grooves are vertical walls; the top edge is chamfered, the bed edge gets the usual small chamfer."""
    D, H = diameter_tu * TU, TU
    R = D / 2
    ch, bed = 1.5, BEAM["bed_chamfer_mm"]
    body = Manifold.batch_hull([Manifold.cylinder(0.01, R - bed, R - bed, 128), Manifold.cylinder(H - ch - bed, R, R, 128).translate((0, 0, bed)),
                                Manifold.cylinder(0.01, R - ch, R - ch, 128).translate((0, 0, H - 0.01))])
    n = int(round(math.pi * D / 4.0))
    groove = Manifold.cube((2.4, 1.6, H + 2)).translate((R - 1.2, -0.8, -1))
    for k in range(n):
        body = body - groove.rotate((0, 0, 360.0 * k / n))
    body = body - bore_cutter("fixed", H)
    cranks = [(i * TU, j * TU) for i in range(-diameter_tu, diameter_tu + 1) for j in range(-diameter_tu, diameter_tu + 1)
              if (i == 0) != (j == 0) and math.hypot(i * TU, j * TU) + BORE["free_d"] / 2 + 2.0 <= R - 1.2 - 1.0]
    for x, y in cranks:
        body = body - bore_cutter("free", H, x, y)
    k = max(abs(int(round(v / TU))) for p in cranks for v in p)
    omit = [[i, j] for i in range(2 * k + 1) for j in range(2 * k + 1) if ((i - k) * TU, (j - k) * TU) not in cranks]
    conns = [_hub_conn(H), {"id": "cranks", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "free",
             "depth_mm": H, "lattice": "centre", "frame": {"origin": [-k * TU, -k * TU, 0.0], "normal": [0, 0, 1]},
             "grid": {"nx": 2 * k + 1, "ny": 2 * k + 1, "pitch": TU, "anchor": "corner", "omit_cells": omit}}]
    return body, conns, {}


def cross_connector():
    """Joins two shafts at 90 degrees without their bores meeting: a 2 x 1 x 1 TU block with a vertical fixed bore in one cell and a fixed bore
    along y in the other. Both drive a flat shaft."""
    T = BEAM["section_tu"] * TU
    body = rbox(2 * TU, TU, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"])
    body = body - bore_cutter("fixed", T, -TU / 2, 0.0) - bore_cutter_axis("fixed", TU, (TU / 2, 0.0, T / 2), "y")
    v = {"id": "axle_z", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "fixed",
         "depth_mm": T, "frame": {"origin": [-TU / 2, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 1, "ny": 1, "pitch": TU, "anchor": "corner"}}
    return body, [v, _axis_bore_conn("axle_y", "fixed", (TU / 2, 0.0, T / 2), "y", TU)], {}


HINGE_CLEAR = 0.3   # mm between neighbouring knuckles along the hinge axis


def hinge_leaf():
    """One leaf of a two-leaf hinge (use two, the second turned 180 degrees, and a free pin through the knuckles). The leaf is a 2 x 1 x 1 TU block
    with two vertical free bores for mounting, and two knuckles along its far edge on alternate half-TU segments, so two identical leaves interleave.
    Knuckles are flat-bottomed with a round top, and their bore is a teardrop, so the leaf prints flat with no supports."""
    T = BEAM["section_tu"] * TU
    L = 2 * TU
    body = rbox(L, TU, T, BEAM["fillet_outer_mm"], BEAM["bed_chamfer_mm"])
    axis_y, axis_z, rk = TU, T / 2, TU / 2
    seg = L / 4
    conns = []
    for k, s in enumerate((0, 2)):
        x0, x1 = -L / 2 + s * seg + HINGE_CLEAR / 2, -L / 2 + (s + 1) * seg - HINGE_CLEAR / 2
        w = x1 - x0
        prof = CrossSection.batch_hull([CrossSection.square((2 * rk, axis_z)).translate((-rk, 0)), CrossSection.circle(rk, 64).translate((0, axis_z))])
        knuckle = Manifold.extrude(prof.rotate(90), w).rotate((0, 90, 0)).translate((x0, axis_y, 0))
        bridge = Manifold.cube((w, axis_y - TU / 2 + 0.5, T - 2.0)).translate((x0, TU / 2 - 0.5, 0))
        body = body + knuckle + bridge
        body = body - bore_cutter_axis("free", w, ((x0 + x1) / 2, axis_y, axis_z), "x")
        conns.append(_axis_bore_conn(f"knuckle{k}", "free", ((x0 + x1) / 2, axis_y, axis_z), "x", w, lattice="axis8"))
    for i in (0, 1):
        body = body - bore_cutter("free", T, -TU / 2 + i * TU, 0.0)
    conns.insert(0, {"id": "bores", "kind": "bore_grid", "gender": "F", "interface": "bore_grid", "size_class": "pro", "fit_class": "PIN", "bore_class": "free",
                     "depth_mm": T, "frame": {"origin": [-TU / 2, 0.0, 0.0], "normal": [0, 0, 1]}, "grid": {"nx": 2, "ny": 1, "pitch": TU, "anchor": "corner"}})
    return body, conns, {}


# ---------------------------------------------------------------- fixtures
def fixtures():
    """Pro stand-ins that go through the real gate (toyventor_parts.evaluate). They prove the Pro checks work before the catalog has Pro parts,
    and stay as regression fixtures after. Part dicts have the same shape as the generator's registry entries."""
    def mk(id, fam, fn):
        return dict(id=id, name=id, type="Pro fixture", line="pro", size="pro", stat="Fit", behavior="fixture", tags=[fam], family=fam, fn=fn, cavity=None, ref=None, kind=None)

    def beam(n, bc):
        def fn():
            b, c = beam_blank(n, bc)
            return b, [c], {}
        return fn

    def pin(iface, prof, length):
        def fn():
            b, c = pin_part(iface, prof, length)
            return b, [c], {}
        return fn

    def gear(z):
        def fn():
            b, c, e = gear_blank(z)
            return b, [c], e
        return fn
    return [mk("fx_beam_free_tu03", "beam", beam(3, "free")), mk("fx_beam_fixed_tu02", "beam", beam(2, "fixed")),
            mk("fx_pin_free", "pin", pin("pin_free", "round", 20)), mk("fx_shaft_drive", "shaft", pin("shaft_drive", "flats", 30)),
            mk("fx_gear_z20", "gear", gear(20))]
