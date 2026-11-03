# Workshop: the grown-up gate for file downloads (draft 1, 2026-11-03)

**Status: a design to review, nothing built.** Written to unblock one decision: the Workshop is in the game, but it is mounted with `downloads: false` (no Print group, no photo "Print it", no selfie sticker, no pop-out link; see `workshop-spec.md`, "4d scope"). This says how to turn downloads back on behind a grown-up check, and what the owner of the Grown-Ups sheet has to decide first.

## 1. The gap

The viewer already has a download gate, but it only works inside an iframe. `createPrintGate` (`kip-print-view.js`) posts `kip-request-print-gate` to `window.parent` and waits for a granted or denied message **from the parent frame**. A bench mounted in the game's top window is not framed, so `request()` answers `'granted'` at once: a print pack downloads with no grown-up check. The seam exists (`mountPrintView({ printGate })`, `createPrintHost({ printGate })`) but nothing forwards one, and the game has no host for the messages. (Read in the code: `kip-print-view.js` 61 to 118, 236 to 260, 966 to 973.)

## 2. What already exists (read, not guessed)

- **The game's gate.** `/api/parent/gate` issues a math question (2-digit by 1-digit) or asks for the PIN, and on success returns a `proofToken` with `expiresAt`: **2 minutes** in "every time" mode, **5 minutes** in "sitting" mode (`worker/parent.ts` 32 to 34, 546 to 550). PIN tries are limited with a cooldown. `src/lib/parentTime.ts` `requestGateChallenge` / `verifyGateAnswer` is the client, and it falls back to a **local** question when offline.
- **A second gate client already lives in the viewer.** `kip-selfie-cloud.js` `createSelfieCloud` has `challenge()`, `verify()`, `hasProof()` and keeps the proof in memory only. The selfie's "Smart face" shows the question inside the bench (`#sf-gate-*`), and `e2e:kip-selfie` checks that "a grown-up who passed the gate a moment ago is not quizzed twice". The PIN set in the app applies, because the client sends the app's `x-device-id`.
- **The Worker already has a helper for routes that need a grown-up** (`verifyParentProofFromRequest`: device-bound, fails closed with no D1 binding). It is for routes; the downloads below are built in the browser, so there is no route to protect (see section 5).
- **File exits in the benches** (every place a file leaves the page): the print view's `download(kind)` (`pack`, `project-3mf`, `3mf`, `stickers-pdf`, `stencils-stl`, `stl-zip`, `sheet`); the photo-print panel's `<a download>` links (the plate STL and the sticker, `kip-photo-print.js` 537 to 542); the selfie's `downloadSticker()` (a PNG and an SVG made from the child's photo). The Describe tab's blob is audio, not a file.

## 3. Proposed design (recommended: "A")

**One gate, owned by the shell, asked by every file exit.**

1. **`bench-gate.js` (new, pure core + one small modal).** `createDownloadGate({ cloud, ui })` returns `{ ask(kind) -> Promise<{ ok: true } | { ok: false, reason: 'denied' | 'cancelled' | 'unavailable' }>, hasProof() }`.
   - If `cloud.hasProof()`, `ask` resolves `ok` without a question (one correct answer covers the next downloads for 2 to 5 minutes, as the selfie does today).
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

## 7. Decisions the owner of the Grown-Ups sheet needs to make

1. **Who draws the question:** the shell's modal (recommended) or the Grown-Ups sheet (B).
2. **Which exits are gated:** all of them, including the selfie sticker (a file made from a child's photo, arguably the most sensitive). Recommended: all.
3. **Offline:** fail closed (recommended: the file leaving the device is the sensitive step) or fall back to a local question as the game's gate does.
4. **How long one answer lasts:** the server's 2 or 5 minutes (follows the parent's "every time" or "sitting" setting) or a fixed window.
5. **Scope:** gate only the Workshop (this document), or also close the `PrintDrawer` STL link and the standalone `/kip` pages so the bar is the same everywhere.
6. **Wording and languages:** the game speaks six languages elsewhere; the selfie gate's copy is English only today.
7. **Whether a parental gate is required for these downloads or a courtesy.** Not assessed here: that needs whoever signs off compliance.

## 8. Phases (rough estimate, not measured)

1. The pure gate core, the in-process mode of `createPrintGate`, unit tests: about half a day.
2. The modal, the print view hook, the `'gated'` shell option, the game e2e with the real gate: one to one and a half days.
3. The photo-print and selfie exits (they are other lanes' files: agree a window first): about half a day.
4. Switch the game to `'gated'`, copy and languages: about half a day.

## 9. What I did not verify

Whether the production D1 has the gate's tables (an earlier note says it self-creates them: may be stale), how the parent's "every time" versus "sitting" mode is chosen, that a local D1 in `vite dev` serves the gate for an e2e, and anything legal. The design above is built only from reading the files named in section 2.
