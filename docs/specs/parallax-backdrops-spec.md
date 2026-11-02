# Parallax image backdrops (draft, mockup-first)

> Status: **DRAFT — interactive mockup built, awaiting approval.**
> Nothing ships until the mockup is approved (decided 2026-11-02).
> Mockup: `/tmp/parallax-mockup/index.html` (session-local; rebuild
> from this spec). Recorded in carousel spec §17 item 2.

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

Back to front, painter's order preserved:

1. Sky gradient (`scene.background`, unchanged) — also the asset-
   load fallback together with today's `hills()`.
2. **Far plane** z −46, opaque panorama (sky detail + far
   skyline), `MeshBasicMaterial fog:false`, ≈170×62 units,
   texture ≤ 2048×1024. Replaces the z −44…−46 sphere row.
3. **Mid strip** z −22, alpha-cutout hills/trees band, ≈110×16,
   slight blue distance tint, `fog:false`, `depthWrite:false`.
   Replaces the z −22…−26 sphere row.
4. **Near strip** z −9, alpha-cutout foreground silhouettes,
   ≈88×9, `fog:false`. New layer; must never occlude the lane
   (art keeps its bottom edge below the ground line).
5. Everything from ground slab forward unchanged (props, spots,
   missions, player, blob shadow).

Parallax is free: the perspective camera produces the depth
differential (at cam x 3→41 the far plane crawls, lane props move
1:1). No per-frame backdrop code, no extra render pass, one WebGL
context. Planes are excluded from `linearize()` intensity scaling
(basic materials already are) and from shadow casting/receiving.

## 3. Art production

- One style prompt + shared seed/reference per theme set to hold
  the six themes together; far panoramas must fade to the theme's
  fog colour at left/right edges (tiling across the 45-unit lane).
- Mid/near strips need a **real alpha channel**. The mockup keys
  pure-black art by luminance at load — good enough to judge, not
  to ship (dark texels go semi-transparent). Production: generate,
  then background-remove into transparent PNGs, ≤ 2048 px wide.
- Budget: 6 themes × 3 layers ≈ 18 textures ≈ ≤ 12 MB total at
  2048px (WebP/PNG); lazy-load per world with the existing
  texture cache, dispose on world switch with `W.root`.

## 4. Mockup findings (2026-11-02, Garden only)

Built at real stage scale (FOV 36, camera formula, fog 46/150,
lane props at z 0) with two generated layers. Observed:

- Differential motion reads immediately on the camera slider;
  exploded view confirms the spare stack (3 planes + lane).
- Horizon seam is the main art risk: strip bottoms must tuck
  below the ground-slab horizon or a hard band shows. Placement
  (strip centre y, height) is per-theme tuning, not code.
- Luminance keying fringes dark teal; confirms §3 alpha rule.
- 60 fps in headless SwiftShader with 3 textured planes.

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
