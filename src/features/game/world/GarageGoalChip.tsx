import type { GoalPart } from "../../../lib/garage";

export interface GarageGoalChipProps {
  title: string;
  brief: string;
  /** The goal broken into the things to do, each ticked as the child builds. */
  parts: readonly GoalPart[];
  done: boolean;
  /** What finishing paid ("+40 XP · +5 min"), or null if it was a replay. */
  reward: string | null;
  /** Build is open right now. */
  buildOpen: boolean;
  onOpenBuild: () => void;
  /** End the mission (the build stays as it is). */
  onStop: () => void;
}

/**
 * Rides over the stage while a Garage mission is on: the brief, the parts of
 * the goal with ticks that fill in live, and when it is done, what it paid.
 */
export function GarageGoalChip({
  title,
  brief,
  parts,
  done,
  reward,
  buildOpen,
  onOpenBuild,
  onStop,
}: GarageGoalChipProps) {
  return (
    <div className={`tv-garage-chip${done ? " tv-garage-chip-done" : ""}`} role="status" aria-live="polite">
      <div className="tv-garage-chip-top">
        <b className="tv-garage-chip-title">{done ? "Done! ★" : title}</b>
        {done || !buildOpen ? (
          <span className="tv-garage-chip-actions">
            {!done && !buildOpen ? (
              <button type="button" className="tv-ctl" onClick={onOpenBuild}>
                Open Build
              </button>
            ) : null}
            <button type="button" className="tv-ctl" onClick={onStop}>
              {done ? "Close" : "Stop"}
            </button>
          </span>
        ) : (
          <button type="button" className="tv-ctl" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      {done ? (
        <p className="tv-garage-chip-brief">{reward ?? "Nice build! The reward is paid once, so this one is just for fun."}</p>
      ) : (
        <>
          <p className="tv-garage-chip-brief">{brief}</p>
          <ul className="tv-garage-chip-parts">
            {parts.map((p) => (
              <li key={p.label} className={p.ok ? "on" : undefined}>
                <span aria-hidden="true">{p.ok ? "✓" : "○"}</span> {p.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
