## Goal

Add a "Describe & build" tab to Kip-Demo: the user types what they want (e.g. a race car, Kip with a cowboy hat), a language-model call turns the text into an ordered recipe of catalog parts, the page shows the recipe as an exploded view with a slider, then animates the build step by step to the assembled item.

## Success Criteria

- Ten curated test descriptions (vehicles, characters, hat/hair variants) each produce a buildable recipe: every step is a legal mate per the fit matrix, zero validator errors.
- Exploded view separates every part along the build axis with no interpenetration at full spread; the slider scrubs smoothly from assembled to exploded.
- Build animation plays the recipe in order, one part seating per step, ending in the validated assembled pose.
- With no model key configured, the tab still works off the baked-in recipe book.
- No third-party trademarks anywhere in the new UI text (the brand gate scans it).

## Approach

Extend `Kip-Demo.html` with a new tab rather than a new page, reusing the existing STL loader (`/kip/partspec/*.stl`) and roster. Keep the page static: the model call goes to a provider-agnostic JSON endpoint the user configures, with a baked-in keyword-to-recipe book as offline fallback seeded from the ~30 `valid_*` assembly cases (e.g. seated Kip, roadster, wardrobe builds), which are already validator-approved recipes. Recipe steps are validated client-side against `fit_matrix.json` before anything renders, so the page can never show an impossible build. Public copy follows the Truck-Mockup pattern: `viewer/` and `public/kip/` copies kept byte-identical.

## Steps

1. **Recipe contract.** Define the recipe JSON (ordered steps: part id + mate interface + host step) and the model request/response shape (`{description, allowedIds[]} → {steps[] | clarifyingQuestion}`). Surface: new doc section in the spec + a fixture file of the 10 curated recipes. Depends on: curated part list (propose: top-30 Snap vehicle/character/hair/hat set).
2. **Matcher service.** Thin JS module: tries the model endpoint, falls back to keyword-to-recipe matching, always returns steps plus a confidence note. Surface: new `kip-describe.js` beside the wardrobe module.
3. **Recipe validator.** Client-side check of each step against the shipped fit matrix; rejects illegal mates with a plain-language message and offers the closest legal alternative. Surface: same module, tested against the 10 fixtures.
4. **Exploded view.** Order parts by recipe step, offset each along the build axis by step index × slider value; slider scrubs assembled↔exploded. Surface: Kip-Demo tab + Three.js group transforms.
5. **Build animation.** Steps play in order with a per-step seat motion; replay and step-through controls. Surface: same tab.
6. **Key handling + docs.** Key lives in session storage, never in the repo; document setup in the tab itself. Mirror to `public/kip/`, verify identical.

## Validation Plan

- Recipe fixtures: all 10 curated descriptions validate with zero errors (automated check of steps against `fit_matrix.json`).
- Exploded view: at full spread, pairwise overlap of part bounding volumes is zero (scripted check on the 10 fixtures).
- Manual: scrub slider smoothness and animation order in the browser; no-key fallback builds all 10 fixtures.
- Gates: brand-name selftest stays green; both HTML copies byte-identical (`cmp`).

## Risks / Open Questions

- **Model provider and key hosting: decided (Dan, 2026-11-03): Muse, through the Meta key already in `.dev.vars` (`MODEL_API_KEY` / `META_MODEL_API_URL`).** Built as `worker/describe.ts`, route `POST /api/describe`, using Create mode's client conventions (`worker/muse.ts`: Responses API, `muse-spark-1.3`, contact details scrubbed before the words leave, kid-safety filter on what comes back, 10 requests a minute per IP). The tab uses it by default when the Settings address is empty, and falls back quietly to its own matcher if the route is missing, off or failing.
  - **What Muse may do there: choose, not invent.** The contract says poses are never written by a model; they come from the real assembly validator (Python, exact collisions), which cannot run in a Worker. So Muse reads the child's words (in any language, which the English keyword matcher cannot) and picks one of the ten ready builds in `kip-describe-recipes.json`; the reply is that build's own steps and reference poses, so it is always buildable and always checked. Unclear words get a question that offers two builds. Muse's note comes back in the child's language.
  - **Inventing new builds stays local:** `parts/kip/viewer/tools/describe-endpoint.mjs` (now defaulting to `muse-spark-1.3`) asks the model for a new recipe and runs the real validator. Putting that validator behind a hosted service (the optimizer daemon has the same shape: a Worker, a token, a Python process) is what it would take to let the deployed app invent builds. Not done.
  - **Privacy:** the child's description (contact details removed) now goes to our server and on to Muse by default, to pick a build. Same class as Create mode, which already sends a child's words to Muse; the Settings text says so. **Decided (Dan, 2026-11-03): no parent gate.** For the record, a gate is normally asked for because free-typed words from a child go to a third-party model and children's-privacy rules and the app stores expect a parent's consent for that. Mitigations in place: contact details scrubbed before the words leave, the reply filtered, the Worker logs only status and recipe (never the text), 10 requests a minute per IP.
  - **Measured (real Muse, 2026-11-03):** English, Spanish, Turkish and French descriptions each picked the right build, with Muse's line in the child's own language; "a spaceship" and "something fun" got a question; an injection attempt got a harmless question and the invented id was never trusted. 4.4 to 10.6 s per call (12 s budget), so expect a visible "Thinking…" wait.
  - **The waiting state (built 2026-11-03): a little workshop.** A 4 to 10 s wait must not look frozen or lie about progress. While the model thinks (and while the sample book and the part list load), a strip under the status line shows a striped belt carrying common bricks (2x2, 2x4, 1x4, a wheel; at most 6 at once, random) that ride in; about a third "poof" away mid-belt (did not fit) and the rest drop onto a parts pile that fills along `1 - exp(-t/5.5)`. The pile never fills on its own: the last two bricks are held back for the real answer, so it cannot say "done" first. The wording rotates at 3, 6 and 10 s and has its own lines for drawing and loading. Rules: hidden for the first 350 ms (a quick answer shows nothing); decoration is `aria-hidden` and the status line (`role=status`) carries the words; reduced motion shows three still bricks and no loop; on answer, error or `dispose()` everything stops (no timers, no bricks). Progress is honest decoration plus time, never a fake percentage. Tab e2e section [5c] covers it. Known gap: the previous build's badge and "Built: all N parts" line stay visible while the next request is pending.
- **Frozen paths.** Implementation touches `parts/kip/viewer/*` and `public/kip/*`: Dan cleared these two paths for this task when it runs; every other frozen path stays off-limits.
- **Curated list.** Proposing the top-30 Snap set; confirm or trim before building the fixtures.
- Assumption: the ~30 existing `valid_*` cases cover the 10 fixtures; if a description needs a mate with no validated edge, it ships as a fixture gap, not a validator override.
