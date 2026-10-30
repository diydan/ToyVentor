#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Generate INTERFACE_STANDARD.md from interfaces.json so doc and code cannot drift."""
import json, sys
from pathlib import Path

HERE = Path(__file__).parent
IF = json.loads((HERE / "interfaces.json").read_text())

def main(out="INTERFACE_STANDARD.md"):
    L = []
    w = L.append
    w(f"# {IF['standard']} v{IF['version']}\n")
    w(f"> **Status:** {IF['status']}\n")
    w("This document is generated from `interfaces.json`. Edit the JSON, not this file.\n")
    lat = IF["lattice"]
    w("## 1. Lattice\n")
    w(f"One base unit for every product line: **1 {lat['unit_name']} = {lat['unit_mm']} mm**.\n")
    w(f"{lat['rule']}\n")
    if lat.get("nesting"):
        w(f"**Nesting:** {lat['nesting']}\n")
    if lat.get("decision"):
        w(f"**Decision:** {lat['decision']}\n")
    w("## 2. Interfaces\n")
    w("### Stud grid (Snap)\n")
    w("| Value | Small | Large |\n| --- | --- | --- |")
    s, l = IF["interfaces"]["stud_small"], IF["interfaces"]["stud_large"]
    for k, label in [("pitch", "Pitch (mm)"), ("stud_d", "Stud diameter (mm)"), ("stud_h", "Stud height (mm)"), ("fit", "Diametral clearance target (mm)"),
                     ("wall", "Outer wall (mm)"), ("edge_r", "Edge radius (mm)"), ("bed_chamfer", "Bed-edge chamfer (mm)"),
                     ("plate_h", "Plate height (mm)"), ("brick_h", "Brick height (mm)"), ("fit_class", "Fit class")]:
        w(f"| {label} | {s[k]} | {l[k]} |")
    if IF.get("fit_note"):
        w(f"\n**Clearance:** {IF['fit_note']}")
    b = IF["interfaces"]["bore_grid"]
    w("\n### Hole grid (Pro)\n")
    w(f"Pitch {b['pitch_tu']} TU ({b['pitch_tu'] * lat['unit_mm']} mm), halving down to 1/8 TU. Free bore {b['free_d']} mm. "
      f"Fixed bore flats {b['fixed_flats']} mm. Shaft {b['shaft_d']} mm round, flats {b['shaft_flats']} mm, {b['shaft_center_hole']} mm centre hole. {b['note']}\n")
    pf, pro = IF["interfaces"]["pin_friction"], IF["pro"]
    w("\n### Pro parts (pin, beam, gear)\n")
    w(f"**Friction pin:** shaft {pf['shaft_d']} mm round, flats {pf['shaft_flats']} mm, {pf['shaft_center_hole']} mm centre hole; fins {pf['fin_oversize_mm']} mm wider across than the bore (target). {pf['note']}\n")
    bm, gr = pro["beam"], pro["gear"]
    w(f"**Beam:** {bm['section_tu']} TU section, longest {bm['max_length_tu']} TU ({bm['max_length_tu'] * lat['unit_mm']} mm); outside fillet {bm['fillet_outer_mm']} mm ({bm['fillet_small_mm']} mm on small features); hole-mouth chamfer {bm['hole_mouth_chamfer_mm']} mm; bed-edge chamfer {bm['bed_chamfer_mm']} mm. {bm['bore_rule']}\n")
    w(f"**Gear:** module {gr['module_mm']} mm (target). {gr['grid_rule']} Hub takes the {gr['hub']}. {gr['note']}\n")
    w("### Mating rules\n")
    for m in IF["mates"]:
        w(f"- `{m['male']}` (M) with `{m['female']}` (F): {m['rule']}.")
    pb = IF["pin_bore"]
    w("\n### Pro connectors and pin-and-bore rules\n")
    w("Pro parts print flat; most bores and pins run along z, and a connector may point along x or y (hinge knuckles, the cross connector). In a build, Pro parts may be tipped onto their side in quarter turns. A `bore_grid` connector (F) anchors its grid at the first bore centre (`anchor: corner`) with a `bore_class` (free or fixed) and a `depth_mm`; a `lattice` of `cell` means bores sit on cell centres measured from the part's corner, `axis` means on the part axis (gears, wheels). "
      "A `pin` connector (M) puts the pin axis at the frame origin, with a `profile` (round, flats, friction) and a `length_mm`. A pin and a bore mate when the axes coincide and their z ranges overlap, and the pair appears in this table:\n")
    w("| Pin interface | Bore class | Fit class |\n| --- | --- | --- |")
    for r in pb["rules"]:
        w(f"| `{r['pin']}` | {r['bore']} | {r['fit']} |")
    w(f"\n{pb['note']}\n")
    f = IF["forge_mount"]
    w("\n## 3. Forge Mount (single definition)\n")
    w(f"{f['definition']}\n")
    w(f"- **Frame:** origin at {f['frame']['origin']}; +z {f['frame']['z']}; +x {f['frame']['x']}.")
    a = f["attach"]
    w(f"- **Attach:** through-hole, default {a['hole_d_default_mm']} mm (set from the scan), {a['lead_in_mm']} mm lead-in, {a['crush_ribs']} crush ribs. {a['note']}")
    w(f"- **Face options:** {', '.join('`'+x+'`' for x in f['face_options'])}. Demo uses `{f['demo_choice']}`.")
    w(f"- **Rule:** {f['rule']}")
    if f.get("grid_rule"):
        w(f"- **Grid rule:** {f['grid_rule']} Omitted cells are recorded in the connector metadata.")
    w("")
    w("## 4. Part metadata (for tools and AI)\n")
    w("Every part has a manifest entry (`part_manifest.schema.json`) with typed, gendered **connectors**: kind (`stud_grid`, `socket_grid`, `bore_grid`, `pin`, `bore`), "
      "gender (M/F), size class, a frame (origin + normal), and a grid (nx, ny, pitch, omitted cells). Two connectors mate when kinds are complementary, "
      "genders differ, size classes match, normals oppose, seat planes coincide and cell centres coincide.\n")
    w("**Generation loop:** (1) give the model the part catalog; (2) the model proposes `attach(parent connector, child part, child connector, cell, cell, rotation)` "
      "steps, never raw coordinates; (3) the validator accepts or rejects with a specific code and the model retries.\n")
    w("Validator error codes: `unknown_part`, `duplicate_id`, `size_mismatch`, `misaligned`, `profile_mismatch`, `gear_mesh_distance`, `unsupported_pose`, `floating`, `collision`.\n")
    w("## 5. Checks\n")
    w("Severity is data: each check's level lives in `interfaces.json` and nowhere else.\n")
    w("| ID | Group | Level | Meaning |\n| --- | --- | --- | --- |")
    for cid, c in IF["checks"].items():
        w(f"| `{cid}` | {c['group']} | {c['level']} | {c['description']} |")
    w(f"\n{IF['conformance']['check_applicability']}")
    w("\n`block` failures stop export. `warn` is shown. `info` is noted. `pending` checks need a physical print and are never reported as passed.\n")
    tol = IF["tolerance"]
    w("### Fit and tolerance\n")
    w("Fit is measured, not assumed. After a part is built it is seated on its matching reference part (or a copy of itself), both are sliced at mid-stud height, and every engaged stud gets a signed radial gap against the female outline: positive is clearance, negative is interference. "
      "The measurement uses the built geometry, so a cavity that is too loose, too tight or missing its tubes shows up even when nothing overlaps.\n")
    w(f"- **T1 (block):** each measured gap equals the interface's design gap (fit / 2) within the faceting allowance, and the design gap itself is inside the limits: at most {tol['max_play_mm']} mm play and {tol['max_interference_mm']} mm interference (radial).")
    w(f"- **T2 (warn):** if both parts print with a surface error of up to +/-{tol['surface_error_calibrated_mm']} mm after calibration, the gap still stays inside those limits. The part's **fit window** is the printer surface offset range that satisfies both limits, and the calibration print has to land inside it (check F1).")
    w("- **Fit matrix:** `build_check` seats every male stud connector on every complementary female connector in the catalog, measures each pair, and lists any connector with no partner. Every build also measures each connection it makes and warns with `fit_out_of_tolerance` if one is off.")
    w(f"- **Fit classes:** `press` (studs in tubes, flat shafts in fixed bores) uses the limits above. " + "; ".join(f"`{k}`: {v['note']}" for k, v in tol["classes"].items()))
    w(f"- **Resolution:** fit-critical cylinders use {IF['limits']['fit_segments']} segments, so polygon error stays under 0.01 mm.\n")
    w("| Tolerance value | mm |\n| --- | --- |")
    for k, v in tol.items():
        if k != "note":
            w(f"| `{k}` | {v} |")
    w(f"\n{tol['note']}\n")
    w("**Limits used by the checks:** " + ", ".join(f"`{k}` = {v}" for k, v in IF["limits"].items()) + ".\n")
    sc = IF["safety"]["small_parts_cylinder"]
    w("## 6. Safety and the print page\n")
    w(f"Small-parts screen: cylinder {sc['diameter_mm']} mm across, {sc['depth_min_mm']}-{sc['depth_max_mm']} mm deep. {sc['note']} "
      f"The screen uses the deepest setting and tries many orientations, so it over-flags rather than under-flags. It does not replace a lab test or a breakage test.\n")
    w("Each part gets a status and the print page shows the matching text below it, always preceded by the general notice:\n")
    for k, v in IF["print_page_warnings"].items():
        w(f"- **{k}:** {v}")
    w("\nA warning label is the right tool only for parts marketed to children 3 and over. For anything marketed to children under 3, small parts are not allowed, "
      "so those parts must pass the cylinder and breakage checks and be tested by a lab. Confirm with a toy-safety professional before selling printed parts for under-3s.\n")
    cf = IF["conformance"]
    w("## 7. Part conformance\n")
    w("A part conforms when the generator reports no blocking failure and the small-parts result is not marginal. The generator computes `design_status` from the check results, so a part cannot be marked verified by hand.\n")
    w(f"- **verified:** {cf['status_rule']['verified']}")
    w(f"- **needs_reproportion:** {cf['status_rule']['needs_reproportion']}\n")
    w("**To add a part:**\n")
    for i, step in enumerate(cf["authoring_steps"], 1):
        w(f"{i}. {step}")
    w("\n**Rules every part follows:**\n")
    for r in cf["authoring_rules"]:
        w(f"- {r}")
    w("\n**Planned checks (not yet enforced):**\n")
    w("| ID | Group | Level | Meaning |\n| --- | --- | --- | --- |")
    for cid, c in IF["planned_checks"].items():
        if not cid.startswith("_"):
            w(f"| `{cid}` | {c['group']} | {c['level']} | {c['description']} |")
    w(f"\n{IF['planned_checks']['_note']}\n")
    w("## 8. Tooling\n")
    w(f"{IF['tooling']['source_of_truth']}\n")
    w("| Task | Command |\n| --- | --- |")
    for k, v in IF["tooling"]["commands"].items():
        w(f"| {k.replace('_', ' ')} | `{v}` |")
    w("\n**Impact index:** `toyventor_index.py` answers which parts use an interface, which mating pairs it affects, and which results go stale if it changes.\n")
    w("**Agent instructions:** `AGENTS.md` is generated from this file and the manifest so an AI agent's rules cannot drift from the model.\n")
    Path(out).write_text("\n".join(L))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/INTERFACE_STANDARD.md")
