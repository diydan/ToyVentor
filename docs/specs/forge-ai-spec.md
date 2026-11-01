# Forge AI and assists: prompt workflows first, custom models on a gated roadmap

## Status

**Proposed.** Written 2026-10-31, extended the same day with four assist
features (A1, A2, A4, A5), and on 2026-11-01 with a fifth (A6, failed-print
triage) and a print-optimisation scope note. Nothing here is built except the pieces listed under
"Already in the repo". No custom model is in scope for the Nov 4 build. After
submission, two own-model tracks (a Forge recipe writer and a brick sculptor)
are planned behind explicit gates; see "Custom model roadmap". The prompt
workflows stay as the fallback throughout.

## One-paragraph version

Five AI features share one engine. A hosted Muse Spark call proposes a small
JSON **recipe** (never a mesh, never code). Deterministic code legalizes it,
the existing Python gates build and verify it, and a repair loop feeds
structured gate failures back until it passes or falls back to something
usable. Every attempt is logged, so the eval harness can say, with numbers,
whether a custom model would ever be worth it.

Five smaller assist features (scan assist, build coach, speech edits,
kit-card text, failed-print triage) follow one rule: the model supplies words or a choice
among enumerated options, and code supplies every fact and every action. They
need no Python validator, each has a no-model fallback, and the first two can
ship from the Worker alone.

This keeps the standing rule in [spec.md](../product/spec.md) true in spirit:
part geometry is built by gated, deterministic code. The model only chooses
parameters. The "never model-generated" wording in that spec must be updated
when this ships (see "Docs impact").

## The five features

| # | Feature | Input | Output | Model's job | Deterministic job |
| --- | --- | --- | --- | --- | --- |
| F1 | Describe it | Short text, optional slot | Verified printable accessory | Pick slot, write recipe | Legalize, build, gate |
| F2 | Scan it, wear it | Photo of any object | Accessory shaped like the object | Name it, pick role and slot, add allowed features | Mask to profile to recipe, gate |
| F3 | Repair loop | A failing recipe plus gate report | A passing recipe | Patch parameters | Hint table, legalizers, retry limits |
| F4 | Fits this one | Description plus a host (head, vehicle) | Accessory that seats on that host | Shape for the envelope numbers it is given | Host check through the assembly gate |
| F5 | Build planner | Goal text plus current build | Ordered, valid build | Choose parts from a compact catalog | Retrieval, assembly validation |

F3 is not a separate screen. It is the engine F1, F2, F4 and F5 all run on.

The assist features (detailed after the Forge sections):

| # | Feature | Model chooses or writes | Code guarantees | Fallback if the model fails |
| --- | --- | --- | --- | --- |
| A1 | Scan assist | Ranked nouns for SAM | The SAM mask | Client noun as today, with photo-derived features off |
| A2 | Build coach | A kid-friendly sentence | Check results, the legal fix, the applied action | One template line per check id |
| A4 | Speech or typed edits | Intent parsed into enumerated ops | Placement, legality, preview then apply, undo | Tap or typed catalog search |
| A5 | Kit-card step text | Optional age-band rewrite | Step order, part names, fixed warning text | Template steps |
| A6 | Failed-print triage | One cause id from a closed list | The fix card for that cause and slicer; no setting comes from the model | Manual symptom picker |

## Already in the repo (do not rebuild)

- `parts/kip/sdk/kip_partspec_sdk.py`: slot builders, helpers, and
  `validate_and_export()` returning a JSON report (`--json`): gate
  failures, small-part screen, brand errors, and a real attach test against
  a reference parent.
- `public/kip/LLM_PART_PROMPT.md` plus `npm run kip:validate-part`: the
  paste-into-any-LLM workflow. Three verified examples in `public/kip/custom/`.
- `public/kip/kip-forge-sdk.js` (Phase 4 forge): SAM mask to traced contour to
  extruded, photo-textured **digital-only** accessory (`prints: false`).
- `worker/meta.ts`: live SAM 3.1 and image edits. `worker/muse.ts`: the
  Responses-API call pattern, low reasoning effort with retry, kid-safety
  prefix, per-IP limit.
- `shared/sam.ts`: mask summary with silhouette path and anchors.
- `parts/partspec/ai_catalog.txt` (180 lines, 24 KB: id, line, size, tags,
  stat, connectors) and `build_examples.json` (38 builds, valid and
  deliberately invalid).
- `shared/partspec.ts`: `convertPartSpecPart` bridges a verified part into the
  app's part model.
- `shared/checks.ts` (`runChecks`, results shaped `{id, label, pass, detail}`
  for on-grid, fits-toy, support-free, fits-bed) and `shared/build.ts`
  (`canPlace`, `findPlacement`, `snapMm`, `buildStats`): the builder's own
  deterministic checks and placement helpers. The assist features build on these.
- `worker/index.ts` `handleScanPost`: takes a client-supplied `prompt` noun
  (at most 60 characters) with the image and calls `segmentToy`.
- [play-design-spec.md](play-design-spec.md): the nine-step level drafting
  pipeline that level review follows.

## Shared engine

### Recipe v1 (the only thing the model emits)

JSON, schema-validated in TypeScript and again in Python. Unknown keys are
rejected, numbers are clamped to bounds, and nothing is executed.

```json
{
  "v": 1,
  "id": "wizard_hat",
  "name": "Wizard Hat",
  "stat": "Glow",
  "behavior": "Tall hat that clicks onto the crown studs",
  "slot": "crown",
  "host": "char_head_kid",
  "shape": { "kind": "loft",
             "slices": [ { "z": 0, "w": 23.4, "d": 11.4, "r": 4.6 } ] },
  "features": [ { "op": "brim", "radius_mm": 16, "thickness_mm": 2 } ]
}
```

- `slot`: `crown | head | back | hand | front | rollbar | spoiler | hood | roof | exhaust`
  (the builders already in the SDK prompt table).
- `shape.kind`: `loft` (3 to 12 slices, all slots except hand), `profile2d`
  (hand slot, polygon in x,z), `star2d`.
- `features`: at most 6, from an allowlist (`brim`, `knob`, `ears`, `fin`,
  `antenna`, `band`). Each is a parametric op with bounded numbers, so the model
  can add character without being able to break geometry.
- `id` gets a `custom_` prefix server-side. `stat` is one of Speed, Spin,
  Torque, Glow. Brand terms are rejected before and after the model call.

### Pipeline (every feature)

1. **Intake.** Length cap, kid-safety rules, brand-term filter (TypeScript
   mirror of the SDK's `FORBIDDEN_BRAND_RE`).
2. **Propose.** Muse Spark through the existing Responses API pattern in
   `worker/muse.ts`, structured JSON output against the Recipe schema, low
   reasoning effort first. Prompt = adapted `LLM_PART_PROMPT.md` + the three
   verified examples + one example per slot builder + host numbers if any.
3. **Legalize (no model call).** Deterministic fixes applied before any
   gate runs:
   - L1 slope clamp: outward growth per side <= 0.78 x dz between slices
     (the P1/P4 rule from the prompt).
   - L2 size band: if the minimum enclosing cylinder lands in the
     small-parts marginal band, move it out by the smaller change
     (< 29.5 mm or > 36.0 mm guidance), never below the slot pad.
   - L3 clamp every number to the slot's bounds.
   Ship L1 and L2 first. Add more only when the eval shows a gate dominating.
4. **Build and gate.** Python compiler (`forge_recipe.py`) turns the recipe
   into an SDK `part_spec` and runs `validate_and_export()`. Output is the
   slim JSON report plus STL and manifest on success.
5. **Repair (F3).** On failure, send the model only the structured failures
   (gate id, detail, measured value versus limit, plus the matching line from
   a hint table) and ask for a corrected recipe. Effort rises to medium on
   attempts 2 and 3. Hard cap: 4 model calls per job.
6. **Always end with something usable.** If the cap is hit: F1 and F4 offer
   the closest ready-made catalog part (retrieval over `ai_catalog.txt`); F2
   falls back to the existing digital-only accessory; F5 returns the nearest
   verified `build_examples` build. A kid never sees a dead end.
7. **Bridge.** A verified result passes through `convertPartSpecPart` so the
   builder, Toybox and Kip viewer treat it like any other part, tagged
   `custom`.

### Gatekeeper (where Python runs)

The gates are Python and `manifold3d`; they cannot run in a Worker. Options:

| Option | Verdict |
| --- | --- |
| A. Local validator server (`scripts/forge-serve.ts` wrapping `forge_recipe.py`), Worker proxies when `FORGE_VALIDATOR_URL` is set | **Phase 0/1.** No new infra, works for the Nov 4 demo and for pre-generating a showcase set. |
| B. Cloudflare Container or Sandbox running the venv | **Phase 1b.** Same HTTP contract as A, so swapping is config. |
| C. Port gates to TypeScript with `manifold-3d` WASM | **Rejected.** Large port, and a second copy of the gates will drift from the Python source of truth. |

The contract is a pure function: `POST /validate {recipe, host?}` returns the
slim report. Jobs are asynchronous (`POST /api/forge` returns `jobId`; poll
`GET /api/forge/:id`) with stages `queued, proposing, checking, repairing,
done, failed`. A job is several calls long, far past the 13 s single-call
budget in `muse.ts`, so the UI shows staged "Forging..." progress. The wait
is part of the experience, not a bug.

### Guards

- Kid-facing safety prefix reused from `muse.ts`; recipe text fields are
  re-checked after the model returns.
- Rate limit: tighter than the Create-mode 10/min/IP because one job is up to
  4 model calls plus validation. Proposal: 3 jobs/min/IP and a per-device daily
  cap, enforced by a Cloudflare rule as `spec.md` already does for Spark.
- Model-written Python is never executed server-side. The dev CLI may run
  trusted local scripts; the production path accepts JSON only.
- Photos: SAM sees the image (existing path); A1 adds a Spark vision call on
  the same approved endpoint. The Forge recipe calls receive numbers (profile,
  anchors) as text only. No photo is stored.
- Logging: recipe, per-gate outcome, attempt count and latency. Free-text kid
  prompts are not stored, and no prompt hash is kept. Prompt text is stored
  only for the internal eval set.

## F1: Describe it

- **Flow:** text in, slot inferred if not given, pipeline above, verified STL
  plus preview on the equipped host.
- **Fastest cut:** the prompt and validator already exist. Phase 0 is just the
  Recipe schema, `forge_recipe.py`, and a CLI loop (`npm run forge:run`)
  that calls Spark and writes verified parts to `public/kip/custom/`.
- **Acceptance (targets, to be confirmed by the first eval run):**
  - >= 80% of the eval prompts end verified within 4 model calls.
  - 0 brand-term violations in shipped output (hard requirement).
  - No code-execution path in the production route.

## F2: Scan it, wear it

Two outputs from one scan. The digital accessory already exists. The new part
is the **printable** one.

- **Extend the scan summary** (`shared/sam.ts`, `worker/meta.ts`): add a
  normalized width profile, about 32 to 48 rows of half-widths, and a
  simplified contour polygon, both computed from the already-decoded mask in
  the Worker. The current `silhouette` is a coarse path meant for display, not
  for geometry.
- **Deterministic shape first.** Profile to `loft` slices (revolve-like
  objects: cup, bottle, bowl, bell) or contour to `profile2d` (flat objects:
  drawings, swords, wings). The model does not redraw the shape. It chooses the
  role, the slot, the name, a stat, whether to invert the profile, and
  allowlisted features.
- **What "cup into X" honestly means:**

  | Target | How |
  | --- | --- |
  | Hat | Cup profile (optionally inverted) as a `crown` loft |
  | Character | Cup profile as a `head` (neck collar added by the builder) or `back` piece. Not a full ball-jointed figure. |
  | Car | A `hood`, `roof` or `front` shell on a vehicle. Not a whole chassis. |

- **Honest claims:** only gated geometry is called printable. If gates fail
  after legalizing and repair, the existing digital-only accessory is shown
  and labeled digital.
- **Acceptance (targets):** with 10 photos (cup, bottle, bowl, shoe, toy car,
  kid drawing and others) and 3 roles each, >= 70% yield a verified printable
  recipe with no model repair, and 100% yield something usable via fallback.

## F3: Repair loop

- **Inputs:** recipe plus slim report (`blocking_failures`, `small_part`,
  `brand_errors`, `assembly`).
- **Order:** legalizers first (free, instant), then model repair.
- **Feedback format to the model:** per failure, `{gate, measured, limit,
  hint}`. No raw logs. Example hint: "P1: slice 3 grows 6.1 mm per side over
  dz 5.0; limit 3.9. Reduce growth or add slices."
- **Stops:** passes, 4 calls used, or the same gate fails twice on the same
  recipe (no progress).
- **Deliverable beyond the loop:** `npm run forge:repair -- my_part.py` for
  dev use, replacing the manual paste-fix cycle.
- **Metric:** repair success rate per gate id. This tells us which legalizer
  to write next.

## F4: Fits this one

- **Phase split, because the existing builders only cover part of this:**
  1. *Slot add-ons onto a chosen host.* `validate_and_export()` currently
     attaches to a fixed reference parent per slot. Add a `host` argument
     (default unchanged) so a crown piece is checked against the head the kid
     has equipped, and a vehicle piece against that vehicle. Cheap, uses the
     existing assembly gate.
  2. *Cavity hats that seat over head and wig* (like `hat_ballcap`). The SDK
     has no builder for these. Needs a `hat_shell(body, host)` that subtracts
     the host cavity. Larger change, later.
- **Host envelopes as data.** Export the measured head, wig-vault and
  hat-cavity numbers (today constants in `toyventor_parts.py`) to a generated
  `public/kip/host-envelopes.json` through `kip_partspec.py`. The prompt gets
  these numbers as text. The 0.4 to 0.45 mm clearance rule is applied by a
  legalizer, not left to the model.
- **Guardrail:** the head x wig x hat x plate seating matrix, extended to
  custom parts.
- **Coordination:** other sessions and agents edit `parts/partspec/` and
  `catalog.json`. This spec adds new files and one additive export only. Do
  not touch geometry constants; regenerate into a scratch directory.

## F5: Build planner

- **Retrieval, not a vector database.** The compact catalog is about 24 KB, so
  it goes in the prompt whole (`ai_catalog.txt`), plus the 3 to 5 nearest
  verified `build_examples` builds chosen by tag and stat overlap.
- **Output:** JSON `{say, build:[{id, part, pose:{x,y,z,rot}}]}` in the
  same shape as `build_examples.json`, with part ids constrained to the
  catalog by enum.
- **Validate:** run the assembly validation (same Gatekeeper service) on the
  proposed build. Invalid builds go through the repair loop with the validator's
  error text. The 38 existing examples, including the `INVALID_*` ones, are
  the regression suite.
- **Prefix-keeping repair** (longest-valid-prefix rollback): validate the
  proposed build part by part in order, keep the longest valid prefix, and ask
  the model only to continue from there. Cheaper and more stable than
  regenerating the whole build, and it applies to A4 edits too.
- **Out of scope for the model:** mechanical truth such as steering or
  kinematics. Those stay in the deterministic vehicle checks. The planner picks
  from combinations that already pass.
- **Output also feeds** kit-card step text and kid-facing "why this works"
  lines (short, kid-safety prefix applied).
- **Acceptance (targets):** 30 goal prompts; 100% of returned builds pass
  assembly validation (by construction, since invalid ones are rejected), and
  >= 70% judged "matches the goal" by a human.

## Assist features (prompt workflows, Worker-only)

Shared rule: **the model supplies words or a choice among enumerated options;
code supplies every fact and every action.** Each feature has a no-model
fallback, so a model failure degrades the feature and never breaks the screen.

Shared wrapper (`worker/assist.ts`): one `callMuse()` helper reusing the
`worker/muse.ts` pattern (Responses API, structured JSON output, low reasoning
effort, a per-call timeout, the kid-safety prefix, a brand-term filter on
returned text, the same per-IP limits). On a timeout, malformed JSON or a filter
hit it returns `null` and the caller uses its fallback. A1, A2, A4 and A6 run in
the Worker alone, so they need no validator service.

### A1: Scan assist

- **Problem today:** the client sends the noun SAM searches for (at most 60
  characters). A wrong noun means zero matches (`worker/meta.ts` notes "retry
  with a shorter noun").
- **Flow:** one Spark vision call returns structured JSON:
  `{ nouns: string[] }`. If the client supplied a noun, SAM starts immediately
  and the inspection runs in parallel; otherwise inspect first, then SAM with
  `nouns[0]`. On zero SAM matches, retry the next noun, then a shorter one. All
  retries share one overall time budget, set after measuring.
- **Contract:** `prompt` becomes an optional hint on `POST /api/scan`; the
  response gains `inspect: { nouns, checked }`. `toyventor.toy/1` and
  the toy contract are unchanged.
- **Call failed (`checked: false`):** the outline works as today. Skins and
  photo-derived accessories stay off for that scan.
- **Acceptance (targets):** on 20 staged photos, SAM first-try match rate at
  least equal to the client-noun baseline, with fewer retries.
- **First task:** a one-hour spike on 10 photos to confirm hosted Spark reads
  images through the Responses API. Everything else in A1 waits on this.

### A2: Build coach

- **Trigger:** at least one check fails, or the kid taps "why?".
- **Input:** `{checks: CheckResult[], stats, placements, ageBand}`. Output:
  `{say, highlight?: {partId}}`.
- **Code computes the fix, the model words it.** Candidate fixes come from
  `findPlacement` and `snapMm` (on-grid) and simple rotate, move or remove rules
  (fits-toy, support-free, fits-bed). The fix chip applies the code's action,
  never the model's.
- **Output filter:** at most 20 words (proposal), only part names present in the
  build, no blame wording, no brand terms. Any miss falls back to the template.
- **Template first:** a four-row table (one line per check id) ships before any
  model call and is the permanent fallback.
- **Scope:** the TypeScript builder checks first. Pro-line assembly errors from
  the Python gate join later through the Gatekeeper, with the same contract.
- **Acceptance (targets):** 20 scripted failing builds covering all four check
  ids; 100% get a template line; at least 95% of model lines pass the output
  filter; a human reviewer rates mean helpfulness at least 4 of 5.

### A4: Speech or typed edits

- **Same planner as F5** (`worker/planner.ts`, `mode: "edit"`). Input: the
  utterance (typed, or a transcript from the planned Muse Voice Transcribe;
  voice is off by default and audio is deleted, per the Town spec), the current
  build, and the catalog enum.
- **Output:** `{ops: [{op: "add" | "remove" | "swap" | "boost", ...}], say}`.
  `boost` names a stat from the catalog's stat list; code picks a part with a
  higher stat value (`statValueForPart`), places it with `findPlacement`, and
  validates with `canPlace` and `runChecks`.
- **Preview, then apply:** the kid sees the change and taps to confirm; the
  builder's undo stays. Illegal ops are dropped; when everything is dropped, A2
  explains why.
- **Acceptance (targets):** 40 adult-written utterances imitating kid phrasing;
  at least 85% parse to the intended ops; 100% of applied results legal by
  construction. Limit: this is not real kid speech. Real-child speech is tested
  only in consented, supervised playtests.

### A5: Kit-card step text

- **Deterministic core:** steps come from the build's attach edges in a valid
  physical order, as `[{step, part, attachTo, connector}]`, rendered with one
  template line per step. Card layouts and the fixed print-page warnings are
  never model-written.
- **Optional model pass:** an age-band rewrite under the A2 output filter. The
  model cannot reorder steps or rename parts.
- **Acceptance (targets):** every step names a real part and connector; text
  fits its card slot; 0 changes to fixed warning text.

### A6: Failed-print triage

- **Problem:** a print fails (stringing, lifting, elephant foot, layer shift,
  under-extrusion, spaghetti, a joint too tight or too loose) and the grown-up
  does not know which setting to change. Live monitors (Obico, some printers)
  already watch a camera during the print; this covers the after-the-fact case
  on printers with no camera.
- **Flow:** the grown-up uploads a photo of the failed print, optionally with the
  part id and slicer. One Spark vision call returns
  `{ cause: <enum id>, confidence: "high" | "low", also?: <enum id> }`. Code
  then shows the hand-written fix card for that cause and slicer. Fix text is
  authored once per cause and slicer, like the hint ladders. The model never
  writes a setting, a number or a G-code line.
- **Cause list:** a closed list of about 10 ids, written by hand and checked
  against coupons printed wrong on purpose before it ships. `unsure` is a valid
  answer and shows a generic checklist.
- **Where:** Worker only (`worker/assist.ts`), in the grown-up area behind the
  PIN gate, never offered to kids. The photo is processed and not stored.
- **Fallback:** a manual symptom picker over the same cause list, no model.
- **Dependency:** the A1 vision spike (does hosted Spark read images through
  the Responses API). Open question 13 covers the people-in-frame screen.
- **Acceptance (targets):** 30 photos, about 3 per cause, of coupons printed
  wrong on purpose and labelled by whoever made the fault. At least 80%
  top-1 on clear cases; at most 10% confident wrong answers, the rest `unsure`
  or `low`; 100% of answers land on a fix card.
- **Custom model:** none. A closed-set image classifier is the only fine-tune
  candidate here, and only if the eval shows Spark missing the target and
  hundreds of consented, labelled photos exist.

## Level hint ladders (hand-authored)

Three tiers per level, written by hand at authoring time and reviewed before
the level ships. No model writes a hint.

- **Position:** in the [play-design-spec.md](play-design-spec.md) pipeline,
  alongside its review step.
- **Tiers:** nudge, clue, show, drawn from the closed vocabulary. All three
  are written by hand and reviewed by the same humans who approve the level.
- **Storage:** an optional `hints` field proposed for `toyventor.level/2`;
  coordinate with the play-design spec.
- **No live generation:** hints are authored, not generated on the fly. The
  kid gets the tier the level stores.

## Print optimisation (what stays deterministic)

Printability is already decided by code, and a model neither beats nor replaces
those checks. Sources: [kip-print-workflow-spec.md](kip-print-workflow-spec.md)
sections 5 to 7, `parts/partspec/preprint_check.py`,
`parts/partspec/print_profiles/fdm_pla_0.4.json` and the limits in
`parts/partspec/interfaces.json`.

| Job | Model? | Basis |
| --- | --- | --- |
| Orientation, supports, bridges, brim | No | `preprint_check.py` gates overhang, floating islands, bridge span and ledges at the catalog bar (1.0 mm² steep overhang, 20 mm bridge). Orientation is a search over a few poses. The open work is browser parity with the gate and exporting each part's brim width (print workflow spec 7.1). |
| Plate packing, kit-card and sprue layout, colour consolidation | No | Packing and clustering algorithms (print workflow spec 5 and 6). |
| Printable generated parts | Already here | The L1 slope clamp is the 45° rule and the F3 loop reads gate failures. The eval already counts failures per gate id; support-free yield is read from those counts. |
| Existing Kip parts that fail the overhang check (9 of 30 per print workflow spec 7.3) | Not a product feature | CAD work. A model could propose `.scad` edits with the gate as accept or reject, but a parameter sweep gets most of that value, so keep it a dev-time tool. |
| Per-printer tolerance | Statistics, not an LLM | A prior by printer, nozzle and material, updated from the hidden 1/2/3 fit choice ([parts-tu-spec.md](../parts/parts-tu-spec.md) section 2). The photo variant is stretch item 7. Waits on `F1_printed_fit` data; the calibration print started 2026-10-31. |
| Failed-print triage | Yes | A6 above. |

## Eval harness (built first; decides everything else)

`scripts/forge-eval.ts` plus `tests/forge/prompts.json` (about 60 prompts
across slots, 10 photos for F2, 30 goals for F5). Runs three modes on the same
set so each layer's value is measured:

1. Single shot, no legalizer, no repair.
2. Plus legalizers.
3. Plus repair loop.

Reports first-attempt pass rate, final pass rate, mean model calls per job,
latency p50 and p95, token usage per job, failure counts per gate id, and a
manual 1 to 5 "cute and on-brand" rating. The gates prove a part is valid and
printable, not that it is appealing, and the design log shows taste has needed
human correction before.

The assist features add four small sets to the same harness: 20 scan photos
(A1), 20 scripted failing builds (A2), 40 utterances (A4), and 30 photos of
coupons printed wrong on purpose (A6). Each reports its
own acceptance numbers above, plus model calls, latency p50 and p95, and tokens
per request.

## Data plan

Two candidate models, two data pipelines. No public dataset matches our
formats (a printable, lattice-sized recipe per slot; a brick structure on our
lattice), so the data is mostly built from what we already own.

**Assumption (Dan, 2026-10-31):** external dataset licenses are acceptable for
this roadmap, and the work is planned beyond the hackathon. The assumption is
recorded, not verified: every dataset manifest must still record each source's
license, and the assumption should be revisited before any commercial release
of a trained model.

Evidence tags used below: **M** measured (from the baseline text-to-brick paper, a dataset
card, or this repo), **D** derived from a measured number, **E** estimate (not
measured; replace with real numbers as they come in). Status: **Have**, **Get**
(exists, free to download), **Create** (we build it).

### Brick sculptor data

| Data | Status | Source or method | Time to create / cost to get |
| --- | --- | --- | --- |
| 47,389 brick structures, 5 captions each | Get | public brick-structure set, MIT, 44.3 MB (M) | Free, minutes. Uses 1-unit-tall cuboids on a 20x20x20 grid, not our lattice, so it is warm-start data. |
| Clean-license source meshes | Get | Objaverse CC0/CC-BY subset, Thingi10K Creative Commons subset, Google Scanned Objects | Free. No GB figures found, so filter to a few thousand objects instead of whole sets. Filtering script about 1 day (E). |
| Stability simulator (the training filter) | Create | Reimplement the paper's stability analysis. The paper uses Gurobi, a commercial solver; license and price not checked, so budget a license or a rewrite on an open-source solver. | Engineering only, about 1 to 3 weeks (E). Runs at 0.35 s per structure under 200 bricks (M). |
| Structures on our lattice | Create | Voxelize meshes, random brick layouts, keep the stable ones | About 5 CPU-hours per 50k analyzed (D); more with rejects, which the paper does not quantify. Tens of dollars (E). |
| Captions for those structures | Create | Render views, caption with a vision model | $50 to $300 self-hosted (E). API cost unknown (Spark price not found). |
| Brick vocabulary (which Snap parts) | Create | Design decision. Only 8 of 114 Snap parts are tagged stackable, 3 brick, 5 plate (M). | A few days to decide and verify seating (E) |
| Recognizability test set | Create | About 100 prompts, human-rated | Hours of rater time (E) |

### Forge data

| Data | Status | Source or method | Time to create / cost to get |
| --- | --- | --- | --- |
| Catalog geometry and generators | Have | 185 catalog rows, 185 generated STLs, 218 functions in `toyventor_parts.py`; 30 vehicle, 26 hair, 23 add-on rows (M) | Free. Other sessions regenerate this tree, so read from a scratch copy. |
| 3 verified SDK example parts | Have | `public/kip/custom/` (M) | Free |
| 10 to 20 exemplar recipes | Create | Measure our own STLs into Recipe v1 | About 1 to 2 days for the first 20 (E); faster once the F2 extractor exists |
| Eval sets (60 prompts, 30 goals, 40 utterances, 20 failing builds) | Create | Written in-house | About 1 to 2 days (E) |
| 10 to 20 object photos | Get / create | Our own photos, plus Google Scanned Objects (Creative Commons, variant unconfirmed) | An afternoon for the first 20 (E); the dataset is free |
| 20 to 50k (caption, recipe) pairs | Create | Sample random recipes within slot bounds, keep gate-passers, render, caption | Gates about 24 CPU-hours per 50k (D, from about 1.7 s per part: the 180-part gate takes about 5 minutes). Captions $50 to $300 (E). |
| Failure to fix pairs | Create | Break passing recipes on purpose, record the gate report | Minutes to hours of CPU (E); gate reports are automatic |
| Real attempt log | Create, slowly | Accrues from live use | Unbounded. Low traffic yields very little, so do not depend on it. |
| Taste ratings | Create | Humans only; nothing public exists | 1,000 ratings at about 10 s each is about 3 hours (E). Preference tuning likely needs several thousand: 1 to 2 days of rater time (E). |
| Shape-diversity corpora | Get | Text2CAD and Objaverse with Cap3D captions (see below) | Free once license conditions are accepted. Formats do not match recipes, so pretraining at best; transfer is unproven. |

### External sources checked (2026-10-31)

| Source | What it offers | License as found | Use for us |
| --- | --- | --- | --- |
| Public brick-structure set (Hugging Face) | 47,389 brick structures from 28,000+ objects, 5 captions each, 21 categories, 20x20x20 grid, 1-unit-tall bricks | MIT. Built from ShapeNet objects, whose terms limit use to non-commercial research and education. | Warm start for the brick sculptor |
| Text2CAD (Hugging Face, gated) | About 170K CAD models, 660K text annotations | CC BY-NC-SA 4.0 | Pretraining at best; CAD sequences differ from recipes |
| DeepCAD and ABC | CAD construction sequences | Differs across mirrors; unresolved | Same as Text2CAD, if resolved |
| Objaverse plus Cap3D | About 660K object-caption pairs | Captions ODC-By 1.0; per-object licenses vary and some are non-commercial; two Cap3D card revisions state the license differently | Source meshes (filter to CC0 and CC-BY), diversity |
| Thingi10K | 10,000 printable models | Per-model, filterable to Creative Commons | Source meshes for the sculptor |
| Google Scanned Objects | 1,000+ scanned household items | Creative Commons, variant not confirmed | Photo and shape tests |
| ShapeNet | Large object corpus | Non-commercial research and education only | Only indirectly, via the public brick-structure set |
| Toys4K | 3D toys | Not verified | Unknown |

Conclusion: everything we can get is free and fast, but none of it is in our
formats, so it serves as warm-start or diversity data and cannot supply the
core pairs. The long poles are all "create": the stability simulator (weeks),
the recipe compiler and sampler (the compiler comes before any data), and
human taste ratings. None of them is GPU-bound. A sampler we design produces
what we thought to sample, so a model trained only on it may be no more
inventive than the sampler; exemplars from the real catalog and real usage
widen it.

## Custom model roadmap (after submission)

Two separate models, not one: different inputs, outputs, checks and retraining
schedules. The prompted workflows stay as the fallback and the baseline to
beat. Each stage proceeds only through its gate.

| Stage | Track | Work | Gate to proceed |
| --- | --- | --- | --- |
| R0 | Both | Prompted Forge workflow, attempt log, eval harness (Phases 0 and 1) | An eval report exists: per-gate failure counts, first-attempt and final pass rates, cost and latency per job |
| R1 | Sculptor | Write the stability simulator; choose the brick vocabulary from Snap parts | Simulator agrees with hand-checked stable and unstable cases; the vocabulary seats cleanly in the assembly gate |
| R2 | Sculptor | Spike: warm-start on the public brick-structure set, generate a lattice-native set from clean meshes, fine-tune a 1B model once, run with rollback | Structures stand, and people recognize what they are against a bar written down before the run |
| R3 | Forge | Recipe compiler and sampler; gate-filtered (caption, recipe) set; failure to fix pairs; exemplars | Humans spot-check style and diversity; sampler diversity is measured |
| R4 | Forge | SFT on a small model (1B first, 8B only if 1B cannot hold the task), then preference tuning with gates as a filter and taste as the objective | Beats the prompted baseline on pass rate and rating together, at lower cost per job |
| R5 | Both | Serve behind the same Worker and Gatekeeper contract; prompted workflow stays as fallback; define retrain triggers for catalog waves | Fallback verified by switching models in the eval |

Gate validity is a filter on training examples, not the thing maximized.
Optimizing pass rate alone teaches the model to emit boring shapes that always
pass, so watch pass rate and human rating together.

### Compute time and cost

| Stage | Wall-clock | Est. cost | Basis |
| --- | --- | --- | --- |
| Sculptor: generate about 50k structures | About 5 CPU-hours | Tens of dollars | D, from 0.35 s per structure (M) |
| Sculptor: captions | Unknown | $50 to $300 self-hosted | E |
| Sculptor: fine-tune 1B, LoRA | 12 h on 8 GPUs, about 96 GPU-hours | $150 to $350 per run; $450 to $1,750 for 3 to 5 runs | M: paper used 8x RTX A6000 for 3 epochs. Cost at A100 rates; the A6000 was not priced. Run count is E. |
| Forge: gate 50k recipes | About 24 CPU-hours | Tens of dollars | D |
| Forge: render and caption | Unknown | $50 to $300 | E |
| Forge: SFT, 1B | Up to about 96 GPU-hours per run | $150 to $350 per run | the published 1B baseline as the ceiling; recipes are shorter than its 4096-token samples |
| Forge: SFT, 8B | About 5 to 8x the 1B run | $750 to $2,800 per run | Crude scaling by parameter count (E) |
| Forge: preference tuning | Unknown | Unknown; plan for at least the cost of SFT | No verified number |
| Serving either model | Median 40.8 s per brick design with 2 rollbacks (M, paper hardware not stated) | $365 to $2,900 per month if one GPU runs always | E: 730 h at an assumed $0.5 to $4 per hour |

First working version of each model on the 1B path: about $0.5k to $2k of GPU
spend, excluding people. Multiply per-run costs by 3 to 5 for iteration.

GPU rates used: A100 80GB about $1.49 to $3.43 per GPU-hour; H100 about $2 to
$7 with a median near $3.37. Sources are vendor blogs from March to August 2026
and conflict, so check live pricing.

**Local GPU (RTX 4060, 8 GB; added 2026-11-01).** Nothing here is measured.
Memory is the first limit: Unsloth's own post says Llama 3.1 8B QLoRA fits in
8 GB at about 2K tokens of context, so a 1B model fits, and the short Forge
recipes fit even at 8B, while the sculptor's 4096-token samples on 8B would not.
Speed is the second: the card has roughly a third of an A6000's memory
bandwidth (272 vs 768 GB/s) and FP32 throughput (15 vs 38.7 TFLOPS; card specs
unverified here), so the baseline's 96 A6000-hours becomes about 270 hours, or
11 days, per full sculptor run (D, crude). Forge 1B SFT on about 50k short
recipes (assume 600 tokens each, 3 epochs, about 90M tokens) is roughly 6 to 20
hours per run at an assumed 1.5k to 4k tokens per second (E); Forge 8B QLoRA is
5 to 8x that, about 1 to 7 days. That is enough for the Forge 1B spike and for
debugging both pipelines; rent a GPU for the sculptor and for 8B. A 100-step
timing run gives the real tokens per second in minutes and replaces these
figures. The 4060 Ti 16 GB variant relaxes the memory limit, not the speed.

**Base model.** Start with a small open model (1B to 8B class; the published baseline's 1B is
the precedent). Use Muse Glimmer (about 30B) only if the small models cannot
hold the task. Unsloth's docs say a 30B QLoRA run fits on a 24 GB GPU, but no
training-time figures were found. A linear scaling of the baseline's 96 GPU-hours
gives a crude upper bound of about $4k to $10k per full-data run (D), which is
not worth it for these narrow tasks.

**Not in these numbers:** people time (the stability simulator, the eval
harness, exemplar recipes and the human taste ratings will likely cost more
than the GPUs); Spark's API price, which blocks a break-even comparison with
the prompted workflow; the share of rejected layouts in structure generation;
and retraining after catalog waves or schema changes.

## Phases

| Phase | Scope | Needs | Target |
| --- | --- | --- | --- |
| 0 | Recipe schema, `forge_recipe.py`, legalizers L1 and L2, CLI loop, eval harness, pre-generated showcase set (F1, F3 core) | Local venv and Spark key only | Before Nov 4 |
| 0b | A1 vision spike then flow, A2 template table then model rewrite, `worker/assist.ts` | Spark key only; no validator | Before Nov 4 if the vision spike passes |
| 1 | `/api/forge` job route, local validator server, F2 profile extraction and printable path, attempt log, UI entry points | Phase 0 | Nov 4 stretch, otherwise right after |
| 1b | Validator in a Container or Sandbox | Phase 1 | After submission |
| 2 | F5 planner (plan and edit modes, which also delivers A4), F4 host argument, host-envelope export, A5 templates | Phase 1 validator | After submission |
| 2b | F4 cavity-hat builder | Phase 2 | Later |
| 2c | A6: print about 10 failure coupons, photograph and label them, run the eval, then build the triage flow and fix cards | Phase 0b vision spike | After submission |
| 3 | Custom model roadmap stages R1 to R5, each behind its gate | Phase 1 attempt log and eval numbers | After submission; see "Custom model roadmap" |

Honest demo framing for Nov 4: Phase 0 outputs are pre-generated and
verified; the live flow, if any, is one hero path. Say so in the demo script,
as `spec.md` already does with its "mocked or pre-made" column.

## Gates for the Forge model

The Forge model (roadmap R3 and R4) is trained only if the eval shows one of
these after legalizers and repair are in place:

- Final pass rate stays below about 70% because the geometric intuition behind
  the gates is not prompt-teachable.
- Cost or latency per job is unacceptable at expected volume.
- A hard privacy requirement for self-hosted weights.
- Taste: ratings stay low on valid parts.

If tuning is chosen, the training set is the gate-filtered sampler output plus
the attempt log (see "Data plan"). The base model is a small open model first;
Muse Glimmer only if the small ones fail (see "Custom model roadmap"). Spark
Open is much larger. The license assumption in "Data plan" covers external
datasets; Meta's terms on training from Spark outputs are not stated on the
pages reviewed, so caption with a self-hosted open model (Glimmer is Apache
2.0, with a separate usage policy) or confirm Spark's terms first.

The brick sculptor (roadmap R1 and R2) has its own gate: the spike must
produce structures that stand and that people recognize. It is a separate
feature from Forge and needs its own product spec before any user-facing work;
this document covers only its data and training plan. A published text-to-brick model is the precedent:
a fine-tuned 1B model with a physics check and rollback, backed by an MIT
dataset. Keep third-party brand names out of user-facing copy.

## Stretch goals (post-freeze `SAM 3.1` + `Muse` extensions)

All items below stay parked behind the Nov 4 core freeze and obey the same
contract as `F1-F5` and `A1-A6`: `SAM 3.1` emits masks/silhouettes with zero
room pixels persisted, `Muse` emits schema-validated JSON recipes, and
deterministic code verifies geometry, fit, and physics.

1. **Live `Muse Spark` behind `Describe & Build`:** Connect `/api/muse/spark`
   to propose `kip-describe` part graphs validated by `fit_matrix` and the 8 mm
   exploded-view timeline, with deterministic recipe-book fallback.
2. **Adaptive Town Quests & Playable Create Lots (`Muse Spark` + `Muse Voice`):**
   Generate `toyventor.quest/1` NPC commissions from unpracticed
   `CONCEPT_BADGES` and age band, and let Create mode emit mission beacons and
   vehicle terrain gates inside `toyventor.level/1`.
3. **Kid Sketch / Clay -> Printable Snap Part:** `SAM 3.1` paper/clay contour
   -> `Muse` slot & stat -> `Recipe v1` extrusion/loft + `12.5 mm` TU socket
   verified through `kip_partspec_sdk.py`.
4. **Physical Build -> Digital Twin Sync:** Multi-prompt `SAM 3.1` desk photo
   across printed modules (`head`, `hat`, `wheels`, `chassis`) matched against
   `ai_catalog.txt` into `toyventor.toy/1`, plus `Muse Image` sticker/marker lift.
5. **Living-Room Course -> Playable 2.5D Level:** Side-view `SAM 3.1` floor
   segmentation (`book`, `cup`, `pillow`, `box`) mapped by `Muse Spark` into a
   playable `toyventor.level/1` obstacle and ramp course.
6. **Upcycle Lab (Cardboard & Bottle Adapters):** `SAM 3.1` household box/bottle
   scaled against a printed `1x1 TU` reference tile -> parametric clip/axle
   collar `Recipe v1`.
7. **Photo Print-Fit & Calibration Doctor:** `SAM 3.1` + `Muse` inspect a photo
   of the printed `1/2/3-dot` calibration strip to set per-printer XY fit
   compensation automatically.
8. **Privacy-Safe STEM Scavenger & `Max` Robotics Exhaust:** Ephemeral
   `SAM 3.1` target-noun masks for `Real Life Counts` tidy/scavenger quests, and
   parent-approved `(mask, TU_grasp_anchor, mm_scale, torque)` priors feeding
   the `Max` real-robot track ([scan-to-3d.md](scan-to-3d.md)).

## Not doing

- Model-generated meshes, or any path where the model's geometry skips the gates.
- Executing model-written Python in production.
- Porting the gates to TypeScript.
- A vector store for 185 parts.
- Fine-tuning Forge before the eval says to, or training any model before its
  roadmap gate.
- A single combined model for Forge and the brick sculptor.
- Open-ended chat with kids, mood reading from faces, or live-generated audio.
- Live print monitoring or printer control by a model (Obico and some printers
  already watch the camera), and any model-written slicer setting or G-code.

## Open questions (resolve by measurement, not debate)

1. Validation latency per recipe, including the assembly attach test. Not yet
   measured; it sets the job time budget.
2. Whether hosted Muse Spark accepts image input through the Responses API.
   Muse Spark Open's page says it perceives images; hosted behavior is
   unverified here. F2 does not depend on it; A1 does.
3. Spark pricing and Spark Open's license. Neither was stated on the page
   reviewed.
4. How often Spark produces a usable loft from text alone. The eval's
   first-attempt rate answers this and is the main quality risk.
5. Gate trip frequency for accessories (as opposed to heads and wigs, where
   it is known). The eval's per-gate counts decide the next legalizer.
6. A4: no real kid-speech data exists and COPPA limits collecting it, so adult
   phrasing is the only offline test set.
7. Brick sculptor: the stability analysis in the paper uses a commercial
   solver. Is its license acceptable, or does an open-source solver give
   equivalent verdicts on a hand-checked set?
8. Brick sculptor: is the Snap brick and plate subset (8 stackable, 3 brick,
   5 plate of 114 Snap parts) expressive enough to build recognizable things?
9. Sampler diversity ceiling: how much of the shape space the Forge recipe
   sampler covers, and whether exemplars and usage widen it enough.
10. Caption quality and cost: self-hosted open model versus the hosted API,
    and the terms on training from either's outputs.
11. Whether kids use a brick sculptor at all. Product need is unvalidated.
12. Every cost figure tagged E in "Data plan" and "Compute time and cost" is an
    estimate; the first real numbers come from building the recipe compiler and
    timing the gates per recipe.
13. A6: no public benchmark was found for photo of a failed print to cause to
    settings change (the nearest work, LLM-3D Print, monitors live prints and
    adjusts settings through the printer's API). Does Spark reach the accuracy
    target on our coupons, and is a people-in-frame screen needed before a
    grown-up's photo reaches a vision call?
14. Per-printer tolerance: how many printers it takes before a prior by
    printer, nozzle and material beats the single 1/2/3 choice, and whether the
    photo variant (stretch item 7) is worth building.

## Docs impact when this ships

- [spec.md](../product/spec.md) "Where we use Meta models": add rows for
  recipe authoring and the build planner; reword the "part geometry is never
  model-generated" line to "models propose parameters; gated deterministic code
  builds all geometry".
- [spec.md](../product/spec.md) "Where we use Meta models": also add rows for
  scan assist (Spark vision), the build coach and failed-print triage (Spark
  vision).
- [LLM_PART_PROMPT.md](../../parts/kip/sdk/LLM_PART_PROMPT.md): document
  Recipe v1 alongside the Python script format.
- [README.md](../README.md): index this spec (done with this file).
