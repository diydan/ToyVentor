import { memo } from "react";
import { fnv1a } from "../../../lib/explorerMap";
import { mixColor, UNIT, type ArtNode, type Decor, type Puff } from "../../../lib/explorerArt";

// The still part of the overworld: sea, land, scenery, and the cloud bank.
// Nothing here depends on progress, so the component is memoised and React
// leaves it alone while the child plays. Roads and fog change with progress
// and are drawn by ExplorerMap on top.

/** Ground colour around each kind of world; the base land is meadow. */
const GROUND: Record<string, string> = {
  garden: "#7fd957",
  beach: "#f3dc94",
  junk: "#c99b6c",
  snow: "#eaf5ff",
  sky: "#bfe9f6",
  room: "#e9bb80",
};
const MEADOW = "#86da60";

/** How much the night overlay darkens the map at full darkness. */
const NIGHT_VEIL = 0.6;

// Fat enough that loops of road close into solid land, not little lagoons.
const LAND_NODE_R = 1.1 * UNIT;
const LAND_ROAD_W = 1.05 * UNIT;

function LandShapes({
  nodes,
  roadPaths,
  grow,
  color,
}: {
  nodes: readonly ArtNode[];
  roadPaths: readonly string[];
  grow: number;
  color: string;
}) {
  return (
    <g fill={color} stroke={color} strokeLinecap="round" strokeLinejoin="round">
      {roadPaths.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={LAND_ROAD_W + grow * 2} />
      ))}
      {nodes.map((n) => (
        <circle key={n.id} cx={n.x} cy={n.y} r={LAND_NODE_R + grow} strokeWidth="0" />
      ))}
    </g>
  );
}

function DecorSymbols() {
  const shadow = <ellipse cx="0" cy="2" rx="15" ry="5" fill="rgba(20,40,10,0.22)" />;
  return (
    <defs>
      <g id="tvt-tree">
        {shadow}
        <rect x="-3" y="-17" width="6" height="19" rx="2" fill="#8a5a2b" />
        <circle cx="0" cy="-29" r="17" fill="#3da34d" stroke="#1d6a35" strokeWidth="2" />
        <circle cx="-5" cy="-34" r="7" fill="#66cb6e" />
      </g>
      <g id="tvt-pine">
        {shadow}
        <rect x="-3" y="-12" width="6" height="14" rx="2" fill="#6e4a28" />
        <path d="M0-52 17-20H-17Z" fill="#2f9470" stroke="#1b5f47" strokeWidth="2" strokeLinejoin="round" />
        <path d="M0-36 21-6H-21Z" fill="#2a8566" stroke="#1b5f47" strokeWidth="2" strokeLinejoin="round" />
        <path d="M0-52 7-41-7-41Z" fill="#fff" />
        <path d="M0-36 8-26-8-26Z" fill="#fff" />
      </g>
      <g id="tvt-palm">
        {shadow}
        <path d="M0 2Q7-18 2-42" fill="none" stroke="#9b6a35" strokeWidth="6" strokeLinecap="round" />
        <g fill="none" stroke="#2fa05a" strokeWidth="6" strokeLinecap="round">
          <path d="M2-42Q22-56 34-38" />
          <path d="M2-42Q-18-56-32-38" />
          <path d="M2-42Q14-62 22-60" />
          <path d="M2-42Q-10-62-18-58" />
        </g>
        <circle cx="4" cy="-40" r="3.4" fill="#7a4b22" />
      </g>
      <g id="tvt-hill">
        <ellipse cx="0" cy="2" rx="30" ry="6" fill="rgba(20,40,10,0.2)" />
        <path d="M-28 0Q-28-38 0-38Q28-38 28 0Z" fill="#6fd05a" stroke="#2f8a3b" strokeWidth="2.4" />
        <path d="M-17-22Q-12-30-4-31" fill="none" stroke="#a6ec8a" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g id="tvt-rock">
        {shadow}
        <path d="M-15 1-11-14 2-19 14-9 17 1Z" fill="#a4acb6" stroke="#5d6670" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M-9-12 1-16" fill="none" stroke="#d5dbe2" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g id="tvt-flower">
        <line x1="0" y1="2" x2="0" y2="-11" stroke="#2f8a3b" strokeWidth="2.4" strokeLinecap="round" />
        <g fill="#ff7fb0">
          <circle cx="0" cy="-19" r="4.4" />
          <circle cx="-5" cy="-14" r="4.4" />
          <circle cx="5" cy="-14" r="4.4" />
          <circle cx="-3" cy="-10" r="4.4" />
          <circle cx="3" cy="-10" r="4.4" />
        </g>
        <circle cx="0" cy="-14" r="3.2" fill="#ffe066" />
      </g>
      <g id="tvt-peak">
        <ellipse cx="0" cy="2" rx="28" ry="6" fill="rgba(40,60,90,0.2)" />
        <path d="M-27 1 0-54 27 1Z" fill="#8ea3bd" stroke="#566a85" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M-10-34 0-54 10-34 4-38 0-31-4-38Z" fill="#fff" stroke="#c9d7e8" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g id="tvt-puff">
        <ellipse cx="0" cy="4" rx="22" ry="5" fill="rgba(60,120,170,0.18)" />
        <g fill="#fff" stroke="#cbe6f6" strokeWidth="2">
          <circle cx="-13" cy="-9" r="11" />
          <circle cx="1" cy="-16" r="14" />
          <circle cx="15" cy="-9" r="10" />
        </g>
        <rect x="-22" y="-9" width="44" height="12" rx="6" fill="#fff" />
      </g>
      <g id="tvt-junk">
        {shadow}
        <rect x="-15" y="-25" width="20" height="26" rx="4" fill="#b9653a" stroke="#6a3a1d" strokeWidth="2.2" />
        <path d="M-15-17H5M-15-8H5" stroke="#6a3a1d" strokeWidth="2" />
        <circle cx="16" cy="-9" r="10" fill="#2e3440" stroke="#161a20" strokeWidth="2" />
        <circle cx="16" cy="-9" r="4.2" fill="#8b95a5" />
      </g>
      <g id="tvt-lamp">
        {shadow}
        <rect x="-2.5" y="-34" width="5" height="36" rx="2" fill="#56616d" />
        <path d="M-10-34 10-34 7-47-7-47Z" fill="#6f7c8a" stroke="#2f3944" strokeWidth="2" strokeLinejoin="round" />
        <rect x="-5.5" y="-45" width="11" height="11" rx="3" fill="#f6efc4" stroke="#2f3944" strokeWidth="1.6" />
      </g>
      <radialGradient id="tvt-lamp-glow">
        <stop offset="0" stopColor="#ffe9a0" stopOpacity="0.85" />
        <stop offset="0.45" stopColor="#ffd866" stopOpacity="0.32" />
        <stop offset="1" stopColor="#ffd866" stopOpacity="0" />
      </radialGradient>
      <g id="tvt-block">
        {shadow}
        <g transform="rotate(-7)">
          <rect x="-14" y="-28" width="28" height="28" rx="4" fill="#ff7f6e" stroke="#a84333" strokeWidth="2.4" />
          <rect x="-14" y="-28" width="28" height="8" rx="4" fill="#ffa496" />
          <circle cx="0" cy="-11" r="5" fill="#fff4d6" />
        </g>
      </g>
      <pattern id="tvt-waves" width="64" height="36" patternUnits="userSpaceOnUse">
        <path d="M6 12q6-7 12 0t12 0" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M38 30q6-7 12 0t12 0" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="2.4" strokeLinecap="round" />
      </pattern>
      <linearGradient id="tvt-sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5cc0ff" />
        <stop offset="1" stopColor="#2a86d6" />
      </linearGradient>
    </defs>
  );
}

export interface WorldArtProps {
  width: number;
  height: number;
  nodes: readonly ArtNode[];
  roadPaths: readonly string[];
  decor: readonly Decor[];
  /** 0 = day, 1 = night. The same scene, darker, with the lights on. */
  darkness?: number;
}

export const WorldArt = memo(function WorldArt({
  width,
  height,
  nodes,
  roadPaths,
  decor,
  darkness = 0,
}: WorldArtProps) {
  return (
    <g>
      <DecorSymbols />
      <rect width={width} height={height} fill="url(#tvt-sea)" />
      <rect className="tv-trail-waves" x="-64" y="-36" width={width + 128} height={height + 72} fill="url(#tvt-waves)" />
      {/* coast: foam, a ring of sand, then the meadow */}
      <LandShapes nodes={nodes} roadPaths={roadPaths} grow={18} color="#f6fbff" />
      <LandShapes nodes={nodes} roadPaths={roadPaths} grow={9} color="#f4e2a6" />
      <LandShapes nodes={nodes} roadPaths={roadPaths} grow={0} color={MEADOW} />
      <defs>
        <mask id="tvt-land-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <LandShapes nodes={nodes} roadPaths={roadPaths} grow={0} color="#fff" />
        </mask>
        <filter id="tvt-tint-blur" filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      {/* each region tints the meadow around its places */}
      <g mask="url(#tvt-land-mask)">
        <g filter="url(#tvt-tint-blur)">
          {nodes.map((n) =>
            n.theme !== "garden" && GROUND[n.theme] ? (
              <circle key={n.id} cx={n.x} cy={n.y} r={0.82 * UNIT} fill={GROUND[n.theme]} />
            ) : null,
          )}
        </g>
      </g>
      {decor.map((d, i) => (
        <use
          key={i}
          href={`#tvt-${d.kind}`}
          transform={`translate(${d.x.toFixed(1)} ${d.y.toFixed(1)}) scale(${d.s.toFixed(2)})`}
        />
      ))}
      {darkness > 0 ? <NightLights width={width} height={height} decor={decor} darkness={darkness} /> : null}
    </g>
  );
});

/**
 * Night on the map: the same scene under a deep-blue veil, with its lights on.
 * Lamp posts glow and a few fireflies drift over the meadow. These sit above
 * the veil so they stay bright. `darkness` scales it, so a later continuous
 * time of day (environment-spec.md) is a different number, not different art.
 */
function NightLights({
  width,
  height,
  decor,
  darkness,
}: {
  width: number;
  height: number;
  decor: readonly Decor[];
  darkness: number;
}) {
  const lamps = decor.filter((d) => d.kind === "lamp");
  const flies = decor.filter((d, i) => i % 6 === 1 && d.kind !== "lamp" && d.kind !== "puff");
  return (
    <g className="tv-trail-nightfall" aria-hidden="true">
      <rect width={width} height={height} fill="#0b1a55" fillOpacity={NIGHT_VEIL * darkness} />
      <g opacity={darkness}>
        {lamps.map((d, i) => (
          <g key={`l${i}`} transform={`translate(${d.x.toFixed(1)} ${(d.y - 40 * d.s).toFixed(1)})`}>
            <circle r={58 * d.s} fill="url(#tvt-lamp-glow)" />
            <circle r={6 * d.s} fill="#fff6c2" />
          </g>
        ))}
        {flies.map((d, i) => {
          const h = fnv1a(`fly:${Math.round(d.x)},${Math.round(d.y)}`);
          return (
            <g
              key={`f${i}`}
              className="tv-trail-firefly"
              style={{ animationDelay: `${((h % 9) * 0.37).toFixed(2)}s` }}
              transform={`translate(${(d.x + ((h >>> 4) % 31) - 15).toFixed(1)} ${(d.y - 22 - ((h >>> 9) % 28)).toFixed(1)})`}
            >
              <circle r="9" fill="url(#tvt-lamp-glow)" />
              <circle r="2.2" fill="#fff8b8" />
            </g>
          );
        })}
      </g>
    </g>
  );
}

export interface FogBankProps {
  width: number;
  height: number;
  puffs: readonly Puff[];
  /** 0 = day clouds, 1 = night clouds. */
  darkness?: number;
}

/** The cloud bank itself. ExplorerMap masks it so revealed places show through. */
export const FogBank = memo(function FogBank({ width, height, puffs, darkness = 0 }: FogBankProps) {
  const top = mixColor("#f2f9ff", "#2d3d7e", darkness);
  const bottom = mixColor("#d3e6fa", "#18234f", darkness);
  const shade = mixColor("#c2dcf6", "#111a44", darkness);
  const cloud = mixColor("#ffffff", "#3c4f9a", darkness);
  return (
    <g>
      <defs>
        <linearGradient id="tvt-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill="url(#tvt-fog)" opacity="0.95" />
      <g className="tv-trail-puffs">
        {puffs.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y + 10} r={p.r} fill={shade} opacity="0.7" />
            <circle cx={p.x} cy={p.y} r={p.r} fill={cloud} />
            <circle cx={p.x - p.r * 0.7} cy={p.y + p.r * 0.2} r={p.r * 0.7} fill={cloud} />
            <circle cx={p.x + p.r * 0.75} cy={p.y + p.r * 0.25} r={p.r * 0.65} fill={cloud} />
          </g>
        ))}
      </g>
    </g>
  );
});
