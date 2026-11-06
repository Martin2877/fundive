// 体感小人：左下角一个迷你 3D 视窗，实时呈现"我"的全身状态——
// 俯仰姿态、踢水节奏、BCD 充气量、摘下面镜拿在手上、手臂动作（压镜/送气/拉拉链/打手势）、侧挂气瓶。
// 独立小渲染器，不进主后期管线，开销可忽略。
import * as THREE from 'three';
import { makeDiver } from '../engine/diver.js';
import { poseHand } from '../engine/hand.js';
import { t } from '@fundive/shared/i18n.js';

// 各动作对应的手臂抬升角(armG.rotation.x)与手型
const ARM_POSE = {
  rest:   [0.12, 'palm'],
  gest:   [1.5,  null],          // 手势时手型由 gesture() 指定
  mask:   [0.55, 'palm'],        // 手拿面镜
  hold:   [1.35, 'press'],       // 压面镜上沿
  exhale: [1.15, 'grip'],        // 二级头/鼻吐气
  dump:   [1.7,  'fist'],        // 拉泄气阀
  bcd:    [0.75, 'grip'],        // 按充气阀
  pinch:  [1.3,  'pinch'],       // 捏鼻
};

export class BodyAvatar {
  constructor({ gear } = {}) {
    const wrap = document.createElement('div');
    wrap.id = 'avatar';
    wrap.innerHTML = `<div class="av-lbl">${t('体 感')}</div>`;
    this.canvas = document.createElement('canvas');
    wrap.appendChild(this.canvas);
    document.body.appendChild(wrap);
    this.el = wrap;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.setSize(150, 178, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 150 / 178, 0.1, 12);
    this.camera.position.set(1.1, 0.5, -2.0);   // 右前上方看过去
    this.camera.lookAt(0, 0, 0.15);

    this.scene.add(new THREE.AmbientLight(0x7fa8b8, 1.1));
    const key = new THREE.DirectionalLight(0xd8f0ec, 1.8); key.position.set(1.5, 2, -1);
    const rim = new THREE.DirectionalLight(0x2a4a58, 1.0); rim.position.set(-2, 0.4, 2);
    this.scene.add(key, rim);

    this.diver = makeDiver({ suit: 0x24404a, trim: 0x7fe9ea, sidemount: gear === 'smt', arm: true, beam: true });
    this.scene.add(this.diver);
    this.refs = this.diver.userData.refs;

    this._arm = 0.12;
    this._gestT = 0;
    this._poseName = 'palm';
    this._maskInHand = false;
  }

  gesture(g) { this._gestT = 1.0; this.diver.userData.gesture(g, 1.0); }

  _setArmPose(name) {
    if (this._poseName === name) return;
    this._poseName = name;
    if (this.refs.hand && name && name !== 'gest') poseHand(this.refs.hand, name);
  }

  // 每帧调用。p = player（有 pos/vel/pitch/buoy/maskOff/regOut/lightOn/lung）
  update(dt, p, keys) {
    const u = this.diver.userData;
    u.update(dt, p.vel.length());

    // 姿态：俯仰跟随玩家视角，加一点悬浮摇晃
    const targetPitch = p.pitch * 0.8;
    this.diver.rotation.x += (targetPitch - this.diver.rotation.x) * Math.min(1, dt * 6);
    this.diver.rotation.z = Math.sin(p.time * 0.8) * 0.04;

    // BCD 气囊随充气量鼓/瘪
    const f = Math.max(0, p.buoy);
    this.refs.bcd.scale.set(1 + f * 0.3, 0.55 + f * 0.2, 1 + f * 0.3);

    // 面镜摘下 -> 拿在手里
    if (p.maskOff !== this._maskInHand) {
      this._maskInHand = p.maskOff;
      u.setMaskInHand(p.maskOff);
    }

    // 手臂姿态（按优先级）：手势 > 拿面镜 > 压上沿 > 捏鼻 > 二级头/吐气 > 拉排气阀 > 按充气阀
    let target = 'rest';
    if (this._gestT > 0) { target = 'gest'; this._gestT -= dt; }
    else if (p.maskOff) target = 'mask';
    else if (keys.has('KeyH')) target = 'hold';
    else if (keys.has('KeyX')) target = 'pinch';
    else if (p.regOut || keys.has('KeyN')) target = 'exhale';
    else if (keys.has('KeyV')) target = 'dump';
    else if (keys.has('KeyB')) target = 'bcd';
    const [armX, poseName] = ARM_POSE[target];
    this._arm += (armX - this._arm) * Math.min(1, dt * 7);
    if (this.refs.arm) this.refs.arm.rotation.x = this._arm;
    if (target !== 'gest') this._setArmPose(poseName || 'palm');
    else this._poseName = 'gest';

    // 灯
    const lit = p.lightOn || p.backupOn;
    this.refs.light.intensity = lit ? 12 : 0;
    this.refs.cone.visible = lit;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.el.remove();
    this.renderer.dispose();
  }
}
