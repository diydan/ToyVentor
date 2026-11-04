// "Ask the grown-up": the one place a screen gets a grown-up proof for the routes that send a photo, a recording or a prompt to ANOTHER model (worker/hostedGate.ts: a proof at most 3
// minutes old, 5 for AR). The gate itself is the one that exists (src/lib/parentTime.ts, the hold, the PIN pad or the maths pad, the same x-parent-proof); this keeps the proof in MEMORY only
// (never localStorage: a reload asks again), says how fresh it is, and wraps `fetch` so a screen does not have to know any of it:
//   - every request carries x-device-id and, when there is a fresh enough proof, x-parent-proof;
//   - on a 401 { status: "gate-required" } the grown-up is asked ONCE (the prompt, mounted at the app root) and the request is sent again with the new proof;
//   - if they cancel, the 401 comes back to the screen as it is (its calm "ask a grown-up" message).
// While a feature's server switch is off the Worker never answers 401 and nothing is ever asked: the proof header is simply ignored.
import { deviceId } from "./sync";
import type { GateSession } from "./parentTime";

/** Mirrors worker/hostedGate.ts HOSTED_PROOF_MAX_AGE_MS: the server decides; this only avoids asking when the proof we hold is already too old to be accepted. */
export const PROOF_MAX_AGE_MS = { segment: 3 * 60_000, image: 3 * 60_000, transcribe: 3 * 60_000, ar: 5 * 60_000 } as const;
export type GateFeature = keyof typeof PROOF_MAX_AGE_MS;

interface Held { token: string; issuedAt: number; expiresAt: number }
let held: Held | null = null;

/** Remember a proof the moment it is issued (the prompt, or the Grown-ups sheet when a grown-up unlocks it). */
export function rememberGrownUpProof(session: GateSession, now = Date.now()): void {
  if (!session?.proofToken || session.proofToken === "local-proof") return; // the local stand-in proves nothing to the Worker
  held = { token: session.proofToken, issuedAt: now, expiresAt: session.expiresAt };
}
export function forgetGrownUpProof(): void {
  held = null;
}
/** The held proof if it is still inside its own lifetime AND no older than `maxAgeMs`; else null. */
export function freshGrownUpProof(maxAgeMs: number, now = Date.now()): string | null {
  if (!held || held.expiresAt <= now || now - held.issuedAt > maxAgeMs) return null;
  return held.token;
}

// The prompt lives at the app root (ParentGateHost); a screen only calls askGrownUp().
type Asker = () => Promise<GateSession | null>;
let asker: Asker | null = null;
export function registerGrownUpAsker(a: Asker | null): () => void {
  asker = a;
  return () => { if (asker === a) asker = null; };
}
/** Opens the one gate prompt and resolves when the grown-up passes it (their proof is remembered) or cancels (false). False at once when no prompt is mounted. */
export async function askGrownUp(): Promise<boolean> {
  if (!asker) return false;
  const session = await asker();
  if (!session) return false;
  rememberGrownUpProof(session);
  return true;
}

export interface GatedFetchOptions {
  /** Which kind of use this is: it sets how fresh a proof must be. Default segment (3 minutes). */
  feature?: GateFeature;
  /** "ar" marks a photo whose result ends in the phone's AR viewer, so the Worker accepts a 5-minute-old proof (worker/hostedGate.ts). Put into a JSON body that has none. */
  purpose?: "ar";
  /** A fresh timeout per attempt (a signal made once would run out while the grown-up is typing the answer). */
  timeoutMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  ask?: () => Promise<boolean>;
  now?: () => number;
}

const isGateRequired = async (res: Response): Promise<boolean> => {
  if (res.status !== 401) return false;
  try {
    const j = (await res.clone().json()) as { status?: unknown };
    return j?.status === "gate-required";
  } catch {
    return false;
  }
};

/** A drop-in `fetch` for the routes behind the grown-up gate. */
export function makeGatedFetch(opts: GatedFetchOptions = {}): typeof fetch {
  const feature = opts.feature ?? (opts.purpose === "ar" ? "ar" : "segment");
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ask = opts.ask ?? askGrownUp;
  const now = opts.now ?? Date.now;
  const prepare = (init: RequestInit | undefined): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("x-device-id", deviceId());
    const proof = freshGrownUpProof(PROOF_MAX_AGE_MS[feature], now());
    if (proof) headers.set("x-parent-proof", proof);
    else headers.delete("x-parent-proof");
    let body = init?.body;
    if (opts.purpose && typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.purpose === undefined) body = JSON.stringify({ ...parsed, purpose: opts.purpose });
      } catch {
        // not JSON: leave it
      }
    }
    return { ...init, headers, ...(body !== undefined ? { body } : {}), ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}) };
  };
  return async (input, init) => {
    const first = await doFetch(input, prepare(init));
    if (!(await isGateRequired(first))) return first;
    if (!(await ask())) return first;
    return doFetch(input, prepare(init)); // once: a second refusal goes back to the screen
  };
}
