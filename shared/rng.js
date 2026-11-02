import { getLang } from './i18n.js';
// 种子化随机数 — 平行宇宙的基石：同一地图 + 同一宇宙种子 => 同一世界
// FNV-1a hash -> mulberry32 PRNG，客户端与服务器共用，保证确定性生成。

export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 组合 mapId + seed，避免不同地图之间种子互相撞车
export function universeRng(mapId, seed) {
  return mulberry32(hashSeed(`${mapId}::${seed}`));
}

// —— 常用取样工具 ——
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function weighted(rng, pairs) {
  // pairs: [[value, weight], ...]
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rng() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

export function chance(rng, p) { return rng() < p; }

export function range(rng, lo, hi) { return lo + rng() * (hi - lo); }

export function intRange(rng, lo, hi) { return Math.floor(range(rng, lo, hi + 1)); }

export function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 短宇宙代号：例如 "K7-镜厅"
const UNI_SYLLABLE = [
  '镜', '雾', '盲', '蓝', '寂', '流', '骨', '灯', '渊', '潮',
  '沙', '影', '钟', '乳', '涡', '暗', '磷', '弦', '隙', '渊',
];
const UNI_WORDS_EN = ['Mirror', 'Fog', 'Blind', 'Blue', 'Hush', 'Flow', 'Bone', 'Lamp', 'Abyss', 'Tide',
  'Silt', 'Shade', 'Bell', 'Spire', 'Eddy', 'Dark', 'Glow', 'Chord', 'Rift', 'Deep'];
export function universeName(seed, lang = getLang()) {
  const rng = mulberry32(hashSeed(`name::${seed}`));
  const num = intRange(rng, 1, 99);
  const a = pick(rng, UNI_SYLLABLE), b = pick(rng, UNI_SYLLABLE);
  if (lang === 'en') return `Run ${num} · ${UNI_WORDS_EN[UNI_SYLLABLE.indexOf(a) % 20]} ${UNI_WORDS_EN[UNI_SYLLABLE.indexOf(b) % 20]}`;
  return `第${num}回 · ${a}${b}`;
}

// 生成一个可读宇宙种子，如 "CAVE-7FK2-Q9XD"
export function randomSeed() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = 'CAVE-';
  for (let i = 0; i < 8; i++) {
    s += abc[Math.floor(Math.random() * abc.length)];
    if (i === 3) s += '-';
  }
  return s;
}
