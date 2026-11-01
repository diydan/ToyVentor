"""Fixture for tests/parts-asset-optimization.test.ts: exercises OptimizerJobManager.prune() on fabricated
cache directories and prints one JSON object {scenario: [surviving names]}. Never touches the real cache."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
for sub in ("scripts", "parts/kip/sdk", "parts/kip", "parts/partspec"):
    sys.path.insert(0, str(ROOT / sub))
import forge_optimizer_daemon as d  # noqa: E402

NOW = time.time()


def put(directory: Path, name: str, age_s: float, size: int = 100) -> Path:
    p = directory / name
    p.write_bytes(b"x" * size)
    os.utime(p, (NOW - age_s, NOW - age_s))
    return p


def draft(i: int) -> str:
    return f"part_a.{i:08x}.draft.glb"


def final(i: int, ext: str = "stl") -> str:
    return f"part_b.{i:012x}.{ext}"


def listing(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir())


result: dict[str, list[str]] = {}

with tempfile.TemporaryDirectory(prefix="forge-prune-") as tmp:
    root = Path(tmp)

    # A. draft count cap: five drafts, keep the three newest
    a = root / "a"
    a.mkdir()
    for i in range(5):
        put(a, draft(i), age_s=(5 - i) * 10)  # draft(4) is newest
    d.OptimizerJobManager(a, max_drafts=3)
    result["count_cap"] = listing(a)

    # B. draft TTL: two expired drafts go, one fresh draft stays
    b = root / "b"
    b.mkdir()
    put(b, draft(1), age_s=7200)
    put(b, draft(2), age_s=3700)
    put(b, draft(3), age_s=5)
    d.OptimizerJobManager(b, draft_ttl_s=3600, max_drafts=50)
    result["ttl"] = listing(b)

    # C. size cap evicts the least recently served final; drafts are evicted before finals
    c = root / "c"
    c.mkdir()
    for i in range(4):
        put(c, final(i), age_s=1000 - i * 100, size=1000)  # final(0) oldest
    put(c, draft(9), age_s=1, size=100)
    os.utime(c / final(0), (NOW, NOW))  # "served" just now, so it outlives final(1) and final(2)
    d.OptimizerJobManager(c, max_drafts=50, max_cache_bytes=2500)
    result["size_cap"] = listing(c)

    # D. only artifact-named regular files and stale tv-job-* dirs are deletable
    e = root / "e"
    e.mkdir()
    outside = root / "outside_secret.txt"
    outside.write_text("do not delete")
    put(e, "README.txt", age_s=99999)
    put(e, "keep_me.stl", age_s=99999)
    put(e, draft(1), age_s=99999)
    (e / final(7)).symlink_to(outside)  # artifact-shaped symlink: neither followed nor removed
    os.utime(e / final(7), (NOW - 99999, NOW - 99999), follow_symlinks=False)
    stale = e / "tv-job-stale"
    stale.mkdir()
    (stale / "inner.glb").write_bytes(b"x")
    os.utime(stale, (NOW - 99999, NOW - 99999))
    (e / "tv-job-fresh").mkdir()
    (e / "other_dir").mkdir()
    os.utime(e / "other_dir", (NOW - 99999, NOW - 99999))
    d.OptimizerJobManager(e, draft_ttl_s=60, max_drafts=50)
    result["foreign"] = listing(e)
    result["foreign_outside_intact"] = [outside.read_text()]

    # F. non-forced prune is rate limited; forced prune runs
    f = root / "f"
    f.mkdir()
    mgr = d.OptimizerJobManager(f, draft_ttl_s=60, max_drafts=50)
    put(f, draft(1), age_s=99999)
    skipped = mgr.prune()
    result["rate_limited"] = listing(f) + [json.dumps(skipped, sort_keys=True)]
    forced = mgr.prune(force=True)
    result["forced"] = listing(f) + [json.dumps(forced, sort_keys=True)]

print(json.dumps(result))
