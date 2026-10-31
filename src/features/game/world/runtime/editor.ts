// @ts-nocheck
// Level editor (5A Unit 2e): ED state + every ed* action, lifted verbatim
// from world.ts. The engine contract (engine.ts openEditorNow/readEditor)
// is served from the returned api; world.ts keeps a live ED reference plus
// one binding per bare name its wiring still calls.
// NOTE: coord snapping is edSnapX; edSnap() is the engine snapshot (the two
// shared one name until Unit 2e — see edNudge regression test).
import { T, plastic, linearize } from "./worldScene";
import {
  PART, PROPS, HIDE, THEMES, HKIND, KCOL, TYPES, STATS,
  WORLDS, levelWorld,
} from "./catalog";
import { ctx, sfx, MUS, musInit, musGain, sound } from "./audio";
import * as EDD from "./editorData";

export interface EditorState {
  on: boolean; testing: boolean; kid?: boolean; cx: number; d: number;
  sel: any; arm: any; undo: string[]; redo: string[]; g: any; pins: any[];
  tab: string; R: any; drag: any; dSet?: boolean; prev?: string;
  found?: any; prevW?: string;
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
  edBlank: (th: string) => any;
  edCopy: (id: string) => any;
  edEngine: (R: any) => any;
  edValid: (R: any) => boolean;
  edChecks: (R: any) => any[];
  edSnapX: (x: number) => number;
  edSnap: () => any;
  edItem: (k: string, i: number) => any;
  edPush: () => void;
  edApply: (rebuild?: boolean) => void;
  edUndo: () => void;
  edRedo: () => void;
  pinTex: (col: string, glyph: string, sel: boolean) => any;
  txtSprite: (s: string, col: string, h: number) => any;
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
  edPick: (cx: number, cy: number) => any;
  edX: (e: any) => number | null;
  edPanel: () => void;
  syncEdInputs: () => void;
  edSetTab: (t: string) => void;
  edArmToggle: (a: any) => void;
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
  edSetIoText: (t: string) => void;
  edControl: (i: number) => void;
  edFromTitle: () => void;
  edUp: (e: any) => void;
}

export function createEditor(deps: EditorDeps): EditorApi {
  var {S, P, scene, camera, canvas, hostEl, cam, $, $$, toast, save, notify, flash, updHud, showIntro, buildWorld, crUI, rayAt, laneX} = deps;
var ED={on:false,testing:false,cx:22,d:26,sel:null,arm:null,undo:[],redo:[],g:null,pins:[],tab:"spots",R:null,drag:null};
function edBlank(th){return {format:"toyventor.level/1",id:"my-world",name:"My world",theme:th,props:[],spots:[]}}
function edCopy(id){var w=WORLDS[id];return {format:"toyventor.level/1",id:id+"-copy",name:w.n+" copy",theme:id,
 props:w.props.filter(function(p){return PROPS[p[0]]}).map(function(p){var o={type:p[0],x:p[1]};if(p[2]!==PROPS[p[0]].z)o.z=p[2];if(typeof p[3]==="number"&&p[3]!==PROPS[p[0]].y)o.y=p[3];return o}),
 spots:w.spots.map(function(s){var o={part:s.k,hide:s.obj||s.cover,x:s.x},h=HIDE[o.hide];if(h&&s.z!==h.z)o.z=s.z;return o}),missions:(w.missions||[]).slice()}}
function edEngine(R){var w=levelWorld(R);w.spots=w.spots.filter(function(s){return PART[s.k]});return w}
function edValid(R){return R&&R.format==="toyventor.level/1"&&THEMES[R.theme]!=null&&Array.isArray(R.props)&&Array.isArray(R.spots)&&R.props.every(function(p){return PROPS[p.type]&&typeof p.x==="number"})&&R.spots.every(function(s){return HIDE[s.hide]&&PART[s.part]&&typeof s.x==="number"})}
function edChecks(R){var sp=R.spots,c=[],keys=sp.map(function(s){return s.part}),xs=sp.map(function(s){return s.x}).sort(function(a,b){return a-b}),mv={};
 sp.forEach(function(s){var t=HIDE[s.hide].t;if(t!=="junk")mv[t]=1});
 c.push({ok:sp.length===5,n:"Five hidden parts",why:sp.length+" placed"});
 c.push({ok:sp.some(function(s){return HIDE[s.hide].t==="junk"&&s.x<=10}),n:"A junk machine in the first 10 units",why:"So the first find never needs a move"});
 c.push({ok:keys.every(function(k,i){return PART[k]&&PART[k].st!=="none"&&keys.indexOf(k)===i}),n:"Each spot hides a different real part",why:"No repeats and no looks-only parts"});
 c.push({ok:xs.every(function(x,i){return !i||x-xs[i-1]>=4}),n:"Spots at least 4 units apart",why:"So two glints never overlap"});
 c.push({ok:sp.every(function(s){return s.x>=4&&s.x<=42}),n:"Spots between unit 4 and unit 42",why:"Clear of the start and the edge"});
 c.push({ok:Object.keys(mv).length>=3,n:"At least three different moves",why:"So the level teaches more than one trick"});
 return c}
function edSnapX(x){return Math.round(Math.max(0,Math.min(45,x))*2)/2}
function edItem(k,i){return ED.R[k==="spot"?"spots":"props"][i]}
function edPush(){ED.undo.push(JSON.stringify(ED.R));if(ED.undo.length>60)ED.undo.shift();ED.redo=[]}
function edApply(rebuild){try{localStorage.setItem(ED.kid?"tvCreate":"tvLevel",JSON.stringify(ED.R))}catch(e){}WORLDS.custom=edEngine(ED.R);if(rebuild!==false)buildWorld("custom");edMarkers();edPanel()}
function edUndo(){if(!ED.undo.length)return;ED.redo.push(JSON.stringify(ED.R));ED.R=JSON.parse(ED.undo.pop());ED.sel=null;edApply();sfx.pop()}
function edRedo(){if(!ED.redo.length)return;ED.undo.push(JSON.stringify(ED.R));ED.R=JSON.parse(ED.redo.pop());ED.sel=null;edApply();sfx.pop()}
var PINT={};function pinTex(col,glyph,sel){var k=col+glyph+sel;if(PINT[k])return PINT[k];var c=document.createElement("canvas");c.width=c.height=128;var g=c.getContext("2d");if(sel){g.fillStyle="rgba(255,210,77,.45)";g.beginPath();g.arc(64,54,58,0,Math.PI*2);g.fill()}g.fillStyle=col;g.beginPath();g.arc(64,54,40,0,Math.PI*2);g.fill();g.beginPath();g.moveTo(46,84);g.lineTo(82,84);g.lineTo(64,118);g.closePath();g.fill();g.lineWidth=5;g.strokeStyle="#06122b";g.beginPath();g.arc(64,54,40,0,Math.PI*2);g.stroke();g.fillStyle="#06122b";g.font="800 42px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(glyph,64,57);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;PINT[k]=tx;return tx}
function txtSprite(s,col,h){var c=document.createElement("canvas");c.width=256;c.height=64;var g=c.getContext("2d");g.fillStyle=col||"#bfcaf5";g.font="700 34px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(s,128,34);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;var sp=new T.Sprite(new T.SpriteMaterial({map:tx,depthTest:false,transparent:true}));sp.scale.set(h*4,h,1);sp.renderOrder=10;return sp}
function edMarkers(){if(ED.g)scene.remove(ED.g);ED.g=new T.Group();ED.pins=[];scene.add(ED.g);var kz=ED.d/26;
 var order=ED.R.spots.map(function(s,i){return i}).sort(function(a,b){return ED.R.spots[a].x-ED.R.spots[b].x});
 function pin(kind,i,x,y,col,glyph){var sel=!!(ED.sel&&ED.sel.kind===kind&&ED.sel.i===i),s=new T.Sprite(new T.SpriteMaterial({map:pinTex(col,glyph,sel),depthTest:false,transparent:true}));s.renderOrder=11;s.scale.setScalar((kind==="spot"?1.15:.85)*(sel?1.3:1)*kz);s.position.set(x,y,0);ED.g.add(s);
  var ln=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(0,-y+.1,0)]),new T.LineBasicMaterial({color:col,transparent:true,opacity:sel?.9:.45,depthTest:false}));ln.position.set(x,y-.45,0);ln.renderOrder=9;ED.g.add(ln);ED.pins.push({kind:kind,i:i,s:s,l:ln})}
 ED.R.props.forEach(function(p,i){pin("prop",i,p.x,6.3,"#8a96c8",PROPS[p.type].n.charAt(0))});
 order.forEach(function(i,n){var s=ED.R.spots[i];pin("spot",i,s.x,4.9,KCOL[HIDE[s.hide].t],String(n+1))});
 for(var x=0;x<=45;x+=5){var tk=txtSprite(String(x),"#bfcaf5",.42*kz);tk.position.set(x,-.1,2.6);ED.g.add(tk)}
 var st=txtSprite("Start","#5af0b0",.5*kz);st.position.set(2,.5,2.6);ED.g.add(st);
 linearize(ED.g)}
function edFit(units){return Math.max(12,Math.min(120,units/(2*Math.tan(camera.fov*Math.PI/360)*camera.aspect)))}function edZoom(f){ED.d=Math.max(12,Math.min(120,ED.d*f));edMarkers()}function edView(){var W0=hostEl.clientWidth,H0=hostEl.clientHeight;camera.setViewOffset(W0,H0,0,H0*.22,W0,H0)}
function edEnter(){if(!ED.R){try{ED.R=JSON.parse(localStorage.getItem("tvLevel")||"null")}catch(e){}if(!edValid(ED.R))ED.R=edCopy("garden")}
 if(P.busy)return;if(!ED.testing)ED.prev=S.world;ED.on=true;P.title=false;S.started=true;save();hostEl.classList.remove("titled","building","testing");$("#title").hidden=true;$("#sheet").hidden=true;$("#pcard").hidden=true;$("#ed-back").hidden=true;
 P.showcase=false;P.target=null;P.root.visible=false;P.pos.set(-40,0,0);if(!ED.dSet){ED.d=edFit(17);ED.dSet=true}hostEl.classList.add("editing");$("#ed").hidden=false;syncEdInputs();
 edView();WORLDS.custom=edEngine(ED.R);buildWorld("custom");edMarkers();edPanel();flash();if(ED.kid)crUI(true)}
function edExit(){ED.on=false;ED.sel=null;ED.arm=null;if(ED.g){scene.remove(ED.g);ED.g=null}hostEl.classList.remove("editing");$("#ed").hidden=true;camera.clearViewOffset();
 S.world=WORLDS[ED.prev]&&ED.prev!=="custom"?ED.prev:"garden";buildWorld(S.world);P.root.visible=true;P.pos.set(2,0,0);P.face=P.tface=0;cam.x=3;updHud();ctx();musInit();MUS.on=true;musGain(sound?.7:0,1.2);flash();showIntro(S.world);notify()}
function edPlay(){if(!ED.R.spots.length){toast("Place at least one hiding spot first.");return}ED.on=false;ED.testing=true;ED.found=S.found;S.found={};ED.prevW=S.world;S.world="custom";ED.sel=null;ED.arm=null;if(ED.g){scene.remove(ED.g);ED.g=null}
 hostEl.classList.remove("editing");hostEl.classList.add("testing");$("#ed").hidden=true;$("#ed-back").hidden=false;camera.clearViewOffset();WORLDS.custom=edEngine(ED.R);buildWorld("custom");
 P.root.visible=true;P.pos.set(2,0,0);P.target=null;P.face=P.tface=0;cam.x=3;P.showcase=false;updHud();ctx();musInit();MUS.on=true;musGain(sound?.7:0,1.2);flash();notify();setTimeout(function(){showIntro("custom")},250)}
function edBack(){if(P.busy){toast("One moment, the move is still going.");return}S.found=ED.found;S.world=ED.prevW;ED.testing=false;$("#ed-back").hidden=true;edEnter();notify()}
function edFreePart(){var used={};ED.R.spots.forEach(function(s){used[s.part]=1});var pool=Object.keys(PART).filter(function(k){return PART[k].w&&!used[k]});if(!pool.length)pool=Object.keys(PART).filter(function(k){return PART[k].st!=="none"&&!used[k]});return pool[0]||Object.keys(PART)[0]}
function edPlace(x){var a=ED.arm;edPush();if(a.kind==="spot"){var hk=HKIND.filter(function(k){return k[0]===a.t})[0];ED.R.spots.push({part:edFreePart(),hide:hk[3][THEMES[ED.R.theme]||0],x:x});ED.sel={kind:"spot",i:ED.R.spots.length-1}}else{ED.R.props.push({type:a.type,x:x});ED.sel={kind:"prop",i:ED.R.props.length-1}}ED.arm=null;edApply();sfx.snap()}
function edPick(cx,cy){var r=canvas.getBoundingClientRect(),best=null,bd=34;ED.pins.forEach(function(p){var v=p.s.position.clone().project(camera),sx=(v.x+1)/2*r.width+r.left,sy=(1-v.y)/2*r.height+r.top,dd=Math.hypot(sx-cx,sy-cy);if(dd<bd){bd=dd;best=p}});return best}
function edX(e){rayAt(e.clientX,e.clientY);return laneX()}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function edPanel(){var R=ED.R,ck=edChecks(R),pass=ck.filter(function(c){return c.ok}).length,b=$("#ed-body"),h="";
 $$("#ed-tabs button").forEach(function(t){t.setAttribute("aria-pressed",t.dataset.tab===ED.tab);if(t.dataset.tab==="checks")t.textContent="Checks "+pass+"/"+ck.length});
 $("#ed-undo").disabled=!ED.undo.length;$("#ed-redo").disabled=!ED.redo.length;
 if(ED.sel){var it=edItem(ED.sel.kind,ED.sel.i);if(!it){ED.sel=null;return edPanel()}
  if(ED.sel.kind==="spot"){var hk=HIDE[it.hide];h+='<div class="ed-insp"><b>Hiding spot</b><span class="ed-mut">'+HKIND.filter(function(k){return k[0]===hk.t})[0][1]+', revealed by '+(hk.t==="junk"?"unscrewing":STATS[hk.t].m)+'</span>';
   h+='<label>Hidden in<select id="ed-hide">'+HKIND.map(function(k){return '<optgroup label="'+k[1]+' ('+k[2]+')">'+k[3].map(function(v){return '<option value="'+v+'"'+(v===it.hide?" selected":"")+'>'+HIDE[v].n+'</option>'}).join("")+'</optgroup>'}).join("")+'</select></label>';
   h+='<label>Part<select id="ed-part">'+Object.keys(TYPES).map(function(t){return '<optgroup label="'+TYPES[t].n+'">'+Object.keys(PART).filter(function(k){return PART[k].t===t&&PART[k].st!=="none"}).map(function(k){var p=PART[k];return '<option value="'+k+'"'+(k===it.part?" selected":"")+'>'+esc(p.n)+' ('+TYPES[t].sn[p.s]+', '+STATS[p.st].n+')</option>'}).join("")+'</optgroup>'}).join("")+'</select></label>'}
  else h+='<div class="ed-insp"><b>'+PROPS[it.type].n+'</b><span class="ed-mut">Scenery, no part hidden</span>';
  h+='<div class="ed-row"><button class="ctl" type="button" data-nx="-1">Move left</button><span class="chip">At '+it.x+'</span><button class="ctl" type="button" data-nx="1">Move right</button></div><div class="ed-row"><button class="ctl" type="button" id="ed-del">Delete</button><button class="ctl primary" type="button" id="ed-ok">Done</button></div></div>'}
 else if(ED.tab==="spots")h='<p class="ed-mut">Tap a hiding spot, then tap the path to place it. Tap a pin to edit it, or drag it to move it.</p><div class="ed-pal">'+HKIND.map(function(k){return '<button type="button" data-arm="spot" data-t="'+k[0]+'" aria-pressed="'+!!(ED.arm&&ED.arm.t===k[0])+'"><i style="background:'+KCOL[k[0]]+'"></i><b>'+k[1]+'</b><span>'+k[2]+'</span></button>'}).join("")+'</div>';
 else if(ED.tab==="props")h='<p class="ed-mut">Scenery sets the mood and never hides a part. Tap one, then tap the path.</p><div class="ed-pal">'+Object.keys(PROPS).map(function(k){return '<button type="button" data-arm="prop" data-type="'+k+'" aria-pressed="'+!!(ED.arm&&ED.arm.type===k)+'"><i style="background:#8a96c8"></i><b>'+PROPS[k].n+'</b></button>'}).join("")+'</div>';
 else h='<ul class="ed-chk">'+ck.map(function(c){return '<li class="'+(c.ok?"ok":"no")+'"><span class="dot" aria-hidden="true">'+(c.ok?"✓":"!")+'</span><span><b>'+c.n+'</b><span class="ed-mut">'+(c.ok?"Passing":c.why)+'</span></span></li>'}).join("")+'</ul>';
 b.innerHTML=h;
 $$("#ed-body [data-arm]").forEach(function(x){x.onclick=function(){edArmDs(x.dataset.arm,x.dataset.t,x.dataset.type)}});
 $$("#ed-body [data-nx]").forEach(function(x){x.onclick=function(){edNudge(+x.dataset.nx)}});
 var hs=$("#ed-hide");if(hs)hs.onchange=function(){edSetHide(hs.value)};
 var ps=$("#ed-part");if(ps)ps.onchange=function(){edSetPart(ps.value)};
 var dl=$("#ed-del");if(dl)dl.onclick=function(){edDelete()};
 var ok=$("#ed-ok");if(ok)ok.onclick=function(){edDoneSel()};notify()}
function edUp(e){if(!ED.on||!ED.drag)return;e.stopImmediatePropagation();var d=ED.drag;ED.drag=null;
 if(d.pin&&d.moved&&d.nx!=null){edPush();edItem(d.pin.kind,d.pin.i).x=d.nx;edApply();return}
 if(!d.moved&&!d.pin){var x=edX(e);if(ED.arm&&x!=null)edPlace(edSnapX(x));else if(ED.sel){ED.sel=null;edMarkers();edPanel()}}}
var edBackLabel="Back to editor",edName="",edTheme="";
var edIo={open:false,title:"Level file",text:"",readOnly:true,canCopy:false,canLoad:false};
var edIoTxt="";
function syncEdInputs(){edName=ED.R?ED.R.name:"";edTheme=ED.R?ED.R.theme:"";var n=$("#ed-name"),t=$("#ed-theme");if(n)n.value=edName;if(t)t.value=edTheme}
function edSnap(){
  var ed=$("#ed"),testing=!!ED.testing,mode=ED.kid?"create":"editor";
  if(!ed||ed.hidden||!ED.on||ED.kid)return {open:false,testing:testing,mode:mode,backLabel:edBackLabel};
  var R=ED.R,ck=edChecks(R),pass=ck.filter(function(c){return c.ok}).length;
  var sel=null;
  if(ED.sel){
    var it=edItem(ED.sel.kind,ED.sel.i);
    if(it){
      if(ED.sel.kind==="spot"){
        var hk=HIDE[it.hide],ke=HKIND.filter(function(k){return k[0]===hk.t})[0];
        sel={title:"Hiding spot",mut:ke[1]+", revealed by "+(hk.t==="junk"?"unscrewing":STATS[hk.t].m),
          hide:{label:"Hidden in",value:it.hide,groups:HKIND.map(function(k){return {label:k[1]+" ("+k[2]+")",options:k[3].map(function(v){return {value:v,label:HIDE[v].n,selected:v===it.hide}})}})},
          part:{label:"Part",value:it.part,groups:Object.keys(TYPES).map(function(t){return {label:TYPES[t].n,options:Object.keys(PART).filter(function(k){return PART[k].t===t&&PART[k].st!=="none"}).map(function(k){var p=PART[k];return {value:k,label:p.n+" ("+TYPES[t].sn[p.s]+", "+STATS[p.st].n+")",selected:k===it.part}})}})}};
      }else sel={title:PROPS[it.type].n,mut:"Scenery, no part hidden",hide:null,part:null};
    }
  }
  var pal=null,mut=null,chks=null;
  if(!sel){
    if(ED.tab==="spots"){pal=HKIND.map(function(k){return {label:k[1],detail:k[2],selected:!!(ED.arm&&ED.arm.t===k[0]),color:KCOL[k[0]]}});mut="Tap a hiding spot, then tap the path to place it. Tap a pin to edit it, or drag it to move it."}
    else if(ED.tab==="props"){pal=Object.keys(PROPS).map(function(k){return {label:PROPS[k].n,detail:"",selected:!!(ED.arm&&ED.arm.type===k),color:"#8a96c8"}});mut="Scenery sets the mood and never hides a part. Tap one, then tap the path."}
    else chks=ck.map(function(c){return {title:c.n,detail:c.ok?"Passing":c.why,ok:c.ok}});
  }
  return EDD.editorData({testing:testing,kid:ED.kid,backLabel:edBackLabel,name:edName,theme:edTheme,tab:ED.tab,checkPass:pass,checkTotal:ck.length,canUndo:ED.undo.length>0,canRedo:ED.redo.length>0,sel:sel,palette:pal,tabMut:mut,checks:chks,io:{open:edIo.open,title:edIo.title,text:edIo.text,readOnly:edIo.readOnly,canCopy:edIo.canCopy,canLoad:edIo.canLoad},recipe:ED.R});
}
function edSetTab(t){ED.tab=t;ED.sel=null;ED.arm=null;edMarkers();edPanel()}
function edArmToggle(a){ED.arm=(ED.arm&&(ED.arm.t||ED.arm.type)===(a.t||a.type))?null:a;sfx.pop();edPanel();if(ED.arm)toast("Tap the path to place it.")}
function edArmDs(arm,t,type){edArmToggle(arm==="spot"?{kind:"spot",t:t}:{kind:"prop",type:type})}
function edArm(i){var keys=null;if(!ED.sel&&ED.tab==="spots")keys=HKIND.map(function(k){return k[0]});else if(!ED.sel&&ED.tab==="props")keys=Object.keys(PROPS);if(!keys||i==null||!keys[i])return;edArmToggle(ED.tab==="spots"?{kind:"spot",t:keys[i]}:{kind:"prop",type:keys[i]})}
function edNudge(dir){if(!ED.sel)return;var it=edItem(ED.sel.kind,ED.sel.i);if(!it)return;edPush();it.x=edSnapX(it.x+dir*.5);edApply()}
function edDelete(){if(!ED.sel)return;edPush();ED.R[ED.sel.kind==="spot"?"spots":"props"].splice(ED.sel.i,1);ED.sel=null;edApply();sfx.pop()}
function edDoneSel(){ED.sel=null;edMarkers();edPanel()}
function edSetHide(v){if(!ED.sel||ED.sel.kind!=="spot")return;var it=edItem("spot",ED.sel.i);if(!it)return;edPush();it.hide=v;delete it.z;edApply()}
function edSetPart(v){if(!ED.sel||ED.sel.kind!=="spot")return;var it=edItem("spot",ED.sel.i);if(!it)return;edPush();it.part=v;edApply()}
function edSetName(v){edPush();ED.R.name=String(v==null?"":v).trim().slice(0,40)||"My world";ED.R.id=ED.R.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"my-world";syncEdInputs();edApply(false)}
function edSetTheme(v){edPush();ED.R.theme=v;syncEdInputs();edApply()}
function edNew(v){if(!v)return;edPush();ED.R=v.indexOf("copy:")===0?edCopy(v.slice(5)):edBlank(v.slice(6));ED.sel=null;syncEdInputs();edApply();toast("Started a new level. Undo brings back the old one.")}
function edZoomBy(f){edZoom(f)}
function edExport(){edIo={open:true,title:"Export this level",text:JSON.stringify(ED.R,null,2),readOnly:true,canCopy:true,canLoad:false};notify()}
function edImport(){edIo={open:true,title:"Paste a level to import",text:"",readOnly:false,canCopy:false,canLoad:true};notify()}
function edIoClose(){edIo.open=false;notify()}
function edIoCopy(){var ta=$("#ed-txt");if(ta){ta.value=edIoTxt;try{ta.select()}catch(e){}}var done=function(){toast("Copied. Paste it into the level file or a message.")};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(edIoTxt).then(done,function(){try{document.execCommand("copy");done()}catch(e){toast("Select the text and copy it by hand.")}});else{try{document.execCommand("copy");done()}catch(e){toast("Select the text and copy it by hand.")}}}
function edIoLoad(){var R=null;try{R=JSON.parse(edIoTxt)}catch(e){}if(!edValid(R)){toast("That isn't a ToyVentor level. Check the format line and the part names.");return}edPush();ED.R=R;ED.sel=null;edIo.open=false;edName=R.name||"My world";edTheme=R.theme;var n=$("#ed-name"),t=$("#ed-theme");if(n)n.value=edName;if(t)t.value=edTheme;edApply();toast("Level imported.")}
function edSetIoText(t){edIoTxt=t}
function edControl(i){if(i===0||i===1)edNudge(i===0?-1:1);else if(i===2)edDelete();else if(i===3)edDoneSel()}
function edFromTitle(){ctx();ED.kid=false;ED.R=null;edEnter()}

function setBackLabel(v){edBackLabel=v}
return {ED,setBackLabel,esc,edBlank,edCopy,edEngine,edValid,edChecks,edSnapX,edSnap,edItem,edPush,edApply,edUndo,edRedo,pinTex,txtSprite,edMarkers,edFit,edZoom,edView,edEnter,edExit,edPlay,edBack,edFreePart,edPlace,edPick,edX,edPanel,syncEdInputs,edSetTab,edArmToggle,edArmDs,edArm,edNudge,edDelete,edDoneSel,edSetHide,edSetPart,edSetName,edSetTheme,edNew,edZoomBy,edExport,edImport,edIoClose,edIoCopy,edIoLoad,edSetIoText,edControl,edFromTitle,edUp};
}
