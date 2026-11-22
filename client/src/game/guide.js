// 按需引导（潜导密度）：由账号档案推导潜水员等级，再决定提示密度。
// settings.guide: 'auto' 按等级 | 'full' 全程 | 'lite' 精简 | 'off' 关闭。默认 auto。
import { MAPS } from '@fundive/shared/maps.js';

export function diverLevel(d) {
  const st = d?.stats || {};
  const dives = st.dives || 0;
  const chapters = Object.values(d?.chapters || {}).filter(c => c.done).length;
  const courses = d?.courses || {};
  const stars = (cid) => Object.values(courses[cid] || {}).reduce((s, l) => s + (l.stars || 0), 0);
  const ow = stars('ow'), aow = stars('aow');
  if (dives >= 15 && chapters >= 6) return 2;          // 老手：自己看表
  if (dives >= 6 || ow >= 6 || aow >= 3) return 1;     // 潜水员：点到为止
  return 0;                                          // 学员：全程带
}

export function guideMode(d) {
  const g = d?.settings?.guide || 'auto';
  if (g === 'full' || g === 'lite' || g === 'off') return g;
  return ['full', 'lite', 'off'][diverLevel(d)];
}

// —— 递进解锁：难度≥4 的图需要先证明自己 ——
// 前置难度图任意一章好结局，或对应课系累计满 6 星；未解锁只能「临时起意」硬闯（不计评级）。
const KIND_COURSE = { cave: 'aow', ocean: 'ocn', ice: 'mil' };
export function unlockReq(map, d) {
  if ((map.difficulty || 1) < 4) return null;
  const chapters = d?.chapters || {};
  if (MAPS.some(m => !m.hidden && m.difficulty === map.difficulty - 1 && chapters[m.id]?.done)) return null;
  const cid = KIND_COURSE[map.kind || 'cave'];
  const stars = Object.values(d?.courses?.[cid] || {}).reduce((s, l) => s + (l.stars || 0), 0);
  return stars >= 6 ? null : { cid, prev: map.difficulty - 1 };
}
export const mapLocked = (map, d) => !!unlockReq(map, d);
