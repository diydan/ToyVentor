# Model card (draft): ToyVentor Forge-Glimmer, v2 candidate

> **NOT TRAINED.** This card was written on 2026-11-04 with the preparation, before any training. Fields that need a result say so. Nothing here describes a model that exists.

## Summary
A fine-tune (LoRA, 4-bit base) of Muse Glimmer 30B that writes **Recipe v1**, a small JSON description of a printable accessory for a child's snap-together toy, plus the accessory's name in seven languages,
from a child's short wish. Code, not the model, builds the geometry and checks it; the model only proposes parameters.

## Intended use
- Called only by ToyVentor's Worker (`worker/forgeMake.ts`), never by a child directly, behind a key-protected server.
- Input: a wish of at most 120 characters that has already passed the product's intake (contact details scrubbed, unsafe terms and brands refused in seven languages).
- Output: one JSON object `{recipe, names}`, validated field by field by `sanitizeRecipe`, built by the optimizer daemon and checked by the print gates, with every name filtered before display.

## Not intended for
Chat or open-ended conversation with a child; any use outside the recipe task; content moderation; making claims about children, safety or people; any deployment without the checks above in front of and behind it.

## Base model, licence, and the under-18 duty
Base: Muse Glimmer 30B (Meta), Apache 2.0, with a separate usage policy: "not intended for individuals under the age of 18", and, on the model card, a duty on deployers of systems that children may use
to assess and mitigate the risks. This card, the datasheet and the evaluation are part of meeting that duty; they do not discharge it. The risk assessment is not signed (owner: Dan).

## Training data
Produced by `scripts/tuning/` from base Glimmer's own answers to training wishes (seeds plus wishes our own model wrote in the other six languages), each kept only if it passed the production intake, the print
gates, the recipe allowlist, the unsafe-term and brand filters in seven languages, and had all seven names (`DATASHEET.md` written with each build lists counts, rejections and hashes).
**No output of the hosted Meta Model API is used** (its terms, 10.1 ix, bar it). No child's text has ever been stored, so none is in the data. Evaluation wishes and the heldout set are excluded by hash and by
word overlap. Actual dataset: *not built yet*.

## Training procedure
QLoRA with Unsloth on Modal (`scripts/modal/glimmer_train.py`): `transformers==5.15.0`, r=16, alpha=16, learning rate 2e-4, loss `nll`, 1,024-token window, answer-only loss mask (`keep`) or answer plus
channel choice (`skip`). Run: *not run*.

## Evaluation (the decision rule, fixed before any run)
`scripts/tuning/eval.ts` runs the base and the tuned model over the heldout wishes, the 40 acceptance wishes and a red-team set, and `lib/compare.ts` decides. Safety gates (red-team pass rate not below the
base, no prompt leakage, the name filters not fixing more answers than for the base, no more unanswered wishes), quality gates (printable share within 2 points, first-call within 5 points), and one goal
(speed, safety or both). Results: *none*.

## Safety: what is in place, and what is not
In place: the narrow output channel, the intake and output filters in seven languages, a hard rule that no recipe is built unless the gates pass, a fail-closed model switch, a seed red-team set with its known
gaps listed, and an evaluation in which a faster model that is less safe cannot pass. **Not in place:** a native-speaker read of the six translated word lists, a red-team set of the size a release needs, a classifier
on the input and output, a signed risk assessment, and any evidence yet about how fine-tuning changes Meta's safety behaviour for this model.

## Limitations
Lists and filters catch words, not meaning (a sentence about hurting people with no listed word passes: see the known gaps in `tests/fixtures/forge-redteam.json`); letters spaced apart and Turkish typed without
its special letters are not caught; seven languages only; the model may write a brand word in a name, which the output filter replaces; quality at the recipe's 12 operations only (no manes, snouts needing supports, or
anything the compiler cannot print).

## Status of the claims
| Claim | Status |
| --- | --- |
| The pipeline exists, is tested, and its guards are proven | true (see `npm run tune:check`) |
| A model was trained | **no** |
| A tuned model is faster or safer than the base | **unknown** |
| The model is safe for children | **no claim**; the assessment is unsigned |

Contact: Dan (owner of the product and of the risk assessment).
