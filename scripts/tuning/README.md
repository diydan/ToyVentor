# Forge tuning runbook (the v2 candidate)

**Status, 2026-11-04: the preparation is built and tested, and two pilot models were trained and evaluated; neither passed the decision rule (DO NOT SHIP), and nothing tuned is in use.** `npm run tune:check` prints what has been run on
this machine (generated data is not committed). No claim anywhere may go beyond the numbers in `eval-compare.md` / `MODEL_CARD.md`, and each is quoted with its n. The first iteration's results and what they showed are in `docs/product/journal.md` (Wed Nov 4 ~09:15).

## Why tune at all

The product's safety does not come from the model: the model never talks to a child, it returns a recipe (numbers and choices that code builds and gates) plus a few short names, and
everything it says is filtered. A tuned, task-specialised model adds three things on top, and only if the evidence shows them:

1. **Child safety by construction, measured.** Every training example passed the production intake, the print gates, the recipe allowlist, and the unsafe-term and brand filters in seven
   languages (`lib/dataset.ts`). A model trained only on such answers has never seen a brand word, an unsafe word or a refused wish in an answer, and a child-specific red-team set
   (`tests/fixtures/forge-redteam.json`) judges it against the base model. This is also the documented mitigation Meta's model card asks a deployer to have for under-18 use.
2. **A model that does one narrow job.** It writes Recipe v1 for toy accessories, in a prompt of about 600 characters instead of 10,000; there is less for it to do and less to red-team.
3. **Speed and cost.** The base model reads about 3,600 prompt tokens on every call and spends about 70% of its output thinking. A tuned model may need neither.

**What tuning does NOT give us.** It is not a safety guarantee: published research reports that even harmless fine-tuning can erode a model's safety training, and Glimmer's card is silent on
whether Meta's survives (this is background knowledge, not something checked here). So the tuned model must pass a gate that the base model also passes, and a pass is permission to run it,
never a claim that it is safe for children. That claim needs the larger red-team set, the native read of the word lists and the signed risk assessment
(`docs/specs/forge-ai-spec.md`, "Tuning readiness").

## The pipeline

```
wishes.ts ──► sample.ts ──► build-dataset.ts ──► glimmer_train.py ──► serve ──► eval.ts run (base, tuned) ──► eval.ts compare
 (seeds +      (OUR model     (filters, split      (Modal GPU:          (llama.cpp,    (heldout + acceptance        (the decision
 own-model      through the    files, leak check,   QLoRA, Unsloth)      untested for   + red-team)                  rule)
 wishes)        real gates)    manifest)                                 a tuned model)
```

| Stage | Command | Needs | Time and cost (estimates, from the figures measured on 2026-11-04) |
| --- | --- | --- | --- |
| 1 wishes | `npm run tune:wishes -- --expand --count 600 --per-lang 120` | Modal Glimmer server, `SELF_TEXT_KEY` | about 25 model calls, minutes, cents |
| 2 sample | `npm run tune:sample -- --per-wish 1 --concurrency 4 --max-calls 1000` | daemon on :8791, Modal Glimmer | measured at about 13 s of container time per call with two in flight (runs 2 and 3 of the 40 wishes): 1,000 calls is about 3.6 container-hours, about $7 at list price, about 2 hours on two containers. 2,000 calls would be about $14 (an earlier figure of $7 for 2,000 came from solo call times and was too low by half) |
| 3 dataset | `npm run tune:build` | nothing | seconds |
| 4 smoke | `modal run scripts/modal/glimmer_train.py::smoke --dataset dataset --run smoke-1` | Modal, `modal volume put` of the dataset | 60 steps; the spec's estimate is under an hour, $3 to $5 |
| 5 train | `modal run scripts/modal/glimmer_train.py::train --dataset dataset --run pilot-1` | Modal | the spec's estimate: $8 to $12 for 3,000 to 5,000 pairs on an A100; unmeasured |
| 6 check | `modal run scripts/modal/glimmer_train.py::generate --run pilot-1 --n 20` | Modal | minutes: valid JSON? thought first? |
| 7 export | `modal run scripts/modal/glimmer_train.py::export --run pilot-1` | Modal, 96 GB RAM | merged 16-bit weights, about 56 GB |
| 8 serve | see below | a GPU | untested |
| 9 evaluate | `npm run tune:eval -- run --label base` then `... run --label tuned --prompt tuned --url <tuned> --model <name>` | daemon, both servers | a few hundred calls each, about 40 minutes each |
| 10 decide | `npm run tune:eval -- compare scripts/tuning/data/eval-base.json scripts/tuning/data/eval-tuned.json --goal safety` | nothing | exit 0 only on a pass |

Stop at the first stage that does not work and record the numbers; the spec's rule is "when a gate fails, stop spending". A sensible ceiling for the whole thing is $100, and every
command that spends has a brake (`--max-calls`, a dry run, a smoke run before a full run).

## Two training variants, chosen on purpose

Glimmer thinks on a private channel before it answers (`to=self`), then answers on `to=user`. The loss mask decides what training touches:

- **`keep` (default).** Trains only the answer. Glimmer's thinking is left alone, which is what Unsloth advises and the least disturbance to Meta's safety training. Speed gain: the shorter prompt only.
- **`skip`.** Also trains the choice to answer without thinking. Faster (roughly a third of the tokens at `low`), and the riskier variant for safety. Run it only as a second experiment and judge it with the same gate.

## Serving a tuned model: unverified

- Unsloth's own notebook says its GGUF export fails for Glimmer because llama.cpp lacked the architecture when it was written; Meta's GGUF page says llama.cpp supports it from build b10353. Both are
  true at their dates; the current state for a *tuned* model is untested. Try, in order: (a) convert the merged folder with llama.cpp's `convert_hf_to_gguf.py`, quantise with `llama-quantize` to Q4_K_M,
  serve with `llama-server`; (b) a LoRA converted with `convert_lora_to_gguf.py` loaded over Meta's Q4_K_M with `--lora`; (c) vLLM or SGLang on the merged weights (unconfirmed for Glimmer).
- **Template parity.** Training renders text with the Hugging Face chat template; llama-server renders with its own. They must agree byte for byte. Check one example: render it in the trainer
  (`mask_check.txt` in the run folder) and compare with `POST /apply-template` on the server. Not done.
- **The speed booster.** Glimmer ships a small "drafter" model trained for the base model; a tune may lower its hit rate (58% in our logs), which would eat part of the speed gain.
- Worker settings for a tuned server: `MODEL_BACKEND=self` (or `TEXT_BACKEND=self`), `SELF_TEXT_URL`, `SELF_TEXT_MODEL=<its name>`, `SELF_TEXT_API=chat`, **`SELF_TEXT_PROMPT=tuned`**, and `SELF_TEXT_REASONING`
  unchanged (the training examples carry the same `Reasoning strength: low` line the Worker sends).

## Where progress is tracked

| What | Where | How it is kept |
| --- | --- | --- |
| Every evaluated run, with the decision rule's verdict | `scripts/tuning/results/pilots.md` and `pilots.json` | generated: `npm run tune:results` after each `eval.ts run`; only runs whose eval file exists are listed |
| GPU spend, per stage, estimate then reconciled | `scripts/tuning/results/LEDGER.md` | by hand, a row BEFORE each GPU use, reconciled after |
| What happened, in order, including the runs that died | `docs/product/journal.md` (the "Results log" entry and the status entries around it) | by hand |
| What may be claimed | `scripts/tuning/MODEL_CARD.md` and the table below | by hand; every number cites `results/pilots.md` |
| What is built and what has been run on this machine | `npm run tune:check` | computed from local files |
| The plan and the open decisions | `docs/specs/forge-ai-spec.md`, "Tuning readiness" and the open questions | by hand |

## What may be said at each point

| State | May say | May not say |
| --- | --- | --- |
| Now (2026-11-04) | "The full pipeline is built and was run end to end: two pilots were trained on our own model's answers, converted, served and evaluated by a decision rule, which refused both: they are faster (35% and 55% lower median seconds) but write brands into names more often and fail the first call more often." | that a model is ready, in use, or safer; that the next iteration works |
| Dataset built from our model | the counts, the datasheet, "every example passed the production filters" | that a model learned from it |
| Smoke run done | "an adapter trained for 60 steps: loss went from X to Y" | any quality or safety claim |
| Pilot and heldout eval done | the table in `eval-compare.md`, verbatim, with its n | "safe for children" |
| Served in the demo | "runs live" | "in production", "the default" |

## Provenance and licences

- Our model's answers are the only training text. Base Glimmer is Apache 2.0, its usage policy does not mention training on outputs, and the policy's under-18 duty (assess and mitigate) still applies to the result.
- **No hosted-model output is used.** The Meta Model API terms (10.1 ix) bar using hosted outputs to train models that compete with Meta's; `sample.ts` refuses to run against the hosted API.
- LDNOOBW (CC BY 4.0) only filters; none of it is training text.
- `glimmer_train.py` uses Unsloth's documented calls and settings and credits its Glimmer notebook (LGPL-3.0); it is not a copy of it.

## Known gaps in the preparation

Failure-to-fix (repair) pairs are not generated, so a tuned model sees no repair prompts in training; the first call is what is tuned. There is no JSON Schema for constrained decoding. The red-team set
is a seed (about 75 cases) where a release needs hundreds reviewed by native speakers. The six translated word lists have had no native read. The training script has run for two pilots (910 examples, 456 steps) that did not pass; a second iteration (full production prompt, brand-wish examples) was prepared and its training was cut short by a compute-provider outage, so it has no results.
