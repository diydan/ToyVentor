// The showcase wishes (docs/specs/generated-worlds-spec.md section 0), shared by scripts/generate-world-art.ts (paints them) and scripts/bake-wish-worlds.ts (turns the stored briefs into the game's data module).
// No side effects: importing this file only gives the list.
import type { Base } from "../../shared/worldBrief";

/** The wishes of the taste check: four outdoor worlds (one per look family) and two indoor rooms. `base` is the base theme the world wears (it keeps the physics, props and missions). */
export const SHOWCASE: Array<{ id: string; wish: string; base: Base }> = [
  { id: "candy-forest", wish: "a candy forest at sunset", base: "garden" },
  { id: "jellyfish-ocean", wish: "a glowing jellyfish ocean at midnight", base: "beach" },
  { id: "rainbow-clouds", wish: "a rainbow cloud kingdom", base: "sky" },
  { id: "ice-cream-peak", wish: "an ice cream mountain with sprinkles", base: "snow" },
  { id: "pirate-room", wish: "my pirate bedroom", base: "room" },
  { id: "bakery-room", wish: "a cozy bakery kitchen", base: "room" },
];

