import type { Toy } from "../../shared/toy";

export async function fetchScanToy(): Promise<Toy> {
  const res = await fetch("/api/scan");
  if (!res.ok) throw new Error(`scan failed: ${res.status}`);
  return (await res.json()) as Toy;
}

export interface ScanPostResult {
  toy: Toy;
  sam: { configured: boolean; applied: boolean };
}

export async function postScanToy(toy: Toy, prompt: string): Promise<ScanPostResult> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toy, prompt }),
  });
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
}

export interface SamScanResponse {
  toy: Toy | null;
  sam: {
    configured: boolean;
    applied: boolean;
    status?: string;
    message?: string;
    matches?: number;
    box?: unknown;
  };
}

export async function postSamScan(scan: SamScanRequest): Promise<SamScanResponse> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scan }),
  });
  if (!res.ok) throw new Error(`SAM scan failed: ${res.status}`);
  return (await res.json()) as SamScanResponse;
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}
