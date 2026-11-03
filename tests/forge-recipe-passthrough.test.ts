/**
 * The Worker rebuilds every recipe from allowlisted fields before it reaches the optimizer daemon. These tests pin the head and crown
 * fields added in 2026-11 (dome top, ear height up the head, ring crowns, star, hollow, ribs): before the allowlist knew them an op like
 * `ribs` made the whole request a 422 and a field like `shape.top` was dropped without a word.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORGE_EAR_STYLES, FORGE_HEAD_TOPS, FORGE_SNOUT_STYLES, FORGE_SPIKE_LAYOUTS } from "../shared/forgeOptimizer";
import { handleForgePreview, resetForgeRateLimit, type ForgeOptimizerEnv } from "../worker/forgeOptimizer";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const DEVICE = "12345678-1234-1234-1234-123456789abc";

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
            } else settings.set(id, text);
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

async function parentProof(env: ForgeOptimizerEnv): Promise<string> {
  const call = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": DEVICE },
        body: JSON.stringify(body),
      }),
      env as never,
    );
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

const SLICES = [
  { z: 0, w: 24.6, d: 12.1, r: 4.5 },
  { z: 30, w: 34, d: 28, r: 6 },
];

describe("Worker recipe allowlist keeps the head and crown fields the daemon reads", () => {
  let env: ForgeOptimizerEnv;
  let headers: Record<string, string>;

  beforeEach(async () => {
    resetForgeRateLimit();
    env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791" };
    headers = { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": await parentProof(env) };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  /** Sends `recipe` through the Worker with the daemon stubbed out; returns the status and the recipe that would have been forwarded. */
  async function forwarded(recipe: object): Promise<{ status: number; recipe: any }> {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, status: "preview_ready", part_id: "custom_x", job_id: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await handleForgePreview(
      new Request("http://local/api/forge/preview", { method: "POST", headers, body: JSON.stringify({ recipe }) }),
      env,
    );
    if (spy.mock.calls.length === 0) return { status: res.status, recipe: null };
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    const sent = JSON.parse(String(init?.body)) as { recipe: unknown };
    return { status: res.status, recipe: sent.recipe };
  }

  it("forwards shape.top and ear z_frac on a head", async () => {
    const r = await forwarded({
      name: "Monkey Head",
      slot: "head",
      shape: { slices: SLICES, height_mm: 30.5, top: "dome" },
      features: [{ op: "ears", style: "round", width_mm: 14, z_frac: 0.5 }],
    });
    expect(r.status).toBe(200);
    expect(r.recipe.shape.top).toBe("dome");
    expect(r.recipe.features[0]).toMatchObject({ op: "ears", style: "round", width_mm: 14, z_frac: 0.5 });
  });

  it("forwards ribs on a head", async () => {
    const r = await forwarded({
      name: "Pumpkin Head",
      slot: "head",
      shape: { slices: SLICES },
      features: [{ op: "ribs", count: 8, depth_mm: 3, width_mm: 5, secret: "dropped" }],
    });
    expect(r.status).toBe(200);
    expect(r.recipe.features).toEqual([{ op: "ribs", count: 8, depth_mm: 3, width_mm: 5 }]);
  });

  it("forwards a brow on a head", async () => {
    const r = await forwarded({
      name: "Gorilla Head",
      slot: "head",
      shape: { slices: SLICES },
      features: [{ op: "brow", width_mm: 20, thickness_mm: 3.5, height_mm: 6, z_frac: 0.75, extra: 1 }],
    });
    expect(r.status).toBe(200);
    expect(r.recipe.features).toEqual([{ op: "brow", width_mm: 20, thickness_mm: 3.5, height_mm: 6, z_frac: 0.75 }]);
  });

  it("forwards a ring crown, a star and a hollow on a crown", async () => {
    const r = await forwarded({
      name: "Ring Crown",
      slot: "crown",
      shape: { slices: SLICES },
      features: [
        { op: "spikes", layout: "ring", count: 7, height_mm: 9, base_mm: 6, wall_mm: 2.4 },
        { op: "star", size_mm: 10, thickness_mm: 2.4 },
        { op: "hollow", wall_mm: 2.4, depth_mm: 8 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.recipe.features).toEqual([
      { op: "spikes", layout: "ring", count: 7, height_mm: 9, base_mm: 6, wall_mm: 2.4 },
      { op: "star", size_mm: 10, thickness_mm: 2.4 },
      { op: "hollow", wall_mm: 2.4, depth_mm: 8 },
    ]);
  });

  it("drops an unknown enum value and keeps the rest (the daemon then uses its default)", async () => {
    const r = await forwarded({
      name: "Odd Head",
      slot: "head",
      shape: { slices: SLICES, top: "pointed" },
      features: [{ op: "spikes", layout: "spiral", count: 3 }],
    });
    expect(r.status).toBe(200);
    expect(r.recipe.shape.top).toBeUndefined();
    expect(r.recipe.features[0]).toEqual({ op: "spikes", count: 3 });
  });

  it("still rejects an op the daemon does not know", async () => {
    const r = await forwarded({ name: "Bad Op", slot: "head", shape: { slices: SLICES }, features: [{ op: "trunk", length_mm: 10 }] });
    expect(r.status).toBe(422);
    expect(r.recipe).toBeNull();
  });

  it("uses the same enum values as the daemon (a change there must change here)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const daemon = readFileSync(join(__dirname, "..", "scripts", "forge_optimizer_daemon.py"), "utf8");
    for (const v of FORGE_EAR_STYLES) expect(daemon).toMatch(new RegExp(`"${v}": \\(`)); // _EAR_STYLES keys
    for (const v of FORGE_SNOUT_STYLES) expect(daemon).toMatch(new RegExp(`"${v}": \\(`)); // _SNOUT_STYLES keys
    expect(daemon).toContain(`HEAD_TOPS = (${FORGE_HEAD_TOPS.map((v) => `"${v}"`).join(", ")})`);
    expect(daemon).toContain('"ring" if ring else "row"');
    expect([...FORGE_SPIKE_LAYOUTS]).toEqual(["row", "ring"]);
  });
});
