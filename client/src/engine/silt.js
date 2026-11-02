// 泥沙系统：游戏标题的另一半。踢水/近底/事故都会搅起泥沙云，
// 云内能见度骤降，是"泥沙迷路"结局的物质基础。
import * as THREE from 'three';
import { softSprite } from './water.js';

const MAX_CLOUDS = 24;
const PER_CLOUD = 90;

export class SiltSystem {
  constructor(scene) {
    this.scene = scene;
    this.clouds = []; // {p, r, density, pts, data}
    const g = new THREE.BufferGeometry();
    const total = MAX_CLOUDS * PER_CLOUD;
    this.pos = new Float32Array(total * 3).fill(-9999);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      map: softSprite(), color: 0x7a6a50, size: 0.85, transparent: true, opacity: 0.22,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._t = 0;
    this._free = [];
    for (let i = 0; i < MAX_CLOUDS; i++) this._free.push(i);
    this.slots = new Array(MAX_CLOUDS).fill(null);
  }

  // 搅起一团泥沙
  burst(pos, strength = 1, radius = 2.2) {
    let slot;
    if (this._free.length) slot = this._free.pop();
    else { // 回收最淡的一团
      let oldest = 0, od = Infinity;
      this.slots.forEach((c, i) => { if (c && c.density < od) { od = c.density; oldest = i; } });
      slot = oldest;
    }
    if (this.slots[slot]) this._clearSlot(slot);
    const cloud = { slot, p: pos.clone(), r: radius * strength, density: Math.min(1.6, 0.6 * strength + 0.5), vel: [] };
    const base = slot * PER_CLOUD;
    for (let i = 0; i < PER_CLOUD; i++) {
      const idx = base + i;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * cloud.r, h = (Math.random() - 0.5) * cloud.r;
      this.pos[idx * 3] = pos.x + Math.cos(a) * rr;
      this.pos[idx * 3 + 1] = pos.y + h * 0.6;
      this.pos[idx * 3 + 2] = pos.z + Math.sin(a) * rr;
      cloud.vel.push((Math.random() - 0.5) * 0.14, -Math.random() * 0.05 - 0.02, (Math.random() - 0.5) * 0.14);
    }
    this.slots[slot] = cloud;
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  _clearSlot(slot) {
    const base = slot * PER_CLOUD;
    for (let i = 0; i < PER_CLOUD; i++) this.pos[(base + i) * 3 + 1] = -9999;
    this.slots[slot] = null;
    this._free.push(slot);
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  // 位置处的泥沙浓度 0..1 —— 玩家在里面就是"盲潜"
  densityAt(pos) {
    let d = 0;
    for (const c of this.slots) {
      if (!c) continue;
      const dist = pos.distanceTo(c.p);
      if (dist < c.r * 1.6) d = Math.max(d, c.density * (1 - dist / (c.r * 1.6)));
    }
    return Math.min(1, d);
  }

  update(dt) {
    this._t += dt;
    let dirty = false;
    for (const c of this.slots) {
      if (!c) continue;
      c.density -= dt * 0.008; // 慢慢沉降
      if (c.density <= 0.05) { this._clearSlot(c.slot); continue; }
      const base = c.slot * PER_CLOUD;
      for (let i = 0; i < PER_CLOUD; i++) {
        const idx = base + i;
        this.pos[idx * 3] += c.vel[i * 3] * dt + Math.sin(this._t + i) * dt * 0.02;
        this.pos[idx * 3 + 1] += c.vel[i * 3 + 1] * dt;
        this.pos[idx * 3 + 2] += c.vel[i * 3 + 2] * dt;
      }
      dirty = true;
    }
    if (dirty) this.points.geometry.attributes.position.needsUpdate = true;
    
  }
}
