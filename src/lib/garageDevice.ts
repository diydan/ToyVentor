// Device-side Garage settings: the Demo Mode "Preview weekend" switch, and how
// much of a weekend's Garage grace has been spent. Display and comfort settings,
// not progress, so they stay on this device and are never synced.

import { GARAGE_GRACE_MS } from "./garage";

const PREVIEW_KEY = "tvGaragePreview:v1";
const WEEKEND_RE = /^\d{4}-\d{2}-\d{2}$/;
const graceKey = (weekendKey: string): string => `tvGarageGrace:v1:${weekendKey}`;

export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): DeviceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Is Preview weekend on? Off unless someone turned it on. */
export function loadGaragePreview(storage: DeviceStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveGaragePreview(on: boolean, storage: DeviceStorage | null = defaultStorage()): void {
  try {
    if (on) storage?.setItem(PREVIEW_KEY, "1");
    else if (storage?.removeItem) storage.removeItem(PREVIEW_KEY);
    else storage?.setItem(PREVIEW_KEY, "0");
  } catch {
    /* storage blocked: the switch just does not stick */
  }
}

/** Milliseconds of this weekend's Garage grace already spent (0 if unknown). */
export function loadGraceUsedMs(weekendKey: string, storage: DeviceStorage | null = defaultStorage()): number {
  if (!WEEKEND_RE.test(weekendKey)) return 0;
  try {
    const n = Number(storage?.getItem(graceKey(weekendKey)));
    return Number.isFinite(n) && n > 0 ? Math.min(n, GARAGE_GRACE_MS * 2) : 0;
  } catch {
    return 0;
  }
}

export function saveGraceUsedMs(
  weekendKey: string,
  ms: number,
  storage: DeviceStorage | null = defaultStorage(),
): void {
  if (!WEEKEND_RE.test(weekendKey) || !Number.isFinite(ms)) return;
  try {
    storage?.setItem(graceKey(weekendKey), String(Math.max(0, Math.round(ms))));
  } catch {
    /* storage blocked: the grace just is not remembered across a reload */
  }
}
