// 检查英文字典覆盖：扫描源码里的中文字符串字面量与 t('…') 调用，列出缺词。
// 用法：node scripts/i18ncheck.mjs [--list]
import fs from 'fs';
import path from 'path';
import { EN } from '../shared/lang_en.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  if (['node_modules', 'dist'].includes(f.name)) continue;
  const p = path.join(d, f.name);
  f.isDirectory() ? walk(p) : /\.js$/.test(f.name) && files.push(p);
} };
['shared', 'client/src', 'server/src'].forEach(d => walk(path.join(root, d)));

const SKIP = new Set(['lang_en.js', 'rng.js']);
const missing = new Map();
const unesc = (s) => s.replace(/\\(['"`\\])/g, '$1');
const cjk = /[一-龥]/;
for (const f of files) {
  if (SKIP.has(path.basename(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  // 去掉 // 注释与 /* */ 注释（简单处理：不在字符串里的行尾注释）
  const lines = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''));
  const body = lines.join('\n');
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
  let m;
  while ((m = re.exec(body))) {
    const s = unesc(m[2]);
    if (!cjk.test(s) || s.includes('${')) continue;
    // HTML 模板里的字面量由 t() 调用覆盖，此处只看独立字符串
    if (!(s in EN)) {
      const k = s;
      if (!missing.has(k)) missing.set(k, path.relative(root, f));
    }
  }
}
// 第二遍：t('…') / tr('…') 调用里的字面量（可能嵌在模板字符串里）
for (const f of files) {
  if (SKIP.has(path.basename(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re2 = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
  let m;
  while ((m = re2.exec(src))) {
    const s = unesc(m[2]);
    if (cjk.test(s) && !(s in EN) && !missing.has(s)) missing.set(s, path.relative(root, f));
  }
}
const list = [...missing.entries()];
if (process.argv.includes('--json')) fs.writeFileSync('/tmp/keys.json', JSON.stringify(list.map(x => x[0])));
if (process.argv.includes('--list')) for (const [k, f] of list) console.log(`${f}\t${k}`);
console.log(`\n缺英文翻译: ${list.length} 条`);
process.exit(list.length ? 1 : 0);
