# Children's-privacy (COPPA) readiness: post-hackathon plan (draft 1, 2026-11-04)

**Status: draft, nothing built. Everything here is deferred until after the Nov 4 submission, with one standing condition (section 0).** Not legal advice: the legal points come from the FTC's own FAQ (read to character 100,000 of 141,737) and from law-firm summaries of the 2025 amendments, and need a lawyer. Related: `docs/decisions/0008-meta-models-and-under-18-users.md` (Meta's terms), `docs/specs/forge-ai-spec.md` "Child safety" (model-side guards and gap 9), `docs/specs/workshop-print-gate-spec.md` 7b and 7c (is a download gate required or a courtesy). This file owns the privacy-law work; it does not repeat those.

## 0. Decision: defer it all, on one condition

Nothing here blocks the submission. What controls the risk for Nov 4 is the wording of the entry, and that is already done (`docs/product/vision.md` "Models, children, and what this does not claim"; `docs/product/demo-script.md` "Say once, out loud").

The condition: **deferral holds only while the deployed build is an adult-operated demo.** COPPA does not pause for a hackathon. It applies to the operator of a service directed to children (Snap is 3+, with animated characters and music, which are factors in the FTC's test, FAQ D.1) that collects personal information, and a persistent identifier is personal information (FAQ A.3). So before any real child uses a deployed build, or the address is given to families, **phases P0 to P2 must be done.** Until then: no marketing to families, no school or playgroup pilots.

## 1. What we hold (read in the code, 2026-11-04)

"Verify" means I could not confirm it from the repo and P1 must.

| Item | Where | Goes to | Kept | Note |
| --- | --- | --- | --- | --- |
| Device UUID | `src/lib/sync.ts` (`localStorage` key `toyforge:device:v1`); sent as `x-device-id` on every API call | our Worker | D1 `ownership`, `parent_settings`, `time_ledger`, keyed by it (`migrations/0001`, `0002`) | A persistent identifier. I found no whole-device delete in `worker/ownership.ts` or `worker/parent.ts`, only `DELETE /api/ownership/:type/:id` per item. Verify. |
| Toy name, free text, 48 characters | `MyToySheet.tsx:888`; set on the toy at 330 and 360; the toy is what `pushOwnership` sends (309) | D1 `ownership.payload` | until deleted | A child could type a real name. Not filtered. |
| Parent settings, PIN hash, limits | `src/lib/parentTime.ts`, `settings_json` | D1 | until deleted | Verify what `settings_json` holds. |
| IP address | per-IP limits in the Worker; `observability` and `traces` enabled in `wrangler.jsonc` | Cloudflare | Cloudflare's retention | Verify retention; decide whether traces stay on. |
| Photo of a toy | `/api/scan`, `/api/skin` (`worker/meta.ts`) | Meta's hosted API | The Worker stores nothing (no R2, KV or D1 write in `meta.ts`, `selfie.ts`, `roomScan.ts`); Meta may retain to detect violations (0008, section 4.1) | **No grown-up check on either route.** A child's face or room could be in frame. |
| Room photo, selfie | `/api/scan` room mode, `worker/roomScan.ts`, `worker/selfie.ts` | Meta's hosted API | as above | Room scan needs grown-up proof; selfie cloud is off unless `SELFIE_CLOUD=on`, then needs consent and proof. |
| Wish, up to 120 characters | `/api/forge/make` | Meta (demo) or Modal Glimmer | not stored; logs carry counts only | Contact details scrubbed; no identifier sent. Making asks for no proof unless `FORGE_MAKE_REQUIRES_PROOF=1`. |
| Story mic | `src/features/liveplay/LivePlayPanel.tsx`, browser `SpeechRecognition`, started by a grown-up | the browser | no audio reaches our servers | Some browsers transcribe in the vendor's cloud. Verify per browser. FTC FAQ F.6 has an audio exception that needs a notice. |
| Spoken names | `/api/voice` | Gemini TTS via Workers AI | cached at the edge | Closed vocabulary keys; no child data. Not a COPPA item, but a vendor (section 3, P2). |
| Theme song | `/api/theme-song`, off unless `THEME_SONG=on` | text model, then Mureka | not audited | What reaches Mureka is not checked. Verify before it is switched on. |
| Analytics, ads | none found | | | A grep for common vendor names matched two files I did not read. Verify. |

Processors to list: Meta (demo only), Modal (Glimmer), Cloudflare (Workers, D1, AI Gateway, which resells Google), Mureka.

## 2. Decisions needed (owner: Dan)

**D1. The posture.** Recommended: **A.**

- **A. Collect nothing beyond a device id used for internal operations.** No photo from a child leaves the device unless a grown-up has passed the check; no free text is synced; the mic stays parent-started and on-device. COPPA then reduces mostly to notice, a written security program, a retention policy, vendor terms and parent access and deletion. Whether the "support for internal operations" exception (FAQ C.5, F.2) really covers our use is for the lawyer: it holds only while the identifier is not used to contact a child or to profile one.
- **B. Collect photos or voice with verifiable parental consent.** Needs an approved method (FAQ I.4: signed form, card transaction, video call, ID check, knowledge-based questions), a direct notice (FAQ C.9) and a separate consent for any third-party disclosure (2025 amendment). Much more work; only if a feature needs it.

The grown-up check in the Grown-Ups sheet is **not** consent. A hold plus a math question is an age screen at best, and the FTC calls a math question alone "inadequate" (FAQ D.7, D.8).

**D2. Who owns it** and signs the assessment (also open in 0008). One child-risk assessment can serve Glimmer's deployer duty, COPPA and the UK Children's Code together (forge-ai-spec gap 9).

**D3. Retention periods** for each D1 table. The amended rule asks for a written policy that names periods; it sets none.

**D4. Account model.** `toyventor-town-vision.md` says "no child accounts: a grown-up's account holds the saves". Decide before the notice is written, because the notice describes it.

*Now proposed in `docs/specs/accounts-and-new-user-spec.md` (2026-11-04): grown-up accounts only, children as profiles with no email or login, a parent sets up anyone under 13, phase 0 on-device only. Still Dan's decision; section 5 of that spec lists what a compliance owner has to review.*

## 3. Phases

**P0. Before any child uses a deployed build (about a day, mostly switches).**
- Flip `DEFAULT_MODE` in `worker/modelBackend.ts` and deploy the child build without the Meta key (already the plan in the Forge spec).
- `/api/scan` and `/api/skin`: grown-up proof required, or off, in the child build. Self-hosting SAM is the longer fix (0008 lists the candidate).
- Toy name: stop syncing it, or run it through the same filter as the Forge names.
- Cloudflare: the rate-limit rule on `/api/forge/make` and the rest of `deploy-checklist.md`; read the log and trace retention and decide whether traces stay on.
- `SELFIE_CLOUD`: on for the adult-operated Nov 4 demo (Dan, 2026-11-04). Delete the secret, or set it to anything but `on`, before any child uses a deployed build.
- Name the owner (D2).
- Gate: one test per item (for example, a scan request without a proof header returns the gate-required status in the child build).

**P1. Verify the data map (1 to 2 days).** Close every "verify" in section 1. Add a Google and Cloudflare voice row to 0008. Read the vendors' child and retention terms: Cloudflare (including Workers AI and AI Gateway), Modal, Mureka, and Google as resold.

**P2. The documents and the parent's rights (2 to 4 days, with the owner).**
- Online privacy notice: operator contact; what is collected from children, how it is used, who gets it; a parent's right to review, delete and refuse further collection, and how (FAQ C.2, C.3). Linked from the Grown-Ups sheet and the store page. No privacy text exists in `src` or `index.html` today.
- Written information security program and a data retention policy with periods (D3). The amended rule's compliance date was 2026-04-22.
- Vendor register with written assurances.
- Build the parent's controls: a gated "see what is stored" and "delete everything" for one device (`DELETE` across `ownership`, `parent_settings`, `time_ledger`), with a test that every table keyed by the device id is covered.
- Do not publish a notice that promises more than the code does. An overstated notice is its own risk; write it from section 1 after P1.

**P3. Consent method (only if D1 is B).** Choose one from FAQ I.4, build the direct notice (FAQ C.9) and the separate third-party consent.

**P4. Lawyer review, and whether to join an FTC-approved safe harbor program** (not researched here). Nothing in the product says "COPPA-compliant" before this closes.

**P5. Neighbouring rules (not researched here, except where noted).** UK Children's Code (a data protection impact assessment is its usual instrument); GDPR Article 8 age of consent, which varies by country; EU AI Act Article 50, which applies from 2026-08-02 with a reported grace period for machine-readable marking to 2026-12-02 (forge-ai-spec gap 9, from secondary sources); US state children's-privacy laws; the app stores' kids policies if the app is ever packaged (Apple's Kids Category, Google Play's Families policy). The browser speech-recognition vendor, if the mic stays.

## 4. What the entry may say

- Today: "ToyVentor is built for children, so every user is treated as one. It has no accounts, stores no wish text, and puts a consent screen and a grown-up check in front of the one route that sends a face (the optional Smart face, on for the adult-operated demo only). We have not completed a COPPA assessment: there is no privacy notice yet, and toy photos reach a hosted model without a grown-up check."
- After P2: add what is true then (the notice, the delete control).
- After P4 only: any claim of compliance. Never "certified", "approved" or "safe".

## 5. Not doing

- No age-screen question as a compliance answer. No math question as consent.
- No child accounts and no contact collection from children.
- No analytics or advertising SDKs in the child build.
- No chat (also the Forge spec's rule).
- No retroactive claims: nothing in this plan is described as done until a test or a signed document says so.

## 6. Open questions

- Is the product web-only, or also an app-store app? (workshop-print-gate-spec 7b asks the same.)
- Does the exception for internal operations survive a persistent id that also carries a free-text toy name? (Lawyer.)
- Where does Cloudflare keep logs, and for how long? (P1.)
- Does `THEME_SONG` send anything a child typed to Mureka? (P1.)

## 7. Sources

FTC, "Complying with COPPA: Frequently Asked Questions" (read to character 100,000 of 141,737; sections cited by FAQ number). Federal Register, COPPA Rule amendment, 2025-04-22 (effective 2025-06-23; compliance date 2026-04-22 except 16 CFR 312.11(d)(1), (d)(4), (g)): the search result only; the three new duties above (separate consent for third-party disclosure, written security program, written retention policy) come from law-firm summaries (Mondaq, DG Law), not the rule text. Read the rule before relying on them.
