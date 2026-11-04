# Close-out checklist: hackathon features, ship, demo, submission (one document)

Written 2026-11-04 (submission day) from Dan's chore list, checked against the code, `git log`, the journal and the specs. **Nothing was run to write it** (e2e and the full suite are paused until beta), so every state below is "what the repo records", not "what I saw work". Tick a box only when a person has seen it work.

This file owns the **what and in what order**. The how-to-test detail stays in [qa.md](qa.md) (deploy gates, live smoke, phone and child passes) and the run itself in [demo-script.md](demo-script.md); this file points at them and does not copy them.

**States.** BUILT = committed. CODED = in the working tree, uncommitted. PREP = scaffolding only, the real step has not run. NOT BUILT. LIVE = seen working on the deployed site (nothing is LIVE yet: the last Worker deploy was 2026-11-04 01:09 UTC, version `2a7bc37d`, and the pile, voice, mess, dog, metered-song, warm-up and container-maker commits were all made after it).

---

## 0. Decisions only Dan can make (answer these first; the rest follows)

1. **Voice input uses Meta's hosted transcriber for the demo.** Already decided by Dan today ("use meta for demo and we will self host in the future"); the code is written. Confirm you will set `TRANSCRIBE_BACKEND=hosted` on the live Worker, and that an adult speaks. Record the exception in [0008](../decisions/0008-meta-models-and-under-18-users.md) with the review date.
2. **The flagship flow: point the camera at a real object (a spoon, a guitar, a printed part), SAM cuts it out, the child picks it up and it is used in the game.** Today the pieces exist but the camera view, the pick-up moment and the World-game side do not (section 1, row 3). Decide the scope in section 1, row 3 before anything is recorded, and a song from that moment (row 4) only if the flow itself is done.
3. **Where the video is recorded:** the live site, or this Mac ([qa.md](qa.md) 4.6). The Mac is the only place Make from words is proven today.

Settled: "unlock a related part" is **removed** from this list (Dan, 2026-11-04); training has a **$100 ceiling and is already running in another session** (section 1, row 11).

---

## 1. Dan's chore list, mapped to the repo

| # | Item | State | What is left | Call |
| --- | --- | --- | --- | --- |
| 1 | Voice input in Describe & Build (Meta's transcribe model) | **CODED.** `worker/transcribe.ts` has a hosted mode for `muse-voice-transcribe-1.0`, off unless `TRANSCRIBE_BACKEND` is exactly `hosted` and the Meta key is set; the page already sends a 16 kHz mono WAV, the one format Meta takes. Our own Whisper app (`scripts/modal/whisper_server.py`) is written, not deployed or measured. | Commit (transcribe.ts, kip-describe-voice.js, both tests). Set `TRANSCRIBE_BACKEND=hosted` on the Worker. `GET /api/transcribe` says `enabled:true`. Say one sentence into the mic button on desktop and on the phone. | Ship, adult voice only |
| 2 | Every build starts with the blocks in a pile | **BUILT** (`4a14a6f`). Parts start in a pile and are carried to their seats. | Not live yet. See it on the deployed Describe tab. | Ship |
| 3 | **The flagship flow (Dan wants it in the demo):** camera on a real object (spoon, guitar, a printed part), SAM cuts it out, the child picks it up, it is cloned into the game | **Partly built.** Built, all in the Kip bench: a photo goes to SAM through the Worker, comes back as an outline, is matched to the 60-item household library, and the 3D item (coloured from the photo) goes into Kip's hand, with a plate and sticker to print; a real steel-spoon photo has been through it end to end. **Not built:** a live camera view with an overlay (no `getUserMedia` preview anywhere; `src/features/ar/TryOn.tsx` lays a part over a *still* photo), the pick-up moment, the World-game side (an item is equipped only in the Kip bench; the game's Kip holds a book, guitar, wand, mallets or mop), and a guitar in the library (it has the wooden spoon and no guitar; the game's guitar is a Toy Room prop with a play clip). | Pick a scope (below). Then run it once on the live site with the grown-up gate and the hosted key. | Dan decides; see the scope block |
| 4 | Make a song from that moment | **NOT BUILT.** What exists: the Describe & Build theme song, the end-of-level song, 12 starter songs, the dance party and a weekly song meter ([dance-party-spec.md](../specs/dance-party-spec.md), [deploy-checklist.md](deploy-checklist.md)). They are off on the live site until `THEME_SONG=on`, `MUREKA_API_KEY` and `SONG_MONTHLY_BUDGET` are set (real spend, about $0.04 a song). | If you want the cheapest honest version: a "Make a song about it" button after item 3 that calls the existing song route with the item's name. That is new work plus secrets. | Next, unless Dan wants the button |
| 5 | Guitar | **BUILT** (`220540f`): tap it and Kip plays; `guitar.ts`, a Mixamo guitar clip, spoken name. | Phone check ([qa.md](qa.md) part 5). Voice clip for its name is made on first use until the paid prewarm (section 3). | Ship |
| 6 | Bubble blower with animated bubbles | **BUILT** (`220540f`): Kip blows bubbles through a wand; sprites drift up, any can be tapped to pop (`bubbles.ts`, `bubbleWand.ts`, 36 at most). | Same as the guitar. | Ship |
| 7 | Books | **BUILT** (`220540f`): tap the books and Kip reads the names of the nearest props aloud, a page each. | Same as the guitar. | Ship |
| 8 | Make mess level, a mess made of piles | **BUILT** (`f67e5ef`), Toy Room only: the juice cup spills and the toy box tips into a heap. 53-check real-browser e2e passed when built. | Phone check. It is **not on the Map**; it is reached by tapping the cup (x 40) or the toy box (x 32.6) in the Toy Room. | Ship; say where it lives |
| 9 | Reaction beat: Kip says "Oh no, oh no" | **BUILT** (same commit): the `oops` clip and the line, in the closed voice list. | The 3 English lines plus 14 names (cup and toy box in 7 languages) are made on first use; prewarm them (section 3) so the recording does not wait. | Ship |
| 10 | Player answers "Clean", the pile gets tidied | **BUILT**, with a button: a 60 px **Clean** button on the card (a child taps it; nothing listens for the spoken word). The box rights itself, the toys fly home with a count, the puddle mops in six strokes. | If "answers Clean" means *says* it, that is new work (the mic is in Describe & Build only). Recommend: leave it as the button. | Ship as the button |
| 11 | Get the custom LLM trained as soon as possible | **RUNNING in another session, $100 ceiling (Dan, 2026-11-04).** As of the last repo state nothing was trained and the model card said so; a test fails if any document claims otherwise. This session starts no tuning stage, so the two do not fight over the Modal account or the maker daemon (port 8791). | When that session reports: run `npm run tune:check` and quote only what it prints and what is in `eval-compare.md`. Update the claims below to match. Serving a tuned model on llama.cpp is untested, so a live tuned model today is unlikely. | Running elsewhere |

**Row 3, scope options** (none is sized; the cut-off is whatever you set, the Forge lane used "no code after 6 PM ET"):

- **A. Camera pick-up in the Kip bench.** A live camera preview with a shutter in front of the existing Photo panel; the cutout lifts off the video at the object's own screen position and flies into Kip's hand. New: the camera view and the animation. Reused as-is: SAM, outline, match, colour skin, hand, print plate. A spoon works today.
- **B. A plus the guitar.** When the label is "guitar", skip the library (it has none) and hand Kip the game's existing guitar and play clip, so the captured guitar plays a song. New: that one mapping.
- **C. B plus the World game.** The item shows on Kip in the Toy Room or the Garden. New: carrying a bench item into the game; not sized, and the likeliest to slip.
- Whatever is built, the write-up says what the screen does ("a camera view with an overlay", "cloned as a cutout and a 3D item"), not "tracked AR"; there is no WebXR and SAM is a seconds-long round trip on a still frame.

**What may be said about training** (from `scripts/tuning/README.md`): until the other session says a stage is done, "the full pipeline is built and tested: a dataset builder with safety filters and a manifest, a trainer, an evaluator, a decision rule, a red-team seed set. Nothing is trained." After a smoke run, "an adapter trained for 60 steps: loss went from X to Y", and no quality or safety claim. Never "safe for children".

---

## 2. Gate before anything is recorded

- [ ] **Commit what ships.** 61 files are modified or untracked and several lanes edit this tree (Kip, Forge, tuning, title menu, game). Commit by hunk; `git archive HEAD` ships committed files only ([qa.md](qa.md) 1.2).
- [ ] **Bump `CACHE` in `public/sw.js`** from `toyventor-v4` to `v5` (`public/kip/` changed since the last deploy).
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

## 3. Paid or Dan-only steps (no one else can do these)

- [ ] `scripts/prewarm-voice.ts` for the 14 new names and 3 new lines (cup, toy box, Oh no / Clean? / All clean), so the recording does not wait on first-use speech.
- [ ] Modal: the tuning runs in the other session ($100 ceiling); `modal deploy` of Whisper only if you will use it (the demo does not).
- [ ] The Official Rules you accepted: read them for anything that changes Meta's 18+ clause. Unread so far (the rules are not public).
- [ ] The Cloudflare rate-limit rules above.

---

## 4. The demo run

`demo-script.md` is still the October run (scan, equip, garden mission, pack, Character Card, print). **None of this week's features are in it.** Pick the run, rehearse it once end to end with a stopwatch, and write the final order into `demo-script.md` (its own "Backups" block already names what to say when a step fails). Video length: ____ (Dan).

| Beat | Where it runs | Needs | If it fails | Rehearsed |
| --- | --- | --- | --- | --- |
| Describe & Build: say it, the pile, carried to seats | live site | items 1, 2 | type it instead of speaking | [ ] |
| Make from words (a hat, a head) in the Kip bench | Mac or live container | daemon or container, hosted key | ready-made hat or head, say so | [ ] |
| **Flagship:** camera on a spoon (and a guitar), SAM cuts it out, Kip picks it up (scope in section 1, row 3) | Kip bench; the game only at scope C | grown-up proof (lasts 2 to 5 min), hosted key, rate limit of 3 scans a minute | a pre-shot photo through the same panel; say it is pre-shot | [ ] |
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

- Flip `DEFAULT_MODE` in `worker/modelBackend.ts` away from hosted and deploy without the Meta key for children; deploy our own Whisper and end the voice exception.
- Children's privacy: [coppa-readiness-spec.md](../specs/coppa-readiness-spec.md) P0 to P2 before any child uses it; the native read of the six translated word lists.
- Real phone pass and real-child sessions ([qa.md](qa.md) parts 5 and 6); C4 waits on them.
- The cooking and cleaning levels with `scrub` and `flick`, their Map entries and rungs.
- Whatever part of the camera pick-up flow (row 3) is not done by the cut-off; a song made from the photographed moment.
- Tuning stages the other session has not finished: pilot, export, serving on llama.cpp, the eval against the base model and the red-team set.
