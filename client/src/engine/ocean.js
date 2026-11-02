// 海潜世界：开阔海底（高度场）+ 沉船（可穿行的箱体碰撞）+ 礁石/珊瑚装饰 + 潜水船与锚绳。
// 对外接口与 buildCave 同形（group/nav/nodes/mainSpine/…），session 与生物系统无需区分。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3 } from './noise.js';
import { universeRng, range, chance, intRange } from '@fundive/shared/rng.js';
import { makeCaveMaterial, CAUSTIC } from './materials.js';
import { makeSurface } from './water.js';
import { quality } from './quality.js';

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SURFACE_Y = -0.35;

// 地形高度函数（海底 y，负值）。纯函数，测试与放置共用
export function makeTerrain(map) {
  const g = map.ocean, w = g.wreck;
  const base = (x, z) => {
    let y = -(g.shallow + (g.deep - g.shallow) * smooth(0, 1, -z / g.len));
    y += fbm3(x * 0.04 + 3, 0, z * 0.04, 3) * g.rough * 2.2 + fbm3(x * 0.18, 0, z * 0.18, 2) * 0.35 * g.rough;
    if (g.wall) { const u = g.wall.axis === 'x' ? x : z; y -= g.wall.drop * smooth(g.wall.at + g.wall.width, g.wall.at - g.wall.width, u); }
    return y;
  };
  const plateau = w ? base(w.x, w.z) - 0.3 : null;
  const h = (x, z) => {
    const y = base(x, z);
    if (!w) return y;
    const dd = Math.max(Math.abs(x - w.x) - w.len / 2, Math.abs(z - w.z) - w.wid / 2, 0);
    return y + (plateau - y) * (1 - smooth(2, 9, dd));
  };
  return { h, plateau };
}

// 沉船箱体（世界坐标 AABB）。侧壁留门洞、甲板留舱口、舱壁留通道——可以钻进去，也可能被卡住/搅沙
function wreckBoxes(w, y0, rng) {
  const B = [], L = w.len, W = w.wid, H = w.hei;
  const box = (x0, x1, a, b, z0, z1) => B.push({ min: new THREE.Vector3(w.x + x0, y0 + a, w.z + z0), max: new THREE.Vector3(w.x + x1, y0 + b, w.z + z1) });
  box(-L / 2, L / 2, 0, 0.6, -W / 2, W / 2);
  for (const [x0, x1] of [[-18, -10], [-8, -1.5], [3, 12], [14, 18]]) {
    const top = H - 1.2 - rng() * 1.4;
    box(x0, x1, 0, top, -W / 2, -W / 2 + 0.45);
    box(x0, x1, 0, top, W / 2 - 0.45, W / 2);
  }
  box(-L / 2, -L / 2 + 0.5, 0, H - 0.6, -W / 2, W / 2);
  box(L / 2 - 0.5, L / 2, 0, H - 0.6, -W / 2, W / 2);
  for (const [x0, x1] of [[-18, -12], [-9, -3], [2, 8], [11, 18]]) box(x0, x1, H - 1.2, H - 0.7, -W / 2, W / 2);
  for (const [z0, z1] of [[-W / 2, -1.5], [1.5, W / 2]]) box(-1, -0.6, 0, H - 1.2, z0, z1);
  box(12, 17, H - 0.7, H + 3.3, -3, 3);
  return B;
}

const colored = (geo, c, jitter = 0.1) => {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3), k = 1 - jitter + Math.random() * jitter * 2;
  for (let i = 0; i < n; i++) { col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
};

export function buildOcean(map, uni) {
  const g = map.ocean, rng = universeRng(map.id, `${uni.seed}::ocean`);
  const QC = quality.level;
  const group = new THREE.Group();
  const { h, plateau } = makeTerrain(map);
  const wr = g.wreck;
  const boxes = wr ? wreckBoxes(wr, plateau, rng) : [];

  // —— 海底网格 ——
  const SEG = 130, size = g.half * 2;
  const tg = new THREE.PlaneGeometry(size, size, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pa = tg.attributes.position, col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i), y = h(x, z);
    pa.setY(i, y);
    const patch = smooth(0.1, 0.55, fbm3(x * 0.07 + 11, 0, z * 0.07, 3));
    const dark = 0.82 + 0.25 * fbm3(x * 0.3, y * 0.2, z * 0.3, 2);
    const depthK = Math.max(0.55, 1 - Math.max(0, -y - 12) * 0.012);
    col[i * 3] = (0.95 - patch * 0.3) * dark * depthK; col[i * 3 + 1] = (0.88 - patch * 0.22) * dark * depthK; col[i * 3 + 2] = (0.72 - patch * 0.1) * dark * depthK;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, makeCaveMaterial({ sand: 1, normalK: 0.7, envMapIntensity: 0.2 }));
  terrain.name = 'cave';
  group.add(terrain);

  // —— 沉船 ——
  if (wr) {
    const geos = boxes.map(b => {
      const s = b.max.clone().sub(b.min), c = b.min.clone().addScaledVector(s, 0.5);
      const bg = new THREE.BoxGeometry(s.x, s.y, s.z, Math.max(1, s.x / 3 | 0), Math.max(1, s.y / 3 | 0), Math.max(1, s.z / 3 | 0));
      bg.translate(c.x, c.y, c.z);
      return colored(bg.toNonIndexed(), [0.62, 0.38, 0.27], 0.18);
    });
    for (const [mx, mh] of [[-6, 13], [4, 11]]) {
      const m = new THREE.CylinderGeometry(0.18, 0.28, mh, 8); m.translate(wr.x + mx, plateau + wr.hei - 0.7 + mh / 2, wr.z);
      geos.push(colored(m.toNonIndexed(), [0.5, 0.34, 0.26]));
    }
    const fn = new THREE.CylinderGeometry(0.9, 1.1, 4, 10); fn.translate(wr.x + 14.5, plateau + wr.hei + 5.3, wr.z);
    geos.push(colored(fn.toNonIndexed(), [0.45, 0.3, 0.24]));
    const hull = new THREE.Mesh(mergeGeometries(geos.map(x => { x.deleteAttribute('uv'); return x; })), makeCaveMaterial({ sand: 0, normalK: 0.9, roughness: 0.9 }));
    hull.geometry.computeVertexNormals();
    group.add(hull);
  }

  // —— 节点（snap 到海底/沉船） ——
  const nodes = map.route.map((n, i) => {
    let pos;
    if (n.surface) pos = new THREE.Vector3(n.p[0], SURFACE_Y, n.p[2]);
    else if (n.ref === 'wreck') pos = new THREE.Vector3(wr.x + n.p[0], plateau + n.p[1], wr.z + n.p[2]);
    else if (n.abs) pos = new THREE.Vector3(n.p[0], n.p[1], n.p[2]);
    else pos = new THREE.Vector3(n.p[0], h(n.p[0], n.p[2]) + n.p[1] + n.r * 0.5, n.p[2]);
    return { i, pos, r: n.r, name: n.name, feats: n.feats || [], room: n.room, sky: n.sky, sample: i };
  });

  // —— 表面查询：海底与沉船顶面 ——
  const surfaceBelow = (x, y, z) => {
    let f = h(x, z);
    for (const b of boxes) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= y + 0.3) f = Math.max(f, b.max.y);
    return f;
  };
  const clampBoxes = (pos, r) => {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) for (const b of boxes) {
      const x0 = b.min.x - r, x1 = b.max.x + r, y0 = b.min.y - r, y1 = b.max.y + r, z0 = b.min.z - r, z1 = b.max.z + r;
      if (pos.x <= x0 || pos.x >= x1 || pos.y <= y0 || pos.y >= y1 || pos.z <= z0 || pos.z >= z1) continue;
      const d = [pos.x - x0, x1 - pos.x, pos.y - y0, y1 - pos.y, pos.z - z0, z1 - pos.z];
      const k = d.indexOf(Math.min(...d));
      if (k === 0) pos.x = x0; else if (k === 1) pos.x = x1; else if (k === 2) pos.y = y0; else if (k === 3) pos.y = y1; else if (k === 4) pos.z = z0; else pos.z = z1;
      hit = true;
    }
    return hit;
  };
  const lim = g.half - 3;
  const nav = {
    clamp(pos, radius = 0.45) {
      let hit = false;
      if (Math.abs(pos.x) > lim) { pos.x = Math.sign(pos.x) * lim; hit = true; }
      if (Math.abs(pos.z) > lim) { pos.z = Math.sign(pos.z) * lim; hit = true; }
      if (clampBoxes(pos, radius)) hit = true;
      const f = h(pos.x, pos.z) + radius;
      if (pos.y < f) { pos.y = f; hit = true; }
      return hit;
    },
    // 与洞穴同形：clearance = 离最近地面的高度；r 固定 3，这样 clearance < r/2 即"贴近底部"
    closest(pos, out = { p: new THREE.Vector3(), r: 3, dist: 0, s: 0, path: 'main', tan: UP }) {
      const d = pos.y - surfaceBelow(pos.x, pos.y, pos.z);
      out.p.copy(pos).add(UP); out.r = 3; out.dist = 3 - d; out.clearance = d; out.s = 0; out.path = 'main'; out.tan = UP; out.smp = null;
      return out;
    },
  };
  // 开阔水中的点贴到最近的"面"：近底取地面/船顶；悬在断崖外则沿崖外侧找到崖壁
  const wallSnap = (p) => {
    const ax = g.wall?.axis === 'z' ? 'z' : 'x', q = p.clone();
    for (let i = 0; i < 90; i++) { if (h(q.x, q.z) >= p.y - 0.3) return q; q[ax] += 0.5; }
    return p.clone();
  };
  const wallPoint = (pos) => {
    const f = surfaceBelow(pos.x, pos.y + 1, pos.z);
    if (g.wall && pos.y - f > 6) return { pos: wallSnap(pos), inward: UP.clone(), sample: null };
    return { pos: new THREE.Vector3(pos.x, f, pos.z), inward: UP.clone(), sample: null };
  };

  // —— 主脊线（节点折线重采样）——
  const mainSpine = [];
  let acc = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i].pos, b = nodes[i + 1].pos, len = a.distanceTo(b), n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < n; k++) mainSpine.push({ p: a.clone().lerp(b, k / n), r: nodes[i].r, s: acc + len * k / n });
    acc += len;
  }
  mainSpine.push({ p: nodes[nodes.length - 1].pos.clone(), r: nodes[nodes.length - 1].r, s: acc });

  // —— 锚绳（船 -> 锚点）+ 可选沉船引导绳 ——
  const boat = nodes[0].pos, anchor = nodes[1].pos;
  const aF = h(anchor.x, anchor.z) + 0.25;
  const linePts = [];
  for (let y = SURFACE_Y - 0.4; y > aF; y -= 1.5) linePts.push(new THREE.Vector3(anchor.x, y, anchor.z));
  linePts.push(new THREE.Vector3(anchor.x, aF, anchor.z));
  if (wr && g.guide) {
    const rel = [[-26, 1.5, 12], [-26, 1.5, 0], [-21, 1.5, 0], [-21, 10, 0], [-10.5, 10, 0], [-10.5, 3.8, 0], [8, 3.4, 0], [14, 3.4, 0]];
    const wp = rel.map(r => new THREE.Vector3(wr.x + r[0], plateau + r[1], wr.z + r[2]));
    let prev = new THREE.Vector3(anchor.x, aF, anchor.z);
    for (const q of wp) {
      const n = Math.max(1, Math.round(prev.distanceTo(q) / 2.5));
      for (let k = 1; k <= n; k++) { const p = prev.clone().lerp(q, k / n); if (q.y < plateau + 2) p.y = Math.max(p.y, h(p.x, p.z) + 0.4); linePts.push(p); }
      prev = q;
    }
  }
  let lineGap = null;
  if (uni.mods.lineBreak && linePts.length > 12) {
    const a = Math.round(linePts.length * range(rng, 0.5, 0.7));
    lineGap = linePts[a].clone();
    linePts.splice(a, 4);
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.85 });
  if (linePts.length > 1) group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(linePts), Math.min(500, linePts.length * 2), 0.02, 4), lineMat));

  // —— 潜水船 + 水面 ——
  const bg = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x9aa8b0, roughness: 0.7 });
  const hullM = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 11), hullMat); hullM.position.y = -0.9;
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.7, 3, 4), hullMat); bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, -0.9, -6.9); bow.scale.set(1, 1, 0.45);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.25, 11.05), new THREE.MeshStandardMaterial({ color: 0x1f5d8a, roughness: 0.7 })); stripe.position.y = -0.35;
  bg.add(hullM, bow, stripe);
  bg.position.set(boat.x - 4.8, 0, boat.z);
  group.add(bg);
  const surface = makeSurface(Math.min(g.half * 0.8, 90), map.water.glow);
  surface.position.set(boat.x, SURFACE_Y, boat.z);
  group.add(surface);

  // —— 阳光（随深度衰减）——
  const sun = new THREE.DirectionalLight(0xdff4ff, 1.4);
  sun.position.set(30, 80, 20);
  group.add(sun);

  // —— 装饰：礁石 + 珊瑚头（实例化）——
  const near = (x, z) => nodes.some(n => Math.hypot(n.pos.x - x, n.pos.z - z) < 14);
  const spot = () => { for (let t = 0; t < 30; t++) { const x = range(rng, -g.half * 0.85, g.half * 0.85), z = range(rng, -g.half * 0.85, g.half * 0.85), y = h(x, z); const inWreck = wr && Math.abs(x - wr.x) < wr.len / 2 + 3 && Math.abs(z - wr.z) < wr.wid / 2 + 3; if (!inWreck && y > -30 && (near(x, z) || chance(rng, 0.35))) return [x, y, z]; } return null; };
  const nRock = { low: 90, mid: 150, high: 220 }[QC], nCoral = g.shallow < 12 ? { low: 220, mid: 380, high: 600 }[QC] : { low: 70, mid: 120, high: 200 }[QC];
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), makeCaveMaterial({ sand: 0.3, normalK: 1.2 }), nRock);
  const rg = rocks.geometry, rcol = new Float32Array(rg.attributes.position.count * 3).fill(0.55);
  rg.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  let nr = 0;
  for (let i = 0; i < nRock; i++) {
    const s = spot(); if (!s) continue;
    const k = range(rng, 0.5, 2.2);
    E.set(rng() * 3, rng() * 3, rng() * 3); Q.setFromEuler(E);
    M4.compose(new THREE.Vector3(s[0], s[1] + k * 0.25, s[2]), Q, S.set(k * range(rng, 0.8, 1.6), k * 0.7, k));
    rocks.setMatrixAt(nr++, M4);
  }
  rocks.count = nr; rocks.castShadow = false;
  group.add(rocks);

  const parts = [];
  for (let k = 0; k < 7; k++) {
    const c = new THREE.ConeGeometry(0.1, range(rng, 0.5, 1.0), 5); c.translate(0, 0.3, 0);
    c.rotateZ(range(rng, -0.7, 0.7)); c.rotateY(k * 0.9); c.translate(Math.cos(k) * 0.12, 0, Math.sin(k) * 0.12);
    parts.push(c);
  }
  const coralGeo = mergeGeometries(parts.map(x => { x.deleteAttribute('uv'); return x.toNonIndexed(); }));
  const coral = new THREE.InstancedMesh(coralGeo, new THREE.MeshStandardMaterial({ roughness: 0.75, emissive: 0x222222, emissiveIntensity: 0.25 }), nCoral);
  const pal = [0xff6fa5, 0xff9a3c, 0xa56bff, 0xffd84a, 0x3fd0b8, 0xff5a5a].map(c => new THREE.Color(c));
  let nc = 0;
  for (let i = 0; i < nCoral; i++) {
    const s = spot(); if (!s) continue;
    const k = range(rng, 0.8, 2.4);
    Q.setFromEuler(E.set(0, rng() * 6, 0));
    M4.compose(new THREE.Vector3(s[0], s[1] - 0.05, s[2]), Q, S.set(k, k * range(rng, 0.8, 1.4), k));
    coral.setMatrixAt(nc, M4); coral.setColorAt(nc, pal[intRange(rng, 0, pal.length - 1)]); nc++;
  }
  coral.count = nc;
  group.add(coral);

  // —— 天窗（水面光斑）：给焦散与体积光提供"光从上方来"的位置 ——
  const skylights = [{ pos: new THREE.Vector3(boat.x, SURFACE_Y, boat.z), r: 14 }];
  const far = nodes[Math.min(nodes.length - 2, 5)].pos;
  skylights.push({ pos: new THREE.Vector3(far.x, SURFACE_Y, far.z), r: 14 });
  skylights.slice(0, 4).forEach((sk, i) => CAUSTIC.uSky.value[i].set(sk.pos.x, SURFACE_Y, sk.pos.z, sk.r));
  CAUSTIC.uSkyN.value = skylights.length;

  // —— 水流 ——
  const flowDir = new THREE.Vector3(...(g.current || [0, 0, -1])).normalize();
  const flowZones = [{ pos: new THREE.Vector3(0, -15, -g.half * 0.5), dir: flowDir, r: g.half * 0.6 }];

  // —— 沉船内部泥沙区 ——
  const siltZones = wr ? [
    { pos: new THREE.Vector3(wr.x - 5, plateau + 1.2, wr.z), r: 4 },
    { pos: new THREE.Vector3(wr.x + 6, plateau + 1.2, wr.z), r: 4 },
  ] : [];

  const sunDepthK = map.water.dayLen || 30;
  const objNode = nodes[Math.min(uni.objective.at, nodes.length - 1)];
  const objSpot = wallPoint(objNode.pos).pos.clone();
  objSpot.y = Math.max(objSpot.y, -999) + objNode.r * 0.5;   // 目标标记落在地面/崖壁上（Objective 会再下压 r*0.5）
  if (objNode.pos.y - surfaceBelow(objNode.pos.x, objNode.pos.y + 1, objNode.pos.z) > 6) objSpot.y = objNode.pos.y + objNode.r * 0.5;
  return {
    group, nav, wallPoint, mainSpine, kind: 'ocean', terrainH: h, surfaceBelow, boxes, plateau,
    entryPos: boat.clone(), entryR: 10,
    nodes, skylights, surfaces: [surface], shaftMat: { uniforms: { uT: { value: 0 } }, visible: false },
    pockets: [], branchInfo: [], siltZones, flowZones, photoables: [], creatureAnchors: [],
    linePts, lineGap,
    objectiveSpot: { pos: objSpot, r: objNode.r, name: objNode.name },
    exitS: acc,
    update(dt, depth) { sun.intensity = 0.06 + 1.2 * Math.exp(-Math.max(0, depth) / sunDepthK); },
  };
}
