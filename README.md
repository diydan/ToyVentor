# ToyVentor

Helping the next generation grow into robotics through play: scan a toy,
build printable upgrades on it in the browser, then play with the upgraded
toy in AR and a mini game. Built for the Meta Global AI Developer Hackathon
(indie track), due Nov 4, 2026.

Docs: [index](docs/README.md) · [vision](docs/product/vision.md) ·
[spec](docs/product/spec.md) · [plan](docs/product/plan.md) ·
[wireframe (archived)](docs/archive/wireframe.md) · [Snap](docs/parts/snap.md) · [Motion](docs/parts/motion.md) ·
[journal](docs/product/journal.md)

## Run it

```sh
npm install
npm run dev        # Vite + local Workers runtime (app + /api/*)
npm test           # shared checks/schema tests
npm run validate   # every file in sets/ passes the shared schema
npm run build      # typecheck + production build
npm run parts      # regenerate legacy STLs from parts/scad/*.scad (needs OpenSCAD)
npm run bridge     # bridge verified PartSpec v2 parts from parts/partspec/ into sets/
```

Secrets for local dev go in `.dev.vars` (see `.dev.vars.example`). The
browser never sees them; only `worker/` reads them.

## Deploy

https://toyventor.com is up on the previous build. The current build
(ToyVentor World and Create mode) goes up with the next deploy. The D1
ownership binding and custom domains for the apex and www (workers.dev
kept as a fallback) are configured in [wrangler.jsonc](wrangler.jsonc);
`MODEL_API_KEY` is stored as a Worker secret, never in source.

```sh
npm run preflight   # local deploy-input checks
npm run deploy      # build + wrangler deploy
```

## Layout

`src/` React app · `worker/` API Worker · `shared/` pure types + checks ·
`parts/` parametric parts (`parts/partspec/` 12.5 mm TU Python generator +
`parts/scad/` legacy OpenSCAD) · `sets/` content as data · `seed/` pre-made
fallback content · `generated/` build output (never edited by hand).

## Status (Oct 30, 2026)

One-stage app working locally, redeploy pending: SAM scan with seed fallbacks,
Toybox, builder with snapping and undo, gated STL/GLB previews, daily Packs,
Reveal with saved cards, build-driven worlds and labs, parent time gates, and
Create mode. 165 tests across 24 files. Nothing printed yet; the Reveal theme
is still a synth placeholder.
See [the plan](docs/product/plan.md) and [the journal](docs/product/journal.md).
