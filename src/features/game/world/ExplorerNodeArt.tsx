import type { ExplorerNode } from "../../../lib/explorerMap";
import { STOP_GLYPH, THEME_COLOR } from "../../../lib/mapCards";

// Overworld markers, drawn like the old console maps: a ringed level dot
// (yellow until cleared, then blue), a red dot for a secret exit, a castle
// for each lab, a house for home, a puff of cloud where fog still hides the
// place. 64x64 boxes; the button around each one is the tap target.

const INK = "#1e2a6b";
const SHADOW = "rgba(10, 20, 70, 0.3)";

function darken(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function Dot({
  color,
  glyph,
  scale,
  complete,
  sparkle = false,
  night = false,
}: {
  color: string;
  glyph: string;
  scale: number;
  complete: boolean;
  sparkle?: boolean;
  night?: boolean;
}) {
  const dark = darken(color, 0.55);
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" data-lit={night ? "1" : undefined}>
      {night ? <circle cx="32" cy="31" r="30" fill="#ffe9a0" opacity="0.26" /> : null}
      <ellipse cx="32" cy="52" rx="19" ry="6" fill={SHADOW} />
      <g transform={`translate(32 31) scale(${scale}) translate(-32 -31)`}>
        <circle cx="32" cy="31" r="22" fill={complete ? "#ffe9a0" : "#fffaf0"} stroke={INK} strokeWidth="3" />
        <circle cx="32" cy="31" r="16.5" fill={color} stroke={dark} strokeWidth="2.2" />
        <ellipse
          cx="25.5"
          cy="24"
          rx="6.2"
          ry="3.3"
          fill="#fff"
          opacity="0.55"
          transform="rotate(-28 25.5 24)"
        />
        {glyph ? (
          <text
            x="32"
            y="37"
            textAnchor="middle"
            fontSize={glyph.length > 1 ? 14 : 18}
            fontWeight="800"
            fill="#fff"
            stroke={dark}
            strokeWidth="2.6"
            paintOrder="stroke"
            fontFamily="Figtree, system-ui, sans-serif"
          >
            {glyph}
          </text>
        ) : null}
        {sparkle ? (
          <g fill="#ffe066" stroke={INK} strokeWidth="1.4" strokeLinejoin="round">
            <path d="M8 12l2.2 4.6L15 19l-4.8 2.4L8 26l-2.2-4.6L1 19l4.8-2.4z" />
            <path d="M55 40l1.8 3.8 3.8 1.8-3.8 1.8L55 51l-1.8-3.8-3.8-1.8 3.8-1.8z" />
          </g>
        ) : null}
        {complete ? (
          <g transform="translate(47 14)">
            <circle r="9" fill="#ffd23f" stroke={INK} strokeWidth="2.2" />
            <path d="M-4.5 0.5 L-1.2 4 L5 -3.6" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

function Castle({ theme, complete, night }: { theme: string; complete: boolean; night: boolean }) {
  const flag = complete ? "#3d9bff" : (THEME_COLOR[theme] ?? "#ff5148");
  const stone = "#d6d9e0";
  const edge = "#5b6270";
  const lit = night ? "#ffd866" : "#4a3426";
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" data-lit={night ? "1" : undefined}>
      {night ? <ellipse cx="32" cy="42" rx="31" ry="22" fill="#ffd866" opacity="0.22" /> : null}
      <ellipse cx="32" cy="55" rx="23" ry="6" fill={SHADOW} />
      <g stroke={edge} strokeWidth="2.2" strokeLinejoin="round">
        <rect x="9" y="26" width="14" height="29" fill={stone} />
        <rect x="41" y="26" width="14" height="29" fill={stone} />
        <rect x="20" y="31" width="24" height="24" fill="#e8eaf0" />
        <path d="M9 26h4v-4h3v4h3v-4h4v4M41 26h4v-4h3v4h3v-4h4v4" fill={stone} />
        <path d="M20 31h5v-4h4v4h6v-4h4v4h5" fill="#e8eaf0" />
      </g>
      <path d="M27 55v-10a5 5 0 0 1 10 0v10z" fill={night ? "#ffb84a" : "#4a3426"} stroke={edge} strokeWidth="2" />
      <rect x="14" y="34" width="4" height="7" rx="2" fill={lit} />
      <rect x="46" y="34" width="4" height="7" rx="2" fill={lit} />
      <line x1="32" y1="31" x2="32" y2="13" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M32 13l15 5-15 5z" fill={flag} stroke={darken(flag, 0.55)} strokeWidth="2" strokeLinejoin="round" />
      {complete ? <circle cx="32" cy="9" r="3" fill="#ffd23f" stroke={INK} strokeWidth="1.5" /> : null}
    </svg>
  );
}

function House({ complete, night }: { complete: boolean; night: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" data-lit={night ? "1" : undefined}>
      {night ? <ellipse cx="32" cy="42" rx="32" ry="22" fill="#ffd866" opacity="0.22" /> : null}
      <ellipse cx="32" cy="55" rx="24" ry="6" fill={SHADOW} />
      <rect x="44" y="12" width="7" height="14" fill="#c9553f" stroke={INK} strokeWidth="2.2" />
      <rect x="12" y="29" width="40" height="26" rx="2" fill="#ffe3a8" stroke={INK} strokeWidth="2.6" />
      <path d="M7 31 32 9l25 22z" fill={complete ? "#3d9bff" : "#e0523f"} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M27 55V42a5 5 0 0 1 10 0v13z" fill={night ? "#ffb84a" : "#8a5a2b"} stroke={INK} strokeWidth="2.2" />
      <rect x="15" y="35" width="8" height="8" rx="1.5" fill={night ? "#ffe28a" : "#bfe6ff"} stroke={INK} strokeWidth="2" />
      <rect x="41" y="35" width="8" height="8" rx="1.5" fill={night ? "#ffe28a" : "#bfe6ff"} stroke={INK} strokeWidth="2" />
    </svg>
  );
}

/**
 * The Garage: a small workshop with a roll-up door. By day with no drop waiting
 * the door is down. On a weekend with a new drop the door is rolled up on a
 * warm-lit bay, with sparks. At night the windows are lit either way.
 */
/**
 * Finished weekends as roof trophies: up to four small stars along the roof
 * edge, then a count. Permanent while the weekends stay finished.
 */
function Trophies({ count }: { count: number }) {
  const shown = Math.min(4, count);
  if (shown <= 0) return null;
  return (
    <g aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <path
          key={i}
          transform={`translate(${18 + i * 9.5} 8.5) scale(0.55)`}
          d="M0-8l2.4 4.9 5.4.8-3.9 3.8.9 5.4L0 4.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
          fill="#ffd24d"
          stroke={INK}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      ))}
      {count > shown ? (
        <text x="58" y="12" textAnchor="end" fontSize="9" fontWeight="900" fill={INK} fontFamily="Figtree, system-ui, sans-serif">
          +{count - shown}
        </text>
      ) : null}
    </g>
  );
}

function Garage({ hot, done, night, trophies = 0 }: { hot: boolean; done: boolean; night: boolean; trophies?: number }) {
  const lit = hot || night;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" data-lit={lit ? "1" : undefined}>
      {lit ? <ellipse cx="32" cy="42" rx="32" ry="22" fill="#ffd866" opacity={hot ? 0.34 : 0.22} /> : null}
      <ellipse cx="32" cy="55" rx="25" ry="6" fill={SHADOW} />
      <rect x="8" y="27" width="48" height="28" rx="3" fill="#e8edf7" stroke={INK} strokeWidth="2.6" />
      <path d="M4 29 32 11l28 18z" fill="#6f7fa8" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <Trophies count={trophies} />
      <rect x="15" y="35" width="34" height="20" rx="2" fill={hot ? "#ffd866" : "#c7d2e6"} stroke={INK} strokeWidth="2.2" />
      {hot ? (
        <>
          <rect x="15" y="35" width="34" height="5" fill="#9fb3d1" stroke={INK} strokeWidth="1.8" />
          <path d="M21 55l5-9h12l5 9z" fill="#fff3b0" opacity="0.8" />
        </>
      ) : (
        <g stroke="#7f92b4" strokeWidth="1.8">
          <path d="M15 41h34M15 46h34M15 51h34" />
        </g>
      )}
      <circle cx="32" cy="22" r="4.2" fill="#ffd24d" stroke={INK} strokeWidth="1.8" />
      {hot ? (
        <g fill="#fff3b0" stroke={INK} strokeWidth="1.2" strokeLinejoin="round">
          <g className="tv-trail-firefly">
            <path d="M8 38l1.6 3.4L13 43l-3.4 1.6L8 48l-1.6-3.4L3 43l3.4-1.6z" />
          </g>
          <g className="tv-trail-firefly" style={{ animationDelay: "0.9s" }}>
            <path d="M56 33l1.4 3L60 37.4l-3 1.4L56 42l-1.4-3.2L52 37.4l3-1.4z" />
          </g>
        </g>
      ) : null}
      {done ? (
        <g transform="translate(52 14)">
          <circle r="9" fill="#ffd24d" stroke={INK} strokeWidth="2.2" />
          <path d="M-4.5 0.5L-1.2 4 5-3.6" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}
    </svg>
  );
}

function Sign() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="54" rx="14" ry="5" fill={SHADOW} />
      <rect x="29" y="30" width="6" height="24" fill="#8a5a2b" stroke={INK} strokeWidth="2" />
      <rect x="12" y="10" width="40" height="26" rx="5" fill="#ffe9b0" stroke={INK} strokeWidth="2.6" />
      <text x="32" y="30" textAnchor="middle" fontSize="20" fontWeight="900" fill={INK} fontFamily="Figtree, system-ui, sans-serif">?</text>
    </svg>
  );
}

function CloudPuff({ night }: { night: boolean }) {
  const body = night ? "#4d62ae" : "#fff";
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="52" rx="19" ry="5" fill={night ? "rgba(8, 14, 50, 0.4)" : "rgba(60, 100, 150, 0.22)"} />
      <g fill={body} stroke={night ? "#2f3f86" : "#bcd8f2"} strokeWidth="2">
        <circle cx="21" cy="36" r="11" />
        <circle cx="33" cy="28" r="14" />
        <circle cx="46" cy="37" r="10" />
        <rect x="14" y="37" width="38" height="12" rx="6" />
      </g>
      <rect x="16" y="37" width="34" height="11" rx="5.5" fill={body} />
      <text x="33" y="42" textAnchor="middle" fontSize="19" fontWeight="900" fill={night ? "#c9d5ff" : "#6aa0d8"} fontFamily="Figtree, system-ui, sans-serif">?</text>
    </svg>
  );
}

/** The marker for one place, picked from its kind and its fog. */
export function NodeArt({ node, night = false }: { node: ExplorerNode; night?: boolean }) {
  if (node.fog === "clouded") return <CloudPuff night={night} />;
  if (node.kind === "ask") return <Sign />;
  if (node.kind === "lab") return <Castle theme={node.theme} complete={node.complete} night={night} />;
  if (node.id === "room") return <House complete={node.complete} night={night} />;
  if (node.kind === "garage") {
    return (
      <Garage
        hot={node.card?.badge === "new"}
        done={node.complete}
        night={night}
        trophies={node.card?.trophies ?? 0}
      />
    );
  }
  if (node.kind === "frontier") {
    return <Dot color="#ff5148" glyph="?" scale={1} complete={false} night={night} />;
  }
  // A secret exit: a violet star dot, with sparkles so it reads as special.
  if (node.kind === "secret") {
    return <Dot color="#a78bff" glyph="★" scale={1.08} complete={node.complete} sparkle night={night} />;
  }
  const world = node.kind === "world";
  // Worlds keep their own colour when cleared (the tick says so), because two
  // of them are blue and blue also means "cleared" on the plain level dots.
  const color = world
    ? (THEME_COLOR[node.theme] ?? "#ffd23f")
    : node.complete
      ? "#3d9bff"
      : "#ffd23f";
  return (
    <Dot
      color={color}
      glyph={STOP_GLYPH[node.id] ?? ""}
      scale={world ? 1.1 : 0.92}
      complete={node.complete}
      night={night}
    />
  );
}
