// 设定坐标：公里，x 向东、y 向北。生成器和运行时共用同一条岸线。
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const BEACH = { west: -0.265, east: 0.060, center: -0.1025, length: 325 };
export function beachShore(x) {
  const t = clamp((x - BEACH.west) / (BEACH.east - BEACH.west));
  const arc = Math.sin(Math.PI * t);
  return 0.447 - 0.028 * t - 0.032 * arc * arc + 0.004 * Math.sin(2 * Math.PI * t)
    - 0.072 * Math.pow(clamp((t - 0.83) / 0.17), 2.4);
}
export function beachProfile(x, y) {
  const t = clamp((x - BEACH.west) / (BEACH.east - BEACH.west));
  const inland = (beachShore(x) - y) * 1000;
  const arc = Math.sin(Math.PI * t);
  const width = Math.sqrt(arc) * (45 + 6 * Math.sin(t * Math.PI * 2 + 0.8));
  // 横纵两个方向共同收口，滩肩随弧线变窄并逐渐接回原有岩坡。
  const along = (x - BEACH.center) / ((BEACH.east - BEACH.west) / 2);
  const cross = (inland - 0.30 * width) / 92;
  const basin = 1 - smooth(0.76, 1.09, Math.hypot(along, cross));
  const nearShore = smooth(-0.275, -0.237, x) * (1 - smooth(0.038, BEACH.east, x))
    * (1 - smooth(10, 48, Math.abs(inland)));
  const weight = 1 - (1 - basin) * (1 - nearShore);
  const height = inland * 0.077 + 0.14 * Math.sin(x * 39 + inland * 0.09) * smooth(2, 20, inland);
  const sand = smooth(0.035, 0.40, arc) * smooth(-23, -5, inland) * (1 - smooth(width - 5, width + 14, inland));
  return { weight, height, inland, width, sand };
}
export function sculptBeach(x, y, original) {
  const p = beachProfile(x, y);
  return original + (p.height - original) * p.weight;
}
