#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check the Describe & build recipe fixtures (viewer/kip-describe-recipes.json) against the real PartSpec data.

For every recipe it runs three independent checks:
  1. structure  : unique step ids, hosts come first, parts are on the curated list, connectors exist, mate fields fit the connector kind
  2. fit matrix : every mate is a (male, female) pair in parts/partspec/fit_matrix.json that is as designed and inside its window
                  (this is the rule the viewer applies client-side, so the page can never show an impossible build)
  3. validator  : the recipe is turned into placements with toyventor_assembly.attach / place_on_axis and run through
                  toyventor_assembly.validate (collisions, floating parts, size classes). Zero errors is required.
The reference poses the validator produces are stored in each recipe's `reference` block, so the page's own pose maths can be tested against them.

    parts/partspec/.venv/bin/python parts/kip/viewer/tools/check_recipes.py            # check; exit 1 on any problem or on pose drift
    parts/partspec/.venv/bin/python parts/kip/viewer/tools/check_recipes.py --write    # also refresh the reference poses in the fixture file
    parts/partspec/.venv/bin/python parts/kip/viewer/tools/check_recipes.py --fixtures PATH   # check another file (used to prove the check can fail)

Read-only with respect to parts/partspec: nothing is written there, and no bytecode is cached.
"""
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
PS = ROOT / "parts" / "partspec"
FIXTURES = ROOT / "parts" / "kip" / "viewer" / "kip-describe-recipes.json"
DESCRIBE_STLS = ROOT / "public" / "kip" / "partspec" / "describe"   # assembly-frame STLs written by tools/export_describe_stls.py

STACK_KINDS = {"stud_grid", "socket_grid"}
AXIS_KINDS = {"pin", "bore_grid"}
ANCHORS = ("start", "center", "end")


def span(conn):
    """Length along the axis that a pin occupies, or the depth of a bore or hub."""
    return float(conn["length_mm"] if conn["kind"] == "pin" else conn["depth_mm"])


def resolve_along(lib, host_part, host_conn, part, conn, along):
    """`along` as the signed mm offset of the child connector origin from the host connector origin (place_on_axis semantics)."""
    if isinstance(along, (int, float)):
        return float(along)
    along = along or "center"
    h, c = span(lib.conn(host_part, host_conn)), span(lib.conn(part, conn))
    return {"start": 0.0, "center": (h - c) / 2, "end": h - c}[along]


def structure_errors(recipe, allowed, lib):
    errs, seen = [], {}
    for n, s in enumerate(recipe["steps"]):
        sid, part, mate = s["id"], s["part"], s.get("mate")
        where = f"step {n} ({sid})"
        if sid in seen:
            errs.append(f"{where}: duplicate id")
        if part not in allowed:
            errs.append(f"{where}: {part} is not on the curated list")
        if part not in lib.parts:
            errs.append(f"{where}: {part} is not a catalog part")
            seen[sid] = part
            continue
        if (n == 0) != (mate is None):
            errs.append(f"{where}: only the first step has no mate" if n else f"{where}: the first step cannot have a mate")
        if mate:
            if mate.get("host") not in seen:
                errs.append(f"{where}: host {mate.get('host')!r} must be an earlier step")
            else:
                try:
                    cc, hc = lib.conn(part, mate["conn"]), lib.conn(seen[mate["host"]], mate["hostConn"])
                except KeyError as e:
                    errs.append(f"{where}: {e}")
                else:
                    stack = cc["kind"] in STACK_KINDS
                    if stack != (hc["kind"] in STACK_KINDS):
                        errs.append(f"{where}: {cc['kind']} cannot mate with {hc['kind']}")
                    extra = set(mate) - {"conn", "host", "hostConn"} - ({"cell", "hostCell", "rot"} if stack else {"along", "hostCell"})
                    if extra:
                        errs.append(f"{where}: field(s) {sorted(extra)} do not apply to a {cc['kind']} mate")
                    a = mate.get("along")
                    if a is not None and not isinstance(a, (int, float)) and a not in ANCHORS:
                        errs.append(f"{where}: along must be a number or one of {ANCHORS}")
        seen[sid] = part
    return errs


def matrix_errors(recipe, lib, index):
    errs, host = [], {s["id"]: s["part"] for s in recipe["steps"]}
    for s in recipe["steps"]:
        m = s.get("mate")
        if not m:
            continue
        a, b = (s["part"], m["conn"]), (host[m["host"]], m["hostConn"])
        male, female = (a, b) if lib.conn(*a)["gender"] == "M" else (b, a)
        key = (f"{male[0]}.{male[1]}", f"{female[0]}.{female[1]}")
        p = index.get(key)
        if p is None:
            errs.append(f"{s['id']}: no fit-matrix pair for {key[0]} <-> {key[1]}")
        elif not (p["as_designed"] and p["in_window"]):
            errs.append(f"{s['id']}: pair {key[0]} <-> {key[1]} is outside its fit window")
    return errs


def to_build(recipe, ta, lib):
    """Recipe -> toyventor_assembly placements (the same calls the hand-written valid_* cases make)."""
    items = {}
    out = []
    for s in recipe["steps"]:
        m = s.get("mate")
        if m is None:
            it = ta.place(s["part"], pid=s["id"])
        else:
            host = items[m["host"]]
            hcell = tuple(m.get("hostCell", (0, 0)))
            if lib.conn(s["part"], m["conn"])["kind"] in STACK_KINDS:
                it = ta.attach(lib, host, m["hostConn"], s["part"], m["conn"], hcell, tuple(m.get("cell", (0, 0))), rot=m.get("rot", 0), pid=s["id"])
            else:
                along = resolve_along(lib, host["part"], m["hostConn"], s["part"], m["conn"], m.get("along"))
                it = ta.place_on_axis(lib, host, m["hostConn"], s["part"], m["conn"], along=along, pid=s["id"], parent_cell=hcell)
        items[s["id"]] = it
        out.append(it)
    return out


def poses(build):
    out = {}
    for it in build:
        p = it["pose"]
        d = {"x": round(p["x"], 3), "y": round(p["y"], 3), "z": round(p["z"], 3), "rot": p["rot"]}
        if p.get("tilt"):
            d["tilt"] = [round(v, 3) for v in p["tilt"]]
        out[it["id"]] = d
    return out


def boxes(build, ta, lib):
    """World bounding box [minx, miny, minz, maxx, maxy, maxz] of every placed part, from the validator's own placed geometry. The viewer's pose maths
    is tested against these (tools/check_explode.mjs): all rotations are quarter turns, so a box carried through the pose equals the mesh's box."""
    return {it["id"]: [round(v, 3) for v in ta.placed_geometry(lib, it).bounding_box()] for it in build}


def main():
    global FIXTURES
    write = "--write" in sys.argv[1:]
    if "--fixtures" in sys.argv:
        FIXTURES = Path(sys.argv[sys.argv.index("--fixtures") + 1]).resolve()
    sys.path.insert(0, str(PS))
    os.chdir(PS)
    import toyventor_assembly as ta

    lib = ta.Library("toyventor_parts.json")
    fm = json.loads((PS / "fit_matrix.json").read_text())
    index = {(p["male"], p["female"]): p for p in fm["pairs"]}
    doc = json.loads(FIXTURES.read_text())
    allowed = {a["id"] for a in doc["allowedParts"]}
    problems = 0
    if len(doc["allowedParts"]) != 30:
        print(f"FAIL curated list has {len(doc['allowedParts'])} parts, expected 30")
        problems += 1
    missing_stl = sorted(p for p in allowed if not (DESCRIBE_STLS / f"{p}.stl").exists())
    print("curated parts without a viewer STL (public/kip/partspec/describe/<id>.stl, run export_describe_stls.py):", ", ".join(missing_stl) or "none")
    problems += bool(missing_stl)
    used = set()
    for r in doc["recipes"]:
        used |= {s["part"] for s in r["steps"]}
        errs = structure_errors(r, allowed, lib)
        errs += matrix_errors(r, lib, index) if not errs else []
        v = None
        if not errs:
            build = to_build(r, ta, lib)
            v = ta.validate(lib, build)
            errs += [f"validator {e['code']}: {e['detail']}" for e in v["errors"]]
            fresh, fresh_boxes = poses(build), boxes(build, ta, lib)
            if write:
                r["reference"] = {"poses": fresh, "boxes": fresh_boxes, "validator": {"ok": v["ok"], "errors": len(v["errors"]), "warnings": len(v["warnings"]), "edges": len(v["edges"])}}
            elif r.get("reference", {}).get("poses") != fresh or r.get("reference", {}).get("boxes") != fresh_boxes:
                errs.append("reference poses or boxes are missing or differ from the validator's (run with --write after checking why)")
        status = "ok  " if not errs else "FAIL"
        extra = f"{len(r['steps'])} steps, {v['edges'].__len__()} edges, {len(v['warnings'])} warning(s)" if v else ""
        print(f"{status} {r['id']:22s} {extra}")
        for e in errs:
            print("       -", e)
        problems += bool(errs)
    unused = sorted(allowed - used)
    if unused:
        print("curated parts no recipe uses:", ", ".join(unused))
    if write and not problems:
        FIXTURES.write_text(json.dumps(doc, indent=2) + "\n")
        print(f"wrote reference poses to {FIXTURES}")
    print("RESULT", "all recipes valid" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
