// 轻量 i18n：以中文原文为 key，英文走字典；缺词回落中文。
// t('抵达「{place}」', { place })  —— 占位符 {x} 两种语言通用。
import { EN } from './lang_en.js';

export const LANGS = ['zh', 'en'];
let lang = 'zh';
const dicts = { en: EN };

export const getLang = () => lang;
export function setLang(l) {
  lang = LANGS.includes(l) ? l : 'zh';
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}
export function detectLang(saved) {
  if (LANGS.includes(saved)) return saved;
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '') : 'zh';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function t(s, p) {
  if (s == null) return s;
  let r = lang === 'zh' ? s : (dicts[lang]?.[s] ?? s);
  if (p) r = r.replace(/\{(\w+)\}/g, (m, k) => (p[k] ?? m));
  return r;
}
// 带 {占位} 的标签：占位值本身也过 t()（如物种名）
export const tl = (label, lp) => t(label, lp && Object.fromEntries(Object.entries(lp).map(([k, v]) => [k, t(v)])));
export const hasEn = (s) => s in EN;
