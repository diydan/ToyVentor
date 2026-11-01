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

- **Model provider and key hosting (Dan's).** The viewer is static today (no network calls anywhere in it). Live matching needs a provider account plus either a user-pasted key or a tiny local endpoint — that choice and its cost/latency handling are open; the plan works either way via the contract in step 1.
- **Frozen paths.** Implementation touches `parts/kip/viewer/*` and `public/kip/*`: Dan cleared these two paths for this task when it runs; every other frozen path stays off-limits.
- **Curated list.** Proposing the top-30 Snap set; confirm or trim before building the fixtures.
- Assumption: the ~30 existing `valid_*` cases cover the 10 fixtures; if a description needs a mate with no validated edge, it ships as a fixture gap, not a validator override.
