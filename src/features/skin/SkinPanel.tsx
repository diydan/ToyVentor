import { useState } from "react";
import type { Toy } from "../../../shared/toy";
import { postSkin } from "../../lib/api";
import { clearSkin, saveSkin, skinForToy } from "../../state/skins";

const PRESETS = [
  { label: "Racer red", prompt: "bold red racing stripes with a white number roundel" },
  { label: "Dragon scales", prompt: "green dragon scales with gold trim" },
  { label: "Galaxy stars", prompt: "deep-space galaxy swirls with tiny stars" },
  { label: "Color blocks", prompt: "bright rainbow colour blocks" },
];

export function SkinPanel({ toy }: { toy: Toy }) {
  const [skin, setSkin] = useState<string | undefined>(() => skinForToy(toy.id));
  const [style, setStyle] = useState(PRESETS[0]!.prompt);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!toy.imageDataUrl) {
    return (
      <div className="glass-card" style={{ marginTop: 12 }}>
        <span className="kicker-label">Muse Image skin</span>
        <p className="fine-print" style={{ margin: 0 }}>
          Skins repaint a scanned photo. Scan a real toy first to paint custom skins on it.
        </p>
      </div>
    );
  }

  const make = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await postSkin(toy.imageDataUrl!, style);
      if (result.imageDataUrl) {
        saveSkin(toy.id, result.imageDataUrl);
        setSkin(result.imageDataUrl);
      } else {
        setNote(
          result.skin.status === "not-configured"
            ? "Skin generation is not configured on the server yet."
            : `Skin did not come back${result.skin.message ? `: ${result.skin.message}` : ""}. Try again.`,
        );
      }
    } catch {
      setNote("Skin request did not reach the server. Try again.");
    }
    setBusy(false);
  };

  const remove = () => {
    clearSkin(toy.id);
    setSkin(undefined);
  };

  const isCustom = !PRESETS.some((p) => p.prompt === style);

  return (
    <div className="glass-card" style={{ marginTop: 12 }}>
      <span className="kicker-label">Muse Image skin</span>
      <img
        className="toy-thumb"
        src={skin ?? toy.imageDataUrl}
        alt={skin ? `${toy.name} with its skin on` : toy.name}
        style={{ marginTop: 4 }}
      />

      <div className="pill-row" role="group" aria-label="Skin presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={
              style === p.prompt ? "pill-chip pill-chip-on" : "pill-chip"
            }
            onClick={() => setStyle(p.prompt)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="field" style={{ margin: "10px 0" }}>
        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
          Or describe your own look
        </span>
        <input
          value={isCustom ? style : ""}
          placeholder="e.g. shiny gold with lightning bolts"
          maxLength={140}
          onChange={(e) => setStyle(e.target.value || PRESETS[0]!.prompt)}
        />
      </label>

      {note && <p className="error">{note}</p>}

      <button
        type="button"
        className="cta cta-violet"
        style={{ marginBottom: skin ? 8 : 0 }}
        disabled={busy}
        onClick={make}
      >
        {busy
          ? "Painting with Muse Image (~20s)..."
          : skin
            ? "Paint a new skin"
            : "Paint skin with Muse Image"}
      </button>

      {skin && (
        <button
          type="button"
          className="cta cta-quiet"
          style={{ margin: 0, minHeight: 44 }}
          onClick={remove}
        >
          Back to original photo
        </button>
      )}
    </div>
  );
}
