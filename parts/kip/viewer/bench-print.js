// bench-print.js: the one print view a host (the Workshop) gives its benches (Workshop stage 4c, docs/specs/workshop-spec.md).
//
// A bench mounted on its own (Kip-Demo.html, Truck-Mockup.html) mounts its own print view. In the Workshop every bench shares ONE: one printer
// profile in memory (before, a change made on the Kip tab never reached the Truck's view until a reload), one cache of loaded STLs, one plate
// view code path, and one Print group in the one menu. What differs per bench is only WHAT is printed and WHERE the plates are drawn, so a
// bench offers a print SOURCE (see mountPrintView in kip-print-view.js) and the view asks for the source of whichever bench the stage has active.
//
// `mountPrintView` is passed in (not imported) so this file loads in Node for the unit tests; the Workshop loads kip-print-view.js on demand.

/**
 * @param {{ mountPrintView: Function, THREE: any, stage: { camera: any, controls: any, activeId: string|null }, fetchBytes?: Function, printGate?: any }} opts
 * @returns {{ view: any, register(id: string, source: object): () => void, release(id: string): void, has(id: string): boolean, dispose(): void }}
 */
export function createPrintHost({ mountPrintView, THREE, stage, fetchBytes, printGate }) {
  const sources = new Map();
  const view = mountPrintView({
    THREE,
    camera: stage.camera,
    controls: stage.controls,
    fetchBytes,
    printGate,
    // The active bench's source, or none (the view then does nothing: a tab with no print, such as the Yard, has no Print group either).
    source: () => sources.get(stage.activeId) ?? null,
  });
  function release(id) {
    if (view.isOn() && view.sourceId() === id) view.exit();
  }
  return {
    view,
    /** A bench offers what it prints. Returns the function that withdraws it (the bench is being disposed). */
    register(id, source) {
      sources.set(id, { ...source, id });
      return () => {
        release(id);
        sources.delete(id);
      };
    },
    /** A bench stands down: if the plate view is open on ITS plates, close it (before the bench saves its camera, so the pose it saves is its own). */
    release,
    has: (id) => sources.has(id),
    dispose() {
      view.dispose();
      sources.clear();
    },
  };
}
