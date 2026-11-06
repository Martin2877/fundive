// DOM 屏幕层：菜单 / 联机大厅 / 潜水计划 / 结算 / 图鉴 / 暂停。
// 视觉：暗色 + 衬线大标题 + 青蓝点缀。所有文案走 t()（中英双语）。
import { MAPS, SPECIES, ENDINGS, mapName, spName } from '@fundive/shared/maps.js';
import { OBJECTIVE_DEFS } from '@fundive/shared/maps.js';
import { COURSES } from '@fundive/shared/courses.js';
import { makeUniverse, objectiveText } from '@fundive/shared/universe.js';
import { randomSeed, universeName } from '@fundive/shared/rng.js';
import { store } from '../game/storage.js';
import { t, tl, getLang } from '@fundive/shared/i18n.js';
import { STORY, storyOf } from '@fundive/shared/story.js';
import { MSG, MAX_DIVERS } from '@fundive/shared/protocol.js';
import { surveyCard } from './survey.js';

const app = () => document.getElementById('app');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
const clear = () => { app().innerHTML = ''; };

const DIFF = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
const GH_URL = 'https://github.com/Martin2877/fundive';
const GH_ISSUES = 'https://github.com/Martin2877/fundive/issues';
const GH_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
const MENU_MAPS = MAPS.filter(m => !m.hidden);
const mapsOf = (d) => MENU_MAPS.filter(m => (m.kind || 'cave') === d);
const altName = (o) => (getLang() === 'en' ? o.name : o.en);   // 副标题：另一种语言的名字
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// 宇宙「当日条件」速览：能见度/水流/氮醉/支洞——换宇宙到底变了什么，一眼看见
function uniBrief(uni, map) {
  const lv = (v, a, b) => (v < a ? 0 : v < b ? 1 : 2);
  const vis = ['浑浊', '一般', '清澈'][lv(uni.mods.vis, 0.85, 1.15)];
  const flow = ['水流平缓', '水流中等', '水流强劲'][lv(Math.abs(uni.mods.flow), 0.25, 0.55)];
  const nar = ['几乎无氮醉', '氮醉轻微', '氮醉明显'][lv(uni.mods.narcosis, 0.15, 0.5)];
  const open = uni.branches.filter(b => b.open).length;
  const br = (map.branches || []).length ? t('支洞 {o}/{n} 通', { o: open, n: uni.branches.length }) : '';
  const chips = [t('能见度') + ' ' + t(vis), t(flow), t(nar), br].filter(Boolean);
  return chips.map(c => `<span>${c}</span>`).join('');
}

// ———————— 主菜单 ————————
// 大分区卡片轮播：洞潜/海潜/冰潜/教学——一次只看一张大卡，箭头/圆点/滑动切换；
// 当前分区下面直接铺可选潜点（紧凑行，描述只给选中项展开）；
// 宇宙信息收成一行，展开才有换种子按钮与说明；系统级入口（组队/图鉴）挪到标题栏。
const DISCS = [
  { id: 'cave',  name: '洞潜', en: 'Cave Diving',  sub: '天坑·洞厅·竖井', icon: '◈', ac: '#7fe9ea' },
  { id: 'ocean', name: '海潜', en: 'Ocean Diving', sub: '珊瑚礁·沉船·蓝洞', icon: '≋', ac: '#5aa8ff' },
  { id: 'ice',   name: '冰潜', en: 'Ice Diving',   sub: '冰盖·冰山·失温', icon: '❆', ac: '#bfe8f5' },
  { id: 'train', name: '教学', en: 'Dive School',  sub: 'OW·AOW·战术·生物', icon: '✎', ac: '#ffd27f' },
];
export function showMenu({ onSolo, onLobby, onGallery, onTrain, onPreview, audio }) {
  clear();
  const saved = store.data.settings?.menu || {};
  let disc = DISCS.some(d => d.id === saved.disc) ? saved.disc : 'cave';
  const perMap = saved.per || {};
  // train 分区没有地图——mapsOf 为空时 mapId 落 null，预览走 pool，选图栏反正不渲染
  let mapId = mapsOf(disc).some(m => m.id === perMap[disc]) ? perMap[disc] : (mapsOf(disc)[0]?.id ?? null);
  let seed = randomSeed();
  const save = () => { perMap[disc] = mapId; store.setSetting('menu', { disc, per: perMap }); };
  const preview = () => onPreview?.(disc === 'train' ? 'pool' : mapId, seed);
  const scr = el(`
    <div class="screen"><div class="panel menu" style="width:min(640px,94vw)" tabindex="-1">
      <div class="m-head">
        <div>
          <div class="k">${t('潜水模拟 · 在线手账')}</div>
          <h1 class="title" style="font-size:clamp(28px,4.6vw,42px)">${t('深蓝手账')}<small style="font-size:.36em;margin-left:12px;color:var(--dim);letter-spacing:.12em">${getLang() === 'en' ? '深蓝手账' : 'DeepLog'}</small></h1>
        </div>
        <div class="m-sys">
          <button class="btn small" id="lobby">${t('组队潜水')}</button>
          <button class="btn small" id="gallery">${t('图鉴')}</button>
          <a class="btn small gh-ic" href="${GH_URL}" target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub">${GH_SVG}</a>
        </div>
      </div>
      <div class="car">
        <button class="car-nav prev" id="cprev" aria-label="‹">‹</button>
        <div class="car-view" id="carview">
          <div class="car-track" id="cartrack">${DISCS.map(d => `<button class="dc" data-d="${d.id}" style="--ac:${d.ac}">
            <span class="dc-ic">${d.icon}</span>
            <span class="dc-c">${d.id === 'train' ? t('{n} 门课', { n: COURSES.length }) : t('{n} 个潜点', { n: mapsOf(d.id).length })}</span>
            <span class="dc-n">${t(d.name)}<small>${d.en}</small></span>
            <span class="dc-s">${t(d.sub)}</span>
          </button>`).join('')}</div>
        </div>
        <button class="car-nav next" id="cnext" aria-label="›">›</button>
      </div>
      <div class="car-dots" id="cardots">${DISCS.map((d, i) => `<button data-i="${i}" aria-label="${d.name}"></button>`).join('')}</div>
      <div id="trainbox" hidden>
        <div class="sub" style="margin:4px 0 8px;font-size:12.5px">${t('从第一次下水到战术考核：每个动作拆到按键级，教练全程盯着。')}</div>
        <div id="cmini"></div>
      </div>
      <div class="maps" id="maplist"></div>
      <div class="uniline" id="unibox">
        <span class="uni-obj" id="uniobj"></span>
        <span class="uni-seed"><b id="uniname"></b><code id="seedcode"></code><button class="uni-tog" id="utog" aria-expanded="false">${t('宇宙')} ▾</button></span>
      </div>
      <div class="uni-more" id="unimore" hidden>
        <div class="flavor" id="unibrief"></div>
        <div class="seedrow" style="margin:6px 0 0">
          <button class="btn small" id="reseed">${t('换一个宇宙')}</button>
          <button class="btn small" id="seededit">${t('输入宇宙坐标')}</button>
          <button class="btn small" id="seedcopy">${t('复制坐标')}</button>
        </div>
        <details class="why"><summary>${t('宇宙是什么？')}</summary>
          <div class="sub" style="font-size:12px">${t('宇宙 = 同一张地图的一个“当日现实”。宇宙坐标决定：本次任务目标、能见度、水流和氮醉强度、哪些支洞通哪些塌了、生物分布、设备是否出故障，以及偶发的彩蛋。同一坐标在任何设备上都生成同一个世界——组队时全员自动进入同一个宇宙，也可以把坐标发给朋友挑战同一个洞。')}</div>
        </details>
      </div>
      <div class="m-cta">
        <button class="btn primary big" id="solo">${t('单人潜水')} →</button>
        <button class="btn primary big" id="gotrain" hidden>${t('进入课程表')} →</button>
      </div>
      <details class="m-about"><summary>${t('关于深蓝手账')}</summary>
        <div class="sub" style="font-size:12px;margin-top:6px">${t('一款写实向的潜水模拟与手账：下水、拍照、复盘、收集。单人潜水有 AI 潜伴同行；组队潜水最多 4 人，同一宇宙共潜。')}</div>
        <div class="sub" style="font-size:12px;margin-top:4px">${t('洞穴、地名和人物以真实事件为原型改编。真实潜水需要专门的培训和装备，游戏里的规则大多照着现实做，只是把时间压缩了。建议戴耳机。')}</div>
        <div class="m-links">
          <a class="mlink" href="${GH_URL}" target="_blank" rel="noopener noreferrer">${GH_SVG} GitHub</a>
          <a class="mlink" href="${GH_ISSUES}" target="_blank" rel="noopener noreferrer">${t('反馈问题 / 提建议')}</a>
        </div>
      </details>
    </div></div>`);
  app().appendChild(scr);
  scr.querySelector('.panel').focus({ preventScroll: true });

  const list = scr.querySelector('#maplist');
  const track = scr.querySelector('#cartrack');
  const view = scr.querySelector('#carview');
  // 轮播位移用实测像素居中对齐：卡片/间距在不同断点下宽度不同，
  // 让激活卡始终居中、两侧各露出一段邻卡（非激活卡 CSS 侧做模糊+缩淡）
  let carT = 0;
  const applyCar = () => {
    const card = track.children[DISCS.findIndex(d => d.id === disc)];
    if (!card) return;
    const vr = view.getBoundingClientRect(), cr = card.getBoundingClientRect();
    carT += (vr.left + vr.width / 2) - (cr.left + cr.width / 2);
    track.style.transform = `translateX(${carT}px)`;
  };
  const carRO = new ResizeObserver(() => { if (!scr.isConnected) carRO.disconnect(); else applyCar(); });
  carRO.observe(view);
  const dots = [...scr.querySelectorAll('#cardots button')];
  const render = () => {
    const isTrain = disc === 'train';
    const idx = DISCS.findIndex(d => d.id === disc);
    applyCar();
    dots.forEach((x, i) => x.classList.toggle('on', i === idx));
    scr.querySelectorAll('.dc[data-d]').forEach(x => x.classList.toggle('on', x.dataset.d === disc));
    scr.querySelector('#trainbox').hidden = !isTrain;
    // unibox 用 visibility 隐藏而不是 display:none——保住占位，切分区时面板高度不跳
    scr.querySelector('#unibox').style.visibility = isTrain ? 'hidden' : '';
    scr.querySelector('#unimore').hidden = isTrain || scr.querySelector('#unimore').hidden;
    list.hidden = isTrain;
    scr.querySelector('#solo').hidden = isTrain;
    scr.querySelector('#gotrain').hidden = !isTrain;
    if (isTrain) {
      const prog = store.data.courses || {};
      scr.querySelector('#cmini').innerHTML = COURSES.map(c => {
        const got = c.lessons.reduce((s, l) => s + (prog[c.id]?.[l.id]?.stars || 0), 0);
        return `<div class="cm"><b>${t(c.name)}<small>${c.en}</small></b><span class="cm-s">${'★'.repeat(got)}${'☆'.repeat(Math.max(0, c.lessons.length * 3 - got))}</span><i>${t(c.desc)}</i></div>`;
      }).join('');
      return;
    }
    list.innerHTML = '';
    for (const m of mapsOf(disc)) {
      const b = el(`<button class="map${m.id === mapId ? ' sel' : ''}">
        <span class="tag">${t(m.sub)}</span>
        <span class="diff">${DIFF[m.difficulty]} · ${t('最深')} ${m.maxDepth}m</span>
        <span class="n">${mapName(m)}<small>${altName(m)}</small>${store.data.chapters?.[m.id]?.done ? ' <span style="color:var(--lagoon)" title="' + t('章节已完成') + '">✓</span>' : ''}</span>
        <span class="d">${t(STORY[m.id]?.title || '')}　${t(m.desc)}</span></button>`);
      b.onclick = () => { mapId = m.id; save(); render(); preview(); };
      list.appendChild(b);
    }
    const map = MAPS.find(m => m.id === mapId), uni = makeUniverse(mapId, seed);
    scr.querySelector('#seedcode').textContent = seed;
    scr.querySelector('#uniname').textContent = universeName(seed);
    scr.querySelector('#unibrief').innerHTML = uniBrief(uni, map) + uni.flavor.map(f => `<span>${t(f)}</span>`).join('');
    scr.querySelector('#uniobj').innerHTML = `<b>${OBJECTIVE_DEFS[uni.objective.type].icon}</b> ${objectiveText(uni)}`;
  };
  const setDisc = (d) => {
    if (d === disc) return;   // 同卡再点：不换图不重渲染，更别重建背景世界
    disc = d;
    // 换分区时收起展开项——任何一处展开都会改变面板高度，切换必须零位移
    const um = scr.querySelector('#unimore');
    if (!um.hidden) { um.hidden = true; const u = scr.querySelector('#utog'); u.setAttribute('aria-expanded', 'false'); u.textContent = t('宇宙') + ' ▾'; }
    if (disc !== 'train') mapId = mapsOf(disc).some(m => m.id === perMap[disc]) ? perMap[disc] : mapsOf(disc)[0].id;
    save(); render(); preview();
  };
  const step = (k) => setDisc(DISCS[(DISCS.findIndex(d => d.id === disc) + k + DISCS.length) % DISCS.length].id);
  scr.querySelectorAll('.dc[data-d]').forEach(x => x.onclick = () => setDisc(x.dataset.d));
  scr.querySelector('#cprev').onclick = () => step(-1);
  scr.querySelector('#cnext').onclick = () => step(1);
  dots.forEach(x => x.onclick = () => setDisc(DISCS[+x.dataset.i].id));
  scr.querySelector('.panel').onkeydown = (e) => {
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  };
  // 触屏滑动切卡
  let swX = null;
  view.addEventListener('pointerdown', (e) => { swX = e.clientX; });
  view.addEventListener('pointerup', (e) => {
    if (swX == null) return;
    const dx = e.clientX - swX; swX = null;
    if (Math.abs(dx) > 56) step(dx < 0 ? 1 : -1);
  });
  scr.querySelector('#utog').onclick = (e) => {
    const box = scr.querySelector('#unimore');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
    e.currentTarget.textContent = box.hidden ? t('宇宙') + ' ▾' : t('宇宙') + ' ▴';
  };
  scr.querySelector('#gotrain').onclick = onTrain;
  render(); preview();
  scr.querySelector('#reseed').onclick = () => { seed = randomSeed(); render(); preview(); };
  scr.querySelector('#seededit').onclick = () => {
    const s = prompt(t('输入宇宙坐标（同一坐标 = 同一个世界，可以分享给潜伴）'), seed);
    if (s?.trim()) { seed = s.trim().toUpperCase(); render(); preview(); }
  };
  scr.querySelector('#seedcopy').onclick = (e) => {
    navigator.clipboard?.writeText(seed);
    e.target.textContent = t('已复制');
    setTimeout(() => { e.target.textContent = t('复制坐标'); }, 1200);
  };
  scr.querySelector('#solo').onclick = () => onSolo(mapId, seed);
  scr.querySelector('#lobby').onclick = () => onLobby(mapId, seed);
  scr.querySelector('#gallery').onclick = onGallery;
}

// ———————— 联机大厅 ————————
// init: 菜单里选好的 {mapId, seed}，开房时直接沿用，不再偷偷换成别的图
export function showLobby(net, { onStart, onBack, init }) {
  clear();
  const scr = el(`
    <div class="screen"><div class="panel" style="width:min(600px,94vw)">
      <div class="k">${t('联机大厅')}</div>
      <h1 class="title" style="font-size:34px">${t('组队潜水')}</h1>
      <ol class="steps">
        <li>${t('房主开房并选好地图 / 宇宙')}</li>
        <li>${t('把房间码发给潜伴（最多 4 人）')}</li>
        <li>${t('潜伴点“我准备好了”，房主点“下水”')}</li>
        <li>${t('各自做潜水计划，在同一个宇宙里会合；彼此看得见灯和手势')}</li>
      </ol>
      <div id="joinbox">
        <div class="row" style="margin:12px 0">
          <input type="text" id="name" placeholder="${t('潜伴们怎么称呼你')}" maxlength="12" style="width:200px">
        </div>
        <div class="row">
          <button class="btn primary" id="create">${t('开一个房间')}</button>
          <input type="text" id="code" placeholder="${t('房间码')}" maxlength="4" style="width:110px;text-transform:uppercase">
          <button class="btn" id="join">${t('加入')}</button>
        </div>
        <div class="sub" style="font-size:12px;margin-top:8px">${t('将用于开房：')}${init ? `${mapName(MAPS.find(m => m.id === init.mapId))} · ${universeName(init.seed)}` : ''}</div>
        <div class="sub" id="err" style="color:#ff9f8f;min-height:1.4em"></div>
      </div>
      <div id="roombox" hidden>
        <div class="sub" style="margin:8px 0">${t('房间码')} <b id="rcode" style="color:var(--lagoon);letter-spacing:.3em"></b>
          <button class="btn small" id="ccopy" style="margin-left:8px">${t('复制')}</button> —— ${t('发给潜伴就能来')}</div>
        <div class="seedrow">${t('宇宙')} <b id="runame"></b> <code id="rseed"></code>
          <button class="btn small" id="rreseed" hidden>${t('换')}</button>
          <button class="btn small" id="rseededit" hidden>${t('输入坐标')}</button></div>
        <div class="flavor" id="rbrief"></div>
        <div class="sub" id="rmap" style="margin:4px 0 6px"></div>
        <div class="maps" id="rmaplist" style="max-height:20vh"></div>
        <div class="sub" id="pcount" style="margin:6px 0 0;font-size:12px"></div>
        <div class="lobby-list" id="plist"></div>
        <div class="sub" id="goinfo" style="font-size:12px;min-height:1.4em"></div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" id="rdy">${t('我准备好了')}</button>
          <button class="btn primary" id="go" hidden>${t('下水')}</button>
          <button class="btn" id="leave">${t('离开')}</button>
        </div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn small" id="back">${t('回菜单')}</button></div>
    </div></div>`);
  app().appendChild(scr);
  const $ = (s) => scr.querySelector(s);

  $('#back').onclick = () => { net.leaveRoom(); onBack(); };
  $('#leave').onclick = () => { net.leaveRoom(); showLobby(net, { onStart, onBack, init }); };

  const err = (m) => { $('#err').textContent = m ? t(m) : ''; };
  net.on(MSG.ROOM_ERR, (m) => { err(m.msg); if (!$('#roombox').hidden) $('#goinfo').textContent = t(m.msg); });
  net.on(MSG.GAME_START, (m) => onStart(m));
  net.on(MSG.ROOM_STATE, (m) => renderRoom(m));

  const nameInput = $('#name');
  nameInput.value = store.data.settings?.name || '';
  const ensureName = () => {
    const n = nameInput.value.trim();
    if (n) { net.send({ t: MSG.HELLO, name: n }); store.setSetting('name', n); }
  };
  $('#create').onclick = () => { ensureName(); net.createRoom(init?.mapId || MENU_MAPS[0].id, init?.seed || randomSeed()); };
  $('#join').onclick = () => { const c = $('#code').value.trim().toUpperCase(); if (c.length !== 4) return err('房间码是4位'); ensureName(); net.joinRoom(c); };

  let lastState = null;
  function renderRoom(m) {
    lastState = m;
    $('#joinbox').hidden = true;
    $('#roombox').hidden = false;
    $('#rcode').textContent = m.code;
    $('#rseed').textContent = m.seed;
    $('#runame').textContent = universeName(m.seed);
    const map = MAPS.find(x => x.id === m.mapId) || MENU_MAPS[0];
    const uni = makeUniverse(map.id, m.seed);
    $('#rbrief').innerHTML = uniBrief(uni, map) + uni.flavor.map(f => `<span>${t(f)}</span>`).join('');
    $('#rmap').innerHTML = `${t('路线：')}${mapName(map)} · ${altName(map)}（${DIFF[map.difficulty]}）　<b style="color:var(--lagoon)">${OBJECTIVE_DEFS[uni.objective.type].icon}</b> ${objectiveText(uni)}`;
    const isHost = m.host === net.id;
    $('#rreseed').hidden = !isHost;
    $('#rseededit').hidden = !isHost;
    $('#go').hidden = !isHost;
    $('#rdy').hidden = isHost;   // 房主不需要点准备
    const ml = $('#rmaplist');
    ml.innerHTML = '';
    for (const mm of MENU_MAPS) {
      const b = el(`<button class="map${mm.id === m.mapId ? ' sel' : ''}" ${isHost ? '' : 'disabled style="opacity:.5;cursor:default"'}>
        <span class="tag">${t(mm.sub)}</span><span class="diff">${DIFF[mm.difficulty]}</span>
        <span class="n">${mapName(mm)}<small>${altName(mm)}</small></span></button>`);
      if (isHost) b.onclick = () => net.setMap(mm.id, m.seed);
      ml.appendChild(b);
    }
    const pl = $('#plist');
    pl.innerHTML = '';
    for (const p of m.players) {
      const host = p.id === m.host;
      pl.appendChild(el(`<div class="p${p.ready || host ? ' rdy' : ''}">
        <span class="dot"></span><span>${p.name}${p.id === net.id ? t('（你）') : ''}</span>
        ${host ? `<span class="host">${t('房主')}</span>` : ''}
        <span style="margin-left:${host ? '12px' : 'auto'};font-size:11px;color:var(--dim)">${host ? '' : p.ready ? t('已准备') : t('准备中')}</span></div>`));
    }
    $('#pcount').textContent = t('潜伴 {n}/{m}', { n: m.players.length, m: MAX_DIVERS });
    const waiting = m.players.filter(p => p.id !== m.host && !p.ready).length;
    $('#go').disabled = waiting > 0;
    $('#goinfo').textContent = isHost
      ? (m.players.length === 1 ? t('还没人加入——也可以一个人先下水。') : waiting ? t('还有 {n} 人没准备好', { n: waiting }) : t('全员就绪，可以下水'))
      : t('等房主下水。选好地图和宇宙的是房主。');
    const me = m.players.find(p => p.id === net.id);
    $('#rdy').textContent = me?.ready ? t('取消准备') : t('我准备好了');
  }
  $('#rreseed').onclick = () => lastState && net.setMap(lastState.mapId, randomSeed());
  $('#rseededit').onclick = () => {
    const s = prompt(t('输入宇宙坐标（同一坐标 = 同一个世界，可以分享给潜伴）'), lastState?.seed || '');
    if (s?.trim() && lastState) net.setMap(lastState.mapId, s.trim().toUpperCase());
  };
  $('#ccopy').onclick = (e) => {
    navigator.clipboard?.writeText(lastState?.code || '');
    e.target.textContent = t('已复制');
    setTimeout(() => { e.target.textContent = t('复制'); }, 1200);
  };
  $('#rdy').onclick = () => {
    const me = lastState?.players.find(p => p.id === net.id);
    net.ready(!(me?.ready));
  };
  $('#go').onclick = () => net.start();
}

// ———————— 潜水计划 ————————
export function showPlan(mapId, seed, { multiplayer = false, onDive, onBack }) {
  clear();
  const map = MAPS.find(m => m.id === mapId);
  const uni = makeUniverse(mapId, seed);
  const sty = storyOf(mapId, uni);   // 本宇宙的剧情讲法（storyVar 决定变体）
  const minD = Math.min(5, map.maxDepth), defD = Math.max(minD, Math.round(map.maxDepth * 0.7));
  const scr = el(`
    <div class="screen"><div class="panel" style="width:min(620px,94vw)">
      <div class="k">${t('潜水计划')} · ${mapName(map)}</div>
      <h1 class="title" style="font-size:38px">${universeName(seed)}</h1>
      <div class="flavor">${uniBrief(uni, map)}${uni.flavor.map(f => `<span>${t(f)}</span>`).join('')}</div>
      <div class="sub" style="margin:8px 0"><b style="color:var(--lagoon)">${OBJECTIVE_DEFS[uni.objective.type].icon} ${t('本次目标：')}</b>${objectiveText(uni)}<br>
      <span style="font-size:12px;color:var(--dim)">${t(map.basedOn)}</span></div>
      ${sty ? `<div class="story"><b>${t(sty.title)}</b>${sty.briefing.map(l => `<div>${t(l)}</div>`).join('')}${uni.sides.length ? `<div class="dim">${t('本次宇宙有 {n} 个支线机缘，随缘遇见。', { n: uni.sides.length })}</div>` : ''}</div>` : ''}
      <div class="plan-grid">
        <div class="cell"><div class="v" id="pg">140</div><div class="l">${t('折返气压 bar —— 三分之一法则')}</div></div>
        <div class="cell"><div class="v" id="pd">${defD}</div><div class="l">${t('计划深度 m')}</div></div>
        <div class="cell"><div class="v">2×12L</div><div class="l">${t('双瓶 · 主灯×1 备灯×1')}</div></div>
      </div>
      <div class="row" style="gap:18px;margin:6px 0">
        <label class="sub" style="font-size:12.5px">${t('折返气压')} <input type="range" id="rg" min="100" max="180" value="140" style="vertical-align:middle"></label>
        <label class="sub" style="font-size:12.5px">${t('计划深度')} <input type="range" id="rd" min="${minD}" max="${map.maxDepth}" value="${defD}" style="vertical-align:middle"> <span style="color:var(--dim)">${minD}–${map.maxDepth}m</span></label>
      </div>
      <div class="sub" style="font-size:11.5px;margin:2px 0 6px">${t('折返气压：气压降到这条线就该掉头，HUD 气量条上有橙色标记。计划深度：超过它 2 米会提醒你回头，HUD 上也会显示。深度越大，氮醉和减压压力越大。')}</div>
      <div class="sub" id="kit" style="font-size:12.5px;line-height:2;margin:10px 0"></div>
      ${(map.kind || 'cave') === 'cave' ? `<div class="sub" style="margin:4px 0;font-size:12px;color:#9fd8ec">${t('怎么算结束：回入口天坑浮出水面——岸上没人接应，挥手（3）或吹哨呼喊（E）让他们找到你；水面上按 W 随时潜回去。')}</div>` : ''}
      ${map.kind === 'ocean' ? `<div class="sub" style="margin:4px 0;font-size:12px;color:#9fd8ec">${t('怎么算结束：回到潜水船 10 米内浮出水面即撤离成功；离船太远就先在水下 3 米以下放浮标（C），船会来找浮标。')}</div>` : ''}
      ${map.kind === 'ice' ? `<div class="sub" style="margin:4px 0;font-size:12px;color:#9fd8ec">${t('怎么算结束：头顶只有冰——沿安全绳回冰洞，从下来的那个洞出水。')}</div>` : ''}
      ${(map.hazards?.narcosis || 0) >= 0.8 ? `<div class="sub" style="margin:6px 0;font-size:12px;color:#ffd27f">${t(map.kind === 'ocean' ? '深潜须知：下去多快都行，上来必须慢——按 G 抓住锚绳，它会把你的爬升压在安全速度；深处找到就走，氮醉和氧中毒都在计时。' : '深潜须知：下去多快都行，上来必须慢——按 G 抓住引绳，它会把你的爬升压在安全速度；井底找到就走，氮醉和氧中毒都在计时。')}</div>` : ''}
      <div class="row" style="margin-top:8px">
        <button class="btn primary" id="dive">${t('按计划下水')}</button>
        <button class="btn" id="whim" title="${t('不做计划：折返线很低、深度不设限——更刺激，也更危险')}">${t('临时起意')}</button>
        <button class="btn small" id="back">${t('今天不下了')}</button>
      </div>
      ${multiplayer ? `<div class="sub" style="margin-top:10px;font-size:12px;color:var(--lagoon)">${t('潜伴们正在同一个宇宙里等你。')}</div>` : ''}
    </div></div>`);
  app().appendChild(scr);
  const $ = (s) => scr.querySelector(s);
  // 前人手绘测图：探明的路线轮廓 + 支洞标注，可放大看细节（中英标注可切换）
  const planGrid = $('.plan-grid');
  if (planGrid && map.route?.length > 1) planGrid.before(surveyCard(map, uni));
  const kit = map.kind === 'ocean' ? ['锚绳（上升时抓住它）', '主灯 + 备用灯', '备用二级头', '潜水计划（贴在手腕上）', '相机（24 张胶片）'] : ['引导绳 & 线轮', '主灯 + 备用灯', '备用二级头', '潜水计划（贴在手腕上）', '相机（24 张胶片）'];
  $('#kit').innerHTML = kit.map(k => `<label><input type="checkbox" checked disabled> ${t(k)}</label>`).join('　');
  const upd = () => { $('#pg').textContent = $('#rg').value; $('#pd').textContent = $('#rd').value; };
  $('#rg').oninput = upd; $('#rd').oninput = upd; upd();
  $('#dive').onclick = () => onDive({ turnGas: +$('#rg').value, planDepth: +$('#rd').value, whim: false });
  $('#whim').onclick = () => onDive({ turnGas: 70, planDepth: 0, whim: true });
  $('#back').onclick = onBack;
}

// ———————— 结算/结局 ————————
export function showDebrief(result, { onRetry, onNewUniverse, onMenu, onGallery, onReplay, team }) {
  clear();
  const e = ENDINGS[result.ending] || ENDINGS.survived;
  const good = e.kind === 'good';
  const s = result.stats;
  const teamRows = (team || []).map(r => `<tr><td>${r.name}</td><td>${t(ENDINGS[r.ending]?.name || '')}</td><td>${r.objectiveDone ? '✓' : '—'}</td></tr>`).join('');
  const sty = result.seed != null ? storyOf(result.mapId, makeUniverse(result.mapId, result.seed)) : STORY[result.mapId];
  const scr = el(`
    <div class="screen"><div class="panel" style="background:none;border:none;box-shadow:none;display:grid;place-items:center;gap:14px">
      <div class="endcard${good ? '' : ' bad'}">
        <div class="top"><div class="r">${good ? t('撤离报告') : t('事故复盘')} · ${result.universe}</div>
        <h2>${t(e.name)}</h2></div>
        <div class="bd">
          ${t(e.desc)}
          <div class="hint">${t('复盘笔记：')}${t(e.hint)}</div>
          ${sty ? `<div class="hint" style="border-color:#ffd27f"><b>${t(sty.title)}</b>${result.chapterDone ? ' · ' + t('章节完成') : ''}<br>${result.chapterDone ? t(sty.epilogue.good) : good ? t('目标没有完成——但你活着回来了。这一章，下次再写。') : t(sty.epilogue.bad)}</div>` : ''}
        </div>
      </div>
      <div class="plan-grid" style="width:min(400px,86vw);margin:0">
        <div class="cell"><div class="v">${mmss(s.time)}</div><div class="l">${t('潜水时间')}</div></div>
        <div class="cell"><div class="v">${s.maxDepth}</div><div class="l">${t('最大深度 m')}</div></div>
        <div class="cell"><div class="v">${s.gasLeft}</div><div class="l">${t('剩余气压')}</div></div>
        <div class="cell"><div class="v">${s.photos}</div><div class="l">${t('照片')}</div></div>
        <div class="cell"><div class="v">${s.stir}</div><div class="l">${t('搅沙次数')}</div></div>
        <div class="cell"><div class="v">${s.branches ?? 0}</div><div class="l">${t('发现支洞')}</div></div>
        <div class="cell"><div class="v">${s.sides ? s.sides.done + '/' + s.sides.total : '—'}</div><div class="l">${t('支线机缘')}</div></div>
        <div class="cell"><div class="v">${s.airTime ?? 0}s</div><div class="l">${t('气室停留')}</div></div>
        <div class="cell"><div class="v" style="color:${result.objectiveDone ? 'var(--lagoon)' : 'var(--dim)'}">${result.objectiveDone ? t('完成') : t('未完成')}</div><div class="l">${t('目标')}</div></div>
      </div>
      ${teamRows ? `<table class="steps-table"><thead><tr><th>${t('潜伴')}</th><th>${t('结局')}</th><th>${t('目标')}</th></tr></thead><tbody>${teamRows}</tbody></table>` : ''}
      ${result.shots?.length ? `<div class="album" style="width:min(400px,86vw)">${result.shots.map(p => `<div class="ph"><img src="${p.thumb}"><span class="c">${p.sp ? spName(p.sp) + ' ' + '★'.repeat(p.stars) : t('废片')}</span></div>`).join('')}</div>` : ''}
      <div class="row">
        <button class="btn primary" id="retry">${t('同一个宇宙，再下一次')}</button>
        <button class="btn" id="newu">${t('换一个平行宇宙')}</button>
        ${result.replay?.track?.length > 1 ? `<button class="btn" id="replay">${t('复盘回放')}</button>` : ''}
        <button class="btn" id="gal">${t('图鉴')}</button>
        <button class="btn" id="menu">${t('回菜单')}</button>
      </div>
    </div></div>`);
  app().appendChild(scr);
  scr.querySelector('#retry').onclick = onRetry;
  scr.querySelector('#newu').onclick = onNewUniverse;
  scr.querySelector('#gal').onclick = onGallery;
  scr.querySelector('#menu').onclick = onMenu;
  const rb = scr.querySelector('#replay'); if (rb) rb.onclick = onReplay;
}

// ———————— 图鉴 ————————
const CATS = [['all', '全部'], ['fish', '鱼类'], ['amph', '两栖'], ['reptile', '爬行'], ['artifact', '人文'], ['invert', '无脊椎'], ['plant', '植物'], ['microbe', '微生物'], ['geo', '地质']];
export function showGallery({ onBack, onLearn }) {
  clear();
  const d = store.data;
  const codex = d.codex || {}, endings = d.endings || {}, album = d.album || [];
  const all = Object.entries(SPECIES);
  const found = all.filter(([id]) => codex[id]).length;
  const habitat = (id) => MENU_MAPS.filter(m => m.creatures.includes(id)).map(m => mapName(m)).join(' · ');
  const card = ([id, sp]) => {
    const c = codex[id];
    return `<div class="it${c ? '' : ' lock'}" data-c="${sp.cat}">
      <div class="n">${c ? t(sp.name) : '？？？'}</div>
      <div class="e">${c ? sp.en : ''}</div>
      <div class="stars">${'●'.repeat(sp.rarity)}<span style="opacity:.3">${'●'.repeat(5 - sp.rarity)}</span> ${c ? ' · ' + '★'.repeat(Math.max(1, c.best)) + ' ×' + c.count : ' · ' + t('未发现')}</div>
      <div class="d">${c ? t(sp.desc) : t(sp.hint)}</div>
      ${c ? `<div class="d" style="color:var(--lagoon)">${t('识别要点：')}${t(sp.tip)}</div><div class="d">${t('出没：')}${habitat(id) || '—'}</div>` : ''}</div>`;
  };
  const enList = Object.entries(ENDINGS).map(([id, e]) => {
    const got = endings[id];
    return `<div class="it${got ? '' : ' lock'}"><div class="n">${got ? t(e.name) : '？？？'}</div>
      <div class="d">${got ? t(e.desc) : t('一种还没经历过的结局')}</div>
      ${got ? `<div class="stars">×${got}</div>` : ''}</div>`;
  }).join('');
  const lore = d.lore || {};
  const loreList = Object.entries(STORY).flatMap(([mid, st]) => st.notes.map((n, i) => {
    const got = lore[`${mid}:${i}`], mp = MAPS.find(m => m.id === mid);
    return `<div class="it${got ? '' : ' lock'}"><div class="n">${got ? mapName(mp) : '？？？'}</div><div class="d">${got ? t(n) : t('在潜水中找到并读取手记')}</div></div>`;
  })).join('');
  const phList = album.length
    ? album.map(p => `<div class="ph"><img src="${p.thumb}"><span class="c">${p.sp ? spName(p.sp) + ' ' + '★'.repeat(p.stars) : t('废片')} · ${p.universe || ''}</span></div>`).join('')
    : `<div class="sub">${t('还没有照片。下水按 F 拍照。')}</div>`;
  const scr = el(`
    <div class="screen"><div class="panel" style="width:min(780px,96vw)">
      <div class="k">${t('手账')}</div>
      <h1 class="title" style="font-size:34px">${t('图鉴')}</h1>
      <div class="row" style="gap:6px;margin:10px 0">
        <button class="btn small" data-t="sp">${t('物种图鉴')} ${found}/${all.length}</button>
        <button class="btn small" data-t="ph">${t('照片相册')}</button>
        <button class="btn small" data-t="en">${t('结局图鉴')}</button>
        <button class="btn small" data-t="lo">${t('前人手记')}</button>
        ${onLearn ? `<button class="btn small" id="learn">${t('去上生物课')}</button>` : ''}
      </div>
      <div id="tab-sp">
        <div class="disc" id="cats" style="flex-wrap:wrap">${CATS.map(([k, n]) => `<button data-k="${k}" class="${k === 'all' ? 'on' : ''}">${t(n)}</button>`).join('')}</div>
        <div class="codex" id="spgrid">${all.map(card).join('')}</div>
      </div>
      <div id="tab-ph" hidden><div class="album">${phList}</div></div>
      <div id="tab-en" hidden><div class="codex">${enList}</div></div>
      <div id="tab-lo" hidden><div class="codex">${loreList}</div></div>
      <div class="row" style="margin-top:16px"><button class="btn" id="back">${t('返回')}</button></div>
    </div></div>`);
  app().appendChild(scr);
  scr.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    ['sp', 'ph', 'en', 'lo'].forEach(k => scr.querySelector('#tab-' + k).hidden = k !== b.dataset.t);
  });
  scr.querySelectorAll('#cats button').forEach(b => b.onclick = () => {
    scr.querySelectorAll('#cats button').forEach(x => x.classList.toggle('on', x === b));
    scr.querySelectorAll('#spgrid .it').forEach(it => { it.hidden = b.dataset.k !== 'all' && it.dataset.c !== b.dataset.k; });
  });
  scr.querySelector('#back').onclick = onBack;
  if (onLearn) scr.querySelector('#learn').onclick = onLearn;
}

// ———————— 暂停 ————————
export function showPause({ onResume, onAbort, audio }) {
  const scr = el(`
    <div class="screen" id="pausescr"><div class="panel" style="text-align:center">
      <div class="k">${t('已暂停')}</div>
      <h1 class="title" style="font-size:30px">${t('悬停，呼吸，想清楚')}</h1>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn primary" id="resume">${t('继续潜')}</button>
        <button class="btn" id="sound">${t('声音')}</button>
        <button class="btn" id="breath">${t('呼吸')}</button>
        <button class="btn" id="abort">${t('放弃这次潜水')}</button>
      </div>
      <div class="sub" style="margin-top:12px;font-size:11.5px">${t(matchMedia('(pointer: coarse)').matches ? '左半屏摇杆游动 · 右半屏视角 · 快踢/蛙踢 · 充/放=浮力 · 绳=抓绳 · 面镜/二级头/手势等在「装备」抽屉' : 'WASD 游动 · 空格快踢 · K 蛙踢 · M 面镜 · H+N 排水 · R 二级头 · B/V 浮力 · F 拍照 · E 互动 · G 引绳 · Q 备用 · L 灯 · O CCR · 1-5 手势 · Tab 键位表')}</div>
    </div></div>`);
  app().appendChild(scr);
  scr.querySelector('#resume').onclick = onResume;
  scr.querySelector('#abort').onclick = onAbort;
  const sb = scr.querySelector('#sound');
  const upd = () => sb.textContent = t('声音：{v}', { v: audio.on ? t('开') : t('关') });
  upd();
  sb.onclick = () => { audio.toggle(); upd(); };
  const bb = scr.querySelector('#breath');
  const updB = () => bb.textContent = t('呼吸节奏：{v}', { v: store.data.settings?.manualBreath ? t('手动(I吸/U呼)') : t('自动') });
  updB();
  bb.onclick = () => { store.setSetting('manualBreath', !store.data.settings?.manualBreath); updB(); };
  return scr;
}

// ———————— 教学课程 ————————
export function showCourses({ onLesson, onBack }) {
  clear();
  const prog = store.data.courses || {};
  const total = (c) => c.lessons.reduce((s, l) => s + (prog[c.id]?.[l.id]?.stars || 0), 0);
  const scr = el(`
    <div class="screen"><div class="panel" style="width:min(720px,94vw)">
      <div class="k">${t('潜水学校 · 平静水域 + 战术想定')}</div>
      <h1 class="title" style="font-size:40px">${t('教学课程')}</h1>
      <div class="sub">${t('每个动作拆到按键级：按什么、按多久、几键同按、什么顺序，教练都看着。下水后随时按 {k} 唤出键位表。', { k: 'Tab' })}</div>
      <div class="course-list" id="clist"></div>
      <div class="row" style="margin-top:14px"><button class="btn small" id="back">${t('回菜单')}</button></div>
    </div></div>`);
  app().appendChild(scr);
  const list = scr.querySelector('#clist');
  for (const c of COURSES) {
    const stars = total(c), max = c.lessons.length * 3;
    const card = el(`<div class="course">
      <div class="c-head"><span class="c-name">${t(c.name)}<small>${c.en}</small></span><span class="c-stars">${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, Math.min(9, max) - stars))}</span></div>
      <div class="c-desc">${t(c.desc)}</div>
      <div class="c-kit">${t('装备：')}${t(c.kit)}</div>
      <div class="c-lessons"></div>
    </div>`);
    const ll = card.querySelector('.c-lessons');
    c.lessons.forEach((l, i) => {
      const g = prog[c.id]?.[l.id];
      const b = el(`<button class="lesson${g ? ' done' : ''}">
        <span class="ln">${String(i + 1).padStart(2, '0')} · ${t(l.name)}</span>
        <span class="ls">${g ? '★'.repeat(g.stars) + ' · ' + t('{n}分', { n: g.score }) : t('未考')}</span>
        <span class="ld">${t(l.brief)}</span></button>`);
      b.onclick = () => onLesson(c.id, l.id);
      ll.appendChild(b);
    });
    list.appendChild(card);
  }
  scr.querySelector('#back').onclick = onBack;
}

// ———————— 课节结算 ————————
export function showLessonResult(r, { onRetry, onNext, onList }) {
  clear();
  const rows = r.records.map((s, i) =>
    `<tr><td>${i + 1}</td><td>${tl(s.label, s.lp)}</td><td>${s.t.toFixed(1)}s</td><td>${s.mistakes ? `<span class="bad">×${s.mistakes}</span>` : '—'}</td></tr>`).join('');
  const scr = el(`
    <div class="screen"><div class="panel" style="background:none;border:none;box-shadow:none;display:grid;place-items:center;gap:14px">
      <div class="endcard${r.stars ? '' : ' bad'}">
        <div class="top"><div class="r">${t('课目考核')} · ${t(r.name)}</div>
        <h2>${r.stars ? '★'.repeat(r.stars) + ' ' + t('{n} 分', { n: r.score }) : t('不合格')}</h2></div>
        <div class="bd">
          ${t('教练评语：')}${t(r.grade)}
          <div class="hint">${t('用时 {t} · 失误 {m} 次', { t: mmss(r.time), m: r.mistakes })}</div>
        </div>
      </div>
      <table class="steps-table"><thead><tr><th>#</th><th>${t('动作')}</th><th>${t('用时')}</th><th>${t('失误')}</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="row">
        <button class="btn primary" id="retry">${t('再考一次')}</button>
        ${r.next ? `<button class="btn" id="next">${t('下一课')}</button>` : ''}
        <button class="btn" id="list">${t('回课程表')}</button>
      </div>
    </div></div>`);
  app().appendChild(scr);
  scr.querySelector('#retry').onclick = onRetry;
  scr.querySelector('#list').onclick = onList;
  if (r.next) scr.querySelector('#next').onclick = onNext;
}
