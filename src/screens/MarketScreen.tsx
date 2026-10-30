import { useState } from "react";
import { allPass, runChecks } from "../../shared/checks";
import { rarityForPart } from "../../shared/pack";
import { PartCard } from "../components/PartCard";
import { allParts, allSets, catalogErrors as setErrors } from "../lib/catalog";
import { useToybox } from "../state/toybox";

type MarketFilter = "all" | "snap" | "pro" | "print";

/** Market promise from the spec: only parts that fit the selected toy. */
export function MarketScreen({ onBuild }: { onBuild?: () => void }) {
  const { selected: toy } = useToybox();
  const [filter, setFilter] = useState<MarketFilter>("all");

  if (!toy) {
    return (
      <section>
        <header className="screen-head">
          <h1 className="screen-title">Market</h1>
        </header>
        <div className="glass-card">
          <p style={{ margin: 0 }}>
            Pick a toy in the Toybox and the Market only shows parts that fit it.
          </p>
        </div>
      </section>
    );
  }

  const fitting = allParts.filter((p) => allPass(runChecks(p, toy)));
  const hidden = allParts.length - fitting.length;
  const visible = fitting.filter((part) => {
    if (filter === "snap") return part.line === "snap";
    if (filter === "pro") return part.line === "pro";
    if (filter === "print") return part.printable;
    return true;
  });

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">Market</h1>
        <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
          {fitting.length} fit {toy.name}
        </span>
      </header>

      <div className="glass-card" style={{ marginBottom: 12 }}>
        <span className="kicker-label">Fit promise · {allSets.length} sets loaded</span>
        <p className="lede" style={{ marginTop: 0, marginBottom: 10 }}>
          Showing only parts verified to fit {toy.name} ({toy.sizeClass},{" "}
          {toy.lengthMm}×{toy.widthMm} mm).
        </p>

        <div className="pill-row" style={{ marginBottom: onBuild ? 12 : 0 }}>
          <button
            type="button"
            className={filter === "all" ? "pill-chip pill-chip-on" : "pill-chip"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All ({fitting.length})
          </button>
          <button
            type="button"
            className={filter === "snap" ? "pill-chip pill-chip-on" : "pill-chip"}
            aria-pressed={filter === "snap"}
            onClick={() => setFilter("snap")}
          >
            Snap
          </button>
          <button
            type="button"
            className={
              filter === "pro"
                ? "pill-chip pill-chip-pro pill-chip-on"
                : "pill-chip pill-chip-pro"
            }
            aria-pressed={filter === "pro"}
            onClick={() => setFilter("pro")}
          >
            Pro
          </button>
          <button
            type="button"
            className={
              filter === "print" ? "pill-chip pill-chip-on" : "pill-chip"
            }
            aria-pressed={filter === "print"}
            onClick={() => setFilter("print")}
          >
            3D print
          </button>
        </div>

        {onBuild && (
          <button
            type="button"
            className="cta"
            style={{ marginBottom: 0 }}
            onClick={onBuild}
          >
            Build with these parts
          </button>
        )}
      </div>

      {setErrors.length > 0 ? (
        <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
      ) : visible.length === 0 ? (
        <div className="glass-card">
          <p style={{ margin: 0 }}>
            No matching parts for that filter on {toy.name} yet.
          </p>
        </div>
      ) : (
        visible.map((part) => (
          <PartCard
            key={part.id}
            part={part}
            toy={toy}
            rarity={rarityForPart(part)}
          />
        ))
      )}

      {hidden > 0 && (
        <p className="fine-print">
          {hidden} part{hidden === 1 ? "" : "s"} hidden: wrong size for {toy.name}.
        </p>
      )}
    </section>
  );
}
