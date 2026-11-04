// The grown-up gate in front of everything that sends a photo, a recording or a prompt to ANOTHER model (segment = SAM outline and the camera pick-up, image = generated art and skins,
// transcribe = the voice input). Dan, 2026-11-04 night: "use the parent gate for 3 minutes, and 5 minutes for AR" (the Scavenger camera: its photo goes to /api/scan for SAM, then the part
// is shown in the phone's AR viewer). The gate itself is the one that exists (worker/parent.ts: hold, maths or PIN, the same x-parent-proof); this adds how FRESH the proof must be per feature.
//
// OFF BY DEFAULT, one switch per feature, so the server half can ship before each screen can ask for the gate (a screen that does not yet ask would just fail with "a grown-up has to unlock
// this first"): PARENT_GATE_SEGMENT, PARENT_GATE_IMAGE, PARENT_GATE_TRANSCRIBE and PARENT_GATE_AR, each on only when set to exactly "on" (trimmed, any case). Turn one on when its screen asks.
// Fails closed once on: no proof, a stale proof, a proof with no issue time, a proof for another device, or no database to check it against all answer 401 { status: "gate-required" }.
import { type ParentEnv, verifyFreshParentProofFromRequest } from "./parent";

export type HostedFeature = "segment" | "image" | "transcribe" | "ar";

/** How old a proof may be, per feature. */
export const HOSTED_PROOF_MAX_AGE_MS: Record<HostedFeature, number> = {
  segment: 3 * 60_000,
  image: 3 * 60_000,
  transcribe: 3 * 60_000,
  ar: 5 * 60_000,
};

export interface HostedGateEnv extends ParentEnv {
  PARENT_GATE_SEGMENT?: string;
  PARENT_GATE_IMAGE?: string;
  PARENT_GATE_TRANSCRIBE?: string;
  PARENT_GATE_AR?: string;
}

const SWITCH: Record<HostedFeature, keyof HostedGateEnv> = {
  segment: "PARENT_GATE_SEGMENT",
  image: "PARENT_GATE_IMAGE",
  transcribe: "PARENT_GATE_TRANSCRIBE",
  ar: "PARENT_GATE_AR",
};

export const hostedGateOn = (env: HostedGateEnv, feature: HostedFeature): boolean => {
  const v = env[SWITCH[feature]];
  return typeof v === "string" && v.trim().toLowerCase() === "on";
};

const refuse = (feature: HostedFeature): Response =>
  new Response(JSON.stringify({ ok: false, status: "gate-required", feature, maxAgeSeconds: HOSTED_PROOF_MAX_AGE_MS[feature] / 1000, error: "A grown-up has to unlock this first." }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** null = go ahead (the switch is off, or the proof is fresh enough); otherwise the 401 to send. Call it BEFORE the request body is read or any model is called. */
export async function requireHostedGate(request: Request, env: HostedGateEnv, feature: HostedFeature, nowMs = Date.now()): Promise<Response | null> {
  if (!hostedGateOn(env, feature)) return null;
  if (await verifyFreshParentProofFromRequest(request, env, HOSTED_PROOF_MAX_AGE_MS[feature], nowMs)) return null;
  console.log(JSON.stringify({ event: "hosted_gate", status: "refused", feature })); // no device id, no body
  return refuse(feature);
}
