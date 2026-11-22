// 设定坐标：公里，x 向东、y 向北。生成器和运行时共用同一条岸线。
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const BEACH = { west: -0.265, east: 0.060, center: -0.1025, length: 325 };
export function beachShore(x) {
  return 0.433 + 0.40 * (x + 0.015) ** 2 + 0.003 * Math.sin(x * 38);
}
export function beachProfile(x, y) {
  const along = smooth(BEACH.west, BEACH.west + 0.038, x) * (1 - smooth(BEACH.east - 0.035, BEACH.east, x));
  const inland = (beachShore(x) - y) * 1000;
  const width = 36 + 16 * Math.sin(clamp((x - BEACH.west) / (BEACH.east - BEACH.west)) * Math.PI);
  const weight = along * smooth(-80, -38, inland) * (1 - smooth(width, width + 48, inland));
  // 干砂缓坡 → 潮湿砂带 → 连续入海的砂质浅坡；不填平东侧河口。
  const height = inland < 0 ? inland * 0.095 : 0.10 + inland * 0.075 + 0.16 * Math.sin(x * 180 + inland * 0.18) * smooth(2, 14, inland);
  return { weight, height, inland, width, sand: along * smooth(-15, -2, inland) * (1 - smooth(width - 5, width + 10, inland)) };
}
export function sculptBeach(x, y, original) {
  const p = beachProfile(x, y);
  return original + (p.height - original) * p.weight;
}
