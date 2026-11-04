// A small picture of the toy as it is dressed right now, for the trail map's
// character token. The game renders it once from the live 3D rig (head and
// shoulders, or the whole vehicle) and it is kept on this device per toy,
// keyed by a signature of the outfit so a new hat or colour makes a new one.
//
// This is a render of a toy, never a photo of a person. The selfie face in
// the Kip viewer is deliberately memory-only (kip-selfie.js privacy rules)
// and is not used here.

/** Side of the stored picture in px; it is drawn at about a quarter of this. */
export const PORTRAIT_PX = 128;

/** Bump when the framing or lighting changes, so old pictures are retaken. */
export const PORTRAIT_FRAMING_VERSION = 2; // 2: the human head wears hair, or the smooth cover, instead of two bare studs

export interface ToyPortrait {
  toyId: string;
  sig: string;
  url: string;
}

export interface PortraitSignatureInput {
  toyId: string | null | undefined;
  type: string;
  /** The selected part per slot for this toy type. */
  sel: Readonly<Record<string, string>>;
  /** The paint colours. */
  col: Readonly<Record<string, string>>;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const sortedPairs = (o: Readonly<Record<string, string>>): Array<[string, string]> =>
  Object.keys(o)
    .sort()
    .map((k) => [k, String(o[k])]);

/** Same toy, outfit and colours in, same signature out; any change, a new one. */
export function toyPortraitSignature(input: PortraitSignatureInput): string {
  return fnv1a(
    JSON.stringify([
      PORTRAIT_FRAMING_VERSION,
      input.toyId ?? "",
      input.type,
      sortedPairs(input.sel),
      sortedPairs(input.col),
    ]),
  );
}

/**
 * Only a PNG data URL of a sane size is ever shown. What comes back out of
 * storage is untrusted (it is read into an img src), so nothing else passes.
 */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_URL_CHARS = 200_000;

export function isPortraitUrl(url: unknown): url is string {
  return typeof url === "string" && url.length <= MAX_URL_CHARS && PNG_DATA_URL.test(url);
}

const keyFor = (toyId: string): string => `tvToyPortrait:v1:${toyId}`;

export interface PortraitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PortraitStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The kept picture for this toy, if it was taken for exactly this outfit. */
export function loadToyPortrait(
  toyId: string,
  sig: string,
  storage: PortraitStorage | null = defaultStorage(),
): string | null {
  if (!storage || !toyId) return null;
  try {
    const raw = storage.getItem(keyFor(toyId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { sig?: unknown; url?: unknown } | null;
    if (!v || v.sig !== sig || !isPortraitUrl(v.url)) return null;
    return v.url;
  } catch {
    return null;
  }
}

/** Keep one picture per toy (a newer outfit replaces the older). False if it could not be kept. */
export function saveToyPortrait(
  shot: ToyPortrait,
  storage: PortraitStorage | null = defaultStorage(),
): boolean {
  if (!storage || !shot.toyId || !isPortraitUrl(shot.url)) return false;
  try {
    storage.setItem(keyFor(shot.toyId), JSON.stringify({ sig: shot.sig, url: shot.url }));
    return true;
  } catch {
    return false; // storage full or blocked: the picture still shows this session
  }
}
