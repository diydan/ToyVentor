# Specs to build against

> Assembled by `make_specs.py` from the project's documents. Edit the sources (or `interfaces.json` and `catalog.json`), not these copies.

Every number lives in `interfaces.json`, the single source of truth; where a document and the data differ, the data wins. Read them in order: the standard first, then the line you are building for.

| File | What it covers |
| --- | --- |
| [01_interface_standard.md](01_interface_standard.md) | The standard: lattice, interfaces, checks, fit and tolerance, conformance (generated from interfaces.json) |
| [02_snap_spec.md](02_snap_spec.md) | Snap line: sizes, part types, how parts connect, design and safety rules |
| [03_pro_spec.md](03_pro_spec.md) | Pro line: base standard, families, pin-and-bore and gear rules, fit, print rules |
| [04_forge_mount_spec.md](04_forge_mount_spec.md) | Forge Mount: faces, outlines, peg hole, hugging and clip-on shoes, join pins |
| [05_catalog.md](05_catalog.md) | The 30 + 30 part catalog and its live status (generated) |
| [06_agent_instructions.md](06_agent_instructions.md) | Rules, commands and part list for AI agents (generated) |
| [07_compliance.md](07_compliance.md) | US toy-safety checklist and status |
| [08_licensing.md](08_licensing.md) | Licences: code, designs, docs, name |
| [09_third_party.md](09_third_party.md) | Libraries we depend on and their licences |
| [10_design_log.md](10_design_log.md) | Dated design decisions (independent-design record) |
| [11_why_not_blockml_machineblocks.md](11_why_not_blockml_machineblocks.md) | Why BlockML and MachineBlocks are not used |

## Status when assembled

| Line | Verified | Target |
| --- | --- | --- |
| Snap | 120 | 120 |
| Pro | 86 | 86 |

Verified means every geometry and fit check passes. Nothing has been printed yet, so printed-fit and breakage checks are pending for every part.

## Checking a change

```
python3 toyventor_parts.py out     # generate parts and run every check
python3 toyventor_assembly.py out  # validate builds and the fit matrix
python3 selftest.py out           # the whole gate
python3 make_specs.py out         # refresh this folder
```
