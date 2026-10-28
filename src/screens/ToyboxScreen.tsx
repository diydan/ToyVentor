import baseSetJson from "../../sets/base.json";
import { validateSet, type ToySet } from "../../shared/part";
import type { Toy } from "../../shared/toy";
import { PartCard } from "../components/PartCard";
import { SkinPanel } from "../features/skin/SkinPanel";
import { revealsForToy } from "../state/reveals";
import { useToybox } from "../state/toybox";

const baseSet = baseSetJson as ToySet;
const setErrors = validateSet(baseSetJson);

function toySourceLabel(toy: Toy): string {
  return toy.source === "seed"
    ? "built-in"
    : toy.source === "manual"
      ? "by hand"
      : "scanned";
}

function ToyChipList({
  toys,
  selected,
  onSelect,
}: {
  toys: Toy[];
  selected: Toy | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="toy-list">
      {toys.map((toy) => (
        <li key={toy.id}>
          <button
            type="button"
            className={
              toy.id === selected?.id ? "toy-chip toy-chip-active" : "toy-chip"
            }
            aria-pressed={toy.id === selected?.id}
            onClick={() => onSelect(toy.id)}
          >
            {toy.name} · {toy.sizeClass} · {toySourceLabel(toy)}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ToyboxScreen({
  onScan,
  onBuild,
  onReveal,
}: {
  onScan: () => void;
  onBuild?: () => void;
  onReveal?: () => void;
}) {
  const { uploadedToys, builtInToys, selected, selectToy } = useToybox();

  return (
    <section>
      <h1>Toybox</h1>
      <p className="lede">
        Pick up a toy you already added, or start with a built-in one.
      </p>

      <h2>Your uploads</h2>
      {uploadedToys.length > 0 ? (
        <ToyChipList
          toys={uploadedToys}
          selected={selected}
          onSelect={selectToy}
        />
      ) : (
        <p>No uploaded toys yet. Scan one to add it here.</p>
      )}

      <h2>Built-in starter toys</h2>
      <ToyChipList toys={builtInToys} selected={selected} onSelect={selectToy} />

      <button type="button" className="cta cta-quiet" onClick={onScan}>
        Scan new
      </button>

      {selected && (
        <>
          <SkinPanel key={selected.id} toy={selected} />
          {onBuild && (
            <button type="button" className="cta" onClick={onBuild}>
              Build upgrades on {selected.name}
            </button>
          )}
          {revealsForToy(selected.id).map((card) => (
            <button
              key={card.id}
              type="button"
              className="cta cta-quiet"
              onClick={onReveal}
            >
              Character: {card.title}
            </button>
          ))}
          <h2>Built-in parts for {selected.name}</h2>
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
