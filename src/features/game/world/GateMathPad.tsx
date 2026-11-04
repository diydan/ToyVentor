// The grown-up gate's maths question, answered on a big number pad instead of a small text field: the on-screen keyboard used to cover a small field on a phone held sideways, so the
// grown-up could not see what they typed. The look is the PIN pad's (the same keys), the answer is shown large above it, and a physical keyboard still works (digits, Backspace, Enter).
// Built as its own piece so any screen that has to ask a grown-up the question can use the same pad.
import { useEffect, useRef } from "react";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const MATH_ANSWER_MAX_DIGITS = 4;

export interface GateMathPadProps {
  /** "What is 34 × 27?" */
  question: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
}

export function GateMathPad({ question, value, onChange, onSubmit, busy = false, error = null }: GateMathPadProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const add = (d: string) => {
    if (!busy && value.length < MATH_ANSWER_MAX_DIGITS) onChange(value + d);
  };
  const del = () => {
    if (!busy) onChange(value.slice(0, -1));
  };
  return (
    <div
      ref={box}
      className="tv-math"
      tabIndex={0}
      data-testid="gate-math-pad"
      onKeyDown={(e) => {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); add(e.key); }
        else if (e.key === "Backspace") { e.preventDefault(); del(); }
        else if (e.key === "Enter" && value.length > 0 && !busy) { e.preventDefault(); onSubmit(); }
      }}
    >
      <p className="tv-math-q" id="tv-math-question">{question}</p>
      <div className="tv-math-answer" role="status" aria-live="polite" aria-labelledby="tv-math-question" data-testid="gate-math-answer">
        {value.length > 0 ? value : <span className="tv-math-hint">Tap the numbers</span>}
      </div>
      <div className="tv-pin-pad" role="group" aria-label="Number keypad for the answer">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="tv-pin-key" disabled={busy} onClick={() => add(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="tv-pin-key tv-pin-key-aux" disabled={busy || value.length === 0} onClick={() => onChange("")}>
          Clear
        </button>
        <button type="button" className="tv-pin-key" disabled={busy} onClick={() => add("0")}>
          0
        </button>
        <button type="button" className="tv-pin-key tv-pin-key-aux" aria-label="Delete last digit" disabled={busy || value.length === 0} onClick={del}>
          ⌫
        </button>
      </div>
      <button type="button" className="cta tv-math-go" disabled={busy || value.length === 0} onClick={onSubmit}>
        Continue
      </button>
      {error ? (
        <p className="tv-small-part-warn" style={{ margin: 0 }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
