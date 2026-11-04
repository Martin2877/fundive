// 体验脚本：真实浏览器走完菜单→下水→操作→联机的完整流程
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = (process.argv.find(a => a.startsWith('--url=')) || '').split('=')[1] || 'http://localhost:5173/';
const OUT = '/tmp/fundive-play';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (c) => { if (c.type() === 'error' && !/404|favicon/.test(c.text())) errs.push(c.text()); });
page.on('pageerror', (e) => errs.push(e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const st = (expr) => page.evaluate(expr);
const say = (...a) => console.log(...a);
const sleep = (ms) => page.waitForTimeout(ms);

// ---------- 主菜单 ----------
await page.goto(URL);
await page.waitForSelector('.map', { timeout: 15000 });
await sleep(800);
await shot('01-menu');
say('== 主菜单 ==');
say('标题:', await st(`document.querySelector('h1.title')?.textContent`));
say('今日宇宙:', await st(`document.getElementById('uniname')?.textContent`), '|', await st(`document.getElementById('seedcode')?.textContent`));
const caveMaps = await page.locator('.map .n').allInnerTexts();
say('洞潜图数:', caveMaps.length, caveMaps.map(s => s.split('\n')[0].trim()).join(' / '));
await page.locator('[data-d=ocean]').dispatchEvent('click');
await sleep(300);
const oceanMaps = await page.locator('.map .n').allInnerTexts();
say('海潜图数:', oceanMaps.length, oceanMaps.map(s => s.split('\n')[0].trim()).join(' / '));
await shot('02-ocean');
await page.locator('[data-d=cave]').dispatchEvent('click');
await sleep(300);

// ---------- 图鉴 ----------
await page.click('#gallery');
await sleep(600);
await shot('03-gallery');
say('== 图鉴 ==', await st(`document.querySelector('h1.title')?.textContent`));
await page.click('#back').catch(() => {});
await sleep(400);

// ---------- 教学课程 ----------
await page.click('#train');
await sleep(600);
await shot('04-train');
say('== 课程表 ==', await st(`document.querySelector('h1.title')?.textContent`));
say('课程数:', await page.locator('.course, .lesson, .map').count());
await page.click('#back').catch(() => {});
await sleep(400);

// ---------- 单人潜水：计划页 ----------
await page.locator('.map').first().click();
await sleep(400);
await page.click('#solo');
await sleep(800);
await shot('05-plan');
say('== 计划页 ==', await st(`document.querySelector('h1.title')?.textContent`));
say('折返气压:', await st(`document.getElementById('pg')?.textContent`), '计划深度:', await st(`document.getElementById('pd')?.textContent`));

// ---------- 下水 ----------
await page.click('#dive');
await page.waitForFunction(() => window.__fd.session?.running, null, { timeout: 30000 });
await sleep(2000);
await shot('06-spawn');
const S = () => st(`(()=>{const s=window.__fd.session,p=s.player;return {pos:[p.pos.x,p.pos.y,p.pos.z].map(v=>+v.toFixed(1)),depth:+p.depth().toFixed(1),gas:+p.gas.toFixed(0),panic:+p.panic.toFixed(2),dead:p.dead,obj:s.objective?.statusText?.(s.uni)?.replace(/<[^>]+>/g,''),buddy:!!s.buddy?.pos}})()`);
say('== 下水 ==', JSON.stringify(await S()));

// ---------- 游动 ----------
const p0 = await st(`(()=>{const p=window.__fd.session.player.pos.clone();return [p.x,p.y,p.z]})()`);
await page.keyboard.down('w');
await sleep(2500);
await page.keyboard.up('w');
const p1 = await st(`(()=>{const p=window.__fd.session.player.pos;return [p.x,p.y,p.z]})()`);
const moved = Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]);
say('游动位移:', moved.toFixed(1), 'm  gas:', (await S()).gas);
await shot('07-swim');

// 转向 + 深度计
await st(`window.__fd.session.player.yaw += 1.2`);
await sleep(500);
await shot('08-turned');

// ---------- 快踢搅沙 ----------
await st(`window.__fd.session.player.pitch = -0.5`);
await page.keyboard.down(' ');
await sleep(1500);
await page.keyboard.up(' ');
await shot('09-kick');
say('搅沙后:', JSON.stringify(await S()));

// ---------- 拍照 ----------
await page.keyboard.press('f');
await sleep(700);
await shot('10-viewfinder');
await page.keyboard.press('f');
await sleep(1000);
await shot('11-shot');
say('拍照后图鉴数:', await st(`Object.keys(localStorage).filter(k=>k.includes('fundive')).map(k=>k+':'+(localStorage[k]||'').length).join(', ')`));

// ---------- 灯 ----------
await page.keyboard.press('l');
await sleep(900);
await shot('12-lightoff');
await page.keyboard.press('l');
await sleep(600);

// ---------- 抓引绳 ----------
await page.keyboard.press('g');
await sleep(600);
say('抓绳状态:', await st(`(()=>{const s=window.__fd.session;return {line:s.line?.grabbed ?? s.player?.onLine ?? 'n/a'}})()`));
await shot('13-line');

// ---------- 键位表 ----------
await page.keyboard.press('Tab');
await sleep(500);
await shot('14-keys');
await page.keyboard.press('Tab');
await sleep(300);

// ---------- 暂停 ----------
await page.keyboard.press('Escape');
await sleep(600);
await shot('15-pause');
say('暂停画面:', await st(`document.querySelector('.scr.show h1, #pause h1, .title')?.textContent`));
await page.keyboard.press('Escape');
await sleep(600);

// ---------- 传送到目标点附近 -> 互动 ----------
await st(`(()=>{const s=window.__fd.session,sp=s.cave.objectiveSpot;if(!sp)return 'no spot';s.player.pos.copy(sp.pos);s.player.pos.y+=1;s.player.vel.set(0,0,0);return 'ok'})()`);
await sleep(900);
await shot('16-objective');
await page.keyboard.press('e');
await sleep(1200);
say('目标交互后:', JSON.stringify(await S()));
await shot('17-objective-done');

// ---------- 体感/HUD 检查 ----------
say('HUD:', await st(`(()=>{const q=s=>document.querySelector(s)?.textContent?.trim();return {depth:q('#depth')||q('.depth'),gas:q('#gas')||q('.gas'),hud:document.getElementById('hud')?.innerText?.slice(0,200)}})()`));

// ---------- FPS ----------
const fps = await st(`new Promise(r=>{let n=0;const t=performance.now();const f=()=>{n++;performance.now()-t>2500?r(n/2.5):requestAnimationFrame(f)};f()})`);
say('FPS:', Math.round(fps));

// ---------- 联机：开房 ----------
const p2 = await ctx.newPage();
const errs2 = [];
p2.on('pageerror', (e) => errs2.push(e.message));
await p2.goto(URL);
await p2.waitForSelector('#lobby');
await p2.click('#lobby');
await p2.waitForSelector('#name');
await p2.fill('#name', '体验员');
await p2.click('#create');
await p2.waitForSelector('#rcode:not(:empty)', { timeout: 10000 }).catch(() => {});
const rcode = await p2.locator('#rcode').innerText().catch(() => '(无)');
say('== 联机 == 房间码:', rcode.trim() || '(未获取)');
await p2.screenshot({ path: `${OUT}/18-lobby.png` });

say('\n== 控制台错误 ==');
say(errs.length ? errs.join('\n') : '（无）');
say(errs2.length ? '联机页错误: ' + errs2.join('; ') : '');
await browser.close();
