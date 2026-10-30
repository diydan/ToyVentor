import { buildStats } from "../../shared/build";
import { rarityForPart } from "../../shared/pack";
import type { Toy } from "../../shared/toy";
import { kipDemoUrl, toyContractFromBuild } from "../../shared/toycontract";
import { PartCard } from "../components/PartCard";
import { colorOf } from "../features/builder/engine/render";
import { SkinPanel } from "../features/skin/SkinPanel";
import { loadBuild } from "../lib/builds";
import { allParts, catalogErrors as setErrors, partsById } from "../lib/catalog";
import { revealsForToy } from "../state/reveals";
import { skinForToy } from "../state/skins";
import { useToybox } from "../state/toybox";

function toySourceLabel(toy: Toy): string {
  return toy.source === "seed"
    ? "starter"
    : toy.source === "manual"
      ? "by hand"
      : "SAM scan";
}

function ToyEmblem({ toy, size = 34 }: { toy: Toy; size?: number }) {
  if (toy.imageDataUrl) {
    return (
      <img
        src={toy.imageDataUrl}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }
  if (toy.id === "seed-kip") {
    return (
      <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <circle cx="22" cy="14" r="8" fill="#ffd24d" stroke="#080f2b" strokeWidth="2.2" />
        <circle cx="13" cy="14" r="3" fill="#52b7ff" />
        <circle cx="31" cy="14" r="3" fill="#52b7ff" />
        <circle cx="19.5" cy="13.5" r="1.5" fill="#080f2b" />
        <circle cx="24.5" cy="13.5" r="1.5" fill="#080f2b" />
        <rect x="14" y="23" width="16" height="14" rx="5" fill="#a78bff" stroke="#080f2b" strokeWidth="2.2" />
        <rect x="18" y="4" width="8" height="4" rx="1.5" fill="#5af0b0" />
      </svg>
    );
  }
  if (toy.kind === "car") {
    return (
      <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <path d="M6 21h5l2-5h15l4 5h6a3 3 0 0 1 3 3v6H4v-6a3 3 0 0 1 2-3Z" fill="#ff6a5c" stroke="#080f2b" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M15 17h11l2.8 4H13.5L15 17Z" fill="#9bd4ff" />
        <rect x="5" y="16" width="6" height="2.6" rx="1" fill="#52b7ff" />
        <circle cx="13" cy="30" r="4.5" fill="#080f2b" stroke="#bfcaf5" strokeWidth="2" />
        <circle cx="31" cy="30" r="4.5" fill="#080f2b" stroke="#bfcaf5" strokeWidth="2" />
      </svg>
    );
  }
  if (toy.kind === "figure") {
    return (
      <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <circle cx="22" cy="13" r="7" fill="#52b7ff" stroke="#080f2b" strokeWidth="2.2" />
        <rect x="18" y="11" width="8" height="3.2" rx="1.6" fill="#ffd24d" />
        <path d="M13 24a5 5 0 0 1 5-4h8a5 5 0 0 1 5 4l1.5 12h-21L13 24Z" fill="#5af0b0" stroke="#080f2b" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="9" y="14" width="26" height="20" rx="5" fill="#52b7ff" stroke="#080f2b" strokeWidth="2.2" />
      <circle cx="16.5" cy="11" r="3" fill="#ffd24d" />
      <circle cx="27.5" cy="11" r="3" fill="#ffd24d" />
    </svg>
  );
}

function ToyCardGrid({
  toys,
  selected,
  onSelect,
}: {
  toys: Toy[];
  selected: Toy | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="toy-card-grid">
      {toys.map((toy) => {
        const active = toy.id === selected?.id;
        return (
          <li key={toy.id}>
            <button
              type="button"
              className={active ? "toy-card toy-card-active" : "toy-card"}
              aria-pressed={active}
              onClick={() => onSelect(toy.id)}
            >
              <span className="toy-avatar" aria-hidden="true">
                <ToyEmblem toy={toy} size={36} />
              </span>
              <span className="toy-card-copy">
                <span className="toy-card-name">{toy.name}</span>
                <span className="toy-card-meta">
                  {toy.sizeClass} · {toySourceLabel(toy)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ToyboxScreen({
  onScan,
  onBuild,
  onPlay,
  onReveal,
}: {
  onScan: () => void;
  onBuild?: () => void;
  onPlay?: () => void;
  onReveal?: () => void;
}) {
  const { uploadedToys, builtInToys, selected, selectToy } = useToybox();
  const placements = selected ? loadBuild(selected.id, partsById) : [];
  const stats = buildStats(placements, partsById);
  const statEntries = Object.entries(stats.statTotals).filter(([, v]) => v > 0);
  const savedReveals = selected ? revealsForToy(selected.id) : [];
  const activeArt = selected
    ? skinForToy(selected.id) ?? selected.imageDataUrl
    : undefined;

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">Toybox</h1>
        <button
          type="button"
          className="tv-ctl tv-ctl-sky"
          onClick={onScan}
        >
          + Scan new
        </button>
      </header>

      <div className="glass-card">
        {uploadedToys.length > 0 && (
          <>
            <span className="kicker-label">Your uploads</span>
            <ToyCardGrid
              toys={uploadedToys}
              selected={selected}
              onSelect={selectToy}
            />
          </>
        )}

        <span
          className="kicker-label"
          style={{ marginTop: uploadedToys.length > 0 ? 12 : 0 }}
        >
          Starter workbench toys
        </span>
        <ToyCardGrid
          toys={builtInToys}
          selected={selected}
          onSelect={selectToy}
        />
        {uploadedToys.length === 0 && (
          <p className="fine-print" style={{ margin: "8px 0 0" }}>
            Own a car, figure, or cup? Tap <strong>+ Scan new</strong> above to
            outline it with Meta SAM 3.1.
          </p>
        )}
      </div>

      {selected && (
        <>
          <div className="glass-card" style={{ marginTop: 12 }}>
            <div className="toy-spotlight-head">
              <div className="toy-turntable">
                {activeArt ? (
                  <img src={activeArt} alt={selected.name} />
                ) : (
                  <ToyEmblem toy={selected} size={64} />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="kicker-label kicker-gold" style={{ marginBottom: 2 }}>
                  Active toy
                </span>
                <h2 style={{ margin: "0 0 4px", fontSize: 23, lineHeight: 1.15 }}>
                  {selected.name}
                </h2>
                <p className="part-meta" style={{ margin: 0 }}>
                  {selected.lengthMm}×{selected.widthMm} mm · {selected.sizeClass} ·{" "}
                  {placements.length > 0
                    ? `${placements.length} part${placements.length === 1 ? "" : "s"} equipped`
                    : "stock build"}
                </p>
              </div>
            </div>

            {statEntries.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                {statEntries.map(([name, val]) => (
                  <div key={name} className="stat-row">
                    <span className="stat-name">{name}</span>
                    <div className="stat-track">
                      <div
                        className="stat-fill"
                        style={{
                          width: `${Math.min(100, val * 16)}%`,
                          background: `var(--stat-${name}, var(--sky-500))`,
                        }}
                      />
                    </div>
                    <span className="stat-val">+{val}</span>
                  </div>
                ))}
              </div>
            )}

            {onBuild && (
              <button
                type="button"
                className="cta"
                style={{ margin: "0 0 10px" }}
                onClick={onBuild}
              >
                Build on {selected.name}
              </button>
            )}

            <div className="tv-fg-b" style={{ flexWrap: "wrap" }}>
              {onPlay && (
                <button
                  type="button"
                  className="tv-ctl tv-ctl-violet"
                  style={{ minHeight: 44 }}
                  onClick={onPlay}
                >
                  Play in World
                </button>
              )}
              {selected.kind === "figure" && (
                <a
                  className="tv-ctl"
                  style={{ minHeight: 44 }}
                  href={kipDemoUrl(
                    toyContractFromBuild(selected, placements, partsById, colorOf),
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Kip 3D Rig
                </a>
              )}
              {savedReveals[0] && onReveal && (
                <button
                  type="button"
                  className="tv-ctl tv-ctl-primary"
                  style={{ minHeight: 44 }}
                  onClick={onReveal}
                >
                  Card: {savedReveals[0].title}
                </button>
              )}
            </div>
          </div>

          <SkinPanel key={selected.id} toy={selected} />

          <h2 style={{ fontSize: 20, marginBottom: 8 }}>
            Parts library for {selected.name}
          </h2>
          {setErrors.length > 0 ? (
            <p className="error">Base set is invalid: {setErrors.join("; ")}</p>
          ) : (
            allParts.map((part) => (
              <PartCard
                key={part.id}
                part={part}
                toy={selected}
                rarity={rarityForPart(part)}
              />
            ))
          )}
        </>
      )}
    </section>
  );
}
