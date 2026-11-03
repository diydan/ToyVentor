# Household library: 50 everyday objects as 3D parts (draft 1, 2026-11-03)

A library of 50 household objects, each a small, optimised 3D part that the game can show and, as an option, the printer can make, matched
from a child's word or photo. Companion to [forge-ai-spec.md](forge-ai-spec.md) (F2 and F2b, the photo routes),
[garage-weekend-spec.md](garage-weekend-spec.md) (where these become the weekend parts), and `tests/fixtures/scan-targets.json` (the ranked
list this is chosen from). **Status (2026-11-03): phase 2 is built.** 19 of the 50 have a builder, a game GLB and a catalog entry (all 15 revolved
items plus the four pilot items); the other 31 are in the catalog as data only. See "Phase 2: what was built".

## Decisions (Dan, 2026-11-03)

1. When a photo or a word is a confident match for a known object, offer an **optional** proper 3D version instead of only generating
   a flat plate from the photo, "so we can get a full 3D version if we want to".
2. List the top 50 household items likely to be used, and build 3D, optimised versions that words and photos **map to**.
3. Use them in the weekend Garage drops.

Reading of "map to" (to confirm): two things, and both are covered. A child's word or the model's label **maps to** a library item
(matching, below). And the child's photo can be **mapped onto** the item's surface, as its colours (no per-part texture is authored: the game
projects the photo from the front, as it already does for the digital photo accessory).

## What it is

Each item is built once, as a complete 3D head, from a small Python function. Two outputs come from that one builder:

- **The game asset:** the whole object as a GLB, tiny and optimised. This is the main product.
- **The printable version (optional):** a relief of the same object (its front surface, flat back, no undercuts) put on the Kip hand-prop
  grip and run through the existing gates. A real print is optional, as the Garage spec's real-life leg is.

How an item is built (its **family**): R revolve (one profile spun), RC revolve plus a composite (handle, spout, stem), E extruded or dished
outline, C primitives (prisms, cylinders, cones), L loft or hulled chain (organic).

## The 50

Chosen from the repo's ranked scan targets (`tests/fixtures/scan-targets.json`, 100 items ranked by how likely a child is to scan them): 43 come
from it, in its own order of likelihood, and 7 are added (plate, bucket and five garage tools: hammer, screwdriver, pliers, flashlight, tape
measure) because the list lacks the commonest table item and the Garage needs tools. An item is in only if it is **likely to be used**, **a held
or placed rigid shape**, **buildable in one of the five families**, and **brand-free**.

| # | id | item | scan rank | family | real mm | prop mm | words | tags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `ball` | Ball | 6 | R | 190 | 90 | ball, football, soccer ball, beach ball |  |
| 2 | `mug` | Mug | 51 | RC | 95 | 90 | mug, cup, coffee cup, teacup, coffee mug |  |
| 3 | `water_bottle` | Water bottle | 52 | R | 210 | 90 | bottle, water bottle |  |
| 4 | `flask` | Flask | 53 | R | 200 | 90 | flask, travel mug, vacuum flask |  |
| 5 | `drinking_glass` | Drinking glass | 54 | R | 150 | 90 | glass, drinking glass, tumbler |  |
| 6 | `jam_jar` | Jam jar | 72 | R | 150 | 90 | jar, jam jar |  |
| 7 | `soda_can` | Can | 70 | R | 120 | 90 | can, soda can, tin can, drink can |  |
| 8 | `cookie_tin` | Cookie tin | 71 | R | 150 | 90 | tin, cookie tin, biscuit tin |  |
| 9 | `bowl` | Bowl | 97 | R | 200 | 90 | bowl, pet bowl, food bowl, cereal bowl |  |
| 10 | `plate` | Plate | added | R | 250 | 90 | plate, dish, dinner plate |  |
| 11 | `bucket` | Bucket | added | RC | 280 | 90 | bucket, pail | garage |
| 12 | `watering_can` | Watering can | 98 | RC | 250 | 90 | watering can |  |
| 13 | `potted_plant` | Potted plant | 80 | RC | 180 | 90 | plant, potted plant, houseplant, flower pot |  |
| 14 | `spinning_top` | Spinning top | 21 | R | 60 | 60 | top, spinning top |  |
| 15 | `yo_yo` | Yo-yo | 20 | R | 60 | 60 | yo-yo, yoyo |  |
| 16 | `flying_disc` | Flying disc | 22 | R | 220 | 90 | flying disc, disc, throwing disc |  |
| 17 | `marble` | Marble | 19 | R | 16 | 40 | marble |  |
| 18 | `apple` | Apple | 73 | RC | 80 | 80 | apple |  |
| 19 | `orange` | Orange | 75 | R | 80 | 80 | orange |  |
| 20 | `lemon` | Lemon | 76 | R | 90 | 90 | lemon, lime |  |
| 21 | `banana` | Banana | 74 | L | 200 | 90 | banana |  |
| 22 | `carrot` | Carrot | 78 | L | 180 | 90 | carrot |  |
| 23 | `avocado` | Avocado | 77 | L | 120 | 90 | avocado |  |
| 24 | `wooden_spoon` | Wooden spoon | 67 | E | 180 | 90 | spoon, wooden spoon, cooking spoon, ladle |  |
| 25 | `fork` | Fork | 68 | E | 190 | 90 | fork | sharp-looking |
| 26 | `key` | Key | 58 | E | 60 | 60 | key |  |
| 27 | `comb` | Comb | 61 | E | 180 | 90 | comb |  |
| 28 | `hairbrush` | Hairbrush | 60 | E | 200 | 90 | hairbrush, hair brush |  |
| 29 | `toothbrush` | Toothbrush | 63 | E | 190 | 90 | toothbrush, tooth brush |  |
| 30 | `paintbrush` | Paintbrush | 44 | C | 180 | 90 | paintbrush, paint brush, brush |  |
| 31 | `pencil` | Pencil | 33 | C | 180 | 90 | pencil |  |
| 32 | `marker` | Marker | 32 | C | 140 | 90 | marker, felt tip, felt-tip pen, pen |  |
| 33 | `crayon` | Crayon | 31 | C | 180 | 90 | crayon, crayons |  |
| 34 | `eraser` | Eraser | 34 | C | 60 | 60 | eraser, rubber |  |
| 35 | `ruler` | Ruler | 36 | E | 300 | 90 | ruler |  |
| 36 | `scissors` | Scissors | 37 | E | 180 | 90 | scissors | sharp-looking |
| 37 | `glue_stick` | Glue stick | 38 | C | 100 | 90 | glue stick, glue |  |
| 38 | `stapler` | Stapler | 43 | C | 150 | 90 | stapler |  |
| 39 | `tape_dispenser` | Tape dispenser | 46 | C | 140 | 90 | tape, tape dispenser |  |
| 40 | `dice` | Dice | 41 | C | 16 | 40 | dice, die |  |
| 41 | `toy_brick` | Toy brick | 3 | C | 32 | 40 | brick, building brick, toy brick, block |  |
| 42 | `bubble_wand` | Bubble wand | 29 | E | 160 | 90 | bubble wand, bubble blower |  |
| 43 | `toy_sword` | Toy sword | 50 | E | 700 | 90 | sword, toy sword | sharp-looking |
| 44 | `hammer` | Hammer | added | C | 300 | 90 | hammer, mallet | garage, tool |
| 45 | `screwdriver` | Screwdriver | added | C | 220 | 90 | screwdriver | garage, tool, sharp-looking |
| 46 | `pliers` | Pliers | added | E | 180 | 90 | pliers | garage, tool |
| 47 | `flashlight` | Flashlight | added | RC | 150 | 90 | flashlight, torch | garage |
| 48 | `tape_measure` | Tape measure | added | RC | 80 | 80 | tape measure, measuring tape | garage, tool |
| 49 | `alarm_clock` | Alarm clock | 91 | RC | 120 | 90 | clock, alarm clock |  |
| 50 | `desk_lamp` | Desk lamp | 92 | RC | 200 | 90 | lamp, desk lamp |  |

"Scan rank" is the item's rank in the scan list (lower is likelier); the scan list's own word for it finds the item by that rank, so a word the
scan list uses is not copied here (two of them are trademarks, which this repo does not carry: the catalog uses generic words). "Prop mm" is the
longest side at prop scale, clamped to 40 to 90 mm so it fits Kip's hand and clears the small-parts screen (a marginal band of 31.75 to
34.925 mm of enclosing cylinder fails the gate). Every word maps to exactly one item (107 words).

**Left out, and why.**

| Left out | Why |
| --- | --- |
| Toy car, bus, truck, train, aeroplane, helicopter, boat, bicycle, scooter, skateboard | vehicles: they have their own slots and builders |
| Teddy, doll, action figure, robot, dinosaur, stuffed animals, rubber duck, cat toy | characters and soft figures: their own pipeline |
| Sock, T-shirt, backpack, slipper, sneaker, wallet, sunglasses, glasses | soft or fiddly shapes; sneaker and sunglasses are the first to add |
| Slime, modelling dough, balloon, toothpaste tube, mushroom, kaleidoscope, marble run, castle | unstable, soft, or too complex for one held part |
| Remote, game controller, calculator, wristwatch | screens and buttons that copy real brands' shapes: a generic one adds little and risks a look-alike |
| Board game, jigsaw, notebook, book, cereal box, lunchbox, pencil case, soap, sponge, playing card | plain boxes: the next ten, cheap to add |

## Pilot (measured 2026-11-03)

Five items, one per family, built with the part SDK (`parts/kip/sdk/kip_partspec_sdk.py`) and manifold3d. The SDK's `handheld_prop` takes a full 3D
head, not only an outline, so a library part gets the grip shaft, the connector and the lay-flat clamp for free.

| item | whole game asset | printable relief through the real gates |
| --- | --- | --- |
| Ball (R) | 392 triangles, 8.6 KB, 40.0 x 40.0 x 40.0 mm | fails: P1_no_supports 2.1 mm2 steeper than 45 deg |
| Mug (RC) | 468 triangles, 10.1 KB, 52.4 x 38.0 x 38.0 mm | fails: G1_watertight; P1_no_supports 22.5 mm2 steeper than 45 deg |
| Wooden spoon (E) | 848 triangles, 17.5 KB, 21.0 x 11.2 x 95.0 mm | passes |
| Pencil (C) | 168 triangles, 4.3 KB, 8.8 x 8.6 x 91.0 mm | passes |
| Banana (L) | 464 triangles, 10.1 KB, 61.9 x 17.6 x 36.3 mm | fails: P1_no_supports 1.6 mm2 steeper than 45 deg |

What this showed:

- **The game asset is small.** 168 to 848 triangles and 4 to 18 KB each: all 50 would be about half a megabyte. The budget proposed below is
  roughly 1.5 times the largest of these.
- **The printable version is the harder half, and it is a tuning job, not a rethink.** Built as a full 3D head, only the ball passed: a lay-flat
  print clamps the head at the bed plane and the rule is no supports, so a handle or a spoon's underside fails. Re-cut as a relief (the front
  surface as a height field, which has no undercuts by construction) two of five pass first time. The other three fail by small, specific amounts
  (a 2.1 mm2 overhang on the ball, 1.6 mm2 on the banana, 22.5 mm2 and a watertight failure on the mug), almost certainly from the
  height-field edge where the surface meets the silhouette. A "make it printable" step (smooth the edge, close tiny holes, a minimum thickness)
  is the work item.
- **Every item needs a grip anchor.** The builder puts the point where the shaft enters at x = y = 0, z = 0. My first banana was centred by its
  bounding box, so its body missed the shaft (floating contour), and my first pencil had a cone drawn backwards. A picture of each item from three
  angles caught the second at once: this spec asks for one in review.

## How it is built

- **Where:** `parts/kip/household/`: `household_builders.py` (one builder per item, returning colour-zone pieces), `household_catalog.py` (the 50
  rows as data, standard library only, with its own checker), `household_glb.py` (the zoned GLB writer), `build_household.py` (builds, checks and
  writes). Output: `public/kip/household/<id>.glb` and `catalog.json` (the 50 rows plus, for a built item, its triangles, bytes, hash, zones,
  size and volume). The printable-relief step is not part of phase 2.
- **Coordinates:** millimetres; z up; the grip point at the origin; the object stands on z = 0; the front, the side a photo is projected onto, is +y.
  The GLB uses the repo's usual print-frame to glTF change, (x, y, z) mm to (x, z, -y) / 1000, so it sits in a hand slot as any printed accessory's
  GLB does. Which way the game turns +y toward the camera is part of the equip question (open question 2); it is not decided here.
- **Budgets (kept):** the whole asset at most 1,000 triangles and 25 KB (25,600 bytes) as a GLB; at most three colour zones (named materials); round
  things are built at 28 segments (24 for the ball, 30 for the fruit, 32 to 36 for discs and the marble). No UVs are authored. Measured on the 19 built
  items: 168 to 848 triangles, 5.2 to 13.8 KB each (168 KB for all 19), at most 3 zones, so the proposed budget stands with room.
- **Photo as colour:** the game projects the photo onto the whole asset from the front, as `buildPhotoAccessoryMesh` does for the digital
  accessory. The colour zones are the fallback for an item with no photo.
- **Printable version:** only called printable if the gates pass (the honest-claims rule in forge-ai-spec.md). Items that do not pass are digital-only
  and say so.
- **Safe shapes:** items tagged `sharp-looking` (fork, scissors, toy sword, screwdriver) get blunt, rounded ends (radius at least 1.6 mm); tools carry
  a `tool` tag so a band can hide them (see Open questions).
- **No brands:** generic shapes and names only, no logos or labels; ids and names are checked against the SDK's brand filter.

## Matching a word or a photo to an item

A closed list, deterministic, and never silent. The model never writes a part id; it may only return a label from the table's word list, as the
spec's other classifiers do (`high`, `low` or `unsure`).

A match is **confident** when all of these hold:

1. the child's word, or the model's label, is in the word list (one item exactly);
2. the scan found one object, with a good outline: fidelity at least 0.95 and none of the warnings that say the outline may be wrong;
3. optionally, once calibrated on the photo batch: the outline's silhouette overlaps the item's own silhouette (intersection over union at least
   a threshold).

When it is confident the child is **offered**, never given: "This looks like a spoon. Want the 3D spoon too?" They can keep the flat photo plate,
take the 3D item, or both. The photo can colour the 3D item. A match is never applied automatically.

**When the photo is bad but the word is right.** The first real photo batch had two failures with a correct word: a sword on a tile floor (the
model returned the floor) and a pair of embroidery scissors (only the handles were kept). With a confident word the child can be offered the library
item on its own: "I could not trace your photo, but here is the 3D scissors." That turns the worst failures of the photo route into a working
result, and is the strongest argument for the library.

## In the Garage weekends

The 50 items are 50 weekend loaners, almost exactly a year of Fridays. See "Household library drops" in
[garage-weekend-spec.md](garage-weekend-spec.md): the weekend's New part is a library item; the Idea kind can be "find one at home";
the garage tools are a natural weekend pack.

## Tests

Built (phase 2), in two files:

- `tests/household-catalog.test.ts` (fast, no geometry built): 50 unique ids; every word maps to exactly one item; every scan rank is used once, exists
  in the scan list and carries that list's size; families, tags and prop sizes; no brand term. Every committed GLB is read back by a reader written in
  the test (not the writer's code) and checked as geometry: size and hash, within the budget, a material per zone in its colour, the triangle counts,
  standing on z = 0 with its longest side the prop size, a closed and consistently oriented surface whose signed volume is the solid's, and unit
  normals that point outwards. The catalog checker (`household_catalog.py --verify`) is run on copies broken in 13 ways and must fail each.
- `tests/household-build.test.ts` (needs the partspec venv, skipped without it): `build_household.py --check` finds the committed files exactly as a
  fresh build produces them (nobody edited a builder or the data without rebuilding), a partial build matches byte for byte, and `--check` reports a
  changed byte, a missing file, a stray file and an edited catalog. `tests/fixtures/household_canaries.py` feeds the build's checks broken solids
  (a floating part, off the floor, wrong size, a grip that misses or only grazes, empty), budget overruns, an uncoloured zone, a bad colour and a brand
  word; each must be caught.

Still to build (phase 3): a printable version marked printable only if it passes its gates. Matching (phase 4): each word finds its item, a near word
finds nothing, and the offer is never made below the confidence rule.

## Phase 2: what was built

Run `parts/partspec/.venv/bin/python3 parts/kip/household/build_household.py` to rebuild (about a second; deterministic, byte for byte), add `--check`
to compare with the committed files without writing. The build writes nothing if any built item breaks a rule.

The 19: ball (a stripe zone), water bottle (cap), flask (cap), drinking glass, jam jar (lid), can, cookie tin, bowl, plate, spinning top, yo-yo,
flying disc, marble, orange (stem), lemon, and the pilot's mug, wooden spoon, pencil (ferrule, eraser) and banana (stem).

**Rules the build enforces on every item:** one connected solid (a floating part is refused: the orange's first stem was cut away from its body by a
dimple and showed as two pieces); standing on z = 0 with its longest side exactly the prop size; at least 12 mm3 of material in the shaft's footprint
(6 x 6 mm, the first 2 mm above the grip point); at most 1,000 triangles, 25 KB and three zones; every zone has a colour and a triangle; no brand term.
Zones come from the pieces a builder returns: each piece keeps its own original id through the union, so a triangle's zone is exact and there is
no height guessing.

**What the grip check found, and the fixes** (all four failed on the first build; none was a rounding problem):

- **Banana:** centred on its bounding box, the end that meets the shaft hung about 8 mm in the air (the pilot's old bug, hidden by lifting the
  belly to the floor). It is now held by its stalk, as a real one is: the stalk's bottom is the grip point and the lowest point, and the fruit
  rises from it.
- **Can:** a real can's domed base left nothing under the shaft. A flat base.
- **Plate and yo-yo:** centred on their thickness, the rim material at the bottom was somewhere else (a plate's rim is about 2.5 mm thick up near the
  face; a yo-yo's centre is its groove). A disc takes `grip_axial`, the height on its axis to centre on; the plate and the flying disc pass the
  middle of their rims, and the yo-yo's V groove became a narrow slot between two thick halves so both halves reach the shaft.
- **Margins:** the thinnest contact is the plate at 19 mm3 of 72, then the top, banana, yo-yo and lemon at 33 to 37; most are 60 or more. The
  threshold (12) is a sixth of the probe, loose enough for these and tight enough that the banana's old failure (0) cannot come back.

**What testing found in the tests' own subject:** the colour parser accepted `112233` without a hash, and the build's own colour check only tested
length and the leading `#`, so `#ZZZZZZ` would have crashed the writer instead of being reported. Both now use one `#RRGGBB` pattern, each with a
test. A mutation round over the writer, the builders, the build checks and the catalog checker (22 single changes: winding reversed, axes swapped,
no gamma, a lost triangle, normals scaled or flipped, wrong material, 1 percent short on quantisation, a floating stem, a moved cap cut, each check
removed in turn, a shared word, a brand word, a changed clamp) was killed 22 of 22. The writer changes are caught by the geometry tests, each check
removed by its own canary, and a builder change by the build refusing it (a floating stem, a missed grip) or, for a harmless one such as a cap cut
moved 1 mm, only by the drift check, which is what that check is for.

**Picture review:** each GLB was decoded by an independent reader (not the writer) and drawn from the front, the side and three-quarters in its zone
colours, with the floor and the grip point marked: grip at the bottom, zones in the right places, discs face the viewer, the spoon's dish opens to
the front, the pencil is held by its eraser with the point up.

**Open from this phase:** the frame's front (+y here, glTF -z in the file) against what the game's hand slot expects (decided to settle in phase 4,
see "Decided after phase 2"); the spinning top is held by its 3.4 mm point (it passes, with 33 mm3 of contact, but a stick under a point is a thin
join; see open question 2 for the three options).

## Phases

1. **Spec and pilot** (this document): the list, the pilot, the numbers. Done.
2. **The 15 simplest** (the pure revolved items, family R): builders, the GLB for each, the catalog JSON and the tests. **Done 2026-11-03**, with
   the four pilot items kept (mug, wooden spoon, pencil, banana): 19 built. See below.
3. **The rest of the 50**, including the composites and the organic items; the printable-relief "make it printable" step; the build test.
4. **The game side:** equipping a library item in the hand slot, the match offer in the print panel, the weekend loaner. Needs a decision on how a
   GLB part is equipped in the game (the Kip viewer already loads a custom prop into the hand; the React game does not yet).
5. **The next ten** (plain boxes and the first soft shapes).

## Decided after phase 2 (Dan, 2026-11-03)

1. **Limit by age, and keep the activity working for the young.** Items are limited by age band: the engine's six (`src/lib/age.ts`: 0 = 2-3, 1 = 3-4,
   2 = 5-6, 3 = 7-9, 4 = 10-12, 5 = 13+, set by a grown-up behind the PIN gate). A held-back item is not simply hidden. A younger band gets a
   **simplified item to match**, or a **multi-purpose tool** that does the job of several, so what the child is doing still works; an older band
   **needs more of the real tools**. (Dan: "if tools [are] disabled use the support tools to work in lower age tiers but in older require more
   tools".)
   - **Proposed mechanism: my reading of "support tools", not confirmed, and the numbers are mine.** A tool job in a weekend names what it needs.
     Bands 0-1: no `sharp-looking` items and no real tools; one chunky, rounded multi-purpose toy tool (the support tool, a new item outside the 50)
     stands in for any tool job; simplified shapes for matching; pick between two by picture. Band 2: blunt tools allowed (hammer, pliers,
     flashlight, tape measure, bucket), no `sharp-looking`; the support tool still stands in for the rest; a tool job needs 1 tool. Band 3: every item;
     the support tool no longer stands in; a tool job needs 2 different tools. Bands 4-5: every item; a tool job needs 3.
   - The catalog already carries what the rule reads (`tool`, `garage`, `sharp-looking`); a `minBand` per item and a `simple` variant are not built.
2. **Equip in the game: ok.** Decided in phase 4 by loading one library GLB through the Kip viewer's custom-prop hand path and seeing which way it
   faces; if it faces away, the equip step turns it 180 degrees about z and the assets stay in the printed-part frame.
3. **Keeping a weekend loaner: scan the real one** (the real-life leg), **with finding it in a room of the map as the fallback** for a child who cannot
   scan.
4. **Printable versions: digital first, a printable version on demand.** Built only for an item a weekend asks for, and called printable only if it
   passes the gates.

## Open questions

1. **The support tool and the numbers above:** is a single multi-purpose toy tool what was meant, and are the band cut-offs and "a job needs 1, 2, 3
   tools" right? Until confirmed, the Garage spec's hold-back of the garage tools from bands 0 and 1 stands.
2. **The spinning top.** Held by its point it passes with 33 of 72 mm3 of contact. Flipped (held by its spindle) it has full contact (72) but reads as
   a mushroom or a lampshade on a stick. A short blunt peg on the tip keeps it reading as a top and has 71. Recommended: the blunt peg. Not changed in
   the repo until decided. Pictures: scratchpad `household/top-compare-sheet-1.png`.
3. **The silhouette check** in the confidence rule needs a threshold from real photos: the photo batch tool can supply it once there are more
   photos of forks, spatulas and wands.
