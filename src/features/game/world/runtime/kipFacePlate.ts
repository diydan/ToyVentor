// The Kip demo's face on the game's plate, as a three.js plane and material (the pure parts live in kipLook.ts so the stock-toy catalogue stays free of three).
import * as THREE from "three";
import { FACE_DECAL, drawKipFace, type FaceCtx } from "./kipLook";

/**
 * The face as a plane that hugs the plate: the demo's `buildConformalFaceplateDecalGeo`. Rays go straight down onto the plate (seated the way the game seats it: turned half a turn,
 * mesh stood up) and each vertex of a 56 x 28 plane takes the plate's height there plus a hair, so the art follows the plate's curve. Where a ray misses it falls back to a gentle arc.
 */
export function buildFaceDecalGeometry(plate: THREE.BufferGeometry): THREE.PlaneGeometry {
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI;
  const probe = new THREE.Mesh(plate, new THREE.MeshBasicMaterial());
  probe.rotation.x = -Math.PI / 2;
  holder.add(probe);
  holder.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, -1);
  const d = FACE_DECAL;
  const g = new THREE.PlaneGeometry(d.width, d.height, d.segX, d.segY);
  g.translate(0, d.centerY, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    let hitZ: number | null = null;
    origin.set(vx, vy, 28);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObject(holder, true);
    if (hits.length > 0 && hits[0]!.point.z > 0.2) hitZ = hits[0]!.point.z;
    if (hitZ === null) hitZ = d.fallbackZ - vx * vx * d.fallbackK;
    pos.setZ(i, hitZ + d.lift);
  }
  g.computeVertexNormals();
  return g;
}

let faceMaterial: THREE.MeshStandardMaterial | null | undefined;
/** The face's material: one canvas texture for the whole page (every rebuild of Kip shares it). Null where there is no canvas (a unit test, an old browser): the plate is then plain skin. */
export function kipFaceMaterial(): THREE.MeshStandardMaterial | null {
  if (faceMaterial !== undefined) return faceMaterial;
  faceMaterial = null;
  try {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    drawKipFace(ctx as FaceCtx, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceMaterial = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.02, roughness: 0.44, metalness: 0.0, envMapIntensity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  } catch {
    faceMaterial = null;
  }
  return faceMaterial;
}
