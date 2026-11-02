// ToyVentor API Worker. Static assets are served before this Worker runs;
// it only sees /api/* (plus SPA fallback misses). Secrets live here and in
// .dev.vars locally — never in the browser bundle.
import seedCar from "../seed/toys/seed-car.json";
import { parseScanOutlineRequest } from "../shared/outlineScan";
import {
  dimensionsFromBox,
  dimensionsFromPixelSize,
  normalizeBox,
} from "../shared/sam";
import {
  toyFromScanInput,
  validateToy,
  type Toy,
  type ToyKind,
} from "../shared/toy";
import { readCappedJson } from "./body";
import { makeSkin, samConfigured, segmentToy, type MetaEnv } from "./meta";
import {
  forgeOptimizerConfigured,
  handleForgeArtifact,
  handleForgeJobStatus,
  handleForgePreview,
  type ForgeOptimizerEnv,
} from "./forgeOptimizer";
import { handleMuseSpark, museConfigured, type MuseEnv } from "./muse";
import { handleOwnership, type OwnershipEnv } from "./ownership";
import { handleParent, type ParentEnv } from "./parent";
import { handleRoomScan } from "./roomScan";
import { handleSelfieCartoon, handleSelfieFaceParts, selfieCloudEnabled, type SelfieEnv } from "./selfie";

export interface Env
  extends MetaEnv,
    MuseEnv,
    OwnershipEnv,
    ParentEnv,
    SelfieEnv,
    ForgeOptimizerEnv {
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
  /** Feature 3: "room" routes to the gated multi-noun room scan (worker/roomScan.ts). Absent = toy scan. */
  mode?: unknown;
  imageDataUrl?: unknown;
  nouns?: unknown;
  toy?: unknown;
  prompt?: unknown;
  scan?: {
    id?: unknown;
    name?: unknown;
    kind?: unknown;
    lengthMm?: unknown;
    prompt?: unknown;
    imageDataUrl?: unknown;
    /** Opt-in (F2b): also return the legalized print outline of the mask. */
    outline?: unknown;
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
  let outlineRequest: ReturnType<typeof parseScanOutlineRequest> | undefined;
  if (scan.outline !== undefined) {
    outlineRequest = parseScanOutlineRequest(scan.outline);
    if (!outlineRequest.ok) return json({ error: "invalid scan request" }, 422);
  }

  const result = await segmentToy(
    env,
    imageDataUrl,
    prompt,
    undefined,
    outlineRequest?.ok ? { outline: outlineRequest.request } : {},
  );
  console.log(
    JSON.stringify({
      event: "sam_scan",
      prompt,
      status: result.status,
      ...(result.status === "ok" ? { maskApplied: Boolean(result.mask) } : {}),
      ...(result.status === "ok" && result.outline ? { outline: result.outline.ok ? "ok" : result.outline.reason } : {}),
    }),
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

  const dims = result.mask
    ? dimensionsFromPixelSize(result.mask.pixelWidth, result.mask.pixelHeight, lengthMm)
    : dimensionsFromBox(result.box, lengthMm);
  const toy = toyFromScanInput({
    id,
    name,
    kind: kind as ToyKind,
    lengthMm: dims.lengthMm,
    widthMm: dims.widthMm,
    source: "scan",
    outline: result.mask?.outline ?? normalizeBox(result.box),
    ...(result.mask ? { mask: result.mask } : {}),
  });
  // The client already holds the photo; don't echo ~150KB back at it.
  return json({
    toy,
    sam: {
      configured: true,
      applied: true,
      maskApplied: Boolean(result.mask),
      matches: result.matches,
      box: result.box,
      ...(result.outline ? { outline: result.outline } : {}),
    },
  });
}

async function handleScanPost(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    return json({ error: "expected application/json" }, 415);

  const parsedScan = await readCappedJson(request, MAX_SCAN_BYTES);
  if (!parsedScan.ok)
    return json(
      { error: parsedScan.over ? `scan payload over ${MAX_SCAN_BYTES} bytes` : "invalid JSON body" },
      parsedScan.over ? 413 : 400,
    );
  const body = parsedScan.value as ScanBody;

  if (body.mode === "room") return handleRoomScan(request, env, body);

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
  const parsedSkin = await readCappedJson(request, MAX_SCAN_BYTES);
  if (!parsedSkin.ok)
    return json(
      { error: parsedSkin.over ? `skin payload over ${MAX_SCAN_BYTES} bytes` : "invalid JSON body" },
      parsedSkin.over ? 413 : 400,
    );
  const { imageDataUrl, style } = parsedSkin.value as { imageDataUrl?: unknown; style?: unknown };
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

    if (url.pathname === "/world/ToyVentor-World.html") {
      // Legacy share links: browsers preserve the #toy= fragment across 302.
      return new Response(null, { status: 302, headers: { location: "/" } });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "toyventor",
        samConfigured: samConfigured(env),
        museConfigured: museConfigured(env),
        selfieCloud: selfieCloudEnabled(env),
        forgeOptimizerConfigured: forgeOptimizerConfigured(env),
      });
    }

    if (url.pathname === "/api/forge/preview") {
      return handleForgePreview(request, env);
    }

    if (url.pathname.startsWith("/api/forge/jobs/")) {
      const jobId = url.pathname.slice("/api/forge/jobs/".length);
      return handleForgeJobStatus(request, env, jobId);
    }

    if (url.pathname.startsWith("/api/forge/artifacts/")) {
      const artifactName = url.pathname.slice("/api/forge/artifacts/".length);
      return handleForgeArtifact(request, env, artifactName);
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

    if (url.pathname === "/api/muse/spark") {
      // Create mode in ToyVentor World: the game asks for a level recipe
      // and gets {say, recipe} back.
      return handleMuseSpark(request, env);
    }

    // Opt-in selfie cloud: SAM eyes and mouth, Muse cartoon. Off unless SELFIE_CLOUD=on; needs the parent gate and consent.
    if (url.pathname === "/api/selfie/face-parts") return handleSelfieFaceParts(request, env);
    if (url.pathname === "/api/selfie/cartoon") return handleSelfieCartoon(request, env);

    if (url.pathname === "/api/ownership" || url.pathname.startsWith("/api/ownership/")) {
      return handleOwnership(request, env, url.pathname.slice("/api/ownership".length));
    }

    if (url.pathname.startsWith("/api/parent/")) {
      return handleParent(request, env, url.pathname.slice("/api/parent".length));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
