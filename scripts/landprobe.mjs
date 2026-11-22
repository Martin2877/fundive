// 气室上岸探针：找带 dry 的气室 -> 传送 -> 验证 onLand/走动/下水
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
fs.mkdirSync('reports/shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
let found = false;
for (let mi = 0; mi < 7 && !found; mi++) {
  await page.goto(URL);
  await page.waitForSelector('.map');
  await page.locator('[data-d=cave]').dispatchEvent('click');
  await page.locator('.map').nth(mi).click();
  await page.click('#solo');
  await page.locator('button.primary').first().click();
  await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 }).catch(() => {});
  const info = await page.evaluate(() => {
    const s = window.__fd.session;
    if (!s) return null;
    const dry = s.cave.pockets.filter(d => d.dry).map(d => ({ x: d.dry.x, y: d.dry.y, z: d.dry.z, r: d.dry.r, wy: d.waterY }));
    return { map: s.map.id, dry, nP: s.cave.pockets.length };
  });
  console.log(`map${mi}:`, JSON.stringify(info));
  if (!info?.dry?.length) continue;
  found = true;
  const d = info.dry[0];
  await page.evaluate((d) => {
    const s = window.__fd.session;
    s._t = 60; s.player.pos.set(d.x, d.wy - 0.1, d.z); s.player.vel.set(0, 0, 0);
    const b = s.buddy; if (b) { b.update = () => {}; b.obj.visible = false; }
  }, d);
  await page.waitForTimeout(700);
  const st1 = await page.evaluate(() => ({ onLand: window.__fd.session.player.onLand, inAir: window.__fd.session.player.inAir, y: window.__fd.session.player.pos.y.toFixed(2) }));
  console.log('上岸后:', JSON.stringify(st1));
  await page.screenshot({ path: 'reports/shots/land_a.png' });
  // 走两步
  await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
  const st2 = await page.evaluate(() => ({ onLand: window.__fd.session.player.onLand, pos: window.__fd.session.player.pos.toArray().map(v => +v.toFixed(2)) }));
  console.log('走动后:', JSON.stringify(st2));
  await page.screenshot({ path: 'reports/shots/land_b.png' });
  // 走回水里：对着气室中心方向持续走
  await page.evaluate(() => { const s = window.__fd.session; s.player.yaw = Math.atan2(-(s.cave.pockets.find(p => p.dry).cx - s.player.pos.x), -(s.cave.pockets.find(p => p.dry).cz - s.player.pos.z)); });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2000); await page.keyboard.up('KeyW');
  await page.waitForTimeout(800);
  const st3 = await page.evaluate(() => ({ onLand: window.__fd.session.player.onLand, inAir: window.__fd.session.player.inAir, y: window.__fd.session.player.pos.y.toFixed(2) }));
  console.log('回水后:', JSON.stringify(st3));
}
console.log(found ? 'LAND-OK' : 'LAND-NOTFOUND');
await browser.close();
