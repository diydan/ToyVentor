# Hackathon Journal — ToyVentor

Meta hackathon, Oct 26 – Nov 4. ToyVentor on toyventor.com (was ToyForge until Oct 28). Indie track: "scan it, augment it, print it, play it."

This is the dev log, kept casual. Days 1-10 are the submission record — frozen. New stuff goes at the bottom.

---

## Day 1 — Mon Oct 26: Kickoff

Locked scope to spec.md. Started as ToyForge: Snap (open play, no fail states) + Pro (later). No code yet, just spec and a 12-page wireframe.

Tomorrow: scan a toy into the toybox.

## Day 2 — Tue Oct 27: Scan + toybox

Docs moved into `docs/`, app scaffolded (React + Vite + Worker, shared part/toy schemas, four builder checks). Seed car + figure in.

Scan works: SAM through our Worker, "cup" and "water bottle" hit first try. Lesson: one short noun per request, and a human sets the real-world size. OpenSCAD wasn't installed so zero STLs. API key briefly landed in a commit — moved to `.dev.vars` before pushing.

Tomorrow: real phone photos, print calibration.

## Day 3 — Wed Oct 28: Build + try-on

Builder works end to end in the browser: drag parts on a grid, AR try-on at footprint size, mini-game boost, STL/GLB export, Reveal cards, offline PWA. All 8 base parts render manifold.

Renamed to ToyVentor, toyventor.com secured. License email drafted, not sent. No physical print yet.

Tomorrow: print the calibration piece.

## Day 4 — Thu Oct 29: Packs + World handoff

Packs, rarity, Create mode, and the World handoff landed. Game runs from our origin so Create mode stays same-site. Toy contract carries the build into the world.

Print still blocked on calibration. Parametric parts still slow — one lattice + one contract needed by Day 5.

Tomorrow: republish, rename sweep.

Evening: React port of the World, engine modernised, SAM masks decoded for real (box-only stays fallback), Worker on toyventor.com with live D1.

## Day 5 — Fri Oct 30: One lattice, one game lane

Locked it: one 12.5mm TU lattice, one connector contract, one export path (`scripts/bridge-partspec.ts`). World is now the app — native canvas port, old `game/` + `public/world/` deleted.

Heads all generate now (chibi, tall, bear, fox, kid). Parent time gates shipped (settings + ledger + sleep curtain). Vehicles specced, not built. Nothing printed yet — calibration print is the blocker.

Tomorrow: print plate 1, migrate remote D1, publish.

## Day 6 — Sat Oct 31: Market + print (half)

27 commits: world splits, Toy Box/XP, e2e suites, Jumbo head, truck steering demo. Calibration print started (~5h run) — first real plastic incoming. 3MF colour workflow landed next day. Fit-filtered market: no evidence, not claimed.

## Day 7 — Sun Nov 1: Print workflow + assets

41 commits: 3MF workflow, describe-and-build tab, quests + ranks, asset optimization (85 payloads), town, Kit/Mech generators, theme song a day early. AR colour + mini-game equip as written: missed, the day went to print + assets + recovery.

Incident 23:03 — I ran `git reset --hard` and wiped ~200 dirty paths. Commits were safe. Rebuilt what I could from logs and /tmp. Rule now: no reset without asking + a save first.

F1 outcome still with Dan.

## Day 8 — Sun Nov 2: Reveal + theme + a lot of lanes

Theme song landed. Reveal "plays once then saves" proved working in the real app at 02:00 — found and fixed a real bug where opening a Character Card early silently spent the Reveal.

Also: 26 hair/hat STLs with zero-support ledges, kit-tray print workflow, classic-head retirement. Calibration print 1 scored by hand (snap ladder best step 2, pro shaft +0.3, free pin +0.4).

Forge eval harness up: 60 prompts, v0 47/60 first try, 50/60 final.

Parallax backdrops explored in a mockup only — Garden approved, Toy Room stays as-is (flat wall + real props, no parallax needed). Nothing in the game yet.

Voice + props: every prop got tap/poke/use, 7 languages + Off, `/api/voice` caches clips for a year. Describe & Build talks through Muse by default now (picks among checked builds, never invents). Waiting strip built for the 4-10s think time.

Playtest (Dan, on phone): Garden looks perfect, apple should say "red apple", apples should be feedable, bed should put Kip to sleep, "tractor" fails. Spec written. Decisions: drag-to-feed, I hand-build the clips, grow the book now (10 → 35 builds, tractor works).

Fruit + feeding + bed + orchard + toy-room toys all built and e2e'd in real Chrome. Uncommitted at the time.

## Day 9 — Tue Nov 3: Polish + demo-ish

Trail map landed (full-screen overworld, growth, secret exits, day/night, kid's own build as the token). Workshop mounted in the game (one menu, one print view, three benches). Yard bench v1, road roller, dozer studies. Grown-up print gate core + dialog built, wiring started.

Tree health that night: 3570/3570 green. Nothing deployed. Freeze + demo script still missing — that's the Day 9 miss.

Forge text-to-part ("Make from words") working on hosted Spark: 36/37 printable first call. Big finding reading Meta's terms: hosted API is 18+, our product is for kids. Plan set: hosted for the Nov 4 demo with adults operating it, self-hosted Glimmer for kids after. Model switch built (`hosted` / `self` / `off`, fails closed).

Glimmer v1 on Modal measured: runs 2 and 3 hit 37/37 and 36/37 printable. Proxy drops explained, retry added, 80s budget for our own model, warm-up on panel open. Word lists went seven-language (no native read yet).

## Day 10 — Wed Nov 4: Submit

Submitted. No code after 6 PM ET buffer.

The day went almost entirely to the custom model — see "Today: the custom model" below, that's the real Day 10 log.

---

## Today: the custom model (Nov 4, wrapping Nov 5 ~00:30)

Why we tuned at all: hosted Muse is adults-only per its terms, and we're building for kids. So Make-from-words needed our own model. Base Muse Glimmer 30B self-hosted runs fine (~33-37/37 printable), but it's a general model with general safety. A tuned model is a chance at safer-by-construction (trained only on answers that passed every gate), narrower (short prompt, one job), and faster.

What happened today, in short:

- Sampled our own base Glimmer through the real pipeline: 1,000 wishes, 983 printable. Took ~3h, not 2.5 — a test run hogged the laptop and the gates are CPU-bound.
- Trainer worked on try three (pip bounds, trl rename, retry-loop bug). Cheap to run: 27 min per pilot on L40S.
- Caught a real train/serve mismatch: Unsloth's template adds an extra "Reasoning strength" line Meta's GGUF doesn't have. Pinned to Meta's template, 5/5 identical after.
- LoRA serve works after patching llama.cpp's converter (it crashed on Glimmer and dropped norm tensors). Loads Meta Q4_K_M + our adapter, answers fine.
- First pilots failed the rule, correctly: faster but sloppier with brands and first-call reliability. Also found our own data was teaching brands ("Bluey hat" in → "Bluey hat" out). Fixed: dataset now rejects any example naming one of 50 brands, plus 104 clean brand-wish examples.
- Modal died mid-morning (workspace disabled — Dan-only fix). Lost the running jobs, product unaffected. ~$38 of the $100 spent at that point.
- Pilot 5 passed safety, missed speed. Dan said grind 6 hours, two retries max. Ran pilots 6 (speed try), 7 + 8 (retries on ~1,750 examples).
- Nothing passed "both" at first. Pilot 6 passed speed every run, never safety. Pilot 8 missed by one wish twice.
- Vehicle probe: tuning on hats/heads cost the held prop a bit (base 38/38, p6 34/38, p8 36/38). Plan stands: tuned model takes crowns + heads, everything else goes to base.
- Blind set built: 404 fresh wishes, split dev 204 / test 200 (test half sealed). Nobody fluent has reviewed it.
- Fixed a real over-block in our own filter: "ninja hat" → named "Ninja Hat" → refused as echo, killing all seven names. English stand-in fix approved by Dan. This changed the ruler, so results are v1 (old) vs v2 (fixed), never mixed.
- v2 reruns: pilot 8 passes speed + safety + both, twice (13.1s vs 28.4s base, filters 6 and 5 vs limit 6, red-team 68-69/70 vs 61). Qualified win — on the line, one wish margin, base moves ±3 between runs. Still: best model we've trained, ~2x faster, better red-team both runs, zero leaks.
- Blind dev half is humbling: neither tuned model passes by the stored filter count (mostly echo-drops in other languages, not unsafe content). Real finding: unseen brands get through ~40% on base, ~20-24% tuned. Tuning halves it, doesn't solve it. Longer brand list (~300 entries) + reason on every filtered name (brand/unsafe/echo) now in.
- Zero-training control (base with thinking skipped) is fast and broken: 12.1s but fails quality + safety. Tuning is worth more than the cheap trick.
- Shipped as default tonight: Make-from-words runs on our own models only. Tuned model first try on hat/head, our own base for repairs, vehicles, fallback. No hosted fallback, no per-device setting — server-side only (`FORGE_FAST_MODE=off` kills tuned, `FORGE_AUDIENCE_DEFAULT=adult` brings hosted back as operator safety net). Grown-up gate in front of the routes that still use someone else's model (scan, skin, art, transcribe) — all switches OFF tonight.
- Pitch + charts are generated, not typed: `npm run tune:pitch` → `pitch.html`, `npm run tune:charts` → `charts.html`. One shared explainer (`forgeExplainer.ts`) opens both so they can't disagree. Every number comes from the run files.
- Demo posture, agreed: adults operate the demo; Make runs on our models; SAM/image/voice/some text still Meta-hosted. Close-out checklist says it once.

What the submission may claim: pipeline built, tested, guarded, with a rule that refused to ship bad models — and one qualified pass (pilot 8, v2, 2/2 runs). Not: trained = safe for kids, anything in production, compliance done, or hosted numbers beaten (hosted was never measured on these sets).

Still open: second base run for spread, blind test half untouched, taste/part-match scores, native-speaker read (word lists, brand list, blind set, all seven languages), risk assessment unsigned, real phone pass, rate-limit rules, Modal bill vs my ~$100 ledger.

Commits tonight: own-models default (`c757279`), grown-up gate (`9632c6d`), rescore + verdict (`4c2d794`), pitch page (`84156b6`), shared explainer + charts section 0 (`87649c2`), demo-posture note (`b0441e1`).

Live (Nov 5, after the 01:00 freeze): the self-host secrets and the voice signing key are set, and `b0441e1` was deployed from a clean export (Worker version `0c2b5647`) at **https://app.toyventor.com**; the apex and www stay attached until the landing page takes the root. Live smoke on the new address: 19/19. Ten wishes through the real flow: 9 on the tuned model, 1 on our base (a vehicle slot, as designed), 0 failures, median 19 s (one head wish took 136 s over 3 calls). At 02:15 the app was redeployed as `5424850` (Worker version `37b3129c`, cache v13, with the later game work, the accounts groundwork switched off, and the larger Describe book); re-checked at 02:18: files byte-identical, smoke 19/19, wishes 9 tuned / 1 base / 0 failures, median 15.4 s (the head wish 26 s, one call). Both model servers scale to zero, so the first wish after a long idle can be slow: open Make from words (it pings the warm route) before a demo. Unchanged: SAM, image, voice and songs still use Meta's hosted models, and the grown-up gate switches for them are still off.

---

## Later — time of day + weather (noted Nov 3)

Map day/night on one clock. Worlds follow via parallax plates later. Weather-by-location waits on a privacy call (we promise no location collection) + COPPA review.

## Later — Max phase (noted Oct 31)

Snap → Pro → Max, Max being real kid-safe battle bots. The 4-foot home robot is the prototype. Scan/label/battle data feeds it.

## Later — asset suggester + ScanDex (noted Oct 31)

Scan proposes character/vehicle/prop, kid confirms. Exhaust sharpens the suggester and feeds Max later.
