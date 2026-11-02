// 海洋生物：程序化模型 + 行为（群游/巡游/漂浮/定栖）。与 populateCave 同形返回 {entities, photoables, update}。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { universeRng, range, intRange, chance, pick } from '@fundive/shared/rng.js';
import { Fish, Isopod, makeFish } from './creatures.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
const PAL = [0xff6fa5, 0xff9a3c, 0xa56bff, 0xffd84a, 0x3fd0b8, 0xff5a5a];

// ———— 巡游体（鲨/鳐/龟）：沿椭圆轨道游，朝向切线 ————
class Patrol {
  constructor(obj, center, R, speed, bob, flap, rng) {
    this.obj = obj; this.c = center.clone(); this.R = R; this.w = speed / R; this.bob = bob; this.flap = flap;
    this.a = rng() * 6.28; this.ph = rng() * 6; this.t = 0; this.ez = range(rng, 0.6, 1);
    this.dir = rng() < 0.5 ? 1 : -1;
    this._place(0);
  }
  _place() {
    const a = this.a;
    this.obj.position.set(this.c.x + Math.cos(a) * this.R, this.c.y + Math.sin(a * 0.7 + this.ph) * this.bob, this.c.z + Math.sin(a) * this.R * this.ez);
    const vx = -Math.sin(a) * this.dir * this.R, vz = Math.cos(a) * this.dir * this.R * this.ez;
    this.obj.rotation.y = Math.atan2(-vz, vx);
  }
  update(dt) { this.t += dt; this.a += this.w * dt * this.dir; this._place(); this.flap?.(this.t); }
}

function makeTurtle() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), M(0x6b7a3a, { roughness: 0.8 })); shell.scale.set(1, 0.38, 0.78); g.add(shell);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), M(0xd8cfa0)); belly.scale.set(1, 0.25, 0.74); belly.position.y = -0.09; g.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M(0x8a8a50)); head.scale.set(1.5, 0.9, 1); head.position.set(0.55, 0.0, 0); g.add(head);
  const fl = [];
  const flip = (x, z, len, w) => {
    const p = new THREE.Group(); p.position.set(x, -0.02, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, len), M(0x7a8a48)); m.position.z = Math.sign(z) * len / 2; p.add(m); g.add(p); fl.push([p, Math.sign(z)]);
  };
  flip(0.22, 0.32, 0.5, 0.2); flip(0.22, -0.32, 0.5, 0.2); flip(-0.32, 0.22, 0.22, 0.14); flip(-0.32, -0.22, 0.22, 0.14);
  g.userData.flap = (t) => fl.forEach(([p, s], i) => { p.rotation.x = -s * Math.sin(t * 1.6 + (i > 1 ? 1.5 : 0)) * (i > 1 ? 0.25 : 0.55); });
  g.scale.setScalar(1.5);
  return g;
}

function makeRay() {
  const g = new THREE.Group();
  const mat = M(0x3a4c5e, { side: THREE.DoubleSide, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), M(0x3a4c5e)); body.scale.set(1.3, 0.28, 0.5); g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute([0.45, 0, 0, -0.3, 0, 0, -0.1, 0.02, s * 1.0], 3));
    gm.computeVertexNormals();
    const w = new THREE.Mesh(gm, mat); g.add(w); wings.push([w, s]);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 1.4, 4), mat); tail.rotation.z = Math.PI / 2; tail.position.x = -1.0; g.add(tail);
  g.userData.flap = (t) => wings.forEach(([w, s]) => { w.rotation.x = -s * Math.sin(t * 1.4) * 0.3; });
  g.scale.setScalar(1.8);
  return g;
}

class Jelly {
  constructor(pos, rng) {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8c4ff, emissive: 0xa890ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.3 }));
    g.add(bell);
    const tm = new THREE.MeshBasicMaterial({ color: 0xe6dcff, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * 6.28, t = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, range(rng, 0.4, 0.8), 3), tm);
      t.position.set(Math.cos(a) * 0.14, -0.3, Math.sin(a) * 0.14); g.add(t);
    }
    g.scale.setScalar(range(rng, 1.0, 1.8));
    this.obj = g; this.bell = bell; this.base = pos.clone(); this.ph = rng() * 6; this.t = 0;
    g.position.copy(pos);
  }
  update(dt) {
    this.t += dt;
    const p = Math.sin(this.t * 2.4 + this.ph);
    this.bell.scale.set(1 - p * 0.1, 1 + p * 0.22, 1 - p * 0.1);
    this.obj.position.set(this.base.x + Math.sin(this.t * 0.11 + this.ph) * 3, this.base.y + Math.sin(this.t * 0.35 + this.ph) * 1.6 + (p > 0 ? p * 0.05 : 0), this.base.z + Math.cos(this.t * 0.09 + this.ph) * 3);
  }
}

function makeOctopus(rng) {
  const g = new THREE.Group();
  const mat = M(0xc4623a, { roughness: 0.7 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat); head.scale.set(1, 1.25, 1); head.position.y = 0.3; g.add(head);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), M(0xf0e0b0)); e.position.set(0.12, 0.33, s * 0.09); const p = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), M(0x111111)); p.position.set(0.03, 0, 0); e.add(p); g.add(e); }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.28, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pts = [new THREE.Vector3(0, 0.2, 0), d.clone().multiplyScalar(0.18).setY(0.08), d.clone().multiplyScalar(0.38).setY(0.02), d.clone().multiplyScalar(0.55).add(new THREE.Vector3(-d.z * range(rng, -0.2, 0.2), 0.02, d.x * range(rng, -0.2, 0.2)))];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.03, 5), mat));
  }
  g.scale.setScalar(1.2);
  return g;
}

function makeCoral(rng) {
  const g = new THREE.Group(), c = pick(rng, PAL), m = M(c, { emissive: c, emissiveIntensity: 0.12 });
  for (let k = 0; k < 9; k++) {
    const h = range(rng, 0.4, 1.0), cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, h, 5), m);
    cone.position.set(Math.cos(k * 1.1) * 0.15, h / 2, Math.sin(k * 1.1) * 0.15);
    cone.rotation.set(Math.sin(k) * 0.5, 0, Math.cos(k * 1.3) * 0.5);
    g.add(cone);
  }
  g.scale.setScalar(range(rng, 1.2, 2.2));
  return g;
}

function makeAnemone(rng) {
  const g = new THREE.Group(), tents = [];
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.12, 10), M(0xb86a8a)); base.position.y = 0.06; g.add(base);
  const m = M(0xff8fb0, { emissive: 0xff5a8a, emissiveIntensity: 0.2 });
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * 6.28 * 1.3, r = 0.04 + (i % 3) * 0.04, t = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.32, 4), m);
    t.geometry.translate(0, 0.16, 0);
    const pv = new THREE.Group(); pv.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r); pv.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); pv.add(t); g.add(pv); tents.push([pv, i]);
    pv.userData.r0 = [pv.rotation.x, pv.rotation.z];
  }
  g.scale.setScalar(range(rng, 1.4, 2.0));
  g.userData.update = (t) => tents.forEach(([p, i]) => { p.rotation.x = p.userData.r0[0] + Math.sin(t * 1.2 + i) * 0.12; p.rotation.z = p.userData.r0[1] + Math.cos(t * 1.0 + i * 1.3) * 0.12; });
  return g;
}

function makeSeafan(rng) {
  const parts = [];
  const branch = (x, y, ang, len, depth) => {
    const c = new THREE.CylinderGeometry(0.012, 0.016, len, 4); c.translate(0, len / 2, 0); c.rotateZ(ang); c.translate(x, y, 0);
    parts.push(c);
    if (depth > 0) {
      const ex = x - Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
      branch(ex, ey, ang - 0.45, len * 0.72, depth - 1); branch(ex, ey, ang + 0.45, len * 0.72, depth - 1); if (depth > 2) branch(ex, ey, ang, len * 0.75, depth - 1);
    }
  };
  branch(0, 0, 0, 0.45, 4);
  const geo = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p.toNonIndexed(); }));
  const g = new THREE.Group(); const m = new THREE.Mesh(geo, M(pick(rng, [0xe0445a, 0xff7a3a, 0xc060e0]), { emissiveIntensity: 0.15 }));
  g.add(m); g.scale.setScalar(range(rng, 1.5, 2.5));
  return g;
}

function makeSponge(rng) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.9, 12, 1, true), M(0x8a5a6a, { side: THREE.DoubleSide, roughness: 0.95 })); outer.position.y = 0.45; g.add(outer);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.26, 12), M(0x4a2a3a)); bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.05; g.add(bottom);
  g.scale.setScalar(range(rng, 1.0, 1.9));
  return g;
}

function makeBell() {
  const g = new THREE.Group(), m = M(0x4a8a6a, { metalness: 0.5, roughness: 0.55 });
  const pts = [[0, 0.5], [0.06, 0.5], [0.12, 0.42], [0.18, 0.28], [0.26, 0.1], [0.3, 0.0], [0.0, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), M(0x4a8a6a, { metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide })); bell.position.y = 0.45; g.add(bell);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), m); p.position.set(0, 0.48, s * 0.34); g.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.76), m); beam.position.y = 0.95; g.add(beam);
  g.scale.setScalar(1.3);
  return g;
}

export function populateOcean(scene, ocean, map, uni) {
  const rng = universeRng(map.id, `${uni.seed}::marine`);
  const entities = [], photoables = [];
  const addEnt = (sp, e, r = 1) => { scene.add(e.obj); entities.push(e); photoables.push({ sp, obj: e.obj, r }); };
  const floorAt = (x, y, z) => ocean.wallPoint(new THREE.Vector3(x, y, z)).pos.y;

  const spawn = (sp, node, k = 0) => {
    const P = node.pos;
    const ground = (spread = 3.5) => { const a = rng() * 6.28, d = range(rng, 0.5, spread); return ocean.wallPoint(new THREE.Vector3(P.x + Math.cos(a) * d, P.y, P.z + Math.sin(a) * d)).pos; };
    const place = (obj, pos, yaw = rng() * 6.28) => { obj.position.copy(pos); obj.rotation.y = yaw; };
    switch (sp) {
      case 'damselfish': case 'parrotfish': case 'clownfish': case 'grouper': {
        const n = sp === 'damselfish' ? intRange(rng, 7, 11) : sp === 'grouper' ? 1 : intRange(rng, 2, 3);
        const c = sp === 'grouper' || sp === 'clownfish' ? ground(2.5).add(new THREE.Vector3(0, sp === 'grouper' ? 1.2 : 0.7, 0)) : P.clone();
        for (let i = 0; i < n; i++) {
          const f = new Fish(sp, { pos: c.clone().add(new THREE.Vector3(range(rng, -1, 1), range(rng, -0.5, 0.5), range(rng, -1, 1))), r: sp === 'damselfish' ? 3.5 : 2 }, rng);
          addEnt(sp, f, sp === 'grouper' ? 1.4 : 0.7);
        }
        return;
      }
      case 'shark': { const o = makeFish('shark', rng); o.scale.set(5, 5, 4); addEnt(sp, new Patrol(o, P.clone().add(new THREE.Vector3(0, 0, 0)), range(rng, 14, 20), 1.5, 2.5, (t) => { o.userData.tail.rotation.y = Math.sin(t * 3) * 0.45; }, rng), 3); return; }
      case 'ray': { const o = makeRay(); addEnt(sp, new Patrol(o, P.clone(), range(rng, 12, 18), 1.2, 1.8, o.userData.flap, rng), 2.5); return; }
      case 'turtle': { const o = makeTurtle(); addEnt(sp, new Patrol(o, P.clone().add(new THREE.Vector3(0, 1, 0)), range(rng, 9, 14), 0.8, 1.2, o.userData.flap, rng), 1.6); return; }
      case 'jellyfish': { for (let i = 0; i < intRange(rng, 2, 4); i++) addEnt(sp, new Jelly(P.clone().add(new THREE.Vector3(range(rng, -4, 4), range(rng, -1, 3), range(rng, -4, 4))), rng), 1.2); return; }
      case 'octopus': { const o = makeOctopus(rng); place(o, ocean.wallPoint(new THREE.Vector3(P.x + range(rng, -1.5, 1.5), P.y, P.z + range(rng, -1.5, 1.5))).pos); addEnt(sp, { obj: o, update(dt, c) { o.rotation.z = Math.sin(c.time * 1.3) * 0.04; } }, 1); return; }
      case 'nudibranch': { for (let i = 0; i < 2; i++) { const g = ground(3); const c = new Isopod({ pos: g, r: 1, floorY: g.y }, rng, 'nudibranch'); scene.add(c.obj); entities.push(c); photoables.push({ sp, obj: c.obj, r: 0.3 }); } return; }
      case 'coral': { for (let i = 0; i < 3; i++) { const o = makeCoral(rng); place(o, ground(4)); addEnt(sp, { obj: o }, 1.4); } return; }
      case 'anemone': { for (let i = 0; i < 2; i++) { const o = makeAnemone(rng); place(o, ground(2.5)); addEnt(sp, { obj: o, update(dt, c) { o.userData.update(c.time); } }, 0.8); } return; }
      case 'seafan': { for (let i = 0; i < 2; i++) { const o = makeSeafan(rng); const g = ground(4); place(o, g, Math.PI / 2); addEnt(sp, { obj: o }, 1.2); } return; }
      case 'sponge': { for (let i = 0; i < 2; i++) { const o = makeSponge(rng); place(o, ground(4)); addEnt(sp, { obj: o }, 1); } return; }
      case 'shipbell': { const o = makeBell(); place(o, ocean.wallPoint(new THREE.Vector3(P.x + range(rng, -1, 1), P.y, P.z + range(rng, -0.8, 0.8))).pos); addEnt(sp, { obj: o }, 1); return; }
      default:
    }
  };

  for (const pl of uni.placements) {
    if (pl.path !== 'main') continue;
    const node = ocean.nodes[pl.at];
    if (!node) continue;
    spawn(pl.sp, pl.off ? { ...node, pos: node.pos.clone().add(new THREE.Vector3(...pl.off)) } : node);
  }
  // 活力：礁盘上再撒几群小鱼（不进图鉴目标，但可以拍）
  const schools = (map.creatures || []).filter(s => ['damselfish', 'parrotfish'].includes(s));
  if (schools.length) ocean.nodes.forEach((n, i) => { if (i > 0 && chance(rng, 0.45) && !n.feats.some(f => schools.includes(f))) spawn(pick(rng, schools), n); });

  return { entities, photoables, update(dt, ctx) { for (const e of entities) e.update?.(dt, ctx); } };
}
