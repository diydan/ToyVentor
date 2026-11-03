# Playful interactions: fruit, feeding, sleeping and more (draft)

## Status

**Proposed, 2026-11-03, from Dan's phone playtest of the Garden. Dan's decisions the same day: feeding is by DRAG; I hand-build the animations; grow the Describe & Build book now.
Built so far: the five new character clips (section 5), the grown Describe & Build book (section 7), and phase 1a (section 3: the eleven fruit names, tapping a fruit, the longer rest) plus the feeding RULES (section 4). **Drag-to-feed is now built and works in the real Garden** (2026-11-03, section 4: the drag, the carry, the bite, Kip's `eat` clip, the full belly pat and the refusal, robot and vehicle reactions; real-browser e2e 20/20). **Tap the bed to put Kip to sleep is built too, and works in the real Toy Room** (section 6, e2e 21/21). **The orchard is built too: the Garden's trees are apple, pear, orange and cherry trees, each with its own fruit** (section 3, e2e 20/20). **Palms and berry bushes grow their own fruit too** (the Beach has a coconut palm and a banana palm, the Garden a strawberry and a blueberry bush). Still to build: colour variants (a green apple), a pumpkin patch, a robot's power-down, more interactions from the backlog.** It extends carousel spec §11.7 ("no dead props": every prop reacts, says what it is) from
*props that react* to *things a child can pick up, feed to a character, and put to bed*. It shares its data tables with [generated-worlds-spec.md](generated-worlds-spec.md), so a generated
world can grow any of these fruits and trees.

## What Dan said (playtest, 2026-11-03)

- The Garden's parallax backdrop and the two trees: **perfect**.
- The voice is good, but tapping an **apple** should say "red apple" (today only the tree speaks).
- **Why do the apples vanish?** A child should be able to **feed the apple to Kip, or any character that eats**. Wants a bunch of different fruits and trees. Wants to know what other interactions
  like this we could do.
- Toy Room: **tap the bed and Kip gets in and sleeps**; any other fun interactions like that.
- Describe & Build works but is limited: "tractor" does not work.

## 1. What is true today (measured in code)

- **Why fruit vanishes.** Fallen fruit is a loose mesh in the world root that rolls, settles and is tidied away, with a cap of 48, so the ground never clutters. It is a visual effect only: nothing can pick
  it up or consume it, and its meshes are marked `noPick`, so a tap goes straight through it. A tree has three apple slots that grow back after about 10 s.
- **Fruit are data, partly.** `FRUIT` in `propReactions.ts` has apple, coconut, snow, berry and rain (size, colour, roughness, glow). Which prop drops which is in `PROP_SPECS`.
- **Fruit have no names.** The voice speaks a closed vocabulary (25 prop nouns, 12 colours, 7 languages, plus 30 Describe & Build parts); `/api/voice` takes vocabulary keys only. "Apple" is not a noun
  in it, so "red apple" cannot be spoken yet.
- **No character can eat or sleep.** The world character plays five baked Mixamo actions (`dance`, `nod`, `no`, `sneak`, `sad`) plus walking and a joy hop. The Kip viewer has 38 hand-built
  procedural clips (cheer, clap, bow, dances, 15 prop clips) but on the viewer's rig, not the world's. Rig kinds in the world: **character** (Kip and the others), **robot**, **vehicle**.
- **The Toy Room has no bed.** Its props are lamp, blocks, books, chair, plant, teddy, ball, cushions.
- **A learning hook exists:** `learnRungs.ts` already asks "How many apples? 🍎🍎🍎".

## 2. Principles

1. Every tap does something you can see, hear and name (§11.7 stays true). A fruit is a prop now.
2. Fruit, trees and eaters are **rows in tables**, not code: adding a fruit is a row. That is also what lets Muse-generated worlds use them.
3. Reactions are **per kind of toy**: a character eats, a robot crunches, a vehicle politely declines (and can carry the fruit in its bed). Nothing scary, nothing that punishes.
4. Gentle pacing: after a few fruits the eater is **full** (a pat of the belly, a happy sigh) so feeding is a loop with a rhythm, not a spam button.
5. Every fruit says its name in the child's language, in the colour it is (it reuses the existing noun-and-colour agreement, so "manzana roja" and "rotes Apfel" come out right).

## 3. Fruit and trees

**Fruit (first ten):** red apple, green apple, pear, orange, lemon, cherries, banana, plum, strawberry, blueberries, coconut, pumpkin. Each row: noun key, colour key, size, shape (sphere, pear, crescent,
cluster), glow, the sound it makes, how the eater reacts (most "yum", a lemon "sour face", a pumpkin "too big: roll it").

**Trees (first six):** apple (exists), pear, orange, cherry (blossom), banana palm, coconut palm (exists), plus bushes (strawberry, blueberry) and a pumpkin patch. One `tree` builder takes a **kind**:
crown shape (round, tiered, cone, palm fronds), leaf colour, trunk, which fruit and how many slots. The Garden gets a mixed orchard; other worlds get what suits them (palm and coconut on the Beach).

**Built (2026-11-03, phase 1a).** Eleven fruit nouns in all seven languages (`propNames.ts`: apple, pear, orange, lemon, cherries, banana, plum, strawberry, blueberries, coconut, pumpkin) and a fruit table in `propReactions.ts`
(`FRUIT`: radius, colour, stretch, glow, name, and the colour word it is called by; a fruit named for its colour, the orange, says just "orange", never "orange orange"). **A tap on a fruit says its name** ("Red apple",
"Manzana roja", "Kırmızı elma"...) and reacts: a hanging apple is plucked and the slot regrows, a fallen one hops. A fruit in front of a tree wins the tap over the tree; a tap on the trunk or crown still shakes it.
**Fallen fruit now rests 12 s** (was 1.6 s, gone before a finger got there) before it is tidied away; snow and rain still tidy fast. Seen and checked in the real game (props e2e 80/80, 8 new checks), 53 unit tests
for propReactions (mutation-checked eight ways). The clip list the prewarm script warms now includes every fruit; the review sheet lists the one new accent collision, `pera verde` (Spanish, Italian and Portuguese
spell it the same). **Not built:** the other fruit on trees (only apples grow so far), the tree kinds and the orchard, colour variants (a green apple).

**The orchard is built and hooked up (2026-11-03).** `runtime/treeKinds.ts` holds ten kinds; the six blob-crowned ones (apple, pear, orange, cherry, plum, lemon) are real trees now. `tree()` in `world.ts` draws a tree from `treeShape(kind)`:
trunk height, one of three crown shapes (round, tall and narrow for the pear, low and wide for cherry and plum), a leaf tint (lime for the pear, blush for the cherry...) and four blossoms of the kind's colour with a yellow
centre. The tree's group carries `userData.treeKind`, and `propReactions.ts` hangs, drops, plucks and regrows THAT kind's fruit (`inst.fruit`, `inst.fruitSlots`); a tree with no kind (the decorative branch tree, a custom level's
tree) is the apple tree exactly as before (the apple's shape is pinned by golden values in `tests/tree-kinds.test.ts`). `orchardKind(world, i)` mixes a row: the Garden now has **apple (x 9.5), pear (16), orange (26.5) and cherry
(40.5)** along its lane (two trees added; the old tree left of the lane stays the plain apple tree and takes no turn, so the first tree a child meets is still the apple tree they know); generated Garden and Sky levels cycle
apple, pear, orange, cherry, plum, lemon. Tapping any hanging fruit says its name ("Green pear", "Orange", "Red cherries"), and it can be dragged to Kip like an apple (a lemon makes Kip pull a sour face). **Checked:** 21 + 20 unit
tests (mutation-checked), `scripts/e2e-orchard.mjs` (real Chrome, 20/20, stable over four runs) and the older e2es still pass (props 82/82, feeding 20/20, bed 21/21). **Not done:** a tree still says "Green tree" whatever its kind (a
"pear tree" noun in seven languages is a vocabulary change); a pumpkin patch; colour variants (a green apple).

**Palms and bushes by kind (2026-11-03, later).** `kindFor(world, propType, i)` picks the i-th kind that grows in a world AND fits the prop (`kindFits`: a tree gets a blob-crowned kind, a palm a palm kind, a bush a bush kind; a kind on the wrong prop is ignored), with `orchardKind`, `palmKind` and `bushKind` as thin wrappers. `palm(x, z, kind)` draws the coconut palm exactly as before (its three decorative coconuts are now real hanging fruit) or a banana palm with lighter fronds, and says where its fruit hang (`userData.fruitSlots`, under the fronds and in front of the trunk, from `palmFruitOffsets`); `bushes(x, z, kind)` tints the leaves (blue-ish for blueberries) and the fruit sits on the foliage like an apple does. `propReactions.ts` hangs, drops (a shake now drops two real, tappable, feedable coconuts or strawberries instead of the old anonymous burst) and regrows them; a palm or bush with no kind (a custom level's) keeps the old burst. The Beach: coconut palm (x 24, two coconuts, "Brown coconut") and banana palm (x 40, three bananas, "Yellow banana"); the palm left of the lane stays the plain coconut palm. The Garden: a new strawberry bush near the start (x 4) and the old bush at x 44, past the bridge, is now the blueberry bush. Coconut radius .17 to .22 so it reads on the palm. Checked: `tests/prop-orchard.test.ts` 24 and `tests/tree-kinds.test.ts` 24 (mutation-checked), `scripts/e2e-orchard.mjs` 35/35 (strawberry bush, both palms, a banana fed to Kip); props e2e 84/84.

**Voice.** Add the fruit nouns to `src/lib/propNames.ts` (about 12 nouns x 7 languages, built with gender and number like the others), a guard test like the part-names one, and extend the native review
sheet. About 20 fruit-and-colour phrases x 7 languages, roughly 140 more clips to prewarm. A fruit a generated world invents uses the signed-names route (`worker/forgeNames.ts`).

## 4. Pick up and feed

1. **Decided (Dan, 2026-11-03): feeding is by DRAG.** **Tap a hanging fruit:** it shakes loose (the tree shake already exists) and says its name. **Tap a fallen fruit:** it says its name and gives a little wiggle.
   **Drag a fruit onto the character:** the fruit follows the finger, the character leans toward it, and on release over the character (a generous target: the whole figure plus a margin) the toy turns,
   eats, the fruit shrinks into its mouth (a bite, then it is gone, not a vanish). Released anywhere else, the fruit drops and rolls as it does now. A fruit that is dragged near a toy that is too far away
   is not fed (the toy does not walk to it; dragging is the intent). Drag is harder for the youngest, so the target is large, the fruit is big (the new apples are 0.24 units) and the drag starts on a small movement.
2. **By kind of toy:** character, a hand-to-mouth eat clip with a chew and a happy hop; robot, a crunch with a spark and a beep; vehicle, a honk and "no thanks" (the existing `no`) and the fruit rolls into
   its bed or onto its roof as cargo.
3. **Per fruit:** lemon makes a sour face; banana peels (a skin stays for one gentle slip? **not** in the first cut); strawberry is a quick nibble. Variety makes the loop funny without new systems.
4. **Full:** after three fruits in about 20 s the eater pats its belly and a yawn plays; the tree stops dropping for a minute. No hunger meter, no bad outcome.
5. **Unclaimed fruit** is still tidied away after a while (the cap stays), but a nearby eater, or a **basket** prop (phase 4), keeps it. A basket counts fruit and ties to the existing counting rung.
7. **The rules are built** (`runtime/fruitAppetite.ts`, 11 tests mutation-checked nine ways): a character eats (a lemon makes it pull a sour face), a robot crunches, a vehicle declines and never counts towards being full; the
   third fruit within 20 s is eaten and fills the toy, which pats its belly afterwards and refuses with a belly pat for 8 s, then is hungry again; snow and rain are not food. The drag that calls it is built, below.
8. **The drag is built and hooked up (2026-11-03).** `runtime/fruitDrag.ts` (the gesture: tap on release, carry after 8 px, feed or drop), `runtime/fruitFeeding.ts` (gesture + rules behind one adapter, and `reactionSteps`, the
   timeline: the belly pat starts after the first reaction ends) and `runtime/feedingHook.ts` (the three.js half: pointer to ray, carry on a plane in front of the toy, "over the toy" from the toy's projected box plus a 48 px margin,
   the fruit flying to the mouth in 0.35 s, and what each toy does) with a small hook in `world.ts`: `FEED.down(e)` BEFORE the prop tap in the pointerdown handler (so a press on a fruit is not a tap yet), `pointermove`,
   `pointerup` and `pointercancel` listeners, `FEED.update(dt)` each frame and `FEED.reset()` with the prop fx. `propReactions.ts` gained `pickFruit` (finds a fruit without acting), `liftFruit`, `carryFruit`, `dropFruit`,
   `eatFruit` and `tapFruitRef`; loose fruit has two new states, carried (no physics, never tidied or evicted by the cap) and being eaten. **What a child sees:** press an apple and drag: it comes off the tree under the finger,
   a little bigger; over Kip and let go: Kip's hand comes up, the apple flies into its mouth and is gone, three chews; the third apple in 20 s is followed by a belly pat and Kip then refuses for 8 s (the apple falls back to the
   ground); let go elsewhere: it falls, bounces once and rests 12 s; press and release without moving: it says its name, as before. A robot crunches (three crunches, hops, a spark); a vehicle shakes and honks and the fruit falls.
   **Checked:** 22 + 19 + 21 unit tests (all mutation-checked), `scripts/e2e-feeding.mjs` (real Chrome on the Metal GPU, real mouse events, 20/20) and the older props e2e still 80/80. **Not done:** the toy does not lean toward
   the fruit while it hovers (the hook reports it, nothing uses it yet); robot and vehicle reactions are unit-tested but not seen in a real browser; a fruit other than the apple (pear, lemon...) cannot hang yet (tree kinds).
6. **Tap-to-feed** (a tap on a fallen fruit when a toy is close) can be added later as an accessibility fallback for the youngest. It is not the first cut.

## 5. The animations (the real cost) (built 2026-11-03)

**Done: Dan decided I hand-build them.** `runtime/proceduralClips.ts` authors five clips as keyframes and **bakes them into the Mixamo clip format**, so the existing `MixamoDriver` plays them with its
normal blending: `eat` (hand to mouth, three chews, a happy hop, 1.7 s), `sour` (a lemon: head back, shiver, hands up), `belly_pat` (full), `yawn`, and `sleep`. `sleep` is a **held** pose, so the driver
gained a hold mode (`holdAction` / `releaseHold` / `holding`: eases in over 0.8 s, loops, is not cancelled by walking, eases out over 0.6 s when released). Seen in the real game (portrait Garden):
`eat` raises the right arm in front of the face with the head bowed (it will read as eating once an apple is in the hand); `sleep` lies the toy a true 90 degrees on its back, lifted clear of the
ground, with the whole body centred where it stood. Two things worth knowing: the driver applies only 0.7 of a clip's body rotation, so the lying angle is authored at 90 / 0.7 (`gainFor`); and a rig tips
about its feet, so the clip moves the hips forward half a body length to centre the lying body. 15 unit tests drive the real driver with a character rig, mutation-checked eight ways.
**Not done:** the robot's crunch and the vehicle's decline (rig-level transforms, since the driver only drives `character` rigs), and wiring any of it to fruit, drag or the bed.
Earlier plan, kept for the record:

New clips needed on the **world's rig**: `eat`, `sour`, `belly_pat` (full), `yawn`, `sleep` (lie down, breathing, Zzz), `get_in_bed` (a hop up), `wake` (stretch), `crunch` (robot). `no` and `cheer`-like
reactions exist. Authoring: Mixamo needs an Adobe login I do not have, so these are **hand-built procedural clips**, the same way the 38 Kip viewer clips were made (`parts/kip/viewer/kip-clips.js`). The
**first task is a spike**: how the world's rig differs from the viewer's (can `kip-clips.js` be reused or must the clips be re-authored on the world skeleton?) and one working `eat` clip seen in the real game.
Alternative: Dan downloads Mixamo's "Eating" and "Sleeping Idle" and I retarget them (the existing Mixamo path), which looks better but needs his login and the licence check.

## 6. The Toy Room bed, and other interactions

**Bed (what Dan asked for).** Add a chunky toy-style `bed` prop (rounded frame, pillow, a starry blanket). **Tap the bed:** the toy walks over, hops up, lies down, blanket up, small "Zzz" bubbles rise; the lamp
dims (the lamp's existing off), the music fades (the stage already has a music fade for pausing), the room tints a soft dusk blue. **Tap anywhere or the bed again:** stretch, yawn, back to normal. Robot: powers
down on the bed with a slow blue glow. Vehicle: parks in a small **garage** prop with its lights fading. An optional tie-in to the grown-ups' quiet hours later.

**Built (2026-11-03): tap the bed, Kip sleeps.** The Toy Room already had a bed: the hiding place for the jetpack ("Under the bed", hide spot at x 13, which used to vanish once the part was found). It is now the real bed
(`runtime/bed.ts`: rounded orange frame on four feet, light-blue mattress, pillow at the head end, a purple star blanket folded at the foot, tall headboard, low footboard) and it **stays after the part is found**; it is also a
registered prop (`bed`: "colorful bed" in seven languages, `use: "sleep"`), so a custom level can place one too. **Tap it:** it says its name; Kip walks along its own lane to the bed, **hops up** (an eased arc, 0.7 s) and lies
on its back with its head on the pillow (the held `sleep` clip: the whole body fits between the pillow and the blanket); the lamps go out, the picture slides to a **soft dusk blue** (cooler tint, a little less colour, a darker
vignette, lights down to 55%) over 2.5 s, the music falls to 20% and **Zzz** letters drift up from the pillow. **Tap anywhere** (bed or not): Kip stands, yawns with arms up, the lamps and music come back, it **hops down**
to where it climbed from and can walk at once; that tap does not also walk Kip. Changing its mind works: tapping elsewhere while Kip walks to the bed drops the sleep and Kip goes where it was sent; the walk gives up after 8 s.
A robot or vehicle politely refuses (a shake and a honk): **a robot's power-down is not built**. With reduced motion Kip still hops and the room still dims but Kip stands on the bed instead of lying down.
Code: `runtime/sleepRoutine.ts` (the state machine: awake, walking, climbing, lying, asleep, waking, descending), `runtime/sleepHook.ts` (the three.js half: which bed, the Zzz sprites, what the room does), `runtime/dusk.ts`
and `lighting.ts` `setDusk` (the tint and the dimmed lights), `propReactions.ts` `lightsOut` (lamps out and back exactly as they were; a lamp the child had switched off stays off), and ~8 small edits in `world.ts`
(the hide-spot bed builds `buildBed` and registers it, `furnishBed` also when the part is found, `SLEEPH`, a `consume()` before everything else in pointerdown, update and reset). **Checked:** 17 + 5 + 9 + 23 + 10 unit tests
(all mutation-checked) and `scripts/e2e-bed.mjs` in real Chrome (21 checks, including "the bed is still there once the jetpack is found", which fails without the fix); props e2e now 82/82 and feeding e2e 20/20.
**Not done:** generated Toy Room levels (`levelKit`) do not place a bed (only the default room and the editor do); a robot's power-down; the quiet-hours tie-in.

**More like it, ranked by delight for effort** (all need only a prop plus one or two clips; the table is the backlog):

| Where | Interaction | Needs | Effort |
| --- | --- | --- | --- |
| Toy Room | **Ball:** the toy kicks it, it bounces and rolls, the teddy catches | kick clip, ball physics (a roll exists) | small |
| Toy Room | **Blocks:** tap to stack a tower, it wobbles, tap the top to knock it down | stack state | small |
| Toy Room | **Cushions:** jump on them, they squish and boing | bounce clip | small |
| Toy Room | **Teddy:** hug it, a heart floats up | hug clip | small |
| Toy Room | **Books:** open one, pages flutter and a line of a story is read aloud (the voice path exists) | story text | medium |
| Toy Room | **Toy piano / xylophone:** tap keys, notes play | a few notes | small |
| Toy Room | **Mirror:** the toy sees itself and pulls faces (Kip's face system) | face clips | medium |
| Garden | **Watering can on plants:** a flower grows; give the bouquet to a character | grow anim | small |
| Garden | **Bunny:** feed it a carrot (feeding, reversed) | bunny prop | medium |
| Garden | **Picnic blanket and basket:** sit and eat a sandwich | sit clip | medium |
| Garden | **Swing** on the apple tree | swing anim | medium |
| Beach / Snow | **Sandcastle** build and knock down; **snowman** rolled from snowballs, **snow angel** | build state, lie clip | medium |
| Sky Meadow | **Cloud bounce:** jump on clouds | bounce clip | small |
| Junkyard | **Tire roll**, **crane drop** | physics | medium |

## 7. Describe & Build: why "tractor" fails, and the fix

**Why.** Muse only *chooses* among the **10 validated builds** (Roadster, Pickup, Scooter, Skateboard, Kip in a cowboy hat, Kip with a bob and a top hat, Ranger Kip, Jetpack robot, Kip at the wheel, Cowboy in a
pickup). A tractor is not one of them, so it picks the nearest or asks a question. The deployed Worker cannot invent a build because the check that makes a build real (the assembly validator) is Python.
The 30 curated parts *can* make one: a truck chassis, big off-road wheels and a cab roof.

**Done (Dan: "yes", 2026-11-03): the book grew from 10 to 35 builds.** The local tool (Muse invents, the real Python validator checks) was run over 31 wishes; 30 passed, 5 were then dropped as exact
duplicates of existing builds or mislabeled (a "farmer on a tractor" that was really the existing cowboy-in-a-pickup, a sports car identical to the Roadster, a motorbike identical to the Scooter, and two more),
and one could not be built at all ("Kip driving a tractor": the cab roof collides with the seated figure, which the validator rightly refuses). The first ten stay the tab's example buttons (`featured`); the rest
are matched and built. **A tractor now works** through the real Worker and Muse, in English and Spanish (9 parts: truck chassis, hood, cab roof, four off-road wheels); a bulldozer, which has no parts,
gets an honest question ("a dump truck or a farm tractor?"). Every new build also passes the exploded-view test (zero overlap at full spread). Regenerating the references exposed older drift: 26 of the 30 exported
describe STLs were stale against the current part generators (the kid head, faceplate and hats had moved about 0.4 mm), so they were re-exported with the project's own tool.
Muse was inconsistent about the tractor on a first try ("no tractor parts are listed"), so generation used a hint about which parts make one; the book keeps the child's own wording.

**Options (as proposed).**
- **A:** grow the book. The local tool already lets Muse *invent* a recipe and the Python validator check it. Run it over about 30 likely wishes (tractor, dump truck, taxi, farm truck, motorbike, a robot
  with a hat, Kip on a scooter...), keep what passes, add it to `kip-describe-recipes.json`. The Worker already reads that file, so nothing else changes. Limit: only what 30 parts can express.
- **B, later:** put the validator behind a hosted service (the Forge optimizer daemon's pattern) so the deployed app can invent builds live.
- **C, later:** more parts (the Forge and CAD lanes). A bulldozer needs a blade part that does not exist.
Also: when nothing is close, say so honestly ("I do not have a tractor yet, here is a farm truck").

## 8. Phases and acceptance

| Phase | What | Acceptance |
| --- | --- | --- |
| P0 | Spike: the world rig, one `eat` clip, one `sleep` clip | Both seen in real-game screenshots; the plan for the rest of the clips |
| P1 | Fruit nouns and table, fruit tappable and spoken, tree kinds and a mixed orchard | Guard tests for the vocabulary; the props e2e extended; clips prewarmed; native sheet extended |
| P2 | Feeding: tap-to-feed, eat clip, robot and vehicle reactions, full limit | Real-game e2e per kind of toy; screenshots |
| P3 | Toy Room: bed, sleep, wake, dim and music | Real-game e2e; the lamp and music states restored on wake |
| P4 | Backlog from the table, basket, counting and XP | Per interaction |
| A (parallel) | Grow the Describe & Build book with validated builds | Each new build passes the real validator; tractor works |

## 9. Questions for Dan

1. ~~Tap or drag?~~ **Decided: drag** (section 4).
2. **Unclaimed fruit:** keep tidying it away (recommended) or always keep it until eaten?
3. **A "full" limit** after three fruits: yes (recommended), or let them eat forever?
4. ~~Animations~~ **Decided: I hand-build them** (section 5, built).
5. **Sleep:** should it dim the room and fade the music (recommended), and later follow the grown-ups' quiet hours?
6. **Which fruit and trees first**, and **which order:** I suggest P0 and P1 (so the apples say "red apple" and the orchard exists), then P2 and the bed.
7. ~~Describe & Build book~~ **Done** (section 7). Next there: a wider pass of wishes, and whether to put the validator behind a hosted service (option B).

## 10. Not in scope

Hunger or health meters; anything the child can lose; a cooking system (the frying pan and spatula are Kip hand props, a separate lane); changing physics or missions; real brand-name foods.
