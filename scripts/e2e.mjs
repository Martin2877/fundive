// CDP 端到端测试：无头 Chrome 打开游戏 -> 点单人下水 -> 点按计划下水
// -> 收集 console/异常 -> 截图各阶段 -> 输出诊断
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9333;
const URL_ = process.env.GAME_URL || 'http://localhost:8790/';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DBG}`,
  '--window-size=1280,800', '--no-first-run', '--user-data-dir=/tmp/fundive-chrome',
  'about:blank',
], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));

const json = (path) => new Promise((res, rej) => {
  http.get({ host: 'localhost', port: DBG, path }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const targets = await json('/json/list');
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));

let mid = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => {
  const id = ++mid;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const logs = [];
ws.on('message', (b) => {
  const m = JSON.parse(b);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    logs.push(`[console.${m.params.type}] ${txt}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${e.text} ${e.exception?.description || ''}`);
  }
});

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r?.data) fs.writeFileSync(`/tmp/fundive-${name}.png`, Buffer.from(r.data, 'base64'));
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await wait(4000);
await shot('1-menu');
console.log('menu title:', await evalJs(`document.querySelector('h1.title')?.textContent`));
console.log('canvas size:', await evalJs(`[document.getElementById('c').width, document.getElementById('c').height]`));
console.log('webgl ok:', await evalJs(`!!document.getElementById('c').getContext`));

// 点独自下水
await evalJs(`document.getElementById('solo').click()`);
await wait(1200);
await shot('2-plan');
console.log('plan shown:', await evalJs(`!!document.getElementById('dive')`));
console.log('plan title:', await evalJs(`document.querySelector('h1.title')?.textContent`));

// 点按计划下水
await evalJs(`document.getElementById('dive').click()`);
await wait(3500);
await shot('3-dive');
console.log('hud shown:', await evalJs(`!document.getElementById('hud').hidden`));
console.log('depth:', await evalJs(`window.__fd.session?.player.depth().toFixed(1)`));
console.log('obj text:', await evalJs(`document.getElementById('obj')?.textContent`));

// 低头往前游 6 秒进洞（直接改 player.pitch，测试不依赖 pointer lock）
await evalJs(`window.__fd.session.player.pitch = -0.15`);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))`);
await wait(6000);
await shot('4-swim');
console.log('depth after swim:', await evalJs(`window.__fd.session?.player.depth().toFixed(1)`));
console.log('gas:', await evalJs(`Math.round(window.__fd.session?.player.gas)`));
// 拍照一张
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))`);
await wait(400);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}))`);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))`);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}))`);
await wait(800);
await shot('5-photo');
console.log('film:', await evalJs(`document.querySelector('#finder .film')?.textContent`));
await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))`);

// 传送到洞穴中段看大厅
await evalJs(`
(() => {
  const s = window.__fd.session;
  const sp = s.cave.mainSpine;
  const i = Math.floor(sp.length * 0.62);
  s.player.pos.copy(sp[i].p);
  const ahead = sp[Math.min(sp.length-1, i+8)].p;
  s.player.yaw = Math.atan2(-(ahead.x - sp[i].p.x), -(ahead.z - sp[i].p.z));
  s.player.pitch = 0;
  s.player.vel.set(0,0,0);
  return sp[i].p.toArray();
})()`);
await wait(1500);
await shot('6-deep');
console.log('deep depth:', await evalJs(`window.__fd.session?.player.depth().toFixed(1)`));
// 看潜伴/生物
await evalJs(`window.__fd.session.player.yaw += 1.2`);
await wait(1000);
await shot('7-look');

console.log('\n--- console/exceptions ---');
logs.forEach(l => console.log(l));
console.log(logs.length === 0 ? '(无异常)' : `共 ${logs.length} 条`);

ws.close();
chrome.kill();
process.exit(0);
