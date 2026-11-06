// 前人手绘测图：下水前摊开的"已知世界"——主线实线、支洞虚线连回主干、
// 未探明尽头画问号、塌了的支洞标灰。滚轮/双击/按钮缩放，拖拽平移，中英文标注切换。
import { t, getLang } from '@fundive/shared/i18n.js';
import { EN } from '@fundive/shared/lang_en.js';

const INK = '#463420', FAINT = '#8a7454', RED = '#a23b28', BLUE = '#2e5f78', PAPER = '#e9dfc8';
const W = 800, H = 600;

// 确定性抖动（手绘感）：不依赖随机数，重渲染不会抖
const j = (i, k, a = 1) => { const x = Math.sin(i * 127.1 + k * 269.3) * 43758.55; return (x - Math.floor(x) - 0.5) * 2 * a; };

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// route/branches -> 图纸坐标点（x右、-z上）。沉船相对坐标换算到世界。
function sketch(map) {
  const wr = map.ocean?.wreck;
  const world = (p, ref) => {
    const w = ref === 'wreck' && wr ? [wr.x + p[0], p[1], wr.z + p[2]] : p;
    return { x: w[0], y: -w[2], dep: w[1] };
  };
  const nodes = map.route.map((n, i) => ({ ...world(n.p, n.ref), n, i }));
  // 支线从主干 from 节点起笔——这才是手绘图"岔出去"的样子（之前只画 pts 会像没画）
  const brs = (map.branches || []).map((b, i) => {
    const pts = [nodes[b.from] || nodes[0], ...b.pts.map(p => world(p)), ...(b.to != null && nodes[b.to] ? [nodes[b.to]] : [])];
    return { pts, b, i };
  });
  const all = [...nodes, ...brs.flatMap(b => b.pts)];
  return { nodes, brs, all, wr };
}

// 手绘折线：每腿中点加一点垂直抖动
function handPath(pts, seed) {
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const mx = (a.x + b.x) / 2 + j(seed + i, 1, 2.2), my = (a.y + b.y) / 2 + j(seed + i, 2, 2.2);
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

function surveySVG(map, uni, lang, marks = true) {
  const tx = (s) => (lang === 'en' ? (EN[s] || s) : s);
  const name = lang === 'en' ? (map.en || map.name) : map.name;
  const { nodes, brs, all, wr } = sketch(map);
  // 适配：内容 bbox -> 800x600 纸面
  const bb = all.reduce((m, p) => ({ x0: Math.min(m.x0, p.x), y0: Math.min(m.y0, p.y), x1: Math.max(m.x1, p.x), y1: Math.max(m.y1, p.y) }),
    { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  const sc = Math.min((W - 160) / Math.max(20, bb.x1 - bb.x0), (H - 160) / Math.max(20, bb.y1 - bb.y0));
  const ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc;
  const X = (p) => p.x * sc + ox, Y = (p) => p.y * sc + oy;
  const P = (pts) => pts.map(p => ({ x: X(p), y: Y(p), dep: p.dep, n: p.n }));

  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`;
  s += `<rect width="${W}" height="${H}" fill="${PAPER}"/>`;
  s += `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${FAINT}" stroke-width="1.5" stroke-dasharray="12 8 3 8" opacity=".7"/>`;
  s += `<g class="svw">`;

  // 沉船外形（海图上的参照物）
  if (wr) {
    const c = { x: X({ x: wr.x }), y: Y({ y: -wr.z }) }, rot = wr.rot || 0;
    const L = (wr.len || 34) * sc, Wd = (wr.wid || 8) * sc;
    s += `<g transform="translate(${c.x} ${c.y}) rotate(${(-rot * 180 / Math.PI).toFixed(1)})">` +
      `<rect x="${-L / 2}" y="${-Wd / 2}" width="${L}" height="${Wd}" rx="${Wd / 2}" fill="none" stroke="${FAINT}" stroke-width="2"/>` +
      `<text x="0" y="${-Wd / 2 - 6}" text-anchor="middle" font-size="13" fill="${FAINT}">${esc(tx('沉船'))}</text></g>`;
  }
  // 冰山（冰下图）
  const berg = map.ice?.berg;
  if (berg) {
    const c = { x: X({ x: berg.x }), y: Y({ y: -berg.z }) };
    s += `<circle cx="${c.x}" cy="${c.y}" r="${(berg.r || 24) * sc}" fill="none" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
      `<text x="${c.x}" y="${c.y - (berg.r || 24) * sc - 6}" text-anchor="middle" font-size="13" fill="${BLUE}">${esc(tx('冰山'))}</text>`;
  }

  const open = (i) => uni?.branches?.[i]?.open !== false;

  // 支洞：虚线铅笔道，从主干节点岔出；闭环接回主干；塌了的画灰 + 批注
  brs.forEach(({ pts, b, i }, bi) => {
    const pp = P(pts), d = handPath(pp, 100 + bi * 7);
    const closed = !open(i);
    const col = closed ? '#9a8f7a' : INK;
    s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="7 6" opacity="${closed ? 0.55 : 0.9}" stroke-linecap="round"/>`;
    const end = pp[pp.length - 1], mid = pp[Math.floor(pp.length / 2)];
    if (b.bottomless) s += `<text x="${end.x + 8}" y="${end.y + 4}" font-size="17" fill="${RED}">？${esc(tx('未探明'))}</text>`;
    else if (b.deadEnd) s += `<text x="${end.x + 6}" y="${end.y + 5}" font-size="15" fill="${FAINT}">×</text>`;
    if (b.pocket) s += `<text x="${end.x + 6}" y="${end.y - 8}" font-size="12" fill="${INK}">○ ${esc(tx('气室'))}</text>`;
    if ((b.feats || []).includes('crack')) s += `<text x="${mid.x + 6}" y="${mid.y - 6}" font-size="12" fill="${RED}">⋈ ${esc(tx('窄缝'))}</text>`;
    if (closed) s += `<text x="${mid.x + 6}" y="${mid.y + 14}" font-size="12" fill="${RED}">${esc(tx('塌了？'))}</text>`;
    else if (b.name) s += `<text x="${mid.x + 6}" y="${mid.y + 14}" font-size="12.5" fill="${INK}" opacity=".85">${esc(tx(b.name))}</text>`;
  });

  // 主通道：双笔道（铅笔先描一遍淡的）
  const mp = P(nodes), md = handPath(mp, 0);
  s += `<path d="${md}" fill="none" stroke="${FAINT}" stroke-width="4.5" opacity=".4" transform="translate(1.5 1)" stroke-linecap="round"/>`;
  s += `<path d="${md}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  // 引绳：贴着主线的一道细蓝线（图上就是这么标的）
  s += `<path d="${md}" fill="none" stroke="${BLUE}" stroke-width="1.1" opacity=".8" transform="translate(0 -4)"/>`;

  // 节点 + 标注（上下交替减少叠字）
  mp.forEach((p, i) => {
    const n = p.n, side = i % 2 ? 1 : -1;
    s += `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/>`;
    if (n.sky || n.surface) {
      s += `<circle cx="${p.x}" cy="${p.y}" r="7" fill="none" stroke="${BLUE}" stroke-width="1.6"/>` +
        `<line x1="${p.x - 10}" y1="${p.y - 10}" x2="${p.x - 15}" y2="${p.y - 15}" stroke="${BLUE}" stroke-width="1.4"/>` +
        `<line x1="${p.x + 10}" y1="${p.y - 10}" x2="${p.x + 15}" y2="${p.y - 15}" stroke="${BLUE}" stroke-width="1.4"/>`;
    }
    if (!marks) return;
    const bits = [];
    if (n.name) bits.push(tx(n.name));
    else if (n.sky || n.surface) bits.push(tx(map.kind === 'ocean' ? '潜水船' : map.kind === 'ice' ? '冰洞' : '入口'));
    if ((n.feats || []).includes('restriction')) bits.push('⟨ ' + tx('隘口'));
    if ((n.feats || []).includes('pocket')) bits.push('○ ' + tx('气室'));
    const dep = (map.kind === 'cave' || !map.kind || n.abs) && !n.surface && p.dep < -0.5 ? `${Math.round(-p.dep)}m` : null;
    if (bits.length || dep) {
      const yy = p.y + side * 16;
      if (bits.length) s += `<text x="${p.x + 9}" y="${yy}" font-size="13" fill="${INK}">${esc(bits.join(' · '))}</text>`;
      if (dep) s += `<text x="${p.x + 9}" y="${yy + side * 15}" font-size="11" fill="${FAINT}">${dep}</text>`;
    }
  });

  s += `</g>`;
  // 罗盘 + 图题（固定纸面，不随缩放）
  s += `<g transform="translate(${W - 62} 66)"><circle r="20" fill="none" stroke="${INK}" stroke-width="1.4"/>` +
    `<path d="M0 -14 L4.5 3 L0 -1 L-4.5 3 Z" fill="${RED}"/><text y="-26" text-anchor="middle" font-size="13" fill="${INK}">N</text></g>`;
  s += `<text x="34" y="46" font-size="21" fill="${INK}" font-weight="700">${esc(name)}</text>` +
    `<text x="34" y="68" font-size="12.5" fill="${FAINT}">${esc(tx('前人手绘测图'))} · ${esc(tx('测绘仅供参考'))}</text>`;
  return s + '</svg>';
}

// 图例行（放大弹层底部 + 折叠卡共用）
const legendHTML = (tx) => [
  [`<span style="display:inline-block;width:26px;border-top:2.6px solid ${INK};vertical-align:middle"></span>`, tx('主通道')],
  [`<span style="display:inline-block;width:26px;border-top:2px dashed ${INK};vertical-align:middle"></span>`, tx('支洞')],
  [`<span style="display:inline-block;width:26px;border-top:1.1px solid ${BLUE};vertical-align:middle"></span>`, tx('引绳')],
  ['？', tx('未探明')], ['○', tx('气室')], ['⋈', tx('窄缝')], ['⟨', tx('隘口')], ['×', tx('死路')],
].map(([g, s]) => `<span class="sv-li">${g} ${esc(s)}</span>`).join('');

export function surveyCard(map, uni) {
  const lang = getLang();
  const tx = (s) => (lang === 'en' ? (EN[s] || s) : s);
  const div = document.createElement('div');
  div.className = 'sv-card';
  div.innerHTML = `<div class="sv-mini">${surveySVG(map, uni, lang)}</div>` +
    `<div class="sv-side"><b>${esc(tx('前人手绘测图'))}</b><span>${esc(tx('探明部分——今天的宇宙未必与图一致'))}</span>` +
    `<button class="btn small" data-svopen>${esc(tx('放大查看'))}</button></div>`;
  div.querySelector('[data-svopen]').onclick = () => openSurvey(map, uni);
  return div;
}

export function openSurvey(map, uni) {
  const ov = document.createElement('div');
  ov.className = 'sv-ov';
  ov.innerHTML = `<div class="sv-head"><b>${esc(t('前人手绘测图'))}</b><span class="sv-hint">${esc(t('拖拽平移 · 滚轮缩放'))}</span>` +
    `<button class="sv-tog" data-lang>${getLang() === 'en' ? '中文' : 'EN'}</button><button class="sv-tog" data-close>✕</button></div>` +
    `<div class="sv-stage"></div>` +
    `<div class="sv-foot"><span data-legend></span><span class="sv-zoom"><button data-z="0.8">−</button><button data-z="0">⤾</button><button data-z="1.25">＋</button></span></div>`;
  const stage = ov.querySelector('.sv-stage');
  const tx = (s) => (sv.lang === 'en' ? (EN[s] || s) : s);
  const sv = { s: 1, tx: 0, ty: 0, lang: getLang() };

  const draw = () => {
    stage.innerHTML = surveySVG(map, uni, sv.lang) + `<div class="sv-legend">${legendHTML(tx)}</div>`;
    sv.g = stage.querySelector('.svw');
    apply();
  };
  const apply = () => sv.g?.setAttribute('transform', `translate(${sv.tx} ${sv.ty}) scale(${sv.s})`);
  const zoomAt = (k, px, py) => {
    const ns = Math.min(9, Math.max(0.5, sv.s * k));
    sv.tx = px - (px - sv.tx) * ns / sv.s; sv.ty = py - (py - sv.ty) * ns / sv.s; sv.s = ns;
    apply();
  };
  const paper = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };

  draw();
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = paper(e); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y); }, { passive: false });
  stage.addEventListener('dblclick', (e) => { const p = paper(e); zoomAt(sv.s < 2 ? 2.2 : 1 / sv.s, p.x, p.y); });

  // 拖拽 + 双指捏合
  const ptrs = new Map();
  stage.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const r = stage.getBoundingClientRect();
    const prev = ptrs.get(e.pointerId);
    if (ptrs.size === 1) {
      sv.tx += (e.clientX - prev.x) / r.width * W; sv.ty += (e.clientY - prev.y) / r.height * H;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
    } else if (ptrs.size === 2) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (sv._pd) {
        const c = paper({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        zoomAt(d / sv._pd, c.x, c.y);
      }
      sv._pd = d;
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); sv._pd = 0; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);

  ov.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
    const k = +b.dataset.z;
    if (k) zoomAt(k, W / 2, H / 2); else { sv.s = 1; sv.tx = sv.ty = 0; apply(); }
  });
  ov.querySelector('[data-lang]').onclick = (e) => { sv.lang = sv.lang === 'zh' ? 'en' : 'zh'; e.target.textContent = sv.lang === 'en' ? '中文' : 'EN'; draw(); };
  ov.querySelector('[data-close]').onclick = () => { document.removeEventListener('keydown', escFn); ov.remove(); };
  const escFn = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', escFn); ov.remove(); } };
  document.addEventListener('keydown', escFn);
  document.body.appendChild(ov);
}
