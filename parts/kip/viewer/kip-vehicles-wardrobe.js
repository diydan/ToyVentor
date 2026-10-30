// ToyVentor Kip — Phase 1 Wardrobe (Symmetric Plump Heads, Swappable Face Plate, Separate Hat-Ready & Sculpted-Top Hairs)
// + Phase 2 V2 Modular Vehicles (Stylized Multi-Spoke Wheels & Snap-On Body Covers)
import { createDecalExpressionCanvas } from './kip-forge-sdk.js';

export const WARDROBE_HEADS = [
  { id: 'classic', label: 'Kip Classic', crownY: 42.2 },
  { id: 'kid',     label: 'Human Head',  crownY: 28.0 },
  { id: 'fox',     label: 'Fox',         crownY: 26.2 },
  { id: 'bear',    label: 'Bear',        crownY: 27.2 },
  { id: 'robot',   label: 'Bolt Robot',  crownY: 31.6 },
];

export const SKIN_TONES = [
  { id: 'warm_peach',  label: 'Warm Peach',  hex: '#F6C8A6' },
  { id: 'golden_tan',  label: 'Golden Tan',  hex: '#DF9F72' },
  { id: 'rich_cocoa',  label: 'Rich Cocoa',  hex: '#8C5338' },
  { id: 'soft_ivory',  label: 'Soft Ivory',  hex: '#FCE3CE' },
  { id: 'vinyl_cream', label: 'Vinyl Cream', hex: '#F4EFE6' },
];

export const HAIR_COLORS = [
  { id: 'chestnut',      label: 'Chestnut',      hex: '#6E412A' },
  { id: 'espresso',      label: 'Espresso',      hex: '#2A211E' },
  { id: 'golden_blonde', label: 'Golden Blonde', hex: '#F2B83B' },
  { id: 'auburn_ginger', label: 'Auburn Ginger', hex: '#D85A2B' },
  { id: 'berry_pop',     label: 'Berry Pop',     hex: '#D9468F' },
  { id: 'cobalt',        label: 'Cobalt Blue',   hex: '#2E6FDB' },
];

export const HAIR_OPTIONS = [
  { id: 'off',         label: 'None',               hatReady: true,  topH: 0.0 },
  { id: 'short_swept', label: 'Swept (Hat-Ready)',  hatReady: true,  topH: 10.6 },
  { id: 'bob',         label: 'Bob (Hat-Ready)',    hatReady: true,  topH: 10.8 },
  { id: 'swoosh',      label: 'Swoosh (Hat-Ready)', hatReady: true,  topH: 10.8 },
  { id: 'spiky',       label: 'Spiky',              hatReady: false, topH: 0.0 },
  { id: 'pigtails',    label: 'Twin Pigtails',      hatReady: false, topH: 0.0 },
  { id: 'ponytail',    label: 'Sleek Ponytail',     hatReady: false, topH: 0.0 },
  { id: 'curly',       label: 'Cloud Curls',        hatReady: false, topH: 0.0 },
  { id: 'mohawk',      label: 'Crest Mohawk',       hatReady: false, topH: 0.0 },
];

export const HAT_OPTIONS = [
  { id: 'buds',  label: 'Spark Buds' },
  { id: 'hat',   label: 'Wobble Hat' },
  { id: 'ears',  label: 'Pointy Ears' },
  { id: 'horns', label: 'Bumper Horns' },
  { id: 'blank', label: 'Blank Cap' },
];

// Keep CROWN_OPTIONS alias pointing to HAT_OPTIONS for external callers
export const CROWN_OPTIONS = HAT_OPTIONS;

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
    // Compact low-profile neck collar (`kip.scad`)
    ['neckTurret2x1',     loadSTL('/kip/stls/neck_turret_2x1.stl', 36)],
    // Phase 1 Plump Symmetric Base Heads + Swappable Emotion Face Plate
    ['crownBuds2x1',      loadSTL('/kip/partspec/toyventor_crown_buds_2x1.stl', 34)],
    ['charHeadKid',       loadSTL('/kip/partspec/toyventor_char_head_kid_S.stl', 66)],
    ['charFaceplate',     loadSTL('/kip/partspec/toyventor_char_faceplate_P.stl', 40)],
    ['charHeadFox',       loadSTL('/kip/partspec/toyventor_char_head_fox_S.stl', 62)],
    ['charHeadBear',      loadSTL('/kip/partspec/toyventor_char_head_bear_S.stl', 62)],
    ['robotHeadVisor',    loadSTL('/kip/partspec/toyventor_robot_head_visor_S.stl', 62)],
    // 8 Separate Clip-On 2x1 Hairstyles (3 Hat-Ready with top_studs + 5 Sculpted-Top) + Horns
    ['hairShortSwept',    loadSTL('/kip/partspec/toyventor_hair_short_swept_S.stl', 62)],
    ['hairBob',           loadSTL('/kip/partspec/toyventor_hair_bob_S.stl', 62)],
    ['hairSwoosh',        loadSTL('/kip/partspec/toyventor_hair_swoosh_S.stl', 62)],
    ['hairSpiky',         loadSTL('/kip/partspec/toyventor_hair_spiky_S.stl', 56)],
    ['hairPigtails',      loadSTL('/kip/partspec/toyventor_hair_pigtails_S.stl', 62)],
    ['hairPonytail',      loadSTL('/kip/partspec/toyventor_hair_ponytail_S.stl', 62)],
    ['hairCurly',         loadSTL('/kip/partspec/toyventor_hair_curly_S.stl', 62)],
    ['hairMohawk',        loadSTL('/kip/partspec/toyventor_hair_mohawk_S.stl', 54)],
    ['bumperHorns',       loadSTL('/kip/partspec/toyventor_bumper_horns_S.stl', 34)],
    // Backpacks & Props
    ['packExplorer',      loadSTL('/kip/partspec/toyventor_pack_explorer_S.stl', 35)],
    ['robotJetpack',      loadSTL('/kip/partspec/toyventor_robot_back_jetpack_S.stl', 35)],
    ['propWrench',        loadSTL('/kip/partspec/toyventor_prop_wrench_P.stl', 35)],
    ['propStarShield',    loadSTL('/kip/partspec/toyventor_prop_star_shield_P.stl', 35)],
    ['skateboardDeck',    loadSTL('/kip/partspec/toyventor_prop_skateboard_deck_S.stl', 35)],
    ['racerAxle',         loadSTL('/kip/partspec/toyventor_racer_axle_S.stl', 35)],
    ['racerWheel',        loadSTL('/kip/partspec/toyventor_racer_wheel_S.stl', 30)],
    // Phase 2 V2 Modular Vehicles, Stylized Multi-Spoke Wheels & Snap-On Body Covers
    ['charLegsSeated',    loadSTL('/kip/partspec/toyventor_char_legs_seated_S.stl', 35)],
    ['vehCarChassis',     loadSTL('/kip/partspec/toyventor_veh_car_chassis_S.stl', 34)],
    ['vehTruckChassis',   loadSTL('/kip/partspec/toyventor_veh_truck_chassis_S.stl', 34)],
    ['vehScooterFrame',   loadSTL('/kip/partspec/toyventor_veh_scooter_frame_S.stl', 34)],
    ['vehCarHoodCover',   loadSTL('/kip/partspec/toyventor_veh_car_hood_cover_S.stl', 32)],
    ['vehCabRoofCover',   loadSTL('/kip/partspec/toyventor_veh_cab_roof_cover_S.stl', 32)],
    ['vehTruckBedCover',  loadSTL('/kip/partspec/toyventor_veh_truck_bed_cover_S.stl', 34)],
    ['vehScooterFairing', loadSTL('/kip/partspec/toyventor_veh_scooter_fairing_S.stl', 32)],
    ['vehMotoCowling',    loadSTL('/kip/partspec/toyventor_veh_moto_cowling_S.stl', 32)],
    ['vehSteeringWheel',  loadSTL('/kip/partspec/toyventor_veh_steering_wheel_P.stl', 32)],
    ['vehHandlebarFork',  loadSTL('/kip/partspec/toyventor_veh_handlebar_fork_P.stl', 35)],
    ['vehWheelSport',     loadSTL('/kip/partspec/toyventor_veh_wheel_sport_P.stl', 30)],
    ['vehWheelSportRim',  loadSTL('/kip/partspec/toyventor_veh_wheel_sport_rim.stl', 32)],
    ['vehWheelOffroad',   loadSTL('/kip/partspec/toyventor_veh_wheel_offroad_P.stl', 30)],
    ['vehWheelOffroadRim',loadSTL('/kip/partspec/toyventor_veh_wheel_offroad_rim.stl', 32)],
    ['vehWheelMoto',      loadSTL('/kip/partspec/toyventor_veh_wheel_moto_P.stl', 30)],
    ['vehWheelMotoRim',   loadSTL('/kip/partspec/toyventor_veh_wheel_moto_rim.stl', 32)],
    // Wave 6 Racer Kit Add-Ons
    ['racerBullBar',      loadSTL('/kip/partspec/toyventor_racer_bull_bar_S.stl', 35)],
    ['racerHoodScoop',    loadSTL('/kip/partspec/toyventor_racer_hood_scoop_S.stl', 35)],
    ['racerLightBar',     loadSTL('/kip/partspec/toyventor_racer_light_bar_S.stl', 35)],
    ['racerRoofRack',     loadSTL('/kip/partspec/toyventor_racer_roof_rack_S.stl', 35)],
    ['racerSpoiler',      loadSTL('/kip/partspec/toyventor_racer_spoiler_S.stl', 35)],
    ['racerTwinExhaust',  loadSTL('/kip/partspec/toyventor_racer_twin_exhaust_S.stl', 35)],
    ['glowCapsule',       loadSTL('/kip/partspec/toyventor_glow_capsule_S.stl', 32)],
    // Phase 3 Pre-Verified LLM SDK Examples
    ['customWizardHat',   loadSTL('/kip/custom/toyventor_custom_wizard_hat_S.stl', 32)],
    ['customStarWand',    loadSTL('/kip/custom/toyventor_custom_star_wand_P.stl', 35)],
    ['customHoodCrest',   loadSTL('/kip/custom/toyventor_custom_hood_crest_S.stl', 34)],
  ]);
  const out = {};
  for (const [k, p] of entries) out[k] = await p;
  return out;
}

export function attachExpansionToKipRig(THREE, kip, expGeos, baseParts, mats, scadMesh, createSlot) {
  // Brand-aligned wardrobe, skin/hair, and alloy wheel materials (`BRAND_STYLE.md`)
  const expMats = {
    skin:     new THREE.MeshPhysicalMaterial({ color: SKIN_TONES[0].hex, roughness: 0.46, clearcoat: 0.14, envMapIntensity: 0.68 }),
    hair:     new THREE.MeshPhysicalMaterial({ color: HAIR_COLORS[0].hex, roughness: 0.40, clearcoat: 0.26, envMapIntensity: 0.74 }),
    cobalt:   new THREE.MeshPhysicalMaterial({ color: '#2E6FDB', roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    teal:     new THREE.MeshPhysicalMaterial({ color: '#1FA6A0', roughness: 0.35, clearcoat: 0.44, envMapIntensity: 0.76 }),
    plum:     new THREE.MeshPhysicalMaterial({ color: '#7C4DFF', roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    sun:      new THREE.MeshPhysicalMaterial({ color: '#FFB830', roughness: 0.34, clearcoat: 0.46, envMapIntensity: 0.78 }),
    fox:      new THREE.MeshPhysicalMaterial({ color: '#E86F38', roughness: 0.44, clearcoat: 0.24, envMapIntensity: 0.70 }),
    bear:     new THREE.MeshPhysicalMaterial({ color: '#B58052', roughness: 0.48, clearcoat: 0.18, envMapIntensity: 0.66 }),
    botSilv:  new THREE.MeshPhysicalMaterial({ color: '#DCE3EE', roughness: 0.32, metalness: 0.12, clearcoat: 0.48, envMapIntensity: 0.80 }),
    tire:     new THREE.MeshPhysicalMaterial({ color: '#20232A', roughness: 0.56, clearcoat: 0.15, envMapIntensity: 0.55 }),
    rimAlloy: new THREE.MeshPhysicalMaterial({ color: '#EDF2F8', roughness: 0.26, metalness: 0.22, clearcoat: 0.55, envMapIntensity: 0.88 }),
    rimGold:  new THREE.MeshPhysicalMaterial({ color: '#FFD25A', roughness: 0.28, metalness: 0.18, clearcoat: 0.52, envMapIntensity: 0.86 }),
    custom:   new THREE.MeshPhysicalMaterial({ color: '#7C4DFF', roughness: 0.32, clearcoat: 0.50, envMapIntensity: 0.80 }),
  };

  // Convert LAY_FLAT ([90,0,0]) shaft STL (y_stl = -L..0, z_stl = 0..5) into X-centered horizontal axle
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
    orient.rotation.y = Math.PI / 2;
    orient.add(m);
    spinGrp.add(orient);
    return spinGrp;
  }

  // Stylized two-tone multi-spoke wheel (`sideSign = +1` for Left `+X` outward, `-1` for Right `-X` outward)
  function makeStylizedWheelX(tireGeo, rimGeo, widthMm, sideSign = 1, rimMat = expMats.rimAlloy) {
    const spinGrp = new THREE.Group();
    const orient = new THREE.Group();
    orient.rotation.y = (sideSign >= 0 ? 1 : -1) * (Math.PI / 2);

    const tireMesh = new THREE.Mesh(tireGeo, expMats.tire);
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    tireMesh.position.z = -widthMm * 0.5;
    orient.add(tireMesh);

    if (rimGeo) {
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.castShadow = true;
      rimMesh.receiveShadow = true;
      rimMesh.position.z = -widthMm * 0.5;
      rimMesh.scale.set(1.003, 1.003, 1.004);
      orient.add(rimMesh);
    }
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
    g.rotation.z = Math.PI / 2;
    g.position.set(0, -11.4, 2.3);
    return g;
  }

  // 1. Compact Low-Profile Neck Turret (`neck_turret_2x1`: seats deep inside neck socket so heads sit at world y = 108.0 mm!)
  const neckTurret2x1Slot = createSlot('neck_turret_2x1', kip.neckAnchor, [0, 18, 0], 3.85, 'both');
  const ntMesh = scadMesh(expGeos.neckTurret2x1, mats.spark);
  ntMesh.position.y = -7.4; // top 2x1 stud seat at 106.8 - 7.4 + 8.6 = 108.0 mm (`kip.headLocal` origin!)
  neckTurret2x1Slot.add(ntMesh);
  neckTurret2x1Slot.visible = false;

  const altHeadsGroup = new THREE.Group();
  altHeadsGroup.visible = false;
  kip.headLocal.add(altHeadsGroup);

  const altHeadSlot = createSlot('alt_head', altHeadsGroup, [0, 40, 0], 4.05, 'both', 'neck_anchor');
  const headMeshes = {
    kid:   scadMesh(expGeos.charHeadKid, expMats.skin),
    fox:   scadMesh(expGeos.charHeadFox, expMats.fox),
    bear:  scadMesh(expGeos.charHeadBear, expMats.bear),
    robot: scadMesh(expGeos.robotHeadVisor, expMats.botSilv),
  };
  for (const hm of Object.values(headMeshes)) {
    hm.position.y = 0.0;
    hm.visible = false;
    altHeadSlot.add(hm);
  }

  // Mandatory `#FF6B4A` 2x1 Spark Crown Buds overlay on base heads (`BRAND_STYLE.md` rule 3)
  const altCrownBuds = scadMesh(expGeos.crownBuds2x1, mats.spark);
  altCrownBuds.scale.set(1.006, 1.01, 1.006);
  altHeadSlot.add(altCrownBuds);

  // 1b. Slim Swappable Emotion Face Plate (`char_faceplate` -> mates into `char_head_kid.face_slot` & pops forward +Z in Explode/Build!)
  const faceplateGroup = new THREE.Group();
  faceplateGroup.visible = false;
  kip.headLocal.add(faceplateGroup);
  const faceplateSlot = createSlot('char_faceplate', faceplateGroup, [0, 8, 56], 4.35, 'both', 'alt_head');
  const faceplateMesh = new THREE.Mesh(expGeos.charFaceplate, expMats.skin);
  faceplateMesh.castShadow = true;
  faceplateMesh.receiveShadow = true;
  // STL has front bezel on z_stl = 0 and 12.5 mm stem on +z_stl; rotate Y by PI so z_stl=0 faces +Z and stem inserts along -Z into face_slot!
  faceplateMesh.rotation.y = Math.PI;
  faceplateMesh.position.set(0, 14.0625, 16.4625);
  faceplateSlot.add(faceplateMesh);

  // Conformal 2D Vinyl/Screen Decal Expression Meshes for Fox / Bear / Robot (`BRAND_STYLE.md` rule 5: zero moulded 3D faces!)
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, 0, -1);

  function buildConformalDecalGeo(headGeo, centerY, width, height) {
    const probe = new THREE.Mesh(headGeo, mats.shell);
    probe.rotation.x = -Math.PI / 2;
    probe.position.y = 0.0;
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
      const hitZ = hits.length > 0 ? hits[0].point.z : (19.0 - (vx * vx) * 0.015);
      pos.setZ(i, hitZ + 0.38);
    }
    g.computeVertexNormals();
    return g;
  }

  const headDecalGeos = {
    fox:   buildConformalDecalGeo(expGeos.charHeadFox,    15.0, 28.4, 14.2),
    bear:  buildConformalDecalGeo(expGeos.charHeadBear,   14.8, 28.0, 14.0),
    robot: buildConformalDecalGeo(expGeos.robotHeadVisor, 17.8, 24.0, 10.6),
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

  // 2D emotion print directly on the slim `char_faceplate` tile (travels with `faceplateSlot` in Explode & Pile -> Build!)
  const faceplateDecalPlane = new THREE.Mesh(new THREE.PlaneGeometry(20.2, 9.4), decalMat);
  faceplateDecalPlane.position.set(0, 14.0625, 16.54);
  faceplateDecalPlane.renderOrder = 2;
  faceplateSlot.add(faceplateDecalPlane);

  // Conformal 2D decal plane for Critter / Robot heads
  const decalPlane = new THREE.Mesh(headDecalGeos.fox, decalMat);
  decalPlane.visible = false;
  decalPlane.renderOrder = 2;
  altHeadSlot.add(decalPlane);

  const classicDecalPlane = new THREE.Mesh(classicWrapGeo, decalMat);
  classicDecalPlane.position.set(0, 19.8, 23.0);
  classicDecalPlane.visible = false;
  classicDecalPlane.renderOrder = 2;
  kip.visorSlot.add(classicDecalPlane);

  // 2a. Separate Clip-On 2x1 Hair Slot (`hairSlot`: clips onto head crown; Hat-Ready hairs expose `#FF6B4A` 2x1 studs on top!)
  const hairGroup = new THREE.Group();
  hairGroup.visible = false;
  kip.headLocal.add(hairGroup);
  const hairSlot = createSlot('hair_clip', hairGroup, [0, 72, 0], 4.65, 'both', 'alt_head');
  const hairAnchor = new THREE.Group();
  hairAnchor.position.set(0, 28.0, 0);
  hairSlot.add(hairAnchor);

  const hairMeshes = {
    short_swept: scadMesh(expGeos.hairShortSwept, expMats.hair),
    bob:         scadMesh(expGeos.hairBob,        expMats.hair),
    swoosh:      scadMesh(expGeos.hairSwoosh,     expMats.hair),
    spiky:       scadMesh(expGeos.hairSpiky,      expMats.hair),
    pigtails:    scadMesh(expGeos.hairPigtails,   expMats.hair),
    ponytail:    scadMesh(expGeos.hairPonytail,   expMats.hair),
    curly:       scadMesh(expGeos.hairCurly,      expMats.hair),
    mohawk:      scadMesh(expGeos.hairMohawk,     expMats.hair),
  };
  for (const m of Object.values(hairMeshes)) {
    m.visible = false;
    hairAnchor.add(m);
  }
  const hairCrownBuds = scadMesh(expGeos.crownBuds2x1, mats.spark);
  hairCrownBuds.scale.set(1.006, 1.01, 1.006);
  hairCrownBuds.visible = false;
  hairAnchor.add(hairCrownBuds);

  // 2b. Stackable Hat / Top Accessory Anchor (`kip.crownAccSlot`: sits on head crown OR stacks on top of Hat-Ready hair!)
  const crownAnchor = new THREE.Group();
  crownAnchor.position.set(0, 42.2, 0);
  kip.crownAccSlot.add(crownAnchor);

  kip.pointyEars.position.set(0, 0, 0);
  kip.wobbleHat.position.set(6.25, 0, 0);
  crownAnchor.add(kip.pointyEars, kip.wobbleHat);

  const hatMeshes = {
    horns:     scadMesh(expGeos.bumperHorns,     expMats.sun),
    ponytail:  scadMesh(expGeos.hairPonytail,    expMats.hair),
    wizardHat: scadMesh(expGeos.customWizardHat, expMats.plum),
  };
  for (const m of Object.values(hatMeshes)) {
    m.visible = false;
    crownAnchor.add(m);
  }

  // Custom / Photo-Forge dynamic mount containers
  const customCrownContainer = new THREE.Group();
  crownAnchor.add(customCrownContainer);
  const customHeadContainer = new THREE.Group();
  customHeadContainer.position.y = 0.0;
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
  jetMesh.rotation.set(0, Math.PI, Math.PI);
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
  deckMesh.position.y = 2.75;
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
  // 7. PHASE 2 V2: WIDE-BODY ROLLING CHASSIS + STYLIZED WHEELS + SNAP-ON COVERS
  // =========================================================================
  const vehiclesRoot = new THREE.Group();
  kip.mover.add(vehiclesRoot);

  // --- A) V2 ROADSTER CAR (`veh_car_chassis` + 5-spoke `veh_wheel_sport` + `veh_car_hood_cover` + `veh_cab_roof_cover`) ---
  const carGroup = new THREE.Group();
  carGroup.visible = false;
  vehiclesRoot.add(carGroup);
  const carY = 11.75; // 18.0 mm sport wheel radius - 6.25 mm axle height -> tires tangent to y = 0!

  const carBodySlot = createSlot('veh_car_chassis', carGroup, [0, -10, 0], 0.5, 'both');
  const carChassisMesh = scadMesh(expGeos.vehCarChassis, mats.spark);
  carChassisMesh.position.y = carY;
  carBodySlot.add(carChassisMesh);

  const carSteerSlot = createSlot('car_steer', carGroup, [0, 36, 22], 1.35, 'both', 'veh_car_chassis');
  const carSteerPivot = new THREE.Group();
  carSteerPivot.position.set(0, carY + 34.5, 18.75);
  const carSteerFlip = new THREE.Group();
  carSteerFlip.rotation.x = Math.PI / 2;
  const carSteerMesh = new THREE.Mesh(expGeos.vehSteeringWheel, expMats.tire);
  carSteerMesh.castShadow = true;
  carSteerFlip.add(carSteerMesh);
  carSteerPivot.add(carSteerFlip);
  carSteerSlot.add(carSteerPivot);

  const carWheels = [];
  for (const [sfx, zAx] of [['f', 43.75], ['r', -43.75]]) {
    const axSlot = createSlot(`car_ax_${sfx}`, carGroup, [0, -24, zAx * 0.45], 0.25, 'both', 'veh_car_chassis');
    const ax = makeAxleX(baseParts.shaftTu05, 62.5, mats.proSlate);
    ax.position.set(0, 18.0, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 24.5], ['r', -24.5]]) {
      const wSlot = createSlot(`car_w_${sfx}_${ws}`, carGroup, [wx * 2.1, -14, zAx * 0.35], 0.1, 'both', `car_ax_${sfx}`);
      const wSpin = makeStylizedWheelX(expGeos.vehWheelSport, expGeos.vehWheelSportRim, 13.5, wx > 0 ? 1 : -1, expMats.rimAlloy);
      wSpin.position.set(wx, 18.0, zAx);
      wSlot.add(wSpin);
      carWheels.push(wSpin);
    }
  }

  // Roadster Car Snap-On Body Covers (`veh_car_hood_cover` + `veh_cab_roof_cover`)
  const carCoversGroup = new THREE.Group();
  carGroup.add(carCoversGroup);
  const carHoodCoverSlot = createSlot('car_hood_cover', carCoversGroup, [0, 28, 30], 1.5, 'both', 'veh_car_chassis');
  const carHoodCoverMesh = scadMesh(expGeos.vehCarHoodCover, mats.shell);
  carHoodCoverMesh.position.set(0, carY + 17.5, 37.5);
  carHoodCoverSlot.add(carHoodCoverMesh);

  const carCabCoverSlot = createSlot('car_cab_cover', carCoversGroup, [0, 30, -22], 1.55, 'both', 'veh_car_chassis');
  const carCabCoverMesh = scadMesh(expGeos.vehCabRoofCover, mats.shell);
  carCabCoverMesh.position.set(0, carY + 22.5, -18.75);
  carCabCoverSlot.add(carCabCoverMesh);

  // Roadster Car Wave 6 Racer Kit Add-Ons + Custom Hood Mount
  const carRacerGroup = new THREE.Group();
  carGroup.add(carRacerGroup);
  const addCarAddon = (id, geo, mat, x, yLocal, z, exVec, guide = 'veh_car_chassis') => {
    const sl = createSlot(id, carRacerGroup, exVec, 1.85, 'both', guide);
    const m = scadMesh(geo, mat);
    m.position.set(x, carY + yLocal, z);
    sl.add(m);
    return { slot: sl, mesh: m };
  };
  addCarAddon('car_bull', expGeos.racerBullBar, expMats.sun, 0, 15.5, 56.25, [0, 12, 60]);
  const carHoodScoopAddon = addCarAddon('car_scoop', expGeos.racerHoodScoop, expMats.cobalt, 0, 28.5, 37.5, [0, 52, 34], 'car_hood_cover');
  const carLightBarAddon  = addCarAddon('car_light', expGeos.racerLightBar, expMats.sun, 0, 31.0, -18.75, [0, 56, -22], 'car_cab_cover');
  addCarAddon('car_spoiler', expGeos.racerSpoiler, expMats.cobalt, 0, 19.0, -31.25, [0, 38, -46]);
  addCarAddon('car_exhaust', expGeos.racerTwinExhaust, mats.shell, 0, 15.5, -50.0, [0, 16, -66]);

  const customHoodGroup = new THREE.Group();
  customHoodGroup.visible = false;
  carGroup.add(customHoodGroup);
  const customHoodSlot = createSlot('custom_hood', customHoodGroup, [0, 54, 34], 1.9, 'both', 'car_hood_cover');
  const customHoodContainer = new THREE.Group();
  customHoodContainer.position.set(0, carY + 28.5, 37.5);
  customHoodSlot.add(customHoodContainer);

  // --- B) V2 HAULER TRUCK (`veh_truck_chassis` + 6-window beadlock `veh_wheel_offroad` + Hood/Cab/Bed Covers!) ---
  const truckGroup = new THREE.Group();
  truckGroup.visible = false;
  vehiclesRoot.add(truckGroup);
  const truckY = 15.75; // 22.0 mm off-road wheel radius - 6.25 mm axle height!

  const truckBodySlot = createSlot('veh_truck_chassis', truckGroup, [0, -10, 0], 0.5, 'both');
  const truckChassisMesh = scadMesh(expGeos.vehTruckChassis, expMats.teal);
  truckChassisMesh.position.y = truckY;
  truckBodySlot.add(truckChassisMesh);

  const truckSteerSlot = createSlot('truck_steer', truckGroup, [0, 36, 22], 1.35, 'both', 'veh_truck_chassis');
  const truckSteerPivot = new THREE.Group();
  truckSteerPivot.position.set(0, truckY + 35.0, 18.75);
  const truckSteerFlip = new THREE.Group();
  truckSteerFlip.rotation.x = Math.PI / 2;
  const truckSteerMesh = new THREE.Mesh(expGeos.vehSteeringWheel, expMats.tire);
  truckSteerMesh.castShadow = true;
  truckSteerFlip.add(truckSteerMesh);
  truckSteerPivot.add(truckSteerFlip);
  truckSteerSlot.add(truckSteerPivot);

  const truckWheels = [];
  for (const [sfx, zAx] of [['f', 43.75], ['r', -53.125]]) {
    const axSlot = createSlot(`trk_ax_${sfx}`, truckGroup, [0, -24, zAx * 0.4], 0.25, 'both', 'veh_truck_chassis');
    const ax = makeAxleX(baseParts.shaftTu05, 62.5, mats.proSlate);
    ax.position.set(0, 22.0, zAx);
    axSlot.add(ax);
    for (const [ws, wx] of [['l', 24.25], ['r', -24.25]]) {
      const wSlot = createSlot(`trk_w_${sfx}_${ws}`, truckGroup, [wx * 2.2, -16, zAx * 0.3], 0.1, 'both', `trk_ax_${sfx}`);
      const wSpin = makeStylizedWheelX(expGeos.vehWheelOffroad, expGeos.vehWheelOffroadRim, 14.0, wx > 0 ? 1 : -1, expMats.rimGold);
      wSpin.position.set(wx, 22.0, zAx);
      wSlot.add(wSpin);
      truckWheels.push(wSpin);
    }
  }

  // Hauler Truck Snap-On Body Covers (interchangeable Hood + Cab Roof + `2x3` Pickup Bed Cover!)
  const truckCoversGroup = new THREE.Group();
  truckGroup.add(truckCoversGroup);
  const trkHoodCoverSlot = createSlot('trk_hood_cover', truckCoversGroup, [0, 28, 30], 1.5, 'both', 'veh_truck_chassis');
  const trkHoodCoverMesh = scadMesh(expGeos.vehCarHoodCover, mats.shell);
  trkHoodCoverMesh.position.set(0, truckY + 18.0, 37.5);
  trkHoodCoverSlot.add(trkHoodCoverMesh);

  const trkCabCoverSlot = createSlot('trk_cab_cover', truckCoversGroup, [0, 32, -20], 1.55, 'both', 'veh_truck_chassis');
  const trkCabCoverMesh = scadMesh(expGeos.vehCabRoofCover, mats.shell);
  trkCabCoverMesh.position.set(0, truckY + 26.0, -18.75);
  trkCabCoverSlot.add(trkCabCoverMesh);

  const trkBedCoverSlot = createSlot('trk_bed_cover', truckCoversGroup, [0, 28, -48], 1.6, 'both', 'veh_truck_chassis');
  const trkBedCoverMesh = scadMesh(expGeos.vehTruckBedCover, expMats.sun);
  trkBedCoverMesh.position.set(0, truckY + 15.0, -56.25);
  trkBedCoverSlot.add(trkBedCoverMesh);

  const truckRacerGroup = new THREE.Group();
  truckGroup.add(truckRacerGroup);
  const trkBullSlot = createSlot('trk_bull', truckRacerGroup, [0, 12, 60], 1.8, 'both', 'veh_truck_chassis');
  const trkBullMesh = scadMesh(expGeos.racerBullBar, expMats.sun);
  trkBullMesh.position.set(0, truckY + 16.0, 56.25);
  trkBullSlot.add(trkBullMesh);

  const trkRackSlot = createSlot('trk_rack', truckRacerGroup, [0, 56, -20], 1.85, 'both', 'trk_cab_cover');
  const trkRackMesh = scadMesh(expGeos.racerRoofRack, mats.spark);
  trkRackMesh.position.set(0, truckY + 34.5, -18.75);
  trkRackSlot.add(trkRackMesh);

  const trkCargoSlot = createSlot('trk_cargo', truckRacerGroup, [0, 52, -58], 1.9, 'both', 'trk_bed_cover');
  const trkCargoPack = scadMesh(expGeos.packExplorer, expMats.cobalt);
  trkCargoPack.position.set(0, truckY + 20.5, -56.25);
  trkCargoSlot.add(trkCargoPack);

  // --- C) V2 TRUE 2-WHEEL INLINE MOTOR SCOOTER & SPORT MOTORBIKE (`veh_scooter_frame` + 2x `veh_wheel_moto` + Fairing + Cowling!) ---
  const bikeGroup = new THREE.Group();
  bikeGroup.visible = false;
  vehiclesRoot.add(bikeGroup);
  const bikeLeanGroup = new THREE.Group();
  bikeGroup.add(bikeLeanGroup);
  const bikeY = 11.75; // 18.0 mm moto wheel radius - 6.25 mm axle height!

  const bikeFrameSlot = createSlot('veh_scooter_frame', bikeLeanGroup, [0, -10, 0], 0.5, 'both');
  const bikeFrameMesh = scadMesh(expGeos.vehScooterFrame, expMats.cobalt);
  bikeFrameMesh.position.y = bikeY;
  bikeFrameSlot.add(bikeFrameMesh);

  // Turning Handlebar Fork at V2 headtube `z = +18.75`
  const bikeForkSlot = createSlot('veh_handlebar_fork', bikeLeanGroup, [0, 42, 22], 1.35, 'both', 'veh_scooter_frame');
  const bikeForkPivot = new THREE.Group();
  bikeForkPivot.position.set(0, bikeY + 10.0, 18.75);
  const bikeForkOrient = new THREE.Group();
  bikeForkOrient.rotation.x = Math.PI;
  const bikeForkMesh = new THREE.Mesh(expGeos.vehHandlebarFork, expMats.tire);
  bikeForkMesh.castShadow = true;
  bikeForkMesh.position.set(0, 0, -3.3);
  bikeForkOrient.add(bikeForkMesh);
  bikeForkPivot.add(bikeForkOrient);
  bikeForkSlot.add(bikeForkPivot);

  // Snap-On Front Scooter Leg-Shield Fairing (`veh_scooter_fairing`)
  const bikeCoversGroup = new THREE.Group();
  bikeLeanGroup.add(bikeCoversGroup);
  const scooterFairingSlot = createSlot('veh_scooter_fairing', bikeCoversGroup, [0, 32, 42], 1.55, 'both', 'veh_scooter_frame');
  const scooterFairingMesh = scadMesh(expGeos.vehScooterFairing, mats.shell);
  scooterFairingMesh.position.set(0, bikeY + 29.0, 37.5);
  scooterFairingSlot.add(scooterFairingMesh);

  // Detachable `2x2` V2 Sport Motorbike Tank & Windscreen Cowling (`veh_moto_cowling`)
  const motoCowlingGroup = new THREE.Group();
  motoCowlingGroup.visible = false;
  bikeLeanGroup.add(motoCowlingGroup);
  const motoCowlingSlot = createSlot('veh_moto_cowling', motoCowlingGroup, [0, 38, 6], 1.65, 'both', 'veh_scooter_frame');
  const motoCowlingMesh = scadMesh(expGeos.vehMotoCowling, mats.spark);
  motoCowlingMesh.position.set(0, bikeY + 12.0, 0);
  motoCowlingSlot.add(motoCowlingMesh);

  const bikeRacerGroup = new THREE.Group();
  bikeLeanGroup.add(bikeRacerGroup);
  const bikeExhSlot = createSlot('bike_exhaust', bikeRacerGroup, [0, 20, -64], 1.75, 'both', 'veh_scooter_frame');
  const bikeExhMesh = scadMesh(expGeos.racerTwinExhaust, mats.shell);
  bikeExhMesh.position.set(0, bikeY + 26.5, -50.0);
  bikeExhSlot.add(bikeExhMesh);

  // True 2-Wheel Inline Scooter & Motorbike Wheels (2 centered `veh_wheel_moto` at `x = 0` on flush `37.5 mm` `racer_axle`s!)
  const bikeWheels = [];
  for (const [sfx, zAx] of [['f', 43.75], ['r', -50.0]]) {
    const axSlot = createSlot(`bike_ax_${sfx}`, bikeLeanGroup, [-32, -16, zAx * 0.3], 0.25, 'both', 'veh_scooter_frame');
    const ax = makeAxleX(expGeos.racerAxle, 37.5, mats.proSlate);
    ax.position.set(0, 18.0, zAx);
    axSlot.add(ax);

    const wSlot = createSlot(`bike_w_${sfx}`, bikeLeanGroup, [0, -24, zAx * 0.45], 0.1, 'both', `bike_ax_${sfx}`);
    const wSpin = makeStylizedWheelX(expGeos.vehWheelMoto, expGeos.vehWheelMotoRim, 14.0, 1, expMats.rimAlloy);
    wSpin.position.set(0, 18.0, zAx);
    wSlot.add(wSpin);
    bikeWheels.push(wSpin);
  }

  // Toggle snap-on covers (`Covers: On / Off`) while keeping top Racer add-ons cleanly seated in both modes!
  function setCoversVisible(on, vehicleMode = 'none') {
    const cov = Boolean(on);
    carCoversGroup.visible   = cov;
    truckCoversGroup.visible = cov;
    bikeCoversGroup.visible  = cov;
    motoCowlingGroup.visible = (vehicleMode === 'moto') && cov;

    // Reseat add-ons onto bare chassis studs when covers are popped off!
    carHoodScoopAddon.mesh.position.y = carY + (cov ? 28.5 : 17.5);
    carHoodScoopAddon.slot.guideTo    = cov ? 'car_hood_cover' : 'veh_car_chassis';
    customHoodContainer.position.y    = carY + (cov ? 28.5 : 17.5);
    customHoodSlot.guideTo            = cov ? 'car_hood_cover' : 'veh_car_chassis';
    carLightBarAddon.mesh.position.y  = carY + (cov ? 31.0 : 22.5);
    carLightBarAddon.slot.guideTo     = cov ? 'car_cab_cover'  : 'veh_car_chassis';

    trkRackMesh.position.y   = truckY + (cov ? 34.5 : 26.0);
    trkRackSlot.guideTo      = cov ? 'trk_cab_cover' : 'veh_truck_chassis';
    trkCargoPack.position.y  = truckY + (cov ? 20.5 : 15.0);
    trkCargoSlot.guideTo     = cov ? 'trk_bed_cover' : 'veh_truck_chassis';
  }

  return {
    expGeos,
    expMats,
    neckTurret2x1Slot,
    altHeadsGroup,
    altHeadSlot,
    headMeshes,
    headDecalGeos,
    altCrownBuds,
    faceplateGroup,
    faceplateSlot,
    faceplateMesh,
    faceplateDecalPlane,
    decalPlane,
    classicDecalPlane,
    decalTex,
    hairGroup,
    hairSlot,
    hairAnchor,
    hairMeshes,
    hairCrownBuds,
    crownAnchor,
    hatMeshes,
    crownHairMeshes: hatMeshes,
    explorerGroup,
    jetpackGroup,
    wrenchGroup,
    shieldGroup,
    customWandGroup,
    skateboardGroup,
    skateWheels,
    snapSeatedLegsGroup,
    snapSeatedLegsSlot,
    // Vehicles & Snap-On Covers
    carGroup,
    carCoversGroup,
    carSteerPivot,
    carWheels,
    carRacerGroup,
    carHoodScoopAddon,
    truckGroup,
    truckCoversGroup,
    truckSteerPivot,
    truckWheels,
    truckRacerGroup,
    bikeGroup,
    bikeCoversGroup,
    bikeLeanGroup,
    bikeForkPivot,
    motoCowlingGroup,
    bikeRacerGroup,
    bikeWheels,
    setCoversVisible,
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
    setQ('Hips', -2, 0, Math.sin(ph) * 1.2);
    setQ('Head', 2 + Math.cos(ph) * 2.0, steerOsc * 1.8, Math.sin(ph) * 2.0);

    // Symmetric two-hand inward reach onto the Ø 36 mm 3-spoke steering wheel rim!
    setQ('LeftArm',  -44 + steerOsc, -12, -16);
    setQ('LeftForeArm', -22, -10, -6);
    setQ('LeftHand', 8, 0, -10);

    setQ('RightArm', -44 - steerOsc,  12,  16);
    setQ('RightForeArm', -22,  10,  6);
    setQ('RightHand', 8, 0, 10);

    // Seated 90-deg hips + tucked knees inside recessed 4x2 wide-body cockpit!
    setQ('LeftUpLeg',  -84, -4,  5); setQ('LeftLeg',  58, 0, 0); setQ('LeftFoot',  14, 0, 0);
    setQ('RightUpLeg', -84,  4, -5); setQ('RightLeg', 58, 0, 0); setQ('RightFoot', 14, 0, 0);
    return [0, 61.5 + bob, 0];
  });
}

// 2. Step-Through Motor Scooter Upright Seated Clip (`scooter_ride`)
export function makeScooterRideClip(THREE) {
  return buildKeyframedKipClip(THREE, 'scooter_ride', 2.0, (ph, setQ) => {
    const bob = Math.sin(ph * 2) * 0.7;
    setQ('Hips', 6, 0, Math.sin(ph) * 1.5);
    setQ('Head', -6, Math.sin(ph) * 6.0, Math.cos(ph) * 2.5);

    // Relaxed upright arms reaching forward onto twin Ø6.60 mm scooter handlebars!
    setQ('LeftArm',  -60,  6, 10);
    setQ('LeftForeArm', -22, -6, 0);
    setQ('LeftHand', 8, 0, 0);

    setQ('RightArm', -60, -6, -10);
    setQ('RightForeArm', -22, 6, 0);
    setQ('RightHand', 8, 0, 0);

    // Feet together forward on the 2x2 step-through floorboard behind the curved fairing!
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
    setQ('LeftArm',  -72,  8, 14);
    setQ('LeftForeArm', -20, -8, 0);
    setQ('LeftHand', 12, 0, 0);

    setQ('RightArm', -72, -8, -14);
    setQ('RightForeArm', -20, 8, 0);
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
