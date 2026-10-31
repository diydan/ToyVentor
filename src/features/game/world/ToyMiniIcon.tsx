import { useEffect, useId, useState } from "react";
import type { Toy, ToyKind } from "../../../../shared/toy";
import {
  maybeUpgradeToyMiniIcon,
  resolveToyMiniIcon,
  type SeedIconVariant,
} from "../../../lib/toyIcon";

export interface ToyMiniIconProps {
  toy: Toy;
  accentColor: string;
  skinVersion?: number;
  size?: "mini" | "tile";
}

function SeedSvg({
  variant,
  accentColor,
  px,
}: {
  variant: SeedIconVariant;
  accentColor: string;
  px: number;
}) {
  if (variant === "kip") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <line
          x1="12"
          y1="2.2"
          x2="12"
          y2="5.4"
          stroke="#ffd24d"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="2.1" r="1.6" fill="#ffd24d" />
        <rect
          x="4.6"
          y="5.4"
          width="14.8"
          height="11.6"
          rx="4.2"
          fill={accentColor || "#ffd24d"}
          stroke="#0a1236"
          strokeWidth="1.5"
        />
        <rect x="7" y="8" width="10" height="5.4" rx="2.2" fill="#132258" />
        <circle cx="9.8" cy="10.7" r="1.25" fill="#5af0b0" />
        <circle cx="14.2" cy="10.7" r="1.25" fill="#5af0b0" />
        <path
          d="M10.4 12.2 Q12 13.1 13.6 12.2"
          fill="none"
          stroke="#ffd24d"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <rect x="7.8" y="17.8" width="3.3" height="3.5" rx="1.1" fill="#52b7ff" stroke="#0a1236" strokeWidth="1" />
        <rect x="12.9" y="17.8" width="3.3" height="3.5" rx="1.1" fill="#52b7ff" stroke="#0a1236" strokeWidth="1" />
      </svg>
    );
  }
  if (variant === "car") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M3.2 11.2 L4.8 9.2 H6.4 L8.4 7.4 H15.2 L19.4 12.4 H21 A1.6 1.6 0 0 1 21 15.8 H3 A1.6 1.6 0 0 1 3.2 11.2 Z"
          fill={accentColor || "#ff5a4d"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.6 8.8 H14.4 L17 12 H7.1 Z" fill="#bfe3ff" />
        <rect x="4" y="12.5" width="7" height="1.2" rx="0.6" fill="#ffd24d" />
        <circle cx="7.4" cy="16.6" r="2.8" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="7.4" cy="16.6" r="1" fill="#ffd24d" />
        <circle cx="16.8" cy="16.6" r="2.8" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="16.8" cy="16.6" r="1" fill="#ffd24d" />
      </svg>
    );
  }
  if (variant === "truck") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M2.4 10.2 H11.6 V6.6 H17.2 L20.6 10.8 V15.8 H2.4 Z"
          fill={accentColor || "#ff9d5c"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M13 8 H16.6 L18.9 10.8 H13 Z" fill="#bfe3ff" />
        <rect x="3.4" y="8.8" width="7.4" height="1.5" rx="0.6" fill="#ffd24d" />
        <rect x="13.8" y="5" width="2.8" height="1.5" rx="0.6" fill="#ffd24d" />
        <circle cx="7" cy="16.8" r="3" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="7" cy="16.8" r="1.1" fill="#ffd24d" />
        <circle cx="16.8" cy="16.8" r="3" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="16.8" cy="16.8" r="1.1" fill="#ffd24d" />
      </svg>
    );
  }
  if (variant === "scooter") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M5 11.4 H10.2 L11.4 15 H14.8 L16.5 6.8 H14.2"
          fill="none"
          stroke="#0a1236"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4.4 12.2 Q4.4 9.8 7.4 9.8 H10.6 L11.8 15.2 H15.8 L17.4 8.6 L19.4 12.8 L17.6 15.6 H5.2 Z"
          fill={accentColor || "#5af0b0"}
          stroke="#0a1236"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <rect x="5.4" y="9.2" width="4.8" height="1.8" rx="0.9" fill="#132258" />
        <circle cx="18.6" cy="9.2" r="1.3" fill="#ffd24d" stroke="#0a1236" strokeWidth="0.9" />
        <circle cx="6.6" cy="17" r="2.6" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.2" />
        <circle cx="17.4" cy="17" r="2.6" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.2" />
      </svg>
    );
  }
  if (variant === "motorbike") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <line x1="15.2" y1="6.8" x2="18" y2="16.6" stroke="#cfd8ff" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M4.2 12 L8.2 10.4 L12.2 8.2 H16.8 L19.4 10.6 L15.6 13.8 H8.4 Z"
          fill={accentColor || "#ff5a4d"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M13.6 6.6 H16.6 L18.2 8.4 H14.8 Z" fill="#bfe3ff" />
        <rect x="9.2" y="10.4" width="5" height="1.2" rx="0.6" fill="#ffd24d" />
        <circle cx="6.4" cy="16.6" r="3" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="6.4" cy="16.6" r="1" fill="#ffd24d" />
        <circle cx="17.8" cy="16.6" r="3" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="17.8" cy="16.6" r="1" fill="#ffd24d" />
      </svg>
    );
  }
  if (variant === "tractor") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M15.2 11.4 L19.4 8.4 L21.8 9.8 L20.4 12.6 H18.2"
          fill="#ffd24d"
          stroke="#0a1236"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M3.6 14.8 V6.2 H10.8 L12 10.2 H16.8 V14.8 Z"
          fill={accentColor || "#5af0b0"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <rect x="5" y="7.4" width="4.6" height="3.2" rx="0.7" fill="#bfe3ff" />
        <circle cx="7.2" cy="16.4" r="3.7" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="7.2" cy="16.4" r="1.4" fill="#ffd24d" />
        <circle cx="15.8" cy="17.3" r="2.4" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.2" />
      </svg>
    );
  }
  if (variant === "aeroplane") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M2.6 11.6 L4.6 7.4 H6.8 L6.2 10.4 H18.4 Q20.8 10.4 20.8 12.2 Q20.8 14 18.4 14 H5.2 Z"
          fill={accentColor || "#52b7ff"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M11.2 8.8 H15.2 L16.6 10.6 H11.2 Z" fill="#bfe3ff" />
        <path
          d="M8.8 12.2 L13.8 12.2 L11.4 17.2 H7.8 Z"
          fill="#ffd24d"
          stroke="#0a1236"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <line x1="21.4" y1="8.2" x2="21.4" y2="16.2" stroke="#ffd24d" strokeWidth="2" strokeLinecap="round" />
        <circle cx="13.8" cy="18.2" r="1.7" fill="#10183c" stroke="#cfd8ff" strokeWidth="1" />
      </svg>
    );
  }
  if (variant === "catamaran") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M11.4 4.2 L17.6 12.4 H11.4 Z"
          fill="#ffd24d"
          stroke="#0a1236"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M5.4 12.4 H17.8 L19.8 14.8 H4.4 Z"
          fill={accentColor || "#52b7ff"}
          stroke="#0a1236"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M7.4 10.2 H10.4 L11.2 12.4 H6.8 Z" fill="#bfe3ff" />
        <path
          d="M2.8 17.6 H19.2 L21.4 15.6"
          fill="none"
          stroke="#10183c"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4.2 19.6 H18.2 L20.2 18"
          fill="none"
          stroke="#5af0b0"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (variant === "helicopter") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <line x1="5" y1="4.6" x2="20.6" y2="4.6" stroke="#ffd24d" strokeWidth="2.1" strokeLinecap="round" />
        <line x1="12.8" y1="4.6" x2="12.8" y2="7.4" stroke="#0a1236" strokeWidth="1.8" />
        <path
          d="M3 10.4 H8.6 L10.2 7.4 H16.4 Q20.4 7.4 20.4 11.4 Q20.4 15 16.2 15 H9.4 L8.2 12.2 H3 Z"
          fill={accentColor || "#ff5a4d"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M14.2 8.6 H17.2 Q19 8.6 19 11.2 H14.2 Z" fill="#bfe3ff" />
        <circle cx="3" cy="11.2" r="1.7" fill="#ffd24d" stroke="#0a1236" strokeWidth="1" />
        <path
          d="M8.4 18.4 H18.4 L19.8 16.8 M11 15 V18.4 M16 15 V18.4"
          fill="none"
          stroke="#10183c"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (variant === "shuttle") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <path
          d="M3.4 9.8 L5.6 5.6 H7.4 L7.4 9.8 H16.8 L21.2 12 L16.8 14.2 H7.4 L5.2 17.6 H3.4 L4.8 13.8 H3.4 Z"
          fill={accentColor || "#eef4ff"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M18.2 10.6 L21.2 12 L18.2 13.4 Z" fill="#132258" />
        <rect x="13.8" y="10.8" width="3.2" height="2.4" rx="0.7" fill="#bfe3ff" />
        <rect x="1.8" y="10.2" width="2" height="1.5" rx="0.5" fill="#ffd24d" />
        <rect x="1.8" y="12.3" width="2" height="1.5" rx="0.5" fill="#ffd24d" />
      </svg>
    );
  }
  if (variant === "mech") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <rect
          x="4.6"
          y="4.2"
          width="14.8"
          height="11.4"
          rx="2.6"
          fill={accentColor || "#a78bff"}
          stroke="#0a1236"
          strokeWidth="1.5"
        />
        <rect x="7" y="6.2" width="10" height="3.2" rx="1.2" fill="#132258" />
        <rect x="8.4" y="7.2" width="7.2" height="1.2" rx="0.6" fill="#5af0b0" />
        <path d="M12.6 10.2 L10.2 13 H12.2 L11.4 15 L14 12 H12 Z" fill="#ffd24d" />
        <rect
          x="3.6"
          y="16.2"
          width="16.8"
          height="4.2"
          rx="2.1"
          fill="#10183c"
          stroke="#cfd8ff"
          strokeWidth="1.2"
        />
        <circle cx="7" cy="18.3" r="1" fill="#ffd24d" />
        <circle cx="12" cy="18.3" r="1" fill="#ffd24d" />
        <circle cx="17" cy="18.3" r="1" fill="#ffd24d" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
      <circle
        cx="12"
        cy="7.5"
        r="4.2"
        fill="#bfe3ff"
        stroke={accentColor || "#52b7ff"}
        strokeWidth="1.6"
      />
      <path
        d="M9.5 7.2 Q12 5.4 14.5 7.2"
        fill="none"
        stroke="#132258"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <rect
        x="7.5"
        y="12.2"
        width="9"
        height="7.8"
        rx="3"
        fill={accentColor || "#52b7ff"}
        stroke="#0a1236"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="15.8" r="1.4" fill="#ffd24d" />
    </svg>
  );
}

function GlyphSvg({
  toyKind,
  accentColor,
  px,
}: {
  toyKind: ToyKind;
  accentColor: string;
  px: number;
}) {
  if (toyKind === "car") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <rect x="3.5" y="11" width="17" height="5.5" rx="2.4" fill={accentColor} />
        <path d="M7 11 L9 7.5 H15 L17 11 Z" fill={accentColor} opacity="0.85" />
        <circle cx="8" cy="17" r="2.2" fill="#e8f2ff" />
        <circle cx="16" cy="17" r="2.2" fill="#e8f2ff" />
      </svg>
    );
  }
  if (toyKind === "figure") {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
        <circle cx="12" cy="7" r="3.4" fill={accentColor} />
        <path
          d="M6.8 19 C6.8 14.5 9.1 12.2 12 12.2 C14.9 12.2 17.2 14.5 17.2 19 Z"
          fill={accentColor}
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
      <rect x="5" y="6" width="14" height="13" rx="3.5" fill={accentColor} />
      <circle cx="9.5" cy="11.5" r="1.3" fill="#0a1236" />
      <circle cx="14.5" cy="11.5" r="1.3" fill="#0a1236" />
      <path
        d="M9.5 15 Q12 16.8 14.5 15"
        fill="none"
        stroke="#0a1236"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToyMiniIcon({
  toy,
  accentColor,
  skinVersion = 0,
  size = "mini",
}: ToyMiniIconProps) {
  const clipId = useId();
  const [upgradedSrc, setUpgradedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const px = size === "tile" ? 44 : 20;
  const wrapClass = size === "tile" ? "tv-toy-roster-thumb" : "tv-toy-mini-icon";

  useEffect(() => {
    setUpgradedSrc(null);
    setFailedSrc(null);
    return maybeUpgradeToyMiniIcon(toy, (url) => {
      setUpgradedSrc(url);
    });
  }, [toy, skinVersion]);

  const initialSource = upgradedSrc
    ? ({ kind: "muse", src: upgradedSrc } as const)
    : resolveToyMiniIcon(toy);
  const source =
    initialSource.kind === "muse" && failedSrc === initialSource.src
      ? resolveToyMiniIcon(toy, { skipMuse: true })
      : initialSource;

  if (source.kind === "svg") {
    return (
      <span className={wrapClass} aria-hidden="true">
        <SeedSvg variant={source.variant} accentColor={accentColor} px={px} />
      </span>
    );
  }

  if (source.kind === "muse" && failedSrc !== source.src) {
    return (
      <span className={wrapClass} aria-hidden="true">
        <img
          src={source.src}
          alt=""
          className="tv-toy-mini-img"
          onError={() => setFailedSrc(source.src)}
        />
      </span>
    );
  }

  if (source.kind === "cutout" && failedSrc !== source.src) {
    if (source.silhouette) {
      const { width, height, path } = source.silhouette;
      return (
        <span className={wrapClass} aria-hidden="true">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={px}
            height={px}
            aria-hidden="true"
          >
            <defs>
              <clipPath id={clipId}>
                <path d={path} />
              </clipPath>
            </defs>
            <image
              href={source.src}
              width={width}
              height={height}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clipId})`}
              onError={() => setFailedSrc(source.src)}
            />
          </svg>
        </span>
      );
    }

    return (
      <span className={wrapClass} aria-hidden="true">
        <img
          src={source.src}
          alt=""
          className="tv-toy-mini-img"
          onError={() => setFailedSrc(source.src)}
        />
      </span>
    );
  }

  if (source.kind === "silhouette") {
    const { width, height, path } = source.silhouette;
    return (
      <span className={wrapClass} aria-hidden="true">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={px}
          height={px}
          aria-hidden="true"
        >
          <path d={path} fill={accentColor} />
        </svg>
      </span>
    );
  }

  return (
    <span className={wrapClass} aria-hidden="true">
      <GlyphSvg toyKind={toy.kind} accentColor={accentColor} px={px} />
    </span>
  );
}
