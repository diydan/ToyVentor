# Close-out checklist: hackathon features, ship, demo, submission (one document)

**Submission-day record, frozen.** Written 2026-11-04 (submission day) from Dan's chore list, checked against the code, `git log`, the journal and the specs. It is kept as the record of what submission day claimed, not as a live tracker: for current state, read `git log` and the [journal](journal.md). **Nothing was run to write it** (e2e and the full suite are paused until beta), so every state below is "what the repo records", not "what I saw work". Tick a box only when a person has seen it work.

This file owns the **what and in what order**. The how-to-test detail stays in [qa.md](qa.md) (deploy gates, live smoke, phone and child passes) and the run itself in [demo-script.md](demo-script.md); this file points at them and does not copy them.

**States.** BUILT = committed. CODED = in the working tree, uncommitted. PREP = scaffolding only, the real step has not run. NOT BUILT. LIVE = seen working on the deployed site. The deploys of 2026-11-04 shipped the pile, voice, mess, dog, metered-song, warm-up and container-maker commits (smoke-live 19/19, cache v7), and the last one (commit `0e35110`, cache v8) shipped the camera pick-up, the cleaning and cooking levels, the title menu, the song player, the PWA and the outdoor worlds. The newest one (commit `efa5db0`, cache v10) shipped the scavenger camera and the Print it button, and with them the fruit fingertip fix, the Walking/Running bake and the Junkyard mid-strip art.

---

## Progress (updated 2026-11-04 21:20 CET, after the deploy of `853d5a2`)

DONE = built, committed, deployed and checked by request or a clean export (not by a person). PARTIAL = built, but a step that needs a person, a phone or a secret is open. NOT STARTED. Evidence: `git log`, `curl` of the live site, `smoke-live`, the robot gates in [qa.md](qa.md) part 10 (run on `0e35110` by the other checkout), and the real-photo check below.

| Area | Item | Status | What is open |
| --- | --- | --- | --- |
| Features | 1 Voice input | **PARTIAL** | Live (`/api/transcribe` says `enabled:true`, `voiceConfigured:true`). Nobody has spoken into it on the live site. |
| Features | 2 Blocks start in a pile | **DONE** | A person should see it on the live Describe tab. |
| Features | 3 Flagship pick-up (A bench, B 15 props, C the game's Kip, auto-naming, PWA files) | **PARTIAL** | Committed (`44dd130`, `f7afc18`, `0ddecbd`, `a8b59cd`) and live: `kip-pickup.js` serves, the naming route answers (`configured:true`), the manifest has the new text. **Not done: a phone pass and the installed home-screen app.** The real SAM and naming model ran on five public photos (below), not on phone frames. |
| Features | 4 Moment song | **PARTIAL** | Button is live and the song route says `enabled:true`. No real song made from a pick-up; the wording is untested against the mood and instrument cards. |
| Features | 5 to 7 Guitar, bubbles, books | **DONE** | Phone check ([qa.md](qa.md) part 5) not done. |
| Features | 8 to 10 Make a mess, "Oh no, oh no", Clean | **DONE** | Toy Room only, Clean is a button. Voice clips are made on first use unless the prewarm (section 3) was run; not known. |
| Features | 11 Custom model | **PARTIAL, running in another session** | Five evaluated runs; `tuned-p5` passes the decision rule under goal safety and fails goal speed; nothing tuned is in use (row 11). |
| Features | "Unlock a related part" | **Removed** (Dan) | |
| Features | Finish it (F6), added as a stretch goal | **NOT STARTED (by design)** | Spec and open question 9 only. |
| Features | Print it after a pick-up | **DONE, live** (`efa5db0`, which carries `40cc495`; cache v10) | A green button after a pick-up that found an outline opens the print panel on the shape it already has. Bench e2e 55 of 55. Shows in the game's Workshop only with the grown-up controls off for the tab (Grown-ups > Showcase & Developer > Demo Mode); the grown-up check still gates the file. Nothing has been printed, and a person has not pressed it on the live site. |
| Features | Scavenger: Find a Wheel / Gear / Lever (SAM spec S1, first slice) with the outline glow and a 3D part for the phone's AR viewer | **DONE, live** (`efa5db0`, which carries `40cc495`; cache v10) | Toy Box > Real-Life Routines > 📷 Find it, sideways (a grown-up switches the chores on first). Sideways e2e 22 of 22 (stood-in `/api/scan`); the naming and verdict were checked on 8 public photos through the live Worker. **Not done:** a real phone, the phone's own AR viewer (Android Scene Viewer, never tried; the older Print drawer AR preview is the quick test), the two-photo tidy-up, per-noun SAM counts, a grown-up tap fallback; privacy copy promises only our side (Q7 open). |
| Gate | Commit what ships | **DONE** | The camera, cleaning/cooking, title menu, song player, PWA and outdoor lanes are committed. Still uncommitted in the shared tree: the tuning results, the game-rig and game-actions work, and the new baked clips. |
| Gate | Service-worker cache bumped | **DONE, live** | `toyventor-v11` (`853d5a2`): eleven baked Mixamo clips under `/kip/mixamo/baked` changed since `efa5db0` (the fidgets, the cheers, sad, sneak, kick). The next `/kip/` change needs v12. |
| Gate | Clean export builds and loads | **DONE on `853d5a2`** | `npm run build` exit 0 and six benches ready with no request that is not a 200, from a clean export of the commit ([qa.md](qa.md) 1.4). |
| Gate | Deploy | **DONE** (`853d5a2`, Worker version `64a4e6df`, about 21:15 CET, smoke-live 19 of 19) | Live = `main` at `853d5a2`: the previous deploy plus the second Mixamo round (fidgets, two more cheers, sad/sneak/kick: `136adc0`), the face-plate, neck and swing review pass (`1b4b5e7`), the joint turrets and Snap torso (`959e9cb`), generated worlds (`d315a22`: `/api/world/look` and `/api/world/art`; an empty request answers 422 and spends nothing, budgets are 30 a day overall and 5 per IP in D1, `VOICE_SIGNING_KEY` is set), the eating hand and belly pat (`c1d464f`), Kip turns to face you (`ab3c456`), and the cache bump to v11 (`853d5a2`). `/kip/` changed (eleven baked clips), so the cache went to v11; the Worker changed (`worker/worldLook.ts`, `worker/index.ts`, `worker/spendLimit.ts`); no migration was pending and `wrangler.jsonc` is unchanged. Checked: clean export builds, six benches load with no request that is not a 200, `/sw.js` is v11, 146 `/kip/` files byte-identical, `/api/health` all true. Not judged on a real phone. **Previous deploy** (`efa5db0`, Worker version `e06d72af`, 19:27 CET): Live = `main` at `efa5db0`: the scavenger camera and the Print it button (`40cc495`), the fruit fingertip fix, the Walking/Running bake and the Junkyard mid-strip art. Front-end only: the Worker, `shared/`, migrations and `wrangler.jsonc` are unchanged, and no `/kip/` byte changed, so the cache stays `toyventor-v10`. Also checked: the live game chunk `index-BUTfyOPX.js` is byte-identical to a local build of the commit; `/api/health` all true; six-bench clean-export load OK from a clean export of the commit. |
| Gate | Worker settings | **PARTIAL** | Transcribe, voice signing and songs report on. **Not checked:** the maker answering a wish, `MODEL_BACKEND` is not `self`, the Cloudflare rate-limit rules. |
| Gate | `smoke-live` against the deployed commit | **DONE** | 19 of 19 on `efa5db0` at 19:28 CET (146 `public/kip` files byte-identical, cache `toyventor-v10`, game and the Kip, Truck and Yard benches ready, nothing threw). It checks `public/kip` and the cache name, not the Worker code. |
| Gate | Robot gates 1.1 | **DONE** | validate ok (5 set files), typecheck clean, 5365 tests passed on `efa5db0` (243 files, 1 skipped, 0 failed); the scavenger e2es 22 of 22 and 55 of 55 ([qa.md](qa.md) part 10). |
| Gate | A returning browser takes the new cache (4.5), phone checks, the other part 10 rows | **NOT STARTED** | Need a person and a phone; run them before recording. |
| Demo | Demo script | **PARTIAL** | Draft written ([demo-script.md](demo-script.md)); not rehearsed or timed. |
| Demo | Rehearsal with a stopwatch, video length, where to record (decision 3), pre-made spoon and guitar songs, voice prewarm | **NOT STARTED** | All Dan's or need a person. |
| Submission | Video, write-up check, live-deploy verification filed, Official Rules and Meta terms read | **NOT STARTED** | The hash to file is `efa5db0` (live, smoke-tested). Anything committed after it is not live. |
| After | Section 6 (self-hosted model for children, children's privacy, native word-list read) | **NOT STARTED (by design)** | Not today. |

---

## 0. Decisions only Dan can make (answer these first; the rest follows)

1. **Voice input uses Meta's hosted transcriber for the demo.** Already decided by Dan today ("use meta for demo and we will self host in the future"); the code is written. Confirm you will set `TRANSCRIBE_BACKEND=hosted` on the live Worker, and that an adult speaks. Record the exception in [0008](../decisions/0008-meta-models-and-under-18-users.md) with the review date.
2. **The flagship flow: point the camera at a real object (a spoon, a guitar, a printed part), SAM cuts it out, the child picks it up and it is used in the game.** Today the pieces exist but the camera view, the pick-up moment and the World-game side do not (section 1, row 3). **Decided (Dan, 2026-11-04): scope A plus B (full camera view), with the moment song (row 4) as the payoff, optimised for the browser and installed web app (PWA) only. A, B, C (the game's Kip holds it) and the song button are built; none of it has run on a real phone.**
3. **Where the video is recorded:** the live site, or this Mac ([qa.md](qa.md) 4.6). The Mac is the only place Make from words is proven today.

Settled (Dan, 2026-11-04): "unlock a related part" is **removed** from this list; training has a **$100 ceiling and is already running in another session** (section 1, row 11); grown-up proofs now last **5 min ("every time") or 10 min ("sitting")** instead of 2 and 5, the room-photo limit is **5 a minute per device and 10 per address** (was 3 and 6), and the fit gate / Make-from-words preview budget is **5 and 10** (was 3 and 6). All three are in code and went out with the 10:54 CET deploy; the targeted test files pass (10 files, 239 tests), the full suite was not run.

---

## 1. Dan's chore list, mapped to the repo

| # | Item | State | What is left | Call |
| --- | --- | --- | --- | --- |
| 1 | Voice input in Describe & Build (Meta's transcribe model) | **BUILT.** `worker/transcribe.ts` has a hosted mode for `muse-voice-transcribe-1.0`, off unless `TRANSCRIBE_BACKEND` is exactly `hosted` and the Meta key is set; the page already sends a 16 kHz mono WAV, the one format Meta takes. Our own Whisper app (`scripts/modal/whisper_server.py`) is written, not deployed or measured. | Commit (transcribe.ts, kip-describe-voice.js, both tests) - done. `TRANSCRIBE_BACKEND=hosted` is set on the Worker and `GET /api/transcribe` says `enabled:true` (measured on the live site 2026-11-04). Say one sentence into the mic button on desktop and on the phone - that pass has never been run by a person. | Ship, adult voice only |
| 2 | Every build starts with the blocks in a pile | **BUILT** (`4a14a6f`). Parts start in a pile and are carried to their seats. | Not live yet - it is now: the pile commit shipped in the 2026-11-04 deploys. See it on the deployed Describe tab. | Ship |
| 3 | **The flagship flow (Dan wants it in the demo):** camera on a real object (spoon, guitar, a printed part), SAM cuts it out, the child picks it up, it is cloned into the game | **BUILT in the Kip bench, scope A + B (2026-11-04, committed).** Tools > **Pick it up** opens a full-screen live camera view (a browser/PWA feature: `getUserMedia`, inline and muted, safe-area padding, the stream stops the moment the shutter is pressed). The child taps or types what it is and presses the shutter, **or just presses the shutter: the Worker's Scan Assist names the main thing in the picture** (`POST /api/scan {nameIt}`, screened: never a person, body part or surface, nothing the kid-safe lists refuse) and the view says "It looks like a spoon!". SAM then finds that word through the print panel's own scan, the object is cut out of the frozen frame where it lies, lifts off, and flies into Kip's hand. A **workshop-prop word** (guitar, ukulele, trumpet, frying pan, broom, mop, hammer, maracas, flag, magnifier ...) gives Kip the bench's own prop and its clip (a guitar strums); any other word gives the **household 3D item** the scan matched (the wooden spoon, coloured from the photo); with neither, **the cut-out itself goes in Kip's hand as a flat card on a handle** (like a photo plate), so any object works; only with no outline and nothing to hold is there a calm sentence and (when downloads are on) "Make its plate". No camera, or camera denied: the same view takes a photo instead. New files: `kip-pickup.js`, `kip-moment-song.js`, `worker/nameIt.ts`; edited: the print panel (`scanBlob`, `takeOffered`, `clearScan`), the menu, the bench, the theme card (two optional labels). Checked by `scripts/e2e-kip-pickup.mjs` (53 checks, real Chrome fake camera, real bench, stood-in `/api/scan`; screenshots reviewed), `tests/kip-pickup.test.ts` and `tests/name-it.test.ts` (two guards proved by breaking them). **Scope C is built too (2026-11-04): after the Workshop overlay closes, the GAME's Kip holds it** (`src/features/game/world/runtime/pickupHeld.ts`): the game's own guitar, mop, vacuums, sponge and spatula where it has them, otherwise a flat card of the cut-out in his right hand with a white edge; tap Kip or the chip "Put the spoon away" to put it away; it survives acts, world switches and rig rebuilds, and waits while he is a vehicle. The bench announces a pick-up with the `tv:kip-picked-up` window event (a transparent PNG of the object rides in it). Checked by `scripts/e2e-game-pickup.mjs` (29 checks, the event dispatched from the page), **`scripts/e2e-game-pickup-chain.mjs` (17 checks: the real game, the bench inside its Workshop overlay, a real pick-up through the real menu, then the game's Kip holding the spoon card and the guitar, screenshots read)** and `tests/pickup-held.test.ts`. **Not checked on a real phone, and never against the real SAM or the real naming model from this flow.** A tap on Kip while he holds the guitar puts it away; it does not start the strum. | Committed and shipped (the cache is at v8 in `public/sw.js`). Then once on the live site on a phone, installed to the home screen and in the browser, with the real SAM: spoon, guitar, a pan. | Built, A to C; needs the phone pass |
| 4 | Make a song from that moment | **BUILT as a button (2026-11-04, committed).** After a pick-up, **Make a song about the guitar** appears, only if the song route says it is on. It sends one sentence built from closed words (the object, up to two colour words read from the cut-out, what Kip does with it) through the theme song card, labelled "Song about it"; the finished song goes to My songs so Kip can dance to it. Checked in the same e2e with a stood-in song route (the sentence, the card, ready, closing, and no button when the route is off) and `tests/kip-pickup.test.ts`. **Not verified:** a real song from this flow (Spark or Glimmer picking the `kitchen` mood or the `guitar` instrument from the wording is untested). The song route **is** on on the live site: `GET /api/theme-song` says `enabled:true` and `THEME_SONG`, `MUREKA_API_KEY` and `SONG_MONTHLY_BUDGET` are set on the Worker (measured 2026-11-04), so the button does show after a pick-up. | Make one song from a real pick-up and listen to it (about $0.04), and decide whether the wording needs hints. | Built; needs one real song |
| 5 | Guitar | **BUILT** (`220540f`): tap it and Kip plays; `guitar.ts`, a Mixamo guitar clip, spoken name. | Phone check ([qa.md](qa.md) part 5). Voice clip for its name is made on first use until the paid prewarm (section 3). | Ship |
| 6 | Bubble blower with animated bubbles | **BUILT** (`220540f`): Kip blows bubbles through a wand; sprites drift up, any can be tapped to pop (`bubbles.ts`, `bubbleWand.ts`, 36 at most). | Same as the guitar. | Ship |
| 7 | Books | **BUILT** (`220540f`): tap the books and Kip reads the names of the nearest props aloud, a page each. | Same as the guitar. | Ship |
| 8 | Make mess level, a mess made of piles | **BUILT** (`394301e`, live), Toy Room only: the juice cup spills and the toy box tips into a heap. 53-check real-browser e2e passed when built. | Phone check. It is **not on the Map**; it is reached by tapping the cup (x 40) or the toy box (x 32.6) in the Toy Room. | Ship; say where it lives |
| 9 | Reaction beat: Kip says "Oh no, oh no" | **BUILT** (same commit): the `oops` clip and the line, in the closed voice list. | The 3 English lines plus 14 names (cup and toy box in 7 languages) are made on first use; prewarm them (section 3) so the recording does not wait. | Ship |
| 10 | Player answers "Clean", the pile gets tidied | **BUILT**, with a button: a 60 px **Clean** button on the card (a child taps it; nothing listens for the spoken word). The box rights itself, the toys fly home with a count, the puddle mops in six strokes. | If "answers Clean" means *says* it, that is new work (the mic is in Describe & Build only). Recommend: leave it as the button. | Ship as the button |
| 11 | Get the custom LLM trained as soon as possible | **RUNNING in another session, $100 ceiling (Dan, 2026-11-04).** **Five adapters have been trained and evaluated** against the base on the same 243 wishes (`scripts/tuning/results/pilots.md`, committed in `2918799`; the ledger totals about $40 of the $100 by 11:10 CET and that session planned at most $45 more). The decision rule refuses all of them as measured: `tuned-p5` (production prompt plus brand-wish examples) passes the safety and quality checks (red-team 70/70 against the base's 61/70, printable 98.8%, first call 96.9%) and fails only the speed goal (median 27.1 s against 32.4 s), and the machine was loaded during part of that eval; a confirmation rerun (`tuned-p5b`) and a sixth pilot were still running. **Nothing tuned is in use.** This session starts no tuning stage, so the two do not fight over the Modal account or the maker daemon (port 8791). | When that session reports its verdict (Dan told it to work until about 17:05 CET): run `npm run tune:check` and quote only what it prints and what is in `results/pilots.md`. Serving a tuned model on llama.cpp now works for evaluation (a separate Modal app); it is not wired to the live Worker, and `MODEL_BACKEND` must stay off `self`. | Running elsewhere |

**Real-photo check (2026-11-04, ~11:55 CET; five Wikimedia Commons photos, objects only, no people; the live Worker, driven by the app's own client code `nameObject` and `scanPhoto`; not phone camera frames, so no motion blur and no hand in the picture).** The helper's first name was the right object on **5 of 5** (2.7 to 5.1 s each), and SAM returned an outline on **5 of 5** (3.9 to 7.6 s each):

| Photo | First name | Other names | Outline |
| --- | --- | --- | --- |
| A silver spoon on a plain backdrop | spoon | none | Exact (188 points). |
| A yellow ride-on toy car on gravel | toy car | car, toy | Good: the car with its wheel and seat (216 points). |
| A teddy bear with a scarf across it | teddy bear | plush toy, scarf | **Only the head**: the scarf splits the body (`SPLIT_OBJECT`), so the flight would carry just the head. |
| A frying pan on a kitchen counter (a knife block behind) | frying pan | bottle, coaster | Good: the pan and its handle (151 points). No knife was named. |
| A store wall of about 30 guitars | guitar | none | One guitar picked out of the wall (187 points, `SPLIT_OBJECT`): a reasonable pick, not a failure. |

What this means for the demo: film the spoon and the guitar one at a time on a plain background; an object with something draped across it (a scarf, a hand over half of it) can come out as a part. The other names are not tried unless the first one finds nothing. Still untested: a spoon in a child's hand, a dim kitchen, and the shutter on a moving phone. The contact sheet is in the session scratchpad, not the repo.

**Row 3, scope options** (none is sized; the cut-off is whatever you set, the Forge lane used "no code after 6 PM ET"):

- **A. Camera pick-up in the Kip bench. BUILT as the full live camera view (Dan chose it over the file-picker version).** A live camera preview with a shutter in front of the existing Photo panel; the cutout lifts off the video at the object's own screen position and flies into Kip's hand. New: the camera view and the animation. Reused as-is: SAM, outline, match, colour skin, hand, print plate. A spoon works today.
- **B. A plus the guitar. BUILT, and wider than asked: the bench already had 15 workshop props with their own clips, so any of them works, not only the guitar.** When the label is "guitar", skip the library (it has none) and hand Kip the game's existing guitar and play clip, so the captured guitar plays a song. New: that one mapping.
- **C. B plus the World game. BUILT (2026-11-04).** The item shows on the game's Kip after the Workshop closes (`pickupHeld.ts`; section 1, row 3). Checked by the chain e2e, not on a phone.
- Whatever is built, the write-up says what the screen does ("a camera view with an overlay", "cloned as a cutout and a 3D item"), not "tracked AR"; there is no WebXR and SAM is a seconds-long round trip on a still frame.

**Row 4, the moment song: what it takes as context, and how it is made** (brainstorm; from `worker/themeSong.ts`. Only the first sentence of the pipeline below is built: the button in `kip-moment-song.js` sends the object, up to two colours and what Kip does with it; the place, time and count ingredients are not).

How a song is made today: `POST /api/theme-song {description (300 characters at most), kind}`. The text model (Spark now, Glimmer later) returns a name and a short song as JSON; `shared/songLyrics.ts` gates it and *builds* the lyrics, and the style comes from the closed song cards (`shared/songCards.ts`), so the provider only gets words that passed the gate. One Mureka song is ordered (about $0.04). The name and words come back first; the audio follows. Measured: Spark 13 to 20 s, Mureka about 32 s, so about 45 to 50 s from tap to sound.

What the song can take as context (each is a word or two that our own code puts in the one description sentence):

| Ingredient | Example | Where it comes from |
| --- | --- | --- |
| The object, as the hero and the chorus word | "spoon", "guitar" | SAM label, or the library name when it matched |
| How it looks | "shiny silver", "brown" | the colours already sampled from the cutout for the skin |
| What Kip does with it | strums, stirs, blows bubbles | the hand item and its clip |
| Where and when | the Toy Room, at night | the world and the map's day/night clock |
| What just happened | picked it up, printed it, cleaned the mess ("All clean! Hooray!") | the beat the child just finished |
| How many | "one spoon, two spoons..." | the count of objects found in a room photo, so the song is a counting verse |

What never goes in: the photo's pixels, a face, the child's name, a location, or a voice recording. The text model sees only a sentence built from closed words, so it works on the hosted model now and on Glimmer later, and the photo is still never stored.

The pipeline for the demo: (1) code builds the sentence ("a shiny silver spoon that Kip picked up in the Toy Room at night"); (2) `POST /api/theme-song` with `kind: "prompt"` (the kind that screens words; a new kind only if the lyrics read badly); (3) pick the cards by object: the closed lists are moods `bouncy sleepy silly space kitchen cleanup` and instruments `drums piano guitar trumpet maracas bells xylophone synth` (at most two), so a guitar gets the `guitar` card, a spoon gets mood `kitchen`, the finished mess gets `cleanup`, and anything else gets `bouncy`; (4) show the name and lyrics the moment they arrive, as a karaoke card, while the audio is still being made; (5) when it is ready it plays and Kip dances to it (the party already does this for "My songs").

Because it takes about 45 to 50 s, do not stand and wait on camera. Either fire it at the shutter tap and come back to it after the next beat, or make the exact spoon and guitar songs before recording and say they were made earlier. Fallback: a starter song.

Limits to plan the takes around: a device gets **5 new songs a week** (the demo device runs out; raise it in Grown-ups > Songs or use a fresh device), a window of **3 starts per 10 minutes** per address (kept per Worker instance, so best effort; the answer is "One song at a time"), and **nothing is made until `SONG_MONTHLY_BUDGET` is set**. All three are set on the Worker now (measured 2026-11-04: `GET /api/theme-song` says `enabled:true`), so a song can be made from the live site. Each song is about $0.04, so twenty rehearsal songs cost under a dollar.

My pick: the object is the chorus, the instrument matches it, and Kip plays or dances to it. A captured guitar that plays its own song is the strongest 20 seconds in the whole video.

**What may be said about training:** the table "What may be said at each point" in `scripts/tuning/README.md` is the only source; it was updated at about 11:30 CET to say the pipeline was run end to end, adapters were trained, served and evaluated by a rule set in advance, and the rule has not approved any for use. Quote it with its n and its date, do not paraphrase it, and do not say "faster", "safer", "in production" or "safe for children". If the other session's verdict changes the table, change this line to point at the new row.

---

## 2. Gate before anything is recorded

- [x] **Commit what ships.** Done for the camera, cleaning/cooking, title menu, song player, PWA and outdoor-world lanes: their files are committed, and the tree they share is reconciled with `origin/main` (a `git pull` fast-forwards; a push is a no-op). Commit by hunk; `git archive HEAD` ships committed files only ([qa.md](qa.md) 1.2).
  **A plan for the camera pick-up, by area** (other lanes' files are mixed in; stage hunks, not whole files; check each commit by building the committed tree, [commit-block verification](../../docs/product/qa.md) 1.2 and 1.4):
  1. *Limits:* `worker/parent.ts`, `worker/roomScan.ts`, `worker/forgeOptimizer.ts`, comments in `worker/forgeMake.ts`, `shared/outlineGate.ts`, `shared/forgeMakeFlow.ts`; tests `outline-gate`, `forge-make`, `forge-make-flow`, `parts-asset-optimization`, `photo-print-flow`, `forge-worker-daemon` (comment); docs `qa.md`, `workshop-print-gate-spec.md`, `forge-ai-spec.md`, `parts-asset-optimization-spec.md`.
  2. *Naming:* `worker/nameIt.ts` (new), the `focus` option and prompt in `worker/meta.ts`, the `nameIt` route in `worker/index.ts`, `nameObject` in `shared/photoPrintFlow.ts`, `tests/name-it.test.ts`; then rebuild `public/kip/kip-photo-print-core.js`.
  3. *The Kip bench pick-up:* `parts/kip/viewer/` and `public/kip/` copies of `kip-pickup.js`, `kip-moment-song.js` (new), `kip-photo-print.js`, `kip-menu.js`, `kip-bench.js`, `scripts/build-kip.ts`, `public/sw.js` (v6), `scripts/e2e-kip-pickup.mjs`, `tests/kip-pickup.test.ts`, `tests/household-offer.test.ts` (one number and a note), `package.json` (one script line). **`kip-theme-song.js` is shared with another lane's karaoke and waiting-bar edits: stage only the `start(description, opts = {})` hunks (the `label` and `waiting` options).**
  4. *The game side:* `src/features/game/world/runtime/pickupHeld.ts`, `tests/pickup-held.test.ts`, `scripts/e2e-game-pickup.mjs`, `scripts/e2e-game-pickup-chain.mjs` (all new), and **`world.ts`, six hunks only**: the import (about line 163), the `PICK` creation and the window listener (418 to 420), `if(PICK.tap(ray))return;` after the bubbles check (about 748), `PICK.tick();` before the backdrop update (about 841), `PICK.dispose();` in `dispose` (about 1394) and `pick:PICK,` on the dev handle after `follow:FOLLOW,` (about 1398). The rest of `world.ts` is other lanes' work.
  5. *Installing as a web app:* `index.html`, `public/manifest.webmanifest`, `public/icon-maskable.svg`, the four PNGs, `scripts/gen-pwa-icons.mjs`.
- [x] **`CACHE` in `public/sw.js` is `toyventor-v8`** (the live site serves v8 as of the deploy of `0e35110`; `public/kip/` changed again with the three new `mixamo/baked/loco_*.json` files). Do not bump it twice. The next bump is v9.
- [x] [qa.md](qa.md) 1.1 robot gates all green, and 1.4 the clean-export load. These are the only proof the shipped commit loads. (2026-11-04: validate ok, typecheck clean, 5233 tests pass, the export builds and every bench is ready - 6 benches, 975 requests, 0 not 200. The log is in qa.md part 10.)
- [ ] Worker settings (Dan runs the writes; the auto-mode classifier blocks `wrangler secret put` for me):
  - [x] `TRANSCRIBE_BACKEND=hosted` (item 1) - set; `GET /api/transcribe` says `enabled:true` (measured 2026-11-04)
  - [ ] `VOICE_SIGNING_KEY` (spoken names for Make from words) - it is set on the Worker; the clips themselves are made on first use
  - [x] songs, only if they appear in the video: `THEME_SONG=on`, `MUREKA_API_KEY`, `SONG_MONTHLY_BUDGET` - all set; `GET /api/theme-song` says `enabled:true` (measured 2026-11-04)
  - [ ] `MODEL_BACKEND` is **not** `self`
  - [ ] the maker: commit `5c5b383` puts it in a Cloudflare Container behind a service binding. The binding is configured and the maker Worker `toyventor-forge-maker` exists (v `7d959e1c`), and `/api/health` says `forgeOptimizerConfigured:true` (measured 2026-11-04) - but **no real wish has been made through it yet**. Make one wish through the live site. If it fails, `docs/product/demo-script.md` gives the fallback (a ready-made hat or head) and says so out loud.
  - [ ] Cloudflare dashboard rate-limit rules on `/api/forge/make` and `/api/forge/warm` (Dan's; the warm route's worst case is one container always on, about $47 a day)
- [x] **Deploy from the export**, not the tree ([qa.md](qa.md) part 2). Then `E2E_GPU=metal node scripts/smoke-live.mjs https://toyventor.com` and `curl /api/health`. Done 2026-11-04: commit `0e35110`, Worker version `b522d2c5`, cache `toyventor-v8`, smoke 19/19 (146 served files byte-identical to the commit), `/api/health` all true.
- [ ] Open the live site in a browser that visited before: the new cache name took ([qa.md](qa.md) 4.5).

---

## 2b. Installing it as a web app (PWA)

Dan: browser and installed web app only, no store app. What is in place (2026-11-04): a manifest with 192 and 512 icons, a maskable icon and an `id`, `scope` and categories; an `apple-touch-icon` (iOS ignores the manifest's icons); the standalone meta tags with a solid status bar; the camera view written for it (`getUserMedia` inline and muted, safe-area padding, the stream stopped at the shutter, a photo fallback). Headless Chrome reports **no manifest errors and no installability errors** against the real files (checked, not just parsed); the live site sends no Content-Security-Policy or Permissions-Policy that could block the camera.

- [ ] Open the live site on an iPhone in Safari, Share, **Add to Home Screen**: the icon is the toy brick (not a blank tile) and the name is ToyVentor.
- [ ] Open it from the icon: it fills the screen with no browser bar, and the first camera use asks for permission once (the phone checks in [qa.md](qa.md) part 5, repeated installed).
- [ ] On Android Chrome the install prompt appears, and the maskable icon is not cropped.
- Done 2026-11-04: the manifest and `index.html` descriptions no longer say "play in AR" (there is no WebXR; the camera flow is an overlay on a still frame). They now read "Scan a toy, build printable upgrades on it, and play with it in a mini game." The service worker is `toyventor-v8`; the manifest and head edits ride with it.
- Not done: separate home-screen icons from the Workshop pages (`/kip/Workshop.html`); installing from the app's root is the supported path.

---

## 3. Paid or Dan-only steps (no one else can do these)

- [ ] `scripts/prewarm-voice.ts` for the 14 new names and 3 new lines (cup, toy box, Oh no / Clean? / All clean), so the recording does not wait on first-use speech.
- [ ] Modal: the tuning runs in the other session ($100 ceiling); `modal deploy` of Whisper only if you will use it (the demo does not).
- [ ] The Official Rules you accepted: read them for anything that changes Meta's 18+ clause. Unread so far (the rules are not public).
- [ ] The Cloudflare rate-limit rules above.

---

## 4. The demo run

`demo-script.md` now holds a **draft of the November 4 run** (nine beats: home-screen icon, Describe & Build, Make from words, the Pick it up flagship, the moment song, the game's Kip holding it, the mess and Clean, a song and a dance, the one line on the model), with backups for the camera, the naming helper, the scan limit and a missing song button. It has not been rehearsed or timed. One thing it settles: **stay in the Kip bench until the moment song plays** (closing the Workshop destroys the bench and loses a song still being made), or make the songs beforehand and say so. Rehearse it once with a stopwatch, then cut it to your length. Video length: ____ (Dan).

| Beat | Where it runs | Needs | If it fails | Rehearsed |
| --- | --- | --- | --- | --- |
| Describe & Build: say it, the pile, carried to seats | live site | items 1, 2 | type it instead of speaking | [ ] |
| Make from words (a hat, a head) in the Kip bench | Mac or live container | daemon or container, hosted key | ready-made hat or head, say so | [ ] |
| **Flagship:** camera on a spoon (and a guitar), SAM cuts it out, Kip picks it up (scope in section 1, row 3) | Kip bench, then the game's Kip after the Workshop closes | grown-up proof (5 or 10 min once deployed), hosted key; `/api/scan` allows 10 a minute per address; printing the plate also uses the preview gate (5 a minute once deployed, shared with Make from words) | a pre-shot photo through the same panel; say it is pre-shot | [ ] |
| Toy Room: guitar, books, bubbles | live site | nothing | tap the next toy | [ ] |
| Make a mess, "Oh no, oh no", Clean | live site | prewarmed clips | sound off still shows text | [ ] |
| A song and a dance | live site | starter songs (no spend) | the party plays the starter songs | [ ] |
| One line on the custom model | no demo | the training ladder above | say only what the ladder allows | [ ] |

**Say once, out loud** (from [demo-script.md](demo-script.md) and the Forge lane's checklist): this demo uses Meta's hosted model with adults operating it; for children the same features run on a self-hosted model. Smart face and the photo scan send one photo to the hosted model: use an adult's face and a toy, not a child.

**Do not say:** that Glimmer is in production or the default; that anything is trained; that the app complies with children's privacy law; that parts are safe because they are AI-made (the gates check printability); "tracked AR" or "real-time detection" for the camera flow. If you record from the Mac, [qa.md](qa.md) 4.6 is the setup list.

---

## 5. The submission package

- [ ] Video recorded, watched once all the way through, filed.
- [ ] Write-up: [submission-vision.md](submission-vision.md) (Dan's; about 60 lines were changed by another lane, read it whole). Check every sentence against section 1 of this file. Rows 3 and 4 must say exactly what was built when you stop coding, and no more.
- [ ] Live-deploy verification filed with the video: the commit hash, `smoke-live` output, `/api/health` output, and the [qa.md](qa.md) part 10 results log ([demo-script.md](demo-script.md) "Where this lives").
- [ ] The commit that was deployed is the commit the repo shows (no uncommitted file in the demo).
- [ ] Meta Model API terms (10.1) and the hackathon's Official Rules checked by Dan.

---

## 6. After the hackathon (not today)

- **Stretch goal added (Dan, 2026-11-04): Finish it.** Turn a prototyped brick toy into a smooth, polished one with fewer constraints and more about function and looks, for the game and for printing, optimised for printing and built as one piece or as few as needed (decided the same day). It is [forge-ai-spec.md](../specs/forge-ai-spec.md) F6 (brief under "F6 pipeline", stretch item 10, open question 9) and [spec.md](spec.md) "Stretch goals"; nothing is built, and it is not part of the November 4 demo or what the write-up may claim.
- Flip `DEFAULT_MODE` in `worker/modelBackend.ts` away from hosted and deploy without the Meta key for children; deploy our own Whisper and end the voice exception.
- Children's privacy: [coppa-readiness-spec.md](../specs/coppa-readiness-spec.md) P0 to P2 before any child uses it; the native read of the six translated word lists.
- Real phone pass and real-child sessions ([qa.md](qa.md) parts 5 and 6); C4 waits on them.
- The cooking and cleaning levels are built and ship on 2026-11-04 (`scrub` on the cleaning cart, `cook` on the hob, the shared `flick` for the pancake flip, the `daily.clean` and `daily.cook` rungs). What they still need is the end-to-end pass in a browser and on a phone, with the paid voice lines (25 English lines and 14 prop-name clips).
- Whatever part of the camera pick-up flow (row 3) is not done by the cut-off; a song made from the photographed moment.
- Tuning stages the other session has not finished: pilot, export, serving on llama.cpp, the eval against the base model and the red-team set.
