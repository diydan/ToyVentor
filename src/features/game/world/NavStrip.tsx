import type { ReactNode } from "react";
import "../../../nav-strip.css";

interface NavStripProps {
  /** Back to the main menu (Play / Build / Create a world). */
  onHome: () => void;
  /** The Map: places to play. */
  onMap: () => void;
  /**
   * Settings, as a ready-made button: the grown-ups' gear (GameCanvas owns its 1.2 s hold, the parent-controls dot and its labels). It sits in the third cell and takes the
   * strip's button look (`tv-navstrip-btn`), so there is one Settings in the drawer, not a button and a gear.
   */
  settings: ReactNode;
  disabled?: boolean;
}

/**
 * Home, Map and Settings: the three ways out of whatever the child is doing, as the first thing in the drawer under the Kip button. Big, labelled, always the same
 * three. Everything else in the drawer (Build, Workshop, Create, Pack, the world list, language, ...) stays below them.
 */
export function NavStrip({ onHome, onMap, settings, disabled = false }: NavStripProps) {
  return (
    <nav className="tv-navstrip" aria-label="Home, Map and Settings">
      <button type="button" className="tv-navstrip-btn" data-nav="home" disabled={disabled} onClick={onHome}>
        <span className="tv-navstrip-glyph" aria-hidden="true">
          🏠
        </span>
        <span>Home</span>
      </button>
      <button type="button" className="tv-navstrip-btn" data-nav="map" disabled={disabled} onClick={onMap}>
        <span className="tv-navstrip-glyph" aria-hidden="true">
          🗺️
        </span>
        <span>Map</span>
      </button>
      {settings}
    </nav>
  );
}
