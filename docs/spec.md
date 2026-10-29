# ToyVentor: Spec (toyventor.com)

Oct 27, 2026 · Dan O · Indie track · Build for Your World

I was a brick-building fanatic as a kid and I'm a robotics fanatic as an adult, and ToyVentor is me trying to hand that bug to my son without handing him a worksheet: his toy box is already full of cars and figures he loved and then abandoned, so why not start there? You scan one, AI helps find where a part could actually snap on, and then you build the upgrade in the browser, print it, and see the same toy come back alive in AR and in a little game.

## At a glance

- Problem: no easy path from toys kids own to real engineering and robotics skills.
- Built: scan a toy, build and test upgrades in the browser, see them in AR and a mini game, export a 3D print-ready file.
- Meta models: SAM 3.1 outlines the toy. Muse Image makes skins. Muse Spark reads the scene and drafts STEM content. Muse Voice Transcribe handles voice commands. Mureka API makes songs and sound effects.
- Demo truth: scan, virtual builder with live checks, AR try-on, mini game, STL export, Reveal are live. Billing, delivery, real electronics are mocked or later. Table below says which is which.

## Vision

ToyVentor helps the next generation grow into robotics through play: sandbox creativity, modular construction, gentle discovery, and hands-on engineering in one physical-digital loop. The initial playtesting audience is children aged 4 to 9 with grown-ups nearby. The long-term internal direction lives in [vision.md](vision.md); the tighter hackathon-facing narrative is [submission-vision.md](submission-vision.md). This spec stays canonical for product behaviour and what the demo does — and does not yet — prove.

## Demo (90 seconds)

The run, beat by beat, with the backup clips and the pre-flight checks, lives in [demo-script.md](demo-script.md). In short:

1. Scan a car with SAM 3.1. Preloaded toy is backup if live scan fails.
2. Pick a Snap part. See it on the car in AR at true scale.
3. Open ToyVentor World with the kid's build, play the Garden, solve the bridge mission.
4. Describe a world in Create mode. The model writes it, the game loads it.
5. Export STL. Show checks pass.
6. Play the Reveal: entrance animation, 15 second theme, character card.

## Why

If robotics is going to be the next big wave, I don't think it starts with another expensive kit that gets built once and shelved; it probably starts earlier and messier, with a kid bolting a spoiler onto a car they already care about and discovering, almost by accident, why it wobbles. That's the bet, anyway. The path I want is snap-on upgrades first, then gears and motion, then (much later) sensors and control, and each step gets designed and tested in the browser before anything is printed and held in a hand.

The loop itself is simple enough that it doesn't need its own diagram: scan the toy, build on it in the builder and check the fit in AR, print the part, then play with the upgraded toy in AR and the mini game, and every finished build gets its Reveal, an entrance animation, a 15 second theme, and a character card.

## Two product lines

| | ToyVentor Snap | ToyVentor Pro |
| --- | --- | --- |
| Who | Ages 4+ with a grown-up; initial playtests target 4–9 | Older kids in that range, ages 8+, and makers |
| Connect | Studs, snap-fit, no tools | Hole grid with pins, axles, optional screws |
| Parts | Bricks, plates, skins, character add-ons | Beams, gears, axles, joints, motion capsules |
| Game | Looks + stat upgrades | Speed, spin, function stats |
| Electronics | None | Optional, later |

Both share one adapter, the Forge Mount, one part format, one set of checks. Any part works in builder, AR, game, and printer. A bridge plate with studs on one side and holes on the other mixes Snap and Pro in one build.

Humans, animals, robots, tails, wings and accessories are one module vocabulary, not separate catalogues. Every printable part carries typed connection metadata so builders and AI design only from parts that can really mate. Modules should swap directly between Snap and Pro wherever physical scale allows; where it does not, the system uses an explicit fit-checked adapter rather than claiming compatibility from similar-looking geometry. Snap is the simplified, fixed-pose expression of the Pro humanoid layout, and humanoid joint layouts should map to standard animation rigs so motion clips can be reused across characters.

## Virtual builder

You don't need to own a single physical part to build here (that's the point, since most families won't), but Print and Order stay greyed out until the checks pass, because an STL that fails on the bed is worse than no STL at all.

- Same part models that print. What you see is what prints.
- Scanned toy shows as stand-in body at its attach point.
- Parts snap to stud grid (Snap) or hole grid (Pro). Collisions caught. Undo and redo.
- Live checks: on grid, fits toy size, prints without supports, fits printer bed.
- Snap gets fit, stacking, stat preview. Pro gets motion tests: gears mesh, axles turn, joints move, gear ratio shown.
- Finish gives parts list, filament and print time estimate, print files.
- Hackathon ships viewer, grid snapping, live checks, stand-in body. Pro motion for one gear pair is stretch.

## ToyVentor World

The app and the 2.5D world are two halves of one toy. The Play button in the app opens ToyVentor World already wearing the kid's build, through a small contract that travels in the page URL.

- Contract format `toyventor.toy/1`, JSON, base64url in the URL hash. No server call, nothing stored, no personal data on this path.
- The contract carries the toy id and name, the toy type (character, robot, vehicle), the game part keys for the slots the kid filled, and the paint colors.
- Mapping rule: the world gives every slot a stat, and each app part carries one stat too, so a placed part lands on the slot with the same stat. Two parts with the same stat compete, and the stronger one wins. The two part libraries stay separate, so a new set in the app never breaks the world and a new part in the world never breaks the app.
- The world is served from the app's own origin (`/world/ToyVentor-World.html`), so Create mode can reach the Worker's model route without a cross-site call.
- Bad contract in, stock toy out. The world never fails to start because of a URL.

## Create mode

Kids describe a world, the model writes the recipe, the world loads it. The word parser in the game is the fallback and still works with no model at all.

- The game posts to `/api/muse/spark` on the Worker, which runs the model on Meta Muse Spark and answers with a level recipe plus one warm sentence for the kid.
- The route holds the kid-facing rules: short lines, safe topics, no real names or identifying details, no brands, and no long text. What the kid reads is cleaned before it is shown.
- The recipe is checked against the world's own level shape before it is sent. If it does not fit, the game falls back to its word parser.

## STEM mode (stretch, off by default)

Optional layer on the same builds. Mostly Pro 8+, lighter for Snap.

- Challenges with a goal: gear train at set ratio, lever, ramp.
- Predict, build, test. Guess, build in builder, test, compare. Builder shows measured ratio and speed.
- Short concept cards: gear ratio, torque, friction, center of gravity, simple machines.
- Finishing challenges unlocks parts and skins in game.
- Downloadable worksheets and mission cards.
- Challenges and cards live in the same set file as parts. A monthly set can include a STEM unit.
- Classroom tools come later.

Path to robotics, each step virtual first: 1 structures, 2 motion, 3 power, 4 sense, 5 control, 6 full robot. Hackathon covers steps 1 and 2. One gear ratio challenge is stretch.

## Live Play (Game Mode, stretch)

Play with a real toy while phone listens and watches. App answers with music that follows the story.

- Voice: commands and story words like "start adventure", "danger", "play my theme". Voice triggers boosts in AR and game.
- Camera: spots toy, parts, motion, surroundings.
- Household objects become characters: SAM outlines an everyday object (a coffee cup,
  a slipper), it sprouts legs, arms, and a face, and can run off mid-story. Two render
  paths: a 3D clip rig when the character needs to persist in AR and the game, or a
  video model when a one-off animated moment is enough.
- Moods: joy, suspense, danger, calm, triumph, mystery.
- Near table edge gives suspense. Fast motion or "attack" gives danger. Two toys facing gives battle theme. Finished build gives triumph with character theme.
- Music is pre-made loops and stems per mood and character theme. App crossfades live. No on-the-fly song generation. Reveal theme returns as motif.
- Target follow time about 2 seconds.
- Hackathon: mood buttons and a few voice keywords drive four loops. Camera scene detection is later.

## Forge Club

A monthly themed set: 6 parts, 2 skins, a theme loop, and at least one part you can actually print, because if nothing in the box ever becomes physical, we've just built another skin shop. Free players get the base parts and a free daily pack; members get the monthly set, and if you stop paying you keep what you've unlocked and simply miss the new drops (old sets move to the Market, so nothing's gone forever). Children are never sold chance-based packs. Billing will go through an outside provider eventually; in the demo it's mocked, with two seeded sets.

The product is delivery-first because most families do not own a printer. The business targets are delivered custom parts starting at $1 and direct print costs of $0.50–$5 per design, with seasonal physical packs tied to engineering and science activities. The launch market is the US. Those economics are targets to prove, not claims about the hackathon build.

## Under the hood

- Cloudflare Workers and Static Assets serve the PWA.
- Cloudflare KV and D1 track what each player owns. Sets are static JSON files.
- Meta Model API handles AI. Mureka API makes songs and sound effects.
- Seed content made ahead so demo never waits. Preloaded toy covers live scan failure.
- Android Chrome with WebXR is main target. Model viewer fallback on iPhone.
- Every part is parametric OpenSCAD. One definition makes STL for printing and GLB for AR and game.
- Forge Mount is the snap-on adapter that touches the original toy and gives it a stud grid, a hole grid, or both.

| Part field | What it holds |
| --- | --- |
| id | Part name and ID |
| line | Snap or Pro |
| mount type | Stud, hole, or Forge Mount |
| size class | Small or large |
| grid | Grid spacing the part sits on |
| stat | One stat per part. Rarity changes look only |
| printable | Whether a print file exists and passes checks |
| skin | Game and AR only. Printed parts are one color |

So a single part looks something like this in its set file. Note there's only ever one stat, because the moment a part is good at two things it becomes the default pick and the rest of the library might as well not exist:

```json
{
  "id": "snap-spoiler-01",
  "line": "snap",
  "mount": "stud",
  "sizeClass": "small",
  "grid": { "units": [2, 1], "profile": "stud_profile_small" },
  "stat": { "name": "speed", "value": 2 },
  "printable": true,
  "orientation": "flat",
  "skin": "month1/racer-red"
}
```

Checks: watertight, prints without supports in listed orientation, fits printer bed in both sizes, sits on grid, fits toy size class. STL export under 10 seconds.

### Where we use Meta models

We build on the Meta Model API. Scan is [SAM 3.1](https://ai.meta.com/blog/segment-anything-model-3/), prompted with text like "toy car" rather than clicks, because a parent holding a phone in one hand and a toy in the other isn't going to tap out a mask.

| Feature | Model | What it does |
| --- | --- | --- |
| Scan | SAM 3.1 | Outlines toy from text prompt like "toy car". Mask for size and attach points |
| Skins | Muse Image | Generates and edits skins, made ahead for seed sets |
| Scene detection | SAM 3.1 + Muse Spark | Tracks toy and reads surroundings |
| Mood | Muse Spark | Turns scene and story words into a mood |
| Voice commands | Muse Voice Transcribe | Live speech to text with keyword boosting |
| Create mode | Muse Spark | Turns a kid's description into a world recipe |
| STEM content | Muse Spark | Drafts challenges and hints, human reviewed |

Theme songs, loops, sound effects come from Mureka API. Parts are parametric OpenSCAD and are not generated. Checks, grid snapping, motion tests are plain code.

Two things I considered and rejected, for the record. First, generating part geometry with a model: tempting in a Meta hackathon, but a generated mesh can't promise watertight, support-free, on-grid, and the whole pitch collapses the first time a kid's print fails, so geometry stays boring parametric OpenSCAD and the AI stays on the seeing/talking/skin side. Second, generating songs on the fly inside Live Play: latency and mood whiplash killed it, which is why Live Play crossfades pre-made loops instead and only the Reveal theme is generated (ahead of time, where a 20 second wait doesn't matter).

## What is real in the demo

| Feature | Live in demo | Pre-made or mocked |
| --- | --- | --- |
| Scan | SAM 3.1 outline, size, attach point | Seed toy as backup |
| Skins | Muse Image skin for scanned toy | Seed skins as backup |
| Virtual builder | Grid snapping, live checks, stand-in body | Part library made ahead |
| Play | AR try-on, mini game, boost | Reusable clips on a standard humanoid rig |
| 3D print | STL export with checks | Delivery handoff mocked |
| Reveal | Entrance animation, character card | Theme songs from Mureka API |
| Live Play (stretch) | Mood buttons + voice keywords | Loops and SFX made ahead with Mureka |
| STEM mode (stretch) | One gear ratio challenge | Cards and hints drafted with Muse Spark |
| Pro line | Rounded TU05 beams, friction pins, one gear set | Rest of Pro parts later |
| Forge Club | Two seeded sets, fit filter | Billing mocked |

## What success looks like

- Scan to colored upgrade in game on phone in under 60 seconds.
- Every pack item works in AR and game. One printable part per pack.
- STL export in under 10 seconds with checks passing.
- Market only shows parts that fit the scanned toy.
- New expansion set loads from set file with no code change.
- Reveal plays once, then saves.
- Virtual build passes checks with no physical parts.

## Safety and privacy

- Snap Large is the easiest-handling format. Rounded edges, no sharp corners, no small loose pieces on young-kid parts. Printed parts remain prototypes until fit, durability and formal age-safety review are complete; they are not yet safety-certified or formally age-graded.
- Live Play listens and watches only during active play. Parent starts and stops the session. Mood buttons work with camera and mic off.
- Character add-ons use original designs. Calibration piece and per-printer offsets handle snap fit variance.

## ToyVentor Snap

The kid line: snap-fit, tool-free, stud grid in two sizes. Full part types, design rules, print and game behavior live in [snap.md](snap.md), which is canonical for this line; this spec no longer duplicates it. Headline risk, stated there too: as of Oct 27 nothing in Snap has been printed yet, so its dimensions are targets until the Day 4 calibration test.

## ToyVentor Pro

The mechanical line for ages 8+ and makers, on ToyVentor's own 12.5 mm hole grid. Full standard, part families, and print rules live in [pro.md](pro.md), which is canonical for this line. Hackathon scope stays narrow: rounded TU05 beams, friction pins, one gear set, shown as a teaser on the demo Forge Mount.

## Open source

The intended open layer is the part system: Forge Mount spec, parts library, checks, part format, and set file format. The intended release terms are Apache-2.0 for code and CC BY 4.0 for designs and STLs, to be applied with the matching licence files before public release. App content, skins, songs, and animations may stay closed. Contributions via pull requests.

## Hackathon build order

Ship one loop first: scan with its backup toy, build with grid and checks, open ToyVentor World wearing that build, solve one STEM mission, create one validated world, then show the STL/print queue. AR try-on, Reveal and Live Play are supporting beats when they strengthen that run rather than separate stories competing with it. Be ruthless about everything hanging off the chain. Pro stays a teaser, electronics and fulfilment stay on the roadmap, and anything not shown live is labelled mocked, pre-made or next.

## Open questions

Things this spec asserts but hasn't earned yet:

- Will a SAM mask from a wobbly, badly lit phone photo actually give a usable size and attach point, or does the parent end up nudging a slider every time? The preloaded backup toy hides this in the demo, but it doesn't answer it, and shiny or translucent toys are my main worry.
- Can one snap-fit clearance work across home printers, or does the per-printer offset become homework nobody does? If the Day 4 calibration prints say "it depends," the honest fallback is shipping Snap in a single size on a single known-good profile and saying so.
- Is the "printed part gives a game boost" loop motivating, or does it just punish kids without a printer? I have a guess, not evidence.
- Do the Pro humanoid parts yet prove the one-system claim? They still need standard typed connection metadata, and the new heads need a demonstrated Snap mate or explicit fit-checked adapter before either line can claim cross-line head swaps.

## Roadmap

- Merge Forge: 2-3 donors in, 1 new toy out, at most 2 new adapters. Printed parts reusable as donors.
- Recycle: reuse intact parts, broken to bases and terrain. No melting filament.
- Color: AR preview, printable masks, pen holder for standard markers.
- Real electronics: motors, lights, sensors on Pro line.
- Delivery: live 3D print service integration.
- Classroom tools: class codes, assignments, progress.
- Camera scene detection and narration in Live Play.
