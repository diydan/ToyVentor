---
type: project
description: Product renamed ToyForge to ToyVentor (toyventor.com), confirmed 2026-10-28
---

# Product name

2026-10-28: Dan renamed the product from **ToyForge** to **ToyVentor**
(toyventor.com). Reason on record in the PartSpec design log: "ToyForge"
was already used by others in toys (an AI sketch-to-printable-toy tool
and an action-figure maker's brand), so a replacement needed clearing
before launch.

User-facing rename sweep done 2026-10-28: app, README, spec, plan,
snap/pro, wireframe, design guide, mockups, license-email draft,
manifest, package.json, and the Wrangler Worker name now say ToyVentor /
toyventor.com. Deliberately not renamed: localStorage keys
(toyforge:*) so saved toys/skins survive, decision records 0002/0003,
and journal Day 1 history. Folder name is still "toyforge". Forge
Mount / Merge Forge / Forge Club feature names unchanged pending Dan's
call.

Second pass later on 2026-10-28 (another session): the PartSpec pkg
Python modules WERE renamed (toyforge_*.py -> toyventor_*.py), along
with generated file names (toyventor_parts.json, toyventor_*.stl) and
all pkg source strings; everything was regenerated and the pkg gate
re-run green (60/60 verified, selftest 127 ok). A design-log entry
records the rename there. Storage keys were briefly renamed too, then
restored to toyforge:* the same day to match the deliberate
saved-state decision above. Trademark registration/clearance status
beyond choosing the name is not verified; licensing doc lists counsel
confirmation as a pre-publish step.
