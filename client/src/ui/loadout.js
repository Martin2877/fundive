// 装备间：把仓库里的装备拖到小人身上——选带什么、带几个、挂在哪。
// 鼠标可拖，触屏/键盘可点：点仓库选中 -> 能放的槽位亮起来 -> 点槽位挂上。
// 槽位里的东西点一下卸一件。气瓶/主灯必带（只能换不能卸）。
import { MAPS, mapName } from '@fundive/shared/maps.js';
import { makeUniverse, objectiveText } from '@fundive/shared/universe.js';
import { universeName } from '@fundive/shared/rng.js';
import { GEAR, SLOTS, resolveLoadout, defaultLoadout, gearName, gearEn } from '@fundive/shared/gear.js';
import { OBJECTIVE_DEFS } from '@fundive/shared/maps.js';
import { store } from '../game/storage.js';
import { t, getLang } from '@fundive/shared/i18n.js';

const app = () => document.getElementById('app');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

// 小人剪影（正视）：头/躯干/手臂/腿 —— 槽位叠在上面
const FIG_SVG = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="gfig-svg">
  <g fill="none" stroke="rgba(214,236,232,.4)" stroke-width="1.6">
    <circle cx="50" cy="8.5" r="5.5"/>
    <rect x="38" y="16" width="24" height="36" rx="9"/>
    <path d="M40 20 Q26 26 14 38" /><path d="M60 20 Q74 26 86 38"/>
    <path d="M14 38 L12 50"/><path d="M86 38 L88 50"/>
    <path d="M42 52 L40 78 L41 92"/><path d="M58 52 L60 78 L59 92"/>
    <path d="M41 92 L36 98"/><path d="M59 92 L64 98"/>
  </g></svg>`;

export function showLoadout(mapId, seed, { multiplayer = false, onDive, onBack }) {
  const map = MAPS.find(m => m.id === mapId);
  const uni = makeUniverse(mapId, seed);
  const minD = Math.min(5, map.maxDepth), defD = Math.max(minD, Math.round(map.maxDepth * 0.7));
  // 上次在这张图的配装 -> 账号偏好；没有就用默认
  let gear = JSON.parse(JSON.stringify(store.data.gears?.[mapId] || defaultLoadout(map)));
  let sel = null;   // 点选模式里拿着的装备 id

  const scr = el(`
    <div class="screen"><div class="panel gear-panel" style="width:min(860px,96vw)">
      <div class="k">${t('装备准备')} · ${mapName(map)}</div>
      <h1 class="title" style="font-size:30px">${universeName(seed)}</h1>
      <div class="sub" style="font-size:12.5px;margin-bottom:6px">
        <b style="color:var(--lagoon)">${OBJECTIVE_DEFS[uni.objective.type].icon}</b> ${objectiveText(uni)}
        <span style="color:var(--dim)">　·　${t('把装备拖到小人身上，或点了再点位置')}</span>
      </div>
      <div class="gear-grid">
        <div class="gear-shop">
          <div class="gs-cap">${t('装备仓库')}</div>
          <div id="gitems"></div>
        </div>
        <div class="gear-body">
          <div class="gfig" id="gfig">${FIG_SVG}</div>
          <div class="gsum" id="gsum"></div>
        </div>
      </div>
      <div id="gprob" class="gprob"></div>
      <div class="row" style="gap:18px;margin:8px 0 0">
        <label class="sub" style="font-size:12.5px">${t('折返气压')} <b id="gv" style="font-family:'Share Tech Mono',monospace">140</b> <input type="range" id="grg" min="100" max="180" value="140"></label>
        <label class="sub" style="font-size:12.5px">${t('计划深度')} <b id="gd" style="font-family:'Share Tech Mono',monospace">${defD}</b> <input type="range" id="grd" min="${minD}" max="${map.maxDepth}" value="${defD}"> <span style="color:var(--dim)">${minD}–${map.maxDepth}m</span></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="go">${t('按计划下水')}</button>
        <button class="btn small" id="back">${t('返回潜点详情')}</button>
      </div>
      ${multiplayer ? `<div class="sub" style="margin-top:8px;font-size:12px;color:var(--lagoon)">${t('潜伴们正在同一个宇宙里等你。')}</div>` : ''}
    </div></div>`);
  app().innerHTML = ''; app().appendChild(scr);
  const $ = (s) => scr.querySelector(s);

  // —— 装配状态操作 ——
  const placed = () => {   // itemId -> 已挂数量
    const n = {};
    for (const it of Object.values(gear)) n[it.id] = (n[it.id] || 0) + it.qty;
    return n;
  };
  const slotFree = (slot) => {
    if (gear[slot]) return false;
    // 侧挂瓶占左右两个挂位
    for (const [s, it] of Object.entries(gear)) if (GEAR[it.id]?.pair === slot) return false;
    return true;
  };
  const canPlace = (id, slot) => {
    const g = GEAR[id], s = SLOTS[slot];
    if (!g || !s) return false;
    if (!g.slots.includes(slot) || !s.accepts.includes(g.kind)) return false;
    const n = placed()[id] || 0;
    if (gear[slot]?.id === id) return gear[slot].qty < g.max;   // 同槽堆叠
    if (n >= g.max) return false;
    return slotFree(slot);
  };
  const place = (id, slot) => {
    const g = GEAR[id];
    if (!canPlace(id, slot)) return false;
    if (gear[slot]?.id === id) gear[slot].qty = Math.min(g.max, gear[slot].qty + 1);
    else {
      if (g.kind === 'tank') for (const s of ['back', 'lside']) delete gear[s];  // 气瓶系统全场一组：换瓶先卸下旧的
      gear[slot] = { id, qty: 1 };
    }
    return true;
  };
  const unplace = (slot) => {
    const it = gear[slot];
    if (!it) return;
    const g = GEAR[it.id];
    if (g.must) return flash('主灯必须带在身上');
    if (g.kind === 'tank') return flash('气瓶得有一个——把别的瓶拖上来换');
    if (it.qty > 1) it.qty--; else delete gear[slot];
  };
  const flashEl = $('#gprob');
  const flash = (msg) => { flashEl.dataset.flash = '1'; render(); flashEl.dataset.flash = ''; const d = el(`<div class="gp warn">${t(msg)}</div>`); flashEl.prepend(d); setTimeout(() => d.remove(), 2200); };

  // —— 渲染 ——
  function render() {
    const n = placed();
    // 仓库
    const shop = $('#gitems');
    shop.innerHTML = '';
    for (const [id, g] of Object.entries(GEAR)) {
      const left = g.max - (n[id] || 0);
      const chip = el(`<button class="gitem${sel === id ? ' sel' : ''}${left <= 0 ? ' out' : ''}" draggable="${left > 0}" data-id="${id}">
        <span class="gi-ic">${g.icon}</span>
        <span class="gi-n">${t(g.name)}<small>${getLang() === 'en' ? g.name : g.en}</small></span>
        <span class="gi-w">${g.w}kg</span>
        <span class="gi-q">${g.max > 1 ? `×${left}` : ''}</span>
        <span class="gi-d">${t(g.desc)}</span></button>`);
      chip.addEventListener('dragstart', (e) => { sel = id; e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'copy'; renderSlots(); });
      chip.addEventListener('dragend', () => { sel = null; renderSlots(); });
      chip.onclick = () => { sel = sel === id ? null : id; render(); };
      shop.appendChild(chip);
    }
    renderSlots();
    renderSum();
  }

  function renderSlots() {
    const fig = $('#gfig');
    fig.querySelectorAll('.gslot').forEach(x => x.remove());
    for (const [slot, s] of Object.entries(SLOTS)) {
      const it = gear[slot];
      const g = it && GEAR[it.id];
      const pairHold = !it && Object.values(gear).some(o => GEAR[o.id]?.pair === slot);
      const z = el(`<div class="gslot${it ? ' has' : ''}${pairHold ? ' pair' : ''}${sel && canPlace(sel, slot) ? ' ok' : sel ? ' no' : ''}"
        data-slot="${slot}" style="left:${s.box[0]}%;top:${s.box[1]}%;width:${s.box[2]}%;height:${s.box[3]}%">
        ${it ? `<span class="gs-it">${g.icon} ${t(g.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span>`
          : pairHold ? `<span class="gs-pair">${t('侧挂占')}</span>`
          : `<span class="gs-nm">${t(s.name)}</span>`}</div>`);
      z.addEventListener('dragover', (e) => { if (sel || e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || sel;
        if (id && place(id, slot)) { sel = null; render(); }
        else renderSlots();
      });
      z.onclick = () => {
        if (sel) { if (place(sel, slot)) sel = null; render(); }
        else { unplace(slot); render(); }
      };
      fig.appendChild(z);
    }
  }

  function renderSum() {
    const lo = resolveLoadout(gear, map, uni);
    const spd = Math.round((1 - lo.drag) * 100);
    $('#gsum').innerHTML = `
      <div class="gsum-row"><span>${t('气量')}</span><b>${lo.gas ?? '—'}bar</b><span>${t('胶片')}</span><b>${lo.film ? t('{n}张', { n: lo.film }) : '—'}</b><span>${t('灯')}</span><b>×${1 + lo.spares}</b></div>
      <div class="gsum-row"><span>${t('负重')}</span><b>${lo.weight.toFixed(1)}kg</b><span>${t('游速')}</span><b>${spd}%</b><span>${t('耗气')}</span><b>${Math.round((1 + lo.drag * 0.6) * 100)}%</b></div>`;
    if (!flashEl.dataset.flash) {
      flashEl.innerHTML = lo.problems.map(p => `<div class="gp warn">⚠ ${t(p)}</div>`).join('');
    }
    $('#go').disabled = lo.gas == null;
  }

  $('#grg').oninput = () => { $('#gv').textContent = $('#grg').value; };
  $('#grd').oninput = () => { $('#gd').textContent = $('#grd').value; };
  $('#go').onclick = () => {
    store.setGear(mapId, gear);
    onDive({ turnGas: +$('#grg').value, planDepth: +$('#grd').value, whim: false, loadout: gear });
  };
  $('#back').onclick = onBack;
  render();
}
