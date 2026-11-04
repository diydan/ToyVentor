// Native world runtime: playerRig (5A Unit 2).
//
// Lifted verbatim from runtime/world.ts. No behavior change: statements keep
// their relative order and run once at import time, as before.
import * as THREE from "three";
import { INK } from "./catalog";
import { T, M, G, at, rbox, plastic, matte, metal, glowMat, paintMat, GLASS, BUBBLE, STARGEO, capsule, gear, hemiSphere, glowSprite, glowTex, canv } from "./worldScene";

export interface RigColors {
  c1: string;
  c2: string;
  skin?: string;
  /** The hair tone of a human head (a hex); the stock chestnut when missing. */
  hair?: string;
  /** The boot colour of the human Kip (a hex); the demo's orange when missing. */
  boots?: string;
}
export interface RigSel {
  wheels: string;
  chassis: string;
  shell: string;
  front: string;
  rear: string;
  legs: string;
  head: string;
  top: string;
  torso: string;
  arms: string;
  base: string;
  eyes: string;
  ears: string;
  hat: string;
  back: string;
  tail: string;
  prop: string;
  boots: string;
  [k: string]: string;
}
export interface WardrobeSpec {
  eye?: { x: number; y: number; z: number; r: number } | null;
  ear?: { x: number; y: number; s: number };
  hat?: { y: number; r: number };
  back?: { y: number; z: number; w: number };
  tail?: { y: number; z: number };
  lid?: string;
  neck?: number;
}
export interface WardrobeLayout {
  hd: THREE.Group;
  eye: { x: number; y: number; z: number; r: number } | null;
  ear: { x: number; y: number; s: number };
  hat: { y: number; r: number };
  back: { y: number; z: number; w: number };
  tail: { y: number; z: number };
  neck: number;
  h: number;
  w: number;
  lid: string;
}
export interface ToyRig {
  g: THREE.Group;
  slots: Record<string, THREE.Group>;
  wheels: THREE.Object3D[];
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  feet: THREE.Object3D[];
  eyes: THREE.Object3D[];
  wings: THREE.Object3D[];
  type: string;
  spinners?: THREE.Object3D[];
  flames?: THREE.Object3D[];
  flame?: THREE.Object3D;
  brows?: THREE.Object3D[];
  hover?: boolean;
  h?: number;
  wr?: number;
  w?: number;
  // Legacy dynamic bag: builders stash ad-hoc handles (chestGear, toolGears,
  // screen, ant, ...) that only exist for some archetypes.
  [k: string]: any;
}
export type SlotFn = (n: string) => THREE.Group;

var TREAD: THREE.Texture | null = null;
function treadTex(): THREE.Texture {if(TREAD)return TREAD;if(typeof document==="undefined"){var dt=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);dt.wrapS=dt.wrapT=T.RepeatWrapping;dt.needsUpdate=true;TREAD=dt;return TREAD}var c=document.createElement("canvas");c.width=256;c.height=32;var g=c.getContext("2d")!;g.fillStyle="#ffffff";g.fillRect(0,0,256,32);g.fillStyle="#000000";for(var i=0;i<256;i+=16){g.beginPath();g.moveTo(i,0);g.lineTo(i+6,0);g.lineTo(i+12,32);g.lineTo(i+6,32);g.fill()}var ct=new T.CanvasTexture(c);ct.wrapS=ct.wrapT=T.RepeatWrapping;TREAD=ct;return TREAD}

function buildToy(type: string, sel: RigSel, col: RigColors): ToyRig {
 var rig: ToyRig={g:new T.Group(),slots:{},wheels:[],legs:[],arms:[],feet:[],eyes:[],wings:[],type:type},c1=plastic(col.c1),c2=plastic(col.c2),ink=plastic(INK,{roughness:.6,clearcoat:.2});
 function slot(n: string): THREE.Group {var g=new T.Group();rig.slots[n]=g;rig.g.add(g);return g}
 if(type==="vehicle"){
  var wr=sel.wheels==="big"?.46:sel.wheels==="tread"?.4:.34,top: number;
  var sw=slot("wheels");
  if(sel.wheels==="tread"){[.72,-.72].forEach(function(z){sw.add(M(rbox(2.2,.62,.36,.2),ink,0,wr,z));for(var i=-1;i<=1;i++){var rl=wheelMesh(.18,.38);rl.position.set(i*.75,wr,z);sw.add(rl);rig.wheels.push(rl)}})}
  else ([[.85,.72],[.85,-.72],[-.85,.72],[-.85,-.72]] as [number, number][]).forEach(function(p){var w=wheelMesh(wr,sel.wheels==="big"?.36:.3);w.position.set(p[0],wr,p[1]);sw.add(w);rig.wheels.push(w)});
  var sc=slot("chassis");
  var FR2=sel.chassis==="truck"?1.6:sel.chassis==="car"?1.5:1.34,RR2=sel.chassis==="buggy"?-1.25:-1.5;
  if(sel.chassis==="car"){var cb=carBody("car",wr,c1);sc.add(cb);top=cb.position.y+cb.userData.top+.06;[.71,-.71].forEach(function(z){sc.add(M(new T.BoxGeometry(.025,.36,.02),plastic("#2a1a2a"),.12,cb.position.y+.42,z*1.01));sc.add(M(rbox(.16,.05,.04,.02),metal("#dfe6ff"),-.12,cb.position.y+.55,z*1.02))})}
  else if(sel.chassis==="truck"){var tb=carBody("truck",wr,c1);sc.add(tb);top=tb.position.y+tb.userData.top+.06;[.7,-.7].forEach(function(z){sc.add(M(rbox(1.2,.3,.1,.04),c1,-.85,top+.13,z))});sc.add(M(rbox(.1,.3,1.5,.04),c1,-1.5,top+.13,0))}
  else{sc.add(M(rbox(2.4,.28,1.3,.1),c1,0,wr+.25,0));[[.7,.55],[.7,-.55],[-.7,.55],[-.7,-.55]].forEach(function(p){sc.add(M(new T.CylinderGeometry(.05,.05,.8,8),ink,p[0],wr+.75,p[1]))});sc.add(M(new T.BoxGeometry(1.5,.08,.08),ink,0,wr+1.15,.55));sc.add(M(new T.BoxGeometry(1.5,.08,.08),ink,0,wr+1.15,-.55));top=wr+.39}
  [.42,-.42].forEach(function(z){sc.add(M(new T.SphereGeometry(.1,14,10),glowMat("#fff5c2",2.2),sel.chassis==="buggy"?1.18:FR2-.06,sel.chassis==="buggy"?wr+.48:wr+.3,z));if(sel.chassis!=="buggy")sc.add(M(new T.TorusGeometry(.11,.025,8,20),metal("#dfe6ff"),FR2-.05,wr+.3,z).rotateY(Math.PI/2))});
  var ss=slot("shell");
  if(sel.shell==="sedan"){ss.add(cabinBody(top-.03,c2,rig))}
  else if(sel.shell==="open"){var ws=M(new T.BoxGeometry(.06,.42,1.0),GLASS,.5,top+.2,0);ws.rotation.z=.25;ss.add(ws);ss.add(M(rbox(.42,.42,.6,.1),c2,-.35,top+.2,0));var hd=new T.Group();hd.position.set(-.2,top+.62,0);hd.add(M(new T.SphereGeometry(.22,20,16),plastic("#ffd9b0")));eyes(hd,.16,.03,0,.6,rig);hd.add(at(hemiSphere(.24,c2),0,.04,0));ss.add(hd)}
  else{ss.add(at(hemiSphere(.78,BUBBLE),-.1,top,0));var hd2=new T.Group();hd2.position.set(-.1,top+.3,0);hd2.add(M(new T.SphereGeometry(.24,20,16),plastic("#ffd9b0")));eyes(hd2,.18,.03,0,.65,rig);ss.add(hd2);ss.add(M(new T.CylinderGeometry(.8,.8,.08,28),c2,-.1,top,0))}
  var sf=slot("front");
  if(sel.front==="bumper"){sf.add(M(rbox(.2,.24,1.36,.08),metal("#c9d3f0"),FR2,wr+.12,0))}
  else if(sel.front==="plow"){var pl=M(rbox(.12,.7,1.75,.05),c1,FR2+.25,wr+.18,0);pl.rotation.z=.35;sf.add(pl);sf.add(M(new T.BoxGeometry(.4,.08,.08),ink,FR2+.05,wr+.24,.4));sf.add(M(new T.BoxGeometry(.4,.08,.08),ink,FR2+.05,wr+.24,-.4))}
  else{sf.add(M(rbox(.28,.12,1.0,.05),ink,.95,top+.06,0));[-.32,0,.32].forEach(function(z){sf.add(M(new T.SphereGeometry(.07,10,8),glowMat("#ffd24d",2.4),1.05,top+.08,z))})}
  var sr=slot("rear");
  if(sel.rear==="spoiler"){sr.add(M(new T.BoxGeometry(.5,.07,1.3),c2,-1.12,wr+1.0,0));[.45,-.45].forEach(function(z){sr.add(M(new T.BoxGeometry(.07,.32,.07),ink,-1.12,wr+.8,z))})}
  else if(sel.rear==="booster"){var nz=M(new T.CylinderGeometry(.2,.27,.5,18),metal("#ffd24d"),RR2-.12,wr+.45,0);nz.rotation.z=Math.PI/2;sr.add(nz);var fl=M(new T.ConeGeometry(.2,.6,16),glowMat("#ff9d5c",2),RR2-.62,wr+.45,0);fl.rotation.z=Math.PI/2;fl.castShadow=false;sr.add(fl);rig.flame=fl}
  else{sr.add(M(new T.BoxGeometry(.4,.08,.08),ink,RR2-.1,wr+.2,0));var hk=M(new T.TorusGeometry(.13,.04,8,18,Math.PI*1.4),metal("#cfd6f0"),RR2-.35,wr+.09,0);hk.rotation.z=Math.PI*.8;sr.add(hk)}
  rig.h=top+.8;rig.wr=wr;rig.w=3.7;
 }else if(type==="robot"){buildRobot2(sel,rig,slot,c1,c2,col)}else{buildChar3(sel,rig,slot,col);if(rig.slots.hat&&sel.hat!=="none")rig.slots.extra=rig.slots.hat}
 return rig}
function wheelMesh(r: number, w: number): THREE.Group {var g=new T.Group(),pts=[],ri=r*.6;pts.push(new T.Vector2(ri,-w/2),new T.Vector2(r*.9,-w/2),new T.Vector2(r*.985,-w*.4),new T.Vector2(r,-w*.22),new T.Vector2(r,w*.22),new T.Vector2(r*.985,w*.4),new T.Vector2(r*.9,w/2),new T.Vector2(ri,w/2));
 var tm=new T.MeshPhysicalMaterial({color:"#1c2550",roughness:.75,clearcoat:.1,bumpMap:treadTex(),bumpScale:.04,envMapIntensity:.3});tm.bumpMap!.repeat.set(1,1);var tire=M(new T.LatheGeometry(pts,40),tm);tire.rotation.x=Math.PI/2;g.add(tire);
 var rim=M(new T.CylinderGeometry(ri,ri,w*.82,28,1),metal("#c9d3f0"));rim.rotation.x=Math.PI/2;g.add(rim);
 var face2=M(new T.CylinderGeometry(ri*.86,ri*.86,w*.9,28,1),plastic("#a3b2ef"));face2.rotation.x=Math.PI/2;g.add(face2);
 for(var i=0;i<5;i++){var sp=M(new T.BoxGeometry(ri*.18,ri*.9,.04),plastic("#2a3566"),0,0,w*.46);sp.rotation.z=i/5*Math.PI*2;sp.position.set(Math.sin(sp.rotation.z)*-ri*.45,Math.cos(sp.rotation.z)*ri*.45,w*.46);g.add(sp);var sp2=sp.clone();sp2.position.z=-w*.46;g.add(sp2)}
 var cap=M(new T.SphereGeometry(ri*.32,16,10,0,Math.PI*2,0,Math.PI/2),metal("#e8eeff"));cap.rotation.x=Math.PI/2;cap.position.z=w*.47;g.add(cap);var cap2=cap.clone();cap2.rotation.x=-Math.PI/2;cap2.position.z=-w*.47;g.add(cap2);
 g.userData.r=r;return g}
function carBody(kind: string, wr: number, mat: THREE.Material): THREE.Mesh {var L=kind==="truck"?1.45:1.36,Ht=kind==="truck"?.86:.74,ar=Math.min(wr+.07,.5),ay=.26,fx=.85,rx=-.85,s=new T.Shape();
 s.moveTo(-L,.18);s.lineTo(-L,Ht-.2);s.quadraticCurveTo(-L,Ht,-L+.22,Ht);
 if(kind==="truck"){s.lineTo(L-.6,Ht);s.quadraticCurveTo(L-.3,Ht,L-.1,Ht-.18)}else{s.lineTo(.72,Ht-.02);s.quadraticCurveTo(1.06,Ht-.05,L-.1,Ht-.2)}
 s.quadraticCurveTo(L,Ht-.28,L,Ht-.42);s.lineTo(L,.18);s.quadraticCurveTo(L,.06,L-.12,.06);
 s.lineTo(fx+ar,.06);s.absarc(fx,ay,ar,0,Math.PI,false);s.lineTo(fx-ar,.06);s.lineTo(rx+ar,.06);s.absarc(rx,ay,ar,0,Math.PI,false);s.lineTo(rx-ar,.06);s.lineTo(-L+.12,.06);s.quadraticCurveTo(-L,.06,-L,.18);
 var geo=new T.ExtrudeGeometry(s,{depth:1.16,bevelEnabled:true,bevelThickness:.12,bevelSize:.1,bevelSegments:5,curveSegments:24});geo.translate(0,0,-.58);var m=M(geo,mat);m.userData.top=Ht;m.userData.base=wr-ay;m.position.y=wr-ay;return m}
function cabinBody(y0: number, mat: THREE.Material, rig: ToyRig): THREE.Group {var g=new T.Group();g.position.set(-.1,y0,0);var sh=new T.Shape();sh.moveTo(-.72,0);sh.lineTo(-.6,.42);sh.quadraticCurveTo(-.56,.54,-.44,.54);sh.lineTo(.2,.54);sh.quadraticCurveTo(.32,.54,.37,.44);sh.lineTo(.64,0);sh.lineTo(-.72,0);
 var geo=new T.ExtrudeGeometry(sh,{depth:.98,bevelEnabled:true,bevelThickness:.1,bevelSize:.08,bevelSegments:5,curveSegments:16});geo.translate(0,0,-.49);g.add(M(geo,mat));
 var w1=new T.Shape();w1.moveTo(-.56,.1);w1.lineTo(-.49,.42);w1.lineTo(-.08,.44);w1.lineTo(-.08,.1);w1.lineTo(-.56,.1);var w2=new T.Shape();w2.moveTo(.02,.1);w2.lineTo(.02,.44);w2.lineTo(.22,.44);w2.quadraticCurveTo(.3,.44,.33,.38);w2.lineTo(.5,.1);w2.lineTo(.02,.1);
 [w1,w2].forEach(function(sp){var wg=new T.ExtrudeGeometry(sp,{depth:.02,bevelEnabled:false});[.595,-.615].forEach(function(z){var m=M(wg,GLASS);m.position.z=z;g.add(m)})});
 var ws=M(rbox(.04,.5,.94,.02),GLASS,.58,.27,0);ws.rotation.z=.53;g.add(ws);var rw=M(rbox(.04,.44,.88,.02),GLASS,-.75,.23,0);rw.rotation.z=-.27;g.add(rw);
 g.add(M(rbox(.5,.04,.7,.02),metal("#dfe6ff"),-.15,.6,0));
 eyes(g,.55,.3,0,.82,rig);return g}
function screenFace(): THREE.CanvasTexture {var c=document.createElement("canvas");c.width=128;c.height=96;var g=c.getContext("2d")!;g.fillStyle="#06142e";g.fillRect(0,0,128,96);g.fillStyle="#5af0b0";g.beginPath();g.ellipse(40,40,11,15,0,0,Math.PI*2);g.ellipse(88,40,11,15,0,0,Math.PI*2);g.fill();g.strokeStyle="#5af0b0";g.lineWidth=7;g.lineCap="round";g.beginPath();g.arc(64,56,22,.2*Math.PI,.8*Math.PI);g.stroke();g.fillStyle="rgba(90,240,176,.12)";for(var y=0;y<96;y+=4)g.fillRect(0,y,128,1);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx}
function spinner(g: THREE.Object3D, ax: string, sp: number, rig: ToyRig): THREE.Object3D {g.userData.ax=ax;g.userData.sp=sp;rig.spinners!.push(g);return g}
function propeller(r: number, colA: string, colB: string): THREE.Group {var g=new T.Group();g.add(M(new T.SphereGeometry(r*.22,12,10),metal("#dfe6ff")));[0,1].forEach(function(i){var b=M(rbox(r*2,.03,r*.42,.015),plastic(i?colB:colA),0,0,0);b.rotation.y=i*Math.PI/2;g.add(b)});return g}
function buildRobot2(sel: RigSel, rig: ToyRig, slot: SlotFn, c1: THREE.Material, c2: THREE.Material, col: RigColors): void {c1=paintMat(col.c1);c2=paintMat(col.c2);
 var chrome=metal("#c9d3f0"),dark=plastic("#16205a",{roughness:.5}),H: number;rig.spinners=[];rig.flames=[];
 var sl=slot("legs");
 if(sel.legs==="walkers"){H=.86;sl.add(M(rbox(.62,.2,.62,.08),dark,0,H+.04,0));[.25,-.25].forEach(function(z){var l=new T.Group();l.position.set(0,H,z);l.add(M(new T.SphereGeometry(.13,16,12),chrome));var th=capsule(.1,.2,c1);th.position.y=-.2;l.add(th);var ps=M(new T.CylinderGeometry(.025,.025,.34,8),metal("#dfe6ff"),.12,-.42,0);ps.rotation.z=.12;l.add(ps);l.add(M(new T.SphereGeometry(.11,14,10),chrome,0,-.42,0));var sh=capsule(.09,.2,c1);sh.position.y=-.6;l.add(sh);l.add(M(rbox(.46,.14,.3,.06),dark,.06,-.8,0));l.add(M(rbox(.1,.1,.28,.04),chrome,.27,-.8,0));sl.add(l);rig.legs.push(l)})}
 else if(sel.legs==="treads"){H=.64;var tm=new T.MeshPhysicalMaterial({color:"#1c2550",roughness:.75,bumpMap:treadTex(),bumpScale:.04});[.32,-.32].forEach(function(z){sl.add(M(rbox(1.04,.42,.28,.2),tm,0,.22,z));[-.33,0,.33].forEach(function(x){var r=wheelMesh(.13,.3);r.position.set(x,.22,z);sl.add(r);rig.wheels.push(r)})});sl.add(M(rbox(.56,.24,.56,.08),c1,0,.52,0));sl.add(M(new T.SphereGeometry(.14,14,10),chrome,0,.64,0))}
 else if(sel.legs==="wheels"){H=.68;var ax=M(new T.CylinderGeometry(.06,.06,.96,12),chrome,0,.32,0);ax.rotation.x=Math.PI/2;sl.add(ax);[.42,-.42].forEach(function(z){var w=wheelMesh(.32,.2);w.position.set(0,.32,z);sl.add(w);rig.wheels.push(w)});sl.add(M(rbox(.44,.34,.44,.12),c1,0,.56,0))}
 else if(sel.legs==="springs"){H=.94;sl.add(M(rbox(.62,.2,.62,.08),dark,0,H+.04,0));[.25,-.25].forEach(function(z){var l=new T.Group();l.position.set(0,H,z);l.add(M(new T.SphereGeometry(.12,14,10),chrome));for(var i=0;i<6;i++){var rg=M(new T.TorusGeometry(.12,.035,8,20),i%2?chrome:c1,0,-.14-i*.12,0);rg.rotation.x=Math.PI/2;l.add(rg)}l.add(M(rbox(.4,.08,.32,.03),dark,.04,-.88,0));sl.add(l);rig.legs.push(l)})}
 else{H=.82;rig.hover=true;sl.add(M(new T.CylinderGeometry(.44,.32,.2,28),c1,0,.52,0));sl.add(M(new T.TorusGeometry(.44,.04,8,32),chrome,0,.6,0).rotateX(Math.PI/2));[.2,-.2].forEach(function(z){sl.add(M(new T.CylinderGeometry(.1,.13,.22,16),dark,0,.34,z));var f=M(new T.ConeGeometry(.1,.42,14),new T.MeshStandardMaterial({color:"#9bd4ff",emissive:"#52b7ff",emissiveIntensity:2.2,transparent:true,opacity:.85}),0,.03,z);f.rotation.x=Math.PI;f.castShadow=false;sl.add(f);rig.flames!.push(f)});var hg=glowSprite("rgba(82,183,255,0.6)",1.4);hg.position.set(0,.05,0);sl.add(hg)}
 var cy=H+.56,st=slot("torso");
 if(sel.torso==="box"){st.add(M(rbox(.95,1.0,.78,.18),c2,0,cy,0));st.add(M(rbox(.06,.58,.58,.05),dark,.47,cy+.06,0));([["#ff6a5c",.16],["#ffd24d",0],["#5af0b0",-.16]] as [string, number][]).forEach(function(l){st.add(M(new T.SphereGeometry(.055,12,8),glowMat(l[0],2.2),.51,cy+.2,l[1]))});[-.08,-.16,-.24].forEach(function(y){st.add(M(rbox(.03,.03,.42,.01),chrome,.5,cy+y,0))});([[.38,.32],[.38,-.32],[-.38,.32],[-.38,-.32]] as [number, number][]).forEach(function(p){st.add(M(new T.SphereGeometry(.035,8,6),chrome,.49,cy+p[0],p[1]))})}
 else if(sel.torso==="tank"){st.add(M(rbox(1.06,1.1,.92,.3),c2,0,cy+.04,0));st.add(M(new T.TorusGeometry(.27,.05,10,28),chrome,.56,cy+.06,0).rotateY(Math.PI/2));var gw=gear(.22,.08,plastic("#a78bff"));gw.position.set(.55,cy+.06,0);gw.rotation.z=Math.PI/2;st.add(gw);rig.chestGear=gw;for(var q=0;q<8;q++){var a=q/8*Math.PI*2;st.add(M(new T.SphereGeometry(.03,8,6),chrome,.57,cy+.06+Math.sin(a)*.36,Math.cos(a)*.36))}}
 else if(sel.torso==="barrel"){var bp=[];for(var i=0;i<=10;i++){var u=i/10;bp.push(new T.Vector2(.42+.08*Math.sin(u*Math.PI),u*1.04-.52))}st.add(M(new T.LatheGeometry(bp,32),c2,0,cy,0));[-.34,0,.34].forEach(function(y){st.add(M(new T.TorusGeometry(.5,.035,8,32),chrome,0,cy+y,0).rotateX(Math.PI/2))});st.add(M(rbox(.06,.34,.3,.04),dark,.5,cy+.17,0))}
 else if(sel.torso==="core"){st.add(M(new T.SphereGeometry(.56,32,24),c2,0,cy,0));st.add(M(new T.TorusGeometry(.565,.04,10,40),chrome,0,cy,0).rotateX(Math.PI/2));st.add(M(new T.TorusGeometry(.24,.045,10,28),chrome,.48,cy+.05,0).rotateY(Math.PI/2));var cm=new T.MeshStandardMaterial({color:"#5af0b0",emissive:"#5af0b0",emissiveIntensity:2,roughness:.3});var core=M(new T.SphereGeometry(.17,20,16),cm,.44,cy+.05,0);st.add(core);rig.core=core;st.add(M(new T.SphereGeometry(.23,20,16),GLASS,.46,cy+.05,0))}
 else{st.add(M(rbox(.95,1.0,.78,.18),c2,0,cy,0));st.add(M(rbox(.06,.4,.5,.04),dark,.47,cy+.1,0));st.add(M(rbox(.42,.72,.62,.12),dark,-.6,cy+.05,0));[.18,-.18].forEach(function(z){st.add(M(new T.CylinderGeometry(.11,.14,.3,16),chrome,-.72,cy-.42,z));var f=M(new T.ConeGeometry(.1,.4,14),new T.MeshStandardMaterial({color:"#ffd24d",emissive:"#ff9d5c",emissiveIntensity:2.4,transparent:true,opacity:.9}),-.72,cy-.76,z);f.rotation.x=Math.PI;f.castShadow=false;st.add(f);rig.flames!.push(f)})}
 if(sel.torso!=="jet"){st.add(M(rbox(.24,.52,.46,.08),dark,-.52,cy+.06,0));st.add(M(rbox(.26,.06,.48,.02),metal("#ffd24d"),-.52,cy+.2,0))}st.add(M(new T.TorusGeometry(.26,.04,8,24),chrome,0,cy+.54,0).rotateX(Math.PI/2));
 var sa=slot("arms");
 [.62,-.62].forEach(function(z,i){var a=new T.Group();a.position.set(0,H+.96,z);a.add(M(new T.SphereGeometry(.16,18,12),chrome));var up=capsule(.1,.18,c1);up.position.y=-.2;a.add(up);a.add(M(new T.SphereGeometry(.1,14,10),chrome,0,-.4,0));var fo=capsule(.09,.18,c1);fo.position.y=-.58;a.add(fo);a.add(M(rbox(.24,.26,.24,.07),c2,0,-.6,0));[.13,-.13].forEach(function(zz){a.add(M(new T.SphereGeometry(.025,8,6),metal("#dfe6ff"),.125,-.55+(zz>0?0:-.1),zz*.4))});a.add(M(new T.TorusGeometry(.105,.025,8,18),chrome,0,-.74,0).rotateX(Math.PI/2));a.add(at(hemiSphere(.21,c2),0,.02,0));var hy=-.8;
  if(sel.arms==="claws"){a.add(M(new T.CylinderGeometry(.1,.1,.08,14),chrome,0,hy+.06,0));[1,-1].forEach(function(k){var f=M(new T.TorusGeometry(.11,.038,8,14,Math.PI*.85),c1,k*.05,hy-.1,0);f.rotation.z=k>0?-Math.PI*.15:Math.PI*1.15;a.add(f)})}
  else if(sel.arms==="hands"){a.add(M(new T.SphereGeometry(.16,18,14),plastic("#e8eeff"),0,hy-.04,0));a.add(M(new T.SphereGeometry(.06,10,8),plastic("#e8eeff"),.12,hy+.04,0))}
  else if(sel.arms==="tools"){var tg=gear(.17,.08,plastic(z>0?"#ffd24d":"#a78bff"));tg.position.set(0,hy-.02,0);tg.rotation.x=Math.PI/2;a.add(tg);rig.toolGears=(rig.toolGears||[]).concat([tg])}
  else if(sel.arms==="magnets"){var mg=M(new T.TorusGeometry(.13,.055,10,18,Math.PI),plastic("#ff5a4d"),0,hy-.02,0);mg.rotation.z=Math.PI;a.add(mg);[.13,-.13].forEach(function(x){a.add(M(new T.CylinderGeometry(.056,.056,.08,12),chrome,x,hy-.06,0))})}
  else{a.add(M(new T.CylinderGeometry(.04,.04,.14,10),chrome,0,hy,0));var pr=propeller(.24,"#ffd24d","#52b7ff");pr.position.y=hy-.08;a.add(spinner(pr,"y",22,rig))}
  sa.add(a);rig.arms.push(a)});
 var sh=slot("head"),head=new T.Group();head.position.set(0,H+1.54,0);head.scale.setScalar(1.1);sh.add(head);rig.head=head;var htop;var rub=plastic("#1a2246",{roughness:.7,clearcoat:.1});[.24,-.24].forEach(function(z){var hc=new T.CatmullRomCurve3([new T.Vector3(-.2,H+1.3,z),new T.Vector3(-.42,H+1.18,z*1.3),new T.Vector3(-.48,H+.98,z*1.2)]);sh.add(M(new T.TubeGeometry(hc,16,.045,8,false),rub))});
 if(sel.head==="box"){head.add(M(rbox(.8,.62,.7,.18),c1));head.add(M(rbox(.06,.34,.58,.05),dark,.41,0,0));[.13,-.13].forEach(function(z){var e=noShadow(M(rbox(.03,.15,.11,.014),new T.MeshBasicMaterial({color:"#7ff5cf"}),.445,.04,z));head.add(e);rig.eyes.push(e)});[-.09,-.03,.03,.09].forEach(function(z){head.add(noShadow(M(rbox(.025,.035,.045,.01),new T.MeshBasicMaterial({color:"#7ff5cf"}),.445,-.11,z)))});head.add(M(rbox(.06,.36,.6,.05),GLASS,.47,0,0));[.37,-.37].forEach(function(z){head.add(M(new T.CylinderGeometry(.08,.08,.08,16),chrome,0,0,z).rotateX(Math.PI/2))});htop=.31}
 else if(sel.head==="dome"){var dp=[];for(var j=0;j<=12;j++){var an=j/12*Math.PI/2;dp.push(new T.Vector2(Math.cos(an)*.45+.0001,Math.sin(an)*.45))}dp.unshift(new T.Vector2(.45,-.22));head.add(M(new T.LatheGeometry(dp.reverse(),32),c1));head.add(M(new T.TorusGeometry(.455,.04,8,32),chrome,0,-.18,0).rotateX(Math.PI/2));head.add(M(new T.TorusGeometry(.13,.035,10,24),chrome,.42,0,0).rotateY(Math.PI/2));var ey=noShadow(M(new T.SphereGeometry(.11,20,14),new T.MeshBasicMaterial({color:"#ffd24d"}),.4,0,0));head.add(ey);rig.eyes.push(ey);htop=.45}
 else if(sel.head==="cams"){head.add(M(rbox(.72,.42,.62,.14),c1,0,-.06,0));[.17,-.17].forEach(function(z){head.add(M(new T.CylinderGeometry(.045,.045,.3,10),chrome,0,.24,z));var e=eyeOne(.15);e.position.set(0,.44,z);e.add(noShadow(M(new T.TorusGeometry(.15,.025,8,24),chrome).rotateY(Math.PI/2)));head.add(e);rig.eyes.push(e)});htop=.6}
 else if(sel.head==="tv"){head.add(M(rbox(.62,.66,.84,.1),c1));head.add(M(rbox(.06,.52,.7,.04),chrome,.31,0,0));var scr=new T.Mesh(new T.PlaneGeometry(.6,.46),new T.MeshStandardMaterial({color:"#06142e",emissive:"#ffffff",emissiveMap:screenFace(),emissiveIntensity:1.1,roughness:.3}));scr.position.set(.345,0,0);scr.rotation.y=Math.PI/2;head.add(scr);[.2,.3].forEach(function(z,i){head.add(M(new T.CylinderGeometry(.04,.04,.06,12),chrome,.33,-.22,-.34+i*.1).rotateZ(Math.PI/2))});htop=.34;rig.screen=scr}
 else{var hv=M(new T.SphereGeometry(.42,28,20),c1);hv.scale.set(1.08,.9,1);head.add(hv);var vz=new T.Mesh(new T.CylinderGeometry(.44,.44,.13,28,1,true,Math.PI/6,Math.PI*2/3),new T.MeshBasicMaterial({color:"#8fd6ff",side:T.DoubleSide}));vz.position.set(.02,.02,0);vz.scale.set(1.08,1,1);head.add(vz);rig.eyes.push(vz);head.add(M(new T.TorusGeometry(.43,.03,8,32),chrome,0,-.2,0).rotateX(Math.PI/2));htop=.38}
 var stp=slot("top"),tp=new T.Group();tp.position.set(0,htop,0);head.add(tp);rig.slots.top=tp;
 if(sel.top==="antenna"){var an2=new T.Group();an2.add(M(new T.CylinderGeometry(.03,.03,.36,8),chrome,0,.18,0));for(var c=0;c<3;c++)an2.add(M(new T.TorusGeometry(.05,.012,6,14),chrome,0,.08+c*.08,0).rotateX(Math.PI/2));an2.add(M(new T.SphereGeometry(.08,14,10),glowMat("#ff6a5c",1.8),0,.38,0));tp.add(an2);rig.ant=an2}
 else if(sel.top==="siren"){tp.add(M(new T.CylinderGeometry(.18,.2,.08,18),dark,0,.04,0));var sr=at(hemiSphere(.16,new T.MeshStandardMaterial({color:"#ff6a5c",emissive:"#ff6a5c",emissiveIntensity:1.4,roughness:.3})),0,.08,0);tp.add(sr);rig.siren=sr}
 else if(sel.top==="gearcrown"){var gc=gear(.24,.08,plastic("#a78bff"));gc.position.set(0,.1,0);tp.add(gc);rig.crown=gc}
 else if(sel.top==="radar"){tp.add(M(new T.CylinderGeometry(.04,.05,.2,10),chrome,0,.1,0));var rd=new T.Group();rd.position.y=.22;var dish=M(new T.SphereGeometry(.24,20,10,0,Math.PI*2,0,Math.PI/3.2),new T.MeshStandardMaterial({color:"#dfe6ff",roughness:.3,metalness:.6,side:T.DoubleSide}),0,0,0);dish.rotation.z=Math.PI/2+.5;dish.position.x=-.1;rd.add(dish);rd.add(M(new T.CylinderGeometry(.015,.015,.22,6),chrome,.02,.05,0).rotateZ(-1.0));rd.add(M(new T.SphereGeometry(.035,8,6),glowMat("#ff6a5c",2),.11,.11,0));tp.add(spinner(rd,"y",1.6,rig))}
 else{tp.add(M(new T.CylinderGeometry(.09,.1,.14,16),chrome,0,.07,0));var bm=new T.MeshStandardMaterial({color:"#fff3b0",emissive:"#ffd24d",emissiveIntensity:1.6,roughness:.2});var fil=M(new T.TorusGeometry(.05,.012,6,14),bm,0,.28,0);tp.add(fil);tp.add(M(new T.SphereGeometry(.17,22,16),new T.MeshPhysicalMaterial({color:"#fff8e0",roughness:.05,clearcoat:1,transparent:true,opacity:.45,depthWrite:false}),0,.28,0));rig.bulb=fil}
 rig.h=H+1.5+htop+.45;rig.w=1.75}
function darken(h: string, a: number): string {var n=parseInt(h.slice(1),16),c=[n>>16&255,n>>8&255,n&255].map(function(v){return Math.round(v*(1-a))});return "#"+c.map(function(v){return (v<16?"0":"")+v.toString(16)}).join("")}
function noShadow<T extends THREE.Object3D>(o: T): T {o.traverse(function(m){m.castShadow=false;m.receiveShadow=false});return o}
function eyeOne(r: number, lid?: string | null): THREE.Group {var e=new T.Group(),inner=new T.Group();inner.scale.set(.6,1,1);e.add(inner);e.userData.look=true;if(lid){var ld=new T.Mesh(new T.SphereGeometry(r*1.06,26,10,0,Math.PI*2,0,.42),plastic(lid,{clearcoat:.35,roughness:.42}));ld.rotation.z=-.18;inner.add(ld)}
 inner.add(new T.Mesh(new T.SphereGeometry(r,28,20),plastic("#ffffff",{clearcoat:1,roughness:.18})));
 var ir=new T.Mesh(new T.SphereGeometry(r*1.015,28,10,0,Math.PI*2,0,.64),plastic("#3a7bd5",{clearcoat:1,roughness:.12}));ir.rotation.z=-Math.PI/2;inner.add(ir);
 var pu=new T.Mesh(new T.SphereGeometry(r*1.03,24,8,0,Math.PI*2,0,.33),plastic("#0a0f2a",{clearcoat:1,roughness:.1}));pu.rotation.z=-Math.PI/2;inner.add(pu);
 var cl=new T.Mesh(new T.SphereGeometry(r*.2,12,8),new T.MeshBasicMaterial({color:"#ffffff"}));cl.position.set(r*1.0,r*.42,-r*.3);inner.add(cl);
 var cl2=new T.Mesh(new T.SphereGeometry(r*.1,8,6),new T.MeshBasicMaterial({color:"#ffffff"}));cl2.position.set(r*1.0,-r*.3,r*.25);inner.add(cl2);
 return noShadow(e)}
function eyes(g: THREE.Group, x: number, y: number, z: number, s: number, rig: ToyRig, lid?: string | null): void {[1,-1].forEach(function(k){var e=eyeOne(.13*s,lid);e.position.set(x,y,z+k*.18*s);g.add(e);rig.eyes.push(e)})}
function face(g: THREE.Group, x: number, y: number, rig: ToyRig, s?: number, mx?: number, lid?: string | null): void {s=s||1;eyes(g,x,y+.05*s,0,s*1.12,rig,lid);rig.brows=rig.brows||[];
 [1,-1].forEach(function(k){var b=M(new T.CylinderGeometry(.024*s,.024*s,.15*s,8),plastic("#2a1a3a"),x+.03*s,y+.28*s,k*.19*s);b.rotation.x=Math.PI/2;b.rotation.z=k*.15;noShadow(b);g.add(b);rig.brows!.push(b);
  var ch=new T.Mesh(new T.CircleGeometry(.085*s,18),new T.MeshBasicMaterial({color:0xff8fa8,transparent:true,opacity:.5,depthWrite:false}));ch.position.set(x+.03*s,y-.11*s,k*.31*s);ch.rotation.y=Math.PI/2-k*.5;g.add(ch)});
 var mo=new T.Group();mo.position.set(mx||x+.1*s,y-.17*s,0);mo.rotation.y=Math.PI/2;
 var lip=new T.Mesh(new T.CircleGeometry(.085*s,24,Math.PI,Math.PI),new T.MeshStandardMaterial({color:"#5a1020",roughness:.6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));mo.add(lip);
 var tg=new T.Mesh(new T.CircleGeometry(.05*s,16,Math.PI,Math.PI),new T.MeshStandardMaterial({color:"#ff7a8a",roughness:.6,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));tg.position.set(0,-.05*s,.002);mo.add(tg);g.add(noShadow(mo))}
function vin(c: string): THREE.Material {return plastic(c,{roughness:.5,clearcoat:.25,clearcoatRoughness:.4,envMapIntensity:.7})}
function glo(c: string): THREE.Material {return plastic(c,{roughness:.3,clearcoat:.9,clearcoatRoughness:.12,envMapIntensity:.85})}
function latheS(pts: number[][], mat: THREE.Material, seg?: number): THREE.Mesh {var pts2=pts.map(function(p){return new T.Vector2(p[0] as number,p[1] as number)});var sp=new T.SplineCurve(pts2).getPoints(64);sp[0]!.x=Math.max(.0001,sp[0]!.x);sp[sp.length-1]!.x=.0001;return M(new T.LatheGeometry(sp,seg||48),mat)}
function holder(parent: THREE.Object3D, lx: number, ly: number, lz: number): { a: THREE.Group; c: THREE.Group } {var a=new T.Group();a.position.set(lz,ly,-lx);parent.add(a);var c=new T.Group();c.rotation.y=Math.PI/2;a.add(c);return {a:a,c:c}}
function eyeZ(r: number, lid?: string | null, iris?: string, spark?: boolean): THREE.Group {var e=new T.Group(),inner=new T.Group();inner.scale.set(1,1,.6);e.add(inner);e.userData.look=true;
 inner.add(new T.Mesh(new T.SphereGeometry(r,28,20),glo("#ffffff")));
 var ir=new T.Mesh(new T.SphereGeometry(r*1.015,28,10,0,Math.PI*2,0,.7),glo(iris||"#2f6fd0"));ir.rotation.x=Math.PI/2;inner.add(ir);
 var pu=new T.Mesh(new T.SphereGeometry(r*1.03,24,8,0,Math.PI*2,0,.36),glo("#0a0f2a"));pu.rotation.x=Math.PI/2;inner.add(pu);
 var wb=new T.MeshBasicMaterial({color:"#ffffff"});
 if(spark){var st=new T.Mesh(STARGEO,wb);st.scale.setScalar(r*.9);st.position.set(-r*.3,r*.32,r*1.0);inner.add(st)}else{var c1=new T.Mesh(new T.SphereGeometry(r*.22,12,8),wb);c1.position.set(-r*.32,r*.4,r*1.0);inner.add(c1)}
 var c2=new T.Mesh(new T.SphereGeometry(r*.11,8,6),wb);c2.position.set(r*.28,-r*.3,r*1.0);inner.add(c2);
 if(lid){var ld=new T.Mesh(new T.SphereGeometry(r*1.06,26,10,0,Math.PI*2,0,.78),vin(lid));ld.rotation.x=.4;inner.add(ld)}
 return noShadow(e)}
function smileZ(w: number, mat: THREE.Material): THREE.Object3D {var cv=new T.QuadraticBezierCurve3(new T.Vector3(-w,0,0),new T.Vector3(0,-w*.9,0),new T.Vector3(w,0,0));return noShadow(M(new T.TubeGeometry(cv,16,w*.18,8,false),mat))}
function blushZ(r: number, x: number, y: number, z: number, yaw?: number): THREE.Object3D {var m=new T.Mesh(new T.CircleGeometry(r,18),new T.MeshBasicMaterial({color:0xff8fa8,transparent:true,opacity:.5,depthWrite:false}));m.position.set(x,y,z);m.rotation.y=yaw ?? 0;return m}
function baseVinyl(W: THREE.Group, sg: THREE.Object3D, col: RigColors, rig: ToyRig): WardrobeLayout {var m1=vin(col.c1),m2=vin(col.c2),dark=vin("#2a2350");
 var body=latheS([[.0,0],[.36,.04],[.42,.3],[.4,.55],[.3,.78],[.18,.86],[0,.88]],m1);W.add(body);rig.body=body;
 var belly=M(new T.SphereGeometry(.26,24,16),m2,0,.4,.3);belly.scale.set(1,1.2,.45);W.add(belly);
 [.2,-.2].forEach(function(x){var f=new T.Group();f.position.set(x,0,.08);var fm=M(new T.SphereGeometry(.17,20,14),m1,0,.07,0);fm.scale.set(1,.55,1.35);f.add(fm);W.add(f);rig.feet.push(f)});
 [.4,-.4].forEach(function(x){var h=holder(sg,x,.62,0),a=capsule(.1,.12,m1);a.position.set(x>0?.06:-.06,-.1,0);a.rotation.z=x>0?.7:-.7;h.c.add(a);rig.arms.push(h.a)});
 var hd=new T.Group();hd.position.y=1.42;W.add(hd);var hm=M(new T.SphereGeometry(.72,40,30),m1);hm.scale.set(1.16,.94,1.02);hd.add(hm);
 hd.add(noShadow(M(new T.TorusGeometry(.2,.03,8,24),dark,0,-.62,0).rotateX(Math.PI/2)));
 var sm=smileZ(.07,dark);sm.position.set(0,-.27,.69);hd.add(sm);hd.add(blushZ(.1,.42,-.24,.6,.45));hd.add(blushZ(.1,-.42,-.24,.6,-.45));
 return {hd:hd,eye:{x:.27,y:-.08,z:.62,r:.16},ear:{x:.48,y:.55,s:1},hat:{y:.6,r:.72},back:{y:.52,z:-.36,w:.7},tail:{y:.26,z:-.36},neck:1.0,h:2.1,w:1.8,lid:col.c1}}
function pvc(c: string): THREE.Material {return plastic(c,{roughness:.42,clearcoat:.5,clearcoatRoughness:.3,envMapIntensity:.8})}
function baseBlock(W: THREE.Group, sg: THREE.Object3D, col: RigColors, rig: ToyRig): WardrobeLayout {var skinC=col.skin||"#f2b98c",skin=pvc(skinC),pants=pvc(col.c1),jacket=pvc(col.c2),jdk=pvc(darken(col.c2,.18)),shoe=pvc("#2a3566"),white=pvc("#f4f6ff"),hairM=pvc("#5a3424"),gold=metal("#ffd24d");
 [.17,-.17].forEach(function(x){var f=new T.Group();f.position.set(x,0,0);
  f.add(M(rbox(.3,.07,.5,.03),white,0,.035,.06));var up=M(new T.SphereGeometry(.16,22,14),shoe,0,.14,.06);up.scale.set(.95,.62,1.5);f.add(up);var toe=M(new T.SphereGeometry(.1,16,10),white,0,.1,.24);toe.scale.set(1.2,.6,.9);f.add(toe);
  [.0,.06,.12].forEach(function(z){f.add(M(new T.BoxGeometry(.13,.015,.02),white,0,.235-z*.25,z-.02))});
  f.add(latheS([[.1,.2],[.12,.4],[.13,.62],[.135,.85],[.15,1.05],[.15,1.14]],pants,28));
  var cf=M(new T.TorusGeometry(.105,.022,8,24),pants,0,.22,0);cf.rotation.x=Math.PI/2;f.add(cf);W.add(f);rig.feet.push(f)});
 var hp=M(new T.SphereGeometry(.33,28,18),pants,0,1.15,0);hp.scale.set(.97,.48,.64);W.add(hp);
 var bl=M(new T.TorusGeometry(.31,.045,10,36),shoe,0,1.2,0);bl.rotation.x=Math.PI/2;bl.scale.set(1,.74,1);W.add(bl);W.add(M(rbox(.13,.09,.03,.015),gold,0,1.2,.235));
 var tor=latheS([[.27,1.18],[.3,1.35],[.33,1.58],[.355,1.78],[.33,1.92],[.2,2.0],[.12,2.03]],jacket,36);tor.scale.z=.74;W.add(tor);rig.body=tor;
 W.add(M(rbox(.025,.46,.02,.008),metal("#cfd8ff"),0,1.66,.252));
 [.15,-.15].forEach(function(x){var pk=M(rbox(.15,.12,.03,.02),jdk,x,1.38,.228);pk.rotation.y=x>0?.32:-.32;W.add(pk)});
 var cl=M(new T.TorusGeometry(.16,.055,10,28),jdk,0,1.99,0);cl.rotation.x=Math.PI/2;W.add(cl);
 W.add(M(new T.CylinderGeometry(.085,.09,.16,18),skin,0,2.08,0));
 [.4,-.4].forEach(function(x){var h=holder(sg,x,1.86,0),a=h.c;a.add(M(new T.SphereGeometry(.125,18,14),jacket));a.add(latheS([[.095,-.46],[.1,-.3],[.11,-.12],[.12,0]],jacket,20));
  var fo=new T.Group();fo.position.y=-.44;fo.rotation.x=-.28;a.add(fo);fo.add(M(new T.SphereGeometry(.098,14,10),jacket));fo.add(latheS([[.085,-.36],[.09,-.2],[.098,0]],jacket,20));
  var cu=M(new T.TorusGeometry(.086,.024,8,20),jdk,0,-.34,0);cu.rotation.x=Math.PI/2;fo.add(cu);
  var hn=new T.Group();hn.position.y=-.43;fo.add(hn);var palm=M(new T.SphereGeometry(.08,16,12),skin);palm.scale.set(.78,1,.58);hn.add(palm);
  [-.042,-.014,.014,.042].forEach(function(fx,i){var fg=capsule(.02,.055-(i===0||i===3?.012:0),skin);fg.position.set(fx,-.085,.01);fg.rotation.x=.45;hn.add(fg)});
  var th=capsule(.022,.05,skin);th.position.set(0,-.02,.06);th.rotation.x=.9;hn.add(th);
  a.rotation.z=x>0?.12:-.12;rig.arms.push(h.a)});
 var hd=new T.Group();hd.position.y=2.47;hd.scale.setScalar(1.2);W.add(hd);var sk=M(new T.SphereGeometry(.3,36,28),skin);sk.scale.set(1,1.06,.98);hd.add(sk);var jaw=M(new T.SphereGeometry(.25,28,20),skin,0,-.1,.03);jaw.scale.set(1.02,.82,.98);hd.add(jaw);
 [.29,-.29].forEach(function(x){var e=M(new T.SphereGeometry(.06,14,10),skin,x,-.01,0);e.scale.set(.5,1,.8);hd.add(e)});
 hd.add(noShadow(M(new T.SphereGeometry(.04,14,10),pvc(darken(skinC,.08)),0,-.05,.305)));
 var sm=smileZ(.055,pvc("#7a2030"));sm.position.set(0,-.16,.272);hd.add(sm);hd.add(blushZ(.045,.17,-.09,.262,.5));hd.add(blushZ(.045,-.17,-.09,.262,-.5));
 [.11,-.11].forEach(function(x){var br=noShadow(M(rbox(.09,.022,.02,.008),hairM,x,.135,.272));br.rotation.z=x>0?-.12:.12;hd.add(br)});
 var hair=new T.Group();hd.add(hair);var cap=M(new T.SphereGeometry(.325,32,18,0,Math.PI*2,0,Math.PI*.52),hairM,0,.02,-.02);cap.rotation.x=-.3;cap.scale.set(1.03,1.06,1.02);hair.add(cap);
 var back=M(new T.SphereGeometry(.3,28,18),hairM,0,.03,-.075);back.scale.set(1.04,1.0,.92);hair.add(back);
 ([[-.16,.2,.2,.11,-.45],[-.04,.245,.235,.12,-.15],[.09,.235,.225,.12,.25],[.2,.17,.17,.1,.55]] as [number, number, number, number, number][]).forEach(function(c){var cm=M(new T.SphereGeometry(c[3],18,12),hairM,c[0],c[1],c[2]);cm.scale.set(1,.62,.75);cm.rotation.z=c[4];hair.add(cm)});
 var tu=M(new T.SphereGeometry(.1,16,12),hairM,.04,.33,.04);tu.scale.set(.8,.55,.95);tu.rotation.z=-.4;hair.add(tu);
 return {hd:hd,eye:{x:.108,y:.035,z:.25,r:.08},ear:{x:.22,y:.3,s:.55},hat:{y:.37,r:.36},back:{y:1.62,z:-.27,w:.75},tail:{y:1.12,z:-.24},neck:2.05,h:3.1,w:1.4,lid:skinC}}
function baseCreature(W: THREE.Group, sg: THREE.Object3D, col: RigColors, rig: ToyRig): WardrobeLayout {var m1=vin(col.c1),m2=vin(col.c2),dark=vin("#2a1a3a");
 var body=latheS([[0,0],[.5,.02],[.72,.22],[.78,.55],[.72,.95],[.58,1.3],[.38,1.55],[.16,1.68],[0,1.7]],m1);W.add(body);rig.body=body;
 var belly=M(new T.SphereGeometry(.46,30,20),m2,0,.56,.6);belly.scale.set(1,1.08,.4);W.add(belly);
 [.32,-.32].forEach(function(x){var f=new T.Group();f.position.set(x,0,.36);var fm=M(new T.SphereGeometry(.24,22,16),m2,0,.1,0);fm.scale.set(1,.55,1.3);f.add(fm);[-.08,0,.08].forEach(function(dx){f.add(M(new T.SphereGeometry(.045,10,8),dark,dx,.1,.3))});W.add(f);rig.feet.push(f)});
 [.72,-.72].forEach(function(x){var h=holder(sg,x,.76,.08),a=capsule(.11,.16,m1);a.position.set(x>0?.04:-.04,-.06,0);a.rotation.z=x>0?.9:-.9;h.c.add(a);rig.arms.push(h.a)});
 var hd=new T.Group();hd.position.y=1.15;W.add(hd);
 var mo=new T.Group();mo.position.set(0,-.16,.75);var mm=new T.Mesh(new T.CircleGeometry(.1,24,Math.PI,Math.PI),new T.MeshStandardMaterial({color:"#5a1020",roughness:.6,polygonOffset:true,polygonOffsetFactor:-2}));mo.add(mm);var fang=M(new T.ConeGeometry(.025,.05,8),vin("#ffffff"),.05,-.02,.005);fang.rotation.x=Math.PI;mo.add(fang);hd.add(noShadow(mo));
 hd.add(blushZ(.1,.45,-.1,.66,.6));hd.add(blushZ(.1,-.45,-.1,.66,-.6));
 return {hd:hd,eye:{x:.26,y:.1,z:.66,r:.19},ear:{x:.36,y:.3,s:1},hat:{y:.5,r:.42},back:{y:.85,z:-.74,w:1},tail:{y:.4,z:-.7},neck:1.3,h:1.9,w:1.9,lid:col.c1}}
function baseRobotKip(headKey: string, W: THREE.Group, sg: THREE.Object3D, col: RigColors, rig: ToyRig): WardrobeLayout {var c1=paintMat(col.c1),c2=paintMat(col.c2),chrome=metal("#c9d3f0"),dark=plastic("#16205a",{roughness:.5}),hk=headKey.replace("robot.head.","");
 var body=M(rbox(.82,.88,.66,.18),c2,0,.78,0);W.add(body);rig.body=body;W.add(M(rbox(.52,.44,.06,.05),dark,0,.82,.34));
 ([["#ff6a5c",-.14],["#ffd24d",0],["#5af0b0",.14]] as [string, number][]).forEach(function(l){W.add(M(new T.SphereGeometry(.048,12,8),glowMat(l[0],2.2),l[1],.9,.37))});
 [.22,-.22].forEach(function(x){var f=new T.Group();f.position.set(x,0,.04);f.add(M(rbox(.28,.16,.44,.06),dark,0,.08,0));f.add(at(capsule(.09,.2,c1),0,.24,0));W.add(f);rig.feet.push(f)});
 [.52,-.52].forEach(function(x){var h=holder(sg,x,1.02,0),a=capsule(.095,.18,c1);a.position.set(0,-.18,0);h.c.add(a);h.c.add(M(new T.SphereGeometry(.12,14,10),chrome,0,0,0));rig.arms.push(h.a)});
 var hd=new T.Group();hd.position.y=1.56;W.add(hd);var rh=new T.Group();rh.rotation.y=-Math.PI/2;hd.add(rh);var htop=.38;
 if(hk==="box"){rh.add(M(rbox(.78,.6,.68,.16),c1));rh.add(M(rbox(.06,.34,.56,.05),dark,.4,0,0));[.13,-.13].forEach(function(z){var e=noShadow(M(rbox(.03,.15,.11,.014),new T.MeshBasicMaterial({color:"#7ff5cf"}),.435,.04,z));rh.add(e);rig.eyes.push(e)});htop=.32}
 else if(hk==="dome"){var dp=[];for(var j=0;j<=12;j++){var an=j/12*Math.PI/2;dp.push(new T.Vector2(Math.cos(an)*.44+.0001,Math.sin(an)*.44))}dp.unshift(new T.Vector2(.44,-.2));rh.add(M(new T.LatheGeometry(dp.reverse(),32),c1));var ey=noShadow(M(new T.SphereGeometry(.11,20,14),new T.MeshBasicMaterial({color:"#ffd24d"}),.4,0,0));rh.add(ey);rig.eyes.push(ey);htop=.45}
 else if(hk==="cams"){rh.add(M(rbox(.7,.42,.6,.14),c1,0,-.06,0));[.17,-.17].forEach(function(z){rh.add(M(new T.CylinderGeometry(.045,.045,.28,10),chrome,0,.22,z));var e2=eyeOne(.14);e2.position.set(0,.42,z);rh.add(e2);rig.eyes.push(e2)});htop=.58}
 else if(hk==="tv"){rh.add(M(rbox(.62,.64,.82,.1),c1));var scr=new T.Mesh(new T.PlaneGeometry(.58,.44),new T.MeshStandardMaterial({color:"#06142e",emissive:"#ffffff",emissiveMap:screenFace(),emissiveIntensity:1.1,roughness:.3}));scr.position.set(.33,0,0);scr.rotation.y=Math.PI/2;rh.add(scr);rig.screen=scr;htop=.34}
 else{var hv=M(new T.SphereGeometry(.42,28,20),c1);hv.scale.set(1.08,.9,1);rh.add(hv);var vz=new T.Mesh(new T.CylinderGeometry(.44,.44,.13,28,1,true,Math.PI/6,Math.PI*2/3),new T.MeshBasicMaterial({color:"#8fd6ff",side:T.DoubleSide}));vz.position.set(.02,.02,0);vz.scale.set(1.08,1,1);rh.add(vz);rig.eyes.push(vz);htop=.38}
 return {hd:hd,eye:null,ear:{x:.38,y:.18,s:.72},hat:{y:htop,r:.42},back:{y:.82,z:-.36,w:.82},tail:{y:.42,z:-.35},neck:1.22,h:1.98,w:1.65,lid:col.c1}}
function partEyes(id: string, A: WardrobeSpec, g: THREE.Group, rig: ToyRig): void {if(!A.eye)return;var e=A.eye,ink=vin("#2a1a3a");
 if(id==="cyclops"){var c=eyeZ(e.r*1.55);c.position.set(0,e.y+.02,e.z+e.r*.2);g.add(c);rig.eyes.push(c);return}
 [1,-1].forEach(function(k){var ey;
  if(id==="happy"){ey=new T.Group();var arc=M(new T.TorusGeometry(e.r*.7,e.r*.17,8,20,Math.PI),ink);ey.add(arc);ey.position.set(k*e.x,e.y-e.r*.2,e.z+e.r*.5);noShadow(ey)}
  else if(id==="sleepy")ey=eyeZ(e.r,A.lid);
  else if(id==="sparkle")ey=eyeZ(e.r*1.1,null,"#c43cff",true);
  else ey=eyeZ(e.r);
  if(id!=="happy")ey.position.set(k*e.x,e.y,e.z);g.add(ey);rig.eyes.push(ey)})}
function partEars(id: string, A: WardrobeSpec, g: THREE.Group, col: RigColors): void {var E=A.ear!,s=E.s,m1=vin(col.c1),m2=vin(col.c2),pink=vin("#ff9db0");if(id==="none")return;
 [1,-1].forEach(function(k){var x=k*E.x;
  if(id==="bear"){g.add(M(new T.SphereGeometry(.2*s,22,16),m1,x,E.y,0));var i=M(new T.SphereGeometry(.12*s,18,12),m2,x,E.y+.01,.09*s);i.scale.z=.4;g.add(i)}
  else if(id==="cat"){var c=M(new T.ConeGeometry(.2*s,.42*s,24),m1,x*.95,E.y+.06*s,0);c.rotation.z=-k*.3;g.add(c);var ci=M(new T.ConeGeometry(.11*s,.26*s,20),pink,x*.93,E.y+.04*s,.07*s);ci.rotation.z=-k*.3;g.add(ci)}
  else if(id==="bunny"){var b=M(new T.SphereGeometry(.13*s,20,14),m1,x*.62,E.y+.32*s,0);b.scale.set(.8,2.6,.6);b.rotation.z=-k*.18;g.add(b);var bi=M(new T.SphereGeometry(.08*s,16,10),pink,x*.62,E.y+.32*s,.045*s);bi.scale.set(.7,2.4,.3);bi.rotation.z=-k*.18;g.add(bi)}
  else if(id==="horns"){var hc=new T.CatmullRomCurve3([new T.Vector3(x*.72,E.y-.08*s,0),new T.Vector3(x*.95,E.y+.2*s,0),new T.Vector3(x*.82,E.y+.4*s,-.08*s)]);g.add(M(new T.TubeGeometry(hc,16,.07*s,10,false),vin("#ffd24d")));g.add(M(new T.SphereGeometry(.07*s,12,10),vin("#ffd24d"),x*.82,E.y+.4*s,-.08*s))}
  else if(id==="antennae"){var st=M(new T.CylinderGeometry(.025*s,.03*s,.5*s,8),vin("#2a1a3a"),x*.6,E.y+.2*s,0);st.rotation.z=-k*.35;g.add(st);g.add(M(new T.SphereGeometry(.09*s,14,10),vin("#5af0b0"),x*.6+k*.09*s,E.y+.43*s,0))}})}
function partHat(id: string, A: WardrobeSpec, g: THREE.Group, rig: ToyRig): number {var H=A.hat!,r=H.r;if(!id||id==="none")return 0;var gold=metal("#ffd24d"),chrome=metal("#c9d3f0"),dark=plastic("#16205a",{roughness:.5});
 if(id.indexOf("robot.top.")===0){var tk=id.slice(10),tp=new T.Group();tp.position.set(0,H.y,0);tp.rotation.y=-Math.PI/2;g.add(tp);
  if(tk==="antenna"){var an2=new T.Group();an2.add(M(new T.CylinderGeometry(.03,.03,.36,8),chrome,0,.18,0));for(var c=0;c<3;c++)an2.add(M(new T.TorusGeometry(.05,.012,6,14),chrome,0,.08+c*.08,0).rotateX(Math.PI/2));an2.add(M(new T.SphereGeometry(.08,14,10),glowMat("#ff6a5c",1.8),0,.38,0));tp.add(an2);rig.ant=an2;return .45}
  if(tk==="siren"){tp.add(M(new T.CylinderGeometry(.18,.2,.08,18),dark,0,.04,0));var sr=at(hemiSphere(.16,new T.MeshStandardMaterial({color:"#ff6a5c",emissive:"#ff6a5c",emissiveIntensity:1.4,roughness:.3})),0,.08,0);tp.add(sr);rig.siren=sr;return .28}
  if(tk==="gearcrown"){var gc=gear(.24,.08,plastic("#a78bff"));gc.position.set(0,.1,0);tp.add(gc);rig.crown=gc;return .25}
  if(tk==="radar"){tp.add(M(new T.CylinderGeometry(.04,.05,.2,10),chrome,0,.1,0));var rd=new T.Group();rd.position.y=.22;var dish=M(new T.SphereGeometry(.24,20,10,0,Math.PI*2,0,Math.PI/3.2),new T.MeshStandardMaterial({color:"#dfe6ff",roughness:.3,metalness:.6,side:T.DoubleSide}),0,0,0);dish.rotation.z=Math.PI/2+.5;dish.position.x=-.1;rd.add(dish);rd.add(M(new T.SphereGeometry(.035,8,6),glowMat("#ff6a5c",2),.11,.11,0));tp.add(spinner(rd,"y",1.6,rig));return .42}
  tp.add(M(new T.CylinderGeometry(.09,.1,.14,16),chrome,0,.07,0));var bm=new T.MeshStandardMaterial({color:"#fff3b0",emissive:"#ffd24d",emissiveIntensity:1.6,roughness:.2});var fil=M(new T.TorusGeometry(.05,.012,6,14),bm,0,.28,0);tp.add(fil);tp.add(M(new T.SphereGeometry(.17,22,16),new T.MeshPhysicalMaterial({color:"#fff8e0",roughness:.05,clearcoat:1,transparent:true,opacity:.45,depthWrite:false}),0,.28,0));rig.bulb=fil;return .46}
 if(id==="wizard"){g.add(M(new T.CylinderGeometry(r*1.05,r*1.05,.05,32),plastic("#3f2eb0"),0,H.y,0));g.add(M(new T.TorusGeometry(r*.68,.045,8,32),gold,0,H.y+.05,0).rotateX(Math.PI/2));var cn=M(new T.ConeGeometry(r*.7,r*1.5,32),plastic("#5b43d6"),0,H.y+r*.75,0);cn.rotation.z=.12;g.add(cn);var hs=M(STARGEO,gold,-r*.1,H.y+r*1.5,0);hs.scale.setScalar(r*.6);g.add(hs);return r*1.6}
 if(id==="crown"){g.add(M(new T.CylinderGeometry(r*.55,r*.55,.16,28,1,true),gold,0,H.y+.04,0));for(var i=0;i<6;i++){var a=i/6*Math.PI*2;g.add(M(new T.ConeGeometry(.06,.18,8),gold,Math.cos(a)*r*.53,H.y+.2,Math.sin(a)*r*.53));g.add(M(new T.SphereGeometry(.035,8,6),plastic((["#ff5a4d","#52b7ff","#5af0b0"] as [string, string, string])[i%3]!,{clearcoat:1}),Math.cos(a)*r*.57,H.y+.04,Math.sin(a)*r*.57))}return .35}
 if(id==="propcap"){var bn=M(new T.SphereGeometry(r*.8,28,14,0,Math.PI*2,0,Math.PI/2),plastic("#52b7ff"),0,H.y-r*.25,0);bn.scale.y=.75;g.add(bn);g.add(M(new T.CylinderGeometry(.025,.025,.16,8),metal("#dfe6ff"),0,H.y+r*.42,0));var pr=propeller(r*.55,"#ff5a4d","#ffd24d");pr.position.y=H.y+r*.5;g.add(spinner(pr,"y",9,rig));return r*.6}
 if(id==="cap"){var cp=M(new T.SphereGeometry(r*.82,28,14,0,Math.PI*2,0,Math.PI/2),plastic("#ff5a4d"),0,H.y-r*.28,0);cp.scale.y=.72;g.add(cp);var br=M(new T.CylinderGeometry(r*.62,r*.62,.04,24,1,false,-Math.PI/2,Math.PI),plastic("#ff5a4d"),0,H.y-r*.26,r*.45);br.scale.z=1.3;g.add(br);g.add(M(new T.SphereGeometry(.04,10,8),plastic("#ffffff"),0,H.y+r*.33,0));return r*.4}
 if(id==="flower"){var vine=M(new T.TorusGeometry(r*.6,.035,8,32),vin("#3fae5a"),0,H.y,0);vine.rotation.x=Math.PI/2;g.add(vine);for(var j=0;j<6;j++){var b2=j/6*Math.PI*2,fx=Math.cos(b2)*r*.6,fz=Math.sin(b2)*r*.6,pc=(["#ff8fb8","#ffd24d","#fff4f8"] as [string, string, string])[j%3]!;for(var q=0;q<5;q++){var c3=q/5*Math.PI*2;g.add(M(new T.SphereGeometry(.05,10,8),vin(pc),fx+Math.cos(c3)*.06,H.y+.05,fz+Math.sin(c3)*.06))}g.add(M(new T.SphereGeometry(.04,10,8),vin("#ffb03a"),fx,H.y+.07,fz))}return .2}
 return 0}
function partBack(id: string, A: WardrobeSpec, W: THREE.Group, sg: THREE.Object3D, col: RigColors, rig: ToyRig): void {var B=A.back!,m2=vin(col.c2);if(!id||id==="none")return;
 if(id.indexOf("robot.torso.")===0){var rk=id.slice(12),chrome=metal("#c9d3f0"),dark=plastic("#16205a",{roughness:.5}),bg=new T.Group();bg.position.set(0,B.y,B.z-.14);W.add(bg);
  if(rk==="box"){bg.add(M(rbox(.56,.62,.28,.08),paintMat(col.c2)));(([["#ff6a5c",-.12],["#ffd24d",0],["#5af0b0",.12]]) as [string, number][]).forEach(function(l){bg.add(M(new T.SphereGeometry(.04,10,8),glowMat(l[0],2),l[1],.14,-.15))});return}
  if(rk==="tank"){bg.add(M(rbox(.64,.66,.32,.1),paintMat(col.c2)));var gw=gear(.2,.08,plastic("#a78bff"));gw.position.set(0,0,-.2);gw.rotation.x=Math.PI/2;bg.add(gw);rig.chestGear=gw;return}
  if(rk==="barrel"){bg.add(M(new T.CylinderGeometry(.24,.24,.64,24),paintMat(col.c2),0,0,0));[-.2,0,.2].forEach(function(y){bg.add(M(new T.TorusGeometry(.245,.025,8,24),chrome,0,y,0).rotateX(Math.PI/2))});return}
  if(rk==="core"){bg.add(M(new T.TorusGeometry(.22,.04,10,28),chrome,0,0,-.06));var cm=new T.MeshStandardMaterial({color:"#5af0b0",emissive:"#5af0b0",emissiveIntensity:2,roughness:.3});var core=M(new T.SphereGeometry(.16,20,16),cm,0,0,-.1);bg.add(core);rig.core=core;return}
  bg.add(M(rbox(.44,.58,.24,.08),dark));[.14,-.14].forEach(function(x){bg.add(M(new T.CylinderGeometry(.1,.13,.28,16),chrome,x,-.3,0));var f2=M(new T.ConeGeometry(.09,.38,14),new T.MeshStandardMaterial({color:"#ffd24d",emissive:"#ff9d5c",emissiveIntensity:2.4,transparent:true,opacity:.9}),x,-.56,0);f2.rotation.x=Math.PI;f2.castShadow=false;bg.add(f2);rig.flames!.push(f2)});return}
 if(id==="backpack"){var bp=new T.Group();bp.position.set(0,B.y,B.z-.1);bp.add(M(rbox(B.w*.62,.58,.26,.1),m2));bp.add(M(rbox(B.w*.5,.22,.08,.04),vin(col.c1),0,-.1,-.14));bp.add(M(rbox(B.w*.62,.06,.27,.02),vin("#2a3566"),0,.18,0));W.add(bp);return}
 if(id==="jetpack"){[.13,-.13].forEach(function(x){W.add(M(new T.CylinderGeometry(.11,.11,.5,18),metal("#c9d3f0"),x,B.y,B.z-.12));W.add(M(new T.SphereGeometry(.11,16,10,0,Math.PI*2,0,Math.PI/2),plastic("#ff5a4d"),x,B.y+.25,B.z-.12));W.add(M(new T.CylinderGeometry(.07,.1,.1,14),vin("#2a3566"),x,B.y-.3,B.z-.12));var f=M(new T.ConeGeometry(.08,.34,14),new T.MeshStandardMaterial({color:"#ffd24d",emissive:"#ff9d5c",emissiveIntensity:2.2,transparent:true,opacity:.9}),x,B.y-.52,B.z-.12);f.rotation.x=Math.PI;f.castShadow=false;W.add(f);rig.flames!.push(f)});return}
 if(id==="cape"){var h=holder(sg,0,A.neck!,0);var cape=M(new T.CylinderGeometry(B.w*.45,B.w*.75,A.neck!*.85,28,1,true,Math.PI/2,Math.PI),new T.MeshPhysicalMaterial({color:"#a78bff",roughness:.55,clearcoat:.3,side:T.DoubleSide}),0,-A.neck!*.43,-.06);h.c.add(cape);h.c.add(M(new T.SphereGeometry(.06,12,10),metal("#ffd24d"),0,-.02,B.w*.3));rig.cape=h.a;return}
 if(id==="wings")[1,-1].forEach(function(k){var h=holder(sg,k*.12,B.y+.1,B.z);([[0,.55,1],[-.08,.46,.85],[-.16,.38,.7]] as [number, number, number][]).forEach(function(f,j){var fe=M(new T.SphereGeometry(.5,18,10),vin(j?"#d6e8ff":"#f4f8ff"),k*(.38+j*.04),.06+j*.04+f[0],-.05);fe.scale.set(f[2]*.75,.08,f[1]);fe.rotation.set(0,0,k*(.35-j*.12));h.c.add(fe)});rig.wings.push(h.a)})}
function partTail(id: string, A: WardrobeSpec, W: THREE.Group, col: RigColors, rig: ToyRig): void {var Tl=A.tail!,m1=vin(col.c1),m2=vin(col.c2);if(!id||id==="none")return;var g=new T.Group();g.position.set(0,Tl.y,Tl.z);W.add(g);rig.tail=g;
 if(id==="curly"){var tc=new T.CatmullRomCurve3([new T.Vector3(0,0,0),new T.Vector3(0,.1,-.25),new T.Vector3(0,.35,-.35),new T.Vector3(0,.5,-.2)]);g.add(M(new T.TubeGeometry(tc,20,.08,10,false),m1));g.add(M(new T.SphereGeometry(.12,14,10),m2,0,.5,-.2))}
 else if(id==="fox"){[[0,.12,-.2,.16],[0,.32,-.36,.2],[0,.55,-.38,.18]].forEach(function(p,i){var b=M(new T.SphereGeometry(p[3],20,14),i===2?vin("#fff6ea"):m1,p[0],p[1],p[2]);b.scale.set(.85,1.25,.85);g.add(b)})}
 else if(id==="dragon"){var dc=new T.CatmullRomCurve3([new T.Vector3(0,0,0),new T.Vector3(0,-.05,-.3),new T.Vector3(0,.12,-.6),new T.Vector3(0,.3,-.75)]);g.add(M(new T.TubeGeometry(dc,24,.075,10,false),m1));[.2,.4,.6].forEach(function(u){var p=dc.getPoint(u),sp=M(new T.ConeGeometry(.05,.14,8),m2,p.x,p.y+.08,p.z);g.add(sp)});var tip=M(new T.ConeGeometry(.12,.22,4),m2,0,.38,-.8);tip.rotation.x=-.6;g.add(tip)}
 else{g.add(M(new T.SphereGeometry(.17,18,14),vin("#fff6ea"),0,.05,-.08))}}
function partProp(id: string, pg: THREE.Group, col: RigColors, rig: ToyRig): void {if(!id||id==="none")return;var ak=id.replace("robot.arms.",""),chrome=metal("#c9d3f0"),c1=paintMat(col.c1),mount=rig.arms[0]||pg,g=new T.Group();
 g.position.set(.24,-.32,0);mount.add(g);g.add(M(new T.CylinderGeometry(.04,.04,.24,10),chrome,0,0,0).rotateZ(Math.PI/2));
 if(ak==="claws"){[1,-1].forEach(function(k){var f=M(new T.TorusGeometry(.11,.036,8,14,Math.PI*.85),c1,.16,k*.05,0);f.rotation.z=k>0?-Math.PI*.15:Math.PI*1.15;g.add(f)})}
 else if(ak==="hands"){g.add(M(new T.SphereGeometry(.15,16,12),plastic("#e8eeff"),.16,0,0))}
 else if(ak==="tools"){var tg=gear(.17,.08,plastic("#ffd24d"));tg.position.set(.18,0,0);tg.rotation.z=Math.PI/2;g.add(tg);rig.toolGears=(rig.toolGears||[]).concat([tg])}
 else if(ak==="magnets"){var mg=M(new T.TorusGeometry(.13,.05,10,18,Math.PI),plastic("#ff5a4d"),.16,0,0);mg.rotation.z=-Math.PI/2;g.add(mg)}
 else{var pr=propeller(.24,"#ffd24d","#52b7ff");pr.position.set(.18,0,0);pr.rotation.z=Math.PI/2;g.add(spinner(pr,"x",22,rig))}}
function partBoots(id: string, bg: THREE.Group, col: RigColors, rig: ToyRig): void {if(!id||id==="none")return;var lk=id.replace("robot.legs.",""),chrome=metal("#c9d3f0"),dark=plastic("#16205a",{roughness:.5}),c1=paintMat(col.c1);
 if(lk==="walkers"){[.32,-.32].forEach(function(z){bg.add(M(rbox(.44,.14,.28,.05),dark,.08,.07,z));bg.add(M(new T.CylinderGeometry(.05,.06,.24,10),chrome,0,.2,z))})}
 else if(lk==="treads"){var tm=new T.MeshPhysicalMaterial({color:"#1c2550",roughness:.75,bumpMap:treadTex(),bumpScale:.04});[.36,-.36].forEach(function(z){bg.add(M(rbox(.96,.34,.26,.16),tm,.06,.18,z));[-.28,0,.28].forEach(function(x){var r=wheelMesh(.11,.28);r.position.set(x+.06,.18,z);bg.add(r);rig.wheels.push(r)})})}
 else if(lk==="wheels"){[.42,-.42].forEach(function(z){var w=wheelMesh(.28,.18);w.position.set(.05,.28,z);bg.add(w);rig.wheels.push(w)})}
 else if(lk==="springs"){[.3,-.3].forEach(function(z){for(var i=0;i<4;i++)bg.add(M(new T.TorusGeometry(.11,.03,8,18),i%2?chrome:c1,.04,.06+i*.07,z).rotateX(Math.PI/2))})}
 else{rig.hover=true;bg.add(M(new T.CylinderGeometry(.42,.3,.16,28),c1,0,.12,0));[.22,-.22].forEach(function(z){var f=M(new T.ConeGeometry(.09,.36,14),new T.MeshStandardMaterial({color:"#9bd4ff",emissive:"#52b7ff",emissiveIntensity:2.2,transparent:true,opacity:.85}),0,-.06,z);f.rotation.x=Math.PI;f.castShadow=false;bg.add(f);rig.flames!.push(f)})}}
function buildChar3(sel: RigSel, rig: ToyRig, slot: SlotFn, col: RigColors): void {rig.spinners=[];rig.flames=[];
 var sb=slot("base"),W=new T.Group();W.rotation.y=Math.PI/2;sb.add(W);
 var isRobHead=String(sel.base||"").indexOf("robot.head.")===0;
 var A=isRobHead?baseRobotKip(sel.base,W,sb,col,rig):(sel.base==="block"?baseBlock:sel.base==="vinyl"?baseVinyl:baseCreature)(W,sb,col,rig);rig.head=A.hd;
 ["eyes","ears","hat"].forEach(function(n){var g=new T.Group();A.hd.add(g);rig.slots[n]=g});
 partEyes(sel.eyes,A,rig.slots.eyes!,rig);partEars(sel.ears,A,rig.slots.ears!,col);rig.hair=rig.slots.ears;var hh=partHat(sel.hat,A,rig.slots.hat!,rig);
 var bk=slot("back"),bw=new T.Group();bw.rotation.y=Math.PI/2;bk.add(bw);partBack(sel.back,A,bw,bk,col,rig);
 var tl=slot("tail"),tw=new T.Group();tw.rotation.y=Math.PI/2;tl.add(tw);partTail(sel.tail,A,tw,col,rig);
 var pg=slot("prop");partProp(sel.prop,pg,col,rig);
 var btg=slot("boots");partBoots(sel.boots,btg,col,rig);
 rig.h=A.h+hh+.2;rig.w=A.w+(sel.back==="wings"?.6:0)}

export { TREAD, treadTex, buildToy, buildChar3, buildRobot2, wheelMesh, carBody, cabinBody, eyes, eyeOne, eyeZ, face, smileZ, blushZ, vin, glo, pvc, darken, noShadow, latheS, holder, spinner, propeller, baseVinyl, baseBlock, baseCreature, baseRobotKip, partEyes, partEars, partHat, partBack, partTail, partProp, partBoots, screenFace };
export {
  MAX_STL_CACHE,
  clearStlRigCache,
  getStlRigCacheStats,
  loadCachedStl,
  parseStlGeometry,
  resolveStlHeroRecipe,
  setStlRigFetcherForTest,
  upgradeRigWithStl,
} from "./stlRigLoader";
