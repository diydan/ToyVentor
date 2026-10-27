# ToyForge

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

## Layout

`src/` React app · `worker/` API Worker · `shared/` pure types + checks ·
`parts/` parametric OpenSCAD · `sets/` content as data · `seed/` pre-made
fallback content · `generated/` build output (never edited by hand).

## Status (Oct 27, 2026)

Foundation only: app shell, Toybox + Scan screens running on the seed toy,
shared schemas/checks with tests, and the docs above. Builder, AR, game,
STL export, and Reveal land per [the plan](docs/plan.md). No physical part
has been printed yet.
