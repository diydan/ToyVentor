import type { MissionAction, MissionPanelSnapshot } from "./engine";

export interface MissionPanelProps {
  snapshot: MissionPanelSnapshot;
  onAction: (action: MissionAction) => void;
  onControl: (index: number) => void;
}

/**
 * The one React mission panel (port step 3). Every legacy mission -- the
 * bridge and lift slots plus all nine STEM playground panels -- arrives as
 * the same typed snapshot: lines, chips, and controls. This component
 * renders that data only; results still come from the engine underneath.
 */
export function MissionPanel({ snapshot, onAction, onControl }: MissionPanelProps) {
  const groups: Array<{ name: string | undefined; controls: typeof snapshot.controls }> = [];
  for (const control of snapshot.controls) {
    const group = groups.find((entry) => entry.name === control.group);
    if (group) group.controls.push(control);
    else groups.push({ name: control.group, controls: [control] });
  }

  return (
    <section
      aria-label="Mission"
      style={{
        margin: "12px 0",
        padding: "14px",
        border: "2px solid var(--gold)",
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
        <div>
          <p style={{ margin: "0 0 2px", color: "var(--gold)", fontWeight: 800 }}>
            Mission
          </p>
          <h2 style={{ marginTop: 0 }}>{snapshot.title}</h2>
        </div>
        <button
          type="button"
          className="cta cta-quiet"
          style={{ width: "auto" }}
          onClick={() => onAction("later")}
        >
          Later
        </button>
      </div>

      {snapshot.goal && <p>{snapshot.goal}</p>}
      {snapshot.lines.map((line, index) => (
        <p key={`${line}-${index}`} style={{ fontWeight: 700 }}>
          {line}
        </p>
      ))}

      {snapshot.chips.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}
          aria-label="Mission sequence"
        >
          {snapshot.chips.map((chip, index) => (
            <span
              key={`${chip.text}-${index}`}
              style={{
                minWidth: 34,
                height: 34,
                padding: "4px 7px",
                border: "2px solid var(--glass-line)",
                borderRadius: "50%",
                background: chip.background || "var(--surface-2)",
                color: chip.question ? "var(--gold)" : "var(--ink)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.name ?? "mission-controls"}>
          {group.name && <h3>{group.name}</h3>}
          <div className="builder-actions" role="group" aria-label={group.name ?? "Mission controls"}>
            {group.controls.map((control) => (
              <button
                key={control.index}
                type="button"
                disabled={control.disabled}
                aria-pressed={control.active || undefined}
                className={control.primary || control.active ? "mood-active" : undefined}
                onClick={() => onControl(control.index)}
                style={{
                  borderColor: control.danger
                    ? "var(--danger)"
                    : control.borderColor || undefined,
                  boxShadow: control.danger ? "0 0 0 2px var(--danger)" : undefined,
                }}
              >
                {control.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {snapshot.binText && <p className="fine-print">{snapshot.binText}</p>}

      <div className="builder-actions">
        <button type="button" className="mood-active" onClick={() => onAction("test")}>
          {snapshot.actionLabel}
        </button>
        {snapshot.forgeAvailable && (
          <button type="button" onClick={() => onAction("forge")}>
            Forge parts
          </button>
        )}
      </div>
    </section>
  );
}
