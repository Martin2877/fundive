// DeepLog 深蓝手账 主入口：渲染器 + 屏幕状态机。
// 流程：菜单 -> (单人|大厅) -> 潜水计划 -> 潜水 -> 结算/结局 -> 循环。
import * as THREE from 'three';
import { Input } from './game/input.js';
import { GameAudio } from './game/audio.js';
import { HUD, Talker } from './ui/hud.js';
import { PhotoSystem } from './game/photo.js';
import { Net } from './game/netplay.js';
import { SupaNet, supabaseConfigured } from './game/netplay_supa.js';
import { DiveSession } from './game/session.js';
import { showMenu, showLobby, showPlan, showDebrief, showGallery, showPause, showCourses, showLessonResult } from './ui/screens.js';
import { showReplay } from './ui/replay.js';
import { TrainingSession } from './game/training.js';
import { getCourse, getLesson } from '@fundive/shared/courses.js';
import { randomSeed } from '@fundive/shared/rng.js';
import { store } from './game/storage.js';
import { MSG } from '@fundive/shared/protocol.js';
import { buildWorld } from './engine/world.js';
import { DiverLamp } from './engine/lamp.js';
import { quality } from './engine/quality.js';
import { WaterFX } from './engine/water.js';
import { makeUniverse } from '@fundive/shared/universe.js';
import { getMap } from '@fundive/shared/maps.js';
import { STORY } from '@fundive/shared/story.js';
import { t, getLang, setLang, detectLang } from '@fundive/shared/i18n.js';

setLang(detectLang(store.data.settings?.lang));
document.title = t('DeepLog · 深蓝手账');

// —— 渲染器 ——
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.cfg.pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  session?.onResize();
  if (backdrop) { backdrop.camera.aspect = innerWidth / innerHeight; backdrop.camera.updateProjectionMatrix(); }
});

// —— 全局单例 ——
const input = new Input(canvas);
const audio = new GameAudio();
const hud = new HUD();
const talk = new Talker();
const photos = new PhotoSystem(renderer);
// 联机后端：配了 Supabase（VITE_SUPABASE_URL+ANON_KEY，纯静态部署联机方案）走 Realtime 频道；
// 否则走 ws —— VITE_WS_URL 指向自托管 server/，再否则同源 /ws（npm start / vite 代理）。
const net = supabaseConfigured() ? new SupaNet() : new Net();

let session = null;
let pauseEl = null;
let backdrop = null;
// 调试钩子（e2e/控制台）
window.__fd = { get session() { return session; }, get backdrop() { return backdrop; }, dive: (mapId, seed = 1) => startDive({ mapId, seed, plan: null, solo: true }) };

// —— 菜单背景：选中地图的洞穴慢速巡游 ——
function setBackdrop(mapId, seed) {
  backdrop?.dispose();
  const map = getMap(mapId);
  const uni = makeUniverse(mapId, seed);
  const scene = new THREE.Scene();
  const cave = buildWorld(map, uni);
  scene.add(cave.group);
  const water = new WaterFX(scene, map, map.water.vis * 0.9);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 160);
  const lamp = new DiverLamp(scene);
  let s = 0, last = performance.now();
  backdrop = {
    scene, camera, cave,
    dispose() { scene.traverse(o => o.geometry?.dispose?.()); },
    tick() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      s += dt * 1.4;
      const spine = cave.mainSpine;
      const f = s / 1.4, i = Math.floor(f);
      if (i >= spine.length - 8) s = 0;
      const p = spine[i]?.p || spine[0].p, ahead = spine[Math.min(spine.length - 1, i + 6)].p;
      // 采样点间插值——不然每秒跳一步，巡游变成抽动
      camera.position.copy(p).lerp(spine[Math.min(spine.length - 1, i + 1)].p, f - i);
      camera.position.y += Math.sin(s * 0.6) * 0.12;
      camera.lookAt(ahead);
      cave.update?.(dt, Math.max(0, -p.y));
      lamp.update(camera, { handheld: false, power: 0.9 });
      water.update(dt, p, { on: true, pos: lamp.pos, dir: lamp.dir }, 0, Math.max(0, -p.y), innerHeight, camera.fov);
    },
  };
}

// 常驻渲染循环：无会话时画菜单背景
(function bgLoop() {
  requestAnimationFrame(bgLoop);
  if (!session && backdrop) {
    backdrop.tick();
    renderer.render(backdrop.scene, backdrop.camera);
  }
})();

// 全局声音按钮
const snd = document.createElement('button');
snd.className = 'mute';
document.body.appendChild(snd);
const updSnd = () => snd.textContent = t('声音：{v}', { v: audio.on ? t('开') : t('关') });
const qbtn = document.createElement('button');
qbtn.className = 'mute'; qbtn.style.right = '120px';
document.body.appendChild(qbtn);
const updQ = () => qbtn.textContent = t('画质：{v}', { v: t(quality.cfg.name) });
updQ();
qbtn.onclick = () => {
  if (session) { talk.say('画质需要回到菜单后切换'); return; }
  quality.cycle(); updQ(); location.reload();
};
const lbtn = document.createElement('button');
lbtn.className = 'mute'; lbtn.style.right = '280px';
lbtn.textContent = '中文 / EN';
document.body.appendChild(lbtn);
lbtn.onclick = () => {
  if (session) { talk.say('语言需要回到菜单后切换'); return; }
  if (net.room) { talk.say('先离开房间再切换语言'); return; }
  store.setSetting('lang', getLang() === 'zh' ? 'en' : 'zh');
  location.reload();
};
updSnd();
snd.onclick = () => { audio.toggle(); updSnd(); };

// —— 屏幕流转 ——
function menu() {
  cleanupSession();
  showMenu({
    onPreview: (mapId, seed) => setBackdrop(mapId, seed),
    onSolo: (mapId, seed) => plan(mapId, seed, false),
    onLobby: async (mapId, seed) => {
      try {
        await net.connect();
      } catch (e) {
        // 纯静态托管（如 Cloudflare Pages）没有 /ws、也没配 Supabase——提示清楚一点再落单机
        talk.say(supabaseConfigured() || import.meta.env?.VITE_WS_URL
          ? '连不上联机服务器——只能独自下水了'
          : '这个部署没有联机服务——组队要自托管服务端或配置 Supabase，先自己下水吧');
        plan(mapId, seed, false);
        return;
      }
      showLobby(net, {
        onStart: (m) => {
          plan(m.mapId, m.seed, true, m.players);
        },
        onBack: menu,
        init: { mapId, seed },
      });
    },
    onGallery: () => gallery(menu),
    onTrain: () => courses(),
    audio,
  });
}

// —— 教学模式 ——
function courses() {
  cleanupSession();
  showCourses({ onLesson: (cid, lid) => startTraining(cid, lid), onBack: menu });
}

function startTraining(cid, lid) {
  cleanupSession();
  document.body.classList.add('diving');
  backdrop?.dispose(); backdrop = null;
  document.getElementById('app').innerHTML = '';
  const lesson = { ...getLesson(cid, lid), courseId: cid };
  photos.film = 24; photos.shots = [];
  session = new TrainingSession({
    renderer, input, audio, hud, talk, photos, net: null,
    lesson,
    onPause: (paused) => {
      if (paused) {
        pauseEl = showPause({
          onResume: () => { pauseEl?.remove(); pauseEl = null; session?.resume(); },
          onAbort: () => { pauseEl?.remove(); pauseEl = null; session?.finishLesson({ kind: 'lesson', aborted: true, courseId: cid, lessonId: lid, name: lesson.name, score: 0, stars: 0, grade: t('中途退场。'), mistakes: session?.trainer?.mistakes || 0, time: 0, records: session?.trainer?.records || [] }); },
          audio,
        });
      } else { pauseEl?.remove(); pauseEl = null; }
    },
    onEnd: (result) => {
      if (document.pointerLockElement) document.exitPointerLock();
      if (!result.aborted) store.addLesson(cid, lid, result);
      const ls = getCourse(cid).lessons;
      result.next = ls[ls.findIndex(l => l.id === lid) + 1] || null;
      document.body.classList.remove('diving');
      session?.dispose(); session = null;
      showLessonResult(result, {
        onRetry: () => startTraining(cid, lid),
        onNext: result.next ? () => startTraining(cid, result.next.id) : null,
        onList: courses,
      });
    },
  });
  if (!input.isTouch) hud.hint('点一下画面锁定鼠标 · Tab 键位表 · 听教练的', 5);
  session.start();
}

function plan(mapId, seed, multiplayer, netPlayers = []) {
  showPlan(mapId, seed, {
    multiplayer,
    onDive: (pl) => startDive({ mapId, seed, plan: pl, solo: !multiplayer, netPlayers }),
    onBack: menu,
  });
}

let teamResults = [];
function startDive({ mapId, seed, plan: pl, solo, netPlayers }) {
  cleanupSession();
  teamResults = [];
  if (net.connected) net.on(MSG.GAME_OVER, (m) => { if (m.results?.name) teamResults.push(m.results); });
  document.body.classList.add('diving');
  backdrop?.dispose(); backdrop = null;
  document.getElementById('app').innerHTML = '';
  if (net.connected) net.diving = true;
  session = new DiveSession({
    renderer, input, audio, hud, talk, photos, net: net.connected ? net : null,
    mapId, seed, solo, netPlayers,
    plan: pl,
    onPause: (paused) => {
      if (paused) {
        pauseEl = showPause({
          onResume: () => { pauseEl?.remove(); pauseEl = null; session?.resume(); },
          onAbort: () => { pauseEl?.remove(); pauseEl = null; session?.abort(); },
          audio,
        });
      } else { pauseEl?.remove(); pauseEl = null; }
    },
    onEnd: (result) => {
      net.diving = false;
      if (document.pointerLockElement) document.exitPointerLock();
      finish(result);
    },
  });
  photos.film = 24;
  photos.shots = [];
  // 非触屏时提示锁定鼠标
  const _k = getMap(mapId).kind;
  if (!input.isTouch) hud.hint(_k === 'ocean' ? '点一下画面锁定鼠标 · WASD 游动 · F 拍照 · G 抓锚绳 · C 浮标' : _k === 'ice' ? '点一下画面锁定鼠标 · WASD 游动 · F 拍照 · G 抓安全绳' : '点一下画面锁定鼠标 · WASD 游动 · F 拍照 · G 抓引绳', 5);
  session.start();
}

function finish(result) {
  store.addEnding(result.ending);
  result.chapterDone = ['survived', 'survived_rough', 'rescued'].includes(result.ending) && result.objectiveDone && !!STORY[result.mapId];
  if (result.chapterDone) store.addChapter(result.mapId, result.ending);
  store.addDive({
    dives: (store.data.stats?.dives || 0) + 1,
    deaths: (store.data.stats?.deaths || 0) + (['survived', 'survived_rough', 'rescued'].includes(result.ending) ? 0 : 1),
    photos: (store.data.stats?.photos || 0) + result.stats.photos,
    rescued: (store.data.stats?.rescued || 0) + (result.objectiveDone && result.objectiveType === 'rescue' ? 1 : 0),
    salvage: (store.data.stats?.salvage || 0) + (result.objectiveDone && result.objectiveType === 'salvage' ? 1 : 0),
    universe: result.seed,
  });
  if (net.connected && net.room) {
    net.gameOver({ ending: result.ending, name: net.name, objectiveDone: result.objectiveDone });
  }
  renderDebrief(result);
}

function renderDebrief(result) {
  const sid = result.seed, mid = result.mapId;
  document.body.classList.remove('diving');
  if (session) result._ctx = { plan: session.o.plan, solo: session.o.solo, np: session.o.netPlayers };
  const { plan: plan0, solo: wasSolo = true, np } = result._ctx || {};
  session?.dispose();
  session = null;
  showDebrief(result, {
    onRetry: () => startDive({ mapId: mid, seed: sid, plan: plan0, solo: wasSolo, netPlayers: np }),
    onNewUniverse: () => plan(mid, randomSeed(), false),
    onMenu: menu,
    team: wasSolo ? null : teamResults,
    onGallery: () => gallery(() => renderDebrief(result)),
    onReplay: () => showReplay(result, { onBack: () => renderDebrief(result) }),
  });
}

function gallery(back) {
  showGallery({ onBack: back, onLearn: () => courses() });
}

function cleanupSession() {
  document.body.classList.remove('diving');
  if (session) { session.dispose(); session = null; }
  pauseEl?.remove(); pauseEl = null;
  hud.hide();
  photos.close();
  talk.clear();
}

// 联机断线回退
net.on('_close', () => {
  if (session && !session.o.solo) talk.say('联机中断——剩下的路由你自己潜完');
});

menu();
