// 洞穴生物与地质 photoable 实体：全部由代码生成，无需外部模型。
// 鱼类有简单巡游/避光行为；静态物种注册为拍摄目标。
import * as THREE from 'three';
import { universeRng, chance, range, intRange } from '@fundive/shared/rng.js';
import { fbm3 } from './noise.js';
import { softSprite } from './water.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ---------- 程序化鱼：参数化体型 —— 每种鱼有自己的轮廓、尾型、鳍组与花纹 ----------
// FISH_BODY[sp]: c体色 h体高比 w体宽比 len体长 tail尾型 dorsal背鳍 eye眼径
//   特殊件: beak喙 mouth大口 mottle斑块 spots斑点 gills鳃裂 barbels须 clown白环
//   horn额隆 adipose脂鳍 snout吻锥 belly腹色 veil无眼鳍纱 headW头宽
const FISH_BODY = {
  cavefish:   { c: 0xe6cabc, len: 0.34, h: 0.55, w: 0.30, tail: 'round', dorsal: 'short', eye: 0.009, horn: true },
  blindfish:  { c: 0xecdeda, len: 0.30, h: 0.60, w: 0.28, tail: 'round', dorsal: 'none', eye: 0, veil: true },
  catfish:    { c: 0x3f4447, len: 0.55, h: 0.42, w: 0.55, tail: 'square', dorsal: 'short', eye: 0.016, barbels: 4, headW: 1.3 },
  trout:      { c: 0x8a9a8a, len: 0.50, h: 0.44, w: 0.33, tail: 'fork', dorsal: 'short', eye: 0.020, adipose: true, spots: 0x2e2c24 },
  damselfish: { c: 0x2f7fe0, len: 0.30, h: 0.95, w: 0.30, tail: 'fork', dorsal: 'long', eye: 0.024 },
  clownfish:  { c: 0xff7a1a, len: 0.28, h: 0.74, w: 0.40, tail: 'round', dorsal: 'short', eye: 0.022, clown: true },
  parrotfish: { c: 0x2fb8a0, len: 0.55, h: 0.62, w: 0.44, tail: 'lunate', dorsal: 'long', eye: 0.020, beak: 0xefe8d0, edge: 0xe04a8a },
  grouper:    { c: 0x8a6a4a, len: 0.62, h: 0.80, w: 0.60, tail: 'round', dorsal: 'long', eye: 0.024, mouth: 0.085, mottle: 0x54432e },
  shark:      { c: 0x7d8a90, len: 0.95, h: 0.38, w: 0.34, tail: 'hetero', dorsal: 'tall', eye: 0.017, snout: 0.16, pec: 0.34, gills: 4, belly: 0xd6dcd8 },
  whitefish:  { c: 0xc9d4d6, len: 0.46, h: 0.44, w: 0.30, tail: 'fork', dorsal: 'short', eye: 0.020 },
};
const _fTri = (pts) => {
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  fg.computeVertexNormals();
  return fg;
};
export function makeFish(sp, rng) {
  const P = FISH_BODY[sp] || { c: 0xcfc8b8, len: 0.4, h: 0.6, w: 0.36, tail: 'round', dorsal: 'short', eye: 0.02 };
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: P.c, roughness: 0.5, metalness: 0.05 });
  const finMat = new THREE.MeshStandardMaterial({ color: P.c, roughness: 0.7, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const L = P.len / 2;
  // 鱼体：球体变形——h/w 比例决定轮廓（雀鲷高扁 / 鲨鱼圆筒 / 鲶鱼头宽体扁），尾柄渐细，背部微弓
  const bg = new THREE.SphereGeometry(0.16, 22, 14);
  const pa = bg.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const u = x / 0.16;                                     // -1尾端 .. +1头端
    const tailK = u < 0.3 ? Math.max(0.14, 1 - (0.3 - u) * 0.85) : 1;
    const headK = u > 0.55 && P.headW ? P.headW : 1;
    y *= P.h * tailK * (u < 0 ? 1 : 1 + 0.12 * (1 - u));    // 腹部略鼓
    z *= P.w * tailK * headK;
    y += u < 0 ? -u * 0.05 : u * u * 0.06;                  // 背部弓线
    pa.setXYZ(i, x * (L / 0.16) * (P.snout && u > 0.7 ? 1 + P.snout : 1), y, z);
  }
  bg.computeVertexNormals();
  const body = new THREE.Mesh(bg, mat);
  g.add(body);
  if (P.belly) {
    const bl = new THREE.Mesh(bg.clone(), new THREE.MeshStandardMaterial({ color: P.belly, roughness: 0.55 }));
    bl.scale.set(0.985, 0.55, 0.985); bl.position.y = -0.02; g.add(bl);
  }
  // —— 尾鳍（Group，Fish.update 摆动 rotation.y） ——
  const tailG = new THREE.Group();
  const tx = -L * 0.92, ts = L * 0.55;
  if (P.tail === 'fork') {
    tailG.add(new THREE.Mesh(_fTri([tx, 0, 0, tx - ts, ts * 0.9, 0, tx - ts * 0.72, 0, 0]), finMat));
    tailG.add(new THREE.Mesh(_fTri([tx, 0, 0, tx - ts, -ts * 0.9, 0, tx - ts * 0.72, 0, 0]), finMat));
  } else if (P.tail === 'lunate') {   // 新月尾：窄长后掠
    tailG.add(new THREE.Mesh(_fTri([tx, 0, 0, tx - ts * 1.15, ts * 0.85, 0, tx - ts * 0.8, ts * 0.12, 0]), finMat));
    tailG.add(new THREE.Mesh(_fTri([tx, 0, 0, tx - ts * 1.15, -ts * 0.85, 0, tx - ts * 0.8, -ts * 0.12, 0]), finMat));
  } else if (P.tail === 'hetero') {   // 歪形尾：上叶狭长、下叶短小——鲨鱼名片
    tailG.add(new THREE.Mesh(_fTri([tx, 0.01, 0, tx - ts * 1.7, ts * 1.15, 0, tx - ts * 0.9, ts * 0.1, 0]), finMat));
    tailG.add(new THREE.Mesh(_fTri([tx, -0.01, 0, tx - ts * 0.7, -ts * 0.45, 0, tx - ts * 0.45, -ts * 0.05, 0]), finMat));
  } else if (P.tail === 'square') {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(ts * 0.5, ts * 0.8), finMat);
    t.position.set(tx - ts * 0.25, 0, 0); t.rotation.y = Math.PI / 2; tailG.add(t);
  } else {                            // round：椭圆扇尾
    const t = new THREE.Mesh(new THREE.CircleGeometry(ts * 0.62, 10), finMat);
    t.scale.set(0.7, 1.1, 1); t.position.set(tx - ts * 0.28, 0, 0); t.rotation.y = Math.PI / 2; tailG.add(t);
  }
  g.add(tailG);
  // —— 背鳍 ——
  const dk = P.h * 0.16;
  if (P.dorsal === 'tall') {
    const d = new THREE.Mesh(_fTri([L * 0.25, dk * 0.8, 0, -L * 0.15, dk * 0.8, 0, -L * 0.05, dk * 2.6, 0]), finMat);
    g.add(d);
  } else if (P.dorsal === 'long') {
    for (let k = 0; k < 3; k++) {
      const d = new THREE.Mesh(_fTri([L * 0.3 - k * L * 0.24, dk * 0.8, 0, L * 0.1 - k * L * 0.24, dk * 0.8, 0, L * 0.16 - k * L * 0.24, dk * (1.7 - k * 0.3), 0]), finMat);
      g.add(d);
    }
  } else if (P.dorsal === 'short') {
    g.add(new THREE.Mesh(_fTri([L * 0.15, dk * 0.8, 0, -L * 0.1, dk * 0.8, 0, 0, dk * 1.9, 0]), finMat));
  }
  if (P.adipose) {   // 鳟鱼的标志：背鳍与尾鳍之间的小脂鳍
    g.add(new THREE.Mesh(_fTri([-L * 0.55, dk * 0.75, 0, -L * 0.72, dk * 0.75, 0, -L * 0.66, dk * 1.15, 0]), finMat));
  }
  // —— 胸鳍/腹鳍 ——
  const pecLen = P.pec || L * 0.28;
  for (const s of [-1, 1]) {
    const pec = new THREE.Mesh(_fTri([0, 0, 0, -pecLen, -pecLen * 0.35, 0, -pecLen * 0.55, -pecLen * 0.55, 0]), finMat);
    pec.position.set(L * 0.35, -dk * 0.3, s * P.w * 0.16);
    pec.rotation.x = s * (P.pec ? 0.5 : 0.95);
    g.add(pec);
  }
  if (!P.pec) {   // 非鲨鱼的腹鳍
    const v = new THREE.Mesh(_fTri([0, 0, 0, -L * 0.18, 0, 0, -L * 0.12, -dk * 1.1, 0]), finMat);
    v.position.set(L * 0.2, -dk * 0.9, 0); g.add(v);
  }
  // —— 眼（盲鱼 eye=0 只剩皮下凹点） ——
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.004, P.eye || 0.02), 6, 5), eyeMat);
    eye.position.set(L * 0.78, dk * 0.35, s * P.w * 0.16);
    g.add(eye);
  }
  // —— 种别特征 ——
  const R = (n, a, b) => a + ((Math.sin(n * 127.3 + 45.7) + 1) / 2) * (b - a);   // 稳定伪随机，不耗 rng
  if (P.clown) {
    const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const bm = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.6 });
    for (const [x, rr] of [[L * 0.52, 0.062], [0, 0.075], [-L * 0.6, 0.05]]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.016, 5, 16), wm);
      r.rotation.y = Math.PI / 2; r.position.x = x; r.scale.set(1, 1.25, 0.9); g.add(r);
      const e = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.008, 0.006, 4, 16), bm);
      e.rotation.y = Math.PI / 2; e.position.x = x - 0.016; e.scale.copy(r.scale); g.add(e);
    }
  }
  if (P.beak) {
    const bk = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.05, 6), new THREE.MeshStandardMaterial({ color: P.beak, roughness: 0.4 }));
    bk.rotation.z = -Math.PI / 2; bk.position.set(L * 0.99, -0.01, 0); g.add(bk);
  }
  if (P.mouth) {
    const mo = new THREE.Mesh(new THREE.SphereGeometry(P.mouth, 8, 6), new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 }));
    mo.scale.set(0.5, 0.5, 0.9); mo.position.set(L * 0.86, -P.mouth * 0.7, 0); g.add(mo);
  }
  if (P.mottle) {
    const mm = new THREE.MeshStandardMaterial({ color: P.mottle, roughness: 0.8 });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(R(i, 0.02, 0.05), 6, 5), mm);
      const a = R(i + 20, 0, 6.28), u = R(i + 40, -0.5, 0.8);
      s.position.set(u * L * 0.8, dk * 0.5 * Math.cos(a * 2), Math.sin(a) * P.w * 0.16 * 0.96);
      s.scale.z = 0.3; g.add(s);
    }
  }
  if (P.spots) {
    const sm = new THREE.MeshStandardMaterial({ color: P.spots, roughness: 0.8 });
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), sm);
      s.position.set(R(i, -L * 0.6, L * 0.55), R(i + 30, 0, dk * 1.4), (i % 2 ? 1 : -1) * P.w * 0.16 * 0.98);
      s.scale.z = 0.3; g.add(s);
    }
  }
  if (P.gills) {
    const gm = new THREE.MeshStandardMaterial({ color: 0x3a4045, roughness: 0.8 });
    for (const s of [-1, 1]) for (let k = 0; k < P.gills; k++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.008, dk * 1.2, 0.004), gm);
      sl.position.set(L * 0.5 - k * 0.03, 0, s * P.w * 0.163); g.add(sl);
    }
  }
  if (P.barbels) {
    const bm = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    for (const s of [-1, 1]) for (let k = 0; k < P.barbels; k++) {
      const pts = [new THREE.Vector3(L * 0.82, -dk * 0.2 - k * 0.015, s * 0.04),
        new THREE.Vector3(L * (0.9 + k * 0.08), -dk * (0.9 + k * 0.25), s * (0.05 + k * 0.05))];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), bm));
    }
  }
  if (P.horn) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), mat);
    h.position.set(L * 0.62, dk * 1.15, 0); h.scale.set(1.4, 0.8, 0.8); g.add(h);
  }
  if (P.veil) {   // 盲鱼：鳍拉长成纱，身体半透明
    mat.transparent = true; mat.opacity = 0.82;
    finMat.opacity = 0.5;
    tailG.children.forEach(t => t.scale.setScalar(1.5));
  }
  g.userData.tail = tailG;
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
    // 个人空间：不管什么鱼，都不该贴到潜水员脸前（灯会把贴脸的鱼打成一团光斑）
    if (ctx?.lightPos) {
      const d2 = this.obj.position.distanceToSquared(ctx.lightPos);
      if (d2 < 3.24) { _v2.subVectors(this.obj.position, ctx.lightPos).setLength(2.6); this.target.copy(this.obj.position).add(_v2); this.flee = 1; }
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
    // 等足虫：一节节背甲拼出的潮虫，七对细腿，尾端两根尾须
    const mat = M(0xe8e4d8, 0.7);
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.042 - Math.abs(i - 3.5) * 0.005, 8, 6), mat);
      seg.scale.set(0.5, 0.55, 1); seg.position.x = (i - 3.5) * 0.036; g.add(seg);
      if (i > 0 && i < 7) for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.002, 0.045, 3), mat);
        leg.position.set((i - 3.5) * 0.036, -0.022, s * 0.04); leg.rotation.x = s * 1.15; g.add(leg);
      }
    }
    for (const s of [-1, 1]) {
      const u = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.001, 0.055, 3), mat);
      u.position.set(-0.19, 0, s * 0.025); u.rotation.z = Math.PI / 2 - 0.5; u.rotation.y = s * 0.4; g.add(u);
    }
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
