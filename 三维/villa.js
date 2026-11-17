// 崖宅:斜切折板外壳、斜肋玻璃幕墙、可进入的三层主厅与重工实验室、电梯、露台与起降坪。
// 局部坐标:u 沿崖面向东,y 为海拔,w 指向大海。主崖岬像船头一样向两侧后掠,
// 所以所有构件都以"崖面基准线 ref(u)"为起点,用 d 表示探出崖面的距离:w = ref(u) + d。
export function buildVilla({ THREE, heightAt, frame, terrainGeo, platforms, blockers, Hf, NX, NY }) {
  const g = frame.g, e = frame.m.elements, ox = e[12], oz = e[14], Tx = e[0], Tz = e[2], Nx = e[8], Nz = e[10];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const hash = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
  const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const V = (u, y, w) => new THREE.Vector3(u, y, w);
  const L = (pts, u) => { if (u <= pts[0][0]) return pts[0][1]; for (let i = 0; i + 1 < pts.length; i++) if (u <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (u - pts[i][0])) / (pts[i + 1][0] - pts[i][0]); return pts[pts.length - 1][1]; };
  const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-6; v += s) o.push(v); return o; };
  const along = (a, b, f, st = 2) => { const us = [a]; for (let u = Math.ceil(a / st) * st; u < b - 1e-6; u += st) if (u > a + 1e-6) us.push(u); us.push(b); return us.map(u => [u, f(u)]); };

  // ── 崖面位置:沿 w 方向从海上向内找到地形升到高度 z 的地方 ──
  const faceRaw = (u, z) => { let w = 60; for (; w > -66; w -= 0.5) if (heightAt(ox + Tx * u + Nx * w, oz + Tz * u + Nz * w) >= z) break; return w; };
  const U0 = -104, DU = 2, NU = 111, refRow = new Float32Array(NU), labRow = new Float32Array(NU);
  for (const [row, z] of [[refRow, 146], [labRow, 128]]) {
    const raw = Array.from({ length: NU }, (_, i) => faceRaw(U0 + i * DU, z));
    for (let i = 0; i < NU; i++) { let s = 0, n = 0; for (let k = -3; k <= 3; k++) if (raw[i + k] !== undefined) { s += raw[i + k]; n++; } row[i] = s / n; }
  }
  const sample = (row, u) => { const f = clamp((u - U0) / DU, 0, NU - 1.001), i = f | 0; return row[i] + (row[i + 1] - row[i]) * (f - i); };
  const ref = u => sample(refRow, u), refLab = u => sample(labRow, u);

  // ── 立面轮廓(取自南立面图,东端收短到岩体范围内) ──
  const zTop = u => L([[-56, 169], [68, 145]], u);                          // 主厅开口上缘 = 刃翼前缘
  const zBot = u => L([[-56, 169], [-36, 145], [52, 138], [68, 145]], u);   // 主厅开口下缘
  const zRoot = u => L([[-74, 176], [-32, 171], [88, 143]], u);             // 刃翼根部(贴崖)
  const zTip = u => L([[-74, 176], [-56, 169], [68, 145], [88, 143]], u);
  const dTip = u => 22 * clamp(Math.min((u + 74) / 18, (88 - u) / 22));
  const beamTop = u => L([[-46, 152], [-36, 145], [52, 138], [80, 136]], u);
  const beamMid = u => Math.min(beamTop(u) - 0.8, L([[-46, 150.6], [-28, 141.5], [68, 134.4], [80, 135]], u));
  const labTop = u => L([[-20, 137], [54, 132]], u);
  const beamBot = u => Math.min(beamMid(u) - 0.5, L([[-46, 150], [-30, 142.2], [-20, 137], [54, 132], [68, 133.6], [80, 134.4]], u));
  const dB = u => L([[-46, 1.5], [-36, 13], [52, 16.5], [80, 1.5]], u);
  const keelTop = u => L([[-26, 122], [-12, 120], [46, 120], [68, 133], [80, 135.4]], u);
  const keelBot = u => L([[-26, 121.4], [-14, 116], [52, 118], [80, 134.6]], u);
  const dK = u => L([[-26, 1], [-12, 16], [46, 16], [80, 1]], u);
  const inAtrium = (u, y) => u > -56 && u < 68 && y < zTop(u) && y > zBot(u);
  const inLab = (u, y) => y > 120 && y < labTop(u) && u > -12 - ((y - 120) * 8) / 17 && u < 46 + ((y - 120) * 8) / 12;

  // ── 程序纹理:灰度底图,由材质颜色着色;meters 是一张贴图覆盖的实际尺寸 ──
  const canvasTex = (size, meters, draw) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; draw(cv.getContext('2d'), size);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.meters = meters; return t;
  };
  const speckle = (c, s, n, alpha, seed) => { const r = rng(seed); for (let i = 0; i < n; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`; c.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3); } };
  const TEX = {
    stone: canvasTex(512, 4, (c, s) => { // 石材地面:1 × 2 米错缝
      const r = rng(11); c.fillStyle = '#d6d2cb'; c.fillRect(0, 0, s, s);
      for (let j = 0; j < 4; j++) for (let i = -1; i < 2; i++) { const x = i * 256 + (j % 2) * 128, y = j * 128; const v = r() > 0.5 ? 255 : 0; c.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.08})`; c.fillRect(x, y, 256, 128); c.strokeStyle = 'rgba(50,44,38,.6)'; c.lineWidth = 2; c.strokeRect(x, y, 256, 128); }
      speckle(c, s, 2600, 0.1, 3);
    }),
    panel: canvasTex(512, 6, (c, s) => { // 墙面:竖向板缝
      const r = rng(23); c.fillStyle = '#cfcbc5'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 4; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.1})`; c.fillRect(i * 128, 0, 128, s); c.fillStyle = 'rgba(30,26,22,.55)'; c.fillRect(i * 128, 0, 2, s); }
      c.fillStyle = 'rgba(30,26,22,.4)'; c.fillRect(0, 255, s, 2); speckle(c, s, 2200, 0.08, 5);
    }),
    slat: canvasTex(256, 1.6, (c, s) => { // 天花:木格栅
      c.fillStyle = '#b9a892'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) { c.fillStyle = 'rgba(20,14,8,.7)'; c.fillRect(i * 16 + 11, 0, 5, s); c.fillStyle = `rgba(255,240,220,${0.04 + hash(i, 9) * 0.1})`; c.fillRect(i * 16, 0, 11, s); }
    }),
    plate: canvasTex(512, 4, (c, s) => { // 甲板:金属板与铆钉
      const r = rng(31); c.fillStyle = '#c9ccd0'; c.fillRect(0, 0, s, s);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const x = i * 256, y = j * 128; c.fillStyle = `rgba(0,0,0,${r() * 0.08})`; c.fillRect(x, y, 256, 128); c.strokeStyle = 'rgba(20,24,28,.6)'; c.lineWidth = 2; c.strokeRect(x, y, 256, 128); c.fillStyle = 'rgba(20,24,28,.5)'; for (const [dx, dy] of [[10, 10], [246, 10], [10, 118], [246, 118]]) { c.beginPath(); c.arc(x + dx, y + dy, 2.4, 0, 7); c.fill(); } }
      speckle(c, s, 1800, 0.07, 7);
    }),
    hull: canvasTex(512, 8, (c, s) => { // 外壳:拉丝钛岩板
      c.fillStyle = '#d5d8db'; c.fillRect(0, 0, s, s); const r = rng(41);
      for (let i = 0; i < 520; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = `rgba(${v},${v},${v},${r() * 0.06})`; c.fillRect(0, r() * s, s, 1 + r() * 2); }
      c.fillStyle = 'rgba(20,26,32,.45)'; for (let j = 0; j < 4; j++) { c.fillRect(0, j * 128, s, 2); c.fillRect(((j % 2) * 128 + 60) % s, j * 128, 2, 128); c.fillRect(((j % 2) * 128 + 316) % s, j * 128, 2, 128); }
    }),
    wood: canvasTex(256, 1.5, (c, s) => { c.fillStyle = '#c9a57d'; c.fillRect(0, 0, s, s); const r = rng(51); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(60,30,10,${r() * 0.16})`; c.fillRect(0, r() * s, s, 1 + r() * 2.5); } }),
    cloth: canvasTex(128, 0.6, (c, s) => { c.fillStyle = '#c8c4bd'; c.fillRect(0, 0, s, s); speckle(c, s, 3000, 0.16, 61); }),
  };

  // ── 批量几何:同一材质的面片攒在一起,最后合成一个网格 ──
  class Batch {
    constructor() { this.p = []; }
    tri(a, b, c) { this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
    box(cx, cy, cz, sx, sy, sz, rot = 0) {
      const c = Math.cos(rot), s = Math.sin(rot), P = (x, y, z) => V(cx + x * c + z * s, cy + y, cz - x * s + z * c), hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const k = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
      this.quad(k[4], k[5], k[6], k[7]); this.quad(k[1], k[0], k[3], k[2]); this.quad(k[3], k[7], k[6], k[2]); this.quad(k[0], k[1], k[5], k[4]); this.quad(k[5], k[1], k[2], k[6]); this.quad(k[0], k[4], k[7], k[3]);
    }
    ico(cx, cy, cz, rx, ry = rx, rz = rx, seed = 0) { // 低面数的团块,用来做植物和雕塑
      const p = new THREE.IcosahedronGeometry(1, 0).attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { const k = 0.82 + 0.36 * hash(Math.round(p[i] * 50) + seed, Math.round(p[i + 1] * 50 + p[i + 2] * 31)); this.p.push(cx + p[i] * rx * k, cy + p[i + 1] * ry * k, cz + p[i + 2] * rz * k); }
    }
    poly(pts, y, holes = []) { // 水平多边形,pts 为 [u, w],可带洞
      const v2 = a => a.map(p => new THREE.Vector2(p[0], p[1])), all = [...pts, ...holes.flat()];
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(v2(pts), holes.map(v2))) this.tri(V(all[a][0], y, all[a][1]), V(all[b][0], y, all[b][1]), V(all[c][0], y, all[c][1]));
    }
    slab(pts, top, th, holes = []) {
      this.poly(pts, top, holes); this.poly(pts, top - th, holes);
      for (const ring of [pts, ...holes]) ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]; this.quad(V(p[0], top, p[1]), V(q[0], top, q[1]), V(q[0], top - th, q[1]), V(p[0], top - th, p[1])); });
    }
    strut(a, b, th) { // 两点之间的方杆
      const d = new THREE.Vector3().subVectors(b, a); if (d.lengthSq() < 1e-6) return; d.normalize();
      const up = Math.abs(d.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0), s1 = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(th / 2), s2 = new THREE.Vector3().crossVectors(d, s1).normalize().multiplyScalar(th / 2);
      const c = p => [p.clone().add(s1).add(s2), p.clone().sub(s1).add(s2), p.clone().sub(s1).sub(s2), p.clone().add(s1).sub(s2)], A = c(a), Bq = c(b);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(A[i], A[j], Bq[j], Bq[i]); }
    }
    sweep(us, section) { // 沿 u 方向放样:section(u) 返回 [d, y] 截面
      const S = us.map(u => section(u).map(([d, y]) => V(u, y, ref(u) + d))), n = S[0].length;
      for (let i = 0; i + 1 < S.length; i++) for (let k = 0; k < n; k++) { const m = (k + 1) % n; this.quad(S[i][k], S[i + 1][k], S[i + 1][m], S[i][m]); }
      for (const cap of [S[0], S[S.length - 1]]) for (let k = 1; k + 1 < n; k++) this.tri(cap[0], cap[k], cap[k + 1]);
    }
    mesh(material, parent = g) {
      if (!this.p.length) return null;
      const geo = new THREE.BufferGeometry(), p = this.p;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.computeVertexNormals();
      const m = material.map?.userData.meters;
      if (m) { // 按面的朝向做平面投影贴图
        const nr = geo.attributes.normal.array, uv = new Float32Array((p.length / 3) * 2);
        for (let i = 0; i < p.length; i += 9) {
          const ax = Math.abs(nr[i]), ay = Math.abs(nr[i + 1]), az = Math.abs(nr[i + 2]);
          for (let k = 0; k < 3; k++) { const x = p[i + k * 3], y = p[i + k * 3 + 1], z = p[i + k * 3 + 2], o = (i / 3 + k) * 2; if (ay >= ax && ay >= az) { uv[o] = x / m; uv[o + 1] = z / m; } else if (ax >= az) { uv[o] = z / m; uv[o + 1] = y / m; } else { uv[o] = x / m; uv[o + 1] = y / m; } }
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const mesh = new THREE.Mesh(geo, material); parent.add(mesh); return mesh;
    }
  }
  const B = new Proxy({}, { get: (t, k) => (t[k] ??= new Batch()) });

  // ── 行走辅助:平台、护栏(带碰撞)、挡板 ──
  const plat = (poly, top, holes) => platforms.push({ poly, top, holes });
  const band = (pts, half) => { const A = [], C = []; pts.forEach((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx = (nx / l) * half; ny = (ny / l) * half; A.push([p[0] + nx, p[1] + ny]); C.push([p[0] - nx, p[1] - ny]); }); return [...A, ...C.reverse()]; };
  const guard = (pts, y, visible = true) => { // 玻璃栏板 + 扶手,并沿线设一条 1 米宽的碰撞带
    if (visible) for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; B.rail.quad(V(a[0], y, a[1]), V(b[0], y, b[1]), V(b[0], y + 1.1, b[1]), V(a[0], y + 1.1, a[1])); B.mull.strut(V(a[0], y + 1.12, a[1]), V(b[0], y + 1.12, b[1]), 0.08); }
    blockers.push({ poly: band(pts, 0.5), y0: y - 0.4, y1: y + 2.3 });
  };

  // ══ 一、在崖面上开洞,并补一片细致的岩壁 ══
  {
    const idx = terrainGeo.index.array, pos = terrainGeo.attributes.position.array, keep = new Uint32Array(idx.length);
    const loc = k => { const dx = pos[k * 3] - ox, dz = pos[k * 3 + 2] - oz; return [dx * Tx + dz * Tz, pos[k * 3 + 1], dx * Nx + dz * Nz]; };
    const hit = (u, y, w) => Math.abs(w - ref(u)) < 16 && (inAtrium(u, y) || inLab(u, y));
    let n = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], dx = pos[a * 3] - ox, dz = pos[a * 3 + 2] - oz;
      let cut = false;
      if (dx * dx + dz * dz < 240 * 240) {
        const A = loc(a), Bp = loc(idx[t + 1]), Cp = loc(idx[t + 2]);
        for (let i = 0; i <= 6 && !cut; i++) for (let j = 0; j <= 6 - i && !cut; j++) { const x = i / 6, yv = j / 6, z = 1 - x - yv; cut = hit(A[0] * x + Bp[0] * yv + Cp[0] * z, A[1] * x + Bp[1] * yv + Cp[1] * z, A[2] * x + Bp[2] * yv + Cp[2] * z); }
      }
      if (!cut) { keep[n++] = idx[t]; keep[n++] = idx[t + 1]; keep[n++] = idx[t + 2]; }
    }
    terrainGeo.setIndex(new THREE.BufferAttribute(keep.subarray(0, n), 1));

    // 补岩壁:2 米网格,贴着原地形,开口处留空;竖向条纹模拟柱状节理
    const us = range(-100, 112, 2), ys = range(86, 190, 2), Wf = us.map(u => ys.map(y => faceRaw(u, y)));
    const P = [], Cc = [], lin = v => Math.pow(v, 2.2);
    const col = (u, y) => { const k = 0.2 + 0.16 * hash(Math.floor(u / 1.7), 3) + 0.05 * Math.sin(y * 0.42 + hash(Math.floor(u / 9), 1) * 6), c = [k * 1.08, k * 0.96, k * 0.88]; return [lin(c[0]), lin(c[1]), lin(c[2])]; };
    for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
      const w = [Wf[i][j], Wf[i + 1][j], Wf[i + 1][j + 1], Wf[i][j + 1]];
      if (w.some(v => v < -65)) continue;
      const cu = us[i] + 1, cy = ys[j] + 1;
      if (inAtrium(cu, cy) || inLab(cu, cy)) continue;
      const q = [[us[i], ys[j], w[0]], [us[i + 1], ys[j], w[1]], [us[i + 1], ys[j + 1], w[2]], [us[i], ys[j + 1], w[3]]];
      for (const k of [0, 1, 2, 0, 2, 3]) { P.push(q[k][0], q[k][1], q[k][2] + 0.45); Cc.push(...col(q[k][0], q[k][1])); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // ══ 二、外壳:上掠刃翼、西侧护翼、中脊斜梁、底部龙骨 ══
  B.shell.sweep(range(-74, 88, 3), u => [[-2.5, zRoot(u)], [dTip(u), zTip(u) + 0.25], [Math.max(0, dTip(u) - 0.6), zTip(u) - 1.0], [-2.5, zRoot(u) - 2.8]]);
  for (const u of range(-60, 78, 11.5)) B.armor.strut(V(u, zRoot(u) - 2.9, ref(u) - 1.5), V(u, zTip(u) - 1.3, ref(u) + dTip(u) - 1.6), 0.8); // 刃翼下的装甲肋梁
  { // 西侧护翼:贴崖的外缘与探出的内缘之间的斜板
    const outer = [[-74, 176, -1], [-68, 168, -1], [-52, 148, -1], [-26, 122, -1]], inner = [[-56, 169, 22], [-45, 149, 17], [-18, 121, 13]];
    const alongPl = (pl, t) => { const len = pl.slice(1).map((p, i) => Math.hypot(p[0] - pl[i][0], p[1] - pl[i][1])), tot = len.reduce((a, b) => a + b, 0); let s = t * tot; for (let i = 0; i < len.length; i++) { if (s <= len[i] || i === len.length - 1) { const f = clamp(s / len[i]); return pl[i].map((v, k) => v + (pl[i + 1][k] - v) * f); } s -= len[i]; } };
    const pt = p => V(p[0], p[1], ref(p[0]) + p[2]), off = V(1.7, -0.9, 0);
    for (let i = 0; i < 12; i++) {
      const a = pt(alongPl(outer, i / 12)), b = pt(alongPl(outer, (i + 1) / 12)), c = pt(alongPl(inner, (i + 1) / 12)), d = pt(alongPl(inner, i / 12));
      B.shell.quad(a, b, c, d); B.armor.quad(a.clone().add(off), b.clone().add(off), c.clone().add(off), d.clone().add(off)); B.shell.quad(d, c, c.clone().add(off), d.clone().add(off));
    }
  }
  B.shell.sweep(range(-46, 80, 3), u => [[0.5, beamTop(u)], [dB(u), beamTop(u)], [Math.max(0.8, dB(u) - 0.9), beamMid(u)], [0.5, beamMid(u)]]);
  B.armor.sweep(range(-46, 80, 3), u => [[0.5, beamMid(u)], [Math.max(0.8, dB(u) - 0.9), beamMid(u)], [Math.min(6, Math.max(0.7, dB(u) - 1)), beamBot(u)], [0.5, beamBot(u)]]);
  B.shell.sweep(range(-26, 80, 3), u => [[0, keelTop(u)], [dK(u), keelTop(u)], [dK(u) * 0.55, keelBot(u) + 0.5], [0, keelBot(u)]]);

  // ══ 三、斜肋玻璃幕墙:2 米一折的多边形玻璃面,斜向与横向肋框,东西各一道门 ══
  const dGlassBot = u => (u < -36 ? L([[-56, 20], [-36, 13]], u) : dB(u)) - 0.4, dGlassTop = u => Math.max(1, Math.min(20, dTip(u) - 2));
  const DOORS = [{ u0: -32, u1: -24, top: 151.6 }, { u0: 44, u1: 52, top: 141.8 }]; // 西门通露台,东门通起降坪
  const doorAt = u => DOORS.find(d => u > d.u0 + 0.01 && u < d.u1 - 0.01);
  const glassPt = (u, y) => { const b = zBot(u), t = zTop(u), f = clamp((y - b) / Math.max(0.01, t - b)); return V(u, y, ref(u) + dGlassBot(u) + (dGlassTop(u) - dGlassBot(u)) * f); };
  {
    const cols = range(-54, 66, 2), lo = (u, d) => (d ? Math.min(d.top, zTop(u) - 0.3) : zBot(u) + 0.15), hi = u => zTop(u) - 0.15;
    for (let i = 0; i + 1 < cols.length; i++) {
      const u0 = cols[i], u1 = cols[i + 1], d = doorAt((u0 + u1) / 2);
      if (hi(u0) - lo(u0, d) < 0.5 && hi(u1) - lo(u1, d) < 0.5) continue;
      B.glass.quad(glassPt(u0, lo(u0, d)), glassPt(u1, lo(u1, d)), glassPt(u1, hi(u1)), glassPt(u0, hi(u0)));
      B.mull.strut(glassPt(u0, hi(u0)), glassPt(u1, hi(u1)), 0.3);
      B.mull.strut(glassPt(u0, lo(u0, d)), glassPt(u1, lo(u1, d)), d ? 0.3 : 0.24);
    }
    for (const d of DOORS) for (const u of [d.u0, d.u1]) B.mull.strut(glassPt(u, zBot(u) + 0.15), glassPt(u, d.top), 0.45);
    const ok = (u, y) => inAtrium(u, y) && y < zTop(u) - 0.2 && y > zBot(u) + 0.2 && !(doorAt(u) && y < doorAt(u).top);
    for (let x = -66; x <= 66; x += 6) { // 斜向肋:顶端到底端向东偏 6 米
      let prev = null;
      for (let s = 0; s <= 1.0001; s += 1 / 24) { const u = x + 6 * s, y = 170 - 33 * s, cur = ok(u, y) ? glassPt(u, y) : null; if (prev && cur) B.mull.strut(prev, cur, 0.3); prev = cur; }
    }
    for (let k = 1; k <= 5; k++) { // 横向肋:平行于上缘
      let prev = null;
      for (const u of range(-54, 66, 2)) { const y = zTop(u) - 5.2 * k, cur = ok(u, y) ? glassPt(u, y) : null; if (prev && cur) B.mull.strut(prev, cur, 0.2); prev = cur; }
    }
  }

  // ══ 四、主厅:岩体里的三层错层,前缘向着幕墙层层后退 ══
  const WB = -64, CAVE = [-58, 64], CEIL = 168.5, BASE = 137, LY = 120.2;
  const LIFT = { u0: 4, u1: 9, w0: -63.8, w1: -58.6 }, LIFT_HOLE = [[LIFT.u0 + 0.05, LIFT.w0 + 0.05], [LIFT.u1 - 0.05, LIFT.w0 + 0.05], [LIFT.u1 - 0.05, LIFT.w1 - 0.05], [LIFT.u0 + 0.05, LIFT.w1 - 0.05]];
  const NOTCH_ST = [[-35, WB], [-35, -45], [-27, -45], [-27, WB]], NOTCH_LF = [[LIFT.u0, WB], [LIFT.u0, LIFT.w1], [LIFT.u1, LIFT.w1], [LIFT.u1, WB]];
  const frontIn = u => ref(u) - 0.6; // 室内空间的前界(刚好在崖面之后)
  const f1 = u => ref(u) - 0.6 + 10.6 * clamp((u + 36) / 4) * clamp((48 - u) / 8), f2 = u => ref(u) - 10, f3 = u => ref(u) - 22; // 各层前缘
  const front = (a, b, f) => range(a, b, 2).reverse().map(u => [u, f(u)]);
  const F1 = [[CAVE[0], WB], ...NOTCH_ST, ...NOTCH_LF, [CAVE[1], WB], ...front(CAVE[0], CAVE[1], f1)];
  const F2 = [[CAVE[0], WB], ...NOTCH_LF, [42, WB], [42, -57], [44.5, -57], [44.5, -50], [42, -50], ...front(CAVE[0], 42, f2)];
  const F3 = [[CAVE[0], WB], ...NOTCH_LF, [10, WB], [10, -57], [12.5, -57], [12.5, -50], [10, -50], ...front(CAVE[0], 10, f3)];
  for (const [F, y] of [[F1, 146], [F2, 153], [F3, 160]]) { // 楼板:面层石材,底面木格栅,侧边深色收口
    B.floor.poly(F, y); B.ceil.poly(F, y - 0.5);
    F.forEach((p, i) => { const q = F[(i + 1) % F.length]; B.dark.quad(V(p[0], y, p[1]), V(q[0], y, q[1]), V(q[0], y - 0.5, q[1]), V(p[0], y - 0.5, p[1])); });
  }
  plat(F1, 146); plat(F2, 153); plat(F3, 160);
  for (const [a, b, f, y] of [[-36, 48, f1, 146], [CAVE[0], 42, f2, 153], [CAVE[0], 10, f3, 160]]) for (const u of range(a, b - 2, 2)) // 各层前缘的暖光灯带
    B.warm.quad(V(u, y - 0.5, f(u) + 0.03), V(u + 2, y - 0.5, f(u + 2) + 0.03), V(u + 2, y - 0.95, f(u + 2) + 0.03), V(u, y - 0.95, f(u) + 0.03));
  // 护栏:一层在西门和廊道入口处留口
  const in15 = f => u => f(u) - 0.15;
  guard(along(CAVE[0], -36, in15(f1)), 146, false); // 一层西段的前墙是实墙,只设碰撞
  guard(along(-36, DOORS[0].u0, in15(f1)), 146); guard(along(DOORS[0].u1, -1.5, in15(f1)), 146); guard(along(1.5, CAVE[1], in15(f1)), 146);
  guard([[-35, -63.5], [-35, -45.5]], 146); guard([[-27, -63.5], [-27, -45.5]], 146);
  guard(along(CAVE[0], 42, in15(f2)), 153); guard([[42, f2(42)], [42, -50]], 153); guard([[42, -57], [42, -63.5]], 153);
  guard(along(CAVE[0], 10, in15(f3)), 160); guard([[10, f3(10)], [10, -50]], 160); guard([[10, -57], [10, -63.5]], 160);
  { // 洞室外壳:顶、底、后墙、侧墙,以及开口上下的前墙
    const fp = [[CAVE[0], WB], [CAVE[1], WB], ...front(CAVE[0], CAVE[1], frontIn)];
    B.ceil.poly(fp, CEIL); B.dark.poly(fp, BASE, [LIFT_HOLE]);
    B.wall.quad(V(CAVE[0], BASE, WB), V(CAVE[1], BASE, WB), V(CAVE[1], CEIL, WB), V(CAVE[0], CEIL, WB));
    for (const u of CAVE) B.wall.quad(V(u, BASE, WB), V(u, BASE, frontIn(u)), V(u, CEIL, frontIn(u)), V(u, CEIL, WB));
    for (const a of range(CAVE[0], CAVE[1] - 2, 2)) {
      const b = a + 2, m = a + 1, open = inAtrium(m, (zTop(m) + zBot(m)) / 2) && zTop(m) - zBot(m) > 0.4;
      const seg = (y0a, y0b, y1a, y1b) => B.wall.quad(V(a, y0a, frontIn(a)), V(b, y0b, frontIn(b)), V(b, y1b, frontIn(b)), V(a, y1a, frontIn(a)));
      if (open) { seg(BASE, BASE, zBot(a), zBot(b)); seg(zTop(a), zTop(b), CEIL, CEIL); } else seg(BASE, BASE, CEIL, CEIL);
    }
    // 后墙壁柱与天花梁,给大厅一些节奏
    for (const u of [-52, -42, -20, -6, 16, 28, 40, 54]) { B.armor.box(u, (146 + CEIL) / 2, WB + 0.35, 0.9, CEIL - 146, 0.7); B.warm.box(u, 157, WB + 0.72, 0.16, 20, 0.04); const len = frontIn(u) - WB; B.armor.box(u, CEIL - 0.45, WB + len / 2, 0.7, 0.9, len); }
    for (const u of range(-50, 56, 12)) B.warm.box(u + 5, CEIL - 0.06, (WB + frontIn(u + 5)) / 2, 0.4, 0.06, (frontIn(u + 5) - WB) * 0.8);
    // 幕墙后的廊道:中脊斜梁的顶面,自西向东缓缓下降,可以沿着它走到东门
    B.deck.sweep(range(-36, 58, 2), u => [[-0.6, beamTop(u) + 0.05], [dB(u) - 0.5, beamTop(u) + 0.05], [dB(u) - 0.5, beamTop(u)], [-0.6, beamTop(u)]]);
    plat([...range(-36, 58, 2).map(u => [u, ref(u) - 0.7]), ...range(-36, 58, 2).reverse().map(u => [u, ref(u) + dB(u) - 0.5])], u => beamTop(u) + 0.05);
  }
  // 层间坡道(主厅东侧)
  const ramp = (u0, u1, w0, w1, y0, y1) => { B.floor.quad(V(u0, y0, w0), V(u0, y0, w1), V(u1, y1, w1), V(u1, y1, w0)); B.dark.quad(V(u0, y0 - 0.35, w0), V(u0, y0 - 0.35, w1), V(u1, y1 - 0.35, w1), V(u1, y1 - 0.35, w0)); for (const w of [w0, w1]) { B.dark.quad(V(u0, y0, w), V(u1, y1, w), V(u1, y1 - 0.35, w), V(u0, y0 - 0.35, w)); B.mull.strut(V(u0, y0 + 1.05, w), V(u1, y1 + 1.05, w), 0.08); B.rail.quad(V(u0, y0, w), V(u1, y1, w), V(u1, y1 + 1.05, w), V(u0, y0 + 1.05, w)); } };
  ramp(60, 44, -56, -51, 146, 153); ramp(30, 12, -56, -51, 153, 160);
  plat([[44, -56], [60, -56], [60, -51], [44, -51]], u => 146 + (7 * (60 - u)) / 16);
  plat([[12, -56], [30, -56], [30, -51], [12, -51]], u => 153 + (7 * (30 - u)) / 18);
  { // 从一层下到廊道的坡道(一层前缘 u = 0 处的缺口)
    const top = u => (u < 1.5 ? 146 : 146 - ((146 - beamTop(14) - 0.05) * (u - 1.5)) / 12.5), us = range(-1.5, 14, 0.5);
    for (let i = 0; i + 1 < us.length; i++) { const a = us[i], b = us[i + 1]; B.deck.quad(V(a, top(a), ref(a) + 10.2), V(b, top(b), ref(b) + 10.2), V(b, top(b), ref(b) + 12.8), V(a, top(a), ref(a) + 12.8)); B.dark.quad(V(a, top(a), ref(a) + 10.2), V(b, top(b), ref(b) + 10.2), V(b, top(b) - 0.3, ref(b) + 10.2), V(a, top(a) - 0.3, ref(a) + 10.2)); }
    plat([...us.map(u => [u, ref(u) + 10.0]), ...us.slice().reverse().map(u => [u, ref(u) + 12.8])], top);
  }

  // ── 电梯:实验室 ↔ 主厅 ↔ 书房 ↔ 卧室;井道向下封闭,留给将来的机库与内港 ──
  const STOPS = [[LY, '重工实验室'], [146, '主厅'], [153, '书房'], [160, '卧室']];
  let liftY = 146, liftTarget = 1;
  const car = new THREE.Group(); car.position.set(0, liftY, 0); g.add(car);
  {
    const uc = (LIFT.u0 + LIFT.u1) / 2, wc = (LIFT.w0 + LIFT.w1) / 2, su = LIFT.u1 - LIFT.u0, sw = LIFT.w1 - LIFT.w0, TOPY = 165.5;
    for (const u of [LIFT.u0, LIFT.u1]) B.dark.quad(V(u, LY, LIFT.w0), V(u, LY, LIFT.w1), V(u, TOPY, LIFT.w1), V(u, TOPY, LIFT.w0));
    B.dark.quad(V(LIFT.u0, LY, LIFT.w0), V(LIFT.u1, LY, LIFT.w0), V(LIFT.u1, TOPY, LIFT.w0), V(LIFT.u0, TOPY, LIFT.w0));
    B.dark.poly([[LIFT.u0, LIFT.w0], [LIFT.u1, LIFT.w0], [LIFT.u1, LIFT.w1], [LIFT.u0, LIFT.w1]], TOPY);
    const stops = STOPS.map(s => s[0]);
    stops.forEach((y, i) => { // 各层门洞之间的井壁,门框一圈暖光
      const next = stops[i + 1] ?? TOPY;
      B.dark.quad(V(LIFT.u0, y + 2.7, LIFT.w1), V(LIFT.u1, y + 2.7, LIFT.w1), V(LIFT.u1, next, LIFT.w1), V(LIFT.u0, next, LIFT.w1));
      B.amber.box(uc, y + 2.74, LIFT.w1 + 0.03, su, 0.1, 0.06); for (const u of [LIFT.u0 + 0.05, LIFT.u1 - 0.05]) B.amber.box(u, y + 1.35, LIFT.w1 + 0.03, 0.1, 2.7, 0.06);
    });
    B.amber.box(uc, LY + 0.04, LIFT.w1 + 1.2, su + 1.6, 0.05, 0.25); // 实验室地面上的井口标线
    const cb = new Batch();
    cb.box(uc, -0.1, wc, su - 0.5, 0.2, sw - 0.5); cb.box(uc, 2.75, wc, su - 0.5, 0.12, sw - 0.5);
    for (const [du, dw] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cb.box(uc + du * (su / 2 - 0.4), 1.35, wc + dw * (sw / 2 - 0.4), 0.14, 2.7, 0.14);
    cb.mesh(new THREE.MeshStandardMaterial({ color: 0x3a424b, metalness: 0.4, roughness: 0.5, flatShading: true }), car);
    const cl = new Batch(); cl.box(uc, 2.66, wc, su - 1.2, 0.05, sw - 1.2); cl.box(uc, 1.4, LIFT.w0 + 0.35, su - 1, 0.08, 0.05);
    cl.mesh(new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), car);
    plat([[LIFT.u0, LIFT.w0 - 0.6], [LIFT.u1, LIFT.w0 - 0.6], [LIFT.u1, LIFT.w1], [LIFT.u0, LIFT.w1]], () => liftY);
    // 井道三面的壁:只能从正面的门进出
    for (const [a, b, c, d] of [[LIFT.u0 - 0.35, LIFT.u0 + 0.35, LIFT.w0 - 0.6, LIFT.w1], [LIFT.u1 - 0.35, LIFT.u1 + 0.35, LIFT.w0 - 0.6, LIFT.w1], [LIFT.u0 - 0.35, LIFT.u1 + 0.35, LIFT.w0 - 0.6, LIFT.w0 + 0.3]]) blockers.push({ poly: [[a, c], [b, c], [b, d], [a, d]], y0: LY - 1, y1: 170 });
    // 轿厢不在本层时,井口进不去
    blockers.push({ poly: [[LIFT.u0, LIFT.w0], [LIFT.u1, LIFT.w0], [LIFT.u1, LIFT.w1], [LIFT.u0, LIFT.w1]], y0: LY - 1, y1: 170, active: feet => Math.abs(feet - liftY) > 0.8 });
  }
  const inCar = (u, w, feet) => u > LIFT.u0 && u < LIFT.u1 && w > LIFT.w0 && w < LIFT.w1 && Math.abs(feet - liftY) < 1;
  const atDoor = (u, w, feet) => (u > LIFT.u0 - 3 && u < LIFT.u1 + 3 && w > LIFT.w1 - 0.5 && w < LIFT.w1 + 6 ? STOPS.findIndex(s => Math.abs(s[0] - feet) < 0.8) : -1);
  const lift = {
    use(u, w, feet, dir) {
      if (inCar(u, w, feet)) {
        if (Math.abs(liftY - STOPS[liftTarget][0]) > 0.05) return null;
        const n = clamp(liftTarget + dir, 0, STOPS.length - 1);
        if (n === liftTarget) return dir > 0 ? '已经是最高一层' : '已经是最低一层(井道向下尚未开通)';
        liftTarget = n; return `电梯 → ${STOPS[n][1]}`;
      }
      const i = atDoor(u, w, feet);
      if (i < 0) return null;
      if (i === liftTarget) return '电梯已在本层';
      liftTarget = i; return '已呼叫电梯';
    },
    hint: (u, w, feet) => (inCar(u, w, feet) ? '电梯 · E 上 Q 下' : atDoor(u, w, feet) >= 0 ? '电梯口 · 按 E 呼叫' : null),
  };

  // ── 陈设 ──
  const sofa = (u, y, w, len, rot) => { const c = Math.cos(rot), s = Math.sin(rot); B.sofa.box(u, y + 0.25, w, len, 0.5, 1.1, rot); B.sofa.box(u - 0.45 * s, y + 0.65, w - 0.45 * c, len, 0.6, 0.25, rot); for (const k of [-1, 1]) B.sofa.box(u + k * (len / 2 - 0.12) * c, y + 0.5, w - k * (len / 2 - 0.12) * s, 0.24, 0.5, 1.1, rot); };
  const plant = (u, y, w, s = 1) => { B.dark.box(u, y + 0.35 * s, w, 0.9 * s, 0.7 * s, 0.9 * s); B.leaf.ico(u, y + 1.5 * s, w, 0.9 * s, 1.1 * s, 0.9 * s, Math.round(u * 7 + w)); B.leaf.ico(u + 0.3 * s, y + 2.3 * s, w - 0.2 * s, 0.6 * s, 0.8 * s, 0.6 * s, Math.round(u * 3 + w * 5)); };
  const lamp = (u, y, w) => { B.mull.box(u, y + 0.03, w, 0.5, 0.06, 0.5); B.mull.strut(V(u, y, w), V(u, y + 1.7, w), 0.07); B.warm.box(u, y + 1.85, w, 0.45, 0.5, 0.45); };
  const shelf = (u, y, w, len, rot) => { B.wood.box(u, y + 1.4, w, len, 2.8, 0.5, rot); const c = Math.cos(rot), s = Math.sin(rot); for (let k = 0; k < 4; k++) for (let i = 0; i < Math.floor(len / 0.5); i++) { const o = -len / 2 + 0.3 + i * 0.5, hh = 0.32 + 0.22 * hash(i + u, k + w); if (hash(i * 3 + u, k) < 0.2) continue; B[['bookA', 'bookB', 'bookC'][Math.floor(hash(i, k + u) * 3)]].box(u + o * c + 0.27 * s, y + 0.35 + k * 0.66 + hh / 2, w - o * s + 0.27 * c, 0.4, hh, 0.06, rot); } };
  { // 一层:会客、餐厅、吧台、全息沙盘
    const y = 146, r0 = ref(16);
    B.rugA.box(16, y + 0.02, r0 - 8, 15, 0.03, 10);
    sofa(16, y, r0 - 12.5, 8, 0); sofa(23.5, y, r0 - 7.5, 6, Math.PI / 2); sofa(8.5, y, r0 - 7.5, 6, -Math.PI / 2);
    B.dark.box(16, y + 0.2, r0 - 7.5, 3.6, 0.12, 1.8); B.mull.box(16, y + 0.08, r0 - 7.5, 3, 0.16, 1.2); B.amber.box(16, y + 0.3, r0 - 7.5, 0.5, 0.1, 0.5);
    lamp(11, y, r0 - 12.6); lamp(21.5, y, r0 - 12.6); plant(27, y, r0 - 12, 1.2); plant(5, y, r0 - 12, 1.1);
    // 餐厅
    B.rugB.box(-22, y + 0.02, -40, 13, 0.03, 6);
    B.wood.box(-22, y + 0.78, -40, 9.6, 0.12, 2.3); for (const du of [-3.6, 3.6]) B.dark.box(-22 + du, y + 0.36, -40, 0.25, 0.72, 1.7);
    for (let i = 0; i < 6; i++) for (const dw of [-1.75, 1.75]) { B.sofa.box(-25.75 + i * 1.5, y + 0.28, -40 + dw, 0.62, 0.56, 0.62); B.sofa.box(-25.75 + i * 1.5, y + 0.8, -40 + dw * 1.16, 0.62, 0.6, 0.1); }
    for (const du of [-2.4, 0, 2.4]) { B.mull.strut(V(-22 + du, CEIL - 15, -40), V(-22 + du, y + 2.9, -40), 0.05); B.warm.box(-22 + du, y + 2.7, -40, 0.5, 0.36, 0.5); }
    // 吧台与酒柜
    B.dark.box(-16, y + 0.55, -58.6, 13, 1.1, 1.6); B.wood.box(-16, y + 1.13, -58.6, 13.3, 0.07, 1.9); B.dark.box(-16, y + 1.7, -63.2, 14, 3.4, 0.9);
    for (let k = 0; k < 3; k++) { B.warm.box(-16, y + 1.0 + k * 0.85, -62.7, 12.6, 0.05, 0.08); for (let i = 0; i < 22; i++) if (hash(i, k + 3) > 0.25) B[hash(i, k) > 0.5 ? 'amber' : 'bookB'].box(-22 + i * 0.56, y + 1.25 + k * 0.85, -62.72, 0.16, 0.4, 0.16); }
    for (let i = 0; i < 6; i++) { B.mull.strut(V(-21 + i * 2, y, -57.2), V(-21 + i * 2, y + 0.75, -57.2), 0.06); B.sofa.box(-21 + i * 2, y + 0.8, -57.2, 0.45, 0.1, 0.45); }
    // 全息沙盘:岛屿的缩小线框
    B.dark.box(-12, y + 0.45, -22, 7.4, 0.9, 5.6); B.mull.box(-12, y + 0.93, -22, 7.8, 0.08, 6); B.cyan.box(-12, y + 0.98, -22, 7.2, 0.02, 5.3);
    const nx = 96, ny = 70, plane = new THREE.PlaneGeometry(7, 5.06, nx - 1, ny - 1), pp = plane.attributes.position;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const h = Hf[Math.round((1 - j / (ny - 1)) * (NY - 1)) * NX + Math.round((i / (nx - 1)) * (NX - 1))]; pp.setZ(j * nx + i, Math.max(h, -8) * 0.0042); }
    const holo = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0xbff3ff, wireframe: true, transparent: true, opacity: 0.6 }));
    holo.rotation.x = -Math.PI / 2; holo.position.set(-12, y + 1.3, -22); g.add(holo);
    // 东侧陈列:三座基座上的雕塑
    for (const [u, w, s] of [[34, -30, 1], [40, -42, 1.3], [50, -34, 0.9]]) { B.dark.box(u, y + 0.5, w, 1.4, 1, 1.4); B.armor.ico(u, y + 1.9 * s, w, 0.9 * s, 1.5 * s, 0.7 * s, u); B.warm.box(u, y + 1.02, w, 1.1, 0.04, 1.1); }
    plant(-54, y, -60, 1.5); plant(60, y, -60, 1.5); plant(-41, y, ref(-41) - 4, 1.2); plant(-2, y, -60, 1.2);
  }
  { // 二层:书房与指挥屏
    const y = 153;
    B.dark.box(-24, y + 2.2, -63.4, 46, 3.6, 0.5); B.screen.box(-24, y + 2.2, -63.1, 42, 3, 0.06);
    for (let i = 0; i < 9; i++) { B.dark.box(-45 + i * 5.25, y + 2.2, -63.05, 0.12, 3, 0.08); for (let k = 0; k < 3; k++) if (hash(i, k + 5) > 0.35) B.cyan.box(-42.4 + i * 5.25 + (hash(i, k) - 0.5) * 2, y + 1.2 + k * 0.95, -63.04, 1.2 + hash(k, i) * 1.8, 0.14, 0.04); }
    B.rugB.box(-24, y + 0.02, -52, 10, 0.03, 6);
    B.wood.box(-24, y + 0.78, -52, 6.4, 0.1, 2.1); B.dark.box(-24, y + 0.38, -52.4, 5.8, 0.76, 0.3); B.sofa.box(-24, y + 0.35, -49.6, 0.9, 0.7, 0.9); B.sofa.box(-24, y + 0.95, -49.2, 0.9, 0.7, 0.14); B.cyan.box(-24, y + 1.15, -52.4, 1.6, 0.7, 0.04); lamp(-27.8, y, -52.6);
    for (const w of [-60, -55, -50, -45, -40]) shelf(-57.3, y, w, 4.4, Math.PI / 2);
    B.rugA.box(-40, y + 0.02, -36, 9, 0.03, 7); sofa(-40, y, -39, 6, 0); sofa(-44.5, y, -34.5, 4, -Math.PI / 2); B.dark.box(-40, y + 0.2, -35, 2.6, 0.4, 1.3); plant(-36, y, -32, 1);
    // 东侧观星台:圆桌与望远镜
    B.dark.box(26, y + 0.4, -36, 3, 0.8, 3, Math.PI / 4); B.wood.box(26, y + 0.84, -36, 3.2, 0.08, 3.2, Math.PI / 4); for (const a of [0, 1, 2, 3]) B.sofa.box(26 + Math.cos(a * 1.57) * 2.6, y + 0.3, -36 + Math.sin(a * 1.57) * 2.6, 0.8, 0.6, 0.8);
    B.mull.strut(V(34, y, f2(34) - 3), V(34, y + 1.5, f2(34) - 3), 0.1); B.armor.strut(V(33.4, y + 1.2, f2(34) - 3.8), V(34.9, y + 2.2, f2(34) - 1.6), 0.36);
    plant(38, y, -60, 1.3); plant(12, y, f2(12) - 3, 1.1);
  }
  { // 三层:卧室
    const y = 160;
    B.rugA.box(-30, y + 0.02, -50, 9, 0.03, 8);
    B.wood.box(-30, y + 0.3, -52, 4, 0.6, 4.6); B.white.box(-30, y + 0.72, -51.6, 3.6, 0.3, 3.6); B.wood.box(-30, y + 1.0, -54.5, 4.2, 1.7, 0.25); for (const du of [-0.9, 0.9]) B.white.box(-30 + du, y + 0.95, -53.4, 1.3, 0.25, 0.7);
    for (const du of [-2.8, 2.8]) { B.wood.box(-30 + du, y + 0.3, -53.6, 0.9, 0.6, 0.9); B.warm.box(-30 + du, y + 0.85, -53.6, 0.35, 0.5, 0.35); }
    B.dark.box(-14, y + 1.3, -63, 12, 2.6, 1); for (let i = 0; i < 5; i++) B.wood.box(-19 + i * 2.5, y + 1.3, -62.46, 2.3, 2.4, 0.06);
    B.white.box(-50, y + 0.45, -57, 2.6, 0.9, 4.6); B.pool.box(-50, y + 0.86, -57, 2.2, 0.06, 4.2); B.wall.box(-46.5, y + 1.2, -57, 0.15, 2.4, 6);
    sofa(-20, y, f3(-20) - 4, 4.5, 0); lamp(-16.6, y, f3(-20) - 4.4); plant(-54, y, f3(-54) - 3, 1.2); plant(1, y, -60, 1.1);
  }

  // ══ 五、重工实验室:中脊斜梁下的内凹巨口,纵深约 100 米 ══
  const LB = -100, LAB = [-18, 52], LCEIL = 137.6, labFront = u => refLab(u) + 2;
  const LABF = [[LAB[0], LB], [LAB[1], LB], ...front(LAB[0], LAB[1], labFront)];
  B.deck.slab(LABF, LY, 0.5);
  const rc = refLab(19), TONGUE = [[-6, refLab(-6) + 1], [44, refLab(44) + 1], [38, rc + 34], [0, rc + 34]];
  {
    B.ceil.poly(LABF, LCEIL, [LIFT_HOLE]);
    B.wall.quad(V(LAB[0], LY, LB), V(LAB[1], LY, LB), V(LAB[1], LCEIL, LB), V(LAB[0], LCEIL, LB));
    B.wall.quad(V(LAB[1], LY, LB), V(LAB[1], LY, labFront(LAB[1])), V(LAB[1], LCEIL, labFront(LAB[1])), V(LAB[1], LCEIL, LB));
    const wq = (w0, w1, y0, y1) => B.wall.quad(V(LAB[0], y0, w0), V(LAB[0], y0, w1), V(LAB[0], y1, w1), V(LAB[0], y1, w0)); // 西墙留出通往楼梯间的门洞
    wq(LB, -46, LY, LCEIL); wq(-40, labFront(LAB[0]), LY, LCEIL); wq(-46, -40, LY + 3.2, LCEIL);
    for (const a of range(LAB[0], LAB[1] - 2, 2)) { // 开口上方的前墙
      const b = a + 2, open = inLab(a + 1, 121), ya = Math.min(LCEIL, open ? labTop(a) : LY), yb = Math.min(LCEIL, open ? labTop(b) : LY);
      B.wall.quad(V(a, ya, labFront(a) - 2.2), V(b, yb, labFront(b) - 2.2), V(b, LCEIL, labFront(b) - 2.2), V(a, LCEIL, labFront(a) - 2.2));
    }
    B.deck.slab(TONGUE, LY, 1.4); // 起降舌台
    B.amber.box(19, LY + 0.04, rc + 30, 22, 0.05, 0.9); for (const u of [3, 35]) B.amber.box(u, LY + 0.04, rc + 16, 0.4, 0.05, 26);
    plat(TONGUE, LY); plat(LABF, LY);
    // 吊车梁、导轨、地面引导线、顶灯
    for (const w of [-20, -45, -78]) { B.armor.box(17, LCEIL - 2.6, w, 68, 1.2, 1.6); B.amber.box(17, LCEIL - 3.25, w, 60, 0.08, 0.5); }
    for (const u of [-12, 46]) B.armor.box(u, LCEIL - 1.7, -48, 1.2, 0.8, 96);
    B.dark.box(-4, LCEIL - 5, -45, 3, 4, 3); B.armor.box(-4, LCEIL - 8.5, -45, 0.4, 3.4, 0.4); B.amber.box(-4, LCEIL - 10.3, -45, 0.9, 0.3, 0.9);
    for (const u of [-2, 36]) B.amber.box(u, LY + 0.04, -42, 0.35, 0.05, 108);
    for (const u of range(-10, 44, 9)) for (const w of [-30, -60, -88]) B.white.box(u, LCEIL - 0.08, w, 5, 0.06, 0.8);
    // 远古能量核心:基座、悬浮的发光球体与三道环
    const cu = 26, cw = -70;
    B.armor.box(cu, LY + 0.6, cw, 9, 1.2, 9, Math.PI / 4); B.dark.box(cu, LY + 1.5, cw, 5, 0.6, 5, Math.PI / 4); B.cyan.box(cu, LY + 1.82, cw, 3, 0.05, 3, Math.PI / 4);
    const core = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 16), new THREE.MeshBasicMaterial({ color: 0xd8fbff })); core.position.set(cu, LY + 6.2, cw); g.add(core);
    const rings = [];
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(4 + i * 0.9, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: 0x7fe6ff })); r.position.copy(core.position); g.add(r); rings.push(r); }
    const cl = new THREE.PointLight(0x9fe8ff, 2200, 150); cl.position.set(cu, LY + 7, cw); g.add(cl);
    frame.animate = (t, dt = 0.016) => {
      rings.forEach((r, i) => { r.rotation.x = t * (0.4 + i * 0.17) + i; r.rotation.y = t * (0.31 - i * 0.12) + i * 2; }); core.scale.setScalar(1 + 0.04 * Math.sin(t * 3));
      const d = STOPS[liftTarget][0] - liftY, s = 6 * dt; liftY += clamp(d, -s, s); car.position.y = liftY;
    };
    // 两侧工位:工作台、机械臂、全息屏
    for (const [u, s] of [[-13, 1], [47, -1]]) for (const w of [-22, -36, -78, -90]) {
      B.dark.box(u, LY + 0.5, w, 4, 1, 7); B.armor.box(u, LY + 1.06, w, 4.2, 0.12, 7.2);
      B.armor.box(u + s * 0.4, LY + 2.1, w - 2, 0.5, 2, 0.5); B.armor.strut(V(u + s * 0.4, LY + 3.1, w - 2), V(u + s * 3.4, LY + 4.4, w - 1), 0.36); B.amber.box(u + s * 3.5, LY + 4.3, w - 1, 0.5, 0.5, 0.5);
      B.holo.box(u + s * 0.2, LY + 2.2, w + 2, 0.04, 1.4, 2.4); B.dark.box(u, LY + 1.25, w + 1, 1.2, 0.3, 0.8);
    }
    for (let i = 0; i < 5; i++) { const u = -6 + i * 8.5, w = LB + 2.2; B.dark.box(u, LY + 2.2, w, 3, 4.4, 2.6); B.cyan.box(u, LY + 2.3, w + 1.35, 1.6, 3.4, 0.08); B.armor.box(u, LY + 2.3, w + 1.42, 0.5, 2.6, 0.06); } // 尽头的一排装甲舱
    for (const [u, w] of [[6, -12], [30, -12]]) { B.dark.box(u, LY + 0.4, w, 5, 0.8, 2.4); B.holo.box(u, LY + 1.9, w, 4.4, 2, 0.04); } // 入口两侧的控制台
    const craft = (u, w, rot) => { // 座机
      const pts = [[0, 0.7, 9], [-6, 0.7, -5], [0, 2.6, -3], [0, 0.7, 9], [0, 2.6, -3], [6, 0.7, -5], [-6, 0.7, -5], [6, 0.7, -5], [0, 2.6, -3], [0, 0.7, 9], [6, 0.7, -5], [-6, 0.7, -5]];
      const c = Math.cos(rot), s = Math.sin(rot), P = p => V(u + p[0] * c + p[2] * s, LY + p[1], w - p[0] * s + p[2] * c);
      for (let i = 0; i < pts.length; i += 3) B.armor.tri(P(pts[i]), P(pts[i + 1]), P(pts[i + 2]));
      B.cyan.box(u - 3.2 * s, LY + 0.9, w - 3.2 * c, 2.2, 0.3, 0.3, rot); for (const k of [-2.6, 2.6]) B.mull.box(u + k * c, LY + 0.35, w - k * s, 0.3, 0.7, 0.3, rot);
    };
    craft(22, rc + 14, 0); craft(34, -30, 0.5);
  }
  { // 楼梯间:实验室 ↔ 主厅一层(120 → 133 → 146 米,两段折返)
    const A = [-26, -20], Bf = [-34, -28], yM = 133.1;
    const flight = (f, wLo, wHi, yLo, yHi) => { B.floor.quad(V(f[0], yLo, wLo), V(f[1], yLo, wLo), V(f[1], yHi, wHi), V(f[0], yHi, wHi)); for (const u of f) B.mull.strut(V(u, yLo + 1.05, wLo), V(u, yHi + 1.05, wHi), 0.08); };
    flight(A, -46, -88, LY, yM); flight(Bf, -88, -46, yM, 146);
    B.floor.slab([[-34, -94], [-20, -94], [-20, -88], [-34, -88]], yM, 0.4); B.floor.slab([[-28, -46], [-17, -46], [-17, -40], [-28, -40]], LY, 0.4);
    const S = [-35, -19, -95, -39];
    B.wall.quad(V(S[0], LY, S[2]), V(S[1], LY, S[2]), V(S[1], 147, S[2]), V(S[0], 147, S[2]));
    B.wall.quad(V(S[0], LY, S[2]), V(S[0], LY, S[3]), V(S[0], 146, S[3]), V(S[0], 146, S[2]));
    B.wall.quad(V(S[1], LY, S[2]), V(S[1], LY, -46), V(S[1], 146, -46), V(S[1], 146, S[2])); B.wall.quad(V(S[1], LY + 3.2, -46), V(S[1], LY + 3.2, S[3]), V(S[1], 146, S[3]), V(S[1], 146, -46));
    B.wall.quad(V(S[0], LY, S[3]), V(S[1], LY, S[3]), V(S[1], 145.5, S[3]), V(S[0], 145.5, S[3]));
    B.dark.poly([[S[0], S[2]], [S[1], S[2]], [S[1], S[3]], [S[0], S[3]]], LY - 0.05); B.ceil.poly([[S[0], S[2]], [S[1], S[2]], [S[1], WB], [S[0], WB]], 147);
    B.wall.quad(V(-27, LY, -88), V(-27, LY, -46), V(-27, 146, -46), V(-27, 146, -88)); // 两段楼梯之间的隔墙
    for (const w of [-52, -66, -80]) { B.warm.box(-27.12, 140, w, 0.06, 0.3, 3); B.warm.box(-26.88, 127, w, 0.06, 0.3, 3); B.warm.box(-34.9, 140, w, 0.06, 0.3, 3); B.warm.box(-19.1, 127, w, 0.06, 0.3, 3); }
    plat([[-28, -46], [-17, -46], [-17, -40], [-28, -40]], LY);
    plat([[A[0], -88], [A[1], -88], [A[1], -46], [A[0], -46]], (u, w) => LY + ((yM - LY) * (-46 - w)) / 42);
    plat([[-34, -94], [-20, -94], [-20, -88], [-34, -88]], yM);
    plat([[Bf[0], -88], [Bf[1], -88], [Bf[1], -45], [Bf[0], -45]], (u, w) => Math.min(146, yM + ((146 - yM) * (w + 88)) / 42));
  }

  // ══ 六、悬挑平台:西翼露台与泳池、东翼起降坪 ══
  const terOut = u => ref(u) + 15 + 17 * clamp((u + 76) / 16) - 0.0;
  const TER = [...range(-72, -24, 4).map(u => [u, ref(u) + 15]), ...range(-72, -24, 4).reverse().map(u => [u, terOut(u)])];
  const POOL = [...range(-58, -40, 2).map(u => [u, ref(u) + 22.5]), ...range(-58, -40, 2).reverse().map(u => [u, ref(u) + 30.5])];
  B.deck.slab(TER, 148.5, 1.2, [POOL]); B.pool.poly(POOL, 147.36); B.water.poly(POOL, 148.36);
  B.pool.poly([[-42, ref(-42) + 22.5], [-40, ref(-40) + 22.5], [-40, ref(-40) + 30.5], [-42, ref(-42) + 30.5]], 147.95); // 池边台阶
  plat(TER, 148.5, [POOL]); plat(POOL, 147.35); plat([[-42, ref(-42) + 22.4], [-40, ref(-40) + 22.4], [-40, ref(-40) + 30.6], [-42, ref(-42) + 30.6]], 147.95);
  for (const u of [-66, -62, -34]) { const w = ref(u) + 20; B.wood.box(u, 148.75, w, 0.8, 0.14, 2.1); B.white.box(u, 148.86, w + 0.1, 0.72, 0.1, 1.8); B.wood.box(u, 149.05, w - 0.95, 0.8, 0.5, 0.12); } // 躺椅
  plant(-70, 148.5, ref(-70) + 16.5, 1); plant(-28, 148.5, ref(-28) + 29.5, 1.1);
  { const d0 = DOORS[0]; B.deck.quad(V(d0.u0, 146, ref(d0.u0) + 9.6), V(d0.u1, 146, ref(d0.u1) + 9.6), V(d0.u1, 148.5, ref(d0.u1) + 15.2), V(d0.u0, 148.5, ref(d0.u0) + 15.2)); // 一层通往露台的坡道
    plat([[d0.u0, ref(d0.u0) + 9.4], [d0.u1, ref(d0.u1) + 9.4], [d0.u1, ref(d0.u1) + 15.4], [d0.u0, ref(d0.u0) + 15.4]], (u, w) => 146 + 2.5 * clamp((w - ref(u) - 9.6) / 5.6)); }
  guard(along(-72, -24, u => terOut(u) - 0.2, 4), 148.5); guard([[-72, ref(-72) + 15], [-72, terOut(-72)]], 148.5); guard([[-24, ref(-24) + 15.4], [-24, terOut(-24)]], 148.5); guard(along(-72, -33, u => ref(u) + 15.2, 4), 148.5);
  for (const u of [-66, -40]) B.armor.strut(V(u, 147.4, ref(u) + 28), V(u + 2, 139, ref(u) + 3), 1.1);
  // 东翼起降坪:贴着幕墙东段外侧,顺着岬角东翼后掠
  const padIn = u => ref(u) + dB(u) + 1.2, padOut = u => padIn(u) + 15 * clamp((u - 42) / 6) * clamp((92 - u) / 14);
  const PAD = [...range(46, 84, 2).map(u => [u, padIn(u)]), ...range(46, 84, 2).reverse().map(u => [u, padOut(u)])];
  B.deck.slab(PAD, 139.2, 1.4); plat(PAD, 139.2);
  B.amber.box(64, 139.24, (padIn(64) + padOut(64)) / 2, 8, 0.04, 0.5, 0.6); B.amber.box(64, 139.24, (padIn(64) + padOut(64)) / 2, 8, 0.04, 0.5, 0.6 + Math.PI / 2);
  guard(along(46, 84, u => padOut(u) - 0.2), 139.2); guard([[84, padIn(84)], [84, padOut(84)]], 139.2); guard([[46, padIn(46) + 1.5], [46, padOut(46)]], 139.2);
  for (const u of [56, 74]) B.armor.strut(V(u, 138, padOut(u) - 2), V(u - 2, 128.5, ref(u) + 1), 1.2);
  { const d1 = DOORS[1], a = d1.u0 + 1, b = d1.u1 - 1, y0 = u => beamTop(u) + 0.05; // 东门:廊道 → 起降坪
    B.deck.quad(V(a, y0(a), ref(a) + dB(a) - 1.2), V(b, y0(b), ref(b) + dB(b) - 1.2), V(b, 139.2, ref(b) + dB(b) + 1.5), V(a, 139.2, ref(a) + dB(a) + 1.5));
    plat([[a, ref(a) + dB(a) - 1.4], [b, ref(b) + dB(b) - 1.4], [b, ref(b) + dB(b) + 1.6], [a, ref(a) + dB(a) + 1.6]], (u, w) => y0(u) + (139.2 - y0(u)) * clamp((w - ref(u) - dB(u) + 1.2) / 2.7)); }

  // ── 挡板:幕墙(两道门留口)、主厅后墙 ──
  const strip = (us, d0, d1) => [...us.map(u => [u, ref(u) + d0(u)]), ...us.slice().reverse().map(u => [u, ref(u) + d1(u)])];
  // (u < −36 的那段幕墙高悬在露台上方,不挡露台上的人)
  for (const [a, b] of [[-36, DOORS[0].u0], [DOORS[0].u1, DOORS[1].u0], [DOORS[1].u1, 66]]) blockers.push({ poly: strip(range(a, b, 2), u => dGlassBot(u) - 0.3, u => dGlassBot(u) + 2.6), y0: 136, y1: 170 });
  blockers.push({ poly: [[CAVE[0] - 2, WB - 1.8], [LIFT.u0, WB - 1.8], [LIFT.u0, WB - 0.05], [CAVE[0] - 2, WB - 0.05]], y0: 145.6, y1: 170 }, { poly: [[LIFT.u1, WB - 1.8], [CAVE[1] + 2, WB - 1.8], [CAVE[1] + 2, WB - 0.05], [LIFT.u1, WB - 0.05]], y0: 145.6, y1: 170 });
  for (const p of [...platforms, ...blockers]) if (!p.box && p.poly) { p.inv = frame.inv; p.box = p.poly.reduce((b, q) => [Math.min(b[0], q[0]), Math.max(b[1], q[0]), Math.min(b[2], q[1]), Math.max(b[3], q[1])], [1e9, -1e9, 1e9, -1e9]); }

  // ══ 材质与灯光 ══
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, flatShading: true, side: THREE.DoubleSide, ...o });
  const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...o });
  const MATS = {
    shell: std(0x8d99a3, { metalness: 0.3, roughness: 0.42, map: TEX.hull }), armor: std(0x2b3239, { metalness: 0.35, roughness: 0.5 }), deck: std(0x7b8791, { roughness: 0.7, map: TEX.plate }),
    mull: std(0x14191e, { metalness: 0.5, roughness: 0.4 }), floor: std(0x9c9488, { roughness: 0.85, map: TEX.stone }), wall: std(0x55514d, { roughness: 0.95, map: TEX.panel }), ceil: std(0x6a5a48, { roughness: 1, map: TEX.slat }),
    dark: std(0x1d2126, { roughness: 0.7 }), sofa: std(0x77706a, { roughness: 1, map: TEX.cloth }), wood: std(0x80593c, { roughness: 0.8, map: TEX.wood }), white: std(0xc9c4ba, { roughness: 0.9, map: TEX.cloth }),
    rugA: std(0x6b3f34, { roughness: 1, map: TEX.cloth }), rugB: std(0x3f4f5c, { roughness: 1, map: TEX.cloth }), leaf: std(0x3f7a45, { roughness: 1 }),
    bookA: std(0x8a3b2e), bookB: std(0x2f4f6a), bookC: std(0xb9a25a),
    warm: basic(0xffc778), amber: basic(0xf3a640), cyan: basic(0x6fdcff), pool: basic(0x4aa9bd), screen: basic(0x153a4d),
    holo: basic(0x6fdcff, { transparent: true, opacity: 0.28, depthWrite: false }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c2a36, emissive: 0xffa94d, emissiveIntensity: 0.08, transparent: true, opacity: 0.32, roughness: 0.06, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    rail: new THREE.MeshStandardMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.16, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    water: new THREE.MeshPhongMaterial({ color: 0x3fb4c8, transparent: true, opacity: 0.62, shininess: 140, specular: 0xbfd6dd, side: THREE.DoubleSide, depthWrite: false }),
  };
  for (const [k, m] of Object.entries(MATS)) { const mesh = B[k].mesh(m); if (mesh && m.transparent) mesh.renderOrder = k === 'glass' ? 4 : 3; }
  for (const [u, y, w, c, i] of [[16, 154, ref(16) - 12, 0xffcf96, 800], [10, 134, -26, 0xfff0d8, 1100]]) { const l = new THREE.PointLight(c, i, 120); l.position.set(u, y, w); g.add(l); }

  const at = (u, y, w) => V(u, y, w).applyMatrix4(frame.m);
  return {
    lift,
    spots: {
      terrace: at(-50, 148.5, ref(-50) + 19), hall: at(16, 146, ref(16) - 22), study: at(-24, 153, -44), bedroom: at(-30, 160, -44),
      lab: at(10, LY, -28), tongue: at(19, LY, rc + 26), pad: at(64, 139.2, (padIn(64) + padOut(64)) / 2), promenade: at(20, beamTop(20) + 0.05, ref(20) + 12),
    },
    label: at(8, 184, ref(8) + 12),
    debug: { ref, dB, beamTop, padIn, padOut, terOut }, // 调试用:崖面基准线等函数
  };
}
