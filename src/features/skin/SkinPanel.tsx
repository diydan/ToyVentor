import { useState } from "react";
import type { Toy } from "../../../shared/toy";
import { postSkin } from "../../lib/api";
import { clearSkin, saveSkin, skinForToy } from "../../state/skins";

const PRESETS = [
  "bold red racing stripes with a white number roundel",
  "green dragon scales with gold trim",
  "deep-space galaxy swirls with tiny stars",
  "bright rainbow colour blocks",
];

export function SkinPanel({ toy }: { toy: Toy }) {
  const [skin, setSkin] = useState<string | undefined>(() => skinForToy(toy.id));
  const [style, setStyle] = useState(PRESETS[0]!);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!toy.imageDataUrl) {
    return (
      <>
        <h2>Skin</h2>
        <p>Skins repaint a toy's photo, so this one needs a scan photo first. Built-in starter toys can't be skinned yet.</p>
      </>
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
            ? "Skin generation isn't configured on the server yet."
            : `Skin didn't come back${result.skin.message ? `: ${result.skin.message}` : ""}. Try again.`,
        );
      }
    } catch {
      setNote("Skin didn't reach the server. Try again.");
    }
    setBusy(false);
  };

  const remove = () => {
    clearSkin(toy.id);
    setSkin(undefined);
  };

  return (
    <>
      <h2>Skin</h2>
      <img
        className="toy-thumb"
        src={skin ?? toy.imageDataUrl}
        alt={skin ? `${toy.name} with its skin on` : toy.name}
      />
      <label className="field">
        Style
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Or describe your own
        <input
          value={PRESETS.includes(style) ? "" : style}
          placeholder="e.g. shiny gold with black spots"
          maxLength={140}
          onChange={(e) => setStyle(e.target.value || PRESETS[0]!)}
        />
      </label>
      {note && <p className="error">{note}</p>}
      <button type="button" className="cta" disabled={busy} onClick={make}>
        {busy ? "Painting (can take ~20s)…" : skin ? "Make a new skin" : "Make a skin with Muse Image"}
      </button>
      {skin && (
        <button type="button" className="cta cta-quiet" onClick={remove}>
          Back to the original photo
        </button>
      )}
    </>
  );
}
