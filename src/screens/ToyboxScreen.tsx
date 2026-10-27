import baseSetJson from "../../sets/base.json";
import { validateSet, type ToySet } from "../../shared/part";
import { PartCard } from "../components/PartCard";
import { useToybox } from "../state/toybox";

const baseSet = baseSetJson as ToySet;
const setErrors = validateSet(baseSetJson);

export function ToyboxScreen({ onScan }: { onScan: () => void }) {
  const { toys, selected, selectToy } = useToybox();

  if (toys.length === 0) {
    return (
      <section>
        <h1>Toybox</h1>
        <p>Nothing here yet. Every build starts with a real toy.</p>
        <button type="button" className="cta" onClick={onScan}>
          Scan new
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Toybox</h1>
      <ul className="toy-list">
        {toys.map((toy) => (
          <li key={toy.id}>
            <button
              type="button"
              className={toy.id === selected?.id ? "toy-chip toy-chip-active" : "toy-chip"}
              onClick={() => selectToy(toy.id)}
            >
              {toy.name} · {toy.sizeClass}
              {toy.source === "seed" ? " · backup" : ""}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="cta cta-quiet" onClick={onScan}>
        Scan new
      </button>

      {selected && (
        <>
          <h2>Parts that fit {selected.name}</h2>
          {setErrors.length > 0 ? (
            <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
          ) : (
            baseSet.parts.map((part) => (
              <PartCard key={part.id} part={part} toy={selected} />
            ))
          )}
        </>
      )}
    </section>
  );
}
