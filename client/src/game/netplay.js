// 联机客户端：大厅 -> 共潜。世界由 mapId+seed 确定性生成，
// 网络上只传位姿/事件。断线自动回落单机。
import * as THREE from 'three';
import { MSG, POSE_HZ, encode, decode } from '@fundive/shared/protocol.js';
import { makeDiver } from '../engine/diver.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.name = 'Diver';
    this.room = null;         // {code, host, players, mapId, seed}
    this.handlers = {};       // t -> fn
    this.connected = false;
    this.diving = false;
  }

  connect() {
    if (this.ws) return Promise.resolve(this);
    // 联机端点：VITE_WS_URL（构建期注入，给静态托管指到自托管的 ws 服务）；
    // 未配置时走同源 /ws —— `npm start` / vite dev 代理都能接住
    const env = import.meta.env?.VITE_WS_URL?.trim();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = env || `${proto}://${location.host}/ws`;
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => rej(new Error('connect timeout')), 5000);
      ws.onopen = () => { };
      ws.onmessage = (e) => {
        const m = decode(e.data);
        if (!m) return;
        if (m.t === MSG.WELCOME) { this.id = m.id; this.name = m.name; this.connected = true; clearTimeout(to); res(this); }
        if (m.t === MSG.ROOM_STATE) { this.room = m; }
        this.handlers[m.t]?.(m);
      };
      ws.onclose = () => { this.connected = false; this.diving = false; this.handlers._close?.(); };
      ws.onerror = () => { clearTimeout(to); rej(new Error('connect failed')); };
    });
  }

  send(o) { if (this.ws?.readyState === 1) this.ws.send(encode(o)); }
  on(t, fn) { this.handlers[t] = fn; }

  createRoom(mapId, seed) { this.send({ t: MSG.ROOM_CREATE, mapId, seed }); }
  joinRoom(code) { this.send({ t: MSG.ROOM_JOIN, code }); }
  leaveRoom() { this.send({ t: MSG.ROOM_LEAVE }); this.room = null; }
  setMap(mapId, seed) { this.send({ t: MSG.SET_MAP, mapId, seed }); }
  ready(r) { this.send({ t: MSG.READY, ready: r }); }
  start() { this.send({ t: MSG.START }); }
  event(k, data) { this.send({ t: MSG.EVENT, k, data }); }
  gameOver(results) { this.send({ t: MSG.GAME_OVER, results }); }
}

// —— 远程潜水员渲染 ——
export class Peers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> {obj, buf:[{t,p,q}], gas, flags, dead}
    this.sendT = 0;
    this.colors = [0x2a4a5a, 0x4a3a5a, 0x3a5a3a, 0x5a4a2a];
    this._ci = 0;
  }
  add(id, name) {
    if (this.map.has(id)) return;
    const obj = makeDiver({ suit: this.colors[this._ci++ % this.colors.length], name, arm: true });
    this.scene.add(obj);
    this.map.set(id, { obj, buf: [], gas: 200, flags: 0, name });
  }
  remove(id) {
    const p = this.map.get(id);
    if (p) { this.scene.remove(p.obj); this.map.delete(id); }
  }
  pose(id, p, q, gas, flags) {
    const peer = this.map.get(id);
    if (!peer) return;
    peer.buf.push({ t: performance.now() / 1000, p, q });
    if (peer.buf.length > 30) peer.buf.shift();
    peer.gas = gas; peer.flags = flags;
  }
  // 发送本地位姿（~12Hz）
  maybeSend(net, dt, player, quat) {
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / POSE_HZ;
    net.send({
      t: MSG.POSE,
      p: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
      q: [+quat.x.toFixed(3), +quat.y.toFixed(3), +quat.z.toFixed(3), +quat.w.toFixed(3)],
      gas: Math.round(player.gas), flags: player.dead ? 1 : 0,
    });
  }
  update(dt) {
    const now = performance.now() / 1000 - 0.15; // 150ms 插值延迟
    for (const [, peer] of this.map) {
      const b = peer.buf;
      if (b.length < 2) continue;
      while (b.length > 2 && b[1].t < now) b.shift();
      const [a, c] = [b[0], b[1]];
      const f = THREE.MathUtils.clamp((now - a.t) / Math.max(0.01, c.t - a.t), 0, 1);
      peer.obj.position.set(a.p[0] + (c.p[0] - a.p[0]) * f, a.p[1] + (c.p[1] - a.p[1]) * f, a.p[2] + (c.p[2] - a.p[2]) * f);
      _q.set(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(_v2q(c.q), f);
      peer.obj.quaternion.copy(_q);
      peer.obj.userData.update(dt, 1);
      peer.obj.visible = !(peer.flags & 1);
    }
  }
}
function _v2q(q) { return new THREE.Quaternion(q[0], q[1], q[2], q[3]); }
