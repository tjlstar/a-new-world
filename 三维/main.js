import { buildSeaArchGeometry } from './sea-arch.js';
import { loadCliff, fractureCliffs, plantForest, buildUnderstory } from './landscape.js';
import { RGBELoader } from './vendor/RGBELoader.js';
// 岛屿基地 3.3 · 三维漫游 — 地形与地物数据由 草图/生成草图.mjs 同步导出至 data/
import * as THREE from './vendor/three.module.min.js';
import { buildVilla } from './villa.js';
import { BEACH, beachProfile, beachShore } from './beach.js';
import { loadSurfaceTextures, installTerrainSurface, buildCoastalDetails } from './environment.js';

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

// ── 3.3 工程草图页内模态窗绑定 (随时可查看, 不离开当前页面) ──
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

// ═════════ 1. 读取 3.3 地形与地物数据 ═════════
status('读取 3.3 破火山口高度场…');
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
  // Match the exact a-b-c / b-d-c triangles used by the terrain mesh.
  return u + v <= 1
    ? Hf[k] + (Hf[k + 1] - Hf[k]) * u + (Hf[k + NX] - Hf[k]) * v
    : Hf[k + NX + 1] + (Hf[k + NX] - Hf[k + NX + 1]) * (1 - u) + (Hf[k + 1] - Hf[k + NX + 1]) * (1 - v);
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc8d9e2, 0.00015);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 18000);
camera.rotation.order = 'YXZ';

// 太阳、环境反射与直射光共用一个东南方向（+X 东、+Z 南，晴日南崖受光）。天穹随相机平移，太阳只有角位置。
const panorama = await new RGBELoader().loadAsync('./assets/landscape/sky.hdr');
const sunlight = new THREE.Vector3(.54, .743, .395).normalize();
const skyGeometry = new THREE.SphereGeometry(1, 48, 24);
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { skyMap: { value: panorama } },
  vertexShader: `
    varying vec3 skyRay;
    void main() {
      skyRay = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D skyMap;
    varying vec3 skyRay;
    void main() {
      vec3 ray = normalize(skyRay);
      vec2 uv = vec2(fract(atan(ray.z,ray.x)/6.2831853 + 0.50), asin(clamp(ray.y,-1.0,1.0))/3.14159265 + 0.5);
      vec3 clouds = min(texture2D(skyMap,uv).rgb,vec3(12.0)) * 0.65;
      vec3 horizon = vec3(.58,.695,.76);
      gl_FragColor = vec4(mix(horizon,clouds,smoothstep(.012,.115,ray.y)),1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb = mix(vec3(.7843,.8510,.8863),gl_FragColor.rgb,smoothstep(-.012,.07,ray.y));
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
scene.environmentIntensity = .63;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xc9e2ff, 0x716550, .62));
const sun = new THREE.DirectionalLight(0xffedcf, 3.1);
sun.position.copy(sunlight).multiplyScalar(3200);
{
  sun.castShadow = true;
  const resolution = isSoftwareGl ? 1024 : Math.min(4096,renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(resolution,resolution);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2100;
  const d = 360;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = .23;
}
scene.add(sun, sun.target);

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
status('载入本地 CC0 岩石、砂地与林地材质…');
const [surfaceTextures, cliff] = await Promise.all([loadSurfaceTextures(renderer, texRock), loadCliff(renderer)]);
if (surfaceTextures.failed.length) console.warn('部分贴图未加载，使用后备材质', surfaceTextures.failed);

// ═════════ 3. 构建 3.3 破火山口与深潜崖三维地形网格 ═════════
await nextFrame();
status('构建 460 米玄武岩绝壁与破火山口网格…');

const terrainGeo = new THREE.BufferGeometry();
{
  const N = NX * NY;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);

  // 预估局部坡度, 用于让陡坡自动裸露冷峻黑色玄武岩
  const [plungeX, plungeZ] = worldOf([meta.plunge.x, meta.plunge.y]);
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
      } else if (m === 7) {
        // 岸缘透出岩土底色；纹理未载入时，顶点色直接显示白沙。
        rgb = surfaceTextures.failed.length
          ? mix3([0.68, 0.67, 0.61], [0.94, 0.93, 0.88], sstep(0, 2, h))
          : mix3([0.26, 0.28, 0.24], [0.38, 0.38, 0.32], n1);
      } else if (m === 3) {
        // 白沙沉积带以外的火山砾岸。
        rgb = mix3([0.13, 0.15, 0.17], [0.21, 0.23, 0.26], n2);
      } else if (m === 2 && sl < 0.75) {
        // 风草甸: 火山灰耐风草甸 (~165m)
        rgb = mix3([0.33, 0.42, 0.24], [0.44, 0.51, 0.30], n1 * 0.7 + n2 * 0.3);
      } else if (m === 4 || sl > 0.92 || h > 320) {
        // 柱状节理黑色玄武岩绝壁与刀刃尖塔
        rgb = mix3([0.17, 0.19, 0.22], [0.29, 0.31, 0.35], n1 * 0.65 + n2 * 0.35);
        if (sl > 1.2) {
          // 竖向雨痕与渗水暗纹:只随水平位置变化,在崖面上自然拉成竖条
          const streak = vnoise(X * 0.16 + 11, Z * 0.16 - 7) * 0.6 + vnoise(X * 0.45, Z * 0.45) * 0.4;
          rgb = mix3(rgb, [0.09, 0.10, 0.11], 0.5 * sstep(0.56, 0.78, streak));
          rgb = mix3(rgb, [0.40, 0.40, 0.38], 0.22 * sstep(0.30, 0.16, streak) * sstep(30, 60, h));
        } else if (h > 12) {
          // 层理窄台:耐盐矮灌木与苔草,海鸟巢下的白色鸟粪
          rgb = mix3(rgb, [0.22, 0.31, 0.18], 0.65 * sstep(0.9, 0.45, sl));
          if (vnoise(X * 0.5 + 3, Z * 0.5 - 9) > 0.74 && h < 300) rgb = mix3(rgb, [0.48, 0.47, 0.41], 0.15);
        }
        if (Math.hypot(X - plungeX, Z - plungeZ) < 70 && h > 30) rgb = mix3(rgb, [0.07, 0.12, 0.09], 0.6 * sstep(70, 35, Math.hypot(X - plungeX, Z - plungeZ)));
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
// 暂存整张地形网格供 buildVilla 精修槽口与挂接裁切着色器，随后再按空间分块提交给场景
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);

// ═════════ 4. 建造 +412~+440m 四层轻薄崖宅 (含地形槽口精修) ═════════
await nextFrame();
status('嵌入 +412~+440 米岩内主厅与贴崖幕墙…');
const villa = buildVilla({ THREE, scene, meta, G, hm, terrainGeo, terrainMesh, texRock, worldOf, mapOf });
// 同步被崖宅精修后的顶点回高度缓存
{
  const p = terrainGeo.attributes.position;
  for (let k = 0; k < Hf.length; k++) Hf[k] = p.getY(k);
}

/**
 * 将无缝地形网格按二维区块切分为独立 Chunk，使视野外的岛背与海底自动触发视锥剔除。
 */
function buildTerrainChunks({ geo, material, depthMaterial, nx, ny, chunksX = 8, chunksY = 8, allowShadow = true }) {
  const group = new THREE.Group();
  const srcPos = geo.attributes.position.array;
  const srcNorm = geo.attributes.normal.array;
  const srcCol = geo.attributes.color.array;
  const srcUv = geo.attributes.uv.array;

  for (let cy = 0; cy < chunksY; cy++) {
    const j0 = Math.floor((cy * (ny - 1)) / chunksY);
    const j1 = Math.floor(((cy + 1) * (ny - 1)) / chunksY);
    const ch = j1 - j0 + 1;

    for (let cx = 0; cx < chunksX; cx++) {
      const i0 = Math.floor((cx * (nx - 1)) / chunksX);
      const i1 = Math.floor(((cx + 1) * (nx - 1)) / chunksX);
      const cw = i1 - i0 + 1;
      const vCount = cw * ch;

      const pos = new Float32Array(vCount * 3);
      const norm = new Float32Array(vCount * 3);
      const col = new Float32Array(vCount * 3);
      const uv = new Float32Array(vCount * 2);
      let maxY = -Infinity;

      for (let lj = 0; lj < ch; lj++) {
        for (let li = 0; li < cw; li++) {
          const sk = (j0 + lj) * nx + (i0 + li);
          const dk = lj * cw + li;
          const sk3 = sk * 3, dk3 = dk * 3, sk2 = sk * 2, dk2 = dk * 2;
          const y = srcPos[sk3 + 1];
          if (y > maxY) maxY = y;

          pos[dk3] = srcPos[sk3]; pos[dk3 + 1] = y; pos[dk3 + 2] = srcPos[sk3 + 2];
          norm[dk3] = srcNorm[sk3]; norm[dk3 + 1] = srcNorm[sk3 + 1]; norm[dk3 + 2] = srcNorm[sk3 + 2];
          col[dk3] = srcCol[sk3]; col[dk3 + 1] = srcCol[sk3 + 1]; col[dk3 + 2] = srcCol[sk3 + 2];
          uv[dk2] = srcUv[sk2]; uv[dk2 + 1] = srcUv[sk2 + 1];
        }
      }

      const idxLen = (cw - 1) * (ch - 1) * 6;
      const idx = vCount <= 65535 ? new Uint16Array(idxLen) : new Uint32Array(idxLen);
      let p = 0;
      for (let lj = 0; lj < ch - 1; lj++) {
        for (let li = 0; li < cw - 1; li++) {
          const a = lj * cw + li, b = a + 1, c = a + cw, d = c + 1;
          idx[p++] = a; idx[p++] = b; idx[p++] = c;
          idx[p++] = b; idx[p++] = d; idx[p++] = c;
        }
      }

      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      cGeo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
      cGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      cGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      cGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      if (maxY > -48) fractureCliffs(cGeo, cliff, (x,z) => Math.hypot(x-villa.origin[0],z-villa.origin[1])<66);
      const vertices = cGeo.attributes.position;
      const sand = new Float32Array(vertices.count);
      for (let k = 0; k < vertices.count; k++) {
        const x = vertices.getX(k) / KM;
        if (x <= BEACH.west || x >= BEACH.east) continue;
        const beach = beachProfile(x, -vertices.getZ(k) / KM);
        sand[k] = beach.sand * sstep(16, 6, vertices.getY(k));
      }
      cGeo.setAttribute('beachSand', new THREE.BufferAttribute(sand, 1));
      cGeo.computeBoundingBox();
      cGeo.computeBoundingSphere();

      const mesh = new THREE.Mesh(cGeo, material);
      mesh.receiveShadow = true;
      // 完全淹没在海面 2 米以下的海底区块无需投射太阳阴影
      mesh.castShadow = allowShadow && maxY > -2;
      if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
      group.add(mesh);
    }
  }
  return group;
}

installTerrainSurface(terrainMat, {...surfaceTextures, rock:cliff}, true);
const terrainGroup = buildTerrainChunks({
  geo: terrainGeo,
  material: terrainMat,
  depthMaterial: terrainMesh.customDepthMaterial,
  nx: NX,
  ny: NY,
  chunksX: 8,
  chunksY: 8,
  allowShadow: true,
});
scene.add(terrainGroup);
terrainGeo.dispose();

// ═════════ 5. 大洋海面、破火山口镜湖 (138m)、白水河与百米帘瀑 ═════════
await nextFrame();
status('注入南太平洋深水、镜湖与百米帘瀑…');

// 南太平洋海面 (深邃冷蓝墨绿, 半透明高光反射, 避免全场景透射重绘开销)
const oceanMat = new THREE.MeshPhysicalMaterial({
  color: 0x103549, side: THREE.DoubleSide,
  roughness: 0.24,
  metalness: 0.06,
  ior: 1.333,
  reflectivity: 0.90,
  envMapIntensity: 1.15,
  transparent: true,
  opacity: 0.88,
});
// 周期波纹法线让掠过海面的阳光断成细碎高光，远处由 mipmap 平滑过渡。
const waveSize = 256;
const wavePixels = new Uint8Array(waveSize * waveSize * 4);
for (let y = 0; y < waveSize; y++) {
  for (let x = 0; x < waveSize; x++) {
    const u = 2 * Math.PI * x / waveSize, v = 2 * Math.PI * y / waveSize;
    let sx = 0, sy = 0;
    // Integer-frequency spectrum remains tileable, with several wind directions and wavelengths.
    for (const [kx, ky, amplitude, phase] of [[2,5,.075,.8],[7,-3,.048,2.3],[-4,9,.036,4.1],[13,7,.026,1.7],[17,-11,.018,5.2],[-23,15,.012,3.8]]) {
      const wave = Math.cos(kx * u + ky * v + Math.sin(u - v + phase) * 2.4 + phase);
      const len = Math.hypot(kx, ky); sx += amplitude * kx / len * wave; sy += amplitude * ky / len * wave;
    }
    const n = new THREE.Vector3(sx, sy, 1).normalize();
    const i = 4 * (y * waveSize + x);
    wavePixels.set([127.5 * (1 + n.x), 127.5 * (1 + n.y), 127.5 * (1 + n.z), 255], i);
  }
}
const waveMap = new THREE.DataTexture(wavePixels, waveSize, waveSize);
waveMap.wrapS = waveMap.wrapT = THREE.RepeatWrapping;
waveMap.repeat.set(280, 280);
waveMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
waveMap.generateMipmaps = true;
waveMap.minFilter = THREE.LinearMipmapLinearFilter;
waveMap.magFilter = THREE.LinearFilter;
waveMap.needsUpdate = true;
oceanMat.normalMap = waveMap;
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 96, 96), oceanMat);
ocean.rotation.x = -Math.PI * 0.5;
ocean.receiveShadow = true;
scene.add(ocean);
// 海底高度决定近岸水色与透明度，浅砂坡能透过水面看见。
const depthMap = new THREE.DataTexture(Hf, NX, NY, THREE.RedFormat, THREE.FloatType);
const oceanTime = { value: 0 };
depthMap.minFilter = depthMap.magFilter = THREE.NearestFilter;
depthMap.needsUpdate = true;
oceanMat.onBeforeCompile = shader => {
  shader.uniforms.oceanTime=oceanTime;
  shader.uniforms.islandHeights = { value: depthMap };
  shader.uniforms.gridSize = { value: new THREE.Vector2(NX, NY) };
  shader.uniforms.gridBounds = { value: new THREE.Vector4(X0, N0, (NX - 1) * STEP, (NY - 1) * STEP) };
  shader.vertexShader = 'varying vec3 vSeaPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
  shader.fragmentShader = 'varying vec3 vSeaPosition; uniform float oceanTime; uniform sampler2D islandHeights; uniform vec4 gridBounds; uniform vec2 gridSize;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 gridUV = (vec2(vSeaPosition.x, -vSeaPosition.z) - gridBounds.xy) / gridBounds.zw;
    float depth = 150.0;
    if (all(greaterThanEqual(gridUV, vec2(0.0))) && all(lessThanEqual(gridUV, vec2(1.0)))) {
      vec2 q = gridUV * (gridSize - 1.0), f = fract(q), cell = (floor(q) + 0.5) / gridSize;
      vec2 texel = 1.0 / gridSize;
      float a = texture2D(islandHeights, cell).r, b = texture2D(islandHeights, cell + vec2(texel.x, 0)).r;
      float c = texture2D(islandHeights, cell + vec2(0, texel.y)).r, d = texture2D(islandHeights, cell + texel).r;
      depth = max(0.0, -mix(mix(a,b,f.x),mix(c,d,f.x),f.y));
    }
    float shallows = 1.0 - smoothstep(0.5, 20.0, depth);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.21, 0.20), shallows * 0.72);
    diffuseColor.a = mix(1.0, 0.36, shallows);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
    vec2 seaXY=vSeaPosition.xz;
    vec2 windWarp=vec2(sin(seaXY.y*.014+seaXY.x*.008),sin(seaXY.x*.011-seaXY.y*.021));
    vec2 coord=vNormalMapUv+.23*windWarp;
    vec2 shortWave=texture2D(normalMap,coord).xy*2.-1.;
    vec2 crossWave=texture2D(normalMap,mat2(.8,.6,-.6,.8)*coord*2.31).xy*2.-1.;
    float travel=length(cameraPosition-vSeaPosition);
    vec2 slope=(shortWave+.42*crossWave)*(1.-smoothstep(400.,4200.,travel));
    slope+=.052*vec2(.87,.49)*cos(dot(seaXY,vec2(.081,.046))+windWarp.x*2.+oceanTime*.62);
    normal=normalize(normal+mat3(viewMatrix)*vec3(slope.x,0.,slope.y)*faceDirection);
  `).replace('#include <fog_fragment>',`
    #include <fog_fragment>
    if(cameraPosition.y>0.) gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.7843,.8510,.8863),smoothstep(5500.,9400.,length(vSeaPosition.xz-cameraPosition.xz)));
  `);
};
const coastalDetails = buildCoastalDetails({ scene, heightAt, sets: surfaceTextures, random: rng(87021), software: isSoftwareGl });

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
  const lakeWaves = waveMap.clone();
  lakeWaves.repeat.set(.055,.055);
  const lakeMat = new THREE.MeshPhysicalMaterial({
    color: 0x123e4a, roughness: 0.09, metalness: 0.12,
    normalMap: lakeWaves, normalScale:new THREE.Vector2(.36,.36),
    transparent: true, opacity: 0.90, reflectivity: 0.9,
  });
  const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
  lakeMesh.position.y = LAKE_LEVEL;
  scene.add(lakeMesh);
}

// 白水河在北缘瀑唇离开岩床，一次落入黑砾湾海面。
const waterfallGroup = new THREE.Group();
scene.add(waterfallGroup);
const mistSprites = [];
const riverTime = { value:0 };
{
  const mStream = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true,
    roughness: 0.18, transparent: true, opacity: 0.84,
  });
  // 上游水带只铺到瀑唇，崖下由场景的海面覆盖。
  const profile = meta.riverProfile;
  const lip = meta.lipIndex;
  const verts = [], colors = [], indices = [], streamUV = [];
  let distance = 0;
  for (let i = 0; i <= lip; i++) {
    const [x, z] = worldOf(profile[i]);
    const prev = worldOf(profile[Math.max(0, i - 1)]);
    distance += Math.hypot(x-prev[0],z-prev[1]);
    streamUV.push(0,distance,1,distance);
    const next = worldOf(profile[Math.min(profile.length - 1, i + 1)]);
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const halfWidth = i === lip ? 1.6 : 1.8;
    const tint = new THREE.Color(i === lip ? 0xcae3e6 : 0x3d777c);
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
  streamGeo.setAttribute('uv',new THREE.Float32BufferAttribute(streamUV,2));
  streamGeo.setIndex(indices);
  streamGeo.computeVertexNormals();
  mStream.side = THREE.DoubleSide;
  mStream.onBeforeCompile = shader => {
    shader.uniforms.flowTime = riverTime;
    shader.vertexShader = 'varying vec2 riverUV;\n' + shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nriverUV=uv;');
    shader.fragmentShader = 'varying vec2 riverUV; uniform float flowTime;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float across=riverUV.x, downstream=riverUV.y;
      float ripple=sin(downstream*1.8-flowTime*3.9+2.5*sin(across*15.0+downstream*.09));
      float edge=min(across,1.0-across)+.04*sin(downstream*.65);
      diffuseColor.a *= smoothstep(.02,.18,edge);
      diffuseColor.rgb *= .44 + .18*ripple;
      diffuseColor.rgb += vec3(.055,.065,.064)*smoothstep(.91,1.0,ripple);
    `);
  };
  const riverMesh = new THREE.Mesh(streamGeo,mStream);
  riverMesh.receiveShadow=true;
  waterfallGroup.add(riverMesh);
  const [fx, fz] = worldOf(profile[lip]);
  const [impactX, impactZ] = worldOf(profile[lip + 1]);
  const lipY = profile[lip][2], seaY = profile[lip + 1][2];

  // 弧形水帘:按自由落体抛物线下落(瀑唇流速约 2 m/s),越往下越散开,分成几股宽窄不一的水束
  const mCurtain = new THREE.MeshBasicMaterial({ color: 0xe9f4f7, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, vertexColors: true });
  const drop = lipY - seaY;
  const strands = [[-0.9, 0.9, 1.0], [-0.15, 0.55, 0.92], [0.55, 0.7, 0.85], [1.25, 0.45, 0.7], [-1.55, 0.4, 0.6]];
  for (const [offset, width, alpha] of strands) {
    const sv = [], sc = [], si = [], SEG = 28;
    for (let s = 0; s <= SEG; s++) {
      const f = s / SEG;
      const y = lipY - drop * f * f;
      const spread = 1 + 2.6 * f; // 下落中横向散开
      const cx = lerp(fx, impactX, f) + offset * spread * 1.4 + 0.6 * Math.sin(f * 7 + offset * 3);
      const half = width * spread * 0.9;
      const z = lerp(fz, impactZ, f);
      sv.push(cx - half, y, z, cx + half, y, z);
      const w = 0.84 + 0.16 * f; // 上部水色略青,下部散成白沫
      sc.push(w, w, 1, w, w, 1);
      if (s > 0) { const n = s * 2; si.push(n - 2, n - 1, n, n - 1, n + 1, n); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    g.setIndex(si);
    const m = mCurtain.clone(); m.opacity = 0.72 * alpha;
    const curtain = new THREE.Mesh(g, m);
    curtain.renderOrder = 3;
    waterfallGroup.add(curtain);
  }

  // 飞沫贴着海面向外散开，外缘渐隐并露出下面的海浪。
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xd8f1fa, transparent: true, depthWrite: false });
  foamMat.onBeforeCompile = shader => {
    shader.uniforms.flowTime = riverTime;
    shader.vertexShader = 'varying vec2 foamUV;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nfoamUV = uv;');
    shader.fragmentShader = 'varying vec2 foamUV; uniform float flowTime;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 p = foamUV * 2.0 - 1.0;
      float t = flowTime * 1.8;
      float r = length(p) + 0.045 * sin(p.x * 19.0 + t) * sin(p.y * 15.0 - t);
      float flecks = sin(p.x * 47.0 + 2.0 * sin(p.y * 23.0 + t)) * sin(p.y * 38.0 - t);
      float core = (1.0 - smoothstep(0.20, 0.60, r)) * (0.76 + 0.20 * flecks);
      float rings = smoothstep(0.3, 1.0, sin(36.0 * r - t + flecks)) * (1.0 - smoothstep(0.40, 0.96, r));
      diffuseColor.a *= min(1.0, core + 0.32 * rings);
    `);
  };
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(34, 30), foamMat);
  foam.rotation.x = -Math.PI * 0.5;
  foam.position.set(impactX, seaY + 0.12, impactZ);
  foam.renderOrder = 2;
  waterfallGroup.add(foam);

  // 落水点升腾的水雾,一部分飘到半空
  const mistCanvas = document.createElement('canvas'); mistCanvas.width = mistCanvas.height = 64;
  const mc = mistCanvas.getContext('2d'), mg = mc.createRadialGradient(32,32,0,32,32,32);
  mg.addColorStop(0, 'rgba(226,240,241,0.7)'); mg.addColorStop(0.45, 'rgba(226,240,241,0.25)'); mg.addColorStop(1, 'rgba(226,240,241,0)');
  mc.fillStyle = mg; mc.fillRect(0,0,64,64);
  const mistMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mistCanvas), transparent: true, opacity: 0.30, depthWrite: false });
  for (let i = 0; i < 16; i++) {
    const r = 2.2 + (i % 4) * 1.1;
    const sp = new THREE.Sprite(mistMat);
    sp.scale.set(r * 4.5, r * 4.5, 1);
    const ang = i * 2.4;
    sp.position.set(impactX + Math.cos(ang) * (3 + (i % 5)), seaY + 1.5 + (i % 6) * 2.2, impactZ + Math.sin(ang) * (3 + (i % 3) * 2));
    sp.renderOrder = 4;
    sp.userData = { baseY: sp.position.y, phase: i * 0.8 };
    waterfallGroup.add(sp);
    mistSprites.push(sp);
  }
}

// ═════════ 6. 3.3 标志性奇崛地质与隐蔽工程地物 ═════════
await nextFrame();
status('耸立 260 米南剑峰、百米天然海蚀拱门与玄武岩尖塔群…');

const mBasalt = new THREE.MeshStandardMaterial({
  color: 0x929396, map: cliff.map, normalMap: cliff.normalMap, roughnessMap: cliff.roughnessMap, roughness: 0.88, metalness: 0.06,
});
const mBasaltSheer = new THREE.MeshStandardMaterial({
  color: 0x82848a, map: cliff.map, normalMap: cliff.normalMap, roughnessMap: cliff.roughnessMap, roughness: 0.84, metalness: 0.10,
});
const mFoam = new THREE.MeshBasicMaterial({
  color: 0xe2f2f8, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false,
});
mFoam.onBeforeCompile = shader => {
  shader.uniforms.surfTime=riverTime;
  shader.vertexShader = 'varying vec2 foamUV; varying vec2 foamWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
    #include <begin_vertex>
    foamUV=uv-.5;
    foamWorld=(modelMatrix*vec4(position,1.)).xz;
  `);
  shader.fragmentShader='varying vec2 foamUV; varying vec2 foamWorld; uniform float surfTime;\n'+shader.fragmentShader.replace('#include <color_fragment>',`
    #include <color_fragment>
    float shore=length(foamUV);
    float breakup=sin(foamWorld.x*.53+sin(foamWorld.y*.6)+surfTime*.8)*cos(foamWorld.y*.35-surfTime*.3);
    diffuseColor.a *= (1.-smoothstep(.36,.50,shore+.035*breakup))*smoothstep(-.38,.69,breakup);
  `);
};

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

  const alongX = (bx-ax)/span, alongZ = (bz-az)/span;
  const groundAtLocal = (across,along) => heightAt(
    mx + along*alongX + across*alongZ,
    mz + along*alongZ - across*alongX
  );
  const geometry = buildSeaArchGeometry(span, meta.seaArch, vnoise, groundAtLocal);
  const archRock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .91 });
  installTerrainSurface(archRock, { ...surfaceTextures, rock: cliff });
  const arch = new THREE.Mesh(geometry, archRock);
  arch.castShadow = true;
  arch.receiveShadow = true;
  archGroup.add(arch);
}

// 6.2 外海南剑峰:刀片状岩脊(长约 360m、宽约 100m、最高 260m),参照豪勋爵岛的波尔斯金字塔一类海蚀孤峰
{
  const sp = meta.swordPeak;
  const len = (sp.len ?? 0.36) * KM, wid = (sp.wid ?? 0.1) * KM, top = sp.h, rot = sp.rot ?? 0.4;
  const [cx, cz] = W(sp.x, sp.y);
  const au = [Math.cos(rot), -Math.sin(rot)], av = [Math.sin(rot), Math.cos(rot)]; // 长轴、短轴(世界 X/Z)
  const NU = 120, NV = 56, extU = len * 0.68, extV = wid * 1.25;
  const crest = un =>
    28 + (top - 28) * Math.exp(-(((un + 0.12) / 0.26) ** 2))
    + 138 * Math.exp(-(((un - 0.47) / 0.12) ** 2))
    + 86 * Math.exp(-(((un + 0.64) / 0.10) ** 2))
    + 26 * (vnoise(un * 11 + 4, 2.3) - 0.5) + 16 * (vnoise(un * 29 + 1, 5.1) - 0.5);
  const heightOf = (un, vn, X, Z) => {
    const halfW = Math.sqrt(Math.max(0, 1 - un * un)) * (0.78 + 0.34 * vnoise(un * 5 + 1, 7.7)); // 平面上两头收尖
    if (Math.abs(un) >= 1 || Math.abs(vn) >= halfW) {
      // 崖脚崩落的巨石裙：连续斜降并嵌入水下约 22 米残留岩台，水下底部与海床无缝衔接
      const outM = Math.abs(un) >= 1 ? (Math.abs(un) - 1) * len / 2 + Math.max(0, Math.abs(vn)) * wid / 2 : (Math.abs(vn) - halfW) * wid / 2;
      const bedY = heightAt(X, Z);
      return Math.max(Math.min(-28, bedY - 6), 6 - outM * 0.58 + 4.5 * vnoise(un * 23, vn * 23));
    }
    const across = 1 - Math.abs(vn) / halfW;
    // 两侧近乎直立,面上有顺坡而下的竖向冲沟
    const flute = vnoise(un * 46 + 3, vn * 2.5) * 0.6 + vnoise(un * 97, vn * 4) * 0.4;
    const z = crest(un) * Math.pow(across, 0.18) * (0.86 + 0.18 * flute);
    return Math.max(6 * (1 - across), z + 4 * (vnoise(un * 31 + 2, vn * 17 - 5) - 0.5));
  };
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3), uvs = new Float32Array((NU + 1) * (NV + 1) * 2), idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = (i / NU * 2 - 1) * extU, v = (j / NV * 2 - 1) * extV;
    const k = j * (NU + 1) + i, X = cx + au[0] * u + av[0] * v, Z = cz + au[1] * u + av[1] * v;
    const y = heightOf(u / (len / 2), v / (wid / 2), X, Z);
    pos.set([X, y, Z], k * 3);
    uvs.set([(u + v) / 25, y / 25], k * 2);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const k = j * (NU + 1) + i, q = [k, k + 1, k + NU + 1, k + NU + 2];
    if (q.every(n => pos[n * 3 + 1] < heightAt(pos[n * 3], pos[n * 3 + 2]) - 1.5)) continue; // 仅跳过完全埋在海底岩台之下的面
    idx.push(k, k + NU + 1, k + 1, k + 1, k + NU + 1, k + NU + 2);
  }
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bladeGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  bladeGeo.setIndex(idx);
  bladeGeo.computeVertexNormals();
  const blade = new THREE.Mesh(bladeGeo, mBasaltSheer.clone());
  blade.material.side = THREE.DoubleSide;
  blade.castShadow = !isSoftwareGl;
  blade.receiveShadow = true;
  scene.add(blade);
  // 岩脊四周的碎浪带
  const swordFoam = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.62, 48), mFoam);
  swordFoam.rotation.x = -Math.PI * 0.5;
  swordFoam.scale.set(len, wid * 1.55, 1);
  swordFoam.rotation.z = rot;
  swordFoam.position.set(cx, 0.45, cz);
  swordFoam.userData = { baseScale: 1, phase: 2.1 };
  scene.add(swordFoam);
}

// 周边小型黑色海蚀柱
{
  const R = rng(26015);
  for (const [sxKm, syKm, sh, srKm, name] of meta.stacks) {
    if (sh >= 200 || name === '南剑峰') continue; // 南剑峰在上面单独塑形
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

// 6.5 三条水平电磁弹射口 (2 南 1 北: +95m / +100m / +90m)、风草甸三座垂直发射井盖与两处峡谷出击口
const tunnelPortals = [];
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
    tunnelPortals.push({ name: t.name, x: px, y: t.z, z: pz, nx, nz });
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

  // 两处东西峡谷守军出击暗门
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
  const R = rng(9031);
  const mBuoyRock = new THREE.MeshStandardMaterial({
    color: 0x5c6166, map: cliff.map, normalMap: cliff.normalMap, roughnessMap: cliff.roughnessMap,
    roughness: 0.94, metalness: 0.04,
  });
  const mBuoySub = new THREE.MeshStandardMaterial({ color: 0x22282d, roughness: 0.86, metalness: 0.18 });
  const buoyWorld = [];
  for (const b of meta.buoys) {
    const [bx, bz] = worldOf(b);
    buoyWorld.push(new THREE.Vector3(bx, 0, bz));
    const g = new THREE.Group();
    g.position.set(bx, 0, bz);
    scene.add(g);
    // 露出水面的部分拟作被浪拍击的暗色礁石（不反光、无外露发光信标），水下为数十米悬浮体且不接触海底
    const topRock = new THREE.Mesh(new THREE.DodecahedronGeometry(4.6, 1), mBuoyRock);
    topRock.scale.set(1.35, 0.58, 1.08);
    topRock.rotation.set(R() * 0.4, R() * Math.PI * 2, R() * 0.35);
    topRock.position.y = 0.65;
    g.add(topRock);
    const subBody = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.75, 36, 8), mBuoySub);
    subBody.position.y = -18.5;
    g.add(subBody);
    const surfRing = new THREE.Mesh(new THREE.RingGeometry(4.8, 8.6, 24), mFoam);
    surfRing.rotation.x = -Math.PI * 0.5;
    surfRing.position.y = 0.35;
    surfRing.userData = { baseScale: 1, phase: R() * 6.28 };
    g.add(surfRing);
    foamRings.push(surfRing);
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
let updateForest, forestView;
const updateUnderstory=buildUnderstory(scene,heightAt,(x,z)=>mat[idxAt(x,z)],isSoftwareGl);
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
      if (sl > 0.85 || R() > 0.77) continue;
      const X = X0 + i * STEP + (R() - 0.5) * STEP * 1.4;
      const Z = -(G.y0 + j * G.step) * KM + (R() - 0.5) * STEP * 1.4;
      // 避开崖宅后山廊道北出口与岩隙营房近旁
      if (Math.hypot(X - northExitX, Z - northExitZ) < 24) continue;
      candidates.push([X, heightAt(X, Z), Z, 0.75 + R() * 0.75, R() * 6.28]);
    }
  }
  const maxTrees = isSoftwareGl ? 3200 : 10500;
  const stepPick = Math.max(1, Math.ceil(candidates.length / maxTrees));
  const picked = candidates.filter((_, idx) => idx % stepPick === 0);
  // Shorter neighbours gather on sheltered forest slopes and break the regular crown spacing.
  for (const [x,y,z,scale] of picked.slice()) {
    if (vnoise(x*.024,z*.024) < .47) continue;
    const angle=R()*Math.PI*2, radius=4+R()*5;
    const nx=x+Math.cos(angle)*radius,nz=z+Math.sin(angle)*radius;
    const h=heightAt(nx,nz);
    if (Math.abs(h-y)<4 && h>8) picked.push([nx,h,nz,scale*(.45+R()*.37),R()*Math.PI*2]);
  }

  updateForest = await plantForest(scene, picked, R, isSoftwareGl);
  const distanceToTrail=([x,,z])=>(x+470)**2+(z+330)**2;
  const [treeX,treeY,treeZ]=picked.reduce((a,b)=>distanceToTrail(a)<distanceToTrail(b)?a:b);
  forestView={pos:[treeX+9,heightAt(treeX+9,treeZ+13),treeZ+13],look:[treeX,treeY+4,treeZ]};
}

// ═════════ 8. 三维悬浮地名牌 (L 键显隐) ═════════
const labelGroup = new THREE.Group();
labelGroup.visible = false;
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
  const spireMatch = meta.spires?.find(sp => name.startsWith(sp.name));
  if (spireMatch) wy = Math.max(wy, spireMatch.h + 18);
  if (name.startsWith(meta.swordPeak.name)) wy = meta.swordPeak.h + 18;
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

// ═════════ 9. 3.3 核心预设传送点 ═════════
function makeSpots() {
  const vSea = villa.spotOf(-27, 424, 78, 0, 426, 2);
  const vBalcony = villa.spotOf(0, 423, 3.3, 30, 427, 100);
  const vHall1 = villa.spotOf(-5.5, 423.0, -4.5, 1.5, 424.5, 20);
  const vHall2 = villa.spotOf(4.5, 429.0, -5.2, -1, 427.5, 20);
  const vCrown = villa.spotOf(0, 435.0, -12.0, 0, 435.4, villa.northPortalW - 20);
  const vNorth = villa.spotOf(0, 435.0, villa.northPortalW + 0.3, -40, 165, villa.northPortalW - 500);
  const vLab = villa.spotOf(-4.5, 413.0, -18.0, 6.5, 416.5, -46);

  const [archAx, archAz] = worldOf(meta.seaArch.a);
  const [archBx, archBz] = worldOf(meta.seaArch.b);
  const archMx = (archAx + archBx) * 0.5, archMz = (archAz + archBz) * 0.5;
  const [swX, swZ] = worldOf([meta.swordPeak.x, meta.swordPeak.y]);
  const [lkX, lkZ] = W(-0.42, -0.02);
  const [mdX, mdZ] = W(-0.25, -0.68);
  const [cpX, cpZ] = W(meta.camps[0][0], meta.camps[0][1]);
  const [pkX, pkZ] = W(meta.peak.x, meta.peak.y);
  const [sandX, sandZ] = W(BEACH.center, beachShore(BEACH.center) - 0.018);
  const northExit = tunnelPortals.find(t => t.name === '北发射口') || tunnelPortals[0];

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
    { key: '0', name: '黑砾湾 · 沙滩与帘瀑', pos: [-210, 65, -590], look: [-55, 26, -380], fly: true },
    { key: '·', name: '全岛鸟瞰', pos: [1480, 1140, 1840], look: [-120, 100, -90], fly: true },
    { key: '·', name: '云雾林 · 林下步行', ...forestView, fly:false },
    { key: '·', name: '北湾外 · 水下陆架', pos: [350, Math.min(-2,heightAt(350,-680)+7), -680], look: [375,heightAt(375,-710),-710], fly:true },
    { key: '·', name: '帘瀑旁 · 白沙滩步行', pos: [sandX, heightAt(sandX, sandZ) + 1.72, sandZ], look: [100, 82, -240], fly: false },
    { key: '·', name: `主崖岬绝顶 (${meta.peak.h}m 刀刃山脊)`, pos: [pkX, heightAt(pkX, pkZ) + 4, pkZ], look: [lkX, 150, lkZ], fly: false },
    { key: '·', name: '镜湖南岸 · 湖滨草岸 (139m)', pos: [lkX + 20, heightAt(lkX + 20, lkZ + 178) + 2, lkZ + 178], look: [lkX - 20, 145, lkZ - 80], fly: false },
    { key: '·', name: '破火山口碗底 · 镜湖 (138m)', pos: [lkX + 165, 148, lkZ - 110], look: [lkX - 60, 145, lkZ + 40], fly: true },
    { key: '·', name: '背风峡谷 · 岩隙营房 (~100人)', pos: [cpX + 95, heightAt(cpX, cpZ) + 32, cpZ + 75], look: [cpX, heightAt(cpX, cpZ) + 4, cpZ], fly: true },
    { key: '·', name: '机库北发射口 (+90m 东岬北崖)', pos: [northExit.x + northExit.nx * 135, northExit.y + 18, northExit.z + northExit.nz * 135], look: [northExit.x, northExit.y, northExit.z], fly: true },
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

// 绘制 3.3 右下角小地图底图
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
      else if (m === 7) c = [232, 229, 212];
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
    try { canvas.requestPointerLock()?.catch(() => {}); } catch {}
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
canvas.addEventListener('wheel', event => {
  if (!started || sketchOpen) return;
  event.preventDefault();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  camera.fov = clamp(camera.fov * Math.exp(clamp(pixels,-200,200)*.0015), 18, 90);
  camera.updateProjectionMatrix();
  showToast('视角 ' + Math.round(camera.fov) + '°');
}, {passive:false});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 识别玩家当前所在地名
function currentPlace(wx, feetY, wz) {
  const vp = villa.placeAt(wx, wz, feetY);
  if (vp) return vp;
  if (feetY < -.5 && heightAt(wx,wz)<0) return '水下 · 海底地形';
  if (inLake(wx, wz) && feetY < LAKE_LEVEL + 18) return '镜湖 (138m)';
  const [xk, yk] = mapOf(wx, wz);
  if (beachProfile(xk, yk).sand > 0.45 && feetY < 15) return '黑砾湾 · 白沙滩';
  if (meta.meadow && meta.meadow.length && pip(meta.meadow, xk, yk) && feetY < 210) return '镜湖湖滨草岸';
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
goToSpot(SPOTS.findIndex(spot => spot.name === '全岛鸟瞰'));
const goBtn = $('go');
goBtn.disabled = false;
goBtn.textContent = '进入岛屿漫游';
status('3.3 场景就绪');
goBtn.addEventListener('click', () => {
  started = true;
  $('start').classList.add('hidden');
  if (canvas.requestPointerLock) {
    try { canvas.requestPointerLock()?.catch(() => {}); } catch {}
  }
});

// ═════════ 11. 主循环 (含软件 WebGL 帧节流防卡死守护) ═════════
const afterDraw = isSoftwareGl
  ? cb => setTimeout(() => requestAnimationFrame(cb), 16)
  : requestAnimationFrame;

const airFog = scene.fog, seaFog = new THREE.FogExp2(0x32676e,.013);
const shadowFocus = new THREE.Vector3(Infinity, Infinity, Infinity);
const shadowAim = new THREE.Vector3();
let lastT = performance.now();
let clockAcc = 0;

function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  clockAcc += dt;
  riverTime.value = clockAcc;
  oceanTime.value = clockAcc;

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
      const minSurface = inLake(player.x, player.z) ? LAKE_LEVEL + 0.8 : -800;
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
    player.x = clamp(player.x, -6200, 6200);
    player.z = clamp(player.z, -6200, 6200);
    player.y = clamp(player.y, player.fly ? -800 : 1.2, 2600);
  }

  // 更新崖宅电梯与能量核心动画、瀑布水雾及外海浪沫呼吸动画
  villa.update(dt);
  coastalDetails.update(clockAcc);
  for (const sp of mistSprites) {
    sp.position.y = sp.userData.baseY + Math.sin(clockAcc * 1.6 + sp.userData.phase) * 1.8;
  }
  for (const fm of foamRings) {
    const s = 1 + 0.06 * Math.sin(clockAcc * 1.9 + fm.userData.phase);
    fm.scale.set(s, s, 1);
  }

  camera.position.set(player.x, player.y, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if(updateForest(camera.position)) renderer.shadowMap.needsUpdate=true;
  updateUnderstory(camera.position);

  updateHud();
  drawMinimap();

  waveMap.offset.set((clockAcc * 0.013) % 1, (clockAcc * 0.019) % 1);
  const submerged = camera.position.y < -0.15;
  scene.fog = submerged ? seaFog : airFog;
  scene.background = submerged ? seaFog.color : null;
  sky.visible = !submerged;
  sky.position.copy(camera.position);
  const aerial = Math.max(0, camera.position.y - Math.max(0,heightAt(player.x,player.z)));
  camera.getWorldDirection(shadowAim);
  shadowAim.multiplyScalar(Math.min(2050,aerial*1.8)).add(camera.position);
  shadowAim.y = Math.min(shadowAim.y,Math.max(camera.position.y-aerial, heightAt(shadowAim.x,shadowAim.z))+130);
  if (shadowAim.distanceToSquared(shadowFocus)>32*32) {
    shadowFocus.copy(shadowAim);
    const radius=360+Math.min(1700,aerial*1.45);
    Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,far:2*radius+2000});
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(shadowFocus);
    sun.position.copy(shadowFocus).addScaledVector(sunlight,radius+800);
    renderer.shadowMap.needsUpdate=true;
  }
  renderer.render(scene, camera);
  afterDraw(tick);
}
afterDraw(tick);

// 调试用:island.look(位置 [x,y,z], 注视点 [x,y,z]),坐标为世界米;island.km(x, y) 把设定公里坐标换成世界 X/Z
window.island = {
  look(p, t) {
    started = true; $('start')?.classList.add('hidden');
    Object.assign(player, { fly: true, vy: 0, x: p[0], y: p[1], z: p[2] });
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2];
    player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  },
  km: (x, y) => W(x, y), heightAt, scene, camera, player, renderer, surfaceTextures,
};
