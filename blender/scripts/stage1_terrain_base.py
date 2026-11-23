"""Stage 1: Build 1:1 metric island terrain base, studio collections, anchors,
base ocean/lake water, southeast sunlight, and review cameras in Blender 5.3.

Truth source: 三维/data/height.bin, 三维/data/mat.bin, 三维/data/island.json (v3.3).
Coordinate mapping:
  island (x_km, y_km, h_m) -> Blender (X = x_km*1000, Y = y_km*1000, Z = h_m)
  +X East, +Y North, +Z Up (1 Blender unit = 1 meter, UE5 ready).
"""

import json
import math
import os
import sys
import numpy as np
import bpy
from mathutils import Vector, Euler

WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(WORKSPACE, "三维", "data")
ASSETS_DIR = os.path.join(WORKSPACE, "三维", "assets")
OUT_BLEND = os.path.join(WORKSPACE, "blender", "island_env.blend")
RENDER_DIR = os.path.join(WORKSPACE, "blender", "renders")
os.makedirs(RENDER_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def get_or_create_collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        if parent is None:
            bpy.context.scene.collection.children.link(col)
        else:
            parent.children.link(col)
    return col


def link_only_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def setup_scene_units_and_color():
    scene = bpy.context.scene
    scene.name = "IslandBase_3_3"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0


def build_terrain(meta, hf, mat_ids, col_terrain):
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    x0 = float(g["x0"]) * 1000.0
    y0 = float(g["y0"]) * 1000.0
    step = float(g["step"]) * 1000.0

    # Grid coordinates (ny, nx)
    xs = x0 + np.arange(nx, dtype=np.float32) * step
    ys = y0 + np.arange(ny, dtype=np.float32) * step
    xx, yy = np.meshgrid(xs, ys)  # shape (ny, nx)
    zz = hf.reshape(ny, nx).astype(np.float32)

    # Vertices flattened: (ny*nx, 3)
    verts = np.stack([xx, yy, zz], axis=-1).reshape(-1, 3)

    # Quad indices: counter-clockwise looking from +Z (outward normal +Z)
    jj, ii = np.meshgrid(np.arange(ny - 1, dtype=np.int32),
                         np.arange(nx - 1, dtype=np.int32), indexing="ij")
    a = (jj * nx + ii).ravel()
    b = a + 1
    d = a + nx + 1
    c = a + nx
    quads = np.stack([a, b, d, c], axis=-1)  # (num_quads, 4)

    n_verts = verts.shape[0]
    n_polys = quads.shape[0]

    mesh = bpy.data.meshes.new("SM_Island_Terrain")
    mesh.vertices.add(n_verts)
    mesh.vertices.foreach_set("co", verts.ravel())

    mesh.loops.add(n_polys * 4)
    mesh.loops.foreach_set("vertex_index", quads.ravel())

    mesh.polygons.add(n_polys)
    mesh.polygons.foreach_set("loop_start", np.arange(0, n_polys * 4, 4, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(n_polys, 4, dtype=np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(n_polys, dtype=bool))

    # Normalized planar UV (0..1 across full heightfield, ideal for UE Landscape / baking)
    u = ((xx - x0) / ((nx - 1) * step)).ravel()
    v = ((yy - y0) / ((ny - 1) * step)).ravel()
    loop_vi = quads.ravel()
    uvs = np.empty(loop_vi.size * 2, dtype=np.float32)
    uvs[0::2] = u[loop_vi]
    uvs[1::2] = v[loop_vi]
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uv_layer.data.foreach_set("uv", uvs)

    # Compute local slope (degrees / 90) and normalized height attributes for shading & scattering
    dz_dy, dz_dx = np.gradient(zz, step, step)
    slope_mag = np.hypot(dz_dx, dz_dy)
    slope_deg = np.degrees(np.arctan(slope_mag)).astype(np.float32)
    slope_norm = np.clip(slope_deg / 90.0, 0.0, 1.0).ravel()

    z_min, z_max = float(zz.min()), float(zz.max())
    h_norm = np.clip((zz.ravel() - 0.0) / max(1.0, z_max), 0.0, 1.0).astype(np.float32)

    # Point attributes (accessible in Shader Nodes & Geometry Nodes)
    attr_mat = mesh.attributes.new(name="ENV_MatID", type="INT", domain="POINT")
    attr_mat.data.foreach_set("value", mat_ids.astype(np.int32))

    attr_slope = mesh.attributes.new(name="ENV_Slope", type="FLOAT", domain="POINT")
    attr_slope.data.foreach_set("value", slope_norm)

    attr_h = mesh.attributes.new(name="ENV_Height", type="FLOAT", domain="POINT")
    attr_h.data.foreach_set("value", h_norm)

    # Individual float mask attributes for clean shader & GN mixing
    mask_defs = {
        "Mask_Seabed": (mat_ids == 0),
        "Mask_Forest": (mat_ids == 1),
        "Mask_Meadow": (mat_ids == 2),
        "Mask_Gravel": (mat_ids == 3),
        "Mask_Basalt": (mat_ids == 4),
        "Mask_Lakebed": (mat_ids == 5),
        "Mask_Reef": (mat_ids == 6),
        "Mask_WhiteSand": (mat_ids == 7),
    }
    for m_name, m_bool in mask_defs.items():
        attr = mesh.attributes.new(name=m_name, type="FLOAT", domain="POINT")
        attr.data.foreach_set("value", m_bool.astype(np.float32))

    # Vertex color preview attribute (Color_Preview) for fast visual inspection in Stage 1
    colors = np.zeros((n_verts, 4), dtype=np.float32)
    colors[:, 3] = 1.0
    z_flat = zz.ravel()
    sl = slope_mag.ravel()

    # Base palette (linear space)
    palette = {
        0: np.array([0.015, 0.045, 0.065], dtype=np.float32),  # seabed
        1: np.array([0.032, 0.095, 0.035], dtype=np.float32),  # tropical cloud forest
        2: np.array([0.055, 0.145, 0.042], dtype=np.float32),  # humid lakeside sedge shore
        3: np.array([0.025, 0.028, 0.032], dtype=np.float32),  # black gravel shore
        4: np.array([0.038, 0.042, 0.048], dtype=np.float32),  # dark basalt cliff
        5: np.array([0.015, 0.045, 0.055], dtype=np.float32),  # lakebed
        6: np.array([0.035, 0.090, 0.088], dtype=np.float32),  # underwater reefs
        7: np.array([0.620, 0.580, 0.480], dtype=np.float32),  # white sand beach
    }
    for code, rgb in palette.items():
        idx = (mat_ids == code)
        colors[idx, :3] = rgb

    # Steep forest slopes reveal dark basalt rock
    steep_blend = np.clip((sl - 0.58) / (0.95 - 0.58), 0.0, 1.0)
    forest_idx = (mat_ids == 1)
    rock_rgb = palette[4]
    colors[forest_idx, :3] = (
        colors[forest_idx, :3] * (1.0 - steep_blend[forest_idx, None])
        + rock_rgb * steep_blend[forest_idx, None]
    )
    # High elevation (> 320 m) exposed dark basalt
    high_idx = (z_flat > 320.0) & (mat_ids != 5)
    colors[high_idx, :3] = rock_rgb
    # Wet sand darkening near waterline
    sand_wet = (mat_ids == 7) & (z_flat < 1.2)
    colors[sand_wet, :3] *= 0.55

    col_attr = mesh.color_attributes.new(name="Color_Preview", type="FLOAT_COLOR", domain="POINT")
    col_attr.data.foreach_set("color", colors.ravel())

    mesh.update()
    mesh.validate(verbose=False)

    obj = bpy.data.objects.new("SM_Island_Terrain", mesh)
    link_only_to(obj, col_terrain)

    # Vertex groups for forest / meadow / white sand (for GN/modifiers)
    for vg_name, mask_arr in [
        ("VG_Forest", (mat_ids == 1) & (z_flat >= 8.0) & (z_flat <= 308.0) & (sl <= 0.85)),
        ("VG_Meadow", (mat_ids == 2) & (sl <= 0.65)),
        ("VG_WhiteSand", (mat_ids == 7)),
    ]:
        vg = obj.vertex_groups.new(name=vg_name)
        inds = np.flatnonzero(mask_arr).tolist()
        if inds:
            vg.add(inds, 1.0, "REPLACE")

    # Stage 1 preview material reading Color_Preview + ENV_Slope roughness
    mat = bpy.data.materials.new("M_Island_Terrain_Base")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    attr_col = nt.nodes.new("ShaderNodeAttribute")
    attr_col.attribute_name = "Color_Preview"
    bsdf.inputs["Roughness"].default_value = 0.88
    nt.links.new(attr_col.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    obj.data.materials.append(mat)

    return obj, {"verts": n_verts, "polys": n_polys, "z_min": z_min, "z_max": z_max}


def build_base_water(meta, col_water):
    # 1) South Pacific Ocean plane at Z = 0 (20 km x 20 km)
    ocean_mesh = bpy.data.meshes.new("SM_Water_Ocean")
    s = 10000.0
    ocean_verts = [(-s, -s, 0.0), (s, -s, 0.0), (s, s, 0.0), (-s, s, 0.0)]
    ocean_mesh.from_pydata(ocean_verts, [], [(0, 1, 2, 3)])
    ocean_mesh.uv_layers.new(name="UVMap")
    ocean_mesh.update()
    ocean_obj = bpy.data.objects.new("SM_Water_Ocean", ocean_mesh)
    link_only_to(ocean_obj, col_water)

    m_ocean = bpy.data.materials.new("M_Water_Ocean_Base")
    nt = m_ocean.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.014, 0.068, 0.115, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.14
    bsdf.inputs["IOR"].default_value = 1.333
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.6
    ocean_obj.data.materials.append(m_ocean)

    # 2) Mirror Lake polygon at Z = lakeLevel (+138 m)
    lake_pts = meta["lake"]
    lake_z = float(meta["lakeLevel"])
    lake_verts = [(p[0] * 1000.0, p[1] * 1000.0, lake_z) for p in lake_pts]
    # Note: polygon in island.json is counter-clockwise or clockwise; ensure +Z normal
    # Compute signed 2D area
    area2 = sum(
        lake_verts[i][0] * lake_verts[(i + 1) % len(lake_verts)][1]
        - lake_verts[(i + 1) % len(lake_verts)][0] * lake_verts[i][1]
        for i in range(len(lake_verts))
    )
    if area2 < 0:
        lake_verts.reverse()

    lake_mesh = bpy.data.meshes.new("SM_Water_MirrorLake")
    lake_mesh.from_pydata(lake_verts, [], [tuple(range(len(lake_verts)))])
    # Triangulate n-gon cleanly via bmesh for UE5 compatibility
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(lake_mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(lake_mesh)
    bm.free()
    lake_mesh.uv_layers.new(name="UVMap")
    lake_mesh.update()

    lake_obj = bpy.data.objects.new("SM_Water_MirrorLake", lake_mesh)
    link_only_to(lake_obj, col_water)

    m_lake = bpy.data.materials.new("M_Water_MirrorLake_Base")
    nt_l = m_lake.node_tree
    bsdf_l = next(n for n in nt_l.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf_l.inputs["Base Color"].default_value = (0.015, 0.085, 0.105, 1.0)
    bsdf_l.inputs["Roughness"].default_value = 0.08
    bsdf_l.inputs["IOR"].default_value = 1.333
    lake_obj.data.materials.append(m_lake)

    return ocean_obj, lake_obj


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


def build_anchors(meta, hf, col_anchors):
    def add_empty(name, loc, rot_z=0.0, size=35.0, display="PLAIN_AXES"):
        em = bpy.data.objects.new(name, None)
        em.empty_display_type = display
        em.empty_display_size = size
        em.location = loc
        em.rotation_euler = (0.0, 0.0, rot_z)
        em.hide_render = True
        link_only_to(em, col_anchors)
        return em

    # Reserved Villa anchor (not modeled yet; +412~+440m slot on main cliff)
    vp = meta["villa"]["p"]
    vn = meta["villa"]["n"]
    slot_d = float(meta["villa"]["slotDistM"]) + 2.0
    vx = vp[0] * 1000.0 - vn[0] * slot_d
    vy = vp[1] * 1000.0 - vn[1] * slot_d
    vz = float(meta["villa"]["balconyZ"])
    # Seaward normal in Blender XY is (vn[0], vn[1]); align -Y to seaward
    villa_rot = math.atan2(vn[1], vn[0]) + math.pi * 0.5
    villa_em = add_empty("LOC_Villa_Anchor_Reserved", (vx, vy, vz), rot_z=villa_rot, size=30.0, display="ARROWS")
    villa_em["z_min"] = meta["villa"]["zMin"]
    villa_em["z_max"] = meta["villa"]["zMax"]
    villa_em["width_m"] = meta["villa"]["widthM"]
    villa_em["status"] = "RESERVED_NOT_MODELED"

    # Hero rock anchors
    sp = meta["swordPeak"]
    add_empty("LOC_SouthSwordPeak", (sp["x"] * 1000.0, sp["y"] * 1000.0, 0.0), rot_z=sp["rot"], size=60.0)

    sa = meta["seaArch"]
    amx = 0.5 * (sa["a"][0] + sa["b"][0]) * 1000.0
    amy = 0.5 * (sa["a"][1] + sa["b"][1]) * 1000.0
    add_empty("LOC_SeaArch_Center", (amx, amy, float(sa["crownZ"])), size=45.0)
    add_empty("LOC_SeaArch_WestAbutment", (sa["a"][0] * 1000.0, sa["a"][1] * 1000.0, 0.0), size=25.0)
    add_empty("LOC_SeaArch_EastAbutment", (sa["b"][0] * 1000.0, sa["b"][1] * 1000.0, 0.0), size=25.0)

    spire_names = {"主崖岬": "MainCliff", "西尖塔": "West", "东尖塔": "East"}
    for sr in meta["spires"]:
        if sr["name"] in spire_names:
            sx, sy = sr["p"][0] * 1000.0, sr["p"][1] * 1000.0
            add_empty(f"LOC_Spire_{spire_names[sr['name']]}", (sx, sy, float(sr["h"])), size=30.0)

    # Water & geography anchors
    lip = meta["riverProfile"][meta["lipIndex"]]
    imp = meta["riverProfile"][-1]
    add_empty("LOC_Waterfall_Lip", (lip[0] * 1000.0, lip[1] * 1000.0, float(lip[2])), size=25.0)
    add_empty("LOC_Waterfall_Impact", (imp[0] * 1000.0, imp[1] * 1000.0, 0.0), size=25.0)
    add_empty("LOC_MirrorLake_Center", (-420.0, -20.0, float(meta["lakeLevel"])), size=40.0)
    add_empty("LOC_LakesideShore_South", (-400.0, -200.0, sample_height(meta, hf, -400.0, -200.0)), size=25.0)
    add_empty("LOC_WhiteSandBeach_Center", (-102.5, 405.0, sample_height(meta, hf, -102.5, 405.0)), size=30.0)
    add_empty("LOC_EastIslet_Peak", (1655.0, 181.0, 260.0), size=35.0)

    # Reserved Barracks anchor (not modeled yet)
    cx, cy = meta["camps"][0][0] * 1000.0, meta["camps"][0][1] * 1000.0
    add_empty("LOC_Barracks_Reserved", (cx, cy, sample_height(meta, hf, cx, cy)), size=25.0)


def setup_lighting_and_cameras(meta, col_lc):
    scene = bpy.context.scene

    # World HDRI (reuse local sky.hdr)
    world = bpy.data.worlds.new("WLD_Island_Day")
    scene.world = world
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.85

    hdr_path = os.path.join(ASSETS_DIR, "landscape", "sky.hdr")
    if os.path.isfile(hdr_path):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        img = bpy.data.images.load(hdr_path, check_existing=True)
        env.image = img
        tex_coord = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        # Align sun sky disc toward Southeast (+X, -Y)
        mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(-18.0))
        nt.links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (0.45, 0.62, 0.78, 1.0)
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    # Southeast Directional Sun (vector TO sun = (+0.54, -0.395, +0.743))
    # Light travels along -Z of Sun object, so align local +Z with vector TO sun.
    sun_dir_to = Vector((0.54, -0.395, 0.743)).normalized()
    sun_data = bpy.data.lights.new("LGT_Sun_Southeast", type="SUN")
    sun_data.energy = 3.8
    sun_data.color = (1.0, 0.94, 0.84)
    sun_data.angle = math.radians(0.8)
    sun_obj = bpy.data.objects.new("LGT_Sun_Southeast", sun_data)
    sun_obj.location = (0.0, 0.0, 1200.0)
    sun_obj.rotation_euler = sun_dir_to.to_track_quat("Z", "Y").to_euler()
    link_only_to(sun_obj, col_lc)

    # Preset review cameras (matching key v3.3 viewpoints)
    def add_camera(name, pos, target, lens=35.0):
        cam_data = bpy.data.cameras.new(name)
        cam_data.lens = lens
        cam_data.clip_start = 1.0
        cam_data.clip_end = 25000.0
        cam_obj = bpy.data.objects.new(name, cam_data)
        cam_obj.location = Vector(pos)
        direction = Vector(target) - Vector(pos)
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        link_only_to(cam_obj, col_lc)
        return cam_obj

    cams = [
        add_camera("CAM_Overview_SE", (1650, -2100, 1180), (-120, 60, 120), lens=28.0),
        add_camera("CAM_SouthCliff_Sunlit", (-450, -2350, 320), (-150, -1100, 260), lens=35.0),
        add_camera("CAM_BlackGravelBay_North", (-240, 920, 140), (-30, 310, 45), lens=32.0),
        add_camera("CAM_Strait_EastIslet", (1340, 820, 130), (1460, 120, 75), lens=35.0),
        add_camera("CAM_Caldera_Lake_Meadow", (-180, 360, 390), (-360, -340, 145), lens=28.0),
    ]
    scene.camera = cams[0]
    return cams


def render_previews(cams):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    rendered = []
    for cam in cams:
        scene.camera = cam
        out_path = os.path.join(RENDER_DIR, f"stage1_{cam.name.lower()}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        rendered.append(out_path)
    scene.camera = cams[0]
    return rendered


def main():
    clear_scene()
    setup_scene_units_and_color()

    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)

    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])
    mat_ids = np.fromfile(os.path.join(DATA_DIR, "mat.bin"), dtype=np.uint8)

    col_anchors = get_or_create_collection("00_Anchors")
    col_terrain = get_or_create_collection("01_Terrain")
    get_or_create_collection("02_HeroRocks")
    col_water = get_or_create_collection("03_Water")
    get_or_create_collection("04_Vegetation")
    col_lc = get_or_create_collection("05_Lighting_Cameras")

    terrain_obj, t_stats = build_terrain(meta, hf, mat_ids, col_terrain)
    build_base_water(meta, col_water)
    build_anchors(meta, hf, col_anchors)
    cams = setup_lighting_and_cameras(meta, col_lc)

    # Save first so make_paths_relative() resolves against the saved .blend path
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    rendered = [] if "--no-render" in sys.argv else render_previews(cams[:3])

    report = {
        "ok": True,
        "stage": 1,
        "blend": OUT_BLEND,
        "terrain": t_stats,
        "dimensions_m": [round(v, 2) for v in terrain_obj.dimensions],
        "collections": [c.name for c in bpy.data.collections],
        "objects_count": len(bpy.data.objects),
        "renders": rendered,
    }
    print("@@JSON@@" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
