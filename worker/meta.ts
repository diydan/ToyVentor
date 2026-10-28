// Live SAM 3.1 segmentation via the Meta Model API (Responses, streaming).
// Verified end to end on 2026-10-27 against cup + water-bottle photos:
// image goes inline as a base64 data URL (file_id uploads are video-only),
// masks arrive as special-token text in the output_text lane, and an empty
// lane means zero matches for that prompt — retry with a shorter noun.
import { largestBox, parseSegmentationBoxes, type SamBox } from "../shared/sam";

export interface MetaEnv {
  /** Name used by every Meta example. */
  MODEL_API_KEY?: string;
  /** Earlier local name, still accepted. */
  META_MODEL_API_KEY?: string;
  /** Defaults to https://api.meta.ai/v1 */
  META_MODEL_API_URL?: string;
}

export type SamResult =
  | { status: "ok"; box: SamBox; matches: number }
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

/** Read an SSE body to completion, collecting output_text deltas. The
 *  stream is consumed and aggregated here; callers get one JSON result. */
async function collectStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        try {
          const event = JSON.parse(line.slice(5)) as {
            type?: string;
            delta?: string;
          };
          if (event.type === "response.output_text.delta" && event.delta)
            text += event.delta;
        } catch {
          // Non-JSON keepalive lines are not segmentation output.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
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

  const boxes = parseSegmentationBoxes(await collectStream(res.body));
  const box = largestBox(boxes);
  if (!box) return { status: "no-match" };
  return { status: "ok", box, matches: boxes.length };
}
