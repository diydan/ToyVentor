import { useEffect, useRef, useState } from "react";
import { chipWord, type CreateAction, type CreateSnapshot } from "./engine";

export interface CreatePanelProps {
  snapshot: CreateSnapshot;
  onClose: () => void;
  onMake: (text: string) => void;
  onAction: (action: CreateAction) => void;
}

/**
 * React replacement for the legacy Create-a-world panel (port step 4).
 * The prompt, picture words, world cards, and recipe code render from the
 * facade snapshot; Muse and the word parser still run in the engine.
 */
export function CreatePanel({ snapshot, onClose, onMake, onAction }: CreatePanelProps) {
  const [draft, setDraft] = useState(snapshot.inputValue);
  const submittedRef = useRef("");

  // Speech input lands in the legacy prompt first; mirror it here, but do
  // not resurrect a prompt the child just submitted while the engine works.
  useEffect(() => {
    if (
      snapshot.inputValue &&
      snapshot.inputValue !== draft &&
      snapshot.inputValue !== submittedRef.current
    ) {
      setDraft(snapshot.inputValue);
    }
    if (!snapshot.inputValue && !snapshot.busy) submittedRef.current = "";
    // Only legacy-origin changes should overwrite local typing.
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
      aria-label="Create a world"
      style={{
        margin: "12px 0",
        padding: "14px",
        border: "2px solid var(--line)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Create a world</h2>
        <button type="button" className="cta cta-quiet" style={{ width: "auto" }} onClick={onClose}>
          Exit
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={draft}
          maxLength={160}
          placeholder="Tell me your world…"
          aria-label="Describe your world"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          style={{ flex: "1 1 220px" }}
        />
        {snapshot.micAvailable && (
          <button type="button" aria-label="Speak" onClick={() => onAction("mic")}>
            Speak
          </button>
        )}
      </div>

      <div className="builder-actions" role="group" aria-label="Picture words">
        {snapshot.chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              const word = chipWord(chip);
              setDraft((current) => (current.trim() ? `${current.trim()} ${word}` : word));
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="builder-actions">
        <button
          type="button"
          className="mood-active"
          disabled={snapshot.busy || !draft.trim()}
          onClick={submit}
        >
          Make it!
        </button>
        <button
          type="button"
          disabled={!snapshot.canUndo || snapshot.busy}
          onClick={() => onAction("undo")}
        >
          Go back
        </button>
        <button type="button" disabled={snapshot.busy} onClick={() => onAction("keep")}>
          Keep it
        </button>
        <button type="button" disabled={snapshot.busy} onClick={() => onAction("play")}>
          Play it
        </button>
      </div>

      {snapshot.say && (
        <p aria-live="polite" style={{ fontWeight: 700 }}>
          {snapshot.say}
        </p>
      )}

      {snapshot.cards.length > 0 && (
        <ul>
          {snapshot.cards.map((card, index) => (
            <li key={`${card.title}-${index}`}>
              {card.title && <strong>{card.title} </strong>}
              {card.text}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="cta cta-quiet" onClick={() => onAction("code")}>
        {snapshot.codeVisible ? "Hide the code" : "Show the code"}
      </button>
      {snapshot.codeVisible && snapshot.recipe && (
        <pre
          style={{
            overflowX: "auto",
            padding: "10px",
            border: "2px solid var(--line-soft)",
            borderRadius: "var(--radius-sm)",
            fontSize: 12,
          }}
        >
          {JSON.stringify(snapshot.recipe, null, 1)}
        </pre>
      )}
    </section>
  );
}
