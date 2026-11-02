import { parseScanOutline, type ScanOutline, type ScanOutlineRequest } from "../../shared/outlineScan";
import type { Toy } from "../../shared/toy";
import { deviceId } from "./sync";

/** Client budgets sit above the matching server budgets (worker/meta.ts)
 *  so a server-side timeout answers before the client gives up; either
 *  way a hung call degrades into a rejection the UI already handles. */
export const SAM_SCAN_TIMEOUT_MS = 25_000;
export const SKIN_TIMEOUT_MS = 60_000;
export const API_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export async function fetchScanToy(): Promise<Toy> {
  const res = await fetchWithTimeout("/api/scan", {}, API_TIMEOUT_MS);
  if (!res.ok) throw new Error(`scan failed: ${res.status}`);
  return (await res.json()) as Toy;
}

export interface ScanPostResult {
  toy: Toy;
  sam: { configured: boolean; applied: boolean };
}

export async function postScanToy(toy: Toy, prompt: string): Promise<ScanPostResult> {
  const res = await fetchWithTimeout(
    "/api/scan",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toy, prompt }),
    },
    API_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`scan save failed: ${res.status}`);
  return (await res.json()) as ScanPostResult;
}

export interface SamScanRequest {
  id: string;
  name: string;
  kind: Toy["kind"];
  /** Real longest side in mm: SAM gives proportions, this gives scale. */
  lengthMm: number;
  prompt: string;
  imageDataUrl: string;
  /** Opt in to the print outline of the mask (F2b). Read the reply with `scanOutlineOf`. */
  outline?: ScanOutlineRequest;
}

export interface SamScanResponse {
  toy: Toy | null;
  sam: {
    configured: boolean;
    applied: boolean;
    maskApplied?: boolean;
    status?: string;
    message?: string;
    matches?: number;
    box?: unknown;
    /** Untrusted until `scanOutlineOf` has read it. */
    outline?: unknown;
  };
}

/** The print outline of a scan reply, checked field by field, or undefined if there is none or it is not well formed. */
export function scanOutlineOf(response: SamScanResponse): ScanOutline | undefined {
  return parseScanOutline(response.sam.outline);
}

export async function postSamScan(scan: SamScanRequest): Promise<SamScanResponse> {
  const res = await fetchWithTimeout(
    "/api/scan",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scan }),
    },
    SAM_SCAN_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`SAM scan failed: ${res.status}`);
  return (await res.json()) as SamScanResponse;
}

export interface SkinResponse {
  imageDataUrl: string | null;
  skin: { applied: boolean; status?: string; message?: string };
}

export async function postSkin(imageDataUrl: string, style: string): Promise<SkinResponse> {
  const res = await fetchWithTimeout(
    "/api/skin",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrl, style }),
    },
    SKIN_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`skin failed: ${res.status}`);
  return (await res.json()) as SkinResponse;
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/health", {}, API_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}
