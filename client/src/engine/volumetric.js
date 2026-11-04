// 体积光后处理：沿视线步进，积累潜水灯光锥与天窗光柱在含微粒水体中的散射（丁达尔效应）。
// 读取场景深度，因此光束会被洞壁/钟乳石正确截断；泥沙越浓，光束越显眼。
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SHADER = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uNear: { value: 0.05 }, uFar: { value: 160 }, uTime: { value: 0 },
    uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uLamp: { value: 1 }, uLampCol: { value: new THREE.Color(1, 0.93, 0.8) },
    uScatter: { value: 0.03 }, uMaxD: { value: 16 },
    uSky: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, // x,z,半径,底部y
    uSkyN: { value: 0 }, uSurfY: { value: -0.35 }, uSkyCol: { value: new THREE.Color(0.4, 0.8, 0.9) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 uProjInv, uCamWorld; uniform vec3 uCamPos;
    uniform float uNear, uFar, uTime, uLamp, uScatter, uMaxD, uSurfY, uSkyN;
    uniform vec3 uLampPos, uLampDir, uLampCol, uSkyCol;
    uniform vec4 uSky[4];
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float z = texture2D(tDepth, vUv).x;
      float uT = mod(uTime, 628.318);   // 防 uTime 无限增大后 sin 大参数退化
      vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec4 vp = uProjInv * ndc; vp /= vp.w;
      vec3 rd = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
      // 深度 -> 沿视线的距离
      float zn = z * 2.0 - 1.0;
      vec4 sp = uProjInv * vec4(ndc.xy, zn, 1.0); sp /= sp.w;
      float tEnd = min(length(sp.xyz), uMaxD);
      const int N = 22;
      // 空间静态抖动——随时间抖动会让光束每帧闪
      float j = hash(vUv * vec2(1920.0, 1080.0));
      float stepL = tEnd / float(N);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < N; i++) {
        float t = (float(i) + j) * stepL;
        vec3 p = uCamPos + rd * t;
        float fade = exp(-t * 0.09);
        if (uLamp > 0.0) {
          vec3 d = p - uLampPos; float dl = max(length(d), 0.15);
          float cone = smoothstep(0.84, 0.985, dot(d / dl, uLampDir));
          // 近场抑制：贴灯的采样点 dl→0 贡献爆炸，逐帧闪烁
          acc += uLampCol * cone * fade * smoothstep(0.2, 1.3, dl) / (1.0 + 0.08 * dl * dl);
        }
        for (int k = 0; k < 4; k++) {
          if (float(k) >= uSkyN) break;
          float depth = uSurfY - p.y;
          if (depth > 0.0 && p.y > uSky[k].w) {
            float rad = uSky[k].z * (0.55 + 0.4 * clamp(depth / max(0.1, uSurfY - uSky[k].w), 0.0, 1.0));
            float rh = length(p.xz - uSky[k].xy);
            float inside = smoothstep(rad, rad * 0.45, rh);
            float streak = 0.7 + 0.3 * sin(atan(p.z - uSky[k].y, p.x - uSky[k].x) * 9.0 + uT * 0.3) * sin(p.y * 0.35 - uT * 0.2);
            acc += uSkyCol * inside * streak * exp(-depth * 0.045) * 0.75 * fade;
          }
        }
      }
      acc *= stepL * uScatter;
      if (any(notEqual(acc, acc))) acc = vec3(0.0);   // NaN 保险：经 bloom 会放大成全屏黑闪
      gl_FragColor = vec4(base.rgb + acc, base.a);
    }`,
};

// 自带场景渲染目标（含深度纹理 + 可选 MSAA）：渲染场景 -> 步进散射 -> 输出到合成链
export class VolumetricPass extends Pass {
  constructor(scene, camera, renderer, samples = 0) {
    super();
    this.scene = scene; this.camera = camera;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples });
    this.sceneRT.depthTexture = new THREE.DepthTexture(s.x, s.y);
    this.u = THREE.UniformsUtils.clone(SHADER.uniforms);
    this.material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SHADER.vertexShader, fragmentShader: SHADER.fragmentShader, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }
  setSize(w, h) { this.sceneRT.setSize(w, h); }
  render(renderer, writeBuffer) {
    const u = this.u, cam = this.camera;
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(this.scene, cam);
    u.tDiffuse.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }
  dispose() { this.sceneRT.dispose(); this.material.dispose(); this.fsQuad.dispose(); }
}
