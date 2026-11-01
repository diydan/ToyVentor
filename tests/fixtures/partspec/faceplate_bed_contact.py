"""Fixture for tests/partspec-faceplate-bed.test.ts: builds the three universal face plates through the real generator gate and reports, for the
printed pose, the lowest point of the plate (y > 0, the chin edge) and of the stem (y < -2, lying on its flat). A slicer sees any gap between
the two as a floating cantilever. Writes nothing."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PS = ROOT / "parts" / "partspec"
sys.path.insert(0, str(PS))
os.chdir(PS)
import numpy as np  # noqa: E402
import toyventor_parts as tp  # noqa: E402
from jsonschema import Draft202012Validator  # noqa: E402

validator = Draft202012Validator(tp.SCHEMA)
rows = []
for pid in ("char_faceplate", "char_faceplate_vinyl", "char_faceplate_flat"):
    part = next(p for p in tp.PARTS if p["id"] == pid)
    entry, tm, blocking, _small = tp.evaluate(part, validator)
    v = np.asarray(tm.vertices)
    rows.append({
        "id": pid,
        "design_status": entry["design_status"],
        "blocking": [b["id"] for b in blocking],
        "watertight": bool(tm.is_watertight),
        "plate_min_z": round(float(v[v[:, 1] > 0.0, 2].min()), 3),
        "stem_min_z": round(float(v[v[:, 1] < -2.0, 2].min()), 3),
        "stem_length_mm": round(-float(v[:, 1].min()), 2),
    })
print(json.dumps(rows))
