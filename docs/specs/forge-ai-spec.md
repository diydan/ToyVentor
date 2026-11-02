# Forge AI and assists: prompt workflows first, custom models on a gated roadmap

## Status

**Proposed.** Written 2026-10-31, extended the same day with four assist
features (A1, A2, A4, A5), and on 2026-11-01 with a fifth (A6, failed-print
triage), a print-optimisation scope note, and a Glimmer-first training plan
(phases G0 to G6, plus a G7 stretch for Muse Spark Open). Nothing here is built
except the pieces listed under "Already in the repo". No custom model is in
scope for the Nov 4 build. The whole own-model track (Glimmer phases G1 to G7
and the brick sculptor) is a stretch goal (Dan, 2026-11-01): nothing in it is
required for the submission. If it goes ahead, two own-model tracks (a Forge
recipe writer and a brick sculptor) run behind explicit gates, both starting
from Muse Glimmer (Muse Spark Open is a stretch option); see "Custom model
roadmap". The prompt
workflows stay as the fallback throughout.

## One-paragraph version

Six AI features share one engine (the sixth, F6, is mostly geometry; see its
section). A hosted Muse Spark call proposes a small
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

## The six features

| # | Feature | Input | Output | Model's job | Deterministic job |
| --- | --- | --- | --- | --- | --- |
| F1 | Describe it | Short text, optional slot | Verified printable accessory | Pick slot, write recipe | Legalize, build, gate |
| F2 | Scan it, wear it | Photo of any object | Accessory shaped like the object | Name it, pick role and slot, add allowed features | Mask to profile to recipe, gate |
| F3 | Repair loop | A failing recipe plus gate report | A passing recipe | Patch parameters | Hint table, legalizers, retry limits |
| F4 | Fits this one | Description plus a host (head, vehicle) | Accessory that seats on that host | Shape for the envelope numbers it is given | Host check through the assembly gate |
| F5 | Build planner | Goal text plus current build | Ordered, valid build | Choose parts from a compact catalog | Retrieval, assembly validation |
| F6 | Finish it (draft) | An assembled snap-part build | One smooth, polished object for the game and for printing | Optional: pick a finish style and which parts stay crisp | Strip connectors, merge, smooth, gates, both exports |

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
- The forge-optimizer lane (`feat/parts-asset-optimization`, in `main` through
  `058cf61`; read and smoke-run 2026-11-02): `shared/forgeOptimizer.ts`
  (`ForgeRecipeV1`, job and gate-report types, brand check),
  `scripts/forge_optimizer_daemon.py` (warm daemon started by
  `npm run forge:optimizer`: `compile_recipe_to_partspec`, the mandatory L1
  slope clamp, `validate_and_export`, which re-runs the print gate on the
  optimized mesh (`verify_preprint=True` is set inside the SDK, not by the
  request), a bounded queue, bearer auth, content-addressed artifacts)
  and `worker/forgeOptimizer.ts` behind `POST /api/forge/preview`,
  `GET /api/forge/jobs/:id` and `GET /api/forge/artifacts/:name` (off until
  `FORGE_OPTIMIZER_URL` is set). It has an opt-in minimal-support tier
  (`support_policy: "minimal"`) for crown, head and back slots. It calls no
  model. A later commit (`6f8f2b1`: gate parity test, slow-client and cache
  bounds) is on `feat/parts-asset-optimization-followups`, not in `main`.

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
- `shape.kind`: `loft` (all slots except hand; the compiler enforces 2 to 16
  slices and the prompt asks for 3 to 12), `profile2d` (hand slot, polygon in
  x,z, 3 to 64 points), `star2d` (hand slot, the default there).
- `features`: at most 6, from an allowlist. Built: `brim` and `knob`. Planned,
  not in the compiler: `ears`, `fin`, `antenna`, `band`. Each is a parametric op
  with bounded numbers, so the model can add character without being able to
  break geometry.
- `support_policy` (optional): `none` (default) or `minimal`; `minimal` is only
  allowed on `crown`, `head` and `back`. `shape.height_mm` (optional, 24 to 38)
  sets a head's height.
- `id` gets a `custom_` prefix server-side. `stat` is one of Speed, Spin,
  Torque, Glow. Brand terms are rejected before and after the model call.
- **As built.** `ForgeRecipeV1` in `shared/forgeOptimizer.ts` and
  `compile_recipe_to_partspec` in `scripts/forge_optimizer_daemon.py` already
  implement this recipe as listed here (read, and smoke-run with 12 crown
  jobs, 2026-11-02). Where
  this section and that code differ, the code wins until the optimizer lane
  agrees a change (open question 19).

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
     (the P1/P4 rule from the prompt). Built: `legalize_loft_slices` in the
     daemon, always on.
   - L2 size band: if the minimum enclosing cylinder lands in the
     small-parts marginal band, move it out by the smaller change
     (< 29.5 mm or > 36.0 mm guidance), never below the slot pad. Not built yet; the prompt v1 eval run says it is
     now worth building (see "Eval harness").
     The gate's own edges (`interfaces.json`, `toyventor_parts.py`): at most
     31.75 mm is `small_part` and passes, 31.75 to 34.925 mm (+10%) is
     `marginal` and fails, above that is `above_cylinder`. The smoke run hit the
     band at 31.86 mm and 33.48 mm. The 29.5 and 36.0 mm figures are guidance
     with margin around that band.
   - L3 clamp every number to the slot's bounds. Built in the daemon for loft
     slices, hand shapes and features.
   Ship L1 and L2 first. Add more only when the eval shows a gate dominating.
4. **Build and gate.** Python compiler (`compile_recipe_to_partspec` in
   `scripts/forge_optimizer_daemon.py`) turns the recipe
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
| A. Local validator server. Partly built as the optimizer daemon (`npm run forge:optimizer`, `scripts/forge_optimizer_daemon.py`); the Worker proxies when `FORGE_OPTIMIZER_URL` is set (`worker/forgeOptimizer.ts`, off by default) | **Phase 0/1.** No new infra, works for the Nov 4 demo and for pre-generating a showcase set. |
| B. Cloudflare Container or Sandbox running the venv | **Phase 1b.** Same HTTP contract as A, so swapping is config. |
| C. Port gates to TypeScript with `manifold-3d` WASM | **Rejected.** Large port, and a second copy of the gates will drift from the Python source of truth. |

The contract is a pure function: `POST /validate {recipe, host?}` returns the
slim report. Jobs are asynchronous (`POST /api/forge` returns `jobId`; poll
`GET /api/forge/:id`) with stages `queued, proposing, checking, repairing,
done, failed`. A job is several calls long, far past the 13 s single-call
budget in `muse.ts`, so the UI shows staged "Forging..." progress. The wait
is part of the experience, not a bug.

The optimizer lane already has routes (`POST /api/forge/preview`,
`GET /api/forge/jobs/:id`, `GET /api/forge/artifacts/:name`) and job states
(`queued, preview_ready, validating, optimizing, print_ready, digital_only,
failed`) that cover compile and gate only. Proposal: the Forge job (propose and
repair) stays the outer layer with the stages above, hands each recipe to an
optimizer job and returns that job's `job_id`; since `/api/forge/jobs/:id`
belongs to the optimizer, the outer poll route needs a different name (open
question 19).

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
- **Fastest cut:** the prompt, validator, compiler and gate server already
  exist (the optimizer daemon). Phase 0 is just the model call, L2, and a CLI
  loop (`npm run forge:run`) that calls Spark, sends each recipe to the daemon
  and writes verified parts to `public/kip/custom/`.
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
- **What the daemon returns today (smoke run, 2026-11-02, 12 jobs):**
  - A marginal small-parts result comes back `ok: false`,
    `design_status: "needs_reproportion"` and `blocking_failures: []`. The only
    signal is `small_part` (`status`, `min_enclosing_diameter_mm`,
    `margin_pct`), so repair feedback must be built from `small_part` and
    `design_status` as well as `blocking_failures`.
  - A recipe that fails to compile (an unknown slot, for example) gets HTTP 422
    `invalid payload` with no reason, by design. The repair loop cannot learn
    from it unless the outer layer checks the same bounds first or the daemon
    gains a safe detail channel (open question 19).
  - The L1 clamp changes slices silently: an over-flared hat (a 40 mm slice
    2 mm above a 24 mm base) came back `print_ready`, and by the clamp rule that
    slice is cut to about 27 mm, but the response lists nothing that moved.
    Legalizers should report each change so the eval can count them.
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

## F6: Finish it (draft, added 2026-11-02)

**What it is.** A child or parent takes a build made of snap-together parts and
presses "Finish". The result is one smooth, polished object: no studs, sockets
or seams, rounded edges, one continuous surface. It exists twice from one
source: a polished model in the game and a polished single-piece STL to print.
The brick build stays the source and is never replaced, so Finish can be undone.

**Assumptions from Dan's request, not yet confirmed.** "Brick-based" means a
build from the Snap line's stud-and-socket parts. "Polished" means smooth
surfaces merged into one solid, finished enough to look like a product rather
than a model kit. Open questions 20 to 23 are the forks.

**Why it fits.** Same rule as the rest of this spec: the model chooses, code
builds, the gates decide. The model's part is small and optional (a finish style
and which parts stay crisp, from closed lists), and three presets (soft,
rounded, blobby) work without it. The geometry is code, and the model never
edits a mesh. The catalog already has smooth cover parts (`skin_*`, game-only)
and `optimize_assets.py` already makes the quantized, smooth-normal GLB and the
finish-safe print STL, so the game and print exports are not new.

**Pipeline.**
1. Source: the assembled build (part ids, poses, colours) from the toy contract.
2. Strip: remove every stud, socket and tube, using the connector cells in the
   manifest, and close the holes they leave.
3. Merge: union the parts into one body, bridging small gaps between touching
   parts so the result is one connected solid.
4. Smooth: round the surface by a chosen amount. Candidate methods are a voxel
   blur then marching cubes, Manifold's own smoothing, or a signed-distance
   smooth union. A spike on three real builds picks one. Features finer than
   about twice the smoothing radius soften or vanish, and each style says so.
5. Keep list: parts marked crisp (a face plate, a wheel hub) are held out of the
   smoothing and put back.
6. Gates: the existing set (watertight, single body, on bed, fits bed, overhang,
   ledges, bridge, small-parts screen) plus three new ones: no connector remains
   (unless wearable, below), volume within a stated percentage of the source, and
   bounding box within a stated distance of the source.
7. Two exports from the one solid: a game mesh (decimated, smooth normals, colour
   zones) and a print STL oriented by the existing preprint check.

**Two modes (open question 20).** Display piece: free-standing, no connectors,
optional base. Wearable: keeps the 2x1 or 2x2 socket footprint underneath so it
still snaps onto a head or vehicle, like the catalog's add-ons.

**Fallback.** If a style fails the gates, try the next smoother or crisper
preset. If all fail, show the brick build unchanged with a short reason and
offer the ordinary kit-card print.

**Acceptance (targets; the spike sets the real numbers).** On 10 real builds: at
least 8 produce a polished solid that passes every gate on the first preset; a
person rates at least 7 of the 10 four or higher for "looks finished"; the game
and print meshes match within the stated bounding-box distance.

**Not in the first version, unless the open questions say otherwise:** moving
parts, multi-material printing, and any claim that a finished print is safe for
children under 3.

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
| Printable generated parts | Already here | The L1 slope clamp is the 45° rule and the F3 loop reads gate failures. The eval already counts failures per gate id; support-free yield is read from those counts. The optimizer daemon (see "Already in the repo") already runs `validate_and_export`, which re-runs the print gate on the optimized mesh, and returns a `slicer_recipe`; it calls no model. |
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

**Built (2026-11-02, uncommitted):** `scripts/forge-eval.ts`,
`scripts/lib/forgeEvalCore.ts` and `tests/forge/` (60 text prompts over the ten
slots; 13 tests, strict `tsc` clean). It sends each prompt to a proposer and
each recipe to the optimizer daemon (`npm run forge:optimizer`). The Spark
proposer calls the Responses API as `worker/muse.ts` does and reads its key only
from `MODEL_API_KEY` or `META_MODEL_API_KEY`; its prompt is a v0. The stub
proposer tests plumbing and measures no model. The Spark proposer has run the
full set once (below). The report is rewritten after every prompt and
`--resume` continues a killed run. Two deviations from the three modes above:
- The daemon always applies L1, so "no legalizer" cannot be measured directly.
  The harness reports how many recipes the clamp would have changed
  (`recipesTouchedByLegalizer`), using a TypeScript mirror checked against the
  Python clamp on three cases.
- Mode 1 is `--max-calls 1` and mode 3 is the default of up to 4 calls; the
  loop stops early when the same gates fail twice on the same recipe. Mode 2
  waits for L2.

**First Spark baseline (2026-11-02, `muse-spark-1.3`, prompt v0, 60 prompts, up
to 4 calls, one run, star fillet bug still in the daemon; validity only, no
taste ratings yet):**

| Slot | Prompts | First attempt | Final |
| --- | --- | --- | --- |
| crown | 14 | 14 | 14 |
| head | 8 | 0 | 0 |
| hand | 8 | 3 | 6 |
| back, hood, roof, front, rollbar, spoiler, exhaust | 30 | 30 | 30 |
| All | 60 | 47 (78%) | 50 (83%) |

- **Calls and tokens:** 94 calls for 60 prompts (mean 1.57); 69,850 tokens in and
  149,396 out, about 740 in and 1,590 out per call (the output figure may
  include reasoning tokens). Spark's price is not stated, so there is no cost
  figure.
- **Repair loop:** it recovered 3 of the 13 first-attempt failures (all hand
  recipes) for 34 extra calls; 24 of those went to heads, which never passed.
- **Gates:** over all attempts `G3_single_body` failed 42 times, `P4_no_ledges`
  32 and `G1_watertight` 13. None was `small_part_marginal`, and the clamp
  changed 2 of 60 first-attempt recipes (bounds only, no slope). This v0 run gave
  no reason to build L2 or more L1; the v1 run below changes that.
- **Heads, 0 of 8:** always `G3_single_body` and `P4_no_ledges`, whatever the
  shape. SDK tests found the cause. `character_head` puts the crown studs at
  `z = height_mm` (30.5), and the v0 prompt never said so, so Spark's heads
  stopped near 17 mm and left the studs floating. They also started 16 mm deep
  on a 12.1 mm collar, which makes a ledge. Two hand-written heads that start at
  the 24.6 x 12.1 mm collar, grow at most 0.78 x dz per side and span 0 to
  30.5 mm both pass. This is a prompt gap (per-slot footprint and z span from
  `LLM_PART_PROMPT.md`'s slot table), not evidence that the model cannot do
  heads.
- **Hands, 6 of 8 after repair:** the three first-try stars (wand, lollipop,
  flower) failed because the daemon built stars at the SDK's 1.4 fillet; fixed
  after the run (see open question 19). The flag on a stick failed on all 4
  calls. Hypothesis, not isolated: the SDK centres a profile's bounding box on
  the grip, so a pole at the edge of the flag never touches the grip neck.
- **Latency:** validation p50 2.5 s, p95 16.3 s; whole job p50 9.9 s, p95 26.4 s
  including the model call. The machine's load average fell from 73 to 20 during
  the run, so read p95 as an upper bound.
- **Not measured:** taste, photos (F2), or any tuned-versus-prompted comparison.
  One run, so differences of a few prompts are noise.

**Prompt v1 run (2026-11-02, same 60 prompts, star fillet fixed).** The v1
prompt and the fillet fix changed together, so this shows their combined effect.

| Slot | Prompts | v0 first | v0 final | v1 first | v1 final |
| --- | --- | --- | --- | --- | --- |
| crown | 14 | 14 | 14 | 13 | 14 |
| head | 8 | 0 | 0 | 4 | 8 |
| back | 6 | 6 | 6 | 2 | 6 |
| hand | 8 | 3 | 6 | 6 | 8 |
| hood, roof | 10 | 10 | 10 | 8 | 10 |
| front, rollbar, spoiler, exhaust | 14 | 14 | 14 | 14 | 14 |
| All | 60 | 47 (78%) | 50 (83%) | 47 (78%) | 60 (100%) |

- **Calls and tokens:** 78 calls for 60 prompts (mean 1.30; v0 was 94 and 1.57).
  13 prompts needed repair: 9 took 2 calls, 3 took 3 and 1 took 4. Tokens per
  call rose to about 1,150 in and 1,700 out (v0: 740 and 1,590) because the
  prompt is longer; the run total is about the same (222k against 219k).
- **First-attempt failures (13):** 8 `small_part_marginal`, 4 `P4_no_ledges`
  (heads) and 2 each of `G1_watertight` and `G3_single_body` (hands; one hand
  also had a marginal size).
- **New marginal sizes:** v0 had none. With real footprints in the prompt Spark
  builds bigger parts, and they landed in the 31.75 to 34.925 mm band: all four
  back pieces regressed from first-time passes, and a crown, a hood and a roof
  joined them. All were fixed by repair, but 11 of the 18 extra calls went to
  prompts that failed only on size.
- **L2 now qualifies.** The spec's rule is to add a legalizer when a gate
  dominates, and size is 8 of the 13 first-attempt failures. A deterministic
  rescale would spend no model calls on it.
- **Heads, 8 of 8 after repair:** 4 passed first time; the other 4 failed
  `P4_no_ledges` once and were repaired in one call each. Not examined further.
- **Caveats:** one run per prompt version; the two changes are not separated;
  validity only, no taste ratings; Spark's price is unknown.

**First taste check (2026-11-02, Dan, 19 of the 60 v1 parts: 14 crowns and 5
heads).** Scale: 1 "not what I asked", 2 "odd or ugly", 3 "fine", 4 "good", 5
"cute, on-brand". Dan stopped after 19 because many were not close.
- **Result:** mean 1.47; 14 ones, 1 two, 4 threes, no 4 or 5. Crowns average
  1.64; all 5 heads are 1.
- **Pattern:** the only 3s are cones and tapered cylinders (wizard hat, cone
  party hat, pointy hat, fez). The rest ask for what the recipe cannot make or
  Spark did not use: a brim (cowboy, pirate), points (crown), horns, ears
  (bunny, cat). The heads are the same box with two studs whatever was asked.
- **Viewer:** the first rating page was washed out, which made shapes hard to
  read. It was fixed after these ratings, and a render of the same meshes with
  proper lighting agrees with them.
- **Reading:** the validity gates are not the weak spot; fidelity to the request
  is. Two likely causes, not yet separated: Recipe v1 cannot express points,
  ears, horns or curled brims (only `brim` and `knob` are built; `ears`, `fin`,
  `antenna` and `band` are planned), and the v1 prompt's slot footprints may
  have narrowed the variety. A tuned model cannot add shapes the recipe cannot
  express.
- **Ideas raised, untested:** concept images from the text, SAM silhouettes, and
  slices fitted to the front and side outlines; and iterating until an automated
  judge scores at least "fine". See open questions 24 and 25.

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

**Stretch goal (Dan, 2026-11-01).** The whole own-model track in this section
and in "Glimmer Forge: workflow and phases" is a stretch goal. Only G0 is
committed, because it is Phase 0 (the eval and the prompted baseline) and costs
no GPU time. Everything else starts only if time and budget allow, and none of
it blocks the Nov 4 submission or the prompted workflows.

Two separate models, not one: different inputs, outputs, checks and retraining
schedules. The prompted workflows stay as the fallback and the baseline to
beat. Each stage proceeds only through its gate.

**Base model constraint (Dan, 2026-11-01).** Every model we train starts from
Muse Glimmer or Muse Spark Open. Glimmer is the default; Spark Open is an
option, set as a stretch goal (phase G7; see "Base model" below). The prompted
baseline runs on Glimmer. The Forge stages R3 to R5 are broken into phases G2 to
G5 in "Glimmer Forge: workflow and phases".

| Stage | Track | Work | Gate to proceed |
| --- | --- | --- | --- |
| R0 | Both | Prompted Forge workflow, attempt log, eval harness (Phases 0 and 1) | An eval report exists: per-gate failure counts, first-attempt and final pass rates, cost and latency per job |
| R1 | Sculptor | Write the stability simulator; choose the brick vocabulary from Snap parts | Simulator agrees with hand-checked stable and unstable cases; the vocabulary seats cleanly in the assembly gate |
| R2 | Sculptor | Spike: warm-start on the public brick-structure set, generate a lattice-native set from clean meshes, fine-tune Glimmer once (QLoRA), run with rollback | Structures stand, and people recognize what they are against a bar written down before the run |
| R3 | Forge | Recipe compiler and sampler; gate-filtered (caption, recipe) set; failure to fix pairs; exemplars | Humans spot-check style and diversity; sampler diversity is measured |
| R4 | Forge | Glimmer QLoRA SFT, then rejection-sampling rounds with gates as a filter and taste as the objective (GRPO only if validity plateaus); detailed as phases G3 and G4 | Beats the prompted Glimmer baseline on pass rate and rating together, at lower cost per job |
| R5 | Both | Serve behind the same Worker and Gatekeeper contract; prompted workflow stays as fallback; define retrain triggers for catalog waves | Fallback verified by switching models in the eval |

Gate validity is a filter on training examples, not the thing maximized.
Optimizing pass rate alone teaches the model to emit boring shapes that always
pass, so watch pass rate and human rating together.

### Compute time and cost

| Stage | Wall-clock | Est. cost | Basis |
| --- | --- | --- | --- |
| Sculptor: generate about 50k structures | About 5 CPU-hours | Tens of dollars | D, from 0.35 s per structure (M) |
| Sculptor: captions | Unknown | $50 to $300 self-hosted | E |
| Sculptor: the paper's 1B baseline (reference only) | 12 h on 8 GPUs, about 96 GPU-hours | $150 to $350 per run at A100 rates | M: paper used 8x RTX A6000 for 3 epochs; the A6000 was not priced. Reference only, since the base model is now Glimmer. |
| Sculptor: Glimmer QLoRA spike (10k structures, 1 epoch) | About 4 days on 1 A100-80GB, or about 13 to 16 h on 8 | $250 to $350 | D, crude: the baseline scaled by 30x parameters and 1/14 of the data, with an A100 assumed at 2x an A6000 |
| Sculptor: Glimmer QLoRA full run | About 4 days on 8 H100 | $3k to $5k per run | D, crude, same basis |
| Forge: gate 50k recipes | About 24 CPU-hours | Tens of dollars | D |
| Forge: render and caption | Unknown | $50 to $300 | E |
| Forge: smoke test (30 to 100 steps) | Under 1 h | $3 to $5 | E |
| Forge: Glimmer QLoRA SFT pilot, 3k to 5k pairs | 3 to 5 h on A100; 1 to 2 h on H100 | $8 to $12 (A100); $4 to $8 (H100) | E: about 6 x 28B parameters x tokens at 70 to 110 TFLOPS effective, 600-token recipes, 2 to 3 epochs |
| Forge: Glimmer QLoRA SFT, 50k pairs, 3 epochs (about 90M tokens) | 2 to 3 days on A100; 15 to 22 h on H100 | $100 to $160 (A100); $60 to $90 (H100) | E, same basis. The linear bound from the paper (96 GPU-hours x 30) is $4k to $10k and assumes 4096-token samples. |
| Forge: one rejection-sampling round (16k to 40k samples, gates, short SFT) | About 5 to 8 h | $15 to $25 | E |
| Forge: GRPO (optional) | Unknown | Unknown; at least the SFT cost | No verified number. Only if validity plateaus. |
| Serving Glimmer (adapter or merged) | A recipe call about 10 to 20 s and a brick design about 40 to 80 s on one A100-80GB | $0.01 to $0.03 per recipe call; an always-warm A100 is about $1,800 per month | E: BF16 weights are about 60 GB, so decode is about 25 to 30 tokens per second; Modal A100-80GB at $2.50 per hour |

Cheapest first tuned Forge model on Modal: about $15 to $40 (smoke test, a
3k-pair pilot, one small rejection-sampling round), if 3k pairs are enough. With
a full SFT run and two rounds: about $200 to $300. The sculptor spike is the
largest line item. Multiply per-run costs by 3 to 5 for iteration.

GPU rates used: A100 80GB about $1.49 to $3.43 per GPU-hour; H100 about $2 to
$7 with a median near $3.37. Sources are vendor blogs from March to August 2026
and conflict, so check live pricing.

**Modal list prices (modal.com/pricing, read 2026-11-01).** A100-80GB $2.50 per
hour, A100-40GB $2.10, H100 $3.95, L40S $1.95, A10 $1.10, L4 $0.80; CPU about
$0.047 per physical core-hour. The Starter plan includes $30 per month in
credits and 10 concurrent GPUs. GPU functions are always preemptible (the
non-preemptible 3x price applies to CPU and memory only), so every training job
checkpoints to a Volume and retries.

**Local machines (updated 2026-11-01).** None can tune Glimmer. QLoRA of the 30B
model needs about 24 GB of GPU memory (Unsloth), so an 8 GB card (RTX 4060 or
3050) cannot, and a 32 GB Apple M5 would take weeks to months (E, scaled from a
1B run). Local machines are for debugging the pipeline on a small stand-in model,
CPU data generation (gating 50k recipes is about 4 to 8 hours on the M5, E), and
Glimmer 4-bit inference spikes (about 18 GB; MLX and llama.cpp support was still
rolling out). All Glimmer tuning runs on Modal. A 100-step timing run on Modal
gives the real tokens per second and replaces every compute estimate here.

**Base model (constraint, Dan, 2026-11-01).** Every model we train starts from
Muse Glimmer or Muse Spark Open. Glimmer is the default and the whole plan
below is costed on it. Spark Open is an option, not a constraint, and is set as
a stretch goal (G7): it is not ruled out, it just is not the starting point.
Glimmer: 30B dense (29.6B parameters, of which about 1.8B are a frozen vision
encoder), Apache 2.0 plus a separate usage policy, text and image in, text out.
Why Spark Open waits: about 816B total and 42B active parameters (inferred from
its model name, not stated on its page), no license text on its page, and about
410 GB of weights even at 4-bit (D); no tuning recipe for it was found, so it
has no cost estimate here. Unsloth's
Glimmer guide supports QLoRA (measured peak 22.57 GiB at sequence length 1024,
batch 1, r=16; plan on 24 GB). NVIDIA NeMo AutoModel has Glimmer recipes for
LoRA and full SFT but no QLoRA. Smaller open models (1B to 8B) are no longer the
plan; the published 1B baseline stays as a reference for time and cost only. A
linear scaling of its 96 GPU-hours by 30x gives a crude $4k to $10k per
full-data run (D); the token-based estimates above are far lower because Forge
recipes are short.

**Not in these numbers:** people time (the stability simulator, the eval
harness, exemplar recipes and the human taste ratings will likely cost more
than the GPUs); Spark's API price, which blocks a break-even comparison with
the prompted workflow; the share of rejected layouts in structure generation;
and retraining after catalog waves or schema changes.

## Glimmer Forge: workflow and phases

**Stretch goal (Dan, 2026-11-01).** This whole section is a stretch goal. Only
G0 is committed (it is Phase 0). G1 to G7 start if time and budget allow and
never block the Nov 4 submission.

**Constraint (Dan, 2026-11-01).** Every model we train starts from Muse Glimmer
or Muse Spark Open. Glimmer is the default for G1 to G6; Spark Open is an
option, set as a stretch goal (G7, see "Base model"). The prompted baseline runs
on Glimmer too, so the bar a tuned adapter must clear is base Glimmer with good
prompts, not a weaker model. Hosted Spark stays as the last model fallback.

**End state.** A kid describes something, photographs an object, or picks a
host (a head or a vehicle). A Glimmer adapter writes a Recipe v1. Legalizers
clamp it, the Python gates verify it, and a repair loop patches failures. The
result is a part that prints and seats on the toy, or a usable fallback: never a
blank screen, and never an unverified part called printable.

### Runtime workflow (every request)

1. **Intake.** The client calls `POST /api/forge` with text, a photo or a host
   id, then polls the job. The Worker applies the kid-safety prefix, the
   brand-term filter and the per-IP limits. Printing stays behind the grown-up
   gate.
2. **Photo path (F2).** Glimmer looks at the photo and returns ranked nouns, a
   role and a slot (A1). Hosted SAM 3.1 cuts the mask for `nouns[0]`. Code turns
   the mask into a width profile or contour. Later, optionally, SAM 3D slices
   add depth; adopt them only if the eval shows a lift.
3. **Context.** Code adds the slot bounds, the host envelope numbers (F4) and
   three to five nearest exemplar recipes. The base model needs the exemplars;
   the tuned adapter needs fewer.
4. **Write.** Glimmer, under one fixed system prompt (`Reasoning strength: low`),
   emits Recipe v1 with JSON-schema constrained decoding. The decoder removes
   syntax failures, so the adapter only has to learn what is valid and good.
5. **Legalize.** L1 slope clamp, L2 small-parts size band, L3 clamp.
   Deterministic and logged.
6. **Compile and gate.** The daemon's `compile_recipe_to_partspec` builds a `part_spec`;
   `validate_and_export()` runs the gates: overhang, islands, bridges, ledges,
   the small-parts screen, brand errors and the attach test on a reference
   parent.
7. **Repair.** On failure, code turns the report into `{gate, value, limit,
   hint}` and Glimmer patches parameters. At most 4 model calls per job.
8. **Return.** Pass: STL, preview, check results and an "AI-made" label. Still
   failing: the fallback chain, which is the nearest passing exemplar, then the
   closest catalog part, then "try this instead".
9. **Log.** Every attempt: recipe, gate report, model and adapter version,
   calls, latency and tokens. This is the next round's data.

### Training workflow (what makes it better)

1. **Data (G2).** Exemplars measured from the catalog, a sampler for random
   recipes within slot bounds, gate-filtered pairs, failure-to-fix pairs from
   deliberately broken recipes, and the attempt log. Eval prompts and slots are
   held out of training.
2. **Pilot SFT (G3).** Glimmer QLoRA on Modal with 3k to 5k pairs.
3. **Eval.** Same prompts, four contenders: hosted Spark prompted, base Glimmer
   prompted, base Glimmer with constrained decoding, and the adapter. Each runs
   the harness's three modes (single shot, plus legalizers, plus repair). Report
   first-attempt and final pass rate, mean calls, latency p50 and p95, tokens,
   failures per gate id, and a manual 1 to 5 taste rating.
4. **Refine (G4).** Rejection sampling: sample 8 recipes per prompt from the
   current model, keep gate-passers that humans rate well, and run SFT on them.
   Gates are a filter; taste is the objective.
5. **Ship (G5).** Serve on Modal; the prompted chain stays as the fallback.
6. **Retrain (G6).** On a catalog wave, a schema change, a new slot or pass-rate
   drift. Ship only if the new model beats the live one on the full eval.

### Modal setup

- **Training.** One image with Unsloth (versions pinned after G1) and
  `unsloth/Muse-Glimmer-30B-unsloth-bnb-4bit` (about 21 GB). Three Volumes:
  weights, data, checkpoints. `gpu=["H100","A100-80GB"]` (Modal may upgrade H100
  to H200 at no extra cost). GPU functions are always preemptible, so use
  `modal.Retries(max_retries=10, initial_delay=0)`, `single_use_containers=True`,
  a checkpoint every 50 to 100 steps, and resume from the last checkpoint.
  Launch with `.spawn()` and `modal run --detach`: the timeout caps at 24 hours
  per attempt and `.remote()` calls expire at 24 hours. One GPU per run; run 3 to
  5 variants side by side (Starter allows 10 concurrent GPUs).
- **Config start.** r=16 and alpha=16 (r=32 if the eval says the task is harder),
  learning rate 2e-4, 1 to 3 epochs, packing, `train_on_responses_only`,
  `adamw_8bit`, bf16, `finetune_vision_layers=False`, max sequence 1024 to 2048.
  Training prompts are short: no few-shot exemplars.
- **Serving.** vLLM or SGLang on Modal (OpenAI-compatible, per the model card),
  JSON-schema constrained decoding, scale to zero, and a GPU memory snapshot to
  cut cold start (not measured at 60 GB). If adapter serving fails, run
  `merge_and_unload()` and serve the merged weights.
- **Gates on CPU.** The Python gates run on Modal CPU or the local validator
  server, fanned out for batch jobs (about 24 CPU-hours per 50k recipes).

### Phases

| Phase | Scope | Needs | Cost (E) | Gate or stop rule | Target |
| --- | --- | --- | --- | --- | --- |
| G0 | Baseline and eval: Recipe v1 schema and compiler (built in the optimizer daemon, with L1 and L3), legalizer L2, model call and repair loop, CLI loop, eval harness (about 60 prompts), pre-generated showcase; prompted baseline on hosted Spark | Local venv and Spark key | No GPU spend | An eval report exists: per-gate failure counts, first-attempt and final pass rates, cost and latency per job | Before Nov 4 (this is Phase 0) |
| G1 | Glimmer baseline and smoke test: serve base Glimmer on Modal; run the eval prompted, with and without constrained decoding; 30 to 100 step QLoRA smoke test on about 50 recipes; record tokens per second, peak memory and cold start; test adapter serving | Modal account, G0 eval set | $5 to $20 | The smoke test saves an adapter; constrained output is valid JSON on at least 99% of calls (target); baseline numbers recorded; open question 15 answered. If Glimmer will not train or serve, stop and report. | Stretch goal; not needed for Nov 4 |
| G2 | Data: 10 to 20 exemplar recipes measured from catalog STLs; sampler within slot bounds; gate-filtered pairs; failure-to-fix pairs; programmatic captions first, Glimmer captions for a subset; held-out eval split; license manifest | G0 compiler and legalizers; gates on Modal CPU or the local validator | $1 to $3 CPU per 50k gate runs; captions $0 to $300 | Humans spot-check style and diversity; sampler diversity measured; no eval prompt or slot appears in training | After G1 |
| G3 | Pilot SFT: 3k to 5k pairs, QLoRA, 1 to 3 epochs, 2 to 3 variants in parallel; held-out eval against the G1 baselines. Starts only if the G1 baseline trips a Forge-model gate. | G1, G2 | $8 to $12 per run; about $30 for a three-way sweep | Beats the best prompted Glimmer baseline on first-attempt pass rate with no drop in rating. If not, stop spending: improve the data, try r=32, or stay prompted. | After G2 |
| G4 | Scale and refine: full SFT at 20k to 50k pairs if the pilot curve says more data helps; 1 to 3 rejection-sampling rounds; GRPO only if validity plateaus and a gate reward is stable; about 1,000 human taste ratings for filtering | G3 passed | $60 to $160 per full SFT; $15 to $25 per round | Beats the prompted baseline on pass rate and human rating together, at lower cost per job | After G3 |
| G5 | Serve and integrate: vLLM or SGLang on Modal behind `/api/forge` and the Gatekeeper contract; constrained decoding; adapter or merged weights; scale to zero; fallback chain tuned adapter, then base Glimmer prompted, then hosted Spark prompted, then catalog; "AI-made" label | G4 passed or G3 good enough | $0.01 to $0.03 per recipe call; avoid an always-warm GPU ($1,800 per month on an A100) | Fallback verified by switching models in the eval; p95 latency inside a budget set after measuring; cost per job measured | After G4 |
| G6 | Operate: retrain on catalog waves, schema changes, new slots and pass-rate drift; attempt log feeds the next rounds; optional SAM 3D depth experiment for F2; A6 failure-photo data | G5 live | Per retrain, as G3 and G4 | Every retrain reruns the full eval and ships only if it beats the live model | Ongoing |
| G7 (stretch) | Muse Spark Open as a base: repeat G1 on Spark Open (serve it, run the eval prompted, find a tuning path) and, only if that works, one pilot SFT as in G3 against the best Glimmer adapter | G5 live; Meta's license and terms for Spark Open stated; a tuning recipe and a serving stack that fit Modal; a reason to try it (the Glimmer adapter plateaus below the quality gate, or a larger model is wanted) | Not estimated: about 410 GB of weights at 4-bit means multi-GPU, and no recipe was found | Ship only if it beats the best Glimmer adapter on pass rate and rating together, at a cost per job the product can carry. If the license, tuning path or cost fails, stop; Glimmer stays. | Post-submission, after G5 |

Every phase has a stop rule: when its gate fails, stop spending, record the
numbers, and either fix the data or stay on the prompted chain.

**How this maps to the other tables.** G0 is Phase 0 and R0. G2 is R3. G3 and G4
are R4. G5 is R5 on the Forge side. Phases 0b to 2c (assists, F4, F5, A6) are
unchanged. The brick sculptor stays parked at R1 and R2 until it has its own
product spec; its Glimmer spike ($250 to $350) is the largest GPU line item.

**Budget.** The cheapest path to a first tuned Forge model is G1, G3 and one
small round of G4: about $15 to $40 (E), if 3k pairs are enough. With a full SFT
run and two rounds: about $200 to $300. People time (compiler, sampler, taste
ratings) is not included and will likely exceed the GPU bill.

## Phases

| Phase | Scope | Needs | Target |
| --- | --- | --- | --- |
| 0 | Model call and repair loop, legalizer L2, CLI loop, eval harness, pre-generated showcase set (F1, F3 core); the Recipe v1 compiler, L1, L3 and the gate server already exist in the optimizer daemon | Local venv and Spark key only | Before Nov 4 |
| 0b | A1 vision spike then flow, A2 template table then model rewrite, `worker/assist.ts` | Spark key only; no validator | Before Nov 4 if the vision spike passes |
| 1 | `/api/forge` job route, local validator server (the optimizer daemon, partly built), F2 profile extraction and printable path, attempt log, UI entry points | Phase 0 | Nov 4 stretch, otherwise right after |
| 1b | Validator in a Container or Sandbox | Phase 1 | After submission |
| 2 | F5 planner (plan and edit modes, which also delivers A4), F4 host argument, host-envelope export, A5 templates | Phase 1 validator | After submission |
| 2b | F4 cavity-hat builder | Phase 2 | Later |
| 2c | A6: print about 10 failure coupons, photograph and label them, run the eval, then build the triage flow and fix cards | Phase 0b vision spike | After submission |
| 2d | F6 Finish it: a spike on 3 real assembled builds (smoothing method, gates, time), then the game path (polished GLB), then the print path | Phase 2 (F5 supplies assembled builds); open questions 20 to 23 answered | After submission |
| 3 | Forge model track G0 to G6, G7 as a stretch (see "Glimmer Forge: workflow and phases"); sculptor stages R1 and R2 behind their own gate | Phase 1 attempt log and eval numbers | G0 is Phase 0 (before Nov 4); G1 to G7 and the sculptor are a stretch goal |

Honest demo framing for Nov 4: Phase 0 outputs are pre-generated and
verified; the live flow, if any, is one hero path. Say so in the demo script,
as `spec.md` already does with its "mocked or pre-made" column.

## Gates for the Forge model

The Forge model (roadmap R3 and R4, phases G2 to G5) is trained only if the eval shows one of
these after legalizers and repair are in place:

- Final pass rate stays below about 70% because the geometric intuition behind
  the gates is not prompt-teachable.
- Cost or latency per job is unacceptable at expected volume.
- A hard privacy requirement for self-hosted weights.
- Taste: ratings stay low on valid parts.

**First reading (2026-11-02, updated after the first taste check).** The Spark
baseline's final pass rate was 83% with prompt v0 and is 100% with prompt v1 (78%
on the first attempt both times), well above the 70% line, so the pass-rate gate
is not tripped. The taste gate looks tripped: Dan's first 19 ratings average 1.47
with none above 3. The cause is open (see "First taste check"): the recipe cannot
express many requests, and the prompt may be narrowing variety. A tuned model
cannot add shapes the recipe cannot make, so richer recipe ops and a taste loop
come before any tuning. Latency is fine and Spark's price is unknown.

If tuning is chosen, the training set is the gate-filtered sampler output plus
the attempt log (see "Data plan"). The base model is Muse Glimmer (Dan's
constraint, 2026-11-01; see "Custom model roadmap"). These gates decide how much
to spend on tuning, not whether Glimmer is used: the prompted baseline runs on
Glimmer too. Spark Open is a stretch option (G7) and would face the same gates.
The license assumption in "Data
plan" covers external datasets; Meta's terms on training from Spark outputs are
not stated on the pages reviewed, so caption with self-hosted Glimmer (Apache
2.0; its separate usage policy does not mention fine-tuning, derivatives or
training on outputs) or confirm Spark's terms first.

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
9. **Own models (Glimmer Forge G1 to G6, Spark Open G7, brick sculptor):** The
   whole track in "Glimmer Forge: workflow and phases" is a stretch goal; only
   G0 (Phase 0) is committed. Spark Open (G7) is an option under Dan's
   constraint, not a requirement; it needs Meta's license terms, a tuning path
   and a serving stack first (open question 18).

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
- Training a model that starts from neither Muse Glimmer nor Muse Spark Open
  (Dan's constraint, 2026-11-01). Spark Open is a stretch option (G7), not a
  requirement.

## Open questions (resolve by measurement, not debate)

1. Validation latency per recipe, including the assembly attach test; it sets
   the job time budget. First numbers (2026-11-02, crown hats through the
   optimizer daemon, one worker): 3.0 to 5.4 s for the first three jobs (load
   not measured), then 7.3 to 31.3 s for nine more, with a load average of 55
   measured afterwards. Budget 5 to 30 s per validation until it is measured on
   a quiet machine; four repair rounds then add 20 s to 2 min before model time.
   Baseline run (94 jobs, load average 73 falling to 20): validation p50 2.5 s,
   p95 16.3 s.
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
15. Glimmer training: tokens per second, peak memory at 1024 and 2048 tokens,
    whether text-only LoRA works with `finetune_vision_layers=False`, the LoRA
    target-module names, and whether vLLM or SGLang serve a Glimmer LoRA
    adapter. The G1 smoke test answers all four.
16. Glimmer's usage policy says it is "not intended for individuals under the
    age of 18", bars inferring private information about individuals, and bars
    presenting outputs as human-made. Our users are children, though the model
    is only called server-side. Does that need a policy review, and does Meta's
    safety post-training survive fine-tuning (the model card does not say)?
17. Which model runs the prompted baseline: hosted Spark or self-hosted base
    Glimmer. Base Glimmer with good prompts and constrained decoding is the bar
    a tuned adapter must clear; running the baseline on Glimmer also keeps it
    comparable with the tuned adapter.
18. Spark Open as a base (stretch G7): Meta's license and terms for it, whether
    its parameter counts are as inferred (816B total, 42B active), whether any
    tuning recipe exists, and what serving costs on Modal. G7 does not start
    until these are answered.
19. Contract alignment with the optimizer lane. The outer Forge job
    (`POST /api/forge`; stages `proposing`, `checking`, `repairing`) versus the
    lane's routes and job states (`/api/forge/preview`, `/api/forge/jobs/:id`;
    `queued` to `print_ready` or `digital_only`). Proposal: keep the Forge job
    as an outer layer that hands each recipe to an optimizer job and returns its
    `job_id`; give the outer poll route another name; treat the lane's Recipe v1
    limits (2 to 16 slices, `knob` and `brim` only, `support_policy`) as
    canonical and add `ears`, `fin`, `antenna` and `band` only when the eval
    shows a need. The lane's owner agrees this before any Phase 0 change to its
    files. Also for that owner: the daemon's hand path hardcodes
    `fillet_r = 1.4` for `star2d`, while the verified `custom_star_wand` uses
    1.6. In an SDK-only test (2026-11-02) the same star passes at 1.6 and fails
    `G1_watertight` and `G3_single_body` at 1.4 (`center_z` made no difference),
    and 5 of the 6 star shapes tried through the daemon failed. A first fix
    changed a variable that star shapes never read, so the baseline below still
    ran at 1.4. The real fix (uncommitted, 2026-11-02) passes `fillet_r` into
    `star_2d`; Spark's three failing first-try stars (5 points 14/6.5, 6 points
    14/7, 10 points 12/9) now pass through the daemon's compile path. The lane's
    follow-up branch still has the original line.
20. F6, display or wearable? Should a finished object stand alone, or keep its
    socket footprint so it still attaches to a head or vehicle? One finish
    recipe can serve both; the gates differ.
21. F6, moving parts. Do wheels, hands and hinges fuse into the body (a static
    display model) or stay separate printed pieces with their axles?
22. F6, size. A finished car can exceed the print bed (`limits.bed_mm` in
    `interfaces.json`). Scale it down, split it into pinned pieces, or refuse and
    offer a smaller finish?
23. F6, colour. Game-only colour zones, one printed colour, or multi-colour
    printing as separate bodies per colour?
24. Concept-image path for F1. Can Muse Image generate from text alone? The repo
    uses it for edits only. If so: front and side images, SAM masks, width and
    depth per height, loft slices fitted to the outlines and scored by overlap
    with the mask. Needs image-generation access, latency and cost, a kid-safety
    and brand filter on generated images, and richer recipe ops, because an
    outline cannot make separate ears, horns or crown points.
25. Taste loop. Iterate until a judge scores "fine" (3) or better. The judge is
    either silhouette overlap with a concept image, or a vision model scoring
    renders against the request, calibrated on Dan's ratings with some held out.
    Cap the iterations, stop early when the recipe cannot express the request,
    and fall back to the nearest catalog part.

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
