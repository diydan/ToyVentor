// @ts-nocheck
// Native world runtime: missions (5A Unit 2d).
//
// STEM mission table + entry-support helpers, lifted verbatim from
// runtime/world.ts into a deps-injected factory. Bodies are unchecked legacy
// (dynamic mission bags, entry-method this); the MissionDeps boundary below
// is the typed contract. Statements keep their relative order.
import * as THREE from "three";
import { T, STARGEO, glowSprite, plastic, metal, rbox, M, G, at, linearize, gear } from "./worldScene";
import { buildToy } from "./playerRig";
import { key, GR, TK, GATES, RIT, CSH, CNEED, PB, PR, CGL, CNM, CON, CTN } from "./catalog";
import { tone, noise, sfx, bellTone } from "./audio";

export interface Mission {
  type: string;
  x: number;
  done?: boolean;
  replaying?: boolean;
  [k: string]: any;
}
export interface FxItem {
  t: number;
  d: number;
  f: (...args: any[]) => void;
  end?: (m: Mission) => void;
  [k: string]: any;
}
export interface MissionDeps {
  S: { world: string; ms: any; mdone: any; ma: any; me: any; [k: string]: any };
  P: { pos: any; busy: boolean; mDrive: boolean; [k: string]: any };
  W: { missions: any[]; root: any; [k: string]: any };
  fx: FxItem[];
  $: (sel: string) => any;
  $$: (sel: string) => any[];
  toast: (msg: string, ms?: number) => void;
  save: () => void;
  notify: () => void;
  updHud: () => void;
  creStats: () => any;
  mPanel: (m: Mission) => void;
  mtPanel: (m: Mission) => void;
  mReplayPrompt: (m: Mission, title: string) => void;
  mtFail: (m: Mission) => void;
  walkTo: (x: number) => Promise<boolean>;
  hop: (x0: number, x1: number, h: number, d: number) => Promise<void>;
  soapWin: (m: Mission) => number[];
  joy: () => void;
  mpPress: (m: Mission, d: any) => void;
  add: (o: any) => any;
  resetNear: () => void;
  darkSprite: (col: string, a: number) => any;
  rockMesh: (r: number, seed: number) => THREE.Group;
  chestMesh: () => THREE.Group;
  setTimeout: (fn: () => void, ms: number) => number;
}

export interface MissionsApi {
  MT: Record<string, any>;
  mid: (m: Mission) => string;
  mTier: (m: Mission) => number;
  tq: (m: Mission, a: number, b: number, c: number) => number;
  mkk: (m: Mission) => string;
  mst: (m: Mission) => any;
  mFailNote: (m: Mission) => void;
  mWinNote: (m: Mission) => void;
  mStartReplay: (m: Mission) => void;
  mCancelReplay: (m: Mission) => void;
  clearG: (g: any) => void;
  mtWin: (m: Mission, msg: string) => void;
  mSync: (m: Mission) => void;
  mWait: (s: number) => Promise<void>;
  prRounds: (m: Mission) => number;
  faceGear: (r: number, mat: any) => THREE.Group;
  textSprite: (t: string, col: string, h: number) => any;
  riverAt: (cx: number, w: number) => void;
  flyAway: (obj: any, dx: number, dy: number) => Promise<void>;
}
export function createMissions(deps: MissionDeps): MissionsApi {
  // NB: W is read as deps.W at each use site, never destructured: buildWorld
  // reassigns the W binding after createMissions runs, so a captured copy
  // would keep pointing at the initial {root:null}.
  var {S, P, fx, $, $$, toast, save, notify, updHud, creStats, mPanel, mtPanel, mReplayPrompt, mtFail, walkTo, hop, soapWin, joy, mpPress, add, resetNear, darkSprite, rockMesh, chestMesh, setTimeout} = deps;
  var MT = {};
function mFailNote(m){var k=mkk(m);S.ma[k]=(S.ma[k]||0)+1;save()}
function mWinNote(m){var k=mid(m),akk=mkk(m),st=creStats(),now=Math.max(Date.now(),((S.lastWin&&S.lastWin.at)||0)+1);S.lastWin={key:k,tier:mTier(m),attempts:(S.ma[akk]||0)+1,error:S.me[akk]||0,stats:Object.keys(st).filter(function(s){return st[s]}),at:now};S.ma[akk]=0;delete S.me[akk];m.replaying=false;m.prevSt=null;m.dismissed=true;save()}
function mStartReplay(m){var k=mid(m);m.prevSt=JSON.parse(JSON.stringify(mst(m)));S.ms[k]={tier:(m.prevSt||{}).tier};m.done=false;m.replaying=true;m.dismissed=false;
 var h0=m.type==="bridge"?m.x-1.75:m.type==="lift"?m.px-.8:MT[m.type].hold(m);if(P.pos.x>h0){P.pos.x=h0;P.target=null;P.elev=0}
 if(m.type==="bridge"){m.plank.position.y=.14;m.plank.rotation.z=0}
 if(m.type==="lift"){m.py=0;m.plat.position.y=0}
 if(m.type==="raft"){m.rx=m.x+.75;m.ry=0}
 if(m.type==="pattern")m.gy=0;
 if(m.type==="circuit"){m.dark.visible=true;m.dark.material.opacity=.96;m.glow.visible=false;m.bulb.material.color.set("#3a4684");m.bulb.material.emissive.set("#000000")}
 save();if(MT[m.type]){MT[m.type].st&&MT[m.type].st(m);MT[m.type].sync(m)}else mSync(m);mPanel(m)}
function mCancelReplay(m){if(!m||!m.replaying||!S.mdone[mid(m)])return;var k=mid(m),prev=m.prevSt||{};
 if(m.type==="clean"&&!prev.cl)prev={tier:prev.tier,g:2,cl:{crumbs:1,puddle:1,jam:1},fx:{nail:1,bolt:1,screw:1},pl:[0,0,0],soap:2,ok:1,tool:"vacuum"};
 S.ms[k]=prev;m.prevSt=null;m.done=true;m.replaying=false;
 if(m.type==="lift"){m.py=2.6;m.plat.position.y=2.6}
 if(m.type==="raft"){m.rx=m.x+4.3;m.ry=0}
 if(m.type==="pattern")m.gy=2.3;
 if(m.type==="circuit"){m.dark.visible=false;m.glow.visible=true;m.bulb.material.color.set("#fff3b0");m.bulb.material.emissive.set("#ffd24d")}
 save();if(MT[m.type])MT[m.type].sync(m);else mSync(m)}
function mid(m){return S.world+"."+m.type}
function mTier(m){var s=S.ms[mid(m)]||{};return s.tier===2||s.tier===3?s.tier:1}
function tq(m,a,b,c){var t=mTier(m);return t===3?c:t===2?b:a}
function mkk(m){return mid(m)+":t"+mTier(m)}
function mst(m){var k=mid(m);if(!S.ms[k])S.ms[k]={};return S.ms[k]}
function mSync(m){var st=mst(m);if(m.type==="bridge"){m.plank.visible=!!st.deck||m.done;m.truss.visible=!!st.support||m.done;return}
 ["mid","drum"].forEach(function(s){if(m.gm[s]){deps.W.root.remove(m.gm[s]);m.gm[s]=null}});var x=m.gx0,r=.34;if(st.mid){var rm=GR[st.mid],g1=faceGear(rm,plastic("#ffd24d"));x+=r+rm+.06;g1.position.set(x,m.gy,-1.1);add(g1);m.gm.mid=g1;r=rm}
 if(st.drum){var rd=GR[st.drum],g2=faceGear(rd,plastic("#5af0b0"));x+=r+rd+.06;g2.position.set(x,m.gy,-1.1);add(g2);m.gm.drum=g2;m.dx=x;m.dr=rd}else{m.dx=m.px-.6;m.dr=0}
 m.drum.position.set(m.dx,m.gy,-1.05);m.drum.visible=!!st.drum||m.done;linearize(deps.W.root)}
function mWait(s){return new Promise(function(r){setTimeout(r,s*1000)})}
function textSprite(t,col,h){var c=document.createElement("canvas");c.width=256;c.height=128;var g=c.getContext("2d");g.font="800 80px Rubik, sans-serif";g.textAlign="center";g.textBaseline="middle";g.lineWidth=12;g.strokeStyle="rgba(6,18,43,.85)";g.strokeText(t,128,68);g.fillStyle=col;g.fillText(t,128,68);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;var s=new T.Sprite(new T.SpriteMaterial({map:tx,transparent:true}));s.scale.set(h*2,h,1);return s}
function riverAt(cx,w){var wp=new T.Mesh(new T.PlaneGeometry(w,9),new T.MeshPhysicalMaterial({color:"#2b9be0",roughness:.08,clearcoat:1,transparent:true,opacity:.9}));wp.rotation.x=-Math.PI/2;wp.position.set(cx,.04,0);wp.receiveShadow=true;add(wp);[-1,1].forEach(function(k){for(var z=-3.6;z<=3.6;z+=1.2){var r=rockMesh(.24+((Math.round(z*10)+k*3+30)%3)*.05,Math.round(z*10)+k*7+Math.round(cx));r.position.set(cx+k*(w/2+.1),.12,z);add(r)}})}
function clearG(g){while(g.children.length)g.remove(g.children[0])}
function mtWin(m,msg){m.done=true;S.mdone[mid(m)]=1;mWinNote(m);save();updHud();sfx.found();toast(msg)}
MT.measure={t:"Measure the gap",goal:"The marked gap is exact. Add beams of 2, 3, and 4 so they fit exactly, then press Test it.",actL:"Test it",rew:{bp:[],scrap:2,txt:"You measured the gap exactly."},gap:function(m){return tq(m,6,8,10)},u:function(m){return 3/this.gap(m)},
 x0:function(m){return m.x-1.5},list:function(m){var s=mst(m);return s.list||(s.list=[])},sum:function(m){return this.list(m).reduce(function(a,b){return a+b},0)},
 build:function(m){riverAt(m.x,3);m.rg=new T.Group();add(m.rg);m.bg=new T.Group();add(m.bg);m.chest=chestMesh();m.chest.position.set(m.x+2.6,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){var G=this.gap(m),u=this.u(m),x0=this.x0(m);if(m.rgG!==G){clearG(m.rg);m.rgG=G;for(var i=0;i<=G;i++){m.rg.add(M(new T.CylinderGeometry(.03,.03,.3,6),metal("#dfe6ff"),x0+i*u,.15,1.5));var sp0=textSprite(String(i),"#ffffff",.26);sp0.position.set(x0+i*u,.48,1.5);m.rg.add(sp0)}linearize(m.rg)}clearG(m.bg);var x=x0,cols={2:"#52b7ff",3:"#5af0b0",4:"#ffd24d"};this.list(m).forEach(function(n){var w=n*u;m.bg.add(M(rbox(w-.04,.18,1.4,.05),plastic(cols[n],{roughness:.5}),x+w/2,.13,0));var sp=textSprite(String(n),"#06122b",.26);sp.position.set(x+w/2,.42,.4);m.bg.add(sp);x+=w});linearize(m.bg)},
 hold:function(m){return this.x0(m)-.6},
 panel:function(m){var L0=this.list(m),s=this.sum(m),G=this.gap(m);return '<p class="mp-stat">'+(L0.length?L0.join(" + ")+" = "+s:"0")+" of "+G+(s===G?"  Just right!":"")+'</p><div class="mp-sb"><button class="ctl sm primary" type="button" data-a="2">Add 2</button><button class="ctl sm primary" type="button" data-a="3">Add 3</button><button class="ctl sm primary" type="button" data-a="4">Add 4</button><button class="ctl sm" type="button" data-a="0">Take one off</button></div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-a]").forEach(function(b){b.onclick=function(){mpPress(m,{a:b.dataset.a})}})},
 act:async function(m){var s=this.sum(m),x0=this.x0(m),G=this.gap(m),u=this.u(m);P.mDrive=true;$("#mp").hidden=true;notify();if(s<G){if(S.me[mkk(m)]==null)S.me[mkk(m)]=Math.abs(G-s);mFailNote(m);await walkTo(x0+Math.max(0,s*u-.5));sfx.bump&&sfx.bump();toast(s?"It needs "+(G-s)+" more to reach the other side.":"Add beams across the gap first.");await mWait(.5);await walkTo(x0-.8);mtFail(m);return}mtWin(m,"Exactly "+G+"! The beams fit perfectly.");await walkTo(m.x+2.8);P.mDrive=false},
 upd:function(m){if(m.done&&!P.showcase&&Math.abs(P.pos.x-m.x)<1.6)P.elev=.24}}
MT.balance={t:"Balance bridge",goal:"The bridge tips to the left. Add blocks on the right until it is level, then press Test it.",actL:"Test it",rew:{bp:[],scrap:2,txt:"You balanced both sides."},
 st:function(m){var s=mst(m);if(s.n1==null){s.n1=0;s.n2=0}return s},tq:function(m){var s=this.st(m);return {L:tq(m,4,6,8),R:s.n1+s.n2*2}},
 build:function(m){riverAt(m.x,3.4);add(M(new T.CylinderGeometry(.18,.28,1.2,12),metal("#8f9cd6"),m.x,-.2,0));m.pv=new T.Group();m.pv.position.set(m.x,.36,0);add(m.pv);m.pv.add(M(rbox(3.6,.16,1.4,.05),plastic("#b07a4a",{roughness:.55}),0,0,0));m.bl=new T.Group();m.pv.add(m.bl);m.ang=m.done?0:.22;m.chest=chestMesh();m.chest.position.set(m.x+2.6,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){clearG(m.bl);var s=this.st(m),bm=plastic("#a78bff",{roughness:.45}),lm=plastic("#ff9d5c",{roughness:.45});function stack(x,n,mat){for(var i=0;i<n;i++)m.bl.add(M(rbox(.34,.34,.34,.05),mat,x,.26+i*.36,0))}stack(-1.5,this.tq(m).L/2,lm);stack(.75,s.n1,bm);stack(1.5,s.n2,bm);[-1.5,-.75,.75,1.5].forEach(function(x){m.bl.add(M(new T.CylinderGeometry(.05,.05,.04,10),metal("#ffffff"),x,.1,.62))});linearize(m.bl)},
 hold:function(m){return m.x-2.1},
 panel:function(m){var s=this.st(m),t=this.tq(m);return '<p class="mp-stat">Left: '+(t.L/2)+' blocks far out = '+t.L+'<br>Right: '+s.n1+' near + '+s.n2+' far x 2 = '+t.R+(t.L===t.R?"  Level!":"")+'</p><div class="mp-sb"><button class="ctl sm primary" type="button" data-b="n1:1">Add near</button><button class="ctl sm primary" type="button" data-b="n2:1">Add far</button><button class="ctl sm" type="button" data-b="n1:-1">Take near</button><button class="ctl sm" type="button" data-b="n2:-1">Take far</button></div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-b]").forEach(function(b){b.onclick=function(){mpPress(m,{b:b.dataset.b})}})},
 act:async function(m){var t=this.tq(m);P.mDrive=true;$("#mp").hidden=true;notify();if(t.L!==t.R){if(S.me[mkk(m)]==null)S.me[mkk(m)]=Math.abs(t.L-t.R);mFailNote(m);await walkTo(m.x-1.95);sfx.bump&&sfx.bump();toast(t.R<t.L?"Still tipped left. A block far out pushes twice as hard as one near the middle.":"Now it tips right! Take a block off.");await mWait(.5);mtFail(m);return}mtWin(m,"Level! Both sides push the same.");await walkTo(m.x+2.8);P.mDrive=false},
 upd:function(m,dt){var t=this.tq(m),tg=m.done?0:Math.max(-.25,Math.min(.25,(t.L-t.R)*.07));m.ang+=(tg-m.ang)*Math.min(1,dt*3);m.pv.rotation.z=m.ang;if(m.done&&!P.showcase&&Math.abs(P.pos.x-m.x)<1.8)P.elev=.46}}
MT.logic={t:"Logic door",goal:"Put crates on the plates to open every door, then press Drive through.",actL:"Drive through",rew:{bp:[],scrap:2,txt:"You opened OR, AND, and NOT doors."},
 ord:function(m){var t=mTier(m);return t===3?[2,1,0]:t===2?[1,2]:[0,1,2]},st:function(m){var s=mst(m);if(s.g==null){s.g=0;s.A=this.ord(m)[0]===2?1:0;s.B=0}return s},out:function(m){var s=this.st(m),O=this.ord(m),G=O[Math.min(s.g,O.length-1)],A=!!s.A,B=!!s.B;return G===0?(A||B):G===1?(A&&B):!A},
 build:function(m){var x=m.x,fm=metal("#7f9bff");m.pA=x-3.4;m.pB=x-1.9;m.wOn=plastic("#ffd24d",{roughness:.3});m.wOn.emissive=new T.Color("#b88a10");m.wOff=plastic("#2a3566",{roughness:.6});
  [["A",m.pA],["B",m.pB]].forEach(function(p){m["pl"+p[0]]=M(rbox(.9,.08,.9,.03),plastic("#4a5aa2"),p[1],.05,.4);add(m["pl"+p[0]]);m["lb"+p[0]]=textSprite(p[0],"#ffffff",.36);m["lb"+p[0]].position.set(p[1],.34,1.2);add(m["lb"+p[0]]);m["w"+p[0]]=M(new T.BoxGeometry(x-.5-p[1],.05,.07),m.wOff,(p[1]+x-.5)/2,.05,p[0]==="A"?-.5:-.25);add(m["w"+p[0]])});
  add(M(rbox(.24,3,.24,.05),fm,x-.45,1.5,-1.1));add(M(rbox(.24,3,.24,.05),fm,x+.45,1.5,-1.1));add(M(rbox(1.2,.24,.3,.05),fm,x,3.05,-1.1));
  m.door=M(rbox(.7,2.7,2.4,.08),plastic("#4a66c8",{roughness:.4}),x,1.35,-.1);add(m.door);m.dy=m.done?2.6:0;m.lamp=M(new T.SphereGeometry(.15,14,10),new T.MeshStandardMaterial({color:"#ff9d5c",emissive:"#ff9d5c",emissiveIntensity:.9}),x,3.34,-.8);add(m.lamp);
  m.crates=new T.Group();add(m.crates);m.chest=chestMesh();m.chest.position.set(x+2.4,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){var s=this.st(m),O=this.ord(m),G=GATES[O[Math.min(s.g,O.length-1)]];clearG(m.crates);[["A",m.pA],["B",m.pB]].forEach(function(p){if(s[p[0]]){m.crates.add(M(rbox(.7,.7,.7,.06),plastic("#b07a4a",{roughness:.6}),p[1],.44,.4))}});var showB=G.g!=="NOT";m.plB.visible=m.lbB.visible=m.wB.visible=showB;
  if(m.gate)deps.W.root.remove(m.gate);m.gate=textSprite(m.done?"OPEN":G.g,"#ffd24d",.55);m.gate.position.set(m.x,3.75,-.9);add(m.gate);linearize(m.crates)},
 hold:function(m){return m.x-.95},
 panel:function(m){var s=this.st(m),O=this.ord(m),G=GATES[O[Math.min(s.g,O.length-1)]],o=this.out(m),h='<p class="mp-stat">Door '+(s.g+1)+' of '+O.length+': '+G.g+' gate, '+G.tag+'.<br>Door is <b style="color:'+(o?"#5af0b0":"#ff9d5c")+'">'+(o?"open":"shut")+'</b></p><div class="mp-sb">';
  h+='<button class="ctl sm'+(s.A?"":" primary")+'" type="button" data-p="A">'+(s.A?"Take crate off A":"Put crate on A")+'</button>';if(G.g!=="NOT")h+='<button class="ctl sm'+(s.B?"":" primary")+'" type="button" data-p="B">'+(s.B?"Take crate off B":"Put crate on B")+'</button>';return h+'</div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-p]").forEach(function(b){b.onclick=function(){mpPress(m,{p:b.dataset.p})}})},
 act:async function(m){var s=this.st(m),me=this,O=me.ord(m),gk=O[Math.min(s.g,O.length-1)],o=this.out(m);P.mDrive=true;$("#mp").hidden=true;notify();await walkTo(m.x-.95);
  if(!o){mFailNote(m);sfx.bump&&sfx.bump();toast(gk===0?"Shut. OR needs at least one plate pressed.":gk===1?((s.A||s.B)?"Only one plate is pressed. AND needs both at once.":"Shut. AND needs both plates pressed."):"Shut. NOT flips it: the plate is pressed, so the door stays shut. Take the crate off.");await mWait(.5);await walkTo(m.x-1.4);mtFail(m);return}
  if(s.g<O.length-1){sfx.found();s.g++;s.A=O[s.g]===2?1:0;s.B=0;save();toast("Opened! Next door: "+GATES[O[s.g]].g+". "+GATES[O[s.g]].tag+".");await mWait(.4);me.sync(m);await walkTo(m.x-1.4);mtFail(m);return}
  mtWin(m,"Every door is open. Logic wins!");me.sync(m);await walkTo(m.x+2.6);P.mDrive=false},
 upd:function(m,dt){var o=m.done||this.out(m),s=this.st(m);m.dy+=((o?2.6:0)-m.dy)*Math.min(1,dt*4);m.door.position.y=1.35+m.dy;m.lamp.material.color.set(o?"#5af0b0":"#ff9d5c");m.lamp.material.emissive.set(o?"#5af0b0":"#ff9d5c");m.wA.material=s.A?m.wOn:m.wOff;m.wB.material=s.B?m.wOn:m.wOff}}
MT.raft={t:"Raft builder",goal:"Add things to the raft so it carries your toy across. Up must beat down.",actL:"Go",rew:{bp:[],scrap:2,txt:"Your raft floated across."},
 st:function(m){var s=mst(m);if(!s.items)s.items=[];return s},net:function(m){var b=2,w=1;this.st(m).items.forEach(function(k){b+=RIT[k].b;w+=RIT[k].w});w+=4;return {b:b,w:w,n:b-w}},
 build:function(m){riverAt(m.x+2.6,5.2);m.rx=m.done?m.x+4.3:m.x+.75;m.ry=0;m.raft=new T.Group();add(m.raft);m.raft.add(M(rbox(1.6,.2,1.5,.05),plastic("#8a5a34",{roughness:.6}),0,.12,0));m.items=new T.Group();m.raft.add(m.items);m.stones=new T.Group();add(m.stones);m.chest=chestMesh();m.chest.position.set(m.x+6.6,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){var s=this.st(m);clearG(m.items);s.items.forEach(function(k,i){var x=-.5+i*.5,o;if(k==="log"){o=M(new T.CylinderGeometry(.13,.13,.9,12),plastic("#9a6a42"),x,.36,-.3);o.rotation.x=Math.PI/2}else if(k==="barrel")o=M(new T.CylinderGeometry(.18,.18,.42,14),plastic("#4a8fc8"),x,.44,-.35);else if(k==="crate")o=M(rbox(.36,.36,.36,.04),plastic("#b07a4a"),x,.4,-.35);else o=M(new T.DodecahedronGeometry(.2),plastic("#7d8bb8"),x,.4,-.35);m.items.add(o)});
  clearG(m.stones);if(m.done)for(var q=0;q<6;q++){var r=rockMesh(.3,q+3);r.position.set(m.x+.25+q*.85,.05,.25);m.stones.add(r)}linearize(m.raft);linearize(m.stones)},
 hold:function(m){return m.x+.75},
 panel:function(m){var s=this.st(m),n=this.net(m),need=tq(m,0,2,4),ok=n.n>=need,full=s.items.length>=3;return '<p class="mp-stat">Floats up: '+n.b+'<br>Weighs down: '+n.w+' (your toy is 4)<br><b style="color:'+(ok?"#5af0b0":"#ff9d5c")+'">'+(ok?"It will float":"It will sink")+(need>0?" (need +"+need+")":"")+'</b></p><div class="mp-sb">'+Object.keys(RIT).map(function(k){return '<button class="ctl sm'+(full?"":" primary")+'" type="button" data-r="'+k+'"'+(full?" disabled":"")+'>'+RIT[k].n+'</button>'}).join("")+'<button class="ctl sm" type="button" data-r="off">Take one off</button></div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-r]").forEach(function(b){b.onclick=function(){mpPress(m,{r:b.dataset.r})}})},
 act:async function(m){var n=this.net(m),need=tq(m,0,2,4),me=this;P.mDrive=true;$("#mp").hidden=true;notify();await walkTo(m.x+.75);await mWait(.3);
  if(n.n<need){mFailNote(m);sfx.bump&&sfx.bump();await new Promise(function(res){fx.push({t:0,d:1.2,f:function(k){m.ry=-.6*k},end:res})});toast(n.n<0?"It sank! "+n.w+" down beats "+n.b+" up. Barrels and logs float best.":"Almost! Up beats down by "+n.n+", and this tier needs +"+need+". Try barrels and logs.");await walkTo(m.x-.7);await new Promise(function(res){fx.push({t:0,d:.8,f:function(k){m.ry=-.6*(1-k)},end:res})});mtFail(m);return}
  var x0=m.rx;await new Promise(function(res){fx.push({t:0,d:2.4,f:function(k){m.rx=x0+(m.x+4.3-x0)*k;P.pos.x=m.rx},end:res})});mtWin(m,"It floats! Up beats down.");me.sync(m);await walkTo(m.x+6.9);P.mDrive=false},
 upd:function(m){m.raft.position.set(m.rx,m.ry+Math.sin(performance.now()/500)*.03,0);if(!P.showcase&&Math.abs(P.pos.x-m.rx)<.85)P.elev=.24+m.ry}}
function flyAway(obj,dx,dy){var p0=obj.position.clone();return new Promise(function(res){fx.push({t:0,d:.7,f:function(k){obj.position.set(p0.x+dx*k,p0.y+dy*Math.sin(Math.PI*k)*1.5-k*k*1.2,p0.z);obj.rotation.z=k*6},end:function(){obj.visible=false;res()}})})}
MT.lever={t:"Lever launch",goal:"Fling the star into the basket. Move the triangle, then press Drop.",actL:"Drop",rew:{bp:[],scrap:2,txt:"You flung the star into both baskets."},
 st:function(m){var s=mst(m);if(s.u==null){s.u=4;s.k=0}return s},by:function(m){return tq(m,[1.7,3.0],[2.2,3.4],[2.6,3.8])[Math.min(1,this.st(m).k)]},fx0:function(m){return m.x-1.6+this.st(m).u*.4},
 restAng:function(m){var ra=(8-this.st(m).u)*.4;return -Math.asin(Math.min(.95,.42/ra))},
 endPos:function(m,side){var f=this.fx0(m),a=m.ang,d=side>0?(m.x+1.6-f):-(f-(m.x-1.6));return {x:f+Math.cos(a)*d,y:.42+Math.sin(a)*d}},
 build:function(m){m.pl=new T.Group();add(m.pl);m.inner=new T.Group();m.pl.add(m.inner);m.inner.add(M(rbox(3.2,.12,.9,.04),plastic("#b07a4a",{roughness:.55}),0,0,0));for(var u=1;u<8;u++)m.inner.add(M(new T.CylinderGeometry(.04,.04,.03,8),metal("#ffffff"),-1.6+u*.4,.07,.4));
  var tri=new T.Shape();tri.moveTo(-.3,0);tri.lineTo(.3,0);tri.lineTo(0,.42);tri.closePath();var tg=new T.ExtrudeGeometry(tri,{depth:.8,bevelEnabled:false});tg.translate(0,0,-.4);m.fu=M(tg,plastic("#ff9d5c"),0,0,0);add(m.fu);
  m.post=M(new T.CylinderGeometry(.07,.08,1,10),metal("#8f9cd6"),0,0,-.5);add(m.post);m.bask=new T.Group();add(m.bask);m.bask.add(M(new T.CylinderGeometry(.45,.3,.32,18,1,true),new T.MeshPhysicalMaterial({color:"#ffd24d",roughness:.4,side:T.DoubleSide}),0,0,0));m.bask.add(M(new T.CylinderGeometry(.3,.3,.03,18),plastic("#c99a10"),0,-.16,0));
  m.star=M(STARGEO,metal("#ffd24d"),0,0,0);m.star.scale.setScalar(.7);add(m.star);m.chest=chestMesh();m.chest.position.set(m.x+3,0,-.6);add(m.chest);m.ang=0;this.sync(m)},
 sync:function(m){var f=this.fx0(m),by=this.by(m);m.fu.position.set(f,0,0);m.pl.position.set(f,.42,0);m.inner.position.x=m.x-f;m.ang=this.restAng(m);m.pl.rotation.z=m.ang;m.post.position.set(m.x+1.35,by/2,-.5);m.post.scale.y=by;m.bask.position.set(m.x+1.35,by,-.1);var e=this.endPos(m,1);m.star.position.set(e.x-.1,e.y+.25,.1);m.star.rotation.z=0;linearize(m.pl)},
 hold:function(m){return m.x-2.6},
 panel:function(m){var s=this.st(m),a=s.u,b=8-s.u,g=(function gc(x,y){return y?gc(y,x%y):x})(a,b);return '<p class="mp-stat">Basket '+(s.k+1)+' of 2<br>Toy side '+a+' : star side '+b+' ('+(a/g)+' : '+(b/g)+')</p><div class="mp-sb"><button class="ctl sm primary" type="button" data-l="-1">Triangle left</button><button class="ctl sm primary" type="button" data-l="1">Triangle right</button></div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-l]").forEach(function(b){b.onclick=function(){mpPress(m,{l:b.dataset.l})}})},
 act:async function(m){var s=this.st(m),me=this,lx=m.x-1.6;P.mDrive=true;$("#mp").hidden=true;notify();await walkTo(lx-.9);await hop(lx-.9,lx+.05,1.5,.55);sfx.bump&&sfx.bump();
  var la=s.u*.4,ra=(8-s.u)*.4,a0=m.ang,a1=Math.asin(Math.min(.95,.42/la));await new Promise(function(res){fx.push({t:0,d:.16,f:function(k){m.ang=a0+(a1-a0)*k;m.pl.rotation.z=m.ang},end:res})});
  var e=me.endPos(m,1),x0=e.x-.1,y0=e.y+.25,yy=y0,vy=4.2*ra/la,peak=y0,by=me.by(m),caught=false;tone(520,0,.25,"sawtooth",.04,1040);
  await new Promise(function(res){fx.push({t:0,d:2.6,f:function(k,dt){if(caught)return;vy-=12*dt;yy+=vy*dt;peak=Math.max(peak,yy);if(yy<y0&&vy<0)yy=y0;m.star.position.set(x0,yy,.1);m.star.rotation.z+=dt*7;if(vy<0&&yy<=by+.12&&peak>=by&&Math.abs(x0-(m.x+1.35))<.6){caught=true;m.star.position.set(m.x+1.35,by+.12,-.1)}},end:res})});
  await hop(P.pos.x,lx-.9,.8,.4);
  if(caught){sfx.found();if(s.k===0){s.k=1;save();toast("In the basket! Now the high basket.");await mWait(.6);me.sync(m);P.mDrive=false;resetNear();return}mtWin(m,"Both baskets! A longer star side flings it faster.");await walkTo(m.x+3.3);P.mDrive=false;return}
  if(S.me[mkk(m)]==null)S.me[mkk(m)]=1;mFailNote(m);sfx.bump&&sfx.bump();toast(peak<by?"Not high enough. Slide the triangle toward your toy so the star’s side is longer.":"Close, but it missed the basket.");await mWait(.4);me.sync(m);mtFail(m)}}
MT.circuit={t:"Light the cave",goal:"Join the battery to the lamp. Tap a square to lay a wire, tap again to turn it, then flip the switch.",actL:"Flip the switch",rew:{bp:[],scrap:2,txt:"You closed the circuit and lit the cave."},
 fixed:{"0,0":"h","4,1":"h"},rock:{"2,0":1},st:function(m){var s=mst(m);if(!s.c)s.c={};return s},cell:function(m,x,y){var k=x+","+y;return this.fixed[k]||this.st(m).c[k]||""},
 trace:function(m){var x=0,y=0,from=8,path=[],g=0;while(g++<20){if(this.rock[x+","+y])break;var mk=CSH[this.cell(m,x,y)]||0;if(!(mk&from))break;path.push(x+","+y);var out=mk&~from,nx=x,ny=y,nf;if(x===4&&y===1&&out===2)return {ok:true,path:path};if(out===1){ny--;nf=4}else if(out===4){ny++;nf=1}else if(out===2){nx++;nf=8}else{nx--;nf=2}if(nx<0||ny<0||nx>=5||ny>=2)break;x=nx;y=ny;from=nf}return {ok:false,path:path}},
 bx:function(m){return m.x-3.6},
 build:function(m){var bx=this.bx(m);add(M(rbox(3.3,1.5,.12,.05),plastic("#1c2550",{roughness:.6}),bx+1.4,1.75,-1.7));add(M(rbox(.5,.4,.3,.06),plastic("#2c3f94"),bx-.55,2.15,-1.6));add(M(rbox(.3,.22,.32,.04),plastic("#5af0b0"),bx-.55,2.15,-1.43));
  m.bulb=M(new T.SphereGeometry(.2,16,12),new T.MeshStandardMaterial({color:"#3a4684",emissive:"#000000"}),bx+3.3,1.45,-1.55);add(m.bulb);m.glow=glowSprite("rgba(255,226,140,0.8)",3);m.glow.position.set(bx+3.3,1.45,-1.3);m.glow.visible=false;add(m.glow);
  var r=rockMesh(1.3,41);r.position.set(m.x+1.4,1,-1.4);r.scale.set(1.3,1.1,.9);add(r);m.dark=darkSprite("rgba(2,6,26,A)",.96);m.dark.position.set(m.x+1.5,1,.2);m.dark.scale.set(3,2.6,1);add(m.dark);
  m.board=new T.Group();add(m.board);m.chest=chestMesh();m.chest.position.set(m.x+1.6,0,-.6);add(m.chest);if(m.done){m.dark.visible=false;m.glow.visible=true}this.sync(m)},
 sync:function(m){clearG(m.board);var bx=this.bx(m),tr=this.trace(m),lit={};tr.path.forEach(function(k){lit[k]=1});var on=plastic("#ffd24d",{roughness:.3}),off=plastic("#7d6a3a",{roughness:.6});on.emissive=new T.Color("#9a6a10");
  for(var y=0;y<2;y++)for(var x=0;x<5;x++){var cx=bx+x*.62+.2,cy=2.2-y*.62,k=x+","+y;m.board.add(M(rbox(.56,.56,.06,.05),plastic("#2a3566",{roughness:.6}),cx,cy,-1.62));if(this.rock[k]){var rr=rockMesh(.2,7);rr.position.set(cx,cy,-1.5);m.board.add(rr);continue}var mk=CSH[this.cell(m,x,y)]||0,mat=lit[k]?on:off;[[1,0,.15],[2,.15,0],[4,0,-.15],[8,-.15,0]].forEach(function(d){if(mk&d[0]){var seg=M(new T.BoxGeometry(d[1]?.32:.07,d[2]?.32:.07,.05),mat,cx+d[1],cy+d[2],-1.55);m.board.add(seg)}})}linearize(m.board)},
 hold:function(m){return m.x-.3},
 panel:function(m){var me=this,tr=this.trace(m),T=mTier(m),pw=(T<2?"Power reaches "+tr.path.length+" of 6 squares":(tr.ok?"Power is flowing!":"The loop has a gap somewhere"))+(tr.ok?" The loop is closed!":""),h='<p class="mp-stat">'+pw+'</p><div class="cgrid">';for(var y=0;y<2;y++)for(var x=0;x<5;x++){var k=x+","+y,fx0=me.fixed[k],rk=me.rock[k],g=rk?"rock":CGL[me.cell(m,x,y)];h+='<button type="button" class="cg'+((T<3&&tr.path.indexOf(k)>=0)?" on":"")+'" data-c="'+k+'"'+(fx0||rk?" disabled":"")+'>'+g+'</button>'}return h+'</div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-c]").forEach(function(b){b.onclick=function(){mpPress(m,{c:b.dataset.c})}})},
 act:async function(m){var tr=this.trace(m);P.mDrive=true;$("#mp").hidden=true;notify();noise(0,.05,4000,3000,.12);if(!tr.ok){mFailNote(m);await mWait(.3);sfx.bump&&sfx.bump();toast("Click! Nothing lights. Power stops after "+tr.path.length+" squares, so the loop has a gap.");mtFail(m);return}
  m.bulb.material.color.set("#fff3b0");m.bulb.material.emissive.set("#ffd24d");m.glow.visible=true;var d=m.dark;fx.push({t:0,d:1,f:function(k){d.material.opacity=.96*(1-k)},end:function(){d.visible=false}});mtWin(m,"The lamp lights the cave! A closed loop lets power flow.");await mWait(1);await walkTo(m.x+2);P.mDrive=false}}
MT.code={t:"Code cards",goal:"Line up move cards so your toy reaches the flag, then press Run. A wrong card turns red so you can fix it.",actL:"Run",rew:{bp:[],scrap:2,txt:"Your program reached the flag."},
 cells:["walk","rock","gap","pile","walk"],st:function(m){var s=mst(m);if(!s.p)s.p=[];return s},cx:function(m,i){return m.x-2+i},
 build:function(m){var me=this;m.rk=rockMesh(.42,13);add(m.rk);m.pit=M(new T.BoxGeometry(.85,.06,2.4),plastic("#0b1640",{roughness:.9}),this.cx(m,2),.02,0);add(m.pit);m.pile=new T.Group();add(m.pile);
  for(var i=0;i<5;i++){var sp=textSprite(String(i+1),"#ffffff",.3);sp.position.set(this.cx(m,i),.25,1.3);add(sp)}add(M(new T.CylinderGeometry(.04,.04,1.6,8),metal("#dfe6ff"),m.x+3,.8,-.3));add(M(new T.BoxGeometry(.6,.4,.03),plastic("#ffd24d"),m.x+3.3,1.4,-.3));m.chest=chestMesh();m.chest.position.set(m.x+3.6,0,-.9);add(m.chest);this.sync(m)},
 sync:function(m){m.rk.position.set(this.cx(m,1),.32,0);m.rk.rotation.set(0,0,0);m.rk.visible=!m.done;clearG(m.pile);m.pile.visible=!m.done;var cols=["#9a6a42","#6a7ab0","#b0566a","#8a7a9a"];for(var i=0;i<6;i++)m.pile.add(M(rbox(.3,.22,.3,.05),plastic(cols[i%4]),this.cx(m,3)+((i*37)%5-2)*.12,.12+Math.floor(i/3)*.2,((i*13)%3-1)*.15));linearize(m.pile)},
 hold:function(m){return m.x-2.9},
 panel:function(m){var s=this.st(m),h='<div class="cprog">';for(var i=0;i<5;i++){var c=s.p[i];h+='<button type="button" class="cp'+(s.bad===i&&mTier(m)<2?" bad":"")+'" data-q="'+i+'"'+(c?"":" disabled")+'>'+(c?CNM[c]:(i+1))+'</button>'}h+='</div><div class="mp-sb">';["walk","shove","dash","whirl"].forEach(function(k){h+='<button class="ctl sm primary" type="button" data-k="'+k+'"'+(s.p.length>=5?" disabled":"")+'>'+CNM[k]+'</button>'});return h+'</div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-k]").forEach(function(b){b.onclick=function(){mpPress(m,{k:b.dataset.k})}});$$("#mp-slots [data-q]").forEach(function(b){b.onclick=function(){mpPress(m,{q:b.dataset.q})}})},
 act:async function(m){var s=this.st(m),me=this;P.mDrive=true;$("#mp").hidden=true;notify();me.sync(m);await walkTo(m.x-2.9);
  for(var i=0;i<5;i++){var c=s.p[i],cell=me.cells[i],x=me.cx(m,i);if(!c){mFailNote(m);toast("Your toy ran out of cards. Add a card for step "+(i+1)+".");mtFail(m);return}
   if(CNEED[cell]!==c){mFailNote(m);s.bad=i;save();await walkTo(x-.75);sfx.bump&&sfx.bump();toast(CNM[c]+" can’t get past the "+CON[cell]+". Which card fits step "+(i+1)+"?");await mWait(.4);me.sync(m);mtFail(m);return}
   if(c==="shove"){sfx.bump&&sfx.bump();await flyAway(m.rk,1.4,.4);await walkTo(x)}else if(c==="dash"){tone(400,0,.3,"sawtooth",.04,900);await hop(P.pos.x,x+.2,1.2,.55)}else if(c==="whirl"){tone(300,0,.4,"triangle",.05,700);var ps=m.pile.children.slice();await Promise.all(ps.map(function(o,j){return flyAway(o,(j%2?1:-1)*(.6+j*.1),.8)}));await walkTo(x)}else await walkTo(x)}
  mtWin(m,"Your program worked! Steps in the right order reach the flag.");await walkTo(m.x+3.9);P.mDrive=false}}
function prRounds(m){return mTier(m)===3?4:3}
MT.pattern={t:"Pattern lock",goal:"Listen to the bells and finish the pattern to open the gate. Each color has its own shape.",actL:"Listen",rew:{bp:[],scrap:2,txt:"You cracked every pattern."},
 st:function(m){var s=mst(m);if(s.r==null){s.r=0;s.f=[]}return s},
 build:function(m){add(M(rbox(4.2,.14,.3,.05),plastic("#8a5a34"),m.x-1.6,2.3,-1.2));[-3.6,.4].forEach(function(dx){add(M(new T.CylinderGeometry(.06,.06,2.3,8),plastic("#6b4423"),m.x+dx,1.15,-1.2))});m.bells=new T.Group();add(m.bells);
  m.gate=new T.Group();m.gate.position.set(m.x+.9,0,0);add(m.gate);[-.9,.9].forEach(function(z){m.gate.add(M(new T.CylinderGeometry(.08,.08,2.2,10),metal("#7f9bff"),0,1.1,z))});for(var b=0;b<5;b++)m.gate.add(M(new T.CylinderGeometry(.035,.035,1.8,8),metal("#cfd8ff"),0,.4+b*.38,0).rotateX(Math.PI/2));m.gy=m.done?2.3:0;
  m.chest=chestMesh();m.chest.position.set(m.x+2.6,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){var s=this.st(m),R=PR[Math.min(prRounds(m)-1,s.r)],all=R.seq.concat(R.ans.map(function(a,i){return s.f[i]||null}));clearG(m.bells);var n=all.length,x0=m.x-1.6-(n-1)*.3;all.forEach(function(k,i){var x=x0+i*.6,g=new T.Group();g.position.set(x,1.85,-1.1);g.add(M(new T.CylinderGeometry(.015,.015,.4,6),metal("#cfd8ff"),0,.25,0));if(k){g.add(M(new T.SphereGeometry(.2,18,14),plastic(PB[k].c,{clearcoat:1}),0,0,0));var sp=textSprite(PB[k].s,"#ffffff",.22);sp.position.set(0,0,.24);g.add(sp)}else{var q=textSprite("?","#ffd24d",.36);g.add(q)}g.userData.k=k;m.bells.add(g)});linearize(m.bells)},
 hold:function(m){return m.x+.4},
 play:async function(m){var s=this.st(m),seq=PR[Math.min(prRounds(m)-1,s.r)].seq;for(var i=0;i<seq.length;i++){var b=m.bells.children[i];if(!b)return;bellTone(seq[i]);(function(b){fx.push({t:0,d:.35,f:function(k){b.position.y=1.85+Math.sin(Math.PI*k)*.2}})})(b);await mWait(.45)}},
 panel:function(m){var s=this.st(m),R=PR[Math.min(prRounds(m)-1,s.r)],h='<p class="mp-stat">Pattern '+(s.r+1)+' of '+prRounds(m)+'</p><div class="pseq">';R.seq.forEach(function(k){h+='<span style="background:'+PB[k].c+'">'+PB[k].s+'</span>'});R.ans.forEach(function(a,i){var k=s.f[i];h+=k?'<span style="background:'+PB[k].c+'">'+PB[k].s+'</span>':'<span class="q">?</span>'});h+='</div><div class="mp-sb">';Object.keys(PB).forEach(function(k){h+='<button class="ctl sm" type="button" data-pb="'+k+'" style="border-color:'+PB[k].c+'">'+PB[k].s+' '+k+'</button>'});return h+'</div>'},
 bind:function(m){var me=this;$$("#mp-slots [data-pb]").forEach(function(b){b.onclick=function(){mpPress(m,{pb:b.dataset.pb})}})},
 check:function(m){var s=this.st(m),R=PR[Math.min(prRounds(m)-1,s.r)],me=this,ok=s.f.every(function(k,i){return k===R.ans[i]});setTimeout(async function(){if(ok){sfx.found();if(s.r<prRounds(m)-1){s.r++;s.f=[];save();toast("Yes! The part that repeats tells you what comes next.");me.sync(m);mtPanel(m);await mWait(.5);me.play(m)}else{P.mDrive=true;$("#mp").hidden=true;notify();mtWin(m,"The lock opens! You spotted every pattern.");fx.push({t:0,d:1,f:function(k){m.gy=2.3*k}});await mWait(1.1);await walkTo(m.x+2.9);P.mDrive=false}}else{mFailNote(m);sfx.bump&&sfx.bump();toast("Not quite. Listen again and find the part that repeats.");s.f=[];save();me.sync(m);mtPanel(m);await mWait(.4);if(mTier(m)<2)me.play(m)}},350)},
 act:function(m){this.play(m)},
 upd:function(m){m.gate.position.y=m.gy||0}}
MT.clean={t:"Clean-up time",goal:"A messy little creature made a mess! Clean it up, fix the table, then share dinner.",rew:{bp:[],scrap:3,txt:"Clean, fixed, and dinner shared. Teamwork!"},
 actL:function(m){var g=this.st(m).g;return g===2?"Eat together":"Check"},
 st:function(m){var s=mst(m);if(s.g==null){s.g=0;s.cl={};s.fx={};s.pl=[0,0,0];s.soap=0;s.ok=0;s.tool="vacuum"}return s},
 build:function(m){var me=this,s=this.st(m);m.mess={};[["crumbs",m.x-3],["puddle",m.x-2.2],["jam",m.x-1.4]].forEach(function(d){var g=new T.Group();g.position.set(d[1],.03,.7);if(d[0]==="crumbs")for(var i=0;i<10;i++)g.add(M(new T.SphereGeometry(.05+(i%3)*.02,8,6),plastic(i%2?"#c98a4a":"#8a5a34"),((i*37)%9-4)*.06,.03,((i*23)%7-3)*.05));else if(d[0]==="puddle"){var p=M(new T.CircleGeometry(.4,24),new T.MeshPhysicalMaterial({color:"#52b7ff",transparent:true,opacity:.7,roughness:.05,clearcoat:1}),0,.01,0);p.rotation.x=-Math.PI/2;p.scale.set(1.2,.7,1);g.add(p)}else{var j=M(new T.SphereGeometry(.24,16,10),plastic("#9a1a4a",{clearcoat:1}),0,0,0);j.scale.set(1.2,.25,.8);g.add(j)}g.visible=!s.cl[d[0]]&&!m.done;add(g);m.mess[d[0]]=g});
  m.tbl=new T.Group();m.tbl.position.set(m.x,0,-.6);add(m.tbl);m.tbl.add(M(rbox(2.4,.14,1.2,.05),plastic("#a8744a",{roughness:.5}),0,.9,0));[[-1,-.45],[1,-.45],[-1,.45],[1,.45]].forEach(function(p){m.tbl.add(M(new T.CylinderGeometry(.06,.06,.84,8),plastic("#8a5a34"),p[0],.42,p[1]))});
  m.plates=[];for(var i=0;i<3;i++){var pg=new T.Group();pg.position.set(-.7+i*.7,.98,.15);pg.add(M(new T.CylinderGeometry(.24,.24,.03,20),plastic("#f4f6ff")));m.tbl.add(pg);m.plates.push(pg)}
  var cr=buildToy("character",{base:"creature",eyes:"big",ears:"horns",hat:"none",back:"none",tail:"curly"},{c1:"#5af0b0",c2:"#fff0c8",skin:"#f2b98c"});m.cre=cr.g;m.cre.scale.setScalar(.75);m.cre.position.set(m.x+1.7,0,-.2);m.cre.rotation.y=-Math.PI/2;add(m.cre);linearize(m.cre);
  m.chest=chestMesh();m.chest.position.set(m.x+3,0,-.6);add(m.chest);this.sync(m)},
 sync:function(m){var s=this.st(m);for(var k in m.mess)m.mess[k].visible=!s.cl[k]&&!m.done;m.plates.forEach(function(pg,i){while(pg.children.length>1)pg.remove(pg.children[1]);for(var c=0;c<s.pl[i];c++)pg.add(M(new T.CylinderGeometry(.09,.09,.04,14),plastic("#c98a4a"),-.08+c*.16,.04+(c%2)*.02,0))});linearize(m.tbl)},
 hold:function(m){return m.x-3.4},
 panel:function(m){var s=this.st(m),h="";
  if(s.g===0){h='<p class="mp-stat">Step 1 of 3: clean up. Pick a tool, then tap a mess.</p><div class="mp-sb">'+["vacuum","mop","sponge"].map(function(k){return '<button class="ctl sm'+(s.tool===k?" primary":"")+'" type="button" data-t="'+k+'">'+CTN[k]+'</button>'}).join("")+'</div>';
   if(s.tool==="sponge"&&!s.ok)h+='<p class="mp-stat">Mix the soapy water first. Soap drops: '+s.soap+(s.soap<soapWin(m)[0]?" (not enough)":s.soap>soapWin(m)[1]?" (too much: slippery suds!)":" (just right)")+'</p><div class="mp-sb"><button class="ctl sm primary" type="button" data-s="add">Add soap</button><button class="ctl sm" type="button" data-s="pour">Pour out</button><button class="ctl sm'+(s.soap>=soapWin(m)[0]&&s.soap<=soapWin(m)[1]?" primary":"")+'" type="button" data-s="ready">Ready</button></div>';
   h+='<div class="mp-sb">'+["crumbs","puddle","jam"].map(function(k){return s.cl[k]?'<button class="ctl sm" type="button" disabled>'+(k==="jam"?"Sticky jam":k[0].toUpperCase()+k.slice(1))+' clean</button>':'<button class="ctl sm primary" type="button" data-m="'+k+'">Clean the '+(k==="jam"?"sticky jam":k)+'</button>'}).join("")+'</div>'}
  else if(s.g===1){h='<p class="mp-stat">Step 2 of 3: fix the wobbly table. Pick a tool on your tool belt, then tap what it fits. Holding: '+(S.tool?TK[S.tool].n:"nothing")+'</p><div class="mp-sb">'+["nail","bolt","screw"].map(function(k){return s.fx[k]?'<button class="ctl sm" type="button" disabled>'+k+' fixed</button>':'<button class="ctl sm primary" type="button" data-f="'+k+'">Fix the '+k+(k==="screw"&&s.hole?" (hole ready)":"")+'</button>'}).join("")+'</div>'}
  else h='<p class="mp-stat">Step 3 of 3: share 6 cookies fairly. Plates: '+s.pl.join(", ")+'. Left: '+(6-s.pl.reduce(function(a,b){return a+b},0))+'</p><div class="mp-sb">'+[0,1,2].map(function(i){return '<button class="ctl sm primary" type="button" data-c="'+i+':1">Plate '+(i+1)+' +</button><button class="ctl sm" type="button" data-c="'+i+':-1">Plate '+(i+1)+' -</button>'}).join("")+'</div>';
  return h},
 bind:function(m){var me=this,s=this.st(m);
  $$("#mp-slots [data-t]").forEach(function(b){b.onclick=function(){mpPress(m,{t:b.dataset.t})}});
  $$("#mp-slots [data-s]").forEach(function(b){b.onclick=function(){mpPress(m,{s:b.dataset.s})}});
  $$("#mp-slots [data-m]").forEach(function(b){b.onclick=function(){mpPress(m,{m:b.dataset.m})}});
  $$("#mp-slots [data-f]").forEach(function(b){b.onclick=function(){mpPress(m,{f:b.dataset.f})}});
  $$("#mp-slots [data-c]").forEach(function(b){b.onclick=function(){mpPress(m,{c:b.dataset.c})}})},
 act:async function(m){var s=this.st(m),me=this;if(s.g===0){toast("Messes left: "+["crumbs","puddle","jam"].filter(function(k){return !s.cl[k]}).length+". Match each mess to its tool.");return}if(s.g===1){toast("Fixed: "+Object.keys(s.fx).length+" of 3. Nails, bolts, and screws each need their own tool.");return}
  var tot=s.pl.reduce(function(a,b){return a+b},0);if(tot<6){toast("Share all 6 cookies first.");return}if(!(s.pl[0]===s.pl[1]&&s.pl[1]===s.pl[2])){mFailNote(m);toast("Not fair yet: "+s.pl.join(", ")+". Make every plate the same.");sfx.bump&&sfx.bump();return}
  P.mDrive=true;$("#mp").hidden=true;notify();for(var r=0;r<2;r++)for(var i=0;i<3;i++){s.pl[i]--;me.sync(m);noise(0,.12,2200,1600,.1);tone(140,0,.1,"sine",.08);await mWait(.3)}mtWin(m,"Yum! 6 cookies shared by 3 friends is 2 each.");joy();await walkTo(m.x+3.3);P.mDrive=false},
 upd:function(m){var s=this.st(m);if(m.tbl)m.tbl.rotation.z=s.g<2&&!m.done?Math.sin(performance.now()/120)*.02:0;if(m.cre)m.cre.position.y=Math.abs(Math.sin(performance.now()/300))*.12}}
  function faceGear(r,mat){var h=new T.Group(),gm=gear(r,.12,mat);gm.rotation.x=Math.PI/2;h.add(gm);return h}
  return {MT, mid, mTier, tq, mkk, mst, mFailNote, mWinNote, mStartReplay, mCancelReplay, clearG, mtWin, mSync, mWait, prRounds, faceGear, textSprite, riverAt, flyAway};
}
