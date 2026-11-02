#!/usr/bin/env python3
"""Calibration guide, step 1 of 2: geometry and assemblies for calibration-guide.html.

Reads the printed calibration STLs from ../calibration, splits the breakaway-tab first-print coupon into the pieces you
snap apart, places every gauge pair in its test pose (the "construction" view) with an explode offset (the "exploded"
view), checks each pose for interference, and writes guide_assets.json. build.mjs bundles that with the viewer into one
self-contained page.

Run from anywhere:  parts/partspec/.venv/bin/python3 parts/partspec/calibration_guide/build_guide.py
Exit code is non-zero if a pose interferes more than it should or a split does not cut through the tabs only.
"""
import base64
import json
import re
import sys
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import Manifold, Mesh

PARTSPEC = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PARTSPEC))
import toyventor_parts as tp  # noqa: E402
import toyventor_pro as pro  # noqa: E402

CAL = PARTSPEC / "calibration"
OUT = Path(__file__).resolve().parent / "guide_assets.json"
TU = pro.TU                                    # 12.5 mm lattice
STUD = tp.STUD["small"]
GAP, PLATE_H, STUD_H = STUD["gap"], STUD["plate_h"], STUD["stud_h"]
STEPS_MM = [round(-0.1 + 0.1 * k, 2) for k in range(8)]
LABEL_STEP = 2                                 # step 2 carries the dimple (designed size)

problems = []


# ------------------------------------------------------------------ small geometry helpers
def mat(R=None, t=(0, 0, 0)):
    m = np.eye(4)
    if R is not None:
        m[:3, :3] = R
    m[:3, 3] = t
    return m


def rx(d):
    c, s = np.cos(np.radians(d)), np.sin(np.radians(d))
    return mat(np.array([[1, 0, 0], [0, c, -s], [0, s, c]]))


def ry(d):
    c, s = np.cos(np.radians(d)), np.sin(np.radians(d))
    return mat(np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]))


def rz(d):
    c, s = np.cos(np.radians(d)), np.sin(np.radians(d))
    return mat(np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]))


def tr(x, y, z):
    return mat(t=(x, y, z))


def clean(m):
    return np.round(m, 9)


def load(name):
    return trimesh.load(CAL / name, force="mesh")


def to_manifold(tm):
    return Manifold(Mesh(vert_properties=np.asarray(tm.vertices, np.float32), tri_verts=np.asarray(tm.faces, np.uint32)))


def to_trimesh(m):
    me = m.to_mesh()
    return trimesh.Trimesh(np.asarray(me.vert_properties)[:, :3], np.asarray(me.tri_verts), process=True)


def slab(x0, x1, big=500.0):
    return Manifold.cube((x1 - x0, 2 * big, 2 * big)).translate((x0, -big, -big))


def stl_b64(tm):
    return base64.b64encode(tm.export(file_type="stl")).decode("ascii")


def overlap(a, b, ma, mb):
    """Interference volume (mm3) between part a posed by ma and part b posed by mb."""
    return (a.transform(ma[:3, :]) ^ b.transform(mb[:3, :])).volume()


def check_pose(label, a, b, ma, mb, limit_frac):
    """Fail if the shared volume exceeds limit_frac of the smaller part (designed crush ribs and fins are a few percent)."""
    v = overlap(a, b, ma, mb)
    frac = v / min(a.volume(), b.volume())
    ok = frac <= limit_frac
    print(f"  {'ok  ' if ok else 'FAIL'} {label:44s} overlap {v:8.3f} mm3  ({frac * 100:5.2f}% of smaller part)")
    if not ok:
        problems.append(f"{label}: {frac * 100:.1f}% overlap")
    return v


def seated(label, small, small_pose, big_part, big_pose, min_vol):
    """Fail unless at least min_vol mm3 of `small` lies inside the footprint box of the big part (i.e. it is really in the hole, not beside it)."""
    lo, hi = MESH[big_part].bounds
    box = Manifold.cube(tuple(float(v) for v in (hi - lo))).translate(tuple(float(v) for v in lo)).transform(big_pose[:3, :])
    v = (small.transform(small_pose[:3, :]) ^ box).volume()
    ok = v >= min_vol
    print(f"  {'ok  ' if ok else 'FAIL'} {label:44s} {v:8.1f} mm3 inside the host (need >= {min_vol:.0f})")
    if not ok:
        problems.append(f"{label}: only {v:.1f} mm3 inside the host")


# ------------------------------------------------------------------ parts
RAW = {
    "first_print": load("toyventor_cal_forge_mount_first_print.stl"),
    "snap_ladder": load("toyventor_cal_snap_ladder.stl"),
    "stud_tester": load("toyventor_cal_stud_tester.stl"),
    "pro_ladder": load("toyventor_cal_pro_ladder.stl"),
    "shaft": load("toyventor_shaft_tu03_P.stl"),
    "pin_free": load("toyventor_pin_free_P.stl"),
    "pin_friction": load("toyventor_pin_friction_P.stl"),
    "cube": load("toyventor_cal_cube_cell.stl"),
    "face_plate": load("toyventor_cal_face_plate.stl"),
    "flex_skin": load("toyventor_cal_flex_skin_coupon.stl"),
}

# Breakaway-tab geometry mirrors make_calibration._build_first_print_components (tab = 3.2 x 1.2 mm bridge).
BRIDGE = 3.6
W_M = 3 * TU - 2 * GAP
W_S = 15.0
X_S = W_M / 2 + BRIDGE + W_S / 2
W_T = 2 * TU - 2 * GAP
X_T = X_S + W_S / 2 + BRIDGE + W_T / 2
SHIFT = -((X_T + W_T / 2) - W_M / 2) / 2.0
FP_CUT = [W_M / 2 + BRIDGE / 2 + SHIFT, X_S + W_S / 2 + BRIDGE / 2 + SHIFT]      # mid-gap planes: mount|strip, strip|brick
FP_MOUNT_X, FP_STRIP_X, FP_STUD_X = SHIFT, X_S + SHIFT, X_T + TU / 2 + SHIFT


def split_x(tm, cuts, names, tab_count):
    """Cut a coupon with vertical planes through the middle of its breakaway tabs; every plane must cross tabs only."""
    m = to_manifold(tm)
    edges = [-500.0] + list(cuts) + [500.0]
    parts = {}
    for i, name in enumerate(names):
        parts[name] = m ^ slab(edges[i], edges[i + 1])
    tab_area = 3.2 * 1.2
    for c, n_tabs in zip(cuts, tab_count):
        area = (m ^ slab(c - 0.005, c + 0.005)).volume() / 0.01
        ok = 0.6 * n_tabs * tab_area <= area <= 1.05 * n_tabs * tab_area
        print(f"  {'ok  ' if ok else 'FAIL'} cut x={c:7.3f}: cross-section {area:5.2f} mm2 (expect about {n_tabs * tab_area:.2f} for {n_tabs} tab(s))")
        if not ok:
            problems.append(f"cut at x={c:.2f} is not tabs only ({area:.2f} mm2)")
    for name, pm in parts.items():
        bodies = len(to_trimesh(pm).split(only_watertight=False))
        if bodies != 1:
            problems.append(f"{name}: {bodies} bodies after split")
    total = sum(p.volume() for p in parts.values())
    if abs(total - m.volume()) > 1e-3 * m.volume():
        problems.append("split volumes do not add up")
    return parts


print("Splitting the joined coupon")
fp = split_x(RAW["first_print"], FP_CUT, ["fp_mount", "fp_strip", "fp_brick"], [2, 1])

MAN = {
    **fp,
    **{k: to_manifold(RAW[k]) for k in ("snap_ladder", "stud_tester", "pro_ladder", "shaft", "pin_free", "pin_friction", "cube", "face_plate", "flex_skin")},
}
MESH = {k: (RAW[k] if k in RAW else to_trimesh(v)) for k, v in MAN.items()}

PART_META = {
    "fp_mount":     ("Forge Mount base (3x2 studs)", "body"),
    "fp_strip":     ("1/2/3-dot socket strip", "gauge"),
    "fp_brick":     ("2x1 test brick (1 stud)", "tester"),
    "snap_ladder":  ("Snap ladder", "gauge"),
    "stud_tester":  ("Stud tester", "tester"),
    "pro_ladder":   ("Pro ladder", "gauge"),
    "shaft":        ("Shaft", "tester"),
    "pin_free":     ("Free pin", "tester"),
    "pin_friction": ("Friction pin", "tester"),
    "cube":         ("Cube cell", "gauge"),
    "face_plate":   ("Face plate", "tester"),
    "flex_skin":    ("Flex skin coupon", "soft"),
}


def bbox(pid):
    lo, hi = MESH[pid].bounds
    return [lo.round(4).tolist(), hi.round(4).tolist()]


# pins are printed lying down (axis along print y, flats up/down); P2A maps print frame -> assembly frame (axis +z, flats +-y)
def p2a(pid):
    lo, hi = MESH[pid].bounds
    zc = (lo[2] + hi[2]) / 2
    return np.array([[1, 0, 0, 0], [0, 0, 1, -zc], [0, -1, 0, 0], [0, 0, 0, 1.0]])


# ------------------------------------------------------------------ poses
def item(key, part, m, ex=(0, 0, 0), **extra):
    return {"key": key, "part": part, "m": clean(m).reshape(-1).tolist(), "ex": list(ex), **extra}


def variant(vid, label, items, labels=()):
    return {"id": str(vid), "label": label, "items": items, "labels": list(labels)}


def lab(text, key, p, **extra):
    return {"text": text, "key": key, "p": [round(float(v), 4) for v in p], **extra}


ID = np.eye(4)
SCENES = {}


def fmt_d(d):
    return f"{d:+.1f}" if abs(d) > 1e-9 else "0.0"


# --- prep: the joined first-print plate, tabs and snap lines
FP_T = tr(0, 0, 0)
SCENES["prep"] = {
    "title": "Snap the tabs", "explodable": True, "cam": "top", "explode": 1.0,
    "variants": [variant("all", "First-print plate", [
        item("mount", "fp_mount", FP_T, (-16, 0, 0)),
        item("strip", "fp_strip", FP_T, (0, 0, 0)),
        item("brick", "fp_brick", FP_T, (16, 0, 0)),
    ], [
        lab("snap", "mount", (FP_CUT[0], 0, 3.2), cls="snap"),
        lab("snap", "strip", (FP_CUT[1], 0, 10.5), cls="snap"),
    ])],
}

# --- 1: dotted strip + brick. The strip's sockets open downward, so the strip drops over the brick's stud.
STRIP_SOCKET_Y = [-TU, 0.0, TU]
dot_names = ["1 dot · Snug", "2 dots · Standard", "3 dots · Easy"]
dot_clearance = [0.00, 0.10, 0.26]
dots_variants = []
print("Pose check: dotted strip on test brick")
for j, yc in enumerate(STRIP_SOCKET_Y):
    ms = tr(FP_STUD_X - FP_STRIP_X, -yc, PLATE_H)
    check_pose(f"{dot_names[j]} socket on brick stud", MAN["fp_strip"], MAN["fp_brick"], ms, ID, 0.08)
    dots_variants.append(variant(j + 1, dot_names[j], [
        item("brick", "fp_brick", ID, (0, 0, 0)),
        item("strip", "fp_strip", ms, (0, 0, 30)),
    ], [lab(str(k + 1), "strip", (FP_STRIP_X, y2, 11.8), pick=str(k + 1), sub=f"{dot_clearance[k]:.2f} mm") for k, y2 in enumerate(STRIP_SOCKET_Y)]))
SCENES["dots"] = {"title": "Dot strip", "explodable": True, "cam": "iso", "explode": 0.0, "variants": dots_variants, "default": "2"}


# --- A / B / C: ladders and the gauges that go in them
def hole_x(k, length=8 * TU):
    return -length / 2 + TU / 2 + (k - 1) * TU


def ladder_labels(key, H, rows_note):
    out = []
    for k in range(1, 9):
        out.append(lab(str(k), key, (hole_x(k), -TU - 3.5, H / 2), pick=str(k), sub=fmt_d(STEPS_MM[k - 1])))
    out.append(lab("notch", key, (-L_HALF - 3.5, TU + 3.5, H), cls="note", sub="step 1 side"))
    out.append(lab("dimple", key, (hole_x(LABEL_STEP), rows_note, H + 0.5), cls="note", sub="designed size"))
    return out


L_HALF = 4 * TU
SNAP_H = STUD["plate_h"]
PRO_H = pro.BEAM["section_tu"] * TU
ROW_FIXED, ROW_FREE = TU / 2, -TU / 2          # pro ladder: flat-sided bores y>0 (notched edge), round bores y<0

# A: stud tester flipped so its stud points down into hole k; the handle points along the ladder
stud_x = RAW["stud_tester"]
tester_stud_x = -TU                              # the designed stud sits at the end of the 3x1 handle
print("Pose check: stud tester in snap ladder (every step)")
a_variants = []
a_ov = []
for k in range(1, 9):
    if k <= 4:
        mt = tr(hole_x(k) - tester_stud_x, ROW_FIXED, SNAP_H + PLATE_H) @ rx(180)
    else:
        mt = tr(hole_x(k) + tester_stud_x, ROW_FIXED, SNAP_H + PLATE_H) @ ry(180)
    a_ov.append(overlap(MAN["snap_ladder"], MAN["stud_tester"], ID, mt))
    seated(f"stud tester in hole {k}", MAN["stud_tester"], mt, "snap_ladder", ID, 85)
    a_variants.append(variant(k, f"Step {k} ({fmt_d(STEPS_MM[k - 1])} mm)", [
        item("ladder", "snap_ladder", ID),
        item("tester", "stud_tester", mt, (0, 0, 22)),
    ], ladder_labels("ladder", SNAP_H, -ROW_FIXED)))
# the CAD never interferes here by design (clearance >= 0 even at step 1); any tightness you feel is the printer's surface growth
print("  overlap by step (mm3, CAD clearance is >= 0 at every step):", " ".join(f"{v:.2f}" for v in a_ov))
if max(a_ov) > 0.5:
    problems.append(f"stud tester interferes in CAD: {a_ov}")
SCENES["snap"] = {"title": "Snap ladder", "explodable": True, "cam": "iso", "explode": 0.0, "variants": a_variants, "default": "2"}

# B: shaft in the flat-sided row (flats face the print y direction in both parts)
SH = p2a("shaft")
PM = tr
b_ov = []
b_variants = []
for k in range(1, 9):
    ms = tr(hole_x(k), ROW_FIXED, -5.0) @ SH
    b_ov.append(overlap(MAN["pro_ladder"], MAN["shaft"], ID, ms))
    seated(f"shaft in flat-sided hole {k}", MAN["shaft"], ms, "pro_ladder", ID, 250)
    b_variants.append(variant(k, f"Step {k} ({fmt_d(STEPS_MM[k - 1])} mm)", [
        item("ladder", "pro_ladder", ID),
        item("pin", "shaft", ms, (0, 0, 30)),
    ], ladder_labels("ladder", PRO_H, 0.0)))
print("Pose check: shaft in flat-sided row")
print("  overlap by step (mm3):", " ".join(f"{v:.2f}" for v in b_ov))
if max(b_ov) > 0.5:
    problems.append(f"shaft interferes in CAD: {b_ov}")
SCENES["pro_b"] = {"title": "Shaft in flat-sided row", "explodable": True, "cam": "iso", "explode": 0.0, "variants": b_variants, "default": "2"}

# C: free pin (head up) and friction pin in the round row
FREE_HEAD_T = 2.0
PF = p2a("pin_free")
PR = p2a("pin_friction")
free_len = float((MESH["pin_free"].bounds[1][1] - MESH["pin_free"].bounds[0][1]))
c_free, c_fric = [], []
cf_ov, cr_ov = [], []
for k in range(1, 9):
    mf = tr(hole_x(k), ROW_FREE, PRO_H + FREE_HEAD_T) @ rx(180) @ PF           # head on top, tip down through the bore
    mr = tr(hole_x(k), ROW_FREE, 0.0) @ PR                                      # first fin set sits mid-bore
    cf_ov.append(overlap(MAN["pro_ladder"], MAN["pin_free"], ID, mf))
    cr_ov.append(overlap(MAN["pro_ladder"], MAN["pin_friction"], ID, mr))
    seated(f"free pin in round hole {k}", MAN["pin_free"], mf, "pro_ladder", ID, 300)
    seated(f"friction pin in round hole {k}", MAN["pin_friction"], mr, "pro_ladder", ID, 150)
    labs = ladder_labels("ladder", PRO_H, 0.0)
    c_free.append(variant(k, f"Step {k} ({fmt_d(STEPS_MM[k - 1])} mm)", [item("ladder", "pro_ladder", ID), item("pin", "pin_free", mf, (0, 0, 28))], labs))
    c_fric.append(variant(k, f"Step {k} ({fmt_d(STEPS_MM[k - 1])} mm)", [item("ladder", "pro_ladder", ID), item("pin", "pin_friction", mr, (0, 0, 30))], labs))
print("Pose check: free pin in round row")
print("  overlap by step (mm3):", " ".join(f"{v:.2f}" for v in cf_ov))
print("Pose check: friction pin in round row (fins crush on purpose)")
print("  overlap by step (mm3):", " ".join(f"{v:.2f}" for v in cr_ov))
if cf_ov[1] > 0.5:
    problems.append(f"free pin overlaps at the designed step: {cf_ov[1]:.2f} mm3")
if not (cr_ov[0] >= cr_ov[7]):
    problems.append(f"friction pin overlap does not shrink with step: {cr_ov}")
SCENES["pro_c_free"] = {"title": "Free pin in round row", "explodable": True, "cam": "iso", "explode": 0.0, "variants": c_free, "default": "2"}
SCENES["pro_c_fric"] = {"title": "Friction pin in round row", "explodable": True, "cam": "iso", "explode": 0.0, "variants": c_fric, "default": "2"}

# --- D: cube cells, face plate
print("Pose check: cube cells")
pin_side = tr(-TU / 2, 0, TU / 2) @ ry(90) @ PR                    # axis along +x through both cubes, fins mid-cube
pin_top = PR
cubeB_side = tr(TU, 0, 0)
cubeB_top = tr(0, 0, TU)
seated("friction pin through cube A (side to side)", MAN["pin_friction"], pin_side, "cube", ID, 150)
seated("friction pin through cube B (side to side)", MAN["pin_friction"], pin_side, "cube", cubeB_side, 150)
seated("friction pin through cube A (top to bottom)", MAN["pin_friction"], pin_top, "cube", ID, 150)
seated("friction pin through cube B (top to bottom)", MAN["pin_friction"], pin_top, "cube", cubeB_top, 150)
# Where do the pin's fins bite? Sweep the pin along its axis in one cube (vertical hole) and compare with a Pro-ladder hole.
sweep = {s: overlap(MAN["cube"], MAN["pin_friction"], ID, tr(0, 0, s) @ PR) for s in range(-8, 9, 2)}
best_s = max(sweep, key=sweep.get)
ladder_bite = overlap(MAN["pro_ladder"], MAN["pin_friction"], ID, tr(hole_x(2), ROW_FREE, 0.0) @ PR)
CUBE_PIN = {"full_insertion_mm3": round(sweep[0], 2), "best_offset_mm": best_s, "best_offset_mm3": round(sweep[best_s], 2), "ladder_mm3": round(ladder_bite, 2)}
print(f"  fin bite in a cube: {CUBE_PIN['full_insertion_mm3']} mm3 at full insertion (fins mid-cube), up to {CUBE_PIN['best_offset_mm3']} mm3 when pushed {best_s:+d} mm off-centre; "
      f"a Pro-ladder hole gives {CUBE_PIN['ladder_mm3']} mm3")
check_pose("cube A / friction pin (side to side)", MAN["cube"], MAN["pin_friction"], ID, pin_side, 0.12)
check_pose("cube B / friction pin (side to side)", MAN["cube"], MAN["pin_friction"], cubeB_side, pin_side, 0.12)
check_pose("cube A / friction pin (top to bottom)", MAN["cube"], MAN["pin_friction"], ID, pin_top, 0.12)
check_pose("cube B / friction pin (top to bottom)", MAN["cube"], MAN["pin_friction"], cubeB_top, pin_top, 0.12)
check_pose("cube A / cube B (side to side)", MAN["cube"], MAN["cube"], ID, cubeB_side, 0.005)
check_pose("cube A / cube B (top to bottom)", MAN["cube"], MAN["cube"], ID, cubeB_top, 0.005)
SCENES["cube_side"] = {"title": "Side to side", "explodable": True, "cam": "iso", "explode": 0.0, "variants": [variant("x", "Cubes joined side to side", [
    item("cubeA", "cube", ID, (-26, 0, 0)), item("cubeB", "cube", cubeB_side, (26, 0, 0)), item("pin", "pin_friction", pin_side, (0, 0, 0))])]}
SCENES["cube_top"] = {"title": "Top to bottom", "explodable": True, "cam": "iso", "explode": 0.0, "variants": [variant("z", "Cubes joined top to bottom", [
    item("cubeA", "cube", ID, (0, 0, -26)), item("cubeB", "cube", cubeB_top, (0, 0, 26)), item("pin", "pin_friction", pin_top, (0, 0, 0))])]}
plate_pose = tr(0, 0, TU + 2.0) @ rx(180)                            # plug points down into the open top hole
check_pose("face plate in open hole", MAN["cube"], MAN["face_plate"], ID, plate_pose, 0.20)
seated("face plate plug in cube", MAN["face_plate"], plate_pose, "cube", ID, 100)
SCENES["cube_plate"] = {"title": "Face plate", "explodable": True, "cam": "iso", "explode": 0.0, "variants": [variant("p", "Face plate in an open hole", [
    item("cube", "cube", ID), item("plate", "face_plate", plate_pose, (0, 0, 22))])]}

# --- E: skin sockets on the mount studs (skin prints smooth show-face-down, so rx(180) flips sockets down onto studs); hinge flap folds down beside the mount
print("Pose check: flex skin on mount")
SKIN_H = float(RAW["flex_skin"].bounds[1][2] - RAW["flex_skin"].bounds[0][2])
skin_pose = tr(-TU, 0, PLATE_H + SKIN_H) @ rx(180)
mount_pose = tr(-FP_MOUNT_X, 0, 0)
check_pose("flex skin sockets on mount studs", MAN["flex_skin"], MAN["fp_mount"], skin_pose, mount_pose, 0.05)
seated("mount studs inside flex skin", MAN["fp_mount"], mount_pose, "flex_skin", skin_pose, 250)
# hinge web: the 0.6 mm corridor nearest the mount edge (skin print frame: z = 0..0.6 mm), found by ray casting the actual STL
skin = RAW["flex_skin"]
xs = np.arange(-9.0, -4.0, 0.02)
hits = []
for x in xs:
    loc, _, _ = skin.ray.intersects_location(np.array([[x, 0.0, -1.0]]), np.array([[0.0, 0.0, 1.0]]), multiple_hits=True)
    hits.append(float(np.max(loc[:, 2])) if len(loc) else 0.0)
web = [float(x) for x, z in zip(xs, hits) if abs(z - 0.6) < 0.02]
hinge = [round(min(web), 3), round(max(web), 3)] if web else None
print(f"  hinge web (0.6 mm) spans skin x = {hinge}; flap is everything left of it")
if not hinge or abs((hinge[0] + hinge[1]) / 2 - (-TU / 2)) > 0.4:
    problems.append(f"hinge web not where expected: {hinge}")
# cut the skin through the middle of the hinge web so the flap can swing as one rigid piece (the cut crosses the 0.6 mm web only)
hinge_c = (hinge[0] + hinge[1]) / 2
web_area = (MAN["flex_skin"] ^ slab(hinge_c - 0.005, hinge_c + 0.005)).volume() / 0.01
web_expect = 0.6 * (2 * TU - 0.2)
print(f"  skin cut at x={hinge_c:.3f}: cross-section {web_area:.1f} mm2 (the 0.6 mm web across the skin is about {web_expect:.1f})")
if not 0.7 * web_expect <= web_area <= 1.3 * web_expect:
    problems.append(f"skin cut is not through the hinge web only ({web_area:.1f} mm2)")
MAN["flex_skin_a"] = MAN["flex_skin"] ^ slab(hinge_c, 500.0)
MAN["flex_skin_b"] = MAN["flex_skin"] ^ slab(-500.0, hinge_c)
for k, nm in (("flex_skin_a", "Flex skin coupon"), ("flex_skin_b", "Flex skin flap")):
    MESH[k] = to_trimesh(MAN[k])
    PART_META[k] = (nm, "soft")
    if len(MESH[k].split(only_watertight=False)) != 1:
        problems.append(f"{k} is not one body")
if abs(MAN["flex_skin_a"].volume() + MAN["flex_skin_b"].volume() - MAN["flex_skin"].volume()) > 1e-3 * MAN["flex_skin"].volume():
    problems.append("skin halves do not add up")
SCENES["flex"] = {"title": "Flex skin on mount", "explodable": True, "cam": "iso", "explode": 0.0, "variants": [variant("f", "Skin pressed on the mount", [
    item("mount", "fp_mount", mount_pose),
    item("skin", "flex_skin_a", skin_pose, (0, 0, 24)),
    item("flap", "flex_skin_b", skin_pose, (0, 0, 24), fold={"pivot": [round(hinge_c, 4), 0.3], "dir": 1}, nocap=True),
])]}


# --- overview: illustrative bed layout (print orientation, as the STLs load); not the slicer's arrangement
def group_box(pids):
    lo = np.min([MESH[p].bounds[0] for p in pids], axis=0)
    hi = np.max([MESH[p].bounds[1] for p in pids], axis=0)
    return lo, hi


# (group id, parts, badge letter, step to open on click ('C:fric' also picks the sub-view), name)
GROUPS = [
    ("fp", ["fp_mount", "fp_strip", "fp_brick"], "1", "dots", "Forge Mount First-Print"),
    ("pro", ["pro_ladder"], "B", "B", "Pro ladder"),
    ("snap", ["snap_ladder"], "A", "A", "Snap ladder"),
    ("skin", ["flex_skin"], "E", "E", "Flex skin"),
    ("tester", ["stud_tester"], "A", "A", "Stud tester"),
    ("shaft", ["shaft"], "B", "B", "Shaft"),
    ("free", ["pin_free"], "C", "C:free", "Free pin"),
    ("fric", ["pin_friction"], "C", "C:fric", "Friction pin"),
    ("cubeA", ["cube"], "D", "D:side", "Cube cell"),
    ("cubeB", ["cube"], "D", "D:side", "Cube cell"),
    ("plateA", ["face_plate"], "D", "D:plate", "Face plate"),
    ("plateB", ["face_plate"], "D", "D:plate", "Face plate"),
]
BED, MARGIN, SPACE = 220.0, 8.0, 7.0
ov_items, ov_labels, rows = [], [], []
x_cur, y_cur, row_h = -BED / 2 + MARGIN, BED / 2 - MARGIN, 0.0
for gid, pids, badge, go, name in GROUPS:
    lo, hi = group_box(pids)
    w, d = hi[0] - lo[0], hi[1] - lo[1]
    if x_cur + w > BED / 2 - MARGIN:
        x_cur, y_cur, row_h = -BED / 2 + MARGIN, y_cur - row_h - SPACE, 0.0
    ox, oy = x_cur - lo[0], y_cur - d - lo[1]
    for pid in pids:
        ov_items.append(item(f"{gid}:{pid}", pid, tr(ox, oy, 0)))
    big = max(w, d) >= 30                                           # tiny pieces get the letter only, the full name is the tooltip
    ov_labels.append(lab(badge, f"{gid}:{pids[0]}", ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2] + 1.0), go=go, cls="badge", title=name, **({"sub": name} if big else {})))
    x_cur += w + SPACE
    row_h = max(row_h, d)
if y_cur - row_h < -BED / 2:
    problems.append("overview layout does not fit the bed")
SCENES["overview"] = {"title": "Your plate", "explodable": False, "cam": "top", "bed": [BED, BED], "variants": [variant("plate", "Pieces as printed", ov_items, ov_labels)]}


# ------------------------------------------------------------------ what the slicer config says (from the gcode that was printed)
def gcode_meta():
    g = next(iter(sorted(CAL.glob("*.gcode"))), None)
    if g is None:
        return None
    with open(g, "rb") as f:
        head = f.read(400).decode("utf8", "replace")
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 140000))
        tail = f.read().decode("utf8", "replace")
    cfg = dict(re.findall(r"^; ([a-z_0-9]+) = (.*)$", tail, flags=re.M))
    gen = re.search(r"generated by (.+?) on", head)
    keys = ["printer_model", "printer_settings_id", "filament_settings_id", "filament_type", "nozzle_diameter", "layer_height", "wall_loops",
            "sparse_infill_density", "xy_contour_compensation", "xy_hole_compensation", "enable_support", "brim_type", "brim_width",
            "elefant_foot_compensation", "nozzle_temperature"]
    meta = {k: cfg.get(k, "").strip('"') for k in keys}
    meta["slicer"] = gen.group(1) if gen else ""
    meta["file"] = g.name
    meta["supports_by_object"] = gcode_supports(g)
    return meta


def gcode_supports(g):
    """Support and interface extrusion moves per printed object (OrcaSlicer labels each object in the gcode)."""
    obj, typ, out = None, None, {}
    with open(g, "r", errors="replace") as f:
        for ln in f:
            if ln.startswith("; printing object "):
                obj = re.sub(r"^toyventor_|\.stl$", "", ln.split()[3])
            elif ln.startswith("; stop printing object"):
                obj = None
            elif ln.startswith(";TYPE:"):
                typ = ln[6:].strip()
            elif obj and typ in ("Support", "Support interface") and ln.startswith("G1") and " E" in ln and " E-" not in ln and (" X" in ln or " Y" in ln):
                out[obj] = out.get(obj, 0) + 1
    return out


PRINT_META = gcode_meta()

# ------------------------------------------------------------------ write
kit = json.loads((CAL / "calibration_kit.json").read_text())
assets = {
    "parts": {pid: {"name": PART_META[pid][0], "tone": PART_META[pid][1], "bbox": bbox(pid), "stl": stl_b64(MESH[pid])} for pid in MAN},
    "scenes": SCENES,
    "kit": {"steps_mm": kit["steps_mm"], "sockets": kit["first_print_selector"]["sockets"], "window": kit["first_print_selector"]["combined_window_mm"]},
    "print_meta": PRINT_META,
    "notes": {"cube_pin": CUBE_PIN},
}
OUT.write_text(json.dumps(assets, separators=(",", ":")))
print(f"\nwrote {OUT.relative_to(PARTSPEC.parent.parent)}  ({OUT.stat().st_size / 1e6:.2f} MB, {len(assets['parts'])} parts, {len(SCENES)} scenes)")
if PRINT_META:
    print("gcode:", {k: v for k, v in PRINT_META.items() if v})
if problems:
    print("\nPROBLEMS:")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("all pose and split checks passed")
