import { allPass, runChecks } from "../../shared/checks";
import type { Part } from "../../shared/part";
import type { PackRarity } from "../../shared/pack";
import type { Toy } from "../../shared/toy";
import { CheckList } from "./CheckList";

export function PartCard({
  part,
  toy,
  rarity,
}: {
  part: Part;
  toy: Toy;
  rarity?: PackRarity;
}) {
  const checks = runChecks(part, toy);
  const fitsToy = allPass(checks);

  return (
    <article className="part-card">
      <header>
        <h3>{part.name}</h3>
        <span className="part-badges">
          <span
            className={part.line === "pro" ? "part-line part-line-pro" : "part-line"}
          >
            {part.line === "pro" ? "Pro" : "Snap"}
          </span>
          {rarity && (
            <span className={`part-rarity part-rarity-${rarity}`}>
              {rarity}
            </span>
          )}
        </span>
      </header>
      <p className="part-meta" style={{ marginBottom: 8 }}>
        <span className={`part-stat part-stat-${part.stat.name}`}>
          {part.stat.name} +{part.stat.value}
        </span>{" "}
        · {part.printable ? "3D printable" : "In-game look"} ·{" "}
        <span style={{ color: fitsToy ? "var(--mint)" : "var(--coral)" }}>
          {fitsToy ? `Fits ${toy.name}` : `Needs another toy size`}
        </span>
      </p>
      <details className="part-details">
        <summary>Details &amp; print check</summary>
        <div className="part-details-body">
          <p className="fine-print" style={{ margin: "0 0 8px" }}>
            Footprint: {part.footprintMm[0]}×{part.footprintMm[1]} mm
          </p>
          <CheckList results={checks} />
        </div>
      </details>
    </article>
  );
}
