# ToyVentor

Helping the next generation grow into robotics through play: scan a toy,
build printable upgrades on it in the browser, then play with the upgraded
toy in AR and a mini game. Built for the Meta Global AI Developer Hackathon
(indie track), due Nov 4, 2026.

Docs: [index](docs/README.md) · [vision](docs/vision.md) ·
[spec](docs/spec.md) · [plan](docs/plan.md) ·
[wireframe](docs/wireframe.md) · [Snap](docs/snap.md) · [Pro](docs/pro.md) ·
[journal](docs/journal.md)

## Run it

```sh
npm install
npm run dev        # Vite + local Workers runtime (app + /api/*)
npm test           # shared checks/schema tests
npm run validate   # every file in sets/ passes the shared schema
npm run build      # typecheck + production build
npm run parts      # regenerate STL from parts/*.scad (needs OpenSCAD)
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
`parts/` parametric OpenSCAD · `sets/` content as data · `seed/` pre-made
fallback content · `generated/` build output (never edited by hand).

## Status (Oct 29, 2026)

Working end to end locally, redeploy pending: live SAM 3.1 scan (with
by-hand and seed fallbacks), Toybox, isometric virtual builder with
snapping/collisions/undo, STL downloads and GLB 3D/AR part previews,
fit-filtered Market, seeded daily Packs, Reveal with saved character
cards, a mini game driven by build stats, the hand-off into ToyVentor
World, and Create mode writing worlds through the Muse Spark route.
100 unit tests. Nothing printed yet, and the Reveal theme is a synth
placeholder until Mureka is wired.
See [the plan](docs/plan.md) and [the journal](docs/journal.md).
