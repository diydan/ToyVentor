# Explorer trail map — spec

Nov 2–3, 2026. A branching, old-school overworld map **beside** the Map
carousel, not instead of it. The carousel stays the browse-everything
view (carousel-modes-ladders-spec §7); the trail map is the explorer
view of the same places. The inspiration is the Super Mario World
overworld: sea and islands, winding roads, level dots and castles, a
character that hops between them, and a map that only shows what you
have found.

## Settled choices

- **Which view opens first depends on age** (decided Nov 3).
  The carousel is the default for ages 3–8 and for an unset age; the
  trail map is the default from "8 plus". Each is one tap from the
  other (`Trail map` on the carousel, `Cards` on the trail map), and
  the Map always opens on the age's default, not on the last view
  used. Age bands are 2–3, 3–4, 5–6, 7–9, 10–12, 13+ and cannot split
  at 8, so **band 3 (7–9) counts as "8 plus"**
  (`TRAIL_DEFAULT_FROM_BAND = 3`, `defaultMapView`). Both views derive
  from one `buildMapCards` list, so pips, progress, and the suggested
  place always agree.
- **Always full screen.** The trail map covers the whole screen, the
  dock included (`position: fixed`, above the dock, below the sleep
  curtain). It carries its own small HUD: a name plate, `Cards`,
  `Home`, and one big button. The rung sheet opens over it.
- **Gentle fog.** Places the child has been (home, the current world,
  any progress, any trail-map visit) are in full colour with solid
  dirt roads. One road away shows its marker with a dotted road. The
  rest sits under a cloud bank, each hidden place a small `?` cloud.
  Fog is drawing only: **nothing is locked**, and a clouded place can
  be walked to. This keeps the carousel "nothing locked" rule and the
  town "go anywhere" pillar while the map still only *shows* what has
  been done. Sandbox (`sandboxUnlockAll`) clears the fog.
- **Structured areas plus a generated frontier.** Six authored
  districts (world + its lab building + its ladder trail) sit on the
  town ring around Toy Room home. Off six branch ends, seeded
  frontier nodes are generated two deep. Each frontier node carries
  a level-kit seed code and plays through the existing `playSeed`
  path, so new levels appear on the map without new engine code.
- **Two-step travel, like a console map.** The toy stands on a place.
  Tap another place and the toy hops there along the roads (the plate
  at the top names it); tap the place the toy is standing on, or the
  big button (`Go!` for a world, `Play` for a lab or ladder, `Open`
  for the grown-up age prompt), to go in. Arrow keys walk the roads
  like a d-pad. A frontier `Go!` that cannot start (the player is
  busy, in a showcase, or in the editor) keeps the map open with a
  notice and records no visit.

## Overworld presentation

No text on the map itself: places are pictures, and the name plate at
the top is the only label, so labels never collide with roads or
neighbours.

- **Sea and land.** A blue sea with drifting waves; the land is the
  union of a disc around every place and a thick stroke along every
  road, drawn three times (foam, sand ring, meadow) for a coastline.
  Each region tints the meadow around its places: garden grass, beach
  sand, junkyard dirt, snow, sky, and a warm wood for Toy Room.
- **Scenery** is a deterministic scatter on the land, never on a place
  or a road, picked by the nearest place's theme: trees and flowers,
  palms, barrels and tyres, snowy pines and peaks, cloud puffs, toy
  blocks, and the little hills with eyes.
- **Roads** wind a little (a gentle curve fixed by the two place ids,
  so drawing and hopping agree). Walked roads are solid dirt with a
  dark edge; a road to a silhouette is dotted footprints.
- **Markers.** Level dot (yellow until cleared, blue once cleared, with
  a tick), red `?` dot for a generated path (the "secret exit"),
  castle for each lab (flag in the world's colour), house for Toy Room,
  a sign for the grown-up age prompt, a `?` cloud for a hidden place.
  The suggested place gets a bouncing arrow.
- **The toy** is the equipped toy's face on a round token with a wooden
  rim, with a shadow, idling with a small bob and hopping between
  places. `prefers-reduced-motion` turns the hop, waves, drift and
  bounce off and moves the toy straight to its place.
- **Same product as the rest of the app.** The map is bright daylight
  on purpose, but its chrome is the app's own: the name plate is the
  navy-glass sheet header (gold kicker over a white title), `Cards`
  and `Home` are `.tv-ctl` buttons in Rubik, `Go!` is the app's mint,
  and the art's outlines are the UI's navy (`#1e2a6b`), not brown.
  The sea uses the app's sky blues. The app's palette is a "dusk
  navy" (`--night-rgb`, `--surface-rgb`, `--surface-2/3`, `--line`)
  defined once in `index.css`; every translucent fill derives from
  those two RGB triplets, so lifting or darkening the app is a token
  change, not a hunt through the stylesheet.
- **Tap targets** are 64px (72px with padding) and HUD buttons at
  least 48px tall, above the 48px the 7–9 band needs (play-design age
  presets). The trail map is built for readers (a text plate, no
  read-aloud); a younger child who switches to it still gets targets
  that clear the 5–6 floor of 56px, but under-5s are meant to use the
  carousel.

## How it is built

- `src/lib/explorerMap.ts` — pure graph derivation: authored
  positions/roads/districts, deterministic frontier generation
  (octant walk with hashed bends, collision-free), fog states,
  `explorerNeighbor` (arrow-key travel), `explorerRoute` (the walk the
  toy hops along), and `defaultMapView`. Unit-tested in
  `tests/explorer-map.test.ts` (including a cross-check that every
  frontier seed code round-trips through `composeLevel`) and
  `tests/explorer-art.test.ts`.
- `src/lib/explorerArt.ts` — pure geometry for the look: the world
  frame (120 px per grid unit), winding road curves, the scenery
  scatter, and the fog puffs. Tests assert determinism, that no
  winding road runs under a place it skips, and that scenery never
  sits on a place or a road, in every age band.
- `ExplorerWorldArt.tsx` (sea, land, scenery, cloud bank; memoised, it
  does not change with progress), `ExplorerNodeArt.tsx` (the markers),
  `ExplorerMap.tsx` (state, HUD, the toy's hop, fog mask, keys, mouse
  drag; touch scrolls natively). `GameCanvas` opens the Map through
  `openMap`, which picks the view from the saved age.
- Visits persist as `explorerVisited` in `progression:v1`
  (validated in normalize, union-merged, wiped by XP reset).
  Visiting a frontier node reveals the next generated node beyond it,
  so the frontier opens one hop at a time. A frontier node counts as
  explored on entry; its hidden parts still feed the normal found
  set while played. The toy starts on the world the child is in, or on
  the last place walked to when the child is in a generated level.
- `npm run e2e:trail` (`scripts/e2e-trail.mjs`) drives it in headless
  Chrome: default view by age and the swap between views, full screen
  over the dock, fog, the toy's hop and the plate, arrow keys, the
  rung sheet over the map, the busy and ready frontier paths, and
  layout (tap size, alignment, no overlap, the toy in view).

## Not in this slice

- No hard gates, secret-exit locks, or vehicle gates on roads.
  Vehicle perks stay soft (connected-town slice 1).
- Frontier depth is a fixed 2 per branch. Unbounded growth, if
  wanted, is a `frontierDepth` change plus a visited-depth rule.
- The overworld is drawn in SVG with stand-in art (shapes and a glyph
  per place). Hand-made art would replace `ExplorerWorldArt` and
  `ExplorerNodeArt` without touching the graph or the e2e.
- The in-world street ring is unchanged; this map is a screen over
  the stage, like the carousel.
