// Supabase 联机后端：与 Net 同接口的替换实现，供纯静态部署（Cloudflare Pages）联机用。
// 原理：房间 = 一个 Realtime 频道（fd-room-<CODE>）。
//   presence  -> 大厅成员状态（名字/就绪/房主元数据 mapId+seed+state），房主 = 最早加入者；
//   broadcast -> 位姿(POSE)、事件(EVENT)、下水(GAME_START)、结算(GAME_OVER)。
// 世界本体依旧由 (mapId, seed) 各端确定性生成，只传位姿与事件。
// 需要的构建期环境变量：VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（anon key 本来就是公开的）。
import { MSG, MAX_DIVERS } from '@fundive/shared/protocol.js';
import { randomSeed } from '@fundive/shared/rng.js';

const CODES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODES[Math.floor(Math.random() * CODES.length)]).join('');

export function supabaseConfigured() {
  return !!(import.meta.env?.VITE_SUPABASE_URL?.trim() && import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim());
}

export class SupaNet {
  constructor() {
    this.sb = null;
    this.chan = null;
    this.code = null;
    this.id = 'd' + Math.random().toString(36).slice(2, 10);
    this.name = 'Diver';
    this.room = null;          // 与 ws 版同形：{code, host, players, mapId, seed, state}
    this.handlers = {};
    this.connected = false;
    this.diving = false;
    this._me = { j: 0, name: this.name, rdy: false };  // 自己的 presence 载荷（m 只有房主带）
    this._hostState = null;  // 自己是房主时的 {mapId, seed, state}
    this._want = null;       // 开房意图（claim 房主时写入 presence.m）
    this._members = new Set();
    this._finished = new Set();
  }

  // —— 连接（探针订阅一个频道确认 Realtime 可用） ——
  async connect() {
    if (this.sb) return this;
    const { createClient } = await import('@supabase/supabase-js');
    this.sb = createClient(
      import.meta.env.VITE_SUPABASE_URL.trim(),
      import.meta.env.VITE_SUPABASE_ANON_KEY.trim(),
      { realtime: { params: { eventsPerSecond: 40 } } },
    );
    await new Promise((res, rej) => {
      const to = setTimeout(() => { cleanup(); rej(new Error('realtime timeout')); }, 6000);
      const probe = this.sb.channel('fd-probe', { config: { private: false } });
      const cleanup = () => { clearTimeout(to); this.sb.removeChannel(probe); };
      probe.subscribe((st) => {
        if (st === 'SUBSCRIBED') { cleanup(); res(); }
        if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { cleanup(); rej(new Error('realtime ' + st.toLowerCase())); }
      });
    });
    this.connected = true;
    return this;
  }

  on(t, fn) { this.handlers[t] = fn; }
  _err(msg) { this.handlers[MSG.ROOM_ERR]?.({ t: MSG.ROOM_ERR, msg }); }
  _cast(payload) { this.chan?.send({ type: 'broadcast', event: 'm', payload }); }

  // ws 版 Net.send 的最小兼容：大厅 HELLO / 潜水期 POSE、EVENT
  send(o) {
    switch (o?.t) {
      case MSG.HELLO:
        if (typeof o.name === 'string' && o.name.trim()) {
          this.name = o.name.trim().slice(0, 16);
          this._me.name = this.name;
          this._retrack();
        }
        break;
      case MSG.POSE:
        this._cast({ t: MSG.PEER_POSE, id: this.id, p: o.p, q: o.q, gas: o.gas, flags: o.flags });
        break;
      case MSG.EVENT:
        this._cast({ t: MSG.EVENT, id: this.id, k: o.k, ...(o.data || {}) });
        break;
    }
  }

  async createRoom(mapId, seed) {
    // 4 位码撞房概率极低但不为零——撞了就换码再开（最多 3 次）
    for (let i = 0; i < 3; i++) {
      const code = newCode();
      this._want = { mapId: mapId || 'dosojos', seed: seed || randomSeed(), state: 'lobby' };
      await this._join(code);
      const others = await this._waitPeers(1000);
      if (others === 0) return;   // 空房：自己就是房主，等 presence 认领
      await this._leaveChan();
    }
    this._err('开房失败——换个运气再试');
  }

  async joinRoom(code) {
    code = String(code || '').toUpperCase();
    if (this.chan) return this._err('已在房间里');
    this._want = null;
    await this._join(code);
    const { others, state } = await this._waitRoom(1400);
    if (!others) { await this._leaveChan(); return this._err('没有这个房间'); }
    if (others >= MAX_DIVERS) { await this._leaveChan(); return this._err('房间满了（最多4人）'); }
    if (state === 'diving') { await this._leaveChan(); return this._err('他们已经下水了'); }
  }

  leaveRoom() { this._leaveChan(); this.room = null; }

  setMap(mapId, seed) {
    if (this.room?.host !== this.id || !this._hostState) return;
    this._hostState = { ...this._hostState, mapId, seed, state: 'lobby' };
    this._me.m = this._hostState;
    this._retrack();
  }

  ready(r) { this._me.rdy = !!r; this._retrack(); }

  start() {
    if (this.room?.host !== this.id || !this._hostState) return;
    const waiting = this.room.players.filter(p => p.id !== this.id && !p.ready).length;
    if (waiting) return this._err('还有人没准备好');
    this._hostState = { ...this._hostState, state: 'diving' };
    this._me.m = this._hostState;
    this._retrack();
    this._finished.clear();
    const m = { t: MSG.GAME_START, mapId: this._hostState.mapId, seed: this._hostState.seed, players: this.room.players.map(p => ({ id: p.id, name: p.name })) };
    this._cast(m);
    this.handlers[MSG.GAME_START]?.(m);   // self:false 广播不回声，本地补发
  }

  event(k, data) { this.send({ t: MSG.EVENT, k, data }); }

  gameOver(results) {
    this._cast({ t: MSG.GAME_OVER, id: this.id, results });
    this._onGameOver(this.id);
    this.handlers[MSG.GAME_OVER]?.({ t: MSG.GAME_OVER, results });
  }

  // —— 频道生命周期 ——
  _join(code) {
    this._leaveChanSync();
    this.code = code;
    this._members = new Set();
    this._finished.clear();
    this._me = { j: Date.now(), name: this.name, rdy: false };
    this._hostState = null;
    const chan = this.sb.channel(`fd-room-${code}`, {
      config: { private: false, presence: { key: this.id }, broadcast: { self: false, ack: false } },
    });
    this.chan = chan;
    chan.on('broadcast', { event: 'm' }, ({ payload }) => this._onCast(payload));
    chan.on('presence', { event: 'sync' }, () => this._onSync());
    return new Promise((res) => {
      chan.subscribe((st) => {
        if (st === 'SUBSCRIBED') { res(); chan.track(this._me).catch(() => {}); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
          if (this.chan === chan) { this._err('联机通道出错了'); this.handlers._close?.(); }
          res();
        }
      });
    });
  }

  _leaveChanSync() {
    if (this.chan) { Promise.resolve(this.sb.removeChannel(this.chan)).catch(() => {}); this.chan = null; }
    this._members = new Set();
    this._hostState = null;
  }
  async _leaveChan() { const c = this.chan; this.chan = null; if (c) { await c.untrack().catch(() => {}); await this.sb.removeChannel(c).catch(() => {}); } this._members = new Set(); this._hostState = null; }
  _retrack() { this.chan?.track(this._me).catch(() => {}); }

  // 等 presence 首轮同步，返回其他成员数 / 房主元数据里的房间状态
  _waitPeers(ms) { return this._waitRoom(ms).then(r => r.others); }
  _waitRoom(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const check = () => {
        const n = [...this._members].filter(id => id !== this.id).length;
        const st = this.room?.state;
        if (n > 0 || performance.now() - t0 > ms) res({ others: n, state: st });
        else setTimeout(check, 80);
      };
      check();
    });
  }

  _onCast(m) {
    if (!m?.t) return;
    if (m.t === MSG.GAME_OVER) this._onGameOver(m.id);
    this.handlers[m.t]?.(m);
  }

  _onGameOver(id) {
    this._finished.add(id);
    // 房主记账：全员交卷 -> 房间回大厅（各端靠 presence 同步看到 state 变化）
    if (this.room?.host === this.id && this._hostState &&
        [...this._members].every(pid => this._finished.has(pid))) {
      this._hostState = { ...this._hostState, state: 'lobby' };
      this._me.m = this._hostState;
      this._finished.clear();
      this._retrack();
    }
  }

  _onSync() {
    const st = this.chan.presenceState();
    const members = [];
    for (const [key, arr] of Object.entries(st)) for (const m of arr)
      members.push({ id: key, name: m.name || 'Diver', rdy: !!m.rdy, j: m.j || 0, m: m.m });
    members.sort((a, b) => a.j - b.j || a.id.localeCompare(b.id));

    // 成员差分 -> PEER_JOIN / PEER_LEFT
    const now = new Set(members.map(m => m.id));
    for (const mm of members) if (!this._members.has(mm.id) && mm.id !== this.id)
      this.handlers[MSG.PEER_JOIN]?.({ t: MSG.PEER_JOIN, id: mm.id, name: mm.name });
    for (const id of this._members) if (!now.has(id)) {
      if (id !== this.id) this.handlers[MSG.PEER_LEFT]?.({ t: MSG.PEER_LEFT, id });
      this._finished.delete(id);
    }
    this._members = now;

    // 房主认领：最早加入者；换房主时沿用最后一个已知的房间状态
    const host = members[0];
    const prevState = this.room?.state;
    if (host?.id === this.id) {
      this._hostState = this._want || this._hostState ||
        { mapId: this.room?.mapId || 'dosojos', seed: this.room?.seed || randomSeed(), state: prevState || 'lobby' };
      this._want = null;
      if (this._me.m !== this._hostState) { this._me.m = this._hostState; this._retrack(); }
    }
    const hm = host?.m || {};
    const room = {
      t: MSG.ROOM_STATE, code: this.code, host: host?.id,
      state: hm.state || 'lobby', mapId: hm.mapId, seed: hm.seed,
      players: members.map(m => ({ id: m.id, name: m.name, ready: m.rdy })),
    };
    this.room = room;
    this.handlers[MSG.ROOM_STATE]?.(room);
    // 一局结束回大厅：自己的就绪旗子跟着清掉（服务端版的行为是清 ready 集合）
    if (prevState === 'diving' && room.state === 'lobby' && this._me.rdy) {
      this._me.rdy = false; this._retrack();
    }
  }
}
