import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import { createDownloadGate, createInProcessPrintGate, MAX_TRIES } from "../parts/kip/viewer/bench-gate.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The grown-up check in front of every file a bench hands out (docs/specs/workshop-print-gate-spec.md, phase 1: the pure core). Fakes stand in for the parent-gate
// client and the question UI, so every outcome the real ones can produce is a case here.

const QUESTION = { status: "ok", mode: "math", a: 14, b: 6, challengeToken: "tok-1", cooldownUntil: null };

function fakeCloud(over: { challenge?: () => any; verify?: (body: any, n: number) => any; hasProof?: () => boolean } = {}) {
  let proof = false;
  const calls = { challenge: 0, verify: [] as any[] };
  const cloud = {
    calls,
    setProof: (v: boolean) => { proof = v; },
    hasProof: over.hasProof ?? (() => proof),
    async challenge() {
      calls.challenge++;
      return over.challenge ? over.challenge() : QUESTION;
    },
    async verify(body: any) {
      calls.verify.push(body);
      const r = over.verify ? over.verify(body, calls.verify.length) : (body.answer === 84 ? { status: "ok" } : { status: "wrong", attemptsRemaining: MAX_TRIES - calls.verify.length });
      if (r.status === "ok") proof = true; // what the real client does: it keeps the proof
      return r;
    },
  };
  return cloud;
}

/** A question UI that answers from a script, or stays open (until close() settles it with null) when the script is empty. */
function fakeUi(replies: any[] = []) {
  const ui: any = { prompts: [] as any[], closed: 0, open: null as null | ((v: any) => void) };
  ui.prompt = (ctx: any) => {
    ui.prompts.push(ctx);
    if (replies.length) return Promise.resolve(replies.shift());
    return new Promise((res) => { ui.open = res; });
  };
  ui.close = () => { ui.closed++; ui.open?.(null); ui.open = null; };
  return ui;
}

describe("download gate: the happy paths", () => {
  it("asks nothing while a proof is live", async () => {
    const cloud = fakeCloud();
    cloud.setProof(true);
    const ui = fakeUi();
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("pack")).toEqual({ ok: true });
    expect(ui.prompts).toHaveLength(0);
    expect(cloud.calls.challenge).toBe(0);
    expect(gate.hasProof()).toBe(true);
  });

  it("asks the question, passes the right answer to the client, and then a second download is not quizzed again", async () => {
    const cloud = fakeCloud();
    const ui = fakeUi([{ answer: 84 }]);
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("stickers-pdf")).toEqual({ ok: true });
    expect(ui.prompts).toEqual([{ kind: "stickers-pdf", mode: "math", a: 14, b: 6, error: null }]);
    expect(cloud.calls.verify).toEqual([{ challengeToken: "tok-1", answer: 84, pin: undefined }]);
    expect(gate.hasProof()).toBe(true);
    expect(await gate.ask("3mf")).toEqual({ ok: true }); // inside the proof's life: no question
    expect(ui.prompts).toHaveLength(1);
    expect(gate.isPending()).toBe(false);
  });

  it("a PIN is passed as a PIN, and the question kind never reaches the client", async () => {
    const cloud = fakeCloud({ challenge: () => ({ ...QUESTION, mode: "pin" }), verify: (b) => (b.pin === "1234" ? { status: "ok" } : { status: "wrong" }) });
    const ui = fakeUi([{ pin: "1234" }]);
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("pack")).toEqual({ ok: true });
    expect(ui.prompts[0].mode).toBe("pin");
    expect(cloud.calls.verify[0]).toMatchObject({ pin: "1234" });
    expect(JSON.stringify([cloud.calls.verify, cloud.calls.challenge])).not.toContain("pack"); // the label is for the wording only
  });
});

describe("download gate: wrong answers, cooldown, and a gate that is not there", () => {
  it("a wrong answer asks again with the tries left, on the SAME question, and a right one then passes", async () => {
    const cloud = fakeCloud();
    const ui = fakeUi([{ answer: 1 }, { answer: 84 }]);
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("pack")).toEqual({ ok: true });
    expect(ui.prompts[0].error).toBeNull();
    expect(ui.prompts[1].error).toEqual({ attemptsRemaining: MAX_TRIES - 1 });
    expect(cloud.calls.challenge).toBe(1);
    expect(cloud.calls.verify.map((v) => v.challengeToken)).toEqual(["tok-1", "tok-1"]);
  });

  it(`stops asking after ${MAX_TRIES} wrong answers and denies`, async () => {
    const cloud = fakeCloud({ verify: () => ({ status: "wrong" }) });
    const ui = fakeUi(Array.from({ length: 10 }, () => ({ answer: 1 })));
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("pack")).toEqual({ ok: false, reason: "denied" });
    expect(ui.prompts).toHaveLength(MAX_TRIES);
    expect(gate.hasProof()).toBe(false);
  });

  it("when the server says the tries are used up it stops at once (the server owns the count and the cooldown)", async () => {
    const cloud = fakeCloud({ verify: () => ({ status: "wrong", attemptsRemaining: 0, retryAfterSeconds: 30 }) });
    const ui = fakeUi([{ pin: "0000" }, { pin: "1111" }]);
    const gate = createDownloadGate({ cloud, ui });
    expect(await gate.ask("pack")).toEqual({ ok: false, reason: "cooldown", retryAfterSeconds: 30 });
    expect(ui.prompts).toHaveLength(1);
  });

  it("a cooldown the challenge reports is honoured without showing a question", async () => {
    const cloud = fakeCloud({ challenge: () => ({ ...QUESTION, cooldownUntil: 5000 }) });
    const ui = fakeUi();
    const gate = createDownloadGate({ cloud, ui, now: () => 1000 });
    expect(await gate.ask("pack")).toEqual({ ok: false, reason: "cooldown", cooldownUntil: 5000 });
    expect(ui.prompts).toHaveLength(0);
    // and once the cooldown is over the question is asked
    const later = createDownloadGate({ cloud: fakeCloud({ challenge: () => ({ ...QUESTION, cooldownUntil: 5000 }) }), ui: fakeUi([{ answer: 84 }]), now: () => 6000 });
    expect(await later.ask("pack")).toEqual({ ok: true });
  });

  it("fails closed when the gate cannot be reached (offline, or switched off), at the question and at the answer", async () => {
    for (const status of ["offline", "disabled", "unavailable"]) {
      const ui = fakeUi();
      const gate = createDownloadGate({ cloud: fakeCloud({ challenge: () => ({ status }) }), ui });
      expect(await gate.ask("pack")).toEqual({ ok: false, reason: "unavailable", status });
      expect(ui.prompts).toHaveLength(0);
    }
    const gate = createDownloadGate({ cloud: fakeCloud({ verify: () => ({ status: "offline" }) }), ui: fakeUi([{ answer: 84 }]) });
    expect(await gate.ask("pack")).toEqual({ ok: false, reason: "unavailable", status: "offline" });
  });

  it("never rejects: an exception in the client or the proof check is a denial", async () => {
    const throwing = fakeCloud({ challenge: () => { throw new Error("boom"); } });
    const gate = createDownloadGate({ cloud: throwing, ui: fakeUi() });
    await expect(gate.ask("pack")).resolves.toEqual({ ok: false, reason: "unavailable" });
    const brokenProof = createDownloadGate({ cloud: fakeCloud({ hasProof: () => { throw new Error("no"); } }), ui: fakeUi([{ answer: 84 }]) });
    expect(brokenProof.hasProof()).toBe(false);
    await expect(brokenProof.ask("pack")).resolves.toMatchObject({ ok: expect.any(Boolean) }); // treated as "no proof": it asks
  });
});

describe("download gate: cancel, and one question at a time", () => {
  it("Cancel in the question is a cancelled download, and nothing is verified", async () => {
    const cloud = fakeCloud();
    const gate = createDownloadGate({ cloud, ui: fakeUi([null]) });
    expect(await gate.ask("pack")).toEqual({ ok: false, reason: "cancelled" });
    expect(cloud.calls.verify).toHaveLength(0);
    expect(gate.isPending()).toBe(false);
  });

  it("two downloads asked while a question is open share that one question and get the same answer", async () => {
    const cloud = fakeCloud();
    const ui = fakeUi(); // stays open until answered
    const gate = createDownloadGate({ cloud, ui });
    const first = gate.ask("pack");
    const second = gate.ask("stickers-pdf");
    expect(gate.isPending()).toBe(true);
    expect(gate.pendingKind()).toBe("pack"); // the first asker's label names it
    await Promise.resolve();
    await Promise.resolve();
    ui.open({ answer: 84 });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(ui.prompts).toHaveLength(1);
    expect(cloud.calls.challenge).toBe(1);
  });

  it("after a denial the next download asks again from the start", async () => {
    const cloud = fakeCloud();
    const ui = fakeUi([null, { answer: 84 }]);
    const gate = createDownloadGate({ cloud, ui });
    expect((await gate.ask("pack")).ok).toBe(false);
    expect((await gate.ask("pack")).ok).toBe(true);
    expect(ui.prompts).toHaveLength(2);
    expect(cloud.calls.challenge).toBe(2); // a fresh question after a cancelled one
  });

  it("cancel() closes a question nobody has answered: the download is cancelled, the UI is closed, nothing is left pending", async () => {
    const cloud = fakeCloud();
    const ui = fakeUi();
    const gate = createDownloadGate({ cloud, ui });
    const asked = gate.ask("pack");
    await Promise.resolve();
    await Promise.resolve();
    gate.cancel();
    expect(await asked).toEqual({ ok: false, reason: "cancelled" });
    expect(ui.closed).toBeGreaterThan(0);
    expect(gate.isPending()).toBe(false);
    expect(cloud.calls.verify).toHaveLength(0);
    gate.cancel(); // nothing open: a no-op
  });
});

describe("the same gate as a print-view gate", () => {
  it("answers with a promise of 'granted' or 'denied', never with a frame message", async () => {
    const granted = createInProcessPrintGate(createDownloadGate({ cloud: fakeCloud(), ui: fakeUi([{ answer: 84 }]) }));
    expect(granted.isEmbedded()).toBe(false);
    expect(granted.handleMessage({ type: "kip-print-gate-granted" }, { fromParent: true })).toBeNull();
    await expect(granted.request("pack")).resolves.toBe("granted");
    const denied = createInProcessPrintGate(createDownloadGate({ cloud: fakeCloud(), ui: fakeUi([null]) }));
    await expect(denied.request("pack")).resolves.toBe("denied");
  });

  it("reports the question that is open, and cancel() reaches it", async () => {
    const gate = createDownloadGate({ cloud: fakeCloud(), ui: fakeUi() });
    const printGate = createInProcessPrintGate(gate);
    const asked = printGate.request("3mf");
    await Promise.resolve();
    await Promise.resolve();
    expect(printGate.isPending()).toBe(true);
    expect(printGate.pendingKind()).toBe("3mf");
    printGate.cancel();
    await expect(asked).resolves.toBe("denied");
    expect(printGate.isPending()).toBe(false);
  });
});

describe("the core is pure", () => {
  it("is a plain module: no browser globals, no network, nothing imported", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "parts/kip/viewer/bench-gate.js"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/^\s*import\s/m);
    for (const word of ["window", "document", "fetch(", "localStorage", "sessionStorage", "navigator", "XMLHttpRequest", "postMessage"]) expect(code, word).not.toContain(word);
  });
});
