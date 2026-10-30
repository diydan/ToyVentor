# Scan to 3D — a real body for the kid's toy

Status: stretch goal. Not in the demo path. The route below is a
recommendation, not a decision; nothing here is approved to ship.

## Why this exists

A scan today produces a mask, a size class, an attach point and a kind. The
body in the game is one of three presets — a car becomes a vehicle, a figure
becomes a character, and **anything else becomes a robot**
(`shared/toycontract.ts:71`). So the coffee cup that proved our segmentation
turns into a robot. AR try-on is a cropped photo outline with a real GLB part
on top; the toy itself is still flat.

The product promise is that household objects become characters. That needs a
body that *is* the object. This spec is about getting one body per scan, from
the photo we already take.

## What "photo → 3D → game" has to deliver

Three consumers, three different bars:

| Consumer | What it needs | Bar |
| --- | --- | --- |
| AR try-on | silhouette matches the photo, true scale, occlusion | must match the mask |
| The 2.5D game | low-poly, pose-driven, instant, art-directed | roughly ≤ 10k triangles, loads in < 1s |
| Printable parts | nothing | never — an AI mesh is not a printable part |

A generated mesh never becomes an STL. Printable parts stay OpenSCAD in the app
lane and PartSpec in the parts lane.

## Route A — mask-guided reconstruction (recommended)

Meta's SAM 3D Objects turns an image **plus a mask** into a textured mesh and a
Gaussian splat. We already emit that mask: decision 0006 wired
`@meta-sam/parser` into the Worker and `shared/sam.ts` summarises the raster.
So there is no second segmentation, no second prompt, and no re-photographing —
the scan's own mask is the input.

| Provider | Model | Cost | Latency | What we get |
| --- | --- | --- | --- | --- |
| Runware | `meta:sam@3d` (task `3dInference`) | $0.0051–0.009 per run | ~50s–1m45s | GLB. Requires image + mask + prompt, all of which we hold. Zero Data Retention available |
| fal.ai | `fal-ai/sam-3/3d-objects` | $0.02 per unit on the model page (a related fal page cites $0.05 — verify) | ~1min | GLB + Gaussian splat + per-object scale, rotation, translation and camera pose — the placement data AR wants |
| Meta Model API | — | — | — | **Not available.** `dev.meta.ai/docs/models` lists six model lines and no 3D model, so this is a second key or self-hosting |

Verdict: the only route where the 3D body provably matches the photo. Cost is
not the constraint — at $0.006 a run that is roughly 166 scans per $1.

## Route B — parametric body from the mask (today's path, extended)

The game already builds a stylized body from code: `carBody()` and
`cabinBody()` in `game/engine25.js` extrude a shape from the toy kind and a
width ratio. Extend that with the mask's coarse silhouette
(`shared/sam.ts` already computes a filled-cell silhouette, capped at
48 × 36 cells) and the result is a body that matches the photo outline exactly,
is low-poly by construction, loads instantly, costs nothing, works offline and
carries no licence.

Verdict: probably the permanent answer for the 2.5D game. It is also the route
that could ship with no third-party 3D API at all, which matters on a ten-day
clock. It cannot do occlusion or a real back surface.

## Route C — depth, not mesh

SAM 3D also returns a point map, and hosted depth models (Depth Anything and
friends) can produce a depth map from the photo alone. A depth map gives the
game a 2.5D body with real volume and a correct silhouette.

Verdict: the cheap middle. Enough for a 2.5D body with volume; not enough for
AR occlusion.

## Route D — retrieval instead of generation

Match the scan against a curated 3D library by image embedding (CLIP, SigLIP)
or by category and size class. Candidate sources: Google Scanned Objects,
Objaverse, Sketchfab, Poly Pizza and Kenney, Quaternius, and our own PartSpec
library.

Verdict: instant, art-directed, and licence-clean if the set is curated by
hand. It is never the kid's actual cup — it is the closest hero. Good for the
catalog and as the fallback for a failed scan, which is exactly the role the
preloaded toy plays today.

## Route E — image-to-3D without the mask

Meshy (`smart-topology` with `meshy-t2.5`, `target_polycount` 100–30,000,
default 15,000; the older `lowpoly` model type retires Oct 30, 2026), Tripo v3.1
(`smart_low_poly`, 500–20,000 faces, `generate_parts` for separable parts),
TRELLIS.2, Hunyuan and SF3D. Runware also lists Tripo 3D v3.1 at $0.30 per
segmented-3D task.

Verdict: the best polycount control of any route, and the wrong tool for AR —
without our mask the mesh is generated from the whole photo, so it will not
line up with the segmented object. Usable for a game body, not for a
true-scale AR body.

## Route F — multi-view

Two or three photos as the kid turns the toy, then a multi-view reconstruction.

Verdict: the best fidelity and the only route that gets the back of the object
right. The worst kid experience and the slowest. Post-launch, if the promise
starts to feel thin without it.

## Route G — self-hosted open weights

Run SAM 3D (or TRELLIS) on our own GPU instead of a per-run API.

Verdict: no per-run cost at scale, but Workers cannot run it — it needs a GPU
service somewhere else, and self-hosting inherits Meta's checkpoint terms,
which have to be read against `THIRD_PARTY.md` before it is not a
stretch goal.

## The pipeline if we take Route A

1. **Scan** (done): photo → SAM 3.1 → mask → `shared/sam.ts` summary.
2. **Mask PNG**: encode the raster to a PNG in the Worker, white = object, and
   check the provider's white/black convention against ours. No new dependency
   needed: `CompressionStream("deflate")` plus a minimal PNG writer is about
   sixty lines.
3. **Call the provider** from `worker/`, in the same shape as `worker/meta.ts`:
   image, mask, and the one-noun prompt the scan already used.
4. **Store** the GLB in R2, with the provider metadata (scale, rotation,
   translation, camera pose) stored beside it.
5. **Scale to true size**: the mesh's own scale times the human "real longest
   side" anchor the scan already collects (`lengthMm`).
6. **Feed the game**: the toy contract gains an optional body URL; the game
   swaps the preset for the mesh when one is present and keeps the preset as
   the fallback. Same fallback discipline as the preloaded toy.

Latency is the design constraint, not cost. At 50–105 seconds per mesh this
can only be a background job, with the catalog bodies pre-generated so the demo
never waits — the same rule the seed content already follows.

## Characters

Do not auto-rig the photo mesh. Mixamo is humanoid-only and a cup fails it.

The body is the photo mesh; the limbs and head are our own shared character
modules (`snap.md`), fixed-pose at Snap level. If arbitrary-creature rigging
is ever needed, the candidates are UniRig (MIT), Tripo's v2.5+ rigger for
non-humanoids, and Meshy auto-rig for Mixamo-compatible bones — all three off
the demo path. The Pro base figure and its rigged GLBs already exist in the
sibling PartSpec repo under `derived/`; that is a rigging reference, not a
dependency.

## Risks

- **Latency.** 50–105 seconds per mesh. Background job only.
- **Privacy.** The room photo leaves our Worker either way. Runware's Zero
  Data Retention helps; the rest needs a parent-facing note.
- **Licensing.** fal lists commercial use permitted for SAM 3D Objects;
  Runware states per-model terms; self-hosting inherits Meta's checkpoint
  terms. Meshy's free output is CC BY 4.0 (attribution), Tripo's free tier is
  non-commercial. Check before shipping, not after.
- **Low poly.** SAM 3D has no polycount knob, so a decimation step is the
  first thing to prove — and the parts pipeline is stdlib-only Python today, so
  this adds a dependency (trimesh, fast-simplification, or Blender).
- **The back is hallucinated.** A mask is 2D. Route B has the same hole;
  Route F is the only fix.
- **Blast radius.** A photo body changes the toy contract, the game loader and
  the AR path. That is a Day-10-sized change, not a Day-4 one.

## Eval set

`tests/fixtures/scan-targets.json` holds 100 household items ranked by how
likely a kid is to scan them, each with a one-noun SAM prompt, a kind,
dimensions, a derived size class, a mount surface and a product-fit note. Every
prompt is a ready-made segmentation test and a ready-made mask for Route A; 31
land in `small` and 69 in `large`.

## Done when

- A scanned cup produces a mesh whose silhouette matches the SAM mask, measured
  rather than eyeballed, at a recorded cost and latency.
- In the game, the kid's cup is a cup and not a robot.
- AR places the part on the mesh at true scale, with the mesh occluding what
  is behind it.
- The printable path is untouched: no generated mesh ever reaches an STL.
- Cost per scan is measured and sits inside the family's budget line.

## Open questions

- Decimate in-house, or buy a low-poly route and lose the mask match?
- Does the game want a photo body at all, or is a stylised silhouette better
  for a four-year-old?
- If the back of the toy does not matter, Route B plus a photo texture is most
  of Route A at a fraction of the cost.
- Who owns the character's voice — the mesh, or the shared modules?
