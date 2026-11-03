// The end-of-level song card: an offer ("Make a song about it"), then the song being made (its name and words), then the dance party (docs/specs/dance-party-spec.md;
// Dan, 2026-11-03). It owns no logic: themeSongFlow.ts decides every step, GameCanvas wires it to the engine. All its buttons are at least 56 px, for small hands.
import { useEffect, useRef } from "react";
import type { FlowState } from "./themeSongFlow";

export interface ThemeSongCardProps {
  /** The offer after a win: the card shows a button that starts the song. Null when nothing is offered. */
  offer: boolean;
  /** The flow's state once a song was started; null or idle shows the offer (if any). */
  flow: FlowState | null;
  onMake(): void;
  onDismissOffer(): void;
  onStopParty(): void;
  onAgain(): void;
  onClose(): void;
}

export function ThemeSongCard({ offer, flow, onMake, onDismissOffer, onStopParty, onAgain, onClose }: ThemeSongCardProps) {
  const fallback = useRef<HTMLAudioElement | null>(null);
  const phase = flow?.phase ?? "idle";
  useEffect(() => () => { fallback.current?.pause(); fallback.current = null; }, []);

  const playPlain = () => {
    if (!flow?.fallbackUrl) return;
    if (fallback.current) { fallback.current.pause(); fallback.current = null; return; }
    const a = new Audio(flow.fallbackUrl);
    fallback.current = a;
    a.addEventListener("ended", () => { fallback.current = null; });
    void a.play().catch(() => { fallback.current = null; });
  };

  if (phase === "idle") {
    if (!offer) return null;
    return (
      <div className="tv-song-card tv-song-offer" role="group" aria-label="Make a song about it" data-testid="song-offer">
        <button type="button" className="tv-song-make" onClick={onMake}>
          <span aria-hidden="true">🎵</span> Make a song about it
        </button>
        <button type="button" className="tv-song-x" aria-label="No thanks" onClick={onDismissOffer}>
          ✕
        </button>
      </div>
    );
  }

  const f = flow!;
  const showWords = f.verse.length > 0 || f.chorus.length > 0;
  return (
    <div className={`tv-song-card tv-song-${phase}`} role="group" aria-label="Your song" data-testid="song-card" data-phase={phase}>
      <div className="tv-song-head">
        <span className="tv-song-label">{phase === "dancing" ? "🎉 Dance party" : "🎵 Your song"}</span>
        <span className="tv-song-ai">Made by AI</span>
      </div>
      <p className="tv-song-name">{f.name || "…"}</p>
      <p className="tv-song-note" role="status" aria-live="polite">{f.note}</p>
      {showWords && phase !== "dancing" && (
        <details className="tv-song-words">
          <summary>The words</summary>
          <p>{[...f.verse, "", ...f.chorus].join("\n")}</p>
        </details>
      )}
      <div className="tv-song-row">
        {phase === "dancing" && (
          <button type="button" className="tv-song-btn" onClick={onStopParty}>
            ⏹ Stop the party
          </button>
        )}
        {phase === "over" && (
          <button type="button" className="tv-song-btn tv-song-primary" onClick={onAgain}>
            🎉 Dance again
          </button>
        )}
        {f.fallbackUrl && (
          <button type="button" className="tv-song-btn tv-song-primary" onClick={playPlain}>
            ▶ Play your song
          </button>
        )}
        {(phase === "over" || phase === "failed" || phase === "ready") && (
          <button type="button" className="tv-song-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
