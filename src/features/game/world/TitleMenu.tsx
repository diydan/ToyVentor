import { useEffect, useRef } from "react";
import { TITLE_ENTRIES, TITLE_TAGLINE, type TitleChoice } from "./titleEntries";

interface TitleMenuProps {
  /** The name of the toy on the turntable, shown under the logo. */
  toyName?: string;
  /** False until the world has built its scene: the entries wait, because there is nothing to start yet. */
  ready: boolean;
  onChoose: (choice: TitleChoice) => void;
}

/**
 * The main menu, laid over the live stage (docs/specs/carousel-modes-ladders-spec.md section 17, item 1). The toy stands on the turntable in the middle of the
 * stage, the gears turn under it (both are the world's own showcase scene), the name and the three entries sit above and below. The overlay lets touches through
 * everywhere except the buttons.
 */
export function TitleMenu({ toyName, ready, onChoose }: TitleMenuProps) {
  const playRef = useRef<HTMLButtonElement>(null);
  // the Play button takes focus as soon as it can be pressed, so a keyboard or a switch device is one key from the world
  useEffect(() => {
    if (ready) playRef.current?.focus({ preventScroll: true });
  }, [ready]);

  return (
    <section className="tv-title" aria-label="ToyVentor main menu">
      <header className="tv-title-head">
        <h1 className="tv-title-logo">ToyVentor</h1>
        <p className="tv-title-tag">{TITLE_TAGLINE}</p>
        {toyName ? <p className="tv-title-toy">{toyName}</p> : null}
      </header>
      <div className="tv-title-btns" role="group" aria-label="Choose what to do">
        {TITLE_ENTRIES.map((e) => (
          <button
            key={e.id}
            ref={e.id === "play" ? playRef : undefined}
            type="button"
            className={e.primary ? "tv-ctl tv-ctl-primary tv-title-btn" : "tv-ctl tv-title-btn"}
            disabled={!ready}
            title={e.hint}
            aria-label={`${e.label}: ${e.hint}`}
            data-title-entry={e.id}
            onClick={() => onChoose(e.id)}
          >
            {ready || !e.primary ? e.label : "Loading…"}
          </button>
        ))}
      </div>
    </section>
  );
}
