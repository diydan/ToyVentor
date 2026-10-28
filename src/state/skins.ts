const KEY = "toyventor:skins:v1";

type SkinMap = Record<string, string>;

function loadAll(): SkinMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as SkinMap) : {};
  } catch {
    return {};
  }
}

/** Latest skin per toy. One image each: phone storage is not a gallery. */
export function skinForToy(toyId: string): string | undefined {
  return loadAll()[toyId];
}

export function saveSkin(toyId: string, imageDataUrl: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadAll(), [toyId]: imageDataUrl }));
  } catch {
    // Quota full: skin shows this session only.
  }
}

export function clearSkin(toyId: string): void {
  try {
    const all = loadAll();
    delete all[toyId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Nothing to clear.
  }
}
