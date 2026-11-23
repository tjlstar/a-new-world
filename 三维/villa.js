// 岩内四层崖宅，面海一侧开幕墙和独立舱口。

export function buildVilla({ THREE, scene, meta, G, hm, terrainGeo, terrainMesh, texRock, worldOf }) {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const [coastX, coastZ] = worldOf(meta.villa.p);
  const nx = meta.villa.n[0], nz = -meta.villa.n[1]; // 指向南侧外海 (+w, Three.js +Z 为南)
  const tx = nz, tz = -nx;                           // 沿崖壁横向 (+u 向东, 右手正交基 det = +1)

  // 将崖宅基准面 (w = 0) 锚定在主崖岬上层绝壁 +412~+440 m 岩槽立面上
  const slotDist = meta.villa.slotDistM + 2;
  const ox = coastX - nx * slotDist;
  const oz = coastZ - nz * slotDist;

  // 局部坐标 (u, y, w) <-> 世界坐标 (wx, y, wz)
  const toWorld = (u, y, w) => [ox + tx * u + nx * w, y, oz + tz * u + nz * w];
  const toLocal = (wx, wz) => {
    const dx = wx - ox, dz = wz - oz;
    return [dx * tx + dz * tz, dx * nx + dz * nz];
  };
  const sampleGridH = (wx, wz) => {
    const fx = clamp((wx / 1000 - G.x0) / G.step, 0, G.nx - 1.001);
    const fz = clamp((-wz / 1000 - G.y0) / G.step, 0, G.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, w = G.nx;
    const h00 = hm[j * w + i] * 0.1, h10 = hm[j * w + i + 1] * 0.1;
    const h01 = hm[(j + 1) * w + i] * 0.1, h11 = hm[(j + 1) * w + i + 1] * 0.1;
    return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
  };

  // 四层关键标高 (严格对应《岛屿设定.md》第 6 节: +412 ~ +440 m, 高差 28 m, 宽 34 m)
  const Y_ANCHOR = 412.0; // 底缘轻薄折角腹板收束锚固标高
  const Y_LAB    = 413.0; // 底部重工实验舱地面与飞行器出口
  const Y_HALL1  = 423.0; // 中央钢化玻璃幕墙主厅 下层 (挑高 6m)
  const Y_HALL2  = 429.0; // 中央钢化玻璃幕墙主厅 上层 (挑高 6m)
  const Y_CROWN  = 435.0; // 岩内观测层地面 (观测哨 & 通往火山口盆地的山体后通道)
  const Y_TOP    = 440.0; // 冠层冷灰钛金属顶盖上缘

  // 自动探测北侧火山口内壁穿出位置 (沿 w < 0 向北穿过狭窄刀刃山脊, 找到北坡海拔降至 ~434m 处)
  let northPortalW = -68;
  for (let w = -26; w >= -135; w -= 2) {
    const [wx, , wz] = toWorld(0, Y_CROWN, w);
    const gh = sampleGridH(wx, wz);
    if (w < -36 && gh <= Y_CROWN - 0.5) {
      northPortalW = w;
      break;
    }
  }
  const northDeckEndW = northPortalW; // 北坡岩口

  // ── 修饰地形网格: 在南侧 +412~+440m 处削出规整嵌岩槽口, 并在北坡后廊出口削平门洞, 绝不动 411m 以下原始绝壁 ──
  {
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i), wy = pos.getY(i), wz = pos.getZ(i);
      if (wy < 350) continue;
      const [u, w] = toLocal(wx, wz);
      // 将局部粗网格顺接到近乎垂直的玄武岩面。岩面略向内倾，中心与玻璃齐平。
      const blend = clamp((30 - Math.abs(u)) / 10, 0, 1) * clamp((22 - Math.abs(w)) / 8, 0, 1);
      if (blend > 0) {
        const faceW = 2.4 - (wy - 429) * 0.014;
        const [x, , z] = toWorld(u, wy, w + blend * (faceW - w));
        pos.setX(i, x);
        pos.setZ(i, z);
      }
      // 北侧后山廊道穿出口削坡
      if (Math.abs(u) < 5.5 && w < northPortalW + 6 && w > northDeckEndW - 5 && wy > Y_CROWN - 1.5 && wy < Y_CROWN + 7.5) {
        pos.setY(i, Math.min(wy, Y_CROWN - 0.35));
      }
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  }

  // 在岩面和投影中使用相同的两个开口，保留二者之间的天然岩带。
  function cutOpenings(shader) {
    shader.uniforms.villaFrame = { value: new THREE.Vector4(ox, oz, tx, tz) };
    const vertex = 'varying vec3 vCliff;\nuniform vec4 villaFrame;\n';
    shader.vertexShader = vertex + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec2 offset = position.xz - villaFrame.xy;
      vCliff = vec3(dot(offset, villaFrame.zw), position.y, dot(offset, vec2(-villaFrame.w, villaFrame.z)));
    `);
    shader.fragmentShader = 'varying vec3 vCliff;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      bool windowOpening = abs(vCliff.x) < 15.4 && vCliff.y > 422.85 && vCliff.y < 435.08;
      bool craftOpening = abs(vCliff.x - 6.0) < 6.0 && vCliff.y > 412.95 && vCliff.y < 419.0;
      if (vCliff.z > -28.0 && vCliff.z < 24.0 && (windowOpening || craftOpening)) discard;
    `);
  }
  terrainMesh.material.onBeforeCompile = cutOpenings;
  terrainMesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  terrainMesh.customDepthMaterial.onBeforeCompile = cutOpenings;

  // ── 材质体系: 轻薄冷灰拉丝钛金属、深色防弹钢化玻璃、暖琥珀室内灯带、玄武岩洞壁 ──
  const mTiSheath = new THREE.MeshStandardMaterial({
    color: 0x8e9ba6, roughness: 0.34, metalness: 0.78,
  });
  const mTiDark = new THREE.MeshStandardMaterial({
    color: 0x3b4650, roughness: 0.42, metalness: 0.72,
  });
  const mTiDeck = new THREE.MeshStandardMaterial({
    color: 0x76838e, roughness: 0.48, metalness: 0.62,
  });
  const mGlass = new THREE.MeshPhysicalMaterial({
    color: 0x1e3342, roughness: 0.08, metalness: 0.12,
    transmission: 0.58, transparent: true, opacity: 0.76, reflectivity: 0.9,
  });
  const mFloorWarm = new THREE.MeshStandardMaterial({
    color: 0x3a3530, roughness: 0.58, metalness: 0.15,
  });
  const mFloorLab = new THREE.MeshStandardMaterial({
    color: 0x2c333a, roughness: 0.52, metalness: 0.38,
  });
  const mWallInner = new THREE.MeshStandardMaterial({
    color: 0x4b525a, roughness: 0.65, metalness: 0.22,
  });
  const mRockSlot = new THREE.MeshStandardMaterial({
    color: 0x3e434a, map: texRock, roughness: 0.92, metalness: 0.04,
  });
  const mAmber = new THREE.MeshStandardMaterial({
    color: 0xffcf7c, emissive: 0xf0a23b, emissiveIntensity: 2.1, roughness: 0.25,
  });
  const mCyanCore = new THREE.MeshStandardMaterial({
    color: 0x9ef3ff, emissive: 0x3ec6e0, emissiveIntensity: 2.6, roughness: 0.18,
  });
  const mHolo = new THREE.MeshStandardMaterial({
    color: 0x6ce3ff, emissive: 0x2ca8cc, emissiveIntensity: 1.6, transparent: true, opacity: 0.72, roughness: 0.2,
  });
  const mFurnDark = new THREE.MeshStandardMaterial({
    color: 0x272c32, roughness: 0.68, metalness: 0.18,
  });
  const mWood = new THREE.MeshStandardMaterial({
    color: 0x694c35, roughness: 0.55, metalness: 0.08,
  });

  const root = new THREE.Group();
  root.position.set(ox, 0, oz);
  // 令 root 局部坐标 +X = +u (tx, 0, tz), +Y = +y (海拔), +Z = +w (nx, 0, nz 朝南外海)
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(tx, 0, tz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(nx, 0, nz),
  );
  root.quaternion.setFromRotationMatrix(basis);
  scene.add(root);

  const box = (sx, sy, sz, x, y, z, mat, parent = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // 观测层与屋顶位于岩面之后。
  box(31, 0.45, 18, 0, Y_TOP - 0.24, -7.6, mWallInner);
  // 冠层地板 (留出楼梯与电梯口)
  box(19.6, 0.45, 18.5, 5.6, Y_CROWN - 0.22, -6.8, mFloorWarm);
  box(9.8, 0.45, 10.5, -10.5, Y_CROWN - 0.22, -2.8, mFloorWarm);
  // 冠层内高崖警戒观测台与全息通讯列阵
  box(11.0, 0.85, 1.4, 1.5, Y_CROWN + 0.42, 0.6, mFurnDark);
  box(9.6, 0.08, 0.45, 1.5, Y_CROWN + 0.90, 0.55, mHolo);
  box(24.0, 0.12, 0.22, 0, Y_TOP - 1.02, -1.5, mAmber); // 冠层暖光灯带

  // 通往火山口盆地的山体后通道 (w: -16 -> northPortalW, 宽 5.4m, 高 3.4m)
  const corrLen = -16 - northPortalW;
  const corrMidW = (-16 + northPortalW) * 0.5;
  box(5.6, 0.45, corrLen + 2, 0, Y_CROWN - 0.22, corrMidW, mFloorLab);
  box(5.8, 0.55, corrLen + 2, 0, Y_CROWN + 3.55, corrMidW, mRockSlot);
  for (const sgn of [-1, 1]) {
    box(0.65, 3.8, corrLen + 2, sgn * 2.95, Y_CROWN + 1.65, corrMidW, mRockSlot);
  }
  // 廊道顶部等距远古拟岩肋拱与琥珀导引灯条
  for (let w = -20; w >= northPortalW + 3; w -= 8) {
    box(5.4, 0.28, 0.45, 0, Y_CROWN + 3.22, w, mTiDark);
    box(3.2, 0.10, 0.18, 0, Y_CROWN + 3.06, w, mAmber);
  }
  // 后廊出口收在北坡岩面以内。
  // ═══════════════════════════════════════════════════════════════
  // 3. 中央两层防弹钢化玻璃幕墙主厅 (423 ~ 435 m, 每层 6m)
  // ═══════════════════════════════════════════════════════════════
  // 两层通高玻璃，下层中央留通向阳台的门洞。
  for (const sign of [-1, 1]) {
    box(14.2, 11.8, 0.16, sign * 8.3, 429, 2.25, mGlass);
  }
  box(2.4, 9.1, 0.16, 0, 430.35, 2.25, mGlass);
  for (const u of [-15.32, -10, -5, -1.2, 1.2, 5, 10, 15.32])
    box(0.12, 12, 0.18, u, 429, 2.25, mTiDark);
  box(30.8, 0.18, 0.2, 0, Y_HALL2, 2.25, mTiDark);

  // 唯一外挑的观海阳台：8 m 宽，幕墙前 2 m。
  box(8, 0.22, 2.2, 0, Y_HALL1 - 0.11, 3.15, mTiDeck);
  box(8, 1.08, 0.07, 0, Y_HALL1 + 0.54, 4.21, mGlass);
  box(8, 0.05, 0.09, 0, Y_HALL1 + 1.08, 4.21, mTiDark);
  for (const sign of [-1, 1]) {
    box(0.07, 1.08, 2, sign * 3.96, Y_HALL1 + 0.54, 3.25, mGlass);
  }

  // 主厅下层地板 (423m, w ∈ [-28, +2.2], u ∈ [-15.4, +15.4])
  box(30.8, 0.5, 30.2, 0, Y_HALL1 - 0.25, -12.9, mFloorWarm);
  // 主厅后方岩体内壁与分隔墙
  box(31.2, 12.4, 0.8, 0, 429.0, -28.2, mWallInner);
  for (const sgn of [-1, 1]) box(0.7, 12.4, 26.5, sgn * 15.5, 429.0, -15.0, mWallInner);

  // 主厅上层楼板 (429m): 前方留出 u ∈ [-8.5, +8.5], w ∈ [-2.5, +2.2] 的双层挑高观海中庭!
  box(30.8, 0.45, 25.5, 0, Y_HALL2 - 0.22, -15.25, mFloorWarm);
  box(6.9, 0.45, 4.8, -11.95, Y_HALL2 - 0.22, -0.1, mFloorWarm);
  box(6.9, 0.45, 4.8,  11.95, Y_HALL2 - 0.22, -0.1, mFloorWarm);
  // 上层中庭玻璃护栏
  box(17.0, 1.05, 0.12, 0, Y_HALL2 + 0.52, -2.55, mGlass);
  box(17.2, 0.10, 0.18, 0, Y_HALL2 + 1.06, -2.55, mTiSheath);
  for (const sgn of [-1, 1]) {
    box(0.12, 1.05, 4.7, sgn * 8.5, Y_HALL2 + 0.52, -0.2, mGlass);
    box(0.18, 0.10, 4.7, sgn * 8.5, Y_HALL2 + 1.06, -0.2, mTiSheath);
  }

  // 室内陈设 — 下层 (423m): 全息海岛战术沙盘 + 观海会客沙发组 + 餐吧
  box(3.8, 0.82, 2.4, 0, Y_HALL1 + 0.41, -1.8, mFurnDark);
  box(3.2, 0.08, 1.8, 0, Y_HALL1 + 0.86, -1.8, mHolo);
  // 沙盘微缩破火山口地形立柱示意
  const miniPeak = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.65, 6), mHolo);
  miniPeak.position.set(-0.2, Y_HALL1 + 1.22, -2.0);
  root.add(miniPeak);
  // L 型低矮观海沙发与长案
  box(6.8, 0.55, 1.5, 0, Y_HALL1 + 0.28, -5.6, mFurnDark);
  box(1.5, 0.55, 4.2, 4.2, Y_HALL1 + 0.28, -4.2, mFurnDark);
  box(5.5, 1.05, 1.1, 8.8, Y_HALL1 + 0.52, -10.5, mWood); // 饮品料理吧台

  // 室内陈设 — 上层 (429m): 岛主书房、宽幅战略指挥屏与后方岩内私密卧舱
  box(4.6, 0.78, 1.5, 3.5, Y_HALL2 + 0.39, -5.8, mWood); // 岛主书桌
  box(9.2, 3.2, 0.25, 3.5, Y_HALL2 + 2.3, -13.6, mFurnDark); // 战略主屏背板
  box(8.6, 2.7, 0.08, 3.5, Y_HALL2 + 2.3, -13.44, mHolo);
  // 后方私密居住舱隔墙与卧榻 (w ∈ [-27.5, -14.2])
  box(22.0, 5.6, 0.35, 3.8, Y_HALL2 + 2.8, -14.0, mWallInner); // 留出左侧走道门洞
  box(3.8, 0.62, 4.4, 8.5, Y_HALL2 + 0.31, -21.5, mWood);
  box(3.4, 0.28, 3.8, 8.5, Y_HALL2 + 0.72, -21.3, new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.8 }));

  // 双层主厅琥珀色克制暖光灯带与点光源
  for (const yL of [Y_HALL1 + 5.65, Y_HALL2 + 5.45]) {
    for (const wL of [-1.2, -8.5, -18.5]) {
      box(25.0, 0.12, 0.24, 0, yL, wL, mAmber);
    }
  }
  const hallLight1 = new THREE.PointLight(0xffb95e, 3.2, 46, 1.4);
  hallLight1.position.set(0, Y_HALL1 + 4.5, -3.0);
  root.add(hallLight1);
  const hallLight2 = new THREE.PointLight(0xffb95e, 2.6, 42, 1.4);
  hallLight2.position.set(2, Y_HALL2 + 4.4, -7.0);
  root.add(hallLight2);

  // ═══════════════════════════════════════════════════════════════
  // 4. 底部重工实验舱 (412 ~ 423 m, 纵深 60m)与岩壁出口
  // ═══════════════════════════════════════════════════════════════
  // 重工实验舱地面 (w ∈ [-60, 0], u ∈ [-15.4, +15.4])
  box(30.8, 0.6, 60.0, 0, Y_LAB - 0.3, -30.0, mFloorLab);
  // 重工实验舱玄武岩+装甲内衬侧壁、后端壁与顶板
  box(31.4, 10.2, 1.0, 0, 418.0, -60.2, mRockSlot);
  box(31.2, 0.6, 33.0, 0, 422.7, -43.5, mWallInner);
  for (const sgn of [-1, 1]) {
    box(0.9, 10.0, 60.0, sgn * 15.5, 418.0, -30.0, mWallInner);
  }
  // 舱顶重型桥式吊车双主梁与横移葫芦
  for (const sgn of [-1, 1]) box(0.55, 0.9, 56.0, sgn * 13.6, 421.4, -29.0, mTiDark);
  box(27.6, 0.75, 1.2, 0, 420.8, -22.0, mTiSheath);
  box(2.2, 1.1, 1.6, -3.5, 419.9, -22.0, mAmber);
  // 舱内顶灯条
  for (let w = -8; w >= -54; w -= 11) box(22.0, 0.14, 0.30, 0, 422.1, w, mAmber);

  // 远古能量核心 (u = 8.2, w = -46.0): 悬浮发光多面体 + 双层旋转磁约束环
  const coreGroup = new THREE.Group();
  coreGroup.position.set(8.2, Y_LAB + 4.2, -46.0);
  root.add(coreGroup);
  // 基座与顶吸能柱
  box(5.6, 0.7, 5.6, 8.2, Y_LAB + 0.35, -46.0, mTiDark);
  box(4.2, 0.8, 4.2, 8.2, Y_LAB + 8.6, -46.0, mTiDark);
  const coreOct = new THREE.Mesh(new THREE.OctahedronGeometry(1.65, 1), mCyanCore);
  coreGroup.add(coreOct);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.16, 12, 42), mTiSheath);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.14, 12, 48), mTiDark);
  ring2.rotation.x = Math.PI * 0.38;
  coreGroup.add(ring1, ring2);
  const coreLight = new THREE.PointLight(0x52d8f5, 3.5, 38, 1.5);
  coreGroup.add(coreLight);

  // 岩面开口下沿与舱内地面相接，短侧壁和顶衬给舱口以进深。
  box(12, 0.25, 6.5, 6, Y_LAB - 0.125, -0.75, mFloorLab);
  box(12, 0.25, 6.5, 6, 419.12, -0.75, mRockSlot);
  for (const u of [0, 12]) box(0.22, 6, 6.5, u, 416, -0.75, mRockSlot);
  function buildCraft(cx, cy, cz, yaw = 0) {
    const g = new THREE.Group();
    g.position.set(cx, cy, cz);
    g.rotation.y = yaw;
    const hullM = new THREE.MeshStandardMaterial({ color: 0x9aa8b4, roughness: 0.28, metalness: 0.82 });
    const canopyM = new THREE.MeshStandardMaterial({ color: 0x152532, roughness: 0.12, metalness: 0.4 });
    // 机身棱锥体
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.45, 7.6, 6), hullM);
    body.rotation.x = Math.PI * 0.5;
    body.scale.set(1.15, 1.0, 0.48);
    body.position.y = 1.05;
    g.add(body);
    // 掠翼与垂尾
    box(6.8, 0.16, 2.4, 0, 0.98, -0.6, hullM, g);
    for (const s of [-1, 1]) {
      const fin = box(0.14, 1.15, 1.6, s * 2.9, 1.45, -1.2, mTiDark, g);
      fin.rotation.z = -s * 0.35;
      box(0.45, 0.35, 2.2, s * 1.35, 0.85, -1.5, mTiDark, g);
      box(0.32, 0.22, 0.12, s * 1.35, 0.85, -2.62, mCyanCore, g);
    }
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 10), canopyM);
    canopy.scale.set(0.82, 0.48, 1.85);
    canopy.position.set(0, 1.32, 0.65);
    g.add(canopy);
    // 三点起落架
    for (const [lx, lz] of [[0, 2.1], [-1.4, -1.3], [1.4, -1.3]]) {
      box(0.14, 0.65, 0.14, lx, 0.35, lz, mTiDark, g);
      box(0.35, 0.12, 0.45, lx, 0.06, lz, mFurnDark, g);
    }
    root.add(g);
  }
  buildCraft(6, Y_LAB, -5.5);             // 私人飞行器停在洞内
  buildCraft(-5.8, Y_LAB, -28.0, Math.PI); // 重工实验舱内整备座机

  // ═══════════════════════════════════════════════════════════════
  // 5. 四层贯通电梯井 (E/Q 升降) 与 折返步梯 (u ∈ [-14.6, -9.8], w ∈ [-12.5, -5.5])
  // ═══════════════════════════════════════════════════════════════
  const LIFT_U = -12.6, LIFT_W = -9.5;
  const STOPS = [
    { y: Y_LAB,   name: '底层 · 重工实验舱与起降台 (+413m)' },
    { y: Y_HALL1, name: '主厅下层 · 战术观海厅 (+423m)' },
    { y: Y_HALL2, name: '主厅上层 · 书房与居室 (+429m)' },
    { y: Y_CROWN, name: '顶层冠层 · 观测哨与后山廊道 (+435m)' },
  ];
  // 电梯透明井道四角钛钢立柱
  for (const du of [-1.6, 1.6]) for (const dw of [-1.6, 1.6]) {
    box(0.22, Y_TOP - Y_LAB, 0.22, LIFT_U + du, (Y_TOP + Y_LAB) * 0.5, LIFT_W + dw, mTiDark);
  }
  // 轿厢
  const cab = new THREE.Group();
  cab.position.set(LIFT_U, Y_HALL1, LIFT_W);
  root.add(cab);
  box(2.9, 0.24, 2.9, 0, -0.12, 0, mTiSheath, cab);
  box(2.9, 0.20, 2.9, 0, 2.75, 0, mTiSheath, cab);
  box(2.5, 0.08, 2.5, 0, 2.62, 0, mAmber, cab);
  box(0.12, 2.7, 2.8, -1.4, 1.35, 0, mGlass, cab);
  box(2.8, 2.7, 0.12, 0, 1.35, -1.4, mGlass, cab);

  // 联络步梯坡道 (在 u ∈ [-9.6, -6.8], w ∈ [-13.5, -5.0] 沿井道旁串联四层, 可直接步行上下!)
  const stairs = [
    // [uCenter, uHalf, w0, y0, w1, y1]
    [-8.2, 1.3, -4.5,  Y_LAB,   -14.5, Y_HALL1], // 413 -> 423m
    [-8.2, 1.3, -14.5, Y_HALL1, -5.5,  Y_HALL2], // 423 -> 429m
    [-8.2, 1.3, -5.5,  Y_HALL2, -14.5, Y_CROWN], // 429 -> 435m
  ];
  for (const [su, uh, w0, y0, w1, y1] of stairs) {
    const steps = 18;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      box(uh * 2, 0.22, Math.abs(w1 - w0) / steps + 0.12, su, y0 + (y1 - y0) * t - 0.11, w0 + (w1 - w0) * t, mTiDeck);
    }
  }

  let liftTargetIdx = 1;
  let cabY = STOPS[1].y;

  function liftAction(px, py, pz, dir) {
    const [u, w] = toLocal(px, pz);
    const inCab = Math.abs(u - LIFT_U) < 1.65 && Math.abs(w - LIFT_W) < 1.65 && Math.abs(py - cabY) < 2.2;
    const nearShaft = Math.hypot(u - LIFT_U, w - LIFT_W) < 5.5 && py >= Y_LAB - 2 && py <= Y_TOP + 2;
    if (!inCab && !nearShaft) return null;
    if (inCab) {
      const next = clamp(liftTargetIdx + dir, 0, STOPS.length - 1);
      if (next === liftTargetIdx) return `已在${dir > 0 ? '顶' : '底'}层: ${STOPS[next].name}`;
      liftTargetIdx = next;
      return `电梯前往 → ${STOPS[next].name}`;
    } else {
      // 呼叫电梯至玩家最近楼层
      let best = 0, bd = Infinity;
      STOPS.forEach((st, idx) => { const d = Math.abs(py - st.y); if (d < bd) { bd = d; best = idx; } });
      liftTargetIdx = best;
      return `已呼叫电梯至 ${STOPS[best].name}`;
    }
  }

  function update(dt) {
    const goalY = STOPS[liftTargetIdx].y;
    if (Math.abs(cabY - goalY) > 0.005) {
      const step = 6.5 * dt;
      cabY += clamp(goalY - cabY, -step, step);
      cab.position.y = cabY;
    }
    ring1.rotation.y += dt * 0.85;
    ring1.rotation.x += dt * 0.32;
    ring2.rotation.z -= dt * 0.62;
    coreOct.rotation.y -= dt * 0.5;
  }

  // ── 6. 物理可行走楼板与护栏防坠碰撞 ──
  function floorAt(wx, wz, feetY) {
    const [u, w] = toLocal(wx, wz);
    if (Math.abs(u) > 22 || w > 24 || w < northDeckEndW - 6) return -Infinity;

    let best = -Infinity;
    const offer = y => { if (y <= feetY + 1.35 && y > best) best = y; };

    // 电梯轿厢优先
    if (Math.abs(u - LIFT_U) < 1.48 && Math.abs(w - LIFT_W) < 1.48) {
      offer(cabY);
    }
    // 步梯斜坡检测
    for (const [su, uh, w0, y0, w1, y1] of stairs) {
      if (Math.abs(u - su) <= uh + 0.15) {
        const wMin = Math.min(w0, w1), wMax = Math.max(w0, w1);
        if (w >= wMin - 0.3 && w <= wMax + 0.3) {
          const t = clamp((w - w0) / (w1 - w0), 0, 1);
          offer(y0 + (y1 - y0) * t);
        }
      }
    }
    const inLiftHole = Math.abs(u - LIFT_U) < 1.45 && Math.abs(w - LIFT_W) < 1.45;
    const inStairSlot = Math.abs(u - (-8.2)) < 1.28 && w >= -14.5 && w <= -4.5;

    // 1) 飞行器出口 (+413m) 与 重工实验舱 (-60 ~ 0)
    if (u >= 0 && u <= 12 && w >= 0 && w <= 2.6) offer(Y_LAB);
    if (Math.abs(u) <= 4 && w >= 2 && w <= 4.25) offer(Y_HALL1);
    if (Math.abs(u) <= 15.1 && w >= -59.6 && w <= 0.2) offer(Y_LAB);

    // 2) 主厅下层 (+423m)
    if (!inLiftHole && !inStairSlot && Math.abs(u) <= 15.1 && w >= -27.8 && w <= 2.15) {
      offer(Y_HALL1);
    }

    // 3) 主厅上层 (+429m, 扣除前侧双层挑高中庭 u ∈ [-8.4, +8.4], w ∈ [-2.5, +2.2])
    const inAtrium = Math.abs(u) < 8.4 && w > -2.5;
    if (!inLiftHole && !inStairSlot && !inAtrium && Math.abs(u) <= 15.1 && w >= -27.8 && w <= 2.15) {
      offer(Y_HALL2);
    }

    // 4) 岩内观测层 (+435m) + 穿山后廊 + 北坡火山口观景挑台
    if (!inLiftHole && !inStairSlot && Math.abs(u) <= 15.1 && w >= -16.2 && w <= 2.1) {
      offer(Y_CROWN);
    }
    if (Math.abs(u) <= 2.65 && w >= northPortalW - 0.5 && w <= -15.5) {
      offer(Y_CROWN);
    }
    if (Math.abs(u) <= 4.4 && w >= northDeckEndW && w <= northPortalW + 0.6) {
      offer(Y_CROWN);
    }
    // 冠层钛金属顶盖也可落脚
    if (Math.abs(u) <= 16.8 && w >= -16.2 && w <= 2.2) {
      offer(Y_TOP);
    }

    return best;
  }

  function wallPush(wx, wz, feetY) {
    if (feetY < Y_ANCHOR - 1 || feetY > Y_TOP + 3) return [wx, wz];
    let [u, w] = toLocal(wx, wz);
    if (Math.abs(u) > 20 || w > 22 || w < northDeckEndW - 3) return [wx, wz];

    // 主厅与冠层玻璃幕墙内侧限位 (防止穿出 430m 玻璃幕墙坠崖, 起降台除外)
    if (feetY >= Y_HALL1 - 0.6 && feetY < Y_TOP - 0.3) {
      const onBalconyLevel = Math.abs(feetY - Y_HALL1) < 0.8;
      if (onBalconyLevel && w > 2.55 && w <= 5.3 && Math.abs(u) <= 4.6) {
        u = clamp(u, -3.7, 3.7);
        w = Math.min(w, 3.96);
      } else if (w > 1.98 && w < 2.85 && Math.abs(u) < 15.6 && !(onBalconyLevel && Math.abs(u) < 1.05)) {
        w = 1.98;
      }
      if (feetY < Y_CROWN - 0.5) {
        if (Math.abs(u) > 14.85 && Math.abs(u) < 16.5 && w > -28 && w < 2.2) u = Math.sign(u) * 14.85;
        if (w < -27.5 && w > -29.0 && Math.abs(u) < 15.5) w = -27.5;
      } else {
        // 冠层与后山廊道侧壁限位
        if (w < -16.0 && w > northPortalW + 0.3 && Math.abs(u) > 2.45 && Math.abs(u) < 5.0) {
          u = Math.sign(u) * 2.45;
        }
      }
    } else if (feetY >= Y_LAB - 0.6 && feetY < Y_HALL1 - 0.6 && w < -0.2) {
      // 重工实验舱内壁限位
      if (Math.abs(u) > 14.85 && Math.abs(u) < 16.5) u = Math.sign(u) * 14.85;
      if (w < -59.2 && w > -61.0) w = -59.2;
    }
    const [nwx, , nwz] = toWorld(u, feetY, w);
    return [nwx, nwz];
  }

  function placeAt(wx, wz, feetY) {
    if (feetY < Y_ANCHOR - 1 || feetY > Y_TOP + 4) return null;
    const [u, w] = toLocal(wx, wz);
    if (Math.abs(u) > 18 || w > 21 || w < northDeckEndW - 2) return null;
    if (w > 2.55 && Math.abs(u) <= 4 && w <= 4.25 && Math.abs(feetY - Y_HALL1) < 0.8) return '崖宅 · 观海阳台';
    if (w > 2.8) return null;
    if (feetY >= Y_CROWN - 0.8) {
      if (w < northPortalW + 0.5) return '崖宅后廊北口 · 俯瞰镜湖';
      if (w < -16) return '崖宅 · 穿脊后山廊道 (+435m)';
      return '崖宅 · 岩内观测层 (+435m)';
    }
    if (feetY >= Y_HALL2 - 0.8) return w < -14 ? '崖宅 · 岩内私密居室 (+429m)' : '崖宅 · 幕墙主厅上层 (+429m)';
    if (feetY >= Y_HALL1 - 0.8) return '崖宅 · 双层钢化幕墙主厅 (+423m)';
    return w >= 0 ? '崖宅 · 飞行器出口 (+413m)' : '崖宅 · 底部重工实验舱 (+413m)';
  }

  // 预设传送视角生成辅助: 输入局部 (u, y, w) 与朝向局部目标 (tu, ty, tw)
  function spotOf(u, y, w, tu, ty, tw) {
    const pos = toWorld(u, y, w);
    const look = toWorld(tu, ty, tw);
    return { pos, look };
  }

  return {
    origin: [ox, oz],
    nx, nz, tx, tz,
    northPortalW,
    floorAt,
    wallPush,
    update,
    liftAction,
    spotOf,
    placeAt,
  };
}
