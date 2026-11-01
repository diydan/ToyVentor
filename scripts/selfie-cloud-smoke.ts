#!/usr/bin/env tsx
// Real-API smoke for the opt-in selfie cloud routes (worker/selfie.ts), on ONE cartoon sample face only.
//
//   npx tsx scripts/selfie-cloud-smoke.ts [--no-cartoon]
//
// It drives the real Worker entry (worker/index.ts) in Node: a fake in-memory D1, a real proof token from the real parent gate, then
// POST /api/selfie/face-parts and /api/selfie/cartoon, whose upstream calls go to the real Meta API with the key from .dev.vars.
// The key is read in this process, never printed or written. Only parts/kip/viewer/selfie-faces/face-knight.jpg (a cartoon, no
// person) is ever sent. Upstream calls are counted and capped at 6.
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const root = process.cwd();
const NO_CARTOON = process.argv.includes("--no-cartoon");
const MAX_UPSTREAM = 6;

function loadKey(): string {
  const text = readFileSync(path.join(root, ".dev.vars"), "utf8");
  for (const name of ["MODEL_API_KEY", "META_MODEL_API_KEY"]) {
    const m = new RegExp(`^${name}=(.+)$`, "m").exec(text);
    if (m && m[1]!.trim()) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("no MODEL_API_KEY in .dev.vars");
}

// count and cap every upstream call; log the path only
const realFetch = globalThis.fetch.bind(globalThis);
let upstream = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  if (upstream >= MAX_UPSTREAM) throw new Error(`upstream call budget (${MAX_UPSTREAM}) reached`);
  const n = ++upstream;
  const t0 = Date.now();
  const res = await realFetch(input, init);
  console.log(`  upstream #${n} ${new URL(String(input)).pathname} -> HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return res;
}) as typeof fetch;

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (!sql.includes("DO NOTHING") || !settings.has(id)) settings.set(id, text);
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

const DEVICE = "smoke000-0000-0000-0000-000000000001";
const env = { DB: fakeDb(), PARENT_GATE_SECRET: "smoke-gate-secret-not-a-real-secret", MODEL_API_KEY: loadKey(), SELFIE_CLOUD: "on" };

async function proof(): Promise<string> {
  const call = (body: object) =>
    worker.fetch(new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(body) }), env as never);
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

async function main() {
  const jpeg = await sharp(path.join(root, "parts/kip/viewer/selfie-faces/face-knight.jpg"))
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const image = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  console.log(`sample: face-knight.jpg (cartoon) as ${(jpeg.length / 1024).toFixed(0)} KB JPEG`);
  const token = await proof();
  const post = (route: string) =>
    worker.fetch(
      new Request(`http://local/api/selfie/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": token, "x-selfie-consent": "v1" },
        body: JSON.stringify({ image }),
      }),
      env as never,
    );

  let t0 = Date.now();
  console.log("POST /api/selfie/face-parts");
  const fp = await post("face-parts");
  console.log(`  -> HTTP ${fp.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(await fp.json()));

  if (!NO_CARTOON) {
    t0 = Date.now();
    console.log("POST /api/selfie/cartoon");
    const ct = await post("cartoon");
    const body = (await ct.json()) as { status: string; image?: string };
    const m = /^data:image\/(\w+);base64,/.exec(body.image ?? "");
    console.log(`  -> HTTP ${ct.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s: status=${body.status}` +
      (body.image ? `, ${m?.[1]} data URL of ${(body.image.length * 0.75 / 1024).toFixed(0)} KB` : ""));
    if (body.image) {
      const out = Buffer.from(body.image.replace(/^data:[^,]+,/, ""), "base64");
      const meta = await sharp(out).metadata();
      console.log(`  decoded: ${meta.format} ${meta.width}x${meta.height}`);
    }
  }
  console.log(`upstream calls used: ${upstream}/${MAX_UPSTREAM}`);
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  console.log(`upstream calls used: ${upstream}/${MAX_UPSTREAM}`);
  process.exitCode = 1;
});
