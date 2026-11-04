import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain browser module (no types)
import { HOLD_MS, MAX_MS, MIN_MS, SAY, WAV_RATE, baseType, createVoiceInput, encodeWav, mixToMono, pickMime, recordingToWav, resample } from "../parts/kip/viewer/kip-describe-voice.js";

// The microphone button's controller, with the browser's pieces stood in (a fake button, a fake MediaRecorder, a fake microphone, a manual clock). The same behaviour is checked in a
// real browser with Chrome's fake microphone by parts/kip/viewer/tools/e2e_describe.mjs section [7]; this file holds the state machine and the wiring.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

class El {
  tag: string; attrs: Record<string, string> = {}; hidden = false; disabled = false; textContent = ""; className = ""; removed = false;
  listeners: Record<string, Array<(e: any) => void>> = {};
  classes = new Set<string>();
  classList = { toggle: (c: string, on: boolean) => { if (on) this.classes.add(c); else this.classes.delete(c); } };
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === "hidden") this.hidden = true; if (k === "class") this.className = v; }
  append(...k: unknown[]) { if (typeof k[0] === "string") this.textContent = k[0]; }
  remove() { this.removed = true; }
  addEventListener(t: string, f: (e: any) => void) { (this.listeners[t] ??= []).push(f); }
  fire(t: string, e: Record<string, unknown> = {}) { (this.listeners[t] ?? []).forEach((f) => f({ button: 0, detail: 1, ...e })); }
}
const fakeDoc = { createElement: (t: string) => new El(t) };

class FakeRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static made: FakeRecorder[] = [];
  static isTypeSupported(m: string) { return FakeRecorder.supported.has(m); }
  mimeType: string; state = "inactive"; handlers: Record<string, Array<(e: any) => void>> = {}; bytes = 4000; stopThrows = false;
  constructor(public stream: unknown, opts?: { mimeType?: string }) { this.mimeType = opts?.mimeType ?? "audio/webm"; FakeRecorder.made.push(this); }
  addEventListener(t: string, f: (e: any) => void) { (this.handlers[t] ??= []).push(f); }
  start() { this.state = "recording"; }
  stop() {
    if (this.stopThrows) throw new Error("InvalidStateError");
    this.state = "inactive";
    queueMicrotask(() => { (this.handlers.dataavailable ?? []).forEach((f) => f({ data: new Blob([new Uint8Array(this.bytes)], { type: this.mimeType }) })); (this.handlers.stop ?? []).forEach((f) => f({})); });
  }
}

function setup(opts: { enabled?: boolean | "throws"; reply?: { status: number; body?: unknown } | "throws"; mic?: "ok" | "denied" | "none" | "other"; text?: () => string; withRecorder?: boolean; toWav?: (b: Blob) => Promise<Blob> } = {}) {
  FakeRecorder.made = [];
  FakeRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  const t = { now: 1000, timers: [] as Array<{ fn: () => void; ms: number; id: number; live: boolean }> };
  const calls: Array<{ url: string; method: string; type: string | null; body: Blob | null }> = [];
  const streams: Array<{ tracks: Array<{ stopped: boolean; stop(): void }>; getTracks(): any[] }> = [];
  const gum: unknown[] = [];
  const words: string[] = [], status: string[] = [], states: string[] = [];
  let release: ((s: unknown) => void) | null = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, type: (init?.headers as Record<string, string> | undefined)?.["content-type"] ?? null, body: (init?.body as Blob | undefined) ?? null });
    if (method === "GET") {
      if (opts.enabled === "throws") throw new Error("offline");
      return new Response(JSON.stringify({ ok: true, enabled: opts.enabled !== false }), { status: opts.enabled === false ? 503 : 200 });
    }
    if (opts.reply === "throws") throw new Error("network");
    const r = opts.reply ?? { status: 200, body: { text: "a pink skateboard" } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  const newStream = () => { const tracks = [{ stopped: false, stop() { this.stopped = true; } }, { stopped: false, stop() { this.stopped = true; } }]; const s = { tracks, getTracks: () => tracks }; streams.push(s); return s; };
  const getUserMedia = (c: unknown) => {
    gum.push(c);
    if (opts.mic === "denied") return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    if (opts.mic === "none") return Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" }));
    if (opts.mic === "other") return Promise.reject(new Error("weird"));
    return new Promise((res) => { const s = newStream(); release = () => res(s); if (!(opts as { hold?: boolean }).hold) res(s); });
  };
  const voice = createVoiceInput({
    doc: fakeDoc, fetchImpl, url: "/api/transcribe", getUserMedia, MediaRecorderClass: opts.withRecorder === false ? undefined : FakeRecorder,
    now: () => t.now, ...(opts.toWav ? { toWav: opts.toWav } : {}),
    setTimeout: (fn: () => void, ms: number) => { const id = t.timers.length + 1; t.timers.push({ fn, ms, id, live: true }); return id; },
    clearTimeout: (id: number) => { const x = t.timers.find((q) => q.id === id); if (x) x.live = false; },
    onText: (w: string) => words.push(w), onStatus: (s: string) => status.push(s), onState: (s: string) => states.push(s), currentText: opts.text ?? (() => ""),
  });
  const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  return { voice, calls, streams, gum, words, status, states, t, tick, release: () => release?.(streams.at(-1) ?? newStream()), node: voice.node as El };
}
const press = (s: ReturnType<typeof setup>) => s.node.fire("pointerdown");
const letGo = (s: ReturnType<typeof setup>) => s.node.fire("pointerup");
const posts = (s: ReturnType<typeof setup>) => s.calls.filter((c) => c.method === "POST");

describe("the button shows only when the route says it can listen, and asks for nothing before a press", () => {
  it("is hidden until the free probe says enabled, then shown and idle", async () => {
    const s = setup();
    expect(s.node.hidden).toBe(true);
    expect(s.voice.state).toBe("hidden");
    expect(await s.voice.probe()).toBe(true);
    expect(s.node.hidden).toBe(false);
    expect(s.voice.state).toBe("idle");
    expect(s.node.textContent).toBe("🎤");
    expect(s.node.attrs["aria-label"]).toBe("Say what to build");
  });
  it("stays hidden when the route is off, errors, or the browser cannot record", async () => {
    for (const o of [{ enabled: false as const }, { enabled: "throws" as const }, { withRecorder: false }]) {
      const s = setup(o);
      expect(await s.voice.probe(), JSON.stringify(o)).toBe(false);
      expect(s.node.hidden).toBe(true);
      expect(s.voice.state).toBe("hidden");
    }
  });
  it("asks once: the answer is remembered", async () => {
    const s = setup();
    await s.voice.probe(); await s.voice.probe(); await s.voice.probe();
    expect(s.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
  it("never asks for the microphone, and never records, until a press", async () => {
    const s = setup();
    await s.voice.probe();
    await s.tick();
    expect(s.gum).toHaveLength(0);
    expect(FakeRecorder.made).toHaveLength(0);
    expect(posts(s)).toHaveLength(0);
  });
  it("does nothing when pressed while hidden", async () => {
    const s = setup({ enabled: false });
    await s.voice.probe();
    press(s); await s.tick();
    expect(s.gum).toHaveLength(0);
  });
});

describe("a tap listens, a second tap sends what was said", () => {
  it("asks for the microphone once, listens, and on the second tap uploads one recording to the app's own route with its type", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    expect(s.gum).toEqual([{ audio: true }]);
    expect(s.voice.state).toBe("listening");
    expect(s.node.attrs["aria-pressed"]).toBe("true");
    expect(s.node.attrs["aria-label"]).toBe("Stop listening");
    expect(s.node.classes.has("kdb-mic-on")).toBe(true);
    expect(s.status.at(-1)).toBe(SAY.listening);
    expect(FakeRecorder.made[0]!.mimeType).toBe("audio/webm;codecs=opus");
    letGo(s);                       // a quick tap: the finger came up at once, so it keeps listening
    expect(s.voice.state).toBe("listening");
    s.t.now += 2000;                // the child speaks
    press(s);                       // the second tap
    expect(s.voice.state).toBe("thinking");
    await s.tick();
    const p = posts(s);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ url: "/api/transcribe", method: "POST", type: "audio/webm" });
    expect(p[0]!.body!.size).toBe(4000);
    expect(s.words).toEqual(["a pink skateboard"]);
    expect(s.status.at(-1)).toBe(SAY.heard("a pink skateboard"));
    expect(s.voice.state).toBe("idle");
    expect(s.node.attrs["aria-pressed"]).toBe("false");
  });
  it("stops every microphone track when the recording ends", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    s.t.now += 2000;
    press(s); await s.tick();
    expect(s.streams).toHaveLength(1);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
  });
  it("never builds: the words go to the text box callback only, and nothing but the one upload is sent", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick();
    expect(s.calls.map((c) => c.url)).toEqual(["/api/transcribe", "/api/transcribe"]); // the probe and the upload, nowhere else
  });
  it("a press held past the hold time stops when let go (hold to talk); a quicker one does not", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    s.t.now += HOLD_MS - 50; letGo(s);
    expect(s.voice.state).toBe("listening");
    s.voice.cancel();                         // (a quick press only started it; it was still listening)
    const h = setup();
    await h.voice.probe();
    press(h); await h.tick();
    h.t.now += HOLD_MS + 1500; letGo(h);
    expect(h.voice.state).toBe("thinking");
    await h.tick();
    expect(posts(h)).toHaveLength(1);
    expect(h.words).toEqual(["a pink skateboard"]);
  });
  it("stops by itself after the limit (8 seconds) and sends what it has", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    const limit = s.t.timers.find((x) => x.live && x.ms === MAX_MS);
    expect(MAX_MS).toBe(8000);
    expect(limit).toBeTruthy();
    s.t.now += MAX_MS; limit!.fn();
    await s.tick();
    expect(posts(s)).toHaveLength(1);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
  });
  it("a slip of the finger (shorter than half a second) sends nothing, frees the microphone and says so", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    s.t.now += MIN_MS - 100; press(s); await s.tick();
    expect(posts(s)).toHaveLength(0);
    expect(s.status.at(-1)).toBe(SAY.tooShort);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
    expect(s.voice.state).toBe("idle");
  });
  it("the keyboard toggles it through click with no pointer (detail 0), and a pointer's own click is ignored", async () => {
    const s = setup();
    await s.voice.probe();
    s.node.fire("click", { detail: 1 });
    await s.tick();
    expect(s.gum).toHaveLength(0);
    s.node.fire("click", { detail: 0 }); await s.tick();
    expect(s.voice.state).toBe("listening");
    s.t.now += 1500; s.node.fire("click", { detail: 0 }); await s.tick();
    expect(posts(s)).toHaveLength(1);
  });
  it("uses the recording format the browser can make, and says it can make none of ours by letting the browser choose", async () => {
    expect(pickMime((m: string) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickMime(() => false)).toBe("");
    expect(pickMime(() => { throw new Error("odd"); })).toBe("");
    expect(baseType("audio/webm;codecs=opus")).toBe("audio/webm");
    const s = setup();
    FakeRecorder.supported = new Set(["audio/mp4"]);
    await s.voice.probe();
    press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick();
    expect(posts(s)[0]!.type).toBe("audio/mp4");
  });
});

describe("what the child is told when something goes wrong, and the microphone is always freed", () => {
  it("a refused permission or no microphone: a kind line, no recording, back to idle", async () => {
    for (const [mic, line] of [["denied", SAY.denied], ["none", SAY.noMic], ["other", SAY.failed]] as const) {
      const s = setup({ mic });
      await s.voice.probe();
      press(s); await s.tick();
      expect(s.status.at(-1), mic).toBe(line);
      expect(s.voice.state, mic).toBe("idle");
      expect(FakeRecorder.made).toHaveLength(0);
    }
  });
  it("a press cancelled while the browser is still asking frees the microphone the moment it arrives, and never records", async () => {
    const s = setup({ hold: true } as never);
    await s.voice.probe();
    press(s);                    // the browser is asking
    expect(s.voice.state).toBe("asking");
    s.voice.cancel();
    s.release(); await s.tick();
    expect(FakeRecorder.made).toHaveLength(0);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
    expect(s.voice.state).toBe("idle");
  });
  it("a hold let go while the browser was asking stops as soon as it starts listening (too short to send)", async () => {
    const s = setup({ hold: true } as never);
    await s.voice.probe();
    press(s);
    s.t.now += HOLD_MS + 100; letGo(s);
    s.release(); await s.tick();
    expect(s.voice.state).toBe("idle");
    expect(posts(s)).toHaveLength(0);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
  });
  it("a failed upload (an error, a network failure) says so and frees everything", async () => {
    for (const reply of [{ status: 502, body: { error: "x" } }, "throws"] as const) {
      const s = setup({ reply });
      await s.voice.probe();
      press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick();
      expect(s.status.at(-1)).toBe(SAY.failed);
      expect(s.words).toEqual([]);
      expect(s.voice.state).toBe("idle");
      expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
    }
  });
  it("a route that turns itself off (503) hides the button; a rate limit (429) asks for a moment", async () => {
    const off = setup({ reply: { status: 503 } });
    await off.voice.probe();
    press(off); await off.tick(); off.t.now += 2000; press(off); await off.tick();
    expect(off.voice.state).toBe("hidden");
    expect(off.node.hidden).toBe(true);
    const slow = setup({ reply: { status: 429 } });
    await slow.voice.probe();
    press(slow); await slow.tick(); slow.t.now += 2000; press(slow); await slow.tick();
    expect(slow.status.at(-1)).toBe(SAY.busy);
    expect(slow.voice.state).toBe("idle");
  });
  it("words withheld by the route (an empty text and a note) show the note, not an empty box", async () => {
    const s = setup({ reply: { status: 200, body: { text: "", note: "I could not use that. Try saying it a different way!" } } });
    await s.voice.probe();
    press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick();
    expect(s.words).toEqual([]);
    expect(s.status.at(-1)).toBe("I could not use that. Try saying it a different way!");
    const bare = setup({ reply: { status: 200, body: { text: "  " } } });
    await bare.voice.probe();
    press(bare); await bare.tick(); bare.t.now += 2000; press(bare); await bare.tick();
    expect(bare.status.at(-1)).toBe(SAY.failed);
  });
  it("leaves what the child typed while it was listening alone, and says what it heard", async () => {
    let box = "";
    const s = setup({ text: () => box });
    await s.voice.probe();
    press(s); await s.tick();
    box = "a green truck";           // the child typed meanwhile
    s.t.now += 2000; press(s); await s.tick();
    expect(s.words).toEqual([]);
    expect(s.status.at(-1)).toBe(SAY.heardKept("a pink skateboard"));
  });
  it("cancel (the panel closed, Build pressed) sends nothing and frees the microphone; an answer already on its way is dropped", async () => {
    const a = setup();
    await a.voice.probe();
    press(a); await a.tick();
    a.voice.cancel(); await a.tick();
    expect(posts(a)).toHaveLength(0);
    expect(a.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
    expect(a.voice.state).toBe("idle");
    const b = setup();
    await b.voice.probe();
    press(b); await b.tick(); b.t.now += 2000; press(b);
    b.voice.cancel();                         // while the upload is being made
    await b.tick();
    expect(b.words).toEqual([]);
  });
  it("a recorder that fails to stop is handled: back to idle, microphone freed", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    FakeRecorder.made[0]!.stopThrows = true;
    s.t.now += 2000; press(s); await s.tick();
    expect(s.voice.state).toBe("idle");
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
  });
  it("dispose cancels and removes the button", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick();
    s.voice.dispose();
    expect(s.node.removed).toBe(true);
    expect(s.streams[0]!.tracks.every((x) => x.stopped)).toBe(true);
  });
  it("a second press while thinking does nothing", async () => {
    const s = setup();
    await s.voice.probe();
    press(s); await s.tick(); s.t.now += 2000; press(s);
    press(s); press(s);
    await s.tick();
    expect(posts(s)).toHaveLength(1);
    expect(s.gum).toHaveLength(1);
  });
});

describe("the module and its wiring", () => {
  const voice = read("parts/kip/viewer/kip-describe-voice.js");
  const tab = read("parts/kip/viewer/kip-describe-tab.js");
  it("keeps the audio and the words nowhere: no storage of any kind, no other address than the app's own route", () => {
    expect(voice).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/);
    expect(voice).not.toMatch(/mureka|api\.meta|whisper|authorization|api[_-]?key/i);
    expect(voice).toContain("url = '/api/transcribe'");
  });
  it("is mounted in the tab beside the text box, probed when the panel opens, thrown away on Build and on close, and torn down on dispose", () => {
    expect(tab).toMatch(/import \{ createVoiceInput \} from '\.\/kip-describe-voice\.js'/);
    expect(tab).toContain("transcribeUrl = '/api/transcribe'");
    expect(tab).toMatch(/const inputRow = el\('div', \{ class: 'kdb-inputrow' \}, text, \.\.\.\(voice \? \[voice\.node\] : \[\]\)\)/);
    expect(tab).toContain("voice?.probe().catch(");
    expect(tab).toMatch(/busy = true; go\.disabled = true;\s*voice\?\.cancel\(\);/);
    expect(tab).toMatch(/stopVoice\(\); theme\?\.silence\(\); voice\?\.cancel\(\);/);
    expect(tab).toContain("voice?.dispose()");
  });
  it("puts the words in the text box and NEVER builds from them", () => {
    const wiring = tab.slice(tab.indexOf("const voice = transcribeUrl"), tab.indexOf("const inputRow"));
    expect(wiring).toContain("onText: (words) => { text.value = words.slice(0, 300); text.focus(); }");
    expect(wiring).not.toMatch(/build\(|go\.click|requestSubmit/);
  });
  it("is shipped: the Kip build copies it, the sync list and the brand scan name it, and the public copies are identical", () => {
    expect(read("scripts/build-kip.ts")).toContain('"viewer/kip-describe-voice.js"');
    expect(read("parts/kip/viewer/tools/sync_public.mjs")).toContain("'kip-describe-voice.js'");
    expect(read("tests/kip.test.ts")).toContain('"parts/kip/viewer/kip-describe-voice.js"');
    for (const f of ["kip-describe-voice.js", "kip-describe-tab.js", "kip-describe-view.js"]) {
      expect(readFileSync(join(root, "public/kip", f)), f).toEqual(readFileSync(join(root, "parts/kip/viewer", f)));
    }
  });
  it("the harness turns it on only with ?transcribe=", () => {
    const harness = read("parts/kip/viewer/tools/describe-harness.html");
    expect(harness).toContain("transcribeUrl: q.get('transcribe') ?? ''");
  });
  it("has the buttons a small hand can press: 48 px round, labelled, and pulsing only when motion is allowed", () => {
    expect(tab).toMatch(/\.kdb-panel button\.kdb-mic \{[^}]*width: 48px; height: 48px;/);
    expect(tab).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.kdb-panel button\.kdb-mic-on \{ animation: none; \} \}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The recording is converted in the page to a 16 kHz mono 16-bit WAV: the one format the route's speech models take, and one a Worker cannot make from webm or mp4.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const wavHeader = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  const v = new DataView(bytes.buffer);
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  return { riff: tag(0), wave: tag(8), fmt: tag(12), format: v.getUint16(20, true), channels: v.getUint16(22, true), rate: v.getUint32(24, true), bits: v.getUint16(34, true), data: tag(36), dataBytes: v.getUint32(40, true), size: bytes.length, v };
};

describe("the WAV pieces", () => {
  it("encodeWav writes a RIFF/WAVE header for ONE channel of 16-bit integer PCM at 16 kHz, and the samples scaled and clipped", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
    const h = await wavHeader(new Blob([wav]));
    expect(h).toMatchObject({ riff: "RIFF", wave: "WAVE", fmt: "fmt ", format: 1, channels: 1, rate: WAV_RATE, bits: 16, data: "data", dataBytes: 14, size: 44 + 14 });
    expect(WAV_RATE).toBe(16000);
    const at = (i: number) => h.v.getInt16(44 + i * 2, true);
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768]); // 2 and -2 are clipped, not wrapped
    expect(h.v.getUint32(4, true)).toBe(36 + 14);   // the RIFF size
    expect(h.v.getUint32(28, true)).toBe(WAV_RATE * 2); // byte rate
  });
  it("mixToMono averages channels and leaves a mono one alone", () => {
    const mono = new Float32Array([0.1, 0.2]);
    expect(mixToMono([mono])).toBe(mono);
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
  it("resample keeps the length in proportion, the ends, and does nothing at the same rate", () => {
    const ramp = Float32Array.from({ length: 480 }, (_, i) => i / 479);
    expect(resample(ramp, 16000, 16000)).toBe(ramp);
    const down = resample(ramp, 48000, 16000);
    expect(down.length).toBe(160);
    expect(down[0]).toBeCloseTo(0, 6);
    expect(down[159]!).toBeGreaterThan(0.98);
    for (let i = 1; i < down.length; i++) expect(down[i]!).toBeGreaterThanOrEqual(down[i - 1]!); // still a ramp: no ringing
  });
});

describe("recordingToWav (the decoder is the browser's, stood in here)", () => {
  /** An OfflineAudioContext that "decodes" whatever it is given into a stereo 48 kHz buffer of `seconds`. */
  const decoder = (seconds: number, rate = 48000, answer: "promise" | "callback" = "promise") =>
    class {
      static made: Array<[number, number, number]> = [];
      constructor(channels: number, length: number, sampleRate: number) { (this.constructor as any).made.push([channels, length, sampleRate]); }
      decodeAudioData(_data: ArrayBuffer, ok?: (b: unknown) => void) {
        const n = Math.round(seconds * rate);
        const buf = { numberOfChannels: 2, sampleRate: rate, getChannelData: (c: number) => Float32Array.from({ length: n }, (_, i) => (c === 0 ? 0.5 : -0.5) * Math.sin(i / 50)) };
        if (answer === "callback") { ok?.(buf); return undefined; }
        return Promise.resolve(buf);
      }
    };
  it("turns a decoded stereo 48 kHz recording into a 16 kHz mono WAV Blob of the same length", async () => {
    const Ctx = decoder(2);
    const wav = await recordingToWav(new Blob([new Uint8Array(50)], { type: "audio/webm" }), { OfflineAudioContextClass: Ctx as any });
    expect(wav.type).toBe("audio/wav");
    const h = await wavHeader(wav);
    expect(h).toMatchObject({ riff: "RIFF", channels: 1, rate: 16000, bits: 16, format: 1, dataBytes: 2 * 16000 * 2 });
    expect(Ctx.made).toEqual([[1, 1, 16000]]); // asks the decoder for 16 kHz, so a browser that obeys never needs resampling
  });
  it("works with a browser that answers by callback only (older Safari)", async () => {
    const wav = await recordingToWav(new Blob([new Uint8Array(50)]), { OfflineAudioContextClass: decoder(1, 16000, "callback") as any });
    expect((await wavHeader(wav)).dataBytes).toBe(16000 * 2);
  });
  it("cuts a long recording at 10 seconds (the route refuses more)", async () => {
    const wav = await recordingToWav(new Blob([new Uint8Array(50)]), { OfflineAudioContextClass: decoder(15) as any });
    expect((await wavHeader(wav)).dataBytes).toBe(10 * 16000 * 2);
  });
  it("throws when there is no decoder or it cannot read the recording, so the caller can send the original", async () => {
    await expect(recordingToWav(new Blob([new Uint8Array(5)]), { OfflineAudioContextClass: undefined as any })).rejects.toThrow(/decoder/);
    const Broken = class { constructor() {} decodeAudioData() { return Promise.reject(new Error("EncodingError")); } };
    await expect(recordingToWav(new Blob([new Uint8Array(5)]), { OfflineAudioContextClass: Broken as any })).rejects.toThrow(/Encoding/);
  });
});

describe("the upload uses the converted WAV", () => {
  const speak = async (s: ReturnType<typeof setup>) => { await s.voice.probe(); press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick(); };
  it("sends the WAV, typed audio/wav, instead of the recording, once", async () => {
    const wav = new Blob([new Uint8Array(32044)], { type: "audio/wav" });
    const s = setup({ toWav: async () => wav });
    await speak(s);
    expect(posts(s)).toHaveLength(1);
    expect(posts(s)[0]).toMatchObject({ type: "audio/wav" });
    expect(posts(s)[0]!.body).toBe(wav);
    expect(s.words).toEqual(["a pink skateboard"]);
  });
  it("sends what was recorded, with its own type, when the browser cannot convert it", async () => {
    const s = setup({ toWav: async () => { throw new Error("no audio decoder"); } });
    await speak(s);
    expect(posts(s)[0]).toMatchObject({ type: "audio/webm" });
    expect(posts(s)[0]!.body!.size).toBe(4000);
    expect(s.words).toEqual(["a pink skateboard"]);
  });
  it("sends nothing when the child cancels while it is being converted, and still frees the microphone", async () => {
    let finish: (b: Blob) => void = () => undefined;
    const s = setup({ toWav: () => new Promise<Blob>((r) => { finish = r; }) });
    await s.voice.probe(); press(s); await s.tick(); s.t.now += 2000; press(s); await s.tick();
    expect(s.voice.state).toBe("thinking");
    s.voice.cancel();
    finish(new Blob([new Uint8Array(100)], { type: "audio/wav" }));
    await s.tick();
    expect(posts(s)).toHaveLength(0);
    expect(s.streams.every((x) => x.tracks.every((t) => t.stopped))).toBe(true);
  });
});
