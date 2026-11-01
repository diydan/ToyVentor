// ToyVentor Kip — Phase 1 Wardrobe (12 Heads in 4 Categories: Human · Robot · Animal · Creature, 3 Universal Swappable Human Face Plates, 19 Sculpted Wigs, 7 Wearable Hats, Full-Body Skin & Clothing Decals)
// + Phase 2 V2 Modular Vehicles (Stylized Multi-Spoke Wheels & Snap-On Body Covers)
import {
  createDecalExpressionCanvas,
  createTorsoOutfitDecalCanvas,
  createLegOutfitDecalCanvas,
} from './kip-forge-sdk.js?v=10.0';
import { FACEPLATE_DECAL } from './kip-faceplate-shape.js?v=10.0';

export const KIP_BUILD_VERSION = 'v10.1';
export const HAIR_WRAP_MM = 16.5;
// Wearable hats WRAP the head: each STL has its rim on the bed (z_stl = 0) and its 2x1 sockets HAT_RIM_MM[id] above it, so the mesh is shifted down by that much
// and its rim lands at the hairline over a Hat-Ready wig (just above the brow on a bare head). Straight from HAT_RIM in toyventor_parts.py.
export const HAT_RIM_MM = { ballcap: 10.4, beanie: 10.4, cowboy: 9.6, hardhat: 10.4, ranger: 9.6, tophat: 9.2, pirate: 10.0 };
export const HAT_WRAP_MM = 10.4;
// Depth (mm in front of the head's y = 0 plane) where the universal face plate's stem starts, i.e. the pocket floor on the bore axis (FACE_BACK_REF in toyventor_parts.py).
export const FACE_STEM_MM = 10.167;

export const HUMAN_HEAD_IDS = new Set(['kid', 'chibi', 'tall', 'jumbo']);

// Four head categories (12 heads total: 4 Human, 2 Robot, 3 Animal, 3 Creature). The `Type` button cycles categories; the `Head` button cycles within one.
export const HEAD_CATEGORIES = [
  { id: 'human',    label: 'Human' },
  { id: 'robot',    label: 'Robot' },
  { id: 'animal',   label: 'Animal' },
  { id: 'creature', label: 'Creature' },
];

export const FACE_INSERT_MODES = [
  { id: 'sculpted', label: '3D Nose & Smile' },
  { id: 'vinyl',    label: '3D Button Eyes & Nose' },
  { id: 'flat',     label: 'Flat Decal Insert' },
];

export const WARDROBE_HEADS = [
  // Humans share one universal face-insert slot, so every insert fits every human head.
  // crownY = the head's `top_studs` plane (z_stud) and faceY = its `face_slot` bore (z_bore), both straight from toyventor_parts.py.
  // kid = gender-neutral, chibi = feminine, tall = masculine.
  { id: 'kid',     category: 'human',    label: 'Soft Youth',     crownY: 30.97, faceY: 12.5 },
  { id: 'chibi',   category: 'human',    label: 'Sweet Heart',    crownY: 30.97, faceY: 12.5 },
  { id: 'tall',    category: 'human',    label: 'Heroic Jaw',     crownY: 32.948, faceY: 14.0625 },
  { id: 'jumbo',   category: 'human',    label: 'Jumbo Vinyl',    crownY: 30.97, faceY: 12.5 },
  { id: 'robot',   category: 'robot',    label: 'Bolt Robot',     crownY: 31.6, faceY: 17.8 },
  { id: 'scout',   category: 'robot',    label: 'Mecha Scout',    crownY: 32.8, faceY: 17.6 },
  { id: 'fox',     category: 'animal',   label: 'Fox',            crownY: 26.2, faceY: 15.0 },
  { id: 'bear',    category: 'animal',   label: 'Bear',           crownY: 27.2, faceY: 14.8 },
  { id: 'cat',     category: 'animal',   label: 'Whisker Cat',    crownY: 26.8, faceY: 15.2 },
  { id: 'dragon',  category: 'creature', label: 'Drake Dragon',   crownY: 27.6, faceY: 17.2 },
  { id: 'alien',   category: 'creature', label: 'Starling Alien', crownY: 35.6, faceY: 18.2 },
  { id: 'imp',     category: 'creature', label: 'Yeti Imp',       crownY: 28.4, faceY: 16.4 },
];

export function headsInCategory(categoryId) {
  return WARDROBE_HEADS.filter(h => h.category === categoryId);
}

export function categoryOfHead(headId) {
  const h = WARDROBE_HEADS.find(x => x.id === headId);
  return h ? h.category : 'human';
}

export const SHIRT_OPTIONS = [
  { id: 'off',        label: 'Off',              chestHex: null,      sleeveHex: null,      cuffHex: null,      longSleeve: false, shoeHex: null },
  { id: 'spark_tee',  label: 'Spark Bolt Tee',   chestHex: '#FF6B4A', sleeveHex: '#FF6B4A', cuffHex: '#FFFFFF', longSleeve: false, shoeHex: '#FF6B4A' },
  { id: 'hoodie',     label: 'Cobalt Hoodie',    chestHex: '#2E6FDB', sleeveHex: '#2E6FDB', cuffHex: '#1D4BA0', longSleeve: true,  shoeHex: '#2E6FDB' },
  { id: 'varsity',    label: 'Varsity Jacket',   chestHex: '#242B3D', sleeveHex: '#F4EFE6', cuffHex: '#FF6B4A', longSleeve: true,  shoeHex: '#242B3D' },
  { id: 'overalls',   label: 'Denim Overalls',   chestHex: '#FFB830', sleeveHex: '#FFB830', cuffHex: '#FFF3D1', longSleeve: false, shoeHex: '#D85A2B' },
  { id: 'stripe_tee', label: 'Breton Stripes',   chestHex: '#1FA6A0', sleeveHex: '#1FA6A0', cuffHex: '#F4EFE6', longSleeve: false, shoeHex: '#1FA6A0' },
  { id: 'track_top',  label: 'Racing Track Top', chestHex: '#7C4DFF', sleeveHex: '#7C4DFF', cuffHex: '#20232A', longSleeve: true,  shoeHex: '#7C4DFF' },
];

export const PANTS_OPTIONS = [
  { id: 'off',            label: 'Off',           waistHex: null,      legHex: null,      cuffHex: null,      isShorts: false, shoeHex: null },
  { id: 'jeans',          label: 'Cuffed Jeans',  waistHex: '#2B4C85', legHex: '#2B4C85', cuffHex: '#8FB0E0', isShorts: false, shoeHex: '#FF6B4A' },
  { id: 'cargo_shorts',   label: 'Cargo Shorts',  waistHex: '#C5A478', legHex: '#C5A478', cuffHex: null,      isShorts: true,  shoeHex: '#1FA6A0' },
  { id: 'sport_shorts',   label: 'Sport Shorts',  waistHex: '#22304C', legHex: '#22304C', cuffHex: '#F7F5F0', isShorts: true,  shoeHex: '#2E6FDB' },
  { id: 'joggers',        label: 'Track Joggers', waistHex: '#283044', legHex: '#283044', cuffHex: '#191E2B', isShorts: false, shoeHex: '#FF6B4A' },
  { id: 'overalls_jeans', label: 'Overall Denim', waistHex: '#2F5596', legHex: '#2F5596', cuffHex: '#92B2E3', isShorts: false, shoeHex: '#FFB830' },
];

export const SKIN_TONES = [
  { id: 'warm_peach',  label: 'Warm Peach',  hex: '#F3BA95' },
  { id: 'golden_tan',  label: 'Golden Tan',  hex: '#D99568' },
  { id: 'rich_cocoa',  label: 'Rich Cocoa',  hex: '#8A5035' },
  { id: 'soft_ivory',  label: 'Rosy Ivory',  hex: '#F6CBB1' },
  { id: 'vinyl_cream', label: 'Vinyl Cream', hex: '#F4EFE6' },
];

export const HAIR_COLORS = [
  { id: 'chestnut',      label: 'Chestnut',      hex: '#6E412A' },
  { id: 'espresso',      label: 'Espresso',      hex: '#2A211E' },
  { id: 'golden_blonde', label: 'Golden Blonde', hex: '#F2B83B' },
  { id: 'auburn_ginger', label: 'Auburn Ginger', hex: '#D85A2B' },
  { id: 'berry_spark',   label: 'Berry Spark',   hex: '#D9468F' },
  { id: 'cobalt',        label: 'Cobalt Blue',   hex: '#2E6FDB' },
];

export const HAT_COLORS = [
  { id: 'cobalt_cap',    label: 'Sport Cobalt',  hex: '#2E6FDB' },
  { id: 'crimson_red',   label: 'Crimson Red',   hex: '#D63A34' },
  { id: 'adventure_tan', label: 'Adventure Tan', hex: '#C68B59' },
  { id: 'safety_gold',   label: 'Safety Yellow', hex: '#F5C518' },
  { id: 'ranger_olive',  label: 'Ranger Olive',  hex: '#5B6E46' },
  { id: 'charcoal_ink',  label: 'Charcoal Ink',  hex: '#262932' },
  { id: 'coral_spark',   label: 'Coral Spark',   hex: '#FF6B4A' },
  { id: 'cream_felt',    label: 'Cream Felt',    hex: '#EFE9DC' },
];

export const HAIR_OPTIONS = [
  { id: 'off',          label: 'None',                    hatReady: true,  topH: 0.0,  seatY: 0.0 },
  // topH = WIG_TOP_Z (4.8 mm): where a hat-ready wig's 2x1 studs sit above the head's stud plane. seatY = the wig's hem, i.e. its lowest point.
  { id: 'short_swept',  label: 'Swept (Hat-Ready)',       hatReady: true,  topH: 4.8, seatY: -16.5 },
  { id: 'bob',          label: 'Bob (Hat-Ready)',         hatReady: true,  topH: 4.8, seatY: -19.0 },
  { id: 'swoosh',       label: 'Swoosh (Hat-Ready)',      hatReady: true,  topH: 4.8, seatY: -16.5 },
  { id: 'long_layered', label: 'Long Flow (Hat-Ready)',   hatReady: true,  topH: 4.8, seatY: -22.5 },
  { id: 'twin_braids',  label: 'Twin Braids (Hat-Ready)', hatReady: true,  topH: 4.8, seatY: -22.5 },
  { id: 'shag',         label: 'Shag (Hat-Ready)',        hatReady: true,  topH: 4.8, seatY: -17.0 },
  { id: 'bowl',         label: 'Bowl Cut (Hat-Ready)',    hatReady: true,  topH: 4.8, seatY: -16.0 },
  { id: 'slick',        label: 'Sleek Part (Hat-Ready)',  hatReady: true,  topH: 4.8, seatY: -16.0 },
  { id: 'pompadour',    label: 'Pompadour',               hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'top_bun',      label: 'Top Bun',                 hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'side_sweep',   label: 'Side Sweep',              hatReady: false, topH: 0.0,  seatY: -19.0 },
  { id: 'spiky',        label: 'Spiky Tufts',             hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'pigtails',     label: 'Twin Pigtails',           hatReady: false, topH: 0.0,  seatY: -17.0 },
  { id: 'ponytail',     label: 'High Ponytail',           hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'curly',        label: 'Cloud Curls',             hatReady: false, topH: 0.0,  seatY: -17.0 },
  { id: 'mohawk',       label: 'Action Mohawk',           hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'pixie',        label: 'Pixie Tufts',             hatReady: false, topH: 0.0,  seatY: -15.0 },
  { id: 'side_pony',    label: 'Side Ponytail',           hatReady: false, topH: 0.0,  seatY: -16.5 },
  { id: 'low_bun',      label: 'Low Nape Bun',            hatReady: false, topH: 0.0,  seatY: -16.5 },
];

export const WEARABLE_HAT_IDS = new Set([
  'ballcap', 'beanie', 'cowboy', 'hardhat', 'ranger', 'tophat', 'pirate',
]);

export const HAT_OPTIONS = [
  { id: 'buds',    label: 'Spark Buds' },
  { id: 'ballcap', label: 'Sport Ballcap',   defaultCol: 'cobalt_cap' },
  { id: 'beanie',  label: 'Ribbed Beanie',   defaultCol: 'crimson_red' },
  { id: 'cowboy',  label: 'Cowboy Hat',      defaultCol: 'adventure_tan' },
  { id: 'hardhat', label: 'Builder Hardhat', defaultCol: 'safety_gold' },
  { id: 'ranger',  label: 'Explorer Hat',    defaultCol: 'ranger_olive' },
  { id: 'tophat',  label: 'Dapper Top Hat',  defaultCol: 'charcoal_ink' },
  { id: 'pirate',  label: 'Tricorne Hat',    defaultCol: 'charcoal_ink' },
  { id: 'hat',     label: 'Wobble Hat' },
  { id: 'ears',    label: 'Pointy Ears' },
  { id: 'horns',   label: 'Bumper Horns' },
  { id: 'blank',   label: 'Blank Cap' },
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

export const PROP_CATEGORIES = [
  { id: 'all',         label: 'All' },
  { id: 'tools',       label: 'Tools' },
  { id: 'cleaning',    label: 'Cleaning' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'play',        label: 'Play & Gear' },
];

// W12 categorised hand props: every one is a flat-printed head on the same 6.6 mm flat-sided Pro grip shaft as prop_wrench.
export const WORKSHOP_PROPS = [
  { id: 'hammer',       part: 'prop_hammer',       geo: 'propHammer',      cat: 'tools',       label: 'Claw Hammer',       mat: 'cobalt' },
  { id: 'screwdriver',  part: 'prop_screwdriver',  geo: 'propScrewdriver', cat: 'tools',       label: 'Screwdriver',       mat: 'spark' },
  { id: 'paint_roller', part: 'prop_paint_roller', geo: 'propPaintRoller', cat: 'tools',       label: 'Paint Roller',      mat: 'teal' },
  { id: 'mop',          part: 'prop_mop',          geo: 'propMop',         cat: 'cleaning',    label: 'String Mop',        mat: 'sun' },
  { id: 'broom',        part: 'prop_broom',        geo: 'propBroom',       cat: 'cleaning',    label: 'Bristle Broom',     mat: 'teal' },
  { id: 'scrub_brush',  part: 'prop_scrub_brush',  geo: 'propScrubBrush',  cat: 'cleaning',    label: 'Scrub Brush',       mat: 'plum' },
  { id: 'vacuum',       part: 'prop_vacuum',       geo: 'propVacuum',      cat: 'cleaning',    label: 'Handheld Vacuum',   mat: 'cobalt' },
  { id: 'guitar',       part: 'prop_guitar',       geo: 'propGuitar',      cat: 'instruments', label: 'Acoustic Guitar',   mat: 'sun' },
  { id: 'trumpet',      part: 'prop_trumpet',      geo: 'propTrumpet',     cat: 'instruments', label: 'Brass Trumpet',     mat: 'sun' },
  { id: 'maracas',      part: 'prop_maracas',      geo: 'propMaracas',     cat: 'instruments', label: 'Rattle Maraca',     mat: 'spark' },
  { id: 'flag',         part: 'prop_flag',         geo: 'propFlag',        cat: 'play',        label: 'Swallow-Tail Flag', mat: 'plum' },
  { id: 'magnifier',    part: 'prop_magnifier',    geo: 'propMagnifier',   cat: 'play',        label: 'Magnifying Glass',  mat: 'teal' },
];

export const PROP_OPTIONS = [
  { id: 'off',        label: 'Off',         cat: 'all' },
  { id: 'wrench',     label: 'Pro Wrench',  cat: 'tools' },
  { id: 'shield',     label: 'Star Shield', cat: 'play' },
  { id: 'shaft',      label: 'Pro Spinner', cat: 'tools' },
  { id: 'skateboard', label: 'Skateboard',  cat: 'play' },
  ...WORKSHOP_PROPS.map(({ id, label, cat }) => ({ id, label, cat })),
];

export const VEHICLE_OPTIONS = [
  { id: 'none',    label: 'On Foot' },
  { id: 'car',     label: 'Roadster Car' },
  { id: 'truck',   label: 'Hauler Truck' },
  { id: 'scooter', label: 'Motor Scooter' },
  { id: 'moto',    label: 'Sport Motorbike' },
];

export async function loadExpansionGeos(loadSTL) {
  const vq = `?v=${KIP_BUILD_VERSION}`;
  const entries = await Promise.all([
    // Phase 1 Curved Low-Poly & Wide Vinyl Squircle Humanoid Heads + 3 Universal Face Inserts + Critters + Bolt
    ['crownBuds2x1',       loadSTL(`/kip/partspec/toyventor_crown_buds_2x1.stl${vq}`, 34)],
    ['charHeadKid',        loadSTL(`/kip/partspec/toyventor_char_head_kid_S.stl${vq}`, 16)],
    ['charHeadChibi',      loadSTL(`/kip/partspec/toyventor_char_head_chibi_S.stl${vq}`, 38)],
    ['charHeadTall',       loadSTL(`/kip/partspec/toyventor_char_head_tall_S.stl${vq}`, 16)],
    ['charHeadJumbo',      loadSTL(`/kip/partspec/toyventor_char_head_jumbo_S.stl${vq}`, 16)],
    ['charFaceplate',      loadSTL(`/kip/partspec/toyventor_char_faceplate_P.stl${vq}`, 16)],
    ['charFaceplateVinyl', loadSTL(`/kip/partspec/toyventor_char_faceplate_vinyl_P.stl${vq}`, 28)],
    ['charFaceplateFlat',  loadSTL(`/kip/partspec/toyventor_char_faceplate_flat_P.stl${vq}`, 22)],
    ['charHeadFox',        loadSTL(`/kip/partspec/toyventor_char_head_fox_S.stl${vq}`, 62)],
    ['charHeadBear',       loadSTL(`/kip/partspec/toyventor_char_head_bear_S.stl${vq}`, 62)],
    ['robotHeadVisor',     loadSTL(`/kip/partspec/toyventor_robot_head_visor_S.stl${vq}`, 28)],
    ['robotHeadScout',     loadSTL(`/kip/partspec/toyventor_robot_head_scout_S.stl${vq}`, 32)],
    ['charHeadCat',        loadSTL(`/kip/partspec/toyventor_char_head_cat_S.stl${vq}`, 56)],
    ['charHeadDragon',     loadSTL(`/kip/partspec/toyventor_char_head_dragon_S.stl${vq}`, 40)],
    ['charHeadAlien',      loadSTL(`/kip/partspec/toyventor_char_head_alien_S.stl${vq}`, 48)],
    ['charHeadImp',        loadSTL(`/kip/partspec/toyventor_char_head_imp_S.stl${vq}`, 40)],
    // 19 Sculpted Multi-Strand 2x1 Hairstyles (8 Hat-Ready with top_studs + 11 Sculpted-Top)
    ['hairShortSwept',     loadSTL(`/kip/partspec/toyventor_hair_short_swept_S.stl${vq}`, 36)],
    ['hairBob',            loadSTL(`/kip/partspec/toyventor_hair_bob_S.stl${vq}`, 36)],
    ['hairSwoosh',         loadSTL(`/kip/partspec/toyventor_hair_swoosh_S.stl${vq}`, 36)],
    ['hairLongLayered',    loadSTL(`/kip/partspec/toyventor_hair_long_layered_S.stl${vq}`, 36)],
    ['hairTwinBraids',     loadSTL(`/kip/partspec/toyventor_hair_twin_braids_S.stl${vq}`, 34)],
    ['hairShag',           loadSTL(`/kip/partspec/toyventor_hair_shag_S.stl${vq}`, 36)],
    ['hairBowl',           loadSTL(`/kip/partspec/toyventor_hair_bowl_S.stl${vq}`, 36)],
    ['hairSlick',          loadSTL(`/kip/partspec/toyventor_hair_slick_S.stl${vq}`, 36)],
    ['hairPompadour',      loadSTL(`/kip/partspec/toyventor_hair_pompadour_S.stl${vq}`, 36)],
    ['hairTopBun',         loadSTL(`/kip/partspec/toyventor_hair_top_bun_S.stl${vq}`, 36)],
    ['hairSideSweep',      loadSTL(`/kip/partspec/toyventor_hair_side_sweep_S.stl${vq}`, 36)],
    ['hairSpiky',          loadSTL(`/kip/partspec/toyventor_hair_spiky_S.stl${vq}`, 34)],
    ['hairPigtails',       loadSTL(`/kip/partspec/toyventor_hair_pigtails_S.stl${vq}`, 36)],
    ['hairPonytail',       loadSTL(`/kip/partspec/toyventor_hair_ponytail_S.stl${vq}`, 36)],
    ['hairCurly',          loadSTL(`/kip/partspec/toyventor_hair_curly_S.stl${vq}`, 40)],
    ['hairMohawk',         loadSTL(`/kip/partspec/toyventor_hair_mohawk_S.stl${vq}`, 34)],
    ['hairPixie',          loadSTL(`/kip/partspec/toyventor_hair_pixie_S.stl${vq}`, 36)],
    ['hairSidePony',       loadSTL(`/kip/partspec/toyventor_hair_side_pony_S.stl${vq}`, 36)],
    ['hairLowBun',         loadSTL(`/kip/partspec/toyventor_hair_low_bun_S.stl${vq}`, 36)],
    // 7 Support-Free Wearable Hats + Horns
    ['hatBallcap',         loadSTL(`/kip/partspec/toyventor_hat_ballcap_S.stl${vq}`, 34)],
    ['hatBeanie',          loadSTL(`/kip/partspec/toyventor_hat_beanie_S.stl${vq}`, 34)],
    ['hatCowboy',          loadSTL(`/kip/partspec/toyventor_hat_cowboy_S.stl${vq}`, 34)],
    ['hatHardhat',         loadSTL(`/kip/partspec/toyventor_hat_hardhat_S.stl${vq}`, 32)],
    ['hatRanger',          loadSTL(`/kip/partspec/toyventor_hat_ranger_S.stl${vq}`, 34)],
    ['hatTophat',          loadSTL(`/kip/partspec/toyventor_hat_tophat_S.stl${vq}`, 34)],
    ['hatPirate',          loadSTL(`/kip/partspec/toyventor_hat_pirate_S.stl${vq}`, 32)],
    ['bumperHorns',        loadSTL(`/kip/partspec/toyventor_bumper_horns_S.stl${vq}`, 34)],
    // Backpacks & Props
    ['packExplorer',      loadSTL('/kip/partspec/toyventor_pack_explorer_S.stl', 35)],
    ['robotJetpack',      loadSTL('/kip/partspec/toyventor_robot_back_jetpack_S.stl', 35)],
    ['propWrench',        loadSTL('/kip/partspec/toyventor_prop_wrench_P.stl', 35)],
    ['propStarShield',    loadSTL('/kip/partspec/toyventor_prop_star_shield_P.stl', 35)],
    ...WORKSHOP_PROPS.map((p) => [p.geo, loadSTL(`/kip/partspec/toyventor_${p.part}_P.stl`, 35)]),
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

export const EXP_PALETTE = {
  cobalt:   '#2E6FDB',
  teal:     '#1FA6A0',
  plum:     '#7C4DFF',
  sun:      '#FFB830',
  fox:      '#E86F38',
  bear:     '#B58052',
  botSilv:  '#DCE3EE',
  botScout: '#4E73A8',
  cat:      '#E5C193',
  dragon:   '#2EB872',
  alien:    '#5CD6A9',
  imp:      '#6E85E6',
  tire:     '#20232A',
  rimAlloy: '#EDF2F8',
  rimGold:  '#FFD25A',
  custom:   '#7C4DFF',
};

export function resolveBodyColors({
  head = 'kid',
  skinId = 'warm_peach',
  shirtId = 'off',
  pantsId = 'off',
  sparkHex = '#FF6B4A',
} = {}) {
  const skinObj = SKIN_TONES.find(s => s.id === skinId) || SKIN_TONES[0];
  const shirt = SHIRT_OPTIONS.find(s => s.id === shirtId) || SHIRT_OPTIONS[0];
  const pants = PANTS_OPTIONS.find(p => p.id === pantsId) || PANTS_OPTIONS[0];

  const headSkinHex = skinObj.hex.toUpperCase();
  let bodySkinHex = headSkinHex;
  if (head === 'fox') bodySkinHex = EXP_PALETTE.fox;
  else if (head === 'bear') bodySkinHex = EXP_PALETTE.bear;
  else if (head === 'robot') bodySkinHex = EXP_PALETTE.botSilv;
  else if (head === 'scout') bodySkinHex = EXP_PALETTE.botScout;
  else if (head === 'cat') bodySkinHex = EXP_PALETTE.cat;
  else if (head === 'dragon') bodySkinHex = EXP_PALETTE.dragon;
  else if (head === 'alien') bodySkinHex = EXP_PALETTE.alien;
  else if (head === 'imp') bodySkinHex = EXP_PALETTE.imp;

  let neckHex = sparkHex.toUpperCase();
  if (HUMAN_HEAD_IDS.has(head)) neckHex = bodySkinHex;
  else if (head === 'fox') neckHex = EXP_PALETTE.fox;
  else if (head === 'bear') neckHex = EXP_PALETTE.bear;
  else if (head === 'robot') neckHex = '#36405C';
  else if (head === 'scout') neckHex = '#2A3F66';
  else if (head === 'cat') neckHex = EXP_PALETTE.cat;
  else if (head === 'dragon') neckHex = EXP_PALETTE.dragon;
  else if (head === 'alien') neckHex = EXP_PALETTE.alien;
  else if (head === 'imp') neckHex = EXP_PALETTE.imp;

  const hasShirt   = (shirt.id !== 'off');
  const hasPants   = (pants.id !== 'off');
  const chestHex   = (hasShirt ? shirt.chestHex  : bodySkinHex).toUpperCase();
  const sleeveHex  = (hasShirt ? shirt.sleeveHex : bodySkinHex).toUpperCase();
  const forearmHex = ((hasShirt && shirt.longSleeve) ? shirt.sleeveHex : bodySkinHex).toUpperCase();
  const thighHex   = (hasPants ? pants.legHex    : bodySkinHex).toUpperCase();
  const shinHex    = ((hasPants && !pants.isShorts) ? pants.legHex : bodySkinHex).toUpperCase();
  const activeShoeHex = (pants.shoeHex || shirt.shoeHex || '#283044').toUpperCase();
  const joints = {
    shoulder: sleeveHex,
    elbow: forearmHex,
    wrist: bodySkinHex,
    hip: thighHex,
    knee: shinHex,
    ankle: activeShoeHex,
  };

  return {
    headSkinHex,
    bodySkinHex: bodySkinHex.toUpperCase(),
    neckHex: neckHex.toUpperCase(),
    hasShirt,
    hasPants,
    chestHex,
    sleeveHex,
    forearmHex,
    thighHex,
    shinHex,
    activeShoeHex,
    joints,
  };
}

export function attachExpansionToKipRig(THREE, kip, expGeos, baseParts, mats, scadMesh, createSlot) {
  // Brand-aligned wardrobe, skin/hair, and alloy wheel materials (`BRAND_STYLE.md`)
  const expMats = {
    skin:     new THREE.MeshPhysicalMaterial({ color: SKIN_TONES[0].hex, roughness: 0.60, clearcoat: 0.03, envMapIntensity: 0.44 }),
    hair:     new THREE.MeshPhysicalMaterial({ color: HAIR_COLORS[0].hex, roughness: 0.42, clearcoat: 0.22, envMapIntensity: 0.70 }),
    hat:      new THREE.MeshPhysicalMaterial({ color: HAT_COLORS[0].hex, roughness: 0.44, clearcoat: 0.22, envMapIntensity: 0.68 }),
    cobalt:   new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.cobalt, roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    teal:     new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.teal, roughness: 0.35, clearcoat: 0.44, envMapIntensity: 0.76 }),
    plum:     new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.plum, roughness: 0.34, clearcoat: 0.45, envMapIntensity: 0.76 }),
    sun:      new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.sun, roughness: 0.34, clearcoat: 0.46, envMapIntensity: 0.78 }),
    fox:      new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.fox, roughness: 0.44, clearcoat: 0.24, envMapIntensity: 0.70 }),
    bear:     new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.bear, roughness: 0.48, clearcoat: 0.18, envMapIntensity: 0.66 }),
    botSilv:  new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.botSilv, roughness: 0.32, metalness: 0.12, clearcoat: 0.48, envMapIntensity: 0.80 }),
    botScout: new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.botScout, roughness: 0.30, metalness: 0.14, clearcoat: 0.50, envMapIntensity: 0.80 }),
    cat:      new THREE.MeshStandardMaterial({ color: EXP_PALETTE.cat, roughness: 0.62, metalness: 0.0 }),
    dragon:   new THREE.MeshStandardMaterial({ color: EXP_PALETTE.dragon, roughness: 0.52, metalness: 0.0 }),
    alien:    new THREE.MeshStandardMaterial({ color: EXP_PALETTE.alien, roughness: 0.42, metalness: 0.0 }),
    imp:      new THREE.MeshStandardMaterial({ color: EXP_PALETTE.imp, roughness: 0.64, metalness: 0.0 }),
    tire:     new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.tire, roughness: 0.56, clearcoat: 0.15, envMapIntensity: 0.55 }),
    rimAlloy: new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.rimAlloy, roughness: 0.26, metalness: 0.22, clearcoat: 0.55, envMapIntensity: 0.88 }),
    rimGold:  new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.rimGold, roughness: 0.28, metalness: 0.18, clearcoat: 0.52, envMapIntensity: 0.86 }),
    custom:   new THREE.MeshPhysicalMaterial({ color: EXP_PALETTE.custom, roughness: 0.32, clearcoat: 0.50, envMapIntensity: 0.80 }),
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

  // 1. Compact Low-Profile Neck Turret (`neck_turret_2x1`: built on `kip.neckTurret2x1Slot`, recolored here per head/skin!)
  const neckMat = mats.spark.clone();
  const neckTurret2x1Slot = kip.neckTurret2x1Slot;
  if (neckTurret2x1Slot) {
    neckTurret2x1Slot.traverse(o => { if (o.isMesh) o.material = neckMat; });
  }

  const altHeadsGroup = new THREE.Group();
  kip.headLocal.add(altHeadsGroup);

  const altHeadSlot = createSlot('alt_head', altHeadsGroup, [0, 40, 0], 4.05, 'both', 'neck_anchor');
  const headMeshes = {
    kid:   scadMesh(expGeos.charHeadKid,   expMats.skin),
    chibi: scadMesh(expGeos.charHeadChibi, expMats.skin),
    tall:  scadMesh(expGeos.charHeadTall,  expMats.skin),
    jumbo: scadMesh(expGeos.charHeadJumbo, expMats.skin),
    fox:   scadMesh(expGeos.charHeadFox,   expMats.fox),
    bear:  scadMesh(expGeos.charHeadBear,  expMats.bear),
    robot: scadMesh(expGeos.robotHeadVisor, expMats.botSilv),
    scout: scadMesh(expGeos.robotHeadScout, expMats.botScout),
    cat:   scadMesh(expGeos.charHeadCat,    expMats.cat),
    dragon: scadMesh(expGeos.charHeadDragon, expMats.dragon),
    alien: scadMesh(expGeos.charHeadAlien,  expMats.alien),
    imp:   scadMesh(expGeos.charHeadImp,    expMats.imp),
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

  // 1b. Universal Swappable Human Face Inserts (`char_faceplate` 3D Nose & Orbitals, `char_faceplate_vinyl` 3D Button Eyes & Nose, `char_faceplate_flat` Smooth Decal Insert!)
  const faceplateGroup = new THREE.Group();
  faceplateGroup.visible = false;
  kip.headLocal.add(faceplateGroup);
  const faceplateSlot = createSlot('char_faceplate', faceplateGroup, [0, 8, 56], 4.35, 'both', 'alt_head');
  const faceplateHolder = new THREE.Group();
  faceplateHolder.position.set(0, 17.1875 - 2.50, FACE_STEM_MM); // stem axis is 2.5 mm above the trimmed chin edge (was 2.9 before 6b20bed)
  faceplateSlot.add(faceplateHolder);

  const fpOrient = new THREE.Group();
  fpOrient.rotation.y = Math.PI;
  const faceplateMesh = scadMesh(expGeos.charFaceplate, expMats.skin);
  const faceplateVinylMesh = scadMesh(expGeos.charFaceplateVinyl, expMats.skin);
  faceplateVinylMesh.visible = false;
  const faceplateFlatMesh = scadMesh(expGeos.charFaceplateFlat, expMats.skin);
  faceplateFlatMesh.visible = false;
  fpOrient.add(faceplateMesh, faceplateVinylMesh, faceplateFlatMesh);
  faceplateHolder.add(fpOrient);

  // Conformal 2D Vinyl/Stencil Decal Expression Meshes (100% of human eyes/noses/decals live strictly on the universal faceplates!)
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, 0, -1);

  function buildConformalFaceplateDecalGeo(insertGeo, width = 23.6, height = 10.1, centerY = 5.25) {
    const probeHolder = new THREE.Group();
    probeHolder.rotation.y = Math.PI;
    const probe = scadMesh(insertGeo, mats.shell);
    probeHolder.add(probe);
    probeHolder.updateMatrixWorld(true);

    const g = new THREE.PlaneGeometry(width, height, 56, 28);
    g.translate(0, centerY, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      let hitZ = null;
      rayOrigin.set(vx, vy, 28);
      raycaster.set(rayOrigin, rayDir);
      const hits = raycaster.intersectObject(probeHolder, true);
      if (hits.length > 0 && hits[0].point.z > 0.2) {
        hitZ = hits[0].point.z;
      }
      if (hitZ === null) {
        hitZ = 2.65 - (vx * vx) * 0.002;
      }
      pos.setZ(i, hitZ + 0.22);
    }
    g.computeVertexNormals();
    return g;
  }

  const faceplateDecalGeos = {
    sculpted: buildConformalFaceplateDecalGeo(expGeos.charFaceplate),
    vinyl:    buildConformalFaceplateDecalGeo(expGeos.charFaceplateVinyl),
    flat:     buildConformalFaceplateDecalGeo(expGeos.charFaceplateFlat),
    // The selfie rides the flat insert on its own, taller plane: the visible plate runs up under the brow, past the 10.1 mm the 2D art uses.
    selfie:   buildConformalFaceplateDecalGeo(expGeos.charFaceplateFlat, FACEPLATE_DECAL.width, FACEPLATE_DECAL.height, FACEPLATE_DECAL.centerY),
  };

  function buildConformalDecalGeo(headGeo, centerY, width, height, segX = 20, segY = 12) {
    const probe = new THREE.Mesh(headGeo, mats.shell);
    probe.rotation.x = -Math.PI / 2;
    probe.position.y = 0.0;
    probe.updateMatrixWorld(true);

    const g = new THREE.PlaneGeometry(width, height, segX, segY);
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
    scout: buildConformalDecalGeo(expGeos.robotHeadScout, 17.6, 25.0, 9.6),
    cat:   buildConformalDecalGeo(expGeos.charHeadCat,    15.2, 28.0, 14.0),
    dragon: buildConformalDecalGeo(expGeos.charHeadDragon, 17.2, 26.0, 13.0),
    alien: buildConformalDecalGeo(expGeos.charHeadAlien,  18.2, 24.0, 13.0),
    imp:   buildConformalDecalGeo(expGeos.charHeadImp,    16.4, 28.0, 13.6),
  };

  const decalTex = new THREE.CanvasTexture(createDecalExpressionCanvas('spark', 'kid', 'sculpted'));
  decalTex.colorSpace = THREE.SRGBColorSpace;
  const decalMat = new THREE.MeshStandardMaterial({
    map: decalTex,
    transparent: true,
    alphaTest: 0.02,
    roughness: 0.44,
    metalness: 0.0,
    envMapIntensity: 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  // Conformal 2D human face expression wrapped directly onto the active universal face insert (`sculpted`, `vinyl`, or `flat`)!
  const faceplateDecalPlane = new THREE.Mesh(faceplateDecalGeos.sculpted, decalMat);
  faceplateDecalPlane.renderOrder = 2;
  faceplateHolder.add(faceplateDecalPlane);

  // Conformal 2D decal plane for Critter / Robot heads
  const decalPlane = new THREE.Mesh(headDecalGeos.fox, decalMat);
  decalPlane.visible = false;
  decalPlane.renderOrder = 2;
  altHeadSlot.add(decalPlane);

  // 2a. Separate Clip-On 2x1 Hair Slot (`hairSlot`: 19 sculpted multi-strand wigs; 8 Hat-Ready wigs expose `#FF6B4A` 2x1 studs on top!)
  const hairGroup = new THREE.Group();
  hairGroup.visible = false;
  kip.headLocal.add(hairGroup);
  const hairSlot = createSlot('hair_clip', hairGroup, [0, 72, 0], 4.65, 'both', 'alt_head');
  const hairAnchor = new THREE.Group();
  hairAnchor.position.set(0, 28.0, 0);
  hairSlot.add(hairAnchor);

  const hairMeshes = {
    short_swept:  scadMesh(expGeos.hairShortSwept,  expMats.hair),
    bob:          scadMesh(expGeos.hairBob,         expMats.hair),
    swoosh:       scadMesh(expGeos.hairSwoosh,      expMats.hair),
    long_layered: scadMesh(expGeos.hairLongLayered, expMats.hair),
    twin_braids:  scadMesh(expGeos.hairTwinBraids,  expMats.hair),
    shag:         scadMesh(expGeos.hairShag,        expMats.hair),
    bowl:         scadMesh(expGeos.hairBowl,        expMats.hair),
    slick:        scadMesh(expGeos.hairSlick,       expMats.hair),
    pompadour:    scadMesh(expGeos.hairPompadour,   expMats.hair),
    top_bun:      scadMesh(expGeos.hairTopBun,      expMats.hair),
    side_sweep:   scadMesh(expGeos.hairSideSweep,   expMats.hair),
    spiky:        scadMesh(expGeos.hairSpiky,       expMats.hair),
    pigtails:     scadMesh(expGeos.hairPigtails,    expMats.hair),
    ponytail:     scadMesh(expGeos.hairPonytail,    expMats.hair),
    curly:        scadMesh(expGeos.hairCurly,       expMats.hair),
    mohawk:       scadMesh(expGeos.hairMohawk,      expMats.hair),
    pixie:        scadMesh(expGeos.hairPixie,       expMats.hair),
    side_pony:    scadMesh(expGeos.hairSidePony,    expMats.hair),
    low_bun:      scadMesh(expGeos.hairLowBun,      expMats.hair),
  };
  for (const [k, m] of Object.entries(hairMeshes)) {
    const opt = HAIR_OPTIONS.find(h => h.id === k);
    m.position.y = opt ? opt.seatY : -HAIR_WRAP_MM;
    m.visible = false;
    hairAnchor.add(m);
  }
  const hairCrownBuds = scadMesh(expGeos.crownBuds2x1, mats.spark);
  hairCrownBuds.scale.set(1.006, 1.01, 1.006);
  hairCrownBuds.visible = false;
  hairAnchor.add(hairCrownBuds);

  // 2b. Stackable Hat / Top Accessory Anchor (`kip.crownAccSlot`: sits on bald head crown OR stacks on top of Hat-Ready hair!)
  const crownAnchor = new THREE.Group();
  crownAnchor.position.set(0, 42.2, 0);
  kip.crownAccSlot.add(crownAnchor);

  kip.pointyEars.position.set(0, 0, 0);
  kip.wobbleHat.position.set(6.25, 0, 0);
  crownAnchor.add(kip.pointyEars, kip.wobbleHat);

  const hatMeshes = {
    ballcap:   scadMesh(expGeos.hatBallcap,      expMats.hat),
    beanie:    scadMesh(expGeos.hatBeanie,       expMats.hat),
    cowboy:    scadMesh(expGeos.hatCowboy,       expMats.hat),
    hardhat:   scadMesh(expGeos.hatHardhat,      expMats.hat),
    ranger:    scadMesh(expGeos.hatRanger,       expMats.hat),
    tophat:    scadMesh(expGeos.hatTophat,       expMats.hat),
    pirate:    scadMesh(expGeos.hatPirate,       expMats.hat),
    horns:     scadMesh(expGeos.bumperHorns,     expMats.sun),
    ponytail:  scadMesh(expGeos.hairPonytail,    expMats.hair),
    wizardHat: scadMesh(expGeos.customWizardHat, expMats.plum),
  };
  for (const [k, m] of Object.entries(hatMeshes)) {
    // Support-free wearable hats sit on the bed at z_stl = 0 (rim) with the 2x1 sockets at z_stl = HAT_RIM_MM[id]: the rim wraps down over the head
    m.position.y = WEARABLE_HAT_IDS.has(k) ? -(HAT_RIM_MM[k] ?? HAT_WRAP_MM) : (k === 'ponytail' ? -HAIR_WRAP_MM : 0);
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

  // W12 categorised workshop props (tools / cleaning / instruments / play): one hidden group per prop in the right hand.
  const workshopGroups = {};
  for (const wp of WORKSHOP_PROPS) {
    const grp = new THREE.Group();
    grp.visible = false;
    kip.joints.rightHandCgripParent.add(grp);
    const slot = createSlot(wp.part, grp, [-98, -44, 22], 5.4, 'both', 'hand_r');
    slot.add(makeHandheldProp(expGeos[wp.geo], expMats[wp.mat], 18.75, 2.5));
    workshopGroups[wp.id] = grp;
  }

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
  const seatedLegsMesh = scadMesh(expGeos.charLegsSeated, expMats.cobalt.clone());
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

  // =========================================================================
  // 8. FULL-BODY SKIN TONES + TWO-ZONE CLOTHING + CONFORMAL 2D OUTFIT DECALS
  // =========================================================================
  const outfitVertMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.58,
    clearcoat: 0.04,
    clearcoatRoughness: 0.52,
    envMapIntensity: 0.46,
  });

  const jointMats = {
    shoulder: mats.spark.clone(),
    elbow:    mats.spark.clone(),
    wrist:    mats.spark.clone(),
    hip:      mats.spark.clone(),
    knee:     mats.spark.clone(),
    ankle:    mats.spark.clone(),
  };

  function findSlot(id) {
    return kip.partSlots.find(s => s.id === id) || null;
  }

  function findSlotPrimaryMesh(id) {
    const sl = findSlot(id);
    if (!sl) return null;
    let found = null;
    sl.grp.traverse(o => { if (!found && o.isMesh) found = o; });
    return found;
  }

  function assignSlotMat(ids, mat) {
    for (const id of ids) {
      const sl = findSlot(id);
      if (!sl) continue;
      sl.grp.traverse(o => { if (o.isMesh) o.material = mat; });
    }
  }

  assignSlotMat(['sho_peg_l', 'sho_peg_r', 'sho_turret_l', 'sho_turret_r'], jointMats.shoulder);
  assignSlotMat(['elb_peg_l', 'elb_peg_r'], jointMats.elbow);
  assignSlotMat(['wri_peg_l', 'wri_peg_r', 'snap_wri_l', 'snap_wri_r'], jointMats.wrist);
  assignSlotMat(['hip_peg_l', 'hip_peg_r', 'hip_turret_l', 'hip_turret_r'], jointMats.hip);
  assignSlotMat(['kne_peg_l', 'kne_peg_r'], jointMats.knee);
  assignSlotMat(['ank_peg_l', 'ank_peg_r', 'snap_ank_l', 'snap_ank_r'], jointMats.ankle);

  // Clone per-slot body geometries (for Pro scadMesh parts) or attach color buffer directly (for flex Snap limbs)
  // and cache rest coordinates so mid-animation skin/outfit changes never read deformed vertex positions!
  function prepVertColoredSlot(slotId, cloneGeo = true) {
    const m = findSlotPrimaryMesh(slotId);
    if (!m) return null;
    if (cloneGeo) m.geometry = m.geometry.clone();
    const g = m.geometry;
    const pos = g.attributes.position;
    const count = pos.count;
    const restY = new Float32Array(count);
    const restZ = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      restY[i] = pos.getY(i);
      restZ[i] = pos.getZ(i);
    }
    const colors = new Float32Array(count * 3);
    colors.fill(1.0);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    m.material = outfitVertMat;
    m.userData.restY = restY;
    m.userData.restZ = restZ;
    return m;
  }

  const bodyMeshes = {
    torsoPro:   prepVertColoredSlot('torso_pro', true),
    torsoSnap:  prepVertColoredSlot('torso_snap', true),
    upperArmL:  prepVertColoredSlot('upper_arm_l', true),
    upperArmR:  prepVertColoredSlot('upper_arm_r', true),
    forearmL:   prepVertColoredSlot('forearm_l', true),
    forearmR:   prepVertColoredSlot('forearm_r', true),
    snapArmL:   prepVertColoredSlot('snap_arm_l', false),
    snapArmR:   prepVertColoredSlot('snap_arm_r', false),
    handL:      prepVertColoredSlot('hand_l', true),
    handR:      prepVertColoredSlot('hand_r', true),
    thighL:     prepVertColoredSlot('thigh_l', true),
    thighR:     prepVertColoredSlot('thigh_r', true),
    shinL:      prepVertColoredSlot('shin_l', true),
    shinR:      prepVertColoredSlot('shin_r', true),
    snapLegL:   prepVertColoredSlot('snap_leg_l', false),
    snapLegR:   prepVertColoredSlot('snap_leg_r', false),
    bootL:      prepVertColoredSlot('boot_l', true),
    bootR:      prepVertColoredSlot('boot_r', true),
  };

  function buildConformalSlotDecalGeo(slotMesh, centerY, width, height, segX = 22, segY = 26) {
    if (!slotMesh) return new THREE.PlaneGeometry(width, height);
    const holder = new THREE.Group();
    const probe = new THREE.Mesh(slotMesh.geometry, mats.shell);
    probe.position.copy(slotMesh.position);
    probe.rotation.copy(slotMesh.rotation);
    probe.scale.copy(slotMesh.scale);
    holder.add(probe);
    holder.updateMatrixWorld(true);

    const g = new THREE.PlaneGeometry(width, height, segX, segY);
    g.translate(0, centerY, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      let hitZ = null;
      let hitX = vx;
      for (let step = 0; step <= 8; step++) {
        const s = 1.0 - step * 0.06;
        rayOrigin.set(vx * s, vy, 45);
        raycaster.set(rayOrigin, rayDir);
        const hits = raycaster.intersectObject(probe, false);
        if (hits.length > 0 && hits[0].point.z > 0.5) {
          hitZ = hits[0].point.z;
          hitX = vx * s;
          break;
        }
      }
      if (hitZ === null) hitZ = 10.5 - (vx * vx) * 0.02;
      pos.setX(i, hitX);
      pos.setZ(i, hitZ + 0.34);
    }
    g.computeVertexNormals();
    return g;
  }

  const torsoDecalTex = new THREE.CanvasTexture(createTorsoOutfitDecalCanvas('off', 'off', SKIN_TONES[0].hex));
  torsoDecalTex.colorSpace = THREE.SRGBColorSpace;
  const torsoDecalMat = new THREE.MeshStandardMaterial({
    map: torsoDecalTex,
    transparent: true,
    roughness: 0.34,
    metalness: 0.02,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const legDecalTex = new THREE.CanvasTexture(createLegOutfitDecalCanvas('off'));
  legDecalTex.colorSpace = THREE.SRGBColorSpace;
  const legDecalMat = new THREE.MeshStandardMaterial({
    map: legDecalTex,
    transparent: true,
    roughness: 0.36,
    metalness: 0.02,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  function attachSlotDecal(slotId, baseMesh, centerY, width, height, mat, segX = 20, segY = 24) {
    const sl = findSlot(slotId);
    if (!sl || !baseMesh) return null;
    const dm = new THREE.Mesh(buildConformalSlotDecalGeo(baseMesh, centerY, width, height, segX, segY), mat);
    dm.visible = false;
    dm.renderOrder = 2;
    sl.grp.add(dm);
    return dm;
  }

  // Front-only chest stencil sticker mapped onto the flat front chest of `torso` (`centerY = 86.8, width = 18.8, height = 21.6`)
  const torsoOutfitDecals = [
    attachSlotDecal('torso_pro',  bodyMeshes.torsoPro,  86.8, 18.8, 21.6, torsoDecalMat, 22, 24),
    attachSlotDecal('torso_snap', bodyMeshes.torsoSnap, 86.8, 18.8, 21.6, torsoDecalMat, 22, 24),
  ].filter(Boolean);

  const legOutfitDecals = [];

  const tmpColA = new THREE.Color();
  const tmpColB = new THREE.Color();

  function paintMeshByCoord(mesh, coordArray, fnPickColor) {
    if (!mesh) return;
    const attr = mesh.geometry.attributes.color;
    const arr = attr.array;
    for (let i = 0; i < attr.count; i++) {
      const c = fnPickColor(coordArray[i], i);
      arr[i * 3 + 0] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  }

  let lastDecalKey = '';

  function applyBodySkinAndClothing({ head = 'kid', skinId = 'warm_peach', shirtId = 'off', pantsId = 'off' } = {}) {
    const resolved = resolveBodyColors({ head, skinId, shirtId, pantsId });
    const {
      headSkinHex,
      bodySkinHex,
      neckHex,
      hasShirt,
      chestHex,
      sleeveHex,
      forearmHex,
      thighHex,
      shinHex,
      activeShoeHex,
      joints,
    } = resolved;
    const shirt = SHIRT_OPTIONS.find(s => s.id === shirtId) || SHIRT_OPTIONS[0];
    const pants = PANTS_OPTIONS.find(p => p.id === pantsId) || PANTS_OPTIONS[0];

    // Keep head skin material synced for all 4 human heads + face plate
    expMats.skin.color.set(headSkinHex);
    neckMat.color.set(neckHex);

    // 1. Solid Single-Filament Torso (`torso` = solid shirt color when wearing a shirt, else solid body skin!)
    tmpColA.set(chestHex);
    for (const tm of [bodyMeshes.torsoPro, bodyMeshes.torsoSnap]) {
      if (!tm) continue;
      paintMeshByCoord(tm, tm.userData.restZ, () => tmpColA);
    }

    // 2. Pro Upper Arms (`upper_arm_l/r` = solid shirt/sleeve color!) + Pro Forearms (`forearm_l/r` = solid skin for short-sleeve, solid sleeve for long-sleeve!)
    tmpColA.set(sleeveHex);
    for (const ua of [bodyMeshes.upperArmL, bodyMeshes.upperArmR]) {
      if (!ua) continue;
      paintMeshByCoord(ua, ua.userData.restZ, () => tmpColA);
    }

    tmpColA.set(forearmHex);
    for (const fa of [bodyMeshes.forearmL, bodyMeshes.forearmR]) {
      if (!fa) continue;
      paintMeshByCoord(fa, fa.userData.restZ, () => tmpColA);
    }

    // 3. Snap 1-Piece Arms (`snap_arm_l/r`: 100% solid single-filament part — bare skin for short-sleeve, sleeve color for long-sleeve)
    tmpColA.set(forearmHex);
    for (const sa of [bodyMeshes.snapArmL, bodyMeshes.snapArmR]) {
      if (!sa) continue;
      paintMeshByCoord(sa, sa.userData.restY, () => tmpColA);
    }

    // 4. Shared 3-Finger Hands (`hand_l` / `hand_r`): always solid skin tone matching the face!
    tmpColA.set(bodySkinHex);
    for (const hm of [bodyMeshes.handL, bodyMeshes.handR]) {
      if (!hm) continue;
      paintMeshByCoord(hm, hm.userData.restZ, () => tmpColA);
    }

    // 5. Pro Thighs (`thigh_l/r` = solid shorts/pants color) + Pro Shins (`shin_l/r` = solid skin tone for shorts, solid pants color for long pants!)
    tmpColA.set(thighHex);
    for (const th of [bodyMeshes.thighL, bodyMeshes.thighR]) {
      if (!th) continue;
      paintMeshByCoord(th, th.userData.restZ, () => tmpColA);
    }

    tmpColA.set(shinHex);
    for (const sh of [bodyMeshes.shinL, bodyMeshes.shinR]) {
      if (!sh) continue;
      paintMeshByCoord(sh, sh.userData.restZ, () => tmpColA);
    }

    // 6. Snap 1-Piece Legs (`snap_leg_l/r`: 100% solid single-filament part in shorts/pants color)
    tmpColA.set(thighHex);
    for (const sl of [bodyMeshes.snapLegL, bodyMeshes.snapLegR]) {
      if (!sl) continue;
      paintMeshByCoord(sl, sl.userData.restY, () => tmpColA);
    }
    seatedLegsMesh.material.color.set(thighHex);

    // 7. Solid Single-Filament Sneaker Boots (`boot_l/r` = one solid filament color per boot part!)
    tmpColA.set(activeShoeHex);
    for (const bm of [bodyMeshes.bootL, bodyMeshes.bootR]) {
      if (!bm) continue;
      paintMeshByCoord(bm, bm.userData.restZ, () => tmpColA);
    }

    // 8. Joint Pegs & Snap Turrets: solid filament colors matching adjacent limb parts!
    jointMats.shoulder.color.set(joints.shoulder);
    jointMats.elbow.color.set(joints.elbow);
    jointMats.wrist.color.set(joints.wrist);
    jointMats.hip.color.set(joints.hip);
    jointMats.knee.color.set(joints.knee);
    jointMats.ankle.color.set(joints.ankle);

    // 9. Front-Only Chest Stencil Sticker (placed strictly on the flat front chest when wearing a shirt!)
    const showTorsoDecal = hasShirt;
    for (const dm of torsoOutfitDecals) dm.visible = showTorsoDecal;

    const decalKey = `${shirt.id}|${bodySkinHex}`;
    if (showTorsoDecal && decalKey !== lastDecalKey) {
      lastDecalKey = decalKey;
      torsoDecalTex.image = createTorsoOutfitDecalCanvas(shirt.id, pants.id, bodySkinHex);
      torsoDecalTex.needsUpdate = true;
    }
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
    faceplateHolder,
    faceplateMesh,
    faceplateVinylMesh,
    faceplateFlatMesh,
    faceplateDecalGeos,
    faceplateDecalPlane,
    decalPlane,
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
    workshopGroups,
    customWandGroup,
    skateboardGroup,
    skateWheels,
    snapSeatedLegsGroup,
    snapSeatedLegsSlot,
    applyBodySkinAndClothing,
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
