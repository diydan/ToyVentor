# PartSpec — parts geometry on the TU lattice

PartSpec is the Python parts system: one 12.5 mm lattice (TU) for Snap
Small (1 TU), Snap Large (2 TU) and Pro holes (1 TU), 93 catalog parts
(59 Snap + 34 Pro) generated from `interfaces.json` and gated by geometry,
printability, preprint slicing, interface, safety and measured-fit checks.

**Status:** proposed geometry canon
([decision 0005](../decisions/0005-partspec-lattice-merge.md)). It becomes
canonical once the condition in its design log passes: a printed Large 2×2
must feel right in a toddler's hand and on a real toy. Until then the app
lane (`parts/scad/` OpenSCAD, 16/32 mm) is what the demo runs on, and it is
frozen for new geometry. Nothing from either lane has been printed yet.

**Creating a part?** Start with the recurring runbook in
[Creating new parts](../creating-parts.md). It covers the brief and catalog-slot
decision, family vs bespoke builders, the full digital gate, assembly proof,
app bridging and the physical print record. The numbered specs below remain
the normative source when the two differ.

## Layout

| Path | What it is |
| --- | --- |
| [specs/](specs/README.md) | The numbered specs to build against (01 standard → 11 rationale). Start there. |
| [`../../parts/partspec/`](../../parts/partspec/INTERFACE_STANDARD.md) | The self-contained generator package (Python, `manifold3d` + `trimesh`): `interfaces.json` is the single source of truth for every number. Tracked directly in this repo (`~2.5 MB` of sources, manifests, and cached validation JSONs; generated meshes gitignored). |

`specs/` in this folder is the committed readable snapshot. Edit sources
in `parts/partspec/` (`interfaces.json`, `catalog.json`, part builders),
regenerate and run `selftest.py` there, then run
`python3 parts/partspec/make_specs.py parts/partspec` to refresh `specs/`.
