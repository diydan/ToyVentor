# Dance party: headphones, Mixamo dances, AI songs and a kitchen and clean-up exercise: spec (draft 2, 2026-11-03; decisions made; headphones, dances, party mode, a 12-song Mureka starter library and a Dance picker built; no live song maker Worker yet)

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
| D8 | The slow-card gap (no dance below 96 bpm) and where live beat maps are made? | Dan: **build the slow sway clip** (done: `dance_sway`, 6.3); live beat maps in the browser: **skip unless easy** (not easy: left out, the starter library is analysed by a script). |
| D9 | What does Mureka's own site say? (Dan, on his account, 2026-11-03) | Licence allows a **children's app and stored songs: yes**; **instrumental-only: yes**; **commercial rights on the API tier: yes**; **tempo or key control: no**; **generation takes 2 to 5 minutes**. Dan's "no" for **API price per song and rate limits**, and for **clip length**, is read here as *not found*: those are still unknown (4.1). |
| D10 | Live song maker default, and the price? | Dan (2026-11-03): **on** (replaces my proposal of off until a grown-up enables it), and the API price is **$0.045 a song**. So the maker is on from the start, with a notice, and a grown-up can switch it off or lower the weekly limit (4.6). Still Dan's to set: the **monthly dollar cap** (`budgetSongs(dollars, 0.045)` turns it into the song count the Worker holds: $50 is 1,111 songs, $20 is 444). |
| D11 | Next after party mode works ("all perfect") | Dan (2026-11-03): **a)** add songs, theme songs made with the Mureka API; **b)** an option to choose the dance move from the dances already in the repo. Both built (6.5). |

**Why A for the headphones.** (1) It changes no verified part; option B changes all 12 heads, every wig vault and hat cavity, and the seating matrix, before one head has
been printed (the calibration prints are still being scored). (2) The digital version, which is most of the value in the game, ships either way. (3) The one real
risk, the print route for the arch, is cheap to spike on a single part. (4) A does not block B later. **Cost of A:** headphones replace the hat in the crown slot,
and they need a wig-clearance check; if a hairstyle fails it, headphones are offered with bald heads and the Hat-Ready wigs only.

## 1. What exists today (verified in the repo, 2026-11-03)

| Area | Fact |
| --- | --- |
| Heads | 12 heads, each `top_studs` + `under_sockets`; humans also `face_slot`. Widths measured on the STLs: kid 38.2, chibi 39.5, tall 40.0, jumbo 39.6 mm; fox 48.8, cat 48.0 mm. Heights 33.8 to 38 mm. |
| Ears and hats | `pointy_ears`: Snap add-on, grid 2x2 with a two-hole pad, `lock`, slot `head`, behaviour "Twitches when a sound plays" (a sound-reactive add-on already exists). `hat_beanie` and friends are *wearable* hats that wrap the head (rim on the bed, cavity from `HAT_CAVITY_SLICES`). Ears, horns and hats share the crown slot, so only one is worn. |
| Kip clips | 28 hand-built clips in `kip-clips.js`: 6 reactions, 4 dances (`dance_boogie`, `dance_robot`, `dance_disco` at 120 bpm, and `dance_sway`, the slow one, at 80 bpm), 18 prop clips. Every dance carries its authored `bpm` and `beats` (a test checks `dur x bpm / 60 = beats`). Prop clips now have planted feet and natural hands (commit `6c18327`). |
| Mixamo | Two sample files in `public/kip/mixamo`: `Xbot.glb` (agree, headShake, idle, run, sad_pose, sneak_pose, walk) and `Michelle.glb` (SambaDance, TPose). **One dance only (Samba).** They come from the three.js examples (MIT), listed in `THIRD_PARTY.md`. `retargetMixamoClipToKip` (in `kip-bench.js`) maps them onto Kip's rig, which has **14 joints, no spine and no fingers**. |
| Mixamo licence | From an Adobe community copy of the FAQ (2022, not Adobe's current terms; recheck): commercial use and games allowed; the raw files may not be the product; embedded and not extractable is the common reading; no attribution; **not allowed as machine-learning training data** (keep Mixamo clips out of the Forge AI training sets). Needs an Adobe login to download. Any new clip needs a `THIRD_PARTY.md` entry. |
| Game audio | `runtime/audio.ts`: a **procedural WebAudio engine** (`SongDef`: bpm, root, scale, wave, pad, decay; one song per world, a gain bus with reverb) plus sound effects. No sample or file playback of music. A free, offline fallback already exists. |
| Worker | D1 (`DB`) and Workers AI (`AI`) are bound. Routes: `muse.ts`, `meta.ts` (Muse proxy), `voice.ts` (TTS), `parent.ts` (parent gate), others. **No R2 bucket and no KV**: song files cannot be stored in the Worker today. Starter songs could ship as static files. |
| Game props | The game loads prop STLs from `/kip/partspec/` through `resolveCharacterPropUrl` in `stlRigLoader.ts`, but maps only five ids (`robot.arms.*`) and falls back to the flag. It does not use `kip-clips.js` (grep finds `kipClips` only in the viewer). **Not checked:** whether the game's rig exposes the same 14 named joints; section 6 makes that the first spike. |
| Cooking and cleaning in the game | `daily.cook` (3 pick questions: wash hands, count spoons, "the oven is hot, who opens it?" a grown-up), `daily.meal`, `daily.clean` (2 questions). The `clean` mission has tool buttons (vacuum, mop, sponge), three mess types (crumbs, puddle, jam), wrong-tool lines in `CWHY` ("Mopping crumbs just makes mush"), and a soap-drop window by tier. |
| Props we have | Printable: spatula, frying pan, mop, broom, scrub brush, handheld vacuum, upright vacuum, plus paint roller, hammer, guitar, trumpet, maracas, flag, magnifier, wrench, screwdriver. Digital household items: bowl, plate, mug, wooden spoon, sponge, bucket, fruit. **No whisk, ladle, pot or microphone.** |

## 2. Headphones

### 2.1 What they are

A **Snap character add-on in W9, the wardrobe wave** (decided while building: its stat is "Glow", which W9's stat rule already allows, so the Kip export and the part-count tests needed no new wave): a band over the crown ending in two cups, with
a small pad on the crown studs like `pointy_ears`. Catalog row: `family: addon`, `type: Character add-on`, `slots: ["head"]`, `front: symmetric`,
tags `headphones, head, character, kip`, behaviour "Cups glow to the beat" (the same idea as the ears' "twitches when a sound plays"). It takes the
crown slot, so it is an alternative to a hat, horns or ears, like they are to each other.

### 2.2 Option A (chosen, D2): crown band, no head change (spike done, 6.1)

- The band sits on the crown `top_studs` like a hat: it is cut from the **hat shell**, so it reuses the wig-envelope vault (the Hat-Ready wig envelope plus 0.45 mm clearance) and the sequential-bridge crown sockets that already pass the gate.
  It is a 12 mm wide strip over the crown, legs straight down both sides, and a small tapered cup on each leg. **One piece**, no separate cups.
- **It prints upside down** (`print_rotation_deg` [180, 0, 0], the standard Snap add-on orientation). Worn, the 33 mm flat crown ceiling would exceed the 20 mm bridge limit; flipped it is a flat floor.
  Prototype: `parts/partspec/spikes/headphones_proto.py` (not a catalog part).
- **Measured on the prototype:** part gate `verified`; a real OrcaSlicer slice with your profile (supports on, auto, 30 degrees) gives **0 support, 0 overhang-wall and 0 bridge moves, 35 min, 3.7 g**; printed size 59.9 x 13 x 31 mm.
- **Fit, by interference volume against each head's model with the band on its crown studs:** the four human heads (kid, chibi, tall, jumbo; 38.2 to 40.0 mm wide) **0.00 mm3**. Everything else collides: fox, cat, dragon 470 to 706 mm3 (about 48 mm wide), bear, alien, imp 550 to 770 mm3
  (55 mm), robot visor 32 mm3 (45.4 mm) and robot scout 225 mm3 (47.3 mm). So **v1 is for the four human heads**; each of the others needs its own, wider band (its own cavity envelope, not the human one), a later wave.
- **Wigs and hats (measured, each wig seated on a chibi head, the band on the wig's own top studs 4.8 mm above the head's):** **0.00 mm3 with the five short Hat-Ready wigs** (short swept, swoosh, shag, bowl, slick); **collides with the three long Hat-Ready wigs** (bob 104 mm3,
  long layered 200 mm3, twin braids 297 mm3: their hair hangs past the hairline to where the legs go); the other 11 wigs have no top studs, so nothing can be worn on them (the same rule as hats). **So headphones fit a bald head and five of the 19 wigs.** A hat cannot be worn with them.
- **To tune:** the cups sit low (jaw rather than ear) and small (12 mm), because the cup tip may not rise above the leg top (below); raising them needs a shorter, more tapered cup. The band's look is blocky, which suits the toy.
- Gates for the real part: the normal part gate, the small-parts screen, preprint check, **and the Orca slice as part of the gate for this part**, because the part gate cannot see a pointed tip that starts in mid-air (6.1).

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

**GitHub copies exist (searched 2026-11-03).** Public game repos hold re-uploads of the exact files, for example `Hip Hop Dancing.fbx` (`floAr/SecretHeroes`, `EntertainmentEpta/LeavingPlerotus`), `Swing Dancing.fbx` (`Fedorr47/CoreEngineModule`; `ZehuaLiuY/Team-B` has it baked into a character as `Cheese@Swing Dancing.fbx`), `Locking Hip Hop Dance.fbx` (`kimkyusoo/3D_Raycast`, `SeungYeonKo/Jang-Yeongsil`), `Silly Dancing.fbx` (`mccallw23/NocturnalOrder`, `TKscoot/Ivy`), and the Twist reserve (`Twist Dance.fbx` in `JakubSum/Action_Figure` and `CarouselDancing/baseline-agent`; Chicken Dance turned up only as a Unity `.meta` file in `iwae/easyCtrl`, the model itself unverified). All are `.fbx` (our pipeline reads `.glb`: a conversion step is needed), none of those repos has a licence, and two (`CarouselDancing/baseline-agent`, `SeungYeonKo/Jang-Yeongsil`) hold Git LFS pointers of about 130 bytes, not the files. A GitHub repo cannot grant Mixamo's rights, so **the shipped files should still come from Dan's own Mixamo download** (and never be committed raw, 3.1); the copies are good for a throwaway scratch prototype (retarget, `kip-dance-gate.mjs`, a contact sheet) to see which dances are worth downloading. A `.glb` search was rate-limited by GitHub and is unchecked.

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

### 3.1b Received and measured (2026-11-03)

Dan downloaded five files to `.local/mixamo/` (git-ignored, so the raw files cannot be committed; the shipped result is baked joint data, not the FBX): `Hip Hop Dancing.fbx`, `Hip Hop Dancing (1).fbx`, `Swing Dancing.fbx`, `Silly Dancing.fbx`, `Chicken Dance.fbx`. **Locking Hip Hop is not there yet.** All five are FBX 7700, one clip each, 30 keys a second, no skin. Read with three's `FBXLoader` in Node (no Blender or FBX tool is needed to inspect them). Numbers are in the file's units (centimetres; standing hips are about 100):

| File | Length | In place? | Hips low? | Loop seam | Bounce rate (hips height, whole beats per loop) | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Hip Hop Dancing | 6.10 s | **no: travels 149 cm forward** (the "In Place" box was not ticked) | never below 93 | pose 0.0 degrees, position does not return | 10 beats = 98 bpm | **the Hip Hop pick**; needs its forward drift removed |
| Hip Hop Dancing (1) | 13.77 s | yes (0 drift) | **drops to 38 cm** at 9.3 to 9.9 s and 11.8 to 12.3 s (floor work) | 0.3 degrees | 23 beats = 100 bpm | **spare**: the first 9 s are upright and could be cut as a longer variation; the same dance and tempo as the pick |
| Swing Dancing | 20.90 s | returns to start, but **wanders 233 cm sideways** | never below 84 | 0.1 degrees | 48 beats = 138 bpm (or 24 = 69) | fast role; the sideways wander has to be reined in and the footwork checked by the gate |
| Silly Dancing | 3.83 s | yes (travel 32 cm) | never below 87 | 0.0 degrees | 8 beats = **125 bpm** (or 4 = 63) | cleanest clip; fast, not the slow role the spec guessed |
| Chicken Dance | 4.77 s | yes (travel 19 cm) | dips to 70 once (a squat at 2.8 to 3.2 s) | 0.0 degrees | no clear beat (5 = 63, 6 = 76, 7 = 88 bpm) | short and arm-led; tempo has to be counted by eye |

The bounce rates are the strongest whole-beats-per-loop in the hips' height (a looping clip can only beat a whole number of times per loop); they are estimates, and 3.3 still says a person counts each clip once on the contact sheet. Two jobs follow: a **drift remover** for the baked-clip tools (subtract the linear ramp of hips x and z so a travelling clip loops in place; `plantBakedClip` only scales the wander, it does not remove a one-way drift), and the **FBX route into the bench** (the page loads Samba from a GLB; these are FBX, so the bench needs three's `FBXLoader` for a scratch run, and the shipped dances become baked joint data with no raw file).

**Second batch (2026-11-03).** Dan downloaded 14 more, so `.local/mixamo/` now holds 19 files and an `INDEX.md` (the five Hip Hops are renamed by length, since Mixamo gave them clashing names and they are different clips). **Locking Hip Hop Dance** arrived (17.0 s) but the hips are low for 21 % of it (crouches at 5.3 to 6.8 s and 11.6 to 12.8 s) and it drifts 61 cm: the upright stretches would have to be cut. The Hip Hop pick changes to **`Hip Hop Dancing 4.7s in place.fbx`**: in place (travel 14 cm), upright (hips 92 to 108), loops cleanly, 8 beats = about 101 bpm; two more in-place upright Hip Hops came (5.2 s and 15.3 s, about 104 and 106 bpm) as alternates. Non-dance clips, for other parts of the project: **Waving** (0.53 s, one quick wave), **Clapping** (1.17 s; the two files have identical motion), **Standing Cheering** and **Standing Fist Pump** (3.4 and 3.5 s one-shots: crouch, cheer, settle), **Jump** (0.93 s, the hips rise 68 cm and travel 251 cm forward because "In Place" was off: the drift is stripped), for the game world's clip bank, which has no wave, cheer, clap or jump; **Jumping Jacks** (1.07 s, one jack, loops), **Arm Stretching** (8.9 s) and **Neck Stretching** (3.2 s) for the movement break (5.2); **Sleeping Idle** (17.6 s, a lying pose with the hips at 13 to 20 cm) for the game's `sleep`, **not** for the Kip bench, whose grounder keeps the lowest foot on the floor and would float a lying body. Mixamo has **no Eating animation** (Dan checked), so the hand-built `eat` stays. **Third batch:** **Guitar Playing** (4.8 s, in place, loops, about 8 beats = 101 bpm) for the music and kitchen band, **Pick Up Lifting** (7.2 s, in place, a bend to pick something up) for the fallen fruit, **Push** (8.0 s, travels 325 cm forward, flat hips) for the game's shove, from which a 1 to 1.5 s thrust would be cut. Open: a tree apple is picked from a branch, so it needs a reach UP, which these do not have.

### 3.1c Phase 2 intake: built (2026-11-03)

**What was built.** `scripts/mixamo-bake.mjs` turns the FBX files in `.local/mixamo/` into small joint-data JSON in `public/kip/mixamo/baked/` (17 files, 1.1 MB; the table of clips is `scripts/mixamo-clips.json`). Per clip: parse (three's `FBXLoader`, in Node) -> optional trim -> take the hips' drift out -> retarget onto Kip's 14 joints -> optionally close the loop -> cap the wrists (`limitHands`) -> plant the feet (`plantBakedClip`, not for a jump or a cheer) -> check -> write. **No raw Mixamo file is served or committed** (a test fails if an `.fbx` is tracked; `.local/` is git-ignored; `THIRD_PARTY.md` has the entry and the not-for-AI-training rule). The retargeter moved out of `kip-bench.js` into `kip-mixamo-retarget.js` (pure, takes THREE) so the Node tool runs the SAME code as the page; the shared half (drift removal, trim, loop closing, the JSON format and its checker) is `kip-baked-clips.js`; the bench loads the index at start and skips any clip that fails its own check. Samba is unchanged by the move (gate numbers identical).

**Result.** 16 clips baked and registered in the bench's clip menu: five dances (**Silly Dance** 125 bpm, **Hip Hop** 101, **Swing** 138, **Chicken Dance**, **Locking**), three movement-break moves (**Jumping Jacks** 112 bpm, **Arm Stretch**, **Neck Stretch**), **Guitar Strum** (101 bpm), and the game-world reactions and actions (**Wave**, **Clap**, **Cheer**, **Fist Pump**, **Jump**, **Push**, **Pick Up**). The real-page dance gate now runs every shipped clip with planted feet along with the procedural dances and Samba: **18 clips, 90 checks, 0 failures** (loop seam under 1.5 degrees, floor slide under 1.5 mm, standing height, no backward knee, wrist bend 8 to 35 degrees). 22 new tests (`tests/kip-baked-clips.test.ts`) check the tools, every shipped file, the feet and wrists computed from the baked data, and the wiring; the data tests and the tools were each mutation-checked (a sliding foot, an open loop, an orphan file, a wrong tempo, a drift remover and a loop closer that do nothing). With the procedural dances, **some dance fits every song from 64 to 170 bpm** (the procedural set alone stopped at 150).

**What was done to each source clip.** Silly, Hip Hop (the 4.7 s in-place one), Chicken, Jumping Jacks, the stretches and Guitar were already in place and went through as they were. **Swing** wandered 2.3 m sideways: a 2 s high-pass took 113 cm of slow wander out and kept the rhythm. **Locking Hip Hop** is cut to its first 5.2 s (the rest has floor crouches) with a 0.5 s ease back to the start so it loops. **Push** (325 cm) and **Jump** (251 cm) had their forward drift removed. Jump, Cheer and Fist Pump are not foot-planted (the feet leave the floor on purpose).

**Seen on contact sheets (numbers had passed first).** The dances read as dances on a rig with no spine or fingers: Silly crosses its arms in front of the chest, Hip Hop reaches out, Chicken flaps and puts its hands on its hips, Swing includes a body turn, Locking has its hits and leans. Push leans hard into something heavy and releases; Pick Up bends, squats, lifts and holds the thing to the chest. **Cheer and Fist Pump start and end in a crouch** (a crouch, a leap and a fist, then back down). **Guitar Strum is small without a guitar in the hand** (a head tilt and a low strum), so it is labelled a strum, not "air guitar".

**Not done, and why.** (1) **Chicken Dance and Locking have no tempo**: their hips show no clear beat, so they carry no `bpm` and a song cannot pick them (the tempos above are estimates from the hips' bounce and still need an ear check). (2) **Sleeping Idle is not baked**: a lying pose (hips at 13 to 20 cm) cannot be shown by the bench, whose grounder keeps the lowest foot on the floor; it is for the game's `sleep` and needs the game's own path. (3) **The game world does not play any of this yet**: its clip bank (`mixamo.ts`) reads a GLB and bakes shoulder-to-hand directions for rigid arms, so Wave, Cheer, Clap, Jump, Push and Pick Up need a converter into that format (the baked Kip joints are the intermediate data for it). (4) The Hip Hop alternates (5.2 s, 15.3 s, 13.8 s, 6.1 s) are unused. (5) The guitar prop is not matched to the strum (the prop is rigid in the right hand and the left hand has no solver).

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

**The gate and the tools are built (2026-11-03), ahead of the downloads.** `node scripts/kip-dance-gate.mjs [id:seconds ...]` (needs `E2E_GPU=metal`) measures a dance in the real page and fails it on: loop seam over 2 degrees, a foot on the floor travelling over 3 mm, the lowest ankle outside standing height (12.9 mm, plus or minus 3), a knee bent backwards, or a bare-hand wrist bend over 45 degrees. Two tools prepare a baked (Mixamo) clip in `kip-clips.js`, and the bench applies both to Samba right after it retargets it, which is where a new dance goes:

- `limitHands(THREE, clip)`: caps each wrist's bend (35 degrees) and forearm twist (100) and keeps the rest. Samba's retarget bent the wrist **59 degrees**.
- `plantBakedClip(THREE, clip)`: mocap skates on Kip's rigid legs (Samba: a foot on the floor travelled **29 and 41 mm**). It reins the hips in (sideways travel scaled to 30 %, because Samba's hips wander plus or minus 25 mm against 51 mm legs; the vertical bob settled so its top is standing height), then re-solves both legs with the same solver as the procedural clips, lifting a foot straight up by how much it is raised above the other one in the original legs, 14 mm at most. Steps survive as lifts; nothing slides.

Baseline, all four dances Kip has now (after the fix; Samba's numbers before it in brackets): loop seam 0.1 to 1.2 degrees; floor slide 0.0 to 1.3 mm (Samba [29 and 41 mm]); lowest ankle 12.8 to 14.5 mm; wrist 0 to 33 degrees (Samba [59]); **20 of 20 checks pass**. The three procedural dances were planted the same way (boogie lifts a knee 7 mm on alternate sides, disco 6 mm, the robot dance squats with both feet down), with a `setQ('LiftFeet', left, right, 0)` hook in the clip for a stepping move. A downloaded dance that still fails the feet check after this is a clip to fix or drop.

### 3.3 Tempo

A clip is stored with its authored `bpm` and `beats` (a Mixamo clip has no tempo in the file, so someone sets it once, by counting). In the party a dance is
**time-scaled to the song** by whole bars: rate = song bpm / clip bpm, clamped to 0.8 to 1.25; outside that range pick another clip. A song never plays a
dance more than a quarter off its natural speed, because slowed or sped Mixamo motion looks wrong at the extremes.

**Built (6.3):** every dance in `kip-clips.js` now carries `bpm` and `beats`, and `shared/songBeat.ts` has the rule (`tempoRate`, `pickDance`). The three 120 bpm dances cover songs from 96 to 150 bpm; the new `dance_sway` (80 bpm, 8 beats in 6 s) covers 64 to 100, so a test now checks that **some dance fits every song from 64 to 150 bpm**. Because Mureka has **no tempo control** (D9), the tempo on a card is only a hint: the song's real tempo is measured (4.4) and picks the dance. A song outside 64 to 150 gets no dance (lights and cup glow only) unless a clip can run in half or double time (proposed, not built: a second Kip bobbing on every second beat of a 170 bpm song reads as the 85 bpm sway at natural speed).

## 4. Songs with Mureka (the "song maker")

### 4.1 What is known, and not (read before spending)

From third-party pages only; **I could not open Mureka's own terms or pricing, which need a login**. Dan checks these on mureka.ai.

- Mureka offers subscription plans with commercial licensing on paid tiers, and an API (a song-generation endpoint at `api.mureka.ai`); free-tier output
  appears to be non-commercial with attribution. Pages disagree on the price of the entry plan ($8 vs $10 a month) and say nothing reliable about **API**
  pricing.
- **Answered by Dan from his account (2026-11-03, D9; the licence wording itself I have not seen):** the licence allows a **children's app and storing and serving the songs**; **instrumental-only exists**; the **API tier carries commercial rights**; there is **no tempo or key control**; a song takes **2 to 5 minutes** to make. These clear the phase 0 gate for the song half.
- **Looked up 2026-11-03, third-party sources only (Mureka's own platform pages render in JavaScript and my fetcher saw just their title; Dan confirms on the pricing page before `SONG_MONTHLY_BUDGET` is set):**
  - **Price:** the official API is a separate product at `platform.mureka.ai` with its own keys and **prepaid** billing. Instrumental generation is listed at about **$0.03 a track on V7.6 and $0.15 on V9.5** (one guide); a fal.ai pull request quotes $0.045 / $0.0675 / $0.225 a request for V7.6 / V8-V9 / V9.5 (a reseller's price); another says "from $0.045 a song". At our full use of about 21.7 songs per user per month (4.6) that is **about $0.65 (V7.6) to $3.30 (V9.5) per active user per month**, if a call is billed once however many songs it returns.
  - **Limits:** parallel requests grow with the prepaid top-up (one guide: 1 at the $10 tier, 5 at $1,000, 15 at $3,000; another says the API needs $1,000 up front: the guides disagree, **ask Mureka**). **One generation at a time** is the safe assumption for a small account, so live songs need a queue as well as a wait (4.3). A wrapper also reports a 429 if calls come closer than 3 seconds.
  - **Shape:** submit a task, then poll it until it finishes (`POST /v1/instrumental/generate`, then a query-task call: the exact query path is reported two ways). A call returns **2 songs by default (up to 3)** as MP3, **up to 5 min 30 s** each, from a prompt of **at most about 1000 characters** (ours are under 260); **there is no tempo, BPM or duration field** (matches D9). Whether one call is billed as one song or two is not stated.
  - **Time:** Mureka's FAQ publishes no turnaround; a wrapper reports **30 to 90 seconds**, an average of 45. Dan saw 2 to 5 minutes: **plan for 5**, the 10 minute reservation limit holds either way.
  - **Licence:** the FAQ says paid output carries "full commercial usage rights"; it says nothing about children's apps (Dan's reading of his account, D9, is yes).
  - **Measured since (6.5):** the price is **$0.045 a song** on `mureka-9` (checked against the balance), generation takes **38 to 69 s** for a call of 2 songs, the account allows **5** songs at once, and Mureka's own reference (`docs/specs/mureka-api-reference.md`) confirms the billing is per song and that **an audio watermark is appended to the end of generated files**, which is why the excerpts are cut from the middle. `n` sets how many songs a call returns and bills (1 to 3, default 2). **Still not known:** the per-model price sheet (only `mureka-9` was tried), and a content-safety option for the official API (one reseller exposes `enable_safety_checker`, default on).

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
- **It is asynchronous (D9: 2 to 5 minutes).** A Worker request cannot be held that long: the child's tap **submits** (reserve a slot, start the job, store a job row), the child sees a "cooking your song" wait (the shared waiting strip from Describe & Build is the model) and **the party keeps playing library songs meanwhile**, and the new song arrives later (a chip on the next visit, or when the page polls). The slot is reserved at submit and committed when the audio is stored; the 10 minute reservation limit (`RESERVE_TTL_MS`) is twice the slowest time Dan saw, and a song that finishes after it is not kept.
- **Moderation:** an **instrumental** song made from the closed cards plays as soon as it arrives (a child should not wait for a grown-up as well), and appears in the parent sheet "New songs", where a
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
- **Budget.** At full use a user makes about 5 x 52 / 12 = **21.7 slots a month**. At Dan's **$0.045 a song** (D10) that is **about $0.98 a user a month if a call bills one song, about $1.95 if it bills the default two** (a call returns 2 songs, up to 3; whether a call can be asked for just one is unverified). The provider bills per **song** and a call can return several, so a reservation counts `songsPerCall` songs against the budget, not one, and a call that would pass the budget is refused (`shared/songQuota.ts`); the child's week is still five slots whatever a call bills. The Worker holds `SONG_MONTHLY_BUDGET` in songs (`budgetSongs(monthlyDollars, 0.045)`: $50 a month is 1,111 songs, about 51 users at full use at one song a call or 25 at two); when it is spent, live songs stop and the party plays the library (fail closed), and a grown-up sees "the song maker is resting". No dollar cap is set yet: **Dan's call**.
- **Grown-up controls.** The live song maker is **on by default, with a notice** (D10: Dan chose this over a one-time grown-up enable; it sends no child data and only closed-list cards, 4.2); a grown-up can **switch it off** behind the parent gate (`songMakerOn`: not set is on, only a plain `true` is on once set, so a corrupt setting reads as off), and can lower the weekly limit (0 to 5) but not raise it above 5; the library is always on.

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
| **0 Decisions and spikes** (about a day) | Decisions are made. Dan checks Mureka's terms on his account and makes one test song (and reads the API price per song). Dan downloads the dances. Spike: **a prop in the game's hand**: done, answered by reading the code (6.1): the game's rig has rigid arms, so two routes. Spike: the headphone print route: done (6.1), support-free as one piece for the human heads. | Mureka allows a children's app and stored songs; the print route passes one gate run; the game spike works or the exercise stays in the Kip bench. |
| **1 Headphones** | Catalog row and part (option A), viewer slot, glow hook, print BOM, regeneration through the landing checklist (one batch), selftest, Orca slice. | Part gate verified; Orca 0 supports; head x wig matrix passes; menu and print e2e. |
| **2 Mixamo dances** | Intake the 4 picks (and a reserve if one fails), retarget, the section 3.2 gate, `THIRD_PARTY.md`, contact sheets, menu entries. | Every shipped dance passes the gate; Samba and the three procedural dances still pass `tests/kip-clips.test.ts`. |
| **3 Songs and the party in the Kip bench** | Starter library (about 12 instrumental songs made once, listened to, beat-mapped), beat clock, tempo-scaled dances, cup glow, party panel, age-band beat play. No Worker needed. | Beat error: a tap within 80 ms of a beat counts, measured on a real song; the dance does not drift against the clock over 60 s. |
| **4 Live song maker** | `worker/song.ts`, caps, parent gate, moderation queue, storage decision, "new song" card. | Cost per song known and capped; a failed or capped call falls back to the library; a moderation pass by a grown-up exists. |
| **5 The exercise in the game** | Game prop-in-hand via Route 1 (6.1: a wrist pivot on the game's hand and a baked arm-direction plus hand-orientation track from the retargeter; generalise `resolveCharacterPropUrl` to a data table: Kip prop id to STL, `flip`, `mat` and clip, read from the wardrobe rows so the viewer and the game cannot drift), the cook and clean sessions, the movement break, the two primitives or their plain forms. | Every prop the sessions use renders in the game's hand with its clip; the sessions are completable by the "random toddler" robot (`play-design-spec.md`). |
| **6 Carousel and map** | A party entry in the carousel and a map stop, parent controls, the Garage-style weekend variant if wanted. | After the real-phone pass (C4 is waiting on it). |

### 6.1 Phase 0 results

**Spike: a prop in the game's hand (done 2026-11-03, by reading the code; nothing was run in the game).** The answer is **no, not as the game stands**, and it points to two routes.

- **What the game's Kip is.** The in-world character (`stlRigLoader.ts`, `mixamo.ts`) is the **Snap figure with rigid one-piece arms**: `snapArm` is one STL, the hand mesh is fixed on its end, and the Mixamo driver bakes each clip into
  per-frame data where **each arm is only a shoulder-to-hand direction ("no twist")**, the torso and head are rotations, and the hips a small bob. There is **no elbow, no wrist, no forearm and no hand orientation**. It has no 14-joint skeleton,
  so `kip-clips.js` cannot play on it, and the retargeted natural-hand arms cannot be copied across.
- **Reach differs too:** the viewer's chain is 46.4 mm from the shoulder to the hand joint (23.8 + 22.6); the game's hand mesh origin is 35.8 mm from the shoulder (constants read from the code, not measured in a render). A baked prop track has to be solved for the game's
  reach, not copied.
- **Route 1, in-world sessions (Help cook, Clean up):** add a **wrist pivot** to the game's hand (the hand wrap is already its own group), and bake, for each prop clip, the arm *direction* plus the hand's *world orientation* (the retargeter already solves the natural hand, so it can emit
  this); the prop is a child of the hand with the `flip` mount. Small: one new baked track, one pivot, one prop table keyed by the wardrobe rows. Cost: a stick arm with a turning hand, which is what the physical Snap toy does too.
- **Route 2, the party:** Workshop stage **4d** mounts the benches (the articulated Kip, all 28 clips, the props, the dances) inside the game as a Factory-tab host. **The party lives there at no extra rig work** and gets the print gate with it. 4d has a
  grown-up print gate blocker of its own (`workshop-spec.md`, 4d scope).
- **Decision for phase 5:** the party ships in the Kip bench and rides 4d into the game; the in-world cook and clean sessions use Route 1. If Route 1 proves too costly, the sessions can run in the mounted bench too.

**Spike: the headphone print route (done 2026-11-03).** Answer: **yes, support-free, in the flipped orientation, as one piece** (numbers in 2.2). What it took, so the real part does not repeat it:

- The worn-orientation print fails `P4_no_ledges` (211 mm2): the flat crown ceiling spans 33 mm along the band, past the 20 mm bridge limit; a hat avoids it by bridging across the head's 20 mm depth, a narrow strip cannot. Flipping removes it.
- Flipped, every joint that is narrower or wider than its neighbour becomes a downward ledge (the gate allows 1.0 mm2 of steep face and 1.0 mm2 of ledge, per `interfaces.json`): the legs must be the shell itself, extended straight down (rings and cavity), not a separate box.
- A cup that is a horizontal cylinder fails P1 and P4 (flat or shallow underside). A **teardrop** section (a point at 52 degrees on the lowest side) fixes it. **Trap:** the point must be in angular order in the polygon, or it is silently dropped and the "teardrop" is a plain circle (this cost most of the spike).
- **The part gate has a blind spot:** a cup whose pointed tip starts above the bed with nothing under it passes every face-angle check and would still need a support. The render showed it; the **Orca slice is the real check**, so keep it as a gate for this part (and consider it for every new part).
- Not done: the viewer and print BOM, a catalog row, adding the band to the head x wig x hat x plate seating matrix (the wig numbers above came from a one-off script), and a physical print.

### 6.2 Phase 1: headphones landed (2026-11-03)

`hat_headphones` ("Party Headphones", W9, family `hair` like the hats, 2x1 crown sockets, stat Glow) is a catalog part, built by `hat_headphones` in `toyventor_parts.py`, with the Kip viewer wired and tested. **Not a print yet.**

- **Part:** printed 59.9 x 13.0 x 24.5 mm, 3.43 cm3; part gate `verified`; `preprint_check` "Prints as is"; a real OrcaSlicer slice of the landed STL (your profile, supports on) **0 support, 0 overhang and 0 bridge moves, 30 min 30 s, 3.35 g**. The cups were raised to ear height after the spike by embedding their pointed tips in the shell wall.
- **Fit:** the four human heads **0.00 mm3 interference**. `kip_partspec.py` now has four headphone assemblies (bald kid; chibi with Swept; tall with Bowl; jumbo with Sleek Part) that pass the real collision validation with no warnings, so the export is **74 parts and 50 assemblies**. The long Hat-Ready wigs collide (Bob 100 mm3, Long Flow 145 mm3, Twin Braids 259 mm3) and so do the animal and robot heads: not offered there.
- **Fit matrix:** 66 new pairs (as designed); the same loop reproduced the 66 tracked `hat_beanie` pairs exactly first.
- **Viewer:** a "Party Headphones" entry in the hat list; `earReady` on the six hair options that fit (None, Swept, Swoosh, Shag, Bowl, Sleek Part); one helper, `headphonesFit(head, hair)`, used by the bench, the print BOM and the menu, so they cannot disagree. Choosing the headphones on a long wig switches the hair to Swept; on a non-human head the request is ignored; changing hair or head to something that does not fit puts the crown back to the studs. The viewer turns the upside-down STL back (+90 degrees about x, lifted by the 4 mm roof). The print BOM lists it like a hat and says so when it is left out.
- **Checked in the real viewer** from three cameras (bald chibi, kid with Swept, full figure): right way up, on the crown, cups at the ears.
- **Not done:** wider bands for the animal and robot heads, a physical print, and the cups' glow to the beat (phase 3, it needs the song clock).

### 6.3 Phases 3 and 4: the pure logic (2026-11-03; built and tested, not connected to anything)

Three modules in `shared/` that need nothing from Mureka or Mixamo, with 84 tests (`tests/song-beat.test.ts`, `song-quota.test.ts`, `song-cards.test.ts`; typecheck clean). The app, the Worker and the viewer do not import them yet.

- **`shared/songBeat.ts`: the song clock (3.3, 4.4, 5.1).** `makeBeatMap` / `parseBeatMap` turn beat times into `{ bpm, beats, bars }` with the tempo **measured from the beats**; a stored map whose `bpm` is not what its beats measure (the tempo that was asked for, not the audio's) is rejected, as is a missed or invented beat (a gap outside 0.6 to 1.6 of the median), fewer than four beats, or a tempo outside 40 to 220. `beatAt` places a song time on its beat from the song's own beats. `clipTime` plays a dance against **beats, not seconds**, so every song beat is the same point of the clip every loop: over a 60 s song whose tempo wanders by 6 % the stopwatch clock (`t x rate`) is more than the 80 ms tap window off the beat and `clipTime` is exact (the phase 3 "no drift over 60 s" gate, tested on both, so the check can fail). `tempoRate` / `pickDance` implement the 0.8 to 1.25 rule (nearest to natural speed first, then by id, `variant` for a second Kip, none when nothing fits). `beatPulse` is the flash for the lights and the headphone cups. `judgeTap` / `scoreTaps`: a tap within 80 ms counts (79 hits, 81 misses, both tested), one hit per beat, the nearer tap wins, order does not matter, and output latency is taken off the tap because the child taps on what they hear. `beatPlayFor(band)` is the 5.1 table (0 and 1 free with no wrong taps, 2 on the beat, 3 copy 4, 4 and 5 compose 8; a corrupt band reads as the youngest).
- **`shared/songQuota.ts`: 5 new songs a week (4.6, D4).** Pure transitions over a serialisable state: `reserve` (idempotent on the key; checks, in order, request, grown-up enable, **monthly budget**, week), `commit`, `refund`, `status` (pips left and the Monday they return). The week is Monday to Sunday by the **family's timezone** (parent-time `localDay`), tested at Sunday 23:59 and Monday 00:00 in UTC, Los Angeles and Auckland, across a new year and a leap day, and the same check fails on a UTC week. A slot counts for the week it was **reserved** in. The grown-up's limit is 0 to 5, never above 5, and a corrupt value reads as 0; a budget that is not a whole number reads as 0 (fail closed). A failed or refused call frees the slot **and** the budget; a song a grown-up removes frees the slot but **not** the budget; a reservation held 10 minutes (`RESERVE_TTL_MS`) expires, frees the slot and keeps counting against the budget. A cleared device id gets a fresh week but cannot get past the budget (tested: 20 fresh ids, budget 7, 7 songs). **Added after D10:** the live maker is on unless a grown-up turned it off (`songMakerOn`), the budget counts **songs billed** (`songsPerCall`, a wrong value reads as 3, the most a call bills) and refuses a call that would pass it, and `budgetSongs(dollars, price)` turns a dollar cap into songs (tests: 92 across the three song files; the random-sequence check also holds at 2 and 3 songs a call and catches a budget that counts calls).
- **`shared/songCards.ts`: cards, never words (4.2).** Six moods, three tempos, eight instruments (up to two; unknown ones dropped), each an id from a closed list; the prompt is a fixed template filled only from that list's own text. All 666 pick combinations make a plain-text prompt that says instrumental, no vocals, no lyrics, and names no song, artist or person; hostile text in every field (an injection line, a pop star's name, an address, markup, SQL) never reaches the prompt, and the same check fails on a builder that lets the client's words in.

**The tests found real faults; these are fixed.** (1) A random-sequence check with its own spend ledger (so a version that forgets a record cannot hide it) found that a key reused after a **removed or expired** attempt overwrote the old record and **erased that spend** from the budget; the old attempt now moves to `key~n` (which no valid key can be) and keeps counting. The same test file fails on the version without the fix. (2) `commit` and `refund` only noticed an expired reservation if some other request had swept it first, so whether a late song was kept depended on traffic; both now take the time and expire first. (3) A numeric key (`12345678`) passed the id check because `RegExp.test` turns it into text.

**What this changes or leaves open:**
- **The slow card now has a dance (D8).** It had none: `TEMPO_BPM.slow` is 90, 0.75 of the 120 bpm dances. `dance_sway` ("Slow sway", 8 beats at 80 bpm, a lullaby rock with soft arms and a 4 mm free-foot lift) closes it. It passes the part tests (loop, no teleports, feet planted under 0.5 mm, lift 3 to 6 mm, mutation-checked three ways), the real-page dance gate (seam 0.2 degrees, slide 0 mm, standing height, wrist 6 degrees) and a contact sheet. Its motion is subtle by design. (The Mixamo picks' tempo is still uncounted: each needs a `bpm` and `beats` set by counting, section 3.3.)
- **Where do live beat maps come from? (D8: skipped for now.)** 4.4 says "the Worker for live songs", but a Worker cannot realistically run a beat tracker. Proposal, **not built**: analyse in the browser on first play (an `OfflineAudioContext` and a simple onset pass), and treat the result as **client data**: `parseBeatMap` is exactly the check that makes that safe (bounded, ascending, plausible, tempo must be what the beats measure). The starter library is analysed by a script on Dan's machine. Needs a decision before phase 4.
- **Tap tolerance is untuned.** 80 ms is the spec's gate; whether a 5 to 6 year old can land inside it is unmeasured (`windowMs` is the knob). Output-latency compensation expects the caller to pass `AudioContext.outputLatency`; **not checked** whether iOS Safari exposes it (if not: no compensation, or one calibration tap).
- **Assumed, to confirm with Mureka's real numbers:** the reservation TTL (10 minutes, must exceed the longest generation; latency unknown), the budget unit (songs a month, UTC month, counted per song at $0.045 and `songsPerCall` songs a call; Dan sets the dollar cap), and the prompt format (the sentences are a draft; the closed-id structure is the rule).
- **Next, once Dan wants it:** the Worker route and D1 tables for `worker/song.ts` (a `song_reservation` table with a unique key and an attempt column in place of the `key~n` trick; `song_quota` as a view or counter over it), the beat-clock hookup in the Kip bench against `AudioContext.currentTime`, and the beat-analysis script for the starter library. None of that needs Mureka until the real songs exist.

### 6.4 Phase 3, first slice: party mode in the Kip bench (built 2026-11-03)

**Try it:** the Kip bench (or the Workshop's Kip tab), menu rail, the party icon: switch **Party** on. **Mood** (the six cards), **Tempo** (slow 90, medium 110, fast 128) and **Ages** (the six bands) are the pickers; a readout shows the dance, the tempo, the count 1 2 3 4 and your taps.

**What happens.** A tap on the switch (browsers only allow sound after one) starts it: Kip puts on the Party Headphones (human heads only; on any other head Kip dances without them and the readout says so), a **practice beat** plays, Kip dances the clip the tempo fits (`planParty`: nearest to its natural speed inside 0.8 to 1.25, never stretched, none means lights only), the **dance is held at the song's beat** (`clipTime`, so it cannot drift), the headphones **glow on the beat** (a colour per beat of the bar) and the floor ring pulses. A tap on the stage plays along by age band: ages 2 to 4 any tap flashes and there are no wrong taps; from 5 to 6 a tap within 80 ms of a beat is a hit, once per beat, and only a hit flashes (a miss is silent). It **ends** on the switch, when another clip is chosen, when the Workshop tab is left, when the page is hidden, or after 10 minutes, and puts the crown, the hair, the glow and the rest pose back.

**The practice beat** is synthesized, no files: one 4-bar loop per mood (`shared/songSynth.ts`, drums, a walking bass and a short lead on a pentatonic scale, a lullaby is quieter and sparser than a march), played by Web Audio (`kip-party-audio.js`) with every sound scheduled on the audio clock at its exact beat. It is the spec's offline fallback (4.3) and stands in for the starter library and the live songs until they exist; the same party code will read a real song's measured beat map instead.

**One clock.** The sound, the dance, the glow and the tap judge all read `audio.songTime()`: where the browser reports the output position (`getOutputTimestamp`) the answer is that position moved on to the moment asked about, so a tap is timed from the finger-down event and not from when the handler ran; otherwise it is the audio clock minus the output latency. The frame loop clamps the dance's clock so it never steps backwards (the real browser's position estimate stepped back 3 ms once in 541 frames).

**Files.** Pure and tested without a browser: `shared/songParty.ts` (plan, frame, tap run), `shared/songSynth.ts` (the patterns). Browser: `parts/kip/viewer/kip-party-audio.js`, `kip-party.js` (the glue), the bundle `public/kip/kip-party-core.js` (built from `songParty.ts` by `build-kip.ts`, with a test that fails if it is stale), the Party group in `kip-menu.js`, and the wiring in `kip-bench.js`.

**Verified.** 48 new unit tests (22 party brain and patterns, 14 audio against a fake audio context with a timing check that fails on a pattern shifted late, 10 wiring, 2 for the menu group), the 543 Kip, song and workshop tests still pass, typecheck clean, and `scripts/e2e-kip-party.mjs`: **40 checks in real Chrome**, three runs in a row. Real-browser results: the dance time of every frame equals the song's beat position times the clip's beat length (worst 0.000 ms); the rig's pose one dance loop apart is the same pose (worst 0.009 rad over about 200 pairs) and half a loop apart it differs; the glow is bright on the beat and off between; **10 of 10 real mouse presses aimed at the beat were hits, mean error 7 ms** (that includes this script's own timer jitter), half-beat presses all missed, a second tap on a beat did not count; stopping puts the crown, hair, glow and rest pose back; choosing another clip ends it; a robot head dances without headphones; switching Workshop tab ends it. Mutation-checked: the audio timing check, the tap rules and the drift check in the unit tests, and five breakages of the page (the dance not held at the beat, no glow, the dance not released, the crown not restored, no stop on leaving the tab), each caught by exactly the check meant to.

**What this does and does not prove.** It proves the chain works end to end and that nothing in it drifts. It does **not** yet meet the phase 3 gate as worded ("measured on a real song"): there is no real song, only the practice beat; no real phone has been tried; and whether iOS Safari reports an output position or latency is unchecked (the code falls back to the audio clock). Headless Chrome's fake audio device is not a hardware clock (a bare AudioContext there runs at 0.79 to 0.995 of the wall clock depending on load), so the test asserts the clock runs forward, not an exact rate.

**Not built.** (Real songs and the Dance picker came next: 6.5.) The live song maker; copy and compose for ages 7 and up (they play the on-beat game for now, 5.1); more than one Kip; the party in the game, the carousel or the map (phase 6); the kitchen band's pan drum; the movement break (built later: 6.8); a parent-set volume ceiling and quiet hours. **The volume is a placeholder:** default gain 0.2, hard ceiling 0.35, not checked against a children's listening-safety reference (open item 8).

### 6.5 Real songs and a Dance picker (built 2026-11-03)

**Dan's ask (D11):** theme songs made with the Mureka API, and a way to choose the dance move from the dances already in the repo.

**The songs.** 14 instrumental songs from 7 API calls on Dan's account, **$0.63 in all, $0.045 a song** (model `mureka-9`; the real price, measured from the account balance before and after, which is also why a job run alongside others must not be costed from its own before and after). One request per mood card (Bouncy, Sleepy, Silly, Space, Kitchen, Clean-up) and a second Kitchen pair, each from the song maker's closed prompt (`promptFor`): no free text reached the provider. What the API did, measured: **38 to 69 seconds a call** of 2 songs (not the 2 to 5 minutes seen on the website; 5 calls ran at once, the account allows 5), songs 78 to 168 s long, and it **followed the BPM written in the prompt closely** (asked 110, got 107 to 109; asked 128, got 128 to 130; asked 90, got 90 and one half-time reading at 82.5), although the API has no tempo control. The measured tempo is what the party uses.

**Measuring the beat** (`shared/songAnalyze.ts`, our own code, 15 tests on synthetic drum tracks including an analyzer broken on purpose): an onset envelope, the tempo by autocorrelation (with a tie-break toward the tempo that was asked for, only between half and double time, never moving a clear tempo), a dynamic-programming beat tracker, the downbeat from where the kick is hardest, and a fit of how steady the beats are. **Two songs were rejected, not forced**: their beats wander (118 and 25 ms rms from any steady tempo; the kept ones are 4 to 15 ms). The ingest (`scripts/song-ingest.ts`) cuts about **64 s of whole bars from the middle of each song** (away from the intro and the end of the file, where Mureka appends an audio watermark), exactly on its beat grid so it loops in time, levels it to the party's loudness and encodes **MP3 at 96 kb/s**. **12 songs, 9 MB, in `public/kip/songs/`**, each labelled made by AI with its prompt, model, task and date; the long originals stay in `.local/songs/` (git-ignored). `scripts/mureka-songs.ts` makes songs (it refuses to spend without `--yes`, never prints the key, and records the real cost).

**In the party.** A **Song** picker (the practice beat or any of the 12; the mood and tempo pickers only show for the practice beat), the tempo comes from the song, the same clock drives the dance, glow and taps, and a song that cannot be fetched leaves Kip exactly as he was and says the practice beat is still there. A **Beat click** toggle plays a tick on every beat, higher on the 1, over the music: **this is how to hear whether the beat map is right.** The library index is checked field by field before anything is played (a bad entry is left out, a file name with a path or a tempo no dance follows is refused).

**The Dance picker.** Auto lets the tempo pick; or choose any move that fits the tempo (dances, the movement-break moves such as Jumping Jacks, the guitar strum), each listed with the speed it would play at (x0.80 to x1.25). **A move that does not fit is not offered, so nothing is stretched** (at 109 bpm the Swing and the Slow Sway are not on the list). A choice takes over at once on the same song clock without restarting the sound, and goes back to Auto if the tempo changes to one it does not fit. The tempo still picks only dances automatically; a movement-break move or the strum is only ever chosen.

**A second bug, found by Dan: the format.** The first library was AAC (`.m4a`). In Dan's browser every song failed with `Unable to decode audio data`, while it played in the full Google Chrome the tests use: browsers built without proprietary codecs (open-source Chromium, some embedded browsers) leave AAC out. The library is now **MP3**, which every browser decodes; the encoder delay MP3 adds is in the file's header and is trimmed (Chrome decodes all 12 to the grid length within 1 ms, the same as AAC). The tap also now creates the audio context **inside the tap, before the song file is fetched** (Safari only starts sound from the gesture itself and the fetch comes first), a decode failure now says what it was given (`657392 bytes, an MP3 file` or `a web page, not audio`), and the party records why it ended (`state().ended`: the switch, another clip, a hidden page, the Workshop tab, the ten minutes, an error). Not verified: Safari (no test here runs it) and Dan's own browser, which is unnamed.

**A bug the checks found, now fixed.** The index recorded each song's length from FFmpeg's decode, which includes the encoder's padding (18 ms): used as the loop length it would drift the beat grid 18 ms every loop and put taps outside the 80 ms window after a few loops. The index now stores the exact grid length, and the test decodes every file in the real browser and requires it to match to 4 ms (it matches to under 1 ms).

**Verified.** Unit tests: 9 for the shipped library (every file the size it says, every tempo has a dance, every prompt is exactly what the cards make, every beat grid steady), 15 for the analyzer, 14 more for the picker and the index validator, 10 more for song playback and the click (against a fake audio context, with the timing check also run on clicks scheduled on the wrong beat length). `scripts/e2e-kip-party.mjs` is now **80 checks in real Chrome** (88 after the Dance mix, 6.7) (run it with `E2E_GPU=metal`: without it the bench runs on software GL at about 3 fps and the frame-rate checks cannot pass): all 12 files decode to their grid length; **the audio's own beat attack is within 22 ms of the map on all 12 songs (2 to 6 ms on the ones with a sharp kick)**; a song plays, the dance time of every frame is its beat position on the song's grid (0.000 ms); 8 of 8 real presses aimed at the song's beats were hits (7 ms mean); the picker, the click, the failing file and the Workshop tab switch all behave. Three more page breakages were caught by the checks meant for them (the pick not switching, the pick restarting the sound, the crown left on after a failed song).

**What is not verified: how it sounds and feels.** I cannot listen. Nobody has judged the songs (which are good, whether they suit the moods), the tempos, or the volume. **The "1" is the least certain thing measured** (the kick finds it with a margin of only 1.0 to 1.5, so the count 1 2 3 4 may be a beat off on some songs; the dance and the taps use beats, not bars, so they are unaffected): switch the Beat click on, and if the higher tick is not on the 1 of a song, say which song and by how many beats, and it is corrected in `scripts/song-overrides.json` (a `shift` of 0 to 3) without re-analysing. Still not met as worded: phase 3's gate on a real phone, and iOS Safari's audio clock and AAC playback are unchecked.

### 6.6 Foot sliding and jerks: two bugs, found by measuring the world (2026-11-03)

Dan, playing it: "some foot sliding and weird jerks but mainly good". Recorded every frame of every dance in the real page (the feet in WORLD coordinates, the body's re-centring offset, the song clock's step, every joint's rotation speed) instead of guessing. Two separate bugs, neither visible to the checks that existed (the dance gate measures the feet relative to the rig, where they were already planted to under 1.5 mm).

1. **The body lurched and the planted foot slid about 20 mm.** The bench re-centres the body each frame over the midpoint of the two soles, WEIGHTED toward the lower foot (an old rule for clips whose feet slip). For a clip whose feet are already planted that rule is the cause of slipping: each time a foot lifts, the weights swing, the body jumps toward the planted foot (up to 8 mm in one frame, 520 mm/s on Hip Hop and Swing) and that foot drags across the floor. Planted clips (every `kip-clips.js` clip and each baked clip the bake tool planted) now get **equal weights**: the midpoint of two feet that stay put does not move. Measured after: world slide **0 to 0.2 mm** (Swing 2.7 mm, real steps), lurch **under 0.3 mm a frame**.
2. **The wrists snapped.** A bug in my wrist limiter: it copied the identity into the swing and then slerped toward itself, so every bend past the 35 degree cap became **zero**, a jump of 35 degrees in one frame (16 against a usual 3 on Silly Dancing and the guitar strum). It was invisible to its own test, because zero is under the cap. It affected every baked clip and Samba. Fixed (scale the swing to the cap), and the cap is now a **soft** one: untouched below 70 % of it, easing to it beyond (a hard wall puts a corner in the wrist's speed). All 16 clips rebaked. Measured after: **zero** hand spikes on every clip.

The song clock was ruled out by the same recording: steps of 15.5 to 17.7 ms against a 16.66 ms frame, no frozen frame.

**Lasting checks.** In the real browser (`e2e-kip-party.mjs`, now **80 checks**): a foot on the floor must not slide more than 4 mm in the world, the body must not lurch more than 1 mm a frame, and no frame may turn a hand more than 4 times its usual speed, on the practice beat and on a song; broken on purpose (the old weighted re-centring) the check fails with 19 mm and 9 mm. In the shipped data (`kip-baked-clips.test.ts`): no frame turns a hand more than 3.5 times its usual speed (broken by one snapped frame, it fails), and every shipped dance, move and strum is planted. In `kip-clips.test.ts`: the limiter's rules (below 70 % untouched, never past the cap, never reversing, no corner in the speed), also run on a hard clamp, which must fail them.

**Lesson, for the next clip:** measure what the child sees (the world, per frame, at the real frame rate), not only the rig. A foot that is planted in the rig can still skate across the floor.

Tests that should exist before each phase lands: part-gate and fit-matrix runs (phase 1), per-clip metrics and contact sheets (phase 2), a beat-clock unit test and an
end-to-end that measures tap-to-beat error (phase 3), a Worker test with the limiter, cap and fail-closed behaviour and a stub Mureka (phase 4), a game e2e that holds
each prop and plays its clip (phase 5). Mutation-check the new tests once each, as for the clips.

### 6.7 Dance mix (built 2026-11-04)

**What it is.** A **Mix** entry in the Dance picker (beside Auto and each single move): Kip changes dance every **16 beats (4 bars)**, taking turns with every dance that fits the song's tempo. Auto stays the default; Mix is a choice.

**The rule is a pure function of the song's beat position, not of a timer** (`danceForMix(list, position, 16)` in `shared/songParty.ts`): the dance at beat `p` is `list[floor(p / 16) mod list.length]`, and a position before the first beat (the count-in) is the first dance. So it cannot drift from the music, it joins mid-song on the dance that block is meant to have (a late start does not restart the cycle), a dance never follows itself when the list has two or more, and it is the same on every device. The list (`mixList`) is the dances that fit the tempo (rate 0.8 to 1.25, never stretched), **nearest its natural speed first**; movement-break moves and the strum are never in it (they are chosen, not mixed in, as in 6.5). A Mix opens on the dance the tempo would have picked on its own. The picker **offers Mix only when at least two dances fit** the tempo ("Mix (a new dance every 4 bars)"), and a Mix that a tempo change leaves with fewer than two goes back to Auto, the same as a single move that no longer fits; asked for directly, the plan with fewer than two is just the tempo's own pick. The change is the usual crossfade on the song clock, so it adds no new timing path.

**Verified.** Unit: `tests/song-party.test.ts` (43 tests) states the rules as a function of the chooser (first 16 beats the first dance, then the second, round the list, count-in, held for the whole block, never repeating, one dance is that dance, NaN) and also runs them on a mixer that switches every beat and one that picks at random, which must fail; it also checks the list (which clips, which order, none at 200 bpm), the plan, and that the frame changes dance only on a block line and each time on the beat. `tests/kip-party.test.ts` checks the glue (the mix swap runs before the "another clip took over" check, or the party would end itself at the first change). In real Chrome (`E2E_GPU=metal node scripts/e2e-kip-party.mjs`, **88 checks**, run twice, both clean): on a library song the dance changed twice in 20 s, **every change on a multiple of 16 beats of the song's grid**, none repeated, the party stayed on, the clip playing matched the party's state, and through the crossfades the world-space checks of 6.6 held (foot slide 0.1 mm, lurch 0.05 mm a frame, **zero** hand spikes).

**The hand-jerk check was sharpened on the way, and mutation-checked.** The first version flagged frame pairs under 6 ms apart (two frames close together make any speed look huge). It now ignores those and needs a step of more than 6 degrees **and** a speed above `max(400, 4 x the clip's usual)`, and reports the angle and the time it came at. To be sure it can still catch a real jerk, three wrist frames of `dance_silly.json` were snapped to straight (in place, then restored): the browser check failed with **18 spikes, the worst 1180 degrees/s** (87 of 88 passed), and the shipped file was restored byte for byte (`git diff` empty).

**Not verified.** Whether a change every 4 bars feels right: 16 beats is my choice and nothing measured picked it, and it is one constant (`MIX_BEATS`) if it feels busy or slow. Whether the changes land where a child expects: on the 1 of a bar only if the bar line is right, the least certain thing measured (6.5). Nobody has watched it with the sound on.

### 6.8 Movement break (built 2026-11-04)

**What it is.** A **Mode** picker in the Party group: Dance party, or **Movement break (copy Kip)** (5.2, D6). A break plays a library song (or the practice beat) for 30 to 60 seconds and Kip does moves a child can stand up and copy. It is a prompt, not a measurement: **no camera, no motion sensor, nothing is scored**, and a tap on the stage in a break is not counted (a test fails if the glue or the planner mention a camera or a motion API, or the planner a score).

**By age band** (the party's six bands): ages 2 to 4 (bands 0, 1) get **one move** the whole break, counted 1 to 8 on screen; ages 5 to 9 (2, 3) get a **four-move sequence**, one move to each two bars, and then the same four again; ages 10 and up (4, 5) get Kip showing the four, then a round where the **child chooses** each next move from a **Next move** picker (whatever is picked when a move begins is what Kip does for it; with no pick he keeps doing his last move; then Kip shows the four again, and so on).

**The moves** are the three `move` clips (Jumping Jacks, Arm Stretch, Neck Stretch) and, last, the dance the tempo would pick for itself. Jumping Jacks have a tempo (112.5 bpm), so they are held to the beat like a dance and offered only where they fit (songs of 90 to 140 bpm, never stretched); the two stretches have none and run at their own speed. The guitar strum and any clip without a tempo are never in a break. A break with no move to do (an empty plan: tested in the planner; the readout's "could not start" message is not exercised in a browser) does not start.

**How.** `shared/moveBreak.ts`, pure, rides the party's bundle (`kip-party-core.js`). A step is **8 beats (two bars)** and which move is playing is a **function of the song's beat position** (`breakFrame`), like the Mix (6.7): the move changes on a bar line, cannot drift from the music, and a late start joins on the move its bar belongs to. The length is whole rounds of four steps, `max(2, round(40 s of beats / 32))`: 30 to 60 s at every tempo from 64 to 170 bpm (tested at each), 45.0 s on the 128 bpm song used in the browser check. The child's pick is read **when a choose step begins** and remembered for that step (`resolveBreakMove` walks back to the last show step or valid pick, so a pick that is not in the pool, or none, can never make Kip do anything else). The break ends by itself (`state().ended === 'done'`) and puts the crown, the hair and the clip back.

**Verified.** Unit: `tests/move-break.test.ts` (22 tests: style by band, the pool and its tempo rule at every edge, the plan by band, 30 to 60 s at each of 107 tempos, a show round and a choose round at every tempo, empty plans, the pick rules, and the frame rules stated once as a function of the frame maker and **also run on four broken makers** that must fail: a move that changes every beat, one that ignores picks, one that counts to 4, one that never ends). The planner was **mutation-checked with seven deliberate bugs, all caught** (band thresholds, minimum rounds, the tempo filter, duplicate moves, the fallback, accepting any pick, the step length). Wiring: 3 tests in `tests/kip-party.test.ts` (the break's frame function runs before the party's, the move swaps before the other-clip check, only a move with a tempo is held, the pick is read when a step begins, no sensors, taps ignored) and 1 in `tests/kip-menu.test.ts` (the Dance picker goes in a break, Next move only for ages 10 and up). In real Chrome (`e2e-kip-party.mjs`, **114 checks**, the 88 before plus 26): on a library song at 128 bpm, ages 2 to 3 get Jumping Jacks the whole time, counted 1 to 8 on the song's grid, held to the beat, a tap counts nothing; ages 5 to 6 get jacks, arm stretch, neck stretch, silly dance, and again, **every change on a multiple of 8 beats**, and through the changes the world-space checks of 6.6 hold (foot slide 0.3 mm, lurch 0.11 mm a frame, no hand spikes); ages 10 and up: a pick made during the last shown move is the first chosen move, a pick made during a move is what the next does, 'keep' keeps it, and the break **ends by itself** at 45 s, crown and hair back.

**Not built.** Counting **aloud** (the bench has no voice; the count is in the readout, "3 of 8", not spoken); a big on-screen prompt (this is the bench's menu, a developer and Workshop surface; there is no child-facing screen for it yet); **the triggers in 5.2** (the end of a Help cook or Clean up session, or a grown-up's tap); a grown-up's switch to turn it off and its tie to the parent's own time limits; STEM minutes (open question 5); saving a child's picks. Not verified: how it looks and feels (nobody has watched it), whether two bars a move is the right pace (it is one constant, `BREAK_STEP_BEATS`), that the Arm Stretch is only shown for about 4 of its 8.9 seconds each time it comes round (it restarts at each step), and that the jacks are only there on songs of 90 to 140 bpm (on others the break is stretches and a dance). iOS Safari and a real phone are untested, as for the party.

### 6.9 The song player: Pause/Play, Stop, a mini karaoke and a dock (built 2026-11-04)

Dan, on seeing the lyrics on the card: it needs stop and play, ideally a mini karaoke, and the closed/docked state is an awkward UX (the song card sat over the dancer, "Stop the party" was the only control and "Close" ended the song).

- **Pause and Play are real.** `createGameParty().pause()` stops the sound, hands the dancer back to idle, holds the song time still and holds what is left of the 150 s limit; `resume()` starts the sound at the same offset of the loop (`songTime % loopEnd`), re-hands the dance the same clock and restarts the limit with what was left. Stop works while paused. Tested in `tests/game-party.test.ts` ("pause and play").
- **The karaoke is the song's own timing, never a guess.** Mureka's finished song carries `lyrics_sections[].lines[]` with `start`/`end` in ms and a start per word (measured on a real song, 2026-11-04). `worker/themeSong.ts` passes them through the status answer as compact `lines: [{s, e, t, w?}]` (`parseLyricSections`, `shared/songKaraoke.ts`); the flow moves them onto the cut the party loops (`lyricsForCut`: seconds from the cut's start, lines outside the cut dropped) and keeps them with the song in `tv.themeSongs.v1` so "My songs" still has its karaoke (a song kept before this asks the route once). The card reads `party.state().songTime` ~11 times a second and `karaokeAt` says which line is sung, how many of its words are lit, the line before and the line coming (a gap between lines shows the next line, dim, when it is within 7 s; after the last line the loop comes round to the first). A song with no times (provider gave none, or an old kept song the route cannot answer) has NO karaoke and keeps "The words": lyrics are never paced by guesswork, a child would sing the wrong line.
- **Two sizes.** The card (everything) and the dock (a slim player, 68 px, along the bottom): Pause/Play + Stop at 56 px, the name, the line being sung, and a tap to open. A party docks itself when it starts; a new song, a finished party or a failure opens the card; the child tucks either away with the chevron. While a song is being made the dock shows the name, the stage line and a thin bar. Stop leaves the card open on "Dance again / New words / Close". "Close" no longer exists while a party is on: Stop ends it, the chevron tucks it.
- **New words** (card only, with the weeks' songs left on the button) asks the route again for the same thing (`flow.redo()`: same description and kind, a new key, a new slot of the week). Not offered while a song is being made (it is already ordered and counted: a second would throw the first away for another slot).
- **The Kip bench's Describe card** (`parts/kip/viewer/kip-theme-song.js`, a plain-JS port; it is inline in the panel, so there is no dock) has the same animated wait (bars, a bar that never fills before the song is ready, the same six lines) and, while the song plays on its Play/Stop button, the same karaoke line from `audio.currentTime`. `tests/theme-song-card.test.ts` holds the port to the game's answers (same lines, same lit word count at every 137 ms of a test song).
- **Not built / not checked:** the game card and the dock were looked at in a throwaway harness at 390 and 360 px (headless Chrome), not on a real phone. `scripts/e2e-game-party.mjs` was updated for the new buttons (`song-stop`, the docked party) but not run; no e2e or full suite was run (tests paused until beta).

### 6.10 The game's Kip bends like the demo's, and does things on his own (built 2026-11-04)

**Dan's asks.** "Is it Kip Snap or Pro? If Snap, remember in the game we can use fake rigging like in the Kip demo so animations are mapped properly", then "yes both, like idle waves and random dances if nothing is going on" (and a dancing Kip on the title screen).

**Snap or Pro.** The game's Kip is the **Snap** figure (3+): `snap_arm.stl` and `snap_leg.stl` are one printed piece each, with the shared 3-finger hands and boots. (The Kip bench shows the **Pro** edition, two-segment limbs, by default: its edition picker has to be set to Snap to see what the game's Kip is.) Until now the game's limbs were one rigid mesh each, posed only by a direction (shoulder to hand, hip to ankle), so no elbow, wrist, knee or ankle could bend.

**The fake rigging, ported (`runtime/snapFlex.ts`).** The bench's trick (`makeFlexSnapLimb` and `applySnapJointOverrides` in `kip-rig.js` and `kip-bench.js`), line for line: the printable one-piece sleeve is bent in software. Every vertex near mid-limb is rotated about the elbow (or knee) by a smooth fraction (0.94 when assembled) of the joint's rotation, normals too; the part of the elbow the sleeve does not bend goes to the shoulder and wrist; the hand (or boot) is moved to where the bent sleeve now ends. The geometry is cloned per rig, so the cached STLs are never touched. The game's rig builder (`stlRigLoader.ts`) now has the bench's joint chain (shoulder > sleeve > cuff > hand, hip > sleeve > ankle > foot) and exposes it as `rig.snap`; **at rest nothing moved** (measured before and after: sleeve, boot and hip heights identical to the 0.1 mm; the hand 1 mm, from the bench's own 11 degree wrist tilt).

**Driving it (`mixamo.ts`).** A clip made with `jointClipToGame(joint, id, { joints: true })` carries the bench's own joint rotations, the hips' absolute position and the planted flag; a pose carries a weight `jw` of how much of it is exact, which blends with the clips mixed in (idle, walk, run, a crossfade between dances). In joint mode the body turns about the **hips** (not about the feet), takes the clip's whole rotation (not the toy's 0.7 and 2.2 exaggeration), the head and shoulders and hips take the exact rotations, the sleeves bend, and a **planted** clip has its lowest sole put on the floor (the bench's grounder does the same). With no joint data nothing changes: the Xbot clips (idle, walk, run, nod...) drive the rigid limbs as before. **Joint data is opt-in per call**, so the toy room's jump and shove (`gameMoves.ts`, another session's) keep exactly the clips and the `lift` setting they were built with; the party's dances (`gameDances.ts`) and the new idle clips ask for it.

**Measured against the bench.** `scripts/e2e-game-dance-rig.mjs` poses the bench's Snap figure and the game's at the same frames of four real clips (Hip Hop, Silly, Jumping Jacks, Wave: 21 frames) and compares shoulder, the end of the bent sleeve, hand, hip, knee, foot and head, in millimetres, from the hips: **every limb joint within 0.01 mm, the soles within 0.00 mm of the floor.** The head is 1.2 mm off, and always the same 1.1 mm: the game's head pivot sits at 108.0 mm, the bench's at about 106.9 (the game's own placement, not touched). **A trap in the bench, found on the way:** its Snap override multiplies its result back into the joints every frame, and the animation mixer only rewrites a joint when its sampled value changes, so on a PAUSED clip (what `kipClips.scrub` makes) the pose drifts frame by frame (the same frame read 91 degrees and then 72). The comparison therefore sets the joints to the file's raw values and lets the bench run exactly one frame before reading. Whether this shows in the bench's own use (a held pose in Snap) was not checked.

**What he does on his own (`runtime/idleBehavior.ts`).** The world already had an idle tick (a hop, a shake, a nod, a spin, an arm raised). **Pacing, after Dan saw the first version (a tick every 6.5 s: "maybe a little busy, idle animations can be min 30 to 60 seconds or even minutes"):** the first tick of a spell of standing still comes after **30 to 60 s**, and each one after it **45 to 120 s** later, drawn each time (`idleGapSeconds`, constants `IDLE_GAP_SECONDS`); it is the wait for every idle gesture, the old ones included, and touching or moving starts the count again. That tick first asks for a **wave** (24 %), a **clap** (10 %) or, from the second tick of one spell of standing still (a minute and a half to three minutes in), a **dance** (22 %; Samba, Silly, Hip Hop, Swing, Locking or Chicken, whole loops, 7 to 10 s, the swing cut at 9 s); otherwise the old gestures have their turn. They are played the way the party plays a dance, as a beat source on a clock of their own, so he turns to face the camera and back, they fade in and out, and walking pulls him out of them. (The camera does NOT push in for them, as it does for the party's dance: the driver calls them `idle`, not `dance`, and a push shifted the whole framing and failed `e2e-game-mess`'s check that every toy of the heap is on screen.) A tap on the stage cancels at once. **The party always wins:** a behaviour never stops a dance that is not its own (the driver says whose source is playing). Reduced motion switches all of it off, and the title's show too. The clips load in the background after the character does (the small ones first); until a clip is loaded it is simply not chosen.

**What he holds goes with his hand (`makeHandFollow`, `followHand` in `snapFlex.ts`).** Held things (`heldItems.ts`, the pick-up flow's cut-out card and objects) are attached to the arm's holder, `rig.arms[i]`, tuned for an arm that hangs straight: with a bent elbow the hand is somewhere else and the thing would hang where the straight hand was (a party dance while he carries what the camera picked up is the plain case). So while a joint clip is in force the **holder goes with the hand**: it is moved by how far the hand has moved from its rest frame, and a `handCounter` group between the holder and the sleeve (identity at rest) undoes that for the sleeve, which stays exactly where the clip put it. The held thing is still a child of the holder, so `HELD`, `pickupHeld` and their `parent === arm` checks are untouched (re-parenting under a carrier group was the first idea; the pick-up flow's check would have seen a stranger and re-attached it every tick). The holder is exactly home on the faded-out frame and after `release()`. Anything that reads `rig.arms[i]` as the shoulder's position during a joint clip gets the hand-following holder instead: the sleeve's own root is `snap.arms[i].fore.parent` (the dance-rig e2e reads the shoulder from there). Unit: 6 tests in `snap-flex-rig.test.ts` (a thing in each hand stays rigid in it through a bent elbow and a turned wrist, is left behind without the rule, the sleeve and hand do not move, the holder is exactly home) and the rule run on five broken versions.

**The win cheer (`runtime/winCheer.ts`, Dan: "then start 2").** Every win moment asks the driver for the action `cheer` (cooking, cleaning, the mop and the toy box, the toy room's jump); it was a 1.3 s two-armed clip built from limb directions. Mixamo's *Standing Cheering* and *Standing Fist Pump* (`react_cheer`, `react_fistpump`) are now played in its place, with the bench's joint rotations, so the elbow and wrist bend. They are one-armed and 3.4 s with half a second of lead-in, and the win moments reserve 1.8 s (`CLEAN_CHEER_S`) to 2.0 s (`COOK_CHEER_S`), so each plays at **1.9 s** (`CHEER_SECONDS`: the clip's own motion at a bit under twice the speed, a quick "yes!"), and they **take turns** so two wins in a row are not the same gesture. Nothing in the other lanes moves: the clip is still named `cheer`, still a one-shot and about as long as the old one; the world calls `CHEERS.roll()` at the top of `mixGo` just before it triggers `cheer`, which puts the next one in the bank under that name. Until the files have loaded, or if one is missing or is a different clip, the hand-built cheer stays and plays as before. Seen in the real game (probe, not an e2e run): three cheers in a row alternated fist pump, cheer, fist pump, each `busyAction === "cheer"` and over after 1.98 s; both read as a raised bent arm with the fist near the head.

**More of Dan's downloads, wired the same day (2026-11-04: "copy and implement").** Dan downloaded 17 more Mixamo clips and a Farming Pack (26 files); all are in `.local/mixamo/` (git-ignored; the Farming Pack in `farming/`). Seven of the pack's files do not parse in three's `FBXLoader` ("Unknown property type": box idle, cow milking, holding turn left, kneeling idle, pick fruit (2), plant a plant, the wheelbarrow walks and turns), so they are not usable as they are (re-export from Mixamo as FBX Binary 7.4 with "Without Skin" if they are wanted). A scratch trial baked 24 of the others clean (seam, slide and ankle height within the gate), looked at on the Snap figure in the real game, and **ten are baked into `public/kip/mixamo/baked/` and used**:
- **Idle fidgets** (a fourth idle kind, `IDLE_FILES.fidget` in `idleBehavior.ts`; 20 % of idle ticks, from the very first one, played once and whole, the longest 10.7 s): `mood_thinking` (4.2 s), `mood_bored` (10.7 s), `mood_yawn` (8.3 s, a big stretch), `mood_shrug` (2.0 s), `mood_look` (looking around, 6.3 s) and `move_arms` (the arm stretch, already baked for the movement break). The chooser's odds are now dance .22 (from the second tick), wave .24, clap .10, fidget .20, and a quarter is left to the old hop, shake, nod and spin. They load after the first idle clips, so they never compete with what the title show needs.
- **Win cheers** (`CHEER_FILES` in `winCheer.ts` is now four, taking turns, never the same twice running): the two one-armed ones, `react_cheer2` (*Cheering 2 hands*, 2.9 s, both hands up by the head) and `react_victory` (*Victory*, its 0.7 to 4.0 s of 8.5 s: both hands up and a shimmy). All play over 1.9 s, so each is at 1.5 to 1.8 times the speed it was made at.
- **Three actions replaced under the same name** (`runtime/gameActions.ts`): `sad` (the part that cannot be afforded; *Sad Idle*, 2.8 s, was a 1.4 s held pose), `sneak` (the peek behind a hiding spot; *Sneaking Forward*, 1.7 s, was a held crouch pose) and `kick` (the toy room's ball; *kick*, the 0.40 to 1.45 s of it, played over `KICK_PLAY_S` = 1.0 s = `KICK_S`, with the foot at the ball about at `KICK_CONTACT_S` = 0.42 s, the cue the ball is launched on: the act, the ball and the dog's fetch are untouched). **The kick's contact moment was set by eye from side-on frames in the real game, to within about a tenth of a second**; the check that would hold it is a Chrome look at the real toy-room kick, which is not run while e2e is paused.
- **Not used, and why.** *Watering / cleaning / vacuum* (5.6 s, the same clip as the pack's *watering*) reads as a bow with an arm sweep and no can, and the hand-built pour is timed to the can's hold and tip cues, so it stays. *Yawn* is a fidget only: the 1.8 s hand-built yawn is what the wake-up plays, because 8 s is too long to wait after waking. *Carrying Walking* baked unplanted shows the boots coming off the shins (it needs the same treatment as the loco clips), and *Carrying Idle* is a two-handed box carry: nothing the game has is carried in two hands (what he picks up with the camera is held in one), so neither is shipped. *Throw*, *pick up and Throw Object* (4.9 s: bend, pick up, throw), *Reaching Out*, *Pick Fruit* (8 s; its first three seconds are the reach and pluck) and the pack's *dig and plant seeds*, *plant tree*, *pull plant*, *pick fruit (3)*, *wheelbarrow dump* and the holding idle all bake clean and look right, but each needs a feature that does not exist yet: a thrown ball for the dog (the throw and pick-up-and-throw would sit in the toy room beside the kick, with a ball that is held in the hand), picking a tree's fruit (another lane is working on fruit touch), and a planting or farming level. They are measured, not shipped (each is about 100 KB of baked JSON).

**The title screen.** Kip dances on the turntable instead of standing in profile: the Samba at once (his own, always there), then the others as they load, one after another, until Play is pressed (the turntable turns him as before).

**Verified.** Unit: `snap-flex.test.ts` (13: the bend's rules run on three broken bends, and that the hand's attach point lies exactly on the bent sleeve's end for any rotation, run on two broken solvers), `snap-flex-rig.test.ts` (9: the driver on the game's own joint structure: nothing changes without joint data, the elbow reaches the hand, the sole lands on the floor and does not when the clip is not planted, everything returns to rest exactly), `idle-behavior.test.ts` (16: the odds and the rules run on three broken choosers, the real baked files through a fake fetch incl. a missing, a wrong and an oversized file, and the controller incl. that it never stops the party's dance). Real Chrome: `e2e-game-dance-rig.mjs` (19 checks, above) and `e2e-game-idle.mjs` (21: the title show goes through three dances with the joints bending 30 mm out of line and stops on Play, the first ticks never dance, later ones do, he turns to the camera for a wave and back, his elbow bends 22 mm, his feet stay on the floor, walking and a tap end it, the party's dance is not stopped, reduced motion switches it off).

**Not done.** The jump and the shove are still direction-only (they would need `lift` handled in joint mode, and `gameMoves.ts` cuts clips without carrying joint data); the idle behaviours still wait until his hands are empty (a mop or a vacuum in a wave is odd, whatever the geometry does); the other baked clips (push, pick up, the stretches) are not in the game's everyday play; robots and vehicles are not Snap Kips and do none of it. Not verified: a real phone's frame rate (the bend is a CPU pass over the two arms' and two legs' vertices each frame while a joint clip plays, as in the bench), Safari, how long the idle waves feel right (the odds and the times are my choice, constants in `idleBehavior.ts`).

## 7. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Mureka terms forbid a children's app or stored songs | The whole song half | Phase 0 check; fall back to the procedural engine plus licensed-free loops, or a different service |
| Lyrics and content | Child safety | Instrumental v1, cards not text, grown-up approval |
| Cost per song unknown | A bill with no ceiling | Library first, hard cap, fail closed |
| A part that passes the face-angle gate still needs a support (a tip starting in mid-air) | A failed print the gate did not predict | Orca slice as a gate for the headphones (done on the spike: 0 supports); consider it for new parts |
| Mixamo clips fail on a 14-joint rig | Dances look wrong | Selection criteria and the gate; keep procedural dances |
| The game's Kip has rigid arms (confirmed, 6.1) | Props cannot be held with the viewer's clips | Route 1: a wrist pivot plus a baked arm-direction and hand-orientation track; the party rides stage 4d |
| Mixamo licence reading | Legal | Recheck Adobe's current terms before shipping; keep clips out of training data |

## 8. Open questions (what is still open after D1 to D7)

1. **Mureka's official price sheet and concurrency table** (Dan, on `platform.mureka.ai`). Third-party figures are in 4.1 (about $0.03 to $0.15 an instrumental, songs up to 5 min 30 s, 2 songs a call, no tempo field); the licence, instrumental mode and generation time are answered (D9). Without a confirmed price the live maker cannot be switched on, and one decision follows from it: a call returns two songs, so **offer both (the child picks one, one slot used)** or keep the first?
2. **Mixamo availability:** are Hip Hop Dancing, Swing Dancing, Locking Hip Hop and Silly Dancing in the Dance list today (and the two reserves)?
3. **Headphones for the non-human heads.** Measured: the human size fits the four human heads only; the animal, creature and robot heads (45 to 55 mm wide) each need their own wider band. Build them in the same wave, or ship humans first (my proposal)?
4. **Quota rollover:** none (my proposal), or unused songs carry over up to a cap? And does a family with several children on one device get one quota or one each (needs per-child profiles)?
5. **Do movement breaks earn STEM minutes**, or only the learning session (`xp-system-spec.md`)?
6. ~~**Live song maker default**~~ **Decided (D10): on, with a notice.** A grown-up can switch it off.
7. **Vocals:** ever, for a young audience? (Not in this plan.)
8. **Safe-listening ceiling:** the numeric limit for the party's gain, from a current children's reference I have not checked.

## 9. Verified and not

**Built and tested, not yet connected (2026-11-03):** the beat clock, tempo rule, tap judge, weekly quota and song cards (6.3). **Verified in the repo today:** head connectors and widths; `pointy_ears` and hat catalog rows; the 27 clips and their bpm facts; the two Mixamo files and their clip names; the licence
summary in memory; the audio engine's `SongDef`; the Worker's bindings and routes; `resolveCharacterPropUrl`; the `daily.cook` and `daily.clean` content and the clean mission's tools.

**From third-party pages, not confirmed:** that Mureka has an API and paid commercial tiers, and the prices. **Not checked:** Mureka's own terms, API behaviour, tempo control, instrumental
mode and licence for stored songs; Mixamo's current catalog names and terms; whether the game's rig has Kip's joints; whether every wig clears a headphone band; current children's
listening-safety guidance; that headphones print support-free in either route.
