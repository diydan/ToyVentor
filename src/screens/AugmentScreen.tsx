import { useEffect, useMemo, useState } from "react";
import baseSetJson from "../../sets/base.json";
import {
  boardForToy,
  buildStats,
  canPlace,
  findPlacement,
  pitchOf,
  rotatePlacement,
  type Placement,
} from "../../shared/build";
import { allPass, runChecks } from "../../shared/checks";
import { validateSet, type Part, type ToySet } from "../../shared/part";
import { buildSignature } from "../../shared/reveal";
import { TryOn } from "../features/ar/TryOn";
import { revealForBuild } from "../state/reveals";
import { BuilderCanvas } from "../features/builder/BuilderCanvas";
import { colorOf } from "../features/builder/engine/render";
import { useToybox } from "../state/toybox";
import { loadBuild as readBuild, saveBuild as writeBuild } from "../lib/builds";

const baseSet = baseSetJson as ToySet;
const setErrors = validateSet(baseSetJson);
const partsById = new Map(baseSet.parts.map((p) => [p.id, p]));

export function AugmentScreen({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish?: (firstReveal: boolean) => void;
}) {
  const { selected: toy } = useToybox();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [past, setPast] = useState<Placement[][]>([]);
  const [future, setFuture] = useState<Placement[][]>([]);
  const [note, setNote] = useState<string | null>(null);

  // Load this toy's saved build whenever the toy changes.
  useEffect(() => {
    if (!toy) return;
    const saved = readBuild(toy.id, partsById);
    setPlacements(saved);
    // Reopening a build should show its try-on immediately, not an
    // empty preview until something is tapped.
    setSelectedId(saved[0]?.instanceId);
    setPast([]);
    setFuture([]);
    setNote(null);
  }, [toy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toy) return;
    writeBuild(toy.id, placements);
  }, [toy, placements]);

  const board = useMemo(() => (toy ? boardForToy(toy) : null), [toy]);
  const stats = useMemo(() => buildStats(placements, partsById), [placements]);
  const selected = placements.find((p) => p.instanceId === selectedId);

  if (!toy || !board) {
    return (
      <section>
        <h1>Augment</h1>
        <p>Pick a toy in the Toybox first.</p>
        <button type="button" className="cta" onClick={onBack}>Back to Toybox</button>
      </section>
    );
  }

  const commit = (next: Placement[]) => {
    setPast((prev) => [...prev.slice(-49), placements]);
    setFuture([]);
    setPlacements(next);
  };

  const addPart = (part: Part) => {
    const spot = findPlacement(part, placements, partsById, board);
    if (!spot) {
      setNote(
        canPlace(part, 0, 0, 0, [], partsById, board).ok
          ? `No room left for ${part.name}. Move or remove something first.`
          : `${part.name} doesn't fit ${toy.name}'s top (${board.lengthMm}×${board.widthMm} mm).`,
      );
      return;
    }
    const placement: Placement = { instanceId: crypto.randomUUID(), partId: part.id, ...spot };
    commit([...placements, placement]);
    setSelectedId(placement.instanceId);
    setNote(null);
  };

  const movePlacement = (moved: Placement) => {
    const current = placements.find((p) => p.instanceId === moved.instanceId);
    if (current && current.xMm === moved.xMm && current.yMm === moved.yMm) return;
    commit(placements.map((p) => (p.instanceId === moved.instanceId ? moved : p)));
  };

  const rotateSelected = () => {
    if (!selected) return;
    const rotated = rotatePlacement(selected, placements, partsById, board);
    if (!rotated) {
      setNote("No room to rotate it there. Drag it somewhere roomier first.");
      return;
    }
    commit(placements.map((p) => (p.instanceId === rotated.instanceId ? rotated : p)));
    setNote(null);
  };

  const removeSelected = () => {
    if (!selected) return;
    commit(placements.filter((p) => p.instanceId !== selected.instanceId));
    setSelectedId(undefined);
  };

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([placements, ...future]);
    setPlacements(previous);
    setSelectedId(undefined);
  };

  const redo = () => {
    const [next, ...rest] = future;
    if (!next) return;
    setPast([...past, placements]);
    setFuture(rest);
    setPlacements(next);
    setSelectedId(undefined);
  };

  const placedParts = [...new Set(placements.map((p) => p.partId))]
    .map((id) => partsById.get(id))
    .filter((p): p is Part => Boolean(p));
  const failing = placedParts.filter((p) => !allPass(runChecks(p, toy)));
  const ready = placements.length > 0 && failing.length === 0;
  const [gridPitch] = selected
    ? pitchOf(partsById.get(selected.partId)!, selected.rotation)
    : [16];
  // Part id -> generated STL basename in public/parts-stl (npm run parts).
  const stlFile: Record<string, string> = {
    "snap-spoiler-01": "spoiler.stl",
    "snap-brick-2x2-small": "brick-2x2-small.stl",
    "snap-brick-2x2-large": "brick-2x2-large.stl",
    "forge-mount-small": "forge-mount.stl",
    "snap-wing-01": "dragon-wing.stl",
    "snap-glow-capsule-01": "glow-capsule.stl",
    "pro-beam-tu05": "beam-tu05.stl",
  };

  return (
    <section>
      <h1>Augment {toy.name}</h1>
      <p className="fine-print" style={{ marginTop: 0 }}>
        Drag parts on the grid. They snap, collide, and only count when the
        checks pass. This is the same footprint data that prints.
      </p>

      <BuilderCanvas
        board={board}
        toyLabel={toy.name}
        placements={placements}
        partsById={partsById}
        selectedId={selectedId}
        gridPitchMm={gridPitch}
        onSelect={setSelectedId}
        onMove={movePlacement}
      />

      <div className="builder-actions">
        <button type="button" onClick={undo} disabled={past.length === 0}>Undo</button>
        <button type="button" onClick={redo} disabled={future.length === 0}>Redo</button>
        <button type="button" onClick={rotateSelected} disabled={!selected}>Rotate</button>
        <button type="button" onClick={removeSelected} disabled={!selected}>Remove</button>
        <button
          type="button"
          onClick={() => { commit([]); setSelectedId(undefined); }}
          disabled={placements.length === 0}
        >
          Clear
        </button>
      </div>
      {note && <p className="error">{note}</p>}

      {selected && partsById.get(selected.partId) && stlFile[selected.partId] && (
        <>
          <h2>Try on: {partsById.get(selected.partId)!.name}</h2>
          <TryOn
            toy={toy}
            part={partsById.get(selected.partId)!}
            glbFile={stlFile[selected.partId]!.replace(/\.stl$/, ".glb")}
          />
        </>
      )}

      <h2>Parts tray</h2>
      {setErrors.length > 0 ? (
        <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
      ) : (
        <ul className="tray">
          {baseSet.parts.map((part) => {
            const fits = canPlace(part, 0, 0, 0, [], partsById, board).ok;
            const checksPass = allPass(runChecks(part, toy));
            return (
              <li key={part.id}>
                <button
                  type="button"
                  className="tray-part"
                  disabled={!fits}
                  onClick={() => addPart(part)}
                >
                  <span className="tray-swatch" style={{ background: colorOf(part) }} aria-hidden="true" />
                  {part.name}
                  <span className="tray-meta">
                    {part.stat.name} +{part.stat.value}
                    {!fits ? " · too big" : checksPass ? "" : " · check size"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Build</h2>
      {placements.length === 0 ? (
        <p>Nothing placed yet. Tap a part above to drop it on the toy.</p>
      ) : (
        <>
          <ul className="build-list">
            {placedParts.map((part) => {
              const count = placements.filter((p) => p.partId === part.id).length;
              const failed = runChecks(part, toy).filter((r) => !r.pass);
              return (
                <li key={part.id}>
                  <strong>{part.name}</strong> ×{count}
                  {failed.length > 0 && (
                    <span className="error"> — failing: {failed.map((f) => f.label).join(", ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p>
            Stats:{" "}
            {Object.entries(stats.statTotals).map(([k, v]) => `${k} +${v}`).join(", ") || "none"}
            {" · "}{stats.printableCount} printable
          </p>
          <p className={ready ? "check-pass" : "error"}>
            {ready
              ? "Checks pass. This build is ready for AR try-on when it lands (Day 5)."
              : "Not ready yet: every placed part must pass its checks."}
          </p>
          {ready && onFinish && (
            <button
              type="button"
              className="cta"
              onClick={() => onFinish(!revealForBuild(toy.id, buildSignature(placements)))}
            >
              {revealForBuild(toy.id, buildSignature(placements))
                ? "View character card"
                : "Finish — reveal this character!"}
            </button>
          )}
          {ready && (
            <>
              <h2>Print files</h2>
              <p className="fine-print" style={{ marginTop: 0 }}>
                Generated from the same OpenSCAD source. Targets only —
                nothing has been test-printed yet (Day 4 calibration).
              </p>
              <ul className="build-list">
                {placedParts
                  .filter((p) => p.printable && stlFile[p.id])
                  .map((p) => (
                    <li key={p.id}>
                      <a href={`/parts-stl/${stlFile[p.id]}`} download>
                        Download {p.name} STL
                      </a>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}

      <button type="button" className="cta cta-quiet" onClick={onBack}>
        Back to Toybox
      </button>
    </section>
  );
}
