# ToyVentor Snap

Snap is the kid line. Younger kids, with a parent or older sibling helping. Everything is
snap-fit and tool-free — no screws. Most parts are shapes with a game function: one stat
plus a behavior in AR and the mini game.

## Connection

Stud grid, two sizes: small and large. Large is for the youngest kids. Stud geometry lives
behind a `stud_profile` setting so the standard can change without redoing every part, mostly
because the right clearance isn't known yet: as of Oct 27 nothing in Snap has been printed, so
these numbers are targets, not measurements. They lock only after a calibration piece has
been through a few fit loops on a real printer (planned Day 4; if it slips, Snap ships in one
size rather than two).

## Part types

| Type | What it is | 3D printable |
| --- | --- | --- |
| Brick and plate | Basic stud parts, small and large | Yes |
| Forge Mount adapter | Snaps onto the scanned toy, gives it a stud grid | Yes |
| Character add-on | Hats, wings, tails, armor shells | Yes, one color |
| Function capsule | Printed shell; the function (speed, glow, spin) lives in AR and the game | Shell only |
| Skin | Texture for a part | No, game and AR only |

## Design rules

- Every part prints without supports in a listed orientation; overhang limits live in the set file.
- Snap fit varies by printer, so each printer gets a calibration piece and offsets.
- Rounded edges, no sharp corners. No small loose pieces on parts for the youngest kids.
- Every part lists mount type, size class, one stat, and whether it prints.
- Character add-ons are original designs.

## 3D print

- Home: download the STL plus a settings card (orientation, layer height, material). Fit check
  runs before export.
- Delivery: hand the files to an outside print service for a quote. No checkout in the app.
  Skins never print.
- A printed part gives its boost once the user confirms they printed or ordered it.

## Game and AR

- AR try-on at true scale from the saved size class and attach point.
- The mini game equips the part and applies its stat. A printed add-on adds a boost.
- Under-8 gameplay is open-ended and low-pressure: discovery-first, no fail
  states, no timers, nothing to lose. Presented in 2.5D. Tapping things makes
  them react; experimenting is the game, and every outcome counts as playing
  it right.
- Ages 1-3 layer: spoken color names, cheeky animal character names, and simple
  narration that names what the kid just did ("You added a blue tail!").
- Humanoids use Mixamo clips, tagged per the minimo contract. Everything else gets bounce, spin, and wobble.

## Content

- Base library made ahead of time. Post-launch roadmap: two seeded sets (Month 1 and Month 2).
- First four sample parts designed (both sizes): see [snap-samples.md](snap-samples.md).
- Pack Rips: 3 items per daily pack, 1 printable part guaranteed.
- Market filters by mount type and size class.

## Done when

- A Snap part is scanned, fitted, equipped in the game, and exported as a valid STL in the demo.
- Checks pass in both sizes.
