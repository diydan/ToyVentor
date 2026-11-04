import { useEffect, useRef, useState } from "react";
import { FORGET_ARM_MS, nextForgetTap } from "../../../lib/returningPlayer";

/**
 * "Forget this player" in the Grown-Ups sheet: it removes the saved name and favourites from this device (and nothing else), so it takes two taps. The first tap turns the button into
 * "Tap again to forget Mia"; a second tap within five seconds forgets, otherwise it goes back to what it was. Only a grown-up reaches it (the sheet is behind the grown-up check).
 */
export function ForgetPlayerButton({ name, onForget }: { name: string; onForget: () => void }) {
  const [armed, setArmed] = useState(false);
  const armedAt = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const tap = () => {
    const step = nextForgetTap(armedAt.current, Date.now());
    armedAt.current = step.armedAt;
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    if (step.forget) { setArmed(false); onForget(); return; }
    setArmed(true);
    timer.current = window.setTimeout(() => { armedAt.current = null; setArmed(false); timer.current = null; }, FORGET_ARM_MS);
  };

  return (
    <button type="button" className={armed ? "tv-ctl tv-ctl-danger" : "tv-ctl"} onClick={tap} data-forget-player aria-live="polite">
      {armed ? `Tap again to forget ${name}` : "Forget this player"}
    </button>
  );
}
