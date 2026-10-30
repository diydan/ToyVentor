// ToyVentor Kip — Phase 1 Wardrobe + Phase 2 Modular Vehicles & Sit/Ride/Straddle Poses
import { createDecalExpressionCanvas } from './kip-forge-sdk.js';

export const WARDROBE_HEADS = [
  { id: 'classic', label: 'Kip Classic', crownY: 42.2 },
  { id: 'kid',     label: 'Kid (Boy/Girl)', crownY: 36.0 },
  { id: 'robot',   label: 'Bolt Robot',     crownY: 35.5 },
  { id: 'fox',     label: 'Fox',            crownY: 35.5 },
  { id: 'bear',    label: 'Bear',           crownY: 35.5 },
];

export const CROWN_OPTIONS = [
  { id: 'buds',     label: 'Spark Buds' },
  { id: 'swoosh',   label: 'Swoosh Hair' },
  { id: 'pigtails', label: 'Pigtails' },
  { id: 'curly',    label: 'Curly Hair' },
  { id: 'mohawk',   label: 'Mohawk' },
  { id: 'ears',     label: 'Pointy Ears' },
  { id: 'horns',    label: 'Bumper Horns' },
  { id: 'hat',      label: 'Wobble Hat' },
  { id: 'blank',    label: 'Blank Cap' },
];

export const BACK_OPTIONS = [
  { id: 'off',      label: 'Off' },
  { id: 'explorer', label: 'Explorer Pack' },
  { id: 'jetpack',  label: 'Bolt Jetpack' },
  { id: 'wings',    label: 'Cloud Wings' },
  { id: 'gears',    label: 'Pro 2:1 Gears' },
];

export const PROP_OPTIONS = [
  { id: 'off',        label: 'Off' },
  { id: 'wrench',     label: 'Pro Wrench' },
  { id: 'shield',     label: 'Star Shield' },
  { id: 'shaft',      label: 'Pro Spinner' },
  { id: 'skateboard', label: 'Skateboard' },
];

export const VEHICLE_OPTIONS = [
  { id: 'none',    label: 'On Foot' },
  { id: 'car',     label: 'Roadster Car' },
  { id: 'truck',   label: 'Hauler Truck' },
  { id: 'scooter', label: 'Motor Scooter' },
  { id: 'moto',    label: 'Sport Motorbike' },
];

export async function loadExpansionGeos(loadSTL) {
  const entries = await Promise.all([
    // Universal neck collar (`kip.scad`)
    ['neckTurret2x1',   loadSTL('/kip/stls/neck_turret_2x1.stl', 36)],
    // Phase 1 Wardrobe STLs
    ['charHeadKid',     loadSTL('/kip/partspec/toyventor_char_head_kid_S.stl', 34)],
    ['charHeadFox',     loadSTL('/kip/partspec/toyventor_char_head_fox_S.stl', 34)],
    ['charHeadBear',    loadSTL('/kip/partspec/toyventor_char_head_bear_S.stl', 34)],
    ['robotHeadVisor',  loadSTL('/kip/partspec/toyventor_robot_head_visor_S.stl', 35)],
    ['hairSwoosh',      loadSTL('/kip/partspec/toyventor_hair_swoosh_S.stl', 32)],
    ['hairPigtails',    loadSTL('/kip/partspec/toyventor_hair_pigtails_S.stl', 32)],
    ['hairCurly',       loadSTL('/kip/partspec/toyventor_hair_curly_S.stl', 30)],
    ['hairMohawk',      loadSTL('/kip/partspec/toyventor_hair_mohawk_S.stl', 34)],
    ['bumperHorns',     loadSTL('/kip/partspec/toyventor_bumper_horns_S.stl', 34)],
    ['packExplorer',    loadSTL('/kip/partspec/toyventor_pack_explorer_S.stl', 35)],
    ['robotJetpack',    loadSTL('/kip/partspec/toyventor_robot_back_jetpack_S.stl', 35)],
    ['propWrench',      loadSTL('/kip/partspec/toyventor_prop_wrench_P.stl', 35)],
    ['propStarShield',  loadSTL('/kip/partspec/toyventor_prop_star_shield_P.stl', 35)],
    ['skateboardDeck',  loadSTL('/kip/partspec/toyventor_prop_skateboard_deck_S.stl', 35)],
    ['racerAxle',       loadSTL('/kip/partspec/toyventor_racer_axle_S.stl', 35)],
    ['racerWheel',      loadSTL('/kip/partspec/toyventor_racer_wheel_S.stl', 30)],
    // Phase 2 Seated Snap & Modular Vehicles
    ['charLegsSeated',  loadSTL('/kip/partspec/toyventor_char_legs_seated_S.stl', 35)],
    ['vehCarChassis',   loadSTL('/kip/partspec/toyventor_veh_car_chassis_S.stl', 35)],
    ['vehSteeringWheel',loadSTL('/kip/partspec/toyventor_veh_steering_wheel_P.stl', 32)],
    ['vehTruckChassis', loadSTL('/kip/partspec/toyventor_veh_truck_chassis_S.stl', 35)],
    ['vehScooterFrame', loadSTL('/kip/partspec/toyventor_veh_scooter_frame_S.stl', 35)],
    ['vehHandlebarFork',loadSTL('/kip/partspec/toyventor_veh_handlebar_fork_P.stl', 35)],
    ['vehMotoCowling',  loadSTL('/kip/partspec/toyventor_veh_moto_cowling_S.stl', 35)],
    ['shaftTu07',       loadSTL('/kip/partspec/toyventor_shaft_tu07_P.stl', 35)],
    ['wheelTu06',       loadSTL('/kip/partspec/toyventor_wheel_tu06_P.stl', 30)],
    // Wave 6 Racer Kit Add-Ons
    ['racerBullBar',    loadSTL('/kip/partspec/toyventor_racer_bull_bar_S.stl', 35)],
    ['racerHoodScoop',  loadSTL('/kip/partspec/toyventor_racer_hood_scoop_S.stl', 35)],
    ['racerLightBar',   loadSTL('/kip/partspec/toyventor_racer_light_bar_S.stl', 35)],
    ['racerRoofRack',   loadSTL('/kip/partspec/toyventor_racer_roof_rack_S.stl', 35)],
    ['racerSpoiler',    loadSTL('/kip/partspec/toyventor_racer_spoiler_S.stl', 35)],
    ['racerTwinExhaust',loadSTL('/kip/partspec/toyventor_racer_twin_exhaust_S.stl', 35)],
    ['glowCapsule',     loadSTL('/kip/partspec/toyventor_glow_capsule_S.stl', 32)],
    // Phase 3 Pre-Verified LLM SDK Examples
    ['customWizardHat', loadSTL('/kip/custom/toyventor_custom_wizard_hat_S.stl', 32)],
    ['customStarWand',  loadSTL('/kip/custom/toyventor_custom_star_wand_P.stl', 35)],
    ['customHoodCrest', loadSTL('/kip/custom/toyventor_custom_hood_crest_S.stl', 34)],
  ]);
  const out = {};
  for (const [k, p] of entries) out[k] = await p;
  return out;
}

export function attachExpansionToKipRig(THREE, kip, expGeos, baseParts, mats, scadMesh, createSlot) {
  // Brand-aligned wardrobe materials (`BRAND_STYLE.md`)
  const expMats = {
    cobalt:  new THREE.MeshPhysicalMaterial({ color: '#2E6FDB', roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    teal:    new THREE.MeshPhysicalMaterial({ color: '#1FA6A0', roughness: 0.35, clearcoat: 0.44, envMapIntensity: 0.76 }),
    plum:    new THREE.MeshPhysicalMaterial({ color: '#7C4DFF', roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    sun:     new THREE.MeshPhysicalMaterial({ color: '#FFB830', roughness: 0.34, clearcoat: 0.46, envMapIntensity: 0.78 }),
    fox:     new THREE.MeshPhysicalMaterial({ color: '#E86F38', roughness: 0.44, clearcoat: 0.24, envMapIntensity: 0.70 }),
    bear:    new THREE.MeshPhysicalMaterial({ color: '#B58052', roughness: 0.48, clearcoat: 0.18, envMapIntensity: 0.66 }),
    botSilv: new THREE.MeshPhysicalMaterial({ color: '#DCE3EE', roughness: 0.32, metalness: 0.12, clearcoat: 0.48, envMapIntensity: 0.80 }),
    tire:    new THREE.MeshPhysicalMaterial({ color: '#20232A', roughness: 0.56, clearcoat: 0.15, envMapIntensity: 0.55 }),
    custom:  new THREE.MeshPhysicalMaterial({ color: '#7C4DFF', roughness: 0.32, clearcoat: 0.50, envMapIntensity: 0.80 }),
  };

  // Helper: convert LAY_FLAT ([90,0,0]) shaft STL (y_stl = -L..0, z_stl = 0..5) into X-centered horizontal axle
  function makeAxleX(shaftGeo, lengthMm, mat = mats.proSlate) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(shaftGeo, mat);
    m.castShadow = true;
    m.position.set(0, lengthMm * 0.5, -2.5);
    g.add(m);
    g.rotation.z = Math.PI / 2;
    return g;
  }

  function makeWheelX(wheelGeo, widthMm, mat = expMats.tire) {
    const spinGrp = new THREE.Group();
    const m = new THREE.Mesh(wheelGeo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.z = -widthMm * 0.5;
    const orient = new THREE.Group();
    orient.rotation.y = Math.PI / 2; // local Z -> world +X
    orient.add(m);
    spinGrp.add(orient);
    return spinGrp;
  }

  function makeHandheldProp(propGeo, mat, gripCenterZ = 14.0, halfThick = 2.5) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(propGeo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(0, gripCenterZ, -halfThick);
    g.add(m);
    g.rotation.z = Math.PI / 2; // blade extends along +X out of Kip's C-grip palm!
    g.position.set(0, -11.4, 2.3);
    return g;
  }

  // 1. Universal Neck Turret (`neck_turret_2x1`) + 4 Swappable PartSpec Heads (`kid`, `robot`, `fox`, `bear`)
  const neckTurret2x1Slot = createSlot('neck_turret_2x1', kip.neckAnchor, [0, 22, 0], 3.85, 'both');
  const ntMesh = scadMesh(expGeos.neckTurret2x1, mats.spark);
  ntMesh.position.y = -3.3;
  neckTurret2x1Slot.add(ntMesh);
  neckTurret2x1Slot.visible = false;

  const altHeadsGroup = new THREE.Group();
  altHeadsGroup.visible = false;
  kip.headLocal.add(altHeadsGroup);

  const altHeadSlot = createSlot('alt_head', altHeadsGroup, [0, 44, 0], 4.05, 'both', 'neck_anchor');
  const headMeshes = {
    kid:   scadMesh(expGeos.charHeadKid, mats.shell),
    robot: scadMesh(expGeos.robotHeadVisor, expMats.botSilv),
    fox:   scadMesh(expGeos.charHeadFox, expMats.fox),
    bear:  scadMesh(expGeos.charHeadBear, expMats.bear),
  };
  for (const hm of Object.values(headMeshes)) {
    hm.position.y = 5.5;
    hm.visible = false;
    altHeadSlot.add(hm);
  }

  // Mandatory `#FF6B4A` 2x1 Spark Crown Buds overlay on PartSpec heads (`BRAND_STYLE.md` rule 3)
  const altCrownBuds = new THREE.Group();
  for (const sx of [-6.25, 6.25]) {
    const bud = new THREE.Mesh(new THREE.CylinderGeometry(3.42, 3.42, 2.9, 28), mats.spark);
    bud.castShadow = true;
    bud.position.set(sx, 1.45, 0);
    altCrownBuds.add(bud);
  }
  altHeadSlot.add(altCrownBuds);

  // Conformal Shrink-Wrapped 2D Vinyl/Screen Decal Expression Meshes (`BRAND_STYLE.md` rule 5: zero moulded 3D faces!)
  // Raycasts a fine 20x12 grid directly onto each head's front shell + 0.42 mm so decals hug every brow, snout & muzzle with zero clipping!
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, 0, -1);

  function buildConformalDecalGeo(headGeo, centerY, width, height) {
    const probe = new THREE.Mesh(headGeo, mats.shell);
    probe.rotation.x = -Math.PI / 2;
    probe.position.y = 5.5;
    probe.updateMatrixWorld(true);

    const g = new THREE.PlaneGeometry(width, height, 20, 12);
    g.translate(0, centerY, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      rayOrigin.set(vx, vy, 50);
      raycaster.set(rayOrigin, rayDir);
      const hits = raycaster.intersectObject(probe, false);
      const hitZ = hits.length > 0 ? hits[0].point.z : (19.5 - (vx * vx) * 0.015);
      pos.setZ(i, hitZ + 0.42);
    }
    g.computeVertexNormals();
    return g;
  }

  const headDecalGeos = {
    kid:   buildConformalDecalGeo(expGeos.charHeadKid,     22.6, 25.0, 12.6),
    robot: buildConformalDecalGeo(expGeos.robotHeadVisor,  22.8, 24.4, 12.0),
    fox:   buildConformalDecalGeo(expGeos.charHeadFox,     22.8, 26.5, 13.4),
    bear:  buildConformalDecalGeo(expGeos.charHeadBear,    22.4, 25.0, 13.0),
  };

  const classicWrapGeo = new THREE.PlaneGeometry(25.5, 12.8, 16, 1);
  const cPos = classicWrapGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i);
    cPos.setZ(i, -(x * x) * 0.011);
  }
  classicWrapGeo.computeVertexNormals();

  const decalTex = new THREE.CanvasTexture(createDecalExpressionCanvas('spark', 'kid'));
  decalTex.colorSpace = THREE.SRGBColorSpace;
  const decalMat = new THREE.MeshStandardMaterial({
    map: decalTex,
    transparent: true,
    roughness: 0.28,
    metalness: 0.02,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const decalPlane = new THREE.Mesh(headDecalGeos.kid, decalMat);
  decalPlane.renderOrder = 2;
  altHeadSlot.add(decalPlane);

  // Also add a curved visor decal overlay for Classic Kip so all 6 expressions work on Classic Kip too!
  const classicDecalPlane = new THREE.Mesh(classicWrapGeo, decalMat);
  classicDecalPlane.position.set(0, 19.8, 23.0);
  classicDecalPlane.visible = false;
  classicDecalPlane.renderOrder = 2;
  kip.visorSlot.add(classicDecalPlane);

  // 2. Dynamic Crown Accessory Anchor (adjusts Y automatically between Classic Kip 42.2 mm & PartSpec heads 35.5-36.0 mm!)
  const crownAnchor = new THREE.Group();
  crownAnchor.position.set(0, 42.2, 0);
  kip.crownAccSlot.add(crownAnchor);

  // Re-parent existing pointyEars & wobbleHat into crownAnchor at local y = 0!
  kip.pointyEars.position.set(0, 0, 0);
  kip.wobbleHat.position.set(6.25, 0, 0);
  crownAnchor.add(kip.pointyEars, kip.wobbleHat);

  const crownHairMeshes = {
    swoosh:    scadMesh(expGeos.hairSwoosh, expMats.cobalt),
    pigtails:  scadMesh(expGeos.hairPigtails, expMats.sun),
    curly:     scadMesh(expGeos.hairCurly, expMats.plum),
    mohawk:    scadMesh(expGeos.hairMohawk, mats.spark),
    horns:     scadMesh(expGeos.bumperHorns, expMats.sun),
    wizardHat: scadMesh(expGeos.customWizardHat, expMats.plum),
  };
  for (const m of Object.values(crownHairMeshes)) {
    m.visible = false;
    crownAnchor.add(m);
  }

  // Custom / Photo-Forge dynamic mount containers
  const customCrownContainer = new THREE.Group();
  crownAnchor.add(customCrownContainer);
  const customHeadContainer = new THREE.Group();
  customHeadContainer.position.y = 5.5;
  altHeadSlot.add(customHeadContainer);

  // 3. Backpacks (`pack_explorer`, `robot_back_jetpack`, plus Custom/Photo-Wings!)
  const explorerGroup = new THREE.Group();
  explorerGroup.visible = false;
  kip.hips.add(explorerGroup);
  const explorerSlot = createSlot('pack_explorer', explorerGroup, [0, 22, -88], 5.2, 'both', 'back_studs');
  const expPackMesh = new THREE.Mesh(expGeos.packExplorer, expMats.teal);
  expPackMesh.castShadow = true;
  expPackMesh.receiveShadow = true;
  expPackMesh.rotation.y = Math.PI;
  expPackMesh.position.set(0, 26.0, -13.6);
  explorerSlot.add(expPackMesh);

  const jetpackGroup = new THREE.Group();
  jetpackGroup.visible = false;
  kip.hips.add(jetpackGroup);
  const jetpackSlot = createSlot('robot_jetpack', jetpackGroup, [0, 26, -88], 5.2, 'both', 'back_studs');
  const jetMesh = new THREE.Mesh(expGeos.robotJetpack, mats.spark);
  jetMesh.castShadow = true;
  jetMesh.receiveShadow = true;
  jetMesh.rotation.y = Math.PI;
  jetMesh.position.set(0, 32.25, -13.6);
  jetpackSlot.add(jetMesh);

  const customBackGroup = new THREE.Group();
  customBackGroup.visible = false;
  kip.hips.add(customBackGroup);
  const customBackSlot = createSlot('custom_back', customBackGroup, [0, 24, -92], 5.25, 'both', 'back_studs');
  const customBackContainer = new THREE.Group();
  customBackContainer.position.set(0, 26.0, -13.6);
  customBackSlot.add(customBackContainer);

  // 4. Right-Hand Props (`prop_wrench`, `prop_star_shield`, `custom_star_wand`, plus Custom/Photo Hand!)
  const wrenchGroup = new THREE.Group();
  wrenchGroup.visible = false;
  kip.joints.rightHandCgripParent.add(wrenchGroup);
  const wrenchSlot = createSlot('prop_wrench', wrenchGroup, [-98, -44, 22], 5.4, 'both', 'hand_r');
  wrenchSlot.add(makeHandheldProp(expGeos.propWrench, expMats.cobalt, 18.75, 2.5));

  const shieldGroup = new THREE.Group();
  shieldGroup.visible = false;
  kip.joints.rightHandCgripParent.add(shieldGroup);
  const shieldSlot = createSlot('prop_shield', shieldGroup, [-98, -44, 24], 5.4, 'both', 'hand_r');
  shieldSlot.add(makeHandheldProp(expGeos.propStarShield, expMats.sun, 13.5, 3.5));

  const customWandGroup = new THREE.Group();
  customWandGroup.visible = false;
  kip.joints.rightHandCgripParent.add(customWandGroup);
  const customWandSlot = createSlot('custom_wand', customWandGroup, [-98, -44, 24], 5.4, 'both', 'hand_r');
  customWandSlot.add(makeHandheldProp(expGeos.customStarWand, expMats.plum, 13.5, 3.3));

  const customHandGroup = new THREE.Group();
  customHandGroup.visible = false;
  kip.joints.rightHandCgripParent.add(customHandGroup);
  const customHandSlot = createSlot('custom_hand', customHandGroup, [-98, -44, 24], 5.45, 'both', 'hand_r');
  const customHandContainer = new THREE.Group();
  customHandSlot.add(customHandContainer);

  // 5. Foot Skateboard (`prop_skateboard_deck` + 2x `racer_axle` + 4x `racer_wheel`!)
  const skateboardGroup = new THREE.Group();
  skateboardGroup.visible = false;
  kip.mover.add(skateboardGroup);
  const skateDeckSlot = createSlot('skate_deck', skateboardGroup, [0, -18, 0], 0.1, 'both');
  const deckMesh = scadMesh(expGeos.skateboardDeck, mats.spark);
  deckMesh.position.y = 2.75; // 9.0 mm wheel radius - 6.25 mm axle height = 2.75 mm belly clearance!
  skateDeckSlot.add(deckMesh);

  const skateWheels = [];
  for (const [sfx, zAx] of [['f', 18.75], ['r', -18.75]]) {
    const axSlot = createSlot(`skate_ax_${sfx}`, skateboardGroup, [0, -28, zAx * 0.6], 0.05, 'both', 'skate_deck');
    const ax = makeAxleX(expGeos.racerAxle, 37.5, mats.proSlate);
    ax.position.set(0, 9.0, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 15.75], ['r', -15.75]]) {
      const wSlot = createSlot(`skate_w_${sfx}_${ws}`, skateboardGroup, [wx * 2.2, -26, zAx * 0.6], 0.02, 'both', `skate_ax_${sfx}`);
      const wSpin = makeWheelX(expGeos.racerWheel, 6.0, expMats.tire);
      wSpin.position.set(wx, 9.0, zAx);
      wSlot.add(wSpin);
      skateWheels.push(wSpin);
    }
  }

  // 6. Seated Snap Lower Body (`char_legs_seated`) for Snap 3+ Vehicle Mode!
  const snapSeatedLegsGroup = new THREE.Group();
  snapSeatedLegsGroup.visible = false;
  kip.mover.add(snapSeatedLegsGroup);
  const snapSeatedLegsSlot = createSlot('char_legs_seated', snapSeatedLegsGroup, [0, 14, 0], 1.2, 'snap');
  const seatedLegsMesh = scadMesh(expGeos.charLegsSeated, expMats.cobalt);
  snapSeatedLegsSlot.add(seatedLegsMesh);

  // =========================================================================
  // 7. PHASE 2: MODULAR 12.5 mm TU VEHICLES (`Car`, `Truck`, `Scooter / Moto`)
  // =========================================================================
  const vehiclesRoot = new THREE.Group();
  kip.mover.add(vehiclesRoot);

  // --- A) ROADSTER CAR (`4x10 TU` + `wheel_tu04` + `veh_steering_wheel` + Wave 6 Racer Kit) ---
  const carGroup = new THREE.Group();
  carGroup.visible = false;
  vehiclesRoot.add(carGroup);
  const carY = 18.75; // 25.0 mm wheel radius - 6.25 mm axle bore height -> tires tangent to y = 0!

  const carBodySlot = createSlot('veh_car_chassis', carGroup, [0, -10, 0], 0.5, 'both');
  const carChassisMesh = scadMesh(expGeos.vehCarChassis, mats.spark);
  carChassisMesh.position.y = carY;
  carBodySlot.add(carChassisMesh);

  const carSteerSlot = createSlot('car_steer', carGroup, [0, 38, 22], 1.4, 'both', 'veh_car_chassis');
  const carSteerPivot = new THREE.Group();
  carSteerPivot.position.set(0, carY + 34.5, 20.3125);
  const carSteerFlip = new THREE.Group();
  carSteerFlip.rotation.x = Math.PI / 2; // rim on top, pin pointing -Y down into dash_bore!
  const carSteerMesh = new THREE.Mesh(expGeos.vehSteeringWheel, expMats.tire);
  carSteerMesh.castShadow = true;
  carSteerFlip.add(carSteerMesh);
  carSteerPivot.add(carSteerFlip);
  carSteerSlot.add(carSteerPivot);

  const carWheels = [];
  for (const [sfx, zAx] of [['f', 37.5], ['r', -37.5]]) {
    const axSlot = createSlot(`car_ax_${sfx}`, carGroup, [0, -24, zAx * 0.5], 0.25, 'both', 'veh_car_chassis');
    const ax = makeAxleX(expGeos.shaftTu07, 87.5, mats.proSlate);
    ax.position.set(0, 25.0, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 37.5], ['r', -37.5]]) {
      const wSlot = createSlot(`car_w_${sfx}_${ws}`, carGroup, [wx * 1.6, -16, zAx * 0.4], 0.1, 'both', `car_ax_${sfx}`);
      const wSpin = makeWheelX(baseParts.wheelTu04, 12.5, expMats.tire);
      wSpin.position.set(wx, 25.0, zAx);
      wSlot.add(wSpin);
      carWheels.push(wSpin);
    }
  }

  // Roadster Car Wave 6 Racer Kit Add-Ons + Custom Hood Mount!
  const carRacerGroup = new THREE.Group();
  carGroup.add(carRacerGroup);
  const addCarAddon = (id, geo, mat, x, yLocal, z, exVec) => {
    const sl = createSlot(id, carRacerGroup, exVec, 1.8, 'both', 'veh_car_chassis');
    const m = scadMesh(geo, mat);
    m.position.set(x, carY + yLocal, z);
    sl.add(m);
    return { slot: sl, mesh: m };
  };
  addCarAddon('car_bull', expGeos.racerBullBar, expMats.sun, 0, 15.5, 56.25, [0, 14, 58]);
  const carHoodScoopAddon = addCarAddon('car_scoop', expGeos.racerHoodScoop, expMats.cobalt, 0, 19.0, 37.5, [0, 34, 28]);
  addCarAddon('car_light', expGeos.racerLightBar, expMats.sun, 0, 23.0, -18.75, [0, 42, -18]);
  addCarAddon('car_spoiler', expGeos.racerSpoiler, expMats.cobalt, 0, 19.0, -31.25, [0, 36, -42]);
  addCarAddon('car_exhaust', expGeos.racerTwinExhaust, mats.shell, 0, 15.5, -50.0, [0, 16, -64]);

  const customHoodGroup = new THREE.Group();
  customHoodGroup.visible = false;
  carGroup.add(customHoodGroup);
  const customHoodSlot = createSlot('custom_hood', customHoodGroup, [0, 38, 28], 1.85, 'both', 'veh_car_chassis');
  const customHoodContainer = new THREE.Group();
  customHoodContainer.position.set(0, carY + 19.0, 37.5);
  customHoodSlot.add(customHoodContainer);

  // --- B) HAULER TRUCK (`4x12 TU` + `wheel_tu06` Monster Wheels + Roof Rack + Cargo Bed!) ---
  const truckGroup = new THREE.Group();
  truckGroup.visible = false;
  vehiclesRoot.add(truckGroup);
  const truckY = 31.25; // 37.5 mm wheel_tu06 radius - 6.25 mm axle height!

  const truckBodySlot = createSlot('veh_truck_chassis', truckGroup, [0, -8, 0], 0.5, 'both');
  const truckChassisMesh = scadMesh(expGeos.vehTruckChassis, expMats.teal);
  truckChassisMesh.position.y = truckY;
  truckBodySlot.add(truckChassisMesh);

  const truckSteerSlot = createSlot('truck_steer', truckGroup, [0, 38, 22], 1.4, 'both', 'veh_truck_chassis');
  const truckSteerPivot = new THREE.Group();
  truckSteerPivot.position.set(0, truckY + 34.5, 20.3125);
  const truckSteerFlip = new THREE.Group();
  truckSteerFlip.rotation.x = Math.PI / 2;
  const truckSteerMesh = new THREE.Mesh(expGeos.vehSteeringWheel, expMats.tire);
  truckSteerMesh.castShadow = true;
  truckSteerFlip.add(truckSteerMesh);
  truckSteerPivot.add(truckSteerFlip);
  truckSteerSlot.add(truckSteerPivot);

  const truckWheels = [];
  for (const [sfx, zAx] of [['f', 37.5], ['r', -56.25]]) {
    const axSlot = createSlot(`trk_ax_${sfx}`, truckGroup, [0, -26, zAx * 0.4], 0.25, 'both', 'veh_truck_chassis');
    const ax = makeAxleX(expGeos.shaftTu07, 87.5, mats.proSlate);
    ax.position.set(0, 37.5, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 37.5], ['r', -37.5]]) {
      const wSlot = createSlot(`trk_w_${sfx}_${ws}`, truckGroup, [wx * 1.7, -18, zAx * 0.3], 0.1, 'both', `trk_ax_${sfx}`);
      const wSpin = makeWheelX(expGeos.wheelTu06, 12.5, expMats.tire);
      wSpin.position.set(wx, 37.5, zAx);
      wSlot.add(wSpin);
      truckWheels.push(wSpin);
    }
  }

  const truckRacerGroup = new THREE.Group();
  truckGroup.add(truckRacerGroup);
  const trkBullSlot = createSlot('trk_bull', truckRacerGroup, [0, 14, 58], 1.8, 'both', 'veh_truck_chassis');
  const trkBullMesh = scadMesh(expGeos.racerBullBar, expMats.sun);
  trkBullMesh.position.set(0, truckY + 16.0, 56.25);
  trkBullSlot.add(trkBullMesh);

  const trkRackSlot = createSlot('trk_rack', truckRacerGroup, [0, 44, -25], 1.85, 'both', 'veh_truck_chassis');
  const trkRackMesh = scadMesh(expGeos.racerRoofRack, mats.spark);
  trkRackMesh.position.set(0, truckY + 26.0, -25.0);
  trkRackSlot.add(trkRackMesh);

  const trkCargoSlot = createSlot('trk_cargo', truckRacerGroup, [-16, 36, -56], 1.9, 'both', 'veh_truck_chassis');
  const trkCargoPack = scadMesh(expGeos.packExplorer, expMats.sun);
  trkCargoPack.position.set(-12.5, truckY + 14.5, -56.25);
  const trkGlow = scadMesh(expGeos.glowCapsule, expMats.plum);
  trkGlow.position.set(12.5, truckY + 14.5, -56.25);
  trkCargoSlot.add(trkCargoPack, trkGlow);

  // --- C) 2-IN-1 MOTOR SCOOTER & SPORT MOTORBIKE (`2x10 TU` + `veh_handlebar_fork` + `veh_moto_cowling`) ---
  const bikeGroup = new THREE.Group();
  bikeGroup.visible = false;
  vehiclesRoot.add(bikeGroup);
  const bikeLeanGroup = new THREE.Group(); // leans into turns dynamically!
  bikeGroup.add(bikeLeanGroup);
  const bikeY = 18.75; // 25.0 mm wheel_tu04 radius - 6.25 mm axle height!

  const bikeFrameSlot = createSlot('veh_scooter_frame', bikeLeanGroup, [0, -10, 0], 0.5, 'both');
  const bikeFrameMesh = scadMesh(expGeos.vehScooterFrame, expMats.cobalt);
  bikeFrameMesh.position.y = bikeY;
  bikeFrameSlot.add(bikeFrameMesh);

  // Turning Handlebar Fork (`LAY_FLAT` STL: y_stl = [-44..0], z_stl = [0..6.6])
  const bikeForkSlot = createSlot('veh_handlebar_fork', bikeLeanGroup, [0, 42, 26], 1.4, 'both', 'veh_scooter_frame');
  const bikeForkPivot = new THREE.Group();
  bikeForkPivot.position.set(0, bikeY + 10.0, 25.0); // stem rises inside headtube at z = 25.0!
  const bikeForkOrient = new THREE.Group();
  bikeForkOrient.rotation.x = Math.PI; // -y_stl -> +Y_three (stem 0..25, riser/bars 25..44!), z centered
  const bikeForkMesh = new THREE.Mesh(expGeos.vehHandlebarFork, expMats.tire);
  bikeForkMesh.castShadow = true;
  bikeForkMesh.position.set(0, 0, -3.3);
  bikeForkOrient.add(bikeForkMesh);
  bikeForkPivot.add(bikeForkOrient);
  bikeForkSlot.add(bikeForkPivot);

  // Detachable `2x2` Sport Motorbike Tank & Windscreen Cowling!
  const motoCowlingGroup = new THREE.Group();
  motoCowlingGroup.visible = false;
  bikeLeanGroup.add(motoCowlingGroup);
  const motoCowlingSlot = createSlot('veh_moto_cowling', motoCowlingGroup, [0, 38, 6], 1.65, 'both', 'veh_scooter_frame');
  const motoCowlingMesh = scadMesh(expGeos.vehMotoCowling, mats.spark);
  motoCowlingMesh.position.set(0, bikeY + 13.5, 0);
  motoCowlingSlot.add(motoCowlingMesh);

  const bikeRacerGroup = new THREE.Group();
  bikeLeanGroup.add(bikeRacerGroup);
  const bikeExhSlot = createSlot('bike_exhaust', bikeRacerGroup, [0, 16, -62], 1.75, 'both', 'veh_scooter_frame');
  const bikeExhMesh = scadMesh(expGeos.racerTwinExhaust, mats.shell);
  bikeExhMesh.position.set(0, bikeY + 15.5, -50.0);
  bikeExhSlot.add(bikeExhMesh);

  const bikeWheels = [];
  for (const [sfx, zAx] of [['f', 43.75], ['r', -43.75]]) {
    const axSlot = createSlot(`bike_ax_${sfx}`, bikeLeanGroup, [0, -24, zAx * 0.4], 0.25, 'both', 'veh_scooter_frame');
    const ax = makeAxleX(baseParts.shaftTu05, 62.5, mats.proSlate);
    ax.position.set(0, 25.0, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 25.0], ['r', -25.0]]) {
      const wSlot = createSlot(`bike_w_${sfx}_${ws}`, bikeLeanGroup, [wx * 1.8, -16, zAx * 0.3], 0.1, 'both', `bike_ax_${sfx}`);
      const wSpin = makeWheelX(baseParts.wheelTu04, 12.5, expMats.tire);
      wSpin.position.set(wx, 25.0, zAx);
      wSlot.add(wSpin);
      bikeWheels.push(wSpin);
    }
  }

  return {
    expGeos,
    expMats,
    neckTurret2x1Slot,
    altHeadsGroup,
    headMeshes,
    headDecalGeos,
    altCrownBuds,
    decalPlane,
    classicDecalPlane,
    decalTex,
    crownAnchor,
    crownHairMeshes,
    explorerGroup,
    jetpackGroup,
    wrenchGroup,
    shieldGroup,
    customWandGroup,
    skateboardGroup,
    skateWheels,
    snapSeatedLegsGroup,
    snapSeatedLegsSlot,
    // Vehicles
    carGroup,
    carSteerPivot,
    carWheels,
    carRacerGroup,
    carHoodScoopAddon,
    truckGroup,
    truckSteerPivot,
    truckWheels,
    truckRacerGroup,
    bikeGroup,
    bikeLeanGroup,
    bikeForkPivot,
    motoCowlingGroup,
    bikeRacerGroup,
    bikeWheels,
    // Custom / Photo-Forge containers
    customCrownContainer,
    customHeadContainer,
    customBackGroup,
    customBackContainer,
    customHandGroup,
    customHandContainer,
    customHoodGroup,
    customHoodContainer,
  };
}

// ===========================================================================
// PRO (8+) & SNAP (3+) DEDICATED VEHICLE & RIDING CLIPS
// ===========================================================================
function buildKeyframedKipClip(THREE, clipName, dur, poseFn) {
  const steps = 49;
  const times = new Float32Array(steps);
  const d2r = THREE.MathUtils.degToRad;
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const names = [
    'Hips', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot',
    'RightUpLeg', 'RightLeg', 'RightFoot',
  ];
  const bufs = Object.fromEntries(names.map(n => [n, new Float32Array(steps * 4)]));
  const pBuf = new Float32Array(steps * 3);

  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * dur;
    const ph = (t / dur) * Math.PI * 2;
    times[i] = t;
    const setQ = (nm, rx, ry, rz, order = 'ZYX') => {
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), order));
      const b = bufs[nm];
      if (i > 0 && (b[(i - 1) * 4] * q.x + b[(i - 1) * 4 + 1] * q.y + b[(i - 1) * 4 + 2] * q.z + b[(i - 1) * 4 + 3] * q.w) < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
      }
      b[i * 4] = q.x; b[i * 4 + 1] = q.y; b[i * 4 + 2] = q.z; b[i * 4 + 3] = q.w;
    };
    const hp = poseFn(ph, setQ);
    pBuf[i * 3 + 0] = hp[0];
    pBuf[i * 3 + 1] = hp[1];
    pBuf[i * 3 + 2] = hp[2];
  }
  const tracks = [new THREE.VectorKeyframeTrack('kip_Hips.position', times, pBuf)];
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${n}.quaternion`, times, bufs[n]));
  return new THREE.AnimationClip(clipName, dur, tracks);
}

// 1. Car & Hauler Truck Seated Driving Clip (`drive_sit`)
export function makeDriveSitClip(THREE) {
  return buildKeyframedKipClip(THREE, 'drive_sit', 2.2, (ph, setQ) => {
    const bob = Math.sin(ph * 2) * 0.6;
    const steerOsc = Math.sin(ph) * 4.0;
    setQ('Hips', -4, 0, Math.sin(ph) * 1.2);
    setQ('Head', 4 + Math.cos(ph) * 2.0, steerOsc * 1.8, Math.sin(ph) * 2.0);

    // Symmetric two-hand inward reach onto the Ø 36 mm 3-spoke steering wheel rim!
    setQ('LeftArm',  -54 + steerOsc, -12, -16);
    setQ('LeftForeArm', -24, -10, -6);
    setQ('LeftHand', 6, 0, -10);

    setQ('RightArm', -54 - steerOsc,  12,  16);
    setQ('RightForeArm', -24,  10,  6);
    setQ('RightHand', 6, 0, 10);

    // Seated 90-deg hips + tucked knees inside recessed 4x2 cockpit!
    setQ('LeftUpLeg',  -84, -4,  5); setQ('LeftLeg',  56, 0, 0); setQ('LeftFoot',  14, 0, 0);
    setQ('RightUpLeg', -84,  4, -5); setQ('RightLeg', 56, 0, 0); setQ('RightFoot', 14, 0, 0);
    return [0, 61.5 + bob, 0];
  });
}

// 2. Step-Through Motor Scooter Upright Seated Clip (`scooter_ride`)
export function makeScooterRideClip(THREE) {
  return buildKeyframedKipClip(THREE, 'scooter_ride', 2.0, (ph, setQ) => {
    const bob = Math.sin(ph * 2) * 0.7;
    setQ('Hips', 4, 0, Math.sin(ph) * 1.5);
    setQ('Head', -4, Math.sin(ph) * 6.0, Math.cos(ph) * 2.5);

    // Relaxed upright arms reaching forward onto twin Ø6.60 mm scooter handlebars!
    setQ('LeftArm',  -64,  6, 10);
    setQ('LeftForeArm', -18, -6, 0);
    setQ('LeftHand', 8, 0, 0);

    setQ('RightArm', -64, -6, -10);
    setQ('RightForeArm', -18, 6, 0);
    setQ('RightHand', 8, 0, 0);

    // Feet together forward on the 2x2 step-through floorboard!
    setQ('LeftUpLeg',  -78, -2,  3); setQ('LeftLeg',  74, 0, 0); setQ('LeftFoot',  0, 0, 0);
    setQ('RightUpLeg', -78,  2, -3); setQ('RightLeg', 74, 0, 0); setQ('RightFoot', 0, 0, 0);
    return [0, 61.5 + bob, 0];
  });
}

// 3. Sport Motorbike Forward-Lean Straddle Clip (`moto_straddle`)
export function makeMotoStraddleClip(THREE) {
  return buildKeyframedKipClip(THREE, 'moto_straddle', 1.8, (ph, setQ) => {
    const vibe = Math.sin(ph * 3) * 0.5;
    // Sporty 22-deg forward torso crouch over `veh_moto_cowling` tank + looking level ahead!
    setQ('Hips', 22, 0, Math.sin(ph) * 1.8);
    setQ('Head', -20, Math.sin(ph) * 5.0, Math.sin(ph) * 2.5);

    // Forward reach gripping the twin Ø6.60 mm sport handlebars!
    setQ('LeftArm',  -76,  8, 14);
    setQ('LeftForeArm', -16, -8, 0);
    setQ('LeftHand', 12, 0, 0);

    setQ('RightArm', -76, -8, -14);
    setQ('RightForeArm', -16, 8, 0);
    setQ('RightHand', 12, 0, 0);

    // Thighs splayed wide (+-24 deg) straddling the 2x2 tank cowling, knees tucked back onto rear pegs!
    setQ('LeftUpLeg',  -72, -14,  24); setQ('LeftLeg',  92, 0, 0); setQ('LeftFoot',  12, 0, -10);
    setQ('RightUpLeg', -72,  14, -24); setQ('RightLeg', 92, 0, 0); setQ('RightFoot', 12, 0,  10);
    return [0, 61.5 + vibe, 0];
  });
}

// 4. Skateboard Action Stance Clip (`skate_cruise`)
export function makeSkateboardClip(THREE) {
  return buildKeyframedKipClip(THREE, 'skate_cruise', 2.0, (ph, setQ) => {
    const carve = Math.sin(ph);
    // Sideways goofy/regular skate torso twist looking forward (+Z)!
    setQ('Hips', 8, -42, carve * 4.0);
    setQ('Head', -6, 42 + carve * 6.0, carve * 3.0);

    setQ('LeftArm',  -26 + carve * 8,  16,  42);
    setQ('LeftForeArm', -28, 12, 8);
    setQ('LeftHand', 0, 0, -10);

    setQ('RightArm',  18 - carve * 8, -16, -44);
    setQ('RightForeArm', -24, -12, -8);
    setQ('RightHand', 0, 0, 10);

    setQ('LeftUpLeg',  -18, 0,  12); setQ('LeftLeg',  24, 0, 0); setQ('LeftFoot',  -14, 0, -10);
    setQ('RightUpLeg', -14, 0, -12); setQ('RightLeg', 22, 0, 0); setQ('RightFoot', -14, 0,  10);
    return [0, 58.5 + Math.abs(carve) * 1.6, 0];
  });
}
