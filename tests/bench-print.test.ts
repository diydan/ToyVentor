import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import { createPrintHost } from "../parts/kip/viewer/bench-print.js";
// @ts-expect-error untyped JS module
import { createKipSession } from "../parts/kip/viewer/kip-session.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The host shares ONE print view between benches (Workshop stage 4c). The view itself is exercised in the browser (e2e:workshop, e2e:truck-print);
// here a fake view stands in, so what is checked is the host's own job: which bench's source the view is asked for, and closing plates on stand-down.

function fakeMount() {
  const calls: any = { ctx: null, exits: 0, disposed: 0 };
  let on = false;
  let openOn: string | null = null;
  const view = {
    isOn: () => on,
    sourceId: () => openOn,
    open() { openOn = (calls.ctx.source() as any)?.id ?? null; on = true; }, // what enter() does: keep the source it opened with
    exit() { calls.exits++; on = false; openOn = null; },
    dispose() { calls.disposed++; },
  };
  const mountPrintView = (ctx: any) => { calls.ctx = ctx; return view; };
  return { mountPrintView, calls, view };
}

describe("shared print host", () => {
  it("mounts one view on the stage's camera and controls and asks it for the active bench's source", () => {
    const stage: any = { camera: { cam: 1 }, controls: { ctl: 1 }, activeId: null };
    const { mountPrintView, calls, view } = fakeMount();
    const host = createPrintHost({ mountPrintView, THREE: { t: 1 }, stage });
    expect(host.view).toBe(view);
    expect(calls.ctx.camera).toBe(stage.camera);
    expect(calls.ctx.controls).toBe(stage.controls);
    expect(calls.ctx.THREE).toEqual({ t: 1 });
    expect(calls.ctx.source()).toBeNull(); // no bench active: the view has nothing to print
    host.register("kip", { getState: () => "k" });
    host.register("truck", { getState: () => "t", getParts: () => [] });
    stage.activeId = "kip";
    expect(calls.ctx.source().id).toBe("kip");
    expect(calls.ctx.source().getState()).toBe("k");
    stage.activeId = "truck";
    expect(calls.ctx.source().id).toBe("truck");
    expect(typeof calls.ctx.source().getParts).toBe("function");
    stage.activeId = "yard";
    expect(calls.ctx.source()).toBeNull(); // a bench with no print (the Yard)
  });

  it("closes the plate view only when it is open on THAT bench's plates", () => {
    const stage: any = { camera: {}, controls: {}, activeId: "kip" };
    const { mountPrintView, view, calls } = fakeMount();
    const host = createPrintHost({ mountPrintView, THREE: {}, stage });
    host.register("kip", {});
    host.register("truck", {});
    view.open();
    expect(view.sourceId()).toBe("kip");
    host.release("truck");
    expect(view.isOn()).toBe(true);
    expect(calls.exits).toBe(0);
    host.release("kip");
    expect(view.isOn()).toBe(false);
    expect(calls.exits).toBe(1);
    host.release("kip"); // already closed: nothing to do
    expect(calls.exits).toBe(1);
  });

  it("withdrawing a bench's source closes its plates and forgets it; dispose frees the view", () => {
    const stage: any = { camera: {}, controls: {}, activeId: "truck" };
    const { mountPrintView, view, calls } = fakeMount();
    const host = createPrintHost({ mountPrintView, THREE: {}, stage });
    const off = host.register("truck", {});
    expect(host.has("truck")).toBe(true);
    view.open();
    off();
    expect(view.isOn()).toBe(false);
    expect(host.has("truck")).toBe(false);
    expect(calls.ctx.source()).toBeNull();
    host.dispose();
    expect(calls.disposed).toBe(1);
  });
});

describe("kip session print state (Workshop stage 4c)", () => {
  const make = () => createKipSession({ THREE: {}, STLLoader: class {}, mergeVertices: () => {}, toCreasedNormals: () => {}, createRig: () => ({ loadGeos: async () => ({}), mats: {}, loadSTL: () => {}, scadMesh: () => {}, STL_NAMES: [] }) });

  it("holds only a function: null until a Kip bench registers its print state, and null again when it withdraws", () => {
    const s = make();
    expect(s.printState()).toBeNull();
    const off = s.registerPrintState(() => ({ head: "fox" }));
    expect(s.printState()).toEqual({ head: "fox" });
    off();
    expect(s.printState()).toBeNull();
  });

  it("a stale withdraw does not remove a newer registration", () => {
    const s = make();
    const a = () => ({ n: 1 });
    const offA = s.registerPrintState(a);
    s.registerPrintState(() => ({ n: 2 }));
    offA();
    expect(s.printState()).toEqual({ n: 2 });
  });

  it("is cleared when the session is disposed", () => {
    const s = make();
    s.registerPrintState(() => ({ n: 1 }));
    s.dispose();
    expect(s.printState()).toBeNull();
  });
});
