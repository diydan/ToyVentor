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

export interface MetaEnv {
  /** Name used by every Meta example. */
  MODEL_API_KEY?: string;
  /** Earlier local name, still accepted. */
  META_MODEL_API_KEY?: string;
  /** Defaults to https://api.meta.ai/v1 */
  META_MODEL_API_URL?: string;
}

export type SamResult =
  | { status: "ok"; box: SamBox; matches: number; mask?: SamMaskSummary }
  | { status: "no-match" }
  | { status: "not-configured" }
  | { status: "error"; message: string };

function apiKey(env: MetaEnv): string | undefined {
  return env.MODEL_API_KEY ?? env.META_MODEL_API_KEY;
}

export function samConfigured(env: MetaEnv): boolean {
  return Boolean(apiKey(env));
}

function apiUrl(env: MetaEnv, path: string): string {
  const base = (env.META_MODEL_API_URL ?? "https://api.meta.ai/v1")
    .replace(/\/+$/, "")
    .replace(/\/responses$/, "");
  return `${base}${path}`;
}

function responsesUrl(env: MetaEnv): string {
  return apiUrl(env, "/responses");
}

export type SkinResult =
  | { status: "ok"; imageDataUrl: string }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/** Muse Image edit: repaint the toy's surface, keep everything else. */
export async function makeSkin(
  env: MetaEnv,
  imageDataUrl: string,
  style: string,
): Promise<SkinResult> {
  const key = apiKey(env);
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };
  let res: Response;
  try {
    res = await fetch(apiUrl(env, "/images/edits"), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-image-1.0",
        prompt: `Repaint the main object's surface only: ${style}. Keep the exact same object shape, camera angle, table, background and lighting unchanged.`,
        images: [{ image_url: imageDataUrl }],
        n: 1,
      }),
    });
  } catch (err) {
    return { status: "error", message: `skin request failed: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { status: "error", message: `skin returned ${res.status}: ${detail}` };
  }
  const body = (await res.json()) as {
    data?: { b64_json?: string }[];
    output_format?: string;
  };
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

async function decodeMaskSummary(
  events: SamWireEvent[],
  box: SamBox,
): Promise<SamMaskSummary | undefined> {
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

    return summarizeMaskRaster(
      decodeMaskToRaster(record.mask),
      record.mask.width,
      record.mask.height,
      record.bounds,
      box.imageWidth,
      box.imageHeight,
    );
  } catch {
    // Any parser/codec failure degrades to the existing box result.
    return undefined;
  }
}

export async function segmentToy(
  env: MetaEnv,
  imageDataUrl: string,
  prompt: string,
): Promise<SamResult> {
  const key = apiKey(env);
  if (!key) return { status: "not-configured" };
  if (!imageDataUrl.startsWith("data:image/"))
    return { status: "error", message: "image must be a data:image URL" };

  let res: Response;
  try {
    res = await fetch(responsesUrl(env), {
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
    });
  } catch (err) {
    return { status: "error", message: `SAM request failed: ${(err as Error).message}` };
  }

  if (!res.ok || !res.body) {
    const detail = res.body ? (await res.text()).slice(0, 300) : "no body";
    return { status: "error", message: `SAM returned ${res.status}: ${detail}` };
  }

  const collected = await collectStream(res.body);
  const boxes = parseSegmentationBoxes(collected.text);
  const box = largestBox(boxes);
  if (!box) return { status: "no-match" };
  const mask = collected.truncated
    ? undefined
    : await decodeMaskSummary(collected.events, box);
  return {
    status: "ok",
    box,
    matches: boxes.length,
    ...(mask ? { mask } : {}),
  };
}
