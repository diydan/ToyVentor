# Close-out checklist: hackathon features, ship, demo, submission (one document)

Written 2026-11-04 (submission day) from Dan's chore list, checked against the code, `git log`, the journal and the specs. **Nothing was run to write it** (e2e and the full suite are paused until beta), so every state below is "what the repo records", not "what I saw work". Tick a box only when a person has seen it work.

This file owns the **what and in what order**. The how-to-test detail stays in [qa.md](qa.md) (deploy gates, live smoke, phone and child passes) and the run itself in [demo-script.md](demo-script.md); this file points at them and does not copy them.

**States.** BUILT = committed. CODED = in the working tree, uncommitted. PREP = scaffolding only, the real step has not run. NOT BUILT. LIVE = seen working on the deployed site (nothing is LIVE yet: the last Worker deploy was 2026-11-04 01:09 UTC, version `2a7bc37d`, and the pile, voice, mess, dog, metered-song, warm-up and container-maker commits were all made after it).

---

## 0. Decisions only Dan can make (answer these first; the rest follows)

1. **Voice input uses Meta's hosted transcriber for the demo.** Already decided by Dan today ("use meta for demo and we will self host in the future"); the code is written. Confirm you will set `TRANSCRIBE_BACKEND=hosted` on the live Worker, and that an adult speaks. Record the exception in [0008](../decisions/0008-meta-models-and-under-18-users.md) with the review date.
2. **The flagship flow: point the camera at a real object (a spoon, a guitar, a printed part), SAM cuts it out, the child picks it up and it is used in the game.** Today the pieces exist but the camera view, the pick-up moment and the World-game side do not (section 1, row 3). **Decided (Dan, 2026-11-04): scope A plus B (full camera view), with the moment song (row 4) as the payoff, optimised for the browser and installed web app (PWA) only. A, B, C (the game's Kip holds it) and the song button are built; none of it has run on a real phone.**
3. **Where the video is recorded:** the live site, or this Mac ([qa.md](qa.md) 4.6). The Mac is the only place Make from words is proven today.

Settled (Dan, 2026-11-04): "unlock a related part" is **removed** from this list; training has a **$100 ceiling and is already running in another session** (section 1, row 11); grown-up proofs now last **5 min ("every time") or 10 min ("sitting")** instead of 2 and 5, the room-photo limit is **5 a minute per device and 10 per address** (was 3 and 6), and the fit gate / Make-from-words preview budget is **5 and 10** (was 3 and 6). All three are in code and take effect on the next deploy; the targeted test files pass (10 files, 239 tests), the full suite was not run.

---

## 1. Dan's chore list, mapped to the repo

| # | Item | State | What is left | Call |
| --- | --- | --- | --- | --- |
| 1 | Voice input in Describe & Build (Meta's transcribe model) | **CODED.** `worker/transcribe.ts` has a hosted mode for `muse-voice-transcribe-1.0`, off unless `TRANSCRIBE_BACKEND` is exactly `hosted` and the Meta key is set; the page already sends a 16 kHz mono WAV, the one format Meta takes. Our own Whisper app (`scripts/modal/whisper_server.py`) is written, not deployed or measured. | Commit (transcribe.ts, kip-describe-voice.js, both tests). Set `TRANSCRIBE_BACKEND=hosted` on the Worker. `GET /api/transcribe` says `enabled:true`. Say one sentence into the mic button on desktop and on the phone. | Ship, adult voice only |
| 2 | Every build starts with the blocks in a pile | **BUILT** (`4a14a6f`). Parts start in a pile and are carried to their seats. | Not live yet. See it on the deployed Describe tab. | Ship |
| 3 | **The flagship flow (Dan wants it in the demo):** camera on a real object (spoon, guitar, a printed part), SAM cuts it out, the child picks it up, it is cloned into the game | **BUILT in the Kip bench, scope A + B (2026-11-04, uncommitted).** Tools > **Pick it up** opens a full-screen live camera view (a browser/PWA feature: `getUserMedia`, inline and muted, safe-area padding, the stream stops the moment the shutter is pressed). The child taps or types what it is and presses the shutter, **or just presses the shutter: the Worker's Scan Assist names the main thing in the picture** (`POST /api/scan {nameIt}`, screened: never a person, body part or surface, nothing the kid-safe lists refuse) and the view says "It looks like a spoon!". SAM then finds that word through the print panel's own scan, the object is cut out of the frozen frame where it lies, lifts off, and flies into Kip's hand. A **workshop-prop word** (guitar, ukulele, trumpet, frying pan, broom, mop, hammer, maracas, flag, magnifier ...) gives Kip the bench's own prop and its clip (a guitar strums); any other word gives the **household 3D item** the scan matched (the wooden spoon, coloured from the photo); with neither, **the cut-out itself goes in Kip's hand as a flat card on a handle** (like a photo plate), so any object works; only with no outline and nothing to hold is there a calm sentence and (when downloads are on) "Make its plate". No camera, or camera denied: the same view takes a photo instead. New files: `kip-pickup.js`, `kip-moment-song.js`, `worker/nameIt.ts`; edited: the print panel (`scanBlob`, `takeOffered`, `clearScan`), the menu, the bench, the theme card (two optional labels). Checked by `scripts/e2e-kip-pickup.mjs` (53 checks, real Chrome fake camera, real bench, stood-in `/api/scan`; screenshots reviewed), `tests/kip-pickup.test.ts` and `tests/name-it.test.ts` (two guards proved by breaking them). **Scope C is built too (2026-11-04): after the Workshop overlay closes, the GAME's Kip holds it** (`src/features/game/world/runtime/pickupHeld.ts`): the game's own guitar, mop, vacuums, sponge and spatula where it has them, otherwise a flat card of the cut-out in his right hand with a white edge; tap Kip or the chip "Put the spoon away" to put it away; it survives acts, world switches and rig rebuilds, and waits while he is a vehicle. The bench announces a pick-up with the `tv:kip-picked-up` window event (a transparent PNG of the object rides in it). Checked by `scripts/e2e-game-pickup.mjs` (29 checks, the event dispatched from the page), **`scripts/e2e-game-pickup-chain.mjs` (17 checks: the real game, the bench inside its Workshop overlay, a real pick-up through the real menu, then the game's Kip holding the spoon card and the guitar, screenshots read)** and `tests/pickup-held.test.ts`. **Not checked on a real phone, and never against the real SAM or the real naming model from this flow.** A tap on Kip while he holds the guitar puts it away; it does not start the strum. | Commit (by hunk: `kip-theme-song.js` also holds another lane's karaoke edits). Deploy with the cache at v6 (done in `public/sw.js`). Then once on the live site on a phone, installed to the home screen and in the browser, with the real SAM: spoon, guitar, a pan. | Built, A to C; needs the phone pass |
| 4 | Make a song from that moment | **BUILT as a button (2026-11-04, uncommitted).** After a pick-up, **Make a song about the guitar** appears, only if the song route says it is on. It sends one sentence built from closed words (the object, up to two colour words read from the cut-out, what Kip does with it) through the theme song card, labelled "Song about it"; the finished song goes to My songs so Kip can dance to it. Checked in the same e2e with a stood-in song route (the sentence, the card, ready, closing, and no button when the route is off) and `tests/kip-pickup.test.ts`. **Not verified:** a real song from this flow (Spark or Glimmer picking the `kitchen` mood or the `guitar` instrument from the wording is untested), and the live site has none of `THEME_SONG=on`, `MUREKA_API_KEY` and `SONG_MONTHLY_BUDGET`, so **no button shows on the live site until they are set**. | Set the three song settings (Dan; real spend about $0.04 a song), make one song from a real pick-up and listen to it, and decide whether the wording needs hints. | Built; needs the secrets and one real song |
| 5 | Guitar | **BUILT** (`220540f`): tap it and Kip plays; `guitar.ts`, a Mixamo guitar clip, spoken name. | Phone check ([qa.md](qa.md) part 5). Voice clip for its name is made on first use until the paid prewarm (section 3). | Ship |
| 6 | Bubble blower with animated bubbles | **BUILT** (`220540f`): Kip blows bubbles through a wand; sprites drift up, any can be tapped to pop (`bubbles.ts`, `bubbleWand.ts`, 36 at most). | Same as the guitar. | Ship |
| 7 | Books | **BUILT** (`220540f`): tap the books and Kip reads the names of the nearest props aloud, a page each. | Same as the guitar. | Ship |
| 8 | Make mess level, a mess made of piles | **BUILT** (`f67e5ef`), Toy Room only: the juice cup spills and the toy box tips into a heap. 53-check real-browser e2e passed when built. | Phone check. It is **not on the Map**; it is reached by tapping the cup (x 40) or the toy box (x 32.6) in the Toy Room. | Ship; say where it lives |
| 9 | Reaction beat: Kip says "Oh no, oh no" | **BUILT** (same commit): the `oops` clip and the line, in the closed voice list. | The 3 English lines plus 14 names (cup and toy box in 7 languages) are made on first use; prewarm them (section 3) so the recording does not wait. | Ship |
| 10 | Player answers "Clean", the pile gets tidied | **BUILT**, with a button: a 60 px **Clean** button on the card (a child taps it; nothing listens for the spoken word). The box rights itself, the toys fly home with a count, the puddle mops in six strokes. | If "answers Clean" means *says* it, that is new work (the mic is in Describe & Build only). Recommend: leave it as the button. | Ship as the button |
| 11 | Get the custom LLM trained as soon as possible | **RUNNING in another session, $100 ceiling (Dan, 2026-11-04).** As of the last repo state nothing was trained and the model card said so; a test fails if any document claims otherwise. This session starts no tuning stage, so the two do not fight over the Modal account or the maker daemon (port 8791). | When that session reports: run `npm run tune:check` and quote only what it prints and what is in `eval-compare.md`. Update the claims below to match. Serving a tuned model on llama.cpp is untested, so a live tuned model today is unlikely. | Running elsewhere |

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

Limits to plan the takes around: a device gets **5 new songs a week** (the demo device runs out; raise it in Grown-ups > Songs or use a fresh device), a window of **3 starts per 10 minutes** per address (kept per Worker instance, so best effort; the answer is "One song at a time"), and **nothing is made until `SONG_MONTHLY_BUDGET` is set**. The live site has none of `THEME_SONG=on`, `MUREKA_API_KEY` and the budget yet. Each song is about $0.04, so twenty rehearsal songs cost under a dollar.

My pick: the object is the chorus, the instrument matches it, and Kip plays or dances to it. A captured guitar that plays its own song is the strongest 20 seconds in the whole video.

**What may be said about training** (from `scripts/tuning/README.md`): until the other session says a stage is done, "the full pipeline is built and tested: a dataset builder with safety filters and a manifest, a trainer, an evaluator, a decision rule, a red-team seed set. Nothing is trained." After a smoke run, "an adapter trained for 60 steps: loss went from X to Y", and no quality or safety claim. Never "safe for children".

---

## 2. Gate before anything is recorded

- [ ] **Commit what ships.** 61 files are modified or untracked and several lanes edit this tree (Kip, Forge, tuning, title menu, game). Commit by hunk; `git archive HEAD` ships committed files only ([qa.md](qa.md) 1.2).
  **A plan for the camera pick-up, by area** (other lanes' files are mixed in; stage hunks, not whole files; check each commit by building the committed tree, [commit-block verification](../../docs/product/qa.md) 1.2 and 1.4):
  1. *Limits:* `worker/parent.ts`, `worker/roomScan.ts`, `worker/forgeOptimizer.ts`, comments in `worker/forgeMake.ts`, `shared/outlineGate.ts`, `shared/forgeMakeFlow.ts`; tests `outline-gate`, `forge-make`, `forge-make-flow`, `parts-asset-optimization`, `photo-print-flow`, `forge-worker-daemon` (comment); docs `qa.md`, `workshop-print-gate-spec.md`, `forge-ai-spec.md`, `parts-asset-optimization-spec.md`.
  2. *Naming:* `worker/nameIt.ts` (new), the `focus` option and prompt in `worker/meta.ts`, the `nameIt` route in `worker/index.ts`, `nameObject` in `shared/photoPrintFlow.ts`, `tests/name-it.test.ts`; then rebuild `public/kip/kip-photo-print-core.js`.
  3. *The Kip bench pick-up:* `parts/kip/viewer/` and `public/kip/` copies of `kip-pickup.js`, `kip-moment-song.js` (new), `kip-photo-print.js`, `kip-menu.js`, `kip-bench.js`, `scripts/build-kip.ts`, `public/sw.js` (v6), `scripts/e2e-kip-pickup.mjs`, `tests/kip-pickup.test.ts`, `tests/household-offer.test.ts` (one number and a note), `package.json` (one script line). **`kip-theme-song.js` is shared with another lane's karaoke and waiting-bar edits: stage only the `start(description, opts = {})` hunks (the `label` and `waiting` options).**
  4. *The game side:* `src/features/game/world/runtime/pickupHeld.ts`, `tests/pickup-held.test.ts`, `scripts/e2e-game-pickup.mjs`, `scripts/e2e-game-pickup-chain.mjs` (all new), and **`world.ts`, six hunks only**: the import (about line 163), the `PICK` creation and the window listener (418 to 420), `if(PICK.tap(ray))return;` after the bubbles check (about 748), `PICK.tick();` before the backdrop update (about 841), `PICK.dispose();` in `dispose` (about 1394) and `pick:PICK,` on the dev handle after `follow:FOLLOW,` (about 1398). The rest of `world.ts` is other lanes' work.
  5. *Installing as a web app:* `index.html`, `public/manifest.webmanifest`, `public/icon-maskable.svg`, the four PNGs, `scripts/gen-pwa-icons.mjs`.
- [x] **`CACHE` in `public/sw.js` is `toyventor-v6`** (the live site serves v5; `public/kip/` changed again with the pick-up). Do not bump it twice.
- [ ] [qa.md](qa.md) 1.1 robot gates all green, and 1.4 the clean-export load. These are the only proof the shipped commit loads.
- [ ] Worker settings (Dan runs the writes; the auto-mode classifier blocks `wrangler secret put` for me):
  - [ ] `TRANSCRIBE_BACKEND=hosted` (item 1)
  - [ ] `VOICE_SIGNING_KEY` (spoken names for Make from words)
  - [ ] songs, only if they appear in the video: `THEME_SONG=on`, `MUREKA_API_KEY`, `SONG_MONTHLY_BUDGET`
  - [ ] `MODEL_BACKEND` is **not** `self`
  - [ ] the maker: commit `5c5b383` puts it in a Cloudflare Container behind a service binding. **Whether it is deployed and answers is unverified.** Make one wish through the live site. If it fails, `docs/product/demo-script.md` gives the fallback (a ready-made hat or head) and says so out loud.
  - [ ] Cloudflare dashboard rate-limit rules on `/api/forge/make` and `/api/forge/warm` (Dan's; the warm route's worst case is one container always on, about $47 a day)
- [ ] **Deploy from the export**, not the tree ([qa.md](qa.md) part 2). Then `E2E_GPU=metal node scripts/smoke-live.mjs https://toyventor.com` and `curl /api/health`.
- [ ] Open the live site in a browser that visited before: the new cache name took ([qa.md](qa.md) 4.5).

---

## 2b. Installing it as a web app (PWA)

Dan: browser and installed web app only, no store app. What is in place (2026-11-04): a manifest with 192 and 512 icons, a maskable icon and an `id`, `scope` and categories; an `apple-touch-icon` (iOS ignores the manifest's icons); the standalone meta tags with a solid status bar; the camera view written for it (`getUserMedia` inline and muted, safe-area padding, the stream stopped at the shutter, a photo fallback). Headless Chrome reports **no manifest errors and no installability errors** against the real files (checked, not just parsed); the live site sends no Content-Security-Policy or Permissions-Policy that could block the camera.

- [ ] Open the live site on an iPhone in Safari, Share, **Add to Home Screen**: the icon is the toy brick (not a blank tile) and the name is ToyVentor.
- [ ] Open it from the icon: it fills the screen with no browser bar, and the first camera use asks for permission once (the phone checks in [qa.md](qa.md) part 5, repeated installed).
- [ ] On Android Chrome the install prompt appears, and the maskable icon is not cropped.
- Done 2026-11-04: the manifest and `index.html` descriptions no longer say "play in AR" (there is no WebXR; the camera flow is an overlay on a still frame). They now read "Scan a toy, build printable upgrades on it, and play with it in a mini game." The service worker is `toyventor-v6`; the manifest and head edits ride with it.
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
- The cooking and cleaning levels with `scrub` and `flick`, their Map entries and rungs.
- Whatever part of the camera pick-up flow (row 3) is not done by the cut-off; a song made from the photographed moment.
- Tuning stages the other session has not finished: pilot, export, serving on llama.cpp, the eval against the base model and the red-team set.
