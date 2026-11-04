# Workshop: the grown-up gate for file downloads (draft 2, 2026-11-03)

**Status (draft 2): phases 1 to 3 built, committed and tested; the game is still mounted with `downloads: false` and phase 4 plus the per-gate switchboard are deferred until after the hackathon (7c).** Built: the pure core and the dialog, the print-view hook, the shell's `downloads: 'gated'` mode, and the selfie sticker's question (one shared proof with Smart face); `scripts/e2e-workshop-gate.mjs` runs the real shell with only the gate API stubbed (33 checks; a mutation that ignores the verdict fails three). Written to unblock one decision: the Workshop is in the game, but it is mounted with `downloads: false` (no Print group, no photo "Print it", no selfie sticker, no pop-out link; see `workshop-spec.md`, "4d scope"). This says how to turn downloads back on behind a grown-up check, and what the owner of the Grown-Ups sheet has to decide first.

## 1. The gap

The viewer already has a download gate, but it only works inside an iframe. `createPrintGate` (`kip-print-view.js`) posts `kip-request-print-gate` to `window.parent` and waits for a granted or denied message **from the parent frame**. A bench mounted in the game's top window is not framed, so `request()` answers `'granted'` at once: a print pack downloads with no grown-up check. The seam exists (`mountPrintView({ printGate })`, `createPrintHost({ printGate })`) but nothing forwards one, and the game has no host for the messages. (Read in the code: `kip-print-view.js` 61 to 118, 236 to 260, 966 to 973.)

## 2. What already exists (read, not guessed)

- **The game's gate.** `/api/parent/gate` issues a math question (2-digit by 1-digit) or asks for the PIN, and on success returns a `proofToken` with `expiresAt`: **5 minutes** in "every time" mode, **10 minutes** in "sitting" mode (`worker/parent.ts` 32 to 36; were 2 and 5 until 2026-11-04, Dan). PIN tries are limited with a cooldown. `src/lib/parentTime.ts` `requestGateChallenge` / `verifyGateAnswer` is the client, and it falls back to a **local** question when offline.
- **A second gate client already lives in the viewer.** `kip-selfie-cloud.js` `createSelfieCloud` has `challenge()`, `verify()`, `hasProof()` and keeps the proof in memory only. The selfie's "Smart face" shows the question inside the bench (`#sf-gate-*`), and `e2e:kip-selfie` checks that "a grown-up who passed the gate a moment ago is not quizzed twice". The PIN set in the app applies, because the client sends the app's `x-device-id`.
- **The Worker already has a helper for routes that need a grown-up** (`verifyParentProofFromRequest`: device-bound, fails closed with no D1 binding). It is for routes; the downloads below are built in the browser, so there is no route to protect (see section 5).
- **File exits in the benches** (every place a file leaves the page): the print view's `download(kind)` (`pack`, `project-3mf`, `3mf`, `stickers-pdf`, `stencils-stl`, `stl-zip`, `sheet`); the photo-print panel's `<a download>` links (the plate STL and the sticker, `kip-photo-print.js` 537 to 542); the selfie's `downloadSticker()` (a PNG and an SVG made from the child's photo). The Describe tab's blob is audio, not a file.

## 3. Proposed design (recommended: "A")

**One gate, owned by the shell, asked by every file exit.**

1. **`bench-gate.js` (new, pure core + one small modal).** `createDownloadGate({ cloud, ui })` returns `{ ask(kind) -> Promise<{ ok: true } | { ok: false, reason: 'denied' | 'cancelled' | 'unavailable' }>, hasProof() }`.
   - If `cloud.hasProof()`, `ask` resolves `ok` without a question (one correct answer covers the next downloads for 5 to 10 minutes, as the selfie does today).
   - Otherwise it opens the modal: the question or the PIN field, calm error text, a cooldown message, Cancel. One question at a time: a second `ask` while one is open shares its promise.
   - `cloud` is a `createSelfieCloud` instance (reuse, do not write a third client). `kind` is a label for the copy only and is never sent anywhere.
2. **Shell option `downloads: true | false | 'gated'`** (today a boolean). `'gated'` makes the shell create the gate once (one proof for every bench) and pass it as `env.downloadGate`. A bench with `downloads` truthy shows its file exits; with a gate it must `await gate.ask(kind)` before delivering.
3. **How each exit asks:**
   - *Print view:* give `createPrintGate` an in-process mode, `createPrintGate({ ask })`: `request(kind)` returns `'pending'`, runs `ask(kind)`, and tells the view through `gate.onAnswer(fn)` (the view already has the grant and deny handling in `onGateMessage`; this feeds it without a `postMessage`). The frame mode stays as it is.
   - *Photo-print links:* build the `<a download>` only after a grant (a button that asks, then creates and clicks the link).
   - *Selfie sticker:* `await gate.ask('sticker')` at the top of `downloadSticker()`.
4. **The game launcher** passes `downloads: 'gated'` instead of `false` once the owner signs off. Nothing else in `src/` changes.

Why this and not the Grown-Ups sheet (option B): the viewer already has the client, the modal pattern and the PIN behaviour; a shell-owned gate needs no change to `GrownUpsSheet.tsx` (a large file other lanes edit) and keeps the Workshop usable as a standalone module.

## 4. Alternatives considered

- **B. Ask through the game's Grown-Ups sheet** (a callback from the shell into React). One UI everywhere and "Forgot PIN?" works, but the sheet would need an "approve one action" mode, and the shell would depend on the game. Choose this if the owner wants one look and one set of PIN screens.
- **C. No downloads in the game; print from the standalone page.** Simplest, but that page is also a top-level, ungated page.
- **D. Make files on the server so the Worker can refuse.** Real enforcement, but the 3MF, STL and sticker files are built in the browser from public assets; moving that to a server is a different project.

## 5. What this does and does not protect (the owner should read this)

It is a **speed bump in the browser**, not a lock. The files are built client-side from static, public STLs and anyone with developer tools can call the download functions. That is also how the rest of the product works today: the game's `PrintDrawer` offers `/parts-stl/<file>` as a plain download link, and I found no gate in `PrintDrawer.tsx` or `ToyCustomizer.tsx` (not checked higher up), and `/kip/Kip-Demo.html` is a public page. So this closes the Workshop's *new* exits (the multi-part pack, project 3MF and the photo-derived sticker) to a young child, and does not change the others. Whether that is the intended bar is a question for the owner (section 7, item 5).

## 6. Failure modes and tests

- **Offline or the endpoint answers 501:** `cloud.challenge()` returns `unavailable` and the gate denies (fail closed), with one calm sentence. The game's own gate falls back to a local question offline; see decision 3.
- **Wrong answer, PIN cooldown, proof expiry mid-session, Cancel, a second request while one is open:** each is a case in the pure core's unit tests with a fake `cloud` and a fake clock.
- **Every exit refuses without proof:** wiring tests in the style of `tests/truck-menu.test.ts` (the benches call `ask` before delivering), plus a browser check that with `downloads: 'gated'` no file URL is created until a correct answer (instrument `URL.createObjectURL`).
- **Game e2e** (extends `scripts/e2e-game-workshop.mjs`): click a download, see the question, answer wrong (no file), answer right (one file), ask again inside the window (no question), expire the proof with `clearProof()` (question again). This needs the real Worker's gate with a local D1, which the game's `vite dev` (Cloudflare plugin) should provide: **not verified**.

## 7. Decisions (Dan, 2026-11-03)

1. **Who draws the question: the shell's modal (A).** Decided. Built.
2. **Which exits: all of them stay OFF for now, and the Grown-Ups settings get one switch per gate.** Decided in principle; the switchboard is designed in section 7a and waits on two small confirmations. The game stays mounted with `downloads: false` until then.
3. **Offline: not supported.** Decided: the gate fails closed (built); there is no local-question fallback.
4. **How long one answer lasts: the server's window** (5 minutes for "every time", 10 for "sitting"; 2 and 5 until 2026-11-04, Dan). Decided. Built.
5. **Scope: open.** Recommendation in 7a: every file exit a child can reach from the game, not only the in-game Workshop.
6. **Wording and languages: English first** (the copy is one replaceable object). Decided.
7. **Whether a parental gate is required or a courtesy: open, not assessed.** Needs whoever signs off compliance; the questions to ask them are in 7b.

### 7a. The per-gate switchboard and the exits a child can reach today (read in the code, 2026-11-03)

File exits a child can reach from the game, and what stands in front of each:

| Exit | Where | In front of it today |
|---|---|---|
| Workshop print files (plates, projects, sticker sheets, stencils) | in-game Workshop | off (`downloads: false`); gated when switched on |
| Selfie sticker | Workshop, Kip tab | off; gated when switched on |
| Photo "Print it" | Workshop, Kip tab | off; its own real grown-up proof before anything is made |
| Make-from-words files | Workshop, Kip tab | off; the server's file route needs a proof |
| **"Build it for real"** | Garage sheet, shown after a mission is done: a link that opens the standalone Kip page in a new tab (`GarageSheet.tsx`, `kipUrl`) | **nothing: the standalone page has no gate (its gate only engages inside a frame), so the Print group and the sticker hand files out** |
| **"Download <part> STL"** | Toy Box print drawer: a plain `<a href="/parts-stl/..." download>` (`PrintDrawer.tsx`) | **nothing** (catalog part files, not a child's picture) |
| "Kip 3D Rig" | More menu, only while Demo Mode is on (a grown-up's switch) | the standalone page, ungated; acceptable for a grown-up-run showcase |

Proposed switchboard (Grown-Ups sheet): one row per gate, each Off by default, and when on it still asks a grown-up through the shell's question: **Workshop print files; Selfie sticker; Photo plate; Toy Box part files (STL); "Build it for real" link.** The standalone pages themselves stay ungated maker tools: they are not linked to children unless a grown-up switches the link on. The grown-up-checks-off switch (`parent-controls-off-spec.md`) opens every gate for a demo.

Two details to confirm: (i) a gate that is switched on still asks the question each time the proof has lapsed (recommended), or has a third "allow without asking" state (not recommended for the sticker, a child's face); (ii) the switches live on this device only (recommended for v1: no Worker or D1 change; a child on another device gets nothing, since the default is Off) or sync with the other parental settings (needs `shared/parent-time.ts` and the Worker's settings validation).

### 7b. What to ask whoever signs off compliance

Is the product directed to children under 13 (COPPA) or to EU/UK children (GDPR Art. 8, UK Children's Code)? Is it distributed only as a website, or also through an app store (Apple's Kids Category and Google Play's Families policy have their own parental-gate rules)? Do files made from a child's own photo count as personal data leaving the device when they are only saved to it, or only when they are uploaded (the uploads already need a grown-up proof and consent)? The design above defaults to the safest reading: nothing leaves without a grown-up.

### 7c. Deferred until after the hackathon (Dan, 2026-11-03)

Nothing in 7 and 7a blocks the hackathon. What stands: the game is mounted `downloads: false`; the photo uploads (selfie cloud, photo outline, room scan) need a real grown-up proof and a consent screen; the gate for the Workshop's exports, the selfie sticker and the shell dialog is built and tested but not switched on; a showcase can open everything with the grown-up-checks-off switch (`parent-controls-off-spec.md`), with a grown-up presenting and no real child's photo on the build. The two child-reachable exits in 7a ("Build it for real" and the Toy Box STL link) are unchanged from before this work, and Dan decided to leave them as they are until after the hackathon: no flag to hide them, no limits added in the meantime.

Idea for the interim: terms accepted by a grown-up on first use. A first-use notice helps (it records that a grown-up accepted the terms, which version and when, and sets expectations about files and photos) but it does NOT replace the proof and consent in front of the photo uploads, a parental gate where a store requires one, or verifiable parental consent where the law asks for it, and a tap on "I agree" proves nothing about who tapped. Whether it is enough is the compliance question in 7b, and the terms text needs whoever signs off, not a draft from this lane.

Resume after the hackathon, in this order: (1) ask 7b; (2) the first-use grown-up screen (the existing hold and question, then the terms, stored on this device with a version); (3) the per-gate switchboard (7a); (4) phase 4, switch the game to `'gated'`.

## 8. Phases (rough estimate, not measured)

1. **Built.** The pure gate core, the in-process mode of `createPrintGate`, unit tests: `bench-gate.js` (16 tests).
2. **Built.** The modal (`bench-gate-ui.js`, 8 tests, its own e2e), the print view hook (`kip-print-view.js` `download()` waits for the gate's promise and fails closed; a second click while a question is open does nothing; closing the view mid-question delivers nothing) and the `'gated'` shell option (`workshop.js`: builds the gate and dialog, hands the print host its in-process form, cancels an open question and forgets the proof on `destroy()`, hides "Open on its own page"). `scripts/e2e-workshop-gate.mjs` runs the real shell with only `/api/parent/gate` stubbed; a mutation that ignores the verdict fails three of its checks. Under `'gated'` the Kip bench keeps the Print group and hides the photo "Print it", the selfie sticker and the Make-from-words files until phase 3.
3. **Built (selfie sticker).** The shell hands each bench `askGrownUp` and the one `cloud` (`features.askGrownUp`, `features.cloud`); `kip-selfie.js` asks before it saves the sticker and shares the proof with Smart face. The photo "Print it" is left as it is: its own flow needs a real grown-up proof before the photo leaves the device and before any file exists (it is offered under `'gated'`). Make-from-words files stay hidden under `'gated'` (the server's file route already needs a proof).
4. Switch the game to `'gated'` (`WorkshopLauncher`: today `downloads` is false, or true only while the grown-up checks are switched off, see `parent-controls-off-spec.md`), copy and languages: about half a day.

## 9. What I did not verify

Whether the production D1 has the gate's tables (an earlier note says it self-creates them: may be stale), how the parent's "every time" versus "sitting" mode is chosen, that a local D1 in `vite dev` serves the gate for an e2e, and anything legal. The design above is built only from reading the files named in section 2.
