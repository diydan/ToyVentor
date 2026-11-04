# ToyVentor

Helping the next generation grow into robotics through play: scan a toy,
build printable upgrades on it in the browser, then play with the upgraded
toy in AR and a mini game. Started as an entry to the Meta Global AI
Developer Hackathon (indie track), November 2026; now open source under
Apache-2.0.

Docs: [index](docs/README.md) · [vision](docs/product/vision.md) ·
[spec](docs/product/spec.md) · [plan](docs/product/plan.md) ·
[wireframe (archived)](docs/archive/wireframe.md) · [Snap](docs/parts/snap.md) · [Pro](docs/parts/pro.md) ·
[journal](docs/product/journal.md)

## Run it

```sh
npm install
npm run dev        # Vite + local Workers runtime (app + /api/*)
npm test           # shared checks/schema tests
npm run validate   # every file in sets/ passes the shared schema
npm run build      # typecheck + production build
npm run parts      # RETIRED: regenerate the old 16/32 mm STLs from parts/scad/ (needs OpenSCAD)
npm run bridge     # bridge verified PartSpec v2 parts from parts/partspec/ into sets/
```

Secrets for local dev go in `.dev.vars` (see `.dev.vars.example`). The
browser never sees them; only `worker/` reads them.

## Deploy

https://toyventor.com is live. The D1 ownership binding and custom domains for
the apex and www (workers.dev is kept as a fallback) are configured in
[wrangler.jsonc](wrangler.jsonc); `MODEL_API_KEY` is stored as a Worker secret,
never in source.

**A deploy is only as complete as git is.** `public/kip/` is served straight
from git with no build step, so a file that exists on a dev machine but is
gitignored works locally and 404s in production. Do not deploy the working
tree: export the commit (`git archive HEAD`) and build that. The full check is
in [docs/product/deploy-checklist.md](docs/product/deploy-checklist.md), and
the day-of steps are in [docs/product/qa.md](docs/product/qa.md) part 1.

```sh
npm run preflight   # local deploy-input checks
npm run deploy      # build + wrangler deploy
```

## Layout

`src/` React app · `worker/` API Worker · `shared/` pure types + checks ·
`parts/` parametric parts (`parts/partspec/` 12.5 mm TU Python generator;
`parts/scad/` is retired 16/32 mm OpenSCAD history, kept read-only) ·
`sets/` content as data · `seed/` pre-made fallback content ·
`generated/` build output (never edited by hand).

## Status (November 2026 — post-hackathon, open source)

The one-stage app is live at https://toyventor.com. SAM scan with seed
fallbacks, Toybox, the builder with snapping and undo, gated STL/GLB previews,
daily Packs, Reveal with saved cards, build-driven worlds and labs, parent time
gates, Create mode, the explorer trail map, the Garage, STEM XP and Maker
Ranks 1-6, the Kip and Workshop benches, and the end-of-level song with the
dance party.

Nothing is printed yet: `F1_printed_fit` and `F2_breakage` stay false until a
physical bench coupon is signed off. The Reveal entrance theme is still a
synth placeholder; the Mureka theme song is a separate route, off unless
`THEME_SONG=on`.

`npm test` carries the live test count; `parts/partspec/catalog.json` carries
the live part count. Do not copy either number into a document.

See [the plan](docs/product/plan.md) for what shipped each day, the
[journal](docs/product/journal.md) for the deep record, and
[the spec](docs/product/spec.md) for what the app does.

## License

Apache-2.0. See [LICENSE](LICENSE). Third-party notices live in
[THIRD_PARTY.md](THIRD_PARTY.md).
