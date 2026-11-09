// 输入：键鼠(指针锁定) + 移动端触控。统一产出 {mx,mz,kick,slow} 与离散动作。
// 触屏按钮不另开通道——它们模拟真实按键进同一个 keys/presses/releases 集合，
// 下游（教学考核 key/hold/combo/strict、手势、第一人称手型、面镜排水 H+N）无需区分来源。
import { t } from '@fundive/shared/i18n.js';

// 键码 -> 离散动作（物理键与触屏虚拟键共用）
const KEY_ACTION = {
  KeyF: 'photo', KeyE: 'interact', KeyL: 'light', KeyQ: 'backup', Escape: 'pause', KeyP: 'pause', KeyG: 'line',
  KeyM: 'mask', KeyR: 'reg', KeyO: 'ccr', KeyC: 'smb', Tab: 'keys',
};

// 触屏按钮定义。mode: tap=点按 press+release 同帧; hold=按住; toggle=点一下开/再点关
// label 后的角标字母就是键名——教练说"按 M"时学员能在按钮上找到 M。
const CLUSTER = [   // 常驻右下 3×3（DOM 顺序即网格行序）
  { k: 'KeyK', n: '蛙踢', s: 'K', m: 'toggle' },
  { k: 'KeyB', n: '充气', s: 'B', m: 'hold' },
  { k: 'Space', n: '快踢', s: '␣', m: 'hold' },
  { k: 'KeyL', n: '灯', s: 'L', m: 'tap' },
  { k: 'KeyV', n: '放气', s: 'V', m: 'hold' },
  { k: 'KeyF', n: '拍照', s: 'F', m: 'tap' },
  { k: 'KeyG', n: '抓绳', s: 'G', m: 'tap' },
  { k: 'KeyE', n: '互动', s: 'E', m: 'tap' },
  { k: '_sheet', n: '装备', s: '⋯', m: 'sheet' },
];
const SHEET = [     // 「装备」抽屉：次要装备 + 手法 + 手势
  { k: 'KeyM', n: '面镜', s: 'M', m: 'tap' },
  { k: 'KeyR', n: '二级头', s: 'R', m: 'tap' },
  { k: 'KeyQ', n: '备用', s: 'Q', m: 'tap' },
  { k: 'KeyC', n: '浮标', s: 'C', m: 'tap' },
  { k: 'KeyO', n: 'CCR', s: 'O', m: 'tap' },
  { k: 'KeyH', n: '压沿', s: 'H', m: 'hold' },
  { k: 'KeyN', n: '鼻吐', s: 'N', m: 'hold' },
  { k: 'KeyX', n: '捏鼻', s: 'X', m: 'hold' },
  { k: 'KeyI', n: '吸气', s: 'I', m: 'hold' },
  { k: 'KeyU', n: '呼气', s: 'U', m: 'hold' },
];
const GESTURES = [  // Digit1-5：OK / 撤 / 求助 / 指绳 / 灯信号
  { k: 'Digit1', n: 'OK', s: '1' }, { k: 'Digit2', n: '撤', s: '2' }, { k: 'Digit3', n: '救', s: '3' },
  { k: 'Digit4', n: '绳', s: '4' }, { k: 'Digit5', n: '灯', s: '5' },
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.stick = { x: 0, y: 0, active: false };
    this.buttons = {};        // touch 按钮瞬时态
    this.actions = [];        // 离散动作队列 ['photo','interact','line','light','pause','gesture:N']
    this.presses = [];        // 本帧按下的 keyCode 队列（教学考核用）
    this.releases = [];       // 本帧松开的 keyCode 队列
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.pointerLocked = false;
    this._vkeys = new Set();  // 触屏虚拟键里目前按着的（resetTouch 统一清）
    this._holds = new Map();  // hold 型按钮：code -> touchId
    this._bind();
  }

  // 按下/松开——virt=true 表示来自触屏按钮（记入 _vkeys 便于统一复位）
  press(code, virt) {
    if (this.keys.has(code)) return;
    this.keys.add(code);
    this.presses.push(code);
    if (virt) this._vkeys.add(code);
    const a = KEY_ACTION[code];
    if (a) this.actions.push(a);
    if (/^Digit[1-5]$/.test(code)) this.actions.push('gesture:' + code.slice(5));
  }
  release(code, virt) {
    if (!this.keys.has(code)) return;
    this.keys.delete(code);
    this.releases.push(code);
    this._vkeys.delete(code);
  }
  // 离水/暂停界面盖住触屏层时清场：松开所有虚拟键、摇杆归零、toggle 复位
  resetTouch() {
    for (const c of [...this._vkeys]) this.release(c);
    this._holds.clear();
    this.stick.x = this.stick.y = 0; this.stick.active = false;
    if (this._nub) this._nub.style.transform = 'translate(-50%,-50%)';
    if (this._stickEl) { this._stickEl.style.left = ''; this._stickEl.style.top = ''; this._stickEl.style.right = ''; this._stickEl.style.bottom = ''; }
    this._sheetEl?.classList.remove('open');
    this._sheetBtn?.classList.remove('on');
    for (const b of Object.values(this._btns || {})) b.classList.remove('on');
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.press(e.code);
    });
    addEventListener('keyup', (e) => this.release(e.code));
    addEventListener('mousemove', (e) => {
      if (this.pointerLocked) { this.look.dx += e.movementX; this.look.dy += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.actions.push('unlock');
    });
    this.canvas.addEventListener('click', () => {
      if (!this.isTouch && !this.pointerLocked) this.canvas.requestPointerLock?.();
    });
    // 右键 = 收起取景器（Esc 会被浏览器收走指针锁，拍照退出必须另配键）
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => { if (e.button === 2) this.actions.push('photo_cancel'); });
    if (this.isTouch) this._bindTouch();
  }

  // 触屏：左半屏落指 = 浮动摇杆；右半屏拖动 = 视角。按钮拦自己的触摸，落不到 canvas。
  _bindTouch() {
    let lookId = -1, lx = 0, ly = 0, stickId = -1;
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX <= innerWidth * 0.45 && stickId < 0) {
          stickId = t.identifier;
          const el = this._stickEl;
          if (el) {
            el.style.left = Math.max(62, Math.min(innerWidth * 0.45, t.clientX)) + 'px';
            el.style.top = Math.max(62, Math.min(innerHeight - 62, t.clientY)) + 'px';
            el.style.right = 'auto'; el.style.bottom = 'auto';
          }
          this._stickC = { x: t.clientX, y: t.clientY };
        } else if (lookId < 0) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) { this.look.dx += (t.clientX - lx) * 2.4; this.look.dy += (t.clientY - ly) * 2.4; lx = t.clientX; ly = t.clientY; }
        else if (t.identifier === stickId) this._stickMove(t);
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) lookId = -1;
        if (t.identifier === stickId) { stickId = -1; this.stick.x = this.stick.y = 0; this.stick.active = false; if (this._nub) this._nub.style.transform = 'translate(-50%,-50%)'; }
      }
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);
    // hold 按钮的松开要在 window 上收——手指滑出按钮/屏幕也算松
    addEventListener('touchend', (e) => this._holdEnd(e));
    addEventListener('touchcancel', (e) => this._holdEnd(e));
    this._buildTouchUI();
  }

  _stickMove(t) {
    const R = 44;
    let dx = t.clientX - this._stickC.x, dy = t.clientY - this._stickC.y;
    const m = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
    dx = Math.cos(a) * m * R; dy = Math.sin(a) * m * R;
    this.stick.x = dx / R; this.stick.y = dy / R; this.stick.active = true;
    if (this._nub) this._nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _holdEnd(e) {
    if (!this._holds.size) return;
    for (const t of e.changedTouches) {
      for (const [code, id] of this._holds) {
        if (id === t.identifier) { this._holds.delete(code); this.release(code); this._markHeld(code, false); }
      }
    }
  }

  _markHeld(code, on) {
    const b = this._btns?.[code];
    if (b && b.dataset.m === 'hold') b.classList.toggle('on', on);
  }

  _buildTouchUI() {
    const wrap = document.createElement('div');
    wrap.id = 'touch';
    wrap.innerHTML = `
      <div id="stick"><div class="nub"></div></div>
      <div id="tcluster">${CLUSTER.map(b => `<button class="tbtn" data-k="${b.k}" data-m="${b.m}">${t(b.n)}<small>${b.s}</small></button>`).join('')}</div>
      <button class="tbtn side s1" data-k="Escape" data-m="tap">${t('暂停')}</button>
      <button class="tbtn side s2" data-k="Tab" data-m="tap">${t('键位')}</button>
      <div id="tsheet">
        <div class="ts-cap">${t('装备 · 手法')}</div>
        <div class="ts-grid">${SHEET.map(b => `<button class="tbtn" data-k="${b.k}" data-m="${b.m}">${t(b.n)}<small>${b.s}</small></button>`).join('')}</div>
        <div class="ts-cap">${t('手势')}</div>
        <div class="ts-grid gest">${GESTURES.map(b => `<button class="tbtn" data-k="${b.k}" data-m="tap">${t(b.n)}<small>${b.s}</small></button>`).join('')}</div>
      </div>`;
    document.body.appendChild(wrap);
    this._stickEl = wrap.querySelector('#stick');
    this._nub = wrap.querySelector('.nub');
    this._sheetEl = wrap.querySelector('#tsheet');
    this._btns = {};

    wrap.querySelectorAll('.tbtn').forEach(b => {
      const code = b.dataset.k, mode = b.dataset.m;
      if (mode === 'sheet') this._sheetBtn = b; else this._btns[code] = b;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mode === 'sheet') {
          const open = this._sheetEl.classList.toggle('open');
          b.classList.toggle('on', open);
          return;
        }
        if (mode === 'hold') {
          const id = e.changedTouches[0].identifier;
          if (this._holds.has(code)) return;
          this._holds.set(code, id);
          this.press(code, true);
          b.classList.add('on');
        } else if (mode === 'toggle') {
          if (this.keys.has(code)) { this.release(code); b.classList.remove('on'); }
          else { this.press(code, true); b.classList.add('on'); }
        } else {   // tap
          this.press(code, true);
          this.release(code, true);
          b.classList.add('on');
          setTimeout(() => b.classList.remove('on'), 120);
        }
      }, { passive: false });
    });
  }

  // 每帧采样：移动量 + 消耗的离散动作
  sample() {
    const k = this.keys;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let mz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (this.stick.active) { mx += this.stick.x; mz -= this.stick.y; }
    const out = {
      mx: Math.max(-1, Math.min(1, mx)),
      mz: Math.max(-1, Math.min(1, mz)),
      kick: k.has('Space') || this.buttons.kick,
      frog: k.has('KeyK'),
      slow: k.has('ShiftLeft'),
      bcd: (k.has('KeyB') ? 1 : 0) - (k.has('KeyV') ? 1 : 0),   // BCD 充气/放气
      brIn: k.has('KeyI'),                                     // 手动呼吸：吸气
      brOut: k.has('KeyU'),                                    // 手动呼吸：呼气
      actions: this.actions.splice(0),
      presses: this.presses.splice(0),
      releases: this.releases.splice(0),
    };
    this.actions = [];
    return out;
  }

  consumeLook() {
    const d = { ...this.look };
    this.look.dx = 0; this.look.dy = 0;
    return d;
  }
}
