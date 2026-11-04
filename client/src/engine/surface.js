// 水面之上：出水后看到的世界。
// 按潜种生成：洞潜=天坑（环形岩壁+植被+天窗），海潜=海天线+潜水船，冰潜=冰原+冰洞。
// buildSurface 返回 { group, standPos, update(dt, t) } —— session 出水流程驱动。
import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { universeRng, range, intRange } from '@fundive/shared/rng.js';
import { softSprite } from './water.js';

const UP = new THREE.Vector3(0, 1, 0);

// 渐变天穹：天顶深 -> 地平线亮，朝太阳一侧暖色光晕 + 太阳圆盘
function makeSky(map) {
  const day = map.kind !== 'ice';   // 冰潜偏冷白
  const u = {
    uSun: { value: new THREE.Vector3(0.45, 0.5, -0.6).normalize() },
    uTop: { value: new THREE.Color(day ? 0x2e6da8 : 0x6f9cbc) },
    uHor: { value: new THREE.Color(day ? 0xbfe0ea : 0xcfe0ea) },
    uSunC: { value: new THREE.Color(day ? 0xfff2d0 : 0xfff8ea) },
  };
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: u,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uSun, uTop, uHor, uSunC; varying vec3 vD;
      void main(){
        float y = clamp(vD.y, 0.0, 1.0);
        vec3 c = mix(uHor, uTop, pow(y, 0.55));
        float s = max(0.0, dot(normalize(vD), uSun));
        c += uSunC * (pow(s, 40.0) * 0.9 + pow(s, 6.0) * 0.18);   // 日盘+光晕
        if (vD.y < 0.0) c = uHor * 0.96;   // 地平线以下别让天穹闪黑
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 14), m);
  mesh.frustumCulled = false;
  return mesh;
}

// 从上面看的水面：大平面 + 波纹法线扰动 -> 天空菲涅尔反射 + 高光
function makeWaterPlane(map, r) {
  const u = {
    uT: { value: 0 },
    uDeep: { value: new THREE.Color(map.kind === 'ice' ? 0x0d3346 : 0x0e4a68) },
    uSky: { value: new THREE.Color(map.kind === 'ice' ? 0xd8e4e8 : 0xbfe0ea) },
    uSun: { value: new THREE.Vector3(0.45, 0.5, -0.6).normalize() },
  };
  const m = new THREE.ShaderMaterial({
    fog: false,
    uniforms: u,
    vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }`,
    fragmentShader: `uniform float uT; uniform vec3 uDeep, uSky, uSun; varying vec3 vP;
      float h(vec2 p){ float t = mod(uT, 628.318);
        return sin(p.x*0.9+t*0.9)*cos(p.y*0.7-t*0.7) + 0.55*sin(p.x*2.3-t*1.2+p.y*1.9)*cos(p.y*2.7+t*0.8); }
      void main(){
        vec2 p = vP.xz * 0.35;
        float e = 0.22;
        vec3 n = normalize(vec3(h(p+vec2(e,0.0))-h(p-vec2(e,0.0)), 1.6, h(p+vec2(0.0,e))-h(p-vec2(0.0,e))));
        vec3 V = normalize(cameraPosition - vP);
        float fres = pow(1.0 - max(0.0, dot(V, n)), 2.0);
        vec3 c = mix(uDeep, uSky, 0.25 + fres * 0.7);
        float spec = pow(max(0.0, dot(reflect(-uSun, n), V)), 90.0) * 2.2;
        c += vec3(1.0, 0.95, 0.8) * spec;
        float dl = length(cameraPosition - vP);
        c = mix(c, uSky, smoothstep(60.0, 220.0, dl));   // 远处融进天海线
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 48), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.06;
  return { mesh, u };
}

// 天坑：环形岩壁 + 坑沿植被 + 垂藤。洞潜的"出口"就是坑底水面。
function makeCenote(rng, entry, glow) {
  const g = new THREE.Group();
  const R = entry.r * 2.2 + 5, H = 13;
  const geo = new THREE.CylinderGeometry(R * 1.06, R, H, 40, 5, true);
  const pa = geo.attributes.position, col = new Float32Array(pa.count * 3);
  const ph = rng() * 30;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const n = fbm3(x * 0.3 + ph, y * 0.3, z * 0.3 + ph, 3);
    const rimK = Math.max(0, (y / H + 0.5)) ** 2;            // 越靠坑沿外扩越多
    const k = 1 + n * 0.22 + rimK * 0.3;
    pa.setX(i, x * k); pa.setZ(i, z * k);
    pa.setY(i, y + fbm3(x * 0.5, 7, z * 0.5, 2) * rimK * 1.4);
    const top = Math.min(1, Math.max(0, y / H + 0.55));
    const strata = 0.5 + 0.14 * Math.sin(y * 0.85 + ph) + 0.1 * Math.sin(y * 2.3 + ph * 2);  // 石灰岩层理
    const rock = (0.34 + 0.4 * n) * strata * 2;
    col[i * 3] = rock * (0.62 + top * 0.28);                  // 岩壁
    col[i * 3 + 1] = rock * (0.6 + top * 0.5);               // 靠顶部泛绿（植被浸润）
    col[i * 3 + 2] = rock * 0.52;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const wall = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.BackSide }));
  wall.position.set(entry.x, H / 2 - 0.6, entry.z);
  g.add(wall);

  // 坑沿台面：环状地表从坑沿向外铺，植被和树长在这层地上
  const rimGeo = new THREE.RingGeometry(R * 0.9, R * 2.6, 36, 3);
  rimGeo.rotateX(-Math.PI / 2);
  const rp = rimGeo.attributes.position, rcol = new Float32Array(rp.count * 3);
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), z = rp.getZ(i);
    const n = fbm3(x * 0.25 + ph, 0, z * 0.25, 3);
    rp.setY(i, n * 0.5);
    const k = 0.5 + 0.5 * n;
    rcol[i * 3] = 0.22 + 0.14 * k; rcol[i * 3 + 1] = 0.3 + 0.16 * k; rcol[i * 3 + 2] = 0.14 + 0.08 * k;
  }
  rimGeo.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
  rimGeo.computeVertexNormals();
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  rim.position.set(entry.x, H - 0.9, entry.z);
  g.add(rim);

  // 坑沿植被团：坐在台面上，有些贴坑沿有些在外圈；几棵高一点的当树
  const folMat = new THREE.MeshStandardMaterial({ color: 0x35682e, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });
  const nf = intRange(rng, 16, 22);
  for (let i = 0; i < nf; i++) {
    const a = rng() * Math.PI * 2, rr = R * (0.98 + rng() * 0.9);
    const s = range(rng, 0.7, 2.2);
    const fol = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), folMat);
    fol.position.set(entry.x + Math.cos(a) * rr, H - 0.6 + s * 0.55 + rng() * 0.4, entry.z + Math.sin(a) * rr);
    fol.scale.y = 0.75; fol.rotation.y = rng() * 6;
    g.add(fol);
    if (i % 4 === 0) {   // 树冠底下的树干
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 6), trunkMat);
      tr.position.set(fol.position.x, H - 0.9 + 0.9, fol.position.z);
      tr.rotation.z = range(rng, -0.1, 0.1);
      g.add(tr);
    }
  }
  // 垂藤：从坑沿往水里挂的细条
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x1f4a22, roughness: 0.95 });
  for (let i = 0, n = intRange(rng, 4, 8); i < n; i++) {
    const a = rng() * Math.PI * 2, rr = R * (0.94 + rng() * 0.12);
    const len = range(rng, 3, 7);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, len, 5), vineMat);
    v.position.set(entry.x + Math.cos(a) * rr, H - len / 2, entry.z + Math.sin(a) * rr);
    v.rotation.z = range(rng, -0.12, 0.12);
    g.add(v);
  }
  return g;
}

// 潜水船：比水下剪影更完整——船身+舱室+天线+遮阳棚
function makeBoat() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.55, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1f5d8a, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7 });
  const h = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 12), hull); h.position.y = -0.4;
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.8, 3.2, 4), hull);
  bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, -0.4, -7.5); bow.scale.set(1, 1, 0.5);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.3, 12.05), accent); stripe.position.y = 0.15;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 4), hull); cabin.position.set(0, 1.15, -1.2);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.6, 3.4), dark); win.position.set(0, 1.5, -1.6);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 3.2), accent); canopy.position.set(0, 2.3, 1.8);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), dark); mast.position.set(0, 3.0, -1.2);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.1), dark); ladder.position.set(0, -0.2, 6.0);
  g.add(h, bow, stripe, cabin, win, canopy, mast, ladder);
  return g;
}

// 冰原：起伏的冰盖 + 挤压脊线 + 下来的那个冰洞
function makeIceField(rng, holePos) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(220, 220, 40, 40);
  geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position, col = new Float32Array(pa.count * 3);
  const ph = rng() * 40;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i);
    const n = fbm3(x * 0.05 + ph, 0, z * 0.05 + ph, 3);
    pa.setY(i, 0.12 + n * 0.5);
    const k = 0.82 + 0.18 * n;
    col[i * 3] = 0.75 * k + 0.12; col[i * 3 + 1] = 0.83 * k + 0.12; col[i * 3 + 2] = 0.9 * k + 0.08;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })));
  // 挤压脊：横七竖八的低矮冰脊，背光面偏蓝才从雪原里跳出来
  const rm = new THREE.MeshStandardMaterial({ color: 0x9dbccc, roughness: 0.62 });
  const rm2 = new THREE.MeshStandardMaterial({ color: 0x7a9eb0, roughness: 0.68 });
  for (let i = 0, n = 16; i < n; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(range(rng, 6, 18), range(rng, 0.6, 2.2), range(rng, 0.8, 1.8)), rng() < 0.5 ? rm : rm2);
    r.position.set(range(rng, -95, 95), 0.4, range(rng, -95, 95));
    r.rotation.y = rng() * 3;
    r.rotation.z = range(rng, -0.06, 0.06);
    g.add(r);
  }
  // 远山剪影：地平线上一圈低多边形暗蓝山体，给白原一个尽头
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0x51748a, roughness: 1, flatShading: true });
  for (let i = 0, n = 9; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.4, d = range(rng, 150, 190);
    const m = new THREE.Mesh(new THREE.ConeGeometry(range(rng, 22, 44), range(rng, 12, 26), 5), mtnMat);
    m.position.set(Math.cos(a) * d, 2, Math.sin(a) * d);
    m.rotation.y = rng() * 3;
    g.add(m);
  }
  // 接应营地：洞口边的红帐篷 + 雪橇 + 两个黑色人影——玩家一抬头就看见"有人来接"
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xc03a26, roughness: 0.8 });
  const tent = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.1, 4), tentMat);
  tent.position.set(holePos.x + 9.5, 1.1, holePos.z - 5.5); tent.rotation.y = Math.PI / 4;
  g.add(tent);
  const sledMat = new THREE.MeshStandardMaterial({ color: 0x8a6f3a, roughness: 0.8 });
  const sled = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.0), sledMat);
  sled.position.set(holePos.x + 7.2, 0.35, holePos.z - 6.8); sled.rotation.y = 0.5;
  g.add(sled);
  const figMat = new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.9 });
  for (const [fx, fz, h] of [[holePos.x + 4.6, holePos.z - 3.2, 1.7], [holePos.x + 8.2, holePos.z - 3.8, 1.62]]) {
    const fig = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, h - 0.9, 4, 8), figMat); body.position.y = h * 0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), figMat); head.position.y = h - 0.05;
    fig.add(body, head);
    fig.position.set(fx, 0.1, fz);
    fig.lookAt(holePos.x, 0.4, holePos.z);
    g.add(fig);
  }
  // 冰洞口：黑水洞口 + 周围一圈锯痕
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color: 0x04141c }));
  hole.rotation.x = -Math.PI / 2; hole.position.set(holePos.x, 0.14, holePos.z);
  const rim = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 20), new THREE.MeshStandardMaterial({ color: 0xd8e8ee, roughness: 0.8 }));
  rim.rotation.x = -Math.PI / 2; rim.position.set(holePos.x, 0.15, holePos.z);
  g.add(hole, rim);
  return g;
}

// 云：高空软片，慢慢飘
function makeClouds(rng, n) {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: softSprite(), color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(mat);
    const a = rng() * Math.PI * 2, r = range(rng, 60, 160);
    s.position.set(Math.cos(a) * r, range(rng, 45, 90), Math.sin(a) * r);
    const k = range(rng, 30, 70);
    s.scale.set(k, k * 0.32, 1);
    g.add(s);
  }
  return g;
}

export function buildSurface(map, uni, entryPos, boatPos, entryR = 2.2) {
  const rng = universeRng(map.id, `${uni.seed}::surface`);
  const kind = map.kind || 'cave';
  const entry = entryPos.clone ? entryPos.clone() : entryPos;
  entry.r = entryR;
  const group = new THREE.Group();
  group.name = 'surfaceworld';
  group.visible = false;   // 出水那一刻才亮出来

  group.add(makeSky(map));
  group.add(makeClouds(rng, kind === 'ice' ? 0 : 4));

  // 太阳 + 天光（水下那套环境光留给水下，出水要更敞亮）
  const sun = new THREE.DirectionalLight(kind === 'ice' ? 0xf0f4f8 : 0xfff2dc, 2.6);
  sun.position.set(45, 60, -60);
  const hemi = new THREE.HemisphereLight(kind === 'ice' ? 0xd8e8f0 : 0xbfd8e8, 0x30404a, 0.9);
  group.add(sun, hemi);

  let standPos, face;
  const yawTo = (tx, tz, fx, fz) => Math.atan2(-(tx - fx), -(tz - fz));   // yaw 约定：0 = -Z
  if (kind === 'ocean') {
    const wp = makeWaterPlane(map, 220);
    group.add(wp.mesh);
    group.userData.water = wp.u;
    const bp = boatPos || entry;
    const boat = makeBoat();
    boat.position.set(bp.x - 4.5, 0.2, bp.z - 2);
    boat.rotation.y = 0.4;
    group.add(boat);
    // 正常出口扒在船尾梯边；漂远了出水就原地漂着，船在天际线那头
    standPos = boatPos ? new THREE.Vector3(entry.x, 0.45, entry.z) : new THREE.Vector3(entry.x + 0.5, 0.55, entry.z + 0.5);
    face = yawTo(bp.x, bp.z, standPos.x, standPos.z);                    // 面朝船的方向
  } else if (kind === 'ice') {
    group.add(makeIceField(rng, entry));
    standPos = new THREE.Vector3(entry.x + 2.6, 1.15, entry.z + 0.4);   // 跪坐在冰洞边
    face = yawTo(entry.x + 6.5, entry.z - 4.5, standPos.x, standPos.z);  // 面朝接应营地
  } else {
    const wp = makeWaterPlane(map, Math.min(60, entry.r * 2.2 + 4));      // 天坑里的一池水
    group.add(wp.mesh);
    group.userData.water = wp.u;
    group.add(makeCenote(rng, entry, map.water.glow));
    const a = rng() * Math.PI * 2;
    standPos = new THREE.Vector3(entry.x + Math.cos(a) * entry.r * 0.72, 1.5, entry.z + Math.sin(a) * entry.r * 0.72); // 坑边石头上，回望水潭
    face = yawTo(entry.x, entry.z, standPos.x, standPos.z);              // 面朝水潭和天坑口
  }
  group.userData.update = (dt, t) => {
    if (group.userData.water) group.userData.water.uT.value = t;
  };
  return { group, standPos, kind, face };
}
