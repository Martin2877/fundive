// 本地持久化：物种图鉴、照片相册、结局图鉴、生涯统计。
const KEY = 'fundive.v1';
const ALBUM_MAX = 60;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { } }

export const store = {
  get data() { return load(); },

  addPhoto(ph) {
    const d = load();
    d.album = d.album || [];
    d.album.unshift(ph);
    if (d.album.length > ALBUM_MAX) d.album.length = ALBUM_MAX;
    if (ph.sp) {
      d.codex = d.codex || {};
      const c = d.codex[ph.sp] || { count: 0, best: 0 };
      c.count += 1; c.best = Math.max(c.best, ph.stars || 0);
      d.codex[ph.sp] = c;
    }
    save(d);
  },

  addLore(id) {
    const d = load();
    d.lore = d.lore || {};
    d.lore[id] = true;
    save(d);
  },

  addChapter(mapId, ending) {
    const d = load();
    d.chapters = d.chapters || {};
    const c = d.chapters[mapId] || { plays: 0 };
    c.plays += 1; c.done = true; c.ending = ending;
    d.chapters[mapId] = c;
    save(d);
  },

  setSetting(k, v) {
    const d = load();
    d.settings = d.settings || {};
    d.settings[k] = v;
    save(d);
  },

  addEnding(id) {
    const d = load();
    d.endings = d.endings || {};
    d.endings[id] = (d.endings[id] || 0) + 1;
    save(d);
  },

  addLesson(cid, lid, res) {
    const d = load();
    d.courses = d.courses || {};
    d.courses[cid] = d.courses[cid] || {};
    const cur = d.courses[cid][lid] || { stars: 0, score: 0, plays: 0 };
    cur.plays += 1;
    cur.stars = Math.max(cur.stars, res.stars);
    cur.score = Math.max(cur.score, res.score);
    d.courses[cid][lid] = cur;
    save(d);
  },

  addDive(stat) {
    const d = load();
    d.stats = d.stats || { dives: 0, deaths: 0, photos: 0, rescued: 0, salvage: 0, universes: [] };
    Object.assign(d.stats, { ...d.stats, ...stat });
    if (stat.universe && !d.stats.universes.includes(stat.universe)) {
      d.stats.universes.push(stat.universe);
      if (d.stats.universes.length > 80) d.stats.universes.shift();
    }
    save(d);
  },
};
