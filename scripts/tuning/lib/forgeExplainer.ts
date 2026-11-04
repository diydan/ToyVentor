/**
 * What Forge is, in plain words: ONE source for the explanation that opens both the one-page pitch (scripts/tuning/pitch.ts) and the charts page (scripts/tuning/charts.ts), so the two never
 * say different things. Pure: it takes the few numbers it quotes (computed from the run files by the caller) and returns HTML strings.
 */
export interface ExplainerNumbers {
  /** Median seconds of the tuned model on the main set, once warm. */
  warmSeconds: number;
  /** Median seconds of the tuned model and of the base on the main set. */
  tunedMain: number;
  baseMain: number;
  /** "About N% faster" on the main set and on the blind half. */
  speedMainPct: number;
  speedBlindPct: number;
}

export interface Explainer {
  intro: string;
  how: string;
  trained: string;
  why: string;
  ships: string;
}

export function forgeExplainer(n: ExplainerNumbers): Explainer {
  return {
    intro: `You open Make from words and type what you want to wear, like <i>a pink princess hat</i> or <i>I want to be a frog</i>. About ${Math.round(n.warmSeconds)} seconds once the model is warm, you see a little hat or animal head that fits your toy. You preview it, try it on, then print it with a grown-up's OK to snap onto the real toy. A brand, a rude word or a phone number just gets a calm no, or a generic name, and another try.`,
    how: `Wish &rarr; our own tuned Muse Glimmer 30B (LoRA, self-hosted) &rarr; one small JSON recipe + names in 7 languages &rarr; deterministic compiler + print gates &rarr; printable STL. The model never emits mesh; code builds and checks it. Hat and head wishes go to the tuned model first; vehicle parts, the held prop, every repair and any failure go to our own base Glimmer. Both are OUR models on OUR servers: the hosted model is not used for Make unless an operator switches on a safety net. Every name the model writes is checked before a child sees or hears it: unsafe words in 7 languages, a long brand list, and names that just copy the wish. One wish = one call; a repair resends the failed recipe with the gate's feedback, at most 4 tries.`,
    trained: `QLoRA fine-tune (Unsloth, Modal L40S/H100, 1&ndash;2 epochs, LR 2e-4) on 910 &rarr; 1,014 &rarr; 1,754 wish&rarr;recipe pairs. The answers are our own base model's, on synthetic wishes; every example passed the production intake, the print gates, the recipe allowlist and the 7-language unsafe and brand filters. No hosted-model output and no child text in training. Judged on the same 243 wishes per run against the untuned base (Muse Glimmer 30B on our own server with the production prompt; not the hosted Spark model, which was not evaluated): latency, printable share, first-call share, name-filter fixes and a 70-item red-team; then on a blind set of 404 wishes written separately, of which only the dev half (204) has been used.`,
    why: `<ul>
<li><b>Kids can't use the hosted model.</b> Its terms (Meta Model API, section 10.1) bar under-18 end users and training on its outputs, so the child-facing path has to run on our own model, trained only on our own model's answers.</li>
<li><b>Safety by construction, measured.</b> Trained only on answers that had already passed every gate and filter, then judged against the base on the same red-team and on 204 wishes it never saw.</li>
<li><b>A smaller job.</b> One narrow recipe writer (about 600 characters of prompt in the short form, about 10,000 in production) instead of a general assistant: less to do, less to red-team.</li>
<li><b>Speed and cost.</b> About ${n.speedMainPct}% faster median on the main set (${n.tunedMain} vs ${n.baseMain} s) and ${n.speedBlindPct}% on the blind half, the slow tail roughly halved, 4-bit weights on scale-to-zero GPUs.</li>
</ul>`,
    ships: `Our own models are the default for Make-from-words: the tuned model first for hat and head first attempts, our own base for repairs, vehicle slots and any failure, no setting for a parent or a request, and no hosted fallback (an operator safety net exists for cold servers). <code>FORGE_FAST_MODE=off</code> turns the tuned model off; a test pins the production prompt to the text the tuned models were trained on. Honest limits: the blind test half is sealed and unused, nobody who reads the seven languages has reviewed the word lists, the brand list or the names, there is no score yet for whether a part looks like the wish, the hosted model's own numbers on these wishes were never measured, and the risk assessment is unsigned. Next: a fresh set of brands in no list, a match-to-the-wish score, a native-speaker read, and the sealed test half once.`,
  };
}

/** A small flow picture of the pipeline, for the charts page: one wish in, one printable part out, with the checks between. Inline SVG, text labels, no colour-only meaning. */
export function forgePipelineSvg(): string {
  const boxes: { x: number; w: number; t1: string; t2: string; cls: string }[] = [
    { x: 4, w: 78, t1: "A child's wish", t2: "7 languages", cls: "fp-in" },
    { x: 96, w: 92, t1: "Intake checks", t2: "words, brands", cls: "fp-check" },
    { x: 202, w: 100, t1: "Our tuned model", t2: "writes a recipe", cls: "fp-model" },
    { x: 316, w: 96, t1: "Name checks", t2: "7 languages", cls: "fp-check" },
    { x: 426, w: 102, t1: "Code builds it", t2: "compiler, no mesh", cls: "fp-code" },
    { x: 542, w: 92, t1: "Print gates", t2: "fits, strong", cls: "fp-check" },
    { x: 648, w: 80, t1: "Printable", t2: "STL file", cls: "fp-in" },
  ];
  const parts = boxes.map((b, i) => `<rect x="${b.x}" y="14" width="${b.w}" height="46" rx="8" class="${b.cls}"/><text x="${b.x + b.w / 2}" y="34" text-anchor="middle" class="fp-t1">${b.t1}</text><text x="${b.x + b.w / 2}" y="49" text-anchor="middle" class="fp-t2">${b.t2}</text>${i < boxes.length - 1 ? `<path d="M${b.x + b.w + 2},37 L${boxes[i + 1]!.x - 3},37" class="fp-arrow" marker-end="url(#fpa)"/>` : ""}`).join("");
  return `<svg viewBox="0 0 732 100" role="img" aria-label="How Forge works: a wish passes the intake checks, our tuned model writes a recipe, the names are checked, code builds the part, the print gates check it, and a printable file comes out. If a check fails the recipe goes back to the model with the gate's feedback, at most four tries."><defs><marker id="fpa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="fp-head"/></marker></defs>${parts}<path d="M595,62 L595,82 L252,82 L252,64" class="fp-loop" marker-end="url(#fpa)"/><text x="426" y="96" text-anchor="middle" class="fp-t2">a failed check goes back to the model with the gate's feedback (at most 4 tries)</text></svg>`;
}
