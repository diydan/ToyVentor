import type { OwnershipRecord } from "../../shared/ownership";

const DEVICE_KEY = "toyforge:device:v1";

/** Anonymous per-device identity until real accounts exist. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable: a session-only id still works for the API.
    return crypto.randomUUID();
  }
}

const headers = () => ({
  "content-type": "application/json",
  "x-device-id": deviceId(),
});

/** Best-effort: local storage stays the device source of truth, so a
 *  failed sync (offline, no DB bound) never blocks play. */
export async function pushOwnership(record: OwnershipRecord): Promise<boolean> {
  try {
    const res = await fetch("/api/ownership", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(record),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOwnership(): Promise<OwnershipRecord[] | null> {
  try {
    const res = await fetch("/api/ownership", { headers: headers() });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: OwnershipRecord[] };
    return Array.isArray(body.items) ? body.items : null;
  } catch {
    return null;
  }
}
