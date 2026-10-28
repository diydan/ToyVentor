# PartSpec — parts geometry on the TU lattice

PartSpec is the Python parts system: one 12.5 mm lattice (TU) for Snap
Small (1 TU), Snap Large (2 TU) and Pro holes (1 TU), 60 catalog parts
generated from `interfaces.json` and gated by geometry, printability,
interface, safety and measured-fit checks.

**Status:** proposed geometry canon
([decision 0005](../decisions/0005-partspec-lattice-merge.md)). It becomes
canonical once the condition in its design log passes: a printed Large 2×2
must feel right in a toddler's hand and on a real toy. Until then the app
lane (`parts/` OpenSCAD, 16/32 mm) is what the demo runs on, and it is
frozen for new geometry. Nothing from either lane has been printed yet.

## Layout

| Path | What it is |
| --- | --- |
| [specs/](specs/README.md) | The numbered specs to build against (01 standard → 11 rationale). Start there. |
| `pkg/` | The generator itself (Python, manifold3d): `interfaces.json` is the single source of truth for every number. Standalone repo with its own git history; gitignored in this repo. |

`specs/` in this folder is the committed readable snapshot. Edit sources
in `pkg/` (`interfaces.json`, catalog, part code), regenerate there
(`toyventor_parts.py`, `make_specs.py`, `selftest.py`), then refresh this
snapshot from `pkg/specs/`.
