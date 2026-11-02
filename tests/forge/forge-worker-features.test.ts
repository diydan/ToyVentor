// The Worker's recipe validator (worker/forgeOptimizer.ts) must let the feature ops the daemon builds
// (ears, horns, spikes, snout, plus knob and brim) through to the optimizer, keep only what it can check
// (finite numbers, known style names), and still refuse an op it does not know.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleForgePreview, resetForgeRateLimit, type ForgeOptimizerEnv } from "../../worker/forgeOptimizer";
import worker from "../../worker/index";
import type { D1Like } from "../../worker/ownership";

const DEVICE = "12345678-1234-1234-1234-123456789abc";

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (!(sql.includes("DO NOTHING") && settings.has(id))) settings.set(id, text);
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const v = settings.get(values[0] as string);
            return { results: v !== undefined ? [{ settings_json: v }] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

async function mintParentProof(env: ForgeOptimizerEnv): Promise<string> {
  const callGate = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": DEVICE },
        body: JSON.stringify(body),
      }),
      env as never,
    );
  const ch = (await (await callGate({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const verified = await callGate({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await verified.json()) as { proofToken: string }).proofToken;
}

const HEAD_SLICES = [
  { z: 0, w: 24.6, d: 12.1, r: 4 },
  { z: 15, w: 26, d: 13, r: 5 },
  { z: 30.5, w: 24, d: 12, r: 4.5 },
];

describe("Worker recipe validator: feature ops", () => {
  let env: ForgeOptimizerEnv;
  let headers: Record<string, string>;

  beforeEach(async () => {
    resetForgeRateLimit();
    env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791" };
    headers = {
      "content-type": "application/json",
      "x-device-id": DEVICE,
      "x-parent-proof": await mintParentProof(env),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  function preview(features: unknown) {
    return handleForgePreview(
      new Request("http://local/api/forge/preview", {
        method: "POST",
        headers,
        body: JSON.stringify({ recipe: { name: "Feature Probe", slot: "head", shape: { slices: HEAD_SLICES }, features } }),
      }),
      env,
    );
  }

  it("forwards ears, horns, spikes and snout with only finite numbers and known styles", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, status: "preview_ready", part_id: "custom_feature_probe", job_id: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await preview([
      { op: "ears", style: "tall", width_mm: 6, height_mm: 20, tilt_deg: "steep", evil: 1 },
      { op: "ears", style: "floppy", width_mm: 9 },
      { op: "horns", length_mm: 18, base_mm: 6, curl: 0.6 },
      { op: "spikes", count: 5, height_mm: Number.NaN },
      { op: "snout", style: "beak", length_mm: 10, z_frac: 0.4, extra: "x" },
      { op: "snout", style: "trunk" },
    ]);
    expect(res.status).toBe(200);
    const forwarded = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)) as { recipe: { features: unknown[] } };
    expect(forwarded.recipe.features).toEqual([
      { op: "ears", style: "tall", width_mm: 6, height_mm: 20 },
      { op: "ears", width_mm: 9 },
      { op: "horns", length_mm: 18, base_mm: 6, curl: 0.6 },
      { op: "spikes", count: 5 },
      { op: "snout", style: "beak", length_mm: 10, z_frac: 0.4 },
      { op: "snout" },
    ]);
  });

  it("still refuses an op it does not know, before calling the optimizer", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await preview([{ op: "laser_beam", power: 9000 }]);
    expect(res.status).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
});
