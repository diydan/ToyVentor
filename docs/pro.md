# ToyVentor Pro

Pro is the mechanical line. Ages 8+ and makers: beams, axles, gears, and joints on a hole grid,
plus motion capsules. Everything prints on a 0.4 mm nozzle with no supports, and it should look
good on the shelf too.

## Base standard

Pro follows ToyVentor's own hole grid, specified in the PartSpec interface standard. Every Pro part is
generated from those numbers and checked against them.

| Item | Value |
| --- | --- |
| Grid | 12.5 mm pitch, half / quarter / eighth steps |
| Free hole | 7.0 mm |
| Fixed hole | 5.1 mm flats |
| Axle | 6.6 mm round, 5.0 mm flats, 2 mm center hole |
| Beam base | About 12.5 x 12.5 mm, scalable |

Fixed hole plus axle flats leaves about 0.1 mm of play, which is tight on a home printer. Fit
offsets are an engineering and manufacturing concern, not a standalone
user-facing calibration task. Part names are component, sub-type, style tag, then
size in grid units, e.g. Beam STR RND TU05x01x01.

## Part families

| Family | What's in it |
| --- | --- |
| Beams | Straight, angled, T, L, X; SU03 to SU15 and up; rounded ends; optional side panels |
| Pins and connectors | Friction pins (snap), long pins, axles, bushings, cross-axles, rounded heads |
| Gears | Spur, bevel, worm, rack; printable tooth shape; hubs take the fixed bore |
| Panels and plates | Thin covers that clip onto beams |
| Joints | Hinges, universal joints, turntables, rounded housings |
| Fasteners | Standard screws and nuts on the same 5.1 mm flats, plus friction pins for tool-free builds |
| Motion capsules | Motor, wheel, light, or sensor modules; digital at launch |
| Forge Mount adapter | Snap-on base that gives the scanned toy a hole grid |

## Humanoid and cross-line modules

The articulated humanoid is the reference layout for the simplified,
fixed-pose Snap figures: one anatomy expressed at two levels of mechanical
complexity. Heads, torsos, limb segments, tails, accessories and end
effectors use the same named module roles across humans, animals and
robots.

Every humanoid or robot part must emit the same typed connection metadata
as any other system part: connector kind and gender, interface, size class,
frame and normal, axis, allowed mates, fit class, print orientation and
safety status. Geometry that merely touches in an assembly is not
compatible until those connections exist in the manifest and pass assembly
and measured-fit checks.

Cross-line parts should use a direct shared interface wherever scale makes
that physically sound. A Pro head is Snap-compatible only when it
demonstrates a declared Snap mate, or uses an explicit fit-checked adapter
in a validated assembly. Humanoid proportions and joint axes should also
map to a standard animation rig so one motion library can drive both Pro
articulated figures and their Snap counterparts.

## Look and print rules

- Fillet everything: 1.5 mm or more, 0.5 mm or more on small features.
- Rounded-rectangle or slightly tapered beam profiles. Only faces that never mate get tapered,
  so parts still stack on the grid.
- Mating faces stay flat. Panel slots are fine; random cutouts are out.
- Parts suit multi-color printing or painting; texture only where grip needs it.
- No supports at 0.2 mm layers. Each part lists its print orientation; horizontal 7 mm holes
  and cross-holes in T and X beams print as teardrops.
- 3 to 4 walls, 15 to 20 percent infill.
- Every connection sits on the grid; holes match the standard axles.

## Motion capsules and electronics

- At launch the function is digital: a stat plus a behavior in AR and the game. The printed
  shell is passive.
- Later: optional low-voltage electronics (small motor, LED) with a Forge Mount version that
  passes an axle or contacts through.

## Game and AR

- Mechanical stats: speed, spin, torque, glow. Gear ratios show as a visible speed stat.
- AR try-on at true scale on the Forge Mount's hole grid.
- A printed Pro part gives a boost once the user confirms they printed or ordered it.

## Hackathon scope

- Rounded TU05 beams, matching friction pins, one gear set.
- Teaser on the demo toy's Forge Mount. Not the full family.

## Done when

- TU05 beam, friction pin, and gear set pass checks: on the grid, holes fit the axles, no supports.
- A Pro part mounts on a Forge Mount and equips in the game.
- Any humanoid part counted toward the one-system claim has complete typed
  connector metadata, at least one validated intended assembly, and a
  demonstrated direct Snap mate or fit-checked adapter for shared heads.
