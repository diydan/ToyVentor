// PartSpec -> app bridge. Converts the PartSpec package's catalog +
// manifest records (docs/PartSpec/pkg) into app Part records (shared/part.ts).
//
// Fail-closed by design: anything the app schema cannot express today is
// SKIPPED with a reason, never guessed. In particular:
// - stats map only on exact synonyms (Speed->speed, Spin->spin,
//   Torque->torque, Glow->glow). PartSpec's other 15 stat names need a
//   game-design decision to widen StatName; the bridge reports them.
// - Pro and shared (mount) parts are skipped: app Pro sizing is unsettled.
// - non-"verified" parts are skipped: design_status is derived upstream.
// - stat VALUE has no upstream source; PLACEHOLDER_STAT_VALUE is used and
//   the script warns. Safety warnings and behaviors have no app field yet
//   and are dropped (counted in the script report) — the print page must
//   grow a safety field before a PartSpec set ships to users.

import type { Part, StatName } from "./part";

export interface PartSpecCatalogPart {
  id: string;
  name: string;
  line: string;
  size: string;
  stat: string;
}

export interface PartSpecConnector {
  kind?: string;
  interface?: string;
  grid?: { nx: number; ny: number; pitch: number };
}

export interface PartSpecManifestPart {
  id: string;
  design_status?: string;
  prints?: boolean;
  file?: string;
  connectors?: PartSpecConnector[];
  print?: { orientation?: string; supports?: boolean };
}

export type BridgeResult =
  | { ok: true; part: Part }
  | { ok: false; id: string; reason: string };

export const PLACEHOLDER_STAT_VALUE = 1;

const STAT_MAP: Record<string, StatName> = {
  Speed: "speed",
  Spin: "spin",
  Torque: "torque",
  Glow: "glow",
};

export function convertPartSpecPart(
  catalog: PartSpecCatalogPart,
  manifest: PartSpecManifestPart | undefined,
): BridgeResult {
  const id = catalog.id;
  const skip = (reason: string): BridgeResult => ({ ok: false, id, reason });

  if (catalog.line !== "snap") return skip(`line "${catalog.line}" not bridged yet (snap only)`);
  if (catalog.size !== "small" && catalog.size !== "large")
    return skip(`size "${catalog.size}" is not a Snap size class`);
  if (!manifest) return skip("no manifest entry (not generated)");
  if (manifest.design_status !== "verified")
    return skip(`design_status "${manifest.design_status ?? "missing"}", not verified`);
  if (manifest.prints !== true || !manifest.file) return skip("not a printable part with an STL");

  const statName = STAT_MAP[catalog.stat];
  if (!statName) return skip(`stat "${catalog.stat}" has no app game mapping yet`);

  const gridConn = (manifest.connectors ?? []).find((c) => c.grid);
  if (!gridConn?.grid) return skip("no connector grid to derive footprint from");
  const { nx, ny, pitch } = gridConn.grid;

  return {
    ok: true,
    part: {
      // Prefix keeps bridged ids collision-free beside sets/base.json.
      id: `partspec-${id.replace(/_/g, "-")}`,
      name: catalog.name,
      line: "snap",
      mount: "stud",
      sizeClass: catalog.size,
      grid: {
        units: [nx, ny],
        profile: gridConn.interface ? `tu_${gridConn.interface}` : "tu_stud",
      },
      // Socket footprint (units x TU pitch), not body bbox: same contract
      // as sets/base.json. Bodies may overhang; the builder's checks use
      // the socket footprint today.
      footprintMm: [nx * pitch, ny * pitch],
      stat: { name: statName, value: PLACEHOLDER_STAT_VALUE },
      printable: true,
      orientation: manifest.print?.orientation ?? "flat",
      supportFree: manifest.print?.supports !== true,
    },
  };
}

/** Demo subset bridged first: direct-stat Snap parts spanning both sizes. */
export const DEMO_SUBSET_IDS = [
  "ridge_fin", // small, Speed — closest to today's spoiler role
  "zoom_capsule_s", // small, Speed
  "glow_capsule", // small, Glow
  "zoom_capsule", // large, Speed
  "glow_capsule_l", // large, Glow
  "spin_capsule", // large, Spin
];
