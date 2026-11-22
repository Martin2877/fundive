// 海洋生物：程序化模型 + 行为（群游/巡游/漂浮/定栖）。与 populateCave 同形返回 {entities, photoables, update}。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { universeRng, range, intRange, chance, pick } from '@fundive/shared/rng.js';
import { Fish, Isopod, makeFish } from './creatures.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
const PAL = [0xff6fa5, 0xff9a3c, 0xa56bff, 0xffd84a, 0x3fd0b8, 0xff5a5a];

// ———— 巡游体（鲨/鳐/龟）：沿椭圆轨道游，朝向切线；avoidR>0 时会被潜水灯推开 ————
class Patrol {
  constructor(obj, center, R, speed, bob, flap, rng, avoidR = 0) {
    this.obj = obj; this.c = center.clone(); this.home = center.clone(); this.R = R; this.w = speed / R; this.bob = bob; this.flap = flap;
    this.a = rng() * 6.28; this.ph = rng() * 6; this.t = 0; this.ez = range(rng, 0.6, 1);
    this.dir = rng() < 0.5 ? 1 : -1;
    this.avoidR = avoidR;
    this._place(0);
  }
  _place() {
    const a = this.a;
    this.obj.position.set(this.c.x + Math.cos(a) * this.R, this.c.y + Math.sin(a * 0.7 + this.ph) * this.bob, this.c.z + Math.sin(a) * this.R * this.ez);
    const vx = -Math.sin(a) * this.dir * this.R, vz = Math.cos(a) * this.dir * this.R * this.ez;
    this.obj.rotation.y = Math.atan2(-vz, vx);
  }
  update(dt, ctx) {
    let spMul = 1;
    const pp = ctx?.playerPos || ctx?.lightPos;
    if (pp) {
      const dist = this.obj.position.distanceTo(pp);
      if (this.avoidR && dist < this.avoidR) {
        spMul = 1.35;
        _pv.set(this.c.x - pp.x, 0, this.c.z - pp.z);
        if (_pv.lengthSq() > 1e-4) this.c.add(_pv.normalize().multiplyScalar(dt * 2.5));
      } else if (dist < 4.2) {
        // 温柔巨兽靠近时不惊慌，而是优雅地略微偏让，避免穿模贴脸
        _pv.set(this.c.x - pp.x, 0, this.c.z - pp.z);
        if (_pv.lengthSq() > 1e-4) this.c.add(_pv.normalize().multiplyScalar(dt * 1.1));
      } else {
        this.c.lerp(this.home, Math.min(1, dt * 0.12));
      }
    }
    this.t += dt * spMul;
    this.a += this.w * dt * this.dir * spMul;
    this._place(); this.flap?.(this.t);
  }
}
const _pv = new THREE.Vector3();

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
  g.scale.setScalar(1.75);
  return g;
}

function makeRay() {
  const g = new THREE.Group();
  const top = M(0x3a4c5e, { side: THREE.DoubleSide, roughness: 0.55 });
  const bellyM = M(0xd8dcd8);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), top); body.scale.set(1.35, 0.3, 0.6); g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 7), bellyM); belly.scale.set(1.3, 0.2, 0.55); belly.position.y = -0.045; g.add(belly);
  // 头鳍（鹰鳐标志性的鸭嘴状头鳍）+ 眼
  for (const s of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), top); lobe.scale.set(1.6, 0.55, 0.8); lobe.position.set(0.36, -0.02, s * 0.1); g.add(lobe);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), M(0x111214)); eye.position.set(0.22, 0.1, s * 0.19); g.add(eye);
  }
  // 菱形胸鳍：前缘起于头侧、外缘后掠收成尖梢——三角帆式振翅
  const wings = [];
  const wingGeo = (s) => {
    const pts = [
      0.42, 0, 0,      0.1, 0.015, s * 0.62,   -0.28, 0, 0,          // 前根 -> 前缘中段 -> 后根
      0.1, 0.015, s * 0.62,  -0.12, -0.01, s * 1.02,  -0.28, 0, 0,   // 外缘 -> 尖梢 -> 后根
    ];
    const gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gm.computeVertexNormals();
    return gm;
  };
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.02, 0, s * 0.16);
    const w = new THREE.Mesh(wingGeo(s), top); pivot.add(w); g.add(pivot);
    wings.push([pivot, s]);
  }
  // 鞭尾：两段，末端有根小背鳍
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, 1.5, 4), top);
  tail.rotation.z = Math.PI / 2; tail.position.x = -1.02; g.add(tail);
  const tailfin = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4), top);
  tailfin.rotation.z = Math.PI / 2 - 0.3; tailfin.position.set(-0.52, 0.04, 0); g.add(tailfin);
  // 白色斑点（鹰鳐的星空背）
  const spotM = M(0xdce8ea, { roughness: 0.5 });
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), spotM);
    const a = i * 1.7, r = 0.1 + (i % 3) * 0.09;
    sp.position.set(Math.cos(a) * r, 0.1 - r * 0.1, Math.sin(a) * r * 0.6); sp.scale.y = 0.4; g.add(sp);
  }
  g.userData.flap = (t) => wings.forEach(([p, s], i) => { p.rotation.x = -s * Math.sin(t * 1.5 + i * 0.35) * 0.42; });
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

function makeHammerhead(rng) {
  const o = makeFish('shark', rng);
  const hm = M(0x6d7980, { roughness: 0.55 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.42), hm);
  bar.position.set(0.47, 0.01, 0);
  o.add(bar);
  const em = M(0x101214, { roughness: 0.3 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), em);
    e.position.set(0.49, 0.01, s * 0.21);
    o.add(e);
  }
  o.scale.setScalar(2.8);
  return o;
}

function makeWhaleShark(rng) {
  const o = makeFish('shark', rng);
  o.traverse(m => {
    const mt = m.material;
    if (mt?.isMeshStandardMaterial && mt.color.getHex() !== 0xd6dcd8 && mt.color.getHex() !== 0x101214) {
      mt.color.setHex(0x2d4860);
    }
  });
  const spotM = M(0xdce6ea, { roughness: 0.65 });
  for (let i = 0; i < 24; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.013, 5, 4), spotM);
    const u = ((i * 37) % 100) / 100 * 0.65 - 0.3;
    const z = ((i % 5) - 2) * 0.032;
    sp.position.set(u, 0.058 - Math.abs(z) * 0.4, z);
    sp.scale.y = 0.35;
    o.add(sp);
  }
  o.scale.setScalar(6.2);
  return o;
}

function makeWhale() {
  const g = new THREE.Group();
  const dark = M(0x283440, { roughness: 0.65 });
  const bellyM = M(0xc8d4dc, { roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), dark);
  body.scale.set(1.75, 0.48, 0.46);
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), bellyM);
  belly.scale.set(1.65, 0.32, 0.42); belly.position.y = -0.075;
  g.add(belly);
  // 背脊瘤突与小背鳍
  const hump = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 6), dark);
  hump.position.set(-0.22, 0.22, 0); hump.rotation.z = 0.35;
  g.add(hump);
  // 标志性超长翼状白腹胸鳍
  const pecs = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(0.18, -0.05, s * 0.16);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.68), bellyM);
    fin.position.set(-0.08, 0, s * 0.32); fin.rotation.y = s * -0.35;
    pv.add(fin); g.add(pv); pecs.push([pv, s]);
  }
  // 水平尾柄与宽大尾叶（上下拍打）
  const tailG = new THREE.Group(); tailG.position.set(-0.74, 0.01, 0);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.32, 8), dark);
  stalk.rotation.z = Math.PI / 2; stalk.position.x = -0.14; tailG.add(stalk);
  const fluke = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.028, 0.64), dark);
  fluke.position.x = -0.28; tailG.add(fluke);
  g.add(tailG);
  g.userData.flap = (t) => {
    tailG.rotation.z = Math.sin(t * 0.9) * 0.26;
    pecs.forEach(([p, s]) => { p.rotation.x = s * Math.sin(t * 0.7) * 0.12; });
  };
  g.scale.setScalar(7.5);
  return g;
}

function makeManta() {
  const g = new THREE.Group();
  const top = M(0x1c2632, { side: THREE.DoubleSide, roughness: 0.6 });
  const bellyM = M(0xe0e4e6);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), top); body.scale.set(1.2, 0.24, 0.72); g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 7), bellyM); belly.scale.set(1.15, 0.16, 0.66); belly.position.y = -0.04; g.add(belly);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 6), top);
    horn.rotation.z = -Math.PI / 2; horn.rotation.y = s * 0.18; horn.position.set(0.42, -0.01, s * 0.14); g.add(horn);
  }
  const wings = [];
  const wingGeo = (s) => {
    const pts = [
      0.32, 0, 0,   0.06, 0.02, s * 0.85,  -0.28, 0, 0,
      0.06, 0.02, s * 0.85, -0.18, -0.01, s * 1.38, -0.28, 0, 0,
    ];
    const gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gm.computeVertexNormals();
    return gm;
  };
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.02, 0, s * 0.18);
    pivot.add(new THREE.Mesh(wingGeo(s), top)); g.add(pivot); wings.push([pivot, s]);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.004, 1.1, 4), top);
  tail.rotation.z = Math.PI / 2; tail.position.x = -0.85; g.add(tail);
  g.userData.flap = (t) => wings.forEach(([p, s], i) => { p.rotation.x = -s * Math.sin(t * 1.1 + i * 0.25) * 0.38; });
  g.scale.setScalar(3.6);
  return g;
}

function makeIguana() {
  const g = new THREE.Group();
  const mat = M(0x363b34, { roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), mat);
  body.rotation.z = Math.PI / 2; body.position.y = 0.09; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat);
  head.scale.set(1.2, 0.9, 0.95); head.position.set(0.26, 0.12, 0); g.add(head);
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), M(0x4b5248));
    sp.position.set(0.18 - i * 0.06, 0.17, 0); g.add(sp);
  }
  for (const [x, z] of [[0.14, 0.1], [0.14, -0.1], [-0.12, 0.1], [-0.12, -0.1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), mat);
    leg.position.set(x, 0.05, z); leg.rotation.x = Math.sign(z) * 0.35; g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.55, 5), mat);
  tail.rotation.z = Math.PI / 2; tail.position.set(-0.45, 0.07, 0); g.add(tail);
  g.userData.tail = tail;
  g.scale.setScalar(1.4);
  return g;
}

class Tornado {
  constructor(items, center, rng) {
    this.items = items;
    this.c = center.clone();
    this.t = rng() * 10;
    this.dir = rng() < 0.5 ? 1 : -1;
    this.expand = 0;
  }
  update(dt, ctx) {
    this.t += dt;
    const pp = ctx?.playerPos;
    const targetExp = pp && Math.hypot(pp.x - this.c.x, pp.z - this.c.z) < 5.5 && Math.abs(pp.y - this.c.y) < 6 ? 1.8 : 0;
    this.expand += (targetExp - this.expand) * Math.min(1, dt * 2.5);
    for (const it of this.items) {
      const a = it.a0 + this.t * it.w * this.dir;
      const rad = it.r + this.expand;
      const x = this.c.x + Math.cos(a) * rad;
      const z = this.c.z + Math.sin(a) * rad;
      const y = this.c.y + it.dy + Math.sin(this.t * 1.1 + it.ph) * 0.45;
      it.obj.position.set(x, y, z);
      const vx = -Math.sin(a) * this.dir, vz = Math.cos(a) * this.dir;
      it.obj.rotation.y = Math.atan2(-vz, vx);
      if (it.obj.userData.tail) it.obj.userData.tail.rotation.y = Math.sin(this.t * 8 + it.ph) * 0.45;
    }
  }
}

export function populateOcean(scene, ocean, map, uni) {
  const rng = universeRng(map.id, `${uni.seed}::marine`);
  const entities = [], photoables = [];
  const addEnt = (sp, e, r = 1) => { scene.add(e.obj); entities.push(e); photoables.push({ sp, obj: e.obj, r }); };
  // 强光贴脸会把鱼打成白纸——压高光、降明度、去半透明，让体色在灯下还立得住
  const dull = (o) => o.traverse(m => {
    const mt = m.material;
    if (!mt?.isMeshStandardMaterial) return;
    mt.roughness = Math.max(mt.roughness, 0.78);
    mt.color?.multiplyScalar(0.62);
    if (mt.opacity >= 0.9) { mt.transparent = false; mt.opacity = 1; }
  });
  // 封闭舱内不放自由游动的生物——它们不做碰撞，会穿墙
  const INSIDE_BLOCK = new Set(['damselfish', 'parrotfish', 'clownfish', 'shark', 'ray', 'turtle', 'jellyfish', 'barracuda', 'napoleon', 'hammerhead', 'whaleshark', 'whale', 'manta', 'iguana']);
  // 出生点若落进碰撞体（墙/箱），沿最小穿透轴推出去
  const eject = (p, pad) => {
    for (const b of ocean.boxes || []) {
      if (p.x <= b.min.x - pad || p.x >= b.max.x + pad || p.y <= b.min.y - pad || p.y >= b.max.y + pad || p.z <= b.min.z - pad || p.z >= b.max.z + pad) continue;
      const d = [p.x - b.min.x + pad, b.max.x + pad - p.x, p.y - b.min.y + pad, b.max.y + pad - p.y, p.z - b.min.z + pad, b.max.z + pad - p.z];
      const k = d.indexOf(Math.min(...d));
      if (k === 0) p.x = b.min.x - pad; else if (k === 1) p.x = b.max.x + pad; else if (k === 2) p.y = b.min.y - pad; else if (k === 3) p.y = b.max.y + pad; else if (k === 4) p.z = b.min.z - pad; else p.z = b.max.z + pad;
    }
    return p;
  };

  const spawn = (sp, node, k = 0) => {
    const P = node.pos;
    const ground = (spread = 3.5) => { const a = rng() * 6.28, d = range(rng, 0.5, spread); return ocean.wallPoint(new THREE.Vector3(P.x + Math.cos(a) * d, P.y, P.z + Math.sin(a) * d)).pos; };
    const place = (obj, pos, yaw = rng() * 6.28) => { obj.position.copy(pos); obj.rotation.y = yaw; };
    switch (sp) {
      case 'damselfish': case 'parrotfish': case 'clownfish': case 'grouper': {
        const n = sp === 'damselfish' ? intRange(rng, 7, 11) : sp === 'grouper' ? 1 : intRange(rng, 2, 3);
        const c = sp === 'grouper' || sp === 'clownfish' ? ground(2.5).add(new THREE.Vector3(0, sp === 'grouper' ? 1.2 : 0.7, 0)) : eject(P.clone(), 4);
        for (let i = 0; i < n; i++) {
          const f = new Fish(sp, { pos: c.clone().add(new THREE.Vector3(range(rng, -1, 1), range(rng, -0.5, 0.5), range(rng, -1, 1))), r: sp === 'damselfish' ? 3.5 : 2 }, rng);
          dull(f.obj);
          addEnt(sp, f, sp === 'grouper' ? 1.4 : 0.7);
        }
        return;
      }
      case 'shark': { const o = makeFish('shark', rng); dull(o); o.scale.setScalar(2.9); addEnt(sp, new Patrol(o, eject(P.clone(), 6), range(rng, 14, 22), 1.6, 2.5, (t) => { o.userData.tail.rotation.y = Math.sin(t * 3) * 0.45; }, rng, 7), 3.4); return; }
      case 'barracuda': {
        const isTornado = node.feats?.includes('tornado');
        const n = isTornado ? 22 : intRange(rng, 5, 8);
        const c = eject(P.clone(), 6);
        const items = [];
        for (let i = 0; i < n; i++) {
          const o = makeFish('barracuda', rng); dull(o); o.scale.setScalar(1.35);
          scene.add(o);
          if (i < 6) photoables.push({ sp, obj: o, r: 1.3 });
          items.push({ obj: o, a0: (i / n) * 6.28 + range(rng, -0.3, 0.3), r: isTornado ? range(rng, 3.8, 7.2) : range(rng, 2.5, 5), dy: isTornado ? range(rng, -3.5, 5.0) : range(rng, -1.2, 1.5), w: range(rng, 0.35, 0.55), ph: rng() * 6 });
        }
        entities.push(new Tornado(items, c, rng));
        return;
      }
      case 'napoleon': {
        const f = new Fish('napoleon', { pos: eject(P.clone(), 4), r: 5 }, rng);
        dull(f.obj);
        addEnt(sp, f, 1.8);
        return;
      }
      case 'hammerhead': {
        const n = node.feats?.includes('tornado') ? 6 : 2;
        const c = eject(P.clone(), 7);
        for (let i = 0; i < n; i++) {
          const o = makeHammerhead(rng); dull(o);
          const off = new THREE.Vector3(range(rng, -4, 4), range(rng, -2, 3), range(rng, -4, 4));
          addEnt(sp, new Patrol(o, c.clone().add(off), range(rng, 14, 22), 1.6, 2.2, (t) => { o.userData.tail.rotation.y = Math.sin(t * 3.2) * 0.45; }, rng, 7), 3);
        }
        return;
      }
      case 'whaleshark': {
        const o = makeWhaleShark(rng); dull(o);
        addEnt(sp, new Patrol(o, eject(P.clone().add(new THREE.Vector3(0, 2.5, 0)), 10), range(rng, 18, 26), 1.2, 2.0, (t) => { o.userData.tail.rotation.y = Math.sin(t * 1.6) * 0.32; }, rng, 0), 7.5);
        return;
      }
      case 'whale': {
        const o = makeWhale(); dull(o);
        const pos = eject(P.clone().add(new THREE.Vector3(0, 5.0, 0)), 12);
        pos.y = Math.min(-6.5, pos.y);
        addEnt(sp, new Patrol(o, pos, range(rng, 24, 34), 1.4, 3.0, o.userData.flap, rng, 0), 10.0);
        return;
      }
      case 'manta': {
        const n = intRange(rng, 1, 2);
        for (let i = 0; i < n; i++) {
          const o = makeManta();
          addEnt(sp, new Patrol(o, eject(P.clone().add(new THREE.Vector3(range(rng, -3, 3), 1.5, range(rng, -3, 3))), 7), range(rng, 14, 22), 1.3, 2.2, o.userData.flap, rng, 0), 3.6);
        }
        return;
      }
      case 'iguana': {
        for (let i = 0; i < 2; i++) {
          const o = makeIguana(); dull(o);
          place(o, ground(3));
          addEnt(sp, { obj: o, update(dt, c) { o.userData.tail.rotation.y = Math.sin(c.time * 1.5 + i) * 0.14; } }, 1.1);
        }
        return;
      }
      case 'ray': { const o = makeRay(); addEnt(sp, new Patrol(o, eject(P.clone(), 6), range(rng, 12, 18), 1.2, 1.8, o.userData.flap, rng, 5), 2.5); return; }
      case 'turtle': { const o = makeTurtle(); dull(o); addEnt(sp, new Patrol(o, eject(P.clone().add(new THREE.Vector3(0, 1, 0)), 4), range(rng, 9, 14), 0.8, 1.2, o.userData.flap, rng, 3.5), 1.6); return; }
      case 'jellyfish': { for (let i = 0; i < intRange(rng, 2, 4); i++) addEnt(sp, new Jelly(eject(P.clone().add(new THREE.Vector3(range(rng, -4, 4), range(rng, -1, 3), range(rng, -4, 4))), 4), rng), 1.2); return; }
      case 'octopus': { const o = makeOctopus(rng); place(o, ocean.wallPoint(new THREE.Vector3(P.x + range(rng, -1.5, 1.5), P.y, P.z + range(rng, -1.5, 1.5))).pos); addEnt(sp, { obj: o, update(dt, c) { o.rotation.z = Math.sin(c.time * 1.3) * 0.04; } }, 1); return; }
      case 'nudibranch': { for (let i = 0; i < 2; i++) { const g = ground(3); const c = new Isopod({ pos: g, r: 1, floorY: g.y }, rng, 'nudibranch'); scene.add(c.obj); entities.push(c); photoables.push({ sp, obj: c.obj, r: 0.3 }); } return; }
      case 'coral': { for (let i = 0; i < 3; i++) { const o = makeCoral(rng); place(o, ground(4)); addEnt(sp, { obj: o }, 1.4); } return; }
      case 'anemone': { for (let i = 0; i < 2; i++) { const o = makeAnemone(rng); place(o, ground(2.5)); addEnt(sp, { obj: o, update(dt, c) { o.userData.update(c.time); } }, 0.8); } return; }
      case 'seafan': { for (let i = 0; i < 2; i++) { const o = makeSeafan(rng); const g = ground(4); place(o, g, Math.PI / 2); addEnt(sp, { obj: o }, 1.2); } return; }
      case 'sponge': { for (let i = 0; i < 2; i++) { const o = makeSponge(rng); place(o, ground(4)); addEnt(sp, { obj: o }, 1); } return; }
      case 'shipbell': { const o = makeBell(); dull(o); o.scale.setScalar(1.0); place(o, ocean.wallPoint(new THREE.Vector3(P.x + range(rng, -1, 1), P.y, P.z + range(rng, -0.8, 0.8))).pos); addEnt(sp, { obj: o }, 1); return; }
      default:
    }
  };

  for (const pl of uni.placements) {
    if (pl.path !== 'main') continue;
    const node = ocean.nodes[pl.at];
    if (!node || (node.inside && INSIDE_BLOCK.has(pl.sp))) continue;
    spawn(pl.sp, pl.off ? { ...node, pos: node.pos.clone().add(new THREE.Vector3(...pl.off)) } : node);
  }
  // 活力：礁盘上再撒几群小鱼（不进图鉴目标，但可以拍；封闭舱内不撒）
  const schools = (map.creatures || []).filter(s => ['damselfish', 'parrotfish'].includes(s));
  if (schools.length) ocean.nodes.forEach((n, i) => { if (i > 0 && !n.inside && chance(rng, 0.45) && !n.feats.some(f => schools.includes(f))) spawn(pick(rng, schools), n); });

  return { entities, photoables, update(dt, ctx) { for (const e of entities) e.update?.(dt, ctx); } };
}

// ———— 冰潜生物 ————
// 冰海天使：透明身体 + 红色内脏 + 两片"翅膀"快速扇动，在冰盖下悬停
function makeSeaAngel() {
  const g = new THREE.Group();
  const glassM = new THREE.MeshStandardMaterial({ color: 0xbfe8f0, transparent: true, opacity: 0.42, roughness: 0.55, emissive: 0x2a5a68, emissiveIntensity: 0.3, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.13, 4, 8), glassM); g.add(body);
  const gut = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), M(0xd83a2a, { emissive: 0x6a1408, emissiveIntensity: 0.5 }));
  gut.scale.set(1, 1.8, 1); gut.position.y = 0.01; g.add(gut);
  const wings = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(0, 0.05, s * 0.03);
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.075, 8), glassM);
    w.scale.set(0.55, 1.2, 1); w.position.z = s * 0.07; w.rotation.x = Math.PI / 2;
    pv.add(w); g.add(pv); wings.push([pv, s]);
  }
  g.userData.flap = (t) => wings.forEach(([p, s]) => { p.rotation.x = s * Math.sin(t * 7) * 0.85; });
  g.scale.setScalar(1.6);
  return g;
}
class SeaAngel {
  constructor(pos, rng) {
    this.obj = makeSeaAngel();
    this.obj.position.copy(pos);
    this.base = pos.clone(); this.ph = rng() * 6; this.t = rng() * 10;
  }
  update(dt) {
    this.t += dt;
    this.obj.userData.flap(this.t);
    this.obj.position.set(this.base.x + Math.sin(this.t * 0.21 + this.ph) * 1.4, this.base.y + Math.sin(this.t * 0.4 + this.ph) * 0.7, this.base.z + Math.cos(this.t * 0.17 + this.ph) * 1.4);
    this.obj.rotation.y = Math.sin(this.t * 0.2) * 0.6;
  }
}
// 冰柱藻：成束绿丝垂在冰盖下表面
function makeIceAlgae(rng) {
  const g = new THREE.Group();
  const m = M(0x2e6a42, { side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  for (let i = 0; i < 16; i++) {
    const len = range(rng, 0.12, 0.5);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.02, len, 1, 2), m);
    p.position.set(range(rng, -0.5, 0.5), -len / 2, range(rng, -0.5, 0.5));
    p.rotation.y = rng() * 3;
    g.add(p);
  }
  return g;
}

export function populateIce(scene, ice, map, uni) {
  const rng = universeRng(map.id, `${uni.seed}::ice`);
  const entities = [], photoables = [];
  const addEnt = (sp, e, r = 1) => { scene.add(e.obj); entities.push(e); photoables.push({ sp, obj: e.obj, r }); };
  const eject = (p, pad) => {
    for (const b of ice.boxes || []) {
      if (p.x <= b.min.x - pad || p.x >= b.max.x + pad || p.y <= b.min.y - pad || p.y >= b.max.y + pad || p.z <= b.min.z - pad || p.z >= b.max.z + pad) continue;
      const d = [p.x - b.min.x + pad, b.max.x + pad - p.x, p.y - b.min.y + pad, b.max.y + pad - p.y, p.z - b.min.z + pad, b.max.z + pad - p.z];
      const k = d.indexOf(Math.min(...d));
      if (k === 0) p.x = b.min.x - pad; else if (k === 1) p.x = b.max.x + pad; else if (k === 2) p.y = b.min.y - pad; else if (k === 3) p.y = b.max.y + pad; else if (k === 4) p.z = b.min.z - pad; else p.z = b.max.z + pad;
    }
    return p;
  };
  const spawn = (sp, node) => {
    const P = node.pos;
    const ground = (spread = 3.5) => { const a = rng() * 6.28, d = range(rng, 0.5, spread); return ice.wallPoint(new THREE.Vector3(P.x + Math.cos(a) * d, P.y, P.z + Math.sin(a) * d)).pos; };
    switch (sp) {
      case 'whitefish': {
        const n = intRange(rng, 5, 8);
        const c = eject(P.clone().add(new THREE.Vector3(range(rng, -2, 2), range(rng, -1, 1), range(rng, -2, 2))), 4);
        for (let i = 0; i < n; i++) {
          const f = new Fish(sp, { pos: c.clone().add(new THREE.Vector3(range(rng, -2, 2), range(rng, -0.8, 0.8), range(rng, -2, 2))), r: 4 }, rng);
          f.obj.traverse(m => { const mt = m.material; if (mt?.isMeshStandardMaterial) { mt.roughness = Math.max(mt.roughness, 0.8); mt.color?.multiplyScalar(0.6); } });
          addEnt(sp, f, 0.7);
        }
        return;
      }
      case 'seaangel': {
        for (let i = 0; i < intRange(rng, 3, 5); i++)
          addEnt(sp, new SeaAngel(P.clone().add(new THREE.Vector3(range(rng, -3, 3), range(rng, -0.5, 1.5), range(rng, -3, 3))), rng), 0.5);
        return;
      }
      case 'icealgae': {
        for (let i = 0; i < intRange(rng, 3, 5); i++) {
          const o = makeIceAlgae(rng);
          const a = rng() * 6.28, d = range(rng, 0.5, 5);
          o.position.copy(ice.ceilPoint(new THREE.Vector3(P.x + Math.cos(a) * d, P.y, P.z + Math.sin(a) * d)));
          addEnt(sp, { obj: o }, 0.8);
        }
        return;
      }
      case 'isopod': {
        for (let i = 0; i < 2; i++) { const g = ground(3); const c = new Isopod({ pos: g, r: 1.5, floorY: g.y }, rng, 'isopod'); scene.add(c.obj); entities.push(c); photoables.push({ sp, obj: c.obj, r: 0.4 }); }
        return;
      }
      case 'anemone': { for (let i = 0; i < 2; i++) { const o = makeAnemone(rng); o.position.copy(ground(2.5)); addEnt(sp, { obj: o, update(dt, c) { o.userData.update(c.time); } }, 0.8); } return; }
      case 'sponge': { for (let i = 0; i < 2; i++) { const o = makeSponge(rng); o.position.copy(ground(4)); addEnt(sp, { obj: o }, 1); } return; }
      default:
    }
  };
  for (const pl of uni.placements) {
    if (pl.path !== 'main') continue;
    const node = ice.nodes[pl.at];
    if (node) spawn(pl.sp, pl.off ? { ...node, pos: node.pos.clone().add(new THREE.Vector3(...pl.off)) } : node);
  }
  // 活力：空旷节点撒一群白鲑
  const ICE_SCHOOL = (map.creatures || []).includes('whitefish');
  if (ICE_SCHOOL) ice.nodes.forEach((n, i) => { if (i > 1 && chance(rng, 0.4)) spawn('whitefish', n); });
  return { entities, photoables, update(dt, ctx) { for (const e of entities) e.update?.(dt, ctx); } };
}
