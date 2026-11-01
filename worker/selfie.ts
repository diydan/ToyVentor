// Opt-in "Smart face" for the Kip selfie: two routes that send ONE downscaled photo to Meta's models on the child's behalf.
//
//   POST /api/selfie/face-parts   SAM 3.1 finds the eyes and the mouth; the client lines the photo up with them.
//   POST /api/selfie/cartoon      Muse Image redraws the photo as a flat cartoon portrait.
//
// This is the only place a selfie leaves the device, so it is strict and boring on purpose:
//  - DEFAULT OFF. Nothing runs unless SELFIE_CLOUD is "on" and a model key exists. Keep it off in production until the COPPA review
//    is done (docs/specs/kip-demo-implementation.md).
//  - A grown-up must have passed the parent gate (a live `x-parent-proof` for this `x-device-id`, see worker/parent.ts) and the
//    client must have shown the consent screen (`x-selfie-consent: v1`).
//  - The picture is never logged, stored, cached or forwarded beyond the one model call. Logs carry an event name and a status only.
//    The client's IP and device id are used for the rate limit in this isolate and go nowhere else.
//  - Upstream failures become a generic status; upstream text never reaches the client or the logs.
//
// Order of checks (a disabled deployment reveals nothing): method, disabled, size/content-type, consent, device id, proof,
// rate limit, then the body is read and the image validated, then the model is called.
import { isPlayerId } from "../shared/ownership";
import type { SamBox } from "../shared/sam";
import { readCappedJson } from "./body";
import { cartoonizeFace, samConfigured, segmentBoxes, type BoxesResult, type MetaEnv } from "./meta";
import { verifyParentProofFromRequest, type ParentEnv } from "./parent";

export interface SelfieEnv extends MetaEnv, ParentEnv {
  /** "on" enables the selfie cloud routes. Anything else (or unset) keeps them off. */
  SELFIE_CLOUD?: string;
}

export const SELFIE_CONSENT_VERSION = "v1";
/** The client sends a JPEG of at most 768 px (about 100-200 KB); these are ceilings. */
export const MAX_SELFIE_BODY_BYTES = 1_200_000;
export const MAX_SELFIE_JPEG_BYTES = 900_000;

/** In-isolate budgets, per device and per IP, per kind. Best effort only (requests can land on different isolates); the
 *  Cloudflare dashboard rule is the durable limit, as for the other metered routes. */
const RATE_WINDOW_MS = 60_000;
const LIMITS = {
  "face-parts": { device: 6, ip: 12 },
  cartoon: { device: 3, ip: 6 },
} as const;
type Kind = keyof typeof LIMITS;
const hits = new Map<string, number[]>();

function hit(key: string, limit: number, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

/** True when this device or this IP is over its budget for `kind`. Records the hit either way. */
export function selfieRateLimited(
  kind: Kind,
  deviceId: string,
  ip: string | null | undefined,
  now = Date.now(),
): boolean {
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  const byDevice = hit(`${kind}|dev|${deviceId}`, LIMITS[kind].device, now);
  const byIp = ip ? hit(`${kind}|ip|${ip}`, LIMITS[kind].ip, now) : false;
  return byDevice || byIp;
}

export function resetSelfieRateLimit(): void {
  hits.clear();
}

/** True when the routes may run at all: switched on AND a model key is present. */
export function selfieCloudEnabled(env: SelfieEnv): boolean {
  return env.SELFIE_CLOUD === "on" && samConfigured(env);
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function logStatus(event: string, status: string | number): void {
  console.log(JSON.stringify({ event, status }));
}

const JPEG_PREFIX = "data:image/jpeg;base64,";

/** The data URL when it is a base64 JPEG within the size cap, else null. Never throws. */
export function validJpegDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(JPEG_PREFIX)) return null;
  const b64 = value.slice(JPEG_PREFIX.length);
  if (b64.length < 16 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  if ((b64.length / 4) * 3 - pad > MAX_SELFIE_JPEG_BYTES) return null;
  try {
    const head = atob(b64.slice(0, 8));
    if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) return null;
  } catch {
    return null;
  }
  return value;
}

interface Pt {
  x: number;
  y: number;
}

const centre = (b: SamBox): Pt => ({ x: (b.x1 + b.x2) / 2 / b.imageWidth, y: (b.y1 + b.y2) / 2 / b.imageHeight });
const area = (b: SamBox) => (b.x2 - b.x1) * (b.y2 - b.y1);
const sane = (b: SamBox) => b.imageWidth > 0 && b.imageHeight > 0 && b.x2 >= b.x1 && b.y2 >= b.y1;

/**
 * The two eyes from SAM's "eye" boxes: of the four largest, the pair at the most similar height and at least 0.1 of the width
 * apart; or one very wide box (goggles, a visor) split in two. Left eye (smaller x) first. Null when there is no usable pair.
 */
export function pickEyes(boxes: SamBox[]): [Pt, Pt] | null {
  const ok = boxes.filter(sane);
  if (ok.length >= 2) {
    const top = [...ok].sort((a, b) => area(b) - area(a)).slice(0, 4).map(centre);
    let best: [Pt, Pt] | null = null;
    let bestDy = Infinity;
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const dy = Math.abs(top[i]!.y - top[j]!.y);
        if (dy < bestDy && Math.abs(top[i]!.x - top[j]!.x) > 0.1) {
          bestDy = dy;
          best = [top[i]!, top[j]!];
        }
      }
    }
    if (best) return best[0].x <= best[1].x ? best : [best[1], best[0]];
    return null;
  }
  if (ok.length === 1) {
    const b = ok[0]!;
    const wide = (b.x2 - b.x1) / b.imageWidth;
    if (wide > 0.35) {
      const c = centre(b);
      return [{ x: c.x - wide / 4, y: c.y }, { x: c.x + wide / 4, y: c.y }];
    }
  }
  return null;
}

/** The mouth: the centre of the largest "mouth" box. */
export function pickMouth(boxes: SamBox[]): Pt | null {
  const ok = boxes.filter(sane);
  if (!ok.length) return null;
  return centre([...ok].sort((a, b) => area(b) - area(a))[0]!);
}

const inUnit = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** A face: both eyes level, the mouth below them and between them. Anything else is "no match", never a guess. */
export function plausibleFace(eyes: [Pt, Pt], mouth: Pt): boolean {
  const [l, r] = eyes;
  if (![l, r, mouth].every(inUnit)) return false;
  if (!(l.x < r.x)) return false;
  if (Math.abs(l.y - r.y) >= 0.08) return false;
  if (!(mouth.y > (l.y + r.y) / 2 + 0.05)) return false;
  if (mouth.x < l.x - 0.15 || mouth.x > r.x + 0.15) return false;
  return true;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** What the routes share: everything before the model call. Returns the validated data URL or an early response. */
async function gate(
  request: Request,
  env: SelfieEnv,
  kind: Kind,
  event: string,
): Promise<{ response: Response } | { image: string }> {
  if (request.method !== "POST") return { response: reply(405, { status: "method-not-allowed" }) };
  if (!selfieCloudEnabled(env)) {
    logStatus(event, "disabled");
    return { response: reply(503, { status: "disabled" }) };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SELFIE_BODY_BYTES) return { response: reply(413, { status: "too-large" }) };
  if (!(request.headers.get("content-type") ?? "").includes("application/json"))
    return { response: reply(415, { status: "invalid" }) };
  if (request.headers.get("x-selfie-consent") !== SELFIE_CONSENT_VERSION)
    return { response: reply(403, { status: "consent-required" }) };
  const deviceId = request.headers.get("x-device-id");
  if (!isPlayerId(deviceId)) return { response: reply(401, { status: "gate-required" }) };
  if (!(await verifyParentProofFromRequest(request, env))) {
    logStatus(event, "gate-required");
    return { response: reply(401, { status: "gate-required" }) };
  }
  if (selfieRateLimited(kind, deviceId, request.headers.get("CF-Connecting-IP"))) {
    logStatus(event, "slow-down");
    return { response: reply(429, { status: "slow-down" }) };
  }
  const parsed = await readCappedJson(request, MAX_SELFIE_BODY_BYTES);
  if (!parsed.ok) return { response: parsed.over ? reply(413, { status: "too-large" }) : reply(422, { status: "invalid" }) };
  const image = validJpegDataUrl((parsed.value as { image?: unknown } | null)?.image);
  if (!image) return { response: reply(422, { status: "invalid" }) };
  return { image };
}

/** Eyes and mouth from SAM, as fractions of the picture. The two prompts run in parallel; an empty one is retried once with a synonym. */
export async function handleSelfieFaceParts(request: Request, env: SelfieEnv): Promise<Response> {
  const event = "selfie_face_parts";
  const g = await gate(request, env, "face-parts", event);
  if ("response" in g) return g.response;

  const [eyeRun, mouthRun] = await Promise.all([
    segmentBoxes(env, g.image, "eye"),
    segmentBoxes(env, g.image, "mouth"),
  ]);
  const failed = (r: BoxesResult) => r.status === "error";
  if (failed(eyeRun) || failed(mouthRun)) {
    logStatus(event, "unavailable");
    return reply(502, { status: "unavailable" });
  }
  if (eyeRun.status === "not-configured" || mouthRun.status === "not-configured") {
    logStatus(event, "disabled");
    return reply(503, { status: "disabled" });
  }
  let eyeBoxes = eyeRun.status === "ok" ? eyeRun.boxes : [];
  let mouthBoxes = mouthRun.status === "ok" ? mouthRun.boxes : [];
  // one retry with a synonym, only for a part that came back empty or unusable
  const retries: Promise<void>[] = [];
  if (!pickEyes(eyeBoxes)) {
    retries.push(segmentBoxes(env, g.image, "eyes").then((r) => { if (r.status === "ok") eyeBoxes = r.boxes; }));
  }
  if (!pickMouth(mouthBoxes)) {
    retries.push(segmentBoxes(env, g.image, "lips").then((r) => { if (r.status === "ok") mouthBoxes = r.boxes; }));
  }
  if (retries.length) await Promise.all(retries);

  const eyes = pickEyes(eyeBoxes);
  const mouth = pickMouth(mouthBoxes);
  if (!eyes || !mouth || !plausibleFace(eyes, mouth)) {
    logStatus(event, "no-match");
    return reply(200, { status: "no-match" });
  }
  logStatus(event, "ok");
  return reply(200, {
    status: "ok",
    eyes: eyes.map((p) => ({ x: round4(p.x), y: round4(p.y) })),
    mouth: { x: round4(mouth.x), y: round4(mouth.y) },
  });
}

/** The photo redrawn as a flat cartoon portrait by Muse Image (about 20 s). */
export async function handleSelfieCartoon(request: Request, env: SelfieEnv): Promise<Response> {
  const event = "selfie_cartoon";
  const g = await gate(request, env, "cartoon", event);
  if ("response" in g) return g.response;
  const result = await cartoonizeFace(env, g.image);
  if (result.status === "not-configured") {
    logStatus(event, "disabled");
    return reply(503, { status: "disabled" });
  }
  if (result.status === "error") {
    logStatus(event, "unavailable");
    return reply(502, { status: "unavailable" });
  }
  logStatus(event, "ok");
  return reply(200, { status: "ok", image: result.imageDataUrl });
}
