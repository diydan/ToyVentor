import { useState, type ChangeEvent } from "react";
import {
  sizeClassForLength,
  toyFromScanInput,
  type ToyKind,
} from "../../shared/toy";
import { postSamScan } from "../lib/api";
import { backupToys, downscalePhoto, submitScan } from "../features/scan/scan";
import { useToybox } from "../state/toybox";

export function ScanScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { addToy } = useToybox();
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
    addToy(toy);
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
        addToy({ ...result.toy, imageDataUrl: photo });
        onDone();
        return;
      }
      setError(
        result.sam.status === "no-match"
          ? `SAM found no “${prompt}” in that photo. Try a shorter noun (cup, not coffee cup), or save by hand below.`
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
      addToy(toy);
      onDone();
    }
  };

  return (
    <section>
      <h1>Scan</h1>
      <p>
        Photo a toy, name it in one short noun, and let SAM outline it.
        SAM measures proportions from the photo; the slider below gives it
        real-world scale. No match? Save by hand and it's marked “by hand”,
        never fake-scanned.
      </p>

      <label className="field">
        Photo
        <input type="file" accept="image/*" capture="environment" onChange={onPhoto} />
      </label>
      {photo && <img className="scan-photo" src={photo} alt="Your toy" />}

      <label className="field">
        Toy name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Blue car" />
      </label>

      <label className="field">
        What is it?
        <select
          value={kind}
          onChange={(e) => {
            const next = e.target.value as ToyKind;
            setKind(next);
            setPrompt(next === "car" ? "car" : next === "figure" ? "figure" : "cup");
          }}
        >
          <option value="car">Car</option>
          <option value="figure">Figure</option>
          <option value="other">Something else</option>
        </select>
      </label>

      <label className="field">
        Outline prompt — one short noun (cup, bottle, car)
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      <label className="field">
        Real longest side: {lengthMm} mm → {sizeClassForLength(lengthMm)} parts
        <input
          type="range" min={40} max={300} step={5} value={lengthMm}
          onChange={(e) => setLengthMm(Number(e.target.value))}
        />
      </label>

      <label className="field">
        Width: {widthMm} mm
        <input
          type="range" min={20} max={200} step={5} value={widthMm}
          onChange={(e) => setWidthMm(Number(e.target.value))}
        />
      </label>

      {error && <p className="error">{error}</p>}
      <button type="button" className="cta" disabled={busy || !photo} onClick={outlineWithSam}>
        {busy ? "Outlining…" : photo ? "Outline with SAM" : "Add a photo to outline with SAM"}
      </button>
      <button type="button" className="cta cta-quiet" disabled={busy} onClick={saveManual}>
        Save by hand instead
      </button>

      <h2>No toy handy?</h2>
      {backupToys.map((toy) => (
        <button
          key={toy.id}
          type="button"
          className="cta cta-quiet"
          onClick={() => useBackup(toy.id)}
        >
          Use backup {toy.kind}
        </button>
      ))}
      <button type="button" className="cta cta-quiet" onClick={onCancel}>
        Back
      </button>
    </section>
  );
}
