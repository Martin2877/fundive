// 战术课探针：mil_dark(fire+blackout+Q备灯) / mil_line(linehold) / mil_crack(squeeze)
// 用法：先 npm run dev，再 node scripts/milprobe.mjs [--url=http://localhost:5173]
import { spawn } from 'node:child_process';
import http from 'node:http';
import WebSocket from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9335;
const URL_ = process.env.GAME_URL || process.argv.find(a => a.startsWith('--url='))?.slice(6) || 'http://localhost:5173/';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DBG}`,
  '--window-size=1280,800', '--no-first-run', '--user-data-dir=/tmp/fundive-chrome-m',
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

let mid = 0, fails = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const errors = [];
ws.on('message', b => {
  const m = JSON.parse(b);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] || 'exc');
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) { console.log('  ! JS:', r.result.exceptionDetails.exception?.description?.slice(0, 160)); return undefined; }
  return r.result?.result?.value;
};
const key = (code) => evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`).then(() => evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))`));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const curT = () => evalJs(`window.__fd.session?.trainer?.cur?.check?.t`);
const skipSay = () => evalJs(`(()=>{const t=window.__fd.session?.trainer; if(t?.cur?.check.t==='say'){t.cur.t=999;return true}return false})()`);
const tpNode = (n) => evalJs(`(()=>{const s=window.__fd.session,nd=s.cave.nodes[${n}];s.player.pos.copy(nd.pos);s.player.vel.set(0,0,0);return true})()`);
const tpToLine = () => evalJs(`(()=>{const s=window.__fd.session,lp=s.cave.linePts||[];let best=null,bd=1e9;for(const q of lp){const d=q.distanceTo(s.player.pos);if(d<bd){bd=d;best=q}}if(!best)return null;s.player.pos.copy(best);s.player.vel.set(0,0,0);return bd.toFixed(2)})()`);
const waitStep = async (t, tries = 40) => { for (let i = 0; i < tries; i++) { if ((await curT()) === t || await evalJs(`window.__fd.session?.trainer?.done || !!document.querySelector('.endcard')`)) return await curT(); await sleep(500); } return await curT(); };
const skipSays = async () => { for (let g = 0; g < 30; g++) { if ((await skipSay()) !== true) break; await sleep(500); } };
const backToList = async () => {
  for (let i = 0; i < 20; i++) {
    if (await evalJs(`document.querySelectorAll('.lesson').length`) > 0) return true;
    await evalJs(`document.getElementById('list')?.click()`);
    await evalJs(`document.getElementById('gotrain')?.click()`);
    await sleep(600);
  }
  return false;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await sleep(2500);

// —— mil_dark：lightoff -> 摸黑reach -> L开灯 -> blackout注入 -> Q备灯 ——
console.log('[mil_dark 黑暗冗余]');
await evalJs(`document.querySelector('[data-d=train]').click()`); await sleep(300);
await evalJs(`document.getElementById('gotrain').click()`); await sleep(500);
const di = await evalJs(`[...document.querySelectorAll('.lesson .ln')].findIndex(e=>e.textContent.includes('黑暗冗余'))`);
ok(di >= 0, '课程表里有 黑暗冗余');
await evalJs(`document.querySelectorAll('.lesson')[${di}].click()`); await sleep(2500);
ok(await evalJs(`window.__fd.session?.constructor?.name === 'TrainingSession'`), 'TrainingSession 启动');
await skipSays();
ok(await waitStep('lightoff') === 'lightoff', '步骤=关灯 (' + await curT() + ')');
await key('KeyL'); await sleep(600);
ok(await waitStep('reach') === 'reach', '步骤=摸黑到浮标 (' + await curT() + ')');
ok(await evalJs(`window.__fd.session.trainer.marker.visible === true`), '目标标记可见');
await tpNode(2); await sleep(1000);
ok(await waitStep('key') === 'key', '步骤=开主灯 (' + await curT() + ')');
await key('KeyL'); await sleep(600);
ok(await waitStep('wait') === 'wait', '步骤=等灯灭 (' + await curT() + ')');
ok(await evalJs(`window.__fd.session.player.blackoutT > 0`), 'blackout 注入生效');
await waitStep('key'); await sleep(400);
ok(await evalJs(`window.__fd.session.player.lightOn === false`), '主灯真灭了');
await key('KeyQ'); await sleep(700);
ok(await evalJs(`window.__fd.session.player.backupOn === true`), 'Q 开了备灯');
ok(await waitStep('reach') === 'reach', '步骤=回码头 (' + await curT() + ')');
await tpNode(1); await sleep(1000);
await skipSays(); await sleep(800);
ok(await evalJs(`!!document.querySelector('.endcard') || !!window.__fd.session?.trainer?.done`), 'mil_dark 结课');

// —— mil_line：dosojos 引绳 + G 抓绳 ——
console.log('[mil_line 引绳纪律]');
ok(await backToList(), '回到课程表');
const li = await evalJs(`[...document.querySelectorAll('.lesson .ln')].findIndex(e=>e.textContent.includes('引绳纪律'))`);
ok(li >= 0, '课程表里有 引绳纪律');
await evalJs(`document.querySelectorAll('.lesson')[${li}].click()`); await sleep(2500);
ok(await evalJs(`window.__fd.session.map.id === 'dosojos'`), '地图=dosojos 真洞');
await skipSays();
await waitStep('reach'); await tpNode(1); await sleep(1000);
ok(await waitStep('linehold') === 'linehold', '步骤=抓绳悬停 (' + await curT() + ')');
const ld = await tpToLine();
ok(ld !== null && +ld < 60, '移到绳边 原距绳=' + ld + 'm');
await key('KeyG'); await sleep(1000);
ok(await waitStep('reach') === 'reach', 'G 抓绳通过 (' + await curT() + ')');
await tpNode(4); await sleep(1200);
await tpNode(1); await sleep(1500);
await skipSays(); await sleep(800);
ok(await evalJs(`!!document.querySelector('.endcard') || !!window.__fd.session?.trainer?.done`), 'mil_line 结课');

// —— mil_crack：dosojos 窄缝进/退 ——
console.log('[mil_crack 窄缝自知]');
ok(await backToList(), '回到课程表');
const ci = await evalJs(`[...document.querySelectorAll('.lesson .ln')].findIndex(e=>e.textContent.includes('窄缝自知'))`);
ok(ci >= 0, '课程表里有 窄缝自知');
await evalJs(`document.querySelectorAll('.lesson')[${ci}].click()`); await sleep(2500);
await skipSays();
await waitStep('reach'); await tpNode(9); await sleep(1000);
ok(await waitStep('squeeze') === 'squeeze', '步骤=钻缝 (' + await curT() + ')');
const sqPos = await evalJs(`(()=>{const s=window.__fd.session;const q=s.cave.squeezes?.find(x=>x.hard);if(!q)return null;s.player.pos.copy(q.pos);s.player.vel.set(0,0,0);return 'tp'})()`);
ok(sqPos === 'tp', '传送到窄缝位');
await sleep(1500);
ok(await evalJs(`window.__fd.session.player.inCrack?.hard === true`), '进缝判定 inCrack.hard');
await sleep(300);
await tpNode(9); await sleep(1500);
const afterSq = await evalJs(`window.__fd.session?.trainer?.i ?? -1`);
ok(await evalJs(`(window.__fd.session?.trainer?.i ?? 99) >= 3 || !!document.querySelector('.endcard')`), '退缝完成，步骤推进到回主线/结课 (i=' + afterSq + ')');
for (let i = 0; i < 15; i++) { await skipSays(); if (await evalJs(`!!document.querySelector('.endcard')`)) break; await evalJs(`(()=>{const s=window.__fd.session;if(!s)return;const nd=s.cave.nodes[9];if(nd){s.player.pos.copy(nd.pos);s.player.vel.set(0,0,0)}})()`); await sleep(700); }
ok(await evalJs(`!!document.querySelector('.endcard') || !!window.__fd.session?.trainer?.done`), 'mil_crack 结课');

// —— mil_frost：冰湖安全绳 + 自由流注入 + Q 换备头 ——
console.log('[mil_frost 寒区事故处置]');
ok(await backToList(), '回到课程表');
const fi = await evalJs(`[...document.querySelectorAll('.lesson .ln')].findIndex(e=>e.textContent.includes('寒区'))`);
ok(fi >= 0, '课程表里有 寒区事故处置');
await evalJs(`document.querySelectorAll('.lesson')[${fi}].click()`); await sleep(2500);
ok(await evalJs(`window.__fd.session.map.id === 'icelake'`), '地图=icelake 冰湖');
await skipSays();
await waitStep('reach'); await tpNode(2); await sleep(1200);
ok(await waitStep('key') === 'key', '步骤=换备头 (' + await curT() + ')');
ok(await evalJs(`window.__fd.session.player.freeflow > 0`), 'freeflow 注入生效 freeflow=' + await evalJs(`window.__fd.session.player.freeflow?.toFixed(1)`));
await key('KeyQ'); await sleep(800);
ok(await evalJs(`window.__fd.session.player.freeflow <= 0`), 'Q 止住了自由流');
await waitStep('reach'); await tpNode(1); await sleep(1200);
for (let i = 0; i < 15; i++) { if (await evalJs(`!!document.querySelector('.endcard')`)) break; await evalJs(`(()=>{const s=window.__fd.session;if(!s)return;const nd=s.cave.nodes[0];if(nd){s.player.pos.copy(nd.pos);s.player.pos.y=0;s.player.vel.set(0,0,0)}})()`); await sleep(700); }
ok(await evalJs(`!!document.querySelector('.endcard') || !!window.__fd.session?.trainer?.done`), 'mil_frost 结课');

console.log('\n--- console/exceptions ---');
console.log(errors.length ? errors.join('\n') : '无');
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
chrome.kill();
process.exit(fails || errors.length ? 1 : 0);
