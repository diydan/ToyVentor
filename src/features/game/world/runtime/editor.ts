// Level editor (5A Unit 2e): ED state + every ed* action, lifted verbatim
// from world.ts. The engine contract (engine.ts openEditorNow/readEditor)
// is served from the returned api; world.ts keeps a live ED reference plus
// one binding per bare name its wiring still calls.
// NOTE: coord snapping is edSnapX; edSnap() is the engine snapshot (the two
// shared one name until Unit 2e — see edNudge regression test).
import * as THREE from "three";
import { T, linearize } from "./worldScene";
import {
  PART, PROPS, HIDE, THEMES, HKIND, KCOL, TYPES, STATS,
  WORLDS, levelWorld, type LevelDef, type LevelPropRef, type LevelSpotRef,
} from "./catalog";
import { ctx, sfx, MUS, musInit, musGain, sound } from "./audio";
import * as EDD from "./editorData";
import { checkLevel } from "./levelKit";

export interface EditorPin {
  kind: "spot" | "prop";
  i: number;
  s: THREE.Sprite;
  l: THREE.Line;
}

export interface EditorDrag {
  x0: number;
  y0: number;
  cx0: number;
  pin: EditorPin | null;
  moved: boolean;
  nx?: number;
}

export interface EditorSelection {
  kind: "spot" | "prop";
  i: number;
}

export interface EditorArm {
  kind: "spot" | "prop";
  t?: string;
  type?: string;
}

export interface EditorCheck {
  ok: boolean;
  n: string;
  why: string;
}

export interface EditorState {
  on: boolean; testing: boolean; kid?: boolean; cx: number; d: number;
  sel: EditorSelection | null; arm: EditorArm | null; undo: string[]; redo: string[];
  g: THREE.Group | null; pins: EditorPin[];
  tab: string; R: any; drag: EditorDrag | null; dSet?: boolean; prev?: string;
  found?: Record<string, boolean>; prevW?: string;
  [k: string]: any;
}

export interface EditorDeps {
  S: any;
  P: any;
  scene: any; camera: any; canvas: any; hostEl: any; cam: any;
  $: (sel: string) => any;
  $$: (sel: string) => any[];
  toast: (msg: string) => void;
  save: () => void;
  notify: () => void;
  flash: () => void;
  updHud: () => void;
  showIntro: (w: string) => void;
  buildWorld: (id: string) => void;
  crUI: (on: boolean) => void;
  rayAt: (x: number, y: number) => void;
  laneX: () => number | null;
}

export interface EditorApi {
  ED: EditorState;
  setBackLabel: (v: string) => void;
  esc: (s: any) => string;
  edBlank: (th: string) => LevelDef;
  edCopy: (id: string) => LevelDef;
  edEngine: (R: LevelDef) => any;
  edValid: (R: any) => R is LevelDef;
  edChecks: (R: LevelDef) => EditorCheck[];
  edSnapX: (x: number) => number;
  edSnap: () => any;
  edItem: (k: string, i: number) => any;
  edPush: () => void;
  edApply: (rebuild?: boolean) => void;
  edUndo: () => void;
  edRedo: () => void;
  pinTex: (col: string, glyph: string, sel: boolean) => THREE.CanvasTexture;
  txtSprite: (s: string, col: string, h: number) => THREE.Sprite;
  edMarkers: () => void;
  edFit: (units: number) => number;
  edZoom: (f: number) => void;
  edView: () => void;
  edEnter: () => void;
  edExit: () => void;
  edPlay: () => void;
  edBack: () => void;
  edFreePart: () => string;
  edPlace: (x: number) => void;
  edPick: (cx: number, cy: number) => EditorPin | null;
  edX: (e: { clientX: number; clientY: number }) => number | null;
  edPanel: () => void;
  syncEdInputs: () => void;
  edSetTab: (t: string) => void;
  edArmToggle: (a: EditorArm) => void;
  edArmDs: (arm: string, t: string, type: string) => void;
  edArm: (i: number) => void;
  edNudge: (dir: number) => void;
  edDelete: () => void;
  edDoneSel: () => void;
  edSetHide: (v: string) => void;
  edSetPart: (v: string) => void;
  edSetName: (v: string) => void;
  edSetTheme: (v: string) => void;
  edNew: (v: string) => void;
  edZoomBy: (f: number) => void;
  edExport: () => void;
  edImport: () => void;
  edIoClose: () => void;
  edIoCopy: () => void;
  edIoLoad: () => void;
  edLoad: (level: unknown) => boolean;
  edSetIoText: (t: string) => void;
  edControl: (i: number) => void;
  edFromTitle: () => void;
  edUp: (e: any) => void;
}

export function createEditor(deps: EditorDeps): EditorApi {
  var {S, P, scene, camera, canvas, hostEl, cam, $, toast, save, notify, flash, updHud, showIntro, buildWorld, crUI, rayAt, laneX} = deps;
var ED: EditorState = {on:false,testing:false,cx:22,d:26,sel:null,arm:null,undo:[],redo:[],g:null,pins:[],tab:"spots",R:null,drag:null};
function edBlank(th: string): LevelDef {return {format:"toyventor.level/1",id:"my-world",name:"My world",theme:th,props:[],spots:[]}}
function edCopy(id: string): LevelDef {var w=WORLDS[id]!;return {format:"toyventor.level/1",id:id+"-copy",name:w.n+" copy",theme:id,
 props:w.props.filter(function(p){return Boolean(PROPS[p[0]])}).map(function(p): LevelPropRef {var pr=PROPS[p[0]]!,o: LevelPropRef={type:p[0],x:p[1]};if(p[2]!==pr.z)o.z=p[2];if(typeof p[3]==="number"&&p[3]!==pr.y)o.y=p[3];return o}),
 spots:w.spots.map(function(s): LevelSpotRef {var hideKey=s.obj||s.cover||"",o: LevelSpotRef={part:s.k,hide:hideKey,x:s.x},h=HIDE[o.hide];if(h&&s.z!==h.z)o.z=s.z;return o}),missions:(w.missions||[]).slice()}}
function edEngine(R: LevelDef){var w=levelWorld(R);w.spots=w.spots.filter(function(s){return Boolean(PART[s.k])});return w}
function edValid(R: any): R is LevelDef {return Boolean(R&&R.format==="toyventor.level/1"&&THEMES[R.theme]!=null&&Array.isArray(R.props)&&Array.isArray(R.spots)&&R.props.every(function(p: any){return p&&PROPS[p.type]&&typeof p.x==="number"})&&R.spots.every(function(s: any){return s&&HIDE[s.hide]&&PART[s.part]&&typeof s.x==="number"}))}
// K3: the editor Checks ARE checkLevel — one shared bar for hand-made, composed, and Claude-drafted levels.
function edChecks(R: LevelDef): EditorCheck[] {return checkLevel(R)}
function edSnapX(x: number){return Math.round(Math.max(0,Math.min(45,x))*2)/2}
function edItem(k: string,i: number): any {if(!ED.R)return null;return k==="spot"?ED.R.spots[i]:ED.R.props[i]}
function edPush(){ED.undo.push(JSON.stringify(ED.R));if(ED.undo.length>60)ED.undo.shift();ED.redo=[]}
function edApply(rebuild?: boolean){if(!ED.R)return;try{localStorage.setItem(ED.kid?"tvCreate":"tvLevel",JSON.stringify(ED.R))}catch(e){}WORLDS.custom=edEngine(ED.R);if(rebuild!==false)buildWorld("custom");edMarkers();edPanel()}
function edUndo(){if(!ED.undo.length)return;ED.redo.push(JSON.stringify(ED.R));ED.R=JSON.parse(ED.undo.pop()!);ED.sel=null;edApply();sfx.pop()}
function edRedo(){if(!ED.redo.length)return;ED.undo.push(JSON.stringify(ED.R));ED.R=JSON.parse(ED.redo.pop()!);ED.sel=null;edApply();sfx.pop()}
var PINT: Record<string, THREE.CanvasTexture>={};function pinTex(col: string,glyph: string,sel: boolean){var k=col+glyph+sel;if(PINT[k])return PINT[k]!;var c=document.createElement("canvas");c.width=c.height=128;var g=c.getContext("2d")!;if(sel){g.fillStyle="rgba(255,210,77,.45)";g.beginPath();g.arc(64,54,58,0,Math.PI*2);g.fill()}g.fillStyle=col;g.beginPath();g.arc(64,54,40,0,Math.PI*2);g.fill();g.beginPath();g.moveTo(46,84);g.lineTo(82,84);g.lineTo(64,118);g.closePath();g.fill();g.lineWidth=5;g.strokeStyle="#06122b";g.beginPath();g.arc(64,54,40,0,Math.PI*2);g.stroke();g.fillStyle="#06122b";g.font="800 42px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(glyph,64,57);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;PINT[k]=tx;return tx}
function txtSprite(s: string,col: string,h: number){var c=document.createElement("canvas");c.width=256;c.height=64;var g=c.getContext("2d")!;g.fillStyle=col||"#bfcaf5";g.font="700 34px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(s,128,34);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;var sp=new T.Sprite(new T.SpriteMaterial({map:tx,depthTest:false,transparent:true}));sp.scale.set(h*4,h,1);sp.renderOrder=10;return sp}
function edMarkers(){if(ED.g)scene.remove(ED.g);var grp=new T.Group();ED.g=grp;ED.pins=[];scene.add(grp);if(!ED.R)return;var R: LevelDef=ED.R,kz=ED.d/26;
 var order=R.spots.map(function(_s,i){return i}).sort(function(a,b){return (R.spots[a]?.x??0)-(R.spots[b]?.x??0)});
 function pin(kind: "spot"|"prop",i: number,x: number,y: number,col: string,glyph: string){var sel=!!(ED.sel&&ED.sel.kind===kind&&ED.sel.i===i),s=new T.Sprite(new T.SpriteMaterial({map:pinTex(col,glyph,sel),depthTest:false,transparent:true}));s.renderOrder=11;s.scale.setScalar((kind==="spot"?1.15:.85)*(sel?1.3:1)*kz);s.position.set(x,y,0);grp.add(s);
  var ln=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(0,-y+.1,0)]),new T.LineBasicMaterial({color:col,transparent:true,opacity:sel?.9:.45,depthTest:false}));ln.position.set(x,y-.45,0);ln.renderOrder=9;grp.add(ln);ED.pins.push({kind:kind,i:i,s:s,l:ln})}
 R.props.forEach(function(p,i){var pr=PROPS[p.type];if(pr)pin("prop",i,p.x,6.3,"#8a96c8",pr.n.charAt(0))});
 order.forEach(function(i,n){var s=R.spots[i];if(!s)return;var hd=HIDE[s.hide];if(hd)pin("spot",i,s.x,4.9,KCOL[hd.t]||"#ffd24d",String(n+1))});
 for(var x=0;x<=45;x+=5){var tk=txtSprite(String(x),"#bfcaf5",.42*kz);tk.position.set(x,-.1,2.6);grp.add(tk)}
 var st=txtSprite("Start","#5af0b0",.5*kz);st.position.set(2,.5,2.6);grp.add(st);
 linearize(grp)}
function edFit(units: number){return Math.max(12,Math.min(120,units/(2*Math.tan(camera.fov*Math.PI/360)*camera.aspect)))}function edZoom(f: number){ED.d=Math.max(12,Math.min(120,ED.d*f));edMarkers()}function edView(){var W0=hostEl.clientWidth,H0=hostEl.clientHeight;camera.setViewOffset(W0,H0,0,H0*.22,W0,H0)}
function edEnter(){if(!ED.R){try{ED.R=JSON.parse(localStorage.getItem("tvLevel")||"null")}catch(e){}if(!edValid(ED.R))ED.R=edCopy("garden")}
 if(P.busy)return;if(!ED.testing)ED.prev=S.world;ED.on=true;P.title=false;S.started=true;save();hostEl.classList.remove("titled","building","testing");$("#pcard").hidden=true;
 P.showcase=false;P.target=null;P.root.visible=false;P.pos.set(-40,0,0);if(!ED.dSet){ED.d=edFit(17);ED.dSet=true}hostEl.classList.add("editing");syncEdInputs();
 edView();WORLDS.custom=edEngine(ED.R);buildWorld("custom");edMarkers();edPanel();flash();if(ED.kid)crUI(true)}
function edExit(){ED.on=false;ED.sel=null;ED.arm=null;if(ED.g){scene.remove(ED.g);ED.g=null}hostEl.classList.remove("editing");camera.clearViewOffset();
 S.world=ED.prev&&WORLDS[ED.prev]&&ED.prev!=="custom"?ED.prev:"garden";buildWorld(S.world);P.root.visible=true;P.pos.set(2,0,0);P.face=P.tface=0;cam.x=3;updHud();ctx();musInit();MUS.on=true;musGain(sound?.7:0,1.2);flash();showIntro(S.world);notify()}
function edPlay(){if(!ED.R||!ED.R.spots.length){toast("Place at least one hiding spot first.");return}ED.on=false;ED.testing=true;ED.found=S.found;S.found={};ED.prevW=S.world;S.world="custom";ED.sel=null;ED.arm=null;if(ED.g){scene.remove(ED.g);ED.g=null}
 hostEl.classList.remove("editing");hostEl.classList.add("testing");camera.clearViewOffset();WORLDS.custom=edEngine(ED.R);buildWorld("custom");
 P.root.visible=true;P.pos.set(2,0,0);P.target=null;P.face=P.tface=0;cam.x=3;P.showcase=false;updHud();ctx();musInit();MUS.on=true;musGain(sound?.7:0,1.2);flash();notify();setTimeout(function(){showIntro("custom")},250)}
function edBack(){if(P.busy){toast("One moment, the move is still going.");return}S.found=ED.found;S.world=ED.prevW;ED.testing=false;edEnter();notify()}
function edFreePart(): string {var used: Record<string, number>={};if(ED.R)ED.R.spots.forEach(function(s: LevelSpotRef){used[s.part]=1});var pool=Object.keys(PART).filter(function(k){var pt=PART[k];return Boolean(pt&&pt.w&&!used[k])});if(!pool.length)pool=Object.keys(PART).filter(function(k){var pt=PART[k];return Boolean(pt&&pt.st!=="none"&&!used[k])});return pool[0]||Object.keys(PART)[0]||"character.hat.flower"}
function edPlace(x: number){var a=ED.arm,R: LevelDef | null=ED.R;if(!a||!R)return;var armT=a.t;edPush();if(a.kind==="spot"){var hk=HKIND.filter(function(k){return k[0]===armT})[0];if(hk){var hideVal=hk[3][THEMES[R.theme]??0]||hk[3][0]||"scarecrow";R.spots.push({part:edFreePart(),hide:hideVal,x:x});ED.sel={kind:"spot",i:R.spots.length-1}}}else if(a.type){R.props.push({type:a.type,x:x});ED.sel={kind:"prop",i:R.props.length-1}}ED.arm=null;edApply();sfx.snap()}
function edPick(cx: number,cy: number): EditorPin | null {var r=canvas.getBoundingClientRect(),best: EditorPin | null=null,bd=34;ED.pins.forEach(function(p){var v=p.s.position.clone().project(camera),sx=(v.x+1)/2*r.width+r.left,sy=(1-v.y)/2*r.height+r.top,dd=Math.hypot(sx-cx,sy-cy);if(dd<bd){bd=dd;best=p}});return best}
function edX(e: { clientX: number; clientY: number }){rayAt(e.clientX,e.clientY);return laneX()}
function esc(s: any){var map: Record<string, string>={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"};return String(s).replace(/[&<>"]/g,function(c){return map[c]||c})}
function edPanel(){notify()}
function edUp(e: any){if(!ED.on||!ED.drag)return;e.stopImmediatePropagation();var d=ED.drag;ED.drag=null;
 if(d.pin&&d.moved&&d.nx!=null){edPush();var it=edItem(d.pin.kind,d.pin.i);if(it)it.x=d.nx;edApply();return}
 if(!d.moved&&!d.pin){var x=edX(e);if(ED.arm&&x!=null)edPlace(edSnapX(x));else if(ED.sel){ED.sel=null;edMarkers();edPanel()}}}
var edBackLabel="Back to editor",edName="",edTheme="";
var edIo={open:false,title:"Level file",text:"",readOnly:true,canCopy:false,canLoad:false};
var edIoTxt="";
function syncEdInputs(){edName=ED.R?ED.R.name:"";edTheme=ED.R?ED.R.theme:""}
function edSnap(){
  var testing=!!ED.testing,mode: "create" | "editor"=ED.kid?"create":"editor";
  if(!ED.on||ED.kid||!ED.R)return {open:false,testing:testing,mode:mode,backLabel:edBackLabel};
  var R=ED.R,ck=edChecks(R),pass=ck.filter(function(c){return c.ok}).length;
  var sel: any=null;
  if(ED.sel){
    var it=edItem(ED.sel.kind,ED.sel.i);
    if(it){
      if(ED.sel.kind==="spot"){
        var hk=HIDE[it.hide],ke=hk?HKIND.filter(function(k){return k[0]===hk!.t})[0]:undefined;
        if(hk&&ke){
          var moveName=hk.t==="junk"?"unscrewing":(STATS[hk.t]?.m||hk.t);
          sel={title:"Hiding spot",mut:ke[1]+", revealed by "+moveName,
            hide:{label:"Hidden in",value:it.hide,groups:HKIND.map(function(k){return {label:k[1]+" ("+k[2]+")",options:k[3].map(function(v){return {value:v,label:HIDE[v]?.n||v,selected:v===it.hide}})}})},
            part:{label:"Part",value:it.part,groups:Object.keys(TYPES).map(function(t){var td=TYPES[t]!;return {label:td.n,options:Object.keys(PART).filter(function(k){var pt=PART[k];return Boolean(pt&&pt.t===t&&pt.st!=="none")}).map(function(k){var p=PART[k]!;return {value:k,label:p.n+" ("+(td.sn[p.s]||p.s)+", "+(STATS[p.st]?.n||p.st)+")",selected:k===it.part}})}})}};
        }
      }else{var pr=PROPS[it.type];sel={title:pr?pr.n:it.type,mut:"Scenery, no part hidden",hide:null,part:null}}
    }
  }
  var pal: any=null,mut: string | null=null,chks: any=null;
  if(!sel){
    if(ED.tab==="spots"){pal=HKIND.map(function(k){return {label:k[1],detail:k[2],selected:!!(ED.arm&&ED.arm.t===k[0]),color:KCOL[k[0]]||"#ffd24d"}});mut="Tap a hiding spot, then tap the path to place it. Tap a pin to edit it, or drag it to move it."}
    else if(ED.tab==="props"){pal=Object.keys(PROPS).map(function(k){return {label:PROPS[k]!.n,detail:"",selected:!!(ED.arm&&ED.arm.type===k),color:"#8a96c8"}});mut="Scenery sets the mood and never hides a part. Tap one, then tap the path."}
    else chks=ck.map(function(c){return {title:c.n,detail:c.ok?"Passing":c.why,ok:c.ok}});
  }
  return EDD.editorData({testing:testing,kid:!!ED.kid,backLabel:edBackLabel,name:edName,theme:edTheme,tab:ED.tab,checkPass:pass,checkTotal:ck.length,canUndo:ED.undo.length>0,canRedo:ED.redo.length>0,sel:sel,palette:pal,tabMut:mut,checks:chks,io:{open:edIo.open,title:edIo.title,text:edIo.text,readOnly:edIo.readOnly,canCopy:edIo.canCopy,canLoad:edIo.canLoad},recipe:ED.R});
}
function edSetTab(t: string){ED.tab=t;ED.sel=null;ED.arm=null;edMarkers();edPanel()}
function edArmToggle(a: EditorArm){ED.arm=(ED.arm&&(ED.arm.t||ED.arm.type)===(a.t||a.type))?null:a;sfx.pop();edPanel();if(ED.arm)toast("Tap the path to place it.")}
function edArmDs(arm: string,t: string,type: string){edArmToggle(arm==="spot"?{kind:"spot",t:t}:{kind:"prop",type:type})}
function edArm(i: number){var keys: string[] | null=null;if(!ED.sel&&ED.tab==="spots")keys=HKIND.map(function(k){return k[0]});else if(!ED.sel&&ED.tab==="props")keys=Object.keys(PROPS);if(!keys||i==null||!keys[i])return;edArmToggle(ED.tab==="spots"?{kind:"spot",t:keys[i]}:{kind:"prop",type:keys[i]})}
function edNudge(dir: number){if(!ED.sel)return;var it=edItem(ED.sel.kind,ED.sel.i);if(!it)return;edPush();it.x=edSnapX(it.x+dir*.5);edApply()}
function edDelete(){if(!ED.sel||!ED.R)return;edPush();if(ED.sel.kind==="spot")ED.R.spots.splice(ED.sel.i,1);else ED.R.props.splice(ED.sel.i,1);ED.sel=null;edApply();sfx.pop()}
function edDoneSel(){ED.sel=null;edMarkers();edPanel()}
function edSetHide(v: string){if(!ED.sel||ED.sel.kind!=="spot")return;var it=edItem("spot",ED.sel.i);if(!it)return;edPush();it.hide=v;delete it.z;edApply()}
function edSetPart(v: string){if(!ED.sel||ED.sel.kind!=="spot")return;var it=edItem("spot",ED.sel.i);if(!it)return;edPush();it.part=v;edApply()}
function edSetName(v: string){if(!ED.R)return;edPush();ED.R.name=String(v==null?"":v).trim().slice(0,40)||"My world";ED.R.id=ED.R.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"my-world";syncEdInputs();edApply(false)}
function edSetTheme(v: string){if(!ED.R)return;edPush();ED.R.theme=v;syncEdInputs();edApply()}
function edNew(v: string){if(!v)return;edPush();ED.R=v.indexOf("copy:")===0?edCopy(v.slice(5)):edBlank(v.slice(6));ED.sel=null;syncEdInputs();edApply();toast("Started a new level. Undo brings back the old one.")}
function edZoomBy(f: number){edZoom(f)}
function edExport(){edIo={open:true,title:"Export this level",text:JSON.stringify(ED.R,null,2),readOnly:true,canCopy:true,canLoad:false};notify()}
function edImport(){edIo={open:true,title:"Paste a level to import",text:"",readOnly:false,canCopy:false,canLoad:true};notify()}
function edIoClose(){edIo.open=false;notify()}
function edIoCopy(){var done=function(){toast("Copied. Paste it into the level file or a message.")};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(edIoTxt).then(done,function(){try{document.execCommand("copy");done()}catch(e){toast("Select the text and copy it by hand.")}});else{try{document.execCommand("copy");done()}catch(e){toast("Select the text and copy it by hand.")}}}
function edIoLoad(){var R: any=null;try{R=JSON.parse(edIoTxt)}catch(e){}if(!edValid(R)){toast("That isn't a ToyVentor level. Check the format line and the part names.");return}edPush();ED.R=R;ED.sel=null;edIo.open=false;edName=R.name||"My world";edTheme=R.theme;edApply();toast("Level imported.")}
/** Load a level object directly (Feature 3 room-photo levels). Same validation as import; no-op + false when invalid. */
function edLoad(level: unknown): boolean {if(!edValid(level))return false;var R=JSON.parse(JSON.stringify(level)) as LevelDef;if(ED.on)edPush();ED.R=R;ED.sel=null;edName=R.name||"My world";edTheme=R.theme;if(ED.on)edApply();else{try{localStorage.setItem(ED.kid?"tvCreate":"tvLevel",JSON.stringify(R))}catch(e){}}return true}
function edSetIoText(t: string){edIoTxt=t}
function edControl(i: number){if(i===0||i===1)edNudge(i===0?-1:1);else if(i===2)edDelete();else if(i===3)edDoneSel()}
function edFromTitle(){ctx();ED.kid=false;ED.R=null;edEnter()}

function setBackLabel(v: string){edBackLabel=v}
return {ED,setBackLabel,esc,edBlank,edCopy,edEngine,edValid,edChecks,edSnapX,edSnap,edItem,edPush,edApply,edUndo,edRedo,pinTex,txtSprite,edMarkers,edFit,edZoom,edView,edEnter,edExit,edPlay,edBack,edFreePart,edPlace,edPick,edX,edPanel,syncEdInputs,edSetTab,edArmToggle,edArmDs,edArm,edNudge,edDelete,edDoneSel,edSetHide,edSetPart,edSetName,edSetTheme,edNew,edZoomBy,edExport,edImport,edIoClose,edIoCopy,edIoLoad,edLoad,edSetIoText,edControl,edFromTitle,edUp};
}
