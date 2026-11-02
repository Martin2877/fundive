// AI 潜伴：跟在你侧后方游，灯朝前；会打手势、会在泥沙里走丢、断线时帮你找线。
import * as THREE from 'three';
import { makeDiver } from '../engine/diver.js';
import { range, chance } from '@fundive/shared/rng.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

export class Buddy {
  constructor(scene, spawn, name = '潜伴') {
    this.obj = makeDiver({ suit: 0x22333f, trim: 0xffd27f, name, arm: true });
    this.obj.position.copy(spawn).add(_v.set(1.6, 0.2, 0.6));
    scene.add(this.obj);
    this.vel = new THREE.Vector3();
    this.lost = false;          // 是否走丢
    this.lostT = 0;
    this.gestureT = range(Math.random, 20, 40);
    this.helpingLine = 0;       // 正在帮你找线
    this.dead = false;
  }

  update(dt, ctx) {
    const { player, nav, silt, uni, talk } = ctx;
    if (this.dead) return;
    this.obj.userData.update(dt, this.vel.length());

    // —— 走丢逻辑 ——
    if (!this.lost) {
      const siltHere = silt.densityAt(this.obj.position);
      const distP = this.obj.position.distanceTo(player.pos);
      if (siltHere > 0.55 && distP > 5 && chance(Math.random, dt * 0.06)) {
        this.lost = true; this.lostT = range(Math.random, 25, 60);
        ctx.setBuddyLost?.(true);
        talk?.('泥沙里，潜伴的灯一晃就不见了');
      }
    } else {
      this.lostT -= dt;
      // 灯在远处雾里慢慢隐现（~0.4Hz 慢闪），不做逐帧频闪
      this.obj.visible = Math.sin(this.lostT * 2.4) > -0.45;
      // 游向随机方向
      if (this.lostT <= 0) { this.lost = false; this.obj.visible = true; ctx.setBuddyLost?.(false); talk?.('潜伴的灯又从雾里冒出来了'); }
      return;
    }

    // —— 跟随目标：玩家前方 2.4m 偏右 ——
    _t.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    const target = _v.copy(player.pos)
      .addScaledVector(_t, 2.0)
      .add(_t.set(0.9, 0.15, 0));

    // 断线时：去最后一个线点找线
    if (ctx.lineBroken && ctx.lineGapPos && this.helpingLine <= 0 && player.pos.distanceTo(ctx.lineGapPos) < 8) {
      this.helpingLine = 18;
      talk?.('潜伴比了个手势：线断了，我去找');
    }
    if (this.helpingLine > 0) {
      this.helpingLine -= dt;
      target.copy(ctx.lineGapPos).add(_t.set(0, -0.5, 0));
    }

    const dir = _t.subVectors(target, this.obj.position);
    const dist = dir.length();
    const speed = THREE.MathUtils.clamp(dist * 1.2, 0.4, 3.2);
    if (dist > 0.3) {
      dir.normalize();
      this.vel.lerp(dir.multiplyScalar(speed), 1 - Math.exp(-dt * 3));
    } else this.vel.multiplyScalar(Math.exp(-dt * 4));
    this.obj.position.addScaledVector(this.vel, dt);
    nav.clamp(this.obj.position, 0.4);

    // 朝向：游动方向 or 玩家方向
    if (this.vel.lengthSq() > 0.05) {
      const yaw = Math.atan2(-this.vel.z, this.vel.x) - Math.PI / 2;
      this.obj.rotation.y += (yaw - this.obj.rotation.y) * Math.min(1, dt * 4);
    }

    // —— 偶发手势：抬手比出对应手型 + 文字说明 ——
    this.gestureT -= dt;
    if (this.gestureT <= 0 && dist < 6) {
      this.gestureT = range(Math.random, 30, 70);
      const gs = [['ok', '潜伴比了个 OK'], ['line', '潜伴指了指前面'], ['palm', '潜伴比了个"慢一点"'], ['point', '潜伴敲了敲气瓶']];
      const [gName, gText] = gs[Math.floor(Math.random() * gs.length)];
      this.obj.userData.gesture?.(gName, 2.2);
      talk?.(gText);
      ctx.audio?.ok?.();
    }
  }
}
