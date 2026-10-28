import { useEffect, useRef, useState } from "react";
import baseSetJson from "../../sets/base.json";
import type { Placement } from "../../shared/build";
import { characterFromBuild, themeNotes } from "../../shared/reveal";
import type { ToySet } from "../../shared/part";
import { colorOf } from "../features/builder/engine/render";
import { playTheme, type ThemeHandle } from "../features/reveal/theme";
import { saveReveal } from "../state/reveals";
import { useToybox } from "../state/toybox";

const partsById = new Map((baseSetJson as ToySet).parts.map((p) => [p.id, p]));

function loadBuild(toyId: string): Placement[] {
  try {
    const raw = localStorage.getItem(`toyforge:build:v1:${toyId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Placement[]) : [];
  } catch {
    return [];
  }
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The Reveal: entrance moment + character card. Spec rule: plays the
 * theme automatically exactly once per build, then saves. Reopening a
 * saved character shows the card with a manual replay button.
 */
export function RevealScreen({
  firstReveal,
  onBack,
}: {
  firstReveal: boolean;
  onBack: () => void;
}) {
  const { selected: toy } = useToybox();
  const handleRef = useRef<ThemeHandle | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const placements = toy ? loadBuild(toy.id) : [];
  const card = toy && placements.length > 0
    ? characterFromBuild(toy, placements, partsById, todayISO())
    : null;

  const play = () => {
    if (!card) return;
    handleRef.current?.stop();
    const handle = playTheme(themeNotes(card.signature));
    handleRef.current = handle;
    void handle.started.then((ok) => setAudioBlocked(!ok));
  };

  useEffect(() => {
    if (!card) return;
    saveReveal(card);
    if (firstReveal) play();
    return () => handleRef.current?.stop();
    // Play once on mount for a genuine first reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);

  if (!toy || !card) {
    return (
      <section>
        <h1>Reveal</h1>
        <p>Finish a build in Augment and its character lands here.</p>
        <button type="button" className="cta" onClick={onBack}>Back</button>
      </section>
    );
  }

  const leadPart = placements[0] ? partsById.get(placements[0].partId) : undefined;

  return (
    <section>
      <h1>{firstReveal ? "A new character!" : "Character card"}</h1>
      <article className={firstReveal ? "reveal-card reveal-enter" : "reveal-card"}>
        {toy.imageDataUrl && <img className="toy-thumb" src={toy.imageDataUrl} alt={toy.name} />}
        <h2>{card.title}</h2>
        <p>
          <strong>{card.leadStat}</strong> build · revealed {card.revealedOn}
        </p>
        <p>Parts: {card.partNames.join(", ")}</p>
        <p>
          Stats:{" "}
          {Object.entries(card.statTotals).map(([k, v]) => `${k} +${v}`).join(", ")}
        </p>
        {leadPart && (
          <p>
            <span className="tray-swatch" style={{ background: colorOf(leadPart), display: "inline-block" }} aria-hidden="true" />{" "}
            Signature part: {leadPart.name}
          </p>
        )}
      </article>
      <button type="button" className="cta" onClick={play}>
        {audioBlocked ? "Tap to play the theme" : "Play theme again"}
      </button>
      <p className="fine-print">
        Theme is a synth placeholder generated from this build, until
        Mureka themes are wired. The card is saved in your Toybox.
      </p>
      <button type="button" className="cta cta-quiet" onClick={onBack}>Back</button>
    </section>
  );
}
