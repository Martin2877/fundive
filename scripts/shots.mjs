// 画面验收：逐地图、逐检查点截图 + 亮度/过曝/帧率/控制台错误门禁。
// 用法：先 `npm run dev`，再 `npm run shots [-- --maps=0,2 --url=http://localhost:5173 --quality=high]`
// 产物：reports/shots/<地图>_<检查点>.png（reports/ 已被 gitignore）。需要本机装有 Chrome。
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const URL = arg('url', 'http://localhost:5173/');
const QUALITY = arg('quality', 'high');
const only = arg('maps', '').split(',').filter(Boolean).map(Number);
const POINTS = [['spawn', null], ['early', 0.2], ['mid', 0.5], ['deep', 0.85]];
const OUT = 'reports/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript((q) => localStorage.setItem('fundive.quality', q), QUALITY);
let failed = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

const nMaps_ = await (async () => { const p = await ctx.newPage(); await p.goto(URL); await p.waitForSelector('.map'); const n = await p.locator('.map').count(); await p.click('[data-d=ocean]'); const o = await p.locator('.map').count(); await p.close(); return [n, n + o]; })();
const [nCave, nMaps] = nMaps_;
for (let m = 0; m < nMaps; m++) {
  if (only.length && !only.includes(m)) continue;
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (c) => { if (c.type() === 'error' && !/404/.test(c.text())) errs.push(c.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('.map');
  if (m >= nCave) await page.click('[data-d=ocean]');
  const mi = m >= nCave ? m - nCave : m;
  const name = (await page.locator('.map .n').nth(mi).innerText()).split('\n')[0].trim();
  console.log(`\n[${m}] ${name}`);
  await page.locator('.map').nth(mi).click();
  await page.click('#solo');
  await page.locator('button.primary').first().click();
  await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  for (const [tag, f] of POINTS) {
    if (f != null) await page.evaluate((f) => {
      const s = window.__fd.session, sp = s.cave.mainSpine, i = Math.min(sp.length - 2, Math.floor(f * (sp.length - 1)));
      const a = sp[i].p, b = sp[i + 1].p;
      s.player.pos.copy(a); s.player.vel.set(0, 0, 0);
      s.player.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)); s.player.pitch = -0.05;
      s.player.gas = 200; s.player.panic = 0;
    }, f);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${m}_${tag}.png` });
    const st = await page.evaluate(() => {
      const cv = document.getElementById('c'), t = document.createElement('canvas'); t.width = 64; t.height = 36;
      const c = t.getContext('2d'); c.drawImage(cv, 0, 0, 64, 36);
      const d = c.getImageData(0, 0, 64, 36).data; let sum = 0, clip = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255; sum += l; if (l > 0.95) clip++; }
      return { mean: sum / (d.length / 4), clip: clip / (d.length / 4) };
    });
    gate(st.mean > 0.03 && st.mean < 0.6, `${tag}: 平均亮度 ${st.mean.toFixed(3)}（0.03~0.6）`);
    gate(st.clip < 0.3, `${tag}: 过曝像素 ${(st.clip * 100).toFixed(1)}%（<30%）`);
  }
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; performance.now() - t > 2000 ? r(n / 2) : requestAnimationFrame(f); }; f(); }));
  gate(fps > 30, `帧率 ${fps.toFixed(0)}fps（>30）`);
  gate(errs.length === 0, `控制台无错误${errs.length ? '：' + errs[0].slice(0, 120) : ''}`);
  await page.close();
}
await browser.close();
console.log(failed ? `\n${failed} 项未通过` : '\n画面验收全部通过');
process.exit(failed ? 1 : 0);
