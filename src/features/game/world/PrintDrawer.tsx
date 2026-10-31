import { useEffect, useMemo, useState } from "react";
import {
  boardForToy,
  canPlace,
  pitchOf,
  rotatePlacement,
  type Placement,
} from "../../../../shared/build";
import { allPass, runChecks } from "../../../../shared/checks";
import type { Line, Part } from "../../../../shared/part";
import type { Toy } from "../../../../shared/toy";
import type { ToyType } from "../../../../shared/toycontract";
import {
  hasProStatUnlock,
  PRO_STAT_LABS,
  type ProgressionState,
} from "../../../lib/progression";
import {
  equipPartOnBuild,
  printablePartsForWorld,
  unequipPartFromBuild,
} from "../../../../shared/world-parts";
import { CheckList } from "../../../components/CheckList";
import { loadBuild, saveBuild } from "../../../lib/builds";
import { allParts, glbFileFor, partsById, stlFileFor } from "../../../lib/catalog";
import { TryOn } from "../../ar/TryOn";
import { BuilderCanvas } from "../../builder/BuilderCanvas";

export function PrintDrawer({
  toy,
  slot,
  toyType,
  placements,
  onPlacementsChange,
  progression,
}: {
  toy: Toy;
  slot?: string;
  toyType?: ToyType;
  placements: Placement[];
  onPlacementsChange: (next: Placement[]) => void;
  progression?: ProgressionState;
}) {
  const [lineFilter, setLineFilter] = useState<Line | "all">("all");
  const [viewMode, setViewMode] = useState<"ar" | "grid">("ar");
  const [selectedPartId, setSelectedPartId] = useState<string>("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>(
    undefined,
  );
  const [history, setHistory] = useState<Placement[][]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const fitting = useMemo(() => {
    const list = printablePartsForWorld(toy, allParts, {
      slot,
      toyType,
      line: lineFilter,
    });
    if (!progression || progression.sandboxUnlockAll) return list;
    return list.filter(
      (p) => p.line !== "pro" || hasProStatUnlock(progression, p.stat.name),
    );
  }, [toy, slot, toyType, lineFilter, progression]);

  const proLock = useMemo(() => {
    if (!progression || progression.sandboxUnlockAll) {
      return { count: 0, labs: [] as string[] };
    }
    const locked = printablePartsForWorld(toy, allParts, {
      slot,
      toyType,
      line: "pro",
    }).filter((p) => !hasProStatUnlock(progression, p.stat.name));
    const labs = [
      ...new Set(
        locked.flatMap((p) => PRO_STAT_LABS[p.stat.name] ?? []),
      ),
    ]
      .map((lab) => lab.replace(/^lab/, "Lab "))
      .sort();
    return { count: locked.length, labs };
  }, [toy, slot, toyType, progression]);

  // Keep selectedPartId valid when toy, slot, or filter changes.
  useEffect(() => {
    if (fitting.length === 0) {
      setSelectedPartId("");
      return;
    }
    if (!fitting.some((p) => p.id === selectedPartId)) {
      setSelectedPartId(fitting[0]!.id);
    }
  }, [fitting, selectedPartId]);

  // Reset undo stack when switching toys.
  useEffect(() => {
    setHistory([]);
    setSelectedInstanceId(undefined);
    setNotice(null);
  }, [toy.id]);

  const commitPlacements = (next: Placement[], recordUndo = true) => {
    if (recordUndo) {
      setHistory((prev) => [...prev.slice(-15), placements]);
    }
    saveBuild(toy.id, next);
    onPlacementsChange(next);
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    saveBuild(toy.id, prev);
    onPlacementsChange(prev);
    setNotice(null);
  };

  const selectedFromInstance = selectedInstanceId
    ? partsById.get(
        placements.find((p) => p.instanceId === selectedInstanceId)?.partId ?? "",
      )
    : undefined;

  const selectedPart: Part | undefined =
    (viewMode === "grid" && selectedFromInstance) ||
    fitting.find((p) => p.id === selectedPartId) ||
    fitting[0];

  const board = useMemo(() => boardForToy(toy), [toy]);

  const boardValid = useMemo(() => {
    for (const placed of placements) {
      const part = partsById.get(placed.partId);
      if (!part) return false;
      if (
        !canPlace(
          part,
          placed.xMm,
          placed.yMm,
          placed.rotation,
          placements,
          partsById,
          board,
          placed.instanceId,
        ).ok
      ) {
        return false;
      }
    }
    return true;
  }, [placements, board]);

  const checks = useMemo(
    () => (selectedPart ? runChecks(selectedPart, toy) : []),
    [selectedPart, toy],
  );
  const checksPass = checks.length > 0 && allPass(checks);
  const stlFile = stlFileFor(selectedPart);
  const glbFile = glbFileFor(selectedPart);
  const canDownloadStl = Boolean(
    selectedPart?.printable && stlFile && checksPass && boardValid,
  );

  const isEquipped = Boolean(
    selectedPart && placements.some((p) => p.partId === selectedPart.id),
  );

  const toggleEquip = (part: Part) => {
    setNotice(null);
    const current = loadBuild(toy.id, partsById);
    if (current.some((p) => p.partId === part.id)) {
      const next = unequipPartFromBuild(part.id, current);
      commitPlacements(next);
      return;
    }
    const res = equipPartOnBuild(toy, part, current, partsById);
    if (!res.ok) {
      setNotice(
        res.reason === "board-full"
          ? `Board on ${toy.name} is full. Remove a part or clear the grid first.`
          : `${part.name} does not pass fit checks for ${toy.name}.`,
      );
      return;
    }
    setSelectedInstanceId(res.placement.instanceId);
    commitPlacements(res.placements);
  };

  const rotateSelected = () => {
    const target =
      placements.find((p) => p.instanceId === selectedInstanceId) ??
      (selectedPart
        ? placements.find((p) => p.partId === selectedPart.id)
        : undefined);
    if (!target) return;
    const rotated = rotatePlacement(target, placements, partsById, board);
    if (!rotated) {
      setNotice("No room to rotate that part at its current spot.");
      return;
    }
    setNotice(null);
    commitPlacements(
      placements.map((p) => (p.instanceId === target.instanceId ? rotated : p)),
    );
  };

  const handleMove = (moved: Placement) => {
    setNotice(null);
    commitPlacements(
      placements.map((p) => (p.instanceId === moved.instanceId ? moved : p)),
    );
  };

  const gridPitchMm = selectedPart
    ? pitchOf(selectedPart, 0)[0]
    : 12.5;

  return (
    <details className="tv-disclosure">
      <summary>
        <span>
          3D Print &amp; AR Try-On ({fitting.length} fit {toy.name})
        </span>
        <span className={checksPass && boardValid ? "tv-ok-pill" : "tv-warn-pill"}>
          {checksPass && boardValid ? "4/4 checks pass" : "Check fit"}
        </span>
      </summary>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div className="tv-seg" role="group" aria-label="Part line filter">
            {(["all", "snap", "pro"] as const).map((lf) => (
              <button
                key={lf}
                type="button"
                className="tv-sc"
                style={{ minHeight: 30, padding: "0 9px", fontSize: 12 }}
                aria-pressed={lineFilter === lf}
                onClick={() => setLineFilter(lf)}
              >
                {lf === "all" ? "All" : lf === "snap" ? "Snap" : "Pro"}
              </button>
            ))}
          </div>

          <div className="tv-seg" role="tablist" aria-label="Preview mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "ar"}
              className="tv-sc"
              style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
              aria-pressed={viewMode === "ar"}
              onClick={() => setViewMode("ar")}
            >
              AR View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "grid"}
              className="tv-sc"
              style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              Stud Grid
            </button>
          </div>
        </div>

        {proLock.count > 0 && (
          <p className="tv-moves" role="status">
            {proLock.count} Pro {proLock.count === 1 ? "part" : "parts"}{" "}
            unlock{proLock.count === 1 ? "s" : ""} with 3 stars
            {proLock.labs.length > 0 && ` in ${proLock.labs.join(", ")}`}.
            Finish STEM Lab missions with clean engineering to earn stars.
          </p>
        )}

        {fitting.length === 0 ? (
          <p className="tv-moves">
            No {lineFilter === "all" ? "" : `${lineFilter.toUpperCase()} `}printable parts fit {toy.name}&apos;s {toy.lengthMm}×{toy.widthMm} mm ({toy.sizeClass}) frame.
          </p>
        ) : (
          <>
            <div
              className="tv-opts"
              role="listbox"
              aria-label={`Printable parts verified to fit ${toy.name}`}
            >
              {fitting.map((part) => {
                const active = part.id === selectedPart?.id;
                const onToy = placements.some((p) => p.partId === part.id);
                return (
                  <button
                    key={part.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? "tv-opt tv-opt-on" : "tv-opt"}
                    style={{ minHeight: 68 }}
                    onClick={() => {
                      setSelectedPartId(part.id);
                      setNotice(null);
                    }}
                  >
                    <span>{part.name}</span>
                    <span className="tv-opt-meta">
                      {part.line.toUpperCase()} · {part.stat.name} +{part.stat.value}
                    </span>
                    {onToy && (
                      <span className="tv-opt-lk" style={{ color: "var(--mint)" }}>
                        On {toy.name}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedPart && (
              <>
                <div className="tv-fg-b" style={{ flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={isEquipped ? "tv-ctl tv-ctl-sky" : "tv-ctl tv-ctl-primary"}
                    onClick={() => toggleEquip(selectedPart)}
                  >
                    {isEquipped
                      ? `Equipped on ${toy.name} (remove)`
                      : `Equip ${selectedPart.name} on ${toy.name}`}
                  </button>
                  {viewMode === "grid" && (
                    <>
                      <button
                        type="button"
                        className="tv-ctl"
                        disabled={!isEquipped && placements.length === 0}
                        onClick={rotateSelected}
                      >
                        Rotate 90°
                      </button>
                      <button
                        type="button"
                        className="tv-ctl"
                        disabled={history.length === 0}
                        onClick={undo}
                      >
                        Undo
                      </button>
                    </>
                  )}
                </div>

                {notice && (
                  <p className="error" style={{ margin: 0, fontSize: 12 }}>
                    {notice}
                  </p>
                )}

                {viewMode === "ar" ? (
                  glbFile ? (
                    <TryOn toy={toy} part={selectedPart} glbFile={glbFile} />
                  ) : (
                    <p className="tv-moves">3D preview ready via STL download below.</p>
                  )
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <BuilderCanvas
                      board={board}
                      toyLabel={toy.name}
                      placements={placements}
                      partsById={partsById}
                      selectedId={selectedInstanceId}
                      gridPitchMm={gridPitchMm}
                      onSelect={(id) => {
                        setSelectedInstanceId(id);
                        const placed = placements.find((p) => p.instanceId === id);
                        if (placed) setSelectedPartId(placed.partId);
                      }}
                      onMove={handleMove}
                    />
                    <div className="checks-grid" aria-label="Four engineering checks">
                      {checks.map((ck) => (
                        <div
                          key={ck.id}
                          className={
                            ck.pass
                              ? "check-pill check-pill-ok"
                              : "check-pill check-pill-bad"
                          }
                        >
                          <span className="check-pill-tag">
                            {ck.pass ? "OK" : "FAIL"}
                          </span>
                          <span>{ck.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="tv-print-meta">
                  <span>
                    <strong>{selectedPart.name}</strong> · 0.2 mm PLA ·{" "}
                    {selectedPart.orientation ?? "flat"} · support-free · Prototype (not age-certified)
                  </span>
                </div>

                {selectedPart.smallPartWarning && (
                  <p className="tv-small-part-warn" role="note">
                    <strong>Ages 3+ · WARNING: CHOKING HAZARD: Small parts.</strong> Not for children under 3 years (ASTM F963 / 16 CFR § 1500.19).
                  </p>
                )}

                {canDownloadStl ? (
                  <a
                    className="cta cta-violet"
                    style={{ margin: 0, minHeight: 44, fontSize: 15 }}
                    href={`/parts-stl/${stlFile}`}
                    download={stlFile}
                  >
                    Download {selectedPart.name} STL
                  </a>
                ) : (
                  <p className="tv-moves">
                    Print file stays hidden until all 4 fit and bed checks pass.
                  </p>
                )}

                <details className="tv-disclosure" style={{ padding: "6px 10px" }}>
                  <summary>
                    <span>Engineering check details</span>
                    <span className="tv-disclosure-meta">
                      {selectedPart.footprintMm[0]}×{selectedPart.footprintMm[1]} mm
                    </span>
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <CheckList results={checks} />
                  </div>
                </details>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
