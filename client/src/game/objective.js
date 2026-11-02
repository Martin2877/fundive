// 目标系统：探索标记 / 指定拍摄 / 打捞回收 / 搜救拖带。
import * as THREE from 'three';
import { spName } from '@fundive/shared/maps.js';
import { t } from '@fundive/shared/i18n.js';
import { makeVictim } from '../engine/diver.js';

const _v = new THREE.Vector3();

export class Objective {
  constructor(scene, uni, cave) {
    this.uni = uni;
    this.type = uni.objective.type;
    this.done = false;
    this.progress = '';
    this.targetObj = null;   // 可互动物体
    this.victim = null;
    const spot = cave.objectiveSpot;

    if (this.type === 'explore') {
      // 标记石：一个小石堆 + 微光
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.9 });
      [[0, 0, 0.3], [0.1, 0.22, 0.22], [-0.08, 0.4, 0.16]].forEach(([x, y, r]) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), mat);
        s.position.set(x, y, 0); s.scale.y = 0.6; g.add(s);
      });
      // 石堆上插一枚发光的洞潜方向标（cookie），十几米外就能看见
      const cookie = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.3, 5),
        new THREE.MeshBasicMaterial({ color: 0x9ff4f4 })
      );
      cookie.position.y = 0.78;
      g.add(cookie);
      const glow = new THREE.PointLight(0x7fe9ea, 7, 12);
      glow.position.y = 0.7;
      g.add(glow);
      g.position.copy(spot.pos).add(_v.set(0.8, -spot.r * 0.5, 0.8));
      scene.add(g);
      this.targetObj = g;
      this.prompt = '摸到标记石';
    } else if (this.type === 'salvage') {
      const item = uni.objective.item;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x554e44, roughness: 0.5, metalness: 0.5, emissive: item.glow, emissiveIntensity: 0.4 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.2), mat);
      g.add(box);
      const gl = new THREE.PointLight(item.glow, 5, 9);
      g.add(gl);
      g.position.copy(spot.pos).add(_v.set(-0.7, -spot.r * 0.5, -0.6));
      scene.add(g);
      this.targetObj = g;
      this.item = item;
      this.prompt = t('打捞 {n}', { n: t(item.name) });
    } else if (this.type === 'rescue') {
      this.victim = makeVictim();
      this.victim.position.copy(spot.pos).add(_v.set(0.5, -spot.r * 0.45, 0.5));
      this.victim.rotation.y = Math.random() * 6;
      scene.add(this.victim);
      this.targetObj = this.victim;
      this.victimDef = uni.objective.victim;
      this.prompt = t('接近 {n}', { n: t(uni.objective.victim.name) });
      this.towOff = new THREE.Vector3();
    }
  }

  // 每帧检查：返回 hint 文本或 null
  update(dt, ctx) {
    const { player, talk } = ctx;
    if (this.done) return null;

    switch (this.type) {
      case 'explore': {
        if (this._near(player, 1.4)) {
          this.done = true;
          talk?.('你摸了摸标记石。回去吧，别贪。');
          ctx.audio?.ok?.();
          ctx.fx?.emit('objective', { done: true });
        }
        break;
      }
      case 'photo': {
        const got = ctx.photos.shots.find(s => s.sp === this.uni.objective.species && s.stars >= this.uni.objective.quality);
        if (got) {
          this.done = true;
          talk?.(t('任务照到手：{n} {s}', { n: spName(this.uni.objective.species), s: '★'.repeat(got.stars) }));
          ctx.fx?.emit('objective', { done: true });
        }
        break;
      }
      case 'salvage': {
        if (!player.carryWeight && this._near(player, 1.4)) {
          return '按 E 捞起';
        }
        if (player.carryWeight > 0) {
          this.progress = '带回出口';
          if (ctx.atExit) { this.done = true; ctx.fx?.emit('objective', { done: true }); }
        }
        break;
      }
      case 'rescue': {
        if (!player.towing && this._near(player, 1.6)) {
          return '按 E 挂上拖带';
        }
        if (player.towing && this.victim) {
          // 被困者跟在你侧后方
          this.victim.position.lerp(_v.copy(player.pos).add(new THREE.Vector3(Math.sin(player.yaw + 0.8) * 1.1, -0.2, Math.cos(player.yaw + 0.8) * 1.1)), Math.min(1, dt * 3));
          this.victim.userData.update(dt, 0.5);
          if (ctx.atExit) { this.done = true; ctx.fx?.emit('objective', { done: true }); }
        }
        break;
      }
    }
    return null;
  }

  interact(ctx) {
    const { player } = ctx;
    if (this.done) return;
    if (this.type === 'salvage' && !player.carryWeight && this._near(player, 1.4)) {
      player.carryWeight = this.item.w;
      this.targetObj.visible = false;
      ctx.talk?.(t('捞到了：{n}。它比看上去沉。', { n: t(this.item.name) }));
      ctx.audio?.pickup?.();
      ctx.fx?.emit('pickup', { item: this.item.id });
    }
    if (this.type === 'rescue' && !player.towing && this._near(player, 1.6)) {
      player.towing = true;
      ctx.talk?.(t('{n}抓住了你的拖带。慢—慢—来。', { n: t(this.victimDef.name) }));
      ctx.audio?.ok?.();
      ctx.fx?.emit('rescue_on', {});
    }
  }

  _near(player, d) {
    return this.targetObj && player.pos.distanceTo(this.targetObj.position) < d;
  }

  statusText(uni) {
    const o = uni.objective;
    if (this.done) return t('✓ 目标完成 —— 回出口');
    switch (o.type) {
      case 'explore': return t('目标：抵达「{p}」标记石', { p: t(o.place) });
      case 'photo': return t('目标：拍到 {n} ≥{q}★', { n: spName(o.species), q: o.quality });
      case 'salvage': return t('目标：打捞 {n}', { n: t(o.item.name) }) + (this.progress ? `（${t(this.progress)}）` : '');
      case 'rescue': return t('目标：找到并拖出 {n}', { n: t(o.victim.name) });
      default: return '';
    }
  }
}
