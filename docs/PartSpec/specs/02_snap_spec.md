# Snap spec (v2.3, 2026-10-28)

Snap is the kid line: younger children, with a parent or older sibling helping. Everything is snap-fit and tool-free. Most parts are shapes with a game function: one stat plus a behavior in AR and the mini game.

This spec says what Snap parts are and the rules they follow. The numbers live in `interfaces.json` and the full rule set is in the Interface Standard; where they differ, the data wins. Part status lives in the catalog, generated from the generator, so it is not repeated here.

## Lattice and sizes

Snap sits on the shared lattice: 1 TU = 12.5 mm, the same unit as Pro.

| | Small | Large |
| --- | --- | --- |
| For | Ages 3 and up | The youngest children; must clear the small-parts cylinder |
| Stud pitch | 12.5 mm (1 TU) | 25.0 mm (2 TU) |
| Stud | 6.6 mm across, 2.8 mm tall | 13.2 mm across, 5.6 mm tall |
| Plate / brick height | 5.0 / 15.0 mm | 10.0 / 30.0 mm |
| Wall | 2.0 mm | 3.0 mm |
| Stud fit | 0.1 mm across (0.05 mm a side) | 0.1 mm across (0.05 mm a side) |

Large is twice Small on every lattice dimension, so both share one grid. Small studs are the same diameter as the Pro shaft and sit on the Pro hole grid; Large studs land on every other Pro hole.

Nothing has been printed yet: every fit number is a target until a calibration print sets the printer offsets.

The lattice was decided on 2026-10-28 (8/16 mm became 12.5/25 mm). It holds on one condition, checked at the calibration print: a printed Large 2x2 must feel right in a toddler's hand and on a real toy. If it is too big, Large shrinks on this same lattice rather than returning to 16 mm.

## Part types

| Type | What it is | How it connects |
| --- | --- | --- |
| Bricks and plates | Studs on top, socket underneath | Square foot with tubes (the "cage") |
| Shape blocks | Tiles, slopes, a dome: socket underneath, shaped top | Square foot with tubes |
| Character add-ons | Tails, wings, shells, horns, ears, hat, fin | Integrated base: stud holes in the part's own underside |
| Function capsules | Printed shells; the function (speed, glow, spin, bounce) lives in AR and the game | Integrated base |
| Forge Mount | Joins Snap to a scanned toy; see the Forge Mount spec | Stud face on top |
| Skins | Textures | Game and AR only, never printed |

## How parts connect

- **Square foot (bricks, plates, shape blocks):** a socket cavity with tubes. Each stud of the part below sits between tubes with a 0.05 mm gap a side.
- **Integrated base (add-ons, capsules):** no plate around the part. Stud holes (6.6 mm plus the fit) are cut into the part's own underside, giving the same 0.05 mm gap.
  - **Holes:** a hole goes wherever the shape wraps it with a full wall. Where a stud of a plate below would only clip the shape, a relief is cut so the part sits flat on any plate.
  - **Pads:** a shape too thin for a hole (horns, ears, fin) stands on a small pad that joins its pieces and carries two holes.
  - **Direction lock:** a part whose direction matters has two holes, or one hole plus a relief that keys it against a neighbouring stud, so it cannot swivel. Round parts may turn on one stud.
  - **Seated check:** every integrated part is checked sitting on a full plate, so no stud can hit it where it has no hole.
- **Building:** tools and AI place parts with `attach(parent connector, child part, child connector, cells, rotation)`, never raw coordinates. The validator rejects size mismatches, misalignment, floating parts and collisions, and measures the fit of every connection.

## Design rules

- Every part prints without supports: no face steeper than 45 degrees, and no flat bridge longer than 20 mm.
- Rounded edges; the edge on the bed gets a small chamfer instead of a fillet.
- Never type a footprint: feet, holes and connectors come from the interface, generated beside the geometry so they cannot drift.
- Add-on bodies first drawn at the old 8 mm scale are multiplied by 1.5625. Walls, clearances, fillets and embed depths are print-limited and do not scale.
- Anything tilted above a foot or pad buries its root and is trimmed flush, so no underside hangs over.
- A round outline cannot carry studs on the lattice (the cavity must reach the corner studs: 28.4 mm against a 24.8 mm footprint at Small), so round shapes are female-only.
- On a square Small 2x2 foot, keep a part under about 25 mm tall or over 57 mm: the foot's rounded diagonal (33.8 mm) puts anything in between in the marginal small-parts band.
- When a family setting puts a part in the marginal band, change the setting in its catalog row (the Small slope uses 30 degrees, not 45).
- Character add-ons are original designs. No third-party names anywhere.

## Print rules

- 0.4 mm nozzle, 0.2 mm layers, no supports, at least 3 walls, 15 to 20 percent infill, PLA by default.
- Each part lists its print orientation. Square feet print cavity down; integrated parts print on their flat underside.

## Safety

- Every part is screened against the small-parts test cylinder (31.75 mm across, 25.4 to 57.1 mm deep). The screen is conservative and is not a lab test.
- Small parts are for ages 3 and up and carry the choking-hazard warning.
- Anything for under 3 must be Large, clear the cylinder, pass the breakage check (nothing that breaks off may fit the cylinder) and be lab tested before sale.
- Every printed part carries the general notice: not tested to toy-safety standards, adult supervision, inspect before use, stop using anything broken.
- The US requirements and their status are in the compliance checklist.

## Checks and status

The checks are defined in the Interface Standard, with their severities stored as data. A part's status is derived from them: it is `verified` only when no blocking check fails, the small-parts result is not marginal, and a Large part clears the cylinder.

Fit is measured from the built geometry: each part is seated on its partner and sliced at mid-stud height, and every stud's gap is measured. The printed-fit and breakage checks stay pending until a real print.

## Game and AR

- AR try-on at true scale from the saved size class and attach point.
- The mini game equips the part and applies its stat. A printed part adds a boost once the user confirms they printed or ordered it.
- Under-8 play is open-ended and low-pressure: discovery first, no fail states, no timers, nothing to lose, presented in 2.5D. Tapping things makes them react.
- Ages 1 to 3: spoken color names, cheeky animal character names, and narration of what the child just did ("You added a blue tail!").
- Humanoids use Mixamo clips tagged per the minimo contract (open item: define it). Everything else gets bounce, spin and wobble.

## Content and delivery

- **Library:** a base library is made ahead of time. After launch, two seeded sets (Month 1 and Month 2).
- **Packs:** daily packs of 3 items, 1 printable part guaranteed. The market filters by mount type and size class.
- **Home printing:** an STL plus a settings card (orientation, layer height, material). The print page shows the part's safety warning before the download.
- **Delivery:** files go to an outside print service for a quote; no checkout in the app.

## Open items

- Large hand-feel check (the condition on the lattice decision): print a Large 2x2 at calibration and try it in a toddler's hand and on a real toy.
- Calibration print: sets printer offsets and turns fit targets into measurements. Pass criterion: the printer's surface offset lands inside every part's fit window (about -0.07 to +0.08 mm). For users this must stay invisible: the plan is a first-print Forge Mount whose breakaway selector strip carries three dotted sockets spanning the fit window, so one "which clicked best?" answer sets the offset (app-side prototype exists on the old 16 mm lattice in parts/mount/forge-mount-first-print.scad; it needs rebuilding on the TU lattice and validating against these fit windows). The standalone calibration print remains the engineering tool.
- Printed-fit and breakage checks for every part.
- The minimo animation contract.
- Product name: renamed to ToyVentor on 2026-10-28 after the old name screened as used by others in toys; trademark clearance and registration for ToyVentor still to confirm before launch.

## Done when

- A Snap part is scanned, fitted, equipped in the game and exported as a valid STL in the demo.
- Every catalog part is `verified` (geometry and fit), and the physical checks are scheduled with a lab.
