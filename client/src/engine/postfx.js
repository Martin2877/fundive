// 后期：MSAA 渲染目标 -> 泛光 -> 色调映射 -> 水下调色（面镜暗角、色散、颗粒、氮醉扭曲）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { quality } from './quality.js';
import { VolumetricPass } from './volumetric.js';

const UnderwaterShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1.78 }, uNarc: { value: 0 }, uPanic: { value: 0 }, uMask: { value: 1 }, uDark: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uAspect, uNarc, uPanic, uMask, uDark;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + mod(uTime, 628.318)) * 43758.5453); }
    void main() {
      float uT = mod(uTime, 628.318);   // 防 uTime 无限增大后 sin 大参数退化
      vec2 uv = vUv, c = uv - 0.5;
      float w = uNarc * 0.006 + uPanic * 0.002;
      uv += w * vec2(sin(uv.y * 22.0 + uT * 2.1), cos(uv.x * 19.0 + uT * 1.7));
      float r2 = dot(c * vec2(uAspect * 0.62, 1.0), c * vec2(uAspect * 0.62, 1.0));
      vec2 ca = c * (0.0016 + uNarc * 0.004) * (0.4 + r2 * 6.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
      // 面镜：椭圆视野，鼻梁处略压暗
      float vig = smoothstep(0.62, 0.17, r2 * 1.55);
      float nose = smoothstep(0.1, 0.0, abs(c.x)) * smoothstep(-0.2, -0.5, c.y) * 0.35;
      col *= mix(1.0, vig, uMask) * (1.0 - nose * uMask);
      // 水下调色：暗部偏青，亮部略暖，整体略压饱和
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.94);
      col *= mix(vec3(0.9, 1.0, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.8, l));
      float g = hash(vUv * 1000.0) - 0.5;
      col += g * 0.03 * (1.0 - l * 0.8);
      col *= 1.0 - uDark;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function makeComposer(renderer, scene, camera) {
  const q = quality.cfg;
  if (!q.post) return null;
  const composer = new EffectComposer(renderer);
  const vol = new VolumetricPass(scene, camera, renderer, q.msaa);
  composer.addPass(vol);
  composer.vol = vol.u;
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.65, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const uw = new ShaderPass(UnderwaterShader);
  composer.addPass(uw);
  composer.uw = uw.uniforms;
  composer.bloom = bloom;
  return composer;
}
