# 0008 — Meta's models and under-18 users

Date: 2026-11-03. Status: **draft, open, needs an owner decision (Dan)**. Written
from the primary texts and from our code. It is a record of facts and options, not
legal advice; the legal reading belongs to whoever owns policy risk. Fills in part of
0007's "Still to record" list (the Meta Model API terms had not been read).

## The texts (read from the source on 2026-11-03)

**A. Meta Model API Terms of Service, last updated October 9, 2026, section 10.1.**
Source: https://dev.meta.ai/legal/terms-of-service (the `llama.developer.meta.com`
address redirects there). These govern the API our Worker calls today
(`https://api.meta.ai/v1`, model `muse-spark-1.3`).

> You and your End Users must be at least 18 years of age to use the Services and
> Integrated Products, and you will not create Integrated Products targeted at
> individuals under the age of 18.

"End Users" are the end users of the developer's products or services that interface
with the Services; "Integrated Products" are the applications, tools, products and
integrations built on them. Section 10.1 also incorporates the Model API Acceptable Use
Policy and the Model Designation and Geographic Use Policy (**neither read yet**).

**B. Muse Glimmer (open weights, for self-hosting).** Apache 2.0 plus a separate usage
policy. The Model API terms above are about the hosted API, not downloaded weights.
- Usage policy, line 7: "Muse Glimmer is not intended for individuals under the age of 18."
  https://huggingface.co/meta-models/Muse-Glimmer-30B/blob/main/USAGE_POLICY.md
- Model card, Limitations, last bullet: "The model is not intended to be downloaded by
  or used by individuals under the age of 18. Where deployed within systems that may be
  used by individuals under the age of 18, deployers are responsible for ensuring that
  any risks associated with such use by individuals under the age of 18 has been fully
  assessed and appropriately mitigated, and complies with all applicable laws."
  https://huggingface.co/meta-models/Muse-Glimmer-30B
- The policy also bars collecting, processing or inferring private or sensitive
  information about individuals without the right to (1.1.5), representing outputs as
  human-generated (3.5), and failing to disclose known dangers to end users (4). It says
  nothing about fine-tuning, derivatives or training on outputs.

## What this means for us

1. **The hosted route is the sharper issue, and it is live.** Our product is for
   children (Snap 3+, Pro 8+) and calls the Meta Model API. Read literally, 10.1 says
   End Users must be 18 and that we must not build a product targeted at under-18s. That
   is a contract term, not a deployer duty. It touches every kid-facing route that calls
   the API: `/api/forge/make` (text to part), `/api/describe` (Describe & Build),
   `/api/muse/spark` (Create mode) and the photo scans (`/api/scan`, room scan; SAM).
   Voice is separate (it does not call the Meta API). Open: whether hackathon terms, an
   account agreement or Meta's written permission change this ("unless expressly
   permitted by Meta" appears in the same section, attached to the list of prohibited
   acts that follows the sentence above). **Not resolved by this record.**
2. **Self-hosted Glimmer is governed by the model card, not the API terms.** There the
   duty is to assess and mitigate risks for under-18 use and comply with the law. That is
   a path that can be satisfied with work; the hosted clause may not be. It is a reason the
   own-model track may matter beyond cost, but the assessment below is still required.

## What our code does (verified 2026-11-03; text to part only, other routes not audited)

- A child's words: at most 120 characters, contact details scrubbed, a kid-safety and
  brand check before any call, then sent to the model quoted as data (`quoteWish`).
  No name, age, account or device id goes to the model.
- The model's reply is never shown as text. The recipe goes through an allowlist
  (`sanitizeRecipe`), then a deterministic compiler and the print gates. The part's name is
  letters only and brand-filtered, in seven languages, and spoken only if our Worker
  signed it.
- Logs carry event names, counts and statuses only (no wish, no recipe, no device id).
- Model: `muse-spark-1.3`, which Meta's model page lists as "Not used to improve our
  products" (the `-contributor` variant is "Used to improve our products"); the API terms
  say Standard Services content is not used to train Meta Models (section 5.1) but may be
  retained and processed to detect violations (section 4.1). Whether our key is on
  Standard Services was not verified.
- Making and previewing need no grown-up check (Dan, 2026-11-03); printing and saving a
  file do.
- Real-stack run, 40 wishes: 3 were refused at intake (a brand and an unsafe word), the 4
  prompt-injection tries ended harmlessly, and brand characters came back generic.

## Draft deployer risk table (Glimmer path)

| Risk | In place | Gap |
| --- | --- | --- |
| Child text reaches the model | length cap, scrub, kid-safety and brand filter, quoted as data | no review of free-text edge cases beyond the 40-wish run |
| Model output reaches the child | schema allowlist, compiler, gates, filtered signed names, no chat | none known for text to part |
| Private or sensitive information (policy 1.1.5) | no identifiers sent for text to part | **photo routes not audited**; Glimmer reads images, so audit before it sees any |
| Outputs presented as human-made (3.5) | "AI-made" label planned (phase G5) | label not built |
| Known dangers disclosed to end users (4) | none written | write the child and grown-up copy |
| Safety tuning surviving a fine-tune | Meta's post-training on the base | the model card does not say; the eval must include unsafe and injection prompts before any tuned model ships |
| Strict child safety as a whole | the guards and the gaps are listed in `docs/specs/forge-ai-spec.md`, "Child safety" (researched 2026-11-04) | unsafe words were English-only (a draft in seven languages built 2026-11-04, no native read yet), free-text fields, no classifier, no child red-team set, weights not pinned |
| Laws on children's data (e.g. COPPA, UK children's code, GDPR for children) | no accounts, no wish text stored | **not assessed; needs an owner** |

## Options (owner: Dan)

- **A.** Ask Meta for written permission for a children's product on the Model API, and
  check whether the hackathon's own terms already cover it.
- **B.** Keep the hosted route for the Nov 4 demo only (adults operating it, no real
  children's data), and say so.
- **C.** Move child-facing production to self-hosted Glimmer with a signed-off
  assessment (the own-model track).
- **D.** A for now, C as the plan.

## Still to record (owner: Dan)

- [ ] Whether the hackathon rules or the account agreement change 10.1.
- [ ] The Model API Acceptable Use Policy and Model Designation and Geographic Use Policy
      (links are inside the terms); confirm `muse-spark-1.3` is a Standard Model.
- [ ] Who owns the risk assessment and signs it.
- [ ] Audit of the photo, describe and Create routes against the same table.

## Decision log

- 2026-11-03, Dan: **B and C are the only options** (not A, asking Meta, as the route for
  now): hosted API for the Nov 4 demo only, self-hosted Glimmer for child-facing production.
  Dan wants a **waiver** in front of hosted-API use. Chosen for it: shown **once per visit**,
  **no record kept**. Not yet decided: what the waiver says. Dan's question, "does it matter
  that it is clearly targeted for kids?", is **yes for the second half of 10.1**: the first half
  (End Users must be 18) is about who uses it and a waiver can speak to that; the second half
  ("you will not create Integrated Products targeted at individuals under the age of 18") is
  about what we built, and a waiver does not change who the product is for. So a waiver is a
  disclosure and an adult-operator step, not a cure. Nothing built yet. The hackathon is run by
  Meta, so its organizers may be the quickest place to ask whether a children's toy on the
  Model API is allowed under the hackathon terms.
- 2026-11-03, Dan (later): **drop hosted Spark for the child-facing product and move to
  self-hosted Glimmer** (option C becomes the plan; B stays for the Nov 4 demo only). Effect:
  serving base Glimmer becomes the critical path and tuning becomes optional; the waiver is
  moot for production. See "Self-hosted Glimmer replaces Spark" in `docs/specs/forge-ai-spec.md`.

## Inventory: every Meta Model API use (found 2026-11-03, from the Worker code)

The terms cover every Meta model on the API, not only Spark. The key lists `muse-spark-1.1/1.2/1.3`,
`muse-image-1.0`, `muse-wonder-1.0`, `sam-3.1` and `muse-voice-transcribe-1.0`.

| Model | Route | What reaches it | State |
| --- | --- | --- | --- |
| `muse-spark-1.3` | `/api/forge/make`, `/api/describe`, `/api/muse/spark` (Create mode) | a child's typed words | live; moving to self-hosted Glimmer |
| `sam-3.1` | `/api/scan` (toy scan, room scan, photo to toy), `/api/selfie/face-parts` | photos of toys, rooms, faces | scan live when the key is set; face-parts off unless `SELFIE_CLOUD=on`; no replacement chosen |
| `muse-image-1.0` | `/api/skin` (repaint a toy photo), `/api/selfie/cartoon` (redraw a child's selfie as a cartoon) | photos, including a child's face | `/api/skin` live when the key is set. **The selfie routes are OFF unless `SELFIE_CLOUD=on`** (corrected 2026-11-03; I first called them live), and then need consent and the grown-up check, one picture sent; the team already kept it off in production until a COPPA review |
| `muse-image-1.0`, build time | scripts (backdrops, Kip face sets) | no child input | lower exposure (not an Integrated Product); still the owner's call |
| `muse-voice-transcribe-1.0` | none: planned in specs only | would carry a child's voice | **do not build on the Meta API** |
| `muse-wonder-1.0` | none in the Worker | | |

Glimmer reads images but writes text only, so it replaces Spark but not SAM or the image model. Every route above
degrades to "not configured" when no `MODEL_API_KEY` is set (verified for the skin and selfie helpers; the rest
should be tested route by route), so a child-facing deployment without the key switches them off. Children's-privacy
laws generally treat a child's photo or voice as personal information; the assessment owner should confirm.

## Can everything be self-hosted? Yes on the licences, read from the source on 2026-11-03

Raw files saved in the session scratchpad (`licenses/`). None of the four carries an under-18 or children clause for end users
except Glimmer, whose duty is the deployer's assessment.

| Need | Self-hosted candidate | What the source says |
| --- | --- | --- |
| Text (Spark) | Muse Glimmer 30B | Apache 2.0 plus usage policy; "not intended for under 18"; deployer must assess and mitigate (read earlier) |
| Segmentation (SAM 3.1) | SAM 3.1 weights, `facebook/sam3.1` | **SAM License, last updated 2025-11-19**, from `github.com/facebookresearch/sam3/blob/main/LICENSE`; the repo README says the whole project, including SAM 3.1 (released 2026-03-27), is under it. Grant: use, reproduce, distribute, modify, royalty-free, no commercial limit. **No age or children clause** (the "age required to give legal consent" wording is about the licensee, us). Obligations: comply with applicable **privacy and data protection laws** (1.b.iii), trade controls and no military or ITAR use, no reverse engineering; **we indemnify Meta** for third-party claims arising from our use (5.b); Meta may terminate for breach (then delete and stop); Meta's changes bind immediately. **Not read:** the gated Hugging Face page for the 3.1 checkpoints (401 without login). Access needs a gate request, and secondary sources say some requests are rejected. |
| Image edit | FLUX.2 klein-4B (`black-forest-labs/FLUX.2-klein-4B`) | **Apache 2.0** (card and LICENSE.md read). Text-to-image, editing and multi-reference in one model; runs on a consumer GPU. Out-of-scope use includes harming or exploiting minors; no age clause. The repo ships NSFW and protected-content filters for inputs and outputs, which the card encourages deployers to use (we should, for a children's product). **klein-9B is under the FLUX Non-Commercial License; do not use it.** |
| Image edit, alternative | Qwen-Image-Edit-2511 | **Apache 2.0** (card read, no children clause). Not checked: Qwen Image 2.1, reported research-only by a secondary source. |
| Transcription | Whisper large-v3-turbo | **MIT** (card read). Card cautions against transcribing people without their consent, warns of hallucinated text, repeated text and uneven accuracy across accents and dialects. Children's speech is not discussed; weaker accuracy is likely and untested. |

Self-hosting removes the Model API terms. What stays: Glimmer's deployer duty, and for SAM the privacy-law and indemnity terms
(worth a legal read). Quality of the open image models against `muse-image-1.0` is untested. Muse Spark Open (816B) is not a practical host.

## The switch (built 2026-11-03, uncommitted)

`worker/modelBackend.ts`: one master `MODEL_BACKEND` (hosted | self | off) plus a per-capability override
(`TEXT_BACKEND`, `SEGMENT_BACKEND`, `IMAGE_BACKEND`, `TRANSCRIBE_BACKEND`), because our own models will not all be ready
the same day. Fail closed: self never falls back to hosted, a typo is off, a missing endpoint is off. Unset means hosted for the
Nov 4 build; change `DEFAULT_MODE` after the demo. Text to part (`/api/forge/make`) is on it and tested (hosted, self in both API
shapes, off, fail closed with zero network calls, a request cannot choose, no URL or key in logs; mutation-checked).
**Not yet on the switch** (other lanes' files, ratchet list in `tests/model-backend.test.ts`): `worker/describe.ts`, `worker/muse.ts`
(Create mode), `worker/meta.ts` (SAM and the image model), `worker/parent.ts` (uses the Meta key only as a fallback signing secret for the
grown-up gate; it falls back to a stored random secret without it). Until they move, one master switch does not cover them.

