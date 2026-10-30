# Licensing

> Draft for counsel to confirm before the project is published. Fill in the legal owner where it says [legal owner].

The project is open source. Code and designs are licensed separately, and the name is not licensed at all.

| What | Files | Licence |
| --- | --- | --- |
| Code | `*.py` (generator, checks, validator, tools) | Apache License 2.0 (`LICENSE`). It includes an express patent grant from contributors. |
| Designs and data | `interfaces.json`, `catalog.json`, `part_manifest.schema.json`, every `*.stl`, generated manifests | Creative Commons Attribution 4.0 (`LICENSE-DESIGNS`) |
| Documentation | `*.md` specs, standard, logs and checklists | Creative Commons Attribution 4.0 (`LICENSE-DESIGNS`) |
| Name and logo | The product name, any logo, and the app's look | Not licensed. They stay with [legal owner] as trademarks. |

Copyright 2026 [legal owner].

## Why this split

- **Apache 2.0 for code:** permissive, widely used, and its patent grant means contributors cannot later sue users of the code over their own contributions.
- **CC BY 4.0 for designs:** anyone may print, change and sell parts, as long as they credit the project. Publishing the designs with dates also makes them prior art, so nobody else can patent the stud-hole sockets, the fit gate or the part shapes.
- **Name kept back:** open licences do not cover trademarks. Others may make compatible parts but may not sell them under the project's name.

## Before publishing

1. Clear and register the product name, ToyVentor (toyventor.com), chosen on 2026-10-28 to replace an earlier name that others already use in toys (see `DESIGN_LOG.md`). Run a USPTO trademark search first.
2. Confirm the licence choice with counsel, and fill in [legal owner].
3. Decide on any patent first. Publishing counts as public disclosure: the US allows one year after your own disclosure; most other countries allow none.
