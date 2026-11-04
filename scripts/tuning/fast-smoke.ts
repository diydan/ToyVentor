/**
 * A live smoke test for the fast path: send a few wishes through the DEPLOYED app's real make route (the whole client loop: model, first look, print checks) and report, per wish, which
 * model made the part (the reply's `model`), whether it printed, how many calls it took and how long it took.
 *
 *   npx tsx scripts/tuning/fast-smoke.ts --url https://<the live app origin> [--wishes 10] [--expect fast|standard|any] [--proof <parent proof token>]
 *
 * Each wish is a new device, as a real child's would be; the Worker's own rate limits apply (a refused call is waited out by the client loop), so ten wishes can take a while.
 * It asks for a hat or head wish with no slot for most, one vehicle slot (which must go to the standard model), one brand wish and one the intake must refuse. Exit 1 when a wish
 * that should print did not, when a vehicle slot was made by the fast model, when the refused wish was made, or when --expect says fast (or standard) and the first attempts disagree.
 * Nothing here prints a key; the app's origin is the only thing you pass.
 */
import { randomUUID } from "node:crypto";
import { makeFromText } from "../../shared/forgeMakeFlow";
import type { MakeSlot } from "../../shared/forgeMakeLimits";
import { num, parseArgs, str } from "./args";

interface Case { text: string; slot?: MakeSlot; expect: "make" | "refuse"; note: string }
const CASES: Case[] = [
  { text: "a wizard hat", expect: "make", note: "plain hat" },
  { text: "ninja hat", expect: "make", note: "two words, no article: used to lose every name" },
  { text: "robot hat", expect: "make", note: "same" },
  { text: "a dragon head", expect: "make", note: "head" },
  { text: "un sombrero de vaquero", expect: "make", note: "Spanish" },
  { text: "ein Piratenhut", expect: "make", note: "German" },
  { text: "a bunny head", expect: "make", note: "head" },
  { text: "bir uzay şapkası", expect: "make", note: "Turkish" },
  { text: "a tractor hood with flames", slot: "hood", expect: "make", note: "vehicle slot: must be the standard model" },
  { text: "a Cocomelon hat", expect: "make", note: "a brand the filters do not know: the name must come back generic" },
  { text: "a hat with a knife", expect: "refuse", note: "the intake must refuse it" },
  { text: "a pirate hat with a parrot", expect: "make", note: "plain hat" },
];

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const origin = (str(flags, "url") ?? "").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error("pass --url https://<the live app origin> (no path)");
  const n = Math.min(CASES.length, Math.max(1, num(flags, "wishes", 10)));
  const expectModel = str(flags, "expect") ?? "any";
  const proof = str(flags, "proof");
  const cases = [...CASES.slice(0, Math.min(n, 8)), ...CASES.slice(8)].slice(0, Math.max(n, 3)).filter((_, i) => i < n || i >= 8);
  let failures = 0;
  const rows: string[] = [];
  const secs: number[] = [];
  const firstModels: string[] = [];
  for (const c of cases) {
    const device = randomUUID();
    let model = "?";
    const t0 = Date.now();
    const r = await makeFromText({
      text: c.text,
      ...(c.slot ? { slot: c.slot } : {}),
      gate: { headers: () => ({ "x-device-id": device, ...(proof ? { "x-parent-proof": proof } : {}) }) },
      fetch: async (url, init) => {
        const res = await fetch(`${origin}${url}`, init as RequestInit);
        if (url.includes("/api/forge/make") && model === "?") {
          try { const j = (await res.clone().json()) as { model?: string }; if (typeof j.model === "string") model = j.model; } catch { /* not JSON: leave it */ }
        }
        return res;
      },
    });
    const took = Math.round((Date.now() - t0) / 100) / 10;
    let verdict: string;
    if (c.expect === "refuse") verdict = r.ok ? "FAIL (made a part)" : "ok (refused)";
    else if (!r.ok) verdict = `FAIL (${r.reason})`;
    else if (!r.printable) verdict = "FAIL (not printable)";
    else verdict = "ok";
    if (c.slot && model === "fast") verdict = "FAIL (a vehicle slot went to the fast model)";
    if (verdict.startsWith("FAIL")) failures++;
    if (r.ok) { secs.push(took); firstModels.push(model); }
    const brandWarn = c.text.toLowerCase().includes("cocomelon") && r.ok && /cocomelon/i.test(JSON.stringify([r.name, r.names])) ? " BRAND IN OUTPUT" : "";
    if (brandWarn) failures++;
    rows.push(`${c.text.slice(0, 34).padEnd(34)} ${c.slot ?? "-".padEnd(1)}`.padEnd(42) + ` model=${model.padEnd(8)} ${String(took).padStart(5)} s  calls=${r.ok ? r.calls : "-"}  ${verdict}${brandWarn}  (${c.note})`);
    console.log(rows[rows.length - 1]);
  }
  const fastN = firstModels.filter((m) => m === "fast").length;
  const stdN = firstModels.filter((m) => m === "standard").length;
  secs.sort((a, b) => a - b);
  console.log(`\nfast ${fastN}, standard ${stdN}, unknown ${firstModels.length - fastN - stdN}; median ${secs.length ? secs[Math.floor(secs.length / 2)] : "-"} s; failures ${failures}`);
  if (expectModel === "fast" && fastN === 0) { console.log("expected the fast model for hat and head wishes and saw none"); failures++; }
  if (expectModel === "standard" && fastN > 0) { console.log("expected the standard model only and the fast model answered"); failures++; }
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(2); });
