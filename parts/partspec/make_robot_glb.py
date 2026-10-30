#!/usr/bin/env python3
"""Animated GLB for a Snap robot: rigid toy animation, no skinning.

Each printed part is one node, chained the way the parts stack (legs -> torso -> arms -> head and back pack), each node's origin at the
point it turns about. Clips move the nodes the way a child moves a toy: Idle, Walk (a waddle), Jump (squash, leap, land) and Victory (a
spin and hop, arms raised). Units: metres, Y-up, standing on y = 0, the robot facing +z (glTF's front).
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from pygltflib import (GLTF2, Accessor, Animation, AnimationChannel, AnimationChannelTarget, AnimationSampler, Asset, Buffer, BufferView,
                       Material, Mesh, Node, PbrMetallicRoughness, Primitive, Scene)

import toyventor_assembly as asm
import toyventor_parts as tp

FLOAT, UINT = 5126, 5125
ARRAY, ELEMENT = 34962, 34963
CLIP_NAMES = ["Idle", "Walk", "Jump", "Victory"]


def to_gltf(p_mm):
    """Assembly frame (mm, z up, front is -y) -> glTF (m, y up, front is +z)."""
    x, y, z = p_mm
    return np.array([x, z, -y]) / 1000.0


def quat(axis, deg):
    a = np.asarray(axis, dtype=float); a /= np.linalg.norm(a)
    h = math.radians(deg) / 2
    return [*(a * math.sin(h)), math.cos(h)]


class _Blob:
    def __init__(self):
        self.data = bytearray()
        self.views = []

    def add(self, arr, target=None):
        while len(self.data) % 4:
            self.data.append(0)
        off = len(self.data)
        b = arr.tobytes()
        self.data += b
        self.views.append(BufferView(buffer=0, byteOffset=off, byteLength=len(b), target=target))
        return len(self.views) - 1


def _pivots(items):
    """Where each part turns: the centre of its underside (its stud holes), in assembly mm."""
    out = {}
    for it in items:
        p = it["pose"]
        out[it["id"]] = (p["x"], p["y"], p["z"])
    return out


def build_glb(lib, items, colours, path, parent_of):
    gl = GLTF2(asset=Asset(generator="ToyVentor make_robot_glb", version="2.0"))
    blob = _Blob()
    piv = _pivots(items)
    node_of = {}
    gl.nodes.append(Node(name="robot"))                                # node 0: the root, on the ground
    for it in items:
        tm = tp.to_trimesh(asm.placed_geometry(lib, it))
        try:
            tm = tm.smooth_shaded                       # split vertices on sharp edges, smooth normals elsewhere
        except Exception:
            tm.unmerge_vertices()                       # flat shading fallback
        v = np.array([to_gltf(p) for p in tm.vertices]) - to_gltf(piv[it["id"]])   # local to the part's own pivot
        n = np.array([[a, c, -b] for a, b, c in tm.vertex_normals])
        f = np.asarray(tm.faces, dtype=np.uint32).ravel()
        pv = blob.add(v.astype(np.float32), ARRAY)
        nv = blob.add(n.astype(np.float32), ARRAY)
        iv = blob.add(f, ELEMENT)
        pa = len(gl.accessors)
        gl.accessors += [Accessor(bufferView=pv, componentType=FLOAT, count=len(v), type="VEC3", min=v.min(0).tolist(), max=v.max(0).tolist()),
                         Accessor(bufferView=nv, componentType=FLOAT, count=len(n), type="VEC3"),
                         Accessor(bufferView=iv, componentType=UINT, count=len(f), type="SCALAR")]
        gl.materials.append(Material(name=it["part"], pbrMetallicRoughness=PbrMetallicRoughness(baseColorFactor=colours[it["id"]], metallicFactor=0.0, roughnessFactor=0.55)))
        gl.meshes.append(Mesh(name=it["part"], primitives=[Primitive(attributes={"POSITION": pa, "NORMAL": pa + 1}, indices=pa + 2, material=len(gl.materials) - 1)]))
        parent = parent_of[it["id"]]
        rel = to_gltf(piv[it["id"]]) - (to_gltf(piv[parent]) if parent else np.zeros(3))
        gl.nodes.append(Node(name=it["id"], mesh=len(gl.meshes) - 1, translation=rel.tolist()))
        node_of[it["id"]] = len(gl.nodes) - 1
        (gl.nodes[node_of[parent]] if parent else gl.nodes[0]).children.append(node_of[it["id"]])
    gl.scenes = [Scene(nodes=[0])]
    gl.scene = 0

    rest = {k: list(gl.nodes[i].translation) for k, i in node_of.items()}
    rest["robot"] = [0.0, 0.0, 0.0]
    node_of["robot"] = 0
    mm = 0.001
    UP, YAW, ROLL, PITCH = [0, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]

    def T(name, dy=0.0):
        r = rest[name]
        return [r[0], r[1] + dy, r[2]]

    clips = {
        "Idle": (2.0, {("torso", "translation"): [(0, T("torso")), (0.5, T("torso", 0.4 * mm)), (1.0, T("torso")), (1.5, T("torso", 0.4 * mm)), (2.0, T("torso"))],
                       ("head", "rotation"): [(0, quat(YAW, 0)), (0.5, quat(YAW, 14)), (1.0, quat(YAW, 0)), (1.5, quat(YAW, -14)), (2.0, quat(YAW, 0))],
                       ("arms", "rotation"): [(0, quat(YAW, 0)), (1.0, quat(YAW, 4)), (2.0, quat(YAW, 0))]}),
        "Walk": (0.8, {("robot", "translation"): [(0, T("robot")), (0.2, T("robot", 1.5 * mm)), (0.4, T("robot")), (0.6, T("robot", 1.5 * mm)), (0.8, T("robot"))],
                       ("robot", "rotation"): [(0, quat(ROLL, 0)), (0.2, quat(ROLL, 7)), (0.4, quat(ROLL, 0)), (0.6, quat(ROLL, -7)), (0.8, quat(ROLL, 0))],
                       ("head", "rotation"): [(0, quat(ROLL, 0)), (0.2, quat(ROLL, -4)), (0.4, quat(ROLL, 0)), (0.6, quat(ROLL, 4)), (0.8, quat(ROLL, 0))]}),
        "Jump": (1.0, {("robot", "translation"): [(0, T("robot")), (0.15, T("robot")), (0.45, T("robot", 18 * mm)), (0.75, T("robot")), (1.0, T("robot"))],
                       ("robot", "scale"): [(0, [1, 1, 1]), (0.15, [1.06, 0.88, 1.06]), (0.35, [0.97, 1.05, 0.97]), (0.6, [1, 1, 1]), (0.8, [1.05, 0.92, 1.05]), (1.0, [1, 1, 1])],
                       ("pack", "rotation"): [(0, quat(PITCH, 0)), (0.45, quat(PITCH, -8)), (0.75, quat(PITCH, 0)), (1.0, quat(PITCH, 0))]}),
        "Victory": (1.6, {("robot", "rotation"): [(0, quat(YAW, 0)), (0.2, quat(YAW, 90)), (0.4, quat(YAW, 180)), (0.6, quat(YAW, 270)), (0.8, quat(YAW, 360)), (1.6, quat(YAW, 360))],
                          ("robot", "translation"): [(0, T("robot")), (0.9, T("robot")), (1.1, T("robot", 10 * mm)), (1.3, T("robot")), (1.6, T("robot"))],
                          ("arms", "rotation"): [(0, quat(PITCH, 0)), (0.9, quat(PITCH, -18)), (1.3, quat(PITCH, -18)), (1.6, quat(PITCH, 0))],
                          ("head", "rotation"): [(0, quat(ROLL, 0)), (1.0, quat(ROLL, 10)), (1.6, quat(ROLL, 0))]}),
    }
    for name in CLIP_NAMES:
        dur, tracks = clips[name]
        anim = Animation(name=name)
        for (node, path_), keys in tracks.items():
            t = np.array([k[0] for k in keys], dtype=np.float32)
            vals = np.array([k[1] for k in keys], dtype=np.float32)
            ti = blob.add(t)
            vi = blob.add(vals)
            a0 = len(gl.accessors)
            gl.accessors += [Accessor(bufferView=ti, componentType=FLOAT, count=len(t), type="SCALAR", min=[float(t.min())], max=[float(t.max())]),
                             Accessor(bufferView=vi, componentType=FLOAT, count=len(vals), type="VEC4" if path_ == "rotation" else "VEC3")]
            anim.samplers.append(AnimationSampler(input=a0, output=a0 + 1, interpolation="LINEAR"))
            anim.channels.append(AnimationChannel(sampler=len(anim.samplers) - 1, target=AnimationChannelTarget(node=node_of[node], path=path_)))
        gl.animations.append(anim)
    while len(blob.data) % 4:
        blob.data.append(0)
    gl.buffers = [Buffer(byteLength=len(blob.data))]
    gl.bufferViews = blob.views
    gl.set_binary_blob(bytes(blob.data))
    gl.save_binary(str(path))
    return {"nodes": {k: v for k, v in node_of.items()}, "clips": {n: clips[n][0] for n in CLIP_NAMES}}


ROBOTS = {"bolt": {"build": "robot_bolt", "parents": {"legs": None, "torso": "legs", "arms": "torso", "head": "arms", "pack": "arms"},
                   "colours": {"legs": [0.42, 0.45, 0.5, 1.0], "torso": [0.24, 0.48, 0.91, 1.0], "arms": [0.95, 0.6, 0.15, 1.0],
                               "head": [0.92, 0.93, 0.95, 1.0], "pack": [0.86, 0.27, 0.24, 1.0]}}}


def export_robot(lib, key, out_dir, part_ids=None):
    spec = ROBOTS[key]
    items = getattr(asm, spec["build"])(lib)
    check = asm.validate(lib, items)
    out_dir.mkdir(parents=True, exist_ok=True)
    info = build_glb(lib, items, spec["colours"], out_dir / f"{key}.glb", spec["parents"])
    meta = {"id": key, "glb": f"robots/{key}.glb", "validated": {"ok": check["ok"], "joints": len(check["edges"]), "errors": check["errors"]},
            "parts": [{"node": it["id"], "partId": (part_ids or {}).get(it["part"], it["part"]), "sourceId": it["part"]} for it in items],
            "clips": [{"name": n, "seconds": s, "loop": n in ("Idle", "Walk")} for n, s in info["clips"].items()],
            "conventions": "Metres, y up, standing on y = 0, facing +z. One node per printed part, chained as they stack; rigid animation, no skinning."}
    (out_dir / f"{key}.json").write_text(json.dumps(meta, indent=2) + "\n")
    return meta


if __name__ == "__main__":
    lib = asm.Library(str(Path(__file__).parent / "toyventor_parts.json"))
    print(json.dumps(export_robot(lib, sys.argv[1] if len(sys.argv) > 1 else "bolt", Path("/tmp/robot_out"))["validated"]))
