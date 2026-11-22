// 真实船体建模器：按真实货轮船型参数放样船壳，再铺甲板/舷墙/货舱/上层建筑/
// 烟囱/桅杆/吊杆/螺旋桨/舵/舾装件。视觉与碰撞同源——每个碰撞箱对应一处实体面。
// 三种船型：coaster 沿岸货轮 / cargo 二战军需轮(Thistlegorm) / liner 侧倾客轮(Yongala)。
import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { range, chance, intRange } from '@fundive/shared/rng.js';

// ---------- 几何累加器（带 uv：船体贴图按米平铺） ----------
class Acc {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }
  vert(p, c, u, v) { this.pos.push(p.x, p.y, p.z); this.col.push(c[0], c[1], c[2]); this.uv.push(u, v); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, d, b, b, d, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const box3 = (boxes, x0, x1, y0, y1, z0, z1, c = null) => {
  const b = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) };
  if (c) { b.c = c; return boxes.push(b) - 1; }
  boxes.push(b); return boxes.length - 1;
};

// ---------- 船型线（local 坐标：x -L/2=艏 → +L/2=艉，y=0 龙骨基线，z 舷宽） ----------
// 返回半宽 hb(t)、龙骨抬高 y0(t)、舷缘高 dy(t)、剖面形状 shape(t,u)
function hullForm(L, W, D) {
  const hb = (t) => W / 2 * (t < 0.30 ? Math.pow(t / 0.30, 0.62)
    : t > 0.72 ? 1 - 0.56 * Math.pow((t - 0.72) / 0.28, 1.8) : 1);
  const y0 = (t) => t < 0.16 ? D * 0.42 * Math.pow((0.16 - t) / 0.16, 1.7)
    : t > 0.86 ? D * 0.15 * Math.pow((t - 0.86) / 0.14, 1.5) : 0;
  const dy = (t) => D + D * 0.085 * Math.pow(Math.max(0, (0.4 - t) / 0.4), 2)
    + D * 0.05 * Math.pow(Math.max(0, (t - 0.76) / 0.24), 2);
  // 前倾艏柱 + 艉悬伸：剖面顶点随高度前后偏移
  const rake = (t, u) => t < 0.14 ? -D * 0.42 * u * u * Math.pow(1 - t / 0.14, 1.2)
    : t > 0.9 ? D * 0.2 * u * u * ((t - 0.9) / 0.1) : 0;
  const vness = (t) => Math.min(0.85, (1 - hb(t) / (W / 2)) * 1.5 + (t < 0.32 ? 0.3 : 0));
  const shape = (t, u) => {
    const flat = Math.pow(Math.min(1, u / 0.13), 0.42);          // 平底+舭部转圆
    const vv = Math.pow(u, 0.72);                                 // 端部 V 形剖面
    let s = flat * (1 - vness(t)) + vv * vness(t);
    s *= 1 - 0.06 * Math.max(0, u - 0.6);                         // 内倾（tumblehome）
    s *= 1 + 0.1 * Math.min(1, Math.max(0, (u - 0.62) / 0.38)) * Math.max(0, (0.36 - t) / 0.36); // 艏部外飘
    return Math.min(1, Math.max(0, s));
  };
  return { hb, y0, dy, rake, shape };
}

// 顶点色：水下船体的锈蚀/海生物着色——低部绿藻壳、舷侧锈痕垂流、甲板灰旧
const colRust = [0.6, 0.36, 0.22], colHullDark = [0.34, 0.3, 0.26], colDeck = [0.42, 0.4, 0.35];
const colSuper = [0.58, 0.58, 0.55], colInside = [0.3, 0.28, 0.25], colGear = [0.4, 0.32, 0.25];
function rustTone(x, y, z, rng) {
  const streak = Math.max(0, fbm3(x * 0.7, y * 0.18 + 9, z * 0.7, 3)) * (0.4 + 0.6 * Math.min(1, y / 4));
  const fouling = Math.max(0, fbm3(x * 0.5 + 3, y * 0.5, z * 0.5 + 7, 3));
  const base = 0.75 + 0.3 * fbm3(x * 0.9, y * 0.9, z * 0.9, 2);
  const r = (colRust[0] * (0.6 + streak) + fouling * 0.12) * base;
  const g = (colRust[1] * (0.8 + streak * 0.3) + fouling * 0.16) * base;
  const b = (colRust[2] * (0.9 - streak * 0.2) + fouling * 0.12) * base;
  return [r, g, b];
}

// ---------- 主构建 ----------
// w: {x,z,len,wid,hei,layout,bare,keelHole}  y0: 海底高（龙骨落底）  返回 {boxes, props, geo}
// bare：只出裸船壳+货舱+桨舵（liner 侧滚用）；keelHole:{x0,x1} 在船底撕一条进入缝
export function buildWreckShip(w, y0, rng) {
  const layout = w.layout || 'coaster';
  const bare = !!w.bare;
  const L = w.len, W = w.wid, D = w.hei - 1.2;                 // 型深：主甲板高
  const F = hullForm(L, W, D);
  const acc = new Acc(), boxes = [], props = [];
  const wx = w.x, wz = w.z;
  const X = (x) => wx + x, Z = (z) => wz + z;
  const bx = (x0, x1, ya, yb, z0, z1) => box3(boxes, X(x0), X(x1), y0 + ya, y0 + yb, Z(z0), Z(z1));
  const pr = (x0, x1, ya, yb, z0, z1, c) => box3(props, X(x0), X(x1), y0 + ya, y0 + yb, Z(z0), Z(z1), c);
  const US = 0.25;   // uv 比例：贴图每 4m 一铺

  // —— 船壳放样：30 站 × 半剖 11 点，外侧+内侧（内壳内缩 0.3，双层船壳观感） ——
  const NS = 30, K = 11;
  const ring = [];   // ring[i][j] = {x,y,z,u,side} 侧 +1 右舷 / -1 左舷，u: 0 龙骨→1 舷缘
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, x = -L / 2 + L * t, hb = F.hb(t), yb = F.y0(t), yt = F.dy(t);
    const pts = [{ x, y: yb + 0.02, z: 0, u: 0 }];                                    // 龙骨中点
    for (let k = 1; k < K; k++) {                                                     // 右舷上行
      const u = k / (K - 1);
      pts.push({ x: x + F.rake(t, u), y: yb + (yt - yb) * u, z: hb * F.shape(t, u), u });
    }
    for (let k = K - 1; k >= 1; k--) {                                                // 左舷下行
      const u = k / (K - 1);
      pts.push({ x: x + F.rake(t, u), y: yb + (yt - yb) * u, z: -hb * F.shape(t, u), u });
    }
    ring.push(pts);
  }
  const shellIdx = (inset) => ring.map((pts, i) => pts.map(p => {
    const t = i / NS;
    // 内壳：向舯心内缩，形成空舱/双层底观感
    const q = inset ? { x: p.x, y: Math.max(p.y, F.y0(t) + 0.42) - 0.02, z: p.z * 0.86, u: p.u } : p;
    if (inset) q.y = Math.min(q.y, F.dy(t) - 0.18);
    return acc.vert(_v.set(X(q.x), y0 + q.y, Z(q.z)), rustTone(q.x, q.y, q.z, rng), q.x * US, q.y * US);
  }));
  const outer = shellIdx(false), inner = shellIdx(true);
  const NR = ring[0].length;
  const KH = w.keelHole ? { i0: Math.ceil((w.keelHole.x0 + L / 2) / L * NS), i1: Math.floor((w.keelHole.x1 + L / 2) / L * NS) } : null;
  const keelCut = (i, j) => KH && i >= KH.i0 && i <= KH.i1 && (j === 0 || j === NR - 2);   // 龙骨两侧 u<0.1 的面片
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR - 1; j++) {
    if (j === (NR - 1) / 2 || keelCut(i, j)) continue;                                  // 顶部开口留给甲板；船底撕缝
    const a = outer[i][j], b = outer[i][j + 1], c = outer[i + 1][j + 1], d = outer[i + 1][j];
    acc.quad(a, b, c, d);                                                              // 外表面
    const a2 = inner[i][j], b2 = inner[i][j + 1], c2 = inner[i + 1][j + 1], d2 = inner[i + 1][j];
    acc.idx.push(a2, b2, d2, b2, c2, d2);                                              // 内表面（反向）
  }
  // 舷墙：舷缘上翻 0.95m 实壁（外侧+内侧）
  const BHW = 0.95;
  const bwl = (side) => {
    for (let i = 0; i < NS; i++) {
      const t0 = i / NS, t1 = (i + 1) / NS;
      const x0 = -L / 2 + L * t0, x1 = -L / 2 + L * t1;
      const p = [
        [x0, F.dy(t0), side * F.hb(t0)], [x1, F.dy(t1), side * F.hb(t1)],
        [x1, F.dy(t1) + BHW, side * (F.hb(t1) + 0.05)], [x0, F.dy(t0) + BHW, side * (F.hb(t0) + 0.05)],
      ];
      const c0 = rustTone(x0, D, side * W / 2, rng);
      const v = p.map((q, k) => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), k < 2 ? c0 : [c0[0] * 0.9, c0[1] * 0.9, c0[2] * 0.9], q[0] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]); acc.idx.push(v[0], v[3], v[1], v[1], v[3], v[2]);
      const zb0 = Math.min(F.hb(t0), F.hb(t1)), zb1 = Math.max(F.hb(t0), F.hb(t1));
      bx(Math.min(x0, x1), Math.max(x0, x1), Math.min(F.dy(t0), F.dy(t1)), Math.max(F.dy(t0), F.dy(t1)) + BHW,
        side > 0 ? zb0 - 0.12 : -zb1 - 0.25, side > 0 ? zb1 + 0.25 : -zb0 + 0.12);
    }
  };
  bwl(1); bwl(-1);

  // —— 碰撞：舷侧分段壁板（跟随型线收分）、船底、艏艉端板 ——
  const NSEG = 10;
  for (let s = 0; s < NSEG; s++) {
    const t0 = s / NSEG, t1 = (s + 1) / NSEG, tm = (t0 + t1) / 2;
    const x0 = -L / 2 + L * t0, x1 = -L / 2 + L * t1;
    const zA = Math.min(F.hb(t0), F.hb(t1)) - 0.3, zB = Math.max(F.hb(t0), F.hb(t1)) + 0.05;
    const yA = Math.min(F.y0(t0), F.y0(t1)) - 0.2, yB = Math.max(F.dy(t0), F.dy(t1));
    bx(x0, x1, yA, yB, zA, zB); bx(x0, x1, yA, yB, -zB, -zA);
  }
  if (KH) {
    const kx0 = -L / 2 + L * KH.i0 / NS - 0.1, kx1 = -L / 2 + L * (KH.i1 + 1) / NS + 0.1;
    bx(-L / 2 - 0.3, kx0, -0.3, 0.55, -W / 2, W / 2);                                   // 船底（撕缝前）
    bx(kx1, L / 2, -0.3, 0.55, -W / 2, W / 2);                                          // 船底（撕缝后）
    bx(kx0, kx1, -0.3, 0.55, -W / 2, -W * 0.42); bx(kx0, kx1, -0.3, 0.55, W * 0.42, W / 2); // 缝两侧船底
  } else bx(-L / 2 - 0.3, L / 2, -0.3, 0.55, -W / 2, W / 2);                            // 船底
  bx(L / 2 - 0.6, L / 2 + 0.3, 0, F.dy(1), -F.hb(1), F.hb(1));                          // 艉封板
  bx(-L / 2 - 0.3, -L / 2 + 0.2, 0, F.dy(0), -0.6, 0.6);                                // 艏柱

  // —— 甲板：按舱口区切侧条，随舷弧起拱 ——
  const holds = layout === 'cargo' ? [{ x0: -16, x1: -6, hw: 3.4 }, { x0: 2, x1: 14, hw: 3.4 }]
    : layout === 'liner' ? [{ x0: -14, x1: -2, hw: 2.8 }]
      : [{ x0: -12.5, x1: -1.5, hw: 2.5 }, { x0: 1.5, x1: 14, hw: 2.5 }];
  const holdFloor = 1.25;
  const inHold = (x) => holds.find(h => x >= h.x0 && x <= h.x1);
  const deckC = (x, y, z) => { const k = 0.8 + 0.25 * fbm3(x * 0.5, y, z * 0.5, 2); return [colDeck[0] * k, colDeck[1] * k, colDeck[2] * k]; };
  const deckStrip = (x0, x1, z0, z1) => {
    const t0 = (x0 + L / 2) / L, t1 = (x1 + L / 2) / L;
    const yA = F.dy(t0), yB = F.dy(t1), cam = 0.07;
    const zm = (z0 + z1) / 2;
    for (const [za, zb] of [[z0, zm], [zm, z1]]) {
      const p = [[x0, yA, za], [x1, yB, za], [x1, yB + cam, zb], [x0, yA + cam, zb]];
      const v = p.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), deckC(q[0], q[1], q[2]), (q[0] + q[2]) * US, q[2] * US * 0.5));
      acc.quad(v[0], v[1], v[2], v[3]); acc.idx.push(v[0], v[3], v[1], v[1], v[3], v[2]);
    }
    bx(Math.min(x0, x1), Math.max(x0, x1), Math.min(yA, yB) - 0.22, Math.max(yA, yB) + 0.1, Math.min(z0, z1), Math.max(z0, z1));
  };
  for (let s = 0; s < NS; s++) {
    const t0 = s / NS, t1 = (s + 1) / NS, x0 = -L / 2 + L * t0, x1 = -L / 2 + L * t1, xm = (x0 + x1) / 2;
    const hb0 = F.hb(t0), hb1 = F.hb(t1), zIn = Math.min(hb0, hb1) - 0.15;
    if (zIn < 0.4) continue;
    const h = inHold(xm);
    if (h) { deckStrip(x0, x1, -zIn, -h.hw); deckStrip(x0, x1, h.hw, zIn); }
    else deckStrip(x0, x1, -zIn, zIn);
  }

  // —— 货舱：围板(coaming)、四面内舱壁、舱底 ——
  const holdWall = (h) => {
    const deckY = (x) => F.dy((x + L / 2) / L);
    const yTop = Math.max(deckY(h.x0), deckY(h.x1));
    // 舱口围板（高出甲板 0.55）
    const coam = [[h.x0, h.x1, -h.hw - 0.3, -h.hw], [h.x0, h.x1, h.hw, h.hw + 0.3], [h.x0 - 0.3, h.x0, -h.hw, h.hw], [h.x1, h.x1 + 0.3, -h.hw, h.hw]];
    for (const [x0, x1, z0, z1] of coam) {
      const p = [[x0, yTop, z0], [x1, yTop, z0], [x1, yTop + 0.55, z1], [x0, yTop + 0.55, z1]];
      const v = p.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), colGear, q[0] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]); acc.idx.push(v[0], v[3], v[1], v[1], v[3], v[2]);
      bx(x0, x1, yTop, yTop + 0.55, z0, z1);
    }
    // 内舱壁（面向舱内的亮面 + 背面的暗面）
    const walls = [
      [[h.x0, holdFloor, -h.hw], [h.x0, holdFloor, h.hw], [h.x0, yTop, h.hw], [h.x0, yTop, -h.hw]],
      [[h.x1, holdFloor, h.hw], [h.x1, holdFloor, -h.hw], [h.x1, yTop, -h.hw], [h.x1, yTop, h.hw]],
      [[h.x0, holdFloor, -h.hw], [h.x1, holdFloor, -h.hw], [h.x1, yTop, -h.hw], [h.x0, yTop, -h.hw]],
      [[h.x1, holdFloor, h.hw], [h.x0, holdFloor, h.hw], [h.x0, yTop, h.hw], [h.x1, yTop, h.hw]],
    ];
    for (const q4 of walls) {
      const v = q4.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), colInside, q[0] * US + q[2] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]);
    }
    // 舱底
    const f = [[h.x0, holdFloor, -h.hw], [h.x1, holdFloor, -h.hw], [h.x1, holdFloor, h.hw], [h.x0, holdFloor, h.hw]];
    const fv = f.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), [0.32, 0.3, 0.26], q[0] * US, q[2] * US));
    acc.quad(fv[0], fv[1], fv[2], fv[3]); acc.idx.push(fv[0], fv[3], fv[1], fv[1], fv[3], fv[2]);
    bx(h.x0 - 0.1, h.x0 + 0.18, holdFloor, yTop, -h.hw, h.hw);
    bx(h.x1 - 0.18, h.x1 + 0.1, holdFloor, yTop, -h.hw, h.hw);
    bx(h.x0, h.x1, holdFloor, yTop, -h.hw - 0.18, -h.hw + 0.05);
    bx(h.x0, h.x1, holdFloor, yTop, h.hw - 0.05, h.hw + 0.18);
    bx(h.x0, h.x1, holdFloor - 0.2, holdFloor + 0.08, -h.hw, h.hw);
  };
  holds.forEach(holdWall);

  // —— 上层建筑（含可进入的海图室内景） ——
  const sup = layout === 'cargo' ? { x0: -6, x1: 1, w: 2.9, h: 3.3, door: 'port' }
    : { x0: 12, x1: 16.5, w: 3.0, h: 2.9, door: 'fore' };
  if (!bare) {
  const supY = F.dy((sup.x0 + L / 2) / L);
  const sw = sup.w, sx0 = sup.x0, sx1 = sup.x1, sy0 = supY, sy1 = supY + sup.h;
  const supC = (x, y, z) => { const k = 0.85 + 0.2 * fbm3(x * 0.6, y * 0.6, z * 0.6, 2); const rust = Math.max(0, fbm3(x * 0.8, y * 0.25, z * 0.8, 2)) * 0.5; return [colSuper[0] * k * (1 - rust * 0.4) + rust * 0.2, colSuper[1] * k * (1 - rust * 0.5), colSuper[2] * k * (1 - rust * 0.55)]; };
  // 外墙（带窗带：上层一圈深色窗洞色带）
  const supWall = (x0, x1, z0, z1, inward) => {
    const c1 = supC((x0 + x1) / 2, sy1 - 0.5, (z0 + z1) / 2), c0 = supC((x0 + x1) / 2, sy0, (z0 + z1) / 2);
    const yw = sy1 - 0.75;   // 窗带下沿
    const mk = (yA, yB, cc) => {
      const p = inward ? [[x0, yA, z0], [x0, yA, z1], [x1, yB, z1], [x1, yB, z0]] : [[x0, yA, z1], [x0, yA, z0], [x1, yB, z0], [x1, yB, z1]];
      const v = p.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), cc, q[0] * US + q[2] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]);
    };
    mk(sy0, yw, c0); mk(yw, sy1, [0.12, 0.14, 0.15]);   // 窗洞带：近黑的玻璃
  };
  // 四面外墙 + 顶；门洞开在 door 朝向的墙上
  if (sup.door === 'fore') {
    // 前壁留门洞 z -0.95..0.95：两侧壁柱 + 门楣
    supWall(sx0 - 0.25, sx0, -sw, -0.95, false);
    supWall(sx0 - 0.25, sx0, 0.95, sw, false);
    const mk = (yA, yB) => {
      const p = [[sx0 - 0.25, yA, -0.95], [sx0 - 0.25, yA, 0.95], [sx0, yB, 0.95], [sx0, yB, -0.95]];
      const v = p.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), colSuper, q[0] * US + q[2] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]);
    };
    mk(sy0 + 2.15, sy1);
    bx(sx0 - 0.25, sx0, sy0, sy1, -sw, -0.95); bx(sx0 - 0.25, sx0, sy0, sy1, 0.95, sw);
    bx(sx0 - 0.25, sx0, sy0 + 2.15, sy1, -0.95, 0.95);
  } else {
    supWall(sx0 - 0.25, sx0, -sw, sw, false);          // 前壁
    bx(sx0 - 0.25, sx0, sy0, sy1, -sw, sw);
  }
  supWall(sx1, sx1 + 0.25, sw, -sw, false);            // 后壁
  supWall(sx0, sx1, sw - 0.25, sw, false);             // 右舷壁
  if (sup.door === 'port') {
    // 左舷壁分三段留门洞 x -3.4..-1.8, y sy0..sy0+2.2
    supWall(sx0, -3.4, -sw, -sw + 0.25, false);
    supWall(-1.8, sx1, -sw, -sw + 0.25, false);
    const mk = (yA, yB) => {
      const p = [[-3.4, yA, -sw], [-1.8, yA, -sw], [-1.8, yB, -sw + 0.25], [-3.4, yB, -sw + 0.25]];
      const v = p.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), colSuper, q[0] * US, q[1] * US));
      acc.quad(v[0], v[1], v[2], v[3]);
    };
    mk(sy0 + 2.2, sy1);
    bx(sx0, -3.4, sy0, sy1, -sw, -sw + 0.25); bx(-1.8, sx1, sy0, sy1, -sw, -sw + 0.25);
    bx(-3.4, -1.8, sy0 + 2.2, sy1, -sw, -sw + 0.25);
  } else supWall(sx0, sx1, -sw + 0.25, -sw, false);
  // 顶 + 内景（海图室：内墙亮面）
  const roof = [[sx0, sy1, -sw], [sx1, sy1, -sw], [sx1, sy1, sw], [sx0, sy1, sw]];
  const rv = roof.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), colSuper, q[0] * US, q[2] * US));
  acc.quad(rv[0], rv[1], rv[2], rv[3]); acc.idx.push(rv[0], rv[3], rv[1], rv[1], rv[3], rv[2]);
  const innerC = [0.36, 0.34, 0.3];
  for (const q4 of [
    [[sx0 + 0.05, sy0, -sw + 0.3], [sx0 + 0.05, sy0, sw - 0.3], [sx0 + 0.05, sy1 - 0.05, sw - 0.3], [sx0 + 0.05, sy1 - 0.05, -sw + 0.3]],
    [[sx1 - 0.05, sy0, sw - 0.3], [sx1 - 0.05, sy0, -sw + 0.3], [sx1 - 0.05, sy1 - 0.05, -sw + 0.3], [sx1 - 0.05, sy1 - 0.05, sw - 0.3]],
    [[sx0, sy0, -sw + 0.3], [sx1, sy0, -sw + 0.3], [sx1, sy1 - 0.05, -sw + 0.3], [sx0, sy1 - 0.05, -sw + 0.3]],
    [[sx1, sy0, sw - 0.3], [sx0, sy0, sw - 0.3], [sx0, sy1 - 0.05, sw - 0.3], [sx1, sy1 - 0.05, sw - 0.3]],
    [[sx0, sy1 - 0.05, -sw + 0.3], [sx1, sy1 - 0.05, -sw + 0.3], [sx1, sy1 - 0.05, sw - 0.3], [sx0, sy1 - 0.05, sw - 0.3]],
  ]) {
    const v = q4.map(q => acc.vert(_v.set(X(q[0]), y0 + q[1], Z(q[2])), innerC, q[0] * US + q[2] * US, q[1] * US));
    acc.quad(v[0], v[1], v[2], v[3]);
  }
  bx(sx1, sx1 + 0.25, sy0, sy1, -sw, sw);              // 后壁碰撞
  bx(sx0, sx1, sy0, sy1, sw - 0.25, sw);               // 右舷壁碰撞
  if (sup.door !== 'port') bx(sx0, sx1, sy0, sy1, -sw, -sw + 0.25);
  bx(sx0, sx1, sy1 - 0.05, sy1 + 0.15, -sw, sw);       // 顶
  // 海图桌 + 保险柜
  const chx = (sx0 + sx1) / 2;
  pr(chx - 0.7, chx + 0.7, sy0, sy0 + 0.85, -0.6, 0.6, [0.4, 0.3, 0.2]);
  pr(sx1 - 1.1, sx1 - 0.5, sy0, sy0 + 1.25, sw - 1.4, sw - 0.7, [0.24, 0.3, 0.3]);
  }   // end if (!bare) 上层建筑

  // —— 烟囱、桅杆、吊杆、舾装 ——
  const geo = (g, c, px, py, pz, rx = 0, ry = 0, rz = 0, us = US) => {
    g = g.toNonIndexed(); const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 2, uvA.getY(i) * 2);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(X(px), y0 + py, Z(pz));
    const base = acc.pos.length / 3, pa = g.attributes.position.array, ca = g.attributes.color.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i++) acc.pos.push(pa[i]);
    for (let i = 0; i < ca.length; i++) acc.col.push(ca[i]);
    for (let i = 0; i < ua.length; i++) acc.uv.push(ua[i]);
    const ic = g.index ? g.index.count : n;
    for (let i = 0; i < ic; i++) acc.idx.push((g.index ? g.index.array[i] : i) + base);
  };
  if (!bare) {
  // 烟囱（微后倾）
  const fun = layout === 'cargo' ? { x: 4, r: 0.95, h: 4.6 } : { x: 14.2, r: 0.8, h: 4.2 };
  const fy = F.dy((fun.x + L / 2) / L);
  geo(new THREE.CylinderGeometry(fun.r * 0.92, fun.r * 1.06, fun.h, 12), [0.3, 0.22, 0.18], fun.x, fy + fun.h / 2, 0, 0.12);
  geo(new THREE.CylinderGeometry(fun.r * 1.05, fun.r * 1.05, 0.35, 12), [0.18, 0.16, 0.15], fun.x, fy + fun.h, 0, 0.12);
  box3(boxes, X(fun.x - fun.r), X(fun.x + fun.r), y0 + fy, y0 + fy + fun.h, Z(-fun.r), Z(fun.r));
  // 桅杆 + 吊杆（货吊）
  const masts = layout === 'cargo' ? [{ x: -20, h: 13, booms: 1 }, { x: -2.5, h: 9, booms: 1 }] : [{ x: -6, h: 12, booms: 1 }, { x: 5, h: 10, booms: 1 }];
  for (const m of masts) {
    const my = F.dy((m.x + L / 2) / L);
    geo(new THREE.CylinderGeometry(0.14, 0.22, m.h, 8), colGear, m.x, my + m.h / 2, 0);
    if (m.booms) {
      geo(new THREE.CylinderGeometry(0.08, 0.11, m.h * 0.55, 6), colGear, m.x + 1.2, my + m.h * 0.42, 0, 0, 0, -0.9);
      geo(new THREE.CylinderGeometry(0.07, 0.1, m.h * 0.5, 6), colGear, m.x - 1.1, my + m.h * 0.38, 0, 0, 0, 0.85);
    }
    box3(boxes, X(m.x - 0.15), X(m.x + 0.15), y0 + my, y0 + my + m.h, Z(-0.15), Z(0.15));
  }
  // 艏楼绞盘 + 锚链筒 + 系缆桩
  const fx = -L / 2 + L * 0.06, fy0 = F.dy(0.06);
  geo(new THREE.CylinderGeometry(0.5, 0.55, 1.6, 10), [0.3, 0.28, 0.26], fx, fy0 + 0.8, 0, 0, 0, Math.PI / 2);
  geo(new THREE.BoxGeometry(1.8, 0.5, 1.2), [0.32, 0.3, 0.28], fx, fy0 + 0.25, 0);
  for (const s of [-1, 1]) {
    geo(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 8), colHullDark, fx - 1.6, fy0 + 0.4, s * (W / 2 - 0.7), 0.5 * s);
    box3(boxes, X(fx - 1.2), X(fx + 0.9), y0 + fy0, y0 + fy0 + 1.15, Z(-0.9), Z(0.9));
  }
  for (let i = 0; i < 5; i++) {
    const bxp = -L / 2 + L * (0.16 + i * 0.15);
    for (const s of [-1, 1]) geo(new THREE.CylinderGeometry(0.07, 0.1, 0.55, 6), colGear, bxp, F.dy((bxp + L / 2) / L) + 0.28, s * (F.hb((bxp + L / 2) / L) - 0.45));
  }
  }   // end if (!bare) 烟囱/桅杆/舾装
  // 舭龙骨（侧底部细条——真实船体细节）
  for (const s of [-1, 1]) geo(new THREE.BoxGeometry(L * 0.5, 0.5, 0.06), colHullDark, 0, 0.9, s * (W / 2 - 0.35));
  // 螺旋桨（毂+4叶）+ 舵 + 艉柱
  const px = L / 2 - L * 0.035, py = 1.15;
  geo(new THREE.CylinderGeometry(0.16, 0.32, 1.1, 8), [0.35, 0.28, 0.2], px, py, 0, 0, 0, Math.PI / 2);
  for (let b = 0; b < 4; b++) {
    const a = b * Math.PI / 2 + 0.4;
    const bl = new THREE.BoxGeometry(0.06, 1.05, 0.42); bl.translate(0, 0.62, 0); bl.rotateY(0.5); bl.rotateX(a);
    geo(bl, [0.38, 0.3, 0.2], px, py, 0);
  }
  geo(new THREE.BoxGeometry(1.3, 1.7, 0.09), colHullDark, px + 1.15, 1.5, 0);
  box3(boxes, X(px - 0.4), X(px + 1.6), y0, y0 + 2.5, Z(-0.8), Z(0.8));

  // —— 各船型专属 ——
  if (layout === 'cargo') {
    // 一号货舱：三辆军用卡车 + 木箱（Thistlegorm 的 Bedford 车队）
    for (const tx of [-14.2, -11.2, -8.2]) {
      pr(tx, tx + 2.4, holdFloor, holdFloor + 1.45, -2.9, -1.0, [0.42, 0.34, 0.2]);
      pr(tx + 0.3, tx + 1.4, holdFloor + 1.45, holdFloor + 2.4, -2.6, -1.3, [0.4, 0.32, 0.18]);
      pr(tx - 0.15, tx + 0.4, holdFloor, holdFloor + 0.5, -2.85, -0.95, [0.15, 0.13, 0.12]);
    }
    const cc = [[0.22, 0.4, 0.45], [0.42, 0.38, 0.24], [0.5, 0.3, 0.22], [0.3, 0.36, 0.3]];
    for (const [x, z, s, hh] of [[-14.2, 1.6, 1.3, 1.1], [-12.4, 1.8, 1.1, 1.5], [-9.8, 1.7, 1.2, 0.9], [-7.6, 1.8, 1.0, 1.3], [-13.6, 0.2, 1.0, 1.2], [-10.4, 0.4, 0.9, 0.8]])
      pr(x, x + s, holdFloor, holdFloor + hh, z, z + 1.1, cc[props.length % cc.length]);
    // 二号货舱：弹药箱方阵 + 履带牵引车 + 油桶
    for (let i = 0; i < 8; i++) {
      const cx = 3.2 + (i % 4) * 1.9, cz = -3.1 + Math.floor(i / 4) * 2.0;
      pr(cx, cx + 1.3, holdFloor, holdFloor + 0.9 + rng() * 0.4, cz, cz + 1.15, cc[i % cc.length]);
    }
    pr(9.5, 12.8, holdFloor, holdFloor + 1.3, -2.7, -0.8, [0.38, 0.3, 0.2]);
    pr(10, 12.4, holdFloor + 1.3, holdFloor + 2.1, -2.4, -1.1, [0.35, 0.27, 0.17]);
    pr(9.6, 10.4, holdFloor, holdFloor + 0.5, 1.4, 2.6, [0.15, 0.13, 0.12]);
    for (const [x, z] of [[11.2, 1.6], [11.8, 2.1], [12.3, 1.7], [4.2, 2.4]]) pr(x, x + 0.55, holdFloor, holdFloor + 1.0, z, z + 0.55, [0.5, 0.28, 0.18]);
    // 艉甲板高射炮（Thistlegorm 标志）
    const gx = 21.5, gy = F.dy(0.9);
    geo(new THREE.CylinderGeometry(0.55, 0.75, 1.0, 10), colGear, gx, gy + 0.5, 0);
    geo(new THREE.CylinderGeometry(0.13, 0.2, 4.4, 8), [0.22, 0.24, 0.22], gx + 0.4, gy + 2.2, 0, 0, 0, -0.6);
    geo(new THREE.BoxGeometry(0.12, 1.5, 2.2), colGear, gx - 0.3, gy + 1.5, 0, 0, 0, -0.15);
    box3(boxes, X(gx - 0.8), X(gx + 0.8), y0 + gy, y0 + gy + 3.6, Z(-1.1), Z(1.1));
    // 断裂艉段：独立小段船壳，下沉错位、略翻——落在主船体外
    {
      const sx0 = L / 2 + 1.4, sx1 = L / 2 + 7.5, sdz = -1.6;
      const frag = new THREE.CylinderGeometry(W / 2 * 0.85, W / 2 * 0.7, sx1 - sx0, 12, 1, true, Math.PI * 0.15, Math.PI * 1.7);
      geo(frag, colRust, (sx0 + sx1) / 2, 2.2, sdz, 0, 0.1, 0.06);
      const fdeck = new THREE.BoxGeometry(sx1 - sx0, 0.3, W * 0.72);
      geo(fdeck, colDeck, (sx0 + sx1) / 2, 4.1, sdz, 0, 0, 0.05);
      box3(boxes, X(sx0), X(sx1), y0, y0 + 4.2, Z(sdz - W / 2), Z(sdz - W / 2 + 0.4));
      box3(boxes, X(sx0), X(sx1), y0, y0 + 4.2, Z(sdz + W / 2 - 0.4), Z(sdz + W / 2));
      box3(boxes, X(sx0), X(sx1), y0 + 3.9, y0 + 4.3, Z(sdz - W / 2), Z(sdz + W / 2));
    }
    // 落海的火车头（真船甲板货，沉船时甩到船侧沙地——Thistlegorm 著名遗物）
    {
      const lx = L / 2 + 9.5, lz = 7.5;
      geo(new THREE.CylinderGeometry(0.95, 0.95, 5.2, 12), [0.2, 0.2, 0.19], lx, 1.0, lz, 0, 0, Math.PI / 2 - 0.12);
      geo(new THREE.BoxGeometry(2.2, 2.0, 1.9), [0.22, 0.22, 0.2], lx + 3.4, 1.4, lz, 0, 0, 0.05);
      for (let dw = 0; dw < 3; dw++) geo(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 10), [0.15, 0.15, 0.14], lx - 1.6 + dw * 1.6, 0.55, lz - 0.95, Math.PI / 2);
      box3(boxes, X(lx - 2.8), X(lx + 4.6), y0, y0 + 2.4, Z(lz - 1.4), Z(lz + 1.4));
    }
  } else if (layout === 'coaster') {
    // 沿岸货轮内景：木箱 + 一辆运输车 + 油桶 + 机舱机座
    const cc = [[0.22, 0.4, 0.45], [0.42, 0.38, 0.24], [0.5, 0.3, 0.22], [0.3, 0.36, 0.3]];
    for (const [x, z, s, hh] of [[-12.6, -1.9, 1.4, 1.2], [-10.8, -1.8, 1.1, 1.5], [-8.4, -1.9, 1.3, 0.95], [-12, 1.2, 1.2, 1.3], [-6, 1.4, 1, 1.1], [-4.2, -1.8, 1, 1.25],
      [3.4, -1.8, 1.1, 1.15], [5.1, -1.9, 0.95, 1.4], [8.6, -1.8, 1.25, 1.05], [12.6, -1.7, 1.05, 1.2], [5.8, 1.3, 1.05, 1.1], [15, 1.2, 0.9, 1]])
      pr(x, x + s, holdFloor, holdFloor + hh, z, z + Math.min(1.1, s + 0.15), cc[props.length % cc.length]);
    pr(-9.4, -6.2, holdFloor, holdFloor + 1.5, -1.7, -0.2, [0.5, 0.34, 0.24]);       // 卡车
    pr(-6.2, -5.3, holdFloor, holdFloor + 1.9, -1.55, -0.35, [0.46, 0.3, 0.2]);
    pr(3.4, 6.4, holdFloor, holdFloor + 1.5, 0.4, 1.9, [0.3, 0.3, 0.3]);            // 机舱机座
    for (const [x, z] of [[2.2, -1.6], [2.7, -1.75], [-13.2, 1.6], [-12.7, 1.9]]) pr(x, x + 0.5, holdFloor, holdFloor + 0.9, z, z + 0.5, [0.5, 0.28, 0.18]);
  }

  // props 单列返回：调用方负责把它并入碰撞并把箱体画出来（liner 侧滚时丢弃）
  return { boxes, props, geo: acc.build() };
}

// 侧倾客轮（SS Yongala）：整船右舷侧躺——船底朝 +z 立起，甲板面朝 -z 埋在沙侧。
// 上层建筑整体塌落在旁边的沙地上（真实永加拉号的上建已被压溃）。
export function buildLinerShip(w, y0, rng) {
  // 先用货轮参数在局部空间生成，再把所有几何绕 X 轴滚 -90°，碰撞箱取旋转后 AABB。
  const L = w.len, W = w.wid, D = w.hei - 1.2;
  const local = buildWreckShip({ ...w, x: 0, z: 0, layout: 'liner', bare: true, keelHole: { x0: -1.5, x1: 2.8 } }, 0, rng);
  const M = new THREE.Matrix4().makeRotationX(-Math.PI / 2);           // (y,z)->(z,-y)
  const geo = local.geo;
  geo.applyMatrix4(M);
  // 旋转后：船体占 y'∈[-W/2,+W/2]、z'∈[-D,0]。抬升到海底、移到船位。
  const yShift = y0 + W / 2 + 0.25;
  geo.translate(w.x, yShift, w.z);
  const boxes = local.boxes.map(b => {
    const bb = new THREE.Box3();
    for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z])
      bb.expandByPoint(new THREE.Vector3(cx, cy, cz).applyMatrix4(M));
    bb.min.x += w.x; bb.max.x += w.x; bb.min.y += yShift; bb.max.y += yShift; bb.min.z += w.z; bb.max.z += w.z;
    return { min: bb.min, max: bb.max };
  });
  const props = [];
  const acc = new Acc();
  const geo2 = (g, c, px, py, pz, rx = 0, ry = 0, rz = 0) => {
    g = g.toNonIndexed(); const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(w.x + px, y0 + py, w.z + pz);
    const base = acc.pos.length / 3, pa = g.attributes.position.array, ca = g.attributes.color.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i++) acc.pos.push(pa[i]);
    for (let i = 0; i < ca.length; i++) acc.col.push(ca[i]);
    for (let i = 0; i < ua.length; i++) acc.uv.push(ua[i]);
    const ic = g.index ? g.index.count : n;
    for (let i = 0; i < ic; i++) acc.idx.push((g.index ? g.index.array[i] : i) + base);
  };
  // —— 塌落的上层建筑（甲板侧 -z 沙地上）：破碎箱体 + 可进入的海图室 ——
  const bx = (x0, x1, ya, yb, z0, z1) => box3(boxes, w.x + x0, w.x + x1, y0 + ya, y0 + yb, w.z + z0, w.z + z1);
  const pr = (x0, x1, ya, yb, z0, z1, c) => box3(props, w.x + x0, w.x + x1, y0 + ya, y0 + yb, w.z + z0, w.z + z1, c);
  const sx0 = 7, sx1 = 15.5, sz0 = -10.6, sz1 = -6.6, sh = 3.6;
  // 外壁（+z 面留门洞 x 9.5..11.5 通舰桥内部）
  geo2(new THREE.BoxGeometry(sx1 - sx0, sh, 0.3), colSuper, (sx0 + sx1) / 2, sh / 2, sz0);
  geo2(new THREE.BoxGeometry(sx1 - sx0, sh, 0.3), colSuper, (sx0 + sx1) / 2, sh / 2, sz1);
  geo2(new THREE.BoxGeometry(0.3, sh, sz1 - sz0), colSuper, sx0, sh / 2, (sz0 + sz1) / 2);
  geo2(new THREE.BoxGeometry(0.3, sh, sz1 - sz0), colSuper, sx1, sh / 2, (sz0 + sz1) / 2);
  geo2(new THREE.BoxGeometry(sx1 - sx0, 0.3, sz1 - sz0), colSuper, (sx0 + sx1) / 2, sh, (sz0 + sz1) / 2);
  bx(sx0, sx1, 0, sh, sz0 - 0.15, sz0 + 0.15); bx(sx0, 9.5, 0, sh, sz1 - 0.15, sz1 + 0.15); bx(11.5, sx1, 0, sh, sz1 - 0.15, sz1 + 0.15);
  bx(9.5, 11.5, 2.2, sh, sz1 - 0.15, sz1 + 0.15);   // 门楣
  bx(sx0 - 0.15, sx0 + 0.15, 0, sh, sz0, sz1); bx(sx1 - 0.15, sx1 + 0.15, 0, sh, sz0, sz1);
  bx(sx0, sx1, sh - 0.15, sh + 0.15, sz0, sz1);
  // 内墙亮色 + 海图桌/保险柜
  for (const q4 of [
    [[sx0 + 0.3, 0.1, sz0 + 0.3], [sx0 + 0.3, 0.1, sz1 - 0.3], [sx0 + 0.3, sh - 0.2, sz1 - 0.3], [sx0 + 0.3, sh - 0.2, sz0 + 0.3]],
    [[sx1 - 0.3, 0.1, sz1 - 0.3], [sx1 - 0.3, 0.1, sz0 + 0.3], [sx1 - 0.3, sh - 0.2, sz0 + 0.3], [sx1 - 0.3, sh - 0.2, sz1 - 0.3]],
    [[sx0 + 0.3, sh - 0.2, sz0 + 0.3], [sx1 - 0.3, sh - 0.2, sz0 + 0.3], [sx1 - 0.3, sh - 0.2, sz1 - 0.3], [sx0 + 0.3, sh - 0.2, sz1 - 0.3]],
  ]) {
    const v = q4.map(q => acc.vert(_v.set(w.x + q[0], y0 + q[1], w.z + q[2]), [0.36, 0.34, 0.3], q[0] * 0.25 + q[2] * 0.25, q[1] * 0.25));
    acc.quad(v[0], v[1], v[2], v[3]);
  }
  pr(9.8, 11.2, 0.1, 0.95, sz0 + 0.7, sz0 + 1.9, [0.4, 0.3, 0.2]);
  pr(13.8, 14.4, 0.1, 1.3, sz0 + 0.6, sz0 + 1.2, [0.24, 0.3, 0.3]);
  // 倒塌压溃的上层残块（前部矮一截）
  geo2(new THREE.BoxGeometry(5.5, 1.6, 3.4), [0.5, 0.48, 0.44], sx0 - 3.5, 0.8, sz0 + 1.6, 0, 0, 0.08);
  box3(boxes, w.x + sx0 - 6.2, w.x + sx0 - 0.7, y0, y0 + 1.7, w.z + sz0 - 0.2, w.z + sz0 + 3.2);
  // 横躺的烟囱 + 两根倒桅 + 通风筒
  geo2(new THREE.CylinderGeometry(0.85, 1.0, 8.5, 12), [0.28, 0.2, 0.16], -4, 0.9, -11.5, 0, 0, Math.PI / 2 - 0.08);
  box3(boxes, w.x - 8.4, w.x + 0.4, y0, y0 + 1.8, w.z - 12.4, w.z - 10.6);
  geo2(new THREE.CylinderGeometry(0.12, 0.2, 11, 8), colGear, -9, 0.35, -9.5, 0, 0, Math.PI / 2.15);
  geo2(new THREE.CylinderGeometry(0.1, 0.17, 9, 8), [0.4, 0.3, 0.24], -17, 0.3, -11, 0, 0, Math.PI / 2.4);
  geo2(new THREE.CylinderGeometry(0.45, 0.55, 1.6, 9), colGear, 4, 0.8, -9.2);
  geo2(new THREE.SphereGeometry(0.62, 10, 7), [0.45, 0.3, 0.2], 4, 1.7, -9.2);
  // 散落舾装：救生艇（翻扣）
  geo2(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0.42, 0.4, 0.36], -20, 0.5, -8.6, Math.PI, 0, 0.2);
  box3(boxes, w.x - 22.4, w.x - 17.6, y0, y0 + 1.1, w.z - 10.2, w.z - 7);
  // 滚舱货物：侧躺后货物堆在新"底"（原右舷板 y'≈0.9）上
  const cc = [[0.42, 0.38, 0.24], [0.5, 0.3, 0.22], [0.3, 0.36, 0.3]];
  pr(-0.8, 0.6, 0.9, 2.0, -5.6, -4.4, cc[0]); pr(0.9, 2.1, 0.9, 1.7, -4.6, -3.4, cc[1]); pr(-1.6, -0.6, 0.9, 1.8, -3.4, -2.4, cc[2]);
  for (const p of props) boxes.push({ min: p.min, max: p.max });
  return { boxes, props, geo: mergeGeos(geo, acc) };
}

function mergeGeos(geo, acc) {
  // 把旋转后的 hull geo 与 acc 里的补充几何合成一个 BufferGeometry
  const a = geo.toNonIndexed ? geo.toNonIndexed() : geo;
  const b = acc.build();
  const g1 = a.index ? a.toNonIndexed() : a, g2 = b.index ? b.toNonIndexed() : b;
  const n1 = g1.attributes.position.count, n2 = g2.attributes.position.count;
  const pos = new Float32Array((n1 + n2) * 3), col = new Float32Array((n1 + n2) * 3), uv = new Float32Array((n1 + n2) * 2);
  pos.set(g1.attributes.position.array); pos.set(g2.attributes.position.array, n1 * 3);
  col.set(g1.attributes.color.array); col.set(g2.attributes.color.array, n1 * 3);
  if (g1.attributes.uv) uv.set(g1.attributes.uv.array);
  if (g2.attributes.uv) uv.set(g2.attributes.uv.array, n1 * 2);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeVertexNormals();
  return out;
}
