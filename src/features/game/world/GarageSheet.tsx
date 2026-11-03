import { useState } from "react";
import type { DropKind, GarageStatus } from "../../../lib/garage";
import type { HouseholdPictures } from "../../../lib/garageHouseholdData";
import { firstShapeTarget, HouseholdPicturesRow, ShapeGame } from "./HouseholdWeekend";

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
  /** The real-life build leg is switched on for this family. */
  realLifeOn?: boolean;
  /** Open the Workshop page with the toy as it is dressed now (the grown-up confirms there). */
  buildRealUrl?: string | null;
  /** A household weekend (find one at home, or play "Who's that shape?"): the pictures, the child's age band, and what finishing the game pays. */
  household?: {
    pictures: HouseholdPictures | null;
    ageBand: number | null | undefined;
    /** The child finished the game: pay out (nothing is saved in Preview) and return the line to show. */
    onSkipFinished: () => string;
  };
}

/**
 * The Garage (garage-weekend-spec.md). Always open: Free build works every day.
 * The drop card is the weekend's new part, idea or remix, written for the
 * child's age. A bottom sheet, like the rung sheet, over the carousel or the
 * trail map.
 */
export function GarageSheet({ status, onStart, onFreeBuild, onClose, realLifeOn = true, buildRealUrl = null, household }: GarageSheetProps) {
  const { variant, drop, done, isWeekend, dropEnabled } = status;
  const [playing, setPlaying] = useState(false);
  const isHousehold = status.kind === "household";
  const tag = isWeekend
    ? done
      ? "Done this weekend ★"
      : "New this weekend"
    : done
      ? "The latest drop: done ★"
      : "The latest drop";
  if (!dropEnabled) {
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
        <p className="tv-moves">New drops are off. Ask a grown-up to switch them on.</p>
        <button type="button" className="tv-ctl tv-garage-free" onClick={onFreeBuild}>
          Free build
        </button>
      </section>
    );
  }
  if (isHousehold && household && playing) {
    return (
      <ShapeGame
        ageBand={household.ageBand}
        firstTarget={firstShapeTarget(status)}
        pictures={household.pictures}
        onFinished={household.onSkipFinished}
        onBack={() => setPlaying(false)}
      />
    );
  }
  return (
    <section className="tv-sheet tv-sheet-garage" role="region" aria-label="Garage">
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Garage</span>
          <b className="tv-sh-title">{isHousehold ? "Find it at home" : "Build something new"}</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Close
        </button>
      </div>

      <div className={`tv-garage-drop${isWeekend && !done ? " tv-garage-drop-hot" : ""}`}>
        <div className="tv-garage-meta">
          <span className="tv-garage-tag">{tag}</span>
          <span className="tv-garage-kind">{isHousehold ? "Find it" : KIND_LABEL[drop.kind]}</span>
        </div>
        <b className="tv-garage-title">{variant.title}</b>
        {isHousehold && done ? null : <p className="tv-garage-brief">{variant.brief}</p>}
        {isHousehold ? <HouseholdPicturesRow status={status} pictures={household?.pictures ?? null} /> : null}
        {isHousehold ? (
          done ? (
            <p className="tv-moves">
              {status.found
                ? "You found it, and a grown-up said so. Great looking!"
                : "You played “Who’s that shape?”. Find the real thing next time for a gold star."}
            </p>
          ) : (
            <>
              <p className="tv-moves">Find it at home. A grown-up says “We found it” in Grown-Ups.</p>
              {household ? (
                <button type="button" className="tv-ctl tv-garage-free tv-house-skip" onClick={() => setPlaying(true)}>
                  Can’t find one? Play “Who’s that shape?”
                </button>
              ) : null}
            </>
          )
        ) : (
          <button type="button" className="tv-ctl tv-garage-start" onClick={onStart}>
            {done ? "Do it again" : "Start"}
          </button>
        )}
        {done && !isHousehold ? (
          <p className="tv-moves">Doing it again is just for fun. The reward is paid once.</p>
        ) : null}
        {done && !isHousehold && realLifeOn && buildRealUrl ? (
          <a
            className="tv-ctl tv-garage-free"
            href={buildRealUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Build it for real
          </a>
        ) : null}
        {done && !isHousehold && realLifeOn && buildRealUrl ? (
          <p className="tv-moves">Build it with real parts, then a grown-up says “We built it” in Grown-Ups.</p>
        ) : null}
        {!isWeekend ? <p className="tv-moves">A new drop arrives on Friday.</p> : null}
      </div>

      <button type="button" className="tv-ctl tv-garage-free" onClick={onFreeBuild}>
        Free build
      </button>
    </section>
  );
}
