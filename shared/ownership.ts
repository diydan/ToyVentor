// Ownership record shapes shared by the Worker API and the client sync
// layer. Local storage stays the offline source of truth on the device;
// the server copy exists so ownership survives a new phone or browser.

export type OwnedItemType = "toy" | "part" | "skin" | "character";

export interface OwnershipRecord {
  type: OwnedItemType;
  id: string;
  /** Full object for toys/characters; omitted for parts/skins (set ids). */
  payload?: unknown;
}

export const ITEM_TYPES: OwnedItemType[] = ["toy", "part", "skin", "character"];

/** Device/player ids are client-generated UUIDs. Accept that shape only,
 *  so a header can never become an arbitrary key or path fragment. */
export function isPlayerId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value);
}

const MAX_PAYLOAD_CHARS = 400_000;

/** Returns human-readable errors; empty means the record can be stored. */
export function validateOwnershipRecord(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return ["record is not an object"];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  if (!ITEM_TYPES.includes(v.type as OwnedItemType))
    errors.push(`type must be one of ${ITEM_TYPES.join(", ")}`);
  if (typeof v.id !== "string" || !v.id || v.id.length > 128)
    errors.push("id must be a non-empty string up to 128 chars");
  if (v.payload !== undefined) {
    let serialized = "";
    try {
      serialized = JSON.stringify(v.payload) ?? "";
    } catch {
      errors.push("payload is not JSON-serializable");
    }
    if (serialized.length > MAX_PAYLOAD_CHARS)
      errors.push(`payload over ${MAX_PAYLOAD_CHARS} chars`);
  }
  return errors;
}
