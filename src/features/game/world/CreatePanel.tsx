import { useEffect, useRef, useState } from "react";
import { chipWord, type CreateAction, type CreateSnapshot } from "./engine";

export interface CreatePanelProps {
  snapshot: CreateSnapshot;
  onClose: () => void;
  onMake: (text: string) => void;
  onAction: (action: CreateAction) => void;
}

/**
 * Frosted-glass bottom sheet for Create-a-world mode powered by Meta Muse.
 * Matches the standalone ToyVentor World Create sheet over the live 3D world.
 */
export function CreatePanel({ snapshot, onClose, onMake, onAction }: CreatePanelProps) {
  const [draft, setDraft] = useState(snapshot.inputValue);
  const submittedRef = useRef("");

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
        <b className="tv-sh-title">Create a world</b>
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          disabled={snapshot.busy}
          onClick={() => onAction("play")}
        >
          Play it
        </button>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Exit
        </button>
      </div>

      <div className="tv-ed-row">
        <input
          className="tv-input tv-grow"
          value={draft}
          maxLength={160}
          placeholder="Tell me your world..."
          aria-label="Describe your world"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        {snapshot.micAvailable && (
          <button
            type="button"
            className="tv-ctl"
            aria-label="Speak"
            onClick={() => onAction("mic")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
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

      <div className="tv-fg-b">
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          disabled={snapshot.busy || !draft.trim()}
          onClick={submit}
        >
          {snapshot.busy ? "Making..." : "Make it!"}
        </button>
        <button
          type="button"
          className="tv-ctl"
          disabled={!snapshot.canUndo || snapshot.busy}
          onClick={() => onAction("undo")}
        >
          Go back
        </button>
        <button
          type="button"
          className="tv-ctl"
          disabled={snapshot.busy}
          onClick={() => onAction("keep")}
        >
          Keep it
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
        {snapshot.codeVisible ? "Hide the code" : "Show the code"}
      </button>

      {snapshot.codeVisible && snapshot.recipe && (
        <pre className="tv-cr-code">
          {JSON.stringify(snapshot.recipe, null, 1)}
        </pre>
      )}
    </section>
  );
}
