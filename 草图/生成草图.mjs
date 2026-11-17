// 按《岛屿设定.md》生成草图。运行: node 草图/生成草图.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ═════════ 设定数据(公里,x 向东,y 向北;高度为米) ═════════
// 岸线控制点,顺时针。第三项是该处悬崖高度,只有南岸悬崖段才有。
const CTRL = [
  [-2.45, 0.25, 10], [-2.25, 0.8], [-1.85, 1.05], [-1.55, 1.5], [-1.15, 1.85], [-0.9, 1.7], [-1.1, 1.3], [-1.0, 0.95],
  [-0.6, 0.7], [0.0, 0.5], [0.5, 0.48], [0.95, 0.62], [1.2, 0.85], [1.5, 0.9], [1.9, 0.7],
  [2.2, 0.3, 25], [2.1, -0.15, 45], [1.88, -0.44, 18], [1.60, -0.38, 8], [1.42, -0.66, 58], [1.26, -0.74, 10], [1.05, -1.2, 110],
  [0.7, -1.0, 120], [0.5, -1.12, 150], [0.24, -0.78, 125], [0.04, -1.05, 170], [-0.25, -1.45, 210],
  [-0.6, -1.2, 180], [-0.95, -0.75, 130], [-1.3, -1.0, 140], [-1.75, -1.15, 145], [-2.05, -0.7, 100],
  [-2.3, -0.35, 40], [-2.42, -0.08, 10],
];
const ROCKY = new Set([17, 18, 32, 33]); // 南岸的礁石滩段(东礁滩与西礁滩)
const segKind = i => (ROCKY.has(i) ? 'k' : i >= 15 ? 'c' : i >= 8 && i <= 11 ? 'b' : 'r'); // c 悬崖 k 礁石滩 b 沙滩 r 岩岸
const ISLET = { x: 2.78, y: 0.02, rx: 0.17, ry: 0.1, rot: 0.6 };
// 山脊骨架:每条由 [x, y, 增高, 横向宽度] 控制点样条插值而成,构成弧形分水岭与向北辐射的支脉
const RIDGES = [
  // 南岸主崖山脊(古火山残壁分水岭)
  [[-1.85, -0.95, 18, 0.22], [-1.35, -0.88, 16, 0.2], [-0.95, -0.65, 8, 0.18], [-0.30, -1.22, 14, 0.22], [0.25, -0.68, 8, 0.18], [1.02, -1.02, 18, 0.22], [1.42, -0.58, 16, 0.16]],
  // 西岬龙骨(西峰—鞍部—岬丘—西岬尖)
  [[-1.65, -0.52, 24, 0.24], [-1.42, 0.05, 24, 0.22], [-1.18, 0.65, 18, 0.17], [-1.24, 1.12, 34, 0.17], [-1.30, 1.42, 42, 0.17], [-1.12, 1.78, 14, 0.12]],
  // 镜湖西脊(分隔西沟与镜湖湖盆)
  [[-1.02, -0.62, 14, 0.18], [-1.02, -0.15, 22, 0.18], [-0.88, 0.38, 16, 0.15]],
  // 镜湖南—东缘岩坎台地(支撑湖盆东北缘天然岩坎至帘瀑顶缘 ~63m)
  [[-0.35, 0.08, 12, 0.20], [-0.12, 0.12, 20, 0.18], [0.02, 0.14, 22, 0.15]],
  // 望海脊(分隔白水河中谷与东峡谷—东沟)
  [[0.32, -0.62, 14, 0.20], [0.55, -0.22, 26, 0.22], [0.68, 0.22, 16, 0.18]],
  // 东断块鞍部(支撑东峡谷两壁及分水鞍部基底高度)
  [[0.96, -0.65, 36, 0.28], [1.10, -0.35, 38, 0.30], [1.10, -0.10, 36, 0.28]],
  // 东丘支脉(东崖肩—东丘—东岬)
  [[1.42, -0.55, 24, 0.20], [1.48, -0.10, 32, 0.24], [1.46, 0.28, 36, 0.24], [1.52, 0.78, 16, 0.16]],
];
const HILLS = [ // 独立山头叠加(与山脊骨架配合)与标注名
  [-1.6, -0.5, 20, 0.26, '西峰'], [-1.3, 1.42, 12, 0.18, '岬丘'], [1.45, 0.25, 15, 0.26, '东丘'],
  [0.55, -0.22, 8, 0.2, '望海脊'],
];
const LAKE = { x: -0.5, y: -0.05, rx: 0.32, ry: 0.19, rot: -0.25, depth: 18 };
const MEADOW = { x: -0.3, y: -0.8, rx: 0.27, ry: 0.16, rot: 0.2 };
const RIVER = [[-0.2, 0.02], [-0.05, 0.12], [0.05, 0.2], [0.12, 0.3], [0.3, 0.36], [0.28, 0.45], [0.36, 0.5]];
const FALLS = [0.05, 0.2];
const SCARP = [[-0.78, 0.19], [-0.48, 0.23], [-0.15, 0.23], [0.05, 0.19], [0.26, 0.08], [0.46, -0.05]]; // 镜湖北缘天然岩坎
const FEEDERS = [[[-1.35, -0.5], [-1.05, -0.3], [-0.8, -0.12]], [[-0.55, -0.55], [-0.6, -0.35], [-0.55, -0.22]]];
const GULLIES = [
  [[-1.5, -0.6], [-1.4, -0.2], [-1.2, 0.2], [-1.05, 0.55], [-0.85, 0.83]],
  [[1.26, -0.76], [1.18, -0.5], [1.10, -0.15], [1.13, 0.12], [1.05, 0.45], [1.1, 0.78]],
];
const VILLA_X = -0.3, SECTION_X = -0.35;
const TUNNELS = [
  { from: [-0.46, -0.76], aim: [-0.95, -0.75], z: 70, name: '西发射口' },
  { from: [-0.15, -0.76], aim: [0.24, -0.8], z: 60, name: '东发射口' },
  { from: [-0.32, -0.98], aim: [-0.35, -1.46], z: 65, name: '南发射口' },
];
const HANGAR_PLAN = [[-0.50, -0.98], [-0.14, -1.02], [-0.09, -0.64], [-0.45, -0.60]]; // 机库洞厅地下投影(风草甸正下方)
const SILOS = [[-0.42, -0.83], [-0.28, -0.76], [-0.17, -0.86]]; // 机库顶部发射井
const CAMPS = [[-0.3, -0.42], [-1.02, 0.2], [0.55, 0.02]]; // 林中营房
const HULL_PLAN = [[-0.52, -1.44], [-0.78, -0.95], [-1.02, -0.55], [-0.82, -0.28], [-0.25, -0.24], [0.32, -0.26], [0.65, -0.52], [0.55, -0.92], [0.35, -0.92], [-0.15, -1.42]];
const SALLY = [[-1.42, -0.25], [-1.1, 0.42], [0.1, 0.27], [0.3, 0.4], [1.1, -0.32], [1.08, 0.4]];
const WEST_GATE = { aim: [-2.05, -0.7], via: [[-1.3, -0.6], [-0.75, -0.66]], end: [-0.45, -0.95], depth: 60 };
const STACKS = [[-0.12, -1.63, 0.03], [-0.42, -1.6, 0.018], [1.16, -1.4, 0.026], [-1.9, -1.3, 0.024], [-1.68, -1.33, 0.016], [1.95, -0.62, 0.02]];
const HEADLANDS = [['主崖岬', -0.25, -1.45, 209], ['西崖角', -1.75, -1.15, 145], ['东南崖角', 1.05, -1.2, 110]];
// 主崖剖面(真实比例):s 为自海岸线向内陆的水平距离(米),z 为海拔
const CLIFF = [[0, 0], [12, 8], [22, 20], [29.5, 48], [45.5, 57], [53.8, 88], [73.8, 99.5], [79.8, 122], [91.8, 129], [93.2, 145], [89, 160], [85, 172], [88, 180], [96, 188], [110, 198], [135, 205], [165, 209]];
const APRON = [[-1400, -770], [-950, -650], [-600, -450], [-300, -270], [-130, -140], [-112, -80], [-100, -45], [-90, -30], [-60, -14], [-30, -4], [0, 0]];

// ═════════ 工具 ═════════
const r = n => Math.round(n * 10) / 10;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = c => `rgb(${c.map(v => Math.round(clamp(v, 0, 255))).join(',')})`;
const range = (a, b, s) => { const out = []; for (let v = a; v <= b + 1e-9; v += s) out.push(v); return out; };
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
function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * (vnoise(x * f, y * f) - 0.5); a *= 0.5; f *= 2; } return s; }
const bez = (p1, c1, c2, p2, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p1[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p2[k]); };
function spline(pts, closed, per = 12) {
  const n = pts.length, out = [], at = i => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < per; k++) out.push(bez(p1, c1, c2, p2, k / per));
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function blob({ x, y, rx, ry, rot = 0 }, seed, n = 48, rough = 1) {
  const g = rng(seed), ph = [g() * 6.28, g() * 6.28, g() * 6.28];
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    const m = 1 + rough * (0.18 * Math.sin(2 * a + ph[0]) + 0.12 * Math.sin(3 * a + ph[1]) + 0.07 * Math.sin(5 * a + ph[2]));
    const px = rx * m * Math.cos(a), py = ry * m * Math.sin(a), c = Math.cos(rot), s = Math.sin(rot);
    return [x + px * c - py * s, y + px * s + py * c];
  });
}
const pip = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const dist2Pts = (pts, x, y) => { let m = Infinity; for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < m) m = d; } return m; };
const lerpLine = (pts, v) => { if (v <= pts[0][0]) return pts[0][1]; for (let i = 0; i + 1 < pts.length; i++) if (v <= pts[i + 1][0]) return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (v - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[pts.length - 1][1]; };
function ridgeSamples(pts, per = 18) {
  const n = pts.length, out = [], at = i => pts[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, u = 1 - t;
      const pt = [0, 1].map(m => {
        const c1 = p1[m] + (p2[m] - p0[m]) / 6, c2 = p2[m] - (p3[m] - p1[m]) / 6;
        return u * u * u * p1[m] + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p2[m];
      });
      out.push([pt[0], pt[1], p1[2] + (p2[2] - p1[2]) * t, p1[3] + (p2[3] - p1[3]) * t]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}
function prepPath(pts, pad = 0.45) {
  const cum = [0]; let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][0] < xmin) xmin = pts[i][0]; if (pts[i][0] > xmax) xmax = pts[i][0];
    if (pts[i][1] < ymin) ymin = pts[i][1]; if (pts[i][1] > ymax) ymax = pts[i][1];
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const tot = cum[cum.length - 1] || 1;
  return { pts, cum: cum.map(v => v / tot), box: [xmin - pad, xmax + pad, ymin - pad, ymax + pad] };
}
const inBox = (b, x, y) => x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3];
function nearestOnPath(info, x, y) {
  const { pts, cum } = info;
  let bestD2 = Infinity, bestT = 0, bestSn = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    const u = l2 > 1e-12 ? clamp(((x - a[0]) * vx + (y - a[1]) * vy) / l2, 0, 1) : 0;
    const px = a[0] + u * vx, py = a[1] + u * vy, d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = cum[i] + u * (cum[i + 1] - cum[i]);
      bestSn = (y - py) * vx - (x - px) * vy;
    }
  }
  const d = Math.sqrt(bestD2);
  return { d, t: bestT, sn: bestSn >= 0 ? d : -d };
}

// ═════════ 岸线:控制点样条 + 噪声扰动 ═════════
const coast = (() => {
  const n = CTRL.length, PER = 30, raw = [];
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < PER; k++) {
      const t = k / PER;
      let kind = segKind(i);
      if (i === 1 && k >= 8 && k <= 20) kind = 'b';
      if ((i === 19 && t > 0.55) || (i === 20 && t < 0.35)) kind = 'k';
      raw.push({ p: bez(p1, c1, c2, p2, t), kind, hc: i >= 15 ? (p1[2] ?? 0) + ((p2[2] ?? 0) - (p1[2] ?? 0)) * t : 0 });
    }
  }
  const m = raw.length, amp0 = raw.map(s => (s.kind === 'b' ? 0.05 : s.kind === 'k' ? 0.14 : 0.22));
  const amp = amp0.map((_, i) => { let s = 0; for (let d = -7; d <= 7; d++) s += amp0[(i + d + m) % m]; return s / 15; });
  return raw.map((s, i) => {
    const a = raw[(i - 1 + m) % m].p, b = raw[(i + 1) % m].p;
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const d = amp[i] * fbm(s.p[0] * 2.3 + 11.3, s.p[1] * 2.3 + 4.7, 4) + (amp[i] / 4) * fbm(s.p[0] * 9 + 3, s.p[1] * 9 + 8, 3);
    return { ...s, p: [s.p[0] + nx * d, s.p[1] + ny * d] };
  });
})();
const coastPts = coast.map(s => s.p);
const cliffS = coast.filter(s => s.kind === 'c' || s.kind === 'k'), northS = coast.filter(s => s.kind === 'r' || s.kind === 'b');
const northPts = northS.map(s => s.p);
const lakePts = blob(LAKE, 5), meadowPts = blob(MEADOW, 9);
const riverPts = spline(RIVER, false), gullyPts = GULLIES.map(g => spline(g, false)), feederPts = FEEDERS.map(f => spline(f, false));
const scarpInfo = prepPath(spline(SCARP, false), 0.5);
const riverInfo = prepPath(riverPts, 0.45), gullyInfos = gullyPts.map(g => prepPath(g, 0.45)), feederInfos = feederPts.map(f => prepPath(f, 0.35));
const ridgeSamplesList = RIDGES.map(rd => ridgeSamples(rd, 18));

// ═════════ 地形 ═════════
function baseHeight(x, y) {
  let ds = Infinity, hs = 0, ws = 0;
  for (const s of cliffS) { const d2 = (s.p[0] - x) ** 2 + (s.p[1] - y) ** 2; if (d2 < ds) ds = d2; const w = 1 / (d2 * d2 + 1e-7); ws += w; hs += w * s.hc; }
  ds = Math.sqrt(ds);
  const dn = Math.sqrt(dist2Pts(northPts, x, y)), dCoast = Math.min(ds, dn);
  const fade = sstep(0, 0.045, dCoast);
  let h = (hs / ws) * Math.pow(dn / (dn + ds + 1e-9), 0.85);
  let rMax = 0;
  for (const pts of ridgeSamplesList) {
    for (const p of pts) {
      const v = p[2] * Math.exp(-((x - p[0]) ** 2 + (y - p[1]) ** 2) / (p[3] * p[3]));
      if (v > rMax) rMax = v;
    }
  }
  h += rMax * fade;
  for (const [bx, by, a, sg] of HILLS) h += a * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (sg * sg)) * fade;
  h += (11 * fbm(x * 2.6 + 3.1, y * 2.6 + 7.7, 5) + 2.8 * fbm(x * 11, y * 11, 3)) * fade;
  const hRef = 128 + 4 * fbm(x * 1.1 + 2.1, y * 1.1 + 5.3, 2);
  const terrMask = sstep(22, 48, h) * (1 - sstep(155, 188, h)) * sstep(0, 0.1, dCoast);
  h -= 4.2 * Math.sin((2 * Math.PI * (h - hRef)) / 62) * terrMask;
  return [Math.max(h, 0.3), ds, dn];
}
const meadowLevel = Math.round(baseHeight(MEADOW.x, MEADOW.y)[0]);
const lakeLevel = Math.round(baseHeight(LAKE.x, LAKE.y)[0] - 4);
const TG = { x0: -2.9, y0: -1.8, step: 0.0125, nx: 449, ny: 297 };
const Hh = new Float32Array(TG.nx * TG.ny), DSg = new Float32Array(TG.nx * TG.ny), DNg = new Float32Array(TG.nx * TG.ny), INg = new Uint8Array(TG.nx * TG.ny);
for (let j = 0; j < TG.ny; j++) for (let i = 0; i < TG.nx; i++) {
  const x = TG.x0 + i * TG.step, y = TG.y0 + j * TG.step, k = j * TG.nx + i;
  let [h, ds, dn] = baseHeight(x, y);
  // 风草甸:崖后的一级平缓阶地
  if (Math.abs(x - MEADOW.x) < 0.6 && Math.abs(y - MEADOW.y) < 0.5) {
    const dm = pip(meadowPts, x, y) ? 0 : Math.sqrt(dist2Pts(meadowPts, x, y));
    if (dm < 0.18) h += (meadowLevel - h) * (1 - sstep(0, 0.18, dm)) * 0.9;
  }
  // 镜湖:碟形缓坡入水的湖盆,北缘有天然玄武岩岩坎
  const nearLake = Math.abs(x - LAKE.x) < 0.95 && Math.abs(y - LAKE.y) < 0.8;
  if (nearLake && pip(lakePts, x, y)) h = lakeLevel;
  else {
    if (nearLake) {
      const dl = Math.sqrt(dist2Pts(lakePts, x, y));
      if (dl < 0.36) {
        const wLake = Math.pow(1 - sstep(0, 0.36, dl), 1.6);
        const target = lakeLevel + 2 + 18 * sstep(0, 0.36, dl);
        h += (target - h) * wLake;
      }
    }
    // 镜湖北缘天然岩坎(帘瀑陡坎)
    if (inBox(scarpInfo.box, x, y)) {
      const sc = nearestOnPath(scarpInfo, x, y);
      const endFade = sstep(0, 0.18, sc.t) * (1 - sstep(0.82, 1, sc.t));
      h -= 18 * sstep(-0.035, 0.055, sc.sn) * endFade * sstep(0, 0.12, dn) * clamp((h - 8) / 28, 0, 1);
    }
    const fade = sstep(0, 0.08, dn);
    // 白水河:岩坎上方浅平流槽,过帘瀑后跌落并向下游展宽(限定自然水力底面防止未到海边先触底)
    if (inBox(riverInfo.box, x, y)) {
      const np = nearestOnPath(riverInfo, x, y);
      const depth = 5 + 14 * sstep(0.34, 0.48, np.t);
      const sig = 0.048 + 0.092 * sstep(0.35, 1.0, np.t);
      const rFloor = np.t < 0.36 ? lakeLevel - 4 * (np.t / 0.36) : (lakeLevel - 4) * (1 - sstep(0.36, 0.48, np.t)) + 36 * (sstep(0.36, 0.48, np.t) * (1 - sstep(0.48, 1.0, np.t))) + 1.2 * sstep(0.48, 1.0, np.t);
      const cut = Math.min(depth, Math.max(0, h - rFloor));
      h -= cut * Math.exp(-(np.d * np.d) / (sig * sig)) * fade;
    }
    // 西沟:上游圆润起头、下游向月湾西侧展宽
    if (inBox(gullyInfos[0].box, x, y)) {
      const np = nearestOnPath(gullyInfos[0], x, y);
      const sig = 0.05 + 0.075 * np.t, depth = (16 - 6 * np.t) * sstep(0, 0.18, np.t);
      const gFloor = 2 + 46 * (1 - np.t);
      const cut = Math.min(depth, Math.max(0, h - gFloor));
      h -= cut * Math.exp(-(np.d * np.d) / (sig * sig)) * fade;
    }
    // 东峡谷—东沟:南段陡壁深切峡谷,经分水鞍部(约 47 m)过渡为北段浅谷
    if (inBox(gullyInfos[1].box, x, y)) {
      const np = nearestOnPath(gullyInfos[1], x, y);
      const canyonW = 1 - sstep(-0.22, -0.05, y);
      const sig = 0.068 * canyonW + (0.06 + 0.07 * sstep(0.40, 1.0, np.t)) * (1 - canyonW);
      const depth = 18 + 38 * sstep(-0.10, -0.45, y);
      const eFloor = np.t <= 0.40 ? 4 + 43 * sstep(0.02, 0.40, np.t) : 47 * (1 - sstep(0.40, 0.98, np.t)) + 1.5;
      const cut = Math.min(depth, Math.max(0, h - eFloor));
      const pwr = 2 + 1.2 * canyonW;
      h -= cut * Math.exp(-Math.pow(np.d / sig, pwr)) * fade;
    }
    // 镜湖两条补给小溪
    for (const fInfo of feederInfos) if (inBox(fInfo.box, x, y)) {
      const np = nearestOnPath(fInfo, x, y);
      h -= 5 * Math.exp(-(np.d * np.d) / (0.045 * 0.045)) * fade;
    }
    h = Math.max(h, 0.3);
  }
  Hh[k] = h; DSg[k] = ds; DNg[k] = dn; INg[k] = pip(coastPts, x, y) ? 1 : 0;
}
const sampler = (arr, g) => (x, y) => {
  const fx = clamp((x - g.x0) / g.step, 0, g.nx - 1.001), fy = clamp((y - g.y0) / g.step, 0, g.ny - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * g.nx + i;
  return arr[k] * (1 - u) * (1 - v) + arr[k + 1] * u * (1 - v) + arr[k + g.nx] * (1 - u) * v + arr[k + g.nx + 1] * u * v;
};
const H = sampler(Hh, TG), DS = sampler(DSg, TG), DN = sampler(DNg, TG);
const onLand = (x, y) => pip(coastPts, x, y);

// 统计量
const area = Math.abs(coastPts.reduce((s, p, i) => { const q = coastPts[(i + 1) % coastPts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
let peak = { h: 0 };
for (let j = 0; j < TG.ny; j++) for (let i = 0; i < TG.nx; i++) { const k = j * TG.nx + i; if (INg[k] && Hh[k] > peak.h) peak = { h: Hh[k], x: TG.x0 + i * TG.step, y: TG.y0 + j * TG.step }; }
const ext = coastPts.reduce((e, p) => [Math.min(e[0], p[0]), Math.max(e[1], p[0]), Math.min(e[2], p[1]), Math.max(e[3], p[1])], [9, -9, 9, -9]);
const nearestCliff = (x, y) => cliffS.reduce((b, s) => ((s.p[0] - x) ** 2 + (s.p[1] - y) ** 2 < (b.p[0] - x) ** 2 + (b.p[1] - y) ** 2 ? s : b));
for (const t of TUNNELS) { t.exit = nearestCliff(...t.aim).p; t.len = Math.hypot(t.exit[0] - t.from[0], t.exit[1] - t.from[1]); const L = t.len; t.dir = [(t.exit[0] - t.from[0]) / L, (t.exit[1] - t.from[1]) / L]; }
const villaCoast = cliffS.filter(s => Math.abs(s.p[0] - VILLA_X) < 0.03).reduce((b, s) => (!b || s.p[1] < b.p[1] ? s : b), null).p;
WEST_GATE.pos = nearestCliff(...WEST_GATE.aim).p;
WEST_GATE.path = [WEST_GATE.pos, ...WEST_GATE.via, WEST_GATE.end];
WEST_GATE.len = WEST_GATE.path.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - WEST_GATE.path[i - 1][0], p[1] - WEST_GATE.path[i - 1][1]) : 0), 0);

// ═════════ 浅海、礁盘、浮动发生器 ═════════
const XMIN = -3.9, XMAX = 3.9, YMAX = 2.95, YMIN = -3.0;
const UG = { x0: XMIN, y0: YMIN, step: 0.02, nx: 391, ny: 299 };
const Ug = new Float32Array(UG.nx * UG.ny);
const isletPts = blob(ISLET, 33, 18, 1.5);
const shoalPts = [[2.2, 0.15], [2.38, 0.11], [2.56, 0.07], [2.75, 0.02]];
const chanInfo = prepPath([[0.05, 0.85], [0.1, 1.3], [0.16, 1.85]], 0.38);
const shelfOf = { c: 0.07, k: 0.16, r: 0.48, b: 0.88 };
for (let j = 0; j < UG.ny; j++) for (let i = 0; i < UG.nx; i++) {
  const x = UG.x0 + i * UG.step, y = UG.y0 + j * UG.step;
  let m = Infinity;
  for (const s of coast) { const d = ((s.p[0] - x) ** 2 + (s.p[1] - y) ** 2) / (shelfOf[s.kind] ** 2); if (d < m) m = d; }
  for (const p of isletPts) { const d = ((p[0] - x) ** 2 + (p[1] - y) ** 2) / (0.55 ** 2); if (d < m) m = d; }
  for (const p of shoalPts) { const d = ((p[0] - x) ** 2 + (p[1] - y) ** 2) / (0.45 ** 2); if (d < m) m = d; }
  let u = Math.sqrt(m) / (0.75 + 0.55 * vnoise(x * 1.4 + 5, y * 1.4 + 9) + 0.18 * fbm(x * 3.1 + 1, y * 3.1 + 2, 3));
  if (inBox(chanInfo.box, x, y)) {
    const ch = nearestOnPath(chanInfo, x, y);
    u += 0.42 * sstep(0.92, 1.28, y) * (1 - sstep(1.65, 2.0, y)) * Math.exp(-(ch.d * ch.d) / (0.12 * 0.12));
  }
  Ug[j * UG.nx + i] = u;
}
const U = sampler(Ug, UG);
const reefs = (() => {
  const g = rng(7), out = [];
  for (let a = -28; a <= 208; a += 5 + g() * 5.5) {
    if ((a > 77 && a < 93) || g() < 0.16) continue;
    const th = (a * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    let R = 0.8; while (R < 3.6 && (onLand(R * c, 0.1 + R * s) || U(R * c, 0.1 + R * s) < 0.86)) R += 0.02;
    R *= 0.84 + g() * 0.18;
    const size = 0.05 + g() * g() * 0.2;
    if (onLand(R * c, 0.1 + R * s) || Math.sqrt(dist2Pts(coastPts, R * c, 0.1 + R * s)) < 0.22 || Math.hypot(R * c - ISLET.x, 0.1 + R * s - ISLET.y) < 0.28) continue;
    out.push({ x: R * c, y: 0.1 + R * s, rx: size * (1 + g() * 1.2), ry: size * (0.45 + g() * 0.3), rot: th + Math.PI / 2 + (g() - 0.5) * 0.9, seed: Math.floor(g() * 1e6) });
  }
  for (let k = 0, tries = 0; k < 11 && tries < 400; tries++) {
    const x = -2.6 + g() * 5.2, y = 0.3 + g() * 2.2, u = U(x, y);
    if (u < 0.25 || u > 0.72 || onLand(x, y) || Math.sqrt(dist2Pts(coastPts, x, y)) < 0.12) continue;
    out.push({ x, y, rx: 0.02 + g() * 0.035, ry: 0.015 + g() * 0.025, rot: g() * 3, seed: Math.floor(g() * 1e6), head: true }); k++;
  }
  return out;
})();
const channel = (() => { const th = (85 * Math.PI) / 180; let R = 0.8; while (R < 3.6 && (onLand(R * Math.cos(th), 0.1 + R * Math.sin(th)) || U(R * Math.cos(th), 0.1 + R * Math.sin(th)) < 1.1)) R += 0.02; return [R * Math.cos(th), 0.1 + R * Math.sin(th)]; })();
const gens = (() => { const g = rng(21), out = []; for (let k = 0; k < 13; k++) { const th = (((k * 360) / 13 + (g() - 0.5) * 17) * Math.PI) / 180, f = 0.84 + g() * 0.3; out.push([3.2 * f * Math.cos(th), 0.15 + 2.4 * f * Math.sin(th)]); } return out; })();

// ═════════ PNG ═════════
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, pix) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { // Sub 滤波,平滑渐变压缩得更小
    const ro = y * (w * 3 + 1), so = y * w * 3; raw[ro] = 1;
    for (let i = 0; i < w * 3; i++) raw[ro + 1 + i] = (pix[so + i] - (i >= 3 ? pix[so + i - 3] : 0)) & 0xff;
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function scanMask(poly, w, h) {
  const m = new Uint8Array(w * h), n = poly.length;
  for (let py = 0; py < h; py++) {
    const yc = py + 0.5, xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi)); }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let px = Math.max(0, Math.ceil(xs[q] - 0.5)); px <= Math.min(w - 1, Math.floor(xs[q + 1] - 0.5)); px++) m[py * w + px] = 1;
  }
  return m;
}

// ═════════ 样式 ═════════
const FONT = `'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC',sans-serif`;
const C = { sand: '#f3e3b6', rock: '#4f4238', water: '#3f8fcf', ink: '#1f2c36', under: '#b23b28', hull: '#c08a1e', field: '#7a55b5', reef: '#e2d8ae', contour: '#2f4f36', landDark: '#4f8656', esc: '#19a05a' };
const style = `
  text{font-family:${FONT};fill:${C.ink}}
  .t{font-size:12px} .s{font-size:10.5px} .xs{font-size:9.5px} .b{font-weight:700}
  .halo{paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
  .dhalo{paint-order:stroke;stroke:#16212a;stroke-width:3px;stroke-linejoin:round;fill:#fff}
  .title{font-size:19px;font-weight:700} .sub{font-size:11.5px;fill:#4a5a66}
  .mid{text-anchor:middle} .end{text-anchor:end}
`;
const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><style>${style}</style>`;
const txt = (x, y, s, cls = 't halo', extra = '') => `<text x="${r(x)}" y="${r(y)}" class="${cls}" ${extra}>${s}</text>`;
const crPath = (pts, closed, M) => {
  const n = pts.length, at = i => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  let d = 'M' + M(pts[0]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${M([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${M([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${M(p2)}`;
  }
  return d + (closed ? 'Z' : '');
};
const GRADS = `
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3f2"/><stop offset="1" stop-color="#f5f1e4"/></linearGradient>
  <linearGradient id="rockg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7e6c"/><stop offset="1" stop-color="#463a32"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ecf8"/><stop offset=".5" stop-color="#5fa6c9"/><stop offset="1" stop-color="#234f6c"/></linearGradient>
  <linearGradient id="glassx" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#081a27" stop-opacity=".7"/><stop offset=".25" stop-color="#081a27" stop-opacity="0"/><stop offset=".7" stop-color="#081a27" stop-opacity="0"/><stop offset="1" stop-color="#081a27" stop-opacity=".7"/></linearGradient>
  <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f4ec"/><stop offset="1" stop-color="#b9b6ad"/></linearGradient>
  <linearGradient id="alloy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a525b"/><stop offset="1" stop-color="#14181c"/></linearGradient>
  <linearGradient id="bladeTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#96a3ad"/><stop offset=".48" stop-color="#56616a"/><stop offset="1" stop-color="#2e363d"/></linearGradient>
  <linearGradient id="bladeSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c444c"/><stop offset="1" stop-color="#191e23"/></linearGradient>
  <radialGradient id="atriumGlow" cx=".44" cy=".48" r=".62"><stop offset="0" stop-color="#ffe5aa"/><stop offset=".38" stop-color="#d8893c"/><stop offset=".78" stop-color="#3d291a"/><stop offset="1" stop-color="#141a20"/></radialGradient>
  <radialGradient id="labglow" cx=".5" cy=".55" r=".65"><stop offset="0" stop-color="#ffd9a0"/><stop offset=".45" stop-color="#c7772e"/><stop offset="1" stop-color="#1a110b"/></radialGradient>
  <radialGradient id="core" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#9fe8ff"/><stop offset="1" stop-color="#2aa6d6" stop-opacity="0"/></radialGradient>`;

// ═════════ 图一:平面图 ═════════
function planSVG() {
  const S = 120, FX = 12, FY = 62, FW = (XMAX - XMIN) * S, FH = (YMAX - YMIN) * S, W = 960, Ht = FY + FH + 112;
  const X = x => FX + (x - XMIN) * S, Y = y => FY + (YMAX - y) * S;
  const M = p => `${r(X(p[0]))},${r(Y(p[1]))}`;
  const pl = (pts, close) => 'M' + pts.map(M).join('L') + (close ? 'Z' : '');

  // 底图栅格:晕渲地形 + 水深 + 崖脚乱石裙
  const RS = Number(process.env.SKETCH_RS ?? 1), w = Math.round(FW * RS), h = Math.round(FH * RS), k = S * RS, buf = Buffer.alloc(w * h * 3);
  const toPx = p => [(p[0] - XMIN) * k, (YMAX - p[1]) * k];
  const land = scanMask(coastPts.map(toPx), w, h), lake = scanMask(lakePts.map(toPx), w, h), mead = scanMask(meadowPts.map(toPx), w, h);
  const Lv = [-0.603, 0.603, 0.523], e = 0.008;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = XMIN + (px + 0.5) / k, y = YMAX - (py + 0.5) / k, i = py * w + px;
    let c;
    if (lake[i]) c = mix([150, 208, 226], [58, 128, 190], sstep(0, 0.09, Math.sqrt(dist2Pts(lakePts, x, y))));
    else if (land[i]) {
      const hgt = H(x, y), gx = (H(x + e, y) - H(x - e, y)) / (2 * e * 1000), gy = (H(x, y + e) - H(x, y - e)) / (2 * e * 1000);
      const nx = -gx * 3.5, ny = -gy * 3.5, nl = Math.hypot(nx, ny, 1), sh = (nx * Lv[0] + ny * Lv[1] + Lv[2]) / nl;
      c = hgt < 60 ? mix([150, 192, 128], [110, 168, 108], hgt / 60) : hgt < 130 ? mix([110, 168, 108], [90, 148, 96], (hgt - 60) / 70) : mix([90, 148, 96], [80, 132, 90], clamp((hgt - 130) / 80));
      const tex = 0.93 + 0.1 * vnoise(x * 60, y * 60) + 0.24 * fbm(x * 13, y * 13, 3);
      if (mead[i]) c = mix(c, [204, 210, 132], 0.85);
      const ds = DS(x, y); if (ds < 0.04) c = mix(c, [142, 126, 108], (1 - ds / 0.04) * 0.9);
      const dn = DN(x, y); if (dn < 0.02 && hgt < 6) c = mix(c, [226, 212, 168], 1 - dn / 0.02);
      c = c.map(v => v * tex * (0.55 + 0.86 * sh));
    } else {
      const u = U(x, y), n = fbm(x * 4, y * 4, 3) * 0.12;
      c = u < 1 ? mix([214, 243, 233], [112, 200, 204], Math.pow(clamp(u + n), 0.8)) : u < 1.5 ? mix([112, 200, 204], [60, 126, 176], (u - 1) / 0.5) : mix([60, 126, 176], [40, 92, 142], clamp((u - 1.5) / 3 + n));
      if (x > TG.x0 + 0.1 && x < 2.6 && y > TG.y0 + 0.1 && y < 1.8) {
        const ds = DS(x, y);
        if (ds < 0.085) { const sp = vnoise(x * 150, y * 150), rk = sp > 0.6 ? [240, 245, 246] : sp < 0.38 ? [58, 50, 44] : [104, 96, 88]; c = mix(rk, c, sstep(0.5, 1, ds / 0.085)); }
      }
    }
    buf[i * 3] = clamp(c[0], 0, 255); buf[i * 3 + 1] = clamp(c[1], 0, 255); buf[i * 3 + 2] = clamp(c[2], 0, 255);
  }
  const img = png(w, h, buf).toString('base64');

  const o = [svgOpen(W, Ht)];
  o.push(`<defs>
    <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.under}"/></marker>
    <marker id="arrk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.ink}"/></marker>
    <clipPath id="isle"><path d="${pl(coastPts, true)}"/></clipPath>
    <clipPath id="pf"><rect x="${FX}" y="${FY}" width="${FW}" height="${FH}"/></clipPath>
  </defs>`);
  o.push(`<rect width="${W}" height="${Ht}" fill="#fff"/>`);
  o.push(`<image x="${FX}" y="${FY}" width="${FW}" height="${FH}" preserveAspectRatio="none" href="data:image/png;base64,${img}" xlink:href="data:image/png;base64,${img}"/>`);
  o.push(`<g clip-path="url(#pf)">`);

  // 幻域中环:随发生器位置变化的不规则边界
  o.push(`<path d="${crPath(gens, true, M)}" fill="${C.field}" fill-opacity=".05" stroke="${C.field}" stroke-width="1.2" stroke-dasharray="7 5" opacity=".85"/>`);

  // 礁盘与珊瑚丛
  for (const f of reefs) {
    const pts = blob(f, f.seed, 22, 1.5);
    o.push(`<path d="${crPath(pts, true, M)}" fill="${C.reef}" fill-opacity="${f.head ? 0.8 : 0.9}" stroke="#fff" stroke-opacity=".75" stroke-width="${f.head ? 1 : 2.2}" stroke-dasharray="${f.head ? '' : '5 3 2 3'}"/>`);
    if (!f.head) o.push(`<path d="${crPath(blob({ ...f, rx: f.rx * 0.55, ry: f.ry * 0.5 }, f.seed + 3, 14, 1.2), true, M)}" fill="#bfae7c" fill-opacity=".6"/>`);
  }

  // 等高线
  for (const level of range(25, 200, 25)) {
    let d = '';
    for (let i = 0; i < TG.nx - 1; i++) for (let j = 0; j < TG.ny - 1; j++) {
      const k0 = j * TG.nx + i, ks = [k0, k0 + 1, k0 + TG.nx + 1, k0 + TG.nx];
      if (ks.some(q => !INg[q])) continue;
      const v = ks.map(q => Hh[q]), x0 = TG.x0 + i * TG.step, y0 = TG.y0 + j * TG.step, st = TG.step;
      const c = [[x0, y0], [x0 + st, y0], [x0 + st, y0 + st], [x0, y0 + st]], hit = [];
      for (let q = 0; q < 4; q++) { const a = q, b = (q + 1) % 4; if ((v[a] < level) !== (v[b] < level)) { const t = (level - v[a]) / (v[b] - v[a]); hit.push([c[a][0] + t * (c[b][0] - c[a][0]), c[a][1] + t * (c[b][1] - c[a][1])]); } }
      for (let q = 0; q + 1 < hit.length; q += 2) d += `M${M(hit[q])}L${M(hit[q + 1])}`;
    }
    o.push(`<path d="${d}" fill="none" stroke="${C.contour}" stroke-width="${level % 100 ? 0.6 : 1.1}" stroke-linecap="round" opacity="${level % 100 ? 0.45 : 0.7}"/>`);
  }

  // 冲沟、溪流、河
  for (const g of gullyPts) o.push(`<path d="${pl(g)}" fill="none" stroke="#1f3f2a" stroke-width="1.6" stroke-dasharray="5 3" opacity=".8"/>`);
  for (const f of feederPts) o.push(`<path d="${pl(f)}" fill="none" stroke="${C.water}" stroke-width="1.2"/>`);
  o.push(`<path d="${pl(riverPts)}" fill="none" stroke="#2f7fc4" stroke-width="2.8" stroke-linecap="round"/>`);
  o.push(`<path d="${crPath(lakePts, true, M)}" fill="none" stroke="#2a6ea8" stroke-width="1.1"/>`);
  o.push(`<path d="M${r(X(FALLS[0]) - 6)},${r(Y(FALLS[1]) - 4)}l12,8" stroke="#fff" stroke-width="4"/><path d="M${r(X(FALLS[0]) - 6)},${r(Y(FALLS[1]) - 4)}l12,8" stroke="${C.ink}" stroke-width="1"/>`);
  o.push(`<path d="${crPath(meadowPts, true, M)}" fill="none" stroke="#8f9650" stroke-width="1" stroke-dasharray="3 2"/>`);

  // 林中营房
  for (const [cx, cy] of CAMPS) { const g = rng(Math.round(cx * 100 + cy * 37 + 500)); for (let q = 0; q < 6; q++) { const dx = (g() - 0.5) * 0.2, dy = (g() - 0.5) * 0.14, a = Math.round(g() * 80 - 40); o.push(`<rect x="${r(X(cx + dx) - 3.5)}" y="${r(Y(cy + dy) - 2)}" width="7" height="4" rx="1" transform="rotate(${a} ${r(X(cx + dx))} ${r(Y(cy + dy))})" fill="#2f4a37" stroke="#d8e6c8" stroke-width=".7"/>`); } }

  // 地下设施投影
  o.push(`<g clip-path="url(#isle)"><path d="${crPath(HULL_PLAN, true, M)}" fill="${C.hull}" fill-opacity=".07" stroke="${C.hull}" stroke-width="1.6" stroke-dasharray="9 4"/></g>`);
  o.push(`<path d="${crPath(HANGAR_PLAN, true, M)}" fill="${C.under}" fill-opacity=".07" stroke="${C.under}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  for (const t of TUNNELS) {
    const out = [t.exit[0] + t.dir[0] * 0.42, t.exit[1] + t.dir[1] * 0.42];
    o.push(`<path d="M${M(t.from)}L${M(t.exit)}" stroke="${C.under}" stroke-width="2.2" stroke-dasharray="7 4"/><path d="M${M(t.exit)}L${M(out)}" stroke="${C.under}" stroke-width="1.6" marker-end="url(#arr)"/><circle cx="${r(X(t.from[0]))}" cy="${r(Y(t.from[1]))}" r="2.6" fill="${C.under}"/>`);
  }
  for (const p of SILOS) o.push(`<circle cx="${r(X(p[0]))}" cy="${r(Y(p[1]))}" r="4.6" fill="${C.under}" fill-opacity=".18" stroke="${C.under}" stroke-width="1.4" stroke-dasharray="2.5 2"/>`);
  const gateTunnel = (pts) => `<path d="${pl(pts)}" fill="none" stroke="#15507f" stroke-width="3.6" opacity=".6" stroke-dasharray="6 3" stroke-linejoin="round"/>`;
  const mainGatePos = [villaCoast[0], villaCoast[1] - 0.11];
  o.push(gateTunnel([mainGatePos, [villaCoast[0] + 0.02, villaCoast[1] + 0.31]]) + gateTunnel(spline(WEST_GATE.path, false, 8)));

  // 海岸线:岩岸、沙滩、悬崖
  const runs = kind => { const out = []; let cur = null; coast.forEach((s, i) => { if (s.kind === kind) { if (!cur) { cur = [coast[(i - 1 + coast.length) % coast.length].p]; out.push(cur); } cur.push(s.p); } else if (cur) { cur.push(s.p); cur = null; } }); return out; };
  o.push(`<path d="${pl(coastPts, true)}" fill="none" stroke="#2f4a37" stroke-width="1.1"/>`);
  for (const run of runs('b')) o.push(`<path d="${pl(run)}" fill="none" stroke="${C.sand}" stroke-width="7" stroke-linecap="round"/>`);
  let ticks = '';
  coast.forEach((s, i) => {
    if (s.kind !== 'c' || i % 2) return;
    const a = coast[(i - 1 + coast.length) % coast.length].p, b = coast[(i + 1) % coast.length].p;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if (onLand(s.p[0] + nx * 0.02, s.p[1] + ny * 0.02)) { nx = -nx; ny = -ny; }
    const len = (2.5 + 7 * s.hc / 210) / S;
    ticks += `M${M(s.p)}L${M([s.p[0] + nx * len, s.p[1] + ny * len])}`;
  });
  for (const run of runs('k')) o.push(`<path d="${pl(run)}" fill="none" stroke="#6f655a" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="1.5 4"/><path d="${pl(run)}" fill="none" stroke="#d6cdbd" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 5.5"/>`);
  for (const run of runs('c')) o.push(`<path d="${pl(run)}" fill="none" stroke="${C.rock}" stroke-width="2.6" stroke-linejoin="round"/>`);
  o.push(`<path d="${ticks}" stroke="${C.rock}" stroke-width="1" fill="none"/>`);

  // 东屿、海蚀柱、崖宅、闸门
  o.push(`<path d="${crPath(blob({ ...ISLET, rx: ISLET.rx * 1.5, ry: ISLET.ry * 1.6 }, 31, 16, 1.3), true, M)}" fill="#bfece2" opacity=".55"/><path d="${crPath(blob(ISLET, 33, 18, 1.5), true, M)}" fill="#6f9f72" stroke="${C.rock}" stroke-width="1.8"/>`);
  for (const [x, y, rad] of STACKS) o.push(`<path d="${crPath(blob({ x, y, rx: rad * 1.6, ry: rad * 1.3 }, Math.round(x * 100 + 77), 10, 1.4), true, M)}" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/><path d="${crPath(blob({ x, y, rx: rad, ry: rad * 0.8 }, Math.round(x * 100 + 7), 10, 1.4), true, M)}" fill="#4b3f36"/>`);
  o.push(`<g transform="translate(${r(X(villaCoast[0]))},${r(Y(villaCoast[1]))})"><path d="M-13,-3L-6,-9L12,-5L8,1L-3,-1L-9,2Z" fill="#6a757e" stroke="${C.ink}" stroke-width=".8"/><path d="M-6,-7L7,-4L4,0L-4,-2Z" fill="#e6a145" stroke="${C.ink}" stroke-width=".6"/></g>`);
  for (const p of [mainGatePos, WEST_GATE.pos]) o.push(`<rect x="${r(X(p[0]) - 4.5)}" y="${r(Y(p[1]) - 3)}" width="9" height="6" rx="1" fill="#0d2233" stroke="#7fd4ff" stroke-width="1.2"/>`);

  // 出击口
  for (const [x, y] of SALLY) o.push(`<path d="M${r(X(x))},${r(Y(y) - 5)}l5,9h-10z" fill="${C.under}" stroke="#fff" stroke-width=".8"/>`);

  // 幻域浮标
  for (const [x, y] of gens) o.push(`<g transform="translate(${r(X(x))},${r(Y(y))})"><circle r="8" fill="${C.field}" opacity=".18"/><path d="M0,-5.5L5,0L0,5.5L-5,0Z" fill="#2a2140" stroke="#cdb7ff" stroke-width="1.3"/></g>`);

  // 剖面线、立面视向
  for (const [a, b] of [[-2.56, -2.16], [1.55, 1.95]]) o.push(`<line x1="${r(X(SECTION_X))}" y1="${r(Y(a))}" x2="${r(X(SECTION_X))}" y2="${r(Y(b))}" stroke="${C.ink}" stroke-width="1.8" stroke-dasharray="12 4 2 4"/>`);
  o.push(txt(X(SECTION_X), Y(-2.68) + 5, 'B', 't b halo mid') + txt(X(SECTION_X), Y(2.02), 'B′', 't b halo mid'));
  o.push(`<line x1="${r(X(1.55))}" y1="${r(Y(-2.45))}" x2="${r(X(1.55))}" y2="${r(Y(-2.08))}" stroke="${C.ink}" stroke-width="1.6" marker-end="url(#arrk)"/>` + txt(X(1.65), Y(-2.3), '立面图视向(自南向北)', 's halo'));

  // 文字
  const L = (x, y, s, cls = 't halo mid') => o.push(txt(X(x), Y(y), s, cls));
  L(villaCoast[0] - 0.3, villaCoast[1] - 0.16, `主崖岬 ▲${Math.round(peak.h)} m`, 't b halo end');
  L(villaCoast[0] - 0.2, villaCoast[1] + 0.05, '崖宅', 's b halo end');
  L(villaCoast[0] - 0.3, villaCoast[1] - 0.3, '主闸门(水下 80 m)', 'xs halo end');
  L(HEADLANDS[1][1] - 0.02, HEADLANDS[1][2] - 0.36, '西崖角', 't b halo mid');
  L(HEADLANDS[2][1] + 0.2, HEADLANDS[2][2] - 0.32, '东南崖角', 't b halo mid');
  L(WEST_GATE.pos[0] - 0.12, WEST_GATE.pos[1] - 0.16, `西闸门(水下 ${WEST_GATE.depth} m)`, 'xs halo end');
  L(MEADOW.x, MEADOW.y + 0.24, `风草甸 ${meadowLevel} m`, 't b halo mid');
  L(MEADOW.x, MEADOW.y - 0.19, '机库洞厅·发射井', 'xs halo mid');
  L(LAKE.x - 0.05, LAKE.y + 0.27, `镜湖 ${lakeLevel} m`, 't b halo mid');
  L(FALLS[0] - 0.1, FALLS[1] + 0.06, '帘瀑', 's b halo end');
  L(0.42, 0.3, '白水河', 's halo');
  L(0.3, 0.78, '月 湾', 't b halo mid');
  L(-0.78, 1.9, '西岬', 's b halo');
  L(1.55, 1.06, '东岬', 's b halo mid');
  L(ISLET.x, ISLET.y - 0.24, '东屿', 's b halo mid');
  for (const [hx, hy, , , name] of HILLS) if (name) L(hx, hy + 0.03, `${name} ▲${Math.round(H(hx, hy))}`, 's b halo mid');
  L(-1.62, 0.12, '西沟', 's halo end');
  L(1.3, -0.02, '东沟', 's halo');
  L(0.36, -1.0, '裂湾', 's b halo');
  L(-0.95, -1.08, '西裂谷', 's b halo mid');
  L(1.78, -0.58, '礁石滩', 's b halo');
  L(1.0, -0.5, '东峡谷', 's b halo end');
  L(-2.56, -0.3, '礁石滩', 's b halo end');
  L(CAMPS[2][0] + 0.06, CAMPS[2][1] + 0.13, '林中营房', 's b halo mid');
  L(CAMPS[1][0], CAMPS[1][1] + 0.13, '林中营房', 's b halo mid');
  L(-2.02, 1.02, '小滩', 's halo end');
  L(-0.25, 1.12, '潟湖(浅水 3–15 m)', 's halo mid');
  L(channel[0] + 0.12, channel[1] + 0.05, '北水道', 's b halo');
  L(-2.25, 1.95, '礁盘与珊瑚丛(错落分布)', 's b halo mid');
  TUNNELS.forEach((t, i) => { const e2 = [t.exit[0] + t.dir[0] * 0.3, t.exit[1] + t.dir[1] * 0.3]; if (i === 2) L(e2[0] + 0.08, e2[1] - 0.1, t.name, 's b halo'); else L(e2[0] + (i ? 0.08 : -0.08), e2[1] + 0.12, t.name, i ? 's b halo' : 's b halo end'); });
  L(0.05, -0.36, '基核范围(地下)', 'xs halo mid');
  const gl = gens.reduce((b, p) => (p[0] + p[1] > b[0] + b[1] ? p : b));
  L(gl[0] - 0.12, gl[1] + 0.02, '幻域浮标(位置不固定)', 's b halo end');
  L(-3.7, -2.42, '幻域中环(视觉隐形 · 脑波干扰),边界随发生器移动', 's dhalo');
  L(STACKS[3][0] - 0.08, STACKS[3][1] - 0.12, '海蚀柱', 'xs halo end');
  o.push(`</g><rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" fill="none" stroke="${C.ink}" stroke-width="1"/>`);

  // 图名、指北针、比例尺
  o.push(txt(14, 30, '图一 岛屿平面图', 'title') + txt(14, 49, '晕渲地形,等高线间隔 25 米 · 坐标原点在岛屿中部,x 向东,y 向北', 'sub'));
  o.push(`<g transform="translate(${FX + FW - 36},${FY + 54})"><circle r="26" fill="#fff" opacity=".75"/><path d="M0,-22L7,10L0,5L-7,10z" fill="${C.ink}"/><text x="0" y="22" class="xs b mid">北</text></g>`);
  o.push(`<g transform="translate(${FX + 22},${FY + FH - 22})"><rect x="-8" y="-20" width="${2 * S + 60}" height="34" fill="#fff" opacity=".75" rx="4"/><rect width="${S}" height="6" fill="${C.ink}"/><rect x="${S}" width="${S}" height="6" fill="#fff" stroke="${C.ink}" stroke-width="1"/>
    <text x="0" y="-5" class="xs">0</text><text x="${S}" y="-5" class="xs mid">1</text><text x="${2 * S}" y="-5" class="xs mid">2 公里</text></g>`);

  // 图例
  const items = [
    [`<path d="M0,5h26" stroke="${C.rock}" stroke-width="2.6"/><path d="M3,5v7M9,5v7M15,5v7M21,5v7" stroke="${C.rock}" stroke-width="1"/>`, '悬崖(齿越长越高)'],
    [`<path d="M0,8h26" stroke="${C.sand}" stroke-width="7" stroke-linecap="round"/>`, '沙滩'],
    [`<path d="M0,11q13,-11 26,0" fill="none" stroke="${C.contour}" stroke-width="1.1"/>`, '等高线'],
    [`<path d="M0,8h26" stroke="#2f7fc4" stroke-width="2.8"/>`, '河流与湖泊'],
    [`<path d="M0,8h26" stroke="#1f3f2a" stroke-width="1.6" stroke-dasharray="5 3"/>`, '冲沟 / 峡谷'],
    [`<ellipse cx="13" cy="8" rx="12" ry="6" fill="${C.reef}" stroke="#9fd8d0" stroke-width="2"/>`, '礁盘 / 珊瑚丛'],
    [`<path d="M13,2L19,8L13,14L7,8Z" fill="#2a2140" stroke="${C.field}" stroke-width="1.3"/>`, '幻域浮标'],
    [`<path d="M0,8h26" stroke="${C.hull}" stroke-width="1.6" stroke-dasharray="9 4"/>`, '基核范围(地下)'],
    [`<path d="M0,8h20" stroke="${C.under}" stroke-width="2.2" stroke-dasharray="7 4"/><path d="M19,4l7,4l-7,4z" fill="${C.under}"/>`, '弹射隧道与发射方向'],
    [`<circle cx="13" cy="8" r="4.6" fill="${C.under}" fill-opacity=".18" stroke="${C.under}" stroke-width="1.4" stroke-dasharray="2.5 2"/>`, '机库顶部发射井'],
    [`<rect x="8" y="5" width="9" height="6" rx="1" fill="#0d2233" stroke="#3f8fb5" stroke-width="1.2"/><path d="M17,8h9" stroke="#15507f" stroke-width="3.6" opacity=".6" stroke-dasharray="6 3"/>`, '潜艇闸门与水下隧道'],
    [`<rect x="6" y="4" width="7" height="4" rx="1" fill="#2f4a37"/><rect x="14" y="8" width="7" height="4" rx="1" fill="#2f4a37"/>`, '林中营房 ▲出击口'],
    [`<path d="M0,8h26" stroke="#6f655a" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="1.5 4"/><path d="M0,8h26" stroke="#d6cdbd" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 5.5"/>`, '礁石滩'],
  ];
  items.forEach(([sym, name], i) => o.push(`<g transform="translate(${16 + (i % 6) * 158},${FY + FH + 26 + Math.floor(i / 6) * 34})">${sym}<text x="34" y="12" class="s">${name}</text></g>`));
  o.push('</svg>');
  return o.join('\n');
}

// ═════════ 图二:南立面全景 + 崖宅细部 ═════════
const southProfile = range(-2650, 2500, 10).map(xm => {
  const x = xm / 1000;
  let best = null;
  for (const s of cliffS) if (Math.abs(s.p[0] - x) < 0.016 && (!best || s.p[1] < best.p[1])) best = s;
  let sky = 0, front = null;
  for (let y = -1.75; y <= 1.9; y += 0.0125) if (onLand(x, y)) { if (front === null) front = y; sky = Math.max(sky, H(x, y)); }
  const face = best ? (best.kind === 'k' ? H(x, best.p[1] + 0.025) : Math.max(best.hc * 0.92, H(x, best.p[1] + 0.03))) : 0;
  return { xm, yc: best ? best.p[1] : front, face, sky };
});

function elevSVG() {
  const W = 960, Ht = 800, o = [svgOpen(W, Ht)];
  const kx = 0.178, kz = 0.534, x0 = 34, T = 66, z0 = T + 250 * kz, bot = z0 + 110 * kz, FWp = 5150 * kx;
  const EX = xm => x0 + (xm + 2650) * kx, EZ = z => z0 - z * kz;
  const vx = VILLA_X * 1000, n = southProfile.length;
  o.push(`<defs>${GRADS}
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".42"/></linearGradient>
    <clipPath id="pano"><rect x="${x0}" y="${T}" width="${r(FWp)}" height="${r(bot - T)}"/></clipPath>
    <clipPath id="det"><rect x="45" y="336" width="870" height="384"/></clipPath>
  </defs>`);
  o.push(`<rect width="${W}" height="${Ht}" fill="#fff"/>`);
  o.push(txt(14, 30, '图二 南立面图', 'title') + txt(14, 49, '自南面海上向北看 · 上图为全岛南岸(垂直放大 3 倍,颜色越浅越远),下图为崖宅正面细部(真实比例)', 'sub'));

  // ── 全景:远景山丘 → 中景裂谷与凹湾 → 海雾 → 前景岬角 ──
  o.push(`<g clip-path="url(#pano)"><rect x="${x0}" y="${T}" width="${r(FWp)}" height="${r(bot - T)}" fill="url(#sky)"/>`);
  const pp = (f, add = 0) => southProfile.map(p => `${r(EX(p.xm))},${r(EZ(f(p) + add))}`).join('L');
  o.push(`<path d="M${r(EX(-2650))},${z0}L${pp(p => p.sky, 10)}L${r(EX(2500))},${z0}Z" fill="#c4d3da"/>`);
  o.push(`<path d="M${r(EX(-2650))},${z0}L${pp(p => p.sky * 0.86, 0)}L${r(EX(2500))},${z0}Z" fill="#aebfc4"/>`);
  const ycMin = Math.min(...southProfile.filter(p => p.face > 0).map(p => p.yc));
  const cols = southProfile.map((p, i) => {
    const a = southProfile[Math.max(0, i - 4)], b = southProfile[Math.min(n - 1, i + 4)], sl = ((b.yc ?? 0) - (a.yc ?? 0)) / ((b.xm - a.xm) / 1000);
    const rec = (p.yc ?? 0) - ycMin, lit = (-0.75 * sl + 0.66) / Math.hypot(sl, 1);
    return { ...p, rec, f: Math.pow(clamp(rec / 0.9), 0.75), lit: clamp(0.5 + 0.5 * lit, 0.15, 1), i };
  }).filter(p => p.face > 3);
  const cw = 10 * kx + 0.7;
  const drawCol = p => {
    const g = hash(p.i, 3), base = mix([58, 48, 41], [126, 108, 90], p.lit), c = mix(base, [196, 208, 214], p.f * 0.6), cx = EX(p.xm) - 0.3, top = EZ(p.face);
    let s = `<rect x="${r(cx)}" y="${r(top)}" width="${r(cw)}" height="${r(z0 - top + 2)}" fill="${rgb(c)}"/>`;
    s += `<rect x="${r(cx)}" y="${r(EZ(p.face + 5 + 3 * g))}" width="${r(cw)}" height="${r((7 + 3 * g) * kz)}" fill="${rgb(mix([52, 104, 64], [190, 208, 204], p.f * 0.55))}"/>`;
    if (p.f < 0.85) {
      const al = (1 - p.f) * 0.5;
      if (p.i % 2 === 0) s += `<line x1="${r(cx + 0.9)}" y1="${r(EZ(p.face * (0.97 - 0.06 * g)))}" x2="${r(cx + 0.9)}" y2="${r(EZ(p.face * (0.6 + 0.08 * g)))}" stroke="#000" stroke-opacity="${r(al * 0.55 * 10) / 10}" stroke-width=".7"/>`;
      s += `<rect x="${r(cx)}" y="${r(EZ(p.face * 0.72))}" width="${r(cw)}" height="1.6" fill="#000" opacity="${r(al * 0.9 * 10) / 10}"/>`;
      for (const q of [0.13, 0.3, 0.47, 0.6]) if (hash(p.i, q * 100) > 0.22) s += `<rect x="${r(cx)}" y="${r(EZ(p.face * q) - 1.5)}" width="${r(cw)}" height="1.6" fill="${rgb(mix([74, 128, 78], [190, 208, 204], p.f))}"/><rect x="${r(cx)}" y="${r(EZ(p.face * q))}" width="${r(cw)}" height="1" fill="#000" opacity="${r(al * 0.7 * 10) / 10}"/>`;
    }
    if (p.face > 20) s += `<circle cx="${r(cx + 1 + g)}" cy="${r(z0 - 1 - 3 * g)}" r="${r(1.6 + 2.2 * hash(p.i, 9))}" fill="${rgb(mix([40, 34, 30], [196, 208, 214], p.f * 0.85))}"/>`;
    return s;
  };
  const far = cols.filter(p => p.f >= 0.3).sort((a, b) => b.rec - a.rec), near = cols.filter(p => p.f < 0.3).sort((a, b) => b.rec - a.rec);
  o.push(far.map(drawCol).join(''));
  o.push(`<rect x="${x0}" y="${r(EZ(70))}" width="${r(FWp)}" height="${r(70 * kz)}" fill="url(#mist)"/>`);
  o.push(near.map(drawCol).join(''));
  // 崖宅(缩略)
  o.push(`<g transform="translate(${r(EX(vx))},${r(EZ(152))})"><path d="M-15,-9L-5,-13L16,-2L11,4L2,8L-8,6L-12,-1Z" fill="#2a3138" stroke="#14181c" stroke-width=".6"/><path d="M-11,-7L10,0L4,4L-7,1Z" fill="#f0a84b"/><path d="M-15,-9L-4,-12L16,-2L13,0L-6,-7Z" fill="#85919a" stroke="#1f252b" stroke-width=".6"/><path d="M-4,5L8,5L6,9L-2,9Z" fill="#ffb347" stroke="#1f252b" stroke-width=".5"/></g>`);
  // 发射口(在裂谷湾顶,属中景)
  for (const t of TUNNELS) { const ex = t.exit[0] * 1000; o.push(`<rect x="${r(EX(ex - 15))}" y="${r(EZ(t.z + 7.5))}" width="${r(30 * kx)}" height="${r(15 * kz)}" rx="1.5" fill="#1b1410" stroke="#ff9d3b" stroke-width="1.3"/>`); }
  // 海面
  o.push(`<rect x="${x0}" y="${r(z0)}" width="${r(FWp)}" height="${r(bot - z0)}" fill="#2b6a9c" opacity=".62"/>`);
  o.push(`<path d="M${range(-2650, 2500, 22).map((xm, i) => `${r(EX(xm))},${r(z0 + (i % 2 ? -1.2 : 1))}`).join('L')}" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/>`);
  for (const [gx, dep] of [[vx, 80], [WEST_GATE.pos[0] * 1000, WEST_GATE.depth]]) o.push(`<rect x="${r(EX(gx - 20))}" y="${r(EZ(-dep + 10))}" width="${r(40 * kx)}" height="${r(20 * kz)}" rx="1.5" fill="#0d2233" stroke="#7fd4ff" stroke-width="1.3"/>`);
  // 前景:海蚀孤峰与浮动发生器
  for (const [sx, , rad] of STACKS) { const ex = EX(sx * 1000), hgt = 16 + rad * 1300; o.push(`<path d="M${r(ex - 5)},${r(z0 + 1)}L${r(ex - 3.4)},${r(EZ(hgt * 0.55))}L${r(ex - 1.6)},${r(EZ(hgt * 0.92))}L${r(ex + 0.4)},${r(EZ(hgt))}L${r(ex + 2.2)},${r(EZ(hgt * 0.7))}L${r(ex + 3.6)},${r(EZ(hgt * 0.74))}L${r(ex + 5.2)},${r(z0 + 1)}Z" fill="#241d19"/><path d="M${r(ex - 1.6)},${r(EZ(hgt * 0.9))}V${r(z0)}M${r(ex + 1.6)},${r(EZ(hgt * 0.7))}V${r(z0)}" stroke="#000" stroke-opacity=".5" stroke-width=".6"/><ellipse cx="${r(ex)}" cy="${r(z0 + 1.5)}" rx="8" ry="1.8" fill="#fff" opacity=".85"/>`); }
  const fg = gens.filter(g => g[1] < -1.3 && Math.abs(g[0]) < 2.4);
  for (const g of fg) { const ex = EX(g[0] * 1000); o.push(`<g transform="translate(${r(ex)},${r(z0)})"><path d="M-7,0Q0,-9 7,0Z" fill="#3a3148" stroke="#cdb7ff" stroke-width="1"/><path d="M-6,0Q-5,18 0,26Q5,18 6,0Z" fill="#cdb7ff" opacity=".35"/><ellipse rx="12" ry="2.2" fill="none" stroke="#cdb7ff" stroke-width=".9" opacity=".9"/></g>`); }
  o.push(`</g>`);
  for (const z of [-100, 0, 100, 200]) o.push(`<line x1="${x0 - 5}" y1="${r(EZ(z))}" x2="${x0}" y2="${r(EZ(z))}" stroke="${C.ink}"/>` + txt(x0 - 7, EZ(z) + 3.5, z, 'xs end'));
  o.push(`<rect x="${x0}" y="${T}" width="${r(FWp)}" height="${r(bot - T)}" fill="none" stroke="${C.ink}"/>`);
  // 全景标注
  const lead = (x1, y1, x2, y2, col = C.ink) => o.push(`<path d="M${r(x1)},${r(y1)}L${r(x2)},${r(y2)}" stroke="${col}" stroke-width=".8" fill="none"/>`);
  const faceOf = xm => southProfile[clamp(Math.round((xm + 2650) / 10), 0, n - 1)].face;
  for (const [name, hx, , h] of HEADLANDS) { const xm = hx * 1000, f = Math.max(faceOf(xm), faceOf(xm - 60), faceOf(xm + 60)); o.push(txt(EX(xm), EZ(f + 24), `${name} ${h} m`, 't b halo mid')); }
  o.push(txt(EX(-950), EZ(118), '西裂谷', 's halo mid') + txt(EX(260), EZ(132), '裂湾', 's halo mid') + txt(EX(1260), EZ(66), '东峡谷', 's b halo mid') + txt(EX(1660), EZ(34), '礁石滩', 's halo mid'));
  lead(EX(vx + 80), EZ(160), EX(vx + 280), EZ(222));
  o.push(txt(EX(vx + 286), EZ(222) + 3, '崖宅(见下图)', 's b halo'));
  for (const t of TUNNELS) { const ex = EX(t.exit[0] * 1000); o.push(txt(ex, EZ(t.z - 26), `${t.name} +${t.z} m`, 'xs dhalo mid')); }
  o.push(txt(EX(vx + 40), EZ(-84), '主闸门(水下 80 m)', 's dhalo') + txt(EX(WEST_GATE.pos[0] * 1000 + 40), EZ(-WEST_GATE.depth - 4), `西闸门(水下 ${WEST_GATE.depth} m)`, 's dhalo'));
  if (fg[0]) o.push(txt(EX(fg[0][0] * 1000) + 16, z0 + 24, '幻域浮标(前景)', 's dhalo'));
  o.push(txt(EX(1700), EZ(H(HILLS[2][0], HILLS[2][1]) + 30), '内陆山丘(远景,没入海雾)', 'xs halo mid'));
  o.push(txt(EX(2480), z0 - 5, '海平面', 'xs dhalo end') + txt(EX(-2620), T + 14, '西', 't b halo') + txt(EX(2470), T + 14, '东', 't b halo end'));
  o.push(`<g transform="translate(${x0},${r(bot + 14)})"><rect width="${1000 * kx}" height="5" fill="${C.ink}"/><text x="${1000 * kx + 8}" y="6" class="xs">1 公里(水平)</text></g>`);

  // ── 崖宅正面细部(真实比例) ──
  const ks = 3, DX = x => 480 + (x - 5) * ks, DZ = z => 720 - (z - 88) * ks, q = (x, z) => `${r(DX(x))},${r(DZ(z))}`;
  const poly = (pts, attrs) => `<path d="M${pts.map(p => q(p[0], p[1])).join('L')}Z" ${attrs}/>`;
  o.push(txt(45, 326, '崖宅正面细部(真实比例):斜切折板壳体悬挑于半山腰岩鼻,内嵌多层暖光主厅与重工实验舱', 't b'));
  o.push(`<g clip-path="url(#det)"><rect x="45" y="336" width="870" height="384" fill="url(#sky)"/>`);
  // 岩壁:圆润崖顶 → 柱状节理绝壁与岩鼻 → 碎石缓台 → 下一级陡坎
  const topZ = x => 205 + 3 * Math.sin(x * 0.021 + 1) + 1.5 * Math.sin(x * 0.07);
  for (let x = -148, i = 0; x <= 158; x += 5, i++) o.push(`<circle cx="${r(DX(x + (i % 3) - 1))}" cy="${r(DZ(topZ(x) + 2 + ((i * 7) % 5)))}" r="${r((4.5 + ((i * 5) % 5)) * ks)}" fill="${i % 4 ? C.landDark : '#5f9a66'}"/>`);
  o.push(`<path id="dface" d="M${range(-146, 156, 4).map(x => q(x, topZ(x))).join('L')}L${q(156, 80)}L${q(-146, 80)}Z" fill="url(#rockg)"/>`);
  o.push(`<clipPath id="dr"><use href="#dface" xlink:href="#dface"/></clipPath><g clip-path="url(#dr)">`);
  // 岩鼻:受光的外凸带,下缘有悬挑阴影
  o.push(`<path d="M${q(-146, 176)}C${q(-80, 181)} ${q(60, 179)} ${q(156, 174)}L${q(156, 147)}C${q(70, 141)} ${q(-70, 143)} ${q(-146, 148)}Z" fill="#a8947e" opacity=".55"/>`);
  o.push(`<path d="M${q(-146, 148)}C${q(-70, 143)} ${q(70, 141)} ${q(156, 147)}L${q(156, 136)}C${q(70, 132)} ${q(-70, 134)} ${q(-146, 139)}Z" fill="#000" opacity=".38"/>`);
  for (let i = 0; i < 150; i++) { const x = -146 + ((i * 61) % 302) + hash(i, 1) * 2, zt = 198 - hash(i, 2) * 14, zb = 150 + hash(i, 3) * 12; o.push(`<line x1="${r(DX(x))}" y1="${r(DZ(zt))}" x2="${r(DX(x + (hash(i, 4) - 0.5) * 1.5))}" y2="${r(DZ(zb))}" stroke="${i % 5 ? '#000' : '#fff'}" stroke-opacity="${i % 5 ? 0.2 : 0.1}" stroke-width="1"/>`); }
  for (let i = 0; i < 90; i++) { const x = -146 + ((i * 47) % 302), zt = 122 - hash(i, 5) * 3, zb = 101 + hash(i, 6) * 5; o.push(`<line x1="${r(DX(x))}" y1="${r(DZ(zt))}" x2="${r(DX(x + (hash(i, 7) - 0.5) * 1.2))}" y2="${r(DZ(zb))}" stroke="#000" stroke-opacity=".22" stroke-width="1"/>`); }
  // 碎石缓台(海拔约 122–130 米与 96–100 米),长着矮灌木
  for (const [za, zb2] of [[130, 122], [100, 93]]) o.push(`<path d="M${range(-146, 156, 6).map(x => q(x, za + 1.5 * Math.sin(x * 0.09))).join('L')}L${q(156, zb2)}L${q(-146, zb2)}Z" fill="#7d7361" opacity=".9"/>`);
  for (let i = 0; i < 70; i++) { const x = -146 + ((i * 37) % 302), za = i % 2 ? 130 : 100; if (za === 130 && x > -44 && x < 96) continue; o.push(`<circle cx="${r(DX(x))}" cy="${r(DZ(za + 1 + hash(i, 8) * 2))}" r="${r((0.8 + hash(i, 9) * 1.1) * ks)}" fill="${i % 3 ? '#4f7d4f' : '#6a9460'}"/>`); }
  o.push(`</g>`);

  // 崖宅:冷灰钛岩斜切折板壳体 + 内凹多层暖光幕墙 + 重工实验舱,悬挑在半山腰(+116 ~ +176 m),底部收束锚入崖壁
  const atrPts = [[-56, 169], [68, 145], [52, 138], [-36, 145]];
  const labPts = [[-20, 137], [54, 132], [46, 120], [-12, 120]];
  // 1) 悬挑壳体在崖壁上的投射阴影(凸显半山腰悬空体量)
  o.push(poly([[-72, 174], [-30, 118], [52, 111], [98, 134], [88, 140], [-12, 122]], 'fill="#000" opacity=".42"'));

  // 2) 中央内凹斜切主厅(+138 ~ +168 m):三层流线型暖光挑台与深色幕墙肋框
  o.push(`<clipPath id="atrClip"><path d="M${atrPts.map(p => q(p[0], p[1])).join('L')}Z"/></clipPath>`);
  o.push(poly(atrPts, 'fill="url(#atriumGlow)" stroke="#0e1216" stroke-width="1.2"'));
  o.push(`<g clip-path="url(#atrClip)">`);
  // 室内三层流线型错层挑台(参照参考图多层暖光错层轮廓)
  for (const [zf, xL, xR, curve] of [[160, -56, 10, 2.2], [153, -48, 42, 1.8], [146, -40, 62, 1.4]]) {
    o.push(`<path d="M${q(xL, zf + 2.4)}Q${q((xL + xR) / 2, zf + 2.4 - curve)} ${q(xR, zf + 2.4)}L${q(xR, zf - 1)}L${q(xL, zf - 1)}Z" fill="#ffd992" opacity=".32"/>`);
    o.push(`<path d="M${q(xL, zf)}Q${q((xL + xR) / 2, zf - curve)} ${q(xR, zf)}L${q(xR, zf - 1.2)}Q${q((xL + xR) / 2, zf - 1.2 - curve)} ${q(xL, zf - 1.2)}Z" fill="#2a2420" stroke="#ffe7b0" stroke-width=".9"/>`);
  }
  // 玻璃深部弧形光晕与斜向反光带
  o.push(`<ellipse cx="${r(DX(-8))}" cy="${r(DZ(155))}" rx="${24 * ks}" ry="${8 * ks}" fill="#ffe9b5" opacity=".28"/>`);
  o.push(poly([[-44, 169], [-20, 165], [-10, 140], [-32, 143]], 'fill="#9ec7dc" opacity=".14"'));
  o.push(poly([[12, 159], [28, 155], [34, 139], [18, 140]], 'fill="#ffffff" opacity=".10"'));
  // 深色斜向+竖向结构肋框(Mullion Grid)
  for (let x = -54; x <= 68; x += 6) o.push(`<line x1="${r(DX(x))}" y1="${r(DZ(170))}" x2="${r(DX(x + 6))}" y2="${r(DZ(137))}" stroke="#12171c" stroke-width=".95" opacity=".82"/>`);
  for (const z of [163.5, 158, 152, 146.5, 141.5]) o.push(`<line x1="${r(DX(-58))}" y1="${r(DZ(z))}" x2="${r(DX(70))}" y2="${r(DZ(z - 4))}" stroke="#12171c" stroke-width=".85" opacity=".72"/>`);
  o.push(`</g>`);
  o.push(poly(atrPts, 'fill="none" stroke="#10151a" stroke-width="1.3"'));

  // 3) 下层内嵌重工实验舱(+120 ~ +137 m)
  o.push(`<clipPath id="labClip"><path d="M${labPts.map(p => q(p[0], p[1])).join('L')}Z"/></clipPath>`);
  o.push(poly(labPts, 'fill="url(#labglow)" stroke="#0d1115" stroke-width="1.3"'));
  o.push(`<g clip-path="url(#labClip)">`);
  o.push(`<path d="M${q(-18, 130.5)}H${r(DX(54))}" stroke="#14181c" stroke-width="3"/><path d="M${q(4, 130.5)}V${r(DZ(125.5))}M${q(36, 130.5)}V${r(DZ(124))}" stroke="#14181c" stroke-width="1.5"/>`);
  for (const x of [-16, 44]) o.push(`<rect x="${r(DX(x))}" y="${r(DZ(136))}" width="${r(6 * ks)}" height="${r(16 * ks)}" fill="#262c33" stroke="#0c1014" stroke-width=".8"/>`);
  o.push(`<circle cx="${r(DX(22))}" cy="${r(DZ(125.5))}" r="${3.6 * ks}" fill="url(#core)"/><circle cx="${r(DX(22))}" cy="${r(DZ(125.5))}" r="${1.3 * ks}" fill="#fff"/>`);
  o.push(`<path d="M${q(10, 120.2)}l${r(3 * ks)},${r(-2.2 * ks)}l${r(5.5 * ks)},${r(-1 * ks)}l${r(5.5 * ks)},${r(1 * ks)}l${r(3 * ks)},${r(2.2 * ks)}z" fill="#1e252c" stroke="#7fd4ff" stroke-width=".8"/>`);
  o.push(`</g>`);
  o.push(poly(labPts, 'fill="none" stroke="#10151a" stroke-width="1.3"'));

  // 4) 外层斜切折板装甲壳体(上掠刃翼 + 西翼护板 + 中脊斜梁 + 下层半山腰收束龙骨)
  // 下层收束龙骨(锚入 +116 m 半山腰崖壁,下方 +88 ~ +116 m 保留自然陡坎与碎石缓台)
  o.push(poly([[-26, 122], [-12, 120], [46, 120], [68, 133], [82, 135], [52, 118], [-14, 116]], 'fill="url(#bladeSide)" stroke="#14181c" stroke-width="1.1"'));
  o.push(poly([[46, 120], [68, 133], [82, 135], [52, 118]], 'fill="#5c6872" stroke="#14181c" stroke-width=".9"'));
  // 中脊斜梁(将上层主厅与下层实验舱清晰分开)
  o.push(poly([[-28, 141.5], [68, 134], [82, 135], [54, 132], [-20, 137]], 'fill="#2c333a" stroke="#14181c" stroke-width="1"'));
  o.push(poly([[-46, 152], [-36, 145], [52, 138], [82, 135], [68, 134], [-28, 141.5]], 'fill="#7c8892" stroke="#181e24" stroke-width="1.1"'));
  o.push(`<path d="M${q(-46, 152)}L${q(-36, 145)}L${q(52, 138)}L${q(82, 135)}" fill="none" stroke="#c8d3db" stroke-width="1.1"/>`);
  // 西侧斜切护翼(自高处尖端收束至半山腰)
  o.push(poly([[-56, 169], [-36, 145], [-12, 120], [-18, 121], [-45, 149]], 'fill="url(#bladeSide)" stroke="#14181c" stroke-width="1"'));
  o.push(poly([[-74, 176], [-68, 168], [-52, 148], [-26, 122], [-18, 121], [-45, 149], [-56, 169]], 'fill="#75828c" stroke="#181e24" stroke-width="1.1"'));
  // 上掠主刃翼(高耸西翼尖斜掠至东翼尖,锐角悬挑)
  o.push(poly([[-56, 169], [68, 145], [62, 142.8], [-52, 165.8]], 'fill="url(#bladeSide)" stroke="#14181c" stroke-width=".9"'));
  o.push(poly([[-74, 176], [-32, 171], [92, 142], [68, 145], [-56, 169]], 'fill="url(#bladeTop)" stroke="#181e24" stroke-width="1.2"'));
  o.push(`<path d="M${q(-74, 176)}L${q(-26, 169)}L${q(92, 142)}" fill="none" stroke="#d9e2e8" stroke-width="1.3"/>`);

  // 5) 悬挑附属平台(西翼露台泳池 +148 m, 东翼起降坪 +138 m, 折板起降舌台 +119 m)
  // 西翼折板悬挑露台与泳池
  o.push(poly([[-66, 146.2], [-28, 146.2], [-24, 140], [-60, 140]], 'fill="#000" opacity=".28"'));
  o.push(poly([[-72, 148.5], [-24, 148.5], [-30, 146.2], [-66, 146.2]], 'fill="#5c6770" stroke="#181d22" stroke-width=".9"'));
  o.push(`<rect x="${r(DX(-72))}" y="${r(DZ(149.4))}" width="${r(48 * ks)}" height="${r(0.9 * ks)}" fill="#95a1ab" stroke="#232a30" stroke-width=".6"/>`);
  o.push(`<rect x="${r(DX(-66))}" y="${r(DZ(149.2))}" width="${r(24 * ks)}" height="${r(0.7 * ks)}" fill="#5fa9b8"/><path d="M${q(-41, 150.3)}H${r(DX(-25))}" stroke="#cfe3ea" stroke-width="1" opacity=".9"/>`);
  // 东翼起降坪 +138 m
  o.push(`<path d="M${q(66, 136.8)}L${q(62, 131)}M${q(88, 136.8)}L${q(82, 131)}" stroke="#262c33" stroke-width="${1.1 * ks}"/>` + poly([[62, 136.8], [94, 136.8], [98, 131], [66, 131]], 'fill="#000" opacity=".26"'));
  o.push(poly([[60, 139.2], [98, 139.2], [92, 136.8], [56, 136.8]], 'fill="#74808a" stroke="#181d22" stroke-width=".9"'));
  o.push(`<path d="M${q(60, 139.2)}H${r(DX(98))}" stroke="#cfd8df" stroke-width="1.1"/>`);
  // 折板起降舌台 +119 m
  o.push(poly([[-2, 118.2], [40, 118.2], [34, 111], [4, 111]], 'fill="#000" opacity=".32"'));
  o.push(poly([[-6, 120.2], [44, 120.2], [38, 118.2], [0, 118.2]], 'fill="#7e8a94" stroke="#181d22" stroke-width=".9"'));
  o.push(`<path d="M${q(-6, 120.2)}H${r(DX(44))}" stroke="#cfd8df" stroke-width="1.1"/><path d="M${q(12, 120.2)}H${r(DX(32))}" stroke="#f3c168" stroke-width="1.2"/>`);
  // 人(立于西翼悬挑露台,1.8 m)
  o.push(`<g stroke="#111" stroke-width="1.3" fill="#111"><circle cx="${r(DX(-32))}" cy="${r(DZ(151))}" r="1.3"/><line x1="${r(DX(-32))}" y1="${r(DZ(150.6))}" x2="${r(DX(-32))}" y2="${r(DZ(149.4))}"/></g>`);
  o.push(`</g><rect x="45" y="336" width="870" height="384" fill="none" stroke="${C.ink}"/>`);
  for (const z of [100, 120, 140, 160, 180, 200]) o.push(`<line x1="39" y1="${r(DZ(z))}" x2="45" y2="${r(DZ(z))}" stroke="${C.ink}"/>` + txt(37, DZ(z) + 3.5, z, 'xs end'));
  // 细部标注
  const DL = (x, z, lx, lz, s, cls = 's dhalo') => { lead(DX(x), DZ(z), DX(lx), DZ(lz), '#fff'); o.push(txt(DX(lx) + (cls.includes('end') ? -4 : 4), DZ(lz) + 4, s, cls)); };
  DL(-52, 172, -62, 190, '上掠折板刃翼:斜切探出岩鼻约 22 m', 's dhalo end');
  DL(6, 156, 56, 184, '内凹斜切主厅:多层暖光挑台,外罩深色幕墙', 's dhalo');
  DL(22, 140, 82, 166, '中脊斜梁:斜贯立面,分隔主厅与下层实验舱', 's dhalo');
  DL(-52, 148.5, -86, 134, '西翼悬挑露台与泳池 +148 m', 's dhalo end');
  DL(36, 126, 76, 116, '下层重工实验舱(宽约 68 m,深 100 m)', 's dhalo');
  DL(18, 119, 54, 100, '折板起降舌台 +119 m(底部收束于半山腰)', 's dhalo');
  DL(86, 138.5, 104, 150, '东翼起降坪 +138 m', 's dhalo');
  DL(-32, 150.5, -88, 162, '人 1.8 m', 'xs dhalo end');
  o.push(txt(DX(-134), DZ(196), '柱状节理绝壁', 'xs dhalo') + txt(DX(-134), DZ(174), '岩鼻(外凸微悬挑)', 'xs dhalo') + txt(DX(-134), DZ(116), '碎石缓台与陡坎', 'xs dhalo'));
  o.push(`<g transform="translate(${r(DX(95))},736)"><rect width="${20 * ks}" height="5" fill="${C.ink}"/><text x="${20 * ks + 8}" y="6" class="xs">20 米</text></g>`);
  o.push(txt(45, 742, '隐蔽状态下,折板外衣与幕墙切换为拟岩外观,露台、舌台与起降坪收回岩体,崖壁上看不出任何人工痕迹。', 'sub'));
  o.push('</svg>');
  return o.join('\n');
}

// ═════════ 图三:南北剖面图(B–B′,沿 x = SECTION_X) ═════════
const CHAMBERS = [
  ['崖宅', '+116 ~ +176 m', '岛主居所:半山腰斜切折板壳体、多层暖光主厅与重工实验舱'],
  ['机库洞厅', '+35 ~ +80 m', '空天战机;洞顶垂直发射,南端水平弹射'],
  ['内港', '−95 ~ +25 m', '潜艇内港与船坞,连通两座水下闸门'],
  ['工坊', '−240 ~ −125 m', '机器人工厂、食物合成、海水淡化、仓储'],
  ['聚变堆', '−320 m', '全岛能源'],
  ['中枢', '−330 m', '超级人工智能'],
  ['地下城', '−575 ~ −430 m', '舱室群:居住、餐饮、医疗、训练、指挥、军械、仓储、生命维持'],
];
function sectionSVG() {
  const W = 960, Ht = 668, o = [svgOpen(W, Ht)];
  const ky = 170, kz = 0.425, x0 = 58, zero = 258, yMin = -2.7, yMax = 2.5;
  const SX = y => x0 + (y - yMin) * ky, SZ = z => zero - z * kz, P = (y, z) => `${r(SX(y))},${r(SZ(z))}`;
  const top = SZ(430), bot = SZ(-720), right = SX(yMax);
  let Y0 = null, Y1 = null, l0 = null, l1 = null;
  for (let y = -1.8; y <= 1.9; y += 0.0025) { if (onLand(SECTION_X, y)) { if (Y0 === null) Y0 = y; Y1 = y; } if (pip(lakePts, SECTION_X, y)) { if (l0 === null) l0 = y; l1 = y; } }
  const crestS = CLIFF[CLIFF.length - 1][0] / 1000, crestZ = H(SECTION_X, Y0 + 0.03), cs = crestZ / CLIFF[CLIFF.length - 1][1];
  const cliffPts = CLIFF.map(([s, z]) => [Y0 + s / 1000, z * cs]), lift = crestZ - H(SECTION_X, Y0 + crestS);
  const groundAt = y => (y <= Y0 + crestS ? lerpLine(cliffPts, y) : y > l0 && y < l1 ? lakeLevel - LAKE.depth * Math.pow(Math.sin((Math.PI * (y - l0)) / (l1 - l0)), 0.7) : H(SECTION_X, Math.min(y, Y1 - 0.012)) + lift * (1 - sstep(0, 0.22, y - Y0 - crestS)));
  const SB_S = APRON.map(([s, z]) => [s / 1000, z]);
  const SB_N = [[0, 0], [0.06, -3], [0.28, -9], [0.46, -6], [0.52, -2], [0.58, -7], [0.78, -12], [0.9, -4], [0.95, -1], [1.03, -1], [1.07, -12], [1.18, -70], [1.45, -210], [1.95, -420]];
  const slopeOff = z => { for (let i = 0; i + 1 < SB_S.length; i++) { const [a, za] = SB_S[i], [b, zb] = SB_S[i + 1]; if (z >= za && z <= zb) return a + (b - a) * (z - za) / (zb - za); } return SB_S[0][0]; };
  const O = (off, z) => P(Y0 + off, z);

  o.push(`<defs>
    <linearGradient id="sky2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3f2"/><stop offset="1" stop-color="#f6f3ea"/></linearGradient>
    <linearGradient id="sea2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc4e6"/><stop offset="1" stop-color="#153f66"/></linearGradient>
    <linearGradient id="rock2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfb199"/><stop offset="1" stop-color="#84766a"/></linearGradient>
    <linearGradient id="dome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfeaff"/><stop offset="1" stop-color="#f1ead2"/></linearGradient>
    <marker id="arh" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#d1432b"/></marker>
    <marker id="aro" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.under}"/></marker>
    <marker id="arg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.esc}"/></marker>
    <clipPath id="frame"><rect x="${x0}" y="${r(top)}" width="${r(right - x0)}" height="${r(bot - top)}"/></clipPath>
  </defs>`);
  o.push(`<rect width="${W}" height="${Ht}" fill="#fff"/>`);
  o.push(txt(14, 30, '图三 南北剖面图(B–B′)', 'title') + txt(14, 49, `沿 x = ${SECTION_X} 切开(经过崖宅、风草甸和镜湖),自东向西看 · 垂直方向放大 2.5 倍,崖壁的真实坡度见图四`, 'sub'));
  o.push(`<g clip-path="url(#frame)">`);
  o.push(`<rect x="${x0}" y="${r(top)}" width="${r(right - x0)}" height="${r(zero - top)}" fill="url(#sky2)"/><rect x="${x0}" y="${zero}" width="${r(right - x0)}" height="${r(bot - zero)}" fill="url(#sea2)"/>`);

  // 幻域与浮动发生器
  const gS = -2.42, gN = 2.3;
  o.push(`<path d="M${P(gS, 0)}C${P(gS + 0.5, 420)} ${P(gN - 0.9, 440)} ${P(gN, 0)}" fill="${C.field}" fill-opacity=".05" stroke="${C.field}" stroke-width="1.3" stroke-dasharray="7 5"/>`);
  for (const y of [gS, gN]) o.push(`<g transform="translate(${r(SX(y))},${zero})"><path d="M-8,0Q0,-10 8,0Z" fill="#3a3148" stroke="#cdb7ff" stroke-width="1"/><path d="M-7,0Q-6,20 0,30Q6,20 7,0Z" fill="#cdb7ff" opacity=".45"/><ellipse rx="14" ry="2.4" fill="none" stroke="#cdb7ff" stroke-width=".9"/></g>`);

  // 岩体与地表
  const ground = range(Y0 + crestS, Y1, 0.01).map(y => [y, groundAt(y)]);
  const sbS = SB_S.map(([a, z]) => [Y0 + a, z]), sbN = SB_N.map(([a, z]) => [Y1 + a, z]);
  const outline = [...sbS, ...cliffPts.slice(1), ...ground, [Y1, 0], ...sbN];
  o.push(`<path d="M${P(yMin - 0.2, -800)}L${outline.map(p => P(p[0], p[1])).join('L')}L${P(yMax + 0.2, -800)}Z" fill="url(#rock2)"/>`);
  o.push(`<path d="M${P(l0, lakeLevel)}L${range(l0, l1, 0.01).map(y => P(y, groundAt(y))).join('L')}L${P(l1, lakeLevel)}Z" fill="#4f9fd8"/>`);
  const veg = range(Y0 + 0.12, Y1 - 0.06, 0.01).filter(y => !(y > l0 - 0.01 && y < l1 + 0.01) && !pip(meadowPts, SECTION_X, y));
  let vd = ''; veg.forEach((y, i) => { vd += (i && y - veg[i - 1] < 0.015 ? 'L' : 'M') + P(y, groundAt(y) + 9 + 3 * Math.sin(y * 70)); });
  o.push(`<path d="${vd}" fill="none" stroke="${C.landDark}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
  const mIn = range(Y0, Y1, 0.01).filter(y => pip(meadowPts, SECTION_X, y));
  if (mIn.length) o.push(`<path d="M${mIn.map(y => P(y, groundAt(y) + 3)).join('L')}" fill="none" stroke="#c4cc84" stroke-width="3.5" stroke-linecap="round"/>`);
  o.push(`<path d="M${P(Y1 - 0.05, groundAt(Y1 - 0.05) + 1)}L${P(Y1 + 0.05, -2)}" stroke="${C.sand}" stroke-width="4" stroke-linecap="round"/>`);
  o.push(`<path d="M${outline.map(p => P(p[0], p[1])).join('L')}" fill="none" stroke="#453a32" stroke-width="1.3"/>`);
  for (const [s, z] of [[38, 54], [64, 96]]) o.push(`<circle cx="${r(SX(Y0 + s / 1000))}" cy="${r(SZ(z * cs) - 2)}" r="2.2" fill="#5c8a57"/>`);
  for (let i = 0; i < 14; i++) { const s = -95 + i * 8.5; o.push(`<circle cx="${r(SX(Y0 + s / 1000))}" cy="${r(SZ(lerpLine(SB_S, s / 1000)) - 1)}" r="${r(1.3 + hash(i, 11) * 1.6)}" fill="#3a302a"/>`); }
  for (const [s, hgt] of [[-78, 26], [-52, 15]]) o.push(`<path d="M${O((s - 5) / 1000, lerpLine(SB_S, (s - 5) / 1000))}L${O((s - 1) / 1000, hgt)}L${O((s + 4) / 1000, lerpLine(SB_S, (s + 4) / 1000))}Z" fill="#241d19"/>`);
  o.push(`<path d="M${O(-0.1, 0)}h${r(0.1 * ky)}" stroke="#fff" stroke-width="2" opacity=".9"/>`);
  for (const [a, b] of [[0.88, 1.06], [0.49, 0.55]]) o.push(`<path d="M${P(Y1 + a, lerpLine(SB_N, a))}Q${P(Y1 + (a + b) / 2, 4)} ${P(Y1 + b, lerpLine(SB_N, b))}Z" fill="${C.reef}" stroke="#8d7f58" stroke-width=".8"/>`);
  // 林中营房
  const cy = CAMPS[0][1];
  for (const d of [-0.03, 0, 0.03]) o.push(`<path d="M${P(cy + d - 0.008, groundAt(cy + d) + 1)}v-5l4,-3l4,3v5z" fill="#2f4a37" stroke="#d8e6c8" stroke-width=".6"/>`);

  // 基核壳体
  const HULL = [[0.092, 146], [0.1, 178], [0.15, 186], [0.4, 165], [0.75, 112], [1.02, 72], [1.15, 22], [1.2, -90], [1.12, -300], [0.98, -560], [0.7, -660], [0.1, -672], [-0.25, -640], [-0.5, -560], [-0.42, -470], [-0.2, -340], [-0.05, -190], [0.0, -110], [0.02, -60], [0.045, 5], [0.07, 60], [0.086, 118]]
    .map(([a, z]) => [a, z > 0 && a >= 0.15 ? Math.min(z, groundAt(Y0 + a) - 14) : z]);
  o.push(`<path d="M${HULL.map(p => O(p[0], p[1])).join('L')}Z" fill="#39414d" fill-opacity=".66" stroke="${C.hull}" stroke-width="2.4" stroke-linejoin="round"/>`);

  // 洞室
  const vault = (a, b, z1, z2, arch, attrs) => `<path d="M${O(a, z1)}L${O(a, z2 - arch)}Q${O((a + b) / 2, z2 + arch)} ${O(b, z2 - arch)}L${O(b, z1)}Z" ${attrs}/>`;
  const rrect = (a, b, z1, z2, attrs, rad = 6) => `<rect x="${r(SX(Y0 + a))}" y="${r(SZ(z2))}" width="${r((b - a) * ky)}" height="${r((z2 - z1) * kz)}" rx="${rad}" ${attrs}/>`;
  const st = 'stroke="#241f1b" stroke-width="1"';
  // 热沉导管
  const hsOff = slopeOff(-338);
  o.push(`<path d="M${O(0.22, -332)}L${O(hsOff, -338)}L${O(slopeOff(-410), -410)}" fill="none" stroke="#d1432b" stroke-width="2.2" stroke-linejoin="round" marker-end="url(#arh)"/>`);
  // 潜艇隧道、内港、机库
  const gateOff = slopeOff(-80);
  o.push(rrect(gateOff, 0.31, -90, -70, 'fill="#7db7e6" stroke="#0d2233" stroke-width="1"', 0));
  o.push(vault(0.3, 0.75, -95, 24, 10, `fill="#eef4f8" ${st}`));
  o.push(`<path d="M${O(0.3, -95)}L${O(0.3, 0)}L${O(0.75, 0)}L${O(0.75, -95)}Z" fill="#7db7e6" ${st}/>`);
  o.push(`<g transform="translate(${r(SX(Y0 + 0.52))},${r(SZ(-30))})"><ellipse rx="10" ry="3" fill="#16222c"/><rect x="-2" y="-6" width="4" height="4" fill="#16222c"/></g>`);
  o.push(vault(0.47, 0.84, 35, 78, 8, `fill="#dfe3e8" ${st}`));
  // 机库发射:洞顶垂直发射井 + 南端水平弹射隧道
  const vOff = 0.66, hOff = lerpLine(cliffPts.slice(3, 6).map(p => [p[1], p[0]]), 65) - Y0;
  o.push(`<path d="M${O(vOff, 80)}L${O(vOff, groundAt(Y0 + vOff))}" stroke="#f4f1e6" stroke-width="5"/><path d="M${O(vOff, groundAt(Y0 + vOff) + 6)}L${O(vOff, groundAt(Y0 + vOff) + 130)}" stroke="${C.under}" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#aro)"/>`);
  o.push(rrect(hOff, 0.48, 58, 72, 'fill="#e6e1d6" stroke="#241f1b" stroke-width="1"', 0));
  o.push(`<path d="M${O(hOff - 0.02, 65)}L${O(hOff - 0.46, 65)}" stroke="${C.under}" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#aro)"/>`);
  // 崖宅(半山腰斜切折板楔形悬挑 + 内凹暖光主厅与后方居住层 + 下层重工实验舱)
  o.push(`<path d="M${O(0.07, 168)}L${O(0.156, 168)}L${O(0.156, 142)}L${O(0.078, 142)}Z" fill="#f5e4c3" stroke="#241f1b" stroke-width=".8"/>`);
  o.push(`<path d="M${O(0.07, 168)}L${O(0.098, 168)}L${O(0.098, 142)}L${O(0.078, 142)}Z" fill="#f0a84b" stroke="#241f1b" stroke-width=".7"/>`);
  o.push(`<path d="M${O(0.098, 176)}L${O(0.066, 168)}L${O(0.07, 167)}L${O(0.096, 168)}Z" fill="#5a656e" stroke="#1f252b" stroke-width=".8"/>`);
  o.push(`<rect x="${r(SX(Y0 + 0.084))}" y="${r(SZ(138))}" width="${r(0.104 * ky)}" height="${r(18 * kz)}" fill="#ffb347" ${st}/>`);
  o.push(`<path d="M${O(0.086, 120)}L${O(0.054, 120)}L${O(0.072, 118)}L${O(0.09, 115)}L${O(0.09, 120)}Z" fill="#5a656e" stroke="#1f252b" stroke-width=".7"/>`);
  // 工坊、聚变堆、中枢
  o.push(rrect(0.15, 0.5, -220, -125, `fill="#cdb79a" ${st}`, 9) + rrect(0.62, 0.98, -240, -140, `fill="#cdb79a" ${st}`, 9));
  o.push(`<ellipse cx="${r(SX(Y0 + 0.3))}" cy="${r(SZ(-320))}" rx="${r(55 * ky / 1000 * 1.6)}" ry="${r(55 * kz)}" fill="#fff3c4" stroke="#b3541e" stroke-width="1.6"/><ellipse cx="${r(SX(Y0 + 0.3))}" cy="${r(SZ(-320))}" rx="6" ry="9" fill="#ff9d3b"/>`);
  o.push(`<ellipse cx="${r(SX(Y0 + 0.95))}" cy="${r(SZ(-330))}" rx="${r(50 * ky / 1000 * 1.6)}" ry="${r(50 * kz)}" fill="#20303c" stroke="#7fd4ff" stroke-width="1.6"/><ellipse cx="${r(SX(Y0 + 0.95))}" cy="${r(SZ(-330))}" rx="5" ry="8" fill="#7fd4ff"/>`);
  o.push(`<path d="M${O(0.39, -322)}L${O(0.87, -330)}" stroke="#f4f1e6" stroke-width="3"/>`);
  // 地下城:像飞船内部一样分隔的舱室群,没有大空间
  const DECKS = [[-432, [[0.05, 0.22], [0.26, 0.5]]], [-462, [[-0.08, 0.14], [0.18, 0.36], [0.4, 0.66]]], [-492, [[-0.18, 0.02], [0.06, 0.3], [0.34, 0.52], [0.56, 0.74]]], [-522, [[-0.12, 0.1], [0.14, 0.42], [0.46, 0.68]]], [-552, [[0.0, 0.2], [0.24, 0.44], [0.48, 0.6]]]];
  const TINT = ['#ecdcb8', '#aac6da', '#d7e7da', '#d9c8e2', '#cbbfae', '#b9dcc2', '#dbb3a2', '#f0e2a4'];
  o.push(`<path d="M${O(0.33, -440)}V${r(SZ(-570))}" stroke="#f4f1e6" stroke-width="3.5"/>`);
  let mi = 0;
  for (const [zt, mods] of DECKS) {
    o.push(`<path d="M${O(mods[0][0], zt - 11.5)}H${r(SX(Y0 + mods[mods.length - 1][1]))}" stroke="#f4f1e6" stroke-width="3"/>`);
    for (const [a, b] of mods) {
      o.push(rrect(a, b, zt - 23, zt, `fill="${TINT[mi % TINT.length]}" ${st}`, 2.5));
      for (let s = a + 0.035; s < b - 0.012; s += 0.035) o.push(`<path d="M${O(s, zt - 2)}V${r(SZ(zt - 21))}" stroke="#241f1b" stroke-opacity=".45" stroke-width=".7"/>`);
      o.push(`<path d="M${O(a + 0.006, zt - 11.5)}H${r(SX(Y0 + b - 0.006))}" stroke="#241f1b" stroke-opacity=".35" stroke-width=".6"/>`);
      mi++;
    }
  }
  // 竖井与通道
  o.push(`<path d="M${O(0.8, 35)}L${O(0.8, -473.5)}L${O(0.66, -473.5)}" fill="none" stroke="#f4f1e6" stroke-width="5"/><path d="M${O(0.8, 35)}L${O(0.8, -473.5)}" stroke="#241f1b" stroke-width=".8" stroke-dasharray="1 5"/>`);
  o.push(`<path d="M${O(0.196, 165)}V${r(SZ(-70))}M${O(0.156, 150)}H${r(SX(Y0 + 0.196))}M${O(0.188, 122)}H${r(SX(Y0 + 0.196))}" fill="none" stroke="#f4f1e6" stroke-width="3.5"/>`);
  // 深海脱出口与出路
  const escOff = slopeOff(-503);
  o.push(rrect(escOff, -0.17, -513, -493, 'fill="#7db7e6" stroke="#0d2233" stroke-width="1"', 0));
  o.push(`<path d="M${O(-0.2, -503)}L${O(escOff - 0.2, -503)}" stroke="${C.esc}" stroke-width="2" marker-end="url(#arg)"/>`);
  o.push(`<path d="M${O(0.86, -440)}L${O(0.86, 22)}" stroke="${C.esc}" stroke-width="2" marker-end="url(#arg)"/>`);
  // 编号
  const badge = (y, z, nn) => `<g transform="translate(${r(SX(y))},${r(SZ(z))})"><circle r="7.5" fill="#fff" stroke="${C.ink}" stroke-width="1"/><text y="3.6" class="xs b mid">${nn}</text></g>`;
  o.push(badge(Y0 - 0.06, 150, 1) + badge(Y0 + 0.65, 56, 2) + badge(Y0 + 0.62, -55, 3) + badge(Y0 + 0.32, -172, 4) + badge(Y0 + 0.3, -356, 5) + badge(Y0 + 0.95, -366, 6) + badge(Y0 + 0.82, -535, 7));
  o.push(`</g>`);

  // 海平面、轴、边框
  o.push(`<line x1="${x0}" y1="${zero}" x2="${r(right)}" y2="${zero}" stroke="#fff" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>`);
  for (const z of [400, 200, 0, -200, -400, -600]) o.push(`<line x1="${x0 - 5}" y1="${r(SZ(z))}" x2="${x0}" y2="${r(SZ(z))}" stroke="${C.ink}"/>` + txt(x0 - 8, SZ(z) + 3.5, z > 0 ? '+' + z : z, 'xs end'));
  o.push(txt(x0 - 8, top - 6, '米', 'xs end'));
  o.push(`<rect x="${x0}" y="${r(top)}" width="${r(right - x0)}" height="${r(bot - top)}" fill="none" stroke="${C.ink}"/>`);
  o.push(txt(x0 + 6, top + 16, 'B(南)', 't b halo') + txt(right - 6, top + 16, 'B′(北)', 't b halo end'));

  // 标注
  const lead = (a, b) => o.push(`<path d="M${P(...a)}L${P(...b)}" stroke="${C.ink}" stroke-width=".8" fill="none"/>`);
  o.push(txt(SX(Y0 - 0.05), SZ(crestZ + 30), `主崖岬(剖面处 ${Math.round(crestZ)} m)`, 't b halo end'));
  o.push(txt(SX(Y0 + hOff - 0.48), SZ(65) - 5, '水平发射', 'xs halo end') + txt(SX(Y0 + vOff) + 6, SZ(groundAt(Y0 + vOff) + 126), '垂直发射', 'xs halo'));
  lead([MEADOW.y + 0.1, groundAt(MEADOW.y + 0.1) + 10], [MEADOW.y + 0.16, 296]); o.push(txt(SX(MEADOW.y + 0.17), SZ(300), `风草甸 ${meadowLevel} m`, 's halo'));
  lead([cy, groundAt(cy) + 26], [cy + 0.02, 232]); o.push(txt(SX(cy + 0.03), SZ(236), '林中营房', 's halo'));
  lead([(l0 + l1) / 2, lakeLevel + 8], [(l0 + l1) / 2 + 0.03, 176]); o.push(txt(SX((l0 + l1) / 2 + 0.04), SZ(180), `镜湖 ${lakeLevel} m`, 's halo'));
  o.push(txt(SX(Y1 + 0.02), SZ(46), '月湾沙滩', 's halo') + txt(SX(Y1 + 0.5), SZ(96), '潟湖与珊瑚丛', 's halo mid') + txt(SX(Y1 + 0.98), SZ(46), '礁盘', 's halo mid'));
  lead([Y1 + 0.5, 8], [Y1 + 0.5, 78]);
  o.push(txt(SX(gN), SZ(70), '幻域浮标', 's halo mid') + txt(SX(gS), SZ(70), '幻域浮标', 's halo mid'));
  o.push(txt(SX(1.35), SZ(352), '幻域中环(视觉隐形 · 脑波干扰)', 's halo mid', `fill="${C.field}"`));
  lead([Y0 + 0.04, 158], [Y0 - 0.3, 160]); o.push(txt(SX(Y0 - 0.32), SZ(160) + 4, '崖宅', 's halo end'));
  lead([Y0 - 0.05, -10], [Y0 - 0.3, -36]); o.push(txt(SX(Y0 - 0.32), SZ(-36) + 4, '崖脚崩积巨石裙', 's dhalo end'));
  lead([Y0 + gateOff - 0.01, -80], [Y0 - 0.38, -80]); o.push(txt(SX(Y0 - 0.4), SZ(-80) + 4, '主闸门 −80 m', 's dhalo end'));
  o.push(txt(SX(Y0 + escOff - 0.24), SZ(-503) - 22, '深海脱出口 −500 m', 's b dhalo mid') + txt(SX(Y0 + escOff - 0.24), SZ(-503) - 9, '脱出艇由此驶入深海', 'xs dhalo mid'));
  o.push(txt(SX(Y0 - 1.22), SZ(-292), '热沉导管', 's b dhalo') + txt(SX(Y0 - 1.22), SZ(-292) + 13, '废热排入深层冷水', 'xs dhalo'));
  lead([Y0 + slopeOff(-380) - 0.02, -380], [Y0 - 0.74, -318]);

  // 图例
  const gx = SX(Y1 - 0.5), gy0 = SZ(-150);
  CHAMBERS.forEach(([name, rng2, desc], i) => {
    const gy = gy0 + i * 27;
    o.push(`<g transform="translate(${r(gx)},${r(gy)})"><circle r="7.5" fill="#fff" stroke="${C.ink}" stroke-width="1"/><text y="3.6" class="xs b mid">${i + 1}</text></g>`);
    o.push(txt(gx + 14, gy - 1, `${name} ${rng2}`, 's b halo') + txt(gx + 14, gy + 11, desc, 'xs halo'));
  });
  const ly = gy0 + CHAMBERS.length * 27 + 4;
  o.push(`<path d="M${r(gx - 8)},${r(ly)}h16" stroke="${C.hull}" stroke-width="2.4"/>` + txt(gx + 14, ly + 4, '基核壳体(远古遗留)', 's b halo'));
  o.push(`<path d="M${r(gx + 150)},${r(ly)}h16" stroke="${C.esc}" stroke-width="2" marker-end="url(#arg)"/>` + txt(gx + 174, ly + 4, '地下城的出路', 's b halo'));
  o.push(txt(gx - 8, ly + 24, `西闸门在西端崖下,不在本剖面内,经约 ${WEST_GATE.len.toFixed(1)} 公里的水下隧道通到内港。`, 'xs halo'));
  o.push(`<g transform="translate(${x0},${r(bot + 16)})"><rect width="${ky}" height="5" fill="${C.ink}"/><text x="${ky + 8}" y="6" class="xs">1 公里(水平)</text></g>`);
  o.push('</svg>');
  return { svg: o.join('\n'), Y0, Y1, l0, l1, crestZ };
}

// ═════════ 图四:主崖与崖宅剖面(真实比例) ═════════
function cliffSVG() {
  const W = 960, Ht = 800, o = [svgOpen(W, Ht)];
  const k = 2, FX4 = 64, FY4 = 66, sMin = -150, sMax = 272, zMax = 236, zMin = -110;
  const X = s => FX4 + (s - sMin) * k, Z = z => FY4 + (zMax - z) * k, q = (s, z) => `${r(X(s))},${r(Z(z))}`;
  const FW4 = (sMax - sMin) * k, FH4 = (zMax - zMin) * k;
  const prof = [[-150, -160], [-128, -130], ...APRON.slice(5).map(p => [p[0], p[1]]), ...CLIFF.slice(1), [215, 203], [272, 195]];
  const surf = s => lerpLine(prof, s);
  o.push(`<defs>${GRADS}
    <linearGradient id="sea4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc4e6"/><stop offset="1" stop-color="#1d4f7c"/></linearGradient>
    <linearGradient id="rock4" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6f6053"/><stop offset=".45" stop-color="#9a8974"/><stop offset="1" stop-color="#b3a58e"/></linearGradient>
    <clipPath id="f4"><rect x="${FX4}" y="${FY4}" width="${FW4}" height="${FH4}"/></clipPath>
    <clipPath id="rk4"><path d="M${prof.map(p => q(...p)).join('L')}L${q(sMax, zMin - 60)}L${q(sMin, zMin - 60)}Z"/></clipPath>
    <marker id="ar4" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.ink}"/></marker>
  </defs>`);
  o.push(`<rect width="${W}" height="${Ht}" fill="#fff"/>`);
  o.push(txt(14, 30, '图四 主崖与崖宅剖面(真实比例)', 'title') + txt(14, 49, '沿主崖岬自南向北切开,自东向西看 · 不放大,坡度即真实坡度', 'sub'));
  o.push(`<g clip-path="url(#f4)"><rect x="${FX4}" y="${FY4}" width="${FW4}" height="${r(Z(0) - FY4)}" fill="url(#sky)"/><rect x="${FX4}" y="${r(Z(0))}" width="${FW4}" height="${r(FH4 - (Z(0) - FY4))}" fill="url(#sea4)"/>`);
  // 岩体
  o.push(`<path d="M${prof.map(p => q(...p)).join('L')}L${q(sMax, zMin - 60)}L${q(sMin, zMin - 60)}Z" fill="url(#rock4)"/>`);
  o.push(`<g clip-path="url(#rk4)">`);
  // 熔岩流层理:与缓台对齐的水平层
  for (const z of [-60, -20, 20, 52, 93, 125, 150, 176, 192]) o.push(`<path d="M${range(sMin, sMax, 12).map(s => q(s, z + 2 * Math.sin(s * 0.03 + z))).join('L')}" fill="none" stroke="#3a2f27" stroke-opacity=".28" stroke-width="1"/>`);
  for (const [za, zb] of [[52, 46], [93, 87], [125, 119]]) o.push(`<path d="M${q(sMin, za)}H${r(X(sMax))}V${r(Z(zb))}H${r(X(sMin))}Z" fill="#5e5146" opacity=".28"/>`);
  // 柱状节理:陡坎和上部绝壁内侧的竖向裂隙
  for (let i = 0; i < 260; i++) {
    const z = -20 + hash(i, 21) * 222, s0 = (() => { let lo = 0, hi = 170; for (let t = 0; t < 14; t++) { const m = (lo + hi) / 2; if (surf(m) < z) lo = m; else hi = m; } return hi; })();
    const s = s0 + 1.5 + hash(i, 22) * (z > 125 ? 46 : 20), len = 6 + hash(i, 23) * (z > 125 ? 22 : 12);
    o.push(`<line x1="${r(X(s))}" y1="${r(Z(z + len / 2))}" x2="${r(X(s + (hash(i, 24) - 0.5)))}" y2="${r(Z(z - len / 2))}" stroke="#2a211b" stroke-opacity=".3" stroke-width="1"/>`);
  }
  o.push(`</g>`);
  // 崖顶丛林、缓台灌木、崩积巨石
  for (let s = 100, i = 0; s <= 272; s += 7, i++) o.push(`<circle cx="${r(X(s))}" cy="${r(Z(surf(s) + 5 + (i % 3) * 2))}" r="${r((5 + ((i * 5) % 4)) * k)}" fill="${i % 4 ? C.landDark : '#5f9a66'}"/>`);
  for (const [a, b] of [[30, 45], [55, 73]]) for (let s = a; s <= b; s += 3.2) o.push(`<circle cx="${r(X(s))}" cy="${r(Z(surf(s) + 1.6))}" r="${r((1.5 + hash(s, 31) * 1.6) * k)}" fill="${hash(s, 32) > 0.4 ? '#5c8a57' : '#7aa268'}"/>`);
  for (let i = 0; i < 46; i++) { const s = -98 + hash(i, 41) * 122, rad = 1.6 + hash(i, 42) * (s > -30 ? 5 : 3.4); o.push(`<path d="${crPath(blob({ x: s, y: surf(s) + rad * 0.5, rx: rad * 1.2, ry: rad }, i + 400, 8, 1.6), true, p => q(p[0], p[1]))}" fill="${hash(i, 43) > 0.5 ? '#2c2520' : '#463b33'}"/>`); }
  for (const [s, hgt] of [[-78, 26], [-52, 15]]) o.push(`<path d="M${q(s - 5, surf(s - 5))}L${q(s - 3, hgt * 0.6)}L${q(s - 1, hgt)}L${q(s + 2, hgt * 0.8)}L${q(s + 5, surf(s + 5))}Z" fill="#241d19"/>`);
  o.push(`<path d="M${range(-104, 4, 6).map((s, i) => q(s, (i % 2 ? 1.6 : -0.8))).join('L')}" fill="none" stroke="#fff" stroke-width="3" opacity=".9"/>`);
  o.push(`<rect x="${FX4}" y="${r(Z(0))}" width="${r(X(-98) - FX4)}" height="2" fill="#fff" opacity=".5"/>`);

  // 基核壳体边缘
  const hull = [[272, 176], [150, 186], [100, 178], [92, 146], [86, 118], [70, 60], [45, 5], [20, -60], [0, -112]];
  o.push(`<path d="M${hull.map(p => q(...p)).join('L')}" fill="none" stroke="${C.hull}" stroke-width="2.4" stroke-dasharray="10 4" stroke-linejoin="round"/>`);

  // 岩体内的空间
  // 后方岩内居住洞室与前方悬挑主厅贯通(s = 70 ~ 156 m, z = 142 ~ 168 m)
  const sp4 = (pts, attrs) => `<path d="M${pts.map(p => q(p[0], p[1])).join('L')}Z" ${attrs}/>`;
  o.push(sp4([[70, 167.5], [156, 167.5], [156, 142], [78, 142]], 'fill="#f5e4c3" stroke="#2a2420" stroke-width="1"'));
  o.push(`<path d="M${q(70, 167.5)}L${q(98, 167.5)}L${q(98, 142)}L${q(78, 142)}Z" fill="url(#atriumGlow)" opacity=".88"/>`);
  // 三层错层水平挑台楼板(z = 160, 153, 146 m),从岩内向前探至斜切幕墙内侧
  for (const [zf, sf] of [[160, 72.8], [153, 75], [146, 77.2]]) {
    o.push(`<rect x="${r(X(sf))}" y="${r(Z(zf))}" width="${r((156 - sf) * k)}" height="${r(1.2 * k)}" fill="#2a2420" stroke="#ffe7b0" stroke-width=".7"/>`);
    o.push(`<path d="M${q(sf + 0.5, zf)}V${r(Z(zf + 1.4))}" stroke="#cfe3ea" stroke-width=".9"/>`);
  }
  o.push(`<rect x="${r(X(84))}" y="${r(Z(138))}" width="${r(104 * k)}" height="${r(18 * k)}" rx="4" fill="url(#labglow)" stroke="#14181c" stroke-width="1.4"/>`);
  o.push(`<path d="M${q(90, 134)}H${r(X(184))}" stroke="#14181c" stroke-width="3"/><path d="M${q(112, 134)}V${r(Z(127))}M${q(160, 134)}V${r(Z(125.5))}" stroke="#14181c" stroke-width="1.6"/>`);
  o.push(`<circle cx="${r(X(140))}" cy="${r(Z(126.5))}" r="${4.5 * k}" fill="url(#core)"/><circle cx="${r(X(140))}" cy="${r(Z(126.5))}" r="${1.6 * k}" fill="#fff"/>`);
  o.push(`<path d="M${q(96, 120.2)}l${r(4 * k)},${r(-3 * k)}l${r(9 * k)},${r(-0.6 * k)}l${r(6 * k)},${r(2 * k)}l${r(1 * k)},${r(1.6 * k)}z" fill="#20262c" stroke="#7fd4ff" stroke-width=".8"/>`);
  // 竖井与水下隧道
  o.push(`<rect x="${r(X(196))}" y="${r(Z(165))}" width="${6 * k}" height="${r((165 - zMin) * k)}" fill="#f4f1e6" stroke="#2a2420" stroke-width=".8"/><path d="M${q(156, 150)}H${r(X(196))}M${q(188, 122)}H${r(X(196))}" stroke="#f4f1e6" stroke-width="5"/>`);
  o.push(`<rect x="${r(X(-112))}" y="${r(Z(-70))}" width="${r((sMax + 112) * k)}" height="${20 * k}" fill="#7db7e6" stroke="#0d2233" stroke-width="1"/><rect x="${r(X(-114))}" y="${r(Z(-67))}" width="5" height="${14 * k}" fill="#0d2233" stroke="#7fd4ff" stroke-width="1.2"/>`);

  // 南发射口:水平弹射隧道,开在第一级缓台后壁
  o.push(`<defs><marker id="ar4r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${C.under}"/></marker></defs>`);
  o.push(`<rect x="${r(X(48))}" y="${r(Z(74))}" width="${r((sMax - 48) * k)}" height="${16 * k}" fill="#e6e1d6" stroke="#2a2420" stroke-width="1"/><rect x="${r(X(47))}" y="${r(Z(74))}" width="4" height="${16 * k}" fill="#1b1410" stroke="#ff9d3b" stroke-width="1.2"/>`);
  o.push(`<path d="M${q(130, 66)}L${q(-38, 66)}" stroke="${C.under}" stroke-width="2" stroke-dasharray="8 4" marker-end="url(#ar4r)"/>`);
  // 崖宅 —— 侧面:前掠折板楔形悬挑剖面(悬在半山腰,底部在 +115 m 收束入岩)
  // 内倾式斜切玻璃幕墙剖面
  o.push(`<line x1="${r(X(70))}" y1="${r(Z(167.2))}" x2="${r(X(78))}" y2="${r(Z(142))}" stroke="#162129" stroke-width="3.6"/>`);
  o.push(`<line x1="${r(X(70))}" y1="${r(Z(167.2))}" x2="${r(X(78))}" y2="${r(Z(142))}" stroke="#9ed3e6" stroke-width="1.4"/>`);
  // 上掠折板刃翼剖面(探出岩鼻约 22 m)
  o.push(sp4([[98, 176], [66, 168], [70, 167], [96, 168.2]], 'fill="url(#bladeTop)" stroke="#14181c" stroke-width="1.1"'));
  o.push(`<path d="M${q(98, 176)}L${q(66, 168)}" stroke="#dce4ea" stroke-width="1.3"/>`);
  // 远景西翼悬挑露台与泳池(+148.5 m,位于剖面西侧远景)
  o.push(sp4([[75, 148.5], [58, 148.5], [62, 146.2], [76, 146.2]], 'fill="#5c6770" fill-opacity=".75" stroke="#181d22" stroke-width=".8" stroke-dasharray="3 2"'));
  o.push(`<rect x="${r(X(59))}" y="${r(Z(149.3))}" width="${r(10 * k)}" height="${r(0.8 * k)}" fill="#5fa9b8" opacity=".85"/>`);
  // 中脊斜梁剖面
  o.push(sp4([[86, 143], [68, 139], [74, 137], [88, 138]], 'fill="url(#bladeSide)" stroke="#14181c" stroke-width="1"'));
  o.push(`<path d="M${q(86, 143)}L${q(68, 139)}" stroke="#b8c4cd" stroke-width="1"/>`);
  // 下层折板起降舌台与底部半山腰收束龙骨(锚入 +115 m 崖壁)
  o.push(sp4([[86, 120.5], [54, 120.5], [58, 118.2], [72, 118.2], [90, 115], [90, 120.5]], 'fill="#6d7882" stroke="#14181c" stroke-width="1"'));
  o.push(sp4([[72, 118.2], [90, 115], [90, 120.5]], 'fill="url(#bladeSide)" stroke="#14181c" stroke-width=".9"'));
  o.push(`<path d="M${q(86, 120.5)}H${r(X(54))}" stroke="#dce4ea" stroke-width="1.1"/>`);
  // 人(立于起降舌台,1.8 m)
  o.push(`<g stroke="#111" stroke-width="1.2" fill="#111"><circle cx="${r(X(66))}" cy="${r(Z(122.1))}" r="1.1"/><line x1="${r(X(66))}" y1="${r(Z(121.8))}" x2="${r(X(66))}" y2="${r(Z(120.5))}"/></g>`);
  o.push(`</g>`);

  // 轴与边框
  for (const z of [-100, -50, 0, 50, 100, 150, 200]) o.push(`<line x1="${FX4 - 5}" y1="${r(Z(z))}" x2="${FX4}" y2="${r(Z(z))}" stroke="${C.ink}"/>` + txt(FX4 - 8, Z(z) + 3.5, z > 0 ? '+' + z : z, 'xs end'));
  o.push(txt(FX4 - 8, FY4 - 6, '米', 'xs end') + `<rect x="${FX4}" y="${FY4}" width="${FW4}" height="${FH4}" fill="none" stroke="${C.ink}"/>`);
  o.push(txt(FX4 + 8, FY4 + 18, '南(大洋)', 't b halo') + txt(FX4 + FW4 - 8, FY4 + 18, '北(岛内)', 't b halo end'));

  // 三段式标注(左侧括线)
  const bandX = X(-146);
  for (const [za, zb, name, d1, d2] of [[209, 120, '上层 +120 ~ +209 m', '柱状节理绝壁;+145 ~ +175 m 处', '岩鼻向外前倾约 8 米,崖顶圆润'], [120, 20, '中层 +20 ~ +120 m', '阶梯状陡坡,总体约 57°:', '75° 陡坎 + 宽 12–20 米的 30° 缓台'], [20, -30, '底层 −30 ~ +20 m', '海蚀平台与崩积巨石裙,', '向外伸出约 90 米']]) {
    o.push(`<path d="M${r(bandX + 6)},${r(Z(za) + 2)}h-6V${r(Z(zb) - 2)}h6" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M${r(bandX + 6)},${r(Z(za) + 2)}h-6V${r(Z(zb) - 2)}h6" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
    const ty = (Z(za) + Z(zb)) / 2;
    o.push(txt(bandX + 12, ty - 10, name, 's b halo') + txt(bandX + 12, ty + 4, d1, 'xs halo') + txt(bandX + 12, ty + 17, d2, 'xs halo'));
  }
  const lead = (a, b) => o.push(`<path d="M${q(...a)}L${q(...b)}" stroke="${C.ink}" stroke-width=".8" fill="none"/>`);
  const LB = (a, b, s, cls = 's halo') => { lead(a, b); o.push(txt(X(b[0]) + (cls.includes('end') ? -4 : 4), Z(b[1]) + 4, s, cls)); };
  LB([68, 168], [16, 190], '上掠折板刃翼:最大探出岩鼻约 22 米', 's b halo end');
  LB([74, 154], [26, 148], '内凹斜切幕墙与三层错层主厅', 's halo end');
  LB([56, 119.5], [10, 132], '折板起降舌台 +119 m(底部龙骨收束于半山腰)', 's halo end');
  LB([48, 68], [-6, 94], '南发射口 +65 m:水平弹射', 's b halo end');
  LB([150, 134], [214, 112], '重工实验室(深入岩体约 100 米)', 's b halo');
  LB([130, 160], [214, 178], '后方岩内居住层', 's halo');
  LB([199, 60], [214, 60], '竖井:下通机库洞厅与内港', 's halo');
  LB([-114, -74], [-104, -98], '主闸门 −80 m,藏在乱石坡之下', 's b dhalo');
  LB([120, -80], [150, -98], '水下隧道,通向内港', 's dhalo');
  LB([-66, 10], [-100, 44], '海蚀柱', 's halo end');
  LB([180, 206], [150, 226], '圆润的崖顶山脊,覆满丛林', 's halo end');
  o.push(`<path d="M${r(X(232))},${r(Z(178) + 4)}h16" stroke="${C.hull}" stroke-width="2.4" stroke-dasharray="10 4"/>` + txt(X(232), Z(178) + 20, '基核壳体', 'xs b halo'));
  o.push(`<g transform="translate(${FX4},${FY4 + FH4 + 14})"><rect width="${50 * k}" height="5" fill="${C.ink}"/><text x="${50 * k + 8}" y="6" class="xs">50 米(水平与垂直同比例)</text></g>`);
  o.push('</svg>');
  return o.join('\n');
}

// ═════════ 输出 ═════════
const sec = sectionSVG();
const figs = [['平面图', planSVG()], ['南立面图', elevSVG()], ['南北剖面图', sec.svg], ['主崖剖面图', cliffSVG()]];
for (const [name, svg] of figs) writeFileSync(join(here, `${name}.svg`), svg, 'utf8');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>岛屿草图</title>
<style>
  body{margin:0;background:#eef1f3;color:#22303a;font-family:${FONT};line-height:1.6}
  main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
  h1{font-size:24px;margin:0 0 4px} p.lead{margin:0 0 20px;color:#4a5a66;font-size:14px}
  figure{margin:0 0 22px;background:#fff;border:1px solid #d5dbe0;border-radius:10px;padding:10px;overflow:hidden}
  figure svg{display:block;width:100%;height:auto}
  figcaption{font-size:13px;color:#4a5a66;padding:8px 6px 2px}
</style></head><body><main>
<h1>岛屿基地草图</h1>
<p class="lead">依据《岛屿设定.md》2.3 生成。岸线和地形由同一套数据计算,地名均为暂定名。</p>
<figure>${figs[0][1]}<figcaption>平面图:南岸不是一整片悬崖——三座岬角之间夹着海蚀裂谷、一道沿断裂发育的峡谷和两处礁石滩。北面是月湾沙滩和浅水潟湖,礁盘错落分布。</figcaption></figure>
<figure>${figs[1][1]}<figcaption>南立面图:上图用深浅表示远近,崖线在礁石滩和峡谷处断开。下图是崖宅的正面:冷灰斜切折板壳体悬在半山腰岩鼻上,内嵌多层暖光主厅与重工实验舱。</figcaption></figure>
<figure>${figs[2][1]}<figcaption>南北剖面图:机库从洞顶垂直发射,也可以从南端的隧道水平弹射出崖面。最深处是地下城,像飞船内部一样由许多舱室组成。</figcaption></figure>
<figure>${figs[3][1]}<figcaption>主崖与崖宅剖面:三段式的玄武岩海蚀崖。崖宅以斜切折板从半山腰上部岩鼻凌厉探出,底部在 +116 米处收束锚入崖壁;下方是水平发射口,主闸门藏在水下乱石坡之下。</figcaption></figure>
</main></body></html>`;
writeFileSync(join(root, '岛屿草图.html'), html, 'utf8');

const f1 = n => n.toFixed(2);
console.log(`面积 ${area.toFixed(1)} km² | 东西 ${f1(ext[0])}~${f1(ext[1])} 南北 ${f1(ext[2])}~${f1(ext[3])}`);
console.log(`最高点 ${Math.round(peak.h)} m @ (${f1(peak.x)}, ${f1(peak.y)}) | 镜湖水面 ${lakeLevel} m | 风草甸 ${meadowLevel} m`);
console.log('山丘:', HILLS.filter(h => h[4]).map(h => `${h[4]} ${Math.round(H(h[0], h[1]))} m`).join(' | '));
console.log('崖宅岸点', villaCoast.map(f1).join(','), '| 剖面处崖顶', Math.round(sec.crestZ), 'm');
console.log('隧道:', TUNNELS.map(t => `${t.name} 出口(${f1(t.exit[0])},${f1(t.exit[1])}) 长 ${t.len.toFixed(2)} km`).join(' | '));
console.log(`西闸门 (${f1(WEST_GATE.pos[0])},${f1(WEST_GATE.pos[1])}) 隧道长 ${WEST_GATE.len.toFixed(2)} km`);
console.log(`剖面 x=${SECTION_X}: 南岸 y=${f1(sec.Y0)} 北岸 y=${f1(sec.Y1)} 湖 ${f1(sec.l0)}~${f1(sec.l1)}`);
console.log('北水道', channel.map(f1).join(','), '| 礁盘', reefs.filter(f => !f.head).length, '片, 珊瑚丛', reefs.filter(f => f.head).length, '处 | 发生器', gens.length, '座');

// ═════════ 三维数据导出(供 三维/ 目录下的 three.js 场景使用) ═════════
{
  const { mkdirSync } = await import('node:fs');
  const out3 = join(root, '三维', 'data');
  mkdirSync(out3, { recursive: true });
  const G = { x0: -3.3, y0: -2.2, step: 0.008, nx: 814, ny: 589 }; // 8 米网格,含周边浅海
  const N = G.nx * G.ny, top = CLIFF[CLIFF.length - 1][1];
  // 悬崖剖面的高度场版本:从正上方看到的最高面(岩鼻下方的悬空部分无法用高度场表示)
  const HF = [[0, 0], [12, 8], [22, 20], [29.5, 48], [45.5, 57], [53.8, 88], [73.8, 99.5], [79.8, 122], [84.8, 125], [85.2, 172], [88, 180], [96, 188], [110, 198], [135, 205], [165, top]];
  // 粗网格:到各类海岸的距离与就近崖高
  const CG = { x0: G.x0, y0: G.y0, step: 0.04, nx: Math.ceil(((G.nx - 1) * G.step) / 0.04) + 2, ny: Math.ceil(((G.ny - 1) * G.step) / 0.04) + 2 };
  const byKind = k => coast.filter(s => s.kind === k).map(s => s.p);
  const beachP = byKind('b'), rockP = byKind('r'), kP = byKind('k'), cP = byKind('c'), cliffAll = cliffS.map(s => s.p);
  const mk = () => new Float32Array(CG.nx * CG.ny);
  const gAll = mk(), gC = mk(), gK = mk(), gNo = mk(), gBe = mk(), gRk = mk(), gCr = mk();
  for (let j = 0; j < CG.ny; j++) for (let i = 0; i < CG.nx; i++) {
    const x = CG.x0 + i * CG.step, y = CG.y0 + j * CG.step, k = j * CG.nx + i;
    gAll[k] = Math.sqrt(dist2Pts(cliffAll, x, y)); gC[k] = Math.sqrt(dist2Pts(cP, x, y)); gK[k] = Math.sqrt(dist2Pts(kP, x, y));
    gNo[k] = Math.sqrt(dist2Pts(northPts, x, y)); gBe[k] = Math.sqrt(dist2Pts(beachP, x, y)); gRk[k] = Math.sqrt(dist2Pts(rockP, x, y));
    let hs = 0, ws = 0; for (const s of cliffS) { const d2 = (s.p[0] - x) ** 2 + (s.p[1] - y) ** 2, w = 1 / (d2 * d2 + 1e-7); ws += w; hs += w * s.hc; }
    gCr[k] = hs / ws;
  }
  const sAll = sampler(gAll, CG), sC = sampler(gC, CG), sK = sampler(gK, CG), sNo = sampler(gNo, CG), sBe = sampler(gBe, CG), sRk = sampler(gRk, CG), sCr = sampler(gCr, CG);
  // 到崖线线段的精确距离
  const segsOf = test => { const out = []; coast.forEach((s, i) => { const t = coast[(i + 1) % coast.length]; if (test(s.kind) && test(t.kind)) out.push([s.p[0], s.p[1], t.p[0], t.p[1]]); }); return out; };
  const segAll = segsOf(k => k === 'c' || k === 'k'), segC = segsOf(k => k === 'c');
  const dSeg = (segs, x, y) => { let m = Infinity, qx = x, qy = y; for (const [ax, ay, bx, by] of segs) { const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, u = l2 > 1e-12 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2) : 0, px = ax + u * vx, py = ay + u * vy, d = (x - px) ** 2 + (y - py) ** 2; if (d < m) { m = d; qx = px; qy = py; } } return [Math.sqrt(m), qx, qy]; };
  const toPx3 = p => [(p[0] - G.x0) / G.step + 0.5, (p[1] - G.y0) / G.step + 0.5];
  const land = scanMask(coastPts.map(toPx3), G.nx, G.ny), lakeM = scanMask(lakePts.map(toPx3), G.nx, G.ny), meadM = scanMask(meadowPts.map(toPx3), G.nx, G.ny), isletM = scanMask(isletPts.map(toPx3), G.nx, G.ny);
  const zf = new Float32Array(N), mat = new Uint8Array(N); // mat: 0 海底 1 丛林 2 草甸 3 沙滩 4 岩石 5 湖底 6 礁盘
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const x = G.x0 + i * G.step, y = G.y0 + j * G.step, k = j * G.nx + i;
    let z, m;
    if (lakeM[k]) { z = lakeLevel - Math.min(LAKE.depth, 0.6 + Math.sqrt(dist2Pts(lakePts, x, y)) * 110); m = 5; }
    else if (land[k]) {
      z = H(x, y); m = 1;
      if (sAll(x, y) < 0.45) {
        // 崖顶高度取崖线上最近点的高程:崖面按三段式剖面升到崖顶,崖顶之后再平缓过渡回内陆地形
        const [dd, qx, qy] = dSeg(segAll, x, y), se = (dd * 1000 * top) / Math.max(sCr(x, y), 6), hc = H(qx, qy);
        if (se < 165) { z = Math.max(0.4, (hc * lerpLine(HF, se)) / top); if (se < 150) { m = 4; z += 1.8 * fbm(x * 55, y * 55, 2) * Math.min(1, z / 6); } }
        else z += (hc - z) * (1 - sstep(165, 420, se));
      }
      if (meadM[k]) m = 2;
      else if (m === 1) { if (sBe(x, y) < 0.04 && z < 4.5) m = 3; else if (sRk(x, y) < 0.022 && z < 4) m = 4; }
    } else {
      const u = U(x, y), zShelf = u < 1 ? -(0.4 + 13.5 * Math.pow(u, 1.2)) : -Math.min(420, 13.9 + 330 * Math.pow(u - 1, 1.35));
      const dc = sC(x, y), dOther = Math.min(sNo(x, y), sK(x, y));
      z = zShelf; m = 0;
      if (dc < dOther + 0.14) { const d = dc < 0.3 ? dSeg(segC, x, y)[0] * 1000 : dc * 1000; z = zShelf + (lerpLine(APRON, -d) - zShelf) * sstep(-0.12, 0.08, dOther - dc); }
    }
    zf[k] = z; mat[k] = m;
  }
  // 礁盘与珊瑚丛:抬到接近水面
  for (const f of reefs) {
    const pts = blob(f, f.seed, 22, 1.5), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - G.x0) / G.step)), i1 = Math.min(G.nx - 1, Math.ceil((Math.max(...xs) - G.x0) / G.step));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - G.y0) / G.step)), j1 = Math.min(G.ny - 1, Math.ceil((Math.max(...ys) - G.y0) / G.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * G.nx + i, x = G.x0 + i * G.step, y = G.y0 + j * G.step;
      if (land[k] || !pip(pts, x, y)) continue;
      zf[k] = Math.max(zf[k], (f.head ? -1.7 : -0.7) - 0.7 * vnoise(x * 180, y * 180)); mat[k] = 6;
    }
  }
  // 东屿
  for (let k = 0; k < N; k++) if (isletM[k]) {
    const x = G.x0 + (k % G.nx) * G.step, y = G.y0 + Math.floor(k / G.nx) * G.step, c = Math.cos(-ISLET.rot), s = Math.sin(-ISLET.rot);
    const lx = (x - ISLET.x) * c - (y - ISLET.y) * s, ly = (x - ISLET.x) * s + (y - ISLET.y) * c, e = clamp((lx / ISLET.rx) ** 2 + (ly / ISLET.ry) ** 2);
    zf[k] = 1.2 + 21 * Math.pow(1 - e, 0.65) + 2 * fbm(x * 40, y * 40, 2); mat[k] = e > 0.72 ? 4 : 1;
  }
  const hm = new Int16Array(N); let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < N; k++) { hm[k] = Math.round(zf[k] * 10); if (zf[k] < zmin) zmin = zf[k]; if (zf[k] > zmax) zmax = zf[k]; }
  writeFileSync(join(out3, 'height.bin'), Buffer.from(hm.buffer));
  writeFileSync(join(out3, 'mat.bin'), Buffer.from(mat.buffer));
  // 地物
  const r4 = v => Math.round(v * 1e4) / 1e4, P2 = p => [r4(p[0]), r4(p[1])];
  const seaNormal = p => {
    let bi = 0, bd = Infinity; coast.forEach((s, i) => { const d = (s.p[0] - p[0]) ** 2 + (s.p[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
    const m = coast.length, a = coast[(bi - 5 + m) % m].p, b = coast[(bi + 5) % m].p;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if (onLand(p[0] + nx * 0.03, p[1] + ny * 0.03)) { nx = -nx; ny = -ny; }
    return [r4(nx), r4(ny)];
  };
  const meta = {
    version: '2.3', grid: G, heightScale: 0.1, lakeLevel, meadowLevel, peak: { x: r4(peak.x), y: r4(peak.y), h: Math.round(peak.h) },
    lake: lakePts.map(P2), meadow: meadowPts.map(P2), river: riverPts.map(P2), falls: FALLS, gullies: gullyPts.map(g => g.map(P2)), feeders: feederPts.map(g => g.map(P2)),
    villa: { p: P2(villaCoast), n: seaNormal(villaCoast) },
    tunnels: TUNNELS.map(t => ({ name: t.name, p: P2(t.exit), z: t.z, n: seaNormal(t.exit) })),
    westGate: { p: P2(WEST_GATE.pos), depth: WEST_GATE.depth, n: seaNormal(WEST_GATE.pos) },
    stacks: STACKS, buoys: gens.map(P2), camps: CAMPS, silos: SILOS, sally: SALLY, islet: ISLET,
    labels: [
      ...HEADLANDS.map(h => [h[0], h[1], h[2]]), ...HILLS.filter(h => h[4]).map(h => [h[4], h[0], h[1]]),
      ['风草甸', MEADOW.x, MEADOW.y], ['镜湖', LAKE.x, LAKE.y], ['帘瀑', FALLS[0], FALLS[1]], ['月湾', 0.3, 0.62], ['西岬', -1.12, 1.78], ['东岬', 1.5, 0.86],
      ['东屿', ISLET.x, ISLET.y], ['东峡谷', 1.18, -0.5], ['西裂谷', -0.95, -0.95], ['裂湾', 0.3, -0.95], ['东礁滩', 1.72, -0.42], ['西礁滩', -2.44, 0.06], ['北水道', r4(channel[0]), r4(channel[1])],
    ],
  };
  writeFileSync(join(out3, 'island.json'), JSON.stringify(meta), 'utf8');
  console.log(`三维数据: ${G.nx}×${G.ny} 网格, 高程 ${zmin.toFixed(0)} ~ ${zmax.toFixed(0)} m → 三维/data/`);
}
