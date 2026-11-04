// 潜水员：游泳物理 + 生理模型（气量/深度/氮醉/惊慌/减压/上升速度）。
// 参考站玩法压缩版：一局 ~10-20 分钟，规则照现实做，时间压缩。
import * as THREE from 'three';
import { range } from '@fundive/shared/rng.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _qy = new THREE.Quaternion(), _e = new THREE.Euler();

// 简化免减压表（分钟）：depth m -> NDL
const NDL = [[6, 999], [9, 330], [12, 147], [15, 98], [18, 56], [21, 45], [24, 37], [27, 31], [30, 26], [35, 18], [40, 14], [45, 10], [50, 8], [60, 6], [80, 4]];
function ndlAt(d) {
  if (d <= NDL[0][0]) return NDL[0][1];
  for (let i = 1; i < NDL.length; i++) {
    if (d <= NDL[i][0]) {
      const [d0, t0] = NDL[i - 1], [d1, t1] = NDL[i];
      return t0 + (t1 - t0) * (d - d0) / (d1 - d0);
    }
  }
  return 3;
}

export class Player {
  constructor(spawn) {
    this.pos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.gas = 210;              // bar
    this.gasMax = 210;           // 满瓶量（深图背双瓶，session 按地图覆盖）
    this.maxDepth = 0;
    this.time = 0;
    this.ndlUsed = 0;            // 0..1 累积氮负荷
    this.decoOwed = 0;           // 需要的减压停留秒数
    this.narcosis = 0;
    this.panic = 0;
    this.heart = 62;
    this.ascRate = 0;            // m/s 上升速度（正=上升中）
    this._lastDepth = 0;
    this.onLine = false;
    this.lineDist = Infinity;
    this.lightOn = true;
    this.backupOn = false;
    this.kickCd = 0;
    this.inAir = false; this.domeBad = false; this.airT = 0;   // 气室
    this.onLand = false; this._dry = null;                     // 气室干岸上走动
    this.hooked = null;                                        // 礁钩挂住的点（海潜）
    this.inCurrent = null;                                     // 当前所在的强流区
    this.compass = true;                                       // 指北针：常驻装备，夹在仪表上
    this.carryWeight = 0;        // 打捞物负重
    this.towing = false;         // 拖带被困者
    this.freeflow = 0;           // 自由流剩余秒数
    this.blackoutT = -1;         // 灯故障倒计时
    this.stuckT = 0;             // 卡在窄缝的秒数
    this.dead = null;            // ending id
    this.stirScore = 0;          // 搅了多少沙（结算用）
    this.noGas = false;          // 海面空瓶漂浮：不再判气尽，但下潜仍会死
    this._fastAsc = 0;           // 上升超速秒数（欠减压债中）
    this._wildAsc = 0;           // 火箭式上升秒数（要判死）
    this.buoy = 0;               // BCD 浮力 -1..1（B 充 / V 放）
    this.maskOff = false;        // 面镜已摘下（教学）
    this.maskWater = 0;          // 面镜内积水 0..1（教学）
    this.regOut = false;         // 二级头拿开了（教学）
    this.regOutT = 0;            // 憋气时长（教学）
    this.lung = 0.55;            // 肺量 0..1（手动呼吸模式由 I/U 控制）
    this._breathHold = 0;        // 憋气/没气计时
  }

  ata() { return 1 + this.depth() / 10; }
  depth() { return Math.max(0, -this.pos.y); }

  // input: {mx,mz, kick, slow}
  update(dt, input, ctx) {
    const { nav, silt, uni, audio, fx } = ctx;
    this.time += dt;
    const depth = this.depth();
    this.maxDepth = Math.max(this.maxDepth, depth);

    // —— 游动 ——
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    _f.set(input.mx, 0, -input.mz).applyQuaternion(q);
    const burden = 1 - Math.min(0.4, this.carryWeight * 0.06) - (this.towing ? 0.45 : 0);
    if (this.onLand) {
      // 岸上步行：浮力/水流/氮醉都不管你——只管走。走出岸沿就跌回水里。
      _f.set(input.mx, 0, -input.mz).applyQuaternion(_qy.setFromEuler(_e.set(0, this.yaw, 0, 'YXZ')));
      const spd = input.slow ? 0.55 : 1.35;
      this.vel.x = _f.x * spd; this.vel.z = _f.z * spd;
      this.vel.y = Math.max(this.vel.y - 14 * dt, -8);
      this.buoy = 0;
    } else {
    const thrust = (input.kick ? 9.5 : input.frog ? 5.0 : 4.2) * Math.max(0.3, burden);
    this.vel.addScaledVector(_f, thrust * dt);
    // 水流：stream=定向激流，cross=会变向的暗流，washer=打转+上下抛的洗衣机流。
    // 挂钩(hooked)时水流推不动你——这正是挂钩的意义。
    for (const z of ctx.flowZones) {
      const dz = this.pos.distanceTo(z.pos);
      if (dz > z.r * 2) continue;
      const edge = 1 - Math.min(1, dz / (z.r * 2));             // 越往里越吃流
      const s = (z.strength ?? 1) * (uni.mods.flow ?? 1) * 0.8 * edge;
      if (this.hooked) continue;
      if (z.type === 'washer') {
        const ang = this.time * 2.1 + (z.pos.x + z.pos.z) * 0.1;
        _v2.set(Math.cos(ang), Math.sin(ang * 1.35) * 0.45, Math.sin(ang)).normalize();
        this.vel.addScaledVector(_v2, dt * s);
        this.vel.y += Math.sin(ang * 0.7) * dt * s * 0.5;        // 上下抛
      } else if (z.type === 'cross') {
        const ph = Math.tanh(Math.sin((this.time / (z.period || 22)) * Math.PI * 2) * 2);
        this.vel.addScaledVector(z.dir, dt * s * ph);            // 方向慢慢倒转
      } else {
        this.vel.addScaledVector(z.dir, dt * s);
      }
    }
    this.inCurrent = null;
    for (const z of ctx.flowZones) {
      if (z.type && this.pos.distanceTo(z.pos) < z.r * 1.15) { this.inCurrent = z; break; }
    }
    // 氮醉 => 输入漂移
    if (this.narcosis > 0.3) {
      this.vel.x += Math.sin(this.time * 1.7) * this.narcosis * dt * 0.8;
      this.vel.z += Math.cos(this.time * 1.3) * this.narcosis * dt * 0.8;
    }
    // 惊慌 => 乱蹬
    if (this.panic > 0.7) this.vel.addScaledVector(_v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5), dt * 4);
    // —— 呼吸 ——
    if (ctx.manualBreath) {
      // 手动：I 吸气 / U 呼气；满肺硬憋或空肺硬憋都会慌
      if (input.brIn) this.lung = Math.min(1, this.lung + dt * 1.15);
      else if (input.brOut) this.lung = Math.max(0, this.lung - dt * 1.35);
      const starving = this.lung < 0.08 || (this.lung > 0.97 && !input.brOut);
      this._breathHold = starving ? this._breathHold + dt : 0;
      if (this._breathHold > 4) this.panic = Math.min(1, this.panic + dt * 0.12);
    } else {
      this.lung = 0.55 + Math.sin(this.time * 1.7) * 0.38;
    }

    // BCD 浮力：B 充 / V 放。浮力是持续作用的"加速度"（垂直方向阻尼小、限速独立），
    // 放气后会越沉越快而不是匀速下沉；肺量同样顶一点浮力（呼吸微调是真的）。
    this.buoy = THREE.MathUtils.clamp(this.buoy + (input.bcd || 0) * dt * 0.9 - this.buoy * dt * 0.05, -1, 1);
    this.vel.y += (this.buoy * 2.4 + (this.lung - 0.55) * (ctx.manualBreath ? 1.6 : 0.55)) * dt;
    const damp = Math.exp(-dt * 1.9);
    this.vel.x *= damp; this.vel.z *= damp;
    this.vel.y *= Math.exp(-dt * 0.8);
    const maxV = (input.kick ? 2.6 : input.frog ? 1.7 : 1.5) * Math.max(0.3, burden);
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > maxV) { const s = maxV / hv; this.vel.x *= s; this.vel.z *= s; }
    const maxVy = maxV + Math.abs(this.buoy) * 1.7 + Math.abs(this.lung - 0.55) * 1.2;
    this.vel.y = THREE.MathUtils.clamp(this.vel.y, -maxVy, maxVy);
    }
    this.pos.addScaledVector(this.vel, dt);

    // 上升速度监测
    const dDepth = (depth - this._lastDepth) / Math.max(dt, 1e-4);
    this._lastDepth = depth;
    this.ascRate = -dDepth;

    // —— 大件装饰障碍（巨石/石柱/礁石）：先从障碍物里出来，再夹回通道 ——
    for (const o of nav.obstacles || []) {
      let cx, cy, cz;
      if (o.a) {   // 胶囊：最近点在轴线上
        _v.subVectors(o.b, o.a);
        const tt = THREE.MathUtils.clamp(_f.subVectors(this.pos, o.a).dot(_v) / Math.max(1e-6, _v.lengthSq()), 0, 1);
        cx = o.a.x + _v.x * tt; cy = o.a.y + _v.y * tt; cz = o.a.z + _v.z * tt;
      } else { cx = o.p.x; cy = o.p.y; cz = o.p.z; }
      const rr = o.r + 0.42;
      const dx = this.pos.x - cx, dy = this.pos.y - cy, dz = this.pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        this.pos.set(cx + dx / d * rr, cy + dy / d * rr, cz + dz / d * rr);
        _v.set(dx / d, dy / d, dz / d);
        const vn = this.vel.dot(_v);
        if (vn < 0) this.vel.addScaledVector(_v, -vn * 1.02);
      }
    }

    // —— 碰撞：夹在通道内 ——
    const hit = this.onLand ? false : nav.clamp(this.pos, 0.45);   // 岸上不套通道夹具，靠岸沿半径管住脚步
    const near = nav.closest(this.pos);
    if (hit) {
      // 只削掉顶进墙里的法向分量——切向速度和浮力沉降不受"贴墙"影响，
      // 这样 BCD 放气后在任何地方下沉都是加速而不是被阻尼按成匀速。
      _v.subVectors(this.pos, near.p).normalize();
      const vn = this.vel.dot(_v);
      if (vn > 0) this.vel.addScaledVector(_v, -vn * 1.05);
      this.vel.multiplyScalar(0.92);
    }

    // 水面约束：只有入口/气室能浮到水面；洞穴段头顶是岩顶。
    // 渲染的水面在 y=-0.35——人最多浮到略低于水线（眼睛露出水面前），BCD 不能把人顶出水面飞上天。
    const inPocket = ctx.pockets.some(p => this.pos.distanceTo(p.pos) < p.r) || this.pos.distanceTo(ctx.entryPos) < ctx.entryR;
    const ceiling = inPocket ? -0.45 : -0.6;
    // 气室：水线以上是空气，浮到水线就停；头出水面才算"在气室里"。气室里不套通用顶板——水线可以高过 -0.45。
    const dome = ctx.pockets.find(d => Math.hypot(this.pos.x - d.cx, this.pos.z - d.cz) < d.R && this.pos.y > d.waterY - 1.5 && this.pos.y < d.waterY + 3.5);
    if (!this.onLand && !dome && this.pos.y > ceiling) { this.pos.y = ceiling; if (this.vel.y > 0) this.vel.y = 0; }
    // —— 干岸：气室里能爬上去走动的岸石（dome.dry）——
    if (this.onLand) {
      const dr = this._dry;
      const dh = dr ? Math.hypot(this.pos.x - dr.x, this.pos.z - dr.z) : Infinity;
      if (!dome || !dr || dh > dr.r) { this.onLand = false; this._dry = null; }   // 走出岸沿/离开气室 -> 跌回水里
      else {
        const gy = dr.y + 1.45;                     // 站立视点高
        if (this.pos.y <= gy) { this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; }
      }
    } else if (dome?.dry) {
      const dr = dome.dry;
      if (Math.hypot(this.pos.x - dr.x, this.pos.z - dr.z) < dr.r * 0.85 && this.pos.y > dome.waterY - 0.4) {
        this.onLand = true; this._dry = dr;
        this.pos.y = dr.y + 1.45; this.vel.set(0, 0, 0);
        ctx.talk?.('扒着岸石爬出水面——脚下是干石头。可以走两步活动下腿，走回水边就能再下去。');
      }
    }
    if (dome && !this.onLand && this.pos.y > dome.waterY + 0.12) { this.pos.y = dome.waterY + 0.12; if (this.vel.y > 0) this.vel.y = 0; }
    this.inAir = !!dome && (this.pos.y > dome.waterY - 0.25 || this.onLand);
    this.domeBad = this.inAir && dome.bad;
    this.airT = this.inAir ? (this.airT || 0) + dt : this.airT || 0;

    // —— 搅沙：踢水近底 / 泥沙区 ——
    const nearFloor = near.clearance < near.r * 0.5 && this.vel.y > -0.5;
    const inSiltZone = ctx.siltZones.some(z => this.pos.distanceTo(z.pos) < z.r);
    if (input.kick && this.kickCd <= 0 && (nearFloor || inSiltZone) && this.vel.length() > 0.6) {
      silt.burst(this.pos.clone().addScaledVector(_f, -0.5).add(_v.set(0, -0.4, 0)), inSiltZone ? 1.4 : 0.8);
      this.stirScore += 1;
      audio?.silt();
      this.kickCd = 1.2;
      fx?.emit('silt', { p: this.pos.toArray() });
    }
    this.kickCd -= dt;

    // 窄缝卡人：缝里硬挤会卡住
    if (near.r < 1.0 && this.vel.length() > 1.4) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 4) return this.die('stuck', ctx);

    // —— 气量 ——
    const sac = 0.085 * this.ata() * (1 + (input.kick ? 0.9 : 0)) * (1 + this.panic * 1.6) * (this.towing ? 1.5 : 1);
    let drain = this.inAir && !this.domeBad ? 0 : sac * dt;   // 气室里摘掉二级头，吸洞里的空气
    if (this.freeflow > 0) { this.freeflow -= dt; drain += 0.9 * this.ata() * dt; }
    this.gas -= drain;
    if (this.gas <= 0) { this.gas = 0; if (!this.noGas || this.depth() > 2.5) return this.die(this.freeflow > 0 ? 'freeflow' : 'out_of_air', ctx); }

    // —— 氮负荷 ——
    const ndl = ndlAt(depth);
    this.ndlUsed += dt / (ndl * 60);
    if (depth < 6) this.ndlUsed = Math.max(0, this.ndlUsed - dt / 120); // 浅水缓慢释放
    if (this.ndlUsed > 1) this.decoOwed = Math.min(120, this.decoOwed + dt * 2);
    if (this.decoOwed > 0 && depth < 6) this.decoOwed = Math.max(0, this.decoOwed - dt); // 停留中消化

    // —— 氮醉：24m 起缓慢爬坡，曲线放缓 + 宇宙系数减半（之前深图几乎必醉必死） ——
    this.narcosis = THREE.MathUtils.clamp((depth - 24) / 38, 0, 1) * (uni.mods.narcosis || 0);
    // —— 惊慌 ——
    const siltD = silt.densityAt(this.pos);
    let stress = 0;
    if (siltD > 0.4 && depth > 6) stress += 0.16;
    if (!this.onLine && depth > 8 && ctx.lineBroken) stress += 0.12;
    if (this.gas < 50 && !this.inAir) stress += 0.1;
    if (this.inAir) stress += this.domeBad ? 0.12 : -0.3;
    if (this.freeflow > 0) stress += 0.3;
    if (this.noGas) stress += 0.12;
    if (!this.lightOn && !this.backupOn) stress += 0.25;
    if (ctx.buddyLost) stress += 0.2;
    this.panic = THREE.MathUtils.clamp(this.panic + (stress - 0.08) * dt, 0, 1);
    if (this.panic >= 1) return this.die('panic', ctx);
    this.heart = 58 + depth * 0.35 + this.panic * 80 + (input.kick ? 25 : 0) + this.narcosis * 15;

    // —— 设备事故 ——
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      if (this.blackoutT <= 0) { this.lightOn = false; audio?.clunk?.(); }
    }
    if (this.lightOn === false && !this.backupOn && depth > 8 && this.time > 60) {
      // 抹黑太久 -> 迷路风险由 onLine/silt 逻辑放大
    }

    // 上升过快：>0.5m/s 开始欠减压债（出水前浅水停留还清），>1.0m/s 持续 4s 直接判减压病。
    // 快升换的是时间债不是命——深井回程才有"快/慢都走得通"的解。
    if (depth > 8 && this.ascRate > 0.5) {
      this._fastAsc += dt;
      this.decoOwed = Math.min(120, this.decoOwed + (this.ascRate - 0.5) * dt * 2.5);
    } else this._fastAsc = Math.max(0, this._fastAsc - dt * 1.5);
    if (depth > 8 && this.ascRate > 1.0) this._wildAsc += dt; else this._wildAsc = 0;
    if (this._wildAsc > 4) return this.die('deco_hit', ctx);
  }

  // 自由流故障（宇宙特性触发）
  triggerFreeflow(audio) {
    if (this.freeflow <= 0) { this.freeflow = 8; audio?.hiss?.(); }
  }
  // 灯故障
  triggerBlackout() { if (this.lightOn && this.blackoutT < 0) this.blackoutT = range(Math.random, 20, 70); }

  die(id, ctx) {
    if (this.dead) return;
    this.dead = id;
    ctx?.onDeath?.(id);
    return id;
  }
}
