// CDP 端到端：教学模式流程验证
// 菜单 -> 教学课程 -> OW 第一课 -> 验证考核面板/步骤推进/键位表/面镜进水 -> 截图 -> 异常收集
// 用法：先 `npm run dev`，再 `node scripts/e2e_train.mjs [--url=http://localhost:5173]`
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9334;
const URL_ = process.env.GAME_URL || process.argv.find(a => a.startsWith('--url='))?.slice(6) || 'http://localhost:5173/';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DBG}`,
  '--window-size=1280,800', '--no-first-run', '--user-data-dir=/tmp/fundive-chrome-t',
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
  if (r?.exceptionDetails) logs.push(`[EVAL-ERR] ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`);
  return r?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r?.data) fs.writeFileSync(`/tmp/fundive-${name}.png`, Buffer.from(r.data, 'base64'));
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const key = async (code, holdMs = 80) => {
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`);
  await wait(holdMs);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))`);
};
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await wait(4500);
await shot('t1-menu');
ok(await evalJs(`!!document.getElementById('train')`), '菜单出现「教学课程」按钮');

// 进课程表
await evalJs(`document.getElementById('train').click()`);
await wait(800);
await shot('t2-courses');
const nLessons = await evalJs(`document.querySelectorAll('.lesson').length`);
ok(nLessons >= 10, `课程表列出 ${nLessons} 节课（OW+AOW+军队）`);
console.log('  课程：' + await evalJs(`[...document.querySelectorAll('.c-name')].map(e=>e.textContent).join(' | ')`));

// 进 OW 第一课
await evalJs(`document.querySelector('.lesson').click()`);
await wait(4000);
await shot('t3-lesson');
ok(await evalJs(`window.__fd.session?.constructor?.name === 'TrainingSession'`), 'TrainingSession 已启动');
ok(await evalJs(`!!document.getElementById('trainer')`), '考核面板出现');
ok(await evalJs(`!document.getElementById('hud').hidden`), 'HUD 显示');
console.log('  课目行：' + await evalJs(`document.getElementById('obj')?.textContent`));

// 第一步是 say（4s） -> 等到第二步 key:Tab
await wait(4500);
let step = await evalJs(`window.__fd.session.trainer.i`);
console.log(`  当前步骤 i=${step}`);
ok(step >= 1, 'say 步骤自动推进');

// 按 Tab 两次（开/关键位表，对应步骤 2、3）
await key('Tab', 120); await wait(300);
await shot('t4-keys');
ok(await evalJs(`document.getElementById('keys')?.classList.contains('show')`), 'Tab 唤出键位表');
await key('Tab', 120); await wait(500);
step = await evalJs(`window.__fd.session.trainer.i`);
console.log(`  Tab×2 后步骤 i=${step}`);
ok(step >= 3, 'Tab 键位表步骤完成');

// 步骤4: hold B 1s -> 按住 1.4s
await key('KeyB', 1400); await wait(300);
// 步骤5: hold V 1s
await key('KeyV', 1400); await wait(300);
step = await evalJs(`window.__fd.session.trainer.i`);
console.log(`  B/V 后步骤 i=${step}`);
ok(step >= 5, 'BCD 充放气通过');
ok(await evalJs(`Math.abs(window.__fd.session.player.buoy) < 1.01`), 'BCD 浮力字段生效 buoy=' + await evalJs(`window.__fd.session.player.buoy.toFixed(2)`));

// 步骤6: key L
await key('KeyL', 120); await wait(300);
// 步骤7: depth 3m hold —— 直接把人放到 3 米（顺手调回中性浮力，模拟配平好的学员）
await evalJs(`window.__fd.session.player.pos.y = -3; window.__fd.session.player.vel.set(0,0,0); window.__fd.session.player.buoy = 0`);
await wait(2600);
step = await evalJs(`window.__fd.session.trainer.i`);
console.log(`  深度后步骤 i=${step}`);
ok(step >= 7, '3 米悬停通过');
await shot('t5-progress');

// 步骤8: X+N 1.2s
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyX'})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN'}))`);
await wait(1500);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyX'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyN'}))`);
await wait(600);
// 结课后 session 已销毁，看结算屏
const resultUp = await evalJs(`!!document.querySelector('.endcard')`);
ok(resultUp, '第一课结课');
await shot('t6-result');
if (resultUp) {
  console.log('  结算标题：' + await evalJs(`document.querySelector('.endcard h2')?.textContent`));
  console.log('  步骤表行数：' + await evalJs(`document.querySelectorAll('.steps-table tbody tr').length`));
  ok(await evalJs(`document.querySelectorAll('.steps-table tbody tr').length`) >= 7, '结算含步骤明细');
}

// —— 面镜排水课：回课程表 -> ow_mask ——
await evalJs(`document.getElementById('list')?.click()`);
await wait(700);
const maskIdx = await evalJs(`[...document.querySelectorAll('.lesson .ln')].findIndex(e=>e.textContent.includes('面镜'))`);
ok(maskIdx >= 0, '找到面镜排水课');
await evalJs(`document.querySelectorAll('.lesson')[${maskIdx}].click()`);
await wait(3500);
// say 步骤：把它的计时推满，让考核引擎自然推进
await evalJs(`(()=>{const t=window.__fd.session?.trainer; if(t?.cur?.check.t==='say') t.cur.t=999;})()`);
await wait(600);
step = await evalJs(`window.__fd.session.trainer.i`);
console.log(`  面镜课起始步骤 i=${step}`);
await key('KeyM', 120); await wait(400);
ok(await evalJs(`window.__fd.session.player.maskOff === true`), '按 M 摘下面镜');
ok(await evalJs(`window.__fd.session.player.maskWater === 1`), '面镜全进水');
await shot('t7-maskoff');
// wait 3s 步骤
await wait(3300);
await key('KeyM', 120); await wait(400);
ok(await evalJs(`window.__fd.session.player.maskOff === false`), '按 M 戴回面镜');
// H+N 长按排水
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyH'})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN'}))`);
await wait(900);
const mw = await evalJs(`window.__fd.session.player.maskWater`);
console.log(`  吐气中面镜水位 ${mw}`);
ok(mw < 1 && mw > 0.2, 'H+N 排水过程可见（水位下降中）');
await shot('t8-maskdrain');
await wait(2500);
await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyH'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyN'}))`);
ok(await evalJs(`window.__fd.session.player.maskWater < 0.15`), '面镜水排干 ' + await evalJs(`window.__fd.session.player.maskWater.toFixed(2)`));
// 比 OK 结课
await key('Digit1', 120); await wait(900);
ok(await evalJs(`!!document.querySelector('.endcard')`), '面镜课结课');
await shot('t9-maskresult');

console.log('\n--- console/exceptions ---');
logs.forEach(l => console.log(l));
console.log(logs.length === 0 ? '(无异常)' : `共 ${logs.length} 条`);
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);

ws.close();
chrome.kill();
process.exit(fail ? 1 : 0);
