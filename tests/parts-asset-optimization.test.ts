import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampAdvisorProposal, type OptimizationManifest } from "../scripts/llm-lod-advisor";
import type { ForgeFastPreviewResponse, ForgeOptimizationJob } from "../shared/forgeOptimizer";
import { allParts, glbFileFor, stlFileFor } from "../src/lib/catalog";
import {
  formatShortPrintTag,
  formatToyFinishRecipe,
  slicerRecipeForPart,
} from "../src/lib/printRecipe";
import {
  handleForgeArtifact,
  handleForgeJobStatus,
  handleForgePreview,
  resetForgeRateLimit,
  type ForgeOptimizerEnv,
} from "../worker/forgeOptimizer";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const ROOT = process.cwd();
const STL_DIR = join(ROOT, "public/parts-stl");
const GLB_DIR = join(ROOT, "public/parts-glb");
const MANIFEST_PATH = join(ROOT, "parts/partspec/asset_optimization_manifest.json");

const DEVICE_A = "12345678-1234-1234-1234-123456789abc";
const DEVICE_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function resolvePythonVenv(): string | null {
  const local = resolve(ROOT, "parts/partspec/.venv/bin/python3");
  if (existsSync(local)) return local;
  try {
    const commonGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const shared = resolve(ROOT, commonGit, "..", "parts/partspec/.venv/bin/python3");
    if (existsSync(shared)) return shared;
  } catch {
    // ignore
  }
  return null;
}

const PYTHON_VENV = resolvePythonVenv();

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (sql.includes("DO NOTHING")) {
              if (!settings.has(id)) settings.set(id, text);
            } else {
              settings.set(id, text);
            }
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const [id] = values as [string];
            const v = settings.get(id);
            return { results: v !== undefined ? [{ settings_json: v }] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

async function mintParentProof(env: ForgeOptimizerEnv, deviceId: string): Promise<string> {
  const callGate = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": deviceId },
        body: JSON.stringify(body),
      }),
      env as never,
    );
  const ch = (await (await callGate({ action: "challenge" })).json()) as {
    a: number;
    b: number;
    challengeToken: string;
  };
  const verified = await callGate({
    action: "verify",
    challengeToken: ch.challengeToken,
    answer: ch.a * ch.b,
  });
  return ((await verified.json()) as { proofToken: string }).proofToken;
}

describe("Parts asset optimization (Print STL + Web GLB + Toy-Finish Recipes)", () => {
  beforeEach(() => {
    resetForgeRateLimit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  it("keeps public/parts-glb under 5 MB total and 250 KB per file using KHR_mesh_quantization", () => {
    const glbFiles = readdirSync(GLB_DIR).filter((f) => f.endsWith(".glb"));
    expect(glbFiles.length).toBeGreaterThanOrEqual(45);

    let totalBytes = 0;
    for (const file of glbFiles) {
      const p = join(GLB_DIR, file);
      const buf = readFileSync(p);
      totalBytes += buf.length;
      expect(buf.length, `${file} exceeds 250 KB cap`).toBeLessThanOrEqual(250 * 1024);

      expect(buf.readUInt32LE(0), `${file} bad glTF magic`).toBe(0x46546c67);
      expect(buf.readUInt32LE(4), `${file} bad glTF version`).toBe(2);
      expect(buf.readUInt32LE(8), `${file} bad glTF length`).toBe(buf.length);
      const jsonLen = buf.readUInt32LE(12);
      expect(buf.readUInt32LE(16), `${file} bad JSON chunk`).toBe(0x4e4f534a);
      const header = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
        extensionsRequired?: string[];
      };
      expect(header.extensionsRequired, `${file} missing KHR_mesh_quantization`).toContain(
        "KHR_mesh_quantization",
      );
    }

    expect(totalBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("keeps public/parts-stl watertight binary STLs under 21 MB total and 1.6 MB per file with zero support bloat", () => {
    const stlFiles = readdirSync(STL_DIR).filter((f) => f.endsWith(".stl"));
    expect(stlFiles.length).toBeGreaterThanOrEqual(46);

    let totalBytes = 0;
    for (const file of stlFiles) {
      expect(file.toLowerCase()).not.toContain("support");
      const p = join(STL_DIR, file);
      const buf = readFileSync(p);
      totalBytes += buf.length;
      expect(buf.length, `${file} exceeds 1.6 MB cap`).toBeLessThanOrEqual(
        Math.round(1.6 * 1024 * 1024),
      );
      const tris = buf.readUInt32LE(80);
      expect(buf.length, `${file} binary STL length mismatch`).toBe(84 + tris * 50);
    }

    expect(totalBytes).toBeLessThanOrEqual(21 * 1024 * 1024);
    expect(existsSync(join(STL_DIR, "forge-mount-first-print.stl"))).toBe(true);
  });

  it("decodes real catalog GLBs natively in Three.js GLTFLoader with accurate physical dimensions", async () => {
    const loader = new GLTFLoader();
    const sampleIds = [
      "brick-s-2x2",
      "dome-s-2x2",
      "gear-spur-z20",
      "forge-mount-ring-s",
      "kit-keel-base",
    ];
    for (const id of sampleIds) {
      const part = allParts.find((p) => p.id === id);
      expect(part, `missing catalog part ${id}`).toBeDefined();
      const glbName = glbFileFor(part)!;
      const stlName = stlFileFor(part)!;
      expect(statSync(join(GLB_DIR, glbName)).size).toBeLessThan(
        statSync(join(STL_DIR, stlName)).size,
      );

      const buf = readFileSync(join(GLB_DIR, glbName));
      const ab = new Uint8Array(buf).buffer;
      const gltf = await loader.parseAsync(ab, "");
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);

      if (part?.bboxMm) {
        expect(Math.abs(size.x * 1000 - part.bboxMm[0])).toBeLessThan(0.35);
        expect(Math.abs(size.z * 1000 - part.bboxMm[1])).toBeLessThan(0.35);
        expect(Math.abs(size.y * 1000 - part.bboxMm[2])).toBeLessThan(0.35);
      }
    }
  });

  it("populates finish-class tolerances and toy-grade slicer recipes in asset_optimization_manifest.json", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as OptimizationManifest;
    expect(manifest.version).toBe(2);

    const dome = manifest.parts["dome-s-2x2"];
    expect(dome?.finish_class).toBe("show_curved");
    expect(dome?.print_simplify_mm).toBeLessThanOrEqual(0.008);
    expect(dome?.slicer_recipe.layer_height_mm).toBe(0.12);
    expect(dome?.slicer_recipe.wall_order).toBe("inner_first");
    expect(dome?.slicer_recipe.ironing).toBe("none");

    const gear = manifest.parts["gear-spur-z20"];
    expect(gear?.finish_class).toBe("precision_gear_pin");
    expect(gear?.print_simplify_mm).toBeLessThanOrEqual(0.012);
    expect(gear?.slicer_recipe.layer_height_mm).toBe(0.16);

    const brick = manifest.parts["brick-s-2x2"];
    expect(brick?.finish_class).toBe("prismatic_structural");
    expect(brick?.slicer_recipe.layer_height_mm).toBe(0.16);
    expect(brick?.slicer_recipe.wall_loops).toBe(3);
    expect(brick?.slicer_recipe.outer_wall_speed_mms).toBe(30);
    expect(brick?.slicer_recipe.wall_order).toBe("outer_first");
    expect(brick?.slicer_recipe.ironing).toBe("all_top");
    expect(brick?.slicer_recipe.ironing_inset_mm).toBeCloseTo(0.21, 2);

    const domePart = allParts.find((p) => p.id === "dome-s-2x2")!;
    const brickPart = allParts.find((p) => p.id === "brick-s-2x2")!;
    expect(formatShortPrintTag(domePart)).toContain("0.12 mm PLA");
    expect(formatToyFinishRecipe(domePart).headline).toContain("inner-first");
    expect(formatToyFinishRecipe(domePart).headline).toContain("rear seam");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("0.16 mm PLA");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("outer-first");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("iron flat tops");
    expect(slicerRecipeForPart(brickPart).support_mode).toBe("none");
  });

  it("clamps offline LLM advisor proposals within G2/G3 finish-safe bounds and scrubs brand names", () => {
    const baseEntry = {
      source_sha256: "abc12345",
      finish_class: "show_curved" as const,
      print_simplify_mm: 0.006,
      web_simplify_mm: 0.075,
      web_crease_deg: 36,
      slicer_recipe: {
        layer_height_mm: 0.12,
        wall_loops: 3,
        outer_wall_speed_mms: 30,
        wall_order: "inner_first" as const,
        seam_position: "back" as const,
        ironing: "none" as const,
        ironing_inset_mm: 0,
        brim_width_mm: 0,
        support_mode: "none" as const,
      },
    };
    const clamped = clampAdvisorProposal(baseEntry, {
      print_simplify_mm: 0.05,
      web_simplify_mm: 0.5,
      web_crease_deg: 95,
      parent_tip: "Print like Lego bricks on Bambu smooth PEI at 30 mm/s.",
      rationale: "Smooth Duplo dome.",
    });
    expect(clamped.print_simplify_mm).toBe(0.008);
    expect(clamped.web_simplify_mm).toBe(0.16);
    expect(clamped.web_crease_deg).toBe(48);
    expect(clamped.parent_tip?.toLowerCase()).not.toContain("lego");
    expect(clamped.parent_tip?.toLowerCase()).not.toContain("bambu");
    expect(clamped.rationale?.toLowerCase()).not.toContain("duplo");
  });

  it("exports optimized print STLs, quantized Web GLBs, and slicer recipes for custom SDK parts", () => {
    const customDir = join(ROOT, "public/kip/custom");
    const ids = ["custom_wizard_hat", "custom_star_wand", "custom_hood_crest"] as const;
    for (const id of ids) {
      const glbPath = join(customDir, `${id}.glb`);
      const metaPath = join(customDir, `${id}.partspec.json`);
      expect(existsSync(glbPath), `missing ${id}.glb`).toBe(true);
      expect(existsSync(metaPath), `missing ${id}.partspec.json`).toBe(true);

      const glbBuf = readFileSync(glbPath);
      expect(glbBuf.readUInt32LE(0)).toBe(0x46546c67);
      expect(glbBuf.length).toBeLessThanOrEqual(60 * 1024);

      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
        glb_file?: string;
        print?: { slicer_recipe?: { layer_height_mm?: number; wall_loops?: number } };
        asset_optimization?: { finish_class?: string; content_hash?: string };
      };
      expect(meta.glb_file).toBe(`${id}.glb`);
      expect(meta.print?.slicer_recipe?.wall_loops).toBe(3);
      expect(meta.asset_optimization?.content_hash).toBeTruthy();
    }
  });

  it("enforces parent gate, rate limits, non-loopback token requirement, payload allowlist, and upstream error mapping in Worker", async () => {
    const db = fakeDb();
    const baseEnv: ForgeOptimizerEnv = {
      DB: db,
      PARENT_GATE_SECRET: "gate-secret-for-tests",
      FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791",
    };
    const proofA = await mintParentProof(baseEnv, DEVICE_A);

    const validRecipeBody = {
      recipe: {
        name: "Comet Crown",
        slot: "crown",
        shape: {
          slices: [
            { z: 0, w: 23.4, d: 11.4, r: 4.5 },
            { z: 12, w: 14.0, d: 10.0, r: 3.5 },
          ],
        },
      },
    };

    // 1. Disabled when URL unset OR when non-loopback URL lacks FORGE_OPTIMIZER_TOKEN
    expect(
      (
        await handleForgePreview(
          new Request("http://local/api/forge/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validRecipeBody),
          }),
          { DB: db, PARENT_GATE_SECRET: "gate-secret-for-tests" },
        )
      ).status,
    ).toBe(503);

    expect(
      (
        await handleForgePreview(
          new Request("http://local/api/forge/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validRecipeBody),
          }),
          {
            DB: db,
            PARENT_GATE_SECRET: "gate-secret-for-tests",
            FORGE_OPTIMIZER_URL: "https://optimizer.toyventor.internal",
          },
        )
      ).status,
    ).toBe(503);

    // 2. Parent gate enforced: missing device/proof or wrong device's proof -> 401
    const unauthedCases: Record<string, string>[] = [
      { "content-type": "application/json" },
      { "content-type": "application/json", "x-device-id": DEVICE_A },
      { "content-type": "application/json", "x-device-id": DEVICE_B, "x-parent-proof": proofA },
    ];
    for (const headers of unauthedCases) {
      const res = await handleForgePreview(
        new Request("http://local/api/forge/preview", {
          method: "POST",
          headers,
          body: JSON.stringify(validRecipeBody),
        }),
        baseEnv,
      );
      expect(res.status).toBe(401);
      expect(((await res.json()) as { status: string }).status).toBe("gate-required");
    }

    // 3. Rejects stl_path, verify_preprint, legalize:false, >16 slices, and brand names BEFORE calling fetch
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const authedHeaders = {
        "content-type": "application/json",
        "x-device-id": DEVICE_A,
        "x-parent-proof": proofA,
      };
      const domeB64 = readFileSync(join(STL_DIR, "dome-s-2x2.stl")).toString("base64");

      for (const badBody of [
        { stl_path: "/etc/passwd", part_id: "leak" },
        { stl_base64: domeB64, verify_preprint: false },
        { recipe: { ...validRecipeBody.recipe, legalize: false } },
        {
          recipe: {
            name: "Too Many Slices",
            slot: "crown",
            shape: {
              slices: Array.from({ length: 18 }, (_, i) => ({ z: i * 2, w: 18, d: 12, r: 3 })),
            },
          },
        },
        { recipe: { ...validRecipeBody.recipe, name: "Lego Star Hat" } },
      ]) {
        resetForgeRateLimit();
        const res = await handleForgePreview(
          new Request("http://local/api/forge/preview", {
            method: "POST",
            headers: authedHeaders,
            body: JSON.stringify(badBody),
          }),
          baseEnv,
        );
        expect(res.status).toBe(422);
      }
      expect(fetchSpy).not.toHaveBeenCalled();

      // 4. Upstream error mapping: non-JSON 502 -> "unavailable" (NOT "unreachable"), TimeoutError -> 504 "timeout", scrub extra path fields
      resetForgeRateLimit();
      fetchSpy.mockResolvedValueOnce(
        new Response("<html>502 Bad Gateway SECRET_PATH=/var/app</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      );
      const nonJsonRes = await handleForgePreview(
        new Request("http://local/api/forge/preview", {
          method: "POST",
          headers: authedHeaders,
          body: JSON.stringify(validRecipeBody),
        }),
        baseEnv,
      );
      expect(nonJsonRes.status).toBe(502);
      const nonJsonPayload = await nonJsonRes.text();
      expect(nonJsonPayload).toContain('"unavailable"');
      expect(nonJsonPayload).not.toContain("SECRET_PATH");

      const timeoutErr = new Error("timed out");
      timeoutErr.name = "TimeoutError";
      fetchSpy.mockRejectedValueOnce(timeoutErr);
      const timeoutRes = await handleForgePreview(
        new Request("http://local/api/forge/preview", {
          method: "POST",
          headers: authedHeaders,
          body: JSON.stringify(validRecipeBody),
        }),
        baseEnv,
      );
      expect(timeoutRes.status).toBe(504);
      expect(((await timeoutRes.json()) as { status: string }).status).toBe("timeout");

      // 5. Rate limit: 3 previews/min/device -> 4th returns 429 slow-down
      resetForgeRateLimit();
      fetchSpy.mockImplementation(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "preview_ready",
            part_id: "custom_comet_crown",
            job_id: null,
            draft_artifact: "custom_comet_crown.12345678.draft.glb",
            draft_glb_file: "/should/be/scrubbed/out.glb",
            glb_size: 1024,
            orig_tris: 400,
            web_verts: 120,
            web_tris: 200,
            finish_class: "show_curved",
            elapsed_ms: 25,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      for (let i = 0; i < 3; i++) {
        const okRes = await handleForgePreview(
          new Request("http://local/api/forge/preview", {
            method: "POST",
            headers: authedHeaders,
            body: JSON.stringify(validRecipeBody),
          }),
          baseEnv,
        );
        expect(okRes.status).toBe(200);
        const bodyText = await okRes.text();
        expect(bodyText).not.toContain("/should/be/scrubbed");
      }
      const fourthRes = await handleForgePreview(
        new Request("http://local/api/forge/preview", {
          method: "POST",
          headers: authedHeaders,
          body: JSON.stringify(validRecipeBody),
        }),
        baseEnv,
      );
      expect(fourthRes.status).toBe(429);
      expect(((await fourthRes.json()) as { status: string }).status).toBe("slow-down");
    } finally {
      fetchSpy.mockRestore();
      resetForgeRateLimit();
    }
  });

  it.skipIf(!PYTHON_VENV)(
    "enforces daemon token auth, queue backpressure, stl_path rejection, torso.stl fail-closed gate, and happy-path optimization",
    async () => {
      const py = PYTHON_VENV!;
      const daemonPath = join(ROOT, "scripts/forge_optimizer_daemon.py");

      // 1. Daemon refuses non-loopback bind without token AND refuses tracked public/kip/custom --out-dir
      const noTokenBind = spawnSync(py, [daemonPath, "--host", "0.0.0.0", "--port", "0"], {
        encoding: "utf8",
      });
      expect(noTokenBind.status).toBe(2);

      const trackedDirRun = spawnSync(
        py,
        [daemonPath, "--port", "0", "--out-dir", join(ROOT, "public/kip/custom")],
        { encoding: "utf8" },
      );
      expect(trackedDirRun.status).toBe(2);

      // 2. Start live daemon with Bearer token + tight max-queue=2 in an isolated temp dir
      const tmpOut = mkdtempSync(join(tmpdir(), "tv-forge-daemon-"));
      const secretToken = "forge-secret-token-987654";
      const proc = spawn(
        py,
        [
          daemonPath,
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--out-dir",
          tmpOut,
          "--token",
          secretToken,
          "--workers",
          "1",
          "--max-queue",
          "2",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      try {
        const baseUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
          let buf = "";
          const timer = setTimeout(() => rejectUrl(new Error("daemon startup timeout")), 8000);
          proc.stdout.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");
            const nl = buf.indexOf("\n");
            if (nl !== -1) {
              clearTimeout(timer);
              const info = JSON.parse(buf.slice(0, nl)) as { url: string };
              resolveUrl(info.url);
            }
          });
          proc.on("exit", (code) => {
            clearTimeout(timer);
            rejectUrl(new Error(`daemon exited early with code ${code}`));
          });
        });

        // 2a. Missing or wrong Bearer token -> 401 directly from daemon
        const unauthRes = await fetch(`${baseUrl}/v1/fast-preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipe: {} }),
        });
        expect(unauthRes.status).toBe(401);

        const wrongTokRes = await fetch(`${baseUrl}/v1/fast-preview`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer wrong-token",
          },
          body: JSON.stringify({ recipe: {} }),
        });
        expect(wrongTokRes.status).toBe(401);

        // 2b. Direct stl_path attempt against daemon (even with valid token) -> 422, no file read or oracle
        const stlPathAttempt = await fetch(`${baseUrl}/v1/fast-preview`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secretToken}`,
          },
          body: JSON.stringify({
            part_id: "probe",
            stl_path: join(ROOT, "public/kip/stls/torso.stl"),
          }),
        });
        expect(stlPathAttempt.status).toBe(422);

        // 2b-ii. Direct recipe with legalize:false + 18 slices -> 422 (cannot skip clamps),
        // and id:"wizard_hat" never overwrites tracked public/kip/custom/custom_wizard_hat.*
        const wizardBefore = readFileSync(join(ROOT, "public/kip/custom/custom_wizard_hat.glb"));
        const unlegalizedAttempt = await fetch(`${baseUrl}/v1/fast-preview`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secretToken}`,
          },
          body: JSON.stringify({
            recipe: {
              id: "wizard_hat",
              name: "Too Many",
              slot: "crown",
              legalize: false,
              shape: {
                slices: Array.from({ length: 18 }, (_, i) => ({
                  z: i * 2,
                  w: 20,
                  d: 12,
                  r: 3,
                })),
              },
            },
          }),
        });
        expect(unlegalizedAttempt.status).toBe(422);

        const wizardValidPreview = await fetch(`${baseUrl}/v1/fast-preview`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secretToken}`,
          },
          body: JSON.stringify({
            enqueue_background: false,
            recipe: {
              id: "wizard_hat",
              name: "Safe Hat",
              slot: "crown",
              shape: {
                slices: [
                  { z: 0, w: 23.4, d: 11.4, r: 4.5 },
                  { z: 12, w: 14, d: 10, r: 3.5 },
                ],
              },
            },
          }),
        });
        expect(wizardValidPreview.status).toBe(200);
        expect(
          readFileSync(join(ROOT, "public/kip/custom/custom_wizard_hat.glb")).equals(wizardBefore),
        ).toBe(true);

        // 2c. Finding 1 reproduction: torso.stl with verify_preprint: false sent directly to daemon
        // MUST ignore verify_preprint: false and degrade to `digital_only` with stl_artifact = null!
        const torsoB64 = readFileSync(join(ROOT, "public/kip/stls/torso.stl")).toString("base64");
        const torsoSubmit = await fetch(`${baseUrl}/v1/jobs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secretToken}`,
          },
          body: JSON.stringify({
            part_id: "torso_bypass_test",
            stl_base64: torsoB64,
            verify_preprint: false,
          }),
        });
        expect(torsoSubmit.status).toBe(202);
        const { job_id: torsoJobId } = (await torsoSubmit.json()) as { job_id: string };

        let torsoFinal: ForgeOptimizationJob | null = null;
        for (let i = 0; i < 60; i++) {
          const r = await fetch(`${baseUrl}/v1/jobs/${torsoJobId}`, {
            headers: { authorization: `Bearer ${secretToken}` },
          });
          const j = (await r.json()) as ForgeOptimizationJob;
          if (j.status === "print_ready" || j.status === "digital_only" || j.status === "failed") {
            torsoFinal = j;
            break;
          }
          await new Promise((res) => setTimeout(res, 150));
        }
        expect(torsoFinal?.status).toBe("digital_only");
        expect(torsoFinal?.stl_artifact).toBeNull();
        expect(torsoFinal?.slicer_recipe).toBeNull();
        expect(torsoFinal?.glb_artifact).toMatch(/\.draft\.glb$/);
        expect(torsoFinal?.gate_report?.ok).toBe(false);

        // 2d. Queue backpressure (`--max-queue 2`): submitting 4 concurrent jobs yields 429 queue_full
        const domeB64 = readFileSync(join(STL_DIR, "dome-s-2x2.stl")).toString("base64");
        const burst = await Promise.all(
          Array.from({ length: 4 }, (_, idx) =>
            fetch(`${baseUrl}/v1/jobs`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${secretToken}`,
              },
              body: JSON.stringify({ part_id: `burst_${idx}`, stl_base64: domeB64 }),
            }),
          ),
        );
        const statuses = burst.map((r) => r.status);
        expect(statuses).toContain(429);

        // Drain the 2 accepted burst jobs before running the Worker end-to-end check
        for (const r of burst) {
          if (r.status === 202) {
            const { job_id } = (await r.json()) as { job_id: string };
            for (let i = 0; i < 40; i++) {
              const jr = await fetch(`${baseUrl}/v1/jobs/${job_id}`, {
                headers: { authorization: `Bearer ${secretToken}` },
              });
              const j = (await jr.json()) as ForgeOptimizationJob;
              if (j.status === "print_ready" || j.status === "digital_only" || j.status === "failed") {
                break;
              }
              await new Promise((res) => setTimeout(res, 100));
            }
          }
        }

        // 2e. Full end-to-end Worker -> authenticated daemon flow (zero filesystem paths in responses)
        resetForgeRateLimit();
        const db = fakeDb();
        const env: ForgeOptimizerEnv = {
          DB: db,
          PARENT_GATE_SECRET: "gate-secret-for-tests",
          FORGE_OPTIMIZER_URL: baseUrl,
          FORGE_OPTIMIZER_TOKEN: secretToken,
        };
        const proof = await mintParentProof(env, DEVICE_A);
        const authed = {
          "content-type": "application/json",
          "x-device-id": DEVICE_A,
          "x-parent-proof": proof,
        };

        const previewRes = await handleForgePreview(
          new Request("http://local/api/forge/preview", {
            method: "POST",
            headers: authed,
            body: JSON.stringify({
              part_id: "dome_e2e",
              slot: "crown",
              stl_base64: domeB64,
              enqueue_background: true,
              include_glb_base64: true,
            }),
          }),
          env,
        );
        expect(previewRes.status).toBe(200);
        const preview = (await previewRes.json()) as ForgeFastPreviewResponse;
        expect(preview.status).toBe("preview_ready");
        expect(preview.draft_artifact).not.toContain("/");
        expect(JSON.stringify(preview)).not.toContain(tmpOut);
        expect(preview.glb_base64).toBeTruthy();

        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(
          new Uint8Array(Buffer.from(preview.glb_base64!, "base64")).buffer,
          "",
        );
        expect(gltf.scene.children.length).toBeGreaterThan(0);

        let completed: ForgeOptimizationJob | null = null;
        for (let i = 0; i < 40; i++) {
          const jr = await handleForgeJobStatus(
            new Request(`http://local/api/forge/jobs/${preview.job_id}`, {
              headers: { "x-device-id": DEVICE_A, "x-parent-proof": proof },
            }),
            env,
            preview.job_id!,
          );
          expect(jr.status).toBe(200);
          const j = (await jr.json()) as ForgeOptimizationJob;
          if (j.status === "print_ready" || j.status === "digital_only" || j.status === "failed") {
            completed = j;
            break;
          }
          await new Promise((res) => setTimeout(res, 120));
        }

        expect(completed?.status).toBe("print_ready");
        expect(completed?.stl_artifact).toMatch(/^custom_dome_e2e\.[a-f0-9]{12}\.stl$/);
        expect(completed?.glb_artifact).toMatch(/^custom_dome_e2e\.[a-f0-9]{12}\.glb$/);
        expect(JSON.stringify(completed)).not.toContain(tmpOut);
        expect(completed?.slicer_recipe?.layer_height_mm).toBe(0.12);

        // Stream the finalized STL artifact through the gated Worker route
        const artRes = await handleForgeArtifact(
          new Request(`http://local/api/forge/artifacts/${completed!.stl_artifact}`, {
            headers: { "x-device-id": DEVICE_A, "x-parent-proof": proof },
          }),
          env,
          completed!.stl_artifact!,
        );
        expect(artRes.status).toBe(200);
        const stlBytes = new Uint8Array(await artRes.arrayBuffer());
        expect(stlBytes.byteLength).toBeGreaterThan(84);
      } finally {
        proc.kill("SIGTERM");
        rmSync(tmpOut, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
