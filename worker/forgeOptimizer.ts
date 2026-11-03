// Guarded Worker proxy for dynamic / AI part fast-preview + background optimization.
//
// Security & privacy posture (mirrors worker/selfie.ts & worker/muse.ts):
//  - DEFAULT OFF: returns 503 `{status: "disabled"}` unless FORGE_OPTIMIZER_URL is valid,
//    and non-loopback upstreams MUST also configure FORGE_OPTIMIZER_TOKEN.
//  - PARENT GATE REQUIRED: every route requires a valid `x-device-id` and live HMAC
//    `x-parent-proof` verified via `verifyParentProofFromRequest` (worker/parent.ts).
//  - RATE LIMITED: per-device and per-IP sliding-window budgets (`preview`: 3/min/device,
//    6/min/IP; `poll`: 30/min/device, 60/min/IP).
//  - STRICT ALLOWLIST: never forwards raw client bodies. Rejects `stl_path`, `verify_preprint`,
//    and `legalize`; rebuilds upstream JSON from validated fields only.
//  - BOUNDED TIMEOUTS & SAFE ERRORS: upstream `fetch` uses `AbortSignal.timeout`, distinguishes
//    timeout (504) vs network unreachable (502) vs non-JSON / upstream 5xx ("unavailable", 502),
//    and never leaks upstream text or server filesystem paths.
import {
  checkForgeRecipeBrandSafety,
  FORGE_EAR_STYLES,
  FORGE_HEAD_TOPS,
  FORGE_MAX_PROFILE_POINTS,
  FORGE_SLOTS,
  FORGE_SNOUT_STYLES,
  FORGE_SPIKE_LAYOUTS,
  type ForgeFastPreviewRequest,
  type ForgeLoftSlice,
  type ForgeRecipeV1,
  type ForgeSlot,
  type ForgeSupportPolicy,
} from "../shared/forgeOptimizer";
import { isPlayerId } from "../shared/ownership";
import { readCappedJson } from "./body";
import { verifyParentProofFromRequest, type ParentEnv } from "./parent";

export interface ForgeOptimizerEnv extends ParentEnv {
  FORGE_OPTIMIZER_URL?: string;
  FORGE_OPTIMIZER_TOKEN?: string;
}

export const MAX_FORGE_BODY_BYTES = 3_600_000;
export const MAX_FORGE_STL_BYTES = 2_500_000;
const UPSTREAM_PREVIEW_TIMEOUT_MS = 8_000;
const UPSTREAM_POLL_TIMEOUT_MS = 4_000;
const MAX_UPSTREAM_JSON_BYTES = 3_600_000;

const JOB_ID_RE = /^fjob_[a-f0-9]{12}$/;
const ARTIFACT_NAME_RE =
  /^[a-z0-9_]{2,64}\.(?:[a-f0-9]{12}|[a-f0-9]{8}\.draft)\.(?:glb|stl)$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const RATE_WINDOW_MS = 60_000;
const LIMITS = {
  preview: { device: 3, ip: 6 },
  poll: { device: 30, ip: 60 },
} as const;
type RateKind = keyof typeof LIMITS;
const hits = new Map<string, number[]>();

/**
 * Records one call against `key` and says how long, in whole seconds, until the next call would be let in: 0 when this one was.
 * Every call counts, refused ones too (a caller that keeps asking keeps itself out). The next call is let in once the hit
 * `limit` places from the end of the window is a window old, because only then are `limit - 1` earlier hits left.
 */
function recordHit(key: string, limit: number, now: number): number {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (recent.length <= limit) return 0;
  const frees = recent[recent.length - limit]!;
  // Every hit in `recent` is under a window old, so this is positive and the rounded-up wait is at least a second.
  return Math.ceil((frees + RATE_WINDOW_MS - now) / 1000);
}

/** Counts a call against the device's and the address's budgets. Returns the seconds to wait before another would be let in, 0 if this one was. */
export function forgeRateLimitWait(
  kind: RateKind,
  deviceId: string,
  ip: string | null | undefined,
  now = Date.now(),
): number {
  if (hits.size > 5_000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  const byDevice = recordHit(`${kind}|dev|${deviceId}`, LIMITS[kind].device, now);
  const byIp = ip ? recordHit(`${kind}|ip|${ip}`, LIMITS[kind].ip, now) : 0;
  return Math.max(byDevice, byIp);
}

export function forgeRateLimited(
  kind: RateKind,
  deviceId: string,
  ip: string | null | undefined,
  now = Date.now(),
): boolean {
  return forgeRateLimitWait(kind, deviceId, ip, now) > 0;
}

export function resetForgeRateLimit(): void {
  hits.clear();
}

function reply(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function logEvent(event: string, status: string | number, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, status, ...(extra ?? {}) }));
}

function parseConfiguredUpstream(env: ForgeOptimizerEnv): URL | null {
  const raw = env.FORGE_OPTIMIZER_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  const hasToken = Boolean(env.FORGE_OPTIMIZER_TOKEN?.trim());
  if (!isLoopback && !hasToken) return null;
  return parsed;
}

export function forgeOptimizerConfigured(env: ForgeOptimizerEnv): boolean {
  return parseConfiguredUpstream(env) !== null;
}

function upstreamUrl(base: URL, path: string): string {
  const prefix = base.toString().replace(/\/+$/, "");
  return `${prefix}${path}`;
}

function upstreamHeaders(env: ForgeOptimizerEnv): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const tok = env.FORGE_OPTIMIZER_TOKEN?.trim();
  if (tok) {
    headers["authorization"] = `Bearer ${tok}`;
  }
  return headers;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** The listed keys of `f` that are finite numbers; everything else is dropped (the daemon clamps the rest). */
function numFields<K extends string>(f: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const v = f[k];
    if (isFiniteNum(v)) out[k] = v;
  }
  return out;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function isValidSlot(v: unknown): v is ForgeSlot {
  return typeof v === "string" && (FORGE_SLOTS as readonly string[]).includes(v);
}

function validStlBase64(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length < 112 || trimmed.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const pad = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  const byteLen = (trimmed.length / 4) * 3 - pad;
  if (byteLen < 84 || byteLen > MAX_FORGE_STL_BYTES) return null;
  return trimmed;
}

function sanitizeRecipe(raw: unknown): { ok: true; recipe: ForgeRecipeV1 } | { ok: false } {
  if (!isRecord(raw)) return { ok: false };
  if ("legalize" in raw && raw.legalize === false) {
    // Disallow opting out of deterministic slope/dimension clamps.
    return { ok: false };
  }
  if (!isValidSlot(raw.slot)) return { ok: false };
  let support_policy: ForgeSupportPolicy | undefined;
  if (raw.support_policy !== undefined) {
    if (raw.support_policy !== "none" && raw.support_policy !== "minimal") {
      return { ok: false };
    }
    if (
      raw.support_policy === "minimal" &&
      raw.slot !== "crown" &&
      raw.slot !== "head" &&
      raw.slot !== "back"
    ) {
      return { ok: false };
    }
    support_policy = raw.support_policy;
  }
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) {
    return { ok: false };
  }
  if (raw.id !== undefined && (typeof raw.id !== "string" || raw.id.length > 64)) {
    return { ok: false };
  }
  if (
    raw.behavior !== undefined &&
    (typeof raw.behavior !== "string" || raw.behavior.length > 160)
  ) {
    return { ok: false };
  }
  const stat =
    raw.stat === "Speed" || raw.stat === "Spin" || raw.stat === "Torque" || raw.stat === "Glow"
      ? raw.stat
      : "Glow";

  if (!isRecord(raw.shape)) return { ok: false };
  const shapeObj = raw.shape;
  const kindRaw = shapeObj.kind ?? (raw.slot === "hand" ? "star2d" : "loft");

  let cleanShape: ForgeRecipeV1["shape"];
  if (raw.slot === "hand" && kindRaw === "star2d") {
    cleanShape = {
      kind: "star2d",
      ...(isFiniteNum(shapeObj.points) ? { points: Math.round(shapeObj.points) } : {}),
      ...(isFiniteNum(shapeObj.outer_r_mm) ? { outer_r_mm: shapeObj.outer_r_mm } : {}),
      ...(isFiniteNum(shapeObj.inner_r_mm) ? { inner_r_mm: shapeObj.inner_r_mm } : {}),
      ...(isFiniteNum(shapeObj.grip_tu) ? { grip_tu: Math.round(shapeObj.grip_tu) } : {}),
    };
  } else if (raw.slot === "hand" && kindRaw === "profile2d") {
    if (!Array.isArray(shapeObj.points) || shapeObj.points.length < 3 || shapeObj.points.length > FORGE_MAX_PROFILE_POINTS) {
      return { ok: false };
    }
    const pts: [number, number][] = [];
    for (const p of shapeObj.points) {
      if (!Array.isArray(p) || p.length !== 2 || !isFiniteNum(p[0]) || !isFiniteNum(p[1])) {
        return { ok: false };
      }
      pts.push([p[0], p[1]]);
    }
    cleanShape = {
      kind: "profile2d",
      points: pts,
      ...(isFiniteNum(shapeObj.fillet_r_mm) ? { fillet_r_mm: shapeObj.fillet_r_mm } : {}),
      ...(isFiniteNum(shapeObj.grip_tu) ? { grip_tu: Math.round(shapeObj.grip_tu) } : {}),
    };
  } else if (kindRaw === "loft") {
    if (!Array.isArray(shapeObj.slices) || shapeObj.slices.length < 2 || shapeObj.slices.length > 16) {
      return { ok: false };
    }
    const slices: ForgeLoftSlice[] = [];
    for (const s of shapeObj.slices) {
      if (!isRecord(s) || !isFiniteNum(s.z) || !isFiniteNum(s.w) || !isFiniteNum(s.d) || !isFiniteNum(s.r)) {
        return { ok: false };
      }
      slices.push({
        z: s.z,
        w: s.w,
        d: s.d,
        r: s.r,
        ...(isFiniteNum(s.x) ? { x: s.x } : {}),
        ...(isFiniteNum(s.y) ? { y: s.y } : {}),
      });
    }
    const top = oneOf(shapeObj.top, FORGE_HEAD_TOPS);
    cleanShape = {
      kind: "loft",
      slices,
      ...(isFiniteNum(shapeObj.height_mm) ? { height_mm: shapeObj.height_mm } : {}),
      ...(top ? { top } : {}),
    };
  } else {
    return { ok: false };
  }

  let cleanFeatures: ForgeRecipeV1["features"];
  if (raw.features !== undefined) {
    if (!Array.isArray(raw.features) || raw.features.length > 6) return { ok: false };
    cleanFeatures = [];
    for (const f of raw.features) {
      if (!isRecord(f)) return { ok: false };
      if (f.op === "knob") {
        cleanFeatures.push({
          op: "knob",
          ...(isFiniteNum(f.radius_mm) ? { radius_mm: f.radius_mm } : {}),
        });
      } else if (f.op === "brim") {
        cleanFeatures.push({
          op: "brim",
          ...(isFiniteNum(f.width_mm) ? { width_mm: f.width_mm } : {}),
          ...(isFiniteNum(f.depth_mm) ? { depth_mm: f.depth_mm } : {}),
          ...(isFiniteNum(f.thickness_mm) ? { thickness_mm: f.thickness_mm } : {}),
        });
      } else if (f.op === "ears") {
        const style = oneOf(f.style, FORGE_EAR_STYLES);
        cleanFeatures.push({
          op: "ears",
          ...(style ? { style } : {}),
          ...numFields(f, ["width_mm", "height_mm", "thickness_mm", "tilt_deg", "z_frac"] as const),
        });
      } else if (f.op === "horns") {
        cleanFeatures.push({ op: "horns", ...numFields(f, ["length_mm", "base_mm", "curl"] as const) });
      } else if (f.op === "spikes") {
        const layout = oneOf(f.layout, FORGE_SPIKE_LAYOUTS);
        cleanFeatures.push({
          op: "spikes",
          ...(layout ? { layout } : {}),
          ...numFields(f, ["count", "height_mm", "base_mm", "center_boost_mm", "wall_mm"] as const),
        });
      } else if (f.op === "snout") {
        const style = oneOf(f.style, FORGE_SNOUT_STYLES);
        cleanFeatures.push({
          op: "snout",
          ...(style ? { style } : {}),
          ...numFields(f, ["length_mm", "width_mm", "height_mm", "z_frac"] as const),
        });
      } else if (f.op === "ribs") {
        cleanFeatures.push({ op: "ribs", ...numFields(f, ["count", "depth_mm", "width_mm"] as const) });
      } else if (f.op === "star") {
        cleanFeatures.push({ op: "star", ...numFields(f, ["size_mm", "thickness_mm"] as const) });
      } else if (f.op === "hollow") {
        cleanFeatures.push({ op: "hollow", ...numFields(f, ["wall_mm", "depth_mm"] as const) });
      } else {
        return { ok: false };
      }
    }
  }

  const recipe: ForgeRecipeV1 = {
    v: 1,
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    name: raw.name.trim(),
    stat,
    ...(typeof raw.behavior === "string" && raw.behavior.trim()
      ? { behavior: raw.behavior.trim() }
      : {}),
    slot: raw.slot,
    ...(support_policy ? { support_policy } : {}),
    shape: cleanShape,
    ...(cleanFeatures ? { features: cleanFeatures } : {}),
  };
  return { ok: true, recipe };
}

function sanitizePreviewRequest(
  raw: unknown,
): { ok: true; payload: ForgeFastPreviewRequest; hasRecipe: boolean } | { ok: false; response: Response } {
  if (!isRecord(raw)) {
    return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
  }
  // Explicitly reject local-file and gate-bypass keys even if sent by a client.
  if ("stl_path" in raw || "verify_preprint" in raw) {
    return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
  }

  const hasRecipe = raw.recipe !== undefined && raw.recipe !== null;
  const hasStl = raw.stl_base64 !== undefined && raw.stl_base64 !== null;
  if (hasRecipe === hasStl) {
    return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
  }

  const enqueue_background =
    typeof raw.enqueue_background === "boolean" ? raw.enqueue_background : true;
  const include_glb_base64 =
    typeof raw.include_glb_base64 === "boolean" ? raw.include_glb_base64 : true;

  if (hasRecipe) {
    const clean = sanitizeRecipe(raw.recipe);
    if (!clean.ok) {
      return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
    }
    const brandErr = checkForgeRecipeBrandSafety(clean.recipe);
    if (brandErr) {
      return { ok: false, response: reply(422, { ok: false, status: "brand-rejected" }) };
    }
    return {
      ok: true,
      hasRecipe: true,
      payload: {
        recipe: clean.recipe,
        enqueue_background,
        include_glb_base64,
      },
    };
  }

  const stlB64 = validStlBase64(raw.stl_base64);
  if (!stlB64) {
    return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
  }
  let slot: ForgeSlot | undefined;
  if (raw.slot !== undefined && raw.slot !== null) {
    if (!isValidSlot(raw.slot)) {
      return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
    }
    slot = raw.slot;
  }
  let partId: string | undefined;
  if (raw.part_id !== undefined && raw.part_id !== null) {
    if (typeof raw.part_id !== "string" || raw.part_id.length > 64) {
      return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
    }
    if (checkForgeRecipeBrandSafety({ name: raw.part_id, slot: slot ?? "crown", shape: { slices: [] } })) {
      return { ok: false, response: reply(422, { ok: false, status: "brand-rejected" }) };
    }
    partId = raw.part_id;
  }

  let supportPolicy: ForgeSupportPolicy | undefined;
  if (raw.support_policy !== undefined && raw.support_policy !== null) {
    if (raw.support_policy !== "none" && raw.support_policy !== "minimal") {
      return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
    }
    if (
      raw.support_policy === "minimal" &&
      slot !== "crown" &&
      slot !== "head" &&
      slot !== "back"
    ) {
      return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
    }
    supportPolicy = raw.support_policy;
  }

  return {
    ok: true,
    hasRecipe: false,
    payload: {
      ...(partId ? { part_id: partId } : {}),
      ...(slot ? { slot } : {}),
      ...(supportPolicy ? { support_policy: supportPolicy } : {}),
      stl_base64: stlB64,
      enqueue_background,
      include_glb_base64,
    },
  };
}

async function gateForge(
  request: Request,
  env: ForgeOptimizerEnv,
  expectedMethod: "GET" | "POST",
  rateKind: RateKind,
  event: string,
): Promise<{ ok: true; baseUrl: URL } | { ok: false; response: Response }> {
  if (request.method !== expectedMethod) {
    return { ok: false, response: reply(405, { ok: false, status: "method-not-allowed" }) };
  }
  const baseUrl = parseConfiguredUpstream(env);
  if (!baseUrl) {
    return { ok: false, response: reply(503, { ok: false, status: "disabled" }) };
  }
  if (expectedMethod === "POST") {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_FORGE_BODY_BYTES) {
      return { ok: false, response: reply(413, { ok: false, status: "too-large" }) };
    }
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      return { ok: false, response: reply(415, { ok: false, status: "invalid" }) };
    }
  }
  const deviceId = request.headers.get("x-device-id");
  if (!isPlayerId(deviceId)) {
    return { ok: false, response: reply(401, { ok: false, status: "gate-required" }) };
  }
  if (!(await verifyParentProofFromRequest(request, env))) {
    logEvent(event, "gate-required");
    return { ok: false, response: reply(401, { ok: false, status: "gate-required" }) };
  }
  const wait = forgeRateLimitWait(rateKind, deviceId, request.headers.get("CF-Connecting-IP"));
  if (wait > 0) {
    logEvent(event, "slow-down", { retryAfterS: wait });
    // Says when a retry will be let in; a caller that asks sooner only extends its own lock-out.
    return { ok: false, response: reply(429, { ok: false, status: "slow-down" }, { "retry-after": String(wait) }) };
  }
  return { ok: true, baseUrl };
}

async function fetchUpstreamJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  event: string,
): Promise<{ ok: true; data: Record<string, unknown>; status: number } | { ok: false; response: Response }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      logEvent(event, "timeout");
      return { ok: false, response: reply(504, { ok: false, status: "timeout" }) };
    }
    logEvent(event, "unreachable");
    return { ok: false, response: reply(502, { ok: false, status: "unreachable" }) };
  }

  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    const extra = retry && /^\d{1,3}$/.test(retry) ? { "retry-after": retry } : undefined;
    logEvent(event, "queue_full");
    return { ok: false, response: reply(429, { ok: false, status: "queue_full" }, extra) };
  }
  if (res.status === 404) {
    return { ok: false, response: reply(404, { ok: false, status: "not-found" }) };
  }
  if (res.status === 413) {
    return { ok: false, response: reply(413, { ok: false, status: "too-large" }) };
  }
  if (res.status === 400 || res.status === 422) {
    return { ok: false, response: reply(422, { ok: false, status: "invalid" }) };
  }
  if (res.status < 200 || res.status >= 300) {
    logEvent(event, "upstream_error", { httpStatus: res.status });
    return { ok: false, response: reply(502, { ok: false, status: "unavailable" }) };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    logEvent(event, "upstream_non_json", { httpStatus: res.status });
    return { ok: false, response: reply(502, { ok: false, status: "unavailable" }) };
  }

  const parsed = await readCappedJson(res, MAX_UPSTREAM_JSON_BYTES);
  if (!parsed.ok || !isRecord(parsed.value)) {
    logEvent(event, "upstream_bad_json");
    return { ok: false, response: reply(502, { ok: false, status: "unavailable" }) };
  }
  return { ok: true, data: parsed.value, status: res.status };
}

function scrubPreviewOutput(d: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: Boolean(d.ok),
    status: "preview_ready",
    part_id: typeof d.part_id === "string" ? d.part_id : "custom_part",
    job_id: typeof d.job_id === "string" ? d.job_id : null,
    draft_artifact: typeof d.draft_artifact === "string" ? d.draft_artifact : "",
    glb_size: typeof d.glb_size === "number" ? d.glb_size : 0,
    orig_tris: typeof d.orig_tris === "number" ? d.orig_tris : 0,
    web_verts: typeof d.web_verts === "number" ? d.web_verts : 0,
    web_tris: typeof d.web_tris === "number" ? d.web_tris : 0,
    finish_class: typeof d.finish_class === "string" ? d.finish_class : "show_curved",
    elapsed_ms: typeof d.elapsed_ms === "number" ? d.elapsed_ms : 0,
    ...(typeof d.glb_base64 === "string" ? { glb_base64: d.glb_base64 } : {}),
  };
}

/**
 * What the daemon's own symmetry step did to a hand outline (`legalizer.symmetry` on the job record), so the caller can tell that the plate
 * was built from a different outline than the one it sent. Only these four fields and only these types go out; the daemon's other
 * legalizer notes (size rescale, dropped features) stay behind the allowlist.
 */
function scrubLegalizer(v: unknown): { symmetry: { action: string; iou_before: number | null; iou_after: number | null; points: number | null } } | null {
  if (!isRecord(v) || !isRecord(v.symmetry)) return null;
  const s = v.symmetry;
  if (typeof s.action !== "string" || !/^[a-z_]{1,40}$/.test(s.action)) return null;
  const num = (x: unknown): number | null => (isFiniteNum(x) ? x : null);
  return { symmetry: { action: s.action, iou_before: num(s.iou_before), iou_after: num(s.iou_after), points: num(s.points) } };
}

function scrubJobOutput(d: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: Boolean(d.ok),
    job_id: typeof d.job_id === "string" ? d.job_id : "",
    part_id: typeof d.part_id === "string" ? d.part_id : "",
    status: typeof d.status === "string" ? d.status : "failed",
    created_at: typeof d.created_at === "number" ? d.created_at : 0,
    updated_at: typeof d.updated_at === "number" ? d.updated_at : 0,
    stl_artifact: typeof d.stl_artifact === "string" ? d.stl_artifact : null,
    glb_artifact: typeof d.glb_artifact === "string" ? d.glb_artifact : null,
    content_hash: typeof d.content_hash === "string" ? d.content_hash : null,
    slicer_recipe: isRecord(d.slicer_recipe) ? d.slicer_recipe : null,
    metrics: isRecord(d.metrics) ? d.metrics : null,
    gate_report: isRecord(d.gate_report) ? d.gate_report : null,
    legalizer: scrubLegalizer(d.legalizer),
    error: typeof d.error === "string" ? "optimization failed" : null,
    elapsed_ms: typeof d.elapsed_ms === "number" ? d.elapsed_ms : null,
  };
}

export async function handleForgePreview(
  request: Request,
  env: ForgeOptimizerEnv,
): Promise<Response> {
  const event = "forge_fast_preview";
  const g = await gateForge(request, env, "POST", "preview", event);
  if (!g.ok) return g.response;

  const parsed = await readCappedJson(request, MAX_FORGE_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.over
      ? reply(413, { ok: false, status: "too-large" })
      : reply(400, { ok: false, status: "invalid" });
  }

  const sanitized = sanitizePreviewRequest(parsed.value);
  if (!sanitized.ok) return sanitized.response;

  const up = await fetchUpstreamJson(
    upstreamUrl(g.baseUrl, "/v1/fast-preview"),
    {
      method: "POST",
      headers: upstreamHeaders(env),
      body: JSON.stringify(sanitized.payload),
    },
    UPSTREAM_PREVIEW_TIMEOUT_MS,
    event,
  );
  if (!up.ok) return up.response;

  logEvent(event, "ok", { hasRecipe: sanitized.hasRecipe });
  return reply(up.status, scrubPreviewOutput(up.data));
}

export async function handleForgeJobStatus(
  request: Request,
  env: ForgeOptimizerEnv,
  jobId: string,
): Promise<Response> {
  const event = "forge_job_poll";
  if (request.method === "GET" && !JOB_ID_RE.test(jobId)) {
    return reply(400, { ok: false, status: "invalid" });
  }
  const g = await gateForge(request, env, "GET", "poll", event);
  if (!g.ok) return g.response;

  const up = await fetchUpstreamJson(
    upstreamUrl(g.baseUrl, `/v1/jobs/${jobId}`),
    {
      method: "GET",
      headers: upstreamHeaders(env),
    },
    UPSTREAM_POLL_TIMEOUT_MS,
    event,
  );
  if (!up.ok) return up.response;

  return reply(up.status, scrubJobOutput(up.data));
}

export async function handleForgeArtifact(
  request: Request,
  env: ForgeOptimizerEnv,
  artifactName: string,
): Promise<Response> {
  const event = "forge_artifact";
  if (request.method === "GET" && !ARTIFACT_NAME_RE.test(artifactName)) {
    return reply(400, { ok: false, status: "invalid" });
  }
  const g = await gateForge(request, env, "GET", "poll", event);
  if (!g.ok) return g.response;

  let res: Response;
  try {
    res = await fetch(upstreamUrl(g.baseUrl, `/v1/artifacts/${artifactName}`), {
      method: "GET",
      headers: upstreamHeaders(env),
      signal: AbortSignal.timeout(UPSTREAM_POLL_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return reply(504, { ok: false, status: "timeout" });
    }
    return reply(502, { ok: false, status: "unreachable" });
  }

  if (res.status === 404) {
    return reply(404, { ok: false, status: "not-found" });
  }
  if (res.status !== 200 || !res.body) {
    return reply(502, { ok: false, status: "unavailable" });
  }

  const contentType = artifactName.endsWith(".glb") ? "model/gltf-binary" : "model/stl";
  const cacheControl = artifactName.includes(".draft.")
    ? "no-store"
    : "public, max-age=31536000, immutable";
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": cacheControl,
    },
  });
}
