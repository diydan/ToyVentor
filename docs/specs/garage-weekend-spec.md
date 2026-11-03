# Garage: the weekend build drop — spec (draft 2, 2026-11-03; phase 1 built)

A place on the map and in the carousel where a child builds new things.
The Garage is **always open**. What changes is a **new drop every Friday,
Saturday and Sunday** (a new part to try, an idea, or a remix), and on those
days the Garage is animated and is the focus of the map. **Phase 1 is built**
(see "Phase 1 as built" below); the real-life leg, parent controls and roof
trophies are phase 2 and not built.

## Decisions (Dan, 2026-11-03)

1. **Both** an in-app build and a real-life build.
2. The Garage (the Workshop, on the map) is **always open**. The new part,
   idea or remix arrives **every Fri/Sat/Sun**, so the place is animated and
   focused then.
3. **One new drop per weekend.**
4. **All ages**, with **age-range-specific missions**.
5. Completing it **counts toward STEM minutes**.

Reading of 5 (Dan, 2026-11-03: "on weekends enough time to complete the
mission, and increase time based on STEM"): the weekend allowance is always
enough to finish the weekend mission, and completing it earns STEM minutes
that extend the allowance, inside the parent's cap.

- **Enough time to finish.** Today's mission grace is 25 seconds
  (`missionGraceUntil` in `GameCanvas`), which is nothing for a build. While a
  Garage mission is open and the day's limit would lock the child out, a
  **Garage grace** applies: up to 10 minutes once per weekend, never during
  quiet hours, and it is spent only while the Garage mission is on screen.
  The 10 minutes is a proposal to confirm.
- **More time for STEM.** Completion is credited as a STEM mission
  (`garage.<weekendKey>`), which raises the allowance by `minutesPerChallenge`
  up to the Weekend preset's STEM cap.

## Names

- **Garage** is the kid-facing name and the map place (`garage`).
- **Workshop** stays the Kip + Truck bench page (`/kip/Workshop.html`,
  workshop-spec.md). The real-life leg links to it.
- **Factory** stays the game's build stage (`ToyCustomizer`, dock `Build`).
  The Garage opens Factory for the in-app build.

## What the Garage is every day

A free-build place. Tapping it always works: it opens Build, with a short
"Free build" sheet. Mon–Thu it shows the last drop (replayable, no new
reward) and "New drop Friday". It is never locked and never hidden, which
keeps the carousel's "nothing locked" rule.

## The weekend drop

- **Window:** Friday 00:00 to Sunday 23:59 in the parent's timezone
  (`parentSnapshot.settings.timezone`, via `localDay`). The weekend key is
  the date of that Friday (`2026-11-06`); Sat and Sun belong to the Friday
  before them.
- **One drop per weekend key**, chosen deterministically from a catalog (the
  same way Daily Quests rotate from the date): offline, no server, no RNG, no
  immediate repeat. Same weekend, same drop on every device.
- **Three kinds**, rotating:
  - **New part:** a *loaner*. A part the child has not found yet is open to
    try for the weekend, to equip and play with. Keeping it means finding it
    in its world, and the map points there. The part is not given away.
  - **Idea:** a build brief with a check the game can read, for example
    "build something with glow and speed".
  - **Remix:** take your last Garage build and change one thing under a twist
    (swap a slot, change the colour, add a stat).
- **Missed drops cost nothing** (Dan, 2026-11-03). A drop the child never
  started is simply skipped, and the rotation can bring it round again on a
  later weekend, so it can still be done then. A drop that was started and not
  finished stays resumable until the next one arrives. A finished drop can be
  replayed for fun with no new reward. It is animated and focused only
  Fri–Sun.

## Age ranges

The same drop has a version per age band group. Briefs are written in terms
that work for both toy types (character and vehicle): **stats** (speed, spin,
glow, torque) and "change one thing", not type-specific slots.

| Bands | Ages | Version | Check |
| --- | --- | --- | --- |
| 0–1 | 2–4 | Pick one of 2–3 choices, spoken, errorless | Equipped it |
| 2 | 5–6 | Two choices (a part and a colour), short sentence | Equipped both |
| 3 | 7–9 | A stat brief ("glow and speed") | Build has those stats |
| 4–5 | 10+ | Constraints (three stats, or a stat plus a limit) and remix twists | Build meets them |

The check reads the live build: the equipped part per slot and the build's
stats. It needs one additive engine read, `buildSummary()` (`{ type, sel,
stats }`); no new gameplay events.

## Household library drops (added 2026-11-03, Dan: use the household items in the weekend games)

Source: [household-library-spec.md](household-library-spec.md): 50 everyday objects, each a small optimised 3D part (five are built as a
pilot), chosen from the scan list's ranking and matched from a word or a photo. This section says how the Garage uses them; the library spec owns
the items.

- **The weekend's New part is a library item.** Fifty items is almost exactly a year of weekends (52), so the catalog is long enough that the
  rotation rarely repeats. Same rule as before: deterministic, offline, no immediate repeat. The order is authored, so a theme is possible: the six
  garage tools (hammer, screwdriver, pliers, flashlight, tape measure, bucket) make a natural **tool weekend**.
- **The loaner is shown in 3D** on the Garage sheet ("This weekend: the wooden spoon") and equips in the hand slot to try for the weekend. The
  loaner rule is unchanged: it is not given away.
- **Idea kind, "Find one at home".** The sheet shows the item; the child finds the real one. Taking a photo is optional (the in-app drop never
  needs one), goes through the same print panel and photo path as any scan, and gets the match offer: "This looks like a spoon. Want the 3D spoon,
  coloured from your photo?" A photo the model cannot trace but whose word is right still gets the library item.
- **Remix kind:** swap the held item for another of the same family (a mug for a bowl), then add the twist.
- **Age bands:** the pre-reader versions pick between two items by picture. Tools and sharp-looking items follow the age rule that
  household-library-spec.md leaves as an open question; until it is decided the garage tools are held back from bands 0 and 1.
- **The check** reads the equipped hand item, so `buildSummary()` gains one field, the item id. No new events.
- **Build it for real** uses the printable relief where it passed the gates; an item that did not is digital-only, and the sheet says so.
- **Rewards:** unchanged. The mission id, the STEM minutes, the XP, the stamp and the trophy do not depend on which item the drop used.
- **Launch drops (Phase 1):** the five pilot items (ball, mug, wooden spoon, pencil, banana) are built and could be the first loaners, but a
  library part cannot be equipped in the game yet (household-library-spec.md, open question 2). Phase 1 stays as specified unless that turns out to
  be cheap; the library is Phase 2 content.

## Rewards and what it counts for

- **STEM minutes:** the mission id is `garage.<weekendKey>`, passed to
  `recordPlayProgress({ completedMissionIds })` once, at completion. It is
  credited once per local day, at `minutesPerChallenge`, inside the parent's
  cap (the Weekend preset's STEM allowance). No new plumbing.
- **XP:** the Daily Quest amount (`DAILY_QUEST_XP`, 40), once per weekend.
- **Workshop Day stamp:** stamped as for any quest (never resets).
- **Trophy:** a permanent flag per finished weekend on the Garage roof, so
  weekends visibly grow the map.

## Real-life build (the second leg)

After the in-app drop, "Build it for real" opens the Workshop page with the
current build (the existing `kipDemoUrl(contract)` link and print view). A
**grown-up confirms** "We built it" behind the parent gate (decided), the same pattern
as Real-Life Routines. That stamps a Workshop Day and pays a small bonus, and
it respects the **shared +25 XP/day real-life ceiling** (sam-physical-to-digital
spec, Q10). It is optional and needs a printer: the in-app drop is complete
without it. The Workshop benches are not mounted in the game yet (workshop-spec
stages 4c and 4d), so this leg is a link-out for now.

## On the map and in the carousel

| | Trail map (8+) | Carousel (3–8) |
| --- | --- | --- |
| Always | A `garage` place by Toy Room: a building with a roll-up door. Always in colour (like home), always tappable. | A `garage` card, always present. |
| Fri–Sun, not done | Door up, warm light, sparks, a bouncing arrow; the plate reads "New this weekend"; the toy starts here (it is the suggested place). The door rolls up once on the first open of the weekend. | The card moves to the front, shimmers, and carries a NEW badge; it is the suggested card. |
| Done | Trophy flag on the roof, "Done ★". | Star on the card. |
| Mon–Thu | Door down, sign "New drop Friday". | Plain card, "New drop Friday". |

Both open one **Garage sheet** (a bottom sheet over the carousel; over the
trail map like the rung sheet): the brief for the child's age, **Start**
(closes the sheet and opens Build with a goal chip and a live check), **Free
build**, and, after it is done, **Build it for real**.

## Parent controls (Grown-ups)

A switch for the weekend drop, the days (default Fri, Sat, Sun), and the
real-life leg. The Garage itself cannot be switched off.

## Data

`progression:v1`, validated, union-merged and wiped by XP reset like the
explorer fields: `garageDone` (weekend keys finished), `garageSeen` (last
weekend whose door animation played), `garageLastBuild` (the build a remix
starts from), `garageReal` (weekend keys the grown-up confirmed). Pure
helpers in `src/lib/garage.ts` (weekend key, rotation, age variant, check);
authored drops in `src/lib/garageDrops.ts`. `CardKind` gains `garage`.

## Demo

Day 9 and 10 are weekdays and the first real drop is Fri Nov 6, after the
submission. ToyForge Demo Mode gets a **Preview weekend** switch that forces
the weekend state and picks the next drop, so the animation and the mission
can be shown on a weekday.

## Tests

Unit: weekend key and window (including Sat/Sun, midnight, DST, other
timezones), rotation is deterministic with no immediate repeat, every drop
has a version for every band, each check passes and fails correctly, the new
progression fields. E2E: the Garage is always on the map and in the
carousel; the weekend state shows with Preview weekend; finishing the mission
updates progress, the stamp and the parent ledger's STEM minutes; the loaner
part opens for the weekend and closes after; nothing replays on the next
open.

## Phase 1 as built (2026-11-03)

In the app: the Garage place on the trail map (a building with a roll-up door,
at (2, -1) off Lab 6, always in colour), a Garage card on the carousel, one
**Garage sheet** over either, a **goal chip** that rides over the stage while
a mission is on, three launch drops (new-part loaner, idea, remix) each with a
tiny / early / mid / older wording, the weekend window and rotation, XP, the
Workshop Day stamp, the STEM credit, the weekend loaner part, the Garage grace
and Demo Mode's Preview weekend. Code: `src/lib/garage.ts` (pure),
`src/lib/garageDevice.ts` (device settings), `GarageSheet.tsx`,
`GarageGoalChip.tsx`, plumbing in `GameCanvas.tsx`, `engine.ts`
(`buildSummary`, `setLoanKeys`) and `runtime/world.ts`.

How it behaves, where this differs from the design above:

- **Done means changed.** A mission finishes when the goal holds and the child
  has changed at least one part since pressing Start. A toy that already
  glows does not pay out for "make it glow"; the chip then adds a "Change
  something" step. Switching between Character and Vehicle restarts the
  mission from the new toy.
- **Remix starts from the build at Start**, not from a saved last build, so
  there is no `garageLastBuild`.
- **No door animation record.** The lit door and sparks show on every
  weekend day until the drop is done, so there is no `garageSeen`.
- **Days after the weekend:** the latest drop stays in the Garage Monday to
  Thursday, labelled "The latest drop", doing it still pays once. Before the
  first launch weekend (Fri Nov 6) the "latest drop" is the rotation's earlier
  one, the remix.
- **Paid once per weekend.** XP is `GARAGE_XP` (40, the Daily Job amount),
  the weekend key goes in `garageDone`, the day goes in `workshopDays`, and
  the mission `garage.<Friday>` goes to `recordPlayProgress` so the parent's
  STEM minutes apply inside their cap. The chip says what was paid
  ("+40 XP · +5 min play time"; no minutes line when the cap or the setting
  gives none). A replay says so and pays nothing.
- **Loaner:** on a weekend the drop's part (crown for a character, booster for
  a vehicle) opens in Build for the weekend; on Monday a worn, unfound loaner
  goes back to the stock part. A part the child really found is never touched.
  Build does not label the loaner yet; it sits in its normal tab (Crown, Rear).
- **Grace:** a mission underway when today's limit locks the toy may finish,
  10 minutes once per weekend, never in quiet hours, spent only while the
  mission is unfinished and the limit is what locked it. It is stored on the
  device per weekend. Covered by unit tests of the arithmetic; **not exercised
  end to end**.
- **Preview weekend (Demo Mode):** shows next Friday's drop as a weekend. It is
  a pretend weekend: finishing it runs the chip to Done and says "Preview
  only. Nothing is saved", and pays nothing, marks nothing done and credits
  nothing, so it cannot touch the real first weekend.
- **Not built:** parent controls (drop switch, days), the real-life leg and its
  grown-up confirm (`garageReal`), roof trophies, the 3D loaner on the sheet,
  a loaner label in Build, and drops beyond the three.

Verified: `tests/garage.test.ts` (45; window, rotation, every goal reachable
with parts a child has open, checks, completion, card order, device settings)
and `npm run e2e:trail` scenarios `garage-weekday`, `garage-carousel`,
`garage-weekend`, `garage-preview` with a pinned clock (a Wednesday and the
Saturday Nov 7). **Not tried on a real phone.**

## Scope against the freeze (Day 9 is the last day for features)

- **Phase 1 (fits only if started now):** the Garage place on the map and in
  the carousel, always open; the weekend state and animation; the drop engine
  and **three launch drops** (one per kind) with age versions; the in-app
  check; STEM minutes, XP and stamp; persistence; Preview weekend; tests.
- **Phase 2 (after submission):** the real-life leg with the grown-up
  confirm, parent controls, the roof trophies, a larger catalog (12+ drops,
  built from templates so each drop is not four hand-written versions), and
  Describe & Build as an Idea kind.

## Resolved (Dan, 2026-11-03)

1. Missed drops: never-started drops are skipped and can come round again; no
   backlog and no penalty (see "The weekend drop").
2. Time: the weekend always leaves enough time to finish the mission, and
   completing it earns STEM minutes (see "Decisions", reading of 5).
3. The real-life confirm is behind the parent gate.
4. Name: "either Garage/Workshop or Factory". **Garage** stays the kid-facing
   name of the map place. It keeps three names for three things: Garage (the
   place), Workshop (the Kip and Truck bench page, and the Workshop Day stamps
   it leads to), Factory (the build stage). A pre-reader knows what a garage
   is, which matters in the carousel for ages 3–8.

## Still open

- How a household library item is equipped in the game, whether Phase 1's launch drops can use the pilot items, and whether the garage tools
  and sharp-looking items are shown to every age band (household-library-spec.md, open questions 1 to 3).
- The 10-minute Garage grace (length, and whether it should also apply on
  weekday drops).
- Time-of-day look for the Garage and the worlds: see "Time of day" below.

## Time of day

Specified in [environment-spec.md](environment-spec.md): two looks (day and
night, the same scene with the lights on), one shared clock, a continuous and
weather-aware stretch after the hackathon. The Garage reads that clock so its
door lights come on at night.
