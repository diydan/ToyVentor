#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Persistent worker that runs the REAL assembly validator for the Describe & build endpoint.

Protocol: one JSON object per line on stdin, one per line on stdout. First line out is {"event": "ready"} once the geometry of every curated part is
built and cached (a minute or two; later requests take seconds). A request is {"id": "...", "steps": [...]}; the answer is

    {"id": "...", "ok": true,  "poses": {step: {x, y, z, rot, tilt?}}, "warnings": [...]}
    {"id": "...", "ok": false, "errors": [{"code": "...", "detail": "...", "steps": [step ids named in the detail]}]}

Reuses check_recipes.py (structure, fit matrix, placement from mates) and toyventor_assembly.validate (mates, floating parts, exact collisions).
Run with the PartSpec virtual environment's python; nothing under parts/partspec is written.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_recipes as cr  # noqa: E402


def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    sys.path.insert(0, str(cr.PS))
    os.chdir(cr.PS)
    import toyventor_assembly as ta

    lib = ta.Library("toyventor_parts.json")
    index = {(p["male"], p["female"]): p for p in json.loads((cr.PS / "fit_matrix.json").read_text())["pairs"]}
    allowed = [a["id"] for a in json.loads(cr.FIXTURES.read_text())["allowedParts"]]
    for pid in allowed:                       # build and cache every curated geometry before the first request
        lib.geometry(pid)
    say({"event": "ready", "parts": len(allowed)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        rid, steps = req.get("id"), req.get("steps")
        recipe = {"id": rid, "steps": steps}
        ids = [s.get("id") for s in steps if isinstance(s, dict)]
        problems = cr.structure_errors(recipe, set(allowed), lib)
        if not problems:
            problems += cr.matrix_errors(recipe, lib, index)
        if problems:
            say({"id": rid, "ok": False, "errors": [{"code": "structure", "detail": p, "steps": []} for p in problems]})
            continue
        try:
            build = cr.to_build(recipe, ta, lib)
        except (ValueError, KeyError) as e:   # attach / place_on_axis refuse a mate they cannot seat
            say({"id": rid, "ok": False, "errors": [{"code": "cannot_place", "detail": str(e).strip("'\""), "steps": []}]})
            continue
        v = ta.validate(lib, build)
        if not v["ok"]:
            errs = []
            for e in v["errors"]:
                named = [i for i in ids if re.search(rf"\b{re.escape(str(i))}\b", e["detail"])]
                errs.append({"code": e["code"], "detail": e["detail"], "steps": named})
            say({"id": rid, "ok": False, "errors": errs})
        else:
            say({"id": rid, "ok": True, "poses": cr.poses(build), "warnings": [{"code": w["code"], "detail": w["detail"]} for w in v["warnings"]]})


if __name__ == "__main__":
    main()
