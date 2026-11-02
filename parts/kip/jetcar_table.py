#!/usr/bin/env python3
"""Clearance table for the Jet Car Lab page (parts/kip/viewer/JetCar-Lab.html).

The balloon-jet truck is the Snap truck with the dump tub removed and `mom_jet_valve_body` snapped onto the keel's rear rows 8-9 (body centre
(0, 50.0, 12.5): its sockets land on the studs at y 43.75 and 56.25). A balloon is a sphere of diameter D on the vertical collar, leaning rearward by
an angle, on a neck of NECK mm. For each (D, lean) this records the clearance (mm, negative = the sphere reaches it) to:
  kip     the Kip driver (surface points of his meshes, posed by parts/kip/viewer/jetcar-kip-pose.json)
  w36/w50 the rear wheels, O36 (#4) or O50 (#5)
  jet     the jet stream, a line from the nozzle exit straight back along the truck axis at z 25
It also records the placement facts (overlaps and gaps of the jet body against the keel, wheels, windscreen and the rear axle gear).

Assumptions (estimates, not measurements): sphere balloon body, 25 mm neck, collar top at z 40.5, jet axis at z 25 (socket height 12.5 above the deck).

  /Users/dan/Code/toyforge/parts/partspec/.venv/bin/python3 parts/kip/jetcar_table.py        # from the repo root
  JETCAR_PS=/path/to/partspec .../python3 parts/kip/jetcar_table.py                          # against another copy of the CAD (the committed lab data should describe the committed CAD)

Writes parts/kip/viewer/jetcar-clearance.json (build:kip copies it to public/kip/). Read-only on everything else.
"""
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
PS = Path(os.environ.get("JETCAR_PS") or ROOT / "parts" / "partspec")      # JETCAR_PS: run against another copy of the CAD (e.g. an export of HEAD)
KIP = ROOT / "public" / "kip"
POSE = ROOT / "parts" / "kip" / "viewer" / "jetcar-kip-pose.json"
OUT = ROOT / "parts" / "kip" / "viewer" / "jetcar-clearance.json"

BODY_Y = 50.0                    # jet body centre on the keel (rows 8-9)
DECK_Z = 12.5
COLLAR_TOP = np.array([0.0, BODY_Y - 3.0, DECK_Z + 28.0])   # collar axis is 3 mm forward of the body centre; collar top is 28 mm up
NECK = 25.0                      # balloon neck length (estimate)
JET_Z = DECK_Z + 12.5            # nozzle socket axis height
D_VALUES = [100 + 12.5 * i for i in range(11)]               # 100 .. 225 mm
LEANS = list(range(0, 65, 5))                                # rearward lean, degrees


def stl(geo):
    cands = ([KIP / f"{geo}.stl"] if geo.startswith("stls/") else []) + [KIP / "partspec" / "mockup" / f"{geo}.stl"]
    for p in cands:
        if p.exists():
            return trimesh.load(p)
    raise FileNotFoundError(geo)


def surface_points(mesh, n):
    s, _ = trimesh.sample.sample_surface(mesh, n)
    return np.vstack([np.asarray(mesh.vertices), s])


def placed(mesh, M):
    m = mesh.copy()
    m.apply_transform(M)
    return m


def ry(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    M = np.eye(4)
    M[0, 0], M[0, 2], M[2, 0], M[2, 2] = c, s, -s, c
    return M


def translate(x, y, z):
    M = np.eye(4)
    M[:3, 3] = (x, y, z)
    return M


def main():
    np.random.seed(1)
    pose = json.loads(POSE.read_text())
    kip = []
    for r in pose["rows"]:
        M = np.array(r["m"]).reshape(4, 4).T          # three.js column-major
        kip.append(surface_points(placed(stl(r["geo"]), M), 2000))
    kip = np.vstack(kip)

    def wheels(pid):
        base = stl(pid)
        pts = [surface_points(placed(base, translate(sx, 43.75, 6.25) @ ry(deg)), 4000) for sx, deg in ((-26.7, -90), (26.7, 90))]
        return np.vstack(pts)

    w36, w50 = wheels("kit_wheel_med"), wheels("kit_wheel_giant")
    jet_y = np.linspace(BODY_Y + 14.4, BODY_Y + 62.0, 80)
    jet = np.c_[np.zeros_like(jet_y), jet_y, np.full_like(jet_y, JET_Z)]

    grid = []
    for D in D_VALUES:
        R = D / 2.0
        for lean in LEANS:
            ax = np.array([0.0, math.sin(math.radians(lean)), math.cos(math.radians(lean))])
            c = COLLAR_TOP + ax * (NECK + R)
            d = lambda P: float(np.linalg.norm(P - c, axis=1).min() - R)
            grid.append({"D": D, "lean": lean, "kip": round(d(kip), 1), "w36": round(d(w36), 1), "w50": round(d(w50), 1), "jet": round(d(jet), 1),
                         "cy": round(float(c[1]), 1), "cz": round(float(c[2]), 1)})

    # placement facts from the generator's own geometry (needs manifold3d via toyventor_kitcard)
    sys.path.insert(0, str(PS))
    os.chdir(PS)
    import toyventor_kitcard as kc

    sys.path.append(str(ROOT / "parts" / "partspec"))                            # verify_band_jet lives in the repo's partspec even when JETCAR_PS points elsewhere

    cache = {}
    g = lambda pid: kc._raw_geo(pid, cache)
    keel, vb = g("kit_keel_base"), g("mom_jet_valve_body")
    body = vb.translate((0, BODY_Y, DECK_Z))
    rnd = lambda v: round(float(v), 2)
    bb = np.array(body.bounding_box())
    facts = {
        "body_bbox": [rnd(v) for v in bb],
        "keel_overlap_mm3": rnd(max(0.0, (body ^ keel).volume())),
        "windscreen_gap_mm": rnd(body.min_gap(g("kit_windscreen").translate((0, -6.25, DECK_Z)), 40.0)),
    }
    gear = g("gear_spur_z10").rotate((0, 90, 0)).translate((-3.125, 43.75, 6.25))
    facts["axle_gear_overlap_mm3"] = rnd((body ^ gear).volume())
    for label, pid, sgn in (("w36", "kit_wheel_med", 90), ("w50", "kit_wheel_giant", 90)):
        wheel = g(pid).rotate((0, sgn, 0)).translate((26.7, 43.75, 6.25))
        facts[f"{label}_gap_mm"] = rnd(body.min_gap(wheel, 20.0))
    # narrowest sections of the air path, MEASURED on the solids by the same code the independent check uses (parts/partspec/verify_band_jet.py),
    # so the lab and the check cannot disagree and a regeneration tracks whatever the CAD now is
    import verify_band_jet as vbj

    ctx = vbj.Ctx(str(PS))
    inlet = vbj._enclosed_area(vb.slice(22.0), (0.0, -3.0))
    tunnel = vbj._enclosed_area(vb.rotate((90, 0, 0)).slice(4.5), (0.0, -12.5))
    port, port_estimated = vbj._valve_port_area(ctx)
    areas = {"inlet": inlet, "tunnel": tunnel, "valve_port": port}
    if any(v is None for v in areas.values()):
        raise SystemExit(f"could not measure the air path: {areas}")
    narrow = min(areas.values())
    facts["passage_mm2"] = {k: rnd(v) for k, v in areas.items()}
    facts["passage_valve_estimated"] = bool(port_estimated)
    facts["passage_equiv_d_mm"] = round(2 * math.sqrt(narrow / math.pi), 1)
    facts["mass_g_solid_pla"] = {pid: rnd(g(pid).volume() * 1.24e-3) for pid in ("kit_keel_base", "mom_jet_valve_body", "kit_wheel_med", "kit_wheel_giant", "kit_barbell_shaft")}

    doc = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "assumptions": {"balloon": "sphere on a neck", "neck_mm": NECK, "collar_top": [float(v) for v in COLLAR_TOP], "jet_axis_z": JET_Z, "body_y": BODY_Y},
        "kip_rear_y": round(float(kip[:, 1].max()), 1),
        "d_values": D_VALUES,
        "leans": LEANS,
        "facts": facts,
        "grid": grid,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", OUT, f"({OUT.stat().st_size} bytes)", "facts:", json.dumps(facts))


if __name__ == "__main__":
    sys.exit(main())
