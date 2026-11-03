#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Slice every print STL with the real OrcaSlicer CLI and Dan's own printer profile, and count what it would extrude where.

Why it exists: the PartSpec pre-print check is geometry only (no slicer was found when it ran), and its ledge rule accepts a flat roof that is held on
both sides. OrcaSlicer with supports ON (auto, 30 degrees, Dan's profile) disagrees for some parts, and only a real slice shows it. Found 2026-11-03
on the giant wheel: 3400 support moves under 20 tread-groove roofs that the geometry gate had passed.

    python3 scripts/orca-sweep.py                                  # every root print STL in parts/partspec -> parts/partspec/validation/orca-sweep.csv
    python3 scripts/orca-sweep.py --stl-dir DIR --out FILE.csv     # another folder / output
    python3 scripts/orca-sweep.py --only kit_wheel_giant kit_keel  # just the names that contain one of these words
    python3 scripts/orca-sweep.py --jobs 3

Needs: OrcaSlicer.app (set ORCA_SLICER_BIN to use another binary) and Dan's saved Orca user presets (machine and process under
~/Library/Application Support/OrcaSlicer/user/default, filament from the app's system Creality presets). It flattens them into a scratch folder
(the CLI wants a "type" key and no unresolved "inherits") and never writes to Orca's own folders. A supports-on profile is the point: the CSV says
which parts WOULD get supports. The Kip print path forces supports off per object for parts the CAD gate calls support-free, so a part listed here is a
part to look at (or print once), not proof that it fails.
"""
import argparse
import collections
import concurrent.futures as cf
import csv
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORCA = os.environ.get("ORCA_SLICER_BIN", "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer")
RES = Path(ORCA).resolve().parents[1] / "Resources" / "profiles" / "Creality"
USER = Path.home() / "Library/Application Support/OrcaSlicer/user/default"
MACHINE = "Creality Ender-3 Pro 0.4 nozzle - MAx.json"
PROCESS = "0.20mm Standard @Creality Ender3 Pro 0.4 - Copy.json"
FILAMENT = "Creality Generic PLA.json"


def flatten(out: Path):
    """Resolve each preset's `inherits` chain through the app's system presets and add the `type` key the CLI requires (machine keeps its `inherits`)."""
    idx = {}
    for kind in ("machine", "process", "filament"):
        for f in glob.glob(str(RES / kind / "*.json")):
            try:
                d = json.load(open(f))
            except Exception:
                continue
            if "name" in d:
                idx[(kind, d["name"])] = d

    def resolve(kind, d):
        chain = [d]
        while chain[-1].get("inherits"):
            parent = idx.get((kind, chain[-1]["inherits"]))
            if parent is None:
                sys.exit(f"missing parent preset {kind}: {chain[-1]['inherits']}")
            chain.append(parent)
        flat = {}
        for c in reversed(chain):
            flat.update(c)
        flat["type"] = kind
        flat["from"] = "User"
        if kind != "machine":
            flat.pop("inherits", None)
        return flat

    out.mkdir(parents=True, exist_ok=True)
    m = resolve("machine", json.load(open(USER / "machine" / MACHINE)))
    p = resolve("process", json.load(open(USER / "process" / PROCESS)))
    f = resolve("filament", json.load(open(RES / "filament" / FILAMENT)))
    for name, d in (("machine", m), ("process", p), ("filament", f)):
        json.dump(d, open(out / f"{name}.json", "w"), indent=1)
    return {"machine": m["name"], "process": p["name"], "supports": p.get("enable_support"), "support_type": p.get("support_type"),
            "threshold": p.get("support_threshold_angle"), "layer": p.get("layer_height"), "filament": f["name"]}


def analyse(gcode: str):
    moves = collections.Counter()
    cur = None
    time = grams = None
    for line in open(gcode, errors="ignore"):
        if line.startswith(";TYPE:"):
            cur = line[6:].strip()
        elif cur and line.startswith("G1 ") and " E" in line and " X" in line:
            e = re.search(r" E(-?[\d.]+)", line)
            if e and float(e.group(1)) > 0:
                moves[cur] += 1
        m = re.match(r"; estimated printing time \(normal mode\) = (.*)", line)
        if m:
            time = m.group(1).strip()
        m = re.match(r"; total filament used \[g\] = ([\d.]+)", line)
        if m:
            grams = float(m.group(1))
    return {"support_moves": moves.get("Support", 0) + moves.get("Support interface", 0), "overhang_wall_moves": moves.get("Overhang wall", 0),
            "bridge_moves": moves.get("Bridge", 0), "time": time, "grams": grams}


def slice_one(args):
    stl, work, prof = args
    d = Path(work) / stl.stem
    d.mkdir(parents=True, exist_ok=True)
    try:
        r = subprocess.run([ORCA, "--slice", "0", "--arrange", "1", "--outputdir", str(d), "--load-settings", f"{prof}/machine.json;{prof}/process.json",
                            "--load-filaments", f"{prof}/filament.json", str(stl)], capture_output=True, timeout=900)
        gc = d / "plate_1.gcode"
        if r.returncode != 0 or not gc.exists():
            return stl.stem, {"error": f"exit {r.returncode}"}
        res = analyse(str(gc))
        gc.unlink()
        return stl.stem, res
    except Exception as e:  # a hung or crashed slice must not stop the sweep
        return stl.stem, {"error": str(e)[:80]}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stl-dir", default=str(ROOT / "parts" / "partspec"))
    ap.add_argument("--out", default=str(ROOT / "parts" / "partspec" / "validation" / "orca-sweep.csv"))
    ap.add_argument("--only", nargs="*", default=[])
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    if not os.path.exists(ORCA):
        sys.exit(f"OrcaSlicer not found at {ORCA} (set ORCA_SLICER_BIN)")
    stls = sorted(Path(a.stl_dir).glob("toyventor_*_[PSL].stl"))
    if a.only:
        stls = [s for s in stls if any(w in s.stem for w in a.only)]
    with tempfile.TemporaryDirectory(prefix="orca-sweep-") as work:
        prof = Path(work) / "profile"
        info = flatten(prof)
        print(f"profile: {info}")
        print(f"slicing {len(stls)} STLs with {a.jobs} workers ...")
        # the STLs are copied first: another session may regenerate the folder while this runs
        snap = Path(work) / "stl"
        snap.mkdir()
        copies = []
        for s in stls:
            c = snap / s.name
            c.write_bytes(s.read_bytes())
            copies.append(c)
        rows = {}
        with cf.ThreadPoolExecutor(a.jobs) as ex:
            for name, res in ex.map(slice_one, [(c, work, str(prof)) for c in copies]):
                rows[name] = res
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["part", "support_moves", "overhang_wall_moves", "bridge_moves", "time", "grams", "error"])
        for name in sorted(rows):
            r = rows[name]
            w.writerow([name.replace("toyventor_", ""), r.get("support_moves", ""), r.get("overhang_wall_moves", ""), r.get("bridge_moves", ""), r.get("time", ""), r.get("grams", ""), r.get("error", "")])
    ok = [r for r in rows.values() if "error" not in r]
    sup = sum(1 for r in ok if r["support_moves"] > 0)
    print(f"{len(ok)} sliced, {len(rows) - len(ok)} errors; {sup} would get supports; wrote {out}")
    return 1 if len(rows) - len(ok) else 0


if __name__ == "__main__":
    raise SystemExit(main())
