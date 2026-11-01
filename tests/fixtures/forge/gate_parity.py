"""Fixture for tests/parts-asset-optimization.test.ts: runs the new in-memory blocking gate and the legacy
full preprint_check.check_stl path on the same bed-snapped meshes and prints one JSON row per STL.
Usage: gate_parity.py <stl> [<stl> ...]"""
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
for sub in ("scripts", "parts/kip/sdk", "parts/kip", "parts/partspec"):
    sys.path.insert(0, str(ROOT / sub))
import optimize_assets as oa  # noqa: E402

PARTSPEC = ROOT / "parts" / "partspec"
CHECK_ID = re.compile(r"V\d+_[a-z_]+")


def ids(items: list[str]) -> list[str]:
    return sorted({m for s in items for m in CHECK_ID.findall(s)})


rows = []
with tempfile.TemporaryDirectory(prefix="forge-parity-") as tmp:
    for arg in sys.argv[1:]:
        src = Path(arg)
        mani, _v, _f, _raw = oa._resolve_source_manifold(part_id=src.stem, stl_bytes=src.read_bytes())
        mani = oa.snap_manifold_to_bed(mani)
        verts, faces = oa.manifold_to_arrays(mani)
        new = ids(oa._check_blocking_preprint_in_memory(src.stem, verts, faces, mani, PARTSPEC, fail_fast=False))
        snapped = Path(tmp) / f"{src.stem}.stl"
        snapped.write_bytes(oa.encode_binary_stl_bytes(verts, faces))
        old = ids(oa._verify_one_preprint_worker((str(snapped), str(PARTSPEC))))
        rows.append({"file": src.name, "in_memory": new, "check_stl": old})
print(json.dumps(rows))
