// 海流探针：看 flowZones/hookPoints -> 进激流区看漂移 -> 挂钩看稳定
import { chromium } from 'playwright-core';
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
const MAPIDX = +(process.argv.find(a => a.startsWith('--map='))?.split('=')[1] || 0);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(URL);
await page.waitForSelector('.map');
await page.locator('[data-d=ocean]').dispatchEvent('click');
await page.locator('.map').nth(MAPIDX).click();
await page.click('#solo');
await page.locator('button.primary').first().click();
await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 });
const info = await page.evaluate(() => {
  const s = window.__fd.session;
  const b = s.buddy; if (b) { b.update = () => {}; b.obj.visible = false; }
  return { map: s.map.id, zones: s.cave.flowZones.map(z => ({ t: z.type || 'base', n: z.name, r: z.r, s: z.strength, p: z.pos.toArray().map(v => +v.toFixed(0)) })), hooks: (s.cave.hookPoints || []).map(h => h.p.toArray().map(v => +v.toFixed(0))) };
});
console.log(JSON.stringify(info, null, 1));
const z = info.zones.find(z => z.t === 'stream' || z.t === 'washer');
if (z) {
  // 传送到流区中心，静置 4s 看漂移
  await page.evaluate((p) => { const s = window.__fd.session; s._t = 60; s.player.pos.set(p[0], p[1], p[2]); s.player.vel.set(0, 0, 0); s.player.buoy = 0; }, z.p);
  await page.waitForTimeout(4000);
  const st1 = await page.evaluate(() => ({ pos: window.__fd.session.player.pos.toArray().map(v => +v.toFixed(1)), inCur: window.__fd.session.player.inCurrent?.type }));
  console.log('流中4s:', JSON.stringify(st1), '漂移=', Math.hypot(st1.pos[0]-z.p[0], st1.pos[1]-z.p[1], st1.pos[2]-z.p[2]).toFixed(1)+'m');
  // 挂钩：挪到挂钩点旁再按 G
  const hp = info.hooks[0];
  if (hp) {
    await page.evaluate((h) => { const s = window.__fd.session; s.player.pos.set(h[0], h[1] + 1, h[2]); s.player.vel.set(0, 0, 0); s.player.hooked = null; }, hp);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(400);
    const hk = await page.evaluate(() => !!window.__fd.session.player.hooked);
    console.log('挂钩:', hk);
    if (hk) {
      await page.waitForTimeout(3500);
      const st2 = await page.evaluate(() => window.__fd.session.player.pos.toArray().map(v => +v.toFixed(1)));
      console.log('挂住4s后位置:', JSON.stringify(st2), '离钩点=', Math.hypot(st2[0]-hp[0], st2[1]-hp[1], st2[2]-hp[2]).toFixed(2)+'m');
    }
  }
}
await browser.close();
