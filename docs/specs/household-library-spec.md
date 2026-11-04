# Household library: 50 everyday objects as 3D parts, and the next ten (draft 2, 2026-11-03)

A library of 50 household objects, each a small, optimised 3D part that the game can show and, as an option, the printer can make, matched
from a child's word or photo. Companion to [forge-ai-spec.md](forge-ai-spec.md) (F2 and F2b, the photo routes),
[garage-weekend-spec.md](garage-weekend-spec.md) (where these become the weekend parts), and `tests/fixtures/scan-targets.json` (the ranked
list this is chosen from). **Status (2026-11-03): phases 2, 3 and 5 are built.** All 60 items (the 50, then the next ten) have a builder, a game
GLB and a catalog entry; see "Phase 2: what was built" and "Phases 3 and 5: what was built". **Phase 4 (the game side) is built through the matcher, the
equip step and the offer in the print panel; there is no weekend loaner (dropped, Dan, 2026-11-03: the weekend is "find one at home", see "In the Garage
weekends")**, see "Phase 4: what was built".

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

**The next ten (phase 5).** All ten are the scan list's own plain items, so each is linked by rank like the first 50; they are rows 51 to 60 of the
catalog, after the desk lamp, and the first 50 keep their order.

| # | id | item | scan rank | family | real mm | prop mm | words |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 51 | `board_game` | Board game | 23 | C | 300 | 90 | board game, boardgame, game box |
| 52 | `jigsaw` | Jigsaw piece | 24 | E | 300 | 90 | puzzle, jigsaw, jigsaw puzzle, puzzle piece |
| 53 | `notebook` | Notebook | 39 | C | 210 | 90 | notebook, journal, diary, exercise book |
| 54 | `book` | Book | 40 | C | 220 | 90 | book, hardback, storybook, story book, picture book |
| 55 | `playing_cards` | Playing cards | 42 | C | 90 | 90 | card, cards, playing card, playing cards, deck of cards |
| 56 | `pencil_case` | Pencil case | 47 | C | 200 | 90 | pencil case, pencil box, pencil pouch |
| 57 | `soap` | Bar of soap | 65 | C | 90 | 90 | soap, bar of soap |
| 58 | `sponge` | Sponge | 66 | C | 120 | 90 | sponge, kitchen sponge, scrubber |
| 59 | `cereal_box` | Cereal box | 69 | C | 190 | 90 | cereal box, cereal, box |
| 60 | `lunchbox` | Lunchbox | 90 | C | 220 | 90 | lunchbox, lunch box |

"The first soft shapes" is read as the soap and the sponge; the properly soft items (sneaker, slipper, sock, sunglasses) stay out, as below. Two items
stand for a whole: one edge piece for the puzzle (a box of pieces cannot be held) and a squared deck for the cards (one card is too thin to grip).
The scan list's own word for the cereal box is the bare "box", so that word maps there.

**Left out, and why.**

| Left out | Why |
| --- | --- |
| Toy car, bus, truck, train, aeroplane, helicopter, boat, bicycle, scooter, skateboard | vehicles: they have their own slots and builders |
| Teddy, doll, action figure, robot, dinosaur, stuffed animals, rubber duck, cat toy | characters and soft figures: their own pipeline |
| T-shirt, backpack, wallet, glasses | soft or fiddly shapes |
| Slime, modelling dough, balloon, toothpaste tube, mushroom, kaleidoscope, marble run, castle | unstable, soft, or too complex for one held part |
| Remote, game controller, calculator, wristwatch | screens and buttons that copy real brands' shapes: a generic one adds little and risks a look-alike |
| Sneaker, slipper, sock, sunglasses | the first soft and fiddly shapes: the next to add after the ten above |

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
  writes). Output: `public/kip/household/<id>.glb` and `catalog.json` (the 60 rows plus, for a built item, its triangles, bytes, hash, zones,
  size and volume). The printable-relief step is not part of phase 2.
- **Coordinates:** millimetres; z up; the grip point at the origin; the object stands on z = 0; the front, the side a photo is projected onto, is +y.
  The GLB uses the repo's usual print-frame to glTF change, (x, y, z) mm to (x, z, -y) / 1000, so it sits in a hand slot as any printed accessory's
  GLB does. Which way the game turns +y toward the camera is part of the equip question (open question 2); it is not decided here.
- **Budgets (kept):** the whole asset at most 1,000 triangles and 25 KB (25,600 bytes) as a GLB; at most three colour zones (named materials); round
  things are built at 28 segments (24 for the ball, 30 for the fruit, 32 to 36 for discs and the marble). No UVs are authored. Measured on the 19 built
  items: 168 to 848 triangles, 5.2 to 13.8 KB each (168 KB for all 19), at most 3 zones, so the proposed budget stands with room. Measured on all
  60: 52 to 848 triangles, 2.9 to 16.1 KB each, 499 KB in all; 17 items have one zone, 27 two and 16 three.
- **Photo as colour:** the game projects the photo onto the whole asset from the front, as `buildPhotoAccessoryMesh` does for the digital
  accessory. The colour zones are the fallback for an item with no photo. **Decided (Dan, 2026-11-03):** the photo's colours are for the game asset
  only; whether a print takes colour depends on a multi-colour printer, and the printer here is single-colour, so a printed library item is one colour
  (probably no photo colours on a print, ever). Built after phase 4 (a forked agent): see "Colours from the photo: what was built".
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

The 60 items are 60 weekends, a little over a year of Fridays. **Simplified (Dan, 2026-11-03): no 3D loaner.** A household weekend names one item and
asks the child to **find one at home**; a grown-up confirms it (the Garage's existing real-life confirm), or the child can **skip** by playing "Who's that
shape?" (pick the item's silhouette from a few pictures, right in a row, less reward). Nothing is equipped in the game, so there is no hand slot, vehicle
or per-item stat question. A scan in the Kip viewer is a bonus: the match offer and the 3D item coloured from the photo. The full rules, the numbers and
the tool weekends are in "Household library drops" in [garage-weekend-spec.md](garage-weekend-spec.md). From this library the Garage needs a **front
picture of each item** (an SVG: each colour zone's outline from the front, back to front, plus the whole outline as the silhouette), written by the
library build; **built 2026-11-03**, see "Pictures: what was built". The review of the weekend proposal (docs/archive/review/household-weekends-review.md, 2026-11-03) widened that: the build also
writes the **three-quarter silhouette**, a hand-written **`group`** on each row (cutlery, tools, fruit, containers, stationery, toys, bath, kitchen; the
`family` column is a construction family, not a household one) and a **`confusableWith`** list per item (the items whose real silhouette overlaps it
above a threshold), because the picture decides whether the shape game is playable: measured on the real outlines (96 x 96, in a common box), 31 of the
1,770 pairs overlap 90 percent or more from the front and 15 of the 190 pairs among the 20 `simple` items do (all discs: ball, plate, flying disc, yo-yo,
marble, orange); from a three-quarter view 20 of 1,770 and 8 of 190.

## Tests

Built (phase 2), in two files:

- `tests/household-catalog.test.ts` (fast, no geometry built): 60 unique ids; every word maps to exactly one item; every scan rank is used once, exists
  in the scan list and carries that list's size; families, tags and prop sizes; no brand term. Every committed GLB is read back by a reader written in
  the test (not the writer's code) and checked as geometry: size and hash, within the budget, a material per zone in its colour, the triangle counts,
  standing on z = 0 with its longest side the prop size, no triangle without area, a closed and consistently oriented surface whose signed volume is
  the solid's, and unit normals that point outwards. The catalog checker (`household_catalog.py --verify`) is run on copies broken in 13 ways and must
  fail each.
- `tests/household-build.test.ts` (needs the partspec venv, skipped without it): `build_household.py --check` finds the committed files exactly as a
  fresh build produces them (nobody edited a builder or the data without rebuilding), a partial build matches byte for byte, and `--check` reports a
  changed byte, a missing file, a stray file and an edited catalog. `tests/fixtures/household_canaries.py` feeds the build's checks broken solids
  (a floating part, off the floor, wrong size, a grip that misses or only grazes, empty), budget overruns, an uncoloured zone, a bad colour and a brand
  word; each must be caught. Two regressions are kept as canaries (the first carrot's touching leaves, the first board game's pinched squares): the
  build must refuse each and accept the item now in the library.

Still to build: a printable version marked printable only if it passes its gates (see "Printable versions"). Matching (phase 4): each word finds its
item, a near word finds nothing, and the offer is never made below the confidence rule.

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
see "Decided after phase 2"); the spinning top was held by its point (it passed with 33 mm3 of contact, a thin join); Dan chose the blunt peg
(71), see "Decided after phase 2".

## Printable versions (measured 2026-11-03)

Digital first, a printable version on demand (Dan). `parts/kip/household/printable_probe.py` measured what happens today if a weekend asked for a printed
one: each item's front surface is kept as a height field (no undercut by construction), put on the Kip hand-prop grip by the part SDK and run through the
real gates, with none of the "make it printable" tuning. About 47 minutes for all 60 (a few items take over a minute; the ball 80 s, the tape dispenser
406 s). **10 of the 60 pass every blocking gate as they are**; the other 50 are digital only until they are tuned, and the sheet must say so.

| Result | Items |
| --- | --- |
| Prints as a relief (10) | banana, avocado, wooden spoon, paintbrush, pencil, marker, crayon, ruler, bubble wand, toy sword |
| Misses only by a small overhang, 12 mm2 or less (13) | ball, flying disc, marble, orange, lemon, fork, comb, eraser, glue stick, hammer, screwdriver, pliers, pencil case |
| Misses only by a larger overhang (15) | flask, cookie tin, yo-yo, apple, stapler, tape dispenser, dice, toy brick, tape measure, board game, jigsaw piece, playing cards, soap, sponge (270 mm2, the worst), cereal box |
| Fails the watertight gate, with or without an overhang (22) | mug, water bottle, drinking glass, jam jar, can, bowl, plate, bucket, watering can, potted plant, spinning top, carrot, key, hairbrush, toothbrush, scissors, flashlight, alarm clock, desk lamp, notebook, book, lunchbox |

By cause, an item can have more than one: 47 break `P1_no_supports` (an overhang steeper than 45 degrees), 22 break `G1_watertight`, and 7 break
`G3_single_body` because the relief came out as several pieces (watering can, potted plant, carrot, hairbrush, toothbrush, alarm clock, desk lamp: the
thin parts of those float free of the cut). The pilot's reading holds: the 13 near misses and most of the watertight failures look like tuning of the
height-field edge (smooth it, close tiny holes, a minimum thickness), not a rethink; the larger overhangs (boxes, the sponge) may need the relief to be
cut differently. Nothing in the game or the Garage depends on any of this.

## Phases 3 and 5: what was built (2026-11-03)

The other 31 of the first 50 (phase 3) and the next ten (phase 5) were built the way phase 2 was: one builder each in `household_builders.py`, a GLB
each, a catalog row, the same build rules and the same tests. `parts/partspec/.venv/bin/python3 parts/kip/household/build_household.py` rebuilds all
60 in a few seconds, byte for byte. Every GLB was decoded by the independent reader and drawn from three sides before it was accepted.

- **How the new ones are held.** Handled items stand handle down with the working end up (hammer, screwdriver, pliers, toothbrush, paintbrush, marker,
  crayon, glue stick, toy sword, bubble wand, fork, key, ruler, hairbrush). The carrot is held by its blunt 3.6 mm tip with its leaves up, the key by
  its ring, the avocado is a half on its flat base (skin, flesh and a pit standing proud of the front), the stapler, comb, board game, notebook, book,
  cereal box, soap, playing cards and jigsaw piece stand or lie with their big face to +y, and the sponge lies flat so the front shows its two layers.
  Flat items are plates with their faces to +y. Tools wear a `garage` or `tool` tag; `sharp-looking` items (fork, scissors, screwdriver, toy sword)
  end in rounded tips of radius 1.6 mm or more.
- **Grip margins.** The thinnest contacts with the shaft, of 72 mm3: plate 19, spinning top 33, banana 35, avocado 36, yo-yo 37, lemon 37, ruler 38,
  book 43, comb 43, notebook 44, key 44. The threshold stays 12.
- **What the checks and the pictures found in the new ones** (each is now a rule or a canary, so it cannot come back):
  - **The first carrot** had three leaves growing from one point; where they touched edge on the union left two triangles with no area, which only
    the file's 16-bit grid showed. The build now counts zero-area triangles in the encoded file and refuses (a triangle's area there is a whole multiple
    of half a step squared, about 1e-6 mm2 for a 90 mm item, so under 1e-7 is exactly zero); the independent reader checks the same.
  - **The first checkerboard** (board game) had dark squares meeting at their corners, which pinches the surface along a line. The build's own checks
    (one connected solid, the volume) did not see it; the independent reader's welded-edge test did. The build now runs the same test on the file's grid
    (every directed edge once, its reverse once), and the cells are 14 mm on a 15 mm pitch.
  - **A clockwise 2D polygon is silently dropped** by manifold3d. The stapler's arm came out empty (the build said so), and the playing cards' heart
    lost its triangle and looked like a bow (only the picture showed it). Every polygon is written counter-clockwise.
  - **Pages 0.1 mm off the boards** (notebook, book) left slits and internal faces that drew over the cover in the renderer. The pages now overlap the
    boards by 0.2 mm.
- **Tests.** The two household files went from 163 tests to 475. Mutation rounds on what was added: 12 changes to the new builders (a floating stem or
  handle, a grip that misses, a sliver of a fork, a zone with no colour, a reversed polygon, and a harmless nudge that only the drift check can see)
  and 8 to the new checks (each check removed or weakened in turn, and the old carrot and board game put back): all 20 were killed. The round found a
  trap in its own driver: Python reuses a cached `.pyc` for a source file of the same size changed within the same second, so a run could execute the
  previous mutation. The driver now clears `__pycache__` and sets `PYTHONDONTWRITEBYTECODE`.
- **What phase 5 did not do.** The properly soft items (sneaker, slipper, sock, sunglasses) are still out. The age rule's data (`minBand`, `simple`,
  the support tool) and the blunt-peg top were built after Dan confirmed them, below.

## Phase 4: what was built (2026-11-03, a forked agent; checked by the main session)

Built in the Kip viewer and the print panel, in `shared/householdMatch.ts` (the matcher), `shared/photoPrintFlow.ts` (`loadHouseholdCatalog`,
`offerForScan`), `parts/kip/viewer/kip-photo-print.js` (the offer box), `kip-forge-sdk.js` (`buildHouseholdHandMesh`) and `kip-bench.js`
(`equipHouseholdItem`, `readAgeBand`, the dev handles `act.equipHousehold` and `read.household`). Tests: `tests/household-match.test.ts`,
`household-offer.test.ts`, `household-equip.test.ts`; browser: `E2E_GPU=metal tsx scripts/e2e-kip-household.mjs` (`npm run e2e:kip-household`).

- **Equip frame (measured in a real browser).** A library GLB sits in the hand slot exactly as a photo plate does (handle 6.6 x 28 mm, collar, head at
  y = 26, the grip group turned -90 degrees about z at (-12, -11.4, 2.3); a test compares the numbers with `buildPhotoAccessoryMesh`). The half turn
  about the up axis is needed: without it the item's front points exactly opposite a plate's front; with it the fronts match (dot 0.99). That alone does
  not face the camera: at rest the hand points the item behind Kip, so a child sees only a handle (true of photo plates too). Equip therefore plays the
  existing "Inspect" clip (`prop_magnifier`) and turns the item a further quarter turn (`HOUSEHOLD_HOLD_YAW = pi / 2`). Across the 60 items the front
  points at the camera with its lowest z at 0.965 and its up at least 0.973 (y). The quarter turn belongs to that clip: change the clip and the yaw has
  to be measured again. So Dan's "turn 180 degrees about z" was right as the frame match and not enough on its own.
- **Matching, as built.** A word must be in exactly one built item's list; an exact word wins. Normalising is case, spacing, punctuation to a space and
  a leading "a", "an" or "the". A plural (`s`, or `es` after a hissing sound) is read only when the word is not listed and it reaches one item. "glasses"
  is blocked (it means spectacles). An ambiguous word finds nothing, and a near word finds nothing. A good outline is fidelity of at least 0.95 with no
  warning other than `POINT_BUDGET_NOT_MET`, `NOT_SYMMETRIC` or `GATE_REWROTE_OUTLINE` (an unknown warning counts as bad). A good outline gets the offer
  beside the flat plate; a poor outline, or a failed trace (`no_match`, `no_outline`, `outline_failed`), gets the item on its own ("I could not trace your
  photo, but here is the 3D scissors"); an offline, busy or rate-limited scan offers nothing. The support tool list is ignored. Nothing is ever applied
  without the child choosing.
- **Age.** The matcher reads each row's `minBand`; an item above the child's band is not offered (reason `above_age_band`) and the plate flow is
  untouched. No band, or `null`, means no limit; a value that is not a band reads as band 0. The bench reads `ageBand` from `toyforge:progression:v1`, as
  the app does; a missing, corrupt or invalid value counts as unset.
- **Real data.** The one real photo (the steel spoon) scores fidelity 0.924 with no warnings, so under the 0.95 rule it is offered the item on its
  own ("outline not clear"), not beside the plate. The threshold needs more photos before it is changed.
- **Verified.** Unit: 12 related files, 1,102 tests and `tsc` clean (the agent's run). Main session: re-ran seven files (818 tests) and `tsc`, clean.
  Browser (the agent's run, headless Chrome on the GPU, `/api/scan` standing in with the spoon's real outline): 60 of 60, every built item equipped and
  measured, the offer in a plain page and in the bench; the existing photo-print e2e still 57 of 57. Mutation rounds: 57 of 57 unit and 23 of 23 browser
  mutants killed in the end (two of each survived at first and got a test).
- **Not verified:** a real phone, the React game, a real Worker returning a good outline.
- **Not built:** a printed library item (the print pack ignores one, so it is digital only; photo colours are built, see below). There is no weekend
  loaner any more (see above).
- **Traps:** the e2e harness defaults to SwiftShader, which cannot load the 3D bench in reasonable time: use `E2E_GPU=metal`. The bundle
  `./kip-photo-print-core.js?v=10.0` is pinned by a test and was not bumped: a browser holding an old core lacks `loadHouseholdCatalog`, so bump the
  version on deploy. Any later edit of the viewer sources needs the same copy into `public/kip` (`npm run build:kip`, which a peer's lane also runs).

## Colours from the photo: what was built (2026-11-03, a forked agent; checked by the main session)

Game asset only (Dan: single-colour printer, so no photo colours in any print). `shared/photoPrintFlow.ts` builds the **skin**, the photo cut to the
object's outline and made whole; `parts/kip/viewer/kip-forge-sdk.js` `applyHouseholdSkin` puts it on the item (planar UVs from the item's bounding box at
equip time, a shader patch, per-vertex front-facing weights); `kip-photo-print.js` builds the skin when the child takes the item; `kip-bench.js` applies it and
shows a chip. No UV data is stored in the GLBs. A test (`tests/household-skin.test.ts`) fails if the print pack, the print view or the sticker sheet ever
mentions a skin.

- **When.** Only when the scan produced an outline, whether the offer is beside the plate or on its own with a poor outline (the child sees the cut line
  first). A word-only offer, or any take with no outline, keeps the zone colours and never says "coloured". The offer says the item "can wear the colours of
  your photo" only when an outline exists; after taking it a chip reads "3D mug: coloured from your photo", with a button to switch to the item's own colours
  and back (a steel spoon on a wooden-spoon item is a real case).
- **Mapping.** The photo's box is laid over the item's front box. The scan turns an object so its long axis is up (which laid a mug on its side); the skin
  uses the photo as photographed and takes the scan's turned frame only when that fits the item's front clearly better (a 5 percent tie-break to upright):
  a cup photo on a mug stays upright, on a toothbrush it turns. A shape mismatch above 1.6 times uses "contain", so a spoon photo on a mug is not stretched.
  The photo fades per vertex from 75 degrees to 37 degrees off the front (smoothstep): none at or past 75, all within 37, none on the back.
- **The skin picture.** 384 px on the longest side; the outline's outer 4 px ring is dropped (a rounded cut can include table colour); edge colours are
  carried out 10 px and the object's mean colour fills the rest, so the photo's background never reaches the item.
- **Verified.** Unit: 14 files, 1,380 tests (the agent's run); main session re-ran 8 files, 1,060 tests, `tsc` clean apart from another lane's
  `tests/yard-vehicles.test.ts`. Browser (`E2E_GPU=metal`, the agent's run): `e2e-kip-household` 101 of 101 including part C (`E2E_PART=C`), photo-print
  57 of 57. Pictures looked at: the real spoon mask on the wooden spoon, the real cup mask drawn red and white on the mug and the ball, and the spoon photo on
  the mug in all three fit modes, each from the front, side and back. Share of the item's pixels that change: spoon 0.71 front, 0.42 side, 0.00 back; mug
  0.59, 0.26, 0.00; ball 0.43, 0.20, 0.00. A skin red on the left and blue on the right reads that way from the front (not mirrored). Mutation rounds: unit 47
  of 47, browser 16 of 16, each survivor given a test.
- **Not verified / limits.** The repo holds no real photos: the spoon and the cup are real masks with drawn colours. The React game and a real phone; the
  chip on a small screen. A hole the outline fills (a cup handle's gap) shows the background colour through it, visible as a tan patch on the cup-on-ball
  picture. The 590 KB skin texture is not disposed when the item is replaced. The `?v=10.0` import is not bumped: a cached old core bundle would lack the new
  functions, so bump it on deploy.
- **Open for Dan.** (1) Colour on a poor outline too (it does now)? (2) The chip, or the panel, for the way back? (3) Where the photographed object does not
  reach, the photo's mean colour (now) or the item's own zone colours?

## Pictures: what was built (2026-11-03)

For the Garage sheet, the grown-up's confirm and the shape game. `parts/kip/household/household_pictures.py`; the build writes
`public/kip/household/pictures.json` (72 KB; one entry per item and for the support tool) and adds `group` and `confusableWith` to every catalog row.
`--check` compares the pictures file too, so it cannot drift.

- **Per item, in a 100 x 100 box** (aspect kept, centred, y down, SVG path data drawn with the even-odd rule): `front` (the whole outline from +y, for the
  grown-up's confirm), `threeQuarter` (turned 35 degrees and tipped 20, the shape game's picture) and `zones` (each colour zone's outline from the front,
  back to front, with its colour: the coloured picture on the sheet). Each zone is the union of its pieces, moved exactly as the whole item was fitted, so
  zones sit where the finished solid does.
- **`group`:** hand-written, nine names (cutlery, kitchen, containers, fruit, tools, stationery, toys, bath, home), every item and the support tool in one,
  none holding a single item (cutlery has two); the checker refuses an unknown group or a group of one. It is not the `family` column.
- **`confusableWith`:** the items whose three-quarter outline overlaps the item's by at least 0.75 (intersection over union, both fitted to the box;
  symmetric). The round things form one clique (ball, marble, plate, flying disc, yo-yo, orange, ...); 19 items, among them the spoon, banana, key, hammer
  and scissors, look like nothing; the mean is 4.4 look-alikes. The build refuses a catalog in which any item has fewer than three wrong answers to use,
  drawn from the pool its youngest band may ask it in (a simple item from the simple ones, any other from the items its own band may see). The fewest any
  item has is 36 in its own band pool and 11 in the simple pool (the orange).
- **Checked:** the tests read `pictures.json` themselves (not the build's code): every item has all three pictures and the catalog's zones in their
  colours; each front outline fills the box and has the proportions of the item's own size; groups; the look-alike table is symmetric and names real items;
  the round things are alike and the spoon is not; every item has three wrong answers; zones are back to front. Canaries feed the picture maths broken
  inputs (overlap, the box path, the distractor rule with too few, too old and not-simple wrong answers, a build whose outlines all look alike). A mutation
  round on the picture code killed 11 of 11 (two only when the output was rebuilt, which is how the independent checks see a builder change).
- **Not built:** the shape game, the weekend drops, the completion and the roof mark (the Garage spec); the picture of the item on the sheet and the
  confirm (the game draws these paths).

## Phases

1. **Spec and pilot** (this document): the list, the pilot, the numbers. Done.
2. **The 15 simplest** (the pure revolved items, family R): builders, the GLB for each, the catalog JSON and the tests. **Done 2026-11-03**, with
   the four pilot items kept (mug, wooden spoon, pencil, banana): 19 built. See below.
3. **The rest of the 50**, including the composites and the organic items; the build test. **Done 2026-11-03**: all 50 built. The printable-relief step is on demand (decided after phase 2); its measurement is in "Printable versions".
4. **The game side:** equipping a library item in the hand slot, the match offer in the print panel. **Built 2026-11-03** in the Kip viewer (the React
   game does not load a GLB hand part, and no longer needs to: the weekend loaner was dropped). The weekend itself is the Garage's "find one at home"
   (Garage spec), not built.
5. **The next ten** (plain boxes, a puzzle piece, soap and a sponge). **Done 2026-11-03**: board game, jigsaw piece, notebook, book, playing cards,
   pencil case, soap, sponge, cereal box and lunchbox, all from the scan list. The properly soft items come after.

## Decided after phase 2 (Dan, 2026-11-03)

1. **Limit by age, and keep the activity working for the young.** Items are limited by age band: the engine's six (`src/lib/age.ts`: 0 = 2-3, 1 = 3-4,
   2 = 5-6, 3 = 7-9, 4 = 10-12, 5 = 13+, set by a grown-up behind the PIN gate). A held-back item is not simply hidden. A younger band gets a
   **simplified item to match**, or a **multi-purpose tool** that does the job of several, so what the child is doing still works; an older band
   **needs more of the real tools**. (Dan: "if tools [are] disabled use the support tools to work in lower age tiers but in older require more
   tools".)
   - **Confirmed (Dan, 2026-11-03: "agreed yes to both"):** one chunky, rounded multi-purpose toy tool, the **support tool** (a new item outside the
     60), stands in for the tool jobs of the youngest bands, and older bands need more of the real tools. A tool job in a weekend names what it needs.

     | Band (age) | Items shown | A tool job needs |
     | --- | --- | --- |
     | 0-1 (2-3, 3-4) | no `sharp-looking` item and no real tool; simple shapes; pick between two by picture | the support tool, which stands in for any job |
     | 2 (5-6) | blunt tools too (hammer, pliers, flashlight, tape measure, bucket), no `sharp-looking` | 1 tool; the support tool still stands in for the rest |
     | 3 (7-9) | every item; the support tool no longer stands in | 2 different tools |
     | 4-5 (10-12, 13+) | every item | 3 different tools |

   - **Built (2026-11-03):** a `minBand` on every catalog row, computed from its tags and checked (sharp-looking items 3, the other garage items 2, the
     other 51 items 0); a `simple` flag on 20 items that read at a glance for ages 2 to 4 (one or two colours, never a tool, never sharp-looking, at
     least three families: ball, mug, water bottle, drinking glass, bowl, plate, orange, banana, carrot, lemon, wooden spoon, toothbrush, crayon, soap,
     sponge, toy brick, yo-yo, flying disc, cookie tin, marble); and the support tool itself, `support_tool` (a mallet head with a gear on its front, handle
     down), held in the catalog's separate `support` list so the 60 stay 60 and no word ever maps to it. It is shown in bands 0 to 2.
   - **Not built:** the Garage's side, a tool job counting 1, 2 or 3 different tools by band and the support tool standing in (it reads `minBand`,
     `maxBand` and the support list; `src/lib/garage.ts` is where it lands), and per-item simplified shapes (the `simple` pool picks items that are
     already simple; an item that is complicated, such as the comb or the ruler, is simply not in it).
2. **Equip in the game: ok.** Decided in phase 4 by loading one library GLB through the Kip viewer's custom-prop hand path and seeing which way it
   faces; if it faces away, the equip step turns it 180 degrees about z and the assets stay in the printed-part frame. (Result, "Phase 4: what was
   built": the half turn matches a plate's frame but the hand points the item behind Kip, so equip also plays the Inspect clip and turns it a quarter
   turn more; the assets stay in the printed-part frame.)
3. **The weekend: find one at home, or skip it** (Dan, 2026-11-03, replacing the earlier "keep a loaner by scanning the real one, with a room of the
   map as the fallback"; "these seem unnecessary complicated, can we simplify?"). No loaner. A grown-up confirms the find; the skip is a "Who's that
   shape?" game, not one tap ("think about a not so easy way to skip, maybe item based or clue based"). Details and numbers in the Garage spec.
4. **Printable versions: digital first, a printable version on demand.** Built only for an item a weekend asks for, and called printable only if it
   passes the gates.
5. **The spinning top gets a short blunt peg** (Dan, 2026-11-03: "agreed yes to both"). Done: the 6.8 mm peg gives 71 of 72 mm3 of contact with the
   shaft where the 3.2 mm point gave 33, and it still reads as a top; a test keeps it above 60.

## Open questions

1. **The silhouette check** in the confidence rule needs a threshold from real photos: the photo batch tool can supply it once there are more
   photos of forks, spatulas and wands.
2. **Tool jobs in the Garage:** the counts (1, 2, 3 tools) and the support tool standing in are decided and not yet in the Garage's code. The drops
   are already written per band group (`bandGroupOf` in `src/lib/garage.ts`: tiny = bands 0-1, early = 2, mid = 3, older = 4-5, the same cut-offs), so a
   tool weekend is one variant per group.
3. **The soft items** (sneaker, slipper, sock, sunglasses) are not built and need a decision on how a soft shape is drawn as a held, rigid part.
4. **The household weekend, to confirm** (my proposals, in the Garage spec): the skip game's numbers (2/3/4/4 pictures, 2/2/3/3 right in a row), skip
   paying XP, stamp and trophy but no play-time minutes, and the front pictures to build. Smaller: whether the offer also appears when the helper is
   offline, by the child's own word (I would say yes), and the 0.95 fidelity threshold (keep it until there are more real photos).
