# Creating new parts

Use this guide for every recurring part task: robot parts, figurines and
character add-ons, capsules, bricks, mounts, and Motion mechanisms. It takes an
idea from brief to a compatible, conforming, testable part.

It does **not** replace the standards. If anything conflicts, standards and
data win:

1. Product behaviour: [spec.md](../product/spec.md), then [snap.md](snap.md)
   or [motion.md](motion.md).
2. Part numbers, checks, interfaces and warnings:
   [`interfaces.json`](../../parts/partspec/interfaces.json).
3. PartSpec rules: the [Interface Standard](partspec/specs/01_interface_standard.md),
   then the relevant line spec.
4. Live catalog workflow: the generated [agent
   instructions](partspec/specs/06_agent_instructions.md); regenerate, do not edit.

## Current lane rule

New geometry goes in **PartSpec**, the TU-lattice Python system under
[`parts/partspec`](../../parts/partspec/INTERFACE_STANDARD.md). Do not create
new parts in the frozen OpenSCAD app lane (`parts/scad/`, 16/32 mm) unless Dan
explicitly asks for emergency maintenance of the current demo.

## What “finished” means

Do not use these stages interchangeably:

| Stage | Meaning | Evidence required |
| --- | --- | --- |
| Modelled | A shape exists in code | Builder runs and exports a mesh |
| Compatible | It truthfully mates through typed connectors | Assembly validation and measured fit matrix pass for its claimed mates |
| Conforming | It satisfies the digital PartSpec gate | Generated `design_status` is `verified`; the full selftest passes |
| App-bridged | The app can represent it | `npm run bridge`, set validation, bridge tests and app checks pass |
| Print-tested | It has survived a real printer and mate | Print record for `F1_printed_fit`, plus breakage observations for `F2_breakage` |
| Release-ready | It may be offered to users | Print evidence, correct age grading and warnings, and any required professional/lab safety review |

Compatibility is about **connections**. Conformity is about the **whole rule
set**: geometry, printability, interfaces, measured fit, metadata and safety
screening. Neither word means “safe” or “certified.”

## Fast path

For an ordinary new part:

1. Complete the brief and resolve the catalog slot.
2. Run the untouched PartSpec gate in a scratch output directory.
3. Copy the nearest suitable catalog row and builder pattern.
4. Add the row and, only if needed, a bespoke builder.
5. Regenerate until the new manifest entry is `verified`.
6. Validate at least one real assembly and every claimed fit pair.
7. Promote regenerated artifacts to the package root and refresh the docs snapshot.
8. Bridge to the app only if the brief requires it, then print with its mates
   before calling it release-ready.

## 1. Start with a part brief

Copy this into the task, issue or working notes before modelling. Do not leave
the target stage or catalog slot implicit.

```md
## Part brief

- Working name:
- Proposed catalog ID:
- One-sentence job:
- New part, variant, replacement, or assembly of existing parts:
- Line and age group: Snap Small (3+) / Snap Large (youngest) / Motion (8+) / Pro (10+)
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

The selftest enforces the catalog targets in `catalog.json` — read the current
Snap/Motion/Pro targets there, not here. A new row added casually will fail that test. Choose one
route explicitly:

| Route | Use when | Required product action |
| --- | --- | --- |
| Build from existing parts | A robot or scene can be assembled from catalog parts | No new catalog slot |
| Replace a row | The new part supersedes an existing planned part | Record why in the design log; retire or rename deliberately |
| Expand the catalog | This is an approved new set/wave | Update the target and wave plan as one coherent product change; do not bump a number only to silence the test |
| Experiment outside the catalog | You are exploring a shape or mechanism | Keep it clearly labelled experimental; it is not a conforming catalog part and cannot be bridged or shipped |

Do not reuse a retired part ID for different geometry. Part IDs are
compatibility contracts once anything references them.

## 2. Choose the implementation route

| Request | Route | Primary files |
| --- | --- | --- |
| Brick, plate, tile, slope or dome variant | Existing `block`, `tile`, `slope` or `dome` family | `catalog.json` row only |
| Snap figurine shell, robot head/body, wing, tail, ears or capsule | Bespoke Snap builder, usually with an integrated base | `toyventor_parts.py` + `catalog.json` |
| Posable or driven robot | Assembly of Motion beams, pins, shafts, hinges, gears and wheels | `toyventor_assembly.py`; add a new Motion part only if a real joint is missing |
| New Motion beam, gear, wheel or joint | Existing Motion builder with parameters, or a new Motion builder | `toyventor_motion.py` + `catalog.json` |
| Scanned-toy attachment | Forge Mount family/spec, generated for the toy where applicable | `toyventor_parts.py`, Forge Mount spec; do not invent a drilled/custom interface |
| Cross-line connection | Existing Snap-to-Motion adapter or Forge Mount | Assembly plus fit matrix |
| New connector or interface | Standards change, not just a new part | `interfaces.json`, connector helper, fit measurement, validator, fixtures/selftests and a design-log decision |
| Texture/skin only | Game/AR asset, never a printed part | App asset pipeline; do not add a printable catalog row |

### Robots and figurines: choose the right abstraction

- A **static figurine** that sits on a toy is normally one Snap add-on with an
  integrated base.
- A **posable robot** is normally an assembly. Model each joint with existing
  pins, shafts, hinges or cross connectors and validate the assembly. Do not
  fake articulation by placing disconnected meshes near each other.
- A **driven robot** needs its shaft, gear, rack or wheel centre distances
  designed on the TU lattice from the start.
- A **full character made of several bespoke pieces** is several parts plus an
  assembly recipe. Each piece needs its own catalog decision and physical
  connectors.
- For Large/under-3 use, prefer one chunky piece. Removable pins, small limbs
  and break-off details need explicit safety justification and still require
  professional/lab review before sale.

### Shared character anatomy

Snap fixed-pose figures and Motion articulated figures are two expressions of one
anatomy, not separate character systems. Use the same named roles for heads,
torsos, limb segments, tails, accessories and end effectors across humans,
animals and robots.

- Give every bespoke character piece typed connectors for every join it claims.
  A posed collection of meshes with missing connector metadata is only
  modelled; it is not compatible or conforming.
- Reuse a shared head/accessory interface where scale is physically sound.
  Otherwise make the adapter itself a declared, fit-measured part. Never call a
  head cross-line compatible from matching visual proportions.
- Keep humanoid proportions, joint names and axes mappable to a standard
  animation rig, and record non-obvious axis or facing conventions in the
  catalog note or assembly recipe.
- A claimed shared module needs a validated assembly on each supported line;
  a moving Motion figure needs the same travel and collision checks as any joint.

## 3. Set up and establish a clean baseline

PartSpec lives directly in `parts/partspec/` inside this repository. Check git
status before editing so concurrent work is not mistaken for yours:

```bash
cd "$(git rev-parse --show-toplevel)"
git status --short
cd parts/partspec
```

Create the Python environment inside the PartSpec package if it does not already
exist:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Use that activated environment for every PartSpec command below. If the
untouched baseline is not green, stop and record the failures before changing
anything. Do not let a new part inherit blame for pre-existing breakage.

Use a scratch output directory while iterating:

```bash
python toyventor_parts.py out
python toyventor_assembly.py out
python make_standard.py out/INTERFACE_STANDARD.md
python make_agents.py out
python make_catalog.py out
python selftest.py out
```

Then inspect before inventing:

```bash
python toyventor_index.py out list
python toyventor_index.py out used-by stud_small
python toyventor_index.py out uses cloud_wings
python toyventor_index.py out impact stud_small
python toyventor_index.py out checks S1_small_part_screen
```

Read the closest existing catalog row, its builder, its generated manifest
entry and at least one assembly using the same connector pattern.

## 4. Add or change the catalog row

Add the row before polishing geometry. A bespoke Snap add-on row has this
shape (replace all placeholder values):

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

- `id`: stable lowercase `snake_case`, unique, descriptive and free of
  third-party names. Once referenced, treat it as permanent.
- `line` + `size` must agree (`snap` = `small` or `large`; `pro` = `pro`).
- `family`: use an existing family. A new family is a standards change.
- `stat`: exactly one PartSpec stat label; for immediate app use choose
  `Speed`, `Spin`, `Torque`, or `Glow`, or record a game-design decision.
- `behavior`: one concrete sentence; it documents intent, not implementation.
- `tags`: lowercase discovery terms; reuse nearby vocabulary.
- `note`: engineering facts a future maintainer needs.
- `wave`: approved expansion wave only; retain the replaced part’s wave on
  replacement.
- `build`: parameters only; no undeclared interface, connector, or check ID.

Family variants need less: a new `block` row supplies `build.kind` and
`build.grid`; `tile` and `dome` need a grid; `slope` may need `angle_deg`. A
parameterized Motion row names an existing builder and arguments, such as
`{"fn": "beam", "length_tu": 5}` or `{"fn": "spur_gear", "teeth": 20}`.

## 5. Implement geometry and connectors together

Edit sources only:

- `parts/partspec/catalog.json` — catalog row and approved targets/waves
- `parts/partspec/toyventor_parts.py` — Snap builders and shared generator logic
- `parts/partspec/toyventor_motion.py` — Motion builders and mechanical primitives
- `parts/partspec/interfaces.json` — only for an approved standards change
- `parts/partspec/toyventor_fit.py`, `toyventor_assembly.py` or
  `toyventor_index.py` — only when a genuinely new mating feature must be
  measured or validated
- Human-authored package docs — only when the product rule or decision itself
  changes; never edit assembled copies under `docs/parts/partspec/specs/`

Never hand-edit generated STLs, manifests, indexes, agent/catalog/standard
outputs, or assembled specs. Change the source and regenerate.

### Snap bespoke builder pattern

Follow the existing bespoke pattern: derive interface dimensions from `p`,
`IF`, `LIM`, and `FIT_SEG`; build the body in the assembly frame; and finish
with `_finish()` so foot/integrated sockets and connector metadata are created
together.

- Never hard-code footprint, pitch, stud/hole diameter, or fit values.
- Pick one decorative-body scaling convention per builder and state it.
- Keep walls, clearances, fillets, and embed depths print-limited; do not scale
  them with decoration.
- Bricks/plates use the full square foot and socket cavity; tube-grip Snap
  socket grids are at least 2×2.
- Add-ons default to integrated bases; use `pad` on real lattice points when a
  thin body cannot wrap a hole.
- Facing direction needs `lock: true` with two full holes, or one full hole
  plus relief. Round parts may intentionally rotate; say so.
- Keep square Small 2×2 parts under about 25 mm tall or use a larger foot.
- Round outlines are female-only unless a fit-measured design proves otherwise.
- For Small/Large pairs, reuse one builder where practical but gate both rows
  separately.

### Motion builder pattern

Prefer an existing `toyventor_motion.py` builder: `beam`, `beam_cells`,
`beam_path`, `free_pin`, `shaft`, `friction_pin`, `bushing`, `spur_gear`,
`ring_gear`, `rack`, `wheel`, `hinge_leaf`, or `cross_connector`.

For a new builder, use the bore/pin helpers, return `(manifold, connectors,
extras)` with connector metadata mirroring real holes and pins, return print
rotation only when orientation truly differs, use complete gear metadata on the
TU lattice, use teardrop/flats-up horizontal bores, and validate joint axis,
travel, clearance, and collisions.

### New interface or connector: stop and treat it as a standards change

A new mating feature needs a recorded decision, interface/tolerance changes,
non-drifting helper code, fit measurement, assembly/index rules, positive and
negative fixtures, and a physical print probe. Without all seven, the
connection is unverified.

### Geometry rules that catch most failures early

- Return one connected solid; bury roots and keep shallow undersides supported.
- Avoid downward faces steeper than 45 degrees except within the tiny gate
  tolerance; keep flat bridges within limits.
- Round exposed edges; avoid spikes, knife edges, brittle cantilevers, and
  inaccessible voids.
- Do not use text as the only small orientation cue.
- Keep decorative overhang inside a sensible toy/printer envelope.

## 6. Iterate against the digital gate

Stay in the scratch `out/` directory until the part is digitally clean:
rerun the section 3 sequence above. Then
inspect the manifest entry, fit pairs, and STL from all sides. A part is
digitally conforming only when its generator status is `verified`, no blocking
check fails, small-parts is not marginal, Large clears the cylinder, every
mating feature is measured, and assembly plus selftest pass. Physical `F1`/`F2`
correctly remain pending.

### Failure triage

Group failures by layer before changing geometry:

- Geometry/watertight/body/bed: boolean construction, disconnected pieces,
  assembly/print frame, envelope, or orientation.
- Printability: underside angles, roofs/spans, thin walls, lattice/interface
  dimensions, connector frames, seating, bores, pins, gears, small-parts band,
  fit windows, or schema mismatch.
- Assembly: size/connector/cell/rotation, pin-bore pairing, gear distance, or
  invalid pose.
- Product: usable by intended hands; breakage into a small piece stops
  child-facing use.

Do not weaken a check, broaden a tolerance, or hand-pass a physical check to
make one part green. Those are standards changes with impact analysis and a
design-log entry.

## 7. Prove assembly compatibility

Build at least one representative design for each new connector, joint, or
envelope using connectors—not coordinates—and validate it. For moving robots,
check travel and collisions at every claimed pose. Add durable valid/invalid
demo cases and selftest fixtures only when the risk is new.

Acceptance requires every claimed connector to have an intended partner in the
connection graph, relevant fit pairs marked as-designed, no unexplained orphan
or warning, and one end-to-end build seated on its parent.

## 8. Promote the passing model into the tracked package

`parts/partspec/` tracks manifests and markdown while STL meshes stay ignored;
the app bridge reads them there. After the scratch gate is green, rerun the
same sequence with `parts/partspec` as output, including `make_specs.py .`:

```bash
python toyventor_parts.py .
python toyventor_assembly.py .
python make_standard.py INTERFACE_STANDARD.md
python make_agents.py .
python make_catalog.py .
python make_specs.py .
python selftest.py .
cd ../..
git status --short
```

Review generated diffs as evidence: only intended rows changed, no interface
edit moved unrelated statuses, catalog/agent/standard/spec outputs updated
exactly once, and no output went to the wrong directory. Add a dated design-log
entry only for a real design decision.

## 9. Bridge to the app only when that is in scope

A verified PartSpec part is not automatically visible in the app. The bridge is
fail-closed:

- Snap and Motion parts convert through the canonical bridge; skips need accepted
  reasons.
- `design_status` must be `verified` and the manifest must point to a printable
  STL.
- Stats use the mapped game values; safety and behavior text must have a real
  app home before shipping.
- The bridge writes only the approved sets; it removes obsolete demo payloads.

For a bridge candidate, run `npm run bridge` from the repository root, update
focused converter tests only when behavior changes, run validate/typecheck/
tests/build, generate and actually open the GLB before claiming AR readiness,
and treat user visibility as a separate product change.

## 10. Print it with its mates

Print the smallest useful physical set: the part, one reference mate per
connector, the intended parent for new/changed interfaces, and enough of a
robot to exercise every joint and travel limit. Use the line’s nozzle/layer/
support/wall/infill/material settings in manifest orientation.

Copy the print record below into the journal, issue, or PR for every attempt,
including failures:

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

Interpret tight/loose/unrelated movement at the printer, part, or interface
layer. Record honestly; never hand-pass `F1_printed_fit` or `F2_breakage`, and
require professional/lab review before under-3 sale.

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
- [ ] Manifests and generated markdown refreshed in `parts/partspec/` and diffs reviewed
- [ ] `CATALOG.md`, `AGENTS.md` and `INTERFACE_STANDARD.md` regenerated
- [ ] `docs/parts/partspec/specs` snapshot refreshed (`python3 make_specs.py .`)
- [ ] Design-log entry added if a real decision was made

App (only if in scope)
- [ ] Bridge result is ok, or the exact skip reason is accepted
- [ ] No guessed stat mapping
- [ ] STL asset present under the bridged part ID
- [ ] GLB actually generated and opened (not assumed)
- [ ] App validate, typecheck, tests and build pass
- [ ] Safety text has an approved user-visible path before shipping

Physical (only claims actually observed)
- [ ] Printed with intended mates using recorded settings
- [ ] Fit, direction lock, motion and removal tested
- [ ] Wear/breakage observations and photos recorded
- [ ] F1/F2 still reported as pending unless formally closed elsewhere
- [ ] Age grading and print-page warning reviewed
```

## 12. Handoff format for recurring tasks

Finish every part task with evidence, not a status adjective:

```md
Part: <id> — <name>
Route: family variant / bespoke Snap / Motion builder / assembly / standards change
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

A useful future request is therefore short: “Create `<part>` by following
`docs/parts/creating-parts.md`; take it to `<digital verified / app-bridged /
print candidate>` and report with the handoff format.” The standard still
governs the numbers; this guide governs the work.
