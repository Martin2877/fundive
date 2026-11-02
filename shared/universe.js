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
];

const VICTIMS = [
  { id: 'lost_diver', name: '迷路的潜水员', note: '灯还亮着，人已经慌得只会原地踢水。' },
  { id: 'kid',        name: '被困的队员',   note: '抱着膝盖坐在气室边上，等你很久了。' },
  { id: 'old_timer',  name: '逞强的老潜水员', note: '嘴硬说不用救，气表说不了谎。' },
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
    o, o === 'explore' ? 3 : o === 'photo' ? 3 : o === 'salvage' ? 2.4 : 2.6,
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
  };
}

export function objectiveText(u) {
  const o = u.objective;
  switch (o.type) {
    case 'explore': return t('抵达「{p}」的标记石并返回', { p: t(o.place) });
    case 'photo':   return t('拍到「{n}」（≥{q}星）', { n: spName(o.species), q: o.quality });
    case 'salvage': return t('打捞「{n}」带回出口', { n: t(o.item.name) });
    case 'rescue':  return t('找到「{n}」拖带回出口', { n: t(o.victim.name) });
    default: return t('下去看看');
  }
}
