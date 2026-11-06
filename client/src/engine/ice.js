// 冰潜世界：封死的冰盖（顶部碰撞，唯一出口是冰洞）+ 缓坡湖底 + 冰洞光柱与安全绳。
// 对外接口与 buildOcean 同形（group/nav/nodes/mainSpine/linePts/skylights/update…）。
import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { universeRng, range, chance, intRange } from '@fundive/shared/rng.js';
import { makeCaveMaterial, CAUSTIC } from './materials.js';
import { quality } from './quality.js';

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ICE_TOP = -0.05;   // 冰面上沿（冰洞口的水面线）

export function makeIceTerrain(map, seed) {
  const g = map.ice;
  let ox = 0, oz = 0, amp = 1, len = g.len;
  if (seed != null) {
    const trng = universeRng(map.id, `${seed}::terrain`);
    ox = range(trng, -50, 50); oz = range(trng, -50, 50);
    amp = range(trng, 0.75, 1.35); len = g.len * range(trng, 0.85, 1.2);
  }
  const h = (x, z) => -(g.shallow + (g.deep - g.shallow) * smooth(0, 1, -z / len))
    + fbm3(x * 0.05 + 7 + ox, 0, z * 0.05 + oz, 3) * g.rough * 2.0 * amp
    + fbm3(x * 0.2 + ox, 0, z * 0.2 + oz, 2) * 0.3 * g.rough * amp;
  return { h };
}

// 冰盖下缘起伏（冰瘤）：湖面不可能是平的
const ceilBump = (x, z) => fbm3(x * 0.09 + 3, 5, z * 0.09, 3) * 0.35 + fbm3(x * 0.3, 5, z * 0.3, 2) * 0.1;

export function buildIce(map, uni) {
  const g = map.ice, rng = universeRng(map.id, `${uni.seed}::ice`);
  const QC = quality.level;
  const group = new THREE.Group();
  const { h } = makeIceTerrain(map, uni.seed);
  const CEIL = g.ceilY ?? -0.55;
  const hole = new THREE.Vector3(0, ICE_TOP - 0.3, 0), HOLE_R = 1.7;
  // 冰山根：一座冻住的冰山把"天花板"压下来一大块——可以从底下穿过去
  const berg = g.berg;
  const bergDrop = (x, z) => berg ? berg.depth * (1 - smooth(berg.r * 0.55, berg.r * 1.1, Math.hypot(x - berg.x, z - berg.z))) : 0;
  const ceilY = (x, z) => CEIL + ceilBump(x, z) - bergDrop(x, z);

  // —— 湖底网格 ——（多铺 60m：边界外看到的仍是延伸的湖床与冰盖，不是虚空）
  const SEG = 140, size = (g.half + 60) * 2;
  const tg = new THREE.PlaneGeometry(size, size, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pa = tg.attributes.position, col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i), y = h(x, z);
    pa.setY(i, y);
    const dark = 0.75 + 0.3 * fbm3(x * 0.25, y, z * 0.25, 2);
    col[i * 3] = 0.72 * dark; col[i * 3 + 1] = 0.78 * dark; col[i * 3 + 2] = 0.8 * dark;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, makeCaveMaterial({ sand: 1, normalK: 0.6 }));
  terrain.name = 'cave';
  group.add(terrain);

  // —— 冰盖：整片顶盖（下表面可见，冰瘤起伏），冰洞处开三角口 ——
  const cg = new THREE.PlaneGeometry(size, size, 130, 130);
  cg.rotateX(Math.PI / 2);   // 法线朝下（从水下看）
  const cp = cg.attributes.position, ccol = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), z = cp.getZ(i);
    const dh = Math.hypot(x - hole.x, z - hole.z);
    let y = ceilY(x, z);
    if (dh < HOLE_R * 1.6) y += (HOLE_R * 1.6 - dh) / (HOLE_R * 1.6) * (ICE_TOP - y + 0.9);   // 洞口抬成漏斗
    cp.setY(i, y);
    const d = Math.max(0, -y - 2) * 0.04, nearHole = Math.exp(-dh * dh / 90);
    const bergGlow = berg ? Math.exp(-(Math.hypot(x - berg.x, z - berg.z) ** 2) / (berg.r * berg.r * 0.8)) * 0.24 : 0;
    ccol[i * 3] = 0.5 + nearHole * 0.38 - d; ccol[i * 3 + 1] = 0.68 + nearHole * 0.2 + bergGlow - d * 0.5; ccol[i * 3 + 2] = 0.82 + bergGlow * 0.4 - d * 0.3;
  }
  cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  cg.computeVertexNormals();
  const ceiling = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0.0, transparent: true, opacity: 0.92,
    emissive: 0x2a4a58, emissiveIntensity: 0.22,
  }));
  group.add(ceiling);

  // —— 冰柱林：倒挂在冰盖下的锥簇（越往深处越密）。哑光不透明——低糙度+半透明的上百个
  // 小锥面在灯下会炸成一片碎闪（冰潜"闪光太多"的来源） ——
  const nIc = { low: 60, mid: 110, high: 180 }[QC];
  const icicles = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 1, 6), new THREE.MeshStandardMaterial({ color: 0xa9ccd8, roughness: 0.85 }), nIc);
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  let ni = 0;
  for (let i = 0; i < nIc * 3 && ni < nIc; i++) {
    const x = range(rng, -g.half * 0.8, g.half * 0.8), z = range(rng, -g.half * 0.9, -8);
    const cl = range(rng, 0, 1) < 0.3 ? range(rng, 0.8, 2.6) : range(rng, 0.15, 0.8);
    E.set(Math.PI, 0, range(rng, -0.15, 0.15)); Q.setFromEuler(E);
    M4.compose(new THREE.Vector3(x, ceilY(x, z) - cl / 2 + 0.05, z), Q, S.set(range(rng, 0.5, 1.4), cl, range(rng, 0.5, 1.4)));
    icicles.setMatrixAt(ni++, M4);
  }
  icicles.count = ni;
  group.add(icicles);

  // —— 湖底冰块（落水冰/anchor ice） ——
  const nIce = { low: 40, mid: 70, high: 110 }[QC];
  const iceBlocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: 0xb8d4de, roughness: 0.85 }), nIce);
  const boxes = [];
  for (let i = 0; i < nIce; i++) {
    const x = range(rng, -g.half * 0.8, g.half * 0.8), z = range(rng, -g.half * 0.9, -6);
    const y = h(x, z), k = range(rng, 0.3, 1.6);
    E.set(rng() * 3, rng() * 3, rng() * 3); Q.setFromEuler(E);
    M4.compose(new THREE.Vector3(x, y + k * 0.2, z), Q, S.set(k, k * 0.6, k));
    iceBlocks.setMatrixAt(i, M4);
    if (k > 0.9) boxes.push({ min: new THREE.Vector3(x - k, y, z - k), max: new THREE.Vector3(x + k, y + k * 0.55, z + k) });
  }
  group.add(iceBlocks);

  // —— 冰洞：光柱 + 洞口木梯 + 三角冰洞沿 ——
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying float vY; uniform float uT; uniform float uFade;
      void main(){ float a = smoothstep(-0.5, 0.5, vY) * 0.4 + 0.06; gl_FragColor = vec4(0.55, 0.9, 1.0, a * uFade * (0.85 + 0.15 * sin(mod(uT, 8.976) * 0.7))); }`,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(HOLE_R * 1.5, HOLE_R * 0.8, 9, 18, 1, true), shaftMat);
  shaft.position.set(hole.x, -4.5, hole.z);
  group.add(shaft);
  // 洞口一圈撬起的冰沿 + 一架木梯
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4e4ea, roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28, r0 = HOLE_R + range(rng, 0.1, 0.5);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(range(rng, 0.4, 0.9), range(rng, 0.25, 0.6), range(rng, 0.4, 0.8)), rimMat);
    blk.position.set(hole.x + Math.cos(a) * r0, ICE_TOP - 0.1, hole.z + Math.sin(a) * r0);
    blk.rotation.set(range(rng, -0.4, 0.4), rng() * 3, range(rng, -0.3, 0.3));
    group.add(blk);
  }
  const ladder = new THREE.Group();
  const lm = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.8 });
  for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 5), lm); r.position.set(0, 0, s * 0.2); ladder.add(r); }
  for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 5), lm); st.rotation.x = Math.PI / 2; st.position.y = 1.4 - i * 0.55; ladder.add(st); }
  ladder.position.set(hole.x - 0.5, -1.6, hole.z);
  group.add(ladder);

  // —— 节点 ——
  const nodes = map.route.map((n, i) => {
    const pos = n.surface ? new THREE.Vector3(n.p[0], ICE_TOP - 0.3, n.p[2])
      : n.abs ? new THREE.Vector3(n.p[0], n.p[1], n.p[2])
      : new THREE.Vector3(n.p[0], h(n.p[0], n.p[2]) + n.p[1] + n.r * 0.5, n.p[2]);
    return { i, pos, r: n.r, name: n.name, feats: n.feats || [], room: n.room, sky: n.sky, inside: false, sample: i };
  });

  // —— 碰撞：湖底 + 冰盖（冰洞内可升出水面）+ 冰块 + 边界 ——
  const surfaceBelow = (x, y, z) => {
    let f = h(x, z);
    for (const b of boxes) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= y + 0.3) f = Math.max(f, b.max.y);
    return f;
  };
  const lim = g.half - 3;
  const nav = {
    clamp(pos, radius = 0.45) {
      let hit = false;
      if (Math.abs(pos.x) > lim) { pos.x = Math.sign(pos.x) * lim; hit = true; }
      if (Math.abs(pos.z) > lim) { pos.z = Math.sign(pos.z) * lim; hit = true; }
      for (const b of boxes) {
        const x0 = b.min.x - radius, x1 = b.max.x + radius, y1 = b.max.y + radius, z0 = b.min.z - radius, z1 = b.max.z + radius;
        if (pos.x <= x0 || pos.x >= x1 || pos.y <= b.min.y || pos.y >= y1 || pos.z <= z0 || pos.z >= z1) continue;
        pos.y = y1; hit = true;
      }
      const f = h(pos.x, pos.z) + radius;
      if (pos.y < f) { pos.y = f; hit = true; }
      // 冰盖：洞内可升到洞口水面，洞外不许碰冰
      const inHole = Math.hypot(pos.x - hole.x, pos.z - hole.z) < HOLE_R;
      const top = inHole ? ICE_TOP - 0.08 : ceilY(pos.x, pos.z) - radius;
      if (pos.y > top) { pos.y = top; hit = true; }
      return hit;
    },
    closest(pos, out = { p: new THREE.Vector3(), r: 3, dist: 0, s: 0, path: 'main', tan: UP }) {
      const d = pos.y - surfaceBelow(pos.x, pos.y, pos.z);
      out.p.copy(pos).add(UP); out.r = 3; out.dist = 3 - d; out.clearance = d; out.s = 0; out.path = 'main'; out.tan = UP; out.smp = null;
      return out;
    },
  };
  const wallPoint = (pos) => {
    const f = surfaceBelow(pos.x, pos.y + 1, pos.z);
    return { pos: new THREE.Vector3(pos.x, f, pos.z), inward: UP.clone(), sample: null };
  };
  // 冰盖下表面取点（给冰藻这类"倒挂"物种用）
  const ceilPoint = (pos) => new THREE.Vector3(pos.x, ceilY(pos.x, pos.z), pos.z);

  // —— 主脊线 ——
  const mainSpine = [];
  let acc = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i].pos, b = nodes[i + 1].pos, len = a.distanceTo(b), n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < n; k++) mainSpine.push({ p: a.clone().lerp(b, k / n), r: nodes[i].r, s: acc + len * k / n });
    acc += len;
  }
  mainSpine.push({ p: nodes[nodes.length - 1].pos.clone(), r: nodes[nodes.length - 1].r, s: acc });

  // —— 安全绳：洞口垂直绳 + 沿路线一路牵，末端回到洞口下方 ——
  const linePts = [];
  for (let y = ICE_TOP - 0.3; y > nodes[1].pos.y; y -= 1.2) linePts.push(new THREE.Vector3(nodes[1].pos.x, y, nodes[1].pos.z));
  for (let i = 1; i < nodes.length; i++) {
    const a = i === 1 ? new THREE.Vector3(nodes[1].pos.x, nodes[1].pos.y, nodes[1].pos.z) : nodes[i - 1].pos, b = nodes[i].pos;
    const n = Math.max(2, Math.round(a.distanceTo(b) / 1.6));
    for (let k = 1; k <= n; k++) { const p = a.clone().lerp(b, k / n); p.y = Math.max(p.y - 1.1, h(p.x, p.z) + 0.35); linePts.push(p); }
  }
  const back = nodes[nodes.length - 1].pos.clone().lerp(new THREE.Vector3(nodes[1].pos.x, nodes[1].pos.y, nodes[1].pos.z), 0.9);
  back.y = Math.max(back.y, h(back.x, back.z) + 0.4);
  linePts.push(back);
  let lineGap = null;
  if (uni.mods.lineBreak && linePts.length > 20) {
    const a = Math.round(linePts.length * range(rng, 0.4, 0.65));
    lineGap = linePts[a].clone();
    linePts.splice(a, 5);
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xb09018, roughness: 0.95 });
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(linePts), Math.min(500, linePts.length * 2), 0.018, 4), lineMat));

  // —— 天窗：冰洞是主光源，远处一两道冰缝漏光；冰山图被山体挡光，洞口光域收小 ——
  // 冰下光被冰盖漫射，焦散压暗（恢复默认值见 cave.js/ocean.js 同行）
  const skylights = [{ pos: hole.clone(), r: berg ? 5.5 : 7.5 }];
  if (chance(rng, 0.8)) skylights.push({ pos: new THREE.Vector3(range(rng, -30, 30), CEIL, range(rng, -80, -30)), r: 4.5 });
  skylights.slice(0, 4).forEach((sk, i) => CAUSTIC.uSky.value[i].set(sk.pos.x, CEIL, sk.pos.z, sk.r));
  CAUSTIC.uSkyN.value = skylights.length;
  CAUSTIC.uCCol.value.setRGB(0.24, 0.45, 0.58);

  const objNode = nodes[Math.min(uni.objective.at, nodes.length - 1)];
  const objSpot = wallPoint(objNode.pos).pos.clone();
  objSpot.y += objNode.r * 0.5;

  return {
    group, nav, wallPoint, ceilPoint, mainSpine, kind: 'ice', terrainH: h, surfaceBelow, boxes,
    nodes, skylights, surfaces: [], shaftMat, linePts, lineGap,
    pockets: [], branchInfo: [], flowZones: [], photoables: [], creatureAnchors: [], siltZones: [
      { pos: new THREE.Vector3(-10, h(-10, -70) + 1, -70), r: 5 },
      { pos: new THREE.Vector3(10, h(10, -88) + 1, -88), r: 6 },
    ],
    entryPos: hole, entryR: 2.6, spawnPos: new THREE.Vector3(hole.x, -2.1, hole.z - 1.2), objectiveSpot: { pos: objSpot, name: objNode.name },
    update(dt, depth, camPos) {
      shaftMat.uniforms.uT.value += dt;
      // 远处看光柱要融进水雾里——additive 材质不吃雾，手动按相机距离淡出
      if (camPos) shaftMat.uniforms.uFade.value = Math.min(1.2, Math.max(0.12, 1.35 - Math.hypot(camPos.x - hole.x, camPos.y + 4.5, camPos.z - hole.z) / 55));
      for (const sk of skylights) sk._t = (sk._t || 0) + dt;
    },
  };
}
