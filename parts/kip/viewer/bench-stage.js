// bench-stage.js: the one stage a host (the Workshop) gives its benches (Workshop stage 4b, docs/specs/workshop-spec.md).
//
// A bench mounted on its own (Kip-Demo.html, Truck-Mockup.html) builds its own renderer, camera and controls. A bench mounted
// with `env.stage = createStage(...)` is "hosted": it keeps its own Scene (lights, floor, models), draws into the stage's single
// renderer with the stage's single camera and controls, and does nothing while it is not the active bench. The stage owns
//   - the WebGL context (one for every bench, however many are mounted),
//   - the animation loop (one requestAnimationFrame; it calls `frame()` on the active bench only),
//   - the size (the box of `host`, not the window).
// Switching benches moves the stage's canvas into the new bench's #viewport and lets that bench apply its own look (tone
// exposure, camera range and pose, orbit limits). A bench that is switched away keeps its models, state and last camera pose.

/**
 * @param {{ THREE: any, OrbitControls: any, host: HTMLElement }} opts `host` is the element whose box the benches fill.
 */
export function createStage({ THREE, OrbitControls, host }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);

  // Everything a bench's look can set on the shared camera and controls (exposure aside): what `preserve` puts back.
  const CAMERA_KEYS = ['fov', 'near', 'far', 'zoom'];
  const CONTROL_KEYS = ['enableDamping', 'dampingFactor', 'enablePan', 'enableZoom', 'enableRotate', 'zoomSpeed', 'rotateSpeed', 'panSpeed', 'autoRotate', 'autoRotateSpeed',
    'minDistance', 'maxDistance', 'minPolarAngle', 'maxPolarAngle', 'minAzimuthAngle', 'maxAzimuthAngle', 'screenSpacePanning'];

  const benches = new Map();
  let activeId = null;
  let raf = 0;
  let disposed = false;

  /** The box a bench draws in, in CSS pixels (never zero: a hidden host would give a NaN aspect). */
  const size = () => ({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) });

  function resize() {
    const { width, height } = size();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(host);
  const onWindowResize = () => resize();
  if (!observer) window.addEventListener('resize', onWindowResize);

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const b = benches.get(activeId);
    if (b) b.frame();
  }

  const stage = {
    renderer, camera, controls, size, resize,
    /** The canvas the stage draws to; a bench puts it inside its own #viewport while it is active. */
    get canvas() { return renderer.domElement; },
    get activeId() { return activeId; },
    ids: () => [...benches.keys()],
    /** Register a mounted hosted bench under `id`. It must offer `frame()` and `setActive(on)`. */
    add(id, bench) {
      if (benches.has(id)) throw new Error(`stage already has a bench "${id}"`);
      benches.set(id, bench);
      return stage;
    },
    /** Forget a bench (it is being disposed); if it was active the stage is left with none. */
    remove(id) {
      if (activeId === id) activeId = null;
      benches.delete(id);
    },
    /** Make `id` the active bench: the previous one is told to stand down first, so the camera is never shared between two. */
    activate(id) {
      if (!benches.has(id)) throw new Error(`stage has no bench "${id}"`);
      if (id === activeId) return;
      benches.get(activeId)?.setActive(false);
      activeId = id;
      benches.get(id).setActive(true);
      resize();
    },
    /**
     * Run `fn` (a bench's mount function) and put back everything it did to the shared camera, controls and exposure. A bench applies its look when it
     * is constructed as well as when the stage activates it, so mounting a bench while another is active would otherwise move the ACTIVE bench's camera,
     * and that bench would then save the moved pose when it stands down: found 2026-11-03, the Yard came back from a Truck visit framed like the Truck.
     * Returns what `fn` returns; restores even if `fn` throws.
     */
    preserve(fn) {
      const keep = {
        pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone(), exposure: renderer.toneMappingExposure,
        camera: Object.fromEntries(CAMERA_KEYS.map((k) => [k, camera[k]])), controls: Object.fromEntries(CONTROL_KEYS.map((k) => [k, controls[k]])),
      };
      try {
        return fn();
      } finally {
        camera.position.copy(keep.pos);
        camera.quaternion.copy(keep.quat);
        Object.assign(camera, keep.camera);
        camera.updateProjectionMatrix();
        controls.target.copy(keep.target);
        Object.assign(controls, keep.controls);
        renderer.toneMappingExposure = keep.exposure;
      }
    },
    start() { if (!raf && !disposed) tick(); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    /** Free the stage: benches are the caller's to dispose first; this releases the renderer, controls and loop. */
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      benches.clear();
      activeId = null;
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
  return stage;
}
