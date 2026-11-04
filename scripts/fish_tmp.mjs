import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = '/tmp/fishline'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', e => console.log('PAGEERR:', e.message));
await p.goto('http://localhost:5173/');
await p.waitForSelector('.map');
const r = await p.evaluate(() => { try { window.__fd.dive('reef', 7); return 'ok'; } catch (e) { return 'ERR: ' + e.message + '\n' + e.stack; } });
console.log('dive:', r.slice(0, 400));
await p.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 }).catch(() => console.log('session not running'));
await p.waitForTimeout(1200);
const r2 = await p.evaluate(async () => {
  try {
    const s = window.__fd.session;
    const { makeFish } = await import('./src/engine/creatures.js');
    
    s.player.pos.set(0, -4.6, 30); s.player.vel.set(0,0,0); s.player.yaw = 0; s.player.pitch = 0; s.player.gas = 300; s.player.lightOn = false; s.player.backupOn = false;
    window.__fish = [];
    const rng = Math.random;
    const sps = ['damselfish','clownfish','parrotfish','grouper','shark','trout','catfish','cavefish','blindfish','whitefish'];
    sps.forEach((sp, i) => {
      const f = makeFish(sp, rng);
      if (sp === 'shark') f.scale.setScalar(2.1);
      f.position.set(-2.7 + i * 0.6, -4.7 + (i % 2) * 0.35, 30 - 2.4 - (i % 2) * 0.7);
      f.rotation.y = 0;
      s.scene.add(f); window.__fish.push(f);
    });
    return 'ok';
  } catch (e) { return 'ERR: ' + e.message; }
});
console.log('lineup:', r2.slice(0, 300));
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/lineup.png` });
const zoom = async (i, n) => {
  await p.evaluate((i) => {
    const s = window.__fd.session, f = window.__fish[i];
    s.player.pos.set(f.position.x + 1.0, f.position.y + 0.05, f.position.z + 0.15);
    s.player.yaw = Math.atan2(-(f.position.x - s.player.pos.x), -(f.position.z - s.player.pos.z));
    s.player.pitch = 0;
  }, i);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/z_${n}.png` });
};
await zoom(2, 'parrot'); await zoom(1, 'clown'); await zoom(4, 'shark'); await zoom(3, 'grouper'); await zoom(5, 'trout'); await zoom(6, 'catfish'); await zoom(8, 'blind');
console.log('done');
await b.close();
