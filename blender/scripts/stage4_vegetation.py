"""Stage 4 (Enhanced Lush Tropical Edition): Closed-canopy South Pacific cloud forest,
palms, giant tree ferns, fronded cliff scrub, dense wind-meadow grass + UE5 PCG export.

Ecological zonation for an undisturbed millennia-old South Pacific volcanic island (19-22 deg S):
  1. Closed-canopy broadleaf rainforest (SM_Tree_CloudForest_01/02):
     Dense interlocking crowns (min_dist 6.8m, 10-19m tall) across all basins, leeward valleys,
     and volcanic slopes up to 48 deg & 355m elevation (including East Islet's sheltered slopes).
  2. South Pacific Coastal & Valley Palms (SM_Tree_TropicalPalm_01):
     Curved ringed trunks & arching fronds framing Black Gravel Bay backshore, Mirror Lake shore,
     and warm lower valleys (4-175m elevation, slope <= 38 deg).
  3. Humid Cloud-Forest Giant Tree Ferns / Cyathea (SM_Tree_Fern_01):
     Lush mid-story (4-7.5m tall) filling the damp caldera bowl & ravines under tall canopies.
  4. Fronded Tropical Shrubs & Cliff-Clinging Scrub (SM_Bush_Tropical_01):
     Broad-leaf tropical fern/scrub rosettes densely blanketing the forest floor AND clinging to
     steep volcanic slopes/ledges up to 62 deg & 385m (only sheer >62 deg black basalt cliffs,
     razor summit spires, Wind Meadow, Mirror Lake, river, and white sand stay bare).
  5. Dense Wind-Swept Meadow Grass (SM_Grass_Meadow_01):
     Lush continuous wind-bent grass carpet across Wind Meadow (~165m), free of tall trees.
"""

import json
import math
import os
import random
import sys
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(WORKSPACE, "三维", "data")
ASSETS_DIR = os.path.join(WORKSPACE, "三维", "assets")
BLEND_PATH = os.path.join(WORKSPACE, "blender", "island_env.blend")
RENDER_DIR = os.path.join(WORKSPACE, "blender", "renders")
EXPORT_UE_DIR = os.path.join(WORKSPACE, "blender", "export_ue")
os.makedirs(RENDER_DIR, exist_ok=True)
os.makedirs(EXPORT_UE_DIR, exist_ok=True)


def link_only_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def clear_collection_recursive(col):
    for child in list(col.children):
        clear_collection_recursive(child)
        col.children.unlink(child)
        bpy.data.collections.remove(child)
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)


def find_layer_collection(layer_col, target_col):
    if layer_col.collection == target_col:
        return layer_col
    for child in layer_col.children:
        hit = find_layer_collection(child, target_col)
        if hit is not None:
            return hit
    return None


def _on(socks, name):
    return next(s for s in socks if s.enabled and s.name == name)


def build_scatter_nodetree(tree_name="GN_Island_Scatter"):
    ng = bpy.data.node_groups.get(tree_name)
    if ng is not None:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(tree_name, "GeometryNodeTree")
    ng.is_modifier = True

    for nm, kind, default in (
        ("Geometry", "Geometry", None),
        ("Collection", "Collection", None),
        ("Density", "Float", 0.02),
        ("Distance Min", "Float", 7.0),
        ("Max Slope", "Float", 48.0),
        ("Height Min", "Float", 6.0),
        ("Height Max", "Float", 355.0),
        ("Scale Min", "Float", 0.85),
        ("Scale Max", "Float", 1.50),
        ("Align", "Float", 0.08),
        ("Sink Z", "Float", -0.45),
        ("Seed", "Int", 1),
    ):
        s = ng.interface.new_socket(nm, in_out="INPUT", socket_type=f"NodeSocket{kind}")
        if default is not None:
            s.default_value = default
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    L = ng.links.new

    def N(type_, **props):
        node = ng.nodes.new(type_)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    gi, go = N("NodeGroupInput"), N("NodeGroupOutput")
    I = gi.outputs

    attr_w = N("GeometryNodeInputNamedAttribute", data_type="FLOAT")
    attr_w.inputs["Name"].default_value = "Scatter_Weight"

    dist = N("GeometryNodeDistributePointsOnFaces", distribute_method="POISSON")
    L(I["Geometry"], dist.inputs["Mesh"])
    L(I["Density"], dist.inputs["Density Max"])
    L(I["Distance Min"], dist.inputs["Distance Min"])
    L(attr_w.outputs["Attribute"], dist.inputs["Density Factor"])
    L(I["Seed"], dist.inputs["Seed"])

    sep_n = N("ShaderNodeSeparateXYZ")
    L(dist.outputs["Normal"], sep_n.inputs[0])
    rad = N("ShaderNodeMath", operation="RADIANS")
    cosmax = N("ShaderNodeMath", operation="COSINE")
    L(I["Max Slope"], rad.inputs[0])
    L(rad.outputs[0], cosmax.inputs[0])
    flat = N("FunctionNodeCompare", data_type="FLOAT", operation="GREATER_EQUAL")
    L(sep_n.outputs["Z"], _on(flat.inputs, "A"))
    L(cosmax.outputs[0], _on(flat.inputs, "B"))

    sep_p = N("ShaderNodeSeparateXYZ")
    L(N("GeometryNodeInputPosition").outputs[0], sep_p.inputs[0])
    above = N("FunctionNodeCompare", data_type="FLOAT", operation="GREATER_EQUAL")
    L(sep_p.outputs["Z"], _on(above.inputs, "A"))
    L(I["Height Min"], _on(above.inputs, "B"))
    below = N("FunctionNodeCompare", data_type="FLOAT", operation="LESS_EQUAL")
    L(sep_p.outputs["Z"], _on(below.inputs, "A"))
    L(I["Height Max"], _on(below.inputs, "B"))

    a1 = N("FunctionNodeBooleanMath", operation="AND")
    L(flat.outputs[0], a1.inputs[0])
    L(above.outputs[0], a1.inputs[1])
    keep = N("FunctionNodeBooleanMath", operation="AND")
    L(a1.outputs[0], keep.inputs[0])
    L(below.outputs[0], keep.inputs[1])

    yaw = N("FunctionNodeRandomValue", data_type="FLOAT")
    _on(yaw.inputs, "Max").default_value = 2.0 * math.pi
    L(I["Seed"], _on(yaw.inputs, "Seed"))
    eul = N("ShaderNodeCombineXYZ")
    L(_on(yaw.outputs, "Value"), eul.inputs["Z"])
    e2r = N("FunctionNodeEulerToRotation")
    L(eul.outputs[0], e2r.inputs[0])

    align = N("FunctionNodeAlignRotationToVector")
    align.axis = "Z"
    L(I["Align"], align.inputs["Factor"])
    L(dist.outputs["Normal"], align.inputs["Vector"])

    rot = N("FunctionNodeRotateRotation")
    rot.rotation_space = "LOCAL"
    L(align.outputs[0], rot.inputs["Rotation"])
    L(e2r.outputs[0], rot.inputs["Rotate By"])

    scl = N("FunctionNodeRandomValue", data_type="FLOAT")
    L(I["Scale Min"], _on(scl.inputs, "Min"))
    L(I["Scale Max"], _on(scl.inputs, "Max"))
    sd = N("ShaderNodeMath", operation="ADD")
    L(I["Seed"], sd.inputs[0])
    sd.inputs[1].default_value = 17
    L(sd.outputs[0], _on(scl.inputs, "Seed"))

    col_info = N("GeometryNodeCollectionInfo")
    col_info.transform_space = "ORIGINAL"
    col_info.inputs["Separate Children"].default_value = True
    col_info.inputs["Reset Children"].default_value = True
    L(I["Collection"], col_info.inputs["Collection"])

    inst = N("GeometryNodeInstanceOnPoints")
    inst.inputs["Pick Instance"].default_value = True
    pick = N("FunctionNodeRandomValue", data_type="INT")
    _on(pick.inputs, "Min").default_value = 0
    _on(pick.inputs, "Max").default_value = 1 << 20
    L(I["Seed"], _on(pick.inputs, "Seed"))
    L(dist.outputs["Points"], inst.inputs["Points"])
    L(keep.outputs[0], inst.inputs["Selection"])
    L(col_info.outputs[0], inst.inputs["Instance"])
    L(_on(pick.outputs, "Value"), inst.inputs["Instance Index"])
    L(rot.outputs[0], inst.inputs["Rotation"])
    L(_on(scl.outputs, "Value"), inst.inputs["Scale"])

    sink_vec = N("ShaderNodeCombineXYZ")
    L(I["Sink Z"], sink_vec.inputs["Z"])
    sink = N("GeometryNodeTranslateInstances")
    L(inst.outputs["Instances"], sink.inputs["Instances"])
    L(sink_vec.outputs[0], sink.inputs["Translation"])

    L(sink.outputs["Instances"], go.inputs["Geometry"])
    return ng


def import_and_normalize_tree_prototypes(col_tree_src):
    """Import island-tree-near.glb -> SM_Tree_CloudForest_01 (13m) & 02 (11.2m broad dark emerald)."""
    glb_path = os.path.join(ASSETS_DIR, "landscape", "island-tree-near.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    imported = [o for o in bpy.data.objects if o not in before]
    mesh_objs = [o for o in imported if o.type == "MESH"]

    mat_rename = {
        "island_tree_01": "M_Tree_Bark",
        "island_tree_01_branches": "M_Tree_Branches",
        "island_tree_01_leaves": "M_Tree_Leaves",
    }
    for old_n, new_n in mat_rename.items():
        m = bpy.data.materials.get(old_n)
        if m is not None:
            existing = bpy.data.materials.get(new_n)
            if existing is not None and existing != m:
                bpy.data.materials.remove(existing)
            m.name = new_n
            if new_n == "M_Tree_Leaves":
                m.surface_render_method = "DITHERED"

    non_mesh_names = [o.name for o in imported if o.type != "MESH"]
    tree1_name = mesh_objs[0].name
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in mesh_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]
    with bpy.context.temp_override(
        active_object=mesh_objs[0],
        selected_objects=mesh_objs,
        selected_editable_objects=mesh_objs,
    ):
        bpy.ops.object.join()

    tree1 = bpy.data.objects[tree1_name]
    for nm in non_mesh_names:
        o = bpy.data.objects.get(nm)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)

    tree1.name = "SM_Tree_CloudForest_01"
    tree1.data.name = "SM_Tree_CloudForest_01"
    link_only_to(tree1, col_tree_src)

    # Normalize to lush 13.0m height with broad umbrella crown (14.5m wide) for dense canopy interlock
    verts = tree1.data.vertices
    coords = np.empty(len(verts) * 3, dtype=np.float32)
    verts.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    cx = 0.5 * (coords[:, 0].min() + coords[:, 0].max())
    cy = 0.5 * (coords[:, 1].min() + coords[:, 1].max())
    min_z = float(coords[:, 2].min())
    cur_h = float(coords[:, 2].max() - min_z)
    scale_f = 13.0 / max(cur_h, 0.1)
    coords[:, 0] = (coords[:, 0] - cx) * scale_f * 1.12
    coords[:, 1] = (coords[:, 1] - cy) * scale_f * 1.12
    coords[:, 2] = (coords[:, 2] - min_z) * scale_f
    verts.foreach_set("co", coords.ravel())
    tree1.location = (0.0, 0.0, 0.0)
    tree1.rotation_euler = (0.0, 0.0, 0.0)
    tree1.scale = (1.0, 1.0, 1.0)
    tree1.data.update()

    # Broader, deeper tropical emerald variant SM_Tree_CloudForest_02
    mesh2 = tree1.data.copy()
    mesh2.name = "SM_Tree_CloudForest_02"
    coords2 = coords.copy()
    ang = math.radians(73.0)
    ca, sa = math.cos(ang), math.sin(ang)
    rx = coords2[:, 0] * ca - coords2[:, 1] * sa
    ry = coords2[:, 0] * sa + coords2[:, 1] * ca
    coords2[:, 0] = rx * 1.15
    coords2[:, 1] = ry * 1.10
    coords2[:, 2] = coords2[:, 2] * 0.86
    mesh2.vertices.foreach_set("co", coords2.ravel())
    mesh2.update()

    m_leaf1 = bpy.data.materials.get("M_Tree_Leaves")
    if m_leaf1 is not None:
        m_leaf2 = bpy.data.materials.get("M_Tree_Leaves_Dark")
        if m_leaf2 is not None:
            bpy.data.materials.remove(m_leaf2)
        m_leaf2 = m_leaf1.copy()
        m_leaf2.name = "M_Tree_Leaves_Dark"
        nt = m_leaf2.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf and bsdf.inputs["Base Color"].is_linked:
            src_sock = bsdf.inputs["Base Color"].links[0].from_socket
            nt.links.remove(bsdf.inputs["Base Color"].links[0])
            hsv = nt.nodes.new("ShaderNodeHueSaturation")
            hsv.inputs["Hue"].default_value = 0.515
            hsv.inputs["Saturation"].default_value = 1.10
            hsv.inputs["Value"].default_value = 0.68
            nt.links.new(src_sock, hsv.inputs["Color"])
            nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
        for slot_i, mat in enumerate(mesh2.materials):
            if mat == m_leaf1:
                mesh2.materials[slot_i] = m_leaf2

    tree2 = bpy.data.objects.new("SM_Tree_CloudForest_02", mesh2)
    link_only_to(tree2, col_tree_src)
    return tree1, tree2


def make_foliage_material(name, col_root, col_tip, rough=0.62, sss=0.14):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = rough
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = sss

    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])

    cmix = nt.nodes.new("ShaderNodeMix")
    cmix.data_type = "RGBA"
    cmix.inputs[6].default_value = (*col_root, 1.0)
    cmix.inputs[7].default_value = (*col_tip, 1.0)
    nt.links.new(sep.outputs["Y"], cmix.inputs["Factor"])
    nt.links.new(cmix.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def make_trunk_material(name, col_a, col_b):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.88

    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y"
    wave.inputs["Scale"].default_value = 6.0
    wave.inputs["Distortion"].default_value = 2.0
    nt.links.new(tc.outputs["UV"], wave.inputs["Vector"])

    cmix = nt.nodes.new("ShaderNodeMix")
    cmix.data_type = "RGBA"
    cmix.inputs[6].default_value = (*col_a, 1.0)
    cmix.inputs[7].default_value = (*col_b, 1.0)
    nt.links.new(wave.outputs["Fac"], cmix.inputs["Factor"])
    nt.links.new(cmix.outputs[2], bsdf.inputs["Base Color"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def add_curved_frond(bm, uv_l, origin, yaw, pitch_start, length, max_width, droop, segs=6, mat_idx=1, root_vert=None, clamp_min_z=None):
    """Add a single connected, V-folded arching tropical frond attached directly to origin/root_vert."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    prev_l = prev_c = prev_r = None
    for s in range(segs + 1):
        t = s / segs
        r_dist = length * t
        z = origin.z + math.sin(pitch_start) * r_dist - droop * (t ** 2.1) * length
        if clamp_min_z is not None and s > 0:
            z = max(z, clamp_min_z)
        w = max_width * math.sin(math.pi * (t ** 0.72)) if s < segs else 0.0
        v_dip = w * 0.28
        cx = origin.x + ca * r_dist
        cy = origin.y + sa * r_dist

        if s == 0:
            vc = root_vert if root_vert is not None else bm.verts.new((origin.x, origin.y, origin.z))
            vl = bm.verts.new((cx - sa * 0.04, cy + ca * 0.04, origin.z))
            vr = bm.verts.new((cx + sa * 0.04, cy - ca * 0.04, origin.z))
        elif s == segs:
            vt = bm.verts.new((cx, cy, z))
            f1 = bm.faces.new((prev_l, prev_c, vt))
            f2 = bm.faces.new((prev_c, prev_r, vt))
            for f in (f1, f2):
                f.material_index = mat_idx
                f.smooth = True
            for lp, uv_val in zip(f1.loops, [(0.0, (segs - 1) / segs), (0.5, (segs - 1) / segs), (0.5, 1.0)]):
                lp[uv_l].uv = uv_val
            for lp, uv_val in zip(f2.loops, [(0.5, (segs - 1) / segs), (1.0, (segs - 1) / segs), (0.5, 1.0)]):
                lp[uv_l].uv = uv_val
            return
        else:
            z_edge = z - v_dip
            if clamp_min_z is not None:
                z_edge = max(z_edge, clamp_min_z)
            vc = bm.verts.new((cx, cy, z))
            vl = bm.verts.new((cx - sa * w, cy + ca * w, z_edge))
            vr = bm.verts.new((cx + sa * w, cy - ca * w, z_edge))

        if prev_c is not None:
            t0 = (s - 1) / segs
            f1 = bm.faces.new((prev_l, prev_c, vc, vl))
            f2 = bm.faces.new((prev_c, prev_r, vr, vc))
            for f in (f1, f2):
                f.material_index = mat_idx
                f.smooth = True
            for lp, uv_val in zip(f1.loops, [(0.0, t0), (0.5, t0), (0.5, t), (0.0, t)]):
                lp[uv_l].uv = uv_val
            for lp, uv_val in zip(f2.loops, [(0.5, t0), (1.0, t0), (1.0, t), (0.5, t)]):
                lp[uv_l].uv = uv_val
        prev_l, prev_c, prev_r = vl, vc, vr


def set_radial_cap_uvs(face, uv_l, sides, k, reverse=False):
    a0 = 2.0 * math.pi * k / sides
    a1 = 2.0 * math.pi * ((k + 1) % sides) / sides
    u0 = (0.5 + 0.45 * math.cos(a0), 0.5 + 0.45 * math.sin(a0))
    u1 = (0.5 + 0.45 * math.cos(a1), 0.5 + 0.45 * math.sin(a1))
    uvs = [(0.5, 0.5), u1, u0] if reverse else [(0.5, 0.5), u0, u1]
    for lp, uv_val in zip(face.loops, uvs):
        lp[uv_l].uv = uv_val


def build_palm_prototype(col_palm_src):
    """Build a South Pacific tropical palm (12.5m tall, curved ringed trunk + 12 arching fronds)."""
    bm = bmesh.new()
    uv_l = bm.loops.layers.uv.new("UVMap")

    height = 11.8
    segs_t = 12
    sides = 8
    rings = []
    for s in range(segs_t + 1):
        t = s / segs_t
        z = height * t
        cx = 1.45 * math.sin(t * math.pi * 0.72) + 0.35 * (t ** 2)
        cy = 0.55 * (t ** 1.6)
        rad = (0.34 * (1.0 - t) + 0.17 * t) * (1.0 + 0.25 * max(0.0, 1.0 - t * 5.0))
        ring = []
        for k in range(sides):
            ang = 2.0 * math.pi * k / sides
            ring.append(bm.verts.new((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad, z)))
        rings.append(ring)

    for s in range(segs_t):
        r0, r1 = rings[s], rings[s + 1]
        for k in range(sides):
            kn = (k + 1) % sides
            f = bm.faces.new((r0[k], r0[kn], r1[kn], r1[k]))
            f.material_index = 0
            f.smooth = True
            for lp, uv_val in zip(f.loops, [(k / sides, s / segs_t), ((k + 1) / sides, s / segs_t), ((k + 1) / sides, (s + 1) / segs_t), (k / sides, (s + 1) / segs_t)]):
                lp[uv_l].uv = uv_val

    bot_c = bm.verts.new((0.0, 0.0, 0.0))
    crown_pos = Vector((1.45 * math.sin(math.pi * 0.72) + 0.35, 0.55, height))
    top_c = bm.verts.new(crown_pos)
    for k in range(sides):
        kn = (k + 1) % sides
        fb = bm.faces.new((bot_c, rings[0][kn], rings[0][k]))
        ft = bm.faces.new((top_c, rings[-1][k], rings[-1][kn]))
        fb.material_index = 0
        ft.material_index = 0
        set_radial_cap_uvs(fb, uv_l, sides, k, reverse=True)
        set_radial_cap_uvs(ft, uv_l, sides, k, reverse=False)

    # 12 arching palm fronds anchored cleanly into top_c (single connected mesh, zero non-manifold)
    for i in range(12):
        upper = i < 5
        yaw = (i / (5.0 if upper else 7.0)) * math.tau + (0.35 if upper else 0.0)
        pitch = math.radians(48.0 if upper else 24.0)
        length = 3.8 if upper else 4.9
        droop = 0.68 if upper else 0.85
        anchor = crown_pos + Vector((math.cos(yaw) * 0.06, math.sin(yaw) * 0.06, 0.04 if upper else -0.05))
        add_curved_frond(bm, uv_l, anchor, yaw, pitch, length, max_width=0.72, droop=droop, segs=6, mat_idx=1, root_vert=top_c)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("SM_Tree_TropicalPalm_01")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    m_trunk = make_trunk_material("M_Palm_Trunk", (0.14, 0.11, 0.08), (0.24, 0.20, 0.15))
    m_frond = make_foliage_material("M_Palm_Fronds", (0.028, 0.088, 0.020), (0.075, 0.165, 0.032), rough=0.54, sss=0.14)
    mesh.materials.append(m_trunk)
    mesh.materials.append(m_frond)

    obj = bpy.data.objects.new("SM_Tree_TropicalPalm_01", mesh)
    link_only_to(obj, col_palm_src)
    return obj


def build_tree_fern_prototype(col_fern_src):
    """Build a South Pacific cloud-forest giant tree fern / Cyathea (~5.2m tall, umbrella fronds)."""
    bm = bmesh.new()
    uv_l = bm.loops.layers.uv.new("UVMap")

    height = 4.6
    segs_t = 7
    sides = 7
    rings = []
    for s in range(segs_t + 1):
        t = s / segs_t
        z = height * t
        cx = 0.25 * math.sin(t * math.pi * 0.8)
        rad = 0.24 * (1.0 - t) + 0.15 * t
        ring = [bm.verts.new((cx + math.cos(2 * math.pi * k / sides) * rad, math.sin(2 * math.pi * k / sides) * rad, z)) for k in range(sides)]
        rings.append(ring)

    for s in range(segs_t):
        r0, r1 = rings[s], rings[s + 1]
        for k in range(sides):
            kn = (k + 1) % sides
            f = bm.faces.new((r0[k], r0[kn], r1[kn], r1[k]))
            f.material_index = 0
            f.smooth = True
            for lp, uv_val in zip(f.loops, [(k / sides, s / segs_t), ((k + 1) / sides, s / segs_t), ((k + 1) / sides, (s + 1) / segs_t), (k / sides, (s + 1) / segs_t)]):
                lp[uv_l].uv = uv_val

    bot_c = bm.verts.new((0.0, 0.0, 0.0))
    crown_pos = Vector((0.25 * math.sin(math.pi * 0.8), 0.0, height))
    top_c = bm.verts.new(crown_pos)
    for k in range(sides):
        kn = (k + 1) % sides
        fb = bm.faces.new((bot_c, rings[0][kn], rings[0][k]))
        ft = bm.faces.new((top_c, rings[-1][k], rings[-1][kn]))
        fb.material_index = 0
        ft.material_index = 0
        set_radial_cap_uvs(fb, uv_l, sides, k, reverse=True)
        set_radial_cap_uvs(ft, uv_l, sides, k, reverse=False)

    for i in range(11):
        upper = i < 4
        yaw = (i / (4.0 if upper else 7.0)) * math.tau + (0.4 if upper else 0.0)
        pitch = math.radians(44.0 if upper else 22.0)
        length = 2.6 if upper else 3.4
        droop = 0.52 if upper else 0.68
        anchor = crown_pos + Vector((math.cos(yaw) * 0.05, math.sin(yaw) * 0.05, 0.03 if upper else -0.04))
        add_curved_frond(bm, uv_l, anchor, yaw, pitch, length, max_width=0.68, droop=droop, segs=5, mat_idx=1, root_vert=top_c)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("SM_Tree_Fern_01")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    m_trunk = make_trunk_material("M_TreeFern_Trunk", (0.06, 0.045, 0.035), (0.11, 0.085, 0.06))
    m_frond = make_foliage_material("M_TreeFern_Fronds", (0.018, 0.068, 0.016), (0.052, 0.132, 0.026), rough=0.60, sss=0.14)
    mesh.materials.append(m_trunk)
    mesh.materials.append(m_frond)

    obj = bpy.data.objects.new("SM_Tree_Fern_01", mesh)
    link_only_to(obj, col_fern_src)
    return obj


def build_fronded_bush_prototype(col_bush_src):
    """Build a natural broad-leaf tropical fern/elephant-ear shrub rosette (~2.4m tall, ground Z=0, single island)."""
    bm = bmesh.new()
    uv_l = bm.loops.layers.uv.new("UVMap")

    root_pos = Vector((0.0, 0.0, 0.0))
    root_v = bm.verts.new(root_pos)
    for i in range(18):
        tier = i % 3
        yaw = i * 2.39996
        pitch = math.radians(60.0 if tier == 0 else (42.0 if tier == 1 else 26.0))
        length = 1.95 if tier == 0 else (2.40 if tier == 1 else 2.65)
        width = 0.56 if tier == 0 else (0.68 if tier == 1 else 0.72)
        droop = 0.36 if tier == 0 else (0.44 if tier == 1 else 0.42)
        add_curved_frond(
            bm, uv_l, Vector((0.0, 0.0, 0.16)), yaw, pitch, length,
            max_width=width, droop=droop, segs=4, mat_idx=0, root_vert=root_v, clamp_min_z=0.04,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("SM_Bush_Tropical_01")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    mat = make_foliage_material("M_Bush_Tropical", (0.014, 0.054, 0.015), (0.044, 0.112, 0.024), rough=0.66, sss=0.12)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("SM_Bush_Tropical_01", mesh)
    link_only_to(obj, col_bush_src)
    return obj


def build_meadow_grass_prototype(col_grass_src):
    """Build a single-island lush wind-bent volcanic meadow grass tuft (~1.05m tall, origin at Z=0)."""
    bm = bmesh.new()
    uv_l = bm.loops.layers.uv.new("UVMap")
    hub_c = bm.verts.new((0.0, 0.0, 0.0))
    for blade in range(20):
        ang = blade * 2.39996
        dx, dy = math.cos(ang), math.sin(ang)
        w = 0.055 + 0.024 * (blade % 3)
        h = 0.62 + (blade % 5) * 0.12
        r0 = 0.03
        lean_x = -0.20 * h
        lean_y = 0.15 * h
        rx, ry = dx * r0, dy * r0
        v0 = bm.verts.new((rx - dy * w, ry + dx * w, 0.0))
        v1 = bm.verts.new((rx + dy * w, ry - dx * w, 0.0))
        v2 = bm.verts.new((rx + dx * 0.42 + lean_x * 0.45 + dy * w * 0.55, ry + dy * 0.42 + lean_y * 0.45 - dx * w * 0.55, h * 0.58))
        v3 = bm.verts.new((rx + dx * 0.42 + lean_x * 0.45 - dy * w * 0.55, ry + dy * 0.42 + lean_y * 0.45 + dx * w * 0.55, h * 0.58))
        vt = bm.verts.new((rx + dx * 0.85 + lean_x, ry + dy * 0.85 + lean_y, h))
        f0 = bm.faces.new((hub_c, v1, v0))
        f1 = bm.faces.new((v0, v1, v2, v3))
        f2 = bm.faces.new((v3, v2, vt))
        for lp, uv_val in zip(f0.loops, [(0.5, 0.0), (1.0, 0.05), (0.0, 0.05)]):
            lp[uv_l].uv = uv_val
        for lp, uv_val in zip(f1.loops, [(0.0, 0.05), (1.0, 0.05), (0.8, 0.6), (0.2, 0.6)]):
            lp[uv_l].uv = uv_val
        for lp, uv_val in zip(f2.loops, [(0.2, 0.6), (0.8, 0.6), (0.5, 1.0)]):
            lp[uv_l].uv = uv_val

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("SM_Grass_Meadow_01")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    mat = make_foliage_material("M_Grass_Meadow", (0.025, 0.085, 0.022), (0.082, 0.175, 0.040), rough=0.64, sss=0.14)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("SM_Grass_Meadow_01", mesh)
    link_only_to(obj, col_grass_src)
    return obj


def dist_point_to_polyline_np(px, py, pts):
    best = np.full_like(px, 1e12, dtype=np.float32)
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        vx, vy = bx - ax, by - ay
        l2 = vx * vx + vy * vy
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / max(l2, 1e-6), 0.0, 1.0)
        dx = px - (ax + t * vx)
        dy = py - (ay + t * vy)
        best = np.minimum(best, dx * dx + dy * dy)
    return np.sqrt(best)


def beach_sand_mask_np(xx_km, yy_km, zz):
    west, east = -0.265, 0.060
    t = np.clip((xx_km - west) / (east - west), 0.0, 1.0)
    arc = np.sin(np.pi * t)
    shore = (
        0.447 - 0.028 * t - 0.032 * arc * arc
        + 0.004 * np.sin(2.0 * np.pi * t)
        - 0.072 * (np.clip((t - 0.83) / 0.17, 0.0, 1.0) ** 2.4)
    )
    inland = (shore - yy_km) * 1000.0
    width = np.sqrt(np.maximum(0.0, arc)) * (45.0 + 6.0 * np.sin(t * np.pi * 2.0 + 0.8))
    in_x = (xx_km > west) & (xx_km < east)
    return in_x & (inland > -12.0) & (inland < width + 6.0) & (zz < 9.0)


def build_emitter_mesh(name, meta, hf, mat_ids, kind):
    """Extract only eligible faces from terrain grid into a lightweight scatter emitter with Scatter_Weight."""
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    x0, y0, step = float(g["x0"]) * 1000.0, float(g["y0"]) * 1000.0, float(g["step"]) * 1000.0
    xs = x0 + np.arange(nx, dtype=np.float32) * step
    ys = y0 + np.arange(ny, dtype=np.float32) * step
    xx, yy = np.meshgrid(xs, ys)
    zz = hf.reshape(ny, nx).astype(np.float32)
    m2 = mat_ids.reshape(ny, nx)
    dz_dy, dz_dx = np.gradient(zz, step, step)
    slope_deg = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))

    river_pts = [(p[0] * 1000.0, p[1] * 1000.0) for p in meta["riverProfile"][: int(meta["lipIndex"]) + 1]]
    d_river = dist_point_to_polyline_np(xx, yy, river_pts)
    d_barracks = np.hypot(xx - (-850.0), yy - 150.0)
    d_villa_n = np.hypot(xx - (-230.0), yy - (-1083.0))
    d_villa_face = np.hypot(xx - (-220.0), yy - (-1150.0))
    on_beach = beach_sand_mask_np(xx / 1000.0, yy / 1000.0, zz)
    not_water_or_meadow = (m2 != 0) & (m2 != 2) & (m2 != 5) & (m2 != 6) & (m2 != 7) & (~on_beach)
    not_protected = (d_river > 11.0) & (d_barracks > 30.0) & (d_villa_n > 28.0) & (d_villa_face > 70.0)

    # Organic multi-octave botanical clumping field in [0, 1] (prevents uniform polka-dot spacing)
    clump_a = (
        0.5
        + 0.25 * np.sin(xx * 0.017 + yy * 0.011 + 0.6) * np.cos(xx * 0.013 - yy * 0.019 + 1.2)
        + 0.16 * np.sin(xx * 0.041 - yy * 0.033 + 2.1)
        + 0.09 * np.cos(xx * 0.079 + yy * 0.067 - 0.5)
    )
    clump_b = (
        0.5
        + 0.26 * np.cos(xx * 0.021 - yy * 0.015 - 0.8) * np.sin(xx * 0.014 + yy * 0.023 + 0.4)
        + 0.15 * np.cos(xx * 0.049 + yy * 0.037 + 1.7)
        + 0.09 * np.sin(xx * 0.083 - yy * 0.071 + 0.9)
    )

    if kind == "canopy":
        # Lush closed canopy climbs all forest & upper green shoulders up to 50 deg & 360m
        valid = not_water_or_meadow & not_protected & (zz >= 5.0) & (zz <= 360.0) & (slope_deg <= 50.0)
        for sp in meta["spires"]:
            if sp["name"] in ("主崖岬", "西尖塔", "东尖塔"):
                valid &= np.hypot(xx - sp["p"][0] * 1000.0, yy - sp["p"][1] * 1000.0) > 26.0
        weight = valid.astype(np.float32)
    elif kind == "palms":
        # Warm tropical palms: continuous grove along White Sand Beach backshore + natural clumped lakeside & coastal groves
        d_lake = np.hypot(xx - (-420.0), yy - (-20.0))
        near_bay = (xx > -360.0) & (xx < 140.0) & (yy > 260.0) & (yy < 560.0) & (zz < 45.0)
        near_lake = (d_lake > 155.0) & (d_lake < 340.0) & (zz < 164.0) & (clump_a > 0.56)
        low_valley = (zz >= 4.0) & (zz <= 115.0) & (slope_deg <= 32.0) & (clump_b > 0.62)
        valid = not_water_or_meadow & not_protected & (slope_deg <= 36.0) & (near_bay | near_lake | low_valley) & (zz >= 4.0) & (zz <= 168.0)
        weight = valid.astype(np.float32)
    elif kind == "tree_ferns":
        # Humid mid-story giant tree ferns in natural organic groves across caldera bowl & shaded valleys (45-310m)
        valid = not_water_or_meadow & not_protected & (zz >= 45.0) & (zz <= 310.0) & (slope_deg <= 46.0) & (clump_b > 0.44)
        weight = valid.astype(np.float32)
    elif kind == "scrub":
        # Thick rainforest understory & sheltered ridge scrub up to 50 deg (matching canopy zone),
        # plus ONLY organic mossy crevice cushions on 50-55 deg shoulders (never polka-dots on sheer basalt walls!)
        understory = (zz >= 4.0) & (zz <= 358.0) & (slope_deg <= 50.0)
        crevice_cushions = (zz >= 12.0) & (zz <= 365.0) & (slope_deg > 50.0) & (slope_deg <= 55.0) & (clump_a > 0.72)
        valid = not_water_or_meadow & not_protected & (understory | crevice_cushions)
        for sp in meta["spires"]:
            if sp["name"] in ("主崖岬", "西尖塔", "东尖塔"):
                valid &= np.hypot(xx - sp["p"][0] * 1000.0, yy - sp["p"][1] * 1000.0) > 22.0
        weight = valid.astype(np.float32)
    else:  # meadow -> humid lakeside sedge/grass shore (Option C: 10-25m around Mirror Lake)
        valid = (m2 == 2) & (zz >= 137.8) & (zz <= 148.0) & (slope_deg <= 32.0)
        weight = valid.astype(np.float32)

    quad_valid = (
        valid[:-1, :-1].astype(np.int8)
        + valid[:-1, 1:].astype(np.int8)
        + valid[1:, :-1].astype(np.int8)
        + valid[1:, 1:].astype(np.int8)
    ) >= 2
    jq, iq = np.nonzero(quad_valid)
    a = jq * nx + iq
    b = a + 1
    d = a + nx + 1
    c = a + nx
    quads = np.stack([a, b, d, c], axis=-1)

    used_v = np.unique(quads.ravel())
    remap = np.full(nx * ny, -1, dtype=np.int32)
    remap[used_v] = np.arange(used_v.size, dtype=np.int32)

    verts_all = np.stack([xx, yy, zz], axis=-1).reshape(-1, 3)
    w_all = weight.ravel()
    compact_v = verts_all[used_v]
    compact_w = w_all[used_v]
    compact_q = remap[quads]

    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(compact_v.shape[0])
    mesh.vertices.foreach_set("co", compact_v.ravel())
    mesh.loops.add(compact_q.shape[0] * 4)
    mesh.loops.foreach_set("vertex_index", compact_q.ravel())
    mesh.polygons.add(compact_q.shape[0])
    mesh.polygons.foreach_set("loop_start", np.arange(0, compact_q.shape[0] * 4, 4, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(compact_q.shape[0], 4, dtype=np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(compact_q.shape[0], dtype=bool))
    mesh.uv_layers.new(name="UVMap")

    attr = mesh.attributes.new(name="Scatter_Weight", type="FLOAT", domain="POINT")
    attr.data.foreach_set("value", compact_w)
    mesh.update()
    return mesh


def attach_scatter(obj, ng, src_col, density, dist_min, max_slope, h_min, h_max, s_min, s_max, align, sink_z, seed):
    mod = obj.modifiers.new(name=f"MOD_{obj.name}", type="NODES")
    mod.node_group = ng
    by_name = {s.name: s.identifier for s in ng.interface.items_tree if getattr(s, "in_out", "") == "INPUT"}
    ins = mod.properties.inputs
    params = {
        "Collection": src_col,
        "Density": float(density),
        "Distance Min": float(dist_min),
        "Max Slope": float(max_slope),
        "Height Min": float(h_min),
        "Height Max": float(h_max),
        "Scale Min": float(s_min),
        "Scale Max": float(s_max),
        "Align": float(align),
        "Sink Z": float(sink_z),
        "Seed": int(seed),
    }
    for k, v in params.items():
        getattr(ins, by_name[k]).value = v
    return mod


def export_ue_foliage_points(scatter_objs):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    target_names = {o.name for o in scatter_objs}
    counts = {}
    instances_out = []

    for inst in depsgraph.object_instances:
        if not inst.is_instance or inst.parent is None:
            continue
        if inst.parent.original.name not in target_names:
            continue
        asset_name = inst.object.original.name
        loc, rot, scl = inst.matrix_world.decompose()
        counts[asset_name] = counts.get(asset_name, 0) + 1
        instances_out.append({
            "asset": asset_name,
            "pos": [round(loc.x, 2), round(loc.y, 2), round(loc.z, 2)],
            "rot_wxyz": [round(rot.w, 4), round(rot.x, 4), round(rot.y, 4), round(rot.z, 4)],
            "scale": [round(scl.x, 3), round(scl.y, 3), round(scl.z, 3)],
        })

    out_path = os.path.join(EXPORT_UE_DIR, "foliage_points.json")
    payload = {
        "version": "3.3",
        "coordinate_system": "Z-up meters (+X East, +Y North, +Z Up); multiply pos by 100 for Unreal Engine cm",
        "counts": counts,
        "total_instances": len(instances_out),
        "instances": instances_out,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    return out_path, counts, len(instances_out)


def render_stage4(col_lc):
    def get_or_set(name, pos, target, lens=32.0):
        obj = bpy.data.objects.get(name)
        if obj is None:
            cam_d = bpy.data.cameras.new(name)
            obj = bpy.data.objects.new(name, cam_d)
            link_only_to(obj, col_lc)
        obj.data.lens = lens
        obj.data.clip_start = 1.0
        obj.data.clip_end = 25000.0
        obj.location = Vector(pos)
        obj.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        return obj

    cams = {
        "overview": get_or_set("CAM_Overview_SE", (2450, -2850, 1520), (-20, -60, 80), lens=28.0),
        "caldera_lake": get_or_set("CAM_Caldera_Lake_Meadow", (-160, 420, 390), (-320, -260, 145), lens=28.0),
        "bay_waterfall": get_or_set("CAM_BlackGravelBay_North", (-210, 740, 82), (-15, 290, 42), lens=32.0),
        "forest_closeup": get_or_set("CAM_Forest_Closeup", (-290, 210, 175), (-450, -30, 142), lens=35.0),
    }

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 16
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"

    files = []
    for tag, cam in cams.items():
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"stage4_{tag}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(fp)
    scene.camera = cams["overview"]
    return files


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])
    mat_ids = np.fromfile(os.path.join(DATA_DIR, "mat.bin"), dtype=np.uint8)

    col_veg = bpy.data.collections.get("04_Vegetation")
    if col_veg is None:
        col_veg = bpy.data.collections.new("04_Vegetation")
        bpy.context.scene.collection.children.link(col_veg)
    clear_collection_recursive(col_veg)

    # Source prototype sub-collections (excluded from ViewLayer)
    sub_names = ["04_VegSrc_Trees", "04_VegSrc_Palms", "04_VegSrc_TreeFerns", "04_VegSrc_Bushes", "04_VegSrc_MeadowGrass"]
    sub_cols = {}
    for sn in sub_names:
        sc = bpy.data.collections.new(sn)
        col_veg.children.link(sc)
        lc = find_layer_collection(bpy.context.view_layer.layer_collection, sc)
        if lc is not None:
            lc.exclude = True
        sub_cols[sn] = sc

    # 1) Build 6 clean tropical vegetation prototypes
    tree1, tree2 = import_and_normalize_tree_prototypes(sub_cols["04_VegSrc_Trees"])
    palm = build_palm_prototype(sub_cols["04_VegSrc_Palms"])
    tree_fern = build_tree_fern_prototype(sub_cols["04_VegSrc_TreeFerns"])
    bush = build_fronded_bush_prototype(sub_cols["04_VegSrc_Bushes"])
    grass = build_meadow_grass_prototype(sub_cols["04_VegSrc_MeadowGrass"])

    # 2) Build shared Geometry Nodes scatter tree & 5 ecological scatter layers
    ng = build_scatter_nodetree("GN_Island_Scatter")

    layers = [
        ("GN_Scatter_CloudForest", "EMIT_Canopy", "canopy", sub_cols["04_VegSrc_Trees"], "M_Tree_Leaves",
         0.028, 6.5, 50.0, 5.0, 360.0, 0.85, 1.48, 0.06, -0.55, 31088),
        ("GN_Scatter_Palms", "EMIT_Palms", "palms", sub_cols["04_VegSrc_Palms"], "M_Palm_Fronds",
         0.0065, 9.8, 36.0, 4.0, 168.0, 0.85, 1.38, 0.08, -0.45, 34011),
        ("GN_Scatter_TreeFerns", "EMIT_TreeFerns", "tree_ferns", sub_cols["04_VegSrc_TreeFerns"], "M_TreeFern_Fronds",
         0.014, 7.6, 46.0, 45.0, 310.0, 0.80, 1.45, 0.14, -0.35, 38055),
        ("GN_Scatter_TropicalScrub", "EMIT_Scrub", "scrub", sub_cols["04_VegSrc_Bushes"], "M_Bush_Tropical",
         0.026, 5.8, 55.0, 4.0, 365.0, 0.85, 1.65, 0.30, -0.45, 41099),
        ("GN_Scatter_LakesideGrass", "EMIT_LakesideGrass", "meadow", sub_cols["04_VegSrc_MeadowGrass"], "M_Grass_Meadow",
         0.42, 1.5, 32.0, 137.8, 148.0, 0.85, 1.55, 0.45, -0.06, 51022),
    ]

    scatter_objs = []
    for ob_name, emit_name, kind, src_col, mat_name, dens, dmin, msl, hmin, hmax, smin, smax, align, sink_z, seed in layers:
        m = build_emitter_mesh(emit_name, meta, hf, mat_ids, kind)
        if bpy.data.materials.get(mat_name):
            m.materials.append(bpy.data.materials[mat_name])
        ob = bpy.data.objects.new(ob_name, m)
        link_only_to(ob, col_veg)
        attach_scatter(ob, ng, src_col, dens, dmin, msl, hmin, hmax, smin, smax, align, sink_z, seed)
        scatter_objs.append(ob)

    bpy.context.view_layer.update()

    # 3) Export UE5 PCG / Foliage point cloud JSON
    pcg_path, counts, total_inst = export_ue_foliage_points(scatter_objs)

    # 4) Save cleanly
    bpy.context.scene.cycles.transparent_max_bounces = 16
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    renders = [] if "--no-render" in sys.argv else render_stage4(bpy.data.collections["05_Lighting_Cameras"])

    report = {
        "ok": True,
        "stage": "4_lush",
        "blend": BLEND_PATH,
        "prototypes": {
            o.name: {"dims_m": [round(v, 2) for v in o.dimensions], "polys": len(o.data.polygons)}
            for o in (tree1, tree2, palm, tree_fern, bush, grass)
        },
        "scatter_counts": counts,
        "total_instances": total_inst,
        "pcg_json": pcg_path,
        "pcg_size_mb": round(os.path.getsize(pcg_path) / (1024.0 * 1024.0), 2),
        "renders": renders,
    }
    print("@@JSON@@" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
