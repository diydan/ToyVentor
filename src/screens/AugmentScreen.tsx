import { useEffect, useMemo, useState } from "react";
import {
  boardForToy,
  buildStats,
  canPlace,
  findPlacement,
  pitchOf,
  rotatePlacement,
  type Placement,
} from "../../shared/build";
import { allPass, runChecks, type CheckId } from "../../shared/checks";
import type { Part } from "../../shared/part";
import { buildSignature } from "../../shared/reveal";
import { TryOn } from "../features/ar/TryOn";
import { BuilderCanvas } from "../features/builder/BuilderCanvas";
import { colorOf } from "../features/builder/engine/render";
import { loadBuild as readBuild, saveBuild as writeBuild } from "../lib/builds";
import {
  allParts,
  catalogErrors as setErrors,
  glbFileFor,
  partsById,
  stlFileFor,
} from "../lib/catalog";
import { revealForBuild } from "../state/reveals";
import { useToybox } from "../state/toybox";

const CHECK_LABELS: ReadonlyArray<{ id: CheckId; label: string }> = [
  { id: "on-grid", label: "On grid" },
  { id: "fits-toy", label: "Fits size" },
  { id: "support-free", label: "No supports" },
  { id: "fits-bed", label: "Fits bed" },
];

export function AugmentScreen({
  onBack,
  onPlay,
  onFinish,
}: {
  onBack: () => void;
  onPlay?: () => void;
  onFinish?: (firstReveal: boolean) => void;
}) {
  const { selected: toy } = useToybox();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [past, setPast] = useState<Placement[][]>([]);
  const [future, setFuture] = useState<Placement[][]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [lineFilter, setLineFilter] = useState<"all" | "snap" | "pro">("all");

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
        <header className="screen-head">
          <h1 className="screen-title">Build</h1>
          <button type="button" className="tv-ctl" onClick={onBack}>
            Back
          </button>
        </header>
        <div className="glass-card">
          <p style={{ marginTop: 0 }}>Pick a toy in the Toybox first.</p>
          <button type="button" className="cta" onClick={onBack}>
            Back to Toybox
          </button>
        </div>
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
    const placement: Placement = {
      instanceId: crypto.randomUUID(),
      partId: part.id,
      ...spot,
    };
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
    commit(
      placements.map((p) => (p.instanceId === rotated.instanceId ? rotated : p)),
    );
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
  const checkSets = placedParts.map((p) => runChecks(p, toy));
  const failing = placedParts.filter((_, idx) => !allPass(checkSets[idx]!));
  const ready = placements.length > 0 && failing.length === 0;
  const [gridPitch] = selected
    ? pitchOf(partsById.get(selected.partId)!, selected.rotation)
    : [toy.sizeClass === "large" ? 25 : 12.5];

  const filteredParts = allParts.filter((part) =>
    lineFilter === "all" ? true : part.line === lineFilter,
  );
  const selectedPart = selected ? partsById.get(selected.partId) : undefined;
  const selectedGlb = glbFileFor(selectedPart);
  const printablePlaced = placedParts.filter(
    (p) => p.printable && Boolean(stlFileFor(p)),
  );
  const hasSmallPartWarning = printablePlaced.some((p) => p.smallPartWarning);
  const statSummary =
    Object.entries(stats.statTotals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} +${v}`)
      .join(" · ") || "no stat boost yet";
  const alreadyRevealed = Boolean(
    revealForBuild(toy.id, buildSignature(placements)),
  );

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">Build · {toy.name}</h1>
        <button type="button" className="tv-ctl" onClick={onBack}>
          Back
        </button>
      </header>

      <div className="glass-card" style={{ marginBottom: 12 }}>
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

        <div className="tv-fg-b" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <button
            type="button"
            className="tv-ctl"
            onClick={undo}
            disabled={past.length === 0}
          >
            Undo
          </button>
          <button
            type="button"
            className="tv-ctl"
            onClick={redo}
            disabled={future.length === 0}
          >
            Redo
          </button>
          <button
            type="button"
            className="tv-ctl tv-ctl-sky"
            onClick={rotateSelected}
            disabled={!selected}
          >
            Rotate
          </button>
          <button
            type="button"
            className="tv-ctl"
            onClick={removeSelected}
            disabled={!selected}
          >
            Remove
          </button>
          <button
            type="button"
            className="tv-ctl"
            onClick={() => {
              commit([]);
              setSelectedId(undefined);
            }}
            disabled={placements.length === 0}
          >
            Clear
          </button>
        </div>

        {note && (
          <p className="error" style={{ marginBottom: 0 }}>
            {note}
          </p>
        )}
      </div>

      <div className="glass-card" style={{ marginBottom: 12 }}>
        <span className="kicker-label">Live print & fit checks</span>
        <div className="checks-grid">
          {CHECK_LABELS.map(({ id, label }) => {
            const hasParts = checkSets.length > 0;
            const passes =
              hasParts &&
              checkSets.every(
                (results) => results.find((r) => r.id === id)?.pass === true,
              );
            const pillClass = !hasParts
              ? "check-pill"
              : passes
                ? "check-pill check-pill-ok"
                : "check-pill check-pill-bad";
            const tag = !hasParts ? "WAIT" : passes ? "OK" : "FIX";
            return (
              <div key={id} className={pillClass}>
                <span className="check-pill-tag">{tag}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <p className="fine-print" style={{ margin: "10px 0 0" }}>
          {placements.length === 0
            ? "Tap a part below to snap it onto the grid."
            : `${placements.length} placed · ${statSummary} · ${stats.printableCount} printable`}
        </p>
      </div>

      <div className="glass-card" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <span className="kicker-label" style={{ margin: 0 }}>
            Parts tray
          </span>
          <div className="pill-row">
            <button
              type="button"
              className={
                lineFilter === "all" ? "pill-chip pill-chip-on" : "pill-chip"
              }
              aria-pressed={lineFilter === "all"}
              onClick={() => setLineFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={
                lineFilter === "snap" ? "pill-chip pill-chip-on" : "pill-chip"
              }
              aria-pressed={lineFilter === "snap"}
              onClick={() => setLineFilter("snap")}
            >
              Snap
            </button>
            <button
              type="button"
              className={
                lineFilter === "pro"
                  ? "pill-chip pill-chip-pro pill-chip-on"
                  : "pill-chip pill-chip-pro"
              }
              aria-pressed={lineFilter === "pro"}
              onClick={() => setLineFilter("pro")}
            >
              Pro
            </button>
          </div>
        </div>

        {setErrors.length > 0 ? (
          <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
        ) : (
          <div className="tv-opts">
            {filteredParts.map((part) => {
              const fits = canPlace(part, 0, 0, 0, [], partsById, board).ok;
              const checksPass = allPass(runChecks(part, toy));
              const placedCount = placements.filter(
                (p) => p.partId === part.id,
              ).length;
              return (
                <button
                  key={part.id}
                  type="button"
                  className={
                    placedCount > 0 ? "tv-opt tv-opt-on" : "tv-opt"
                  }
                  disabled={!fits}
                  onClick={() => addPart(part)}
                >
                  <span>
                    {part.name}
                    {placedCount > 0 ? ` ×${placedCount}` : ""}
                  </span>
                  <span className="tv-opt-meta">
                    <span
                      className="tv-opt-dot"
                      style={{ background: colorOf(part) }}
                      aria-hidden="true"
                    />
                    {part.line === "pro" ? "Pro" : "Snap"} · {part.stat.name} +
                    {part.stat.value}
                  </span>
                  <span className="tv-opt-lk">
                    {!fits
                      ? "Too big"
                      : !checksPass
                        ? "Wrong size"
                        : part.printable
                          ? "3D print"
                          : "Game only"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {placedParts.length > 0 && failing.length > 0 && (
          <ul className="build-list" style={{ marginTop: 10 }}>
            {failing.map((part) => {
              const failedLabels = runChecks(part, toy)
                .filter((r) => !r.pass)
                .map((r) => r.label)
                .join(", ");
              return (
                <li key={part.id}>
                  <strong>{part.name}</strong>
                  <span className="error"> (fix: {failedLabels})</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {ready && onFinish && (
        <button
          type="button"
          className="cta"
          onClick={() => onFinish(!alreadyRevealed)}
        >
          {alreadyRevealed
            ? "View character card"
            : "Finish: reveal this character!"}
        </button>
      )}

      {onPlay && (
        <button type="button" className="cta cta-violet" onClick={onPlay}>
          Play in ToyVentor World
        </button>
      )}

      {selectedPart && selectedGlb && (
        <div className="glass-card" style={{ marginTop: 12 }}>
          <span className="kicker-label kicker-gold">
            AR Try-On · {selectedPart.name}
          </span>
          <TryOn
            toy={toy}
            part={selectedPart}
            glbFile={selectedGlb}
          />
        </div>
      )}

      {ready && printablePlaced.length > 0 && (
        <div className="glass-card" style={{ marginTop: 12 }}>
          <span className="kicker-label">3D Print queue</span>
          <div style={{ marginBottom: 10 }}>
            <div className="kv-row">
              <span>Lattice & orientation</span>
              <span>12.5 mm TU · Flat · support-free</span>
            </div>
            <div className="kv-row">
              <span>Layer & filament</span>
              <span>0.2 mm PLA</span>
            </div>
            <div className="kv-row">
              <span>Bed check</span>
              <span>220×220 mm passed</span>
            </div>
          </div>
          {hasSmallPartWarning && (
            <p className="fine-print" role="note" style={{ marginTop: 0, marginBottom: 10 }}>
              <strong>WARNING: CHOKING HAZARD — Small parts.</strong> Not for
              children under 3 years (ASTM F963 / 16 CFR § 1500.19). Adult
              supervision required when printing and assembling small parts.
            </p>
          )}
          <div className="tv-fg-b" style={{ flexWrap: "wrap" }}>
            {printablePlaced.map((p) => (
              <a
                key={p.id}
                className="tv-ctl tv-ctl-sky"
                style={{ minHeight: 40 }}
                href={`/parts-stl/${stlFileFor(p)}`}
                download
              >
                Download {p.name} STL
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
