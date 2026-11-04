// Feature 3 v1 (docs/specs/sam-physical-to-digital-spec.md §6/§8 S0b): one side-on room photo -> SAM box
// segments for a closed prop-noun list. The client maps segments to a level (runtime/roomPhoto.ts); this
// route only runs SAM and returns normalized boxes. The photo is never stored or logged.
//
// S0b gate (Forge pattern): live parent proof + per-device/per-IP sliding-window budgets + a job budget
// (max nouns, parallelism cap, one total deadline). The limiter is in-isolate like worker/forgeOptimizer.ts;
// spec Q9 (durable counter store) is still open — budgets here are best-effort until it lands.
import { isPlayerId } from "../shared/ownership";
import { normalizeBox, type NormalizedBox } from "../shared/sam";
import { segmentBoxes, type MetaEnv } from "./meta";
import { verifyParentProofFromRequest, type ParentEnv } from "./parent";

/** Closed prop-noun list (spec §6.1 step 2). Data, capped; client may only subset it. */
export const ROOM_NOUNS = [
  "book",
  "cup",
  "pillow",
  "box",
  "chair",
  "plant",
  "teddy bear",
  "ball",
  "lamp",
  "shoe",
  "toy car",
  "blocks",
] as const;

export const ROOM_JOB = {
  maxNouns: 12,
  parallelism: 4,
  perCallTimeoutMs: 10_000,
  totalDeadlineMs: 45_000,
  maxInstances: 16,
} as const;

const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = { device: 5, ip: 10 } as const; // room jobs per minute (each fans out to <= 12 SAM calls). Dan, 2026-11-04: 5 and 10 (were 3 and 6), for demo retakes.
const hits = new Map<string, number[]>();

function recordHit(key: string, limit: number, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

export function roomRateLimited(deviceId: string, ip: string | null | undefined, now = Date.now()): boolean {
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  const byDevice = recordHit(`room|dev|${deviceId}`, RATE_LIMITS.device, now);
  const byIp = ip ? recordHit(`room|ip|${ip}`, RATE_LIMITS.ip, now) : false;
  return byDevice || byIp;
}

export interface RoomSegment {
  noun: string;
  box: NormalizedBox;
}

export type RoomScanResult =
  | { status: "ok"; segments: RoomSegment[]; calls: number }
  | { status: "no-match"; calls: number }
  | { status: "not-configured" }
  | { status: "error"; message: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Validate the requested nouns against the closed list. Unknown nouns are dropped, never forwarded. */
export function roomNounsFor(requested: unknown): string[] {
  if (!Array.isArray(requested) || requested.length === 0) return [...ROOM_NOUNS];
  const allowed = new Set<string>(ROOM_NOUNS);
  const picked = requested.filter((n): n is string => typeof n === "string" && allowed.has(n.trim().toLowerCase()));
  return [...new Set(picked.map((n) => n.trim().toLowerCase()))].slice(0, ROOM_JOB.maxNouns);
}

/**
 * Run the nouns under the job budget: batches of `parallelism`, each call bounded by the time left to the
 * total deadline. A noun that errors or times out contributes nothing; the job still answers with the rest.
 */
export async function segmentRoom(
  env: MetaEnv,
  imageDataUrl: string,
  nouns: readonly string[],
  now: () => number = Date.now,
): Promise<RoomScanResult> {
  if (!imageDataUrl.startsWith("data:image/")) return { status: "error", message: "image must be a data:image URL" };
  const list = nouns.slice(0, ROOM_JOB.maxNouns);
  const deadline = now() + ROOM_JOB.totalDeadlineMs;
  const segments: RoomSegment[] = [];
  let calls = 0;
  let configured = true;
  for (let i = 0; i < list.length; i += ROOM_JOB.parallelism) {
    if (now() >= deadline) break;
    const batch = list.slice(i, i + ROOM_JOB.parallelism);
    const results = await Promise.all(
      batch.map(async (noun) => {
        const left = deadline - now();
        if (left <= 0) return { noun, result: null };
        calls++;
        const result = await segmentBoxes(env, imageDataUrl, noun, Math.min(ROOM_JOB.perCallTimeoutMs, left));
        return { noun, result };
      }),
    );
    for (const { noun, result } of results) {
      if (!result) continue;
      if (result.status === "not-configured") { configured = false; continue; }
      if (result.status !== "ok") continue;
      for (const box of result.boxes) {
        if (segments.length >= ROOM_JOB.maxInstances) break;
        segments.push({ noun, box: normalizeBox(box) });
      }
    }
    if (segments.length >= ROOM_JOB.maxInstances) break;
  }
  if (!configured && segments.length === 0) return { status: "not-configured" };
  return segments.length ? { status: "ok", segments, calls } : { status: "no-match", calls };
}

/** POST /api/scan with { mode: "room", imageDataUrl, nouns? }. Parent-gated and budget-limited (S0b). */
export async function handleRoomScan(
  request: Request,
  env: ParentEnv & MetaEnv,
  body: { imageDataUrl?: unknown; nouns?: unknown },
): Promise<Response> {
  const deviceId = request.headers.get("x-device-id");
  if (!isPlayerId(deviceId)) return json({ error: "gate-required" }, 401);
  if (!(await verifyParentProofFromRequest(request, env))) {
    console.log(JSON.stringify({ event: "room_scan", status: "gate-required" }));
    return json({ error: "gate-required" }, 401);
  }
  if (roomRateLimited(deviceId, request.headers.get("CF-Connecting-IP"))) {
    console.log(JSON.stringify({ event: "room_scan", status: "slow-down" }));
    return json({ error: "slow-down" }, 429);
  }
  const { imageDataUrl } = body;
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return json({ error: "invalid room scan request" }, 422);
  }
  const nouns = roomNounsFor(body.nouns);
  const result = await segmentRoom(env, imageDataUrl, nouns);
  console.log(
    JSON.stringify({
      event: "room_scan",
      status: result.status,
      ...(result.status === "ok" || result.status === "no-match" ? { calls: result.calls } : {}),
      ...(result.status === "ok" ? { segments: result.segments.length } : {}),
    }),
  );
  if (result.status === "ok") return json({ segments: result.segments, sam: { configured: true, calls: result.calls } });
  if (result.status === "no-match") return json({ segments: [], sam: { configured: true, calls: result.calls, status: "no-match" } });
  if (result.status === "not-configured") return json({ segments: [], sam: { configured: false, status: "not-configured" } });
  return json({ segments: [], sam: { configured: true, status: "error", message: result.message } });
}
