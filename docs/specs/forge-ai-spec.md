# Forge AI and assists: prompt workflows first, custom models gated

## Status

**Proposed.** Only the pieces under "Already in the repo" exist. No custom
model is in scope for the Nov 4 build. The own-model track (G1–G7, brick
sculptor) is a stretch goal and never blocks submission. Prompt workflows stay
as the fallback throughout.

## Rule

One engine for F1–F6 (F6 is mostly geometry). A hosted model call proposes a
small JSON **recipe** (never a mesh, never code). Deterministic code legalizes
it, the existing Python gates build and verify it, and a repair loop feeds
structured failures back until it passes or falls back to something usable.
Every attempt is logged. Part geometry is built by gated, deterministic code;
the model only chooses parameters.

Five assists (A1, A2, A4–A6) follow one rule: the model supplies words or a
choice among enumerated options; code supplies every fact and every action.
Each has a no-model fallback, and A1/A2 can ship from the Worker alone.

## Features

| # | Feature | Input | Output | Model picks | Code guarantees |
| --- | --- | --- | --- | --- | --- |
| F1 | Describe it | Short text, optional slot | Verified printable accessory | Slot, recipe | Legalize, build, gate |
| F2 | Scan it, wear it | Photo of an object | Accessory shaped like the object | Name, role, slot, allowlisted features | Mask to profile to recipe, gate |
| F3 | Repair loop | Failing recipe + gate report | Passing recipe | Patched parameters | Hint table, legalizers, retry limits |
| F4 | Fits this one | Description + host | Accessory that seats on that host | Shape for given envelope numbers | Host check through assembly gate |
| F5 | Build planner | Goal text + current build | Ordered, valid build | Parts from compact catalog | Retrieval, assembly validation |
| F6 | Finish it (draft) | Assembled snap-part build | One smooth object for game + print | Optional finish style, keep-list | Strip, merge, smooth, gate both exports |

F3 is not a screen. It is the engine F1, F2, F4, and F5 run on.

- **F1 acceptance:** >= 80% of eval prompts verified within 4 calls; zero
  brand-term violations; no code-execution path.
- **F2 shape first:** profile to `loft` for round objects, contour to
  `profile2d` for flat ones. Only gated geometry is called printable.
  Routes: A cut-out (`profile2d`, hand only, compiles today), B round (`loft`
  from width profile), C chunky (front + side photos to loft slices). The fit
  loop retries fillet and size within a call budget.
- **F4 split:** (1) slot add-ons checked against the equipped host via a
  `host` argument; (2) later, cavity hats seating over head + wig. Clearance
  (0.4–0.45 mm) applied by a legalizer; seating matrix guards regressions.
- **F5 output:** `{say, build:[{id, part, pose}]}` with catalog-enum parts,
  validated with longest-valid-prefix rollback. Also feeds A4 edits, kit-card
  text, and kid-facing "why" lines. Acceptance: 100% of returned builds legal;
  >= 70% judged on-goal on 30 goals.
- **F6 pipeline:** strip connectors, merge, smooth, keep-list, gate (existing
  + no-connector-remains + volume/bbox bounds), export game mesh + print STL.
  Modes: display vs wearable (keeps snap footprint). On failure show the brick
  build with a short reason. Source build is kept, so Finish is undoable.

## Assists (Worker-only)

One shared model helper: structured JSON, low effort, timeout, safety prefix,
brand filter, per-IP limits. On failure it returns `null` and the caller uses
its fallback.

| # | Assist | Model chooses | Code guarantees | Fallback |
| --- | --- | --- | --- | --- |
| A1 | Scan assist | Ranked nouns | Mask, outline | Client noun as today |
| A2 | Build coach | Kid-friendly sentence | Check results, legal fix, applied action | One template line per check id |
| A4 | Speech / typed edits | Intent as enumerated ops | Placement, legality, preview + undo | Tap or typed catalog search |
| A5 | Kit-card text | Optional age-band rewrite | Step order, part names, fixed warnings | Template steps |
| A6 | Failed-print triage | One cause id from closed list | Fix card for that cause + slicer | Manual symptom picker |

- **A1:** one vision call returns `{nouns}`; segmentation starts on the client
  noun or `nouns[0]`; retries share one time budget. Needs a one-hour spike
  first: does the hosted model read images.
- **A2:** code computes the fix (`findPlacement`, `snapMm`, rotate/move/remove
  rules); the model words it (20 words max, real part names only, no blame).
  Template table ships first and stays as fallback.
- **A4:** same planner as F5 (`mode: "edit"`); output `{ops, say}` with
  `add/remove/swap/boost`; code places, validates, previews, then applies with
  undo. Offline set is adult phrasing; real child speech only in consented
  playtests.
- **A5:** steps come from attach edges in valid order; the model pass cannot
  reorder steps or rename parts.
- **A6:** grown-up photo in, `{cause, confidence}` out over ~10 hand-written
  causes (`unsure` allowed); code shows the hand-written fix card. Depends on
  the A1 vision spike.

## Already in the repo (do not rebuild)

- `parts/kip/sdk/kip_partspec_sdk.py`: slot builders, `validate_and_export()`
  with JSON report, attach test against a reference parent.
- `public/kip/LLM_PART_PROMPT.md` + `npm run kip:validate-part` workflow with
  three verified examples in `public/kip/custom/`.
- `public/kip/kip-forge-sdk.js`: mask to contour to extruded digital-only
  accessory (`prints: false`).
- `worker/meta.ts`, `worker/muse.ts`: segmentation + image-edit path and the
  model call pattern (structured JSON, low effort, retry, safety prefix,
  per-IP limit).
- `shared/sam.ts`: mask summary with silhouette path and anchors.
- `parts/partspec/ai_catalog.txt` + `build_examples.json`: compact catalog and
  38 valid/invalid builds for retrieval and regression.
- `shared/partspec.ts`, `shared/checks.ts`, `shared/build.ts`: part bridge and
  the builder's deterministic checks and placement helpers.
- `worker/index.ts` `handleScanPost`: client noun (60 chars max) + `segmentToy`.
- Forge optimizer lane: `shared/forgeOptimizer.ts`,
  `scripts/forge_optimizer_daemon.py` (`compile_recipe_to_partspec`, mandatory
  L1 slope clamp, `validate_and_export`), worker routes behind
  `POST /api/forge/preview` (off until configured). Calls no model.
- [play-design-spec.md](play-design-spec.md): level-drafting pipeline for level
  review.

## Shared engine

### Recipe v1 (the only thing the model emits)

JSON, schema-validated in TypeScript and again in Python. Unknown keys are
rejected, numbers are clamped, nothing is executed.

```json
{
  "v": 1, "id": "wizard_hat", "name": "Wizard Hat", "stat": "Glow",
  "slot": "crown", "host": "char_head_kid",
  "shape": { "kind": "loft",
             "slices": [ { "z": 0, "w": 23.4, "d": 11.4, "r": 4.6 } ] },
  "features": [ { "op": "brim", "radius_mm": 16, "thickness_mm": 2 } ]
}
```

- `slot`: `crown | head | back | hand | front | rollbar | spoiler | hood | roof | exhaust`.
- `shape.kind`: `loft` (all slots except hand; 2–16 slices), `profile2d`
  (hand, x/z polygon, 3–256 points), `star2d` (hand default).
- `features`: at most 6 parametric ops from an allowlist (clamped, never
  rejected for range): `knob`, `brim`, `ears`, `horns`, `spikes`, `snout`,
  `brow`, `ribs`, `star`, `hollow`, `relief` (planned: `fin`, `antenna`,
  `band`). Unknown or slot-incompatible ops are dropped and listed in
  `features_ignored` / `features_dropped`; adjustments in
  `features_adjusted`. Head pairs keep clear of the crown seat; snouts and
  brows use support-free ramps (55°, 50° fallback).
- `support_policy`: `none` (default) or `minimal` (crown, head, back only).
  A `brim` or `horns` promotes `none` to `minimal` and logs it.
- `shape.top`: `studs` (default) or `dome`; `shape.height_mm` 24–38 sets head
  height. `id` gets a `custom_` prefix server-side. Brand terms are rejected
  before and after the model call.

### Pipeline (every feature)

1. **Intake.** Length cap, kid-safety rules, brand-term filter.
2. **Propose.** Hosted model call, structured JSON against the Recipe schema,
   low effort first. Prompt is the adapted `LLM_PART_PROMPT.md` + verified
   examples + one example per slot + host numbers if any.
3. **Legalize (no model call).** L1 slope clamp (at most 0.78 × dz per side,
   always on), L2 size band (move out of the small-parts marginal band by the
   smaller change), L3 clamp to slot bounds, L4 symmetry (mirror at overlap
   0.93+, snap centre offsets under 1 mm). Each change is logged.
4. **Build and gate.** Compiler turns the recipe into a `part_spec` and runs
   `validate_and_export()`. Output: slim JSON report + STL + manifest.
5. **Repair (F3).** On failure send only `{gate, measured, limit, hint}` per
   failure. Effort rises on attempts 2–3. Hard cap: 4 model calls per job.
6. **Always end usable.** F1/F4 fall back to the nearest ready-made catalog
   part; F2 to the digital-only accessory; F5 to the nearest verified
   `build_examples` build.
7. **Bridge.** Verified results pass through `convertPartSpecPart`, tagged
   `custom`.

### Gatekeeper (where Python runs)

Gates run in Python and cannot run in a Worker. Two options: local validator
server (the optimizer daemon; Phase 0/1, works for demo and pre-generated
showcase), or a hosted container/sandbox running the same HTTP contract
(Phase 1b, config swap). A TypeScript port is rejected (drift risk).

The contract is a pure function: `POST /validate {recipe, host?}` returns the
slim report. Jobs are async with staged "Forging..." progress
(`queued → proposing → checking → repairing → done/failed`).

### Guards

- Kid-safety prefix reused; recipe text fields re-checked after return.
- Rate limit tighter than Create mode (one job is up to 4 model calls):
  3 jobs/min/IP plus a per-device daily cap.
- Model-written Python never runs server-side. Production accepts JSON only.
- Photos: segmentation sees the image; recipe calls receive numbers only.
  No photo stored; no photo in the forge request.
- Logging: recipe, per-gate outcome, attempt count, latency. Kid prompts are
  not stored (eval set excepted).

## Level hint ladders (hand-authored)

Three tiers per level (nudge, clue, show) from a closed vocabulary, written
and reviewed by humans, stored as an optional `hints` field. No live
generation. The kid gets the stored tier.

## Print optimisation (stays deterministic)

Orientation, supports, bridges, brim, packing, and printable-part yield are
code gates and search, not model work. Per-printer tolerance is statistics.
Failed-print triage is A6. CAD fixes for existing parts are dev-time only.

## Eval harness (built first; decides everything else)

`scripts/forge-eval.ts` + `tests/forge/prompts.json` (~60 prompts, 10 photos,
30 goals). Three modes per prompt: single shot, + legalizers, + repair.
Reports first-attempt/final pass rate, mean calls, latency p50/p95, tokens,
failures per gate, and a 1–5 taste rating. Gates prove validity, not appeal.

Current signal on the latest prompt + ops: 100% final pass rate
(first attempt ~80–90%, ~1.1–1.3 calls/job). Taste lags validity: early mean
1.5/5, now 2.4 overall and 3.6 on the variety set. Crowns improved most;
heads still need body-shape work. Richer recipe ops + taste loop come before
any tuning.

Assists add four small sets: 20 scan photos (A1), 20 failing builds (A2),
40 utterances (A4), 30 failure photos (A6).

## Data plan

No public dataset matches our formats, so the data is built from what we own.
Every source still needs a recorded license check before commercial training.

- **Have:** catalog geometry + generators, 3 verified example parts, eval sets
  (60 prompts, 30 goals, 40 utterances, 20 failing builds), own photos.
- **Create:** 10–20 exemplar recipes measured from our STLs; 20–50k
  gate-filtered (caption, recipe) pairs sampled within slot bounds;
  failure→fix pairs from broken passing recipes; the live attempt log (slow,
  do not depend on it); human taste ratings (1–2 days per thousand).
- **Long poles:** stability simulator (weeks), recipe compiler/sampler, taste
  ratings. None GPU-bound. A sampler only samples what it was told to sample;
  exemplars + usage widen it.

## Custom model roadmap (stretch, after submission)

Only G0 is committed (Phase 0, no GPU). G1–G7 start if time and budget allow
and never block Nov 4. Two models, not one: Forge recipe writer + brick
sculptor. Prompted workflows stay as fallback and baseline. Each stage has a
gate; when a gate fails, stop spending and record numbers.

| Stage | Track | Work | Gate |
| --- | --- | --- | --- |
| R0 | Both | Prompted workflow + attempt log + eval (Phases 0–1) | Eval report exists |
| R1 | Sculptor | Stability simulator; Snap brick vocabulary | Sim matches hand-checked cases; vocabulary seats cleanly |
| R2 | Sculptor | Warm-start spike, lattice-native set, one tune + rollback | Structures stand and read clearly |
| R3 | Forge | Compiler + sampler, gate-filtered pairs, fix pairs, exemplars | Style/diversity spot-checked |
| R4 | Forge | Small tune, then rejection-sampling rounds (taste as objective) | Beats prompted baseline on rate + rating, cheaper per job |
| R5 | Both | Serve behind Worker + Gatekeeper; fallback verified | Model switch in eval works |

Tuning trains only on our gate-filtered pairs + attempt log. Optimizing pass
rate alone teaches boring shapes; watch pass rate + human rating together.

### Forge phases (G0–G7)

| Phase | Scope | Gate / stop rule |
| --- | --- | --- |
| G0 | Baseline + eval (schema, compiler, L1/L3, L2, call + repair, CLI, ~60 prompts, showcase) | Eval report exists; before Nov 4 |
| G1 | Base-model baseline + small tune smoke test; constrained decoding; tokens/s, memory, cold start | Valid JSON 99%+; if it will not train/serve, stop |
| G2 | Data: exemplars, sampler, gate-filtered + fix pairs, captions, held-out split, license manifest | No eval leak; diversity measured |
| G3 | Pilot tune (3–5k pairs, 1–3 epochs, 2–3 variants) vs G1 baselines | Beats prompted first-attempt rate with no rating drop, else stop |
| G4 | Full tune (20–50k if curve says so) + 1–3 taste-filtered rounds | Beats baseline on rate + rating together |
| G5 | Serve behind `/api/forge` + Gatekeeper; fallback chain; "AI-made" label | p95 in budget; cost/job measured |
| G6 | Operate: retrain on waves/schema/slots/drift | Every retrain re-passes full eval |
| G7 | Larger open base as option: repeat G1 + one pilot vs best adapter | Ships only if it beats the incumbent on rate + rating at viable cost |

Cheapest first tuned model: G1 + G3 + one small G4 round. People time exceeds
GPU cost. Local machines handle debug + CPU gating; tuning runs on hosted GPUs.

## Phases

| Phase | Scope | Target |
| --- | --- | --- |
| 0 | Model call + repair, L2, CLI, eval, pre-generated showcase (F1/F3 core) | Before Nov 4 |
| 0b | A1 vision spike then flow; A2 templates then rewrite | Before Nov 4 if spike passes |
| 1 | `/api/forge` job route, local validator, F2 extraction, attempt log, UI | Nov 4 stretch, else after |
| 1b | Validator in container/sandbox | After submission |
| 2 | F5 planner (plan + edit = A4), F4 host arg + envelopes, A5 templates | After submission |
| 2b | F4 cavity-hat builder | Later |
| 2c | A6: print ~10 failure coupons, label, eval, triage + cards | After submission |
| 2d | F6 spike on 3 builds, then game path, then print path | After submission |
| 3 | Forge G0–G6, G7 as stretch; sculptor R1–R2 behind its gate | G0 before Nov 4; rest stretch |

Demo framing for Nov 4: Phase 0 outputs are pre-generated and verified; any
live flow is one hero path. Say so in the demo script.

## Gates for the Forge model

Train only if the eval shows one of these after legalizers + repair: final
pass rate below ~70% for prompt-unteachable geometric reasons; cost/latency
unacceptable at volume; hard self-hosted-weights requirement; or taste stays
low on valid parts.

Current reading: pass-rate gate not tripped (100% final); taste gate tripped
for heads. Richer recipe ops + taste loop come before any tuning.

## Stretch goals (post-freeze)

Parked behind Nov 4; same contract (model proposes JSON, code verifies):

1. Model behind Describe & Build with deterministic fallback.
2. Quest + Create-lot generation from badges and age band.
3. Sketch/clay contour to slot/stat to Recipe extrusion + socket.
4. Desk-photo to part-graph twin + sticker lift.
5. Room-photo to playable 2.5D level obstacles/ramps.
6. Household box/bottle to parametric clip/axle collar.
7. Printed-strip photo to per-printer fit compensation.
8. Ephemeral masks for tidy/scavenger quests + robot priors.
9. Own models (G1–G6, larger base G7, sculptor) per above.

## Not doing

- Model-generated meshes or any geometry skipping the gates.
- Executing model-written Python in production. Porting gates to TypeScript.
- A vector store for ~185 parts. One combined Forge + sculptor model.
- Tuning before the eval says to. Open-ended kid chat, mood reading, live audio.
- Model-driven live print monitoring, slicer settings, or G-code.
- Training from any base outside the two approved ones (larger base is G7 only).

## Open questions (measurement, not debate)

1. Validation latency per recipe (sets job budget; plan 5–30 s + repair).
2. Does the hosted model read images (A1/A6 depend on it)?
3. Hosted model pricing and open-base license terms.
4. Usable-loft rate from text alone (eval first-attempt rate).
5. Per-gate trip frequency (decides next legalizer).
6. No real kid-speech data; adult phrasing only, plus consented playtests.
7. Sculptor stability check: solver approach, Snap subset expressive enough,
   do kids want it?
8. Sampler diversity ceiling; caption quality/cost and training-use terms.
9. Taste-loop judge (silhouette overlap vs vision-score, calibrated + held out).
10. Concept-image path needs generation access, safety/brand filters, richer
    ops. Photo privacy for release (parent gate, people-in-frame).
11. Fit-loop budget and limiter behavior; thin-neck strength; back-slot and
    relief spikes before promising them.

## Docs impact when this ships

- Product spec "Where we use models": add recipe authoring, planner, scan
  assist, build coach, triage rows; reword "never model-generated" to "models
  propose parameters; gated code builds all geometry".
- `LLM_PART_PROMPT.md`: document Recipe v1 alongside the script format.
- Print-workflow spec: F2b plate replaces the un-authored photo-blank wording.
- `README.md`: index this spec.
