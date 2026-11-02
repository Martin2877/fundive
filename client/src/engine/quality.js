// 画质档位：集中管理所有与性能相关的渲染参数，持久化到 localStorage。
const KEY = 'fundive.quality';
const LEVELS = {
  low:  { name: '低', pixelRatio: 1,   shadows: 0,    post: false, msaa: 0, snow: 320,  rockTex: 256, sandTex: 256, ring: 20, step: 1.0 },
  mid:  { name: '中', pixelRatio: 1.5, shadows: 512,  post: true,  msaa: 0, snow: 700,  rockTex: 512, sandTex: 256, ring: 26, step: 0.8 },
  high: { name: '高', pixelRatio: 2,   shadows: 1024, post: true,  msaa: 4, snow: 1100, rockTex: 512, sandTex: 512, ring: 32, step: 0.7 },
};
const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
let level = 'high';
try { level = localStorage.getItem(KEY) || (isTouch ? 'low' : 'high'); } catch { /* ignore */ }
if (!LEVELS[level]) level = 'high';

export const quality = {
  get level() { return level; },
  get cfg() { return LEVELS[level]; },
  set(l) { if (LEVELS[l]) { level = l; try { localStorage.setItem(KEY, l); } catch { /* ignore */ } } },
  cycle() { const k = Object.keys(LEVELS); this.set(k[(k.indexOf(level) + 1) % k.length]); return level; },
};
