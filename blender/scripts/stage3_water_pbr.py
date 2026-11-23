"""Stage 3: Unified PBR terrain & basalt materials + complete water system in Blender 5.3.

Opens blender/island_env.blend (Stage 2) and upgrades:
  1. SM_Island_Terrain:
     - Adds smooth continuous beach sand mask (matching beach.js), wet shore mask,
       and smoothed forest/meadow biome masks to eliminate 7m grid stair-stepping.
     - Assigns M_Island_Terrain_PBR using local CC0 textures (basalt cliffs, cloud forest,
       wind meadow, dark gravel, dry/wet white sand beach).
  2. 02_HeroRocks:
     - Unifies M_Hero_Basalt_Dark, M_Reef_Basalt_Wet, M_Buoy_ReefRock to a cool dark
       charcoal-basalt palette matching the main island cliffs.
  3. 03_Water:
     - SM_Water_Ocean: graded mesh with per-vertex Water_Depth attribute for clear turquoise
       coastal shallows fading into deep South Pacific navy-teal + multi-scale wave bump.
     - SM_Water_MirrorLake: calm jade crater lake (+138m) with fine ripple bump.
     - SM_Water_WhitewaterRiver: 329m channel from lake overflow (+138m) to lip (+129m).
     - SM_Water_CurtainFalls: 5 parabolic free-fall water strands plunging 129m into bay.
     - SM_Water_Foam: plunge-pool splash foam + Black Gravel Bay shoreline surf strip.
"""

import json
import math
import os
import numpy as np
import bpy
import bmesh
from mathutils import Vector

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


def np_smoothstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def load_image_safe(path, is_data=False):
    img = bpy.data.images.load(path, check_existing=True)
    ext = os.path.splitext(path)[1].lower()
    if is_data:
        img.colorspace_settings.name = "Non-Color"
    elif ext in (".hdr", ".exr"):
        for cs in ("Linear Rec.709", "Linear", "Raw"):
            try:
                img.colorspace_settings.name = cs
                break
            except TypeError:
                continue
    else:
        img.colorspace_settings.name = "sRGB"
    return img


def link_only_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def clear_collection(col):
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)


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


def beach_shore_np(x_km):
    west, east = -0.265, 0.060
    t = np.clip((x_km - west) / (east - west), 0.0, 1.0)
    arc = np.sin(np.pi * t)
    return (
        0.447 - 0.028 * t - 0.032 * arc * arc
        + 0.004 * np.sin(2.0 * np.pi * t)
        - 0.072 * (np.clip((t - 0.83) / 0.17, 0.0, 1.0) ** 2.4)
    )


def beach_shore_scalar(x_km):
    west, east = -0.265, 0.060
    t = clamp((x_km - west) / (east - west))
    arc = math.sin(math.pi * t)
    return (
        0.447 - 0.028 * t - 0.032 * arc * arc
        + 0.004 * math.sin(2.0 * math.pi * t)
        - 0.072 * (clamp((t - 0.83) / 0.17) ** 2.4)
    )


def blur_2d(arr, passes=2):
    out = arr.astype(np.float32).copy()
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (
            p[1:-1, 1:-1] * 4.0
            + (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) * 2.0
            + (p[:-2, :-2] + p[:-2, 2:] + p[2:, :-2] + p[2:, 2:])
        ) / 16.0
    return out


def update_terrain_smooth_attributes(terrain_obj, meta, hf, mat_ids):
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    x0, y0, step = float(g["x0"]), float(g["y0"]), float(g["step"])
    xs = x0 + np.arange(nx, dtype=np.float32) * step
    ys = y0 + np.arange(ny, dtype=np.float32) * step
    xx, yy = np.meshgrid(xs, ys)
    zz = hf.reshape(ny, nx).astype(np.float32)
    m2 = mat_ids.reshape(ny, nx)

    # Continuous white sand mask matching beach.js + terrain height fade
    west, east = -0.265, 0.060
    t = np.clip((xx - west) / (east - west), 0.0, 1.0)
    arc = np.sin(np.pi * t)
    inland = (beach_shore_np(xx) - yy) * 1000.0
    width = np.sqrt(np.maximum(0.0, arc)) * (45.0 + 6.0 * np.sin(t * np.pi * 2.0 + 0.8))
    in_x = ((xx > west) & (xx < east)).astype(np.float32)
    sand_raw = (
        in_x
        * np_smoothstep(0.035, 0.40, arc)
        * np_smoothstep(-23.0, -5.0, inland)
        * (1.0 - np_smoothstep(width - 5.0, width + 14.0, inland))
        * np_smoothstep(16.0, 6.0, zz)
    )
    sand_smooth = np.clip(sand_raw, 0.0, 1.0).astype(np.float32)

    # Smooth forest & meadow masks so 7m grid edges don't look stair-stepped
    forest_smooth = blur_2d((m2 == 1).astype(np.float32), passes=2) * (1.0 - sand_smooth)
    meadow_smooth = blur_2d((m2 == 2).astype(np.float32), passes=2)
    reef_smooth = blur_2d((m2 == 6).astype(np.float32), passes=1)
    seabed_smooth = np_smoothstep(0.5, -1.5, zz)

    mesh = terrain_obj.data
    for attr_name, data in [
        ("Mask_WhiteSand_Smooth", sand_smooth.ravel()),
        ("Mask_Forest_Smooth", forest_smooth.ravel()),
        ("Mask_Meadow_Smooth", meadow_smooth.ravel()),
        ("Mask_Reef_Smooth", reef_smooth.ravel()),
        ("Mask_Seabed_Smooth", seabed_smooth.ravel()),
    ]:
        existing = mesh.attributes.get(attr_name)
        if existing is not None:
            mesh.attributes.remove(existing)
        attr = mesh.attributes.new(name=attr_name, type="FLOAT", domain="POINT")
        attr.data.foreach_set("value", data.astype(np.float32))
    mesh.update()


def build_cool_basalt_material(name, value_mult=0.22, rough_min=0.72, rough_max=0.95, tex_scale=0.042, wet_zone_z=10.0):
    """Unified cool dark charcoal-blue Pacific volcanic basalt PBR material (Metallic=0)."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.45

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Position"], sep_pos.inputs["Vector"])

    # World-space triplanar mapping so terrain cliffs & hero rocks match seamlessly
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (tex_scale, tex_scale, tex_scale)
    nt.links.new(geom.outputs["Position"], mapping.inputs["Vector"])

    diff_path = os.path.join(ASSETS_DIR, "landscape", "Diffuse.jpg")
    rough_path = os.path.join(ASSETS_DIR, "landscape", "Rough.jpg")
    disp_path = os.path.join(ASSETS_DIR, "landscape", "Displacement.jpg")

    t_diff = nt.nodes.new("ShaderNodeTexImage")
    t_diff.image = load_image_safe(diff_path, is_data=False)
    t_diff.projection = "BOX"
    t_diff.projection_blend = 0.28
    nt.links.new(mapping.outputs["Vector"], t_diff.inputs["Vector"])

    # Desaturate warm brown rock texture into cool dark volcanic basalt
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 0.22
    hsv.inputs["Value"].default_value = value_mult
    nt.links.new(t_diff.outputs["Color"], hsv.inputs["Color"])

    # Cool basalt tint + subtle macro rock variation
    macro_noise = nt.nodes.new("ShaderNodeTexNoise")
    macro_noise.inputs["Scale"].default_value = 0.012
    macro_noise.inputs["Detail"].default_value = 4.0
    nt.links.new(geom.outputs["Position"], macro_noise.inputs["Vector"])

    tint_mix = nt.nodes.new("ShaderNodeMix")
    tint_mix.data_type = "RGBA"
    tint_mix.blend_type = "MULTIPLY"
    tint_mix.inputs["Factor"].default_value = 1.0
    tint_mix.inputs[7].default_value = (0.78, 0.88, 1.02, 1.0)
    nt.links.new(hsv.outputs["Color"], tint_mix.inputs[6])

    macro_ramp = nt.nodes.new("ShaderNodeMapRange")
    macro_ramp.inputs["From Min"].default_value = 0.25
    macro_ramp.inputs["From Max"].default_value = 0.75
    macro_ramp.inputs["To Min"].default_value = 0.72
    macro_ramp.inputs["To Max"].default_value = 1.25
    nt.links.new(macro_noise.outputs["Fac"], macro_ramp.inputs["Value"])

    macro_mul = nt.nodes.new("ShaderNodeMix")
    macro_mul.data_type = "RGBA"
    macro_mul.blend_type = "MULTIPLY"
    macro_mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tint_mix.outputs[2], macro_mul.inputs[6])
    nt.links.new(macro_ramp.outputs["Result"], macro_mul.inputs[7])

    # Wet dark splash zone near sea level (Z < wet_zone_z)
    wet_mask = nt.nodes.new("ShaderNodeMapRange")
    wet_mask.interpolation_type = "SMOOTHSTEP"
    wet_mask.inputs["From Min"].default_value = wet_zone_z
    wet_mask.inputs["From Max"].default_value = 1.0
    wet_mask.inputs["To Min"].default_value = 0.0
    wet_mask.inputs["To Max"].default_value = 1.0
    nt.links.new(sep_pos.outputs["Z"], wet_mask.inputs["Value"])

    wet_darken = nt.nodes.new("ShaderNodeMix")
    wet_darken.data_type = "RGBA"
    wet_darken.blend_type = "MULTIPLY"
    wet_darken.inputs[7].default_value = (0.50, 0.54, 0.58, 1.0)
    nt.links.new(wet_mask.outputs["Result"], wet_darken.inputs["Factor"])
    nt.links.new(macro_mul.outputs[2], wet_darken.inputs[6])
    nt.links.new(wet_darken.outputs[2], bsdf.inputs["Base Color"])

    # Roughness (Non-Color) reduced slightly in wet splash zone
    t_rough = nt.nodes.new("ShaderNodeTexImage")
    t_rough.image = load_image_safe(rough_path, is_data=True)
    t_rough.projection = "BOX"
    t_rough.projection_blend = 0.28
    nt.links.new(mapping.outputs["Vector"], t_rough.inputs["Vector"])

    r_dry = nt.nodes.new("ShaderNodeMapRange")
    r_dry.inputs["To Min"].default_value = rough_min
    r_dry.inputs["To Max"].default_value = rough_max
    nt.links.new(t_rough.outputs["Color"], r_dry.inputs["Value"])

    r_wet_mix = nt.nodes.new("ShaderNodeMix")
    r_wet_mix.data_type = "FLOAT"
    r_wet_mix.inputs[3].default_value = 0.38
    nt.links.new(wet_mask.outputs["Result"], r_wet_mix.inputs["Factor"])
    nt.links.new(r_dry.outputs["Result"], r_wet_mix.inputs[2])
    nt.links.new(r_wet_mix.outputs[0], bsdf.inputs["Roughness"])

    # Non-Color Displacement feeds Bump cleanly
    t_disp = nt.nodes.new("ShaderNodeTexImage")
    t_disp.image = load_image_safe(disp_path, is_data=True)
    t_disp.projection = "BOX"
    t_disp.projection_blend = 0.28
    nt.links.new(mapping.outputs["Vector"], t_disp.inputs["Vector"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.65
    bump.inputs["Distance"].default_value = 0.85
    nt.links.new(t_disp.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def build_terrain_pbr_material(terrain_obj):
    """Multi-biome world-space triplanar PBR material for SM_Island_Terrain."""
    mat = bpy.data.materials.get("M_Island_Terrain_PBR")
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new("M_Island_Terrain_PBR")
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.45

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep_nrm = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Position"], sep_pos.inputs["Vector"])
    nt.links.new(geom.outputs["Normal"], sep_nrm.inputs["Vector"])

    # Attributes from SM_Island_Terrain
    a_forest = nt.nodes.new("ShaderNodeAttribute")
    a_forest.attribute_name = "Mask_Forest_Smooth"
    a_meadow = nt.nodes.new("ShaderNodeAttribute")
    a_meadow.attribute_name = "Mask_Meadow_Smooth"
    a_sand = nt.nodes.new("ShaderNodeAttribute")
    a_sand.attribute_name = "Mask_WhiteSand_Smooth"
    a_seabed = nt.nodes.new("ShaderNodeAttribute")
    a_seabed.attribute_name = "Mask_Seabed_Smooth"

    # Slope & altitude masks (steep slopes > ~36 deg or high ridges > 325m expose dark basalt)
    flat_mask = nt.nodes.new("ShaderNodeMapRange")
    flat_mask.interpolation_type = "SMOOTHSTEP"
    flat_mask.inputs["From Min"].default_value = 0.62
    flat_mask.inputs["From Max"].default_value = 0.86
    nt.links.new(sep_nrm.outputs["Z"], flat_mask.inputs["Value"])

    below_treeline = nt.nodes.new("ShaderNodeMapRange")
    below_treeline.interpolation_type = "SMOOTHSTEP"
    below_treeline.inputs["From Min"].default_value = 335.0
    below_treeline.inputs["From Max"].default_value = 285.0
    nt.links.new(sep_pos.outputs["Z"], below_treeline.inputs["Value"])

    # ── 1) Cool Dark Basalt Cliff Layer (matches 02_HeroRocks M_Hero_Basalt_Dark) ──
    map_rock = nt.nodes.new("ShaderNodeMapping")
    map_rock.inputs["Scale"].default_value = (0.042, 0.042, 0.042)
    nt.links.new(geom.outputs["Position"], map_rock.inputs["Vector"])

    t_rock_d = nt.nodes.new("ShaderNodeTexImage")
    t_rock_d.image = load_image_safe(os.path.join(ASSETS_DIR, "landscape", "Diffuse.jpg"), is_data=False)
    t_rock_d.projection = "BOX"
    t_rock_d.projection_blend = 0.28
    nt.links.new(map_rock.outputs["Vector"], t_rock_d.inputs["Vector"])

    t_rock_r = nt.nodes.new("ShaderNodeTexImage")
    t_rock_r.image = load_image_safe(os.path.join(ASSETS_DIR, "landscape", "Rough.jpg"), is_data=True)
    t_rock_r.projection = "BOX"
    t_rock_r.projection_blend = 0.28
    nt.links.new(map_rock.outputs["Vector"], t_rock_r.inputs["Vector"])

    t_rock_h = nt.nodes.new("ShaderNodeTexImage")
    t_rock_h.image = load_image_safe(os.path.join(ASSETS_DIR, "landscape", "Displacement.jpg"), is_data=True)
    t_rock_h.projection = "BOX"
    t_rock_h.projection_blend = 0.28
    nt.links.new(map_rock.outputs["Vector"], t_rock_h.inputs["Vector"])

    rock_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    rock_hsv.inputs["Saturation"].default_value = 0.22
    rock_hsv.inputs["Value"].default_value = 0.22
    nt.links.new(t_rock_d.outputs["Color"], rock_hsv.inputs["Color"])

    rock_tint = nt.nodes.new("ShaderNodeMix")
    rock_tint.data_type = "RGBA"
    rock_tint.blend_type = "MULTIPLY"
    rock_tint.inputs["Factor"].default_value = 1.0
    rock_tint.inputs[7].default_value = (0.78, 0.88, 1.02, 1.0)
    nt.links.new(rock_hsv.outputs["Color"], rock_tint.inputs[6])

    # Vertical basalt rain streaks (stretched along Z via small Z scale)
    map_streak = nt.nodes.new("ShaderNodeMapping")
    map_streak.inputs["Scale"].default_value = (0.045, 0.045, 0.004)
    nt.links.new(geom.outputs["Position"], map_streak.inputs["Vector"])
    n_streak = nt.nodes.new("ShaderNodeTexNoise")
    n_streak.inputs["Scale"].default_value = 2.8
    n_streak.inputs["Detail"].default_value = 4.0
    nt.links.new(map_streak.outputs["Vector"], n_streak.inputs["Vector"])

    streak_val = nt.nodes.new("ShaderNodeMapRange")
    streak_val.inputs["From Min"].default_value = 0.30
    streak_val.inputs["From Max"].default_value = 0.72
    streak_val.inputs["To Min"].default_value = 0.58
    streak_val.inputs["To Max"].default_value = 1.20
    nt.links.new(n_streak.outputs["Fac"], streak_val.inputs["Value"])

    rock_col = nt.nodes.new("ShaderNodeMix")
    rock_col.data_type = "RGBA"
    rock_col.blend_type = "MULTIPLY"
    rock_col.inputs["Factor"].default_value = 0.85
    nt.links.new(rock_tint.outputs[2], rock_col.inputs[6])
    nt.links.new(streak_val.outputs["Result"], rock_col.inputs[7])

    rock_rough = nt.nodes.new("ShaderNodeMapRange")
    rock_rough.inputs["To Min"].default_value = 0.74
    rock_rough.inputs["To Max"].default_value = 0.95
    nt.links.new(t_rock_r.outputs["Color"], rock_rough.inputs["Value"])

    # ── 2) Tropical Cloud Forest Floor Layer ──
    map_forest = nt.nodes.new("ShaderNodeMapping")
    map_forest.inputs["Scale"].default_value = (0.095, 0.095, 0.095)
    nt.links.new(geom.outputs["Position"], map_forest.inputs["Vector"])

    t_for_d = nt.nodes.new("ShaderNodeTexImage")
    t_for_d.image = load_image_safe(os.path.join(ASSETS_DIR, "textures", "forest_ground_04_diff_1k.jpg"), is_data=False)
    t_for_d.projection = "BOX"
    t_for_d.projection_blend = 0.25
    nt.links.new(map_forest.outputs["Vector"], t_for_d.inputs["Vector"])

    t_for_r = nt.nodes.new("ShaderNodeTexImage")
    t_for_r.image = load_image_safe(os.path.join(ASSETS_DIR, "textures", "forest_ground_04_rough_1k.jpg"), is_data=True)
    t_for_r.projection = "BOX"
    t_for_r.projection_blend = 0.25
    nt.links.new(map_forest.outputs["Vector"], t_for_r.inputs["Vector"])

    # Lush damp volcanic rainforest green-moss tint
    for_tint = nt.nodes.new("ShaderNodeMix")
    for_tint.data_type = "RGBA"
    for_tint.blend_type = "MULTIPLY"
    for_tint.inputs["Factor"].default_value = 1.0
    for_tint.inputs[7].default_value = (0.34, 0.72, 0.28, 1.0)
    nt.links.new(t_for_d.outputs["Color"], for_tint.inputs[6])

    for_rough = nt.nodes.new("ShaderNodeMapRange")
    for_rough.inputs["To Min"].default_value = 0.84
    for_rough.inputs["To Max"].default_value = 0.96
    nt.links.new(t_for_r.outputs["Color"], for_rough.inputs["Value"])

    # ── 3) Humid Lakeside Sedge/Grass Shore Layer (Option C: fresh lush green, no dry yellow) ──
    mead_tint = nt.nodes.new("ShaderNodeMix")
    mead_tint.data_type = "RGBA"
    mead_tint.blend_type = "MULTIPLY"
    mead_tint.inputs["Factor"].default_value = 1.0
    mead_tint.inputs[7].default_value = (0.36, 0.72, 0.28, 1.0)
    nt.links.new(t_for_d.outputs["Color"], mead_tint.inputs[6])

    # ── 4) White Sand Beach Layer (dry bright coral-white -> glossy darker wet sand) ──
    map_sand = nt.nodes.new("ShaderNodeMapping")
    map_sand.inputs["Scale"].default_value = (0.28, 0.28, 0.28)
    nt.links.new(geom.outputs["Position"], map_sand.inputs["Vector"])

    t_sand_d = nt.nodes.new("ShaderNodeTexImage")
    t_sand_d.image = load_image_safe(os.path.join(ASSETS_DIR, "textures", "coast_sand_03_diff_1k.jpg"), is_data=False)
    t_sand_d.projection = "BOX"
    t_sand_d.projection_blend = 0.25
    nt.links.new(map_sand.outputs["Vector"], t_sand_d.inputs["Vector"])

    t_sand_r = nt.nodes.new("ShaderNodeTexImage")
    t_sand_r.image = load_image_safe(os.path.join(ASSETS_DIR, "textures", "coast_sand_03_rough_1k.jpg"), is_data=True)
    t_sand_r.projection = "BOX"
    t_sand_r.projection_blend = 0.25
    nt.links.new(map_sand.outputs["Vector"], t_sand_r.inputs["Vector"])

    sand_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    sand_hsv.inputs["Saturation"].default_value = 0.35
    sand_hsv.inputs["Value"].default_value = 1.85
    nt.links.new(t_sand_d.outputs["Color"], sand_hsv.inputs["Color"])

    sand_wet = nt.nodes.new("ShaderNodeMapRange")
    sand_wet.interpolation_type = "SMOOTHSTEP"
    sand_wet.inputs["From Min"].default_value = 1.8
    sand_wet.inputs["From Max"].default_value = 0.15
    nt.links.new(sep_pos.outputs["Z"], sand_wet.inputs["Value"])

    sand_col = nt.nodes.new("ShaderNodeMix")
    sand_col.data_type = "RGBA"
    sand_col.blend_type = "MULTIPLY"
    sand_col.inputs[7].default_value = (0.46, 0.44, 0.39, 1.0)
    nt.links.new(sand_wet.outputs["Result"], sand_col.inputs["Factor"])
    nt.links.new(sand_hsv.outputs["Color"], sand_col.inputs[6])

    sand_rough_dry = nt.nodes.new("ShaderNodeMapRange")
    sand_rough_dry.inputs["To Min"].default_value = 0.78
    sand_rough_dry.inputs["To Max"].default_value = 0.92
    nt.links.new(t_sand_r.outputs["Color"], sand_rough_dry.inputs["Value"])

    sand_rough = nt.nodes.new("ShaderNodeMix")
    sand_rough.data_type = "FLOAT"
    sand_rough.inputs[3].default_value = 0.24
    nt.links.new(sand_wet.outputs["Result"], sand_rough.inputs["Factor"])
    nt.links.new(sand_rough_dry.outputs["Result"], sand_rough.inputs[2])

    # ── Blend Weights ──
    # Forest weight = Mask_Forest_Smooth * flat_mask * below_treeline
    fw1 = nt.nodes.new("ShaderNodeMath")
    fw1.operation = "MULTIPLY"
    nt.links.new(a_forest.outputs["Fac"], fw1.inputs[0])
    nt.links.new(flat_mask.outputs["Result"], fw1.inputs[1])

    fw2 = nt.nodes.new("ShaderNodeMath")
    fw2.operation = "MULTIPLY"
    nt.links.new(fw1.outputs["Value"], fw2.inputs[0])
    nt.links.new(below_treeline.outputs["Result"], fw2.inputs[1])

    # Meadow weight = Mask_Meadow_Smooth * flat_mask
    mw = nt.nodes.new("ShaderNodeMath")
    mw.operation = "MULTIPLY"
    nt.links.new(a_meadow.outputs["Fac"], mw.inputs[0])
    nt.links.new(flat_mask.outputs["Result"], mw.inputs[1])

    # Sand weight = Mask_WhiteSand_Smooth * smoothstep(0.65, 0.90, N.z)
    sand_flat = nt.nodes.new("ShaderNodeMapRange")
    sand_flat.interpolation_type = "SMOOTHSTEP"
    sand_flat.inputs["From Min"].default_value = 0.65
    sand_flat.inputs["From Max"].default_value = 0.90
    nt.links.new(sep_nrm.outputs["Z"], sand_flat.inputs["Value"])

    sw = nt.nodes.new("ShaderNodeMath")
    sw.operation = "MULTIPLY"
    nt.links.new(a_sand.outputs["Fac"], sw.inputs[0])
    nt.links.new(sand_flat.outputs["Result"], sw.inputs[1])

    # Color chain: Basalt -> Forest -> Meadow -> White Sand -> Wet Cliff Base
    c1 = nt.nodes.new("ShaderNodeMix")
    c1.data_type = "RGBA"
    nt.links.new(fw2.outputs["Value"], c1.inputs["Factor"])
    nt.links.new(rock_col.outputs[2], c1.inputs[6])
    nt.links.new(for_tint.outputs[2], c1.inputs[7])

    c2 = nt.nodes.new("ShaderNodeMix")
    c2.data_type = "RGBA"
    nt.links.new(mw.outputs["Value"], c2.inputs["Factor"])
    nt.links.new(c1.outputs[2], c2.inputs[6])
    nt.links.new(mead_tint.outputs[2], c2.inputs[7])

    c3 = nt.nodes.new("ShaderNodeMix")
    c3.data_type = "RGBA"
    nt.links.new(sw.outputs["Value"], c3.inputs["Factor"])
    nt.links.new(c2.outputs[2], c3.inputs[6])
    nt.links.new(sand_col.outputs[2], c3.inputs[7])

    # Dark wet rock splash belt near sea level (excluding white sand)
    cliff_wet = nt.nodes.new("ShaderNodeMapRange")
    cliff_wet.interpolation_type = "SMOOTHSTEP"
    cliff_wet.inputs["From Min"].default_value = 11.0
    cliff_wet.inputs["From Max"].default_value = 1.0
    nt.links.new(sep_pos.outputs["Z"], cliff_wet.inputs["Value"])

    not_sand = nt.nodes.new("ShaderNodeMath")
    not_sand.operation = "SUBTRACT"
    not_sand.inputs[0].default_value = 1.0
    nt.links.new(sw.outputs["Value"], not_sand.inputs[1])

    cw_fac = nt.nodes.new("ShaderNodeMath")
    cw_fac.operation = "MULTIPLY"
    nt.links.new(cliff_wet.outputs["Result"], cw_fac.inputs[0])
    nt.links.new(not_sand.outputs["Value"], cw_fac.inputs[1])

    c4 = nt.nodes.new("ShaderNodeMix")
    c4.data_type = "RGBA"
    c4.blend_type = "MULTIPLY"
    c4.inputs[7].default_value = (0.50, 0.54, 0.58, 1.0)
    nt.links.new(cw_fac.outputs["Value"], c4.inputs["Factor"])
    nt.links.new(c3.outputs[2], c4.inputs[6])
    nt.links.new(c4.outputs[2], bsdf.inputs["Base Color"])

    # Roughness chain
    r1 = nt.nodes.new("ShaderNodeMix")
    r1.data_type = "FLOAT"
    nt.links.new(fw2.outputs["Value"], r1.inputs["Factor"])
    nt.links.new(rock_rough.outputs["Result"], r1.inputs[2])
    nt.links.new(for_rough.outputs["Result"], r1.inputs[3])

    r2 = nt.nodes.new("ShaderNodeMix")
    r2.data_type = "FLOAT"
    nt.links.new(sw.outputs["Value"], r2.inputs["Factor"])
    nt.links.new(r1.outputs[0], r2.inputs[2])
    nt.links.new(sand_rough.outputs[0], r2.inputs[3])

    r3 = nt.nodes.new("ShaderNodeMix")
    r3.data_type = "FLOAT"
    r3.inputs[3].default_value = 0.42
    nt.links.new(cw_fac.outputs["Value"], r3.inputs["Factor"])
    nt.links.new(r2.outputs[0], r3.inputs[2])
    nt.links.new(r3.outputs[0], bsdf.inputs["Roughness"])

    # Bump from Non-Color Displacement (diminished on smooth sand)
    bump_str = nt.nodes.new("ShaderNodeMix")
    bump_str.data_type = "FLOAT"
    bump_str.inputs[2].default_value = 0.72
    bump_str.inputs[3].default_value = 0.08
    nt.links.new(sw.outputs["Value"], bump_str.inputs["Factor"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 1.1
    nt.links.new(bump_str.outputs[0], bump.inputs["Strength"])
    nt.links.new(t_rock_h.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    terrain_obj.data.materials.clear()
    terrain_obj.data.materials.append(mat)
    return mat


def build_ocean_mesh_and_material(meta, hf, col_water):
    """Build detailed ocean mesh with Water_Depth attribute for clear coastal shallows + outer horizon skirt."""
    g = meta["grid"]
    x0, y0 = float(g["x0"]) * 1000.0, float(g["y0"]) * 1000.0
    x1 = x0 + (int(g["nx"]) - 1) * float(g["step"]) * 1000.0
    y1 = y0 + (int(g["ny"]) - 1) * float(g["step"]) * 1000.0

    # Inner high-res water grid (180x160 = ~27m spacing) for accurate shallow turquoise grading
    nx_w, ny_w = 180, 160
    xs = np.linspace(x0, x1, nx_w, dtype=np.float32)
    ys = np.linspace(y0, y1, ny_w, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)
    verts = np.stack([xx, yy, np.zeros_like(xx)], axis=-1).reshape(-1, 3)

    # Sample terrain elevation at each ocean vertex to compute exact Water_Depth
    depths = np.empty(verts.shape[0], dtype=np.float32)
    for idx in range(verts.shape[0]):
        h = sample_height(meta, hf, float(verts[idx, 0]), float(verts[idx, 1]))
        depths[idx] = max(0.0, -h)

    jj, ii = np.meshgrid(np.arange(ny_w - 1, dtype=np.int32), np.arange(nx_w - 1, dtype=np.int32), indexing="ij")
    a = (jj * nx_w + ii).ravel()
    quads = np.stack([a, a + 1, a + nx_w + 1, a + nx_w], axis=-1)

    # Add 4 outer ocean apron quads extending smoothly to +-11,000 m (depth = 200 m)
    far = 11000.0
    base_v = verts.shape[0]
    outer_verts = np.array([
        [-far, -far, 0.0], [far, -far, 0.0], [far, far, 0.0], [-far, far, 0.0],
        [x0, y0, 0.0], [x1, y0, 0.0], [x1, y1, 0.0], [x0, y1, 0.0],
    ], dtype=np.float32)
    outer_depths = np.full(8, 200.0, dtype=np.float32)
    o0, o1, o2, o3, i0, i1, i2, i3 = range(base_v, base_v + 8)
    outer_quads = np.array([
        [o0, o1, i1, i0],
        [o1, o2, i2, i1],
        [o2, o3, i3, i2],
        [o3, o0, i0, i3],
    ], dtype=np.int32)

    all_verts = np.vstack([verts, outer_verts])
    all_depths = np.concatenate([depths, outer_depths])
    all_quads = np.vstack([quads, outer_quads])

    mesh = bpy.data.meshes.new("SM_Water_Ocean")
    mesh.vertices.add(all_verts.shape[0])
    mesh.vertices.foreach_set("co", all_verts.ravel())
    mesh.loops.add(all_quads.shape[0] * 4)
    mesh.loops.foreach_set("vertex_index", all_quads.ravel())
    mesh.polygons.add(all_quads.shape[0])
    mesh.polygons.foreach_set("loop_start", np.arange(0, all_quads.shape[0] * 4, 4, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(all_quads.shape[0], 4, dtype=np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(all_quads.shape[0], dtype=bool))

    # Planar UV
    loop_vi = all_quads.ravel()
    uvs = np.empty(loop_vi.size * 2, dtype=np.float32)
    uvs[0::2] = (all_verts[loop_vi, 0] + far) / (2.0 * far)
    uvs[1::2] = (all_verts[loop_vi, 1] + far) / (2.0 * far)
    mesh.uv_layers.new(name="UVMap").data.foreach_set("uv", uvs)

    d_attr = mesh.attributes.new(name="Water_Depth", type="FLOAT", domain="POINT")
    d_attr.data.foreach_set("value", all_depths)
    mesh.update()

    obj = bpy.data.objects.new("SM_Water_Ocean", mesh)
    link_only_to(obj, col_water)

    # Ocean PBR Shader: depth-driven turquoise shallows -> deep Pacific blue + multi-scale wave bump
    mat = bpy.data.materials.get("M_Water_Ocean_PBR")
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new("M_Water_Ocean_PBR")
    mat.surface_render_method = "BLENDED"
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.09
    bsdf.inputs["IOR"].default_value = 1.333
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.65

    a_depth = nt.nodes.new("ShaderNodeAttribute")
    a_depth.attribute_name = "Water_Depth"

    shallow_fac = nt.nodes.new("ShaderNodeMapRange")
    shallow_fac.interpolation_type = "SMOOTHSTEP"
    shallow_fac.inputs["From Min"].default_value = 22.0
    shallow_fac.inputs["From Max"].default_value = 0.4
    nt.links.new(a_depth.outputs["Fac"], shallow_fac.inputs["Value"])

    col_mix = nt.nodes.new("ShaderNodeMix")
    col_mix.data_type = "RGBA"
    col_mix.inputs[6].default_value = (0.008, 0.036, 0.068, 1.0)  # deep South Pacific navy-teal
    col_mix.inputs[7].default_value = (0.032, 0.190, 0.195, 1.0)  # clear turquoise shallows
    nt.links.new(shallow_fac.outputs["Result"], col_mix.inputs["Factor"])
    nt.links.new(col_mix.outputs[2], bsdf.inputs["Base Color"])

    alpha_map = nt.nodes.new("ShaderNodeMapRange")
    alpha_map.interpolation_type = "SMOOTHSTEP"
    alpha_map.inputs["From Min"].default_value = 0.2
    alpha_map.inputs["From Max"].default_value = 18.0
    alpha_map.inputs["To Min"].default_value = 0.42
    alpha_map.inputs["To Max"].default_value = 1.0
    nt.links.new(a_depth.outputs["Fac"], alpha_map.inputs["Value"])
    nt.links.new(alpha_map.outputs["Result"], bsdf.inputs["Alpha"])

    # Two-octave ocean swell & trade-wind ripple bump
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    m_swell = nt.nodes.new("ShaderNodeMapping")
    m_swell.inputs["Scale"].default_value = (0.018, 0.032, 0.02)
    m_swell.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(-35.0))
    nt.links.new(geom.outputs["Position"], m_swell.inputs["Vector"])

    n_swell = nt.nodes.new("ShaderNodeTexNoise")
    n_swell.inputs["Scale"].default_value = 1.6
    n_swell.inputs["Detail"].default_value = 5.0
    n_swell.inputs["Roughness"].default_value = 0.55
    nt.links.new(m_swell.outputs["Vector"], n_swell.inputs["Vector"])

    n_chop = nt.nodes.new("ShaderNodeTexNoise")
    n_chop.inputs["Scale"].default_value = 0.22
    n_chop.inputs["Detail"].default_value = 4.0
    nt.links.new(geom.outputs["Position"], n_chop.inputs["Vector"])

    wave_sum = nt.nodes.new("ShaderNodeMath")
    wave_sum.operation = "ADD"
    nt.links.new(n_swell.outputs["Fac"], wave_sum.inputs[0])
    w_scaled = nt.nodes.new("ShaderNodeMath")
    w_scaled.operation = "MULTIPLY"
    w_scaled.inputs[1].default_value = 0.35
    nt.links.new(n_chop.outputs["Fac"], w_scaled.inputs[0])
    nt.links.new(w_scaled.outputs["Value"], wave_sum.inputs[1])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.35
    nt.links.new(wave_sum.outputs["Value"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    obj.data.materials.append(mat)
    return obj


def build_mirror_lake(meta, col_water):
    lake_pts = meta["lake"]
    lake_z = float(meta["lakeLevel"])
    lake_verts = [(p[0] * 1000.0, p[1] * 1000.0, lake_z) for p in lake_pts]
    area2 = sum(
        lake_verts[i][0] * lake_verts[(i + 1) % len(lake_verts)][1]
        - lake_verts[(i + 1) % len(lake_verts)][0] * lake_verts[i][1]
        for i in range(len(lake_verts))
    )
    if area2 < 0:
        lake_verts.reverse()

    mesh = bpy.data.meshes.new("SM_Water_MirrorLake")
    mesh.from_pydata(lake_verts, [], [tuple(range(len(lake_verts)))])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
        for lp in f.loops:
            lp[uv_layer].uv = ((lp.vert.co.x + 700.0) / 600.0, (lp.vert.co.y + 200.0) / 400.0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new("SM_Water_MirrorLake", mesh)
    link_only_to(obj, col_water)

    mat = bpy.data.materials.get("M_Water_MirrorLake_PBR")
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new("M_Water_MirrorLake_PBR")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.010, 0.068, 0.082, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.055
    bsdf.inputs["IOR"].default_value = 1.333

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    n_rip = nt.nodes.new("ShaderNodeTexNoise")
    n_rip.inputs["Scale"].default_value = 0.14
    n_rip.inputs["Detail"].default_value = 3.0
    nt.links.new(geom.outputs["Position"], n_rip.inputs["Vector"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.08
    nt.links.new(n_rip.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    obj.data.materials.append(mat)
    return obj


def build_river_and_waterfall(meta, col_water):
    profile = meta["riverProfile"]
    lip_idx = int(meta["lipIndex"])

    # ── 1) Whitewater River (329m channel from lake overflow to +129m lip) ──
    raw_pts = [(p[0] * 1000.0, p[1] * 1000.0, float(p[2])) for p in profile[: lip_idx + 1]]
    # Subdivide river polyline cleanly
    dense = []
    for i in range(len(raw_pts) - 1):
        p0, p1 = raw_pts[i], raw_pts[i + 1]
        steps = 12
        for s in range(steps):
            f = s / steps
            dense.append((p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f))
    dense.append(raw_pts[-1])

    r_verts, r_faces, r_uvs = [], [], []
    dist = 0.0
    for i, (x, y, z) in enumerate(dense):
        if i > 0:
            dist += math.hypot(x - dense[i - 1][0], y - dense[i - 1][1])
        p_prev = dense[max(0, i - 1)]
        p_next = dense[min(len(dense) - 1, i + 1)]
        dx, dy = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        L = max(1e-4, math.hypot(dx, dy))
        # Left/right perpendicular in XY
        px, py = -dy / L, dx / L
        hw = 2.2 if i < len(dense) - 3 else 1.85
        r_verts.append((x - px * hw, y - py * hw, z + 0.14))
        r_verts.append((x + px * hw, y + py * hw, z + 0.14))
        r_uvs.append((0.0, dist / 20.0))
        r_uvs.append((1.0, dist / 20.0))
        if i > 0:
            n = i * 2
            r_faces.append((n - 2, n - 1, n + 1, n))

    r_mesh = bpy.data.meshes.new("SM_Water_WhitewaterRiver")
    r_mesh.from_pydata(r_verts, [], r_faces)
    bm = bmesh.new()
    bm.from_mesh(r_mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    uv_l = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.smooth = True
        for lp in f.loops:
            lp[uv_l].uv = r_uvs[lp.vert.index]
    bm.to_mesh(r_mesh)
    bm.free()
    r_mesh.update()

    river_obj = bpy.data.objects.new("SM_Water_WhitewaterRiver", r_mesh)
    link_only_to(river_obj, col_water)

    m_river = bpy.data.materials.get("M_Water_River_PBR")
    if m_river is not None:
        bpy.data.materials.remove(m_river)
    m_river = bpy.data.materials.new("M_Water_River_PBR")
    m_river.surface_render_method = "BLENDED"
    nt = m_river.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.16
    bsdf.inputs["IOR"].default_value = 1.333
    bsdf.inputs["Alpha"].default_value = 0.88

    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep_uv = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep_uv.inputs["Vector"])
    n_flow = nt.nodes.new("ShaderNodeTexNoise")
    n_flow.inputs["Scale"].default_value = 4.2
    n_flow.inputs["Detail"].default_value = 5.0
    nt.links.new(tc.outputs["UV"], n_flow.inputs["Vector"])

    # Mix teal river water with frothy whitewater rapids toward the waterfall lip
    lip_fac = nt.nodes.new("ShaderNodeMapRange")
    lip_fac.inputs["From Min"].default_value = 11.0
    lip_fac.inputs["From Max"].default_value = 16.5
    nt.links.new(sep_uv.outputs["Y"], lip_fac.inputs["Value"])

    foam_fac = nt.nodes.new("ShaderNodeMath")
    foam_fac.operation = "MAXIMUM"
    nt.links.new(lip_fac.outputs["Result"], foam_fac.inputs[0])
    f_noise = nt.nodes.new("ShaderNodeMapRange")
    f_noise.inputs["From Min"].default_value = 0.55
    f_noise.inputs["From Max"].default_value = 0.82
    nt.links.new(n_flow.outputs["Fac"], f_noise.inputs["Value"])
    nt.links.new(f_noise.outputs["Result"], foam_fac.inputs[1])

    col_r = nt.nodes.new("ShaderNodeMix")
    col_r.data_type = "RGBA"
    col_r.inputs[6].default_value = (0.045, 0.18, 0.20, 1.0)
    col_r.inputs[7].default_value = (0.72, 0.84, 0.88, 1.0)
    nt.links.new(foam_fac.outputs["Value"], col_r.inputs["Factor"])
    nt.links.new(col_r.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    river_obj.data.materials.append(m_river)

    # ── 2) 129m Curtain Waterfall (5 parabolic free-fall strands from lip to bay) ──
    lip = profile[lip_idx]
    imp = profile[lip_idx + 1]
    fx, fy, lip_z = float(lip[0]) * 1000.0, float(lip[1]) * 1000.0, float(lip[2])
    ix, iy, sea_z = float(imp[0]) * 1000.0, float(imp[1]) * 1000.0, float(imp[2])
    drop = lip_z - sea_z

    strands = [(-0.9, 0.95), (-0.15, 0.65), (0.55, 0.78), (1.25, 0.52), (-1.55, 0.48)]
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    seg = 36
    for s_idx, (offset, width) in enumerate(strands):
        # Slightly offset each strand in Y (by 0.18m) so overlapping strands never z-fight!
        y_off = (s_idx - 2) * 0.22
        rows = []
        for s in range(seg + 1):
            f = s / seg
            z = lip_z - drop * f * f
            spread = 1.0 + 2.6 * f
            cx = fx + (ix - fx) * f + offset * spread * 1.4 + 0.6 * math.sin(f * 7.0 + offset * 3.0)
            cy = fy + (iy - fy) * f + y_off
            hw = width * spread * 0.92
            v0 = bm.verts.new((cx - hw, cy, z))
            v1 = bm.verts.new((cx + hw, cy, z))
            rows.append((v0, v1, f))
        for s in range(seg):
            a0, a1, f0 = rows[s]
            b0, b1, f1 = rows[s + 1]
            face = bm.faces.new((a0, a1, b1, b0))
            face.smooth = True
            uvs_q = [(0.0, f0), (1.0, f0), (1.0, f1), (0.0, f1)]
            for lp, uv_val in zip(face.loops, uvs_q):
                lp[uv_layer].uv = uv_val

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    wf_mesh = bpy.data.meshes.new("SM_Water_CurtainFalls")
    bm.to_mesh(wf_mesh)
    bm.free()
    wf_mesh.update()

    wf_obj = bpy.data.objects.new("SM_Water_CurtainFalls", wf_mesh)
    link_only_to(wf_obj, col_water)

    m_wf = bpy.data.materials.get("M_Water_Waterfall_PBR")
    if m_wf is not None:
        bpy.data.materials.remove(m_wf)
    m_wf = bpy.data.materials.new("M_Water_Waterfall_PBR")
    m_wf.surface_render_method = "BLENDED"
    nt = m_wf.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.76, 0.88, 0.93, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.30
    bsdf.inputs["Emission Color"].default_value = (0.72, 0.85, 0.90, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.18

    # Soft side-feathered & streak-broken alpha
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])

    # Edge feather: 1 - abs(2u - 1)
    u2 = nt.nodes.new("ShaderNodeMath")
    u2.operation = "MULTIPLY"
    u2.inputs[1].default_value = 2.0
    nt.links.new(sep.outputs["X"], u2.inputs[0])
    um = nt.nodes.new("ShaderNodeMath")
    um.operation = "SUBTRACT"
    um.inputs[1].default_value = 1.0
    nt.links.new(u2.outputs["Value"], um.inputs[0])
    uabs = nt.nodes.new("ShaderNodeMath")
    uabs.operation = "ABSOLUTE"
    nt.links.new(um.outputs["Value"], uabs.inputs[0])
    edge = nt.nodes.new("ShaderNodeMapRange")
    edge.interpolation_type = "SMOOTHSTEP"
    edge.inputs["From Min"].default_value = 1.0
    edge.inputs["From Max"].default_value = 0.30
    nt.links.new(uabs.outputs["Value"], edge.inputs["Value"])

    m_str = nt.nodes.new("ShaderNodeMapping")
    m_str.inputs["Scale"].default_value = (5.0, 1.2, 1.0)
    nt.links.new(tc.outputs["UV"], m_str.inputs["Vector"])
    n_str = nt.nodes.new("ShaderNodeTexNoise")
    n_str.inputs["Scale"].default_value = 3.5
    n_str.inputs["Detail"].default_value = 5.0
    nt.links.new(m_str.outputs["Vector"], n_str.inputs["Vector"])

    str_a = nt.nodes.new("ShaderNodeMapRange")
    str_a.inputs["From Min"].default_value = 0.22
    str_a.inputs["From Max"].default_value = 0.78
    str_a.inputs["To Min"].default_value = 0.28
    str_a.inputs["To Max"].default_value = 0.82
    nt.links.new(n_str.outputs["Fac"], str_a.inputs["Value"])

    alpha_wf = nt.nodes.new("ShaderNodeMath")
    alpha_wf.operation = "MULTIPLY"
    nt.links.new(edge.outputs["Result"], alpha_wf.inputs[0])
    nt.links.new(str_a.outputs["Result"], alpha_wf.inputs[1])
    nt.links.new(alpha_wf.outputs["Value"], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    wf_obj.data.materials.append(m_wf)

    # ── 3a) Plunge-Pool Splash Foam (SM_Water_PlungeFoam, origin centered at impact point) ──
    bm_p = bmesh.new()
    uv_p = bm_p.loops.layers.uv.new("UVMap")
    rx, ry = 18.0, 16.0
    segs_f = 32
    center_v = bm_p.verts.new((0.0, 0.0, 0.0))
    ring_v = [
        bm_p.verts.new((math.cos(2 * math.pi * k / segs_f) * rx, math.sin(2 * math.pi * k / segs_f) * ry, 0.0))
        for k in range(segs_f)
    ]
    for k in range(segs_f):
        kn = (k + 1) % segs_f
        f = bm_p.faces.new((center_v, ring_v[k], ring_v[kn]))
        f.smooth = True
        a0, a1 = 2 * math.pi * k / segs_f, 2 * math.pi * kn / segs_f
        f.loops[0][uv_p].uv = (0.5, 0.5)
        f.loops[1][uv_p].uv = (0.5 + 0.5 * math.cos(a0), 0.5 + 0.5 * math.sin(a0))
        f.loops[2][uv_p].uv = (0.5 + 0.5 * math.cos(a1), 0.5 + 0.5 * math.sin(a1))

    bmesh.ops.recalc_face_normals(bm_p, faces=bm_p.faces[:])
    plunge_mesh = bpy.data.meshes.new("SM_Water_PlungeFoam")
    bm_p.to_mesh(plunge_mesh)
    bm_p.free()
    plunge_mesh.update()
    plunge_obj = bpy.data.objects.new("SM_Water_PlungeFoam", plunge_mesh)
    plunge_obj.location = (ix, iy, 0.16)
    link_only_to(plunge_obj, col_water)

    # ── 3b) Black Gravel Bay Shoreline Surf Strip (SM_Water_BeachSurf) ──
    bm_s = bmesh.new()
    uv_s = bm_s.loops.layers.uv.new("UVMap")
    west, east = -0.265, 0.060
    n_along = 96
    s_rows = []
    for i in range(n_along + 1):
        t = i / n_along
        xk = west + (east - west) * t
        yk = beach_shore_scalar(xk)
        x_m, y_m = xk * 1000.0, yk * 1000.0
        v_in = bm_s.verts.new((x_m, y_m + 0.5, 0.14))
        v_out = bm_s.verts.new((x_m, y_m + 11.0, 0.14))
        s_rows.append((v_in, v_out, t))
    for i in range(n_along):
        a0, a1, t0 = s_rows[i]
        b0, b1, t1 = s_rows[i + 1]
        f = bm_s.faces.new((a0, b0, b1, a1))
        f.smooth = True
        for lp, uv_val in zip(f.loops, [(t0, 0.0), (t1, 0.0), (t1, 1.0), (t0, 1.0)]):
            lp[uv_s].uv = uv_val

    bmesh.ops.recalc_face_normals(bm_s, faces=bm_s.faces[:])
    surf_mesh = bpy.data.meshes.new("SM_Water_BeachSurf")
    bm_s.to_mesh(surf_mesh)
    bm_s.free()
    surf_mesh.update()
    surf_obj = bpy.data.objects.new("SM_Water_BeachSurf", surf_mesh)
    link_only_to(surf_obj, col_water)

    # Plunge radial foam material
    m_foam = bpy.data.materials.get("M_Water_Foam_PBR")
    if m_foam is not None:
        bpy.data.materials.remove(m_foam)
    m_foam = bpy.data.materials.new("M_Water_Foam_PBR")
    m_foam.surface_render_method = "BLENDED"
    nt = m_foam.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.82, 0.90, 0.92, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.35

    tc = nt.nodes.new("ShaderNodeTexCoord")
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    dist_uv = nt.nodes.new("ShaderNodeVectorMath")
    dist_uv.operation = "DISTANCE"
    dist_uv.inputs[1].default_value = (0.5, 0.5, 0.0)
    nt.links.new(tc.outputs["UV"], dist_uv.inputs[0])

    rad_fade = nt.nodes.new("ShaderNodeMapRange")
    rad_fade.interpolation_type = "SMOOTHSTEP"
    rad_fade.inputs["From Min"].default_value = 0.48
    rad_fade.inputs["From Max"].default_value = 0.14
    nt.links.new(dist_uv.outputs["Value"], rad_fade.inputs["Value"])

    n_lace = nt.nodes.new("ShaderNodeTexNoise")
    n_lace.inputs["Scale"].default_value = 0.25
    n_lace.inputs["Detail"].default_value = 5.0
    nt.links.new(geom.outputs["Position"], n_lace.inputs["Vector"])

    lace_m = nt.nodes.new("ShaderNodeMapRange")
    lace_m.inputs["From Min"].default_value = 0.32
    lace_m.inputs["From Max"].default_value = 0.72
    nt.links.new(n_lace.outputs["Fac"], lace_m.inputs["Value"])

    a_foam = nt.nodes.new("ShaderNodeMath")
    a_foam.operation = "MULTIPLY"
    nt.links.new(rad_fade.outputs["Result"], a_foam.inputs[0])
    nt.links.new(lace_m.outputs["Result"], a_foam.inputs[1])

    a_scale = nt.nodes.new("ShaderNodeMath")
    a_scale.operation = "MULTIPLY"
    a_scale.inputs[1].default_value = 0.78
    nt.links.new(a_foam.outputs["Value"], a_scale.inputs[0])
    nt.links.new(a_scale.outputs["Value"], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    plunge_obj.data.materials.append(m_foam)

    # Beach shoreline surf strip material (proper UV U=along-shore, V=offshore)
    m_surf = bpy.data.materials.get("M_Water_Surf_PBR")
    if m_surf is not None:
        bpy.data.materials.remove(m_surf)
    m_surf = bpy.data.materials.new("M_Water_Surf_PBR")
    m_surf.surface_render_method = "BLENDED"
    nt_s = m_surf.node_tree
    nt_s.nodes.clear()
    out_s = nt_s.nodes.new("ShaderNodeOutputMaterial")
    bsdf_s = nt_s.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_s.inputs["Base Color"].default_value = (0.84, 0.91, 0.93, 1.0)
    bsdf_s.inputs["Metallic"].default_value = 0.0
    bsdf_s.inputs["Roughness"].default_value = 0.32

    tc_s = nt_s.nodes.new("ShaderNodeTexCoord")
    sep_s = nt_s.nodes.new("ShaderNodeSeparateXYZ")
    nt_s.links.new(tc_s.outputs["UV"], sep_s.inputs["Vector"])
    geom_s = nt_s.nodes.new("ShaderNodeNewGeometry")

    # Fade at beach west/east ends (U in 0..0.08 and 0.92..1.0) and offshore edge (V -> 1)
    u_left = nt_s.nodes.new("ShaderNodeMapRange")
    u_left.interpolation_type = "SMOOTHSTEP"
    u_left.inputs["From Min"].default_value = 0.0
    u_left.inputs["From Max"].default_value = 0.10
    nt_s.links.new(sep_s.outputs["X"], u_left.inputs["Value"])

    u_right = nt_s.nodes.new("ShaderNodeMapRange")
    u_right.interpolation_type = "SMOOTHSTEP"
    u_right.inputs["From Min"].default_value = 1.0
    u_right.inputs["From Max"].default_value = 0.90
    nt_s.links.new(sep_s.outputs["X"], u_right.inputs["Value"])

    v_fade = nt_s.nodes.new("ShaderNodeMapRange")
    v_fade.interpolation_type = "SMOOTHSTEP"
    v_fade.inputs["From Min"].default_value = 0.95
    v_fade.inputs["From Max"].default_value = 0.12
    nt_s.links.new(sep_s.outputs["Y"], v_fade.inputs["Value"])

    n_surf = nt_s.nodes.new("ShaderNodeTexNoise")
    n_surf.inputs["Scale"].default_value = 0.35
    n_surf.inputs["Detail"].default_value = 5.0
    nt_s.links.new(geom_s.outputs["Position"], n_surf.inputs["Vector"])

    surf_lace = nt_s.nodes.new("ShaderNodeMapRange")
    surf_lace.inputs["From Min"].default_value = 0.30
    surf_lace.inputs["From Max"].default_value = 0.72
    nt_s.links.new(n_surf.outputs["Fac"], surf_lace.inputs["Value"])

    m1 = nt_s.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    nt_s.links.new(u_left.outputs["Result"], m1.inputs[0])
    nt_s.links.new(u_right.outputs["Result"], m1.inputs[1])
    m2 = nt_s.nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    nt_s.links.new(m1.outputs["Value"], m2.inputs[0])
    nt_s.links.new(v_fade.outputs["Result"], m2.inputs[1])
    m3 = nt_s.nodes.new("ShaderNodeMath")
    m3.operation = "MULTIPLY"
    nt_s.links.new(m2.outputs["Value"], m3.inputs[0])
    nt_s.links.new(surf_lace.outputs["Result"], m3.inputs[1])
    m4 = nt_s.nodes.new("ShaderNodeMath")
    m4.operation = "MULTIPLY"
    m4.inputs[1].default_value = 0.65
    nt_s.links.new(m3.outputs["Value"], m4.inputs[0])
    nt_s.links.new(m4.outputs["Value"], bsdf_s.inputs["Alpha"])
    nt_s.links.new(bsdf_s.outputs["BSDF"], out_s.inputs["Surface"])
    surf_obj.data.materials.append(m_surf)

    return river_obj, wf_obj, plunge_obj, surf_obj


def setup_stage3_cameras(col_lc):
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

    return {
        "overview": get_or_set("CAM_Overview_SE", (2450, -2850, 1520), (-20, -60, 80), lens=28.0),
        "sword_and_cliff": get_or_set("CAM_SouthCliff_Sunlit", (620, -2380, 260), (-40, -1350, 185), lens=32.0),
        "sea_arch": get_or_set("CAM_Strait_EastIslet", (1372, 380, 62), (1456, 120, 58), lens=32.0),
        "bay_waterfall": get_or_set("CAM_BlackGravelBay_North", (-210, 740, 82), (-15, 290, 42), lens=32.0),
        "caldera_lake": get_or_set("CAM_Caldera_Lake_Meadow", (-160, 420, 390), (-320, -260, 145), lens=28.0),
    }


def render_stage3(cams):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"

    files = []
    for tag, cam in cams.items():
        scene.camera = cam
        fp = os.path.join(RENDER_DIR, f"stage3_{tag}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(fp)
    scene.camera = cams.get("overview", next(iter(cams.values())))
    return files


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])
    mat_ids = np.fromfile(os.path.join(DATA_DIR, "mat.bin"), dtype=np.uint8)

    # 1) Smooth terrain attributes + multi-biome PBR terrain material
    terrain_obj = bpy.data.objects["SM_Island_Terrain"]
    update_terrain_smooth_attributes(terrain_obj, meta, hf, mat_ids)
    build_terrain_pbr_material(terrain_obj)

    # 2) Unify 02_HeroRocks basalt materials to cool dark charcoal-basalt
    build_cool_basalt_material("M_Hero_Basalt_Dark", value_mult=0.22, rough_min=0.74, rough_max=0.95, tex_scale=0.042, wet_zone_z=11.0)
    build_cool_basalt_material("M_Reef_Basalt_Wet", value_mult=0.14, rough_min=0.35, rough_max=0.68, tex_scale=0.14, wet_zone_z=4.0)
    build_cool_basalt_material("M_Buoy_ReefRock", value_mult=0.18, rough_min=0.88, rough_max=0.96, tex_scale=0.12, wet_zone_z=2.0)

    # 3) Rebuild 03_Water with full PBR ocean, Mirror Lake, Whitewater River, Curtain Falls & Foam
    col_water = bpy.data.collections["03_Water"]
    clear_collection(col_water)
    ocean_obj = build_ocean_mesh_and_material(meta, hf, col_water)
    lake_obj = build_mirror_lake(meta, col_water)
    river_obj, wf_obj, plunge_obj, surf_obj = build_river_and_waterfall(meta, col_water)

    # 4) Cameras, cleanup, save
    cams = setup_stage3_cameras(bpy.data.collections["05_Lighting_Cameras"])
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    import sys
    only_bay = "--only-bay" in sys.argv
    renders = [] if "--no-render" in sys.argv else render_stage3({"bay_waterfall": cams["bay_waterfall"]} if only_bay else cams)

    report = {
        "ok": True,
        "stage": 3,
        "blend": BLEND_PATH,
        "water_objects": {
            "ocean_polys": len(ocean_obj.data.polygons),
            "lake_polys": len(lake_obj.data.polygons),
            "river_polys": len(river_obj.data.polygons),
            "waterfall_polys": len(wf_obj.data.polygons),
            "plunge_foam_polys": len(plunge_obj.data.polygons),
            "beach_surf_polys": len(surf_obj.data.polygons),
        },
        "materials_count": len(bpy.data.materials),
        "images_count": len(bpy.data.images),
        "renders": renders,
    }
    print("@@JSON@@" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
