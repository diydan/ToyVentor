// The end-of-level song card: an offer ("Make a song about it"), then the song being made (its name and words), then the dance party (docs/specs/dance-party-spec.md;
// Dan, 2026-11-03). It owns no logic: themeSongFlow.ts decides every step, GameCanvas wires it to the engine. All its buttons are at least 56 px, for small hands.
//
// TWO SIZES (Dan, 2026-11-04: "the player needs stop and play, ideally a mini karaoke, and when closed 'docked' rethink: it works great, just an awkward UX"):
//   the CARD  the whole thing: name, words, what is happening, every button. It is what a child sees while the song is written and when the party is over.
//   the DOCK  a slim player along the bottom while a song is being made or a party is on: Pause/Play, Stop, the name and the line being sung (the mini karaoke), and a tap to open
//             the card. It does not cover the dancer. A party docks itself when it starts; a new song opens the card; it is the child's choice after that.
import { useEffect, useRef, useState } from "react";
import type { FlowState } from "./themeSongFlow";
import { waitProgress, waitStage } from "./songWait";
import { karaokeAt, type KaraokeView } from "../../../../shared/songKaraoke";

export interface ThemeSongCardProps {
  /** The offer after a win: the card shows a button that starts the song. Null when nothing is offered. */
  offer: boolean;
  /** The flow's state once a song was started; null or idle shows the offer (if any). */
  flow: FlowState | null;
  onMake(): void;
  onDismissOffer(): void;
  onStopParty(): void;
  /** Hold the party where it is, and carry on from the same spot. */
  onPause(): void;
  onResume(): void;
  /** Where the listener is in the song, in seconds (counting on across loops, still while paused): read a few times a second for the karaoke. */
  playhead(): number;
  onAgain(): void;
  /** Ask for NEW words (a fresh song). Shown only while a song is left this week. */
  onNewWords(): void;
  onClose(): void;
}

/**
 * The waiting display while a song is written and sung: bouncing bars, music notes drifting up, a bar that eases towards done (and only fills when the song is ready) and a line that
 * changes every few seconds. Decoration only (aria-hidden): the card's own note is the live text. Every animation is CSS and stops for prefers-reduced-motion.
 */
function SongWait({ seconds, done }: { seconds: number; done: boolean }) {
  const pct = Math.round(waitProgress(seconds, done) * 100);
  return (
    <div className={`tv-song-wait${done ? " tv-song-wait-done" : ""}`} aria-hidden="true" data-testid="song-wait">
      <div className="tv-song-notes">
        <span>♪</span>
        <span>♫</span>
        <span>♪</span>
        <span>♬</span>
      </div>
      <div className="tv-song-eq">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <i key={i} style={{ animationDelay: `${-i * 0.17}s`, animationDuration: `${0.55 + ((i * 37) % 5) * 0.09}s` }} />
        ))}
      </div>
      <div className="tv-song-bar" role="presentation">
        <div className="tv-song-bar-fill" style={{ width: `${pct}%` }} data-pct={pct} />
      </div>
      <p className="tv-song-stage" key={done ? "done" : waitStage(seconds)}>
        {done ? "Here it comes!" : waitStage(seconds)}
      </p>
    </div>
  );
}

/**
 * The mini karaoke: the line being sung, its words lighting up as they are sung, and (in the big form) the line before and the line coming. The times are the song's own, moved onto
 * the loop the party plays (shared/songKaraoke.ts). Redraws only when the lit word or the line changes, not on every look. Decoration beside "The words": aria-hidden.
 */
function Karaoke({ lines, loop, playhead, big }: { lines: FlowState["karaoke"]; loop: number; playhead: () => number; big: boolean }) {
  const [view, setView] = useState<KaraokeView>(() => karaokeAt(lines, playhead(), loop));
  const seen = useRef("");
  useEffect(() => {
    const look = () => {
      const v = karaokeAt(lines, playhead(), loop);
      const k = `${v.index}:${v.lit}:${v.next?.at ?? "-"}:${v.prev?.at ?? "-"}`;
      if (k !== seen.current) { seen.current = k; setView(v); }
    };
    look();
    const id = window.setInterval(look, 90);
    return () => window.clearInterval(id);
  }, [lines, loop, playhead]);
  return (
    <div className={`tv-kara${big ? " tv-kara-big" : ""}`} aria-hidden="true" data-testid="song-karaoke">
      {big && <p className="tv-kara-side">{view.line ? view.prev?.text ?? "\u00a0" : "\u00a0"}</p>}
      {view.line ? (
        <p className="tv-kara-line" key={view.index} data-line={view.index} data-lit={view.lit}>
          {view.line.words.map((w, i) => (
            <span key={i} className={i < view.lit ? "on" : ""}>{w.t}{" "}</span>
          ))}
        </p>
      ) : (
        <p className="tv-kara-line tv-kara-gap" data-line="-1">
          ♪ {view.next ? view.next.text : "♪ ♪"}
        </p>
      )}
      {big && <p className="tv-kara-side">{view.line ? view.next?.text ?? "\u00a0" : "\u00a0"}</p>}
    </div>
  );
}

export function ThemeSongCard({ offer, flow, onMake, onDismissOffer, onStopParty, onPause, onResume, playhead, onAgain, onNewWords, onClose }: ThemeSongCardProps) {
  const fallback = useRef<HTMLAudioElement | null>(null);
  const phase = flow?.phase ?? "idle";
  useEffect(() => () => { fallback.current?.pause(); fallback.current = null; }, []);

  // seconds since this song began (the card is mounted all game long, so it restarts its own clock when a new song starts writing)
  const startedAt = useRef(0);
  const [seconds, setSeconds] = useState(0);
  // "ready" is also where a song ends up that cannot dance (a plain link, or a party that did not start): the display only plays while the song is really being got ready
  const preparing = phase === "ready" && !!flow && !flow.fallbackUrl && /Getting the party ready/.test(flow.note);
  const waiting = phase === "writing" || phase === "making" || preparing;
  useEffect(() => {
    if (phase === "writing") { startedAt.current = Date.now(); setSeconds(0); }
  }, [phase]);
  // the dock: a party docks itself when it starts (the dancer is the show), and the card opens again for a new song, a finished party, or something that went wrong
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (phase === "dancing") setDocked(true);
    else if (phase === "writing" || phase === "over" || phase === "failed" || (phase === "ready" && !preparing)) setDocked(false);
  }, [phase, preparing]);
  useEffect(() => {
    if (!waiting) return;
    if (!startedAt.current) startedAt.current = Date.now();
    const id = window.setInterval(() => setSeconds((Date.now() - startedAt.current) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);

  // a song that cannot dance plays as a plain song: one button that plays it and stops it
  const [plainOn, setPlainOn] = useState(false);
  const playPlain = () => {
    if (!flow?.fallbackUrl) return;
    if (fallback.current) { fallback.current.pause(); fallback.current = null; setPlainOn(false); return; }
    const a = new Audio(flow.fallbackUrl);
    fallback.current = a;
    setPlainOn(true);
    a.addEventListener("ended", () => { fallback.current = null; setPlainOn(false); });
    void a.play().catch(() => { fallback.current = null; setPlainOn(false); });
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
  // new words are a fresh song, so only while one is left this week. Not while a song is being made: that one is already ordered (and counted), and a second would spend another
  // slot of the week to throw the first away. Offered once the song is ready, while it plays, and after it.
  const canRedo = (phase === "dancing" || phase === "over" || phase === "failed" || (phase === "ready" && !preparing)) && Boolean(f.name) && (f.quota === null || f.quota.left > 0);
  const hasKaraoke = f.karaoke.length > 0 && f.loop > 0;
  const showWords = (f.verse.length > 0 || f.chorus.length > 0) && !(phase === "dancing" && hasKaraoke);
  const canDock = waiting || phase === "dancing";

  if (docked && canDock) {
    return (
      <div className={`tv-song-card tv-song-docked tv-song-${phase}`} role="group" aria-label="Your song player" data-testid="song-card" data-phase={phase} data-docked="true">
        {phase === "dancing" ? (
          <>
            {f.paused ? (
              <button type="button" className="tv-dock-btn tv-song-primary" aria-label="Play" onClick={onResume} data-testid="song-play">▶</button>
            ) : (
              <button type="button" className="tv-dock-btn tv-song-primary" aria-label="Pause" onClick={onPause} data-testid="song-pause">⏸</button>
            )}
            <button type="button" className="tv-dock-btn" aria-label="Stop the party" onClick={onStopParty} data-testid="song-stop">⏹</button>
          </>
        ) : (
          <span className="tv-dock-icon" aria-hidden="true">🎵</span>
        )}
        <div className="tv-dock-mid">
          <p className="tv-dock-name">{f.name || "Thinking of a name…"}</p>
          {phase === "dancing" && hasKaraoke ? (
            <Karaoke lines={f.karaoke} loop={f.loop} playhead={playhead} big={false} />
          ) : waiting ? (
            <>
              <p className="tv-dock-line" role="status" aria-live="polite">{preparing ? "Here it comes!" : waitStage(seconds)}</p>
              <div className="tv-song-bar tv-dock-bar" role="presentation">
                <div className="tv-song-bar-fill" style={{ width: `${Math.round(waitProgress(seconds, preparing) * 100)}%` }} />
              </div>
            </>
          ) : (
            <p className="tv-dock-line" role="status" aria-live="polite">{f.note}</p>
          )}
        </div>
        <button type="button" className="tv-dock-open" aria-label="Open the song card" onClick={() => setDocked(false)} data-testid="song-open">⌃</button>
      </div>
    );
  }
  return (
    <div className={`tv-song-card tv-song-${phase}`} role="group" aria-label="Your song" data-testid="song-card" data-phase={phase}>
      <div className="tv-song-head">
        <span className="tv-song-label">{phase === "dancing" ? "🎉 Dance party" : "🎵 Your song"}</span>
        <span className="tv-song-ai">Made by AI</span>
        {canDock && (
          <button type="button" className="tv-song-dockbtn" aria-label="Tuck the song card away" onClick={() => setDocked(true)} data-testid="song-dock">
            ⌄
          </button>
        )}
      </div>
      {f.name ? (
        <p className="tv-song-name" key={f.name}>{f.name}</p>
      ) : (
        <p className="tv-song-name tv-song-name-wait" aria-label="Thinking of a name">
          <span className="tv-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      )}
      <p className="tv-song-note" role="status" aria-live="polite">{f.note}</p>
      {waiting && <SongWait seconds={seconds} done={preparing} />}
      {phase === "dancing" && hasKaraoke && <Karaoke lines={f.karaoke} loop={f.loop} playhead={playhead} big />}
      {showWords && phase !== "dancing" && (
        <details className="tv-song-words">
          <summary>The words</summary>
          <p>{[...f.verse, "", ...f.chorus].join("\n")}</p>
        </details>
      )}
      <div className="tv-song-row">
        {phase === "dancing" && (
          f.paused ? (
            <button type="button" className="tv-song-btn tv-song-primary" onClick={onResume} data-testid="song-play">
              ▶ Play
            </button>
          ) : (
            <button type="button" className="tv-song-btn tv-song-primary" onClick={onPause} data-testid="song-pause">
              ⏸ Pause
            </button>
          )
        )}
        {phase === "dancing" && (
          <button type="button" className="tv-song-btn" onClick={onStopParty} data-testid="song-stop">
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
            {plainOn ? "⏹ Stop" : "▶ Play your song"}
          </button>
        )}
        {canRedo && (
          <button type="button" className="tv-song-btn" onClick={onNewWords} data-testid="song-new-words">
            🔄 New words{f.quota && f.quota.left > 0 ? ` · ${f.quota.left} left` : ""}
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
