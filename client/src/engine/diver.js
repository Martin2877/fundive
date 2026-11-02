// 潜水员模型：AI 潜伴、联机队友、被困者、体感小人共用。
// 水平俯卧姿态 + 双瓶/CCR + 脚蹼踢动 + 手持潜水灯（真实 SpotLight）+ 右臂可打手势。
import * as THREE from 'three';
import { makeHand, poseHand, GESTURE_POSE } from './hand.js';

export function makeDiver({ suit = 0x1c2733, trim = 0x7fe9ea, name = null, lightColor = 0xfff2d8, victim = false, sidemount = false, arm = false } = {}) {
  const g = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xcaa582, roughness: 0.8 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a9094, roughness: 0.4, metalness: 0.6 });

  // 身体（俯卧，沿 -z 头前脚后）
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.55, 4, 8), suitMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  // 头 + 头套 + 面镜（含裙边与镜带）
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skinMat);
  head.position.set(0, 0.05, -0.45);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.148, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), suitMat);
  hood.position.copy(head.position).add(new THREE.Vector3(0, 0.012, 0.012));
  const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }));
  mask.position.set(0, 0.08, -0.56);
  const maskLens = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.012), new THREE.MeshStandardMaterial({ color: 0x9adfe0, roughness: 0.1, metalness: 0.2 }));
  maskLens.position.set(0, 0, -0.032);
  mask.add(maskLens);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.014, 5, 14), rubberMat);
  strap.rotation.y = Math.PI / 2;
  strap.position.copy(head.position).add(new THREE.Vector3(0, 0.03, -0.02));
  strap.scale.set(1, 1, 0.72);
  // 二级头（嘴边）+ 呼吸管一小段
  const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.07, 8), rubberMat);
  reg.rotation.z = Math.PI / 2; reg.rotation.y = 0.5;
  reg.position.set(0.045, -0.01, -0.56);
  g.add(head, hood, mask, strap, reg);

  // 气瓶：背挂双瓶 or 侧挂（战术配置）+ 瓶阀/瓶头
  const tankGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8);
  const valveGeo = new THREE.CylinderGeometry(0.024, 0.03, 0.07, 6);
  const knobGeo = new THREE.TorusGeometry(0.028, 0.008, 5, 10);
  const tanks = [];
  for (const s of sidemount ? [-0.24, 0.24] : [-0.09, 0.09]) {
    const tank = new THREE.Mesh(tankGeo, metalMat);
    tank.rotation.x = Math.PI / 2;
    const valve = new THREE.Mesh(valveGeo, metalMat);
    const knob = new THREE.Mesh(knobGeo, rubberMat);
    if (sidemount) {
      tank.position.set(s, -0.1, 0.12); tank.rotation.z = s > 0 ? -0.12 : 0.12;
      valve.position.set(s * 0.92, -0.1, -0.16); valve.rotation.x = Math.PI / 2;
      knob.position.set(s * 0.92, -0.04, -0.16);
    } else {
      tank.position.set(s, 0.2, 0.05);
      valve.position.set(s, 0.3, -0.2); valve.rotation.x = 0.9;
      knob.position.set(s + 0.055, 0.3, -0.19); knob.rotation.y = Math.PI / 2;
    }
    g.add(tank, valve, knob); tanks.push(tank);
  }

  // 腿 + 脚套 + 脚蹼（前宽后窄梯形叶 + 后跟带）
  const fins = [];
  const finGeo = () => {
    const fg = new THREE.BufferGeometry();
    const w0 = 0.07, w1 = 0.115, l = 0.5, t = 0.008;
    const v = [
      -w0, 0, 0, w0, 0, 0, w1, 0, l, -w1, 0, l,
      -w0, -t, 0, w0, -t, 0, w1, -t, l, -w1, -t, l,
    ];
    const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6];
    fg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    return fg;
  };
  for (const s of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.35, 3, 6), suitMat);
    leg.rotation.x = Math.PI / 2;
    leg.position.set(s, -0.02, 0.5);
    g.add(leg);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.16), rubberMat);
    pocket.position.set(s, -0.02, 0.68);
    const heel = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), rubberMat);
    heel.rotation.x = Math.PI / 2; heel.position.set(s, -0.02, 0.66);
    const fin = new THREE.Mesh(finGeo(), trimMat);
    fin.position.set(s, -0.02, 0.68);
    g.add(pocket, heel, fin);
    fins.push(fin);
  }

  // BCD 背飞：气瓶外的环形气囊 + 肩部/腰部绑带 + 卡扣
  const bcdMat = new THREE.MeshStandardMaterial({ color: 0x2a343c, roughness: 0.85 });
  const bcd = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.3, 4, 10), bcdMat);
  bcd.rotation.x = Math.PI / 2;
  bcd.position.set(0, 0.13, 0.05);
  bcd.scale.set(1, 0.55, 1);
  g.add(bcd);
  for (const s of [-0.13, 0.13]) {
    const strapS = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.4), rubberMat);
    strapS.position.set(s, 0.16, -0.1); strapS.rotation.x = 0.28;
    g.add(strapS);
  }
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 5, 12), rubberMat);
  waist.rotation.x = Math.PI / 2; waist.scale.set(1, 1, 1.4);
  waist.position.set(0, 0.02, 0.2);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.02), metalMat);
  buckle.position.set(0, -0.14, -0.04);
  g.add(waist, buckle);
  // 左胸充气阀（LPI）+ 泄气阀拉绳小球
  const inflator = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.035), rubberMat);
  inflator.position.set(-0.16, -0.02, -0.24); inflator.rotation.z = 0.3;
  const infBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0x3a86c8, roughness: 0.5 }));
  infBtn.rotation.x = Math.PI / 2; infBtn.position.set(-0.16, 0.02, -0.26);
  const dumpBall = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), trimMat);
  dumpBall.position.set(0.17, -0.16, 0.1);
  g.add(inflator, infBtn, dumpBall);

  // 管线：瓶头 -> 二级头（主） + 备用二级头（黄，挂颈下）+ SPG 残压表（左胯）
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.09, 0.24, -0.1), new THREE.Vector3(0.2, 0.3, -0.25), new THREE.Vector3(0.14, 0.12, -0.42),
  ]), 10, 0.012, 5), rubberMat);
  const octo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.09, 0.24, -0.1), new THREE.Vector3(-0.24, 0.22, -0.3), new THREE.Vector3(-0.1, -0.05, -0.38),
  ]), 10, 0.011, 5), new THREE.MeshStandardMaterial({ color: 0xc8a028, roughness: 0.85 }));
  const octoReg = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.06, 8), new THREE.MeshStandardMaterial({ color: 0xc8a028, roughness: 0.7 }));
  octoReg.position.set(-0.1, -0.06, -0.38); octoReg.rotation.z = 1.2;
  const spgHose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, 0.26, -0.08), new THREE.Vector3(-0.15, 0.3, 0.05), new THREE.Vector3(-0.2, 0.05, 0.18),
  ]), 10, 0.008, 5), rubberMat);
  const spg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x11171c, roughness: 0.4, metalness: 0.3 }));
  spg.rotation.z = Math.PI / 2; spg.position.set(-0.2, 0.02, 0.2);
  const spgFace = new THREE.Mesh(new THREE.CircleGeometry(0.038, 12), new THREE.MeshBasicMaterial({ color: 0x9adfe0 }));
  spgFace.rotation.y = -Math.PI / 2; spgFace.position.set(-0.218, 0.02, 0.2);
  g.add(hose, octo, octoReg, spgHose, spg, spgFace);
  // 配重带
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 14), rubberMat);
  belt.rotation.x = Math.PI / 2; belt.scale.set(1, 1, 1.5); belt.position.set(0, -0.02, 0.28);
  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.025), metalMat);
  beltBuckle.position.set(0, -0.05, 0.02);
  g.add(belt, beltBuckle);

  // 手持灯
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5 }));
  torch.rotation.x = Math.PI / 2;
  torch.position.set(0.22, 0, -0.35);
  g.add(torch);
  const light = new THREE.SpotLight(lightColor, victim ? 2 : 14, victim ? 8 : 24, 0.42, 0.45, 1.1);
  light.position.set(0.22, 0, -0.35);
  const lightTarget = new THREE.Object3D();
  lightTarget.position.set(0, 0, -6);
  g.add(light, lightTarget);
  light.target = lightTarget;
  // 灯光锥（假的体积光）
  const coneMat = new THREE.MeshBasicMaterial({ color: lightColor, transparent: true, opacity: victim ? 0.03 : 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5.5, 12, 1, true), coneMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0.22, 0, -3.1);
  g.add(cone);

  // 名牌
  let tag = null;
  if (name) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = '28px "Noto Sans SC"'; ctx.fillStyle = '#cfe8e4'; ctx.textAlign = 'center';
    ctx.fillText(name, 128, 40);
    const tex = new THREE.CanvasTexture(cv);
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    tag.scale.set(1.6, 0.4, 1);
    tag.position.y = 0.45;
    g.add(tag);
  }

  // 右臂：肩 -> 上臂 -> 手（五指），可举手势到面前。arm:false 时为简单手臂胶囊。
  let armG = null, hand = null;
  if (arm) {
    armG = new THREE.Group();
    armG.position.set(0.24, -0.02, -0.28);
    const armM = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 3, 6), suitMat);
    armM.rotation.x = Math.PI / 2;
    armM.position.z = -0.18;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 6), rubberMat);
    glove.position.z = -0.36; glove.scale.set(0.8, 0.7, 1);
    // 挂载点反向抵消抬臂角：垂臂时手指向前掌心向下（自然），抬臂后掌心正对前方的人
    const mount = new THREE.Group();
    mount.rotation.x = -1.5;
    hand = makeHand({ scale: 1.15, mat: rubberMat });
    hand.position.set(0, 0, -0.42);
    hand.rotation.y = Math.PI;
    mount.add(hand);
    armG.add(armM, glove, mount);
    armG.rotation.x = 0.12;
    g.add(armG);
    poseHand(hand, 'palm');
  }

  const state = { kickPhase: Math.random() * 6, light, cone, fins, victim, gestT: 0, gestName: null };
  g.userData.refs = { bcd, mask, tanks, fins, light, cone, arm: armG, hand, tag };
  // 面镜在脸/在手两种摆位（教学：摘下面镜 = 拿在手上）
  const MASK_FACE = [0, 0.08, -0.56, 0, 0, 0], MASK_HAND = [0.3, -0.18, -0.44, 0.5, 0.3, 0];
  g.userData.setMaskInHand = (inHand) => {
    const m = inHand ? MASK_HAND : MASK_FACE;
    mask.position.set(m[0], m[1], m[2]);
    mask.rotation.set(m[3], m[4], m[5]);
  };

  // 举手打手势：手臂抬到面前 + 手摆出对应手型（ok/up/help/line/light 或 press/pinch 等）
  g.userData.gesture = (name, dur = 1.8) => {
    if (!hand) return;
    state.gestT = dur;
    state.gestName = name;
    poseHand(hand, GESTURE_POSE[name] || POSE_ALIAS[name] || name);
  };

  g.userData.update = (dt, moving = 1) => {
    state.kickPhase += dt * (victim ? 2 : 3 + moving * 4);
    const k = Math.sin(state.kickPhase);
    fins[0].rotation.x = k * 0.5;
    fins[1].rotation.x = -k * 0.5;
    if (victim) light.intensity = 1.5 + Math.sin(state.kickPhase * 3) * 1.2; // 求救式闪灯
    // 手势：手臂抬到面前，掌心朝外；help 左右小幅挥动
    if (armG) {
      state.gestT = Math.max(0, state.gestT - dt);
      const raised = state.gestT > 0;
      const target = raised ? 1.5 : 0.12;
      armG.rotation.x += (target - armG.rotation.x) * Math.min(1, dt * 6);
      if (raised && state.gestName === 'help') armG.rotation.z = Math.sin(state.kickPhase * 5) * 0.3;
      else armG.rotation.z *= 0.9;
    }
  };

  g.userData.setBlink = (on) => { /* 由外部控制灯闪烁 */ };
  return g;
}

// poseHand 别名：教学动作 -> POSES 手型
const POSE_ALIAS = { hold: 'press', nose: 'pinch', reg: 'grip', bcd: 'grip', dump: 'fist', mask: 'palm' };

// 被困者（目标救援对象）：抱着膝盖坐在洞底
export function makeVictim() {
  const g = makeDiver({ suit: 0x4a3a28, trim: 0xffb27f, victim: true });
  g.rotation.x = -0.4; // 坐靠姿态
  return g;
}

// 玩家第一人称可见的装备：面镜边框 + 呼出的气泡由 water.js 负责
export function makeMaskOverlay() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 576;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 90;
  ctx.beginPath();
  ctx.roundRect(40, 30, 944, 516, 240);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 30;
  ctx.beginPath(); ctx.roundRect(60, 50, 904, 476, 220); ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2 * 576 / 1024), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.renderOrder = 999;
  return m;
}
