#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Assemble specs/: the numbered set of documents to build against, copied from their sources so it cannot drift.
Generated documents (standard, catalog, agent instructions) are regenerated first by their own tools.   python3 make_specs.py out
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
DOCS = [
    ("01_interface_standard.md", "INTERFACE_STANDARD.md", "The standard: lattice, interfaces, checks, fit and tolerance, conformance (generated from interfaces.json)"),
    ("02_snap_spec.md", "snap_v2.md", "Snap line: sizes, part types, how parts connect, design and safety rules"),
    ("03_pro_spec.md", "pro_v2.md", "Pro line: base standard, families, pin-and-bore and gear rules, fit, print rules"),
    ("04_forge_mount_spec.md", "FORGE_MOUNT.md", "Forge Mount: faces, outlines, peg hole, hugging and clip-on shoes, join pins"),
    ("05_catalog.md", "CATALOG.md", "The 30 + 30 part catalog and its live status (generated)"),
    ("06_agent_instructions.md", "AGENTS.md", "Rules, commands and part list for AI agents (generated)"),
    ("07_compliance.md", "COMPLIANCE.md", "US toy-safety checklist and status"),
    ("08_licensing.md", "LICENSING.md", "Licences: code, designs, docs, name"),
    ("09_third_party.md", "THIRD_PARTY.md", "Libraries we depend on and their licences"),
    ("10_design_log.md", "DESIGN_LOG.md", "Dated design decisions (independent-design record)"),
    ("11_why_not_blockml_machineblocks.md", "WHY_NOT_BLOCKML_MACHINEBLOCKS.md", "Why BlockML and MachineBlocks are not used"),
]


def build(out, dest=None):
    out = Path(out).resolve()
    repo_specs = (HERE.parent.parent / "docs" / "PartSpec" / "specs").resolve()
    dest = Path(dest) if dest else (repo_specs if out == HERE.resolve() and repo_specs.parent.exists() else out / "specs")
    dest.mkdir(parents=True, exist_ok=True)
    for name, src, _ in DOCS:
        shutil.copy(out / src, dest / name)
    import make_catalog
    pr = make_catalog.progress(make_catalog.CAT, json.loads((out / "toyventor_parts.json").read_text()))
    lines = ["# Specs to build against", "",
             "> Assembled by `make_specs.py` from the project's documents. Edit the sources (or `interfaces.json` and `catalog.json`), not these copies.", "",
             "Every number lives in `interfaces.json`, the single source of truth; where a document and the data differ, the data wins. "
             "Read them in order: the standard first, then the line you are building for.", "",
             "| File | What it covers |", "| --- | --- |"]
    lines += [f"| [{n}]({n}) | {d} |" for n, _, d in DOCS]
    lines += ["", "## Status when assembled", "",
              "| Line | Verified | Target |", "| --- | --- | --- |"]
    lines += [f"| {ln.title()} | {s['verified']} | {s['target']} |" for ln, s in pr["lines"].items()]
    lines += ["", "Verified means every geometry and fit check passes. Nothing has been printed yet, so printed-fit and breakage checks are pending for every part.", "",
              "## Checking a change", "",
              "```", "python3 toyventor_parts.py out     # generate parts and run every check", "python3 toyventor_assembly.py out  # validate builds and the fit matrix",
              "python3 selftest.py out           # the whole gate", "python3 make_specs.py out         # refresh this folder", "```", ""]
    (dest / "README.md").write_text("\n".join(lines))
    return dest


if __name__ == "__main__":
    d = build(sys.argv[1] if len(sys.argv) > 1 else "out", sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"{d}: {len(list(d.glob('*.md')))} documents")
