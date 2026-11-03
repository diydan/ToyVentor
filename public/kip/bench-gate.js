// bench-gate.js: the grown-up check in front of every file a bench hands out (docs/specs/workshop-print-gate-spec.md, draft 1: phase 1, the pure core).
//
// NOT WIRED to anything yet: nothing imports this file. It is the part of the design that does not depend on any of the owner's decisions, built and tested first.
// It touches no browser globals, so vitest loads it. Two things are passed in:
//   cloud  the parent-gate client (createSelfieCloud in kip-selfie-cloud.js): challenge(signal) -> { status: 'ok', mode, a, b, challengeToken, cooldownUntil? } | { status },
//          verify({ challengeToken, answer, pin }, signal) -> { status: 'ok' } | { status: 'wrong', attemptsRemaining?, cooldown? } | { status }, hasProof() -> boolean.
//          The proof stays inside `cloud` (memory only, a few minutes): this file never sees a token.
//   ui     what draws the question: prompt({ kind, mode, a, b, error }) -> Promise<{ answer } | { pin } | null>  (null is Cancel), and close(), which must settle a
//          prompt that is still open with null (that is how `cancel()` reaches a question nobody has answered).
//
// Rules:
//   - A bench calls `ask(kind)` BEFORE it delivers a file. `kind` is a label for the wording only; it is never given to `cloud`.
//   - With a live proof there is no question (one right answer covers the next downloads for as long as the server's proof lives).
//   - One question at a time: a second `ask` while one is open gets the same answer.
//   - Fail closed: an unreachable gate, an unknown answer, or any exception denies. `ask` never rejects.

export const MAX_TRIES = 5;

/** What `ask` resolves to when the file may be delivered. */
const OK = Object.freeze({ ok: true });
const no = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * @param {{ cloud: object, ui: object, now?: () => number }} deps
 * @returns {{ ask(kind: string): Promise<{ ok: true } | { ok: false, reason: 'cancelled' | 'denied' | 'cooldown' | 'unavailable' }>, hasProof(): boolean, isPending(): boolean, pendingKind(): string | null, cancel(): void }}
 */
export function createDownloadGate({ cloud, ui, now = () => Date.now() }) {
  let pending = null; // Promise of the question now open
  let pendingKindName = null;
  let controller = null; // AbortController of that question

  async function run(kind, signal) {
    let challenge = null;
    let error = null;
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      if (signal.aborted) return no('cancelled');
      // One question serves several tries (a child may mistype); a new one is asked for when none is held. A PIN needs no question.
      if (!challenge) {
        const c = await cloud.challenge(signal);
        if (signal.aborted) return no('cancelled');
        if (!c || c.status !== 'ok') return no('unavailable', { status: c?.status ?? 'unavailable' });
        if (c.cooldownUntil && c.cooldownUntil > now()) return no('cooldown', { cooldownUntil: c.cooldownUntil });
        challenge = c;
      }
      const reply = await ui.prompt({ kind, mode: challenge.mode, a: challenge.a, b: challenge.b, error });
      if (signal.aborted || reply == null) return no('cancelled');
      const verdict = await cloud.verify({ challengeToken: challenge.challengeToken, answer: reply.answer, pin: reply.pin }, signal);
      if (signal.aborted) return no('cancelled');
      if (verdict?.status === 'ok') return OK;
      if (verdict?.status === 'wrong') {
        // The server is the one that counts tries and starts the cooldown: when it says none are left, stop asking.
        if (verdict.cooldown || verdict.attemptsRemaining === 0) return no('cooldown', { retryAfterSeconds: verdict.retryAfterSeconds });
        error = { attemptsRemaining: verdict.attemptsRemaining };
        continue;
      }
      return no('unavailable', { status: verdict?.status ?? 'unavailable' });
    }
    return no('denied');
  }

  const live = () => { try { return Boolean(cloud.hasProof()); } catch { return false; } }; // fail closed

  function ask(kind) {
    if (live()) return Promise.resolve(OK);
    if (pending) return pending;
    pendingKindName = String(kind ?? '');
    controller = new AbortController();
    const mine = controller;
    pending = (async () => {
      try {
        return await run(pendingKindName, mine.signal);
      } catch {
        return no(mine.signal.aborted ? 'cancelled' : 'unavailable'); // fail closed
      } finally {
        try { ui.close?.(); } catch { /* a modal that is already gone */ }
        if (controller === mine) { pending = null; pendingKindName = null; controller = null; }
      }
    })();
    return pending;
  }

  return {
    ask,
    hasProof: live,
    isPending: () => pending !== null,
    pendingKind: () => pendingKindName,
    /** Close an open question as Cancel (the shell is being destroyed, or the bench stood down). A no-op when nothing is open. */
    cancel() {
      if (controller) controller.abort();
      try { ui.close?.(); } catch { /* already gone */ }
    },
  };
}

/**
 * The same gate in the shape `mountPrintView` takes as `ctx.printGate`, so the print view can ask in-process, where there is no frame to post to.
 * `request(kind)` returns a PROMISE of 'granted' or 'denied' (the frame gate returns 'pending' and answers later by message); the view has to await it:
 * a six-line change in kip-print-view.js `download()`, not made yet (the file is in a commit). `handleMessage` never matches: no frame, no messages.
 */
export function createInProcessPrintGate(gate) {
  return {
    isEmbedded: () => false, // no `message` listener: answers arrive by promise
    isPending: () => gate.isPending(),
    pendingKind: () => gate.pendingKind(),
    request: async (kind) => ((await gate.ask(kind)).ok ? 'granted' : 'denied'),
    handleMessage: () => null,
    cancel: () => gate.cancel(),
  };
}
