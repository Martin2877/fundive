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

// 大卡轮播里非当前卡被移出视野，playwright 的 click 会等可见性超时——用 dispatchEvent 直接发点击
const nMaps_ = await (async () => { const p = await ctx.newPage(); await p.goto(URL); await p.waitForSelector('.map'); await p.locator('[data-d=cave]').dispatchEvent('click'); const n = await p.locator('.map').count(); await p.locator('[data-d=ocean]').dispatchEvent('click'); const o = await p.locator('.map').count(); await p.locator('[data-d=ice]').dispatchEvent('click'); const i = await p.locator('.map').count(); await p.close(); return [n, n + o, n + o + i]; })();
const [nCave, nCavOc, nMaps] = nMaps_;
for (let m = 0; m < nMaps; m++) {
  if (only.length && !only.includes(m)) continue;
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (c) => { if (c.type() === 'error' && !/404/.test(c.text())) errs.push(c.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('.map');
  // 分区选择会持久化，每页都要显式点目标分区，不能假设初始停在洞潜
  await page.locator(m >= nCavOc ? '[data-d=ice]' : m >= nCave ? '[data-d=ocean]' : '[data-d=cave]').dispatchEvent('click');
  const mi = m >= nCavOc ? m - nCavOc : m >= nCave ? m - nCave : m;
  const name = (await page.locator('.map .n').nth(mi).innerText()).split('\n')[0].trim();
  console.log(`\n[${m}] ${name}`);
  await page.locator('.map').nth(mi).click();
  await page.click('#solo');
  await page.locator('button.primary').first().click();
  await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  // 验收测的是环境渲染：AI 潜伴跟随点在镜头前 2m，深色潜水服扫进画面会吃掉半个屏幕，藏掉
  await page.evaluate(() => { const b = window.__fd.session?.buddy; if (b) { b.update = () => {}; b.obj.visible = false; } });
  for (const [tag, f] of POINTS) {
    if (f != null) await page.evaluate((f) => {
      const s = window.__fd.session, sp = s.cave.mainSpine, i = Math.min(sp.length - 2, Math.floor(f * (sp.length - 1)));
      const a = sp[i].p, b = sp[i + 1].p;
      s.player.pos.copy(a); s.player.vel.set(0, 0, 0);
      s.player.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)); s.player.pitch = -0.05;
      s.player.gas = 200; s.player.panic = 0;
    }, f);
    await page.waitForTimeout(900);
    // 量亮度用合成器截图：直接 drawImage WebGL canvas 在帧间会读到过期/空缓冲，假黑帧
    const png = await page.screenshot({ path: `${OUT}/${m}_${tag}.png` });
    const st = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
      const t = document.createElement('canvas'); t.width = 64; t.height = 36;
      const c = t.getContext('2d'); c.drawImage(img, 0, 0, 64, 36);
      const d = c.getImageData(0, 0, 64, 36).data; let sum = 0, clip = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255; sum += l; if (l > 0.95) clip++; }
      return { mean: sum / (d.length / 4), clip: clip / (d.length / 4) };
    }, png.toString('base64'));
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
