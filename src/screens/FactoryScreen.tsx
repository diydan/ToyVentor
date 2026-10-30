import { loadBuild } from "../lib/builds";
import { partsById } from "../lib/catalog";
import { useToybox } from "../state/toybox";

export function FactoryScreen({
  onScan,
  onBuild,
  onToybox,
  onPacks,
  onMarket,
  onPlay,
}: {
  onScan: () => void;
  onBuild: () => void;
  onToybox: () => void;
  onPacks: () => void;
  onMarket: () => void;
  onPlay: () => void;
}) {
  const { uploadedToys, builtInToys, selected } = useToybox();
  const placements = selected ? loadBuild(selected.id, partsById) : [];

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">ToyVentor</h1>
        <button type="button" className="tv-ctl" onClick={onToybox}>
          {uploadedToys.length + builtInToys.length} toys
        </button>
      </header>

      <div className="glass-card" style={{ marginBottom: 14 }}>
        <div className="resume-card">
          <div>
            <span className="kicker-label" style={{ marginBottom: 2 }}>
              Resume
            </span>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              {selected
                ? `${selected.name}${placements.length > 0 ? `, ${placements.length} parts` : ""}`
                : "Start your first toy"}
            </div>
          </div>
          <button
            type="button"
            className="cta"
            style={{ width: "auto", minHeight: 46, margin: 0, padding: "0 20px" }}
            onClick={selected ? (placements.length > 0 ? onPlay : onBuild) : onScan}
          >
            Continue
          </button>
        </div>
      </div>

      <span className="kicker-label">What do you want to do?</span>

      <div className="station-grid">
        <button type="button" className="station-tile" onClick={onBuild}>
          <span className="station-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 44 44">
              <g
                fill="#52b7ff"
                stroke="#080f2b"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="17" width="26" height="15" rx="3" />
                <circle cx="16" cy="13" r="3.5" />
                <circle cx="28" cy="13" r="3.5" />
              </g>
            </svg>
          </span>
          <div>
            <div className="station-verb">Build</div>
            <div className="station-desc">Snap parts onto your toy.</div>
            <div className="station-meta">Grid, AR try-on, 3D print</div>
          </div>
        </button>

        <button type="button" className="station-tile" onClick={onPlay}>
          <span className="station-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 44 44">
              <path
                d="M14 9 L34 22 L14 35 Z"
                fill="#a78bff"
                stroke="#080f2b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <div className="station-verb">Play</div>
            <div className="station-desc">Bring your toy into the world.</div>
            <div className="station-meta">ToyVentor World, Create, Labs</div>
          </div>
        </button>

        <button type="button" className="station-tile" onClick={onPacks}>
          <span className="station-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 44 44">
              <path
                d="M22 7 L25.5 18.5 L37 22 L25.5 25.5 L22 37 L18.5 25.5 L7 22 L18.5 18.5 Z"
                fill="#ffd24d"
                stroke="#080f2b"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <div className="station-verb">Packs</div>
            <div className="station-desc">Rip your daily part pack.</div>
            <div className="station-meta">3 parts, 1 printable</div>
          </div>
        </button>

        <button type="button" className="station-tile" onClick={onMarket}>
          <span className="station-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 44 44">
              <g
                fill="#5af0b0"
                stroke="#080f2b"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <circle cx="16" cy="22" r="9" />
                <circle cx="28" cy="22" r="9" fill="#ff9d5c" />
              </g>
            </svg>
          </span>
          <div>
            <div className="station-verb">Market</div>
            <div className="station-desc">Browse parts guaranteed to fit.</div>
            <div className="station-meta">Filtered to your toy</div>
          </div>
        </button>
      </div>

      <button
        type="button"
        className="cta cta-quiet"
        style={{ marginTop: 16 }}
        onClick={onScan}
      >
        Scan a new toy with Meta SAM 3.1
      </button>
    </section>
  );
}
