# Spec: SAM Physical-to-Digital — Sketch Parts, Twin Sync, Room Levels, Real-Life Quests

Companion to [forge-ai-spec.md](forge-ai-spec.md),
[scan-to-3d.md](scan-to-3d.md),
[app-continuation-spec.md](app-continuation-spec.md),
[carousel-modes-ladders-spec.md](carousel-modes-ladders-spec.md), and
[play-design-spec.md](play-design-spec.md) (the level lane Feature 3 joins).
Scopes items **1, 2, 3, 6** of the Physical-to-digital stretch list in
[spec.md](../product/spec.md) (§Physical-to-digital SAM 3.1 + Muse stretch).
Items 4 (Upcycle Lab), 5 (Calibration Doctor), and 7 (Max Exhaust) are
explicitly out of scope here. No implementation starts until §10 sign-off.

> Status: **DRAFT — for review.** Resolved 2026-11-02: separate spec
> (this file), strict backward compatibility, single-photo ephemeral.
> Acceptance numbers below are **targets to measure**, never shipped
> claims, until eval results replace them.
>
> Implementation note 2026-11-02: the Feature 3 core landed ahead of
> §10 sign-off — `composeLevel` `pinnedProps` (K1) and the room prop
> pack (K2) in `runtime/levelKit.ts`/`catalog.ts`, plus the pure
> photo-segments-to-level mapper in `runtime/roomPhoto.ts` with
> `tests/room-photo.test.ts`. No user-facing photo flow ships until
> sign-off and S0b; Features 1, 2, and 6 have no implementation.
>
> Code-verified review applied 2026-11-02: every claim about the Worker,
> the level format, chore XP and privacy was checked against the repo
> and corrected (§1, §2, §3, §6, §7, §8). Feature 3 is re-scoped to ride
> the level composition kit. New open questions Q7-Q10 are listed in
> §11; Q7 and the S0b route gate block anything user-facing.

## 1. Goal & hard rules (all four features)

Turn one ephemeral phone photo into something playable or printable,
with `SAM 3.1` supplying masks and `Muse Spark` supplying bounded
choices/JSON — while deterministic code decides every fact, gate, and
action (standing rule in [spec.md](../product/spec.md) and
[forge-ai-spec.md](forge-ai-spec.md) §Shared engine).

1. **Strict backward compatibility.** `toyventor.toy/1`
   (`shared/toycontract.ts`), `Toy` (`shared/toy.ts`),
   `toyforge:progression:v1` (`src/lib/progression.ts`), part ids, and
   print gates do not change shape. New data is additive, optional,
   and ignored by old clients. A scan failure always degrades to
   today's behaviour (seed-toy backup, template copy, parent confirm).
2. **Single-photo ephemeral.** Each flow takes **one** photo per check.
   The raw photo is used for the SAM/vision call and then discarded:
   never persisted, never synced, never logged. What survives is only
   the derived summary (mask outline/anchors/numbers, catalog ids,
   recipe JSON, pass/fail flags) — the same class of data
   `shared/sam.ts` already stores. Feature 6 tidy-delta is two
   *sequential* single-photo checks (before summary → after photo);
   no photo pair is ever retained (§7.2). The photo does leave the
   device once: our Worker forwards it to the SAM provider. "Discarded"
   therefore means *we* never store, sync or log it. What the provider
   retains is governed by its terms, which this repo does not record
   yet (Q7), so no UI copy may promise provider-side deletion until it
   does.
3. **Model chooses, code decides.** Models emit only: nouns, slot/stat
   picks from closed enums, Recipe v1 JSON, catalog ids, level JSON
   from closed catalogs, or one cause/quest verdict from a closed
   list. Code computes masks, sizes, placements, gates, XP, and every
   user-visible number. Model-written code/meshes/settings never run.
4. **Honest print claims.** "Printable" requires the existing Python
   gates (`validate_and_export`, preprint checks) to pass. Anything
   else is labelled digital-only in UI copy. Grown-ups gate every
   print/share export behind the existing PIN flow.
5. **Freeze respect.** Everything here is stretch: it ships only after
   the 90-second demo path, remote D1 migration, and live deploy are
   green ([spec.md](../product/spec.md) §stretch preamble). Scan Assist
   (forge-ai A1) is the shared prerequisite spike (§3).

## 2. Already in the repo (do not rebuild)

| Piece | Where | Used by |
| --- | --- | --- |
| SAM 3.1 Worker lane: `segmentToy` (largest match + mask summary) and `segmentBoxes` (every match, **boxes only**). One noun per upstream call | `worker/meta.ts`, `worker/index.ts` `handleScanPost`, `POST /api/scan` | All four |
| Mask summary (48×36 silhouette, anchors, coverage, px size) | `shared/sam.ts` | All four (extended per §3) |
| Official-parser + box fallback decision | `docs/decisions/0006-sam-mask-decoding.md` | All four |
| Scan client + downscale (512 px edge) + seed backup | `src/features/scan/scan.ts`, `src/lib/api.ts` | 1, 2 |
| Forge Recipe v1 compiler + gates + repair loop design | [forge-ai-spec.md](forge-ai-spec.md) F1–F3, `shared/forgeOptimizer.ts`, `scripts/forge_optimizer_daemon.py` | 1 |
| Digital-only mask→contour accessory (`prints: false`) | `public/kip/kip-forge-sdk.js` | 1 fallback |
| Compact catalog + build examples (counts live in the files; do not restate them here) | `parts/partspec/ai_catalog.txt`, `build_examples.json` | 2 (+ F5 planner) |
| Toy/build validation + placement checks | `shared/build.ts`, `shared/checks.ts`, `shared/partspec.ts` | 1, 2, 3 |
| Level editor + recipe import/export + checks (`edChecks` covers the five hiding spots only, not props) | `EditorPanel`, `runtime/editor.ts`, `runtime/editorData.ts`, `createData.ts`, `toyventor.level/1` | 3 |
| Real-life routines (+25 XP, parent-enabled) | `src/lib/dailyQuests.ts` `REAL_LIFE_CHORES`, progression chore fields | 6 (extends, never replaces) |
| Parent gate + play-time ledger | `GrownUpsSheet`, `shared/parent-time.ts` | All (consent/print) |
| Scan eval fixtures | `tests/fixtures/scan-targets.json`, `tests/scan-targets.test.ts`, `tests/sam*.test.ts` | §9 eval |
| Level composition kit: seeded composer from closed catalogs, plus `checkLevel` (the editor's rules restated, property-tested on 3,000 seeds) | `runtime/levelKit.ts`, `tests/level-kit.test.ts` | 3 (backend and fallback) |
| Create-mode noun-to-prop words and the per-prop builders | `runtime/world.ts` `WP`, `CHIPS`, `propBuilders` | 3 |
| Parent proof plus per-device and per-IP budgets on a metered route | `worker/forgeOptimizer.ts`, `worker/parent.ts` (`verifyParentProofFromRequest`), `worker/selfie.ts` | All (pattern for §8) |

## 3. Shared prerequisite: mask geometry upgrade + Scan Assist spike

Before Feature 1 or 3 can build geometry, the display-grade silhouette
must gain geometry-grade facts (forge-ai F2 requirement, restated as
the single shared task):

- Extend the Worker mask decode (`worker/meta.ts` → `shared/sam.ts`
  summary) with: a normalized **width profile** (32–48 rows of
  half-widths) and a **simplified contour polygon** (bounded point
  count, storage-safe), computed from the already-decoded raster.
  Both are optional additive fields; old summaries stay valid.
- **Scan Assist spike first** (forge-ai A1, ~1 hour): confirm hosted
  Spark vision reads images via the Responses API on 10 staged
  photos. If it fails, A1-style noun help is cut and every feature
  here falls back to client/parent-supplied nouns — features 1, 2, 3,
  6 still work with typed/tapped nouns.
- Multi-instance **boxes** (all matches, not largest-only) exist as
  `segmentBoxes`. Per-instance **masks do not**: it returns boxes only,
  so a mask summary per match (Feature 2) needs a new per-box decode on
  top of `decodeMaskSummary`. Features 3 and 6 need boxes and counts
  only. Every call carries one noun plus the whole image, so a job with
  N nouns is N upstream calls, each allowed up to `SAM_TIMEOUT_MS`
  (20 s). Every job therefore gets a **call budget** (max nouns,
  parallelism cap, one total deadline), fixed in §8 before any
  multi-noun feature builds.

Durable tests (§9): unit tests for profile/contour derivation from
fixture rasters join `tests/sam.test.ts` with the change — not after.

---

## 4. Feature 1 — Kid Sketch / Clay → Printable Snap Part

Source line: [spec.md](../product/spec.md) — "SAM 3.1 segments a paper
drawing or clay sculpt off the table → Muse assigns slot and stat →
deterministic contour extrusion/loft adds a verified 12.5 mm TU snap
socket." This is forge-ai **F2 (Scan it, wear it)** narrowed to
kid-made flat/round objects. Where this section and F2 differ, F2's
engine (Recipe v1, legalizers, repair, Gatekeeper) wins; this section
adds only scope, UX, and acceptance.

### 4.1 Flow (single photo, ephemeral)

1. Child photographs a drawing (paper on table) or clay sculpt, framed
   by the existing scan UI. Optional parent/kid noun hint ("dragon").
2. Worker: SAM segments the subject off the table (largest match;
   Scan Assist nouns if the §3 spike passed). Raw photo discarded
   after the call; mask summary + §3 profile/contour survive.
3. Deterministic shape first (no model redraw): flat subjects
   (drawings, flat clay) → contour → Recipe `profile2d`; round
   subjects (cup-like clay, balls, bells) → width profile → `loft`.
   A flatness/roundness heuristic in code picks the path; the other
   path is the retry on gate failure.
4. Muse Spark chooses only: `slot` (closed Recipe enum), `stat`
   (Speed/Spin/Torque/Glow), name, profile inversion (round path),
   and ≤ 6 allowlisted `features`. It receives numbers as text.
5. Compiler adds the slot's verified TU snap socket (12.5 mm grid per
   the partspec SDK), legalizers clamp, `validate_and_export` gates.
   Failures enter the F3 repair loop (≤ 4 model calls/job).
6. Pass → bridged via `convertPartSpecPart`, tagged `custom`, playable
   immediately and exportable via PrintDrawer (PIN-gated).
   Fail after repair → today's digital-only accessory
   (`kip-forge-sdk.js`, `prints: false`), labelled digital. Never a
   dead end.

### 4.2 Scope grid (cell source: S = product spec line, F = forge-ai spec, C = today's code, — = unmapped)

| Aspect | v1 scope | Source |
| --- | --- | --- |
| Input | One photo, paper drawing or clay on a table; optional noun hint | S |
| Segmentation | Largest SAM match; box fallback kept | C (`worker/meta.ts`, decision 0006) |
| Geometry paths | `profile2d` (flat) / `loft` (round), deterministic from mask | F (F2) |
| Socket | Verified 12.5 mm TU snap socket via SDK slot builders | S + C (`kip_partspec_sdk.py`) |
| Model output | Slot, stat, name, invert flag, allowlisted features only | F (Recipe v1) |
| Print gate | `validate_and_export` + preprint checks; else digital-only label | F + C |
| Storage | Recipe + summary only; raw photo discarded | §1 rule 2 (this spec) |
| Multi-part sculpts (e.g. clay car + wheels) | — (single part only in v1) | — |
| Colour/texture from photo on print | — (digital accessory keeps photo texture; print is one colour) | C (`kip-forge-sdk.js`) |

### 4.3 Acceptance targets (measure before claiming)

Reuses F2's targets: 10 staged subjects (kid drawing, flat clay,
round clay, cup, bottle, bowl, shoe, toy car + 2 hard cases) × 3
roles each → ≥ 70% verified printable with no model repair, 100%
something usable. Plus: 0 brand violations; every shipped part passes
the real attach test; end-to-end job completes within the staged
"Forging…" UX budget set by F3 measurements.

## 5. Feature 2 — Physical Build → Digital Twin Sync

Source line: [spec.md](../product/spec.md) — "One desk photo segmented
by SAM 3.1 across printed modules (head, hat, wheels, chassis) and
matched by Muse against `ai_catalog.txt` into a playable
`toyventor.toy/1` build, lifting custom marker/sticker art via Muse
Image."

### 5.1 Flow (single desk photo, ephemeral)

1. Child photographs their assembled printed toy on a desk/table
   (guided framing: whole toy visible, plain background preferred).
2. Worker runs multi-instance SAM per module noun from a **closed
   noun list** derived from the catalog's lines (Character/Vehicle
   slots first). Each match yields a box and position (a mask summary
   per match only after the §3 per-instance decode), then the photo is
   discarded.
3. Muse Spark matches each segment to catalog ids from
   `ai_catalog.txt` (enum-constrained output, F5 pattern): ranked
   candidates per segment with a confidence word (`high`/`low`).
   It sees boxes/summaries/catalog text — not free-form geometry.
4. Code assembles the candidate build (archetype, slot picks, poses
   from segment layout) and validates with `runChecks` + assembly
   validation. Low-confidence or illegal picks drop to the nearest
   valid alternative; the child confirms/corrects on a preview
   ("Is this your toy?") — confirm-not-annotate, per the future-vision
   suggester rule. Correction is the label; nothing auto-locks.
5. Confirmed build saves as an ordinary `toyventor.toy/1` toy
   (contract untouched) and plays immediately. Marker/sticker art:
   v1 copies the **segment's dominant colours** into paint zones only;
   Muse Image sticker-lifting is phase 2 (see grid).

### 5.2 Scope grid (S = product spec, F = forge-ai/future-vision, C = code, — = unmapped)

| Aspect | v1 scope | Source |
| --- | --- | --- |
| Input | One desk photo of an assembled ToyVentor build | S |
| Segmentation | Multi-instance SAM, closed module-noun list, capped | S + C (`segmentBoxes`; masks need the §3 decode) |
| Matching | Muse ranks `ai_catalog.txt` ids per segment (enum output) | S + F (F5 retrieval pattern) |
| Output | Ordinary `toyventor.toy/1` build after child confirm | S + C (contract unchanged) |
| Validation | `runChecks` + assembly gate; illegal picks replaced/dropped | C (`shared/checks.ts`, `build.ts`) |
| Paint | Dominant segment colours → paint zones | This spec (v1 cut) |
| Marker/sticker art lift (Muse Image) | Phase 2, after v1 matching eval | S (deferred here) |
| Non-ToyVentor toys (generic desk objects) | — (falls back to today's single-toy scan) | — |
| Pose accuracy (exact joint angles from photo) | — (slot-level fidelity only; stage poses are canonical) | — |

### 5.3 Acceptance targets

Eval set: 15 photographed builds (5 Character, 5 Vehicle, 5 mixed/
custom-part builds, home lighting, two backgrounds). Targets:
≥ 80% of visible modules matched to the correct catalog id in the
top-1 pick; 100% of saved builds pass validation (by construction);
child confirm/correct step required on 100% of saves; zero saves
without preview. Custom (`custom_*`) parts match by slot+silhouette
or report "unknown part" honestly — never a forced wrong id.

Feasibility spike before S4 builds any matching: run SAM alone on the
15 photos and count how many separate snapped, same-colour printed
modules at all. Muse sees only boxes and 48x36 silhouettes, so if SAM
merges the modules the matcher has nothing to match. Proposed
threshold: if fewer than half of the modules separate, Twin Sync
becomes "pick the parts from the catalog by slot" and the photo only
seeds paint colours.

## 6. Feature 3 — Living-Room Course → Playable 2.5D Level

Source line: [spec.md](../product/spec.md) — "SAM 3.1 segments floor
props (book, cup, pillow, box) from a side photo → Muse Spark maps
their positions and heights into a playable `toyventor.level/1`
obstacle course."

**Re-scoped after the code review (2026-11-02).** `toyventor.level/1`
has no obstacles. A prop is `{type, x, z?, y?}` from a closed catalog:
no height, no width, nothing collides. The editor's checks constrain
only the five hiding spots, and the repo has no solver. "Obstacle
course" and "the toy can pass each obstacle" therefore cannot be built
or gated on `level/1`. v1 is a **room-themed level**: the photographed
props set the scenery order and rhythm, and the game on top is today's
hide-and-seek with free STEM stations. Photo-derived obstacles are v2
and wait for the `level/2` obstacle primitive and solver
([play-design-spec.md](play-design-spec.md) §Plan, Q8 below). The
product spec's wording ("obstacle course") stays until sign-off; if the
re-scope is accepted, `spec.md` gets a one-line edit.

### 6.1 Flow (single side photo, ephemeral)

1. Child lines up soft/stable floor props and takes **one side-on
   photo** (guided: floor line visible, props spread left→right).
   A printed 1×1 TU tile in frame (optional in v1) gives scale;
   without it, heights are relative bands, never mm claims.
2. Worker: SAM boxes over a closed prop-noun list (`book`, `cup`,
   `pillow`, `box`, `shoe`, `toy car`, … — final list is data, capped
   at ~12 nouns / ~16 instances, inside the §8 job budget). Per prop:
   x-order, width fraction and a height **band** (low / mid / tall),
   all from the box. Photo discarded.
3. Deterministic mapping, no model: a closed noun → prop table (data,
   seeded from the Create-mode words in `WP`) maps each noun to a
   catalog prop. A noun with no counterpart maps to the nearest shape
   class or is dropped. Photo order is preserved along x 2..43 (the
   lane is 0..45; spots live in 4..42).
4. The kit composes the rest around the pinned props: five hiding
   spots in the gaps (junk machine first, at least three moves), one
   or two free stations, a mood. `composeLevel` gains a `pinnedProps`
   option (new work, K1 in play-design-spec §Plan). Muse Spark's only
   optional role is picking theme, mood and a name from the kit's
   closed lists; code composes everything else.
5. Gates before play: schema, catalog membership and `checkLevel` (the
   editor's own rules). On failure: one repair (re-compose spots with
   the next seed), then fallback to the same composer with no pinned
   props and the same prop count. No solver in v1.
6. Level opens in the editor (kid can nudge/delete) and plays
   immediately. The seed code is kept so it can be replayed.
   Family-private by default; sharing only via the existing
   parent-approved paths. Saved artifact = `level/1` JSON (+ optional
   `seed`, `mood`). No room photo, no background pixels retained.

Props are code, not data. The `room` theme has three props (`lamp`,
`books`, `blocks`) and each prop is a procedural builder in
`propBuilders` (`world.ts`), so `cup`, `pillow`, `shoe` and `toy car`
have no counterpart today. A **room prop pack** (K2: proposed 4 to 6
props, each a builder plus a `PROPS` and `CLUSTERS` entry and a test)
is part of S3, not a data change.

### 6.2 Scope grid (S = product spec, P = play-design spec, C = code, — = unmapped)

| Aspect | v1 scope | Source |
| --- | --- | --- |
| Input | One side-on photo of floor props; optional TU scale tile | S (tile optional: this spec) |
| Props | Closed noun list, capped instances; largest overlaps win | S + C |
| Mapping | Closed noun → catalog prop table; x-order kept; height as a band only | This spec + C (`WP`, `propBuilders`) |
| Composition | Kit pins the photo props, composes spots, stations, mood around them | C (`levelKit.ts`) + K1 `pinnedProps` |
| Drafting | None for geometry; optional Spark pick of theme/mood/name from closed lists | This spec |
| Gates | Schema + catalog membership + `checkLevel`; no solver in v1 | C (`edChecks`, `checkLevel`) |
| Play/edit | Opens in Editor; kid edits; family-private default | C (`EditorPanel`) |
| Obstacles a toy must pass, and a solver gate | v2: needs the `level/2` obstacle primitive (Q8) | P (§Plan step 2 and 3) |
| True-scale heights (mm) without TU tile | — (relative bands only) | — |
| Multi-row / depth courses (props behind props) | — (single lane, side view) | — |
| Moving props (pets, people in frame) | — (rejected with a re-take prompt; the photo has already left the device by then, §1 rule 2) | — |

### 6.3 Acceptance targets

Eval: 10 staged room photos (3–10 props, varied light/floor). Targets:
100% end playable (template fallback counts) and pass `checkLevel` (by
construction; property-tested over seeds and pinned layouts); prop
order preserved left→right in 100% of successes; at least 70% of
detected props map to a real catalog prop rather than the shape-class
fallback (measure it, it depends on K2); zero levels save with a
retained photo (byte-scan test); a first-time child reaches play from
photo in ≤ 3 taps after capture.

## 7. Feature 6 — Privacy-Safe STEM Scavenger & Tidy Quests (Real Life Counts 2.0)

Source line: [spec.md](../product/spec.md) — "Ephemeral SAM 3.1
target-noun masks (zero background room pixels stored) verify
tidy-up deltas and real-home lever/gear scavenger hunts." Extends
today's parent-confirmed routines (`REAL_LIFE_CHORES`, +25 XP);
never replaces the parent-confirm path.

### 7.1 Two quest shapes

- **Scavenger (single photo):** "Find a lever at home!" Child
  photographs the candidate (door handle, seesaw, bottle opener…).
  SAM runs the quest's closed target-noun set; Muse picks one
  verdict from a closed list (`lever` / `gear` / `wheel` / `not-yet`)
  with a confidence word. Match + parent-enabled quest → completion
  recorded exactly like a chore (`completedChoresByDay`-style
  additive field or chore-id reuse — decided in §8: new ids in
  `completedChoresByDay`). XP mirrors routines (+25 per quest id per
  day, §7.3).
- **Tidy-delta (two sequential single photos):** "Tidy the bench!"
  Photo 1 (before): SAM counts target clutter nouns (`book`, `toy`,
  `clothes`, `cup`…) on the named surface; only **counts + mask
  summaries** are kept, photo discarded. Child tidies. Photo 2
  (after): same nouns recounted. Delta ≥ quest threshold (data, e.g.
  `≥ 50%` fewer target instances, min 2 removed) → verified.
  Anything ambiguous → warm "ask a grown-up to check" fallback to
  today's parent-tap confirm. The system never shames a "still
  messy" result; copy stays positive ("I can still see 3 books —
  nearly there!").

### 7.2 Privacy contract (the feature's reason to exist)

- Zero background room pixels stored: the server response and device
  storage carry only noun → {count, coverage, coarse box} facts.
  The coarse silhouette path is **not** saved for Feature 6 (counts
  suffice) — stricter than the scan default.
- Photos transit the existing SAM path only (the Worker's call to
  the provider): no image in our logs or analytics, and nothing of
  ours trains on them. "No training use" *by the provider* is a claim
  we can only repeat once Q7 records their terms. The Worker today
  logs the noun prompt (`sam_scan`, up to 60 free-text characters);
  with free-text hints from a child (Feature 1) that stops: closed
  lists only, or the prompt is dropped from the log.
- Consent: one **photo-features opt-in** in the Grown-ups PIN gate,
  default **off**, covering Features 1-3 and 6, plus a per-quest-type
  switch for Feature 6 (reusing `enabledChoreIds`). There is no camera
  or mic lock in the repo today (searched `src`, `shared`, `worker`),
  so this opt-in is new. It is enforced server-side with
  `x-parent-proof` on the photo routes, as Forge and Selfie do, not
  only hidden in the UI.
- On-device copy before first use promises only what we can stand
  behind: "We check the photo, then we throw away our copy. We only
  keep the count." Provider-side deletion is added to that sentence
  only if Q7 confirms it.

### 7.3 Scope grid (S = product spec, C = code, — = unmapped)

| Aspect | v1 scope | Source |
| --- | --- | --- |
| Quest types | Scavenger (1 photo) + tidy-delta (2 sequential photos) | S |
| Verification | SAM counts + closed-list Muse verdict; parent fallback always available | S + C (parent-confirm today) |
| Storage | Counts/boxes only; no photo, no silhouette for this feature | S ("zero background pixels") |
| XP | +25 per quest id per day, as code pays today (`CHORE_QUEST_XP`, deduped by id + day; there is no shared daily cap). Tidy-delta reuses `tidy-bench`, so a photo verify and a parent tap pay once by construction. Scavenger quests are new `REAL_LIFE_CHORES` ids and pay in addition; a cap across quests is Q10 | C + this spec |
| Enablement | Parent opt-in per quest type, default off, PIN-gated | C (`enabledChoreIds`; `completeRealLifeChore` rejects ids that are not enabled) |
| Anti-gaming (photo of a screen, same photo twice) | Basic: per-day caps + parent visibility; no liveness tech in v1 | This spec |
| Judging *quality* of tidy (folded vs stuffed) | — (counts only, by design) | — |
| Multi-room / whole-house quests | — (one named surface per quest) | — |

### 7.4 Acceptance targets

Eval: 20 staged scavenger photos (10 true targets incl. tricky
non-examples) + 10 before/after tidy pairs. Targets: scavenger
precision ≥ 90% (false "found it!" is the costly error), recall
≥ 70% with the re-take/parent path covering misses; tidy-delta
agrees with a human rater on ≥ 85% of pairs; 100% of runs leave zero
stored image bytes (audited in test); parent fallback reachable in
≤ 2 taps from any verdict.

## 8. Cross-cutting: storage, routes, rollout

- **Storage (additive only):** mask summaries gain optional
  `profile`/`contour` (§3); Feature 2 saves ordinary toys; Feature 3
  saves ordinary `level/1` recipes (plus the already-additive `seed`
  and `mood`); Feature 6 reuses `completedChoresByDay` with new quest
  ids. `normalizeProgression` keeps unknown string ids, so old clients
  carry them unharmed (checked in code). `completeRealLifeChore` only
  accepts ids listed in `REAL_LIFE_CHORES` and enabled, so scavenger
  quests are new entries there; that also changes the Grown-ups
  routines list and any test that asserts five. Nothing renames or
  repurposes an existing key.
- **Routes:** prefer extending `POST /api/scan` with a `mode`
  discriminator (`toy` default = today) over new endpoints; Forge
  jobs keep the optimizer-lane routes (forge-ai open question 19
  owns naming).
- **Gate before multiplying (S0b).** `POST /api/scan` has no rate
  limit and no parent proof today. Limits exist only on the Muse route
  (in-isolate, best effort) and on the Forge optimizer (per device and
  IP, with `x-parent-proof`). Photo modes and routes added here follow the Forge
  pattern: parent proof, per-device and per-IP budgets, a **job
  budget** (max nouns per job, parallelism cap, one total deadline,
  today's 2 MB image cap) and a daily ceiling on upstream SAM calls.
  Putting the same limiter on the existing `/api/scan` is part of S0b,
  because every feature here multiplies calls by its noun count.
- **Rollout order (each behind the §1 freeze gate):**
  S0 §3 spike + profile/contour, and S0b the route gate above
  (nothing multi-noun ships without it) → S1 Feature 6 scavenger
  (smallest, no geometry) → S2 Feature 1 (rides Forge F2) →
  S3 Feature 3 v1 (needs K1 `pinnedProps` and K2 a room prop pack in
  the level lane; no `level/2` needed) → S4 Feature 2 (hardest
  matching, after its SAM-only feasibility spike) → S5 Feature 6
  tidy-delta. Feature 3 v2 (obstacles) follows the `level/2` obstacle
  primitive and solver. Each step ships dark behind Grown-ups/Demo
  toggles until its §9 eval passes.
- **One lane.** This spec owns photo in, derived facts out. The level
  lane (primitives, `level/2`, the composition kit, generation) is
  owned by [play-design-spec.md](play-design-spec.md) §Plan. Feature 3
  is a producer into that lane and appears there as K1 and K2 only.
  Neither file restates the other's order.

## 9. Verification & durable tests

Per the repo rule, tests land **with** each behaviour change in the
normal layout (`tests/sam.test.ts`, `tests/sam-worker.test.ts`,
`tests/scan-targets.test.ts`, `tests/forge/*`), plus fixture photos/
rasters under `tests/fixtures/` (staged, consented, no real-child
photos). Minimum per feature:

- **Shared (§3):** profile/contour derivation from fixture rasters
  (known shapes → known rows/polygons); corrupt-mask tolerance;
  backwards-compat: old summaries normalize unchanged.
- **F1:** flat-vs-round path choice on fixtures; recipe schema
  rejects unknown slots/stats; gate-fail → digital fallback (never
  "printable"); socket present on every export.
- **F2:** enum-constrained matching (model output with a bogus id is
  dropped, not crashed); invalid assemblies never save; confirm
  step cannot be skipped; old toys load unchanged.
- **F3 (levels):** `composeLevel` with `pinnedProps` passes
  `checkLevel` over a seed x layout property test (extends
  `tests/level-kit.test.ts`); pinned props keep photo order and are
  never covered by a spot's cover; the noun table only emits catalog
  props; saved artifact contains no image data (byte-scan test). A
  solver gate arrives with `level/2`, not before.
- **F6:** zero-image-storage audit (storage snapshot before/after);
  XP double-pay impossible (photo verify + parent tap same day pays
  once); default-off enablement; verdict enum enforcement.
- **Gates every step:** `npm run validate`, `typecheck`, `test`,
  `build`, `preflight` green; eval numbers recorded against §4–§7
  targets in the PR description — targets stay labelled targets
  until measured. Real-phone pass required before any S-step leaves
  its toggle (SAM latency on home Wi-Fi is part of the UX claim).
- **Sample sizes.** The eval sets above (10 to 30 items) are smoke
  gates that catch gross failures. None supports a percentage claim in
  the UI or a PR beyond "n of N": with ten true scavenger targets one
  false "found it!" decides pass or fail. Report counts, not rates.

## 10. Sign-off

- [x] Scope = items 1, 2, 3, 6 only; 4, 5, 7 stay parked
- [x] Strict backward compatibility + single-photo ephemeral (§1) accepted
- [x] §3 spike-first order accepted (Scan Assist vision check gates noun help)
- [x] Rollout S0→S5 with per-step eval gates accepted
- [x] Feature 3 re-scope accepted (room-themed level on the kit in v1;
      obstacles wait for `level/2`), with the one-line `spec.md` edit
- [x] S0b route gate accepted as a prerequisite to every multi-noun step
- [x] Signed: Dan (approved in session)  Date: 2026-11-02

No S0 code starts until the first six boxes are checked. Q7 gates
every user-facing privacy sentence and S1.

## 11. Open questions

- [ ] **Q1 (blocks S2):** Forge job route naming vs optimizer lane (forge-ai Q19) — one poll route or two?
- [ ] **Q2 (blocks S4):** Twin Sync pose ambition: slot-level (v1, proposed) vs capturing arm/wheel poses? Cost grows fast past slot-level.
- [ ] **Q3 (blocks S3):** Is the printed TU scale tile required in-frame for level heights, or do relative bands play well enough? Decide from the S3 eval.
- [ ] **Q4 (blocks S5):** Tidy-delta threshold per surface (bench vs floor vs bed) — one global rule or per-quest data? Needs the §7.4 pair results.
- [ ] **Q5 (blocks S1 copy):** Scavenger concept list for launch (lever/gear/wheel only, or add pulley/ramp/screw per Concept Badges)?
- [ ] **Q6 (post-S1):** Do Feature 6 verdicts feed ScanDex/suggester training exhaust (future-vision), and under what parent consent wording? Default: no, until Max planning says otherwise.
- [ ] **Q7 (blocks S1 and every privacy sentence):** What does the SAM provider retain, for how long, and is it used for training? Record the answer (the terms or the account setting) in `docs/decisions/` as 0007. Until then UI copy promises only what our Worker does.
- [ ] **Q8 (blocks F3 v2):** Which `level/2` primitive makes a photographed prop an obstacle: a hop-over verb, push aside, carry or feed past, or a bridge? Decided in play-design-spec; v1 does not need it.
- [ ] **Q9 (blocks S0b):** One limiter for `/api/scan` and the new routes, or per-route budgets? Where does it count (Durable Object, KV, D1), given in-isolate counters reset per isolate?
- [ ] **Q10 (blocks S1):** Is there a daily XP ceiling across all real-life quests, or does each quest id pay +25 on its own (up to 125 a day with five routines today)?


