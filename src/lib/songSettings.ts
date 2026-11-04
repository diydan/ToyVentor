// A grown-up's two choices for songs on this device (docs/specs/dance-party-spec.md 4.6, D10): the song maker on or off, and how many new songs a week (0 to 5).
// The Worker keeps them in D1 (worker/songStore.ts) and changes them only behind the parent proof (POST /api/theme-song/settings); reading them is open, because the
// child's own screen has to know. Nothing here throws: every function answers a plain object.
import { deviceId } from "./sync";

export interface SongSettings {
  makerOn: boolean;
  /** 0 to 5. */
  limit: number;
}
export interface SongWeek {
  limit: number;
  used: number;
  left: number;
  resetsOn: string;
  makerOn: boolean;
}

export type SongSettingsLoad =
  | { ok: true; settings: SongSettings; week: SongWeek | null }
  /** `absent`: the song route is off or not metered here, so there is nothing to set and the panel stays out of the way. */
  | { ok: false; reason: "absent" | "offline" };

export type SongSettingsSave =
  | { ok: true; settings: SongSettings; week: SongWeek | null }
  | { ok: false; reason: "gate" | "invalid" | "absent" | "offline" };

const ROUTE = "/api/theme-song";
const ID = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** The device and the family's clock, the headers every song request carries. */
export function songHeaders(proof?: string): Record<string, string> {
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* UTC */ }
  return { "content-type": "application/json", "x-device-id": deviceId(), "x-client-timezone": tz, ...(proof && proof !== "local-proof" ? { "x-parent-proof": proof } : {}) };
}

const settingsOf = (v: unknown): SongSettings | null => {
  const s = v as Partial<SongSettings> | null | undefined;
  return s && typeof s.makerOn === "boolean" && ID(s.limit) && s.limit >= 0 && s.limit <= 10 ? { makerOn: s.makerOn, limit: s.limit } : null;
};
const weekOf = (v: unknown): SongWeek | null => {
  const q = v as Partial<SongWeek> | null | undefined;
  return q && ID(q.limit) && ID(q.used) && ID(q.left) && typeof q.resetsOn === "string" && typeof q.makerOn === "boolean" ? { limit: q.limit, used: q.used, left: q.left, resetsOn: q.resetsOn, makerOn: q.makerOn } : null;
};

/** Is the route on here, and what are this device's settings? One free probe, then one read. */
export async function loadSongSettings(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<SongSettingsLoad> {
  try {
    const probe = await fetchImpl(ROUTE, { headers: songHeaders() });
    const p = probe.ok ? ((await probe.json()) as { enabled?: unknown }) : null;
    if (p?.enabled !== true) return { ok: false, reason: "absent" };
    const res = await fetchImpl(`${ROUTE}/settings`, { headers: songHeaders() });
    if (res.status === 501) return { ok: false, reason: "absent" };
    if (!res.ok) return { ok: false, reason: "offline" };
    const body = (await res.json()) as { settings?: unknown; quota?: unknown };
    const settings = settingsOf(body.settings);
    return settings ? { ok: true, settings, week: weekOf(body.quota) } : { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Change one or both choices. Needs the parent proof the sheet holds; a missing or stale one comes back as `gate`. */
export async function saveSongSettings(patch: Partial<SongSettings>, proof: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<SongSettingsSave> {
  const clean: Partial<SongSettings> = {};
  if (patch.makerOn !== undefined) { if (typeof patch.makerOn !== "boolean") return { ok: false, reason: "invalid" }; clean.makerOn = patch.makerOn; }
  if (patch.limit !== undefined) { if (!ID(patch.limit) || patch.limit < 0 || patch.limit > 10) return { ok: false, reason: "invalid" }; clean.limit = patch.limit; }
  if (clean.makerOn === undefined && clean.limit === undefined) return { ok: false, reason: "invalid" };
  if (!proof || proof === "local-proof") return { ok: false, reason: "gate" }; // the local-only unlock never reaches the Worker, which would only refuse it
  try {
    const res = await fetchImpl(`${ROUTE}/settings`, { method: "POST", headers: songHeaders(proof), body: JSON.stringify(clean) });
    if (res.status === 401) return { ok: false, reason: "gate" };
    if (res.status === 422) return { ok: false, reason: "invalid" };
    if (res.status === 501) return { ok: false, reason: "absent" };
    if (!res.ok) return { ok: false, reason: "offline" };
    const body = (await res.json()) as { settings?: unknown; quota?: unknown };
    const settings = settingsOf(body.settings);
    return settings ? { ok: true, settings, week: weekOf(body.quota) } : { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
