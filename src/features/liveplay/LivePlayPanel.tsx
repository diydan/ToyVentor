import { useEffect, useRef, useState } from "react";
import {
  MOODS,
  moodForKeyword,
  type Mood,
} from "../../../shared/liveplay";
import { themeNotes } from "../../../shared/reveal";
import { playTheme, type ThemeHandle } from "../reveal/theme";
import { createLoopPlayer, type LoopPlayer } from "./loops";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function speechCtor(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
}

const MOOD_COLORS: Record<Mood, string> = {
  joy: "var(--mood-joy)",
  suspense: "var(--mood-suspense)",
  danger: "var(--mood-danger)",
  calm: "var(--mood-calm)",
  triumph: "var(--mood-triumph)",
  mystery: "var(--mood-mystery)",
};

export function LivePlayPanel({
  themeSignature,
  onClose,
  onActiveChange,
}: {
  /** Build signature for "play my theme"; undefined until a build exists. */
  themeSignature?: string;
  onClose?: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const playerRef = useRef<LoopPlayer | null>(null);
  const themeRef = useRef<ThemeHandle | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const [mood, setMoodState] = useState<Mood>("joy");
  const [playing, setPlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [command, setCommand] = useState("");

  useEffect(() => {
    onActiveChange?.(playing || listening);
  }, [playing, listening, onActiveChange]);

  const setMood = (next: Mood) => {
    setMoodState(next);
    playerRef.current?.setMood(next);
  };

  const applyCommand = (text: string) => {
    const hit = moodForKeyword(text);
    setHeard(text);
    if (!hit) {
      setNote(
        `Heard "${text}", no mood word in it. Try "danger", "start adventure", or "play my theme".`,
      );
      return;
    }
    setMood(hit.mood);
    setNote(hit.playTheme ? "Playing your character theme!" : `Mood: ${hit.mood}`);
    if (hit.playTheme && themeSignature) {
      themeRef.current?.stop();
      themeRef.current = playTheme(themeNotes(themeSignature));
    } else if (hit.playTheme) {
      setNote("No character theme yet. Finish a build and Reveal it first.");
    }
  };

  const toggleMusic = () => {
    if (playing) {
      playerRef.current?.stop();
      playerRef.current = null;
      setPlaying(false);
      return;
    }
    const player = createLoopPlayer(mood);
    playerRef.current = player;
    void player.started.then((ok) => {
      setPlaying(ok);
      if (!ok) setNote("Audio is blocked in this browser right now.");
    });
  };

  const toggleListen = () => {
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) {
      setNote(
        "Voice is not available in this browser. Type a story word below instead.",
      );
      return;
    }
    const recog = new Ctor();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.onresult = (e) => {
      const last = e.results[e.results.length - 1]?.[0]?.transcript;
      if (last) applyCommand(last.trim());
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    recogRef.current = recog;
    recog.start();
    setListening(true);
    setNote('Listening... try "start adventure", "danger", or "play my theme".');
  };

  useEffect(
    () => () => {
      playerRef.current?.stop();
      themeRef.current?.stop();
      recogRef.current?.stop();
    },
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="tv-sh-top">
        <b className="tv-sh-title">Live Play moods</b>
        {onClose && (
          <button
            type="button"
            className="tv-ctl tv-ctl-primary"
            onClick={onClose}
          >
            Done
          </button>
        )}
      </div>

      <p className="tv-moves">
        Tap a mood or say a story word. Music keeps playing while you explore the world.
      </p>

      <div className="tv-fg-b">
        <button
          type="button"
          className={playing ? "tv-ctl tv-ctl-sky" : "tv-ctl tv-ctl-primary"}
          onClick={toggleMusic}
        >
          {playing ? "Stop music" : "Start music"}
        </button>
        <button
          type="button"
          className={listening ? "tv-ctl tv-ctl-sky" : "tv-ctl"}
          onClick={toggleListen}
        >
          {listening ? "Stop listening" : "Story mic"}
        </button>
      </div>

      <div className="tv-chips" role="group" aria-label="Mood">
        {MOODS.map((m) => (
          <button
            key={m}
            type="button"
            className="tv-sc"
            aria-pressed={m === mood}
            onClick={() => setMood(m)}
            style={{
              textTransform: "capitalize",
              borderColor: m === mood ? MOOD_COLORS[m] : undefined,
            }}
          >
            <span
              className="tv-opt-dot"
              aria-hidden="true"
              style={{
                background: MOOD_COLORS[m],
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {m}
          </button>
        ))}
      </div>

      <div className="tv-ed-row">
        <input
          className="tv-input tv-grow"
          value={command}
          placeholder='Try "danger" or "play my theme"'
          aria-label="Story command"
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && command.trim()) {
              applyCommand(command.trim());
              setCommand("");
            }
          }}
        />
        <button
          type="button"
          className="tv-ctl"
          disabled={!command.trim()}
          onClick={() => {
            if (command.trim()) {
              applyCommand(command.trim());
              setCommand("");
            }
          }}
        >
          Send
        </button>
      </div>

      {heard && (
        <p className="tv-moves">
          Last heard: "{heard}" · mood is <strong style={{ color: "var(--ink)" }}>{mood}</strong>
        </p>
      )}
      {note && <p className="tv-moves">{note}</p>}
    </div>
  );
}
