# ToyVentor play design spec

Oct 31, 2026 · @Dan O

## Overview

This spec sets the rules every ToyVentor level follows, turns the interactions we have already built into a parametric library, and defines a level format that Muse Spark can generate safely.

Four decisions sit underneath everything else:

1. Touch the world, not the UI. A child pops the balloon itself, drags the beam across the gap, and turns the real crank. Buttons and panels are the exception, never the default.
2. Every level starts with a purpose and ends with a consequence. A mission card says the goal, why it works, and exactly how to finish. Success is a change in the world that follows from the child's action, never an unrelated door.
3. Levels are data built from tested primitives. A small library of interactions (tap, carry, turn, load, connect, program, and more) each with variables. Levels combine and tune them rather than inventing new code.
4. Generation is constrained. Muse Spark writes levels only from the closed catalogs of primitives, objects, and effects. Every generated level passes schema, logic, solvability, age, and safety checks plus a robot playtest before any child sees it.

Related: the world spec ([world-first-spec.md](../ux/world-first-spec.md)), the STEM ladders playtest prerequisite ([app-continuation-spec.md](app-continuation-spec.md), Town linkage §8), and the scoring gate ([xp-system-spec.md](xp-system-spec.md)).

## What makes a good ToyVentor game

A level is good when a child knows what they're trying to do, does it by touching the world, sees a result that makes sense, and wants to try again. Each principle below comes with a check a reviewer, or the validator, can apply.

| Principle | What it means | The check |
| --- | --- | --- |
| Purpose first | The level opens with a goal the child cares about: reach the prize, help a friend, fix something broken | The mission card's goal names an outcome, not a task ("get the prize on the cloud", not "tap colors") |
| Cause and effect | The child's action physically or logically causes the result | The success condition is a world state that only the child's actions can produce |
| Touch the thing | Interactions happen on world objects | No custom interaction lives in a panel, except the exceptions listed below |
| One idea | Each level teaches one concept: lift, gravity, ratio, sequence, sorting by a rule | The recipe names exactly one concept, and every interaction uses it |
| Clear finish | The child can see how close they are | A visible counter or world state shows progress (balloons tied, fruit in the basket, steps lit) |
| Instant response | Every touch does something within 100 milliseconds: a wiggle, a sound, a squash | No dead touches on interactive objects |
| Mistakes teach | A wrong try shows why it was wrong, then helps | Every wrong action has a specific response, and help arrives before frustration |
| Fits the age | Targets, choices, reading, and timing match the age band | The age preset's limits pass, such as 3 choices and no reading for ages 2 to 3 |
| Short and complete | A level takes 1 to 4 minutes and ends in a celebration | The robot playtest finishes within the time budget for the band |
| Never stuck | There is always a next thing to do | No state exists where no action helps and nothing is happening |
| Real-world link | Where it fits, the idea connects to real life: real parts, real routines | The recipe has an optional real-life tie-in, and the routines use it |
| Gentle | No losing, no timers that punish, no violence, calm audio after dusk | The content lint passes, and fail states only retry |

## World-first interaction

Children touch the objects in the world directly, the way the best toddler apps work. The balloon is tapped, the beam is dragged, and the crank is turned by its handle, so the cause and the effect sit in the same place.

Rules for world objects:

- Big, obvious, alive. Interactive objects are larger than decoration and gently idle (bob, sway, sparkle), so children can see what to touch.
- Touch targets are generous. The hit area is bigger than the object: at least 64 px on screen for ages 2 to 4, and 48 px from age 5. Overlapping targets prefer the nearest object.
- Every touch answers. A squash, a sound, and a voice line within 100 ms, even when nothing changes.
- Drag feels physical. The object lifts on touch, follows the finger with a slight lag, shows where it will land, and snaps there. A drop in the wrong place makes it bounce back home gently.
- The camera helps. It frames the toy and every object the level needs. It never forces the child to scroll to find a target.
- Accessible by design. Every world object has an invisible, focusable stand-in for screen readers, switch control, and keyboard, with the same actions.

When UI is allowed:

- Levels, Hear it, and sound: navigation and replaying the instructions.
- The mission card: purpose and how to finish. Later it can become a character speaking in the world, with the card as a fallback.
- Grown-up settings, the observer card, and results: for adults, never inside play.
- Code editors from age 10: blocks and text are the objects at that age. Younger code levels place arrow cards on the track itself.
- Accessibility fallback: switch and keyboard users get buttons that mirror world actions.

Everything else moves into the world: choices become objects, counters become world states (balloons tied, fruit in the basket), and Test it becomes pulling a lever or pressing a big button on the machine itself.

## Interactions built and tested

The prototypes already cover 18 interaction types across 38 levels. Every one passed scripted playthroughs at 390 × 844. Real-child playtests are still to come.

| Interaction | Where it's used | Ages | What we learned |
| --- | --- | --- | --- |
| Tap a choice | Colors, Numbers, Words, Little ones | 2 to 6 | Works, but as panel buttons it splits the cause from the effect. Move it into the world |
| Errorless tap (wiggle hint, help after 2 misses) | Little ones | 2 to 3 | Keeps toddlers going. Wrong taps must still do something fun |
| Drag to a target | One plank, Tidy one thing, sorting, code blocks | 3+ | Three-year-olds can drag if the target is big and glows. Tap-to-place must stay as a fallback |
| Sort into groups | Clean up toys, Tidy the room, Family meal, Clean up after meals | 3 to 6 | The groups must stay visible while the items scroll, so we pinned them |
| Order the steps | Routines, Help cook | 3 to 6 | Pictures plus a spoken word per step. A wrong step needs a reason ("what comes first?") |
| Slide a switch | Tap to light | 3 to 4 | Physical switches beat buttons; tapping should toggle too |
| Spin a dial | Turn the crank | 3 to 4 | Quarter-turn steps make progress feel real |
| Add or remove parts | Measure the gap, Balance, Raft | 5 to 9 | A live total (6 of 6, tilt, waterline) teaches better than a pass or fail |
| Pick a design | Budget bridge, Big gear or small gear, Series or parallel | 5 to 12 | Trade-offs need the stats on the parts themselves |
| Tune a value | Truss thickness, Lever fulcrum, Gear teeth, Gearbox stages | 10+ | A live preview and a "best so far" score drive retries |
| Connect on a grid | Close the loop | 7 to 9 | Showing current flowing makes "closed loop" obvious |
| Logic plates | Logic door, Sensor logic | 7+ | Test cases shown as small scenes work better than truth tables |
| Program with cards or blocks | Code track | 5 to 12 | Tap and drag both needed. Nesting (repeat, if) is clear when blocks wrap around |
| Text code | Text code | 13+ | A live "same program as blocks" view helps the jump from blocks |
| Repeat a pattern | Pattern lock | 5 to 9 | Sound plus color beats color alone |
| Answer by voice | Voice-only play | 3 to 6 | Two tries, then a warm reveal. Never wait in silence |
| Do it for real | Daily life routines, Bedtime | 3 to 6 | Timers and a grown-up tapping Done work. The reward must not become pressure |
| Drive, go, and stop | Go car go, tap to walk | 2+ | A visible destination (the flag) gives purpose |

Problems these surfaced, all fixed in the prototypes:

- A dismissable panel could leave a child stuck.
- Panels hid the world until the camera shifted.
- Doors opened for unrelated reasons.
- Toddler levels were too hard until they became errorless.

## The interaction primitives

Twelve primitives cover every interaction we've built. Each one is a tested piece of code with variables, so a level picks a primitive and sets its values instead of adding new code.

| Primitive | The child | Key variables | Success rules it supports | Today's examples |
| --- | --- | --- | --- | --- |
| poke | Taps an object | targets, any or match rule, attribute to match (color, size, count), misses before help | match the prompt, tap N, tap each once | Colors, Pop the bubbles, Animal friends, Peekaboo |
| carry | Drags an object to a place | items, targets, snap radius, order matters, what happens on release (fall, float, bounce) | each item at its target | One plank, Tidy one thing, Pack the car |
| sort | Carries many items into groups | items, groups, rule (material, color, food group), groups always visible | every item in the right group | Clean up toys, Tidy the room, Recycling |
| sequence | Puts steps in order | steps, slots, allow repeats, run on finish | order matches, or the run reaches the goal | Routines, Sequence cards |
| turn | Rotates a handle, wheel, or valve | degrees per unit, direction, resistance, the linked mechanism and its ratio | the mechanism reaches a state | Turn the crank, Gear lift |
| toggle | Flips a switch or lever between states | states, effect of each state, linked to other toggles | every required state is set | Tap to light, Logic plates |
| load | Adds things onto or into something | item properties (mass, lift, buoyancy, volume), capacity, a live meter (tilt, waterline, height) | the meter reaches a target band | Balloon lift, Raft, Balance |
| tune | Moves a slider, pivot, or knob | range, step, a live preview, the solution window, best-so-far scoring | inside the window, optimized | Lever launch, Truss thickness, Gear teeth |
| design | Picks parts with stats | options with stats and cost, constraints (budget, weight), then a test | passes the test within the constraints | Budget bridge, Series or parallel, Gearbox |
| connect | Joins pieces on a grid | grid size, pieces, flow type (current, water, path), the source and the sink | flow reaches the sink | Close the loop |
| program | Arranges instructions | instruction set, slot limit, repeat and if allowed, track generator, text mode | the run reaches the goal on all test tracks | Code track |
| real | Does a task in real life | steps, timers, how it's confirmed (grown-up tap or voice), the reward | every step confirmed | Daily life, Bedtime |

Three modifiers apply to any primitive: voice (answer out loud instead of touching), errorless (wiggle hint, then help after N misses), and observe (watch a demonstration before trying).

What every primitive provides:

- A parameter schema, with defaults and limits per age band, so generated values stay sensible.
- World bindings: which object kinds it can act on, such as balloons, gears, or switches.
- Events for the shared engine: touched, progress, wrong, done. Effects and counters hang off these.
- A solver that finds a correct play for robot playtests, plus a "random toddler" player.
- Accessibility actions, the same as touch, for switch control and screen readers.

Example: a primitive's contract

```json
{
  "primitive": "poke",
  "params": {
    "targets": { "type": "objectSet", "required": true },
    "rule": { "enum": ["any", "match", "eachOnce"], "default": "match" },
    "matchOn": { "enum": ["color", "size", "count", "kind", "word"] },
    "rounds": { "type": "int", "min": 1, "max": 8 },
    "choicesPerRound": { "type": "int", "min": 2, "max": 4, "byBand": { "2-3": [2, 3], "3-4": [3, 3] } },
    "helpAfterMisses": { "type": "int", "default": 2 }
  },
  "emits": ["touched", "progress", "wrong", "done"],
  "solver": "pick the target that satisfies the rule each round"
}
```

## Feel and age presets

Two levels can share a primitive and still feel completely different, because feel is its own set of variables. Age presets set safe defaults, and a level can only tune within them.

Feel variables:

| Variable | Range | What it changes |
| --- | --- | --- |
| juice | calm, normal, party | How big the squash, sparkle, and confetti are |
| snap | 0 to 1 | How strongly a dragged object pulls into its target |
| bounce | 0 to 1 | How springy objects are when they land or are wrong |
| weight | light, normal, heavy | How objects follow the finger and fall: balloons float, crates thud |
| physics | gravity, buoyancy, friction, and torque scales | The world's rules, kept honest to the concept being taught |
| sound | a palette such as party, nature, workshop, or bedtime | Touch, success, and ambience sounds |
| voice | warm, playful, or calm, and the speaking rate | How lines are spoken |
| reaction | the toy's and characters' animations | Cheer, wobble, gasp, wave |
| theme | a world theme plus object skins | Garden, Beach, Snow Peak, Sky, Junkyard, Room |
| seed | a number | Varies the tracks, item order, and positions so replays differ |

Age presets:

| Band | Interactions | Targets | Choices | Reading | Help | Level length |
| --- | --- | --- | --- | --- | --- | --- |
| 2 to 3 | poke, carry, real; errorless always | 96 px or more | 2 to 3 | None, everything spoken | Wiggle after 3 s or a miss, help after 2 misses | 1 to 2 minutes |
| 3 to 4 | + sort, sequence, toggle, turn | 72 px or more | 3 | Single words with pictures | Retry with a reason, wiggle after 2 misses | 2 to 3 minutes |
| 5 to 6 | + load, simple program, voice | 56 px or more | 3 to 4 | Short sentences | A hint after 2 misses | 2 to 4 minutes |
| 7 to 9 | + connect, design, loops | 48 px or more | Up to 6 | Short instructions | A hint on request | 3 to 5 minutes |
| 10 to 12 | + tune, if-rules, constraints | 44 px or more | Open | Full instructions | A hint on request, best-so-far scoring | 3 to 6 minutes |
| 13 and up | + text code, optimization | 44 px or more | Open | Full instructions | Hints on request | 4 to 8 minutes |

## The level recipe

A level is one data file, toyventor.level/2, made of seven parts: the mission card, the concept, world objects, the interaction, effects, a success state, and feel. Success is always a world state that the effects produce, which is how cause and effect is enforced.

1. Card: goal, why it works, and how to finish, each a short sentence.
2. Concept: one domain (physics, chemistry, biology, logic, math, language, life skills) and one idea, such as lift or gravity.
3. World: a theme plus objects from the object catalog, each with properties (color, size, mass, lift) and what can be done to it (poke, carry, turn).
4. Interaction: a primitive and its parameters.
5. Effects: what happens on a correct action, a wrong one, and success. They come only from the effect catalog.
6. Success: a condition on the world ("the toy's height is at least the cloud's"), not a counter.
7. Feel, voice, and an optional real-life link.

The effect catalog (closed): attach, detach, lift, fall, float, sink, tilt, roll, push, spin, wind, open (only through a linked mechanism), light, power, fill, empty, grow, shrink, reveal, hide, walk to, carry along, pop, sparkle, say, and sound.

Example: Balloon lift, as a recipe

```json
{
  "format": "toyventor.level/2",
  "id": "balloon-lift",
  "band": "3-4",
  "card": {
    "goal": "Get the prize on the cloud.",
    "why": "Balloons pull things up. More balloons, more lift.",
    "finish": "Tap the color I say. 4 balloons will lift you."
  },
  "concept": { "domain": "physics", "idea": "lift", "also": ["color names"] },
  "world": {
    "theme": "sky",
    "objects": [
      { "id": "cloud", "kind": "platform", "x": 2.4, "height": 2.2 },
      { "id": "prize", "kind": "chest", "on": "cloud" },
      { "id": "bunch", "kind": "balloonBunch", "x": -1.5, "items": [
        { "color": "red", "lift": 0.56 }, { "color": "blue", "lift": 0.56 },
        { "color": "yellow", "lift": 0.56 }, { "color": "green", "lift": 0.56 } ] }
    ]
  },
  "interaction": {
    "primitive": "poke",
    "targets": "bunch.items",
    "rule": "match",
    "matchOn": "color",
    "prompts": ["Tap the red balloon!", "Now tap the blue one!", "Which one is yellow?", "Find the green one!"]
  },
  "effects": {
    "onCorrect": [{ "attach": "target", "to": "toy" }, { "lift": "toy", "by": "target.lift" }],
    "onWrong": [{ "say": "That one is {target.color}. Try again!" }, { "wiggle": "answer" }],
    "onSuccess": [{ "walkTo": "prize" }]
  },
  "success": { "when": "toy.height >= cloud.height" },
  "progress": { "show": "balloons attached", "of": 4 },
  "feel": { "juice": "party", "weight": "light", "sound": "party" },
  "voice": { "mode": "available", "questions": "colors-everyday" }
}
```

## The logic checks a recipe must pass

- Success follows from the effects. Every success condition must be reachable through the effects: a height condition needs a lift effect, and a door needs an open effect linked to a mechanism the child operates.
- Every effect shows. Each effect must change something visible.
- The card matches the recipe. "To finish" must match the success condition and the progress count.
- One idea per level. One concept and one primitive for ages 2 to 6. Older bands may chain two.

## Generating new levels with Muse Spark

Muse Spark drafts level recipes from closed catalogs, and code decides whether a draft is good enough to play. The model never writes code, never invents objects or effects, and its words reach a child only after checks.

Who asks, and for what:

| Who | They give | They get |
| --- | --- | --- |
| Our team | A concept, an age band, a theme, and a season | Draft levels for monthly packs, reviewed before release |
| Grown-ups and teachers | "My 4-year-old is learning about floating" | A private level for their family or class |
| Kids in Create mode | "I want my car to fly to the moon" | A playable private level, using their own toy |

The pipeline:

1. The ask. A concept, age band, theme, and optional real-life link, from a form, a sentence, or a child's voice (transcribed, then the audio deleted).
2. Muse Spark drafts a recipe. It sees the primitive catalog (with each band's limits), the object catalog, the effect catalog, the card rules, and two or three gold-standard example recipes. Its reply is JSON only.
3. Normalize. Unknown objects, effects, or primitives are dropped. Values are clamped to the band's limits, and the text is trimmed and filtered.
4. Logic checks. Success must follow from the effects, every effect must show, the card must match the success condition, and there must be one idea per level (see the level recipe).
5. Solve it. The primitive's solver must finish the level. The "random toddler" robot must make progress or get help within the band's time.
6. Age and safety checks. Reading level, target count, timings, kid-safe language, no brands, no real people, no scary themes for young bands.
7. Robot playtest at 390 × 844. The level is played headlessly by the solver, by a wrong-first player, and by random taps. It must have no stuck states and no errors, and finish within the time budget.
8. Review. Team and pack levels go to human review. Family and kid levels stay private to that family, and a parent can report a bad one.
9. Learn. Playtest data (time to first success, misses, hint use, quits) flags weak levels, and the gold examples and prompt rules improve from what works.

If a draft fails steps 3 to 7, the failures go back to Muse Spark for one repair attempt. After that, the system falls back to a hand-made template for the same concept.

Making each level feel unique: the model chooses within the safe space — the theme, the objects and their skins, the story frame ("help the baker", "reach the moon"), the feel variables, and the seed. The concept, primitive, and band limits keep it learnable. The same balloon-lift idea can become a hot-air balloon over the Beach, a kite on Sky Meadow, or a rocket with helium tanks, each still teaching lift.

## Quality bar and playtest measures

A level ships when robot playtests pass every check and real-child playtests hit the targets for its band. The observer card on the ladders page already records most of these.

| Measure | How it's recorded | Target for ages 2 to 4 | Target for ages 5 and up |
| --- | --- | --- | --- |
| Time to first success | First correct action after the card closes | Under 15 seconds | Under 45 seconds |
| Finishes the level | A done event before Levels or quitting | 9 out of 10 children | 8 out of 10 children |
| Misses before success | Wrong events per round | 2 or fewer on average | 3 or fewer on average |
| Help needed | Hints and auto-help used | Under 1 per round | Under 1 per level |
| Fun | The observer's 1 to 3 smiley rating | 2.5 or more on average | 2.5 or more on average |
| Difficulty | The observer's too easy, just right, or too hard | 70% or more "just right" | 70% or more "just right" |
| Explains it back | Asked "why did that work?" afterwards | Says the idea in their own words, such as "balloons go up" | Explains the cause |
| Plays again | Replays or picks the next level unprompted | 1 in 2 children | 1 in 2 children |
| Stuck | Seconds with no possible action | Never | Never |

Robot checks run on every build: the solver finishes, the wrong-first player gets help and finishes, random taps cause no errors, there are no stuck states, and it fits 390 × 844 portrait and phone landscape.

## Plan

Convert the youngest levels first, because they gain most from touching the world. Then rebuild the rest on the primitive library, and only then turn on generation.

1. World-first for ages 2 to 6. Move every Little ones and Early learning interaction into the world, and give the last four Early learning levels their cause and effect (table below). Done when no Little ones or Early learning level needs a panel button.
2. The primitive library. Rebuild poke, carry, sort, sequence, turn, toggle, and load as shared modules with parameter schemas, events, solvers, and accessibility actions, then port those levels onto them. Done when those levels are recipes, not code.
3. The recipe format and validator. Ship toyventor.level/2, the logic checks, and the robot playtester as one command. Done when every hand-made level passes.
4. The remaining primitives. tune, design, connect, program, and real, plus world-first versions of the STEM tracks, and the last cause-and-effect fixes.
5. Generation, team-only first. Muse Spark drafts monthly pack levels through the full pipeline, with human review. Then grown-up and teacher requests, then kids' Create mode.

## Converting today's levels

| Level | Today | World-first version |
| --- | --- | --- |
| Pop the bubbles | Color buttons | Tap the bubbles in the air. Fruit falls into the basket |
| Animal friends | Animal buttons | Tap an animal in the field, and it trots into the pen |
| Pack the car | Size buttons | Drag the suitcase, teddy, and ball onto the trunk, seat, and roof. The wrong size won't fit and bounces back |
| Peekaboo | Box buttons | Tap the boxes themselves, and the lid pops open |
| Go, car, go! | Go and Stop buttons | Tap the car to go, and tap a big stop sign to stop |
| Tidy one thing | Item and home buttons | Drag each toy from the road to its home |
| Colors | Color buttons | Tap the balloon in the bunch, and it ties onto the toy |
| Numbers | Number buttons, then a door | Count the stars by tapping each one, and that many stepping stones drop into the river, just enough to cross |
| Words | Picture buttons, then a door | A hungry cow blocks the road; drag the right food to it, and it eats and moves aside |
| Phrases | Say-it buttons, then a door | Say it nicely to the bridge keeper, who lowers the drawbridge |
| Daily life | Steps and bins, then a door | Steps happen on objects in the room (sink, soap, toothbrush). The reward shows on the toy: germs wash off, teeth sparkle |
| Turn the crank | A dial in the panel | Drag the crank handle on the gate itself |
| Tap to light | Switches in the panel | Flip the switches on the cave wall |
| Series or parallel | Wiring choice, then a door | Party lights start the party; long-lasting lights guide the family home |
| Exact ratio | Gear choice, then a door | The gears set the clock tower, so the bell rings and the train leaves |

## The composition kit: near-infinite levels from reusable parts

Added Nov 2, 2026. This is the first working layer of "levels are data built from tested primitives" (decision 3). It
runs on today's `toyventor.level/1`; the `level/2` primitives above are the next layer, not a prerequisite.

A level is a **stack of independent layers**. Each layer is a small closed catalog the engine already knows, so any
choice in one layer works with any choice in the others and no per-level code is written.

| Layer | What varies | Where it lives | Choices today |
| --- | --- | --- | --- |
| Theme | Ground, hills, sky, props vocabulary, hiding covers | `catalog.ts` `THEME_DEF`, `HKIND` | 6 |
| Mood (time of day) | Sky gradient, stars, fog, the whole light rig | `catalog.ts` `MOOD_DEF`, `lighting.ts` `moodRig` | 3 (any theme x any mood) |
| Rhythm | Five spots on a jittered grid: junk machine first, then at least 3 different moves | `levelKit.ts` | about 168 move orders x grid jitter |
| Scenery | 4 to 6 clusters picked and ordered per gap from the theme's props | `levelKit.ts` `CLUSTERS` | 5 to 6 clusters per theme |
| Parts | Which of the 30 world parts is hidden where, unfound parts first | `PART` | 30 x 29 x 28 x 27 x 26 |
| Stations | One or two free STEM stations (no blueprints, so never a dead end) | `MDEF`, `missions.ts` | 11 |
| Seed | Everything above, deterministically | `levelKit.ts` `composeLevel` | shareable 4-character code |

`composeLevel({ seed, theme?, mood?, owned? })` returns a `toyventor.level/1` file (plus optional `mood` and `seed`
fields, both additive). The same seed always gives the same level, so a code like `8K3F` can be replayed or shared with
parent approval. `checkLevel` restates the editor's acceptance rules (five different real parts, a junk machine in the
first 10 units, spots 4 apart and inside 4 to 42, at least three moves) so a composed level and a child's hand-made one
are held to one bar. `kitSize()` reports a conservative lower bound of about 6 x 10^12 distinct levels before position
jitter. The "Surprise world" button in the Worlds sheet calls `playSeed()`, which composes, registers the level as
`seed-<code>` and walks in.

What the kit guarantees (tested in `tests/level-kit.test.ts` over 3,000 seeds): determinism, the editor checks, every
prop and part exists in the catalog, stations never overlap a spot, every theme and mood appears, and the hand-made
explore worlds pass the same checks.

**What it cannot do yet, and the order to fix it** (each item is a hardcoded place found in the Nov 2 review):

1. **Puzzle variety needs the primitives.** Stations are still the 11 hand-coded missions, so two levels differ in
   scenery, rhythm and mood but not in what the child works out. The next layer is `toyventor.level/2` with `poke`,
   `carry`, `turn`, `load` and `tune` as parameterized modules (see "The interaction primitives"). Until then the kit
   tunes difficulty only through the existing tier 1 to 3.
2. **World width is a literal.** The strip is 0 to 46 in about a dozen places (`world.ts` bounds, `crFreeX`,
   `edSnapX`, street signs at 0.85 and 43.85). `LevelDef` needs a `length` field so a level can be short for ages 2 to 3
   and long for older bands.
3. **Mission state is keyed `world.type`** (`missions.ts` `mid()`), so two composed levels with the same station share
   completion. Composed worlds avoid this today only because each is `seed-<code>`; saved progress should key on the
   level id and station index.
4. **A new theme touches nine places** (`THEME_DEF`, `THEMES`, `TNAME`, `WN`, `SONG`, `LIGHT_RIGS`, `groundPlane`,
   `extras2`, `CHIPS`) and `HKIND` is indexed by theme position. A single theme record holding all of it would let
   content packs add themes as data.
5. **Hiding covers are an if-chain** (`buildCover`, `junkMachine`, `reveal`). Each cover needs a declarative
   `{ build, reveal, glintHeight }` entry before a content pack can add one.
6. **Muse and the kit disagree.** `CR_INSTR` tells Muse "3 to 6 spots" while `edChecks` demands exactly five. The kit
   and Muse should share `checkLevel`.

## Open questions

- [ ] Should the mission card become a character speaking in the world for ages 2 to 4, with the card as a fallback?
- [ ] Which Create mode limits apply to kid-generated levels: bands 2 to 6 only, and family-private always?
- [ ] Who reviews generated pack levels, and how fast does a monthly pack need to turn around?
- [ ] When do real-child playtests start, and who runs them?
