#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Write viewer/kip-describe-parts.json: the compact part and connector data the Describe & build validator needs in the browser.

The full fit matrix is 2.7 MB; for the 30 curated parts it reduces to a handful of connector groups (connectors whose partner sets are identical
form a group; a connector's partners are a union of whole groups, by symmetry). This file is GENERATED from parts/partspec/toyventor_parts.json,
parts/partspec/fit_matrix.json and the curated list in kip-describe-recipes.json. Do not edit it by hand.

    python3 parts/kip/viewer/tools/build_parts_data.py            # rewrite
    python3 parts/kip/viewer/tools/build_parts_data.py --check    # exit 1 if the file is stale (writes nothing)

Plain python3 is enough (JSON only); nothing under parts/partspec is written.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PS = ROOT / "parts" / "partspec"
VIEWER = ROOT / "parts" / "kip" / "viewer"
OUT = VIEWER / "kip-describe-parts.json"
KIND = {"stud_grid": "studs", "socket_grid": "sockets", "pin": "pin", "bore_grid": "bore"}


def build():
    allowed = json.loads((VIEWER / "kip-describe-recipes.json").read_text())["allowedParts"]
    manifest = {p["id"]: p for p in json.loads((PS / "toyventor_parts.json").read_text())["parts"]}
    pairs = json.loads((PS / "fit_matrix.json").read_text())["pairs"]
    ids = [a["id"] for a in allowed]
    parts = {}
    for a in allowed:
        conns = {}
        for c in manifest[a["id"]]["connectors"]:
            g = c.get("grid") or {}
            entry = {"kind": KIND[c["kind"]], "gender": c["gender"], "grid": [g.get("nx", 1), g.get("ny", 1)]}
            if g.get("omit_cells"):
                entry["omit"] = [list(o) for o in g["omit_cells"]]
            if c["kind"] == "pin":
                entry["span"] = c["length_mm"]
            elif c["kind"] == "bore_grid":
                entry["span"] = c["depth_mm"]
            if c["kind"] in ("pin", "bore_grid"):
                entry["axis"] = [round(v, 6) for v in c["frame"].get("normal", [0, 0, 1])]   # local axis direction; the viewer turns it by the part's pose
            conns[c["id"]] = entry
        parts[a["id"]] = {"label": a["label"], "category": a["category"], "connectors": conns}

    allowed_set = set(ids)
    mates = {}
    for p in pairs:
        if not (p["as_designed"] and p["in_window"]):
            continue
        if p["male"].split(".")[0] not in allowed_set or p["female"].split(".")[0] not in allowed_set:
            continue
        for x, y in ((p["male"], p["female"]), (p["female"], p["male"])):
            mates.setdefault(x, set()).add(y)
    group_of_key, groups = {}, []
    for conn in sorted(mates):
        key = "|".join(sorted(mates[conn]))
        if key not in group_of_key:
            group_of_key[key] = len(groups)
            groups.append({"members": [], "partners": sorted(mates[conn])})
        groups[group_of_key[key]]["members"].append(conn)
    gid = {m: f"G{i + 1}" for i, g in enumerate(groups) for m in g["members"]}
    out_groups = {f"G{i + 1}": {"members": g["members"], "mates": sorted({gid[p] for p in g["partners"]}, key=lambda s: int(s[1:]))} for i, g in enumerate(groups)}
    # every connector of every curated part must be in a group, or the validator would call a real connector unmatable
    ungrouped = [f"{pid}.{c}" for pid, p in parts.items() for c in p["connectors"] if f"{pid}.{c}" not in gid]
    return {
        "generatedBy": "tools/build_parts_data.py (do not edit by hand)",
        "contract": 1,
        "parts": parts,
        "groups": out_groups,
        "ungrouped": ungrouped,
    }


def main():
    text = json.dumps(build(), indent=1) + "\n"
    if "--check" in sys.argv[1:]:
        ok = OUT.exists() and OUT.read_text() == text
        print("kip-describe-parts.json is up to date" if ok else "kip-describe-parts.json is STALE or missing: run build_parts_data.py")
        return 0 if ok else 1
    OUT.write_text(text)
    d = json.loads(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(d['parts'])} parts, {len(d['groups'])} connector groups, {len(d['ungrouped'])} ungrouped connectors, {len(text)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
