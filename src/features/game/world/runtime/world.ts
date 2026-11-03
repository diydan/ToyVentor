// Native in-process ToyVentor World runtime.
// Instantiable factory: all state lives in this closure; zero module-level mutable singletons.
// Three.js 0.183.2 via Vite ES imports; THREE.Timer (no deprecated THREE.Clock).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { STAGE_CSS, STAGE_HTML } from "./stageDom";
import { applyLightRig, followHero, setDusk } from "./lighting";
import { BACKDROPS, createBackdrop, disposeArtCache, type ArtCache } from "./backdrop";
import { MixamoDriver, loadMixamoBank, type MixAction } from "./mixamo";
import { PROCEDURAL_CLIPS } from "./proceduralClips";
import { SPOT_COUNT, codeToSeed, composeLevel } from "./levelKit";
import * as MPD from "./missionData";
import * as CUD from "./customizerData";
import * as CRD from "./createData";
import * as EDD from "./editorData";
import {
LOOK,
STATS,
TYPES,
UI_TYPES,
ROBOT_TO_KIP,
KIP_BASE_LABELS,
WN,
ROWS,
PART,
BYSLOT,
HIDDEN,
key,
SKINS,
PAINTS,
stockSel,
stockCol,
slotPartKey,
slotPartObj,
slotOptionList,
INK,
WORLDS,
THEME_DEF,
HIDE,
HKIND,
PROPS,
THEMES,
KCOL,
LEVELS,
TOOLS,
MDEF,
GR,
TK,
FITS,
FTN,
ZN,
CHIPS,
levelWorld,
TNAME,
GATES,
RIT,
CSH,
CCY,
CGL,
CNEED,
CNM,
CON,
PB,
PR,
CWHY,
CFIT,
CTN,
FXN,
townNeighbors,
vehiclePerkForToy,
TOWN_SPARKLE_SPOTS,
townSparkleProgress,
type TownDistrictId,
type TownNeighbors,
type VehiclePerkSpec,
} from "./catalog";
import {
TREAD,
treadTex,
buildToy,
buildChar3,
buildRobot2,
wheelMesh,
carBody,
cabinBody,
eyes,
eyeOne,
eyeZ,
face,
smileZ,
blushZ,
vin,
glo,
pvc,
darken,
noShadow,
latheS,
holder,
spinner,
propeller,
baseVinyl,
baseBlock,
baseCreature,
baseRobotKip,
partEyes,
partEars,
partHat,
partBack,
partTail,
partProp,
partBoots,
screenFace,
upgradeRigWithStl,
clearStlRigCache,
} from "./playerRig";
import {
AC,
sound,
gestured,
ctx,
tone,
noise,
sfx,
partSound,
MOTOR,
motor,
MUS,
SONG,
musInit,
musGain,
mnote,
kick,
hit,
toolSound,
bellTone,
toggleSound,
muteAudio,
noteGesture,
resetAudio,
buzz,
say,
} from "./audio";
import { createMissions } from "./missions";
import { createEditor } from "./editor";
import { createPropFx } from "./propReactions";
import { createFeedHook } from "./feedingHook";
import { buildBed } from "./bed";
import { bushKind, kindById, orchardKind, palmFronds, palmFruitOffsets, palmKind, treeShape, type TreeKind } from "./treeKinds";
import { createSleepHook } from "./sleepHook";
import { createActs } from "./toyRoomActs";
import { createBubbles } from "./bubbles";
import { createHeld } from "./heldItems";
import { buildGuitarProp } from "./guitar";
import { buildBubbleBottle } from "./bubbleWand";
import { buildDog } from "./dog";
import { musicGain as sleepMusicGain } from "./sleepRoutine";
import { ladderById } from "../../../../lib/ladders";
import { toyPortraitSignature } from "../../../../lib/toyPortrait";
import type { BuildSummary, StatId } from "../../../../lib/garage";
import { learnRungDef } from "./learnRungs";
import { arriveScene, arriveSceneVisit, itemMarkerX, startSceneCarry, startSceneVisit, tapSceneItem, tapSceneSpot, tapSceneTarget, type SceneCarrySession, type SceneVisitSession } from "./level2Scene";
import {
renderer,
scene,
camera,
hemi,
sun,
blob,
perf,
composer,
bloom,
grade,
fxaa,
MC,
GT,
GLASS,
BUBBLE,
STARGEO,
GRADE,
TINT,
canv,
glowTex,
glowSprite,
plastic,
matte,
metal,
glowMat,
paintMat,
rbox,
M,
G,
at,
capsule,
gear,
hemiSphere,
starGeo,
linearize,
initScene,
setupPost,
disposeEnvironment,
stepDown,
} from "./worldScene";
import type { Mission, FxItem } from "./missions";
import type { ToyContract } from "../../../../../shared/toycontract";

declare global {
  interface Window {
    TOYVENTOR_MUSE_URL?: string;
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export interface WorldRuntimeOptions {
  contract?: ToyContract | null;
  onNotify?: () => void;
}

export interface WorldRuntimeHandle {
  setToy: (contract: ToyContract | null) => void;
  getWorld: () => string;
  dispose: () => void;
  MT?: Record<string, any>;
  Wm?: () => Mission[];
  cr?: {
    enter: () => void;
    make: (text: string) => Promise<void>;
    exit: () => void;
    R: () => any;
    CR: { busy: boolean; code: boolean };
  };
  ed?: {
    ED: any;
    enter: () => void;
    play: () => void;
    back: () => void;
    exit: () => void;
    checks: () => any[];
    scr: (x: number, y: number) => [number, number];
  };
  face?: (a: number) => void;
  start?: (build: boolean) => void;
  composer?: () => boolean;
  P?: any;
  spots?: any[];
  bolts?: THREE.Object3D[];
  ability?: (st: string) => Promise<void>;
  S?: any;
  unbolt?: (hit: any) => void;
  go?: (w: string) => void;
  /** Compose and enter a level from the level kit. Returns the seed code, or null when busy. */
  playSeed?: (code?: string, theme?: string, opts?: { tier?: 1 | 2 | 3; mood?: "day" | "dusk" | "night" }) => string | null;
  /** The toy as built right now (type, part per slot, stats), for the Garage's goal checks. */
  buildSummary?: () => BuildSummary;
  /** Open these parts to try (the Garage's loaner). Any `known` loaner not in `active`, still worn and not found, is handed back. */
  setLoanKeys?: (active: string[], known: string[]) => void;
  /** Signature of the outfit the rig was built with, once it has finished loading; null until then. */
  portraitSig?: () => string | null;
  /** A square picture of the toy as dressed now (head and shoulders, or the whole vehicle). */
  capturePortrait?: (size: number) => { toyId: string; sig: string; url: string } | null;
  worldName?: (id: string) => string;
  open?: () => void;
  close?: () => void;
  seedDemo?: () => void;
  setTier?: (t: number) => void;
  setZoom?: (z: number) => void;
  /** Stop drawing, ignore the keyboard and fade the music out while something else (the Workshop overlay) has the screen; false brings the music back to the player's own sound setting. */
  setPaused?: (paused: boolean) => void;
  mute?: () => void;
  startLearnRun?: (track: string, plan: number[], kidMode: boolean) => void;
  stopLearnRun?: () => void;
  learnState?: () => { run: { track: string; rungIndex: number; step: number; total: number; kidMode: boolean } | null; finished: number };
  mpSnap?: () => any;
  mpPress?: (i: number) => void;
  mpAct?: (a: string) => void;
  cuSnap?: () => any;
  cuAct?: (a: string) => void;
  cuType?: (t: string) => void;
  cuSlot?: (s: string) => void;
  cuPart?: (id: string) => void;
  cuZone?: (z: string) => void;
  cuPaint?: (c: string) => void;
  cuForgeTool?: (id: string) => void;
  cuPrintTool?: (id: string) => void;
  crSnap?: () => any;
  crSubmit?: (t: string) => void;
  crSetInput?: (t: string) => void;
  crUndo?: () => void;
  crKeep?: () => void;
  crPlay?: () => void;
  crCodeToggle?: () => void;
  crMicStart?: () => void;
  crFromTitle?: () => void;
  edSnap?: () => any;
  edUndo?: () => void;
  edRedo?: () => void;
  edZoomBy?: (f: number) => void;
  edExport?: () => void;
  edImport?: () => void;
  edSetName?: (v: string) => void;
  edSetTheme?: (v: string) => void;
  edNew?: (v: string) => void;
  edSetTab?: (t: string) => void;
  edArm?: (i: number) => void;
  edControl?: (i: number) => void;
  edNudge?: (d: number) => void;
  edDelete?: () => void;
  edDoneSel?: () => void;
  edSetHide?: (v: string) => void;
  edSetPart?: (v: string) => void;
  edSetIoText?: (t: string) => void;
  edIoCopy?: () => void;
  edIoLoad?: () => void;
  edLoad?: (level: unknown) => boolean;
  edIoClose?: () => void;
  edFromTitle?: () => void;
  town?: {
    neighbors: () => TownNeighbors | null;
    perk: () => VehiclePerkSpec | null;
    tidy: () => { tidied: number; total: number };
    cross: (dir: "west" | "east") => boolean;
    tidyNearest: () => boolean;
  };
}

const THREE_NS = { ...THREE, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, FXAAShader };
// Engine code below references T.* passes via THREE namespace merge (legacy shape).
const THREE_MERGED = THREE_NS;
export function createWorldRuntime(hostEl: HTMLElement, options: WorldRuntimeOptions = {}): WorldRuntimeHandle {
const T = THREE_MERGED;
const $ = (s: string): any => hostEl.querySelector(s);
const $$ = (s: string): any[] => [].slice.call(hostEl.querySelectorAll(s));
const ctrl = new AbortController();
const winOn = (type: string, fn: (e: any) => void, opts?: boolean | AddEventListenerOptions) => window.addEventListener(type, fn as EventListener, { ...(typeof opts === "boolean" ? { capture: opts } : (opts || {})), signal: ctrl.signal });
let rafId = 0;
let disposed = false;
const timeouts = new Set<ReturnType<typeof globalThis.setTimeout>>();
const intervals = new Set<ReturnType<typeof globalThis.setInterval>>();
const setTimeout = (fn: () => void, ms: number): number => { if (disposed) return 0; const id = globalThis.setTimeout(() => { timeouts.delete(id); if (!disposed) fn(); }, ms); timeouts.add(id); return id as unknown as number; };
const clearTimeout = (id?: number) => { if (id == null) return; timeouts.delete(id as unknown as ReturnType<typeof globalThis.setTimeout>); globalThis.clearTimeout(id); };
const setInterval = (fn: () => void, ms: number): number => { if (disposed) return 0; const id = globalThis.setInterval(() => { if (disposed) { intervals.delete(id); globalThis.clearInterval(id); return; } fn(); }, ms); intervals.add(id); return id as unknown as number; };
const clearInterval = (id?: number) => { if (id == null) return; intervals.delete(id as unknown as ReturnType<typeof globalThis.setInterval>); globalThis.clearInterval(id); };
const clearTimers = () => { timeouts.forEach((id) => globalThis.clearTimeout(id)); timeouts.clear(); intervals.forEach((id) => globalThis.clearInterval(id)); intervals.clear(); };
const notify = () => { try { options.onNotify && options.onNotify(); } catch {} };
hostEl.classList.add('tv-stage-canvas-host');
{ const st=document.createElement('style'); st.textContent=STAGE_CSS; hostEl.appendChild(st); }
hostEl.insertAdjacentHTML('beforeend', STAGE_HTML);


var reduce=Boolean(typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);winOn("pointerdown",function(){noteGesture()},{once:true});winOn("keydown",function(){noteGesture()},{once:true});
/* ---------- renderer, materials, post: see runtime/worldScene.ts ---------- */
var canvas=$("#c") as HTMLCanvasElement;
if(!initScene(canvas)){var ld=$("#load");if(ld)ld.textContent="This needs WebGL, which this browser has turned off.";return{setToy:function(){},getWorld:function(){return"garden"},dispose:function(){if(disposed)return;disposed=true;clearTimers();ctrl.abort();hostEl.innerHTML=""}}}

var musTimer=0;
var S: Record<string, any>={type:"character",sel:stockSel(),col:stockCol(),found:{},world:"garden"};
musTimer=setInterval(function(){var a=AC;if(!a||!MUS.on||!MUS.bus)return;if(MUS.next<a.currentTime)MUS.next=a.currentTime+.05;var wd=WORLDS[S.world],wth=(wd&&wd.theme)||S.world,sg=SONG[wth]||SONG.garden!,spb=60/sg.bpm/2,found=wd?wd.spots.filter(function(d){return S.found[d.k]}).length:0;
 while(MUS.next<a.currentTime+.25){var t0=MUS.next,st=MUS.step%16,pr=[0,5,-3,7][MUS.bar%4]??0;
  if(st===0)sg.pad.forEach(function(iv){mnote(sg.root-12+pr+iv,t0,spb*15,"sine",.026)});
  if(st%2===0){var dg=sg.scale[(st/2*2+MUS.bar)%sg.scale.length]??0;mnote(sg.root+pr+dg,t0,sg.dec,sg.wave,found>=1?.038:.02)}
  if(found>=1&&(st===0||st===8||(st===14&&MUS.bar%2)))mnote(sg.root-24+pr+(st===14?7:0),t0,spb*(st===14?1.6:3),"triangle",.07);
  if(found>=2&&(st===6||st===14))mnote(sg.root+12+pr+(sg.scale[(MUS.bar*2+st)%sg.scale.length]??0),t0,sg.dec*1.8,"sine",.034);
  if(found>=3){if(st===0||st===8||(wth==="junk"&&st===10))kick(t0);if(st===4||st===12)hit(t0,1800,.12,.07)}
  if(found>=4&&st%2===1)hit(t0,7000,.04,.03);
  if(found>=5&&st%4===2)mnote(sg.root+24+pr+(sg.scale[(MUS.bar+st)%sg.scale.length]??0),t0,.3,"triangle",.026);
  MUS.step++;if(MUS.step%16===0)MUS.bar++;MUS.next+=spb}},70);
function migrateRobotToKip(){if(!S.sel)S.sel=stockSel();if(!S.sel.character||!S.sel.character.base)S.sel.character=stockSel().character;if(!S.sel.character.prop)S.sel.character.prop="none";if(!S.sel.character.boots)S.sel.character.boots="none";if(S.type==="robot"){var r=S.sel.robot||{};if(r.head&&PART["robot.head."+r.head])S.sel.character.base="robot.head."+r.head;if(r.top&&PART["robot.top."+r.top])S.sel.character.hat="robot.top."+r.top;if(r.torso&&PART["robot.torso."+r.torso])S.sel.character.back="robot.torso."+r.torso;if(r.arms&&PART["robot.arms."+r.arms])S.sel.character.prop="robot.arms."+r.arms;if(r.legs&&PART["robot.legs."+r.legs])S.sel.character.boots="robot.legs."+r.legs;S.type="character"}}
function save(){if(S.world!=="custom"){try{localStorage.setItem("tf25",JSON.stringify(S))}catch(e){}}notify();}
(function(){try{var d=JSON.parse(localStorage.getItem("tf25")||"null");if(d&&d.sel)Object.assign(S,d)}catch(e){}})();
migrateRobotToKip();if(!S.col.skin||S.col.skin==="#f0c08a")S.col.skin="#f2b98c";function cur(): Record<string, string> {return S.sel[S.type]}
var loanKeys: Record<string, boolean>={};
function isOpen(k: string){var p=PART[k];return !p||!p.w||!!S.found[k]||!!loanKeys[k]}
function activePerk(): VehiclePerkSpec | null {return S.type==="vehicle"?vehiclePerkForToy(S.toyId,S.type):null}
function creStats(): Record<string, boolean> {var o: Record<string, boolean>={},td=TYPES[S.type];if(td)td.slots.forEach(function(s){var p=slotPartObj(S.type,s,cur()[s]||"none");if(p&&p.st&&p.st!=="none")o[p.st]=true});var pk=activePerk();if(pk)pk.innateStats.forEach(function(st){o[st]=true});return o}

var W: Record<string, any>={root:null},spots: any[]=[],bolts: THREE.Object3D[]=[],signHits: THREE.Object3D[]=[],tidySpots: Array<{ id: string; x: number; label: string; g: THREE.Group; hit: THREE.Object3D; done: boolean }>=[],streetCd=0,autoWalk=false;
function add<T extends THREE.Object3D>(o: T): T {W.root.add(o);return o}
/* "No dead props" (carousel spec 11.7): every placed prop is tappable, reacts, and says what it is. See propReactions.ts. */
var PFX=createPropFx({root:function(){return W.root},camera:function(){return camera},canvas:canvas,toast:function(s: string){toast(s)},boostWindmill:function(){W.fast=4},reduced:function(){return reduce},onBed:function(inst: {base: {px: number;pz: number}}){SLEEPH.tapBed({x:inst.base.px,z:inst.base.pz})},onTap:function(inst: any){ACTS.tap(inst)}});
/* The little things the toy can be made to do, shared by feeding and sleeping (feedingHook.ts, sleepHook.ts). */
var TOYFX={clip:function(a: "eat"|"sour"|"belly_pat"){return mixGo(a)},hop:function(h: number,d: number){fx.push({t:0,d:d,f:function(k: number){if(!P.busy)P.hop=h*Math.sin(Math.PI*k)},end:function(){if(!P.busy)P.hop=0}})},wobble:function(){fx.push({t:0,d:.6,f:function(k: number){if(!P.busy)P.spin=.3*Math.sin(k*Math.PI*6)*(1-k)},end:function(){if(!P.busy)P.spin=0}})},tone:function(f: number,dl: number,du: number,ty: OscillatorType,v: number,sl?: number){tone(f,dl,du,ty,v,sl)},spark:function(p: THREE.Vector3){burst(p)}};
/* Drag a fruit onto the toy to feed it (playful-interactions spec section 4): the gesture, appetite and toy reactions live in feedingHook.ts; this only says what the toy is and how to nudge it. */
var FEED=createFeedHook({fx:PFX,canvas:canvas,camera:function(){return camera},rayAt:function(x: number,y: number){rayAt(x,y);return ray},eater:function(){return S.type==="robot"?"robot":S.type==="vehicle"?"vehicle":"character"},toyBox:function(){return P.model&&!P.showcase?new T.Box3().setFromObject(P.root):null},carryZ:function(){return P.pos.z+1},allowed:function(){return !paused&&!P.showcase&&!P.mDrive&&!P.busy&&!ED.on},toy:TOYFX});
/* Tap the bed and the toy goes to sleep (playful-interactions spec section 6): the state machine is sleepRoutine.ts, the three.js half sleepHook.ts; this says what the toy and the room are. */
var sleepMusG=-1;
function sleepAmbient(l: number){setDusk(l);PFX.lightsOut(l>.45);if(MUS.on&&!paused){var g=(sound?.7:0)*sleepMusicGain(l);if(sleepMusG<0||Math.abs(g-sleepMusG)>.02||l===0||l===1){sleepMusG=g;musGain(g,.35)}}}
var SLEEPH=createSleepHook({root:function(){return W.root},eater:function(){return S.type==="robot"?"robot":S.type==="vehicle"?"vehicle":"character"},position:function(){return{x:P.pos.x,y:P.hop||0,z:P.pos.z}},targetX:function(){return P.target?P.target.x:null},walkTo:function(x: number,z: number){setTarget(x,z)},stopWalk:function(){P.target=null},setPosition:function(x: number,y: number,z: number){P.pos.x=x;P.pos.z=z;P.hop=y},lieDown:function(){P.face=P.tface=0;if(mix&&!reduce)mix.holdAction("sleep")},getUp:function(){if(mix&&!reduce){mix.releaseHold();mix.trigger("yawn")}},allowed:function(){return !paused&&!P.showcase&&!P.mDrive&&!P.busy&&!ED.on&&!ACTS.busy},ambient:sleepAmbient,phase:function(p: string){P.busy=p!=="awake"&&p!=="walking";if(p==="climbing"){P.target=null;P.face=P.tface=0}if(p==="awake"){P.hop=0;if(mix)mix.releaseHold()}},refuse:function(){TOYFX.wobble();TOYFX.tone(300,0,.16,"sawtooth",.05,200)}});
/* What Kip holds while it plays (book, guitar, wand) and the soap bubbles it blows (a tap pops one): heldItems.ts and bubbles.ts. */
var HELD=createHeld();
var BUBBLES=createBubbles({root:function(){return W.root},tone:function(f: number,dl: number,du: number,ty: OscillatorType,v: number,sl?: number){tone(f,dl,du,ty,v,sl)}});
/* Hug the teddy, jump on the cushions, kick the ball (playful-interactions spec section 6): the state machine is visitRoutine.ts, the acts toyRoomActs.ts; this says what the toy and the room are. */
var ACTS=createActs({root:function(){return W.root},eater:function(){return S.type==="robot"?"robot":S.type==="vehicle"?"vehicle":"character"},allowed:function(){return !paused&&!P.showcase&&!P.mDrive&&!P.busy&&!ED.on&&!SLEEPH.busy},position:function(){return{x:P.pos.x,y:P.hop||0,z:P.pos.z}},targetX:function(){return P.target?P.target.x:null},walkTo:function(x: number,z: number){setTarget(x,z)},stopWalk:function(){P.target=null},face:function(d: number){P.face=P.tface=d>0?0:Math.PI},clip:function(a: "hug"|"kick"|"cheer"|"read"|"strum"|"blow"|"pet"){return mixGo(a)},hold:function(i: "book"|"guitar"|"wand"){HELD.hold(i,P.model,P.rig&&P.rig.arms&&P.rig.arms[1])},release:function(){HELD.release()},mouth:function(d: number){var b=new T.Box3().setFromObject(P.root);return{x:d>0?b.max.x:b.min.x,y:b.min.y+(b.max.y-b.min.y)*.8,z:(b.min.z+b.max.z)/2}},bubbles:BUBBLES,setPosition:function(x: number,y: number,z: number){P.pos.x=x;P.pos.z=z;P.hop=y},tone:function(f: number,dl: number,du: number,ty: OscillatorType,v: number,sl?: number){tone(f,dl,du,ty,v,sl)},phase:function(p: string){P.busy=p==="acting";if(p==="acting")P.target=null;if(p!=="acting")P.hop=0},fx:PFX});
function cottage(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.BoxGeometry(2.4,1.6,1.8),matte("#141f55"),0,.8,0));var rf=M(new T.ConeGeometry(1.9,1.2,4),matte("#101a4a"),0,2.2,0);rf.rotation.y=Math.PI/4;g.add(rf);g.add(M(new T.BoxGeometry(.4,.4,.05),glowMat("#ffd24d",2),.4,.9,.92));var cg=glowSprite("rgba(255,210,77,0.4)",2.5);cg.position.set(.4,.9,1);g.add(cg);return add(g)}
function island(x: number,z: number,y?: number,s?: number){var g=new T.Group();g.position.set(x,y||0,z);g.scale.setScalar(s||1);g.add(M(new T.CylinderGeometry(1.6,1.6,.3,24),matte("#43c29a"),0,0,0));g.add(M(new T.ConeGeometry(1.5,1.8,8),matte("#7a6aa8",true),0,-1.05,0).rotateX(Math.PI));for(var i=0;i<5;i++){var a=i/5*6.28;g.add(M(new T.ConeGeometry(.06,.3,4),matte("#2f8a6e",true),Math.cos(a)*1.1,.3,Math.sin(a)*1.1))}return add(g)}
function drum(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.CylinderGeometry(.45,.45,1.1,20),plastic("#b0566a"),0,.55,0));[.2,.9].forEach(function(y){var r=M(new T.TorusGeometry(.46,.04,8,24),plastic("#7a3a4a"),0,y,0);r.rotation.x=Math.PI/2;g.add(r)});return add(g)}
function shed(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.BoxGeometry(4,2.4,2.6),matte("#242c5c"),0,1.2,0));g.add(M(new T.BoxGeometry(4.4,.2,3),matte("#1a2048"),0,2.5,0));g.add(M(new T.BoxGeometry(.5,.5,.05),glowMat("#ffd24d",1.8),1,1.4,1.32));return add(g)}
function cranebg(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var m=matte("#14183a");g.add(M(new T.BoxGeometry(.6,9,.6),m,0,4.5,0));g.add(M(new T.BoxGeometry(7,.4,.4),m,-2.5,9,0));var b=M(new T.SphereGeometry(.18,10,8),glowMat("#ff6a5c",2),0,9.4,0);g.add(b);W.blink=(W.blink||[]).concat([b]);return add(g)}
var bdArt: ArtCache=new Map();
function hills(cols: [string, string, string]){([ [-10,-3,-22,16],[14,-4,-26,18],[38,-3,-22,15],[60,-4,-26,18] ] as Array<[number, number, number, number]>).forEach(function(h,i){var m=M(new T.SphereGeometry(1,16,10),matte(cols[i%2]!,true),h[0],h[1],h[2]);m.scale.set(h[3],h[3]*.42,h[3]*.6);m.castShadow=false;add(m)});([ [0,-6,-44,30],[40,-6,-46,32],[80,-6,-44,30] ] as Array<[number, number, number, number]>).forEach(function(h){var m=M(new T.SphereGeometry(1,16,10),matte(cols[2],true),h[0],h[1],h[2]);m.scale.set(h[3],h[3]*.42,h[3]*.6);m.castShadow=false;add(m)})}
function points(n: number,box: [number, number, number, number, number, number],col: string,size: number){var pos=new Float32Array(n*3),base: Array<[number, number, number, number]>=[];for(var i=0;i<n;i++){var x=box[0]+Math.random()*(box[1]-box[0]),y=box[4]+Math.random()*(box[5]-box[4]),z=box[2]+Math.random()*(box[3]-box[2]);base.push([x,y,z,Math.random()*6]);pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z}var g=new T.BufferGeometry();g.setAttribute("position",new T.BufferAttribute(pos,3));var p=new T.Points(g,new T.PointsMaterial({size:size,map:glowTex(col),transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false}));p.userData.base=base;add(p);return p}
function scatter(n: number,geo: THREE.BufferGeometry,mat: THREE.Material,box: [number, number, number, number],avoid: ((x: number,z: number) => boolean) | null,yy: number,sc?: number){var im=new T.InstancedMesh(geo,mat,n),d=new T.Object3D(),k=0,tries=0;while(k<n&&tries<n*20){tries++;var x=box[0]+Math.random()*(box[1]-box[0]),z=box[2]+Math.random()*(box[3]-box[2]);if(avoid&&avoid(x,z))continue;d.position.set(x,yy,z);d.rotation.set((Math.random()-.5)*.4,Math.random()*3,(Math.random()-.5)*.4);d.scale.setScalar((sc||1)*(.7+Math.random()*.8));d.updateMatrix();im.setMatrixAt(k++,d.matrix)}im.count=k;im.receiveShadow=true;return add(im)}
function makeSpark(){var g=new T.Group();var s=M(STARGEO,glowMat("#ffd24d",1.4));s.castShadow=false;g.add(s);g.add(glowSprite("rgba(255,214,90,0.9)",1.6));return g}
/* The Toy Room bed: the hiding place for the jetpack AND the bed Kip sleeps in. Built by the hide spot, kept after the part is found, tappable (propReactions "bed"). */
function furnishBed(d: any){var g=buildBed(d.x,d.z-.9);add(g);PFX.register("bed",[g]);return g}
function darkSprite(col: string,a: number){return new T.Sprite(new T.SpriteMaterial({map:canv(128,128,function(g){var gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,col.replace("A",String(a)));gr.addColorStop(.55,col.replace("A",String(a*.92)));gr.addColorStop(1,col.replace("A","0"));g.fillStyle=gr;g.fillRect(0,0,128,128)}),transparent:true,depthWrite:false}))}
function bolt(x: number,y: number,z: number,sp: any){var g=new T.Group();g.position.set(x,y,z);sp.fn=sp.fn||0;var ft=["screw","bolt","nail"][sp.fn++%3]!,mt=metal("#d8def5"),dk=metal("#5a6aa0");g.userData.ft=ft;
 if(ft==="screw"){var b=M(new T.CylinderGeometry(.13,.13,.08,20),mt);b.rotation.x=Math.PI/2;g.add(b);g.add(M(new T.BoxGeometry(.19,.03,.06),dk,0,0,.04));g.add(M(new T.BoxGeometry(.03,.19,.06),dk,0,0,.04))}
 else if(ft==="bolt"){var hx=M(new T.CylinderGeometry(.15,.15,.12,6),metal("#c9d3f0"));hx.rotation.x=Math.PI/2;g.add(hx);var ws=M(new T.CylinderGeometry(.2,.2,.03,20),dk,0,0,-.05);ws.rotation.x=Math.PI/2;g.add(ws)}
 else{var nh=M(new T.CylinderGeometry(.1,.1,.04,16),metal("#b8c2e6"));nh.rotation.x=Math.PI/2;g.add(nh);var nsh=M(new T.CylinderGeometry(.025,.025,.5,8),metal("#9aa6cc"),0,0,-.26);nsh.rotation.x=Math.PI/2;g.add(nsh)}
var ring=glowSprite("rgba(255,210,77,0.75)",.75);g.add(ring);g.userData.ring=ring;var hit=new T.Mesh(new T.SphereGeometry(.72,8,6),new T.MeshBasicMaterial({visible:false}));hit.userData={sp:sp,g:g,ft:ft};g.add(hit);bolts.push(hit);sp.junk.add(g);return g}
function junkMachine(sp: any){var d=sp.d,j=new T.Group();j.position.set(d.x,0,d.z);sp.junk=j;add(j);var P1=function(...objs: THREE.Object3D[]){var g=new T.Group();for(var i=0;i<objs.length;i++)g.add(objs[i]!);j.add(g);return g};
 if(d.obj==="scarecrow"){P1(M(new T.CylinderGeometry(.08,.09,3,10),plastic("#6b4a5f"),0,1.5,0));P1(M(new T.BoxGeometry(2.2,.16,.16),plastic("#7a5a6f"),0,2.3,0));var sh=M(new T.CylinderGeometry(.42,.75,1.1,4),plastic("#c96a4a"),0,1.8,0);sh.rotation.y=Math.PI/4;P1(sh,M(new T.BoxGeometry(.24,.2,.05),plastic("#e8b04a"),.1,1.75,.45));var hd=new T.Group();hd.add(at(hemiSphere(.48,plastic("#9aa7e6")),0,2.82,0),M(new T.CylinderGeometry(.48,.48,.14,24),plastic("#7f8ccc"),0,2.82,0),M(new T.SphereGeometry(.06,10,8),plastic("#10163a"),-.16,3.0,.42),M(new T.SphereGeometry(.06,10,8),plastic("#10163a"),.16,3.0,.42));j.add(hd);sp.spY=3.0;bolt(-1.0,2.3,.2,sp);bolt(1.0,2.3,.2,sp);bolt(0,2.72,.5,sp)}
 if(d.obj==="kite"){P1(M(new T.CylinderGeometry(.05,.06,2.6,8),plastic("#8fa3d8"),0,1.3,0));var mk=function(pts: Array<[number, number]>,col: string){var s=new T.Shape();s.moveTo(pts[0]![0],pts[0]![1]);pts.slice(1).forEach(function(p){s.lineTo(p[0],p[1])});return M(new T.ExtrudeGeometry(s,{depth:.04,bevelEnabled:false}),plastic(col),0,3.0,0)};P1(mk([[0,.95],[.72,0],[0,-.95]],"#a78bff"),mk([[0,.95],[-.72,0],[0,-.95]],"#e8f2ff"));var tl=new T.Group();for(var i=0;i<5;i++)tl.add(M(new T.BoxGeometry(.14,.08,.04),plastic("#ff9d5c"),Math.sin(i)*.2,2.0-i*.28,.05));j.add(tl);sp.spY=3.0;bolt(-.55,3.0,.12,sp);bolt(.55,3.0,.12,sp);bolt(0,2.2,.12,sp)}
 if(d.obj==="oldbot"){var w1=wheelMesh(.35,.2),w2=wheelMesh(.35,.2);w1.position.set(-.45,.35,0);w2.position.set(.45,.35,0);P1(w1,w2);P1(M(rbox(1.3,1.0,.9,.18),plastic("#7a6a8a",{roughness:.7,clearcoat:.1}),0,1.2,0),M(rbox(.8,.34,.06,.05),plastic("#3b2f52"),0,1.3,.46),M(new T.SphereGeometry(.12,10,8),plastic("#b0566a"),.4,.9,.42));P1(M(rbox(.8,.6,.7,.14),plastic("#8a7a9a",{roughness:.7,clearcoat:.1}),0,2.0,0),M(new T.SphereGeometry(.1,10,8),glowMat("#ffd24d",.6),-.18,2.05,.36),M(new T.CylinderGeometry(.03,.03,.4,6),plastic("#3b2f52"),0,2.5,0));sp.spY=.45;bolt(-.5,1.55,.48,sp);bolt(.5,1.55,.48,sp);bolt(0,1.95,.38,sp)}
 if(d.obj&&JUNK2[d.obj])JUNK2[d.obj]!(sp,j,P1);
}
function buildCover(sp: any,_wid: string){var d=sp.d,c: any;
 if(d.cover==="bush"){sp.bushes=bushes(d.x,d.z-.6);c=darkSprite("rgba(2,6,26,A)",.97);c.position.set(d.x,1.1,d.z+.3);c.scale.set(4.6,3.4,1);add(c)}
 if(d.cover==="fog"){c=new T.Group();for(var i=0;i<6;i++){var f=darkSprite("rgba(244,249,255,A)",.92),fs=2.6+Math.random()*1.4;f.scale.set(fs,fs,1);f.position.set(d.x+(Math.random()-.5)*2.2,.5+Math.random()*1.4,d.z+.3+Math.random()*.3);c.add(f)}add(c)}
 if(d.cover==="pipe"){var pp=M(new T.CylinderGeometry(1.15,1.15,2.6,28,1,true),new T.MeshStandardMaterial({color:"#4a5fa8",roughness:.4,metalness:.5,side:T.DoubleSide}),d.x,1.2,d.z-1.0);pp.rotation.x=Math.PI/2;add(pp);var rim=M(new T.TorusGeometry(1.15,.12,10,32),metal("#8fa8ff"),d.x,1.2,d.z+.3);add(rim);c=darkSprite("rgba(2,6,26,A)",.98);c.position.set(d.x,1.2,d.z+.35);c.scale.set(2.5,2.5,1);add(c)}
 if(d.cover==="rock"){c=rockMesh(1.05,7);c.position.set(d.x,.72,d.z);add(c)}
 if(d.cover==="cloudblock"){c=cloud(d.x,d.z,.85,0)}
 if(d.cover==="crates"){c=new T.Group();c.position.set(d.x,0,d.z);([ [-.55,.5,0,.05],[.55,.5,0,-.08],[0,1.5,0,.12] ] as Array<[number, number, number, number]>).forEach(function(p){var b=crateMesh();b.position.set(p[0],p[1],p[2]);b.rotation.y=p[3];c.add(b)});add(c)}
 if(d.cover==="branch"){tree(d.x-1.6,d.z-1.9);add(M(rbox(2.8,.22,.6,.08),plastic("#8a5f76"),d.x-.2,3.25,d.z))}
 if(d.cover==="island"){island(d.x,d.z,3.0,.9)}
 if(d.cover==="crane"){var m=plastic("#4a66c8");add(M(new T.BoxGeometry(.45,4.8,.45),m,d.x+1.9,2.4,d.z-.6));add(M(new T.BoxGeometry(4.4,.3,.3),plastic("#5a76d8"),d.x+.2,4.75,d.z-.3));[-.5,.5].forEach(function(o){add(M(new T.CylinderGeometry(.02,.02,1.4,6),metal("#cfd8ff"),d.x+o,4.0,d.z))});add(M(new T.BoxGeometry(1.4,.14,.9),plastic("#9a6a42"),d.x,3.25,d.z));var bl=M(new T.SphereGeometry(.12,10,8),glowMat("#ff6a5c",2),d.x+1.9,4.95,d.z-.6);add(bl);W.blink=(W.blink||[]).concat([bl])}
 if(d.cover==="pond"){var pd=new T.Mesh(new T.CircleGeometry(2.2,40),new T.MeshPhysicalMaterial({color:0x1d4f95,roughness:.06,clearcoat:1,metalness:.15}));pd.rotation.x=-Math.PI/2;pd.position.set(d.x,.03,d.z);pd.receiveShadow=true;add(pd);var rg=M(new T.TorusGeometry(2.25,.16,8,40),matte("#5a6aa8",true),d.x,.05,d.z);rg.rotation.x=Math.PI/2;add(rg);c=new T.Group();c.position.set(d.x,.07,d.z);([ [0,0,.75],[1,.6,.55],[-1,-.4,.6],[.3,-1,.5] ] as Array<[number, number, number]>).forEach(function(p){c.add(M(new T.CylinderGeometry(p[2],p[2],.04,18),matte("#34b088"),p[0],0,p[1]))});c.add(M(new T.SphereGeometry(.14,10,8),plastic("#ff9db0"),0,.12,0));add(c);sp.spY=.1}
 if(d.cover==="windmill"){windmill(d.x,d.z,.8);sp.spY=3.12;sp.spZ=d.z+.85}
 if(d.cover==="pile"){var fan=new T.Group();fan.position.set(d.x-2.4,0,d.z);fan.add(M(new T.CylinderGeometry(.08,.1,1.1,8),plastic("#4a5ea8"),0,.55,0));var hs=M(new T.TorusGeometry(.6,.08,8,24),plastic("#3c55b8"),0,1.25,0);hs.rotation.y=Math.PI/2;fan.add(hs);var fb=new T.Group();fb.position.set(0,1.25,0);for(var q=0;q<4;q++){var bb=M(rbox(.06,.9,.22,.03),plastic("#cfd8ff"),0,0,0);bb.rotation.x=q*Math.PI/4*2;fb.add(bb)}fan.add(fb);add(fan);W.fan=fb;c=new T.Group();c.position.set(d.x,0,d.z);var cols=["#6a7ab0","#9a6a42","#b0566a","#8a7a9a"];for(var r=0;r<9;r++){var pc=M(r%3?new T.BoxGeometry(.4+Math.random()*.4,.2+Math.random()*.3,.4+Math.random()*.3):new T.CylinderGeometry(.18,.18,.5,10),plastic(cols[r%4]!,{roughness:.7,clearcoat:.1}),(Math.random()-.5)*1.6,.2+Math.random()*.6,(Math.random()-.5)*.8);pc.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);c.add(pc)}var gg=gear(.25,.08,plastic("#a78bff"));gg.position.set(.3,.9,.2);gg.rotation.x=1;c.add(gg);add(c);sp.spY=.6}
 if(d.cover&&COVER2[d.cover])c=COVER2[d.cover]!(sp,d);
 sp.cover=c||null}
function streetSignMesh(x: number,dir: "west" | "east",destName: string){
 var g=new T.Group();g.position.set(x,0,-1.45);
 var post=M(new T.CylinderGeometry(.06,.07,2.15,10),plastic("#8a5a34",{roughness:.6}),0,1.08,0);g.add(post);
 var boardTex=canv(320,96,function(ctx2,w,h){
  ctx2.fillStyle="#22337e";ctx2.beginPath();ctx2.roundRect(6,10,w-12,h-20,18);ctx2.fill();
  ctx2.lineWidth=4;ctx2.strokeStyle="#ffd24d";ctx2.stroke();
  ctx2.font="900 32px system-ui,sans-serif";ctx2.fillStyle="#f4f7ff";ctx2.textAlign="center";ctx2.textBaseline="middle";
  ctx2.fillText(dir==="west"?("← "+destName):(destName+" →"),w/2,h/2+1);
 });
 var board=new T.Mesh(new T.PlaneGeometry(1.75,.52),new T.MeshBasicMaterial({map:boardTex,transparent:true,side:T.DoubleSide}));
 board.position.set(dir==="west"?.2:-.2,1.92,.08);g.add(board);
 var gl=glowSprite("rgba(255,210,77,0.45)",1.2);gl.position.set(0,1.92,.05);g.add(gl);
 var hit=new T.Mesh(new T.BoxGeometry(1.9,2.3,.9),new T.MeshBasicMaterial({visible:false}));hit.position.set(0,1.15,0);hit.userData={signDir:dir};g.add(hit);signHits.push(hit);
 return add(g);
}
function buildTownSparkles(id: string){
 var defs=TOWN_SPARKLE_SPOTS[id as TownDistrictId];if(!defs)return;
 S.tidy=S.tidy||{};
 defs.forEach(function(d,idx){
  if(S.tidy[d.id])return;
  var g=new T.Group();g.position.set(d.x,0,.58);
  for(var i=0;i<4;i++){
   var m=i%2===0?M(rbox(.2,.14,.18,.03),plastic(d.color,{roughness:.5}),(i-1.5)*.18,.08,((i*7)%3-1)*.1):M(new T.CylinderGeometry(.08,.09,.16,10),plastic(i===1?"#ffd24d":"#5af0b0"),(i-1.5)*.17,.08,-.06);
   m.rotation.set(.2*i,.7*i+idx,.15);g.add(m);
  }
  var sp=glowSprite("rgba(90,240,176,0.75)",.85);sp.position.set(0,.36,0);g.add(sp);g.userData.spark=sp;
  var hit=new T.Mesh(new T.SphereGeometry(.75,8,6),new T.MeshBasicMaterial({visible:false}));hit.position.set(0,.25,0);g.add(hit);
  add(g);
  var entry={id:d.id,x:d.x,label:d.label,g:g,hit:hit,done:false};
  hit.userData={tidy:entry};
  tidySpots.push(entry);
 });
}
function tidyUp(ts: { id: string; x: number; label: string; g: THREE.Group; hit: THREE.Object3D; done: boolean }){
 if(ts.done)return false;ts.done=true;S.tidy=S.tidy||{};S.tidy[ts.id]=1;
 var pk=activePerk(),gain=1+(pk?pk.scrapBonus:0);
 sfx.pop();burst(new T.Vector3(ts.x,.4,.58));
 var g=ts.g;fx.push({t:0,d:.45,f:function(k){g.scale.setScalar(Math.max(.01,1-k));g.position.y=k*.45},end:function(){if(g.parent)g.parent.remove(g)}});
 var prog=townSparkleProgress(S.tidy);
 if(prog.tidied>=prog.total){scrapGain(gain,"tidied "+ts.label);confetti();sfx.found();toast("Every street in ToyVentor Town is sparkling clean!")}
 else scrapGain(gain,"tidied "+ts.label+" · Town Sparkle "+prog.tidied+"/"+prog.total);
 return true;
}
function buildWorld(id: string){
 if(W.backdrop){W.backdrop.dispose()}if(W.root){scene.remove(W.root)}W={root:new T.Group(),blades:[],blink:[]};scene.add(W.root);PFX.reset();FEED.reset();SLEEPH.reset();ACTS.reset();BUBBLES.reset();HELD.release();spots.length=0;bolts.length=0;signHits.length=0;tidySpots.length=0;sceneCarry=null;sceneVisit=null;sceneMarks=[];
 var R=WORLDS[id]!;
 scene.background=canv(4,512,function(g,w,h){var gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,R.sky[0]);gr.addColorStop(.3,R.sky[1]);gr.addColorStop(.52,R.sky[2]);gr.addColorStop(1,R.sky[2]);g.fillStyle=gr;g.fillRect(0,0,w,h)});
 applyLightRig(R,id);
 var gnd=M(new T.BoxGeometry(80,1,34),matte(R.ground),18,-.53,7);gnd.castShadow=false;add(gnd);groundPlane(R.theme||id);
 W.ground=new T.Mesh(new T.PlaneGeometry(400,60),new T.MeshBasicMaterial({visible:false}));W.ground.rotation.x=-Math.PI/2;add(W.ground);
 var bdN=W.root.children.length;if(R.hills)hills(R.hills);
 if(R.night)points(380,[-60,100,-120,-60,8,90],"rgba(255,255,255,1)",1.5);
 if(R.orb){var orb=new T.Mesh(new T.SphereGeometry(4,24,18),new T.MeshBasicMaterial({color:R.orb[3],fog:false}));orb.position.set(R.orb[0],R.orb[1],R.orb[2]);add(orb);var og=glowSprite(R.night?"rgba(220,228,255,0.5)":"rgba(255,246,200,0.7)",R.night?26:34);og.position.copy(orb.position);add(og)}
 var bd=BACKDROPS[R.theme||id];if(bd){var oldFar=W.root.children.slice(bdN);W.backdrop=createBackdrop({spec:bd,parent:W.root,maxAnisotropy:renderer.capabilities.getMaxAnisotropy(),cache:bdArt,camera:camera,onReady:function(){oldFar.forEach(function(o: THREE.Object3D){o.visible=false})},onFail:function(e){console.warn("backdrop images failed, keeping the old hills",e)}})}
 var E=R.extras;
 if(E.stones)for(var sx=-2;sx<44;sx+=1.6){var stn=M(blobGeo(.45,.12,sx+20,18,12),texMat("pebble",{bs:.02,r:.75,env:.25}),sx+Math.random()*.4,.03,.95+Math.random()*.3);stn.scale.set(1,.12,.85);add(stn)}
 var pondSpot=R.spots.filter(function(s){return s.cover==="pond"})[0];
 var avoid=function(x: number,z: number): boolean {return Boolean(Math.abs(z-1.1)<.7||(pondSpot&&Math.hypot(x-pondSpot.x,z-pondSpot.z)<2.6))};
 if(E.grass){grassBlades(1300,[-2,46,-6,4],avoid);var fl=["#ff9db0","#ffd24d","#a78bff","#ffffff"];for(var i=0;i<26;i++){var fx2=-2+Math.random()*48,fz=-6+Math.random()*10;if(avoid(fx2,fz))continue;var f=new T.Group();f.position.set(fx2,0,fz);f.add(M(new T.CylinderGeometry(.015,.015,.3,5),matte("#2f8a6e"),0,.15,0));f.add(M(new T.SphereGeometry(.07,8,6),plastic(fl[i%4]!),0,.32,0));add(f)}}
 if(E.gravel)scatter(260,new T.DodecahedronGeometry(.07,0),matte(E.gravel,true),[-2,46,-6,4],avoid,.03);
 if(E.puddles)([ [9,1.8,1.4],[25,2.4,1.8],[39,1.6,1.2] ] as Array<[number, number, number]>).forEach(function(p){var pu=new T.Mesh(new T.CircleGeometry(p[2],30),new T.MeshPhysicalMaterial({color:0x1e1b42,roughness:.04,clearcoat:1,metalness:.85,envMapIntensity:1.4,transparent:true,opacity:.85}));pu.rotation.x=-Math.PI/2;pu.position.set(p[0],.02,p[1]);pu.scale.set(1.4,1,1);add(pu)});
 if(E.cloudFloor){for(var cx=-6;cx<50;cx+=4.4){cloud(cx,-3.6,.9,-.4);cloud(cx+2.2,7.2,1.0,-1.8)}}extras2(E);
 if(E.fireflies)W.ff=points(R.night?30:26,[0,44,-5,2,.6,3.4],E.fireflies,R.night?.45:.35);
 var treeN=0,palmN=0,bushN=0;var propBuilders: Record<string, (x: number, z: number, y?: any) => any>={lantern:lantern,windmill:function(x,z){windmill(x,z,1)},cottage:cottage,tree:function(x,z){return tree(x,z,x<3?undefined:orchardKind(R.theme||id,treeN++))},bushes:function(x,z){return bushes(x,z,bushKind(R.theme||id,bushN++))},cloud:function(x,z){cloud(x,z,1.5,6+Math.random()*3)},island:function(x,z,y){island(x,z,y,1.1)},tire:tire,drum:drum,shed:shed,cranebg:cranebg,palm:function(x,z){return palm(x,z,x<3?undefined:palmKind(R.theme||id,palmN++))},umbrella:umbrella,sandcastle:sandcastle,pine:pine,snowman:snowman,igloo:igloo,lamp:roomLamp,blocks:toyBlocks,books:bookStack,chair:kidChair,plant:potPlant,teddy:teddyBear,ball:playBall,cushions:cushionPile,bed:function(x,z){return add(buildBed(x,z))},guitar:function(x,z){return add(buildGuitarProp(x,z))},bubbles:function(x,z){return add(buildBubbleBottle(x,z))},dog:function(x,z){return add(buildDog(x,z))}};
 R.props.forEach(function(p){var f=propBuilders[p[0]];if(!f)return;var n0=W.root.children.length;f(p[1],p[2],p[3]);PFX.register(p[0],W.root.children.slice(n0),p[3])});
 R.spots.forEach(function(d,i){var sp: any={d:d,i:i,got:!!S.found[d.k],hidden:d.t!=="speed",spark:makeSpark(),cover:null,bolts:0};spots.push(sp);if(sp.got){if(d.cover==="bed")furnishBed(d);return}
  if(d.t==="junk")junkMachine(sp);else buildCover(sp,R.theme||id);
  var y=sp.spY!=null?sp.spY:(d.y||.8);sp.spark.position.set(d.x,y,sp.spZ!=null?sp.spZ:d.z);sp.spark.visible=!sp.hidden;add(sp.spark);if(sp.hidden){var gl=glowSprite("rgba(255,240,180,0.9)",.9);gl.position.set(d.x,d.t==="junk"?3.8:d.cover==="pipe"?2.7:d.cover==="windmill"?4.2:2.3,d.z);add(gl);sp.glint=gl}});
 buildMissions(R);
 var nb=(typeof ED==="undefined"||!ED.on)?townNeighbors(id):null;
 if(nb){streetSignMesh(.85,"west",WORLDS[nb.west]!.n);streetSignMesh(43.85,"east",WORLDS[nb.east]!.n);buildTownSparkles(id)}
 linearize(scene);
}
/* ---------- player ---------- */
/* Mixamo locomotion + gestures for the Character rig. The bank bakes lazily on the first Character frame; until then (or if it fails) the procedural walk runs. */
/** World units of width the portrait camera keeps in view (was 7: Kip filled about 18% of a phone's height; 5.2 is about a quarter). */
const VIEW_W=5.2,DANCE_PUSH=.8;
var mix: MixamoDriver|null=null,mixLoading=false;
function mixGo(a: MixAction){return !!(mix&&!reduce&&P.rig&&mix.canDrive(P.rig)&&mix.trigger(a))}
var P: Record<string, any>={pos:new T.Vector3(2,0,0),face:0,tface:0,speed:0,phase:0,busy:false,target:null,spin:0,lunge:0,hop:0,root:new T.Group(),model:null,rig:null,blinkT:2,dropT:1,showcase:false};
scene.add(P.root);
function buildPlayer(drop: string | null){if(P.stlToken)P.stlToken.cancelled=true;if(P.model)P.root.remove(P.model);P.rig=buildToy(S.type,cur() as any,S.col);P.model=new T.Group();P.model.add(P.rig.g);P.root.add(P.model);P.dropSlot=null;
 if(drop&&!reduce&&P.rig.slots[drop]){var g=P.rig.slots[drop];g.userData.y0=g.position.y;P.dropSlot=g;P.dropT=0}linearize(P.root);
 var tok={cancelled:false};P.stlToken=tok;
 // The portrait is keyed to the outfit the rig was built with, and only taken once its STL parts have loaded.
 P.rigReady=false;P.rigSig=toyPortraitSignature({toyId:S.toyId||null,type:S.type,sel:cur(),col:S.col});
 var rigDone=function(){if(!tok.cancelled)P.rigReady=true};
 upgradeRigWithStl(P.rig,{type:S.type,sel:Object.assign({},cur()) as any,col:Object.assign({},S.col),toyId:S.toyId||null,token:tok}).then(rigDone,rigDone)}

/* The Garage reads the toy as it is built right now (which part is worn in each slot, and the stats those parts give) to check a mission. */
function buildSummary(): BuildSummary{
 var stats: StatId[]=[],cs=creStats();
 Object.keys(cs).forEach(function(k){if(cs[k]&&(k==="speed"||k==="spin"||k==="glow"||k==="torque"))stats.push(k as StatId)});
 return {type:String(S.type),sel:Object.assign({},cur()),stats:stats}}
/* A weekend's loaner part is open to try, and goes back when the weekend ends (unless the child has since found it). `known` lists every
   loaner the Garage has ever offered, so one still worn from an earlier session is handed back too. */
function setLoanKeys(active: string[],known: string[]){
 var next: Record<string,boolean>={},back=false;
 active.forEach(function(k){if(PART[k])next[k]=true});
 known.forEach(function(k){
  if(next[k]||S.found[k]||!PART[k])return;
  var parts=k.split("."),type=parts[0]!,slot=parts[1]!,id=parts.slice(2).join("."),sel=S.sel&&S.sel[type];
  if(sel&&(sel[slot]===id||sel[slot]===k)){var stock=(stockSel() as any)[type];sel[slot]=stock&&stock[slot]?stock[slot]:"none";back=true}});
 loanKeys=next;
 if(back){save();buildPlayer(null);if(typeof renderSheet==="function")renderSheet()}}

/* A small studio portrait of the toy as it is dressed now, for the trail map's character token. Rendered once from the live rig
   (head and shoulders for a character or robot, the whole thing for a vehicle) with its own neutral light and a plain backdrop, so
   it looks the same in a night world as a day one. Everything it borrows (visibility, lights, background, viewport) is put back,
   and the pixels are copied out in the same task, so the stage never shows it and the next frame repaints the whole canvas. */
var PORTRAIT_BG="#d8ebff";
function toyPortrait(size: number): {toyId: string;sig: string;url: string}|null{
 if(disposed||!P.rig||!P.rigReady||!P.rigSig||P.showcase||ED.on)return null;
 var g: any=P.rig.g;
 for(var up: any=g;up;up=up.parent)if(!up.visible)return null;
 g.updateWorldMatrix(true,true);
 // Frame the solid body only. A plain bounding box of the whole rig also counts glow sprites and soft effects, which pulse,
 // so the framing would change from one capture to the next.
 var box=new T.Box3(),tmpBox=new T.Box3();
 g.traverse(function(o: any){
  if(!o.isMesh||!o.visible||!o.geometry)return;
  var m=Array.isArray(o.material)?o.material[0]:o.material;
  if(m&&(m.depthWrite===false||m.visible===false))return;
  if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
  if(o.geometry.boundingBox)box.union(tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld))});
 if(box.isEmpty())return null;
 var sz=box.getSize(new T.Vector3()),ctr=box.getCenter(new T.Vector3());
 var upper=S.type!=="vehicle",span=upper?sz.y*0.5:Math.max(sz.x,sz.y,sz.z);
 var target=new T.Vector3(ctr.x,upper?box.max.y-span*0.5:ctr.y,ctr.z);
 var q=new T.Quaternion();g.getWorldQuaternion(q);
 var toCam=new T.Vector3(1,0.14,0.34).normalize().applyQuaternion(q);
 var fov=30,dist=(span*1.08)/(2*Math.tan(T.MathUtils.degToRad(fov/2)));
 var cam=new T.PerspectiveCamera(fov,1,0.05,400);
 cam.position.copy(target).addScaledVector(toCam,dist);cam.lookAt(target);cam.updateMatrixWorld();
 var cssSize=renderer.getSize(new T.Vector2()),pr=renderer.getPixelRatio(),side=Math.floor(Math.min(cssSize.x,cssSize.y,320));
 if(side<64)return null;
 var mine=new Set<unknown>();g.traverse(function(n: any){mine.add(n)});
 var hidden: any[]=[];
 scene.traverse(function(n: any){if(!n.visible||mine.has(n))return;if(n.isMesh||n.isSprite||n.isPoints||n.isLine||n.isLight){n.visible=false;hidden.push(n)}});
 var key=new T.DirectionalLight(0xffffff,2.6),fill=new T.HemisphereLight(0xffffff,0xbcd0ff,1.4);
 key.position.copy(target).add(new T.Vector3(3,2.2,1.4).applyQuaternion(q).multiplyScalar(span));key.target.position.copy(target);
 var sc: any=scene,bg=sc.background,fog=sc.fog,envI=sc.environmentIntensity;
 var vp=new T.Vector4(),scis=new T.Vector4();renderer.getViewport(vp);renderer.getScissor(scis);var scisOn=renderer.getScissorTest();
 var url="";
 try{
  scene.add(key,key.target,fill);sc.background=new T.Color(PORTRAIT_BG);sc.fog=null;sc.environmentIntensity=1;
  renderer.setViewport(0,0,side,side);renderer.setScissor(0,0,side,side);renderer.setScissorTest(true);
  renderer.render(scene,cam);
  var src=renderer.domElement,px=Math.round(side*pr),out=document.createElement("canvas");out.width=out.height=size;
  var c2=out.getContext("2d");
  if(c2){c2.drawImage(src,0,src.height-px,px,px,0,0,size,size);url=out.toDataURL("image/png")}
 }finally{
  scene.remove(key,key.target,fill);sc.background=bg;sc.fog=fog;sc.environmentIntensity=envI;
  hidden.forEach(function(n){n.visible=true});
  renderer.setViewport(vp);renderer.setScissor(scis);renderer.setScissorTest(scisOn);
 }
 return url.indexOf("data:image/png")===0?{toyId:String(S.toyId||""),sig:String(P.rigSig),url:url}:null}
/* ---------- effects ---------- */
var fx: FxItem[]=[];
function tween(d: number,f: (k: number, dt: number) => void): Promise<void> {return new Promise<void>(function(res){fx.push({t:0,d:d,f:f,end:res})})}
function sleep(ms: number): Promise<void> {return new Promise<void>(function(r){setTimeout(r,ms)})}
function ringFx(pos: THREE.Vector3,col: number | string,maxR: number,dur: number,y?: number){var m=new T.Mesh(new T.TorusGeometry(1,.06,8,48),new T.MeshBasicMaterial({color:col,transparent:true,opacity:.9,depthWrite:false}));m.rotation.x=Math.PI/2;m.position.set(pos.x,y==null?.3:y,pos.z);linearize(m);scene.add(m);fx.push({t:0,d:dur,f:function(k){m.scale.setScalar(.2+maxR*k);m.material.opacity=.9*(1-k)},end:function(){scene.remove(m)}})}
var trailN=0;function trail(){if(reduce||(trailN++%2))return;var s=glowSprite("rgba(155,212,255,0.8)",.6);s.position.set(P.pos.x,P.hop+.5,P.pos.z);scene.add(s);fx.push({t:0,d:.5,f:function(k){s.material.opacity=.8*(1-k)},end:function(){scene.remove(s)}})}
var DUST: THREE.Texture | null=null;function puff(){if(reduce)return;if(!DUST)DUST=glowTex("rgba(225,232,255,0.55)");var s=new T.Sprite(new T.SpriteMaterial({map:DUST,transparent:true,depthWrite:false}));s.position.set(P.pos.x-Math.cos(P.face)*.7,.18,P.pos.z+(Math.random()-.5)*.8);s.scale.setScalar(.35);scene.add(s);fx.push({t:0,d:.6,f:function(k){s.scale.setScalar(.35+k*.8);s.position.y=.18+k*.3;s.material.opacity=.7*(1-k)},end:function(){scene.remove(s)}})}
function fwd(){return new T.Vector3(Math.cos(P.face),0,-Math.sin(P.face))}
/* ---------- UI helpers ---------- */
function icon(st: string,s?: number){s=s||30;var c=(STATS[st]||LOOK).c,o='<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" aria-hidden="true">';if(st==="speed")o+='<path d="M13 2 L5 14 H11 L10 22 L19 9 H13Z" fill="'+c+'"/>';if(st==="spin")o+='<path d="M20 12a8 8 0 1 1-3-6.2" fill="none" stroke="'+c+'" stroke-width="3" stroke-linecap="round"/><path d="M20 3v6h-6" fill="none" stroke="'+c+'" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';if(st==="glow")o+='<circle cx="12" cy="10" r="6" fill="'+c+'"/><rect x="10" y="16" width="4" height="6" rx="1" fill="'+c+'"/>';if(st==="torque"){for(var i=0;i<8;i++)o+='<rect x="10.3" y="1.5" width="3.4" height="5" rx="1" fill="'+c+'" transform="rotate('+(i*45)+' 12 12)"/>';o+='<circle cx="12" cy="12" r="6.5" fill="'+c+'"/><circle cx="12" cy="12" r="2.4" fill="#10062b"/>'}return o+"</svg>"}
var BOLTI='<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#d8def5" stroke="#5a6aa0" stroke-width="2"/><path d="M7.5 12 H16.5" stroke="#5a6aa0" stroke-width="2.6" stroke-linecap="round"/></svg>';
var toastH=0,showCardH=0,hintH=0;
function toast(t: string){notify();var e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toastH);toastH=setTimeout(function(){e.classList.remove("on")},2800)}
/** Scene prompt twin (carousel §11.1 `tell`): toast pill + speech. Muted play still gets the toast. */
function sayT(t: string){toast(t);say(t)}
function moves(){var st=creStats();$$(".mv").forEach(function(b){b.classList.toggle("off",!st[b.getAttribute("data-k")])})}
function updHud(){}

/* ---------- abilities ---------- */
async function ability(st: string){if(P.busy||P.showcase)return;var sd=STATS[st];if(!sd||!creStats()[st]){if(sd)toast("Build with a part that has "+sd.n+" to use "+sd.m+".");if(S.type==="character")mixGo("sad");sfx.bump();return}
 var best: any=null,bd=1e9;spots.forEach(function(s){if(s.got||s.d.t!==st)return;if(s.d.t!=="speed"&&!s.hidden)return;var d=Math.abs(s.d.x-P.pos.x);if(d<bd){bd=d;best=s}});
 var abRange: Record<string, number>={glow:4.5,torque:3.2,speed:6.5,spin:3.6},abStand: Record<string, number>={glow:2,torque:1.8,speed:4,spin:1.6};
 if(best&&bd<=12){var dir=best.d.x>=P.pos.x?1:-1,range=abRange[st]??4;P.tface=dir>0?0:Math.PI;
  if(bd>range){var stand=best.d.x-dir*(abStand[st]??2);setTarget(stand);var tgt=P.target;
   var ok=await new Promise<boolean>(function(res){var lastX=P.pos.x,lastF=FR,still=0,iv=setInterval(function(){if(P.target!==tgt){clearInterval(iv);res(P.target===null);return}if(FR===lastF)return;lastF=FR;if(Math.abs(P.pos.x-lastX)<.004){if(++still>45){clearInterval(iv);res(true)}}else{still=0;lastX=P.pos.x}},30)});if(!ok||Math.abs(best.d.x-P.pos.x)>range+.8)return}
  P.face=P.tface}
 P.busy=true;P.target=null;try{if(ABIL[st])await ABIL[st]!()}catch(e){console.error(e)}P.busy=false}
function near(sp: any,r: number){return Math.abs(sp.d.x-P.pos.x)<r&&Math.abs(P.pos.z-((sp.d as any).z||0))<2}
function reveal(sp: any){if(!sp.hidden||sp.got)return;sp.hidden=false;if(sp.glint){W.root.remove(sp.glint);sp.glint=null}var c=sp.cover,d=sp.d;
 if(d.cover==="bush"||d.cover==="pipe"||sp.fade){var s0=c.scale.clone();fx.push({t:0,d:.9,f:function(k){c.material.opacity=1-k;c.scale.set(s0.x*(1+k*.5),s0.y*(1+k*.5),1)},end:function(){W.root.remove(c)}});if(sp.bushes){sp.bushes.children.forEach(function(m: any){m.material=glowMat("#2fb3a6",.35)});linearize(sp.bushes)}}
 if(d.cover==="fog"){fx.push({t:0,d:1,f:function(k){c.children.forEach(function(f: any){f.material.opacity=.95*(1-k);f.position.y+=.01})},end:function(){W.root.remove(c)}})}
 if(d.t==="torque"){var x0=c.position.x,dir=Math.sign(Math.cos(P.face))||1;fx.push({t:0,d:1.1,f:function(k){var e=1-Math.pow(1-k,3);c.position.x=x0+dir*3.4*e;c.rotation.z-=.08*(1-k)*dir}})}
 if(d.cover==="pond"){fx.push({t:0,d:1.2,f:function(){c.children.forEach(function(m: any){var a=Math.atan2(m.position.z,m.position.x)+.05,r=Math.hypot(m.position.x,m.position.z)+.03;m.position.x=Math.cos(a)*r;m.position.z=Math.sin(a)*r})}});var y0=sp.spark.position.y;fx.push({t:0,d:1,f:function(k){sp.spark.position.y=y0+k*.9}})}
 if(d.cover==="windmill"){var y1=sp.spark.position.y;W.fast=3;fx.push({t:0,d:1,f:function(k){sp.spark.position.y=y1-(y1-.9)*k*k}})}
 if(d.cover==="pile"||sp.fly){c.children.forEach(function(m: any){var v=new T.Vector3(3+Math.random()*3,1+Math.random()*2,(Math.random()-.5)*2);fx.push({t:0,d:1.1,f:function(k,dt){m.position.addScaledVector(v,dt);v.y-=5*dt;m.rotation.x+=dt*5;m.scale.setScalar(Math.max(.01,1-k))}})})}
 P.shake=Math.max(P.shake||0,.08);sp.spark.visible=true;sp.spark.scale.setScalar(.1);fx.push({t:0,d:.5,f:function(k){sp.spark.scale.setScalar(.1+.9*k)}});
 setTimeout(function(){collect(sp)},950)}
function collect(sp: any){if(sp.got)return;sp.got=true;S.found[sp.d.k]=true;var pk=activePerk();S.scrap=(S.scrap||0)+1+(pk?pk.scrapBonus:0);save();sfx.found();if(sp.glint){W.root.remove(sp.glint);sp.glint=null}burst(sp.spark.position.clone());var s=sp.spark,y0=s.position.y;fx.push({t:0,d:.7,f:function(k){s.position.y=y0+k*1.5;s.scale.setScalar(1+k);s.rotation.y+=.3},end:function(){s.visible=false}});
 showCard(sp.d.k,sp.d.t==="junk");P.joyPending=true;
 var wn=WN[S.world]||WORLDS[S.world]?.n||S.world;if(spots.every(function(x){return x.got}))setTimeout(function(){if((WN[S.world]||WORLDS[S.world]?.n||S.world)===wn){confetti();sfx.found();toast("You found every part in "+wn+"!")}},2600)}
function showCard(k: string,junk: boolean){var p=PART[k]!,c=$("#pcard"),tLabel=p.t==="robot"?"Kip Wardrobe":(TYPES[p.t]?.n||p.t);$("#pc-ic").innerHTML=icon(p.st,30);$("#pc-n").textContent=(junk?"Took it apart: ":"New part: ")+p.n;$("#pc-m").textContent=tLabel+" part · "+p.l+" · "+(STATS[p.st]||LOOK).n+" gives "+(STATS[p.st]||LOOK).m;c.dataset.k=k;c.hidden=false;c.classList.remove("on");void c.offsetWidth;c.classList.add("on");clearTimeout(showCardH);showCardH=setTimeout(function(){c.hidden=true},6500)}
function confetti(){if(reduce)return;var cols=["rgba(255,90,77,1)","rgba(255,210,77,1)","rgba(90,240,176,1)","rgba(82,183,255,1)","rgba(167,139,255,1)"];for(var i=0;i<46;i++){(function(idx: number){var s=glowSprite(cols[idx%5]!,.45);s.position.set(P.pos.x,2,P.pos.z);scene.add(s);var v=new T.Vector3((Math.random()-.5)*8,4+Math.random()*5,(Math.random()-.5)*3);fx.push({t:0,d:1.8,f:function(k,dt){s.position.addScaledVector(v,dt);v.y-=7*dt;s.material.opacity=1-k*k},end:function(){scene.remove(s)}})})(i)}}
function idleAct(){var r=P.rig,c=Math.floor(Math.random()*4);
 if((c===1||c===3)&&S.type==="character"&&mixGo(c===1?"no":"nod"))return;
 if(c===0)fx.push({t:0,d:.55,f:function(k){if(!P.busy)P.hop=(S.type==="vehicle"?.12:.38)*Math.sin(Math.PI*k)},end:function(){if(!P.busy)P.hop=0}});
 else if(c===1){if(S.type==="vehicle"){tone(300,0,.12,"square",.05);tone(380,.15,.14,"square",.05);fx.push({t:0,d:.6,f:function(k){r.g.rotation.x=Math.sin(k*Math.PI*6)*.06*(1-k)},end:function(){r.g.rotation.x=0}})}else fx.push({t:0,d:1.6,f:function(k){if(r.head)r.head.rotation.y=Math.sin(k*Math.PI*2)*.7},end:function(){if(r.head)r.head.rotation.y=0}})}
 else if(c===2){tone(500,0,.3,"sine",.05,900);fx.push({t:0,d:.8,f:function(k){if(!P.busy)P.spin=Math.PI*2*(1-Math.pow(1-k,3))},end:function(){if(!P.busy)P.spin=0}})}
 else{if(S.type==="character"&&r.arms[0]&&!r.wings.length){var a0=r.arms[0];fx.push({t:0,d:1.1,f:function(k){a0.rotation.x=-.35-Math.sin(Math.PI*k)*2.1;a0.rotation.z=Math.sin(k*Math.PI*6)*.3*Math.sin(Math.PI*k)},end:function(){a0.rotation.x=-.35}})}else fx.push({t:0,d:.4,f:function(k){if(!P.busy)P.hop=.25*Math.sin(Math.PI*k)},end:function(){if(!P.busy)P.hop=0}})}}
function joy(){P.happy=1.4;var dancing=mixGo("dance");if(dancing&&P.danceBack==null){P.danceBack=P.tface;P.tface=-Math.PI/2}[523,659,784,1047].forEach(function(f,i){tone(f,i*.07,.22,"triangle",.07)});burst(new T.Vector3(P.pos.x,1.6,P.pos.z));if(dancing)return;fx.push({t:0,d:.75,f:function(k){if(!P.busy){P.hop=.6*Math.sin(Math.PI*k);P.spin=Math.PI*2*k}},end:function(){if(!P.busy){P.hop=0;P.spin=0;squash()}}})}
function squash(){P.squashing=true;fx.push({t:0,d:.35,f:function(k){var q=1-.22*Math.sin(Math.PI*k);P.model.scale.set(1+(1-q)*.5,q,1+(1-q)*.5)},end:function(){P.model.scale.set(1,1,1);P.squashing=false}})}
var ABIL: Record<string, () => Promise<void>>={
 glow:async function(){sfx.glow();var pl=new T.PointLight(0x7ff5cf,0,12,2);pl.position.set(P.pos.x,1.5,P.pos.z+.5);scene.add(pl);ringFx(P.pos,0x5af0b0,6,1.0,.4);tween(1.1,function(k){pl.intensity=6*Math.sin(Math.PI*k)}).then(function(){scene.remove(pl)});await sleep(300);spots.forEach(function(s){if(s.d.t==="glow"&&near(s,6))reveal(s)});await sleep(700)},
 torque:async function(){sfx.shove();P.shake=.2;await tween(.15,function(k){P.lunge=.7*k});var f=fwd();ringFx(P.pos.clone().addScaledVector(f,1.2),0xa78bff,2.5,.5,.6);spots.forEach(function(s){var dx=(s.d.x-P.pos.x)*Math.sign(f.x||1);if(s.d.t==="torque"&&dx>-.5&&dx<4.4)reveal(s)});await tween(.3,function(k){P.lunge=.7*(1-k)})},
 speed:async function(){if(!reduce)await tween(.12,function(k){P.model.scale.set(1+.1*k,1-.16*k,1+.1*k)});P.model.scale.set(1,1,1);P.kick=1;sfx.zoom();var f=fwd(),led: any=null;spots.forEach(function(s){if(s.d.t!=="speed"||s.got)return;var dx=(s.d.x-P.pos.x)*Math.sign(f.x||1);if((dx>-.5&&dx<8)||Math.abs(s.d.x-P.pos.x)<2)led=s});
  if(led){var a=P.pos.clone(),b=new T.Vector3(led.d.x,0,0);P.face=P.tface=b.x>=a.x?0:Math.PI;var top=(led.d.y||3.7)-.45;await tween(.75,function(k){P.pos.lerpVectors(a,b,k);P.hop=top*k+2.2*Math.sin(Math.PI*k);trail()});P.hop=top;collect(led);await sleep(450);await tween(.5,function(k){P.hop=top*(1-k*k)});P.hop=0;squash();P.shake=.1;return}
  var a2=P.pos.clone(),b2=a2.clone().addScaledVector(f,5);b2.x=Math.max(.5,Math.min(43,b2.x));await tween(.38,function(k){P.pos.lerpVectors(a2,b2,1-Math.pow(1-k,3));trail()})},
 spin:async function(){sfx.whirl();ringFx(P.pos,0xffd24d,4.5,.9,.3);W.fast=Math.max(W.fast||1,2);await tween(.8,function(k){P.spin=Math.PI*4*(1-Math.pow(1-k,2))});P.spin=0;spots.forEach(function(s){if(s.d.t==="spin"&&near(s,4.8))reveal(s)});await sleep(500)}
};
/* ---------- junk machines: unscrew 3 bolts ---------- */
function unbolt(hit: THREE.Object3D){var sp=hit.userData.sp,g=hit.userData.g;if(!sp||sp.got||g.userData.out||P.busy||P.showcase)return;
 var pk=activePerk(),uRange=pk?pk.unboltRange:4.2;
 if(Math.abs(P.pos.x-sp.d.x)>uRange){P.target=new T.Vector3(Math.max(.5,sp.d.x-1.8),0,0);hint(sp,true);return}
 var ft: string=hit.userData.ft||"screw";if(S.tool!==FITS[ft]){toolHint(ft);return}toolAnim(g,S.tool);
  g.userData.out=true;var i=bolts.indexOf(hit);if(i>=0)bolts.splice(i,1);scrapGain(1+(pk?pk.scrapBonus:0),"a bolt");var z0=g.position.z;fx.push({t:0,d:.6,f:function(k){g.rotation.z=k*14;g.position.z=z0+k*1.4;g.scale.setScalar(Math.max(.01,1-k*k))}});
 sp.bolts++;if(sp.bolts>=3)setTimeout(function(){breakJunk(sp)},450)}
function unboltNext(sp: any){var h=bolts.filter(function(b){return b.userData.sp===sp})[0];if(h)unbolt(h)}
function breakJunk(sp: any){if(sp.broken)return;sp.broken=true;sfx.crash();P.shake=.24;sp.junk.children.forEach(function(p: any){var v=new T.Vector3((Math.random()-.5)*5,2+Math.random()*2.5,1+Math.random()*1.5),av=(Math.random()-.5)*8;fx.push({t:0,d:1.2,f:function(k,dt){p.position.addScaledVector(v,dt);v.y-=7*dt;p.rotation.z+=av*dt;p.rotation.x+=av*.5*dt;if(k>.6)p.scale.setScalar(Math.max(.01,(1-k)/.4))}})});burst(new T.Vector3(sp.d.x,1.6,sp.d.z));setTimeout(function(){reveal(sp)},350)}
/* ---------- hints ---------- */
var hintAt: Record<string, number>={},hintSpot: any=null,v3=new T.Vector3();
function hint(sp: any,closer?: boolean){P.notice=1;var b=$("#bub"),st: string=sp.d.t;if(st==="junk"){b.innerHTML=BOLTI+"<span>"+(closer?"Come closer, then tap the bolts":"Unscrew 3 bolts")+"</span>";$$(".mv").forEach(function(m){m.classList.remove("hint")})}else{var have=!!creStats()[st],sd=STATS[st]||LOOK;b.innerHTML=icon(st,20)+"<span>"+(have?"Try "+sd.m:"Needs "+sd.n)+"</span>";$$(".mv").forEach(function(m){m.classList.toggle("hint",!!(have&&m.getAttribute("data-k")===st))})}
 b.classList.add("on");hintSpot=sp;clearTimeout(hintH);hintH=setTimeout(function(){b.classList.remove("on");hintSpot=null;$$(".mv").forEach(function(m){m.classList.remove("hint")})},2600)}
function placeHint(){if(!hintSpot)return;var y=hintSpot.d.t==="junk"?3.6:(hintSpot.d.y||1)+1.5;v3.set(hintSpot.d.x,y,hintSpot.d.z).project(camera);var r=canvas.getBoundingClientRect(),b=$("#bub");b.style.left=(r.left+(v3.x+1)/2*r.width)+"px";b.style.top=(r.top+(1-v3.y)/2*r.height)+"px"}
/* ---------- builder sheet ---------- */
var B: { slot: string | null; z: string; forge?: boolean }={slot:null,z:"c1"},FX=-80,FAC: THREE.Group | null=null,facA=0,mUpdateCur: Mission | null=null;
function buildFactory(){var g=new T.Group();g.position.set(FX,0,0);
 g.add(M(new T.BoxGeometry(18,.4,12),matte("#1a2460"),0,-.2,0));g.add(M(new T.BoxGeometry(20,11,.4),matte("#14206a"),0,5.3,-4.2));
 [-4.2,4.2].forEach(function(x){g.add(M(new T.BoxGeometry(4.4,2.8,.1),glowMat("#23307e",.6),x,5.4,-3.95));g.add(M(new T.BoxGeometry(4.6,.18,.2),plastic("#4a66c8"),x,6.85,-3.9));g.add(M(new T.BoxGeometry(4.6,.18,.2),plastic("#4a66c8"),x,3.95,-3.9));g.add(M(new T.BoxGeometry(.14,2.8,.2),plastic("#4a66c8"),x,5.4,-3.9));for(var i=0;i<7;i++)g.add(M(new T.SphereGeometry(.04,6,4),glowMat("#ffffff",2),x-1.9+Math.random()*3.8,4.3+Math.random()*2,-3.88))});
 var pipe=M(new T.CylinderGeometry(.25,.25,20,16),metal("#7f9bff"),0,7.7,-3.7);pipe.rotation.z=Math.PI/2;g.add(pipe);
 var tt=new T.Group();tt.add(M(new T.CylinderGeometry(2.1,2.25,.32,40),plastic("#22337e"),0,.16,0));tt.add(M(new T.CylinderGeometry(1.95,1.95,.04,40),plastic("#3350b8"),0,.34,0));for(var j=0;j<16;j++){var a=j/16*Math.PI*2;tt.add(M(new T.SphereGeometry(.05,8,6),glowMat("#9bd4ff",2.2),Math.cos(a)*2.05,.3,Math.sin(a)*2.05))}g.add(tt);g.userData.tt=tt;
 var gw=glowSprite("rgba(82,183,255,0.35)",6);gw.position.set(0,.3,0);g.add(gw);
 [-3.2,0,3.2].forEach(function(x,i){var lp=new T.Group();lp.position.set(x,6.4,-1);lp.add(M(new T.CylinderGeometry(.02,.02,2,6),metal("#4a66c8"),0,1,0));lp.add(M(new T.ConeGeometry(.45,.4,16,1,true),new T.MeshStandardMaterial({color:"#3c55b8",side:T.DoubleSide}),0,-.1,0));lp.add(M(new T.SphereGeometry(.14,10,8),glowMat("#fff5c2",2.5),0,-.25,0));var pl=new T.PointLight(i===1?0xfff0d0:0xc9d6ff,i===1?1.7:.8,15,2);pl.position.set(0,-.4,0);lp.add(pl);g.add(lp)});
 var g1=gear(.9,.2,plastic("#2c3f94"),12);g1.position.set(-6.4,2.3,-3.6);g1.rotation.x=Math.PI/2;g.add(g1);var g2=gear(.6,.2,plastic("#3c55b8"),8);g2.position.set(-5.09,3.03,-3.6);g2.rotation.x=Math.PI/2;g2.rotation.y=Math.PI/8;g.add(g2);g.userData.gears=[g1,g2];
 g.add(M(new T.BoxGeometry(18,.3,1.2),plastic("#0f1a4a"),0,.15,-2.5));for(var r=-8;r<=8;r++){var rl=M(new T.CylinderGeometry(.16,.16,1.3,10),metal("#9bb0ff"),r,.32,-2.5);rl.rotation.x=Math.PI/2;g.add(rl)}
 linearize(g);scene.add(g);FAC=g}
function flash(){var f=$("#fade");f.classList.remove("on");void f.offsetWidth;f.classList.add("on")}
function openSheet(){if(P.busy||P.showcase||P.mDrive)return;if(B.forge)setForge(false);hostEl.classList.add("building");$("#pcard").hidden=true;P.saveX=P.pos.x;P.pos.set(FX,0,0);P.target=null;cam.x=FX;facA=-.55;P.showcase=true;$("#tray").hidden=true;flash();renderSheet()}
function closeSheet(){if(B.forge)setForge(false);mUpdateCur=null;hostEl.classList.remove("building");camera.clearViewOffset();P.showcase=false;P.pos.set(P.saveX==null?2:P.saveX,0,0);cam.x=P.pos.x;P.face=P.tface=0;$("#tray").hidden=false;flash();moves();notify()}
function renderSheet(){migrateRobotToKip();moves();notify()}
$("#pc-try").addEventListener("click",function(){var k=$("#pcard").dataset.k,p=k?PART[k]:undefined;$("#pcard").hidden=true;if(!p||!k||P.busy)return;var al=ROBOT_TO_KIP[k];if(al){S.type="character";migrateRobotToKip();S.sel.character[al.slot]=k;B.slot=al.slot;save();buildPlayer(al.slot);moves();openSheet();return}S.type=p.t;cur()[p.s]=p.id;B.slot=p.s;save();buildPlayer(p.s);moves();openSheet()});
$("#pc-x").addEventListener("click",function(){$("#pcard").hidden=true});
function showIntro(w: string){var wd=WORLDS[w];if(!wd)return;var n=wd.spots.filter(function(d){return !S.found[d.k]}).length,e=$("#intro");$("#in-n").textContent=wd.n;$("#in-s").textContent=n?n+(n===1?" part is":" parts are")+" hidden here":"You found every part here";e.classList.remove("on");void e.offsetWidth;e.classList.add("on")}
/* ---------- controls ---------- */
$("#tray").innerHTML=["speed","spin","glow","torque"].map(function(k){return '<button class="mv" data-k="'+k+'" type="button"><span class="pic">'+icon(k)+"</span>"+(STATS[k]?.m||k)+"</button>"}).join("")+'<button class="mv act" id="act" type="button" hidden><span class="pic">'+BOLTI.replace(/20/g,"32")+"</span>Unscrew</button>";
$$(".mv[data-k]").forEach(function(b){b.addEventListener("click",function(){ctx();ability(b.getAttribute("data-k")||"")})});
$("#act").addEventListener("click",function(){ctx();if(P.nearJunk)unboltNext(P.nearJunk)});
/* Compose a level from a seed code (or a fresh random one) out of the level kit and walk into it. Composed worlds live under seed-<code>; only the newest is kept. */
function playSeed(code?: string,theme?: string,opts?: { tier?: 1 | 2 | 3; mood?: "day" | "dusk" | "night" }): string|null{if(P.busy||P.showcase||ED.on)return null;var seed=code?codeToSeed(code):Math.floor(Math.random()*0xffffff)+1,L=composeLevel({seed:seed,theme:theme,tier:opts&&opts.tier,mood:opts&&opts.mood,owned:new Set(Object.keys(S.found||{}))}),w=levelWorld(L);w.spots=w.spots.filter(function(s){return Boolean(PART[s.k])});Object.keys(WORLDS).forEach(function(k){if(k.indexOf("seed-")===0&&k!==L.id)delete WORLDS[k]});WORLDS[L.id]=w;if(S.world===L.id)S.world="garden";switchWorld(L.id);return L.seed}
function switchWorld(w: string){if(P.busy)return;if(w===S.world)return;S.world=w;mUpdateCur=null;mpOpen=false;save();flash();buildWorld(w);P.pos.set(2,0,0);P.prevX=2;P.elev=0;P.target=null;P.face=P.tface=0;cam.x=3;streetCd=.6;sfx.pop();showIntro(w)}
function streetCross(dir: "west" | "east"): boolean {
 var nb=(!ED.on&&!ED.testing)?townNeighbors(S.world):null;
 if(!nb||P.busy||P.mDrive||P.showcase)return false;
 var dest=dir==="west"?nb.west:nb.east;
 S.world=dest;mUpdateCur=null;mpOpen=false;save();flash();buildWorld(dest);
 P.pos.set(dir==="west"?42.3:1.7,0,0);P.prevX=P.pos.x;P.elev=0;P.target=null;P.face=P.tface=dir==="west"?Math.PI:0;cam.x=dir==="west"?40.8:3.2;streetCd=.9;
 sfx.pop();toast((S.type==="vehicle"?"Cruising into ":"Entered ")+(WORLDS[dest]?.n||dest));return true;
}
var ray=new T.Raycaster(),ndc=new T.Vector2(),cam={x:2},hitP=new T.Vector3(),ground=new T.Plane(new T.Vector3(0,1,0),0),hold: { id: number } | null=null,keys: Record<string, number>={};
function rayAt(cx: number,cy: number){var r=canvas.getBoundingClientRect();ndc.set((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera)}
function lanePoint(){return ray.ray.intersectPlane(ground,hitP)?{x:hitP.x,z:clampPathZ(hitP.z)}:null}
function junkHit(){var arr=spots.filter(function(s){return s.junk&&!s.got&&!s.broken}).map(function(s){return s.junk as THREE.Object3D});if(!arr.length)return null;var h=ray.intersectObjects(arr,true);if(!h.length)return null;var o: THREE.Object3D | null=h[0]!.object;while(o&&arr.indexOf(o)<0)o=o.parent;return spots.filter(function(s){return s.junk===o})[0]||null}
function clampPathZ(z: number){return Math.max(-1.2,Math.min(1.2,z))}
function setTarget(x: number,z?: number){var nb=(!ED.on&&!ED.testing)?townNeighbors(S.world):null,lo=nb?.2:.5,hi=nb?44.6:43.5;var tz=z===undefined?P.pos.z:clampPathZ(z);P.target=new T.Vector3(Math.max(lo,Math.min(hi,x)),0,tz);marker.position.set(P.target.x,.06,tz);markT=0}
canvas.addEventListener("pointerdown",function(e: PointerEvent){ctx();if(SLEEPH.consume())return;if(ACTS.consume())return;if(P.showcase||P.mDrive)return;rayAt(e.clientX,e.clientY);if(BUBBLES.count&&BUBBLES.popAt(ray))return;var hb=ray.intersectObjects(bolts,false);if(hb.length){unbolt(hb[0]!.object);return}var js=junkHit();if(js){unboltNext(js);return}var th=ray.intersectObjects(tidySpots.filter(function(s){return !s.done}).map(function(s){return s.hit}),false);if(th.length&&th[0]!.object.userData.tidy){var te=th[0]!.object.userData.tidy;if(Math.abs(P.pos.x-te.x)<3.2){tidyUp(te);return}setTarget(te.x);return}if(sceneVisit){var vh=ray.intersectObjects(sceneMarks.filter(function(mk){return mk.live}).map(function(mk){return mk.hit}),false);var vref=null as null|{kind:string;id:string};for(var vi=0;vi<vh.length;vi++){var vcand=vh[vi]!.object.userData.sceneCarry;if(vcand&&vcand.kind==="spot"&&vh[vi]!.distance-vh[0]!.distance<2.5){vref=vcand;break}}if(vref){var vmk=sceneMarks.filter(function(m){return m.kind==="spot"&&m.id===vref!.id})[0]!;var vr=tapSceneSpot(sceneVisit,vref.id,vmk.x);if(vr.action==="goto")setTarget(vr.x,vmk.g.position.z);sayT(vr.say);sceneTouch();return}}
if(sceneCarry){var ch=ray.intersectObjects(sceneMarks.filter(function(mk){return mk.live}).map(function(mk){return mk.hit}),false);var ref=null as null|{kind:string;id:string};for(var ci=0;ci<ch.length;ci++){var cand=ch[ci]!.object.userData.sceneCarry;if(cand&&ch[ci]!.distance-ch[0]!.distance<2.5){ref=cand;break}}if(ref){var refId=ref.id;if(ref.kind==="item"){var mk2=sceneMarks.filter(function(m){return m.kind==="item"&&m.id===refId})[0]!;var ri=tapSceneItem(sceneCarry,refId,mk2.x);if(ri.action==="goto")setTarget(ri.x,mk2.g.position.z);sayT(ri.say);sceneTouch();return}var mk3=sceneMarks.filter(function(m){return m.kind==="target"&&m.id===refId})[0]!;var rt=tapSceneTarget(sceneCarry,refId,mk3.x);if(rt.action==="goto")setTarget(rt.x,mk3.g.position.z);sayT(rt.say);sceneTouch();return}}
var sh=ray.intersectObjects(signHits,false);if(sh.length&&!P.busy){var sdir=sh[0]!.object.userData.signDir;setTarget(sdir==="west"?.25:44.55);return}if(!ED.on&&FEED.down(e))return;if(!ED.on&&PFX.tap(ray))return;if(P.busy)return;var lp=lanePoint();if(!lp)return;hold={id:e.pointerId};try{canvas.setPointerCapture(e.pointerId)}catch(_){}setTarget(lp.x,lp.z)});
canvas.addEventListener("pointermove",function(e: PointerEvent){if(!hold||hold.id!==e.pointerId||P.busy||P.showcase)return;rayAt(e.clientX,e.clientY);var lp2=lanePoint();if(lp2)setTarget(lp2.x,lp2.z)});
function endHold(e: PointerEvent){if(hold&&hold.id===e.pointerId)hold=null}
canvas.addEventListener("pointerup",endHold);canvas.addEventListener("pointercancel",endHold);
canvas.addEventListener("pointermove",function(e: PointerEvent){FEED.move(e)});canvas.addEventListener("pointerup",function(e: PointerEvent){FEED.up(e)});canvas.addEventListener("pointercancel",function(){FEED.cancel()});
winOn("keydown",function(e){if(paused)return;var k=(e.key||"").toLowerCase(),onBtn=e.target&&e.target.closest&&e.target.closest("button"),tgn=e.target&&e.target.tagName;if(onBtn&&(k===" "||k==="enter"))return;if(tgn==="INPUT"||tgn==="TEXTAREA"||tgn==="SELECT"||(e.target&&e.target.isContentEditable))return;
 if(k==="arrowleft"||k==="a")keys.l=1;else if(k==="arrowright"||k==="d")keys.r=1;else if(k==="arrowup"||k==="w")keys.u=1;else if(k==="arrowdown"||k==="s")keys.d=1;else if(k==="1")ability("speed");else if(k==="2")ability("spin");else if(k==="3")ability("glow");else if(k==="4")ability("torque");else if(k==="e"||k===" "){if(P.nearJunk)unboltNext(P.nearJunk)}else if(k==="b"){P.showcase?closeSheet():openSheet()}else if(k==="escape"&&P.showcase)closeSheet();else return;ctx();e.preventDefault()});
winOn("keyup",function(e){var k=(e.key||"").toLowerCase();if(k==="arrowleft"||k==="a")keys.l=0;if(k==="arrowright"||k==="d")keys.r=0;if(k==="arrowup"||k==="w")keys.u=0;if(k==="arrowdown"||k==="s")keys.d=0});
winOn("blur",function(){keys={}});
var marker=new T.Mesh(new T.RingGeometry(.25,.36,24),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false}));marker.rotation.x=-Math.PI/2;scene.add(marker);var markT=9;
/* ---------- loop ---------- */
var timer=new T.Timer(),t=0;
function resize(){var r=hostEl.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(composer){var pr=renderer.getPixelRatio();composer.setPixelRatio(pr);composer.setSize(w,h);if(bloom)bloom.resolution.set(w*pr/2,h*pr/2);if(fxaa&&fxaa.uniforms&&fxaa.uniforms.resolution)fxaa.uniforms.resolution.value.set(1/(w*pr),1/(h*pr))}}
winOn("resize",resize);
var FR=0;var paused=false;function frame(){if(disposed)return;if(paused){timer.update();rafId=requestAnimationFrame(frame);return}FR++;timer.update();var dt=Math.min(.05,timer.getDelta())*(1);t+=dt;streetCd=Math.max(0,streetCd-dt);
 for(var i=fx.length-1;i>=0;i--){var e=fx[i]!;e.t+=dt;var k=Math.min(1,e.t/e.d);e.f(k,dt);if(k>=1){fx.splice(i,1);if(e.end)e.end()}}
 PFX.update(dt,t);FEED.update(dt);SLEEPH.update(dt);ACTS.update(dt);BUBBLES.update(dt);
 var pk=activePerk(),nb0=(!ED.on&&!ED.testing)?townNeighbors(S.world):null,kLo=nb0?.2:.5,kHi=nb0?44.6:43.5;
 var sp=0,kd=(keys.r?1:0)-(keys.l?1:0),ku=((keys.u?1:0)-(keys.d?1:0)),vmax=pk?pk.vmax:(S.type==="vehicle"?5.2:3.4);
 if(kd&&!P.busy&&!P.showcase&&!P.mDrive){P.target=null;P.pos.x=Math.max(kLo,Math.min(kHi,P.pos.x+kd*vmax*dt));P.pos.z+=(0-P.pos.z)*Math.min(1,dt*1.5);P.tface=kd>0?0:Math.PI;sp=vmax}
 else if(P.target&&!P.busy&&!P.showcase){var dx=P.target.x-P.pos.x,dz=P.target.z-P.pos.z,dist=Math.sqrt(dx*dx+dz*dz);if(dist<.08)P.target=null;else{var ramp=Math.min(1,dist/.8+.35),step=Math.min(dist,vmax*ramp*dt);P.pos.x+=dx/dist*step;P.pos.z=clampPathZ(P.pos.z+dz/dist*step);if(dist>.15)P.tface=Math.atan2(-dz,dx);sp=step/dt}}
 if(ku&&!P.busy&&!P.showcase&&!P.mDrive){P.target=null;P.pos.z=clampPathZ(P.pos.z+ku*vmax*.7*dt);sp=Math.max(sp,vmax*.7)}
 var wantWest=!!(kd<0||(P.target&&P.target.x<=.6)),wantEast=!!(kd>0||(P.target&&P.target.x>=44.2));
 if(!P.mDrive&&!P.showcase){var mb=mBounds();if(P.pos.x>mb[1]){P.pos.x=mb[1];if(P.target&&P.target.x>mb[1])P.target=null}if(P.pos.x<mb[0]){P.pos.x=mb[0];if(P.target&&P.target.x<mb[0])P.target=null}}mUpdate(dt);
 function resolveSceneArrival(){if(!sceneCarry||!sceneCarry.pending)return;var session=sceneCarry;var pd0=session.pending;if(!pd0)return;var pd:{x:number;itemId:string}|{x:number;targetId:string}=pd0;
 var mk=null as null|{kind: string;id: string;x: number;g: THREE.Group;hit: THREE.Object3D};
 for(var i=0;i<sceneMarks.length;i++){var cand=sceneMarks[i]!;if("itemId" in pd){if(cand.kind==="item"&&cand.id===(pd as {itemId:string}).itemId){mk=cand;break}}else if(cand.kind==="target"&&cand.id===(pd as {targetId:string}).targetId){mk=cand;break}}
 if(!mk||Math.abs(P.pos.x-mk.x)>=1.25||Math.abs(P.pos.z)>1||(P.elev||0)>=.8)return;
 var ar=arriveScene(session);if(!ar)return;sceneTouch();
 if(ar.event==="picked"){sfx.pop();sayT(ar.say);return}
 if(ar.event==="placed"){sfx.pop();burst(new T.Vector3(mk.x,.6,0));var placed=null as null|{g: THREE.Group};for(var j=0;j<sceneMarks.length;j++){var c2=sceneMarks[j]!;if(c2.kind==="item"&&c2.id===ar.itemId){placed=c2;break}}if(placed)placed.g.visible=false;sayT(ar.say);return}
 if(ar.event==="wrong"){if(curMission)mFailNote(curMission);if(sfx.bump)sfx.bump();sayT(ar.say+" "+ar.hint);var wmk=mk.g;fx.push({t:0,d:.5,f:function(k){wmk.scale.setScalar(1+.2*Math.sin(Math.PI*k))},end:function(){wmk.scale.setScalar(1)}});var ctid=correctTargetFor(session);setTimeout(function(){cueSceneMark(ctid)},800);return}
 var doneMk=null as null|{g: THREE.Group};for(var k=0;k<sceneMarks.length;k++){var c3=sceneMarks[k]!;if(c3.kind==="item"&&c3.id===ar.itemId){doneMk=c3;break}}
 if(doneMk)doneMk.g.visible=false;sfx.found();if(curMission){var wdef=learnRungDef(session.missionId);var wtxt=wdef?wdef.winText:"All done!";mtWin(curMission,wtxt);say(wtxt)}sceneCarry=null;clearSceneMarks()}
if(!P.showcase&&!P.busy&&!P.mDrive){resolveSceneArrival();resolveVisitArrival();if((sceneCarry||sceneVisit)&&!P.target&&performance.now()/1000-lastSceneTouch>9){sceneTouch();var nm2=nextSceneMarkId();if(nm2){sceneNudges++;cueSceneMark(nm2)}}}
if(!P.showcase&&!P.busy&&!P.mDrive){tidySpots.forEach(function(ts){if(ts.done)return;if(ts.g.userData.spark)ts.g.userData.spark.scale.setScalar(.7+.15*Math.sin(t*4+ts.x));if(Math.abs(P.pos.x-ts.x)<1.25&&Math.abs(P.pos.z)<1.6&&(P.elev||0)<.8)tidyUp(ts)})}
 if(nb0&&!P.mDrive&&!P.showcase&&!P.busy&&!autoWalk&&streetCd<=0){if(P.pos.x<=.48&&wantWest)streetCross("west");else if(P.pos.x>=44.38&&(P.elev||0)<1.5&&wantEast)streetCross("east")}
 P.speed+=(sp-P.speed)*Math.min(1,dt*10);
 var df=((P.tface-P.face+Math.PI*3)%(Math.PI*2))-Math.PI;P.face+=df*Math.min(1,dt*10);
 P.phase+=P.speed*dt*3.2;
 var rig=P.rig,mv=Math.min(1,P.speed/2.5),driven=!!(mix&&rig.type==="character"&&mix.canDrive(rig));
 if(!mixLoading&&rig.type==="character"){mixLoading=true;loadMixamoBank().then(function(b){if(disposed)return;mix=new MixamoDriver({...b,...PROCEDURAL_CLIPS})}).catch(function(e){console.warn("Mixamo clips unavailable, using the procedural walk",e)})}
 P.root.position.set(P.pos.x,0,P.pos.z);if(P.showcase&&FAC){facA+=dt*.45;FAC.userData.tt.rotation.y=facA;FAC.userData.gears[0].rotation.y+=dt*.6;FAC.userData.gears[1].rotation.y-=dt*.9}P.root.position.y=P.showcase?.36:(P.elev||0);P.root.rotation.y=P.showcase?facA:P.face;
 P.model.position.set(P.lunge,P.hop,0);P.model.rotation.set(0,P.spin,0);
 if(P.dropSlot&&P.dropT<1){P.dropT=Math.min(1,P.dropT+dt*2.4);var e2=P.dropT>=1?1:1-Math.pow(1-P.dropT,3)*Math.cos(P.dropT*6);P.dropSlot.position.y=P.dropSlot.userData.y0+1.2*(1-Math.min(1,e2))}
 rig.wheels.forEach(function(w: any){w.rotation.z-=P.speed*dt/(w.userData.r||.3)});
 if(rig.flame){rig.flame.scale.set(1,.8+Math.random()*.5,1)}
 var s1=Math.sin(P.phase);
 if(rig.type==="vehicle"){rig.g.position.y=(pk&&pk.airHover)?(.24+Math.sin(t*3.6)*.06):(Math.abs(Math.sin(t*14))*.03*mv)}
 else if(rig.type==="robot"){if(rig.legs.length){rig.legs[0].rotation.z=s1*.5*mv;rig.legs[1].rotation.z=-s1*.5*mv;rig.g.position.y=Math.abs(s1)*.06*mv}rig.arms[0].rotation.z=-s1*.45*mv;rig.arms[1].rotation.z=s1*.45*mv;rig.head.rotation.y=Math.sin(t*.8)*.25*(1-mv)}
 else{if(!driven){rig.g.rotation.x=s1*.14*mv;rig.g.position.y=Math.abs(s1)*.16*mv;if(rig.feet.length>=2){rig.feet[0].position.y=Math.max(0,s1)*.18*mv;rig.feet[1].position.y=Math.max(0,-s1)*.18*mv}}if(rig.wings.length){var fl=Math.sin(t*(mv>.1?14:3))*(mv>.1?.5:.12);rig.wings[0].rotation.x=-fl;rig.wings[1].rotation.x=fl}else if(rig.arms.length>=2&&!driven){rig.arms[0].rotation.z=s1*.6*mv;rig.arms[1].rotation.z=-s1*.6*mv}if(rig.cape)rig.cape.rotation.z=.05+mv*.25+Math.sin(t*6)*.04*mv;if(rig.body)rig.body.scale.y=(rig.body.userData.sy=rig.body.userData.sy||rig.body.scale.y)*(1+Math.sin(t*2.2)*.02)}
 if(rig.ant)rig.ant.rotation.z=Math.sin(t*9)*(.08+.25*mv);if(rig.siren)rig.siren.material.emissiveIntensity=1+Math.sin(t*8)*.8;if(rig.crown)rig.crown.rotation.y+=dt*1.5;if(rig.toolGears)rig.toolGears.forEach(function(g: any){g.rotation.y+=dt*3});if(rig.chestGear)rig.chestGear.rotation.y+=dt;
 if(rig.spinners)rig.spinners.forEach(function(sp2: any){sp2.rotation[sp2.userData.ax]+=dt*sp2.userData.sp*(1+P.speed*.3)});if(rig.flames)rig.flames.forEach(function(f: any){f.scale.set(1,.75+Math.random()*.5,1)});if(rig.hover)rig.g.position.y=.12+Math.sin(t*3)*.06;if(rig.core)rig.core.material.emissiveIntensity=1.6+Math.sin(t*3)*.8;if(rig.bulb)rig.bulb.material.emissiveIntensity=1.4+Math.sin(t*5)*.5;if(rig.screen)rig.screen.material.emissiveIntensity=1.1+Math.sin(t*2)*.05;
 var vx=(P.pos.x-(P.prevX==null?P.pos.x:P.prevX))/Math.max(dt,.001);P.prevX=P.pos.x;var ax=Math.max(-60,Math.min(60,(vx-(P.prevVx||0))/Math.max(dt,.001)));P.prevVx=vx;var axl=ax*Math.cos(P.face);
 P.spA=P.spA||0;P.spV=P.spV||0;P.spV+=(-70*P.spA-8*P.spV-axl*.014)*dt;P.spA=Math.max(-.6,Math.min(.6,P.spA+P.spV*dt));
 if(rig.ant)rig.ant.rotation.z+=P.spA;if(rig.type==="character"&&rig.slots.extra&&!rig.cape)rig.slots.extra.rotation.z=P.spA*.7;if(rig.cape)rig.cape.rotation.z+=P.spA*.6;if(rig.type==="vehicle")rig.g.rotation.z=-P.spA*.22;if(rig.type==="robot"&&rig.head)rig.head.rotation.z=P.spA*.3;
 P.noticeYaw=0;if(P.notice>0){P.notice=Math.max(0,P.notice-dt*1.6);var nk=Math.sin(Math.PI*(1-P.notice));if(rig.brows)rig.brows.forEach(function(b: any){if(b.userData.y0==null)b.userData.y0=b.position.y;b.position.y=b.userData.y0+nk*.05});if(rig.head&&!driven)rig.head.rotation.y+=nk*.55;P.noticeYaw=nk*.55;if(!P.busy&&!P.target&&!P.showcase)P.hop=Math.max(P.hop,nk*.12)}
 blob.position.set(P.pos.x+P.lunge*Math.cos(P.face),P.showcase?.39:.025,P.pos.z);var bs2=(rig.w||1.9)*(rig.type==="vehicle"?.9:1.1)*(1-Math.min(.5,P.hop/6));blob.scale.set(bs2,bs2*.6,1);(blob.material as THREE.Material).opacity=1-Math.min(.7,P.hop/4);
 P.blinkT-=dt;if(P.blinkT<0)P.blinkT=2.5+Math.random()*3;P.happy=Math.max(0,(P.happy||0)-dt);var bl=P.blinkT<.12?.12:(P.happy>0?.42:1),fyw=P.root.rotation.y,lxw=-Math.sin(fyw),lzw=Math.cos(fyw),lkY=Math.max(-.5,Math.min(.5,Math.atan2(-lzw,lxw)))*(P.speed>1?.35:1);rig.eyes.forEach(function(m: any){m.scale.y=bl;if(m.userData.look){m.rotation.y+=(lkY-m.rotation.y)*Math.min(1,dt*6);m.rotation.z=.06}});if(rig.type==="character"&&rig.head&&!driven)rig.head.rotation.z=P.spA*.35;if(rig.hair)rig.hair.rotation.z=P.spA*.25;if(rig.tail)rig.tail.rotation.z=P.spA*1.2+Math.sin(t*2)*.05;
 if(P.danceBack!=null&&!(mix&&mix.busyAction==="dance")){if(Math.abs(P.tface+Math.PI/2)<1e-6)P.tface=P.danceBack;P.danceBack=null}
 if(driven&&mix){mix.update(rig,dt,P.speed,{headYaw:P.noticeYaw||0,headPitch:-(P.spA||0)*.35});if(rig.hover)rig.g.position.y+=.12+Math.sin(t*3)*.06}
 var hvv=(P.hop-(P.prevHop==null?P.hop:P.prevHop))/Math.max(dt,.001);P.prevHop=P.hop;if(!P.showcase&&!reduce&&!P.squashing){var kq=Math.max(-.1,Math.min(.12,hvv*.025));P.model.scale.set(1-kq*.5,1+kq,1-kq*.5)}
 if(W.blades.length){W.fast=Math.max(1,(W.fast||1)-dt*.6);W.blades.forEach(function(b: any){b.rotation.z-=dt*.8*(W.fast>1.05?7:1)})}
 if(W.fan)W.fan.rotation.x+=dt*(W.fast>1.05?20:2);
 W.blink.forEach(function(b: any,i: number){b.visible=Math.sin(t*3+i)>-.2});
 if(W.ff){var pa=W.ff.geometry.attributes.position,bs=W.ff.userData.base;for(var j=0;j<bs.length;j++)pa.setXYZ(j,bs[j][0]+Math.sin(t*.7+bs[j][3])*.5,bs[j][1]+Math.sin(t*1.3+bs[j][3])*.35,bs[j][2]+Math.cos(t*.6+bs[j][3])*.5);pa.needsUpdate=true}
 bolts.forEach(function(h){var r=h.userData.g.userData.ring;if(r)r.scale.setScalar(.65+Math.sin(t*5)*.15)});
 spots.forEach(function(s){if(s.spark.visible&&!s.got){s.spark.rotation.y+=dt*1.6;s.spark.children[0].position.y=Math.sin(t*2.4)*.08}});
 markT+=dt;marker.material.opacity=Math.max(0,.8-markT*1.2);marker.scale.setScalar(1+markT*.6);
 if(!P.showcase){
  if(P.speed>1&&P.hop<.01){P.dustT=(P.dustT||0)-dt;if(P.dustT<0){P.dustT=.13;puff()}}
  if(P.speed<.1&&!P.busy&&!P.target){P.idleT=(P.idleT||0)+dt;if(P.idleT>6.5){P.idleT=0;if(!reduce&&!(mix&&mix.busyAction))idleAct()}}else P.idleT=0;
  if(P.joyPending&&!P.busy){P.joyPending=false;if(!reduce)joy()}
  var dirNow=Math.cos(P.tface)>0?1:-1;if(P.lastDir&&dirNow!==P.lastDir&&!P.busy&&!reduce)fx.push({t:0,d:.32,f:function(k){if(!P.busy)P.hop=Math.max(P.hop,.2*Math.sin(Math.PI*k))},end:function(){if(!P.busy)P.hop=0}});P.lastDir=dirNow;
  if(S.type!=="vehicle"&&P.speed>.6&&P.hop<.01){var sgn=Math.sin(P.phase)>0?1:-1;if(sgn!==P.lastStep){P.lastStep=sgn;if(sound&&AC){if(S.type==="robot")tone(210,0,.05,"square",.025,150);else tone(300,0,.06,"sine",.045,180)}}}
  var nj: any=null;spots.forEach(function(s){if(s.junk&&!s.got&&!s.broken&&Math.abs(s.d.x-P.pos.x)<3.8)nj=s});P.nearJunk=nj;var act=$("#act");if(act.hidden!==!nj)act.hidden=!nj}
 motor(S.type==="vehicle"&&!P.showcase?P.speed:0);
 spots.forEach(function(s,i){if(s.glint){s.glint.material.opacity=.25+.3*(1+Math.sin(t*3+i*1.7))/2;s.glint.scale.setScalar(.7+.2*Math.sin(t*3+i))}});
 if(!P.busy&&!P.showcase)spots.forEach(function(s){if(s.got)return;var hk=S.world+s.i;if((s.hidden||s.d.t==="speed")&&near(s,3.6)&&(!hintAt[hk]||t-(hintAt[hk]??0)>6)){hintAt[hk]=t;hint(s)}});
 // Stopping beside something still hidden: Kip leans in and peers at it (a held Mixamo pose; walking cancels it, and it fires once per visit).
 var peek=false;if(!P.busy&&!P.showcase&&S.type==="character"&&P.speed<.2)spots.forEach(function(s){if(!s.got&&(s.hidden||s.d.t==="speed")&&near(s,2.6))peek=true});
 P.peekT=peek?(P.peekT||0)+dt:0;if(P.peekT>.45&&!P.peeked){P.peeked=true;mixGo("sneak")}if(!peek)P.peeked=false;
 var asp=camera.aspect,dd0=Math.max(10,Math.min(22,VIEW_W/(2*Math.tan(camera.fov*Math.PI/360)*asp))),ZK=[1,1.5,2.1][S.zoom||0]??1;P.zd=P.zd==null?ZK:P.zd+(ZK-P.zd)*Math.min(1,dt*4);
 // Celebrations (the samba) push the camera in so the dance reads on a phone; walking and idling keep the wide navigation view.
 var pushT=mix&&mix.busyAction==="dance"?DANCE_PUSH:1;P.push=P.push==null?1:P.push+(pushT-P.push)*Math.min(1,dt*(pushT<1?3:2));var dd=dd0*P.zd*P.push;
 if(P.showcase){cam.x+=(P.pos.x-cam.x)*Math.min(1,dt*4);var hh=(rig.h||2.6),cy2=.36+hh*.5,tn=2*Math.tan(camera.fov*Math.PI/360),d2=Math.max(7,(hh/.33)/tn*(asp<.8?1:.62),((rig.w||1.9)/.8)/(tn*asp));camera.position.set(cam.x,cy2+1,d2);camera.lookAt(cam.x,cy2,0);var W0=hostEl.clientWidth,H0=hostEl.clientHeight;camera.setViewOffset(W0,H0,0,H0*(P.title?-.04:.27),W0,H0)}
 else{var la=(Math.cos(P.face)>0?1:-1)*Math.min(1.5,2*Math.tan(camera.fov*Math.PI/360)*asp*dd*.21),tx=Math.max(3,Math.min(41,P.pos.x+la));cam.x+=(tx-cam.x)*Math.min(1,dt*2.6);camera.position.set(cam.x,2.6+dd*.24,dd);camera.lookAt(cam.x,1.1+(P.zd-1)*1.2,P.pos.z*.3)}if(scene.fog&&"near" in scene.fog){if(W.fogW!==W.root){W.fogW=W.root;W.fn0=scene.fog.near;W.ff0=scene.fog.far}var fex=P.showcase?0:dd-dd0;scene.fog.near=W.fn0+fex;scene.fog.far=W.ff0+fex}
 if(!reduce&&P.shake>0){camera.position.x+=(Math.random()-.5)*P.shake;camera.position.y+=(Math.random()-.5)*P.shake*.7}P.shake=Math.max(0,(P.shake||0)-dt*1.6);
 var fovT=36+(reduce?0:(P.kick||0)*6);P.kick=Math.max(0,(P.kick||0)-dt*2.4);if(Math.abs(camera.fov-fovT)>.02){camera.fov+=(fovT-camera.fov)*Math.min(1,dt*12);camera.updateProjectionMatrix()}
 followHero(P.pos.x,P.pos.z);
 if(!perf.done&&t>2.5){perf.n++;perf.sum+=dt;if(perf.n>=90){perf.done=true;var avg=perf.sum/perf.n;if(avg>.034)stepDown(resize);if(avg>.045)stepDown(resize)}}
 if(ED.on){camera.position.set(ED.cx,3+ED.d*.12,ED.d);camera.lookAt(ED.cx,2.4,0)}if(W.backdrop)W.backdrop.update(camera);placeHint();if(composer)composer.render(dt);else renderer.render(scene,camera);if(!disposed)rafId=requestAnimationFrame(frame)}
/* ===== asset quality v2: procedural textures, sculpted toys, detailed props ===== */
function rng(seed: number){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
function fbmField(size: number,seed: number,cells: number,octs: number,sx?: number,sy?: number){var r=rng(seed),L: Array<{ n: number; a: Float32Array }>=[],o: number,i: number;sx=sx||1;sy=sy||1;for(o=0;o<octs;o++){var n=cells<<o,arr=new Float32Array(n*n);for(i=0;i<n*n;i++)arr[i]=r();L.push({n:n,a:arr})}var out=new Float32Array(size*size);for(var y=0;y<size;y++)for(var x=0;x<size;x++){var v=0,amp=.5,tot=0;for(o=0;o<octs;o++){var l=L[o]!,n2=l.n,fx=x/size*n2*sx,fy=y/size*n2*sy,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty);var xa=x0%n2,xb=(xa+1)%n2,ya=y0%n2,yb=(ya+1)%n2,a=l.a[ya*n2+xa]!,b=l.a[ya*n2+xb]!,c=l.a[yb*n2+xa]!,d=l.a[yb*n2+xb]!,top=a+(b-a)*tx,bot=c+(d-c)*tx;v+=amp*(top+(bot-top)*ty);tot+=amp;amp*=.5}out[y*size+x]=v/tot}return out}
function hexRGB(h: string): [number, number, number] {var n=parseInt(h.slice(1),16);return [n>>16&255,n>>8&255,n&255]}
function texFrom(size: number,field: Float32Array,pal: string[],o?: { contrast?: number; repeat?: [number, number]; linear?: boolean }){o=o||{};var c=document.createElement("canvas");c.width=c.height=size;var g=c.getContext("2d")!,id=g.createImageData(size,size),Pp=pal.map(hexRGB),ct=o.contrast||1.8;for(var i=0;i<size*size;i++){var v=Math.min(.999,Math.max(0,((field[i]??0)-.5)*ct+.5)),f=v*(Pp.length-1),k=Math.floor(f),t2=f-k,A=Pp[k]!,Bc=Pp[Math.min(Pp.length-1,k+1)]!;id.data[i*4]=A[0]+(Bc[0]-A[0])*t2;id.data[i*4+1]=A[1]+(Bc[1]-A[1])*t2;id.data[i*4+2]=A[2]+(Bc[2]-A[2])*t2;id.data[i*4+3]=255}g.putImageData(id,0,0);var tx=new T.CanvasTexture(c);tx.wrapS=tx.wrapT=T.RepeatWrapping;if(o.repeat)tx.repeat.set(o.repeat[0],o.repeat[1]);if(!o.linear)tx.colorSpace=T.SRGBColorSpace;tx.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return tx}
var TEXF: Record<string, Float32Array>={},TEX: Record<string, THREE.CanvasTexture>={};
var FIELD_SPEC: Record<string, [number, number, number, number, number?, number?]>={pebble:[256,91,4,4],grass:[256,11,4,4],wood:[256,21,2,4,1,10],bark:[256,31,3,4,1,6],stone:[256,41,4,5],leaf:[256,51,8,3],asphalt:[256,61,6,4],cloud:[256,71,3,4],plastic:[128,81,16,2],sand:[256,101,5,4],snow:[256,111,3,4]};
var FIELD_PAL: Record<string, string[]>={grass:["#1f6659","#246f61","#2b7f70","#2f8873","#277766"],pebble:["#7d8bb8","#8e9cc8","#9eabd4","#8a97c2"],wood:["#5e3a20","#7a4e2c","#8f5e35","#a06c3e","#6e4628"],bark:["#3f2a3b","#5a3d52","#6b4a5f","#7a5368","#4e3448"],stone:["#3a4684","#4a5aa2","#5566b0","#6676c0","#4a59a0"],leaf:["#16595f","#1c6b74","#238c92","#2fa3a0","#1f7f86"],asphalt:["#1b2248","#232c58","#2c3668","#36407a","#262f5e"],cloud:["#aac6ec","#c2d7f4","#d6e5fa","#e8f1fe","#cfe0f7"],sand:["#d9b47a","#e3c08a","#ecce9c","#f2dcae","#e0bc86"],snow:["#9fb4dc","#b2c4e6","#c4d3ee","#d6e1f5","#bccbea"]};
function field(name: string){if(!TEXF[name]){var spec=FIELD_SPEC[name]||FIELD_SPEC.grass!;TEXF[name]=fbmField(spec[0],spec[1],spec[2],spec[3],spec[4],spec[5])}return TEXF[name]!}
function tex(name: string,rep?: [number, number]){var k=name+(rep?rep.join("x"):"");if(TEX[k])return TEX[k]!;var pal=FIELD_PAL[name],size=name==="plastic"?128:256;TEX[k]=pal?texFrom(size,field(name),pal,{repeat:rep}):texFrom(size,field(name),["#000000","#ffffff"],{repeat:rep,linear:true,contrast:1.2});return TEX[k]!}
function bump(name: string,rep?: [number, number]){var k="b_"+name+(rep?rep.join("x"):"");if(!TEX[k])TEX[k]=texFrom(name==="plastic"?128:256,field(name),["#000000","#ffffff"],{repeat:rep,linear:true,contrast:1.4});return TEX[k]!}
function texMat(name: string,o?: { rep?: [number, number]; bs?: number; r?: number; env?: number; flat?: boolean; side?: THREE.Side; c?: string }){o=o||{};var k="t"+name+JSON.stringify(o);if(!MC[k]){MC[k]=new T.MeshStandardMaterial(Object.assign({map:tex(name,o.rep),bumpMap:bump(name,o.rep),bumpScale:o.bs==null?.03:o.bs,roughness:o.r==null?.85:o.r,metalness:0,envMapIntensity:o.env==null?.12:o.env,flatShading:!!o.flat,side:o.side||T.FrontSide},o.c?{color:o.c}:{}));MC[k]!.userData.lin=1}return MC[k]!}
/* smooth, softly displaced blob for rocks, canopies, bushes and clouds */
function blobGeo(r: number,amp: number,seed?: number,ws?: number,hs?: number){var g=new T.SphereGeometry(r,ws||28,hs||20),p=g.attributes.position!,v=new T.Vector3(),k=seed||1;for(var i=0;i<p.count;i++){v.fromBufferAttribute(p,i);var n=v.clone().normalize(),d=Math.sin(n.x*3.1+k)*Math.cos(n.y*2.7+k*1.7)*.5+Math.sin(n.z*4.3+k*2.3)*.3+Math.sin((n.x+n.y)*6.1+k)*.2;v.addScaledVector(n,d*amp*r);p.setXYZ(i,v.x,v.y,v.z)}g.computeVertexNormals();return g}
function rockMesh(r: number,seed: number){var m=M(blobGeo(r,.22,seed,30,22),texMat("stone",{bs:.05,r:.7,env:.25}));m.scale.set(1,.8,.92);return m}
/* toys: treaded tires, spoked rims, hub caps */
/* car and truck bodies: a real side profile with wheel arches, beveled and extruded */
/* detailed props */
function lantern(x: number,z: number,col?: string){var g=new T.Group();g.position.set(x,0,z);var lc=col||"#ffd24d",iron=plastic("#2c3f94",{roughness:.45});g.add(M(new T.CylinderGeometry(.06,.1,1.85,12),plastic("#3a4fa8"),0,.93,0));g.add(M(new T.CylinderGeometry(.18,.22,.12,16),iron,0,1.86,0));
 ([ [.19,.19],[.19,-.19],[-.19,.19],[-.19,-.19] ] as Array<[number, number]>).forEach(function(p){g.add(M(new T.BoxGeometry(.04,.46,.04),iron,p[0],2.13,p[1]))});
 var gl2=new T.MeshPhysicalMaterial({color:"#fff3c8",roughness:.05,transmission:0,transparent:true,opacity:.35,clearcoat:1,depthWrite:false});g.add(M(new T.BoxGeometry(.36,.42,.36),gl2,0,2.13,0));
 g.add(M(new T.SphereGeometry(.12,14,10),glowMat(lc,2.6),0,2.12,0));var cap=M(new T.ConeGeometry(.33,.26,4),iron,0,2.49,0);cap.rotation.y=Math.PI/4;g.add(cap);g.add(M(new T.SphereGeometry(.05,10,8),iron,0,2.66,0));
 var gl=glowSprite(lc==="#ffd24d"?"rgba(255,210,77,0.55)":"rgba(255,157,92,0.55)",2.6);gl.position.set(0,2.12,0);g.add(gl);var pl=new T.PointLight(new T.Color(lc),1.1,7,2);pl.position.set(0,2.12,0);g.add(pl);return add(g)}
function windmill(x: number,z: number,s?: number){var g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s||1);var pts: THREE.Vector2[]=[];for(var i=0;i<=8;i++){var u=i/8;pts.push(new T.Vector2(1.0-u*.45+Math.sin(u*Math.PI)*.04,u*4.2))}g.add(M(new T.LatheGeometry(pts,10),texMat("stone",{bs:.02,r:.8,env:.2}),0,0,0));var rf=M(new T.ConeGeometry(.82,1.1,10),plastic("#22337e"),0,4.7,0);g.add(rf);g.add(M(rbox(.5,.9,.12,.08),texMat("wood",{bs:.02}),0,.45,.92));
 var bl=new T.Group();bl.position.set(0,3.9,.82);var wood=texMat("wood",{bs:.02,r:.7});var cloth=new T.MeshStandardMaterial({color:"#eef2ff",roughness:.9,side:T.DoubleSide});for(var b=0;b<4;b++){var p=new T.Group();p.rotation.z=b*Math.PI/2;p.add(M(new T.BoxGeometry(.08,1.9,.06),wood,0,1.0,0));for(var r=0;r<5;r++)p.add(M(new T.BoxGeometry(.4,.03,.04),wood,.17,.35+r*.36,0));var sail=M(new T.PlaneGeometry(.36,1.5),cloth,.18,1.08,.03);p.add(sail);bl.add(p)}bl.add(M(new T.SphereGeometry(.16,14,10),glowMat("#ffd24d",1.2)));g.add(bl);(W.blades=W.blades||[]).push(bl);return add(g)}
/* A tree of a given kind (treeKinds.ts): trunk height, crown shape and blossoms come from `treeShape`; the apple tree (the default) is exactly the one the Garden always had. `userData.treeKind` tells the prop fx which fruit hangs on it. */
function tree(x: number,z: number,kind?: TreeKind){var apple=kindById("apple")!,sh=(kind&&treeShape(kind))||treeShape(apple)!,g=new T.Group();g.position.set(x,0,z);g.userData.treeKind=(kind&&treeShape(kind))?kind.id:"apple";var pts: THREE.Vector2[]=[];for(var i=0;i<=10;i++){var u=i/10;pts.push(new T.Vector2(.26+.32*Math.pow(1-u,4)+.05*Math.sin(u*9),u*sh.trunk))}g.add(M(new T.LatheGeometry(pts,14),texMat("bark",{rep:[2,1],bs:.06,r:.9}),0,0,0));
 var leaf=texMat("leaf",sh.leafTint?{rep:[2,2],bs:.05,r:.75,env:.2,c:sh.leafTint}:{rep:[2,2],bs:.05,r:.75,env:.2});sh.blobs.forEach(function(c){g.add(M(blobGeo(c[3],.12,c[4],24,18),leaf,c[0],c[1],c[2]))});
 sh.blossoms.forEach(function(f){g.add(M(new T.SphereGeometry(.11,12,10),plastic(f[3]),f[0],f[1],f[2]))});return add(g)}
function bushes(x: number,z: number,kind?: TreeKind){var g=new T.Group();g.position.set(x,0,z);if(kind)g.userData.treeKind=kind.id;var leaf=texMat("leaf",kind&&kind.leaf.toLowerCase()!=="#ffffff"?{rep:[1,1],bs:.05,r:.75,env:.2,c:kind.leaf}:{rep:[1,1],bs:.05,r:.75,env:.2});([ [-.8,.6,0,.8,7],[.1,.9,-.2,1.05,8],[.9,.6,.1,.75,9],[.2,.5,.6,.6,10] ] as Array<[number, number, number, number, number]>).forEach(function(b){g.add(M(blobGeo(b[3],.14,b[4],22,16),leaf,b[0],b[1],b[2]))});return add(g)}
function cloud(x: number,z: number,s?: number,y?: number){var g=new T.Group();g.position.set(x,y||0,z);var m=plastic("#f2f7ff",{roughness:.9,clearcoat:0});([ [0,.8,0,1.3,1],[1.2,.6,.2,1,2],[-1.2,.55,.1,.95,3],[.4,1.45,-.2,.9,4],[-.5,1.25,.2,.85,5],[1.9,.4,0,.7,6],[-1.9,.35,0,.65,7] ] as Array<[number, number, number, number, number]>).forEach(function(c){g.add(M(blobGeo(c[3],.06,c[4],22,16),m,c[0],c[1],c[2]))});g.scale.setScalar(s||1);return add(g)}
function tire(x: number,z: number){var tm=new T.MeshPhysicalMaterial({color:"#1a2142",roughness:.8,clearcoat:.05,bumpMap:treadTex(),bumpScale:.05});var t=M(new T.TorusGeometry(.5,.22,16,32),tm,x,.72,z);t.rotation.y=.4;return add(t)}
function crateMesh(){var g=new T.Group(),wood=texMat("wood",{bs:.04}),dark=texMat("wood",{bs:.04,r:.95});g.add(M(new T.BoxGeometry(.96,.96,.96),wood));[-.36,0,.36].forEach(function(y){g.add(M(new T.BoxGeometry(1.0,.22,1.0),dark,0,y,0))});([ [.46,.46],[.46,-.46],[-.46,.46],[-.46,-.46] ] as Array<[number, number]>).forEach(function(p){g.add(M(new T.BoxGeometry(.1,1.02,.1),dark,p[0],0,p[1]))});var br=M(new T.BoxGeometry(1.25,.1,.04),dark,0,0,.5);br.rotation.z=.78;g.add(br);return g}
/* curved, tapered grass blades with a dark-to-light gradient */
function grassBlades(n: number,box: [number, number, number, number],avoid: ((x: number, z: number) => boolean) | null){var geo=new T.PlaneGeometry(.07,.42,1,4);geo.translate(0,.21,0);var p=geo.attributes.position!,cols: number[]=[];for(var i=0;i<p.count;i++){var y=p.getY(i),u=y/.42;p.setX(i,p.getX(i)*(1-u*.85)+u*u*.06);var c=new T.Color().setRGB(.012+.06*u,.07+.26*u,.06+.14*u);cols.push(c.r,c.g,c.b)}geo.setAttribute("color",new T.Float32BufferAttribute(cols,3));geo.computeVertexNormals();
 var mat=new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.75,envMapIntensity:.1});mat.userData.lin=1;var im=new T.InstancedMesh(geo,mat,n),d=new T.Object3D(),k=0,tries=0;while(k<n&&tries<n*30){tries++;var cx=box[0]+Math.random()*(box[1]-box[0]),cz=box[2]+Math.random()*(box[3]-box[2]);if(avoid&&avoid(cx,cz))continue;for(var j=0;j<5&&k<n;j++){d.position.set(cx+(Math.random()-.5)*.35,0,cz+(Math.random()-.5)*.35);d.rotation.set((Math.random()-.5)*.25,Math.random()*Math.PI,(Math.random()-.5)*.25);d.scale.setScalar(.6+Math.random()*.9);d.updateMatrix();im.setMatrixAt(k++,d.matrix)}}im.count=k;im.receiveShadow=true;return add(im)}
function plankTex(){if(TEX.planks)return TEX.planks;var c=document.createElement("canvas");c.width=c.height=512;var g=c.getContext("2d")!,sh=["#8a5a34","#9a6a40","#a8784a","#93613a","#b08050","#9e6c42"];for(var r=0;r<8;r++){var y=r*64,off=(r%2)*170+((r*97)%60);for(var x=-off;x<512;x+=340){g.fillStyle=sh[(r*3+Math.floor((x+off)/340))%sh.length]!;g.fillRect(x,y,340,64);for(var q=0;q<14;q++){g.strokeStyle="rgba(60,30,10,"+(.06+((q*7)%5)*.02)+")";g.lineWidth=1+(q%3);g.beginPath();var yy=y+4+((q*37)%56);g.moveTo(x,yy);g.bezierCurveTo(x+110,yy+((q%2)?3:-3),x+230,yy+((q%3)-1)*4,x+340,yy);g.stroke()}g.fillStyle="rgba(30,14,4,.55)";g.fillRect(x,y,3,64)}g.fillStyle="rgba(30,14,4,.6)";g.fillRect(0,y,512,3)}var t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(7,3);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());TEX.planks=t;return t}
function groundPlane(kind: string){var gNames: Record<string, string>={sky:"cloud",junk:"asphalt",beach:"sand",snow:"snow",room:"wood"},name=gNames[kind]||"grass";var geo=new T.PlaneGeometry(80,34,160,68);geo.rotateX(-Math.PI/2);var p=geo.attributes.position!;for(var i=0;i<p.count;i++){var x=p.getX(i),z=p.getZ(i),lane=Math.min(1,Math.max(0,(Math.abs(z+7-.5)-1.7)/1.5));p.setY(i,lane*(Math.sin(x*.9)*.05+Math.cos(z*1.3+x*.3)*.06+(kind==="sky"?Math.sin(x*.5+z)*.1:0)))}geo.computeVertexNormals();if(kind==="room"){var fm=new T.MeshPhysicalMaterial({map:plankTex(),roughness:.42,clearcoat:.5,clearcoatRoughness:.25,envMapIntensity:.6});fm.userData.lin=1;var fl=M(geo,fm,18,0,7);fl.castShadow=false;return add(fl)}var m=M(geo,texMat(name,{rep:kind==="room"?[6,3]:[10,4],bs:kind==="junk"?.03:.012,r:kind==="junk"?.7:kind==="room"?.5:.92,env:kind==="junk"||kind==="room"?.35:.1}),18,0,7);m.castShadow=false;return add(m)}

/* ===== robots and characters, v2: sculpted parts and more variety ===== */

/* ===== eyes and faces v3 (no flicker) ===== */
/* ===== characters v3: pick a base, then swap eyes, ears, hat, back, and tail =====
   Built in a front-facing frame (+z), turned to face +x inside the toy. Parts that the
   walk cycle swings (arms, wings, cape) sit in toy-frame holders so the swing axes stay right. */
/* ---- bases ---- */

/* ---- swappable parts ---- */

/* ===== level editor: designers place hiding spots and props on the path, check, playtest, export ===== */

var EDX=createEditor({S:S,P:P,scene:scene,camera:camera,canvas:canvas,hostEl:hostEl,cam:cam,$:$,$$:$$,toast:toast,save:save,notify:notify,flash:flash,updHud:updHud,showIntro:showIntro,buildWorld:buildWorld,crUI:crUI,rayAt:rayAt,laneX:function(){var lp=lanePoint();return lp?lp.x:null}});var ED=EDX.ED;var esc=EDX.esc,edValid=EDX.edValid,edChecks=EDX.edChecks,edSnapX=EDX.edSnapX,edSnap=EDX.edSnap,edUndo=EDX.edUndo,edRedo=EDX.edRedo,edZoom=EDX.edZoom,edView=EDX.edView,edEnter=EDX.edEnter,edExit=EDX.edExit,edPlay=EDX.edPlay,edBack=EDX.edBack,edPlace=EDX.edPlace,edPick=EDX.edPick,edX=EDX.edX,edUp=EDX.edUp,edPanel=EDX.edPanel,edMarkers=EDX.edMarkers,edSetTab=EDX.edSetTab,edArmDs=EDX.edArmDs,edNudge=EDX.edNudge,edDelete=EDX.edDelete,edSetName=EDX.edSetName,edSetTheme=EDX.edSetTheme,edNew=EDX.edNew,edExport=EDX.edExport,edImport=EDX.edImport,edIoClose=EDX.edIoClose,edIoCopy=EDX.edIoCopy,edSetIoText=EDX.edSetIoText,edIoLoad=EDX.edIoLoad,edLoad=EDX.edLoad,edArm=EDX.edArm,edControl=EDX.edControl,edDoneSel=EDX.edDoneSel,edSetHide=EDX.edSetHide,edSetPart=EDX.edSetPart,edZoomBy=EDX.edZoomBy,edFromTitle=EDX.edFromTitle,edPush=EDX.edPush,edApply=EDX.edApply,edFreePart=EDX.edFreePart,syncEdInputs=EDX.syncEdInputs;
canvas.addEventListener("pointerdown",function(e: PointerEvent){if(!ED.on)return;e.stopImmediatePropagation();e.preventDefault();ctx();var pk=edPick(e.clientX,e.clientY);ED.drag={x0:e.clientX,y0:e.clientY,cx0:ED.cx,pin:pk,moved:false};try{canvas.setPointerCapture(e.pointerId)}catch(_){}if(pk){ED.arm=null;ED.sel={kind:pk.kind,i:pk.i};edMarkers();edPanel();var np=ED.pins.filter(function(p){return p.kind===pk!.kind&&p.i===pk!.i})[0]||null;ED.drag.pin=np}},true);
canvas.addEventListener("pointermove",function(e: PointerEvent){if(!ED.on||!ED.drag)return;e.stopImmediatePropagation();var d=ED.drag;if(!d.moved&&Math.hypot(e.clientX-d.x0,e.clientY-d.y0)>7)d.moved=true;if(!d.moved)return;
 if(d.pin){var x=edX(e);if(x!=null){x=edSnapX(x);d.pin.s.position.x=x;d.pin.l.position.x=x;d.nx=x}}
 else{var r=canvas.getBoundingClientRect(),upp=2*ED.d*Math.tan(camera.fov*Math.PI/360)/r.height;ED.cx=Math.max(-4,Math.min(50,d.cx0-(e.clientX-d.x0)*upp))}},true);
canvas.addEventListener("pointerup",edUp,true);canvas.addEventListener("pointercancel",function(e: PointerEvent){if(ED.on){e.stopImmediatePropagation();ED.drag=null}},true);
canvas.addEventListener("wheel",function(e: WheelEvent){if(!ED.on)return;e.preventDefault();edZoom(e.deltaY>0?1.1:.9)},{passive:false});
winOn("resize",function(){if(ED.on)edView()});

winOn("keydown",function(e){if(!ED.on)return;e.stopImmediatePropagation();var tg=e.target&&e.target.tagName;if(tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT")return;var k: string=e.key,mod=e.ctrlKey||e.metaKey;
 if(mod&&k.toLowerCase()==="z"){e.preventDefault();if(e.shiftKey)edRedo();else edUndo()}else if(mod&&k.toLowerCase()==="y"){e.preventDefault();edRedo()}
 else if((k==="Delete"||k==="Backspace")&&ED.sel){e.preventDefault();edDelete()}
 else if(k==="Escape"){ED.sel=null;ED.arm=null;edMarkers();edPanel()}
 else if(k==="ArrowLeft"||k==="ArrowRight"){e.preventDefault();var dir=k==="ArrowLeft"?-1:1;if(ED.sel){edNudge(dir)}else ED.cx=Math.max(-4,Math.min(50,ED.cx+dir*2))}},true);

/* ===== new world art: Beach, Snow Peak, Toy Room ===== */
function stripeTex(cols: string[],n: number,vert: boolean){var key="st"+cols.join()+n+vert;if(TEX[key])return TEX[key]!;var c=document.createElement("canvas");c.width=c.height=128;var g=c.getContext("2d")!;for(var i=0;i<n;i++){g.fillStyle=cols[i%cols.length]!;if(vert)g.fillRect(i*128/n,0,128/n+1,128);else g.fillRect(0,i*128/n,128,128/n+1)}var t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;TEX[key]=t;return t}
function letterTex(ch: string,bg: string){var key="lt"+ch+bg;if(TEX[key])return TEX[key]!;var c=document.createElement("canvas");c.width=c.height=128;var g=c.getContext("2d")!;g.fillStyle=bg;g.fillRect(0,0,128,128);g.strokeStyle="rgba(255,255,255,.85)";g.lineWidth=8;g.strokeRect(10,10,108,108);g.fillStyle="#ffffff";g.font="800 76px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(ch,64,70);var t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;TEX[key]=t;return t}
function blockMat(ch: string,bg: string){return new T.MeshPhysicalMaterial({map:letterTex(ch,bg),roughness:.35,clearcoat:.8})}
/* scenery */
function palm(x: number,z: number,kind?: TreeKind){var pk=kind||kindById("coconut")!,fc=palmFronds(pk),g=new T.Group();g.position.set(x,0,z);var tm=plastic("#b88a5a",{roughness:.8,clearcoat:.05}),rm=plastic("#9a6f45",{roughness:.8}),px=0,py=0;for(var i=0;i<9;i++){var seg=M(new T.CylinderGeometry(.2-i*.008,.24-i*.008,.48,10),tm,px,py+.24,0);seg.rotation.z=-i*.035;g.add(seg);var rg=M(new T.TorusGeometry(.21-i*.008,.035,6,14),rm,px,py+.02,0);rg.rotation.x=Math.PI/2;g.add(rg);px+=Math.sin(i*.035)*.48;py+=.46}
 var top=new T.Group();top.position.set(px,py,0);for(var f=0;f<7;f++){var fr=new T.Group();fr.rotation.y=f/7*Math.PI*2;var lf=M(new T.SphereGeometry(1,16,8),plastic(f%2?fc[1]:fc[0],{roughness:.6}),1.1,-.25,0);lf.scale.set(1.25,.07,.32);lf.rotation.z=-.35;fr.add(lf);top.add(fr)}
 g.add(top);g.userData.treeKind=pk.id;g.userData.fruitSlots=palmFruitOffsets(pk).map(function(o){return[px+o[0],py+o[1],o[2]]});return add(g)}
function umbrella(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var pole=new T.Group();pole.rotation.z=.12;g.add(pole);pole.add(M(new T.CylinderGeometry(.04,.04,2.6,8),plastic("#f4f4f4"),0,1.3,0));pole.add(M(new T.ConeGeometry(1.5,.6,16,1,true),new T.MeshPhysicalMaterial({map:stripeTex(["#ff5a4d","#fff6ea"],8,true),roughness:.5,clearcoat:.3,side:T.DoubleSide}),0,2.55,0));pole.add(M(new T.SphereGeometry(.07,8,6),plastic("#ff5a4d"),0,2.88,0));
 g.add(M(new T.BoxGeometry(1.6,.03,.8),new T.MeshPhysicalMaterial({map:stripeTex(["#52b7ff","#ffffff"],6,false),roughness:.7}),.9,.03,.7));return add(g)}
function sandcastle(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var sm=texMat("sand",{bs:.02,r:.9});g.add(M(rbox(1.8,.5,1.2,.1),sm,0,.25,0));([ [-.7,-.45],[.7,-.45],[-.7,.45],[.7,.45] ] as Array<[number, number]>).forEach(function(p){g.add(M(new T.CylinderGeometry(.24,.28,.9,12),sm,p[0],.7,p[1]));g.add(M(new T.ConeGeometry(.28,.36,12),sm,p[0],1.33,p[1]))});g.add(M(new T.CylinderGeometry(.36,.4,1.2,14),sm,0,.95,0));for(var i=0;i<6;i++){var a=i/6*Math.PI*2;g.add(M(new T.BoxGeometry(.12,.16,.12),sm,Math.cos(a)*.3,1.62,Math.sin(a)*.3))}g.add(M(new T.CylinderGeometry(.015,.015,.6,6),plastic("#f4f4f4"),0,1.9,0));g.add(M(new T.BoxGeometry(.3,.18,.02),plastic("#ff5a4d"),.15,2.1,0));return add(g)}
function pine(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.CylinderGeometry(.16,.22,1,8),plastic("#6b4a5f",{roughness:.8}),0,.5,0));([ [1.5,1.6,1.2],[1.2,1.4,2.1],[.9,1.2,2.9],[.55,1,3.6] ] as Array<[number, number, number]>).forEach(function(c){g.add(M(new T.ConeGeometry(c[0],c[1],10),matte("#1f6a6e",true),0,c[2],0));g.add(M(new T.ConeGeometry(c[0]*.62,c[1]*.42,10),matte("#eef4ff",true),0,c[2]+c[1]*.33,0))});return add(g)}
function snowman(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var sn=plastic("#f4f8ff",{roughness:.7,clearcoat:.1}),ink=plastic("#10163a");g.add(M(new T.SphereGeometry(.62,22,16),sn,0,.55,0));g.add(M(new T.SphereGeometry(.46,22,16),sn,0,1.4,0));g.add(M(new T.SphereGeometry(.33,20,14),sn,0,2.05,0));var ns=M(new T.ConeGeometry(.07,.36,10),plastic("#ff8a3a"),0,2.05,.48);ns.rotation.x=Math.PI/2;g.add(ns);[-.12,.12].forEach(function(e){g.add(M(new T.SphereGeometry(.04,8,6),ink,e,2.15,.3))});[.3,.1,-.1].forEach(function(y){g.add(M(new T.SphereGeometry(.05,8,6),ink,0,1.4+y,.45))});var sc=M(new T.TorusGeometry(.33,.08,8,20),plastic("#ff5a4d"),0,1.78,0);sc.rotation.x=Math.PI/2;g.add(sc);g.add(M(new T.CylinderGeometry(.24,.24,.36,16),plastic("#22337e"),0,2.45,0));g.add(M(new T.CylinderGeometry(.36,.36,.04,16),plastic("#22337e"),0,2.28,0));[1,-1].forEach(function(k){var ar=M(new T.CylinderGeometry(.025,.03,.9,6),plastic("#6b4a5f"),k*.75,1.55,0);ar.rotation.z=k*1.0;g.add(ar)});return add(g)}
function iglooTex(){if(TEX.igloo)return TEX.igloo;var c=document.createElement("canvas");c.width=c.height=256;var g=c.getContext("2d")!;g.fillStyle="#f4f8ff";g.fillRect(0,0,256,256);g.strokeStyle="#b8cbec";g.lineWidth=4;for(var r=0;r<8;r++){var y=r*32;g.beginPath();g.moveTo(0,y);g.lineTo(256,y);g.stroke();for(var cI=0;cI<8;cI++){var x=cI*32+(r%2?16:0);g.beginPath();g.moveTo(x,y);g.lineTo(x,y+32);g.stroke()}}var t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(3,2);TEX.igloo=t;return t}
function igloo(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var im=new T.MeshPhysicalMaterial({map:iglooTex(),roughness:.6,clearcoat:.2});g.add(at(hemiSphere(2.2,im),0,0,0));var tn=M(new T.SphereGeometry(.95,24,12,0,Math.PI*2,0,Math.PI/2),im,0,0,1.9);tn.scale.z=1.35;g.add(tn);var door=new T.Mesh(new T.CircleGeometry(.5,24,0,Math.PI),new T.MeshBasicMaterial({color:"#0a0f2a"}));door.position.set(0,0,3.18);g.add(door);return add(g)}
function roomLamp(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.CylinderGeometry(.45,.5,.1,20),metal("#c9a86a"),0,.05,0));g.add(M(new T.CylinderGeometry(.05,.05,3.2,10),metal("#c9a86a"),0,1.65,0));g.add(M(new T.CylinderGeometry(.5,.85,.8,20,1,true),new T.MeshPhysicalMaterial({color:"#ffe2a8",emissive:"#ffb04a",emissiveIntensity:.6,side:T.DoubleSide,roughness:.6}),0,3.4,0));g.add(M(new T.SphereGeometry(.18,12,10),glowMat("#fff1c0",2.2),0,3.25,0));var gl=glowSprite("rgba(255,200,120,0.6)",4);gl.position.set(0,3.2,.2);g.add(gl);var pl=new T.PointLight(0xffc27a,1.6,9,2);pl.position.set(0,3.1,.6);g.add(pl);return add(g)}
function toyBlocks(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);([ ["A","#ff5a4d",-.5,.45,0,.1],["B","#52b7ff",.5,.45,.1,-.15],["C","#ffd24d",0,1.35,0,.2] ] as Array<[string, string, number, number, number, number]>).forEach(function(b){var m=M(new T.BoxGeometry(.9,.9,.9),blockMat(b[0],b[1]),b[2],b[3],b[4]);m.rotation.y=b[5];g.add(m)});return add(g)}
function bookStack(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var cols=["#ff5a4d","#52b7ff","#ffd24d","#5af0b0","#a78bff"],y=0;for(var i=0;i<5;i++){var h=.18+((i*37)%5)*.02,ox=((i*13)%3-1)*.06,b=M(rbox(1.4-i*.08,h,1.0-i*.04,.03),plastic(cols[i]!),ox,y+h/2,0);b.rotation.y=((i*7)%5-2)*.06;g.add(b);g.add(M(new T.BoxGeometry(1.32-i*.08,h*.75,.02),plastic("#fff6ea"),ox,y+h/2,(1.0-i*.04)/2+.005));y+=h}var st=M(rbox(.2,1.3,.9,.03),plastic("#ff9d5c"),.95,.65,0);st.rotation.z=-.15;g.add(st);return add(g)}
function kidChair(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var wood=plastic("#ff9d5c",{roughness:.6});g.add(M(rbox(1.1,.12,1.0,.04),wood,0,.85,0));g.add(M(rbox(1.1,1.1,.12,.04),wood,0,1.5,-.46));([[-.45,-.38],[.45,-.38],[-.45,.38],[.45,.38]] as Array<[number,number]>).forEach(function(l){g.add(M(new T.CylinderGeometry(.06,.06,.85,10),wood,l[0],.42,l[1]))});g.add(M(rbox(.9,.1,.8,.04),plastic("#52b7ff",{roughness:.8}),0,.94,0));return add(g)}
function potPlant(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.CylinderGeometry(.42,.3,.6,16),plastic("#e06a4a",{roughness:.7}),0,.3,0));g.add(M(new T.CylinderGeometry(.46,.46,.12,16),plastic("#c8553a",{roughness:.7}),0,.62,0));var leaf=plastic("#3fbf72",{roughness:.75});([[-.25,1.15,0,.42],[.28,1.3,-.1,.5],[0,1.6,.08,.46],[.05,1.05,.28,.34]] as Array<[number,number,number,number]>).forEach(function(b){g.add(M(new T.SphereGeometry(b[3],14,10),leaf,b[0],b[1],b[2]))});g.add(M(new T.CylinderGeometry(.05,.07,.6,8),plastic("#2e8f57"),0,.85,0));return add(g)}
function teddyBear(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var fur=plastic("#c98d5a",{roughness:.9}),cream=plastic("#f2d8b8",{roughness:.9});var body=M(new T.SphereGeometry(.55,18,14),fur,0,.6,0);body.scale.set(1,1.1,.85);g.add(body);g.add(M(new T.SphereGeometry(.42,18,14),fur,0,1.45,0));([[-.3],[.3]] as Array<[number]>).forEach(function(e){g.add(M(new T.SphereGeometry(.15,12,10),fur,e[0],1.82,0))});var snout=M(new T.SphereGeometry(.2,12,10),cream,0,1.35,.35);snout.scale.set(1.2,.8,.7);g.add(snout);g.add(M(new T.SphereGeometry(.07,10,8),plastic("#5a3a28"),0,1.42,.52));([[-.18],[.18]] as Array<[number]>).forEach(function(e){g.add(M(new T.SphereGeometry(.055,10,8),plastic("#2b1d14"),e[0],1.56,.37))});([[-.55],[.55]] as Array<[number]>).forEach(function(a){var arm=capsule(.13,.3,fur);arm.position.set(a[0],.75,.05);arm.rotation.z=a[0]<0?.5:-.5;g.add(arm)});([[-.32],[.32]] as Array<[number]>).forEach(function(f){var foot=M(new T.SphereGeometry(.2,12,10),fur,f[0],.16,.3);foot.scale.set(1,.7,1.3);g.add(foot)});return add(g)}
function playBall(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);g.add(M(new T.SphereGeometry(.55,22,16),plastic("#ff5a4d",{roughness:.35,clearcoat:.6}),0,.55,0));var stripe=M(new T.TorusGeometry(.55,.09,10,28),plastic("#fff6ea",{roughness:.4}),0,.55,0);stripe.rotation.x=Math.PI/2.4;g.add(stripe);var stripe2=M(new T.TorusGeometry(.55,.07,10,28),plastic("#52b7ff",{roughness:.4}),0,.55,0);stripe2.rotation.x=-Math.PI/3;g.add(stripe2);return add(g)}
function cushionPile(x: number,z: number){var g=new T.Group();g.position.set(x,0,z);var cols=["#ffd24d","#a78bff","#5af0b0"];([[-.35,.22,0,.15],[.4,.2,.15,-.1],[0,.6,0,.35]] as Array<[number,number,number,number]>).forEach(function(c,i){var m=M(rbox(1.15,.34,1.0,.14),plastic(cols[i%3]!,{roughness:.9}),c[0],c[1],c[2]);m.rotation.y=c[3];g.add(m)});return add(g)}
/* world extras */
function seaPlane(){var p=new T.Mesh(new T.PlaneGeometry(160,48),new T.MeshPhysicalMaterial({color:"#1e93cf",roughness:.12,clearcoat:1,clearcoatRoughness:.1,envMapIntensity:1.1}));p.rotation.x=-Math.PI/2;p.position.set(20,.06,-32);p.receiveShadow=true;add(p);var fo=new T.Mesh(new T.PlaneGeometry(160,.7),new T.MeshBasicMaterial({color:"#ffffff",transparent:true,opacity:.75}));fo.rotation.x=-Math.PI/2;fo.position.set(20,.08,-8.2);add(fo)}
function roomWall(){var c=document.createElement("canvas");c.width=c.height=256;var g=c.getContext("2d")!;g.fillStyle="#2a2266";g.fillRect(0,0,256,256);g.fillStyle="#30287a";for(var i=0;i<8;i+=2)g.fillRect(i*32,0,32,256);g.fillStyle="rgba(255,226,140,.85)";([ [40,50],[150,96],[90,176],[214,212],[204,30],[20,220] ] as Array<[number, number]>).forEach(function(p){g.beginPath();for(var k=0;k<10;k++){var a=k/10*Math.PI*2-Math.PI/2,r=k%2?4:10;g.lineTo(p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r)}g.closePath();g.fill()});var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.repeat.set(16,4);var w=new T.Mesh(new T.PlaneGeometry(130,32),new T.MeshStandardMaterial({map:tx,roughness:.9}));w.position.set(20,15.8,-10);add(w);add(M(new T.BoxGeometry(130,.8,.25),plastic("#efe6ff",{roughness:.5}),20,.4,-9.86))}
function rug(){var c=document.createElement("canvas");c.width=c.height=256;var g=c.getContext("2d")!,cols=["#ff9d5c","#ffd24d","#5af0b0","#52b7ff","#a78bff"];for(var i=0;i<5;i++){g.fillStyle=cols[i]!;g.beginPath();g.arc(128,128,128-i*24,0,Math.PI*2);g.fill()}var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;var m=new T.Mesh(new T.CircleGeometry(1,48),new T.MeshStandardMaterial({map:tx,roughness:.95}));m.rotation.x=-Math.PI/2;m.scale.set(9,5,1);m.position.set(20,.025,1.5);m.receiveShadow=true;add(m)}
function aurora(){var c=document.createElement("canvas");c.width=64;c.height=256;var g=c.getContext("2d")!,gr=g.createLinearGradient(0,0,0,256);gr.addColorStop(0,"rgba(120,255,200,0)");gr.addColorStop(.45,"rgba(120,255,200,.55)");gr.addColorStop(.7,"rgba(160,120,255,.35)");gr.addColorStop(1,"rgba(160,120,255,0)");g.fillStyle=gr;g.fillRect(0,0,64,256);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;
 ([ [-10,30,-90,70,-.15],[40,34,-100,80,.12],[90,28,-95,60,-.1] ] as Array<[number, number, number, number, number]>).forEach(function(a,i){var geo=new T.PlaneGeometry(a[3],22,40,1),p=geo.attributes.position!;for(var j=0;j<p.count;j++)p.setZ(j,Math.sin(p.getX(j)*.12+i)*6);var m=new T.Mesh(geo,new T.MeshBasicMaterial({map:tx,transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false,side:T.DoubleSide}));m.position.set(a[0],a[1],a[2]);m.rotation.z=a[4];add(m)})}
function snowfall(){var n=240,pos=new Float32Array(n*3),sp: number[]=[];for(var i=0;i<n;i++){pos[i*3]=-6+Math.random()*56;pos[i*3+1]=Math.random()*10;pos[i*3+2]=-9+Math.random()*13;sp.push(.4+Math.random()*.6)}var g=new T.BufferGeometry();g.setAttribute("position",new T.BufferAttribute(pos,3));add(new T.Points(g,new T.PointsMaterial({size:.16,map:glowTex("rgba(255,255,255,1)"),transparent:true,depthWrite:false,fog:false})));
 var me=W,e: FxItem={t:0,d:1e9,f:function(_k,dt){if(W!==me){e.t=e.d;return}if(reduce)return;var a=g.attributes.position!;for(var i=0;i<n;i++){var y=a.getY(i)-dt*(sp[i]??.5);if(y<0)y+=10;a.setY(i,y);a.setX(i,a.getX(i)+Math.sin(t*.8+i)*dt*.15)}a.needsUpdate=true}};fx.push(e)}
function extras2(E: Record<string, any>){if(E.sea)seaPlane();if(E.shells)scatter(46,new T.SphereGeometry(.09,8,6,0,Math.PI*2,0,Math.PI/2),plastic("#ffd9e0",{roughness:.5}),[-2,46,-6,5],function(_x,z){return Math.abs(z-1.1)<.7},.02);if(E.wall)roomWall();if(E.rug)rug();if(E.aurora)aurora();if(E.snowfall)snowfall()}
/* junk machines: each breaks into pieces after 3 bolts */
var JUNK2: Record<string, (sp: any, j: THREE.Group, P1: (...objs: THREE.Object3D[]) => THREE.Group) => void>={
 radio:function(sp,_j,P1){var body=plastic("#2fb3a6",{roughness:.4}),dk=plastic("#16205a",{roughness:.5});P1(M(rbox(1.7,1.05,.62,.16),body,0,.62,0),M(rbox(.5,.18,.05,.04),plastic("#ffd24d"),0,1.0,.32));[-.48,.48].forEach(function(x){var sc=M(new T.CylinderGeometry(.3,.3,.08,24),dk,x,.55,.3);sc.rotation.x=Math.PI/2;var rg=M(new T.TorusGeometry(.3,.04,8,24),metal("#cfd8ff"),x,.55,.34);P1(sc,rg,M(new T.SphereGeometry(.1,12,10),plastic("#2a3566"),x,.55,.36))});P1(M(new T.TorusGeometry(.55,.06,8,20,Math.PI),dk,0,1.15,0));var an=M(new T.CylinderGeometry(.02,.02,1.1,6),metal("#cfd8ff"),.6,1.6,0);an.rotation.z=-.4;P1(an,M(new T.SphereGeometry(.05,8,6),plastic("#ff5a4d"),.82,2.1,0));sp.spY=.62;bolt(-.78,.98,.36,sp);bolt(.78,.98,.36,sp);bolt(0,.28,.36,sp)},
 snowcannon:function(sp,_j,P1){var bm=plastic("#ff9d5c",{roughness:.45}),w1=wheelMesh(.32,.2),w2=wheelMesh(.32,.2);w1.position.set(-.5,.32,0);w2.position.set(.5,.32,0);P1(w1,w2);P1(M(rbox(1.3,.6,.9,.12),bm,0,.85,0));P1(M(new T.CylinderGeometry(.35,.25,.5,16),plastic("#eef4ff"),-.25,1.4,0));var br=M(new T.CylinderGeometry(.22,.28,1.4,18),metal("#c9d3f0"),.35,1.55,0);br.rotation.z=-.6;var mz=M(new T.TorusGeometry(.24,.05,8,18),plastic("#22337e"),.75,2.12,0);mz.rotation.set(Math.PI/2,0,-.6);P1(br,mz);sp.spY=.5;bolt(-.5,.95,.47,sp);bolt(.5,.95,.47,sp);bolt(0,.66,.47,sp)},
 jackbox:function(sp,_j,P1){P1(M(new T.BoxGeometry(1.3,1.3,1.3),blockMat("?","#a78bff"),0,.65,0));P1(M(rbox(1.36,.14,1.36,.05),plastic("#ffd24d"),0,1.37,0));var cr=new T.Group();cr.position.set(.72,.8,0);var ax=M(new T.CylinderGeometry(.06,.06,.3,8),metal("#cfd8ff"),.1,0,0);ax.rotation.z=Math.PI/2;cr.add(ax,M(new T.BoxGeometry(.06,.4,.06),metal("#cfd8ff"),.25,-.15,0),M(new T.SphereGeometry(.09,10,8),plastic("#ff5a4d"),.25,-.38,0));P1(cr);sp.spY=.8;bolt(-.42,1.05,.68,sp);bolt(.42,1.05,.68,sp);bolt(0,.32,.68,sp)}};
/* hiding spots: each reuses a proven reveal (fade, push, fly apart, or a high ledge) */
var COVER2: Record<string, (sp: any, d: any) => THREE.Object3D | null>={
 cave:function(sp,d){var r=rockMesh(1.8,17);r.position.set(d.x,1.0,d.z-1.5);r.scale.set(1.5,1.15,1);add(r);var c=darkSprite("rgba(2,6,26,A)",.97);c.position.set(d.x,1.0,d.z+.3);c.scale.set(3.6,2.8,1);add(c);sp.fade=true;return c},
 icecave:function(sp,d){var r=M(blobGeo(1.8,.2,23,30,22),new T.MeshPhysicalMaterial({color:"#bfe3ff",roughness:.12,clearcoat:1,transparent:true,opacity:.92}),d.x,1.0,d.z-1.5);r.scale.set(1.5,1.15,1);add(r);var c=darkSprite("rgba(4,10,40,A)",.97);c.position.set(d.x,1.0,d.z+.3);c.scale.set(3.6,2.8,1);add(c);sp.fade=true;return c},
 bed:function(sp,d){furnishBed(d);var c=darkSprite("rgba(2,6,26,A)",.97);c.position.set(d.x,.45,d.z+.35);c.scale.set(3.8,1.4,1);add(c);sp.fade=true;sp.spY=.4;return c},
 beachball:function(_sp,d){var c=M(new T.SphereGeometry(.95,32,24),new T.MeshPhysicalMaterial({map:stripeTex(["#ff5a4d","#ffffff","#52b7ff","#ffffff","#ffd24d","#ffffff"],6,true),roughness:.3,clearcoat:.9}),d.x,.95,d.z);add(c);return c},
 snowball:function(_sp,d){var c=M(blobGeo(1.0,.1,29,28,20),plastic("#f4f8ff",{roughness:.75,clearcoat:.1}),d.x,.95,d.z);add(c);return c},
 toyblocks:function(_sp,d){var c=new T.Group();c.position.set(d.x,0,d.z);([ ["T","#ff5a4d",-.55,.5,0,.05],["O","#52b7ff",.55,.5,0,-.1],["Y","#ffd24d",0,1.5,0,.12] ] as Array<[string, string, number, number, number, number]>).forEach(function(b){var m=M(new T.BoxGeometry(1,1,1),blockMat(b[0],b[1]),b[2],b[3],b[4]);m.rotation.y=b[5];c.add(m)});add(c);return c},
 tower:function(_sp,d){var wm=plastic("#f4f4f4",{roughness:.5}),rm=plastic("#ff5a4d",{roughness:.5});([ [-.65,-.75],[.65,-.75],[-.65,.15],[.65,.15] ] as Array<[number, number]>).forEach(function(p){add(M(new T.CylinderGeometry(.07,.09,3.2,8),wm,d.x+p[0],1.6,d.z+p[1]))});add(M(new T.BoxGeometry(1.5,.08,.08),wm,d.x,1.6,d.z+.15));add(M(rbox(1.7,.16,1.1,.04),plastic("#c9a06a"),d.x,3.25,d.z-.3));var hut=new T.Group();hut.position.set(d.x,3.33,d.z-.75);hut.add(M(new T.BoxGeometry(1.6,1.0,.1),rm,0,.5,0));hut.add(M(new T.BoxGeometry(1.8,.1,.9),wm,0,1.05,.35));add(hut);add(M(new T.CylinderGeometry(.02,.02,1,6),wm,d.x+.75,4.3,d.z-.75));add(M(new T.BoxGeometry(.45,.28,.02),rm,d.x+.98,4.65,d.z-.75));return null},
 ledge:function(_sp,d){var cl=M(blobGeo(1.3,.25,41,26,20),texMat("stone",{bs:.05,r:.7,env:.25}),d.x+1.9,1.6,d.z-1.3);cl.scale.set(1.2,1.9,1);add(cl);var cap=M(blobGeo(1.1,.15,43,24,16),plastic("#f4f8ff",{roughness:.7}),d.x+1.9,3.6,d.z-1.3);cap.scale.set(1.3,.45,1.05);add(cap);add(M(rbox(2.2,.22,1.0,.08),new T.MeshPhysicalMaterial({color:"#cfeaff",roughness:.1,clearcoat:1,transparent:true,opacity:.92}),d.x,3.25,d.z-.3));[-.6,0,.6].forEach(function(o,i){var ic=M(new T.ConeGeometry(.07,.4+i*.1,6),new T.MeshPhysicalMaterial({color:"#dff2ff",roughness:.05,clearcoat:1}),d.x+o,2.95-i*.05,d.z+.1);ic.rotation.x=Math.PI;add(ic)});return null},
 shelf:function(_sp,d){var wd=plastic("#a8744a",{roughness:.55}),g=new T.Group();g.position.set(d.x,0,d.z-.2);[-1.15,1.15].forEach(function(x){g.add(M(rbox(.14,3.4,.9,.04),wd,x,1.7,0))});[.08,1.15,2.2,3.27].forEach(function(y){g.add(M(rbox(2.44,.14,.9,.03),wd,0,y,0))});g.add(M(new T.BoxGeometry(2.3,3.3,.06),plastic("#6a4a32",{roughness:.8}),0,1.7,-.42));var cols=["#ff5a4d","#52b7ff","#ffd24d","#5af0b0","#a78bff","#ff9d5c"];[.15,1.22].forEach(function(y,r){var bx=-1.0;for(var i=0;i<8;i++){var w=.14+((i+r)%3)*.04,h=.62+((i*3+r)%4)*.08,bk=M(rbox(w,h,.62,.02),plastic(cols[(i+r*2)%6]!),bx+w/2,y+.07+h/2,.05);if(i===6)bk.rotation.z=.25;g.add(bk);bx+=w+.02;if(bx>.95)break}});g.add(M(new T.SphereGeometry(.3,18,14),plastic("#ff5a4d"),.5,2.62,.05));g.add(M(new T.BoxGeometry(.5,.5,.5),blockMat("A","#52b7ff"),-.6,2.52,.05));add(g);return null},
 sandmound:function(sp,d){var c=new T.Group();c.position.set(d.x,0,d.z);var sm=texMat("sand",{bs:.02,r:.9});for(var r=0;r<8;r++){var b=M(new T.SphereGeometry(.45+((r*7)%3)*.12,18,12),sm,((r*37)%9-4)*.18,.18+((r*5)%3)*.12,((r*23)%5-2)*.15);b.scale.y=.55;c.add(b)}c.add(M(new T.SphereGeometry(.12,10,8,0,Math.PI*2,0,Math.PI/2),plastic("#ffb3c1"),.4,.55,.3));var st=M(STARGEO,plastic("#ff9d5c"),-.35,.5,.35);st.scale.setScalar(.5);st.rotation.x=-1.2;c.add(st);add(c);sp.fly=true;sp.spY=.6;return c},
 drift:function(sp,d){var c=new T.Group();c.position.set(d.x,0,d.z);var sn=plastic("#f4f8ff",{roughness:.75,clearcoat:.1});for(var r=0;r<9;r++){var b=M(new T.SphereGeometry(.42+((r*7)%3)*.13,18,12),sn,((r*37)%9-4)*.2,.2+((r*5)%3)*.14,((r*23)%5-2)*.15);b.scale.y=.6;c.add(b)}for(var q=0;q<3;q++){var ic=M(new T.ConeGeometry(.08,.5,6),new T.MeshPhysicalMaterial({color:"#cfeaff",roughness:.05,clearcoat:1}),(q-1)*.45,.7,.25);ic.rotation.z=(q-1)*.3;c.add(ic)}add(c);sp.fly=true;sp.spY=.6;return c},
 laundry:function(sp,d){var c=new T.Group();c.position.set(d.x,0,d.z);var cols=["#ff5a4d","#52b7ff","#ffd24d","#5af0b0","#a78bff","#ff9db0"];for(var r=0;r<9;r++){var m=plastic(cols[r%6]!,{roughness:.85,clearcoat:0}),b=r%3===0?capsule(.12,.45,m):M(new T.SphereGeometry(.38,16,12),m);b.position.set(((r*37)%9-4)*.18,.2+((r*5)%3)*.18,((r*23)%5-2)*.14);if(r%3===0)b.rotation.set(1.3,r,.4);else b.scale.set(1.2,.5,1);c.add(b)}add(c);sp.fly=true;sp.spY=.6;return c}};
function mInit(){S.scrap=S.scrap||0;S.bin=S.bin||{};S.bp=S.bp||{beam:1,sgear:1};S.mdone=S.mdone||{};S.ms=S.ms||{};S.prints=S.prints||{};S.ma=S.ma||{};S.me=S.me||{};S.tidy=S.tidy||{}}


function mReplayPrompt(m: Mission,_title: string){curMission=m;mpOpen=true;mpStamp=mpData(m);notify()}







/* Native mission bridge (5A-U1): stamped snapshot data for engine.ts.
   mpStamp/mpCtrls are rebuilt by every panel render (mPanel, mtPanel,
   mReplayPrompt) from the same state the HTML templates use, so the
   stamped data always matches the rendered panel. mpSnap() serves it
   without touching the DOM beyond one hidden-flag read. */
var mpStamp: any=null,mpOpen=false,curMission: Mission | null=null;
var learnRun: {track:string;plan:number[];at:number;kidMode:boolean;rungMissionId:string}|null=null,learnFinished=0;
var sceneCarry: SceneCarrySession|null=null,sceneVisit: SceneVisitSession|null=null,lastSceneTouch=0,sceneNudges=0,sceneMarks: Array<{kind: string;id: string;x: number;g: THREE.Group;hit: THREE.Object3D;live: boolean}>=[];
function clearSceneMarks(){sceneMarks.forEach(function(mk){if(mk.g.parent)mk.g.parent.remove(mk.g)});sceneMarks=[]}
function mpChrome(title: string,goal: string,actL: string,binText: string,forgeAvailable: boolean){return {title:title,goal:goal,actionLabel:actL,binText:binText,forgeAvailable:forgeAvailable}}
function mpData(m: Mission): any {
  var tier=mTier(m),midV=mid(m);
  function done(title: string){return {mid:midV,tier:tier,title:title,goal:"Solved! Play again to aim for 3 stars or practice.",lines:[],chips:[],ctrls:[],actionLabel:"Play again",forgeAvailable:false,binText:""}}
  if(m.done&&!m.replaying)return done(MT[m.type]?MT[m.type]!.t:MDEF[m.type]!.t);
  if(MT[m.type]){
    var T0=MT[m.type]!,st=T0.st(m);
    var chrome=mpChrome(T0.t,T0.goal,(typeof T0.actL==="function"?T0.actL(m):T0.actL),"",false),d: MPD.MpPanelData;
    if(m.type==="measure")d=MPD.measureData(chrome,T0.list!(m),T0.gap!(m));
    else if(m.type==="balance"){var tb=T0.tq!(m);d=MPD.balanceData(chrome,st.n1,st.n2,tb.L,tb.R)}
    else if(m.type==="logic"){var O=T0.ord!(m),G=GATES[O[Math.min(st.g,O.length-1)]!]!,o=T0.out!(m);d=MPD.logicData(chrome,st.g,O.length,G.g,G.tag,o,true,!!st.A,G.g!=="NOT",!!st.B)}
    else if(m.type==="raft"){var nt=T0.net!(m),names: Record<string, string>={},need=tq(m,0,2,4);Object.keys(RIT).forEach(function(k){names[k]=RIT[k]!.n});d=MPD.raftData(chrome,nt.b,nt.w,need,names,st.items.length>=3)}
    else if(m.type==="lever")d=MPD.leverData(chrome,st.k,st.u,8-st.u);
    else if(m.type==="circuit"){var tr=T0.trace!(m),T=mTier(m),pw=(T<2?"Power reaches "+tr.path.length+" of 6 squares":(tr.ok?"Power is flowing!":"The loop has a gap somewhere"))+(tr.ok?" The loop is closed!":""),cells: MPD.CircuitCell[]=[];for(var yy=0;yy<2;yy++)for(var xx=0;xx<5;xx++){var ck=xx+","+yy,fx0=T0.fixed![ck],rk=T0.rock![ck];cells.push({key:ck,label:rk?"rock":(CGL[T0.cell!(m,xx,yy)]||""),lit:(T<3&&tr.path.indexOf(ck)>=0),locked:!!(fx0||rk)})}d=MPD.circuitData(chrome,pw,cells)}
    else if(m.type==="code"){var slots: MPD.CodeSlot[]=[],keys=["walk","shove","dash","whirl"].map(function(k){return {id:k,label:CNM[k]!}});for(var ci=0;ci<5;ci++){var cc=st.p[ci];slots.push({label:cc?(CNM[cc]||""):"",filled:!!cc,bad:st.bad===ci&&mTier(m)<2})}d=MPD.codeData(chrome,slots,keys,st.p.length>=5)}
    else if(m.type==="pattern"){var R=PR[Math.min(prRounds(m)-1,st.r)]!,seq=R.seq.map(function(k){return {text:PB[k]!.s,background:PB[k]!.c}}),ans=R.ans.map(function(_a,i){var k=st.f[i];return k?{text:PB[k]!.s,background:PB[k]!.c}:null}),pkeys=Object.keys(PB).map(function(k){return {id:k,label:PB[k]!.s+" "+k,border:PB[k]!.c}});d=MPD.patternData(chrome,st.r,prRounds(m),seq,ans,pkeys)}
    else if(m.type==="learn"){var ldef=learnRungDef(midV)!;var lstp=Math.min(st.step||0,ldef.steps.length-1);var lsd=ldef.steps[lstp]!;d=MPD.learnData(mpChrome(ldef.title,ldef.goal,"Say it again","",false),lstp,ldef.steps.length,lsd.say,lsd.choices)}
    else{var cs: MPD.CleanState={stage:st.g,tool:st.tool||null,soap:st.soap||0,soapMixed:!!st.ok,cleaned:{crumbs:!!(st.cl&&st.cl.crumbs),puddle:!!(st.cl&&st.cl.puddle),jam:!!(st.cl&&st.cl.jam)},fixed:{nail:!!(st.fx&&st.fx.nail),bolt:!!(st.fx&&st.fx.bolt),screw:!!(st.fx&&st.fx.screw)},holeReady:!!st.hole,plates:st.pl||[0,0,0],holdingName:(S.tool&&TK[S.tool])?TK[S.tool]!.n:null,tier:mTier(m),toolNames:{vacuum:CTN.vacuum!,mop:CTN.mop!,sponge:CTN.sponge!},messLabel:function(k: string){return k==="jam"?"Sticky jam":k.charAt(0).toUpperCase()+k.slice(1)}};d=MPD.cleanData(chrome,cs)}
    return {mid:midV,tier:tier,title:d.title,goal:d.goal,lines:d.lines,chips:d.chips,ctrls:d.ctrls,actionLabel:d.actionLabel,forgeAvailable:d.forgeAvailable,binText:d.binText};
  }
  var D=MDEF[m.type]!,fst=mst(m),free=!!(m.free||m.replaying);
  var filled: Record<string, string | undefined>={};D.slots.forEach(function(sl){if(fst[sl.id])filled[sl.id]=fst[sl.id]});
  var dd=MPD.classicData(mpChrome(D.t,D.goal,D.act,free?"":binLine(),!free),D.slots.map(function(sl){return {id:sl.id,name:sl.n,accept:sl.acc}}),filled,S.bin||{},free,function(k: string){return TOOLS[k]!.n});
  return {mid:midV,tier:tier,title:dd.title,goal:dd.goal,lines:dd.lines,chips:dd.chips,ctrls:dd.ctrls,actionLabel:dd.actionLabel,forgeAvailable:dd.forgeAvailable,binText:dd.binText};
}
function mpSnap(){
  var m=mUpdateCur;
  if(!m||m.dismissed||!mpStamp)return {open:false};
  if(!mpOpen)return {open:false};
  return {open:true,missionId:mpStamp.mid,tier:mpStamp.tier,title:mpStamp.title,goal:mpStamp.goal,lines:mpStamp.lines,chips:mpStamp.chips,controls:mpStamp.ctrls,actionLabel:mpStamp.actionLabel,forgeAvailable:mpStamp.forgeAvailable,binText:mpStamp.binText};
}
/* Native mission actions (5A-U1): the same bodies the hidden #mp buttons
   ran, callable without the DOM. bind() below delegates to mpPress so both
   paths share one implementation; the hidden sheet is gone as of Unit 3. */
function mpPress(m: Mission,ds: any){
  var T0=MT[m.type],st: any=null;
  function classicSt(){return mst(m)}
  if(!T0){
    st=classicSt();var free=m.free||m.replaying;
    if(ds.use){var a=String(ds.use).split(":"),sl0=a[0]!,tk0=a[1]!;if(!free){if(!(S.bin[tk0]>0))return;S.bin[tk0]--}st[sl0]=tk0;save();if(sfx.snap)sfx.snap();else sfx.pop();mSync(m);mPanel(m);return}
    if(ds.out){var k=st[ds.out];if(k){if(!free)S.bin[k]=(S.bin[k]||0)+1;delete st[ds.out];save();sfx.pop();mSync(m);mPanel(m)}return}
    return;
  }
  st=T0.st(m);
  if(ds.pick!==undefined&&m.type==="learn"){var pdef=learnRungDef(mid(m))!;var pstep=pdef.steps[Math.min(st.step||0,pdef.steps.length-1)]!;if(+ds.pick===pstep.answer){st.step=(st.step||0)+1;save();sfx.found();if(st.step>=pdef.steps.length){mtWin(m,pdef.winText)}else{toast("Yes!");mtPanel(m)}}else{mFailNote(m);if(sfx.bump)sfx.bump();toast(pstep.hint);mtPanel(m)}return}
  if(ds.a!==undefined){var n=+ds.a,L0=T0.list!(m);if(!n){L0.pop();sfx.pop()}else{var s=T0.sum!(m);if(s+n>T0.gap!(m)){toast("Too long: "+s+" + "+n+" makes "+(s+n)+". The gap is "+T0.gap!(m)+".");if(sfx.bump)sfx.bump();return}L0.push(n);sfx.snap()}save();T0.sync(m);mtPanel(m);return}
  if(ds.b!==undefined){var ab=String(ds.b).split(":"),bk=ab[0]!,v=st[bk]+(+ab[1]!);if(v<0||v>4)return;st[bk]=v;save();sfx.snap();T0.sync(m);mtPanel(m);return}
  if(ds.p!==undefined&&m.type!=="code"){st[ds.p]=st[ds.p]?0:1;save();sfx.snap();T0.sync(m);mtPanel(m);return}
  if(ds.r!==undefined){var k2=ds.r;if(k2==="off")st.items.pop();else if(st.items.length<3)st.items.push(k2);save();sfx.snap();T0.sync(m);mtPanel(m);return}
  if(ds.l!==undefined){var u=st.u+(+ds.l);if(u<1||u>7)return;st.u=u;save();sfx.pop();T0.sync(m);mtPanel(m);return}
  if(ds.c!==undefined&&m.type==="circuit"){var kk=ds.c,i=CCY.indexOf(st.c[kk]||"");st.c[kk]=CCY[(i+1)%CCY.length];save();sfx.pop();T0.sync(m);mtPanel(m);return}
  if(ds.k!==undefined){if(st.p.length<5){st.p.push(ds.k);st.bad=-1;save();sfx.pop();mtPanel(m)}return}
  if(ds.q!==undefined){st.p.splice(+ds.q,1);st.bad=-1;save();sfx.pop();mtPanel(m);return}
  if(ds.pb!==undefined){var R=PR[Math.min(prRounds(m)-1,st.r)]!;if(st.f.length>=R.ans.length)return;st.f.push(ds.pb);bellTone(ds.pb);save();T0.sync(m);mtPanel(m);if(st.f.length===R.ans.length)T0.check!(m);return}
  if(ds.t!==undefined){st.tool=ds.t;sfx.pop();mtPanel(m);return}
  if(ds.s!==undefined){var sa=ds.s;if(sa==="add"){st.soap++;noise(0,.2,1800,1200,.06)}else if(sa==="pour")st.soap=0;else if(st.soap>=soapWin(m)[0]&&st.soap<=soapWin(m)[1]){st.ok=1;sfx.found();toast("Perfect soapy water! Now clean the sticky jam.")}else{toast(st.soap<soapWin(m)[0]?"Not enough soap: the water would slide off the jam.":"Too much soap makes slippery suds. Pour it out and try again.");if(sfx.bump)sfx.bump()}save();mtPanel(m);return}
  if(ds.m!==undefined){var km=ds.m;if(CFIT[km]!==st.tool){toast(CWHY[st.tool+">"+km]||"");if(sfx.bump)sfx.bump();return}if(km==="jam"&&!st.ok){toast("Mix the soapy water first.");return}st.cl[km]=1;save();if(st.tool==="vacuum")tone(110,0,.6,"sawtooth",.04,160);else noise(0,.4,900,500,.08);burst(m.mess[km].position);T0.sync(m);if(st.cl.crumbs&&st.cl.puddle&&st.cl.jam){st.g=1;save();toast("Sparkling clean! Now the table wobbles. Grab your tool belt.")}mtPanel(m);return}
  if(ds.f!==undefined){var kf=ds.f,t: string=S.tool;if(kf==="screw"&&t==="drill"){st.hole=1;save();tone(300,0,.9,"sawtooth",.04,900);toast("A neat hole! Now turn the screw in.");mtPanel(m);return}if(kf==="screw"&&t==="screwdriver"&&!st.hole){toast("The screw won’t go into hard wood. Drill a small hole first.");if(sfx.bump)sfx.bump();return}if(FXN[kf]!==t){toast(t==="drill"?"No hole needed for a "+kf+".":TK[t]?TK[t]!.n+" doesn’t fit a "+kf+". Try the "+TK[FXN[kf]!]!.n.toLowerCase()+".":"Pick a tool on your tool belt first.");if(sfx.bump)sfx.bump();return}st.fx[kf]=1;save();toolSound(t);if(st.fx.nail&&st.fx.bolt&&st.fx.screw){st.g=2;save();toast("Rock solid! Dinner time.")}mtPanel(m);return}
  if(ds.c!==undefined&&m.type==="clean"){var ac=String(ds.c).split(":"),ci=+ac[0]!,cd=+ac[1]!,tot=st.pl.reduce(function(x: number,y: number){return x+y},0);if(cd>0&&tot>=6)return;if(cd<0&&!st.pl[ci])return;st.pl[ci]+=cd;save();sfx.pop();T0.sync(m);mtPanel(m);return}
}
function mpGo(m: Mission | null){if(!m||P.busy||P.mDrive)return;ctx();if(m.done&&!m.replaying){mStartReplay(m);return}if(MT[m.type])MT[m.type]!.act(m);else if(m.type==="bridge")bridgeTest(m);else liftTurn(m)}
/* Native customizer bridge (5A-U1 slice C): live snapshot + actions.
   Unlike missions, every customizer field derives from live S/B state, so
   cuSnap() reads it directly instead of stamping at render time. The
   #sheet handler delegates to these functions, engine.ts calls them
   directly. Hidden #sheet DOM was deleted in Unit 3. */
function cuSnap(){
  if(!hostEl.classList.contains("building"))return {open:false,scrap:(S.scrap||0)};
  migrateRobotToKip();
  var T0=TYPES[S.type]!;
  if(!B.slot||T0.slots.indexOf(B.slot)<0)B.slot=T0.slots[0]!;
  var slotId=B.slot!;
  var skinOK=S.type==="character"&&cur().base==="block";
  if(!skinOK&&B.z==="skin")B.z="c1";
  var st=creStats();
  var movesText="Moves: "+(Object.keys(STATS).filter(function(k){return st[k]}).map(function(k){return STATS[k]!.m}).join(", ")||"none");
  var forge=hostEl.classList.contains("forging");
  var rows: CUD.CuForgeRow[] | null=null;
  if(forge)rows=Object.keys(TOOLS).map(function(k){var Tt=TOOLS[k]!,bp=!!S.bp[k];return {key:k,name:Tt.n,desc:Tt.d,cost:Tt.cost,hasBlueprint:bp,owned:(S.bin[k]||0),canForge:bp&&(S.scrap||0)>=Tt.cost,onPrintList:!!S.prints[k]}});
  return CUD.customizerData({
    forge:forge,toyType:S.type,scrap:(S.scrap||0),
    types:UI_TYPES.map(function(t){return {id:t,label:TYPES[t]!.n,selected:S.type===t}}),
    slots:T0.slots.map(function(s){return {id:s,label:T0.sn[s]!,selected:slotId===s}}),
    options:slotOptionList(S.type,slotId).map(function(o){var lock=!isOpen(o.k);return {optId:o.optId,name:o.n,detail:o.l+" · "+(STATS[o.st]||LOOK).n,statColor:(STATS[o.st]||LOOK).c,locked:lock,lockLabel:lock?"Find in "+WN[o.w]:"",selected:cur()[slotId]===o.optId}}),
    skinZone:skinOK,zone:B.z as CUD.PaintZoneId,
    paints:(B.z==="skin"?SKINS:PAINTS).slice(),
    paintSelected:S.col[B.z],
    movesText:movesText,forgeRows:rows});
}
function cuAct(a: string){
  if(a==="done"){closeSheet();return}
  if(a==="order"){sfx.found();toast("Order is mocked here. In the app a grown-up approves it.");return}
  if(a==="reset"){S.found={};save();buildWorld(S.world);moves();toast("Progress reset. Every hidden part is back in its world.");return}
  setForge(!B.forge);
}
function cuType(t: string){var nt=t==="robot"?"character":t;if(S.type!==nt){S.type=nt;S.toyId=nt==="vehicle"?"seed-car":"seed-kip";save();buildPlayer(null);sfx.snap();burst(new T.Vector3(P.pos.x,1.2,P.pos.z),"rgba(155,212,255,1)",10)}renderSheet()}
function cuSlot(s: string){B.slot=s;sfx.pop();renderSheet()}
function cuPart(id: string){var slotId=B.slot||"base",k=slotPartKey(S.type,slotId,id),p=PART[k];if(!p)return;if(!isOpen(k)){toast("Find it in "+WN[p.w]+".");sfx.bump();return}cur()[slotId]=id;save();buildPlayer(slotId);partSound(k);renderSheet()}
function cuZone(z: string){B.z=z;renderSheet()}
function cuPaint(c: string){S.col[B.z]=c;save();buildPlayer(null);sfx.pop();burst(new T.Vector3(P.pos.x,1.4,P.pos.z),"rgba(255,255,255,1)",8);renderSheet()}
function cuForgeTool(id: string){var Tt=TOOLS[id];if(!Tt)return;if(!S.bp[id]||(S.scrap||0)<Tt.cost)return;S.scrap-=Tt.cost;S.bin[id]=(S.bin[id]||0)+1;save();sfx.found();toast("Forged: "+Tt.n+".");notify()}
function cuPrintTool(id: string){var Tt=TOOLS[id];if(!Tt||!S.bp[id])return;S.prints[id]=1;save();toast("Added "+Tt.n+" to the print list. A grown-up can order it.");notify()}
/* Native create bridge (5A-U1 slice R): say/input state + snapshot + actions.
   crSay/crInput mirror the hidden #cr-say/#cr-in elements at the same write
   sites; crSnap() serves the snapshot without reading the DOM. Hidden #cr
   handlers delegated to these functions. Hidden DOM was deleted in Unit 3. */
var crSay="",crInput="";
var crMicAvail=(typeof window!=="undefined")&&!!(window.SpeechRecognition||window.webkitSpeechRecognition);
function crSnap(){
  if(!hostEl.classList.contains("creating"))return {open:false};
  if(ED.testing||hostEl.classList.contains("testing"))return {open:false};
  var R=ED.R,themeName: string | null=null,spots: CRD.CrSpot[]=[],scenery: string[]=[],tip=false;
  if(R){
    var cnt: Record<string, number>={};
    R.props.forEach(function(p: any){cnt[p.type]=(cnt[p.type]||0)+1});
    var ps=Object.keys(cnt).map(function(k){return cnt[k]!+" "+crPl(PROPS[k]!.n.toLowerCase(),cnt[k]!)});
    themeName=TNAME[R.theme]||null;
    spots=R.spots.map(function(s: any){return {name:PART[s.part]!.n,hide:HIDE[s.hide]!.n.toLowerCase(),x:s.x}});
    scenery=ps;tip=R.spots.length===0;
  }
  return CRD.createData({busy:!!CR.busy,say:crSay,inputValue:crInput,chips:CHIPS.slice(),themeName:themeName,spots:spots,scenery:scenery,tip:tip,canUndo:ED.undo.length>0,codeVisible:!!CR.code,micAvailable:!!crMicAvail,recipe:ED.R});
}
function crSubmit(text: string){crInput=text;crMake(text)}
function crSetInput(t: string){crInput=t}
function crUndo(){edUndo();crSay="Went back one step.";notify()}
function crKeep(){var L0: any[]=[];try{L0=JSON.parse(localStorage.getItem("tvMyWorlds")||"[]")}catch(e){}L0.unshift(ED.R);try{localStorage.setItem("tvMyWorlds",JSON.stringify(L0.slice(0,8)))}catch(e){}toast("Kept! Your world is saved on this device.")}
function crPlayM(){edPlay()}
function crCodeToggle(){CR.code=!CR.code;notify()}
function crMicStart(){var SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast("Voice input needs a browser with speech recognition.");return}try{var r=new SR();r.lang="en-US";r.interimResults=false;r.maxAlternatives=1;r.onresult=function(e: any){var t=e.results[0][0].transcript;crInput=t;notify()};r.start()}catch(e){toast("Voice input did not start.")}}
function crFromTitle(){ctx();P.title=false;S.started=true;save();crEnter()}
/* Native editor bridge (5A-U1 slice E): input mirrors + snapshot + actions.
   edName/edTheme/edIo/edBackLabel mirror the hidden #ed inputs and dialog
   at the same write sites; edSnap() serves the snapshot without reading the
   DOM. Hidden #ed handlers delegate to these functions. DOM stays until
   Unit 3. */
function mpForge(){mpOpen=false;notify();openSheet();setForge(true)}
function mpLater(m: Mission | null){if(m){if(m.replaying)mCancelReplay(m);m.dismissed=true}mpOpen=false;notify()}
/* Learn runs (carousel C2): a plan of ladder rungs played in order.
   Lab rungs ride the real in-world missions at the rung tier; new-id
   rungs ride a virtual panel mission (type "learn"). Wins arrive via
   the missions onWin hook and advance the plan. */
function openLearnRung(){if(!learnRun)return;var lad=ladderById(learnRun.track);if(!lad){learnRun=null;notify();return}var rung=lad.rungs[learnRun.plan[learnRun.at]!]!;learnRun.rungMissionId=rung.missionId;
 if(rung.missionId.indexOf("lab")===0){var parts=rung.missionId.split("."),lw=parts[0]!,lt=parts[1]!;if(S.world!==lw)switchWorld(lw);var m: Mission|undefined=(W.missions||[]).find(function(x: Mission){return x.type===lt});if(!m){toast("That level is not here yet.");learnRun=null;notify();return}var st0=mst(m);st0.tier=rung.tier;m.dismissed=false;var entry=MT[m.type];if(entry){if(entry.st)entry.st(m);entry.sync(m)}else mSync(m);P.pos.x=entry?entry.hold(m):m.x-2;P.target=null;mUpdateCur=m;save();mPanel(m);notify();return}
 var ldef2=learnRungDef(rung.missionId);if(!ldef2){learnRun=null;notify();return}if(!S.ms[rung.missionId])S.ms[rung.missionId]={};S.ms[rung.missionId].tier=rung.tier;var vm: Mission={type:"learn",learnId:rung.missionId,x:P.pos.x,done:!!S.mdone[rung.missionId]};curMission=vm;mUpdateCur=vm;save();mtPanel(vm);startSceneMarkers(rung.missionId);notify()}
function startSceneMarkers(missionId: string){clearSceneMarks();sceneCarry=startSceneCarry(missionId);sceneVisit=null;if(!sceneCarry){var vs0=startSceneVisit(missionId);if(!vs0)return;sceneVisit=vs0;startVisitMarkers(vs0);sayT(vs0.recipe.intro);sceneTouch();return}var session=sceneCarry;
 session.params.items.forEach(function(item,idx){var x=itemMarkerX(idx);var g=new T.Group();g.position.set(x,0,0);
  g.add(M(rbox(.55,.5,.55,.1),plastic("#3c55b8"),0,.28,0));var lb=textSprite(item.label||item.id,"#e8ecff",.5);lb.position.set(0,1.15,0);g.add(lb);
  var hit=new T.Mesh(new T.SphereGeometry(1.35,8,6),new T.MeshBasicMaterial({visible:false}));hit.position.set(0,.5,0);hit.userData={sceneCarry:{kind:"item",id:item.id}};g.add(hit);add(g);
  sceneMarks.push({kind:"item",id:item.id,x:x,g:g,hit:hit,live:true})});
 session.params.targets.forEach(function(target){var g2=new T.Group();g2.position.set(target.x,0,0);
  var ring=new T.Mesh(new T.TorusGeometry(.62,.09,10,28),new T.MeshBasicMaterial({color:0x5af0b0}));ring.rotation.x=-Math.PI/2;ring.position.y=.06;g2.add(ring);
  var lb2=textSprite(target.label||target.id,"#5af0b0",.5);lb2.position.set(0,1.5,0);g2.add(lb2);
  var hit2=new T.Mesh(new T.SphereGeometry(1.35,8,6),new T.MeshBasicMaterial({visible:false}));hit2.position.set(0,.5,0);hit2.userData={sceneCarry:{kind:"target",id:target.id}};g2.add(hit2);add(g2);
  sceneMarks.push({kind:"target",id:target.id,x:target.x,g:g2,hit:hit2,live:true})});
 sayT(session.params.items.length+" things to put away. Tap one.");sceneTouch()}
function resolveVisitArrival(){if(!sceneVisit||!sceneVisit.pending)return;var session=sceneVisit;var pd=session.pending;if(!pd)return;
 var mk=null as null|{kind: string;id: string;x: number;g: THREE.Group;hit: THREE.Object3D;live: boolean};
 for(var i=0;i<sceneMarks.length;i++){var cand=sceneMarks[i]!;if(cand.kind==="spot"&&cand.id===pd.spotId){mk=cand;break}}
 if(!mk||Math.abs(P.pos.x-mk.x)>=1.25||Math.abs(P.pos.z)>1||(P.elev||0)>=.8)return;
 var ar=arriveSceneVisit(session);if(!ar)return;sceneTouch();var mg=mk.g;
 if(ar.event==="wrong"){if(curMission)mFailNote(curMission);if(sfx.bump)sfx.bump();sayT(ar.say+" "+ar.hint);var wmg=mg;fx.push({t:0,d:.5,f:function(k){wmg.scale.setScalar(1+.2*Math.sin(Math.PI*k))},end:function(){wmg.scale.setScalar(1)}});var nxt=session.recipe.spots[session.at];if(nxt){var nid=nxt.id;setTimeout(function(){cueSceneMark(nid)},800)}return}
 if(ar.effect==="hide"){sfx.pop();burst(new T.Vector3(mk.x,.9,0));mg.visible=false}
 else if(ar.effect==="green"){sfx.pop();if(mg.userData.disc)mg.userData.disc.material.color.set(0x5af0b0)}
 else if(ar.effect==="reveal"){sfx.pop();var nx2=session.recipe.spots[session.at];if(nx2){var nm=sceneMarks.filter(function(m){return m.id===nx2!.id})[0];if(nm){nm.g.visible=true;nm.live=true}cueSceneMark(nx2.id)}}
 else{sfx.pop();fx.push({t:0,d:.6,f:function(k){mg.scale.setScalar(1+.25*Math.sin(Math.PI*k))},end:function(){mg.scale.setScalar(1)}})}
 sayT(ar.say);
 if(ar.event==="done"){sfx.found();if(curMission){var wdef2=learnRungDef(session.missionId);var wtxt2=wdef2?wdef2.winText:"All done!";mtWin(curMission,wtxt2);say(wtxt2)}sceneVisit=null;clearSceneMarks()}}
function startVisitMarkers(vs: SceneVisitSession){var mid=vs.missionId;
 vs.recipe.spots.forEach(function(spot){var g=new T.Group();g.position.set(spot.x,0,0);var hidden=mid==="little.peek"&&spot.id==="bunny";if(hidden)g.visible=false;
  if(mid==="little.pop"){var pr=spot.id==="big"?.85:.4,py=spot.id==="big"?1:.55;var bub=new T.Mesh(new T.SphereGeometry(pr,20,14),new T.MeshBasicMaterial({color:0x9adcff,transparent:true,opacity:.5}));bub.position.y=py;g.add(bub);var bl=textSprite(spot.label,"#cfeaff",.45);bl.position.set(0,py+pr+.35,0);g.add(bl)}
  else if(mid==="little.animals"){var emm: Record<string,string>={cow:"🐮",bird:"🐦",frog:"🐸"};var es=textSprite(emm[spot.id]||"🐾","#ffffff",1.7);es.position.set(0,1.05,0);g.add(es);g.add(M(rbox(.9,.18,.9,.06),plastic("#3c55b8"),0,.09,0));var al=textSprite(spot.label,"#e8ecff",.45);al.position.set(0,2.15,0);g.add(al)}
  else if(mid==="little.peek"){if(spot.id==="bush"){var bmat=plastic("#3f9e4d",{roughness:.7});[[-.55,.55,0,.55],[.1,.8,-.1,.7],[.6,.5,.1,.5]].forEach(function(b){g.add(M(new T.SphereGeometry(b[3],12,10),bmat,b[0],b[1],b[2]))})}else{var be=textSprite("🐰","#ffffff",1.5);be.position.set(0,1,0);g.add(be)}var pl=textSprite(spot.label,"#e8ecff",.45);pl.position.set(0,2,0);g.add(pl)}
  else{var disc=new T.Mesh(new T.CircleGeometry(.55,24),new T.MeshBasicMaterial({color:0x8a93a8}));disc.rotation.x=-Math.PI/2;disc.position.y=.06;g.add(disc);g.userData.disc=disc;var dl=textSprite(spot.label,"#cfe0ff",.4);dl.position.set(0,1.25,0);g.add(dl)}
  var vhit=new T.Mesh(new T.SphereGeometry(1.35,8,6),new T.MeshBasicMaterial({visible:false}));vhit.position.set(0,.6,0);vhit.userData={sceneCarry:{kind:"spot",id:spot.id}};g.add(vhit);add(g);
  sceneMarks.push({kind:"spot",id:spot.id,x:spot.x,g:g,hit:vhit,live:!hidden})})}
function correctTargetFor(session: SceneCarrySession): string{var held=session.state.held;if(!held)return "";var item=session.params.items.filter(function(i){return i.id===held})[0];return item&&item.targetIds[0]||""}
function sceneTouch(){lastSceneTouch=performance.now()/1000}
function nextSceneMarkId(): string{if(sceneVisit){if(sceneVisit.done)return "";var nx=sceneVisit.recipe.spots[sceneVisit.at];return nx?nx.id:""}if(sceneCarry){var cs=sceneCarry;if(cs.state.held){var hi=cs.params.items.filter(function(i){return i.id===cs.state.held})[0];return hi&&hi.targetIds[0]||""}for(var i=0;i<cs.params.items.length;i++){var it2=cs.params.items[i]!;if(cs.state.placed[it2.id]==null)return it2.id}}return ""}
function cueSceneMark(id: string){var mk=sceneMarks.filter(function(m){return m.id===id})[0];if(!mk)return;var g=mk.g;fx.push({t:0,d:1.1,f:function(k){g.scale.setScalar(1+.18*Math.sin(k*Math.PI*3))},end:function(){g.scale.setScalar(1)}})}
function onLearnWin(key: string){if(!learnRun||key!==learnRun.rungMissionId)return;var run=learnRun;run.at++;if(run.at>=run.plan.length){var lad2=ladderById(run.track);learnRun=null;sceneCarry=null;sceneVisit=null;clearSceneMarks();learnFinished++;toast("You finished "+(lad2?lad2.label:"")+"!");notify();return}setTimeout(function(){if(learnRun===run)openLearnRung()},1200)}
function startLearnRunFn(track: string,plan: number[],kidMode: boolean){var lad=ladderById(track);if(!lad||!plan.length)return;learnRun={track:track,plan:plan.slice(),at:0,kidMode:!!kidMode,rungMissionId:""};openLearnRung();notify()}
function stopLearnRunFn(){if(curMission&&curMission.type==="learn"){mpOpen=false;curMission=null;mUpdateCur=null}learnRun=null;sceneCarry=null;sceneVisit=null;clearSceneMarks();notify()}
function learnStateFn(){return {run:learnRun?{track:learnRun.track,rungIndex:learnRun.plan[learnRun.at]??-1,step:learnRun.at+1,total:learnRun.plan.length,kidMode:learnRun.kidMode}:null,finished:learnFinished}}
function scrapGain(n: number,why?: string){S.scrap=(S.scrap||0)+n;save();if(why)toast("+"+n+" scrap ("+why+"). You have "+S.scrap+".")}
function cylBetween(a: THREE.Vector3,b: THREE.Vector3,r: number,mat: THREE.Material){var d=new T.Vector3().subVectors(b,a),len=d.length(),c=M(new T.CylinderGeometry(r,r,len,10),mat);c.position.copy(a).add(b).multiplyScalar(.5);c.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize());return c}
function chestMesh(){var g=new T.Group(),wd=plastic("#a8744a",{roughness:.55}),gd=metal("#ffd24d");g.add(M(rbox(1.1,.6,.75,.08),wd,0,.3,0));[-.4,.4].forEach(function(x){g.add(M(new T.BoxGeometry(.08,.62,.78),gd,x,.3,0))});var lid=new T.Group();lid.position.set(0,.6,-.37);g.add(lid);lid.add(M(rbox(1.12,.26,.77,.1),wd,0,.12,.37));[-.4,.4].forEach(function(x){lid.add(M(new T.BoxGeometry(.08,.28,.8),gd,x,.12,.37))});g.add(M(rbox(.18,.18,.06,.03),gd,0,.52,.39));g.userData.lid=lid;var gl=glowSprite("rgba(255,214,90,0.7)",1.8);gl.position.set(0,.9,.2);g.add(gl);g.userData.glow=gl;return g}
function mBridge(m: Mission){var x=m.x,w=2.6,wm=new T.MeshPhysicalMaterial({color:"#2b9be0",roughness:.08,clearcoat:1,transparent:true,opacity:.9});var wp=new T.Mesh(new T.PlaneGeometry(w,9),wm);wp.rotation.x=-Math.PI/2;wp.position.set(x,.04,0);wp.receiveShadow=true;add(wp);
 [-1,1].forEach(function(k){for(var z=-3.6;z<=3.6;z+=1.2){var r=rockMesh(.26+((z*7+k*3)%3+3)%3*.05,Math.round(z*10)+k*7);r.position.set(x+k*(w/2+.1),.12,z);add(r)}});
 var bg=new T.Group();bg.position.set(x,0,0);add(bg);m.bg=bg;m.plank=M(rbox(w+.9,.2,1.5,.06),plastic("#b07a4a",{roughness:.6}),0,.14,0);bg.add(m.plank);
 var tr=new T.Group(),mt=metal("#cfd8ff");[.68,-.68].forEach(function(z){tr.add(cylBetween(new T.Vector3(-w/2-.3,.24,z),new T.Vector3(0,1.45,z),.06,mt));tr.add(cylBetween(new T.Vector3(w/2+.3,.24,z),new T.Vector3(0,1.45,z),.06,mt));tr.add(cylBetween(new T.Vector3(0,.24,z),new T.Vector3(0,1.45,z),.05,mt))});tr.add(cylBetween(new T.Vector3(0,1.45,-.68),new T.Vector3(0,1.45,.68),.05,mt));bg.add(tr);m.truss=tr;
 m.chest=chestMesh();m.chest.position.set(m.x+2.3,0,-.6);add(m.chest);mSync(m)}
function mLift(m: Mission){var x=m.x,px=x+.7,mt=metal("#c9d3f0"),dk=plastic("#2a3566",{roughness:.5});m.px=px;m.py=m.done?2.6:0;
 [-1,1].forEach(function(k){add(M(new T.CylinderGeometry(.08,.1,3.9,10),mt,px+k*1.0,1.95,-.95))});add(M(rbox(2.3,.16,.16,.04),mt,px,3.9,-.95));
 m.plat=new T.Group();m.plat.position.set(px,m.py,0);add(m.plat);m.plat.add(M(rbox(1.9,.2,1.6,.06),plastic("#ffd24d",{roughness:.45}),0,.1,0));([ [-.85,.7],[.85,.7] ] as Array<[number, number]>).forEach(function(p){m.plat.add(M(new T.CylinderGeometry(.04,.04,.6,8),mt,p[0],.4,p[1]))});
 var ld=M(rbox(4.6,2.6,2.6,.12),texMat("asphalt",{bs:.03,r:.75,env:.3}),px+1.0+2.3,1.3,-.3);add(ld);add(M(new T.BoxGeometry(4.6,.08,2.62),plastic("#ffd24d",{roughness:.5}),px+1.0+2.3,2.62,-.3));
 m.chest=chestMesh();m.chest.position.set(44.2,2.6,-.6);add(m.chest);
 m.gx0=px-1.5;m.gy=3.0;add(M(rbox(.3,3.3,.3,.05),dk,m.gx0-.4,1.65,-1.35));add(M(rbox(2.9,.22,.3,.05),dk,m.gx0+1.0,3.42,-1.35));m.drv=faceGear(.34,plastic("#ff9d5c"));m.drv.position.set(m.gx0,m.gy,-1.1);add(m.drv);var arm=M(new T.CylinderGeometry(.035,.035,.26,8),mt,.22,0,.12);arm.rotation.x=Math.PI/2;m.drv.add(arm);m.drv.add(M(new T.SphereGeometry(.08,10,8),plastic("#ffd24d"),.22,0,.27));m.drv.add(M(new T.CylinderGeometry(.06,.06,.1,10),mt,0,0,.08).rotateX(Math.PI/2));
 m.drum=M(new T.CylinderGeometry(.18,.18,.3,16),plastic("#6b4423",{roughness:.7}),0,0,0);m.drum.rotation.x=Math.PI/2;add(m.drum);m.rope=M(new T.CylinderGeometry(.025,.025,1,6),plastic("#f4f0e0",{roughness:.8}),0,0,0);add(m.rope);m.gm={};mSync(m)}

function buildMissions(R: any){W.missions=[];(R.missions||[]).forEach(function(d: any){var m: Mission={type:d.type,x:d.x,free:!!d.free,done:false};if((d.tier===2||d.tier===3)&&!(S.ms[mid(m)]&&S.ms[mid(m)].tier))S.ms[mid(m)]=Object.assign({},S.ms[mid(m)],{tier:d.tier});m.done=!!S.mdone[mid(m)];if(d.type==="bridge")mBridge(m);else if(d.type==="lift")mLift(m);else if(MT[d.type])MT[d.type]!.build(m);else return;if(m.done&&m.chest){m.chest.userData.lid.rotation.x=-1.9;m.chest.userData.glow.visible=false;m.opened=true}W.missions.push(m)})}
function mBounds(): [number, number]{var nb=(!ED.on&&!ED.testing)?townNeighbors(S.world):null,lo=nb?.2:.5,hi=nb?44.6:43.5,pk=activePerk(),skim=!!(pk&&pk.waterSkim);(W.missions||[]).forEach(function(m: Mission){if(m.type==="bridge"&&!m.done&&!skim)hi=Math.min(hi,m.x-1.75);if(MT[m.type]&&!m.done&&!(skim&&(m.type==="measure"||m.type==="raft")))hi=Math.min(hi,MT[m.type]!.hold(m));if(m.type==="lift"){var px=m.px;if(!m.done)hi=Math.min(hi,px);else{var on=Math.abs(P.pos.x-px)<1.0;if(on||P.pos.x>=px){if(m.py>.05)lo=Math.max(lo,px-.9);if(m.py<2.55)hi=Math.min(hi,px+.9)}}}});return [lo,hi]}
function walkTo(x: number): Promise<boolean>{return new Promise(function(res){autoWalk=true;P.target=new T.Vector3(x,0,0);var last=P.pos.x,still=0,lf=FR,iv=setInterval(function(){if(!P.target||Math.abs(P.pos.x-x)<.08){clearInterval(iv);P.target=null;autoWalk=false;res(true);return}if(FR===lf)return;lf=FR;if(Math.abs(P.pos.x-last)<.003){if(++still>60){clearInterval(iv);P.target=null;autoWalk=false;res(false)}}else{still=0;last=P.pos.x}},30)})}

function mUpdate(dt: number){if(!P.showcase&&!P.mDrive)P.elev=0;if(!W.missions)return;var t=performance.now()/1000,near: Mission | null=null,pk=activePerk(),skim=!!(pk&&pk.waterSkim);W.missions.forEach(function(m: Mission){
 if(m.type==="lift"){var px=m.px,on=Math.abs(P.pos.x-px)<1.0;if(m.done&&!P.mDrive&&on){var want=P.target?(P.target.x>px?2.6:0):(m.py>1.3?2.6:0);m.py+=Math.max(-dt*1.6,Math.min(dt*1.6,want-m.py))}m.plat.position.y=m.py;
  if(!P.showcase)P.elev=P.pos.x>=px+.95?2.6:on?m.py:0;var w=m.crankW||0;if(w){m.drv.rotation.z-=w*dt;var a=m.drv.rotation.z,r=.34;if(m.gm.mid){var rm=GR[mst(m).mid]!;m.gm.mid.rotation.z=-a*r/rm+Math.PI/10;a=-a*r/rm;r=rm}if(m.gm.drum){m.gm.drum.rotation.z=-a*r/GR[mst(m).drum]!+Math.PI/10}}
  var top=m.gy-.18,bot=m.py+1.6,ropeX=m.dx+.18+(m.slack?Math.sin(t*12)*.08:0);if(m.drum.visible&&bot<top){m.rope.visible=true;m.rope.position.set(ropeX,(top+bot)/2,-1.05);m.rope.scale.set(1,top-bot,1)}else m.rope.visible=false}
 if(m.type==="bridge"&&m.done&&!P.showcase&&Math.abs(P.pos.x-m.x)<1.7)P.elev=.24;
 if(skim&&!P.showcase&&((m.type==="bridge"&&Math.abs(P.pos.x-m.x)<1.7)||(m.type==="measure"&&Math.abs(P.pos.x-m.x)<2.2)||(m.type==="raft"&&Math.abs(P.pos.x-(m.x+1.9))<2.3)))P.elev=Math.max(P.elev||0,.22);
 if(m.chest&&!m.opened&&m.done&&P.pos.x>m.chest.position.x-.8&&(m.type!=="lift"||P.elev>2.5)){m.opened=true;mReward(m)}
 if(m.chest){var lid=m.chest.userData.lid;if(m.opened&&lid.rotation.x>-1.9)lid.rotation.x=Math.max(-1.9,lid.rotation.x-dt*4);m.chest.userData.glow.material.opacity=.5+.3*Math.sin(t*3)}
 if(MT[m.type]&&MT[m.type]!.upd)MT[m.type]!.upd!(m,dt);var z0=m.type==="lift"?3.2:(m.type==="logic"||m.type==="clean")?4.4:3.4,z1=m.type==="lift"?1.6:m.type==="raft"?1.2:.5;if(!P.showcase&&!P.busy&&!P.mDrive&&P.pos.x>m.x-z0&&P.pos.x<m.x+z1&&Math.abs(P.pos.z-((m as any).z||0))<2.2)near=m});
 if(near!==mUpdateCur&&!(learnRun&&curMission&&curMission.type==="learn")){mUpdateCur=near;if(near&&(near as Mission).dismissed!==true)mPanel(near);else{mpOpen=false;notify()}}
 if(!near)W.missions.forEach(function(m: Mission){if(Math.abs(P.pos.x-m.x)>5)m.dismissed=false})}
function binLine(){var parts=["Scrap "+(S.scrap||0)];Object.keys(TOOLS).forEach(function(k){if(S.bin[k])parts.push(TOOLS[k]!.n+" "+S.bin[k])});return parts.join("  ·  ")}
function mPanel(m: Mission){if(MT[m.type]){mtPanel(m);return}var D=MDEF[m.type]!;if(m.done&&!m.replaying){mReplayPrompt(m,D.t);return}curMission=m;mpOpen=true;mpStamp=mpData(m);notify();return}
function curM(){return curMission}
async function bridgeTest(m: Mission){var st=mst(m);P.mDrive=true;mpOpen=false;notify();
 if(!st.deck){mFailNote(m);await walkTo(m.x-1.75);await mWait(.4);toast("There is nothing to drive on yet. Put a beam across the river.");P.mDrive=false;mUpdateCur=null;return}
 await walkTo(m.x-.1);if(!st.support){mFailNote(m);var pk=m.plank,T0=mTier(m);fx.push({t:0,d:.6,f:function(k){pk.position.y=.14-.4*k;pk.rotation.z=Math.sin(k*Math.PI*3)*.05;P.elev=-.3*k}});await mWait(.9);toast(T0<2?"It sags in the middle! Something stiff underneath would help.":T0<3?"It sags in the middle. It didn't hold.":"It sagged.");
  if(!S.bp.brace&&T0<2){S.bp.brace=1;save();await mWait(1.6);toast("New blueprint: Triangle brace. Triangles keep their shape. Forge one in the Factory.")}
  await walkTo(m.x-1.9);fx.push({t:0,d:.4,f:function(k){pk.position.y=-.26+.4*k;pk.rotation.z=0}});P.elev=0;P.mDrive=false;mUpdateCur=null;return}
 m.done=true;S.mdone[mid(m)]=1;mWinNote(m);save();sfx.found();toast("The triangle holds it straight. The bridge works!");await walkTo(m.x+1.9);P.mDrive=false;await walkTo(m.x+2.5)}
async function liftTurn(m: Mission){var st=mst(m),T0=mTier(m);P.mDrive=true;mpOpen=false;notify();if(Math.abs(P.pos.x-m.px)>.2)await walkTo(m.px);P.spin=0;
 m.crankW=4;var msg="";if(!st.drum){await mWait(1.3);msg=T0<2?"The crank turns, but nothing turns the rope drum. Put a gear in the drum slot.":T0<3?"The crank turns, but nothing moves.":"Nothing moved."}
 else if(st.mid){m.slack=true;await mWait(1.5);m.slack=false;msg=T0<2?"The drum turns the wrong way, so the rope unwinds. Every gear flips the direction. Take the middle gear out.":T0<3?"Wrong direction. Check your gears.":"Wrong direction."}
 else if(st.drum==="sgear"){await new Promise<void>(function(res){fx.push({t:0,d:1.4,f:function(k){m.py=.4*Math.sin(Math.PI*Math.min(1,k*1.6))},end:res})});m.py=0;msg=T0<2?"Too heavy! A small gear is fast but weak. A big gear on the drum is slower but stronger.":T0<3?"Too heavy for that gear.":"Still too heavy."}
 else{await new Promise<void>(function(res){fx.push({t:0,d:2.6,f:function(k){m.py=2.6*k},end:res})});m.crankW=0;m.done=true;S.mdone[mid(m)]=1;mWinNote(m);save();sfx.found();toast("Slow and strong: the big gear lifted you!");P.mDrive=false;await walkTo(44.4);return}
 mFailNote(m);m.crankW=0;if(msg)toast(msg);P.mDrive=false;mUpdateCur=null}
function mReward(m: Mission){var R=(MT[m.type]||MDEF[m.type]!).rew;R.bp.forEach(function(k: string){S.bp[k]=1});scrapGain(R.scrap);save();joy();confetti();$("#mr-l").textContent=R.txt+" Plus "+R.scrap+" scrap.";var c=$("#mr");c.hidden=false;c.classList.remove("on");void c.offsetWidth;c.classList.add("on")}
function setForge(on: boolean){B.forge=on;hostEl.classList.toggle("forging",on);notify()}

$("#mr-f").addEventListener("click",function(){$("#mr").hidden=true;openSheet();setForge(true)});
$("#mr-x").addEventListener("click",function(){$("#mr").hidden=true});
var TWHY: Record<string, string>={"spanner>screw":"That’s a screw with a slot. The screwdriver fits it.","hammer>screw":"Hammers pull nails. This is a screw, so turn it with the screwdriver.",
 "screwdriver>bolt":"This bolt has six sides and no slot. The spanner turns it.","hammer>bolt":"Bolts don’t pull out. Turn it with the spanner.",
 "screwdriver>nail":"Nails have no slot to turn. Pull it out with the claw hammer.","spanner>nail":"A nail has no sides to grip. Pull it out with the claw hammer."};
var TSVG: Record<string, string>={screwdriver:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 10 L20 4" stroke="#cfd8ff" stroke-width="2.6" stroke-linecap="round"/><rect x="5" y="11" width="6" height="11" rx="2.5" transform="rotate(45 8 16.5)" fill="#ff5a4d"/></svg>',
 spanner:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 L15 9" stroke="#b8c2e6" stroke-width="4" stroke-linecap="round"/><path d="M14 6 a4 4 0 1 0 4 4 l-3 0 l-1 -1 z" fill="#b8c2e6"/></svg>',
 hammer:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20 L14 9" stroke="#c98a4a" stroke-width="3" stroke-linecap="round"/><rect x="9" y="3" width="11" height="6" rx="1.5" transform="rotate(33 14.5 6)" fill="#b8c2e6"/></svg>',
 drill:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="13" height="7" rx="3" fill="#ffd24d"/><rect x="6" y="13" width="5" height="8" rx="2" fill="#2a3566"/><path d="M16 10.5 L22 10.5" stroke="#cfd8ff" stroke-width="2" stroke-linecap="round"/></svg>',
 box:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="11" rx="2" fill="#ff9d5c"/><path d="M8 9 V6 h8 v3" fill="none" stroke="#ff9d5c" stroke-width="2.4"/><rect x="3" y="12" width="18" height="2" fill="#c96a3a"/></svg>'};
function toolMesh(k: string){var g=new T.Group(),mt=metal("#cfd8ff");
 if(k==="screwdriver"){var h=M(new T.CylinderGeometry(.065,.075,.32,14),plastic("#ff5a4d"),0,0,.42);h.rotation.x=Math.PI/2;g.add(h);var s=M(new T.CylinderGeometry(.02,.02,.3,8),mt,0,0,.13);s.rotation.x=Math.PI/2;g.add(s)}
 else if(k==="spanner"){g.add(M(rbox(.09,.6,.04,.02),mt,0,-.34,.1));var hd=M(new T.TorusGeometry(.12,.035,8,16,Math.PI*1.5),mt,0,0,.1);hd.rotation.z=Math.PI*.75;g.add(hd)}
 else{var hd2=new T.Group();hd2.position.z=.12;hd2.add(M(new T.CylinderGeometry(.035,.04,.62,8),plastic("#c98a4a"),.1,-.32,0));hd2.add(M(rbox(.36,.13,.13,.03),mt,.1,0,0));var cl=M(new T.TorusGeometry(.08,.025,6,10,Math.PI),mt,-.12,.02,0);cl.rotation.z=Math.PI;hd2.add(cl);g.add(hd2);g.userData.hd=hd2}
 linearize(g);return g}
function toolAnim(g: THREE.Object3D,k: string){var p=g.getWorldPosition(new T.Vector3()),m=toolMesh(k);m.position.copy(p);scene.add(m);toolSound(k);var hd=m.userData.hd;fx.push({t:0,d:.62,f:function(q){if(k==="hammer"){hd.rotation.z=.6*Math.sin(Math.PI*q);m.position.z=p.z+q*.5}else m.rotation.z=-q*Math.PI*3},end:function(){scene.remove(m)}})}
function toolHint(ft: string){var need=FITS[ft]!;sfx.bump&&sfx.bump();if(!S.tool){toast("This is a "+FTN[ft]+". Pick the "+TK[need]!.n.toLowerCase()+" from your tool belt.");beltOpen(true);return}
 toast(TWHY[S.tool+">"+ft]||("The drill makes holes. To take out this "+FTN[ft]+", use the "+TK[need]!.n.toLowerCase()+"."));var b=$("#beltb");b.classList.remove("nudge");void b.offsetWidth;b.classList.add("nudge")}
function beltIcon(){$("#belt-ic").innerHTML=TSVG[S.tool||"box"]||"";$("#beltb").setAttribute("aria-label","Tool belt, holding "+((S.tool&&TK[S.tool])?TK[S.tool]!.n:"nothing"))}
function beltOpen(on: boolean){$("#belt").hidden=!on;$("#beltb").setAttribute("aria-expanded",String(on));if(on)$$("#belt [data-tool]").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.tool===S.tool))})}
$("#belt").innerHTML=Object.keys(TK).map(function(k){return '<button type="button" data-tool="'+k+'" aria-pressed="false">'+(TSVG[k]||"")+'<span>'+TK[k]!.n+'</span></button>'}).join("");
$("#beltb").addEventListener("click",function(){ctx();beltOpen($("#belt").hidden)});
$$("#belt [data-tool]").forEach(function(b){b.addEventListener("click",function(){S.tool=b.dataset.tool;save();beltIcon();beltOpen(false);sfx.pop();toast(TK[S.tool]!.n+" ready. "+TK[S.tool]!.say)})});
function setZoom(z: number){S.zoom=Math.max(0,Math.min(2,z));save();sfx.pop()}
var zwT=0;canvas.addEventListener("wheel",function(e: WheelEvent){if(ED.on||P.showcase)return;e.preventDefault();var n=performance.now();if(n-zwT<280)return;zwT=n;setZoom((S.zoom||0)+(e.deltaY>0?1:-1))},{passive:false});
winOn("keydown",function(e){if(paused||ED.on||P.showcase)return;var tg=e.target&&e.target.tagName;if(tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT")return;if((e.key||"").toLowerCase()==="z"){setZoom(((S.zoom||0)+1)%3);toast("Zoom: "+(ZN[S.zoom]||""))}});
if(!S.tool)S.tool="screwdriver";if(S.zoom==null)S.zoom=0;beltIcon();

/* ===== Create mode: kids describe a world, Muse (or a word parser) builds it, they test and tweak ===== */
var CR={busy:false,code:false};
/* the in-game model is Meta Muse Spark, reached through the ToyVentor Worker; with no Worker (this prototype) the word parser builds worlds */
var MUSE={url:window.TOYVENTOR_MUSE_URL||(/(^|\.)toyventor\.com$|\.workers\.dev$|^localhost$|^127\./.test(location.hostname)?"/api/muse/spark":null),model:"muse-spark"};
async function museJSON(prompt: string): Promise<any>{if(!MUSE.url)return null;var ctl=new AbortController(),tm=setTimeout(function(){ctl.abort()},18000);try{var r=await fetch(MUSE.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:MUSE.model,input:prompt,format:"json"}),signal:ctl.signal});if(!r.ok)return null;var j: any=await r.json();if(j&&j.recipe)return j;var txt=j&&(j.output_text||j.text);if(!txt)return null;var a=txt.indexOf("{"),b=txt.lastIndexOf("}");return a>=0?JSON.parse(txt.slice(a,b+1)):null}catch(e){return null}finally{clearTimeout(tm)}}
var WT: Record<string, string[]>={garden:["garden","flower","grass","park"],sky:["sky","cloud world","meadow","flying"],junk:["junk","scrap","junkyard"],beach:["beach","sea","sand","ocean","seaside"],snow:["snow","ice","winter","icy","frozen"],room:["toy room","bedroom","room","house","home"]};
var WP: Record<string, string[]>={snowman:["snowman","snowmen"],pine:["pine tree","pine","fir","christmas tree"],igloo:["igloo"],palm:["palm tree","palm"],umbrella:["umbrella"],sandcastle:["sandcastle","castle"],lantern:["lantern","light"],tree:["tree"],bushes:["bush"],windmill:["windmill"],cottage:["cottage","cabin"],cloud:["cloud"],island:["floating island"],tire:["tire","tyre"],drum:["drum","oil barrel"],shed:["shed"],cranebg:["crane"],lamp:["lamp"],blocks:["block"],books:["book"],chair:["chair"],plant:["plant","flower pot"],teddy:["teddy bear","teddy"],ball:["ball"],cushions:["cushion","pillow"]};
var WH: Record<string, string[]>={glow:["cave","dark","shadow","under the bed"],speed:["tower","ledge","shelf","high","branch","up high"],torque:["ball","rock","snowball","boulder","push"],spin:["pile","drift","pond","sock","mound"],junk:["machine","robot","radio","jack","scarecrow","kite","cannon"]};
var NUM: Record<string, number>={one:1,a:1,an:1,two:2,three:3,four:4,five:5,six:6,lots:5,many:5,some:3,loads:6};
function crNum(txt: string,i: number): number{var w=txt.slice(Math.max(0,i-14),i).trim().split(/\s+/).slice(-2);for(var j=w.length-1;j>=0;j--){var t=(w[j]||"").toLowerCase();if(/^\d+$/.test(t))return Math.min(8,+t);if(NUM[t]!=null)return NUM[t]!;var prev=w[j-1];if(t==="of"&&prev&&NUM[prev.toLowerCase()]!=null)return NUM[prev.toLowerCase()]!}return 1}
function crFreeX(R: any,avoid?: number[]): number{var best=2,bd=-1;for(var x=2;x<=44;x+=.5){var d=99;R.props.forEach(function(p: any){d=Math.min(d,Math.abs(p.x-x))});(avoid||[]).forEach(function(a: number){d=Math.min(d,Math.abs(a-x)*.8)});R.spots.forEach(function(s: any){d=Math.min(d,Math.abs(s.x-x)*.7)});if(d>bd){bd=d;best=x}}return best}
function crSpotX(R: any): number | null{for(var x=6;x<=42;x+=.5){if(R.spots.every(function(s: any){return Math.abs(s.x-x)>=4}))return x}return null}
function crPl(w: string,n: number): string{if(n<2)return w;if(/man$/.test(w))return w.replace(/man$/,"men");if(/s$/.test(w))return w;return w+"s"}
function crParse(text: string,R0: any){var t=" "+text.toLowerCase()+" ",R=JSON.parse(JSON.stringify(R0)),said: string[]=[];
 if(/\b(new|start again|start over)\b/.test(t))R={format:"toyventor.level/1",id:"kid-world",name:"My world",theme:R.theme,props:[],spots:[]};
 for(var th in WT)if(WT[th]!.some(function(w){return t.indexOf(w)>=0})){if(R.theme!==th){R.theme=th;said.push("made it "+TNAME[th])}break}
 var pairs: Array<[string, string]>=[];for(var kk in WP)WP[kk]!.forEach(function(w){pairs.push([kk,w])});pairs.sort(function(x,y){return y[1].length-x[1].length});var seen: Record<string, number>={},tt=t;
 for(var pi=0;pi<pairs.length;pi++){var k=pairs[pi]![0],w0=pairs[pi]![1],hit=tt.indexOf(w0);if(hit<0||seen[k])continue;seen[k]=1;tt=tt.split(w0).join(new Array(w0.length+1).join("#"));var neg=/\b(no|remove|without|take away|fewer|less)\s+(\w+\s+)?$/.test(t.slice(Math.max(0,hit-22),hit));
  if(neg){var before=R.props.length;R.props=R.props.filter(function(p: any){return p.type!==k});if(R.props.length<before)said.push("took away the "+crPl(PROPS[k]!.n.toLowerCase(),2));continue}
  var n=crNum(t,hit);if(/more\s+$/.test(t.slice(Math.max(0,hit-8),hit)))n=Math.max(n,2);for(var q=0;q<n&&R.props.length<16;q++)R.props.push({type:k,x:crFreeX(R)});said.push("added "+n+" "+crPl(PROPS[k]!.n.toLowerCase(),n))}
 for(var kind in WH){if(!WH[kind]!.some(function(w){return t.indexOf(w)>=0}))continue;if(R.spots.length>=SPOT_COUNT)break;var hk=HKIND.filter(function(h){return h[0]===kind})[0]!,hide=hk[3][THEMES[R.theme]||0]!,x=kind==="junk"?6:crSpotX(R);if(kind==="junk"&&R.spots.some(function(s: any){return Math.abs(s.x-6)<4}))x=crSpotX(R);if(x==null)continue;var used: Record<string, number>={};R.spots.forEach(function(s: any){used[s.part]=1});var part=Object.keys(PART).filter(function(p){return PART[p]!.st!=="none"&&!used[p]})[(R.spots.length*7)%40]||edFreePart();R.spots.push({part:part,hide:hide,x:x});said.push("hid a part in the "+HIDE[hide]!.n.toLowerCase())}
 return {recipe:R,say:said.length?("I "+said.join(", ")+"."):"I didn’t catch that. Try words like snow, three snowmen, or a cave to hide a part."}}
function crClean(R: any,prev: any): any{if(!R||typeof R!=="object")return null;var out: any={format:"toyventor.level/1",id:"kid-world",name:String(R.name||prev.name||"My world").slice(0,30),theme:THEMES[R.theme]!=null?R.theme:prev.theme,props:[],spots:[]};
 (Array.isArray(R.props)?R.props:[]).forEach(function(p: any){if(p&&PROPS[p.type]&&isFinite(p.x)&&out.props.length<16)out.props.push({type:p.type,x:Math.round(Math.max(0,Math.min(45,+p.x))*2)/2})});
 var used: Record<string, number>={};(Array.isArray(R.spots)?R.spots:[]).forEach(function(s: any){if(s&&HIDE[s.hide]&&PART[s.part]&&PART[s.part]!.st!=="none"&&!used[s.part]&&isFinite(s.x)&&out.spots.length<SPOT_COUNT){used[s.part]=1;out.spots.push({part:s.part,hide:s.hide,x:Math.max(4,Math.min(42,+s.x))})}});
 out.spots.sort(function(a: any,b: any){return a.x-b.x});for(var i=1;i<out.spots.length;i++)if(out.spots[i].x-out.spots[i-1].x<4)out.spots[i].x=out.spots[i-1].x+4;out.spots=out.spots.filter(function(s: any){return s.x<=42});out.spots.forEach(function(s: any){s.x=Math.round(s.x*2)/2});
 if(out.spots.length&&!out.spots.some(function(s: any){return HIDE[s.hide]!.t==="junk"&&s.x<=10})){var jh=HKIND[0]![3][THEMES[out.theme]||0]!;if(out.spots[0].x<=10)out.spots[0].hide=jh;else if(out.spots[0].x>=10)out.spots.unshift({part:edFreePart(),hide:jh,x:6})}
 return out}
var CR_INSTR=function(R: any,said: string){var props=Object.keys(PROPS).map(function(k){return k+" ("+PROPS[k]!.n+")"}).join(", "),hides=HKIND.map(function(h){return h[1]+": "+h[3].join(", ")}).join("; "),parts=Object.keys(PART).filter(function(k){return PART[k]!.st!=="none"}).join(", ");
 return "You help a young child build a world in the ToyVentor game by turning their words into a level recipe. Reply with JSON only, no other text: {\"say\": a short, warm sentence for a child (at most 20 words) saying what you changed, \"recipe\": the full updated recipe}.\nRecipe format: {\"format\":\"toyventor.level/1\",\"id\":\"kid-world\",\"name\":short world name,\"theme\":one of garden, sky, junk, beach, snow, room,\"props\":[{\"type\":prop type,\"x\":number}],\"spots\":[{\"part\":part key,\"hide\":hiding spot,\"x\":number}]}.\nThe path runs from x 0 to x 45. Prop types: "+props+".\nHiding spots by kind: "+hides+". A junk machine is unscrewed; the others are revealed with moves.\nPart keys: "+parts+".\nRules: use only the listed types and keys; keep spots between x 4 and 42 and at least 4 apart; use exactly "+SPOT_COUNT+" spots with different parts when you add or change hiding spots (if the child did not ask about hiding spots, keep the current spots exactly as they are); put one junk machine before x 10; use at most 16 props; keep everything the child did not ask to change; if the request is unclear or not about the world, keep the recipe and say so kindly.\nCurrent recipe: "+JSON.stringify(R)+"\nThe child said: \""+String(said).slice(0,160).replace(/"/g,"'")+"\""};
async function crMake(text: string){text=(text||"").trim();if(!text||CR.busy)return;CR.busy=true;crSay="Building your world…";notify();var res: { recipe: any; say: string } | null=null,prev=ED.R;
 if(MUSE.url){var v=await museJSON(CR_INSTR(prev,text));if(v&&v.recipe){var c=crClean(v.recipe,prev);if(c)res={recipe:c,say:String(v.say||"Here is your world!").slice(0,160)}}}
 if(!res){var pr=crParse(text,prev);res={recipe:crClean(pr.recipe,prev)||prev,say:pr.say}}
 edPush();ED.R=res.recipe;ED.sel=null;syncEdInputs();edApply();crSay=res.say;crInput="";sfx.found();CR.busy=false;notify()}
function crUI(on: boolean){hostEl.classList.toggle("creating",on);if(on){EDX.setBackLabel("Back to making")}notify()}
function crEnter(){ED.kid=true;var R: any=null;try{R=JSON.parse(localStorage.getItem("tvCreate")||"null")}catch(e){}if(!edValid(R))R={format:"toyventor.level/1",id:"kid-world",name:"My world",theme:"garden",props:[{type:"tree",x:3},{type:"lantern",x:12}],spots:[{part:"character.hat.flower",hide:"scarecrow",x:6}]};ED.R=R;ED.undo=[];ED.redo=[];edEnter();crUI(true);crSay="Tell me your world! Type, talk, or tap the picture words, then press Make it.";notify()}
function crExit(){crUI(false);ED.kid=false;edExit();ED.R=null;EDX.setBackLabel("Back to editor");notify()}
/* ===== STEM playground missions in 2.5D: measure, balance, logic door, raft ===== */
var MS=createMissions({S:S as any,P:P as any,get W(){return W as any},fx:fx,$:$,$$:$$,toast:toast,save:save,notify:notify,updHud:updHud,creStats:creStats,mPanel:mPanel,mtPanel:mtPanel,mReplayPrompt:mReplayPrompt,mtFail:mtFail,walkTo:walkTo,hop:hop,soapWin:soapWin,joy:joy,mpPress:mpPress,mpHide:function(){mpOpen=false},add:add,resetNear:function(){mUpdateCur=null},darkSprite:darkSprite,rockMesh:rockMesh,chestMesh:chestMesh,setTimeout:setTimeout,onWin:onLearnWin});var MT=MS.MT,mid=MS.mid,mTier=MS.mTier,tq=MS.tq,mkk=MS.mkk,mst=MS.mst,mFailNote=MS.mFailNote,mWinNote=MS.mWinNote,mStartReplay=MS.mStartReplay,mCancelReplay=MS.mCancelReplay,clearG=MS.clearG,mtWin=MS.mtWin,mSync=MS.mSync,mWait=MS.mWait,prRounds=MS.prRounds,faceGear=MS.faceGear,textSprite=MS.textSprite,riverAt=MS.riverAt,flyAway=MS.flyAway;
void [mkk,clearG,mtWin,textSprite,riverAt,flyAway];
MT.learn={t:"Learn",goal:"",actL:"Say it again",rew:{bp:[],scrap:0,txt:""},st:function(m: Mission){var s=mst(m);if(s.step==null)s.step=0;return s},build:function(){},sync:function(){},hold:function(m: Mission){return m.x},act:function(m: Mission){var def=learnRungDef(mid(m));if(def){var sd2=def.steps[Math.min(mst(m).step||0,def.steps.length-1)]!;toast(sd2.say)}}};


function mtPanel(m: Mission){var T0=MT[m.type]!;if(m.done&&!m.replaying){mReplayPrompt(m,T0.t);return}curMission=m;mpOpen=true;mpStamp=mpData(m);notify()}
function mtFail(_m: Mission){P.mDrive=false;mUpdateCur=null}

;
;
;
;

function burst(p: THREE.Vector3,_col?: string,_n?: number){for(var i=0;i<14;i++){(function(i){var sp=glowSprite("rgba(255,255,255,1)",.25);sp.position.set(p.x,p.y+.2,p.z);add(sp);var a=i/14*Math.PI*2;fx.push({t:0,d:.6,f:function(k){sp.position.set(p.x+Math.cos(a)*k*.8,p.y+.2+Math.sin(Math.PI*k)*.6,p.z+Math.sin(a)*k*.4);sp.material.opacity=1-k},end:function(){if(sp.parent)sp.parent.remove(sp)}})})(i)}}
/* ===== STEM playground, part 2: lever, circuit, code cards, pattern lock, clean-up ===== */
function hop(x0: number,x1: number,h: number,d?: number): Promise<void>{return new Promise<void>(function(res){fx.push({t:0,d:d||.5,f:function(k){P.pos.x=x0+(x1-x0)*k;P.elev=Math.sin(Math.PI*k)*h},end:function(){P.elev=0;res()}})})}

;
;
;

;
function soapWin(m: Mission): [number, number]{var t=mTier(m);return t===3?[3,3]:t===2?[2,2]:[2,3]}
;

/* ---------- toy contract: the app hands over the kid's own build ---------- */
/* Wire format toyventor.toy/1, base64url in the page hash (#toy=...). The
   app sends the toy type, the game part keys for the slots the kid filled,
   and the paint colors ("" keeps the game's paint). A contract with the
   wrong shape is refused whole, never applied halfway: bad contract in,
   stock toy out. Unknown part keys inside a good contract are skipped. */
function toyB64(s: string): any{try{var p=String(s).replace(/-/g,"+").replace(/_/g,"/");while(p.length%4)p+="=";var b=atob(p),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return JSON.parse(new TextDecoder("utf-8").decode(u))}catch(e){return null}}
void toyB64;
function toyApply(c: any): any{if(!c||c.format!=="toyventor.toy/1")return null;if(c.type!=="character"&&c.type!=="robot"&&c.type!=="vehicle")return null;if(!Array.isArray(c.parts))return null;var col=c.col;if(!col||typeof col!=="object")return null;var colOk=true;["c1","c2","skin"].forEach(function(z){var v=col[z];if(v!==""&&!/^#[0-9a-f]{6}$/i.test(v||""))colOk=false});if(!colOk)return null;
 var targetType: "character" | "vehicle"=c.type==="vehicle"?"vehicle":"character",sameToy=S.toyId&&c.id&&S.toyId===c.id;
 var sl: Record<string, string>=(sameToy&&!c.parts.length&&S.sel[targetType])?S.sel[targetType]:stockSel()[targetType];
 if(!sameToy)S.col=c.id==="seed-kip"?{c1:"#ffd24d",c2:"#52b7ff",skin:"#f2b98c"}:stockCol();
 c.parts.forEach(function(k: string){var p=PART[k];if(!p)return;if(targetType==="character"&&ROBOT_TO_KIP[k]){sl[ROBOT_TO_KIP[k]!.slot]=k;S.found[k]=true;return}if(p.t!==targetType)return;sl[p.s]=p.id;S.found[k]=true});
 S.type=targetType;S.toyId=c.id||S.toyId;S.sel[targetType]=sl;["c1","c2","skin"].forEach(function(z){if(/^#[0-9a-f]{6}$/i.test(col[z]||""))S.col[z]=col[z]});return c}
function toyFromURL(){var c=options.contract?toyApply(JSON.parse(JSON.stringify(options.contract))):null;if(!c)return null;save();return c}
/* ---------- boot ---------- */
["character","robot","vehicle"].forEach(function(t){var sl: Record<string, string> | undefined=S.sel[t];if(!sl)return;for(var q in sl){var kk=slotPartKey(t,q,sl[q]!);if(PART[kk]&&PART[kk]!.w&&!S.found[kk])S.found[kk]=true}});
toyFromURL();
mInit();
if(!WORLDS[S.world])S.world="garden";
setupPost(hostEl.clientWidth,hostEl.clientHeight);buildFactory();buildWorld(S.world);buildPlayer(null);moves();resize();
P.title=true;P.showcase=true;P.pos.set(FX,0,0);cam.x=FX;facA=-.55;hostEl.classList.add("titled");S.started=true;startPlay(false);var loadEl=$("#load");if(loadEl)loadEl.hidden=true;notify();
function startPlay(build: boolean){if(!P.title)return;P.title=false;S.started=true;save();hostEl.classList.remove("titled");ctx();musInit();MUS.on=true;musGain(sound?.7:0,1.2);
 if(build){P.pos.set(2,0,0);P.showcase=false;openSheet();return}
 camera.clearViewOffset();P.showcase=false;P.pos.set(2,0,0);P.face=P.tface=0;cam.x=3;flash();setTimeout(function(){showIntro(S.world)},250)}
setTimeout(function(){var ld=$("#load");if(ld)ld.classList.add("gone")},150);
rafId=requestAnimationFrame(frame);

const handle: WorldRuntimeHandle = { MT:MT,Wm:function(){return W.missions},cr:{enter:crEnter,make:crMake,exit:crExit,R:function(){return ED.R},CR:CR},ed:{ED:ED,enter:edEnter,play:edPlay,back:edBack,exit:edExit,checks:function(){return edChecks(ED.R)},scr:function(x,y){var v=new T.Vector3(x,y,0).project(camera),r=canvas.getBoundingClientRect();return [(v.x+1)/2*r.width+r.left,(1-v.y)/2*r.height+r.top]}},face:function(a){facA=a},start:startPlay,composer:function(){return !!composer},P:P,spots:spots,bolts:bolts,ability:ability,S:S,unbolt:unbolt,go:function(w){switchWorld(w)},buildSummary:buildSummary,setLoanKeys:setLoanKeys,portraitSig:function(){return P.rigReady?String(P.rigSig):null},capturePortrait:toyPortrait,playSeed:playSeed,worldName:function(id: string){var wd=WORLDS[id];return wd?wd.n:id},open:openSheet,close:closeSheet,
setToy:function(contract){ if(!contract){ S.type="character"; S.sel=stockSel(); S.col=stockCol(); S.toyId=null; buildPlayer(null); moves(); notify(); return; } var c=toyApply(JSON.parse(JSON.stringify(contract))); if(c){ buildPlayer(null); moves(); notify(); } },
seedDemo:function(){ mInit(); S.scrap=Math.max(S.scrap||0,12); S.bp.beam=1; S.bp.brace=1; S.bp.sgear=1; S.bp.bgear=1; S.bp.gearpair=1; S.bin.beam=Math.max(S.bin.beam||0,2); S.bin.brace=Math.max(S.bin.brace||0,2); S.bin.sgear=Math.max(S.bin.sgear||0,2); S.bin.bgear=Math.max(S.bin.bgear||0,2); delete S.mdone["garden.bridge"]; delete S.ms["garden.bridge"]; mpOpen=false; S.world="garden"; buildWorld("garden"); P.pos.set(6.5,0,0); P.target=null; P.elev=0; cam.x=7.5; save(); toast("Demo save ready in Garden."); notify(); },
getWorld:function(){return S.world},
setTier:function(t){t=t===2||t===3?t:1;var m=curM();if(!m||W.missions.indexOf(m)<0||P.busy||P.mDrive)return;var k=mid(m),cur=mTier(m);if(m.done&&!m.replaying){mStartReplay(m);S.ms[k]={tier:t};if(MT[m.type]){MT[m.type]!.st&&MT[m.type]!.st(m);MT[m.type]!.sync(m)}else mSync(m);save();mPanel(m);return}if(cur===t){mPanel(m);return}var old=S.ms[k]||{};if(!m.free&&!m.replaying){["deck","support","mid","drum"].forEach(function(sl){if(old[sl])S.bin[old[sl]]=(S.bin[old[sl]]||0)+1})}S.ms[k]={tier:t};if(MT[m.type]){MT[m.type]!.st&&MT[m.type]!.st(m);MT[m.type]!.sync(m)}else mSync(m);save();mPanel(m);},
setZoom:function(z){setZoom(z)},setPaused:function(v){paused=!!v;if(MUS.on)musGain(paused?0:(sound?.7:0),paused?.3:.8)},
mute:function(){muteAudio()},
startLearnRun:function(track,plan,kidMode){startLearnRunFn(track,plan,kidMode)},
stopLearnRun:function(){stopLearnRunFn()},
learnState:function(){return learnStateFn()},
mpSnap:function(){try{return mpSnap()}catch(e){return {open:false}}},
mpPress:function(i){var m=curM();if(!m||!mpStamp||!mpStamp.ctrls[i])return;var d=mpStamp.ctrls[i];if(d.disabled)return;mpPress(m,d.dataset);},
mpAct:function(a){if(a==="test")mpGo(curM());else if(a==="forge")mpForge();else mpLater(curM());},
cuSnap:function(){try{return cuSnap()}catch(e){return {open:false,scrap:0}}},
cuAct:function(a){cuAct(a)},
cuType:function(t){cuType(t)},
cuSlot:function(s){cuSlot(s)},
cuPart:function(id){cuPart(id)},
cuZone:function(z){cuZone(z)},
cuPaint:function(c){cuPaint(c)},
cuForgeTool:function(id){cuForgeTool(id)},
cuPrintTool:function(id){cuPrintTool(id)},
crSnap:function(){try{return crSnap()}catch(e){return {open:false}}},
crSubmit:function(t){crSubmit(t)},
crSetInput:function(t){crSetInput(t)},
crUndo:function(){crUndo()},
crKeep:function(){crKeep()},
crPlay:function(){crPlayM()},
crCodeToggle:function(){crCodeToggle()},
crMicStart:function(){crMicStart()},
crFromTitle:function(){crFromTitle()},
edSnap:function(){try{return edSnap()}catch(e){return {open:false}}},
edUndo:function(){edUndo()},
edRedo:function(){edRedo()},
edZoomBy:function(f){edZoomBy(f)},
edExport:function(){edExport()},
edImport:function(){edImport()},
edSetName:function(v){edSetName(v)},
edSetTheme:function(v){edSetTheme(v)},
edNew:function(v){edNew(v)},
edSetTab:function(t){edSetTab(t)},
edArm:function(i){edArm(i)},
edControl:function(i){edControl(i)},
edNudge:function(d){edNudge(d)},
edDelete:function(){edDelete()},
edDoneSel:function(){edDoneSel()},
edSetHide:function(v){edSetHide(v)},
edSetPart:function(v){edSetPart(v)},
edSetIoText:function(t){edSetIoText(t)},
edIoCopy:function(){edIoCopy()},
edIoLoad:function(){edIoLoad()},
edLoad:function(level){return edLoad(level)},
edIoClose:function(){edIoClose()},
edFromTitle:function(){edFromTitle()},
town:{neighbors:function(){return townNeighbors(S.world)},perk:activePerk,tidy:function(){return townSparkleProgress(S.tidy)},cross:streetCross,tidyNearest:function(){var best=tidySpots.filter(function(s){return !s.done})[0];return best?tidyUp(best):false}},
dispose:function(){ if(disposed)return; disposed=true; if(W.backdrop)W.backdrop.dispose(); disposeArtCache(bdArt); if(P.stlToken)P.stlToken.cancelled=true; cancelAnimationFrame(rafId); if(musTimer)clearInterval(musTimer); clearTimers(); ctrl.abort(); timer.dispose(); resetAudio(); try{ if(composer){ composer.passes.forEach(function(p: any){ if(p.dispose)p.dispose(); }); if(composer.renderTarget1)composer.renderTarget1.dispose(); if(composer.renderTarget2)composer.renderTarget2.dispose(); } }catch(e){} try{ scene.traverse(function(o: any){ if(o.geometry&&!o.geometry.userData.stlCached)o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(function(m: any){ for(var k in m){ var v=m[k]; if(v&&v.isTexture)v.dispose(); } if(m.dispose)m.dispose(); }); } }); clearStlRigCache(); if(scene.environment&&scene.environment.dispose)scene.environment.dispose(); disposeEnvironment(); renderer.dispose(); if(renderer.forceContextLoss)renderer.forceContextLoss(); }catch(e){} hostEl.innerHTML=""; } };
// Scoped sizing: host rect via ResizeObserver with window-resize fallback (winOn above).
resize();
try { const ro = new ResizeObserver(() => resize()); ro.observe(hostEl); const origDispose = handle.dispose; handle.dispose = () => { try{ro.disconnect();}catch{} origDispose(); }; } catch {}
if(import.meta.env?.DEV)(window as unknown as Record<string,unknown>).__tvWorld={handle:handle,mixGo:mixGo,getMix:function(){return mix},P:P,props:PFX,feed:FEED,sleep:SLEEPH,acts:ACTS,bubbles:BUBBLES,held:HELD,visit:function(){return sceneVisit?{at:sceneVisit.at,pending:sceneVisit.pending,done:sceneVisit.done,nudges:sceneNudges}:null}};
return handle;
}
