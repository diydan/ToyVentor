import baseSetJson from "../../sets/base.json";
import { allPass, runChecks } from "../../shared/checks";
import { validateSet, type ToySet } from "../../shared/part";
import { PartCard } from "../components/PartCard";
import { useToybox } from "../state/toybox";

const baseSet = baseSetJson as ToySet;
const setErrors = validateSet(baseSetJson);

/** Market promise from the spec: only parts that fit the selected toy. */
export function MarketScreen({ onBuild }: { onBuild?: () => void }) {
  const { selected: toy } = useToybox();
  if (!toy) {
    return (
      <section>
        <h1>Market</h1>
        <p>Pick a toy in the Toybox and the Market only shows parts that fit it.</p>
      </section>
    );
  }
  const fitting = baseSet.parts.filter((p) => allPass(runChecks(p, toy)));
  const hidden = baseSet.parts.length - fitting.length;
  return (
    <section>
      <h1>Market</h1>
      <p className="lede">
        Showing only parts that fit {toy.name} ({toy.sizeClass}, {toy.lengthMm}×{toy.widthMm} mm).
      </p>
      {onBuild && (
        <button type="button" className="cta" onClick={onBuild}>
          Build with these parts
        </button>
      )}
      {setErrors.length > 0 ? (
        <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
      ) : fitting.length === 0 ? (
        <p>Nothing in the base set fits this toy yet.</p>
      ) : (
        fitting.map((part) => <PartCard key={part.id} part={part} toy={toy} />)
      )}
      {hidden > 0 && (
        <p className="fine-print">{hidden} part{hidden === 1 ? "" : "s"} hidden: wrong size for this toy.</p>
      )}
    </section>
  );
}
