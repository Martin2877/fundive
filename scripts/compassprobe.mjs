// 罗盘探针：教学「指北针导航」课 -> HUD 罗盘 -> 对准◆保持 -> 到点 -> 回程对准 -> 回点
import { chromium } from 'playwright-core';
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(URL);
await page.waitForSelector('[data-d=train]');
await page.locator('[data-d=train]').dispatchEvent('click');
await page.locator('#gotrain').click();
await page.waitForSelector('.lesson');
const idx = await page.evaluate(() => [...document.querySelectorAll('.lesson .ln')].findIndex(e => e.textContent.includes('指北针')));
console.log('罗盘课 index =', idx);
if (idx < 0) { console.log('FAIL: 课表里没有指北针课'); await browser.close(); process.exit(1); }
await page.locator('.lesson').nth(idx).click();
await page.waitForFunction(() => window.__fd.session?.trainer, null, { timeout: 30000 });
const lesson = await page.evaluate(() => window.__fd.session.trainer.lesson.id);
console.log('课节:', lesson);

// 罗盘 DOM 在 HUD 上
const hasCompass = await page.evaluate(() => { const c = document.getElementById('cmp'); return c && !c.hidden; });
console.log('HUD 罗盘可见:', hasCompass);
if (!hasCompass) { console.log('FAIL'); await browser.close(); process.exit(1); }

// 跳过 say 步骤
await page.evaluate(() => { const t = window.__fd.session.trainer; if (t.cur?.check.t === 'say') t.cur.t = 999; });
await page.waitForTimeout(600);
let st = await page.evaluate(() => ({ i: window.__fd.session.trainer.i, t: window.__fd.session.trainer.cur?.check.t }));
console.log('步骤:', JSON.stringify(st));

// 步骤2: bearing node3 hold 3 —— 算目标方位设 yaw
const setYawTo = async (node) => page.evaluate((n) => {
  const s = window.__fd.session, p = s.player;
  const nd = s.cave.nodes[n].pos;
  const b = Math.atan2(nd.x - p.pos.x, -(nd.z - p.pos.z));   // bearing rad
  p.yaw = -b;                                               // h = -yaw
}, node);
await setYawTo(3);
await page.waitForTimeout(3600);
st = await page.evaluate(() => ({ i: window.__fd.session.trainer.i, t: window.__fd.session.trainer.cur?.check.t, prog: window.__fd.session.trainer.cur?.prog }));
console.log('对准◆后:', JSON.stringify(st));
if (st.t === 'bearing') { console.log('FAIL: bearing 保持没通过'); await browser.close(); process.exit(1); }
await setYawTo(3);
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/fundive-compass-hud.png' });   // 罗盘中段：◆ 应居中

// ◆ 指向检查：compassTarget 应该给 node
const ct = await page.evaluate(() => !!window.__fd.session.trainer.compassTarget?.());
console.log('compassTarget 有值:', ct);

// 步骤3: reach node3 —— 传送到节点
await page.evaluate(() => { const s = window.__fd.session; const nd = s.cave.nodes[3].pos; s.player.pos.copy(nd); s.player.vel.set(0, 0, 0); });
await page.waitForTimeout(1200);
st = await page.evaluate(() => ({ i: window.__fd.session.trainer.i, t: window.__fd.session.trainer.cur?.check.t }));
console.log('到浮标后:', JSON.stringify(st));

// 步骤4: bearing node1 hold 2
await setYawTo(1);
await page.waitForTimeout(2700);
st = await page.evaluate(() => ({ i: window.__fd.session.trainer.i, t: window.__fd.session.trainer.cur?.check.t }));
console.log('回程对准后:', JSON.stringify(st));
if (st.t === 'bearing') { console.log('FAIL: 回程 bearing 没过'); await browser.close(); process.exit(1); }

// 步骤5: reach node1
await page.evaluate(() => { const s = window.__fd.session; const nd = s.cave.nodes[1].pos; s.player.pos.copy(nd); s.player.vel.set(0, 0, 0); });
await page.waitForTimeout(1200);
// 步骤6: gesture ok
await page.keyboard.press('Digit1');
await page.waitForTimeout(1500);
const done = await page.evaluate(() => window.__fd.session?.trainer?.done ?? !!document.querySelector('.endcard'));
console.log('结课:', done);
await page.screenshot({ path: '/tmp/fundive-compass.png' });
console.log(done ? 'COMPASS-OK' : 'FAIL');
await browser.close();
process.exit(done ? 0 : 1);
