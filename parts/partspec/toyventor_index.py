#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Impact index for ToyVentor parts.

Answers "what depends on this?" from the manifest, so changing one interface number
tells you exactly which parts to regenerate and re-check.

  python3 toyventor_index.py out list
  python3 toyventor_index.py out used-by stud_large
  python3 toyventor_index.py out uses waddle_tail
  python3 toyventor_index.py out impact stud_large
  python3 toyventor_index.py out checks S1_small_part_screen
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
IF = json.loads((HERE / "interfaces.json").read_text())


_PIN_BORE_RULES = json.loads((Path(__file__).parent / "interfaces.json").read_text())["pin_bore"]["rules"]


def complementary(ca, cb):
    """Can these two connectors mate? Same rule the build validator uses."""
    kinds = {ca["kind"], cb["kind"]}
    if ca["gender"] == cb["gender"]:
        return False
    if kinds == {"stud_grid", "socket_grid"}:
        return ca["size_class"] == cb["size_class"]
    if kinds == {"pin", "bore_grid"}:
        pin, bore = (ca, cb) if ca["kind"] == "pin" else (cb, ca)
        return ca["size_class"] == cb["size_class"] and any(r["pin"] == pin["interface"] and r["bore"] == bore.get("bore_class") for r in _PIN_BORE_RULES)
    return False


def build_index(manifest):
    parts = {p["id"]: p for p in manifest["parts"] if p.get("file")}
    interfaces, part_idx = {}, {}
    for pid, p in parts.items():
        part_idx[pid] = {"interfaces": sorted({c["interface"] for c in p["connectors"]}),
                         "design_status": p.get("design_status", "unknown"), "size_class": p["size_class"], "line": p["line"]}
        for c in p["connectors"]:
            e = interfaces.setdefault(c["interface"], {"uses": {}, "mates": []})
            e["uses"].setdefault(pid, []).append(c["id"])
    # mating pairs (male -> female), grouped under the interface both sides share
    for a in parts.values():
        for ca in a["connectors"]:
            if ca["gender"] != "M":
                continue
            for b in parts.values():
                for cb in b["connectors"]:
                    if complementary(ca, cb):
                        iface = ca["interface"]
                        interfaces[iface]["mates"].append({"male": f"{a['id']}.{ca['id']}", "female": f"{b['id']}.{cb['id']}"})
    checks = {}
    for pid, p in parts.items():
        for c in p["checks"]:
            if c["result"] in ("fail", "pending"):
                checks.setdefault(c["id"], {"level": c["level"], "parts": {}})["parts"][pid] = c["result"]
    return {"interfaces": interfaces, "parts": part_idx, "checks": checks}


def write(out, manifest):
    idx = build_index(manifest)
    (Path(out) / "toyventor_index.json").write_text(json.dumps(idx, indent=2))
    return idx


# --------------------------------------------------------------------------
def used_by(idx, iface):
    e = idx["interfaces"].get(iface)
    if not e:
        raise SystemExit(f"unknown interface '{iface}'. Known: {', '.join(sorted(idx['interfaces']))}")
    return e


def impact(idx, iface):
    e = used_by(idx, iface)
    users = sorted(e["uses"])
    unverified = [p for p in users if idx["parts"][p]["design_status"] != "verified"]
    pending = sorted({p for p in users for cid, info in idx["checks"].items() if info["parts"].get(p) == "pending"})
    return {
        "interface": iface,
        "parts_to_regenerate": users,
        "mating_pairs_to_recheck": e["mates"],
        "already_unverified": unverified,
        "stale_physical_results": pending,
        "rerun": [c for c in IF["checks"] if not IF["checks"][c].get("pending")],
        "note": "Physical checks (F1, F2) for these parts are invalidated by any change to the interface.",
    }


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    out, cmd = argv[1], argv[2]
    manifest = json.loads((Path(out) / "toyventor_parts.json").read_text())
    idx = build_index(manifest)
    arg = argv[3] if len(argv) > 3 else None
    if cmd == "list":
        for iface, e in sorted(idx["interfaces"].items()):
            print(f"{iface:22s} used by {len(e['uses']):2d} part(s), {len(e['mates']):2d} mating pair(s)")
    elif cmd == "used-by":
        e = used_by(idx, arg)
        for pid, conns in sorted(e["uses"].items()):
            print(f"{pid:22s} {idx['parts'][pid]['design_status']:20s} connectors: {', '.join(conns)}")
    elif cmd == "uses":
        if arg not in idx["parts"]:
            raise SystemExit(f"unknown part '{arg}'")
        print(json.dumps(idx["parts"][arg], indent=2))
    elif cmd == "impact":
        print(json.dumps(impact(idx, arg), indent=2))
    elif cmd == "checks":
        info = idx["checks"].get(arg)
        print(json.dumps(info, indent=2) if info else f"no part is failing or pending on {arg}")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
