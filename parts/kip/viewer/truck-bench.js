// truck-bench.js: the Truck bench as a module (Workshop stage 4a, docs/specs/workshop-spec.md).
// Moved here from Truck-Mockup.html (its markup, style and script) in one step; this file is now the source, edit it here. The page is a loader.
// The function body is not re-indented on purpose, so `git diff --color-moved` against the old page stays readable.
import {
  THREE,
  OrbitControls,
  STLLoader,
  RoomEnvironment,
  mergeVertices,
  toCreasedNormals,
} from './vendor/three-kip.js';
import { createKipSession } from '/kip/kip-session.js?v=10.0'; // one loaded Kip rig, shared with kip-bench.js (Workshop stage 4b-3)
import { createDecalExpressionCanvas, createTorsoOutfitDecalCanvas } from '/kip/kip-forge-sdk.js?v=10.0';
import { mountPrintView } from '/kip/kip-print-view.js?v=10.0';
import { createMenuHost } from '/kip/kip-menu.js?v=10.0';
import { truckGetParts, truckDriverPrintState, partsSignature, truckStickerSources } from './truck-print-parts.js';
import { buildTruckMenu, TRUCK_STAGES, TRUCK_CAMERAS } from './truck-menu.js';
import { SKIN_TONES, WARDROBE_HEADS, HUMAN_HEAD_IDS, HAIR_OPTIONS, HAT_OPTIONS, HAT_COLORS, FACE_STEM_MM } from '/kip/kip-vehicles-wardrobe.js?v=10.0';
import { FACEPLATE_SEAT_MM } from '/kip/kip-faceplate-shape.js?v=10.0';
import { disposeThreeScene } from '/kip/bench-lifecycle.js?v=10.0';
import { BLUEPRINT } from '/kip/bench-look.js?v=10.0';
import { driveParams, stepSpeed, stepSteer, yawRate, advancePose } from '/kip/truck-drive.js?v=10.0';

export const TRUCK_BENCH_CSS = `
:where(.truck-bench) {
  & {
    --ink: #1b2238;
    --muted: #5d657c;
    --spark: #ff6b4a;
    --mint: #1fa97c;
    --cobalt: #2e6fdb;
    --amber: #f5c518;
    --cyan: #0096d6;
    --glass: rgba(255, 255, 255, 0.88);
    --line: rgba(27, 34, 56, 0.12);
  }
  & * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  & {
    position: relative;
    contain: layout; /* position: fixed UI sits in this box, not the window: the bench works inside a host's area */
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    /* Blueprint ground (bench-look.js, shared with the Kip bench): the canvas is transparent and this shows through it. */
    background: ${BLUEPRINT.gradient};
    color: var(--ink);
  }
  #viewport { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; outline: none; }

  .topbar {
    position: fixed;
    top: 14px;
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    pointer-events: none;
    z-index: 10;
  }
  .pill {
    pointer-events: auto;
    background: var(--glass);
    backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 9px 14px;
    box-shadow: 0 8px 24px rgba(27, 34, 56, 0.08);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .badge {
    background: var(--spark);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .title { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: var(--muted); font-weight: 600; }
  .sub b { color: var(--ink); }

  .hud-card {
    pointer-events: auto;
    background: var(--glass);
    backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 10px 14px;
    box-shadow: 0 8px 24px rgba(27, 34, 56, 0.08);
    font-size: 11.5px;
    line-height: 1.5;
    max-width: 340px;
  }
  .hud-card h3 {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cobalt);
    margin-bottom: 3px;
  }
  .hud-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    color: var(--muted);
    font-weight: 600;
  }
  .hud-grid span:nth-child(even) { color: var(--ink); font-weight: 700; text-align: right; }

  /* The controls are the shared menu (kip-menu.js, declared in truck-menu.js); it needs the same base button and select look the Kip bench gives it. */
  button {
    appearance: none;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.76);
    color: var(--ink);
    font-family: inherit;
    font-size: 11.8px;
    font-weight: 650;
    padding: 5px 9.5px;
    border-radius: 9px;
    cursor: pointer;
    transition: all 0.12s ease;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  button:hover {
    background: #fff;
    border-color: rgba(27, 34, 56, 0.25);
  }
  button.spark-active {
    background: var(--spark);
    color: #fff;
    border-color: var(--spark);
  }
  select {
    appearance: none;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink);
    font-family: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 10px;
    border-radius: 9px;
    cursor: pointer;
  }

  .drive-hud {
    position: fixed;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 12;
    max-width: calc(100vw - 28px);
    background: var(--glass);
    backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 8px 14px;
    box-shadow: 0 8px 24px rgba(27, 34, 56, 0.16);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.55;
    text-align: center;
    color: var(--ink);
    pointer-events: none;
  }
  .drive-hud[hidden] { display: none; }
  .drive-hud kbd {
    display: inline-block;
    min-width: 20px;
    padding: 0 5px;
    margin: 0 1px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 11px;
    font-weight: 800;
  }
  .drive-hud b { color: var(--cobalt); }
}
`;

export const TRUCK_BENCH_MARKUP = `
<div id="viewport"></div>

<div class="topbar">
  <div class="pill">
    <a href="./Kip-Demo.html" style="text-decoration:none;color:var(--ink);font-size:12px;font-weight:750;padding:4px 9px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,0.8);">← Kip Viewer</a>
    <span class="badge" id="stage-badge">Stage 1 · Snap 3+</span>
    <span class="title">Modular Dump Truck Progression Mockup</span>
    <span class="sub" id="status-text">Loading verified CAD solids…</span>
  </div>

  <div class="hud-card">
    <h3 id="hud-title">1 · Snap (3+) Utility Dump Truck</h3>
    <div class="hud-grid">
      <span>Cards Used</span><span id="hud-cards">Card A + Card B + Card E1</span>
      <span>Hull / Wheelbase</span><span>49.8×124.8 mm · 100.0 mm (8 TU)</span>
      <span>Steering</span><span id="hud-steer">Fixed Bottom-Click Barbell (0° Play)</span>
      <span>Power / PTO</span><span id="hud-power">Push-Along · Z_axle = 6.25 mm</span>
      <span>Dump Bed</span><span id="hud-bed">Trunnion Hinge Scow · Z = 12.5 mm</span>
      <span>Ackermann Angles</span><span id="hud-ackermann">L 0.0° · R 0.0°</span>
      <span>Rack Travel</span><span id="hud-rack">dx: 0.00 mm (max ±5.20)</span>
      <span>COTS / Ghost</span><span id="hud-illus">—</span>
      <span>Gate G1 Check</span><span id="hud-g1" style="color:#1fa97c;" title="Verified in toyventor_kitcard.py verify_gate_g1() and probe sweep.">0.000 mm³ overlap (G1 pass)</span>
    </div>
  </div>
</div>

<div id="drive-hud" class="drive-hud" hidden>
  <div><kbd>W</kbd><kbd>S</kbd> speed · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> brake · <kbd>Q</kbd><kbd>E</kbd> tip the bed · <kbd>R</kbd> start · <kbd>G</kbd> stop driving</div>
  <div><b id="drive-mode">Pushed by hand</b> · <span id="drive-speed">0.00 m/s</span> · steer <span id="drive-steer">fixed axle</span><span id="drive-note"></span></div>
</div>

`;

/**
 * Mount the bench into `host` (an element the caller owns). Everything below the signature is the body of the old
 * page script, moved here unchanged except for the host seams listed in docs/specs/workshop-spec.md (stage 4a):
 * lookups go through `$el` / `benchRoot` instead of `document`, listeners through `listen` (so dispose can remove them),
 * the URL through `getSearch` / `getHash` / `replaceHash`, published handles through `globals`.
 * `env` (all optional): { getSearch, getHash, replaceHash, embedded, globals }.
 * Returns { root, ready, dispose }; `ready` settles when the first load is done.
 */
export function mountTruckBench(host, env = {}) {
const getSearch = env.getSearch ?? (() => location.search);
const getHash = env.getHash ?? (() => location.hash);
const replaceHash = env.replaceHash ?? ((h) => history.replaceState(null, '', h));
const embedded = env.embedded ?? (window.self !== window.top);
const globals = env.globals ?? window;

const benchRoot = document.createElement('div');
benchRoot.className = 'truck-bench';
benchRoot.innerHTML = TRUCK_BENCH_MARKUP;
host.append(benchRoot);
let styleEl = document.getElementById('truck-bench-css');
const ownsStyle = !styleEl;
if (ownsStyle) {
  styleEl = document.createElement('style');
  styleEl.id = 'truck-bench-css';
  styleEl.textContent = TRUCK_BENCH_CSS;
  document.head.append(styleEl);
}
const $el = (id) => benchRoot.querySelector('#' + id);
const offs = [];
const stage = env.stage ?? null; // a host's shared renderer, camera and controls (Workshop stage 4b, bench-stage.js); null: this bench builds its own
const hosted = stage !== null;
const kipSession = env.sharedKip ?? createKipSession({ THREE, STLLoader, mergeVertices, toCreasedNormals });
const sharedKip = !!env.sharedKip;
kipSession.acquire('truck');
let truckLoaded = false;
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
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewport.appendChild(renderer.domElement);
}

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = hosted ? stage.camera : new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 1, 2000);
const controls = hosted ? stage.controls : new OrbitControls(camera, renderer.domElement);
// This bench's look on the (possibly shared) renderer, camera and controls. Standalone it runs once, now; hosted it runs again each time
// the stage activates the bench, from the pose the bench was left in (camPose is saved when it stands down).
const camPose = { position: new THREE.Vector3(-165, 118, 178), target: new THREE.Vector3(0, 36, 0) };
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

const hemi = new THREE.HemisphereLight(0xfffaf0, 0xc8bfa8, 0.72);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.45);
sun.position.set(-140, 240, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 40;
sun.shadow.camera.far = 650;
const d = 140;
sun.shadow.camera.left = -d;
sun.shadow.camera.right = d;
sun.shadow.camera.top = d;
sun.shadow.camera.bottom = -d;
sun.shadow.bias = -0.0004;
scene.add(sun);

const groundGeo = new THREE.PlaneGeometry(900, 900);
const groundMat = new THREE.ShadowMaterial({ opacity: BLUEPRINT.shadowOpacity });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 12.5 mm TU Grid on tabletop, drawn as blueprint lines (light cyan-white on the blue ground).
const grid = new THREE.GridHelper(300, 24, BLUEPRINT.gridCentre, BLUEPRINT.gridLine);
grid.position.y = 0.05;
grid.material.opacity = 0.55;
grid.material.transparent = true;
scene.add(grid);

// Drive mode (below): a large grid that follows the truck, snapped to the 12.5 mm cell so its lines stay put in the world, one colour so no
// bright centre cross travels with the truck; the floor shadow and the sun follow it too, or the shadows would leave the lit area.
const driveGrid = new THREE.GridHelper(1500, 120, BLUEPRINT.gridLine, BLUEPRINT.gridLine);
driveGrid.position.y = 0.05;
driveGrid.material.opacity = 0.55;
driveGrid.material.transparent = true;
driveGrid.visible = false;
scene.add(driveGrid);
scene.add(sun.target); // at the origin it is where the light has always pointed; drive mode moves it

// Root container converting PartSpec CAD frame (X right, -Y front, +Z up) -> Three.js (X right, +Z front, +Y up):
const vehicleWrap = new THREE.Group();
scene.add(vehicleWrap);
const cadRoot = new THREE.Group();
cadRoot.rotation.x = -Math.PI / 2;
vehicleWrap.add(cadRoot);

const loader = new STLLoader();
const GEOS = {};

const PART_FILES = [
  'kit_keel_base', 'kit_barbell_shaft', 'kit_wheel_med', 'kit_wheel_giant', 'kit_wheel_med_free', 'kit_wheel_giant_free',
  'kit_aero_wedge', 'kit_windscreen', 'kit_tilting_tub', 'kit_scoop_blade',
  'kit_yoke_hbar', 'kit_turntable', 'pro_tub_hinge',
  'pro_steer_bridge', 'pro_steer_knuckle_l', 'pro_steer_knuckle_r',
  'pro_steer_rack', 'pro_tie_rod_link',
  'pro_captive_pin_28', 'pro_steer_column', 'pro_steer_wheel',
  'gear_spur_z10', 'shaft_tu03',
  'mom_band_core_tray', 'mom_band_core_lid', 'mom_pto_gear_z10',
  'mom_band_spool_pawl', 'mom_jet_valve_body',
  'mech_drive_tray', 'mech_drive_lid', 'mech_n20_pinion_z10',
  'mech_brain_tray', 'mech_brain_lid', 'mech_bat_door_screw',
  'mech_servo_mount', 'mech_servo_lid', 'mech_servo_pinion_z10',
  'pro_pilot_pin', 'mech_sill_duct',
  'char_faceplate'
];
// The kit parts above are assembly-frame STLs written by parts/kip/sync_truck_parts.py (check: add --check).
// Wardrobe (head / hair / hat) is loaded on demand from the same PartSpec output the Kip viewer uses. Poses come from
// partspec/mockup/kip_stack.json (attach offsets), written by parts/kip/sync_truck_kip.py, never hard-coded here.
const KIP_STACK = { table: null, head: 'char_head_kid', hair: 'hair_short_swept', hat: 'hat_hardhat' };
// Seated Kip Pro (8+) & Snap (3+) body rig from Kip-Demo.html (kip-rig.js), wearing the 12 PartSpec 2x1 heads on
// neck_turret_2x1. Scaled to S = 0.52 so Kip's side-by-side 1x2 TU sneaker boots (45.6 mm -> 23.7 mm) fit cleanly
// inside #8 Windscreen's 25.2 mm 2-TU cockpit footwell with 0.000 mm³ overlap across all 5 truck stages.
const KIP_DRIVER = {
  K: null, geos: null, rig: null, skinMat: null, geoNames: new Map(),
  scale: 0.52,
};
const KIP_HEADS = [
  'char_head_kid', 'char_head_chibi', 'char_head_tall', 'char_head_jumbo',
  'robot_head_visor', 'robot_head_scout',
  'char_head_fox', 'char_head_bear', 'char_head_cat',
  'char_head_dragon', 'char_head_alien', 'char_head_imp',
];
const KIP_HEAD_HEX = {
  robot_head_visor: '#F4EFE6', robot_head_scout: '#F4EFE6',
  char_head_fox: '#E8743B', char_head_bear: '#8C5A3C', char_head_cat: '#F4EFE6',
  char_head_dragon: '#2EAD7B', char_head_alien: '#6EE7B7', char_head_imp: '#6C63FF',
};
const kipLabel = (id) => id === 'robot_head_visor'
  ? 'robot'
  : id.replace(/^(char_head_|robot_head_|hair_|hat_)/, '').replace(/_/g, ' ');

function makeMat(hex, opacity = 1.0, rough = 0.38) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: rough,
    metalness: 0.06,
    transparent: opacity < 0.999,
    opacity,
    depthWrite: opacity >= 0.95,
  });
}

const MATS = {
  keel: makeMat('#2E6FDB', 1, 0.36),
  tub: makeMat('#F5C518', 1, 0.34),
  wind: makeMat('#F4EFE6', 1, 0.35),
  spark: makeMat('#FF6B4A', 1, 0.36),
  mint: makeMat('#1FA97C', 1, 0.36),
  mintGlass: makeMat('#1FA97C', 0.48, 0.25),
  tire: makeMat('#262D40', 1, 0.55),
  steel: makeMat('#7A8291', 1, 0.32),
  knuckle: makeMat('#495266', 1, 0.38),
  denim: makeMat('#2B4C85', 1, 0.44),
  skin: makeMat('#F3BA95', 1, 0.42),
  hair: makeMat('#7A4B2A', 1, 0.5),
  cyanGlass: makeMat('#00A8E8', 0.34, 0.22),
  lipo: makeMat('#3A86FF', 0.94, 0.30),
  pcb: makeMat('#1FA97C', 0.95, 0.32),
  brass: makeMat('#D97706', 0.95, 0.28),
  balloon: makeMat('#FF5252', 0.68, 0.25),
  rubberBand: makeMat('#FF6600', 1, 0.35),
  ghost: makeMat('#FFD166', 0.5, 0.4), // viewer-only illustration: no catalog part exists for this yet
};

const state = {
  stage: 'snap',
  tipDeg: 22,
  steerDeg: 0,
  explode: 0,
  giantWheels: false,
  bulldogHood: false,
  frontPlow: false,
  showKip: true,
  driver: 'pro',    // pro = Pro 8+ 14-joint ball-and-peg Kip rig (default) | snap = Snap 3+ 1-piece limb & turret Kip rig
  xrayMode: 'auto', // auto | on | off
  demoRunning: false,
  demoT: 0,
  wheelSpin: 0,
  spoolSpin: 0,     // independent of wheelSpin so Stage 2a's overrunning clutch halts the spool at slack while wheels coast
  sweepRunning: false,
  balloonD: 175, balloonLean: 0, jetNozzle: 6, jetFill: 1,   // Stage 2b balloon jet (proposal): balloon diameter mm, lean-back deg, nozzle bore mm, inflation 0..1
};

// ---------------------------------------------------------------------------
// Rigid tie-rod rack steering, solved from the REAL PartSpec hardpoints (CAD frame: X right, -Y front, +Z up).
// A knuckle's tie-rod bore orbits its vertical kingpin at radius ARM. A rigid tie-rod of fixed planar length LINK joins
// that bore to the rack's tie-rod bore, so each knuckle angle is DETERMINED by rack travel -- nothing is hard-coded.
// The vehicle faces +Z in three.js (cadRoot.rotation.x = -PI/2), so CAD +X is the vehicle's LEFT.
// ---------------------------------------------------------------------------
const KNUCKLE_FACE_RELIEF = 0.4; // mm; = KNUCKLE_FACE_RELIEF in toyventor_kitcard.py (pivot bores exempt from the axis8 lattice, see that file)
const STEER = {
  kpX: 18.75, kpY: -56.25,       // kingpin axes (pro_steer_bridge bosses)
  arm: 12.5,                     // knuckle kingpin bore -> tierod bore (pro_steer_knuckle_l/r)
  rackX: 7.8125, rackY: -57.8125, // pro_steer_rack tierod bores: rack origin y=-56.25, bore at local (+-7.8125, -1.5625) (RACK_TIEROD_X)
  pinionR: 12.5,                 // gear_spur_z10 / mech_servo_pinion_z10 pitch radius
  rackStop: 5.20,                // RACK_STOP in toyventor_kitcard.py: 33.9 deg inner / 20.8 outer, +-23.8 deg pinion/servo, circle 60.6 cm
  rackZ: 25.2,                   // RACK_Z: rack and Z10 pinion run 0.2 mm above the bridge deck (z 25.0)
  linkZ: 31.65, linkTopZ: 35.65, // LINK_Z / LINK_TOP_Z: underside / top of the 4.0 mm tie-rod link plate
  kingpinPinZ: -5.325,           // pro_captive_pin_28 from below: head flush under knuckle (-3.80), split-barb locked in bridge counterbore
  tpinHeadZ: 37.20,              // pro_captive_pin_28 from above: head over link plate (35.65), split-barb locked in knuckle pocket
  steerColZ: -2.025,             // pro_steer_column from below #1 steer_bore, split-barb locked above pro_steer_wheel
  steerWheelZ: 31.65,            // pro_steer_wheel (Ø23.0 mm lower thrust skirt captures rear rack teeth at Y = -47.5..-49.0)
  pilotPinZ: -1.525,             // pro_pilot_pin from below #1 steer_bore supporting mech_servo_pinion_z10 in double shear
  ptoPhaseRad: THREE.MathUtils.degToRad(17.5),   // valley-in-tooth phase for upper Z10 PTO gear vs row-8 axle Z10 gear
  spoolPhaseRad: THREE.MathUtils.degToRad(45.0), // seats 4 spiral ratchet leaves into 8-tooth axial sawtooth valleys; 45.0 = PTO phase + 27.5 deg, the centre of the clear 24.5..30.5 deg window of the mirrored clutch pocket (about 2.5 deg each side; was 46.5, and 27.0 before the mirror; checked by parts/partspec/verify_band_jet.py C7, which reads this line)
  tubTrunnionY: 30.95, tubTrunnionZ: 5.75,       // enclosed cylindrical barrel-hinge axis on kit_tilting_tub pinned by shaft_tu03
  wheelbase: 100.0,              // kingpin line -> rear axle
  kpSpan: 37.5,                  // kingpin-to-kingpin
};
STEER.link = Math.hypot(STEER.kpX - STEER.rackX, (STEER.kpY - STEER.arm) - STEER.rackY); // 15.468 mm planar, fixed
let lastRackDx = 0;

function knuckleAngle(side, dx) {
  // Closed-form circle/circle intersection for the knuckle at CAD x = side*kpX with the rack displaced by dx.
  const Dx = side * STEER.rackX + dx - side * STEER.kpX;
  const Dy = STEER.rackY - STEER.kpY;
  const R = Math.hypot(Dx, Dy);
  const q = Math.max(-1, Math.min(1, (STEER.arm * STEER.arm + R * R - STEER.link * STEER.link) / (2 * STEER.arm * R)));
  const phi = Math.atan2(Dy, Dx), a = Math.asin(q);
  const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
  const r1 = wrap(phi + a), r2 = wrap(phi + Math.PI - a);
  return Math.abs(r1) < Math.abs(r2) ? r1 : r2; // branch continuous with the straight-ahead rest pose
}

function steerSolution(steerDeg) {
  // steerDeg = signed inner-knuckle angle the user asks for (+ = wheels toward CAD +X = vehicle LEFT).
  const maxInner = state.giantWheels ? 25 : 34;
  const clampedDeg = Math.max(-maxInner, Math.min(maxInner, steerDeg));
  const target = Math.abs(clampedDeg) * Math.PI / 180;
  let dx = 0;
  if (target > 0) {
    let lo = 0, hi = STEER.rackStop;
    if (Math.abs(knuckleAngle(1, hi)) <= target) dx = hi;
    else {
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        if (Math.abs(knuckleAngle(1, m)) < target) lo = m; else hi = m;
      }
      dx = (lo + hi) / 2;
    }
  }
  dx *= Math.sign(clampedDeg);
  const aPlus = knuckleAngle(1, dx), aMinus = knuckleAngle(-1, dx); // signed rad, + = toward CAD +X
  const inner = Math.max(Math.abs(aPlus), Math.abs(aMinus));
  const outer = Math.min(Math.abs(aPlus), Math.abs(aMinus));
  // Ackermann ideal outer angle for this inner angle: cot(outer) - cot(inner) = kingpin span / wheelbase
  const ideal = inner > 1e-6 ? Math.atan(1 / (1 / Math.tan(inner) + STEER.kpSpan / STEER.wheelbase)) : 0;
  return { dx, aPlus, aMinus, inner, outer, ideal };
}

function meshOf(pid, mat) {
  const m = new THREE.Mesh(GEOS[pid], mat);
  m.castShadow = mat.opacity >= 0.85;
  m.receiveShadow = true;
  return m;
}

// Stage 2b balloon jet (proposal; docs/specs/parts-engineering-spec.md section 1, parts/kip/viewer/JetCar-Lab.html). mom_jet_valve_body is repo CAD; the nozzle insert,
// balloon and jet stream below are procedural stand-ins. The collar top is at (0, 47.0, 40.5); the balloon is a sphere on a 25 mm neck, upright unless balloonLean > 0.
const JET_NECK = 25.0;
function jetNozzleGeo(d) {   // tapered plug into the body's rear socket (y 8.5..14.7), flange, convergent exit; body frame, axis +y
  const r = d / 2;
  const prof = [[2.5, 8.5], [3.72, 8.5], [4.15, 14.7], [7.0, 14.7], [7.0, 17.2], [r + 1.4, 24.0], [r, 24.0], [r, 22.0], [2.5, 17.2]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(prof, 40);
}
function applyJetBalloon() {   // inflation: volume follows jetFill, so the diameter follows its cube root
  const b = dynamicRefs.jetBalloonBody;
  if (!b) return;
  const r = (state.balloonD / 2) * Math.cbrt(Math.max(0.03, state.jetFill));
  b.scale.setScalar(r);
  b.position.z = JET_NECK + r;
}

function rboxMesh(w, d, h, mat) {
  const g = new THREE.BoxGeometry(w, d, h);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = mat.opacity >= 0.85;
  m.receiveShadow = true;
  return m;
}

function addExplodeTag(obj, dx, dy, dz) {
  obj.userData.basePos = obj.position.clone();
  obj.userData.expVec = new THREE.Vector3(dx, dy, dz);
  return obj;
}

let dynamicRefs = {};

function prepareSharedKipForTruck(rig) {
  rig.mover.position.set(0, 0, 0);
  rig.mover.quaternion.identity();
  rig.mover.scale.setScalar(1);
  rig.grounder.position.set(0, 0, 0);
  rig.grounder.quaternion.identity();
  rig.grounder.scale.setScalar(1);
  for (const s of rig.partSlots || []) {
    s.grp.position.set(0, 0, 0);
    s.grp.quaternion.identity();
    s.grp.scale.setScalar(1);
  }
  for (const flex of Object.values(rig.flexArms || {})) {
    flex.mesh.visible = false;
    flex.deform(new THREE.Quaternion());
  }
  for (const flex of Object.values(rig.flexLegs || {})) {
    flex.mesh.visible = false;
    flex.deform(new THREE.Quaternion());
  }
  const rigid = rig.rigidSnapMeshes || {};
  for (const key of ['armL', 'armR']) {
    if (!rigid[key]) continue;
    rigid[key].visible = true;
    if (KIP_DRIVER.skinMat) rigid[key].material = KIP_DRIVER.skinMat;
  }
  for (const key of ['legL', 'legR']) {
    if (!rigid[key]) continue;
    rigid[key].visible = true;
    rigid[key].material = MATS.denim;
  }
  const exp = rig.exp;
  const hide = [
    rig.backStudsSlot, rig.wingsGroup, rig.proBackGroup, rig.snapTailGroup, rig.proTailGroup, rig.proStaffGroup,
    exp?.explorerGroup, exp?.jetpackGroup, exp?.customBackGroup, exp?.wrenchGroup, exp?.shieldGroup,
    exp?.customWandGroup, exp?.customHandGroup, exp?.skateboardGroup, exp?.snapSeatedLegsGroup,
    exp?.carGroup, exp?.truckGroup, exp?.bikeGroup,
    ...Object.values(exp?.workshopGroups || {}),
  ];
  for (const grp of hide) if (grp) grp.visible = false;
}

function rebuildScene() {
  while (cadRoot.children.length) cadRoot.remove(cadRoot.children[0]);
  dynamicRefs = {};

  const wheelPid = state.giantWheels ? 'kit_wheel_giant' : 'kit_wheel_med';
  const wheelR = state.giantWheels ? 25.0 : 18.0;
  cadRoot.position.y = wheelR - 6.25;

  const isSteered = (state.stage === 'pro' || state.stage === 'mech');
  const useXray = state.xrayMode === 'on' || (state.xrayMode === 'auto' && (state.stage === 'mech' || state.stage === 'band'));

  // 1. #1 Universal Keel Base
  const keel = meshOf('kit_keel_base', useXray && state.xrayMode === 'on' ? makeMat('#2E6FDB', 0.45, 0.3) : MATS.keel);
  addExplodeTag(keel, 0, 0, 0);
  cadRoot.add(keel);

  // 2. Rear Solid Axle (row 8, y = +43.75, z = 6.25)
  const rearAxle = new THREE.Group();
  rearAxle.position.set(0, 43.75, 6.25);
  addExplodeTag(rearAxle, 0, 12, -16);
  const rShaft = meshOf('kit_barbell_shaft', MATS.steel);
  rShaft.rotation.y = Math.PI / 2;
  rShaft.position.set(-39.0, 0, 0);
  rearAxle.add(rShaft);

  const rWL = meshOf(wheelPid, MATS.tire);
  rWL.rotation.y = -Math.PI / 2;
  rWL.position.set(-26.7, 0, 0);
  addExplodeTag(rWL, -18, 0, 0);
  rearAxle.add(rWL);

  const rWR = meshOf(wheelPid, MATS.tire);
  rWR.rotation.y = Math.PI / 2;
  rWR.position.set(26.7, 0, 0);
  addExplodeTag(rWR, 18, 0, 0);
  rearAxle.add(rWR);

  if (state.stage !== 'snap' && state.stage !== 'jet') {   // the jet stage has no PTO, and the gear would overlap mom_jet_valve_body by 442 mm3
    const ptoGear = meshOf('gear_spur_z10', MATS.spark);
    ptoGear.rotation.y = Math.PI / 2;
    ptoGear.position.set(-3.125, 0, 0);
    rearAxle.add(ptoGear);
  }
  cadRoot.add(rearAxle);
  dynamicRefs.rearAxle = rearAxle;

  // 3. Front Nose & Captive Steering
  if (!isSteered) {
    const frontAxle = new THREE.Group();
    frontAxle.position.set(0, -56.25, 6.25);
    addExplodeTag(frontAxle, 0, -12, -16);
    const fShaft = meshOf('kit_barbell_shaft', MATS.steel);
    fShaft.rotation.y = Math.PI / 2;
    fShaft.position.set(-39.0, 0, 0);
    frontAxle.add(fShaft);

    const fWL = meshOf(wheelPid, MATS.tire);
    fWL.rotation.y = -Math.PI / 2;
    fWL.position.set(-26.7, 0, 0);
    addExplodeTag(fWL, -18, 0, 0);
    frontAxle.add(fWL);

    const fWR = meshOf(wheelPid, MATS.tire);
    fWR.rotation.y = Math.PI / 2;
    fWR.position.set(26.7, 0, 0);
    addExplodeTag(fWR, 18, 0, 0);
    frontAxle.add(fWR);
    cadRoot.add(frontAxle);
    dynamicRefs.frontAxle = frontAxle;

    if (state.stage === 'band') {
      // Pull-back only (motion-stage-options-spec, decided 2026-11-02): no bumper trigger, no winding key, no latch pawl, so the nose is bare.
    } else if (state.bulldogHood) {
      const wedge = meshOf('kit_aero_wedge', MATS.spark);
      wedge.position.set(0, -43.75, 12.5);
      addExplodeTag(wedge, 0, -18, 18);
      cadRoot.add(wedge);

      const yoke = meshOf('kit_yoke_hbar', MATS.tire);
      yoke.position.set(0, -31.25, 20.5);
      addExplodeTag(yoke, 0, -14, 34);
      cadRoot.add(yoke);
      dynamicRefs.yoke = yoke;
    } else {
      const yoke = meshOf('kit_yoke_hbar', MATS.spark);
      yoke.position.set(0, -37.5, 6.0);
      addExplodeTag(yoke, 0, -10, 26);
      cadRoot.add(yoke);
      dynamicRefs.yoke = yoke;
    }
  } else {
    // Stage 3 Pro & Stage 3+ Pro Powered Add-On Captive Ackermann Row-0 Steering Linkage
    const bridge = meshOf('pro_steer_bridge', MATS.mint);
    bridge.position.set(0, -50.0, 12.5);
    addExplodeTag(bridge, 0, -14, 14);
    cadRoot.add(bridge);

    const rack = meshOf('pro_steer_rack', MATS.tub);
    rack.position.set(0, -56.25, STEER.rackZ);
    addExplodeTag(rack, 0, -22, 26);
    cadRoot.add(rack);
    dynamicRefs.rack = rack;

    if (state.stage === 'pro') {
      const col = meshOf('pro_steer_column', MATS.steel);
      col.position.set(0, -37.5, STEER.steerColZ);
      addExplodeTag(col, 0, -10, -22);
      cadRoot.add(col);
      dynamicRefs.steerCol = col;

      const pinion = meshOf('gear_spur_z10', MATS.spark);
      pinion.position.set(0, -37.5, STEER.rackZ);
      addExplodeTag(pinion, 0, -10, 22);
      cadRoot.add(pinion);
      dynamicRefs.pinion = pinion;

      const sWheel = meshOf('pro_steer_wheel', MATS.spark);
      sWheel.position.set(0, -37.5, STEER.steerWheelZ);
      addExplodeTag(sWheel, 0, -10, 38);
      cadRoot.add(sWheel);
      dynamicRefs.steerWheel = sWheel;
    } else {
      // Stage 3+ (Card F PETG): pro_pilot_pin + mech_servo_pinion_z10 + nylon horn + mech_servo_mount + SG90 + mech_servo_lid
      const pilot = meshOf('pro_pilot_pin', MATS.steel);
      pilot.position.set(0, -37.5, STEER.pilotPinZ);
      addExplodeTag(pilot, 0, -10, -22);
      cadRoot.add(pilot);

      const sPinion = meshOf('mech_servo_pinion_z10', MATS.spark);
      sPinion.position.set(0, -37.5, STEER.rackZ);
      addExplodeTag(sPinion, 0, -10, 20);
      cadRoot.add(sPinion);
      dynamicRefs.pinion = sPinion;

      const hornGroup = new THREE.Group();
      hornGroup.position.set(0, -37.5, STEER.rackZ + 7.4);
      addExplodeTag(hornGroup, 0, -10, 26);
      hornGroup.add(rboxMesh(19.4, 4.6, 1.8, MATS.wind), rboxMesh(4.6, 19.4, 1.8, MATS.wind));
      cadRoot.add(hornGroup);
      dynamicRefs.servoHorn = hornGroup;

      const sMount = meshOf('mech_servo_mount', useXray ? MATS.cyanGlass : MATS.mint);
      sMount.position.set(0, -37.5, 12.5);
      addExplodeTag(sMount, 0, -16, 28);
      cadRoot.add(sMount);

      const sg90 = new THREE.Group();
      addExplodeTag(sg90, 0, -16, 38);
      const sgBody = rboxMesh(12.2, 22.5, 19.5, MATS.lipo); sgBody.position.set(0, -42.85, 48.25);
      const sgEars = rboxMesh(12.2, 32.2, 2.5, MATS.lipo); sgEars.position.set(0, -42.85, 44.05);
      sg90.add(sgBody, sgEars);
      cadRoot.add(sg90);

      const sLid = meshOf('mech_servo_lid', useXray ? MATS.cyanGlass : MATS.mint);
      sLid.position.set(0, -31.25, 45.3);
      addExplodeTag(sLid, 0, -16, 46);
      cadRoot.add(sLid);

      for (const sx of [-18.75, 18.75]) {
        const sp = meshOf('pro_captive_pin_28', MATS.tub);
        sp.position.set(sx, -31.25, 22.425);
        addExplodeTag(sp, sx * 0.6, -16, 52);
        cadRoot.add(sp);
      }
    }

    // Left & Right Double-Shear Clevis Knuckles + Captive Kingpins + Wheels
    for (const side of [-1, 1]) {
      const kpPivot = new THREE.Group();
      kpPivot.position.set(side * 18.75, -56.25, 6.25);
      addExplodeTag(kpPivot, side * 16, -14, -8);

      const orientZ = new THREE.Group();
      orientZ.rotation.z = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const tiltX = new THREE.Group();
      tiltX.rotation.x = -Math.PI / 2;
      const knMesh = meshOf(side < 0 ? 'pro_steer_knuckle_l' : 'pro_steer_knuckle_r', MATS.knuckle);
      knMesh.position.set(side < 0 ? -6.25 : 6.25, 0, -6.25 + KNUCKLE_FACE_RELIEF);
      tiltX.add(knMesh);
      orientZ.add(tiltX);
      kpPivot.add(orientZ);

      // The steered front wheel is the free-hub variant: it turns on the knuckle's round barbed stub (the keyed wheel could not, and needed a 90 deg clock).
      const stW = meshOf(state.giantWheels ? 'kit_wheel_giant_free' : 'kit_wheel_med_free', MATS.tire);
      stW.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      const spinG = new THREE.Group();
      spinG.position.set(side * 8.85, 0, 0);
      addExplodeTag(spinG, side * 18, 0, 0);
      spinG.add(stW);
      kpPivot.add(spinG);
      if (side < 0) dynamicRefs.spinMinus = spinG;
      else dynamicRefs.spinPlus = spinG;

      // Captive split-cantilever kingpin from below (head flush under knuckle, snap-barb locked in bridge counterbore)
      const pinM = meshOf('pro_captive_pin_28', MATS.tub);
      pinM.position.set(side * STEER.kpX, STEER.kpY, STEER.kingpinPinZ);
      addExplodeTag(pinM, side * 16, -14, -22);
      cadRoot.add(pinM);

      cadRoot.add(kpPivot);
      if (side < 0) dynamicRefs.kpL = kpPivot;
      else dynamicRefs.kpR = kpPivot;
    }

    // Tie-rod links + upward-locking captive tie-rod pins (posed every frame from the rigid closure in updateKinematics)
    for (const side of [-1, 1]) {
      const link = meshOf('pro_tie_rod_link', MATS.spark);
      const tpin = meshOf('pro_captive_pin_28', MATS.tub);
      tpin.rotation.order = 'ZYX';
      cadRoot.add(link, tpin);
      if (side < 0) { dynamicRefs.linkL = link; dynamicRefs.tpinL = tpin; } else { dynamicRefs.linkR = link; dynamicRefs.tpinR = tpin; }
    }
  }

  // Optional #12 Front Snowplow / Dozer Blade
  if (state.frontPlow) {
    const plow = meshOf('kit_scoop_blade', MATS.tub);
    plow.rotation.x = Math.PI / 2;
    plow.rotation.z = Math.PI;
    plow.position.set(0, -68.0, 12.0);
    addExplodeTag(plow, 0, -32, 0);
    cadRoot.add(plow);
  }

  // 4. Cockpit (#8 Windscreen or Stage-4 mech_sill_duct + Seated Kip Driver on rows 3..5)
  const cockpitPid = state.stage === 'mech' ? 'mech_sill_duct' : 'kit_windscreen';
  const wind = meshOf(cockpitPid, state.stage === 'mech' ? MATS.mint : MATS.wind);
  wind.position.set(0, -6.25, 12.5);
  addExplodeTag(wind, 0, -4, 18);
  cadRoot.add(wind);

  const borrowedRig = sharedKip ? (active ? kipSession.borrow('truck') : null) : KIP_DRIVER.rig;
  if (state.showKip && borrowedRig) {
    const kipGroup = new THREE.Group();
    addExplodeTag(kipGroup, 0, 0, 32);
    const rig = borrowedRig;
    if (sharedKip) adoptSharedDriverState();
    const isPro = state.driver !== 'snap';
    for (const s of rig.editionParts.pro) s.visible = isPro;
    for (const s of rig.editionParts.snap) s.visible = !isPro;
    prepareSharedKipForTruck(rig);

    const d2r = THREE.MathUtils.degToRad;
    rig.hips.rotation.set(0, 0, 0);
    rig.joints.Head.rotation.set(0, 0, 0);
    for (const side of [1, -1]) {
      const tag = side === 1 ? 'Left' : 'Right';
      const arm = rig.joints[`${tag}Arm`];
      const fore = rig.joints[`${tag}ForeArm`];
      const hand = rig.joints[`${tag}Hand`];
      const upLeg = rig.joints[`${tag}UpLeg`];
      const leg = rig.joints[`${tag}Leg`];
      const foot = rig.joints[`${tag}Foot`];
      if (isPro) {
        const rc = state.stage === 'mech'; // Stage 3+ replaces the manual wheel with the tall SG90 servo pod (z = 52.1 mm)
        arm.rotation.set(d2r(rc ? -85 : -60), 0, d2r(side * (rc ? 15 : 30)));
        fore.position.set(0, -23.8, 0);
        fore.rotation.set(d2r(rc ? -42 : -18), 0, d2r(side * (rc ? -10 : -14)));
        hand.position.set(0, -22.6, 0);
        hand.rotation.set(0, 0, 0);
        upLeg.rotation.set(d2r(-126), 0, d2r(side * 3.5));
        leg.position.set(0, -25.6, 0);
        leg.rotation.set(d2r(162), 0, 0);
        foot.position.set(0, -26.0, -1.5);
        foot.rotation.set(d2r(-34), 0, 0);
      } else {
        arm.rotation.set(d2r(-68), 0, d2r(side * 28));
        fore.position.set(0, -35.0, 3.8);
        fore.rotation.set(d2r(-11), 0, 0);
        hand.position.set(0, -0.5, 0);
        hand.rotation.set(0, 0, 0);
        upLeg.rotation.set(d2r(-120), 0, d2r(side * 2.5));
        leg.position.set(0, -39.2, 0);
        leg.rotation.set(0, 0, 0);
        foot.position.set(0, -0.4, -1.5);
        foot.rotation.set(d2r(26), 0, 0);
      }
    }

    KIP_DRIVER.skinMat.color.set(KIP_HEAD_HEX[KIP_STACK.head] || '#F3BA95');
    if (sharedKip) {
      if (!kipSession.syncDriver()) syncTruckWardrobeHead();
    } else {
      syncTruckWardrobeHead();
    }

    const S = KIP_DRIVER.scale;
    const hipCadY = isPro ? -0.5 : 1.2;
    const hipCadZ = isPro ? 31.0 : 29.0;
    const wrap = new THREE.Group();
    wrap.rotation.x = Math.PI / 2;
    wrap.scale.setScalar(S);
    wrap.position.set(0, hipCadY, hipCadZ - 61.5 * S);
    wrap.add(rig.mover);
    kipGroup.add(wrap);
    cadRoot.add(kipGroup);
  }

  // 5. Rear Power Core (rows 6..9) + Enclosed Barrel-Hinged #11 Tipping Dump Tub (pinned by shaft_tu03)
  if (state.stage === 'snap' || state.stage === 'pro') {
    const tHinge = meshOf('pro_tub_hinge', MATS.mint);
    tHinge.position.set(0, 62.40, 4.50);
    addExplodeTag(tHinge, 0, 22, -10);
    cadRoot.add(tHinge);

    const tPin = meshOf('shaft_tu03', MATS.steel);
    tPin.rotation.y = Math.PI / 2;
    tPin.position.set(-18.75, 37.5 + STEER.tubTrunnionY, 12.5 + STEER.tubTrunnionZ);
    addExplodeTag(tPin, -26, 22, 18);
    cadRoot.add(tPin);

    const tubHinge = new THREE.Group();
    tubHinge.position.set(0, 37.5 + STEER.tubTrunnionY, 12.5 + STEER.tubTrunnionZ);
    addExplodeTag(tubHinge, 0, 22, 28);
    const tub = meshOf('kit_tilting_tub', MATS.tub);
    tub.position.set(0, -STEER.tubTrunnionY, -STEER.tubTrunnionZ);
    tubHinge.add(tub);
    cadRoot.add(tubHinge);
    dynamicRefs.tubHinge = tubHinge;
  } else if (state.stage === 'band') {
    const tray = meshOf('mom_band_core_tray', useXray ? MATS.mintGlass : MATS.mint);
    tray.position.set(0, 37.5, 12.5);
    addExplodeTag(tray, 0, 14, 16);
    cadRoot.add(tray);

    // Double-shear PTO shaft (shaft_tu03) + overrunning clutch gear (mom_pto_gear_z10) + spiral-leaf spool (mom_band_spool_pawl)
    const shaftSpin = new THREE.Group();
    shaftSpin.position.set(-15.20, 43.75, 31.25);
    addExplodeTag(shaftSpin, -24, 14, 24);
    const shaftOrient = new THREE.Group(); shaftOrient.rotation.y = Math.PI / 2;
    const ptoShaft = meshOf('shaft_tu03', MATS.steel); ptoShaft.rotation.z = STEER.ptoPhaseRad;
    shaftOrient.add(ptoShaft); shaftSpin.add(shaftOrient);
    cadRoot.add(shaftSpin);
    dynamicRefs.ptoShaft = shaftSpin;

    const gearSpin = new THREE.Group();
    gearSpin.position.set(-3.125, 43.75, 31.25);
    addExplodeTag(gearSpin, -8, 14, 24);
    const gearOrient = new THREE.Group(); gearOrient.rotation.y = Math.PI / 2;
    const coreZ10 = meshOf('mom_pto_gear_z10', MATS.spark); coreZ10.rotation.z = STEER.ptoPhaseRad;
    gearOrient.add(coreZ10); gearSpin.add(gearOrient);
    cadRoot.add(gearSpin);
    dynamicRefs.coreGear = gearSpin;

    const spoolSpinG = new THREE.Group();
    spoolSpinG.position.set(3.85, 43.75, 31.25);
    addExplodeTag(spoolSpinG, 10, 14, 24);
    const spoolOrient = new THREE.Group(); spoolOrient.rotation.y = Math.PI / 2;
    const spool = meshOf('mom_band_spool_pawl', MATS.tub); spool.rotation.z = STEER.spoolPhaseRad;
    spoolOrient.add(spool); spoolSpinG.add(spoolOrient);
    cadRoot.add(spoolSpinG);
    dynamicRefs.coreSpool = spoolSpinG;

    // Doubled #32 elastomer band loop wrapped from spool drum around twin front posts
    const bandCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(7.0, 43.75, 31.25),
      new THREE.Vector3(16.0, 21.5, 29.0),
      new THREE.Vector3(-16.0, 21.5, 29.0),
      new THREE.Vector3(7.0, 43.75, 34.5),
    ], true);
    const bandGeo = new THREE.TubeGeometry(bandCurve, 32, 1.3, 8, true);
    const bandMesh = new THREE.Mesh(bandGeo, MATS.rubberBand);
    addExplodeTag(bandMesh, 0, 14, 26);
    cadRoot.add(bandMesh);
    dynamicRefs.bandLoop = bandMesh;

    const lid = meshOf('mom_band_core_lid', useXray ? MATS.mintGlass : MATS.mint);
    lid.position.set(0, 37.5, 44.8);
    addExplodeTag(lid, 0, 14, 34);
    cadRoot.add(lid);

    const tPin = meshOf('shaft_tu03', MATS.steel);
    tPin.rotation.y = Math.PI / 2;
    tPin.position.set(-18.75, 37.5 + STEER.tubTrunnionY, 50.0 + STEER.tubTrunnionZ);
    addExplodeTag(tPin, -26, 22, 44);
    cadRoot.add(tPin);

    const tubHinge = new THREE.Group();
    tubHinge.position.set(0, 37.5 + STEER.tubTrunnionY, 50.0 + STEER.tubTrunnionZ);
    addExplodeTag(tubHinge, 0, 22, 54);
    const tub = meshOf('kit_tilting_tub', MATS.tub);
    tub.position.set(0, -STEER.tubTrunnionY, -STEER.tubTrunnionZ);
    tubHinge.add(tub);
    cadRoot.add(tubHinge);
    dynamicRefs.tubHinge = tubHinge;
  } else if (state.stage === 'jet') {
    // Proposal: no dump tub. mom_jet_valve_body sits on the keel's rear rows 8..9 (centre y 50.0, corner studs only) with the balloon upright on its vertical collar.
    const jet = meshOf('mom_jet_valve_body', MATS.mint);
    jet.position.set(0, 50.0, 12.5);
    addExplodeTag(jet, 0, 18, 22);
    cadRoot.add(jet);
    const nozMat = MATS.spark.clone(); nozMat.side = THREE.DoubleSide;
    const noz = new THREE.Mesh(jetNozzleGeo(state.jetNozzle), nozMat);
    noz.position.set(0, 50.0, 25.0);
    addExplodeTag(noz, 0, 34, 12);
    cadRoot.add(noz);
    const balloon = new THREE.Group();
    balloon.position.set(0, 47.0, 40.5);
    balloon.rotation.x = -THREE.MathUtils.degToRad(state.balloonLean);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(7, 10, JET_NECK, 24), MATS.balloon);
    neck.rotation.x = Math.PI / 2; neck.position.z = JET_NECK / 2;
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), MATS.balloon);
    balloon.add(neck, body);
    addExplodeTag(balloon, 0, 8, 40);
    cadRoot.add(balloon);
    dynamicRefs.jetBalloonBody = body;
    if (!state.demoRunning) state.jetFill = 1;
    applyJetBalloon();
    const streamMat = makeMat('#9AD1FF', 0.35, 0.4); streamMat.side = THREE.DoubleSide; streamMat.depthWrite = false;
    const stream = new THREE.Mesh(new THREE.ConeGeometry(5, 60, 24, 1, true), streamMat);
    stream.rotation.z = Math.PI;   // narrow end at the nozzle exit, widening rearward
    stream.position.set(0, 50.0 + 24.0 + 30.0, 25.0);
    stream.visible = false;        // shown only while the demo vents
    cadRoot.add(stream);
    dynamicRefs.jetStream = stream;
  } else if (state.stage === 'mech') {
    // Printable Card F PETG 3-TU Drive Core + 2-TU Low-CG Brain Core + COTS N20 / 602535 LiPo / 38x38 PCBA / XIAO
    const dTray = meshOf('mech_drive_tray', useXray ? MATS.cyanGlass : MATS.mint);
    dTray.position.set(0, 37.5, 12.5);
    addExplodeTag(dTray, 0, 14, 14);
    cadRoot.add(dTray);

    const n20Spin = new THREE.Group();
    n20Spin.position.set(-3.125, 43.75, 31.25);
    addExplodeTag(n20Spin, 8, 14, 22);
    const n20Orient = new THREE.Group(); n20Orient.rotation.y = Math.PI / 2;
    const mGear = meshOf('mech_n20_pinion_z10', MATS.spark); mGear.rotation.z = STEER.ptoPhaseRad;
    n20Orient.add(mGear); n20Spin.add(n20Orient);
    cadRoot.add(n20Spin);
    dynamicRefs.coreGear = n20Spin;

    const dLid = meshOf('mech_drive_lid', useXray ? MATS.cyanGlass : MATS.mint);
    dLid.position.set(0, 37.5, 44.8);
    addExplodeTag(dLid, 0, 14, 28);
    cadRoot.add(dLid);

    const bTray = meshOf('mech_brain_tray', useXray ? MATS.cyanGlass : MATS.mint);
    bTray.position.set(0, 37.5, 50.0);
    addExplodeTag(bTray, 0, 14, 38);
    cadRoot.add(bTray);

    const bDoor = meshOf('mech_bat_door_screw', MATS.spark);
    bDoor.rotation.x = Math.PI / 2;
    bDoor.position.set(0, 66.65, 60.8);
    addExplodeTag(bDoor, 0, 30, 38);
    cadRoot.add(bDoor);

    const bLid = meshOf('mech_brain_lid', useXray ? MATS.cyanGlass : MATS.mint);
    bLid.position.set(0, 37.5, 69.8);
    addExplodeTag(bLid, 0, 14, 50);
    cadRoot.add(bLid);

    // Datasheet COTS components seated inside mech_drive_tray and mech_brain_tray
    const elecGroup = new THREE.Group();
    addExplodeTag(elecGroup, 0, 22, 34);
    const mot = rboxMesh(24.0, 12.0, 10.0, MATS.brass); mot.position.set(-11.5, 43.75, 31.25);
    const lipo = rboxMesh(25.0, 35.0, 6.2, MATS.lipo); lipo.position.set(0, 40.5, 58.6);
    const pcb = rboxMesh(38.0, 38.0, 1.6, MATS.pcb); pcb.position.set(0, 37.5, 63.6);
    const mcu = rboxMesh(21.0, 17.8, 4.5, MATS.tire); mcu.position.set(0, 36.4, 66.75);
    elecGroup.add(mot, lipo, pcb, mcu);
    cadRoot.add(elecGroup);

    const tubPin = meshOf('shaft_tu03', MATS.steel);
    tubPin.rotation.y = Math.PI / 2;
    tubPin.position.set(-18.75, 37.5 + STEER.tubTrunnionY, 75.0 + STEER.tubTrunnionZ);
    addExplodeTag(tubPin, -26, 22, 58);
    cadRoot.add(tubPin);

    const tubHinge = new THREE.Group();
    tubHinge.position.set(0, 37.5 + STEER.tubTrunnionY, 75.0 + STEER.tubTrunnionZ);
    addExplodeTag(tubHinge, 0, 22, 66);
    const tub = meshOf('kit_tilting_tub', MATS.tub);
    tub.position.set(0, -STEER.tubTrunnionY, -STEER.tubTrunnionZ);
    tubHinge.add(tub);
    cadRoot.add(tubHinge);
    dynamicRefs.tubHinge = tubHinge;
  }

  updateKinematics();
  updateHUD();
}

// Pro fits the rear Z10 PTO gear under the bed: the tub's underside hits its teeth at low tip angles. Found by the motion test on the barrel-hinge tub:
// 0.38 mm3 at 23.0 deg, 0.00 mm3 from 23.25 up (37 gear phases at 1 deg steps; every 0.5 deg from 23.5 to 29 clean), so the Pro bed stops at 24 deg.
// (The older trunnion-hinge tub was clean from 22.5, so this was 23.) Re-run the motion test if the tub, hinge or gear changes. Every other stage lowers the bed fully.
const PRO_TIP_MIN = 24;
const tipMinDeg = () => (state.stage === 'pro' ? PRO_TIP_MIN : 0);

function updateKinematics() {
  state.tipDeg = Math.max(tipMinDeg(), state.tipDeg);
  const tipRad = THREE.MathUtils.degToRad(state.tipDeg);
  const steerRad = THREE.MathUtils.degToRad(state.steerDeg);

  if (dynamicRefs.tubHinge) {
    dynamicRefs.tubHinge.rotation.x = -tipRad;
  }

  if (dynamicRefs.kpL && dynamicRefs.kpR) {
    // Rigid tie-rod linkage solved from the real hardpoints (see STEER): rack travel -> both knuckle angles.
    const sol = steerSolution(state.steerDeg);
    const rL = sol.aMinus; // knuckle at CAD x = -18.75 (the vehicle's RIGHT wheel)
    const rR = sol.aPlus;  // knuckle at CAD x = +18.75 (the vehicle's LEFT wheel)
    dynamicRefs.kpL.rotation.z = rL;
    dynamicRefs.kpR.rotation.z = rR;

    // Rack & pinion: pitch radius 12.5 mm, CCW (+) drives the rack +X: dx = r * theta (max +-5.20 mm = +-23.8 deg servo).
    const dx = sol.dx;
    lastRackDx = dx;
    const pinionRad = dx / STEER.pinionR;
    if (dynamicRefs.rack) dynamicRefs.rack.position.x = dx;
    if (dynamicRefs.pinion) dynamicRefs.pinion.rotation.z = pinionRad;
    if (dynamicRefs.steerCol) dynamicRefs.steerCol.rotation.z = pinionRad;
    if (dynamicRefs.steerWheel) dynamicRefs.steerWheel.rotation.z = pinionRad;
    if (dynamicRefs.servoHorn) dynamicRefs.servoHorn.rotation.z = pinionRad;
    if (dynamicRefs.yoke) dynamicRefs.yoke.rotation.z = pinionRad;

    // Knuckle tie-rod bore world coordinates (bore orbits the kingpin at STEER.arm, leading the kingpin at rest)
    const txL = -STEER.kpX + STEER.arm * Math.sin(rL);
    const tyL = STEER.kpY - STEER.arm * Math.cos(rL);
    const txR = STEER.kpX + STEER.arm * Math.sin(rR);
    const tyR = STEER.kpY - STEER.arm * Math.cos(rR);
    const ex = state.explode / 100;
    const vis = ex < 0.05;
    const rkL = -STEER.rackX + dx, rkR = STEER.rackX + dx;
    const linkErr = Math.max(
      Math.abs(Math.hypot(txL - rkL, tyL - STEER.rackY) - STEER.link),
      Math.abs(Math.hypot(txR - rkR, tyR - STEER.rackY) - STEER.link),
    );
    // Real link plates and upward-locking captive tie-rod pins (Double-D flats clocked 90 deg + rArm to match knuckle fixed bore)
    for (const [link, tpin, rkx, tx, ty, rArm] of [
      [dynamicRefs.linkL, dynamicRefs.tpinL, rkL, txL, tyL, rL],
      [dynamicRefs.linkR, dynamicRefs.tpinR, rkR, txR, tyR, rR],
    ]) {
      if (!link) continue;
      link.visible = tpin.visible = vis;
      link.position.set(rkx, STEER.rackY, STEER.linkZ);
      link.rotation.z = Math.atan2(ty - STEER.rackY, tx - rkx);
      tpin.rotation.set(Math.PI, 0, Math.PI / 2 + rArm);
      tpin.position.set(tx, ty, STEER.tpinHeadZ);
    }

    const deg = (r) => (Math.abs(r) * 180 / Math.PI).toFixed(1);
    const srvDeg = (pinionRad * 180 / Math.PI).toFixed(1);
    const dir = Math.abs(dx) < 0.005 ? 'Straight' : (dx > 0 ? 'Turn LEFT' : 'Turn RIGHT');
    const elAck = $el('hud-ackermann');
    if (elAck) elAck.textContent = `${dir} · L ${deg(rR)}° R ${deg(rL)}° · ideal outer ${deg(sol.ideal)}°`;
    const elRack = $el('hud-rack');
    if (elRack) elRack.textContent = `dx ${dx.toFixed(2)} mm (pinion ${srvDeg}° / ±23.8°) · Δ ${linkErr.toFixed(3)} mm`;
  } else if (dynamicRefs.yoke) {
    dynamicRefs.yoke.rotation.z = steerRad * 0.4;
  }

  // Apply explosion offsets
  const t = state.explode / 100;
  cadRoot.traverse((obj) => {
    if (obj.userData.basePos && obj.userData.expVec) {
      obj.position.copy(obj.userData.basePos).addScaledVector(obj.userData.expVec, t);
      if (obj === dynamicRefs.rack) {
        obj.position.x += lastRackDx;
      }
    }
  });
}

function updateHUD() {
  const srvDeg = ((lastRackDx / STEER.pinionR) * 180 / Math.PI);
  const srvUs = Math.round(1500 + (srvDeg / 23.8) * 132);
  const META = {
    snap: {
      badge: 'Stage 1 · Snap 3+',
      title: '1 · Snap (3+) Utility Dump Truck',
      cards: state.bulldogHood ? 'Card A + Card B + pro_tub_hinge (+ #7)' : 'Card A + Card B + pro_tub_hinge',
      steer: 'Closed Through-Bore Barbell (Zero Play)',
      power: 'Push-Along · Z_axle = 6.25 mm',
      bed: `Enclosed Barrel Hinge · Tip ${Math.round(state.tipDeg)}° (Z=12.5 mm)`,
    },
    pro: {
      badge: 'Stage 3 · Pro 8+',
      title: '3 · Pro (8+) Captive Row-0 Rack-Steered Hauler',
      cards: 'Card A + Card B + Card E1',
      steer: `Double-Shear Clevis + Ø23 Wheel Skirt (${Math.round(state.steerDeg)}° Lock)`,
      power: 'Rear Z10 PTO Ready · Closed 360° Axle Bore',
      bed: `Enclosed Barrel Hinge · Tip ${Math.round(state.tipDeg)}° (Z=12.5 mm)`,
    },
    band: {
      badge: 'Stage 2a · Motion 8+',
      title: '2a · Motion (8+) Pull-Back Doubled-#32 Band + Overrunning Clutch',
      cards: 'Card A + Card B + Card E2 (Pull-Back Band Core)',
      steer: 'Closed Through-Bore Barbell · pull back to wind, no key, latch or bumper',
      power: '4-Leaf Freewheel Spool + Double-Shear PTO (Z=31.25 mm)',
      bed: `Lid Barrel Knuckles · Tip ${Math.round(state.tipDeg)}° (Z=50.0 mm)`,
    },
    jet: {
      badge: "Stage 2b · Motion 8+ (proposal)",
      title: "2b · Motion (8+) Balloon Jet · upright balloon on top (proposal)",
      cards: 'Card A + Card B + mom_jet_valve_body + mom_jet_slide_valve (Card E3)',
      steer: 'Closed Through-Bore Barbell · no tub, no axle gear',
      power: `Balloon Ø${state.balloonD} · lean ${state.balloonLean}° · nozzle Ø${state.jetNozzle} · thrust: see spec §2`,
      bed: 'No dump tub: balloon on the collar, rows 8..9',
    },
    mech: {
      badge: 'Stage 3+ · Pro Add-On 10+',
      title: '3+ · Pro Powered Add-On (10+) Printable PETG RC Servo + Drive/Brain',
      cards: 'Cards A + B + E1 + Card F (PETG, 11 Parts)',
      steer: `Row-2 9g Servo + Horn-Pocket Z10 (${srvDeg.toFixed(1)}° / ${srvUs} µs)`,
      power: 'Double-Shear N20 + 602535 LiPo + XIAO → 25 mm PTO',
      bed: `Brain-Lid Barrel Knuckles · Tip ${Math.round(state.tipDeg)}° (Z=75.0 mm)`,
    },
  }[state.stage];

  $el('stage-badge').textContent = META.badge;
  $el('hud-title').textContent = META.title;
  $el('hud-cards').textContent = META.cards;
  $el('hud-steer').textContent = META.steer;
  $el('hud-power').textContent = META.power;
  $el('hud-bed').textContent = META.bed;
  const illus = [];
  if (state.stage === 'band') illus.push('#32 rubber band (COTS)');
  if (state.stage === 'jet') illus.push('9" latex balloon + hand pump + tube nozzle (COTS)');
  if (state.stage === 'mech') illus.push('N20 + SG90 + 602535 LiPo + PCBA/XIAO (COTS)');
  if (state.showKip && KIP_DRIVER.rig) illus.push(`Kip ${state.driver === 'snap' ? 'Snap 3+' : 'Pro 8+'} rig (${KIP_DRIVER.scale}× cab scale)`);
  $el('hud-illus').textContent = illus.length ? illus.join(' · ') : '—';
  const g1 = $el('hud-g1');   // the jet pose is not covered by any Gate G1 craft: do not claim a pass
  if (state.stage === 'jet') {
    g1.textContent = 'not in Gate G1 · 0 mm³ vs keel (jetcar_table.py)';
    g1.style.color = '#b7791f';
    g1.title = 'Proposal. mom_jet_valve_body seats on rear rows 8..9 with 0 mm³ keel overlap and 1.8 mm to the wheels (parts/kip/jetcar_table.py), but no Gate G1 craft covers this stage.';
  } else {
    g1.textContent = '0.000 mm³ overlap (G1 pass)';
    g1.style.color = '#1fa97c';
    g1.title = 'Verified in toyforge_kitcard.py verify_gate_g1() and probe sweep.';
  }
}

// UI: the controls are DECLARED in truck-menu.js and drawn by the one menu (kip-menu.js; stage 4c of docs/specs/workshop-spec.md).
// What follows are the functions those controls call, and the menu wiring is at the end of the mount.
function setStage(id) {
  if (!TRUCK_STAGES.some((st) => st.id === id)) return;
  state.stage = id;
  state.demoRunning = false;
  resetVehiclePose();
  if (state.stage === 'band' && state.giantWheels) state.giantWheels = false; // the pull-back core has not been through the Ø50 rear-wheel check yet
  if (state.stage === 'pro' || state.stage === 'mech') {
    state.steerDeg = 22;
    state.tipDeg = state.stage === 'mech' ? 18 : PRO_TIP_MIN;
  } else if (state.stage === 'band') {
    state.steerDeg = 0;
    state.tipDeg = 42;
  } else if (state.stage === 'jet') {
    state.steerDeg = 0;
    state.tipDeg = 0;
  } else {
    state.steerDeg = 0;
    state.tipDeg = 22;
  }
  if (STAGE_NOTE[state.stage]) $el('status-text').textContent = STAGE_NOTE[state.stage];
  else if (statusIdleReady) setIdleStatus(); // leaving a stage must not leave its message (the jet proposal, a band phase, the giant-tyre note) on the next one
  rebuildScene();
}

// Stage 2b options: balloon diameter, lean and nozzle (balloon lean 0 = straight up, as the vertical collar gives it)
const JET_D = [125, 150, 175, 200], JET_LEAN = [0, 15, 30, 45], JET_NOZ = [3, 4.5, 6, 8];
const jetControl = (list, key, fmt) => ({
  options: () => list.map((v) => ({ value: String(v), label: fmt(v) })),
  get: () => String(state[key]),
  set: (v) => { state[key] = Number(v); rebuildScene(); updateHUD(); },
});

function setDumpTip(deg) {
  state.demoRunning = false;
  state.tipDeg = Number(deg);
  updateKinematics();
  updateHUD();
}
function setSteerLock(deg) {
  state.demoRunning = false;
  const lim = state.giantWheels ? 25 : 34;
  state.steerDeg = Math.max(-lim, Math.min(lim, Number(deg)));
  updateKinematics();
  updateHUD();
}
function setExplode(pct) {
  state.explode = Number(pct);
  updateKinematics();
}
function setGiantWheels(on) {
  if (Boolean(on) === state.giantWheels) return;
  if (state.stage === 'band' && !state.giantWheels) {
    $el('status-text').textContent = 'Ø50 giant tires have not been checked against the pull-back core yet, so Stage 2a keeps the Ø36 wheels.';
    return;
  }
  state.giantWheels = Boolean(on);
  if (state.giantWheels && Math.abs(state.steerDeg) > 25) state.steerDeg = Math.sign(state.steerDeg) * 25;
  rebuildScene();
}
function setBulldogHood(on) {
  state.bulldogHood = Boolean(on);
  rebuildScene();
}
function setFrontPlow(on) {
  state.frontPlow = Boolean(on);
  rebuildScene();
}

// Print plates (Workshop stages 3 and 4c): the truck's parts AND the Kip driver sitting in the cab, through the print view. Hosted in the Workshop the view is the
// shell's ONE (`env.sharedPrint`), and this bench offers it its source; mounted on its own the bench mounts a view of its own.
const truckParts = () => truckGetParts({ cadRoot, geos: GEOS, partFiles: PART_FILES });
// What sits in the cab, as wardrobe ids: the shared session's once anything wrote to it, else what this bench holds.
const driverWardrobe = () => (sharedKip && kipSession.state.source ? { ...kipSession.state } : sharedDriverPatchFromStack());
const printSource = {
  scene,
  splitByColour: false, // the Truck's part colours are only for looking at it: pack the plates full, whatever the colour (the Plates control splits them)
  notes: ['Truck mechanism: loose plates (sprue only suits static shell parts); axles and pins print lying flat as exported.'],
  // Watched while the plate view is open: anything that changes what is built repacks it (the parts themselves, so a plow or a wheel swap is seen too).
  getState: () => ({ stage: state.stage, driver: state.driver, head: KIP_STACK.head, kip: state.showKip, parts: partsSignature(truckParts()) }),
  getParts: truckParts,
  // The Kip driver prints with the truck, as the Kip bench has it dressed when that bench is mounted (outfit, skin, colours), else in the wardrobe defaults.
  getKipState: () => (state.showKip ? truckDriverPrintState({ driver: driverWardrobe(), kip: kipSession.printState() }) : null),
  setCharacterVisible: (on) => { cadRoot.visible = on; }, // the seated Kip is inside cadRoot, so the plates replace the driver too
  // The driver's face and shirt artwork, so stickers and stencils print from this tab too (the kinds a seated driver can have; see truckStickerSources).
  renderStickerSources: truckStickerSources({ makeFace: createDecalExpressionCanvas, makeShirt: createTorsoOutfitDecalCanvas, skinTones: SKIN_TONES }),
};
const sharedPrint = env.sharedPrint ?? null;
const truckPrint = sharedPrint ? sharedPrint.view : mountPrintView({ THREE, camera, controls, ...printSource });
const unregisterPrint = sharedPrint ? sharedPrint.register('truck', printSource) : null;
globals.truckPrint = truckPrint;

function setKipDriver(on) {
  state.showKip = Boolean(on);
  rebuildScene();
}

// One Kip: the driver head is Kip-Demo's wardrobe head (same meshes, face plate, seat and decal), not the old CAD stack head.
const wardrobeId = (stackId) => stackId.replace(/^(char_head_|robot_head_)/, '').replace('visor', 'robot');
const wardrobeHatId = (stackHat) => {
  if (!stackHat || stackHat === 'off') return 'buds';
  return stackHat === 'hat_wobble_hat' || stackHat === 'wobble_hat' ? 'hat' : stackHat.replace(/^hat_/, '');
};
const stackHeadId = (wid) => wid === 'robot' ? 'robot_head_visor' : wid === 'scout' ? 'robot_head_scout' : `char_head_${wid}`;
function sharedDriverPatchFromStack() {
  return {
    edition: state.driver,
    head: wardrobeId(KIP_STACK.head),
    hair: typeof KIP_STACK.hair === 'string' ? KIP_STACK.hair.replace(/^hair_/, '') : 'off',
    hat: wardrobeHatId(KIP_STACK.hat),
  };
}
function publishSharedDriverState() {
  kipSession.setDriverState(sharedDriverPatchFromStack(), 'truck');
}
function adoptSharedDriverState() {
  const s = kipSession.state;
  if (!s?.source) return false;
  state.driver = s.edition === 'snap' ? 'snap' : 'pro';
  const head = stackHeadId(s.head || 'kid');
  if (KIP_HEADS.includes(head)) KIP_STACK.head = head;
  const hair = !s.hair || s.hair === 'off' ? null : `hair_${s.hair}`;
  if (!KIP_STACK.table || !hair || hair in KIP_STACK.table.hairs) KIP_STACK.hair = hair;
  const hat = !s.hat || s.hat === 'buds' || s.hat === 'off'
    ? null
    : s.hat === 'hat' ? 'wobble_hat' : `hat_${s.hat}`;
  if (!KIP_STACK.table || !hat || KIP_STACK.table.hats.includes(hat)) KIP_STACK.hat = hat;
  return true;
}
function syncTruckWardrobeHead() {
  const exp = KIP_DRIVER.rig?.exp;
  if (!exp) return;
  const wid = sharedKip ? (kipSession.state.head || 'kid') : wardrobeId(KIP_STACK.head);
  exp.altHeadsGroup.visible = true;
  for (const [k, hm] of Object.entries(exp.headMeshes)) hm.visible = (k === wid);
  if (exp.customHeadContainer) exp.customHeadContainer.visible = wid === 'custom';
  exp.altCrownBuds.visible = false;
  const isHuman = HUMAN_HEAD_IDS.has(wid);
  exp.faceplateGroup.visible = isHuman;
  if (isHuman) {
    const dt = WARDROBE_HEADS.find((h) => h.id === wid) || WARDROBE_HEADS[0];
    exp.faceplateHolder.position.set(0, dt.faceY - 2.50 + FACEPLATE_SEAT_MM.raise, FACE_STEM_MM - FACEPLATE_SEAT_MM.sink);
    exp.faceplateMesh.visible = true;
    exp.faceplateVinylMesh.visible = false;
    exp.faceplateFlatMesh.visible = false;
    exp.faceplateDecalPlane.geometry = exp.faceplateDecalGeos.sculpted;
    exp.faceplateDecalPlane.visible = true;
    exp.decalPlane.visible = false;
  } else if (exp.headDecalGeos[wid]) {
    const tex = new THREE.CanvasTexture(createDecalExpressionCanvas('spark', wid, 'sculpted', { onPlate: false }));
    tex.colorSpace = THREE.SRGBColorSpace;
    exp.decalPlane.material.map = tex;
    exp.decalPlane.material.needsUpdate = true;
    exp.decalPlane.geometry = exp.headDecalGeos[wid];
    exp.decalPlane.visible = true;
  } else {
    exp.decalPlane.visible = false;
  }

  // One Kip hair and hats: use the wardrobe slots, exactly like Kip-Demo.html. The stack keeps its
  // CAD-style selection IDs; only the ID prefixes are translated here.
  const stackHairWid = sharedKip
    ? (kipSession.state.hair || 'off')
    : typeof KIP_STACK.hair === 'string' ? KIP_STACK.hair.replace(/^hair_/, '') : 'off';
  const hairWid = isHuman ? stackHairWid : 'off';
  const hairOpt = HAIR_OPTIONS.find((h) => h.id === hairWid) || HAIR_OPTIONS[0];
  const hasHair = isHuman && hairOpt.id !== 'off';
  const hatWid = sharedKip ? (kipSession.state.hat || 'buds') : wardrobeHatId(KIP_STACK.hat);
  const canWearHat = hairOpt.hatReady;
  const headCrownY = (WARDROBE_HEADS.find((h) => h.id === wid) || WARDROBE_HEADS[0]).crownY;
  const hatOpt = HAT_OPTIONS.find((h) => h.id === hatWid);
  const hatColor = HAT_COLORS.find((c) => c.id === hatOpt?.defaultCol) || HAT_COLORS[0];
  exp.expMats.hat.color.set(hatColor.hex);

  exp.hairGroup.visible = hasHair;
  exp.hairAnchor.position.y = headCrownY;
  for (const [k, m] of Object.entries(exp.hairMeshes)) m.visible = hasHair && (k === hairOpt.id);
  exp.hairCrownBuds.position.y = hairOpt.topH;
  exp.hairCrownBuds.visible = hasHair && hairOpt.hatReady;
  exp.altCrownBuds.position.y = headCrownY;
  exp.altCrownBuds.visible = (hatWid !== 'blank' || hasHair);

  KIP_DRIVER.rig.crownAccSlot.visible = canWearHat;
  exp.crownAnchor.position.y = headCrownY + (hasHair ? hairOpt.topH : 0.0);
  KIP_DRIVER.rig.pointyEars.visible = canWearHat && (hatWid === 'ears');
  KIP_DRIVER.rig.wobbleHat.visible = canWearHat && (hatWid === 'hat');
  for (const [k, m] of Object.entries(exp.hatMeshes)) m.visible = canWearHat && (k === hatWid);
  exp.customCrownContainer.visible = canWearHat && (hatWid === 'custom');
}

// Load the one Kip Pro (8+) & Snap (3+) body rig from the shared session (same STLs, creases and joints as Kip-Demo.html).
async function loadKipDriver() {
  try {
    const shared = await kipSession.load();
    if (!shared?.rig) return;
    const { K, geos, baseParts, rig } = shared;
    for (const [n, g] of Object.entries(geos)) KIP_DRIVER.geoNames.set(g, 'stls/' + n);
    for (const [n, g] of Object.entries(baseParts)) KIP_DRIVER.geoNames.set(g, 'partspec/' + n);

    const skinMat = makeMat('#F3BA95', 1, 0.42);
    if (!sharedKip) {
      const slotById = Object.fromEntries(rig.partSlots.map((s) => [s.id, s.grp]));
      const paintSlot = (id, mat) => slotById[id]?.traverse((o) => { if (o.isMesh) o.material = mat; });
      for (const sTag of ['l', 'r']) {
        paintSlot(`upper_arm_${sTag}`, MATS.spark);
        paintSlot(`forearm_${sTag}`, skinMat);
        paintSlot(`hand_${sTag}`, skinMat);
        paintSlot(`thigh_${sTag}`, MATS.denim);
        paintSlot(`shin_${sTag}`, MATS.denim);
        paintSlot(`boot_${sTag}`, MATS.tire);
      }
      paintSlot('torso_pro', MATS.spark);
      paintSlot('torso_snap', MATS.spark);
      rig.backStudsSlot.visible = false;
    }

    KIP_DRIVER.K = K;
    KIP_DRIVER.geos = geos;
    KIP_DRIVER.rig = rig;
    KIP_DRIVER.skinMat = skinMat;
  } catch (e) {
    console.warn('Kip rig unavailable:', e);
  }
}

function setDriverRig(id) {
  if (!KIP_DRIVER.rig) return;
  const next = id === 'snap' ? 'snap' : 'pro';
  if (next === state.driver) return;
  state.driver = next;
  if (sharedKip) kipSession.setDriverState({ edition: state.driver }, 'truck');
  rebuildScene();
  updateHUD();
}
// Head, hair and hat are picked from the stack's own lists (partspec/mockup/kip_stack.json); null is "off".
function setKipStack(kind, value) {
  if (!KIP_STACK.table) return;
  KIP_STACK[kind] = value === 'off' ? null : value;
  if (sharedKip) publishSharedDriverState();
  rebuildScene();
}
const kipIsHuman = () => {
  const T = KIP_STACK.table;
  const hd = T && T.heads[KIP_STACK.head];
  return !hd || !!hd.human;
};
const kipHatBlocked = () => { // a sculpted-top wig has no studs for a hat
  const T = KIP_STACK.table;
  const hr = kipIsHuman() && KIP_STACK.hair && T && T.hairs[KIP_STACK.hair];
  return !!(hr && hr.top === null);
};
const kipStackOptions = {
  head: () => KIP_HEADS.map((id) => ({ value: id, label: kipLabel(id) })),
  hair: () => [{ value: 'off', label: 'Off' }, ...Object.keys(KIP_STACK.table?.hairs ?? {}).map((id) => ({ value: id, label: kipLabel(id) }))],
  hat: () => [{ value: 'off', label: 'Off' }, ...(KIP_STACK.table?.hats ?? []).map((id) => ({ value: id, label: kipLabel(id) }))],
};

function setXray(mode) {
  if (!['auto', 'on', 'off'].includes(mode)) return;
  state.xrayMode = mode;
  rebuildScene();
}
function setAutoSteer(on) {
  if (Boolean(on) === state.sweepRunning) return;
  if (drive.on) setDrive(false);
  state.sweepRunning = Boolean(on);
}
function setDemo(on) {
  if (drive.on) setDrive(false);
  if (Boolean(on) === state.demoRunning) return;
  state.demoRunning = Boolean(on);
  state.demoT = 0;
  resetVehiclePose();
}

const DRIVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];
listen(window, 'keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'g' && !e.repeat) { setDrive(!drive.on); return; }
  if (!drive.on) return;
  if (DRIVE_KEYS.includes(k)) { drive.keys.add(k); e.preventDefault(); }
  else if (k === 'r' && !e.repeat) driveHome();
});
listen(window, 'keyup', (e) => { drive.keys.delete(e.key.toLowerCase()); });
listen(window, 'blur', () => drive.keys.clear());

function goCamera(id) {
  const c = TRUCK_CAMERAS.find((x) => x.id === id);
  if (!c) return;
  camera.position.set(...c.position);
  controls.target.set(...c.target);
  controls.update();
}

if (!hosted) { // a hosted bench is sized by the stage
  listen(window, 'resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Standing message of a stage with a caveat (shown on entering it, replaced on leaving it).
const STAGE_NOTE = {
  jet: 'Proposal: balloon upright on mom_jet_valve_body, no tub. Thrust depends on the body\'s air path and the nozzle (spec section 2, /kip/JetCar-Lab.html). Demo = inflate and vent only.',
};
// The status line's resting text (the stage's own note if it has one). A stage change puts it back once the CAD has loaded (never during
// loading: it would hide the counter).
let statusIdleReady = false;
function setIdleStatus() {
  const note = STAGE_NOTE[state.stage];
  if (note) $el('status-text').textContent = note;
  else $el('status-text').innerHTML = `<b>${PART_FILES.length}</b> verified CAD solids + Kip rig · Drag to orbit · Scroll to zoom`;
}

// Load all the verified CAD solids in parallel
async function init() {
  let loaded = 0;
  const kipLoading = loadKipDriver();
  await Promise.all(PART_FILES.map(async (pid) => {
    const raw = await loader.loadAsync(`/kip/partspec/mockup/${pid}.stl`);
    const merged = mergeVertices(raw, 1e-4);
    GEOS[pid] = toCreasedNormals(merged, THREE.MathUtils.degToRad(32));
    loaded++;
    $el('status-text').innerHTML = `Loaded <b>${loaded}/${PART_FILES.length}</b> CAD solids`;
  }));
  statusIdleReady = true;
  setIdleStatus();
  KIP_STACK.table = await (await fetch('/kip/partspec/mockup/kip_stack.json', { cache: 'no-cache' })).json();
  await kipLoading;
  {
    const q0 = new URLSearchParams(getSearch());   // ?driver=snap&head=fox&hair=bob&hat=ballcap  (hair=off / hat=off allowed)
    const drv = q0.get('driver') || q0.get('edition');
    if (drv === 'snap') state.driver = 'snap';
    else if (drv === 'pro' || drv === 'kip' || drv === 'human') state.driver = 'pro';
    const resolveHead = (v) => {
      if (!v) return undefined;
      if (v === 'robot' || v === 'visor') return 'robot_head_visor';
      if (v === 'scout') return 'robot_head_scout';
      for (const cand of [v, `char_head_${v}`, `robot_head_${v}`]) {
        if (KIP_HEADS.includes(cand)) return cand;
      }
      return undefined;
    };
    const pick = (v, pre, ok) => { if (v === null) return undefined; if (v === 'off') return null; const id = v.startsWith(pre) ? v : pre + v; return ok(id) ? id : undefined; };
    const h = resolveHead(q0.get('head')); if (h) KIP_STACK.head = h;
    const w = pick(q0.get('hair'), 'hair_', (i) => i in KIP_STACK.table.hairs); if (w !== undefined) KIP_STACK.hair = w;
    const t = pick(q0.get('hat'), 'hat_', (i) => KIP_STACK.table.hats.includes(i) || i === 'hat_wobble_hat'); if (t !== undefined) KIP_STACK.hat = t;
    if (q0.get('hat') === 'wobble_hat') KIP_STACK.hat = 'wobble_hat';
    if (sharedKip) {
      if (!kipSession.state.source && !kipSession.owners.includes('kip')) {
        publishSharedDriverState();
      } else {
        const patch = {};
        if (drv) patch.edition = state.driver;
        if (h) patch.head = wardrobeId(h);
        if (w !== undefined) patch.hair = w ? w.replace(/^hair_/, '') : 'off';
        if (t !== undefined || q0.get('hat') === 'wobble_hat') patch.hat = wardrobeHatId(KIP_STACK.hat);
        if (Object.keys(patch).length) kipSession.setDriverState(patch, 'truck');
        adoptSharedDriverState();
      }
    }
  }
  rebuildScene();
  truckLoaded = true;
  // Deep-link / debug params: ?stage=pro&steer=22&tip=10&cam=top&explode=40&wheels=giant
  const q = new URLSearchParams(getSearch());
  if (q.get('wheels') === 'giant') setGiantWheels(true);
  if (q.get('stage')) setStage(q.get('stage'));
  if (state.stage === 'jet') {   // ?stage=jet&balloon=200&lean=30&nozzle=8
    if (q.has('balloon')) state.balloonD = Number(q.get('balloon'));
    if (q.has('lean')) state.balloonLean = Number(q.get('lean'));
    if (q.has('nozzle')) state.jetNozzle = Number(q.get('nozzle'));
    rebuildScene();
  }
  if (q.has('steer')) { state.steerDeg = Number(q.get('steer')); }
  if (q.has('tip')) { state.tipDeg = Number(q.get('tip')); }
  if (q.has('demoT')) { state.demoRunning = true; state.demoT = Number(q.get('demoT')); state.demoHold = q.get('hold') === '1'; } // ?demoT=1.9&hold=1
  if (q.has('explode')) { state.explode = Number(q.get('explode')); }
  updateKinematics(); updateHUD();
  if (q.get('cam')) goCamera(q.get('cam'));
  if (q.get('cp')) { const [a, b, c, d2, e, f] = q.get('cp').split(',').map(Number); camera.position.set(a, b, c); controls.target.set(d2, e, f); controls.update(); }
  if (q.get('ui') === '0') { benchRoot.classList.add('clean-ui'); benchRoot.querySelectorAll('.topbar').forEach((el) => { el.style.display = 'none'; }); }
  globals.__TRUCK_READY__ = true;
  if (q.get('probe')) {   // ?probe=1&stage=pro&steer=22 dumps this pose; ?probe=sweep dumps a list of poses (below). Both write JSON into the DOM for scripts.
    const pre = document.createElement('pre');
    pre.id = 'truck-probe';
    pre.textContent = JSON.stringify(q.get('probe') === 'sweep' ? globals.__truckProbeSweep() : globals.__truckProbe());
    benchRoot.appendChild(pre);
  }
}

// Poses for the numeric overlap check (scripts rebuild each as solids): straight, both rack stops, tipped bed, giant tires at their lock, every stage + both Pro & Snap Kip rigs.
globals.__truckProbeSweep = (cases = [
  { stage: 'pro', steerDeg: 0, tipDeg: 22 }, { stage: 'pro', steerDeg: 45, tipDeg: 22 }, { stage: 'pro', steerDeg: -45, tipDeg: 22 },
  { stage: 'pro', steerDeg: 20, tipDeg: 55 }, { stage: 'pro', giantWheels: true, steerDeg: 25 }, { stage: 'pro', giantWheels: true, steerDeg: -25 },
  { stage: 'pro', driver: 'snap', steerDeg: 22, tipDeg: 22 },
  { stage: 'mech', steerDeg: 30, tipDeg: 22 }, { stage: 'mech', steerDeg: 0, tipDeg: 55 },
  { stage: 'mech', driver: 'snap', steerDeg: 0, tipDeg: 18 },
  { stage: 'band', steerDeg: 0, tipDeg: 0 }, { stage: 'band', tipDeg: 55 },
  { stage: 'jet', tipDeg: 0 },
  { stage: 'snap', tipDeg: 0 }, { stage: 'snap', tipDeg: 55 },
]) => cases.map((c) => {
  Object.assign(state, { driver: 'pro', giantWheels: false, steerDeg: 0, tipDeg: 22 }, c);
  rebuildScene();
  return { case: c, rows: globals.__truckProbe() };
});

// Test hook: every visible mesh's pose in the CAD frame plus its source geometry, so a script can rebuild the whole assembly as solids and
// boolean-check it (viewer-only illustrations such as boxes, hoses and the balloon have no source geometry and are skipped).
globals.__truckProbe = () => {
  updateKinematics();
  cadRoot.updateMatrixWorld(true);
  const inv = cadRoot.matrixWorld.clone().invert();
  const names = new Map(Object.entries(GEOS).map(([pid, g]) => [g, pid]));
  const rows = [];
  cadRoot.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const geo = names.get(o.geometry) || KIP_DRIVER.geoNames.get(o.geometry);
    if (geo) rows.push({ geo, m: inv.clone().multiply(o.matrixWorld).elements.slice() });
  });
  return rows;
};

// ---------------------------------------------------------------------------
// Driving: the vehicle faces +Z. Rolling is derived from actual displacement, so tires never slip or skate.
// ---------------------------------------------------------------------------
const REAR_AXLE_Z = -43.75; // rear axle center in the vehicle frame (CAD y = +43.75 -> three z = -43.75)
const pose = { px: 0, pz: -90, psi: 0, spinPlus: 0, spinMinus: 0, prevPlus: null, prevMinus: null }; // rear-axle-center pose, steered hub spin angles, last knuckle angles
const drive = { on: false, v: 0, keys: new Set(), hudAt: 0, lastX: 0, lastZ: 0 };
function resetVehiclePose() {
  pose.px = 0; pose.pz = -90; pose.psi = 0; pose.prevPlus = null; pose.prevMinus = null;
  state.spoolSpin = 0;
  vehicleWrap.position.set(0, 0, 0);
  vehicleWrap.rotation.y = 0;
  if (drive.on) driveHome(); // a stage change while driving puts the truck back at the start
}

function applyPose() { // place the wrap so the REAR AXLE CENTER sits at (pose.px, pose.pz) with heading pose.psi
  vehicleWrap.rotation.y = pose.psi;
  vehicleWrap.position.set(
    pose.px - REAR_AXLE_Z * Math.sin(pose.psi), 0, pose.pz - REAR_AXLE_Z * Math.cos(pose.psi));
}

// ---------------------------------------------------------------------------
// Keyboard driving (Workshop, 2026-11-03). The model is truck-drive.js (pure, unit-tested): speed from the keys, steering from the real rack linkage,
// yaw from the two solved wheel angles, rolling without slip. G toggles it, W/S speed, A/D steer, Space brake, Q/E tip the bed, R back to the start.
// Only the Pro Powered Add-On is powered (there the keys play the remote); every other stage is pushed by hand, and only the two rack-steered stages steer.
// ---------------------------------------------------------------------------
const SUN_OFFSET = { x: -140, y: 240, z: 160 };
const DRIVE_CELL = 12.5;

function driveInput() {
  const k = drive.keys;
  const has = (...names) => names.some((n) => k.has(n));
  return {
    throttle: (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0),
    brake: k.has(' '),
    steerDir: (has('a', 'arrowleft') ? 1 : 0) - (has('d', 'arrowright') ? 1 : 0), // + = left (the vehicle's left is +X)
    tip: (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0),
  };
}

function drivePlace() { // the grid, floor shadow and sun follow the truck
  const wx = vehicleWrap.position.x, wz = vehicleWrap.position.z;
  driveGrid.position.x = Math.round(wx / DRIVE_CELL) * DRIVE_CELL;
  driveGrid.position.z = Math.round(wz / DRIVE_CELL) * DRIVE_CELL;
  ground.position.set(wx, 0, wz);
  sun.position.set(wx + SUN_OFFSET.x, SUN_OFFSET.y, wz + SUN_OFFSET.z);
  sun.target.position.set(wx, 0, wz);
  sun.target.updateMatrixWorld();
}

function driveHome() { // truck, camera and world back to the start (the camera keeps its view of the truck)
  const dx = vehicleWrap.position.x, dz = vehicleWrap.position.z;
  camera.position.x -= dx; camera.position.z -= dz;
  controls.target.x -= dx; controls.target.z -= dz;
  pose.px = 0; pose.pz = REAR_AXLE_Z; pose.psi = 0; pose.prevPlus = null; pose.prevMinus = null;
  applyPose();
  drive.v = 0;
  drive.lastX = vehicleWrap.position.x; drive.lastZ = vehicleWrap.position.z;
  state.steerDeg = 0;
  drivePlace();
  updateKinematics();
}

function updateDriveHud(p) {
  $el('drive-mode').textContent = p.powered ? 'RC drive: the keys are the remote' : 'Pushed by hand';
  $el('drive-speed').textContent = `${(Math.abs(drive.v) / 1000).toFixed(2)} m/s${drive.v < -0.5 ? ' (reverse)' : ''}`;
  $el('drive-steer').textContent = p.steered ? `${state.steerDeg >= 0 ? 'left' : 'right'} ${Math.abs(Math.round(state.steerDeg))}°` : 'fixed axle';
  $el('drive-note').textContent = p.powered ? ' · viewer model, no firmware built yet' : '';
}

function setDrive(on) {
  if (on === drive.on) return;
  $el('drive-hud').hidden = !on;
  if (on) {
    state.demoRunning = false;
    state.sweepRunning = false;
    state.demoT = 0;
    drive.on = true;
    drive.keys.clear();
    resetVehiclePose(); // (drive.on is set, so this ends in driveHome())
    grid.visible = false;
    driveGrid.visible = true;
    updateDriveHud(driveParams({ stage: state.stage, giantWheels: state.giantWheels }));
  } else {
    driveHome();
    drive.on = false;
    drive.keys.clear();
    resetVehiclePose();
    ground.position.set(0, 0, 0);
    sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    grid.visible = true;
    driveGrid.visible = false;
    updateKinematics();
    updateHUD();
  }
}

/** One frame of driving; the loop calls it with the real dt, the test hook with a fixed one. */
function driveFrame(dt, input) {
  const p = driveParams({ stage: state.stage, giantWheels: state.giantWheels });
  drive.v = stepSpeed(drive.v, input, p, dt);
  const steerWas = state.steerDeg;
  state.steerDeg = p.steered ? stepSteer(state.steerDeg, input.steerDir, p, dt) : 0;
  const sol = p.steered ? steerSolution(state.steerDeg) : null;
  const psiDot = sol ? yawRate(drive.v, sol, STEER.wheelbase) : 0;
  advancePose(pose, drive.v, psiDot, dt);
  applyPose();
  state.wheelSpin += (drive.v * dt) / p.wRad; // rolling without slip
  if (sol) {
    if (pose.prevPlus === null) { pose.prevPlus = sol.aPlus; pose.prevMinus = sol.aMinus; }
    pose.spinPlus += hubRoll(1, sol.aPlus, pose.prevPlus, drive.v, psiDot, dt) / p.wRad;
    pose.spinMinus += hubRoll(-1, sol.aMinus, pose.prevMinus, drive.v, psiDot, dt) / p.wRad;
    pose.prevPlus = sol.aPlus;
    pose.prevMinus = sol.aMinus;
  }
  applyWheelSpin();
  let changed = state.steerDeg !== steerWas;
  if (input.tip) {
    state.tipDeg = Math.max(tipMinDeg(), Math.min(55, state.tipDeg + input.tip * 40 * dt));
    changed = true;
  }
  if (changed) updateKinematics();
  // the camera keeps its orbit around the truck: it travels with it
  const dx = vehicleWrap.position.x - drive.lastX, dz = vehicleWrap.position.z - drive.lastZ;
  camera.position.x += dx; camera.position.z += dz;
  controls.target.x += dx; controls.target.z += dz;
  drive.lastX = vehicleWrap.position.x; drive.lastZ = vehicleWrap.position.z;
  drivePlace();
  drive.hudAt += dt;
  if (drive.hudAt > 0.12 || changed) { drive.hudAt = 0; updateDriveHud(p); }
}

// Test hook for the 2a pull-back loop: freezes the demo clock at demoT and reports what the parts are doing, so a script can step the cycle frame by frame.
globals.__truckBand = {
  step(t) { state.demoT = t; stepBandDemo(t, state.giantWheels ? 25.0 : 18.0); }, // the same function the loop calls, no frame needed
  snap: () => ({
    t: state.demoT, phase: state.demoPhase, z: vehicleWrap.position.z, y: vehicleWrap.position.y, wheelSpin: state.wheelSpin,
    spool: dynamicRefs.coreSpool ? dynamicRefs.coreSpool.rotation.x : null, gear: dynamicRefs.coreGear ? dynamicRefs.coreGear.rotation.x : null,
    wRad: state.giantWheels ? 25.0 : 18.0, stage: state.stage, status: $el('status-text').textContent,
  }),
};

// Test hook: the same driveFrame the loop calls, stepped with a fixed dt, so a script can drive deterministically.
globals.__truckDrive = {
  set: setDrive,
  get on() { return drive.on; },
  step(dt, input = {}) { driveFrame(dt, { throttle: 0, brake: false, steerDir: 0, tip: 0, ...input }); },
  pose: () => ({
    px: pose.px, pz: pose.pz, psi: pose.psi, v: drive.v, steerDeg: state.steerDeg, wheelSpin: state.wheelSpin,
    spinPlus: pose.spinPlus, spinMinus: pose.spinMinus, wrapX: vehicleWrap.position.x, wrapZ: vehicleWrap.position.z, tipDeg: state.tipDeg,
  }),
  params: () => driveParams({ stage: state.stage, giantWheels: state.giantWheels }),
  solution: (deg) => steerSolution(deg),
  wheelbase: STEER.wheelbase,
  rearAxleZ: REAR_AXLE_Z,
  camera: () => camera.position.toArray(),
  target: () => controls.target.toArray(),
  hud: () => ({ shown: !$el('drive-hud').hidden, mode: $el('drive-mode').textContent, speed: $el('drive-speed').textContent, steer: $el('drive-steer').textContent, note: $el('drive-note').textContent }),
};

function driveStraight(z, wRad) { // straight-line drive along the vehicle's +Z (forward)
  const dz = z - vehicleWrap.position.z;
  if (Math.abs(dz) < 20) state.wheelSpin += dz / wRad; // rolling without slip; bigger jumps are loop resets (teleports)
  vehicleWrap.position.set(0, 0, z);
}

function applyWheelSpin() { // +X rotation = rolling toward +Z (forward)
  if (dynamicRefs.rearAxle) dynamicRefs.rearAxle.rotation.x = state.wheelSpin;
  if (dynamicRefs.frontAxle) dynamicRefs.frontAxle.rotation.x = state.wheelSpin;
  if (dynamicRefs.spinPlus) dynamicRefs.spinPlus.rotation.x = pose.spinPlus;
  if (dynamicRefs.spinMinus) dynamicRefs.spinMinus.rotation.x = pose.spinMinus;
  // 1:1 Z10 PTO: coreGear and ptoShaft mesh the axle gear (-wheelSpin), while coreSpool uses spoolSpin (halting at slack during coast)
  if (dynamicRefs.coreGear) dynamicRefs.coreGear.rotation.x = -state.wheelSpin;
  if (dynamicRefs.ptoShaft) dynamicRefs.ptoShaft.rotation.x = -state.wheelSpin;
  if (dynamicRefs.coreSpool) dynamicRefs.coreSpool.rotation.x = state.spoolSpin;
}

// Distance a steered hub rolls in one step. Two parts: (1) rigid-body velocity of the hub projected on the wheel heading;
// (2) steering swings the hub 15 mm around the kingpin (the scrub offset), which moves it along its rolling direction.
function hubRoll(side, a, aPrev, v, psiDot, dt) {
  const xh = side * (STEER.kpX + 15.0 * Math.cos(a));            // hub centre, CAD x
  const zh = -(STEER.kpY + side * 15.0 * Math.sin(a) - 43.75);   // forward distance ahead of the rear axle
  const body = psiDot * zh * Math.sin(a) + (v - psiDot * xh) * Math.cos(a);
  return body * dt - side * 15.0 * (a - aPrev);
}

/** One pose of the 2a pull-back loop at demo time `demoT` (s). The animation loop and the test hook both call this, so what the test steps is what runs. */
function stepBandDemo(demoT, wRad) {
  const smooth = (u) => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c); };
  // 6 s Pull-Back Band Core loop, in SLOW MOTION (pull-back only, as decided: no key, no latch, no bumper). One wheel turn is one spool turn
  // (1:1 Z10 PTO), so the band winds exactly as far as the wheels roll backward and unwinds exactly as far as they roll forward; once it is slack
  // the overrunning clutch frees the wheels and the truck coasts. Spool angle = pull-back distance / wheel radius, locked to the PTO gear:
  // 0.0..0.5 s  set on the line, band slack
  // 0.5..2.0 s  pull back by hand: wheels roll backward, the clutch locks, the band winds onto the spool
  // 2.0..2.4 s  held, wound
  // 2.4..3.8 s  release: the band turns the spool back, the clutch locks the other way and drives the wheels forward over the same distance
  // 3.8 s on    slack: the spool stops, the wheels coast to a stop on their own (rolling drag)
  // 5.0..6.0 s  lift and set back on the line (wheels off the floor: nothing winds)
  const TURNS = 1.25;                       // shown; the spec's full wind is 2.5 turns (about 28 cm, too long for this view)
  const D = TURNS * 2 * Math.PI * wRad;     // pull-back distance, 141 mm on the O36 wheel
  const ZS = 20.0;                          // the line
  const K = 1.3, T_D = 1.4;                 // drive: s(u) = (3-K) u^2 + (K-2) u^3 starts from rest and ends at K x the mean speed
  const v0 = (K * D) / T_D;                 // mm/s when the band goes slack
  const tStop = 1.1;                        // s: the coast ends well before the lift (5.0 s), so the truck is at rest when it is picked up
  const DECEL = v0 / tStop;                 // mm/s^2: slow-motion rolling drag, constant
  const dc = 0.5 * v0 * tStop;              // coast distance
  const cyc = demoT % 6.0;
  let z = ZS, spool = 0, lift = 0, phase = 'set', roll = true;
  if (cyc < 0.5) { z = ZS; roll = false; } // resting on the line: the wheels do not turn
  else if (cyc < 2.0) { z = ZS - D * smooth((cyc - 0.5) / 1.5); spool = (ZS - z) / wRad; phase = 'pull'; }
  else if (cyc < 2.4) { z = ZS - D; spool = D / wRad; phase = 'hold'; }
  else if (cyc < 3.8) {
    const u = (cyc - 2.4) / T_D;
    z = ZS - D + D * ((3 - K) * u * u + (K - 2) * u * u * u);
    spool = (ZS - z) / wRad;
    phase = 'drive';
  } else if (cyc < 3.8 + tStop) { const t = cyc - 3.8; z = ZS + v0 * t - 0.5 * DECEL * t * t; phase = 'coast'; }
  else if (cyc < 5.0) { z = ZS + dc; phase = 'coast'; }
  else { const u = smooth((cyc - 5.0) / 1.0); z = ZS + dc * (1 - u); lift = 12 * Math.sin(Math.PI * u); phase = 'setback'; roll = false; }
  if (roll) driveStraight(z, wRad); else vehicleWrap.position.set(0, lift, z);
  state.spoolSpin = spool;
  applyWheelSpin();
  if (state.demoPhase !== phase) {
    state.demoPhase = phase;
    $el('status-text').textContent = {
      set: 'Pull-back band, slow motion. Set on the line: the band is slack.',
      pull: 'Pull back: the wheels roll backward, the clutch locks and the band winds onto the spool, one turn for one wheel turn.',
      hold: `Held: ${TURNS} turns wound (the spec's full wind is 2.5 turns, about 28 cm).`,
      drive: 'Release: the band unwinds, the clutch locks the other way and drives the wheels forward over the same distance.',
      coast: 'Band slack: the spool stops, the overrunning clutch frees the wheels and the truck coasts.',
      setback: 'Lift and set back on the line: with the wheels off the floor nothing winds.',
    }[phase];
  }
}

const clock = new THREE.Clock();
function animate() {
  if (disposed) return;
  if (!hosted) raf = requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = state.demoHold ? 0 : rawDt; // ?hold=1 freezes the demo clock for deterministic screenshots
  if (state.sweepRunning) {
    state.steerDeg = Math.sin(clock.getElapsedTime() * 2.2) * (state.giantWheels ? 25 : 34);
    updateKinematics();
  }

  if (drive.on && GEOS.kit_keel_base) driveFrame(dt, driveInput());

  if (state.demoRunning && GEOS.kit_keel_base) {
    state.demoT += dt;
    const lim = state.giantWheels ? 25 : 34;
    const wRad = state.giantWheels ? 25.0 : 18.0; // matches kit_wheel_giant R = 24.97 / kit_wheel_med R = 17.98
    const smooth = (u) => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c); };

    if (state.stage === 'pro' || state.stage === 'mech') {
      // Slalom: kinematic bicycle at the rear axle. The yaw rate comes from the two REAL solved wheel angles
      // (cot(dc) = mean of the wheel cotangents), so the truck actually turns where its wheels point.
      const v = 34.0; // mm/s
      state.steerDeg = Math.sin(state.demoT * 0.9) * lim;
      const sol = steerSolution(state.steerDeg);
      const cotAvg = 0.5 * (1 / Math.tan(sol.aPlus) + 1 / Math.tan(sol.aMinus));
      const tanC = Number.isFinite(cotAvg) && cotAvg !== 0 ? 1 / cotAvg : 0;
      const psiDot = (v * tanC) / STEER.wheelbase;
      pose.psi += psiDot * dt;
      pose.px += v * Math.sin(pose.psi) * dt;
      pose.pz += v * Math.cos(pose.psi) * dt;
      if (pose.pz > 90 || Math.abs(pose.px) > 70) { pose.px = 0; pose.pz = -90; pose.psi = 0; } // loop the course
      applyPose();
      state.wheelSpin += (v * dt) / wRad;
      if (pose.prevPlus === null) { pose.prevPlus = sol.aPlus; pose.prevMinus = sol.aMinus; }
      pose.spinPlus += hubRoll(1, sol.aPlus, pose.prevPlus, v, psiDot, dt) / wRad;
      pose.spinMinus += hubRoll(-1, sol.aMinus, pose.prevMinus, v, psiDot, dt) / wRad;
      pose.prevPlus = sol.aPlus;
      pose.prevMinus = sol.aMinus;
      applyWheelSpin();
      if (state.stage === 'mech') {
        state.tipDeg = 15.0 + Math.sin(state.demoT * 1.5) * 15.0;
      }
    } else if (state.stage === 'band') {
      stepBandDemo(state.demoT, wRad);
    } else if (state.stage === 'jet') {
      // 4.5 s inflate / vent loop. The truck stays put on purpose: the body as drawn is predicted too restrictive to move it (docs/specs/parts-engineering-spec.md section 5).
      const cyc = state.demoT % 4.5;
      state.jetFill = cyc < 1.5 ? smooth(cyc / 1.5) : cyc < 2.0 ? 1 : cyc < 4.0 ? 1 - 0.97 * smooth((cyc - 2.0) / 2.0) : 0.03;
      if (dynamicRefs.jetStream) dynamicRefs.jetStream.visible = cyc >= 2.0 && cyc < 4.0;
      applyJetBalloon();
      state.tipDeg = 0;
    } else {
      state.tipDeg = 27.5 - Math.cos(state.demoT * 1.8) * 27.5;
    }
    updateKinematics();
    updateHUD();
  }
  controls.update();
  renderer.render(scene, camera);
}

// The one menu (stage 4c): this bench DECLARES its controls (truck-menu.js) over the functions above and the print view; the host's single panel draws them.
// Hosted, the panel is the Workshop's (`env.sharedMenu`) and is shown while this bench is active; standalone, the bench has a host of its own.
const pair = (get, set) => ({ get, set });
const truckMenuApi = {
  stage: pair(() => state.stage, setStage),
  demo: pair(() => state.demoRunning, setDemo),
  tip: { ...pair(() => state.tipDeg, setDumpTip), min: () => tipMinDeg() },
  steer: pair(() => state.steerDeg, setSteerLock),
  explode: pair(() => state.explode, setExplode),
  giant: pair(() => state.giantWheels, setGiantWheels),
  hood: pair(() => state.bulldogHood, setBulldogHood),
  plow: pair(() => state.frontPlow, setFrontPlow),
  xray: pair(() => state.xrayMode, setXray),
  sweep: pair(() => state.sweepRunning, setAutoSteer),
  drive: pair(() => drive.on, setDrive),
  kip: pair(() => state.showKip, setKipDriver),
  rig: pair(() => state.driver, setDriverRig),
  head: { options: kipStackOptions.head, ...pair(() => KIP_STACK.head ?? 'off', (v) => setKipStack('head', v)) },
  hair: { options: kipStackOptions.hair, visible: kipIsHuman, ...pair(() => KIP_STACK.hair ?? 'off', (v) => setKipStack('hair', v)) },
  hat: { options: kipStackOptions.hat, visible: () => !kipHatBlocked(), ...pair(() => KIP_STACK.hat ?? 'off', (v) => setKipStack('hat', v)) },
  jet: {
    visible: () => state.stage === 'jet',
    balloon: jetControl(JET_D, 'balloonD', (v) => `Ø${v}`),
    lean: jetControl(JET_LEAN, 'balloonLean', (v) => `${v}°`),
    nozzle: jetControl(JET_NOZ, 'jetNozzle', (v) => `Ø${v}`),
  },
  goCamera,
  print: {
    isOn: () => truckPrint.isOn(), busy: () => truckPrint.isBusy(), summary: () => truckPrint.summary(),
    setOn: (on) => (on ? truckPrint.enter() : truckPrint.exit()),
    plateCount: () => truckPrint.plateCount(), plateIndex: () => truckPrint.plateIndex(),
    plateLabel: (i) => truckPrint.plateLabel(i), setPlate: (i) => truckPrint.setPlate(i),
    profile: () => truckPrint.profile(), setPreset: (id) => truckPrint.setPreset(id), updateProfile: (p) => truckPrint.updateProfile(p),
    supportCheck: () => truckPrint.supportCheck(), setSupportCheck: (on) => truckPrint.setSupportCheck(on),
    splitByColour: () => truckPrint.splitByColour(), setSplitByColour: (v) => truckPrint.setSplitByColour(v),
    download: (kind) => truckPrint.download(kind),
  },
};
const truckMenuCtx = {
  title: 'Truck controls',
  fabLabel: '☰ Truck controls',
  groups: () => buildTruckMenu(truckMenuApi),
  camera,
  viewSize: () => (hosted ? stage.size() : { width: window.innerWidth, height: window.innerHeight }),
  isActive: () => active,
  ready: () => globals.__TRUCK_READY__ === true,
};
if (env.features?.downloads === false) delete truckMenuApi.print; // a host with no file exits: no Print group (see workshop.js `downloads`)
const sharedMenu = env.sharedMenu ?? null;
const menuHost = sharedMenu ?? createMenuHost();
// The published handle is the panel's, except that `.ctx` stays THIS bench's even while another bench holds the shared panel.
const showMenu = () => { globals.truckMenu = Object.create(menuHost.show('truck', truckMenuCtx, { root: benchRoot }), { ctx: { get: () => truckMenuCtx, enumerable: true } }); };
if (!hosted) showMenu(); // hosted: setActive() shows it when this bench becomes the active one

// Test hook: the bench's own state, read-only.
globals.truckState = () => ({ ...state, kipHead: KIP_STACK.head, kipHair: KIP_STACK.hair, kipHat: KIP_STACK.hat, driveOn: drive.on });

const ready = init();
if (!hosted) animate(); // hosted: the stage's loop calls frame()

const PUBLISHED = ["__TRUCK_READY__", "__truckProbe", "__truckProbeSweep", "__truckDrive", "__truckBand", "truckPrint", "truckMenu", "truckState"];
function teardown() {
  kipSession.releaseRef('truck');
  if (sharedMenu) sharedMenu.hide('truck'); else menuHost.destroy();
  if (sharedPrint) unregisterPrint(); else globals.truckPrint?.dispose?.();
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
    showMenu();
    if (truckLoaded) {
      if (sharedKip) adoptSharedDriverState();
      rebuildScene();
      updateKinematics();
      updateHUD();
    }
  } else {
    sharedPrint?.release('truck'); // plates open on this bench's parts close first, so the pose saved below is the bench's own
    menuHost.hide('truck');
    kipSession.release('truck');
    drive.keys.clear(); // a key held when the bench is switched away must not keep driving it
    drive.v = 0;        // and the truck is not left rolling for when it comes back
    camPose.position.copy(camera.position);
    camPose.target.copy(controls.target);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
}
if (hosted) benchRoot.hidden = true; // a hosted bench starts hidden until the stage activates one
return { root: benchRoot, ready, dispose, frame, setActive, hosted };
}
