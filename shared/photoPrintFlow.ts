/**
 * The photo-to-printable-accessory flow, without a screen (docs/specs/forge-ai-spec.md, F2b: "a screen that calls it").
 *
 * The Kip viewer's print panel (parts/kip/viewer/kip-photo-print.js) is a thin layer of buttons over this file, bundled by
 * scripts/build-kip.ts, so everything that can go wrong is decided and tested here, not in the DOM:
 *
 *   scanPhoto      the photo and a word ("spoon") to /api/scan, and the outline back, or one calm sentence for a child
 *   createParentGate  the app's grown-up check (challenge, then answer or PIN); the proof lives in this closure only
 *   printAccessory the fit loop through the Worker's forge routes (`preparePhotoAccessory`), the plate file, and one calm
 *                  sentence for every way it can end
 *   hintsFor       warnings on an outline, as sentences (never a raw code)
 *   overlayPoints  the outline in photo pixels, to draw the cut line on the photo
 *
 * The Worker allows 3 gate calls a minute a device and the real spoon needs 4, so `printAccessory` waits out a refused call (for the
 * time the Worker names in `retry-after`, or a full window and a second when it names none) and asks again (spec question 30 f is the owner's call on a
 * bigger budget). It never retries sooner: a refused call counts as a hit and keeps the caller locked out.
 *
 * No DOM, no clock of its own (`sleep`, `now` and `fetch` are passed in), no storage. Imports only the modules it drives.
 */

import { type OutlineGate } from "./outlineFit";
import { fetchPlateStl, forgeRouteGate, OutlineGateError } from "./outlineGate";
import { parseScanOutline, type ScanOutlineSuccess } from "./outlineScan";
import { symmetrizeOutline } from "./outlineSymmetry";
import { preparePhotoAccessory, type PhotoAccessory, type PhotoAccessoryOptions } from "./photoAccessory";
import { applyAffine, invertAffine, type OutlineFailure, type OutlineSuccess, withFlipped, withScaled } from "./photoOutline";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- the scan ------------------------------------------------------------------------------------------------------------

export const SCAN_ROUTE = "/api/scan";
export const GATE_ROUTE = "/api/parent/gate";
/** The shortest and tallest plate a child may ask for. The hand box is 90 mm; under 30 mm there is little to hold. */
export const MIN_HEIGHT_MM = 30;
export const MAX_HEIGHT_MM = 90;
export const DEFAULT_HEIGHT_MM = 54;
/** The Worker refuses a word over 60 characters and a body over 2 MB (`MAX_SCAN_BYTES`); a data URL is about the size of its body. */
export const MAX_WORD = 60;
export const MAX_PHOTO_DATA_URL = 1_900_000;

export interface ScanPhotoArgs {
  /** The photo, as the browser makes it: a `data:image/...` URL, already shrunk (about 512 px on the long side is what the helper needs). */
  imageDataUrl: string;
  /** What it is, in a word or two: the helper finds that. */
  word: string;
  /** How tall the printed plate should be. Clamped to 30 to 90 mm. */
  targetHeightMm?: number;
  /** `auto` (default) makes a clearly symmetric object symmetric; `off` leaves the outline as traced. */
  symmetry?: "auto" | "off";
  /** The scan's id and name; the Worker only needs them to be there. */
  id?: string;
}

export type ScanFailureReason =
  | "invalid_input"
  | "offline"
  | "slow_down"
  | "too_large"
  | "helper_off"
  | "no_match"
  | "no_outline"
  | "outline_failed"
  | "busy";

export type ScanPhotoResult =
  | { ok: true; scan: ScanOutlineSuccess }
  | { ok: false; reason: ScanFailureReason; message: string; outlineFailure?: OutlineFailure };

const scanFail = (reason: ScanFailureReason, message: string, outlineFailure?: OutlineFailure): ScanPhotoResult => ({ ok: false, reason, message, ...(outlineFailure ? { outlineFailure } : {}) });

/** The request body for `/api/scan`, or the sentence for why the input cannot be sent. */
export function buildScanRequest(args: ScanPhotoArgs): { ok: true; body: { scan: Record<string, unknown> } } | { ok: false; reason: ScanFailureReason; message: string } {
  const word = args.word.trim();
  if (!word || word.length > MAX_WORD) return { ok: false, reason: "invalid_input", message: "Type what it is in a word or two, like spoon or sword." };
  if (typeof args.imageDataUrl !== "string" || !args.imageDataUrl.startsWith("data:image/")) return { ok: false, reason: "invalid_input", message: "Pick a photo first." };
  if (args.imageDataUrl.length > MAX_PHOTO_DATA_URL) return { ok: false, reason: "too_large", message: "That photo is too big. Try a smaller one." };
  const asked = args.targetHeightMm ?? DEFAULT_HEIGHT_MM;
  if (!Number.isFinite(asked)) return { ok: false, reason: "invalid_input", message: "Pick a size between 30 and 90 millimetres." };
  const targetHeightMm = Math.round(Math.min(MAX_HEIGHT_MM, Math.max(MIN_HEIGHT_MM, asked)) * 10) / 10;
  return {
    ok: true,
    body: {
      scan: {
        id: args.id ?? "photo-accessory",
        name: "Photo accessory",
        kind: "other",
        lengthMm: 200, // the helper gives proportions and this gives scale; the print size is `targetHeightMm`
        prompt: word,
        imageDataUrl: args.imageDataUrl,
        outline: { targetHeightMm, ...(args.symmetry ? { symmetry: args.symmetry } : {}) },
      },
    },
  };
}

function outlineFailureText(f: OutlineFailure): string {
  switch (f.reason) {
    case "too_thin":
      return "That shape is too thin to print. Try a photo where it looks bigger.";
    case "not_simple":
      return "That outline is too tangled to print. Try another photo.";
    default:
      return "I could not find the shape. Try another photo.";
  }
}

/** Send the photo and the word to the helper and read the outline back, field by field. Never throws. */
export async function scanPhoto(doFetch: Fetch, args: ScanPhotoArgs): Promise<ScanPhotoResult> {
  const req = buildScanRequest(args);
  if (!req.ok) return scanFail(req.reason, req.message);
  let res: Response;
  try {
    res = await doFetch(SCAN_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body), credentials: "omit", cache: "no-store" });
  } catch {
    return scanFail("offline", "No connection to the online helper. Check the internet and try again.");
  }
  if (res.status === 429) return scanFail("slow_down", "Too many tries. Please wait a minute and try again.");
  if (res.status === 413) return scanFail("too_large", "That photo is too big. Try a smaller one.");
  if (res.status === 422 || res.status === 400) return scanFail("invalid_input", "That photo could not be used. Try another one.");
  if (!res.ok) return scanFail("busy", "The online helper is busy. Please try again in a minute.");
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return scanFail("busy", "The online helper is busy. Please try again in a minute.");
  }
  const sam = isRecord(json) && isRecord(json.sam) ? json.sam : undefined;
  if (!sam) return scanFail("busy", "The online helper is busy. Please try again in a minute.");
  if (sam.configured === false) return scanFail("helper_off", "The online helper is not turned on here.");
  const outline = parseScanOutline(sam.outline);
  if (outline?.ok) return { ok: true, scan: outline };
  if (outline) return scanFail("outline_failed", outlineFailureText(outline), outline);
  if (sam.status === "no-match" || sam.matches === 0) return scanFail("no_match", `I could not find a ${args.word.trim()} in the photo. Try a clearer photo or another word.`);
  return scanFail("no_outline", "The helper could not draw an outline. Try another photo.");
}

// ---- what to tell the child ----------------------------------------------------------------------------------------------

const HINTS: ReadonlyMap<string, string> = new Map([
  ["SPLIT_OBJECT", "The photo has more than one piece. Only the biggest piece is used."],
  ["LARGE_HOLES_FILLED", "Holes in the shape were filled in so it prints as one piece."],
  ["THIN_PARTS_REMOVED", "Some parts were too thin to print and were left out."],
  ["LOW_FIDELITY", "The printed shape is a bit different from the photo."],
  ["POINT_BUDGET_NOT_MET", "The edge is a little blocky."],
  ["NOT_SYMMETRIC", "This one is not the same on both sides, so it was left as it is."],
  ["GATE_REWROTE_OUTLINE", "The printer check smoothed the shape a little, so the sticker may not line up exactly."],
]);

/** A warning code on an outline as a sentence for a child. A code it does not know says nothing: a raw code is never shown. */
export function hintsFor(warnings: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of warnings) {
    const text = HINTS.get(w);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** The outline in photo pixels (the photo as it was sent), to draw the cut line on the photo. Empty if the map cannot be turned round. */
export function overlayPoints(scan: Pick<ScanOutlineSuccess, "points" | "photoToPlate">): [number, number][] {
  const back = invertAffine(scan.photoToPlate);
  if (!back) return [];
  return scan.points.map(([x, z]): [number, number] => applyAffine(back, x, z) as [number, number]);
}

/** What a child can change about the shape before it is checked. The order is the print step's: symmetry, then size, then flip. */
export interface Choices {
  flip?: boolean;
  /** A factor on the outline (1.1 is ten percent bigger). The 90 mm box may cap it. */
  scale?: number;
  symmetry?: "mirror";
}

export type ChoicesPreview = { ok: true; outline: OutlineSuccess; appliedScale?: number } | { ok: false; message: string };

/**
 * The outline as the printer check will receive it with these choices, so the picture on screen is the shape that is checked:
 * `preparePhotoAccessory` applies the same three steps in the same order (a test pins that the first gate call gets exactly these points).
 */
export function previewChoices(scan: ScanOutlineSuccess, choices: Choices = {}): ChoicesPreview {
  let outline: OutlineSuccess = scan;
  if (choices.symmetry === "mirror") {
    const made = symmetrizeOutline(outline, { mode: "mirror" });
    if (!made.report.applied && !made.report.symmetric) return { ok: false, message: "This one cannot be made the same on both sides without losing a piece." };
    outline = made.outline;
  }
  let appliedScale: number | undefined;
  if (choices.scale !== undefined) {
    if (!(Number.isFinite(choices.scale) && choices.scale > 0)) return { ok: false, message: "That size cannot be used." };
    const scaled = withScaled(outline, choices.scale);
    outline = scaled.outline;
    appliedScale = scaled.factor;
  }
  if (choices.flip) outline = withFlipped(outline);
  return { ok: true, outline, ...(appliedScale === undefined ? {} : { appliedScale }) };
}

/** True when the outline has not been made symmetric yet (a scan does it by itself when the object is clearly symmetric). */
export function canMakeSymmetric(scan: Pick<ScanOutlineSuccess, "changes">): boolean {
  return !scan.changes.some((c) => c.code === "made_symmetric");
}

// ---- the grown-up check --------------------------------------------------------------------------------------------------

export type GateChallenge =
  | { status: "ok"; mode: "math" | "pin"; a: number; b: number; challengeToken: string; cooldownUntil: number | null }
  | { status: "offline" | "disabled" | "unavailable" };

export type GateVerify =
  | { status: "ok" }
  | { status: "wrong"; attemptsRemaining?: number; retryAfterSeconds?: number; cooldown: boolean }
  | { status: "offline" | "unavailable" };

export interface ParentGate {
  /** A proof that will still be good for a few seconds. */
  hasProof(): boolean;
  clearProof(): void;
  challenge(): Promise<GateChallenge>;
  verify(answer: { challengeToken?: string; answer?: number | string; pin?: string }): Promise<GateVerify>;
  /** What every forge request carries: the device id, and the proof when there is one (without it the Worker answers 401). */
  headers(): Record<string, string>;
}

const DEVICE_RE = /^[A-Za-z0-9-]{16,64}$/;

export interface ParentGateOptions {
  fetch: Fetch;
  /** The app's anonymous device id (src/lib/sync.ts), read on every call. */
  deviceId: () => string | null;
  now?: () => number;
}

/** The app's parent gate, as the viewer's selfie code talks to it. The proof is kept in this closure and nowhere else. */
export function createParentGate(options: ParentGateOptions): ParentGate {
  const now = options.now ?? (() => Date.now());
  let proof: { token: string; expiresAt: number } | null = null;
  const device = (): string => {
    const id = options.deviceId();
    return id && DEVICE_RE.test(id) ? id : "";
  };
  const base = (): Record<string, string> => ({ "content-type": "application/json", "x-device-id": device() });

  async function post(body: unknown): Promise<{ http: number; data: Record<string, unknown> | null } | { offline: true }> {
    let res: Response;
    try {
      res = await options.fetch(GATE_ROUTE, { method: "POST", headers: base(), body: JSON.stringify(body), credentials: "omit", cache: "no-store" });
    } catch {
      return { offline: true };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // not JSON
    }
    return { http: res.status, data: isRecord(data) ? data : null };
  }

  return {
    hasProof: () => Boolean(proof && proof.expiresAt > now() + 5000),
    clearProof() {
      proof = null;
    },
    async challenge() {
      const r = await post({ action: "challenge" });
      if ("offline" in r) return { status: "offline" };
      const d = r.data;
      if (r.http === 200 && d && typeof d.a === "number" && typeof d.b === "number" && typeof d.challengeToken === "string") {
        return { status: "ok", mode: d.mode === "pin" ? "pin" : "math", a: d.a, b: d.b, challengeToken: d.challengeToken, cooldownUntil: typeof d.cooldownUntil === "number" ? d.cooldownUntil : null };
      }
      return { status: r.http === 501 ? "disabled" : "unavailable" };
    },
    async verify({ challengeToken, answer, pin }) {
      const body = typeof pin === "string" ? { action: "verify", pin } : { action: "verify", challengeToken, answer: Number(answer) };
      const r = await post(body);
      if ("offline" in r) return { status: "offline" };
      const d = r.data;
      if (r.http === 200 && d && d.ok === true && typeof d.proofToken === "string") {
        proof = { token: d.proofToken, expiresAt: Number(d.expiresAt) || now() + 120_000 };
        return { status: "ok" };
      }
      if (r.http === 403) {
        return {
          status: "wrong",
          ...(typeof d?.attemptsRemaining === "number" ? { attemptsRemaining: d.attemptsRemaining } : {}),
          ...(typeof d?.retryAfterSeconds === "number" ? { retryAfterSeconds: d.retryAfterSeconds } : {}),
          cooldown: d?.error === "pin_cooldown",
        };
      }
      return { status: "unavailable" };
    },
    headers() {
      return { "x-device-id": device(), ...(proof ? { "x-parent-proof": proof.token } : {}) };
    },
  };
}

/** One calm sentence for the gate's answer to a question. */
export function gateMessage(r: GateChallenge | GateVerify): string {
  switch (r.status) {
    case "ok":
      return "";
    case "wrong":
      return r.cooldown && r.retryAfterSeconds ? `Too many wrong tries. Please wait ${r.retryAfterSeconds} seconds.` : "That was not right. Please ask a grown-up to try again.";
    case "disabled":
      return "The grown-up check is not turned on here.";
    case "offline":
      return "No connection. Check the internet and try again.";
    default:
      return "The grown-up check is busy. Please try again in a minute.";
  }
}

// ---- the print step ------------------------------------------------------------------------------------------------------

export type PrintProgress =
  /** Gate call `call` is starting. */
  | { stage: "checking"; call: number }
  /** Call `call` was refused for now; waiting `seconds` before asking again. */
  | { stage: "waiting"; call: number; seconds: number }
  /** The grown-up check ran out in the middle: it is being asked again. */
  | { stage: "asking_again"; call: number }
  | { stage: "fetching_plate" };

export type PrintFailureReason =
  | "too_many_waits"
  | "gate_required"
  | "disabled"
  | "rejected"
  | "busy"
  | "no_outline"
  | "cannot_symmetrize"
  | "does_not_print"
  | "no_size_found"
  | "invalid_options"
  | "brand_rejected";

export type PrintResult =
  | { ok: true; accessory: PhotoAccessory; plateStl: Uint8Array | null; plateMessage?: string; hints: string[] }
  | { ok: false; reason: PrintFailureReason; message: string; detail?: string };

export interface PrintArgs {
  scan: ScanOutlineSuccess;
  gate: ParentGate;
  fetch: Fetch;
  options?: PhotoAccessoryOptions;
  onProgress?: (e: PrintProgress) => void;
  /** Called when a gate call is refused for want of a live proof: ask the grown-up again, and say whether it worked. Without it that ends the print. */
  renewGate?: () => Promise<boolean>;
  /** How to wait out a refused call. Default: real time. */
  sleep?: (ms: number) => Promise<void>;
  /** How the gate waits between polls of a job (1 to 3 s). Default: the same as `sleep`. */
  pollSleep?: (ms: number) => Promise<void>;
  /** How many refused calls to wait out in all. Default 6 (a fit is at most a handful of calls, 3 a minute). */
  maxWaits?: number;
  /** The longest to wait for one refused call, whatever the Worker says. Default 90 s. */
  maxWaitSeconds?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/**
 * How long to wait for a refused call when the refusal names no time. The Worker's own limiter (worker/forgeOptimizer.ts, a sliding 60 s
 * window) names it in `retry-after`, exactly, since 2026-11-03; before that it refused with a bare 429, and a refused call counts as a hit,
 * so asking again sooner only extended the lock-out (measured 2026-11-02). This is the fallback for a 429 with no time (an older Worker):
 * a full window and a second is the soonest a retry is sure to be let in.
 */
export const DEFAULT_WAIT_S = 61;

function gateErrorFailure(e: OutlineGateError): PrintResult {
  switch (e.kind) {
    case "gate_required":
      return { ok: false, reason: "gate_required", message: "The grown-up check ran out. Please ask a grown-up again.", detail: e.message };
    case "slow_down":
      return { ok: false, reason: "too_many_waits", message: "Too many tries. Please wait a minute and try again.", detail: e.message };
    case "disabled":
      return { ok: false, reason: "disabled", message: "The print check is not turned on here.", detail: e.message };
    case "rejected":
      return { ok: false, reason: "rejected", message: "That shape could not be checked. Try a different photo.", detail: e.message };
    default:
      return { ok: false, reason: "busy", message: "The print check is busy. Please try again in a minute.", detail: e.message };
  }
}

/**
 * Fit the outline to the gates through the Worker's forge routes and fetch the plate it left. A refused call is waited out and
 * asked again; an expired grown-up check is renewed through `renewGate`. Never throws: every end is a `PrintResult`.
 */
export async function printAccessory(args: PrintArgs): Promise<PrintResult> {
  const { scan, gate, onProgress } = args;
  const sleep = args.sleep ?? defaultSleep;
  const maxWaits = args.maxWaits ?? 6;
  const maxWaitSeconds = args.maxWaitSeconds ?? 90;
  const routes = { fetch: args.fetch, headers: () => gate.headers() };
  const inner = forgeRouteGate({ ...routes, sleep: args.pollSleep ?? sleep });

  let call = 0;
  let waits = 0;
  const patient: OutlineGate = async (shape) => {
    call++;
    const mine = call;
    let renewed = false;
    for (;;) {
      onProgress?.({ stage: "checking", call: mine });
      try {
        return await inner(shape);
      } catch (e) {
        if (!(e instanceof OutlineGateError)) throw e;
        if (e.kind === "slow_down" && waits < maxWaits) {
          waits++;
          const seconds = Math.min(maxWaitSeconds, Math.max(1, Math.ceil(e.retryAfterS ?? DEFAULT_WAIT_S)));
          onProgress?.({ stage: "waiting", call: mine, seconds });
          await sleep(seconds * 1000);
          continue;
        }
        if (e.kind === "gate_required" && args.renewGate && !renewed) {
          renewed = true;
          onProgress?.({ stage: "asking_again", call: mine });
          if (await args.renewGate()) continue;
        }
        throw e;
      }
    }
  };

  const result = await preparePhotoAccessory(scan, patient, args.options ?? {});
  if (!result.ok) {
    switch (result.reason) {
      case "gate_error":
        return result.error ? gateErrorFailure(result.error) : { ok: false, reason: "busy", message: "The print check is busy. Please try again in a minute.", detail: result.detail };
      case "no_outline":
        return { ok: false, reason: "no_outline", message: "There is no outline to print. Try another photo.", detail: result.detail };
      case "cannot_symmetrize":
        return { ok: false, reason: "cannot_symmetrize", message: "This one cannot be made the same on both sides without losing a piece.", detail: result.detail };
      case "invalid_options":
        return { ok: false, reason: "invalid_options", message: "That size or name cannot be used.", detail: result.detail };
      case "brand_rejected":
        return { ok: false, reason: "brand_rejected", message: "That name is not allowed. Pick another name.", detail: result.detail };
      case "out_of_budget":
      case "marginal_unresolved":
        return { ok: false, reason: "no_size_found", message: "I could not find a size that prints. Try a different size.", detail: result.detail };
      default:
        return { ok: false, reason: "does_not_print", message: "The printer check did not like this shape. Try a bigger size or another photo.", detail: result.detail };
    }
  }

  let plateStl: Uint8Array | null = null;
  let plateMessage: string | undefined;
  if (result.artifacts) {
    onProgress?.({ stage: "fetching_plate" });
    try {
      plateStl = await fetchPlateStl(result.artifacts.stl, routes);
    } catch (e) {
      plateMessage = e instanceof OutlineGateError && e.kind === "gate_required" ? "The grown-up check ran out before the plate could be saved. Please ask a grown-up again." : "The plate file could not be fetched. Try again in a minute.";
    }
  }
  return { ok: true, accessory: result, plateStl, ...(plateMessage ? { plateMessage } : {}), hints: hintsFor(result.outline.warnings) };
}
