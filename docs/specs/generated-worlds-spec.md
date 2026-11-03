# Generated worlds and backdrops with Muse (draft)

## Status

**Proposed, 2026-11-03.** Dan's ask: "work out the spec to auto generate new worlds and new custom backgrounds, outdoor (day and night) and indoor, using
Muse/Meta AI (the LLM and Muse Image)". Feasibility was measured today against the real service (section 2, samples in
[docs/mockups/generated-backdrops/](../mockups/generated-backdrops/README.md)). **Nothing of the generator is built.** The consumer it feeds, the Garden's
parallax backdrop, is: see [parallax-backdrops-spec.md](parallax-backdrops-spec.md) section 7.

A child says or types a wish ("a candy forest at sunset", "a jellyfish ocean at midnight", "my pirate bedroom"). The game makes a new playable world with its own
sky, hills and look. Muse Spark writes a small bounded **brief**; Muse Image paints the backdrop layers from prompts the code builds; **code does everything else**
(sizing, keying, gates, lighting, props, the world record). It never changes physics or the engine contract (product spec: generated worlds "may change sky, music,
props, and intro missions, but never physics").

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

## 4. Phases and acceptance

| Phase | What | Acceptance |
| --- | --- | --- |
| G0 (done) | Measure the service; samples; this spec | Section 2 |
| G1 | Offline generator `scripts/generate-world-art.mjs`: wish to brief to far and mid, baked with the Garden's pipeline; make about six worlds (two day, two night, two indoor) for a taste check | At least 80 % of tries pass the gates within two attempts; Dan rates at least 70 % of the worlds 3 of 5 or better |
| G2 | Ship the good ones as pre-made worlds: runtime `registerBackdrop`, world records from briefs, the day and night looks, an e2e like `e2e-backdrop.mjs` per world | Each world passes the Garden's geometry and no-pop checks; fallback intact |
| G3 | Live route and stage UI, caps, on-device storage, signed spoken names | p95 wait inside the stated budget; cost per world measured; fallback ladder exercised |
| G4 | Indoor recipes from briefs, optional tiles with the seam gate | Seam gate rejects the measured bad tile and passes a good one |
| G5 (later) | Vision safety check, sync or R2, a parent gallery | After the A1 image-reading spike |

## 5. Questions for Dan

1. **Pre-made first, or live first?** Recommendation: pre-made showcase worlds (G1 and G2), then live (G3). It de-risks quality and cost and gives the hackathon demo something real.
2. **Storage:** device only (recommended) or the server?
3. **Budget:** a daily cap per child, and who pays for live generation.
4. **A parent gate** for live generation? (The text path has none; a picture is new but the child's words never reach the image model.)
5. **Day and night:** separate worlds chosen by the wish, or one world with two looks switched by the clock (needs time of day wired into the 3D worlds)?
6. **Which wishes first**, for the taste check (a candy forest, a jellyfish ocean, a pirate bedroom are in the samples)?

## 6. Not in scope

Generating 3D parts or prop meshes (the Forge does parts); changing physics, mission logic or the engine; text inside images; a world editor for the art; any use of a child's words by the image
model; storing a child's photo.
