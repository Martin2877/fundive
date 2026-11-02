// 一次潜水的总控：建洞 -> 下水 -> HUD/生理/目标/联机 -> 出水或阵亡。
import * as THREE from 'three';
import { buildWorld, populateWorld } from '../engine/world.js';
import { WaterFX } from '../engine/water.js';
import { SiltSystem } from '../engine/silt.js';
import { makeUniverse, objectiveText } from '@fundive/shared/universe.js';
import { getMap, spName, endingName } from '@fundive/shared/maps.js';
import { t as tr } from '@fundive/shared/i18n.js';
import { universeRng, range, universeName } from '@fundive/shared/rng.js';
import { Player } from './player.js';
import { Buddy } from './buddy.js';
import { Objective } from './objective.js';
import { SideQuests } from './sidequest.js';
import { STORY } from '@fundive/shared/story.js';
import { Peers } from './netplay.js';
import { MSG } from '@fundive/shared/protocol.js';
import { CAUSTIC } from '../engine/materials.js';
import { DiverLamp } from '../engine/lamp.js';
import { makeComposer } from '../engine/postfx.js';
import { BodyAvatar } from '../ui/avatar.js';
import { DiveHand } from '../engine/hand.js';
import { store } from './storage.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function input_drain(input) { input.sample(); input.consumeLook(); }

export class DiveSession {
  constructor(opts) {
    this.o = opts; // {renderer, input, audio, hud, talk, photos, net, mapId, seed, solo, plan, onEnd, onPause}
    this.map = getMap(opts.mapId);
    this.uni = makeUniverse(opts.mapId, opts.seed);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 160);
    this._fovTarget = 75;
    this.running = false;
    this.ended = false;
    this.paused = false;
    this.lineHold = false;
    this.finderMode = false;
    this.lostT = 0; this.narcoT = 0; this.siltLostT = 0; this.toxT = 0;
    this.exitT = -1;
    this._warn = {};   // 前兆警告门控：每种危险的预警只念一次 / 按冷却复读
    this.buddyLost = false;
    this._em = []; // event queue to broadcast
    this._t = 0;
    this._breathT = 0;
    this.found = new Set(); this._rescueT = 0;
    this.track = []; this.events = []; this._recT = 0;   // 复盘回放：轨迹采样 + 事件时间轴
    this._ffT = this._scheduleFreeflow();
    this._buildWorld();
    this._bindNet();
    this.avatar = new BodyAvatar({ gear: opts.gear });
    this._maskEl = document.getElementById('mask');
    this.hand = new DiveHand(this.camera);
    this.composer = makeComposer(opts.renderer, this.scene, this.camera);
    if (this.composer) {
      const sk = this.cave.skylights, v = this.composer.vol;
      sk.slice(0, 4).forEach((k, i) => v.uSky.value[i].set(k.pos.x, k.pos.z, k.r, k.pos.y - k.r * 0.45));
      v.uSkyN.value = Math.min(4, sk.length);
      v.uSkyCol.value.set(this.map.water.glow).lerp(new THREE.Color(1, 1, 1), 0.4);
      this.cave.shaftMat.visible = false;
    }
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(innerWidth, innerHeight);
    if (this.composer) this.composer.uw.uAspect.value = innerWidth / innerHeight;
  }

  _scheduleFreeflow() {
    if (!this.uni.mods.freeflow) return -1;
    const rng = universeRng(this.map.id, this.o.seed + '::ff');
    return range(rng, 60, 200);
  }

  _buildWorld() {
    const { map, uni, scene } = this;
    this.cave = buildWorld(map, uni);
    scene.add(this.cave.group);
    const vis = this.map.water.vis * uni.mods.vis;
    this.water = new WaterFX(scene, map, vis);
    this.silt = new SiltSystem(scene);
    // 预置泥沙的支线
    (this.uni.branches || []).forEach((b, i) => {
      if (b.silted && b.open) {
        const bd = (this.map.branches || [])[i];
        if (bd) this.silt.burst(new THREE.Vector3(...bd.pts[0]), 1.2, 3);
      }
    });
    this.critters = populateWorld(scene, this.cave, map, uni);
    this.player = new Player(this.cave.entryPos.clone().add(_v.set(0, -0.4, -1)));
    if (map.gas) { this.player.gas = this.player.gasMax = map.gas; }  // 深图背双瓶
    // 朝向洞内：看向前方约 10m 处的脊线（竖井地图会自然低头看向深渊）
    const sp = this.cave.mainSpine, ahead = sp[Math.min(sp.length - 1, Math.round(10 / (sp[1].s - sp[0].s || 1)))].p;
    _v.subVectors(ahead, this.player.pos);
    this.player.yaw = Math.atan2(-_v.x, -_v.z);
    this.player.pitch = THREE.MathUtils.clamp(Math.asin(_v.y / (_v.length() || 1)), -1.1, 0.3) - 0.05;

    this.lamp = new DiverLamp(scene);
    this.scene.add(this.camera);
    this.buddy = this.o.solo ? new Buddy(scene, this.player.pos) : null;
    this.objective = new Objective(scene, uni, this.cave);
    this.side = new SideQuests(scene, uni, this.cave, this.map);
    this._beats = (STORY[this.map.id]?.beats || []).map(b => ({ ...b, fired: false }));
    this.peers = new Peers(scene);
    for (const pl of (this.o.netPlayers || [])) if (pl.id !== this.o.net?.id) this.peers.add(pl.id, pl.name);

    // 幻觉光源池（高氮醉宇宙）
    this.ghosts = [];
    if (uni.mods.hallucination > 0 || uni.eggs.includes('ghost_light')) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.PointLight(0xaad8ff, 0, 10);
        g.position.copy(this.cave.nodes[this.cave.nodes.length - 1].pos);
        this.scene.add(g);
        this.ghosts.push({ l: g, phase: i * 3.1 });
      }
    }
    // 标记石/目标已就位，入口标牌
    if (map.kind !== 'ocean') this._entrySign();
  }

  _entrySign() {
    // "止步" 警示牌
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#c8b060'; c.fillRect(0, 0, 256, 160);
    c.fillStyle = '#1a1a1a'; c.font = 'bold 44px "Noto Sans SC", sans-serif'; c.textAlign = 'center';
    c.fillText(tr('止 步'), 128, 62);
    c.font = '18px "Noto Sans SC"';
    c.fillText(tr('无洞潜训练请勿入内'), 128, 110);
    const tex = new THREE.CanvasTexture(cv);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
    const e = this.cave.nodes[1] || this.cave.nodes[0];
    sign.position.copy(e.pos).add(_v.set(e.r * 0.6, -0.5, 0));
    sign.rotation.y = Math.PI / 3;
    this.scene.add(sign);
  }

  _bindNet() {
    const net = this.o.net;
    if (!net) return;
    this._netHandlers = {
      [MSG.PEER_POSE]: (m) => this.peers.pose(m.id, m.p, m.q, m.gas, m.flags),
      [MSG.PEER_JOIN]: (m) => this.peers.add(m.id, m.name),
      [MSG.PEER_LEFT]: (m) => { this.peers.remove(m.id); this.o.talk.say('有潜伴下线了'); },
      [MSG.EVENT]: (m) => this._onPeerEvent(m),
    };
    for (const [t, fn] of Object.entries(this._netHandlers)) {
      const prev = net.handlers[t];
      net.on(t, (m) => { prev?.(m); if (!this.ended) fn(m); });
    }
  }

  _onPeerEvent(m) {
    const T = this.o.talk;
    const name = this.peers.map.get(m.id)?.name || tr('潜伴');
    switch (m.k) {
      case 'photo': T.say(tr('{name} 拍到了{what}', { name, what: (m.subject ? `「${spName(m.subject)}」` : tr('一张')) + (m.stars ? ' ' + '★'.repeat(m.stars) : '') })); break;
      case 'gesture': {
        const g = { ok: '比了个 OK', up: '指了指上面：撤', help: '猛挥手：过来帮忙', line: '指了指引绳', light: '闪了闪灯' }[m.g] || '打了个手势';
        this.peers.map.get(m.id)?.obj.userData.gesture?.(m.g, 2.2);
        T.say(tr('{name} {g}', { name, g: tr(g) })); break;
      }
      case 'died': T.say(tr('{name} 的灯灭了。{e}', { name, e: endingName(m.ending) })); break;
      case 'pickup': T.say(tr('{name} 捞起了一样东西', { name })); break;
      case 'rescue_on': T.say(tr('{name} 开始拖带被困者', { name })); break;
      case 'objective': T.say(tr('{name} 完成了目标', { name })); break;
      case 'silt': if (m.p) this.silt.burst(new THREE.Vector3(...m.p), 0.8); break;
      case 'share_air': if (m.to === this.o.net.id) { this.player.gas += 20; T.say(tr('{name} 把备用二级头塞给了你', { name })); } break;
      case 'chat': T.say(`${name}：${m.text}`); break;
    }
  }

  emit(k, data) {
    this.events.push({ t: +this._t.toFixed(1), k, ...data });
    this.o.net?.event(k, data);
  }
  talk(t, dur) { this.events.push({ t: +this._t.toFixed(1), k: 'say', text: t }); this.o.talk.say(t, dur); }

  start() {
    this.running = true;
    this.o.hud.show();
    this.talk(`${universeName(this.o.seed)} —— ${objectiveText(this.uni)}`);
    // 深潜图简报：告诉玩家这局的赢法——下去多快都行，上来全靠引绳
    if ((this.map.hazards?.narcosis || 0) >= 0.8)
      this.talk('简报：到底拿到就走，别恋战。回程抓住引绳（G），它替你压住上升速度。');
    this._last = performance.now();
    this._loop();
  }

  _loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const now = performance.now();
    let dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.paused) { input_drain(this.o.input); return; }
    this._t += dt;
    this.tick(dt);
  };

  tick(dt) {
    const { input, audio, hud, photos, renderer } = this.o;
    const p = this.player;
    const inp = input.sample();
    const look = input.consumeLook();
    p.yaw -= look.dx * 0.0026;
    p.pitch = THREE.MathUtils.clamp(p.pitch - look.dy * 0.0024, -1.45, 1.45);

    // —— 离散动作 ——
    for (const a of inp.actions) {
      if (a === 'photo') {
        if (!photos.active) { photos.open(); this.finderMode = true; }
        else this._takePhoto();
      } else if (a === 'interact') { const c = this._ctx(); if (!this.side.interact(c)) this.objective.interact(c); }
      else if (a === 'light') { p.lightOn = !p.lightOn; audio.ok(); }
      else if (a === 'backup') {
        if (p.freeflow > 0) { p.freeflow = 0; this.talk('你换上了备用二级头，嘶嘶声停了'); audio.ok(); }
        else { p.backupOn = !p.backupOn; audio.ok(); }
      }
      else if (a === 'line') this._toggleLineHold();
      else if (a === 'mask') {
        if (this.lesson) {
          p.maskOff = !p.maskOff;
          p.maskWater = p.maskOff ? 1 : p.maskWater;
          audio.ok();
        }
      }
      else if (a === 'reg') { if (this.lesson) { p.regOut = !p.regOut; p.regOutT = 0; audio.ok(); } }
      else if (a === 'keys') hud.toggleKeys?.();
      else if (a === 'pause') {
        if (photos.active) { photos.close(); this.finderMode = false; }
        else this.paused ? this.resume() : this.pause();
      }
      else if (a === 'unlock') {
        if (photos.active) { photos.close(); this.finderMode = false; }
        else if (!input.isTouch && this.running) this.pause();
      }
      else if (a.startsWith('gesture:')) this._gesture(a.slice(8));
      this.onAction?.(a);
    }
    if (photos.active && inp.mz) { /* 取景中仍可缓慢移动 */ }

    // —— 抓线滑行 ——
    if (this.lineHold) {
      const seg = this._nearestLineSeg();
      if (!seg || inp.mz !== 0 || inp.mx !== 0) this.lineHold = false;
      else {
        // 沿线向出口滑；向上爬绳限速 0.45m/s——深井里它就是你的上升保险
        const dir = _v.subVectors(seg.a, this.player.pos); // seg.a 更靠近出口
        const tv = dir.normalize().multiplyScalar(0.9);
        tv.y = Math.min(tv.y, 0.45);
        this.player.vel.lerp(tv, Math.min(1, dt * 3));
        this.player.panic = Math.max(0, this.player.panic - dt * 0.1);
      }
    }

    // —— 玩家物理/生理 ——
    const dead = p.update(dt, inp, this._ctx());
    if (dead) return this._onDeath(dead);

    // —— 相机 ——
    const spd = p.vel.length();
    this._fovTarget = photos.active ? 42 : 75 + Math.min(5, spd * 2.2);
    if (Math.abs(this.camera.fov - this._fovTarget) > 0.2) {
      this.camera.fov += (this._fovTarget - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(p.pos);
    const wob = p.narcosis * 0.04 + p.panic * 0.02;
    // 呼吸起伏 + 踢水节奏 + 横移倾斜：让游动有"在水里"的重量感
    const breath = Math.sin(this._t * 1.1) * 0.004, kickBob = inp.kick ? Math.sin(this._t * 9) * 0.006 * Math.min(1, spd) : 0;
    _v.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const roll = -THREE.MathUtils.clamp(p.vel.dot(_v), -1.5, 1.5) * 0.02;
    _e.set(p.pitch + Math.sin(this._t * 1.3) * wob + breath + kickBob, p.yaw + Math.sin(this._t * 0.9) * wob, Math.sin(this._t * 0.7) * wob * 0.6 + roll, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);

    // —— 灯 ——
    const lit = p.lightOn || p.backupOn;
    // 灯故障：簇状眨停（接触不良的咳喘），不是逐帧白噪频闪
    const flicker = p.blackoutT > 0 && Math.sin(this._t * 9.7) * Math.sin(this._t * 3.3) > 0.72 ? 0.25 : 1;
    const siltNow = this.silt.densityAt(p.pos);
    const power = p.backupOn && !p.lightOn ? 0.45 : 1;
    this.lamp.update(this.camera, { on: lit, power, flicker, silt: siltNow, volumetric: !!this.composer });
    if (this.composer) {
      const v = this.composer.vol;
      v.uLampPos.value.copy(this.lamp.pos); v.uLampDir.value.copy(this.lamp.dir);
      v.uLamp.value = lit ? power * flicker : 0;
      v.uScatter.value = 0.02 + siltNow * 0.35;
      v.uTime.value = this._t;
    }

    // —— 引绳距离 ——
    const ln = this._nearestLineSeg();
    p.lineDist = ln ? ln.d : Infinity;
    p.onLine = p.lineDist < 1.6;
    // 断线宇宙：过 gap 后线就没了
    this.lineBroken = !!this.cave.lineGap;

    // —— 各系统 ——
    CAUSTIC.uCT.value = this._t;
    for (const sf of this.cave.surfaces) sf.userData.mat.uniforms.t.value = this._t;
    this.cave.shaftMat.uniforms.uT.value = this._t;
    this.cave.update?.(dt, p.depth());
    let skyK = 0;
    for (const sk of this.cave.skylights) skyK = Math.max(skyK, 1 - Math.min(1, Math.max(0, (p.pos.distanceTo(sk.pos) - sk.r * 0.5) / (sk.r * 3))));
    this.water.update(dt, p.pos, { on: lit, pos: this.lamp.pos, dir: this.lamp.dir }, skyK, p.depth(), innerHeight, this.camera.fov);
    this.silt.update(dt);
    this.critters.update(dt, { time: this._t, lightPos: lit ? p.pos : null });
    this.buddy?.update(dt, this._ctx());
    this.peers.update(dt);
    const oHint = this.objective.update(dt, this._ctx());
    const sHint = this.side.update(dt, this._ctx());
    if (oHint || sHint) hud.hint(oHint || sHint);
    // 剧情点：走到节点 / 目标完成
    for (const b of this._beats) {
      if (b.fired) continue;
      const n = typeof b.at === 'number' ? this.cave.nodes[b.at] : null;
      if ((n && p.pos.distanceTo(n.pos) < n.r + 3) || (b.at === 'objective' && this.objective.done)) {
        b.fired = true;
        this.events.push({ t: +this._t.toFixed(1), k: 'story' });
        this.talk(b.text, 6);
      }
    }

    // —— 环境事件 ——
    if (this._ffT > 0) { this._ffT -= dt; if (this._ffT <= 0) { p.triggerFreeflow(audio); this.talk('调节器开始自由流——按 Q 换备用二级头'); } }
    if (this.uni.mods.blackout && !p._blacked && this._t > 30) { p._blacked = true; p.triggerBlackout(); this.talk('你的灯闪了一下。接触不良。'); }

    // —— 结局条件：每种死法都先有"前兆"台词，让玩家觉得死是自己的选择 ——
    const siltD = this.silt.densityAt(p.pos);
    const deep = p.depth() > 8;
    const W = this._warn, warnOnce = (k, t) => { if (!W[k]) { W[k] = 1; this.talk(t); } };
    const warnGate = (k, cd, t) => { if ((W[k] || 0) <= this._t) { W[k] = this._t + cd; this.talk(t); } };
    if (siltD > 0.45 && !p.onLine && deep) {
      this.siltLostT += dt;
      if (this.siltLostT > 6) warnGate('silt', 9, '泥沙糊住了——停手别蹬，摸引绳。');
      if (this.siltLostT > 22) return this._onDeath('silt_lost');
    } else { this.siltLostT = Math.max(0, this.siltLostT - dt); if (this.siltLostT <= 0) delete W.silt; }
    if (this.lineBroken && this.cave.lineGap && p.pos.distanceTo(this.cave.lineGap) < 6 && !p.onLine) {
      this.lostT += dt;
      if (this.lostT > 8) warnGate('lost', 10, '引绳断在前面，你离它越来越远了——回头。');
      if (this.lostT > 40) return this._onDeath('lost_line');
    } else { this.lostT = Math.max(0, this.lostT - dt * 0.5); if (this.lostT <= 0) delete W.lost; }
    // 氮醉三段前兆：发飘 -> 判断钝 -> 失控边缘
    if (p.narcosis > 0.35) warnOnce('nk1', '头有点飘——氮醉的前兆。它的解药只有一种：上升。');
    if (p.narcosis > 0.6) warnOnce('nk2', '判断在变钝。别信你现在的直觉，看着深度表慢慢回升。');
    if (p.narcosis > 0.82) warnGate('nk3', 7, '氮醉在接管你的脑子——现在就上升！');
    if (p.narcosis < 0.25) { delete W.nk1; delete W.nk2; delete W.nk3; }
    if (p.narcosis > 0.82) {
      // 移动=脑子还在工作：爬升/高速下潜穿过氮醉区时计时变慢，悬停不动才是等死
      this.narcoT += dt * (p.ascRate > 0.08 ? 0.4 : p.ascRate < -0.3 ? 0.25 : 1);
      // 超过 15s 判断开始崩：惊慌上升，给你看得见的失控前兆
      if (this.narcoT > 15) p.panic = Math.min(1, p.panic + dt * 0.06);
      if (this.narcoT > 35) return this._onDeath('narcosis');
    } else this.narcoT = 0;
    // 氧中毒：确定性的深度暴露计时（越深耗得越快），不是每帧抽奖
    if (p.depth() > 45) warnOnce('deep45', '四十米以下，每一米都在收利息——找到目标，拿了就走。');
    if (p.depth() > 50) warnOnce('tox', '氧分压报警——吸着空气到这个深度，抽搐随时会先来。');
    if (p.depth() > 65) {
      this.toxT += dt * (p.depth() - 62) / 12;
      if (this.toxT > 10) warnGate('tox2', 8, '嘴唇开始发麻——氧中毒在敲门，快离开这个深度。');
      if (this.toxT > 40) return this._onDeath('tox');
    } else this.toxT = Math.max(0, this.toxT - dt * 0.4);
    // 上升超速 / 减压债 / 卡缝 / 气量：全部先警告再判死
    if (p._wildAsc > 0.8) warnGate('wild', 3, '你在往水面上飞——肺要炸了，稳住！');
    else if (p._fastAsc > 0.6) warnGate('asc', 6, '升太快——减压债在涨，出水前得在浅水还清。');
    if (p.decoOwed > 5 && p.depth() < 8) warnGate('deco', 12, '电脑表在叫：你欠着减压停留，回 5 米停够再走。');
    if (p.stuckT > 1.5) warnGate('stuck', 6, '卡住了——别硬蹬，停稳，慢慢往后退。');
    if (p.gas < (this.o.plan?.turnGas || 140)) warnOnce('gas2', '到折返气压了——按计划该回头了。');
    if (this.o.plan?.planDepth && p.depth() > this.o.plan.planDepth + 2) warnOnce('overplan', '已经超过计划深度了——按计划，该回头了。');
    // —— 气室 / 支洞 ——
    if (p.inAir) {
      if (p.domeBad) warnGate('dome_bad', 12, '头出了水面，但空气发闷、刺鼻——别摘二级头，这里的气不能呼吸。');
      else warnOnce('dome', '头出水面了——是个气室。可以摘掉二级头喘口气，省气，也让心率降下来。');
      if (!p.domeBad && p.gas < 60) {
        this._rescueT += dt;
        if (this._rescueT > 25) { this.talk('水下亮起了灯——搜救队顺着你留的引绳找到了气室。'); return this._finish('rescued'); }
        warnOnce('dome_wait', '气不多了，但这里有空气。留在气室里，保存体力，等救援。');
      }
    } else this._rescueT = Math.max(0, this._rescueT - dt);
    for (const b of this.cave.branchInfo) {
      if (this.found.has(b.i) || p.pos.distanceTo(b.entry) > 4) continue;
      this.found.add(b.i);
      this.events.push({ t: +this._t.toFixed(1), k: 'branch', name: b.name, kind: b.kind });
      this.talk(b.kind === 'bottomless' ? '这条支洞没有人量过底——线到此为止，再往下全凭运气。' : b.kind === 'pocket' ? '支洞里有空气的味道——前面可能是气室。' : b.kind === 'dead' ? '岔路。多半是死路，进去要想好怎么出来。' : '一条没标在图上的支洞。');
    }
    if (p.gas < 45) warnOnce('gas1', '气表进红区了——现在每一口都要省着吸。');
    if (p.gas < 25) warnGate('gas0', 8, '最后一点气了——升水，或者找到人共用气源。');
    if (p.blackoutT > 0 && p.blackoutT < 5) warnOnce('lamp', '灯在拼命闪——它要灭了，先记住引绳的方向。');

    // —— 幻觉 ——
    for (const g of this.ghosts) {
      const on = p.narcosis > 0.4 || this.uni.eggs.includes('ghost_light');
      g.l.intensity = on ? Math.max(0, Math.sin(this._t * 0.4 + g.phase)) * 3 : 0;
      g.l.position.x += Math.sin(this._t * 0.2 + g.phase) * dt * 0.3;
    }

    // —— 呼吸气泡 ——
    // 手动呼吸模式（设置里切换）：只有按 U 呼气时才吐泡，节奏全归玩家
    const manual = this._manual = !!store.data.settings?.manualBreath;
    this._breathT -= dt;
    if (this._breathT <= 0 && (!manual || input.keys.has('KeyU'))) {
      this._breathT = manual ? 0.8 : 3.6;
      if (!this.ccr) { // CCR 密闭循环：不吐气泡
        this.camera.getWorldDirection(_v);
        this.water.exhale(p.pos, _v);
        audio.bubble();
      }
    }
    // 面镜框：摘下面镜时框架消失（它已不在你脸上）
    if (this._maskEl) this._maskEl.style.opacity = p.maskOff ? '0' : '';
    // 第一人称手：按住的装备动作 -> 对应手势摆位
    const keys = input.keys;
    if (p.maskOff && !this._hMask) { this.hand.show('mask', 0); this._hMask = true; }
    else if (!p.maskOff) this._hMask = false;
    if (keys.has('KeyH')) this.hand.show('hold', 0);
    else if (keys.has('KeyX')) this.hand.show('nose', 0);
    else if (keys.has('KeyB')) { this.hand.show('bcd', 0); if (!this._hB && Math.random() < dt * 6) { audio.hiss?.(); this._hB = true; } }
    else if (keys.has('KeyV')) { this.hand.show('dump', 0); this._hB = false; }
    else if (p.regOut || keys.has('KeyN')) { this.hand.show('reg', 0); this._hB = false; }
    else this._hB = false;
    this.hand.update(dt);
    // 动作的水下反馈：按 N 鼻子吐出一串泡；按 V 泄气阀喷气泡
    this._bubT = (this._bubT || 0) - dt;
    if (this._bubT <= 0) {
      if (keys.has('KeyN') && !this.ccr) {
        this._bubT = 0.28;
        this.camera.getWorldDirection(_v);
        this.water.exhale(p.pos, _v);
        if (Math.random() < 0.5) audio.bubble?.();
      } else if (keys.has('KeyV')) {
        this._bubT = 0.3;
        // 泄气阀在左肩上方，气泡贴着肩后冒出去
        _v.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this.water.exhale(p.pos.clone().add(_v.clone().multiplyScalar(0.15)), _v);
        if (Math.random() < 0.4) audio.bubble?.();
      }
    }
    audio.update(dt, p, true);

    // —— 雾随泥沙局部变浓 ——
    this.water.setDensityScale((1 + siltD * 4 + p.narcosis * 0.3) * (p.inAir ? 0.15 : 1));
    document.getElementById('narco').style.opacity = Math.min(0.9, p.narcosis * 0.9 + (p.panic > 0.7 ? 0.2 : 0));
    if (this.composer) {
      const u = this.composer.uw;
      u.uTime.value = this._t; u.uNarc.value = p.narcosis; u.uPanic.value = p.panic;
    }

    // —— 联机位姿 ——
    if (this.o.net?.diving) this.peers.maybeSend(this.o.net, dt, p, this.camera.quaternion);

    // —— 出口检测 ——
    const atExit = p.pos.distanceTo(this.cave.entryPos) < this.cave.entryR && p.pos.y > this.cave.entryPos.y - 0.5;
    if (atExit && this._t > 30) {
      if (this.exitT < 0) { this.exitT = 0; this.talk('出口的蓝光在头顶。做完停留再上去。'); }
      this.exitT += dt;
      if (this.exitT > 3) return this._finish(this._exitEnding());
    } else this.exitT = -1;

    this._recTrack(dt);
    // —— HUD ——
    hud.update(p, {
      turnGas: this.o.plan?.turnGas || 140,
      planDepth: this.o.plan?.planDepth || 0,
      objectiveText: this.objective.statusText(this.uni)
        + (!this.objective.done && this.cave.objectiveSpot
          ? ` <b>· ${Math.round(p.pos.distanceTo(this.cave.objectiveSpot.pos))}m</b>` : ''),
      manualBreath: manual,
      depthTarget: this.trainer?.depthTarget?.() || null,
    });
    hud.setLineInfo(this.lineHold ? '抓着引绳 —— 放松，让它带你走' : (p.onLine ? '' : (p.lineDist < 30 ? '' : '看不见引绳了')));

    if (this.composer) this.composer.render(dt);
    else renderer.render(this.scene, this.camera);
    // 体感小人
    this.avatar?.update(dt, p, input.keys);
  }

  _recTrack(dt) {
    this._recT -= dt;
    if (this._recT > 0) return;
    this._recT = 0.5;
    const p = this.player;
    this.track.push([+this._t.toFixed(1), +p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1), Math.round(p.gas), +p.ascRate.toFixed(2)]);
  }

  _ctx() {
    return {
      nav: this.cave.nav, silt: this.silt, uni: this.uni, audio: this.o.audio,
      flowZones: this.cave.flowZones, siltZones: this.cave.siltZones, pockets: this.cave.pockets,
      entryPos: this.cave.entryPos, entryR: this.cave.entryR,
      player: this.player, photos: this.o.photos, talk: (t, d) => this.talk(t, d),
      fx: { emit: (k, d) => this.emit(k, d) },
      lineBroken: this.lineBroken, lineGapPos: this.cave.lineGap,
      buddyLost: this.buddyLost,
      manualBreath: this._manual,
      setBuddyLost: (v) => { this.buddyLost = v; },
      onDeath: (id) => this._onDeath(id),
      atExit: this.player.pos.distanceTo(this.cave.entryPos) < this.cave.entryR && this.player.pos.y > this.cave.entryPos.y - 0.5,
      mapId: this.map.id, universeName: universeName(this.o.seed),
      lightOn: this.player.lightOn || this.player.backupOn,
    };
  }

  _nearestLineSeg() {
    const pts = this.cave.linePts;
    if (!pts?.length) return null;
    let best = null, bd = Infinity;
    const pos = this.player.pos;
    const ab = new THREE.Vector3(), ap = new THREE.Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      ab.subVectors(b, a);
      const t = THREE.MathUtils.clamp(ap.subVectors(pos, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const px = a.x + ab.x * t, py = a.y + ab.y * t, pz = a.z + ab.z * t;
      const d = Math.hypot(pos.x - px, pos.y - py, pos.z - pz);
      if (d < bd) { bd = d; best = { a, b, d, i }; }
    }
    return best;
  }

  _toggleLineHold() {
    if (this.lineHold) { this.lineHold = false; return; }
    const seg = this._nearestLineSeg();
    if (seg && seg.d < 1.4) {
      this.lineHold = true;
      this.o.hud.hint('抓住了引绳。松开方向键，它带你回出口。');
    } else this.o.hud.hint('够不到引绳');
  }

  _gesture(n) {
    const g = { 1: 'ok', 2: 'up', 3: 'help', 4: 'line', 5: 'light' }[n];
    if (!g) return;
    this.onGesture?.(g);
    this.avatar?.gesture(g);
    this.hand?.show(g);
    this.emit('gesture', { g });
    this.talk({ ok: '你比了个 OK', up: '你竖拇指指了指上面', help: '你猛挥手求救', line: '你指了指引绳', light: '你晃了晃手里的灯' }[g]);
    // 单机潜伴会回应 ok / 看到求助会回个手势
    if (this.buddy && !this.buddy.lost) {
      if (g === 'ok') setTimeout(() => { this.buddy.obj.userData.gesture?.('ok', 2); this.talk('潜伴回了个 OK'); }, 1200);
      if (g === 'help') setTimeout(() => { this.buddy.obj.userData.gesture?.('ok', 2); this.talk('潜伴回了个"稳住"朝你游过来'); }, 1400);
    }
  }

  _takePhoto() {
    const shot = this.o.photos.capture(this.camera, this.critters.photoables, this._ctx());
    this.o.audio.shutter();
    if (shot.fail) { this.o.hud.hint(shot.fail); return; }
    this.o.hud.hint(shot.sp ? tr('拍到了：{n} {s}', { n: spName(shot.sp), s: '★'.repeat(shot.stars) }) : tr('什么都没对上焦'), 2);
    this.emit('photo', { subject: shot.sp, stars: shot.stars });
  }

  _onDeath(id) {
    if (this.ended) return;
    // 潜伴在最后一口气时出现 -> 获救
    if (id === 'out_of_air' && this.buddy && !this.buddy.lost && this.buddy.obj.position.distanceTo(this.player.pos) < 5) {
      this.player.gas = 20;
      this.player.dead = null; // 被潜伴救回，后面还可能再出事
      this.talk('黑暗里一只手把备用二级头塞进你嘴里——潜伴还在。');
      return;
    }
    // 深度失联 => 失踪而非气尽
    if (id === 'out_of_air' && this.player.lineDist > 20 && this.player.depth() > 10) id = 'missing';
    this.player.dead = id;
    this.emit('died', { ending: id });
    this._finish(id);
  }

  _exitEnding() {
    const p = this.player;
    if (p.decoOwed > 8) return 'deco_hit';
    const rough = p.gas < 40 || p.panic > 0.5 || this.buddyLost;
    return rough ? 'survived_rough' : 'survived';
  }

  pause() {
    this.paused = true;
    this.o.onPause?.(true);
  }
  resume() {
    this.paused = false;
    this._last = performance.now();
    this.o.onPause?.(false);
  }
  abort() { this._finish('survived_rough', true); }

  _finish(ending, aborted = false) {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    const p = this.player;
    const result = {
      ending, aborted,
      mapId: this.map.id, seed: this.o.seed, universe: universeName(this.o.seed),
      objectiveDone: this.objective.done,
      objectiveType: this.uni.objective.type,
      stats: {
        time: Math.floor(p.time), maxDepth: +p.maxDepth.toFixed(1),
        gasLeft: Math.max(0, Math.round(p.gas)), photos: this.o.photos.shots.length,
        stir: Math.round(p.stirScore), panicPeak: +p.panic.toFixed(2),
        branches: this.found.size, airTime: Math.round(p.airT || 0),
        sides: this.side.stats,
      },
      shots: this.o.photos.shots.slice(-8),
      replay: { mapId: this.map.id, nodes: this.cave.nodes.map(n => ({ x: n.pos.x, z: n.pos.z, name: n.name })), track: this.track, events: this.events, turnGas: this.o.plan?.turnGas || 140, planDepth: this.o.plan?.planDepth || 0 },
    };
    document.getElementById('narco').style.opacity = 0;
    this.o.photos.close();
    this.o.hud.hide();
    this.o.onEnd?.(result);
  }

  dispose() {
    this.running = false;
    this.avatar?.dispose();
    if (this._maskEl) this._maskEl.style.opacity = '';
    this.o.hud.hide();
    this.o.photos.close();
    this.scene.traverse(o => { o.geometry?.dispose?.(); });
    this.composer?.dispose();
  }
}
