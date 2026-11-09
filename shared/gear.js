// 装备系统 —— 装备间的可配置项。
// 基础装（BCD/湿衣/脚蹼/面镜/一级头）算标配不占槽；
// 这里定义的都是可选/可摆位的：气瓶组、灯、相机、浮标、线轮、刀、指北针、应急瓶、哨子。
// slots：可挂的槽位；max：最多携带数量（>1 的进不同槽位或同槽堆叠）；
// w：负担(kg)，累成 gearDrag 减速/费气；kind：同类互斥分组（tank 全场只能有一组）。
import { t } from './i18n.js';
import { mulberry32, hashSeed } from './rng.js';

export const GEAR = {
  tank_s:  { kind: 'tank',    icon: '⬤',   name: '单瓶 12L',   en: 'Single 12L',    w: 14, gas: 170, slots: ['back'],  max: 1, desc: '轻装、灵活，气量只够浅洞短潜。' },
  tank_d:  { kind: 'tank',    icon: '⬤⬤',  name: '双瓶 12L×2', en: 'Twin 12L',      w: 28, gas: 340, slots: ['back'],  max: 1, desc: '深图标配——气量足，人也笨重。' },
  tank_sm: { kind: 'tank',    icon: '◧◨', name: '侧挂瓶×2',   en: 'Sidemount ×2',  w: 24, gas: 300, slots: ['lside'], max: 1, gear: 'smt', squeeze: 1.4, desc: '气瓶挂体侧，人变薄一截——窄缝好过，配平麻烦。', pair: 'rside' },
  lamp:    { kind: 'lamp',    icon: '☀',   name: '主灯',       en: 'Primary light', w: 1.5, slots: ['handR', 'handL', 'chest'], max: 1, must: true, desc: '洞里的太阳。必须带，只选挂哪。' },
  lamp_sp: { kind: 'lamp_sp', icon: '◔',   name: '备用灯',     en: 'Backup light',  w: 1,   slots: ['chest', 'pocketL', 'pocketR', 'waist'], max: 2, stack: true, desc: '主灯熄灭时顶上来——亮度减半，够你回家。' },
  camera:  { kind: 'camera',  icon: '▣',   name: '相机',       en: 'Camera',        w: 2,   slots: ['handL', 'handR', 'chest'], max: 1, film: 8, desc: '图鉴的来源——不带它，按 F 只能摊手。' },
  film:    { kind: 'film',    icon: '▤',   name: '胶片盒',     en: 'Film roll',     w: 0.4, slots: ['pocketL', 'pocketR'], max: 2, stack: true, desc: '每盒 +8 张。水下没有重拍键。' },
  smb:     { kind: 'smb',     icon: '◍',   name: '水面浮标',   en: 'SMB',           w: 1.2, slots: ['waist', 'pocketL', 'pocketR'], max: 1, desc: '海潜保命物：在水下放出（C），船按橙色球找你。' },
  reel:    { kind: 'reel',    icon: '⑂',   name: '线轮',       en: 'Reel',          w: 1.2, slots: ['handL', 'handR', 'pocketL', 'pocketR', 'waist'], max: 1, desc: '巡线标记靠它布点；没它，巡线目标只能看着办。' },
  knife:   { kind: 'knife',   icon: '⚔',   name: '潜水刀',     en: 'Dive knife',    w: 0.7, slots: ['thigh', 'waist'], max: 1, desc: '窄缝卡住时给自己多挣几秒。' },
  compass: { kind: 'compass', icon: '◆',   name: '指北针',     en: 'Compass',       w: 0.3, slots: ['wrist', 'chest'], max: 1, desc: '没有它，HUD 上没有罗盘条——开阔水里靠蒙。' },
  pony:    { kind: 'pony',    icon: '◌',   name: '应急瓶 3L',  en: 'Pony bottle',   w: 4,   slots: ['chest', 'waist'], max: 1, desc: '主瓶见底时自动接上：最后 45 bar 的后悔药。' },
  whistle: { kind: 'whistle', icon: '♪',   name: '救生哨',     en: 'Whistle',       w: 0.2, slots: ['pocketL', 'pocketR', 'chest'], max: 1, desc: '出水发信号更快——接应的人到得早。' },
};

// 小人身上的槽位（% 坐标，左上原点）。accepts = kind 白名单。
export const SLOTS = {
  back:    { name: '背架',   box: [35, 16, 30, 14], accepts: ['tank'] },
  chest:   { name: '胸前',   box: [38, 30, 24, 13], accepts: ['lamp', 'lamp_sp', 'camera', 'pony', 'compass', 'whistle'] },
  waist:   { name: '腰挂',   box: [38, 43, 24, 9],  accepts: ['smb', 'knife', 'pony', 'lamp_sp', 'reel'] },
  handL:   { name: '左手',   box: [2, 30, 28, 14],  accepts: ['lamp', 'camera', 'reel'] },
  handR:   { name: '右手',   box: [70, 30, 28, 14], accepts: ['lamp', 'camera', 'reel'] },
  wrist:   { name: '手腕',   box: [2, 44, 28, 12],  accepts: ['compass'] },
  lside:   { name: '左侧挂', box: [4, 58, 26, 14],  accepts: ['tank'] },
  rside:   { name: '右侧挂', box: [70, 58, 26, 14], accepts: ['tank'] },
  pocketL: { name: '左口袋', box: [24, 72, 24, 12], accepts: ['film', 'smb', 'lamp_sp', 'whistle', 'reel'] },
  pocketR: { name: '右口袋', box: [52, 72, 24, 12], accepts: ['film', 'smb', 'lamp_sp', 'whistle', 'reel'] },
  thigh:   { name: '大腿',   box: [38, 84, 24, 12], accepts: ['knife'] },
};

// gear: { slotId: { id, qty } } —— UI 里拖出来的原样数据。
// 校验 + 归并 -> 会话直接可用的一份清单。uni 用来对目标做提醒（巡线没带线轮等）。
export function resolveLoadout(gear, map, uni) {
  const out = {
    gas: null, film: 0, camera: false, smb: 0, reel: 0, knife: 0, compass: false,
    pony: 0, whistle: 0, lamps: 1, spares: 0, squeezeK: 1, drag: 0, gear: null,
    items: [], weight: 0, problems: [],
  };
  if (!gear) return out;
  let tank = null;
  for (const [slot, it] of Object.entries(gear)) {
    const g = GEAR[it.id];
    const s = SLOTS[slot];
    if (!g || !s || !s.accepts.includes(g.kind) || !g.slots.includes(slot)) continue;
    const qty = Math.min(Math.max(1, it.qty || 1), g.max);
    out.items.push({ id: it.id, slot, qty });
    out.weight += g.w * qty;
    switch (g.kind) {
      case 'tank': tank = it.id; out.gas = g.gas; out.gear = g.gear || null; out.squeezeK *= g.squeeze || 1; break;
      case 'lamp_sp': out.spares += qty; break;
      case 'camera': out.camera = true; out.film += g.film; break;
      case 'film': out.film += 8 * qty; out._filmRolls = true; break;
      case 'smb': out.smb += qty; break;
      case 'reel': out.reel += qty; break;
      case 'knife': out.knife += qty; out.squeezeK *= 1.5; break;
      case 'compass': out.compass = true; break;
      case 'pony': out.pony += qty; break;
      case 'whistle': out.whistle += qty; break;
    }
  }
  // 负担 -> 水下阻力：拖得越重游得越慢、耗气越多（封顶 ~18%）
  out.drag = Math.min(0.18, Math.max(0, out.weight - 20) * 0.006);
  if (!tank) out.problems.push('没有气瓶——下不了水');
  if (!gear.back && !gear.lside) out.problems.push('气瓶得有个着落（背架或侧挂）');
  if (!out.camera) out.problems.push(out._filmRolls ? '有胶片没相机——还是拍不了照' : '没带相机——拍不了照');
  if ((map.kind || 'cave') === 'ocean' && !out.smb) out.problems.push('海潜没带水面浮标——离船出水会很麻烦');
  if (!out.spares) out.problems.push('没有备用灯——主灯坏了就只能摸黑');
  if (!out.compass) out.problems.push('没带指北针——开阔水里没有方向提示');
  if (uni?.objective?.type === 'photo' && !out.camera) out.problems.push('本次目标是拍摄——没相机完成不了');
  if (uni?.objective?.type === 'survey' && !out.reel) out.problems.push('本次目标是巡线标记——没线轮完成不了');
  return out;
}

// 「计划潜水」的默认配装：进装备间时的起点。深图默认双瓶，其余单瓶。
export function defaultLoadout(map) {
  const ocean = map?.kind === 'ocean';
  const deep = (map?.gas || 0) > 260;
  const g = {
    back: { id: deep ? 'tank_d' : 'tank_s', qty: 1 },
    handR: { id: 'lamp', qty: 1 },
    chest: { id: 'lamp_sp', qty: 1 },
    handL: { id: 'camera', qty: 1 },
    pocketL: { id: 'film', qty: 2 },
    wrist: { id: 'compass', qty: 1 },
  };
  if (ocean) g.waist = { id: 'smb', qty: 1 };
  return g;
}

// 「临时起意」——抓起就走：基础装 + 随机彩蛋（可能忘带点什么）。
// 返回 {gear, notes:[中文句]}：notes 是"抓了/忘了"的清单，下水前念给玩家听。
export function whimLoadout(map, seed) {
  const rng = mulberry32(hashSeed(`whim::${seed}::${Date.now()}`));
  const r = () => rng();
  const g = {
    back: { id: (map.gas || 0) > 260 ? 'tank_d' : 'tank_s', qty: 1 },
    handR: { id: 'lamp', qty: 1 },
  };
  const notes = [];
  if (r() < 0.9) g.wrist = { id: 'compass', qty: 1 }; else notes.push('没拿指北针');
  if (r() < 0.8) { g.handL = { id: 'camera', qty: 1 }; g.pocketL = { id: 'film', qty: r() < 0.5 ? 2 : 1 }; }
  else notes.push('没带相机');
  if (r() < 0.7) g.chest = { id: 'lamp_sp', qty: 1 }; else notes.push('忘带备用灯');
  if (map.kind === 'ocean') {
    if (r() < 0.85) g.waist = { id: 'smb', qty: 1 }; else notes.push('竟然忘了水面浮标');
  }
  if (r() < 0.4) g.thigh = { id: 'knife', qty: 1 };
  if (r() < 0.25) {
    const slot = !g.waist ? 'waist' : !g.chest ? 'chest' : null;   // 应急瓶只挂得住腰/胸
    if (slot) g[slot] = { id: 'pony', qty: 1 };
  }
  if (r() < 0.45 && !g.pocketR) g.pocketR = { id: 'whistle', qty: 1 };
  if (r() < 0.3) {
    const slot = !g.pocketL ? 'pocketL' : !g.pocketR ? 'pocketR' : null;
    if (slot) g[slot] = { id: 'reel', qty: 1 };
  }
  return { gear: g, notes };
}

export const gearName = (id) => GEAR[id] ? t(GEAR[id].name) : id;
export const gearEn = (id) => GEAR[id]?.en || '';
