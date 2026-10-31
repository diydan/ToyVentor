import type { NormalizedBox, SamMaskSilhouette } from "../../shared/sam";
import { isBuiltInToy, type Toy, type ToyKind } from "../../shared/toy";
import { skinForToy } from "../state/skins";
import { postSkin, type SkinResponse } from "./api";
import {
  findVehicleAuditByIdOrAlias,
  type Phase4VehicleIconVariant,
} from "./vehicleReadiness";

export const MINI_ICON_STORAGE_KEY = "toyforge:mini-icons:v1";

export type SeedIconVariant =
  | "kip"
  | "car"
  | "figure"
  | Phase4VehicleIconVariant;

export type ToyMiniIconSource =
  | { kind: "svg"; variant: SeedIconVariant }
  | {
      kind: "cutout";
      src: string;
      cropBox?: NormalizedBox;
      silhouette?: SamMaskSilhouette;
    }
  | { kind: "silhouette"; silhouette: SamMaskSilhouette }
  | { kind: "muse"; src: string }
  | { kind: "glyph"; toyKind: ToyKind };

type IconCacheMap = Record<string, string>;

/**
 * Caps so scanned-icon data URLs can never grow localStorage without bound:
 * entry count plus serialized bytes (base64 is ASCII, so length ≈ bytes).
 * The byte budget stays well under the smallest common per-origin quota
 * with headroom left for the rest of the app.
 */
export const MAX_CACHED_MINI_ICONS = 24;
export const MAX_CACHED_MINI_ICON_BYTES = 2_000_000;

const attemptedUpgrades = new Set<string>();

let memoRaw: string | null | undefined;
let memoMap: IconCacheMap = {};

function parseCachedIcons(raw: string | null): IconCacheMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function loadCachedIcons(): IconCacheMap {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MINI_ICON_STORAGE_KEY);
  } catch {
    return memoMap;
  }
  if (memoRaw !== undefined && memoRaw === raw) return memoMap;
  memoRaw = raw;
  memoMap = parseCachedIcons(raw);
  return memoMap;
}

export function cachedMuseMiniIcon(toyId: string): string | undefined {
  const val = loadCachedIcons()[toyId];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

function writeCachedIcons(next: IconCacheMap): boolean {
  try {
    localStorage.setItem(MINI_ICON_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  memoRaw = undefined;
  memoMap = next;
  return true;
}

function oldestKeyExcept(map: IconCacheMap, toyId: string): string | undefined {
  // Integer-like ids iterate numerically first, so the head of the key
  // list is not always the insertion-oldest: skip the just-saved id.
  return Object.keys(map).find((key) => key !== toyId);
}

function overBudget(next: IconCacheMap): boolean {
  return (
    Object.keys(next).length > MAX_CACHED_MINI_ICONS ||
    JSON.stringify(next).length > MAX_CACHED_MINI_ICON_BYTES
  );
}

export function saveCachedMuseMiniIcon(toyId: string, dataUrl: string): void {
  if (!toyId || !dataUrl) return;
  const next = { ...loadCachedIcons() };
  delete next[toyId];
  next[toyId] = dataUrl;
  let oldest = oldestKeyExcept(next, toyId);
  while (overBudget(next) && oldest !== undefined) {
    delete next[oldest];
    oldest = oldestKeyExcept(next, toyId);
  }
  if (writeCachedIcons(next)) return;
  // Quota hit: evict the oldest half once, retry, then give up silently.
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(1, Math.floor(keys.length / 2)))) {
    if (key !== toyId) delete next[key];
  }
  writeCachedIcons(next);
}

/** Reset session-attempted tracking (for tests). */
export function resetMiniIconUpgradeAttempts(): void {
  attemptedUpgrades.clear();
}

/** Drop the parsed-cache memo (for tests). */
export function resetMiniIconCache(): void {
  memoRaw = undefined;
  memoMap = {};
}

export function seedVariantForToy(toy: Toy): SeedIconVariant {
  if (toy.id === "seed-kip") return "kip";
  if (toy.id === "seed-car") return "car";
  if (toy.id === "seed-figure") return "figure";
  const audited =
    findVehicleAuditByIdOrAlias(toy.id) ??
    findVehicleAuditByIdOrAlias(toy.name);
  if (audited) return audited.iconVariant;
  if (toy.kind === "car") return "car";
  if (toy.kind === "figure") return "figure";
  return "kip";
}

/**
 * Synchronous, zero-network fallback chain for the top-bar `Toy Box` mini icon:
 *   1. Cached Muse Image upgrade or kid-painted Muse skin (already local)
 *   2. Static built-in SVG (`seed-kip`, `seed-car`, `seed-figure`)
 *   3. Scan SAM 3.1 cutout / photo (`toy.imageDataUrl` + optional SAM silhouette/box,
 *      or `toy.mask.silhouette` alone)
 *   4. Crisp toy-kind glyph fallback
 */
export function resolveToyMiniIcon(
  toy: Toy,
  options?: { skipMuse?: boolean },
): ToyMiniIconSource {
  if (!options?.skipMuse) {
    const painted = skinForToy(toy.id);
    if (painted) {
      return { kind: "muse", src: painted };
    }
    const cachedMuse = cachedMuseMiniIcon(toy.id);
    if (cachedMuse) {
      return { kind: "muse", src: cachedMuse };
    }
  }

  if (isBuiltInToy(toy)) {
    return { kind: "svg", variant: seedVariantForToy(toy) };
  }

  if (toy.imageDataUrl) {
    const cropBox = toy.mask?.outline ?? toy.outline;
    const silhouette = toy.mask?.silhouette;
    return {
      kind: "cutout",
      src: toy.imageDataUrl,
      ...(cropBox ? { cropBox } : {}),
      ...(silhouette ? { silhouette } : {}),
    };
  }

  if (toy.mask?.silhouette) {
    return { kind: "silhouette", silhouette: toy.mask.silhouette };
  }

  return { kind: "glyph", toyKind: toy.kind };
}

/**
 * Strictly off-render-path async Muse Image mini-icon upgrade.
 * Runs at most once per scanned/uploaded toy (`toy.id`), caches locally in
 * `localStorage`, and silently leaves the local cutout/glyph in place when
 * offline or unconfigured.
 */
export function maybeUpgradeToyMiniIcon(
  toy: Toy,
  onUpgraded: (dataUrl: string) => void,
  fetcher: (imageDataUrl: string, style: string) => Promise<SkinResponse> = postSkin,
): () => void {
  if (isBuiltInToy(toy) || !toy.imageDataUrl) return () => {};
  if (skinForToy(toy.id) || cachedMuseMiniIcon(toy.id)) return () => {};
  if (attemptedUpgrades.has(toy.id)) return () => {};
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return () => {};
  }

  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled || attemptedUpgrades.has(toy.id)) return;
    attemptedUpgrades.add(toy.id);
    void fetcher(toy.imageDataUrl!, "clean glossy toy sticker icon")
      .then((res) => {
        if (cancelled) return;
        if (res.skin?.applied && res.imageDataUrl) {
          saveCachedMuseMiniIcon(toy.id, res.imageDataUrl);
          onUpgraded(res.imageDataUrl);
        }
      })
      .catch(() => {
        /* silent fallback: keep local SAM cutout or glyph */
      });
  }, 0);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
