// 水下氛围：分通道体积雾、随深度/天窗变化的环境光、被灯光照亮的悬浮微粒、气泡、水面。
import * as THREE from 'three';
import { fogDensityFor } from './materials.js';
import { quality } from './quality.js';

let _soft = null;
// 软边圆形精灵（避免 Points 默认的方块）
export function softSprite() {
  if (_soft) return _soft;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return (_soft = new THREE.CanvasTexture(cv));
}
let _bub = null;
function bubbleSprite() {
  if (_bub) return _bub;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 10, 32, 32, 30);
  g.addColorStop(0, 'rgba(220,250,255,0.04)'); g.addColorStop(0.8, 'rgba(220,250,255,0.45)'); g.addColorStop(1, 'rgba(220,250,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.arc(22, 22, 5, 0, 7); c.fill();
  return (_bub = new THREE.CanvasTexture(cv));
}

const _haze = new THREE.Color();
const SNOW_V = /* glsl */`
attribute float aSeed;
uniform vec3 uCam; uniform float uBox, uTime, uScale, uSize;
uniform vec3 uLampPos, uLampDir; uniform float uLamp, uFog;
varying float vA; varying float vLit;
void main() {
  vec3 p = position;
  float uT = mod(uTime, 628.318);   // 防 uTime 无限增大后 sin 大参数退化
  p.y -= uTime * (0.05 + aSeed * 0.08);
  p.x += sin(uT * 0.35 + aSeed * 40.0) * 0.4; p.z += cos(uT * 0.27 + aSeed * 31.0) * 0.4;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCam + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = length(rel);
  float edge = 1.0 - smoothstep(0.38, 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z))) / uBox);
  vec3 toP = wp - uLampPos; float dl = max(length(toP), 0.001);
  float cone = smoothstep(0.78, 0.985, dot(toP / dl, uLampDir)) * uLamp;
  // 近灯粒子不发光——灯贴脸时 dl→0 会把粒子打成爆亮白点（水中闪光的来源）
  vLit = min(cone / (1.0 + 0.05 * dl * dl) * smoothstep(0.2, 1.5, dl), 0.85);
  // 贴脸的粒子淡出——否则大光斑贴脸闪
  vA = edge * exp(-d * uFog) * (0.22 + 0.5 * fract(aSeed * 7.3)) * smoothstep(0.12, 0.85, d);
  gl_PointSize = clamp(uSize * uScale / max(0.1, -mv.z) * (0.6 + aSeed), 1.0, 10.0);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_F = /* glsl */`
uniform sampler2D uMap; uniform vec3 uColor, uLampColor;
varying float vA; varying float vLit;
void main() {
  float m = texture2D(uMap, gl_PointCoord).a;
  vec3 col = uColor * 0.55 + uLampColor * vLit * 2.0;
  gl_FragColor = vec4(col, m * vA * (0.3 + vLit * 1.6));
}`;

export class WaterFX {
  constructor(scene, map, vis) {
    this.map = map; this.scene = scene;
    this.tint = new THREE.Color(map.water.tint);
    this.glow = new THREE.Color(map.water.glow);
    this.baseDensity = fogDensityFor(vis);
    this.fogK = 1;
    scene.fog = new THREE.FogExp2(this.tint.clone(), this.baseDensity);
    scene.background = this.tint.clone();
    scene.environmentIntensity = 0.1;

    this.amb = new THREE.AmbientLight(this.glow.clone().lerp(new THREE.Color(1, 1, 1), 0.25), 0.3);
    this.hemi = new THREE.HemisphereLight(this.glow.clone(), 0x050807, 0.25);
    scene.add(this.amb, this.hemi);

    // —— 海雪：GPU 端循环，被灯束照亮时才明显 ——
    // map.water.snow 可按图缩放密度（冰下清水里满屏亮点会显"闪光"）
    const N = Math.round(quality.cfg.snow * 2 * (map.water.snow ?? 1));
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    this.snowBox = 34;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random() * this.snowBox; pos[i * 3 + 1] = Math.random() * this.snowBox; pos[i * 3 + 2] = Math.random() * this.snowBox;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.snowU = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: this.snowBox }, uTime: { value: 0 }, uScale: { value: 600 }, uSize: { value: 0.045 },
      uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uLamp: { value: 0 }, uFog: { value: this.baseDensity },
      uMap: { value: softSprite() }, uColor: { value: this.glow.clone().lerp(new THREE.Color(1, 1, 1), 0.4) }, uLampColor: { value: new THREE.Color(1, 0.94, 0.82) },
    };
    this.snow = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.snowU, vertexShader: SNOW_V, fragmentShader: SNOW_F,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);

    // —— 气泡池 ——
    const BN = 160;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
    const bubMat = new THREE.PointsMaterial({
      map: bubbleSprite(), color: 0xe8fbff, size: 0.024, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true,
    });
    // 贴脸气泡淡出——气泡穿过面镜那一下不该是一团白闪
    bubMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vBubD;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBubD = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBubD;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.04, 0.45, vBubD);');
    };
    this.bubbles = new THREE.Points(bg, bubMat);
    this.bubbles.frustumCulled = false;
    this.bubbleData = [];
    for (let i = 0; i < BN; i++) this.bubbleData.push({ life: -Math.random() * 2, p: new THREE.Vector3(), s: 0.7 + Math.random() * 0.8 });
    scene.add(this.bubbles);
    this._bCursor = 0;
    this._t = 0;
    this._sunK = 1;
  }

  // 呼出一串气泡：从面镜下缘（二级头）喷出，向上掠过视野边缘而不是糊在镜头前
  exhale(pos, dir) {
    for (let k = 0; k < 4; k++) {
      const b = this.bubbleData[this._bCursor++ % this.bubbleData.length];
      b.life = 0;
      b.p.copy(pos).addScaledVector(dir, 0.5 + k * 0.06);
      b.p.y -= 0.5;
      b.p.x += (Math.random() - 0.5) * 0.14; b.p.z += (Math.random() - 0.5) * 0.14;
      b.s = 0.4 + Math.random() * 0.55;
    }
  }

  // 能见度倍率（泥沙等），1 为基准
  setDensityScale(k) { this.fogK = k; }
  // 出水过渡：0=水下，1=完全出水。雾色从水下调成空气薄霭，悬浮微粒藏起来。
  setAbove(k) { this._above = k; }

  // lamp: {on, pos, dir}; sky: 周边天窗强度 0..1
  update(dt, camPos, lamp, skyK = 0, depth = 0, pxHeight = 720, fovDeg = 75) {
    this._t += dt;
    // 环境亮度：水面附近明亮，下潜后迅速变暗，天窗周围保留一层蓝光。
    // 开放海域深处也不会全黑——海水本身是个巨大的柔光箱
    const dayK = Math.exp(-Math.max(0, depth) / (this.map.water.dayLen || 14));
    const k = Math.max(this.map.kind === 'ocean' ? 0.22 : this.map.kind === 'ice' ? 0.18 : 0.12, Math.max(dayK, skyK * 0.9));
    this._sunK += (k - this._sunK) * Math.min(1, dt * 1.5);
    const s = this._sunK;
    const above = this._above || 0;
    this.amb.intensity = (0.06 + 0.5 * s) * (1 - above * 0.4);
    this.hemi.intensity = 0.04 + 0.3 * s;
    const haze = _haze.set(this.map.kind === 'ice' ? 0xc8d8e2 : 0x9fc8da);
    this.scene.fog.color.copy(this.tint).multiplyScalar(0.05 + 1.1 * s * s).lerp(haze, above);
    this.scene.background.copy(this.scene.fog.color);
    this.scene.fog.density = this.baseDensity * this.fogK * (1 - above) + 0.004 * above;
    this.snow.visible = above < 0.4;

    const u = this.snowU;
    u.uCam.value.copy(camPos); u.uTime.value = this._t;
    u.uScale.value = pxHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    u.uFog.value = this.scene.fog.density;
    u.uLamp.value = lamp?.on ? 1 : 0;
    if (lamp) { u.uLampPos.value.copy(lamp.pos); u.uLampDir.value.copy(lamp.dir); }

    const bp = this.bubbles.geometry.attributes.position;
    this.bubbleData.forEach((b, i) => {
      if (b.life < 0) { bp.setXYZ(i, 0, -9999, 0); return; }
      b.life += dt;
      b.p.y += dt * (0.7 + b.life * 0.5) * b.s;
      b.p.x += Math.sin(this._t * 6 + i) * dt * 0.12;
      b.p.z += Math.cos(this._t * 5 + i * 2) * dt * 0.1;
      if (b.life > 4) b.life = -1;
      bp.setXYZ(i, b.p.x, b.p.y, b.p.z);
    });
    bp.needsUpdate = true;
  }
}

// 入口水面：从水下往上看的"斯涅尔窗"——明亮的波动窗口，窗外全反射偏暗
export function makeSurface(radius, glow) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { t: { value: 0 }, glow: { value: new THREE.Color(glow) } },
    vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform float t; uniform vec3 glow;
      float h(vec2 p){ float tt = mod(t, 628.318); return sin(p.x*1.7+tt*1.1)*sin(p.y*1.3-tt*0.9) + 0.5*sin(p.x*3.9-tt*1.7+p.y*2.1)*cos(p.y*3.3+tt*1.3); }
      void main(){
        vec2 p = vP.xz * 0.4;
        // 域扭曲：sin×sin 本身是棋盘格，扭曲坐标把它打成波纹
        mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
        vec2 q = R * p + vec2(h(p * 1.31 + 3.0), h(p * 1.71 + 7.0)) * 1.1;
        float w = h(q), w2 = h(q * 2.17 + 7.0);
        float spark = pow(max(0.0, w*0.5+w2*0.3), 5.0);
        // 斯涅尔窗：正上方看是亮窗，斜角是全反射的暗蓝；远处融进雾色
        vec3 V = vP - cameraPosition;
        float dl = length(V);
        float snell = 0.12 + 0.88 * smoothstep(0.04, 0.7, clamp(normalize(V).y, 0.0, 1.0));
        vec3 c = (mix(glow*0.55, vec3(0.85,1.0,1.0), 0.35 + 0.25*w) + spark*1.2) * snell;
        gl_FragColor = vec4(c, (0.5 + 0.2*w) * mix(0.35, 1.0, snell) * exp(-dl * 0.018));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.renderOrder = 4;
  mesh.userData.mat = m;
  return mesh;
}
