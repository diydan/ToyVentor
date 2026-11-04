# Carousel + Little ones — real-phone / real-child run sheet

Companion to [carousel-modes-ladders-spec.md](carousel-modes-ladders-spec.md) §13.3 (real-phone gate) and §13.4 (child targets), which hold the rules. Targets are copied from [play-design-spec.md](play-design-spec.md) "Quality bar and playtest measures". This sheet is values only: what the robot measured, what to set up, blanks for what people measure. Nothing in a blank has been run. Written 2026-11-03; C4 does not start until this is filled in. Dan runs the pass himself (Q6), so the bands and the number of children are his call.

## Robot baseline (measured 2026-11-03)

Headless Chrome, 390 x 844 mobile, real touch events (`touchStart`/`touchEnd`), fresh profile each run, dev server and `npm run build` + `vite preview`. Zero page exceptions in all three runs. `npm run build` (which runs `tsc --noEmit` first) passed on the same tree.

| Fact | Measured |
| --- | --- |
| Stage to a started level, age already set, **before** the Map button | **3 taps**: More `34 x 36 px` -> Map `208 x 44 px` -> centred card `146 x 191 px`. Spec target is `<= 2` taps (§13.4); target size for bands 0-1 is `>= 96 px` (§11.4). More and Map are under it. |
| Same, **after** the Map button (added the same day) | **2 taps**: gold Map button on the stage, `96 x 96 px` for bands 0-1 (a `59 x 63 px` pill at band 4) -> centred card. Verified with real touch events, 390 x 844. The 3-tap route still works. |
| Stage to a started level, fresh device (age unset) | Carousel opens centred on the grown-up card "Who is playing? A grown-up sets the age". Tapping it opens the press-and-hold 1.2 s gate, then the PIN pad. A child cannot start a level on a fresh device. |
| Card tap to first prompt (age set, band 2-3) | "Little ones" card starts Pop the bubbles at once; toast "2 bubbles to pop. Tap the biggest one." |
| Card sizes | All 14 cards `130-146 px` wide, `147-191 px` tall (all above 96 px). |
| Landscape (844 x 390), **before** | The carousel sheet was clipped at the bottom (card titles cut off). Cause: the stage has a `440 px` minimum height, taller than a sideways phone (390 px minus the top bar), and its host clips it, so the bottom 100 px of the whole stage, including the in-game controls, was off screen. |
| Landscape (844 x 390), **after** | The stage shrinks to the screen (short landscape only). The Map is the trail map with a card strip along the bottom (compact cards `176 x 101 px`, title and pips fully on screen). |
| Map screen, **2026-11-04 (Dan's change, replaces the carousel/trail split)** | One screen at every age and in both orientations: the trail map with a mini carousel strip along the bottom (a screenshot of each level on its card, starting at the left edge). Measured at 390 x 844: first card `148 px` from the left gutter `12 px`, strip `233 px` tall; top buttons `48 px`. No `Cards` chip. Predictions below about "the centred card" now mean the first (suggested) card in the strip. |
| Mission panel, landscape | Pop's mission panel is `204 px` of the `340 px` stage (60%) and hides most of the world; its buttons are reachable now. Not changed: run Little ones in portrait. Spec §11.4 says the panel on scene levels is only visually hidden; on Pop it is visible in both orientations. |

Not run today: Tidy one thing was not replayed in a scene run (it shares the carry core with Pack the car, which was). Dev server only: wrangler warns the AI bindings hit remote resources, so prop-voice taps may incur real TTS charges (production preview not checked for this).

## Predictions (written before any session; not evidence)

| Prediction | Basis | Observed |
| --- | --- | --- |
| A 2-3 year old finds the gold Map button on the stage without help | `96 x 96 px`, top right, high contrast; the old route (`34 x 36 px` More) was the worry | |
| Once the carousel is open, the centred card gets tapped without help | card `146 x 191 px`, Kip hovers over it | |
| Misses on Pop are 0-1 | two markers, wrong tap hops the marker and cues the right one at ~0.8 s | |

## Setup (observer, before the child sits down)

1. Serve the production build: `npx vite build && rm -f dist/toyventor/.dev.vars && npm run preview -- --host --port 5242`. (`npm run build` also typechecks and currently stops on errors in `tests/yard-vehicles.test.ts`, the yard lane's file.) The phone, on the same Wi-Fi, opens `http://<Mac LAN IP>:5242/` (`ipconfig getifaddr en0`; `192.168.178.91` on 2026-11-03). Stop the server afterwards.
2. Write down the device: model ______ OS ______ browser ______ ringer/silent switch ______ volume ______.
3. Fresh site data (or a private tab) for every child: progress lives in `localStorage` on that origin.
4. Grown-up sets the age out of the child's sight: gear (hold 1.2 s) -> PIN -> Age -> the child's band -> close. Leave the stage on Garden.
5. Do not mention the Map button. The first thing the child hears is: "Here is a toy game. Can you find something to play?"
6. Start the stopwatch when the phone changes hands. Screen recording on if the parent agrees. Record an ID and age only, no names.

## Device checks (adult, §13.3, before any child)

| Check | Looks like a pass | Result |
| --- | --- | --- |
| Touch drag in the world (§11.2) | toy follows the finger; page does not scroll, zoom or pull-to-refresh | |
| Audio unlock | first marker tap makes sound; prompt is spoken, or toast-only (write which) | |
| Carousel fling | a swipe across the 14 cards settles with one card centred; a fling never opens a card | |
| Tap vs swipe | tapping the centred card starts the run | |
| Rotate to landscape mid-level | level stays playable, no stuck panel | |
| Safe areas | dock and carousel clear of the notch and home bar | |
| Background and return | app switch and back; run carries on | |
| 5 minutes of play | no heat or visible jank (notes) | |

## Child session

Child ID ______ age ______ band set ______ date ______ observer ______

Entry (the `<= 2` taps target, §13.4):

| Measure | Value |
| --- | --- |
| Taps the child made from the stage to a started level | |
| Of those, taps the adult made or pointed at | |
| Found the Map button unprompted (y/n) | |
| Used More -> Map instead (y/n) | |
| Seconds from hand-over to a started level | |

Help rule: anything the observer says or touches after hand-over counts as one help; in-app hints (the wrong-tap cue) count separately. Say nothing for 15 s of no progress, then one neutral prompt ("What do you think that does?") and log it.

Rungs run in order (Little ones is a sequence, so each finish rolls into the next). Stop when the child is done; mark the rest `not reached`.

| Rung (what success looks like) | First success (s) | Misses | Help (observer / in-app) | Finished | Stuck (s) | Fun 1-3 | Difficulty | Explains back | Plays again |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pop the bubbles (BIG bubble, then tiny one) | | | | | | | | | |
| Animal friends (cow, bird, frog, in order) | | | | | | | | | |
| Pack the car (suitcase to trunk, teddy to seat, ball to roof or trunk) | | | | | | | | | |
| Peekaboo (bush, then bunny) | | | | | | | | | |
| Go, car, go! (three road dots) | | | | | | | | | |
| Tidy one thing (book to shelf, sock to laundry) | | | | | | | | | |

Difficulty: too easy / just right / too hard. Explains back: ask "why did that work?" once at the end of a rung; write the child's words. Plays again: replays or picks the next level unprompted.

## Targets (ages 2 to 4, from play-design)

| Measure | Target | Result across children |
| --- | --- | --- |
| Time to first success | under 15 s | |
| Finishes the level | 9 of 10 children | |
| Misses before success | 2 or fewer on average | |
| Help needed | under 1 per round | |
| Fun | 2.5 or more on average | |
| Difficulty | 70% or more "just right" | |
| Explains it back | says the idea in their own words ("balloons go up") | |
| Plays again | 1 in 2 children | |
| Stuck | never | |
| Playable level from the stage in `<= 2` taps, no reading (carousel target) | `<= 2` | |

The percentages assume about 10 children per band. With fewer, record and read them as directional; how many to run is Q6.

## Stop rules

- Child upset, tired or asks to stop: stop, write the reason.
- Any crash, blank screen or frozen panel: stop, note the rung and what the child last tapped, keep the recording.
- Never tell a child they were wrong; the app's copy does not either ("does not fit", hints).

## Decisions this sheet feeds

- Dan decided on 2026-11-03 to promote Map to a stage button without waiting for the test (Q1). The session now checks whether children find it, and whether the carousel (portrait) and trail map (landscape) split makes sense to them.
- Time to first success over 15 s on a rung: that rung's prompt or marker size is the fix, not the child.
- A rung with a finish rate under target: fix before C4 starts; C4 reuses the same visit and carry sessions.
