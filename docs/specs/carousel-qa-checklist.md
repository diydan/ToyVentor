# Carousel + Little ones — QA checklist (real phone, real child)

Quick tick-box version of the pass in [carousel-playtest-runsheet.md](carousel-playtest-runsheet.md) (blanks, targets, robot baseline) and [carousel-modes-ladders-spec.md](carousel-modes-ladders-spec.md) §13.3-§13.4 (rules). Written 2026-11-03. Nothing below has been run by a person.

## Setup (2 min)

- [ ] On the Mac: `npx vite build && rm -f dist/toyventor/.dev.vars && npm run preview -- --host --port 5242`. (`npm run build` also typechecks, and currently stops on errors in `tests/yard-vehicles.test.ts`, which is the yard lane's file, so build with `npx vite build` until that is fixed.)
- [ ] On the phone, same Wi-Fi: open `http://192.168.178.91:5242/`. If it will not load, get the Mac's address with `ipconfig getifaddr en0`.
- [ ] Use a private tab so each run starts fresh (progress lives in `localStorage`).
- [ ] Hold the gear for 1.2 s, enter the PIN, set Age to the child's band (2-3 for Little ones), close back to the stage.
- [ ] Note the device: model ______ OS ______ browser ______ silent switch ______ volume ______.
- [ ] Stop the preview server when done.

## Phone checks (adult, about 5 min)

- [ ] Dragging in the world moves Kip; the page does not scroll, zoom or pull-to-refresh.
- [ ] The gold **Map** button (top right of the stage, 96 x 96 px at ages 2-4) opens the carousel; tapping the centred Little ones card starts Pop. That is **2 taps**. Note whether the child finds the button unprompted ______.
- [ ] The old route still works: More -> Map -> card (3 taps).
- [ ] Swiping the carousel settles with one card centred; a swipe never opens a card; a tap on the centred card does.
- [ ] The first marker tap makes sound and the prompt is spoken. Write which: spoken / toast only ______.
- [ ] In Pop, tapping the tiny bubble first makes it hop and shows a hint; the copy never says "wrong".
- [ ] Finishing Pop rolls into Animal friends, and the pips fill.
- [ ] All six rungs run in order, then it returns to the Map with the pips updated:
  - Pop the bubbles: BIG bubble, then tiny one.
  - Animal friends: cow, bird, frog.
  - Pack the car: suitcase to trunk, teddy to seat, ball to roof or trunk.
  - Peekaboo: bush, then bunny.
  - Go, car, go!: three road dots.
  - Tidy one thing: book to shelf, sock to laundry (not replayed in a scene run by the robot).
- [ ] Rotate (phone sideways) with the Map closed: the whole stage fits, including the bottom controls (Dash, Whirl, Glow pulse, Shove).
- [ ] Map button in landscape opens the full-screen **trail map**; the Cards chip then shows the compact carousel with the card, title and pips fully on screen.
- [ ] Turn the phone while the Map is open: portrait shows the carousel, landscape the trail map, and turning back returns to the carousel.
- [ ] Start Pop sideways and see how playable it is (see Known: the panel is big in landscape) ______.
- [ ] The Trail map chip opens the full-screen map, Go! starts a level, Cards goes back.
- [ ] Backgrounding the app mid-level and returning keeps the run going.
- [ ] Changing the age band in grown-up settings needs the PIN and does not wipe stars.
- [ ] 5 minutes of play: no heat or visible jank (notes) ______.

## With a child (if one is available)

- [ ] Say only: "Can you find something to play?" Do not mention More. Start the stopwatch when the phone changes hands.
- [ ] Say nothing for 15 s of no progress; then one neutral prompt ("What do you think that does?") and log it as a help.
- [ ] Log per child (blanks in the run sheet): taps the child made, taps you made, seconds to a started level, seconds to first success, misses, help (you / in-app), finished y/n, fun 1-3, difficulty, explains back, plays again. Use an ID and age only, no names.
- [ ] Stop if the child is upset or tired; write the reason.
- [ ] On any crash, blank screen or frozen panel: stop, note the rung and the last tap, keep the recording.

## Known going in

- Changed 2026-11-03 after the robot baseline: a stage **Map button** (96 x 96 px for bands 0-1, a smaller pill for older bands), so stage to level is 2 taps with age set (More -> Map -> card is still 3). The Map opens as the carousel in portrait and as the full-screen trail map on a phone held sideways (short landscape screens); an unset age keeps the carousel in both; older bands (7-9 up) open the trail map in both.
- Changed with it: the stage had a `440 px` minimum height that a sideways phone (390 px) clipped, cutting off the bottom of the carousel and of the in-game controls. It now shrinks to the screen on short landscape screens, and the carousel cards are compacted there (`100 px` tall, still above the 96 px bar).
- On a fresh device the carousel centres on the grown-up "Who is playing?" card behind the press-and-hold gate, so a grown-up must set the age first.
- Sideways, the mission panel is about 60% of the stage (204 of 340 px) and hides most of the Pop markers, so the world is hard to tap. Run the Little ones levels in portrait; landscape is for the trail map. This was not changed.
- The spec (§11.4) says the text mission panel on tap-the-scene levels is only visually hidden. On Pop it is visible, in both orientations.
- Tapping a prop to hear its name uses the remote AI voice service and may incur charges. Skip it or accept the cost.
- Not done: the full-screen map with a compact carousel strip on top of it (design in the session notes, later).
