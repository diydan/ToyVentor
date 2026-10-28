# Snap — first sample parts

> **App-lane prototype record (16/32 mm).** These samples proved the
> OpenSCAD pipeline. Geometry canon is now decided by
> [decision 0005](decisions/0005-partspec-lattice-merge.md): PartSpec's
> 12.5/25 mm TU lattice, pending the Large hand-feel print. Do not build
> new parts at this scale.

Designed Oct 27, 2026, against [snap.md](snap.md). Status matches the rest
of Snap: **nothing here has been printed.** Every dimension is a target
until the Day 4 calibration piece has been through fit loops on a real
printer. STLs do render clean since Oct 28 (`npm run parts`): all parts
manifold, footprints matching the set file exactly. The OpenSCAD files
are the printable truth; concept images are look-and-feel only (deltas
listed at the bottom).

Four samples, chosen to cover three of the four printable part types and
both size classes. Two complete parts that already existed as data-only
stubs in the base set (Brick 2×2, Dragon Wing); two are new (Big Brick,
Glow Star Capsule). All four live in `sets/base.json` and pass
`npm run validate` plus the builder checks in `tests/snap-samples.test.ts`.

| Part | Type | Mount | Size | Stat | Prints | Geometry |
| --- | --- | --- | --- | --- | --- | --- |
| Brick 2×2 | Brick and plate | stud | small | spin 1 | Yes | `parts/snap/brick-2x2-small.scad` |
| Big Brick 2×2 | Brick and plate | stud | large | spin 1 | Yes | `parts/snap/brick-2x2-large.scad` |
| Dragon Wing | Character add-on | stud | small | glow 2 | Yes, one color | `parts/snap/dragon-wing.scad` |
| Glow Star Capsule | Function capsule | stud | small | glow 3 | Shell only | `parts/snap/glow-capsule.scad` |

## Shared geometry changes

The existing parts could not actually snap: the spoiler was a solid
sharp-cornered plate and nothing had an underside. The profiles now
provide what the design rules require, so every future part gets it free:

- `socket()`: recess that snaps over one stud, with a 45° cone roof so
  the underside never bridges flat and stays support-free printed
  studs-up. Clearance is one TARGET number per profile (small +0.2 mm,
  the loose end of the calibration sweep; large +0.3, since little hands
  push at an angle). It moves when a printer says so.
- `rounded_plate()` / `socket_plate()`: rounded vertical edges, rolled
  top edge, flat bottom for bed adhesion.
- `top_studs()`: studs with a small cone fillet at the base, so a
  sideways yank breaks the kid's grip before it breaks the stud.
- `stud_profile_large`: new. 2× the small pitch (32 mm), 19 mm studs,
  r=4 edges. Raw values, same TARGET status as small. Only the small
  calibration bar exists so far; a large one is owed before Day 4.

## Brick 2×2 (small) — `snap-brick-2x2-small`

The basic brick: sockets under all four cells, studs on top, 12 mm body,
18 mm overall. Stacks on a Forge Mount or another brick.

- Settings card: flat, studs up · 0.2 mm layers · PLA · 15% infill · no supports.
- AR/game: tap = bounce and a happy wobble; spin stat shows as a gentle
  spin when the toy moves. Printed boost: spin trails.
- Ages 1–3 narration: "You added a red brick!"

## Big Brick 2×2 (large) — `snap-brick-2x2-large`

The youngest-kid brick: 64×64 mm footprint, 20 mm body, one solid piece
a toddler can palm. No small loose pieces: there is nothing on it that
can come off. Same game behavior as the small brick; only the hand size
changes. Checks gate it correctly: it fails "fits toy" on the small seed
car and passes on a large toy.

- Settings card: flat, studs up · 0.28 mm layers OK · PLA · 15% infill · no supports.
- AR/game: big slow bounce; spoken color name on every tap.
- Ages 1–3 narration: "You added a BIG red brick!"

## Dragon Wing — `snap-wing-01`

Character add-on, original design. One swept wing with a scalloped
trailing edge on a 2×1 socket base, for a figure's back or a car roof.
The wing is a 4 mm vertical plate: every column of the silhouette is
filled from the base up, so the scallops cost no supports. Convex
corners (tip, scallop peaks) are rounded to about r=1.2 in the profile
sketch itself. The 2×1 footprint is symmetric: it snaps on either way
round, so there is no wrong way to attach it. About 25.5 mm tall
overall, measured from the STL (tip rounding trims the sketch peak).

- Settings card: flat, wing vertical · 0.2 mm layers · PLA · no supports.
- AR/game: flap wobble (springy ±8°) and a sparkle trail from its glow
  stat. Printed boost: trail gets longer and brighter.
- Ages 1–3 narration: "You added a teal wing! Flap flap!"
- Known iteration: the concept render shows ribs on the wing face. v1
  prints flat because raised face ribs would overhang. If the plain face looks
  dull in hand, options are shallow grooves or a skin, not ribs.

## Glow Star Capsule — `snap-glow-capsule-01`

Function capsule, shell only. A friendly dome with a round nub on a 2×2
socket base; the glow lives entirely in AR and the game. No electronics,
no detachable nub: it is one printed piece. Dome walls lean 35° from
vertical (a true hemisphere would overhang at the base), and the nub is
a cone into a hemisphere so every layer shrinks. Strongest glow in the
library (3 vs the wing's 2) because glow is its whole job. Balance is a
target like everything else here.

- Settings card: flat, dome up · 0.2 mm layers · PLA · no supports.
- AR/game: slow pulsing aura; tap = glow burst and a soft chime.
  Printed boost: brighter pulse that lingers.
- Ages 1–3 narration: "You added a yellow star! It glows!"

## Concept images vs printable truth

Three concept renders were generated alongside these designs (in
`generated_images/`, Oct 27). Where they disagree with the SCAD, the
SCAD wins:

- Big Brick render: scale against the toy car is exaggerated. The real
  part is 64×64 mm and pairs with large toys (~170 mm), not seed-car size.
- Dragon Wing render: face ribs and a membrane frame are not in v1
  geometry (see above).
- Glow Capsule render: dome is a rounder hemisphere than the printable
  35° dome, and the glow aura is the AR effect; the shell does not glow.

## Open / next

- Large calibration bar (only the small one exists in `parts/calibration/`).
- Forge Mount in large, so big toys get a grid too.
- Spoiler retrofit: still a sharp solid plate with no sockets. It should
  move onto `socket_plate()` before anything prints for the demo.
- Socket grip: bores are smooth. If calibration prints slip, the fix
  (grip ribs, tighter offset) lands in the profile, not per part.
- Wing strength: if the tip snaps in print testing, add root gussets.
- Swap-friendly: if Dragon Wing reads too "dragon" for the youngest end,
  the same base takes a dino tail or a wizard hat with no profile changes.
