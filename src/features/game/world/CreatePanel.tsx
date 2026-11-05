import { useEffect, useRef, useState } from "react";
import { chipWord, type CreateAction, type CreateSnapshot } from "./engine";

/**
 * "Say it": the same microphone button as Describe & build in the Workshop, from the same module (public/kip/kip-describe-voice.js), so the recording rules live in one place:
 * nothing is recorded or even asked of the microphone until the child presses it, a recording is at most 8 s, it goes to the app's own /api/transcribe and is dropped, and the
 * words land in the text box to be SEEN and changed, never made automatically. Loaded on demand like the Workshop (a plain static file, not part of this bundle). When the app's
 * route is off, or the module cannot be loaded, the browser's own "Speak" button is shown instead, exactly as before.
 */
interface SayIt {
  node: HTMLButtonElement;
  probe: () => Promise<boolean>;
  cancel: () => void;
  dispose: () => void;
}
type VoiceModule = { createVoiceInput: (options: Record<string, unknown>) => SayIt };
const VOICE_MODULE = "/kip/kip-describe-voice.js";
const loadVoiceModule = (): Promise<VoiceModule> =>
  import(/* @vite-ignore */ new URL(VOICE_MODULE, window.location.origin).href) as Promise<VoiceModule>;

export interface CreatePanelProps {
  snapshot: CreateSnapshot;
  onClose: () => void;
  onMake: (text: string) => void;
  onAction: (action: CreateAction) => void;
}

/**
 * Frosted-glass bottom sheet for Create-a-world mode powered by Meta Muse.
 * Runs directly over the live 3D World stage.
 */
export function CreatePanel({ snapshot, onClose, onMake, onAction }: CreatePanelProps) {
  const [draft, setDraft] = useState(snapshot.inputValue);
  const submittedRef = useRef("");
  const [sayIt, setSayIt] = useState<"checking" | "on" | "off">("checking");
  const [voiceMsg, setVoiceMsg] = useState("");
  const voiceHost = useRef<HTMLSpanElement>(null);
  const voiceRef = useRef<SayIt | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Build the Say it button once, ask the route (one free GET) whether it can listen, and free the microphone when the panel goes away.
  useEffect(() => {
    let gone = false;
    let voice: SayIt | null = null;
    void (async () => {
      try {
        const mod = await loadVoiceModule();
        if (gone) return;
        voice = mod.createVoiceInput({
          label: "Say it",
          actionWord: "Make",
          what: "your world",
          currentText: () => draftRef.current,
          onText: (words: string) => setDraft(words.slice(0, 160)),
          onStatus: (line: string) => setVoiceMsg(line),
        });
        voice.node.classList.add("tv-ctl");
        voiceHost.current?.append(voice.node);
        voiceRef.current = voice;
        const ok = await voice.probe();
        if (!gone) setSayIt(ok ? "on" : "off");
      } catch {
        if (!gone) setSayIt("off");
      }
    })();
    return () => {
      gone = true;
      voiceRef.current = null;
      voice?.dispose();
    };
  }, []);

  useEffect(() => {
    if (
      snapshot.inputValue &&
      snapshot.inputValue !== draft &&
      snapshot.inputValue !== submittedRef.current
    ) {
      setDraft(snapshot.inputValue);
    }
    if (!snapshot.inputValue && !snapshot.busy) submittedRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.inputValue, snapshot.busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || snapshot.busy) return;
    submittedRef.current = text;
    voiceRef.current?.cancel(); // a recording in progress is thrown away: the child pressed Make
    setVoiceMsg("");
    onMake(text);
    setDraft("");
  };

  return (
    <section
      className="tv-sheet"
      role="region"
      aria-label="Create a world"
    >
      <div className="tv-sh-top">
        <b className="tv-sh-title">Create a World</b>
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          disabled={snapshot.busy}
          onClick={() => onAction("play")}
        >
          Play it
        </button>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="tv-ed-row">
        <input
          className="tv-input tv-grow"
          value={draft}
          maxLength={160}
          placeholder="Describe your world (e.g. snowy mountain with cave)"
          aria-label="Describe your world"
          onChange={(event) => {
            setDraft(event.target.value);
            setVoiceMsg("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <span ref={voiceHost} className="tv-cr-voicehost" />
        {snapshot.micAvailable && sayIt === "off" && (
          <button
            type="button"
            className="tv-ctl"
            aria-label="Parent-started voice prompt"
            onClick={() => onAction("mic")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path
                d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            Speak
          </button>
        )}
      </div>

      {sayIt === "on" && voiceMsg && (
        <p className="tv-cr-voice" role="status" aria-live="polite">
          {voiceMsg}
        </p>
      )}

      {snapshot.chips.length > 0 && (
        <div className="tv-cr-chips" role="group" aria-label="Picture words">
          {snapshot.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="tv-crc"
              onClick={() => {
                const word = chipWord(chip);
                setDraft((current) =>
                  current.trim() ? `${current.trim()} ${word}` : word,
                );
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {snapshot.wishes.length > 0 && (
        <div className="tv-cr-chips tv-cr-wishes" role="group" aria-label="Wish worlds">
          {snapshot.wishes.map((wish) => (
            <button
              key={wish.id}
              type="button"
              className="tv-crc tv-crc-wish"
              disabled={snapshot.busy}
              onClick={() => onAction(`wish:${wish.id}`)}
            >
              {wish.name}
            </button>
          ))}
        </div>
      )}

      {snapshot.lookName && (
        <div className="tv-ed-row">
          <button type="button" className="tv-ctl" disabled={snapshot.busy} onClick={() => onAction("unlook")}>
            Remove the AI-made look
          </button>
        </div>
      )}

      <div className="tv-fg-b">
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          disabled={snapshot.busy || !draft.trim()}
          onClick={submit}
        >
          {snapshot.busy ? "Making with Meta Muse..." : "Make with Meta Muse"}
        </button>
        <button
          type="button"
          className="tv-ctl"
          disabled={!snapshot.canUndo || snapshot.busy}
          onClick={() => onAction("undo")}
        >
          Undo
        </button>
        <button
          type="button"
          className="tv-ctl"
          disabled={snapshot.busy}
          onClick={() => onAction("keep")}
        >
          Save world
        </button>
      </div>

      {snapshot.say && (
        <p className="tv-cr-say" aria-live="polite">
          {snapshot.say}
        </p>
      )}

      {snapshot.cards.length > 0 && (
        <ul className="tv-cr-cards">
          {snapshot.cards.map((card, index) => (
            <li key={`${card.title}-${index}`}>
              {card.title && <strong>{card.title}</strong>}
              {card.text}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="tv-link"
        onClick={() => onAction("code")}
      >
        {snapshot.codeVisible ? "Hide world recipe" : "Show world recipe"}
      </button>

      {snapshot.codeVisible && snapshot.recipe && (
        <pre className="tv-cr-code">
          {JSON.stringify(snapshot.recipe, null, 1)}
        </pre>
      )}
    </section>
  );
}
