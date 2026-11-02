// 潜水主灯：手持偏置的聚光灯（带阴影，产生视差立体感）+ 近身补光 + 体积光锥。
import * as THREE from 'three';
import { quality } from './quality.js';

const _off = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

const CONE_V = /* glsl */`
varying float vT; varying vec3 vN; varying vec3 vV;
void main() {
  vT = (4.5 - position.y) / 9.0;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const CONE_F = /* glsl */`
uniform vec3 uColor; uniform float uK;
varying float vT; varying vec3 vN; varying vec3 vV;
void main() {
  float ax = smoothstep(0.0, 0.15, vT) * (1.0 - smoothstep(0.35, 1.0, vT));
  float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
  gl_FragColor = vec4(uColor * ax * edge * uK, 1.0);
}`;

export class DiverLamp {
  constructor(scene) {
    this.scene = scene;
    const sh = quality.cfg.shadows;
    this.spot = new THREE.SpotLight(0xfff0d4, 95, 40, 0.55, 0.65, 1.6);
    if (sh) {
      this.spot.castShadow = true;
      this.spot.shadow.mapSize.set(sh, sh);
      this.spot.shadow.camera.near = 0.25; this.spot.shadow.camera.far = 40;
      this.spot.shadow.bias = -0.0006; this.spot.shadow.normalBias = 0.06;
      this.spot.shadow.radius = 5;
    }
    this.target = new THREE.Object3D();
    this.spot.target = this.target;
    this.spill = new THREE.SpotLight(0xe8f4ee, 16, 26, 1.1, 1.0, 1.4);
    this.fill = new THREE.PointLight(0xcfeee8, 2.0, 8, 1.6);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 9, 24, 1, true), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.93, 0.8) }, uK: { value: 0.1 } },
      vertexShader: CONE_V, fragmentShader: CONE_F,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.cone.frustumCulled = false;
    this.spill.target = this.target;
    scene.add(this.spot, this.spill, this.target, this.fill, this.cone);
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
  }

  // cam: 相机（取姿态）；on: 是否亮；power: 亮度倍率；silt: 0..1 泥沙浓度（让光束更显眼）
  update(cam, { on = true, power = 1, flicker = 1, silt = 0, handheld = true, volumetric = false } = {}) {
    cam.getWorldDirection(this.dir);
    _off.set(handheld ? 0.2 : 0, handheld ? -0.16 : 0, handheld ? -0.15 : 0).applyQuaternion(cam.quaternion);
    this.pos.copy(cam.position).add(_off);
    this.spot.position.copy(this.pos);
    this.target.position.copy(this.pos).addScaledVector(this.dir, 12);
    this.spot.intensity = on ? 95 * power * flicker : 0;
    this.spill.position.copy(this.pos);
    this.spill.intensity = on ? 16 * power * flicker : 0;
    this.fill.position.copy(cam.position);
    this.fill.intensity = on ? 1.2 * power : 0.12;
    this.cone.visible = on && !volumetric;
    this.cone.position.copy(this.pos).addScaledVector(this.dir, 4.5);
    this.cone.quaternion.setFromUnitVectors(_down, this.dir);
    this.cone.material.uniforms.uK.value = (0.012 + silt * 0.4) * power * flicker;
  }
}
