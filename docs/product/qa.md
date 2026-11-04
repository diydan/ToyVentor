# QA: how to test ToyVentor (one document)

Written 2026-11-04 by merging every QA and testing document in the repo. Read top to bottom on deploy day; each part says who runs it (**robot** = a command, **you** = a person with a browser or phone).

**Honest status.** Parts 1 and 3 are commands that exist and have run before. No document records a person running parts 4 to 6 on the live site or a real phone; the carousel docs say outright that nothing in them has been run by a person. Numbers quoted from other documents were true at the commit that wrote them; rerun for today's. The one result checked by the author of this merge: the room-photo level (part 4, check 9) passed end to end on a local Worker and local D1 on 2026-11-04 with a staged photo (10 boxes, about 3 s, Checks 8/8). That says nothing about the deployed Worker or a real phone.

| Part | What | Who | Time |
| --- | --- | --- | --- |
| 1 | Before deploy: gates, clean export, secrets | robot + you | 15 to 30 min |
| 2 | Deploy | you | 5 min |
| 3 | Live smoke, read-only | robot | 2 min |
| 4 | Live by hand: the demo run, the Worker, the cache | you (desktop) | 20 min |
| 5 | Real phone, adult | you (phone) | 15 min |
| 6 | Real child session | you + a child | 15 min each |
| 7 | Expected behaviour (do not log as bugs) | read | 2 min |
| 8 | Not covered here | read | 1 min |
| 9 | Results log | you | as you go |

---

## 1. Before deploy

A deploy is only as complete as git is: `public/kip/` is served straight from git, and a file that exists on a dev machine but is gitignored works locally and 404s in production ([deploy-checklist.md](deploy-checklist.md) holds the history). Do not deploy the working tree. Deploy a clean export of the commit.

**1.1 Robot gates, from the repo root** (`docs/specs/carousel-modes-ladders-spec.md` section 13.3: all five green, no "pre-existing" claims):

```
npm run validate && npm run typecheck && npm test && npm run build && npm run preflight
```

- `npm run build` runs `tsc --noEmit` first. It once failed on 53 strict-mode errors in two test files; the deploy checklist records the fix. If it fails now, that is the finding, not a reason to skip.
- `npm run preflight` fails loudly on placeholder states (all-zero D1 id, missing `.dev.vars` key) and prints the Wrangler commands to run by hand.
- Other agent sessions edit this tree. If a failure is in a file you did not touch, say whose it is; do not fix it in someone else's lane.

**1.2 Commit what ships, nothing else.** `git status` must show no file you want in production as modified or untracked. `git archive HEAD` contains committed files only, so export after your last commit; an earlier export proves nothing about what you ship.

**1.3 Cache name.** If anything under `public/kip/` changed since the last deploy, bump `CACHE` in `public/sw.js` (it is `toyventor-v4` now; next is `v5`) and commit. The service worker serves `/kip/` cache-first and those URLs do not change when their bytes do, so without the bump returning visitors keep old copies.

**1.4 Clean export, build, load every bench** (the only proof the commit you ship loads):

```
E=$(mktemp -d) && git archive HEAD | tar -x -C "$E" && ln -s "$PWD/node_modules" "$E/node_modules"
(cd "$E" && npm run build)                          # expect exit 0
E2E_GPU=metal node scripts/check-clean-export.mjs "$E"   # expect: clean export loads: every bench ready, no missing file
```

A syntax error in a served module breaks a bench and nothing else notices (this happened on 2026-11-04: the Kip tab said "Could not load Kip"). `tests/served-modules-syntax.test.ts` parses every module now, but the clean-export load is the proof.

**1.5 Remote Worker, read-only** (needs your `wrangler login`):

```
npx wrangler d1 migrations list DB --remote     # nothing pending (0001_ownership.sql, 0002_parent_time.sql)
npx wrangler secret list
```

What the Worker reads (from `worker/*.ts`, 2026-11-04) and what each missing one does:

| Variable | If missing |
| --- | --- |
| `MODEL_API_KEY` or `META_MODEL_API_KEY`, and `META_MODEL_API_URL` | Hosted model off: scan, Create, Describe, Make from words all answer "not configured" and degrade |
| `PARENT_GATE_SECRET` | **Set it.** The gate no longer falls back to the model key (commit `af9850d`); with none it uses a random secret stored in D1, and proofs in flight when that changed ended once |
| `VOICE_SIGNING_KEY` (16+ chars) | Spoken names are not issued; `AI` binding (in `wrangler.jsonc`) serves the voice |
| `MODEL_BACKEND` (and `TEXT_BACKEND`, `SEGMENT_BACKEND`, ...) | Unset means `hosted` (`DEFAULT_MODE` in `worker/modelBackend.ts`). `self` or `off` makes the matching route answer "not configured". Must **not** be `self` for the hosted demo |
| `SELFIE_CLOUD=on` | Unset: Smart face is off (expected on production) |
| `FORGE_OPTIMIZER_URL`, `FORGE_OPTIMIZER_TOKEN` | Unset: Make from words answers "not turned on here" (expected: the maker daemon runs on the author's Mac, not on the deployed site) |
| `FORGE_MAKE_REQUIRES_PROOF` | Unset: making a part needs no grown-up proof; printing and saving always do |
| `THEME_SONG=on` (+ `MUREKA_API_KEY`, `THEME_SONG_MAX_STARTS`) | Unset: no theme songs. On means real spend (about $0.04 a song, capped per Worker run) |

**1.6 Decide the showcase switch** ([parent-controls-off-spec.md](../specs/parent-controls-off-spec.md)). A normal build keeps the grown-up checks on. `VITE_PARENT_CONTROLS=off npm run build` ships a build with the checks and limits off and Workshop downloads on: only for a deployment that never holds a real child's photo. Photo-upload gates (selfie cloud, room scan) stay on in both.

## 2. Deploy

Deploy from the export, not the working tree: `(cd "$E" && npx wrangler deploy)`. This repeats the build and ships. `.dev.vars` is not in a git export.

## 3. Live smoke (robot, read-only)

```
E2E_GPU=metal node scripts/smoke-live.mjs https://toyventor.com
```

Replace the URL with the one you deployed to (`wrangler.jsonc` routes `toyventor.com` and `www.toyventor.com`; `workers.dev` is also on). It blocks every `/api` request, so it creates no rows and makes no model calls. It checks that `/sw.js` has the commit's cache name, that 101 served files are **byte-identical to the commit** (a missing file on this site answers 200 with the HTML shell, so a status check would pass a broken deploy), and that the game plus the Kip, Truck (pro and mech) and Yard benches load with no request answered by the shell. `--no-browser` runs only the byte comparison (seconds); `--commit <rev>` checks a commit other than HEAD.

Then, by hand: `curl -s https://toyventor.com/api/health`. Expected on production, from the code and section 1.5 (confirm, do not assume):

```
ok:true  service:"toyventor"  samConfigured:true  museConfigured:true
selfieCloud:false  forgeOptimizerConfigured:false  voiceConfigured:true
```

`samConfigured:false` means no hosted key reached the Worker: stop, scans and room photos will say "not switched on".

## 4. Live by hand (desktop browser)

Use a private window so each run starts fresh (progress is in `localStorage`). Open the console; any red error is a finding.

**4.1 The 90-second demo run** ([demo-script.md](demo-script.md)). Time it.

| s | Step | Pass |
| --- | --- | --- |
| 0 to 10 | Scan or choose a starter toy | Toy on the stage |
| 10 to 25 | Equip two upgrades | Stats move |
| 25 to 40 | Complete the garden mission | Mission solves, XP appears |
| 40 to 55 | Open the daily pack, equip the pull | One claim per day: a second claim says so |
| 55 to 70 | Reveal the Character Card, hear its theme | Card shows, sound plays |
| 70 to 90 | Open 3D Print, export the support-free STL | File downloads (the demo script also says to confirm print gating before recording) |

Backups if a step fails (say so, do not improvise): no service: cached build; camera blocked: Red Racer or Kip; scan finds nothing: retry, enter name/kind/size, or pick a seed; part will not fit: show the failed check and suggest repair or reprint.

**4.2 Grown-up gate on the live Worker** (the Worker, D1 and `PARENT_GATE_SECRET` are only proven live by doing this).
- [ ] Hold the gear 1.2 s. A fresh device gets a multiplication question first ("First-time setup"), then asks you to set a 4-tap PIN.
- [ ] Close, reopen, hold again: now the PIN pad, not the question. A wrong PIN says how many tries remain (4 after the first wrong one on the local Worker); running out gives a cooldown.
- [ ] Proofs last **5 minutes** (every-time mode) or **10 minutes** (sitting mode) (were 2 and 5 until 2026-11-04; they apply to proofs issued after the deploy). Anything photo-related started after that says "needs a live grown-up sign-in". Re-open Grown-ups and try again.

**4.3 Room photo level** (Feature 3). Needs the gate above, Demo Mode on, the parent-controls toggle left **on** (turning it off makes the photo button refuse, by design).
- [ ] Grown-ups, Demo Mode: On, tap **Room Photo Level**, choose a side-on photo of 3 to 6 floor items spread left to right with the floor line visible.
- [ ] Editor opens within about 15 s (local run: 3 to 5 s). Theme is Toy Room, **Checks 8/8**.
- [ ] Props are in the photo's left-to-right order, and each is the thing you photographed. A stack of books becomes one `books` prop (the extra boxes are dropped on purpose).
- [ ] **Play it** runs. All 5 hiding spots reachable.
- [ ] Blank wall: the sheet stays open with "I could not spot any room props in that photo".
- [ ] Wi-Fi off mid-upload: "Could not read that photo just now".
- [ ] Six photos inside a minute from one device: the sixth is "Too many room photos just now" (limit 5 per minute per device, 10 per IP; was 3 and 6 until 2026-11-04; the limiter is per Worker isolate, so on the live site it may not trip reliably: spec question Q9).
- Record counts, not rates: "4 of 5 props right, order right" ([sam-physical-to-digital-spec.md](../specs/sam-physical-to-digital-spec.md) section 9).

**4.4 Other Worker routes**
- [ ] Create mode (Muse Spark) and Describe and Build return a result; with the hosted key missing they degrade to the offline parser or a picked recipe.
- [ ] Make from words (Kip Tools) says it is not turned on here. That is correct for the deployed site; say so in the write-up, do not show it.
- [ ] Smart face in the Kip bench is off (selfie cloud unset). The selfie sticker asks a grown-up before it saves.
- [ ] Tap a prop to hear its name: the clip plays. It uses the remote AI voice service and may incur charges; skip or accept the cost.

**4.5 Returning visitor.** Open the live site in a browser that visited before the deploy. The new cache must have taken: DevTools, Application, Cache Storage shows `toyventor-v4` (or whatever you bumped to) and no older one; the Kip page runs the new code.

**4.6 If you record from the Mac instead of the live site** ([forge-ai-spec.md](../specs/forge-ai-spec.md) pre-recording list, 2026-11-04):
1. `.dev.vars` must **not** contain `MODEL_BACKEND=self` or `TEXT_BACKEND=self`.
2. Set `PARENT_GATE_SECRET` in `.dev.vars`, or run `npm run db:migrate:local`.
3. Start the maker daemon (`npm run forge:optimizer`) and your own dev server on a fixed port (`npx vite --port <free> --strictPort`; another session may own 5173 and it can serve stale code). `/api/health` must say `forgeOptimizerConfigured: true`.
4. Make three wishes by hand (a hat, a head, one in Spanish): each reaches "Your part is ready!", wears, changes colour, speaks and survives a reload.
5. Make another and type a wish the filters must refuse (a knife, and "bir bıçak"): you get the calm message. This also proves the word lists in the Workers runtime.
6. Stop any other session's dev server on the same port.
7. Do not claim Glimmer is live or the default, and do not claim compliance with children's privacy law. Say once, out loud: this demo uses Meta's hosted model with adults operating it ([0008](../decisions/0008-meta-models-and-under-18-users.md)).

## 5. Real phone (adult, about 15 min)

Run it against the live site (no Mac server needed). To test a build that is not deployed: `npx vite build && rm -f dist/toyventor/.dev.vars && npm run preview -- --host --port 5242`, open `http://<Mac IP>:5242/` on the phone on the same Wi-Fi (`ipconfig getifaddr en0` for the IP), and stop the server afterwards. Use a private tab. Write down the device: model ____ OS ____ browser ____ silent switch ____ volume ____.

Setup: hold the gear 1.2 s, PIN, set Age to the child's band (2 to 3 for Little ones), close back to the stage.

**Touch and layout**
- [ ] Dragging in the world moves Kip; the page does not scroll, zoom or pull-to-refresh.
- [ ] Dock and carousel clear of the notch and home bar (safe areas).
- [ ] Rotate sideways with the Map closed: the whole stage fits, including the bottom controls (Dash, Whirl, Glow pulse, Shove).
- [ ] Backgrounding the app mid-level and returning keeps the run going.
- [ ] 5 minutes of play: no heat or visible jank. Notes: ____

**Map and carousel**
- [ ] The gold **Map** button (top right of the stage, 96 x 96 px at ages 2 to 4) opens the carousel; tapping the centred Little ones card starts Pop. That is **2 taps**. Does the child find the button unprompted? ____
- [ ] The older route still works: More, Map, card (3 taps).
- [ ] A swipe settles with one card centred and never opens a card; a tap on the centred card does.
- [ ] Landscape: the Map button opens the full-screen **trail map**; the Cards chip shows the compact carousel with card, title and pips fully on screen. Turning the phone with the Map open switches views both ways.
- [ ] Trail map: Go! starts a level, Cards goes back.
- [ ] Changing the age band in grown-up settings needs the PIN and does not wipe stars.

**Sound**
- [ ] The first marker tap makes sound and the prompt is spoken. Write which: spoken / toast only ____

**Little ones, all six rungs in order**, then it returns to the Map with pips updated. In Pop, tapping the tiny bubble first makes it hop and shows a hint; the copy never says "wrong". Finishing Pop rolls into the next rung.
- [ ] Pop the bubbles: BIG bubble, then the tiny one.
- [ ] Animal friends: cow, bird, frog.
- [ ] Pack the car: suitcase to trunk, teddy to seat, ball to roof or trunk.
- [ ] Peekaboo: bush, then bunny.
- [ ] Go, car, go!: three road dots.
- [ ] Tidy one thing: book to shelf, sock to laundry (a robot has not replayed this one in a scene run).
- [ ] Start Pop sideways and note how playable it is: ____ (the panel is big in landscape, see part 7).

**Room photo on the phone** (what the local run could not check)
- [ ] The camera opens from **Room Photo Level** (it uses the rear camera) and the iOS file picker works too.
- [ ] Real light and clutter: how many of the props came out right, and in order? ____ of ____
- [ ] Time from shutter to editor: ____ s (fail above about 15 s).

**Pick it up (the camera, in the browser and as an installed web app)** (`scripts/e2e-kip-pickup.mjs` and `scripts/e2e-game-pickup-chain.mjs` cover everything except a real camera, a real phone, the real SAM and the real naming model). Needs https, so use the live site, or `localhost` on the Mac; over plain `http://<Mac IP>` the phone says "This browser cannot open the camera here" and offers a photo, which is expected. Do it twice: once in the Safari or Chrome tab, once from the icon after "Add to Home Screen".
- [ ] Kip bench, menu, Tools, **Pick it up**: the browser asks for the camera once, and the live view fills the screen with no scrolling, clear of the notch and home bar.
- [ ] The rear camera is used (the 🔄 button appears only when there is more than one camera and switches them).
- [ ] Tap **spoon**, point at a real spoon, press the big button: the picture freezes, the camera light goes out, "Looking for the spoon…" shows, the spoon lifts off the picture and flies into Kip's hand. Time from shutter to Kip holding it: ____ s (the stood-in run is instant; the real SAM takes seconds).
- [ ] Tap **guitar**, point at a real guitar (or a toy one): Kip takes the bench's guitar and strums.
- [ ] Tap **frying pan**: Kip takes the pan and cooks.
- [ ] A word SAM cannot find (point at a wall, say "zebra"): one calm sentence and **Try again**, and the camera restarts.
- [ ] Deny the camera when asked: the view says the camera is turned off and the **Photo** button still works. Then turn it back on in the browser settings.
- [ ] Locked screen or switching apps mid-view, then back: the view is still usable (press Try again or close it); no camera light stays on after closing.
- [ ] **In the game:** open the game, Workshop, Kip tab, Tools, Pick it up, take a spoon, then **Close** the Workshop: the game's Kip is holding the spoon as a flat card, a chip says "Put the wooden spoon away", and tapping Kip or the chip puts it away. A guitar gives the game's own guitar. Walk around, open the Map and come back: it is still in his hand. (Checked in a real browser with a stood-in scan by `scripts/e2e-game-pickup-chain.mjs`; the phone is not checked.)
- [ ] **No word:** press the big button with nothing chosen and point at an object: the view says "It looks like a ...!" with a plausible name (the real naming model on real objects is unchecked: say what it called a spoon, a cup, a toy car: ____), or one calm sentence if it cannot tell.
- [ ] **A thing Kip has nothing for** (a toy dinosaur, a remote): its cut-out goes in Kip's hand as a flat card on a handle, and in the game as a card.
- [ ] If `THEME_SONG` is on: **Make a song about the guitar** appears after the pick-up, the words arrive in a few seconds, the song in about a minute, and Kip can dance to it from the Party's Song picker. Say whether the song sounds like a guitar and a happy mood: ____ (Spark or Glimmer choosing the mood from the sentence is untested).

**Other phone checks**
- [ ] Explorer trail map branches and scroll feel on a real phone (the spec says to revisit them there).
- [ ] The Toy Room toys (xylophone, guitar, books, bubbles, dog, tower of blocks) react to taps.
- [ ] Party mode with headphones: a song plays and the dance follows the beat. Nobody has judged how it sounds or feels; write your verdict ([dance-party-spec.md](../specs/dance-party-spec.md)).
- [ ] Parallax backdrops: fill rate and frame rate on the phone's GPU (the headless run says nothing about it).

## 6. Real child session (about 15 min each)

Dan runs this himself (carousel Q6), so the bands and how many children are his call. C4 does not start until this is filled in. Targets are from [play-design-spec.md](../specs/play-design-spec.md) "Quality bar".

**Setup.** Part 5 setup, plus: fresh site data per child; the grown-up sets the age out of the child's sight and leaves the stage on Garden; **do not mention the Map button**. First words: "Here is a toy game. Can you find something to play?" Start the stopwatch when the phone changes hands; record with a parent's agreement; ID and age only, no names.

**Help rule.** Anything the observer says or touches after hand-over is one help; in-app hints (the wrong-tap cue) count separately. After 15 s of no progress say one neutral prompt ("What do you think that does?") and log it.

**Entry** (target: playable level from the stage in 2 taps or fewer, no reading)

Child ID ____ age ____ band ____ date ____ observer ____

| Measure | Value |
| --- | --- |
| Taps the child made from the stage to a started level | |
| Of those, taps the adult made or pointed at | |
| Found the Map button unprompted (y/n) | |
| Used More, Map instead (y/n) | |
| Seconds from hand-over to a started level | |

**Per rung** (stop when the child is done; mark the rest "not reached")

| Rung | First success (s) | Misses | Help (adult / in-app) | Finished | Stuck (s) | Fun 1-3 | Difficulty | Explains back | Plays again |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pop the bubbles | | | | | | | | | |
| Animal friends | | | | | | | | | |
| Pack the car | | | | | | | | | |
| Peekaboo | | | | | | | | | |
| Go, car, go! | | | | | | | | | |
| Tidy one thing | | | | | | | | | |

Difficulty: too easy / just right / too hard. Explains back: ask "why did that work?" once at the end of a rung and write the child's words. Plays again: replays or picks the next level unprompted.

**Predictions** (written before any session; not evidence): a 2 to 3 year old finds the gold Map button without help; the centred card gets tapped without help once the carousel is open; misses on Pop are 0 to 1. Observed: ____

**Targets, ages 2 to 4** (about 10 children per band; with fewer, read them as directional):

| Measure | Target | Result |
| --- | --- | --- |
| Time to first success | under 15 s | |
| Finishes the level | 9 of 10 children | |
| Misses before success | 2 or fewer on average | |
| Help needed | under 1 per round | |
| Fun | 2.5 or more on average | |
| Difficulty | 70% or more "just right" | |
| Explains it back | says the idea in their own words | |
| Plays again | 1 in 2 children | |
| Stuck | never | |
| Playable level in 2 taps or fewer, no reading | 2 or fewer | |

**Stop rules.** Child upset, tired or asks to stop: stop and write the reason. Any crash, blank screen or frozen panel: stop, note the rung and the last tap, keep the recording. Never tell a child they were wrong.

**What the results decide.** Time to first success over 15 s on a rung: fix that rung's prompt or marker size, not the child. A rung under the finish-rate target: fix before C4 starts (C4 reuses the same visit and carry sessions). The session also checks whether children find the stage Map button and whether the portrait-carousel / landscape-trail-map split makes sense to them.

## 7. Expected behaviour (do not log as bugs)

- **Fresh device, age unset:** the carousel centres on the grown-up "Who is playing?" card behind the press-and-hold gate, so a child cannot start a level until a grown-up sets the age.
- **Landscape Pop:** the mission panel is about 60% of the stage (204 of 340 px) and hides most of the markers. Run Little ones in portrait; landscape is for the trail map. Not changed.
- **Mission panel visibility:** the spec (section 11.4) says the panel on tap-the-scene levels is only visually hidden; on Pop it is visible in both orientations.
- **Room photo, success note:** after a successful capture the Grown-ups sheet closes before its "Made ... Press Play" note can be seen. The editor opening is the signal. Known, unfixed.
- **Room photo, books:** a stack comes back as several boxes and collapses to one prop by design.
- **Make from words** is "not turned on here" on the deployed site; **Smart face** is off; **theme songs** are off unless `THEME_SONG=on`.
- **Rate limits** on the Worker are per isolate, so budgets are best-effort on the live site.
- **Workshop downloads** are off in the game unless the parent-controls-off build is shipped; the Workshop's own exports ask a grown-up.

## 8. Not covered here

- **Physical print tests** (coupons, balloon jet, clutch, friction): [motion-print-test-runsheet.md](../specs/motion-print-test-runsheet.md) and `motion-stage-options-spec.md` section 10. They gate geometry decisions, not the app.
- **Print-gate phase 4 and the per-gate switchboard, and compliance:** deferred until after the hackathon ([workshop-print-gate-spec.md](../specs/workshop-print-gate-spec.md), 7b and 7c).
- **Hosted-model terms for under-18 users:** a decision record ([0008](../decisions/0008-meta-models-and-under-18-users.md)), not a test. No public privacy claim until it is settled.
- **Worker against the real D1 and real model keys:** only part 4 covers it.
- **A deployed segmenter of our own:** `DEFAULT_MODE` is meant to flip from `hosted` to `off` or `self` after the demo; then photo levels answer "not switched on" until a self-hosted segmenter exists.

## 9. The automated suites (robot, when you want more than part 1)

`npm test` (vitest) is the unit and worker layer. The browser layer is `scripts/e2e-*.mjs`, driven over raw Chrome DevTools at 390 x 844; each script's header says what it covers and how to run it. Headless Chrome must use the real GPU (`--use-angle=metal`; SwiftShader hangs), as `E2E_GPU=metal` does for the smoke scripts.

| Area | Scripts |
| --- | --- |
| Game stage and phases | `e2e-chrome` (`npm run e2e`), `e2e-trail` (`npm run e2e:trail`), `e2e-toyroom`, `e2e-toyroom2`, `e2e-props`, `e2e-feeding`, `e2e-orchard`, `e2e-bed`, `e2e-reveal`, `e2e-backdrop`, `e2e-game-party` |
| Grown-up gate and controls | `e2e-parent-controls`, `e2e-workshop-gate`, `e2e-bench-gate-ui` |
| Workshop and benches | `e2e-workshop`, `e2e-game-workshop`, `e2e-bench-lifecycle`, `e2e-bench-stage`, `e2e-yard-bench`, `e2e-truck-drive`, `e2e-truck-band`, `e2e-truck-print` |
| Kip bench | `e2e-kip-menu`, `e2e-kip-print`, `e2e-kip-selfie`, `e2e-kip-photo-print`, `e2e-kip-forge-make`, `e2e-kip-forge-wear`, `e2e-kip-household`, `e2e-kip-party`, `e2e-kip-my-songs`, `e2e-kip-theme-song` |
| Deploy | `check-clean-export`, `smoke-live`, `preflight-deploy.ts` (`npm run preflight`), `selfie-cloud-smoke.ts` (one cartoon face, real API, capped at 6 calls) |

Traps: run one browser script at a time (`e2e-chrome` launches its own Chrome and its own Vite, with overridable ports; assume the others do too). Do not run a mutation or edit session while a browser run is live: Vite reloads the app and breaks the run. `tsc` covers `tests/`, so a type slip in a test fails `npm run build`.

## 10. Results log

Date 2026-11-04 (partly filled at 11:45 CET by the pick-up lane; the empty rows are not done) commit `4edda11` (live) URL https://toyventor.com tester ____

| Check | Pass / fail | Note |
| --- | --- | --- |
| 1.1 robot gates | | |
| 1.4 clean export loads | pass | On `cefb962` (a clean export, not `4edda11`): `npm run build` exit 0; six benches ready, no failed request; the script then hung at teardown and was stopped. Not rerun on `4edda11`. |
| 1.5 secrets and migrations | | |
| 3 live smoke | pass | `smoke-live.mjs https://toyventor.com --commit 4edda11`: 19 passed, 0 failed (146 `public/kip` files byte-identical, `/sw.js` is `toyventor-v7`, the game and the Kip, Truck and Yard benches ready, nothing threw). It compares `public/kip` and the cache name, not the Worker code. Also byte-identical to `3dd7ae3`, which changed tests only. |
| 3 `/api/health` as expected | pass | `ok`, `samConfigured`, `museConfigured`, `selfieCloud`, `forgeOptimizerConfigured`, `voiceConfigured` all true (11:30 CET). `GET /api/transcribe` and `GET /api/theme-song` say `enabled:true`. |
| 4.1 demo run, time ____ s | | |
| 4.2 gate on the live Worker | | |
| 4.3 room photo | | |
| 4.4 other Worker routes | | |
| 4.5 returning visitor cache | | |
| 5 phone checks | | |
| 6 child sessions (count ____) | | |

## Where this came from

Merged on 2026-11-04 from: [deploy-checklist.md](deploy-checklist.md) (parts 1 to 3), [carousel-qa-checklist.md](../specs/carousel-qa-checklist.md) and [carousel-playtest-runsheet.md](../specs/carousel-playtest-runsheet.md) (parts 5 to 7), [demo-script.md](demo-script.md) (4.1), the pre-recording list in [forge-ai-spec.md](../specs/forge-ai-spec.md) (4.6), the "not verified" lists in the garage, household, dance-party, explorer, parallax and sam-physical-to-digital specs (parts 4 and 5), and the room-photo run of 2026-11-02 and 2026-11-04. The originals are untouched so their links keep working; this file is the one to run.

**Corrected while merging (the sources are now out of date on these):**
- Deploy checklist step 6 says `PARENT_GATE_SECRET` "falls back to `MODEL_API_KEY`". It does not since `af9850d` (`worker/parent.ts` reads only `PARENT_GATE_SECRET`, then a random stored secret). Its secrets list also lacks the model switch, `SELFIE_CLOUD`, theme-song and `SELF_*` variables.
- Carousel QA checklist and run sheet say `npm run build` stops on errors in `tests/yard-vehicles.test.ts` and tell you to build with `npx vite build`. The deploy checklist records that fixed; run `npm run build` to confirm.
- Both carousel docs hard-code the Mac's address `192.168.178.91`; use `ipconfig getifaddr en0`.
- `tests/phone-demo.md` (Oct 27) describes the retired Factory and Toybox tabs and "Packs/Market/Play" tabs. The single-stage app replaced it; part 4.1 is its successor.
- `docs/specs/phase4-vehicle-readiness-audit.md` was reviewed and left out: it is a vehicle readiness table (unlock gates and names), not a test procedure.
