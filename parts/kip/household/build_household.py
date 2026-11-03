"""Build the household library: every built item as an optimised game GLB, and the catalog that lists all 50.

    parts/partspec/.venv/bin/python3 parts/kip/household/build_household.py            # build everything into public/kip/household/
    parts/partspec/.venv/bin/python3 parts/kip/household/build_household.py --check    # rebuild in memory, compare with the files there, write nothing
    parts/partspec/.venv/bin/python3 parts/kip/household/build_household.py --only ball,mug --out /tmp/x    # a few items, elsewhere (no catalog)

Each item is built once as a whole 3D solid (household_builders.py), checked (`solid_problems`), and encoded (household_glb.py). The build fails, writing
nothing, if any built item breaks a rule: one connected solid, standing on z = 0 with its longest side the catalog's prop size, material at the grip
point, no zero-area triangle, within the triangle, byte and colour-zone budgets, every piece's zone coloured, no brand term.
The output is deterministic (no dates), so `--check` is a real drift test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from manifold3d import Manifold

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "parts/kip/sdk"))

import household_builders as hb  # noqa: E402
import household_catalog as hc  # noqa: E402
import household_pictures as hp  # noqa: E402
from household_glb import HEX_RE, zoned_glb  # noqa: E402
from kip_partspec_sdk import FORBIDDEN_BRAND_RE  # noqa: E402

DEFAULT_OUT = ROOT / "public/kip/household"
MAX_TRIS = 1000
MAX_BYTES = 25 * 1024
MAX_ZONES = 3
GRIP_FOOTPRINT_MM = 6.0  # about the real shaft's width (6.6 mm): its footprint, in the first GRIP_DEPTH_MM above the origin, must hold material
GRIP_DEPTH_MM = 2.0
GRIP_MIN_MM3 = 12.0  # a sixth of the 6 x 6 x 2 mm probe (72 mm3). The thinnest built item, the plate on its rim, has 19; most have 60 or more.


def solid_problems(solid: Manifold, prop_mm: int) -> List[str]:
    """What is wrong with a finished solid, in the library's frame. Empty when sound."""
    out: List[str] = []
    if solid.is_empty() or solid.volume() <= 0:
        return ["empty, or turned inside out"]
    pieces = solid.decompose()
    if len(pieces) != 1:
        out.append(f"{len(pieces)} separate pieces: a part floats free of the rest")
    x0, y0, z0, x1, y1, z1 = solid.bounding_box()
    if abs(z0) > 1e-6:
        out.append(f"lowest point is z = {z0:.4f}, not 0")
    longest = max(x1 - x0, y1 - y0, z1 - z0)
    if abs(longest - prop_mm) > 0.01:
        out.append(f"longest side is {longest:.3f} mm, not the prop size {prop_mm} mm")
    probe = Manifold.cube((GRIP_FOOTPRINT_MM, GRIP_FOOTPRINT_MM, GRIP_DEPTH_MM)).translate((-GRIP_FOOTPRINT_MM / 2, -GRIP_FOOTPRINT_MM / 2, 0.0))
    if (solid ^ probe).volume() < GRIP_MIN_MM3:  # in this manifold3d, ^ is intersection
        out.append(f"under {GRIP_MIN_MM3:g} mm3 of material in the shaft's footprint at the grip point (0, 0, 0): the shaft would miss the item")
    return out


def triangle_zones(solid: Manifold, zone_of_id: Dict[int, str]) -> Tuple[np.ndarray, np.ndarray, List[str], List[str]]:
    """(vertices mm, triangles, zone of each triangle, problems). A triangle from a piece nobody tagged is a problem."""
    mesh = solid.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float64)[:, :3].copy()
    faces = np.asarray(mesh.tri_verts, dtype=np.uint32).copy()
    runs = [int(x) // 3 for x in mesh.run_index]  # run_index counts vertices (3 per triangle)
    ids = [int(x) for x in mesh.run_original_id]
    zones: List[str] = [""] * len(faces)
    bad: List[str] = []
    for r, oid in enumerate(ids):
        zone = zone_of_id.get(oid)
        if zone is None:
            bad.append(f"triangles from an untagged piece (original id {oid})")
            zone = ""
        for t in range(runs[r], runs[r + 1]):
            zones[t] = zone
    return verts, faces, zones, bad


def build_item(row: dict) -> Tuple[dict, Optional[bytes], List[str]]:
    """Build one catalog row. Returns (the row with its build fields, GLB bytes or None, problems)."""
    iid = row["id"]
    builder = hb.BUILDERS.get(iid)
    if builder is None:
        return {**row, "built": False, "glb": None}, None, []
    problems: List[str] = []
    colours = hb.COLOURS.get(iid)
    if not colours:
        return {**row, "built": False, "glb": None}, None, [f"{iid}: no zone colours"]
    pieces = builder()
    piece_zones = [z for z, _ in pieces]
    if sorted(set(piece_zones)) != sorted(colours):
        problems.append(f"{iid}: zones built {sorted(set(piece_zones))} but coloured {sorted(colours)}")
    if len(colours) > MAX_ZONES:
        problems.append(f"{iid}: {len(colours)} colour zones, at most {MAX_ZONES}")
    for z, hexv in colours.items():
        if FORBIDDEN_BRAND_RE.search(z) or hc.AVOIDED_BRAND_RE.search(z):
            problems.append(f"{iid}: brand term in zone {z!r}")
        if not HEX_RE.match(hexv):
            problems.append(f"{iid}: colour {hexv!r} is not #RRGGBB")
    if FORBIDDEN_BRAND_RE.search(" ".join([iid, row["label"], row["note"], *row["words"]])):
        problems.append(f"{iid}: brand term (part SDK filter)")

    solid, zone_of_id = hb.assemble(pieces)
    solid = hb.fit_longest(solid, row["propMm"])
    problems += [f"{iid}: {p}" for p in solid_problems(solid, row["propMm"])]
    verts, faces, tri_zone, bad = triangle_zones(solid, zone_of_id)
    problems += [f"{iid}: {p}" for p in bad]
    if problems:
        return {**row, "built": False, "glb": None}, None, problems

    x0, y0, z0, x1, y1, z1 = solid.bounding_box()
    glb, info = zoned_glb(
        iid, verts, faces, tri_zone, list(colours.items()),
        extras={"household": {"id": iid, "gripMm": [0, 0, 0], "zones": list(colours), "front": "+y in the library frame (-z in this file)"}},
    )
    if info["zeroAreaTris"]:
        problems.append(f"{iid}: {info['zeroAreaTris']} triangle(s) with no area in the file (a sliver where two edges of a union touch)")
    if info["openEdges"]:
        problems.append(f"{iid}: {info['openEdges']} edge(s) that are open or pinched in the file (a hole, or two parts touching along a line)")
    if info["tris"] > MAX_TRIS:
        problems.append(f"{iid}: {info['tris']} triangles, at most {MAX_TRIS}")
    if len(glb) > MAX_BYTES:
        problems.append(f"{iid}: {len(glb)} bytes, at most {MAX_BYTES}")
    entry = {
        **row,
        "built": True,
        "glb": f"{iid}.glb",
        "bytes": len(glb),
        "sha256": hashlib.sha256(glb).hexdigest(),
        "tris": info["tris"],
        "verts": info["verts"],
        "zones": [{"name": z, "hex": h, "tris": info["zoneTris"][z]} for z, h in colours.items()],
        "bboxMm": [round(x1 - x0, 2), round(y1 - y0, 2), round(z1 - z0, 2)],
        "volumeMm3": round(solid.volume(), 1),
    }
    return entry, glb, problems


def build_pictures(rows: List[dict], colours: Dict[str, Dict[str, str]]) -> Tuple[dict, Dict[str, List[str]]]:
    """The pictures of every built item and the table of which look alike. Each colour zone is the union of its pieces, moved the way `fit_longest`
    moved the whole item, so the zones sit exactly where the finished solid does."""
    pictures: Dict[str, dict] = {}
    outlines = {}
    for row in rows:
        iid = row["id"]
        pieces = hb.BUILDERS[iid]()
        solid, _ = hb.assemble(pieces)
        k, lift = hb.fit_transform(solid, row["propMm"])
        zone_solids = []
        for zone, hex_ in colours[iid].items():
            parts = [p.scale((k, k, k)).translate((0.0, 0.0, lift)) for z, p in pieces if z == zone]
            zone_solids.append((zone, hb.union3d(parts), hex_))
        pictures[iid], outlines[iid] = hp.pictures_for(hb.fit_longest(solid, row["propMm"]), zone_solids)
    return pictures, hp.confusable_with(outlines)


def build_all(only: Optional[List[str]] = None) -> Tuple[dict, Dict[str, bytes], List[str], dict]:
    rows = hc.static_rows()
    support_rows = hc.support_rows()
    problems = hc.problems(rows) + hc.support_problems(support_rows)
    ids = {r["id"] for r in rows} | {r["id"] for r in support_rows}
    for o in only or []:
        if o not in ids:
            problems.append(f"--only: unknown item {o!r}")
    items, glbs = [], {}
    for row in rows:
        if only and row["id"] not in only:
            items.append({**row, "built": False, "glb": None})
            continue
        entry, glb, probs = build_item(row)
        problems += probs
        items.append(entry)
        if glb is not None:
            glbs[row["id"]] = glb
    support = []
    for row in support_rows:
        if only and row["id"] not in only:
            support.append({**row, "built": False, "glb": None})
            continue
        entry, glb, probs = build_item(row)
        problems += probs
        support.append(entry)
        if glb is not None:
            glbs[row["id"]] = glb
    pictures_doc: dict = {}
    if not only:
        built_rows = [e for e in items + support if e["built"]]
        pictures, confusable = build_pictures(built_rows, {r["id"]: hb.COLOURS[r["id"]] for r in built_rows})
        problems += hp.distractor_problems([e for e in items if e["built"]], confusable)
        for e in items + support:
            e["confusableWith"] = confusable.get(e["id"], [])
        problems += [f"{p}" for p in hc.group_problems(rows)]
        pictures_doc = {"version": 1, "box": hp.BOX, "confusableIou": hp.CONFUSABLE_IOU, "items": pictures}
    doc = {
        "version": 1,
        "frame": {
            "catalogUnits": "mm; z up; the object stands on z = 0; the grip point is the origin; the front is +y; the longest side is propMm",
            "glbUnits": "metres, y up: the library's (x, y, z) mm become (x, z, -y) / 1000; the node carries the quantisation transform",
        },
        "budget": {"maxTris": MAX_TRIS, "maxBytes": MAX_BYTES, "maxZones": MAX_ZONES},
        "items": items,
        "support": support,
    }
    return doc, glbs, problems, pictures_doc


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", default="", help="comma-separated ids: build just these (writes GLBs, not the catalog)")
    ap.add_argument("--check", action="store_true", help="rebuild in memory and compare with the files in --out; write nothing")
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(",") if s]

    doc, glbs, problems, pictures_doc = build_all(only or None)
    for e in doc["items"] + doc["support"]:
        if e["built"]:
            zs = "/".join(f"{z['name']}:{z['tris']}" for z in e["zones"])
            print(f"{e['id']:15} {e['tris']:4} tris {e['bytes']:6} B  {e['bboxMm']}  zones {zs}")
    for p in problems:
        print("PROBLEM:", p, file=sys.stderr)
    if problems:
        print(f"{len(problems)} problem(s): nothing written", file=sys.stderr)
        return 1
    text = json.dumps(doc, indent=1, ensure_ascii=False) + "\n"
    pictures_text = json.dumps(pictures_doc, ensure_ascii=False, separators=(",", ":")) + "\n" if pictures_doc else ""

    if args.check:
        drift: List[str] = []
        for iid, glb in sorted(glbs.items()):
            f = args.out / f"{iid}.glb"
            if not f.exists():
                drift.append(f"{iid}.glb is missing")
            elif f.read_bytes() != glb:
                drift.append(f"{iid}.glb differs from a fresh build")
        cat = args.out / "catalog.json"
        if not cat.exists():
            drift.append("catalog.json is missing")
        elif cat.read_text("utf-8") != text:
            drift.append("catalog.json differs from a fresh build")
        pics = args.out / "pictures.json"
        if not only:
            if not pics.exists():
                drift.append("pictures.json is missing")
            elif pics.read_text("utf-8") != pictures_text:
                drift.append("pictures.json differs from a fresh build")
        stray = sorted(p.name for p in args.out.glob("*.glb") if p.stem not in glbs) if args.out.exists() else []
        drift += [f"{n} is not in the catalog" for n in stray]
        for d in drift:
            print("DRIFT:", d, file=sys.stderr)
        print("up to date" if not drift else f"{len(drift)} difference(s)")
        return 1 if drift else 0

    args.out.mkdir(parents=True, exist_ok=True)
    for iid, glb in glbs.items():
        (args.out / f"{iid}.glb").write_bytes(glb)
    if not only:
        (args.out / "catalog.json").write_text(text, "utf-8")
        (args.out / "pictures.json").write_text(pictures_text, "utf-8")
    print(f"wrote {len(glbs)} GLB(s)" + ("" if only else " and catalog.json and pictures.json") + f" to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
