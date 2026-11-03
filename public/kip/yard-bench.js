// yard-bench.js: the Yard bench as a module (docs/specs/construction-vehicles-spec.md; Workshop contract in docs/specs/workshop-spec.md, stage 4b).
// The Workshop's third bench: construction vehicles built from the kit's own CAD. First vehicle: the double-drum road roller (two wide-track axles,
// four smooth drums). Same contract as the Kip and Truck benches: `mountYardBench(host, env)` returns { root, ready, dispose, frame, setActive, hosted };
// with `env.stage` it draws on the host's one renderer, otherwise it builds its own. Parts are the PartSpec STLs in assembly orientation
// (parts/kip/sync_yard_parts.py and sync_truck_parts.py), placed by yard-vehicles.js, which holds the numbers Gate G1 craft 10 proves.
//
// What is real and what is not: the solids, their positions and the rolling-without-slip drum spin are real. The speed comes from the Truck's
// hand-push model (truck-drive.js); there is no motor and the axles are fixed, so the roller pushes straight. Nothing in this bench has been printed.
import {
  THREE,
  OrbitControls,
  STLLoader,
  RoomEnvironment,
  mergeVertices,
  toCreasedNormals,
} from './vendor/three-kip.js';
import { disposeThreeScene } from '/kip/bench-lifecycle.js?v=10.0';
import { BLUEPRINT } from '/kip/bench-look.js?v=10.0';
import { driveParams, stepSpeed } from '/kip/truck-drive.js?v=10.0';
import { createMenuHost } from '/kip/kip-menu.js?v=10.0';
import { buildYardMenu } from './yard-menu.js';
import { AXLE_Y, AXLE_Z, AXLE_FLOAT_MM, DRUM, rollerParts, bom, partIds, spinAfter, clampFloat } from '/kip/yard-vehicles.js?v=10.0';

export const YARD_BENCH_CSS = `
:where(.yard-bench) {
  & {
    --ink: #e8f3ff;
    --muted: #a9c9f0;
    --line: rgba(214, 235, 255, 0.28);
    --glass: rgba(16, 47, 92, 0.78);
    --spark: #ff6b4a;
    --amber: #f5c518;
  }
  & * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  & {
    position: relative;
    contain: layout;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--ink);
    font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: ${BLUEPRINT.gradient};
  }
  & #viewport { position: absolute; inset: 0; }
  & #viewport canvas { display: block; width: 100%; height: 100%; }
  & .topbar { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 10px; align-items: flex-start; pointer-events: none; flex-wrap: wrap; }
  & .pill, & .hud-card { pointer-events: auto; background: var(--glass); border: 1px solid var(--line); border-radius: 14px; padding: 8px 12px; backdrop-filter: blur(6px); }
  & .pill { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  & .badge { font-weight: 750; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--amber); color: #102f5c; }
  & .title { font-weight: 750; }
  & .sub { color: var(--muted); }
  & .hud-card { min-width: 250px; max-width: 330px; }
  & .hud-card h3 { font-size: 13px; margin-bottom: 6px; } /* class-qualified: a host's heading reset (the game's Workshop overlay) must not undo it */
  & .bom { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; margin-bottom: 8px; }
  & .bom span:nth-child(even) { text-align: right; font-variant-numeric: tabular-nums; color: var(--amber); }
  & .note { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  & .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  & button { font: inherit; font-weight: 700; color: var(--ink); background: rgba(214, 235, 255, 0.12); border: 1px solid var(--line); border-radius: 10px; padding: 7px 12px; cursor: pointer; touch-action: none; }
  & button:hover { background: rgba(214, 235, 255, 0.22); }
  & button.held, & button:active { background: var(--spark); border-color: var(--spark); }
  /* The shared menu (kip-menu.js) is drawn in the light theme the Kip and the Truck use; this bench's own theme is dark, so the menu takes its colours back. */
  & .km, & .km-fab, & .km-backdrop { --ink: #1b2238; --muted: #5d657c; --line: rgba(27, 34, 56, 0.12); --glass: rgba(255, 255, 255, 0.88); }
  & .km button { color: var(--ink); background: rgba(255, 255, 255, 0.76); border: 1px solid var(--line); }
  & .km-fab { color: var(--ink); }
  & .km button:hover { background: #fff; }
  & .readout { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; margin-top: 6px; }
}
`;

export const YARD_BENCH_MARKUP = `
<div id="viewport"></div>
<div class="topbar">
  <div class="pill">
    <a id="yard-back" href="./Workshop.html" style="color:var(--ink);text-decoration:none;font-weight:750;padding:2px 8px;border-radius:999px;border:1px solid var(--line)">Workshop</a>
    <span class="badge">Yard</span>
    <span class="title">Road roller</span>
    <span class="sub" id="status-text">Loading verified CAD solids…</span>
  </div>
  <div class="hud-card">
    <h3>Double-drum road roller</h3>
    <div class="bom" id="yard-bom"></div>
    <div class="note">Hand-pushed, fixed axles, so it rolls straight. W / S push and pull, Space brakes, R goes back to the start. Nothing here has been printed yet.</div>
    <div class="row">
      <button id="btn-push" title="Hold to push forward (W)">Push</button>
      <button id="btn-back" title="Hold to pull back (S)">Back</button>
      <button id="btn-brake" title="Hold to brake (Space)">Brake</button>
      <button id="btn-home" title="Back to the start (R)">Home</button>
    </div>
    <div class="row"><button id="btn-float" title="Slide the front axle sideways by its float: the keel is only 24.8 mm wide at the nose">Front axle: centred</button></div>
    <div class="readout" id="yard-readout"></div>
  </div>
</div>
`;

const PART_NAMES = {
  kit_keel_base: 'Universal keel base',
  kit_windscreen: 'Windscreen',
  kit_barbell_shaft_wide: 'Wide-track axle, 103 mm',
  kit_drum_roller: 'Smooth road-roller drum',
};

/**
 * `env` (all optional): { stage, globals, embedded }. `embedded` (default: the page is in a frame) hides the bench's own "Workshop" link, which in a
 * Workshop shell would only reload the shell and lose every bench's state.
 */
export function mountYardBench(host, env = {}) {
  const globals = env.globals ?? window;
  const embedded = env.embedded ?? (window.self !== window.top);
  const stage = env.stage ?? null; // a host's shared renderer, camera and controls (bench-stage.js); null: this bench builds its own
  const hosted = stage !== null;

  const benchRoot = document.createElement('div');
  benchRoot.className = 'yard-bench';
  benchRoot.innerHTML = YARD_BENCH_MARKUP;
  host.append(benchRoot);
  let styleEl = document.getElementById('yard-bench-css');
  const ownsStyle = !styleEl;
  if (ownsStyle) {
    styleEl = document.createElement('style');
    styleEl.id = 'yard-bench-css';
    styleEl.textContent = YARD_BENCH_CSS;
    document.head.append(styleEl);
  }
  const $el = (id) => benchRoot.querySelector('#' + id);
  if (embedded) $el('yard-back').hidden = true;
  const offs = [];
  let active = !hosted; // a hosted bench draws and reads input only while the host has it active
  const listen = (target, type, fn, opts) => {
    const h = (e) => { if (active) fn(e); };
    target.addEventListener(type, h, opts);
    offs.push(() => target.removeEventListener(type, h, opts));
  };
  let raf = 0;
  let disposed = false;

  const viewport = $el('viewport');
  const renderer = hosted ? stage.renderer : new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!hosted) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewport.appendChild(renderer.domElement);
  }
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = hosted ? stage.camera : new THREE.PerspectiveCamera(36, (host.clientWidth || window.innerWidth) / (host.clientHeight || window.innerHeight), 1, 2000);
  const controls = hosted ? stage.controls : new OrbitControls(camera, renderer.domElement);
  // This bench's look on the (possibly shared) renderer, camera and controls: applied now, and again each time the stage activates the bench.
  const camPose = { position: new THREE.Vector3(-210, 165, 230), target: new THREE.Vector3(0, 38, 0) };
  function applyLook() {
    renderer.toneMappingExposure = 1.04;
    camera.fov = 36; camera.near = 1; camera.far = 2000;
    camera.position.copy(camPose.position);
    camera.updateProjectionMatrix();
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.copy(camPose.target);
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
  }
  applyLook();

  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xc8bfa8, 0.72));
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(-140, 240, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 40; sun.shadow.camera.far = 650;
  const d = 160;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d; sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({ opacity: BLUEPRINT.shadowOpacity }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // A big grid, one colour, snapped to the 12.5 mm cell so its lines stay put in the world while the roller moves across it.
  const grid = new THREE.GridHelper(1500, 120, BLUEPRINT.gridLine, BLUEPRINT.gridLine);
  grid.position.y = 0.05;
  grid.material.opacity = 0.55;
  grid.material.transparent = true;
  scene.add(grid);

  // PartSpec CAD frame (X right, -Y front, +Z up) -> three.js (X right, +Z front, +Y up), exactly as the Truck bench does.
  const vehicleWrap = new THREE.Group();
  scene.add(vehicleWrap);
  const cadRoot = new THREE.Group();
  cadRoot.rotation.x = -Math.PI / 2;
  // The axle sits 6.25 mm above the keel's bed face and a drum is O50, so the drums reach 18.75 mm below the keel: lift the vehicle until they stand on the ground.
  const RIDE = DRUM.radius - AXLE_Z;
  cadRoot.position.y = RIDE;
  vehicleWrap.add(cadRoot);

  const makeMat = (hex, rough = 0.38) => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: 0.06 });
  const MATS = {
    kit_keel_base: makeMat('#2E6FDB', 0.36),
    kit_windscreen: makeMat('#F4EFE6', 0.35),
    kit_barbell_shaft_wide: makeMat('#7A8291', 0.32),
    kit_drum_roller: makeMat('#F5C518', 0.34),
  };

  const parts = rollerParts();
  const GEOS = {};
  const loader = new STLLoader();
  const meshes = []; // { mesh, part }
  const axles = {};  // 'front' | 'rear' -> the Group that spins (and, for the front, slides)

  function build() {
    for (const axle of ['front', 'rear']) {
      const g = new THREE.Group();
      g.position.set(0, AXLE_Y[axle], AXLE_Z);
      cadRoot.add(g);
      axles[axle] = g;
    }
    for (const p of parts) {
      const mesh = new THREE.Mesh(GEOS[p.id], MATS[p.id]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.rotation.y = p.rotY;
      if (p.axle) {
        mesh.position.set(p.pos[0], 0, 0); // relative to the axle group (its y and z are the group's)
        axles[p.axle].add(mesh);
      } else {
        mesh.position.set(...p.pos);
        cadRoot.add(mesh);
      }
      meshes.push({ mesh, part: p });
    }
  }

  // ---- driving: the Truck's hand-push model, straight, with the drum's own radius ----
  const P = { ...driveParams({ stage: 'snap' }), wRad: DRUM.radius };
  const drive = { pz: 0, v: 0, spin: 0, frontFloat: 0, keys: new Set(), held: new Set() };
  let last = performance.now();
  const FLOATS = [0, -(AXLE_FLOAT_MM.front - 0.1), AXLE_FLOAT_MM.front - 0.1]; // centred, slid left, slid right (0.1 mm short of contact)
  let floatIdx = 0;

  function moveVehicle(distance) {
    drive.pz += distance;
    drive.spin += spinAfter(distance, DRUM.radius);
    vehicleWrap.position.z = drive.pz;
    camera.position.z += distance; // the camera travels with the roller, same view of it
    controls.target.z += distance;
    sun.position.z += distance;
    sun.target.position.z = drive.pz;
    ground.position.z = drive.pz;
    grid.position.z = Math.round(drive.pz / 12.5) * 12.5;
    for (const g of Object.values(axles)) g.rotation.x = drive.spin;
  }
  function throttleNow() {
    const k = (c) => drive.keys.has(c) || drive.held.has(c);
    return (k('push') ? 1 : 0) - (k('back') ? 1 : 0);
  }
  /** One step of the roller: the same code the frame loop runs, callable with an explicit input so a test is exact. */
  function stepDrive(dt, input = { throttle: throttleNow(), brake: drive.keys.has('brake') || drive.held.has('brake') }) {
    drive.v = stepSpeed(drive.v, input, P, dt);
    if (drive.v !== 0) moveVehicle(drive.v * dt);
    return drive.v;
  }
  function home() {
    const back = -drive.pz;
    drive.v = 0;
    moveVehicle(back);
    drive.spin = 0;
    for (const g of Object.values(axles)) g.rotation.x = 0;
  }
  function setFloat(idx) {
    floatIdx = ((idx % FLOATS.length) + FLOATS.length) % FLOATS.length;
    drive.frontFloat = clampFloat(FLOATS[floatIdx], 'front');
    if (axles.front) axles.front.position.x = drive.frontFloat;
    $el('btn-float').textContent = ['Front axle: centred', 'Front axle: slid left 14.2 mm', 'Front axle: slid right 14.2 mm'][floatIdx];
  }

  const KEYMAP = { KeyW: 'push', ArrowUp: 'push', KeyS: 'back', ArrowDown: 'back', Space: 'brake' };
  listen(window, 'keydown', (e) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'KeyR') { home(); return; }
    const k = KEYMAP[e.code];
    if (k) { drive.keys.add(k); e.preventDefault(); }
  });
  listen(window, 'keyup', (e) => { const k = KEYMAP[e.code]; if (k) drive.keys.delete(k); });
  // Touch and mouse: a held button is a held key.
  for (const [id, key] of [['btn-push', 'push'], ['btn-back', 'back'], ['btn-brake', 'brake']]) {
    const b = $el(id);
    // Capture keeps the hold when a finger slides off the button; it throws if the pointer has already ended (a very quick tap), which must not lose the press.
    const on = (e) => { drive.held.add(key); b.classList.add('held'); try { b.setPointerCapture?.(e.pointerId); } catch { /* no active pointer: nothing to capture */ } e.preventDefault(); };
    const off = () => { drive.held.delete(key); b.classList.remove('held'); };
    b.addEventListener('pointerdown', on);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, off);
    offs.push(() => { b.removeEventListener('pointerdown', on); for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.removeEventListener(t, off); });
  }
  const onHome = () => home();
  const onFloat = () => setFloat(floatIdx + 1);
  $el('btn-home').addEventListener('click', onHome);
  $el('btn-float').addEventListener('click', onFloat);
  offs.push(() => { $el('btn-home')?.removeEventListener('click', onHome); $el('btn-float')?.removeEventListener('click', onFloat); });

  function renderBom() {
    $el('yard-bom').innerHTML = bom(parts).map((r) => `<span>${PART_NAMES[r.id] ?? r.id}</span><span>x ${r.count}</span>`).join('');
  }
  function renderReadout() {
    const deg = Math.floor((((drive.spin * 180) / Math.PI) % 360 + 360) % 360);
    $el('yard-readout').textContent = `Speed ${Math.round(Math.abs(drive.v))} mm/s · drum ${deg}° · travelled ${Math.round(drive.pz)} mm`;
  }

  function resizeOwn() {
    if (hosted) return;
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (!hosted) listen(window, 'resize', resizeOwn);

  async function init() {
    await Promise.all(partIds(parts).map(async (id) => {
      const raw = await loader.loadAsync(`/kip/partspec/mockup/${id}.stl`);
      GEOS[id] = toCreasedNormals(mergeVertices(raw, 1e-4), THREE.MathUtils.degToRad(32));
    }));
    build();
    renderBom();
    setFloat(0);
    $el('status-text').textContent = `${parts.length} CAD solids loaded`;
    globals.__YARD_READY__ = true;
  }

  function animate() {
    if (disposed) return;
    if (!hosted) raf = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (meshes.length) stepDrive(dt);
    renderReadout();
    controls.update();
    renderer.render(scene, camera);
  }

  const ready = init();
  if (!hosted) animate(); // hosted: the stage's loop calls frame()

  // Test hooks (published on the host's globals, removed on dispose).
  const world = new THREE.Box3(), tmp = new THREE.Box3();
  globals.__yardProbe = () => {
    vehicleWrap.updateMatrixWorld(true);
    return meshes.map(({ mesh, part }) => {
      tmp.setFromObject(mesh);
      // The CAD frame (X right, -Y front, +Z up) is what the spec and Gate G1 use, so report in it, relative to the roller: the travel and the ride height are taken out.
      const pz = vehicleWrap.position.z;
      return { geo: part.id, role: part.role, axle: part.axle, rotY: mesh.rotation.y, min: [tmp.min.x, -(tmp.max.z - pz), tmp.min.y - RIDE], max: [tmp.max.x, -(tmp.min.z - pz), tmp.max.y - RIDE] };
    });
  };
  globals.__yardDrive = {
    pose: () => ({ pz: drive.pz, v: drive.v, spin: drive.spin, frontFloat: drive.frontFloat, axleSpin: Object.fromEntries(Object.entries(axles).map(([k, g]) => [k, g.rotation.x])) }),
    step: (dt, input) => stepDrive(dt, input),
    home,
    setFloat,
    bbox: () => { world.setFromObject(cadRoot); return { min: world.min.toArray(), max: world.max.toArray() }; }, // three.js world frame: min y is the ground contact
    held: () => [...drive.held, ...drive.keys],
    camera: () => camera.position.toArray(),
    target: () => controls.target.toArray(),
  };

  const PUBLISHED = ['__YARD_READY__', '__yardProbe', '__yardDrive', 'yardMenu'];
  function teardown() {
    if (sharedMenu) sharedMenu.hide('yard'); else menuHost.destroy();
    disposeThreeScene({ scene, renderer: hosted ? null : renderer, controls: hosted ? null : controls, pmrem });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const off of offs.splice(0)) off();
    teardown();
    for (const name of PUBLISHED) delete globals[name];
    if (hosted) {
      if (active) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
      if (benchRoot.contains(renderer.domElement)) renderer.domElement.remove(); // the shared canvas must outlive this bench's root
    }
    benchRoot.remove();
    if (ownsStyle) styleEl.remove();
  }
  /** One frame of this bench; the stage's loop calls it for the active bench only. */
  function frame() { if (active && !disposed) animate(); }
  /** The stage's switch: show or hide this bench; on the way in put the shared canvas under it and apply its look. */
  function setActive(on) {
    if (!hosted || disposed || on === active) return;
    active = on;
    benchRoot.hidden = !on;
    if (on) {
      viewport.appendChild(renderer.domElement);
      applyLook();
      last = performance.now();
      showMenu();
    } else {
      menuHost.hide('yard');
      drive.keys.clear(); // a key held when the bench is switched away must not keep pushing it
      drive.held.clear();
      drive.v = 0;        // and the roller is not left rolling for when it comes back
      camPose.position.copy(camera.position);
      camPose.target.copy(controls.target);
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
  }
  // The one menu (Workshop stage 4c): this bench declares a few settings (yard-menu.js) over the functions above; the hold-to-push pad stays on its card.
  // Hosted, the panel is the Workshop's (`env.sharedMenu`) and is shown while this bench is active; standalone, the bench has a host of its own.
  const yardMenuCtx = {
    title: 'Yard controls',
    fabLabel: '☰ Yard controls',
    groups: () => buildYardMenu({
      float: { get: () => String(floatIdx), set: (v) => setFloat(Number(v)) },
      home: () => home(),
      readout: () => $el('yard-readout')?.textContent ?? '',
    }),
    camera,
    viewSize: () => (hosted ? stage.size() : { width: window.innerWidth, height: window.innerHeight }),
    isActive: () => active,
    ready: () => globals.__YARD_READY__ === true,
  };
  const sharedMenu = env.sharedMenu ?? null;
  const menuHost = sharedMenu ?? createMenuHost();
  // The published handle is the panel's, except that `.ctx` stays THIS bench's even while another bench holds the shared panel.
  const showMenu = () => { globals.yardMenu = Object.create(menuHost.show('yard', yardMenuCtx, { root: benchRoot }), { ctx: { get: () => yardMenuCtx, enumerable: true } }); };
  if (!hosted) showMenu(); // hosted: setActive() shows it when this bench becomes the active one
  if (hosted) benchRoot.hidden = true; // a hosted bench starts hidden until the stage activates one
  return { root: benchRoot, ready, dispose, frame, setActive, hosted };
}
