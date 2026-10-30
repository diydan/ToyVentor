import { useEffect, useState, type ChangeEvent } from "react";
import {
  sizeClassForLength,
  toyFromScanInput,
  type Toy,
  type ToyKind,
} from "../../../../shared/toy";
import { loadBuild } from "../../../lib/builds";
import { partsById } from "../../../lib/catalog";
import { postSamScan } from "../../../lib/api";
import { pushOwnership } from "../../../lib/sync";
import { skinForToy } from "../../../state/skins";
import { useToybox } from "../../../state/toybox";
import { backupToys, downscalePhoto, submitScan } from "../../scan/scan";
import { SkinPanel } from "../../skin/SkinPanel";

type ObjectChipId = "car" | "figure" | "cup" | "bottle" | "other";

const OBJECT_CHIPS: ReadonlyArray<{
  id: ObjectChipId;
  label: string;
  prompt: string;
  kind: ToyKind;
}> = [
  { id: "car", label: "Car", prompt: "car", kind: "car" },
  { id: "figure", label: "Figure", prompt: "figure", kind: "figure" },
  { id: "cup", label: "Cup", prompt: "cup", kind: "other" },
  { id: "bottle", label: "Bottle", prompt: "bottle", kind: "other" },
  { id: "other", label: "Other", prompt: "toy", kind: "other" },
];

const SIZE_PRESETS: ReadonlyArray<{
  id: "S" | "M" | "L";
  label: string;
  lengthMm: number;
  widthMm: number;
}> = [
  { id: "S", label: "S", lengthMm: 75, widthMm: 45 },
  { id: "M", label: "M", lengthMm: 110, widthMm: 55 },
  { id: "L", label: "L", lengthMm: 180, widthMm: 90 },
];

function glyphForToy(toy: Toy): string {
  if (toy.kind === "car") return "🚗";
  if (toy.id === "seed-kip") return "🤖";
  if (toy.kind === "figure") return "🚀";
  return "🧸";
}

export function MyToySheet({
  open,
  initialStep = "shelf",
  onClose,
  onSkinChange,
}: {
  open: boolean;
  initialStep?: "shelf" | "scan";
  onClose: () => void;
  onSkinChange?: () => void;
}) {
  const { uploadedToys, builtInToys, selected, addToy, selectToy } = useToybox();
  const [step, setStep] = useState<"shelf" | "scan">(initialStep);

  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  const [chipId, setChipId] = useState<ObjectChipId>("car");
  const [customNoun, setCustomNoun] = useState("toy");
  const [name, setName] = useState("");
  const [lengthMm, setLengthMm] = useState(110);
  const [widthMm, setWidthMm] = useState(55);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const activeChip =
    OBJECT_CHIPS.find((c) => c.id === chipId) ?? OBJECT_CHIPS[0]!;
  const kind: ToyKind = activeChip.kind;
  const prompt = (chipId === "other" ? customNoun : activeChip.prompt).trim() || "toy";
  const sizeClass = sizeClassForLength(lengthMm);

  const orderedToys = [...uploadedToys, ...builtInToys];

  const saveScannedToy = (toy: Toy) => {
    addToy(toy);
    void pushOwnership({ type: "toy", id: toy.id, payload: toy });
  };

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await downscalePhoto(file));
      setError(null);
    } catch {
      setError("Could not read that photo. You can still save without AI outline.");
    }
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
        prompt,
        imageDataUrl: photo,
      });
      if (result.toy && result.sam.applied) {
        saveScannedToy({ ...result.toy, imageDataUrl: photo });
        setBusy(false);
        onClose();
        return;
      }
      setError(
        result.sam.status === "no-match"
          ? `Meta SAM 3.1 found no "${prompt}" in that photo. Try another chip or save without AI outline.`
          : result.sam.status === "not-configured"
            ? "Meta SAM 3.1 is not configured on this server yet. Save without AI outline below."
            : `Meta SAM 3.1 could not outline that photo${result.sam.message ? `: ${result.sam.message}` : ""}. Save without AI outline below.`,
      );
    } catch {
      setError("Meta SAM 3.1 request did not reach the server. Save without AI outline below.");
    }
    setBusy(false);
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
    await submitScan(toy, prompt);
    saveScannedToy(toy);
    setBusy(false);
    onClose();
  };

  const pickStarterBackup = (toyId: string) => {
    const found = backupToys.find((t) => t.id === toyId);
    if (found) {
      addToy(found);
      selectToy(found.id);
      onClose();
    }
  };

  return (
    <section
      className="tv-sheet"
      role="dialog"
      aria-label={step === "scan" ? "Scan Real Toy" : "My Toys"}
    >
      {step === "shelf" ? (
        <>
          <div className="tv-sh-top">
            <b className="tv-sh-title">My Toys</b>
            <button
              type="button"
              className="tv-ctl tv-ctl-primary"
              onClick={onClose}
            >
              Done
            </button>
          </div>

          <div className="tv-toy-shelf" role="listbox" aria-label="Owned toys">
            {orderedToys.map((toy) => {
              const isSelected = toy.id === selected?.id;
              const equippedCount = loadBuild(toy.id, partsById).length;
              const thumb = skinForToy(toy.id) ?? toy.imageDataUrl;
              const badge =
                toy.source === "scan"
                  ? "SAM"
                  : toy.imageDataUrl
                    ? "Photo"
                    : isSelected
                      ? "Active"
                      : null;
              return (
                <button
                  key={toy.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={isSelected ? "tv-toy-tile tv-toy-tile-on" : "tv-toy-tile"}
                  onClick={() => selectToy(toy.id)}
                >
                  {badge && (
                    <span
                      className={
                        badge === "Active"
                          ? "tv-toy-tag tv-toy-tag-gold"
                          : "tv-toy-tag"
                      }
                    >
                      {badge}
                    </span>
                  )}
                  <div className="tv-toy-thumb-box">
                    {thumb ? (
                      <img src={thumb} alt={toy.name} />
                    ) : (
                      <span aria-hidden="true" style={{ fontSize: 26 }}>
                        {glyphForToy(toy)}
                      </span>
                    )}
                  </div>
                  <span className="tv-toy-tile-name">{toy.name}</span>
                  <span className="tv-toy-tile-sub">
                    {equippedCount > 0
                      ? `${equippedCount} part${equippedCount === 1 ? "" : "s"} on`
                      : toy.source === "seed"
                        ? "Starter toy"
                        : `${toy.lengthMm} mm`}
                  </span>
                </button>
              );
            })}
          </div>

          {selected?.imageDataUrl && (
            <details className="tv-disclosure">
              <summary>
                <span>Paint photo skin (Meta Muse)</span>
                <span className="tv-disclosure-meta">4 styles</span>
              </summary>
              <SkinPanel
                key={selected.id}
                toy={selected}
                onSkinChange={onSkinChange}
              />
            </details>
          )}

          <button
            type="button"
            className="cta"
            style={{ margin: 0, minHeight: 50, fontSize: 16 }}
            onClick={() => {
              setError(null);
              setStep("scan");
            }}
          >
            Scan a Real Toy (Meta SAM 3.1)
          </button>
        </>
      ) : (
        <>
          <div className="tv-sh-top">
            <b className="tv-sh-title">Scan Real Toy</b>
            <button
              type="button"
              className="tv-ctl"
              onClick={() => setStep("shelf")}
            >
              My Toys
            </button>
          </div>

          <label className="scan-cam tv-scan-cam">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Toy photo"
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
                  style={{ position: "absolute", right: 8, bottom: 8 }}
                >
                  Retake
                </span>
              </>
            ) : (
              <>
                <div className="scan-reticle" style={{ width: 156, height: 62 }}>
                  Tap to snap toy photo
                </div>
                <span className="tv-moves">
                  Meta SAM 3.1 finds the outline automatically
                </span>
              </>
            )}
          </label>

          <div className="tv-chips" role="group" aria-label="Object type">
            {OBJECT_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="tv-sc"
                aria-pressed={chipId === chip.id}
                onClick={() => setChipId(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {chipId === "other" && (
            <input
              className="tv-input"
              value={customNoun}
              maxLength={32}
              placeholder="One-word object noun (e.g. dinosaur, train)"
              aria-label="Object noun"
              onChange={(e) => setCustomNoun(e.target.value)}
            />
          )}

          <div className="tv-scan-size-row">
            <input
              className="tv-input tv-grow"
              value={name}
              maxLength={48}
              placeholder="Toy name (optional)"
              aria-label="Toy name"
              onChange={(e) => setName(e.target.value)}
            />
            <div className="tv-seg" role="group" aria-label="Size preset">
              {SIZE_PRESETS.map((preset) => {
                const active =
                  Math.abs(lengthMm - preset.lengthMm) <= 12 &&
                  sizeClassForLength(preset.lengthMm) === sizeClass;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="tv-sc"
                    style={{ minWidth: 38, padding: "0 10px" }}
                    aria-pressed={active}
                    onClick={() => {
                      setLengthMm(preset.lengthMm);
                      setWidthMm(preset.widthMm);
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="tv-disclosure">
            <summary>
              <span>Exact size in mm</span>
              <span className="tv-disclosure-meta">
                {lengthMm}×{widthMm} mm ({sizeClass})
              </span>
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <label className="tv-moves" style={{ display: "block" }}>
                Longest side: <strong style={{ color: "var(--ink)" }}>{lengthMm} mm</strong>
                <input
                  type="range"
                  min={40}
                  max={300}
                  step={5}
                  value={lengthMm}
                  onChange={(e) => setLengthMm(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--sky-500)" }}
                />
              </label>
              <label className="tv-moves" style={{ display: "block" }}>
                Width: <strong style={{ color: "var(--ink)" }}>{widthMm} mm</strong>
                <input
                  type="range"
                  min={20}
                  max={200}
                  step={5}
                  value={widthMm}
                  onChange={(e) => setWidthMm(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--sky-500)" }}
                />
              </label>
            </div>
          </details>

          {error && <p className="error" style={{ margin: 0, fontSize: 13 }}>{error}</p>}

          <button
            type="button"
            className="cta"
            style={{ margin: 0, minHeight: 48, fontSize: 16 }}
            disabled={busy || !photo}
            onClick={outlineWithSam}
          >
            {busy
              ? "Outlining with Meta SAM 3.1..."
              : photo
                ? "Outline with Meta SAM 3.1"
                : "Snap a photo to outline with Meta SAM 3.1"}
          </button>

          <button
            type="button"
            className="cta cta-quiet"
            style={{ margin: 0, minHeight: 38, fontSize: 13 }}
            disabled={busy}
            onClick={saveManual}
          >
            Save without AI outline
          </button>

          <div className="tv-backup-strip">
            <span>No camera handy?</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {backupToys.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  className="tv-ctl"
                  style={{ minHeight: 32, padding: "0 9px", fontSize: 12 }}
                  onClick={() => pickStarterBackup(starter.id)}
                >
                  {starter.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
