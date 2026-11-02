import type { LadderState } from "../../../lib/learn";

export interface RungSheetProps {
  state: LadderState;
  onPick: (rung: number) => void;
  onClose: () => void;
}

const ages = (age: string): string => `Ages ${age.replace(" to ", "–")}`;

/**
 * Which level of a banded ladder to play. The glowing one fits the
 * player's age; finished levels have a tick; locked levels stay
 * disabled until the one below is done.
 */
export function RungSheet({ state, onPick, onClose }: RungSheetProps) {
  return (
    <section className="tv-sheet tv-sheet-rungs" role="region" aria-label={state.ladder.label}>
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Learn</span>
          <b className="tv-sh-title">{state.ladder.label}</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Back to Map
        </button>
      </div>
      <p className="tv-moves">Pick a level. The glowing one fits the age.</p>
      <ol className="tv-rung-list">
        {state.rungs.map((r) => (
          <li key={r.index}>
            <button
              type="button"
              className={
                r.index === state.next ? "tv-rung tv-rung-next" : "tv-rung"
              }
              disabled={r.locked}
              aria-label={`${r.title}, ${ages(r.age)}${r.done ? ", done" : r.locked ? ", locked" : ""}`}
              onClick={() => onPick(r.index)}
            >
              <span className="tv-rung-mark" aria-hidden="true">
                {r.locked ? "🔒" : r.done ? "✓" : "▶"}
              </span>
              <span className="tv-rung-text">
                <b>{r.title}</b>
                <small>{ages(r.age)}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
