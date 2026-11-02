// Native world runtime: worldScene (5A Unit 2b).
//
// Three.js stage: renderer, lights, materials, shape builders, post chain.
// Singletons are owned here and (re)initialized by initScene(canvas), which
// the world calls once per factory mount after resolving the host canvas.
// Pure builders never touch host or game state and are safe to share.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";

// Engine code references T.* passes via THREE namespace merge (legacy shape).
const T = { ...THREE, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, FXAAShader };

const QP: string = "auto";

let renderer!: THREE.WebGLRenderer;
let scene!: THREE.Scene;
let camera!: THREE.PerspectiveCamera;
let hemi!: THREE.HemisphereLight;
let sun!: THREE.DirectionalLight;
let rim!: THREE.DirectionalLight;
let hero!: THREE.PointLight;
let pmrem: THREE.PMREMGenerator | null = null;
let envRT: THREE.WebGLRenderTarget | null = null;
let envTex: THREE.Texture | null = null;
let envScale = 1;
let blob!: THREE.Mesh;

const MC: Record<string, THREE.Material> = {};
const GT: Record<string, THREE.Texture> = {};
const perf = { n: 0, sum: 0, done: false };

let composer: EffectComposer | null = null;
let bloom: UnrealBloomPass | null = null;
let grade: ShaderPass | null = null;
let fxaa: ShaderPass | null = null;

export function initScene(canvas: HTMLCanvasElement): boolean {
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    if (!renderer.getContext()) throw 0;
  } catch (e) {
    return false;
  }
  renderer.setPixelRatio(Math.min(QP === "low" ? 1 : 2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(36, 1, 0.1, 500);
  hemi = new T.HemisphereLight(0x9aa8ff, 0x1d5c6e, 0.62);
  scene.add(hemi);
  sun = new T.DirectionalLight(0xe4e9ff, 0.85);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3; // PCF filter radius in texels: soft penumbra without a second pass
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  var sc = sun.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 70;
  scene.add(sun);
  scene.add(sun.target);
  // Final physical intensities come from lighting.ts; mark these so linearize() never boosts them again.
  hemi.userData.lin = 1;
  sun.userData.lin = 1;
  rim = new T.DirectionalLight(0xa9c0ff, 0.5);
  rim.userData.lin = 1;
  rim.position.set(-6, 9, -12);
  scene.add(rim);
  // Soft follow light on the hero so faces stay readable in dusk and night worlds.
  hero = new T.PointLight(0xffe2b8, 0, 9, 2);
  hero.userData.lin = 1;
  scene.add(hero);
  pmrem = null; envRT = null; envTex = null; envScale = 1;
  setEnvironment(DEFAULT_ENV);
  var bmat=new T.MeshBasicMaterial({map:canv(128,128,function(g){var gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,"rgba(0,0,0,0.55)");gr.addColorStop(1,"rgba(0,0,0,0)");g.fillStyle=gr;g.fillRect(0,0,128,128)}),transparent:true,depthWrite:false});bmat.polygonOffset=true;bmat.polygonOffsetFactor=-2;bmat.polygonOffsetUnits=-2;blob=new T.Mesh(new T.PlaneGeometry(1,1),bmat);blob.rotation.x=-Math.PI/2;blob.renderOrder=1;scene.add(blob);
  composer = null; bloom = null; grade = null; fxaa = null;
  perf.n = 0; perf.sum = 0; perf.done = QP !== "auto";
  if (import.meta.env?.DEV) {
    // Dev-only lighting bench: tune lights/bloom/exposure live from the console.
    (window as unknown as Record<string, unknown>).__tvDebug = {
      get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; },
      get hemi() { return hemi; }, get sun() { return sun; }, get bloom() { return bloom; }, get grade() { return grade; },
    };
  }
  return true;
}

/* ---------- image-based light ---------- */
export interface EnvPalette { bg: number; top: number; topK: number; left: number; right: number; front: number }
export const DEFAULT_ENV: EnvPalette = { bg: 0x141c48, top: 0xffffff, topK: 1.8, left: 0x9fbcff, right: 0xffe2c4, front: 0xc9d6ff };
/** Rebuilds the studio environment the PBR materials reflect, tinted per world (sunset orange on junk, sky blue on day worlds). */
export function setEnvironment(p: EnvPalette): void {
  if (!renderer || !scene) return;
  if (!pmrem) pmrem = new T.PMREMGenerator(renderer);
  const es = new T.Scene();
  es.add(new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: p.bg, side: T.BackSide })));
  const panel = (x: number, y: number, z: number, w: number, h: number, c: number, k: number) => {
    const mm = new T.MeshBasicMaterial({ color: c, side: T.DoubleSide });
    mm.color.multiplyScalar(k);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), mm);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    es.add(m);
  };
  panel(0, 5.9, 0, 10, 7, p.top, p.topK);
  panel(-9.9, 2, 0, 6, 4, p.left, 1.1);
  panel(9.9, 1.5, 2, 5, 3, p.right, 1.0);
  panel(0, 1.5, 9.9, 9, 2.2, p.front, 0.8);
  const rt = pmrem.fromScene(es, 0.04);
  if (envRT) envRT.dispose();
  envRT = rt;
  envTex = rt.texture;
  scene.environment = envTex;
  es.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
}
/** Free the environment render target and the PMREM generator (engine teardown). */
export function disposeEnvironment(): void {
  if (envRT) { envRT.dispose(); envRT = null; }
  envTex = null;
  if (pmrem) { pmrem.dispose(); pmrem = null; }
}
/** Scales every material's own envMapIntensity (see bindEnv) so one world can be glossier or flatter than another. */
export function setEnvScale(s: number): void { envScale = s; }
/**
 * three r163+ ignores material.envMapIntensity whenever the light comes from scene.environment: it forces
 * scene.environmentIntensity on every standard material. That silently flattened this scene's authored
 * values (0.1 for matte ground, 1.3 for chrome). Binding the map to the material itself restores them.
 */
function bindEnv(root: THREE.Object3D): void {
  if (!envTex) return;
  root.traverse(function (o) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as THREE.MeshStandardMaterial[]) {
      if (!m || !(m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) continue;
      if (m.userData.env0 == null) m.userData.env0 = m.envMapIntensity;
      if (m.envMap === null || m.userData.envBound) { m.envMap = envTex; m.userData.envBound = 1; }
      m.envMapIntensity = (m.userData.env0 as number) * envScale;
    }
  });
}

/* ---------- canvas textures ---------- */
function canv(w: number, h: number, fn: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {var c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d")!,w,h);var tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx}
function glowTex(col: string): THREE.Texture {if(!GT[col])GT[col]=canv(128,128,function(g){var gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,col);gr.addColorStop(1,"rgba(0,0,0,0)");g.fillStyle=gr;g.fillRect(0,0,128,128)});return GT[col] as THREE.Texture}
function glowSprite(col: string, size: number, op?: number, normal?: unknown): THREE.Sprite {var s=new T.Sprite(new T.SpriteMaterial({map:glowTex(col),transparent:true,depthWrite:false,blending:normal?T.NormalBlending:T.AdditiveBlending,opacity:op==null?1:op,fog:false}));s.scale.set(size,size,1);return s}

/* ---------- materials ---------- */
function plastic(c: string, o?: Record<string, unknown>): THREE.MeshPhysicalMaterial {var k="p"+c+JSON.stringify(o||{});if(!MC[k])MC[k]=new T.MeshPhysicalMaterial(Object.assign({color:c,roughness:.34,metalness:0,clearcoat:.85,clearcoatRoughness:.16,envMapIntensity:.75},o||{}));return MC[k] as THREE.MeshPhysicalMaterial}
function matte(c: string, flat?: unknown): THREE.MeshStandardMaterial {var k="m"+c+flat;if(!MC[k])MC[k]=new T.MeshStandardMaterial({color:c,roughness:.85,metalness:0,flatShading:!!flat,envMapIntensity:.1});return MC[k] as THREE.MeshStandardMaterial}
function metal(c: string): THREE.MeshStandardMaterial {var k="x"+c;if(!MC[k])MC[k]=new T.MeshStandardMaterial({color:c,roughness:.3,metalness:.65,envMapIntensity:1.3});return MC[k] as THREE.MeshStandardMaterial}
function glowMat(c: string, i?: number): THREE.MeshStandardMaterial {var k="g"+c+i;if(!MC[k])MC[k]=new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:i||1.5,roughness:.4,envMapIntensity:.2});return MC[k] as THREE.MeshStandardMaterial}
function paintMat(c: string): THREE.MeshPhysicalMaterial {var k="pm"+c;if(!MC[k])MC[k]=new T.MeshPhysicalMaterial({color:c,metalness:.28,roughness:.3,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:1});return MC[k] as THREE.MeshPhysicalMaterial}
const GLASS = new T.MeshPhysicalMaterial({color:0x9fdcff,roughness:.05,clearcoat:1,transparent:true,opacity:.85});
const BUBBLE = new T.MeshPhysicalMaterial({color:0xcfeaff,roughness:.05,clearcoat:1,transparent:true,opacity:.35,side:T.DoubleSide,depthWrite:false});

/* ---------- shape builders ---------- */
function rbox(w: number, h: number, d: number, r: number): THREE.ExtrudeGeometry {var b=Math.min(r,.45*Math.min(w,h,d)),sw=w-2*b,sh=h-2*b,cr=Math.max(.001,Math.min(b,sw/2,sh/2)*.9),s=new T.Shape(),x=-sw/2,y=-sh/2;s.moveTo(x+cr,y);s.lineTo(x+sw-cr,y);s.quadraticCurveTo(x+sw,y,x+sw,y+cr);s.lineTo(x+sw,y+sh-cr);s.quadraticCurveTo(x+sw,y+sh,x+sw-cr,y+sh);s.lineTo(x+cr,y+sh);s.quadraticCurveTo(x,y+sh,x,y+sh-cr);s.lineTo(x,y+cr);s.quadraticCurveTo(x,y,x+cr,y);var dd=Math.max(.001,d-2*b),g=new T.ExtrudeGeometry(s,{depth:dd,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:6,curveSegments:10});g.translate(0,0,-dd/2);return g}
function M(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x?: number, y?: number, z?: number): THREE.Mesh {var m=new T.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);m.castShadow=true;m.receiveShadow=true;return m}
function G(...args: THREE.Object3D[]): THREE.Group {var g=new T.Group();for(var i=0;i<args.length;i++)g.add(args[i]!);return g}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {o.position.set(x,y,z);return o}
function capsule(r: number, len: number, mat: THREE.Material): THREE.Group {return G(M(new T.CylinderGeometry(r,r,len,16),mat),M(new T.SphereGeometry(r,16,12),mat,0,len/2,0),M(new T.SphereGeometry(r,16,12),mat,0,-len/2,0))}
function gear(r: number, th: number, mat: THREE.Material, teeth?: number): THREE.Group {var Z=teeth||8,m=2*r/Z,g=new T.Group();g.add(M(new T.CylinderGeometry(r,r,th,20),mat));for(var i=0;i<Z;i++){var t=M(new T.BoxGeometry(Math.PI*r/Z,th,2*m),mat),a=i/Z*Math.PI*2;t.position.set(Math.cos(a)*r,0,Math.sin(a)*r);t.rotation.y=-a;g.add(t)}g.add(M(new T.CylinderGeometry(r*.35,r*.35,th*1.1,12),plastic("#1c2550")));return g}
function hemiSphere(r: number, mat: THREE.Material): THREE.Mesh {return M(new T.SphereGeometry(r,28,16,0,Math.PI*2,0,Math.PI/2),mat)}
function starGeo(): THREE.ExtrudeGeometry {var s=new T.Shape();for(var i=0;i<8;i++){var a=i/8*Math.PI*2-Math.PI/2,r=i%2?.12:.36,x=Math.cos(a)*r,y=Math.sin(a)*r;if(i)s.lineTo(x,y);else s.moveTo(x,y)}return new T.ExtrudeGeometry(s,{depth:.06,bevelEnabled:true,bevelThickness:.03,bevelSize:.03,bevelSegments:2})}
const STARGEO = starGeo();
function linearize(root: THREE.Object3D): void {bindEnv(root);root.traverse(function(o){var l=o as THREE.Light;if(l.isLight&&!o.userData.lin){o.userData.lin=1;l.intensity*=(l as unknown as { isPointLight?: unknown }).isPointLight?5.5:2.6}})}

/* ---------- color grade + post chain ---------- */
const GRADE = {uniforms:{tDiffuse:{value:null},uTint:{value:new T.Vector3(1,1,1.04)},uVig:{value:.34},uSat:{value:1.14}},vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"varying vec2 vUv;uniform sampler2D tDiffuse;uniform vec3 uTint;uniform float uVig;uniform float uSat;void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));c.rgb=mix(vec3(l),c.rgb,uSat)*uTint;float v=smoothstep(.95,.3,length(vUv-.5)*1.3);c.rgb*=mix(1.-uVig,1.,v);gl_FragColor=c;}"};
const TINT: Record<string, [number, number, number]> = {garden:[.97,1.0,1.07],sky:[1.03,1.02,.98],junk:[1.09,.98,.93],beach:[1.04,1.02,.95],snow:[.95,1.0,1.08],room:[1.07,.99,.94]};

function setupPost(w: number, h: number): void {if(QP==="low"||!T.EffectComposer||!T.UnrealBloomPass)return;try{var pr0=renderer.getPixelRatio(),rt=renderer.capabilities.isWebGL2?new T.WebGLRenderTarget(w*pr0,h*pr0,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,type:T.HalfFloatType}):undefined;composer=new T.EffectComposer(renderer,rt);composer.addPass(new T.RenderPass(scene,camera));bloom=new T.UnrealBloomPass(new T.Vector2(256,256),.38,.42,1.0);composer.addPass(bloom);grade=new T.ShaderPass(GRADE);composer.addPass(grade);composer.addPass(new T.OutputPass());fxaa=new T.ShaderPass(T.FXAAShader);composer.addPass(fxaa)}catch(e){console.error(e);composer=null}}
function stepDown(onResize: () => void): void {if(bloom&&bloom.enabled){bloom.enabled=false;renderer.setPixelRatio(Math.min(1.25,window.devicePixelRatio||1));onResize();return}if(composer){composer=null;renderer.setPixelRatio(1);sun.shadow.mapSize.set(512,512);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null}onResize()}}

export {
  T,
  renderer, scene, camera, hemi, sun, rim, hero, blob, perf,
  composer, bloom, grade, fxaa,
  MC, GT, GLASS, BUBBLE, STARGEO, GRADE, TINT,
  setupPost, stepDown,
  canv, glowTex, glowSprite,
  plastic, matte, metal, glowMat, paintMat,
  rbox, M, G, at, capsule, gear, hemiSphere, starGeo, linearize,
};
