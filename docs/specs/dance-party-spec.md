# Dance party: headphones, Mixamo dances, AI songs and a kitchen and clean-up exercise: spec (draft 2, 2026-11-03; decisions made, nothing built)

Dan (2026-11-03): "we also want headphones that connect to the ear sockets of Kip's, and Mixamo animation and music 'dance' party using murkesa to
create songs; spec this plus a game exercise using the cooking and cleaning props we just created".

This spec covers four things that meet in one place, the **party**: (1) a printable pair of headphones Kip wears, (2) Mixamo dance clips on Kip,
(3) songs made with an AI music service, and (4) a game exercise built on the spatula, frying pan, mop, broom, scrub brush and vacuums. It is a plan,
not a build: every fact is marked as **verified in the repo**, **from a third-party page**, or **not checked**.

## Facts that shaped the plan

- **"Ear sockets of Kips" do not exist today.** Every head has crown studs (`top_studs`), a socket underside (`under_sockets`) and, for the four human
  heads, a face slot. There is no side bore or ear socket on any of the 12 heads. `pointy_ears` is a *crown* add-on in the hat slot.
- **The song service is Mureka** (D1). The Muse key lists no music model (`muse-image`, `muse-spark`, `muse-wonder`, `sam`, `muse-voice-transcribe`), so Muse cannot
  make songs. Nothing in the repo used Mureka before this spec.
- **"Exercise" means both** a learning-and-play session and a movement break (D6): section 5.

## Decisions (Dan, 2026-11-03)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Is "murkesa" Mureka? | **Yes, Mureka.** |
| D2 | How do headphones attach? | Dan asked what I suggest. **Working decision: A, the crown band** (reasons below). Option B (real ear sockets) stays out of scope until a part has been printed once. Dan can still veto. |
| D3 | Generate live per child, or ship a library? | **Both.** A pre-made starter library (always available, works offline) **and** a live song maker. The library comes first (phase 3) because it needs no Worker; the live maker follows (phase 4). |
| D4 | Who owns the Mureka account, key and budget? | **We do** (Dan's account, one key held only in the Worker, a hard monthly cap). **Each user gets 5 new songs a week** (rules in 4.6). |
| D5 | Which Mixamo dances? | Dan: "research and decide, 3 to 5". **My pick: 4, plus 2 reserves** (section 3.1a). |
| D6 | Where does the exercise sit? | **Both** the learning session and the movement break, in scope (5.2, 5.3). |
| D7 | New play primitives for the exercise? | **Approved:** `scrub` and `flick`, now listed in `play-design-spec.md` (5.4). |

**Why A for the headphones.** (1) It changes no verified part; option B changes all 12 heads, every wig vault and hat cavity, and the seating matrix, before one head has
been printed (the calibration prints are still being scored). (2) The digital version, which is most of the value in the game, ships either way. (3) The one real
risk, the print route for the arch, is cheap to spike on a single part. (4) A does not block B later. **Cost of A:** headphones replace the hat in the crown slot,
and they need a wig-clearance check; if a hairstyle fails it, headphones are offered with bald heads and the Hat-Ready wigs only.

## 1. What exists today (verified in the repo, 2026-11-03)

| Area | Fact |
| --- | --- |
| Heads | 12 heads, each `top_studs` + `under_sockets`; humans also `face_slot`. Widths measured on the STLs: kid 38.2, chibi 39.5, tall 40.0, jumbo 39.6 mm; fox 48.8, cat 48.0 mm. Heights 33.8 to 38 mm. |
| Ears and hats | `pointy_ears`: Snap add-on, grid 2x2 with a two-hole pad, `lock`, slot `head`, behaviour "Twitches when a sound plays" (a sound-reactive add-on already exists). `hat_beanie` and friends are *wearable* hats that wrap the head (rim on the bed, cavity from `HAT_CAVITY_SLICES`). Ears, horns and hats share the crown slot, so only one is worn. |
| Kip clips | 27 hand-built clips in `kip-clips.js`: 6 reactions, 3 dances (`dance_boogie`, `dance_robot`, `dance_disco`), 18 prop clips. `dance_disco` is authored at 120 bpm (12 beats in 6 s). Prop clips now have planted feet and natural hands (commit `6c18327`). |
| Mixamo | Two sample files in `public/kip/mixamo`: `Xbot.glb` (agree, headShake, idle, run, sad_pose, sneak_pose, walk) and `Michelle.glb` (SambaDance, TPose). **One dance only (Samba).** They come from the three.js examples (MIT), listed in `THIRD_PARTY.md`. `retargetMixamoClipToKip` (in `kip-bench.js`) maps them onto Kip's rig, which has **14 joints, no spine and no fingers**. |
| Mixamo licence | From an Adobe community copy of the FAQ (2022, not Adobe's current terms; recheck): commercial use and games allowed; the raw files may not be the product; embedded and not extractable is the common reading; no attribution; **not allowed as machine-learning training data** (keep Mixamo clips out of the Forge AI training sets). Needs an Adobe login to download. Any new clip needs a `THIRD_PARTY.md` entry. |
| Game audio | `runtime/audio.ts`: a **procedural WebAudio engine** (`SongDef`: bpm, root, scale, wave, pad, decay; one song per world, a gain bus with reverb) plus sound effects. No sample or file playback of music. A free, offline fallback already exists. |
| Worker | D1 (`DB`) and Workers AI (`AI`) are bound. Routes: `muse.ts`, `meta.ts` (Muse proxy), `voice.ts` (TTS), `parent.ts` (parent gate), others. **No R2 bucket and no KV**: song files cannot be stored in the Worker today. Starter songs could ship as static files. |
| Game props | The game loads prop STLs from `/kip/partspec/` through `resolveCharacterPropUrl` in `stlRigLoader.ts`, but maps only five ids (`robot.arms.*`) and falls back to the flag. It does not use `kip-clips.js` (grep finds `kipClips` only in the viewer). **Not checked:** whether the game's rig exposes the same 14 named joints; section 6 makes that the first spike. |
| Cooking and cleaning in the game | `daily.cook` (3 pick questions: wash hands, count spoons, "the oven is hot, who opens it?" a grown-up), `daily.meal`, `daily.clean` (2 questions). The `clean` mission has tool buttons (vacuum, mop, sponge), three mess types (crumbs, puddle, jam), wrong-tool lines in `CWHY` ("Mopping crumbs just makes mush"), and a soap-drop window by tier. |
| Props we have | Printable: spatula, frying pan, mop, broom, scrub brush, handheld vacuum, upright vacuum, plus paint roller, hammer, guitar, trumpet, maracas, flag, magnifier, wrench, screwdriver. Digital household items: bowl, plate, mug, wooden spoon, sponge, bucket, fruit. **No whisk, ladle, pot or microphone.** |

## 2. Headphones

### 2.1 What they are

A **Snap character add-on** (a new wave, W15 "Party", so W9's stat rule and W12's prop rule are untouched): a band over the crown ending in two cups, with
a small pad on the crown studs like `pointy_ears`. Catalog row: `family: addon`, `type: Character add-on`, `slots: ["head"]`, `front: symmetric`,
tags `headphones, head, character, kip`, behaviour "Cups glow to the beat" (the same idea as the ears' "twitches when a sound plays"). It takes the
crown slot, so it is an alternative to a hat, horns or ears, like they are to each other.

### 2.2 Option A (chosen, D2): crown band, no head change

- The pad fits the crown `top_studs`; the band hugs the head and the cups sit at ear height. Size from the measured heads: human cups at x = +-(19 to 20 mm)
  plus 0.4 mm clearance (the hat clearance), animal heads need a wider pair (48 mm wide). So **two sizes**: human (kid, chibi, tall, jumbo within 1.8 mm of
  each other) and animal (fox, cat; bear, dragon, alien, imp to be measured).
- **Wigs and hats:** a hat-ready wig keeps its crown studs, so the band can sit over it, but a hat cannot. Whether the band clears every wig's
  silhouette is a measurement, not an assumption: reuse the head x wig x hat x plate seating matrix (`build_examples`), and add headphones to it.
- **Print risk (the main CAD question):** an arch printed upright overhangs past 45 degrees near its top and a flat-roofed band spans about 39 mm, more
  than a bridge allows. Two routes to spike before committing: (i) print the band **lying on its side**, a flat 5 mm extrusion like the W12 props, with
  the stud pad as a boss; the sockets then have a horizontal axis, which needs a diamond or teardrop hole and a fit check; (ii) a **segmented** band
  (two halves that meet on the crown pad) printed upright with 45 degree flanks. Decide after one gate run each, not now.
- Gates: the normal part gate (watertight, single body, support-free, `I7` roofs over stud holes), small-parts screen (the pair is well above the
  cylinder), preprint check, and a real Orca slice with supports on (as for the W12 props).

### 2.3 Option B (later): ear sockets on the heads

A pair of Pro bores on the head sides (for example the existing 5.1 mm fixed bore with a short friction pin on each cup) lets cups be worn *without* a band,
under or beside hats and wigs. It changes all 12 head STLs (they are verified and the print gates are tight), the wig vaults and hat cavities (measured
envelopes), the face plate seating, the sprue plates and the validation reports, then needs a full regeneration and the head x wig x hat x plate matrix.
Worth it only if cups-without-a-band is a product wish. If it is, do it as its own wave after option A has been printed once.

### 2.4 In the viewer and the game

- Viewer: a `headphones` entry in the head-slot options (hat category) with a wear animation (hands lift the band on, 1.0 s), no new clip system.
- **Sound-reactive glow:** one shared `AnalyserNode` on the music bus; the cup material's emissive follows the low-band level with a soft attack and release
  and a cap, and Kip's head bob follows the beat grid (section 4.4). With sound off the cups are plain.
- Print BOM: one add-on part, one colour; `kip-print-bom.js` gets its file line, the print plate planner already handles Snap add-ons.
- Not claimed: no safety statement about real headphones. The part is a toy ear-cup shape; it plays no sound.

## 3. Mixamo dances

### 3.1 Intake (Dan downloads; I retarget and gate)

1. Dan signs in at mixamo.com and downloads the **4 picks** in 3.1a (and a reserve only if one fails the gate) as FBX or glTF "without skin", 30 fps, **in place** where the option exists. I cannot sign in.
2. Selection criteria, so the picks work on a 14-joint rig:
   - loops cleanly in 4 or 8 beats, stays in place, stays on its feet (no floor work, spins on the head or hands, flips: the grounder keeps the lowest foot on
     the floor and a floor move will read as a squat);
   - arms and hips carry the dance (there is no spine and no fingers, so a move that is all torso twist or finger work is lost);
   - kid-appropriate: no suggestive moves, nothing that needs a prop or a partner;
   - a mix of tempos (slow sway, medium bounce, fast) so a song can pick the nearest.
3. Keep the one we have (Samba) and the three procedural dances, so the party has 8 dances (up to 10 with the reserves).
4. Each new file gets a `THIRD_PARTY.md` entry and is kept **out of every AI training set**.

### 3.1a The picks (D5)

How I chose: Mixamo needs a login, so I could not browse it. The names below come from a third-party game-asset sheet that lists Mixamo dance clips (HipHopDance, SwingDance,
LockingHipHop, HouseDance, RobotiHipHop, WaveHipHop, HeadSpin), community threads, and **my own recollection of Mixamo's Dance category, which the search did not
confirm for "Silly Dancing", "Chicken Dance" and "Twist Dance"**. Dan checks each is in the list when downloading, and downloads the reserves only if a pick fails the gate.

| # | Pick | Why it suits Kip | Tempo role | Name seen in |
| --- | --- | --- | --- | --- |
| 1 | **Hip Hop Dancing** | arm and hip groove, loops in 4 beats, nothing on the floor | medium, about 100 bpm | third-party sheet ("HipHopDance") and a conversion thread |
| 2 | **Swing Dancing** (the solo version, if there are two) | big arm and hip swing, joyful, upbeat | fast, about 125 bpm | third-party sheet ("SwingDance") |
| 3 | **Locking Hip Hop** | arm-led (points, claps, snaps) so it survives having no fingers or spine; small footprint | fast and sharp | third-party sheet ("LockingHipHop") |
| 4 | **Silly Dancing** | loose, comic, big arms: the one a 3-year-old copies | slow to medium, about 85 bpm | my recollection, not confirmed |
| R1 | Chicken Dance (reserve) | arm-led, easy to copy | medium | my recollection, not confirmed |
| R2 | Twist Dance (reserve) | hip-led, simple | medium | my recollection, not confirmed |

Rejected, with the reason: **House Dance 1 and 2** (fast footwork: the feet slide and the leg solver cannot hold a stepping dance), **Head Spin and breakdance moves** (floor work, the
grounder reads it as a squat), **Wave Hip Hop** (a body wave needs a spine), **Robot Hip Hop** (`dance_robot` already exists), and any clip tied to one specific song (a Macarena-,
Gangnam- or Thriller-style clip, if present) for song-rights reasons.

With Samba and the three procedural dances the party has **8 dances** (up to 10 with the reserves), in three tempo roles (about 85, 100 and 125 bpm), which are also the three song tempo cards.

### 3.2 Quality gate (the same discipline as the prop clips)

Run each retargeted clip through a per-clip measurement before it reaches the menu, using the page's `window.kipRig()` and `kipClips.scrub`:

| Check | Pass |
| --- | --- |
| Loop seam: last frame equals the first | joint error under 2 degrees |
| Feet: for an "in place" dance, ankle drift on the floor | report it; planted dances under 3 mm, stepping dances flagged as "steps" and not planted |
| Hands: wrist bend and thumb direction (bare hands) | wrist 45 degrees or less, no hand through the body |
| Lowest foot never below the floor, never floating more than 4 mm for more than 0.2 s | pass |
| Retarget error: any joint outside Kip's limits (knee rx below 0, and so on) | none |

Dances that fail the feet check can use the `plant: true` leg solver from `kip-clips.js` (it re-solves legs for the hips pose), at the cost of changing the dance's
leg work; fix the clip or drop it. Contact sheets from two cameras are part of the review, as for the props.

### 3.3 Tempo

A clip is stored with its authored `bpm` and `beats` (a Mixamo clip has no tempo in the file, so someone sets it once, by counting). In the party a dance is
**time-scaled to the song** by whole bars: rate = song bpm / clip bpm, clamped to 0.8 to 1.25; outside that range pick another clip. A song never plays a
dance more than a quarter off its natural speed, because slowed or sped Mixamo motion looks wrong at the extremes.

## 4. Songs with Mureka (the "song maker")

### 4.1 What is known, and not (read before spending)

From third-party pages only; **I could not open Mureka's own terms or pricing, which need a login**. Dan checks these on mureka.ai.

- Mureka offers subscription plans with commercial licensing on paid tiers, and an API (a song-generation endpoint at `api.mureka.ai`); free-tier output
  appears to be non-commercial with attribution. Pages disagree on the price of the entry plan ($8 vs $10 a month) and say nothing reliable about **API**
  pricing.
- **Not known, and each one can stop the feature:** API price per song and rate limits; clip length; instrumental-only mode; tempo or key control; stems;
  output format; latency; whether the licence covers **storing and serving generated songs inside a children's app**; whether a children's app is
  allowed at all; content policy and moderation; whether outputs are reproducible (the Muse image API is not: nothing is, by default).

### 4.2 Constraints from the rest of the product (so the answers can be checked)

- **Generation is constrained** (`play-design-spec.md`): the model works from closed catalogs, code validates, unknown values are dropped. Songs follow the same rule:
  a child picks **cards, not words**: a mood (bouncy, sleepy, silly, space, kitchen, clean-up), a tempo (slow, medium, fast), up to two instrument cards.
  The Worker maps cards to a fixed prompt template. **No free text and no child data go to Mureka.**
- **Store, never regenerate** (the Muse lesson: no seed, no reproducibility): a song is made once, kept, and replayed. A "new song" is a new song.
- **Instrumental in v1.** Lyrics are the highest-risk output for a child audience (content, names, real songs). Vocals later, with fixed lyric templates
  and placeholders, never free text, never the child's name.
- **No artist or song names in any prompt**, no voice cloning.
- Labelled in the UI as made by AI, and stored with its prompt, mood, tempo, model and date, for the licence record.

### 4.3 Architecture

```
Kip bench / game  --(mood, tempo, instruments)-->  Worker /api/song  --(validated template)-->  Mureka API
                                                         |                                         |
                                                         |<---------------- audio + metadata ------|
                                                         +--> store (static starter files; R2 for live songs) + D1 row (songs table)
                                                         +--> beat map (computed once, section 4.4)
```

- `worker/song.ts` follows `voice.ts` and `muse.ts`: key in a Worker secret (`MUREKA_API_KEY`), the limiter that names `retry-after`, a daily cap per family, a
  monthly budget cap that **fails closed** (the party then offers only the library), the parent gate (`parent.ts`) in front of anything that spends.
- **Storage:** the starter library ships as static files in `public/` (no infrastructure). Live songs need an **R2 bucket** (a new binding in `wrangler.jsonc`)
  or a D1 blob if songs are short and small: a decision when phase 4 starts. Not needed for the demo.
- **Moderation:** an **instrumental** song made from the closed cards plays at once (a child should not wait for a grown-up), and appears in the parent sheet "New songs", where a
  grown-up can remove it and get its weekly note back (4.6). **Vocals, if they ever ship, are held until a grown-up approves them.** Starter songs are listened to by Dan before shipping.
- **Offline and failure:** if Mureka is down or capped, the party plays the library, and the existing procedural engine (`audio.ts`) can still make
  a backing loop with no network at all.

### 4.4 Beat map, so the dance follows the song

AI songs have no guaranteed tempo, so tempo is **measured, not trusted**: at ingest (a script for the starter library, the Worker for live songs) compute
the onset times and a beat grid, store `{ bpm, beats[], bars }` beside the song, and let the dance engine read it. If the analysis disagrees with the requested
tempo, keep the measured one. Playback uses `AudioContext.currentTime` as the clock so dance, glow and taps stay aligned with the sound, not with frames.

### 4.5 Safe listening

The party sets its own gain below the game's other sounds, with a parent-set ceiling in the grown-up sheet, a quiet-hours rule, and "volume stays with
the device". The numeric ceiling should come from a current children's listening-safety reference, which I have not checked: **open item**.

### 4.6 Weekly quota and budget (D4: 5 new songs a week per user)

- **Who is a "user".** The Worker already identifies a player by an anonymous **device UUID** (`x-device-id`, `worker/ownership.ts`: "real accounts map onto the same id"). Until there are
  per-child profiles, a user is that id; when profiles exist the quota follows the profile. A cleared device id would reset a quota, so the quota is **not the only guard**: the global
  monthly budget cap below is, and it fails closed.
- **What counts.** One new song = one successful generation that was stored. It does **not** count: a failed, timed-out or capped attempt; replaying any song; the starter library; a song a grown-up
  removes in "New songs" (refunded). Asking again for the same mood counts as a new song (no seed, so it is a different song).
- **The week.** Monday 00:00 to Sunday 24:00 in the family's timezone, using the parent-time day keys (`localDay` with the settings timezone, as the time gate does; the weekend logic in
  `garage.ts` already builds on `dayOfWeek`). No rollover (a decision to confirm, 8). A child sees **5 music-note pips** ("new notes on Monday"); at 0 the card offers the library.
- **Mechanics.** A D1 row `song_quota(device_id, week_key, used)`. A request first **reserves** a slot with an idempotency key (so a retry never double-spends), calls Mureka, then commits or
  refunds. The reservation and the global spend counter share one transaction.
- **Budget.** Cost per active user per month at full use is about 5 x 52 / 12 = **21.7 songs**. If a subscription listed at 1,600 songs a month (a third-party figure, **not** confirmed for the API) applied,
  it would cover about 74 users at full use; the real number is the API price per song, which Dan reads from the account. The Worker holds `SONG_MONTHLY_BUDGET`; when it is spent, live songs
  stop and the party plays the library (fail closed), and a grown-up sees "the song maker is resting".
- **Grown-up controls.** The live song maker needs a one-time grown-up enable behind the parent gate (an AI feature for a child); the weekly limit can be lowered (0 to 5) but not raised above 5;
  the library is always on.

## 5. The party, and the kitchen and clean-up exercise

### 5.1 Party mode (Kip bench first)

Pick a song card, Kip puts on the headphones, one to four Kips dance (the household's own Kips, each with the dance the song picks), lights and cup glow follow the
beat. Beat play by age band (`src/lib/age.ts`; band 0 = ages 2 to 3 up to band 5 = 13+): bands 0 and 1 tap anywhere and Kip dances (no wrong taps); band 2 taps on the beat for a flash; band 3 copies a
4-step pattern; bands 4 and 5 compose an 8-step loop. It earns XP as rhythm and pattern work (counting beats, repeating patterns); how many STEM minutes is for
`xp-system-spec.md` to decide.

### 5.2 Kitchen band, clean-up groove and the movement break (in scope, D6)

**Kitchen band and clean-up groove.** No new CAD: the pan is a drum and the spatula its stick (tap the pan on the beat, a drum sample plays); the guitar, trumpet and maracas are already props;
and the broom and mop *dance*: their clips are time-scaled to the bar and the sweep lands on the beat. "Clean-up groove" is the broom or mop clip at the song's tempo for one bar, repeated.

**Movement break (D6, "both").** At the end of a Help cook or Clean up session, or on a grown-up's tap, a 30 to 60 second song plays and Kip dances or does the clean-up groove; the child
is invited to **stand up and copy Kip**. It is a prompt, not a measurement: **no camera, no motion sensing, nothing scored from movement** (the rule the real-life routines already follow). Band 0 and 1: Kip
does one simple move (arms up, stomp, spin) and counts the beats aloud. Band 2 and 3: copy a 4-move sequence. Band 4 and 5: copy, then choose the next move. A grown-up can switch it off, and it never replaces the
parent's own time limits. Whether a movement break earns STEM minutes is for `xp-system-spec.md` (open question 5).

### 5.3 The exercise: Help cook and Clean up (two linked sessions in the `daily` ladder)

It fills the rungs that today are three and two pick questions. Same ids (`daily.cook`, `daily.clean`), richer sessions; no new ladder.

**Cook** (the spatula and the frying pan), steps in order, each with a Kip clip that already exists:

| Step | Child does | Learns | Kip |
| --- | --- | --- | --- |
| Wash hands | tap the tap | hygiene, order | (existing `daily.wash` motion) |
| Crack the egg | tap the egg into the bowl | cause and effect | reaction |
| Count | drop 1, 2, 3 pancakes of batter into the pan | counting to 3 (band 1), to 6 (band 3) | holds the pan |
| Heat | **a grown-up taps "hot"**, the pan sizzles | safety: hot things are a grown-up job (existing line kept) | waits |
| Flip | swipe up on the pan at the right moment | timing | **Flip (spatula)** clip |
| Serve | carry pancakes to the plates | sharing, 1 to 1 matching | **Toss (frying pan)** at the end |

**Clean** (mop, broom, scrub brush, the two vacuums), reusing the clean mission's mess and tool rules:

| Mess | Right tool | Wrong-tool line | Kip clip |
| --- | --- | --- | --- |
| crumbs (dry) | handheld or upright vacuum | existing: "Mopping crumbs just makes mush. Dry crumbs need the vacuum." | Vacuum, Vacuum (upright) |
| puddle (wet) | mop | existing: "Vacuums are for dry things. A puddle is a liquid, so use the mop." | Mop |
| sticky jam | soapy water with the **scrub brush** (new; today's mission uses the soapy sponge: keep both) | existing: "The mop just smears sticky jam. Try the soapy sponge." (reword for the brush) | Scrub (brush) |
| dust and leaves | broom | none yet: a new mess and a new line | Sweep (broom) |

The mess types, tool rules and soap-drop window are the existing `clean` mission's (`missionData.ts`, `catalog.ts` `CWHY`); the new work is the child
holding a **visible tool with its clip**, the broom mess, and the scrub brush.

By band (the ladders' ages): **band 0 to 1** one mess, one tool, errorless (tap the mess, Kip cleans; a wrong tool just wobbles and tries the right one). **Band 2 to 3** two or three
messes, pick the tool, wrong tools explain themselves. **Band 4 to 5** a whole kitchen: order the jobs, a soap and water ratio, and a recipe that scales
("this makes 4 pancakes; make 8"): the ratio and sequencing the older rungs teach.

### 5.4 New primitives (approved, D7; listed in `play-design-spec.md`)

The primitive catalog is closed, and no existing primitive rubs along a path or times a flick. Two additions, each with the contract every primitive has
(variables, band limits, errorless modifier, solver):

- `scrub`: drag along a mess until it is gone; Kip plays the held tool's clip while the finger moves (speed maps to the clip's rate within limits).
- `flick`: a timed swipe inside a window; the window widens for young bands and never fails them.

Until they exist, crumbs and puddles use `carry` (drag the mess to the bin) and the flip uses `toggle`, so the exercise can ship in a plainer form first.

### 5.5 Real-life pairing

`daily` rungs pair with parent real-life routines and never duplicate them (carousel spec 10.3). "Help cook" gets a grown-up confirm ("we made pancakes together") using the
existing real-life confirm; "Clean up" likewise. Nothing is scored from a camera.

## 6. Phases, gates and tests

Order is chosen so each step is useful alone and each can be stopped.

| Phase | Work | Gate before the next |
| --- | --- | --- |
| **0 Decisions and spikes** (about a day) | Decisions are made. Dan checks Mureka's terms on his account and makes one test song (and reads the API price per song). Dan downloads the dances. Spike: **a prop in the game's hand** (load the Kip rig in the game, mount a prop through the same grip node, play `makeKipClip`): answers whether the game rig has the 14 joints. Spike: the headphone print route (section 2.2) on one part. | Mureka allows a children's app and stored songs; the print route passes one gate run; the game spike works or the exercise stays in the Kip bench. |
| **1 Headphones** | Catalog row and part (option A), viewer slot, glow hook, print BOM, regeneration through the landing checklist (one batch), selftest, Orca slice. | Part gate verified; Orca 0 supports; head x wig matrix passes; menu and print e2e. |
| **2 Mixamo dances** | Intake the 4 picks (and a reserve if one fails), retarget, the section 3.2 gate, `THIRD_PARTY.md`, contact sheets, menu entries. | Every shipped dance passes the gate; Samba and the three procedural dances still pass `tests/kip-clips.test.ts`. |
| **3 Songs and the party in the Kip bench** | Starter library (about 12 instrumental songs made once, listened to, beat-mapped), beat clock, tempo-scaled dances, cup glow, party panel, age-band beat play. No Worker needed. | Beat error: a tap within 80 ms of a beat counts, measured on a real song; the dance does not drift against the clock over 60 s. |
| **4 Live song maker** | `worker/song.ts`, caps, parent gate, moderation queue, storage decision, "new song" card. | Cost per song known and capped; a failed or capped call falls back to the library; a moderation pass by a grown-up exists. |
| **5 The exercise in the game** | Game prop-in-hand (generalise `resolveCharacterPropUrl` to a data table: Kip prop id to STL, `flip`, `mat` and clip, read from the wardrobe rows so the viewer and the game cannot drift), the cook and clean sessions, the movement break, the two primitives or their plain forms. | Every prop the sessions use renders in the game's hand with its clip; the sessions are completable by the "random toddler" robot (`play-design-spec.md`). |
| **6 Carousel and map** | A party entry in the carousel and a map stop, parent controls, the Garage-style weekend variant if wanted. | After the real-phone pass (C4 is waiting on it). |

Tests that should exist before each phase lands: part-gate and fit-matrix runs (phase 1), per-clip metrics and contact sheets (phase 2), a beat-clock unit test and an
end-to-end that measures tap-to-beat error (phase 3), a Worker test with the limiter, cap and fail-closed behaviour and a stub Mureka (phase 4), a game e2e that holds
each prop and plays its clip (phase 5). Mutation-check the new tests once each, as for the clips.

## 7. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Mureka terms forbid a children's app or stored songs | The whole song half | Phase 0 check; fall back to the procedural engine plus licensed-free loops, or a different service |
| Lyrics and content | Child safety | Instrumental v1, cards not text, grown-up approval |
| Cost per song unknown | A bill with no ceiling | Library first, hard cap, fail closed |
| The headphone arch cannot print support-free | Part fails the gate | Spike both routes in phase 0; the digital version ships either way |
| Mixamo clips fail on a 14-joint rig | Dances look wrong | Selection criteria and the gate; keep procedural dances |
| Game rig differs from the Kip rig | Phase 5 grows | The phase 0 spike decides before anything is promised |
| Mixamo licence reading | Legal | Recheck Adobe's current terms before shipping; keep clips out of training data |

## 8. Open questions (what is still open after D1 to D7)

1. **Mureka's terms and API price** (Dan, on his account): does the licence allow a children's app, and storing and serving generated songs inside it? Price per song, clip length, instrumental mode, tempo control. Any "no" changes section 4.
2. **Mixamo availability:** are Hip Hop Dancing, Swing Dancing, Locking Hip Hop and Silly Dancing in the Dance list today (and the two reserves)?
3. **One size or two** for the headphones (human and animal heads)? The spike measures bear, dragon, alien and imp, which I have not.
4. **Quota rollover:** none (my proposal), or unused songs carry over up to a cap? And does a family with several children on one device get one quota or one each (needs per-child profiles)?
5. **Do movement breaks earn STEM minutes**, or only the learning session (`xp-system-spec.md`)?
6. **Live song maker default:** off until a grown-up enables it (my proposal), or on with a notice?
7. **Vocals:** ever, for a young audience? (Not in this plan.)
8. **Safe-listening ceiling:** the numeric limit for the party's gain, from a current children's reference I have not checked.

## 9. Verified and not

**Verified in the repo today:** head connectors and widths; `pointy_ears` and hat catalog rows; the 27 clips and their bpm facts; the two Mixamo files and their clip names; the licence
summary in memory; the audio engine's `SongDef`; the Worker's bindings and routes; `resolveCharacterPropUrl`; the `daily.cook` and `daily.clean` content and the clean mission's tools.

**From third-party pages, not confirmed:** that Mureka has an API and paid commercial tiers, and the prices. **Not checked:** Mureka's own terms, API behaviour, tempo control, instrumental
mode and licence for stored songs; Mixamo's current catalog names and terms; whether the game's rig has Kip's joints; whether every wig clears a headphone band; current children's
listening-safety guidance; that headphones print support-free in either route.
