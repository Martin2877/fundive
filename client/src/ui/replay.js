// 复盘回放：俯视路线图 + 深度/气量时间轴，可拖动、倍速播放，事件打点。
import { getMap, endingName } from '@fundive/shared/maps.js';
import { t } from '@fundive/shared/i18n.js';

const app = () => document.getElementById('app');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const EV_NAME = { side: '支线', story: '剧情', branch: '发现支洞', photo: '拍照', objective: '完成目标', pickup: '捞起物品', rescue_on: '开始拖带', died: '结局', gesture: '手势' };
const EV_ICON = { side: '✦', story: '❝', branch: '⑂', photo: '▣', objective: '◈', pickup: '▤', rescue_on: '✚', died: '✖', gesture: '✋' };

export function showReplay(result, { onBack }) {
  const rp = result.replay, map = getMap(rp.mapId), tr = rp.track;
  app().innerHTML = '';
  const scr = document.createElement('div');
  scr.className = 'screen';
  scr.innerHTML = `<div class="panel" style="width:min(820px,96vw)">
    <div class="k">${t('复盘回放')} · ${result.universe}</div>
    <h1 class="title" style="font-size:30px">${t(endingName(result.ending))}</h1>
    <canvas id="rp-map" width="760" height="330" style="width:100%;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.35)"></canvas>
    <canvas id="rp-prof" width="760" height="120" style="width:100%;margin-top:8px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.35)"></canvas>
    <div class="row" style="margin:10px 0 4px">
      <button class="btn small" id="rp-play">${t('播放')}</button>
      <input type="range" id="rp-seek" min="0" max="1000" value="0" style="flex:1;min-width:160px">
      <span id="rp-time" class="sub" style="min-width:90px"></span>
      <button class="btn small" id="rp-speed">8×</button>
    </div>
    <div class="sub" id="rp-info" style="font-size:12.5px;min-height:3em"></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="rp-back">${t('返回')}</button></div>
  </div>`;
  app().appendChild(scr);
  const $ = (s) => scr.querySelector(s);
  if (tr.length < 2) { $('#rp-info').textContent = t('这次潜水太短，没有可回放的轨迹。'); $('#rp-back').onclick = onBack; return; }

  const end = tr[tr.length - 1][0];
  const route = rp.nodes ? rp.nodes.map(n => ({ p: [n.x, 0, n.z], name: n.name })) : map.route;
  const paths = [route.map(n => n.p), ...(map.branches || []).map(b => [route[b.from].p, ...b.pts])];
  const xs = [], zs = [];
  for (const pth of paths) for (const p of pth) { xs.push(p[0]); zs.push(p[2]); }
  for (const s of tr) { xs.push(s[1]); zs.push(s[3]); }
  const x0 = Math.min(...xs) - 8, x1 = Math.max(...xs) + 8, z0 = Math.min(...zs) - 8, z1 = Math.max(...zs) + 8;
  const mc = $('#rp-map'), pc = $('#rp-prof');
  const W = mc.width, H = mc.height;
  const sc = Math.min((W - 30) / (x1 - x0), (H - 30) / (z1 - z0));
  const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
  const mx = (x) => ox + (x - x0) * sc, mz = (z) => oz + (z - z0) * sc;
  const maxD = Math.max(5, ...tr.map(s => -s[2])) * 1.1;
  const PW = pc.width, PH = pc.height;
  const px = (tm) => 10 + (tm / end) * (PW - 20), py = (d) => 8 + (d / maxD) * (PH - 16);
  const idxAt = (tm) => { let i = 0; while (i < tr.length - 1 && tr[i + 1][0] <= tm) i++; return i; };
  const col = (s) => (s[5] > 1 ? '#ff7f7f' : s[5] > 0.5 ? '#ffb27f' : '#7fe9ea');

  let cur = 0, playing = false, speed = 8, last = 0;
  function draw() {
    const c = mc.getContext('2d');
    c.clearRect(0, 0, W, H);
    c.lineCap = 'round';
    paths.forEach((pth, i) => {
      c.strokeStyle = i === 0 ? 'rgba(214,236,232,.35)' : 'rgba(214,236,232,.18)';
      c.lineWidth = i === 0 ? 6 : 3;
      c.setLineDash(i === 0 ? [] : [6, 5]);
      c.beginPath(); pth.forEach((p, j) => (j ? c.lineTo(mx(p[0]), mz(p[2])) : c.moveTo(mx(p[0]), mz(p[2])))); c.stroke();
    });
    c.setLineDash([]);
    c.fillStyle = 'rgba(214,236,232,.5)'; c.font = '11px sans-serif';
    route.forEach(n => { if (n.name) c.fillText(t(n.name), mx(n.p[0]) + 7, mz(n.p[2]) - 7); });
    const ci = idxAt(cur);
    c.lineWidth = 2.5;
    for (let i = 1; i <= ci; i++) { c.strokeStyle = col(tr[i]); c.beginPath(); c.moveTo(mx(tr[i - 1][1]), mz(tr[i - 1][3])); c.lineTo(mx(tr[i][1]), mz(tr[i][3])); c.stroke(); }
    for (const e of rp.events) {
      if (e.t > cur || !EV_ICON[e.k]) continue;
      const s = tr[idxAt(e.t)];
      c.fillStyle = e.k === 'died' ? '#ff7f7f' : '#ffd27f'; c.font = '14px sans-serif';
      c.fillText(EV_ICON[e.k], mx(s[1]) - 6, mz(s[3]) - 6);
    }
    const s = tr[ci];
    c.fillStyle = '#fff'; c.beginPath(); c.arc(mx(s[1]), mz(s[3]), 5, 0, 7); c.fill();
    c.strokeStyle = '#7fe9ea'; c.lineWidth = 2; c.beginPath(); c.arc(mx(s[1]), mz(s[3]), 9, 0, 7); c.stroke();

    const p = pc.getContext('2d');
    p.clearRect(0, 0, PW, PH);
    if (rp.planDepth) { p.strokeStyle = 'rgba(255,178,127,.5)'; p.setLineDash([4, 4]); p.beginPath(); p.moveTo(10, py(rp.planDepth)); p.lineTo(PW - 10, py(rp.planDepth)); p.stroke(); p.setLineDash([]); }
    p.lineWidth = 2;
    for (let i = 1; i < tr.length; i++) { p.strokeStyle = col(tr[i]); p.globalAlpha = tr[i][0] <= cur ? 1 : 0.28; p.beginPath(); p.moveTo(px(tr[i - 1][0]), py(-tr[i - 1][2])); p.lineTo(px(tr[i][0]), py(-tr[i][2])); p.stroke(); }
    p.globalAlpha = 1;
    for (const e of rp.events) if (EV_ICON[e.k]) { p.fillStyle = '#ffd27f'; p.font = '11px sans-serif'; p.fillText(EV_ICON[e.k], px(e.t) - 4, 14); }
    p.strokeStyle = '#fff'; p.lineWidth = 1; p.beginPath(); p.moveTo(px(cur), 0); p.lineTo(px(cur), PH); p.stroke();

    $('#rp-time').textContent = `${mmss(cur)} / ${mmss(end)}`;
    $('#rp-seek').value = Math.round(cur / end * 1000);
    const recent = rp.events.filter(e => e.t <= cur).slice(-3).map(e => `<div>${mmss(e.t)}　${e.k === 'say' ? t(e.text) : (EV_ICON[e.k] || '·') + ' ' + t(EV_NAME[e.k] || e.k) + (e.k === 'died' ? ' ' + t(endingName(e.ending)) : '') + (e.k === 'branch' ? ' ' + t(e.name) : '')}</div>`).join('');
    $('#rp-info').innerHTML = `${t('深度 {d}m · 剩余气压 {g}bar · 升降 {v}m/s', { d: (-s[2]).toFixed(1), g: s[4], v: s[5].toFixed(2) })}${recent}`;
  }
  function frame(now) {
    if (!playing || !scr.isConnected) return;
    cur = Math.min(end, cur + (now - last) / 1000 * speed); last = now;
    if (cur >= end) { playing = false; $('#rp-play').textContent = t('播放'); }
    draw();
    if (playing) requestAnimationFrame(frame);
  }
  $('#rp-play').onclick = () => {
    if (cur >= end) cur = 0;
    playing = !playing; $('#rp-play').textContent = playing ? t('暂停') : t('播放');
    if (playing) { last = performance.now(); requestAnimationFrame(frame); }
  };
  $('#rp-seek').oninput = (e) => { cur = +e.target.value / 1000 * end; draw(); };
  $('#rp-speed').onclick = () => { speed = speed === 8 ? 32 : speed === 32 ? 2 : 8; $('#rp-speed').textContent = `${speed}×`; };
  $('#rp-back').onclick = () => { playing = false; onBack(); };
  cur = end; draw();
}
