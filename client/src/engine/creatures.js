// 洞穴生物与地质 photoable 实体：全部由代码生成，无需外部模型。
// 鱼类有简单巡游/避光行为；静态物种注册为拍摄目标。
import * as THREE from 'three';
import { universeRng, chance, range, intRange } from '@fundive/shared/rng.js';
import { fbm3 } from './noise.js';
import { softSprite } from './water.js';

const _v = new THREE.Vector3();

// ---------- 程序化鱼：拉伸变形的鱼体 + 扇形尾鳍 + 背鳍/胸鳍 + 眼点 ----------
export function makeFish(sp, rng) {
  const g = new THREE.Group();
  const colors = { cavefish: 0xe6cabc, blindfish: 0xecdeda, catfish: 0x3f4447, trout: 0x8a9a8a, damselfish: 0x2f7fe0, clownfish: 0xff7a1a, parrotfish: 0x2fb8a0, grouper: 0x8a6a4a, shark: 0x7d8a90 };
  const base = colors[sp] || 0xcfc8b8;
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, metalness: 0.05, transparent: true, opacity: sp === 'catfish' ? 1 : 0.93 });
  const finMat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.7, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  // 鱼体：球体沿 x 拉伸，尾端渐细、腹稍鼓、背部微弓
  const bg = new THREE.SphereGeometry(0.16, 20, 12);
  const pa = bg.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const tailK = x < 0 ? Math.max(0.18, 1 + x / 0.22) : 1 - x * 0.35;   // 尾柄渐细
    y *= 0.62 * tailK * (x < 0 ? 1 : 1 + 0.12 * (1 - x / 0.16));         // 腹部略鼓
    z *= 0.38 * tailK;
    y += x < 0 ? -x * 0.1 : x * x * 0.3;                                 // 背部弓线
    pa.setXYZ(i, x * 1.9, y, z);
  }
  bg.computeVertexNormals();
  const body = new THREE.Mesh(bg, mat);
  g.add(body);
  // 尾鳍：两片三角扇
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.24, 0.02, 0, -0.42, 0.13, 0, -0.38, 0.0, 0,
    -0.24, -0.02, 0, -0.42, -0.13, 0, -0.38, 0.0, 0,
  ], 3));
  tailGeo.computeVertexNormals();
  const tail = new THREE.Mesh(tailGeo, finMat);
  g.add(tail);
  // 背鳍 + 腹鳍 + 胸鳍（薄三角片）
  const finGeo = (w, h) => {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -w, 0, 0, -w * 0.6, h, 0], 3));
    fg.computeVertexNormals();
    return fg;
  };
  const dorsal = new THREE.Mesh(finGeo(0.16, 0.1), finMat);
  dorsal.position.set(0.02, 0.1, 0);
  g.add(dorsal);
  const ventral = new THREE.Mesh(finGeo(0.1, -0.07), finMat);
  ventral.position.set(0.05, -0.09, 0);
  g.add(ventral);
  for (const s of [-1, 1]) {
    const pec = new THREE.Mesh(finGeo(0.08, -0.06), finMat);
    pec.position.set(0.14, -0.02, s * 0.05);
    pec.rotation.x = s * 0.9;
    g.add(pec);
  }
  // 眼点（盲鱼退化只剩凹点）
  const eyeMat = new THREE.MeshStandardMaterial({ color: sp === 'blindfish' ? 0x9a8f88 : 0x101214, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(sp === 'blindfish' ? 0.012 : 0.02, 6, 5), eyeMat);
    eye.position.set(0.24, 0.04, s * 0.05);
    g.add(eye);
  }
  if (sp === 'clownfish') {
    const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    for (const x of [0.12, -0.08]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 5, 14), wm); r.rotation.y = Math.PI / 2; r.position.x = x; r.scale.set(1, 1.1, 1); g.add(r); }
  }
  if (sp === 'catfish') {
    body.scale.multiplyScalar(1.5); dorsal.scale.setScalar(1.5); ventral.scale.setScalar(1.5);
    const bm = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    for (const s of [-1, 1]) for (const k of [0, 1]) {
      const pts = [new THREE.Vector3(0.28, -0.02 - k * 0.02, s * 0.05), new THREE.Vector3(0.45 - k * 0.06, -0.06 - k * 0.03, s * (0.1 + k * 0.06))];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), bm));
    }
  }
  g.userData.tail = tail;
  g.userData.mat = mat;
  return g;
}

const FISH_SCALE = { damselfish: 0.55, clownfish: 0.5, parrotfish: 1.5, grouper: 3.2 };
export class Fish {
  constructor(sp, anchor, rng) {
    this.sp = sp;
    this.anchor = anchor.pos.clone();
    this.range = Math.max(1.2, anchor.r * 0.8);
    this.obj = makeFish(sp, rng);
    this.obj.position.copy(anchor.pos);
    if (FISH_SCALE[sp]) this.obj.scale.setScalar(FISH_SCALE[sp]);
    this.center = anchor.pos.clone();
    this.vel = new THREE.Vector3();
    this.phase = rng() * 10;
    this.speed = sp === 'shrimp' ? 0.4 : sp === 'grouper' ? range(rng, 0.12, 0.25) : sp === 'clownfish' ? range(rng, 0.2, 0.4) : range(rng, 0.35, 0.8);
    this.wanderT = 0;
    this.target = this.center.clone();
    this.flee = 0;
  }
  update(dt, ctx) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = range(Math.random, 2, 5);
      this.target.copy(this.center).add(_v.set((Math.random() - 0.5) * this.range * 2, (Math.random() - 0.5) * this.range, (Math.random() - 0.5) * this.range * 2));
    }
    // 避光：洞穴鱼讨厌潜水灯
    if (this.sp === 'cavefish' && ctx?.lightPos) {
      const d = this.obj.position.distanceTo(ctx.lightPos);
      if (d < 4) { this.target.copy(this.obj.position).sub(ctx.lightPos).setLength(this.range).add(this.center); this.flee = 1; }
    }
    const dir = _v.subVectors(this.target, this.obj.position);
    const dist = dir.length();
    if (dist > 0.1) {
      dir.normalize();
      const sp = this.speed * (this.flee ? 2.4 : 1);
      this.vel.lerp(dir.multiplyScalar(sp), 1 - Math.exp(-dt * 2));
    }
    this.flee = Math.max(0, this.flee - dt);
    this.obj.position.addScaledVector(this.vel, dt);
    // 朝向速度方向 + 尾部摆动
    if (this.vel.lengthSq() > 0.01) {
      const yaw = Math.atan2(-this.vel.z, this.vel.x);
      this.obj.rotation.y += (yaw - this.obj.rotation.y) * Math.min(1, dt * 5);
    }
    this.phase += dt * (4 + this.vel.length() * 6);
    this.obj.userData.tail.rotation.y = Math.sin(this.phase) * 0.6;
    this.obj.rotation.z = Math.sin(this.phase * 0.5) * 0.08;
  }
}

// ---------- 虾群 ----------
class ShrimpSwarm {
  constructor(anchor, rng) {
    this.anchor = anchor.pos.clone();
    const n = intRange(rng, 8, 14);
    this.data = [];
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = anchor.pos.clone().add(_v.set((rng() - 0.5) * 2, -anchor.r * 0.4 + rng() * 0.5, (rng() - 0.5) * 2));
      this.data.push({ p, hop: rng() * 3, dir: new THREE.Vector3((rng() - 0.5), 0.3, (rng() - 0.5)).normalize() });
      pos.set([p.x, p.y, p.z], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ map: softSprite(), color: 0xf8f0e8, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false }));
    this.obj = this.pts; // photoable 参考
  }
  update(dt) {
    const pos = this.pts.geometry.attributes.position;
    this.data.forEach((d, i) => {
      d.hop -= dt;
      if (d.hop <= 0) { d.hop = 1.5 + Math.random() * 3; d.dir.set((Math.random() - 0.5), 0.4, (Math.random() - 0.5)).normalize(); }
      d.p.addScaledVector(d.dir, dt * 0.25);
      if (d.p.distanceTo(this.anchor) > 3) d.dir.multiplyScalar(-1);
      pos.setXYZ(i, d.p.x, d.p.y, d.p.z);
    });
    pos.needsUpdate = true;
  }
}

// ---------- 等足虫（地上爬的小甲虫） ----------
// 地面爬行类：等足虫 / 螯虾 / 螺 / 洞螈（kind 决定外形与速度）
function makeCrawler(kind) {
  const g = new THREE.Group();
  const M = (c, r = 0.8, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, emissive: c, emissiveIntensity: e });
  if (kind === 'crayfish') {
    const mat = M(0xe0b48a, 0.6, 0.05);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), mat); body.rotation.z = Math.PI / 2; g.add(body);
    for (const s of [-1, 1]) {
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat); claw.scale.set(1.6, 0.6, 0.9); claw.position.set(0.17, 0, s * 0.05); g.add(claw);
      const an = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.3, 3), mat); an.rotation.z = Math.PI / 2 - s * 0.3; an.position.set(0.28, 0.02, s * 0.04); g.add(an);
    }
  } else if (kind === 'nudibranch') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.07, 4, 8), M(0x8a3cd8, 0.5, 0.25)); b.rotation.z = Math.PI / 2; g.add(b);
    const st = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.07, 3, 6), M(0xff8a2a, 0.5, 0.4)); st.rotation.z = Math.PI / 2; st.position.y = 0.018; g.add(st);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.03, 4), M(0xffe03a, 0.5, 0.4)); h.position.set(0.06, 0.03, s * 0.01); g.add(h); }
  } else if (kind === 'snail') {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M(0xd8c8a8, 0.5)); shell.position.y = 0.025; shell.scale.set(1, 1.1, 0.9); g.add(shell);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), M(0xe8e4d8)); foot.scale.set(2, 0.4, 0.8); foot.position.set(0.02, 0.004, 0); g.add(foot);
  } else if (kind === 'olm') {
    const mat = M(0xf1d8d0, 0.55, 0.08);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.34, 4, 8), mat); body.rotation.z = Math.PI / 2; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), mat); head.scale.set(1.8, 0.7, 0.9); head.position.x = 0.23; g.add(head);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2, 6), mat); tail.rotation.z = Math.PI / 2; tail.position.x = -0.28; tail.scale.set(1, 1, 0.5); g.add(tail);
    const red = M(0xc83c3c, 0.6, 0.2);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.004, 0.05, 3), red); gl.position.set(0.17, 0.02 + k * 0.012, s * 0.035); gl.rotation.x = s * (0.9 + k * 0.2); g.add(gl);
      }
      for (const lx of [0.12, -0.1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, 0.06, 4), mat); leg.position.set(lx, -0.025, s * 0.04); leg.rotation.x = s * 0.9; g.add(leg);
      }
    }
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M(0xe8e4d8)); body.scale.set(2.2, 0.6, 1); g.add(body);
  }
  return g;
}
const CRAWL = { nudibranch: [0.05, 0.3, 0.8], isopod: [0.15, 0.4, 1.2], crayfish: [0.2, 0.5, 1.4], snail: [0.03, 0.15, 0.4], olm: [0.08, 0.5, 1.4] };

export class Isopod {
  constructor(anchor, rng, kind = 'isopod') {
    this.anchor = anchor.pos.clone();
    this.kind = kind;
    this.w = CRAWL[kind][0];
    const g = makeCrawler(kind);
    this.obj = g;
    this.obj.position.copy(anchor.pos);
    if (anchor.floorY != null) this.obj.position.y = anchor.floorY; else this.obj.position.y = anchor.pos.y - anchor.r * 0.45;
    this.a = rng() * 6.28;
    this.r = range(rng, CRAWL[kind][1], CRAWL[kind][2]);
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    this.a += dt * this.w;
    this.obj.position.x = this.anchor.x + Math.cos(this.a) * this.r;
    this.obj.position.z = this.anchor.z + Math.sin(this.a) * this.r;
    this.obj.rotation.y = -this.a;
    if (this.kind === 'olm') this.obj.rotation.y += Math.sin(this.t * 1.5) * 0.25;
  }
}

// ---------- 静态 photoable：藻毯/蕨幕/菌毯/珍珠/化石 ----------
function algaePatch(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2e7a3a, roughness: 0.9, emissive: 0x0a2a10, emissiveIntensity: 0.4 });
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(range(rng, 0.15, 0.45), 7), mat);
    p.position.set((rng() - 0.5) * 1.6, (rng() - 0.5) * 1.2, (rng() - 0.5) * 0.4);
    p.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(p);
  }
  g.position.copy(anchor.pos);
  return g;
}

function fernCurtain(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d4526, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const strips = [];
  for (let i = 0; i < 14; i++) {
    const h = range(rng, 0.4, 1.2);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.045, h, 1, 4), mat);
    p.position.set((rng() - 0.5) * 2.4, -h / 2, (rng() - 0.5) * 2.4);
    p.rotation.y = rng() * 3;
    p.rotation.z = range(rng, -0.15, 0.15);
    g.add(p); strips.push(p);
  }
  g.position.copy(anchor.pos);
  g.userData.strips = strips;
  return g;
}

function bacteriaMat(anchor, rng, color = 0xf0ead8) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, emissive: 0x40382a, emissiveIntensity: 0.25 });
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 0.08, 0.24), 7, 5), mat);
    s.position.set((rng() - 0.5) * 1.8, (rng() - 0.5) * 1.2, (rng() - 0.5) * 0.5);
    s.scale.z = 0.3;
    g.add(s);
  }
  g.position.copy(anchor.pos);
  return g;
}

function pearlCluster(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5efdf, roughness: 0.25, metalness: 0.1 });
  const n = intRange(rng, 6, 12);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 0.03, 0.08), 8, 6), mat);
    const a = rng() * 6.28, rr = rng() * 0.5;
    s.position.set(Math.cos(a) * rr, -0.02 - rng() * 0.04, Math.sin(a) * rr);
    g.add(s);
  }
  g.position.copy(anchor.pos);
  return g;
}

function fossilWall(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(range(rng, 0.06, 0.14), 0.03, 5, 10, Math.PI * 1.5), mat);
    s.position.set((rng() - 0.5) * 1.2, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.3);
    s.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(s);
  }
  g.position.copy(anchor.pos);
  return g;
}

function gypsumFlower(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf6f2e6, roughness: 0.35, emissive: 0x403c34, emissiveIntensity: 0.2 });
  for (let i = 0; i < 16; i++) {
    const h = range(rng, 0.12, 0.3);
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.012, h, 5), mat);
    c.position.set((rng() - 0.5) * 0.5, (rng() - 0.5) * 0.3, 0.02 + h * 0.5);
    c.rotation.set(Math.PI / 2 + (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2, rng() * 3);
    g.add(c);
  }
  g.scale.setScalar(1.8);
  g.position.copy(anchor.pos);
  return g;
}

function flowstoneDrape(anchor, rng) {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe9d9b8 : 0xd8b890, roughness: 0.5 }));
    m.scale.set(range(rng, 0.8, 1.3), 0.16, 0.1);
    m.position.set((rng() - 0.5) * 0.3, 0.9 - i * 0.22, 0.05);
    g.add(m);
  }
  g.position.copy(anchor.pos);
  return g;
}

function boneCluster(anchor, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.75 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, range(rng, 0.3, 0.6), 4, 6), mat);
    b.position.set((rng() - 0.5) * 0.9, 0.03, (rng() - 0.5) * 0.9);
    b.rotation.set(Math.PI / 2, 0, rng() * 3);
    g.add(b);
  }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 7), mat);
  skull.scale.set(1.3, 0.9, 1); skull.position.set(0.1, 0.1, 0.05);
  g.add(skull);
  const dark = new THREE.MeshStandardMaterial({ color: 0x22201c });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), dark); e.position.set(0.22, 0.13, 0.05 + s * 0.06); g.add(e); }
  g.position.copy(anchor.pos);
  return g;
}

// ---------- 填充 ----------
// 静态物种贴墙：wp = cave.wallPoint(锚点, 方向, 嵌入深度)
const _Z = new THREE.Vector3(0, 0, 1);
function attachWall(obj, wp, flat = true) {
  if (!wp) return false;
  obj.position.copy(wp.pos);
  if (flat) obj.quaternion.setFromUnitVectors(_Z, wp.inward);
  return true;
}

export function populateCave(scene, cave, map, uni) {
  const rng = universeRng(map.id, uni.seed + '::creatures');
  const entities = [];
  const photoables = [...cave.photoables.map(p => ({ sp: p.sp, obj: marker(p.pos), r: p.r }))];

  const add = (sp, anchor) => {
    let e = null;
    switch (sp) {
      case 'cavefish': case 'blindfish': case 'catfish': case 'trout': {
        const n = sp === 'catfish' ? 1 : intRange(rng, 2, 4);
        for (let i = 0; i < n; i++) { const f = new Fish(sp, anchor, rng); scene.add(f.obj); entities.push(f); photoables.push({ sp, obj: f.obj, r: 0.6 }); }
        return;
      }
      case 'shrimp': { const s = new ShrimpSwarm(anchor, rng); scene.add(s.pts); entities.push(s); photoables.push({ sp, obj: s.pts, r: 1.2 }); return; }
      case 'isopod': { const wp = cave.wallPoint(anchor.pos, _v.set(0, -1, 0), -0.03); if (wp) anchor.floorY = wp.pos.y; const c = new Isopod(anchor, rng); scene.add(c.obj); entities.push(c); photoables.push({ sp, obj: c.obj, r: 0.4 }); return; }
      case 'crayfish': case 'snail': case 'olm': {
        const wp = cave.wallPoint(anchor.pos, _v.set(0, -1, 0), -0.03); if (wp) anchor.floorY = wp.pos.y;
        const c = new Isopod(anchor, rng, sp); scene.add(c.obj); entities.push(c); photoables.push({ sp, obj: c.obj, r: sp === 'snail' ? 0.3 : 0.6 }); return;
      }
      case 'algae': { e = { obj: algaePatch(anchor, rng) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), range(rng,-0.3,1), range(rng,-1,1)), 0.04)); break; }
      case 'fern': e = { obj: fernCurtain(anchor, rng), update(dt, ctx) { const t = ctx.time; this.obj.userData.strips.forEach((s, i) => { s.rotation.x = Math.sin(t * 0.8 + i) * 0.12; }); } };
        { const wp = cave.wallPoint(anchor.pos, _v.set(range(rng,-0.5,0.5), 1, range(rng,-0.5,0.5)), 0.15); if (wp) e.obj.position.copy(wp.pos); }
        break;
      case 'bacteria': { e = { obj: bacteriaMat(anchor, rng) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), -1, range(rng,-1,1)), 0.05)); break; }
      case 'ironbac': { e = { obj: bacteriaMat(anchor, rng, 0xc8742a) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), range(rng,-1,0), range(rng,-1,1)), 0.05)); break; }
      case 'gypsum': { e = { obj: gypsumFlower(anchor, rng) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), range(rng,0,1), range(rng,-1,1)), 0.04)); break; }
      case 'flowstone': { e = { obj: flowstoneDrape(anchor, rng) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), 0, range(rng,-1,1)), 0.1)); break; }
      case 'bones': { e = { obj: boneCluster(anchor, rng) }; const wp = cave.wallPoint(anchor.pos, _v.set(0, -1, 0), -0.02); if (wp) e.obj.position.copy(wp.pos); break; }
      case 'pearl': { e = { obj: pearlCluster(anchor, rng) }; const wp = cave.wallPoint(anchor.pos, _v.set(range(rng,-0.4,0.4), -1, range(rng,-0.4,0.4)), -0.02); if (wp) e.obj.position.copy(wp.pos); break; }
      case 'fossil': { e = { obj: fossilWall(anchor, rng) }; attachWall(e.obj, cave.wallPoint(anchor.pos, _v.set(range(rng,-1,1), range(rng,-0.5,0.3), range(rng,-1,1)), 0.06)); break; }
      default: return;
    }
    scene.add(e.obj);
    entities.push(e);
    photoables.push({ sp, obj: e.obj, r: 1.2 });
  };

  // 宇宙布点 -> 世界锚点（路径+节点号 -> spine 位置）
  for (const pl of uni.placements) {
    let anchor = null;
    if (pl.path === 'main') {
      const node = cave.nodes[pl.at];
      if (node) anchor = { pos: node.pos.clone(), r: node.r };
    } else {
      const bIdx = parseInt(pl.path.slice(1));
      const b = (map.branches || [])[bIdx];
      if (b && uni.branches[bIdx]?.open !== false) {
        const p = b.pts[Math.min(pl.at, b.pts.length - 1)];
        anchor = { pos: new THREE.Vector3(...p), r: b.r };
      }
    }
    if (anchor && pl.off) anchor.pos.add(_v.set(...pl.off));
    if (anchor) add(pl.sp, anchor);
  }

  // 化石壁彩蛋：在深处加一面化石墙
  if (uni.eggs.includes('fossil_wall')) {
    const deep = cave.nodes[cave.nodes.length - 1];
    for (let i = 0; i < 3; i++) {
      const a = { pos: deep.pos.clone().add(_v.set(rng() * 4 - 2, rng() * 2 - 1, rng() * 4 - 2)), r: 1.5 };
      const e = { obj: fossilWall(a, rng) };
      attachWall(e.obj, cave.wallPoint(a.pos, _v.set(rng() * 2 - 1, rng() * 0.8 - 0.3, rng() * 2 - 1), 0.06));
      scene.add(e.obj); entities.push(e);
      photoables.push({ sp: 'fossil', obj: e.obj, r: 1.2 });
    }
  }

  return { entities, photoables, update(dt, ctx) { for (const e of entities) e.update?.(dt, ctx); } };
}

function marker(pos) { const o = new THREE.Object3D(); o.position.copy(pos); return o; }
