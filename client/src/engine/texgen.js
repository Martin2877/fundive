// 程序化无缝 PBR 贴图：岩石 / 沙底。全部基于周期噪声，因此可无缝平铺。
// 输出 DataTexture（albedo sRGB、法线、粗糙度），由三平面映射材质采样。
import * as THREE from 'three';

const TAU = Math.PI * 2;

function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 周期值噪声，x/y 为晶格坐标，per 为周期
function pnoise(x, y, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per;
  const y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(u, v, per, oct, seed) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * pnoise(u * per * f, v * per * f, per * f, seed + i * 17); a *= 0.5; f *= 2; }
  return s;
}
// 周期 Voronoi：返回 F1、F2、胞元随机值
const _vo = { f1: 0, f2: 0, id: 0 };
function voronoi(u, v, n, seed) {
  const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + hash2(wx, wy, seed) * 0.85 + 0.075, py = cy + hash2(wx, wy, seed + 91) * 0.85 + 0.075;
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 7); } else if (d < f2) f2 = d;
  }
  _vo.f1 = f1; _vo.f2 = f2; _vo.id = id;
  return _vo;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// 高度场 -> 法线 + 打包
function finish(s, height, albedo, rough, normalStrength) {
  const nrm = new Uint8Array(s * s * 4), alb = new Uint8Array(s * s * 4), rgh = new Uint8Array(s * s * 4);
  const H = (x, y) => height[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, o = i * 4;
    const dx = (H(x + 1, y) - H(x - 1, y)) * normalStrength, dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    nrm[o] = (-dx * inv * 0.5 + 0.5) * 255; nrm[o + 1] = (-dy * inv * 0.5 + 0.5) * 255; nrm[o + 2] = (inv * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
    alb[o] = albedo[i * 3]; alb[o + 1] = albedo[i * 3 + 1]; alb[o + 2] = albedo[i * 3 + 2]; alb[o + 3] = 255;
    const r = rough[i] * 255;
    rgh[o] = r; rgh[o + 1] = r; rgh[o + 2] = r; rgh[o + 3] = 255;
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(alb, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
}

// 石灰岩：蜿蜒裂隙 + 溶蚀坑 + 地层条带 + 矿物染色 + 水渍垂痕（不使用多边形网格裂纹，避免"龟裂泥"观感）
export function genRock(s = 512) {
  const h = new Float32Array(s * s), alb = new Uint8Array(s * s * 3), rough = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s;
    const wu = u + fbm(u, v, 3, 3, 1) * 0.09, wv = v + fbm(u, v, 3, 3, 2) * 0.09;
    const body = fbm(u, v, 6, 5, 3);
    const r1 = 1 - Math.abs(fbm(wu, wv, 4, 3, 14)) * 3.2;                 // 主裂隙
    const r2 = 1 - Math.abs(fbm(wu + 0.37, wv + 0.11, 9, 3, 15)) * 3.6;   // 细裂纹
    const crack = smooth(0.84, 1.0, r1) * 0.5 + smooth(0.9, 1.0, r2) * 0.2;
    const gully = Math.max(0, 1 - Math.abs(fbm(u, v, 3, 4, 16)) * 2.2) ** 2; // 溶蚀沟壑
    const pv = voronoi(wu, wv, 22, 31);
    const pit = smooth(0.42, 0.1, pv.f1) * (pv.id > 0.45 ? 1 : 0.25);        // 溶蚀小坑
    const bed = Math.sin((wv * 9 + fbm(u, v, 2, 2, 4) * 1.2) * TAU) * 0.5 + 0.5;
    const fine = fbm(u, v, 80, 2, 6);
    const ht = body * 0.45 + gully * 0.25 + bed * 0.05 - crack * 0.2 - pit * 0.12 + fine * 0.05;
    h[y * s + x] = ht;
    const stain = fbm(u, v * 0.25, 5, 3, 8) * 0.5 + 0.5;               // 竖向拉伸：水渍/铁锈染
    const ochre = smooth(0.5, 0.78, stain);
    const moist = smooth(0.5, 0.88, fbm(u * 0.5, v, 6, 3, 12) * 0.5 + 0.5);
    let lum = 0.56 + body * 0.42 + gully * 0.14 + bed * 0.06 + fine * 0.08;
    lum *= 1 - crack * 0.4 - pit * 0.16;
    let r = lum * (0.97 + ochre * 0.22 - moist * 0.06), g = lum * (0.93 + ochre * 0.07), b = lum * (0.86 - ochre * 0.16 + moist * 0.05);
    const i = y * s + x;
    alb[i * 3] = clamp01(r) * 255; alb[i * 3 + 1] = clamp01(g) * 255; alb[i * 3 + 2] = clamp01(b) * 255;
    rough[i] = clamp01(0.8 - bed * 0.06 - moist * 0.25 - gully * 0.1 + crack * 0.12 + pit * 0.1);
  }
  return finish(s, h, alb, rough, 5.0);
}

// 沙/淤泥：水流波纹 + 颗粒 + 鹅卵石
export function genSand(s = 512) {
  const h = new Float32Array(s * s), alb = new Uint8Array(s * s * 3), rough = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s;
    const wv = v + fbm(u, v, 3, 3, 21) * 0.09 + fbm(u, v, 12, 2, 22) * 0.012;
    const ripple = Math.sin(wv * 22 * TAU) * 0.5 + 0.5;
    const rippleMask = smooth(-0.1, 0.5, fbm(u, v, 3, 2, 23));
    const grain = fbm(u, v, 128, 2, 24);
    const vo = voronoi(u, v, 9, 25);
    const peb = smooth(0.42, 0.12, vo.f1) * (vo.id > 0.55 ? 1 : 0);
    const ht = ripple * 0.16 * rippleMask + grain * 0.05 + peb * 0.35 + fbm(u, v, 6, 4, 26) * 0.12;
    h[y * s + x] = ht;
    const dirt = fbm(u, v, 5, 4, 27) * 0.5 + 0.5;
    let lum = 0.5 + ripple * 0.06 * rippleMask + grain * 0.1 + (dirt - 0.5) * 0.3;
    lum = lum * (1 - peb * 0.25) + peb * (vo.id - 0.5) * 0.2;
    const i = y * s + x;
    alb[i * 3] = clamp01(lum * 1.02) * 255; alb[i * 3 + 1] = clamp01(lum * 0.94) * 255; alb[i * 3 + 2] = clamp01(lum * 0.78) * 255;
    rough[i] = clamp01(0.92 - peb * 0.3 - rippleMask * ripple * 0.06);
  }
  return finish(s, h, alb, rough, 3.2);
}

// 竖向渐隐 alpha（光束、灯锥）
export function genFade(stops, h = 128) {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = h;
  const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g; c.fillRect(0, 0, 4, h);
  return new THREE.CanvasTexture(cv);
}
