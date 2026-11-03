import { useState } from "react";
import type { Placement } from "../../../../shared/build";
import type { Toy } from "../../../../shared/toy";
import { toyTypeForKind, type ToyType } from "../../../../shared/toycontract";
import type { ProgressionState } from "../../../lib/progression";
import type {
  CustomizerChoice,
  CustomizerSnapshot,
  FactoryAction,
  PaintZone,
} from "./engine";
import { PrintDrawer } from "./PrintDrawer";

export interface ToyCustomizerProps {
  toy: Toy;
  placements: Placement[];
  onPlacementsChange: (next: Placement[]) => void;
  hasCharacterCard?: boolean;
  progression?: ProgressionState;
  onOpenCharacterCard?: () => void;
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
  /** Full part keys ("character.hat.crown") on loan from the Garage this weekend. */
  loanerKeys?: ReadonlySet<string>;
}

function SegmentedChips({
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
    <div className="tv-chips" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className="tv-sc"
          aria-pressed={choice.selected}
          onClick={() => onChoose(choice.id)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function normalizeToyType(raw: string, fallbackKind: Toy["kind"]): ToyType {
  if (raw === "vehicle" || raw === "character" || raw === "robot") return raw;
  return toyTypeForKind(fallbackKind);
}

/**
 * Frosted-glass bottom sheet for the ToyVentor World Factory, Merge Forge,
 * and 3D Print & AR Try-On drawer.
 */
export function ToyCustomizer({
  toy,
  placements,
  onPlacementsChange,
  hasCharacterCard,
  onOpenCharacterCard,
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
  progression,
  loanerKeys,
}: ToyCustomizerProps) {
  const [mockOrderNote, setMockOrderNote] = useState(false);
  const selectedSlot =
    snapshot.slots.find((slot) => slot.id === snapshot.slot)?.label ?? "Part";
  const resolvedToyType = normalizeToyType(snapshot.toyType, toy.kind);

  return (
    <section className="tv-sheet" role="dialog" aria-label="Build your toy">
      <div className="tv-sh-top">
        <b className="tv-sh-title">
          {snapshot.forge ? "Forge parts" : "Build your toy"}
        </b>
        {hasCharacterCard && onOpenCharacterCard && !snapshot.forge && (
          <button
            type="button"
            className="tv-ctl"
            onClick={onOpenCharacterCard}
          >
            Card
          </button>
        )}
        <button
          type="button"
          className="tv-ctl tv-ctl-gold-ring"
          aria-pressed={snapshot.forge}
          onClick={() => onFactoryAction("forge")}
        >
          Forge{snapshot.scrap > 0 ? ` (${snapshot.scrap})` : ""}
        </button>
        <button
          type="button"
          className="tv-ctl tv-ctl-primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>

      {snapshot.types.length === 0 && !snapshot.forge ? (
        <p className="tv-moves" aria-live="polite">
          Opening the Factory...
        </p>
      ) : snapshot.forge ? (
        <ForgeList
          snapshot={snapshot}
          onForgeTool={onForgeTool}
          onPrintTool={onPrintTool}
        />
      ) : (
        <>
          <SegmentedChips
            label="Toy type"
            choices={snapshot.types}
            onChoose={onSetToyType}
          />
          <SegmentedChips
            label="Part slot"
            choices={snapshot.slots}
            onChoose={onSelectSlot}
          />

          <div
            className="tv-opts"
            role="group"
            aria-label={`${selectedSlot} options`}
          >
            {snapshot.options.map((option) => {
              const classes = ["tv-opt"];
              if (option.selected) classes.push("tv-opt-on");
              if (option.locked) classes.push("tv-opt-lock");
              const fullKey = `${resolvedToyType}.${snapshot.slot}.${option.id}`;
              const loaner =
                (loanerKeys?.has(option.id) ?? false) || (loanerKeys?.has(fullKey) ?? false);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={classes.join(" ")}
                  aria-pressed={option.selected}
                  onClick={() => onSelectPart(option.id)}
                >
                  <span>
                    {option.label}
                    {loaner ? <span className="tv-opt-loaner">Loaner</span> : null}
                  </span>
                  {option.detail && (
                    <span className="tv-opt-meta">
                      {option.statColor && (
                        <i
                          className="tv-opt-dot"
                          aria-hidden="true"
                          style={{ background: option.statColor }}
                        />
                      )}
                      {option.detail}
                    </span>
                  )}
                  {option.locked && option.lockLabel && (
                    <span className="tv-opt-lk">{option.lockLabel}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="tv-paint">
            {snapshot.paintZones.length > 0 && (
              <div className="tv-seg" role="group" aria-label="Paint zone">
                {snapshot.paintZones.map((zone) => (
                  <button
                    key={zone.id}
                    type="button"
                    className="tv-sc"
                    aria-pressed={zone.selected}
                    onClick={() => onSetPaintZone(zone.id)}
                  >
                    {zone.label}
                  </button>
                ))}
              </div>
            )}
            <div className="tv-sw" role="group" aria-label="Paint color">
              {snapshot.paints.map((paint) => (
                <button
                  key={paint.color}
                  type="button"
                  className="tv-swt"
                  aria-label={`Paint ${paint.color}`}
                  aria-pressed={paint.selected}
                  onClick={() => onSetPaint(paint.color)}
                  style={{ background: paint.color }}
                />
              ))}
            </div>
          </div>

          <PrintDrawer
            toy={toy}
            slot={snapshot.slot}
            toyType={resolvedToyType}
            placements={placements}
            onPlacementsChange={onPlacementsChange}
            progression={progression}
          />

          {snapshot.moves && <p className="tv-moves">{snapshot.moves}</p>}

          {(snapshot.checkText || snapshot.checkOk !== null) && (
            <div className="tv-check-row">
              {snapshot.checkText && (
                <p
                  role="status"
                  className={
                    snapshot.checkOk === false
                      ? "tv-ck tv-ck-bad"
                      : "tv-ck tv-ck-ok"
                  }
                >
                  {snapshot.checkText}
                </p>
              )}
              {snapshot.checkOk === true && (
                <button
                  type="button"
                  className="tv-ctl"
                  onClick={() => {
                    setMockOrderNote(true);
                    onFactoryAction("order");
                  }}
                >
                  Order preview (mock)
                </button>
              )}
            </div>
          )}

          {mockOrderNote && (
            <p className="tv-moves" role="status">
              Delivery checkout is a mocked prototype preview. Download support-free STLs above to print at home today.
            </p>
          )}

          <button
            type="button"
            className="tv-link"
            onClick={() => onFactoryAction("reset")}
          >
            Reset hidden parts
          </button>
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
  if (snapshot.forgeItems.length === 0) {
    return <p className="tv-moves" aria-live="polite">Opening the Forge...</p>;
  }
  return (
    <>
      <p className="tv-moves">
        Scrap in bin:{" "}
        <strong style={{ color: "var(--gold)" }}>{snapshot.scrap}</strong>
      </p>
      <div className="tv-fg-list">
        {snapshot.forgeItems.map((item, index) => (
          <article
            key={item.id ?? `${item.label}-${index}`}
            className={item.locked ? "tv-fg-it tv-fg-lock" : "tv-fg-it"}
          >
            <div>
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>
                {item.label}
              </strong>
              {item.description && (
                <p className="tv-moves" style={{ marginTop: 2 }}>
                  {item.description}
                </p>
              )}
              {item.owned != null && (
                <p
                  className="tv-moves"
                  style={{ marginTop: 2, color: "var(--gold)", fontWeight: 700 }}
                >
                  You have {item.owned}.
                </p>
              )}
            </div>
            {item.id && (
              <div className="tv-fg-b">
                <button
                  type="button"
                  className="tv-ctl tv-ctl-primary"
                  disabled={!item.canForge}
                  onClick={() => onForgeTool(item.id as string)}
                >
                  {item.forgeLabel || "Forge"}
                </button>
                <button
                  type="button"
                  className="tv-ctl"
                  disabled={item.onPrintList}
                  onClick={() => onPrintTool(item.id as string)}
                >
                  {item.printLabel || "Queue for home print"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
