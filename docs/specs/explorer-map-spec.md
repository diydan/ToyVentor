# Explorer trail map — spec

Nov 2, 2026. A branching, old-school overworld map **beside** the Map
carousel, not instead of it. The carousel stays the browse-everything
view (carousel-modes-ladders-spec §7); the trail map is the explorer
view of the same places.

## Settled choices

- **Beside the carousel.** Dock `⋯` → `Map` opens the carousel as
  today. Its `Trail map` button swaps to the trail view; `Cards`
  swaps back. Both views derive from one `buildMapCards` list, so
  pips, progress, and the suggested place always agree.
- **Gentle fog.** Places the child has been (home, the current world,
  any progress, any trail-map visit) draw in colour with gold roads.
  One road away draws as a silhouette with a dotted road. The rest
  sits under clouds. Fog is drawing only: **nothing is locked**, and
  tapping a clouded node travels there. This keeps the carousel
  "nothing locked" rule and the town "go anywhere" pillar while the
  map still only *shows* what has been done.
- **Structured areas plus a generated frontier.** Six authored
  districts (world + its lab building + its ladder trail) sit on the
  town ring around Toy Room home. Off six branch ends, seeded
  frontier nodes are generated two deep. Each frontier node carries
  a level-kit seed code and plays through the existing `playSeed`
  path, so new levels appear on the map without new engine code.

## How it is built

- `src/lib/explorerMap.ts` — pure graph derivation: authored
  positions/roads/districts, deterministic frontier generation
  (octant walk with hashed bends, collision-free), fog states, and
  `explorerNeighbor` for arrow-key travel. Unit-tested in
  `tests/explorer-map.test.ts`, including a cross-check that every
  frontier seed code round-trips through `composeLevel`.
- `src/features/game/world/ExplorerMap.tsx` — scrollable SVG roads +
  district areas under big round node buttons; arrow keys walk roads;
  Learn nodes reuse `RungSheet` exactly like the carousel.
- Visits persist as `explorerVisited` in `progression:v1`
  (validated in normalize, union-merged, wiped by XP reset).
  Visiting a frontier node reveals the next generated node beyond it,
  so the frontier opens one hop at a time. A frontier node counts as
  explored on entry; its hidden parts still feed the normal found
  set while played.

## Not in this slice

- No hard gates, secret-exit locks, or vehicle gates on roads.
  Vehicle perks stay soft (connected-town slice 1).
- Frontier depth is a fixed 2 per branch. Unbounded growth, if
  wanted, is a `frontierDepth` change plus a visited-depth rule.
- The in-world street ring is unchanged; this map is a sheet over
  the stage, like the carousel.
