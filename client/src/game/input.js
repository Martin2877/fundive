// 输入：键鼠(指针锁定) + 移动端触控。统一产出 {mx,mz,kick,slow} 与离散动作。
import { t } from '@fundive/shared/i18n.js';

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
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this.presses.push(e.code);
      const map = {
        KeyF: 'photo', KeyE: 'interact', KeyL: 'light', KeyQ: 'backup', Escape: 'pause', KeyP: 'pause', KeyG: 'line',
        KeyM: 'mask', KeyR: 'reg', KeyO: 'ccr', Tab: 'keys',
      };
      if (map[e.code]) this.actions.push(map[e.code]);
      if (/^Digit[1-5]$/.test(e.code)) this.actions.push('gesture:' + e.code.slice(5));
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.releases.push(e.code); });
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
    // 触屏拖动视角（右半屏）
    let lookId = -1, lx = 0, ly = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > innerWidth * 0.4 && lookId < 0) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) { this.look.dx += (t.clientX - lx) * 2.4; this.look.dy += (t.clientY - ly) * 2.4; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    this.canvas.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = -1;
    });
    this._buildTouchUI();
  }

  _buildTouchUI() {
    if (!this.isTouch) return;
    const wrap = document.createElement('div');
    wrap.id = 'touch';
    wrap.innerHTML = `
      <div id="stick"><div class="nub"></div></div>
      <button class="tbtn" data-a="kick" style="right:30px;bottom:150px">${t('快踢')}</button>
      <button class="tbtn" data-a="photo" style="right:110px;bottom:96px">${t('拍照')}</button>
      <button class="tbtn" data-a="interact" style="right:30px;bottom:60px">${t('互动')}</button>
      <button class="tbtn" data-a="light" style="right:190px;bottom:60px">${t('灯')}</button>
      <button class="tbtn" data-a="keys" style="right:110px;top:60px">${t('键位')}</button>
      <button class="tbtn" data-a="pause" style="right:30px;top:60px">${t('暂停')}</button>`;
    document.body.appendChild(wrap);
    const stick = wrap.querySelector('#stick'), nub = wrap.querySelector('.nub');
    let sid = -1;
    const setNub = (dx, dy) => { nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
    stick.addEventListener('touchstart', (e) => { sid = e.changedTouches[0].identifier; e.preventDefault(); });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        const r = stick.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const m = Math.min(1, Math.hypot(dx, dy) / 40), a = Math.atan2(dy, dx);
        dx = Math.cos(a) * m * 40; dy = Math.sin(a) * m * 40;
        this.stick.x = dx / 40; this.stick.y = dy / 40; this.stick.active = true;
        setNub(dx, dy);
      }
    }, { passive: true });
    addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === sid) { sid = -1; this.stick.x = this.stick.y = 0; this.stick.active = false; setNub(0, 0); }
    });
    wrap.querySelectorAll('.tbtn').forEach(b => {
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const a = b.dataset.a;
        if (a === 'kick') this.buttons.kick = true; else this.actions.push(a);
      });
      b.addEventListener('touchend', () => { if (b.dataset.a === 'kick') this.buttons.kick = false; });
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
