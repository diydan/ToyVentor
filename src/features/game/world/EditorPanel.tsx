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
 * Frosted-glass bottom sheet for the ToyVentor World level editor, plus
 * a centered glass modal when importing or exporting a level recipe.
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
    <>
      <section
        className="tv-sheet"
        role="region"
        aria-label="Level editor"
      >
        <div className="tv-sh-top">
          <b className="tv-sh-title">Level editor</b>
          <button
            type="button"
            className="tv-ctl tv-ctl-primary"
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
            key={snapshot.name}
            className="tv-input tv-grow"
            defaultValue={snapshot.name}
            maxLength={40}
            aria-label="Level name"
            onBlur={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <select
            className="tv-select"
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
            className="tv-select"
            aria-label="Start a new level"
            value=""
            onChange={(event) => onNew(event.target.value)}
          >
            <option value="">New...</option>
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

        <div className="tv-fg-b">
          <button
            type="button"
            className="tv-ctl"
            disabled={!snapshot.canUndo}
            onClick={() => onAction("undo")}
          >
            Undo
          </button>
          <button
            type="button"
            className="tv-ctl"
            disabled={!snapshot.canRedo}
            onClick={() => onAction("redo")}
          >
            Redo
          </button>
          <button
            type="button"
            className="tv-ctl"
            aria-label="Zoom editor out"
            onClick={() => onAction("zoomOut")}
          >
            -
          </button>
          <button
            type="button"
            className="tv-ctl"
            aria-label="Zoom editor in"
            onClick={() => onAction("zoomIn")}
          >
            +
          </button>
          <button
            type="button"
            className="tv-ctl"
            onClick={() => onAction("export")}
          >
            Export
          </button>
          <button
            type="button"
            className="tv-ctl"
            onClick={() => onAction("import")}
          >
            Import
          </button>
        </div>

        <div className="tv-chips" role="group" aria-label="Editor panels">
          {snapshot.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="tv-sc"
              aria-pressed={tab.selected}
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
      </section>

      {snapshot.io.open && (
        <EditorIo
          snapshot={snapshot}
          onIoText={onIoText}
          onIoAction={onIoAction}
        />
      )}
    </>
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
      <ul className="tv-ed-chk">
        {snapshot.checks.map((check) => (
          <li key={check.title} className={check.ok ? "ok" : "no"}>
            <span className="tv-ed-chk-dot" aria-hidden="true">
              {check.ok ? "✓" : "!"}
            </span>
            <div>
              <div>{check.title}</div>
              {check.detail && <div className="tv-moves">{check.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {snapshot.selectedTitle && (
        <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>
          {snapshot.selectedTitle}
        </strong>
      )}
      {snapshot.lines.map((line, index) => (
        <p key={`${line}-${index}`} className="tv-moves">
          {line}
        </p>
      ))}

      {snapshot.palette.length > 0 && (
        <div className="tv-ed-pal" role="group" aria-label="Editor palette">
          {snapshot.palette.map((item) => (
            <button
              key={item.index}
              type="button"
              className="tv-ed-pal-btn"
              aria-pressed={item.selected}
              onClick={() => onPalette(item.index)}
            >
              {item.color && (
                <i
                  className="tv-ed-pal-dot"
                  aria-hidden="true"
                  style={{ background: item.color }}
                />
              )}
              <span>{item.label}</span>
              {item.detail && (
                <span className="tv-ed-pal-sub">{item.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {snapshot.selects.map((select) => (
        <label
          key={select.index}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ink-muted)",
          }}
        >
          {select.label || "Choice"}
          <select
            className="tv-select"
            value={select.value}
            onChange={(event) => onSelect(select.index, event.target.value)}
          >
            {renderSelectOptions(select)}
          </select>
        </label>
      ))}

      {snapshot.controls.length > 0 && (
        <div className="tv-mp-sb">
          {snapshot.controls.map((control) => (
            <button
              key={control.index}
              type="button"
              disabled={control.disabled}
              className={control.primary ? "tv-ctl tv-ctl-primary" : "tv-ctl"}
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
    <div className="tv-io-backdrop" role="dialog" aria-label="Level file">
      <div className="tv-io-box">
        <b className="tv-sh-title">{snapshot.io.title}</b>
        <textarea
          className="tv-io-textarea"
          aria-label="Level file"
          spellCheck={false}
          readOnly={snapshot.io.readOnly}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onIoText(event.target.value);
          }}
        />
        <div className="tv-fg-b">
          {snapshot.io.canCopy && (
            <button
              type="button"
              className="tv-ctl tv-ctl-primary"
              onClick={() => onIoAction("copy")}
            >
              Copy
            </button>
          )}
          {snapshot.io.canLoad && (
            <button
              type="button"
              className="tv-ctl tv-ctl-primary"
              onClick={() => onIoAction("load")}
            >
              Import
            </button>
          )}
          <button
            type="button"
            className="tv-ctl"
            onClick={() => onIoAction("close")}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
