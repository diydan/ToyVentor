# The landscape HUD: one button, one drawer, cards from the left (2026-11-04)

**Status: built and seen in the real game (844 x 390), unit-pinned; e2e scripts not updated yet (they assume the old top bar and a 390 x 844 screen).**

Dan, after the playtest: the screen is too crowded; items stand on Kip's walking path; the top header should go ("one button for everything, as minimal as possible"); mini pop-ups are always in the way in the middle
of the screen ("transparent and top left"); then: "a left slide panel for all cards, also instead of the bottom slide-up panel which takes too much screen; force landscape mode and have any UI needed on a left
slide-out menu". Decisions (his): a **hard rotate gate**, one Kip button with everything inside, **all** pop-ups including mission cards at the left, and I thin the props and clear the lane.

## 1. The game is landscape

- Upright on a touch screen (`(orientation: portrait) and (pointer: coarse)`) the game is covered by a full-screen "Turn your phone sideways" screen (`rotateGate.ts`, `.tv-rotate-gate`) that nothing can be touched through. A
  mouse never matches `pointer: coarse`, so a narrow desktop window is not gated. `?rotate=0` skips it (screenshots and automated runs, as `?title=0` skips the menu). The web cannot lock orientation (iOS Safari), so this is a gate, not a lock.
- On a wide screen the camera may come closer (`LAND_DD` = 7.6 in world.ts, 10 upright): about 10.7 units of the lane show (6.3 upright) and the toys keep finger-sized targets (the xylophone's bars: 37 px apart, 30 px at the old distance; the
  measured minimum is 36). Upright is no longer a supported layout, but its camera is unchanged.

## 2. Where everything is

| Where | What |
| --- | --- |
| Top-left | ONE round Kip button (the toy's icon, a gold dot when the Pack is unclaimed or the mic is on). Not on the title menu, the Map or while the toy sleeps. |
| Left edge, on tap | ONE drawer (about 420 px): Toy Box, Build, Workshop, Create, Pack, Worlds, Map, Story Moods and Mic, Words and Language, Character Card, Fullscreen, Grown-ups (hold 1.2 s), in two columns so it needs no scrolling at 390 px. Any button in it does its job and closes it. The old top bar, the "Garden" world pill and the big Map button are gone from the screen. |
| Left edge | Every card: all `.tv-sheet` (Build, Create, the editor, Mission, Garage, Songs, Rungs) and `.tv-modal` (Pack, the Character Card, Grown-ups), the world list, the song card, the garage chip, a found part. They were drawn for a phone about 390 px wide, which is what a left panel is in landscape. Bottom sheets no longer exist. |
| Top-left, beside the Kip button | The small pop-ups: the name toast, the hint chip, the world's name, the XP line: small, translucent, never mid-screen. A card open at the left moves them to its right edge. |
| Bottom-right | The abilities (Dash, Whirl, Glow pulse, Shove, Unscrew), under the right thumb. |
| Bottom-left | The tool-belt wand, under the left thumb. |

The CSS is `src/game-hud.css`, scoped under `.tv-host` so it wins over `index.css` and the stage's own CSS (`runtime/stageDom.ts`) by specificity; `!important` only where the world sets a position inline (the hint chip). The drawer is the old `.tv-dock`
re-skinned (its JSX is unchanged apart from the Kip button, the scrim, the Worlds entry and the always-open menu), so every handler, badge and gate is the one it always was. The Kip button hides while a card is open (`:has(.tv-sheet:not([hidden]), .tv-modal:not([hidden]))`:
two sheets stay mounted with `hidden`, so the `:not([hidden])` matters).

**Rule for new UI:** a card is a `.tv-sheet` or a `.tv-modal` (it becomes a left card by itself); a pop-up that is not a decision goes at the left beside the Kip button and is translucent; nothing new in the middle of the stage.

## 3. The lane is clear

Kip walks a lane about 2.4 units deep (`clampPathZ`, z -1.2 to 1.2). Every prop is now set back to at least z -2.8 when the world is built (`clearLane`, `CLEAR_Z` in world.ts): the Garden's lanterns, flower bed, bunny, basket and swing were at -1.2 to -1.7, the Junkyard's tires at -1.8,
the Toy Room's dog, cup and ball at -2. The hiding spots stay on the lane (they are what Kip walks up to: `near()` asks for Kip within 2 units of their depth). Kip steps back into the scene for the things behind the lane (`atDepth` in playthings.ts: in front of the
prop for the can, the carrot and the push, ON it for the blanket and the angel, eased in and out over 0.45 s, and put back even when cut short).

## 4. Fewer things

Every world was thinned: the Garden lost two lanterns, the picnic and the pumpkin patch (25 props to 16), the Sky one puffy cloud, the Junkyard a tire and a lantern, the Beach an umbrella and the second sandcastle, Snow Peak the second snowman, the Toy Room two floor lamps
and the second block tower (17 to 14). The picnic and the pumpkin patch still exist (the editor and the level kit can place them).

## 5. Not done

- The e2e scripts (all assume 390 x 844 and the old dock); `?rotate=0` and a landscape size are what they need, and the dock's buttons are now in the drawer.
- The hiding spots' big shapes (the Garden's dark bush and blue rock, Snow Peak's ice pillar) still stand on the lane.
- Another session has put a Home / Map / Settings strip at the top of the drawer, so Map and the grown-ups' gear now appear twice; the drawer then scrolls a little.
