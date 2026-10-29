# Creating new parts

Use this guide for every recurring part task: robot parts, figurines and character add-ons, capsules, bricks, mounts, and Pro mechanisms. It is the operating checklist that takes an idea from brief to a compatible, conforming, testable part.

This guide does **not** replace the standards. If anything here conflicts with them, the standards and data win:

1. Product behaviour: [spec.md](spec.md), then [snap.md](snap.md) or [pro.md](pro.md).
2. Part numbers, checks, interfaces and warnings: [`interfaces.json`](PartSpec/pkg/interfaces.json).
3. PartSpec rules: the [Interface Standard](PartSpec/specs/01_interface_standard.md), followed by the relevant line spec in [PartSpec/specs](PartSpec/specs/README.md).
4. Generator workflow and live catalog: the generated [agent instructions](PartSpec/specs/06_agent_instructions.md). Regenerate it instead of editing it.

## Current lane rule

New geometry goes in **PartSpec**, the TU-lattice Python system under [`docs/PartSpec/pkg`](PartSpec/pkg). Do not create new parts in the frozen OpenSCAD app lane (`parts/`, 16/32 mm) unless Dan explicitly asks for emergency maintenance of the current demo.

PartSpec is still the *proposed* geometry canon until the Large hand-feel print condition in [decision 0005](decisions/0005-partspec-lattice-merge.md) passes. A digitally verified PartSpec part therefore does not automatically ship in the current app.

## What "finished" means

Do not use these stages interchangeably:

| Stage | Meaning | Evidence required |
| --- | --- | --- |
| Modelled | A shape exists in code | Builder runs and exports a mesh |
| Compatible | It truthfully mates through typed connectors | Assembly validation and measured fit matrix pass for its claimed mates |
| Conforming | It satisfies the digital PartSpec gate | Generated `design_status` is `verified`; the full selftest passes |
| App-bridged | The app can represent it | `npm run bridge`, set validation, bridge tests and app checks pass |
| Print-tested | It has survived a real printer and mate | Print record for `F1_printed_fit`, plus breakage observations for `F2_breakage` |
| Release-ready | It may be offered to users | Print evidence, correct age grading and warnings, and any required professional/lab safety review |

Compatibility is about **connections**. Conformity is about the **whole rule set**: geometry, printability, interfaces, measured fit, metadata and safety screening. Neither word means "safe" or "certified".

## Fast path

For an ordinary new part, the work is:

1. Complete the brief and resolve the catalog slot.
2. Run the untouched PartSpec gate in a scratch output directory.
3. Copy the nearest suitable catalog row and builder pattern.
4. Add the row and, only if needed, a bespoke builder.
5. Regenerate until the new manifest entry is `verified`.
6. Validate at least one real assembly and every claimed fit pair.
7. Promote the regenerated artifacts to the package root and refresh the docs snapshot.
8. Bridge to the app only if the brief requires it, then print with its mates before calling it release-ready.

## 1. Start with a part brief

Copy this into the task, issue or working notes before modelling. Do not leave the target stage or catalog slot implicit.

```md
## Part brief

- Working name:
- Proposed catalog ID:
- One-sentence job:
- New part, variant, replacement, or assembly of existing parts:
- Line and age group: Snap Small (3+) / Snap Large (youngest) / Pro (8+)
- User and toy context:
- Existing parts considered, and why they are not enough:
- Visual intent and originality notes (no copied character or franchise):
- Movement or articulation:
- Direction matters? If yes, how is swivel prevented?
- One stat and in-game/AR behaviour:
- Intended mates (part + connector + relative rotation/axis for each):
- Target overall scale/envelope (footprint is still derived by the generator):
- Print orientation and material assumption:
- Safety concerns: small size, detachable elements, pointy or thin features, likely breakage fragments
- Catalog slot: replace existing row / approved expansion / non-catalog experiment
- App target: PartSpec only / bridge demo candidate / future shipped set
- Mates to print for physical testing:
- Acceptance evidence required:
- Open decisions for Dan:
```

### Resolve the catalog slot before writing geometry

The selftest currently enforces the catalog targets in `catalog.json`: **exactly 30 Snap rows and 30 Pro rows**. A new row added casually will fail that test. Choose one route explicitly:

| Route | Use when | Required product action |
| --- | --- | --- |
| Build from existing parts | A robot or scene can be assembled from catalog parts | No new catalog slot |
| Replace a row | The new part supersedes an existing planned part | Record why in the design log; retire or rename deliberately |
| Expand the catalog | This is an approved new set/wave | Update the target and wave plan as one coherent product change; do not bump a number only to silence the test |
| Experiment outside the catalog | You are exploring a shape or mechanism | Keep it clearly labelled experimental; it is not a conforming catalog part and cannot be bridged or shipped |

Do not reuse a retired part ID for different geometry. Part IDs are compatibility contracts once anything references them.

## 2. Choose the implementation route

| Request | Route | Primary files |
| --- | --- | --- |
| Brick, plate, tile, slope or dome variant | Existing `block`, `tile`, `slope` or `dome` family | `catalog.json` row only |
| Snap figurine shell, robot head/body, wing, tail, ears or capsule | Bespoke Snap builder, usually with an integrated base | `toyventor_parts.py` + `catalog.json` |
| Posable or driven robot | Assembly of Pro beams, pins, shafts, hinges, gears and wheels | `toyventor_assembly.py`; add a new Pro part only if a real joint is missing |
| New Pro beam, gear, wheel or joint | Existing Pro builder with parameters, or a new Pro builder | `toyventor_pro.py` + `catalog.json` |
| Scanned-toy attachment | Forge Mount family/spec, generated for the toy where applicable | `toyventor_parts.py`, Forge Mount spec; do not invent a drilled/custom interface |
| Cross-line connection | Existing Snap-to-Pro adapter or Forge Mount | Assembly plus fit matrix |
| New connector or interface | Standards change, not just a new part | `interfaces.json`, connector helper, fit measurement, validator, fixtures/selftests and a design-log decision |
| Texture/skin only | Game/AR asset, never a printed part | App asset pipeline; do not add a printable catalog row |

### Robots and figurines: choose the right abstraction

- A **static figurine** that sits on a toy is normally one Snap add-on with an integrated base.
- A **posable robot** is normally an assembly. Model each joint with existing pins, shafts, hinges or cross connectors and validate the assembly. Do not fake articulation by placing disconnected meshes near each other.
- A **driven robot** needs its shaft, gear, rack or wheel centre distances designed on the TU lattice from the start.
- A **full character made of several bespoke pieces** is several parts plus an assembly recipe. Each piece needs its own catalog decision and physical connectors.
- For Large/under-3 use, prefer one chunky piece. Removable pins, small limbs and break-off details need explicit safety justification and still require professional/lab review before sale.

### Shared character anatomy

Snap fixed-pose figures and Pro articulated figures are two expressions of
one anatomy, not separate character systems. Use the same named roles for
heads, torsos, limb segments, tails, accessories and end effectors across
humans, animals and robots.

- Give every bespoke character piece typed connectors for every join it
  claims. A posed collection of meshes with missing connector metadata is
  only modelled; it is not compatible or conforming.
- Reuse a direct shared head/accessory interface where scale is physically
  sound. Otherwise make the adapter itself a declared, fit-measured part.
  Never call a head cross-line compatible from matching visual proportions.
- Keep humanoid proportions, joint names and axes mappable to a standard
  animation rig, and record any non-obvious axis or facing convention in
  the catalog note or assembly recipe.
- Acceptance for a claimed shared module includes a validated assembly on
  each line it claims to support and, for a moving Pro figure, the same
  travel and collision checks required of any other joint.

## 3. Set up and establish a clean baseline

PartSpec lives in a nested standalone repository. Check both worktrees before editing so concurrent work is not mistaken for yours:

```bash
cd "$(git rev-parse --show-toplevel)"
git status --short
git -C docs/PartSpec/pkg status --short
cd docs/PartSpec/pkg
```

Create the Python environment inside the PartSpec package if it does not already exist:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Use that activated environment for every PartSpec command below. `requirements.txt` is currently unpinned; if the baseline fails after a fresh install, record the package versions and treat the environment failure separately from your part change.

Use a scratch output directory while iterating. It avoids churning the tracked STLs and generated documents in the package root:

```bash
python toyventor_parts.py out
python toyventor_assembly.py out
python make_standard.py out/INTERFACE_STANDARD.md
python make_agents.py out
python make_catalog.py out
python selftest.py out
```

If the untouched baseline is not green, stop and record the failures before changing anything. Do not let a new part inherit blame for pre-existing breakage.

Then inspect before inventing:

```bash
python toyventor_index.py out list
python toyventor_index.py out used-by stud_small
python toyventor_index.py out uses cloud_wings
python toyventor_index.py out impact stud_small
python toyventor_index.py out checks S1_small_part_screen
```

Read the closest existing catalog row, its builder, its generated manifest entry and at least one assembly that uses the same connector pattern. The compact generated `out/ai_catalog.txt` is useful for finding candidates, but it is not the source of truth.

## 4. Add or change the catalog row

Add the row before polishing geometry. It fixes identity, product meaning and build parameters in one place.

A bespoke Snap add-on row has this shape (replace all placeholder values):

```json
{
  "id": "moon_antenna",
  "name": "Moon Antenna",
  "line": "snap",
  "family": "addon",
  "size": "small",
  "wave": null,
  "note": "Integrated base; direction locked so the antenna cannot swivel.",
  "stat": "Glow",
  "type": "Character add-on",
  "behavior": "Pulses softly when tapped",
  "tags": ["antenna", "character", "add_on", "head"],
  "build": {
    "fn": "moon_antenna",
    "grid": [2, 2],
    "base": "integrated",
    "lock": true
  }
}
```

Field rules:

- `id`: stable lowercase `snake_case`, unique, descriptive and free of third-party names. Once referenced by a build, set, STL or saved app state, treat it as permanent.
- `name`: user-facing display name. Original and child-readable.
- `line` + `size`: must agree (`snap` = `small` or `large`; `pro` = `pro`, apart from the special Forge Mount handling already in the generator).
- `family`: use an existing family. A new family is a generator/standards change, not just a label.
- `stat`: exactly one PartSpec stat label. If the part must reach the current app immediately, choose one the bridge maps exactly today: `Speed`, `Spin`, `Torque` or `Glow`. Any other stat needs a recorded game-design decision.
- `behavior`: one concrete sentence about what happens when used. It documents intent; it does not implement game behaviour.
- `tags`: lowercase discovery terms. Reuse nearby vocabulary instead of coining synonyms.
- `note`: engineering facts a future maintainer needs: why this base, size variant, angle, pad, locking method or exception exists.
- `wave`: use the approved wave for an expansion, or retain the replaced part's wave when replacing it. Do not invent a wave ID casually.
- `build`: parameters only. It must not smuggle in an undeclared interface, connector or check ID.

Family variants intentionally need less. For example, a new `block` row supplies `build.kind` (`brick` or `plate`) and `build.grid`; `tile` and `dome` need a grid; `slope` may also need `angle_deg`. A parameterized Pro row names an existing builder and its arguments, such as `{"fn": "beam", "length_tu": 5}` or `{"fn": "spur_gear", "teeth": 20}`.

## 5. Implement geometry and connectors together

Edit sources only:

- `docs/PartSpec/pkg/catalog.json` — catalog row and approved targets/waves
- `docs/PartSpec/pkg/toyventor_parts.py` — Snap builders and shared generator logic
- `docs/PartSpec/pkg/toyventor_pro.py` — Pro builders and mechanical primitives
- `docs/PartSpec/pkg/interfaces.json` — only for an approved standards change
- `docs/PartSpec/pkg/toyventor_fit.py`, `toyventor_assembly.py` or `toyventor_index.py` — only when a genuinely new mating feature must be measured or validated
- Human-authored package docs in `docs/PartSpec/pkg` (`snap_v2.md`, `pro_v2.md`, `FORGE_MOUNT.md`, `COMPLIANCE.md`, `LICENSING.md`, `DESIGN_LOG.md`) — only when the product rule or decision itself changes; never edit their assembled copies under `specs/`

Never hand-edit generated STLs, `toyventor_parts.json`, `toyventor_index.json`, `AGENTS.md`, `CATALOG.md`, `INTERFACE_STANDARD.md` or the assembled specs. Change the source and regenerate.

### Snap bespoke builder pattern

Most robot shells, figurines and character add-ons should follow the existing bespoke pattern:

```python
def moon_antenna(size="small", grid=(2, 2), scale=1.0,
                 base="integrated", pad=None, lock=False):
    p, fh, foot = _foot(size, grid, base, pad)
    s = _s(size, scale)  # only when using the existing Small-2x2 mm drawing convention

    # Build the visible body in the assembly frame.
    # - Derive interface dimensions from p, IF and LIM.
    # - For base="foot", build from the plate top fh and overlap the trim plane.
    # - For base="integrated", give the shape a real flat underside at z=0
    #   with enough solid depth for the generated stud holes.
    body = ...

    return _finish(size, grid, foot, lock, body, fh, base)
```

Use `_finish()` so the foot or integrated sockets and their connector metadata are created together. If a custom return is unavoidable, return exactly `(manifold, connectors, extras)` and make the connector list describe only features that physically exist.

Snap-specific rules:

- Never type a footprint, pitch, stud diameter, hole diameter or fit value. Read them from `p`, `IF`, `LIM` and `FIT_SEG`.
- Pick one scaling convention for the decorative body and state it in a short comment: direct millimetres relative to the interface values, the existing Small-2x2 `_s()` convention, or the legacy `K` convention for variants of the six original designs. Do not mix conventions in one builder.
- Walls, clearances, fillet sizes and embed depths are print-limited constants; do not scale them merely because the decorative body scales.
- Bricks, plates and shape blocks use the full square foot and socket cavity. Snap socket grids that need tube grip are at least 2×2.
- Add-ons and capsules default to `base: "integrated"`: holes and reliefs in their own underside, with no decorative plate around them.
- If the body is too thin to wrap a hole with a full wall, use `pad` on real lattice points.
- If facing direction matters, set `lock: true`. It needs two full holes, or one full hole plus a relief. A round part may intentionally rotate on one stud; say so in `note`.
- Keep a square Small 2×2 part under about 25 mm tall or use a larger foot; the intermediate band is exactly where the small-parts screen becomes marginal.
- A round outline cannot carry a full stud grid on this lattice. Make round parts female-only unless a new, fit-measured design proves otherwise.
- For a Small/Large pair, reuse one builder where practical and gate both catalog rows separately. Passing at one size proves nothing about safety or fit at the other.

### Pro builder pattern

For a new mechanical part, prefer an existing builder in `toyventor_pro.py`: `beam`, `beam_cells`, `beam_path`, `free_pin`, `shaft`, `friction_pin`, `bushing`, `spur_gear`, `ring_gear`, `rack`, `wheel`, `hinge_leaf` or `cross_connector`.

If a new builder is required:

- Build bore and pin sections with `bore_section`, `bore_cutter`, `bore_cutter_axis`, `pin_section` and `pin_solid`; do not redraw interface profiles inline.
- Return `(manifold, connectors, extras)`. Connector `bore_class`, `profile`, `depth_mm`, frame, normal, grid pitch/anchor and omitted cells must mirror the actual holes and pins.
- Return `print_rotation_deg` in `extras` only when the printed orientation really differs from the assembly frame. Printability is then checked on the rotated mesh while connectors remain in the assembly frame.
- For gears, use `gear_numbers()` and return complete `extras["gear"]` metadata. Tooth counts and centre distances must keep pitch circles on the TU/half-TU lattice required by the standard.
- For horizontal bores, use the established teardrop or flats-up print profiles. Do not model an unsupported circular roof.
- A robot joint is not compatible merely because two meshes touch. Its axis, allowed pin/bore pair, fit class, travel/clearance and collision behaviour must all be represented and validated.

### New interface or connector: stop and treat it as a standards change

Do not invent a connector kind, interface ID, fit class or check ID inside a part builder. A genuinely new mating feature requires all of the following in the same change:

1. A recorded design decision explaining why existing interfaces cannot do the job.
2. The interface definition and tolerances in `interfaces.json`, plus any `part_manifest.schema.json` change needed to represent the new connector honestly.
3. Geometry and connector helper code that cannot drift apart.
4. Fit measurement in `fit_report()` / `seat_pair()` or the Pro pair reports.
5. Assembly mating rules in the index and validator.
6. Positive and negative fixtures proving the new checks can both pass and fail.
7. A physical print probe before any user-facing compatibility claim.

If any item is missing, the connection is unverified even if the mesh looks right.

### Geometry rules that catch most failures early

- Return one connected solid. Union decorative pieces; do not rely on touching-at-a-point or coplanar-only contact.
- Keep roots buried in the foot and use `keep_above()` rather than leaving shallow undersides.
- Aim for no downward face steeper than 45 degrees. The gate allows a tiny tolerance area; do not design to consume it.
- Keep unsupported flat bridges within `limits.max_bridge_mm`.
- Round exposed edges and tips; use the bed chamfer pattern instead of a bottom fillet.
- Avoid thin spikes, knife edges, brittle cantilevers and inaccessible internal voids, especially on child-facing parts.
- Do not use text as the only orientation cue at small sizes; it may not print legibly. Use shape, dots or asymmetry that survives slicing.
- Keep decorative overhang inside a sensible envelope for the toy and printer bed. The generator's bed check is a hard bound, not a product-design approval.

## 6. Iterate against the digital gate

Stay in the scratch `out/` directory until the part is digitally clean:

```bash
python toyventor_parts.py out
python toyventor_assembly.py out
python make_standard.py out/INTERFACE_STANDARD.md
python make_agents.py out
python make_catalog.py out
python selftest.py out
```

Read the whole failure, not just the final status. Inspect the new manifest entry directly:

```bash
jq '.parts[] | select(.id == "moon_antenna") |
  {id, design_status, file, bbox_mm, volume_cm3, connectors, safety, fit,
   failed_checks: [.checks[] | select(.result == "fail")]}' \
  out/toyventor_parts.json

jq '.pairs[] | select(.male | startswith("moon_antenna."))' out/fit_matrix.json
jq '.pairs[] | select(.female | startswith("moon_antenna."))' out/fit_matrix.json
```

Also open the STL and look at it from the top, underside, front and side. Automated checks do not judge whether a robot looks like a robot, whether a figurine's face points the intended way, or whether fingers can grip it.

A part is digitally conforming only when:

- the generator-derived `design_status` is `verified`;
- no `block`-severity check fails;
- the small-parts result is not `marginal`;
- every Large part is `above_cylinder`;
- every mating feature has been fit-measured;
- the assembly gate and full selftest pass.

`warn` and `info` results must be understood and recorded; they are not a licence to ignore the underlying issue. `F1_printed_fit` and `F2_breakage` will remain `pending`. That is correct.

### Failure triage

| Failure | First things to inspect |
| --- | --- |
| `G1_watertight`, `G2_winding` | Boolean construction, degenerate profiles, coincident faces, invalid extrusions or hull inputs |
| `G3_single_body` | Decorative pieces that do not volumetrically overlap; split into separate parts if they truly are separate |
| `G4_on_bed` | Assembly/print frame: translate the root or return the correct `print_rotation_deg` |
| `G5_fits_bed` | Overall envelope, print orientation, or split the design into an assembly |
| `P1_no_supports` | Underside angles, tilt direction, buried roots, teardrop/flats-up bore profiles |
| `P2_bridge_span` | Cavity roofs and flat spans; add taper, ribs or a supported-by-shape roof |
| `P3_wall_min` | Thin walls and decorative details below the printable design minimum |
| `I1_lattice` | A hard-coded pitch or an undeclared interface dimension |
| `I2_connectors_on_part` | Connector frame, grid anchor, omitted cells or geometry missing at a claimed cell |
| `I3_seats_on_reference` | Socket depth, cavity, underside relief or body material colliding with the reference |
| `I4_bore_on_grid` | Bore coordinates, anchor convention, cutter depth or missing material around the bore |
| `I5_pin_fits_bore` | Pin profile, bore class and section dimensions against `interfaces.json` |
| `I6_gear_on_grid` | Module, tooth count, pitch/tip metadata or a non-lattice centre distance |
| `S1_small_part_screen` | Overall envelope and age class. Resize decisively; never tune by a fraction to sneak through `marginal` |
| `T1_fit_as_designed` | Cavity/tube/profile geometry or an unmeasured mating feature. Do not add a local clearance fudge |
| `T2_fit_tolerance_window` | Fit sensitivity to printer error. Fix the geometry or escalate an interface decision with impact data |
| `M1_manifest_schema` | Catalog fields, connector shape or `extras` that do not match `part_manifest.schema.json` |
| Assembly `size_mismatch`, `misaligned`, `floating`, `collision` | Wrong size class, connector, cell or rotation; use `attach()` instead of coordinates |
| Assembly `profile_mismatch`, `gear_mesh_distance`, `unsupported_pose` | Wrong pin/bore pair, flats orientation, gear centre distance or an invalid tipped Snap pose |

Do not weaken a check, change its severity, broaden a tolerance or mark a physical check passed to make one part go green. Those are standards changes and need impact analysis plus a design-log entry.

## 7. Prove assembly compatibility

A standalone green part is not yet a compatible system part. Build at least one representative design for each new connector pattern, moving joint or unusual envelope. Never hand-place it with coordinates when a connector exists.

```python
from toyventor_assembly import Library, place, attach, place_on_axis, validate

lib = Library("out/toyventor_parts.json")
plate = place("mini_plate", pid="plate")
antenna = attach(
    lib, plate, "top_studs",
    "moon_antenna", "under_sockets",
    parent_cell=(0, 0), child_cell=(0, 0), pid="antenna",
)
result = validate(lib, [plate, antenna])
assert result["ok"], result["errors"]
```

For pins, shafts, wheels and hinge pins, use `place_on_axis()` where the axis is not vertical. For a robot, build the whole intended chain: mount → structure → joint → moving member → end effector. Check travel and collisions at the poses the design claims to support; one static pose does not prove a hinge range.

Add durable coverage when the risk is new:

- Add a `valid_<name>` case to the assembly demos for a new mating pattern, axis or mechanism.
- Add an `INVALID_<name>` case when a plausible misuse must be rejected (wrong profile, wrong size, gear spacing, tipped Snap part).
- Extend selftest fixtures when a new check or connector class needs proof that it can both pass and fail.
- For an ordinary family variant using an already-proven connector, the generator's reference seating plus the catalog-wide fit matrix may be enough; do not add redundant demos just to increase count.

Compatibility acceptance for the part:

- Every claimed connector appears in `out/connection_graph.json` with at least one intended partner, unless it is deliberately a scan/mount interface handled outside the catalog graph.
- Every relevant row in `out/fit_matrix.json` is `as_designed: true`.
- No connector is listed as an orphan without a documented reason.
- At least one end-to-end build seats on its intended parent (plate, brick, mount, beam or shaft) with `validate(...)["ok"] == True` and no unexplained warnings.

## 8. Promote the passing model into the tracked package

The nested PartSpec package tracks generated artifacts in its root, and the app bridge reads them there. After the scratch `out/` gate is green, rerun the same sequence with the package root as the output location:

```bash
python toyventor_parts.py .
python toyventor_assembly.py .
python make_standard.py INTERFACE_STANDARD.md
python make_agents.py .
python make_catalog.py .
python make_specs.py .
python selftest.py .
```

Then refresh the outer committed snapshot and inspect both diffs:

```bash
cp specs/*.md ../specs/
git status --short
cd ../../..
git status --short
```

Review generated diffs as evidence, not as nuisance. In particular:

- Did only the intended STL and manifest rows change?
- Did an interface edit move other parts' fit windows or statuses?
- Did `CATALOG.md`, `AGENTS.md` and the interface standard pick up the new part exactly once?
- Are old STLs removed when a part is renamed or retired, rather than left as orphans?
- Is any generated file missing because a command was run against the wrong output directory?

Add a dated entry to `docs/PartSpec/pkg/DESIGN_LOG.md` when the change makes a real design decision: a new interface, a changed number, a catalog replacement/expansion, a safety interpretation, or a naming/originality call. Routine family variants that follow existing decisions do not need a new essay; the catalog `note` should carry their local rationale.

PartSpec is a standalone nested repository. Commit inside `docs/PartSpec/pkg` separately from the app repository when asked; never assume an app-repo commit captured it, because the outer repo ignores `pkg/`.

## 9. Bridge to the app only when that is in scope

A verified PartSpec part is not automatically visible in the app. The current bridge is deliberately fail-closed:

- Snap lines only; Pro and shared mount parts are skipped.
- `design_status` must be `verified` and the manifest must point to a printable STL.
- Stats map only on exact names: `Speed → speed`, `Spin → spin`, `Torque → torque`, `Glow → glow`.
- The numeric stat value is currently a placeholder (`1`), so bridged gameplay strength is not designed yet.
- Behaviour text and safety warnings have no app `Part` field today and are dropped by the bridge. A PartSpec set must not ship to users until safety text has a real home in the app contract.
- The bridge writes only the approved `DEMO_SUBSET_IDS` into `sets/partspec-demo.json`; app screens still import `sets/base.json`.

For a bridge-demo candidate:

1. Add its PartSpec ID to `DEMO_SUBSET_IDS` in `shared/partspec.ts` only with product approval.
2. Run `npm run bridge` from the repository root and read every skipped-part reason. Do not add a guessed stat mapping to make it convert.
3. Add or update focused tests in `tests/partspec.test.ts` when converter behaviour changes; an ordinary already-supported part should not need a bespoke converter test.
4. Run the app gate:

   ```bash
   npm run validate
   npm run typecheck
   npm test
   npm run build
   ```

5. Treat STL/GLB publication as a separate acceptance step. `npm run bridge -- --copy-stl` copies the demo STLs, and `scripts/stl_to_glb.py` accepts both ASCII STL (the app lane) and binary STL (PartSpec/manifold3d), covered by `tests/stl-to-glb.test.ts`. Generate the part's GLB and open it in the viewer path before claiming it is AR-ready; a bridged set entry and a downloadable STL do not prove that by themselves.
6. Making a bridged set user-visible is a further product change: screen imports, tray/asset mapping, stat value, safety copy, saved-build compatibility and lattice migration all need explicit work. A green bridge alone does not ship the part.

## 10. Print it with its mates

Digital verification ends at targets. Print the smallest useful physical set:

- the new part;
- one reference mate for every connector type it claims;
- the intended parent (plate, brick, mount, beam or shaft) if that interface is new or changed;
- for a robot, enough of the assembly to exercise every joint and travel limit.

Use the settings from the relevant line spec (0.4 mm nozzle, 0.2 mm layers, no supports; Snap at least 3 walls, Pro 3–4 walls, 15–20% infill, PLA unless the part decision says otherwise). Print in the manifest orientation.

Copy this record into the journal, issue or PR for every physical attempt, including failures:

```md
## Print record — <part_id> attempt <n>

- Date / operator:
- PartSpec commit or source state:
- STL filename(s), including mates:
- Printer, nozzle, material, layer height, walls, infill:
- Slicer profile and applied surface-size offsets:
- Manifest fit window:
- First-layer/bed result:
- Supports needed? Where?
- Seat test (each mate): clicks / loose / tight / does not seat
- Removal and wobble:
- Direction lock / joint travel:
- Repeated attach-remove result and visible wear:
- Drops, pulls or breakage observed (internal observation, not certification):
- Any broken fragment and its size:
- Photos/video links:
- Decision: pass / adjust printer offset / adjust part / adjust interface / reject design
- Follow-up owner:
```

Interpret failures at the right layer:

- **Everything is uniformly tight or loose:** printer surface offset/calibration first.
- **Only this part is wrong:** its cavity, profile, wall or connector geometry.
- **Several unrelated parts moved together:** suspect the interface or fit data; run the index impact query before changing it.
- **It fits but is hard for the intended hands to use:** product failure, even if tolerances pass.
- **It breaks into a small piece:** stop. Redesign before any child-facing use; do not solve it with warning text alone.

Record physical results honestly. Do not edit `F1_printed_fit` or `F2_breakage` to passed by hand; they change only when the project defines and implements how real evidence enters the model. Under-3 use additionally requires professional/lab toy-safety testing before sale.

## 11. Release checklist

Copy this into the task or PR and tick only what was actually observed:

```md
### New part acceptance — <part_id>

Brief and catalog decision
- [ ] Part brief completed; target stage stated
- [ ] Existing part/assembly alternatives considered
- [ ] Catalog slot approved: replacement / expansion / existing-parts build
- [ ] Original name and design; no third-party system or franchise names

Digital compatibility and conformity
- [ ] Catalog row reviewed (one stat, behaviour, tags, build parameters)
- [ ] Builder derives interface dimensions from interfaces.json
- [ ] Generator reports design_status: verified
- [ ] No blocking checks; warnings explained
- [ ] Small-parts status is not marginal; Large is above_cylinder
- [ ] Each claimed mate is in the fit matrix and as_designed
- [ ] Representative assembly validates with no unexplained warnings
- [ ] Full PartSpec selftest passes

Publication inside PartSpec
- [ ] Root artifacts regenerated and diffs reviewed
- [ ] CATALOG.md, AGENTS.md and interface standard regenerated
- [ ] docs/PartSpec/specs snapshot refreshed
- [ ] Design-log entry added if a real decision was made
- [ ] Nested PartSpec repo status reviewed separately

App (only if in scope)
- [ ] Bridge result is ok, or the exact skip reason is accepted
- [ ] No guessed stat mapping; placeholder value called out
- [ ] STL asset present under the bridged part ID
- [ ] GLB actually generated and opened (not assumed)
- [ ] App validate, typecheck, tests and build pass
- [ ] Safety text has an approved user-visible path before shipping

Physical (only claims actually observed)
- [ ] Printed with intended mates using recorded settings
- [ ] Fit, direction lock, motion and removal tested
- [ ] Wear/breakage observations and photos recorded
- [ ] F1/F2 still reported as pending unless the model has a defined evidence path
- [ ] Age grading and print-page warning reviewed
```

## 12. Handoff format for recurring tasks

Finish every part task with evidence, not a status adjective:

```md
Part: <id> — <name>
Route: family variant / bespoke Snap / Pro builder / assembly / standards change
Catalog action: replaced <id> / approved expansion / no new slot

Changed sources:
- ...

Digital evidence:
- Generator: <PASS/FAIL lines and design_status>
- Dimensions / volume:
- Connectors:
- Fit window and measured pairs:
- Safety screen:
- Assembly cases:
- Selftest: <pass count / failures>

App evidence (or "not in scope"):
- Bridge result or exact skip reason:
- App ID, footprint, stat:
- STL/GLB/assets:
- App checks run:

Physical status:
- Not printed / printed (link to print record)
- F1/F2 remain pending unless formally closed elsewhere

Unverified or blocked:
- ...
```

A useful future request is therefore short: “Create `<part>` by following `docs/creating-parts.md`; take it to `<digital verified / app-bridged / print candidate>` and report with the handoff format.” The standard still governs the numbers; this guide governs the work.
