// The Grown-ups sheet's Songs section: switch the song maker on or off and set how many new songs a week (0 to 5). It renders nothing when the song route is off or not
// metered here (nothing to set), and every change goes through the parent proof the sheet already holds (src/lib/songSettings.ts).
import { useEffect, useState } from "react";
import { loadSongSettings, saveSongSettings, type SongSettings, type SongWeek } from "../../../lib/songSettings";

const NOTE: Record<string, string> = {
  gate: "Unlock with the grown-up check first, then try again.",
  invalid: "That setting was not accepted.",
  offline: "Could not reach the song settings. Try again in a moment.",
  absent: "",
};

export function SongSettingsPanel({ proof }: { proof: string }) {
  const [settings, setSettings] = useState<SongSettings | null>(null);
  const [week, setWeek] = useState<SongWeek | null>(null);
  const [absent, setAbsent] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadSongSettings().then((r) => {
      if (!live) return;
      if (r.ok) { setSettings(r.settings); setWeek(r.week); } else if (r.reason === "absent") setAbsent(true);
      else setNote(NOTE.offline!);
    });
    return () => { live = false; };
  }, []);

  if (absent) return null;

  const change = async (patch: Partial<SongSettings>) => {
    if (busy) return;
    setBusy(true);
    setNote("");
    const r = await saveSongSettings(patch, proof);
    setBusy(false);
    if (r.ok) { setSettings(r.settings); setWeek(r.week); } else setNote(NOTE[r.reason] ?? NOTE.offline!);
  };

  // A closed group like the others in the sheet: the summary says where it stands (maker on or off, songs a week), one tap opens the two controls.
  return (
    <details className="tv-disclosure" data-testid="song-settings">
      <summary>
        <span>Songs</span>
        <span className="tv-disclosure-meta">{settings ? `${settings.makerOn ? "Maker on" : "Maker off"} · ${settings.limit} a week` : "…"}</span>
      </summary>
      <div className="tv-parent-adv">
        <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
          <div>
            <b>Song maker</b>
          </div>
          <button
            type="button"
            className="tv-ctl"
            aria-pressed={settings?.makerOn ?? true}
            disabled={!settings || busy}
            onClick={() => settings && void change({ makerOn: !settings.makerOn })}
          >
            {settings ? (settings.makerOn ? "Song maker: On" : "Song maker: Off") : "…"}
          </button>
        </div>
        <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
          Children can make a song from a build, a finished level or an idea. Each song is written and sung by AI (the words are checked first) and takes about a minute. Off
          stops new songs; the songs already made stay.
        </p>
        <div className="tv-parent-row-head" style={{ marginBottom: 0 }}>
          <div>
            <b>New songs a week</b>
          </div>
          <div className="tv-chips" role="group" aria-label="New songs a week">
            <button type="button" className="tv-sc" aria-label="Fewer songs a week" disabled={!settings || busy || settings.limit <= 0} onClick={() => settings && void change({ limit: settings.limit - 1 })}>
              −
            </button>
            <span data-testid="song-limit" aria-live="polite" style={{ minWidth: 24, textAlign: "center", fontWeight: 800 }}>
              {settings ? settings.limit : "…"}
            </span>
            <button type="button" className="tv-sc" aria-label="More songs a week" disabled={!settings || busy || settings.limit >= 5} onClick={() => settings && void change({ limit: settings.limit + 1 })}>
              +
            </button>
          </div>
        </div>
        {week ? (
          <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
            This week: {week.used} made, {week.left} left. New songs come back on Monday ({week.resetsOn}).
          </p>
        ) : null}
        {note ? (
          <p className="tv-moves" role="status" style={{ margin: 0, fontSize: 12 }}>
            {note}
          </p>
        ) : null}
      </div>
    </details>
  );
}
