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
