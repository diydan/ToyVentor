import { useState } from "react";
import type { Toy } from "../../../shared/toy";
import { postSkin } from "../../lib/api";
import { clearSkin, saveSkin, skinForToy } from "../../state/skins";

const PRESETS = [
  { label: "Racer red", prompt: "bold red racing stripes with a white number roundel" },
  { label: "Dragon scales", prompt: "green dragon scales with gold trim" },
  { label: "Galaxy", prompt: "deep-space galaxy swirls with tiny stars" },
  { label: "Rainbow", prompt: "bright rainbow colour blocks" },
];

export function SkinPanel({
  toy,
  onSkinChange,
}: {
  toy: Toy;
  onSkinChange?: () => void;
}) {
  const [skin, setSkin] = useState<string | undefined>(() => skinForToy(toy.id));
  const [style, setStyle] = useState(PRESETS[0]!.prompt);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!toy.imageDataUrl) return null;

  const make = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await postSkin(toy.imageDataUrl!, style);
      if (result.imageDataUrl) {
        saveSkin(toy.id, result.imageDataUrl);
        setSkin(result.imageDataUrl);
        onSkinChange?.();
      } else {
        setNote(
          result.skin.status === "not-configured"
            ? "Meta Muse skin painting is not configured on this server yet."
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
    onSkinChange?.();
  };

  const isCustom = !PRESETS.some((p) => p.prompt === style);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <img
        className="toy-thumb"
        src={skin ?? toy.imageDataUrl}
        alt={skin ? `${toy.name} with painted skin` : toy.name}
        style={{ margin: 0, maxHeight: 132 }}
      />

      <div className="pill-row" role="group" aria-label="Skin presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={style === p.prompt ? "pill-chip pill-chip-on" : "pill-chip"}
            onClick={() => setStyle(p.prompt)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <input
        className="tv-input"
        value={isCustom ? style : ""}
        placeholder="Or describe your own look (e.g. shiny gold bolts)"
        aria-label="Custom skin style"
        maxLength={140}
        onChange={(e) => setStyle(e.target.value || PRESETS[0]!.prompt)}
      />

      {note && <p className="error" style={{ margin: 0, fontSize: 13 }}>{note}</p>}

      <button
        type="button"
        className="cta cta-violet"
        style={{ margin: 0, minHeight: 44, fontSize: 15 }}
        disabled={busy}
        onClick={make}
      >
        {busy
          ? "Painting with Meta Muse..."
          : skin
            ? "Paint a new skin (Meta Muse)"
            : "Paint skin with Meta Muse"}
      </button>

      {skin && (
        <button
          type="button"
          className="cta cta-quiet"
          style={{ margin: 0, minHeight: 38, fontSize: 13 }}
          onClick={remove}
        >
          Back to original photo
        </button>
      )}
    </div>
  );
}
