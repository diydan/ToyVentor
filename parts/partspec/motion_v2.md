# Motion spec (v2.3, 2026-10-28)

Motion is the mechanical line for ages 8 and up and makers: beams, pins, shafts, gears and joints on a hole grid. Everything prints on a 0.4 mm nozzle with no supports, and should look good on the shelf.

This spec says what Motion parts are and the rules they follow. The numbers live in `interfaces.json` and the full rule set is in the Interface Standard; where they differ, the data wins. Part status lives in the catalog.

## Base standard

| Item | Value |
| --- | --- |
| Grid | 12.5 mm pitch (1 TU), with half, quarter and eighth steps |
| Free bore | 7.0 mm round: shafts and pins turn in it |
| Fixed bore | 7.0 mm round clipped to 5.1 mm flats: a flat shaft drives it |
| Shaft | 6.6 mm round, 5.0 mm flats, 2.0 mm centre hole |
| Beam section | 1 TU square |
| Longest part | TU14 (175 mm), so it fits a 180 mm bed |

Part names are component, sub-type, style tag, then size in TU (for example Beam STR RND TU05x01x01). Each part also has its own id.

## Part families

| Family | In the catalog |
| --- | --- |
| Beams | Straight TU03, TU05, TU07, TU10, TU14; L 3x3 and 5x3; T 5x3; 45 degree TU05 (its arm's bores are 1 TU apart in x and y, so every bore stays on the lattice) |
| Pins | Friction pin (2 TU) and long friction pin (3 TU); free pin with a 9.0 mm head |
| Shafts and bushings | Shafts TU03, TU05, TU07; bushings 1/2 TU and 1 TU (11.0 mm across, fixed bore) |
| Gears | Spur Z10, Z15, Z20, Z25, Z30; rack TU05; ring gear Z40 in a 10 TU frame |
| Forge Mount | Hole-grid face (see the Forge Mount spec) |
| Snap-to-Motion adapter | 3x3 TU plate: Pro bores on the cell centres, Small studs on the inner corners |
| Wheels | TU04 (50 mm) and TU06 (75 mm): fixed-bore hub, crank bores on whole TU from the axis |
| Joints | Hinge leaf TU02 (two leaves and a free pin make a hinge); cross connector TU01 (joins two shafts at 90 degrees) |
| Later | Panels, fasteners, motion capsules with electronics |

The worm and worm wheel were dropped: a module 2.5 worm needs supports at 20 and 30 degrees (1,069 and 1,162 mm2 of steep overhang) and has no tooth left at 45. The ring gear and Z25 took their places.

## Connectors and mating

- **Bores:** a bore connector anchors its grid at the first bore centre and gives its bore class (free or fixed), its depth and its axis. Most bores run vertically; hinge knuckles and the cross connector's second bore run along x or y.
- **Poses:** parts in a build may be tipped onto their side in quarter turns (a horizontal axle, wheels, a hinge pin). Stud parts always stay upright.
- **Bore lattice:** beams put bores on cell centres measured from the part's corner; gears, wheels and round mounts put them on the part axis or whole TU from it.
- **Pins:** a pin connector puts the pin axis at its origin, with a profile (round, flats, friction) and a length.
- **Pin and bore pairs:** a pin and a bore mate when their axes are parallel and coincide, their lengths overlap, and the pair is allowed. A flat shaft must also have its flats lined up with a fixed bore's:

| Pin | Bore | Fit |
| --- | --- | --- |
| `pin_free` | free | free |
| `shaft_drive` | free | free |
| `shaft_drive` | fixed | press |
| `pin_friction` | free | friction |

  A pair not listed is rejected, such as a round pin in a fixed bore (`profile_mismatch`).
- **Gears:** two gears (or a gear and a rack or ring) mesh when they share a z band and their pitch circles touch. Teeth that meet at the wrong distance are rejected (`gear_mesh_distance`).
- **Snap studs on Pro bores:** a design target, proven on the calibration piece. The validator does not mate studs with bores; the adapter joins the two lines.

## Fit

Every connection is measured from the built geometry with the same slice-and-gap method as Snap:

- **Free bore:** a free pin or shaft leaves 0.200 mm a side, a turning fit. It may never bind and may rattle up to 0.35 mm.
- **Fixed bore:** a flat shaft leaves 0.050 mm on the flats, a press fit that drives, within the press limits (0.1 mm interference, 0.2 mm play).
- **Friction pins:** they hold by fins 1.5 mm wider across than the bore. The fins are built and measured to the interface; how well they hold needs a print.

Motion's fit windows sit inside Snap's, so one calibration print covers both lines.

## Gears

- **Teeth:** module 2.5 mm, involute teeth at 20 degrees, 0.2 mm backlash, 0.5 TU thick, fixed-bore hub.
- **Tooth counts:** every count is a multiple of 5, so every pitch diameter is a whole number of TU and any two gears mesh with their axes on the grid (Z10 with Z20 at 3 TU). Check I6 measures the built tip circle from the mesh.
- **Rack:** its pitch line is 1 TU from its bore line, so a pinion meshes with its axis on the grid.
- **Ring gear:** Z10, Z15 and Z20 mesh inside it at 3, 2.5 and 2 TU.

## Look and print rules

- **Shape:** outside fillets of 1.5 mm or more (0.5 mm on small features); the bed edge gets a small chamfer. Mating faces stay flat.
- **Bores:** free-bore mouths get a 0.4 mm chamfer; fixed bores keep flat mouths.
- **Horizontal bores:** a free bore prints as a teardrop with a 50 degree roof; a fixed bore prints with its flats top and bottom and 50 degree shoulders, so the top flat is a short bridge.
- **Pins and shafts:** they print lying on a flat, so the layers run along the axis and they do not snap at a layer line. Their arcs end in 45 degree tangents next to each flat, and a shaft's centre hole is a teardrop with a 50 degree roof. The generator turns these parts for printing: printability checks run on the printed mesh, connector checks in the assembly frame.
- **Material:** 3 to 4 walls, 15 to 20 percent infill. PLA by default; friction pins may need PETG, to be settled by the calibration prints.

## Checks and status

Motion uses the same checks and derived status as Snap, plus three Motion rules:

- **I4, bore on grid:** every bore is on the lattice and really exists (an empty probe inside it, material just outside it).
- **I5, pin fits bore:** every pin and bore is an allowed pair and is built to the interface numbers.
- **I6, gear on grid:** module, whole-TU pitch diameter, and the built tip diameter match.

## Game and AR

- Mechanical stats: Reach (beams), Grip (friction pins, bushings), Spin (free pin), Torque (shafts), Speed (gears; gear ratios show as speed). These stats are proposals, open to change.
- AR try-on at true scale on the Forge Mount's hole grid. A printed part gives a boost once the user confirms they printed or ordered it.

## Safety

Motion is for ages 8 and up. Every printed part carries the general notice and runs the same small-parts screen; small parts (pins, shafts, bushings, small gears) carry the choking-hazard warning.

## Open items

- **Friction pin grip and hinge swing range:** need a print.
- **T beam cross hole:** possible now that parts can tip over; not yet added.
- **Calibration:** the calibration print, as for Snap.

## Done when

- Every catalog part is `verified` (geometry and fit). Done for all 30 on 2026-10-28.
- A Motion build (beam, pins, gears) mounts on a Forge Mount and equips in the game.
