# Dataset datasheet (STUB: canned recipes, NOT training data)

Created 2026-11-04T01:27:55.133Z. Prompt version t1, system line "Reasoning strength: low".

## Contents
- examples: 24 (train 23, val 1); heldout wishes (no answers): 16
- distinct wishes 24, distinct parts 10
- by language: {"en":24}; by slot: {"any":13,"head":7,"crown":4}
- feature operations used: {}
- approximate tokens per example: mean 340, max 348 (the trainer uses a 1,024-token window)

## Where it came from
- stub / none: runs run-202611040127

## What was kept, and what was thrown away
- the wish passed the production intake (scrubbed, length, unsafe terms in seven languages, brands)
- the wish is not evaluation data and not near it (word overlap under 0.8)
- the part passed the print gates (printable)
- the recipe passed the production allowlist (sanitizeRecipe)
- no unsafe term, no brand word and no generic fallback name in any text the model wrote, in any language
- all seven names present
- at most N distinct parts per wish
- short enough to train on

| rejected for | samples |
| --- | --- |
| none | 0 |

## Licence and provenance
- Answers were written by our own model, base Muse Glimmer 30B (Apache 2.0; its usage policy does not mention training on outputs).
- No output of the hosted Meta Model API is in this set: the Model API terms (section 10.1 ix) bar using it to train models that compete with Meta's. sample.ts refuses to run against it.
- The unsafe-term lists derived from LDNOOBW (CC BY 4.0) filtered this set; no list entry is training text.
- Wishes are our own seeds and wishes written by our own model. No child's wish is in it: no child's text has ever been stored.

## Leakage check
No training wish is evaluation data, near it, or in the heldout set.

## Files
- train.jsonl: 23 records, sha256 1f655aeb1b929606716b1ddc419346ffcc21b08f47dbd0c3899cf858a19ef449
- val.jsonl: 1 records, sha256 a0815fcae9055cd798a5166bf74c5eeb25fdbf6a9d786400e15f7efe4bd3cc71
- heldout.jsonl: 16 records, sha256 1fc01dec669f6e0e075fd543ab823d8a4f32e92def383a7aaea404fe57d4d0f6

## Notes
- Heldout wishes are listed in heldout.jsonl for evaluation and have no answers here.
- Failure-to-fix (repair) pairs are NOT included; see docs/specs/forge-ai-spec.md, Tuning readiness.
