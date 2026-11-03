#!/usr/bin/env node
// Probe the Muse generation endpoints the way the generated-worlds spec (docs/specs/generated-worlds-spec.md) measured them on 2026-11-03. Re-run it
// when the service changes. The key and base URL come from .dev.vars (MODEL_API_KEY or META_MODEL_API_KEY, META_MODEL_API_URL) and are never printed.
//
//   node scripts/probe-muse-image.mjs models                         the models the key can use (free)
//   node scripts/probe-muse-image.mjs params                         which request parameters /images/generations knows (free: every call is rejected)
//   node scripts/probe-muse-image.mjs gen <WxH> <name> <prompt...>   ONE image generation (costs a call, 8 to 15 s); saved to docs/mockups/generated-backdrops/probe/
//   node scripts/probe-muse-image.mjs brief "<child's wish>"         ONE text call: Muse Spark writes the world brief (closed lists, safety rules)
//
// What it showed (details in the spec): `size` only sets the ASPECT RATIO (at most 16:1); the output is a fixed budget of about 2.5 megapixels
// (1024x1024 -> 1600x1600, any 8:1 -> 4480x560); no transparency, seed, quality, style or negative_prompt parameters; `n` up to 10; webp out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vars = Object.fromEntries(readFileSync(path.join(ROOT, ".dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const key = vars.MODEL_API_KEY || vars.META_MODEL_API_KEY;
const base = (vars.META_MODEL_API_URL || "").replace(/\/+$/, "");
if (!key || !base) { console.error("no key or META_MODEL_API_URL in .dev.vars"); process.exit(2); }

async function call(route, body, { method = "POST", timeoutMs = 150_000 } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${base}${route}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms: Date.now() - t0, text, json };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "models") {
  const r = await call("/models", null, { method: "GET" });
  console.log(r.status, `${r.ms} ms`, (r.json?.data ?? []).map((m) => m.id).join(", "));
} else if (mode === "params") {
  // An always-invalid size means nothing is ever generated; the error names what it does not recognise.
  for (const extra of [{ background: "transparent" }, { quality: "high" }, { seed: 1 }, { style: "x" }, { negative_prompt: "x" }, { response_format: "bogus" }, { n: 99 }]) {
    const r = await call("/images/generations", { model: "muse-image-1.0", prompt: "x", size: "9999x1", ...extra });
    console.log(JSON.stringify(extra).padEnd(30), r.status, r.json?.error?.message ?? r.text.slice(0, 120));
  }
} else if (mode === "gen") {
  const [size, name, ...words] = args;
  if (!/^\d+x\d+$/.test(size ?? "") || !name || !words.length) { console.error("usage: gen <WxH> <name> <prompt...>"); process.exit(2); }
  const r = await call("/images/generations", { model: "muse-image-1.0", prompt: words.join(" "), n: 1, size, response_format: "b64_json" });
  if (r.status !== 200) { console.log(r.status, r.text.slice(0, 300)); process.exit(1); }
  const bytes = Buffer.from(r.json.data[0].b64_json, "base64");
  const dir = path.join(ROOT, "docs", "mockups", "generated-backdrops", "probe");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.${r.json.output_format === "png" ? "png" : "webp"}`);
  writeFileSync(file, bytes);
  console.log(`requested ${size}: ${r.ms} ms, ${bytes.length} bytes, usage ${JSON.stringify(r.json.usage)}\nsaved ${file}`);
} else if (mode === "brief") {
  const wish = args.join(" ");
  const input = [
    "You help a young child (ages 4 to 10) build a pretend play world. Keep it kind and safe: nothing scary, violent, adult, or personal. Never include real names, addresses, phone numbers, or details that identify a person. Never mention brands, trademarks, or real-world products. Never repeat the child's own words back to them.",
    "Turn the child's wish into a play-world brief. Reply with JSON only:",
    '{"ok": true|false, "name": "<2-4 words>", "kind": "outdoor-day"|"outdoor-night"|"indoor", "sky": ["#hex","#hex","#hex"], "ground": "#hex", "far": "<one sentence: a wide distant panorama, level horizon, no objects>", "mid": "<one sentence: a row of cute rounded clay-toy shapes>", "props": ["<up to 6, ONLY from: lantern, windmill, cottage, tree, bushes, cloud, island, tire, drum, shed, palm, umbrella, sandcastle, pine, snowman, igloo, lamp, blocks, books, chair, plant, teddy, ball, cushions>"], "say": "<one short warm sentence in the child\'s language>"}',
    'If the wish is scary, violent, adult, a real person or a brand, set "ok": false and fill a gentle alternative.',
    `The child said: "${wish.replace(/"/g, "'")}"`,
  ].join("\n");
  const r = await call("/responses", { model: "muse-spark-1.3", input, reasoning: { effort: "low" } }, { timeoutMs: 60_000 });
  const text = (r.json?.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  console.log(`${r.status} ${r.ms} ms\n${text}`);
} else {
  console.error("modes: models | params | gen <WxH> <name> <prompt...> | brief \"<wish>\"");
  process.exit(2);
}
