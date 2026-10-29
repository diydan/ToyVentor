import type {
  CustomizerChoice,
  CustomizerSnapshot,
  FactoryAction,
  PaintZone,
} from "./engine";

export interface ToyCustomizerProps {
  snapshot: CustomizerSnapshot;
  onClose: () => void;
  onSetToyType: (toyType: string) => void;
  onSelectSlot: (slot: string) => void;
  onSelectPart: (partId: string) => void;
  onSetPaintZone: (zone: PaintZone) => void;
  onSetPaint: (color: string) => void;
  onFactoryAction: (action: FactoryAction) => void;
  onForgeTool: (toolId: string) => void;
  onPrintTool: (toolId: string) => void;
}

function ChoiceRow({
  label,
  choices,
  onChoose,
}: {
  label: string;
  choices: CustomizerChoice[];
  onChoose: (id: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <>
      <h3>{label}</h3>
      <div className="builder-actions" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={choice.selected}
            className={choice.selected ? "mood-active" : undefined}
            onClick={() => onChoose(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * React replacement for the legacy Factory sheet (port step 2). It renders
 * only the typed snapshot from the facade; every action goes back through
 * the engine handle, so the 3D model, saves, locks, and print checks stay
 * owned by the engine until their own port steps land.
 */
export function ToyCustomizer({
  snapshot,
  onClose,
  onSetToyType,
  onSelectSlot,
  onSelectPart,
  onSetPaintZone,
  onSetPaint,
  onFactoryAction,
  onForgeTool,
  onPrintTool,
}: ToyCustomizerProps) {
  const selectedSlot =
    snapshot.slots.find((slot) => slot.id === snapshot.slot)?.label ?? "Part";

  return (
    <section
      aria-label="Toy Factory"
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
        <div>
          <h2 style={{ marginTop: 0 }}>
            {snapshot.forge ? "Forge parts" : "Build your toy"}
          </h2>
          <p className="fine-print" style={{ marginTop: 0 }}>
            {snapshot.forge
              ? `${snapshot.scrap} scrap available.`
              : "React controls, same ToyVentor World toy underneath."}
          </p>
        </div>
        <button type="button" className="cta cta-quiet" style={{ width: "auto" }} onClick={onClose}>
          Done
        </button>
      </div>

      <div className="builder-actions" role="group" aria-label="Factory mode">
        <button
          type="button"
          aria-pressed={!snapshot.forge}
          className={!snapshot.forge ? "mood-active" : undefined}
          onClick={() => snapshot.forge && onFactoryAction("forge")}
        >
          Build
        </button>
        <button
          type="button"
          aria-pressed={snapshot.forge}
          className={snapshot.forge ? "mood-active" : undefined}
          onClick={() => !snapshot.forge && onFactoryAction("forge")}
        >
          Forge
        </button>
      </div>

      {snapshot.types.length === 0 && !snapshot.forge ? (
        <p aria-live="polite">Opening the Factory…</p>
      ) : snapshot.forge ? (
        <ForgeList snapshot={snapshot} onForgeTool={onForgeTool} onPrintTool={onPrintTool} />
      ) : (
        <>
          <ChoiceRow label="Toy type" choices={snapshot.types} onChoose={onSetToyType} />
          <ChoiceRow label="Part slot" choices={snapshot.slots} onChoose={onSelectSlot} />

          <h3>{selectedSlot}</h3>
          <ul className="tray" aria-label={`${selectedSlot} options`}>
            {snapshot.options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="tray-part"
                  aria-pressed={option.selected}
                  aria-describedby={option.locked ? `lock-${option.id}` : undefined}
                  onClick={() => onSelectPart(option.id)}
                  style={
                    option.selected
                      ? { borderColor: "var(--sky-500)", background: "var(--surface-3)" }
                      : undefined
                  }
                >
                  <span
                    className="tray-swatch"
                    aria-hidden="true"
                    style={{ background: option.statColor || "var(--line-soft)" }}
                  />
                  <span>{option.label}</span>
                  <span className="tray-meta">
                    {option.locked ? option.lockLabel : option.detail}
                  </span>
                </button>
                {option.locked && (
                  <span id={`lock-${option.id}`} className="fine-print">
                    Hidden part. {option.lockLabel}.
                  </span>
                )}
              </li>
            ))}
          </ul>

          <ChoiceRow
            label="Paint"
            choices={snapshot.paintZones}
            onChoose={(id) => onSetPaintZone(id as PaintZone)}
          />
          <div className="builder-actions" role="group" aria-label="Paint color">
            {snapshot.paints.map((paint) => (
              <button
                key={paint.color}
                type="button"
                aria-label={`Paint ${paint.color}`}
                aria-pressed={paint.selected}
                onClick={() => onSetPaint(paint.color)}
                style={{
                  width: 44,
                  height: 44,
                  padding: 0,
                  background: paint.color,
                  borderColor: paint.selected ? "var(--focus)" : "var(--glass-line)",
                  boxShadow: paint.selected ? "0 0 0 2px var(--focus)" : undefined,
                }}
              />
            ))}
          </div>

          {snapshot.moves && <p>{snapshot.moves}</p>}
          {snapshot.checkText && (
            <p role="status" style={{ fontWeight: 700 }}>
              {snapshot.checkText}
            </p>
          )}
          <div className="builder-actions">
            {snapshot.checkOk === false && (
              <button type="button" onClick={() => onFactoryAction("fix")}>
                Fix it for me
              </button>
            )}
            {snapshot.checkOk === true && (
              <button type="button" onClick={() => onFactoryAction("order")}>
                Order
              </button>
            )}
            <button type="button" onClick={() => onFactoryAction("reset")}>
              Reset hidden parts
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ForgeList({
  snapshot,
  onForgeTool,
  onPrintTool,
}: {
  snapshot: CustomizerSnapshot;
  onForgeTool: (toolId: string) => void;
  onPrintTool: (toolId: string) => void;
}) {
  if (snapshot.forgeItems.length === 0) return <p aria-live="polite">Opening the Forge…</p>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {snapshot.forgeItems.map((item, index) => (
        <article
          key={item.id ?? `${item.label}-${index}`}
          style={{
            padding: "10px",
            border: "2px solid var(--line-soft)",
            borderRadius: "var(--radius-sm)",
            opacity: item.locked ? 0.62 : 1,
          }}
        >
          <h3>{item.label}</h3>
          <p>{item.description}</p>
          {item.owned != null && <p className="fine-print">You have {item.owned}.</p>}
          {item.id && (
            <div className="builder-actions">
              <button
                type="button"
                disabled={!item.canForge}
                onClick={() => onForgeTool(item.id as string)}
              >
                {item.forgeLabel || "Forge"}
              </button>
              <button
                type="button"
                disabled={item.onPrintList}
                onClick={() => onPrintTool(item.id as string)}
              >
                {item.printLabel || "Print it for real"}
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
