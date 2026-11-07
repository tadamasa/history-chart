// 年表アプリの画面と操作。計算は core.js、保存は db.js、同期は sync.js、AIは gemini.js。
import * as core from './core.js';
import * as db from './db.js';
import * as sync from './sync.js';
import * as gemini from './gemini.js';
import { exportData, importData } from './backup.js';
import { SEED_CATS, SEED_EVENTS, SEED_LINKS } from './seed.js';
import { TEXT } from './text.js';

const APP_VERSION = 'v1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgG = (kind, size, r) => `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><path d="${core.glyphD(kind, size / 2, size / 2, r)}"/></svg>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICON = {
  up: '<svg class="ic" viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
  down: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  sparkles: '<svg class="ic" viewBox="0 0 24 24"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
  msgs: '<svg class="ic" viewBox="0 0 24 24"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  pencil: '<svg class="ic18" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/><path d="m15 5 3 3"/></svg>',
  chevUp: '<svg class="ic" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  send: '<svg class="ic18" viewBox="0 0 24 24"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  corners: '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>',
};

// ---- 状態 ----
const S = {
  cats: [], events: [], links: [], ai: {},
  hidden: {}, zoom: core.ZOOM0, sel: null, sheet: null, sheetOpen: false,
  pick: false, compare: null, chat: [], chatBusy: false, aiBusy: false, aiErr: '', aiErrKey: false,
  showLinks: true, flash: null, editId: null, catMsg: '', L: null,
};
const cfg = { key: '', model: gemini.DEFAULT_MODEL };

const isWide = () => window.innerWidth >= 900;
const evById = id => S.events.find(e => e.id === id);
const catById = id => S.cats.find(c => c.id === id);
const cats = () => core.sortCats(S.cats);

// ---- 読み込み ----
async function loadAll() {
  const [c, e, l, a] = await Promise.all(['cats', 'events', 'links', 'ai'].map(n => db.getAll(n)));
  S.cats = c; S.events = e; S.links = l; S.ai = Object.fromEntries(a.map(x => [x.id, x]));
}

// 初めて開いたときだけ初期データを入れる。mtime=1 にして、どの端末の編集・削除よりも古い扱いにする
// (2台目で初期データを入れ直しても、1台目で消した出来事が同期で生き返らない)。
async function seedIfNeeded() {
  if (await db.getMeta('seeded')) return;
  const stamp = x => ({ ...x, mtime: 1 });
  await db.putMany('cats', SEED_CATS.map(stamp), { silent: true });
  await db.putMany('events', SEED_EVENTS.map(stamp), { silent: true });
  await db.putMany('links', SEED_LINKS.map(stamp), { silent: true });
  await db.setMeta('seeded', true);
}

// ---- 年表の描画 ----
function stageWidth() { return $('stage').clientWidth || window.innerWidth; }
function tlWidth() { return stageWidth() - (isWide() && S.sheetOpen ? 396 : 0); }
function viewH() { return $('scroller').clientHeight || 700; }

function renderTimeline() {
  const width = tlWidth();
  const L = core.layout({ events: S.events, cats: S.cats, hidden: S.hidden, links: S.links, sel: S.sel, pick: S.pick, flash: S.flash, zoom: S.zoom, width, showLinks: S.showLinks });
  S.L = L;
  const canvas = $('canvas');
  canvas.style.width = width + 'px';
  canvas.style.height = L.totalH + 'px';

  $('guides').innerHTML = L.lanes.map(l => `<div class="guide" style="left:${l.x}px"></div>`).join('');

  const svgAttr = `width="${width}" height="${L.totalH}" viewBox="0 0 ${width} ${L.totalH}"`;
  const bars = L.bars.map(b => {
    const c = `${b.sel ? ' sel' : ''}${b.dim ? ' dim' : ''}`;
    return `<rect class="bar${c}" x="${b.x}" y="${b.y}" width="3" height="${b.h}"/><path class="bar-end${c}" d="M${core.AX},${b.y + b.h}H${b.x + 3}M${b.x - 3},${b.y + b.h}H${b.x + 6}"/>`;
  }).join('');
  const lds = L.leaders.map(l => `<path class="ld${l.sel ? ' sel' : ''}${l.dim ? ' dim' : ''}" d="${l.d}"/>`).join('');
  const mks = L.markers.map(m => `<path class="mk${m.sel ? ' sel' : ''}${m.dim ? ' dim' : ''}" d="${m.d}"/>`).join('');
  const lead = $('leaders');
  lead.setAttribute('width', width); lead.setAttribute('height', L.totalH); lead.setAttribute('viewBox', `0 0 ${width} ${L.totalH}`);
  lead.innerHTML = bars + lds + mks;
  const rels = $('rels');
  rels.setAttribute('width', width); rels.setAttribute('height', L.totalH); rels.setAttribute('viewBox', `0 0 ${width} ${L.totalH}`);
  rels.innerHTML = L.rels.map(r => `<path class="rel${r.strong ? ' strong' : ''}${r.ai ? ' ai' : ''}" d="${r.d}"/>`).join('') +
    L.rels.map(r => `<circle class="rel-dot${r.strong ? ' strong' : ''}" cx="${r.end[0]}" cy="${r.end[1]}" r="2"/>`).join('');
  void svgAttr;

  // カードはidで使い回し、選択・減光の切り替えにCSSの遷移を効かせる
  const box = $('cards');
  const old = new Map([...box.children].map(el => [el.dataset.id, el]));
  const narrow = L.LW < 70;
  for (const c of L.cards) {
    let el = old.get(c.id);
    if (el) old.delete(c.id);
    else {
      el = document.createElement('button');
      el.className = 'ev';
      el.dataset.act = 'card';
      el.dataset.id = c.id;
      el.innerHTML = '<span class="d"></span><span class="t"></span>';
      box.appendChild(el);
    }
    el.style.cssText = `left:${c.x}px;top:${c.top}px;width:${c.w}px;height:${c.h}px`;
    el.classList.toggle('sel', c.sel);
    el.classList.toggle('dim', c.dim);
    el.classList.toggle('flash', c.flash);
    el.classList.toggle('narrow', narrow);
    if (el.firstChild.textContent !== c.date) el.firstChild.textContent = c.date;
    if (el.lastChild.textContent !== c.title) el.lastChild.textContent = c.title;
    el.setAttribute('aria-label', `${c.date} ${c.title}`);
  }
  old.forEach(el => el.remove());

  renderHeader(L);
  renderScroll(true);
}

function renderHeader(L = S.L) {
  $('count').textContent = `${TEXT.subject} · ${L.visibleCount} / ${S.events.length}件`;
  const lk = $('links');
  lk.setAttribute('aria-pressed', String(S.showLinks));
  $('chips').innerHTML = cats().map(c => {
    const on = !S.hidden[c.id];
    const n = S.events.filter(e => e.cat === c.id).length;
    return `<button class="chip${on ? '' : ' off'}" data-act="chip" data-id="${esc(c.id)}" aria-pressed="${on}">${svgG(c.glyph, 12, 3.6)}<span>${esc(c.name)}</span><span class="n">${n}</span></button>`;
  }).join('');
  $('lanes').innerHTML = L.lanes.map(l => `<div class="lane-head" style="left:${l.x}px;width:${l.w}px">${svgG(l.glyph, 12, 3.6)}${esc(l.name)}</div>`).join('');
}

// スクロールで変わるもの: 目盛り・帯(表示範囲±300pxだけ)、画面外の件数、ズーム表示
let lastTickY = null;
function renderScroll(force = false) {
  const st = $('scroller').scrollTop, vh = viewH();
  if (force || lastTickY === null || Math.abs(st - lastTickY) > 150) {
    lastTickY = st;
    const { ticks, bands } = core.ticksIn(st - 450, st + vh + 450, S.zoom);
    $('bands').innerHTML = bands.map(b => `<div class="band" style="top:${b.top}px;height:${b.h}px"></div>`).join('');
    $('ticks').innerHTML = ticks.map(t => `<div class="tick-l" style="top:${t.y - 7}px">${t.label}</div><div class="tick-m" style="top:${t.y}px"></div>`).join('');
  }
  const { above, below } = core.offscreen(S.L.cards, S.L.lanes, st, vh);
  const badge = (b, up) => `<button class="badge" style="left:${b.x}px" data-act="jump" data-top="${b.jump}" aria-label="${up ? 'この上' : 'この下'}の出来事 ${b.n}件">${up ? ICON.up : ICON.down}<svg class="g" viewBox="0 0 12 12"><path d="${core.glyphD(b.glyph, 6, 6, 3.4)}"/></svg>${b.n}</button>`;
  setHTML($('above'), S.pick ? '' : above.map(b => badge(b, true)).join(''));
  setHTML($('below'), below.map(b => badge(b, false)).join(''));
  $('zoom-label').innerHTML = `${TEXT.zoomLabel}<br><span>${core.zoomLabel(vh, S.zoom)}</span>`;
  $('zoom').querySelector('[data-act="zoom-in"]').disabled = S.zoom >= core.LIN.length - 1;
  $('zoom').querySelector('[data-act="zoom-out"]').disabled = S.zoom <= 0;
}
function setHTML(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }

// ---- スクロールとズーム ----
function centerOn(t, frac = 0.5) { $('scroller').scrollTop = core.yAt(t, S.zoom) - viewH() * frac; }
function scrollToEvent(id, frac = 0.22) {
  const e = evById(id);
  if (!e) return;
  $('scroller').scrollTo({ top: core.yAt(core.tOf(e), S.zoom) - viewH() * frac, behavior: reduced() ? 'auto' : 'smooth' });
}
// anchor: 維持する画面内の位置(px)。既定は中央。
function setZoom(z, anchor = viewH() / 2) {
  z = Math.max(0, Math.min(core.LIN.length - 1, z));
  if (z === S.zoom) return;
  const t = core.tAt($('scroller').scrollTop + anchor, S.zoom);
  S.zoom = z;
  renderTimeline();
  $('scroller').scrollTop = core.yAt(t, z) - anchor;
  renderScroll(true);
}

// ---- シート ----
let sheetTimer = null;
function openSheet(name, extra = {}) {
  clearTimeout(sheetTimer);
  const wasWide = isWide() && S.sheetOpen;
  Object.assign(S, extra, { sheet: name, sheetOpen: true });
  renderSheet();
  const app = $('app');
  app.classList.remove('sheet-closing');
  $('sheet').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => app.classList.add('sheet-open'));
  if (isWide() && !wasWide) renderTimeline();
}
function closeSheet({ keepSel = false } = {}) {
  if (!S.sheet) return;
  const app = $('app');
  S.sheetOpen = false;
  if (!keepSel && ['detail', 'chat'].includes(S.sheet)) S.sel = null;
  app.classList.add('sheet-closing');
  app.classList.remove('sheet-open');
  $('sheet').setAttribute('aria-hidden', 'true');
  document.activeElement?.blur?.();
  renderTimeline();
  sheetTimer = setTimeout(() => { S.sheet = null; app.classList.remove('sheet-closing'); $('sheet-body').innerHTML = ''; }, 360);
}

function renderSheet() {
  const body = $('sheet-body');
  const fn = { detail: detailHTML, add: formHTML, cats: catsHTML, chat: chatHTML, settings: settingsHTML }[S.sheet];
  body.innerHTML = fn ? fn() : '';
  if (S.sheet === 'chat') scrollChat();
  if (S.sheet === 'settings') renderSyncStatus();
}

// 詳細
function detailHTML() {
  const e = evById(S.sel);
  if (!e) return '';
  const c = catById(e.cat) || { name: '', glyph: 'circle' };
  const info = S.ai[e.id];
  const rels = core.relationsOf(e.id, S.events, S.links);
  const sugs = (info?.suggestions || []);
  const label = S.aiBusy ? TEXT.analyzing : info ? TEXT.reanalyze : TEXT.analyze;
  return `<button class="btn btn-ghost sheet-edit" data-act="edit" aria-label="編集">${ICON.pencil}</button>
  <div class="sh-body detail">
    <div class="d-head">
      <div class="kicker">${svgG(c.glyph, 12, 3.6)}<span>${esc(c.name)}</span><span class="sep">/</span><span>${esc(core.fmtRange(e, true))}</span></div>
      <h2 class="d-title">${esc(e.title)}</h2>
    </div>
    <p class="d-detail">${esc(e.detail || TEXT.noDetail)}</p>
    <div class="d-actions">
      <button class="btn btn-primary a1" data-act="analyze" ${S.aiBusy ? 'disabled' : ''}>${ICON.sparkles}${label}</button>
      <button class="btn btn-secondary a2" data-act="pick">${ICON.msgs}${TEXT.compare}</button>
      <button class="btn btn-secondary a3" data-act="delete" aria-label="削除">${ICON.trash}</button>
    </div>
    ${S.aiErr ? `<div class="ai-err">${esc(S.aiErr)}${S.aiErrKey ? '<button data-act="settings">設定を開く</button>' : ''}</div>` : ''}
    ${info?.summary ? `<div class="ai-box"><div class="h">${TEXT.aiSummary}</div><div class="b">${esc(info.summary)}</div></div>` : ''}
    <div>
      <div class="sec-h">${TEXT.relations} <span>${rels.length ? rels.length + '件' : ''}</span></div>
      ${rels.length ? rels.map(r => `<button class="rel-row" data-act="goto" data-id="${esc(r.id)}"><span class="dir">${r.dir}</span><span class="tt">${esc(r.title)}<span class="dt">${esc(r.date)}</span>${r.ai ? '<span class="src">AI</span>' : ''}</span><span class="nt">${esc(r.note)}</span></button>`).join('') : `<p class="empty">${TEXT.noRelations}</p>`}
    </div>
    ${sugs.length ? `<div>
      <div class="sec-h">${TEXT.suggestions}</div>
      ${sugs.map((s, i) => `<div class="sug"><div class="m"><span class="tt">${esc(s.title)} <span class="dt">${esc(core.fmtYear(s.year))} · ${esc(catById(s.cat)?.name || '')}</span></span><span class="nt">${esc(s.reason)}</span></div><button class="btn btn-secondary" data-act="add-sug" data-i="${i}">追加</button></div>`).join('')}
    </div>` : ''}
  </div>`;
}

// 追加・編集フォーム。値はDOMに持ち、送るときに読む(入力中に作り直さない)
const EMPTY_FORM = { era: 'AD', year: '', month: '', day: '', title: '', cat: '', detail: '', hasEnd: false, eEra: 'AD', eYear: '', eMonth: '', eDay: '' };
function formHTML() {
  const e = S.editId ? evById(S.editId) : null;
  const f = e ? core.formOf(e) : { ...EMPTY_FORM, cat: S.formCat || cats()[0]?.id };
  const seg = (name, val) => `<div class="seg"><label class="seg-opt"><input type="radio" name="${name}" value="AD" ${val === 'AD' ? 'checked' : ''}>西暦</label><label class="seg-opt"><input type="radio" name="${name}" value="BC" ${val === 'BC' ? 'checked' : ''}>紀元前</label></div>`;
  const num = (name, ph, v) => `<input class="input" name="${name}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${ph}" value="${esc(v)}">`;
  return `<form class="sh-body add" id="form" novalidate>
    <h2 class="sh-h">${e ? TEXT.editTitle : TEXT.addTitle}</h2>
    <div class="date-row">
      <div class="field"><label>紀年</label>${seg('era', f.era)}</div>
      <div class="field"><label>年 *</label>${num('year', '1969', f.year)}</div>
      <div class="field"><label>月</label>${num('month', '—', f.month)}</div>
      <div class="field"><label>日</label>${num('day', '—', f.day)}</div>
    </div>
    <button type="button" class="check${f.hasEnd ? ' on' : ''}" data-act="form-end" aria-pressed="${f.hasEnd}"><span class="box">${ICON.check}</span>${TEXT.hasEnd}</button>
    <div class="date-row end" id="end-row" ${f.hasEnd ? '' : 'hidden'}>
      <div class="field"><label>終了 紀年</label>${seg('eEra', f.eEra)}</div>
      <div class="field"><label>年 *</label>${num('eYear', '1972', f.eYear)}</div>
      <div class="field"><label>月</label>${num('eMonth', '—', f.eMonth)}</div>
      <div class="field"><label>日</label>${num('eDay', '—', f.eDay)}</div>
    </div>
    <p class="err" id="err-date"></p>
    <div class="field"><label>出来事 *</label><input class="input" name="title" placeholder="${TEXT.titlePh}" value="${esc(f.title)}" enterkeyhint="done"></div>
    <p class="err" id="err-title"></p>
    <div class="field"><label>カテゴリ</label><div class="cat-grid" id="cat-grid">
      ${cats().map(c => `<button type="button" class="cat-opt${c.id === f.cat ? ' on' : ''}" data-act="form-cat" data-id="${esc(c.id)}">${svgG(c.glyph, 12, 3.6)}<span>${esc(c.name)}</span></button>`).join('')}
    </div></div>
    <div class="field"><label>詳細</label><textarea class="input" name="detail" placeholder="${TEXT.detailPh}" style="min-height:72px">${esc(f.detail)}</textarea></div>
    <button type="submit" class="btn btn-primary blueprint submit">${ICON.corners}${e ? TEXT.saveEdit : TEXT.submitAdd}</button>
  </form>`;
}
function readForm() {
  const fm = $('form');
  const v = n => (fm.elements[n]?.value ?? '').trim();
  const radio = n => fm.querySelector(`input[name="${n}"]:checked`)?.value || 'AD';
  return {
    era: radio('era'), year: v('year'), month: v('month'), day: v('day'),
    hasEnd: fm.querySelector('[data-act="form-end"]').classList.contains('on'),
    eEra: radio('eEra'), eYear: v('eYear'), eMonth: v('eMonth'), eDay: v('eDay'),
    title: fm.elements.title.value, detail: fm.elements.detail.value,
    cat: fm.querySelector('.cat-opt.on')?.dataset.id || cats()[0]?.id,
  };
}
async function submitForm() {
  const f = readForm();
  const { err, ev } = core.validateForm(f);
  $('err-date').textContent = err.date || '';
  $('err-title').textContent = err.title || '';
  if (!ev) return;
  if (!catById(ev.cat)) ev.cat = cats()[0].id;
  let id;
  if (S.editId) {
    const old = evById(S.editId);
    id = old.id;
    const next = { id, ...ev };
    S.events = S.events.map(x => (x.id === id ? next : x));
    await db.put('events', next);
  } else {
    id = db.uid();
    const next = { id, ...ev };
    S.events = [...S.events, next];
    await db.put('events', next);
  }
  S.hidden[ev.cat] = false;
  S.formCat = ev.cat;
  const editing = !!S.editId;
  S.editId = null;
  if (editing) { openSheet('detail', { sel: id }); renderTimeline(); scrollToEvent(id); return; }
  closeSheet();
  flash(id);
  setTimeout(() => scrollToEvent(id, 0.4), 60);
}

function flash(id) {
  S.flash = id;
  renderTimeline();
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { S.flash = null; renderTimeline(); }, 1600);
}

// カテゴリ編集
function catsHTML() {
  return `<div class="sh-body cats">
    <div><h2 class="sh-h">${TEXT.catsTitle}</h2><p class="sh-note">${TEXT.catsNote}</p></div>
    <div class="cat-list">
      ${cats().map((c, i) => {
        const n = S.events.filter(e => e.cat === c.id).length;
        const blocked = n || S.cats.length <= 1;
        return `<div class="cat-row" data-id="${esc(c.id)}">
          <button class="btn btn-secondary gl" data-act="cat-glyph" data-id="${esc(c.id)}" aria-label="記号を変更">${svgG(c.glyph, 16, 4.6)}</button>
          <input class="input" data-cat-name="${esc(c.id)}" value="${esc(c.name)}" aria-label="カテゴリ名" enterkeyhint="done">
          <span class="n">${n}件</span>
          <button class="btn btn-ghost${i === 0 ? ' faint' : ''}" data-act="cat-up" data-id="${esc(c.id)}" aria-label="上へ">${ICON.chevUp}</button>
          <button class="btn btn-ghost${blocked ? ' faint' : ''}" data-act="cat-del" data-id="${esc(c.id)}" aria-label="削除">${ICON.trash}</button>
        </div>`;
      }).join('')}
    </div>
    ${S.catMsg ? `<p class="msg">${esc(S.catMsg)}</p>` : ''}
    ${S.cats.length < core.MAX_CATS ? `<button class="btn btn-secondary wide-btn" data-act="cat-add">${ICON.plus}${TEXT.catAdd}</button>` : ''}
    <button class="btn btn-primary blueprint submit" data-act="close">${ICON.corners}完了</button>
  </div>`;
}
async function saveCats(list) {
  // order を振り直し、変わったものだけ書く
  const changed = [];
  list.forEach((c, i) => {
    const prev = catById(c.id);
    const next = { ...c, order: i };
    if (!prev || prev.order !== i || prev.name !== next.name || prev.glyph !== next.glyph) changed.push(next);
  });
  S.cats = list.map((c, i) => ({ ...c, order: i }));
  if (changed.length) await db.putMany('cats', changed);
}

// 比較チャット
function chatHTML() {
  const [a, b] = (S.compare || []).map(evById);
  if (!a || !b) return '';
  return `<div class="chat">
    <div class="chat-top"><div class="h">${TEXT.chatTitle}</div>
      <div class="pair"><div><span class="dt">${esc(core.fmtDate(a))}</span><span class="tt">${esc(a.title)}</span></div><span class="arr">↔</span><div><span class="dt">${esc(core.fmtDate(b))}</span><span class="tt">${esc(b.title)}</span></div></div>
    </div>
    <div class="msgs" id="msgs">${msgsHTML()}</div>
    <div class="quick">${core.QUICK.map(q => `<button class="tag tag-outline" data-act="quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="ask" id="ask"><input class="input" name="q" placeholder="${TEXT.askPh}" autocomplete="off" enterkeyhint="send"><button class="btn btn-primary" type="submit" ${S.chatBusy ? 'disabled' : ''} aria-label="送信">${ICON.send}</button></form>
  </div>`;
}
function msgsHTML() {
  return S.chat.filter(m => !m.hidden).map(m => `<div class="m ${m.role}">${esc(m.content)}</div>`).join('') + (S.chatBusy ? `<div class="thinking">${TEXT.thinking}</div>` : '');
}
function scrollChat() { const el = $('msgs'); if (el) el.scrollTop = el.scrollHeight; }
function updateChat() {
  const el = $('msgs');
  if (!el) return;
  el.innerHTML = msgsHTML();
  const btn = $('ask')?.querySelector('button');
  if (btn) btn.disabled = S.chatBusy;
  scrollChat();
}

// 設定
function settingsHTML() {
  const sc = sync.config();
  return `<div class="sh-body settings">
    <h2 class="sh-h">設定</h2>
    <div class="set-sec"><div class="sec-h">${TEXT.storyTitle}</div>${TEXT.story.map(p => `<p class="story">${esc(p)}</p>`).join('')}</div>
    <div class="set-sec">
      <div class="sec-h">AI(Gemini)</div>
      <p>${TEXT.geminiNote}</p>
      <div class="field"><label>APIキー</label><input class="input" id="gkey" type="password" autocomplete="off" value="${esc(cfg.key)}" placeholder="AIza…"></div>
      <div class="field"><label>モデル</label><input class="input" id="gmodel" autocomplete="off" value="${esc(cfg.model)}" placeholder="${gemini.DEFAULT_MODEL}"></div>
      <div class="row"><button class="btn btn-primary" data-act="save-ai">保存</button><button class="btn btn-secondary" data-act="ping-ai">接続を確かめる</button></div>
      <div class="set-status" id="ai-status"></div>
    </div>
    <div class="set-sec">
      <div class="sec-h">年表ハブ(端末間の同期)</div>
      <p>${TEXT.syncNote}</p>
      <div class="field"><label>ウェブアプリのURL</label><input class="input" id="surl" autocomplete="off" value="${esc(sc.url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="field"><label>合言葉</label><input class="input" id="stoken" type="password" autocomplete="off" value="${esc(sc.token)}"></div>
      <div class="row"><button class="btn btn-primary" data-act="sync-connect">接続して同期する</button>${sc.url ? '<button class="btn btn-secondary" data-act="sync-now">今すぐ同期</button><button class="btn btn-secondary" data-act="sync-off">切断</button>' : ''}</div>
      <div class="set-status" id="sync-status"></div>
    </div>
    <div class="set-sec">
      <div class="sec-h">バックアップ</div>
      <p>${TEXT.backupNote}</p>
      <div class="row"><button class="btn btn-secondary" data-act="export">書き出す</button><label class="btn btn-secondary">読み込む<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      <div class="set-status" id="backup-status"></div>
    </div>
    <p class="sh-note">年表 ${APP_VERSION} · 書体 Barlow(SIL OFL)</p>
  </div>`;
}
function renderSyncStatus() {
  const el = $('sync-status');
  if (!el) return;
  const s = sync.status;
  el.textContent = s.state === 'off' ? '未接続' : s.state === 'syncing' ? '同期中…' : s.state === 'error' ? `エラー: ${s.error}` : `同期済み${s.lastAt ? '(' + new Date(s.lastAt).toLocaleString('ja-JP') + ')' : ''}${s.pending ? ` · 未送信 ${s.pending}件` : ''}`;
}

// ---- AI ----
function aiError(e) {
  S.aiErrKey = e.code === 'nokey';
  return e.code === 'nokey' ? e.message : (e.message || TEXT.aiParseErr);
}
async function analyze() {
  const e = evById(S.sel);
  if (!e || S.aiBusy) return;
  S.aiBusy = true; S.aiErr = ''; S.aiErrKey = false;
  renderSheet();
  const id = e.id;
  try {
    const txt = await gemini.generateJson({ apiKey: cfg.key, model: cfg.model, system: core.ANALYSIS_SYSTEM, prompt: core.analysisPrompt(e, S.events, cats()), schema: core.analysisSchema(cats()) });
    let res;
    try { res = core.parseJSON(txt); } catch { throw new Error(TEXT.aiParseErr); }
    const { added, ai } = core.applyAnalysis(id, res, S.events, S.links, cats());
    S.links = [...S.links, ...added];
    S.ai = { ...S.ai, [id]: ai };
    if (added.length) await db.putMany('links', added);
    await db.put('ai', ai);
  } catch (err) {
    S.aiErr = aiError(err);
  }
  S.aiBusy = false;
  if (S.sheet === 'detail' && S.sel === id) renderSheet();
  renderTimeline();
}
async function addSuggestion(i) {
  const target = evById(S.sel);
  const info = S.ai[S.sel];
  const s = info?.suggestions?.[i];
  if (!target || !s) return;
  const { ev, link } = core.suggestionToEvent(s, target, db.uid());
  const nextAi = { ...info, suggestions: info.suggestions.filter((_, k) => k !== i) };
  S.events = [...S.events, ev]; S.links = [...S.links, link]; S.ai = { ...S.ai, [target.id]: nextAi };
  S.hidden[ev.cat] = false;
  await db.put('events', ev); await db.put('links', link); await db.put('ai', nextAi);
  renderSheet();
  flash(ev.id);
}
function startCompare(a, b) {
  S.pick = false;
  $('banner').hidden = true;
  openSheet('chat', { compare: [a, b], chat: [], sel: a });
  renderTimeline();
  const ea = evById(a), eb = evById(b);
  ask(core.firstQuestion(ea, eb), true);
}
async function ask(q, hidden = false) {
  if (!q.trim() || S.chatBusy || !S.compare) return;
  const pair = S.compare;
  const [ea, eb] = pair.map(evById);
  S.chat = [...S.chat, { role: 'user', content: q, hidden }];
  S.chatBusy = true;
  updateChat();
  let reply;
  try {
    reply = await gemini.chat({ apiKey: cfg.key, model: cfg.model, system: core.chatSystem(ea, eb, cats()), messages: S.chat });
  } catch (e) {
    reply = e.code === 'nokey' ? '設定(左上の「年表」)でGemini APIキーを入れると、ここで解説が読めます。' : TEXT.chatErr;
  }
  if (S.compare !== pair) return; // 別の比較に移った
  S.chat = [...S.chat, { role: 'assistant', content: (reply || '').trim() }];
  S.chatBusy = false;
  updateChat();
}

// ---- 削除と元に戻す ----
let undoBuf = null, undoTimer = null;
async function removeEvent(id) {
  const ev = evById(id);
  if (!ev) return;
  const links = S.links.filter(l => l.from === id || l.to === id);
  const ai = S.ai[id];
  undoBuf = { ev, links, ai };
  S.events = S.events.filter(e => e.id !== id);
  S.links = S.links.filter(l => !links.includes(l));
  const { [id]: _, ...rest } = S.ai; S.ai = rest;
  await db.del('events', id);
  await db.delMany('links', links.map(l => l.id));
  if (ai) await db.del('ai', id);
  closeSheet();
  showToast(`「${ev.title}」を削除しました`);
}
function showToast(text) {
  const t = $('toast');
  t.innerHTML = `${ICON.corners}<div class="txt">${esc(text)}</div><button class="btn" data-act="undo">元に戻す</button>`;
  t.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { t.hidden = true; undoBuf = null; }, 6000);
}
async function undo() {
  if (!undoBuf) return;
  const { ev, links, ai } = undoBuf;
  undoBuf = null;
  $('toast').hidden = true;
  S.events = [...S.events, ev]; S.links = [...S.links, ...links];
  if (ai) S.ai = { ...S.ai, [ev.id]: ai };
  await db.put('events', ev);
  if (links.length) await db.putMany('links', links);
  if (ai) await db.put('ai', ai);
  flash(ev.id);
}

// ---- 操作 ----
const actions = {
  card(el) {
    const id = el.dataset.id;
    if (S.pick) { if (id !== S.sel) startCompare(S.sel, id); return; }
    S.aiErr = '';
    openSheet('detail', { sel: id });
    renderTimeline();
    scrollToEvent(id);
  },
  goto(el) { actions.card(el); },
  chip(el) { const id = el.dataset.id; S.hidden[id] = !S.hidden[id]; renderTimeline(); },
  links() { S.showLinks = !S.showLinks; renderTimeline(); },
  add() { S.editId = null; S.pick = false; $('banner').hidden = true; openSheet('add', { sel: null }); renderTimeline(); },
  edit() { S.editId = S.sel; openSheet('add'); },
  cats() { S.catMsg = ''; S.pick = false; $('banner').hidden = true; openSheet('cats', { sel: null }); renderTimeline(); },
  settings() { openSheet('settings', { sel: null, pick: false }); $('banner').hidden = true; renderTimeline(); },
  close() { closeSheet(); },
  jump(el) { $('scroller').scrollTo({ top: +el.dataset.top, behavior: reduced() ? 'auto' : 'smooth' }); },
  'zoom-in'() { setZoom(S.zoom + 1); },
  'zoom-out'() { setZoom(S.zoom - 1); },
  analyze() { analyze(); },
  pick() {
    const e = evById(S.sel);
    closeSheet({ keepSel: true });
    S.pick = true;
    const b = $('banner');
    b.innerHTML = `${ICON.corners}<div class="txt">${TEXT.pickTitle}<br><span>基準：${esc(e?.title)}</span></div><button class="btn" data-act="cancel-pick">やめる</button>`;
    b.hidden = false;
    renderTimeline();
  },
  'cancel-pick'() { S.pick = false; S.sel = null; $('banner').hidden = true; renderTimeline(); },
  delete() { removeEvent(S.sel); },
  undo() { undo(); },
  'add-sug'(el) { addSuggestion(+el.dataset.i); },
  'form-end'(el) { const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.setAttribute('aria-pressed', on); $('end-row').hidden = !on; },
  'form-cat'(el) { $('cat-grid').querySelectorAll('.cat-opt').forEach(b => b.classList.toggle('on', b === el)); },
  async 'cat-glyph'(el) { await saveCats(cats().map(c => (c.id === el.dataset.id ? { ...c, glyph: core.nextGlyph(c.glyph) } : c))); renderSheet(); renderTimeline(); },
  async 'cat-up'(el) {
    const list = cats(), i = list.findIndex(c => c.id === el.dataset.id);
    if (i <= 0) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    await saveCats(list); renderSheet(); renderTimeline();
  },
  async 'cat-del'(el) {
    const c = catById(el.dataset.id);
    const block = core.catDeleteBlock(c, S.cats, S.events);
    if (block) { S.catMsg = block; renderSheet(); return; }
    S.catMsg = '';
    S.cats = S.cats.filter(x => x.id !== c.id);
    await db.del('cats', c.id);
    await saveCats(cats());
    renderSheet(); renderTimeline();
  },
  async 'cat-add'() {
    const used = new Set(S.cats.map(c => c.glyph));
    const glyph = core.GLYPHS.find(g => !used.has(g)) || core.GLYPHS[S.cats.length % core.GLYPHS.length];
    const c = { id: db.uid(), name: TEXT.newCat, glyph, order: S.cats.length };
    S.catMsg = '';
    S.cats = [...S.cats, c];
    await db.put('cats', c);
    renderSheet(); renderTimeline();
  },
  quick(el) { ask(el.dataset.q); },
  async 'save-ai'() {
    cfg.key = $('gkey').value.trim(); cfg.model = $('gmodel').value.trim() || gemini.DEFAULT_MODEL;
    await db.setMeta('geminiKey', cfg.key); await db.setMeta('geminiModel', cfg.model);
    $('ai-status').textContent = '保存しました';
  },
  async 'ping-ai'() {
    await actions['save-ai']();
    $('ai-status').textContent = '確かめています…';
    try { $('ai-status').textContent = await gemini.ping({ apiKey: cfg.key, model: cfg.model }) || '応答がありました'; } catch (e) { $('ai-status').textContent = e.message; }
  },
  async 'sync-connect'() {
    const url = $('surl').value.trim(), token = $('stoken').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || !token) { $('sync-status').textContent = 'URL(…/exec)と合言葉を入れてください'; return; }
    await sync.connect(url, token);
    renderSheet();
  },
  'sync-now'() { sync.syncNow(); },
  async 'sync-off'() { await sync.disconnect(); renderSheet(); },
  async export() {
    try { if (await exportData()) $('backup-status').textContent = '書き出しました'; } catch (e) { $('backup-status').textContent = e.message; }
  },
  'hide-warning'() { $('tab-warning').hidden = true; try { sessionStorage.setItem('hideTabWarning', '1'); } catch {} },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'form') submitForm();
  if (e.target.id === 'ask') { const inp = e.target.elements.q; if (inp.value.trim() && !S.chatBusy) { const q = inp.value; inp.value = ''; ask(q); } }
});
// カテゴリ名: 打っている間は作り直さず、確定時に保存。空なら「名称未設定」
document.addEventListener('change', async e => {
  const id = e.target.dataset?.catName;
  if (id) {
    const name = e.target.value.trim() || TEXT.unnamed;
    e.target.value = name;
    await saveCats(cats().map(c => (c.id === id ? { ...c, name } : c)));
    renderTimeline();
  }
  if (e.target.id === 'import' && e.target.files[0]) {
    try {
      const n = await importData(await e.target.files[0].text());
      await loadAll(); renderTimeline();
      $('backup-status').textContent = `${n}件を取り込みました`;
    } catch (err) { $('backup-status').textContent = err.message; }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.dataset?.catName && !e.isComposing) e.target.blur();
});

// ---- スクロール・ピンチ・トラックパッド ----
function bindScroller() {
  const sc = $('scroller');
  let raf = 0;
  sc.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderScroll()); }, { passive: true });
  // トラックパッドのピンチ(ctrl+wheel)
  let lastZ = 0;
  sc.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastZ < 220) return;
    lastZ = now;
    const r = sc.getBoundingClientRect();
    setZoom(S.zoom + (e.deltaY < 0 ? 1 : -1), e.clientY - r.top);
  }, { passive: false });
  // タッチのピンチ: 指の間隔が1.35倍/0.74倍になるごとに1段。指の中点の年を保つ
  let p0 = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  sc.addEventListener('touchstart', e => { if (e.touches.length === 2) p0 = dist(e.touches); }, { passive: true });
  sc.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !p0) return;
    e.preventDefault();
    const d = dist(e.touches), step = core.pinchStep(d / p0);
    if (step) {
      const r = sc.getBoundingClientRect();
      setZoom(S.zoom + step, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
      p0 = d;
    }
  }, { passive: false });
  sc.addEventListener('touchend', e => { if (e.touches.length < 2) p0 = null; }, { passive: true });
  // iOS Safari のページ全体の拡大を止める(年表のズームと二重にならないように)
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function measure() {
  const app = $('app');
  app.classList.toggle('wide', isWide());
  app.style.setProperty('--hdr-h', $('hdr').offsetHeight + 'px');
}

// ---- 起動 ----
async function boot() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let hideWarn = false;
  try { hideWarn = !!sessionStorage.getItem('hideTabWarning'); } catch {}
  if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent) && !hideWarn) $('tab-warning').hidden = false;

  db.requestPersist();
  await seedIfNeeded();
  await loadAll();
  cfg.key = await db.getMeta('geminiKey', '') || '';
  cfg.model = await db.getMeta('geminiModel', '') || gemini.DEFAULT_MODEL;

  measure();
  bindScroller();
  renderTimeline();
  centerOn(1890);
  renderScroll(true);

  let rt = 0;
  const onResize = () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { const t = core.tAt($('scroller').scrollTop + viewH() / 2, S.zoom); measure(); renderTimeline(); centerOn(t); renderScroll(true); }); };
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('stage'));

  await sync.initSync({
    onRemoteChange: async () => {
      await loadAll();
      renderTimeline();
      const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (S.sheet === 'detail' && !typing) { if (evById(S.sel)) renderSheet(); else closeSheet(); }
    },
  });
  sync.onStatus(renderSyncStatus);
  sync.syncNow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.syncNow(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
