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
import { STORY, OMENS } from '@fundive/shared/story.js';
import { makeFish } from '../engine/creatures.js';
import { SPECIES } from '@fundive/shared/maps.js';
import { Peers } from './netplay.js';
import { MSG } from '@fundive/shared/protocol.js';
import { CAUSTIC } from '../engine/materials.js';
import { DiverLamp } from '../engine/lamp.js';
import { resolveLoadout } from '@fundive/shared/gear.js';
import { makeComposer } from '../engine/postfx.js';
import { buildSurface } from '../engine/surface.js';
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
    // 宇宙排定的随机事件时刻表 + 事件副作用的衰减状态
    this._evts = (this.uni.events || []).slice();
    this._shake = 0; this._shoals = []; this._thermoT = 0; this._surge = null;
    this._region = ''; this._regionT = 0;
    this._buildWorld();
    this._bindNet();
    // 触屏不建体感小人：小屏没地方放，还白养一个 WebGL 上下文
    this.avatar = opts.input.isTouch ? null : new BodyAvatar({ gear: this.loadout?.gear || opts.gear });
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

  // 宇宙事件：一次性的环境突发——有声音、有震感、有台词，让玩家觉得"这个洞是活的"
  _fireEvent(e) {
    const p = this.player, audio = this.o.audio;
    this.events.push({ t: +this._t.toFixed(1), k: 'event', ev: e.k });
    switch (e.k) {
      case 'rumble': {
        this._shake = Math.min(1.2, this._shake + 0.9);
        audio?.rumble?.();
        this.talk('深处传来一阵低鸣——整个洞道轻轻晃了一下，又静了。');
        break;
      }
      case 'rockfall': {
        this._shake = Math.min(1.2, this._shake + 0.6);
        audio?.rumble?.(); audio?.silt?.();
        this.camera.getWorldDirection(_v);
        const pos = p.pos.clone().addScaledVector(_v, 3.2);
        pos.y += 1.4;
        this.silt.burst(pos, 1.5, 4);
        this.talk('前方有落石——泥沙正从洞顶泻下来，别硬穿。');
        break;
      }
      case 'surge': {
        const near = this.cave.nav?.closest?.(p.pos);
        const dir = near?.tan ? near.tan.clone() : new THREE.Vector3(0, 0, -1);
        if (this._ocean && this.map.ocean?.current) dir.set(...this.map.ocean.current);
        dir.normalize();
        const z = { pos: p.pos.clone(), dir, r: 20, strength: 2.0, type: 'stream', name: '突发激流' };
        this.cave.flowZones.push(z);
        this._surge = { t: 22, z };
        audio?.whoosh?.();
        this.talk('水流突然变强了——像远处有人开了一扇门。');
        break;
      }
      case 'flicker': {
        p.flickerT = 7;
        this.talk('灯闪了一下——又好了。接触不良的老毛病。');
        break;
      }
      case 'shoal': this._spawnShoal(); break;
      case 'omen': {
        const pool = OMENS[this._ocean ? 'ocean' : this._ice ? 'ice' : 'cave'] || OMENS.cave;
        this.talk(pool[e.t % pool.length]);
        break;
      }
      case 'thermocline': {
        this._thermoT = 26;
        this.water.setDensityScale(1.7);
        this.talk('穿过一层冷水——视野糊了一片，像中间挂了层纱。');
        break;
      }
      case 'creak': {
        audio?.rumble?.();
        this.talk('冰层在头顶发出长长的呻吟。它一直在动——只是慢得你看不见。');
        break;
      }
      case 'cold_snap': {
        this.cold = Math.min(1, this.cold + 0.06);
        this.talk('一股寒流扫过——体温掉了一截。');
        break;
      }
    }
  }

  // 鱼群横穿：一小群鱼从你面前掠过，几秒就散进黑暗里
  _spawnShoal() {
    const sp = this._ocean ? 'damselfish' : this._ice ? 'whitefish'
      : (this.map.creatures || []).find(c => SPECIES[c]?.cat === 'fish') || 'cavefish';
    const rng = universeRng(this.map.id, `${this.o.seed}::shoal${Math.floor(this._t)}`);
    const g = new THREE.Group();
    const fish = [];
    for (let i = 0; i < 14; i++) {
      const f = makeFish(sp, rng);
      f.position.set(range(rng, -3.5, 3.5), range(rng, -1.1, 1.1), range(rng, -3.5, 3.5));
      g.add(f); fish.push(f);
    }
    const p = this.player;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1); else fwd.normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = side.multiplyScalar(rng() > 0.5 ? 1 : -1).normalize();
    g.position.copy(p.pos).addScaledVector(fwd, 7).addScaledVector(dir, -9);
    g.position.y = p.pos.y + 0.4;
    g.rotation.y = Math.atan2(-dir.z, dir.x);
    this.scene.add(g);
    this._shoals.push({ g, dir, fish, t: 0 });
    this.talk('一团鱼群从你面前掠过——快得像一片云。');
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
    this._lineWord = map.kind === 'ocean' ? '锚绳' : map.kind === 'ice' ? '安全绳' : '引绳';
    this._ocean = map.kind === 'ocean';
    this._ice = map.kind === 'ice';
    this.cold = 0;
    this.player = new Player((this.cave.spawnPos || this.cave.entryPos.clone().add(_v.set(0, -0.4, -1))).clone());
    // 装备间配装：气瓶/胶片/浮标/备灯/罗盘全听玩家摆的位；没走装备间（教学等）保持原默认
    this.loadout = resolveLoadout(this.o.plan?.loadout, map, uni);
    const lo = this.loadout, hasLO = !!this.o.plan?.loadout;
    if (hasLO ? lo.gas != null : !!map.gas) this.player.gas = this.player.gasMax = hasLO ? lo.gas : map.gas;
    this.player.compass = hasLO ? lo.compass : true;
    this.player.gearDrag = lo.drag;
    this.player.squeezeK = lo.squeezeK;
    this.player.spareLamps = hasLO ? lo.spares : 1;
    this.hasSMB = hasLO ? lo.smb > 0 : true;
    this.hasCamera = hasLO ? lo.camera : true;
    this.hasReel = hasLO ? lo.reel > 0 : true;
    this.pony = hasLO ? lo.pony : 0;     // 应急瓶：主瓶见底自动接一次 45bar
    if (hasLO) this.o.photos.film = lo.film;
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
        const g = { ok: '比了个 OK', up: '指了指上面：撤', help: '猛挥手：过来帮忙', line: tr('指了指{lw}', { lw: this._lineWord }), light: '闪了闪灯' }[m.g] || '打了个手势';
        this.peers.map.get(m.id)?.obj.userData.gesture?.(m.g, 2.2);
        T.say(tr('{name} {g}', { name, g: tr(g) })); break;
      }
      case 'died': T.say(tr('{name} 的灯灭了。{e}', { name, e: endingName(m.ending) })); break;
      case 'pickup': T.say(tr('{name} 捞起了一样东西', { name })); break;
      case 'rescue_on': T.say(tr('{name} 开始拖带被困者', { name })); break;
      case 'smb': T.say(tr('{name} 放出了水面浮标', { name })); break;
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
    this.o.hud.setLineWord?.(this._lineWord);
    this.talk(`${universeName(this.o.seed)} —— ${objectiveText(this.uni)}`);
    // 深潜图简报：告诉玩家这局的赢法——下去多快都行，上来全靠引绳/锚绳
    if ((this.map.hazards?.narcosis || 0) >= 0.8)
      this.talk(tr('简报：到底拿到就走，别恋战。回程抓住{lw}（G），它替你压住上升速度。', { lw: this._lineWord }));
    // 海潜简报：两条活路——锚绳回船，浮标叫人
    if (this._ocean)
      this.talk('简报：沿锚绳回船是正道。漂远了就先放浮标（C）再出水——船看得见橙色的球，看不见浪尖上的脑袋。');
    // 冰潜简报：一条活路——安全绳回冰洞；体温是倒计时
    if (this._ice)
      this.talk('简报：头顶是一整块冰，唯一的出口是你下来的冰洞——安全绳一路牵回洞口。盯住体寒，冰水每一分钟都在耗体温。');
    // 罗盘必修图简报：没有参照的回程，认路全看指北针
    if (this.map.navReq)
      this.talk('简报：这张图回头的路没有屏幕标记——目标方向和出口方向都在你的罗盘 ◆ 上。盯住方位走。');
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

    // —— 出水流程：抬头越过水线，看到水上的世界，等接应 ——
    if (this.surfaced) {
      const sf = this.surfaced;
      sf.t += dt;
      p.yaw = sf.yaw -= look.dx * 0.0026;
      p.pitch = sf.pitch = THREE.MathUtils.clamp(sf.pitch - look.dy * 0.0024, -1.3, 1.3);
      const k = Math.min(1, sf.t / 1.5);
      const e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(sf.from, sf.to, e);
      // 出水后的"浮"：海潜跟着浪涌上下，洞潜/冰潜站稳后只剩轻微呼吸晃动
      const bob = sf.kind === 'ocean' ? Math.sin(this._t * 0.9) * 0.09 + Math.sin(this._t * 1.7) * 0.03 : Math.sin(this._t * 1.6) * 0.02;
      this.camera.position.y += bob * e;
      _e.set(sf.pitch, sf.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_e);
      sf.world.group.userData.update?.(dt, this._t);
      this.water.setAbove(e);
      // 水上的大气光照/薄雾要走 water.update 的同一条过渡路径（skyK=1, depth<0 -> 全亮）
      this.water.update(dt, this.camera.position, { on: false, pos: this.camera.position, dir: _v.set(0, 0, -1) }, 1, -1, innerHeight, this.camera.fov);
      this.lamp.update(this.camera, { on: false });
      if (this.composer) { this.composer.vol.uLamp.value = 0; this.composer.render(dt); }
      else renderer.render(this.scene, this.camera);
      // 水面呼吸：咬着二级头就还在走气表；摘了（R）就改吸空气，气瓶歇着
      if (!p.regOut && !p.noGas && p.gas > 0) p.gas = Math.max(0, p.gas - dt * 0.35);
      if (p.gas <= 0 && !p.regOut) { p.regOut = true; this.talk('气瓶最后嘶了一声空了——你干脆摘下二级头，水面上有的是空气。'); }
      // 水面动作：摘/戴二级头、呼救发信号、暂停
      for (const a of inp.actions) {
        if (a === 'reg') { p.regOut = !p.regOut; this.talk(p.regOut ? '你松开二级头——第一口空气凉得带土味，气表停在原地。' : '你又把二级头咬回嘴里。'); audio.ok(); }
        else if (a === 'pause' || a === 'unlock') { this.paused ? this.resume() : this.pause(); }
        else if (a === 'keys') hud.toggleKeys?.();
        else if (a === 'interact' && sf.signal && !sf.signaled) { sf.signaled = 1; sf.signalT = 0; this.emit('signal', {}); this.talk('你贴着水面连吹三声短哨，又扯开嗓子喊——远处传来回应的人声：接应听见了。'); }
        else if (a === 'gesture:3' && sf.signal && !sf.signaled) { sf.signaled = 1; sf.signalT = 0; this.emit('signal', {}); this.talk('你扒着水沿朝岸上猛挥手——有人抬手回应，朝这边过来了。'); }
      }
      // 随时潜回去：结局没触发前，W/空格 把你送回水里
      if (inp.mz > 0.3 || inp.kick) {
        this.surfaced = null; sf.world.group.visible = false; this.water.setAbove(0);
        this.cave.group.visible = true;
        for (const s of this.cave.surfaces) s.visible = true;
        p.pos.y = sf.from.y - 1.2; p.regOut = false; this.adriftT = 0; this.exitT = -1;
        this.talk('你深吸一口，又潜回水里。');
        return;
      }
      const tc = input.isTouch;
      if (sf.signal && !sf.signaled) hud.hint(tc ? '这里没人接应——「装备」抽屉里点 3 挥手 / 互动键吹哨；摇杆前推潜回' : '这里没人接应——按 3 挥手 / 按 E 吹哨呼喊；按 W 潜回水里', 0.4);
      else if (!sf.far && !p.regOut) hud.hint(tc ? '「装备」抽屉里点 R 摘下二级头省气；摇杆前推潜回' : '按 R 摘下二级头省气；按 W 潜回水里', 0.4);
      else if (!sf.far) hud.hint(tc ? '摇杆前推潜回水里' : '按 W 潜回水里', 0.4);
      // 漂远了出水：接应/漂流逻辑继续走
      if (sf.far) {
        if (this.smb) {
          this._pickupT = (this._pickupT || 0) + dt;
          if (this._pickupT > 1 && !this._warn.pickup) { this._warn.pickup = 1; this.talk('远处传来引擎声——你的橙色浮标被看到了，船朝你开过来了。'); }
          if (this._pickupT > 4.5) return this._finish('boat_pickup');
        } else {
          this.adriftT = (this.adriftT || 0) + dt;
          if (this.adriftT > 20 && (this._warn.a2 || 0) <= this._t) { this._warn.a2 = this._t + 15; this.talk('没有人看到你。这个距离上，一颗脑袋和海鸟没有区别。'); }
          if (this.adriftT > 45) return this._onDeath('adrift');
        }
      } else if (sf.signal) {
        // 无人接应的出口：玩家发出信号后才收尾——挥手/吹哨都算
        if (sf.signaled) { sf.signalT += dt; if (sf.signalT > 4) return this._finish(sf.ending()); }
      } else if (sf.t > sf.wait && !this.ended) return this._finish(sf.ending());
      return;
    }

    p.yaw -= look.dx * 0.0026;
    p.pitch = THREE.MathUtils.clamp(p.pitch - look.dy * 0.0024, -1.45, 1.45);

    // —— 离散动作 ——
    for (const a of inp.actions) {
      if (a === 'photo') {
        if (this.hasCamera === false) { hud.hint('没带相机——摊摊手算了', 2); }
        else if (!photos.active) { photos.open(); this.finderMode = true; }
        else this._takePhoto();
      } else if (a === 'interact') {
        const c = this._ctx();
        // 非常规出口的旱厅交互优先：卸装备攀爬 / 发信标呼救
        if (this._exitSpot?.kind === 'climb') {
          this._exitSpot = null;
          this.talk('你把气瓶和配重卸在岸边，顺着岩缝往上攀——上头有风，有风就有天光。');
          this._pendingEnd = { ending: 'climbed_out', t: 4.5 };
        } else if (this._exitSpot?.kind === 'far') {
          this._exitSpot = null;
          this.talk('你按响了信标，又把反光带挂上最高的石笋。很久之后，旱厅深处传来了人声——救援从山的另一头找过来了。');
          this._pendingEnd = { ending: 'rescue_call', t: 8 };
        } else if (!this.side.interact(c)) this.objective.interact(c);
      }
      else if (a === 'light') { p.lightOn = !p.lightOn; audio.ok(); }
      else if (a === 'backup') {
        if (p.freeflow > 0) { p.freeflow = 0; this.talk('你换上了备用二级头，嘶嘶声停了'); audio.ok(); }
        else if (p.spareLamps > 0 || p.backupOn) { p.backupOn = !p.backupOn; audio.ok(); }
        else hud.hint('没带备用灯', 1.6);
      }
      else if (a === 'line') this._toggleLineHold();
      else if (a === 'smb') this._deploySMB();
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

    // —— 挂钩：缆绳松弛度 1.2m，超出就把人拽回来；水流在 player.js 里被 hook 屏蔽 ——
    if (p.hooked) {
      const slack = 1.2;
      _v.subVectors(p.pos, p.hooked);
      const d = _v.length();
      if (d > slack) { p.pos.copy(p.hooked).addScaledVector(_v.normalize(), slack); const vn = p.vel.dot(_v); if (vn > 0) p.vel.addScaledVector(_v, -vn); }
      p.vel.multiplyScalar(Math.exp(-dt * 2.2));
      if (this._hookLine) {
        const lp = this._hookLine.geometry.attributes.position;
        lp.setXYZ(0, p.pos.x, p.pos.y - 0.1, p.pos.z); lp.setXYZ(1, p.hooked.x, p.hooked.y, p.hooked.z);
        lp.needsUpdate = true;
      }
      if (p.inCurrent?.type === 'washer') p.vel.y += Math.sin(this._t * 3) * dt * 0.5;   // 挂着也还是会荡
    }

    // —— 玩家物理/生理 ——
    const dead = p.update(dt, inp, this._ctx());
    if (dead) return this._onDeath(dead);

    // 闯进强流区：报一次话，告诉玩家怎么对付
    if (p.inCurrent !== this._flowSeen) {
      this._flowSeen = p.inCurrent;
      if (p.inCurrent) this.talk({
        stream: '一股横流的力道从侧面撞上来——顶住硬穿，或者贴近礁石挂钩（G）。',
        cross: '底下的水流在慢慢变向——刚才还在推你来的方向，现在开始往回拽。',
        washer: '水在这里打转——一会儿上抛一会儿下按，像被卷进洗衣机。挂钩（G）稳住，或者绕开。',
      }[p.inCurrent.type]);
    }

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
    const shake = this._shake * this._shake;   // 平方衰减：震一下，缓下来
    _e.set(p.pitch + Math.sin(this._t * 1.3) * wob + breath + kickBob + Math.sin(this._t * 31) * 0.012 * shake,
      p.yaw + Math.sin(this._t * 0.9) * wob + Math.sin(this._t * 27 + 1.7) * 0.01 * shake,
      Math.sin(this._t * 0.7) * wob * 0.6 + roll + Math.sin(this._t * 23 + 0.6) * 0.008 * shake, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);

    // —— 灯 ——
    const lit = p.lightOn || p.backupOn;
    // 灯故障：簇状眨停（接触不良的咳喘），不是逐帧白噪频闪
    const flicker = (p.blackoutT > 0 || p.flickerT > 0) && Math.sin(this._t * 9.7) * Math.sin(this._t * 3.3) > 0.72 ? 0.25 : 1;
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
    this.cave.update?.(dt, p.depth(), p.pos);
    let skyK = 0;
    for (const sk of this.cave.skylights) skyK = Math.max(skyK, 1 - Math.min(1, Math.max(0, (p.pos.distanceTo(sk.pos) - sk.r * 0.5) / (sk.r * 3))));
    this.water.update(dt, p.pos, { on: lit, pos: this.lamp.pos, dir: this.lamp.dir }, skyK, p.depth(), innerHeight, this.camera.fov);
    this.silt.update(dt);
    // —— 水面浮标：放出后蹿上浪尖，水平跟着你走，线攥在手里 ——
    if (this.smb?.obj) {
      this.smb.t += dt;
      const rise = 1 - Math.exp(-this.smb.t / 1.4);
      const by = p.pos.y + (-0.15 - p.pos.y) * rise;
      this.smb.buoy.position.set(p.pos.x + Math.sin(this._t * 0.7) * 0.2, by, p.pos.z + Math.cos(this._t * 0.6) * 0.2);
      const lp = this.smb.line.geometry.attributes.position;
      lp.setXYZ(0, p.pos.x, p.pos.y - 0.08, p.pos.z);
      lp.setXYZ(1, this.smb.buoy.position.x, by - 0.7, this.smb.buoy.position.z);
      lp.needsUpdate = true;
    }
    this.critters.update(dt, { time: this._t, lightPos: lit ? p.pos : null });
    this.buddy?.update(dt, this._ctx());
    this.peers.update(dt);
    const oHint = this.objective.update(dt, this._ctx());
    const sHint = this.side.update(dt, this._ctx());
    if (oHint || sHint) hud.hint(oHint || sHint);
    // 目标完成 -> 明确告诉玩家"怎么算结束"（按潜种说人话）
    if (this.objective.done && !this._objBriefed) {
      this._objBriefed = true;
      this.talk(this._ocean
        ? '目标完成。回船两条路：找到锚绳（按 G 抓住）顺绳升水，在船边 10 米内浮出水面；漂得太远就先在水下放浮标（C）。'
        : this._ice ? '目标完成。沿安全绳回冰洞，从你下来的那个洞出水。' : '目标完成。沿引绳回入口，从天窗出水。');
    }
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

    // —— 宇宙排定的随机事件：同一宇宙所有人同一时刻撞上同一批事 ——
    while (this._evts.length && this._evts[0].t <= this._t) this._fireEvent(this._evts.shift());
    if (this._shake > 0) this._shake = Math.max(0, this._shake - dt * 0.55);
    if (p.flickerT > 0) p.flickerT -= dt;
    if (this._thermoT > 0) { this._thermoT -= dt; if (this._thermoT <= 0) this.water.setDensityScale(1); }
    if (this._surge) {
      this._surge.t -= dt;
      if (this._surge.t <= 0) {
        const zi = this.cave.flowZones.indexOf(this._surge.z);
        if (zi >= 0) this.cave.flowZones.splice(zi, 1);
        this._surge = null;
      }
    }
    for (let i = this._shoals.length - 1; i >= 0; i--) {
      const s = this._shoals[i];
      s.t += dt;
      s.g.position.addScaledVector(s.dir, dt * 1.4);
      s.g.position.y += Math.sin(s.t * 0.8) * dt * 0.15;
      for (const f of s.fish) f.userData.tail.rotation.y = Math.sin(s.t * 7 + f.position.x * 8) * 0.55;
      if (s.t > 24) { this.scene.remove(s.g); this._shoals.splice(i, 1); }
    }
    // —— 区域名：走进具名洞厅/海区时亮一下地名，像手绘地图被点亮 ——
    this._regionT -= dt;
    let region = '';
    for (const n of this.cave.nodes) {
      if (n.name && p.pos.distanceTo(n.pos) < n.r + 2.5) { region = n.name; break; }
    }
    if (region && region !== this._region) { this._region = region; this._regionT = 7; hud.setRegion?.(tr(region)); }
    else if (!region && this._regionT <= 0 && this._region) { this._region = ''; hud.setRegion?.(''); }

    // —— 结局条件：每种死法都先有"前兆"台词，让玩家觉得死是自己的选择 ——
    const siltD = this.silt.densityAt(p.pos);
    const deep = p.depth() > 8;
    const W = this._warn, warnOnce = (k, t) => { if (!W[k]) { W[k] = 1; this.talk(t); } };
    const warnGate = (k, cd, t) => { if ((W[k] || 0) <= this._t) { W[k] = this._t + cd; this.talk(t); } };
    if (siltD > 0.45 && !p.onLine && deep) {
      this.siltLostT += dt;
      if (this.siltLostT > 6) warnGate('silt', 9, tr('泥沙糊住了——停手别蹬，摸{lw}。', { lw: this._lineWord }));
      if (this.siltLostT > 22) return this._onDeath('silt_lost');
    } else { this.siltLostT = Math.max(0, this.siltLostT - dt); if (this.siltLostT <= 0) delete W.silt; }
    if (this.lineBroken && this.cave.lineGap && p.pos.distanceTo(this.cave.lineGap) < 6 && !p.onLine) {
      this.lostT += dt;
      if (this.lostT > 8) warnGate('lost', 10, tr('{lw}断在前面，你离它越来越远了——回头。', { lw: this._lineWord }));
      if (this.lostT > 40) return this._onDeath('lost_line');
    } else { this.lostT = Math.max(0, this.lostT - dt * 0.5); if (this.lostT <= 0) delete W.lost; }
    // —— 冰潜失温：冰水按秒抽体温，过半后发抖耗气 ——
    if (this._ice) {
      this.cold = Math.min(1, this.cold + dt / (this.map.ice?.cold || 420));
      if (this.cold > 0.55) p.gas = Math.max(0, p.gas - dt * 0.9);   // 发抖耗气
      if (this.cold > 0.32) warnGate('cold1', 90, '指尖开始发麻——冰水在一刻不停地抽走体温。');
      if (this.cold > 0.58) warnGate('cold2', 60, '手指快没知觉了，呼吸变急，耗气明显变快——该考虑回了。');
      if (this.cold > 0.84) warnGate('cold3', 25, '你在控制不住地发抖，动作都僵了。回冰洞，出水，现在。');
      if (this.cold >= 1) return this._onDeath('hypothermia');
    }
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
    if (p.wedged) warnGate('stuck', 5, '卡住了——别再顶，收手收腿，慢慢往后退。');
    else if (p.inCrack) warnGate('crack', 14, '窄缝——侧身慢过。感觉顶住就先退出来，别硬挤。');
    // —— 教练回声：上过的课在水里变成肌肉记忆；没上过的，提示回去补课 ——
    if (!this.lesson) {
      if (!this._echo) this._echo = new Set();
      const echo = (k, txt) => { if (!this._echo.has(k)) { this._echo.add(k); this.talk(txt); } };
      const trained = (cid, lid) => (store.data.courses?.[cid]?.[lid]?.stars || 0) > 0;
      if (p.inCrack) echo('crack', trained('mil', 'mil_crack') ? '教官的话在耳边：窄缝不吃快——顶住就退。' : '前面是条窄缝——感觉顶住马上退，别硬挤。（战术课的"窄缝自知"练过这个）');
      if (siltD > 0.45 && deep) echo('silt', trained('aow', 'aow_frog') ? '泥沙区——AOW 的肌肉记忆：收腿蛙踢，沙不扬。' : '泥沙糊住了——收腿蛙踢，别搅。（AOW 有蛙踢课）');
      if (this._ice && this.cold > 0.32) echo('cold', trained('mil', 'mil_frost') ? '寒区课的纪律：手指僵之前，先往绳靠。' : '手指开始麻了——失温不等人，该计划回程了。（战术课有寒区处置）');
      if (p.freeflow > 0) echo('freeflow', trained('mil', 'mil_frost') ? '自由流——Q 换备头，冰潜课练过这个。' : '二级头跑气了——按 Q 换备用头！');
      if (!p.lightOn && !p.backupOn && deep) echo('dark', trained('mil', 'mil_dark') ? '灯没了——Q 备灯。战术课练过。' : '主灯不亮——按 Q 切备用灯。（黑暗冗余课讲过）');
      if (this.lineBroken && !p.onLine && p.lineDist > 8) echo('line', trained('mil', 'mil_line') ? '引绳断了——停住别乱摸，先找回线头。' : '引绳断了——别乱游，找回线头或者原路回。（引绳纪律课讲过）');
      if (p.inCurrent) echo('flow', '水流在推你——别硬顶，顺流或者按 G 挂钩稳住。');
      if (p.inAir && !p.domeBad) echo('pocket', '气室里摘二级头前想一想：有的气室，气是不能呼吸的。');
    }
    if (p.gas < (this.o.plan?.turnGas || 140)) warnOnce('gas2', '到折返气压了——按计划该回头了。');
    if (this.o.plan?.planDepth && p.depth() > this.o.plan.planDepth + 2) warnOnce('overplan', '已经超过计划深度了——按计划，该回头了。');
    // —— 气室 / 支洞 ——
    if (p.inAir) {
      if (p.domeBad) warnGate('dome_bad', 12, '头出了水面，但空气发闷、刺鼻——别摘二级头，这里的气不能呼吸。');
      else warnOnce('dome', '头出水面了——是个气室。可以摘掉二级头喘口气，省气，也让心率降下来。');
      if (!p.domeBad && p.gas < 60) {
        this._rescueT += dt;
        if (this._rescueT > 25) { this.talk(tr('水下亮起了灯——搜救队顺着你留的{lw}找到了气室。', { lw: this._lineWord })); return this._finish('rescued'); }
        warnOnce('dome_wait', '气不多了，但这里有空气。留在气室里，保存体力，等救援。');
      }
    } else this._rescueT = Math.max(0, this._rescueT - dt);
    for (const b of this.cave.branchInfo) {
      if (this.found.has(b.i) || p.pos.distanceTo(b.entry) > 4) continue;
      this.found.add(b.i);
      this.events.push({ t: +this._t.toFixed(1), k: 'branch', name: b.name, kind: b.kind });
      this.talk(b.kind === 'bottomless' ? '这条支洞没有人量过底——线到此为止，再往下全凭运气。' : b.kind === 'pocket' ? '支洞里有空气的味道——前面可能是气室。' : b.kind === 'dead' ? '岔路。多半是死路，进去要想好怎么出来。' : b.kind === 'crack' ? '这条岔道窄得只剩一条缝——钻得进半截，感觉顶住就立刻退，别硬挤。' : b.kind === 'loop' ? '岔路——听水声，像是往主线方向绕回去的。' : b.kind === 'room' ? '岔路尽头的灯照不到墙——前面是个厅。' : b.kind === 'mouth' ? '这条岔道一路上行，远处漏下来一线天光——像是另一口天窗。' : b.kind === 'climb' ? '岔道往上走，水声在后面变小——前头像是个干厅。' : b.kind === 'far' ? '岔道又窄又长，引绳到不了的地方——尽头隐约有风声。' : '一条没标在图上的支洞。');
    }
    // —— 非常规出口 ——
    this._exitSpot = null;
    for (const x of this.cave.altExits || []) {
      const d = p.pos.distanceTo(x.pos);
      if (x.kind === 'mouth') {
        if (d < x.r && p.inAir && this._t > 30) return this._startSurfacing({
          pos: x.pos, signal: true, ending: () => 'alt_exit',
          line: '顺光上浮——头顶不是进来的那口天窗，是另一个洞口。岸上静悄悄的，没人接应。',
        });
      } else if (p.onLand && d < x.r) {
        this._exitSpot = x;
        hud.hint(x.kind === 'climb' ? '头顶有条干缝透着风——按 E 卸下装备攀出去' : '旱厅离入口太远，装备背不出去——按 E 发信标呼救', 0.4);
      }
    }
    // 延迟结局：攀爬/呼救的收尾时间
    if (this._pendingEnd) {
      this._pendingEnd.t -= dt;
      if (this._pendingEnd.t <= 0) { const e = this._pendingEnd.ending; this._pendingEnd = null; return this._finish(e); }
    }
    if (p.gas < 45) warnOnce('gas1', '气表进红区了——现在每一口都要省着吸。');
    if (p.gas < 25) warnGate('gas0', 8, '最后一点气了——升水，或者找到人共用气源。');
    if (p.blackoutT > 0 && p.blackoutT < 5) warnOnce('lamp', tr('灯在拼命闪——它要灭了，先记住{lw}的方向。', { lw: this._lineWord }));

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

    // —— 出口检测：先出水，看一眼水面上的世界，等接应 ——
    const atExit = p.pos.distanceTo(this.cave.entryPos) < this.cave.entryR && p.pos.y > this.cave.entryPos.y - 0.5;
    if (atExit && this._t > 30) {
      if (this.exitT < 0) { this.exitT = 0; this.talk(this._ocean ? '潜水船就在头顶。做完停留再上。' : this._ice ? '冰洞的亮光在头顶。做完停留再上去。' : '出口的蓝光在头顶。做完停留再上去。'); }
      this.exitT += dt;
      // 洞潜出口是野外天坑：没人接应，出水后要自己发信号；海潜有船、冰潜有保障组、教学有教练——出水即收尾
      if (this.exitT > 3) return this._startSurfacing(this._ocean || this._ice || this.lesson ? { pos: this.cave.entryPos }
        : { pos: this.cave.entryPos, signal: true, line: '扒着坑边的石头爬出水面——树冠、鸟叫、太阳晃眼。岸上静悄悄的，没人在这儿等。' });
    } else this.exitT = -1;

    // —— 海面失联（海潜）：船看得见船边十米和橙色浮标，看不见浪尖上的一颗脑袋 ——
    if (this._ocean) {
      const atSurf = p.depth() < 1.0;
      const farBoat = p.pos.distanceTo(this.cave.entryPos) > this.cave.entryR;
      if (atSurf && farBoat) {
        if (this.smb) {
          this._pickupT = (this._pickupT || 0) + dt;
          if (this._pickupT > 1 && !W.pickup) { W.pickup = 1; this.talk('远处传来引擎声——你的橙色浮标被看到了，船朝你开过来了。'); }
          if (this._pickupT > 3.5) return this._startSurfacing({ pos: p.pos.clone(), boat: this.cave.entryPos, far: true, wait: Infinity, line: '浮上浪尖。橙色浮标在不远处一跳一跳，船的引擎声越来越近。' });
        } else {
          this.adriftT = (this.adriftT || 0) + dt;
          if (this.adriftT > 4) return this._startSurfacing({ pos: p.pos.clone(), boat: this.cave.entryPos, far: true, wait: Infinity, line: '浮上浪尖——海天线平得可怕，船在很远的地方变成一个点。' });
          warnGate('adrift', 14, '船看不见浪尖上的脑袋——放浮标（C）让它找你，或者潜下去沿锚绳回船。');
        }
      } else { this.adriftT = Math.max(0, (this.adriftT || 0) - dt * 0.5); this._pickupT = 0; }
    }

    // —— 出口方位标记（海潜=船 / 冰潜=冰洞）：开阔水里把"家"投到屏幕上 ——
    // navReq 的图不给屏幕标记——回程认路全靠罗盘 ◆
    if ((this._ocean || this._ice) && !this.map.navReq) {
      const dExit = p.pos.distanceTo(this.cave.entryPos);
      if (dExit > 9 && !atExit) {
        _v.copy(this.cave.entryPos).project(this.camera);
        let x = _v.x, y = _v.y;
        if (_v.z > 1) { x = -x; y = -y; }   // 出口在背后：标记推到屏幕边缘指着它
        let sx = x * 0.5 + 0.5, sy = 0.5 - y * 0.5;
        // 屏外（或背后）：缩到边缘，避开四角仪表区
        if (!(_v.z < 1 && sx > 0.11 && sx < 0.89 && sy > 0.18 && sy < 0.8)) {
          const k = Math.max(Math.abs(x) / 0.74, Math.abs(y) / 0.56, 1e-6);
          sx = Math.min(0.89, Math.max(0.11, (x / k) * 0.5 + 0.5));
          sy = Math.min(0.8, Math.max(0.18, 0.5 - (y / k) * 0.5));
        }
        hud.setExitMark(sx * innerWidth, sy * innerHeight,
          `${this._ocean ? tr('⇧ 船') : tr('⇧ 冰洞')} <span class="d">${Math.round(dExit)}m</span>`, this.objective.done);
      } else hud.setExitMark(null);
    } else hud.setExitMark(null);   // 洞潜没有开阔水出口标记，顺手清掉上一局残留

    this._recTrack(dt);
    // —— HUD ——
    hud.update(p, {
      turnGas: this.o.plan?.turnGas || 140,
      planDepth: this.o.plan?.planDepth || 0,
      objectiveText: this.objective.done
        ? (this._ocean ? tr('✓ 目标完成 —— 回潜水船浮出水面') : this._ice ? tr('✓ 目标完成 —— 回冰洞出水') : this.objective.statusText(this.uni))
          + ((this._ocean || this._ice) && !this.map.navReq ? ` <b>· ${Math.round(p.pos.distanceTo(this.cave.entryPos))}m</b>` : '')
        : this.objective.statusText(this.uni)
          + (this.cave.objectiveSpot && !this.map.navReq ? ` <b>· ${Math.round(p.pos.distanceTo(this.cave.objectiveSpot.pos))}m</b>` : ''),
      // 指北针：朝向带 + ◆ 指向出口(目标完成后)或目标点。navReq 的图这是唯一导航。
      compass: p.compass ? {
        h: ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360,
        wp: (() => { const tp = this.trainer?.compassTarget?.() || (this.objective.done ? this.cave.entryPos : this.cave.objectiveSpot?.pos || this.cave.entryPos);
          return Math.atan2(tp.x - p.pos.x, -(tp.z - p.pos.z)) * 180 / Math.PI; })(),
      } : null,
      manualBreath: manual,
      depthTarget: this.trainer?.depthTarget?.() || null,
      cold: this._ice ? this.cold : null,
      lineWord: this._lineWord,
    });
    hud.setLineInfo(p.hooked ? '挂着礁钩 —— 稳住了，再按 G 收钩'
      : this.lineHold ? tr('抓着{lw} —— 放松，顺绳回升', { lw: this._lineWord })
      : (p.onLine ? '' : (p.lineDist < 30 ? '' : tr('看不见{lw}了', { lw: this._lineWord }))));

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
      squeezes: this.cave.squeezes || [],
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
      hasReel: this.hasReel !== false,
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

  _deploySMB() {
    const hud = this.o.hud;
    if (this.hasSMB === false) { hud.hint('没带浮标——回装备间挂一个再下水', 2); return; }
    if (!this._ocean) { hud.hint(this._ice ? '冰盖下放不了浮标——跟着安全绳回冰洞' : '洞里用不上浮标——跟着引绳才对'); return; }
    if (this.smb) { hud.hint('浮标已经在水面上了'); return; }
    if (this.player.depth() < 3) { hud.hint('太浅了——下到 3 米以下再放，让它飞一会儿'); return; }
    this.smb = { t: 0 };
    const g = new THREE.Group();
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 9),
      new THREE.MeshStandardMaterial({ color: 0xff5a1a, roughness: 0.5, emissive: 0xd83a00, emissiveIntensity: 0.6 }));
    buoy.scale.set(1, 2.4, 1);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xd8d0c0 }));
    line.frustumCulled = false;
    g.add(buoy, line);
    this.scene.add(g);
    Object.assign(this.smb, { obj: g, buoy, line });
    this.talk('你放出浮标——橙色的球蹿上水面，细线还攥在你手里。');
    this.emit('smb', {});
    this.o.audio?.ok?.();
  }

  // 海潜挂钩：礁钩打进礁石/锚点，钩住强流里的身体
  _toggleHook() {
    const p = this.player, hud = this.o.hud;
    if (p.hooked) { p.hooked = null; this._hookLine?.removeFromParent(); this._hookLine = null; hud.hint('收钩，顺流走'); return; }
    const pts = this.cave.hookPoints || [];
    let best = null, bd = 4.5;
    for (const h of pts) { const d = p.pos.distanceTo(h.p); if (d < bd) { bd = d; best = h; } }
    if (!best) { hud.hint('够不到能挂钩的礁体——贴近大礁石、锚点或沉船再按 G'); return; }
    p.hooked = best.p;
    this._hookLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xd8c9a0 }));
    this._hookLine.frustumCulled = false;
    this.scene.add(this._hookLine);
    this.talk('礁钩咬进礁石，细绳一紧——水流从背上滑过去了。');
    this.o.audio?.ok?.();
  }

  _toggleLineHold() {
    if (this.lineHold) { this.lineHold = false; return; }
    // 海潜：附近有挂钩点 -> 挂钩优先（引绳是回家用的，不是稳流用的）
    if (this._ocean && (this.player.hooked || (this.cave.hookPoints || []).some(h => this.player.pos.distanceTo(h.p) < 4.5))) { this._toggleHook(); return; }
    const seg = this._nearestLineSeg();
    if (seg && seg.d < 1.4) {
      this.lineHold = true;
      this.o.hud.hint(this.o.input.isTouch ? tr('抓住了{lw}。松开摇杆，顺绳回升。', { lw: this._lineWord }) : tr('抓住了{lw}。松开方向键，顺绳回升。', { lw: this._lineWord }));
    } else this.o.hud.hint(tr('够不到{lw}', { lw: this._lineWord }));
  }

  _gesture(n) {
    const g = { 1: 'ok', 2: 'up', 3: 'help', 4: 'line', 5: 'light' }[n];
    if (!g) return;
    this.onGesture?.(g);
    this.avatar?.gesture(g);
    this.hand?.show(g);
    this.emit('gesture', { g });
    this.talk({ ok: '你比了个 OK', up: '你竖拇指指了指上面', help: '你猛挥手求救', line: tr('你指了指{lw}', { lw: this._lineWord }), light: '你晃了晃手里的灯' }[g]);
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
    // 海面空瓶：头顶没有岩顶，漂着不算死——但船找不到你就是另一回事了
    if (id === 'out_of_air' && this._ocean && this.player.depth() < 1.6) {
      this.player.noGas = true;
      this.player.dead = null;
      this.talk('气瓶空了——好在这里是海，你还能浮在水面。游回船边，或者放浮标（C）等人看见你。');
      return;
    }
    // 应急瓶：主瓶见底的最后一次机会（45bar，用一次就没）
    if (id === 'out_of_air' && this.pony > 0) {
      this.pony--; this.player.gas = 45; this.player.dead = null;
      this.talk('主瓶嘶嘶地空了——应急瓶接上，最后 45 bar。回家。');
      return;
    }
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
    // 潜伴还在洞里的泥沙里丢着你就出水了——这是buddy_lost，不是"惊险生还"
    if (this.buddyLost || this.buddy?.lost) return 'buddy_lost';
    const rough = p.gas < 40 || p.panic > 0.5;
    return rough ? 'survived_rough' : 'survived';
  }

  // 出水点 -> 水面世界（懒构建，死后结算不浪费）。boatPos：船实际在哪（漂远了出水时船在天际线那头）
  _surfaceAt(pos, boatPos, entryR) {
    this._surfCache = this._surfCache || new Map();
    const key = `${Math.round(pos.x)}_${Math.round(pos.z)}`;
    if (!this._surfCache.has(key)) {
      const w = buildSurface(this.map, this.uni, pos, boatPos, entryR ?? this.cave.entryR);
      this.scene.add(w.group);
      this._surfCache.set(key, w);
    }
    return this._surfCache.get(key);
  }

  // 出水流程：从水里抬头 -> 扒上水面的点 -> 看一眼天 -> 接应结算
  _startSurfacing(exitDef) {
    if (this.surfaced || this.ended) return;
    const world = this._surfaceAt(exitDef.pos, exitDef.boat);
    world.group.visible = true;
    this.cave.group.visible = false;          // 水下世界的岩壳会包住站位——出水后只留水面世界
    for (const sf of this.cave.surfaces) sf.visible = false;
    this.surfaced = {
      t: 0, kind: world.kind, far: !!exitDef.far, signal: !!exitDef.signal,
      from: this.player.pos.clone(), to: world.standPos,
      yaw: world.face ?? this.player.yaw, pitch: 0.18,
      // 救生哨让岸上接应来得快一些
      wait: (exitDef.wait ?? 7) * (this.loadout?.whistle ? 0.6 : 1), signaled: 0, signalT: 0,
      ending: exitDef.ending || (() => this._exitEnding()),
      world,
    };
    this.talk(exitDef.line || (world.kind === 'ocean'
      ? '扒住船尾梯翻过身——海天线亮得睁不开眼。接应到了，回家。'
      : world.kind === 'ice'
        ? '翻上冰面，冷空气第一口就把肺扎醒了。接应的人正朝这边来。'
        : '扒着坑边的石头爬出水面——头顶是树冠和天光。回到人间了。'), 6);
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
