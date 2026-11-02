// 冒烟测试：
// 1) 每张地图 × 若干种子 -> makeUniverse 确定性 + 目标合法
// 2) ws 全流程：建房/加入/准备/开局/位姿转发/事件转发
import { MAPS, SPECIES, ENDINGS } from '../shared/maps.js';
import { makeUniverse, objectiveText } from '../shared/universe.js';
import { MSG } from '../shared/protocol.js';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

let fail = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fail++; };

console.log('== 宇宙生成 ==');
for (const m of MAPS) {
  const u1 = makeUniverse(m.id, 'TEST-SEED');
  const u2 = makeUniverse(m.id, 'TEST-SEED');
  const u3 = makeUniverse(m.id, 'OTHER-123');
  ok(JSON.stringify(u1) === JSON.stringify(u2), `${m.id} 同种子确定性`);
  ok(u1.objective && MAPS.find(x => x.id === m.id).objectives.includes(u1.objective.type), `${m.id} 目标类型合法: ${u1.objective.type}`);
  if (u1.objective.type === 'photo') ok(!!SPECIES[u1.objective.species], `${m.id} 拍摄目标物种存在: ${u1.objective.species}`);
  ok(u1.placements.length >= 0, `${m.id} 布点 ${u1.placements.length} 处`);
  console.log(`    ${m.name} | ${u1.name} | ${objectiveText(u1)} | 风味:${u1.flavor.join('、') || '无'}`);
}
const types = new Set();
for (let i = 0; i < 40; i++) types.add(makeUniverse('thamluang', 'S' + i).objective.type);
ok(types.size >= 3, `睡美人洞 40 个宇宙覆盖 ${types.size} 种目标类型: ${[...types].join(',')}`);

console.log('== 联机协议 ==');
const PORT = 8899;
const srv = spawn('node', ['server/src/index.js'], { env: { ...process.env, PORT } });
await new Promise(r => setTimeout(r, 800));

const conn = (name) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const client = { ws, name, msgs: [], id: null, room: null };
  ws.on('message', (b) => {
    const m = JSON.parse(b);
    client.msgs.push(m);
    if (m.t === MSG.WELCOME) { client.id = m.id; res(client); }
    if (m.t === MSG.ROOM_STATE) client.room = m;
  });
  ws.on('error', rej);
});
const send = (c, o) => c.ws.send(JSON.stringify(o));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); } return null; };

try {
  const A = await conn('A'), B = await conn('B');
  send(A, { t: MSG.HELLO, name: '阿蓝' });
  send(A, { t: MSG.ROOM_CREATE, mapId: 'thamluang', seed: 'TEST-ROOM' });
  const stA = await until(() => A.room);
  ok(stA && stA.code?.length === 4, `A 建房成功 code=${stA?.code}`);
  send(B, { t: MSG.ROOM_JOIN, code: stA.code });
  await until(() => B.room?.players?.length === 2);
  ok(B.room?.players?.length === 2, 'B 加入房间，2人');
  send(B, { t: MSG.READY, ready: true });
  send(A, { t: MSG.START });
  const gs = await until(() => B.msgs.find(m => m.t === MSG.GAME_START));
  ok(gs?.mapId === 'thamluang' && gs?.seed === 'TEST-ROOM', '开局广播 mapId+seed 一致');
  send(A, { t: MSG.POSE, p: [1, -5, -10], q: [0, 0, 0, 1], gas: 190, flags: 0 });
  const pp = await until(() => B.msgs.find(m => m.t === MSG.PEER_POSE));
  ok(pp?.id === A.id && pp.p[1] === -5, '位姿转发 A->B');
  send(B, { t: MSG.EVENT, k: 'photo', data: { subject: 'cavefish', stars: 3 } });
  const ev = await until(() => A.msgs.find(m => m.t === MSG.EVENT && m.k === 'photo'));
  ok(ev?.id === B.id && ev?.subject === 'cavefish', '事件转发 B->A');
  // 非房主不能换图/开局已开局不能加入
  const C = await conn('C');
  send(C, { t: MSG.ROOM_JOIN, code: stA.code });
  const err = await until(() => C.msgs.find(m => m.t === MSG.ROOM_ERR));
  ok(!!err, '潜水中加入被拒');
  A.ws.close(); B.ws.close(); C.ws.close();
} catch (e) {
  ok(false, '联机流程异常: ' + e.message);
} finally {
  srv.kill();
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
