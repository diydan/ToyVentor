// The Map's Songs sheet: make a song from an IDEA (tap one of the ideas, or type a few words), and dance to the songs already made (docs/specs/dance-party-spec.md; Dan, 2026-11-03).
// It owns no logic. A tap on "Make my song" or "Dance" hands the choice to GameCanvas, which closes the Map and lets the same card and dance party as the end-of-level flow take over
// (themeSongFlow.ts). The ideas are a short closed list so a child who cannot type yet can still make a song; a typed idea is short and is screened by the route before any model sees it.
import { useState } from "react";
import type { KeptSong } from "./themeSongFlow";

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
  /** False when the song route is off: the sheet says so kindly and offers nothing to make. */
  available: boolean;
  onMake(idea: string): void;
  onDance(song: KeptSong): void;
  onClose(): void;
}

export function SongStudioSheet({ songs, available, onMake, onDance, onClose }: SongStudioSheetProps) {
  const [idea, setIdea] = useState("");
  const text = idea.trim();
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

      {available ? (
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
          <p className="tv-songs-note">Songs are made by AI and take about a minute.</p>
        </>
      ) : (
        <p className="tv-songs-lead" role="status">
          Song making is resting right now. The songs you already made can still dance!
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
