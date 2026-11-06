// HUD：四角分块仪表——左上深度、右上气量、左下生理、右下引绳/负重。
// 每角一个重点，数字够大；顶部中央目标行（带距离），中央提示。信息不重复。
import { t } from '@fundive/shared/i18n.js';

export class HUD {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="corner tl"><div class="panel">
        <div class="lbl">${t('深 度')}</div>
        <div class="big"><span id="h-dep">0.0</span><small>m</small></div>
        <div class="sub" id="h-depsub"></div>
        <div class="sub tgt" id="h-dtgt" hidden></div>
      </div></div>
      <div class="corner tr"><div class="panel">
        <div class="lbl">${t('气 量')}</div>
        <div class="big"><span id="h-gas">210</span><small>bar</small></div>
        <div class="gbar"><i id="h-gasfill"></i><em id="h-gasmark"></em></div>
        <div class="sub" id="h-gassub"></div>
      </div></div>
      <div class="corner bl"><div class="panel">
        <div class="prow"><span class="lbl">${t('心率')}</span><b id="h-hr">62</b><small>bpm</small></div>
        <div class="sub" id="h-deco"></div>
        <div class="sub" id="h-cold"></div>
      </div></div>
      <div class="corner br"><div class="panel">
        <div class="prow"><span class="lbl" id="h-linelbl">${t('引绳')}</span><b id="h-line">—</b></div>
        <div class="sub" id="h-carry"></div>
      </div></div>
      <div id="obj"></div>
      <div id="cmp" hidden><div class="ct">
        <span class="ctick" data-d="0">N</span><span class="ctick" data-d="45">NE</span><span class="ctick" data-d="90">E</span><span class="ctick" data-d="135">SE</span>
        <span class="ctick" data-d="180">S</span><span class="ctick" data-d="225">SW</span><span class="ctick" data-d="270">W</span><span class="ctick" data-d="315">NW</span>
        <span class="cway" id="cmp-w">◆</span>
      </div><i class="ccaret"></i><em class="cdeg" id="cmp-h">0°</em></div>
      <div id="region"></div>
      <div id="exitmk" style="opacity:0"></div>
      <div id="lineinfo"></div>
      <div id="hint"></div>
      <div id="breath">${t('吸气')}</div>`;
    document.body.appendChild(this.el);
    this.$ = (id) => this.el.querySelector(id);
    this._hintT = null;
    this._makeMaskFrame();
    this.hide();
  }

  // 画面前的面镜框：画一块黑色镜框贴图到 #mask（潜水中 .diving 显示）
  _makeMaskFrame() {
    const el = document.getElementById('mask');
    if (!el) return;
    const cv = document.createElement('canvas');
    cv.width = 1600; cv.height = 900;
    const c = cv.getContext('2d');
    // 硅胶镜框：整幅近黑，中间掏出双眼视野 + 鼻袋
    c.fillStyle = 'rgba(2,4,5,0.96)';
    c.fillRect(0, 0, 1600, 900);
    c.globalCompositeOperation = 'destination-out';
    c.filter = 'blur(30px)';
    const lens = (cx) => {
      c.beginPath();
      c.ellipse(cx, 430, 380, 300, 0, 0, Math.PI * 2);
      c.fill();
    };
    lens(540); lens(1060);
    // 鼻袋（两镜中间向下的三角口）
    c.beginPath();
    c.moveTo(730, 620); c.lineTo(870, 620); c.lineTo(830, 800); c.lineTo(770, 800); c.closePath();
    c.fill();
    c.globalCompositeOperation = 'source-over';
    // 镜片内一点点玻璃反光
    c.filter = 'blur(60px)';
    const g = c.createLinearGradient(300, 150, 1300, 750);
    g.addColorStop(0, 'rgba(160,220,230,0.05)');
    g.addColorStop(0.5, 'rgba(160,220,230,0)');
    g.addColorStop(1, 'rgba(160,220,230,0.07)');
    c.fillStyle = g;
    c.fillRect(0, 0, 1600, 900);
    // 镜框上缘一条浅浅的胶边高光
    c.filter = 'blur(14px)';
    c.strokeStyle = 'rgba(120,160,170,0.10)';
    c.lineWidth = 26;
    c.beginPath(); c.ellipse(540, 430, 395, 315, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(1060, 430, 395, 315, 0, 0, Math.PI * 2); c.stroke();
    el.style.backgroundImage = `url(${cv.toDataURL()})`;
  }
  show() { this.el.hidden = false; }
  hide() { this.el.hidden = true; }

  update(p, ctx) {
    const $ = this.$;
    const dep = p.depth();
    // —— 左上：深度 ——
    $('#h-dep').textContent = dep.toFixed(1);
    const ar = p.ascRate;
    const sub = $('#h-depsub');
    sub.textContent = t('最大 {d}m', { d: p.maxDepth.toFixed(1) }) + (ctx.planDepth ? ` · ${t('计划 {d}m', { d: ctx.planDepth })}` : '') + (Math.abs(ar) > 0.06 ? ` · ${ar > 0 ? '↑' : '↓'}${Math.abs(ar).toFixed(2)}/s` : '');
    // 与 player.js 分档一致：≤0.5 安全，>0.5 欠减压债（橙），>1.0 在找死（红）
    sub.style.color = ar > 1.0 ? '#ff7f7f' : ar > 0.5 ? '#ffb27f' : '';
    const tEl = $('#h-dtgt');
    if (ctx.depthTarget) {
      const inZone = Math.abs(dep - ctx.depthTarget.at) <= (ctx.depthTarget.tol || 0.5);
      tEl.hidden = false;
      tEl.textContent = t('目标 {at}±{tol}m', { at: ctx.depthTarget.at, tol: ctx.depthTarget.tol || 0.5 }) + (inZone ? ' ✓' : '');
      tEl.style.color = inZone ? '#7fe9ea' : '#ffb27f';
    } else tEl.hidden = true;
    // —— 右上：气量 ——
    const gas = Math.max(0, p.gas), gmax = p.gasMax || 210;
    const gcol = gas < 40 ? '#ff7f7f' : gas < (ctx.turnGas || 140) ? '#ffb27f' : '';
    const gEl = $('#h-gas');
    gEl.textContent = Math.round(gas);
    gEl.style.color = gcol;
    const fill = $('#h-gasfill');
    fill.style.width = `${Math.min(100, gas / gmax * 100)}%`;
    fill.style.background = gcol || '#7fe9ea';
    $('#h-gasmark').style.left = `${Math.min(99, (ctx.turnGas || 140) / gmax * 100)}%`;
    const tt = Math.floor(p.time);
    $('#h-gassub').textContent = `${t('折返')} ${ctx.turnGas || 140}bar · ${Math.floor(tt / 60)}:${String(tt % 60).padStart(2, '0')}`;
    // —— 左下：心率 + 氮负荷/减压 ——
    const hEl = $('#h-hr');
    hEl.textContent = Math.round(p.heart);
    hEl.style.color = p.heart > 120 ? '#ff7f7f' : p.heart > 95 ? '#ffb27f' : '';
    const dEl = $('#h-deco');
    if (p.decoOwed > 2) { dEl.textContent = t('减压停留 {s}s', { s: Math.ceil(p.decoOwed) }); dEl.style.color = '#ff7f7f'; }
    else {
      dEl.textContent = t('氮负荷 {n}%', { n: Math.round(Math.min(1, p.ndlUsed) * 100) });
      dEl.style.color = p.ndlUsed > 0.8 ? '#ffb27f' : '';
    }
    // 冰潜：体寒倒计时
    const cEl = $('#h-cold');
    if (ctx.cold != null) {
      cEl.textContent = t('体寒 {n}%', { n: Math.round(ctx.cold * 100) });
      cEl.style.color = ctx.cold > 0.84 ? '#ff7f7f' : ctx.cold > 0.58 ? '#ffb060' : '#9fd8ec';
    } else cEl.textContent = '';
    // —— 右下：引绳 + 负重 ——
    if (ctx.lineWord) $('#h-linelbl').textContent = ctx.lineWord;
    const lEl = $('#h-line');
    lEl.textContent = p.onLine ? t('在手边') : p.lineDist < 30 ? `${p.lineDist.toFixed(0)}m` : t('看不见');
    lEl.style.color = p.onLine ? '#7fe9ea' : p.lineDist < 30 ? '#ffb27f' : '#ff7f7f';
    $('#h-carry').textContent = p.carryWeight > 0 ? t('负重 {w}kg', { w: p.carryWeight.toFixed(1) }) : p.towing ? t('拖带中') : '';
    // 手动呼吸模式：显示肺量而不是自动呼吸提示
    const br = $('#breath');
    if (ctx.manualBreath) {
      const starve = p._breathHold > 1;
      br.textContent = starve ? t('—— 该呼吸了 ——') : t('肺量 {n}%  (I 吸 / U 呼)', { n: Math.round(p.lung * 100) });
      br.style.color = starve ? '#ff9f8f' : '';
    } else {
      br.textContent = Math.sin(p.time * 1.7) > 0 ? t('吸 气') : t('呼 气');
      br.style.color = '';
    }
    if (p.inAir) { br.textContent = t(p.domeBad ? '⚠ 气室空气不良 · 别摘二级头' : '气室 · 空气可呼吸'); br.style.color = p.domeBad ? '#ffb27f' : '#7fe9ea'; }
    $('#obj').innerHTML = ctx.objectiveText;
    // —— 指北针：顶部罗盘带，◆ = 出口/目标方位 ——
    const cmp = this.$('#cmp');
    if (ctx.compass) {
      cmp.hidden = false;
      const W = cmp.clientWidth || 300, px = W / 100;   // 视野 ±50°
      const h = ctx.compass.h;
      for (const el of cmp.querySelectorAll('.ctick')) {
        const d = (((+el.dataset.d) - h + 540) % 360) - 180;
        el.style.transform = `translateX(${W / 2 + d * px}px)`;
        el.style.opacity = Math.abs(d) < 48 ? 1 : 0;
      }
      const wd = (((ctx.compass.wp ?? h) - h + 540) % 360) - 180;
      const wp = this.$('#cmp-w');
      wp.style.transform = `translateX(${Math.max(6, Math.min(W - 6, W / 2 + wd * px))}px)`;
      wp.style.opacity = Math.abs(wd) < 49 ? 1 : 0.35;
      this.$('#cmp-h').textContent = `${Math.round((h + 360) % 360)}°`;
    } else cmp.hidden = true;
  }

  // Tab（触屏为「键位」钮）一键唤出/收起键位表
  toggleKeys() {
    if (!this._keys) {
      const touch = matchMedia('(pointer: coarse)').matches;
      const d = document.createElement('div');
      d.id = 'keys';
      d.innerHTML = touch ? `<div class="kb">
        <div class="k">${t('键位表 · 点「键位」收起')}</div>
        <div class="kg"><b>${t('游动')}</b><span>${t('左半屏落指出摇杆游动 · 右半屏拖动转视角 · 快踢=搅沙快踢 · 蛙踢=安静不搅沙(再点关) · 充气/放气=BCD浮力')}</span></div>
        <div class="kg"><b>${t('装备')}</b><span>${t('常驻区：拍照 · 互动 · 抓绳/挂钩 · 灯。「装备」抽屉里：面镜摘戴 · 二级头 · 备用二级头 · 浮标(海潜) · CCR · 压面镜上沿 · 鼻吐气 · 捏鼻 · 吸气/呼气(手动模式)')}</span></div>
        <div class="kg"><b>${t('手势')}</b><span>${t('抽屉底排：OK · 撤 · 求助 · 指绳 · 灯信号')}</span></div>
        <div class="kg"><b>${t('其他')}</b><span>${t('组合技：同时按住 压沿+鼻吐 = 面镜排水 · 捏鼻+鼻吐 = 耳压平衡')}</span></div>
      </div>` : `<div class="kb">
        <div class="k">${t('键位表 · Tab 收起')}</div>
        <div class="kg"><b>${t('游动')}</b><span>${t('W/A/S/D 游动 · 空格 快踢(搅沙) · K 蛙踢 · Shift 稳速 · 鼠标 视角')}</span></div>
        <div class="kg"><b>${t('装备')}</b><span>${t('M 面镜摘/戴 · H 压面镜上沿 · N 鼻子吐气 · X 捏鼻 · R 二级头拿开/含回 · Q 备用二级头 · B/V BCD充气/放气 · L 主灯 · O CCR氧电池 · F 相机 · E 互动 · G 抓引绳/挂钩 · C 浮标(海潜) · I/U 吸气/呼气(手动模式)')}</span></div>
        <div class="kg"><b>${t('手势')}</b><span>${t('1 OK · 2 上升/撤 · 3 求助 · 4 指引绳 · 5 灯信号')}</span></div>
        <div class="kg"><b>${t('其他')}</b><span>${t('Tab 键位表 · Esc 暂停 · 组合技示例：H+N 同按 = 面镜排水 · X+N = 耳压平衡')}</span></div>
      </div>`;
      document.body.appendChild(d);
      this._keys = d;
    }
    this._keys.classList.toggle('show');
  }

  hint(text, sec = 2.6) {
    const h = this.$('#hint');
    h.textContent = t(text);
    h.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => h.classList.remove('show'), sec * 1000);
  }
  setLineInfo(s) { this.$('#lineinfo').textContent = t(s); }
  setRegion(name) { this.$('#region').textContent = name ? t(name) : ''; }
  setLineWord(w) { const el = this.el.querySelector('.corner.br .lbl'); if (el) el.textContent = t(w); }
  // 出口方位标记：把船/冰洞投到屏幕上的方位指示（x,y 像素；null 隐藏；hot=目标完成后的强调态）
  setExitMark(x, y, html, hot) {
    const m = this.$('#exitmk');
    if (x == null) { m.style.opacity = 0; return; }
    m.style.opacity = 1;
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.classList.toggle('hot', !!hot);
    if (html != null) m.innerHTML = html;
  }
}

// 中央对白/事件提示（参考站的"潜伴比了个手势"风格）
export class Talker {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'talk';
    document.body.appendChild(this.el);
    this._t = null;
    this._q = [];
    this._busy = false;
  }
  say(text, dur = 3.2) { this._q.push([text, dur]); this._pump(); }
  _pump() {
    if (this._busy || !this._q.length) return;
    this._busy = true;
    const [text, dur] = this._q.shift();
    this.el.textContent = t(text);
    this.el.classList.add('show');
    setTimeout(() => { this.el.classList.remove('show'); this._busy = false; this._pump(); }, dur * 1000);
  }
  clear() { this._q = []; this.el.classList.remove('show'); this._busy = false; }
}
