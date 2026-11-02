// The real Worker (worker/index.ts) with a fake optimizer daemon behind it, for tests that run the gate over the production routes:
// the parent gate, the allowlist, the rate limits and the scrub are the Worker's own; only the daemon is faked. The fake records what
// it is sent and answers from a script. Shared by tests/outline-gate.test.ts and tests/photo-accessory.test.ts.
import { vi } from "vitest";
import type { ForgeOptimizerEnv } from "../../worker/forgeOptimizer";
import worker from "../../worker/index";
import type { D1Like } from "../../worker/ownership";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEVICE = "12345678-1234-1234-1234-123456789abc";

export function fakeDb(): D1Like {
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

export function forgeEnv(): ForgeOptimizerEnv {
  return { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791" };
}

export async function mintParentProof(env: ForgeOptimizerEnv): Promise<string> {
  const callGate = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(body) }),
      env as never,
    );
  const ch = (await (await callGate({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const verified = await callGate({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await verified.json()) as { proofToken: string }).proofToken;
}

/** A `fetch` that goes to the Worker, as the browser's does. */
export const viaWorker = (env: ForgeOptimizerEnv) => async (url: string, init?: RequestInit) => worker.fetch(new Request(`http://local${url}`, init), env as never);

export interface DaemonOverrides {
  previewStatus?: number;
  previewHeaders?: Record<string, string>;
  jobStatus?: string;
  /** A plate the passing jobs report and the artifact route serves. */
  plate?: { name: string; bytes: Uint8Array };
  artifactStatus?: number;
  /** The artifact route's content-type; the daemon sends `model/stl` for a plate. */
  artifactType?: string;
}

/** The optimizer daemon, as the Worker sees it: records what it is sent, answers from a script (one report per preview, the last repeats). */
export function fakeDaemon(reports: unknown[], overrides: DaemonOverrides = {}) {
  const recipes: any[] = [];
  const artifactRequests: string[] = [];
  const jobs = new Map<string, unknown>();
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/fast-preview") {
      if (overrides.previewStatus) return json({ ok: false, status: "x" }, overrides.previewStatus, overrides.previewHeaders ?? {});
      const body = JSON.parse(String(init?.body));
      recipes.push(body);
      const id = `fjob_${String(recipes.length).padStart(12, "0")}`;
      jobs.set(id, reports[recipes.length - 1] ?? reports.at(-1));
      return json({ ok: true, status: "preview_ready", part_id: "custom_photo_outline", job_id: id, draft_artifact: "", glb_size: 1, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 1 });
    }
    const m = /^\/v1\/jobs\/(fjob_[a-f0-9]{12})$/.exec(path);
    if (m) {
      const report: any = jobs.get(m[1]!);
      if (report === undefined) return json({ ok: false, status: "not-found" }, 404);
      const status = overrides.jobStatus ?? (report.ok ? "print_ready" : "digital_only");
      const plate = status === "print_ready" ? overrides.plate : undefined;
      return json({
        ok: true,
        job_id: m[1],
        part_id: "custom_photo_outline",
        status,
        gate_report: report,
        ...(plate ? { stl_artifact: plate.name, glb_artifact: plate.name.replace(/\.stl$/, ".glb"), content_hash: plate.name.split(".")[1] } : {}),
      });
    }
    const a = /^\/v1\/artifacts\/(.+)$/.exec(path);
    if (a) {
      artifactRequests.push(a[1]!);
      if (overrides.artifactStatus) return new Response("", { status: overrides.artifactStatus });
      if (overrides.plate && a[1] === overrides.plate.name) {
        return new Response(overrides.plate.bytes as BodyInit, { status: 200, headers: { "content-type": overrides.artifactType ?? "model/stl" } });
      }
      return new Response("", { status: 404 });
    }
    return json({ ok: false }, 404);
  });
  return { recipes, artifactRequests, spy };
}
