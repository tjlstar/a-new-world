# 岛屿基地 3.3 · Unreal Engine 5 完整导入指南

> 本资产包由 Blender 5.3（[island_env.blend](../island_env.blend)）按 Unreal Engine 5 生产规范自动导出，所有 FBX 网格均通过空场景 1:1 尺寸回读校验（误差 `0.0%`），16-bit 高度图往返精度误差 `< 0.01 m`。

---

## 1. 导出包目录总览（共 73 个文件）

| 目录 / 文件 | 内容 | 用途 |
|---|---|---|
| `landscape/` | `T_Island_Heightmap_16bit.png`（1009×1009 16-bit 灰度）<br>`Weightmap_{Forest,LakesideGrass,Basalt,WhiteSand,Seabed}.png`<br>`T_Landscape_Splat_RGBA.png`<br>`landscape_import_params.json` | UE5 原生 Landscape 地形与 5 层自动地表权重 |
| `meshes/` | **28 个 UE5 预设 FBX**：<br>• `SM_Island_Terrain_Nanite.fbx`（可选 Nanite 地形网格，878K 三角面）<br>• 标志性岩体：`SM_Hero_SouthSwordPeak`、`SM_Hero_SeaArch`、`SM_Hero_Spire_{MainCliff,West,East}`、`SM_SeaStack_01..05`、`SM_Buoy_Prototype`<br>• 4 款 Poly Haven 2K 扫描岩石原型：`SM_Rock_PH_{Boulder01,CoastReef05,Boulder03,CliffOutcrop}`<br>• 水系 6 件：`SM_Water_{Ocean,MirrorLake,WhitewaterRiver,CurtainFalls,PlungeFoam,BeachSurf}`<br>• 6 类热带植被原型：`SM_Tree_CloudForest_01/02`、`SM_Tree_TropicalPalm_01`、`SM_Tree_Fern_01`、`SM_Bush_Tropical_01`、`SM_Grass_Meadow_01` | 直接拖入 UE5 `/Game/Island/Meshes/` |
| `textures/` | **31 张 UE5 规范贴图**：<br>• 4 套 2K 玄武岩（`Basalt_DarkRock`、`Basalt_DarkRock02`、`Basalt_LichenRock`、`Basalt_AerialRocks04`）<br>• 4 套 2K Poly Haven 岩石贴图（漫反射已预调为冷黑玄武岩：`PH_Boulder01`、`PH_CoastReef05`、`PH_Boulder03`、`PH_CliffOutcrop`）<br>• 2 套地表贴图（`Terrain_WhiteSand`、`Terrain_ForestGround`）<br>• 每套均含 `_BC.png`（sRGB）、`_N_DX.png`（DirectX 已翻转 G 通道）、`_ORM.png`（R=AO, G=Rough, B=Metallic=0）<br>• `T_Sky_IslandDay.hdr`（晴日 HDRI 天空球） | 拖入 UE5 `/Game/Island/Textures/` |
| `foliage_points.json` | 133,687 个多层次热带植被实例变换表（6 类物种） | 供 `ue5_import_instances.py` 或 PCG 一键生成 |
| `rock_points.json` | 105 处 Poly Haven 扫描礁石与海岸崩积岩体变换表 | 供 `ue5_import_instances.py` 或 PCG 一键生成 |
| `anchors_ue.json` | 全岛地标、**预留崖宅与营房锚点**、13 座浮标、验收相机与东南向日光参数（同时给米制与 UE 厘米坐标） | 精准定位与后续建筑嵌入 |
| `ue5_import_instances.py` | UE5 Editor Python 一键实例化脚本（生成 HISM） | 在 UE5 编辑器内 10 秒还原全部岩石、浮标与 13 万株植被 |

---

## 2. 第一步：导入地形（二选一，或双方案对比）

### 方案 1（推荐）：导入 UE5 原生 Landscape
1. 在 UE5 中切换至 **Landscape Mode → Manage → New → Import from File**。
2. 选择 `landscape/T_Island_Heightmap_16bit.png`（`1009 × 1009`）。
3. 严格填入以下参数（来自 `landscape_import_params.json`，海平面严格位于 `Z = 0.0 cm`）：
   - **Section Size**：`63×63 Quads`
   - **Sections Per Component**：`1×1 Section`
   - **Number of Components**：`16×16`（总分辨率 `1009×1009`）
   - **Location (cm)**：`X = 0.0`, `Y = 0.0`, **`Z = -16840.816`**
   - **Rotation**：`0, 0, 0`
   - **Scale**：**`X = 500.0`, `Y = 500.0`, `Z = 246.71556`**
4. 创建包含 `Forest`、`LakesideGrass`、`Basalt`、`WhiteSand`、`Seabed` 五层的 Landscape Material 后，在 **Layers** 面板分别右键 **Import from File** 载入对应的 `Weightmap_*.png`。

### 方案 2（最快预览）：直接放置 Nanite 地形网格
- 将 `meshes/SM_Island_Terrain_Nanite.fbx` 导入并勾选 **Build Nanite**，直接拖入场景并将 Transform 设为 **`(0, 0, 0)`、Scale `(1, 1, 1)`**，无需任何换算即可与所有 Hero Rocks、水系和 13 万株植被 **1:1 像素级严丝合缝对齐**。

---

## 3. 第二步：导入静态网格（FBX）与放置世界对象

1. 将 `meshes/*.fbx` 全部导入 `/Game/Island/Meshes/`，导入设置如下：
   - **Convert Scene / Convert Scene Unit**：保持默认开启（FBX 已使用 `FBX_SCALE_UNITS` 米制头信息，自动 1:1 转为厘米，绝无 100× 缩放错误）。
   - **Build Nanite**：对**所有岩石与地形**开启（`SM_Island_Terrain_Nanite`、`SM_Hero_*`、`SM_SeaStack_*`、`SM_Rock_PH_*`、`SM_Buoy_Prototype`）；对**半透明水体**（`SM_Water_*`）保持关闭；对**植被原型**（`SM_Tree_*`、`SM_Bush_*`、`SM_Grass_*`）可开启 Nanite 并勾选 **Preserve Area**。
   - **Import Normals & Tangents**：选择 **Import Normals and Tangents**。
   - **Generate Lightmap UVs**：如使用 Lumen 动态光可关闭；若计划烘焙光照则开启。
2. **一键对齐世界坐标对象**：以下对象导出时已保留世界原点偏移，直接全选拖入关卡并将 Location 归零 **`(0, 0, 0)`** 即可自动落位到精确地理坐标：
   - `SM_Hero_SouthSwordPeak`、`SM_Hero_SeaArch`、`SM_Hero_Spire_MainCliff/West/East`、`SM_SeaStack_01..05`
   - `SM_Water_Ocean`、`SM_Water_MirrorLake`、`SM_Water_WhitewaterRiver`、`SM_Water_CurtainFalls`、`SM_Water_PlungeFoam`、`SM_Water_BeachSurf`

---

## 4. 第三步：UE5 贴图压缩规范与四贴图玄武岩材质

将 `textures/` 导入 `/Game/Island/Textures/` 后，检查以下 3 类压缩设置（**务必核对，避免发灰或法线反光错误**）：

| 后缀 | sRGB | Compression Settings | 备注 |
|---|---|---|---|
| `T_*_BC.png` | **✅ 勾选** | `Default (DXT1/5)` | 4 套 `T_PH_*_BC.png` 已按火山黑玄武岩预调色，直连即可融入全岛 |
| `T_*_N_DX.png` | **⬜ 取消勾选** | `Normalmap (DXT5)` | 已转为 **DirectX**（绿通道已翻转），UE5 中**不要**再勾 Flip Green Channel |
| `T_*_ORM.png` | **⬜ 取消勾选** | `Masks (no sRGB)` | `R` → Ambient Occlusion、`G` → Roughness、`B` → Metallic（恒 0） |

**全岛玄武岩主材质建议（复刻 Blender 4 贴图防重复体系）**：
- 使用 **WorldAlignedTexture（三平面世界坐标）**：
  - 近景主纹理：`T_Basalt_DarkRock`（World Tile `650 cm`）
  - 熔岩层理变化：`T_Basalt_DarkRock02`（World Tile `520 cm`，按世界 `Z` 噪声混合）
  - **80 m 远景防重复**：`T_Basalt_AerialRocks04`（World Tile **`8000 cm`**，按 `0.44` 权重叠加至 BaseColor 与 Roughness，463 m 主崖远看零重复）
  - 浪溅湿岩与高坡苔藓：`T_Basalt_LichenRock`（`Z < 1400 cm` 降低 Roughness 至 `0.22` 并压暗颜色；`Z > 9500 cm` 且 `VertexNormalWS.Z > 0.3` 混入高坡云雾苔藓）

---

## 5. 第四步：一键还原 133,687 株植被、105 处扫描礁石与 13 座浮标

1. 在 UE5 中启用插件 **Python Editor Script Plugin**（Edit → Plugins）。
2. 确保所有 FBX 已导入 `/Game/Island/Meshes/`（若路径不同，修改 `ue5_import_instances.py` 顶部 `MESH_CONTENT_PATH`）。
3. 菜单栏点击 **Tools → Execute Python Script**，选择 `blender/export_ue/ue5_import_instances.py` 运行：
   - 自动创建按物种分组的 **Hierarchical Instanced Static Mesh (HISM)** Actor：
     - `HISM_Rocks_*`：105 处黑砾湾近岸礁石与海岸崩积岩体
     - `HISM_IllusionBuoys_13`：13 座外海 2.18–3.25 km 拟礁浮标
     - `HISM_Foliage_*`：133,687 株闭郁云雾林、热带棕榈、巨型树蕨、阔叶灌丛与镜湖湖滨草岸
4. **后续素材升级提示**：在任意 `HISM_Foliage_*` 组件的 Details 面板中，将 `Static Mesh` 槽一键替换为 **Fab / Quixel Megascans** 热带乔木/棕榈/蕨类资产，即可保留全部 13 万株精准生态分布而瞬间升级至电影级植被！

---

## 6. 第五步：东南向晴日光照（晴日南崖受光）与预留建筑锚点

- **DirectionalLight（晴日东南日光）**：
  - Rotation：`Roll = 0.0°`, **`Pitch = -48.0°`**, **`Yaw = -143.8°`**（光线自东南照向西北，南崖主壁与南剑峰明亮受光）。
  - 配合 `SkyAtmosphere` + `VolumetricCloud` + `SkyLight`（可选载入 `T_Sky_IslandDay.hdr`）+ `ExponentialHeightFog`（轻微海雾）。
- **预留未建模建筑锚点（详见 `anchors_ue.json`）**：
  - **崖宅预留槽口** `LOC_Villa_Anchor_Reserved`：UE5 坐标 **`(-22000.0, 125000.0, 42600.0)` cm**（`+412~+440 m` 崖面已保持平直无遮挡）
  - **岩隙营房预留区** `LOC_Barracks_Reserved`：UE5 坐标 **`(-85000.0, -15000.0, 19660.0)` cm**（周边 `30 m` 已净空避让植被）
