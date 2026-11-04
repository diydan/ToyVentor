/**
 * The game's main menu (the title): a toy on the turntable, three ways in. Docs: docs/specs/carousel-modes-ladders-spec.md section 17, item 1.
 *
 * It was removed on 2026-11-02 with the rest of the old HTML stage (296de10) and the game booted straight into play. The scene behind it never went away: the world
 * still builds the factory turntable with its two meshing gears, still boots in its `title` / `showcase` state, and still has `startPlay(build)`. What was missing
 * was a menu to leave that state, and a boot that waits for it. This file is the pure part: what the entries are, and when the game opens on them.
 *
 * Pure: no React, no DOM, no storage.
 */

export type TitleChoice = "play" | "build" | "create";

export interface TitleEntry {
  id: TitleChoice;
  label: string;
  /** One short line for a screen reader and a tooltip. */
  hint: string;
  primary: boolean;
}

/** The three ways in, in the order they are shown. Play is the one a child is meant to press. */
export const TITLE_ENTRIES: readonly TitleEntry[] = [
  { id: "play", label: "Play", hint: "Go into the world with your toy", primary: true },
  { id: "build", label: "Build", hint: "Change your toy first, then play", primary: false },
  { id: "create", label: "Create a world", hint: "Make your own level", primary: false },
];

export const TITLE_TAGLINE = "Build it. Play it. Make it real.";

/**
 * Whether the game opens on its main menu. Yes, always, unless the address asks to go straight in: `?title=0` (also `false` or `off`). That is for automated
 * checks and for links that mean "put me in the world"; nobody types it. A deep link that opens a panel (Build, Create, the editor) leaves the menu by itself,
 * because the engine closes the title state when it opens one.
 */
export function shouldShowTitle(search: string | null | undefined): boolean {
  if (typeof search !== "string") return true;
  try {
    const v = new URLSearchParams(search).get("title");
    return !(v === "0" || v === "false" || v === "off");
  } catch {
    return true;
  }
}
