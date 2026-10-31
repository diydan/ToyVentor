# Scan to 3D — a real body for the kid's toy

## Status

**Recommendation, not a decision.** Route B remains recommended for the game;
Route A needs a spike first. The toy contract stays untouched.

## Why this exists

A scanned toy should be able to gain a simple printable body and appear in
play without pretending that a photo is already a verified part. A child who
scans a red car expects that car—not a generic placeholder—to show up in the
world, and a scanned figure should keep its paint personality while gaining a
body that can breathe, blink, swim, and celebrate.


## What “photo → 3D → game” has to deliver

- A visible body that echoes the scanned toy’s paint and proportions.
- Working stats, emotes, and at least one behavior in each current explore
  world and lesson lab.
- Separate storage and versioning from placement, paint, stats, mood, camera,
  and `toyventor.toy/1`.
- Honest print claims: only measured, watertight geometry may be called
  printable.
- Privacy: photos stay on approved paths; model weights never ship to the app.


## Route A — mask-guided reconstruction (spike for AR only)

Photograph, segment, generate a view-consistent mesh, clean and solidify it,
then bind it into a part.

- Best for printing, collision, and personal likeness.
- Highest research risk and slowest path.
- A spike must measure minimum printable wall size, solver time, and bundle
  compatibility before this enters gameplay.
- The SAM mask bounds the problem: a 48×36 silhouette plus summary and anchor
  is the most the scanner may promise before reconstruction exists.


## Route B — parametric body from the mask (recommended for the game)

Keep the scanned photo as the emotional anchor and grow an original low-poly
body: at most 10k triangles, about 1.5 MB GLB, one small texture, few draw
calls, loading in under a second on a mid-range phone.

- Best for immediate play and phone performance.
- No scanned mesh enters gameplay.
- Easiest fallback if generation or scanning fails.
- Add a simple grow animation so the body visibly arrives from the photo.



## Route C — depth, not mesh

Use depth only where it improves placement or preview. Do not pursue phone
LiDAR or purchased sensors as a product dependency.

## Route D — retrieval instead of generation

Match the scan to an existing verified body where likeness permits. This is
fast and safe, but limited by catalog coverage.

## Route E — image-to-3D without the mask

Use direct image-to-3D generation only as an experiment. Without mask
grounding, likeness, scale, and print claims are unverifiable.

## Route F — multi-view

Multiple photos may improve reconstruction, but they complicate the kid UX and
do not remove the need for cleanup, solidification, and print validation.

## Route G — self-hosted open weights

Self-hosting may help cost or privacy later, but it does not solve mesh
quality, scale, rigging, or print validation. It is infrastructure, not a scan
solution.

## The gate: decimation

Any gameplay mesh must survive aggressive decimation while retaining readable
proportions and paint zones. Meshes that cannot decimate cleanly stay out of
the game.

## The pipeline if we take Route A

Segment, reconstruct, clean, solidify, scale, rig, validate, version, and
print-check. Each stage has measurable exit criteria; failure returns to the
spike, not to gameplay. Cleanup covers hole-filling, non-manifold repair, and
minimum-wall enforcement before anything is called printable.


## Characters

Scanned bodies should support breathe, blink, swim, and victory poses. Simple
rigging may constrain fins, arms, and head separately for future motion.
Bodies stay low-poly and original: likeness comes from paint zones and
proportions, never from a copied mesh. A body that cannot hold its rig through
all four poses stays out of the game until it can.


## Risks

Unverified likeness, bad scale, non-watertight meshes, unsafe print claims,
privacy exposure, slow solvers, and bundle incompatibility. Route B avoids most
of these by keeping generated gameplay bodies original and lightweight. The
sharpest risk is over-promising: the scanner must never imply a printable or
game-ready body before the mesh, rig, and validation exist.


## Eval set

Use the same toys, photos, masks, lighting conditions, and success thresholds
for every route comparison. Record likeness, performance, mesh validity, rig
behavior, and print outcome separately. Fixture targets live in
`tests/fixtures/scan-targets.json`; eval results must be reproducible from
those fixtures, not from ad-hoc photos.


## Spike before decision

The geometric spike must report minimum printable wall size, solver timing,
bundle fit, and reproducible print behavior. No game commitment follows until
those numbers exist.

## Done when

Route B has a visible original body, prompt-faithful paint, working stats,
emotes, and one active behavior in each current explore world and lesson lab.
Route A additionally meets the spike’s wall-size, watertight, timing, bundle,
and reproducibility criteria.

## Future — Max: real robots

Snap → Pro → Max is the product arc, Max being real robots. Max starts with
kid-safe battle bots (sumo and push formats, obstacle courses — no destructive
weapons) plus missions, and it is the phase where ScanDex exhaust and the
asset pipeline pay off: every labeled household object and fitted body is
training data for vision, dimensioning, and grasping. The thesis: video games
accelerated AI development, and play will do the same for robotics. The power
system's Momentum/Mech stages are the technical path inside the Max phase.
The thesis is lived, not borrowed: hours in Fusion 360 and Blender making
parts for a 4-foot household robot — modeling, printing, testing, training —
and a son who could help train it by playing instead of watching.

## Open questions

- Body style range and paint fidelity limits for generated bodies.
- Scan-body storage budget and long-term versioning.
- Whether print likeness is ever central enough to justify Route C’s doubled
  asset cost.
- The smallest printable wall the spike can actually defend.

