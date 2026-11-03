import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PARENT_PRESETS,
  isValidPin,
  type GateStrictness,
  type ParentSettingsUpdateInput,
} from "../../../../shared/parent-time";
import { kipDemoUrl } from "../../../../shared/toycontract";
import { postRoomPhoto } from "../../../lib/api";
import type { TimeOfDayMode } from "../../../lib/timeOfDay";
import { downscalePhoto } from "../../scan/scan";
import { bypassGateSession, type ParentControlsSource } from "../../../lib/parentControls";
import {
  getLocalPinCooldownUntil,
  requestGateChallenge,
  runParentTimeAction,
  updateParentSettings,
  verifyGateAnswer,
  type GateChallenge,
  type GateSession,
  type ParentSnapshot,
} from "../../../lib/parentTime";
import {
  familyStars,
  rankFor,
  unlockedVehiclesFor,
  type ProgressionState,
} from "../../../lib/progression";
import {
  allChoresWithState,
  CHORE_QUEST_XP,
  practicedSkillsSummary,
  workshopDaysCount,
} from "../../../lib/dailyQuests";
import { BANDS } from "../../../lib/age";
import { resolvePhase4VehicleRoster } from "../../../lib/vehicleReadiness";
import { WORLDS, type WorldId } from "./engine";

export interface GrownUpsSheetProps {
  open: boolean;
  /** True when the parent already completed the 1.2s hold on the top-bar ⚙️ control. */
  holdSatisfied?: boolean;
  snapshot: ParentSnapshot;
  progression?: ProgressionState;
  localDayKey?: string;
  demoMode?: boolean;
  onToggleDemoMode?: (next: boolean) => void;
  /** Where the grown-up checks and limits stand: 'default' (on), or off by the 'build' flag or this tab's 'session' toggle (parentControls.ts). Absent means on. */
  parentControlsSource?: ParentControlsSource;
  /** Demo Mode only: turn the checks and limits off (true) or back on (false) for this tab. Returns false when the tab's storage refused. */
  onToggleParentControls?: (off: boolean) => boolean | void;
  /** Demo Mode only: show the weekend Garage drop on a weekday. */
  garagePreview?: boolean;
  onToggleGaragePreview?: () => void;
  onSeedDemoSave?: () => void;
  onOpenEditor?: () => void;
  /** Feature 3 (dark, Demo Mode): photo segments -> composed room level in the editor. Returns a status line. */
  onRoomPhoto?: (segments: Array<{ noun: string; box: { x1: number; y1: number; x2: number; y2: number } }>) => string;
  onJumpWorld?: (worldId: WorldId) => void;
  currentWorld?: string;
  kipUrl?: string;
  onResetXp?: () => void;
  onToggleSandbox?: () => void;
  /** Set/clear the carousel age band (progression ageBand, carousel spec §9). */
  onSetAgeBand?: (band: number | null) => void;
  /** Open the Map carousel (Levels row). */
  onOpenMap?: () => void;
  /** The map's look: follow the time of day, or pin day or night (device setting). */
  timeOfDayMode?: TimeOfDayMode;
  onSetTimeOfDayMode?: (mode: TimeOfDayMode) => void;
  onToggleChore?: (choreId: string) => void;
  /** This weekend's drop for the Garage section (null when the sheet has no game state). */
  garageSummary?: { title: string; done: boolean } | null;
  /** The Garage place is always on; the weekend drop card can be switched off. */
  garageDropOn?: boolean;
  onSetGarageDrop?: (on: boolean) => void;
  /** Grown-up-picked drop days (day-of-week numbers); absent = Fri–Sun. */
  garageDays?: number[];
  onToggleGarageDay?: (dow: number) => void;
  garageRealLifeOn?: boolean;
  onSetGarageRealLife?: (on: boolean) => void;
  /** This weekend's real-life build already confirmed by a grown-up. */
  garageRealDone?: boolean;
  /** Confirm "We built it"; returns the status line to show. */
  onConfirmGarageReal?: () => string;
  /** A household weekend (find one at home): this takes the place of "We built it", which has nothing to confirm there. */
  garageHousehold?: ReactNode;
  onSnapshotChange: (next: ParentSnapshot) => void;
  onClose: () => void;
}

const GARAGE_DAY_LABELS: ReadonlyArray<{ dow: number; label: string }> = [
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

type GateStep =
  | "hold"
  | "confirm_sitting"
  | "pin_unlock"
  | "math_check"
  | "pin_setup"
  | "unlocked";

type MathReason = "bootstrap" | "forgot_pin";

const HOLD_DURATION_MS = 1200;
const PIN_PAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const BASE_OPTIONS = [15, 20, 30, 45, 60, 90] as const;
const LIMIT_OPTIONS = [20, 30, 45, 60, 90, 120] as const;
const BONUS_OPTIONS = [0, 3, 5, 10] as const;
const SESSION_OPTIONS = [null, 10, 15, 20, 30, 45] as const;

export function GrownUpsSheet({
  open,
  holdSatisfied = false,
  snapshot,
  progression,
  localDayKey,
  demoMode = false,
  onToggleDemoMode,
  parentControlsSource,
  onToggleParentControls,
  garagePreview = false,
  onToggleGaragePreview,
  onSeedDemoSave,
  onOpenEditor,
  onRoomPhoto,
  onJumpWorld,
  currentWorld,
  kipUrl,
  onResetXp,
  onToggleSandbox,
  onSetAgeBand,
  onOpenMap,
  timeOfDayMode,
  onSetTimeOfDayMode,
  onToggleChore,
  garageSummary = null,
  garageDropOn = true,
  onSetGarageDrop,
  garageDays,
  onToggleGarageDay,
  garageRealLifeOn = true,
  onSetGarageRealLife,
  garageRealDone = false,
  onConfirmGarageReal,
  garageHousehold = null,
  onSnapshotChange,
  onClose,
}: GrownUpsSheetProps) {
  const [step, setStep] = useState<GateStep>("hold");
  const [holdProgress, setHoldProgress] = useState(0);
  const [challenge, setChallenge] = useState<GateChallenge | null>(null);
  const [mathReason, setMathReason] = useState<MathReason>("bootstrap");
  const [answerInput, setAnswerInput] = useState("");
  const [pinDigits, setPinDigits] = useState("");
  const [setupStage, setSetupStage] = useState<"first" | "confirm">("first");
  const [firstPinDraft, setFirstPinDraft] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [gateError, setGateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [confirmResetXp, setConfirmResetXp] = useState(false);
  const [sittingSession, setSittingSession] = useState<GateSession | null>(null);
  const [activeProof, setActiveProof] = useState<string>("local-proof");
  // The grown-up checks are off (parentControls.ts): the sheet opens without the hold and the question. `bypassedRef`: the open sheet was opened that way.
  const controlsMode = parentControlsSource !== undefined && parentControlsSource !== "default" ? "off" : "on";
  const bypassedRef = useRef(false);

  const holdRafRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);
  const holdingRef = useRef(false);
  const wasOpenRef = useRef(false);

  const cancelHold = useCallback(() => {
    holdingRef.current = false;
    if (holdRafRef.current !== null) {
      window.cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  const enterGateChallenge = useCallback(async () => {
    cancelHold();
    setBusy(true);
    setGateError(null);
    setPinDigits("");
    setAnswerInput("");
    const nextChallenge = await requestGateChallenge();
    setChallenge(nextChallenge);
    const activeCd =
      nextChallenge.cooldownUntil ?? getLocalPinCooldownUntil(Date.now());
    setCooldownUntil(activeCd);
    setNowTick(Date.now());
    setBusy(false);

    if (nextChallenge.mode === "pin") {
      setStep("pin_unlock");
    } else {
      setMathReason("bootstrap");
      setStep("math_check");
    }
  }, [cancelHold]);

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

  // Tick 1s countdown while a PIN cooldown is active.
  useEffect(() => {
    if (!open || !cooldownUntil) return;
    if (cooldownUntil <= Date.now()) {
      setCooldownUntil(null);
      return;
    }
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= cooldownUntil) {
        setCooldownUntil(null);
        setGateError((prev) =>
          prev && prev.startsWith("Too many PIN tries") ? null : prev,
        );
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [open, cooldownUntil]);

  // Reset entry step whenever the sheet transitions from closed -> open.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      cancelHold();
      setGateError(null);
      setStatusNote(null);
      setPinDigits("");
      setAnswerInput("");
      setConfirmResetXp(false);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setAnswerInput("");
    setPinDigits("");
    setGateError(null);
    setStatusNote(null);
    setConfirmResetXp(false);

    // Grown-up checks switched off (Demo Mode toggle or a showcase build): open straight onto the settings, no hold and no question. The session is NOT kept as a
    // sitting unlock (it must not outlive the switch), and its proof is the local-only token, so nothing reaches the Worker.
    const bypass = bypassGateSession(controlsMode);
    if (bypass) {
      bypassedRef.current = true;
      setSittingSession(null);
      setActiveProof(bypass.proofToken);
      setStep("unlocked");
      return;
    }

    if (
      snapshot.settings.gateStrictness === "sitting_window" &&
      sittingSession &&
      sittingSession.expiresAt > Date.now()
    ) {
      setActiveProof(sittingSession.proofToken);
      setStep("confirm_sitting");
    } else if (holdSatisfied) {
      setSittingSession(null);
      void enterGateChallenge();
    } else {
      setSittingSession(null);
      setStep("hold");
    }
  }, [
    open,
    holdSatisfied,
    cancelHold,
    enterGateChallenge,
    sittingSession,
    snapshot.settings.gateStrictness,
    controlsMode,
  ]);

  // The checks come back on while a bypassed sheet is open: lock it again at once, so what was opened without a question does not stay open once they are on.
  useEffect(() => {
    if (controlsMode === "on" && bypassedRef.current) {
      bypassedRef.current = false;
      cancelHold();
      setSittingSession(null);
      setActiveProof("local-proof");
      setStep("hold");
    }
  }, [controlsMode, cancelHold]);

  const startHold = useCallback(() => {
    if (holdingRef.current || busy) return;
    holdingRef.current = true;
    holdStartRef.current = performance.now();

    const completeHold = () => {
      if (!holdingRef.current) return;
      void enterGateChallenge();
    };

    holdTimerRef.current = window.setTimeout(completeHold, HOLD_DURATION_MS);

    const tick = (now: number) => {
      if (!holdingRef.current) return;
      const pct = Math.min(1, (now - holdStartRef.current) / HOLD_DURATION_MS);
      setHoldProgress(pct);
      if (pct >= 1) {
        completeHold();
        return;
      }
      holdRafRef.current = window.requestAnimationFrame(tick);
    };
    holdRafRef.current = window.requestAnimationFrame(tick);
  }, [busy, enterGateChallenge]);

  const recordUnlockedSession = useCallback(
    (session: GateSession) => {
      setActiveProof(session.proofToken);
      if (snapshot.settings.gateStrictness === "sitting_window") {
        setSittingSession(session);
      } else {
        setSittingSession(null);
      }
    },
    [snapshot.settings.gateStrictness],
  );

  const remainingCooldownSec =
    cooldownUntil && cooldownUntil > nowTick
      ? Math.max(1, Math.ceil((cooldownUntil - nowTick) / 1000))
      : 0;

  const verifyPinDigits = useCallback(
    async (fourDigits: string) => {
      if (!challenge || busy || !isValidPin(fourDigits)) return;
      setBusy(true);
      setGateError(null);
      const res = await verifyGateAnswer({ challenge, pin: fourDigits });
      setBusy(false);

      if (!res.ok) {
        setPinDigits("");
        if (res.cooldownUntil) {
          setCooldownUntil(res.cooldownUntil);
          setNowTick(Date.now());
        }
        setGateError(res.error);
        return;
      }

      setPinDigits("");
      setCooldownUntil(null);
      recordUnlockedSession(res.session);
      setStep("unlocked");
    },
    [busy, challenge, recordUnlockedSession],
  );

  const commitSetupPin = useCallback(
    async (confirmedPin: string) => {
      if (busy || !isValidPin(confirmedPin)) return;
      setBusy(true);
      setGateError(null);
      const res = await updateParentSettings({ pin: confirmedPin }, activeProof);
      setBusy(false);

      if (!res.ok) {
        setPinDigits("");
        setFirstPinDraft("");
        setSetupStage("first");
        setGateError(res.error);
        if (res.error.includes("expired")) {
          setSittingSession(null);
          setStep("hold");
        }
        return;
      }

      onSnapshotChange(res.snapshot);
      setPinDigits("");
      setFirstPinDraft("");
      setSetupStage("first");
      setCooldownUntil(null);
      setStatusNote("4-tap parent PIN saved.");
      setStep("unlocked");
    },
    [activeProof, busy, onSnapshotChange],
  );

  const handlePadDigit = useCallback(
    (digit: string) => {
      if (busy) return;
      if (step === "pin_unlock" && remainingCooldownSec > 0) return;
      if (pinDigits.length >= 4) return;

      const next = pinDigits + digit;
      setGateError(null);
      setPinDigits(next);

      if (next.length === 4) {
        if (step === "pin_unlock") {
          void verifyPinDigits(next);
        } else if (step === "pin_setup") {
          if (setupStage === "first") {
            setFirstPinDraft(next);
            setPinDigits("");
            setSetupStage("confirm");
          } else if (next === firstPinDraft) {
            void commitSetupPin(next);
          } else {
            setFirstPinDraft("");
            setPinDigits("");
            setSetupStage("first");
            setGateError("Those two PINs did not match. Tap 4 digits again.");
          }
        }
      }
    },
    [
      busy,
      commitSetupPin,
      firstPinDraft,
      pinDigits,
      remainingCooldownSec,
      setupStage,
      step,
      verifyPinDigits,
    ],
  );

  const handlePadBackspace = useCallback(() => {
    if (busy) return;
    setPinDigits((prev) => prev.slice(0, -1));
  }, [busy]);

  const handlePadClear = useCallback(() => {
    if (busy) return;
    setPinDigits("");
  }, [busy]);

  // Allow keyboard digit entry on the 4-tap PIN pad as well.
  useEffect(() => {
    if (!open || (step !== "pin_unlock" && step !== "pin_setup")) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handlePadDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handlePadBackspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, step, handlePadDigit, handlePadBackspace]);

  const openForgotPinMath = async () => {
    if (busy) return;
    setBusy(true);
    setGateError(null);
    setPinDigits("");
    setAnswerInput("");
    const fresh = await requestGateChallenge();
    setChallenge(fresh);
    setMathReason("forgot_pin");
    setBusy(false);
    setStep("math_check");
  };

  const submitMathCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || busy) return;
    setBusy(true);
    setGateError(null);

    const trimmed = answerInput.trim();
    const res = await verifyGateAnswer({
      challenge,
      answer: Number(trimmed),
    });
    setBusy(false);

    if (!res.ok) {
      setGateError(res.error);
      setAnswerInput("");
      return;
    }

    recordUnlockedSession(res.session);
    setAnswerInput("");
    setPinDigits("");
    setFirstPinDraft("");
    setSetupStage("first");
    setStep("pin_setup");
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
  /** Feature 3 (dark): one side-on room photo -> SAM segments -> composed level in the editor. Photo is discarded server-side. */
  const onRoomPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onRoomPhoto || roomBusy) return;
    setRoomBusy(true);
    setStatusNote("Looking at your room photo…");
    try {
      const imageDataUrl = await downscalePhoto(file);
      const res = await postRoomPhoto(imageDataUrl, activeProof);
      if (res.sam.status === "gate-required") {
        setStatusNote(
          controlsMode === "off"
            ? "Room photos still need a real grown-up check. Turn the checks back on (Showcase & Developer), answer the question once, then try again."
            : "Room photos need a live grown-up sign-in. Re-open Grown-ups with your PIN, then try again.",
        );
        return;
      }
      if (res.sam.status === "slow-down") {
        setStatusNote("Too many room photos just now. Wait a minute, then try again.");
        return;
      }
      if (!res.sam.configured) {
        setStatusNote("Photo levels are not switched on for this build yet.");
        return;
      }
      if (res.segments.length === 0) {
        setStatusNote("I could not spot any room props in that photo. Try a side-on photo with the floor in view.");
        return;
      }
      setStatusNote(onRoomPhoto(res.segments));
    } catch {
      setStatusNote("Could not read that photo just now. Check the connection and try again.");
    } finally {
      setRoomBusy(false);
    }
  };

  const effectiveKipUrl = kipUrl ?? kipDemoUrl();

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
          <b className="tv-sh-title">Play Time &amp; Settings</b>
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
            Grown-ups only. Press and hold for 1.2 seconds to open the parent PIN pad.
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

      {(step === "pin_unlock" || step === "pin_setup") && (
        <div className="tv-parent-gate-card" aria-live="polite">
          <div className="tv-pin-head">
            <strong className="tv-parent-prompt">
              {step === "pin_unlock"
                ? "Tap your 4-digit parent PIN"
                : setupStage === "first"
                  ? "Choose a 4-tap parent PIN"
                  : "Confirm your 4-tap PIN"}
            </strong>
            <span className="tv-pin-sub">
              {step === "pin_unlock"
                ? remainingCooldownSec > 0
                  ? `Cooldown active: wait ${remainingCooldownSec}s`
                  : "4 taps unlocks settings"
                : setupStage === "first"
                  ? "Step 1 of 2 · Tap 4 digits"
                  : "Step 2 of 2 · Tap the same 4 digits"}
            </span>
          </div>

          <div
            className="tv-pin-dots"
            role="status"
            aria-label={`${pinDigits.length} of 4 digits entered`}
          >
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={
                  idx < pinDigits.length ? "tv-pin-dot tv-pin-dot-on" : "tv-pin-dot"
                }
                aria-hidden="true"
              />
            ))}
          </div>

          <div className="tv-pin-pad" role="group" aria-label="4-tap PIN keypad">
            {PIN_PAD_DIGITS.map((digit) => (
              <button
                key={digit}
                type="button"
                className="tv-pin-key"
                disabled={
                  busy || (step === "pin_unlock" && remainingCooldownSec > 0)
                }
                onClick={() => handlePadDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className="tv-pin-key tv-pin-key-aux"
              disabled={busy || pinDigits.length === 0}
              onClick={handlePadClear}
            >
              Clear
            </button>
            <button
              type="button"
              className="tv-pin-key"
              disabled={
                busy || (step === "pin_unlock" && remainingCooldownSec > 0)
              }
              onClick={() => handlePadDigit("0")}
            >
              0
            </button>
            <button
              type="button"
              className="tv-pin-key tv-pin-key-aux"
              aria-label="Delete last digit"
              disabled={busy || pinDigits.length === 0}
              onClick={handlePadBackspace}
            >
              ⌫
            </button>
          </div>

          {(gateError || remainingCooldownSec > 0) && (
            <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">
              {remainingCooldownSec > 0
                ? `Too many PIN tries. Wait ${remainingCooldownSec}s before trying again.`
                : gateError}
            </p>
          )}

          <div className="tv-pin-foot">
            {step === "pin_unlock" ? (
              <button
                type="button"
                className="tv-pin-link"
                disabled={busy}
                onClick={() => void openForgotPinMath()}
              >
                Forgot PIN?
              </button>
            ) : setupStage === "confirm" ? (
              <button
                type="button"
                className="tv-pin-link"
                disabled={busy}
                onClick={() => {
                  setFirstPinDraft("");
                  setPinDigits("");
                  setSetupStage("first");
                  setGateError(null);
                }}
              >
                Start over
              </button>
            ) : null}
          </div>
        </div>
      )}

      {step === "math_check" && challenge && (
        <form
          className="tv-parent-gate-card"
          onSubmit={(e) => void submitMathCheck(e)}
        >
          <span className="tv-pin-sub">
            {mathReason === "forgot_pin"
              ? "Reset forgotten PIN: solve once to set a new 4-tap PIN"
              : "First-time setup: solve once, then choose your 4-tap PIN"}
          </span>
          <label htmlFor="tv-parent-answer" className="tv-parent-prompt">
            {`What is ${challenge.a} × ${challenge.b}?`}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="tv-parent-answer"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={4}
              value={answerInput}
              onChange={(e) =>
                setAnswerInput(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="Answer"
              className="tv-parent-input"
            />
            <button
              type="submit"
              className="cta"
              style={{ margin: 0, minHeight: 48, padding: "0 20px", fontSize: 16 }}
              disabled={busy || answerInput.length === 0}
            >
              Continue
            </button>
          </div>
          {gateError && (
            <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">
              {gateError}
            </p>
          )}
          {mathReason === "forgot_pin" && settings.pinSet && (
            <div className="tv-pin-foot">
              <button
                type="button"
                className="tv-pin-link"
                disabled={busy}
                onClick={() => {
                  setGateError(null);
                  setAnswerInput("");
                  setStep("pin_unlock");
                }}
              >
                Back to PIN pad
              </button>
            </div>
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

          {/* Demo Mode v1 (default Off) */}
          <div className="tv-parent-ledger">
            <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
              <div>
                <span className="kicker-label" style={{ margin: 0, display: "block" }}>
                  Showcase &amp; Developer
                </span>
                <b>Demo Mode</b>
              </div>
              <button
                type="button"
                className={demoMode ? "tv-ctl tv-ctl-sky" : "tv-ctl"}
                aria-pressed={demoMode}
                onClick={() => onToggleDemoMode?.(!demoMode)}
              >
                {demoMode ? "Demo Mode: On" : "Demo Mode: Off"}
              </button>
            </div>
            <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
              {demoMode
                ? "Full 12-world / Lab 1-6 bar, Level Editor, Kip 3D Rig, Seed Demo Save, and sandbox unlock-all active (earned XP stays untouched)."
                : "Default Off: boots straight onto a clean stage with a compact Worlds selector."}
            </p>

            {demoMode && (
              <div className="tv-demo-tools">
                {onToggleParentControls && (
                  <div style={{ marginBottom: 8 }}>
                    {parentControlsSource === "build" ? (
                      <p className="tv-moves" style={{ fontSize: 12 }}>
                        This showcase build has the grown-up checks and play-time limits switched off. They cannot be turned back on here.
                      </p>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={controlsMode === "off" ? "tv-ctl tv-ctl-sky" : "tv-ctl"}
                          aria-pressed={controlsMode === "off"}
                          onClick={() => {
                            const stored = onToggleParentControls(controlsMode !== "off");
                            if (stored === false) setStatusNote("This browser would not remember the switch, so nothing changed.");
                          }}
                        >
                          {controlsMode === "off" ? "Grown-up checks and limits: Off" : "Grown-up checks and limits: On"}
                        </button>
                        <p className="tv-moves" style={{ fontSize: 12 }}>
                          Off, for this tab only: no play-time limit or Sleep Curtain, no grown-up question on this sheet, and Workshop downloads work. Saved settings and
                          today&apos;s time are not changed. Photo uploads (Smart face, room scan) still need a grown-up. Closing the tab, or turning Demo Mode off, puts the
                          checks back on.
                        </p>
                      </>
                    )}
                  </div>
                )}
                {onToggleGaragePreview && (
                  <div style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className={garagePreview ? "tv-ctl tv-ctl-sky" : "tv-ctl"}
                      aria-pressed={garagePreview}
                      onClick={onToggleGaragePreview}
                    >
                      {garagePreview ? "Preview weekend: On" : "Preview weekend: Off"}
                    </button>
                    <p className="tv-moves" style={{ fontSize: 12 }}>
                      Shows the Garage&apos;s weekend drop (the next one) on any day, so the
                      animation and the mission can be shown on a weekday.
                    </p>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {onSeedDemoSave && (
                    <button
                      type="button"
                      className="tv-ctl tv-ctl-primary"
                      onClick={() => {
                        onSeedDemoSave();
                        setStatusNote(
                          "Demo save seeded in Garden (blueprints & parts stocked; earned XP unchanged).",
                        );
                      }}
                    >
                      Seed Demo Save
                    </button>
                  )}
                  {onOpenEditor && (
                    <button
                      type="button"
                      className="tv-ctl"
                      onClick={() => {
                        onClose();
                        onOpenEditor();
                      }}
                    >
                      Level Editor
                    </button>
                  )}
                  {onRoomPhoto && (
                    <label className="tv-ctl" style={{ cursor: roomBusy ? "wait" : "pointer" }}>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        aria-label="Room photo for a level"
                        disabled={roomBusy}
                        onChange={onRoomPhotoFile}
                        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                      />
                      {roomBusy ? "Reading photo…" : "Room Photo Level"}
                    </label>
                  )}
                  <a
                    className="tv-ctl"
                    href={effectiveKipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Kip 3D Rig
                  </a>
                  {progression && onToggleSandbox && (
                    <button
                      type="button"
                      className="tv-ctl"
                      aria-pressed={progression.sandboxUnlockAll}
                      onClick={onToggleSandbox}
                    >
                      {progression.sandboxUnlockAll
                        ? "Sandbox: all unlocked (on)"
                        : "Sandbox: unlock everything"}
                    </button>
                  )}
                </div>

                {progression && onSetAgeBand && (
                  <div>
                    <span className="tv-parent-stat-k" style={{ marginBottom: 4 }}>
                      Who is playing? (Map age)
                    </span>
                    <div className="tv-chips" role="group" aria-label="Age band">
                      {BANDS.map((band, i) => (
                        <button
                          key={band.id}
                          type="button"
                          className="tv-sc"
                          aria-pressed={progression.ageBand === i}
                          aria-label={`Ages ${band.label}`}
                          onClick={() => onSetAgeBand(i)}
                        >
                          {band.label}
                        </button>
                      ))}
                      {progression.ageBand !== undefined && (
                        <button
                          type="button"
                          className="tv-sc"
                          onClick={() => onSetAgeBand(null)}
                        >
                          Clear age
                        </button>
                      )}
                    </div>
                    <p className="tv-moves" style={{ fontSize: 12 }}>
                      The age picks which Learn levels the Map shows. Changing it
                      never removes stars or XP.
                    </p>
                    {onOpenMap && (
                      <button type="button" className="tv-ctl" onClick={onOpenMap}>
                        Levels: open the Map
                      </button>
                    )}
                  </div>
                )}

                {onSetTimeOfDayMode && (
                  <div>
                    <span className="tv-parent-stat-k" style={{ marginBottom: 4 }}>
                      Map look
                    </span>
                    <div className="tv-chips" role="group" aria-label="Map look">
                      {(
                        [
                          ["auto", "Auto"],
                          ["day", "Day"],
                          ["night", "Night"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className="tv-sc"
                          aria-pressed={(timeOfDayMode ?? "auto") === mode}
                          onClick={() => onSetTimeOfDayMode(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="tv-moves" style={{ fontSize: 12 }}>
                      Auto shows the day look from 7 am to 7 pm and the night look
                      after that, on this device&apos;s clock. Day or Night keeps one
                      look all the time.
                    </p>
                  </div>
                )}

                {onJumpWorld && (
                  <div>
                    <span className="tv-parent-stat-k" style={{ marginBottom: 4 }}>
                      Quick-jump Worlds &amp; STEM Labs
                    </span>
                    <div className="tv-chips">
                      {WORLDS.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className="tv-sc"
                          aria-pressed={currentWorld === w.id}
                          onClick={() => {
                            onJumpWorld(w.id);
                            onClose();
                          }}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {progression && (
            <div className="tv-parent-ledger">
              <span
                className="kicker-label"
                style={{ marginBottom: 6, display: "block" }}
              >
                STEM XP (read-only)
              </span>
              <div className="tv-parent-stats">
                <div>
                  <span className="tv-parent-stat-k">Total XP</span>
                  <strong className="tv-parent-stat-v">
                    {progression.totalXp}
                  </strong>
                </div>
                <div>
                  <span className="tv-parent-stat-k">Maker Rank</span>
                  <strong className="tv-parent-stat-v">
                    {rankFor(progression.totalXp).rank} ·{" "}
                    {rankFor(progression.totalXp).title}
                  </strong>
                </div>
                <div>
                  <span className="tv-parent-stat-k">Workshop days</span>
                  <strong className="tv-parent-stat-v">
                    {workshopDaysCount(progression)}
                  </strong>
                </div>
              </div>
              <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                {["lab1", "lab2", "lab3", "lab4", "lab5", "lab6"]
                  .map(
                    (lab) =>
                      `${lab.replace("lab", "Lab ")} ★${familyStars(progression, lab)}`,
                  )
                  .join(" · ")}
              </p>
              <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                Skills practiced: {practicedSkillsSummary(progression)}
              </p>
              {unlockedVehiclesFor(progression.totalXp).length > 0 && (
                <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                  Rank vehicles:{" "}
                  {unlockedVehiclesFor(progression.totalXp).join(", ")}
                </p>
              )}
              {(() => {
                const upNext =
                  resolvePhase4VehicleRoster(progression).lockedVehicles[0];
                return upNext ? (
                  <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                    Up next: {upNext.entry.name} at {upNext.entry.xpThreshold}{" "}
                    XP ({upNext.entry.recommendedLabLabel}). {upNext.guidance}
                  </p>
                ) : null;
              })()}
              <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                XP lives on this device. Reset keeps scanned and saved toys
                unlocked.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="tv-ctl"
                  aria-pressed={progression.sandboxUnlockAll}
                  onClick={onToggleSandbox}
                >
                  {progression.sandboxUnlockAll
                    ? "Sandbox: all unlocked (on)"
                    : "Sandbox: unlock everything"}
                </button>
                <button
                  type="button"
                  className="tv-ctl tv-ctl-danger"
                  onClick={() => {
                    if (!confirmResetXp) {
                      setConfirmResetXp(true);
                      return;
                    }
                    setConfirmResetXp(false);
                    onResetXp?.();
                  }}
                >
                  {confirmResetXp ? "Tap again to confirm Reset XP" : "Reset XP"}
                </button>
              </div>
            </div>
          )}

          {progression && (
            <>
            <div className="tv-parent-ledger">
              <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
                <div>
                  <span
                    className="kicker-label"
                    style={{ margin: 0, display: "block" }}
                  >
                    Real Life Counts
                  </span>
                  <b>Real-Life Routines (+{CHORE_QUEST_XP} XP/day)</b>
                </div>
                <span className="tv-parent-stat-k">
                  {(progression.enabledChoreIds ?? []).length} active
                </span>
              </div>
              <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                Optional offline habits shown in Toy Box. Each tap of &quot;I
                did it!&quot; awards +{CHORE_QUEST_XP} XP once per day and
                stamps a Workshop Day (missed days never reset progress).
              </p>
              <div className="tv-chips" role="group" aria-label="Real-Life Routines">
                {allChoresWithState(localDayKey ?? "", progression).map(
                  (chore) => (
                    <button
                      key={chore.id}
                      type="button"
                      className="tv-sc"
                      aria-pressed={chore.enabled}
                      title={chore.parentHint}
                      onClick={() => onToggleChore?.(chore.id)}
                    >
                      {chore.enabled ? "✓ " : ""}
                      {chore.title}
                      {chore.completed ? " (done today)" : ""}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="tv-parent-ledger">
              <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
                <div>
                  <span
                    className="kicker-label"
                    style={{ margin: 0, display: "block" }}
                  >
                    Weekend Build
                  </span>
                  <b>Garage</b>
                </div>
                <button
                  type="button"
                  className="tv-ctl"
                  aria-pressed={garageDropOn}
                  onClick={() => onSetGarageDrop?.(!garageDropOn)}
                >
                  {garageDropOn ? "Weekend drop: On" : "Weekend drop: Off"}
                </button>
              </div>
              <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                The Garage itself stays open. Off hides only the weekend drop
                card{garageSummary ? ` (“${garageSummary.title}”)` : ""}.
              </p>
              <div className="tv-chips" role="group" aria-label="Garage drop days">
                {GARAGE_DAY_LABELS.map(({ dow, label }) => {
                  const on = (garageDays ?? [0, 5, 6]).includes(dow);
                  const last = on && (garageDays ?? [0, 5, 6]).length === 1;
                  return (
                    <button
                      key={dow}
                      type="button"
                      className="tv-sc"
                      aria-pressed={on}
                      disabled={last}
                      title={last ? "One day stays on" : `Drop live on ${label}s`}
                      onClick={() => onToggleGarageDay?.(dow)}
                    >
                      {on ? "✓ " : ""}
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
                <div>
                  <b>Real-life build</b>
                </div>
                <button
                  type="button"
                  className="tv-ctl"
                  aria-pressed={garageRealLifeOn}
                  onClick={() => onSetGarageRealLife?.(!garageRealLifeOn)}
                >
                  {garageRealLifeOn ? "Real-life leg: On" : "Real-life leg: Off"}
                </button>
              </div>
              {garageHousehold ?? (
                <>
                  <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
                    After the in-app drop, the family rebuilds it with real parts.
                    Confirming here stamps a Workshop Day and pays +10 XP, only
                    when no real-life XP was earned yet today.
                  </p>
                  {onConfirmGarageReal && (
                    <button
                      type="button"
                      className="tv-ctl tv-ctl-primary"
                      disabled={!garageSummary?.done || !garageRealLifeOn || garageRealDone}
                      onClick={() => setStatusNote(onConfirmGarageReal())}
                    >
                      {garageRealDone
                        ? "Built it for real ★"
                        : "We built it"}
                    </button>
                  )}
                </>
              )}
            </div>
            </>
          )}

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
                  <b>4-tap parent PIN</b>
                  <span>{settings.pinSet ? "PIN active" : "Set on next unlock"}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className="tv-ctl tv-ctl-primary"
                    disabled={busy}
                    onClick={() => {
                      setGateError(null);
                      setPinDigits("");
                      setFirstPinDraft("");
                      setSetupStage("first");
                      setStep("pin_setup");
                    }}
                  >
                    {settings.pinSet ? "Change 4-tap PIN" : "Set 4-tap PIN"}
                  </button>
                  {settings.pinSet && (
                    <button
                      type="button"
                      className="tv-ctl"
                      disabled={busy}
                      onClick={() =>
                        void applyPatch(
                          { pin: "clear" },
                          "PIN cleared. Next unlock will set a new PIN.",
                        )
                      }
                    >
                      Clear PIN
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
