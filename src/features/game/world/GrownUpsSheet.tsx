import { useCallback, useEffect, useRef, useState } from "react";
import {
  PARENT_PRESETS,
  isValidPin,
  type GateStrictness,
  type ParentSettingsUpdateInput,
} from "../../../../shared/parent-time";
import {
  requestGateChallenge,
  runParentTimeAction,
  updateParentSettings,
  verifyGateAnswer,
  type GateChallenge,
  type GateSession,
  type ParentSnapshot,
} from "../../../lib/parentTime";

export interface GrownUpsSheetProps {
  open: boolean;
  snapshot: ParentSnapshot;
  onSnapshotChange: (next: ParentSnapshot) => void;
  onClose: () => void;
}

type GateStep = "hold" | "challenge" | "confirm_sitting" | "unlocked";

const HOLD_DURATION_MS = 1200;
const BASE_OPTIONS = [15, 20, 30, 45, 60, 90] as const;
const LIMIT_OPTIONS = [20, 30, 45, 60, 90, 120] as const;
const BONUS_OPTIONS = [0, 3, 5, 10] as const;
const SESSION_OPTIONS = [null, 10, 15, 20, 30, 45] as const;

export function GrownUpsSheet({
  open,
  snapshot,
  onSnapshotChange,
  onClose,
}: GrownUpsSheetProps) {
  const [step, setStep] = useState<GateStep>("hold");
  const [holdProgress, setHoldProgress] = useState(0);
  const [challenge, setChallenge] = useState<GateChallenge | null>(null);
  const [answerInput, setAnswerInput] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [sittingSession, setSittingSession] = useState<GateSession | null>(null);
  const [activeProof, setActiveProof] = useState<string>("local-proof");

  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);
  const holdingRef = useRef(false);

  const cancelHold = useCallback(() => {
    holdingRef.current = false;
    if (holdRafRef.current !== null) {
      window.cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  // Immediately revoke any sitting unlock when the app is backgrounded.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setSittingSession(null);
        if (open) setStep("hold");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [open]);

  // Reset entry step whenever the sheet opens.
  useEffect(() => {
    if (!open) {
      cancelHold();
      setGateError(null);
      setStatusNote(null);
      return;
    }
    setAnswerInput("");
    setGateError(null);
    setStatusNote(null);

    if (
      snapshot.settings.gateStrictness === "sitting_window" &&
      sittingSession &&
      sittingSession.expiresAt > Date.now()
    ) {
      setActiveProof(sittingSession.proofToken);
      setStep("confirm_sitting");
    } else {
      setSittingSession(null);
      setStep("hold");
    }
  }, [open, cancelHold, sittingSession, snapshot.settings.gateStrictness]);

  const finishHoldIntoChallenge = useCallback(async () => {
    cancelHold();
    setBusy(true);
    setGateError(null);
    const nextChallenge = await requestGateChallenge();
    setChallenge(nextChallenge);
    setAnswerInput("");
    setBusy(false);
    setStep("challenge");
  }, [cancelHold]);

  const startHold = useCallback(() => {
    if (holdingRef.current || busy) return;
    holdingRef.current = true;
    holdStartRef.current = performance.now();

    const tick = (now: number) => {
      if (!holdingRef.current) return;
      const pct = Math.min(1, (now - holdStartRef.current) / HOLD_DURATION_MS);
      setHoldProgress(pct);
      if (pct >= 1) {
        void finishHoldIntoChallenge();
        return;
      }
      holdRafRef.current = window.requestAnimationFrame(tick);
    };
    holdRafRef.current = window.requestAnimationFrame(tick);
  }, [busy, finishHoldIntoChallenge]);

  const submitChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || busy) return;
    setBusy(true);
    setGateError(null);

    const trimmed = answerInput.trim();
    const res =
      challenge.mode === "pin"
        ? await verifyGateAnswer({ challenge, pin: trimmed })
        : await verifyGateAnswer({ challenge, answer: Number(trimmed) });
    setBusy(false);

    if (!res.ok) {
      setGateError(res.error);
      setAnswerInput("");
      return;
    }

    setActiveProof(res.session.proofToken);
    if (snapshot.settings.gateStrictness === "sitting_window") {
      setSittingSession(res.session);
    } else {
      setSittingSession(null);
    }
    setStep("unlocked");
  };

  const lockAndClose = () => {
    setSittingSession(null);
    setActiveProof("local-proof");
    setStep("hold");
    onClose();
  };

  const closeKeepingSittingIfAllowed = () => {
    if (snapshot.settings.gateStrictness !== "sitting_window") {
      setSittingSession(null);
      setActiveProof("local-proof");
    }
    onClose();
  };

  const applyPatch = async (patch: ParentSettingsUpdateInput, note?: string) => {
    setBusy(true);
    setStatusNote(null);
    const res = await updateParentSettings(patch, activeProof);
    setBusy(false);
    if (!res.ok) {
      setStatusNote(res.error);
      if (res.error.includes("expired")) {
        setSittingSession(null);
        setStep("hold");
      }
      return;
    }
    onSnapshotChange(res.snapshot);
    if (patch.gateStrictness === "every_time") {
      setSittingSession(null);
    }
    if (note) setStatusNote(note);
  };

  const handleParentAction = async (
    action: "grant_five_minutes" | "reset_session",
  ) => {
    setBusy(true);
    setStatusNote(null);
    const res = await runParentTimeAction(action, activeProof);
    setBusy(false);
    if (!res.ok) {
      setStatusNote(res.error);
      setSittingSession(null);
      setStep("hold");
      return;
    }
    onSnapshotChange(res.snapshot);
    setStatusNote(
      action === "grant_five_minutes"
        ? "Added 5 parent-approved minutes for today."
        : "Current sitting timer reset to 0m.",
    );
  };

  if (!open) return null;

  const { settings, ledger, status } = snapshot;
  const usedMinutes = Math.floor(status.usedSeconds / 60);
  const maxEarnable = Math.max(0, settings.dailyLimitMinutes - settings.dailyBaseMinutes);
  const totalCapToday = status.dailyCapMinutes + status.extraParentMinutes;
  const meterPct =
    settings.enabled && totalCapToday > 0
      ? Math.min(100, Math.round((status.usedSeconds / (totalCapToday * 60)) * 100))
      : 0;

  return (
    <section
      className="tv-modal tv-parent-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Grown-ups Play Time"
    >
      <div className="tv-sh-top">
        <div>
          <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
            Grown-Ups Corner
          </span>
          <b className="tv-sh-title">Play Time &amp; STEM Bonus</b>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {step === "unlocked" && settings.gateStrictness === "sitting_window" && (
            <button
              type="button"
              className="tv-ctl"
              onClick={closeKeepingSittingIfAllowed}
            >
              Done
            </button>
          )}
          <button
            type="button"
            className="tv-ctl tv-ctl-primary"
            onClick={step === "unlocked" ? lockAndClose : onClose}
          >
            {step === "unlocked" ? "Lock & Play" : "Close"}
          </button>
        </div>
      </div>

      {step === "hold" && (
        <div className="tv-parent-gate-card">
          <p className="tv-moves" style={{ fontSize: 14 }}>
            Grown-ups only. Press and hold the button below for 1.2 seconds to open family time controls.
          </p>

          <button
            type="button"
            className="tv-parent-hold-btn"
            disabled={busy}
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startHold();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                cancelHold();
              }
            }}
          >
            <span
              className="tv-parent-hold-fill"
              style={{ width: `${Math.round(holdProgress * 100)}%` }}
              aria-hidden="true"
            />
            <span className="tv-parent-hold-label">
              {busy
                ? "Preparing check..."
                : holdProgress > 0
                  ? "Keep holding..."
                  : "Hold for 1.2s (Grown-ups)"}
            </span>
          </button>
        </div>
      )}

      {step === "confirm_sitting" && (
        <div className="tv-parent-gate-card">
          <p className="tv-moves" style={{ fontSize: 14 }}>
            Still you? Confirm to reopen Play Time settings inside your 5-minute setup window.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="cta"
              style={{ margin: 0, flex: 1, minHeight: 48, fontSize: 16 }}
              onClick={() => setStep("unlocked")}
            >
              Confirm Grown-Up
            </button>
            <button
              type="button"
              className="tv-ctl"
              onClick={lockAndClose}
            >
              Lock Now
            </button>
          </div>
        </div>
      )}

      {step === "challenge" && challenge && (
        <form className="tv-parent-gate-card" onSubmit={(e) => void submitChallenge(e)}>
          <label htmlFor="tv-parent-answer" className="tv-parent-prompt">
            {challenge.mode === "pin"
              ? "Enter your 4-digit parent PIN"
              : `Quick STEM check: what is ${challenge.a} × ${challenge.b}?`}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="tv-parent-answer"
              type={challenge.mode === "pin" ? "password" : "text"}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={challenge.mode === "pin" ? 4 : 4}
              value={answerInput}
              onChange={(e) =>
                setAnswerInput(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder={challenge.mode === "pin" ? "4 digits" : "Answer"}
              className="tv-parent-input"
            />
            <button
              type="submit"
              className="cta"
              style={{ margin: 0, minHeight: 48, padding: "0 20px", fontSize: 16 }}
              disabled={busy || answerInput.length === 0}
            >
              Unlock
            </button>
          </div>
          {gateError && (
            <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">
              {gateError}
            </p>
          )}
        </form>
      )}

      {step === "unlocked" && (
        <div className="tv-parent-body">
          {/* 1. Today's Ledger Summary */}
          <div className="tv-parent-ledger">
            <div className="tv-parent-stats">
              <div>
                <span className="tv-parent-stat-k">Used today</span>
                <strong className="tv-parent-stat-v">{usedMinutes}m</strong>
              </div>
              <div>
                <span className="tv-parent-stat-k">STEM earned</span>
                <strong className="tv-parent-stat-v" style={{ color: "var(--mint)" }}>
                  +{status.earnedMinutes}m / {maxEarnable}m
                </strong>
              </div>
              <div>
                <span className="tv-parent-stat-k">Today&apos;s budget</span>
                <strong className="tv-parent-stat-v">
                  {settings.enabled ? `${totalCapToday}m` : "Off"}
                </strong>
              </div>
            </div>

            {settings.enabled && (
              <div className="theme-progress" aria-hidden="true">
                <div
                  className="theme-progress-fill"
                  style={{ width: `${meterPct}%` }}
                />
              </div>
            )}

            <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
              {status.completedCount}{" "}
              {status.completedCount === 1 ? "STEM mission" : "STEM missions"} finished today · Resets at midnight ({settings.timezone}) · No rollover.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="tv-ctl tv-ctl-sky"
                disabled={busy}
                onClick={() => void handleParentAction("grant_five_minutes")}
              >
                +5 min today
              </button>
              {(settings.sessionLimitMinutes !== null || ledger.sessionUsedSeconds > 0) && (
                <button
                  type="button"
                  className="tv-ctl"
                  disabled={busy}
                  onClick={() => void handleParentAction("reset_session")}
                >
                  Reset sitting ({Math.floor(ledger.sessionUsedSeconds / 60)}m used)
                </button>
              )}
            </div>
          </div>

          {/* 2. One-Tap Presets */}
          <div>
            <span className="kicker-label" style={{ marginBottom: 6, display: "block" }}>
              Quick Presets
            </span>
            <div className="tv-parent-presets">
              {PARENT_PRESETS.map((preset) => {
                const isSelected =
                  preset.id === "off"
                    ? !settings.enabled
                    : settings.enabled &&
                      settings.dailyBaseMinutes === preset.patch.dailyBaseMinutes &&
                      settings.dailyLimitMinutes === preset.patch.dailyLimitMinutes &&
                      settings.sessionLimitMinutes === preset.patch.sessionLimitMinutes;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={busy}
                    className={
                      isSelected
                        ? "tv-parent-preset tv-parent-preset-on"
                        : "tv-parent-preset"
                    }
                    onClick={() =>
                      void applyPatch(preset.patch, `Preset applied: ${preset.label}.`)
                    }
                  >
                    <b>{preset.label}</b>
                    <span>{preset.summary}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Three Clear Numbers */}
          <div className="tv-parent-controls">
            <div>
              <div className="tv-parent-row-head">
                <b>Base daily time</b>
                <span>Guaranteed play today</span>
              </div>
              <div className="tv-chips">
                {BASE_OPTIONS.map((mins) => {
                  const on = settings.enabled && settings.dailyBaseMinutes === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      className="tv-sc"
                      aria-pressed={on}
                      disabled={busy}
                      onClick={() =>
                        void applyPatch({
                          enabled: true,
                          dailyBaseMinutes: mins,
                          dailyLimitMinutes: Math.max(settings.dailyLimitMinutes, mins),
                        })
                      }
                    >
                      {mins}m
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="tv-parent-row-head">
                <b>Hard daily ceiling</b>
                <span>STEM missions never exceed this</span>
              </div>
              <div className="tv-chips">
                {LIMIT_OPTIONS.map((mins) => {
                  const on = settings.enabled && settings.dailyLimitMinutes === mins;
                  const tooLow = mins < settings.dailyBaseMinutes;
                  return (
                    <button
                      key={mins}
                      type="button"
                      className="tv-sc"
                      aria-pressed={on}
                      disabled={busy || tooLow}
                      onClick={() =>
                        void applyPatch({
                          enabled: true,
                          dailyLimitMinutes: mins,
                        })
                      }
                    >
                      {mins}m
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="tv-parent-row-head">
                <b>STEM mission bonus</b>
                <span>Per unique lab, bridge, or lift</span>
              </div>
              <div className="tv-chips">
                {BONUS_OPTIONS.map((mins) => {
                  const on = settings.minutesPerChallenge === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      className="tv-sc"
                      aria-pressed={on}
                      disabled={busy}
                      onClick={() =>
                        void applyPatch({ minutesPerChallenge: mins })
                      }
                    >
                      {mins === 0 ? "Off" : `+${mins}m`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Sitting Timer, Bedtime & Gate Strictness Disclosure */}
          <details className="tv-disclosure">
            <summary>
              <span>Sitting timer, Bedtime &amp; Gate</span>
              <span className="tv-disclosure-meta">
                {settings.quietHours.enabled
                  ? `Quiet ${settings.quietHours.start}-${settings.quietHours.end}`
                  : settings.sessionLimitMinutes
                    ? `${settings.sessionLimitMinutes}m sitting`
                    : "Optional"}
              </span>
            </summary>

            <div className="tv-parent-adv">
              <div>
                <div className="tv-parent-row-head">
                  <b>Sitting timer (right now)</b>
                  <span>Pauses before daily ceiling</span>
                </div>
                <div className="tv-chips">
                  {SESSION_OPTIONS.map((mins) => {
                    const key = mins === null ? "off" : String(mins);
                    const on = settings.sessionLimitMinutes === mins;
                    return (
                      <button
                        key={key}
                        type="button"
                        className="tv-sc"
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() =>
                          void applyPatch({
                            ...(mins !== null ? { enabled: true } : {}),
                            sessionLimitMinutes: mins,
                          })
                        }
                      >
                        {mins === null ? "No sitting cap" : `${mins}m`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="tv-parent-row-head">
                  <b>Bedtime quiet hours</b>
                  <button
                    type="button"
                    className="tv-ctl"
                    aria-pressed={settings.quietHours.enabled}
                    disabled={busy}
                    onClick={() =>
                      void applyPatch({
                        ...(settings.quietHours.enabled ? {} : { enabled: true }),
                        quietHours: {
                          ...settings.quietHours,
                          enabled: !settings.quietHours.enabled,
                        },
                      })
                    }
                  >
                    {settings.quietHours.enabled ? "Quiet hours: On" : "Quiet hours: Off"}
                  </button>
                </div>
                {settings.quietHours.enabled && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                    <label style={{ fontSize: 13 }}>
                      Bedtime{" "}
                      <input
                        type="time"
                        value={settings.quietHours.start}
                        onChange={(e) =>
                          void applyPatch({
                            quietHours: {
                              ...settings.quietHours,
                              start: e.target.value,
                            },
                          })
                        }
                        className="tv-parent-time"
                      />
                    </label>
                    <label style={{ fontSize: 13 }}>
                      Morning{" "}
                      <input
                        type="time"
                        value={settings.quietHours.end}
                        onChange={(e) =>
                          void applyPatch({
                            quietHours: {
                              ...settings.quietHours,
                              end: e.target.value,
                            },
                          })
                        }
                        className="tv-parent-time"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div>
                <div className="tv-parent-row-head">
                  <b>Grown-up gate strictness</b>
                  <span>Locks automatically on background</span>
                </div>
                <div className="tv-chips">
                  {(
                    [
                      ["every_time", "Ask every time (safest)"],
                      ["sitting_window", "5-min setup window"],
                    ] as const satisfies readonly [GateStrictness, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className="tv-sc"
                      aria-pressed={settings.gateStrictness === mode}
                      disabled={busy}
                      onClick={() => void applyPatch({ gateStrictness: mode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="tv-parent-row-head">
                  <b>Optional 4-digit PIN</b>
                  <span>{settings.pinSet ? "PIN active" : "Using STEM math"}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="New 4-digit PIN"
                    value={pinDraft}
                    onChange={(e) =>
                      setPinDraft(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    className="tv-parent-input"
                  />
                  <button
                    type="button"
                    className="tv-ctl tv-ctl-primary"
                    disabled={busy || !isValidPin(pinDraft)}
                    onClick={() => {
                      const nextPin = pinDraft;
                      setPinDraft("");
                      void applyPatch({ pin: nextPin }, "4-digit parent PIN saved.");
                    }}
                  >
                    Save PIN
                  </button>
                  {settings.pinSet && (
                    <button
                      type="button"
                      className="tv-ctl"
                      disabled={busy}
                      onClick={() =>
                        void applyPatch(
                          { pin: "clear" },
                          "PIN cleared. Using STEM multiplication check.",
                        )
                      }
                    >
                      Use Math
                    </button>
                  )}
                </div>
              </div>
            </div>
          </details>

          {statusNote && (
            <p className="tv-moves" style={{ margin: 0, color: "var(--mint)" }} role="status">
              {statusNote}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
