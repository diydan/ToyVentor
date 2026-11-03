# Household weekends: a review

_Reviewed 2026-11-03 against the working tree (`0ae223a` plus the uncommitted household work). The proposal under review is "Household weekends: find one at home, or skip it" (Dan O)._

## Verdict

The shape is right. "Find one at home, or play a shape game" suits a four-year-old, needs no loaner, no world, no stat, and it leans on the parent gate you already trust. The five questions are answerable, and four of them I would answer close to what the proposal says.

One thing has to be settled before any of it is built: **the picture the shape game shows may not be able to tell the items apart.** Measured on the catalog you already have, the front silhouette is a weak discriminator, and in the `simple` pool the youngest group draws from, six of the twenty items are the same circle from the front. That decides whether the game is playable for bands 0-1 at all, and it is a build-order question, not a tuning question.

## The short answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | Is skipping hard enough? | The numbers are about right. The stimulus is probably not. Fix the picture and the distractor rule before tuning the streak; keep 2/2, 3/2, 4/3, 4/3. |
| 2 | Should a skip pay no play-time minutes? | Yes - keep XP, the stamp and the trophy. Two changes: the roof must be able to tell a found weekend from a skipped one, and the household weekend needs its own completion path, because today's real-life leg would refuse it outright. |
| 3 | Is a grown-up confirm enough for "Find it"? | Yes. A scan must never be required, and when it arrives it must only ever add to a completion, never gate one. |
| 4 | Offer the 3D item when the helper is offline, by the child's own word? | Yes, for transport failures only, with its own reason and its own sentence. |
| 5 | Keep the photo-quality bar at 0.95? | Keep it. But 0.924 is evidence the trace needs work, not evidence the bar is too high. |

---

## Q1. Is skipping hard enough?

**The numbers are fine. The stimulus is the problem, and it is worse than the proposal assumes.**

### The front silhouette does not tell the items apart

The proposal says the wrong pictures come from "the same family as the right one", so a child has to actually look. But the picture the child looks at is a front silhouette, and a front silhouette of many of these items is not distinctive. Taking each item's front (`bboxMm` across and up, which is the front the build photographs) and calling two items *similar* when their front aspect ratio is within 12% and their front width is within 12%:

- **116 of the 1,770 possible pairs across the 60 items are similar.** The most confusable are `desk_lamp` (10 near-neighbours), and `drinking_glass`, `potted_plant`, `notebook`, `book`, `playing_cards` (9 each).
- **In the 20-item `simple` pool the youngest group draws from, 10 of the 190 pairs are similar**: `ball`-`plate`, `ball`-`flying_disc`, `ball`-`orange`, `plate`-`flying_disc`, `plate`-`orange`, `flying_disc`-`orange`, `mug`-`cookie_tin`, `cookie_tin`-`soap`, `drinking_glass`-`lemon`, `drinking_glass`-`banana`.
- **Six of the twenty simple items are a filled circle from the front**: `ball`, `plate`, `flying_disc`, `orange`, `yo_yo`, `marble`. The width rule above lets `yo_yo` (60 mm) and `marble` (40 mm) off the hook only because they are smaller - but a silhouette drawn to fit a common box, which is what a game panel wants, throws the size difference away. Then all six are the same circle.

So for a two-year-old whose target is the ball, a distractor of plate or flying disc is *the same black shape*. Two pictures to pick from, both circles, no cue: the game becomes a coin flip, and a wrong answer swaps in a new item without ever saying why the last one was wrong.

Two honest caveats on that measurement. It is a bounding-box proxy, not the real outline - it over-states collisions for hollow or thin items (a mallet is not a filled rectangle) and cannot see the holes that make, say, a fork or a key distinctive. And it says nothing about the colour picture the silhouette is matched against. But the round cases are exact: a ball, a plate and a flying disc seen from the front are three discs.

### "Family" means two different things, and the catalog's column is the wrong one

The catalog's `family` column is a **construction** family - `R` (revolve), `RC` (revolve plus composite), `E` (extruded or dished outline), `C` (primitives), `L` (loft). It is not a household family. If the distractor rule reads that column, a wooden spoon (`E`) draws its wrong pictures from `fork`, `key`, `comb`, `hairbrush`, `toothbrush`, `ruler`, `scissors`, `bubble_wand`, `toy_sword`, `pliers`, `jigsaw` - a key and a toy sword are not cutlery, and a scissors or a toy sword is not allowed on screen before band 3 anyway. A book (`C`) draws from twenty-one items, of which `notebook`, `lunchbox`, `cereal_box`, `playing_cards`, `pencil_case` and `board_game` are all near-identical rectangles from the front.

The proposal's own example is also broken: **there is no ladle item.** `ladle` is one of the four *words* that find the wooden spoon (`spoon`, `wooden spoon`, `cooking spoon`, `ladle`), so the example would put the target next to its own synonym.

### What I would do

1. **Give the catalog a `group` column** - cutlery, tools, fruit, containers, stationery, toys, bath, kitchen - hand-written, 60 rows, one per line. It makes the distractor rule real and reviewable. The build can check it (every group is a known name, no group holds a single item).
2. **Make the build write the real silhouette and the confusion matrix.** The build already knows each zone's outline; add the whole-item front outline as one path, plus the outline from a three-quarter view, and write a `confusableWith` list per item - the items whose real silhouette overlaps it above a threshold. Sixty items is 1,770 pairs; the build does it once, the game just looks it up. **This is the fix, and it is cheap, because the picture build is being written anyway.**
3. **Use the three-quarter silhouette for the game, not the front.** The front is right for the *confirm* (the grown-up needs to recognise the item they are being asked about). The game wants the most characteristic view.
4. **Distractor rule:** same group first, real-silhouette overlap below the threshold, `minBand` respected, topped up from the whole pool when the group is too small. A group of two (soap, marble) cannot supply three distractors on its own.
5. **Distractors must respect the same age gates as targets.** A fork (`minBand` 3) is not a wrong answer for a five-year-old either. The `simple` pool happens to be safe by construction - it contains no tool and no sharp-looking item - but the early, mid and older pools are not.
6. **A skip must always be completable.** With a streak that resets and an item that swaps, a child who cannot read silhouettes may never finish the skip, and a weekend that cannot be finished is a lost weekend - no XP, no stamp, no trophy. Put a safety valve in: after five misses the game names the answer and completes the drop. The anti-guess property is worth less than a weekend that can always be finished.
7. **At tiny, do not swap the item on a wrong answer.** A streak is not a real idea at two, and a swap means the child never learns why they were wrong. Retry the same item; the only thing at stake is play-time minutes, so the anti-guess property is not needed there.

**The numbers stay as they are: 2/2, 3/2, 4/3, 4/3.** Random tapping gets through tiny (25% per attempt), 11% of early, 1.6% of mid and older - the gradient is right. Once the pictures discriminate, these are fine.

## Q2. Should a skip pay no play-time minutes?

**Yes - that is the right call, and the reason given ("the minutes stay for real-world effort") is the right reason.** It is also the change that keeps the parent-time rule honest: today the STEM minutes are credited for an in-app build (`garage.<weekendKey>` -> `recordPlayProgress`, `minutesPerChallenge: 5`), so under the proposal a household weekend inverts the meaning - minutes are earned by the task done offline, and the game-only path earns none. That is the right inversion for a household weekend.

Two things need to change with it.

**The roof must not claim a found weekend that was skipped.** The roof stars are `(progression.garageDone ?? []).length` (`GameCanvas.tsx:1588`), drawn as up to four gold stars and a count (`ExplorerNodeArt.tsx:129-156`). If a skip marks the weekend done, a family whose roof is full of stars has done sixty games and maybe eight searches. Record the mode (a `garageFound` list of weekend keys next to `garageDone`) and draw a skipped weekend differently - a hollow star, or no star - so the roof stays a true picture of the real-world effort. The visible reward is the point of the roof; making it lie costs more than the skip saves.

**The household weekend needs its own completion path.** This is the one hard technical blocker in the reward. `completeGarageReal` - the grown-up "We built it" - is gated on the in-app drop already being done:

```
src/lib/garage.ts:679   if (!(prog.garageDone ?? []).includes(weekendKey)) return noop;
```

A household weekend has no in-app build (no loaner, nothing to equip), so `garageDone` is never set by a build, so the grown-up "We found it" confirm would be **refused outright** if it were built on `completeGarageReal`. And `completeGarageReal` pays `GARAGE_REAL_XP = 10` (`garage.ts:605`), not the drop's 40.

So the household drop needs its own function - `completeGarageHousehold(prog, weekendKey, dayKey, mode)` with `mode` `"found" | "skipped"`:

| | XP | Workshop Day | Roof | STEM minutes |
| --- | --- | --- | --- | --- |
| found | 40 (`GARAGE_XP`) | yes | yes, as a found star | yes, `garage.<weekendKey>` |
| skipped | 40 | yes | yes, as a skipped mark | **no** (`stemMissionId: null`) |

Both set `garageDone`, so the weekend cannot be done twice, and both record the mode.

On the numbers: a find should pay the **drop's** 40 XP, not the real-life leg's 10, because the household weekend *replaces* the in-app drop - otherwise the same family effort is worth less on a household weekend than on a build weekend. Whether it consumes the shared +25 XP/day real-life ceiling is a decision worth naming: Q10 (resolved 2026-11-02) sets that ceiling across "all real-life quests (routines + scavenger combined)", and a household find is arguably a third kind. If it counts, 40 XP clamps to 25 and the household weekend is worth less than a build weekend for the same family effort - so my preference is that it **does not** consume the ceiling (it is the drop's reward, not a quest's bonus), but it **does** block a same-day "We built it" through the existing `earnedToday` rule (`garage.ts:682-687`), which already reads `garageRealByDay`. One thing to say out loud to the parent: the two real-life legs then pay differently - "We found it" is the drop and pays the drop's reward, "We built it" is a bonus on a drop already done. Name them differently in the Grown-ups sheet so the difference is legible.

## Q3. Is a grown-up confirm enough for "Find it"?

**Yes. The grown-up confirm should be the only way to complete "Find it", and a scan should never be able to block one.**

Four reasons, all in the current code:

1. **The game has no camera.** There is no `getUserMedia` anywhere in `src/`. The scan route exists as an API client (`src/lib/api.ts`, `postSamScan`), but the Garage sheet has no camera UI, and the household library's photo path lives in the **Kip viewer**, a separate page. So "once the game gets its own photo path" is not a footnote - it is a camera, a Worker round trip, a matcher and a new panel in the React app.
2. **The one real photo fails the bar.** The steel spoon scores fidelity 0.924 (`household-library-spec.md:328`), below `MIN_FIDELITY = 0.95` (`householdMatch.ts:196`), so under today's rules that photo gets the "item on its own" offer, not "alongside the plate". A confirmation path that depends on the scan would fail on the only real photograph anyone has taken.
3. **The matcher is strict on words.** `matchWord` finds nothing for a near word: no spelling repair, no containment, no synonyms ("big spoon" finds nothing), and only a plain plural is read. A child's "spoon" works; "silver spoon" and "spon" do not. A confirmation that fails for reasons the child cannot see is a bad confirmation.
4. **The scan needs a network and a camera, at a moment when the family is holding a real spoon.** The real-life leg is explicitly the pattern that works offline behind the parent gate.

If a scan-match is ever added, two rules: it must be **additive** (either route completes the drop), and it must never be able to **un-complete** or contradict a grown-up confirm. A child who found the spoon must never be told "no" by a camera.

One note for later: the confidence rule has a third condition that is not built - the outline's silhouette overlapping the item's own silhouette. That is the check that would catch "the helper traced the floor" and it is the one that matters for a scan-match, not fidelity. If the scan ever becomes a confirmation route, that is the thing to build.

## Q4. Should the offer appear when the helper is offline, by the child's own word?

**Yes - for transport failures only, with its own reason and its own sentence.**

Today `offerForScan` offers nothing when the scan did not run for any reason other than a bad trace (`photoPrintFlow.ts:170-174`), and `offerFor` with no photo at all returns `none` / `no_scan` (`householdMatch.ts:232`). So an offline helper currently means no library item, even when the child said "spoon" perfectly.

Change it like this:

- **Offer it when** the scan failed for a transport reason - `offline`, `helper_off`, `busy`, `slow_down` - **and** the word matches exactly one built item inside the child's band. `matchWord` already handles `minBand` and `not_built`.
- **Do not offer it when** the input was the child's own fault - `invalid_input`, `too_large`. Offering an item there is noise.
- **Give it its own reason** (`why: "word_only"` alongside the existing `no_outline` and `poor_outline`) **and its own sentence.** The existing sentences both talk about tracing - "I could not trace your photo, but here is the 3D scissors." With no photo there is nothing to trace, so the sentence must not mention it: *"You said spoon. Here is the 3D wooden spoon."* The `offerSentence` function is one switch, and the tests pin each string.
- **Keep it an offer.** The child chooses; nothing is applied without them.

Two caveats. The word rule stays strict, so this route works well when the word comes from a voice transcript or a parent typing and poorly when a pre-reader types. And the item is the library's, not the family's: "spoon" finds the wooden spoon, so the sentence should name the label ("the 3D wooden spoon"), which it does.

This composes well with the Garage: the coloured-from-photo 3D item stays a bonus for when the photo worked, and the plain 3D item is still available when it did not.

## Q5. Should the photo-quality bar stay at 0.95?

**Keep it. But do not read the 0.924 as evidence that the bar is too high.**

The one real photo is a photo of a steel spoon that scored 0.924 with no warnings. The spec already reaches the same conclusion ("The threshold needs more photos before it is changed"), and I agree with it: fitting a threshold to a single sample is how you end up with a threshold that means nothing. The fidelity number answers "is this outline safe to cut along?", and one sample at 0.924 does not tell you where the cliff is.

The more useful point is that **0.95 is doing two jobs today, and they should be separated**:

- Whether the child's **cut-out** is trustworthy - this is what fidelity is for, and the bar should stay high. A wrong outline means a wrong plate in the child's hands.
- Whether the **item** is the one the child said - this is the word's job, and it needs no bar at all.

The code already has that shape: `offerFor` sends a good outline to "alongside" and anything worse to "alone", while the word alone picks the item. So the honest reading of today's one photo is not "the bar is too high" but "I traced it, and the edge is not clear enough to cut along, but you said spoon, so here is the 3D spoon" - which is exactly what the child is told (`offerSentence`, `poor_outline`). That is correct behaviour, not a bug to fix.

Keep `goodOutline`'s other rule too: an unknown warning code counts as bad (`householdMatch.ts:213-216`). A new warning should never be trusted by default.

## Before it is built

Six things, in build order.

**1. The picture has to discriminate.** As above: the real silhouette, the confusion matrix, the three-quarter view for the game, a `group` column, and a distractor rule that respects the age gates. This is the part that decides whether the game works, and it is part of the picture build you already have to do.

**2. The rotation does not add up.** `dropForWeekend` is `weeks % GARAGE_DROPS.length` (`garage.ts:521-526`) and there are 12 drops today. Append 60 household drops to that same catalog and the cycle becomes 72 weekends - so a household weekend comes round every sixth weekend, not every weekend, and "sixty items is a little over a year of weekends" becomes "sixty items is a year and a half of weekends", or worse. The proposal says both "each weekend names one household item" and "the other kinds are unchanged", and those cannot both hold. My suggestion: **one Build Day a month** (the first weekend of each month keeps a build drop; every other weekend is a household weekend). That is 40 household weekends a year, so the 60 items cycle in 18 months, and both catalogs stay alive. Whatever rule is chosen, it should be one line of code and a test.

**3. The completion path.** `completeGarageHousehold` with a mode, the roof mark for a skip, and the `garageFound` record - as in Q2.

**4. The tool weekend has two loose ends.** First, a tag mismatch waiting to happen: the six garage tools are the items with the `garage` tag (`hammer`, `screwdriver`, `pliers`, `flashlight`, `tape_measure`, `bucket`), but only four of them carry `tool` (`bucket` and `flashlight` do not). A rule that filters by `tool` gives four tools and silently drops the bucket; a rule that filters by `garage` gives six. Pick `garage` and make the catalog agree, or add the tag to the bucket. Either way, note that the screwdriver is `minBand` 3, so the band-2 pool of garage tools is five, not six. Second, the tiny case has a physical hole: at bands 0-1 the child is "never asked for a real tool" and the support tool stands in - but the support tool is a game object (`support_tool.glb`, a chunky mallet in the catalog's separate `support` list), and nothing in the design puts one in the family's house. I would read the support tool as the **picture**, not the object: the task is "find any tool you can carry and show a grown-up", and the picture on the sheet and in the game is the toy mallet. That needs no physical product and no printing. It also needs saying out loud, because as written the tiny tool weekend has no real-world referent at all.

One more thing to decide: at bands 4-5 a tool weekend asks for three different tools, and many families do not own three distinct tools, let alone three of those six. The weekend should say *what counts* - any three distinct real tools, or three from the named set - and the sheet should show the set. If it stays hard to find, the tool weekend quietly becomes a shape game.

**5. The names have to be said, and the vocabulary does not have them yet.** "A right answer plays the item's name aloud" is not free. The game's spoken names are a controlled vocabulary with gender and number agreement across seven languages (`src/lib/propNames.ts`: 25 noun keys, 7 languages), and the 60 household labels are not in it. Saying the raw English label would work in an English browser and be an English word read with a foreign accent everywhere else - so "it works in every language" is, today, only true in English. Sixty nouns in seven languages is 420 entries with gender and plural forms, and this repo has a native-speaker review process for exactly that (`docs/review/spoken-names.md`, generated from the vocabulary). That is the real cost of the skip game's payoff, and for a pre-reader it is the payoff - it should be in the estimate.

**6. The drop shape.** A household drop needs a new goal kind - it names an item, and a tool weekend names a *count*. The `GarageDrop` type has `goal: GarageGoal` and nothing for this. The four band variants per drop should be **template-built**, the same rule the phase-2 note set for the nine template drops ("so each drop is not four hand-written versions"): 60 drops x 4 hand-written briefs is 240 strings, and the age differences are mechanical (the sharp-looking exclusion, the support tool standing in, the count, the skip numbers).

## Where the code lands

| What | Where |
| --- | --- |
| The drop rule, the shape-game logic, the completion | `src/lib/garageHousehold.ts` (new, pure helpers, next to `src/lib/garage.ts`), unit-tested in `tests/garage-household.test.ts` beside `tests/garage.test.ts` |
| The front picture, the silhouette, the confusion matrix, the `group` column | `parts/kip/household/` - the build writes `frontZones`, `silhouette`, `confusableWith` into `public/kip/household/catalog.json`, with a checker like the others |
| The word-only offer when the helper is offline | `shared/householdMatch.ts` (add the `word_only` reason and sentence), `shared/photoPrintFlow.ts` (the transport-failure branch) |
| The completion and the roof | `src/lib/garage.ts` (`completeGarageHousehold`), `src/lib/progression.ts` (`garageFound`), `src/features/game/world/ExplorerNodeArt.tsx` (a skipped weekend's mark) |
| The 60 spoken names | `src/lib/propNames.ts` (the vocabulary) and the review sheet |

One note on the state of the tree: `shared/householdMatch.ts` and the four household test files are still **untracked**, and `shared/photoPrintFlow.ts` and the three viewer files have uncommitted changes. The proposal says as much ("built, not yet committed"). It is worth committing that work before starting on the weekend, because the weekend's matcher work sits directly on it and the branch is getting wide.
