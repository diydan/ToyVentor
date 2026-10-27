import { useState } from "react";
import { scanToy } from "../features/scan/scan";
import { useToybox } from "../state/toybox";

export function ScanScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { addToy } = useToybox();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useBackupToy = async () => {
    setBusy(true);
    setError(null);
    try {
      const toy = await scanToy();
      addToy(toy);
      onDone();
    } catch {
      setError("Scan didn't return a toy. Try again.");
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>Scan</h1>
      <p>
        Live SAM scanning lands on Day 2 of the plan. For now the scan path
        loads the preloaded backup toy — the same fallback the demo uses
        when a live scan fails — and saves it to your Toybox.
      </p>
      {error && <p className="error">{error}</p>}
      <button type="button" className="cta" disabled={busy} onClick={useBackupToy}>
        {busy ? "Loading…" : "Use backup toy"}
      </button>
      <button type="button" className="cta cta-quiet" onClick={onCancel}>
        Back
      </button>
    </section>
  );
}
