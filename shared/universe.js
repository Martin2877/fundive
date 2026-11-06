// 平行宇宙生成器 — 同一个 mapId + 不同 seed => 同一洞穴的不同平行现实。
// 确定性：客户端各自用 seed 生成，结果一致，天然支持多人同宇宙共潜。
import { universeRng, pick, weighted, chance, range, intRange, shuffled, universeName } from './rng.js';
import { getMap, spName, SPECIES } from './maps.js';
import { STORY, SIDE_ITEMS } from './story.js';
import { t } from './i18n.js';

const SALVAGE_ITEMS = [
  { id: 'divecomp', name: '卡在岩缝的潜水电脑', w: 2.2, glow: 0x7fd8ff },
  { id: 'plaque',   name: '泡涨的纪念牌',       w: 3.5, glow: 0xd8b06a },
  { id: 'camera',   name: '掉队的运动相机',     w: 1.4, glow: 0x9fe8c0 },
  { id: 'reel',     name: '缠成麻花的线轮',     w: 2.8, glow: 0xffd27f },
  { id: 'fin',      name: '单身脚蹼',           w: 1.0, glow: 0x9aa7ff },
  { id: 'torch',    name: '熄灭的老式电筒',     w: 1.2, glow: 0xffe0a0 },
  { id: 'liftbag',  name: '没充起来的浮力袋',   w: 2.0, glow: 0xff8a6a },
  { id: 'tag',      name: '刻着日期的黄铜标签', w: 0.8, glow: 0xd8c27f },
];

const VICTIMS = [
  { id: 'lost_diver', name: '迷路的潜水员', note: '灯还亮着，人已经慌得只会原地踢水。' },
  { id: 'kid',        name: '被困的队员',   note: '抱着膝盖坐在气室边上，等你很久了。' },
  { id: 'old_timer',  name: '逞强的老潜水员', note: '嘴硬说不用救，气表说不了谎。' },
  { id: 'photog',     name: '拍丢了的摄影师', note: '相机挂绳还缠在手腕上，人已经分不清上下。' },
  { id: 'mapper',     name: '测图的绘图员', note: '抱着测绘板不撒手，说什么也不肯先走。' },
];

// 彩蛋事件池 —— 低概率的宇宙风味
const EASTER_EGGS = [
  { id: 'ghost_light', name: '远处的灯',   w: 6,  desc: '深处有一束不属于任何潜水员的光。' },
  { id: 'fossil_wall', name: '化石壁',     w: 10, desc: '整面岩壁都是古海贝的断面。' },
  { id: 'pearl_hoard', name: '珍珠窝',     w: 8,  desc: '某个浅盆里攒了一把洞穴珍珠。' },
  { id: 'fish_school', name: '鱼群',       w: 10, desc: '盲鱼群在大厅里转成一个环。' },
  { id: 'still',       name: '绝对静止',   w: 8,  desc: '这个宇宙的水静得能听见自己的心跳。' },
  { id: 'reverse_flow',name: '逆流',       w: 7,  desc: '今天这条河往洞里流。' },
];

export function makeUniverse(mapId, seed) {
  const map = getMap(mapId);
  if (!map) throw new Error(`unknown map: ${mapId}`);
  const rng = universeRng(mapId, seed);
  const h = map.hazards || {};

  // —— 目标：从地图允许的目标类型中加权抽取 ——
  const objType = weighted(rng, map.objectives.map(o => [
    o, o === 'explore' ? 3 : o === 'photo' ? 3 : o === 'salvage' ? 2.4 : o === 'survey' ? 2.2 : 2.6,
  ]));
  // 目标压在路线的最后两节——引绳一路带你到它边上，不会在半路摸黑找
  const deepIdx = Math.max(2, map.route.length - 1 - intRange(rng, 0, Math.min(1, map.route.length - 3)));
  const deepNode = map.route[deepIdx];

  const objective = { type: objType, at: deepIdx, place: deepNode.name || '主通道深处' };
  if (objType === 'photo') {
    const photoable = map.creatures.filter(c => SPECIES[c] && SPECIES[c].cat !== 'microbe');
    objective.species = pick(rng, photoable);
    objective.quality = intRange(rng, 2, 3); // 需要的星级
  } else if (objType === 'salvage') {
    objective.item = pick(rng, SALVAGE_ITEMS);
  } else if (objType === 'rescue') {
    objective.victim = pick(rng, VICTIMS);
  } else if (objType === 'survey') {
    // 巡线标记：沿路线撒三处标记石（前/中/深），全部摸过才算
    const n = map.route.length;
    const legs = new Set([
      intRange(rng, Math.max(2, Math.floor(n * 0.3)), Math.floor(n * 0.55)),
      intRange(rng, Math.floor(n * 0.6), Math.floor(n * 0.8)),
      intRange(rng, Math.floor(n * 0.85), n - 1),
    ]);
    while (legs.size < 3) legs.add(Math.min(n - 1, Math.max(...legs) + 1));
    objective.legs = [...legs].sort((a, b) => a - b);
  }

  // —— 生物布点：每条路径的 feats + 地图上允许出现的物种 ——
  const placements = [];
  const speciesPool = map.creatures.slice();
  map.route.forEach((node, i) => {
    for (const f of node.feats || []) {
      if (speciesPool.includes(f)) placements.push({ sp: f, path: 'main', at: i });
    }
    // 大厅额外撒一两样
    if (node.room === 'hall' && chance(rng, 0.7)) {
      placements.push({ sp: pick(rng, speciesPool), path: 'main', at: i, off: [range(rng, -2, 2), range(rng, -1, 0.5), range(rng, -2, 2)] });
    }
  });
  (map.branches || []).forEach((b, bi) => {
    if (chance(rng, 0.65)) placements.push({ sp: pick(rng, speciesPool), path: `b${bi}`, at: b.pts.length - 1 });
  });
  // 目标生物若被抽中但布点里太少，补点
  if (objective.species && placements.filter(p => p.sp === objective.species).length < 2) {
    placements.push({ sp: objective.species, path: 'main', at: deepIdx });
    placements.push({ sp: objective.species, path: 'main', at: intRange(rng, 1, deepIdx - 1) });
  }

  // —— 宇宙修饰：能见度/水流/氮醉/设备/运气 ——
  const mods = {
    vis: range(rng, 0.7, 1.3) * (chance(rng, 0.12) ? 0.55 : 1),
    flow: (h.flow || 0) * range(rng, 0.6, 1.5) * (chance(rng, 0.1) ? -1 : 1),
    narcosis: (h.narcosis || 0) * range(rng, 0.5, 0.95),
    silt: (h.silt || 0.3) * range(rng, 0.8, 1.4),
    freeflow: chance(rng, (h.freeflow || 0) * 0.5),
    lineBreak: chance(rng, (h.lineBreak || 0)),
    blackout: chance(rng, 0.06),          // 灯半路烧掉的宇宙
    hallucination: (h.narcosis || 0) > 0.4 && chance(rng, 0.3) ? range(rng, 0.3, 1) : 0,
  };

  // —— 支线开闭：平行宇宙里有的岔洞通，有的塌 ——
  const branches = (map.branches || []).map((b, i) => ({
    i, kind: b.bottomless ? 'bottomless' : b.pocket ? 'pocket' : b.deadEnd ? 'dead' : 'side',
    open: chance(rng, b.deadEnd ? 0.85 : b.bottomless ? 0.85 : b.pocket ? 0.75 : 0.6),
    silted: chance(rng, 0.3),
  }));

  // —— 支线机缘（独立随机流，不扰动其他生成）：手记 / 遗落物 / 求助潜水员 ——
  const sides = [];
  if (STORY[mapId]) {
    const srng = universeRng(mapId, `${seed}::side`);
    const kinds = shuffled(srng, ['note', 'item', 'distress']).slice(0, 1 + (chance(srng, 0.55) ? 1 : 0) + (chance(srng, 0.2) ? 1 : 0));
    const last = map.route.length - 2;
    for (const kind of kinds) {
      const s = { id: `s_${kind}`, kind, node: intRange(srng, 1, last) };
      if (kind === 'note') s.idx = intRange(srng, 0, STORY[mapId].notes.length - 1);
      if (kind === 'item') {
        s.idx = intRange(srng, 0, SIDE_ITEMS.length - 1);
        const open = branches.filter(b => b.open && b.kind !== 'bottomless');
        if (open.length) s.branch = pick(srng, open).i;
      }
      if (kind === 'distress') s.node = intRange(srng, Math.min(3, last), last);
      sides.push(s);
    }
  }

  const eggs = EASTER_EGGS.filter(e => chance(rng, e.w / 40)).map(e => e.id);

  // —— 剧情变体：同一个洞、同一个宇宙，讲法不一样 ——
  const storyVar = intRange(rng, 0, 2);

  // —— 随机事件时刻表：宇宙种子排定的突发事件（联机各端一致，各发一次） ——
  const events = [];
  if (!map.hidden) {
    const erng = universeRng(mapId, `${seed}::events`);
    const kinds = ['rumble', 'omen'];
    if ((h.flow || 0) > 0.12 || map.kind === 'ocean') kinds.push('surge');
    if (!map.kind && (h.silt || 0) > 0.25) kinds.push('rockfall');
    if (!map.kind || map.kind === 'ice') kinds.push('flicker');
    if (map.kind === 'ocean') kinds.push('thermocline');
    if (map.kind === 'ice') kinds.push('creak', 'cold_snap');
    if (map.creatures.some(c => SPECIES[c]?.cat === 'fish')) kinds.push('shoal');
    const nEv = intRange(erng, 2, 4);
    let t0 = range(erng, 55, 130);
    for (let i = 0; i < nEv; i++) {
      events.push({ t: Math.round(t0), k: pick(erng, kinds) });
      t0 += range(erng, 80, 170);
    }
  }

  // 宇宙风味描述
  const flavor = [];
  if (mods.vis > 1.15) flavor.push('水比平常清');
  if (mods.vis < 0.85) flavor.push('水比平常浑');
  if (mods.flow > 0.4) flavor.push('水流偏强');
  if (mods.flow < -0.1) flavor.push('水流反常地往洞里走');
  if (mods.hallucination > 0) flavor.push('深处的东西可能不全是真的');
  if (mods.lineBreak) flavor.push('引绳在某处断过');
  if (mods.blackout) flavor.push('你的手电有接触不良');
  if (eggs.includes('fish_school')) flavor.push('今天鱼特别多');
  if (eggs.includes('still')) flavor.push('静得反常');

  return {
    mapId, seed,
    name: universeName(seed),
    objective, placements, mods, branches, eggs, flavor, sides,
    storyVar, events,
  };
}

// ———— 程序化支洞：宇宙种子决定，给每张洞潜图补支线岔路 ————
// 与 map.branches 同构的 def：{from,pts,r,endR?,name,pocket?,bottomless?,deadEnd?,kind,feats,open,to?}
// kind 扩展：'loop' 环道（to=接回的路线下标，末端不封岩盖）、'room' 尽头大厅、'side' 普通侧岔
// 独立随机流 '::sides'，不扰动既有生成。
export function genSideBranches(map, seed) {
  const rng = universeRng(map.id, `${seed}::sides`);
  const R = map.route, n = R.length;
  if (n < 4 || map.kind === 'ocean' || map.kind === 'ice' || map.hidden) return [];
  const used = new Set((map.branches || []).map(b => b.from));
  const out = [];
  const want = Math.min(5, Math.max(3, Math.round(n / 3)));
  let tries = 0;
  while (out.length < want && tries++ < 60) {
    const from = intRange(rng, 1, n - 2);
    if (used.has(from)) continue;
    const node = R[from];
    const a = R[Math.max(0, from - 1)].p, b = R[Math.min(n - 1, from + 1)].p;
    const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz) || 1;
    const side = chance(rng, 0.5) ? 1 : -1;
    const px = -dz / dl * side, pz = dx / dl * side;   // 主线的水平垂直方向
    const roll = rng();
    let def = null;
    if (roll < 0.2) {
      // 环道：从 from 岔出，绕一圈接回后面的节点——不是死路
      const to = Math.min(n - 1, from + intRange(rng, 2, 3));
      if (used.has(to)) continue;
      const d1 = range(rng, 8, 15), d2 = range(rng, 8, 15);
      def = {
        from, to, name: pick(rng, ['环道', '回廊岔', '绕洞']), kind: 'loop',
        pts: [
          [node.p[0] + px * d1, node.p[1] + range(rng, -3, 3), node.p[2] + pz * d1],
          [R[to].p[0] + px * d2, R[to].p[1] + range(rng, -3, 3), R[to].p[2] + pz * d2],
        ],
        r: range(rng, 2.0, 3.0),
      };
      used.add(to);
    } else if (roll < 0.42) {
      // 侧厅：窄廊尽头撑出大厅——同一张图里也有大小不同的空间
      const d1 = range(rng, 7, 13), d2 = range(rng, 12, 20), bend = chance(rng, 0.5) ? 1 : -0.4;
      const p1 = [node.p[0] + px * d1, node.p[1] + range(rng, -2, 2), node.p[2] + pz * d1];
      const p2 = [p1[0] + (px * 0.5 + dx / dl * bend) * (d2 - d1) * 0.7, p1[1] + range(rng, -3, 3), p1[2] + (pz * 0.5 + dz / dl * bend) * (d2 - d1) * 0.7];
      const silty = chance(rng, 0.45);
      def = { from, pts: [p1, p2], r: range(rng, 1.6, 2.4), endR: range(rng, 4.5, 7.5), kind: 'room',
        name: silty ? pick(rng, ['淤沙厅', '泥沙厅', '粉砂厅']) : pick(rng, ['侧厅', '圆石厅', '回声厅']),
        feats: silty ? ['stalactite', 'silt'] : ['stalactite'] };
    } else if (roll < 0.6) {
      // 上行井：竖直岔上去——顶端一半概率是气室
      const d = range(rng, 4, 8), pocket = chance(rng, 0.55);
      const p1 = [node.p[0] + px * d, node.p[1] + range(rng, 4, 7), node.p[2] + pz * d];
      const p2 = [p1[0] + px * range(rng, 2, 5), Math.min(-3.5, node.p[1] + range(rng, 9, 16)), p1[2] + pz * range(rng, 2, 5)];
      def = { from, pts: [p1, p2], r: range(rng, 1.5, 2.4), pocket, deadEnd: !pocket, name: pick(rng, ['上升井', '高窗岔', '天窗井']), kind: pocket ? 'pocket' : 'dead' };
      if (pocket) def.endR = range(rng, 3.5, 5.5);
    } else if (roll < 0.78) {
      // 下行竖井：垂直下探，多半探不到底
      const d = range(rng, 4, 9), bottomless = chance(rng, 0.6);
      const p1 = [node.p[0] + px * d, node.p[1] - range(rng, 6, 12), node.p[2] + pz * d];
      const p2 = [p1[0] + range(rng, -3, 3), p1[1] - (bottomless ? range(rng, 25, 55) : range(rng, 4, 8)), p1[2] + range(rng, -3, 3)];
      def = { from, pts: [p1, p2], r: range(rng, 1.4, 2.4), bottomless, deadEnd: !bottomless, name: pick(rng, ['下行竖井', '深井缝', '无底井']), kind: bottomless ? 'bottomless' : 'dead', feats: ['silt'] };
    } else if (roll < 0.9) {
      // 窄缝：勉强过人的裂隙——快踢会卡进去
      const d1 = range(rng, 6, 10), d2 = range(rng, 12, 18);
      const p1 = [node.p[0] + px * d1, node.p[1] + range(rng, -1.5, 1.5), node.p[2] + pz * d1];
      const p2 = [p1[0] + px * (d2 - d1) * 0.7 + range(rng, -3, 3), p1[1] + range(rng, -2, 2), p1[2] + pz * (d2 - d1) * 0.7 + range(rng, -3, 3)];
      def = { from, pts: [p1, p2], r: range(rng, 0.85, 1.05), deadEnd: true, name: pick(rng, ['窄缝', '裂隙']), kind: 'dead', feats: ['crack', 'silt'] };
    } else {
      // 普通侧岔
      const d1 = range(rng, 8, 14), d2 = range(rng, 10, 18);
      const p1 = [node.p[0] + px * d1, node.p[1] + range(rng, -2, 2), node.p[2] + pz * d1];
      const p2 = [p1[0] + px * range(rng, 4, 9), p1[1] + range(rng, -3, 3), p1[2] + pz * range(rng, 4, 9)];
      def = { from, pts: [p1, p2], r: range(rng, 1.7, 2.6), deadEnd: chance(rng, 0.5), name: pick(rng, ['侧岔', '风化廊', '暗廊']), kind: 'side' };
    }
    def.open = chance(rng, 0.85);   // 平行宇宙里有的通、有的塌
    out.push(def); used.add(from);
  }

  // —— 非常规出口：每张图保底一条（中后段岔出去），三种玩法由种子定 ——
  // mouth=第二洞口（水上天光，上浮即出）  climb=高处旱厅（卸装备沿干缝攀出）  far=远端旱厅（离岸太远，呼救接应）
  // 长图六成概率有第二个出口——同一个宇宙可能同时藏着两种脱身方式
  const exitKinds = shuffled(rng, ['mouth', 'climb', 'far']);
  const nExit = n >= 10 && chance(rng, 0.6) ? 2 : 1;
  for (let xi = 0; xi < nExit && n >= 5; xi++) {
    let from = intRange(rng, Math.floor(n / 2), n - 2), guard = 0;
    while (used.has(from) && guard++ < 8) from = intRange(rng, Math.floor(n / 2), n - 2);
    const node = R[from];
    const a = R[Math.max(0, from - 1)].p, b = R[Math.min(n - 1, from + 1)].p;
    const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz) || 1;
    const side = chance(rng, 0.5) ? 1 : -1, px = -dz / dl * side, pz = dx / dl * side;
    const kind = exitKinds[xi % exitKinds.length];
    const d1 = range(rng, 9, 16);
    const p1 = [node.p[0] + px * d1, node.p[1] + range(rng, 2, 6), node.p[2] + pz * d1];
    let def;
    if (kind === 'mouth') {
      // 一路上行到近水面——尽头是另一口天窗（深图就是一根通天烟囱）
      const p2 = [p1[0] + px * range(rng, 3, 7), range(rng, -3.4, -2.2), p1[2] + pz * range(rng, 3, 7)];
      def = { from, pts: [p1, p2], r: range(rng, 1.8, 2.6), endR: range(rng, 3.6, 5), altExit: 'mouth', name: pick(rng, ['侧天窗', '风口缝', '另一口']) };
    } else {
      // 上行进干厅：爬到近地表的洞厅，水面只在厅底一角，大部分是能走的旱地
      const p2 = [p1[0] + px * range(rng, 4, 9), range(rng, -4.6, -3.0), p1[2] + pz * range(rng, 4, 9)];
      def = { from, pts: [p1, p2], r: range(rng, 1.7, 2.4), endR: range(rng, 5, 7.5), altExit: kind,
        name: kind === 'climb' ? pick(rng, ['旱厅', '风蚀厅', '高台']) : pick(rng, ['远厅', '尽头厅', '暗堂']) };
    }
    def.open = true;   // 保底出口不塌
    out.push(def); used.add(from);
  }
  return out;
}

export function objectiveText(u) {
  const o = u.objective;
  switch (o.type) {
    case 'explore': return t('抵达「{p}」的标记石并返回', { p: t(o.place) });
    case 'photo':   return t('拍到「{n}」（≥{q}星）', { n: spName(o.species), q: o.quality });
    case 'salvage': return t('打捞「{n}」带回出口', { n: t(o.item.name) });
    case 'rescue':  return t('找到「{n}」拖带回出口', { n: t(o.victim.name) });
    case 'survey':  return t('巡线标记 {n} 处并返回', { n: o.legs?.length || 3 });
    default: return t('下去看看');
  }
}
