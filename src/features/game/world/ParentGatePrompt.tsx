// The one "ask the grown-up" prompt, for any screen that needs a fresh proof (src/lib/grownUpGate.ts). It is the gate that exists, in a small window: hold the button, then the 4-tap PIN
// (when one is set) or the maths question on the big number pad, then the same proof the Grown-ups sheet gets. Nothing else: no settings, no way to change anything.
import { useCallback, useEffect, useRef, useState } from "react";
import { registerGrownUpAsker } from "../../../lib/grownUpGate";
import { requestGateChallenge, verifyGateAnswer, type GateChallenge, type GateSession } from "../../../lib/parentTime";
import { GateMathPad } from "./GateMathPad";

const HOLD_MS = 1200;
const PIN_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface ParentGatePromptProps {
  onDone: (session: GateSession | null) => void;
}

export function ParentGatePrompt({ onDone }: ParentGatePromptProps) {
  const [stage, setStage] = useState<"hold" | "loading" | "question">("hold");
  const [progress, setProgress] = useState(0);
  const [challenge, setChallenge] = useState<GateChallenge | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  const stopHold = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  }, []);
  useEffect(() => stopHold, [stopHold]);

  const beginHold = () => {
    if (timer.current !== null || stage !== "hold") return;
    started.current = Date.now();
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        setStage("loading");
        void requestGateChallenge().then((c) => { setChallenge(c); setStage("question"); }, () => setError("Could not reach the grown-up check. Try again."));
      }
    }, 40);
  };

  const check = async (next: { pin?: string; answer?: number }) => {
    if (!challenge || busy) return;
    setBusy(true);
    setError(null);
    const res = await verifyGateAnswer({ challenge, ...next });
    setBusy(false);
    setValue("");
    if (res.ok) onDone(res.session);
    else setError(res.error);
  };

  const onPinDigit = (d: string) => {
    if (busy || value.length >= 4) return;
    const next = value + d;
    setValue(next);
    if (next.length === 4) void check({ pin: next });
  };

  return (
    <div className="tv-gate-scrim" role="dialog" aria-modal="true" aria-label="Ask a grown-up" data-testid="parent-gate-prompt">
      <div className="tv-parent-gate-card tv-parent-gate-card-math tv-gate-prompt">
        <p className="tv-math-q">A grown-up needs to say yes</p>
        {stage === "hold" && (
          <>
            <span className="tv-pin-sub">Hold the button for a moment, then answer the grown-up question.</span>
            <button
              type="button"
              className="tv-parent-hold-btn"
              onPointerDown={beginHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              data-testid="parent-gate-hold"
            >
              <span className="tv-parent-hold-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              <span className="tv-parent-hold-label">Hold to unlock</span>
            </button>
          </>
        )}
        {stage === "loading" && <span className="tv-pin-sub" role="status">One moment…</span>}
        {stage === "question" && challenge && challenge.mode === "math" && (
          <GateMathPad
            question={`What is ${challenge.a} × ${challenge.b}?`}
            value={value}
            onChange={setValue}
            onSubmit={() => void check({ answer: Number(value) })}
            busy={busy}
            error={error}
          />
        )}
        {stage === "question" && challenge && challenge.mode === "pin" && (
          <>
            <span className="tv-pin-sub">Tap your 4-digit PIN</span>
            <div className="tv-pin-dots" role="status" aria-label={`${value.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={i < value.length ? "tv-pin-dot tv-pin-dot-on" : "tv-pin-dot"} aria-hidden="true" />)}
            </div>
            <div className="tv-pin-pad" role="group" aria-label="4-tap PIN keypad">
              {PIN_DIGITS.map((d) => <button key={d} type="button" className="tv-pin-key" disabled={busy} onClick={() => onPinDigit(d)}>{d}</button>)}
              <button type="button" className="tv-pin-key tv-pin-key-aux" disabled={busy || value.length === 0} onClick={() => setValue("")}>Clear</button>
              <button type="button" className="tv-pin-key" disabled={busy} onClick={() => onPinDigit("0")}>0</button>
              <button type="button" className="tv-pin-key tv-pin-key-aux" aria-label="Delete last digit" disabled={busy || value.length === 0} onClick={() => setValue(value.slice(0, -1))}>⌫</button>
            </div>
            {error ? <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">{error}</p> : null}
          </>
        )}
        {stage === "hold" && error ? <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">{error}</p> : null}
        <button type="button" className="tv-pin-link" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Mount once at the app root: it shows the prompt when any screen calls askGrownUp(), and answers that call. */
export function ParentGateHost() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((s: GateSession | null) => void) | null>(null);
  useEffect(
    () =>
      registerGrownUpAsker(
        () =>
          new Promise<GateSession | null>((resolve) => {
            resolver.current?.(null); // a second ask while one is open ends the first (cancelled)
            resolver.current = resolve;
            setOpen(true);
          }),
      ),
    [],
  );
  if (!open) return null;
  return (
    <ParentGatePrompt
      onDone={(s) => {
        setOpen(false);
        resolver.current?.(s);
        resolver.current = null;
      }}
    />
  );
}
