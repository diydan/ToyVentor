# Forge Mount spec (v1, 2026-10-28)

The Forge Mount joins add-ons and Motion parts to a scanned toy. It is one part family for both lines: the face picks the connector, the outline picks the shape, and the base picks how it holds the toy. Mounts are generated per toy at scan time; the catalog holds three default mounts.

## Faces

| Face | Connector | For |
| --- | --- | --- |
| Small studs | Small stud grid on top | Snap Small add-ons (ages 3 and up) |
| Large studs | Large stud grid on top | Snap Large add-ons (under 3) |
| Pro bores | Free bores on the 1 TU grid | Motion beams and pins (ages 8 and up) |

## Outlines

- **Square:** an n x n grid. The catalog defaults are Large 3x3 (74.7 mm), Small 5x5 (62.3 mm) and Pro 5x5 (62.5 mm).
- **Round:** a disc sized from the scan, filled with every lattice position that fits inside the rim. Studs take whichever lattice phase (on the axis or half a pitch off) seats a 2x2 part best; Pro bores stay whole TU from the axis.
- **Refusals:** the generator refuses a mount with fewer than 4 studs or bores, or one on which a 2x2 part would grip fewer than 3 studs. With an 18 mm hole, a round mount needs about 64 mm (Small) or 100 mm (Large) for that, because a circle loses the corners.

## Holding the toy

There are three ways, picked per toy:

1. **Peg hole:** for toys with a round peg or post. A hole (18.0 mm stand-in; the real size comes from the scan) with a 1.6 mm lead-in and 3 crush ribs presses over it. Studs or bores too close to the hole are left out.
2. **Hugging shoe, two parts:** a shoe whose underside follows the toy's surface with a 0.2 mm gap, under a face without the peg hole. One-piece hugging mounts were tested and rejected: printed studs-up, a curved underside is a ceiling over air (11 of 12 test surfaces needed supports). The shoe prints with its hugging face up, so it needs no supports and touches the toy everywhere.
3. **Clip-on shoe, for limbs and tails:** below the shoe's platform, a C wall (2.2 mm) wraps the limb past halfway and snaps on.
   - **Wrap:** the generator picks the deepest wrap, up to 240 degrees, that keeps the estimated bending strain under 2.0% (a PLA target).
   - **Grip:** each arm must open at least 0.25 mm, about five times the calibrated print error, so the clip really grips.
   - **Range:** limbs from about 6 to 60 mm clip on; thinner limbs and round bodies are refused. A test checks the geometry: the limb sits free but cannot drop out.

Round bodies that cannot take a peg or a clip still need glue or a strap (open item).

## Joining the shoe and the face

- **Small face:** four 10 mm friction pins through holes between the studs (the centres of 2x2 stud groups, clear of every stud), into blind holes in the shoe.
- **Pro face:** standard friction pins (2 TU) through the face's own bores, into blind holes in the shoe.
- **Large face:** joins its shoe permanently. It is for under-3s, and a pin that can be pulled out is a small part, so the generator refuses pins for a Large face or shoe.

## Checks

Faces, shoes and pins run the same checks as every other part. The selftest builds the whole stack (toy, shoe, pins, face, an add-on) and the validator accepts it.

## Open items

- Scan export: shoes are tested on stand-in surfaces (cylinders and spheres from tight to gentle curves) until the scan pipeline exports real surface patches.
- Glue or a strap for round bodies.
- A print test of the clip's strain and grip targets.
