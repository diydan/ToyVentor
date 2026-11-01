# ToyVentor Motion

Motion is the mechanical line for ages 8 and up and makers: beams, pins, shafts,
gears, and joints on the 12.5 mm TU hole grid. Every printed part carries the
general notice and small-parts screen; small gears, pins, shafts, and bushings
carry the choking-hazard warning.

The normative geometry spec is the generated copy in
[partspec/specs/03_motion_spec.md](partspec/specs/03_motion_spec.md), assembled from
`parts/partspec/motion_v2.md`. This file is the product summary, not a second
normative copy.

## Base standard

Motion follows the TU lattice and interface standard. Mounts use the same
footprints as Snap parts where an adapter exists. Forge Mount rules cover
scanned-toy attachments. No part changes game stats, Packs, Moods, or the app
UX by itself.

## Part families

- Structure: beams, plates, brackets, and lattice frames.
- Fasteners: pins, shafts, couplers, lock collars, and standoffs.
- Motion: gears, drives, pulleys, hinges, and universal joints.
- Wheels and tracks: wheels, treads, axles, and suspension parts.
- Precision and control: calibration gauges, dials, detents, and Motion grips.
- Characters: posable heads, torsos, limbs, tails, ears, and costume adapters.

## Humanoid and cross-line modules

Posable figures are assemblies, not adjacent meshes. Joints use existing pins,
shafts, hinges, or cross connectors; driven parts keep shaft/gear/rack/wheel
distances on the lattice. Cross-line heads need a declared, fit-measured
adapter where scale permits.

## Look and print rules

Parts print on a 0.4 mm nozzle with no supports and look good on the shelf.
Motion fit windows sit inside Snap’s calibration coverage, so one calibration
print can cover both lines. Exposed pins and shafts stay above the small-parts
floor when possible; otherwise the warning is explicit.

## Moving capsules and electronics

Power, sensing, and control belong to the progressive power lane unless the
Motion catalog explicitly includes them. Moving-part claims need validated
travel, clearance, and collision behavior.

## Game and AR

Motion parts use mapped game stats and measured footprints. Failures name the
cause and offer repair, forge, reprint, or fallback.

## Hackathon scope

Only verified Motion rows needed for the demo ship in app sets. New joints ship
only with a real assembly proof and regression coverage. A robot joint is not
compatible merely because two meshes touch; axis, pair, fit, travel, and
collisions must all validate.


## Done when

A Motion part is done when it is verified by the generator, mates through typed
connectors, reaches the app exactly once where in scope, prints with its mates
where claimed, and carries correct age grading and warnings.
