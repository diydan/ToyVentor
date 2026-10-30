import type { MissionAction, MissionPanelSnapshot } from "./engine";

export interface MissionPanelProps {
  snapshot: MissionPanelSnapshot;
  onAction: (action: MissionAction) => void;
  onControl: (index: number) => void;
}

/**
 * Frosted-glass bottom sheet for bridge, lift, and STEM Playground missions.
 * Keeps the 3D scene visible above the sheet while placing parts or solving puzzles.
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
      className="tv-sheet tv-sheet-mission"
      role="region"
      aria-label="Mission"
    >
      <div className="tv-sh-top" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold" style={{ marginBottom: 2 }}>
            Mission
          </span>
          <b className="tv-sh-title">{snapshot.title}</b>
        </div>
        <button
          type="button"
          className="tv-ctl"
          onClick={() => onAction("later")}
        >
          Later
        </button>
      </div>

      {snapshot.goal && (
        <p className="tv-moves" style={{ fontSize: 13 }}>
          {snapshot.goal}
        </p>
      )}

      {snapshot.lines.map((line, index) => (
        <p
          key={`${line}-${index}`}
          style={{ margin: 0, fontSize: 14, fontWeight: 700 }}
        >
          {line}
        </p>
      ))}

      {snapshot.chips.length > 0 && (
        <div className="tv-pseq" aria-label="Mission sequence">
          {snapshot.chips.map((chip, index) => (
            <span
              key={`${chip.text}-${index}`}
              className={
                chip.question ? "tv-pseq-chip tv-pseq-q" : "tv-pseq-chip"
              }
              style={
                !chip.question && chip.background
                  ? { background: chip.background }
                  : undefined
              }
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {groups.map((group) => {
        const isNumberPad =
          !group.name &&
          group.controls.length >= 6 &&
          group.controls.every((c) => /^\d+$/.test(c.label));
        const [slotTitle, slotStatus] = group.name ? group.name.split(" · ") : [];

        const buttons = group.controls.map((control) => {
          const classes = ["tv-ctl"];
          if (control.primary && !control.active) classes.push("tv-ctl-sky");
          if (control.active) classes.push("tv-ctl-gold-ring");
          if (control.danger) classes.push("tv-ctl-danger");
          return (
            <button
              key={control.index}
              type="button"
              disabled={control.disabled}
              aria-pressed={control.active || undefined}
              className={classes.join(" ")}
              onClick={() => onControl(control.index)}
              style={
                !control.danger && control.borderColor
                  ? { borderColor: control.borderColor }
                  : undefined
              }
            >
              {control.label}
            </button>
          );
        });

        if (group.name) {
          return (
            <div key={group.name} className="tv-mp-slot">
              <div className="tv-mp-sn">
                <b>{slotTitle}</b>
                {slotStatus && (
                  <span style={{ color: "var(--gold)", fontSize: 13 }}>
                    {slotStatus}
                  </span>
                )}
              </div>
              <div className="tv-mp-sb" role="group" aria-label={group.name}>
                {buttons}
              </div>
            </div>
          );
        }

        return (
          <div
            key="mission-controls"
            className={isNumberPad ? "tv-cgrid" : "tv-mp-sb"}
            role="group"
            aria-label="Mission controls"
          >
            {buttons}
          </div>
        );
      })}

      <div className="tv-fg-b">
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          onClick={() => onAction("test")}
        >
          {snapshot.actionLabel}
        </button>
        {snapshot.forgeAvailable && (
          <button
            type="button"
            className="tv-ctl"
            onClick={() => onAction("forge")}
          >
            Forge parts
          </button>
        )}
      </div>

      {snapshot.binText && <p className="tv-moves">{snapshot.binText}</p>}
    </section>
  );
}
