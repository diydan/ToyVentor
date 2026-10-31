# ToyVentor Town — vision (not a build spec)

Oct 30, 2026 · @Dan O. This is the destination vision. The build plan lives
in [app-continuation-spec.md](app-continuation-spec.md); the shell contract in
[../ux/world-first-spec.md](../ux/world-first-spec.md). Nothing here is
committed to code until it appears there.

Editor's verification notes (Oct 31): Muse Voice Transcribe is real and live
on the Meta Model API (`muse-voice-transcribe-1.0`, streaming ASR +
diarization, ~$0.18/hr) — the voice story below is buildable on the approved
Worker path. The 30 hidden parts are in code: five per world across all six
worlds. World counts read "six worlds and six labs" everywhere; the
draft's "12 worlds" meant the two together.

---

## Overview

ToyVentor Town is an open world where STEM is the game mechanic: the world is
the playground, and STEM is how you do things in it. Kids never sit through
a lesson. A bridge is out, a door is locked, or a raft has to float, and the
physics is the tool.

- Who it is for: ages 3 to 13 and up, with ages 4 to 9 at the heart, and
  grown-ups who play along and set things up.
- Why an open world: kids choose what to do next, and learning shows up where
  it is useful, not as a menu of lessons.
- The missing layer: today's game has worlds, missions, progress, and
  building, but it still feels like a level menu. The town adds reasons to
  wander and reasons to come back.

| Pillar | What already exists |
| --- | --- |
| Explore | Six worlds and six labs, 30 hidden parts (five per world, in code), Kip walking in 2.5D |
| Missions | 11 mission types across Labs 1 to 6, each with Tiers 1 to 3 |
| Progress | XP, Maker Ranks, mastery stars, vehicle unlocks |
| Build | Toy Box, vehicles, Create mode for kid-made worlds |
| Daily rhythm | Parent-time ledger, daily replay and delta rules |
| Learning ladders | Bridges, Gears, Circuits, Code, Early learning, and Daily life, with voice-only play and bedtime mode |

The prototypes: ToyVentor World (the 2.5D game), the STEM ladders playtest,
the vision, and the game spec.

## Pillars

Six rules decide every feature in the town, on top of the game's existing
pillars.

| Pillar | What it means in practice |
| --- | --- |
| STEM is the tool | Every problem in the world is solved with a STEM idea: triangles hold the bridge, a gear ratio lifts the gate. There is never a lesson screen. |
| Go anywhere | Every district is reachable by driving or walking; no menu stands between a kid and the next place. |
| Failure is exploration | Attempts never lose XP, stars, or parts, and every miss shows why it failed. |
| Real life counts | Routines done for real, like brushing teeth, change the town. The game points kids away from the screen as often as at it. |
| Gentle by design | No losing, no violence, no strangers, no chat. Streaks pause instead of resetting, and nothing is taken away for a missed day. |
| Your toy, your town | The kid's own build is the hero, often the solution itself, and the things they make live in the town. |

## The town and exploring

The worlds join into one connected map: a central plaza with six districts
around it, each built from a world, with today's Labs as buildings inside
them.

| District | Built from | Buildings | What happens there |
| --- | --- | --- | --- |
| Plaza | New | Quest board, Factory, Forge, Music Hall | Pick up quests, build and upgrade the toy, make music |
| Home Street | Toy Room | Your house, School | Daily routines and bedtime; early learning |
| Garden | Garden | Bridge Works, Greenhouse | Bridges; measuring and growing |
| Junkyard | Junkyard | Workshop, Recycling Center | Gears and machines; sorting materials |
| Snow Peak | Snow Peak | Power Station | Circuits and sensors |
| Sky Meadow | Sky Meadow | Code Lab, Rover Tower | Block coding and text code |
| Beach | Beach | Boat Dock, Water Lab | Floating, sinking, and rafts |

Getting around. Districts connect at their edges: walk off the end of Garden
and you are on the Beach. Streets stay 2.5D side views, the engine's
strength, with junctions into side streets and doors into buildings. Younger
kids can also use a bus stop map that shows every district as a picture.

Vehicles open new ground. The Motor Scooter crosses gaps, the Catamaran
reaches islands, and the Helicopter reaches sky ledges. Maker Rank unlocks
become exploration unlocks, so "I want the boat" is a real goal. Only the
rank 2 and 3 vehicles are built and ready today: the Hauler Truck, Motor
Scooter, and Sport Motorbike. The Catamaran and Helicopter are still pre-CAD,
so the island and sky-ledge gates wait on the Wave 10 parts and their float
and rotor-clearance proofs. Plan the connected map around the gates that
exist, and add the water and sky gates when their vehicles land.

Collect and build. Hidden parts and scrap found while exploring feed the
Forge and the Factory. Kids find a part, then decide where to use it.

Day and night. The sky follows the real clock. Lights come on at dusk, and
when bedtime mode starts the town falls asleep, with a gentle "see you
tomorrow" instead of more play.

## Quests

Quest givers in every district turn missions into world problems, and one
light story arc, "Fix Kip's workshop," gives them a spine while side quests
stay standalone for wandering.

| Type | Comes from | Example | Length |
| --- | --- | --- | --- |
| Fix it | A townsperson | "The ferry broke, can you fix it?" A Lab mission dressed as a world problem | 2 to 5 minutes |
| Deliver it | A townsperson | Carry a heavy gear to the Workshop by scooter: speed, torque, and load | 3 to 5 minutes |
| Build to spec | A townsperson | "I need something that floats and carries two things." Kids build it from their own parts, and the game tests it | 5 to 10 minutes |
| Mystery | The town | A pattern or code lock hides a part | 2 to 5 minutes |
| Story chain | Two or three chains per district, joined by the main arc | Light the lighthouse so the night boats get home | 10 to 20 minutes, over days |
| Daily | The daily quest board | Brush your teeth for real | A real-life routine |
| Kindness | A character with a feeling | Pip is sad: share a snack, take turns on the swing | 2 to 3 minutes |
| Explorer | The town itself | Find the five hidden shells on the Beach | Free play |

Every quest has the same parts: who gives it, what they ask (spoken aloud),
the steps, the one concept it teaches, the reward, and what it opens next.

Quests adapt to age. One quest uses a different ladder level for each age
band, so siblings can share a quest at their own level. Fixing the river
bridge means picking the plank at 3 to 4, measuring the gap at 5 to 6,
triangles at 7 to 9, a budget bridge at 10 to 12, and the lightest truss at
13 and up.

The Mess meter. A calm meter of junk and spills around town. Clean-up quests
bring it down and the street sparkles. It never punishes; it only invites.

Quest file format. Quests are data, like levels, so new ones ship without
code changes. This draft format is reserved as `toyventor.quest/1` (see the
Contracts section of the world-first spec); fields may change at
implementation.

```json
{
  "format": "toyventor.quest/1",
  "id": "baker-oven",
  "title": "The baker's cold oven",
  "type": "fix",
  "giver": "baker",
  "district": "plaza",
  "chain": "kips-workshop",
  "concept": "circuits",
  "bands": { "3-4": "lamps", "5-6": "conduct", "7-9": "circuit", "10-12": "parallel", "13+": "sensor" },
  "steps": [
    { "say": "My oven won't heat up! Can you fix the wires?", "mission": "band" },
    { "say": "Warm bread for everyone! Thank you!", "reward": { "xp": 20, "badge": "circuits", "town": "bakery-lights" } }
  ],
  "unlocks": ["bakery-open"]
}
```

## Learning

Every mission is tagged with one concept, and kids see their progress as
concept badges, not just XP.

- Concept tags and badges. Measurement, ratio, logic, buoyancy, levers,
  circuits, sequencing, fractions, patterns, and sorting. Practicing a
  concept earns its badge, like "Lever Pro."
- Three dials of challenge. The age band picks the ladder level. Within it,
  today's Tiers 1 to 3 are named in the world: Starter, Tinker, and Engineer.
  Mastery stars (1 to 3) show how well it went.
- Personal bests. Solved missions show the next step up, like "your 2★ to 3★
  chance," and star improvements already pay out.
- Print it for real. Solve the gear lift, then print the gear you used. The
  game's best bridge from screen to hands.

Six of the seven tracks already play in the ladders prototype; each moves
into a town building, and Music with props is the one still to build.

| Track | Building | Ages | Status |
| --- | --- | --- | --- |
| Bridges | Bridge Works | 3 to 13+ | Built: plank, measure, triangles, budget, lightest truss |
| Gears | Workshop | 3 to 13+ | Built: crank, big and small gears, gear lift, exact ratio, gearbox |
| Circuits | Power Station | 3 to 13+ | Built: tap to light, metal or not, close the loop, series or parallel, sensor logic |
| Code | Code Lab | 3 to 13+ | Built: block coding with tap and drag, loops, if-then rules, text code |
| Early learning | School | 3 to 4 | Built: colors, numbers, words, phrases, with voice-only play |
| Daily life | Your house | 3 to 6 | Built: wash hands, brush teeth, get dressed, clean up toys, tidy the room, help cook, family meal, clean up after meals |
| Music with props | Music Hall | 3 to 13+ | To build (plan below) |

Music with props, by age:

1. 3 to 4, Make sounds: tap or drag props (drum, bell, shaker, xylophone)
   and hear each one; play along with a song.
2. 5 to 6, Copy my beat: listen to a short rhythm, then play it back on the
   props.
3. 7 to 9, Beat loops: place props on a beat grid so a loop plays over and
   over, the music version of code loops.
4. 10 to 12, Pitch and length: longer bars and fuller water glasses play
   lower notes; build a scale by measuring.
5. 13 and up, Compose: an octave doubles the frequency; build scales and
   simple chords, then write a short song.

In voice-only play, household props count too: a pot and a spoon, or
clapping. The microphone hears the taps and checks the beat.

## Daily rhythm and real life

Each day brings a small, fresh reason to come back, and the town rewards what
kids do away from the screen.

The daily quest board. Three game quests a day (one easy, one stretch, one
creative), rotating with the existing daily replay rules, plus 3 to 5 real
routines a grown-up picks. Each routine is learned on screen once, then done
for real with the voice guide and timers where time matters. Finishing earns
XP, a helper star, and a small town upgrade.

| Routine | Ages | What it teaches |
| --- | --- | --- |
| Wash hands | 3+ | Steps in order; 20 seconds of scrubbing |
| Brush teeth | 3+ | Two minutes, four zones |
| Get dressed | 3+ | What goes on first |
| Clean up toys | 3+ | Sorting things into their homes |
| Shoes and coat away | 3+ | Everything has a place |
| Make the bed | 4+ | Finishing a job |
| Feed the pet, water the plants | 4+ | Caring for living things |
| Set and clear the table | 5+ | Counting places, helping the family |
| Help cook, with a grown-up | 4+ | Washing, measuring, and kitchen safety: knives and stoves are grown-up jobs |
| Family meal | 3+ | Food groups on a healthy plate, sharing food, trying one new bite |
| Clean up after meals | 3+ | Scrape, stack, and wipe; sorting food scraps, trash, and recycling |
| Sort laundry by color | 5+ | Sorting by a rule |
| Recycling | 5+ | Materials: paper, plastic, metal |
| Pack the school bag | 5+ | Planning ahead |
| Sunscreen, hat, and water | 4+ | Looking after your body |
| Calm-down breathing | 3+ | Naming and calming big feelings |
| Manners missions | 4+ | Please, thank you, taking turns |

The parent's day. Grown-ups set the shape of the day: bedtime and morning,
and when eating happens. The game follows the real clock, so the town has a
day — play, eat, play, bedtime — instead of a countdown to a lockout. At
eating time the game steps aside: the sitting pauses, the family meal routine
is offered, and the child comes back to the same spot afterwards. No lock, no
penalty, and no play minutes spent at the table.

Streaks without guilt. A Workshop Day stamp for every day played. It never
resets: a missed day just pauses the count.

Time cap as story. When the parent-time limit is reached, the existing sleep
curtain becomes "Kip is recharging," part of the world instead of a lockout.
The cap no longer winds down before it ends; the town lights up at dusk
because bedtime is near, on the clock.

Bedtime mode. A grown-up picks tonight's steps (bath, pajamas, teeth, potty,
story, lights out) and a time goal, and the routine opens the wind-down
before the chosen bedtime. The screen goes dark, a calm voice guides
each step, and the town falls asleep. An on-time finish leaves a dream
surprise waiting the next morning and adds a night to the streak; a late
finish gets only an encouraging word.

Voice-only play. A parent setting for the School, home routines, and
bedtime: the screen goes dark and the world stops drawing, the device talks,
and the child answers out loud or a grown-up taps. Wrong or silent answers
get one more try, then the answer is given warmly and the game moves on.

Weekly events. Each monthly seasonal pack runs a themed event every week,
like "Ocean Week: boats, buoyancy, and new parts."

## Building, progression, and rewards

Kids grow the town and their toy by playing, learning, and helping at home;
nothing is bought, and nothing is ever lost.

- Building. Toys from the Toy Box and the Factory and parts from the Forge
  drive straight into town. Worlds made in Create mode (powered by Muse
  Spark) become play lots in a Makers' Park, and kids can place a mission in
  their own world. Families share them through codes a grown-up approves.
- XP and Maker Ranks. Kept as the main progress line. Each rank unlocks a
  vehicle, and each vehicle opens new ground on the map.
- Concept badges. Earned by practicing a concept across missions, shown next
  to XP so the learning is visible.
- Stars. Mastery stars for how well a mission went, and helper stars for
  real routines. Stars upgrade the town: street lights, a fountain, a park,
  the bakery's open sign.
- Everything stays open. No district is locked by age; quests adapt to the
  age band instead. Vehicles are the only gates, and every one is reachable by
  playing.
- Fair by design. No paid random items, nothing expires, and streaks only
  pause. Missing a day never removes XP, stars, parts, or upgrades.
- Money stays with grown-ups. The monthly seasonal pack adds new quest
  lines, weekly events, and parts, and is managed in the parent area, never
  inside play.

## Family play: learning to share

Family play is where kids learn to share: dad, mom, and kids play the same
town together, and every family feature practices taking turns, splitting
jobs, lending, and sharing rewards.

- Pass-and-play first. One device is passed around, and the game names whose
  turn it is with each player's toy and a turn token, so taking turns is
  built in. A device each comes later, joined by a family code, never
  strangers.
- Everyone has a job. Two-player quests split roles: one cranks the gate
  while the other drives through, one reads the map while the other steers,
  one measures while the other builds. Roles swap next time.
- Lend it and get it back. A player can lend a part to someone else's toy
  for a quest, and it comes back with a thank-you. Kids practice offering and
  asking.
- Fair shares. Family quest rewards are split between players, and sharing
  puzzles are part of the quests: share the cookies fairly, split a pile of
  scrap, take turns on the one boat.
- The family meal quest. Cook together, eat together with devices away, and
  clean up together, with a job for everyone. The whole family earns the
  reward.
- Grown-ups model it. Parents play as their own toy, and the game suggests
  sharing words to say out loud, like "Your turn! I'll hold the gate."
- The weekly summary counts it: "We took 12 turns, lent 3 parts, and cooked
  together twice."

Family play stays inside the family: codes a grown-up approves, no chat with
anyone else, and the same voice rules as solo play.

## Parents, safety, and privacy

Grown-ups own every setting and every piece of data, see what their child
practiced in plain English, and the child's side has no chat, no strangers,
and no ads.

- Weekly summary. A plain-English "skills practiced" note, like "Ratios and
  levers this week, plus brushing teeth 5 days," built from the concept tags
  instead of raw XP.
- Parent area. Opened with a hold-to-open button plus a question a young
  child can't answer. It holds the age band, voice-only play, the daily
  routines, the day's schedule (sleep time and eating times), bedtime steps
  and time goal, the parent-time ledger, sound, sharing, and the seasonal pack.
- Healthy limits. The existing parent-time gate ends play with "Kip is
  recharging" and a real-world idea. At eating time the game steps aside and
  the sitting pauses. Once bedtime mode starts, play stays closed until
  morning.
- COPPA. There are no child accounts: a grown-up's account holds the saves.
  A child's voice is personal information, so voice is off by default. It is
  transcribed through the ToyVentor Worker (Muse Voice Transcribe, verified
  live on the Meta Model API), used only to understand the answer, and the
  audio is deleted immediately. Transcription runs in the provider's
  zero-data-retention mode, which is priced at parity and never contributes
  audio to model training, so a recording leaves the Worker as audio and
  comes back as text only.
- Sharing. Builds and worlds move between families only through codes a
  grown-up approves. Nothing a child makes is public.
- AI safety. Muse Spark only arranges catalog pieces, and every reply is
  checked on the server before a child sees it. Spoken replies are short,
  kind, and never ask for personal details.
- Content. No violence, no scary themes for young bands, and calm audio
  after dusk.

## Technical approach

The town builds on what exists: today's 2.5D engine inside the React app,
worlds and quests as data files, and a few Worker routes.

- Engine. The current engine runs inside the React app behind a small typed
  facade. React draws the panels, menus, and parent area; the engine owns the
  3D scene. Every Lab and ladder level is already a mission type, so buildings
  host them directly.
- Data formats. Streets stay level files (`toyventor.level/1`). Two new
  formats join them: `toyventor.town/1` for districts, edges, junctions,
  buildings, and the vehicle each gate needs, and `toyventor.quest/1` for
  quests, with a type (fix, deliver, build to spec, mystery), a chain, and a
  concept tag. Toy builds use the existing `toyventor.toy/1` contract.
- Progress data. Concept tags live on each mission type, so badges and the
  weekly summary come from the same tags. The Mess meter, Workshop Day
  stamps, and the daily board sit beside today's XP, ranks, and parent-time
  ledger.
- Build to spec. Uses the parts' existing stats: "floats and carries two"
  checks buoyancy and load against the kid's build before the test run plays.
- Loading. One street is loaded at a time, with its neighbors preloaded, and
  the quality tiers keep low-end phones smooth.
- Worker routes. `/api/muse/spark` is built and tested. Still to add:
  `/api/voice/transcribe` (Muse Voice Transcribe, audio deleted after use)
  and `/api/save` (saves under the grown-up's account in D1, cached on the
  device for offline play). The transcribe route posts the recording to the
  file endpoint (`POST /v1/asr/transcribe`) rather than the realtime socket,
  which is the shape a Worker proxies directly. `/api/save` builds on
  `/api/ownership`, the D1 store that already keeps toys, parts, skins, and
  characters; today it keys on an anonymous device id and real accounts map
  onto the same player column later, so the grown-up's account is an account
  layer over that table, not a new store.
- Layout. Portrait and landscape both work: the camera keeps the toy clear of
  panels, and on landscape phones panels become side sheets.
- Testing. The headless playthrough tests carry over: every quest, mission,
  routine, and bedtime run gets a scripted test, with stand-ins for speech
  and the microphone.

## Plan, success, and open questions

Ship the cheap wins that bring kids back first, then the adventure layer,
and save the connected map, the biggest rewrite, until the daily habit is
proven.

| Big bet | Why | Difficulty | Cost |
| --- | --- | --- | --- |
| Daily quest board (reuses missions and XP) | Biggest return visits for the least code | Low | Low |
| Concept badges and the parent weekly summary | Makes the STEM value visible to kids and grown-ups | Low to medium | Low to medium |
| Quest givers with 2 to 3 chain stories per district | Turns the Labs into an adventure | Medium | Medium |
| Vehicle ability gates on the map | Gives rank unlocks real meaning | Medium | Medium |
| Deliver it and build-to-spec quests | The kid's own toy becomes the solution | High | High |
| Open connected map | Biggest change in feel, biggest rewrite | High | High |

1. Before building: run the STEM ladders playtests (8 or more kids across
   the age bands) and fold the findings in.
2. Phase A, come-back loop in today's game: the daily quest board with real
   routines, concept badges, the weekly summary, Workshop Day stamps,
   personal-best hints, and "Kip is recharging." Done when testing families
   return 4 or more days a week.
3. Phase B, adventure: quest givers and chains, mystery quests, the Mess
   meter, and the "Fix Kip's workshop" arc. Done when kids pick a second quest
   without being asked.
4. Phase C, the connected town: a three-district slice first (Plaza, Home
   Street, Garden), then all districts, with vehicle gates. The first slice
   uses the ready rank 2 and 3 vehicles; the island and sky gates join when
   the Catamaran and Helicopter land. Done when a child plays 20 minutes
   moving between three places without help.
5. Phase D, your toy as the solution: deliver-it and build-to-spec quests,
   and the Music Hall.
6. Phase E, families and seasons: family play for learning to share
   (pass-and-play first, then a device each), the family meal quest, shared
   worlds with missions, and weekly events inside the monthly packs.

What success looks like:

- Kids return on their own, and pick a second quest without being asked.
- In testing families, real routines get done at least 4 days a week.
- Bedtime finishes on time more often after two weeks.
- Parents describe the screen time as active, and can name a concept their
  child practiced.

Open questions, with a recommendation for each:

- Age band. Recommend both: 4 to 6 gets voice-guided quests with no reading,
  7 to 10 gets quest text and the Engineer tier, set by the parent's age
  choice. Should it also adjust to how a child actually plays?
- Story or sandbox. Recommend one light arc ("Fix Kip's workshop") as the
  spine, with standalone side quests for wandering.
- Multiplayer or family. Decided: family play first, built as an education in
  sharing (see Family play above). Pass-and-play on one device comes first,
  then a device each through a family code.
- Side streets in 2.5D, or full 3D roaming for older kids?
- How do routine rewards stay encouraging and never become pressure?
- Which speech approach works per platform without sending a child's audio
  anywhere it isn't deleted?
- Does Makers' Park need moderation tools before sharing between families
  opens?
