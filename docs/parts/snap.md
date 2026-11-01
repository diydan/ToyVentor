# ToyVentor Snap

Snap is the younger-child line: snap-fit, tool-free parts with one game stat
and AR/mini-game behavior. It is labeled **ages 3+** with small-parts warnings;
the app’s broader builder framing remains 8–16, with Snap as the younger entry
point.

The normative geometry spec is the generated copy in
[partspec/specs/02_snap_spec.md](partspec/specs/02_snap_spec.md), assembled
from `parts/partspec/snap_v2.md`. This file is the product summary, not a
second normative copy.

## Connection

Snap uses studs up and sockets below, with tube-grip socket grids at least 2×2
where grip matters. Facing direction uses locks or reliefs; round parts may
intentionally rotate. Snap studs do not mate directly with Pro bores in the
validator; use the adapter where the catalog provides one.

## Part types

Snap supports bricks and plates, domes, slopes, tiles, capsules and shields,
animals and critters, wardrobe and costume add-ons, vehicles and racers, and
small robots.

## Shared character modules

Fixed-pose Snap figures share named head, torso, limb, tail, accessory, and
end-effector roles with Motion’s articulated figures. Every claimed join needs
typed connectors; visual resemblance alone is not compatibility.

## Design rules

- Bricks use the full square foot and socket cavity; plates double grip when
  stacked; 2×4 stays minimum under motor load.
- Domes use a round foot on the standard footprint; balls and heads use the
  matching socket.
- Tiles are socket-only decoration; slope angles avoid supports.
- Scales stay readable at arm’s length; keep square Small 2×2 parts short or
  give them a larger foot.


## 3D print

Parts ship with an STL, a settings card, and a visible safety warning. One
size is offered: Small. Large is parked; its parts stay verified but are not
exported, printed, or extended until it returns. Printed-fit and breakage
checks stay pending until a real print and lab test.

## Game and AR

Game stats use tuned app-set values; AR uses real footprints and foot
placement. Failures name the cause and offer age-appropriate recovery.

## Content

Catalog rows carry one stat, behavior intent, discovery tags, build parameters,
and engineering notes. New families, stats, or interfaces are standards
changes, not labels. Catalog IDs are permanent once referenced by builds,
sets, STLs, or saved app state.


## Done when

A Snap part is done when it is verified by the generator, mates through typed
connectors, reaches the app exactly once where in scope, prints with its mates
where claimed, and carries correct age grading and warnings. Pending physical
checks do not count against verification, but they must not be presented as
passed.

