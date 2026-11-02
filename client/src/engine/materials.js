// 共享材质：水下体积雾（分通道吸收）+ 洞壁三平面 PBR 材质。
import * as THREE from 'three';
import { genRock, genSand } from './texgen.js';
import { quality } from './quality.js';

// —— 水下雾：Beer-Lambert 分通道衰减，红光最先被吸收，远处自然偏蓝绿 ——
// 全局覆盖 three 的雾 chunk，所有 fog:true 的材质（含 Points / ShaderMaterial）自动生效。
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec3 fogT = exp(-fogDensity * vec3(1.55, 1.0, 0.78) * vFogDepth);
  gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, fogT);
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  uniform float fogDensity;
#endif`;
export const fogDensityFor = (vis) => 2.0 / Math.max(3, vis);

// 天窗焦散：全局 uniform，所有洞壁材质共用（由 cave.js 填入天窗位置，session 每帧推进时间）
export const CAUSTIC = {
  uSky: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uSkyN: { value: 0 }, uCT: { value: 0 }, uCCol: { value: new THREE.Color(0.5, 0.9, 1.0) },
};

let _tex = null;
export function caveTextures() {
  if (!_tex) {
    const c = quality.cfg;
    _tex = { rock: genRock(c.rockTex), sand: genSand(c.sandTex), key: quality.level };
  }
  return _tex;
}

const COMMON_V = /* glsl */`
#include <common>
varying vec3 vWPos; varying vec3 vWN;`;
const COMMON_F = /* glsl */`
#include <common>
uniform sampler2D tRockA, tRockN, tRockR, tSandA, tSandN, tSandR;
uniform float uSand, uNormalK;
uniform vec4 uSky[4]; uniform float uSkyN, uCT; uniform vec3 uCCol;
varying vec3 vWPos; varying vec3 vWN;
vec3 tpA(sampler2D t, vec3 p, vec3 w, float sc){
  return texture2D(t, p.zy * sc).rgb * w.x + texture2D(t, p.xz * sc).rgb * w.y + texture2D(t, p.xy * sc).rgb * w.z;
}
float tpR(sampler2D t, vec3 p, vec3 w, float sc){
  return texture2D(t, p.zy * sc).r * w.x + texture2D(t, p.xz * sc).r * w.y + texture2D(t, p.xy * sc).r * w.z;
}
float caustic(vec2 p, float t) {
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.2);
}
vec3 tpN(sampler2D t, vec3 p, vec3 w, vec3 n, float sc, float k){
  vec3 tx = texture2D(t, p.zy * sc).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, p.xz * sc).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, p.xy * sc).xyz * 2.0 - 1.0;
  tx.xy *= k; ty.xy *= k; tz.xy *= k;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}`;

// sand: 0=纯岩石（钟乳石等），1=法线朝上的面混入沙底
export function makeCaveMaterial({ sand = 1, normalK = 1.0, roughness = 1.0, envMapIntensity = 0.12 } = {}) {
  const t = caveTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.0, envMapIntensity, side: THREE.FrontSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tRockA: { value: t.rock.map }, tRockN: { value: t.rock.normalMap }, tRockR: { value: t.rock.roughnessMap },
      tSandA: { value: t.sand.map }, tSandN: { value: t.sand.normalMap }, tSandR: { value: t.sand.roughnessMap },
      uSand: { value: sand }, uNormalK: { value: normalK }, ...CAUSTIC,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', COMMON_V)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', COMMON_F)
      .replace('#include <map_fragment>', `
        vec3 tpn = normalize(vWN);
        vec3 tpW = pow(abs(tpn), vec3(4.0)); tpW /= (tpW.x + tpW.y + tpW.z);
        float tpFl = uSand * smoothstep(0.3, 0.72, tpn.y);
        vec3 tpRock = tpA(tRockA, vWPos, tpW, 0.28);
        tpRock = mix(tpRock, tpRock * tpA(tRockA, vWPos, tpW, 1.43) * 2.0, 0.65);
        vec3 tpAlb = tpRock;
        if (tpFl > 0.001) {
          vec3 s0 = tpA(tSandA, vWPos, tpW, 0.34);
          s0 = mix(s0, s0 * tpA(tSandA, vWPos, tpW, 1.9) * 2.0, 0.6);
          tpAlb = mix(tpRock, s0, tpFl);
        }
        diffuseColor.rgb *= tpAlb;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float sk = 0.0;
          for (int i = 0; i < 4; i++) {
            if (float(i) >= uSkyN) break;
            vec3 d = vWPos - uSky[i].xyz;
            float h = max(0.0, uSky[i].y - vWPos.y);
            float rr = uSky[i].w * 1.9 + h * 0.25;
            sk = max(sk, (1.0 - smoothstep(0.0, rr, length(d.xz))) * exp(-h * 0.07) * step(vWPos.y, uSky[i].y));
          }
          if (sk > 0.002) {
            float cs = caustic(vec2(vWPos.x + vWPos.y * 0.7, vWPos.z + vWPos.y * 0.3) * 0.85, uCT * 0.55);
            totalEmissiveRadiance += uCCol * cs * sk * (0.25 + 0.75 * max(0.0, tpn.y)) * 0.55;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * tpR(tRockR, vWPos, tpW, 0.28);
        if (tpFl > 0.001) roughnessFactor = mix(roughnessFactor, roughness * tpR(tSandR, vWPos, tpW, 0.34), tpFl);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 tpWn = tpN(tRockN, vWPos, tpW, tpn, 0.28, uNormalK);
        tpWn = normalize(tpWn + (tpN(tRockN, vWPos, tpW, tpn, 1.43, uNormalK * 0.7) - tpn) * 0.6);
        if (tpFl > 0.001) tpWn = normalize(mix(tpWn, tpN(tSandN, vWPos, tpW, tpn, 0.34, uNormalK * 1.2), tpFl));
        normal = normalize((viewMatrix * vec4(tpWn, 0.0)).xyz) * faceDirection;`);
  };
  mat.customProgramCacheKey = () => 'cave_v2';
  return mat;
}
