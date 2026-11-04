/**
 * Canned recipes for showing the pipeline's format with no model and no GPU. They are valid Recipe v1 (they pass the production allowlist) and they are NOT training data:
 * records made here carry `source.backend = "stub"`, the dataset builder refuses them without --allow-stub, and the training script refuses a manifest that says "stub".
 */
import { createHash } from "node:crypto";
import type { TermLang } from "../../../shared/kidSafeTerms";
import type { SampleRecord, Task } from "./sampling";

const SLICES_HAT = [{ z: 0, w: 23.4, d: 11.4, r: 4.6 }, { z: 10, w: 28, d: 14, r: 5 }, { z: 20, w: 14, d: 8, r: 3 }];
const SLICES_HEAD = [{ z: 0, w: 24.6, d: 12.1, r: 5 }, { z: 14, w: 29, d: 16, r: 6 }, { z: 30.5, w: 20, d: 12, r: 5 }];

const NAMES: Record<TermLang, { w: string; g: "m" | "f" | "n" }> = {
  en: { w: "example hat", g: "m" },
  es: { w: "sombrero de ejemplo", g: "m" },
  fr: { w: "chapeau d'exemple", g: "m" },
  de: { w: "Beispielhut", g: "m" },
  it: { w: "cappello di esempio", g: "m" },
  pt: { w: "chapéu de exemplo", g: "m" },
  tr: { w: "örnek şapka", g: "m" },
};

export function stubBody(t: Task): ReturnType<typeof stubCallResult> {
  return stubCallResult(t);
}

function stubCallResult(t: Task): Omit<SampleRecord, "id" | "wish" | "lang" | "slot" | "split" | "sampleIndex" | "source"> {
  const head = t.wish.slot === "head" || /\bhead\b|\bkopf\b|\btête\b|\bcabeza\b|\btesta\b|\bcabeça\b|\bkafa/i.test(t.wish.text);
  const h = createHash("sha256").update(`${t.wish.text}|${t.index}`).digest();
  const bump = (h[0]! % 5) * 0.4; // a little variety between samples
  const slices = (head ? SLICES_HEAD : SLICES_HAT).map((s) => ({ ...s, w: Math.round((s.w + bump) * 10) / 10 }));
  const id = `stub_${h.toString("hex").slice(0, 8)}`;
  const name = head ? "Example Head" : "Example Hat";
  return {
    ok: true,
    printable: true,
    calls: 1,
    secs: 0,
    name,
    recipe: { v: 1, id, name, stat: "Glow", behavior: "An example recipe used only to show the data format", slot: head ? "head" : "crown", shape: { kind: "loft", slices }, features: [] },
    names: Object.fromEntries(Object.entries(NAMES).map(([l, n]) => [l, { w: head ? n.w.replace(/hat|sombrero|chapeau|hut|cappello|chapéu|şapka/i, "head") : n.w, g: n.g }])),
  };
}
