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

## Household library drops (added 2026-11-03, Dan: use the household items in the weekend games; simplified the same day)

Source: [household-library-spec.md](household-library-spec.md): 60 everyday objects (the 50, then ten more), each a small optimised 3D part (all
built, 2026-11-03), chosen from the scan list's ranking and matched from a word or a photo. This section says how the Garage uses them; the library spec
owns the items.

**Dan's simplification (2026-11-03): no 3D loaner for household items.** Nothing is equipped in the game, so no hand slot, no vehicle question and no stat
or world per item. A household weekend is **"find one at home"**, with a way to skip that is not one tap.

- **One item a weekend.** The weekend's drop names one library item, shown by a picture and its name on the Garage sheet. Same rotation rules as every
  drop: deterministic, offline, no immediate repeat. Sixty items is a little over a year of weekends (52). The order is authored, so a theme is
  possible (the garage tools make a **tool weekend**, below).
- **Two ways to finish. Either one completes the drop.**
  - **Find it.** The child finds the real one. A grown-up confirms "We found it" behind the parent gate, the pattern the real-life leg already uses
    (`garageRealByDay`), with the item's picture on the confirm so the grown-up knows what was asked. Full reward. Scanning it in the Kip viewer is a
    bonus and never required: the photo gets the library's match offer and the 3D item coloured from the photo (game only, never in a print).
  - **Skip it: "Who's that shape?"** (clue-based, no reading). The game shows the weekend's item as a black silhouette seen from the front, drawn from
    the item's own 3D model, and the child picks it from a few pictures. A right answer plays the item's name aloud (the say-what-it-is voice). The
    silhouette needs no authored text or art and works in every language, so pre-readers can play it.

    | Age group (`bandGroupOf`) | Pictures to pick from | Right in a row to finish |
    | --- | --- | --- |
    | tiny (bands 0-1) | 2 | 2 |
    | early (band 2) | 3 | 2 |
    | mid (band 3) | 4 | 3 |
    | older (bands 4-5) | 4 | 3 |

    The wrong pictures come from the same **group** as the right one (cutlery, tools, fruit, containers, stationery, toys, bath, kitchen: a
    hand-written `group` on each catalog row, not the build `family` column, which is a construction family), **but never an item whose real silhouette
    is close to the answer's** (the build writes a `confusableWith` list per item), never an item the child's band may not see (`minBand`, so a fork is
    not a wrong answer at band 2 either), and topped up from the whole pool when the group is too small; the youngest group draws only from the `simple`
    pool. (Review, 2026-11-03: measured on the real outlines, 15 of the 190 pairs among the 20 simple items overlap 90 percent or more from the front,
    all discs: ball, plate, flying disc, yo-yo, marble, orange; a three-quarter view roughly halves that and cannot fix it, because those things are
    round. So the pair must be chosen, not drawn at random.) The game shows the **three-quarter** silhouette; the front picture is for the grown-up's
    confirm. A wrong answer in the early, mid and older groups starts the streak again with a different item and does not say which was right; **in the
    tiny group it retries the same item** (a streak is not an idea at two, and a swap never says why the last answer was wrong). **Always completable:**
    after 3 misses on an item the picture gains its colours, after 5 the name is said and the right picture is highlighted, and the child still has to tap
    it. Tapping wrong answers can never finish a skip. The numbers are my proposal, as is the reward below.
- **Rewards.** Find it: unchanged (XP, play-time minutes, Workshop Day stamp, roof trophy). Skip it: the XP, the stamp and the trophy, **no play-time
  minutes** (those stay for real-world effort, the same "paid only after a change" idea the minutes already follow). Proposed; Dan has not objected.
  Decided by Dan (2026-11-03: "2 yes", "3 yes hollow star"): a find pays the drop's 40 XP and does not consume the +25 XP/day ceiling; a skipped weekend is a
  hollow roof star. Two consequences found in review (2026-11-03): (1) **a household weekend needs its own completion**, `completeGarageHousehold(prog, weekendKey, dayKey,
  mode)` with `mode` `"found" | "skipped"`, because `completeGarageReal` refuses a weekend whose in-app drop is not done (`garage.ts:679`) and pays the
  real-life 10 XP, not the drop's 40. Both modes set `garageDone` (no second completion), record the mode in a new `garageFound` list, and pay the drop's
  40 XP and the Workshop Day stamp; only "found" earns the STEM minutes (`garage.<weekendKey>`); a find should not consume the shared +25 XP/day
  real-life ceiling (it is the drop's reward, not a quest's bonus) but does block a same-day "We built it" through the existing `earnedToday` rule.
  (2) **The roof must not claim a skipped weekend as found.** The stars count `garageDone` (`GameCanvas.tsx:1588`); a skipped weekend gets a different
  mark (a hollow star) so the roof stays a true picture of real-world effort. Name the two grown-up buttons differently ("We found it" is the drop;
  "We built it" is a bonus on a done drop).
- **Tool weekends** (the items tagged `garage`: hammer, screwdriver, pliers, flashlight, tape measure, bucket; the rule reads the `garage` tag, which all
  six carry, not `tool`, which the bucket and the flashlight lack) follow the age rule decided in household-library-spec.md ("Decided after phase 2"). A
  tool job names how many different tools to find: bands 0-1 are never asked to handle a real tool: the chunky **support tool** is the *picture* on the
  sheet and in the game, and the task is "ask a grown-up to show you a tool", which the grown-up confirms (so the tiny weekend has a real-world referent
  and no product is needed); band 2 finds 1 blunt tool (five are open to it, the screwdriver is band 3); band 3 finds 2 different tools; bands 4-5 find
  3. The sheet says what counts (three different ones from the six it shows), because many homes do not own three. `sharp-looking` items (fork, scissors,
  screwdriver, toy sword) are not asked for before band 3. The catalog carries `minBand` on every item and the support tool (`maxBand` 2); the Garage's
  counting is not built yet.
- **Household items do not use the Remix kind** (it swaps a held item, and nothing is held). The other kinds are unchanged.
- **The rotation (decided, Dan 2026-11-03: yes).** `dropForWeekend` is `weeks % GARAGE_DROPS.length` over 12 drops today; appending 60 household drops would make a
  household weekend come round every sixth weekend, not every weekend. Proposed: **one Build Day a month** (the first weekend of the month keeps a build
  drop, every other weekend is a household weekend): about 40 household weekends a year, the 60 items cycle in about 18 months, both catalogs stay
  alive; one line of code and a test.
- **The names (Dan, 2026-11-03: "use the google TTS worker we bound in the Cloudflare Worker to create any missing ones, save and track for future";
  translations from "muse llm ... use direct not via cloudflare"; spend on the live voice "once we approve some samples").** A right answer says the
  item's name, but the game's spoken names are a controlled vocabulary (`src/lib/propNames.ts`: 25 noun keys, 7 languages, native review in
  `docs/review/spoken-names.md`) and the 60 household labels are not in it. Plan: a committed `src/lib/householdNames.json` holds each item's **bare noun**
  (no article, no colour, so no gender agreement) in the 7 languages, English from the catalog label and the other six written by the **Muse model called
  directly** (a script that loads the key itself, like `scripts/kip-gen-faces.ts`; never via the Cloudflare AI binding; Dan runs it), each entry marked
  unreviewed until a native speaker approves it. The household items join the voice route as vocabulary keys (`h=<item id>`, never free text, like the part
  names); each clip is generated once on first use by the Google TTS binding and kept in the edge cache; a committed **ledger** records which clips exist,
  the text each speaks and a hash of the audio, so a new item gets its clip later and nothing is regenerated. There is no device voice: until a
  clip exists the caption carries the name. Samples first: Dan approves a sample of names (and a few clips) before the full run of about 420 clips.
  **Built (2026-11-03, a forked agent; checked by the main session):** `src/lib/householdNames.json` (61 ids; English from the catalog label, `soda can` for
  the can; the six other languages empty until the Muse script runs), `householdNames.ts` (lookup, `HOUSEHOLD_IDS`), `householdNamesCheck.ts` (validator:
  bare noun, 1 to 3 words, no article or colour word, kid-safe, no two items sharing a noun in a language), `householdVoice.ts` (`speakHouseholdName(itemId)`:
  the Gemini clip only, English in English where a language has no name), `scripts/household-names.ts` (Muse,
  direct, reads the key from the environment or `.dev.vars`, never printed, budget 16 calls, stops on 401/403/429, never overwrites an approved name),
  the `h=<item id>` key in `worker/voice.ts` (closed vocabulary, no free text, the cache key carries a fingerprint of the text so a corrected noun is a new
  clip), `scripts/prewarm-voice.ts` (`--list`, `--missing`, `--force`, `--only`) with the ledger `src/lib/householdVoice.ledger.json`, and a "Household names"
  section in `docs/review/spoken-names.md`. Checked: 158 tests in the 7 related files re-run by the main session, `tsc` clean for these files; the agent's
  mutation round killed 48 of 48 in the end. The Garage calls `speakHouseholdName` (a right answer says the name of what was found; a miss says it only when
  that tap shows the name: `nameToSay`).
  **The names exist (2026-11-03).** Dan ran the Muse script (direct, not via Cloudflare): all 60 items and the toy tool in the six languages, every entry
  unreviewed. A first sample called the toy tool "hammer" in all six languages because the script's own description said "a play mallet"; the description now
  says the name must mean "toy tool". I hand-corrected 11 weak words (source `muse:hand:2026-11-03`, still unreviewed): the cookie tin (es, fr, it, pt, tr
  had a bare "box"), the German flask (`Isolierflasche`, not the brand-derived `Thermosflasche`), the Turkish soda can (`içecek kutusu`; `kutu` also means
  box), the Turkish flashlight (`el feneri`; `fener` is a lantern), the German stapler (`Hefter`), the Spanish crayon (`lápiz de cera`) and glue stick
  (`pegamento en barra`). Still for a native speaker: Turkish `kupa` (mug; also a trophy), `top` (ball; the English word "top"), `termos`. **22 texts are
  spelled the same in two or more languages** (listed in `docs/review/spoken-names.md`: ball, tasse, termo, lata, bol, planta, yoyo, orange, banana, banane,
  avocado, pincel, crayon, dados, espada, hammer, despertador, lampe, puzzle, libro, cartas, esponja), so the Gemini voice may speak them in the wrong
  accent; the device voice with an explicit language tag cannot. Not verified: any real audio (samples pending), a deployed `h=` route.
  **After Dan's "go" (2026-11-03):** every clip the route generates is the Gemini clip; the 22 same-spelling nouns (49 of the 427 (item, language) pairs) were first sent to the device voice, a rule since removed (see "No phone voice" below). Every clip the route generates is **levelled** to an RMS of 5,000 (gain clamped to 0.5 to 4, peak held under 95
  percent of full scale: `levelWav` in `worker/voice.ts`) because the same voice's clips ranged from 1,700 to 9,000; clips already in the edge cache are not
  re-levelled.
  **Samples REJECTED (Dan, 2026-11-03, after listening again: "they are always an English speaker trying to say foreign words, we need to indicate the
  language, not just the spelling"):** the 14 clips (banana and mug in 7 languages) have an English accent on the foreign words. Cause: Cloudflare's Gemini
  TTS accepts only `text`, `voice`, `temperature`, `topP`, `topK`, `maxOutputTokens`, `stopSequences` (no language field; developers.cloudflare.com/ai/models/
  google/gemini-3.8-flash-tts) and detects the language from the words, and a single word gives it nothing. This affects every spoken name in the game, not
  only the household ones. **Fixed and approved by ear (Dan, 2026-11-03: "perfect approved", English and Spanish through the real route):** a short word in the SAME
  language is said first ("Mira. <short pause> cuchara.") so the model recognises the language and uses a native accent, and `cutLeadIn` then cuts the
  lead-in out of the audio (the longest quiet gap of at least 0.3 s; a clip with no such gap is left whole), so the clip is still only the name.
  `LEAD_IN` in `worker/voice.ts`: es "Mira.", fr "Regarde.", de "Schau.", it "Guarda.", pt "Olha."; **none for English** (the default accent) **and none for
  Turkish** (Dan listened to both and preferred the bare word). It applies to every spoken name in the game (props, parts, household, signed Forge words), the
  cache version is now v2 so the English-accent clips are never served, and the order is lead-in cut, edge trim, level. Probe numbers: the gap after the
  lead-in was 0.5 to 1.1 s in 24 of 24 clips, against under 0.3 s inside a word. **Heard and approved:** English and Spanish (7 pairs). **Not yet heard through
  the final route:** French, German, Italian and Portuguese (their lead-ins were chosen from the earlier set-1 listen), and whether the 22 same-spelling nouns
  could go back to clips now that Italian and Portuguese have lead-ins (they used the device voice at that point). **Dan, 2026-11-03:** happy with the approach, no need to sample the other languages; the full voice run is deferred until the first deploy. **No phone voice (Dan, 2026-11-03: "no phone use (google/gemini-3.8-flash-lite-tts) for everything in the game"):** with the lead-ins none of the 22 same-spelling texts is still ambiguous (no text is shared by English and Turkish), so all 427 names are clips and the device-voice rule and its helper are removed; `sayObject` (`src/lib/propVoice.ts`) plays the Gemini clip and nothing else, and `speakPhrase` is deleted, so a failed or missing clip means the caption alone and no speech (the server is left alone for a minute after a failure). A test makes any use of the phone's speech for a name fail. **Scene prompts (Dan, 2026-11-03: "1 yes all", then "we want to use google tts too"; listened to 5 sample clips: "perfect"):** the Carousel's spoken prompts are on the Gemini voice too, so nothing in the game uses the phone's speech. They were free strings made at run time, so they became a closed list: `src/lib/scenePrompts.json` (83 lines, `{id, text}`), made from the real scene code by `scripts/scene-prompts.ts` (`--check` fails when the file drifts from the code, `--list` shows which scene says each line; run it after changing any spoken line in `level2Scene.ts`, `level2Recipes.ts` or `learnRungs.ts`, then commit the JSON). The id is an 8-hex FNV-1a of the text (`src/lib/scenePromptId.ts`), so a reworded line is a new id and a new clip. `GET /api/voice?s=<id>` (`worker/voice.ts`) is English only, takes nothing else with it, and refuses an id that is not in the list before any cache read or model call; the clip is levelled like every other clip. `say()` and `stopSay()` in `runtime/audio.ts` now call `sayPrompt()` and `stopPrompt()` (`src/lib/promptVoice.ts`): a text that is not in the list is not spoken (and a console warning in development names it), a failed clip means silence for 60 s (its own backoff, apart from the names'), and the on-screen toast, which always shows, carries the line. `tests/no-phone-voice.test.ts` fails if any source file under `src/`, `worker/`, `shared/` or `parts/kip/viewer` uses `speechSynthesis`. The full prewarm (`npx tsx scripts/prewarm-voice.ts <base url>`) now includes these lines (about 1,084 clips in all); deferred by Dan until it is wanted. **Checked:** 563 tests in 25 files, `tsc` clean, `scripts/scene-prompts.ts --check` ok, trail e2e 160/160, mutation round 32/32; 5 real clips listened to. **Not verified:** a played scene requesting `/api/voice?s=` in a browser, and iPhone Safari autoplay for a prompt that fires after the toy has walked (it fails silently and the toast still shows; the fix would be an audio-unlock clip on the first touch).
- **The offer when the helper is offline** (answered, Dan's question 4): offer the 3D item for transport failures only (`offline`, `helper_off`, `busy`,
  `slow_down`), by the child's own word, inside the child's band, with its own reason (`word_only`) and its own sentence that does not mention tracing
  ("You said spoon. Here is the 3D wooden spoon."); never for the child's own faults (`invalid_input`, `too_large`).
- **The scan is never required, and never blocks.** The game has no camera (`getUserMedia` appears nowhere in `src/`; the photo path is the Kip
  viewer's), the one real photo fails the 0.95 bar, and the matcher is strict on words. A grown-up confirm is the only way to complete "Find it"; a
  scan may only ever add to a completion, never gate one or contradict a grown-up. The 0.95 bar stays: fidelity answers "is this outline safe to cut
  along?", the word alone picks the item, and 0.924 is evidence the trace needs work, not that the bar is too high.
- **The drop shape.** A household drop needs a new goal kind (it names an item; a tool weekend names a count), and its four band variants are
  **template-built**, as the phase-2 template drops were, not 240 hand-written briefs.
- **What it needs built:** the 60 household drops (the rotation rule above, the goal kind and the templates, the item's picture on the sheet and on the
  confirm); the library build's pictures (**built**: `pictures.json`, `group`, `confusableWith`, household-library-spec.md); `completeGarageHousehold`, `garageFound` and the roof mark; "Who's that shape?"
  (small, pure logic from the catalog, tested like the other Garage logic: `src/lib/garageHousehold.ts` beside `src/lib/garage.ts`); the grown-up confirm
  names the item; the word-only offer. Later, if the game gets its own camera: a scan that matches the item as an additional route, never the only one.
- **Launch drops (Phase 1)** stay as specified: the household drops are Phase 2 content.

### Household weekends: what was built (2026-11-03, a forked agent; checked by the main session)

`src/lib/garageHousehold.ts` (pure logic), `garageHouseholdData.ts` (the catalog bundled so it works offline, the pictures loaded lazily),
`src/lib/garage.ts` (`completeGarageHousehold`, `garageTrophyCounts`, the household goal kind), `progression.ts` (`garageFound`), the roof
(`mapCards.ts`, `ExplorerNodeArt.tsx`, `ExplorerMap.tsx`), `HouseholdWeekend.tsx` (the pictures, "Who's that shape?" and the grown-up's "We found it"),
`GarageSheet.tsx`, `GrownUpsSheet.tsx`, `GameCanvas.tsx`, `index.css`; tests `tests/garage-household.test.ts` (66) and `garage-household-ui.test.ts` (21);
`scripts/e2e-trail.mjs` gains three household scenarios.

- **Build Days.** The weekend whose Friday has day-of-month 1 to 7 is a Build Day, **but weekends before launch are all Build Days** (the pinned
  pre-launch scenarios expect build drops); household numbering starts at 0 on 2026-11-13, an orange. **From launch the Build Days run through the build
  drops month by month** (`buildDropForWeekend`, Dan 2026-11-03 "go" on my suggestion): the launch weekend gets the first drop, then one per month, so every
  drop comes back after exactly twelve Build Days (the per-weekend `dropForWeekend` counted weekends, and months have 4 or 5, so a drop could return after as
  few as 3). `dropForWeekend` itself is unchanged and still serves the weekends before launch and any caller that gives no household drop.
- **Household rotation.** Every 8th household weekend is a tool weekend. The others follow a hand-written order of 54 items, round-robin by group with the
  simple ones first, the six tools excluded (they are the tool weekends); items added later are appended. An age gate substitutes the next allowed item
  in the order, and the youngest only get simple items.
- **Tool jobs.** The youngest see the toy tool as the picture ("ask a grown-up to show you a tool"); early finds 1 of five tools, mid 2, older 3 of the
  six; the pool comes from the `garage` tag and `minBand`.
- **Shape game** (`garageHousehold.ts`, a pure state machine): 2, 3, 4, 4 pictures and 2, 2, 3, 3 right in a row; wrong pictures from the same group first,
  never look-alikes, never above the child's band, only simple items for the youngest, topped up from the rest of the allowed pool. The youngest retry the
  same shape and keep their streak; the older groups restart the streak with a different item. The miss count never resets: colours appear after 3 misses,
  and after 5 the name and the highlighted right picture, and these stay on. A property test shows no run of wrong taps can finish it; tapping the
  highlighted picture finishes it in at most `need` taps (so after 5 misses a skip takes 2 or 3 taps, against about 8 for a child who only guesses).
  Speech is the no-op `speakName` (called through `shapeSpeech`), to be wired to `speakHouseholdName`.
- **Completion.** `completeGarageHousehold(found | skipped)` refuses Build Days and a second completion. Both modes pay 40 XP and stamp the Workshop Day;
  only a find earns the play-time minutes (`garage.<weekendKey>`) and is recorded in `garageFound`. A find is written to `garageRealByDay`, so a later
  same-day "We built it" pays 0 (a skip does not block it), and never touches `completedChoresByDay`, so it never uses the 25 XP/day ceiling (a routine the
  same day still pays 25). `completeGarageReal` refuses a weekend that was found. A find needs the real-life leg switched on; a skip does not. Preview
  weekends save nothing for either.
- **Roof.** A finished household weekend that is not in `garageFound` is a hollow star; build weekends and pre-launch weekends are gold. Gold stars are drawn
  first, up to four shown with "+N" for the rest; the Grown-Ups sheet shows the item's picture on the household confirm, which replaces "We built it" on
  household weekends.
- **Verified.** Main session re-ran `tests/garage-household*.test.ts` and `tests/garage.test.ts` (143 tests) and `tsc` (clean apart from another lane's
  `tests/yard-vehicles.test.ts`). The agent's runs: 220 tests across the garage, household, progression, daily quest, scavenger and explorer files (the
  explorer-art tests need a 120 s timeout while the machine is loaded); `node scripts/e2e-trail.mjs` 160 of 160 on Metal, including the three new
  scenarios, with screenshots looked at (the shape game on one screen with all four pictures, the hint state, the done sheet, a roof close-up with a hollow
  star); a mutation round of 81 single-line breakages, all killed (five survivors at first got tests). Trap: a mutation run that overlaps a browser run
  reloads the app through Vite and breaks the browser run.
- **Not verified.** The grown-up's "We found it" in a browser (behind the parent gate: unit and markup tests only); a real phone; the voice (no-op hook); a
  production `vite build` was untested by the agent; the main session then ran it in an isolated copy of the committed tree (2026-11-03): exit 0 in 42 s, the
  pictures file is its own lazy 72 KB chunk, the Garage code is in the main chunk. (Run `npm run build` again before a deploy: other lanes' work lands too.)
- **Decided by Dan (2026-11-03, "go" on my suggestions) and built.** The month-by-month Build Day count (above). **Skips are stored explicitly**
  (`garageSkipped`, a subset of `garageDone`, never overlapping `garageFound`; a weekend one device found and another skipped merges as found), and
  `garageTrophyCounts(done, found, skipped?)` draws a hollow star as exactly a weekend in that list when it is given. **The roof now reads it:** `GameCanvas.tsx` passes `progression.garageSkipped` as the third argument (a wiring test pins the call; the parent-controls lane's edits to that file had been committed first). **Decided as they were:** a skip cannot
  be upgraded to a find later (it would pay minutes after the fact); a find needs the real-life leg switched on (a family that turned real-life tasks off
  can only skip).

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
- **Built (phase 2):** parent controls (drop switch, days), the real-life leg
  and its grown-up confirm (`garageRealByDay`), roof trophies, a loaner
  label in Build, and twelve drops. Still not built: the 3D loaner on the
  sheet.
- **Out of scope for phase 2:** the warm-welcome decision, the grace length,
  the household equip question.

Verified: `tests/garage.test.ts` (53+; window, rotation, every goal reachable
with parts a child has open, checks, completion, card order, device settings,
switches, real-life leg, twelve-drop catalog) and `npm run e2e:trail`
scenario `garage-phase2` (trophies, Build-it-for-real link, loaner tag,
drop switch off; the Grown-Ups confirm is unit-covered, the gate bootstrap
is too heavy for the shared suite)
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

## Phase 2 — built

- **Parent controls** (Grown-Ups sheet, Garage section, behind the existing
  gate): the weekend-drop switch, drop days (Fri/Sat/Sun chips, one stays
  on), and the real-life leg switch. Kept in `progression:v1`
  (`garageDrop`, `garageDays`, `garageRealLife`); switches merge like the
  age band, days merge by union, all three survive an XP reset. The Garage
  place itself is never switched off.
- **Real-life leg**: after the in-app drop, "Build it for real" opens the
  Workshop page with the toy as dressed now (the Kip demo URL contract);
  the grown-up confirms "We built it" in the Grown-Ups Garage section.
  Pays +10 XP once per weekend, only when no real-life XP was earned yet
  that day (shared +25 XP/day ceiling); always stamps a Workshop Day.
- **Roof trophies**: one star per finished weekend on the map's Garage
  (four, then a count).
- **Loaner label**: loan parts wear a "Loaner" tag in Build while the drop
  is live.
- **Twelve drops**: the launch three keep their rotation slots; nine more
  appended (three per kind from the newPart/idea/remix templates).

## Still open

- The household weekends: the skip game's numbers (pictures and streak per group) and its reward (no play-time minutes), the household drops
  and the front pictures to build, and the Garage's tool-job counting (household-library-spec.md; the age rule and its cut-offs are decided).
- The 10-minute Garage grace (length, and whether it should also apply on
  weekday drops).
- Time-of-day look for the Garage and the worlds: see "Time of day" below.

## Time of day

Specified in [environment-spec.md](environment-spec.md): two looks (day and
night, the same scene with the lights on), one shared clock, a continuous and
weather-aware stretch after the hackathon. The Garage reads that clock so its
door lights come on at night.
