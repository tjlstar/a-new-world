// 岛屿基地 3.2 · 三维漫游 — 地形与地物数据由 草图/生成草图.mjs 同步导出至 data/
import * as THREE from './vendor/three.module.min.js';
import { buildVilla } from './villa.js';

const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lin = v => Math.pow(clamp(v), 2.2);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
  const fx = u * u * (3 - 2 * u), fy = v * v * (3 - 2 * v);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const pip = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
};
const status = s => { const el = $('status'); if (el) el.textContent = s; };
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 80); });

// ── 3.2 工程草图页内模态窗绑定 (随时可查看, 不离开当前页面) ──
let sketchOpen = false;
function toggleSketch(force) {
  const modal = $('sketch-modal');
  const frame = $('sketch-frame');
  sketchOpen = typeof force === 'boolean' ? force : !sketchOpen;
  if (sketchOpen) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!frame.getAttribute('src')) frame.setAttribute('src', '../岛屿草图.html');
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}
$('btn-sketch').addEventListener('click', () => toggleSketch());
$('open-sketch-start').addEventListener('click', () => toggleSketch(true));
$('close-sketch').addEventListener('click', () => toggleSketch(false));

let hudHidden = false;
function toggleHud() {
  hudHidden = !hudHidden;
  for (const id of ['hud', 'help', 'spots', 'map']) {
    $(id).classList.toggle('hidden', hudHidden);
  }
  $('btn-hud').textContent = hudHidden ? '显示界面 (U)' : '精简界面 (U)';
}
$('btn-hud').addEventListener('click', toggleHud);

// ═════════ 1. 读取 3.2 地形与地物数据 ═════════
status('读取 3.2 破火山口高度场…');
const [meta, hbuf, mbuf] = await Promise.all([
  fetch('data/island.json').then(r => r.json()),
  fetch('data/height.bin').then(r => r.arrayBuffer()),
  fetch('data/mat.bin').then(r => r.arrayBuffer()),
]);

const KM = 1000, G = meta.grid, NX = G.nx, NY = G.ny, STEP = G.step * KM, X0 = G.x0 * KM, N0 = G.y0 * KM;
const hm = new Int16Array(hbuf), mat = new Uint8Array(mbuf), Hf = new Float32Array(NX * NY);
for (let k = 0; k < Hf.length; k++) Hf[k] = hm[k] * meta.heightScale;

// 世界坐标映射: X 向东(m), Y 向上海拔(m), Z 向南(m) => 设定公里 (x, y) 对应 (x*1000, -y*1000)
const W = (xkm, ykm) => [xkm * KM, -ykm * KM];
const worldOf = p => [p[0] * KM, -p[1] * KM];
const mapOf = (X, Z) => [X / KM, -Z / KM];

function heightAt(X, Z) {
  const fx = clamp((X - X0) / STEP, 0, NX - 1.001), fy = clamp((-Z - N0) / STEP, 0, NY - 1.001);
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * NX + i;
  return Hf[k] * (1 - u) * (1 - v) + Hf[k + 1] * u * (1 - v) + Hf[k + NX] * (1 - u) * v + Hf[k + NX + 1] * u * v;
}
const idxAt = (X, Z) => clamp(Math.round((-Z - N0) / STEP), 0, NY - 1) * NX + clamp(Math.round((X - X0) / STEP), 0, NX - 1);

const LAKE_LEVEL = meta.lakeLevel;
const lakeBox = meta.lake.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [9, -9, 9, -9]);
const inLake = (X, Z) => {
  const x = X / KM, y = -Z / KM;
  return x > lakeBox[0] && x < lakeBox[1] && y > lakeBox[2] && y < lakeBox[3] && pip(meta.lake, x, y);
};

// ═════════ 2. WebGL 渲染器、软件光栅化守护与物理环境光 (PMREM) ═════════
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });

const isSoftwareGl = (() => {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  return /SwiftShader|llvmpipe|Software/i.test(name);
})();

renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = !isSoftwareGl;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc8d9e2, 0.00015);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 18000);
camera.rotation.order = 'YXZ';

// 太阳、环境反射与直射光共用一个东南方向。天穹随相机平移，太阳只有角位置。
const sunlight = new THREE.Vector3(0.55, 0.44, 0.86).normalize();
const skyGeometry = new THREE.SphereGeometry(1, 48, 24);
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { sunDirection: { value: sunlight } },
  vertexShader: `
    varying vec3 skyRay;
    void main() {
      skyRay = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 sunDirection;
    varying vec3 skyRay;
    void main() {
      vec3 ray = normalize(skyRay);
      float altitude = max(ray.y, 0.0);
      vec3 horizon = vec3(0.68, 0.84, 0.95);
      vec3 sky = mix(horizon, vec3(0.085, 0.27, 0.58), pow(altitude, 0.42));
      // 环境贴图的下半球采用海面的暗色反射。
      sky = mix(sky, vec3(0.045, 0.105, 0.14), smoothstep(0.0, 0.18, -ray.y));
      float chord = length(ray - sunDirection);
      float edge = max(fwidth(chord) * 0.6, 0.0003);
      float disc = 1.0 - smoothstep(0.0047 - edge, 0.0047 + edge, chord);
      float haze = exp(-8.0 * chord) * 0.35 + exp(-62.0 * chord) * 0.95;
      sky += vec3(1.0, 0.83, 0.61) * (haze + disc * 14.0);
      gl_FragColor = vec4(sky, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});
const sky = new THREE.Mesh(skyGeometry, skyMaterial);
sky.scale.setScalar(14000);
sky.renderOrder = -1000;
sky.frustumCulled = false;
scene.add(sky);

const environmentScene = new THREE.Scene();
const environmentSky = new THREE.Mesh(skyGeometry, skyMaterial);
environmentSky.scale.setScalar(80);
environmentScene.add(environmentSky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environmentScene, 0, 0.1, 100).texture;
scene.environmentIntensity = 0.8;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xc9e2ff, 0x716550, 0.85));
const sun = new THREE.DirectionalLight(0xffedcf, 3.1);
sun.position.copy(sunlight).multiplyScalar(3200);
if (!isSoftwareGl) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 400;
  sun.shadow.camera.far = 5500;
  const d = 1900;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0004;
}
scene.add(sun);

// 程序化玄武岩柱状节理细纹贴图
function makeRockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8cbd0';
  ctx.fillRect(0, 0, 256, 256);
  const R = rng(46031);
  // 纵向柱状节理暗缝
  for (let x = 0; x < 256; x += 8 + Math.floor(R() * 6)) {
    ctx.fillStyle = R() > 0.5 ? 'rgba(28,32,38,0.42)' : 'rgba(165,174,182,0.22)';
    ctx.fillRect(x, 0, 1 + (R() > 0.7 ? 1 : 0), 256);
  }
  // 横向断口细裂隙与颗粒噪点
  for (let i = 0; i < 2400; i++) {
    const x = R() * 256, y = R() * 256, v = 85 + R() * 85;
    ctx.fillStyle = `rgba(${v | 0},${(v + 3) | 0},${(v + 7) | 0},0.22)`;
    ctx.fillRect(x, y, 2 + R() * 3, 1 + R() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}
const texRock = makeRockTexture();

// ═════════ 3. 构建 3.2 破火山口与深潜崖三维地形网格 ═════════
await nextFrame();
status('构建 460 米玄武岩绝壁与破火山口网格…');

const terrainGeo = new THREE.BufferGeometry();
{
  const N = NX * NY;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);

  // 预估局部坡度, 用于让陡坡自动裸露冷峻黑色玄武岩
  const slopeAt = (i, j) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(NX - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(NY - 1, j + 1);
    const dx = (Hf[j * NX + i1] - Hf[j * NX + i0]) / ((i1 - i0) * STEP);
    const dy = (Hf[j1 * NX + i] - Hf[j0 * NX + i]) / ((j1 - j0) * STEP);
    return Math.hypot(dx, dy);
  };

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const X = X0 + i * STEP;
      const yKm = G.y0 + j * G.step;
      const Z = -yKm * KM;
      const h = Hf[k];
      const m = mat[k];
      pos[k * 3] = X;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = Z;
      uv[k * 2] = X / 42;
      uv[k * 2 + 1] = Z / 42;

      const sl = slopeAt(i, j);
      const n1 = vnoise(X * 0.018, Z * 0.018);
      const n2 = vnoise(X * 0.085, Z * 0.085);
      let rgb;

      if (m === 0) {
        // 深潜崖海底 (-760 ~ 0m)
        const dFactor = clamp(-h / 220);
        rgb = mix3([0.13, 0.22, 0.27], [0.04, 0.08, 0.13], dFactor);
      } else if (m === 6) {
        // 北侧水下火山暗礁盘与共生珊瑚礁
        rgb = mix3([0.16, 0.28, 0.29], [0.22, 0.34, 0.31], n1);
      } else if (m === 5) {
        // 镜湖幽深墨玉湖床
        rgb = mix3([0.08, 0.17, 0.20], [0.14, 0.24, 0.26], n1);
      } else if (m === 3) {
        // 黑砾湾: 黑色火山砾石与潮湿火山粗砂滩 (绝非白沙滩!)
        rgb = mix3([0.13, 0.15, 0.17], [0.21, 0.23, 0.26], n2);
      } else if (m === 2 && sl < 0.75) {
        // 风草甸: 火山灰耐风草甸 (~165m)
        rgb = mix3([0.33, 0.42, 0.24], [0.44, 0.51, 0.30], n1 * 0.7 + n2 * 0.3);
      } else if (m === 4 || sl > 0.92 || h > 320) {
        // 柱状节理黑色玄武岩绝壁与刀刃尖塔
        const strata = 0.5 + 0.5 * Math.sin(h * 0.19 + n1 * 2.5);
        rgb = mix3([0.17, 0.19, 0.22], [0.29, 0.31, 0.35], strata * 0.65 + n2 * 0.35);
        // 浪击潮湿黑岩基部与海浪白沫线
        if (h < 14 && h > -3) rgb = mix3(rgb, [0.10, 0.12, 0.14], sstep(14, 2, h) * 0.7);
        if (h >= -0.6 && h <= 2.4 && sl > 0.35) rgb = mix3(rgb, [0.80, 0.86, 0.90], (1 - Math.abs(h - 0.9) / 1.6) * 0.55);
      } else {
        // 热带云雾林与背风坡浓密植被, 陡坡过渡出黑岩纹理
        const forest = mix3([0.13, 0.24, 0.15], [0.23, 0.35, 0.21], n1 * 0.65 + n2 * 0.35);
        const rock = [0.22, 0.24, 0.27];
        rgb = mix3(forest, rock, sstep(0.55, 0.92, sl));
      }

      col[k * 3] = lin(rgb[0]);
      col[k * 3 + 1] = lin(rgb[1]);
      col[k * 3 + 2] = lin(rgb[2]);
    }
  }

  const indices = new Uint32Array((NX - 1) * (NY - 1) * 6);
  let ptr = 0;
  for (let j = 0; j < NY - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      // 保持逆时针正面朝上 (+Y): Z 随 j 递减, 故 (a, b, c) 法向为 +Y!
      indices[ptr++] = a; indices[ptr++] = b; indices[ptr++] = c;
      indices[ptr++] = b; indices[ptr++] = d; indices[ptr++] = c;
    }
  }
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  terrainGeo.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeo.computeVertexNormals();
}

const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  map: texRock,
  roughness: 0.88,
  metalness: 0.04,
});
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
terrainMesh.receiveShadow = true;
terrainMesh.castShadow = !isSoftwareGl;
scene.add(terrainMesh);

// ═════════ 4. 建造 +412~+440m 四层轻薄崖宅 (含地形槽口精修) ═════════
await nextFrame();
status('嵌入 +412~+440 米岩内主厅与贴崖幕墙…');
const villa = buildVilla({ THREE, scene, meta, G, hm, terrainGeo, terrainMesh, texRock, worldOf, mapOf });
// 同步被崖宅精修后的顶点回高度缓存
{
  const p = terrainGeo.attributes.position;
  for (let k = 0; k < Hf.length; k++) Hf[k] = p.getY(k);
}

// ═════════ 5. 大洋海面、破火山口镜湖 (138m)、白水河与百米帘瀑 ═════════
await nextFrame();
status('注入南太平洋深水、镜湖与百米帘瀑…');

// 南太平洋海面 (深邃冷蓝墨绿, 带细腻法线波光)
const oceanMat = new THREE.MeshPhysicalMaterial({
  color: 0x103549,
  roughness: 0.16,
  metalness: 0.08,
  transmission: 0.35,
  transparent: true,
  opacity: 0.88,
  reflectivity: 0.85,
});
// 周期波纹法线让掠过海面的阳光断成细碎高光，远处由 mipmap 平滑过渡。
const waveSize = 128;
const wavePixels = new Uint8Array(waveSize * waveSize * 4);
for (let y = 0; y < waveSize; y++) {
  for (let x = 0; x < waveSize; x++) {
    const u = 2 * Math.PI * x / waveSize, v = 2 * Math.PI * y / waveSize;
    const swell = Math.cos(2 * u + 5 * v + Math.sin(u - v));
    const ripple = Math.cos(7 * u - 3 * v + 1.5 * Math.sin(2 * v));
    const n = new THREE.Vector3(0.09 * swell + 0.12 * ripple, 0.20 * swell - 0.05 * ripple, 1).normalize();
    const i = 4 * (y * waveSize + x);
    wavePixels.set([127.5 * (1 + n.x), 127.5 * (1 + n.y), 127.5 * (1 + n.z), 255], i);
  }
}
const waveMap = new THREE.DataTexture(wavePixels, waveSize, waveSize);
waveMap.wrapS = waveMap.wrapT = THREE.RepeatWrapping;
waveMap.repeat.set(740, 740);
waveMap.generateMipmaps = true;
waveMap.minFilter = THREE.LinearMipmapLinearFilter;
waveMap.magFilter = THREE.LinearFilter;
waveMap.needsUpdate = true;
oceanMat.normalMap = waveMap;
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 96, 96), oceanMat);
ocean.rotation.x = -Math.PI * 0.5;
ocean.receiveShadow = true;
scene.add(ocean);

// 破火山口碗底 · 镜湖水面 (138m, 幽深如墨玉)
{
  const shape = new THREE.Shape();
  meta.lake.forEach((p, idx) => {
    const [wx, wz] = worldOf(p);
    if (idx === 0) shape.moveTo(wx, -wz);
    else shape.lineTo(wx, -wz);
  });
  shape.closePath();
  const lakeGeo = new THREE.ShapeGeometry(shape, 24);
  lakeGeo.rotateX(-Math.PI * 0.5);
  const lakeMat = new THREE.MeshPhysicalMaterial({
    color: 0x123e4a, roughness: 0.09, metalness: 0.12,
    transparent: true, opacity: 0.90, reflectivity: 0.9,
  });
  const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
  lakeMesh.position.y = LAKE_LEVEL;
  scene.add(lakeMesh);
}

// 白水河玄武岩溪流与火山口北缘崩塌缺口百米飞瀑 (帘瀑, 落差 ~90m 注入深潭与黑砾湾)
const waterfallGroup = new THREE.Group();
scene.add(waterfallGroup);
const mistSprites = [];
{
  const mStream = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true,
    roughness: 0.18, transparent: true, opacity: 0.84,
  });
  // 湖口、瀑唇、潭面和潮口共享剖面。左右岸顶点在弯道处共用，水带连续。
  const profile = meta.riverProfile;
  const lip = meta.lipIndex;
  const verts = [], colors = [], indices = [];
  for (let i = 0; i < profile.length; i++) {
    const [x, z] = worldOf(profile[i]);
    const prev = worldOf(profile[Math.max(0, i - 1)]);
    const next = worldOf(profile[Math.min(profile.length - 1, i + 1)]);
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const halfWidth = i === lip + 1 || i === lip + 2 ? 6 : i === lip ? 1.2 : 1.8;
    const tint = new THREE.Color(i === lip || i === lip + 1 ? 0xcae3e6 : 0x3d777c);
    colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
    const scale = halfWidth / Math.hypot(dx, dz);
    for (const side of [-1, 1]) verts.push(x - side * dz * scale, profile[i][2] + 0.04, z + side * dx * scale);
    if (i > 0) {
      const n = i * 2;
      indices.push(n - 2, n - 1, n, n - 1, n + 1, n);
    }
  }
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  streamGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  streamGeo.setIndex(indices);
  streamGeo.computeVertexNormals();
  mStream.side = THREE.DoubleSide;
  waterfallGroup.add(new THREE.Mesh(streamGeo, mStream));
  const [fx, fz] = worldOf(profile[lip]);
  const poolY = profile[lip + 1][2];
  const [, poolZ] = worldOf(profile[lip + 1]);

  // 水帘背后的基地守军秘密暗门
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 5.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x3b4650, metalness: 0.7, roughness: 0.4 }));
  doorFrame.position.set(fx, poolY + 14, fz - 9);
  waterfallGroup.add(doorFrame);
  const doorSlit = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 2.6), new THREE.MeshBasicMaterial({ color: 0xf0a843 }));
  doorSlit.position.set(fx, poolY + 16.1, fz - 9);
  waterfallGroup.add(doorSlit);

  // 深潭白沫环与升腾水雾团
  const poolFoam = new THREE.Mesh(
    new THREE.CircleGeometry(4.3, 28),
    new THREE.MeshBasicMaterial({ color: 0xd8f1fa, transparent: true, opacity: 0.62 }),
  );
  poolFoam.rotation.x = -Math.PI * 0.5;
  poolFoam.position.set(fx, poolY + 0.55, poolZ - 1.5);
  waterfallGroup.add(poolFoam);

  const mistMat = new THREE.MeshBasicMaterial({ color: 0xdbeaf0, transparent: true, opacity: 0.26, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 + (i % 3) * 0.7, 1), mistMat);
    sp.position.set(fx + (i - 4) * 0.85, poolY + 1.4 + (i % 4) * 0.7, poolZ - 1 + (i % 3) * 0.8);
    sp.userData = { baseY: sp.position.y, phase: i * 0.8 };
    waterfallGroup.add(sp);
    mistSprites.push(sp);
  }
}

// ═════════ 6. 3.2 标志性奇崛地质与隐蔽工程地物 ═════════
await nextFrame();
status('耸立 260 米南剑峰、百米天然海蚀拱门与玄武岩尖塔群…');

const mBasalt = new THREE.MeshStandardMaterial({
  color: 0x2c3036, map: texRock, roughness: 0.88, metalness: 0.06,
});
const mBasaltSheer = new THREE.MeshStandardMaterial({
  color: 0x22262c, map: texRock, roughness: 0.84, metalness: 0.10,
});
const mFoam = new THREE.MeshBasicMaterial({
  color: 0xe2f2f8, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false,
});

// 6.1 天然玄武岩海蚀拱门: 横跨一线天水道中段狭口 (拱顶 ~106m, 净空 ~68m, 小艇与飞行器可从门下穿行!)
const foamRings = [];
if (meta.seaArch) {
  const [ax, az] = worldOf(meta.seaArch.a);
  const [bx, bz] = worldOf(meta.seaArch.b);
  const span = Math.hypot(bx - ax, bz - az);
  const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
  const yaw = Math.atan2(bx - ax, bz - az);

  const archGroup = new THREE.Group();
  archGroup.position.set(mx, 0, mz);
  archGroup.rotation.y = yaw;
  scene.add(archGroup);

  // 沿两处实测岩肩放样连续岩拱。中央截面上下边缘分别取拱顶和通航净空的标高。
  const { crownZ, clearZ, width } = meta.seaArch;
  const positions = [], uvs = [], faces = [];
  const sections = 32, sides = 8;
  for (let i = 0; i <= sections; i++) {
    const t = i * 2 / sections - 1;
    const spanPosition = t * span * 0.5;
    const rise = Math.max(0, 1 - t * t);
    const floor = -12 + (clearZ + 12) * Math.pow(rise, 0.78);
    const roof = crownZ - t * t * (38 + 4 * Math.sin(7 * t));
    const half = width * (0.5 + 0.36 * t * t);
    const center = 2.4 * Math.sin(4 * t);
    const ring = [
      [-0.57, floor + 1.5], [0.42, floor], [0.93, floor + 4],
      [1, roof - 8], [0.54, roof], [-0.4, roof - 0.8],
      [-1, roof - 6], [-0.89, floor + 8],
    ];
    ring.forEach(([edge, y], j) => {
      positions.push(center + edge * half, y, spanPosition);
      uvs.push(spanPosition / 25, (y + edge * half) / 25);
      if (i === sections) return;
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      faces.push(a, b, a + sides, b, b + sides, a + sides);
    });
  }
  const end = sections * sides;
  for (let j = 1; j < sides - 1; j++) faces.push(0, j + 1, j, end, end + j, end + j + 1);
  const archGeo = new THREE.BufferGeometry();
  archGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  archGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  archGeo.setIndex(faces);
  archGeo.computeVertexNormals();
  const arch = new THREE.Mesh(archGeo, mBasalt);
  arch.castShadow = !isSoftwareGl;
  arch.receiveShadow = true;
  archGroup.add(arch);
}

// 6.2 外海 260 米南剑峰 (meta.swordPeak) 与周边黑色海蚀柱群 (meta.stacks)
{
  const R = rng(26015);
  for (const [sxKm, syKm, sh, srKm, name] of meta.stacks) {
    const [wx, wz] = W(sxKm, syKm);
    const baseR = Math.max(12, srKm * KM);
    const g = new THREE.Group();
    g.position.set(wx, 0, wz);
    scene.add(g);

    const isSword = sh >= 200 || name === '南剑峰';
    // 主剑脊 + 环绕攒尖的六棱玄武岩副柱束, 塑造如黑石利剑般刺破洋面的冷峻压迫感
    const subCount = isSword ? 16 : 7;
    const mainSpire = new THREE.Mesh(new THREE.CylinderGeometry(isSword ? 4.2 : 3.2, baseR * 0.58, sh + 45, 6), mBasaltSheer);
    mainSpire.position.y = (sh - 54) * 0.5;
    mainSpire.rotation.z = isSword ? 0.035 : (R() - 0.5) * 0.08;
    mainSpire.castShadow = !isSoftwareGl;
    mainSpire.receiveShadow = true;
    g.add(mainSpire);

    // 剑尖锋刃收顶
    const tip = new THREE.Mesh(new THREE.ConeGeometry(isSword ? 6.5 : 4.2, isSword ? 46 : 16, 6), mBasaltSheer);
    tip.position.set(isSword ? -2.8 : 0, sh - (isSword ? 23 : 8), 0);
    tip.rotation.z = isSword ? 0.04 : 0;
    g.add(tip);

    for (let k = 0; k < subCount; k++) {
      const ang = (k / subCount) * Math.PI * 2 + R() * 0.35;
      const dist = baseR * (0.24 + 0.48 * R());
      const hSub = sh * (0.28 + 0.56 * Math.pow(1 - dist / baseR, 0.8) * (0.7 + 0.3 * R()));
      const rSub = baseR * (0.14 + 0.14 * R());
      const col = new THREE.Mesh(new THREE.CylinderGeometry(rSub * 0.42, rSub, hSub + 35, 6), mBasalt);
      col.position.set(Math.cos(ang) * dist, (hSub - 30) * 0.5, Math.sin(ang) * dist);
      col.rotation.y = R() * Math.PI;
      col.castShadow = !isSoftwareGl;
      g.add(col);
    }

    // 海面碎浪白沫环
    const foam = new THREE.Mesh(new THREE.RingGeometry(baseR * 0.72, baseR * 1.18, 28), mFoam);
    foam.rotation.x = -Math.PI * 0.5;
    foam.position.y = 0.45;
    foam.userData = { baseScale: 1, phase: R() * 6.28 };
    g.add(foam);
    foamRings.push(foam);
  }
}

// 6.3 山脊黑色玄武岩尖塔群 (主崖岬顶、西尖塔与东尖塔 —— 隐约透出远古基核几何感)
if (meta.spires) {
  const R = rng(365310);
  const mAncientSlit = new THREE.MeshBasicMaterial({ color: 0x4cc9e0 });
  for (const sp of meta.spires) {
    if (!['主崖岬', '西尖塔', '东尖塔'].includes(sp.name)) continue;
    const [wx, wz] = worldOf(sp.p);
    const groundY = heightAt(wx, wz);
    const towerH = sp.name === '主崖岬' ? 22 : 34;
    const g = new THREE.Group();
    g.position.set(wx, Math.min(groundY - 8, sp.h - towerH - 6), wz);
    scene.add(g);

    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + 0.2;
      const rad = k === 0 ? 0 : 4.5 + R() * 3.5;
      const hk = k === 0 ? towerH : towerH * (0.55 + 0.32 * R());
      const rw = k === 0 ? 4.4 : 2.8 + R() * 1.6;
      const mono = new THREE.Mesh(new THREE.CylinderGeometry(rw * 0.35, rw, hk + 12, 6), mBasaltSheer);
      mono.position.set(Math.cos(ang) * rad, hk * 0.5, Math.sin(ang) * rad);
      mono.rotation.y = k * 0.52;
      mono.castShadow = !isSoftwareGl;
      g.add(mono);
    }
    // 西尖塔/东尖塔顶部隐蔽传感器细微蓝光缝
    if (sp.name !== '主崖岬') {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 3.6), mAncientSlit);
      slit.position.set(0, towerH - 3.5, 0);
      g.add(slit);
    }
  }
}

// 6.4 岩隙营房 (唯一地面营区, 约 100 名作战人员, 镜湖西侧背风峡谷岩壁褶皱内 (-0.85, 0.15))
{
  const mCamoSteel = new THREE.MeshStandardMaterial({ color: 0x353d42, roughness: 0.62, metalness: 0.48 });
  const mAmberDim = new THREE.MeshBasicMaterial({ color: 0xe6a64c });
  for (const [cxKm, cyKm] of meta.camps) {
    const [wx, wz] = W(cxKm, cyKm);
    const baseH = heightAt(wx, wz);
    const cg = new THREE.Group();
    cg.position.set(wx, baseH, wz);
    // 朝向东南侧镜湖方向
    cg.rotation.y = 0.62;
    scene.add(cg);

    // 五座错层嵌入火山岩壁褶皱的低矮拟岩营舍模块 + 悬挑钢栈道
    const pods = [
      [-18,  2.5, -4, 14, 4.2, 8.5],
      [ -2,  5.8, -6, 16, 4.4, 9.0],
      [ 15,  9.0, -5, 13, 4.2, 8.2],
      [ -9, -1.2,  3, 12, 3.8, 7.6],
      [  8,  1.8,  2, 13, 3.8, 7.8],
    ];
    for (const [px, py, pz, sx, sy, sz] of pods) {
      // 模块舱体
      const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mCamoSteel);
      body.position.set(px, py, pz);
      body.castShadow = !isSoftwareGl;
      body.receiveShadow = true;
      cg.add(body);
      // 屋顶远古拟岩表层覆盖 (从高空与外海极难察觉)
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.56, sx * 0.62, 1.4, 6), mBasalt);
      roof.scale.set(1, 1, sz / sx);
      roof.position.set(px, py + sy * 0.5 + 0.55, pz);
      cg.add(roof);
      // 低调战术窄条窗光
      const win = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.68, 0.38, 0.15), mAmberDim);
      win.position.set(px, py + 0.3, pz + sz * 0.5 + 0.05);
      cg.add(win);
      // 下方斜撑钢梁入岩
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), mCamoSteel);
      strut.position.set(px, py - sy * 0.5 - 3.2, pz + sz * 0.25);
      strut.rotation.x = -0.35;
      cg.add(strut);
    }
    // 串联各层的轻型钢栈道
    const walk = new THREE.Mesh(new THREE.BoxGeometry(44, 0.35, 2.2), mCamoSteel);
    walk.position.set(-1, 3.6, 0.2);
    walk.rotation.z = 0.16;
    cg.add(walk);
  }
}

// 6.5 三条水平电磁弹射口 (+95m / +100m / +90m)、风草甸三座垂直发射井盖与四处出击口
{
  const mPortal = new THREE.MeshStandardMaterial({ color: 0x3b454e, roughness: 0.45, metalness: 0.72 });
  const mRailGlow = new THREE.MeshBasicMaterial({ color: 0x58d5ee });
  const mVoid = new THREE.MeshBasicMaterial({ color: 0x070b10 });

  for (const t of meta.tunnels) {
    const [coastX, coastZ] = worldOf(t.p);
    const nx = t.n[0], nz = -t.n[1];
    // 在绝壁上找最贴近海拔 t.z 的崖壁点嵌入弹射口
    let px = coastX, pz = coastZ;
    for (let s = 8; s <= 95; s += 3) {
      const tx = coastX - nx * s, tz = coastZ - nz * s;
      if (heightAt(tx, tz) >= t.z) { px = tx; pz = tz; break; }
    }
    const g = new THREE.Group();
    g.position.set(px, t.z, pz);
    g.rotation.y = Math.atan2(nx, nz);
    scene.add(g);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(16, 8.5, 9), mPortal);
    g.add(frame);
    const hole = new THREE.Mesh(new THREE.BoxGeometry(12.6, 5.6, 9.3), mVoid);
    g.add(hole);
    // 双电磁弹射导轨微光
    for (const sgn of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 9.4), mRailGlow);
      rail.position.set(sgn * 3.2, -2.5, 0.1);
      g.add(rail);
    }
  }

  // 风草甸三座拟岩垂直发射井盖 (直径 18m 八角装甲井盖, 略露细缝)
  for (const s of meta.silos) {
    const [sx, sz] = worldOf(s);
    const sy = heightAt(sx, sz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(8.2, 9.2, 8), mPortal);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(sx, sy + 0.14, sz);
    scene.add(ring);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(8.1, 8.1, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0x4c5942, roughness: 0.85 }));
    lid.position.set(sx, sy + 0.08, sz);
    scene.add(lid);
  }

  // 四处峡谷/峡湾守军出击暗门
  if (meta.sally) {
    for (const sp of meta.sally) {
      const [sx, sz] = worldOf(sp);
      const sy = Math.max(42, heightAt(sx, sz));
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.6, 3.2), mPortal);
      hatch.position.set(sx, sy + 1.5, sz);
      scene.add(hatch);
    }
  }
}

// 6.6 外海半潜幻域浮标与可开关的幻域中环光幕 (H 键切换)
const illusionCurtain = new THREE.Group();
illusionCurtain.visible = false;
scene.add(illusionCurtain);
{
  const mBuoyRock = new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.88 });
  const mBuoyCore = new THREE.MeshBasicMaterial({ color: 0x62dce8 });
  const buoyWorld = [];
  for (const b of meta.buoys) {
    const [bx, bz] = worldOf(b);
    buoyWorld.push(new THREE.Vector3(bx, 0, bz));
    const g = new THREE.Group();
    g.position.set(bx, 0, bz);
    scene.add(g);
    // 露出水面的拟礁头部 + 水下数十米悬浮体
    const topRock = new THREE.Mesh(new THREE.DodecahedronGeometry(4.8, 0), mBuoyRock);
    topRock.scale.set(1.3, 0.65, 1.1);
    topRock.position.y = 0.8;
    g.add(topRock);
    const subBody = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 0.7, 34, 8), mBuoyRock);
    subBody.position.y = -17;
    g.add(subBody);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 8), mBuoyCore);
    beacon.position.y = 2.8;
    g.add(beacon);
  }
  // 闭合幻域中环示意场光幕
  if (buoyWorld.length > 3) {
    const curve = new THREE.CatmullRomCurve3(buoyWorld, true);
    const pts = curve.getPoints(120);
    const wallH = 320;
    const vPos = new Float32Array(pts.length * 2 * 3);
    const idx = [];
    pts.forEach((p, i) => {
      vPos[i * 6] = p.x; vPos[i * 6 + 1] = 0; vPos[i * 6 + 2] = p.z;
      vPos[i * 6 + 3] = p.x; vPos[i * 6 + 4] = wallH; vPos[i * 6 + 5] = p.z;
      if (i < pts.length - 1) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    });
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    wGeo.setIndex(idx);
    const wMat = new THREE.MeshBasicMaterial({
      color: 0x56d1e8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
    });
    illusionCurtain.add(new THREE.Mesh(wGeo, wMat));
  }
}

// ═════════ 7. 热带云雾林植被实例化渲染 (InstancedMesh) ═════════
await nextFrame();
status('披覆破火山口热带云雾林…');
{
  const R = rng(31088);
  const candidates = [];
  const [vOx, vOz] = villa.origin;
  const northExitX = vOx + villa.nx * (villa.northPortalW - 4);
  const northExitZ = vOz + villa.nz * (villa.northPortalW - 4);

  for (let j = 4; j < NY - 4; j += 2) {
    for (let i = 4; i < NX - 4; i += 2) {
      const k = j * NX + i;
      if (mat[k] !== 1) continue;
      const h = Hf[k];
      if (h < 8 || h > 308) continue;
      // 坡度太陡处不长高树
      const sl = Math.hypot(Hf[k + 1] - Hf[k - 1], Hf[k + NX] - Hf[k - NX]) / (2 * STEP);
      if (sl > 0.85 || R() > 0.42) continue;
      const X = X0 + i * STEP + (R() - 0.5) * STEP * 1.4;
      const Z = -(G.y0 + j * G.step) * KM + (R() - 0.5) * STEP * 1.4;
      // 避开崖宅后山廊道北出口与岩隙营房近旁
      if (Math.hypot(X - northExitX, Z - northExitZ) < 24) continue;
      candidates.push([X, heightAt(X, Z), Z, 0.75 + R() * 0.75, R() * 6.28]);
    }
  }
  const maxTrees = isSoftwareGl ? 3200 : 6800;
  const stepPick = Math.max(1, Math.ceil(candidates.length / maxTrees));
  const picked = candidates.filter((_, idx) => idx % stepPick === 0);

  const canopyGeo = new THREE.IcosahedronGeometry(4.6, 1);
  canopyGeo.scale(1.18, 0.78, 1.18);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2b4a2f, roughness: 0.88, metalness: 0.02 });
  const trunksGeo = new THREE.CylinderGeometry(0.45, 0.75, 5.2, 5);
  const trunksMat = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.95 });

  const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, picked.length);
  const trunkInst = new THREE.InstancedMesh(trunksGeo, trunksMat, picked.length);
  const dummy = new THREE.Object3D();
  const cTmp = new THREE.Color();

  picked.forEach(([x, y, z, sc, rot], idx) => {
    dummy.position.set(x, y + 4.8 * sc, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    canopyInst.setMatrixAt(idx, dummy.matrix);

    cTmp.setHSL(0.33 + (R() - 0.5) * 0.05, 0.32 + R() * 0.12, 0.16 + R() * 0.09);
    canopyInst.setColorAt(idx, cTmp);

    dummy.position.set(x, y + 2.2 * sc, z);
    dummy.scale.set(sc, sc, sc);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(idx, dummy.matrix);
  });
  canopyInst.instanceMatrix.needsUpdate = true;
  if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
  trunkInst.instanceMatrix.needsUpdate = true;
  scene.add(trunkInst, canopyInst);
}

// ═════════ 8. 三维悬浮地名牌 (L 键显隐) ═════════
const labelGroup = new THREE.Group();
scene.add(labelGroup);
function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 26px "Microsoft YaHei", "PingFang SC", sans-serif';
  const tw = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = tw; c.height = 44;
  ctx.fillStyle = 'rgba(10, 18, 26, 0.80)';
  ctx.strokeStyle = 'rgba(240, 182, 89, 0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(2, 2, tw - 4, 40, 6);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 24px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#f2f6fa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tw * 0.5, 23);

  const tex = new THREE.CanvasTexture(c);
  const matS = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(matS);
  sp.scale.set(tw * 0.42, 44 * 0.42, 1);
  return sp;
}
for (const [name, xk, yk] of meta.labels) {
  const [wx, wz] = W(xk, yk);
  let wy = Math.max(0, heightAt(wx, wz)) + 26;
  if (name === meta.swordPeak.name) wy = meta.swordPeak.h + 18;
  if (name === '海蚀拱门') wy = meta.seaArch.crownZ + 20;
  const sp = makeLabelSprite(name);
  sp.position.set(wx, wy, wz);
  labelGroup.add(sp);
}
// 补充崖宅专属标签
{
  const vp = villa.spotOf(0, 443, 4, 0, 430, 0).pos;
  const sp = makeLabelSprite('崖宅 (+412~+440m 贴岩幕墙)');
  sp.position.set(vp[0], 448, vp[2]);
  labelGroup.add(sp);
}

// ═════════ 9. 14 处 3.2 核心预设传送点 ═════════
function makeSpots() {
  const vSea = villa.spotOf(-27, 424, 78, 0, 426, 2);
  const vBalcony = villa.spotOf(0, 423, 3.3, 30, 427, 100);
  const vHall1 = villa.spotOf(-5.5, 423.0, -4.5, 1.5, 424.5, 20);
  const vHall2 = villa.spotOf(4.5, 429.0, -5.2, -1, 427.5, 20);
  const vCrown = villa.spotOf(0, 435.4, -12.0, 0, 435.8, villa.northPortalW - 20);
  const vNorth = villa.spotOf(0, 435.4, villa.northPortalW + 0.3, -40, 165, villa.northPortalW - 500);
  const vLab = villa.spotOf(-4.5, 413.0, -18.0, 6.5, 416.5, -46);

  const [archAx, archAz] = worldOf(meta.seaArch.a);
  const [archBx, archBz] = worldOf(meta.seaArch.b);
  const archMx = (archAx + archBx) * 0.5, archMz = (archAz + archBz) * 0.5;
  const [swX, swZ] = worldOf([meta.swordPeak.x, meta.swordPeak.y]);
  const [lkX, lkZ] = W(-0.42, -0.02);
  const [mdX, mdZ] = W(-0.25, -0.68);
  const [cpX, cpZ] = W(meta.camps[0][0], meta.camps[0][1]);
  const [pkX, pkZ] = W(meta.peak.x, meta.peak.y);
  const lip = meta.riverProfile[meta.lipIndex];
  const pool = meta.riverProfile[meta.lipIndex + 1];
  const [flX, flZ] = worldOf(lip);
  const [mouthX, mouthZ] = worldOf(meta.riverProfile.at(-1));

  return [
    { key: '1', name: '海侧斜看幕墙、阳台与舱口', pos: vSea.pos, look: vSea.look, fly: true },
    { key: '2', name: '崖宅 · 观海阳台 (+423m)', pos: vBalcony.pos, look: vBalcony.look, fly: false },
    { key: '3', name: '崖宅 · 双层钢化幕墙主厅 (+423m)', pos: vHall1.pos, look: vHall1.look, fly: false },
    { key: '4', name: '崖宅 · 上层书房与居室 (+429m)', pos: vHall2.pos, look: vHall2.look, fly: false },
    { key: '5', name: '崖宅 · 岩内观测层与穿脊后廊 (+435m)', pos: vCrown.pos, look: vCrown.look, fly: false },
    { key: '6', name: '崖宅后廊北口 · 俯瞰镜湖', pos: vNorth.pos, look: vNorth.look, fly: false },
    { key: '7', name: '崖宅 · 60m 重工实验舱与核心', pos: vLab.pos, look: vLab.look, fly: false },
    { key: '8', name: `一线天水道 · 海蚀拱门（拱顶 ${meta.seaArch.crownZ} 米）`, pos: [archMx - 95, 42, archMz - 210], look: [archMx, meta.seaArch.clearZ, archMz], fly: true },
    { key: '9', name: '南剑峰 (260m 外海海蚀剑峰)', pos: [swX - 240, 115, swZ + 290], look: [swX, 145, swZ], fly: true },
    { key: '0', name: `黑砾湾 · 帘瀑（落差 ${lip[2] - pool[2]} 米）`, pos: [mouthX - 35, pool[2] + 6, mouthZ - 50], look: [flX, (lip[2] + pool[2]) / 2, flZ], fly: true },
    { key: '·', name: `主崖岬绝顶 (${meta.peak.h}m 刀刃山脊)`, pos: [pkX, heightAt(pkX, pkZ) + 4, pkZ], look: [lkX, 150, lkZ], fly: false },
    { key: '·', name: '风草甸火山灰台地 (165m)', pos: [mdX + 40, heightAt(mdX + 40, mdZ) + 2, mdZ - 35], look: [pkX, 420, pkZ], fly: false },
    { key: '·', name: '破火山口碗底 · 镜湖 (138m)', pos: [lkX + 165, 148, lkZ - 110], look: [lkX - 60, 145, lkZ + 40], fly: true },
    { key: '·', name: '背风峡谷 · 岩隙营房 (~100人)', pos: [cpX + 95, heightAt(cpX, cpZ) + 32, cpZ + 75], look: [cpX, heightAt(cpX, cpZ) + 4, cpZ], fly: true },
  ];
}
const SPOTS = makeSpots();

// ═════════ 10. 玩家操控、物理步行/飞行与小地图 ═════════
const EYE_H = 1.72;
const player = {
  x: SPOTS[0].pos[0],
  y: SPOTS[0].pos[1],
  z: SPOTS[0].pos[2],
  vy: 0,
  yaw: 0,
  pitch: 0,
  fly: true,
  onGround: false,
};

let toastTimer = 0;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

function goToSpot(idx) {
  const s = SPOTS[idx];
  if (!s) return;
  player.fly = Boolean(s.fly);
  player.vy = 0;
  player.x = s.pos[0];
  player.z = s.pos[2];
  player.y = s.fly ? s.pos[1] : s.pos[1] + EYE_H;
  const dx = s.look[0] - player.x, dy = s.look[1] - player.y, dz = s.look[2] - player.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.48, 1.48);
  $('h-mode').textContent = player.fly ? '飞行' : '步行';
  showToast(`已传送: ${s.name}`);
}

// 填充右侧传送栏按钮
{
  const box = $('spots');
  SPOTS.forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<kbd>${s.key}</kbd><span>${s.name}</span>`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      goToSpot(idx);
    });
    box.appendChild(btn);
  });
}

// 绘制 3.2 右下角小地图底图
const miniCanvas = $('mini');
const miniCtx = miniCanvas.getContext('2d');
const miniBg = document.createElement('canvas');
miniBg.width = miniCanvas.width;
miniBg.height = miniCanvas.height;
// 小地图世界范围: x ∈ [-2.15, 2.05] km, y ∈ [-1.85, 1.85] km
const MX0 = -2.15, MX1 = 2.05, MY0 = -1.85, MY1 = 1.85;
{
  const mw = miniBg.width, mh = miniBg.height;
  const bctx = miniBg.getContext('2d');
  const img = bctx.createImageData(mw, mh);
  for (let py = 0; py < mh; py++) {
    for (let px = 0; px < mw; px++) {
      const xk = lerp(MX0, MX1, px / mw);
      const yk = lerp(MY1, MY0, py / mh);
      const wx = xk * KM, wz = -yk * KM;
      const h = heightAt(wx, wz);
      const m = mat[idxAt(wx, wz)];
      let c;
      if (inLake(wx, wz)) c = [36, 108, 128];
      else if (m === 0) c = h < -180 ? [15, 34, 48] : [25, 55, 74];
      else if (m === 6) c = [48, 86, 92];
      else if (m === 3) c = [54, 58, 64];
      else if (m === 2) c = [125, 146, 92];
      else if (m === 4 || h > 290) {
        const b = clamp((h - 120) / 350);
        c = [72 + b * 55, 76 + b * 55, 84 + b * 58];
      } else {
        const b = clamp(h / 300);
        c = [46 + b * 42, 78 + b * 46, 52 + b * 36];
      }
      const p = (py * mw + px) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  // 标注南剑峰与崖宅红金亮点
  const toMini = (xk, yk) => [((xk - MX0) / (MX1 - MX0)) * mw, ((MY1 - yk) / (MY1 - MY0)) * mh];
  bctx.strokeStyle = '#79c7d7';
  bctx.lineWidth = 1.2;
  bctx.beginPath();
  meta.riverProfile.forEach(([x, y], i) => {
    const [px, py] = toMini(x, y);
    if (i === 0) bctx.moveTo(px, py);
    else bctx.lineTo(px, py);
  });
  bctx.stroke();
  bctx.fillStyle = '#f0b659';
  const [vx, vy] = toMini(...mapOf(...villa.origin));
  bctx.fillRect(vx - 2.5, vy - 2.5, 5, 5);
  bctx.fillStyle = '#ecf4f8';
  const [sx, sy] = toMini(meta.swordPeak.x, meta.swordPeak.y);
  bctx.beginPath(); bctx.arc(sx, sy, 2.5, 0, Math.PI * 2); bctx.fill();
}

function drawMinimap() {
  if (hudHidden || $('map').classList.contains('hidden')) return;
  const mw = miniCanvas.width, mh = miniCanvas.height;
  miniCtx.drawImage(miniBg, 0, 0);
  const xk = player.x / KM, yk = -player.z / KM;
  const px = ((xk - MX0) / (MX1 - MX0)) * mw;
  const py = ((MY1 - yk) / (MY1 - MY0)) * mh;
  // 视线扇形
  const heading = -player.yaw - Math.PI * 0.5;
  miniCtx.save();
  miniCtx.translate(px, py);
  miniCtx.rotate(heading);
  miniCtx.fillStyle = 'rgba(240, 182, 89, 0.28)';
  miniCtx.beginPath();
  miniCtx.moveTo(0, 0);
  miniCtx.arc(0, 0, 18, -0.45, 0.45);
  miniCtx.closePath();
  miniCtx.fill();
  miniCtx.fillStyle = '#ffc56b';
  miniCtx.beginPath();
  miniCtx.arc(0, 0, 3.2, 0, Math.PI * 2);
  miniCtx.fill();
  miniCtx.restore();
}

// 键盘与鼠标输入
const keys = new Set();
let started = false;
let dragging = false;

window.addEventListener('keydown', e => {
  if (e.code === 'KeyG') { toggleSketch(); return; }
  if (e.code === 'Escape' && sketchOpen) { toggleSketch(false); return; }
  if (sketchOpen || !started) return;

  keys.add(e.code);
  if (e.code === 'KeyF') {
    player.fly = !player.fly;
    player.vy = 0;
    $('h-mode').textContent = player.fly ? '飞行' : '步行';
    showToast(player.fly ? '已切换为自由飞行模式' : '已切换为重力步行模式');
  } else if (e.code === 'KeyL') {
    labelGroup.visible = !labelGroup.visible;
    showToast(labelGroup.visible ? '显示地标名称' : '隐藏地标名称');
  } else if (e.code === 'KeyH') {
    illusionCurtain.visible = !illusionCurtain.visible;
    showToast(illusionCurtain.visible ? '已显现: 幻域中环边界场' : '已隐去: 幻域中环边界场');
  } else if (e.code === 'KeyM') {
    $('map').classList.toggle('hidden');
  } else if (e.code === 'KeyU') {
    toggleHud();
  } else if (e.code === 'KeyE' || e.code === 'KeyQ') {
    const msg = villa.liftAction(player.x, player.y - EYE_H, player.z, e.code === 'KeyE' ? 1 : -1);
    if (msg) showToast(msg);
  } else if (/^Digit[0-9]$/.test(e.code)) {
    const d = Number(e.code.slice(5));
    goToSpot(d === 0 ? 9 : d - 1);
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));

canvas.addEventListener('mousedown', e => {
  if (!started || sketchOpen || e.button !== 0) return;
  dragging = true;
  if (!document.pointerLockElement && canvas.requestPointerLock) {
    try { canvas.requestPointerLock(); } catch {}
  }
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', e => {
  if (!started || sketchOpen) return;
  if (document.pointerLockElement === canvas || dragging) {
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.50, 1.50);
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 识别玩家当前所在地名
function currentPlace(wx, feetY, wz) {
  const vp = villa.placeAt(wx, wz, feetY);
  if (vp) return vp;
  if (inLake(wx, wz) && feetY < LAKE_LEVEL + 18) return '镜湖 (138m)';
  const [xk, yk] = mapOf(wx, wz);
  if (pip(meta.meadow, xk, yk) && feetY < 210) return '风草甸 (165m)';
  let best = '外海大洋', bd = 0.28 * 0.28;
  for (const [nm, lx, ly] of meta.labels) {
    const d2 = (xk - lx) ** 2 + (yk - ly) ** 2;
    if (d2 < bd) { bd = d2; best = nm.replace(/\s+\d+m$/, ''); }
  }
  if (best === '外海大洋' && heightAt(wx, wz) > 1) best = '破火山口山脊与云雾林';
  return best;
}

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
function updateHud() {
  if (hudHidden) return;
  const [xk, yk] = mapOf(player.x, player.z);
  const alt = player.y - (player.fly ? 0 : EYE_H);
  $('h-pos').textContent = `(${xk.toFixed(2)}, ${yk.toFixed(2)}) km`;
  $('h-alt').textContent = `${alt >= 0 ? '+' : ''}${Math.round(alt)} m`;
  const deg = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
  $('h-dir').textContent = `${DIRS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
  $('h-place').textContent = currentPlace(player.x, player.y - EYE_H, player.z);
}

// 启动就绪
goToSpot(0);
const goBtn = $('go');
goBtn.disabled = false;
goBtn.textContent = '进入岛屿漫游';
status('3.2 场景就绪');
goBtn.addEventListener('click', () => {
  started = true;
  $('start').classList.add('hidden');
  if (canvas.requestPointerLock) {
    try { canvas.requestPointerLock(); } catch {}
  }
});

// ═════════ 11. 主循环 (含软件 WebGL 帧节流防卡死守护) ═════════
const afterDraw = isSoftwareGl
  ? cb => setTimeout(() => requestAnimationFrame(cb), 16)
  : requestAnimationFrame;

let lastT = performance.now();
let clockAcc = 0;

function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  clockAcc += dt;

  // 角色移动与碰撞结算
  if (started && !sketchOpen) {
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const str = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');

    const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
    if (player.fly) {
      const spd = fast ? 310 : 92;
      const cosP = Math.cos(player.pitch), sinP = Math.sin(player.pitch);
      let vx = (-sinY * cosP * fwd + cosY * str);
      let vy = sinP * fwd + (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
      let vz = (-cosY * cosP * fwd - sinY * str);
      const len = Math.hypot(vx, vy, vz);
      if (len > 1) { vx /= len; vy /= len; vz /= len; }
      player.x += vx * spd * dt;
      player.y += vy * spd * dt;
      player.z += vz * spd * dt;
      const minSurface = Math.max(0.8, inLake(player.x, player.z) ? LAKE_LEVEL + 0.8 : -500);
      // 飞行时允许进入崖宅与海蚀拱门, 但不穿过普通地面
      const vFloor = villa.floorAt(player.x, player.z, player.y - EYE_H);
      const groundFloor = vFloor > -999 ? vFloor + EYE_H : Math.max(minSurface, heightAt(player.x, player.z) + 1.4);
      if (player.y < groundFloor) player.y = groundFloor;
    } else {
      const spd = fast ? 15.5 : 6.2;
      let vx = -sinY * fwd + cosY * str;
      let vz = -cosY * fwd - sinY * str;
      const len = Math.hypot(vx, vz);
      if (len > 1) { vx /= len; vz /= len; }

      const feetY = player.y - EYE_H;
      let nx = player.x + vx * spd * dt;
      let nz = player.z + vz * spd * dt;
      [nx, nz] = villa.wallPush(nx, nz, feetY);

      const vfNext = villa.floorAt(nx, nz, feetY);
      const thNext = Math.max(0, inLake(nx, nz) ? LAKE_LEVEL : heightAt(nx, nz));
      const targetGround = vfNext > -999 ? vfNext : thNext;

      // 防止步行直接爬上超过 68° 的百米绝壁
      if (vfNext > -999 || targetGround - feetY < 1.65) {
        player.x = nx;
        player.z = nz;
      }

      if (keys.has('Space') && player.onGround) {
        player.vy = 7.4;
        player.onGround = false;
      }
      player.vy -= 20.0 * dt;
      player.y += player.vy * dt;

      const curFeet = player.y - EYE_H;
      const vfCur = villa.floorAt(player.x, player.z, Math.max(curFeet, feetY));
      const surfY = vfCur > -999 ? vfCur : Math.max(0, inLake(player.x, player.z) ? LAKE_LEVEL : heightAt(player.x, player.z));
      if (player.y <= surfY + EYE_H) {
        player.y = surfY + EYE_H;
        player.vy = 0;
        player.onGround = true;
      } else {
        player.onGround = false;
      }
    }
    player.x = clamp(player.x, -3800, 3800);
    player.z = clamp(player.z, -3800, 3800);
    player.y = clamp(player.y, 1.2, 2600);
  }

  // 更新崖宅电梯与能量核心动画、瀑布水雾及外海浪沫呼吸动画
  villa.update(dt);
  for (const sp of mistSprites) {
    sp.position.y = sp.userData.baseY + Math.sin(clockAcc * 1.6 + sp.userData.phase) * 1.8;
  }
  for (const fm of foamRings) {
    const s = 1 + 0.06 * Math.sin(clockAcc * 1.9 + fm.userData.phase);
    fm.scale.set(s, s, 1);
  }

  camera.position.set(player.x, player.y, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);

  updateHud();
  drawMinimap();

  waveMap.offset.set((clockAcc * 0.013) % 1, (clockAcc * 0.019) % 1);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  afterDraw(tick);
}
afterDraw(tick);
