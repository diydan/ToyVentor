import { parseScanOutline, type ScanOutline, type ScanOutlineRequest } from "../../shared/outlineScan";
import type { Toy } from "../../shared/toy";
import { deviceId } from "./sync";
import { makeGatedFetch } from "./grownUpGate";

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

const samFetch = makeGatedFetch({ feature: "segment", timeoutMs: SAM_SCAN_TIMEOUT_MS }); // a photo for SAM: a grown-up proof at most 3 minutes old once the Worker's switch is on

export async function postSamScan(scan: SamScanRequest): Promise<SamScanResponse> {
  const res = await samFetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scan }),
  });
  if (!res.ok) throw new Error(`SAM scan failed: ${res.status}`);
  return (await res.json()) as SamScanResponse;
}

export interface SkinResponse {
  imageDataUrl: string | null;
  skin: { applied: boolean; status?: string; message?: string };
}

/** Room-photo segments (Feature 3). Box fractions are checked field by field; the reply is untrusted. */
export interface RoomPhotoSegment {
  noun: string;
  box: { x1: number; y1: number; x2: number; y2: number };
}

export interface RoomPhotoResponse {
  segments: RoomPhotoSegment[];
  sam: { configured: boolean; calls?: number; status?: string; message?: string };
}

const ROOM_SCAN_TIMEOUT_MS = 60_000; // up to 12 SAM calls under one 45 s server deadline

function parseRoomSegments(raw: unknown): RoomPhotoSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomPhotoSegment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { noun, box } = item as { noun?: unknown; box?: Record<string, unknown> };
    if (typeof noun !== "string" || !noun || typeof box !== "object" || box === null) continue;
    const { x1, y1, x2, y2 } = box;
    if (![x1, y1, x2, y2].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    out.push({ noun, box: { x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number } });
    if (out.length >= 16) break;
  }
  return out;
}

/**
 * Send one side-on room photo for SAM prop segmentation (POST /api/scan, mode "room").
 * Parent-gated server-side (S0b): pass the live sitting proof token. Throws on transport
 * failure; gate/config outcomes arrive in `sam` so the UI can fall back honestly.
 */
export async function postRoomPhoto(imageDataUrl: string, proofToken?: string): Promise<RoomPhotoResponse> {
  const res = await fetchWithTimeout(
    "/api/scan",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceId(),
        ...(proofToken && proofToken !== "local-proof" ? { "x-parent-proof": proofToken } : {}),
      },
      body: JSON.stringify({ mode: "room", imageDataUrl }),
    },
    ROOM_SCAN_TIMEOUT_MS,
  );
  if (res.status === 401) return { segments: [], sam: { configured: true, status: "gate-required" } };
  if (res.status === 429) return { segments: [], sam: { configured: true, status: "slow-down" } };
  if (!res.ok) throw new Error(`room scan failed: ${res.status}`);
  const body = (await res.json()) as { segments?: unknown; sam?: RoomPhotoResponse["sam"] };
  return { segments: parseRoomSegments(body.segments), sam: body.sam ?? { configured: false } };
}

const skinFetch = makeGatedFetch({ feature: "image", timeoutMs: SKIN_TIMEOUT_MS }); // the image model: a grown-up proof at most 3 minutes old once the Worker's switch is on

export async function postSkin(imageDataUrl: string, style: string): Promise<SkinResponse> {
  const res = await skinFetch("/api/skin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageDataUrl, style }),
  });
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
