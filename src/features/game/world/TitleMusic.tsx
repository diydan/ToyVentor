import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deviceId } from "../../../lib/sync";
import { Karaoke } from "./ThemeSongCard";
import { createTitleMusic, pickTitleSong, type TitleMusic as Controller, type TitleMusicState } from "./titleMusicCore";
import { readKeptSongs } from "./themeSongFlow";

interface TitleMusicProps {
  /** Changes when a song has just landed (the song flow's phase), so the kept songs are read again and the title can switch to the player's own. */
  songKey?: string;
  /** True while something else has the sound: the new-player setup, or a dance party. The music waits and carries on after. */
  hold?: boolean;
}

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** The finished song's audio through the app's relay: only this device's songs come back. Null on any failure (the default music keeps playing). */
async function fetchSongAudio(task: string): Promise<Blob | null> {
  try {
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
    const res = await fetch(`/api/theme-song?id=${encodeURIComponent(task)}&audio=1`, { headers: { "x-device-id": deviceId(), "x-client-timezone": tz } });
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}

/**
 * The music of the title page (titleMusicCore.ts): a starter song loops until the player's own theme song has landed, then the title crossfades to it and the karaoke shows its words in
 * time with the singing. Sound starts on the first tap anywhere (a browser allows nothing before one); the speaker button turns it off and on, and is remembered.
 * Rendered inside the title's header: the speaker button is positioned against the title itself.
 */
export function TitleMusic({ songKey, hold = false }: TitleMusicProps) {
  const ctl = useRef<Controller | null>(null);
  const [st, setSt] = useState<TitleMusicState | null>(null);

  useEffect(() => {
    const c = createTitleMusic({
      makeAudio: (src) => new Audio(src),
      fetchSongAudio,
      objectUrl: (b) => URL.createObjectURL(b),
      revokeUrl: (u) => URL.revokeObjectURL(u),
      storage: storage(),
    });
    ctl.current = c;
    const off = c.onChange(() => setSt(c.state()));
    setSt(c.state());
    // the first tap, key or click anywhere (except on the speaker button, which decides for itself) lets the music start
    const arm = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-title-music-toggle]")) return;
      c.arm();
    };
    const events = ["pointerup", "touchend", "click", "keydown"] as const;
    for (const ev of events) window.addEventListener(ev, arm, true);
    return () => {
      for (const ev of events) window.removeEventListener(ev, arm, true);
      off();
      c.stop();
      ctl.current = null;
    };
  }, []);

  // the player's own theme song, re-read whenever one has just landed
  const song = useMemo(() => pickTitleSong(readKeptSongs(storage())), [songKey]);
  useEffect(() => { ctl.current?.setSong(song); }, [song]);
  useEffect(() => { ctl.current?.setHold(hold); }, [hold]);

  const playhead = useCallback(() => ctl.current?.playhead() ?? 0, []);
  if (!st) return null;
  const custom = st.track.kind === "custom";
  const singing = custom && st.playing;
  return (
    <>
      <button
        type="button"
        className="tv-title-music"
        data-title-music-toggle
        aria-pressed={!st.muted}
        aria-label={st.muted ? "Turn the music on" : "Turn the music off"}
        onClick={() => { const c = ctl.current; if (!c) return; if (!st.armed) c.arm(); else c.setMuted(!st.muted); }}
      >
        <span aria-hidden="true">{st.muted ? "🔇" : "🔊"}</span>
      </button>
      {singing && (
        <div className="tv-title-now" data-title-now role="status" aria-label={`Playing ${st.track.title}`}>
          <span className="tv-title-now-name">♪ {st.track.title}</span>
          {st.track.karaoke.length > 0 && <Karaoke lines={st.track.karaoke} loop={st.track.loop} playhead={playhead} big={false} />}
        </div>
      )}
    </>
  );
}
