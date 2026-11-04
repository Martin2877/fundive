// 冰潜世界冒烟：stub DOM -> buildIce -> 校验湖底/冰盖/冰洞碰撞、节点、安全绳、生物数据
const stubCtx = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: () => { }, fillRect: () => { }, fillText: () => { },
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
});
globalThis.document = { createElement: (t) => ({ width: 0, height: 0, getContext: stubCtx, toDataURL: () => 'data:', style: {} }) };
const { buildIce, makeIceTerrain } = await import('../client/src/engine/ice.js');
const { populateIce } = await import('../client/src/engine/marine.js');
const { makeUniverse } = await import('../shared/universe.js');
const { MAPS, SPECIES, ENDINGS } = await import('../shared/maps.js');
const THREE = await import('three');

let fail = 0;
const ok = (c, m) => { console.log(c ? `  ✓ ${m}` : `  ✗ ${m}`); if (!c) fail++; };

ok(!!ENDINGS.hypothermia, '失温结局已登记');
for (const map of MAPS.filter(m => m.kind === 'ice')) {
  for (const seed of ['ICE-A', 'ICE-B']) {
    const uni = makeUniverse(map.id, seed);
    const w = buildIce(map, uni), { h } = makeIceTerrain(map, uni.seed);
    ok(w.group.getObjectByName('cave')?.geometry.index.count > 10000, `${map.id} 湖底网格`);
    ok(w.nodes.length === map.route.length && w.nodes[0].pos.y < 0 && w.nodes[0].pos.y > -1, `${map.id} 节点 ${w.nodes.length}，冰洞在水面`);
    ok(w.nodes.slice(1).every(n => n.pos.y > h(n.pos.x, n.pos.z) - 0.5 && n.pos.y < 0), `${map.id} 节点在湖底之上、冰盖之下`);
    // 湖底碰撞：从湖底下方 clamp 回地面之上；幂等
    const p = new THREE.Vector3(5, h(5, -30) - 3, -30);
    ok(w.nav.clamp(p, 0.45) && p.y >= h(5, -30) + 0.4 && !w.nav.clamp(p, 0.45), `${map.id} 湖底 clamp 生效且幂等`);
    // 冰盖碰撞：远离冰洞处不允许升过冰盖下缘
    const u = new THREE.Vector3(30, 0.2, -50);
    ok(w.nav.clamp(u, 0.45) && u.y < -0.4, `${map.id} 冰盖挡顶（远离冰洞升不上水面）y=${u.y.toFixed(2)}`);
    // 冰洞内可以升到洞口水面
    const q = new THREE.Vector3(w.entryPos.x, 0.4, w.entryPos.z);
    ok(w.nav.clamp(q, 0.45) && q.y > -0.5 && q.y < 0, `${map.id} 冰洞内可升到洞口 y=${q.y.toFixed(2)}`);
    // 边界
    const b = new THREE.Vector3(map.ice.half * 3, -3, 0);
    ok(w.nav.clamp(b) && Math.abs(b.x) < map.ice.half, `${map.id} 边界 clamp`);
    // 贴地判定与洞穴同形
    const c = w.nav.closest(new THREE.Vector3(0, h(0, -20) + 0.5, -20));
    ok(c.clearance < c.r * 0.5, `${map.id} 贴地 clearance=${c.clearance.toFixed(2)} < r/2`);
    ok(w.linePts.length > 10 && w.linePts[0].y < 0 && w.mainSpine.length > 20, `${map.id} 安全绳 ${w.linePts.length} 点 / 脊线 ${w.mainSpine.length}`);
    ok(w.linePts[0].y > w.linePts[1].y - 2 && w.linePts[0].y < 0, `${map.id} 安全绳从洞口垂下`);
    ok(w.skylights.length > 0 && typeof w.update === 'function', `${map.id} 天窗/update`);
    ok(w.objectiveSpot.pos.y < 0 && w.objectiveSpot.pos.y > -100, `${map.id} 目标点 ${w.objectiveSpot.name || ''} y=${w.objectiveSpot.pos.y.toFixed(1)}`);
    // 冰盖下表面取点（冰藻挂点）
    const cp = w.ceilPoint(new THREE.Vector3(-8, -3, -26));
    ok(cp.y < -0.4 && cp.y > -2, `${map.id} 冰盖取点 y=${cp.y.toFixed(2)}`);
    // 无节点卡在碰撞体里
    const stuck = w.nodes.filter(n => w.nav.clamp(n.pos.clone(), 0.45) && n.pos.y > h(n.pos.x, n.pos.z) - 0.6).map(n => n.name);
    ok(!stuck.filter(n => n !== '冰洞').length, `${map.id} 无节点卡死${stuck.length ? ' 卡:' + stuck : ''}`);
    // 生物布点：能 spawn 且不报错
    const scene = new THREE.Group();
    const pop = populateIce(scene, w, map, uni);
    ok(pop.entities.length > 3 && pop.photoables.length > 3, `${map.id} 冰下生物 ${pop.entities.length} 只 / 可拍 ${pop.photoables.length}`);
    const unknown = map.creatures.filter(s => !SPECIES[s]);
    ok(!unknown.length, `${map.id} 物种均已登记${unknown.length ? ' 缺:' + unknown : ''}`);
  }
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
