// 账号系统：与 IP 绑定的云端档案（Supabase RPC，免登录——同 IP 即同号）。
// 上云的内容 = store.data 去掉相册缩略图（dataURL 太大，相册只留本机）。
// 没配 VITE_SUPABASE_* 或 RPC 没建时自动落回本地模式，游戏照常可玩。
import { store } from './storage.js';
import { supabaseConfigured } from './netplay_supa.js';

const SYNC_MS = 2500;   // 存档变更后延迟上云（合并连续写入）

let sb = null;
let pushT = null;

export const account = {
  cloud: false,       // 云端可用且已握手
  tried: false,

  get configured() { return supabaseConfigured(); },
  get name() { return store.data.settings?.name || ''; },

  // 上云档案：图鉴/结局/手记/章节/课程/生涯/最近回放 + 昵称
  _profile() {
    const d = store.data;
    return {
      name: d.settings?.name || null,
      codex: d.codex || {},
      endings: d.endings || {},
      lore: d.lore || {},
      chapters: d.chapters || {},
      courses: d.courses || {},
      stats: d.stats || {},
      gears: d.gears || {},
      replays: (d.replays || []).slice(0, 6),
    };
  },

  async _client() {
    if (sb) return sb;
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(
      import.meta.env.VITE_SUPABASE_URL.trim(),
      import.meta.env.VITE_SUPABASE_ANON_KEY.trim());
    return sb;
  },

  // 启动握手：fd_hello 按 IP 认领/建档。远端有料 -> 覆盖本地（相册保留本地）；新号 -> 把本地灌上去。
  async init() {
    this.tried = true;
    if (!this.configured) return;
    try {
      const c = await this._client();
      const { data, error } = await c.rpc('fd_hello', { p_name: null, p_data: null });
      if (error) throw error;
      if (data?.data && Object.keys(data.data).length) this._applyRemote(data);
      else await this._push();
      this.cloud = true;
      store._onSave = () => this.syncSoon();
    } catch { this.cloud = false; }
  },

  // 云端覆盖本地：相册只在本机，别被远端空相册吞掉
  _applyRemote(row) {
    const local = store.data;
    const rd = row.data || {};
    const merged = {
      ...local, ...rd,
      album: local.album,
      replays: rd.replays?.length ? rd.replays : local.replays,
      settings: { ...(local.settings || {}), ...(rd.name ? { name: rd.name } : {}) },
    };
    try { localStorage.setItem('fundive.v1', JSON.stringify(merged)); } catch { }
  },

  async _push(name) {
    if (!sb) return;
    try {
      const { error } = await sb.rpc('fd_hello', { p_name: name ?? null, p_data: this._profile() });
      if (!error) { this.cloud = true; this.lastSync = Date.now(); }
    } catch { }
  },
  syncSoon() {
    if (!this.tried || !this.configured) return;
    clearTimeout(pushT);
    pushT = setTimeout(() => this._push(), SYNC_MS);
  },
  async setName(n) {
    store.setSetting('name', n);
    if (sb) await this._push(n);
  },
  async board(limit = 30) {
    if (!sb) return null;
    try {
      const { data, error } = await sb.rpc('fd_board', { p_limit: limit });
      return error ? null : (data || []);
    } catch { return null; }
  },
  async reset() {
    if (sb) { try { await sb.rpc('fd_reset'); } catch { } }
    try { localStorage.removeItem('fundive.v1'); } catch { }
    location.reload();
  },
};
