# Scan to 3D — a real body for the kid's toy

Status: stretch goal. Not in the demo path. This is a recommendation, not
a decision; nothing here is approved to ship.

Provider names, prices, latencies, and licence summaries below were taken
from provider pages last checked 2026-10-30. They are unverified. Re-check
the primary provider page before any spike or cost commitment.

Recommendation in one line: ship Route B for the 2.5D game. Gate Route A
behind a measured spike for AR try-on only. Do not assume one generated
body serves both consumers.

## Why this exists

A scan today produces a mask, a size class, an attach point, and a kind.
The body in the game is one of three presets — a car becomes a vehicle, a
figure becomes a character, and **anything else becomes a robot**
(`shared/toycontract.ts:77`, `toyTypeForKind`). So the coffee cup that
proved our segmentation turns into a robot. AR try-on is a cropped photo
outline with a real GLB part on top; the toy itself is still flat.

The product promise is that household objects become characters. That
needs a body that *is* the object. This spec is about getting one body
per scan, from the photo we already take.

## What "photo → 3D → game" has to deliver

Three consumers, three different bars:

| Consumer | What it needs | Bar |
| --- | --- | --- |
| AR try-on | Silhouette matches the photo, true scale, registered to the live camera so occlusion is correct | Reprojected mesh matches the mask (see Done when); a mesh alone is not occlusion |
| The 2.5D game | Low-poly, pose-driven, instant, art-directed | Provisional: ≤ 10k triangles, ≤ ~1.5 MB GLB, one small texture, few draw calls, loads in < 1s on a mid-range phone |
| Printable parts | Nothing | Never — an AI mesh is not a printable part |

A generated mesh never becomes an STL. Printable parts stay OpenSCAD in
the app lane and PartSpec in the parts lane.

Note on AR today: try-on uses `@google/model-viewer`
(see `THIRD_PARTY.md`). That path shows a part GLB over a photo outline.
It does not register a body mesh to the live camera. Route A does not
give occlusion until that registration work is done and measured.

## Route A — mask-guided reconstruction (spike for AR only)

Meta's SAM 3D Objects turns an image **plus a mask** into a textured mesh
and a Gaussian splat. We already emit that mask: decision 0006 wired
`@meta-sam/parser` into the Worker (`worker/meta.ts`) and
`shared/sam.ts` summarises the raster. So there is no second
segmentation, no second prompt, and no re-photographing — the scan's
own mask is the input.

| Provider | Model | Cost (unverified) | Latency (unverified) | What we get |
| --- | --- | --- | --- | --- |
| Runware | `meta:sam@3d` (task `3dInference`) | $0.0051–0.009 per run | ~50s–1m45s | GLB. Requires image + mask + prompt, all of which we hold. Zero Data Retention available |
| fal.ai | `fal-ai/sam-3/3d-objects` | $0.02 per unit on the model page; a related fal page cites $0.05 — unresolved, verify on the model page before quoting | ~1 min | GLB + Gaussian splat + per-object scale, rotation, translation, and camera pose |
| Meta Model API | — | — | — | **Not available.** `dev.meta.ai/docs/models` lists six model lines and no 3D model, so this is a second key or self-hosting |

Verdict: the only route whose *input* is scoped to our mask. That does
not prove the *output* reprojects onto the mask. Depth, thickness, and
the back surface are still generated. Match must be measured (see Spike
and Done when), not assumed from the input. Marginal inference cost is
not the constraint — at $0.006 a run that is roughly 166 scans per $1
in inference fees alone, excluding retries, decimation compute, R2
storage and egress, and the SAM call already paid. Latency, decimation,
and placement are the constraints.

## Route B — parametric body from the mask (recommended for the game)

The game already builds a stylized body from code: `carBody()` and
`cabinBody()` in `game/engine25.js` extrude a shape from the toy kind
and a width ratio. Extend that with the mask's coarse silhouette
(`shared/sam.ts` already computes a filled-cell silhouette, capped at
48 × 36 cells) and the result is a body that matches the photo outline
by construction, is low-poly by construction, loads instantly, costs
nothing, works offline, and carries no third-party licence.

Verdict: the default and probably permanent answer for the 2.5D game.
It ships with no third-party 3D API, which matters on a short clock.
It is also the interim body shown while any Route A job is still
running, and the fallback when Route A fails. It cannot do true
occlusion from novel viewpoints or a real back surface. If the back
does not matter, Route B plus a photo texture is most of Route A at a
fraction of the cost — test that explicitly in the spike comparison.

## Route C — depth, not mesh

SAM 3D also returns a point map, and hosted depth models (Depth
Anything and friends) can produce a depth map from the photo alone. A
depth-displaced surface gives the game a 2.5D body with volume and a
correct silhouette from the capture viewpoint.

Verdict: the cheap middle. Enough for a 2.5D body with volume. Limited
occlusion is possible from near the capture viewpoint. It breaks down
at novel viewpoints and has no back surface, so it is not an AR body.

## Route D — retrieval instead of generation

Match the scan against a curated 3D library by image embedding (CLIP,
SigLIP) or by category and size class. Candidate sources: Google
Scanned Objects, Objaverse, Sketchfab, Poly Pizza and Kenney,
Quaternius, and our own PartSpec library. Every source needs a
per-asset licence check; aggregator-level terms are not enough.

Verdict: instant, art-directed, and licence-clean only if the set is
curated by hand. It is never the kid's actual cup — it is the closest
hero. Good for the catalog and as the fallback for a failed scan,
which is exactly the role the preloaded toy plays today.

## Route E — image-to-3D without the mask

Meshy (`smart-topology` with `meshy-t2.5`, `target_polycount`
100–30,000, default 15,000; the older `lowpoly` model type retires
Oct 30, 2026), Tripo v3.1 (`smart_low_poly`, 500–20,000 faces,
`generate_parts` for separable parts), TRELLIS.2, Hunyuan, and SF3D.
Runware also lists Tripo 3D v3.1 at $0.30 per segmented-3D task. All
figures unverified; re-check before use.

Verdict: the best polycount control of any route, and the wrong tool
for AR — without our mask the mesh is generated from the whole photo,
so it will not line up with the segmented object. Usable for a game
body, not for a true-scale AR body. Relevant only as the "buy low-poly,
lose the mask match" alternative if in-house decimation (below)
fails the spike.

## Route F — multi-view

Two or three photos as the kid turns the toy, then a multi-view
reconstruction.

Verdict: the best fidelity and the only route that observes the back
of the object instead of hallucinating it. The worst kid experience
and the slowest. Post-launch, if the promise starts to feel thin
without it.

## Route G — self-hosted open weights

Run SAM 3D (or TRELLIS) on our own GPU instead of a per-run API.

Verdict: no per-run API fee, but GPU time is still per-run cost.
Workers cannot run it — it needs a GPU service somewhere else — and
self-hosting inherits Meta's checkpoint terms, which have to be read
against `THIRD_PARTY.md` before this stops being a stretch goal.

## The gate: decimation

SAM 3D has no polycount knob. The game and AR budgets above cannot be
met by the raw output. Decimation is therefore not a follow-up task.
It is the gate for Route A.

Decimation commonly degrades UVs, normals, texture seams, and thin
features such as cup handles. Proven on the raw mesh means nothing.
Every spike metric must be taken *after* decimation, on the shipped
GLB.

Decimation also has no home today. It cannot run in the Worker as
native Python or Blender. The spike must name and prove one home
before Route A is approved:

- a Queue or Workflow consumer calling a container or external
  service that runs trimesh / fast-simplification / Blender, or
- a WASM decimator whose output quality is measured on the eval set.

The parts pipeline is stdlib-only Python today. Any of these adds a
dependency that needs its own `THIRD_PARTY.md` entry.

## The pipeline if we take Route A

1. **Scan** (done): photo → SAM 3.1 → mask → `shared/sam.ts` summary.
2. **Mask PNG**: retain the full decoded raster in Worker request
   scope — today `shared/sam.ts` keeps only the summary (coverage,
   outline, centroid, anchors, coarse silhouette) and discards the
   raster. Encode a **full-frame** mask PNG aligned pixel-for-pixel
   with the source photo (not cropped to the box, unless the chosen
   provider explicitly documents cropped input). Check the provider's
   white = object / black = object convention against ours.
   Implementation note: `CompressionStream("deflate")` yields raw
   DEFLATE. A PNG writer must add zlib framing, per-row filter bytes,
   and per-chunk CRC32 (IHDR, IDAT, IEND). That is a small writer,
   but it is not just `CompressionStream` alone, and it needs a
   round-trip test against a reference PNG decoder.
3. **Call the provider** from `worker/`, in the same shape as
   `worker/meta.ts`: image, mask, and the one-noun prompt the scan
   already used. No second prompt and no second segmentation.
4. **Background job**: enqueue and return immediately. Typical
   end-to-end time is the existing SAM call (~2–8s measured,
   `worker/meta.ts`) plus 50–105s of generation plus decimation.
   This can only be a background job (Queues, Workflows, or a
   Durable Object — pick one in the spike). Required states at
   minimum: queued → generating → decimating → ready | failed, with
   bounded retries, provider timeout, and webhook-versus-polling
   decided explicitly. While the job runs, and if it fails, the kid
   sees the Route B body. Catalog bodies stay pre-generated so the
   demo never waits — the same rule the seed content already
   follows — but pre-generation does not solve the first real scan.
5. **Decimate and repack** (see The gate): simplify to budget, fix
   normals, repack or downscale the texture, and record triangles,
   GLB bytes, texture size, and draw calls.
6. **Store** the decimated GLB in R2, with provider metadata (scale,
   rotation, translation, camera pose) and decimation metrics stored
   beside it. Keep the raw GLB only if storage cost and retention
   have been decided; do not keep it by default.
7. **Register and scale to true size**: provider scale and the human
   "real longest side" anchor (`lengthMm`, `shared/toy.ts`) are two
   different scale sources and they can disagree. Define which one
   wins, and record the residual. Suggested rule: `lengthMm` wins
   for overall size (it is the human-measured anchor); provider data
   supplies orientation only. The spike must validate or replace
   this rule. Also define, in one place: mesh origin, up axis,
   ground plane, and forward direction. Without these, the game
   pose, AR placement, and part mounts are all guesswork.
8. **Map attach points**: the scan's 2D anchors (`topAnchor`,
   `widestAnchor`, centroid in `shared/sam.ts`) are fractions of the
   photo. Define how each anchor is projected onto the 3D surface
   (for example ray-cast from the capture camera), and what happens
   when the ray misses the decimated mesh. Parts mount to the
   projected point, not to a 2D fraction.
9. **Feed the game and AR**: **contract change required — do not put
   a body URL in the hash.** The toy contract today travels
   base64url-encoded in the game page URL hash with no server call
   and nothing stored (`shared/toycontract.ts` header). A GLB URL
   breaks the nothing-stored property and bloats the hash. Instead
   add a short optional body ID to the contract; the game resolves
   it by fetch from same origin, validates it like every other
   contract field, swaps the preset for the mesh when present, and
   keeps the Route B / preset body as the fallback on any error.
   Updating the contract header's privacy statement is part of this
   step, not a follow-up. Same fallback discipline as the preloaded
   toy.

Latency is the design constraint, not marginal cost. Nothing in this
pipeline may block the scan response the kid is waiting on.

## Characters

Do not auto-rig the photo mesh. Mixamo is humanoid-only and a cup
fails it.

The body is the photo mesh (AR) or the Route B silhouette body (game);
the limbs and head are our own shared character modules (`snap.md`),
fixed-pose at Snap level. If arbitrary-creature rigging is ever
needed, the candidates are UniRig (MIT), Tripo's v2.5+ rigger for
non-humanoids, and Meshy auto-rig for Mixamo-compatible bones — all
three off the demo path. The Pro base figure and its rigged GLBs
already exist in the sibling PartSpec repo under `derived/`; that is
a rigging reference, not a dependency.

## Risks

- **Decimation (gate).** See The gate above. If the decimated GLB
  misses the budget or the silhouette bar, Route A does not ship for
  that consumer. No exceptions by eyeball.
- **Failure classes.** Transparent, reflective, textureless,
  partially occluded, thin-handled, holed, and multi-part objects
  routinely produce a usable 2D mask and an unusable mesh. The spike
  must report a failure rate over the eval set, not one success.
- **Placement.** Scale-source disagreement, undefined origin/up/ground,
  and 2D-to-3D anchor projection (pipeline steps 7–8) can each put a
  part in the wrong place at the wrong size while the mesh itself
  "looks right" in a viewer.
- **Latency.** SAM (~2–8s) + generation (50–105s, unverified) +
  decimation. Background job only, Route B body in the meantime.
- **Privacy — decision required before any flag.** A child's room
  photo already goes to Meta for segmentation. Route A sends the
  photo and mask to a second processor (Runware or fal). Before a
  spike runs on real photos behind a flag, record for the chosen
  provider: retention period, training use, processing region, and
  deletion path. Zero Data Retention on one provider does not cover
  the other. The parent-facing note and a `THIRD_PARTY.md` entry land
  in the same change as the first real call.
- **Licensing.** fal lists commercial use permitted for SAM 3D
  Objects; Runware states per-model terms; self-hosting inherits
  Meta's checkpoint terms. Meshy's free output is CC BY 4.0
  (attribution), Tripo's free tier is non-commercial. All unverified.
  Check the licence *of the generated output*, not just of the API,
  before shipping — and record it in `THIRD_PARTY.md`.
- **The back is hallucinated.** A mask is 2D. Route B has the same
  hole. Route F is the only route that observes the back.
- **Blast radius.** A photo body changes five surfaces at once: the
  toy contract and its validator (`shared/toycontract.ts`), the
  Worker (mask retention, PNG encoding, job orchestration), storage
  (R2 objects and metadata), the game loader (`game/engine25.js`),
  and the AR path (camera registration). Size and review it as one
  change across those surfaces, not as "add a GLB."

## Eval set

`tests/fixtures/scan-targets.json` holds 100 household items ranked
by how likely a kid is to scan them, each with a one-noun SAM prompt,
a kind, dimensions, a derived size class, a mount surface, and a
product-fit note. Every prompt is a ready-made segmentation test and
a ready-made mask for Route A; 31 land in `small` and 69 in `large`.

For the spike, sample deliberately across failure classes (handled,
transparent, reflective, textureless, occluded), not just by rank. A
pass rate quoted only on easy opaque objects is not a pass rate.

## Spike before decision

Do not approve Route A on this document. Approve a spike that reports
the numbers below, on at least a handled cup plus a sample across the
failure classes above, all measured on the **decimated** GLB:

1. Silhouette match: reproject the decimated mesh from the capture
   viewpoint and measure IoU against the SAM mask. (Provisional bar:
   IoU ≥ 0.85. Confirm or adjust with spike data; do not lower it to
   fit a result.)
2. Budget: triangles, GLB bytes, texture dimensions, draw calls.
3. Load and frame cost in the game on a mid-range phone.
4. End-to-end latency and full marginal cost per successful body,
   including retries and decimation compute.
5. Failure rate and failure mode per class.
6. Side-by-side: Route B plus photo texture on the same objects, so
   "good enough for the game" is a comparison, not an opinion.

If the spike passes for AR but not for the game budget, that is a
valid outcome: Route A for AR, Route B for the game. If decimation
fails outright, Route B plus photo texture is the fallback and
Route A stays a stretch goal.

## Done when

- A scanned cup produces a mesh whose reprojected silhouette matches
  the SAM mask at the measured bar above, at a recorded cost and
  latency — after decimation, not before.
- In the game, the kid's cup is a cup and not a robot (Route B alone
  can satisfy this line; do not block it on Route A).
- AR places the part on the mesh at true scale, with the mesh
  registered to the live camera and occluding what is behind it —
  demonstrated on device, not inferred from having a mesh.
- The interim and failure experience is the Route B body. No scan
  ever blocks on generation.
- The printable path is untouched: no generated mesh ever reaches
  an STL.
- Cost per scan (full marginal cost, pipeline step 4) is measured
  and sits inside the family's budget line.
- Privacy and output-licence decisions for the chosen provider are
  recorded, with a parent-facing note and a `THIRD_PARTY.md` entry.

## Open questions

- Does the 2.5D game want a photo body at all, or is a stylised
  silhouette (Route B) better for a four-year-old? The spike
  side-by-side (item 6) should answer this with evidence.
- If in-house decimation fails, is buying a low-poly route (Route E)
  and losing the mask match acceptable for the game body only?
- Who owns the character's voice — the mesh, or the shared modules?
  (`snap.md` currently implies the shared modules. Confirm before
  building per-mesh rigging of any kind.)
