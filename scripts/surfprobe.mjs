// 出水流程探针：下水 -> 传送到出口 -> 等出水动画 -> 截水面场景
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
const MAPIDX = +(process.argv.find(a => a.startsWith('--map='))?.split('=')[1] || 0);
const KIND = process.argv.find(a => a.startsWith('--kind='))?.split('=')[1] || 'cave';
fs.mkdirSync('reports/shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', c => { if (c.type() === 'error') console.log('CONSOLE', c.text().slice(0, 160)); });
await page.goto(URL);
await page.waitForSelector('.map');
await page.locator(`[data-d=${KIND}]`).dispatchEvent('click');
await page.locator('.map').nth(MAPIDX).click();
await page.click('#solo');
await page.locator('button.primary').first().click();
await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { const b = window.__fd.session?.buddy; if (b) { b.update = () => {}; b.obj.visible = false; } });
// 传送到出口下方，让它自己走完出口判定（_t>30 要先补时间）
await page.evaluate(() => {
  const s = window.__fd.session;
  s._t = 60;
  s.player.pos.copy(s.cave.entryPos); s.player.pos.y = s.cave.entryPos.y - 0.3;
  s.player.vel.set(0, 0, 0);
});
await page.waitForTimeout(4500);   // exitT 3s + 出水抬头 1.5s
await page.screenshot({ path: `reports/shots/surface_${KIND}${MAPIDX}_a.png` });
await page.waitForTimeout(2600);   // 接应等待中段
await page.screenshot({ path: `reports/shots/surface_${KIND}${MAPIDX}_b.png` });
const st = await page.evaluate(() => ({ surfaced: !!window.__fd.session?.surfaced, ended: window.__fd.session?.ended, t: window.__fd.session?.surfaced?.t }));
console.log('state:', JSON.stringify(st));
await page.waitForTimeout(3000);
const end = await page.evaluate(() => window.__fd.session?.ended || !!document.querySelector('.endcard'));
console.log('ended:', end);
await browser.close();
