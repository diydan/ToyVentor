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

export function LivePlayPanel({
  themeSignature,
}: {
  /** Build signature for "play my theme"; undefined until a build exists. */
  themeSignature?: string;
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

  const setMood = (next: Mood) => {
    setMoodState(next);
    playerRef.current?.setMood(next);
  };

  const applyCommand = (text: string) => {
    const hit = moodForKeyword(text);
    setHeard(text);
    if (!hit) {
      setNote(`Heard “${text}” — no mood word in it. Try “danger”, “start adventure”, or “play my theme”.`);
      return;
    }
    setMood(hit.mood);
    setNote(hit.playTheme ? "Playing your character theme!" : `Mood: ${hit.mood}`);
    if (hit.playTheme && themeSignature) {
      themeRef.current?.stop();
      themeRef.current = playTheme(themeNotes(themeSignature));
    } else if (hit.playTheme) {
      setNote("No character theme yet — finish a build and Reveal it first.");
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
      setNote("Voice isn't available in this browser — type a command below instead. (Muse Voice Transcribe replaces this later.)");
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
    setNote("Listening… try “start adventure”, “danger”, or “play my theme”.");
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
    <>
      <h2>Live Play</h2>
      <p className="fine-print" style={{ marginTop: 0 }}>
        Music that follows the story. Tap a mood, or say a story word —
        the loops crossfade instead of cutting. Loops are synth stand-ins
        for Mureka stems; voice uses the browser until Muse Voice
        Transcribe is wired.
      </p>
      <div className="builder-actions">
        <button type="button" onClick={toggleMusic}>{playing ? "Stop music" : "Start music"}</button>
        <button type="button" onClick={toggleListen}>{listening ? "Stop listening" : "Listen"}</button>
      </div>
      <div className="builder-actions" role="group" aria-label="Mood">
        {MOODS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === mood}
            className={m === mood ? "mood-active" : undefined}
            onClick={() => setMood(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <label className="field">
        Story command
        <input
          value={command}
          placeholder='Try "danger" or "play my theme"'
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && command.trim()) applyCommand(command.trim());
          }}
        />
      </label>
      {heard && <p>Last heard: “{heard}” · mood is <strong>{mood}</strong></p>}
      {note && <p className="fine-print">{note}</p>}
    </>
  );
}
