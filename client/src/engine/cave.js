// 洞穴生成器：把地图骨架节点放样成带噪声起伏的管状洞穴。
// 同时产出：导航碰撞场(nav)、引导绳、天窗光柱、地质装饰、生物锚点、目标点位。
// 全部确定性生成 —— 同一 (mapId, seed) 在每位玩家机器上长出同一个宇宙。
import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { universeRng, chance, range, intRange, pick } from '@fundive/shared/rng.js';
import { genFade } from './texgen.js';
import { makeCaveMaterial, CAUSTIC } from './materials.js';
import { quality } from './quality.js';
import { makeSurface } from './water.js';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();

// ---------- 几何累加器 ----------
class GeomAcc {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }
  vert(p, c, u, v) { this.pos.push(p.x, p.y, p.z); this.col.push(c[0], c[1], c[2]); this.uv.push(u, v); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
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

// 灯锥/光柱的竖向渐隐 alpha 贴图
let _fadeTex = null;
const fadeTexture = () => _fadeTex || (_fadeTex = genFade([[0, '#ffffff'], [0.7, '#666666'], [1, '#000000']]));

// ---------- 洞壁截面形状：网格放样与碰撞共用同一函数，所见即所碰 ----------
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const SHAPE = { lift: 0 };
// s: spine 采样点 {p,r,sky}；(nx,ny,nz): 垂直于脊线的世界方向单位向量
// 返回半径，抬升量写入 SHAPE.lift
function wallRadius(s, nx, ny, nz) {
  const px = s.p.x, py = s.p.y, pz = s.p.z;
  const big = fbm3(px * 0.3 + nx * 1.6, py * 0.3 + ny * 1.6, pz * 0.3 + nz * 1.6, 3);
  const mid = fbm3(px * 1.1 + nx * 4.0, py * 1.1 + ny * 4.0, pz * 1.1 + nz * 4.0, 3);
  const scallop = 0.035 * Math.abs(fbm3(px * 2.6 + nx * 7.0, py * 2.6 + ny * 7.0, pz * 2.6 + nz * 7.0, 2)); // 溶蚀扇贝纹
  let rad = s.r * (1 + 0.26 * big + 0.07 * mid - scallop);
  if (ny < -0.05) {                       // 平整的沉积地面，与侧壁圆滑过渡
    const floor = (s.r * (0.5 + 0.06 * big)) / -ny;
    rad = smin(rad, floor, s.r * 0.35);
  }
  const up = Math.min(1, Math.max(0, (ny - 0.1) / 0.8));
  const pinch = Math.min(0.85, s.sky * up * up * (3 - 2 * up) * 1.1);   // 天窗收口（平滑，避免折痕）
  SHAPE.lift = pinch * pinch * (s.r * 0.5 + 2.2);
  // 半径下限：噪声捏得再狠也不能小于肩宽——否则通道局部"隐形封口"，游着游着撞上看不见的墙
  return Math.max(0.6, rad * (1 - pinch * 0.78));
}

// ---------- 采样一条路径为 spine ----------
function sampleSpine(pts, radii, pathTag, step) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len / step));
  // 平行传输标架：从上一个切线平行搬运法线，不会绕切线乱转（竖直井段也稳定）
  const tans = [], Ns = [], Bs = [];
  for (let i = 0; i <= n; i++) tans.push(curve.getTangent(i / n).normalize());
  let N = new THREE.Vector3().crossVectors(tans[0], UP);
  if (N.lengthSq() < 0.01) N.set(1, 0, 0);
  N.normalize();
  const _t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    if (i > 0) {
      // 把 N 旋转：old T -> new T
      _t.crossVectors(tans[i - 1], tans[i]);
      const sinA = _t.length(), cosA = THREE.MathUtils.clamp(tans[i - 1].dot(tans[i]), -1, 1);
      if (sinA > 1e-5) N.applyAxisAngle(_t.divideScalar(sinA), Math.atan2(sinA, cosA));
      // 保持正交
      N.addScaledVector(tans[i], -N.dot(tans[i])).normalize();
    }
    Ns.push(N.clone());
    Bs.push(new THREE.Vector3().crossVectors(tans[i], N));
  }
  const samples = [];
  const radiiAt = (t) => {
    const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f));
    return radii[i] + (radii[i + 1] - radii[i]) * (f - i);
  };
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    samples.push({
      p: curve.getPoint(t),
      r: radiiAt(t),
      tan: tans[i],
      N: Ns[i],
      B: Bs[i],
      s: t * len, path: pathTag,
    });
  }
  return { samples, len };
}

// ---------- 碰撞导航场 ----------
export class NavField {
  constructor(segments) {
    this.segs = segments; // {a:{p,r,s,path,tan}, b:{...}}
    this.cell = 8;
    this.grid = new Map();
    segments.forEach((sg, i) => {
      const min = sg.a.p.clone().min(sg.b.p).addScalar(-sg.a.r - sg.b.r);
      const max = sg.a.p.clone().max(sg.b.p).addScalar(sg.a.r + sg.b.r);
      for (let x = Math.floor(min.x / this.cell); x <= Math.floor(max.x / this.cell); x++)
        for (let y = Math.floor(min.y / this.cell); y <= Math.floor(max.y / this.cell); y++)
          for (let z = Math.floor(min.z / this.cell); z <= Math.floor(max.z / this.cell); z++) {
            const k = x + ',' + y + ',' + z;
            (this.grid.get(k) || this.grid.set(k, []).get(k)).push(i);
          }
    });
  }
  _segClosest(sg, pos, out) {
    const ab = _v.subVectors(sg.b.p, sg.a.p);
    const t = Math.max(0, Math.min(1, _v2.subVectors(pos, sg.a.p).dot(ab) / (ab.lengthSq() || 1e-6)));
    out.p.copy(sg.a.p).addScaledVector(ab, t);
    out.r = sg.a.r + (sg.b.r - sg.a.r) * t;
    out.s = sg.a.s + (sg.b.s - sg.a.s) * t;
    out.tan = sg.a.tan; out.path = sg.a.path; out.smp = t < 0.5 ? sg.a : sg.b;
    return out;
  }
  // 最近点查询：返回 {p,r,dist,s,path,tan,clearance}
  closest(pos, out = { p: new THREE.Vector3(), r: 0, dist: 0, s: 0, path: '', tan: null }) {
    const cx = Math.floor(pos.x / this.cell), cy = Math.floor(pos.y / this.cell), cz = Math.floor(pos.z / this.cell);
    let best = -1, bestD = Infinity;
    const tmp = { p: new THREE.Vector3(), r: 0 };
    for (let ring = 0; ring <= 2; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++)
          for (let z = cz - ring; z <= cz + ring; z++) {
            const list = this.grid.get(x + ',' + y + ',' + z);
            if (!list) continue;
            for (const i of list) {
              this._segClosest(this.segs[i], pos, tmp);
              const d = tmp.p.distanceTo(pos);
              if (d < bestD) { bestD = d; best = i; out.p.copy(tmp.p); out.r = tmp.r; out.s = tmp.s; out.path = tmp.path; out.tan = tmp.tan; out.smp = tmp.smp; }
            }
          }
      if (best >= 0) break;
    }
    out.dist = bestD;
    out.clearance = out.r - bestD;
    return out;
  }
  // 把 pos 夹回通道内；返回是否撞墙
  clamp(pos, radius = 0.45) {
    const c = this.closest(pos);
    let lim = Math.max(0.4, c.r * 0.86 - radius);
    if (c.smp && c.dist > 1e-4) {
      _d.subVectors(pos, c.p).divideScalar(c.dist);
      lim = Math.max(0.4, wallRadius(c.smp, _d.x, _d.y, _d.z) * 0.93 - radius + SHAPE.lift * Math.max(0, _d.y));
    }
    if (c.dist > lim) {
      pos.sub(c.p).setLength(lim).add(c.p);
      return true;
    }
    return false;
  }
}

// ---------- 主构建 ----------
export function buildCave(map, uni) {
  const rng = universeRng(map.id, uni.seed + '::cave');
  const acc = new GeomAcc();
  const group = new THREE.Group();
  const photoables = [];
  const siltZones = [], flowZones = [], skylights = [], pockets = [], creatureAnchors = [];
  const QC = quality.cfg, RAD = QC.ring, STEP = QC.step, K = 1.4 / STEP;

  // 气室：洞顶的一个空气穹顶。waterY 以上是空气；bad = 空气不能呼吸（由宇宙种子确定性决定）
  const addDome = (c, R, key) => {
    const bad = chance(universeRng(map.id, `${uni.seed}::dome${key}`), 0.2);
    const waterY = c.y + R * 0.4;
    pockets.push({ pos: new THREE.Vector3(c.x, waterY, c.z), r: R * 0.7, cx: c.x, cz: c.z, R: R * 0.8, waterY, bad });
    const m = new THREE.Mesh(new THREE.CircleGeometry(R * 0.8, 40),
      new THREE.MeshBasicMaterial({ color: bad ? 0xb8c46a : map.water.glow, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(c.x, waterY, c.z);
    group.add(m);
  };

  // —— 收集路径 ——
  const paths = [{ tag: 'main', pts: map.route.map(n => new THREE.Vector3(...n.p)), rs: map.route.map(n => n.r), nodes: map.route }];
  (map.branches || []).forEach((b, i) => {
    const open = uni.branches?.[i]?.open !== false;
    if (!open) return;
    const from = map.route[b.from];
    paths.push({ tag: `b${i}`, pts: [new THREE.Vector3(...from.p), ...b.pts.map(p => new THREE.Vector3(...p))], rs: [from.r * 0.9, ...b.pts.map((_, k) => (k === b.pts.length - 1 && b.endR ? b.endR : b.r))], nodes: null, def: b, bi: i });
  });

  const allSegs = [];
  const spines = {};
  const nodeToSample = new Map();

  for (const path of paths) {
    const { samples } = sampleSpine(path.pts, path.rs, path.tag, STEP);
    spines[path.tag] = samples;
    // 记录 route 节点对应的 spine 下标
    if (path.nodes) {
      path.nodes.forEach((node, i) => {
        let best = 0, bd = Infinity;
        samples.forEach((s, j) => { const d = s.p.distanceToSquared(_v.set(...node.p)); if (d < bd) { bd = d; best = j; } });
        nodeToSample.set(i, best);
      });
    }
    for (let i = 0; i < samples.length - 1; i++) allSegs.push({ a: samples[i], b: samples[i + 1] });
  }

  // 天窗开合度：某采样点受 sky 节点影响的程度（网格放样与碰撞共用）
  const skyNodes = map.route.map((n, i) => ({ ...n, i })).filter(n => n.sky);
  for (const path of paths) for (const s of spines[path.tag]) {
    let sky = 0;
    for (const sn of skyNodes) {
      const d = s.p.distanceTo(_v.set(...sn.p));
      sky = Math.max(sky, 1 - Math.min(1, Math.max(0, (d - sn.r * 0.8) / (sn.r * 1.6))));
    }
    s.sky = sky;
  }

  // —— 放样管状网格 ——
  for (const path of paths) {
    const samples = spines[path.tag];
    const ringBase = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const ring = [];
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * Math.PI * 2;
        _n.copy(s.N).multiplyScalar(Math.cos(a)).addScaledVector(s.B, Math.sin(a));
        const rad = wallRadius(s, _n.x, _n.y, _n.z);
        _v2.copy(s.p).addScaledVector(_n, rad);
        _v2.y += SHAPE.lift;
        // 顶点色（与三平面贴图相乘的色调）：地面暖沙，岩壁地层分带，天窗区藻绿，局部矿物染色
        const floorK = Math.min(1, Math.max(0, (-_n.y - 0.3) / 0.4));
        const sky = s.sky, algae = sky * Math.max(0, _n.y) * 0.5;
        const band = 0.9 + 0.1 * Math.sin(_v2.y * 1.3 + fbm3(s.p.x * 0.2, 0, s.p.z * 0.2, 2) * 3);
        const patch = 0.82 + 0.3 * (fbm3(_v2.x * 0.35, _v2.y * 0.35, _v2.z * 0.35, 3) * 0.5 + 0.5);
        const rust = Math.max(0, fbm3(_v2.x * 0.18 + 9, _v2.y * 0.5, _v2.z * 0.18, 2)) * 0.5;
        const k = band * patch * (1 - 0.18 * floorK);
        const cr = (1 + rust * 0.5 + floorK * 0.1) * (1 - algae * 0.45), cg = (1 + rust * 0.15 + algae * 0.2), cb = (1 - rust * 0.5 - floorK * 0.12) * (1 - algae * 0.3);
        ring.push(acc.vert(_v2, [cr * k, cg * k, cb * k], (j / RAD) * 3, s.s / 7));
      }
      ringBase.push(ring);
    }
    for (let i = 0; i < ringBase.length - 1; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = ringBase[i][j], b = ringBase[i][j + 1], c = ringBase[i + 1][j + 1], d = ringBase[i + 1][j];
        acc.tri(a, d, b); acc.tri(b, d, c); // 内壁朝向
      }
    }
    // —— 末端封岩盖：开放环从内看是个透视黑洞，游进去又被碰撞拦回=诡异的"无头路"。
    // 用收缩中圈+端点拼一个鼓包岩盖封死，并把碰撞段延伸到盖尖，看见的就是能摸到的。——
    {
      const sEnd = samples[samples.length - 1], outer = ringBase[ringBase.length - 1];
      const A = new THREE.Vector3(), Bv = new THREE.Vector3();
      let avgR = 0;
      for (const k of outer) avgR += A.set(acc.pos[k * 3], acc.pos[k * 3 + 1], acc.pos[k * 3 + 2]).distanceTo(sEnd.p);
      avgR /= outer.length;
      const ph = rng() * 30, jit = (v, s2) => v + fbm3(v * 0.7 + ph, ph, s2, 2) * avgR * 0.14;
      const mid = [];
      for (const k of outer) {
        A.set(acc.pos[k * 3], acc.pos[k * 3 + 1], acc.pos[k * 3 + 2]);
        Bv.copy(A).sub(sEnd.p).multiplyScalar(0.6).add(sEnd.p).addScaledVector(sEnd.tan, avgR * 0.5);
        Bv.set(jit(Bv.x, 1), jit(Bv.y, 2), jit(Bv.z, 3));
        const ci = k * 3;
        mid.push(acc.vert(Bv, [acc.col[ci] * 0.82, acc.col[ci + 1] * 0.82, acc.col[ci + 2] * 0.82], 0, sEnd.s / 7 + 0.3));
      }
      const C = sEnd.p.clone().addScaledVector(sEnd.tan, avgR * 1.1);
      C.set(jit(C.x, 4), jit(C.y, 5), jit(C.z, 6));
      const cIdx = acc.vert(C, [0.45, 0.43, 0.4], 0, sEnd.s / 7 + 0.5);
      for (let j = 0; j < outer.length - 1; j++) {
        const a = outer[j], b = outer[j + 1], d = mid[j], c = mid[j + 1];
        acc.tri(a, d, b); acc.tri(b, d, c);
        acc.tri(mid[j], cIdx, mid[j + 1]);
      }
      // 碰撞跟着盖走：盖尖附近半径收成 0.28*avgR，玩家能贴着岩盖摸到"洞底"
      allSegs.push({ a: sEnd, b: { p: C, r: avgR * 0.28, s: sEnd.s + avgR, tan: sEnd.tan, N: sEnd.N, B: sEnd.B, sky: sEnd.sky || 0, path: path.tag } });
    }
  }

  const caveMesh = new THREE.Mesh(acc.build(), makeCaveMaterial({ sand: 1, normalK: 1.0 }));
  caveMesh.name = 'cave';
  caveMesh.receiveShadow = true;
  group.add(caveMesh);

  // —— 天窗：水面斯涅尔窗 + 丁达尔光柱 + 日光射灯（焦散在洞壁材质内计算） ——
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(map.water.glow).lerp(new THREE.Color(1, 1, 1), 0.35) }, uK: { value: 0.1 }, uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying float vA;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz);
        vY = uv.y; vA = atan(position.z, position.x); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uK, uT; varying vec3 vN; varying vec3 vV; varying float vY; varying float vA;
      void main(){
        float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.3);
        float streak = 0.55 + 0.45 * sin(vA * 7.0 + uT * 0.35) * sin(vA * 13.0 - uT * 0.5 + vY * 3.0);
        float f = mix(0.25, 1.0, vY) * edge * streak;
        gl_FragColor = vec4(uCol * f * uK, 1.0);
      }`,
  });
  const surfaces = [];
  for (const sn of skyNodes) {
    const surfY = -0.35, floorY = sn.p[1] - sn.r * 0.45, h = surfY - floorY;
    const top = new THREE.Vector3(sn.p[0], surfY + 3, sn.p[2]);
    const surf = makeSurface(sn.r * 0.8, map.water.glow);
    surf.position.set(sn.p[0], surfY, sn.p[2]);
    group.add(surf); surfaces.push(surf);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(sn.r * 0.55, sn.r * 0.95, h, 24, 1, true), shaftMat);
    cone.position.set(sn.p[0], surfY - h / 2, sn.p[2]);
    group.add(cone);
    const sl = new THREE.SpotLight(0xcfeeff, 38, 46, Math.PI / 4.5, 0.7, 1.3);
    sl.position.copy(top); sl.target.position.set(sn.p[0], floorY, sn.p[2]);
    group.add(sl, sl.target);
    skylights.push({ pos: new THREE.Vector3(...sn.p), r: sn.r, top, caust: null });
  }

  // —— 地质装饰：钟乳石/石笋/石柱/卷曲石/崩塌巨石/残骸，全部贴合 wallRadius 放置 ——
  const deco = new GeomAcc();   // 钙质与岩石：共用岩石三平面材质
  const junk = new GeomAcc();   // 人造残骸：普通金属/织物材质
  const nodeSamples = (i) => spines.main[nodeToSample.get(i)];
  const _p = new THREE.Vector3(), _d2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s1 = new THREE.Vector3(1, 1, 1);

  // 方向投影到垂直脊线的平面，然后取洞壁点（inset 为嵌入墙内的深度，避免接缝露底）
  const wallPt = (s, dir, out, inset = 0.12) => {
    _d2.copy(dir).addScaledVector(s.tan, -dir.dot(s.tan));
    if (_d2.lengthSq() < 0.09) _d2.copy(s.N);
    _d2.normalize();
    const rad = wallRadius(s, _d2.x, _d2.y, _d2.z);
    out.copy(s.p).addScaledVector(_d2, rad - inset);
    out.y += SHAPE.lift;
    return out;
  };
  const sampleNear = (i, meters) => {
    const w = Math.round(meters / STEP);
    return spines.main[Math.max(0, Math.min(spines.main.length - 1, i + intRange(rng, -w, w)))];
  };
  const addGeo = (acc, g, pos, quat, scale, colorFn) => {
    _m.compose(pos, quat, scale);
    g.applyMatrix4(_m);
    const base = acc.pos.length / 3, n = g.attributes.position.count;
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i++) acc.pos.push(pa[i]);
    for (let i = 0; i < n; i++) { acc.col.push(...colorFn(i / n)); acc.uv.push(0, 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) acc.idx.push(g.index.array[i] + base);
    g.dispose();
  };

  // 钙质柱体：沿 +Y 生长，kind = 'drip' 锥形 | 'column' 腰鼓形 | 'curl' 卷曲石
  const speleoGeo = (len, r0, kind) => {
    const segs = kind === 'curl' ? 6 : 9, sides = kind === 'curl' ? 5 : 10;
    const pos = [], idx = [], ph = rng() * 20, bend = kind === 'curl' ? range(rng, -0.5, 0.5) * len : range(rng, -0.04, 0.04) * len;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      let rr = kind === 'column' ? r0 * (0.72 + 0.7 * (2 * t - 1) ** 2) : r0 * Math.pow(1 - t, kind === 'curl' ? 0.6 : 0.85) + 0.012;
      rr *= 1 + 0.16 * fbm3(t * 5 + ph, ph, 0.3, 2) + (kind === 'drip' ? 0.06 * Math.sin(t * 38 + ph) : 0);
      const bx = bend * t * t, bz = bend * 0.6 * Math.sin(t * 3 + ph);
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        pos.push(Math.cos(a) * rr * (1 + 0.1 * Math.sin(a * 3 + ph)) + bx, t * len, Math.sin(a) * rr + bz);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = (i + 1) * sides + (j + 1) % sides, d = (i + 1) * sides + j;
      idx.push(a, d, b, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  };
  const calcite = (t) => { const k = 1.15 + 0.5 * t; return [k, k * 0.98, k * 0.9]; };
  // 挂在 s 的 dir 方向壁面上，朝向 axis（钟乳石朝下 / 石笋朝上）
  const addSpeleo = (s, dir, axis, len, r0, kind = 'drip') => {
    wallPt(s, dir, _p);
    _d2.set(range(rng, -0.12, 0.12), axis, range(rng, -0.12, 0.12)).normalize();
    _q.setFromUnitVectors(UP, _d2);
    addGeo(deco, speleoGeo(len, r0, kind), _p, _q, _s1, calcite);
    return _p;
  };
  // 崩塌巨石：噪声位移的球体，落在地面两侧
  const addBoulder = (s, size) => {
    const g = new THREE.SphereGeometry(1, 9, 7), pa = g.attributes.position, ph = rng() * 30;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = 1 + 0.38 * fbm3(x * 1.3 + ph, y * 1.3, z * 1.3 + ph, 3);
      pa.setXYZ(i, x * k * 1.15, y * k * 0.7, z * k);
    }
    _d2.set(range(rng, 0.5, 1.6) * (chance(rng, 0.5) ? 1 : -1), -1, range(rng, 0.5, 1.6) * (chance(rng, 0.5) ? 1 : -1));
    wallPt(s, _d2, _p, size * 0.3);
    _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 6, rng() * 3));
    const tone = range(rng, 0.8, 1.15);
    addGeo(deco, g, _p, _q, new THREE.Vector3(size, size, size), () => [tone, tone * 0.97, tone * 0.92]);
  };
  // 残骸带：翻倒的气瓶、旧装备 —— 打捞类地图的气氛组
  const addDebris = (s) => {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.CylinderGeometry(range(rng, 0.07, 0.1), range(rng, 0.07, 0.1), range(rng, 0.4, 0.7), 10);
      g.rotateZ(Math.PI / 2);
      wallPt(s, _d2.set(range(rng, -1, 1), -1, range(rng, -1, 1)), _p, -0.06);
      _q.setFromEuler(new THREE.Euler(range(rng, -0.2, 0.2), rng() * 6, range(rng, -0.2, 0.2)));
      addGeo(junk, g, _p, _q, _s1, () => [0.32, 0.34, 0.33]);
    }
    const sg = new THREE.BoxGeometry(0.5, 0.35, 0.03);
    wallPt(s, _d2.set(range(rng, -1, 1), -1, range(rng, -1, 1)), _p, -0.18);
    _q.setFromEuler(new THREE.Euler(range(rng, -0.5, 0.2), rng() * 6, range(rng, -0.5, 0.5)));
    addGeo(junk, sg, _p, _q, _s1, () => [0.75, 0.68, 0.38]);
  };

  // 沿全程撒落：崩塌巨石、小钟乳石，打破"一根光滑管子"的单调
  for (const tag of Object.keys(spines)) {
    const sp = spines[tag];
    for (let i = Math.round(6 / STEP); i < sp.length; i += Math.max(1, Math.round(range(rng, 5, 13) / STEP))) {
      const s = sp[i];
      if (s.sky > 0.5) continue;
      if (chance(rng, 0.55)) addBoulder(s, Math.min(1.1, s.r * range(rng, 0.07, 0.2)));
      if (s.r > 2 && chance(rng, 0.6)) {
        const n = intRange(rng, 1, 3);
        for (let k = 0; k < n; k++) addSpeleo(s, _n.set(range(rng, -0.7, 0.7), 1, range(rng, -0.7, 0.7)), -1, range(rng, 0.2, Math.min(1.8, s.r * 0.35)), range(rng, 0.04, 0.12));
      }
    }
  }

  map.route.forEach((node, i) => {
    const s = nodeSamples(i); if (!s) return;
    const feats = node.feats || [];
    const P = new THREE.Vector3(...node.p);
    const topAt = (smp) => wallPt(smp, UP, new THREE.Vector3());
    const botAt = (smp) => wallPt(smp, _n.set(0, -1, 0), new THREE.Vector3());
    if (feats.includes('stalactite') || node.room === 'hall') {
      const cnt = node.room === 'hall' ? intRange(rng, 14, 24) : intRange(rng, 5, 10);
      for (let k = 0; k < cnt; k++) {
        const sm = sampleNear(nodeToSample.get(i), node.r * 0.8);
        const len = range(rng, 0.5, Math.max(0.8, Math.min(sm.r * 0.55, 3.2)));
        addSpeleo(sm, _n.set(range(rng, -0.8, 0.8), 1, range(rng, -0.8, 0.8)), -1, len, range(rng, 0.08, 0.3) * Math.min(1.5, 0.6 + len * 0.4));
        if (chance(rng, 0.5)) addSpeleo(sm, _n.set(range(rng, -0.8, 0.8), -1, range(rng, -0.8, 0.8)), 1, len * 0.6, range(rng, 0.1, 0.3));
      }
      photoables.push({ sp: 'stalactite', pos: topAt(s).addScaledVector(UP, -node.r * 0.25), r: node.r });
    }
    if (feats.includes('column')) {
      const top = topAt(s), bot = botAt(s), len = top.distanceTo(bot);
      _q.setFromUnitVectors(UP, _d2.subVectors(top, bot).normalize());
      addGeo(deco, speleoGeo(len, 0.55, 'column'), bot, _q, _s1, calcite);
      photoables.push({ sp: 'column', pos: P.clone(), r: node.r });
    }
    if (feats.includes('helictite')) {
      for (let k = 0; k < 14; k++) addSpeleo(sampleNear(nodeToSample.get(i), 2.5), _n.set(range(rng, -1, 1), 1, range(rng, -1, 1)), -1, range(rng, 0.15, 0.55), range(rng, 0.025, 0.05), 'curl');
      photoables.push({ sp: 'helictite', pos: topAt(s).addScaledVector(UP, -0.4), r: 2 });
    }
    if (feats.includes('fossil')) {
      photoables.push({ sp: 'fossil', pos: wallPt(s, _n.set(1, -0.2, 0), new THREE.Vector3(), 0.3), r: 1.5 });
    }
    if (feats.includes('debris')) addDebris(s);
    if (feats.includes('pearl')) {
      photoables.push({ sp: 'pearl', pos: botAt(s).addScaledVector(UP, 0.1), r: 2 });
    }
    if (feats.includes('algae')) creatureAnchors.push({ sp: 'algae', pos: new THREE.Vector3(P.x + node.r * 0.5, P.y + node.r * 0.4, P.z), r: 1.5 });
    if (feats.includes('fern')) creatureAnchors.push({ sp: 'fern', pos: new THREE.Vector3(P.x, P.y + node.r * 0.6, P.z), r: 2 });
    if (feats.includes('silt')) siltZones.push({ pos: P.clone().add(new THREE.Vector3(0, -node.r * 0.5, 0)), r: node.r * 1.1 });
    if (feats.includes('pocket')) addDome(P, node.r, `n${i}`);
    if (feats.includes('current')) {
      const s2 = nodeSamples(i);
      flowZones.push({ pos: P.clone(), dir: s2 ? s2.tan.clone() : new THREE.Vector3(0, 0, -1), r: node.r * 1.5 });
    }
  });

  const decoMesh = new THREE.Mesh(deco.build(), makeCaveMaterial({ sand: 0, normalK: 0.8, roughness: 0.85 }));
  decoMesh.castShadow = decoMesh.receiveShadow = true;
  group.add(decoMesh);
  if (junk.pos.length) {
    const jm = new THREE.Mesh(junk.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.55, envMapIntensity: 0.3 }));
    jm.castShadow = jm.receiveShadow = true;
    group.add(jm);
  }

  // —— 引导绳：从 line_start 到路线尽头，沿右下壁 ——
  const mainS = spines.main;
  let lineStartIdx = 0;
  map.route.forEach((n, i) => { if ((n.feats || []).includes('line_start')) lineStartIdx = nodeToSample.get(i); });
  const linePts = [];
  const knots = [];
  let gapRange = null;
  if (uni.mods.lineBreak) {
    const a = Math.round(range(rng, 0.45, 0.6) * (mainS.length - 1));
    gapRange = [a, a + Math.round(range(rng, 8, 20) / STEP)];
  }
  const LS = Math.max(1, Math.round(2 * K));
  for (let i = lineStartIdx; i < mainS.length; i += LS) {
    const s = mainS[i];
    if (gapRange && i >= gapRange[0] && i <= gapRange[1]) continue;
    const right = _n.crossVectors(s.tan, UP).normalize();
    _d2.copy(right).multiplyScalar(0.9).addScaledVector(UP, -0.45).normalize();
    const p = s.p.clone().addScaledVector(_d2, wallRadius(s, _d2.x, _d2.y, _d2.z) * 0.74);
    linePts.push(p);
    if ((i - lineStartIdx) % Math.round(16 * K) < LS) knots.push(p.clone());
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.85, metalness: 0 });
  if (linePts.length > 1) {
    const lineGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(linePts), Math.min(400, linePts.length * 2), 0.015, 4);
    group.add(new THREE.Mesh(lineGeo, lineMat));
  }
  const knotGeo = new THREE.SphereGeometry(0.06, 6, 5);
  const knotMesh = new THREE.InstancedMesh(knotGeo, new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff9a2a, emissiveIntensity: 0.25, roughness: 0.6 }), knots.length);
  knots.forEach((p, i) => knotMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p)));
  group.add(knotMesh);

  // —— 泥沙区地面着色已由顶点色处理；泥沙粒子由 silt 系统负责 ——

  skylights.slice(0, 4).forEach((sk, i) => CAUSTIC.uSky.value[i].set(sk.pos.x, -0.35, sk.pos.z, sk.r));
  CAUSTIC.uSkyN.value = Math.min(4, skylights.length);

  // —— 支洞：信息（入口/尽头/类型）+ 支洞气室 ——
  const branchInfo = [];
  (map.branches || []).forEach((b, i) => {
    const sp = spines[`b${i}`];
    if (!sp) return;
    const e = sp.find(s => s.s - sp[0].s >= 8) || sp[sp.length - 1], end = sp[sp.length - 1];
    const kind = b.bottomless ? 'bottomless' : b.pocket ? 'pocket' : b.deadEnd ? 'dead' : 'side';
    branchInfo.push({ i, kind, name: b.name, entry: e.p.clone(), end: end.p.clone() });
    if (b.pocket) addDome(end.p, b.endR || b.r * 1.6, `b${i}`);
  });

  const nav = new NavField(allSegs);
  const entry = { pos: new THREE.Vector3(...map.route[0].p), r: map.route[0].r };
  const last = map.route[map.route.length - 1];
  const objNode = map.route[uni.objective.at] || last;

  // 任意点附近的洞壁取点：dir 为偏好方向（会投影到垂直脊线平面），返回壁面点与朝洞内法线
  const wallPoint = (pos, dir, inset = 0.1) => {
    const c = nav.closest(pos);
    if (!c.smp) return null;
    _d2.copy(dir).addScaledVector(c.tan, -dir.dot(c.tan));
    if (_d2.lengthSq() < 0.09) _d2.copy(c.smp.N);
    _d2.normalize();
    const p = c.p.clone().addScaledVector(_d2, wallRadius(c.smp, _d2.x, _d2.y, _d2.z) - inset);
    p.y += SHAPE.lift;
    return { pos: p, inward: _d2.clone().negate(), sample: c.smp };
  };

  return {
    group, nav, wallPoint, mainSpine: mainS,
    entryPos: entry.pos, entryR: entry.r,
    nodes: map.route.map((n, i) => ({ i, pos: new THREE.Vector3(...n.p), r: n.r, name: n.name, feats: n.feats || [], room: n.room, sky: n.sky, sample: nodeToSample.get(i) })),
    skylights, surfaces, shaftMat, pockets, branchInfo, siltZones, flowZones, photoables,
    creatureAnchors,
    linePts, lineGap: gapRange ? mainS[gapRange[0]]?.p.clone() : null,
    objectiveSpot: { pos: new THREE.Vector3(...objNode.p), r: objNode.r, name: objNode.name },
    exitS: mainS[mainS.length - 1].s,
  };
}
