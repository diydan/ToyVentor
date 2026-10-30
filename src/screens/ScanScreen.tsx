import { useState, type ChangeEvent } from "react";
import {
  sizeClassForLength,
  toyFromScanInput,
  type Toy,
  type ToyKind,
} from "../../shared/toy";
import { backupToys, downscalePhoto, submitScan } from "../features/scan/scan";
import { postSamScan } from "../lib/api";
import { pushOwnership } from "../lib/sync";
import { useToybox } from "../state/toybox";

const QUICK_PROMPTS: ReadonlyArray<{
  label: string;
  prompt: string;
  kind: ToyKind;
}> = [
  { label: "Car", prompt: "car", kind: "car" },
  { label: "Figure", prompt: "figure", kind: "figure" },
  { label: "Cup", prompt: "cup", kind: "other" },
  { label: "Bottle", prompt: "bottle", kind: "other" },
];

export function ScanScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { addToy } = useToybox();
  const saveToy = (toy: Toy) => {
    addToy(toy);
    void pushOwnership({ type: "toy", id: toy.id, payload: toy });
  };
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ToyKind>("car");
  const [prompt, setPrompt] = useState("car");
  const [lengthMm, setLengthMm] = useState(110);
  const [widthMm, setWidthMm] = useState(55);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await downscalePhoto(file));
      setError(null);
    } catch {
      setError("That photo couldn't be read. You can still save by hand.");
    }
  };

  const saveManual = async () => {
    setBusy(true);
    setError(null);
    const toy = toyFromScanInput({
      id: crypto.randomUUID(),
      name: name.trim() || "My toy",
      kind,
      lengthMm,
      widthMm,
      source: "manual",
      imageDataUrl: photo,
    });
    // Worker validates and (later) runs SAM. Offline is fine: keep locally.
    await submitScan(toy, prompt);
    saveToy(toy);
    onDone();
  };

  const outlineWithSam = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postSamScan({
        id: crypto.randomUUID(),
        name: name.trim() || "My toy",
        kind,
        lengthMm,
        prompt: prompt.trim(),
        imageDataUrl: photo,
      });
      if (result.toy && result.sam.applied) {
        saveToy({ ...result.toy, imageDataUrl: photo });
        onDone();
        return;
      }
      setError(
        result.sam.status === "no-match"
          ? `SAM found no "${prompt}" in that photo. Try a shorter noun (cup, not coffee cup), or save by hand below.`
          : result.sam.status === "not-configured"
            ? "SAM isn't configured on the server yet. You can still save by hand below."
            : `SAM couldn't outline that photo${result.sam.message ? `: ${result.sam.message}` : ""}. You can still save by hand below.`,
      );
    } catch {
      setError("SAM scan didn't reach the server. You can still save by hand below.");
    }
    setBusy(false);
  };

  const useBackup = (toyId: string) => {
    const toy = backupToys.find((t) => t.id === toyId);
    if (toy) {
      saveToy(toy);
      onDone();
    }
  };

  const sizeClass = sizeClassForLength(lengthMm);

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">Scan</h1>
        <button type="button" className="tv-ctl" onClick={onCancel}>
          Back
        </button>
      </header>

      <label className="scan-cam" style={{ marginBottom: 12 }}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhoto}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        {photo ? (
          <>
            <img src={photo} alt="Your toy" />
            <span
              className="tv-ctl"
              style={{ position: "absolute", right: 10, bottom: 10 }}
            >
              Retake photo
            </span>
          </>
        ) : (
          <>
            <div className="scan-reticle">SAM 3.1 outline</div>
            <span className="fine-print" style={{ margin: 0 }}>
              Tap to snap or upload a toy photo
            </span>
          </>
        )}
      </label>

      <div className="pill-row" style={{ marginBottom: 12 }}>
        {QUICK_PROMPTS.map((item) => {
          const active = prompt.trim().toLowerCase() === item.prompt && kind === item.kind;
          return (
            <button
              key={item.label}
              type="button"
              className={active ? "pill-chip pill-chip-on" : "pill-chip"}
              aria-pressed={active}
              onClick={() => {
                setKind(item.kind);
                setPrompt(item.prompt);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="glass-card" style={{ marginBottom: 12 }}>
        <span className="kicker-label">Toy details & real-world scale</span>

        <label className="field" style={{ marginTop: 4 }}>
          Toy name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Blue car"
          />
        </label>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <label className="field">
            What is it?
            <select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as ToyKind;
                setKind(next);
                setPrompt(
                  next === "car" ? "car" : next === "figure" ? "figure" : "cup",
                );
              }}
            >
              <option value="car">Car</option>
              <option value="figure">Figure</option>
              <option value="other">Something else</option>
            </select>
          </label>

          <label className="field">
            Outline noun
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="car, figure, cup"
            />
          </label>
        </div>

        <label className="field">
          Longest side: {lengthMm} mm ({sizeClass} parts)
          <input
            type="range"
            min={40}
            max={300}
            step={5}
            value={lengthMm}
            onChange={(e) => setLengthMm(Number(e.target.value))}
          />
        </label>

        <label className="field">
          Width: {widthMm} mm
          <input
            type="range"
            min={20}
            max={200}
            step={5}
            value={widthMm}
            onChange={(e) => setWidthMm(Number(e.target.value))}
          />
        </label>

        <p className="fine-print" style={{ marginBottom: 0 }}>
          SAM measures proportions from your photo while the slider sets
          millimeter scale. Toys saved without SAM stay honestly marked "by hand".
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="cta"
        disabled={busy || !photo}
        onClick={outlineWithSam}
      >
        {busy
          ? "Outlining..."
          : photo
            ? "Outline with SAM"
            : "Add a photo to outline with SAM"}
      </button>
      <button
        type="button"
        className="cta cta-quiet"
        disabled={busy}
        onClick={saveManual}
      >
        Save by hand instead
      </button>

      <div className="glass-card" style={{ marginTop: 12 }}>
        <span className="kicker-label">No toy handy? Instant starter toys</span>
        <div className="tv-fg-b" style={{ flexWrap: "wrap" }}>
          {backupToys.map((toy) => (
            <button
              key={toy.id}
              type="button"
              className="tv-ctl"
              style={{ minHeight: 42 }}
              onClick={() => useBackup(toy.id)}
            >
              {toy.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
