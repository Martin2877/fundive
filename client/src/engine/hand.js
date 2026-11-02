// 手：可弯曲五指的右手模型——第一人称（挂相机伸到面镜前）与第三人称潜水员共用。
// makeHand 建手，poseHand 摆手势； DiveHand 是第一人称手臂（平时藏在画面外）。
import * as THREE from 'three';

const gloveMat = new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.85 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0x22323c, roughness: 0.7 });
const cuffMat = new THREE.MeshStandardMaterial({ color: 0x101a20, roughness: 0.9 });
const fpGloveMat = new THREE.MeshStandardMaterial({ color: 0x0d1319, roughness: 0.95 }); // 第一人称手套更深色——灯照下剪影才读得出指型

// 手型表：f 四指卷曲(0伸 ~2 全握)，d 末节的附加比例，th 拇指卷曲，thIn 拇指内收，thZ 拇指外张角
const POSES = {
  fist:     { f: [1.75, 1.85, 1.85, 1.7], th: 1.25, thIn: 0.15, thZ: 0.95, spread: 0.5 },
  grip:     { f: [0.95, 1.1, 1.1, 0.95],  th: 0.85, thIn: 0.2,  thZ: 0.85, spread: 0.5 },
  palm:     { f: [0.05, 0.05, 0.05, 0.05], th: 0.2,  thIn: 0,    thZ: 0.95, spread: 1 },
  point:    { f: [0.05, 1.9, 1.9, 1.75],  th: 1.05, thIn: 0.25, thZ: 0.85, spread: 0.6 },
  thumbsup: { f: [1.85, 1.9, 1.9, 1.75],  th: 0.05, thIn: 0,    thZ: 0.3,  spread: 0.5 },
  ok:       { f: [1.45, 0.08, 0.1, 0.12], th: 1.3,  thIn: 1.3,  thZ: 0.4,  spread: 1 },
  pinch:    { f: [1.0, 1.55, 1.65, 1.55], th: 1.0,  thIn: 0.4,  thZ: 0.8,  spread: 0.5 },
  press:    { f: [0.08, 0.08, 1.7, 1.6],  th: 0.9,  thIn: 0.1,  thZ: 0.85, spread: 0.2 },
};

// 手势名 -> 手型（水下通用手势：OK=ok圈、上升=竖拇指、求助=挥掌、指=食指、灯=握灯）
export const GESTURE_POSE = { ok: 'ok', up: 'thumbsup', help: 'palm', line: 'point', light: 'grip' };

// 建一只右手。局部坐标：掌心朝 +z，手指朝 +y，拇指在 -x 侧。
// 返回 group；group.userData.fingers = [拇指, 食,中,无名,小]（每根 {k 指根, d 末节}）。
export function makeHand({ scale = 1, mat = skinMat } = {}) {
  const g = new THREE.Group();
  // 掌：压扁的椭球（圆角比盒子自然）+ 拇指根部的鱼际鼓包
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), mat);
  palm.scale.set(0.92, 1.18, 0.42); palm.position.set(0, 0.045, 0);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat);
  heel.scale.set(1, 0.9, 0.55); heel.position.set(0, 0.005, 0.004);
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mat);
  thenar.scale.set(0.8, 1.1, 0.5); thenar.position.set(-0.032, 0.028, 0.012);
  g.add(palm, heel, thenar);

  const fingers = [];
  const fingerAt = (x, y, len, r) => {
    const k = new THREE.Group(); k.position.set(x, y, 0.005);
    const p1 = len * 0.58, p2 = len * 0.42;
    const m1 = new THREE.Mesh(new THREE.CapsuleGeometry(r, p1, 3, 7), mat);
    m1.position.y = p1 / 2;
    const d = new THREE.Group(); d.position.y = p1;
    const m2 = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.88, p2, 3, 7), mat);
    m2.position.y = p2 / 2;
    d.add(m2); k.add(m1, d); g.add(k);
    return { k, d };
  };
  // 拇指：根部在掌侧 -x 下方，先外张（略长略粗，竖拇指才读得出）
  const thumb = new THREE.Group(); thumb.position.set(-0.048, 0.005, 0.01);
  const thBase = new THREE.Group(); thBase.rotation.set(0.15, 0, 0.95);
  const thK = fingerAt(0, 0, 0.062, 0.015);
  thBase.add(thK.k); thK.k.position.set(0, 0, 0);
  thumb.add(thBase); g.add(thumb);
  fingers.push({ k: thK.k, d: thK.d, base: thumb, inG: thBase, isThumb: true });

  // 食、中、无名、小（由 -x 到 +x）
  const defs = [[-0.031, 0.072, 0.013], [-0.011, 0.078, 0.014], [0.009, 0.074, 0.013], [0.029, 0.066, 0.011]];
  for (const [x, y, r] of defs) fingers.push(fingerAt(x, y, 0.068, r));
  g.userData.fingers = fingers;
  g.scale.setScalar(scale);
  return g;
}

// 摆手型：pose 名见 POSES。fold = 末节附加卷曲系数。
export function poseHand(hand, name, fold = 0.85) {
  const p = POSES[name] || POSES.fist;
  const fs = hand.userData.fingers;
  // 拇指
  const th = fs[0];
  th.base.rotation.y = -p.thIn * 0.9;
  th.inG.rotation.z = p.thZ ?? 0.95;
  th.k.rotation.x = p.th * 0.55;
  th.d.rotation.x = p.th * 0.9;
  // 四指
  for (let i = 0; i < 4; i++) {
    const c = p.f[i];
    fs[i + 1].k.rotation.x = c;
    fs[i + 1].d.rotation.x = c * fold;
    fs[i + 1].k.rotation.z = (i - 1.5) * 0.07 * (p.spread ?? 0.5);
  }
}

// ———————— 第一人称手臂 ————————
export class DiveHand {
  constructor(camera) {
    this.g = new THREE.Group();
    camera.add(this.g);
    this.cam = camera;

    // 前臂：从手腕连到画外右下方（你低头看自己抬起的右臂），袖口收口
    this.armG = new THREE.Group();
    const ARM_DIR = new THREE.Vector3(0.45, -0.62, 0.64).normalize();
    this.armG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ARM_DIR);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.52, 4, 10), gloveMat);
    arm.position.y = 0.32;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.062, 0.08, 10), cuffMat);
    cuff.position.y = 0.055;
    this.armG.add(arm, cuff);
    this.g.add(this.armG);
    // 手腕 -> 手
    this.wrist = new THREE.Group();
    this.g.add(this.wrist);
    this.hand = makeHand({ scale: 1.12, mat: fpGloveMat });
    this.wrist.add(this.hand);

    // 手势"灯"：握住的小手电 + 点光（仅在 light 手势时亮起并画圈）
    this.torch = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.17, 8), cuffMat);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }));
    tl.position.y = 0.09;
    this.torchLight = new THREE.PointLight(0xffe9b0, 0, 5, 1.5);
    this.torchLight.position.y = 0.12;
    this.torch.add(tb, tl, this.torchLight);
    this.torch.position.set(0.005, 0.06, -0.04); // 探出拳外，灯头朝前
    this.torch.rotation.x = -1.5;
    this.torch.visible = false;
    this.wrist.add(this.torch);

    this._t = new THREE.Vector3();
    this._r = new THREE.Euler();
    this._pose = 'fist';
    this._until = 0;
    this._wob = 0;
    this._gest = 'fist';
    this.g.visible = false;
    this.set('fist', 0, 0, 0, true);
  }

  // pose: POSES 名  x,y,z: 相机空间目标位（面镜前） rx,ry,rz: 手腕姿态
  set(pose, x, y, z, instant = false, rot = [0, 0, 0]) {
    this._pose = pose;
    this._t.set(x, y, z);
    this._r.set(rot[0], rot[1], rot[2]);
    if (instant) { this.g.position.copy(this._t); this.wrist.rotation.copy(this._r); }
    poseHand(this.hand, pose);
  }

  // 手势/动作名 -> 手型 + 摆位 + 腕姿（伸到面镜前，掌心对着自己/对面）
  show(g, dur = 1.3) {
    this._gest = g;
    // [pose, x, y, z, rotX, rotY, rotZ]：位置在面镜前偏右下，留出视野中心
    const P = {
      ok:    ['ok',        0.14, -0.07, -0.58, -0.15, -0.45, 0],  // 3/4 视角让 OK 圈的豁口可见
      up:    ['thumbsup',  0.13,  0.02, -0.58, -0.05, 0.15, -0.8], // 滚腕让拇指朝天
      help:  ['palm',      0.15, -0.01, -0.58, -0.1,  0, 0],
      line:  ['point',     0.09, -0.05, -0.6,  -0.95, 0.28, 0],  // 食指指向左前方（引绳方向）
      light: ['grip',      0.13, -0.05, -0.58, -0.35, 0, 0],
      hold:  ['press',     0.0,   0.26, -0.46, -2.6,  0, 0],    // 两指压面镜上沿
      nose:  ['pinch',     0.02,  0.05, -0.42, -0.5,  0, 0],    // 捏鼻
      mask:  ['palm',      0.3,  -0.3,  -0.5,  -0.3,  0.5, 0],  // 手拿面镜在侧
      bcd:   ['grip',     -0.2,  -0.32, -0.48, -0.9,  0.5, 0],  // 左胸充气阀
      dump:  ['fist',      0.3,   0.3,  -0.55, -0.3,  0, 0],    // 拉泄气阀
      reg:   ['grip',      0.13, -0.2,  -0.46, -0.7,  0, 0],    // 嘴边二级头
    }[g] || ['fist', 0.15, -0.1, -0.55, 0, 0, 0];
    this.set(P[0], P[1], P[2], P[3], false, P.slice(4));
    this.g.visible = true;
    this.torch.visible = g === 'light';
    this._until = dur > 0 ? performance.now() / 1000 + dur : Infinity;
    if (g === 'help') this._wob = 1;
    if (g === 'light') this._wob = 1.4;
  }

  update(dt) {
    const now = performance.now() / 1000;
    const active = this.g.visible && now < this._until;
    if (!active) {
      // 收回画面外
      if (this.g.visible) {
        this.torch.visible = false; this.torchLight.intensity = 0;
        this._t.set(0.35, -0.55, -0.2);
        this.g.position.lerp(this._t, Math.min(1, dt * 5));
        if (this.g.position.y < -0.5) this.g.visible = false;
      }
      return;
    }
    // 缓动到位 + 轻微水下漂浮感；help 左右挥、light 画小圈
    this._wob = Math.max(0, this._wob - dt * 0.55);
    let shake = Math.sin(now * 2.2) * 0.006, wx = 0, wz = 0;
    if (this._gest === 'help' && this._wob > 0) { shake = Math.sin(now * 22) * 0.045 * this._wob; wz = Math.sin(now * 22) * 0.35 * this._wob; }
    if (this._gest === 'light' && this._wob > 0) { shake = Math.sin(now * 7) * 0.05 * this._wob; wx = Math.cos(now * 7) * 0.4 * this._wob; }
    this.g.position.lerp(_v.set(this._t.x + shake, this._t.y + Math.sin(now * 1.8) * 0.008, this._t.z), Math.min(1, dt * 6));
    this.wrist.rotation.x += (this._r.x + wx - this.wrist.rotation.x) * Math.min(1, dt * 6);
    this.wrist.rotation.y += (this._r.y - this.wrist.rotation.y) * Math.min(1, dt * 6);
    this.wrist.rotation.z += (this._r.z + wz - this.wrist.rotation.z) * Math.min(1, dt * 6);
    // 灯手势：手电随画圈明暗
    if (this.torch.visible) this.torchLight.intensity = 1.6 + Math.sin(now * 9) * 1.2;
  }
}

const _v = new THREE.Vector3();
