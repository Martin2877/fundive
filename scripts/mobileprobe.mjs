// 移动端探针：模拟 iPhone 视口验证触屏 UI——按钮渲染、虚拟键、摇杆、装备抽屉、面镜隐藏。
// 用法: node scripts/mobileprobe.mjs --url=http://localhost:5175
import { chromium } from 'playwright-core';

const url = (process.argv.find(a => a.startsWith('--url=')) || '--url=http://localhost:5175').split('=')[1];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },          // iPhone 14 portrait
  hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__fd?.dive, { timeout: 15000 });

// 直接下水（单人洞潜）
await page.evaluate(() => window.__fd.dive('dosojos', 'MOBILE1'));
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const vis = el => { const b = el?.getBoundingClientRect(); return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null; };
  const mask = getComputedStyle(document.getElementById('mask')).opacity;
  const touch = document.getElementById('touch');
  return {
    diving: document.body.classList.contains('diving'),
    touchShown: touch ? getComputedStyle(touch).display : 'MISSING',
    maskOpacity: mask,
    avatarShown: document.getElementById('avatar') ? getComputedStyle(document.getElementById('avatar')).display : 'none-created',
    nCluster: document.querySelectorAll('#tcluster .tbtn').length,
    nSheet: document.querySelectorAll('#tsheet .tbtn').length,
    sideBtns: [...document.querySelectorAll('.tbtn.side')].map(b => b.textContent.trim()),
    stickRect: vis(document.getElementById('stick')),
    clusterRect: vis(document.getElementById('tcluster')),
    brRect: vis(document.querySelector('#hud .br .panel')),
    trRect: vis(document.querySelector('#hud .tr .panel')),
    hint: document.getElementById('hint')?.textContent,
  };
});
console.log('== 初始状态 ==');
console.log(JSON.stringify(r, null, 1));

// —— 点按：灯(L) ——
const tap = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
await tap('#tcluster .tbtn[data-k="KeyL"]');
await page.waitForTimeout(200);
const lightOff = await page.evaluate(() => window.__fd.session.player.lightOn);
console.log('点 灯 -> lightOn:', lightOff, '(期望 false)');

// —— hold：充气(B) 按住 400ms ——
const hold = async (sel, ms) => {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.evaluate(async ([x, y, sel, ms]) => {
    const el = document.querySelector(sel);
    const mk = (type) => new Touch({ identifier: Math.floor(Math.random() * 1e5), target: el, clientX: x, clientY: y });
    const t = mk('touchstart');
    el.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t], touches: [t], bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, ms));
    el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t], touches: [], bubbles: true, cancelable: true }));
  }, [x, y, sel, ms]);
};
await hold('#tcluster .tbtn[data-k="KeyB"]', 500);
const buoy = await page.evaluate(() => window.__fd.session.player.buoy);
console.log('按住 充气 0.5s -> buoy:', buoy.toFixed(3), '(期望 >0.3)');

// —— toggle：蛙踢(K) ——
await tap('#tcluster .tbtn[data-k="KeyK"]');
await page.waitForTimeout(150);
const frog1 = await page.evaluate(() => window.__fd.session.o.input.keys.has('KeyK'));
await tap('#tcluster .tbtn[data-k="KeyK"]');
await page.waitForTimeout(150);
const frog2 = await page.evaluate(() => window.__fd.session.o.input.keys.has('KeyK'));
console.log('蛙踢 toggle:', frog1, '->', frog2, '(期望 true -> false)');

// —— 装备抽屉 + 手势 3 ——
await tap('.tbtn[data-k="_sheet"]');
await page.waitForTimeout(300);
const sheetOpen = await page.evaluate(() => document.getElementById('tsheet').classList.contains('open'));
await tap('#tsheet .tbtn[data-k="Digit3"]');
await page.waitForTimeout(300);
const gest = await page.evaluate(() => window.__fd.session.events.some(e => e.k === 'gesture' && e.g === 'help'));
console.log('装备抽屉 open:', sheetOpen, '· 点 3 -> gesture:help 事件:', gest);

// —— 摇杆：左半屏 touchstart/move -> stick.active + 位移 ——
const stick = await page.evaluate(async () => {
  const cv = document.getElementById('c');
  const t0 = new Touch({ identifier: 777, target: cv, clientX: 80, clientY: 600 });
  cv.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t0], touches: [t0], bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 60));
  const t1 = new Touch({ identifier: 777, target: cv, clientX: 80, clientY: 540 });
  cv.dispatchEvent(new TouchEvent('touchmove', { changedTouches: [t1], touches: [t1], bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 120));
  const s = window.__fd.session.o.input.stick;
  const st = document.getElementById('stick').getBoundingClientRect();
  const out = { active: s.active, x: +s.x.toFixed(2), y: +s.y.toFixed(2), stickMovedTo: [Math.round(st.x), Math.round(st.y)] };
  cv.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t1], touches: [], bubbles: true, cancelable: true }));
  return out;
});
console.log('摇杆:', JSON.stringify(stick), '(期望 active:true y:1 摇杆移到(24,544)附近)');

// —— presses：tap 应产生本帧 KeyL press ——
const press = await page.evaluate(() => {
  const inp = window.__fd.session.o.input;
  inp.sample();  // 清队列
  const el = document.querySelector('.tbtn[data-k="KeyM"]');
  return { presses: inp.presses.length, keys: [...inp.keys] };
});
console.log('输入队列自检:', JSON.stringify(press));

await page.screenshot({ path: 'reports/shots/mobile_dive.png' });
console.log('截图 -> reports/shots/mobile_dive.png');
console.log('错误:', errs.length ? errs : '无');
await browser.close();
