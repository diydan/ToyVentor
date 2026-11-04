// The Map's Songs sheet: make a song from an IDEA (tap one of the ideas, or type a few words), and dance to the songs already made (docs/specs/dance-party-spec.md; Dan, 2026-11-03).
// It owns no logic. A tap on "Make my song" or "Dance" hands the choice to GameCanvas, which closes the Map and lets the same card and dance party as the end-of-level flow take over
// (themeSongFlow.ts). The ideas are a short closed list so a child who cannot type yet can still make a song; a typed idea is short and is screened by the route before any model sees it.
import { useState } from "react";
import type { KeptSong, SongQuota } from "./themeSongFlow";

/** The ideas a child can tap. Kind, simple and drawn from a small child's day. A tap fills the box, so it can still be changed. */
export const SONG_IDEAS: readonly { emoji: string; text: string }[] = [
  { emoji: "🐱", text: "a sleepy cat" },
  { emoji: "🚀", text: "a rocket to the moon" },
  { emoji: "🌧️", text: "a rainy day" },
  { emoji: "🥞", text: "making pancakes" },
  { emoji: "🧹", text: "tidying up" },
  { emoji: "🐸", text: "a hopping frog" },
];
export const MAX_IDEA_CHARS = 60;

export interface SongStudioSheetProps {
  /** Songs kept in this browser, newest first. */
  songs: readonly KeptSong[];
  /** `null` while the route has not answered yet, `false` when it is off or cannot be reached (the sheet says so kindly and offers nothing to make). */
  available: boolean | null;
  /** What this device has left this week, once the route has said (null: unknown, or the route is not metered). */
  quota?: SongQuota | null;
  onMake(idea: string): void;
  onDance(song: KeptSong): void;
  onClose(): void;
}

/**
 * What the sheet shows above the songs: `checking` while the route has not answered yet (it must NOT say "resting" then: nobody has said songs are off), `resting` when the route
 * says they are off (or cannot be reached), `blocked` when it is on but a grown-up switched songs off or the week is used up, and `open` when a song can be made.
 */
export type SheetMode = "checking" | "resting" | "blocked" | "open";
export function sheetMode(available: boolean | null, quota: SongQuota | null | undefined): { mode: SheetMode; text: string } {
  if (available === null) return { mode: "checking", text: "Checking the song studio…" };
  if (!available) return { mode: "resting", text: "Song making is resting right now. The songs you already made can still dance!" };
  const q = quotaLine(quota);
  return { mode: q.blocked ? "blocked" : "open", text: q.text };
}

/** The sentence about the week: how many songs are left, when they come back, or that a grown-up switched songs off. */
export function quotaLine(q: SongQuota | null | undefined): { text: string; blocked: boolean } {
  if (!q) return { text: "Songs are made by AI and take about a minute.", blocked: false };
  if (!q.makerOn) return { text: "Songs are switched off by a grown-up. The songs you already made can still dance!", blocked: true };
  if (q.left <= 0) return { text: "No new songs until tomorrow. Dance to the ones you made!", blocked: true };
  return { text: `${"🎵".repeat(q.left)} ${q.left} new song${q.left === 1 ? "" : "s"} left today. Songs are made by AI and take about a minute.`, blocked: false };
}

export function SongStudioSheet({ songs, available, quota, onMake, onDance, onClose }: SongStudioSheetProps) {
  const [idea, setIdea] = useState("");
  const text = idea.trim();
  const view = sheetMode(available, quota);
  return (
    <section className="tv-sheet tv-sheet-songs" role="region" aria-label="Songs" data-testid="songs-sheet">
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Music</span>
          <b className="tv-sh-title">🎵 Songs</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Back
        </button>
      </div>

      {view.mode === "open" ? (
        <>
          <p className="tv-songs-lead">What is your song about?</p>
          <div className="tv-songs-ideas" role="group" aria-label="Ideas">
            {SONG_IDEAS.map((i) => (
              <button
                key={i.text}
                type="button"
                className={`tv-songs-idea${idea === i.text ? " on" : ""}`}
                aria-pressed={idea === i.text}
                onClick={() => setIdea(i.text)}
              >
                <span aria-hidden="true">{i.emoji}</span> {i.text}
              </button>
            ))}
          </div>
          <label className="tv-songs-field">
            <span className="tv-songs-label">Or say your own idea</span>
            <input
              type="text"
              className="tv-songs-input"
              value={idea}
              maxLength={MAX_IDEA_CHARS}
              placeholder="a song about…"
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation(); // typing here must not move the toy
                if (e.key === "Enter" && text) onMake(text);
              }}
              onKeyUp={(e) => e.stopPropagation()}
            />
          </label>
          <button type="button" className="tv-songs-make" disabled={!text} onClick={() => text && onMake(text)}>
            🎵 Make my song
          </button>
          <p className="tv-songs-note">{view.text}</p>
        </>
      ) : (
        <p className="tv-songs-lead" role="status" data-mode={view.mode}>
          {view.text}
        </p>
      )}

      <div className="tv-songs-mine" role="group" aria-label="My songs">
        <b className="tv-songs-h">My songs</b>
        {songs.length === 0 ? (
          <p className="tv-songs-empty">No songs yet. Make one, or win a level!</p>
        ) : (
          <ul className="tv-songs-list">
            {songs.map((s) => (
              <li key={s.task} className="tv-songs-item">
                <span className="tv-songs-name">{s.name}</span>
                <button type="button" className="tv-songs-dance" aria-label={`Dance to ${s.name}`} onClick={() => onDance(s)}>
                  🎉 Dance
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
