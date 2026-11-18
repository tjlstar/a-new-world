// 生成草图.mjs — 按《岛屿设定.md》3.1 生成四张 SVG 草图、岛屿草图.html 与 三维/data/*
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

// ═════════ 基础数学与噪声 ═════════
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const r = (n, d = 1) => Number(n.toFixed(d));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (i, j, s = 1337) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x, y, s = 1337) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(i, j, s), hash2(i + 1, j, s), u), lerp(hash2(i, j + 1, s), hash2(i + 1, j + 1, s), u), v) * 2 - 1;
}
function fbm(x, y, oct = 4, s = 1337) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 97); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}
function ridged(x, y, oct = 3, s = 2777) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { const n = 1 - Math.abs(vnoise(x * f, y * f, s + o * 131)); sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.07; }
  return sum / norm;
}

function catmullClosed(pts, sub = 22) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const b0 = -0.5 * t3 + t2 - 0.5 * t, b1 = 1.5 * t3 - 2.5 * t2 + 1, b2 = -1.5 * t3 + 2 * t2 + 0.5 * t, b3 = 0.5 * t3 - 0.5 * t2;
      const row = [];
      for (let c = 0; c < p1.length; c++) row.push(p0[c] * b0 + p1[c] * b1 + p2[c] * b2 + p3[c] * b3);
      out.push(row);
    }
  }
  return out;
}
function pip(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}
function dist2Pts(pts, x, y) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) { const dx = pts[i][0] - x, dy = pts[i][1] - y, d = dx * dx + dy * dy; if (d < m) m = d; }
  return m;
}
function distSeg(ax, ay, bx, by, x, y) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
  const u = l2 > 1e-12 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2) : 0;
  return Math.hypot(x - (ax + u * vx), y - (ay + u * vy));
}
function distPolyLine(pts, x, y) {
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], x, y);
    if (d < m) m = d;
  }
  return m;
}
function lerpLine(line, s) {
  if (s <= line[0][0]) return line[0][1];
  for (let i = 0; i < line.length - 1; i++) {
    if (s <= line[i + 1][0]) return lerp(line[i][1], line[i + 1][1], (s - line[i][0]) / (line[i + 1][0] - line[i][0]));
  }
  return line[line.length - 1][1];
}
function blob(o, seed = 11, n = 48, wob = 1) {
  const out = [], c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rad = 1 + 0.14 * wob * fbm(Math.cos(a) * 1.9 + seed, Math.sin(a) * 1.9 - seed, 3, seed * 31 + 7);
    const lx = o.rx * rad * Math.cos(a), ly = o.ry * rad * Math.sin(a);
    out.push([o.x + lx * c - ly * s, o.y + lx * s + ly * c]);
  }
  return out;
}
function scanMask(polyPx, nx, ny) {
  const mask = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = j + 0.5, xs = [];
    for (let i = 0, k = polyPx.length - 1; i < polyPx.length; k = i++) {
      const [x0, y0] = polyPx[k], [x1, y1] = polyPx[i];
      if ((y0 > y) !== (y1 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const a = Math.max(0, Math.ceil(xs[m] - 0.5)), b = Math.min(nx - 1, Math.floor(xs[m + 1] - 0.5));
      for (let i = a; i <= b; i++) mask[j * nx + i] = 1;
    }
  }
  return mask;
}
function sampler(arr, G) {
  return (x, y) => {
    const fx = clamp((x - G.x0) / G.step, 0, G.nx - 1.001), fy = clamp((y - G.y0) / G.step, 0, G.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, w = G.nx;
    return lerp(lerp(arr[j * w + i], arr[j * w + i + 1], tx), lerp(arr[(j + 1) * w + i], arr[(j + 1) * w + i + 1], tx), ty);
  };
}
function marchSquares(arr, G, level) {
  const segs = [], w = G.nx;
  const P = (i, j) => [G.x0 + i * G.step, G.y0 + j * G.step];
  const E = (p0, p1, v0, v1) => { const t = clamp((level - v0) / (v1 - v0 + 1e-12)); return [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)]; };
  for (let j = 0; j < G.ny - 1; j++) for (let i = 0; i < G.nx - 1; i++) {
    const v0 = arr[j * w + i], v1 = arr[j * w + i + 1], v2 = arr[(j + 1) * w + i + 1], v3 = arr[(j + 1) * w + i];
    const m = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0);
    if (m === 0 || m === 15) continue;
    const p0 = P(i, j), p1 = P(i + 1, j), p2 = P(i + 1, j + 1), p3 = P(i, j + 1);
    const e0 = E(p0, p1, v0, v1), e1 = E(p1, p2, v1, v2), e2 = E(p3, p2, v3, v2), e3 = E(p0, p3, v0, v3);
    const tbl = { 1: [[e3, e0]], 2: [[e0, e1]], 3: [[e3, e1]], 4: [[e1, e2]], 5: [[e3, e2], [e0, e1]], 6: [[e0, e2]], 7: [[e3, e2]], 8: [[e2, e3]], 9: [[e0, e2]], 10: [[e0, e3], [e1, e2]], 11: [[e1, e2]], 12: [[e1, e3]], 13: [[e0, e1]], 14: [[e3, e0]] };
    for (const s of tbl[m]) segs.push(s);
  }
  // 拼接折线
  const key = p => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)}`;
  const adj = new Map();
  segs.forEach((s, idx) => {
    for (const end of [0, 1]) { const k = key(s[end]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push([idx, end]); }
  });
  const used = new Uint8Array(segs.length), lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      while (true) {
        const cur = dir ? line[line.length - 1] : line[0];
        const hits = adj.get(key(cur)) || [];
        let found = false;
        for (const [si, ei] of hits) {
          if (used[si]) continue;
          used[si] = 1;
          const nxt = segs[si][1 - ei];
          if (dir) line.push(nxt); else line.unshift(nxt);
          found = true; break;
        }
        if (!found) break;
      }
    }
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

// ═════════ 1. 岛形与岸线 (3.1 版 31 控制点, 顺时针) ═════════
// [x, y, 崖高m, 类型] 类型: 'c' 绝壁深潜崖, 'k' 崩积黑岩礁滩, 'r' 峡湾陡岩壁, 'b' 黑曜石砾滩
const CTRL = [
  [-1.85,  0.20,  15, 'k'], // 1 西端, 黑岩礁石滩
  [-1.72,  0.72,  90, 'r'], // 2 陡峭岩岸, 其后有小砾滩
  [-1.45,  1.05, 160, 'c'], // 3 岩岸绝壁 160m
  [-1.18,  1.42, 190, 'c'], // 4 西岬外侧, 190m
  [-0.88,  1.65, 210, 'c'], // 5 西岬尖, 210m
  [-0.68,  1.45, 175, 'r'], // 6 西岬尖内侧
  [-0.78,  1.05, 165, 'r'], // 7 西岬内侧陡壁
  [-0.55,  0.72, 135, 'r'], // 8 黑砾湾西壁崖脚
  [-0.25,  0.45,   4, 'b'], // 9 黑砾湾西段(黑曜石砾滩)
  [ 0.10,  0.42,   3, 'b'], // 10 黑砾湾湾底, 悬瀑入海口
  [ 0.45,  0.55, 135, 'r'], // 11 黑砾湾东壁崖脚
  [ 0.72,  0.85, 240, 'c'], // 12 东岬陡崖 240m
  [ 1.02,  0.80, 220, 'c'], // 13 东岬尖, 海蚀拱门西座
  [ 1.25,  0.45, 260, 'c'], // 14 一线天水道西壁, 260m
  [ 1.38,  0.10, 280, 'c'], // 15 一线天水道中段, 280m
  [ 1.42, -0.10,  14, 'k'], // 16 东礁滩, 崩积礁石平台
  [ 1.32, -0.25, 220, 'c'], // 17 一线天水道西壁南口, 220m
  [ 1.18, -0.58,  15, 'k'], // 18 东峡谷谷口, 乱石滩
  [ 0.92, -1.05, 290, 'c'], // 19 东南崖角, 290m
  [ 0.62, -0.90, 280, 'c'], // 20 悬崖 280m
  [ 0.44, -1.02, 320, 'c'], // 21 裂湾东口, 320m
  [ 0.22, -0.72, 280, 'c'], // 22 裂湾湾顶, 280m
  [ 0.04, -0.98, 380, 'c'], // 23 裂湾西壁, 380m
  [-0.22, -1.25, 460, 'c'], // 24 主崖岬, 460m
  [-0.55, -1.08, 390, 'c'], // 25 悬崖 390m
  [-0.82, -0.68, 270, 'c'], // 26 西裂谷谷顶, 270m
  [-1.12, -0.92, 310, 'c'], // 27 悬崖 310m
  [-1.45, -1.02, 340, 'c'], // 28 西崖角, 340m
  [-1.68, -0.62, 240, 'c'], // 29 悬崖 240m, 西闸门在此崖下
  [-1.82, -0.28, 130, 'c'], // 30 悬崖 130m
  [-1.88, -0.05,  12, 'k'], // 31 西礁滩, 乱石礁盘
];

const SUB = 24;
const rawCoast = catmullClosed(CTRL.map(p => [p[0], p[1], p[2]]), SUB);
const coast = rawCoast.map((pt, idx) => {
  const ci = Math.floor(idx / SUB);
  const kind = CTRL[(ci + (idx % SUB > SUB * 0.55 ? 1 : 0)) % CTRL.length][3];
  const prev = rawCoast[(idx - 1 + rawCoast.length) % rawCoast.length];
  const next = rawCoast[(idx + 1) % rawCoast.length];
  let nx = next[1] - prev[1], ny = -(next[0] - prev[0]);
  const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
  // 在一线天水道 (ci 13..16) 与黑砾湾底 (ci 8..10) 减小法向扰动, 保证海峡宽度精准为 100~130 米
  const narrow = (ci >= 12 && ci <= 16) || (ci >= 8 && ci <= 10) || ci === 23;
  const amp = narrow ? 0.012 : 0.032;
  const d = amp * fbm(pt[0] * 4.2 + 7.1, pt[1] * 4.2 - 3.4, 3, 901) + 0.008 * vnoise(pt[0] * 17, pt[1] * 17, 902);
  return { p: [pt[0] + nx * d, pt[1] + ny * d], hc: Math.max(2, pt[2]), kind };
});
const coastPts = coast.map(s => s.p);
const cliffS = coast.filter(s => s.kind === 'c' || s.kind === 'r');
const northPts = coast.filter(s => s.kind === 'b' || s.kind === 'r').map(s => s.p);

// 东屿: 锯齿状孤绝副岛, 中心 (1.65, 0.15), 长 ~550m, 宽 ~260m, 锯齿脊高达 280m
// 西岸约在 x = 1.50~1.52, 与主岛东岸 x = 1.38~1.40 形成 110~130m 宽的一线天水道
const ISLET = { x: 1.65, y: 0.15, rx: 0.132, ry: 0.285, rot: -0.14, h: 280 };
const isletPts = (() => {
  const out = [], n = 64, c = Math.cos(ISLET.rot), s = Math.sin(ISLET.rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const wob = 1 + 0.09 * fbm(Math.cos(a) * 2.6 + 5, Math.sin(a) * 2.6 - 3, 3, 551) + 0.04 * Math.sin(a * 5);
    const lx = ISLET.rx * wob * Math.cos(a), ly = ISLET.ry * wob * Math.sin(a);
    out.push([ISLET.x + lx * c - ly * s, ISLET.y + lx * s + ly * c]);
  }
  return out;
})();

// 天然玄武岩海蚀拱门: 横跨一线天水道北口 (东岬南侧 ~(1.21, 0.48) ↔ 东屿北脊 ~(1.56, 0.37)), 拱顶高约 105m
const SEA_ARCH = { a: [1.22, 0.47], b: [1.55, 0.36], crownZ: 106, clearZ: 68, width: 28 };

// 外海海蚀剑峰 (南剑峰 260m, 底宽 <120m) 及附属海蚀黑石柱
const SWORD_PEAK = { name: '南剑峰', x: 0.15, y: -1.62, r: 0.055, h: 260 };
const STACKS = [
  [0.15, -1.62, 260, 0.055, '南剑峰'],
  [0.26, -1.56,  68, 0.022, ''],
  [-0.34, -1.36, 46, 0.018, ''],
  [-1.56, -1.12, 54, 0.020, ''],
  [ 1.05, -1.16, 48, 0.019, ''],
  [ 1.72,  0.52, 62, 0.021, ''],
];

const onMainLand = (x, y) => pip(coastPts, x, y);
const onIslet = (x, y) => pip(isletPts, x, y);
const onLand = (x, y) => onMainLand(x, y) || onIslet(x, y);

// 计算主岛+东屿面积与范围
let ext = [Infinity, -Infinity, Infinity, -Infinity];
for (const p of [...coastPts, ...isletPts]) {
  if (p[0] < ext[0]) ext[0] = p[0]; if (p[0] > ext[1]) ext[1] = p[0];
  if (p[1] < ext[2]) ext[2] = p[1]; if (p[1] > ext[3]) ext[3] = p[1];
}
const polyArea = pts => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(s) * 0.5;
};
const area = polyArea(coastPts) + polyArea(isletPts);

// ═════════ 2. 破火山口盆地、刀刃山脊与尖塔群地形 (3.1 版) ═════════
const lakeLevel = 138;
const meadowLevel = 165;

const LAKE = { x: -0.42, y: -0.02, rx: 0.255, ry: 0.165, rot: 0.22, depth: 24 };
const lakePts = blob(LAKE, 19, 64, 0.95);

const MEADOW = { x: -0.25, y: -0.68, rx: 0.215, ry: 0.122, rot: -0.10 };
const meadowPts = blob(MEADOW, 31, 56, 0.75);

const FALLS = [0.10, 0.22]; // 火山口北缘崩塌缺口, 帘瀑 ~90m 落差
const riverPts = [
  [-0.17, 0.03], [-0.10, 0.07], [-0.03, 0.12], [0.04, 0.17], [0.10, 0.22], [0.10, 0.33], [0.10, 0.42],
];
// 汇入镜湖与风草甸的山涧溪流
const feederPts = [
  [[-0.86, -0.35], [-0.72, -0.22], [-0.58, -0.10]],
  [[-0.68, 0.42], [-0.58, 0.24], [-0.50, 0.11]],
  [[-0.25, -0.54], [-0.31, -0.34], [-0.36, -0.17]],
];
// 东峡谷与西裂谷冲沟线
const gullyPts = [
  [[0.95, -0.18], [1.03, -0.32], [1.11, -0.45], [1.18, -0.58]], // 东峡谷断裂槽
  [[-0.75, -0.52], [-0.79, -0.60], [-0.82, -0.68]],              // 西裂谷上源
  [[0.18, -0.56], [0.20, -0.64], [0.22, -0.72]],                 // 裂湾上源
];

// 马蹄形刀刃山脊折线: [x, y, 脊顶高程m, 横向半宽km]
const RIM_SPINE = [
  [-0.88,  1.62, 210, 0.20], // 西岬北端
  [-1.08,  1.15, 215, 0.24], // 西岬中段
  [-1.32,  0.52, 245, 0.28], // 西北脊
  [-1.25, -0.42, 352, 0.26], // 西尖塔底座脊
  [-1.40, -0.94, 340, 0.22], // 西崖角
  [-0.92, -0.78, 330, 0.20], // 西裂谷绕脊
  [-0.52, -1.00, 412, 0.17], // 主崖西肩
  [-0.22, -1.13, 456, 0.15], // 主崖岬刀刃主脊 (距南岸 120m 达 460m 绝顶!)
  [ 0.04, -0.90, 385, 0.17], // 裂湾西肩
  [ 0.24, -0.64, 295, 0.18], // 裂湾北绕脊
  [ 0.45, -0.92, 322, 0.19], // 裂湾东口脊
  [ 0.86, -0.95, 290, 0.22], // 东南崖角
  [ 0.95, -0.18, 122, 0.20], // 东峡谷分水鞍部 (断裂低鞍 ~115m)
  [ 0.68, -0.25, 298, 0.23], // 东尖塔底座脊
  [ 1.24,  0.14, 276, 0.20], // 一线天西壁高脊
  [ 0.94,  0.74, 232, 0.20], // 东岬尖脊
  [ 0.60,  0.68, 195, 0.18], // 黑砾湾东肩
];

// 黑色玄武岩尖塔与岬角高峰: [x, y, 拔起高度增量, 半径km, 名称, 标称海拔]
const SPIRES = [
  [-0.22, -1.13, 24, 0.095, '主崖岬',   460],
  [-1.25, -0.42, 42, 0.105, '西尖塔',   365],
  [ 0.68, -0.25, 38, 0.095, '东尖塔',   310],
  [-1.39, -0.94, 22, 0.090, '西崖角',   340],
  [ 0.86, -0.95, 20, 0.090, '东南崖角', 290],
  [-0.88,  1.56, 18, 0.085, '西岬',     210],
  [ 0.95,  0.75, 18, 0.080, '东岬',     220],
];

const HEADLANDS = [
  ['主崖岬', -0.22, -1.25, 460],
  ['西崖角', -1.45, -1.02, 340],
  ['东南崖角', 0.92, -1.05, 290],
];

function rimField(x, y) {
  let wSum = 0, hSum = 0, dMin = Infinity, wAtMin = 0.2;
  for (let i = 0; i < RIM_SPINE.length - 1; i++) {
    const a = RIM_SPINE[i], b = RIM_SPINE[i + 1];
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    const u = l2 > 1e-12 ? clamp(((x - a[0]) * vx + (y - a[1]) * vy) / l2) : 0;
    const px = a[0] + u * vx, py = a[1] + u * vy;
    const d = Math.hypot(x - px, y - py);
    const hz = lerp(a[2], b[2], u), hw = lerp(a[3], b[3], u);
    const wt = Math.exp(-((d / hw) ** 2) * 1.9) + 1e-5 / (d * d + 0.02);
    wSum += wt; hSum += wt * hz;
    if (d < dMin) { dMin = d; wAtMin = hw; }
  }
  return { h: hSum / wSum, d: dMin, w: wAtMin };
}

function H(x, y) {
  // 东屿独立高程 (锯齿状山脊高达 280m)
  if (onIslet(x, y)) {
    const c = Math.cos(-ISLET.rot), s = Math.sin(-ISLET.rot);
    const lx = (x - ISLET.x) * c - (y - ISLET.y) * s;
    const ly = (x - ISLET.x) * s + (y - ISLET.y) * c;
    const ridge = Math.max(0, 1 - Math.abs(lx) / (ISLET.rx * 0.98));
    const endFade = Math.max(0, 1 - (ly / (ISLET.ry * 1.03)) ** 2);
    const saw = 0.84 + 0.22 * ridged(lx * 14 + 3, ly * 11 - 2, 3, 701);
    return Math.max(2, 282 * Math.pow(ridge, 0.72) * Math.pow(endFade, 0.48) * saw);
  }

  const rf = rimField(x, y);
  // 刀刃山脊隆起
  const ridgeProfile = Math.exp(-((rf.d / (rf.w * 1.18)) ** 1.75));
  let z = 148 + (rf.h - 148) * ridgeProfile;

  // 叠加柱状节理折线感与嶙峋山脊噪声
  z += (14 * ridged(x * 3.4, y * 3.4, 3, 401) - 5) * clamp((z - 155) / 140);
  z += 5.5 * fbm(x * 7.5, y * 7.5, 3, 409);

  // 破火山口巨碗内部下凹 (镜湖 138m + 风草甸 165m)
  const bx = (x - (-0.34)) / 0.62, by = (y - (-0.28)) / 0.76;
  const bowl = sstep(1.18, 0.35, Math.hypot(bx, by));
  const bowlFloor = lerp(140, 168, clamp((-0.18 - y) / 0.52)) + 3.5 * fbm(x * 5, y * 5, 2, 512);
  z = lerp(z, bowlFloor, bowl * 0.90);

  // 风草甸平坦火山灰台地 (~165m)
  const mx = ((x - MEADOW.x) * Math.cos(-MEADOW.rot) - (y - MEADOW.y) * Math.sin(-MEADOW.rot)) / MEADOW.rx;
  const my = ((x - MEADOW.x) * Math.sin(-MEADOW.rot) + (y - MEADOW.y) * Math.cos(-MEADOW.rot)) / MEADOW.ry;
  const mMask = sstep(1.32, 0.72, Math.hypot(mx, my));
  z = lerp(z, meadowLevel + 1.2 * fbm(x * 9, y * 9, 2, 611), mMask * 0.96);

  // 镜湖碗底凹陷 (岸边 138.5m)
  const lx = ((x - LAKE.x) * Math.cos(-LAKE.rot) - (y - LAKE.y) * Math.sin(-LAKE.rot)) / LAKE.rx;
  const ly = ((x - LAKE.x) * Math.sin(-LAKE.rot) + (y - LAKE.y) * Math.cos(-LAKE.rot)) / LAKE.ry;
  const lDist = Math.hypot(lx, ly);
  const lMask = sstep(1.45, 0.96, lDist);
  z = lerp(z, lakeLevel + 0.8, lMask * 0.97);

  // 白水河玄武岩槽 (138m → 帘瀑顶 132m) 与北缘崩塌缺口 -> 黑砾湾峡湾谷底 (0m)
  const dRiv = distPolyLine(riverPts.slice(0, 5), x, y);
  const rivMask = sstep(0.11, 0.02, dRiv);
  const rivProg = clamp((x - (-0.17)) / 0.27);
  z = lerp(z, lerp(138.2, 130.0, rivProg), rivMask * 0.92);

  // 帘瀑北侧至黑砾湾湾底: 从 (0.10, 0.22) 陡跌近百米至深潭与黑曜石砾滩
  const fx = (x - 0.02) / 0.42, fy = (y - 0.50) / 0.34;
  if (y > 0.16 && Math.abs(x - 0.02) < 0.52) {
    const fjord = sstep(1.15, 0.35, Math.hypot(fx, (y - 0.48) / 0.30));
    const stepDrop = sstep(0.18, 0.28, y); // 在 y=0.22 处急剧跌落 ~90m
    const gorgeFloor = lerp(130, 8, stepDrop) * (1 - 0.75 * sstep(0.32, 0.44, y));
    z = lerp(z, gorgeFloor, fjord * 0.95);
  }

  // 东峡谷古断裂深槽: 分水鞍部 (0.95,-0.18, ~115m) → 谷口 (1.18,-0.58, ~8m)
  const dEastGully = distPolyLine(gullyPts[0], x, y);
  if (dEastGully < 0.22) {
    const tG = clamp(((x - 0.95) * 0.23 + (y - (-0.18)) * (-0.40)) / (0.23 * 0.23 + 0.40 * 0.40));
    const gFloor = lerp(114, 10, Math.pow(tG, 0.85));
    z = lerp(z, gFloor, sstep(0.20, 0.025, dEastGully) * 0.92);
  }

  // 黑色玄武岩尖塔刺出
  for (const [sx, sy, sh, sr, , targetH] of SPIRES) {
    const d = Math.hypot(x - sx, y - sy);
    if (d < sr * 2.2) {
      const cone = Math.pow(Math.max(0, 1 - d / (sr * 1.85)), 1.55);
      z += sh * cone;
      if (d < sr * 0.55) z = lerp(z, targetH, Math.pow(1 - d / (sr * 0.55), 1.3) * 0.88);
    }
  }

  return Math.max(1.5, z);
}

// 扫描全岛最高点
let peak = { x: -0.22, y: -1.21, h: 0 };
for (let y = -1.35; y <= 1.70; y += 0.01) {
  for (let x = -1.95; x <= 1.82; x += 0.01) {
    if (!onLand(x, y) || pip(lakePts, x, y)) continue;
    const h = H(x, y);
    if (h > peak.h) peak = { x, y, h };
  }
}

// ═════════ 3. 基地设施、隧道、礁盘与幻域浮标 (3.1 版) ═════════
// 崖宅岸线锚点: 主崖岬绝壁正南
const villaCoast = (() => {
  let best = [-0.22, -1.25], bd = Infinity;
  for (const s of coast) {
    const d = (s.p[0] - (-0.22)) ** 2 + (s.p[1] - (-1.25)) ** 2;
    if (d < bd) { bd = d; best = s.p; }
  }
  return best;
})();

// 岩隙营房 (唯一地面营区, 约 100 名作战人员, 镜湖西侧背风峡谷岩壁褶皱内)
const CAMPS = [
  [-0.85, 0.15, '岩隙营房'],
];
// 四处峡谷/峡湾出击暗门 + 帘瀑水帘暗门
const SALLY = [
  [-0.96,  0.34], // 西峡谷岩壁暗门
  [-0.50,  0.64], // 黑砾湾西壁暗门
  [ 0.42,  0.52], // 黑砾湾东壁暗门
  [ 1.07, -0.38], // 东峡谷岩壁暗门
];
// 风草甸草皮下三座机库顶部垂直发射井
const SILOS = [
  [-0.36, -0.70],
  [-0.25, -0.66],
  [-0.14, -0.71],
];
// 机库中心 (风草甸下方, 主崖后方 420-760m)
const HANGAR_C = [-0.25, -0.68];

const snapCoast = target => {
  let best = target, bd = Infinity;
  for (const s of coast) {
    const d = (s.p[0] - target[0]) ** 2 + (s.p[1] - target[1]) ** 2;
    if (d < bd) { bd = d; best = s.p; }
  }
  return best;
};

// 三条水平电磁弹射隧道 (海拔 95m / 100m / 90m)
const TUNNELS = [
  { name: '南发射口', start: [-0.25, -0.80], exit: snapCoast([-0.25, -1.25]), z: 95 },
  { name: '西发射口', start: [-0.42, -0.68], exit: snapCoast([-0.82, -0.69]), z: 100 },
  { name: '东发射口', start: [-0.10, -0.68], exit: snapCoast([ 0.22, -0.74]), z: 90 },
].map(t => ({ ...t, len: Math.hypot(t.exit[0] - t.start[0], t.exit[1] - t.start[1]) }));

// 两座潜艇水下闸门
const MAIN_GATE = { pos: [villaCoast[0], villaCoast[1] - 0.08], depth: -80, len: 0.35 };
const WEST_GATE = (() => {
  const pos = snapCoast([-1.69, -0.63]);
  const wp = [-0.82, -0.52], port = [-0.32, -0.78];
  const len = Math.hypot(pos[0] - wp[0], pos[1] - wp[1]) + Math.hypot(wp[0] - port[0], wp[1] - port[1]);
  return { pos, wp, port, depth: -60, len };
})();

// 北侧黑砾湾外暗礁带与水下礁盘 (300-600m 外海 + 西岬外缘), 留出 (-0.15, 0.95) 深水曲折航道槽
const channel = [-0.15, 0.95];
const channelPath = [[-0.22, 1.48], [-0.15, 0.95], [-0.06, 0.66], [0.02, 0.47]];
const reefs = (() => {
  const rng = mulberry32(3107), out = [];
  const candidates = [
    [-0.46, 0.96, 0.09, 0.05, 0.3, false],
    [-0.36, 1.18, 0.08, 0.05, -0.2, false],
    [ 0.14, 0.88, 0.10, 0.055, 0.2, false],
    [ 0.36, 1.04, 0.09, 0.05, -0.3, false],
    [ 0.05, 1.16, 0.08, 0.045, 0.4, false],
    [ 0.58, 1.08, 0.085, 0.048, 0.1, false],
    [-0.62, 1.24, 0.075, 0.045, 0.5, false],
    [-1.08, 1.78, 0.09, 0.05, -0.4, false],
    [-1.42, 1.38, 0.08, 0.045, 0.3, false],
    [-1.65, 1.02, 0.07, 0.04, -0.2, false],
    [ 0.88, 1.04, 0.075, 0.042, 0.2, false],
    // 小型暗礁丛/远古人工共生礁头
    [-0.30, 0.80, 0.035, 0.028, 0, true],
    [ 0.24, 0.72, 0.036, 0.026, 0.4, true],
    [ 0.02, 0.98, 0.032, 0.025, -0.3, true],
    [-0.54, 1.08, 0.034, 0.026, 0.2, true],
    [ 0.48, 0.92, 0.033, 0.025, -0.1, true],
    [-1.28, 1.62, 0.036, 0.028, 0.1, true],
  ];
  candidates.forEach((c, idx) => {
    if (distPolyLine(channelPath, c[0], c[1]) < 0.085) return;
    out.push({ x: c[0], y: c[1], rx: c[2], ry: c[3], rot: c[4], head: c[5], seed: 40 + idx * 7 + Math.floor(rng() * 5) });
  });
  return out;
})();

// 幻域浮标: 13 座不规则散布在岛外 2~3.1 km 洋面上
const gens = (() => {
  const rng = mulberry32(9031), out = [], n = 13;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rng() - 0.5) * 0.26;
    const rad = 2.15 + rng() * 0.55;
    out.push([r(Math.cos(a) * rad * 1.12 - 0.10, 3), r(Math.sin(a) * rad * 0.96 + 0.12, 3)]);
  }
  return out;
})();

// 外海等深归一化函数 U(x,y): 南东深潜崖极陡, 北侧黑砾湾外略缓形成暗礁架
function U(x, y) {
  const dMain = Math.sqrt(dist2Pts(coastPts, x, y));
  const dIsl = Math.sqrt(dist2Pts(isletPts, x, y));
  const d = Math.min(dMain, dIsl);
  const northShelf = y > 0.35 && x > -1.65 && x < 1.05 ? 0.52 : 0.14;
  return d / northShelf;
}

// ═════════ 4. 主崖岬三段式剖面与深潜崖水下坡面 (3.1 版, 0 → 460m) ═════════
// s 为从海岸基点向岛内水平距离 (m), z 为海拔 (m)
// 底层 0~+40m 崩积巨石裙与陡坎; 中层 +40~+250m 约 65° 阶梯玄武岩壁 (80°陡坎 + 8~15m 碎石窄台);
// 上层 +250~+460m 近乎垂直的柱状节理绝壁 (+410~+445m 平直岩槽嵌崖宅, +445~+460m 刀刃山脊)
const CLIFF = [
  [  0,   0],
  [ 10,  14],
  [ 18,  40], // 底层顶 +40m
  [ 28,  92],
  [ 38,  98], // 窄台 1 (10m 宽, 南发射口 +95m 在此段陡壁)
  [ 50, 158],
  [ 61, 165], // 窄台 2 (11m 宽)
  [ 74, 238],
  [ 84, 250], // 中层顶 +250m
  [ 92, 335], // 上层柱状节理绝壁
  [ 97, 410], // 崖宅底部锚固岩槽下缘 +410m
  [100, 442], // 崖宅顶缘肩部 +442m (平直陡峭岩槽)
  [112, 456],
  [124, 460], // 刀刃山脊绝顶 +460m
];
// 深潜崖水下剖面 (s <= 0, 离岸 120m 深 -180m, 300m 外深 -350m, 1000m 外深 -750m)
const APRON = [
  [-1000, -760],
  [ -600, -540],
  [ -300, -350],
  [ -120, -180],
  [  -45,  -82], // 主闸门 -80m 藏在此处崩积巨石裙下
  [  -18,  -40],
  [    0,    0],
];

// ═════════ 5. 公共 SVG 样式与辅助函数 ═════════
const FONT = `'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif`;
const C = {
  ink: '#1a252e',
  sub: '#485966',
  seaDeep: '#9eb8c9',
  seaMid: '#b5ccd9',
  seaShallow: '#cbe0ea',
  strait: '#87a6ba',
  forest: '#6b8568',
  forestHigh: '#829978',
  meadow: '#b7c78f',
  basalt: '#6e737a',
  basaltDark: '#474c53',
  obsidian: '#3d434a',
  lake: '#4d7f94',
  hull: '#435361',
  chamber: '#e5dfd3',
  tunnel: '#9e4733',
  titanium: '#8e9ba6',
  titaniumLight: '#b8c4ce',
  glass: '#253846',
  amber: '#e9a94c',
};

const BASE_CSS = `
  text { font-family: ${FONT}; fill: ${C.ink}; }
  .title { font-size: 16px; font-weight: 700; }
  .sub { font-size: 11.5px; fill: ${C.sub}; }
  .t { font-size: 12.5px; }
  .s { font-size: 11px; }
  .xs { font-size: 9.8px; fill: ${C.sub}; }
  .b { font-weight: 700; }
  .mid { text-anchor: middle; }
  .end { text-anchor: end; }
  .halo { paint-order: stroke; stroke: rgba(255,255,255,.86); stroke-width: 3.2px; stroke-linejoin: round; }
  .dhalo { paint-order: stroke; stroke: rgba(226,236,242,.88); stroke-width: 3px; stroke-linejoin: round; }
  .whalo { fill: #f3f7fa; paint-order: stroke; stroke: rgba(20,30,38,.85); stroke-width: 3px; stroke-linejoin: round; }
`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const txt = (x, y, s, cls = 's') => `<text x="${r(x)}" y="${r(y)}" class="${cls}">${esc(s)}</text>`;
const pathPts = (pts, close = false) => 'M' + pts.map(p => `${r(p[0])},${r(p[1])}`).join('L') + (close ? 'Z' : '');

// ═════════ 图 1: 平面图 (planSVG) ═════════
function planSVG() {
  const W = 960, Hh = 740, FX = 56, FY = 58, FW = 848, FH = 620;
  // 视野涵盖幻域浮标圈: x ∈ [-3.05, 3.05] (6.1 km), y ∈ [-2.15, 2.30] (4.45 km) -> 等比例
  const xMin = -3.05, xMax = 3.05, yMin = -2.12, yMax = 2.33;
  const k = Math.min(FW / (xMax - xMin), FH / (yMax - yMin));
  const ox = FX + (FW - (xMax - xMin) * k) * 0.5;
  const oy = FY + (FH - (yMax - yMin) * k) * 0.5;
  const X = x => ox + (x - xMin) * k;
  const Y = y => oy + (yMax - y) * k;
  const P = p => [X(p[0]), Y(p[1])];

  // 计算地形网格用于提取等高线
  const Gp = { x0: -2.05, y0: -1.40, step: 0.018, nx: 220, ny: 178 };
  const hg = new Float32Array(Gp.nx * Gp.ny);
  for (let j = 0; j < Gp.ny; j++) for (let i = 0; i < Gp.nx; i++) {
    const x = Gp.x0 + i * Gp.step, y = Gp.y0 + j * Gp.step;
    hg[j * Gp.nx + i] = onLand(x, y) ? H(x, y) : -20;
  }

  // 外海深潜等深线网格
  const Gs = { x0: xMin, y0: yMin, step: 0.045, nx: 138, ny: 101 };
  const sg = new Float32Array(Gs.nx * Gs.ny);
  for (let j = 0; j < Gs.ny; j++) for (let i = 0; i < Gs.nx; i++) {
    const x = Gs.x0 + i * Gs.step, y = Gs.y0 + j * Gs.step;
    if (onLand(x, y)) { sg[j * Gs.nx + i] = 10; continue; }
    const d = Math.min(Math.sqrt(dist2Pts(coastPts, x, y)), Math.sqrt(dist2Pts(isletPts, x, y))) * 1000;
    const shelf = y > 0.35 && x > -1.6 && x < 1.0 ? 0.42 : 1.0;
    sg[j * Gs.nx + i] = lerpLine(APRON, -d * shelf);
  }

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">`);
  o.push(`<defs>
    <style>${BASE_CSS}</style>
    <clipPath id="frame1"><rect x="${FX}" y="${FY}" width="${FW}" height="${FH}"/></clipPath>
    <clipPath id="landClip"><path d="${pathPts(coastPts.map(P), true)} ${pathPts(isletPts.map(P), true)}"/></clipPath>
    <radialGradient id="oceanGrad" cx="48%" cy="48%" r="65%">
      <stop offset="0%" stop-color="${C.seaMid}"/>
      <stop offset="65%" stop-color="${C.seaDeep}"/>
      <stop offset="100%" stop-color="#8aa7ba"/>
    </radialGradient>
  </defs>`);

  o.push(`<rect width="${W}" height="${Hh}" fill="#f5f7f8"/>`);
  o.push(txt(FX, 28, '岛屿基地 · 平面总图 (3.1 版)', 'title'));
  o.push(txt(FX, 46, '半崩塌破火山口巨碗 · 460 米刀刃主峰 · 黑砾湾峡湾 · 一线天水道与东屿 · 外海幻域浮标环', 'sub'));

  o.push(`<g clip-path="url(#frame1)">`);
  o.push(`<rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" fill="url(#oceanGrad)"/>`);

  // 北侧暗礁架浅水晕染
  o.push(`<ellipse cx="${r(X(-0.05))}" cy="${r(Y(0.88))}" rx="${r(0.95 * k)}" ry="${r(0.52 * k)}" fill="${C.seaShallow}" opacity="0.55"/>`);

  // 水下等深线 (-180m, -350m, -600m)
  for (const [dep, op] of [[-180, 0.36], [-350, 0.28], [-600, 0.20]]) {
    const lines = marchSquares(sg, Gs, dep);
    for (const ln of lines) o.push(`<path d="${pathPts(ln.map(P))}" fill="none" stroke="#4f6d80" stroke-width="0.8" stroke-dasharray="4 3" opacity="${op}"/>`);
  }

  // 幻域中环示意场边界与浮标
  const hullLoop = catmullClosed(gens.map(g => [g[0], g[1]]), 10);
  o.push(`<path d="${pathPts(hullLoop.map(P), true)}" fill="none" stroke="#4f6b7d" stroke-width="1.1" stroke-dasharray="7 5" opacity="0.65"/>`);
  for (const g of gens) {
    o.push(`<circle cx="${r(X(g[0]))}" cy="${r(Y(g[1]))}" r="3.1" fill="#2c3e4c" stroke="#eef4f7" stroke-width="1"/>`);
  }

  // 北侧水下暗礁盘与深水曲折航道
  for (const rf of reefs) {
    const bp = blob(rf, rf.seed, 24, 1.1).map(P);
    o.push(`<path d="${pathPts(bp, true)}" fill="${rf.head ? '#687e83' : '#7f9ba3'}" stroke="#536b73" stroke-width="0.7" opacity="0.82"/>`);
  }
  o.push(`<path d="${pathPts(channelPath.map(P))}" fill="none" stroke="#2d5870" stroke-width="1.6" stroke-dasharray="5 3"/>`);

  // 主岛与东屿底色 (云雾林)
  o.push(`<path d="${pathPts(coastPts.map(P), true)}" fill="${C.forest}"/>`);
  o.push(`<path d="${pathPts(isletPts.map(P), true)}" fill="${C.forest}"/>`);

  // 岛内高程分层设色 (剪裁于陆地内)
  o.push(`<g clip-path="url(#landClip)">`);
  for (const [lv, col, op] of [[220, C.forestHigh, 0.72], [290, '#7c7e78', 0.85], [350, C.basalt, 0.92], [410, C.basaltDark, 0.95]]) {
    for (const ln of marchSquares(hg, Gp, lv)) {
      if (ln.length > 6) o.push(`<path d="${pathPts(ln.map(P), true)}" fill="${col}" opacity="${op}"/>`);
    }
  }
  // 风草甸火山灰台地
  o.push(`<path d="${pathPts(meadowPts.map(P), true)}" fill="${C.meadow}" stroke="#7f8f5e" stroke-width="0.9"/>`);
  // 黑砾湾黑曜石砾滩
  const beachSeg = coast.filter(s => s.kind === 'b').map(s => s.p);
  if (beachSeg.length > 2) {
    const bPoly = [...beachSeg, [0.22, 0.34], [-0.05, 0.34], [-0.32, 0.38]];
    o.push(`<path d="${pathPts(bPoly.map(P), true)}" fill="${C.obsidian}"/>`);
  }
  // 等高线 (每 50m 一条, 100/200/300/400 加粗)
  for (let lv = 50; lv <= 450; lv += 50) {
    const major = lv % 100 === 0;
    for (const ln of marchSquares(hg, Gp, lv)) {
      o.push(`<path d="${pathPts(ln.map(P))}" fill="none" stroke="#263129" stroke-width="${major ? 0.85 : 0.48}" opacity="${major ? 0.58 : 0.36}"/>`);
    }
  }
  // 山涧与白水河 + 镜湖
  for (const fd of feederPts) o.push(`<path d="${pathPts(fd.map(P))}" fill="none" stroke="${C.lake}" stroke-width="1.1" opacity="0.8"/>`);
  o.push(`<path d="${pathPts(riverPts.map(P))}" fill="none" stroke="#3c738a" stroke-width="2.2"/>`);
  o.push(`<path d="${pathPts(lakePts.map(P), true)}" fill="${C.lake}" stroke="#2f5668" stroke-width="1.1"/>`);
  // 东峡谷断裂溪槽
  o.push(`<path d="${pathPts(gullyPts[0].map(P))}" fill="none" stroke="#3a4540" stroke-width="1.3" stroke-dasharray="3 2"/>`);
  o.push(`</g>`);

  // 海岸线与绝壁短齿线 (hachures)
  o.push(`<path d="${pathPts(coastPts.map(P), true)}" fill="none" stroke="#1e2930" stroke-width="1.5"/>`);
  o.push(`<path d="${pathPts(isletPts.map(P), true)}" fill="none" stroke="#1e2930" stroke-width="1.4"/>`);
  for (let i = 0; i < coast.length; i += 3) {
    const s = coast[i];
    if (s.kind !== 'c' && s.kind !== 'r') continue;
    const prev = coast[(i - 1 + coast.length) % coast.length].p, next = coast[(i + 1) % coast.length].p;
    let nx = -(next[1] - prev[1]), ny = next[0] - prev[0]; // 向陆内法线
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const len = s.kind === 'c' ? 0.032 + 0.025 * (s.hc / 460) : 0.020;
    const p0 = P(s.p), p1 = P([s.p[0] + nx * len, s.p[1] + ny * len]);
    o.push(`<line x1="${r(p0[0])}" y1="${r(p0[1])}" x2="${r(p1[0])}" y2="${r(p1[1])}" stroke="#1c2226" stroke-width="0.9" opacity="0.78"/>`);
  }

  // 刀刃山脊脊线与玄武岩尖塔符号
  o.push(`<path d="${pathPts(RIM_SPINE.map(p => P([p[0], p[1]])))}" fill="none" stroke="#2c3036" stroke-width="1.3" stroke-dasharray="5 3" opacity="0.72"/>`);
  for (const [sx, sy, , , name, hz] of SPIRES) {
    const [px, py] = P([sx, sy]);
    o.push(`<polygon points="${r(px)},${r(py - 5.2)} ${r(px - 4.6)},${r(py + 3.6)} ${r(px + 4.6)},${r(py + 3.6)}" fill="#1d2228" stroke="#fff" stroke-width="0.9"/>`);
    if (name) o.push(txt(px + 7, py + 3, `${name} ${hz}m`, 'xs b halo'));
  }

  // 一线天水道北口天然海蚀拱门
  {
    const [ax, ay] = P(SEA_ARCH.a), [bx, by] = P(SEA_ARCH.b);
    o.push(`<line x1="${r(ax)}" y1="${r(ay)}" x2="${r(bx)}" y2="${r(by)}" stroke="#2d3136" stroke-width="4.5" stroke-linecap="round"/>`);
    o.push(`<line x1="${r(ax)}" y1="${r(ay)}" x2="${r(bx)}" y2="${r(by)}" stroke="#b8c2c9" stroke-width="1.6" stroke-dasharray="3 2"/>`);
  }

  // 南剑峰 (260m) 与外海海蚀柱
  for (const [sx, sy, sh, sr, name] of STACKS) {
    const [px, py] = P([sx, sy]), pr = Math.max(2.6, sr * k);
    o.push(`<circle cx="${r(px)}" cy="${r(py)}" r="${r(pr + 2.2)}" fill="none" stroke="#eef6fa" stroke-width="1" opacity="0.75"/>`);
    o.push(`<polygon points="${r(px)},${r(py - pr)} ${r(px - pr * 0.9)},${r(py + pr * 0.8)} ${r(px + pr * 0.9)},${r(py + pr * 0.8)}" fill="#1f242a" stroke="#eef4f8" stroke-width="0.8"/>`);
    if (name) o.push(txt(px + 8, py + 4, `${name} ${sh}m`, 's b halo'));
  }

  // 地下基核壳体范围虚线、机库与弹射隧道、潜艇水下隧道
  o.push(`<ellipse cx="${r(X(-0.28))}" cy="${r(Y(-0.62))}" rx="${r(0.58 * k)}" ry="${r(0.52 * k)}" fill="none" stroke="${C.hull}" stroke-width="1.3" stroke-dasharray="8 4" opacity="0.72"/>`);
  // 潜艇水下航道 (主闸门 -80m, 西闸门 -60m)
  o.push(`<path d="${pathPts([MAIN_GATE.pos, [-0.24, -0.85]].map(P))}" fill="none" stroke="#225577" stroke-width="1.8" stroke-dasharray="4 3"/>`);
  o.push(`<path d="${pathPts([WEST_GATE.pos, WEST_GATE.wp, WEST_GATE.port].map(P))}" fill="none" stroke="#225577" stroke-width="1.8" stroke-dasharray="4 3"/>`);
  for (const g of [MAIN_GATE, WEST_GATE]) {
    const [gx, gy] = P(g.pos);
    o.push(`<rect x="${r(gx - 3.5)}" y="${r(gy - 3.5)}" width="7" height="7" fill="#225577" stroke="#fff" stroke-width="0.9"/>`);
  }

  // 三条水平弹射隧道
  for (const t of TUNNELS) {
    const [sx, sy] = P(t.start), [ex, ey] = P(t.exit);
    o.push(`<line x1="${r(sx)}" y1="${r(sy)}" x2="${r(ex)}" y2="${r(ey)}" stroke="${C.tunnel}" stroke-width="1.8" stroke-dasharray="5 3"/>`);
    o.push(`<circle cx="${r(ex)}" cy="${r(ey)}" r="3.2" fill="${C.tunnel}" stroke="#fff" stroke-width="0.9"/>`);
  }
  // 风草甸下三座垂直发射井
  for (const s of SILOS) {
    const [sx, sy] = P(s);
    o.push(`<circle cx="${r(sx)}" cy="${r(sy)}" r="2.8" fill="none" stroke="${C.tunnel}" stroke-width="1.3"/>`);
  }
  // 岩隙营房 (唯一地面营区) 与出击口
  for (const [cx, cy, nm] of CAMPS) {
    const [px, py] = P([cx, cy]);
    o.push(`<rect x="${r(px - 4)}" y="${r(py - 3)}" width="8" height="6" fill="#d99b38" stroke="#1d252c" stroke-width="1"/>`);
    o.push(txt(px - 7, py - 6, `${nm}(~100人)`, 'xs b halo end'));
  }
  for (const sp of SALLY) {
    const [px, py] = P(sp);
    o.push(`<circle cx="${r(px)}" cy="${r(py)}" r="2.1" fill="#d99b38" stroke="#1d252c" stroke-width="0.7"/>`);
  }
  // 崖宅标记 (+412~+440m 竖向堡垒)
  {
    const [vx, vy] = P([villaCoast[0], villaCoast[1] + 0.03]);
    o.push(`<rect x="${r(vx - 4.5)}" y="${r(vy - 3.5)}" width="9" height="7" fill="${C.amber}" stroke="#182026" stroke-width="1.2"/>`);
    o.push(txt(vx - 8, vy + 14, '崖宅 (+412~+440m)', 's b halo end'));
  }

  // B–B′ 南北剖面切割线 (x = -0.25)
  const secX = -0.25;
  o.push(`<line x1="${r(X(secX))}" y1="${r(Y(-1.52))}" x2="${r(X(secX))}" y2="${r(Y(0.75))}" stroke="#1f2d38" stroke-width="1.1" stroke-dasharray="9 4" opacity="0.65"/>`);
  o.push(txt(X(secX) + 5, Y(-1.47), 'B (南北剖面)', 'xs b halo'));
  o.push(txt(X(secX) + 5, Y(0.72), 'B′', 'xs b halo'));

  // 关键地名标注
  o.push(txt(X(LAKE.x), Y(LAKE.y) + 4, `镜湖 ${lakeLevel}m`, 's b whalo mid'));
  o.push(txt(X(MEADOW.x) + 42, Y(MEADOW.y) + 4, `风草甸 ~${meadowLevel}m`, 'xs b halo'));
  o.push(txt(X(FALLS[0]) + 8, Y(FALLS[1]) + 3, '帘瀑 (落差~90m)', 'xs b halo'));
  o.push(txt(X(0.02), Y(0.56), '黑砾湾 (黑曜石砾滩)', 's b halo mid'));
  o.push(txt(X(-0.15), Y(1.30), '北暗礁航道', 'xs b dhalo mid'));
  o.push(txt(X(ISLET.x) + 16, Y(ISLET.y), `东屿 ${ISLET.h}m`, 's b halo'));
  o.push(txt(X(1.37), Y(0.18), '一线天水道', 'xs b halo end'));
  o.push(txt(X(1.42), Y(0.56), '天然海蚀拱门 (百米高)', 'xs b halo'));
  o.push(txt(X(1.22), Y(-0.62), '东峡谷', 'xs b halo'));
  o.push(txt(X(1.50), Y(-0.10), '东礁滩', 'xs halo'));
  o.push(txt(X(-1.95), Y(0.02), '西礁滩', 'xs halo end'));
  o.push(txt(X(-0.84), Y(-0.76), '西裂谷 · 西发射口', 'xs halo end'));
  o.push(txt(X(0.26), Y(-0.80), '裂湾 · 东发射口', 'xs halo'));
  o.push(txt(X(WEST_GATE.pos[0]) - 6, Y(WEST_GATE.pos[1]) + 4, '西闸门 −60m', 'xs b dhalo end'));
  o.push(txt(X(MAIN_GATE.pos[0]) - 6, Y(MAIN_GATE.pos[1]) + 11, '主闸门 −80m', 'xs b dhalo end'));
  o.push(txt(X(gens[2][0]) + 6, Y(gens[2][1]) - 5, '幻域浮标环 (2~3 km)', 'xs dhalo'));

  o.push(`</g>`);

  // 坐标刻度、指北针、比例尺与图例
  o.push(`<rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
  for (let gx = -3; gx <= 3; gx++) {
    const px = X(gx);
    if (px > FX + 10 && px < FX + FW - 10) {
      o.push(`<line x1="${r(px)}" y1="${FY + FH}" x2="${r(px)}" y2="${FY + FH + 5}" stroke="${C.ink}"/>`);
      o.push(txt(px, FY + FH + 16, `${gx > 0 ? '+' + gx : gx} km`, 'xs mid'));
    }
  }
  for (let gy = -2; gy <= 2; gy++) {
    const py = Y(gy);
    if (py > FY + 10 && py < FY + FH - 10) {
      o.push(`<line x1="${FX - 5}" y1="${r(py)}" x2="${FX}" y2="${r(py)}" stroke="${C.ink}"/>`);
      o.push(txt(FX - 8, py + 3.5, `${gy > 0 ? '+' + gy : gy} km`, 'xs end'));
    }
  }
  // 指北针
  o.push(`<g transform="translate(${FX + FW - 34},${FY + 36})">
    <circle r="16" fill="rgba(255,255,255,.82)" stroke="${C.ink}" stroke-width="1"/>
    <polygon points="0,-12 -4.5,6 0,2.5 4.5,6" fill="${C.ink}"/>
    <text y="-19" class="xs b mid">北 N</text>
  </g>`);
  // 图例盒
  o.push(`<g transform="translate(${FX + 12},${FY + FH - 88})">
    <rect width="268" height="76" rx="5" fill="rgba(255,255,255,.88)" stroke="#9aaab5"/>
    <rect x="10" y="10" width="12" height="8" fill="${C.amber}" stroke="#222"/><text x="27" y="18" class="xs">崖宅 (+412~+440m) / 岩隙营房</text>
    <line x1="10" y1="30" x2="22" y2="30" stroke="${C.tunnel}" stroke-width="2" stroke-dasharray="4 2"/><text x="27" y="33" class="xs">电磁弹射隧道 (+90~+100m) 与发射井</text>
    <line x1="10" y1="45" x2="22" y2="45" stroke="#225577" stroke-width="2" stroke-dasharray="4 2"/><text x="27" y="48" class="xs">潜艇充水航道 (主闸门−80m / 西闸门−60m)</text>
    <line x1="10" y1="60" x2="22" y2="60" stroke="${C.hull}" stroke-width="1.5" stroke-dasharray="6 3"/><text x="27" y="63" class="xs">远古基核壳体范围 · 外圈黑点为幻域浮标</text>
  </g>`);
  // 1 km 比例尺
  o.push(`<g transform="translate(${FX + FW - 175},${FY + FH - 24})">
    <rect x="-8" y="-14" width="170" height="24" rx="4" fill="rgba(255,255,255,.85)"/>
    <rect width="${r(k)}" height="5" fill="${C.ink}"/>
    <text x="${r(k * 0.5)}" y="-3" class="xs b mid">1 公里 (全岛东西约 3.7 km)</text>
  </g>`);

  o.push(`</svg>`);
  return o.join('\n');
}

// ═════════ 图 2: 南立面图 + 3.1 崖宅竖向轻薄堡垒立面详图 (elevSVG) ═════════
function elevSVG() {
  const W = 960, Hh = 770;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">`);
  o.push(`<defs>
    <style>${BASE_CSS}</style>
    <linearGradient id="skyElev" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#dde6ec"/>
      <stop offset="100%" stop-color="#f2f5f7"/>
    </linearGradient>
    <linearGradient id="glassCurtain" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#223544"/>
      <stop offset="55%" stop-color="#2f495c"/>
      <stop offset="100%" stop-color="#1b2a36"/>
    </linearGradient>
    <linearGradient id="amberGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffcf75" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#d8892c" stop-opacity="0.28"/>
    </linearGradient>
    <linearGradient id="tiSheath" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7c8994"/>
      <stop offset="35%" stop-color="#aebac4"/>
      <stop offset="100%" stop-color="#6d7984"/>
    </linearGradient>
  </defs>`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#f5f7f8"/>`);

  // ── 上半幅: 全岛南立面远眺 (自南面外海向北望, x ∈ [-2.05, 1.95], z ∈ [-110, 500] m) ──
  const FX1 = 58, FY1 = 52, FW1 = 860, FH1 = 278;
  const x0 = -2.05, x1 = 1.95; // 4.0 km
  const kx = FW1 / (x1 - x0);  // 215 px/km -> 0.215 px/m
  const kz = 0.43;             // 垂直夸大 2.0x, 清晰展现 460m 巨崖与内部海拔关系
  const X1 = x => FX1 + (x - x0) * kx;
  const Z1 = z => FY1 + FH1 - (z - (-110)) * kz;

  o.push(txt(FX1, 26, '岛屿基地 · 南立面图与崖宅定稿立面 (3.1 版)', 'title'));
  o.push(txt(FX1, 43, '上图: 自南侧外海向北远眺 460 米刀刃绝壁、南剑峰与东屿 (垂直比例 2×) · 下图: +412~+440 米四层轻薄竖向崖壁堡垒 1:1 详图', 'sub'));

  o.push(`<rect x="${FX1}" y="${FY1}" width="${FW1}" height="${FH1}" fill="url(#skyElev)" stroke="${C.ink}"/>`);

  // 按由北(远)向南(近)分带投影天际轮廓
  const bands = [
    { yMin:  0.10, yMax:  1.70, col: '#9aaab4' }, // 远景: 西岬/东岬/北翼
    { yMin: -0.65, yMax:  0.10, col: '#778590' }, // 中远景: 西尖塔(365m)/东尖塔(310m)/东屿(280m)
    { yMin: -1.40, yMax: -0.65, col: '#4a525b' }, // 近景: 南岸主崖岬(460m)/西崖角(340m)/东南崖角(290m)
  ];
  const nx = 320;
  for (const b of bands) {
    const pts = [[X1(x0), Z1(0)]];
    for (let i = 0; i <= nx; i++) {
      const x = x0 + (i / nx) * (x1 - x0);
      let hz = 0;
      for (let y = b.yMin; y <= b.yMax; y += 0.015) {
        if (onLand(x, y)) { const h = H(x, y); if (h > hz) hz = h; }
      }
      pts.push([X1(x), Z1(hz)]);
    }
    pts.push([X1(x1), Z1(0)]);
    o.push(`<path d="${pathPts(pts, true)}" fill="${b.col}" stroke="#2d343b" stroke-width="0.8"/>`);
  }

  // 近景主崖柱状节理竖纹
  for (let x = -1.78; x <= 1.38; x += 0.045) {
    let hz = 0;
    for (let y = -1.32; y <= -0.66; y += 0.02) if (onMainLand(x, y)) hz = Math.max(hz, H(x, y));
    if (hz > 80) {
      o.push(`<line x1="${r(X1(x))}" y1="${r(Z1(hz * 0.92))}" x2="${r(X1(x))}" y2="${r(Z1(15))}" stroke="#343b42" stroke-width="0.65" opacity="0.55"/>`);
    }
  }

  // 一线天水道裂隙阴影与北口百米海蚀拱门示意
  o.push(`<rect x="${r(X1(1.40))}" y="${r(Z1(105))}" width="${r((1.52 - 1.40) * kx)}" height="${r(105 * kz)}" fill="#c8d6df" opacity="0.65"/>`);
  o.push(`<path d="M${r(X1(1.38))},${r(Z1(105))} L${r(X1(1.54))},${r(Z1(105))} L${r(X1(1.54))},${r(Z1(74))} Q${r(X1(1.46))},${r(Z1(92))} ${r(X1(1.38))},${r(Z1(74))} Z" fill="#5e6872" stroke="#2c333a" stroke-width="0.8"/>`);

  // 水面以下深潜崖剖面与洋面
  o.push(`<rect x="${FX1}" y="${r(Z1(0))}" width="${FW1}" height="${r(FY1 + FH1 - Z1(0))}" fill="#89a8bb" opacity="0.82"/>`);
  o.push(`<path d="M${r(X1(-1.88))},${r(Z1(0))} L${r(X1(-1.96))},${r(Z1(-110))} L${r(X1(1.86))},${r(Z1(-110))} L${r(X1(1.78))},${r(Z1(0))} Z" fill="#3a4652" opacity="0.72"/>`);
  o.push(`<line x1="${FX1}" y1="${r(Z1(0))}" x2="${FX1 + FW1}" y2="${r(Z1(0))}" stroke="#1c3b4f" stroke-width="1.4"/>`);

  // 南剑峰 (前景外海 260m 黑色剑峰)
  {
    const sx = SWORD_PEAK.x, sw = SWORD_PEAK.r;
    const sp = [
      [X1(sx - sw), Z1(0)],
      [X1(sx - sw * 0.62), Z1(135)],
      [X1(sx - sw * 0.16), Z1(260)],
      [X1(sx + sw * 0.12), Z1(248)],
      [X1(sx + sw * 0.55), Z1(120)],
      [X1(sx + sw * 0.92), Z1(0)],
    ];
    o.push(`<path d="${pathPts(sp, true)}" fill="#1f252c" stroke="#eef5f9" stroke-width="0.9"/>`);
    o.push(txt(X1(sx) + 12, Z1(245), '南剑峰 260m (外海海蚀孤峰)', 'xs b halo'));
  }

  // 在 460m 主崖岬上标出真实比例的崖宅 (+412~+440m, 宽34m, 高28m!)
  {
    const vx = X1(villaCoast[0]), vw = Math.max(7.5, 0.034 * kx);
    const vyTop = Z1(440), vyBot = Z1(412);
    o.push(`<rect x="${r(vx - vw * 0.5)}" y="${r(vyTop)}" width="${r(vw)}" height="${r(vyBot - vyTop)}" fill="${C.amber}" stroke="#141a20" stroke-width="1"/>`);
    o.push(`<circle cx="${r(vx)}" cy="${r((vyTop + vyBot) * 0.5)}" r="9" fill="none" stroke="#c84b31" stroke-width="1.2" stroke-dasharray="3 2"/>`);
    o.push(txt(vx - 14, vyTop - 6, '崖宅 (+412~+440m, 下方留有四百米绝壁)', 'xs b halo end'));
  }
  // 三个水平弹射口与两个水下闸门位置
  for (const t of TUNNELS) {
    const tx = X1(t.exit[0]), ty = Z1(t.z);
    o.push(`<circle cx="${r(tx)}" cy="${r(ty)}" r="2.8" fill="${C.tunnel}" stroke="#fff" stroke-width="0.8"/>`);
    o.push(txt(tx + 5, ty + 3, `${t.name} +${t.z}m`, 'xs halo'));
  }
  o.push(`<rect x="${r(X1(villaCoast[0]) - 3)}" y="${r(Z1(-80) - 3)}" width="6" height="6" fill="#183f59" stroke="#fff" stroke-width="0.8"/>`);
  o.push(txt(X1(villaCoast[0]) + 6, Z1(-80) + 3, '主闸门 −80m', 'xs whalo'));
  o.push(`<rect x="${r(X1(WEST_GATE.pos[0]) - 3)}" y="${r(Z1(-60) - 3)}" width="6" height="6" fill="#183f59" stroke="#fff" stroke-width="0.8"/>`);
  o.push(txt(X1(WEST_GATE.pos[0]) + 6, Z1(-60) + 3, '西闸门 −60m', 'xs whalo'));

  // 峰顶高程注记与标尺
  o.push(txt(X1(-0.22), Z1(466), '主崖岬 460m', 's b halo mid'));
  o.push(txt(X1(-1.45), Z1(348), '西崖角 340m', 'xs b halo mid'));
  o.push(txt(X1(-1.25), Z1(374), '西尖塔 365m', 'xs halo mid'));
  o.push(txt(X1(0.68), Z1(318), '东尖塔 310m', 'xs halo mid'));
  o.push(txt(X1(0.92), Z1(298), '东南崖角 290m', 'xs b halo mid'));
  o.push(txt(X1(ISLET.x), Z1(288), '东屿 280m', 'xs b halo mid'));
  o.push(txt(X1(1.46), Z1(118), '一线天与海蚀拱门', 'xs halo mid'));
  for (const z of [-100, 0, 100, 200, 300, 400, 460]) {
    o.push(`<line x1="${FX1 - 5}" y1="${r(Z1(z))}" x2="${FX1}" y2="${r(Z1(z))}" stroke="${C.ink}"/>`);
    o.push(txt(FX1 - 8, Z1(z) + 3.5, `${z > 0 ? '+' + z : z}m`, 'xs end'));
  }

  // ── 下半幅: 崖宅 3.1 定稿正立面详图 (1:1 等比例, 横向 u ∈ [-46, +46] m, 海拔 z ∈ [400, 460] m) ──
  const FX2 = 58, FY2 = 368, FW2 = 860, FH2 = 364;
  // FH2 = 364 px 对应 Δz = 56 m (404 ~ 460 m) => k2 = 6.5 px/m, 横向显示约 132 m (-66 ~ +66 m)
  const k2 = 6.4, uSpan = FW2 / k2;
  const U2 = u => FX2 + FW2 * 0.5 + u * k2;
  const Z2 = z => FY2 + FH2 - (z - 404) * k2;

  o.push(txt(FX2, FY2 - 9, '崖宅正立面 1:1 详图 — 自崖顶肩部垂降的四层轻薄钛金属装甲鞘与双层钢化玻璃幕墙 (+412 ~ +440 m, 宽 34 m × 高 28 m)', 's b'));
  o.push(`<g>`);
  o.push(`<clipPath id="villaElevClip"><rect x="${FX2}" y="${FY2}" width="${FW2}" height="${FH2}"/></clipPath>`);
  o.push(`<g clip-path="url(#villaElevClip)">`);
  // 背景深色柱状节理玄武岩绝壁 + 顶部 445~460m 刀刃山脊天际线
  o.push(`<rect x="${FX2}" y="${FY2}" width="${FW2}" height="${FH2}" fill="#dce5ec"/>`);
  const crestPts = [[FX2, FY2 + FH2]];
  for (let u = -uSpan * 0.52; u <= uSpan * 0.52; u += 2) {
    const cz = 458.5 - 0.08 * Math.abs(u) - 2.6 * Math.pow((u / 48), 2) + 1.4 * vnoise(u * 0.14, 2.3, 88);
    crestPts.push([U2(u), Z2(cz)]);
  }
  crestPts.push([FX2 + FW2, FY2 + FH2]);
  o.push(`<path d="${pathPts(crestPts, true)}" fill="#444950" stroke="#23272c" stroke-width="1.2"/>`);

  // 玄武岩垂直柱状节理裂隙纹理 (凸显下方 404~412m 为纯粹原始绝壁, 不通山底!)
  const rng = mulberry32(412440);
  for (let u = -64; u <= 64; u += 2.6) {
    const ux = U2(u + (rng() - 0.5) * 0.7);
    const topZ = 455 - 0.09 * Math.abs(u);
    o.push(`<line x1="${r(ux)}" y1="${r(Z2(topZ))}" x2="${r(ux)}" y2="${r(FY2 + FH2)}" stroke="#2e3238" stroke-width="${rng() > 0.6 ? 1.1 : 0.6}" opacity="0.68"/>`);
    for (let hz = 408; hz < topZ; hz += 7 + rng() * 6) {
      o.push(`<line x1="${r(ux - 5)}" y1="${r(Z2(hz))}" x2="${r(ux + 5)}" y2="${r(Z2(hz + (rng() - 0.5) * 1.4))}" stroke="#2b2f35" stroke-width="0.55" opacity="0.48"/>`);
    }
  }

  // 岩槽阴影凹口 (u ∈ [-17.8, +17.8], z ∈ [411.6, 440.4])
  o.push(`<rect x="${r(U2(-17.8))}" y="${r(Z2(440.4))}" width="${r(35.6 * k2)}" height="${r(28.8 * k2)}" rx="3" fill="#181c21"/>`);

  // 外圈轻薄冷灰钛金属装甲外鞘 (u ∈ [-17, +17], z ∈ [412, 440], 两侧薄鞘宽仅 1.6m)
  // 1) 底部轻薄折角收束腹板 (+412.0 ~ +413.2m, 干净锚入绝壁)
  const belly = [
    [U2(-17.0), Z2(413.4)], [U2(17.0), Z2(413.4)],
    [U2(14.2),  Z2(412.0)], [U2(-14.2), Z2(412.0)],
  ];
  o.push(`<path d="${pathPts(belly, true)}" fill="url(#tiSheath)" stroke="#1e252b" stroke-width="1.1"/>`);

  // 2) 底部重工实验舱内凹舱口 (z: 413.2 ~ 422.6m, u: -15.4 ~ +15.4)
  o.push(`<rect x="${r(U2(-15.4))}" y="${r(Z2(422.6))}" width="${r(30.8 * k2)}" height="${r(9.4 * k2)}" fill="#161e26" stroke="#2b3742" stroke-width="1"/>`);
  // 舱内桥式吊车梁、远古蓝金能量核心与停泊轻型座机剪影
  o.push(`<rect x="${r(U2(-14.5))}" y="${r(Z2(421.6))}" width="${r(29.0 * k2)}" height="${r(0.9 * k2)}" fill="#4b5864"/>`);
  o.push(`<circle cx="${r(U2(8.5))}" cy="${r(Z2(416.8))}" r="${r(2.1 * k2)}" fill="#5ec2d6" opacity="0.78"/>`);
  o.push(`<circle cx="${r(U2(8.5))}" cy="${r(Z2(416.8))}" r="${r(1.0 * k2)}" fill="#e9fbff"/>`);
  // 停靠座机正视剪影
  o.push(`<polygon points="${r(U2(-8.5))},${r(Z2(414.3))} ${r(U2(-2.0))},${r(Z2(415.7))} ${r(U2(4.5))},${r(Z2(414.3))} ${r(U2(1.8))},${r(Z2(413.6))} ${r(U2(-5.8))},${r(Z2(413.6))}" fill="#8b99a6" stroke="#1c242b" stroke-width="0.9"/>`);

  // 3) 纤薄悬挑起降甲板 (+413.0m, 向前平直探出, 正立面呈极利落的冷灰金属薄刃与警示灯带)
  o.push(`<rect x="${r(U2(-13.8))}" y="${r(Z2(413.5))}" width="${r(27.6 * k2)}" height="${r(0.85 * k2)}" rx="1.5" fill="#c3cfd8" stroke="#182028" stroke-width="1.1"/>`);
  for (let u = -12; u <= 12; u += 4) {
    o.push(`<rect x="${r(U2(u - 0.35))}" y="${r(Z2(413.25))}" width="${r(0.7 * k2)}" height="${r(0.32 * k2)}" fill="${C.amber}"/>`);
  }

  // 4) 中央两层大面积防弹钢化玻璃幕墙主厅 (z: 423.0 ~ 435.0m, 每层 6m, 429m 处纤薄楼层腰带)
  o.push(`<rect x="${r(U2(-15.4))}" y="${r(Z2(435.0))}" width="${r(30.8 * k2)}" height="${r(12.0 * k2)}" fill="url(#glassCurtain)" stroke="#1b2630" stroke-width="1.1"/>`);
  // 室内克制沉静的琥珀色暖光透射与层板剪影
  o.push(`<rect x="${r(U2(-14.6))}" y="${r(Z2(434.2))}" width="${r(29.2 * k2)}" height="${r(4.8 * k2)}" fill="url(#amberGlow)" opacity="0.62"/>`);
  o.push(`<rect x="${r(U2(-14.6))}" y="${r(Z2(428.3))}" width="${r(29.2 * k2)}" height="${r(4.9 * k2)}" fill="url(#amberGlow)" opacity="0.72"/>`);
  // 429m 纤薄冷灰钛金属层间横梁与 423m 主厅底梁
  o.push(`<rect x="${r(U2(-15.6))}" y="${r(Z2(429.35))}" width="${r(31.2 * k2)}" height="${r(0.7 * k2)}" fill="url(#tiSheath)" stroke="#1d252c" stroke-width="0.9"/>`);
  o.push(`<rect x="${r(U2(-16.8))}" y="${r(Z2(423.25))}" width="${r(33.6 * k2)}" height="${r(0.85 * k2)}" fill="url(#tiSheath)" stroke="#1d252c" stroke-width="1"/>`);
  // 纤细竖向钛钢肋框 (mullions, 5 等分跨度)
  for (const u of [-9.2, -3.1, 3.1, 9.2]) {
    o.push(`<line x1="${r(U2(u))}" y1="${r(Z2(435.0))}" x2="${r(U2(u))}" y2="${r(Z2(423.25))}" stroke="#9aa8b4" stroke-width="1.5"/>`);
  }
  // 玻璃斜向高光反射条
  o.push(`<polygon points="${r(U2(-13))},${r(Z2(434.8))} ${r(U2(-9.5))},${r(Z2(434.8))} ${r(U2(-13.5))},${r(Z2(423.5))} ${r(U2(-15))},${r(Z2(423.5))}" fill="#ffffff" opacity="0.09"/>`);
  o.push(`<polygon points="${r(U2(4))},${r(Z2(434.8))} ${r(U2(7))},${r(Z2(434.8))} ${r(U2(2.5))},${r(Z2(423.5))} ${r(U2(0.5))},${r(Z2(423.5))}" fill="#ffffff" opacity="0.07"/>`);

  // 5) 左右两侧轻薄冷灰钛金属侧鞘 (厚仅 1.6m, 如刀鞘般利落包裹嵌入岩槽)
  o.push(`<rect x="${r(U2(-17.0))}" y="${r(Z2(439.6))}" width="${r(1.65 * k2)}" height="${r(26.3 * k2)}" rx="2" fill="url(#tiSheath)" stroke="#1d252c" stroke-width="1.1"/>`);
  o.push(`<rect x="${r(U2(15.35))}" y="${r(Z2(439.6))}" width="${r(1.65 * k2)}" height="${r(26.3 * k2)}" rx="2" fill="url(#tiSheath)" stroke="#1d252c" stroke-width="1.1"/>`);

  // 6) 顶部装甲冠层 (1层, 435 ~ 440m): 顶缘平切嵌入崖顶肩部 + 狭长观测窗缝
  const crown = [
    [U2(-17.0), Z2(439.6)], [U2(-15.5), Z2(440.0)],
    [U2(15.5),  Z2(440.0)], [U2(17.0),  Z2(439.6)],
    [U2(17.0),  Z2(435.0)], [U2(-17.0), Z2(435.0)],
  ];
  o.push(`<path d="${pathPts(crown, true)}" fill="url(#tiSheath)" stroke="#1b232a" stroke-width="1.2"/>`);
  // 狭长水平装甲观测窗缝 (z: 436.9 ~ 438.0m)
  o.push(`<rect x="${r(U2(-12.8))}" y="${r(Z2(438.0))}" width="${r(25.6 * k2)}" height="${r(1.05 * k2)}" rx="1.5" fill="#17242e" stroke="#475663" stroke-width="0.9"/>`);
  o.push(`<line x1="${r(U2(-12.2))}" y1="${r(Z2(437.45))}" x2="${r(U2(12.2))}" y2="${r(Z2(437.45))}" stroke="${C.amber}" stroke-width="1.4" opacity="0.85"/>`);

  // 比例小人 (1.8m 高, 站立于 +413.5m 起降甲板上)
  const hx = U2(-11.2), hy = Z2(413.5);
  o.push(`<circle cx="${r(hx)}" cy="${r(hy - 1.62 * k2)}" r="${r(0.22 * k2)}" fill="#fff"/>`);
  o.push(`<line x1="${r(hx)}" y1="${r(hy - 1.38 * k2)}" x2="${r(hx)}" y2="${r(hy)}" stroke="#fff" stroke-width="1.6"/>`);

  // 四层结构引线标注
  const lead2 = (u0, z0, u1, z1, s, subS = '') => {
    const end = u1 < 0 ? 'end' : '';
    const dx = u1 < 0 ? -5 : 5;
    o.push(`<path d="M${r(U2(u0))},${r(Z2(z0))} L${r(U2(u1))},${r(Z2(z1))}" fill="none" stroke="#dce6ee" stroke-width="1"/>`);
    o.push(txt(U2(u1) + dx, Z2(z1) + 3, s, `s b whalo ${end}`));
    if (subS) o.push(txt(U2(u1) + dx, Z2(z1) + 17, subS, `xs whalo ${end}`));
  };
  lead2(16.5, 437.6, 25, 441.5, '① 顶部装甲冠层 (435–440 m)', '平切嵌岩顶盖 · 狭长观测窗缝 · 后通火山口盆地');
  lead2(16.0, 432.0, 25, 432.5, '② 双层钢化玻璃幕墙主厅 (423–435 m)', '每层挑高 6 m · 细钛肋框 · 起居/书房/战术观海厅');
  lead2(15.4, 418.0, 25, 421.5, '③ 底部重工实验舱 (412–423 m)', '内凹纵深 60 m · 桥式吊车梁 · 远古能量核心');
  lead2(13.6, 413.3, 25, 412.2, '④ 纤薄悬挑起降甲板 (+413 m)', '底缘折角腹板于 +412 m 干净锚入绝壁');

  lead2(-17.0, 431.0, -25, 435.5, '轻薄冷灰钛金属侧鞘 (宽 34 m)', '剔除笨重厚墙, 如刀鞘般利落嵌于柱状玄武岩槽');
  lead2(-11.2, 414.4, -25, 418.5, '1.8 m 人物比例参照', '下方 −40~+411 m 四百米绝壁保持纯粹原始风貌');

  o.push(`</g>`);
  o.push(`<rect x="${FX2}" y="${FY2}" width="${FW2}" height="${FH2}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
  for (const z of [405, 412, 423, 429, 435, 440, 450, 460]) {
    if (z < 404 || z > 460) continue;
    o.push(`<line x1="${FX2 - 5}" y1="${r(Z2(z))}" x2="${FX2}" y2="${r(Z2(z))}" stroke="${C.ink}"/>`);
    o.push(txt(FX2 - 8, Z2(z) + 3.5, `+${z}m`, 'xs end'));
  }
  // 10m 1:1 比例尺
  o.push(`<g transform="translate(${FX2 + 14},${FY2 + FH2 - 22})">
    <rect x="-6" y="-12" width="176" height="20" rx="3" fill="rgba(20,28,36,.78)"/>
    <rect width="${r(10 * k2)}" height="4" fill="#fff"/>
    <text x="${r(10 * k2 + 8)}" y="4" class="xs" fill="#eef4f8">10 米 (水平与垂直 1:1 同比例)</text>
  </g>`);
  o.push(`</g>`);

  o.push(`</svg>`);
  return o.join('\n');
}

// ═════════ 图 3: 南北剖面图 B–B′ (sectionSVG, x = -0.25) ═════════
export const SECTION_X = -0.25;
function sectionSVG() {
  const W = 960, Hh = 680, FX = 64, FY = 58, FW = 852, FH = 576;
  // y ∈ [-1.62, 0.86] km (2480 m), z ∈ [-720, 520] m (1240 m) -> 垂直夸大 1.3x 兼顾真实陡峭感与洞室清晰度
  const yMin = -1.62, yMax = 0.86;
  const zMin = -720, zMax = 520;
  const ky = FW / ((yMax - yMin) * 1000); // px / m
  const kz = FH / (zMax - zMin);          // px / m (~1.33x)
  const Ys = yKm => FX + (yKm - yMin) * 1000 * ky;
  const Zs = zM => FY + FH - (zM - zMin) * kz;

  // 查找剖面线与南北岸线及镜湖交点
  let Y0 = -1.24, Y1 = 0.44, l0 = -0.17, l1 = 0.12, crestZ = 456;
  const landYs = [];
  for (let y = -1.55; y <= 0.80; y += 0.002) if (onMainLand(SECTION_X, y)) landYs.push(y);
  if (landYs.length) { Y0 = landYs[0]; Y1 = landYs[landYs.length - 1]; }
  const lakeYs = [];
  for (let y = -0.35; y <= 0.30; y += 0.002) if (pip(lakePts, SECTION_X, y)) lakeYs.push(y);
  if (lakeYs.length) { l0 = lakeYs[0]; l1 = lakeYs[lakeYs.length - 1]; }

  // 构造地表与海底剖面折线
  const prof = [];
  for (let y = yMin; y <= yMax; y += 0.006) {
    let z;
    if (y < Y0) {
      const d = (Y0 - y) * 1000;
      z = lerpLine(APRON, -d);
    } else if (y > Y1) {
      const d = (y - Y1) * 1000;
      z = -Math.min(180, 2 + d * 0.24);
    } else if (pip(lakePts, SECTION_X, y)) {
      const u = Math.sin(clamp((y - l0) / (l1 - l0 + 1e-6)) * Math.PI);
      z = lakeLevel - LAKE.depth * Math.pow(u, 0.75);
    } else {
      const dSouth = (y - Y0) * 1000;
      const hInland = H(SECTION_X, y);
      if (dSouth < 124) z = lerpLine(CLIFF, dSouth) * (H(SECTION_X, Y0 + 0.124) / 460);
      else z = hInland;
      if (z > crestZ) crestZ = z;
    }
    prof.push([Ys(y), Zs(z)]);
  }
  const rockPoly = [[Ys(yMin), Zs(zMin)], ...prof, [Ys(yMax), Zs(zMin)]];

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">`);
  o.push(`<defs>
    <style>${BASE_CSS}</style>
    <clipPath id="secClip"><rect x="${FX}" y="${FY}" width="${FW}" height="${FH}"/></clipPath>
    <linearGradient id="rockGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#686d73"/>
      <stop offset="35%" stop-color="#53585f"/>
      <stop offset="100%" stop-color="#3b4047"/>
    </linearGradient>
  </defs>`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#f5f7f8"/>`);
  o.push(txt(FX, 26, '岛屿基地 · 南北纵剖面图 B–B′ (3.1 版, 沿 x = −0.25 km)', 'title'));
  o.push(txt(FX, 43, '460 米刀刃主崖与深潜崖 · 破火山口碗底(风草甸 165m / 镜湖 138m) · 远古基核壳体 (−670m) 与三层八舱段地下城', 'sub'));

  o.push(`<g clip-path="url(#secClip)">`);
  // 天空与南北两侧海水
  o.push(`<rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" fill="#e6eef3"/>`);
  o.push(`<rect x="${FX}" y="${r(Zs(0))}" width="${r(Ys(Y0 + 0.05) - FX)}" height="${r(Zs(zMin) - Zs(0))}" fill="#7ea0b5"/>`);
  o.push(`<rect x="${r(Ys(Y1 - 0.02))}" y="${r(Zs(0))}" width="${r(FX + FW - Ys(Y1 - 0.02))}" height="${r(Zs(zMin) - Zs(0))}" fill="#8eb0c2"/>`);

  // 镜湖水体填充 (138m)
  if (lakeYs.length) {
    o.push(`<rect x="${r(Ys(l0))}" y="${r(Zs(lakeLevel))}" width="${r(Ys(l1) - Ys(l0))}" height="${r(Zs(lakeLevel - LAKE.depth) - Zs(lakeLevel))}" fill="${C.lake}"/>`);
  }

  // 岛体玄武岩基岩填充
  o.push(`<path d="${pathPts(rockPoly, true)}" fill="url(#rockGrad)" stroke="#23282e" stroke-width="1.4"/>`);

  // 远古基核未知材料整体壳体轮廓 (主崖后方延伸至海平面以下 -670m)
  const hullPts = [
    [Y0 + 0.08, 435], [Y0 + 0.14, 448], [-0.42, 220], [-0.15, 95], [-0.08, -190],
    [-0.14, -560], [-0.45, -670], [-0.92, -670], [-1.14, -520], [-1.18, -120], [-1.17, 290],
  ].map(([yk, zm]) => [Ys(yk), Zs(zm)]);
  o.push(`<path d="${pathPts(hullPts, true)}" fill="#46515c" fill-opacity="0.45" stroke="#9ec4d8" stroke-width="1.8" stroke-dasharray="9 4"/>`);

  // 中央主竖井 (连通崖宅 → 机库洞厅 → 内港 → 工坊 → 地下城)
  const shaftY = -0.76;
  o.push(`<rect x="${r(Ys(shaftY) - 3)}" y="${r(Zs(422))}" width="6" height="${r(Zs(-525) - Zs(422))}" fill="#cfc8bc" stroke="#22282e" stroke-width="0.9"/>`);
  // 崖宅斜向联络竖井 (从 y=-1.14, +415m 通向机库北端)
  o.push(`<path d="M${r(Ys(Y0 + 0.13))},${r(Zs(414))} L${r(Ys(-0.88))},${r(Zs(110))} L${r(Ys(-0.88))},${r(Zs(10))} " fill="none" stroke="#cfc8bc" stroke-width="3.2"/>`);

  // 1) 崖宅 (+412 ~ +440m, 嵌于主崖顶部南缘, 并带后山通道直通北坡俯瞰盆地)
  const vy = Y0 + 0.098;
  o.push(`<rect x="${r(Ys(vy - 0.015))}" y="${r(Zs(440))}" width="${r(0.075 * 1000 * ky)}" height="${r(28 * kz)}" fill="${C.amber}" stroke="#141a20" stroke-width="1.1"/>`);
  // 后山通道 (+436m 穿通狭窄刀刃山脊至火山口内壁)
  o.push(`<line x1="${r(Ys(vy + 0.05))}" y1="${r(Zs(436))}" x2="${r(Ys(Y0 + 0.20))}" y2="${r(Zs(428))}" stroke="#f5d28c" stroke-width="2.2"/>`);

  // 2) 机库洞厅 (+70 ~ +115m, 主崖后方 420~760m => y ∈ [-0.82, -0.48], 正在风草甸下方)
  const hy0 = Y0 + 0.42, hy1 = Y0 + 0.76;
  o.push(`<path d="M${r(Ys(hy0))},${r(Zs(70))} V${r(Zs(98))} Q${r(Ys((hy0 + hy1) * 0.5))},${r(Zs(124))} ${r(Ys(hy1))},${r(Zs(98))} V${r(Zs(70))} Z" fill="${C.chamber}" stroke="#1c2228" stroke-width="1.2"/>`);
  // 三座垂直发射井直通风草甸草皮 (~165m)
  for (const sy of [hy0 + 0.08, (hy0 + hy1) * 0.5, hy1 - 0.08]) {
    o.push(`<rect x="${r(Ys(sy) - 2.4)}" y="${r(Zs(165))}" width="4.8" height="${r(Zs(106) - Zs(165))}" fill="#e8c39e" stroke="${C.tunnel}" stroke-width="0.9"/>`);
  }
  // 南水平电磁弹射隧道 (+95m, 直冲主崖中层绝壁)
  o.push(`<line x1="${r(Ys(Y0 + 0.032))}" y1="${r(Zs(95))}" x2="${r(Ys(hy0))}" y2="${r(Zs(90))}" stroke="#f0b199" stroke-width="3.6"/>`);
  o.push(`<line x1="${r(Ys(Y0 + 0.032))}" y1="${r(Zs(95))}" x2="${r(Ys(hy0))}" y2="${r(Zs(90))}" stroke="${C.tunnel}" stroke-width="1.4" stroke-dasharray="4 2"/>`);

  // 3) 潜艇内港 (−95 ~ +25m, 主崖后方 280~680m => y ∈ [-0.96, -0.56], 港内水面 0m, 经 350m 水下隧道通 -80m 主闸门)
  const py0 = Y0 + 0.28, py1 = Y0 + 0.68;
  o.push(`<path d="M${r(Ys(py0))},${r(Zs(-95))} V${r(Zs(10))} Q${r(Ys((py0 + py1) * 0.5))},${r(Zs(32))} ${r(Ys(py1))},${r(Zs(10))} V${r(Zs(-95))} Z" fill="${C.chamber}" stroke="#1c2228" stroke-width="1.2"/>`);
  o.push(`<rect x="${r(Ys(py0) + 1)}" y="${r(Zs(0))}" width="${r(Ys(py1) - Ys(py0) - 2)}" height="${r(Zs(-95) - Zs(0))}" fill="#6c95ad"/>`);
  // -80m 主闸门充水航道 (~350m)
  o.push(`<path d="M${r(Ys(Y0 - 0.045))},${r(Zs(-80))} L${r(Ys(py0))},${r(Zs(-72))}" stroke="#6c95ad" stroke-width="5.5"/>`);

  // 4) 工坊 (−240 ~ −125m, 两处洞室: 机器人工厂 / 海水淡化与合成食物)
  for (const [wy0, wy1] of [[-0.92, -0.68], [-0.58, -0.34]]) {
    o.push(`<rect x="${r(Ys(wy0))}" y="${r(Zs(-125))}" width="${r(Ys(wy1) - Ys(wy0))}" height="${r(Zs(-240) - Zs(-125))}" rx="5" fill="${C.chamber}" stroke="#1c2228" stroke-width="1.1"/>`);
  }

  // 5) 核聚变反应堆 (~ −320m) 与 超级人工智能中枢 (~ −330m)
  o.push(`<circle cx="${r(Ys(-0.72))}" cy="${r(Zs(-320))}" r="${r(36 * kz)}" fill="#ffd27d" stroke="#1c2228" stroke-width="1.2"/>`);
  o.push(`<rect x="${r(Ys(-0.50))}" y="${r(Zs(-302))}" width="${r(0.18 * 1000 * ky)}" height="${r(56 * kz)}" rx="4" fill="#b8d9e8" stroke="#1c2228" stroke-width="1.1"/>`);
  // 深海热沉排热导管 (排入南侧水下深潜崖冷水)
  o.push(`<path d="M${r(Ys(-0.72))},${r(Zs(-345))} L${r(Ys(Y0 - 0.28))},${r(Zs(-365))}" fill="none" stroke="#8fb8cc" stroke-width="1.6" stroke-dasharray="4 3"/>`);

  // 6) 地下城 (−535 ~ −440m, 精简为 8 个舱段, 分 3 层错落排列, 总长约 450m × 高 95m, 供 100 人长期自持)
  const dcY0 = -0.88; // 范围 -0.88 ~ -0.43 (450m)
  const pods = [
    // 上层 (-462 ~ -442m, 3舱段)
    [-0.86, -0.74, -442, -462], [-0.70, -0.57, -442, -462], [-0.54, -0.43, -442, -462],
    // 中层 (-498 ~ -476m, 3舱段)
    [-0.88, -0.75, -476, -498], [-0.72, -0.58, -476, -498], [-0.55, -0.44, -476, -498],
    // 下层 (-535 ~ -512m, 2舱段)
    [-0.84, -0.68, -512, -535], [-0.64, -0.48, -512, -535],
  ];
  // 联络走廊网
  o.push(`<rect x="${r(Ys(dcY0))}" y="${r(Zs(-440))}" width="${r(450 * ky)}" height="${r(95 * kz)}" rx="6" fill="none" stroke="#aab6c0" stroke-width="0.9" stroke-dasharray="3 3"/>`);
  for (const [a, b, zt, zb] of pods) {
    o.push(`<rect x="${r(Ys(a))}" y="${r(Zs(zt))}" width="${r(Ys(b) - Ys(a))}" height="${r(Zs(zb) - Zs(zt))}" rx="3" fill="${C.chamber}" stroke="#1a2026" stroke-width="1"/>`);
  }
  // 深海脱出口 (−500m 充水航道约 400m 直通南侧深潜崖坡)
  o.push(`<path d="M${r(Ys(-0.88))},${r(Zs(-500))} L${r(Ys(Y0 - 0.21))},${r(Zs(-505))}" stroke="#6c95ad" stroke-width="3.4" stroke-dasharray="5 2"/>`);

  // 帘瀑北缘崩塌悬崖飞瀑示意 (x=0.10 投影提示)
  o.push(`<path d="M${r(Ys(0.12))},${r(Zs(138))} L${r(Ys(0.22))},${r(Zs(132))} L${r(Ys(0.25))},${r(Zs(38))} L${r(Ys(0.42))},${r(Zs(2))}" fill="none" stroke="#8ad0e6" stroke-width="1.8" stroke-dasharray="4 3"/>`);

  // 剖面文字注记
  o.push(txt(Ys(Y0 + 0.12), Zs(472), '主崖岬刀刃山脊 460m', 's b halo mid'));
  o.push(txt(Ys(vy - 0.04), Zs(428), '崖宅 +412~+440m', 'xs b halo end'));
  o.push(txt(Ys(-0.68), Zs(182), `风草甸 ~${meadowLevel}m (三座垂直发射井盖)`, 'xs b halo mid'));
  o.push(txt(Ys((l0 + l1) * 0.5), Zs(154), `镜湖 (水面 ${lakeLevel}m, 深 24m)`, 'xs b halo mid'));
  o.push(txt(Ys(0.35), Zs(108), '北缘缺口与帘瀑投影 (~90m 落差)', 'xs halo'));
  o.push(txt(Ys(0.56), Zs(22), '黑砾湾峡湾', 'xs b halo mid'));

  o.push(txt(Ys((hy0 + hy1) * 0.5), Zs(88), '机库洞厅 (+70~+115m)', 'xs b mid'));
  o.push(txt(Ys(Y0 - 0.02), Zs(102), '南发射口 +95m', 'xs b halo end'));
  o.push(txt(Ys((py0 + py1) * 0.5), Zs(-42), '潜艇内港 (−95~+25m)', 'xs b whalo mid'));
  o.push(txt(Ys(Y0 - 0.06), Zs(-76), '主闸门 −80m', 'xs b whalo end'));
  o.push(txt(Ys(-0.80), Zs(-180), '工坊 A', 'xs b mid'));
  o.push(txt(Ys(-0.46), Zs(-180), '工坊 B (−240~−125m)', 'xs b mid'));
  o.push(txt(Ys(-0.72), Zs(-317), '聚变堆 −320m', 'xs b mid'));
  o.push(txt(Ys(-0.41), Zs(-326), '中枢 AI −330m', 'xs b mid'));
  o.push(txt(Ys(-0.39), Zs(-482), '地下城 (−535~−440m · 3层8舱段 · 100人末日自持)', 'xs b whalo'));
  o.push(txt(Ys(Y0 - 0.23), Zs(-502), '深海脱出口 −500m', 'xs b whalo end'));
  o.push(txt(Ys(-0.45), Zs(-648), '远古基核整体防护壳体 (延伸至 −670m)', 'xs b whalo'));
  o.push(txt(FX + 12, Zs(-260), '南太平洋深潜崖 (无大陆架)', 'xs whalo'));

  o.push(`</g>`);

  // 边框、海拔轴与比例尺
  o.push(`<rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
  o.push(txt(FX + 10, FY + 18, '南 B (外海大洋)', 't b halo'));
  o.push(txt(FX + FW - 10, FY + 18, '北 B′ (黑砾湾)', 't b halo end'));
  for (let z = -700; z <= 500; z += 100) {
    o.push(`<line x1="${FX - 5}" y1="${r(Zs(z))}" x2="${FX}" y2="${r(Zs(z))}" stroke="${C.ink}"/>`);
    o.push(txt(FX - 8, Zs(z) + 3.5, `${z > 0 ? '+' + z : z}m`, 'xs end'));
  }
  for (let yk = -1.5; yk <= 0.5; yk += 0.5) {
    o.push(`<line x1="${r(Ys(yk))}" y1="${FY + FH}" x2="${r(Ys(yk))}" y2="${FY + FH + 5}" stroke="${C.ink}"/>`);
    o.push(txt(Ys(yk), FY + FH + 16, `y = ${yk > 0 ? '+' + yk : yk} km`, 'xs mid'));
  }
  o.push(`<g transform="translate(${FX + FW - 185},${FY + FH - 22})">
    <rect x="-8" y="-13" width="182" height="22" rx="4" fill="rgba(255,255,255,.86)"/>
    <rect width="${r(250 * ky)}" height="5" fill="${C.ink}"/>
    <text x="${r(250 * ky + 7)}" y="5" class="xs">水平 250 米</text>
  </g>`);
  o.push(`</svg>`);

  return { svg: o.join('\n'), Y0, Y1, l0, l1, crestZ };
}

// ═════════ 图 4: 主崖与崖宅 1:1 真实比例剖面图 (cliffSVG) ═════════
function cliffSVG() {
  const W = 960, Hh = 780, FX4 = 68, FY4 = 56, FW4 = 844, FH4 = 684;
  // 水平与垂直严格 1:1 同比例!
  // z ∈ [-115, +485] m (Δz = 600 m) => k = 684 / 600 = 1.14 px/m
  // s ∈ [-230, +510] m (Δs = 740 m, s=0 为南岸海面崖脚, 向北岛内为正)
  const zMin = -115, zMax = 485, sMin = -230;
  const k = FH4 / (zMax - zMin); // 1.14 px/m
  const Xs = s => FX4 + (s - sMin) * k;
  const Zs = z => FY4 + FH4 - (z - zMin) * k;
  const Q = (s, z) => `${r(Xs(s))},${r(Zs(z))}`;

  // 主崖 1:1 完整轮廓: 水下深潜崖 (-230~0m) → 三段式海蚀巨崖 (0~124m, +460m) → 刀刃山脊北坡急跌至火山口内壁与风草甸 (~165m)
  const northSlope = [
    [132, 456], [148, 434], [172, 392], [208, 332], [255, 268], [315, 212], [385, 176], [450, 166], [520, 165],
  ];
  const fullProf = [
    [-230, -295], [-160, -225], [-120, -180], [-65, -108], [-45, -82], [-18, -40],
    ...CLIFF,
    ...northSlope,
  ];
  const rockPts = [[Xs(sMin), Zs(zMin)], ...fullProf.map(([s, z]) => [Xs(s), Zs(Math.max(zMin - 20, z))]), [Xs(520), Zs(zMin)]];

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">`);
  o.push(`<defs>
    <style>${BASE_CSS}</style>
    <clipPath id="cliffClip"><rect x="${FX4}" y="${FY4}" width="${FW4}" height="${FH4}"/></clipPath>
    <linearGradient id="basaltSec" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5d6269"/>
      <stop offset="55%" stop-color="#474c53"/>
      <stop offset="100%" stop-color="#363a40"/>
    </linearGradient>
  </defs>`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#f5f7f8"/>`);
  o.push(txt(FX4, 26, '主崖与崖宅 · 1:1 真实比例横剖面 (3.1 版)', 'title'));
  o.push(txt(FX4, 43, '水平与垂直同比例: 展现 +412~+440 米精悍竖向崖宅悬于 460 米巨崖之巅的真实压迫感, 顶层后廊直穿刀刃山脊俯瞰火山口', 'sub'));

  o.push(`<g clip-path="url(#cliffClip)">`);
  o.push(`<rect x="${FX4}" y="${FY4}" width="${FW4}" height="${FH4}" fill="#e4edf2"/>`);
  // 大洋海水 (z <= 0)
  o.push(`<rect x="${FX4}" y="${r(Zs(0))}" width="${r(Xs(40) - FX4)}" height="${r(Zs(zMin) - Zs(0))}" fill="#7fa2b7"/>`);
  o.push(`<line x1="${FX4}" y1="${r(Zs(0))}" x2="${r(Xs(5))}" y2="${r(Zs(0))}" stroke="#1b435c" stroke-width="1.5"/>`);

  // 巨崖玄武岩体与北坡云雾林植被表层
  o.push(`<path d="${pathPts(rockPts, true)}" fill="url(#basaltSec)" stroke="#1e2328" stroke-width="1.4"/>`);
  // 北坡云雾林树冠带 (s > 175m)
  const forestBand = northSlope.filter(p => p[0] >= 170);
  const fPts = [
    ...forestBand.map(([s, z]) => [Xs(s), Zs(z + 9)]),
    ...[...forestBand].reverse().map(([s, z]) => [Xs(s), Zs(z)]),
  ];
  o.push(`<path d="${pathPts(fPts, true)}" fill="${C.forest}" opacity="0.82"/>`);

  // 柱状节理竖裂纹 (上层 +250 ~ +460m 尤为显著)
  for (let s = 22; s <= 155; s += 9) {
    const zTop = s <= 124 ? lerpLine(CLIFF, s) : lerpLine([[124, 460], ...northSlope], s);
    o.push(`<line x1="${r(Xs(s))}" y1="${r(Zs(zTop - 3))}" x2="${r(Xs(s))}" y2="${r(Zs(Math.max(-90, zTop - 210)))}" stroke="#2f3339" stroke-width="0.7" opacity="0.55"/>`);
  }

  // 远古基核防护壳体边界 (s >= 135m 向深处包覆)
  o.push(`<path d="M${Q(116, 444)} L${Q(142, 446)} L${Q(240, 250)} L${Q(310, 120)} L${Q(330, -115)}" fill="none" stroke="#9ec4d8" stroke-width="2" stroke-dasharray="8 4"/>`);

  // ── 1) 崖宅 (+412 ~ +440m, 嵌于 s ≈ 97~100m 上层平直绝壁岩槽) ──
  // 底部重工实验舱 (412~423m, 向岩体内部纵深 60m: s = 97 ~ 157m)
  o.push(`<polygon points="${Q(97, 412)} ${Q(157, 412)} ${Q(157, 422.5)} ${Q(98, 422.5)}" fill="${C.chamber}" stroke="#182026" stroke-width="1.1"/>`);
  // 能量核心与吊车梁
  o.push(`<circle cx="${r(Xs(136))}" cy="${r(Zs(416.5))}" r="${r(3.2 * k)}" fill="#57bed4" stroke="#1b2830" stroke-width="0.8"/>`);
  // 底部轻薄折角装甲腹板收束于 +412m 绝壁 + 纤薄悬挑起降甲板 (+413m, 向南平直探出 20m: s = 77 ~ 98m)
  o.push(`<polygon points="${Q(77, 413.6)} ${Q(98, 413.6)} ${Q(98, 411.8)} ${Q(92, 412.2)} ${Q(77, 412.7)}" fill="${C.titaniumLight}" stroke="#182026" stroke-width="1.1"/>`);
  // 甲板上停靠座机侧剖面
  o.push(`<polygon points="${Q(81, 414.8)} ${Q(88, 416.2)} ${Q(94, 414.8)} ${Q(93, 413.8)} ${Q(82, 413.8)}" fill="#7f8e9b" stroke="#182026" stroke-width="0.8"/>`);

  // 中央两层钢化玻璃幕墙主厅 (423~435m, 前方通透幕墙 s = 95.5 ~ 118m + 后方岩内私密起居生活舱 s = 118 ~ 146m)
  o.push(`<rect x="${r(Xs(95.5))}" y="${r(Zs(435))}" width="${r(22.5 * k)}" height="${r(12 * k)}" fill="#2c4456" stroke="#182026" stroke-width="1"/>`);
  o.push(`<rect x="${r(Xs(96.5))}" y="${r(Zs(434.2))}" width="${r(20.5 * k)}" height="${r(10.5 * k)}" fill="${C.amber}" opacity="0.65"/>`);
  o.push(`<line x1="${r(Xs(95.5))}" y1="${r(Zs(429))}" x2="${r(Xs(146))}" y2="${r(Zs(429))}" stroke="#1c252c" stroke-width="1.2"/>`);
  o.push(`<rect x="${r(Xs(118))}" y="${r(Zs(435))}" width="${r(28 * k)}" height="${r(12 * k)}" fill="${C.chamber}" stroke="#182026" stroke-width="1"/>`);
  // 轻薄钛金属前侧鞘轮廓线
  o.push(`<line x1="${r(Xs(95.5))}" y1="${r(Zs(440))}" x2="${r(Xs(95.5))}" y2="${r(Zs(423))}" stroke="#cad5de" stroke-width="1.8"/>`);

  // 顶部装甲冠层 (435~440m, 平切嵌入崖顶肩部 + 向北穿通狭窄刀刃山脊的后通道 s = 95.5 ~ 149m!)
  o.push(`<polygon points="${Q(95.2, 440)} ${Q(114, 440)} ${Q(114, 435.2)} ${Q(95.2, 435.2)}" fill="${C.titanium}" stroke="#182026" stroke-width="1.1"/>`);
  // 后山廊道直穿北坡观景口 (s = 114 ~ 149m, z = 435.5m)
  o.push(`<polygon points="${Q(114, 438.4)} ${Q(149, 437.2)} ${Q(149, 434.2)} ${Q(114, 435.4)}" fill="#e5dfd3" stroke="#182026" stroke-width="0.9"/>`);

  // 竖井: 从崖宅后方 (s = 142m) 笔直下通机库洞厅与潜艇内港
  o.push(`<rect x="${r(Xs(140))}" y="${r(Zs(435))}" width="${r(5 * k)}" height="${r(Zs(-95) - Zs(435))}" fill="#d5cfc3" stroke="#20262c" stroke-width="0.9"/>`);

  // ── 2) 南水平电磁弹射口 (+95m, 中层玄武岩壁 s = 34m) 与弹射隧道 ──
  o.push(`<polygon points="${Q(33, 99)} ${Q(520, 93)} ${Q(520, 86)} ${Q(33, 92)}" fill="#ebb9a4" stroke="${C.tunnel}" stroke-width="1.1"/>`);
  // 机库洞厅南端局部 (s = 420 ~ 520m, +70 ~ +115m)
  o.push(`<path d="M${Q(420, 70)} L${Q(420, 102)} Q${Q(470, 118)} ${Q(520, 114)} L${Q(520, 70)} Z" fill="${C.chamber}" stroke="#1c2228" stroke-width="1.2"/>`);

  // ── 3) 水下主闸门 (−80m, 藏于深潜崖脚崩积巨石裙 s = -45m 下, 经 350m 隧道通潜艇内港 s = 280~520m) ──
  // 崖脚崩积巨石块示意
  for (const [bs, bz, br] of [[-24, -44, 6], [-34, -60, 7], [-44, -73, 6.5], [-14, -24, 5.5]]) {
    o.push(`<circle cx="${r(Xs(bs))}" cy="${r(Zs(bz))}" r="${r(br * k)}" fill="#3d4249" stroke="#22262b" stroke-width="0.8"/>`);
  }
  o.push(`<polygon points="${Q(-46, -76)} ${Q(280, -70)} ${Q(280, -84)} ${Q(-46, -88)}" fill="#6a94ad" stroke="#1b394d" stroke-width="1.1"/>`);
  // 潜艇内港局部 (s = 280 ~ 520m, -95 ~ +25m)
  o.push(`<path d="M${Q(280, -95)} L${Q(280, 12)} Q${Q(390, 28)} ${Q(520, 24)} L${Q(520, -95)} Z" fill="${C.chamber}" stroke="#1c2228" stroke-width="1.2"/>`);
  o.push(`<rect x="${r(Xs(280))}" y="${r(Zs(0))}" width="${r(240 * k)}" height="${r(95 * k)}" fill="#6a94ad"/>`);

  // ── 三段式主崖括线标注 (左侧海面与空中空白区) ──
  const brkX = Xs(-216);
  const tiers = [
    [460, 250, '上层 +250 ~ +460 m', '近乎垂直的柱状节理绝壁;', '+412~+440 m 嵌竖向崖宅, 顶为刀刃山脊'],
    [250,  40, '中层 +40 ~ +250 m',  '约 65° 阶梯状玄武岩壁:', '80° 陡坎夹 8–15 m 碎石窄台'],
    [ 40, -40, '底层 −40 ~ +40 m',   '深潜崖与海蚀崩积巨石裙,', '水下岩壁继续近乎垂直插向深海'],
  ];
  for (const [za, zb, nm, d1, d2] of tiers) {
    o.push(`<path d="M${r(brkX + 7)},${r(Zs(za) + 2)} h-7 V${r(Zs(zb) - 2)} h7" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
    const my = (Zs(za) + Zs(zb)) * 0.5;
    o.push(txt(brkX + 13, my - 9, nm, 's b halo'));
    o.push(txt(brkX + 13, my + 5, d1, 'xs halo'));
    o.push(txt(brkX + 13, my + 18, d2, 'xs halo'));
  }

  // 细部引线说明
  const LB = (s0, z0, s1, z1, label, cls = 's halo') => {
    o.push(`<path d="M${Q(s0, z0)} L${Q(s1, z1)}" fill="none" stroke="${C.ink}" stroke-width="0.85"/>`);
    const dx = cls.includes('end') ? -5 : 5;
    o.push(txt(Xs(s1) + dx, Zs(z1) + 4, label, cls));
  };
  LB(124, 460, 82, 474, '主崖岬刀刃绝顶 +460 m', 's b halo end');
  LB(95, 438, 48, 448, '顶部装甲冠层 (435–440 m)', 'xs b halo end');
  LB(95, 429, 44, 430, '双层钢化玻璃幕墙主厅 (423–435 m)', 'xs b halo end');
  LB(78, 413, 38, 412, '纤薄悬挑起降甲板 +413 m (底缘锚入 +412 m)', 'xs b halo end');
  LB(149, 436, 205, 448, '山体后通道: 穿出刀刃山脊直望火山口与镜湖', 'xs b halo');
  LB(155, 417, 210, 416, '底部重工实验舱 (向岩内纵深 60 m)', 'xs b halo');
  LB(143, 305, 195, 305, '垂直联络竖井 (下通机库与内港)', 'xs whalo');
  LB(34, 95, -8, 114, '南水平弹射口 +95 m (战机贴海冲出)', 's b halo end');
  LB(445, 92, 395, 134, '机库洞厅 (+70~+115 m, 位于风草甸正下方)', 'xs b whalo end');
  LB(-46, -82, -62, -98, '主闸门 −80 m (藏在深潜崖脚巨石裙下)', 'xs b whalo end');
  LB(350, -35, 350, -35, '潜艇内港 (−95~+25 m, 距崖面 280 m 起)', 'xs b whalo');

  o.push(`</g>`);

  // 坐标框与 1:1 比例尺
  o.push(`<rect x="${FX4}" y="${FY4}" width="${FW4}" height="${FH4}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
  o.push(txt(FX4 + 10, FY4 + 18, '南 (外海深潜崖)', 't b halo'));
  o.push(txt(FX4 + FW4 - 10, FY4 + 18, '北 (火山口盆地 · 风草甸)', 't b halo end'));
  for (let z = -100; z <= 450; z += 50) {
    o.push(`<line x1="${FX4 - 5}" y1="${r(Zs(z))}" x2="${FX4}" y2="${r(Zs(z))}" stroke="${C.ink}"/>`);
    o.push(txt(FX4 - 8, Zs(z) + 3.5, `${z > 0 ? '+' + z : z}m`, 'xs end'));
  }
  for (let s = -200; s <= 500; s += 100) {
    o.push(`<line x1="${r(Xs(s))}" y1="${FY4 + FH4}" x2="${r(Xs(s))}" y2="${FY4 + FH4 + 5}" stroke="${C.ink}"/>`);
    o.push(txt(Xs(s), FY4 + FH4 + 16, `${s > 0 ? '+' + s : s}m`, 'xs mid'));
  }
  o.push(`<g transform="translate(${FX4 + 14},${FY4 + FH4 - 22})">
    <rect x="-6" y="-13" width="215" height="21" rx="4" fill="rgba(255,255,255,.88)"/>
    <rect width="${r(50 * k)}" height="5" fill="${C.ink}"/>
    <text x="${r(50 * k + 8)}" y="5" class="xs b">50 米 (水平与垂直严格 1:1 同比例)</text>
  </g>`);
  o.push(`</svg>`);
  return o.join('\n');
}

// ═════════ 6. 生成 SVG 与 岛屿草图.html ═════════
const sec = sectionSVG();
const figs = [
  ['平面图', planSVG()],
  ['南立面图', elevSVG()],
  ['南北剖面图', sec.svg],
  ['主崖剖面图', cliffSVG()],
];
for (const [name, svg] of figs) writeFileSync(join(here, `${name}.svg`), svg, 'utf8');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>岛屿基地草图 · 3.1 定稿版</title>
<style>
  body{margin:0;background:#e9eef2;color:#1d2832;font-family:${FONT};line-height:1.65}
  header{background:#141e27;color:#eef4f8;padding:20px 18px;border-bottom:1px solid #2b3c4a}
  header .wrap{max-width:1020px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
  header h1{font-size:22px;margin:0;letter-spacing:.5px}
  header p{margin:4px 0 0;color:#9fb2c0;font-size:13.5px}
  header a.btn{color:#181307;background:#ebb35a;text-decoration:none;font-weight:700;font-size:13.5px;padding:7px 15px;border-radius:6px}
  main{max-width:1020px;margin:0 auto;padding:22px 16px 52px}
  figure{margin:0 0 24px;background:#fff;border:1px solid #cdd6de;border-radius:8px;padding:12px;overflow:hidden;box-shadow:0 2px 10px rgba(15,25,35,.05)}
  figure svg{display:block;width:100%;height:auto}
  figcaption{font-size:13px;color:#425360;padding:10px 6px 2px;border-top:1px solid #eef2f5;margin-top:8px}
  figcaption b{color:#1a252e}
</style></head><body>
<header><div class="wrap">
  <div>
    <h1>岛屿基地工程草图 · 3.1 定稿版</h1>
    <p>依据《岛屿设定.md》3.1 同一套几何地形与洞室参数计算生成(平面图 · 南立面与崖宅详图 · 南北纵剖面 · 主崖 1:1 剖面)。</p>
  </div>
  <a class="btn" href="/">进入三维漫游 →</a>
</div></header>
<script>try{if(window.parent!==window&&window.frameElement)document.querySelector('header').style.display='none';}catch(e){}</script>
<main>
<figure>${figs[0][1]}<figcaption><b>图 1 · 平面总图</b>: 向北开口的马蹄形破火山口主岛(面积约 ${area.toFixed(1)} km²)与裂隙海峡劈出的锯齿状东屿; 北岸为黑曜石砾滩峡湾(黑砾湾)与百米悬瀑, 镜湖(138m)与风草甸(165m)深锁于刀刃山脊巨碗内, 唯一地面营区“岩隙营房”隐于镜湖西侧背风岩壁褶皱。</figcaption></figure>
<figure>${figs[1][1]}<figcaption><b>图 2 · 南立面图与崖宅 1:1 正立面</b>: 上图展现 460 米主崖岬、外海 260 米南剑峰与一线天海蚀拱门的高耸剪影; 下图为 3.1 定稿崖宅(+412~+440m, 宽 34m × 高 28m): 轻薄冷灰钛金属装甲鞘包裹双层防弹钢化玻璃幕墙主厅、顶部观测冠层、内凹重工实验舱与纤薄起降台。</figcaption></figure>
<figure>${figs[2][1]}<figcaption><b>图 3 · 南北纵剖面 B–B′</b>: 自南太平洋深潜崖穿过 460 米刀刃主脊、风草甸、镜湖至黑砾湾; 基核整体防护壳体向下延伸至 −670 米, 内部错落排布机库洞厅(+70~+115m)、潜艇内港(−95~+25m)、工坊、聚变堆(−320m)、AI 中枢与三层八舱段末日地下城(−535~−440m)。</figcaption></figure>
<figure>${figs[3][1]}<figcaption><b>图 4 · 主崖与崖宅 1:1 真实比例剖面</b>: 水平与垂直严格等比例。崖宅自崖顶肩部垂降嵌于上层柱状玄武岩槽, 底缘在 +412 米干净收束锚入绝壁, 下方留有整整四百米纯粹自然绝壁; 顶层后廊直接穿出狭窄刀刃山脊俯瞰火山口与镜湖。</figcaption></figure>
</main></body></html>`;
writeFileSync(join(root, '岛屿草图.html'), html, 'utf8');

const f1 = n => n.toFixed(2);
console.log(`面积 ${area.toFixed(2)} km² | 东西 ${f1(ext[0])}~${f1(ext[1])} km (${f1(ext[1] - ext[0])} km) | 南北 ${f1(ext[2])}~${f1(ext[3])} km (${f1(ext[3] - ext[2])} km)`);
console.log(`最高点 ${Math.round(peak.h)} m @ (${f1(peak.x)}, ${f1(peak.y)}) | 镜湖水面 ${lakeLevel} m | 风草甸 ${meadowLevel} m`);
console.log('尖塔与山峰:', SPIRES.map(s => `${s[4]} ${Math.round(H(s[0], s[1]))}m`).join(' | '), `| 东屿 ${ISLET.h}m | 南剑峰 ${SWORD_PEAK.h}m`);
console.log('崖宅岸点', villaCoast.map(f1).join(','), '| 剖面处崖顶', Math.round(sec.crestZ), 'm');
console.log('弹射隧道:', TUNNELS.map(t => `${t.name}(+${t.z}m) 出口(${f1(t.exit[0])},${f1(t.exit[1])}) 长 ${t.len.toFixed(2)} km`).join(' | '));
console.log(`西闸门 (${f1(WEST_GATE.pos[0])},${f1(WEST_GATE.pos[1])}) ${WEST_GATE.depth}m 隧道长 ${WEST_GATE.len.toFixed(2)} km`);

// ═════════ 7. 三维数据导出 (供 三维/ 目录下的 three.js 场景使用) ═════════
{
  const out3 = join(root, '三维', 'data');
  mkdirSync(out3, { recursive: true });
  // 7 米高精度网格, 覆盖主岛、东屿、南剑峰、北暗礁带及四周深潜崖海域
  const G = { x0: -2.65, y0: -2.15, step: 0.007, nx: 708, ny: 622 };
  const N = G.nx * G.ny, top = CLIFF[CLIFF.length - 1][1]; // 460
  // 高度场版三段式主崖剖面
  const HF = CLIFF;

  // 粗网格加速岸线距离场采样
  const CG = { x0: G.x0, y0: G.y0, step: 0.035, nx: Math.ceil(((G.nx - 1) * G.step) / 0.035) + 2, ny: Math.ceil(((G.ny - 1) * G.step) / 0.035) + 2 };
  const byKind = k => coast.filter(s => s.kind === k).map(s => s.p);
  const beachP = byKind('b'), rockP = byKind('r'), kP = byKind('k'), cP = byKind('c'), cliffAll = cliffS.map(s => s.p);
  const mk = () => new Float32Array(CG.nx * CG.ny);
  const gAll = mk(), gC = mk(), gK = mk(), gNo = mk(), gBe = mk(), gRk = mk(), gCr = mk();
  for (let j = 0; j < CG.ny; j++) for (let i = 0; i < CG.nx; i++) {
    const x = CG.x0 + i * CG.step, y = CG.y0 + j * CG.step, idx = j * CG.nx + i;
    gAll[idx] = Math.sqrt(dist2Pts(cliffAll, x, y));
    gC[idx] = Math.sqrt(dist2Pts(cP, x, y));
    gK[idx] = Math.sqrt(dist2Pts(kP, x, y));
    gNo[idx] = Math.sqrt(dist2Pts(northPts, x, y));
    gBe[idx] = Math.sqrt(dist2Pts(beachP, x, y));
    gRk[idx] = Math.sqrt(dist2Pts(rockP, x, y));
    let hs = 0, ws = 0;
    for (const s of cliffS) { const d2 = (s.p[0] - x) ** 2 + (s.p[1] - y) ** 2, w = 1 / (d2 * d2 + 1e-7); ws += w; hs += w * s.hc; }
    gCr[idx] = hs / ws;
  }
  const sAll = sampler(gAll, CG), sC = sampler(gC, CG), sK = sampler(gK, CG), sNo = sampler(gNo, CG), sBe = sampler(gBe, CG), sRk = sampler(gRk, CG), sCr = sampler(gCr, CG);

  const segsOf = test => {
    const out = [];
    coast.forEach((s, i) => { const t = coast[(i + 1) % coast.length]; if (test(s.kind) && test(t.kind)) out.push([s.p[0], s.p[1], t.p[0], t.p[1]]); });
    return out;
  };
  const segAll = segsOf(k => k === 'c' || k === 'r'), segC = segsOf(k => k === 'c');
  const dSeg = (segs, x, y) => {
    let m = Infinity, qx = x, qy = y;
    for (const [ax, ay, bx, by] of segs) {
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      const u = l2 > 1e-12 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2) : 0;
      const px = ax + u * vx, py = ay + u * vy, d = (x - px) ** 2 + (y - py) ** 2;
      if (d < m) { m = d; qx = px; qy = py; }
    }
    return [Math.sqrt(m), qx, qy];
  };

  const toPx3 = p => [(p[0] - G.x0) / G.step + 0.5, (p[1] - G.y0) / G.step + 0.5];
  const land = scanMask(coastPts.map(toPx3), G.nx, G.ny);
  const lakeM = scanMask(lakePts.map(toPx3), G.nx, G.ny);
  const meadM = scanMask(meadowPts.map(toPx3), G.nx, G.ny);
  const isletM = scanMask(isletPts.map(toPx3), G.nx, G.ny);

  // mat 编码: 0 海底, 1 云雾林, 2 火山灰草甸(风草甸), 3 黑曜石砾滩(黑砾湾), 4 玄武岩绝壁/尖塔, 5 镜湖湖底, 6 水下暗礁盘
  const zf = new Float32Array(N), mat = new Uint8Array(N);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const x = G.x0 + i * G.step, y = G.y0 + j * G.step, idx = j * G.nx + i;
    let z, m;
    if (lakeM[idx]) {
      const dEdge = Math.sqrt(dist2Pts(lakePts, x, y));
      z = lakeLevel - Math.min(LAKE.depth, 0.9 + dEdge * 155);
      m = 5;
    } else if (isletM[idx]) {
      z = H(x, y);
      const dIslEdge = Math.sqrt(dist2Pts(isletPts, x, y)) * 1000;
      if (dIslEdge < 62) {
        const fac = clamp(dIslEdge / 62);
        z = Math.max(1.5, z * Math.pow(fac, 0.52));
      }
      m = z > 175 || dIslEdge < 55 ? 4 : 1;
    } else if (land[idx]) {
      z = H(x, y);
      m = 1;
      // 悬崖岸段按三段式剖面急升至崖顶山脊
      if (sAll(x, y) < 0.36 && sBe(x, y) > 0.045) {
        const [dd, qx, qy] = dSeg(segAll, x, y);
        const localCrest = Math.max(sCr(x, y), 25);
        const hc = Math.max(localCrest, H(qx, qy), z);
        const spanM = clamp(hc / top, 0.32, 1.0) * 124; // 最高 124m 水平内缩即达 460m 绝顶!
        const se = (dd * 1000 * 124) / spanM;
        if (se < 124) {
          z = Math.max(0.8, (hc * lerpLine(HF, se)) / top);
          m = 4;
          z += 2.0 * fbm(x * 60, y * 60, 2, 991) * Math.min(1, z / 12);
        } else if (se < 250) {
          const ridgeTop = Math.max(z, hc * 0.97);
          z = lerp(ridgeTop, z, sstep(124, 250, se));
        }
      }
      if (meadM[idx]) {
        m = 2;
      } else if (sBe(x, y) < 0.055 && z < 12) {
        // 黑砾湾黑曜石砾滩平缓入水
        const dB = Math.sqrt(dist2Pts(beachP, x, y)) * 1000;
        z = Math.min(z, 0.4 + dB * 0.14);
        m = 3;
      } else if (sK(x, y) < 0.045 && z < 26) {
        const dK = Math.sqrt(dist2Pts(kP, x, y)) * 1000;
        z = Math.min(z, 1.2 + dK * 0.32 + 1.4 * Math.abs(vnoise(x * 90, y * 90, 33)));
        m = 4;
      }
      // 高海拔刀刃山脊与玄武岩尖塔裸露黑岩
      if (m === 1 && (z > 305 || (z > 255 && ridged(x * 9, y * 9, 2, 77) > 0.66))) m = 4;
    } else {
      // 海底地形: 一线天水道百米深槽 + 北侧暗礁斜坡 + 南东深潜崖直落 -750m
      const dMain = Math.sqrt(dist2Pts(coastPts, x, y)) * 1000;
      const dIsl = Math.sqrt(dist2Pts(isletPts, x, y)) * 1000;
      const dSea = Math.min(dMain, dIsl);
      const inStrait = x > 1.18 && x < 1.62 && y > -0.35 && y < 0.58;
      if (inStrait) {
        // 一线天水道: 水深约 100m 的陡壁海底裂槽
        z = -Math.min(108, 6 + dSea * 2.1 + 8 * Math.abs(vnoise(x * 35, y * 35, 81)));
      } else if (y > 0.34 && x > -1.55 && x < 0.95 && sC(x, y) > 0.16) {
        // 黑砾湾外海火山崩积暗礁坡 (但非浅水白沙大潟湖, 水深 -12 ~ -140m, 航道槽更深)
        const dChan = distPolyLine(channelPath, x, y);
        const chanCut = dChan < 0.09 ? -18 * (1 - dChan / 0.09) : 0;
        z = -(2.5 + dSea * 0.16) + chanCut;
      } else {
        // 深潜崖海底: 120m 外 -180m, 300m 外 -350m, 1000m 外 -750m
        z = lerpLine(APRON, -dSea);
      }
      m = 0;
    }
    zf[idx] = z;
    mat[idx] = m;
  }

  // 水下暗礁盘与共生礁头抬升至水面下 -0.8 ~ -2.8m
  for (const f of reefs) {
    const pts = blob(f, f.seed, 22, 1.3), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - G.x0) / G.step)), i1 = Math.min(G.nx - 1, Math.ceil((Math.max(...xs) - G.x0) / G.step));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - G.y0) / G.step)), j1 = Math.min(G.ny - 1, Math.ceil((Math.max(...ys) - G.y0) / G.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * G.nx + i, x = G.x0 + i * G.step, y = G.y0 + j * G.step;
      if (land[idx] || isletM[idx] || !pip(pts, x, y)) continue;
      zf[idx] = Math.max(zf[idx], (f.head ? -2.2 : -1.1) - 0.9 * Math.abs(vnoise(x * 160, y * 160, 66)));
      mat[idx] = 6;
    }
  }

  const hm = new Int16Array(N);
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < N; k++) {
    hm[k] = Math.round(clamp(zf[k], -3200, 3200) * 10);
    if (zf[k] < zmin) zmin = zf[k];
    if (zf[k] > zmax) zmax = zf[k];
  }
  writeFileSync(join(out3, 'height.bin'), Buffer.from(hm.buffer));
  writeFileSync(join(out3, 'mat.bin'), Buffer.from(mat.buffer));

  const r4 = v => Math.round(v * 1e4) / 1e4, P2 = p => [r4(p[0]), r4(p[1])];
  const seaNormal = p => {
    let bi = 0, bd = Infinity;
    coast.forEach((s, i) => { const d = (s.p[0] - p[0]) ** 2 + (s.p[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
    const m = coast.length, a = coast[(bi - 5 + m) % m].p, b = coast[(bi + 5) % m].p;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if (onMainLand(p[0] + nx * 0.04, p[1] + ny * 0.04)) { nx = -nx; ny = -ny; }
    return [r4(nx), r4(ny)];
  };

  // 为崖宅计算主崖岬精确面朝外海方向 (默认正南偏微西) 及 +412~+440m 槽位锚点
  const villaN = seaNormal(villaCoast);
  // 搜索主崖岬沿 -villaN 方向达到 ~425m 的精确悬崖立面位置, 供 villa.js 精准嵌入 +412~+440m!
  let villaSlotDist = 98;
  for (let s = 30; s <= 150; s += 2) {
    const tx = villaCoast[0] - villaN[0] * (s / 1000);
    const ty = villaCoast[1] - villaN[1] * (s / 1000);
    const gi = Math.round((tx - G.x0) / G.step), gj = Math.round((ty - G.y0) / G.step);
    if (gi >= 0 && gi < G.nx && gj >= 0 && gj < G.ny) {
      const hz = zf[gj * G.nx + gi];
      if (hz >= 426) { villaSlotDist = s; break; }
    }
  }

  const meta = {
    version: '3.1',
    grid: G,
    heightScale: 0.1,
    lakeLevel,
    meadowLevel,
    peak: { x: r4(peak.x), y: r4(peak.y), h: Math.round(peak.h) },
    lake: lakePts.map(P2),
    meadow: meadowPts.map(P2),
    river: riverPts.map(P2),
    falls: FALLS,
    gullies: gullyPts.map(g => g.map(P2)),
    feeders: feederPts.map(g => g.map(P2)),
    villa: {
      p: P2(villaCoast),
      n: villaN,
      slotDistM: villaSlotDist,
      zMin: 412,
      zMax: 440,
      deckZ: 413,
      widthM: 34,
    },
    seaArch: SEA_ARCH,
    swordPeak: SWORD_PEAK,
    spires: SPIRES.map(s => ({ name: s[4], p: [s[0], s[1]], h: s[5], r: s[3] })),
    tunnels: TUNNELS.map(t => ({ name: t.name, p: P2(t.exit), z: t.z, n: seaNormal(t.exit) })),
    mainGate: { p: P2(MAIN_GATE.pos), depth: MAIN_GATE.depth, n: villaN },
    westGate: { p: P2(WEST_GATE.pos), depth: WEST_GATE.depth, n: seaNormal(WEST_GATE.pos) },
    stacks: STACKS.map(s => [s[0], s[1], s[2], s[3], s[4] || '']),
    buoys: gens.map(P2),
    camps: CAMPS,
    silos: SILOS,
    sally: SALLY,
    islet: ISLET,
    labels: [
      ['主崖岬 460m', -0.22, -1.21],
      ['西崖角 340m', -1.45, -1.02],
      ['东南崖角 290m', 0.92, -1.05],
      ['西尖塔 365m', -1.25, -0.42],
      ['东尖塔 310m', 0.68, -0.25],
      ['风草甸 165m', MEADOW.x, MEADOW.y],
      ['镜湖 138m', LAKE.x, LAKE.y],
      ['帘瀑', FALLS[0], FALLS[1]],
      ['黑砾湾', 0.02, 0.50],
      ['岩隙营房', CAMPS[0][0], CAMPS[0][1]],
      ['西岬', -0.88, 1.62],
      ['东岬', 1.00, 0.79],
      ['东屿 280m', ISLET.x, ISLET.y],
      ['一线天水道', 1.44, 0.12],
      ['海蚀拱门', 1.38, 0.42],
      ['南剑峰 260m', SWORD_PEAK.x, SWORD_PEAK.y],
      ['东峡谷', 1.14, -0.52],
      ['西裂谷', -0.82, -0.72],
      ['裂湾', 0.22, -0.76],
      ['东礁滩', 1.42, -0.10],
      ['西礁滩', -1.88, -0.05],
      ['北暗礁航道', r4(channel[0]), r4(channel[1])],
    ],
  };
  writeFileSync(join(out3, 'island.json'), JSON.stringify(meta), 'utf8');
  console.log(`三维数据 (3.1): ${G.nx}×${G.ny} 网格, 高程 ${zmin.toFixed(0)} ~ ${zmax.toFixed(0)} m, 崖宅槽距 ${villaSlotDist} m → 三维/data/`);
}
