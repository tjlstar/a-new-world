"""
Stage 4B: Poly Haven 2K Volcanic Basalt Textures & Photogrammetry Rock Upgrade
- Wires the 4 requested 2K Poly Haven texture sets across the entire island basalt system:
    1. dark_rock       (primary fractured black basalt)
    2. dark_rock_02    (layered lava-flow stratification every ~28m)
    3. lichen_rock     (intertidal wave-splash wet zone & misty upper cloud-forest ledges)
    4. aerial_rocks_04 (80m real-world macro projection to completely eliminate cliff tiling)
- Normalizes, UV-preserving decimates, and basalt-color-grades the 4 imported 2K Poly Haven rock models:
    - boulder_01             -> SM_Rock_PH_Boulder01
    - coast_rocks_05         -> SM_Rock_PH_CoastReef05
    - namaqualand_boulder_03 -> SM_Rock_PH_Boulder03
    - mountainside           -> SM_Rock_PH_CliffOutcrop
  (keeping each model's 2K tangent-space nor_gl + rough maps, with unified desaturation,
   darkening, cool volcanic blue-slate tint, 38% dark_rock albedo blend, and wave-splash wetness).
- Replaces procedural SM_NearshoreReefs_Bay with photogrammetry reef boulders and adds coastal
  basalt talus & flanking cliff outcrops via lightweight Geometry Nodes instancing.
"""
import json
import math
import os
import random
import bpy
import numpy as np
from mathutils import Vector

ROOT_DIR = r"C:\Users\wsbyb\OneDrive\Dokumen\Projects\A new world"
DATA_DIR = os.path.join(ROOT_DIR, "三维", "data")
BLENDER_DIR = os.path.join(ROOT_DIR, "blender")
BLEND_PATH = os.path.join(BLENDER_DIR, "island_env.blend")
PH_TEX_DIR = os.path.join(BLENDER_DIR, "textures", "polyhaven")
RENDER_DIR = os.path.join(BLENDER_DIR, "renders")
EXPORT_UE_DIR = os.path.join(BLENDER_DIR, "export_ue")


def load_ph_image(filename, is_data=False):
    full = os.path.join(PH_TEX_DIR, filename)
    rel = "//textures/polyhaven/" + filename
    base = os.path.splitext(filename)[0]
    for img in bpy.data.images:
        if os.path.basename(bpy.path.abspath(img.filepath)).lower() == filename.lower() or img.name.lower() == base.lower():
            img.filepath = rel
            img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
            return img
    img = bpy.data.images.load(full, check_existing=True)
    img.filepath = rel
    img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
    return img


def find_layer_collection(layer_col, target_col):
    if layer_col.collection == target_col:
        return layer_col
    for child in layer_col.children:
        found = find_layer_collection(child, target_col)
        if found is not None:
            return found
    return None


def link_only_to(obj, target_col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    target_col.objects.link(obj)


def make_box_tex(nt, img, vec_sock, blend=0.28):
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.projection = "BOX"
    node.projection_blend = blend
    nt.links.new(vec_sock, node.inputs["Vector"])
    return node


def build_basalt_4map_nodegroup():
    """Create shared NG_Basalt_4Map_Triplanar combining dark_rock + dark_rock_02 + lichen_rock + aerial_rocks_04."""
    name = "NG_Basalt_4Map_Triplanar"
    old = bpy.data.node_groups.get(name)
    if old is not None:
        bpy.data.node_groups.remove(old)

    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    ng.interface.new_socket("Detail Scale", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 1.0
    ng.interface.new_socket("Wet Height", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 12.0
    ng.interface.new_socket("Lichen Boost", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 1.0
    ng.interface.new_socket("Bump Strength", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 0.72
    ng.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    ng.interface.new_socket("Roughness", in_out="OUTPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Normal", in_out="OUTPUT", socket_type="NodeSocketVector")

    nt = ng
    gin = nt.nodes.new("NodeGroupInput")
    gout = nt.nodes.new("NodeGroupOutput")

    # Load all 4 Poly Haven 2K sets
    dr_d = load_ph_image("dark_rock_Diffuse.jpg", is_data=False)
    dr_r = load_ph_image("dark_rock_Rough.jpg", is_data=True)
    dr_h = load_ph_image("dark_rock_Displacement.jpg", is_data=True)

    dr2_d = load_ph_image("dark_rock_02_Diffuse.jpg", is_data=False)
    dr2_r = load_ph_image("dark_rock_02_Rough.jpg", is_data=True)
    dr2_h = load_ph_image("dark_rock_02_Displacement.jpg", is_data=True)

    lic_d = load_ph_image("lichen_rock_Diffuse.jpg", is_data=False)
    lic_r = load_ph_image("lichen_rock_Rough.jpg", is_data=True)
    lic_h = load_ph_image("lichen_rock_Displacement.jpg", is_data=True)

    aer_d = load_ph_image("aerial_rocks_04_Diffuse.jpg", is_data=False)
    aer_r = load_ph_image("aerial_rocks_04_Rough.jpg", is_data=True)
    aer_h = load_ph_image("aerial_rocks_04_Displacement.jpg", is_data=True)

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Position"], sep_pos.inputs["Vector"])
    sep_nrm = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Normal"], sep_nrm.inputs["Vector"])

    # World-space scaled vectors (using Detail Scale input)
    def scaled_world(base_scale, z_stretch=1.0, offset=(0.0, 0.0, 0.0)):
        vmul = nt.nodes.new("ShaderNodeVectorMath")
        vmul.operation = "MULTIPLY"
        nt.links.new(geom.outputs["Position"], vmul.inputs[0])
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MULTIPLY"; mx.inputs[1].default_value = base_scale
        my = nt.nodes.new("ShaderNodeMath"); my.operation = "MULTIPLY"; my.inputs[1].default_value = base_scale
        mz = nt.nodes.new("ShaderNodeMath"); mz.operation = "MULTIPLY"; mz.inputs[1].default_value = base_scale * z_stretch
        for m in (mx, my, mz):
            nt.links.new(gin.outputs["Detail Scale"], m.inputs[0])
        nt.links.new(mx.outputs[0], comb.inputs["X"])
        nt.links.new(my.outputs[0], comb.inputs["Y"])
        nt.links.new(mz.outputs[0], comb.inputs["Z"])
        nt.links.new(comb.outputs["Vector"], vmul.inputs[1])
        if offset != (0.0, 0.0, 0.0):
            vadd = nt.nodes.new("ShaderNodeVectorMath")
            vadd.operation = "ADD"
            vadd.inputs[1].default_value = offset
            nt.links.new(vmul.outputs["Vector"], vadd.inputs[0])
            return vadd.outputs["Vector"]
        return vmul.outputs["Vector"]

    # 1) dark_rock (~6.5m tile), 2) dark_rock_02 (~5.2m tile), 3) lichen_rock (~4.2m tile), 4) aerial_rocks_04 (80m macro!)
    vec_dr = scaled_world(0.155)
    vec_dr2 = scaled_world(0.192, z_stretch=1.18, offset=(13.7, -9.4, 5.1))
    vec_lic = scaled_world(0.235, offset=(-4.2, 7.8, 2.3))

    map_aer = nt.nodes.new("ShaderNodeMapping")
    map_aer.inputs["Scale"].default_value = (0.0125, 0.0125, 0.0125)  # exact 80m x 80m macro scale
    nt.links.new(geom.outputs["Position"], map_aer.inputs["Vector"])
    vec_aer = map_aer.outputs["Vector"]

    t_dr_d = make_box_tex(nt, dr_d, vec_dr)
    t_dr_r = make_box_tex(nt, dr_r, vec_dr)
    t_dr_h = make_box_tex(nt, dr_h, vec_dr)

    t_dr2_d = make_box_tex(nt, dr2_d, vec_dr2)
    t_dr2_r = make_box_tex(nt, dr2_r, vec_dr2)
    t_dr2_h = make_box_tex(nt, dr2_h, vec_dr2)

    t_lic_d = make_box_tex(nt, lic_d, vec_lic)
    t_lic_r = make_box_tex(nt, lic_r, vec_lic)
    t_lic_h = make_box_tex(nt, lic_h, vec_lic)

    t_aer_d = make_box_tex(nt, aer_d, vec_aer, blend=0.35)
    t_aer_r = make_box_tex(nt, aer_r, vec_aer, blend=0.35)
    t_aer_h = make_box_tex(nt, aer_h, vec_aer, blend=0.35)

    # ── Organic geological lava-flow strata mask (broad irregular 30-50m layers, no zebra striping!) ──
    strata_wave = nt.nodes.new("ShaderNodeTexWave")
    strata_wave.wave_type = "BANDS"
    strata_wave.bands_direction = "Z"
    strata_wave.wave_profile = "SIN"
    strata_wave.inputs["Scale"].default_value = 0.011
    strata_wave.inputs["Distortion"].default_value = 10.5
    strata_wave.inputs["Detail"].default_value = 4.0
    strata_wave.inputs["Detail Scale"].default_value = 1.8
    nt.links.new(geom.outputs["Position"], strata_wave.inputs["Vector"])

    strata_n = nt.nodes.new("ShaderNodeTexNoise")
    strata_n.inputs["Scale"].default_value = 0.0075
    strata_n.inputs["Detail"].default_value = 3.0
    nt.links.new(geom.outputs["Position"], strata_n.inputs["Vector"])

    strata_comb = nt.nodes.new("ShaderNodeMath")
    strata_comb.operation = "MULTIPLY"
    nt.links.new(strata_wave.outputs["Fac"], strata_comb.inputs[0])
    nt.links.new(strata_n.outputs["Fac"], strata_comb.inputs[1])

    strata_mask = nt.nodes.new("ShaderNodeMapRange")
    strata_mask.interpolation_type = "SMOOTHSTEP"
    strata_mask.inputs["From Min"].default_value = 0.14
    strata_mask.inputs["From Max"].default_value = 0.48
    nt.links.new(strata_comb.outputs[0], strata_mask.inputs["Value"])

    # Mix dark_rock + dark_rock_02 (albedo, roughness, height)
    mix_d12 = nt.nodes.new("ShaderNodeMix")
    mix_d12.data_type = "RGBA"
    nt.links.new(strata_mask.outputs["Result"], mix_d12.inputs["Factor"])
    nt.links.new(t_dr_d.outputs["Color"], mix_d12.inputs[6])
    nt.links.new(t_dr2_d.outputs["Color"], mix_d12.inputs[7])

    mix_r12 = nt.nodes.new("ShaderNodeMix")
    mix_r12.data_type = "FLOAT"
    nt.links.new(strata_mask.outputs["Result"], mix_r12.inputs["Factor"])
    nt.links.new(t_dr_r.outputs["Color"], mix_r12.inputs[2])
    nt.links.new(t_dr2_r.outputs["Color"], mix_r12.inputs[3])

    mix_h12 = nt.nodes.new("ShaderNodeMix")
    mix_h12.data_type = "FLOAT"
    nt.links.new(strata_mask.outputs["Result"], mix_h12.inputs["Factor"])
    nt.links.new(t_dr_h.outputs["Color"], mix_h12.inputs[2])
    nt.links.new(t_dr2_h.outputs["Color"], mix_h12.inputs[3])

    # ── Grade aerial_rocks_04 (80m anti-tiling macro) to match volcanic dark basalt and blend in ──
    aer_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    aer_hsv.inputs["Saturation"].default_value = 0.25
    aer_hsv.inputs["Value"].default_value = 0.55
    nt.links.new(t_aer_d.outputs["Color"], aer_hsv.inputs["Color"])

    mix_macro = nt.nodes.new("ShaderNodeMix")
    mix_macro.data_type = "RGBA"
    mix_macro.inputs["Factor"].default_value = 0.44
    nt.links.new(mix_d12.outputs[2], mix_macro.inputs[6])
    nt.links.new(aer_hsv.outputs["Color"], mix_macro.inputs[7])

    # Unified cold charcoal-slate volcanic basalt color grade
    base_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    base_hsv.inputs["Saturation"].default_value = 0.28
    base_hsv.inputs["Value"].default_value = 0.62
    nt.links.new(mix_macro.outputs[2], base_hsv.inputs["Color"])

    cool_tint = nt.nodes.new("ShaderNodeMix")
    cool_tint.data_type = "RGBA"
    cool_tint.blend_type = "MULTIPLY"
    cool_tint.inputs["Factor"].default_value = 1.0
    cool_tint.inputs[7].default_value = (0.76, 0.85, 0.98, 1.0)
    nt.links.new(base_hsv.outputs["Color"], cool_tint.inputs[6])

    # Vertical rainwater dark streaks on sheer cliffs (per 岛屿设定.md §5.2)
    map_rain = nt.nodes.new("ShaderNodeMapping")
    map_rain.inputs["Scale"].default_value = (0.042, 0.042, 0.0055)
    nt.links.new(geom.outputs["Position"], map_rain.inputs["Vector"])
    rain_n = nt.nodes.new("ShaderNodeTexNoise")
    rain_n.inputs["Scale"].default_value = 1.2
    rain_n.inputs["Detail"].default_value = 4.0
    rain_n.inputs["Roughness"].default_value = 0.6
    nt.links.new(map_rain.outputs["Vector"], rain_n.inputs["Vector"])
    rain_r = nt.nodes.new("ShaderNodeMapRange")
    rain_r.inputs["From Min"].default_value = 0.35
    rain_r.inputs["From Max"].default_value = 0.72
    rain_r.inputs["To Min"].default_value = 0.72
    rain_r.inputs["To Max"].default_value = 1.08
    nt.links.new(rain_n.outputs["Fac"], rain_r.inputs["Value"])

    basalt_streaked = nt.nodes.new("ShaderNodeMix")
    basalt_streaked.data_type = "RGBA"
    basalt_streaked.blend_type = "MULTIPLY"
    basalt_streaked.inputs["Factor"].default_value = 1.0
    nt.links.new(cool_tint.outputs[2], basalt_streaked.inputs[6])
    nt.links.new(rain_r.outputs["Result"], basalt_streaked.inputs[7])

    # ── Lichen Rock layer: (A) misty high-altitude ledges (Z > 105m & Nz > 0.30), (B) wave-splash belt (Z < Wet Height) ──
    lic_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    lic_hsv.inputs["Hue"].default_value = 0.49
    lic_hsv.inputs["Saturation"].default_value = 0.48
    lic_hsv.inputs["Value"].default_value = 0.42
    nt.links.new(t_lic_d.outputs["Color"], lic_hsv.inputs["Color"])

    lic_tint = nt.nodes.new("ShaderNodeMix")
    lic_tint.data_type = "RGBA"
    lic_tint.blend_type = "MULTIPLY"
    lic_tint.inputs["Factor"].default_value = 1.0
    lic_tint.inputs[7].default_value = (0.70, 0.84, 0.78, 1.0)
    nt.links.new(lic_hsv.outputs["Color"], lic_tint.inputs[6])

    # (A) Misty upper cloud-forest lichen mask
    high_z = nt.nodes.new("ShaderNodeMapRange")
    high_z.interpolation_type = "SMOOTHSTEP"
    high_z.inputs["From Min"].default_value = 95.0
    high_z.inputs["From Max"].default_value = 195.0
    nt.links.new(sep_pos.outputs["Z"], high_z.inputs["Value"])

    up_face = nt.nodes.new("ShaderNodeMapRange")
    up_face.interpolation_type = "SMOOTHSTEP"
    up_face.inputs["From Min"].default_value = 0.25
    up_face.inputs["From Max"].default_value = 0.72
    nt.links.new(sep_nrm.outputs["Z"], up_face.inputs["Value"])

    lic_noise = nt.nodes.new("ShaderNodeTexNoise")
    lic_noise.inputs["Scale"].default_value = 0.025
    lic_noise.inputs["Detail"].default_value = 4.0
    nt.links.new(geom.outputs["Position"], lic_noise.inputs["Vector"])
    lic_n_r = nt.nodes.new("ShaderNodeMapRange")
    lic_n_r.interpolation_type = "SMOOTHSTEP"
    lic_n_r.inputs["From Min"].default_value = 0.36
    lic_n_r.inputs["From Max"].default_value = 0.68
    nt.links.new(lic_noise.outputs["Fac"], lic_n_r.inputs["Value"])

    m_high1 = nt.nodes.new("ShaderNodeMath"); m_high1.operation = "MULTIPLY"
    nt.links.new(high_z.outputs["Result"], m_high1.inputs[0])
    nt.links.new(up_face.outputs["Result"], m_high1.inputs[1])
    m_high2 = nt.nodes.new("ShaderNodeMath"); m_high2.operation = "MULTIPLY"
    nt.links.new(m_high1.outputs[0], m_high2.inputs[0])
    nt.links.new(lic_n_r.outputs["Result"], m_high2.inputs[1])

    # (B) Coastal wave-splash damp lichen zone (Z <= Wet Height)
    splash_z = nt.nodes.new("ShaderNodeMapRange")
    splash_z.interpolation_type = "SMOOTHSTEP"
    splash_z.inputs["From Min"].default_value = 16.0
    splash_z.inputs["From Max"].default_value = 0.5
    nt.links.new(gin.outputs["Wet Height"], splash_z.inputs["From Min"])
    nt.links.new(sep_pos.outputs["Z"], splash_z.inputs["Value"])

    splash_lic = nt.nodes.new("ShaderNodeMath"); splash_lic.operation = "MULTIPLY"
    splash_lic.inputs[1].default_value = 0.58
    nt.links.new(splash_z.outputs["Result"], splash_lic.inputs[0])

    lic_comb = nt.nodes.new("ShaderNodeMath"); lic_comb.operation = "MAXIMUM"
    nt.links.new(m_high2.outputs[0], lic_comb.inputs[0])
    nt.links.new(splash_lic.outputs[0], lic_comb.inputs[1])

    lic_final_fac = nt.nodes.new("ShaderNodeMath"); lic_final_fac.operation = "MULTIPLY"
    lic_final_fac.use_clamp = True
    nt.links.new(lic_comb.outputs[0], lic_final_fac.inputs[0])
    nt.links.new(gin.outputs["Lichen Boost"], lic_final_fac.inputs[1])

    col_with_lic = nt.nodes.new("ShaderNodeMix")
    col_with_lic.data_type = "RGBA"
    nt.links.new(lic_final_fac.outputs[0], col_with_lic.inputs["Factor"])
    nt.links.new(basalt_streaked.outputs[2], col_with_lic.inputs[6])
    nt.links.new(lic_tint.outputs[2], col_with_lic.inputs[7])

    # Wave-splash waterline wet darkening (darkens submerged & surf-splashed base)
    wet_col = nt.nodes.new("ShaderNodeMix")
    wet_col.data_type = "RGBA"
    wet_col.blend_type = "MULTIPLY"
    wet_col.inputs[7].default_value = (0.44, 0.48, 0.54, 1.0)
    nt.links.new(splash_z.outputs["Result"], wet_col.inputs["Factor"])
    nt.links.new(col_with_lic.outputs[2], wet_col.inputs[6])

    # ── Roughness chain: (dark_rock/02 + aerial macro + lichen) -> wet glossy drop at surf line ──
    r_macro = nt.nodes.new("ShaderNodeMix")
    r_macro.data_type = "FLOAT"
    r_macro.inputs["Factor"].default_value = 0.32
    nt.links.new(mix_r12.outputs[0], r_macro.inputs[2])
    nt.links.new(t_aer_r.outputs["Color"], r_macro.inputs[3])

    r_lic = nt.nodes.new("ShaderNodeMix")
    r_lic.data_type = "FLOAT"
    nt.links.new(lic_final_fac.outputs[0], r_lic.inputs["Factor"])
    nt.links.new(r_macro.outputs[0], r_lic.inputs[2])
    nt.links.new(t_lic_r.outputs["Color"], r_lic.inputs[3])

    r_dry = nt.nodes.new("ShaderNodeMapRange")
    r_dry.inputs["From Min"].default_value = 0.0
    r_dry.inputs["From Max"].default_value = 1.0
    r_dry.inputs["To Min"].default_value = 0.66
    r_dry.inputs["To Max"].default_value = 0.94
    nt.links.new(r_lic.outputs[0], r_dry.inputs["Value"])

    r_wet = nt.nodes.new("ShaderNodeMix")
    r_wet.data_type = "FLOAT"
    r_wet.inputs[3].default_value = 0.24
    nt.links.new(splash_z.outputs["Result"], r_wet.inputs["Factor"])
    nt.links.new(r_dry.outputs["Result"], r_wet.inputs[2])

    # ── Multi-scale Bump chain (Detail Displacement + Lichen Displacement + 80m Aerial Macro) ──
    h_with_lic = nt.nodes.new("ShaderNodeMix")
    h_with_lic.data_type = "FLOAT"
    nt.links.new(lic_final_fac.outputs[0], h_with_lic.inputs["Factor"])
    nt.links.new(mix_h12.outputs[0], h_with_lic.inputs[2])
    nt.links.new(t_lic_h.outputs["Color"], h_with_lic.inputs[3])

    bump_macro = nt.nodes.new("ShaderNodeBump")
    bump_macro.inputs["Strength"].default_value = 0.45
    bump_macro.inputs["Distance"].default_value = 1.2
    nt.links.new(t_aer_h.outputs["Color"], bump_macro.inputs["Height"])

    bump_det = nt.nodes.new("ShaderNodeBump")
    bump_det.inputs["Distance"].default_value = 0.28
    nt.links.new(gin.outputs["Bump Strength"], bump_det.inputs["Strength"])
    nt.links.new(h_with_lic.outputs[0], bump_det.inputs["Height"])
    nt.links.new(bump_macro.outputs["Normal"], bump_det.inputs["Normal"])

    nt.links.new(wet_col.outputs[2], gout.inputs["Color"])
    nt.links.new(r_wet.outputs[0], gout.inputs["Roughness"])
    nt.links.new(bump_det.outputs["Normal"], gout.inputs["Normal"])
    return ng


def upgrade_hero_basalt_materials(ng_basalt):
    """Upgrade M_Hero_Basalt_Dark, M_Buoy_ReefRock, and M_Reef_Basalt_Wet to use NG_Basalt_4Map_Triplanar."""
    configs = [
        ("M_Hero_Basalt_Dark", 1.0, 14.0, 0.90, 0.78),
        ("M_Buoy_ReefRock", 2.2, 2.5, 0.65, 0.72),
        ("M_Reef_Basalt_Wet", 1.8, 6.5, 0.85, 0.80),
    ]
    for mat_name, d_scale, wet_h, lic_b, bump_s in configs:
        mat = bpy.data.materials.get(mat_name)
        if mat is None:
            mat = bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.42

        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = ng_basalt
        grp.inputs["Detail Scale"].default_value = d_scale
        grp.inputs["Wet Height"].default_value = wet_h
        grp.inputs["Lichen Boost"].default_value = lic_b
        grp.inputs["Bump Strength"].default_value = bump_s

        nt.links.new(grp.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(grp.outputs["Roughness"], bsdf.inputs["Roughness"])
        nt.links.new(grp.outputs["Normal"], bsdf.inputs["Normal"])
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])


def upgrade_terrain_basalt_branch(ng_basalt):
    """Upgrade M_Island_Terrain_PBR's basalt cliff branch to NG_Basalt_4Map_Triplanar while keeping forest/shore/beach intact."""
    mat = bpy.data.materials.get("M_Island_Terrain_PBR")
    if mat is None or not mat.node_tree:
        return
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

    # Rebuild cleanly by wiring NG_Basalt_4Map_Triplanar into the base of the existing layer chain
    # Locate the first forest mix nodes (they take basalt color / roughness / normal as input A)
    # To be 100% deterministic and zero-orphan, rebuild M_Island_Terrain_PBR cleanly reusing its local sand & forest textures.
    assets_tex = os.path.join(ROOT_DIR, "三维", "assets", "textures")

    def load_local_tex(fname, is_data=False):
        full = os.path.join(assets_tex, fname)
        for img in bpy.data.images:
            if os.path.basename(bpy.path.abspath(img.filepath)).lower() == fname.lower():
                img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
                return img
        img = bpy.data.images.load(full, check_existing=True)
        img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
        return img

    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.42
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Position"], sep_pos.inputs["Vector"])

    # Attributes from SM_Island_Terrain
    a_slope = nt.nodes.new("ShaderNodeAttribute"); a_slope.attribute_name = "ENV_Slope"
    a_forest = nt.nodes.new("ShaderNodeAttribute"); a_forest.attribute_name = "Mask_Forest_Smooth"
    a_meadow = nt.nodes.new("ShaderNodeAttribute"); a_meadow.attribute_name = "Mask_Meadow_Smooth"
    a_sand = nt.nodes.new("ShaderNodeAttribute"); a_sand.attribute_name = "Mask_WhiteSand_Smooth"

    # 1) 4-Map Poly Haven Volcanic Basalt Base
    grp_bas = nt.nodes.new("ShaderNodeGroup")
    grp_bas.node_tree = ng_basalt
    grp_bas.inputs["Detail Scale"].default_value = 0.85
    grp_bas.inputs["Wet Height"].default_value = 14.0
    grp_bas.inputs["Lichen Boost"].default_value = 1.0
    grp_bas.inputs["Bump Strength"].default_value = 0.78

    # 2) Tropical Cloud Forest Ground Layer
    map_for = nt.nodes.new("ShaderNodeMapping")
    map_for.inputs["Scale"].default_value = (0.14, 0.14, 0.14)
    nt.links.new(geom.outputs["Position"], map_for.inputs["Vector"])
    t_for_d = make_box_tex(nt, load_local_tex("forest_ground_04_diff_1k.jpg", False), map_for.outputs["Vector"], 0.25)
    t_for_r = make_box_tex(nt, load_local_tex("forest_ground_04_rough_1k.jpg", True), map_for.outputs["Vector"], 0.25)

    for_tint = nt.nodes.new("ShaderNodeMix")
    for_tint.data_type = "RGBA"
    for_tint.blend_type = "MULTIPLY"
    for_tint.inputs["Factor"].default_value = 1.0
    for_tint.inputs[7].default_value = (0.18, 0.42, 0.14, 1.0)
    nt.links.new(t_for_d.outputs["Color"], for_tint.inputs[6])

    for_rough = nt.nodes.new("ShaderNodeMapRange")
    for_rough.inputs["To Min"].default_value = 0.84
    for_rough.inputs["To Max"].default_value = 0.96
    nt.links.new(t_for_r.outputs["Color"], for_rough.inputs["Value"])

    # 3) Humid Lakeside Sedge Shore Layer (Option C fresh lush green)
    shore_tint = nt.nodes.new("ShaderNodeMix")
    shore_tint.data_type = "RGBA"
    shore_tint.blend_type = "MULTIPLY"
    shore_tint.inputs["Factor"].default_value = 1.0
    shore_tint.inputs[7].default_value = (0.36, 0.72, 0.28, 1.0)
    nt.links.new(t_for_d.outputs["Color"], shore_tint.inputs[6])

    # 4) White Sand Beach Layer (dry bright coral-white -> glossy wet sand)
    map_sand = nt.nodes.new("ShaderNodeMapping")
    map_sand.inputs["Scale"].default_value = (0.28, 0.28, 0.28)
    nt.links.new(geom.outputs["Position"], map_sand.inputs["Vector"])
    t_sand_d = make_box_tex(nt, load_local_tex("coast_sand_03_diff_1k.jpg", False), map_sand.outputs["Vector"], 0.25)
    t_sand_r = make_box_tex(nt, load_local_tex("coast_sand_03_rough_1k.jpg", True), map_sand.outputs["Vector"], 0.25)

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
    sand_col.inputs[7].default_value = (0.58, 0.56, 0.52, 1.0)
    nt.links.new(sand_wet.outputs["Result"], sand_col.inputs["Factor"])
    nt.links.new(sand_hsv.outputs["Color"], sand_col.inputs[6])

    sand_r_dry = nt.nodes.new("ShaderNodeMapRange")
    sand_r_dry.inputs["To Min"].default_value = 0.78
    sand_r_dry.inputs["To Max"].default_value = 0.94
    nt.links.new(t_sand_r.outputs["Color"], sand_r_dry.inputs["Value"])

    sand_rough = nt.nodes.new("ShaderNodeMix")
    sand_rough.data_type = "FLOAT"
    sand_rough.inputs[3].default_value = 0.22
    nt.links.new(sand_wet.outputs["Result"], sand_rough.inputs["Factor"])
    nt.links.new(sand_r_dry.outputs["Result"], sand_rough.inputs[2])

    # Layer masks: sheer cliffs (>50 deg) always stay exposed volcanic basalt
    flat_mask = nt.nodes.new("ShaderNodeMapRange")
    flat_mask.interpolation_type = "SMOOTHSTEP"
    flat_mask.inputs["From Min"].default_value = 0.62
    flat_mask.inputs["From Max"].default_value = 0.36
    nt.links.new(a_slope.outputs["Fac"], flat_mask.inputs["Value"])

    fw = nt.nodes.new("ShaderNodeMath"); fw.operation = "MULTIPLY"
    nt.links.new(a_forest.outputs["Fac"], fw.inputs[0])
    nt.links.new(flat_mask.outputs["Result"], fw.inputs[1])

    mw = nt.nodes.new("ShaderNodeMath"); mw.operation = "MULTIPLY"
    nt.links.new(a_meadow.outputs["Fac"], mw.inputs[0])
    nt.links.new(flat_mask.outputs["Result"], mw.inputs[1])

    # Color chain: 4-Map Basalt -> Forest -> Lakeside Sedge -> White Sand
    c1 = nt.nodes.new("ShaderNodeMix"); c1.data_type = "RGBA"
    nt.links.new(fw.outputs[0], c1.inputs["Factor"])
    nt.links.new(grp_bas.outputs["Color"], c1.inputs[6])
    nt.links.new(for_tint.outputs[2], c1.inputs[7])

    c2 = nt.nodes.new("ShaderNodeMix"); c2.data_type = "RGBA"
    nt.links.new(mw.outputs[0], c2.inputs["Factor"])
    nt.links.new(c1.outputs[2], c2.inputs[6])
    nt.links.new(shore_tint.outputs[2], c2.inputs[7])

    c3 = nt.nodes.new("ShaderNodeMix"); c3.data_type = "RGBA"
    nt.links.new(a_sand.outputs["Fac"], c3.inputs["Factor"])
    nt.links.new(c2.outputs[2], c3.inputs[6])
    nt.links.new(sand_col.outputs[2], c3.inputs[7])

    # Roughness chain
    r1 = nt.nodes.new("ShaderNodeMix"); r1.data_type = "FLOAT"
    nt.links.new(fw.outputs[0], r1.inputs["Factor"])
    nt.links.new(grp_bas.outputs["Roughness"], r1.inputs[2])
    nt.links.new(for_rough.outputs["Result"], r1.inputs[3])

    r2 = nt.nodes.new("ShaderNodeMix"); r2.data_type = "FLOAT"
    nt.links.new(a_sand.outputs["Fac"], r2.inputs["Factor"])
    nt.links.new(r1.outputs[0], r2.inputs[2])
    nt.links.new(sand_rough.outputs[0], r2.inputs[3])

    # Smooth sand normal fade (suppresses rock bump on sandy beach)
    sand_n_inv = nt.nodes.new("ShaderNodeMath"); sand_n_inv.operation = "SUBTRACT"
    sand_n_inv.inputs[0].default_value = 1.0
    nt.links.new(a_sand.outputs["Fac"], sand_n_inv.inputs[1])
    n_mix = nt.nodes.new("ShaderNodeMix"); n_mix.data_type = "VECTOR"
    nt.links.new(a_sand.outputs["Fac"], n_mix.inputs["Factor"])
    nt.links.new(grp_bas.outputs["Normal"], n_mix.inputs[4])
    nt.links.new(geom.outputs["Normal"], n_mix.inputs[5])

    nt.links.new(c3.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(r2.outputs[0], bsdf.inputs["Roughness"])
    nt.links.new(n_mix.outputs[1], bsdf.inputs["Normal"])


def make_tuned_ph_rock_material(mat_name, diff_file, rough_file, nor_file):
    """Build unified cold volcanic basalt shader preserving Poly Haven model's 2K UV normal & rough maps."""
    old = bpy.data.materials.get(mat_name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.42

    tc = nt.nodes.new("ShaderNodeTexCoord")
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    sep_pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geom.outputs["Position"], sep_pos.inputs["Vector"])

    # Model's own 2K UV maps (albedo, rough, tangent-space nor_gl)
    t_diff = nt.nodes.new("ShaderNodeTexImage")
    t_diff.image = load_ph_image(diff_file, is_data=False)
    nt.links.new(tc.outputs["UV"], t_diff.inputs["Vector"])

    t_rough = nt.nodes.new("ShaderNodeTexImage")
    t_rough.image = load_ph_image(rough_file, is_data=True)
    nt.links.new(tc.outputs["UV"], t_rough.inputs["Vector"])

    t_nor = nt.nodes.new("ShaderNodeTexImage")
    t_nor.image = load_ph_image(nor_file, is_data=True)
    nt.links.new(tc.outputs["UV"], t_nor.inputs["Vector"])

    # Color grade: desaturate + darken + cool volcanic blue-slate tint (per user guidance)
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 0.22
    hsv.inputs["Value"].default_value = 0.34
    nt.links.new(t_diff.outputs["Color"], hsv.inputs["Color"])

    cool = nt.nodes.new("ShaderNodeMix")
    cool.data_type = "RGBA"
    cool.blend_type = "MULTIPLY"
    cool.inputs["Factor"].default_value = 1.0
    cool.inputs[7].default_value = (0.74, 0.85, 0.98, 1.0)
    nt.links.new(hsv.outputs["Color"], cool.inputs[6])

    # Blend 38% world-space dark_rock albedo for seamless island basalt cohesion
    map_dr = nt.nodes.new("ShaderNodeMapping")
    map_dr.inputs["Scale"].default_value = (0.22, 0.22, 0.22)
    nt.links.new(geom.outputs["Position"], map_dr.inputs["Vector"])
    t_dr = make_box_tex(nt, load_ph_image("dark_rock_Diffuse.jpg", is_data=False), map_dr.outputs["Vector"])

    dr_hsv = nt.nodes.new("ShaderNodeHueSaturation")
    dr_hsv.inputs["Saturation"].default_value = 0.26
    dr_hsv.inputs["Value"].default_value = 0.56
    nt.links.new(t_dr.outputs["Color"], dr_hsv.inputs["Color"])

    blended = nt.nodes.new("ShaderNodeMix")
    blended.data_type = "RGBA"
    blended.inputs["Factor"].default_value = 0.38
    nt.links.new(cool.outputs[2], blended.inputs[6])
    nt.links.new(dr_hsv.outputs["Color"], blended.inputs[7])

    # Wave-splash wet darkening & glossy sheen below Z = +4.5m
    wet_mask = nt.nodes.new("ShaderNodeMapRange")
    wet_mask.interpolation_type = "SMOOTHSTEP"
    wet_mask.inputs["From Min"].default_value = 5.5
    wet_mask.inputs["From Max"].default_value = 0.2
    nt.links.new(sep_pos.outputs["Z"], wet_mask.inputs["Value"])

    wet_col = nt.nodes.new("ShaderNodeMix")
    wet_col.data_type = "RGBA"
    wet_col.blend_type = "MULTIPLY"
    wet_col.inputs[7].default_value = (0.48, 0.52, 0.58, 1.0)
    nt.links.new(wet_mask.outputs["Result"], wet_col.inputs["Factor"])
    nt.links.new(blended.outputs[2], wet_col.inputs[6])

    r_dry = nt.nodes.new("ShaderNodeMapRange")
    r_dry.inputs["To Min"].default_value = 0.62
    r_dry.inputs["To Max"].default_value = 0.90
    nt.links.new(t_rough.outputs["Color"], r_dry.inputs["Value"])

    r_wet = nt.nodes.new("ShaderNodeMix")
    r_wet.data_type = "FLOAT"
    r_wet.inputs[3].default_value = 0.22
    nt.links.new(wet_mask.outputs["Result"], r_wet.inputs["Factor"])
    nt.links.new(r_dry.outputs["Result"], r_wet.inputs[2])

    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 1.0
    nt.links.new(t_nor.outputs["Color"], nmap.inputs["Color"])

    nt.links.new(wet_col.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(r_wet.outputs[0], bsdf.inputs["Roughness"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def prepare_polyhaven_rock_prototypes(col_hero):
    """Normalize, decimate (UV-preserving), and grade the 4 Poly Haven 2K rock models into 02_RockSrc_PolyHaven."""
    col_src = bpy.data.collections.get("02_RockSrc_PolyHaven")
    if col_src is None:
        col_src = bpy.data.collections.new("02_RockSrc_PolyHaven")
        col_hero.children.link(col_src)
    lc = find_layer_collection(bpy.context.view_layer.layer_collection, col_src)
    if lc is not None:
        lc.exclude = True

    specs = [
        ("boulder_01_LOD0", "SM_Rock_PH_Boulder01", "M_PH_Basalt_Boulder01",
         "boulder_01_diff.jpg", "boulder_01_rough.exr", "boulder_01_nor_gl.exr", 3800),
        ("coast_rocks_05_LOD0", "SM_Rock_PH_CoastReef05", "M_PH_Basalt_CoastReef05",
         "coast_rocks_05_diff.jpg", "coast_rocks_05_rough.exr", "coast_rocks_05_nor_gl.exr", 5500),
        ("namaqualand_boulder_03_LOD0", "SM_Rock_PH_Boulder03", "M_PH_Basalt_Boulder03",
         "namaqualand_boulder_03_diff.jpg", "namaqualand_boulder_03_rough.exr", "namaqualand_boulder_03_nor_gl.exr", 3800),
        ("mountainside_LOD0", "SM_Rock_PH_CliffOutcrop", "M_PH_Basalt_CliffOutcrop",
         "mountainside_diff.jpg", "mountainside_rough.exr", "mountainside_nor_gl.exr", 8500),
    ]

    protos = {}
    for raw_name, target_name, mat_name, df, rf, nf, target_tris in specs:
        mat = make_tuned_ph_rock_material(mat_name, df, rf, nf)
        src = bpy.data.objects.get(target_name)
        raw = bpy.data.objects.get(raw_name)
        if raw is not None:
            if src is not None and src != raw:
                bpy.data.objects.remove(src, do_unlink=True)
            obj = raw
            obj.name = target_name
            obj.data.name = target_name
        elif src is not None:
            obj = src
        else:
            raise RuntimeError(f"Missing Poly Haven model {raw_name} / {target_name}")

        # Temporarily ensure accessible in view layer for decimate apply
        link_only_to(obj, col_hero)
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)

        # Decimate heavy photogrammetry LOD0 cleanly (preserving UVs & silhouette)
        cur_polys = len(obj.data.polygons)
        if cur_polys > target_tris * 1.15:
            ratio = max(0.005, min(1.0, target_tris / float(cur_polys)))
            mod = obj.modifiers.new("Decimate_Game", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            for o in bpy.context.selected_objects:
                o.select_set(False)
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            with bpy.context.temp_override(active_object=obj, selected_objects=[obj], object=obj):
                bpy.ops.object.modifier_apply(modifier=mod.name)

        # Normalize pivot to center-XY, bottom Z=0 (for grounded placement)
        verts = obj.data.vertices
        co = np.empty(len(verts) * 3, dtype=np.float32)
        verts.foreach_get("co", co)
        co = co.reshape(-1, 3)
        cx = 0.5 * (co[:, 0].min() + co[:, 0].max())
        cy = 0.5 * (co[:, 1].min() + co[:, 1].max())
        min_z = float(co[:, 2].min())
        co[:, 0] -= cx
        co[:, 1] -= cy
        co[:, 2] -= min_z
        verts.foreach_set("co", co.ravel())
        obj.data.polygons.foreach_set("use_smooth", np.ones(len(obj.data.polygons), dtype=bool))
        obj.data.update()

        obj.data.materials.clear()
        obj.data.materials.append(mat)
        link_only_to(obj, col_src)
        protos[target_name] = obj

    return col_src, protos


def build_rock_instancer_nodetree(name="GN_Rock_PointInstancer"):
    old = bpy.data.node_groups.get(name)
    if old is not None:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Collection", in_out="INPUT", socket_type="NodeSocketCollection")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    nt = ng
    gin = nt.nodes.new("NodeGroupInput")
    gout = nt.nodes.new("NodeGroupOutput")

    col_info = nt.nodes.new("GeometryNodeCollectionInfo")
    col_info.transform_space = "RELATIVE"
    col_info.inputs["Separate Children"].default_value = True
    col_info.inputs["Reset Children"].default_value = True
    nt.links.new(gin.outputs["Collection"], col_info.inputs["Collection"])

    a_idx = nt.nodes.new("GeometryNodeInputNamedAttribute")
    a_idx.data_type = "INT"
    a_idx.inputs["Name"].default_value = "Rock_Index"

    a_rot = nt.nodes.new("GeometryNodeInputNamedAttribute")
    a_rot.data_type = "FLOAT_VECTOR"
    a_rot.inputs["Name"].default_value = "Rock_Rot"

    a_scl = nt.nodes.new("GeometryNodeInputNamedAttribute")
    a_scl.data_type = "FLOAT_VECTOR"
    a_scl.inputs["Name"].default_value = "Rock_Scale"

    inst = nt.nodes.new("GeometryNodeInstanceOnPoints")
    inst.inputs["Pick Instance"].default_value = True
    nt.links.new(gin.outputs["Geometry"], inst.inputs["Points"])
    nt.links.new(col_info.outputs["Instances"], inst.inputs["Instance"])
    nt.links.new(a_idx.outputs["Attribute"], inst.inputs["Instance Index"])
    nt.links.new(a_rot.outputs["Attribute"], inst.inputs["Rotation"])
    nt.links.new(a_scl.outputs["Attribute"], inst.inputs["Scale"])

    nt.links.new(inst.outputs["Instances"], gout.inputs["Geometry"])
    return ng


def sample_terrain_height(meta, hf, x_m, y_m):
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    gx = (x_m / 1000.0 - float(g["x0"])) / float(g["step"])
    gy = (y_m / 1000.0 - float(g["y0"])) / float(g["step"])
    i = max(0, min(nx - 2, int(math.floor(gx))))
    j = max(0, min(ny - 2, int(math.floor(gy))))
    u, v = max(0.0, min(1.0, gx - i)), max(0.0, min(1.0, gy - j))
    h00 = hf[j * nx + i]; h10 = hf[j * nx + i + 1]
    h01 = hf[(j + 1) * nx + i]; h11 = hf[(j + 1) * nx + i + 1]
    return float(h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v)


def beach_shore_y_m(x_km):
    west, east = -0.265, 0.060
    t = max(0.0, min(1.0, (x_km - west) / (east - west)))
    arc = math.sin(math.pi * t)
    return (
        0.447 - 0.028 * t - 0.032 * arc * arc
        + 0.004 * math.sin(2.0 * math.pi * t)
        - 0.072 * (max(0.0, (t - 0.83) / 0.17) ** 2.4)
    ) * 1000.0


def build_coastal_rock_instances(col_hero, col_src, protos, ng_inst, meta, hf):
    """Replace procedural SM_NearshoreReefs_Bay & add Poly Haven coastal basalt talus/outcrops."""
    # Remove old procedural icosphere reef mesh & previous GN rock objects
    for old_n in ("SM_NearshoreReefs_Bay", "GN_Rocks_NearshoreReefs", "GN_Rocks_CoastalTalus"):
        o = bpy.data.objects.get(old_n)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)

    # Collection children order in Blender is alphabetical by object name!
    # Alphabetical order in 02_RockSrc_PolyHaven:
    #   0: SM_Rock_PH_Boulder01     (dims ~ 1.27 x 1.83 x 1.00)
    #   1: SM_Rock_PH_Boulder03     (dims ~ 2.41 x 3.07 x 1.47)
    #   2: SM_Rock_PH_CliffOutcrop  (dims ~ 10.2 x 5.25 x 10.5)
    #   3: SM_Rock_PH_CoastReef05   (dims ~ 3.04 x 2.82 x 1.00)
    ordered_names = sorted(o.name for o in col_src.objects)
    idx_of = {n: i for i, n in enumerate(ordered_names)}

    rng = random.Random(20261123)
    reef_pts = []    # (x, y, z, rx, ry, rz, sx, sy, sz, idx)
    talus_pts = []

    # ── A) Black Gravel Bay 5 Nearshore Shallow Reef Clusters (strictly seaward of waterline!) ──
    # Matches environment.js 5 cluster centers along White Sand Beach front
    clusters = [
        (-228.0, 26.0, 12),
        (-176.0, 22.0, 14),
        (-112.0, 25.0, 13),
        (-42.0, 22.0, 14),
        (24.0, 20.0, 11),
    ]
    reef_choices = [
        (idx_of["SM_Rock_PH_Boulder01"], 2.1, 4.8, 1.0, 2.0),
        (idx_of["SM_Rock_PH_Boulder03"], 1.5, 3.2, 0.9, 1.7),
        (idx_of["SM_Rock_PH_CoastReef05"], 1.35, 2.9, 1.0, 1.9),
    ]
    for cx, seaward_off, count in clusters:
        shore_y = beach_shore_y_m(cx / 1000.0)
        cy = shore_y + seaward_off
        for k in range(count):
            ang = rng.uniform(0.0, math.tau)
            rad = rng.uniform(0.0, 17.0) * (0.45 if k < 4 else 1.0)
            px = cx + math.cos(ang) * rad * 1.45
            py = cy + math.sin(ang) * rad * 0.65
            # Guarantee strictly seaward of waterline (water depth < -0.35m)
            gz = sample_terrain_height(meta, hf, px, py)
            if gz > -0.35:
                py = beach_shore_y_m(px / 1000.0) + rng.uniform(15.0, 30.0)
                gz = sample_terrain_height(meta, hf, px, py)
            if gz > -0.25:
                continue
            r_idx, s_min, s_max, hz_min, hz_max = rng.choice(reef_choices)
            sx = rng.uniform(s_min, s_max)
            sy = sx * rng.uniform(0.80, 1.22)
            # First 5 rocks in each cluster rise visibly above Z=0 (+0.9..+2.9m exposed wet basalt tops)
            if k < 5:
                base_h = protos[ordered_names[r_idx]].dimensions.z
                target_top = rng.uniform(0.95, 2.95)
                sz = max(hz_min, (target_top - (gz - 0.5)) / max(base_h, 0.5))
            else:
                sz = sx * rng.uniform(hz_min, hz_max) * 0.55
            reef_pts.append((
                px, py, gz - 0.55,
                rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14), rng.uniform(0.0, math.tau),
                sx, sy, sz, r_idx
            ))

    # ── B) Coastal Basalt Talus & Cliff-Foot Outcrops (Curtain Falls flanks, Sword Peak skirt, Reef Flats) ──
    # 1. Curtain Falls bay-head flanking cliff outcrops & collapsed boulders (clear of falls x=101,y=234 and beach!)
    falls_flanks = [
        (56.0, 318.0, 1.8, 2.2, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (68.0, 278.0, 1.5, 1.9, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (148.0, 265.0, 1.9, 2.4, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (162.0, 315.0, 2.0, 2.5, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (185.0, 365.0, 1.7, 2.2, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (-268.0, 445.0, 1.6, 2.1, idx_of["SM_Rock_PH_CliffOutcrop"]),
        (-285.0, 472.0, 1.9, 2.3, idx_of["SM_Rock_PH_CliffOutcrop"]),
    ]
    for fx, fy, s_xy, s_z, r_idx in falls_flanks:
        gz = sample_terrain_height(meta, hf, fx, fy)
        talus_pts.append((
            fx, fy, max(-2.5, gz - 2.2),
            rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), rng.uniform(0.0, math.tau),
            s_xy, s_xy * rng.uniform(0.85, 1.15), s_z, r_idx
        ))

    # 2. South Sword Peak coastal talus boulder skirt (ring around (150, -1620))
    sw_x, sw_y = meta["swordPeak"]["x"] * 1000.0, meta["swordPeak"]["y"] * 1000.0
    sw_rot = float(meta["swordPeak"]["rot"])
    for k in range(28):
        ang = (k / 28.0) * math.tau + rng.uniform(-0.08, 0.08)
        lx = math.cos(ang) * rng.uniform(135.0, 185.0)
        ly = math.sin(ang) * rng.uniform(42.0, 62.0)
        px = sw_x + lx * math.cos(sw_rot) - ly * math.sin(sw_rot)
        py = sw_y + lx * math.sin(sw_rot) + ly * math.cos(sw_rot)
        r_idx = rng.choice([idx_of["SM_Rock_PH_Boulder01"], idx_of["SM_Rock_PH_Boulder03"], idx_of["SM_Rock_PH_CoastReef05"]])
        sc = rng.uniform(3.2, 6.8)
        talus_pts.append((
            px, py, rng.uniform(-3.8, -0.8),
            rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), rng.uniform(0.0, math.tau),
            sc, sc * rng.uniform(0.75, 1.25), sc * rng.uniform(0.85, 1.45), r_idx
        ))

    # 3. West Reef Flat (西礁滩), East Reef Flat (东礁滩), East Canyon mouth (东峡谷), & Sea Arch abutments
    coastal_zones = [
        (-1860.0, 50.0, 70.0, 14),     # 西礁滩
        (1425.0, -100.0, 45.0, 10),    # 东礁滩
        (1185.0, -585.0, 48.0, 10),    # 东峡谷口
        (1372.0, 120.0, 28.0, 6),      # 海蚀拱门西脚
        (1522.0, 120.0, 28.0, 6),      # 海蚀拱门东脚
    ]
    for zx, zy, spread, cnt in coastal_zones:
        for _ in range(cnt):
            px = zx + rng.uniform(-spread, spread)
            py = zy + rng.uniform(-spread, spread)
            gz = sample_terrain_height(meta, hf, px, py)
            if gz < -9.0 or gz > 22.0:
                continue
            r_idx = rng.choice([idx_of["SM_Rock_PH_Boulder01"], idx_of["SM_Rock_PH_Boulder03"], idx_of["SM_Rock_PH_CoastReef05"]])
            sc = rng.uniform(2.4, 5.5)
            talus_pts.append((
                px, py, gz - 1.2,
                rng.uniform(-0.16, 0.16), rng.uniform(-0.16, 0.16), rng.uniform(0.0, math.tau),
                sc, sc * rng.uniform(0.8, 1.25), sc * rng.uniform(0.75, 1.35), r_idx
            ))

    def make_point_cloud_obj(obj_name, pts_list):
        m = bpy.data.meshes.new(obj_name)
        m.vertices.add(len(pts_list))
        coords = np.array([[p[0], p[1], p[2]] for p in pts_list], dtype=np.float32)
        m.vertices.foreach_set("co", coords.ravel())
        a_i = m.attributes.new("Rock_Index", "INT", "POINT")
        a_i.data.foreach_set("value", np.array([p[9] for p in pts_list], dtype=np.int32))
        a_r = m.attributes.new("Rock_Rot", "FLOAT_VECTOR", "POINT")
        a_r.data.foreach_set("vector", np.array([[p[3], p[4], p[5]] for p in pts_list], dtype=np.float32).ravel())
        a_s = m.attributes.new("Rock_Scale", "FLOAT_VECTOR", "POINT")
        a_s.data.foreach_set("vector", np.array([[p[6], p[7], p[8]] for p in pts_list], dtype=np.float32).ravel())
        m.materials.append(bpy.data.materials["M_PH_Basalt_Boulder01"])
        m.update()
        ob = bpy.data.objects.new(obj_name, m)
        link_only_to(ob, col_hero)
        mod = ob.modifiers.new(f"MOD_{obj_name}", "NODES")
        mod.node_group = ng_inst
        by_name = {s.name: s.identifier for s in ng_inst.interface.items_tree if getattr(s, "in_out", "") == "INPUT"}
        getattr(mod.properties.inputs, by_name["Collection"]).value = col_src
        return ob

    ob_reef = make_point_cloud_obj("GN_Rocks_NearshoreReefs", reef_pts)
    ob_talus = make_point_cloud_obj("GN_Rocks_CoastalTalus", talus_pts)

    # Export rock_points.json for Stage 5 UE5 PCG/StaticMesh placement
    os.makedirs(EXPORT_UE_DIR, exist_ok=True)
    rock_json_path = os.path.join(EXPORT_UE_DIR, "rock_points.json")
    all_out = []
    for group_tag, lst in (("nearshore_reefs", reef_pts), ("coastal_talus", talus_pts)):
        for p in lst:
            all_out.append({
                "group": group_tag,
                "asset": ordered_names[p[9]],
                "pos": [round(p[0], 2), round(p[1], 2), round(p[2], 2)],
                "rot_xyz_rad": [round(p[3], 4), round(p[4], 4), round(p[5], 4)],
                "scale": [round(p[6], 3), round(p[7], 3), round(p[8], 3)],
            })
    with open(rock_json_path, "w", encoding="utf-8") as f:
        json.dump({"version": "3.3", "total_instances": len(all_out), "instances": all_out}, f, separators=(",", ":"))
    return ob_reef, ob_talus, len(reef_pts), len(talus_pts), rock_json_path


def cleanup_temp_polyhaven_datablocks():
    """Remove unused temporary import materials so scene_audit reports zero orphans/issues."""
    temp_mats = (
        "dark_rock", "dark_rock_02", "lichen_rock", "aerial_rocks_04",
        "boulder_01", "coast_rocks_05", "namaqualand_boulder_03", "mountainside",
    )
    for mn in temp_mats:
        m = bpy.data.materials.get(mn)
        if m is not None and m.users == 0:
            bpy.data.materials.remove(m)
    bpy.data.orphans_purge(do_recursive=True)


def run_upgrade():
    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])

    col_hero = bpy.data.collections["02_HeroRocks"]

    # 1) Build 4-map volcanic basalt node group & wire into terrain + all hero rocks
    ng_basalt = build_basalt_4map_nodegroup()
    upgrade_hero_basalt_materials(ng_basalt)
    upgrade_terrain_basalt_branch(ng_basalt)

    # 2) Normalize, decimate, and basalt-grade the 4 Poly Haven 2K rock models
    col_src, protos = prepare_polyhaven_rock_prototypes(col_hero)

    # 3) Replace nearshore reefs & add coastal basalt talus outcrops via GN instancer
    ng_inst = build_rock_instancer_nodetree("GN_Rock_PointInstancer")
    ob_reef, ob_talus, n_reef, n_talus, rock_json = build_coastal_rock_instances(
        col_hero, col_src, protos, ng_inst, meta, hf
    )

    # 4) Clean up temporary import materials & save relative paths
    cleanup_temp_polyhaven_datablocks()
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    summary = {
        "ok": True,
        "stage": "4b_polyhaven_rocks",
        "blend": BLEND_PATH,
        "basalt_textures_2k": ["dark_rock", "dark_rock_02", "lichen_rock", "aerial_rocks_04"],
        "rock_prototypes": {
            k: {"polys": len(v.data.polygons), "dims_m": [round(d, 2) for d in v.dimensions]}
            for k, v in protos.items()
        },
        "nearshore_reef_instances": n_reef,
        "coastal_talus_instances": n_talus,
        "rock_points_json": rock_json,
        "objects_count": len(bpy.data.objects),
        "materials_count": len(bpy.data.materials),
        "images_count": len(bpy.data.images),
    }
    print("@@JSON@@" + json.dumps(summary, ensure_ascii=False))
    return summary


if __name__ == "__main__":
    run_upgrade()
