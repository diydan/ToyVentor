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
  frontier nodes are generated. Each frontier node carries
  a level-kit seed code and plays through the existing `playSeed`
  path, so new levels appear on the map without new engine code.
- **The frontier grows as it is walked** (decided Nov 3). A branch
  always shows two generated paths beyond the furthest one the child
  has walked: the next (a silhouette) and one more under cloud.
  Walking path 2 shows paths 3 and 4. A branch stops at
  `FRONTIER_MAX_DEPTH` (12 paths, 72 levels over six branches); that
  is a safety valve on how much the browser must draw, not a design
  limit, and it should be revisited on a real phone. Branches wind
  but keep heading outward (a step may bend one octant either side of
  the branch's own heading), and a step that would cross a road, land
  on a place, or crowd one ends the chain.
- **Difficulty rises with depth** (decided Nov 3). A generated path's
  tier is set by how far out it is: paths 1-3 are Easy (tier 1,
  byte-identical to before, so every early seed code replays the same
  level), 4-7 Tricky (tier 2), 8+ Hard (tier 3). A tiered level has a
  third free station and every station starts at that tier (the same
  1-3 the mission panel offers); the five hiding spots never change.
  Age caps it: bands 2-3 and 3-4 are never above Easy, 5-6 never above
  Tricky, an unset age never above Tricky. The plate says which it is
  ("Surprise level · Tricky").
- **Secret exits** (decided Nov 3). Finding every hidden part in a
  world (its card complete) opens a secret side route off it: Garden,
  Beach, Junkyard, Snow Peak and Sky Meadow (not Toy Room). It is one
  violet star dot a short road away, a Bonus level in a dusk mood at
  the hardest tier the age is offered, with its own seed. Until the
  world is complete it is not on the map at all (no cloud, no hint);
  sandbox shows all five. When one opens, the map says so once and it
  draws in like anything else that is new. The trigger is a default
  chosen for the Mario "second exit" feel (find everything, get a
  secret), not a settled design: it is a one-line rule in
  `buildExplorerGraph` to change.
- **What is new draws itself in.** The map remembers what it has shown
  (`explorerSeen`). On the next open only what is new animates: the
  clouds part around it, new roads draw out from the end that was
  already in colour (dotted roads fade in), and the new places pop in
  one after another, nearest the toy first. The camera frames the toy
  and the new places together when they fit. The first open (no
  record yet, including a player from before this existed) animates
  nothing and just records; the open after a reveal replays nothing.
  `prefers-reduced-motion` shows the finished map at once.
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
  a tick) for the learning ladders; a world keeps its own colour and
  gains a gold ring and a tick when cleared (two worlds are blue, and
  blue also means cleared on the plain dots); red `?` dot for a
  generated path; violet star dot with sparkles for a secret exit;
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
  (every chain is laid out once, a layer at a time in a fixed branch
  order, so **a place that exists never moves when any branch grows**),
  fog states, `newlyShown` and `seenEntries` (the reveal diff),
  `explorerNeighbor` (arrow-key travel), `explorerRoute` (the walk the
  toy hops along), `defaultMapView`, `frontierTier` / `maxTierForAge`
  (difficulty by depth and age) and `SECRET_EXITS` (fixed positions,
  always reserved in the frontier layout, locked or not, so nothing
  moves when one opens). Unit-tested in
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
- Visits persist as `explorerVisited` and what the map has shown as
  `explorerSeen` in `progression:v1` (both validated in normalize,
  union-merged, wiped by XP reset). `explorerSeen` entries are `id`
  for a silhouette and `id#` for a place seen in full colour, so a
  road that turns from dotted to solid draws in.
  Visiting a frontier node reveals the next generated node beyond it,
  so the frontier opens one hop at a time. A frontier node counts as
  explored on entry; its hidden parts still feed the normal found
  set while played. The toy starts on the world the child is in, or on
  the last place walked to when the child is in a generated level.
- Cost at depth, measured on a desktop: scrolling stays at 60 fps from
  27 to 117 places (a 2,256 x 2,136 world up to 6,576 x 6,456), the Map
  opens in under 300 ms, scenery is placed through a bucket grid (about
  50 ms for the biggest world) and the cloud bank is held to about
  1,200 puffs by making them larger, not more numerous.
- Difficulty plumbing: `composeLevel({ tier })` in `levelKit.ts` (tier 1
  or absent is byte-identical, tested over 600 seeds), `playSeed(code,
  theme, { tier, mood })` through `engine.ts` and `world.ts`, and
  `buildMissions` starting a seeded level's stations at the tier it asks
  for unless the child already chose one. `GameCanvas` passes the age
  band to the graph and the node's tier and mood to `playSeed`.
- `npm run e2e:trail` (`scripts/e2e-trail.mjs`) drives it in headless
  Chrome: default view by age and the swap between views, full screen
  over the dock, fog, the toy's hop and the plate, arrow keys, the
  rung sheet over the map, the busy and ready frontier paths, a
  branch growing when it is walked, difficulty by depth (a 4th path is
  Tricky and its stations start at tier 2), a secret exit (hidden,
  opens when the Garden's parts are found, notice and animation, plays
  at tier 3), the reveal animation (first open
  quiet, the next open animates, the one after quiet), and layout (tap size, alignment, no overlap, the toy in view).

## Not in this slice

- No hard gates, secret-exit locks, or vehicle gates on roads.
  Vehicle perks stay soft (connected-town slice 1).
- No secret exit off Toy Room (its roads are crowded), and none off a
  lab or ladder. A secret exit has no reward beyond the level itself.
- Tier 2 and 3 only add a station and raise its starting tier; the
  level kit has no other difficulty knob (five spots is a shared rule).
- The overworld is drawn in SVG with stand-in art (shapes and a glyph
  per place). Hand-made art would replace `ExplorerWorldArt` and
  `ExplorerNodeArt` without touching the graph or the e2e.
- The in-world street ring is unchanged; this map is a screen over
  the stage, like the carousel.
