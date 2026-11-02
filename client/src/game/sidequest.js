// 支线机缘：手记 / 遗落物 / 求助潜水员。位置与种类由 uni.sides 决定（联机各端一致）。
import * as THREE from 'three';
import { makeVictim } from '../engine/diver.js';
import { STORY, SIDE_ITEMS, SIDE_PROMPT } from '@fundive/shared/story.js';
import { t } from '@fundive/shared/i18n.js';
import { store } from './storage.js';

const _v = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class SideQuests {
  constructor(scene, uni, cave, map) {
    this.map = map;
    this.items = [];
    for (const s of uni.sides || []) {
      const node = cave.nodes[s.node] || cave.nodes[1];
      let base = node.pos.clone(), r = node.r;
      if (s.branch != null) { const b = cave.branchInfo.find(x => x.i === s.branch); if (b) { base = b.end.clone().lerp(b.entry, 0.12); r = 2; } }
      const wp = cave.wallPoint(base, _v.set(0.3, -1, 0.2), 0.05);
      const pos = (wp ? wp.pos : base.clone().add(_v.set(0, -r * 0.5, 0))).clone();
      pos.y += 0.15;
      const g = this._make(s, pos);
      scene.add(g);
      this.items.push({ ...s, pos, obj: g, done: false });
    }
  }

  _make(s, pos) {
    const g = new THREE.Group();
    const col = s.kind === 'note' ? 0xffd27f : s.kind === 'item' ? 0x9fe8c0 : 0xff7f6f;
    if (s.kind === 'distress') {
      const v = makeVictim(); v.scale.setScalar(1); g.add(v);
      g.userData.v = v;
    } else {
      const m = new THREE.Mesh(
        s.kind === 'note' ? new THREE.BoxGeometry(0.22, 0.03, 0.3) : new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.6, emissive: col, emissiveIntensity: 0.5 }));
      g.add(m);
    }
    const l = new THREE.PointLight(col, s.kind === 'distress' ? 4 : 3, 7);
    l.position.y = 0.4; g.add(l); g.userData.light = l;
    g.position.copy(pos);
    return g;
  }

  _near(p, d = 2.2) { return this.items.find(i => !i.done && i.pos.distanceTo(p.pos) < d); }

  update(dt, ctx) {
    this.t = (this.t || 0) + dt;
    for (const i of this.items) {
      if (i.done) continue;
      i.obj.userData.light.intensity = (i.kind === 'distress' ? 3 : 2.4) + Math.sin(this.t * (i.kind === 'distress' ? 6 : 2)) * 1.2;
    }
    const n = this._near(ctx.player);
    return n ? SIDE_PROMPT[n.kind] : null;
  }

  // 返回 true 表示这次 E 被支线吃掉
  interact(ctx) {
    const n = this._near(ctx.player);
    if (!n) return false;
    const { player, talk } = ctx;
    if (n.kind === 'distress') {
      if (player.gas < 70) { talk(t('你自己的气也不够了——帮不了他。')); return true; }
      player.gas -= 25;
      talk(t('你把备用二级头递给他，两人缓缓上升了一段——他冲你比了个 OK，转身游走了。'));
    } else if (n.kind === 'note') {
      const txt = STORY[this.map.id].notes[n.idx];
      store.addLore(`${this.map.id}:${n.idx}`);
      talk(t('你读到：{x}', { x: t(txt) }), 7);
    } else talk(t('捡到了{n}。带出去，说不定有人在找。', { n: t(SIDE_ITEMS[n.idx]) }), 5);
    n.done = true;
    n.obj.visible = false;
    ctx.audio?.ok?.();
    ctx.fx?.emit('side', { id: n.id, kind: n.kind });
    return true;
  }

  get stats() { return { done: this.items.filter(i => i.done).length, total: this.items.length }; }
}
