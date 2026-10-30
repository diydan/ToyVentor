# ToyVentor: Spec (toyventor.com)

Oct 27, 2026 · revised Oct 29 · Dan O · Indie track · Build for Your World

I was a brick-building fanatic as a kid and I'm a robotics fanatic as an adult, and ToyVentor is me trying to hand that bug to my son without handing him a worksheet: his toy box is already full of cars and figures he loved and then abandoned, so why not start there? You scan one, AI helps find where a part could actually snap on, and then you build the upgrade in the browser, print it, and see the same toy come back alive in AR and in a little game.

## At a glance

- Problem: no easy path from toys kids own to real engineering and robotics skills.
- Built: scan a toy, build and test upgrades in the browser, see them in AR and a mini game, export a 3D print-ready file.
- Meta models: SAM 3.1 outlines the toy. Muse Image makes skins. Muse Spark writes Create mode worlds and drafts STEM content. Planned, not wired yet: Muse Voice Transcribe for voice commands, Muse Spark scene and mood reading, and the Mureka API for songs and loops. The demo uses browser speech and synth loops stand-ins for those.
- Demo truth: scan, virtual builder with live checks, AR try-on, mini game, STL export, Reveal are live. Billing, delivery, real electronics are mocked or later. Table below says which is which.

## Vision

ToyVentor helps the next generation grow into robotics through play: sandbox creativity, modular construction, gentle discovery, and hands-on engineering in one physical-digital loop. The initial playtesting audience is children aged 4 to 9 with grown-ups nearby. The long-term internal direction lives in [vision.md](vision.md); the tighter hackathon-facing narrative is [submission-vision.md](submission-vision.md). This spec stays canonical for product behaviour and for what the demo does and does not yet prove.

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

You don't need to own a single physical part to build here (that's the point, since most families won't), but the print files stay hidden until the checks pass, because an STL that fails on the bed is worse than no STL at all.

- Same part models that print. What you see is what prints.
- Scanned toy shows as stand-in body at its attach point.
- Parts snap to stud grid (Snap) or hole grid (Pro). Collisions caught. Undo and redo.
- Live checks: on grid, fits toy size, prints without supports, fits printer bed.
- Snap gets fit, stacking, stat preview. Pro motion tests (gears mesh, axles turn, joints move, gear ratio shown) come later.
- Finish gives parts list, filament and print time estimate, print files.
- Hackathon ships viewer, grid snapping, live checks, stand-in body, and pre-generated STL downloads for the placed printable parts, shown only when checks pass. Pro in the build today is one TU05 beam as a teaser.

## ToyVentor World

The app and the 2.5D world are two halves of one toy. The Play button in the app opens ToyVentor World already wearing the kid's build, through a small contract that travels in the page URL.

- Contract format `toyventor.toy/1`, JSON, base64url in the URL hash. There is no server call on this path and the contract itself is never sent anywhere or stored. The world does save the resulting toy selection on the device. The toy name travels in the link, so sharing the link shares the toy's name and build.
- The contract carries the toy id and name, the toy type (character, robot, vehicle), the game part keys for the slots the kid filled, the paint colors, and the build's stat totals. The world does not use the totals yet.
- Mapping rule: the app holds one canonical game part per toy type and stat, so a placed part lands as the game part for its stat. Two parts with the same stat compete, and the stronger one wins. A game part key the world no longer knows is ignored, and that slot comes up stock. The two part libraries stay separate, so a new set in the app never breaks the world and a new part in the world never breaks the app. Opening the world with a build also unlocks those game parts on that device.
- The world is served from the app's own origin (`/world/ToyVentor-World.html`), so Create mode can reach the Worker's model route without a cross-site call. The world ships as a standalone generated page, and that page remains the full-screen and demo path. The React port has reached step 5 locally (the three.js 0.160 upgrade included): the Play tab hosts the same page through a typed engine facade (`GameCanvas`), with a React HUD, Factory/customizer, mission panels, Create mode, and level editor around it. The engine still owns the toy model, locks, saves, mission and level logic, and the print check. See Roadmap.
- Bad contract in, the world still starts. A contract with the wrong shape (bad type, missing parts list or paint block, malformed colors) is refused whole and the stock toy comes up with nothing saved. A well-shaped one applies: toy type, paint colors, and any part keys the game still knows.

## Create mode

Kids describe a world, the model writes the recipe, the world loads it. The word parser in the game is the fallback and still works with no model at all.

- The game posts to `/api/muse/spark` on the Worker, which runs the model on Meta Muse Spark and answers with a level recipe plus one warm sentence for the kid.
- The route holds the kid-facing rules: short lines, safe topics, no real names or identifying details, no brands, and no long text. Those are instructions to the model, backed by a filter in the route: replies carrying links, contact-shaped details, scary or adult terms, or the child's own words echoed back are replaced with a fixed safe line before a child sees them. The brand and name rules have no filter equivalent yet.
- The recipe is checked twice before the game loads it. The route checks the level format, theme, field types, and counts before sending. The game then checks every prop, hiding spot, and part key against its own tables, drops anything unknown, and clamps positions into range. If the route errors at all, the game falls back to its word parser. Off the live domain the game uses the word parser directly and never calls the route.

## STEM mode (stretch, off by default)

Optional layer on the same builds. Mostly Pro 8+, lighter for Snap.

- Challenges with a goal: gear train at set ratio, lever, ramp.
- Predict, build, test. Guess, build in builder, test, compare. Builder shows measured ratio and speed.
- Short concept cards: gear ratio, torque, friction, center of gravity, simple machines.
- Finishing challenges unlocks parts and skins in game.
- Downloadable worksheets and mission cards.
- Challenges and cards live in the same set file as parts. A monthly set can include a STEM unit.
- Classroom tools come later.

Path to robotics, each step virtual first: 1 structures, 2 motion, 3 power, 4 sense, 5 control, 6 full robot. Hackathon covers steps 1 and 2. In the hackathon build STEM lives in ToyVentor World's Lab missions (bridge, measure, balance, lever, logic, lift, raft, circuit, code, pattern, clean-up). A gear ratio challenge is not in yet.

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
- Hackathon: mood buttons and a few voice keywords drive four loops. The loops are synth stand-ins until Mureka stems land, and voice uses browser speech recognition until Muse Voice Transcribe is wired. Camera scene detection is later.

## Forge Club

A monthly themed set: 6 parts, 2 skins, a theme loop, and at least one part you can actually print, because if nothing in the box ever becomes physical, we've just built another skin shop. Free players get the base parts and a free daily pack; members get the monthly set, and if you stop paying you keep what you've unlocked and simply miss the new drops (old sets move to the Market, so nothing's gone forever). Children are never sold chance-based packs. Billing will go through an outside provider eventually; in the demo it's mocked. The app loads one seeded base set today.

The product is delivery-first because most families do not own a printer. The business targets are delivered custom parts starting at $1 and direct print costs of $0.50–$5 per design, with seasonal physical packs tied to engineering and science activities. The launch market is the US. Those economics are targets to prove, not claims about the hackathon build.

## Under the hood

- Cloudflare Workers and Static Assets serve the PWA.
- Cloudflare D1 tracks what each player owns. Sets are static JSON files. The app imports the base set directly today, so a new set still needs a code change to appear.
- Meta Model API handles AI. Songs, loops, and sound effects are synth placeholders until a Mureka API key lands.
- ToyVentor World is one generated HTML page: `game/build25.py` wraps `game/engine25.js` with the page template and three.js 0.160 ES modules from a CDN import map. The engine keeps its own copies of the level, prop, hiding spot, and part tables. The long-term direction is one shared content package (level format, parts catalog, validation) used by the app, the world, and the Worker, so no side has to trust another side's JSON. That package does not exist yet.
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

Checks: sits on grid, fits toy size class, prints without supports in listed orientation, fits printer bed in both sizes. STL export under 10 seconds.

### Where we use Meta models

We build on the Meta Model API. Scan is [SAM 3.1](https://ai.meta.com/blog/segment-anything-model-3/), prompted with text like "toy car" rather than clicks, because a parent holding a phone in one hand and a toy in the other isn't going to tap out a mask.

| Feature | Model | What it does |
| --- | --- | --- |
| Scan | SAM 3.1 | Outlines toy from text prompt like "toy car". Mask for size and attach points |
| Skins | Muse Image | Generates and edits skins, made ahead for seed sets |
| Scene detection | SAM 3.1 + Muse Spark (planned) | Will track toy and read surroundings. Not in the demo |
| Mood | Muse Spark (planned) | Demo uses local rules from mood buttons and story keywords |
| Voice commands | Muse Voice Transcribe (planned) | Demo uses browser speech recognition |
| Create mode | Muse Spark | Turns a kid's description into a world recipe |
| STEM content | Muse Spark | Drafts challenges and hints, human reviewed |

Theme songs, loops, and sound effects will come from the Mureka API. In the demo they are synth placeholders made in code. Parts are parametric OpenSCAD and are not generated. Checks and grid snapping are plain code.

Two things I considered and rejected, for the record. First, generating part geometry with a model: tempting in a Meta hackathon, but a generated mesh can't promise watertight, support-free, on-grid, and the whole pitch collapses the first time a kid's print fails, so geometry stays boring parametric OpenSCAD and the AI stays on the seeing/talking/skin side. Second, generating songs on the fly inside Live Play: latency and mood whiplash killed it, which is why Live Play crossfades pre-made loops instead and only the Reveal theme is generated (ahead of time, where a 20 second wait doesn't matter).

## What is real in the demo

| Feature | Live in demo | Pre-made or mocked |
| --- | --- | --- |
| Scan | SAM 3.1 outline and mask anchor. Size from the grown-up's length slider times the mask aspect | Seed toy as backup |
| Skins | Muse Image skin for scanned toy | Seed skins as backup |
| Virtual builder | Grid snapping, live checks, stand-in body | Part library made ahead |
| Play | AR try-on, mini game, ToyVentor World with the kid's build | In-game toys are built procedurally. No standard clip rig yet |
| 3D print | Pre-generated STL downloads, shown when checks pass | Delivery handoff mocked |
| Reveal | Entrance animation, character card, synth theme | Mureka theme songs not wired yet |
| Live Play (stretch) | Mood buttons + voice keywords (browser speech) | Synth loop stand-ins, not Mureka stems |
| STEM mode (stretch) | Eleven Lab missions in ToyVentor World | Gear ratio challenge later. Cards and hints drafted with Muse Spark |
| Pro line | One rounded TU05 beam | Friction pin and gear set still to make |
| Forge Club | Base set, daily pack, fit filter | Second set is not loaded by the app yet. Billing mocked |

## What success looks like

- Scan to colored upgrade in game on phone in under 60 seconds.
- Every pack item works in AR and game. One printable part per pack.
- STL export in under 10 seconds with checks passing.
- Market only shows parts that fit the scanned toy.
- New expansion set loads from set file with no code change (goal. Not true yet: the app imports the base set directly).
- Reveal plays once, then saves.
- Virtual build passes checks with no physical parts.

## Safety and privacy

- Snap Large is the easiest-handling format. Rounded edges, no sharp corners, no small loose pieces on young-kid parts. Printed parts remain prototypes until fit, durability and formal age-safety review are complete; they are not yet safety-certified or formally age-graded.
- Live Play listens and watches only during active play. Parent starts and stops the session. Mood buttons work with camera and mic off.
- The Create mode model route has no login in the demo build, so its output rules and filter are the protection. Rate limits on `/api/muse/spark`: a Cloudflare dashboard rule of 10 requests/minute per IP is the durable limit (confirm it in the dashboard before a public launch); worker/muse.ts carries a best-effort in-isolate backstop over the same budget that answers 429.
- Character add-ons use original designs. Calibration piece and per-printer offsets handle snap fit variance.

## ToyVentor Snap

The kid line: snap-fit, tool-free, stud grid in two sizes. Full part types, design rules, print and game behavior live in [snap.md](snap.md), which is canonical for this line; this spec no longer duplicates it. Headline risk, stated there too: as of Oct 29 nothing in Snap has been printed yet. The Day 4 calibration gate slipped, so its dimensions stay targets until the first print proof.

## ToyVentor Pro

The mechanical line for ages 8+ and makers, on ToyVentor's own 12.5 mm hole grid. Full standard, part families, and print rules live in [pro.md](pro.md), which is canonical for this line. Hackathon scope stays narrow: one rounded TU05 beam is in the build today, shown as a teaser on the demo Forge Mount. A friction pin and one gear set are still to make.

## Open source

The intended open layer is the part system: Forge Mount spec, parts library, checks, part format, and set file format. The intended release terms are Apache-2.0 for code and CC BY 4.0 for designs and STLs, to be applied with the matching licence files before public release. App content, skins, songs, and animations may stay closed. Contributions via pull requests.

## Hackathon build order

Ship one loop first: scan with its backup toy, build with grid and checks, open ToyVentor World wearing that build, solve one STEM mission, create one validated world, then show the STL/print queue. AR try-on, Reveal and Live Play are supporting beats when they strengthen that run rather than separate stories competing with it. Be ruthless about everything hanging off the chain. Pro stays a teaser, electronics and fulfilment stay on the roadmap, and anything not shown live is labelled mocked, pre-made or next.

## Open questions

Things this spec asserts but hasn't earned yet:

- Will a SAM mask from a wobbly, badly lit phone photo actually give a usable size and attach point, or does the parent end up nudging a slider every time? The preloaded backup toy hides this in the demo, but it doesn't answer it, and shiny or translucent toys are my main worry.
- Can one snap-fit clearance work across home printers, or does the per-printer offset become homework nobody does? The calibration print has still not happened; it slipped past Day 4. If the prints say "it depends," the honest fallback is shipping Snap in a single size on a single known-good profile and saying so.
- Is the "printed part gives a game boost" loop motivating, or does it just punish kids without a printer? I have a guess, not evidence.
- Do the Pro humanoid parts yet prove the one-system claim? They still need standard typed connection metadata, and the new heads need a demonstrated Snap mate or explicit fit-checked adapter before either line can claim cross-line head swaps.
- Is the published world page the current build? The locally built page carries the toy contract, but the journal records the published artifacts as stale and in need of a manual republish. The demo's Play beat depends on that republish.
- When does validation stop living in two places? The Worker checks recipe shape, the game checks its own catalog, and the app keeps a third copy of the game part mapping with no test tying it to the game's table. One shared content package would end that, but it is not built yet, and neither is the mapping test.

## Roadmap

- React port of ToyVentor World: wrap the engine, do not rewrite it. The three.js scene stays imperative and the engine keeps the canvas and the render loop. A small typed facade (set the toy, change world, zoom, mission actions, dispose) is the only door, and the engine reports out through events (toast, part found, mission state) instead of writing to page elements. React takes over the game UI one piece at a time: canvas host and HUD first, then the Factory and customizer, then mission panels (each panel becomes plain data one React component renders, which is the biggest single job), then Create mode and the editor. The three.js upgrade went last, on its own: pinned at 0.160, post-processing imports moved from examples/js globals to ES modules, color spaces use the modern names, the engine's old manual color pass now only rescales legacy light intensities for physical light units, and before-and-after screenshots of all 12 levels were compared for brightness parity. During the port three stayed pinned at 0.128 until that step. Dispose and hot-reload teardown are treated as features (double mounts otherwise leak WebGL contexts and canvas textures), engine values are read through refs rather than per-frame React state, and the save keys (`tf25`, `tvLevel`, `tvCreate`) keep reading so early testers keep progress. The `#edit` hash still opens the editor on the standalone page; moving it to route state is future polish. Steps 1 to 5 (typed facade, canvas host, HUD, the React Factory/customizer, mission panels, Create mode, level editor, and the three.js upgrade) are in locally. The standalone page remains what the demo runs on, and publishing it is still the manual republish recorded above.
- One shared content package for the level format, the parts catalog, and validation, used by the app, the world, and the Worker. The engine's pure-data tables (themes, hiding spots, props, levels, parts) convert to TypeScript first, since those are what the Worker needs to validate and repair Create mode recipes server side as well as client side.
- Wire the planned models: Mureka stems and theme songs, Muse Voice Transcribe for voice, Muse Spark scene and mood reading.
- Merge Forge: 2-3 donors in, 1 new toy out, at most 2 new adapters. Printed parts reusable as donors.
- Recycle: reuse intact parts, broken to bases and terrain. No melting filament.
- Color: AR preview, printable masks, pen holder for standard markers.
- Real electronics: motors, lights, sensors on Pro line.
- Delivery: live 3D print service integration.
- Classroom tools: class codes, assignments, progress.
- Camera scene detection and narration in Live Play.
