// Shared teardown for the bench modules (kip-bench.js, truck-bench.js; Workshop stage 4a, docs/specs/workshop-spec.md).
// A bench owns a renderer, a scene and its listeners; `dispose()` on the bench must give all of it back so the host can
// unmount a bench and mount it again without a page reload (and, in 4b, hand the GL context to the next bench).

/** Free everything a three.js scene holds on the GPU, then the renderer and its canvas. Safe to call with partial input. */
export function disposeThreeScene({ scene, renderer, controls, pmrem } = {}) {
  controls?.dispose?.();
  scene?.traverse?.((o) => {
    o.geometry?.dispose?.();
    o.skeleton?.dispose?.();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose?.();
    }
  });
  scene?.environment?.dispose?.();
  pmrem?.dispose?.();
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement?.remove();
  }
}
