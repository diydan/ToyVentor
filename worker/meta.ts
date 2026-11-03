// Live SAM 3.1 segmentation via the Meta Model API (Responses, streaming).
// Verified end to end on 2026-10-27 against cup + water-bottle photos:
// image goes inline as a base64 data URL (file_id uploads are video-only),
// masks arrive as special-token text in the output_text lane, and an empty
// lane means zero matches for that prompt — retry with a shorter noun.
// Meta's SAM parser is imported only in this Worker module. The local box
// parser below remains the fallback if mask parsing fails for any reason.
import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
} from "@meta-sam/parser";
import {
  largestBox,
  parseSegmentationBoxes,
  summarizeMaskRaster,
  type SamBox,
  type SamMaskSummary,
} from "../shared/sam";
import { scanOutline, type ScanOutline, type ScanOutlineRequest } from "../shared/outlineScan";
import { type BackendEnv, hostedOnly } from "./modelBackend";
import type { OutlineMask } from "../shared/photoOutline";

export interface MetaEnv {
  /** Name used by every Meta example. */
  MODEL_API_KEY?: string;
  /** Earlier local name, still accepted. */
  META_MODEL_API_KEY?: string;
  /** Defaults to https://api.meta.ai/v1 */
  META_MODEL_API_URL?: string;
}

export type SamResult =
  | { status: "ok"; box: SamBox; matches: number; mask?: SamMaskSummary; outline?: ScanOutline }
  | { status: "no-match" }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/**
 * Which of these calls may run is decided by the model switch (worker/modelBackend.ts), one capability each: segment (SAM), image (the image model) and
 * text (the photo-nouns look). None has an adapter for our own models yet, so only "hosted" runs them; "self" and "off" answer "not configured" and send
 * nothing, so a switch pointed at our own models can never quietly reach Meta from here.
 */
export function samConfigured(env: BackendEnv): boolean {
  return hostedOnly(env, "segment") !== null;
}

export type SkinResult =
  | { status: "ok"; imageDataUrl: string }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/** Budgets cover the whole upstream operation, including streaming the
 *  response body. The client budgets sit above these so a server-side
 *  timeout answers before the client gives up. Measured 2026-10-30:
 *  live SAM ~2-8s, live skin image edit ~22s. */
export const SAM_TIMEOUT_MS = 20_000;
export const SKIN_TIMEOUT_MS = 45_000;

/** A timed-out upstream degrades to a generic message: no raw upstream
 *  text and no credentials ever reach the child's UI. */
function upstreamError(prefix: string, err: unknown): string {
  if (
    err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return `${prefix} timed out`;
  }
  return `${prefix} failed: ${(err as Error).message}`;
}

/** Muse Image edit: repaint the toy's surface, keep everything else. */
export async function makeSkin(
  env: BackendEnv,
  imageDataUrl: string,
  style: string,
  timeoutMs = SKIN_TIMEOUT_MS,
): Promise<SkinResult> {
  const hosted = hostedOnly(env, "image");
  const key = hosted?.key;
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };
  let res: Response;
  try {
    res = await fetch(hosted!.url("/images/edits"), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-image-1.0",
        prompt: `Repaint the main object's surface only: ${style}. Keep the exact same object shape, camera angle, table, background and lighting unchanged.`,
        images: [{ image_url: imageDataUrl }],
        n: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: "error", message: upstreamError("skin request", err) };
  }
  if (!res.ok) {
    // Upstream detail stays server side (see worker/muse.ts): the UI gets
    // a generic line so raw provider text never reaches a child.
    const detail = (await res.text()).slice(0, 300);
    console.log(JSON.stringify({ event: "skin-upstream", status: res.status, detail }));
    return { status: "error", message: "skin request failed" };
  }
  let body: {
    data?: { b64_json?: string }[];
    output_format?: string;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    return { status: "error", message: upstreamError("skin request", err) };
  }
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) return { status: "error", message: "skin response had no image" };
  const format = body.output_format === "png" ? "png" : "webp";
  return { status: "ok", imageDataUrl: `data:image/${format};base64,${b64}` };
}

interface SamWireEvent {
  readonly type: string;
  readonly delta?: unknown;
  readonly [key: string]: unknown;
}

const MAX_SAM_EVENTS = 10_000;
const MAX_SAM_TEXT_CHARS = 2_000_000;

function isSamWireEvent(value: unknown): value is SamWireEvent {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Read an SSE body to completion, collecting both output text (for the
 *  local box fallback) and structural events (for the official mask
 *  parser). Caps keep a malformed upstream stream from buffering without
 *  bound in Worker memory. */
async function collectStream(body: ReadableStream<Uint8Array>): Promise<{
  text: string;
  events: SamWireEvent[];
  truncated: boolean;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let truncated = false;
  const events: SamWireEvent[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SAM_TEXT_CHARS) truncated = true;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        try {
          const parsed: unknown = JSON.parse(line.slice(5));
          if (!isSamWireEvent(parsed)) continue;
          if (events.length < MAX_SAM_EVENTS) events.push(parsed);
          else truncated = true;
          if (
            parsed.type === "response.output_text.delta" &&
            typeof parsed.delta === "string"
          ) {
            if (text.length + parsed.delta.length <= MAX_SAM_TEXT_CHARS) {
              text += parsed.delta;
            } else truncated = true;
          }
        } catch {
          // Non-JSON keepalive lines are not segmentation output.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, events, truncated };
}

/** The decoded mask of the chosen match: the compact summary, and the raster it came from (for the outline). */
interface DecodedMask {
  summary: SamMaskSummary;
  raster: OutlineMask;
  /** Where the raster's top-left pixel sits in the uploaded image. */
  bounds: { left: number; top: number };
}

async function decodeMask(
  events: SamWireEvent[],
  box: SamBox,
): Promise<DecodedMask | undefined> {
  try {
    async function* source(): AsyncIterable<SamWireEvent> {
      yield* events;
    }
    const result = await parseImageStream(source()).finalResult;
    if (result.outcome.status !== "completed") return undefined;
    if (result.diagnostics.some((d) => d.severity === "error")) return undefined;

    const masks = recordsOfKind(result.records, "mask");
    const record =
      masks.find((r) => Number(r.objectId) === box.objectId) ??
      masks.find(
        (r) =>
          Math.abs(r.bounds.left - box.x1) <= 1 &&
          Math.abs(r.bounds.top - box.y1) <= 1 &&
          Math.abs(r.bounds.right - (box.x2 + 1)) <= 1 &&
          Math.abs(r.bounds.bottom - (box.y2 + 1)) <= 1,
      );
    if (!record) return undefined;

    const raster = decodeMaskToRaster(record.mask);
    const summary = summarizeMaskRaster(
      raster,
      record.mask.width,
      record.mask.height,
      record.bounds,
      box.imageWidth,
      box.imageHeight,
    );
    if (!summary) return undefined;
    return {
      summary,
      raster: { data: raster, width: record.mask.width, height: record.mask.height },
      bounds: { left: record.bounds.left, top: record.bounds.top },
    };
  } catch {
    // Any parser/codec failure degrades to the existing box result.
    return undefined;
  }
}

export async function segmentToy(
  env: BackendEnv,
  imageDataUrl: string,
  prompt: string,
  timeoutMs = SAM_TIMEOUT_MS,
  /** `outline`: also legalize the mask into a print outline (F2b). Absent, nothing extra runs. */
  options: { outline?: ScanOutlineRequest } = {},
): Promise<SamResult> {
  const hosted = hostedOnly(env, "segment");
  const key = hosted?.key;
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };

  let res: Response;
  try {
    res = await fetch(hosted!.url("/responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "sam-3.1",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
        stream: true,
        metadata: { mask_encoding: "one_bit" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: "error", message: upstreamError("SAM request", err) };
  }

  if (!res.ok || !res.body) {
    const detail = res.body ? (await res.text()).slice(0, 300) : "no body";
    console.log(JSON.stringify({ event: "sam-upstream", status: res.status, detail }));
    return { status: "error", message: "SAM request failed" };
  }

  // The timeout also covers streaming: an abort mid-stream degrades to an
  // error result instead of an unhandled rejection.
  let collected: Awaited<ReturnType<typeof collectStream>>;
  try {
    collected = await collectStream(res.body);
  } catch (err) {
    return { status: "error", message: upstreamError("SAM request", err) };
  }
  const boxes = parseSegmentationBoxes(collected.text);
  const box = largestBox(boxes);
  if (!box) return { status: "no-match" };
  const decoded = collected.truncated
    ? undefined
    : await decodeMask(collected.events, box);
  const outline = options.outline ? outlineOf(decoded, box, options.outline) : undefined;
  return {
    status: "ok",
    box,
    matches: boxes.length,
    ...(decoded ? { mask: decoded.summary } : {}),
    ...(outline ? { outline } : {}),
  };
}

/** The print outline for a decoded mask. A legalizer fault must never cost the scan its box and mask, so it becomes a failure. */
function outlineOf(
  decoded: DecodedMask | undefined,
  box: SamBox,
  request: ScanOutlineRequest,
): ScanOutline {
  if (!decoded) {
    return { ok: false, reason: "bad_mask", detail: "no mask came back for this photo, so there is nothing to outline" };
  }
  try {
    return scanOutline(
      decoded.raster,
      decoded.bounds,
      { width: box.imageWidth, height: box.imageHeight },
      request,
    );
  } catch {
    return { ok: false, reason: "bad_mask", detail: "the outline step failed on this mask" };
  }
}

export type BoxesResult =
  | { status: "ok"; boxes: SamBox[] }
  | { status: "no-match" }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/**
 * SAM 3.1 for one short noun prompt, keeping EVERY match (segmentToy keeps only the largest). A streaming run repeats an object
 * on every frame, so the last box per objectId wins. The error message is generic on purpose: callers never forward it.
 */
export async function segmentBoxes(
  env: BackendEnv,
  imageDataUrl: string,
  prompt: string,
  timeoutMs = SAM_TIMEOUT_MS,
): Promise<BoxesResult> {
  const hosted = hostedOnly(env, "segment");
  const key = hosted?.key;
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };

  let res: Response;
  try {
    res = await fetch(hosted!.url("/responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "sam-3.1",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
        stream: true,
        metadata: { mask_encoding: "one_bit" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: "error", message: "SAM request failed" };
  }
  if (!res.ok || !res.body) {
    console.log(JSON.stringify({ event: "sam-boxes-upstream", status: res.status }));
    return { status: "error", message: "SAM request failed" };
  }
  let collected: Awaited<ReturnType<typeof collectStream>>;
  try {
    collected = await collectStream(res.body);
  } catch {
    return { status: "error", message: "SAM request failed" };
  }
  const byObject = new Map<number, SamBox>();
  for (const b of parseSegmentationBoxes(collected.text)) byObject.set(b.objectId, b);
  const boxes = [...byObject.values()];
  return boxes.length ? { status: "ok", boxes } : { status: "no-match" };
}

export type InspectResult = { checked: true; nouns: string[] } | { checked: false };

const INSPECT_TIMEOUT_MS = 12_000;
const NOUN_RE = /^[a-z][a-z ]{0,39}$/;

/** Defensively pull ranked segmenter nouns out of a Spark reply (JSON, possibly fenced). Exported for tests. */
export function parseInspectNouns(text: string): string[] {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1)) as { nouns?: unknown };
    if (!Array.isArray(parsed.nouns)) return [];
    const out: string[] = [];
    for (const raw of parsed.nouns) {
      if (typeof raw !== "string") continue;
      const noun = raw.trim().toLowerCase();
      if (NOUN_RE.test(noun) && !out.includes(noun)) out.push(noun);
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Scan Assist (forge-ai A1; spike passed live 2026-11-02): one Spark vision call proposes ranked nouns
 * for SAM. Fail-soft by contract — any failure answers { checked: false } and the caller keeps today's
 * client-noun behaviour. Low reasoning effort first (the spike's default effort took ~10 s); one plain
 * retry covers models that reject the reasoning parameter.
 */
export async function inspectPhotoNouns(
  env: BackendEnv,
  imageDataUrl: string,
  timeoutMs = INSPECT_TIMEOUT_MS,
): Promise<InspectResult> {
  const hosted = hostedOnly(env, "text");
  const key = hosted?.key;
  if (!key || !imageDataUrl.startsWith("data:image/")) return { checked: false };
  const call = (withEffort: boolean) =>
    fetch(hosted!.url("/responses"), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-spark-1.3",
        ...(withEffort ? { reasoning: { effort: "low" } } : {}),
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: 'List the main objects in this photo as short nouns for an image segmenter. Reply with JSON only: {"nouns": ["...", "..."]} ranked by prominence, at most 6.',
              },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  try {
    let res = await call(true);
    if (!res.ok) res = await call(false);
    if (!res.ok) return { checked: false };
    const body = (await res.json()) as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    const nouns = parseInspectNouns(text);
    return nouns.length ? { checked: true, nouns } : { checked: false };
  } catch {
    return { checked: false };
  }
}

/** The selfie cartoon redraw: Muse Image edits the photo into a flat, outlined, plain-backdrop cartoon portrait. */
export const SELFIE_CARTOON_PROMPT =
  "Redraw this photo as a friendly flat cartoon portrait for a children's toy. Keep the same head position, hair colour, skin tone and expression, and keep the face large and centred. Bold dark outlines, flat colours, one solid plain pale background colour, no text, no letters, no watermark. Family friendly.";

export async function cartoonizeFace(
  env: BackendEnv,
  imageDataUrl: string,
  timeoutMs = SKIN_TIMEOUT_MS,
): Promise<SkinResult> {
  const hosted = hostedOnly(env, "image");
  const key = hosted?.key;
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };
  let res: Response;
  try {
    res = await fetch(hosted!.url("/images/edits"), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-image-1.0",
        prompt: SELFIE_CARTOON_PROMPT,
        images: [{ image_url: imageDataUrl }],
        n: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: "error", message: "cartoon request failed" };
  }
  if (!res.ok) {
    // Upstream detail never reaches the logs or the client: the status code is enough.
    console.log(JSON.stringify({ event: "cartoon-upstream", status: res.status }));
    return { status: "error", message: "cartoon request failed" };
  }
  let body: { data?: { b64_json?: string }[]; output_format?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { status: "error", message: "cartoon request failed" };
  }
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) return { status: "error", message: "cartoon response had no image" };
  const format = body.output_format === "png" ? "png" : "webp";
  return { status: "ok", imageDataUrl: `data:image/${format};base64,${b64}` };
}
