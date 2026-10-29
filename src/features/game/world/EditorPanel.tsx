import { useEffect, useState } from "react";
import type {
  EditorAction,
  EditorIoAction,
  EditorSnapshot,
  EditorTab,
} from "./engine";

export interface EditorPanelProps {
  snapshot: EditorSnapshot;
  onClose: () => void;
  onAction: (action: EditorAction) => void;
  onName: (name: string) => void;
  onTheme: (theme: string) => void;
  onNew: (value: string) => void;
  onTab: (tab: EditorTab) => void;
  onPalette: (index: number) => void;
  onControl: (index: number) => void;
  onSelect: (index: number, value: string) => void;
  onIoText: (text: string) => void;
  onIoAction: (action: EditorIoAction) => void;
}

const THEMES = [
  { value: "garden", label: "Garden" },
  { value: "sky", label: "Sky Meadow" },
  { value: "junk", label: "Junkyard" },
  { value: "beach", label: "Beach" },
  { value: "snow", label: "Snow Peak" },
  { value: "room", label: "Toy Room" },
];

/**
 * React replacement for the legacy level-editor panel (port step 4).
 * Placement still happens by tapping or dragging on the engine path; the
 * name, theme, palettes, inspector, checks, and level file render here.
 */
export function EditorPanel({
  snapshot,
  onClose,
  onAction,
  onName,
  onTheme,
  onNew,
  onTab,
  onPalette,
  onControl,
  onSelect,
  onIoText,
  onIoAction,
}: EditorPanelProps) {
  return (
    <section
      aria-label="Level editor"
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
        <h2 style={{ marginTop: 0 }}>Level editor</h2>
        <div className="builder-actions" style={{ margin: 0 }}>
          <button type="button" className="mood-active" onClick={() => onAction("play")}>
            Play it
          </button>
          <button type="button" onClick={onClose}>
            Exit
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          key={snapshot.name}
          defaultValue={snapshot.name}
          maxLength={40}
          aria-label="Level name"
          onBlur={(event) => onName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          style={{ flex: "1 1 180px" }}
        />
        <select
          aria-label="Theme"
          value={snapshot.theme}
          onChange={(event) => onTheme(event.target.value)}
        >
          {THEMES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Start a new level"
          value=""
          onChange={(event) => onNew(event.target.value)}
        >
          <option value="">New…</option>
          {THEMES.map((theme) => (
            <option key={`blank-${theme.value}`} value={`blank:${theme.value}`}>
              Blank {theme.label}
            </option>
          ))}
          {THEMES.map((theme) => (
            <option key={`copy-${theme.value}`} value={`copy:${theme.value}`}>
              Copy of {theme.label}
            </option>
          ))}
        </select>
      </div>

      <div className="builder-actions">
        <button type="button" disabled={!snapshot.canUndo} onClick={() => onAction("undo")}>
          Undo
        </button>
        <button type="button" disabled={!snapshot.canRedo} onClick={() => onAction("redo")}>
          Redo
        </button>
        <button type="button" aria-label="Zoom editor out" onClick={() => onAction("zoomOut")}>
          −
        </button>
        <button type="button" aria-label="Zoom editor in" onClick={() => onAction("zoomIn")}>
          +
        </button>
        <button type="button" onClick={() => onAction("export")}>
          Export
        </button>
        <button type="button" onClick={() => onAction("import")}>
          Import
        </button>
      </div>

      <div className="builder-actions" role="group" aria-label="Editor panels">
        {snapshot.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={tab.selected}
            className={tab.selected ? "mood-active" : undefined}
            onClick={() => onTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <EditorBody
        snapshot={snapshot}
        onPalette={onPalette}
        onControl={onControl}
        onSelect={onSelect}
      />
      {snapshot.io.open && (
        <EditorIo snapshot={snapshot} onIoText={onIoText} onIoAction={onIoAction} />
      )}
    </section>
  );
}

function EditorBody({
  snapshot,
  onPalette,
  onControl,
  onSelect,
}: {
  snapshot: EditorSnapshot;
  onPalette: (index: number) => void;
  onControl: (index: number) => void;
  onSelect: (index: number, value: string) => void;
}) {
  if (snapshot.checks.length > 0) {
    return (
      <ul>
        {snapshot.checks.map((check) => (
          <li key={check.title}>
            <span aria-hidden="true">{check.ok ? "✓ " : "! "}</span>
            <strong>{check.title}</strong>{" "}
            <span className="fine-print">{check.detail}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {snapshot.selectedTitle && <h3>{snapshot.selectedTitle}</h3>}
      {snapshot.lines.map((line, index) => (
        <p key={`${line}-${index}`} className="fine-print">
          {line}
        </p>
      ))}

      {snapshot.palette.length > 0 && (
        <div className="builder-actions" role="group" aria-label="Editor palette">
          {snapshot.palette.map((item) => (
            <button
              key={item.index}
              type="button"
              aria-pressed={item.selected}
              className={item.selected ? "mood-active" : undefined}
              onClick={() => onPalette(item.index)}
            >
              {item.color && (
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    marginRight: 6,
                    borderRadius: "50%",
                    background: item.color,
                  }}
                />
              )}
              {item.label}
              {item.detail && <span className="fine-print"> {item.detail}</span>}
            </button>
          ))}
        </div>
      )}

      {snapshot.selects.map((select) => (
        <label key={select.index} style={{ display: "grid", gap: 6, marginBlock: 10 }}>
          {select.label || "Choice"}
          <select
            value={select.value}
            onChange={(event) => onSelect(select.index, event.target.value)}
          >
            {renderSelectOptions(select)}
          </select>
        </label>
      ))}

      {snapshot.controls.length > 0 && (
        <div className="builder-actions">
          {snapshot.controls.map((control) => (
            <button
              key={control.index}
              type="button"
              disabled={control.disabled}
              className={control.primary ? "mood-active" : undefined}
              onClick={() => onControl(control.index)}
            >
              {control.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function renderSelectOptions(select: EditorSnapshot["selects"][number]) {
  const groups = new Map<string, typeof select.options>();
  const plain: typeof select.options = [];
  for (const option of select.options) {
    if (!option.group) plain.push(option);
    else groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
  }
  return (
    <>
      {plain.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {[...groups.entries()].map(([group, options]) => (
        <optgroup key={group} label={group}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function EditorIo({
  snapshot,
  onIoText,
  onIoAction,
}: {
  snapshot: EditorSnapshot;
  onIoText: (text: string) => void;
  onIoAction: (action: EditorIoAction) => void;
}) {
  const [text, setText] = useState(snapshot.io.text);
  useEffect(() => {
    if (snapshot.io.readOnly) setText(snapshot.io.text);
  }, [snapshot.io.readOnly, snapshot.io.text]);

  return (
    <div
      role="dialog"
      aria-label="Level file"
      style={{
        marginTop: 12,
        padding: "12px",
        border: "2px solid var(--line-soft)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <h3>{snapshot.io.title}</h3>
      <textarea
        aria-label="Level file"
        spellCheck={false}
        readOnly={snapshot.io.readOnly}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onIoText(event.target.value);
        }}
        style={{ width: "100%", minHeight: 160, boxSizing: "border-box" }}
      />
      <div className="builder-actions">
        {snapshot.io.canCopy && (
          <button type="button" className="mood-active" onClick={() => onIoAction("copy")}>
            Copy
          </button>
        )}
        {snapshot.io.canLoad && (
          <button type="button" className="mood-active" onClick={() => onIoAction("load")}>
            Import
          </button>
        )}
        <button type="button" onClick={() => onIoAction("close")}>
          Close
        </button>
      </div>
    </div>
  );
}
