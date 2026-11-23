"""
Unreal Engine 5 Editor Python Script: Spawn Island 3.3 Rocks (105), Buoys (13), and Foliage (133,687)
Usage in UE5 Editor:
  1. Import all FBX files from blender/export_ue/meshes/ into /Game/Island/Meshes/
  2. Enable the "Python Editor Script Plugin" in UE5.
  3. Update EXPORT_DIR below if needed, then run via Tools -> Execute Python Script.
"""
import json, math, os
import unreal

EXPORT_DIR = r"C:\Users\wsbyb\OneDrive\Dokumen\Projects\A new world\blender\export_ue"
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
