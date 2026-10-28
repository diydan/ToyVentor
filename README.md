# ToyVentor

Scan a toy, build printable upgrades on it in the browser, and play with the
upgraded toy in AR and a mini game. Built for the Meta Global AI Developer
Hackathon (indie track), due Nov 4, 2026.

Docs: [spec](docs/spec.md) · [plan](docs/plan.md) ·
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

Config validates today (`npx wrangler deploy --dry-run` passes). Going
live still needs, in order:

```sh
npx wrangler login
npx wrangler secret put MODEL_API_KEY   # same value as .dev.vars
npm run deploy                          # build + wrangler deploy
```

Then attach the toyventor.com route in the Cloudflare dashboard.
D1/KV bindings are commented placeholders in
[wrangler.jsonc](wrangler.jsonc) until the ownership backend lands.

## Layout

`src/` React app · `worker/` API Worker · `shared/` pure types + checks ·
`parts/` parametric OpenSCAD · `sets/` content as data · `seed/` pre-made
fallback content · `generated/` build output (never edited by hand).

## Status (Oct 28, 2026)

Working end to end locally: live SAM 3.1 scan (with by-hand and seed
fallbacks), Toybox, isometric virtual builder with snapping/collisions/
undo, STL downloads and GLB 3D/AR part previews, fit-filtered Market,
seeded daily Packs, Reveal with saved character cards, and a mini game
driven by build stats. 55 unit tests. Not deployed yet, nothing printed
yet, and the Reveal theme is a synth placeholder until Mureka is wired.
See [the plan](docs/plan.md) and [the journal](docs/journal.md).
