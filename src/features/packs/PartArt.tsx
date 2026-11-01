import { useId } from "react";
import type { Part } from "../../../shared/part";

const TOP_POINTS =
  "12,18 24,8 36,18 48,8 60,18 72,8 84,18 96,8 108,18 120,8 132,18 144,8 156,18 168,8 178,18 178,50 168,58 156,50 144,58 132,50 120,58 108,50 96,58 84,50 72,58 60,50 48,58 36,50 24,58 12,50";
const BODY_POINTS =
  "12,50 24,58 36,50 48,58 60,50 72,58 84,50 96,58 108,50 120,58 132,50 144,58 156,50 168,58 178,50 178,244 168,254 156,244 144,254 132,244 120,254 108,244 96,254 84,244 72,254 60,244 48,254 36,244 24,254 12,244";
const SEAM_POINTS =
  "12,50 24,58 36,50 48,58 60,50 72,58 84,50 96,58 108,50 120,58 132,50 144,58 156,50 168,58 178,50";

/**
 * Crimped holographic foil pack SVG from drafts/ToyVentor-PackRip-ToyWorld.html.
 * Uses scoped useId() gradient/clip references so multiple mounts never collide.
 */
export function FoilPackSvg() {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `tvpk-${uid}-${name}`;

  return (
    <svg viewBox="0 0 190 262" role="img" aria-label="Sealed daily collectible pack">
      <defs>
        <linearGradient id={id("pkg")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="190" y2="262">
          <stop offset="0" stopColor="#6cc6ff" />
          <stop offset="0.5" stopColor="#5a8cff" />
          <stop offset="1" stopColor="#a78bff" />
        </linearGradient>
        <linearGradient id={id("holo")} gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="190" y2="240">
          <stop offset="0" stopColor="#ff9db0" stopOpacity="0" />
          <stop offset="0.25" stopColor="#ff9db0" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="#5af0b0" stopOpacity="0.25" />
          <stop offset="0.65" stopColor="#ffd24d" stopOpacity="0.3" />
          <stop offset="1" stopColor="#52b7ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.14" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.86" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id={id("shimg")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <pattern id={id("crimp")} width="5" height="12" patternUnits="userSpaceOnUse">
          <rect width="2" height="12" fill="#fff" opacity="0.32" />
        </pattern>
        <linearGradient id={id("emb")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2a72" stopOpacity="0.8" />
          <stop offset="1" stopColor="#080f2b" stopOpacity="0.62" />
        </linearGradient>
        <radialGradient id={id("starg")} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#fff5c2" />
          <stop offset="0.55" stopColor="#ffd24d" />
          <stop offset="1" stopColor="#e09a20" />
        </radialGradient>
        <radialGradient id={id("stargl")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd24d" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffd24d" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("pkclip")}>
          <polygon points={TOP_POINTS} />
          <polygon points={BODY_POINTS} />
        </clipPath>
        <clipPath id={id("pkb")}>
          <polygon points={BODY_POINTS} />
        </clipPath>
        <clipPath id={id("pkt")}>
          <polygon points={TOP_POINTS} />
        </clipPath>
      </defs>

      <g className="pack-foil-body">
        <polygon points={BODY_POINTS} fill={`url(#${id("pkg")})`} />
        <g clipPath={`url(#${id("pkb")})`}>
          <rect width="190" height="262" fill={`url(#${id("holo")})`} />
          <rect width="190" height="262" fill={`url(#${id("edge")})`} />
          <rect x="0" y="232" width="190" height="30" fill={`url(#${id("crimp")})`} />
          <rect x="0" y="230" width="190" height="2" fill="#fff" opacity="0.35" />
          <path d="M30 66 l1.8 4.2 l4.2 1.8 l-4.2 1.8 l-1.8 4.2 l-1.8 -4.2 l-4.2 -1.8 l4.2 -1.8 Z" fill="#fff" opacity="0.55" />
          <path d="M162 93 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 Z" fill="#fff" opacity="0.55" />
          <path d="M152 206 l1.8 4.2 l4.2 1.8 l-4.2 1.8 l-1.8 4.2 l-1.8 -4.2 l-4.2 -1.8 l4.2 -1.8 Z" fill="#fff" opacity="0.55" />
          <path d="M24 192 l1.2 2.8 l2.8 1.2 l-2.8 1.2 l-1.2 2.8 l-1.2 -2.8 l-2.8 -1.2 l2.8 -1.2 Z" fill="#fff" opacity="0.55" />
          <text
            x="95"
            y="78"
            textAnchor="middle"
            fontFamily="Rubik, system-ui, sans-serif"
            fontWeight="700"
            fontSize="11"
            letterSpacing="3"
            fill="#fff"
            opacity="0.88"
          >
            TOYVENTOR
          </text>
        </g>
        <polygon
          points={BODY_POINTS}
          fill="none"
          stroke="#fff"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect
          x="32"
          y="88"
          width="126"
          height="112"
          rx="24"
          fill={`url(#${id("emb")})`}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="2"
        />
        <circle cx="95" cy="140" r="46" fill={`url(#${id("stargl")})`} />
        <circle
          cx="95"
          cy="140"
          r="35"
          fill="none"
          stroke="#ffd24d"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="3 5"
        />
        <path
          d="M95 104 L105 130 L131 140 L105 150 L95 176 L85 150 L59 140 L85 130 Z"
          fill={`url(#${id("starg")})`}
          stroke="#fff5c2"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M95 113 L99 131 L88 135Z" fill="#fff" opacity="0.6" />
        <text
          x="96"
          y="226"
          textAnchor="middle"
          fontFamily="Rubik, system-ui, sans-serif"
          fontWeight="800"
          fontSize="19"
          fill="#10163a"
          opacity="0.45"
        >
          Daily pack
        </text>
        <text
          x="95"
          y="224"
          textAnchor="middle"
          fontFamily="Rubik, system-ui, sans-serif"
          fontWeight="800"
          fontSize="19"
          fill="#fff"
        >
          Daily pack
        </text>
      </g>

      <g className="pack-foil-top">
        <polygon points={TOP_POINTS} fill={`url(#${id("pkg")})`} />
        <g clipPath={`url(#${id("pkt")})`}>
          <rect width="190" height="262" fill={`url(#${id("holo")})`} />
          <rect x="0" y="0" width="190" height="62" fill={`url(#${id("crimp")})`} />
          <rect width="190" height="262" fill={`url(#${id("edge")})`} />
        </g>
        <polygon
          points={TOP_POINTS}
          fill="none"
          stroke="#fff"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text
          x="95"
          y="38"
          textAnchor="middle"
          fontFamily="Figtree, system-ui, sans-serif"
          fontWeight="700"
          fontSize="8"
          letterSpacing="2"
          fill="#fff"
          opacity="0.92"
        >
          TEAR HERE
        </text>
      </g>

      <g clipPath={`url(#${id("pkclip")})`}>
        <g className="pack-foil-shim">
          <rect
            x="-20"
            y="-10"
            width="44"
            height="290"
            fill={`url(#${id("shimg")})`}
            transform="skewX(-18)"
          />
        </g>
      </g>
      <polyline className="pack-foil-seam" points={SEAM_POINTS} />
    </svg>
  );
}

export function CardBackStarSvg() {
  const uid = useId().replace(/:/g, "");
  const gradId = `tvcb-${uid}`;
  return (
    <svg width="56" height="56" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#fff5c2" />
          <stop offset="0.55" stopColor="#ffd24d" />
          <stop offset="1" stopColor="#e09a20" />
        </radialGradient>
      </defs>
      <circle
        cx="24"
        cy="24"
        r="19"
        fill="rgba(8,15,43,0.35)"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.5"
      />
      <circle
        cx="24"
        cy="24"
        r="14"
        fill="none"
        stroke="#ffd24d"
        strokeOpacity="0.6"
        strokeWidth="1.2"
        strokeDasharray="2 3"
      />
      <path
        d="M24 9 L27.5 20.5 L39 24 L27.5 27.5 L24 39 L20.5 27.5 L9 24 L20.5 20.5Z"
        fill={`url(#${gradId})`}
        stroke="#fff5c2"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Bespoke vector emblem for each real base-set part, with a stat-colored fallback. */
export function PartCardArt({ part }: { part: Pick<Part, "id" | "stat" | "line"> }) {
  switch (part.id) {
    case "racer-spoiler":
    case "snap-spoiler-01":
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <path d="M5 13 L31 10 L29 16 L7 18 Z" fill="#52b7ff" stroke="#eaf7ff" strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="11" y="17" width="4" height="9" rx="1.5" fill="#9bd4ff" />
          <rect x="21" y="16" width="4" height="10" rx="1.5" fill="#9bd4ff" />
          <rect x="8" y="25" width="20" height="4" rx="2" fill="#2a7fcc" />
          <path d="M3 8 H12 M2 21 H8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case "cloud-wings":
    case "snap-wing-01":
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <path
            d="M7 27 Q9 11 29 7 Q25 16 28 21 Q21 20 19 25 Q13 23 7 27 Z"
            fill="#5af0b0"
            fillOpacity="0.88"
            stroke="#e8fff5"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M9 25 Q16 16 27 9 M12 24 Q17 19 25 18" stroke="#083828" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <circle cx="28" cy="12" r="1.5" fill="#ffd24d" />
        </svg>
      );
    case "glow-capsule":
    case "snap-glow-capsule-01":
      return (
        <svg width="46" height="46" viewBox="0 0 36 36" aria-hidden="true">
          <rect x="9" y="6" width="18" height="22" rx="9" fill="rgba(82,183,255,0.28)" stroke="#9bd4ff" strokeWidth="1.5" />
          <rect x="8" y="24" width="20" height="6" rx="3" fill="#2a7fcc" stroke="#eaf7ff" strokeWidth="1" />
          <path
            d="M18 9 L20.4 15.6 L27 18 L20.4 20.4 L18 27 L15.6 20.4 L9 18 L15.6 15.6 Z"
            fill="#ffd24d"
            stroke="#fff5c2"
            strokeWidth="1"
          />
          <circle cx="27" cy="8" r="1.4" fill="#fff" />
          <circle cx="7" cy="14" r="1.1" fill="#fff" />
        </svg>
      );
    case "beam-str-tu05":
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <g transform="rotate(-24 18 18)">
            <rect x="2" y="13" width="32" height="10" rx="5" fill="#a78bff" stroke="#f0eaff" strokeWidth="1.3" />
            {[7, 12.5, 18, 23.5, 29].map((cx) => (
              <circle key={cx} cx={cx} cy="18" r="2.2" fill="#101a44" stroke="#2c3f94" strokeWidth="0.9" />
            ))}
          </g>
        </svg>
      );
    case "adapter-snap-motion":
    case "forge-mount-ring-s":
    case "forge-mount-small":
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <path d="M6 25 Q6 17 12 17 H24 Q30 17 30 25 V29 H25 V24 H11 V29 H6 Z" fill="#ffd24d" stroke="#fff5c2" strokeWidth="1.2" />
          <rect x="10" y="13" width="4" height="4" rx="1" fill="#ff9d5c" />
          <rect x="16" y="13" width="4" height="4" rx="1" fill="#ff9d5c" />
          <rect x="22" y="13" width="4" height="4" rx="1" fill="#ff9d5c" />
        </svg>
      );
    case "brick-s-2x2":
    case "big-blue-brick":
    case "snap-brick-2x2-small":
    case "snap-brick-2x2-large": {
      const large = part.id === "snap-brick-2x2-large" || part.id === "big-blue-brick";
      const top = large ? "#9bd4ff" : "#5af0b0";
      const left = large ? "#2a7fcc" : "#1f9d6b";
      const right = large ? "#52b7ff" : "#38c98e";
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <polygon points="18,8 31,14.5 18,21 5,14.5" fill={top} stroke="#06122b" strokeWidth="1" strokeLinejoin="round" />
          <polygon points="5,14.5 18,21 18,29 5,22.5" fill={left} stroke="#06122b" strokeWidth="1" strokeLinejoin="round" />
          <polygon points="18,21 31,14.5 31,22.5 18,29" fill={right} stroke="#06122b" strokeWidth="1" strokeLinejoin="round" />
          <ellipse cx="18" cy="11.5" rx="2.7" ry="1.4" fill="#eaf7ff" stroke="#06122b" strokeWidth="0.8" />
          <ellipse cx="23" cy="14" rx="2.7" ry="1.4" fill="#eaf7ff" stroke="#06122b" strokeWidth="0.8" />
          <ellipse cx="13" cy="14" rx="2.7" ry="1.4" fill="#eaf7ff" stroke="#06122b" strokeWidth="0.8" />
          <ellipse cx="18" cy="16.5" rx="2.7" ry="1.4" fill="#eaf7ff" stroke="#06122b" strokeWidth="0.8" />
        </svg>
      );
    }
    case "skin-racer-red":
      return (
        <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
          <path
            d="M18 4 L21.5 14.5 L32 18 L21.5 21.5 L18 32 L14.5 21.5 L4 18 L14.5 14.5 Z"
            fill="#ff6a5c"
            stroke="#fff"
            strokeWidth="1.2"
          />
          <path d="M18 9 L19.8 15.8 L15.5 16.5 Z" fill="#ffd24d" opacity="0.9" />
          <circle cx="28" cy="8" r="1.8" fill="#ffd24d" />
          <circle cx="8" cy="27" r="1.4" fill="#fff" />
        </svg>
      );
    default: {
      const color = `var(--stat-${part.stat.name}, var(--sky-500))`;
      return (
        <svg width="40" height="40" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <rect
            x="6"
            y="10"
            width="24"
            height="16"
            rx="5"
            fill={color}
            fillOpacity="0.28"
            stroke={color}
            strokeWidth="2.2"
          />
          <circle cx="14" cy="18" r="3" fill={color} />
          <circle cx="22" cy="18" r="3" fill={color} />
        </svg>
      );
    }
  }
}
