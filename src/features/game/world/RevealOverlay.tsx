import { useEffect, useRef, useState } from "react";
import type { Placement } from "../../../../shared/build";
import { characterFromBuild, themeNotes } from "../../../../shared/reveal";
import type { Toy } from "../../../../shared/toy";
import { toyWorldUrl, type ToyContract } from "../../../../shared/toycontract";
import { partsById } from "../../../lib/catalog";
import { saveReveal } from "../../../state/reveals";
import { playTheme, type ThemeHandle } from "../../reveal/theme";

const THEME_DURATION_MS = 16 * 420; // 16 steps * 0.42s = 6.72s

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RevealOverlay({
  open,
  firstReveal,
  toy,
  placements,
  contract,
  onClose,
  onOpenBuild,
}: {
  open: boolean;
  firstReveal: boolean;
  toy: Toy;
  placements: Placement[];
  contract: ToyContract | null;
  onClose: () => void;
  onOpenBuild: () => void;
}) {
  if (!open) return null;
  return (
    <RevealOverlayInner
      firstReveal={firstReveal}
      toy={toy}
      placements={placements}
      contract={contract}
      onClose={onClose}
      onOpenBuild={onOpenBuild}
    />
  );
}

function RevealOverlayInner({
  firstReveal,
  toy,
  placements,
  contract,
  onClose,
  onOpenBuild,
}: {
  firstReveal: boolean;
  toy: Toy;
  placements: Placement[];
  contract: ToyContract | null;
  onClose: () => void;
  onOpenBuild: () => void;
}) {
  const handleRef = useRef<ThemeHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  const card =
    placements.length > 0
      ? characterFromBuild(toy, placements, partsById, todayISO())
      : null;

  const stopTheme = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
  };

  const startTheme = () => {
    if (!card) return;
    stopTheme();
    const handle = playTheme(themeNotes(card.signature));
    handleRef.current = handle;
    void handle.started.then((ok) => {
      setAudioBlocked(!ok);
      if (!ok) return;
      setPlaying(true);
      const startedAt = performance.now();
      setProgress(0);
      timerRef.current = window.setInterval(() => {
        const pct = Math.min(
          100,
          ((performance.now() - startedAt) / THEME_DURATION_MS) * 100,
        );
        setProgress(pct);
        if (pct >= 100) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setPlaying(false);
        }
      }, 60);
    });
  };

  useEffect(() => {
    if (!card) return;
    saveReveal(card);
    if (firstReveal) {
      startTheme();
    }
    return () => {
      stopTheme();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, firstReveal]);

  const copyShareLink = async () => {
    if (!contract) return;
    const url = toyWorldUrl(contract, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      window.location.hash = `toy=${url.split("#toy=")[1] ?? ""}`;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    }
  };

  return (
    <div
      className="tv-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Character Card"
    >
      <div className="tv-sh-top">
        <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
          {firstReveal ? "New Character Unlocked" : "Character Card"}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {card && (
            <button
              type="button"
              className="tv-ctl"
              onClick={playing ? stopTheme : startTheme}
            >
              {playing ? "Stop theme" : "Replay theme"}
            </button>
          )}
          <button
            type="button"
            className="tv-ctl"
            aria-label="Close Character Card"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {!card ? (
        <div className="tv-reveal-card reveal-enter">
          <div className="tv-sh-title" style={{ fontSize: 24 }}>
            {toy.name}
          </div>
          <p className="tv-moves" style={{ fontSize: 14 }}>
            Equip a printable part in Build to unlock {toy.name}&apos;s Character Card and 16-step entrance theme.
          </p>
          <button
            type="button"
            className="cta"
            style={{ margin: 0 }}
            onClick={() => {
              onClose();
              onOpenBuild();
            }}
          >
            Open Build
          </button>
        </div>
      ) : (
        <>
          <div className="tv-reveal-card reveal-enter">
            <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
              {toy.name} · Lead stat: {card.leadStat}
            </span>
            <h2 className="reveal-name" style={{ fontSize: 32 }}>
              {card.title}
            </h2>
            <p className="tv-moves" style={{ fontSize: 13 }}>
              {card.partNames.join(" + ")} · 16-step synth theme
              {audioBlocked ? " (tap Replay theme for sound)" : ""}
            </p>

            <div className="theme-progress" aria-hidden="true">
              <div
                className="theme-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(card.statTotals)
                .filter(([, val]) => (val ?? 0) > 0)
                .map(([stat, val]) => (
                  <div key={stat} className="stat-row">
                    <span className="stat-name">{stat}</span>
                    <div className="stat-track">
                      <div
                        className="stat-fill"
                        style={{
                          width: `${Math.min(100, (val ?? 0) * 18)}%`,
                          background: `var(--stat-${stat}, var(--sky-500))`,
                        }}
                      />
                    </div>
                    <span className="stat-val">+{val}</span>
                  </div>
                ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {contract && (
              <button
                type="button"
                className="cta"
                style={{ margin: 0, minHeight: 50, fontSize: 16 }}
                onClick={() => void copyShareLink()}
              >
                {copied ? "Copied #toy= Share Link!" : "Copy #toy= Share Link"}
              </button>
            )}
            <button
              type="button"
              className="cta cta-quiet"
              style={{ margin: 0, minHeight: 42, fontSize: 14 }}
              onClick={onClose}
            >
              Back to World
            </button>
          </div>
        </>
      )}
    </div>
  );
}
