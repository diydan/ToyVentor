export const DEMO_MODE_STORAGE_KEY = "toyforge:demo-mode:v1";

/**
 * Demo Mode v1 (Phase 1): defaults to Off so kids boot straight onto a calm,
 * uncluttered stage with a compact Worlds selector. Flipping Demo Mode On in
 * Grown-ups Settings exposes the full 12-world / Lab 1-6 bar, Level Editor,
 * Kip 3D Rig launcher, Seed Demo Save, and sandbox unlock-all.
 */
export function loadDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDemoMode(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
    }
  } catch {
    /* ignore storage quota or privacy-mode failures */
  }
}
