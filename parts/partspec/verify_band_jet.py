#!/usr/bin/env python3
"""Independent kinematic check of the pull-back band core and the balloon jet piece.

Gate G1 passes at one static pose; it did not notice that the one-way clutch was built the wrong way round, that the jet nozzle set cannot be
seated, or that the jet body's air path is only about O5. This script measures those things on the generator's own geometry
(`toyventor_kitcard._raw_geo`, the same solids the viewer and the STLs use). Read-only: it writes nothing.

    parts/partspec/.venv/bin/python3 parts/partspec/verify_band_jet.py                    # the CAD in this tree
    parts/partspec/.venv/bin/python3 parts/partspec/verify_band_jet.py --ps /path/to/partspec   # another copy, e.g. an export of HEAD

Exit code 1 if any check FAILs. UNKNOWN means the check could not be run on this geometry (it never counts as a pass).

Checks (references: docs/specs/motion-stage-options-spec.md sections 1.2, 2 and 10):
  C1 clutch sense    Forward travel (-Y) spins the rear axle gear +X and, through the 1:1 external mesh, the PTO gear -X. For the band to drive the
                     wheels forward the clutch must LOCK when the spool turns -X relative to the gear and overrun the other way. Measured from the
                     overlap of the spool pawls with the gear pocket as the spool is turned: the steep side is the locking side.
  C2 pawl bite       Pawl tip radius minus the pocket crest radius; the spec's tooth rise is 0.75 mm.
  C3 shaft capture   How far shaft_tu03 (with the PTO gear fixed on it) can lift in +Z before touching the tray or lid, worst over its rotation.
  C4 nozzle seat     Whether each nozzle insert can be pushed into the jet body's rear socket without interference, and whether its orifice at the rear is its
                     narrowest section (an insert whose bore narrows inside flows like the narrower bore). Also probes the old 3-plug bar.
  C5 air path        Narrowest section of inlet / valve port / tunnel, and the thrust it allows (nozzle and passage as two orifices in series)
                     against rolling drag at 150 g; the agreed rule is thrust >= 1.3 x drag with some nozzle.
  C6 jet placement   mom_jet_valve_body on the keel's rear rows 8-9: no keel overlap, clearance to the wheels and the windscreen.
  C7 viewer pose     The Truck viewer's PTO and spool phases (17.5 and 27.0 deg) must still be interference-free.
  C8 gear mesh       The PTO gear at the viewer's phase must not overlap the rear axle gear's teeth.
"""
import argparse
import math
import os
import sys

import numpy as np
from manifold3d import CrossSection, Manifold

MIN_OVERLAP = 0.05          # mm3, the threshold the motion checks use
AXIS_Y, AXIS_Z = 43.75, 31.25
GEAR_X, SPOOL_X, SHAFT_X = -3.125, 3.85, -15.20       # as Truck-Mockup.html places them (band stage)
VIEWER_PTO_DEG, VIEWER_SPOOL_DEG = 17.5, 27.0


def rnd(v, n=2):
    return round(float(v), n)


class Ctx:
    def __init__(self, ps):
        sys.path.insert(0, ps)
        os.chdir(ps)
        import toyventor_kitcard as kc
        self.kc, self.cache = kc, {}

    def g(self, pid):
        return self.kc._raw_geo(pid, self.cache)


def on_axis(m, x, phase_deg):
    """Part with +z local along the spool axis, as the viewer does: translate(x, axis) * Ry(90) * Rz(phase)."""
    return m.rotate((0, 0, phase_deg)).rotate((0, 90, 0)).translate((x, AXIS_Y, AXIS_Z))


def overlap(a, b):
    return max(0.0, (a ^ b).volume())


# ---------------------------------------------------------------------------------------------------------------------------- C1
def check_clutch_sense(c):
    gear = on_axis(c.g("mom_pto_gear_z10"), GEAR_X, 0.0)
    spool = c.g("mom_band_spool_pawl")
    step, n = 0.5, 90                       # relative phase over one 45 deg tooth period
    ov = [overlap(on_axis(spool, SPOOL_X, i * step), gear) for i in range(n)]
    clear = [v <= MIN_OVERLAP for v in ov]
    if not any(clear):
        return "FAIL", "no interference-free relative phase over a full tooth period", {}
    if all(clear):
        return "FAIL", "the pawls never touch the pocket: the clutch cannot lock", {}
    # longest cyclic run of clear phases
    best, run, start = (0, 0), 0, 0
    for i in range(2 * n):
        if clear[i % n]:
            if run == 0:
                start = i
            run += 1
            if run > best[1] and run <= n:
                best = (start % n, run)
        else:
            run = 0
    lo, length = best
    hi = (lo + length - 1) % n
    v_plus = ov[(hi + 5) % n]               # 2.5 deg past the + edge of the clear window
    v_minus = ov[(lo - 5) % n]              # 2.5 deg past the - edge
    if v_plus > 3 * max(v_minus, 1e-6):
        side = "+"
    elif v_minus > 3 * max(v_plus, 1e-6):
        side = "-"
    else:
        side = "?"
    detail = f"clear window {lo*step:.1f}..{hi*step:.1f} deg; overlap 2.5 deg past the + edge {v_plus:.2f} mm3, past the - edge {v_minus:.2f} mm3; steep (locking) side: {side}"
    if side == "-":
        return "PASS", detail + " (locks when the spool turns -X relative to the gear, as forward drive needs)", {"side": side}
    if side == "+":
        return "FAIL", detail + " (locks when the spool turns +X: pull-back overruns, launch overruns, forward coast locks)", {"side": side}
    return "UNKNOWN", detail + " (no clearly steep side)", {"side": side}


# ---------------------------------------------------------------------------------------------------------------------------- C2
def _radii(m, z):
    cs = m.slice(z)
    out = []
    for poly in cs.to_polygons():
        out.extend(np.hypot(poly[:, 0], poly[:, 1]).tolist())
    return np.array(out)


def check_pawl_bite(c):
    gear, spool = c.g("mom_pto_gear_z10"), c.g("mom_band_spool_pawl")
    gbb = gear.bounding_box()
    bites, crests, tips = [], [], []
    for z in np.arange(0.125, spool.bounding_box()[5], 0.25):                # walk the spool; pair each slice with the gear slice at the same axial station
        gz = (SPOOL_X + z) - GEAR_X
        if gz < gbb[2] or gz > gbb[5]:
            continue
        rs = _radii(spool, z)
        rg = _radii(gear, gz)
        rg = rg[(rg > 8.5) & (rg < 10.9)]                                    # the pocket wall, not the bore or the outer teeth
        if len(rs) == 0 or len(rg) == 0 or rs.max() < 9.5:                   # only where a pawl tip reaches the pocket
            continue
        bites.append(rs.max() - rg.min())
        tips.append(rs.max())
        crests.append(rg.min())
    if not bites:
        return "UNKNOWN", "no axial station where a pawl tip meets the gear pocket (bite NOT verified)", {}
    bite = float(np.median(bites))
    detail = f"pawl tip radius {np.median(tips):.2f} mm, pocket crest {np.median(crests):.2f} mm at the same axial stations: nominal bite {bite:.2f} mm (spec tooth rise 0.75 mm)"
    return ("PASS" if bite >= 0.75 else "FAIL"), detail, {"bite": bite}


# ---------------------------------------------------------------------------------------------------------------------------- C3
def check_shaft_capture(c):
    shaft0, gear0 = c.g("shaft_tu03"), c.g("mom_pto_gear_z10")
    fixed = c.g("mom_band_core_tray").translate((0, 37.5, 12.5)) + c.g("mom_band_core_lid").translate((0, 37.5, 44.8))
    worst, worst_psi, seated_hits = 0.0, 0, []
    for psi in range(0, 180, 5):
        asm = on_axis(shaft0, SHAFT_X, psi) + on_axis(gear0, GEAR_X, psi)
        if overlap(asm, fixed) > MIN_OVERLAP:
            seated_hits.append(psi)
            continue
        lo, hi = 0.0, 3.0
        if overlap(asm.translate((0, 0, hi)), fixed) <= MIN_OVERLAP:
            lift = hi
        else:
            for _ in range(7):
                mid = (lo + hi) / 2
                if overlap(asm.translate((0, 0, mid)), fixed) > MIN_OVERLAP:
                    hi = mid
                else:
                    lo = mid
            lift = lo
        if lift > worst:
            worst, worst_psi = lift, psi
    note = f"; seated pose already interferes at {len(seated_hits)} of 36 rotation angles" if seated_hits else ""
    detail = f"shaft + PTO gear can lift {worst:.2f} mm at worst (rotation {worst_psi} deg) before the tray or lid stops it{note}"
    return ("PASS" if worst <= 0.5 and not seated_hits else "FAIL"), detail, {"lift": worst}


# ---------------------------------------------------------------------------------------------------------------------------- C4
def _insert_slabs(ns):
    """Individually printable inserts (joined by tabs and maybe a storage plate): find each insert from the plug cross-sections, which stay separate above the
    flange and plate, and return [(xc, slab)] where slab isolates one insert. Returns [] for the old monolithic bar (its bottom slice is a single plate)."""
    if len(ns.slice(0.5).decompose()) < 2:
        return []
    top = ns.bounding_box()[5]
    for z in (0.5 * top, 0.4 * top, 0.6 * top):
        comps = sorted(ns.slice(z).decompose(), key=lambda q: q.bounds()[0])
        if len(comps) >= 2:
            centres = [(cc.bounds()[0] + cc.bounds()[2]) / 2 for cc in comps]
            half = max(min(np.diff(centres)) / 2 - 0.3, 3.0)                 # half the nearest-neighbour spacing: includes the insert's flange, excludes the neighbours' plugs
            return [(xc, ns ^ Manifold.cube((2 * half, 20.0, 20.0)).translate((xc - half, -10.0, -1.0))) for xc in centres]
    return []


def _insert_bore(slab, xc):
    """(rear orifice diameter, narrowest bore diameter, offset of the rear bore's centre from the insert axis) of one insert, measured on slices along its axis.
    A large offset means something blocks part of the orifice (a half disc sits off-axis)."""
    bb = slab.bounding_box()
    areas, offset = [], 0.0
    for z in np.arange(bb[2] + 0.1, bb[5] - 0.05, 0.2):
        cs = slab.slice(z)
        if cs.is_empty():
            continue
        b = cs.bounds()
        box = CrossSection.square((b[2] - b[0] + 4, b[3] - b[1] + 4)).translate((b[0] - 2, b[1] - 2))
        hits = [comp for comp in (box - cs).decompose()
                if comp.bounds()[0] <= xc <= comp.bounds()[2] and comp.bounds()[1] <= 0.0 <= comp.bounds()[3] or
                (abs((comp.bounds()[0] + comp.bounds()[2]) / 2 - xc) < 3.0 and abs((comp.bounds()[1] + comp.bounds()[3]) / 2) < 1.0)]
        hits = [h for h in hits if h.area() < 0.5 * box.area()]
        if hits:
            h = min(hits, key=lambda q: q.area())
            if not areas:
                offset = abs((h.bounds()[0] + h.bounds()[2]) / 2 - xc)
            areas.append(h.area())
    if not areas:
        return None, None, 0.0
    d = lambda a: 2 * math.sqrt(a / math.pi)
    return d(areas[0]), d(min(areas)), offset


def check_nozzle_seat(c):
    vb, ns = c.g("mom_jet_valve_body"), c.g("mom_nozzle_set")
    slabs = _insert_slabs(ns)
    if slabs:
        notes, bad = [], []
        for xc, slab in slabs:
            seated = slab.rotate((90, 0, 0)).translate((-xc, 17.2, 12.5))            # plug pointing into the body, rear socket axis at (0, y, 12.5)
            ov, tip = overlap(seated, vb), seated.bounding_box()[1]
            rear, throat, off = _insert_bore(slab, xc)
            if ov > 0.5 or tip > 10.0:
                bad.append(f"insert at x {xc:+.1f}: overlap {ov:.1f} mm3, tip y {tip:.1f}")
            if rear is None:
                bad.append(f"insert at x {xc:+.1f}: bore not measurable")
                continue
            if off > 0.4:
                bad.append(f"insert at x {xc:+.1f}: the rear orifice is centred {off:.1f} mm off the insert axis, so part of it is blocked (storage plate across the bore?); measured O{rear:.1f}")
            if throat < 0.97 * rear:
                bad.append(f"insert at x {xc:+.1f}: rear orifice O{rear:.1f} but narrowest bore O{throat:.1f} (the throat is inside, so it flows like O{throat:.1f})")
            notes.append(f"O{rear:.1f}/{throat:.1f}")
        detail = f"{len(slabs)} inserts, rear orifice / narrowest bore: {', '.join(notes)}"
        if bad:
            return "FAIL", detail + "; " + "; ".join(bad), {}
        return "PASS", detail + "; every insert seats with <= 0.5 mm3 overlap, tip inside the socket, orifice at the rear is the narrowest section", {}
    bb = np.array(ns.bounding_box())
    size = bb[3:] - bb[:3]
    if not np.allclose(size, [42.0, 14.0, 13.5], atol=0.15):
        return "UNKNOWN", f"nozzle part is {np.round(size, 1).tolist()} mm and no separate inserts were found: update this probe (seating NOT verified)", {}
    worst = 0.0                                                         # the old bar: three plugs at x = -7.5, 2.5, 13.0 along +z; seat each alone
    for xc in (-7.5, 2.5, 13.0):
        one = ns ^ Manifold.cube((10.0, 20.0, 20.0)).translate((xc - 5.0, -10.0, -1.0))
        worst = max(worst, overlap(one.translate((-xc, 0, 0)).rotate((90, 0, 0)).translate((0, 19.2, 12.5)), vb))
    bar = overlap(ns.translate((-2.5, 0, 0)).rotate((90, 0, 0)).translate((0, 19.2, 12.5)), vb)
    detail = f"3-plug bar: a single plug seated against the rear face overlaps the body by up to {worst:.1f} mm3; the whole bar by {bar:.0f} mm3"
    return ("PASS" if worst <= 5.0 else "FAIL"), detail, {}


# ---------------------------------------------------------------------------------------------------------------------------- C5
def _enclosed_area(cs, point):
    """Area of the smallest void of cross-section `cs` whose bounds contain `point` (an enclosed hole), or None."""
    b = cs.bounds()
    box = CrossSection.square((b[2] - b[0] + 4, b[3] - b[1] + 4)).translate((b[0] - 2, b[1] - 2))
    hits = [comp.area() for comp in (box - cs).decompose()
            if comp.bounds()[0] <= point[0] <= comp.bounds()[2] and comp.bounds()[1] <= point[1] <= comp.bounds()[3]]
    return min(hits) if hits else None


def _valve_port_area(c):
    """The slide valve's cross-port runs along print x (the flow direction y in assembly). Slice the valve in the plane x = 0 (perpendicular to the port):
    the largest enclosed hole; if the port breaks out of the stem outline, the open area is the convex-hull gap inside the port band (reported as estimated)."""
    sv = c.g("mom_jet_slide_valve").rotate((0, -90, 0))                     # print x -> z; slicing at z = 0 is the plane x = 0; 2D coordinates are (-z_print, y_print)
    cs = sv.slice(0.0)
    if cs.is_empty():
        return None, False
    b = cs.bounds()
    box = CrossSection.square((b[2] - b[0] + 4, b[3] - b[1] + 4)).translate((b[0] - 2, b[1] - 2))
    holes = [comp.area() for comp in (box - cs).decompose()
             if comp.bounds()[0] > b[0] + 0.05 and comp.bounds()[1] > b[1] + 0.05 and comp.bounds()[2] < b[2] - 0.05 and comp.bounds()[3] < b[3] - 0.05]
    if holes:
        return max(holes), False
    band = cs ^ CrossSection.square((5.4, 40.0)).translate((-23.7, -20.0))       # the port band, z_print 18.3 .. 23.7
    if band.is_empty():
        return None, False
    return band.hull().area() - band.area(), True


def check_air_path(c):
    vb = c.g("mom_jet_valve_body")
    inlet = _enclosed_area(vb.slice(22.0), (0.0, -3.0))
    tunnel = _enclosed_area(vb.rotate((90, 0, 0)).slice(4.5), (0.0, -12.5))        # y = 4.5 plane; rotated (x, y') = (x, -z)
    port, estimated = _valve_port_area(c)
    stations = {"inlet": inlet, "tunnel": tunnel, "valve_port": port}
    if any(v is None for v in stations.values()):
        return "UNKNOWN", f"could not measure every station {stations} (air path NOT verified)", {}
    a1 = min(stations.values())
    nozzles = []                                                                # (label, throat diameter): measured on the inserts when there are some
    for xc, slab in _insert_slabs(c.g("mom_nozzle_set")):
        rear, throat, off = _insert_bore(slab, xc)
        if throat:
            nozzles.append((f"O{rear:.1f}", throat))
    measured = bool(nozzles)
    if not nozzles:
        nozzles = [(f"O{d:g}", d) for d in (3.0, 4.5, 6.0, 8.0)]
    rho, dp, drag = 1.2, 2500.0, 0.045 * 0.150 * 9.81
    best, parts = 0.0, []
    for label, d in nozzles:
        a2 = math.pi * (d / 2) ** 2
        aeff = 1 / math.sqrt(1 / a1 ** 2 + 1 / a2 ** 2) * 1e-6
        q = aeff * math.sqrt(2 * dp / rho)
        f = rho * q * q / (a2 * 1e-6)
        best = max(best, f)
        parts.append(f"{label}: {f*101.97:.1f} gf")
    ratio = best / drag
    eq = 2 * math.sqrt(a1 / math.pi)
    detail = (f"sections inlet {inlet:.1f}, valve port {port:.1f}{' (estimated: the port breaks out of the stem outline)' if estimated else ''}, tunnel {tunnel:.1f} mm2 "
              f"(narrowest = O{eq:.2f}); thrust at 2.5 kPa through the body with {'the inserts as measured (narrowest bore)' if measured else 'nominal nozzles'}: "
              f"{', '.join(parts)}; best {best*101.97:.1f} gf = {ratio:.2f}x rolling drag at 150 g (rule: >= 1.3x)")
    return ("PASS" if ratio >= 1.3 else "FAIL"), detail, {"narrowest_d": eq, "ratio": ratio}


# ---------------------------------------------------------------------------------------------------------------------------- C6
def check_jet_placement(c):
    keel, vb = c.g("kit_keel_base"), c.g("mom_jet_valve_body").translate((0, 50.0, 12.5))
    ov = overlap(vb, keel)
    gaps = {}
    for label, pid in (("wheel O36", "kit_wheel_med"), ("wheel O50", "kit_wheel_giant")):
        w = c.g(pid).rotate((0, 90, 0)).translate((26.7, AXIS_Y, 6.25))
        gaps[label] = vb.min_gap(w, 20.0)
    ws = vb.min_gap(c.g("kit_windscreen").translate((0, -6.25, 12.5)), 40.0)
    gear_ov = overlap(vb, c.g("gear_spur_z10").rotate((0, 90, 0)).translate((-3.125, AXIS_Y, 6.25)))
    ok = ov <= MIN_OVERLAP and all(v >= 1.0 for v in gaps.values()) and ws >= 10.0
    detail = (f"keel overlap {ov:.2f} mm3; gap to wheels " + ", ".join(f"{k} {v:.2f}" for k, v in gaps.items()) + f" mm; windscreen {ws:.1f} mm; "
              f"rear axle gear overlap {gear_ov:.0f} mm3 (the jet stage carries no axle gear)")
    return ("PASS" if ok else "FAIL"), detail, {}


# ---------------------------------------------------------------------------------------------------------------------------- C7
def check_viewer_pose(c):
    gear = on_axis(c.g("mom_pto_gear_z10"), GEAR_X, VIEWER_PTO_DEG)
    spool = on_axis(c.g("mom_band_spool_pawl"), SPOOL_X, VIEWER_SPOOL_DEG)
    ov = overlap(gear, spool)
    return ("PASS" if ov <= MIN_OVERLAP else "FAIL"), f"PTO gear vs spool overlap at the viewer's phases ({VIEWER_PTO_DEG}, {VIEWER_SPOOL_DEG} deg): {ov:.2f} mm3", {}


def check_gear_mesh(c):
    pto = on_axis(c.g("mom_pto_gear_z10"), GEAR_X, VIEWER_PTO_DEG)
    axle = c.g("gear_spur_z10").rotate((0, 90, 0)).translate((GEAR_X, AXIS_Y, 6.25))
    ov = overlap(pto, axle)
    return ("PASS" if ov <= MIN_OVERLAP else "FAIL"), f"PTO gear (viewer phase {VIEWER_PTO_DEG} deg) vs rear axle gear tooth overlap: {ov:.2f} mm3", {}


CHECKS = [
    ("C1", "clutch locks the right way", check_clutch_sense),
    ("C2", "pawl bite", check_pawl_bite),
    ("C3", "shaft capture in the saddles", check_shaft_capture),
    ("C4", "nozzle plug seats in the socket", check_nozzle_seat),
    ("C5", "air path lets the jet move the truck", check_air_path),
    ("C6", "jet body on the truck", check_jet_placement),
    ("C7", "viewer pose is clear", check_viewer_pose),
    ("C8", "PTO gear meshes with the axle gear at the viewer phase", check_gear_mesh),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ps", default=os.path.dirname(os.path.abspath(__file__)), help="partspec directory to check (default: this one)")
    ap.add_argument("--only", help="comma-separated check ids, e.g. C1,C5")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    c = Ctx(os.path.abspath(args.ps))
    print(f"checking the CAD in {args.ps}")
    fails = unknown = 0
    for cid, title, fn in CHECKS:
        if only and cid not in only:
            continue
        try:
            status, detail, _ = fn(c)
        except Exception as e:                      # a check that crashes is not a pass
            status, detail = "UNKNOWN", f"check crashed: {type(e).__name__}: {e}"
        fails += status == "FAIL"
        unknown += status == "UNKNOWN"
        print(f"{status:7s} {cid} {title}: {detail}", flush=True)
    print(f"\n{fails} FAIL, {unknown} UNKNOWN")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
