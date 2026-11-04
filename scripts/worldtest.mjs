// 世界生成冒烟：stub DOM -> buildCave -> 校验碰撞场/引导绳/节点映射
const stubCtx = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: () => { }, fillRect: () => { }, fillText: () => { },
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
});
globalThis.document = { createElement: (t) => ({ width: 0, height: 0, getContext: stubCtx, toDataURL: () => 'data:', style: {} }) };

const { buildCave } = await import('../client/src/engine/cave.js');
const { makeUniverse } = await import('../shared/universe.js');
const { MAPS } = await import('../shared/maps.js');
const THREE = await import('three');

let fail = 0;
const ok = (c, m) => { console.log(c ? `  ✓ ${m}` : `  ✗ ${m}`); if (!c) fail++; };

for (const map of MAPS.filter(m => m.kind !== 'ocean')) {
  for (const seed of ['TEST-A', 'TEST-B']) {
    const uni = makeUniverse(map.id, seed);
    const cave = buildCave(map, uni);
    // 1) 网格有面
    const mesh = cave.group.getObjectByName('cave');
    ok(mesh && mesh.geometry.index.count > 1000, `${map.id} 网格三角形 ${mesh?.geometry.index.count / 3 | 0}`);
    // 2) 主路径点都在碰撞场内（clearance > 0）
    const inside = cave.mainSpine.every(s => cave.nav.closest(s.p).clearance > -0.01);
    ok(inside, `${map.id} spine 在碰撞场内`);
    // 3) 随机点 clamp 后 clearance >= 下限
    const testP = cave.mainSpine[10].p.clone().add(new THREE.Vector3(cave.mainSpine[10].r * 3, 0, 0));
    const d0 = cave.nav.closest(testP).dist;
    const hit = cave.nav.clamp(testP, 0.45);
    const c = cave.nav.closest(testP);
    ok(hit && c.dist < d0 && !cave.nav.clamp(testP, 0.45), `${map.id} clamp 生效且幂等 ${d0.toFixed(2)} -> ${c.dist.toFixed(2)} (r=${c.r.toFixed(1)})`);
    // 3b) 碰撞边界与可见洞壁一致：玩家贴墙时不会穿入网格（到最近洞壁顶点 > 0.1m）
    const pos = mesh.geometry.attributes.position;
    let worst = Infinity;
    for (let k = 0; k < 40; k++) {
      const sm = cave.mainSpine[Math.floor((k + 0.5) / 40 * (cave.mainSpine.length - 1))];
      const off = new THREE.Vector3(Math.cos(k * 2.4), Math.sin(k * 1.7) * 0.4, Math.sin(k * 2.4)).multiplyScalar(sm.r * 4).add(sm.p);
      cave.nav.clamp(off, 0.45);
      let best = Infinity;
      for (let i = 0; i < pos.count; i += 3) best = Math.min(best, Math.hypot(pos.getX(i) - off.x, pos.getY(i) - off.y, pos.getZ(i) - off.z));
      worst = Math.min(worst, best);
    }
    ok(worst > 0.1, `${map.id} 贴墙最近洞壁顶点距离 ${worst.toFixed(2)}m`);
    // 4) 引导绳
    ok(cave.linePts.length > 10, `${map.id} 引导绳 ${cave.linePts.length} 点`);
    // 5) 目标点有坐标
    ok(cave.objectiveSpot.pos.length() > 0, `${map.id} 目标点 ${cave.objectiveSpot.name || '主通道'}`);
    // 5b) 碰撞段长度合理：岩盖延伸段 ≈1.1×壁半径，普通 spine 段 ≈STEP；
    //     若出现远超半径的长段，说明放样顶点被共享向量串扰（曾导致巨型横穿石板+失控岩盖）
    const maxSeg = Math.max(...cave.nav.segs.map(s => s.b.p.distanceTo(s.a.p) / Math.max(1, s.a.r)));
    ok(maxSeg < 3, `${map.id} 碰撞段长径比 ${maxSeg.toFixed(2)} < 3`);
    // 6) 节点映射完整
    ok(cave.nodes.every(n => Number.isInteger(n.sample)), `${map.id} 节点->spine 映射`);
  }
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
