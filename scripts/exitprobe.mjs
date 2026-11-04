// 非常规出口探针：找 altExits -> 触发 -> 验证结局
import { chromium } from 'playwright-core';
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
const WANT = process.argv.find(a => a.startsWith('--kind='))?.split('=')[1] || null;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
const seen = new Set();
for (let mi = 0; mi < 8; mi++) {
  await page.goto(URL);
  await page.waitForSelector('.map');
  await page.locator('[data-d=cave]').dispatchEvent('click');
  await page.locator('.map').nth(mi).click();
  await page.click('#solo');
  await page.locator('button.primary').first().click();
  const ok = await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 25000 }).then(() => true).catch(() => false);
  if (!ok) continue;
  const info = await page.evaluate(() => {
    const s = window.__fd.session;
    const b = s.buddy; if (b) { b.update = () => {}; b.obj.visible = false; }
    return { map: s.map.id, exits: (s.cave.altExits || []).map(x => ({ k: x.kind, p: x.pos.toArray().map(v => +v.toFixed(1)), r: x.r })) };
  });
  console.log(`map${mi} ${info.map}:`, JSON.stringify(info.exits));
  for (const x of info.exits) seen.add(x.k);
  const x = info.exits.find(e => (!WANT || e.k === WANT) && !seen.has('_done_' + e.k));
  if (!x) continue;
  seen.add('_done_' + x.k);
  console.log(`  -> 测试 ${x.k} 出口`);
  if (x.k === 'mouth') {
    await page.evaluate((p) => {
      const s = window.__fd.session; s._t = 60;
      const pk = s.cave.pockets.find(pk => Math.hypot(pk.cx - p[0], pk.cz - p[2]) < pk.R) || s.cave.pockets.at(-1);
      s.player.pos.set(p[0], (pk ? pk.waterY : p[1] + 1.5) - 0.3, p[2]); s.player.vel.set(0, 0.4, 0); s.player.buoy = 0.4;
    }, x.p);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({ surfaced: !!window.__fd.session?.surfaced, inAir: window.__fd.session?.player.inAir, y: window.__fd.session?.player.pos.y.toFixed(2) }));
    console.log('  mouth:', JSON.stringify(st));
    await page.waitForTimeout(8000);
    const end = await page.evaluate(() => document.querySelector('.endcard h2')?.textContent || (window.__fd.session?.ended ? 'ended' : 'none'));
    console.log('  结局:', end);
  } else {
    // climb/far：传送到 dry 附近的水里 -> 自动上岸 -> E
    await page.evaluate((x) => {
      const s = window.__fd.session; s._t = 60;
      const pk = (s.cave.pockets || []).find(pk => pk.dry && Math.hypot(pk.dry.x - x.p[0], pk.dry.z - x.p[2]) < 2) || {};
      const d = pk.dry || { x: x.p[0], y: x.p[1], z: x.p[2] };
      s.player.pos.set(d.x, d.y - 1.4, d.z); s.player.vel.set(0, 0, 0);
    }, x);
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({ onLand: window.__fd.session?.player.onLand, spot: !!window.__fd.session?._exitSpot }));
    console.log(`  ${x.k} 上岸:`, JSON.stringify(st));
    if (st.spot) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(12000);
      const end = await page.evaluate(() => document.querySelector('.endcard h2')?.textContent || 'none');
      console.log('  结局:', end);
    }
  }
}
console.log('EXIT-KINDS:', [...seen].join(','));
await browser.close();
