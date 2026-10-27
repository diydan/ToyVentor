import type { Toy } from "../../shared/toy";

export async function fetchScanToy(): Promise<Toy> {
  const res = await fetch("/api/scan");
  if (!res.ok) throw new Error(`scan failed: ${res.status}`);
  return (await res.json()) as Toy;
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}
