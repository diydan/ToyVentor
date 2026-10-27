import { runChecks } from "../../shared/checks";
import type { Part } from "../../shared/part";
import type { Toy } from "../../shared/toy";
import { CheckList } from "./CheckList";

export function PartCard({ part, toy }: { part: Part; toy: Toy }) {
  return (
    <article className="part-card">
      <header>
        <h3>{part.name}</h3>
        <span
          className={part.line === "pro" ? "part-line part-line-pro" : "part-line"}
        >
          {part.line === "pro" ? "Pro" : "Snap"}
        </span>
      </header>
      <p className="part-meta">
        <span className={`part-stat part-stat-${part.stat.name}`}>
          {part.stat.name} +{part.stat.value}
        </span>{" "}
        · {part.footprintMm[0]}×{part.footprintMm[1]} mm ·{" "}
        {part.printable ? "printable" : "AR/game only"}
      </p>
      <CheckList results={runChecks(part, toy)} />
    </article>
  );
}
