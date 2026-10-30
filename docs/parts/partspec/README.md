# PartSpec

Human product docs live beside this folder in [docs/parts/](../snap.md). This
folder is the generated readable snapshot of the PartSpec package.

- `specs/01_interface_standard.md`, `specs/05_catalog.md`, and
  `specs/06_agent_instructions.md` are generated; change their sources, then
  regenerate.
- The remaining numbered specs are copies assembled from `parts/partspec/*.md`
  by `make_specs.py`; edit those sources, not the copies.
- Refresh the snapshot with `python3 make_specs.py .` from `parts/partspec`.
- Verification status is generator-derived: a part counts as verified only
  when no blocking check fails and its small-parts result is not marginal.

