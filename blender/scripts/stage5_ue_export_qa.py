"""
Stage 5: Final QA & Complete Unreal Engine 5 Production Export Package
Outputs to blender/export_ue/:
  - landscape/ : 1009x1009 16-bit grayscale Raw PNG heightmap, 5 single-channel Landscape weightmaps,
                 RGBA Splat map, and landscape_import_params.json (exact UE5 Transform & Scale).
  - meshes/    : 25 UE5-ready FBX files (unreal preset: FBX_SCALE_UNITS, -Z forward, Y up,
                 FACE smoothing, triangulated, tangents) covering Terrain Nanite, Hero Rocks,
                 4 Poly Haven 2K rock prototypes, Water meshes, and 6 tropical vegetation prototypes.
  - textures/  : UE5 PBR texture sets (T_*_BC.png sRGB, T_*_N_DX.png DirectX G-flipped normal,
                 T_*_ORM.png R=AO/Disp G=Rough B=0) + T_Sky_IslandDay.hdr.
  - anchors_ue.json        : All landmarks, reserved Villa/Barracks anchors, 13 buoys, cameras, sun vector (m + UE cm).
  - ue5_import_instances.py: Ready-to-run UE5 Editor Python script to spawn foliage/rock/buoy instances.
  - export_qa_report.json  : Automated round-trip FBX scale check + 16-bit heightmap round-trip accuracy check.
"""
import json
import math
import os
import shutil
import struct
import zlib
import bpy
import numpy as np
from mathutils import Vector

ROOT_DIR = r"C:\Users\wsbyb\OneDrive\Dokumen\Projects\A new world"
DATA_DIR = os.path.join(ROOT_DIR, "三维", "data")
ASSETS_TEX_DIR = os.path.join(ROOT_DIR, "三维", "assets", "textures")
ASSETS_LAND_DIR = os.path.join(ROOT_DIR, "三维", "assets", "landscape")
BLENDER_DIR = os.path.join(ROOT_DIR, "blender")
BLEND_PATH = os.path.join(BLENDER_DIR, "island_env.blend")
PH_TEX_DIR = os.path.join(BLENDER_DIR, "textures", "polyhaven")

OUT_DIR = os.path.join(BLENDER_DIR, "export_ue")
OUT_LAND = os.path.join(OUT_DIR, "landscape")
OUT_MESH = os.path.join(OUT_DIR, "meshes")
OUT_TEX = os.path.join(OUT_DIR, "textures")


# ── Pure-Python Bit-Exact PNG Writer (8-bit & 16-bit, zero color-management distortion) ──
def _png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png_u16_gray(path, arr_u16):
    """Write a bit-exact 16-bit single-channel grayscale PNG (big-endian per PNG spec)."""
    h, w = arr_u16.shape
    ihdr = struct.pack(">IIBBBBB", w, h, 16, 0, 0, 0, 0)
    be = arr_u16.astype(">u2")
    raw_rows = np.concatenate([np.zeros((h, 1), dtype=np.uint8), be.view(np.uint8).reshape(h, w * 2)], axis=1)
    idat = zlib.compress(raw_rows.tobytes(), level=6)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b""))


def write_png_u8_gray(path, arr_u8):
    h, w = arr_u8.shape
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    raw_rows = np.concatenate([np.zeros((h, 1), dtype=np.uint8), arr_u8.astype(np.uint8)], axis=1)
    idat = zlib.compress(raw_rows.tobytes(), level=6)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b""))


def write_png_u8_rgb(path, arr_u8):
    h, w, c = arr_u8.shape
    color_type = 2 if c == 3 else 6
    ihdr = struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)
    raw_rows = np.concatenate([np.zeros((h, 1), dtype=np.uint8), arr_u8.astype(np.uint8).reshape(h, w * c)], axis=1)
    idat = zlib.compress(raw_rows.tobytes(), level=6)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b""))


def read_png_u16_gray(path):
    """Read back our 16-bit grayscale PNG to verify round-trip accuracy."""
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    w = h = 0
    idat = bytearray()
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", chunk[:10])
            assert bd == 16 and ct == 0
        elif tag == b"IDAT":
            idat.extend(chunk)
    raw = zlib.decompress(bytes(idat))
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(h, 1 + w * 2)[:, 1:]
    return np.ascontiguousarray(rows).view(">u2").reshape(h, w).astype(np.uint16)


def blur_2d(arr, passes=2):
    out = arr.astype(np.float32).copy()
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (
            p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:]
            + 2 * p[1:-1, :-2] + 4 * p[1:-1, 1:-1] + 2 * p[1:-1, 2:]
            + p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]
        ) / 16.0
    return out


def beach_sand_weight_np(xx_km, yy_km, zz):
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
    along = np.clip((xx_km - west) / 0.032, 0.0, 1.0) * np.clip((east - xx_km) / 0.028, 0.0, 1.0)
    w_in = np.clip((inland + 14.0) / 16.0, 0.0, 1.0) * np.clip((width + 6.0 - inland) / 14.0, 0.0, 1.0)
    w_z = np.clip((9.0 - zz) / 4.0, 0.0, 1.0) * np.clip((zz + 4.0) / 3.5, 0.0, 1.0)
    return along * w_in * w_z


def export_ue5_landscape(meta, hf, mat_ids):
    """Export 1009x1009 16-bit grayscale heightmap + UE5 weightmaps + exact import params."""
    os.makedirs(OUT_LAND, exist_ok=True)
    g = meta["grid"]
    nx, ny = int(g["nx"]), int(g["ny"])
    x0_m, y0_m, step_m = float(g["x0"]) * 1000.0, float(g["y0"]) * 1000.0, float(g["step"]) * 1000.0
    z_src = hf.reshape(ny, nx).astype(np.float32)
    m_src = mat_ids.reshape(ny, nx)

    # Standard UE5 square landscape resolution: 1009x1009 (16x16 components, 1 section, 63 quads)
    # 1008 quads * 5.0 m/quad = 5040.0 m x 5040.0 m centered at (0, 0)
    N = 1009
    spacing_m = 5.0
    span_m = (N - 1) * spacing_m  # 5040.0 m
    half_m = span_m * 0.5         # 2520.0 m

    # Row 0 = North (+Y_blender = +2520m = -Y_ue), Row N-1 = South (-Y_blender = -2520m = +Y_ue)
    xs = np.linspace(-half_m, half_m, N, dtype=np.float32)
    ys = np.linspace(half_m, -half_m, N, dtype=np.float32)  # top-to-bottom = North-to-South
    xx, yy = np.meshgrid(xs, ys)

    # Bilinear resample height & nearest/smooth masks from source 708x622 grid
    gx = (xx - x0_m) / step_m
    gy = (yy - y0_m) / step_m
    in_bounds = (gx >= 0.0) & (gx <= nx - 1.001) & (gy >= 0.0) & (gy <= ny - 1.001)

    ix = np.clip(np.floor(gx).astype(np.int32), 0, nx - 2)
    iy = np.clip(np.floor(gy).astype(np.int32), 0, ny - 2)
    ux = np.clip(gx - ix, 0.0, 1.0)
    uy = np.clip(gy - iy, 0.0, 1.0)

    z_grid = (
        z_src[iy, ix] * (1 - ux) * (1 - uy)
        + z_src[iy, ix + 1] * ux * (1 - uy)
        + z_src[iy + 1, ix] * (1 - ux) * uy
        + z_src[iy + 1, ix + 1] * ux * uy
    )
    z_grid = np.where(in_bounds, z_grid, -800.0).astype(np.float32)

    z_min = float(z_grid.min())
    z_max = float(z_grid.max())
    z_range = z_max - z_min  # ~1263.2 m
    z_mid = 0.5 * (z_min + z_max)

    # Encode 16-bit heightmap (0 -> z_min, 65535 -> z_max)
    u16 = np.clip(np.round((z_grid - z_min) / z_range * 65535.0), 0, 65535).astype(np.uint16)
    hm_path = os.path.join(OUT_LAND, "T_Island_Heightmap_16bit.png")
    write_png_u16_gray(hm_path, u16)

    # Round-trip verification
    u16_rt = read_png_u16_gray(hm_path)
    z_rt = z_min + (u16_rt.astype(np.float64) / 65535.0) * z_range
    max_err_m = float(np.max(np.abs(z_rt - z_grid)))
    rmse_m = float(np.sqrt(np.mean((z_rt - z_grid) ** 2)))

    # UE5 Landscape Layer Weightmaps (normalized so sum = 1.0 per pixel!)
    ix_n = np.clip(np.round(gx).astype(np.int32), 0, nx - 1)
    iy_n = np.clip(np.round(gy).astype(np.int32), 0, ny - 1)
    m_grid = np.where(in_bounds, m_src[iy_n, ix_n], 0)

    dz_dy, dz_dx = np.gradient(z_grid, -spacing_m, spacing_m)
    slope_deg = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    flat = np.clip((52.0 - slope_deg) / 14.0, 0.0, 1.0)

    w_sand = beach_sand_weight_np(xx / 1000.0, yy / 1000.0, z_grid)
    w_seabed = blur_2d(((m_grid == 0) | (m_grid == 5) | (m_grid == 6)).astype(np.float32), passes=2) * (1.0 - w_sand)
    w_forest = blur_2d((m_grid == 1).astype(np.float32), passes=2) * flat * (1.0 - w_sand)
    w_grass = blur_2d((m_grid == 2).astype(np.float32), passes=2) * flat * (1.0 - w_sand)
    w_basalt = np.clip(1.0 - (w_forest + w_grass + w_sand + w_seabed), 0.0, 1.0)

    total_w = np.maximum(w_forest + w_grass + w_basalt + w_sand + w_seabed, 1e-6)
    w_forest /= total_w
    w_grass /= total_w
    w_basalt /= total_w
    w_sand /= total_w
    w_seabed /= total_w

    weight_files = {}
    for wname, warr in [
        ("Weightmap_Forest.png", w_forest),
        ("Weightmap_LakesideGrass.png", w_grass),
        ("Weightmap_Basalt.png", w_basalt),
        ("Weightmap_WhiteSand.png", w_sand),
        ("Weightmap_Seabed.png", w_seabed),
    ]:
        p = os.path.join(OUT_LAND, wname)
        write_png_u8_gray(p, np.clip(np.round(warr * 255.0), 0, 255).astype(np.uint8))
        weight_files[wname] = p

    # Combined RGBA splat (R=Forest, G=LakesideGrass, B=Basalt, A=WhiteSand)
    splat = np.stack([w_forest, w_grass, w_basalt, w_sand], axis=-1)
    splat_path = os.path.join(OUT_LAND, "T_Landscape_Splat_RGBA.png")
    write_png_u8_rgb(splat_path, np.clip(np.round(splat * 255.0), 0, 255).astype(np.uint8))

    # Exact UE5 Landscape Import Transform
    # UE5 maps uint16 [0..65535] -> [-256..+256) * ScaleZ (cm) around Actor Location Z
    ue_scale_xy = spacing_m * 100.0                 # 500.0 cm
    ue_scale_z = (z_range * 100.0) / 512.0          # ~246.71875
    ue_loc_z_cm = z_mid * 100.0                     # ~-16840.0 cm

    params = {
        "version": "3.3",
        "heightmap_file": "T_Island_Heightmap_16bit.png",
        "resolution": [N, N],
        "ue5_landscape_config": {
            "section_size": "63x63 Quads",
            "sections_per_component": "1x1 Section",
            "number_of_components": "16x16",
            "overall_resolution": f"{N}x{N}",
            "location_cm": [0.0, 0.0, round(ue_loc_z_cm, 3)],
            "rotation_deg": [0.0, 0.0, 0.0],
            "scale": [round(ue_scale_xy, 3), round(ue_scale_xy, 3), round(ue_scale_z, 5)],
        },
        "world_bounds_m": {
            "x_min": -half_m, "x_max": half_m,
            "y_min": -half_m, "y_max": half_m,
            "z_min": round(z_min, 3), "z_max": round(z_max, 3),
            "z_range": round(z_range, 3),
            "sea_level_z_m": 0.0,
            "sea_level_uint16": int(round((0.0 - z_min) / z_range * 65535.0)),
        },
        "roundtrip_qa": {
            "max_error_m": round(max_err_m, 5),
            "rmse_m": round(rmse_m, 5),
            "pass": max_err_m < 0.05,
        },
        "axis_note": "Row 0 of heightmap/weightmaps = North (+Y Blender = -Y UE5); Row 1008 = South (-Y Blender = +Y UE5); Col 0 = West (-X); Col 1008 = East (+X).",
        "weightmaps": list(weight_files.keys()) + ["T_Landscape_Splat_RGBA.png"],
    }
    params_path = os.path.join(OUT_LAND, "landscape_import_params.json")
    with open(params_path, "w", encoding="utf-8") as f:
        json.dump(params, f, indent=2, ensure_ascii=False)
    return params


def load_image_np(filepath, is_srgb=False):
    """Load an image (JPG/PNG/EXR) via Blender's OpenImageIO into float32 numpy array (H, W, 4) top-down."""
    img = bpy.data.images.load(filepath, check_existing=False)
    img.colorspace_settings.name = "sRGB" if is_srgb else "Non-Color"
    w, h = img.size[0], img.size[1]
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    # Blender stores pixels bottom-to-top; flip vertically for standard top-down PNG
    arr = buf.reshape(h, w, 4)[::-1, :, :]
    return arr


def linear_to_srgb_u8(arr_rgb):
    a = np.clip(arr_rgb, 0.0, 1.0)
    srgb = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 255.0), 0, 255).astype(np.uint8)


def srgb_to_linear(arr_srgb):
    a = np.clip(arr_srgb, 0.0, 1.0)
    return np.where(a <= 0.04045, a / 12.92, np.power((a + 0.055) / 1.055, 2.4))


def grade_volcanic_basalt_bc(rgb_srgb, sat=0.24, val=0.38, tint=(0.74, 0.85, 0.98)):
    """Apply unified volcanic basalt color grade in linear space so UE5 imports match Blender out-of-the-box."""
    lin = srgb_to_linear(rgb_srgb)
    lum = (0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2])[..., None]
    desat = lum * (1.0 - sat) + lin * sat
    graded = desat * val * np.array(tint, dtype=np.float32)
    return linear_to_srgb_u8(graded)


def export_ue5_textures():
    """Export DirectX Normals (G-flipped), ORM packed maps, and sRGB BaseColors for UE5."""
    os.makedirs(OUT_TEX, exist_ok=True)
    exported = []

    # 1) 4 Poly Haven 2K Basalt Sets (DirectX Normal + ORM + BC)
    basalt_sets = [
        ("Basalt_DarkRock", "dark_rock_Diffuse.jpg", "dark_rock_nor_gl.jpg", "dark_rock_Rough.jpg", "dark_rock_Displacement.jpg", False),
        ("Basalt_DarkRock02", "dark_rock_02_Diffuse.jpg", "dark_rock_02_nor_gl.jpg", "dark_rock_02_Rough.jpg", "dark_rock_02_Displacement.jpg", False),
        ("Basalt_LichenRock", "lichen_rock_Diffuse.jpg", "lichen_rock_nor_gl.jpg", "lichen_rock_Rough.jpg", "lichen_rock_Displacement.jpg", False),
        ("Basalt_AerialRocks04", "aerial_rocks_04_Diffuse.jpg", "aerial_rocks_04_nor_gl.jpg", "aerial_rocks_04_Rough.jpg", "aerial_rocks_04_Displacement.jpg", False),
        # 4 Poly Haven 2K Photogrammetry Rock Models (pre-graded volcanic basalt BC + DirectX Normal + ORM)
        ("PH_Boulder01", "boulder_01_diff.jpg", "boulder_01_nor_gl.exr", "boulder_01_rough.exr", None, True),
        ("PH_CoastReef05", "coast_rocks_05_diff.jpg", "coast_rocks_05_nor_gl.exr", "coast_rocks_05_rough.exr", None, True),
        ("PH_Boulder03", "namaqualand_boulder_03_diff.jpg", "namaqualand_boulder_03_nor_gl.exr", "namaqualand_boulder_03_rough.exr", None, True),
        ("PH_CliffOutcrop", "mountainside_diff.jpg", "mountainside_nor_gl.exr", "mountainside_rough.exr", None, True),
    ]

    for ue_name, f_diff, f_nor, f_rough, f_ao_disp, apply_basalt_grade in basalt_sets:
        p_diff = os.path.join(PH_TEX_DIR, f_diff)
        p_nor = os.path.join(PH_TEX_DIR, f_nor)
        p_rough = os.path.join(PH_TEX_DIR, f_rough)
        p_disp = os.path.join(PH_TEX_DIR, f_ao_disp) if f_ao_disp else None

        # BaseColor (sRGB)
        bc_path = os.path.join(OUT_TEX, f"T_{ue_name}_BC.png")
        if apply_basalt_grade:
            diff_arr = load_image_np(p_diff, is_srgb=False)[..., :3]  # load raw encoded 0..1 sRGB bytes
            bc_u8 = grade_volcanic_basalt_bc(diff_arr)
            write_png_u8_rgb(bc_path, bc_u8)
        else:
            # Copy or re-encode crisp sRGB PNG (raw sRGB values preserved)
            diff_arr = load_image_np(p_diff, is_srgb=False)[..., :3]
            write_png_u8_rgb(bc_path, np.clip(np.round(diff_arr * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(bc_path))

        # DirectX Normal (OpenGL -> DirectX: flip Green channel = 1.0 - G!)
        nor_arr = load_image_np(p_nor, is_srgb=False)[..., :3]
        nor_dx = nor_arr.copy()
        nor_dx[..., 1] = 1.0 - np.clip(nor_dx[..., 1], 0.0, 1.0)
        nor_path = os.path.join(OUT_TEX, f"T_{ue_name}_N_DX.png")
        write_png_u8_rgb(nor_path, np.clip(np.round(nor_dx * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(nor_path))

        # ORM Channel Pack: R = AO (derived from displacement cavity or 1.0), G = Roughness, B = Metallic (0.0)
        rough_arr = load_image_np(p_rough, is_srgb=False)[..., 0]
        if p_disp and os.path.isfile(p_disp):
            disp_arr = load_image_np(p_disp, is_srgb=False)[..., 0]
            ao_ch = np.clip(0.55 + 0.45 * disp_arr, 0.0, 1.0)
        else:
            ao_ch = np.ones_like(rough_arr)
        metal_ch = np.zeros_like(rough_arr)
        orm = np.stack([ao_ch, np.clip(rough_arr, 0.0, 1.0), metal_ch], axis=-1)
        orm_path = os.path.join(OUT_TEX, f"T_{ue_name}_ORM.png")
        write_png_u8_rgb(orm_path, np.clip(np.round(orm * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(orm_path))

    # 2) Local Terrain CC0 Sets (White Sand Beach & Forest Ground)
    local_sets = [
        ("Terrain_WhiteSand", "coast_sand_03_diff_1k.jpg", "coast_sand_03_nor_gl_1k.jpg", "coast_sand_03_rough_1k.jpg"),
        ("Terrain_ForestGround", "forest_ground_04_diff_1k.jpg", "forest_ground_04_nor_gl_1k.jpg", "forest_ground_04_rough_1k.jpg"),
    ]
    for ue_name, f_diff, f_nor, f_rough in local_sets:
        diff_arr = load_image_np(os.path.join(ASSETS_TEX_DIR, f_diff), is_srgb=False)[..., :3]
        bc_path = os.path.join(OUT_TEX, f"T_{ue_name}_BC.png")
        write_png_u8_rgb(bc_path, np.clip(np.round(diff_arr * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(bc_path))

        nor_arr = load_image_np(os.path.join(ASSETS_TEX_DIR, f_nor), is_srgb=False)[..., :3]
        nor_arr[..., 1] = 1.0 - np.clip(nor_arr[..., 1], 0.0, 1.0)
        nor_path = os.path.join(OUT_TEX, f"T_{ue_name}_N_DX.png")
        write_png_u8_rgb(nor_path, np.clip(np.round(nor_arr * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(nor_path))

        r_arr = load_image_np(os.path.join(ASSETS_TEX_DIR, f_rough), is_srgb=False)[..., 0]
        orm = np.stack([np.ones_like(r_arr), np.clip(r_arr, 0.0, 1.0), np.zeros_like(r_arr)], axis=-1)
        orm_path = os.path.join(OUT_TEX, f"T_{ue_name}_ORM.png")
        write_png_u8_rgb(orm_path, np.clip(np.round(orm * 255.0), 0, 255).astype(np.uint8))
        exported.append(os.path.basename(orm_path))

    # 3) Copy HDRI sky for UE5 SkyLight
    hdr_src = os.path.join(ASSETS_LAND_DIR, "sky.hdr")
    if os.path.isfile(hdr_src):
        hdr_dst = os.path.join(OUT_TEX, "T_Sky_IslandDay.hdr")
        shutil.copy2(hdr_src, hdr_dst)
        exported.append(os.path.basename(hdr_dst))

    return exported


def enable_all_layer_collections(lc):
    saved = []
    def walk(node):
        if node.exclude:
            saved.append(node)
            node.exclude = False
        for c in node.children:
            walk(c)
    walk(lc)
    return saved


def export_single_fbx(obj, out_path, zero_origin=False):
    """Export one mesh object with verified Unreal Engine 5 FBX preset."""
    orig_loc = obj.location.copy()
    orig_hide_vp = obj.hide_viewport
    orig_hide = obj.hide_get()
    obj.hide_viewport = False
    obj.hide_set(False)
    if zero_origin:
        obj.location = (0.0, 0.0, 0.0)

    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.fbx(
        filepath=out_path,
        use_selection=True,
        object_types={"MESH"},
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
        bake_space_transform=False,
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        use_triangles=True,
        use_tspace=True,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="AUTO",
        embed_textures=False,
    )

    obj.location = orig_loc
    obj.hide_viewport = orig_hide_vp
    obj.hide_set(orig_hide)
    return {
        "file": os.path.basename(out_path),
        "size_kb": round(os.path.getsize(out_path) / 1024.0, 1),
        "expected_dims_m": [round(float(d), 3) for d in obj.dimensions],
        "zero_origin": zero_origin,
    }


def export_all_ue5_meshes():
    os.makedirs(OUT_MESH, exist_ok=True)
    # Temporarily un-exclude source prototype collections so Blender can select & export them
    re_exclude = enable_all_layer_collections(bpy.context.view_layer.layer_collection)

    # (blender_obj_name, export_filename, zero_origin)
    # World-placed terrain/hero/water keep world pivot (zero_origin=False) so dropping them at (0,0,0) in UE5 aligns 1:1!
    # Reusable prototypes (Buoy, 4 Poly Haven Rocks, 6 Tropical Plants) export centered at origin (zero_origin=True).
    targets = [
        ("SM_Island_Terrain", "SM_Island_Terrain_Nanite.fbx", False),
        ("SM_Hero_SouthSwordPeak", "SM_Hero_SouthSwordPeak.fbx", False),
        ("SM_Hero_SeaArch", "SM_Hero_SeaArch.fbx", False),
        ("SM_Hero_Spire_MainCliff", "SM_Hero_Spire_MainCliff.fbx", False),
        ("SM_Hero_Spire_West", "SM_Hero_Spire_West.fbx", False),
        ("SM_Hero_Spire_East", "SM_Hero_Spire_East.fbx", False),
        ("SM_SeaStack_01", "SM_SeaStack_01.fbx", False),
        ("SM_SeaStack_02", "SM_SeaStack_02.fbx", False),
        ("SM_SeaStack_03", "SM_SeaStack_03.fbx", False),
        ("SM_SeaStack_04", "SM_SeaStack_04.fbx", False),
        ("SM_SeaStack_05", "SM_SeaStack_05.fbx", False),
        ("SM_Buoy_01", "SM_Buoy_Prototype.fbx", True),
        # 4 Poly Haven 2K Rock Prototypes
        ("SM_Rock_PH_Boulder01", "SM_Rock_PH_Boulder01.fbx", True),
        ("SM_Rock_PH_CoastReef05", "SM_Rock_PH_CoastReef05.fbx", True),
        ("SM_Rock_PH_Boulder03", "SM_Rock_PH_Boulder03.fbx", True),
        ("SM_Rock_PH_CliffOutcrop", "SM_Rock_PH_CliffOutcrop.fbx", True),
        # Water System
        ("SM_Water_Ocean", "SM_Water_Ocean.fbx", False),
        ("SM_Water_MirrorLake", "SM_Water_MirrorLake.fbx", False),
        ("SM_Water_WhitewaterRiver", "SM_Water_WhitewaterRiver.fbx", False),
        ("SM_Water_CurtainFalls", "SM_Water_CurtainFalls.fbx", False),
        ("SM_Water_PlungeFoam", "SM_Water_PlungeFoam.fbx", False),
        ("SM_Water_BeachSurf", "SM_Water_BeachSurf.fbx", False),
        # 6 Tropical Vegetation Prototypes
        ("SM_Tree_CloudForest_01", "SM_Tree_CloudForest_01.fbx", True),
        ("SM_Tree_CloudForest_02", "SM_Tree_CloudForest_02.fbx", True),
        ("SM_Tree_TropicalPalm_01", "SM_Tree_TropicalPalm_01.fbx", True),
        ("SM_Tree_Fern_01", "SM_Tree_Fern_01.fbx", True),
        ("SM_Bush_Tropical_01", "SM_Bush_Tropical_01.fbx", True),
        ("SM_Grass_Meadow_01", "SM_Grass_Meadow_01.fbx", True),
    ]

    results = {}
    for obj_name, fname, zero_orig in targets:
        obj = bpy.data.objects.get(obj_name)
        if obj is None:
            raise RuntimeError(f"Missing expected mesh object: {obj_name}")
        results[fname] = export_single_fbx(obj, os.path.join(OUT_MESH, fname), zero_origin=zero_orig)

    for lc in re_exclude:
        lc.exclude = True
    return results


def export_anchors_and_ue5_script(meta):
    """Export anchors_ue.json (Blender meters + UE5 cm) and ready-to-run ue5_import_instances.py."""
    def b_to_ue_cm(x_m, y_m, z_m):
        # Blender right-handed (+X East, +Y North, +Z Up) -> UE5 left-handed (+X East, +Y South, +Z Up) in cm
        return [round(x_m * 100.0, 2), round(-y_m * 100.0, 2), round(z_m * 100.0, 2)]

    anchors = {}
    col_anc = bpy.data.collections.get("00_Anchors")
    if col_anc:
        for o in sorted(col_anc.objects, key=lambda x: x.name):
            loc = o.matrix_world.translation
            anchors[o.name] = {
                "blender_m": [round(loc.x, 2), round(loc.y, 2), round(loc.z, 2)],
                "ue5_cm": b_to_ue_cm(loc.x, loc.y, loc.z),
                "reserved_unmodeled": "Reserved" in o.name,
            }

    buoys = []
    col_hero = bpy.data.collections.get("02_HeroRocks")
    if col_hero:
        for o in sorted(col_hero.objects, key=lambda x: x.name):
            if o.name.startswith("SM_Buoy_"):
                loc = o.matrix_world.translation
                buoys.append({
                    "name": o.name,
                    "asset": "SM_Buoy_Prototype",
                    "blender_m": [round(loc.x, 2), round(loc.y, 2), round(loc.z, 2)],
                    "ue5_cm": b_to_ue_cm(loc.x, loc.y, loc.z),
                })

    cameras = {}
    col_lc = bpy.data.collections.get("05_Lighting_Cameras")
    if col_lc:
        for o in sorted(col_lc.objects, key=lambda x: x.name):
            if o.type == "CAMERA":
                loc = o.matrix_world.translation
                rot = o.matrix_world.to_euler("XYZ")
                cameras[o.name] = {
                    "lens_mm": round(float(o.data.lens), 1),
                    "blender_m": [round(loc.x, 2), round(loc.y, 2), round(loc.z, 2)],
                    "ue5_cm": b_to_ue_cm(loc.x, loc.y, loc.z),
                    "blender_rot_deg": [round(math.degrees(a), 2) for a in rot],
                }

    # Southeast sunlight vector (pointing TO sun): Blender (+0.54, -0.395, +0.743)
    # In UE5 (+X East, +Y South, +Z Up): sun TO vector = (+0.54, +0.395, +0.743); DirectionalLight shines FROM sun = (-0.54, -0.395, -0.743)
    # Pitch = -arcsin(0.743) = -47.99 deg, Yaw = atan2(-0.395, -0.54) = -143.8 deg
    payload = {
        "version": "3.3",
        "coordinate_conversion": "UE5_cm = (Blender_X * 100, -Blender_Y * 100, Blender_Z * 100)",
        "sun_southeast_sunlit_southcliff": {
            "blender_to_sun_dir": [0.54, -0.395, 0.743],
            "ue5_directional_light_rotation_deg": {"roll": 0.0, "pitch": -48.0, "yaw": -143.8},
            "note": "Shines from Southeast onto South Cliff (晴日南崖受光).",
        },
        "anchors": anchors,
        "buoys_13": buoys,
        "cameras": cameras,
    }
    anc_path = os.path.join(OUT_DIR, "anchors_ue.json")
    with open(anc_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    # Ready-to-run UE5 Editor Python script to spawn all rock, buoy, and foliage instances via HISMC
    ue_py = '''"""
Unreal Engine 5 Editor Python Script: Spawn Island 3.3 Rocks (105), Buoys (13), and Foliage (133,687)
Usage in UE5 Editor:
  1. Import all FBX files from blender/export_ue/meshes/ into /Game/Island/Meshes/
  2. Enable the "Python Editor Script Plugin" in UE5.
  3. Update EXPORT_DIR below if needed, then run via Tools -> Execute Python Script.
"""
import json, math, os
import unreal

EXPORT_DIR = r"C:\\Users\\wsbyb\\OneDrive\\Dokumen\\Projects\\A new world\\blender\\export_ue"
MESH_CONTENT_PATH = "/Game/Island/Meshes"

def b_pos_to_ue(pos_m):
    return unreal.Vector(pos_m[0] * 100.0, -pos_m[1] * 100.0, pos_m[2] * 100.0)

def spawn_hism_actor(label, asset_name, transforms):
    mesh_path = f"{MESH_CONTENT_PATH}/{asset_name}.{asset_name}"
    sm = unreal.EditorAssetLibrary.load_asset(mesh_path)
    if not sm:
        unreal.log_warning(f"Missing StaticMesh: {mesh_path} (skipping {len(transforms)} instances)")
        return
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0))
    actor.set_actor_label(label)
    hism = actor.add_component_by_class(unreal.HierarchicalInstancedStaticMeshComponent, False, unreal.Transform(), False)
    hism.set_static_mesh(sm)
    hism.add_instances(transforms, False)
    unreal.log(f"Spawned {len(transforms)} instances of {asset_name} -> {label}")

def run():
    # 1) 105 Poly Haven Photogrammetry Rocks (nearshore reefs + coastal talus)
    with open(os.path.join(EXPORT_DIR, "rock_points.json"), "r", encoding="utf-8") as f:
        rock_data = json.load(f)
    by_rock = {}
    for item in rock_data["instances"]:
        rx, ry, rz = [math.degrees(a) for a in item["rot_xyz_rad"]]
        rot = unreal.Rotator(rx, -ry, -rz)
        scl = unreal.Vector(*item["scale"])
        by_rock.setdefault(item["asset"], []).append(unreal.Transform(b_pos_to_ue(item["pos"]), rot, scl))
    for asset, xforms in by_rock.items():
        spawn_hism_actor(f"HISM_Rocks_{asset}", asset, xforms)

    # 2) 13 Outer-Sea Illusion Buoys
    with open(os.path.join(EXPORT_DIR, "anchors_ue.json"), "r", encoding="utf-8") as f:
        anc_data = json.load(f)
    buoy_xforms = [
        unreal.Transform(unreal.Vector(*b["ue5_cm"]), unreal.Rotator(0, 0, 0), unreal.Vector(1, 1, 1))
        for b in anc_data["buoys_13"]
    ]
    spawn_hism_actor("HISM_IllusionBuoys_13", "SM_Buoy_Prototype", buoy_xforms)

    # 3) 133,687 Tropical Rainforest / Palm / TreeFern / Shrub / LakesideGrass Instances
    with open(os.path.join(EXPORT_DIR, "foliage_points.json"), "r", encoding="utf-8") as f:
        fol_data = json.load(f)
    by_fol = {}
    for item in fol_data["instances"]:
        w, x, y, z = item["rot_wxyz"]
        # Mirror Y for right-handed -> left-handed quaternion conversion
        q = unreal.Quat(x, -y, z, w)
        rot = q.rotator()
        scl = unreal.Vector(*item["scale"])
        by_fol.setdefault(item["asset"], []).append(unreal.Transform(b_pos_to_ue(item["pos"]), rot, scl))
    for asset, xforms in by_fol.items():
        spawn_hism_actor(f"HISM_Foliage_{asset}", asset, xforms)

if __name__ == "__main__":
    run()
'''
    ue_py_path = os.path.join(OUT_DIR, "ue5_import_instances.py")
    with open(ue_py_path, "w", encoding="utf-8") as f:
        f.write(ue_py)
    return anc_path, ue_py_path


def verify_fbx_roundtrip(mesh_results):
    """Re-import key FBXs into a clean empty Blender scene and verify exact 1:1 dimensions (no 100x scale bug)."""
    check_list = [
        "SM_Island_Terrain_Nanite.fbx",
        "SM_Hero_SouthSwordPeak.fbx",
        "SM_Hero_SeaArch.fbx",
        "SM_Rock_PH_Boulder01.fbx",
        "SM_Rock_PH_CliffOutcrop.fbx",
        "SM_Tree_TropicalPalm_01.fbx",
        "SM_Water_CurtainFalls.fbx",
    ]
    qa_out = {}
    all_ok = True
    for fname in check_list:
        fpath = os.path.join(OUT_MESH, fname)
        exp = mesh_results[fname]["expected_dims_m"]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = "METRIC"
        bpy.context.scene.unit_settings.scale_length = 1.0
        bpy.ops.import_scene.fbx(filepath=fpath)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if not meshes:
            qa_out[fname] = {"pass": False, "error": "no mesh imported"}
            all_ok = False
            continue
        ob = meshes[0]
        got = [round(float(d), 3) for d in ob.dimensions]
        # Compare sorted dimensions or exact XYZ (FBX -Z/+Y round-trips back cleanly into Blender Z-up)
        rel_errs = [abs(g - e) / max(e, 0.01) for g, e in zip(got, exp)]
        max_rel = max(rel_errs)
        passed = max_rel < 0.015 and len(ob.data.polygons) > 0 and len(ob.data.uv_layers) >= 1
        if not passed:
            all_ok = False
        qa_out[fname] = {
            "pass": passed,
            "expected_dims_m": exp,
            "roundtrip_dims_m": got,
            "max_rel_err": round(max_rel, 5),
            "tris": len(ob.data.polygons),
            "uv_layers": len(ob.data.uv_layers),
            "scale_on_import": [round(float(s), 4) for s in ob.scale],
        }
    return all_ok, qa_out


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    with open(os.path.join(DATA_DIR, "island.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    hf = np.fromfile(os.path.join(DATA_DIR, "height.bin"), dtype="<i2").astype(np.float32) * float(meta["heightScale"])
    mat_ids = np.fromfile(os.path.join(DATA_DIR, "mat.bin"), dtype=np.uint8)

    # 1) Export UE5 16-bit Landscape Heightmap + 5 Weightmaps + Splat RGBA
    land_params = export_ue5_landscape(meta, hf, mat_ids)

    # 2) Export all 28 UE5 StaticMesh / Nanite FBXs
    mesh_results = export_all_ue5_meshes()

    # 3) Export all UE5 PBR Textures (sRGB BC + DirectX G-flipped Normal + ORM Packed + Sky HDR)
    tex_files = export_ue5_textures()

    # 4) Export Anchors JSON (m + UE cm) + ready-to-run UE5 Editor Python instance spawner
    anc_path, ue_py_path = export_anchors_and_ue5_script(meta)

    # 5) Mandatory Round-Trip FBX Scale Verification in empty scene
    rt_ok, rt_qa = verify_fbx_roundtrip(mesh_results)

    report = {
        "ok": bool(rt_ok and land_params["roundtrip_qa"]["pass"]),
        "stage": 5,
        "export_dir": OUT_DIR,
        "landscape": land_params,
        "meshes_exported_count": len(mesh_results),
        "meshes": mesh_results,
        "textures_exported_count": len(tex_files),
        "textures": tex_files,
        "anchors_json": anc_path,
        "ue5_python_spawner": ue_py_path,
        "fbx_roundtrip_pass": rt_ok,
        "fbx_roundtrip_qa": rt_qa,
    }
    report_path = os.path.join(OUT_DIR, "export_qa_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print("@@JSON@@" + json.dumps({
        "ok": report["ok"],
        "stage": 5,
        "landscape_roundtrip": land_params["roundtrip_qa"],
        "meshes_count": len(mesh_results),
        "textures_count": len(tex_files),
        "fbx_roundtrip_pass": rt_ok,
        "fbx_roundtrip_qa": rt_qa,
        "report": report_path,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
