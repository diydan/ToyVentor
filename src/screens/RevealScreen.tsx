import { useEffect, useRef, useState } from "react";
import { characterFromBuild, themeNotes } from "../../shared/reveal";
import { colorOf } from "../features/builder/engine/render";
import { playTheme, type ThemeHandle } from "../features/reveal/theme";
import { loadBuild } from "../lib/builds";
import { partsById } from "../lib/catalog";
import { saveReveal } from "../state/reveals";
import { skinForToy } from "../state/skins";
import { useToybox } from "../state/toybox";

const THEME_DURATION_MS = 16 * 420;

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
  onPlay,
}: {
  firstReveal: boolean;
  onBack: () => void;
  onPlay?: () => void;
}) {
  const { selected: toy } = useToybox();
  const handleRef = useRef<ThemeHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [progress, setProgress] = useState(0);

  const placements = toy ? loadBuild(toy.id, partsById) : [];
  const card =
    toy && placements.length > 0
      ? characterFromBuild(toy, placements, partsById, todayISO())
      : null;

  const stopProgress = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const play = () => {
    if (!card) return;
    handleRef.current?.stop();
    stopProgress();
    const handle = playTheme(themeNotes(card.signature));
    handleRef.current = handle;
    void handle.started.then((ok) => {
      setAudioBlocked(!ok);
      if (!ok) {
        setProgress(0);
        return;
      }
      const startedAt = performance.now();
      setProgress(4);
      timerRef.current = window.setInterval(() => {
        const pct = Math.min(
          100,
          ((performance.now() - startedAt) / THEME_DURATION_MS) * 100,
        );
        setProgress(pct);
        if (pct >= 100) stopProgress();
      }, 100);
    });
  };

  useEffect(() => {
    if (!card) return;
    saveReveal(card);
    if (firstReveal) play();
    return () => {
      stopProgress();
      handleRef.current?.stop();
    };
    // Play once on mount for a genuine first reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);

  if (!toy || !card) {
    return (
      <section>
        <header className="screen-head">
          <h1 className="screen-title">Reveal</h1>
          <button type="button" className="tv-ctl" onClick={onBack}>
            Back
          </button>
        </header>
        <div className="glass-card">
          <p style={{ marginTop: 0 }}>
            Finish a build in Augment and its character card lands here.
          </p>
          <button type="button" className="cta" onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const leadPart = placements[0]
    ? partsById.get(placements[0].partId)
    : undefined;
  const heroArt = skinForToy(toy.id) ?? toy.imageDataUrl;
  const statEntries = Object.entries(card.statTotals).filter(
    ([, v]) => (v ?? 0) > 0,
  );

  return (
    <section>
      <div className={firstReveal ? "reveal-hero reveal-enter" : "reveal-hero"}>
        <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
          {firstReveal ? "New character unlocked" : "Saved character card"}
        </span>
        <h1 className="reveal-name">{card.title}</h1>

        <div className="reveal-stage">
          {heroArt && (
            <img
              className="toy-thumb"
              src={heroArt}
              alt={card.title}
              style={{ maxHeight: 150, margin: 0 }}
            />
          )}
          <span className="part-meta" style={{ margin: 0 }}>
            <strong>{card.leadStat.toUpperCase()}</strong> build · revealed{" "}
            {card.revealedOn}
          </span>
        </div>

        <div style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            <span>Entrance theme</span>
            <span>{progress > 0 && progress < 100 ? "Playing..." : "16-step synth"}</span>
          </div>
          <div className="theme-progress">
            <div
              className="theme-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ marginTop: 12, marginBottom: 12 }}>
        <div className="kv-row">
          <span>Base toy</span>
          <span>{toy.name}</span>
        </div>
        <div className="kv-row">
          <span>Equipped parts</span>
          <span>{card.partNames.join(", ")}</span>
        </div>
        {leadPart && (
          <div className="kv-row">
            <span>Signature part</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                className="tv-opt-dot"
                style={{ background: colorOf(leadPart) }}
                aria-hidden="true"
              />
              {leadPart.name}
            </span>
          </div>
        )}

        {statEntries.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {statEntries.map(([name, val]) => (
              <div key={name} className="stat-row">
                <span className="stat-name">{name}</span>
                <div className="stat-track">
                  <div
                    className="stat-fill"
                    style={{
                      width: `${Math.min(100, (val ?? 0) * 16)}%`,
                      background: `var(--stat-${name}, var(--sky-500))`,
                    }}
                  />
                </div>
                <span className="stat-val">+{val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="cta" onClick={play}>
        {audioBlocked ? "Tap to play entrance theme" : "Play theme again"}
      </button>

      {onPlay && (
        <button type="button" className="cta cta-violet" onClick={onPlay}>
          Play in ToyVentor World
        </button>
      )}

      <button type="button" className="cta cta-quiet" onClick={onBack}>
        Save & back
      </button>
    </section>
  );
}
