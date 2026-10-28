// ToyVentor API Worker. Static assets are served before this Worker runs;
// it only sees /api/* (plus SPA fallback misses). Secrets live here and in
// .dev.vars locally — never in the browser bundle.
import seedCar from "../seed/toys/seed-car.json";
import { dimensionsFromBox, normalizeBox } from "../shared/sam";
import {
  toyFromScanInput,
  validateToy,
  type Toy,
  type ToyKind,
} from "../shared/toy";
import { makeSkin, samConfigured, segmentToy, type MetaEnv } from "./meta";
import { handleOwnership, type OwnershipEnv } from "./ownership";

export interface Env extends MetaEnv, OwnershipEnv {
  MUREKA_API_KEY?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

/** Client photos are downscaled before upload; reject anything bigger
 *  instead of buffering an unbounded body into Worker memory. */
const MAX_SCAN_BYTES = 2_000_000;
const KINDS: ToyKind[] = ["car", "figure", "other"];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ScanBody {
  toy?: unknown;
  prompt?: unknown;
  scan?: {
    id?: unknown;
    name?: unknown;
    kind?: unknown;
    lengthMm?: unknown;
    prompt?: unknown;
    imageDataUrl?: unknown;
  };
}

async function handleSamScan(scan: NonNullable<ScanBody["scan"]>, env: Env) {
  const { id, name, kind, lengthMm, prompt, imageDataUrl } = scan;
  if (
    typeof id !== "string" || !id ||
    typeof name !== "string" || !name ||
    !KINDS.includes(kind as ToyKind) ||
    typeof lengthMm !== "number" || lengthMm < 10 || lengthMm > 1000 ||
    typeof prompt !== "string" || !prompt || prompt.length > 60 ||
    typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")
  ) {
    return json({ error: "invalid scan request" }, 422);
  }

  const result = await segmentToy(env, imageDataUrl, prompt);
  console.log(
    JSON.stringify({ event: "sam_scan", prompt, status: result.status }),
  );
  if (result.status !== "ok") {
    return json({
      toy: null,
      sam: {
        configured: samConfigured(env),
        applied: false,
        status: result.status,
        ...(result.status === "error" ? { message: result.message } : {}),
      },
    });
  }

  const dims = dimensionsFromBox(result.box, lengthMm);
  const toy = toyFromScanInput({
    id,
    name,
    kind: kind as ToyKind,
    lengthMm: dims.lengthMm,
    widthMm: dims.widthMm,
    source: "scan",
    outline: normalizeBox(result.box),
  });
  // The client already holds the photo; don't echo ~150KB back at it.
  return json({
    toy,
    sam: { configured: true, applied: true, matches: result.matches, box: result.box },
  });
}

async function handleScanPost(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    return json({ error: "expected application/json" }, 415);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SCAN_BYTES)
    return json({ error: `scan payload over ${MAX_SCAN_BYTES} bytes` }, 413);

  let body: ScanBody;
  try {
    body = (await request.json()) as ScanBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (body.scan) return handleSamScan(body.scan, env);

  // Manual path: a toy the client measured by hand, validated here.
  const errors = validateToy(body.toy);
  if (errors.length > 0) return json({ error: "invalid toy", errors }, 422);
  const toy = body.toy as Toy;
  console.log(
    JSON.stringify({ event: "scan_received", source: toy.source, kind: toy.kind }),
  );
  return json({
    toy,
    sam: { configured: samConfigured(env), applied: false },
  });
}

async function handleSkinPost(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    return json({ error: "expected application/json" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SCAN_BYTES)
    return json({ error: `skin payload over ${MAX_SCAN_BYTES} bytes` }, 413);
  let body: { imageDataUrl?: unknown; style?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { imageDataUrl, style } = body;
  if (
    typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/") ||
    typeof style !== "string" || !style || style.length > 140
  ) {
    return json({ error: "invalid skin request" }, 422);
  }
  const result = await makeSkin(env, imageDataUrl, style);
  console.log(JSON.stringify({ event: "skin", status: result.status }));
  if (result.status === "ok") return json({ skin: { applied: true }, imageDataUrl: result.imageDataUrl });
  return json({
    skin: {
      applied: false,
      status: result.status,
      ...(result.status === "error" ? { message: result.message } : {}),
    },
    imageDataUrl: null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "toyventor", samConfigured: samConfigured(env) });
    }

    if (url.pathname === "/api/scan") {
      // GET = preloaded backup toy (demo fallback). POST with {scan} runs
      // live SAM; POST with {toy} validates a hand-measured toy.
      if (request.method === "POST") return handleScanPost(request, env);
      if (request.method === "GET") return json(seedCar);
      return json({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/api/skin") {
      if (request.method === "POST") return handleSkinPost(request, env);
      return json({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/api/ownership" || url.pathname.startsWith("/api/ownership/")) {
      return handleOwnership(request, env, url.pathname.slice("/api/ownership".length));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
