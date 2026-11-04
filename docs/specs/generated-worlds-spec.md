# Generated worlds and backdrops with Muse (draft)

## Status

**Approved to build, 2026-11-04** (Dan: "describe a brand-new look ... including parallax background, indoor or outdoor, day and night ... it should be merge, replace or improve what we have"; five hours). Written 2026-11-03 as a
proposal after measuring the service (section 2); section 0 below is what was decided and what changed in the code since, and where it differs from sections 3 to 5, section 0 wins.

A child says or types a wish ("a candy forest at sunset", "a jellyfish ocean at midnight", "my pirate bedroom"). The game makes a new playable world with its own sky, hills and look. Muse Spark writes a small bounded
**brief**; Muse Image paints the backdrop layers from prompts the code builds; **code does everything else** (sizing, keying, gates, lighting, props, the world record). It never changes physics or the engine contract (product spec:
generated worlds "may change sky, music, props, and intro missions, but never physics").

## 0. Decisions and the contract (2026-11-04)

**Improve, do not replace.** The six hand-made worlds stay: they are the base themes (physics, missions, prop sets) and the fallback when anything fails. Create stays as it is (it builds a level in the Level Editor's data, `LevelDef`
id `kid-world`, from the child's words); it gains a look. The one structural change: the static `BACKDROPS` table (`runtime/backdrop.ts`) gets a runtime registry in front of it (`registerBackdrop`), so a world can carry its own art.

**Decisions (Dan):** five hours, showcase first and live generation after; both day and night looks made at creation (so three images for an outdoor world: far day, far night, one mid strip); storage on the device (IndexedDB), R2 only if it
turns out to be easy (it is not: ownership keys and a duty to delete); proceed on the assumption that the first wishes work and fix taste after testing; live generation is capped and not behind a parent gate for the adult-operated demo, and
every result says it is AI-made (defaults below, Dan can change the numbers).

**What changed in the code since this was written (2026-11-03):** every outdoor world now has a day and a night look from the player's clock (`runtime/worldLook.ts` `lookFor`, `SKINS`, `src/lib/timeOfDay.ts`), so a generated world carries both and
the clock picks one; every outdoor world has its own far band per look and one mid strip (`BACKDROPS`, `backdropFor(theme, look)`; art baked by `scripts/make-backdrops.py worlds`); the pipeline has been run for real (12 images, plus the Junkyard strip
redone: a prompt about discrete objects must say "fills the WHOLE width, edge to edge" or the model draws one cluster); four lighting presets (indoor/outdoor, day/night); the Toy Room is indoors and has no backdrop by design.

**The shapes (the contract every part builds to; code in `shared/worldBrief.ts`):**

- `WorldLook` v1, stored inside the level (`LevelDef.look`, small JSON, no pixels): `{ v: 1, id: "gen-<10 hex>", kind: "outdoor" | "indoor", base: <theme>, name, day: Palette, night: Palette, art: { farDay, farNight, mid: boolean }, room?: { wall, floor, accent }, aiMade: true }`
  where `Palette = { sky: [hex, hex, hex], fog: hex, ground: hex }` (an indoor world has the same palette in both). `base` is the base theme (garden, sky, junk, beach, snow, or room for indoor): it keeps the physics, props and missions.
- `WorldBrief` v1, what Muse Spark returns (validated by code, never trusted): `{ ok, name, kind, day, night, far, mid, props, room, say }`; `far` and `mid` are one sentence each, the image prompts are templates (section 3.2) with those sentences swapped in. Colours are clamped to a luminance
  band per look (day light, night dark, so a brief cannot make an unreadable world). Unknown keys dropped, `props` filtered to the closed prop list, sentences length-capped and passed through the child-safe filter.
- Routes (Worker): `POST /api/world/look` ({ wish, theme }: Spark brief for that wish over that base theme -> the validated brief plus HMAC-signed art tickets) and `POST /api/world/art` ({ ticket }: the server builds the image prompt from the ticket's own signed sentence and
  returns the raw image; free text from the client can never reach the image model). Both are model routes (the spend limiter) and count against the daily budgets below.
- Client (new, `runtime/lookArt.ts`): asks for the look, fetches the three images in parallel, keys the mid strip off its black surround in a canvas (a TypeScript port of `scripts/make-backdrops.py`'s mid bake, tested against that script on the committed raw art), runs the
  gates, stores the blobs in IndexedDB under `look.id`, registers the backdrop, and the world plays as soon as the CURRENT look's far band and the mid strip are ready (the other far band fills in behind it).
- Runtime: `levelWorld` carries `look` onto the `WorldDef`; `lookFor` uses the look's day or night palette instead of the base theme's skin; `backdropFor` asks the registry first, then the theme table. A missing or failed layer falls back to the base theme's own art with the look's palette, then to the base theme.
- Indoor: no painted layers. The brief's `room` block (wall pattern, floor, accent colour from closed lists) drives the Toy Room's builder: one text call, about 10 seconds, no image.
- **Showcase first:** `scripts/generate-world-art.mjs` runs the same brief and image code offline and writes the raw art of record (`docs/mockups/generated-backdrops/looks/`, verbatim prompts in a manifest, a second run never spends again), `scripts/make-backdrops.py looks` bakes it
  into `runtime/assets/looks/`, and the good ones ship as pick-able "wish worlds" (a registry entry plus a level), so the demo has real generated worlds even if live generation is off.
- **Live caps (defaults):** a hard GLOBAL budget of 30 worlds a day for the whole app and 5 a day per address, counted in D1 (`DB`), failing closed to the pre-made wish worlds with a kind message; a friendly limit on the phone on top (one world per three minutes). Money per world is unknown (the service reports
  tokens, about 17k in and 1 to 2k out per image); Dan reads the price off the dashboard and sets the numbers.
- **Failure ladder:** a failed or rejected image, retry once; then the base theme's own art with the look's palette; then the base theme. The world is always playable.

### 0.1 Built and verified (2026-11-04, the same evening as the decision)

- **Contract** `shared/worldBrief.ts` (`tests/world-brief.test.ts`, 25 tests, 9 mutants of the rules all caught): types, the brief validator (colours clamped into brightness bands, a missing look derived from the other, a malformed one refused), the prompt templates, the signed art tickets (`worldart:` domain-separated HMAC, canonical encoding only, ten-minute expiry) and `parseLook`.
- **Worker** `worker/worldLook.ts`: `POST /api/world/look` and `POST /api/world/art` as specified above, wired in `worker/index.ts` and in `spendLimit.ts`'s metered list (`tests/world-look-worker.test.ts`, 47 tests, a real SQLite as D1 so the budget SQL and the race for the last unit run for real, 14 mutants caught). Answers: look `200 {ok:true, brief, art:{farDay,farNight,mid}|null}`, `200 {ok:false,status:"gentle"}` for every bad model answer (never a 5xx), `503 not-configured`, `429 daily-limit` (with retry-after) or `slow-down`; art `200` raw image bytes, `403 not signed`, `409 ticket-used` (a ticket paints twice), `502 art-failed`, `503`. D1 tables `world_budget` and `world_art_redeem` are self-created (no migration). Env: `VOICE_SIGNING_KEY` (signs the tickets; already set in production), `WORLD_DAILY_GLOBAL` (default 30), `WORLD_DAILY_PER_IP` (default 5); an indoor world is counted in its own, five times larger scopes.
- **Pixels** `runtime/lookArt.ts` (`tests/look-art.test.ts`, 23 tests): the key-and-crop is a TypeScript port of `scripts/make-backdrops.py` and matches it on all four committed raw strips (crop box within 2 px, opaque share within 0.4 %) and on the baked Junkyard asset; the gates were calibrated on the committed art (the eight far bands average 0.76 to 0.83 brightness by day and 0.24 to 0.50 by night; the strips span 74 % to 100 % of their picture; a mid strip must have gaps, so a solid slab fails).
- **Runtime**: `backdrop.ts` registry (`registerBackdrop`, `backdropFor(theme, look, genKey)` asking it first, a missing layer falling back to the base theme's art), `worldLook.ts` (`withGen` lays the look's palette over the base theme's own day or night; an INDOOR look also dresses the Toy Room: `roomLookExtras` gives the wall's colours and pattern, the rug's rings from the accent and the floor tint, which `world.ts`'s `roomWall`, `rug` and `groundPlane` now draw from), `catalog.ts` (`LevelDef.look`, carried onto the world as `gen`), `lookStore.ts` (IndexedDB, at most 12 worlds, memory fallback), `lookMaker.ts` (the live path with every dependency injected, `tests/look-maker.test.ts` 24 tests and `tests/gen-look-runtime.test.ts` 15 tests, 11 and 6 mutants caught), `lookArtBrowser.ts` (decode and encode through a canvas).
- **Create**: a row of "wish worlds" chips (gold-pink, ✨), the live look after a wish (status "Dreaming up a look... / Painting the sky... / Checking the pictures...", then "Here is <name>!"), a "Look: <name> (AI-made)" card and a "Remove the AI-made look" button; a refinement ("add a lantern") keeps the look and a different base theme starts without one; a friendly limit of 3 worlds a day and one per 3 minutes on the device. A failure never breaks the world: it stays exactly as Create made it and, where useful, says something kind.
- **Showcase** (`scripts/generate-world-art.ts`, `scripts/bake-wish-worlds.ts`, `python3 scripts/make-backdrops.py looks`): six wishes made with the same code, 6 text calls and 12 image calls, all first try. Outdoor: "Sugary Garden Grove" (a candy forest at sunset, Garden), "Moonlit Sandy Cove" (a glowing jellyfish ocean at midnight, Beach), "Fluffy Pastel Skyland" (a rainbow cloud kingdom, Sky Meadow), "Frosty Sweet Valley" (an ice cream mountain with sprinkles, Snow Peak). Indoor (no pictures): "Little Sailor Cove" (a pirate bedroom: striped wall, orange rug), "Sweet Bun Corner" (a cozy bakery kitchen: dotted wall, pink rug). Raw art and verbatim prompts in `docs/mockups/generated-backdrops/looks/` (the art of record: a second run never respends), baked art in `runtime/assets/looks/` (0.73 MB), data generated into `wishWorlds.data.ts`.
- **Measured**: an image averaged 14,700 input and 1,700 output tokens and 15.8 s (7 to 25 s); a brief 12.6 s; a live world took about 30 to 50 s from "Make" to its look. The service reported tokens and never money, so the cost per world is still unknown: Dan reads the price off the dashboard.
- **Looked at in the real game**: every showcase world in day and night, and one LIVE wish typed into Create ("a gingerbread village with candy canes" became "Sweet Cookie Hollow": its own sky, candy canes, jelly beans and gumdrops on the horizon, day and night), which came back from IndexedDB after a page reload.

**Not done / open:** sharing and a gallery (R2 was declined: device only); a vision safety check on the finished pictures (whether Muse can read images is still unmeasured); a "repaint this world" button; the wish worlds are only in Create (not in the Worlds list or on the Map); Safari encodes PNG where Chrome encodes WebP (bigger, unverified); no real-phone pass; no e2e (paused until beta); the production Worker's image backend is unverified (nothing deployed); the indoor floor is a tint only (no carpet or tile textures); a child-safe filter that is strongest in English. **Traps:** the first page load right after editing `world.ts` can leave a stale Create sheet (reload); two art tickets for the same sentence issued in the same millisecond are the same string (a test-only flake, fixed in the test).

## Rule (the Forge's rule, kept)

The model supplies words and choices from closed lists; code supplies every fact and every action; every output is checked by a deterministic gate; the result always
ends usable, falling back to something pre-made. The child's own words never reach the image model: they go to the LLM, which writes the brief, and the image prompts
are fixed templates filled only with the brief's filtered sentences.

## 1. What the game can consume today

- **A backdrop** is a `BackdropSpec` (`runtime/backdrop.ts`): a far band and a mid cut-out, each with a depth, a scroll factor, a fit and a tint, laid out from the live camera
  every frame. Today `BACKDROPS` is a static table with one entry (`garden`). A generated world needs a runtime registry (`registerBackdrop(worldId, spec)`) and textures
  that come from a URL or a blob, not a bundled file. Small change, covered by the existing e2e shape.
- **A world** is a record in `WORLDS` (`catalog.ts`): sky gradient (3 colours), fog, ground colour, light rig, hills, props, spots, extras. A generated world should be a
  **skin over one of the six base themes** (garden, sky, junk, beach, snow, room): the base theme keeps the physics, the missions and the prop set, and the brief overrides
  only colours and backdrop art. That is how "never changes physics" stays true by construction.
- **Indoor** already has its technique: the Toy Room (flat wall on the ground line, glossy floor, rug, chunky 3D props, the game's light rig), which every indoor theme in the mockup
  copied. It needs **no panorama**: an indoor world is a recipe for the room builder (wall pattern, floor, rug colours, props from the room set), not painted layers.
- **Day and night** are two looks. The game does not yet apply time of day to its 3D worlds (`timeOfDay.ts` says "later"), so for now "outdoor day" and "outdoor night" are two
  *kinds of world* the brief chooses between. One world that switches look by the clock needs that wiring and both far bands generated (section 3.6).

## 2. What the service does (measured 2026-11-03)

Re-run with `node scripts/probe-muse-image.mjs`; `models` and `params` are free (every call is rejected), `gen` and `brief` cost one call each.

| Fact | Measured |
| --- | --- |
| Models the key can use | `muse-image-1.0`, `muse-spark-1.1 / 1.2 / 1.3` (and `-contributor`), `muse-wonder-1.0` (a text model, see below), `sam-3.1`, `muse-voice-transcribe-1.0` (speech to text) |
| `/images/generations` parameters | `model`, `prompt`, `n` (at most 10), `size` (`"WxH"`, aspect at most 16:1), `response_format` (`url` or `b64_json`), `output_format`. **Rejected as unknown:** `background` (so no native transparency), `seed` (so results are not reproducible), `quality`, `style`, `negative_prompt` |
| What `size` does | It sets the **aspect ratio only**. The output is a fixed budget of about 2.5 megapixels: `1024x1024` gave 1600 x 1600; `2048x256` and `4096x512` both gave **4480 x 560**. A 16:1 request (`100000x6250`) was accepted; its output size was not recorded |
| Speed and size | 7.5 to 15 s per image; WebP, 90 to 120 KB. Each call reports about 17,000 input and 1,200 output tokens (the unit to turn into a cost) |
| Muse Spark / wonder as the brief writer | 8 to 15 s for a short JSON brief. **Valid JSON 10 of 10** (Spark 7, wonder 3). With the allowed-props list in the prompt: 0 of 29 props off the list across 5 briefs; without the list: free text in all 5, so the list is mandatory and the code must still validate. A scary wish and a brand-and-real-person wish both came back `ok:false` with a gentle alternative and a kind line. A Spanish wish got a Spanish `say`. `muse-wonder-1.0` was no faster (7 to 11 s) |

**What the pictures show** (samples and verbatim prompts in the mockups README):

- **Far band (8:1):** the night one is better than the hand-composed band in the mockup: stars across the whole width, one moon, layered hills on a level ridge. The day one has a soft sky,
  clouds and one sun. Both arrive at 4480 px wide, wider than the 4096 the game uses.
- **Mid strip (8:1, "on a pure black background"):** a clay-toy band of rounded hills and trees with **one** cottage, varied along its whole 4480 px. It keys cleanly with the same flood fill the
  Garden's bake script uses. This answers the Garden's known problem: the second cottage appeared only because the old art was 5:1 and had to be mirrored on wide canvases. At 8:1 it needs
  no mirroring on a phone and little on a desktop.
- **Preview:** the generated pair loaded into the parallax mockup (same layout maths, real stage scale) reads as a coherent night garden and, with the day band, a day garden.
- **A "seamless" wallpaper tile is not seamless.** Left-right the seam is fine (mean edge difference 3.7 against 2.0 between ordinary neighbouring columns); top-bottom it fails (15.8 against 1.7:
  a row of stars is doubled and cut). So tiles need a **seam gate** and a repair or a retry. Panoramas and strips do not tile, so they are not affected.

Spent measuring this: 8 image generations (1 square, 5 bands, 1 tile, 1 at an oversized size whose output I did not keep) and about 12 text calls. Not measured yet: cost in money (the usage is reported in tokens; billing converts it), the output size of a 16:1 request, whether Muse Spark can read an image (the Forge spec's A1 spike; needed
for a vision safety check), and quality over many wishes (every sample above is one try).

## 3. Design

### 3.1 The brief (Muse Spark)

One call, `muse-spark-1.3`, low effort, the same conventions as Create mode (`worker/muse.ts`: Responses API, safety prefix, contact details scrubbed, per-IP limit) and Describe
(`worker/describe.ts`). It returns **WorldBrief v1**:

```json
{ "ok": true, "name": "Sweet Sunset", "kind": "outdoor-day", "sky": ["#8A7BEE", "#FF9ECD", "#FFD59E"], "ground": "#A8E6A3", "fog": "#FFD5E5",
  "far": "A low round sun glows over a level line of soft purple hills in a peachy sky.",
  "mid": "A row of rounded gumdrop hills with swirly lollipop trees and a candy cottage.",
  "props": ["tree", "bushes", "cloud", "cottage", "lantern"],
  "room": null, "names": { "en": { "w": "candy forest", "g": "m" } }, "say": "Let's explore this sweet and cozy place together!" }
```

Validation is code, never trust: unknown keys dropped; `kind` from the closed list; hex colours validated and clamped to a luminance band per kind (night dark, day light) so a
brief cannot make an unreadable world; `props` filtered to `PROP_TYPES` (at most 6); `room` fields only from closed lists (wall: stripes, stars, dots, plain; floor: wood, carpet,
tiles; an accent colour); sentences length-capped, tidied, and passed through `kidSafeText` and the brand filter; `ok:false` or a failed check swaps in the gentle alternative or
the closest pre-made world. `names` reuses the Forge naming design (seven languages, signed speech: `worker/forgeNames.ts`), so the world's name can be spoken in the kid's language.
The brief never repeats the child's words (the safety prefix already says so; the filter's echo rule enforces it).

### 3.2 The images (Muse Image)

Prompts are **built by code from versioned templates** filled with the brief's `far` and `mid` sentences. They are the prompts in the mockups README with the sentence swapped in, always
ending "no text" and, for the mid strip, "on a PURE SOLID BLACK background (#000000)". Sizes: both layers `4096x512` (8:1). The two calls run in parallel. `n = 1`, one retry on a failed
gate (the service has no seed, so a retry is a different picture); `n` up to 10 is available later to pick the best of several candidates in one call if the pass rate is low.

### 3.3 Post-processing and gates (deterministic, no model)

- **Far band:** decode, resize to 4096 wide, WebP. Gates: aspect 8:1 within a few percent; mean luminance inside the kind's band (night dark, day light); a skyline that is level
  (the hills' top edge in the lower 60% of the image varies by no more than a small fraction of the band height); no large flat black or white regions.
- **Mid strip:** key the near-black surround (flood fill from the border, two fringe rings, crop), bleed colour into the transparent pixels, soften the alpha edge, resize to at most 2048 wide,
  RGBA WebP: exactly `scripts/make-backdrops.py`. Gates: the border really is near-black (if not, the model ignored the instruction: retry); opaque share 35 to 80 %; the art spans at least
  85 % of the width; its height is 25 to 75 % of the image; no holes in the silhouette.
- **Where this runs.** Python (Pillow, numpy) cannot run in a Worker. Options: **(a) on the device in Canvas** (the mockup's `keyAndCrop` already does the flood fill and crop in the browser,
  about 0.1 to 0.3 s for 2.5 MP; the server only brokers and returns the raw images); (b) in the Worker with a WASM image library (extra bundle, CPU limits); (c) a Python daemon like the Forge
  optimizer (new infrastructure). **Recommendation: (a)**, with the JavaScript port tested against the Python bake script's output on the committed samples so the two cannot drift.
- **Indoor tiles** (optional): if a wall or floor tile is generated, it must pass a seam gate (edge difference no more than about 3 times an interior neighbour's, on both axes) or take a
  deterministic repair (cross-fade the edge band) or fall back to the closed pattern list.

### 3.4 Indoor worlds

No panorama. The brief's `room` block fills the room builder's data: wall pattern, floor, rug colours, accent, and props from the room set (lamp, blocks, books, chair, plant, teddy,
ball, cushions). Placement is the code's (a seeded layout from the same list the Toy Room uses), not the model's. A generated wallpaper is an optional extra behind the seam gate. This is the
cheapest, fastest and safest kind: one text call, no image call, about 10 s.

### 3.5 Lighting and look

The brief's sky, fog and ground colours feed the base theme's rig; light intensities and the environment come from a closed set of rigs chosen by `kind`, never from the model. The base theme
decides the ground texture and the props available.

### 3.6 Day and night

Phase 1: the wish decides the kind, one look per world. Phase 2 (needs `timeOfDay.ts` applied to the 3D worlds): a world carries both looks, the same mid strip with a tint (as in the
mockup: untinted by day, `0xbfc8ff` by night) and two far bands, one per look; the second far band is one more image call with the brief's far sentence and "at night" or "by day".

### 3.7 Storage

The service cannot reproduce a picture, so generated art is **stored, not regenerated**. Options: the device only (IndexedDB; private, no server cost or deletion duty, lost with the device);
D1 as base64 (about 300 KB a world; adds server storage and a duty to delete); R2 (a new binding to create). **Recommendation:** pre-generated showcase worlds shipped as assets first
(zero live cost, full quality control), then live generation stored on the device only.

### 3.8 The job and the wait

`POST /api/world/generate` starts a job with stages like the Forge's: briefing, painting (two images in parallel), checking, done or failed, polled like `/api/forge/jobs/`. Expect **about 25 to 35 s**
for an outdoor world (brief about 10 s, images in parallel about 14 s, checks under a second) and **about 10 s** for an indoor one, so it needs the real stage UI, not a spinner:
the shared workshop strip (`kip-workshop-wait.js`) already takes real stages (`asking` for the brief, `checking`, `rest`); "painting" would be a new stage name with a brush-and-easel look.

### 3.9 Safety, privacy, cost

- The wish goes to our Worker and on to Muse Spark, the same class as Create mode and Describe (decided 2026-11-03: no parent gate); contact details are scrubbed first and nothing is logged but
  status. It never goes to the image model.
- Output checks: the text filters above; the code-built image prompts; the automated gates; an "AI-made" label; and a report or discard. A **vision safety check** (Muse Spark reading the finished picture)
  would be better, but whether it can read images is not yet measured.
- Rate: one world per few minutes per device and a daily cap per device (tighter than Create mode: a world is about two image calls plus a text call). Budget: about 17,000 input and 1,200 output tokens
  per image, to be converted to money from billing before any cap is set.
- **Fallback ladder:** a failed or rejected image, retry once; then the closest pre-made backdrop of the same kind (the Garden's night, and the day band once it ships) with the brief's palette;
  then the base theme with only the palette. The world is always playable.

## 4. Phases and acceptance (2026-11-04: G1, G2 and G3 are built, G4 partly: see 0.1)

| Phase | What | Acceptance |
| --- | --- | --- |
| G0 (done) | Measure the service; samples; this spec | Section 2 |
| G1 | Offline generator `scripts/generate-world-art.mjs`: wish to brief to far and mid, baked with the Garden's pipeline; make about six worlds (two day, two night, two indoor) for a taste check | At least 80 % of tries pass the gates within two attempts; Dan rates at least 70 % of the worlds 3 of 5 or better |
| G2 | Ship the good ones as pre-made worlds: runtime `registerBackdrop`, world records from briefs, the day and night looks, an e2e like `e2e-backdrop.mjs` per world | Each world passes the Garden's geometry and no-pop checks; fallback intact |
| G3 | Live route and stage UI, caps, on-device storage, signed spoken names | p95 wait inside the stated budget; cost per world measured; fallback ladder exercised |
| G4 | Indoor recipes from briefs, optional tiles with the seam gate | Seam gate rejects the measured bad tile and passes a good one |
| G5 (later) | Vision safety check, sync or R2, a parent gallery | After the A1 image-reading spike |

## 5. Questions for Dan (answered 2026-11-04: see section 0)

1. **Pre-made first, or live first?** Recommendation: pre-made showcase worlds (G1 and G2), then live (G3). It de-risks quality and cost and gives the hackathon demo something real.
2. **Storage:** device only (recommended) or the server?
3. **Budget:** a daily cap per child, and who pays for live generation.
4. **A parent gate** for live generation? (The text path has none; a picture is new but the child's words never reach the image model.)
5. **Day and night:** separate worlds chosen by the wish, or one world with two looks switched by the clock (needs time of day wired into the 3D worlds)?
6. **Which wishes first**, for the taste check (a candy forest, a jellyfish ocean, a pirate bedroom are in the samples)?

## 6. Not in scope

Generating 3D parts or prop meshes (the Forge does parts); changing physics, mission logic or the engine; text inside images; a world editor for the art; any use of a child's words by the image
model; storing a child's photo.
