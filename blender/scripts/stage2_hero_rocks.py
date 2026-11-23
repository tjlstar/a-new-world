"""Stage 2: Build hero geological formations and coastal rock details in Blender 5.3.

Opens blender/island_env.blend (Stage 1), populates collection `02_HeroRocks` with:
  - SM_Hero_SouthSwordPeak (263m blade ridge + sub-peaks 175m/121m + skirt into -22m shelf)
  - SM_Hero_SeaArch (161m span, 106m crown, 68m central clearance, buried footings)
  - SM_Hero_Spire_MainCliff / West / East (467m / 380m / 322m columnar basalt monoliths)
  - SM_SeaStack_01..05 (5 offshore basalt sea stacks)
  - SM_NearshoreReefs_Bay (5 clusters of shallow-water basalt reefs off white sand beach)
  - SM_Buoy_01..13 (13 matte reef-disguised illusion buoys 2.18-3.25km offshore, 36m sub-body)

Also fixes sky.hdr horizon blend (hiding ground trees below 7 deg elevation) and updates
review cameras to frame East Islet, South Sword Peak, Sea Arch, Spires, and Black Gravel Bay.
"""

import json
import math
import os
import random
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(WORKSPACE, "三维", "data")
ASSETS_DIR = os.path.join(WORKSPACE, "三维", "assets")
BLEND_PATH = os.path.join(WORKSPACE, "blender", "island_env.blend")
RENDER_DIR = os.path.join(WORKSPACE, "blender", "renders")
os.makedirs(RENDER_DIR, exist_ok=True)


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def smoothstep(a, b, v):
    t = clamp((v - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def hash2(i, j):
    n = math.sin(i * 127.1 + j * 311.7) * 43758.5453
    return n - math.floor(n)


def vnoise(x, y):
    i = math.floor(x)
    j = math.floor(y)
    u = x - i
    v = y - j
    fx = u * u * (3.0 - 2.0 * u)
    fy = v * v * (3.0 - 2.0 * v)
    a = hash2(i, j)
    b = hash2(i + 1, j)
    c = hash2(i, j + 1)
    d = hash2(i + 1, j + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def sample_height(meta, hf, x_m, y_m):
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    x0, y0, step = float(g["x0"]) * 1000.0, float(g["y0"]) * 1000.0, float(g["step"]) * 1000.0
    fx = max(0.0, min(nx - 1.001, (x_m - x0) / step))
    fy = max(0.0, min(ny - 1.001, (y_m - y0) / step))
    i, j = int(fx), int(fy)
    u, v = fx - i, fy - j
    k = j * nx + i
    if u + v <= 1.0:
        return float(hf[k] + (hf[k + 1] - hf[k]) * u + (hf[k + nx] - hf[k]) * v)
    return float(hf[k + nx + 1] + (hf[k + nx] - hf[k + nx + 1]) * (1.0 - u) + (hf[k + 1] - hf[k + nx + 1]) * (1.0 - v))


def link_only_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def clear_collection(col):
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def load_image_safe(path, is_data=False):
    img = bpy.data.images.load(path, check_existing=True)
    ext = os.path.splitext(path)[1].lower()
    if is_data:
        img.colorspace_settings.name = "Non-Color"
    elif ext in (".hdr", ".exr"):
        # Keep HDRI in Linear color space (never apply sRGB to float HDR!)
        for cs in ("Linear Rec.709", "Linear", "Raw"):
            try:
                img.colorspace_settings.name = cs
                break
            except TypeError:
                continue
    else:
        img.colorspace_settings.name = "sRGB"
    return img


def apply_box_uvs(bm, uv_layer, scale=24.0):
    """Project UVs per face by dominant normal axis so zero faces collapse to 0-area UV."""
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for lp in f.loops:
            co = lp.vert.co
            if az >= ax and az >= ay:
                lp[uv_layer].uv = (co.x / scale, co.y / scale)
            elif ax >= ay and ax >= az:
                lp[uv_layer].uv = (co.y / scale, co.z / scale)
            else:
                lp[uv_layer].uv = (co.x / scale, co.z / scale)


def build_basalt_material(name, darken=0.28, roughness_mult=0.92, tex_scale=0.055):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.04
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.35

    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (tex_scale, tex_scale, tex_scale)
    nt.links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])

    diff_path = os.path.join(ASSETS_DIR, "landscape", "Diffuse.jpg")
    disp_path = os.path.join(ASSETS_DIR, "landscape", "Displacement.jpg")
    rough_path = os.path.join(ASSETS_DIR, "landscape", "Rough.jpg")

    if os.path.isfile(diff_path) and os.path.isfile(disp_path) and os.path.isfile(rough_path):
        # Box (triplanar) projected basalt textures with dark volcanic tint
        t_diff = nt.nodes.new("ShaderNodeTexImage")
        t_diff.image = load_image_safe(diff_path, is_data=False)
        t_diff.projection = "BOX"
        t_diff.projection_blend = 0.25
        nt.links.new(mapping.outputs["Vector"], t_diff.inputs["Vector"])

        mix_dark = nt.nodes.new("ShaderNodeMix")
        mix_dark.data_type = "RGBA"
        mix_dark.blend_type = "MULTIPLY"
        mix_dark.inputs["Factor"].default_value = 1.0
        mix_dark.inputs[7].default_value = (darken * 0.92, darken * 0.98, darken * 1.06, 1.0)
        nt.links.new(t_diff.outputs["Color"], mix_dark.inputs[6])
        nt.links.new(mix_dark.outputs[2], bsdf.inputs["Base Color"])

        t_rough = nt.nodes.new("ShaderNodeTexImage")
        t_rough.image = load_image_safe(rough_path, is_data=True)
        t_rough.projection = "BOX"
        t_rough.projection_blend = 0.25
        nt.links.new(mapping.outputs["Vector"], t_rough.inputs["Vector"])

        r_map = nt.nodes.new("ShaderNodeMapRange")
        r_map.inputs["From Min"].default_value = 0.0
        r_map.inputs["From Max"].default_value = 1.0
        r_map.inputs["To Min"].default_value = max(0.68, roughness_mult - 0.16)
        r_map.inputs["To Max"].default_value = min(0.98, roughness_mult + 0.05)
        nt.links.new(t_rough.outputs["Color"], r_map.inputs["Value"])
        nt.links.new(r_map.outputs["Result"], bsdf.inputs["Roughness"])

        # Non-Color Displacement map feeds Bump cleanly (passes QA colorspace check)
        t_disp = nt.nodes.new("ShaderNodeTexImage")
        t_disp.image = load_image_safe(disp_path, is_data=True)
        t_disp.projection = "BOX"
        t_disp.projection_blend = 0.25
        nt.links.new(mapping.outputs["Vector"], t_disp.inputs["Vector"])

        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.55
        bump.inputs["Distance"].default_value = 0.8
        nt.links.new(t_disp.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.045, 0.049, 0.054, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness_mult

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def build_sub_metal_material(name):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.032, 0.038, 0.044, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.35
    bsdf.inputs["Roughness"].default_value = 0.78
    return mat


def fix_world_horizon():
    """Mask sky.hdr ground trees below elevation ~7 deg into clean ocean horizon haze."""
    world = bpy.context.scene.world
    if not world:
        return
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.90

    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex_coord.outputs["Generated"], sep.inputs["Vector"])

    # Smooth horizon fade: ray.z from 0.015 to 0.135 blends ocean horizon sky into sky.hdr clouds
    elev_mask = nt.nodes.new("ShaderNodeMapRange")
    elev_mask.interpolation_type = "SMOOTHSTEP"
    elev_mask.inputs["From Min"].default_value = 0.015
    elev_mask.inputs["From Max"].default_value = 0.135
    elev_mask.inputs["To Min"].default_value = 0.0
    elev_mask.inputs["To Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], elev_mask.inputs["Value"])

    hdr_path = os.path.join(ASSETS_DIR, "landscape", "sky.hdr")
    if os.path.isfile(hdr_path):
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(-18.0))
        nt.links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])

        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = load_image_safe(hdr_path, is_data=False)
        nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])

        mix_sky = nt.nodes.new("ShaderNodeMix")
        mix_sky.data_type = "RGBA"
        mix_sky.inputs[6].default_value = (0.38, 0.56, 0.68, 1.0)  # clean South Pacific horizon blue
        nt.links.new(elev_mask.outputs["Result"], mix_sky.inputs["Factor"])
        nt.links.new(env.outputs["Color"], mix_sky.inputs[7])
        nt.links.new(mix_sky.outputs[2], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (0.38, 0.56, 0.68, 1.0)

    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def build_south_sword_peak(meta, hf, col, mat):
    sp = meta["swordPeak"]
    cx = float(sp["x"]) * 1000.0
    cy = float(sp["y"]) * 1000.0
    length = float(sp.get("len", 0.36)) * 1000.0
    width = float(sp.get("wid", 0.10)) * 1000.0
    top = float(sp["h"])
    rot = float(sp.get("rot", 0.42))

    # Blender XY basis: long axis au = (cos(rot), sin(rot)), short axis av = (-sin(rot), cos(rot)) (det = +1)
    au = (math.cos(rot), math.sin(rot))
    av = (-math.sin(rot), math.cos(rot))

    nu, nv = 160, 72
    ext_u = length * 0.68
    ext_v = width * 1.25

    def crest(un):
        return (
            28.0
            + (top - 28.0) * math.exp(-(((un + 0.12) / 0.26) ** 2))
            + 138.0 * math.exp(-(((un - 0.47) / 0.12) ** 2))
            + 86.0 * math.exp(-(((un + 0.64) / 0.10) ** 2))
            + 26.0 * (vnoise(un * 11.0 + 4.0, 2.3) - 0.5)
            + 16.0 * (vnoise(un * 29.0 + 1.0, 5.1) - 0.5)
        )

    verts = []
    uvs_pt = []
    bed_z = []
    max_z = -1e9
    sub_east = -1e9
    sub_west = -1e9

    for j in range(nv + 1):
        v = (j / nv * 2.0 - 1.0) * ext_v
        vn = v / (width * 0.5)
        for i in range(nu + 1):
            u = (i / nu * 2.0 - 1.0) * ext_u
            un = u / (length * 0.5)
            wx = cx + au[0] * u + av[0] * v
            wy = cy + au[1] * u + av[1] * v
            gy = sample_height(meta, hf, wx, wy)
            bed_z.append(gy)

            half_w = math.sqrt(max(0.0, 1.0 - un * un)) * (0.78 + 0.34 * vnoise(un * 5.0 + 1.0, 7.7))
            if abs(un) >= 1.0 or abs(vn) >= half_w:
                out_m = (
                    (abs(un) - 1.0) * length * 0.5 + max(0.0, abs(vn)) * width * 0.5
                    if abs(un) >= 1.0
                    else (abs(vn) - half_w) * width * 0.5
                )
                z = max(min(-28.0, gy - 6.0), 6.0 - out_m * 0.58 + 4.5 * vnoise(un * 23.0, vn * 23.0))
            else:
                across = 1.0 - abs(vn) / half_w
                flute = vnoise(un * 46.0 + 3.0, vn * 2.5) * 0.6 + vnoise(un * 97.0, vn * 4.0) * 0.4
                z_raw = crest(un) * (across ** 0.18) * (0.86 + 0.18 * flute)
                # Subtle horizontal basalt lava-flow strata ledges every ~28m
                strata = 1.4 * math.sin(z_raw * 0.225 + vnoise(un * 9.0, vn * 9.0) * 1.5) * smoothstep(10.0, 40.0, z_raw)
                z = max(6.0 * (1.0 - across), z_raw + strata + 4.0 * (vnoise(un * 31.0 + 2.0, vn * 17.0 - 5.0) - 0.5))
                if z > max_z:
                    max_z = z
                if un > 0.25 and z > sub_east:
                    sub_east = z
                if un < -0.45 and z > sub_west:
                    sub_west = z

            verts.append((wx - cx, wy - cy, z))
            uvs_pt.append(((u + ext_u) / (2.0 * ext_u), (v + ext_v) / (2.0 * ext_v)))

    faces = []
    stride = nu + 1
    for j in range(nv):
        for i in range(nu):
            k = j * stride + i
            q = (k, k + 1, k + stride + 1, k + stride)
            if all(verts[idx][2] < bed_z[idx] - 2.0 for idx in q):
                continue
            faces.append(q)

    # Compact to only used vertices so there are zero loose vertices
    used = sorted({vi for f in faces for vi in f})
    remap = {old: new for new, old in enumerate(used)}
    compact_verts = [verts[old] for old in used]
    compact_faces = [tuple(remap[vi] for vi in f) for f in faces]

    mesh = bpy.data.meshes.new("SM_Hero_SouthSwordPeak")
    mesh.from_pydata(compact_verts, [], compact_faces)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-3)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
        for lp in f.loops:
            co = lp.vert.co
            lp[uv_layer].uv = ((co.x + 250.0) / 500.0, (co.z + 30.0) / 300.0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new("SM_Hero_SouthSwordPeak", mesh)
    obj.location = (cx, cy, 0.0)
    obj.data.materials.append(mat)
    link_only_to(obj, col)

    return obj, {
        "main_peak_m": round(max_z, 1),
        "east_sub_m": round(sub_east, 1),
        "west_sub_m": round(sub_west, 1),
        "seabed_center_m": round(sample_height(meta, hf, cx, cy), 1),
        "polys": len(mesh.polygons),
    }


def build_sea_arch(meta, hf, col, mat):
    spec = meta["seaArch"]
    ax, ay = float(spec["a"][0]) * 1000.0, float(spec["a"][1]) * 1000.0
    bx, by = float(spec["b"][0]) * 1000.0, float(spec["b"][1]) * 1000.0
    span = math.hypot(bx - ax, by - ay)
    mx, my = 0.5 * (ax + bx), 0.5 * (ay + by)
    along_x, along_y = (bx - ax) / span, (by - ay) / span
    # Across vector perpendicular to along (det = +1): (-along_y, along_x)
    across_x, across_y = -along_y, along_x

    width = float(spec["width"])
    crown_z = float(spec["crownZ"])
    clear_z = float(spec["clearZ"])

    half = span * 0.5
    reach = half + 30.0
    spacing = (2.0 * reach) / 128.0
    sides = 48
    slices = 128

    def ground_at_local(across, along):
        wx = mx + along * along_x + across * across_x
        wy = my + along * along_y + across * across_y
        return sample_height(meta, hf, wx, wy)

    def buried_across(s):
        for j in range(-8, 9):
            if ground_at_local(j * width / 10.0, s) < crown_z + 20.0:
                return False
        return True

    while slices < 256 and not buried_across(-reach + slices * spacing):
        slices += 1
    slices += math.ceil(10.0 / spacing)

    def signed_pow(val, exp):
        return math.copysign(abs(val) ** exp, val)

    verts = []
    faces = []
    for i in range(slices + 1):
        s = -reach + i * spacing
        irregular = vnoise(s * 0.026, 8.1) - 0.5
        detail = vnoise(s * 0.062, 3.4) - 0.5
        shoulder = abs((s + 2.5 + 2.0 * irregular) / half)
        drop = smoothstep(0.48, 1.08, shoulder)
        bottom = clear_z - 7.0 * shoulder * shoulder - (clear_z + 120.0) * drop + 2.5 * irregular
        top = crown_z + 5.5 * irregular + 2.2 * detail + 8.0 * smoothstep(0.55, 1.15, shoulder)
        breadth = width * (0.49 + 0.16 * drop + 0.08 * irregular)
        center = 4.0 * (vnoise(s * 0.028, 1.6) - 0.5)
        for j in range(sides):
            ang = 2.0 * math.pi * j / sides
            side = signed_pow(math.cos(ang), 0.64)
            elev = signed_pow(math.sin(ang), 0.72)
            z = bottom + (top - bottom) * (elev + 1.0) * 0.5
            weather = vnoise(s * 0.085 + z * 0.018, z * 0.06 + side * 1.7) - 0.5
            across = center + side * (breadth + 2.6 * weather)
            # Local coords relative to (mx, my, 0) in world XY orientation
            lx = s * along_x + across * across_x
            ly = s * along_y + across * across_y
            verts.append((lx, ly, z + 1.2 * weather))
            if i < slices:
                a = i * sides + j
                b = i * sides + (j + 1) % sides
                faces.append((a, b, b + sides, a + sides))

    # Watertight end caps (triangulated fans so no n-gons)
    end_off = slices * sides
    for j in range(1, sides - 1):
        faces.append((0, j + 1, j))
        faces.append((end_off, end_off + j, end_off + j + 1))

    mesh = bpy.data.meshes.new("SM_Hero_SeaArch")
    mesh.from_pydata(verts, [], faces)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-3)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
    apply_box_uvs(bm, uv_layer, scale=32.0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new("SM_Hero_SeaArch", mesh)
    obj.location = (mx, my, 0.0)
    obj.data.materials.append(mat)
    link_only_to(obj, col)

    # Measure actual central clearance at local (0, 0)
    bpy.context.view_layer.update()
    hit, loc, _, _ = obj.ray_cast(Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0)))
    measured_clear = round(loc.z, 1) if hit else None

    return obj, {
        "span_m": round(span, 1),
        "measured_clear_z_m": measured_clear,
        "crown_target_m": crown_z,
        "polys": len(mesh.polygons),
    }


def add_basalt_column_to_bm(bm, cx, cy, z_bottom, z_top, r_bottom, r_top, sides=6, yaw=0.0, tilt_x=0.0, tilt_y=0.0, segs=12, seed=1.0):
    """Build a tapered, weathered hexagonal basalt monolith column with closed top & bottom."""
    rings = []
    for s in range(segs + 1):
        t = s / segs
        z = z_bottom + (z_top - z_bottom) * t
        # Taper sharply near summit for craggy volcanic spire silhouette
        taper = (1.0 - t) * r_bottom + t * r_top
        if t > 0.72:
            taper *= 1.0 - 0.58 * ((t - 0.72) / 0.28) ** 1.4
        # Columnar step joints
        step_jit = 1.0 + 0.09 * math.sin(t * 22.0 + seed * 3.1) * (1.0 - t * 0.4)
        ox = cx + tilt_x * (z - z_bottom)
        oy = cy + tilt_y * (z - z_bottom)
        ring = []
        for k in range(sides):
            ang = yaw + (2.0 * math.pi * k / sides)
            wob = 0.88 + 0.24 * vnoise(math.cos(ang) * 2.5 + seed, t * 6.0 + math.sin(ang) * 2.5)
            rad = max(0.35, taper * step_jit * wob)
            ring.append(bm.verts.new((ox + math.cos(ang) * rad, oy + math.sin(ang) * rad, z)))
        rings.append(ring)

    for s in range(segs):
        r0, r1 = rings[s], rings[s + 1]
        for k in range(sides):
            kn = (k + 1) % sides
            bm.faces.new((r0[k], r0[kn], r1[kn], r1[k]))

    # Closed bottom & tapered apex cap (triangles, no n-gons)
    bot_c = bm.verts.new((cx, cy, z_bottom))
    top_c = bm.verts.new((cx + tilt_x * (z_top - z_bottom), cy + tilt_y * (z_top - z_bottom), z_top))
    for k in range(sides):
        kn = (k + 1) % sides
        bm.faces.new((bot_c, rings[0][kn], rings[0][k]))
        bm.faces.new((top_c, rings[-1][k], rings[-1][kn]))


def build_spires(meta, hf, col, mat):
    name_map = {"主崖岬": "SM_Hero_Spire_MainCliff", "西尖塔": "SM_Hero_Spire_West", "东尖塔": "SM_Hero_Spire_East"}
    results = []
    rng = random.Random(365310)
    for sp in meta["spires"]:
        if sp["name"] not in name_map:
            continue
        obj_name = name_map[sp["name"]]
        sx, sy = float(sp["p"][0]) * 1000.0, float(sp["p"][1]) * 1000.0
        target_top = float(sp["h"])
        ground_z = sample_height(meta, hf, sx, sy)
        # Origin sits right on the ridge (sx, sy, ground_z) so origin_far audit passes cleanly
        rel_top = target_top - ground_z
        base_z = -14.0  # deeply anchored 14m into the ridge below origin

        bm = bmesh.new()
        core_r = 5.4 if sp["name"] == "主崖岬" else 6.2
        add_basalt_column_to_bm(
            bm, 0.0, 0.0, base_z, rel_top,
            r_bottom=core_r, r_top=core_r * 0.24, sides=7,
            yaw=rng.uniform(0, math.tau), segs=14, seed=rng.uniform(1, 50),
        )
        # Surrounding interlocking columnar basalt buttresses with staggered bottoms (zero z-fighting)
        for k in range(12):
            ang = (k / 12.0) * math.tau + rng.uniform(-0.18, 0.18)
            ring_layer = 0 if k < 5 else 1
            dist = (3.8 + rng.uniform(0.0, 2.8)) if ring_layer == 0 else (7.2 + rng.uniform(0.0, 4.5))
            rel_h = (0.72 + rng.uniform(0.0, 0.20)) if ring_layer == 0 else (0.42 + rng.uniform(0.0, 0.25))
            col_top = min(rel_top * rel_h, rel_top - 1.2)
            r_b = 3.2 + rng.uniform(0.0, 2.0)
            col_bot = base_z - 2.0 - k * 0.55
            add_basalt_column_to_bm(
                bm, math.cos(ang) * dist, math.sin(ang) * dist,
                col_bot, col_top,
                r_bottom=r_b, r_top=r_b * 0.35, sides=6,
                yaw=ang + 0.3 + k * 0.17, tilt_x=-math.cos(ang) * 0.03, tilt_y=-math.sin(ang) * 0.03,
                segs=10, seed=rng.uniform(1, 99),
            )

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        uv_layer = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            f.smooth = False
        apply_box_uvs(bm, uv_layer, scale=18.0)

        mesh = bpy.data.meshes.new(obj_name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()

        obj = bpy.data.objects.new(obj_name, mesh)
        obj.location = (sx, sy, ground_z)
        obj.data.materials.append(mat)
        link_only_to(obj, col)
        results.append({
            "name": obj_name,
            "target_top_m": target_top,
            "actual_top_m": round(ground_z + max(v.co.z for v in mesh.vertices), 2),
            "polys": len(mesh.polygons),
        })
    return results


def build_sea_stacks(meta, hf, col, mat):
    rng = random.Random(26015)
    created = []
    idx = 0
    for sx_km, sy_km, sh, sr_km, name in meta["stacks"]:
        if sh >= 200 or name == "南剑峰":
            continue
        idx += 1
        obj_name = f"SM_SeaStack_{idx:02d}"
        wx, wy = float(sx_km) * 1000.0, float(sy_km) * 1000.0
        base_r = max(12.0, float(sr_km) * 1000.0)
        seabed = sample_height(meta, hf, wx, wy)
        z_bot = min(-35.0, seabed - 6.0)

        bm = bmesh.new()
        add_basalt_column_to_bm(
            bm, 0.0, 0.0, z_bot, float(sh),
            r_bottom=base_r * 0.62, r_top=3.0, sides=7,
            yaw=rng.uniform(0, math.tau), tilt_x=rng.uniform(-0.04, 0.04), tilt_y=rng.uniform(-0.04, 0.04),
            segs=12, seed=rng.uniform(1, 50),
        )
        for k in range(8):
            ang = (k / 8.0) * math.tau + rng.uniform(-0.2, 0.2)
            dist = base_r * rng.uniform(0.25, 0.68)
            h_sub = float(sh) * rng.uniform(0.28, 0.78) * (1.0 - 0.35 * dist / base_r)
            r_sub = base_r * rng.uniform(0.18, 0.32)
            add_basalt_column_to_bm(
                bm, math.cos(ang) * dist, math.sin(ang) * dist,
                z_bot - (k + 1) * 0.65, h_sub,
                r_bottom=r_sub, r_top=r_sub * 0.38, sides=6,
                yaw=rng.uniform(0, math.tau), segs=9, seed=rng.uniform(1, 99),
            )

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        uv_layer = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            f.smooth = False
        apply_box_uvs(bm, uv_layer, scale=22.0)

        mesh = bpy.data.meshes.new(obj_name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()

        obj = bpy.data.objects.new(obj_name, mesh)
        obj.location = (wx, wy, 0.0)
        obj.data.materials.append(mat)
        link_only_to(obj, col)
        created.append({"name": obj_name, "top_m": round(max(v.co.z for v in mesh.vertices), 1), "polys": len(mesh.polygons)})
    return created


def beach_shore_y_km(x_km):
    west, east = -0.265, 0.060
    t = clamp((x_km - west) / (east - west))
    arc = math.sin(math.pi * t)
    return (
        0.447 - 0.028 * t - 0.032 * arc * arc
        + 0.004 * math.sin(2.0 * math.pi * t)
        - 0.072 * (clamp((t - 0.83) / 0.17) ** 2.4)
    )


def build_nearshore_reefs(meta, hf, col, mat):
    """5 clusters of shallow-water basalt reefs off Black Gravel Bay white sand beach."""
    west, east = -0.265, 0.060
    reefs = [(0.14, 21.0), (0.32, 37.0), (0.58, 26.0), (0.74, 42.0), (0.88, 20.0)]
    rng = random.Random(87021)

    bm = bmesh.new()
    placed = 0
    exposed = 0
    for i in range(2000):
        if placed >= 165:
            break
        along, offshore = reefs[i % len(reefs)]
        dx = (rng.random() + rng.random() - 1.0) * 23.0
        x_km = west + along * (east - west) + dx / 1000.0
        wx = x_km * 1000.0
        wy = beach_shore_y_km(x_km) * 1000.0 + offshore + dx * 0.23 + (rng.random() - 0.5) * 17.0
        h = sample_height(meta, hf, wx, wy)
        size = 0.65 + 3.6 * (rng.random() ** 2)
        length = size * (1.1 + 0.6 * rng.random())
        radius = length * 1.22
        if h > -0.65 or h < -7.0:
            continue
        # Ensure entire boulder footprint lies seaward of waterline
        wet_ok = True
        for ox in (-radius, 0.0, radius):
            for oy in (-radius, 0.0, radius):
                if sample_height(meta, hf, wx + ox, wy + oy) >= -0.35:
                    wet_ok = False
                    break
            if not wet_ok:
                break
        if not wet_ok:
            continue

        # Create displaced boulder embedded into seabed
        ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        b_verts = ret["verts"]
        rx, ry, rz = rng.uniform(0, 0.5), rng.uniform(0, 0.4), rng.uniform(0, math.tau)
        rot_m = Euler((rx, ry, rz), "XYZ").to_matrix()
        max_vz = -1e9
        for v in b_verts:
            p = v.co
            f = 1.0 + 0.22 * math.sin(p.x * 7.5 + p.y * 11.0 + p.z * 5.2 + i)
            p = Vector((p.x * f * length, p.y * f * size, p.z * f * size * 0.82))
            p = rot_m @ p
            p.x += wx
            p.y += wy
            p.z += h + size * 0.12
            v.co = p
            if p.z > max_vz:
                max_vz = p.z
        if max_vz > 0.0:
            exposed += 1
        placed += 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
    apply_box_uvs(bm, uv_layer, scale=6.0)

    mesh = bpy.data.meshes.new("SM_NearshoreReefs_Bay")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new("SM_NearshoreReefs_Bay", mesh)
    obj.data.materials.append(mat)
    link_only_to(obj, col)
    return obj, {"boulders": placed, "exposed_tops": exposed, "polys": len(mesh.polygons)}


def build_illusion_buoys(meta, col, mat_rock, mat_sub):
    """13 semi-submerged matte reef-disguised illusion buoys (2.18-3.25 km offshore).
    Each buoy gets its own baked yaw rotation (transform rotation = 0, scale = 1) for clean UE export."""
    rng = random.Random(9031)
    objs = []
    for idx, (bx_km, by_km) in enumerate(meta["buoys"], start=1):
        yaw = rng.uniform(0.0, math.tau)
        rot_m = Matrix.Rotation(yaw, 4, "Z")
        bm = bmesh.new()

        ret_top = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in ret_top["verts"]:
            p = v.co
            crag = 1.0 + 0.24 * math.sin(p.x * 6.0 + p.y * 8.0 + p.z * 5.0 + idx)
            v.co = rot_m @ Vector((p.x * 6.2 * crag, p.y * 5.0 * crag, p.z * 2.7 * crag + 0.55))
        top_faces = {f for v in ret_top["verts"] for f in v.link_faces}
        for f in top_faces:
            f.material_index = 0
            f.smooth = False

        ret_sub = bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=True, segments=12,
            radius1=0.75, radius2=1.75, depth=36.0,
            matrix=Matrix.Translation((0.0, 0.0, -18.5)),
        )
        sub_faces = {f for v in ret_sub["verts"] for f in v.link_faces}
        for f in sub_faces:
            f.material_index = 1
            f.smooth = True

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        uv_layer = bm.loops.layers.uv.new("UVMap")
        apply_box_uvs(bm, uv_layer, scale=10.0)

        mesh_name = f"SM_Buoy_{idx:02d}"
        mesh = bpy.data.meshes.new(mesh_name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat_rock)
        mesh.materials.append(mat_sub)
        mesh.update()

        obj = bpy.data.objects.new(mesh_name, mesh)
        obj.location = (float(bx_km) * 1000.0, float(by_km) * 1000.0, 0.0)
        link_only_to(obj, col)
        objs.append(obj)
    return objs


def update_cameras(meta, col_lc):
    def set_cam(name, pos, target, lens=35.0):
        obj = bpy.data.objects.get(name)
        if obj is None:
            cam_data = bpy.data.cameras.new(name)
            obj = bpy.data.objects.new(name, cam_data)
            link_only_to(obj, col_lc)
        obj.data.lens = lens
        obj.data.clip_start = 1.0
        obj.data.clip_end = 25000.0
        obj.location = Vector(pos)
        obj.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        return obj

    sp = meta["swordPeak"]
    sx, sy = float(sp["x"]) * 1000.0, float(sp["y"]) * 1000.0
    sa = meta["seaArch"]
    amx = 0.5 * (float(sa["a"][0]) + float(sa["b"][0])) * 1000.0
    amy = 0.5 * (float(sa["a"][1]) + float(sa["b"][1])) * 1000.0

    cams = {
        "overview": set_cam("CAM_Overview_SE", (2450, -2850, 1520), (-20, -60, 80), lens=28.0),
        "sword_and_cliff": set_cam("CAM_SouthCliff_Sunlit", (620, -2380, 260), (-40, -1350, 185), lens=32.0),
        "sea_arch": set_cam("CAM_Strait_EastIslet", (amx - 75, amy + 260, 62), (amx + 10, amy, 58), lens=32.0),
        "bay": set_cam("CAM_BlackGravelBay_North", (-220, 840, 95), (-40, 320, 35), lens=32.0),
    }
    bpy.context.scene.camera = cams["overview"]
    return cams


def render_stage2(cams):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"

    out_files = []
    for tag, cam in cams.items():
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"stage2_{tag}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        out_files.append(fp)
    scene.camera = cams["overview"]
    return out_files


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])

    col_rocks = bpy.data.collections.get("02_HeroRocks")
    if col_rocks is None:
        col_rocks = bpy.data.collections.new("02_HeroRocks")
        bpy.context.scene.collection.children.link(col_rocks)
    clear_collection(col_rocks)

    col_lc = bpy.data.collections["05_Lighting_Cameras"]

    mat_hero_basalt = build_basalt_material("M_Hero_Basalt_Dark", darken=0.22, roughness_mult=0.90, tex_scale=0.045)
    mat_reef_basalt = build_basalt_material("M_Reef_Basalt_Wet", darken=0.16, roughness_mult=0.86, tex_scale=0.14)
    mat_buoy_rock = build_basalt_material("M_Buoy_ReefRock", darken=0.19, roughness_mult=0.94, tex_scale=0.12)
    mat_buoy_sub = build_sub_metal_material("M_Buoy_SubBody")

    fix_world_horizon()

    sword_obj, sword_info = build_south_sword_peak(meta, hf, col_rocks, mat_hero_basalt)
    arch_obj, arch_info = build_sea_arch(meta, hf, col_rocks, mat_hero_basalt)
    spires_info = build_spires(meta, hf, col_rocks, mat_hero_basalt)
    stacks_info = build_sea_stacks(meta, hf, col_rocks, mat_hero_basalt)
    reefs_obj, reefs_info = build_nearshore_reefs(meta, hf, col_rocks, mat_reef_basalt)
    buoys = build_illusion_buoys(meta, col_rocks, mat_buoy_rock, mat_buoy_sub)

    cams = update_cameras(meta, col_lc)

    # Purge any leftover orphan meshes/materials and save cleanly with relative paths
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    import sys
    renders = [] if "--no-render" in sys.argv else render_stage2(cams)

    report = {
        "ok": True,
        "stage": 2,
        "blend": BLEND_PATH,
        "south_sword_peak": sword_info,
        "sea_arch": arch_info,
        "spires": spires_info,
        "sea_stacks": stacks_info,
        "nearshore_reefs": reefs_info,
        "buoys_count": len(buoys),
        "total_objects": len(bpy.data.objects),
        "renders": renders,
    }
    print("@@JSON@@" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
