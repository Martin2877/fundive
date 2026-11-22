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

// —— 难度资历建议（软提示，不锁图）——
// 难度≥4 的图：玩家没有前置难度图的好结局、对应课系也没满 6 星时，详情页劝一句"先来点轻的"。
const KIND_COURSE = { cave: 'aow', ocean: 'ocn', ice: 'mil' };
export function belowPar(map, d) {
  if ((map.difficulty || 1) < 4) return null;
  const chapters = d?.chapters || {};
  if (MAPS.some(m => !m.hidden && m.difficulty === map.difficulty - 1 && chapters[m.id]?.done)) return null;
  const cid = KIND_COURSE[map.kind || 'cave'];
  const stars = Object.values(d?.courses?.[cid] || {}).reduce((s, l) => s + (l.stars || 0), 0);
  return stars >= 6 ? null : { cid, prev: map.difficulty - 1 };
}
