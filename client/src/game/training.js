// 教学模式：复用 DiveSession 的水下世界，叠一层"教练出题 -> 按键考核 -> 打分"。
// 课节数据见 shared/courses.js。
import * as THREE from 'three';
import { DiveSession } from './session.js';
import { Buddy } from './buddy.js';
import { GESTURE_EVENTS, GESTURE_KEYS, GESTURE_NAME } from '@fundive/shared/courses.js';
import { t, tl } from '@fundive/shared/i18n.js';
import { SPECIES, spName } from '@fundive/shared/maps.js';

const _v = new THREE.Vector3();
// 会被记为"乱按"的动作键（方向/视角不算）
const ACTION_KEYS = new Set(['KeyM', 'KeyH', 'KeyN', 'KeyX', 'KeyR', 'KeyO', 'KeyB', 'KeyV', 'KeyK',
  'KeyE', 'KeyF', 'KeyQ', 'KeyL', 'KeyG', 'Space', 'Tab',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);

export class TrainingSession extends DiveSession {
  constructor(opts) {
    const lesson = opts.lesson;
    super({ ...opts, mapId: lesson.map, seed: lesson.seed || 'COURSE', solo: true, net: null, plan: { turnGas: 40 }, gear: lesson.gear });
    this.lesson = lesson;
    this.ccr = !!lesson.ccr;

    // 平静水域：关掉随机事故；世界本体照旧生成
    this.uni.mods.freeflow = this.uni.mods.blackout = this.uni.mods.lineBreak = false;
    this.uni.mods.hallucination = 0;
    this._ffT = -1;
    this.cave.lineGap = null;

    // 捕获每帧采样输入（含 presses/releases），给考核引擎用
    const inp = this.o.input, orig = inp.sample.bind(inp);
    inp.sample = () => (this._inp = orig());

    // 目标系统替换为课目行
    if (this.objective.targetObj) this.scene.remove(this.objective.targetObj);
    if (this.objective.victim) this.scene.remove(this.objective.victim);
    this.objective = {
      done: true, update: () => null, interact: () => { },
      statusText: () => this.trainer?.statusText() || this.lesson.name,
    };

    // 潜伴 -> 教练（buddy:false 的课目撤掉）
    if (this.buddy) {
      this.scene.remove(this.buddy.obj);
      this.buddy = lesson.buddy === false ? null : new Buddy(this.scene, this.player.pos, t('教练'));
    }

    // 起始位置（可指定节点/深度）
    if (lesson.start) {
      const n = this.cave.nodes[lesson.start.node];
      if (n) {
        this.player.pos.copy(n.pos).add(_v.set(0.5, 0, 0.5));
        if (lesson.start.y != null) this.player.pos.y = lesson.start.y;
        this.player._lastDepth = this.player.depth();
      }
    }

    // 面镜水 overlay（DOM，低画质档也一致）
    this._maskw = document.createElement('div'); this._maskw.id = 'maskw';
    this._maskoff = document.createElement('div'); this._maskoff.id = 'maskoff';
    this._hb = document.createElement('div'); this._hb.id = 'holdbreath';
    document.body.append(this._maskw, this._maskoff, this._hb);

    this.trainer = new Trainer(this, lesson);
  }

  start() {
    this.running = true;
    this.o.hud.show();
    this.talk(this.lesson.intro);
    this._last = performance.now();
    this._loop();
  }

  tick(dt) {
    super.tick(dt);
    if (this.ended) return;
    const p = this.player, keys = this.o.input.keys;

    // —— 面镜进水机制 ——
    if (p.maskOff) p.maskWater = 1;
    else {
      const pinch = keys.has('KeyH'), exhale = keys.has('KeyN');
      if (pinch && exhale) p.maskWater = Math.max(0, p.maskWater - dt * 0.5);
      else if (exhale && p.maskWater > 0.35) p.maskWater = Math.max(0.35, p.maskWater - dt * 0.12);
    }
    this._maskw.style.height = (p.maskOff ? 0 : p.maskWater * 100).toFixed(1) + '%';
    this._maskw.style.opacity = p.maskOff || p.maskWater < 0.02 ? 0 : 1;
    this._maskoff.style.opacity = p.maskOff ? 1 : 0;
    if (p.maskOff) p.panic = Math.min(1, p.panic + dt * 0.03); // 摘面镜本身就是压力

    // —— 二级头拿开：憋气计时 + 视野边缘随缺氧慢慢变黑 ——
    if (p.regOut) p.regOutT += dt; else p.regOutT = 0;
    this._hb.style.opacity = Math.min(1, p.regOutT * 0.12);

    if (!this.paused) this.trainer.update(dt);
  }

  _onDeath(id) {
    if (this.ended) return;
    this.player.dead = null;
    this.trainer.fail(id);
  }

  finishLesson(result) {
    if (this.ended) return;
    this.ended = true; this.running = false;
    document.getElementById('narco').style.opacity = 0;
    this.o.hud.hide();
    this.o.photos.close();
    this.o.onEnd?.(result);
  }

  dispose() {
    this.trainer?.dispose();
    this._maskw?.remove(); this._maskoff?.remove(); this._hb?.remove();
    super.dispose();
  }
}

// ———————— 考核引擎 ————————
class Trainer {
  constructor(s, lesson) {
    this.s = s;
    this.lesson = lesson;
    this.i = 0;
    this.steps = lesson.steps;
    this.mistakes = 0;
    this.records = [];          // 每步 {label, t, mistakes}
    this.done = false;
    this.t = 0;

    // 面板
    this.el = document.createElement('div');
    this.el.id = 'trainer';
    document.body.appendChild(this.el);
    this._listHtml = '';

    // 路标/装置
    this.marker = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7fe9ea }));
    const lamp = new THREE.PointLight(0x7fe9ea, 2.5, 5);
    this.marker.add(dot, lamp);
    this.marker.visible = false;
    s.scene.add(this.marker);
    this._markLight = lamp; this._markDot = dot;

    this.device = null;
    // CCR
    this.alarmT = 20 + Math.random() * 15;
    this.alarm = 0;
    this.ccrGot = 0;
    this.po2 = 1.28;

    s.onAction = (a) => this.onAction(a);
    s.onGesture = (g) => this.onGesture(g);

    this._activate();
  }

  get cur() { return this.steps[this.i]; }
  get p() { return this.s.player; }

  // —— 步骤生命周期 ——
  _activate() {
    const st = this.cur;
    if (!st) return;
    st.t = 0; st.prog = 0; st.mistakes = 0;
    st.need = st.check.t === 'ccr' ? st.check.n : st.check.t === 'rand_gesture' ? st.check.n : 0;
    st.got = 0; st.evt = null; st.expo = 0; st.warnT = 0; st._fastT = 0;
    if (st.teach) { const sp = SPECIES[st.teach]; this.s.talk(`${t(sp.name)}（${sp.en}）—— ${t(sp.desc)}  ${t('识别要点：')}${t(sp.tip)}`, 9); }
    else if (st.coach) this.s.talk(t('教练：') + t(st.coach));
    if (st.check.t === 'reach' || st.check.t === 'deploy') this._placeMarker(st.check);
    else this.marker.visible = false;
    if (st.check.t === 'deploy') this._placeDevice(st.check.node);
    // 手势步骤：教练先示范一遍给你看
    if (st.check.t === 'gesture' && this.s.buddy) {
      setTimeout(() => { if (!this.done) this.s.buddy?.obj.userData.gesture?.(st.check.want, 2.4); }, 900);
    }
    // 有键位的步骤给一个中央提示，避免学员不知道干嘛
    if (st.key) this.s.o.hud.hint(`${tl(st.label, st.lp)} —— ${st.key}`, 3.2);
    this._renderList();
  }

  _complete() {
    const st = this.cur;
    this.records.push({ label: st.label, lp: st.lp, t: st.t, mistakes: st.mistakes || 0 });
    this.s.o.audio?.ok?.();
    this.s.o.hud.hint(`✓ ${tl(st.label, st.lp)}`, 1.4);
    const li = this.el.querySelectorAll('.t-steps li')[this.i];
    if (li) li.classList.add('flash');
    this.i++;
    if (this.i >= this.steps.length) return this._graduate();
    this._activate();
  }

  _mistake(msg) {
    const st = this.cur;
    this.mistakes++;
    if (st) st.mistakes = (st.mistakes || 0) + 1;
    this.s.o.hud.hint(msg, 2.2);
    this.s.o.audio?.silt?.();
    this._renderScore();
  }

  fail(endingId) {
    // 生理死亡 -> 教练把你捞回出发点，记 2 次失误，继续课
    const p = this.p, n = this.s.cave.nodes[this.lesson.start?.node || 0];
    p.pos.copy(n.pos).add(_v.set(0.5, 0, 0.5));
    p.vel.set(0, 0, 0); p.gas = Math.max(p.gas, 180); p.panic = 0.2; p.narcosis = 0;
    p.decoOwed = 0; p.dead = null; p.maskOff = false; p.regOut = false;
    this.mistakes += 2;
    this.s.talk(t('教练把你拖了回来：“{x}”', { x: t({ out_of_air: '气都能忘看？', deco_hit: '说了慢点升！', panic: '深呼吸，看着我。' }[endingId] || '刚才那一下不算，重来。') }));
    this._renderScore();
  }

  onAction(a) {
    const st = this.cur; if (!st || this.done) return;
    if (st.check.t === 'deploy' && a === 'interact' && this.device && this.p.pos.distanceTo(this.device.position) < 2.2) {
      this.device.userData.armed = true;
      this.s.talk('装置挂好了，指示灯开始闪。');
      return this._complete();
    }
    if (a === 'ccr' && this.alarm > 0) {
      this.alarm = 0;
      this.ccrGot++;
      this.s.o.audio?.ok?.();
      if (st.check.t === 'ccr') {
        st.got++;
        if (st.got >= st.need) this._complete();
        else this.s.talk(t('确认。还有 {n} 次。', { n: st.need - st.got }));
      } else this.s.o.hud.hint('PO2 确认', 1.5);
    }
  }

  onGesture(g) {
    const st = this.cur; if (!st || this.done) return;
    if (st.check.t === 'gesture') {
      if (g === st.check.want) this._complete();
      else this._mistake(t('手势不对——要「{g}」（{k}）', { g: t(GESTURE_NAME[st.check.want]), k: GESTURE_KEYS[st.check.want] }));
    } else if (st.check.t === 'rand_gesture' && st.evt) {
      if (g === st.evt.want) {
        st.got++;
        this.s.talk(st.evt.reply);
        st.evt = null;
        if (st.got >= st.need) return this._complete();
        st.t = 0;
        setTimeout(() => this._pickEvent(), 1400);
      } else this._mistake('回错手势了，看题！');
    }
  }

  _pickEvent() {
    const st = this.cur;
    if (!st || st.check.t !== 'rand_gesture' || this.done) return;
    st.evt = GESTURE_EVENTS[Math.floor(Math.random() * GESTURE_EVENTS.length)];
    this.s.talk(st.evt.text, 4);
    // 教练在对面做出相应手势（你看得到他抬手）
    if (this.s.buddy) this.s.buddy.obj.userData.gesture?.(st.evt.want, 2.6);
    st.t = 0;
    this._renderNow();
  }

  _placeMarker(c) {
    const n = this.s.cave.nodes[c.node];
    if (!n) return;
    this.marker.position.copy(n.pos);
    if (c.dark) { this._markLight.color.set(0x59ffa0); this._markLight.intensity = 1.1; this._markDot.material.color.set(0x59ffa0); }
    else { this._markLight.color.set(0x7fe9ea); this._markLight.intensity = 2.5; this._markDot.material.color.set(0x7fe9ea); }
    this.marker.visible = true;
  }

  _placeDevice(nodeI) {
    if (this.device) this.s.scene.remove(this.device);
    const n = this.s.cave.nodes[nodeI];
    if (!n) return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.5, metalness: 0.4 }));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4040 }));
    led.position.set(0.1, 0.11, 0);
    g.add(box, led);
    g.userData.armed = false;
    g.userData.update = (t) => { led.visible = g.userData.armed ? (t * 2 % 1 < 0.5) : true; };
    g.position.copy(n.pos).add(_v.set(0.4, -n.r * 0.55, 0.4));
    this.s.scene.add(g);
    this.device = g;
  }

  // —— 主循环 ——
  update(dt) {
    if (this.done) return;
    const st = this.cur; if (!st) return;
    const c = st.check;
    const p = this.p, inp = this.s._inp, keys = this.s.o.input.keys;
    this.t += dt; st.t += dt;

    // CCR 报警模拟（全课节运行）
    if (this.s.ccr) this._ccrTick(dt);
    if (this.device?.userData.armed) this.device.userData.update(this.t);

    // 超时 -> 失误重考
    if (st.timeout && st.t > st.timeout) {
      this._mistake('超时了，重来');
      st.t = 0; st.prog = 0;
      if (c.t === 'rand_gesture') { st.evt = null; setTimeout(() => this._pickEvent(), 800); }
    }

    // 严格步骤：乱按计失误（每 1.2s 最多记一次）
    st.warnT = Math.max(0, (st.warnT || 0) - dt);
    if (st.strict && inp?.presses?.length) {
      const want = new Set(c.codes || (c.code ? [c.code] : []));
      if (c.t === 'gesture') want.add('Digit' + GESTURE_KEYS[c.want]);
      const bad = inp.presses.find(k => ACTION_KEYS.has(k) && !want.has(k));
      if (bad && st.warnT <= 0) { st.warnT = 1.2; this._mistake('顺序不对——看当前步骤的键位'); }
    }

    // rand_gesture 激活后自动出题
    if (c.t === 'rand_gesture' && !st.evt && st.got === 0 && st.t > 0.8) this._pickEvent();
    else if (c.t === 'rand_gesture' && !st.evt && st.got > 0) { /* 等 setTimeout */ }
    if (c.t === 'rand_gesture' && st.evt && st.t > 9) {
      this._mistake('没回应——太慢了');
      st.evt = null;
      setTimeout(() => this._pickEvent(), 900);
    }

    switch (c.t) {
      case 'say': if (st.t >= c.dur) this._complete(); break;
      case 'wait': st.prog = Math.min(1, st.t / c.s); if (st.t >= c.s) this._complete(); break;
      case 'key': if (inp?.presses?.includes(c.code)) this._complete(); break;
      case 'hold':
        if (keys.has(c.code)) st.prog += dt; else st.prog = 0;
        if (st.prog >= c.min) this._complete();
        break;
      case 'combo':
        if (c.codes.every(k => keys.has(k))) st.prog += dt; else st.prog = 0;
        if (st.prog >= c.min) this._complete();
        break;
      case 'mask': if (p.maskOff === !c.on) this._complete(); break;
      case 'maskwater': st.prog = 1 - Math.min(1, p.maskWater); if (p.maskWater <= c.max && !p.maskOff) this._complete(); break;
      case 'depth': {
        const ok = Math.abs(p.depth() - c.at) <= c.tol;
        st.prog = ok ? st.prog + dt : Math.max(0, st.prog - dt * 1.5);
        if (st.prog >= c.hold) this._complete();
        break;
      }
      case 'reach': {
        const n = this.s.cave.nodes[c.node];
        st.prog = 1 - Math.min(1, p.pos.distanceTo(n.pos) / 30);
        if (c.dark && (p.lightOn || p.backupOn)) {
          st.expo += dt;
          if (st.expo > 2.5) { this._mistake('你的灯暴露了——关灯，重摸这段'); st.expo = -8; }
        }
        if (n && p.pos.distanceTo(n.pos) <= (c.d || 2.5)) {
          if (c.dark && st.expo > 0) this._mistake('到了，但中途开过灯');
          this._complete();
        }
        break;
      }
      case 'deploy': st.prog = 0; break; // 由 onAction 完成
      case 'gesture': break;             // 由 onGesture 完成
      case 'rand_gesture': st.prog = st.got / st.need; break;
      case 'buddy':
        st.prog = this.s.buddy ? 1 - Math.min(1, p.pos.distanceTo(this.s.buddy.obj.position) / 8) : 1;
        if (!this.s.buddy || p.pos.distanceTo(this.s.buddy.obj.position) <= c.d) this._complete();
        break;
      case 'ccr': st.prog = st.got / st.need; break;
      case 'ascend': {
        // 持续 0.5s 以上超速才记失误——点一下 B 的瞬时冲量不该算错
        if (p.ascRate > c.rate * 1.4) {
          st._fastT = (st._fastT || 0) + dt;
          if (st._fastT > 0.5 && st.warnT <= 0) { st.warnT = 2; st._fastT = 0; this._mistake('升太快了！看着表，慢一点'); }
        } else st._fastT = 0;
        st.prog = 1 - Math.min(1, Math.max(0, (p.depth() - c.to)) / Math.max(1, (this._asc0 ??= p.depth()) - c.to));
        if (p.depth() <= c.to) { this._asc0 = undefined; this._complete(); }
        break;
      }
      case 'photo': {
        const last = this.s.o.photos.shots.at(-1);
        if (last && last !== st._lastShot) {
          st._lastShot = last;
          if (c.sp && last.sp !== c.sp) this.s.o.hud.hint(t('这不是要找的「{n}」——对准它再拍', { n: t(SPECIES[c.sp].name) }), 2.5);
          else if (last.stars >= c.min) { this.s.talk(t('教练点头：{n} {s}，合格。', { n: last.sp ? spName(last.sp) : t('这张'), s: '★'.repeat(last.stars) })); this._complete(); }
          else this.s.o.hud.hint('这张不够——主体居中、灯照到、再近点', 2.5);
        }
        break;
      }
      case 'lightoff': if (!p.lightOn && !p.backupOn) this._complete(); break;
      case 'exit': if (this.s._ctx().atExit) this._complete(); break;
    }

    // 蛙踢纪律：需要蛙踢的步骤里按空格 = 搅沙踢法
    if (c.frog && inp?.kick && st.warnT <= 0) { st.warnT = 1.5; this._mistake('教练摇头：那不是蛙踢——按住 K 收腿踢'); }

    this._renderNow();
  }

  _ccrTick(dt) {
    this.po2 = Math.max(0.4, Math.min(1.6, this.po2 + (Math.random() - 0.5) * dt * 0.12));
    if (this.alarm > 0) {
      this.alarm -= dt;
      if (this.alarm <= 0) { this._mistake('PO2 报警没应！CC​​R 不会等你'); this.alarmT = 8 + Math.random() * 8; }
    } else {
      this.alarmT -= dt;
      if (this.alarmT <= 0) {
        this.alarm = 6;
        this.alarmT = 16 + Math.random() * 14;
        this.s.talk('—— 滴、滴、滴（PO2 报警）——', 2.5);
        this.s.o.audio?.hiss?.();
      }
    }
  }

  _graduate() {
    this.done = true;
    this.marker.visible = false;
    const par = this.steps.reduce((s, x) => s + (x.timeout || 15), 0) * 0.8;
    const score = Math.max(0, Math.round(100 - this.mistakes * 6 - Math.max(0, this.t - par) * 0.35));
    const stars = score >= 88 ? 3 : score >= 70 ? 2 : score >= 50 ? 1 : 0;
    const grade = stars === 3 ? '优秀，保持。' : stars === 2 ? '合格。细节再抠抠。' : stars === 1 ? '勉强过——回去把动作再做顺。' : '不合格，重考。';
    this.s.finishLesson({
      kind: 'lesson',
      courseId: this.courseId(), lessonId: this.lesson.id, name: this.lesson.name,
      score, stars, grade, mistakes: this.mistakes, time: Math.floor(this.t),
      records: this.records, map: this.lesson.map,
    });
  }

  courseId() {
    // 由调用方注入（main.js startTraining 设置 lesson.courseId）
    return this.lesson.courseId || '';
  }

  statusText() {
    if (this.done) return '课毕';
    const st = this.cur;
    return t('课目：{n} · 第 {i}/{m} 步 — {l}', { n: t(this.lesson.name), i: this.i + 1, m: this.steps.length, l: st ? tl(st.label, st.lp) : '' });
  }

  // 当前步骤的目标深度（给仪表盘画标记用）；非深度步骤返回 null
  depthTarget() {
    const c = this.cur?.check;
    if (!c) return null;
    if (c.t === 'depth') return { at: c.at, tol: c.tol };
    if (c.t === 'ascend') return { at: c.to, tol: 0.5, ascend: true };
    return null;
  }

  // —— 面板渲染 ——
  _renderList() {
    const html = this.steps.map((s, i) => {
      const cls = i < this.i ? 'done' : i === this.i ? 'cur' : '';
      const mark = i < this.i ? '✓' : i === this.i ? '▶' : '·';
      return `<li class="${cls}"><span>${mark}</span>${tl(s.label, s.lp)}${s.key ? `<em>${t(s.key)}</em>` : ''}</li>`;
    }).join('');
    this._listHtml = html;
    this.el.innerHTML = `
      <div class="t-head"><span class="t-course">${t(this.lesson.name)}</span><span id="t-score">${t('失误 {n}', { n: this.mistakes })}</span></div>
      <ol class="t-steps">${html}</ol>
      <div id="t-now"></div>
      <div class="t-barwrap"><div id="t-bar"></div></div>
      <div id="t-po2"${this.s.ccr ? '' : ' hidden'}>PO2 ${this.po2.toFixed(2)}</div>`;
    this._renderNow();
  }

  _renderNow() {
    const st = this.cur, $ = (id) => this.el.querySelector(id);
    if (!st || !$('#t-now')) return;
    const c = st.check;
    const p = this.p;
    let now = tl(st.label, st.lp);
    if (c.t === 'rand_gesture' && st.evt) now = t('⚠ {x}（按 {k}）', { x: t(st.evt.text), k: GESTURE_KEYS[st.evt.want] });
    else if (c.t === 'ccr') now = t('{l} —— 已应答 {g}/{n}', { l: tl(st.label, st.lp), g: st.got, n: st.need });
    else if (st.key) now = `${tl(st.label, st.lp)} <em>${t(st.key)}</em>`;
    // —— 每类检查都给实时反馈读数：看得到进度、距离、水位、心率 ——
    const live = [];
    if (c.t === 'depth' || c.t === 'ascend') {
      const at = c.t === 'depth' ? c.at : c.to;
      const inZone = Math.abs(p.depth() - at) <= (c.tol || 0.5);
      live.push(t('目标 {at}m · 深度 {d}m · 浮力 {b}', { at, d: p.depth().toFixed(1), b: (p.buoy >= 0 ? '+' : '') + p.buoy.toFixed(2) }) + (inZone ? ` <b style="color:#7fe9ea">${t('✓在区间内')}</b>` : ''));
      if (c.t === 'ascend') live.push(t('上升速度 {v} m/s（限 {r}）', { v: (p.ascRate > 0 ? '' : '−') + Math.abs(p.ascRate).toFixed(2), r: c.rate }));
    }
    else if (c.t === 'hold' || c.t === 'combo') live.push(t('已按 {a} / {b}s', { a: (st.prog || 0).toFixed(1), b: c.min }));
    else if (c.t === 'wait') live.push(t('再保持 {s}s', { s: Math.max(0, c.s - st.t).toFixed(1) }));
    else if (c.t === 'say') live.push(t('教练还在说… {s}s', { s: Math.max(0, c.dur - st.t).toFixed(0) }));
    else if (c.t === 'maskwater') live.push(t('面镜水位 {n}%（H 压上沿 + N 鼻吐气）', { n: Math.round(p.maskWater * 100) }));
    else if (c.t === 'reach' || c.t === 'deploy') {
      const n = this.s.cave.nodes[c.node];
      if (n) live.push(t('目标「{n}」距离 {d}m', { n: t(n.name || '标记点'), d: p.pos.distanceTo(n.pos).toFixed(1) }) + (c.dark ? ' · ' + t('不许开灯') : ''));
    }
    else if (c.t === 'buddy') live.push(t('距离潜伴 {d}m / {m}m', { d: p.pos.distanceTo(this.s.buddy?.obj.position || p.pos).toFixed(1), m: c.d }));
    else if (c.t === 'gesture') live.push(t('打手势「{g}」—— 按 {k}', { g: t(GESTURE_NAME[c.want]), k: GESTURE_KEYS[c.want] }));
    else if (c.t === 'rand_gesture' && st.evt) live.push(t('回应窗口 {s}s · 已答 {g}/{n}', { s: Math.max(0, 9 - st.t).toFixed(0), g: st.got, n: st.need }));
    else if (c.t === 'key') live.push(t('点按 {k}', { k: st.key ? t(st.key) : c.code }));
    else if (c.t === 'exit') live.push(t('游回入口上水面'));
    else if (c.t === 'mask') live.push(t(c.on ? '按 M 戴回面镜' : '按 M 摘下面镜'));
    else if (c.t === 'photo') live.push(t('F 开取景器再按 F 拍 —— 要 ≥{n}★', { n: c.min }));
    else if (c.t === 'lightoff') live.push(t(p.lightOn || p.backupOn ? '灯还亮着 —— 按 L' : '灯还灭着 —— 按 L'));
    if (p.regOut) live.push(`<span class="bad">${t('憋着气 {s}s —— 快含回二级头', { s: p.regOutT.toFixed(1) })}</span>`);
    if (live.length) now += `<div class="t-live">${live.join('<br>')}</div>`;
    $('#t-now').innerHTML = now;
    let frac = 0;
    if (c.t === 'hold' || c.t === 'combo') frac = Math.min(1, (st.prog || 0) / c.min);
    else if (c.t === 'depth') frac = Math.min(1, (st.prog || 0) / c.hold);
    else if (c.t === 'wait' || c.t === 'say') frac = Math.min(1, st.t / (c.s || c.dur));
    else if (c.t === 'maskwater') frac = st.prog || 0;
    else if (c.t === 'reach' || c.t === 'buddy' || c.t === 'ascend' || c.t === 'rand_gesture' || c.t === 'ccr') frac = st.prog || 0;
    else if (st.timeout) frac = Math.max(0, 1 - st.t / st.timeout) * 0.15; // 仅提示有倒计时
    $('#t-bar').style.width = (frac * 100).toFixed(0) + '%';
    const po2 = $('#t-po2');
    if (po2 && this.s.ccr) {
      po2.textContent = this.alarm > 0 ? t('⚠ PO2 {v} —— 按 O 确认', { v: this.po2.toFixed(2) }) : `PO2 ${this.po2.toFixed(2)}`;
      po2.className = this.alarm > 0 ? 'alarm' : '';
    }
  }

  _renderScore() {
    const e = this.el.querySelector('#t-score');
    if (e) e.textContent = t('失误 {n}', { n: this.mistakes });
  }

  dispose() {
    this.el.remove();
    if (this.marker) this.s.scene.remove(this.marker);
    if (this.device) this.s.scene.remove(this.device);
  }
}
