const KEY = "toyforge:skins:v1";

type SkinMap = Record<string, string>;

let memoRaw: string | null | undefined;
let memoMap: SkinMap = {};

function parseSkins(raw: string | null): SkinMap {
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

function loadAll(): SkinMap {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memoMap;
  }
  if (memoRaw !== undefined && memoRaw === raw) return memoMap;
  memoRaw = raw;
  memoMap = parseSkins(raw);
  return memoMap;
}

function writeAll(next: SkinMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  memoRaw = undefined;
  memoMap = next;
}

/** Latest skin per toy. One image each: phone storage is not a gallery. */
export function skinForToy(toyId: string): string | undefined {
  return loadAll()[toyId];
}

export function saveSkin(toyId: string, imageDataUrl: string): void {
  if (!toyId || !imageDataUrl) return;
  writeAll({ ...loadAll(), [toyId]: imageDataUrl });
}

export function clearSkin(toyId: string): void {
  const all = { ...loadAll() };
  delete all[toyId];
  writeAll(all);
}

/** Drop the parsed-cache memo (for tests). */
export function resetSkinsCache(): void {
  memoRaw = undefined;
  memoMap = {};
}
