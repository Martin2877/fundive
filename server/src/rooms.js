// 房间管理：大厅 -> 同宇宙共潜 -> 结算。服务器只做转发与房间状态，
// 世界本体由 mapId+seed 在各客户端确定性生成，不做权威模拟。
import { MSG, MAX_DIVERS, encode, decode } from '@fundive/shared/protocol.js';
import { randomSeed } from '@fundive/shared/rng.js';

const CODES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class Rooms {
  constructor() {
    this.rooms = new Map();   // code -> room
    this.players = new Map(); // id -> {ws, room, name}
    this.nextId = 1;
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODES[Math.floor(Math.random() * CODES.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  attach(ws) {
    const id = `d${this.nextId++}`;
    const player = { id, ws, name: `Diver-${id.slice(1)}`, room: null };
    this.players.set(id, player);
    ws.on('message', (buf) => this.onMessage(player, decode(buf.toString())));
    ws.on('close', () => this.leave(player));
    this.send(player, { t: MSG.WELCOME, id, name: player.name });
  }

  send(p, obj) {
    if (p.ws.readyState === 1) p.ws.send(encode(obj));
  }

  broadcast(room, obj, exceptId = null) {
    const s = encode(obj);
    for (const pid of room.players) {
      if (pid === exceptId) continue;
      const pl = this.players.get(pid);
      if (pl?.ws.readyState === 1) pl.ws.send(s);
    }
  }

  roomState(room) {
    return {
      t: MSG.ROOM_STATE,
      code: room.code, host: room.host, state: room.state,
      mapId: room.mapId, seed: room.seed,
      players: [...room.players].map(pid => {
        const p = this.players.get(pid);
        return { id: pid, name: p?.name, ready: room.ready.has(pid) };
      }),
    };
  }

  leave(player) {
    const room = player.room && this.rooms.get(player.room);
    player.room = null;
    if (!room) return;
    room.players.delete(player.id);
    room.ready.delete(player.id);
    room.finished?.delete(player.id);
    if (room.players.size === 0) { this.rooms.delete(room.code); return; }
    if (room.host === player.id) room.host = [...room.players][0];
    if (room.state === 'diving') this.broadcast(room, { t: MSG.PEER_LEFT, id: player.id });
    this.broadcast(room, this.roomState(room));
  }

  onMessage(p, m) {
    if (!m || !m.t) return;
    const room = p.room && this.rooms.get(p.room);
    switch (m.t) {
      case MSG.HELLO:
        if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.trim().slice(0, 16);
        this.send(p, { t: MSG.WELCOME, id: p.id, name: p.name });
        break;

      case MSG.ROOM_CREATE: {
        if (room) return this.send(p, { t: MSG.ROOM_ERR, msg: '已在房间里' });
        const code = this.newCode();
        const r = { code, players: new Set([p.id]), ready: new Set(), host: p.id, state: 'lobby', mapId: m.mapId || 'dosojos', seed: m.seed || randomSeed() };
        this.rooms.set(code, r);
        p.room = code;
        this.send(p, this.roomState(r));
        break;
      }

      case MSG.ROOM_JOIN: {
        if (room) return this.send(p, { t: MSG.ROOM_ERR, msg: '已在房间里' });
        const r = this.rooms.get(String(m.code || '').toUpperCase());
        if (!r) return this.send(p, { t: MSG.ROOM_ERR, msg: '没有这个房间' });
        if (r.players.size >= MAX_DIVERS) return this.send(p, { t: MSG.ROOM_ERR, msg: '房间满了（最多4人）' });
        if (r.state === 'diving') return this.send(p, { t: MSG.ROOM_ERR, msg: '他们已经下水了' });
        r.players.add(p.id);
        p.room = r.code;
        this.broadcast(r, { t: MSG.PEER_JOIN, id: p.id, name: p.name }, p.id);
        this.broadcast(r, this.roomState(r));
        break;
      }

      case MSG.ROOM_LEAVE:
        this.leave(p);
        break;

      case MSG.SET_MAP:
        if (room && room.host === p.id && room.state === 'lobby') {
          room.mapId = m.mapId; room.seed = m.seed;
          this.broadcast(room, this.roomState(room));
        }
        break;

      case MSG.READY:
        if (room && room.state === 'lobby') {
          m.ready ? room.ready.add(p.id) : room.ready.delete(p.id);
          this.broadcast(room, this.roomState(room));
        }
        break;

      case MSG.START: {
        if (!room || room.host !== p.id) return;
        const nonHost = [...room.players].filter(id => id !== room.host);
        if (nonHost.length && nonHost.some(id => !room.ready.has(id))) {
          return this.send(p, { t: MSG.ROOM_ERR, msg: '还有人没准备好' });
        }
        room.state = 'diving';
        this.broadcast(room, { t: MSG.GAME_START, mapId: room.mapId, seed: room.seed, players: [...room.players].map(id => ({ id, name: this.players.get(id)?.name })) });
        break;
      }

      case MSG.POSE:
        if (room && room.state === 'diving') {
          this.broadcast(room, { t: MSG.PEER_POSE, id: p.id, p: m.p, q: m.q, gas: m.gas, flags: m.flags }, p.id);
        }
        break;

      case MSG.EVENT:
        if (room && room.state === 'diving') {
          this.broadcast(room, { t: MSG.EVENT, id: p.id, k: m.k, ...m.data }, p.id);
        }
        break;

      case MSG.GAME_OVER:
        if (room) {
          // 有人结束不代表全队结束：全员都交了结果才回大厅，否则还在水下的人会断位姿
          (room.finished ||= new Set()).add(p.id);
          this.broadcast(room, { t: MSG.GAME_OVER, results: m.results });
          if ([...room.players].every(id => room.finished.has(id))) {
            room.state = 'lobby'; room.ready.clear(); room.finished.clear();
            this.broadcast(room, this.roomState(room));
          }
        }
        break;
    }
  }
}
