// 联机协议：client <-> server 的消息类型常量。
// 传输统一为 JSON：{ t: TYPE, ...payload }
// 世界本体（洞穴几何/生物分布/目标）由 mapId+seed 确定性生成，无需同步。

export const MSG = {
  // 握手与大厅
  HELLO: 'hello',        // c->s {name}
  WELCOME: 'welcome',    // s->c {id, name}
  ROOM_CREATE: 'room_create', // c->s {name, mapId, seed}
  ROOM_JOIN: 'room_join',     // c->s {code, name}
  ROOM_LEAVE: 'room_leave',   // c->s {}
  ROOM_STATE: 'room_state',   // s->c {code, host, players:[{id,name,ready}], mapId, seed}
  ROOM_ERR: 'room_err',       // s->c {msg}
  READY: 'ready',        // c->s {ready}
  SET_MAP: 'set_map',    // c->s(host) {mapId, seed}
  START: 'start',        // c->s(host) -> s 广播 game_start {mapId, seed, players}
  GAME_START: 'game_start',

  // 潜水中
  POSE: 'pose',          // c->s {p:[x,y,z], q:[x,y,z,w], gas, flags} ~10Hz, s 转发 peers
  PEER_POSE: 'peer_pose',// s->c {id, p, q, gas, flags}
  EVENT: 'ev',           // c->s {k, ...} s->广播 {id, k, ...}
  // EVENT.k 取值：
  //  photo    {subject, quality} 拍到东西
  //  pickup   {item}              打捞物入手
  //  rescue_on/rescue_off         开始/结束拖带
  //  gesture  {g:'ok'|'up'|'help'|'line'|'light'}
  //  silt     {p, n}              搅起泥沙
  //  share_air {to}               给队友供气
  //  died     {ending}            阵亡（广播结局）
  //  objective {done, detail}     目标进度
  //  ping     {p}                 声呐标记
  PEER_LEFT: 'peer_left',// s->c {id}
  PEER_JOIN: 'peer_join',// s->c {id, name}
  GAME_OVER: 'game_over',// 广播 {results}
};

export const MAX_DIVERS = 4;
export const POSE_HZ = 12;

export function encode(obj) { return JSON.stringify(obj); }
export function decode(str) {
  try { return JSON.parse(str); } catch { return null; }
}
