import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audio module keeps its AudioContext, music bus and motor at module level, so they outlive a world.
 * Before resetAudio(), dispose() closed the context but ctx() kept returning the closed one and the music bus stayed bound
 * to its dead nodes: a world mounted afterwards was silent until the page reloaded.
 */

/** A node that accepts any call, read or write, like the real graph does. */
function node(): any {
  const f: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    set: () => true,
  });
  return f;
}

class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  state: "suspended" | "running" | "closed" = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  constructor() {
    FakeAudioContext.made.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  createOscillator = () => node();
  createGain = () => node();
  createBiquadFilter = () => node();
  createConvolver = () => node();
  createBuffer = () => node();
  createBufferSource = () => node();
}

async function freshAudio() {
  vi.resetModules();
  return import("../src/features/game/world/runtime/audio");
}

beforeEach(() => {
  FakeAudioContext.made = [];
  vi.stubGlobal("window", { AudioContext: FakeAudioContext });
  vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("audio lifecycle across a world remount", () => {
  it("stays silent and builds nothing until the child has interacted", async () => {
    const a = await freshAudio();
    expect(a.ctx()).toBeNull();
    expect(FakeAudioContext.made).toHaveLength(0);
  });

  it("closes the context on reset and clears everything bound to it", async () => {
    const a = await freshAudio();
    a.noteGesture();
    const first = a.AC as unknown as FakeAudioContext;
    expect(first).toBeTruthy();
    expect(a.MUS.bus).toBeTruthy();
    a.MUS.on = true;

    a.resetAudio();
    expect(first.state).toBe("closed");
    expect(a.AC).toBeNull();
    expect(a.MOTOR).toBeNull();
    expect(a.MUS.bus).toBeNull();
    expect(a.MUS.on).toBe(false);
    expect(a.MUS.nb).toBeUndefined();
  });

  it("hands the next world a fresh, running context and rebuilds the music bus on it", async () => {
    const a = await freshAudio();
    a.noteGesture();
    const first = a.AC as unknown as FakeAudioContext;
    a.resetAudio();

    const next = a.ctx() as unknown as FakeAudioContext; // what a remounted world calls first
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    expect(next.state).toBe("running");

    a.musInit();
    expect(a.MUS.bus).toBeTruthy();
    expect(FakeAudioContext.made).toHaveLength(2);
    // Sound effects now land on the live context, not the closed one.
    expect(() => a.tone(440, 0, 0.1, "sine", 0.1)).not.toThrow();
  });

  it("keeps the child's sound preference and gesture across the reset", async () => {
    const a = await freshAudio();
    a.noteGesture();
    expect(a.toggleSound()).toBe(false); // muted
    a.resetAudio();
    expect(a.sound).toBe(false);
    expect(a.gestured).toBe(true);
  });

  it("is safe to call twice and before any audio exists", async () => {
    const a = await freshAudio();
    expect(() => a.resetAudio()).not.toThrow();
    a.noteGesture();
    expect(() => {
      a.resetAudio();
      a.resetAudio();
    }).not.toThrow();
  });
});
