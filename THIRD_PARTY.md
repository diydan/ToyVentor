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
- Sample skeletal animation clips (`public/kip/mixamo/Xbot.glb`, `public/kip/mixamo/Michelle.glb`): bare bone hierarchies and keyframe curves extracted from `mrdoob/three.js` (`examples/models/gltf/`, MIT repository distribution), with all third-party character meshes, materials, and textures stripped; retargeted at runtime onto Kip's clean-room parametric ToyVentor `12.5 mm` TU rig (`parts/kip/kip.scad`).
