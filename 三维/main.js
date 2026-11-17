// 岛屿基地 · 三维漫游。地形与地物数据来自 草图/生成草图.mjs 导出的 data/ 目录。
import * as THREE from './vendor/three.module.min.js';
import { buildVilla } from './villa.js';

const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lin = v => Math.pow(clamp(v), 2.2);
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, fx = u * u * (3 - 2 * u), fy = v * v * (3 - 2 * v);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const pip = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const status = s => { $('status').textContent = s; };
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 80); }); // 页面在后台时 rAF 不触发,用定时器兜底

// ═════════ 数据 ═════════
status('读取地形数据…');
const [meta, hbuf, mbuf] = await Promise.all([
  fetch('data/island.json').then(r => r.json()),
  fetch('data/height.bin').then(r => r.arrayBuffer()),
  fetch('data/mat.bin').then(r => r.arrayBuffer()),
]);
const KM = 1000, G = meta.grid, NX = G.nx, NY = G.ny, STEP = G.step * KM, X0 = G.x0 * KM, N0 = G.y0 * KM;
const hm = new Int16Array(hbuf), mat = new Uint8Array(mbuf), Hf = new Float32Array(NX * NY);
for (let k = 0; k < Hf.length; k++) Hf[k] = hm[k] * meta.heightScale;
// 世界坐标:X 向东,Y 向上,北 = −Z;设定里的 (x, y) 公里 → (X, Z) 米
const W = (xkm, ykm) => [xkm * KM, -ykm * KM];
function heightAt(X, Z) {
  const fx = clamp((X - X0) / STEP, 0, NX - 1.001), fy = clamp((-Z - N0) / STEP, 0, NY - 1.001);
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * NX + i;
  return Hf[k] * (1 - u) * (1 - v) + Hf[k + 1] * u * (1 - v) + Hf[k + NX] * (1 - u) * v + Hf[k + NX + 1] * u * v;
}
const idxAt = (X, Z) => clamp(Math.round((-Z - N0) / STEP), 0, NY - 1) * NX + clamp(Math.round((X - X0) / STEP), 0, NX - 1);
const LAKE_LEVEL = meta.lakeLevel;
const lakeBox = meta.lake.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [9, -9, 9, -9]);
const inLake = (X, Z) => { const x = X / KM, y = -Z / KM; return x > lakeBox[0] && x < lakeBox[1] && y > lakeBox[2] && y < lakeBox[3] && pip(meta.lake, x, y); };

// ═════════ 渲染器与场景 ═════════
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
const scene = new THREE.Scene();
const FOG_AIR = new THREE.Color(0xbfd6e6), FOG_SEA = new THREE.Color(0x0f4a63);
scene.fog = new THREE.FogExp2(FOG_AIR.getHex(), 0.00016);
const camera = new THREE.PerspectiveCamera(68, 1, 1.0, 16000);
camera.rotation.order = 'YXZ';

const sunDir = new THREE.Vector3(-0.42, 0.72, 0.55).normalize();
scene.add(new THREE.HemisphereLight(0xdcebff, 0x6d7a5c, 1.35));
const sun = new THREE.DirectionalLight(0xfff1da, 2.4);
sun.position.copy(sunDir).multiplyScalar(5000);
scene.add(sun);

// 天穹
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(12000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x2f6fc4) }, uHorizon: { value: FOG_AIR.clone() }, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color(0xfff0cc) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = mix(uHorizon, uTop, pow(clamp(d.y, 0.0, 1.0), 0.5));
        float s = max(dot(d, uSun), 0.0);
        col += uSunCol * (pow(s, 700.0) * 4.0 + pow(s, 22.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

// ═════════ 地形 ═════════
status('生成地形…');
await nextFrame();
const terrainGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(NX * NY * 3);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    pos[k * 3] = X0 + i * STEP; pos[k * 3 + 1] = Hf[k]; pos[k * 3 + 2] = -(N0 + j * STEP);
  }
  const idx = new Uint32Array((NX - 1) * (NY - 1) * 6);
  let n = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    if (Hf[a] < -70 && Hf[b] < -70 && Hf[c] < -70 && Hf[d] < -70) continue; // 深海不画,下面有一块深色底板
    idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = b; idx[n++] = d; idx[n++] = c;
  }
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  terrainGeo.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
  terrainGeo.computeVertexNormals();
}
const tn = terrainGeo.attributes.normal.array;
// 地表配色(sRGB 0–1):丛林、草甸、沙滩、玄武岩、湖底、海底
function surfaceColor(k, i, j) {
  const h = Hf[k], m = mat[k], ny = tn[k * 3 + 1], n1 = hash(i, j), n2 = vnoise(i * 0.06, j * 0.06), n3 = vnoise(i * 0.31 + 9, j * 0.31 + 4);
  let c;
  if (m === 0 || m === 6) {
    const d = -h;
    c = m === 6 ? [0.82, 0.74, 0.55] : mix3([0.88, 0.83, 0.67], [0.42, 0.4, 0.37], sstep(0.72, 0.5, ny));
    c = mix3(c, [0.3, 0.58, 0.56], sstep(0.6, 12, d));
    c = mix3(c, [0.05, 0.16, 0.25], sstep(9, 65, d));
    return c;
  }
  if (m === 5) return mix3([0.56, 0.6, 0.44], [0.1, 0.24, 0.3], sstep(0, 14, LAKE_LEVEL - h));
  if (m === 3) c = mix3([0.92, 0.86, 0.68], [0.86, 0.78, 0.6], n3);
  else if (m === 2) c = mix3([0.48, 0.57, 0.26], [0.63, 0.65, 0.35], n2 * 0.6 + n3 * 0.4);
  else if (m === 4) {
    c = mix3([0.2, 0.18, 0.17], [0.36, 0.32, 0.28], 0.5 + 0.5 * Math.sin(h * 0.42 + n2 * 4));
    if (ny > 0.84 && h > 14) c = mix3(c, [0.28, 0.4, 0.2], 0.65);
    if (h < 3.5) c = mix3(c, [0.14, 0.13, 0.13], 0.55);
  } else {
    c = mix3([0.1, 0.19, 0.08], [0.19, 0.28, 0.11], n2 * 0.65 + n3 * 0.35);
    c = mix3(c, [0.24, 0.2, 0.13], 0.35 * vnoise(i * 0.9 + 3, j * 0.9 + 8)); // 林下落叶
    if (ny < 0.8) c = mix3(c, [0.3, 0.27, 0.23], sstep(0.8, 0.6, ny));
  }
  const g = 0.9 + 0.2 * n1;
  return [c[0] * g, c[1] * g, c[2] * g];
}
{
  const col = new Float32Array(NX * NY * 3);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, c = surfaceColor(k, i, j);
    col[k * 3] = lin(c[0]); col[k * 3 + 1] = lin(c[1]); col[k * 3 + 2] = lin(c[2]);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));

// 深海底板
const abyss = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshBasicMaterial({ color: 0x0a2c42 }));
abyss.rotation.x = -Math.PI / 2; abyss.position.y = -72;
scene.add(abyss);

// ═════════ 水体 ═════════
function tileNoiseTexture(size, period, seed) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  const lat = (i, j) => hash(((i % period) + period) % period + seed, ((j % period) + period) % period + seed * 3);
  const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, fx = u * u * (3 - 2 * u), fy = v * v * (3 - 2 * v); const a = lat(i, j), b = lat(i + 1, j), c = lat(i, j + 1), d = lat(i + 1, j + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  // 先算出可平铺的平滑高度场,再由坡度得到法线贴图
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * period, v = (y / size) * period;
    hgt[y * size + x] = 0.6 * vn(u, v) + 0.4 * vn(u * 2 + 3.7, v * 2 + 1.3);
  }
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 14, dy = (at(x, y + 1) - at(x, y - 1)) * 14, l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    img.data[k] = 127.5 * (1 - dx / l); img.data[k + 1] = 127.5 * (1 - dy / l); img.data[k + 2] = 127.5 * (1 + 1 / l); img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const waveTex = tileNoiseTexture(256, 8, 3);
waveTex.repeat.set(420, 420);
const seaMat = new THREE.MeshPhongMaterial({ color: 0x1b6283, transparent: true, opacity: 0.62, shininess: 90, specular: 0x6f8794, normalMap: waveTex, normalScale: new THREE.Vector2(0.55, 0.55), side: THREE.DoubleSide, depthWrite: false });
const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), seaMat);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

// 镜湖
const freshMat = new THREE.MeshPhongMaterial({ color: 0x3f8f9a, transparent: true, opacity: 0.78, shininess: 140, specular: 0xa9bcc4, side: THREE.DoubleSide, depthWrite: false });
{
  const shape = new THREE.Shape(meta.lake.map(p => new THREE.Vector2(p[0] * KM, p[1] * KM)));
  const lake = new THREE.Mesh(new THREE.ShapeGeometry(shape), freshMat);
  lake.rotation.x = -Math.PI / 2; lake.position.y = LAKE_LEVEL - 0.05;
  scene.add(lake);
}
// 白水河与帘瀑:沿河道贴地的水带,陡落处泛白
{
  const pts = [];
  for (let i = 0; i + 1 < meta.river.length; i++) {
    const [ax, az] = W(...meta.river[i]), [bx, bz] = W(...meta.river[i + 1]), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
    for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
  }
  pts.push(W(...meta.river[meta.river.length - 1]));
  const ys = pts.map(p => heightAt(p[0], p[1]) + 0.35);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.min(ys[i], ys[i - 1]); // 水只往低处流
  const pos = [], col = [], idx = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    const t = i / (pts.length - 1), w = 3.5 + 5 * t, y = Math.max(ys[i], 0.15);
    const steep = clamp((ys[Math.max(0, i - 1)] - ys[Math.min(ys.length - 1, i + 1)]) / 4);
    const c = mix3([0.16, 0.5, 0.62], [0.95, 0.98, 1], steep);
    pos.push(p[0] + nx * w, y, p[1] + nz * w, p[0] - nx * w, y, p[1] - nz * w);
    col.push(lin(c[0]), lin(c[1]), lin(c[2]), lin(c[0]), lin(c[1]), lin(c[2]));
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.88, side: THREE.DoubleSide })));
}

// ═════════ 几何工具 ═════════
function mergeGeoms(list) { // list: [{ g, color:[r,g,b] 或 (y)=>[r,g,b] }],合并成一个带顶点色的平直着色几何体
  const P = [], Cc = [];
  for (const { g, color } of list) {
    const src = g.index ? g.toNonIndexed() : g, p = src.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const c = typeof color === 'function' ? color(p[i + 1]) : color;
      P.push(p[i], p[i + 1], p[i + 2]); Cc.push(lin(c[0]), lin(c[1]), lin(c[2]));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  out.computeVertexNormals();
  return out;
}
function quadPrism(pts, t) { // 由空间四边形沿法向加厚成板
  const p = pts.map(a => new THREE.Vector3(a[0], a[1], a[2]));
  const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[3], p[0])).normalize().multiplyScalar(t / 2);
  const top = p.map(v => v.clone().add(n)), bot = p.map(v => v.clone().sub(n)), tri = [];
  const quad = (a, b, c, d) => tri.push(a, b, c, a, c, d);
  quad(top[0], top[1], top[2], top[3]); quad(bot[3], bot[2], bot[1], bot[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(top[j], top[i], bot[i], bot[j]); }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}
// 从海岸点沿内陆方向找到崖面升到 zTarget 的位置,返回以崖面为基准的局部坐标系(x 沿崖面向东,y 向上,z 向海)
function faceFrame(pkm, nkm, zTarget) {
  const [X, Z] = W(pkm[0], pkm[1]), N = new THREE.Vector3(nkm[0], 0, -nkm[1]).normalize(), T = new THREE.Vector3(-nkm[1], 0, -nkm[0]).normalize();
  let s = 0; while (s < 280 && heightAt(X - N.x * s, Z - N.z * s) < zTarget) s += 1;
  const m = new THREE.Matrix4().makeBasis(T, new THREE.Vector3(0, 1, 0), N).setPosition(X - N.x * s, 0, Z - N.z * s);
  const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(m); g.updateMatrixWorld(true);
  scene.add(g);
  return { g, m, inv: m.clone().invert(), N };
}
const add = (parent, geo, material, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geo, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

// ═════════ 崖宅(见 villa.js) ═════════
status('搭建崖宅与设施…');
await nextFrame();
const platforms = [], blockers = []; // 可以站上去的面、挡住去路的面(多边形,在崖宅局部坐标里)
const villaFrame = faceFrame(meta.villa.p, meta.villa.n, 150);
const villa = buildVilla({ THREE, scene, heightAt, frame: villaFrame, terrainGeo, platforms, blockers, Hf, NX, NY });

// ═════════ 发射口、发射井、营房、出击口 ═════════
const rimMat = new THREE.MeshBasicMaterial({ color: 0xff9d3b }), darkMat = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.8 });
for (const t of meta.tunnels) {
  const f = faceFrame(t.p, t.n, t.z + 3);
  add(f.g, new THREE.BoxGeometry(30, 15, 6), darkMat, 0, t.z, -1.5);
  add(f.g, new THREE.BoxGeometry(31.5, 0.7, 1), rimMat, 0, t.z + 7.5, 2); add(f.g, new THREE.BoxGeometry(31.5, 0.7, 1), rimMat, 0, t.z - 7.5, 2);
  add(f.g, new THREE.BoxGeometry(0.7, 15, 1), rimMat, -15.4, t.z, 2); add(f.g, new THREE.BoxGeometry(0.7, 15, 1), rimMat, 15.4, t.z, 2);
  t.world = new THREE.Vector3(0, t.z, 2).applyMatrix4(f.m);
}
const hatchMat = new THREE.MeshStandardMaterial({ color: 0x4b5244, roughness: 0.9 });
for (const s of meta.silos) {
  const [X, Z] = W(...s), y = heightAt(X, Z);
  add(scene, new THREE.CylinderGeometry(12, 12, 0.5, 28), hatchMat, X, y + 0.2, Z);
  add(scene, new THREE.TorusGeometry(12, 0.35, 6, 40).rotateX(Math.PI / 2), darkMat, X, y + 0.5, Z);
  for (let a = 0; a < 3; a++) add(scene, new THREE.BoxGeometry(24, 0.12, 0.3).rotateY((a * Math.PI) / 3), darkMat, X, y + 0.47, Z);
}
const barracks = []; // 营房位置,用来在周围留出林间空地
{
  const bMat = new THREE.MeshStandardMaterial({ color: 0x565c50, roughness: 0.95, flatShading: true }), roofMat = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 1, flatShading: true });
  meta.camps.forEach((c, ci) => {
    const g = rng(100 + ci * 17), [CX, CZ] = W(...c);
    for (let q = 0; q < 6; q++) {
      const X = CX + (g() - 0.5) * 150, Z = CZ + (g() - 0.5) * 110, y = heightAt(X, Z), rot = (g() - 0.5) * 1.2, len = 16 + g() * 8;
      const body = add(scene, new THREE.BoxGeometry(len, 3.4, 7), bMat, X, y + 1.4, Z); body.rotation.y = rot;
      const roof = add(scene, new THREE.BoxGeometry(len + 1.2, 0.5, 8.4), roofMat, X, y + 3.3, Z); roof.rotation.y = rot;
      const door = add(scene, new THREE.BoxGeometry(1.4, 2.2, 0.2), darkMat, X + Math.sin(rot) * 3.55, y + 1.1, Z + Math.cos(rot) * 3.55); door.rotation.y = rot;
      barracks.push([X, Z]);
    }
  });
}
for (const s of meta.sally) { // 出击口:谷地里半埋的暗门
  const [X, Z] = W(...s), y = heightAt(X, Z);
  const gx = heightAt(X + 6, Z) - heightAt(X - 6, Z), gz = heightAt(X, Z + 6) - heightAt(X, Z - 6), rot = Math.atan2(-gx, -gz);
  const frame = add(scene, new THREE.BoxGeometry(5, 3.6, 3), darkMat, X, y + 1.2, Z); frame.rotation.y = rot;
  const glow = add(scene, new THREE.BoxGeometry(3.4, 0.25, 0.3), rimMat, X + Math.sin(rot) * 1.6, y + 3.1, Z + Math.cos(rot) * 1.6); glow.rotation.y = rot;
}

// ═════════ 海蚀柱、乱石、幻域浮标 ═════════
const basalt = new THREE.MeshLambertMaterial({ color: 0x3b332d, flatShading: true });
for (const [sx, sy, rad] of meta.stacks) {
  const [X, Z] = W(sx, sy), h = 18 + rad * 1300, base = rad * KM * 0.85, g = rng(Math.round(sx * 977 + sy * 131 + 5000));
  for (let q = 0; q < 3; q++) {
    const hh = h * (1 - q * 0.28) + 14, geo = new THREE.ConeGeometry(base * (1 - q * 0.22), hh, 7, 3);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.82 + 0.36 * hash(i * 7 + q, Math.round(sx * 100)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    geo.computeVertexNormals();
    add(scene, geo, basalt, X + (g() - 0.5) * base * 1.3 * q, hh / 2 - 14, Z + (g() - 0.5) * base * 1.3 * q).rotation.y = g() * 6;
  }
}
{
  const spots = [], g = rng(77);
  for (let j = 2; j < NY - 2; j++) for (let i = 2; i < NX - 2; i++) {
    const k = j * NX + i, h = Hf[k];
    if (mat[k] === 4 && h < 13 && tn[k * 3 + 1] > 0.5) { if (g() < 0.5) spots.push(k); }
    else if (mat[k] === 0 && h > -6 && (mat[k - 2] === 4 || mat[k + 2] === 4 || mat[k - 2 * NX] === 4 || mat[k + 2 * NX] === 4)) { if (g() < 0.4) spots.push(k); }
  }
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), basalt, spots.length * 2), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let n = 0;
  for (const k of spots) for (let r2 = 0; r2 < 2; r2++) {
    const X = X0 + (k % NX) * STEP + (g() - 0.5) * STEP * 1.6, Z = -(N0 + Math.floor(k / NX) * STEP) + (g() - 0.5) * STEP * 1.6, s = 0.8 + g() * g() * 4.2;
    e.set(g() * 3, g() * 3, g() * 3); q.setFromEuler(e);
    M.compose(new THREE.Vector3(X, heightAt(X, Z) + s * 0.25, Z), q, new THREE.Vector3(s * (0.8 + g() * 0.6), s * (0.6 + g() * 0.5), s * (0.8 + g() * 0.6)));
    rocks.setMatrixAt(n++, M);
  }
  rocks.count = n; rocks.frustumCulled = false;
  scene.add(rocks);
}
const buoys = [];
{
  const rockGeo = new THREE.IcosahedronGeometry(7, 1).scale(1, 0.42, 1), ringGeo = new THREE.TorusGeometry(9, 0.22, 6, 40).rotateX(Math.PI / 2), keelGeo = new THREE.ConeGeometry(4.5, 42, 10).rotateX(Math.PI).translate(0, -21, 0);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xb48cff }), keelMat = new THREE.MeshBasicMaterial({ color: 0x8a66d8, transparent: true, opacity: 0.35, depthWrite: false });
  meta.buoys.forEach((b, i) => {
    const [X, Z] = W(...b), g = new THREE.Group();
    add(g, rockGeo, basalt, 0, 0.6, 0); add(g, ringGeo, ringMat, 0, 0.5, 0); add(g, keelGeo, keelMat);
    g.position.set(X, 0, Z); scene.add(g); buoys.push({ g, ph: i * 1.7 });
  });
}
// 幻域光幕:浮标一线之外一圈极淡的流光,只在岛内看得见
const veil = new THREE.Mesh(
  new THREE.CylinderGeometry(3400, 3400, 1500, 128, 1, true),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float band = n(vec2(vUv.x * 90.0 + uT * 0.05, vUv.y * 3.0 - uT * 0.12)) * n(vec2(vUv.x * 23.0 - uT * 0.03, vUv.y * 1.5));
        float a = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 2.2) * (0.05 + 0.5 * band);
        gl_FragColor = vec4(vec3(0.62, 0.45, 1.0) * a, a);
      }`,
  }),
);
veil.position.set(0, 700, -150); veil.renderOrder = 5;
scene.add(veil);

// ═════════ 丛林 ═════════
status('种树…');
await nextFrame();
{
  const leaf = y => { const t = clamp((y - 5.5) / 6.5); return [0.62 + 0.38 * t, 0.62 + 0.38 * t, 0.62 + 0.38 * t]; };
  const treeGeo = mergeGeoms([
    { g: new THREE.CylinderGeometry(0.3, 0.55, 7.5, 5, 1, true).translate(0, 3.75, 0), color: [1, 0.7, 0.62] }, // 树干颜色会再乘上每棵树的绿色色调,所以这里给得偏亮偏暖
    { g: new THREE.IcosahedronGeometry(1, 0).scale(4.6, 3.1, 4.6).translate(0, 8.4, 0), color: leaf },
    { g: new THREE.IcosahedronGeometry(1, 0).scale(3.3, 2.5, 3.3).translate(1.7, 10.4, 0.9), color: leaf },
  ]);
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const riverPts = meta.river.map(p => W(...p)), g = rng(4242), CELL = 480, cells = new Map(), SP = 15;
  const nearRiver = (X, Z) => riverPts.some(p => (p[0] - X) ** 2 + (p[1] - Z) ** 2 < 100);
  for (let Z = -(N0 + (NY - 1) * STEP); Z < -N0; Z += SP) for (let X = X0; X < X0 + (NX - 1) * STEP; X += SP) {
    const x = X + (g() - 0.5) * SP, z = Z + (g() - 0.5) * SP, k = idxAt(x, z);
    if (mat[k] !== 1 || tn[k * 3 + 1] < 0.76) { g(); continue; }
    const h = heightAt(x, z);
    if (h < 1.6 || g() > 0.5 + 0.5 * vnoise(x * 0.004, z * 0.004)) continue;
    if (barracks.some(b => (b[0] - x) ** 2 + (b[1] - z) ** 2 < 170) || nearRiver(x, z)) continue;
    const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push([x, h, z, 0.75 + g() * 0.75, g() * 6.283, g(), g()]);
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let total = 0;
  for (const list of cells.values()) {
    const im = new THREE.InstancedMesh(treeGeo, treeMat, list.length);
    list.forEach(([x, h, z, s, rot, c1, c2], i) => {
      q.setFromAxisAngle(up, rot);
      M.compose(new THREE.Vector3(x, h - 0.4, z), q, new THREE.Vector3(s * (0.9 + c2 * 0.3), s * (0.85 + c1 * 0.5), s * (0.9 + c2 * 0.3)));
      im.setMatrixAt(i, M);
      im.setColorAt(i, col.setRGB(0.17 + 0.16 * c1, 0.4 + 0.24 * c2, 0.11 + 0.1 * c1, THREE.SRGBColorSpace));
    });
    im.computeBoundingSphere();
    scene.add(im); total += list.length;
  }
  // 缓台上的耐盐矮灌木
  const shrubs = [];
  for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (mat[k] === 4 && tn[k * 3 + 1] > 0.86 && Hf[k] > 16 && g() < 0.35) shrubs.push(k); }
  const sh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x4d7a45, flatShading: true }), shrubs.length);
  shrubs.forEach((k, i) => {
    const X = X0 + (k % NX) * STEP + (g() - 0.5) * STEP, Z = -(N0 + Math.floor(k / NX) * STEP) + (g() - 0.5) * STEP, s = 1 + g() * 1.6;
    M.compose(new THREE.Vector3(X, heightAt(X, Z) + s * 0.3, Z), q.identity(), new THREE.Vector3(s * 1.3, s * 0.7, s * 1.3)); sh.setMatrixAt(i, M);
  });
  sh.frustumCulled = false; scene.add(sh);
  console.log(`树 ${total} 棵,灌木 ${shrubs.length} 丛,地形三角形 ${terrainGeo.index.count / 3}`);
}

// ═════════ 地名 ═════════
const labels = [];
function makeLabel(text, X, Y, Z) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.font = "600 58px 'Microsoft YaHei','PingFang SC',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 9; c.strokeStyle = 'rgba(8,16,22,.85)'; c.strokeText(text, 256, 66); c.fillStyle = '#fff'; c.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false }));
  sp.scale.set(0.17, 0.0425, 1); sp.position.set(X, Y, Z); sp.renderOrder = 20;
  scene.add(sp); labels.push({ sp, text, X, Z });
}
for (const [name, x, y] of meta.labels) { const [X, Z] = W(x, y); makeLabel(name, X, Math.max(heightAt(X, Z), 0) + 26, Z); }
makeLabel('崖宅', villa.label.x, villa.label.y, villa.label.z);
for (const t of meta.tunnels) makeLabel(t.name, t.world.x, t.world.y + 16, t.world.z);
for (const [i, c] of meta.camps.entries()) { const [X, Z] = W(...c); makeLabel('林中营房', X, heightAt(X, Z) + 22, Z); }

// ═════════ 行走与飞行 ═════════
const EYE = 1.7;
const player = { x: 0, z: 0, feet: 0, vy: 0, yaw: 0, pitch: 0, fly: false, onGround: true, swim: false };
const keys = new Set();
const tmpV = new THREE.Vector3();
const STEP_UP = 0.7;
function ground(X, Z, feet) { // 脚下的支撑面:地形,或崖宅里的楼板、坡道、平台
  // 取"不高于脚面太多"的最高一个面;如果一个都没有(比如面前是岩壁),返回头顶最近的面,移动时会被判为上不去
  const t = heightAt(X, Z);
  let best = t <= feet + STEP_UP ? t : -Infinity, above = t > feet + STEP_UP ? t : Infinity;
  for (const p of platforms) {
    tmpV.set(X, 0, Z).applyMatrix4(p.inv);
    const u = tmpV.x, w = tmpV.z;
    if (u < p.box[0] || u > p.box[1] || w < p.box[2] || w > p.box[3] || !pip(p.poly, u, w) || (p.holes && p.holes.some(h => pip(h, u, w)))) continue;
    const top = typeof p.top === 'function' ? p.top(u, w) : p.top;
    if (top <= feet + STEP_UP) { if (top > best) best = top; } else if (top < above) above = top;
  }
  return best > -Infinity ? best : above;
}
function blocked(X, Z, feet) { // 幕墙之类的挡板
  for (const b of blockers) {
    if (feet + EYE < b.y0 || feet > b.y1 || (b.active && !b.active(feet))) continue;
    tmpV.set(X, 0, Z).applyMatrix4(b.inv);
    if (tmpV.x > b.box[0] && tmpV.x < b.box[1] && tmpV.z > b.box[2] && tmpV.z < b.box[3] && pip(b.poly, tmpV.x, tmpV.z)) return true;
  }
  return false;
}
const waterAt = (X, Z, g) => (inLake(X, Z) ? LAKE_LEVEL : g < 0 ? 0 : -Infinity);
function standLevel(X, Z, feet) { const g = ground(X, Z, feet), w = waterAt(X, Z, g); return w - g > 1.45 ? { y: w - 1.45, swim: true } : { y: g, swim: false }; }
function tryMove(dx, dz) {
  const nx = player.x + dx, nz = player.z + dz, st = standLevel(nx, nz, player.feet);
  if (blocked(nx, nz, player.feet)) return false;
  if (st.y - player.feet > Math.hypot(dx, dz) * 1.75 + 0.45) return false; // 太陡,上不去
  player.x = nx; player.z = nz; return true;
}
function step(dt) {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight'), sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  if (player.fly) {
    const sp = (fast ? 240 : 55) * dt, cp = Math.cos(player.pitch), up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
    player.x += (-sy * cp * f + cy * s) * sp; player.z += (-cy * cp * f - sy * s) * sp; player.feet += (Math.sin(player.pitch) * f + up) * sp;
    player.feet = Math.max(player.feet, ground(player.x, player.z, player.feet) + 0.3); player.vy = 0;
  } else {
    const L = Math.hypot(f, s) || 1, sp = (fast ? 17 : 6.5) * (player.swim ? 0.55 : 1) * dt;
    const dx = ((-sy * f + cy * s) / L) * sp, dz = ((-cy * f - sy * s) / L) * sp;
    if ((dx || dz) && !tryMove(dx, dz)) { if (!tryMove(dx, 0)) tryMove(0, dz); }
    const st = standLevel(player.x, player.z, player.feet);
    player.swim = st.swim;
    if (player.onGround && player.feet - st.y < 1.2 && player.vy <= 0) player.feet = st.y; // 贴着坡面走
    if (player.feet > st.y + 0.02) { player.vy -= 26 * dt; player.feet += player.vy * dt; player.onGround = false; }
    if (player.feet <= st.y + 0.02) { player.feet = st.y; player.vy = 0; player.onGround = true; }
    if (keys.has('Space') && player.onGround && !player.swim) { player.vy = 7.6; player.feet += 0.08; player.onGround = false; }
  }
  camera.position.set(player.x, player.feet + EYE, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

// 传送点:x, y 为设定里的公里坐标;head 为朝向(0 北、90 东);alt 给出时切到飞行
const SPOTS = [
  { name: '月湾主滩', x: 0.22, y: 0.458, head: 205, pitch: 3 },
  { name: '帘瀑下', x: 0.16, y: 0.33, head: 215, pitch: 8 },
  { name: '镜湖北岸', x: -0.42, y: 0.2, head: 185, pitch: -2 },
  { name: '风草甸', x: -0.3, y: -0.72, head: 180, pitch: 4 },
  { name: '主崖顶', x: meta.peak.x - 0.02, y: meta.peak.y + 0.07, head: 185, pitch: -12 },
  { name: '崖宅 · 西翼露台', anchor: 'terrace', pitch: -4 },
  { name: '崖宅 · 主厅', anchor: 'hall', pitch: 2 },
  { name: '崖宅 · 重工实验室', anchor: 'lab', pitch: 3 },
  { name: '海上看南崖', x: -0.2, y: -2.45, alt: 70, head: 0, pitch: 6 },
  { name: '高空全景', x: -0.3, y: -4.3, alt: 1700, head: 0, pitch: -24 },
  { name: '崖宅 · 书房', anchor: 'study', pitch: 0 },
  { name: '崖宅 · 起降舌台', anchor: 'tongue', pitch: -6 },
  { name: '崖宅 · 卧室', anchor: 'bedroom', pitch: -4 },
  { name: '崖宅 · 幕墙廊道', anchor: 'promenade', pitch: 0 },
  { name: '崖宅 · 东翼起降坪', anchor: 'pad', pitch: -4 },
  { name: '东峡谷谷口', x: 1.235, y: -0.62, head: 345, pitch: 8 },
  { name: '西岬尖', x: -1.12, y: 1.72, head: 150, pitch: 0 },
];
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800); }
function setView(xkm, ykm, alt, headDeg, pitchDeg) {
  [player.x, player.z] = W(xkm, ykm);
  player.fly = alt != null; player.vy = 0; player.onGround = !player.fly;
  player.feet = player.fly ? alt - EYE : standLevel(player.x, player.z, 1e4).y;
  player.yaw = (-headDeg * Math.PI) / 180; player.pitch = (pitchDeg * Math.PI) / 180;
}
function teleport(i) {
  const s = SPOTS[i]; if (!s) return;
  if (s.anchor) {
    const p = villa.spots[s.anchor], n = villaFrame.N;
    player.x = p.x; player.z = p.z; player.feet = p.y; player.fly = false; player.vy = 0; player.onGround = true;
    player.yaw = Math.atan2(-n.x, -n.z); player.pitch = (s.pitch * Math.PI) / 180; // 面朝大海
  } else setView(s.x, s.y, s.alt ?? null, s.head, s.pitch);
  toast(s.name);
}
SPOTS.forEach((s, i) => {
  const b = document.createElement('button');
  b.innerHTML = `<kbd>${i < 10 ? (i + 1) % 10 : '·'}</kbd><span>${s.name}</span>`;
  b.addEventListener('click', e => { e.stopPropagation(); teleport(i); });
  $('spots').appendChild(b);
});

// 输入
let started = false, dragging = false;
addEventListener('keydown', e => {
  if (!started) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF') { player.fly = !player.fly; player.vy = 0; toast(player.fly ? '飞行' : '步行'); }
  else if (e.code === 'KeyL') { labelsOn = !labelsOn; toast(labelsOn ? '显示地名' : '隐藏地名'); }
  else if (e.code === 'KeyH') { veil.visible = !veil.visible; toast(veil.visible ? '显示幻域光幕' : '隐藏幻域光幕'); }
  else if (e.code === 'KeyM') $('map').classList.toggle('hidden');
  else if (e.code === 'KeyE' || e.code === 'KeyQ') { // 电梯:在轿厢里上下,在门口呼叫
    tmpV.set(player.x, 0, player.z).applyMatrix4(villaFrame.inv);
    const msg = villa.lift.use(tmpV.x, tmpV.z, player.feet, e.code === 'KeyE' ? 1 : -1);
    if (msg) toast(msg);
  }
  else if (/^Digit\d$/.test(e.code)) teleport((Number(e.code.slice(5)) + 9) % 10);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const lockMouse = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 有些环境不支持锁定鼠标,退回按住左键拖动 */ } };
canvas.addEventListener('click', () => { if (started && document.pointerLockElement !== canvas) lockMouse(); });
canvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (!started || (document.pointerLockElement !== canvas && !dragging)) return;
  player.yaw -= e.movementX * 0.0022; player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.5, 1.5);
});

// ═════════ 小地图与读数 ═════════
const mini = $('mini'), mctx = mini.getContext('2d'), mapBase = document.createElement('canvas');
mapBase.width = mini.width; mapBase.height = mini.height;
{
  const c = mapBase.getContext('2d'), img = c.createImageData(mapBase.width, mapBase.height);
  for (let py = 0; py < mapBase.height; py++) for (let px = 0; px < mapBase.width; px++) {
    const i = Math.min(NX - 1, Math.round((px / (mapBase.width - 1)) * (NX - 1))), j = Math.min(NY - 1, Math.round((1 - py / (mapBase.height - 1)) * (NY - 1))), k = j * NX + i;
    let col = surfaceColor(k, i, j);
    if (mat[k] === 0 || mat[k] === 6) col = mix3(col, [0.16, 0.42, 0.56], 0.55);
    else { const shade = 0.72 + 0.5 * clamp(tn[k * 3] * -0.5 + tn[k * 3 + 2] * -0.5 + tn[k * 3 + 1] * 0.6); col = col.map(v => v * shade * 1.25); }
    const o = (py * mapBase.width + px) * 4;
    img.data[o] = 255 * clamp(col[0]); img.data[o + 1] = 255 * clamp(col[1]); img.data[o + 2] = 255 * clamp(col[2]); img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}
function drawMap() {
  mctx.drawImage(mapBase, 0, 0);
  const px = ((player.x - X0) / ((NX - 1) * STEP)) * mini.width, py = (1 - (-player.z - N0) / ((NY - 1) * STEP)) * mini.height;
  mctx.save(); mctx.translate(clamp(px, 4, mini.width - 4), clamp(py, 4, mini.height - 4)); mctx.rotate(-player.yaw);
  mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(5.5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5.5, 6); mctx.closePath();
  mctx.fillStyle = '#ffd24a'; mctx.strokeStyle = '#111'; mctx.lineWidth = 1.4; mctx.fill(); mctx.stroke(); mctx.restore();
}
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
function drawHud() {
  const head = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
  $('h-pos').textContent = `x ${(player.x / KM).toFixed(2)}  y ${(-player.z / KM).toFixed(2)} km`;
  $('h-alt').textContent = `${Math.round(player.feet + EYE)} m`;
  $('h-dir').textContent = `${DIRS[Math.round(head / 45) % 8]} ${Math.round(head)}°`;
  $('h-mode').textContent = player.fly ? '飞行' : player.swim ? '游泳' : '步行';
  let best = null, bd = 420 * 420;
  for (const l of labels) { const d = (l.X - player.x) ** 2 + (l.Z - player.z) ** 2; if (d < bd) { bd = d; best = l; } }
  tmpV.set(player.x, 0, player.z).applyMatrix4(villaFrame.inv);
  $('h-place').textContent = villa.lift.hint(tmpV.x, tmpV.z, player.feet) ?? (best ? best.text : heightAt(player.x, player.z) < 0 ? '海上' : '丛林');
}

// ═════════ 主循环 ═════════
let labelsOn = true, last = performance.now(), frame = 0;
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
function tick(now) { renderFrame(now); requestAnimationFrame(tick); }
function renderFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frame++;
  if (started) step(dt);
  sky.position.copy(camera.position);
  const t = now / 1000;
  waveTex.offset.set(t * 0.006, t * 0.004);
  for (const b of buoys) { b.g.position.y = Math.sin(t * 0.7 + b.ph) * 0.5; b.g.rotation.z = Math.sin(t * 0.5 + b.ph) * 0.04; }
  veil.material.uniforms.uT.value = t;
  villaFrame.animate?.(t, dt);
  const here = heightAt(camera.position.x, camera.position.z), wl = waterAt(camera.position.x, camera.position.z, here), under = camera.position.y < wl;
  scene.fog.color.copy(under ? FOG_SEA : FOG_AIR); scene.fog.density = under ? 0.03 : 0.00016;
  for (const l of labels) { const d = l.sp.position.distanceTo(camera.position); l.sp.visible = labelsOn && d < 5200 && d > 30; l.sp.material.opacity = clamp((5200 - d) / 1500); }
  renderer.render(scene, camera);
  if (frame % 5 === 0) { drawHud(); drawMap(); }
}

// 开始
setView(SPOTS[0].x, SPOTS[0].y, null, SPOTS[0].head, SPOTS[0].pitch);
step(0);
$('go').disabled = false; $('go').textContent = '进入岛屿'; status('');
$('go').addEventListener('click', () => { started = true; $('start').classList.add('hidden'); lockMouse(); toast(SPOTS[0].name); });
// 调试与截图用:island.view(x公里, y公里, 海拔或 null, 朝向度, 俯仰度)
window.island = { view: (x, y, alt, head = 0, pitch = 0) => { started = true; $('start').classList.add('hidden'); setView(x, y, alt, head, pitch); }, teleport: i => { started = true; $('start').classList.add('hidden'); teleport(i); }, frame: (n = 1) => { for (let i = 0; i < n; i++) renderFrame(last + 16); }, keys, player, renderer, scene };
// 调试用:把人放到崖宅局部坐标 (u, 海拔, w);face 为 'sea' | 'in' | 'east' | 'west'
window.island.villa = villa;
window.island.local = (u, y, w, face = 'sea') => {
  const p = new THREE.Vector3(u, y, w).applyMatrix4(villaFrame.m), e = villaFrame.m.elements, d = { sea: [e[8], e[10]], in: [-e[8], -e[10]], east: [e[0], e[2]], west: [-e[0], -e[2]] }[face];
  started = true; $('start').classList.add('hidden');
  Object.assign(player, { x: p.x, z: p.z, feet: y, fly: false, vy: 0, onGround: true, yaw: Math.atan2(-d[0], -d[1]), pitch: 0 });
};
requestAnimationFrame(tick);
