// 海潜世界冒烟：stub DOM -> buildOcean -> 校验海底/沉船碰撞、节点、锚绳、水面、生物数据
const stubCtx = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: () => { }, fillRect: () => { }, fillText: () => { },
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
});
globalThis.document = { createElement: (t) => ({ width: 0, height: 0, getContext: stubCtx, toDataURL: () => 'data:', style: {} }) };
const { buildOcean, makeTerrain } = await import('../client/src/engine/ocean.js');
const { makeUniverse } = await import('../shared/universe.js');
const { MAPS, SPECIES } = await import('../shared/maps.js');
const THREE = await import('three');

let fail = 0;
const ok = (c, m) => { console.log(c ? `  ✓ ${m}` : `  ✗ ${m}`); if (!c) fail++; };

for (const map of MAPS.filter(m => m.kind === 'ocean')) {
  for (const seed of ['OC-A', 'OC-B']) {
    const uni = makeUniverse(map.id, seed);
    const w = buildOcean(map, uni), { h } = makeTerrain(map, uni.seed);
    ok(w.group.getObjectByName('cave')?.geometry.index.count > 10000, `${map.id} 海底网格`);
    ok(w.nodes.length === map.route.length && w.nodes[0].pos.y < 0 && w.nodes[0].pos.y > -1, `${map.id} 节点 ${w.nodes.length}，船在水面`);
    ok(w.nodes.slice(1).every(n => n.pos.y > h(n.pos.x, n.pos.z) - 0.5 && n.pos.y < 0), `${map.id} 节点在海底之上、水面之下`);
    // 海底碰撞：从海底下方 clamp 回地面之上；幂等
    const p = new THREE.Vector3(5, h(5, -30) - 3, -30);
    ok(w.nav.clamp(p, 0.45) && p.y >= h(5, -30) + 0.4 && !w.nav.clamp(p, 0.45), `${map.id} 海底 clamp 生效且幂等`);
    // 边界
    const q = new THREE.Vector3(map.ocean.half * 3, -3, 0);
    ok(w.nav.clamp(q) && Math.abs(q.x) < map.ocean.half, `${map.id} 边界 clamp`);
    // 贴地判定与洞穴同形
    const c = w.nav.closest(new THREE.Vector3(0, h(0, -20) + 0.5, -20));
    ok(c.clearance < c.r * 0.5, `${map.id} 贴地 clearance=${c.clearance.toFixed(2)} < r/2`);
    ok(w.linePts.length > 3 && w.linePts[0].y < 0 && w.mainSpine.length > 20, `${map.id} 锚绳 ${w.linePts.length} 点 / 脊线 ${w.mainSpine.length}`);
    ok(w.skylights.length > 0 && w.surfaces.length === 1 && typeof w.update === 'function', `${map.id} 水面/天窗/update`);
    ok(w.objectiveSpot.pos.y < 0 && w.objectiveSpot.pos.y > -100, `${map.id} 目标点 ${w.objectiveSpot.name} y=${w.objectiveSpot.pos.y.toFixed(1)}`);
    // 物种都登记过
    const unknown = map.creatures.filter(s => !SPECIES[s]);
    ok(!unknown.length, `${map.id} 物种均已登记${unknown.length ? ' 缺:' + unknown : ''}`);
  }
  if (map.ocean.wreck) {
    const uni = makeUniverse(map.id, 'OC-A'), w = buildOcean(map, uni);
    ok(w.boxes.length > 15, `${map.id} 沉船碰撞箱 ${w.boxes.length}`);
    const b = w.boxes.find(x => x.max.y - x.min.y > 3);   // 一段侧壁
    const mid = b.min.clone().add(b.max).multiplyScalar(0.5);
    ok(w.nav.clamp(mid, 0.45), `${map.id} 船壁内部点被推出`);
    const hold = new THREE.Vector3(w.nodes[5].pos.x, w.nodes[5].pos.y, w.nodes[5].pos.z);
    const before = hold.clone();
    ok(!w.nav.clamp(hold, 0.45) && hold.distanceTo(before) < 1e-6, `${map.id} 货舱内部可自由游动（不被碰撞箱卡住）`);
    // 海图室（节点 8）与其余节点都不应卡在碰撞体/道具里
    const room = w.nodes[8].pos.clone();
    ok(!w.nav.clamp(room, 0.45), `${map.id} 海图室内部可自由游动`);
    const stuck = w.nodes.filter(n => w.nav.clamp(n.pos.clone(), 0.45)).map(n => n.name);
    ok(!stuck.length, `${map.id} 无节点卡在碰撞体内${stuck.length ? ' 卡住:' + stuck : ''}`);
  }
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
