# Parallax image backdrops (draft, mockup-first)

> Status: **Every outdoor world has its backdrop in the real game, in a day and a
> night look that follow the player's clock (2026-11-04, §8; the Garden's was
> first, 2026-11-03, §7).**
> Dan approved the mockup's look ("perfect"; the indoor themes use the Toy
> Room technique instead of image layers, §2b) and asked for the Garden and
> the Toy Room first, then (2026-11-04) "do them all, and for outdoor do day
> and night based on the user's time". A near strip, a mirror-extended mid and
> phone performance are not done. (Original status: draft, mockup v5 built,
> nothing ships until the mockup is approved, decided 2026-11-02.)
> Mockup: `docs/mockups/parallax/` (`sh docs/mockups/parallax/serve.sh`,
> then `http://127.0.0.1:8765/index.html`; `?cam=16&explode=0&motion=0`
> gives deterministic stills; see its README). Recorded in carousel spec
> §17 item 2.

Question: replace the far 3D backdrop geometry (hill spheres) with
generated-image planes on stepped depths, keeping every gameplay
object 3D. Does it read better, stay cheap, and survive the real
camera?

## 1. What is true today (measured in code)

- `buildWorld` (`runtime/world.ts`) paints back-to-front by
  construction: sky-gradient canvas texture as `scene.background`
  → `applyLightRig` → ground slab `80×1×34` at `(18,-.53,7)` →
  `groundPlane` → `hills()` (sphere rows at z −22…−26 and −44…−46)
  → night star points (z −120…−60) → orb → scatter/extras → props
  → spots/covers → missions → town signs. The factory turntable is
  a separate group (`buildFactory`), not part of the lane.
- Camera: `PerspectiveCamera(36°, near .1, far 500)`; play framing
  `position.set(cam.x, 2.6+dd*.24, dd)`, `lookAt(cam.x, ~1.1, 0)`
  with `dd` the zoom distance (≈10 default). Lane x ≈ 0…45,
  camera x clamped 3…41.
- Fog is linear per theme (`runtime/lighting.ts`): garden
  `0x1d2470` near 46 far 150; sky 55/150; junk 44/140. Existing
  far content already opts out where needed (orb, star points,
  aurora ribbons at z −90…−100 all `fog:false`).
- The native-port spec reserved stepped background planes
  (z = −4, −9, −16, −24) for post-freeze 2.5D; this proposal uses
  deeper steps so planes never fight lane props (z ≥ −6).

## 2. Proposed layer stack (per theme)

**Sizing rule (the part v1 got wrong): size from the visible slice,
scale uniformly, never stretch.** The play camera is pitched
`atan((5.0−1.1)/10) ≈ 21.3°` down with a 36° FOV, so its top ray is
only ≈3.3° below horizontal. At a plane of depth z the camera sees
only the band between that top ray and the ray over the ground slab's
far edge (z −10, y 0): `yTop = 5.0 − tan(3.3°)·(10−z)`,
`yBot = 5.0 − 0.25·(10−z)`.

| plane z | visible y band | height |
|---|---|---|
| −46 | −9.0 … +1.8 | 10.8 |
| −22 | −3.0 … +3.15 | 6.2 |

Anything outside the band is never seen (the horizon, moon and stars
of a 3:2 frame are off-screen). **Every layer's base sits on the ground
line** (`yBot`, tucked ≈0.12 below it so no hairline shows): the art is
placed from its bottom edge, so all hills share one baseline and none
are sliced at arbitrary heights by the ground edge (v3 anchored the
top and let the slab cut the hills — rejected in review). The mid art
is scaled so its **whole height fits the band** (top ≈4% under the
screen top); the far band is scaled to cover the width and is never
shorter than the band.

Back to front, painter's order preserved:

1. Sky gradient (`scene.background`, unchanged) — also the asset-
   load fallback together with today's `hills()`.
2. **Far image — the second background image** z −34, opaque,
   `fog:false`, scroll factor .85. In the mockup it is `far-night.png`,
   a 5742×760 (7.56:1) **band-shaped panorama built from
   `far-garden.png`** by `make_far_night.py` (kept beside the mockup).
   The original is 3:2 with a ≈460-row empty sky gap between moon and
   hills, which the ≈7:1 band can show only by stretching or by
   repeating the moon, so it is re-composed instead: the sky is the
   image's own vertical gradient, compressed vertically (a smooth
   gradient tolerates it); stars and the moon are lifted out as additive
   deltas and placed at true shape (moon ×2.5 and stars ×2 so they
   survive the ≈5× downscale to the screen band) — the moon exactly
   once, stars scattered over the full width; the hills are the original
   rows at 1:1, mirrored to 3× width (smooth hills hide a mirror, seams
   are continuous). It fits the band at 100% height, so the shader does
   no mirror-repeat (`?far=` overrides the fit). The mid strip in front
   hides the lower hills; the moon and stars show above it and between
   the trees.
3. **Mid strip** z −22, alpha-cutout hills/trees band, slight blue
   distance tint, `fog:false`, `depthWrite:false`, scroll factor .65.
   Replaces the z −22…−26 sphere row. Height 86% of the band by default (≈5.4 units; a slider/`?mid=` runs
   60–100%): lower shows more of the hills layer, higher repeats the
   mid art less. A 4.75:1 art is then only ≈26 units wide, so on a
   landscape canvas it is **mirror-extended** (`MirroredRepeatWrapping`, uv repeat > 1) out
   to the ≈54 units the window + travel need. Mirroring repeats
   landmarks (see §4) — a stop-gap until the art is wide enough (§3).
4. **Near strip** z −9, alpha-cutout foreground silhouettes, `fog:false`.
   New layer; must never occlude the lane. **Needs its own art** — v1
   reused the mid art and the repeated house/trees read as an obvious
   loop. Not in the mockup.
5. Everything from ground slab forward unchanged (props, spots,
   missions, player, blob shadow).

**Scroll factor.** A plane static in world space would have to span
the window plus the whole 38-unit camera travel — ≈110–170 units wide.
One image cannot do that without stretching (v1: 4.6× on the mid
strip, 1.8× far) or tiling (obvious loop). Instead each layer follows
the camera: `x = laneMid + f·(camX − laneMid)` with far `f = .85`,
mid `f = .65` (one assignment per layer per frame). It then only needs
window + `(1−f)·38` (≈56 units for the mid strip at a 1.9:1 canvas), so
one uniformly scaled image covers the lane. Cost: apparent depth is larger than the real z, which is fine
for backdrops; depth ordering (far slower than mid, both slower than
lane props) is preserved: relative to lane speed the layers move ≈3.4% (far) and
≈10.9% (mid), i.e. `(1−f)·10/depth`. Width is recomputed from the canvas aspect on
resize.

The perspective camera still supplies the differential, no extra render
pass, one WebGL context. Planes are excluded from `linearize()`
intensity scaling (basic materials already are) and from shadow
casting/receiving.

### 2a. Ground and path (v4, same rules)

- **Ground** — a textured plane, top at y 0, x −22…58, z −10…24 (the
  slab's footprint), **square texels** (same world units per pixel on
  both axes; the mockup tiles a seamless 1024 px tile per 16 units, low
  contrast so the repeat stays quiet). Its far edge (z −10) *is* the
  ground line every backdrop base sits on, so ground and backdrop share
  one horizon by construction.
- **Path (generated, v5)** — nothing is baked. A ribbon mesh at y +0.012
  centred on the lane (z 0), spanning x −22…58 in 0.25-unit steps. Each
  edge is `±(width/2 + wobble·noise(x))` from seeded 1-D value noise
  (three octaves, `wobble` 0.18), with a 0.16-unit feathered, slightly
  darker muddy rim carried in vertex colour alpha. The surface is one
  512 px **seamless dirt tile** mapped in world coordinates (6 units
  per tile, square texels). Stepping stones are two `InstancedMesh`es
  (rim + top, ≈48 stones, seeded size/jitter/colour). Width, wobble and
  seed are parameters (mockup slider 2.2–3.8; `?pathw=`). Default width
  **3.0 units = 2.7× the toy** (was ≈2.7 visible, so +11%); it never
  moves, so it is under the toy at every x and z. Draw order: ground →
  path (`renderOrder` 1) → blob shadow (2) → toy; trees and props stand
  beside it. Cost: ≈1.3 k vertices plus a 512² tile, instead of the v4
  7680×317 px (≈10 MB) baked image — and the shape can differ per
  world by changing the seed.
- **Tension with §11.6 to decide:** the carousel spec lets the toy walk
  z ∈ [−1.2, +1.2]; with the toy's 0.55 radius its footprint reaches
  ±1.75. The 3.0-unit default path is ≈±1.5 (±0.18 wobble), enough for
  the mockup's ±0.8 walk (footprint ±1.35) but not the full ±1.2. Either
  set the width to ≈3.5 (3.2× the toy, slider range covers it) or narrow
  the walk.

### 2b. Theme variants: day and indoor rooms (mockup)

> **Superseded for indoor themes (review round 12).** Dan approved the
> Toy Room port and asked for every indoor theme to use *its* technique,
> so Indoor room, Library, Workshop and Desk-top no longer use the
> painted far/mid strips, the Parallax and Images controls, or the
> scroll-factor layers described in the bullets below. See "Indoor
> themes: the Toy Room technique" at the end of this section. The strip
> bullets are kept as the record of what was tried and why it read as
> weird. Night and Day garden are unchanged and still use two image
> layers.

The mockup's theme switch (`?theme=night|day|room|library|workshop|desk`, buttons above
the stage) is **one config per theme**: sky colour and fog, the two lights,
the ground tile, the path style, the props, and the two backdrop
layers. The layout rules of §2 and §2a do not change per theme — that
is the point of the exercise.

- **Day** — same band-shaped far panorama recipe as night
  (`make_far_day.py` → `far-day.png`, 5742×760): a day gradient, one sun
  and soft clouds in the moon's slot, and the *same original hills*
  recoloured, keeping the original's own tonal layering (far = light and
  hazy, near = dark green). The mid image is the same `mid-garden.png`,
  untinted (night tints it blue). Brighter grass and dirt tiles, warm
  sun, light-blue fog (60…190), props recoloured.
- **Indoor room** — **there is no room art in the repo, so every room
  asset is code-drawn stand-in art**: a 4096×540 wall (wallpaper,
  wainscot, windows with curtains, pictures, clock, shelf; all placed in
  the upper half so furniture in front does not hide it), a 6144×560
  alpha furniture strip (16 distinct pieces: sofas, bookcases, lamps,
  armchairs, TV unit, plants, chest, crates), a wooden-floorboard ground
  tile (8 units) and a runner-rug path (6×3-unit tile, straight edges,
  no stones, texture mapped across the path width so its border follows
  the width slider). Props are floor lamps and potted plants.
- **Why the first room looked weird: scale.** The backdrop band is
  only about half the toy's height on screen (mid band ≈6.2 units at
  depth ≈32 → ≈0.20 of the view; the 3.6-unit toy at depth 10 → ≈0.34),
  so whole sofas and armchairs read as doll furniture beside a giant
  toy. Outdoors this never shows, because hills and trees have no known
  size. Indoors there are two fixes that work with this camera: **tall
  things that run off the top of the frame** (the mid art is scaled to
  120% of the band so the screen crops it; they then read as big and
  far), or a **toy-scale diorama**. Both are built as alternatives
  (`?theme=library`, `?theme=workshop`; the first room stays for
  comparison).
- **Library** — a 4096×540 wall of shelving all the way up (10 rows of
  books, two arched windows, sconces, a dark top so the room feels
  tall), and a 6144×560 alpha strip of tall free-standing cases, a
  rolling ladder, a grandfather clock, two desks with lamps, globes and
  a wing chair. Parquet floor, burgundy runner, stacks of books as
  props. Far and mid are both books, so depth separates mainly by the
  mid layer's cases and the far layer's dark top.
- **Workshop** — a workbench diorama: the ground is bench-top boards,
  the path is a self-healing **cutting mat** (grid, ruler ticks,
  protractor ring), the far layer is a **pegboard of tools** with
  marker-outline shadows (hammers, saws, wrenches, level, clamps, a
  shelf of paint cans and jars), and the mid layer (cropped by the
  screen top) is tool cabinets, two 3D printers with a half-printed toy,
  bin racks, shelves, lumber, a boombox, boxes and articulated lamps.
  Props are giant bolts and thread spools. It is the on-brand option
  (Toyforge prints toys).
- **Desk-top world** (chosen from the ideas in review round 9; the toy
  walks a desk among giant stationery) — the path is a **wooden ruler**
  (cm ticks, numbers upright from the camera), the ground is warm desk
  wood with coffee rings, the far layer is a 4096×540 wall (sunset
  windows over a city skyline with lit windows, curtains, cork boards
  with pinned notes, polaroids and a child's drawing) and the mid layer
  is a 6144×560 alpha strip of stationery chosen for height: a pencil
  cup with tall pencils, a stack of books, an articulated lamp, a
  standing ruler, a giant roll of tape (you can see through its hole),
  an alarm clock, open scissors, binders, a steaming mug, a paper stack
  with a notebook, crayons, a calculator, a glue stick, an eraser, paper
  clips, a pen and ink. Props are pencils standing on their erasers and
  stacks of sticky notes. Tall pieces run off the top of the frame, which
  is what makes them read as giant.
- **Indoor parallax: full, slower, none, or one image.** Indoors, two
  flat layers sliding over each other can read as paper cut-outs. The
  mockup therefore has two independent controls on every theme —
  **Parallax** (Full / Slower / None) and **Images** (2 / 1, indoor
  themes only) — and the indoor themes default to Slower. Speed sets
  each layer's follow-the-camera factor `f` (full: far .85, mid .65;
  slower: far .97, mid .92; none: both 1, i.e. pinned to the camera).
  **Measured** (desk theme, each layer alone, camera x 10 → 34): slower
  shifts the far layer 13 px and the mid layer 49 px; none shifts both
  **0 px** (the two renders are pixel-identical). **One image** merges
  the wall and the furniture into a single layer at the screen scale each
  had as its own layer (the wall is mirror-tiled to the furniture's
  width, so wall details repeat mirrored), and then moves at whatever
  speed is selected. With one image and None the backdrop is a single
  static picture.
- **Toy Room (game)** (`?theme=toyroom`) — a **port, not an imitation**, of
  the main game's own Toy Room (`runtime/world.ts` `roomWall` / `rug` /
  `plankTex` / room props, `worldScene.ts` `plastic` / `metal` / `rbox` /
  `setEnvironment`, `lighting.ts` `LIGHT_RIGS.room`, `catalog.ts` level
  `room` and `THEME_DEF.room`). Copied: the 130×32 indigo wallpaper plane
  (even 32-px stripes, six gold stars per 256-px tile, repeat 16×4) at
  z −10 with the 130×0.8×0.25 lavender baseboard; the glossy plank floor
  (repeat 7×3, roughness .42, clearcoat .5); the 9×5 rainbow oval rug at
  (20, 1.5); the level's props (lamp 2, blocks 9.5, books 16.5, lamp 24
  z −5.5, blocks 32.5 z −4.2, books 40, lamp 44) plus the K2 pack (chair,
  teddy, plant, ball, cushions); the warm evening rig (hemisphere
  `#ffd7b0`/`#3a2a60` .6, key `#ffe0b8` 1.7 at (−5, 14, 10), rim `#ffb27a`
  .8 at (−6, 8, −12), fog `#2a2058` 46…140), the same four-panel PMREM
  environment (`ROOM_ENV`, scale .9), ACES tone mapping at exposure .95,
  soft shadows, and the 30 fireflies. **Not ported:** bloom, colour grade
  and vignette, and the toy character (a capsule stand-in).
- **Finding from the port: the game's Toy Room has no backdrop depth.**
  Its wall is one flat plane at z −10, which is exactly the ground line,
  so through the camera's thin slice (§2) only its lowest ≈3.85 units
  show: about one and a half rows of stars above the baseboard. There is
  nothing to parallax today. Any backdrop work for this world therefore
  *adds* a scene behind the wall rather than replacing a deep one; the
  library / workshop / desk themes are candidates for that, and the
  game-palette toys (blocks, bears, books) are the natural mid layer.
- **Indoor themes: the Toy Room technique (review round 12).** The
  game's Toy Room works without any backdrop image: a flat wallpaper
  plane on the ground line plus a baseboard, a glossy floor, a rug, and
  chunky clear-coated 3D props, lit by the game's rig (hemisphere + key
  + rim, a four-panel PMREM environment, ACES tone mapping, soft
  shadows, glow sprites, fireflies). Because the props are real 3D at
  real scale, nothing is cropped into a thin band and nothing needs
  parallax. All five indoor themes now share one builder
  (`buildNativeRoom`: `wall` tile + baseboard, `rug`, `decor`, a `propset`
  of builders and a `propList` of placements) and differ only by data:
  - **Indoor room** — cream striped wallpaper, three windows with
    curtains over a dusk/night city, framed pictures and a clock, sofas,
    armchairs, bookcases, a TV unit, tables, the game's lamps and plants,
    an oval rug.
  - **Library** — a wall of book spines, 8-unit bookcases (instanced
    books, so ≈1.5 k spines cost one draw call per case), a rolling
    ladder, grandfather clocks, globes, reading desks with banker lamps,
    wing chairs, burgundy oval rug.
  - **Workshop** — pegboard wall with tools hung on it as 3D, tool
    chests, 3D printers with a half-printed toy, bin racks, paint cans,
    lumber, a vise, bolts, spools, an articulated lamp, a cutting mat.
  - **Desk-top** — graph-paper wall with a ruler baseboard, cork boards
    and sunset windows as 3D wall decor, a honey-wood desk with coffee
    rings, a page of lined paper as the rug, giant stationery (pencils,
    pencil cup, scissors, binders, mug, tape, crayons, calculator, alarm
    clock). The front row (z > 0) is kept low so nothing giant stands
    between camera and toy.
  Props follow the game's conventions: materials are `plastic` (clear
  coat .85), `metal` and `glow`; rounded boxes via `rbox`; lamps carry a
  point light and a glow sprite. The mockup builds them from primitives
  and procedural canvas textures, so **no new art is needed**: the
  Toy Room technique is what removes the dependency on illustrators.
  **Caveats:** the five placements (and the K2 prop positions in the
  Toy Room itself: chair, teddy, plant, ball, cushions) are mine, not
  from the game's level data; the game's own Toy Room level only places
  lamps, blocks and books. Prop cost is not measured: the library has
  many meshes (shared instancing helps, the rest does not), so any real
  port must check draw calls.
- **What it shows about art shape.** The garden mid art is 4.75:1 and
  must be mirror-extended on a landscape canvas (the second-house
  problem, §4). The room furniture strip is 11:1, wider than the ≈10:1
  the window + travel need, so the shader never repeats it: nothing is
  duplicated. That is the evidence for §3's "author mid art at ≥ 10:1".
- **Day/night art budget.** Per theme the far layer is one image
  (≈0.9 MB PNG here), the mid layer one image; ground and path are
  small tiles. The room's art would be real work for an illustrator:
  the stand-ins only prove the layout, depth and scale.

## 3. Art production

- One style prompt + shared seed/reference per theme set to hold
  the six themes together; far panoramas must fade to the theme's
  fog colour at left/right edges (tiling across the 45-unit lane).
- **Author for the slice, not a 3:2 frame.** The camera only ever
  shows an ultra-wide sliver, so generate mid/near art as wide short
  strips (≈4:1–10:1) and far art as a wide band whose hill line sits
  ≈2/3 down. A 3:2 generation wastes ≈80% of its pixels off-screen.
  Every strip needs a distinct image (no reusing mid art as near) and
  enough internal variety that nothing repeats within the 60-unit span.
- Mid/near strips need a **real alpha channel**. The mockup
  flood-fills the black surround from the border, erodes the dark
  fringe and crops to the art's bounding box — good enough to judge,
  not to ship. Production: generate, then background-remove into
  transparent PNGs, ≤ 2048 px wide.
- Budget: 6 themes × 3 layers ≈ 18 textures ≈ ≤ 12 MB total at
  2048px (WebP/PNG); lazy-load per world with the existing
  texture cache, dispose on world switch with `W.root`.

## 4. Mockup findings (2026-11-02, Garden only)

Built at real stage scale (FOV 36, camera formula, fog 46/150,
lane props at z 0) with two generated 1920×1280 layers.

**v1 (rejected by review, same day):** planes were sized to cover the
lane (170×62, 110×16, 88×8.5) against 3:2 textures, so the art was
stretched 1.8× (far), 4.6× (mid) and ≈7× (near), the stretched strips
were also clipped by the visible slice (§2), and the near strip was the
mid art again — the repeated house and trees read as an obvious loop.
The v1 "reads well" conclusion was wrong; only the differential-motion
finding below survived.

**v2 (uniform scale, slice-anchored, scroll factor, no near strip),
screenshot-checked at cam x 6 / 22 / 38 and exploded:**

- Trees and hills keep their true proportions; the lane is covered end
  to end with one image per layer, no blank edges, no repetition.
- Differential motion still reads on the camera slider; exploded view
  confirms the spare stack.
- Anchoring the mid strip's top inside the slice and letting its base
  hide behind the ground slab removes the horizon seam v1 flagged.
  Anchor y is per-theme tuning (and shifts with zoom steps), not code.
- **Review round 2: "ground level is not equal".** At 2× zoom the
  generated far art's dark hills sloped diagonally at the lane edges
  and did not share a base with the mid hills. **v3** replaces the far
  layer with a minimal procedural band (§2): one level ridge, no
  objects. It now reads as a single consistent horizon behind the mid
  hills at cam x 6 / 22 / 38 and in the exploded view. The far layer in
  the mockup is a stand-in drawn in canvas, not generated art; a
  generated replacement should follow the same "one level ridge" brief.
- **Review round 3: "image bottom should align with ground level"**,
  plus textured ground and path. **v4** anchors every layer by its
  base on the ground line (§2), fits the mid art's whole height to the
  band, and adds the textured ground and 3×-width path (§2a). Checked
  at cam x 6 / 14 / 22 / 30 / 38 with the toy pinned at z ±0.8–1.0 and
  in the exploded view: hills share one baseline, trees are whole, the
  path stays under the toy and the toy's shadow lands on it.
- **Known regression in v4:** with the whole art fitted to the band
  (≈29 units wide) a desktop canvas needs ≈54, so the strip is
  mirror-extended and a **second house appears at the lane ends**
  (visible at cam x 38). Phone portrait needs only ≈10 units, so it
  would not show. Real fixes, in order of preference: (1) generate the
  mid art at ≥7:1 with enough variety for ≈54 units; (2) a different
  mirror seam that avoids the house; (3) a nearer ground edge — moving
  the slab's far edge from z −10 to z −6 grows the mid band from 6.2 to
  ≈8.2 units, so the current art (≈37 wide) nearly spans a desktop
  window unmirrored. (3) changes the stage's ground extent, so it is a
  design call, not applied.
- **Review round 4 (v5):** "create the path procedurally, make it
  wider" and "add a 2nd bg image further". **Path** is now generated
  (§2a) at 3.0 units, +11% on v4's ≈2.7 visible. **Second bg image**
  added at z −34 (§2): `far-garden.png`'s navy hills keyed to a real
  RGBA silhouette, with the sky reduced to a plain gradient behind it.
  Verified at cam x 6 / 22 / 30 / 38 and exploded (three distinct
  planes), at path widths 2.2 and 3.8, with no console errors. In that build the navy hills were hard to see (see round 5).
- **Review round 5: "looks like we only have 1 image for the bg".**
  Both images were in the scene, but the second was hidden: the mid
  strip filled the same band and the navy hills sat against a dark sky.
  Fixes: far hills scaled to 120% of the band, sky lightened to dusk
  blue, mid art default 86% of the band (new **Mid size** slider),
  scroll factors spread to .95 / .85 / .65, per-layer **sky / hills /
  mid** toggles and a lane-relative speed readout. **Measured, not
  assumed:** with each layer rendered alone (`?layers=hills&clean=1`),
  moving the camera x 10 → 34 shifts the hills layer **67 px** and the
  mid layer **213 px** on screen (ratio 0.31); the geometry predicts 66
  and 213 px. So the two images do move at different speeds, in
  proportion to `(1−f)/depth`. Trade-off: a shorter mid strip shows
  more of the far hills but is narrower, so it mirror-repeats more (at
  70% a second house is visible in the window).
- **Review round 6: "far-garden.png is good but far-hills.png is not
  good, regen".** The v5 `far-hills.png` was a silhouette cut-out of
  `far-garden.png`: flat navy, original sky gone. It is regenerated
  (old copy kept in the session scratchpad) as an **opaque crop of the
  original** — same pixels, sky and layered hill tones intact — and the
  code-drawn sky layer is removed, so the backdrop is now exactly two
  images (far + mid). I cannot generate new art in this environment, so
  "regen" here means re-deriving from the existing image, not a new
  generation. Checked at cam x 14 / 34 and exploded, no console errors.
  The measured speed gap is unchanged (same z and `f`: 67 px far vs 213
  px mid for cam 10 → 34, measured on the previous crop).
- **Review round 7: "try [far-garden.png] again".** Use the whole
  image, moon and stars included, as the far layer. Rounds 5–6 had
  cropped it to the hills, and I had said the moon and stars could not
  show; they can, once the art is re-composed into the band's shape
  rather than cropped or stretched (§2). Checked: the far layer alone
  shows the sky, stars, one moon with its glow, and hills on the ground
  line; with the mid strip the moon and stars show above the trees;
  camera 10 → 34 shifts it 67 px against 66 predicted; no console
  errors. Caveats: this is derived, not a new generation (stars are
  placed procedurally, the gradient is compressed, moon ×2.5 and stars
  ×2 vs the original, hills are a 3× mirror of one range); the earlier
  `far-hills.png` crop is no longer used by the mockup.
- **Review round 8: "do a daytime version and an indoor room version".**
  Theme system added (§2b). Checked all three themes at cam x 14 / 30,
  the room exploded, no console errors. Day is the night recipe
  recoloured, so it is derived from the existing art, not new art. The
  room is entirely code-drawn stand-ins. A first room render had
  see-through furniture (a gradient to translucent black over an empty
  canvas); fixed with an opaque shade.
- **Review round 9: "indoor is weird, any other ideas?"** Diagnosed as
  a scale problem (§2b) and answered with two more indoor themes,
  Library and Workshop, both code-drawn stand-ins, both with distinct
  pieces and no mirror-repeat (the alpha strips are 11:1). Checked
  at cam x 14 / 22 / 30 / 34 and exploded, no console errors. Other
  ideas not built: a grand hall (columns and arched windows cropped by
  the screen top, marble floor, red carpet runner), a playroom floor
  (toy-scale props, furniture cropped), a desk-top world.
- **Review round 10: "either we don't want parallax on indoor, or
  slower, or only one image" + "do the desk-top world".** All three
  options are one click away on the indoor themes (§2b); the decision is
  Dan's and is not recorded here yet. The desk-top world is built as
  its own theme, code-drawn stand-ins like the other indoor themes.
  Checked at cam x 14 / 22 / 30, exploded, and in the merged one-image
  None mode, no console errors. A first render had the ruler numbers
  upside-down (the across-width texture's "up" pointed at the camera);
  the mapping is now flipped for every across-width path.
- **Review round 11: "replicate the toy room from the main game".** Added
  as a faithful port (§2b). The port needs the game's renderer settings
  to look right (ACES, shadows, the prefiltered environment); without
  them the clear-coated plastic looks flat. Checked at cam x 14 / 22 / 30
  and exploded, no console errors; the other themes were re-checked and
  are unchanged. The mockup's toy is still a capsule, so the toy's own
  look is not compared.
- **Review round 12: "toy game room is perfect, make all the other
  indoors use the same technique".** Done (§2b): Indoor room, Library,
  Workshop and Desk-top are rebuilt as native 3D rooms; the old strip
  art is deleted from the mockup page (a copy of the previous page is
  in the session scratchpad). Checked all five at cam x 8 / 14 / 22 / 30
  and exploded, no console errors; the garden themes were re-checked and
  are unchanged. Fixes made after first renders: a giant foreground
  pencil blocked the Desk-top view; Living room windows sat behind
  bookcases; front-row props moved off the default start position.
  **Consequence for the parallax question:** indoors there is nothing to
  parallax, so Dan's "none / slower / one image" choice is moot for
  indoor themes; it still applies to the garden themes.
- Still open: real alpha for the mid art (flood-keyed in the mockup),
  near-layer art, real ground/sky/dirt art (canvas-drawn stand-ins),
  phone-width verification (the 390 px headless shot came out clipped,
  so phone portrait is unverified; the "would not show" claim above is
  arithmetic, not a render), the mirror-repeat of the mid art on wide
  canvases, and wide-canvas coverage on the real game canvas.
- v2 is verified as headless-Chrome-on-Metal stills only; fps was not
  re-measured. v1's "60 fps" came from software rendering and says
  nothing about a real GPU or phone, so treat performance as unproven
  until the C3 real-device pass.

## 5. Acceptance if approved

- All 6 themes + labs read at 390×844 and desktop; no seam at any
  camera x in 3…41 or zoom step; planes never cover a mission,
  spot, sign, or the toy.
- Fallback intact: kill the textures (404) and the world still
  boots on gradient + hills.
- `prefers-reduced-motion` unaffected (planes are static geometry;
  parallax comes only from the player's own camera moves).
- Real-phone pass rides with the C3 gate (carousel §13.3).

## 6. Explicitly not in scope

- No image foreground/gameplay sprites; props stay 3D (carousel
  §11.7 prop reactions need real meshes).
- No camera, fog-rig, or lighting changes beyond `fog:false` on
  the new planes.
- No day/night variants until the base six land.

## 7. In the game: the Garden (built 2026-11-03)

**What shipped.** The Garden (and any Create-mode level whose theme is `garden`) now draws two image planes instead of the sphere hills: the moonlit far
band (`z -34`, scroll factor .85, opaque) behind the hills-and-trees cut-out (`z -22`, factor .65, tinted `0xbfc8ff`, fitted to 86% of the visible
slice). Files: `runtime/backdrop.ts` (geometry, loading, lifecycle), three small hooks in `runtime/world.ts` (build, per-frame layout, teardown),
`runtime/assets/garden-far-night.webp` and `garden-mid.webp`, baked by `scripts/make-backdrops.py` from the mockup's images. Tests:
`tests/backdrop.test.ts` (35, mutation-checked twelve ways) and the real-GPU `scripts/e2e-backdrop.mjs` (21 checks, portrait and landscape).

**The Toy Room: nothing to apply, by decision.** §2b's finding and review round 12 stand: the game's Toy Room is a flat wall on the ground line plus a
baseboard, a glossy floor, a rug and chunky 3D props, and that is the technique every indoor theme was told to copy. It has no hills to replace and no
depth to parallax, so it has no backdrop (`BACKDROPS` holds only `garden`) and the e2e checks it is untouched. A scene *behind* the wall (a window onto a night
city, say) would be new work, not a port.

**Findings that changed the design (the mockup could not have seen them).**

- **The camera is not at a fixed distance.** The mockup froze it at 10. In the game it is `clamp(view width / ..., 10, 22)` times a zoom step of 1, 1.5 or 2.1, so
  it runs from 10 to about 46 units back, sits at about 16 on a phone in portrait, and the title/showcase view adds an asymmetric view offset. The visible slice
  (§2) therefore changes with the device, the zoom and the screen. Each layer is now laid out every frame from the live camera's own projection (its top ray
  and four corner rays unprojected onto the layer's plane); nothing assumes a camera. Checked at three lane positions x three zoom levels in both orientations
  plus the showcase view: every layer's base sits on the ground line (to 0.03 units), the art is never stretched (aspect within 1%), the plane spans the window,
  and the far band reaches the top of the screen. The slice formulas also reproduce this spec's own table at the mockup's camera (−3.0…+3.15 at z −22).
- **Phone portrait, the case §4 left unverified, works and reads well.** The window is only about 13 units wide there, so the mid strip needs no mirroring
  (repeat 1.0). The art looks bigger on a phone than on desktop because the band above the horizon is about twice as tall (the camera looks nearly level at
  distance 22); it still fits the band, so it keeps the same share of the screen. If it feels too large, `fitFrac` in `GARDEN_BACKDROP` is the knob.
- **A world rebuild must not pop.** The game rebuilds the world on every world or level change. With per-build loading, each rebuild showed the old sphere hills
  for a few frames and then snapped to the painting. Fix: loaded images live in a per-runtime cache (a rebuild resolves within the same tick, before any frame), the
  planes are laid out the moment they are ready and only then are the old hills hidden. Measured across 109 frames of a rebuild: 0 frames of old hills, 0 without the
  backdrop. A failed load is not cached, so the next build retries.
- **Fallback is the old world, exactly.** The sphere hills (and the star points and orb) are built first and hidden only when both images are in. With the image
  requests blocked the game boots, the hills show, nothing throws and the toy walks (checked).
- **The mid art is now a real cut-out.** The mockup keyed the black surround to transparency in the browser at load (a 2.4 MP canvas pass per world load). The bake
  script does it once with the same rule (flood-fill the near-black surround from the border, two more rings of dark fringe, crop), then colours the transparent
  pixels like their nearest art pixel and softens the alpha edge by one pixel, so a filtered edge fades to the art's own colour, not to black (verified on a bright
  background: no dark halo). Result 1831 x 370, 44 KB. The far band is 4096 x 542 (the widest texture every phone GPU takes; the mockup's 5742 is not), 18 KB.
- **No leak from the backdrop.** The game itself leaks about 5 GPU textures per world switch (`buildWorld` does not free the last world's textures: a finding for
  whoever owns it, separate from this work). Measured under identical conditions the backdrop adds nothing to that (5 per cycle with it, 5.3 without).

**Known and not fixed.**

- **The second cottage on wide canvases (§4, unchanged).** At the lane ends of a desktop-wide window the mid strip mirror-extends (repeat 2.5) and a second house
  appears. Phones never show it. Real fix: art authored at 10:1 or wider (§3), which the Muse generation spec covers.
- **Garden at night only.** There is no day Garden because `timeOfDay.ts` is not applied to the 3D worlds yet (its header says "later"). The mockup's `far-day.png`
  exists and would drop in as a second `BackdropSpec` once that is wired.
- **The other worlds have no backdrop art:** Sky Meadow, Junkyard, Beach and Snow Peak still use their sphere hills. Each needs a far band and a mid cut-out
  in its own palette, authored for the slice (§3). Muse Image can paint both layers as native 8:1 strips (measured 2026-11-03, with samples):
  see [generated-worlds-spec.md](generated-worlds-spec.md), which also covers new worlds from a child's wish and indoor worlds.
- **Ground and path.** §2a's textured ground and generated path were not ported: the real Garden keeps its current ground, and its stepping stones are mission spots,
  not a path. Whether the real game wants a wide path is a design decision for Dan.
- **Performance is unmeasured on a phone.** Two extra draw calls and about 15 MB of GPU texture (the far band at 4096 x 542 RGBA with mipmaps, the mid at 1831 x 370);
  the headless Metal run says nothing about a phone's GPU or fill rate. Rides with the real-phone pass (carousel §13.3).

**Commands.** Rebake the art: `python3 scripts/make-backdrops.py` (Pillow with WebP and numpy; not `python3 -I`). Unit tests: `npx vitest run tests/backdrop.test.ts`.
Real game: `node scripts/e2e-backdrop.mjs` (real GPU; screenshots go to `E2E_SHOTS`, default the OS temp folder).

## 8. The other worlds, and day and night (built 2026-11-04)

Dan (2026-11-04): "do them all and for outdoor do day and night based on the user's time". The Garden's backdrop (§7) is now one of ten: every outdoor world (Garden, Sky Meadow, Beach, Snow
Peak, Junkyard) has a **day** and a **night** backdrop, and the world is built in the one the player's own clock says (`src/lib/timeOfDay.ts`: 07:00 to 18:59 is day, the device's clock, so it
follows the player when they travel; a grown-up can pin Day or Night in the Grown-ups sheet, which also re-skins a world that is up). The Toy Room has none, as decided: indoors it is the same at
any hour. Labs take their theme's look (Lab 1 a Garden, Lab 5 a Sky); a generated level that names its own `mood` keeps it.

**The art** (`scripts/gen-backdrops.mjs`, Muse Image, 12 calls, 8 to 23 s each, about 17k input and 1.2k output tokens per image; raw outputs in `docs/mockups/generated-backdrops/worlds/` with the
verbatim prompts in `manifest.json`: the service takes no seed, so these are the art of record and a job whose file exists is skipped, never re-spent): a far band for each world and look
(8:1, 4480 x 560, baked to 4096 x 512 WebP, 26 to 123 KB) and ONE mid cut-out per world (painted on pure black and keyed off by `scripts/make-backdrops.py worlds`, the same flood fill as the
Garden's). The Garden's day band is the approved mockup's generated `far-day.webp`; its night band and mid are untouched (`make-backdrops.py` without arguments is the only thing that writes them).
Sky Meadow: a cloud meadow with tiny floating islands, a sun by day, a moon and stars by night, a bank of pink and white clouds with two islands as the mid. Beach: a turquoise sea, dunes and palm
silhouettes, a moon and sailboats with lit windows by night, dunes with palms and a hut as the mid. Snow Peak: soft white mountains and tiny pines, northern lights by night, hills with pines and an
igloo as the mid. Junkyard: scrap, tyres and cranes under a blue sky, the same silhouettes against a purple and orange sunset by night, piles of tyres, barrels, crates and a crane as the mid.
The mid is lit by the look: as painted by day, tinted cool (`0x9aa6e0`; the Garden's is the approved `0xbfc8ff`) by night.

**The look** (`runtime/worldLook.ts`, pure): each world was painted for ONE time of day (the Garden, the Junkyard and Snow Peak at night, Sky Meadow and the Beach by day) and keeps that painting,
and its own tuned light rig, at that time of day. For the other one it wears a **skin**: the sky, fog, ground, hills, sun or moon and extras that make a time of day (a green day Garden with no
fireflies, a starry Sky Meadow, a Beach under the moon with fireflies, a bright Snow Peak with no aurora, a Junkyard in daylight), plus the `mood` that makes `lighting.ts` swap to the day or night rig
(`moodRig`, which already existed for generated levels). The ground texture is tinted per look (`GROUND_LOOK` in `world.ts`: a lighter gravel in the day Junkyard, the cloud floor and the sand cooled
at night) and the sea is dark at night. **Lanterns are lit at night and dark by day** (`fx.setLights`, called once the world is final: a prop's brightness is read at the moment it is switched off).
A world is built in the look of the moment; the clock passing 19:00 under a child does not rebuild it (the next world load does), but pinning the other look while a world is up does, when the toy is free.
`backdropFor(theme, look)` picks the backdrop; everything about the layout (depths, scroll factors, the lane, the ground line, the live-camera maths of §7) is the Garden's.

**Checked:** 36 + 41 + 5 unit tests (the skins, the backdrop table, the art on disk with its dimensions and alpha, the lanterns; 22 mutants, all killed bar one that behaves identically), `scripts/e2e-daynight.mjs`
in real Chrome (every outdoor world in both looks, the light rig's fog, the lanterns, the art loaded and shown, day and night bands different, the Toy Room unchanged, pinning the other look while up,
Auto), screenshots reviewed (the first pass found the Sky floor and the Beach sea still bright at night and the Junkyard ground still dark by day: fixed). The older e2es now pin Night (the look they were
written for) so the clock cannot change what they see. **Not done:** the Junkyard's mid is a compact cluster rather than a strip (it sits in the middle of the lane; a mirror-extended or wider piece is
the next art), a near strip, a gradual dusk (the spec's continuous look is post-hackathon), and phone performance of ten more textures (one far and one mid are alive at a time, cached for the session).
