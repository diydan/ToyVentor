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
}

function SeedSvg({
  variant,
  accentColor,
}: {
  variant: SeedIconVariant;
  accentColor: string;
}) {
  if (variant === "kip") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <line
          x1="12"
          y1="2.5"
          x2="12"
          y2="5.5"
          stroke="#ffd24d"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="2.3" r="1.5" fill="#ffd24d" />
        <rect
          x="5"
          y="5.5"
          width="14"
          height="11.5"
          rx="4"
          fill={accentColor || "#ffd24d"}
          stroke="#0a1236"
          strokeWidth="1.5"
        />
        <rect x="7.4" y="8.2" width="9.2" height="5" rx="2" fill="#132258" />
        <circle cx="10" cy="10.7" r="1.15" fill="#5af0b0" />
        <circle cx="14" cy="10.7" r="1.15" fill="#5af0b0" />
        <rect x="8.2" y="18" width="3" height="3.2" rx="1" fill="#8fa8ff" />
        <rect x="12.8" y="18" width="3" height="3.2" rx="1" fill="#8fa8ff" />
      </svg>
    );
  }
  if (variant === "car") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M4 13.5 L6.5 8.5 H15.5 L19.5 13.5 H21 A1.5 1.5 0 0 1 21 16.5 H3 A1.5 1.5 0 0 1 4 13.5 Z"
          fill={accentColor || "#ff5a4d"}
          stroke="#0a1236"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7.8 9.8 H14.4 L16.8 13 H6.3 Z" fill="#bfe3ff" />
        <circle cx="7.5" cy="16.8" r="2.7" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
        <circle cx="16.8" cy="16.8" r="2.7" fill="#10183c" stroke="#cfd8ff" strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle
        cx="12"
        cy="7.5"
        r="4.2"
        fill="#bfe3ff"
        stroke={accentColor || "#52b7ff"}
        strokeWidth="1.6"
      />
      <path d="M9.5 7.2 Q12 5.4 14.5 7.2" fill="none" stroke="#132258" strokeWidth="1.4" strokeLinecap="round" />
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
}: {
  toyKind: ToyKind;
  accentColor: string;
}) {
  if (toyKind === "car") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect x="3.5" y="11" width="17" height="5.5" rx="2.4" fill={accentColor} />
        <path d="M7 11 L9 7.5 H15 L17 11 Z" fill={accentColor} opacity="0.85" />
        <circle cx="8" cy="17" r="2.2" fill="#e8f2ff" />
        <circle cx="16" cy="17" r="2.2" fill="#e8f2ff" />
      </svg>
    );
  }
  if (toyKind === "figure") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="7" r="3.4" fill={accentColor} />
        <path
          d="M6.8 19 C6.8 14.5 9.1 12.2 12 12.2 C14.9 12.2 17.2 14.5 17.2 19 Z"
          fill={accentColor}
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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

export function ToyMiniIcon({ toy, accentColor, skinVersion = 0 }: ToyMiniIconProps) {
  const clipId = useId();
  const [upgradedSrc, setUpgradedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

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
      <span className="tv-toy-mini-icon" aria-hidden="true">
        <SeedSvg variant={source.variant} accentColor={accentColor} />
      </span>
    );
  }

  if (source.kind === "muse" && failedSrc !== source.src) {
    return (
      <span className="tv-toy-mini-icon" aria-hidden="true">
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
        <span className="tv-toy-mini-icon" aria-hidden="true">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width="20"
            height="20"
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
      <span className="tv-toy-mini-icon" aria-hidden="true">
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
      <span className="tv-toy-mini-icon" aria-hidden="true">
        <svg viewBox={`0 0 ${width} ${height}`} width="20" height="20" aria-hidden="true">
          <path d={path} fill={accentColor} />
        </svg>
      </span>
    );
  }

  return (
    <span className="tv-toy-mini-icon" aria-hidden="true">
      <GlyphSvg toyKind={toy.kind} accentColor={accentColor} />
    </span>
  );
}
