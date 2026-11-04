# Third-party notices

## Meta SAM parser

- Package: `@meta-sam/parser` 0.1.0 (exact version pinned in `package.json`)
- Used for: decoding SAM 3.1 mask payloads in the API Worker only
  (`worker/meta.ts`). It is intentionally not imported by browser code.
- License: SAM License — full text in [`licenses/SAM-LICENSE.txt`](licenses/SAM-LICENSE.txt)
- Acknowledgement: ToyVentor's scan feature uses Meta's SAM 3.1 model
  and Meta's official SAM parser.

The box-only scan fallback does not depend on this package. If the SAM
License terms change in a way ToyVentor cannot accept, remove the parser
import from the Worker and retain the local box parser in `shared/sam.ts`.

## Three.js & Mixamo Sample Animation Clips (Kip 3D Demo Viewer)

- Package: `three` (MIT License) — bundled into `public/kip/vendor/three-kip.js` via `scripts/build-kip.ts`.
- Sample skeletal animation clips (`public/kip/mixamo/Xbot.glb`, `public/kip/mixamo/Michelle.glb`): bare bone hierarchies and keyframe curves extracted from [Xbot.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Xbot.glb) and [Michelle.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Michelle.glb) in `mrdoob/three.js` (`examples/models/gltf/`), whose repository [LICENSE](https://github.com/mrdoob/three.js/blob/dev/LICENSE) is MIT (verified 2026-11-04), with all third-party character meshes, materials, and textures stripped; retargeted at runtime onto Kip's clean-room parametric ToyVentor `12.5 mm` TU rig (`parts/kip/kip.scad`).

## Mixamo dance, reaction and movement animations (Kip bench, dance party)

- Source (single link, fetch it yourself): [Mixamo](https://www.mixamo.com/) (own Adobe account, "without skin"). See `public/kip/mixamo/baked/README.md`:
  drop the FBX files listed in `scripts/mixamo-clips.json` (plus `scripts/mixamo-loco-clips.json` for idle/walk/run) into git-ignored `.local/mixamo/`,
  then run `node scripts/mixamo-bake.mjs`.
- What ships: nothing Mixamo-derived. `public/kip/mixamo/baked/*.json` is git-ignored local-only joint data (Kip's 14 joint rotations and the hips
  position at 30 fps, retargeted by `scripts/mixamo-bake.mjs`). **No raw Mixamo file is in the repository or served** (a test fails if an `.fbx` is ever tracked).
  Without the baked files the app runs on its procedural clips and the three.js sample clips below; Mixamo moves load when present and are skipped when absent.
- Terms: Mixamo's terms as read from Adobe's published FAQ (a community copy dated 2022, not the current terms of service: recheck before release)
  allow use in personal and commercial projects including games, with no attribution required, but not redistributing the raw files as a product and
  **not using them as machine-learning training data**. These clips are therefore kept out of every AI training set (the Forge AI plans, the Glimmer-only
  data rule in `docs/specs/forge-ai-spec.md`) and out of any dataset exported from this repository.
- The earlier sample clips (Xbot, Michelle) are the three.js ones above; the hand-built clips in `kip-clips.js` are original work.

## Mureka-generated starter songs (Kip bench, dance party)

- Source: instrumental songs generated with the Mureka API (`https://api.mureka.ai`, model `mureka-9`) on the project owner's own paid API account on
  2026-11-03, one request per mood card, each from a fixed prompt built only from the song maker's closed lists (a mood, a tempo, up to two instruments;
  "Instrumental only: no vocals, no lyrics, no spoken words"; `shared/songCards.ts`). The prompt, model, task id and date of every song are recorded in
  `public/kip/songs/index.json`, and a test checks each prompt is exactly the one the cards make.
- What ships: `public/kip/songs/`, about 64-second excerpts (a whole number of bars from the middle of each song, cut on its beat grid) encoded as MP3 at
  96 kb/s (every browser decodes MP3, including the open-source Chromium builds that leave AAC out) and levelled in loudness, labelled "made by AI" in the app. The full-length originals stay in the git-ignored `.local/songs/` on the owner's machine
  and are never committed.
- Terms: Mureka's published FAQ says content generated through paid API calls carries full commercial usage rights (read in `docs/specs/mureka-api-reference.md`),
  and the owner confirmed the licence from his own account (`docs/specs/dance-party-spec.md` D9). Mureka also appends an audio watermark to the END of generated
  files (its FAQ and changelog); the excerpts are cut from the middle of each song and do not include the end of the file. Recheck Mureka's current terms,
  including this watermark, before release.
- Tools: the beat of each song is measured by our own code (`shared/songAnalyze.ts`); cutting and encoding use FFmpeg as a command-line tool on the developer's
  machine (`scripts/song-ingest.ts`); FFmpeg is not shipped.
- The API key lives only in `.dev.vars` (git-ignored) and is never printed or written anywhere (`scripts/mureka-songs.ts`).

## Rubik and Figtree typefaces (self-hosted)

- Files: `public/fonts/rubik-latin.woff2`, `public/fonts/rubik-latin-ext.woff2`,
  `public/fonts/figtree-latin.woff2`, `public/fonts/figtree-latin-ext.woff2`
- License: SIL Open Font License 1.1 — full texts in
  [`licenses/Rubik-OFL.txt`](licenses/Rubik-OFL.txt) and
  [`licenses/Figtree-OFL.txt`](licenses/Figtree-OFL.txt)
- Copyright: Rubik — The Rubik Project Authors; Figtree — The Figtree Project Authors
- Used for: the display and body typefaces of the app and of ToyVentor World.

The `@font-face` rules are in `src/index.css` and `game/build25.py`. The
webfonts are served from this origin on purpose: the app makes no request to a
third-party font host, so a child's browser never talks to one and the demo
still renders its type with no internet connection.

## Google Model Viewer (3D / AR part preview)

- Package: `@google/model-viewer` 4.4.0 (exact version pinned in `package.json`)
- Used for: the 3D and AR preview of one part's real GLB in the builder and
  the AR try-on (`src/features/ar/PartPreview.tsx`). Loaded on demand, so the
  rest of the app does not pay for it.
- License: Apache License 2.0.

This is the last Google-authored artifact in the shipped bundle. It is kept
because it is what puts a part into the room through the phone camera, and
that beat is part of the demo. Replacing it means owning the WebXR / Scene
Viewer launch path directly; see the review notes before the release.

The app makes no request to a Google host at runtime. The fonts are
self-hosted, and the GLB files carry no Draco or Basis compression, so the
viewer's optional decoder downloads are never fetched.

## Browser runtime libraries (React, lit)

- Packages: `react` (^19.3.1) and `react-dom` (^19.3.0) — the app UI.
  License: MIT (per each package's own `package.json`).
- Transitive: `lit` (BSD-3-Clause, per its `package.json`) arrives through
  `@google/model-viewer` above and ships in the on-demand preview bundle.
- Build and test tooling (`vite`, `vitest`, `tsx`, `typescript`, `wrangler`)
  is MIT except `typescript` (Apache-2.0) and `wrangler` (MIT OR Apache-2.0).
  It runs on the developer's machine and in CI; none of it ships to the
  browser except through the compiled bundle.

## Python dependencies (PartSpec generator)

- File: `parts/partspec/requirements.txt`. These run the part generator and
  its checks on the developer's machine; they never ship to users.
- `manifold3d` (Apache-2.0, per its trove classifier), `trimesh` (MIT),
  `jsonschema` (MIT), `numpy` and `scipy` (BSD-3-Clause), `pygltflib` (MIT).

## Muse-generated artwork (backdrops, world looks)

- Source: backdrops and world-look art made with Muse Image
  (`muse-image-1.0`) on the project owner's own account, from code-built
  prompts (the child's words never reach the image model; see
  `docs/specs/generated-worlds-spec.md`). The samples in
  `docs/mockups/generated-backdrops/` are measurement evidence, not shipped
  art. The showcase worlds playable in Create mode are labelled AI-made in
  the app.
- Terms: Meta's hosted-model terms apply (adults only; see
  `docs/decisions/0008-meta-models-and-under-18-users.md`). Recheck the
  current image terms before release, as with the songs above.
