import type { PlayTimeStatus } from "../../../../shared/parent-time";

export interface SleepCurtainProps {
  status: PlayTimeStatus;
  quietEnd: string;
  toyName: string;
  /** True while waiting briefly for an open STEM mission step to finish. */
  missionGraceActive: boolean;
  onOpenGrownUps: () => void;
}

/**
 * Kid-facing wind-down surface (`docs/specs/parent-time-gate.md` & `docs/parts/snap.md`).
 * Never renders a visible countdown clock or fail state:
 * - Final 60 seconds: subtle non-interactive warm twilight vignette.
 * - Time ended / quiet hours: calm night-sky fade-out with a Grown-ups corner button.
 */
export function SleepCurtain({
  status,
  quietEnd,
  toyName,
  missionGraceActive,
  onOpenGrownUps,
}: SleepCurtainProps) {
  const showCurtain = status.locked && !missionGraceActive;
  const showTwilight =
    (status.twilightCue || (status.locked && missionGraceActive)) && !showCurtain;

  if (!showCurtain && !showTwilight) return null;

  if (showTwilight) {
    return <div className="tv-twilight-cue" aria-hidden="true" />;
  }

  const heading =
    status.reason === "session_limit"
      ? "Time for a break!"
      : status.reason === "quiet_hours"
        ? `${toyName} is resting for tonight`
        : `${toyName} is resting for today`;

  const body =
    status.reason === "session_limit"
      ? `Great building! ${toyName} and your worlds are saved safely while you take a break.`
      : status.reason === "quiet_hours"
        ? `Quiet hours are on until ${quietEnd}. Your builds and worlds are tucked in for morning.`
        : `Wonderful building today! ${toyName} and your worlds are saved safely. See you tomorrow!`;

  return (
    <div
      className="tv-sleep-curtain"
      role="dialog"
      aria-modal="true"
      aria-label="Rest Time"
    >
      <div className="tv-sleep-stars" aria-hidden="true">
        <i style={{ left: "14%", top: "16%" }} />
        <i style={{ left: "78%", top: "12%", animationDelay: "0.8s" }} />
        <i style={{ left: "26%", top: "28%", animationDelay: "1.4s" }} />
        <i style={{ left: "84%", top: "30%", animationDelay: "0.4s" }} />
        <i style={{ left: "52%", top: "18%", animationDelay: "1.9s" }} />
      </div>

      <div className="tv-sleep-card">
        <div className="tv-sleep-moon" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="26" fill="rgba(255, 210, 77, 0.14)" />
            <path
              d="M34.5 15.5A13.5 13.5 0 1 0 42 36.2 11.2 11.2 0 0 1 34.5 15.5Z"
              fill="#ffd24d"
            />
            <circle cx="39" cy="19" r="1.8" fill="#ffe799" />
            <circle cx="43.5" cy="25" r="1.2" fill="#ffe799" />
          </svg>
        </div>

        <h2 className="tv-sleep-title">{heading}</h2>
        <p className="tv-sleep-body">{body}</p>
      </div>

      <button
        type="button"
        className="tv-ctl tv-sleep-parent-btn"
        onClick={onOpenGrownUps}
      >
        Grown-ups
      </button>
    </div>
  );
}
