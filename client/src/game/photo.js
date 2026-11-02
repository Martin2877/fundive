// 拍照系统：取景器 -> 按下快门 -> 场景里找主体 -> 评分 -> 存相册/图鉴。
import * as THREE from 'three';
import { SPECIES } from '@fundive/shared/maps.js';
import { t } from '@fundive/shared/i18n.js';
import { store } from './storage.js';

const _v = new THREE.Vector3(), _dir = new THREE.Vector3();

export class PhotoSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.active = false;      // 取景器是否打开
    this.film = 24;           // 每潜胶片数
    this.el = document.createElement('div');
    this.el.id = 'finder';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="frame"></div><div class="cross"></div>
      <div class="meta">${t('F 拍摄 · Esc 收起相机')}</div><div class="film"></div>`;
    document.body.appendChild(this.el);
    this.shots = [];          // 本潜拍到的 {sp,stars,thumb}
  }
  open() { this.active = true; this.el.hidden = false; this._updFilm(); }
  close() { this.active = false; this.el.hidden = true; }
  _updFilm() { this.el.querySelector('.film').textContent = t('胶片 {n}', { n: this.film }); }

  // 取景框内最好的拍摄对象
  _bestSubject(camera, photoables, lightOn) {
    camera.getWorldDirection(_dir);
    let best = null, bestScore = 0;
    for (const p of photoables) {
      const pos = p.obj.getWorldPosition ? p.obj.getWorldPosition(_v) : _v.copy(p.pos);
      const dist = pos.distanceTo(camera.position);
      if (dist > 30 || dist < 0.3) continue;
      _v.subVectors(pos, camera.position).normalize();
      const centrality = _v.dot(_dir);
      if (centrality < 0.82) continue;               // 不在取景框中心附近
      const closeness = THREE.MathUtils.clamp(1 - dist / 22, 0, 1);
      const lit = lightOn ? 1 : 0.35;
      const score = centrality * 0.5 + closeness * 0.35 + lit * 0.15;
      if (score > bestScore) { bestScore = score; best = { p, score, dist }; }
    }
    return best;
  }

  capture(camera, photoables, ctx) {
    if (this.film <= 0) return { fail: '胶片用完了' };
    this.film--;
    this._updFilm();
    // 截图缩略图
    const src = this.renderer.domElement;
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = Math.round(320 * src.height / src.width);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    const thumb = cv.toDataURL('image/jpeg', 0.6);

    const hit = this._bestSubject(camera, photoables, ctx.lightOn);
    let shot;
    if (hit) {
      const stars = hit.score > 0.86 ? 3 : hit.score > 0.7 ? 2 : 1;
      shot = { sp: hit.p.sp, stars, thumb, score: hit.score, map: ctx.mapId, universe: ctx.universeName, t: Date.now() };
    } else {
      shot = { sp: null, stars: 0, thumb, map: ctx.mapId, universe: ctx.universeName, t: Date.now() };
    }
    this.shots.push(shot);
    store.addPhoto(shot);
    return shot;
  }
}
