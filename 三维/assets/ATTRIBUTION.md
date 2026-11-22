# 场景公开素材

场景使用 Poly Haven 的 [CC0 素材](https://polyhaven.com/license)。所有运行时素材均随项目本地提供。

| 素材 | 场景用途 |
|---|---|
| [Coast Sand 03](https://polyhaven.com/a/coast_sand_03) | 火山砂滩的砂粒及湿砂 |
| [Coast Sand Rocks 02](https://polyhaven.com/a/coast_sand_rocks_02) | 岸边崩积岩与碎石 |
| [Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | 林地土壤与碎石 |
| [Rock Face 03](https://polyhaven.com/a/rock_face_03) | 全岛岩壁的 2K 颜色、法线、粗糙度与位移贴图 |
| [Island Tree 01](https://polyhaven.com/a/island_tree_01) | 近景使用保留树干和枝条的轻量 GLB，叶片按原模型冠层分布放置。远景使用 Blender 烘焙的两个侧视角和一个冠顶视角 |
| [Kloofendal 48d Partly Cloudy](https://polyhaven.com/a/kloofendal_48d_partly_cloudy) | 云层、天空光与环境反射 |

前三套表面素材各有三张 1K 贴图，下载地址与 MD5 在 `textures/sources.json`。岩壁贴图、树冠烘焙图和 HDR 天空位于 `landscape/`。程序化建模提供草丛、岸石和地形，岩壁细分时在面内叠加扫描高度起伏。岛屿地貌与地标按《岛屿设定.md》定位。

使用 `node 三维/server.mjs` 启动本地漫游。地形测试为 `node --test 三维/tests/environment.test.mjs`。
