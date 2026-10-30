# ToyVentor Snap

Snap is the entry line for the initial playtesting audience, ages 4+ with a
parent or older sibling helping. Printed parts are prototypes until fit,
durability and formal age-safety review are complete.
Everything is snap-fit and tool-free: no screws. Its parts use soft, rounded,
collectible character forms; robots are part of the same family and are
fixed-pose at this level. Most parts are shapes with a game function: one stat
plus a behavior in AR and the mini game.

## Connection

Stud grid, two sizes: small and large. Large is the easiest-handling format. Stud geometry lives
behind a `stud_profile` setting so the standard can change without redoing every part.

Fit is designed to not need user calibration. Sockets are compliant: a lead-in taper plus
relief slots let the rim flex over a range of printer tolerances, and clearances start from
library-tested defaults at Snap's generous scale. The one remaining unknown is handled
invisibly: the first Forge Mount print (`forge-mount-first-print`) carries a breakaway
selector strip with three dotted sockets (1 snug, 2 standard, 3 easy) and a loose test
brick. The user snaps the brick into each, answers "which clicked best?" once, breaks the
strip off, and that choice becomes the printer's stored offset. Later mounts print plain.
Known printer profiles may skip the question entirely. There is never a standalone
calibration step in the product; the five-step calibration piece in parts/scad/calibration/
remains an internal engineering tool for our own fit loops.

As of Oct 28 nothing in Snap has been printed, so clearances are still targets, not
measurements. The compliant range widens the acceptable window; it does not retire the
Day 4 print proof. If no variant clicks acceptably on the test printer, Snap ships in one
size rather than two while geometry is reworked.

## Part types

| Type | What it is | 3D printable |
| --- | --- | --- |
| Brick and plate | Basic stud parts, small and large | Yes |
| Forge Mount adapter | Snaps onto the scanned toy, gives it a stud grid | Yes |
| Character add-on | Hats, wings, tails, armor shells | Yes, one color |
| Function capsule | Printed shell; the function (speed, glow, spin) lives in AR and the game | Shell only |
| Skin | Texture for a part | No, game and AR only |

## Shared character modules

Heads, bodies, limbs, tails, wings and accessories use one shared module
vocabulary across humans, animals and robots. Snap is the simplified,
fixed-pose expression of the Pro humanoid layout rather than a separate
character system. A head or accessory may be described as cross-line only
when its declared connector directly mates with the other line or through an
explicit fit-checked adapter; similar proportions alone are not
compatibility.

## Design rules

- Every part prints without supports in a listed orientation; overhang limits live in the set file.
- Snap fit varies by printer, so sockets are compliant first (lead-in taper, relief slots,
  wide clearance band); the per-printer offset comes from the first-print selector, never
  from a user-facing calibration task.
- Rounded edges, no sharp corners. No small loose pieces on parts for the youngest kids.
- Every part lists mount type, size class, one stat, and whether it prints.
- Every claim of compatibility is backed by typed connection metadata:
  connector kind, gender, size class, orientation, intended mates, fit,
  print constraints and safety status. A mesh without declared mates is a
  shape, not yet a system part.
- Character add-ons are original designs. Learn from play principles, do not
  copy another product's features, art or geometry.

## 3D print

- Home: download the STL plus a settings card (orientation, layer height, material). Fit check
  runs before export.
- Delivery: families do not need to own a printer. The product target is
  delivered custom parts from $1, with direct print costs held to
  $0.50–$5 per design; those economics still need supplier proof. The demo
  hands files to an outside print service for a quote, with no checkout.
  Skins never print.
- A printed part gives its boost once the user confirms they printed or ordered it.

## Game and AR

- AR try-on at true scale from the saved size class and attach point.
- The mini game equips the part and applies its stat. A printed add-on adds a boost.
- Under-8 gameplay is open-ended and low-pressure: discovery-first, no fail
  states, no timers, nothing to lose. Presented in 2.5D. Tapping things makes
  them react; experimenting is the game, and every outcome counts as playing
  it right.
- Pre-reader layer: spoken color names, character names, picture prompts and
  simple narration that names what the kid just did ("You added a blue tail!").
- Humanoid joint layouts map to a standard animation rig so reusable motion
  clips can drive different characters. Everything else gets bounce, spin,
  and wobble.

## Content

- Base library made ahead of time. Post-launch roadmap: two seeded sets (Month 1 and Month 2).
- First four sample parts designed (both sizes): see [snap-samples.md](snap-samples.md).
- Pack Rips: 3 items per free daily pack, 1 printable part guaranteed.
  Chance-based packs are never sold to children.
- A monthly subscription delivers known seasonal physical packs tied to
  engineering and science activities.
- Market filters by mount type and size class; a print-file marketplace is a
  later step after the core catalogue and manufacturing workflow are proven.

## Done when

- A Snap part is scanned, fitted, equipped in the game, and exported as a valid STL in the demo.
- Checks pass in both sizes.
- The first-print selector produces an acceptable click on the test printer, and the
  chosen variant is stored as that printer's offset.
