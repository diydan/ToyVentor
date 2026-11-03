import type { DropKind, GarageStatus } from "../../../lib/garage";

const KIND_LABEL: Record<DropKind, string> = {
  newPart: "New part",
  idea: "Idea",
  remix: "Remix",
};

export interface GarageSheetProps {
  status: GarageStatus;
  /** Begin this drop: closes the sheet, opens Build, and starts checking the goal. */
  onStart: () => void;
  /** Just open Build with no goal. */
  onFreeBuild: () => void;
  onClose: () => void;
}

/**
 * The Garage (garage-weekend-spec.md). Always open: Free build works every day.
 * The drop card is the weekend's new part, idea or remix, written for the
 * child's age. A bottom sheet, like the rung sheet, over the carousel or the
 * trail map.
 */
export function GarageSheet({ status, onStart, onFreeBuild, onClose }: GarageSheetProps) {
  const { variant, drop, done, isWeekend } = status;
  const tag = isWeekend
    ? done
      ? "Done this weekend ★"
      : "New this weekend"
    : done
      ? "Last weekend: done ★"
      : "Last weekend's drop";
  return (
    <section className="tv-sheet tv-sheet-garage" role="region" aria-label="Garage">
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Garage</span>
          <b className="tv-sh-title">Build something new</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Close
        </button>
      </div>

      <div className={`tv-garage-drop${isWeekend && !done ? " tv-garage-drop-hot" : ""}`}>
        <div className="tv-garage-meta">
          <span className="tv-garage-tag">{tag}</span>
          <span className="tv-garage-kind">{KIND_LABEL[drop.kind]}</span>
        </div>
        <b className="tv-garage-title">{variant.title}</b>
        <p className="tv-garage-brief">{variant.brief}</p>
        <button type="button" className="tv-ctl tv-garage-start" onClick={onStart}>
          {done ? "Do it again" : "Start"}
        </button>
        {done ? (
          <p className="tv-moves">Doing it again is just for fun. The reward is paid once.</p>
        ) : null}
        {!isWeekend ? <p className="tv-moves">A new drop arrives on Friday.</p> : null}
      </div>

      <button type="button" className="tv-ctl tv-garage-free" onClick={onFreeBuild}>
        Free build
      </button>
    </section>
  );
}
