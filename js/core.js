// 年表の純粋な計算。DOM に触れないので node --test で確かめられる。
// 元になった仕様: デザインハンドオフ README「時間軸の計算」「カード配置」「入力検証」「AI連携」。

export const GLYPHS = ['circle', 'diamond', 'square', 'triangle', 'tridown', 'hex', 'plus', 'bar'];
export const TMIN = -3300;
export const MAX_YEAR = Math.max(2026, new Date().getFullYear());
export const TMAX = MAX_YEAR + 0.99;
// ズームは連続の値 ppy(1年あたりのpx)。デザインの5段階 [0.14, 0.5, 2, 8, 32] を含む範囲を滑らかに動く。
export const PPY0 = 2;          // 初期値(デザインどおり)
export const PPY_MIN = 0.02;    // 全期間(約5300年)が約100pxに収まる
export const PPY_MAX = 128;     // 1か月が約10px
export const ZOOM_STEP = 2;     // ＋−1回の倍率
export const clampPpy = p => Math.max(PPY_MIN, Math.min(PPY_MAX, p));
export const STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000];
export const AX = 52; // 時間軸の x
export const PAD = 40; // 上の余白
export const PADB = 170; // 下の余白
export const L0 = 60; // 最初のレーンの左端
export const CARD_H = 50;
export const CARD_GAP = 6;
// 文字の大きさ(設定)。ts は年表の文字の倍率。カードの高さと時間軸の位置(左の年の幅)が一緒に変わる。
export const TEXT_SCALES = [{ id: 's', label: '標準', ts: 1 }, { id: 'm', label: '大', ts: 1.15 }, { id: 'l', label: '特大', ts: 1.3 }];
export const TS_DEFAULT = 'm';
export const tsOf = id => (TEXT_SCALES.find(x => x.id === id) || TEXT_SCALES.find(x => x.id === TS_DEFAULT)).ts;
// カード = 上下の余白8 + 日付13 + 隙間1 + 題名2行28 を倍率で。軸は年の欄(44px)の伸びぶん右へ。
export function geom(ts = 1) {
  const ax = Math.round(AX + 44 * (ts - 1));
  return { ts, AX: ax, L0: ax + (L0 - AX), cardH: Math.round(9 + 41 * ts) };
}
export const MAX_CATS = 8;

// ---- 記号 ----
export function glyphD(kind, x, y, r) {
  if (kind === 'square') { r *= 0.88; return `M${x - r},${y - r}h${2 * r}v${2 * r}h${-2 * r}Z`; }
  if (kind === 'diamond') { r *= 1.25; return `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`; }
  if (kind === 'triangle') { r *= 1.2; return `M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z`; }
  if (kind === 'tridown') { r *= 1.2; return `M${x},${y + r}L${x + r},${y - r * 0.8}L${x - r},${y - r * 0.8}Z`; }
  if (kind === 'hex') { r *= 1.1; const h = r * 0.866; return `M${x - r},${y}L${x - r / 2},${y - h}L${x + r / 2},${y - h}L${x + r},${y}L${x + r / 2},${y + h}L${x - r / 2},${y + h}Z`; }
  if (kind === 'plus') { r *= 1.15; const a = r * 0.36; return `M${x - a},${y - r}h${2 * a}v${r - a}h${r - a}v${2 * a}h${a - r}v${r - a}h${-2 * a}v${a - r}h${a - r}v${-2 * a}h${r - a}Z`; }
  if (kind === 'bar') { r *= 1.1; return `M${x - r},${y - r * 0.45}h${2 * r}v${r * 0.9}h${-2 * r}Z`; }
  return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
}
export const nextGlyph = g => GLYPHS[(GLYPHS.indexOf(g) + 1) % GLYPHS.length];

// ---- 日付 ----
export const fmtYear = y => (y < 0 ? `紀元前${-y}年` : `${y}年`);
export const fmtDate = e => fmtYear(e.y) + (e.m ? `${e.m}月` : '') + (e.m && e.d ? `${e.d}日` : '');
export function fmtRange(e, long = false) {
  if (!e.ey) return fmtDate(e);
  const b = fmtDate({ y: e.ey, m: e.em, d: e.ed });
  if (!long) return fmtDate(e) + '〜' + b;
  const dur = e.ey - e.y - (e.y < 0 && e.ey > 0 ? 1 : 0); // 紀元0年はない
  return fmtDate(e) + ' 〜 ' + b + (dur > 0 ? `（${dur}年間）` : '');
}
// 幅の狭いカード用: 年だけ(紀元前は「前」)
export const fmtShort = e => { const f = y => (y < 0 ? `前${-y}` : `${y}`); return e.ey && e.ey !== e.y ? `${f(e.y)}–${f(e.ey)}` : f(e.y); };
export const tOf = e => e.y + (e.m ? (e.m - 1) / 12 + (e.d ? (e.d - 1) / 365 : 0.04) : 0.5);
export const tEnd = e => e.ey + (e.em ? (e.em - 1) / 12 + (e.ed ? (e.ed - 1) / 365 : 1 / 12) : 1);
export const tickLabel = t => (t < 0 ? `前${-t}` : `${t === 0 ? 1 : t}`);

// ---- 軸 ----
export const yAt = (t, ppy) => PAD + (t - TMIN) * ppy;
export const tAt = (y, ppy) => TMIN + (y - PAD) / ppy;
export const tickStep = ppy => STEPS.find(x => x * ppy >= 56) || 5000;

// 表示範囲 y0..y1 の目盛りと、1つおきの帯
export function ticksIn(y0, y1, z) {
  const step = tickStep(z);
  const ta = Math.max(TMIN, tAt(y0, z)), tb = Math.min(TMAX, tAt(y1, z));
  const tk = [];
  for (let t = Math.ceil(ta / step) * step; t <= tb; t += step) tk.push({ t, y: yAt(t, z), p: Math.round(t / step) });
  const bands = [];
  tk.forEach((x, k) => { const nx = tk[k + 1]; if (nx && ((x.p % 2) + 2) % 2 === 0) bands.push({ top: x.y, h: nx.y - x.y }); });
  return { ticks: tk.map(x => ({ y: x.y, label: tickLabel(x.t) })), bands };
}

// 表示幅(画面の高さに入る年数)。2桁に丸める
export function zoomLabel(viewH, ppy) {
  const yrs = viewH / ppy;
  if (yrs < 1) return `${Math.max(1, Math.round(yrs * 12))}か月`;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(yrs)) - 1));
  return `${Math.round(yrs / mag) * mag}年`;
}

// 表示幅の合わせ込み: 出来事の範囲(期間は終わりまで)が画面の上下に余白を残して収まる ppy と中央の年。
// 1件だけ・同じ年ばかりなら前後 minSpan/2 年を見せる。
export function fitView(events, viewH, { margin = 90, minSpan = 20, cardH = CARD_H } = {}) {
  if (!events.length) return null;
  let a = Infinity, b = -Infinity;
  for (const e of events) { a = Math.min(a, tOf(e)); b = Math.max(b, e.ey ? tEnd(e) : tOf(e)); }
  const span = Math.max(b - a, minSpan);
  const usable = Math.max(120, viewH - margin * 2 - cardH);
  return { ppy: clampPpy(usable / span), center: (a + b) / 2, tspan: span };
}
// fitView は時間だけで縮尺を決めるので、同じ頃の出来事がレーンで縦に積まれると画面からはみ出す。
// 実際の配置(layoutAt(ppy) の cards)を見て、積み上がり分を差し引いた縮尺に数回で寄せ、カードの範囲の中央に置く。
export function refineFit(fit, ids, viewH, layoutAt, { margin = 24, rounds = 4 } = {}) {
  if (!fit) return null;
  let ppy = fit.ppy, box = null;
  const avail = Math.max(60, viewH - margin * 2);
  for (let i = 0; i < rounds; i++) {
    const cs = layoutAt(ppy).cards.filter(c => ids.has(c.id));
    if (!cs.length) return fit;
    box = { top: Math.min(...cs.map(c => c.top)), bot: Math.max(...cs.map(c => c.top + c.h)), ppy };
    const span = box.bot - box.top;
    if (span <= avail + 1) break;
    // 積み上がりだけで画面の大半を占めるなら、縮めても時間軸がつぶれるだけなので止める
    const room = avail - (span - fit.tspan * ppy);
    if (room < avail * 0.4) break;
    const next = clampPpy(room / fit.tspan);
    if (next >= ppy * 0.98) break;
    ppy = next;
  }
  const span = box.bot - box.top;
  const cy = span <= avail ? (box.top + box.bot) / 2 : box.top - margin + viewH / 2;
  return { ppy: box.ppy, center: tAt(cy, box.ppy) };
}

// ---- 重なり回避(1次元のラベル配置) ----
// 理想位置 y-h/2 で並べ、重なるブロックを結合し、ブロック上端を各要素の理想位置の平均に置く。
export function place(items, h = CARD_H, gap = CARD_GAP) {
  const s = [...items].sort((a, b) => a.y - b.y), blocks = [];
  for (const it of s) {
    blocks.push({ its: [it], top: it.y - h / 2 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.top + a.its.length * (h + gap) > b.top) {
        a.its = a.its.concat(b.its);
        let sum = 0; a.its.forEach((x, k) => { sum += x.y - h / 2 - k * (h + gap); });
        a.top = sum / a.its.length; blocks.pop();
      } else break;
    }
  }
  const out = {};
  blocks.forEach(b => b.its.forEach((x, k) => { out[x.id] = Math.max(8, b.top) + k * (h + gap); }));
  return out;
}

export const sortCats = cats => [...cats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// ---- 年表全体の配置 ----
// width: 年表の幅(iPadでパネルを開いたときは残りの幅)
// match: 検索中なら当たった出来事のidの集合(それ以外を薄くする)
export function layout({ events, cats, hidden = {}, links, sel = null, pick = false, flash = null, zoom = PPY0, width = 402, showLinks = true, match = null, ts = 1 }) {
  const { AX, L0, cardH: CARD_H } = geom(ts);
  const vis = sortCats(cats).filter(c => !hidden[c.id]);
  const n = Math.max(1, vis.length);
  const idx = Object.fromEntries(vis.map((c, i) => [c.id, i]));
  const glyphOf = Object.fromEntries(cats.map(c => [c.id, c.glyph]));
  const LW = (width - 8 - L0) / n;
  const evs = events.filter(e => idx[e.cat] !== undefined).map(e => ({ ...e, src: e, y: yAt(tOf(e), zoom), y2: e.ey ? yAt(tEnd(e), zoom) : null }));
  const tops = {};
  vis.forEach(c => Object.assign(tops, place(evs.filter(e => e.cat === c.id).map(e => ({ id: e.id, y: e.y })), CARD_H)));

  const related = new Set();
  if (sel) links.forEach(l => { if (l.from === sel) related.add(l.to); if (l.to === sel) related.add(l.from); });
  const pos = {}, leaders = [], markers = [], bars = [];
  let maxBottom = 0;
  const cards = evs.map(e => {
    const i = idx[e.cat], top = tops[e.id], cy = top + CARD_H / 2;
    maxBottom = Math.max(maxBottom, top + CARD_H, e.y2 || 0);
    const isSel = sel === e.id;
    const dim = match ? !match.has(e.id) : (!!sel && !pick && !isSel && !related.has(e.id));
    const lx = L0 + i * LW, x = lx + 10, w = LW - 14;
    leaders.push({ d: `M${AX + 4},${r1(e.y)}H${r1(lx + 2)}L${r1(lx + 8)},${r1(cy)}H${r1(x)}`, dim, sel: isSel });
    markers.push({ d: glyphD(glyphOf[e.cat], AX, r1(e.y), isSel ? 4.5 : 3.4), dim, sel: isSel });
    if (e.y2) bars.push({ x: lx + 3, y: e.y, h: Math.max(2, e.y2 - e.y), dim, sel: isSel });
    pos[e.id] = [x, cy];
    return { id: e.id, cat: e.cat, x, w, top, h: CARD_H, date: fmtRange(e.src), short: fmtShort(e.src), title: e.title, dim, sel: isSel, flash: flash === e.id };
  });
  const rels = links.filter(l => pos[l.from] && pos[l.to] && (sel ? (l.from === sel || l.to === sel) : showLinks)).map(l => {
    const [ax, ay] = pos[l.from], [bx, by] = pos[l.to];
    const b = 16 + Math.min(26, Math.abs(by - ay) * 0.06);
    return { d: `M${r1(ax)},${r1(ay)}C${r1(ax - b)},${r1(ay)} ${r1(bx - b)},${r1(by)} ${r1(bx)},${r1(by)}`, end: [r1(bx), r1(by)], ai: l.src === 'ai', spec: l.confidence === 'speculative', strong: !!sel };
  });
  const totalH = Math.max(yAt(TMAX, zoom), maxBottom) + PADB;
  const lanes = vis.map((c, i) => ({ id: c.id, x: L0 + i * LW, w: LW, name: c.name, glyph: c.glyph }));
  return { cards, leaders, markers, bars, rels, totalH, lanes, LW, AX, ts, visibleCount: evs.length };
}
const r1 = v => Math.round(v * 10) / 10;

// 画面外の件数(カテゴリ別)。jump は飛ぶ先の scrollTop。
export function offscreen(cards, lanes, scrollTop, viewH) {
  const vTop = scrollTop, vBot = scrollTop + viewH;
  const row = (list, up) => lanes.map(l => {
    const its = list.filter(c => c.cat === l.id);
    if (!its.length) return null;
    const jump = up ? Math.max(...its.map(c => c.top)) - viewH * 0.6 : Math.min(...its.map(c => c.top)) - viewH * 0.3;
    return { cat: l.id, n: its.length, x: l.x + l.w / 2, glyph: l.glyph, jump: Math.max(0, jump) };
  }).filter(Boolean);
  return {
    above: row(cards.filter(c => c.top + c.h < vTop + 4), true),
    below: row(cards.filter(c => c.top > vBot - 4), false),
  };
}

// ---- 詳細 ----
export function relationsOf(id, events, links) {
  const byId = new Map(events.map(e => [e.id, e]));
  return links.filter(l => l.from === id || l.to === id).map(l => {
    const other = byId.get(l.from === id ? l.to : l.from);
    if (!other) return null;
    const dir = l.para ? '↔ 並行' : l.to === id ? '← 原因' : '→ 影響';
    return { id: other.id, dir, title: other.title, date: fmtDate(other), note: l.note || '', ai: l.src === 'ai', src: l.src === 'ai' ? 'AI' : l.src === 'api' ? 'API' : '', conf: CONF_LABEL[l.confidence] || '', memo: l.memo || '', sources: l.sources || [], by: l.by || '', t: tOf(other) };
  }).filter(Boolean).sort((a, b) => a.t - b.t);
}

// ---- 入力検証(追加・編集フォーム) ----
// 戻り値: { err: { date?, title? }, ev?: {y,m,d,ey?,em?,ed?,title,detail,cat} }
export function validateForm(f, maxYear = MAX_YEAR) {
  const err = {};
  const int = s => (String(s ?? '').trim() === '' ? NaN : Number(String(s).trim()));
  const y = int(f.year), m = f.month ? int(f.month) : 0, d = f.day ? int(f.day) : 0;
  const range = `紀元前${-TMIN}年〜${maxYear}年の範囲で入力してください`;
  if (!String(f.year ?? '').trim() || !Number.isInteger(y) || y < 1) err.date = '年を入力してください';
  else if (f.era === 'BC' ? y > -TMIN : y > maxYear) err.date = range;
  else if (f.month && !(Number.isInteger(m) && m >= 1 && m <= 12)) err.date = '月は1〜12で入力してください';
  else if (f.day && !(Number.isInteger(d) && d >= 1 && d <= 31)) err.date = '日は1〜31で入力してください';
  else if (f.day && !f.month) err.date = '日を入れる場合は月も入力してください';
  const sy = f.era === 'BC' ? -y : y;
  let end = null;
  if (!err.date && f.hasEnd) {
    const y2 = int(f.eYear), em = f.eMonth ? int(f.eMonth) : 0, ed = f.eDay ? int(f.eDay) : 0;
    const ey = f.eEra === 'BC' ? -y2 : y2;
    if (!String(f.eYear ?? '').trim() || !Number.isInteger(y2) || y2 < 1) err.date = '終了年を入力してください';
    else if (f.eEra === 'BC' ? y2 > -TMIN : y2 > maxYear) err.date = '終了は' + range;
    else if (f.eMonth && !(Number.isInteger(em) && em >= 1 && em <= 12)) err.date = '終了月は1〜12で入力してください';
    else if (f.eDay && !(Number.isInteger(ed) && ed >= 1 && ed <= 31)) err.date = '終了日は1〜31で入力してください';
    else if (f.eDay && !f.eMonth) err.date = '終了日を入れる場合は終了月も入力してください';
    else if (tEnd({ ey, em, ed }) <= tOf({ y: sy, m, d })) err.date = '終了は開始より後にしてください';
    else end = { ey, em, ed };
  }
  if (!String(f.title ?? '').trim()) err.title = '出来事を入力してください';
  if (Object.keys(err).length) return { err };
  return { err, ev: { y: sy, m, d, ...(end || {}), cat: f.cat, title: f.title.trim(), detail: String(f.detail || '').trim() } };
}

// 出来事 → フォームの値(編集用)
export function formOf(e) {
  return {
    era: e.y < 0 ? 'BC' : 'AD', year: String(Math.abs(e.y)), month: e.m ? String(e.m) : '', day: e.d ? String(e.d) : '',
    hasEnd: !!e.ey, eEra: e.ey < 0 ? 'BC' : 'AD', eYear: e.ey ? String(Math.abs(e.ey)) : '', eMonth: e.em ? String(e.em) : '', eDay: e.ed ? String(e.ed) : '',
    title: e.title, detail: e.detail || '', cat: e.cat, memo: e.memo || '',
  };
}

// ---- AI ----
// 根拠の欄: 確からしさの表示名(ハブの CONF_LABEL と同じ)
export const CONF_LABEL = { certain: '確実', likely: '有力', speculative: '推測' };
// 出典のURLは http(s) のものだけリンクにする
export const safeUrl = u => (typeof u === 'string' && /^https?:\/\/\S+$/.test(u) ? u : '');

export const linkId = (from, to) => `${from}>${to}`;

export function analysisPrompt(target, events, cats) {
  const name = Object.fromEntries(cats.map(c => [c.id, c.name]));
  const list = events.map(x => `${x.id}|${fmtRange(x)}|${name[x.cat] || ''}|${x.title}`).join('\n');
  return `年表に登録された出来事:\n${list}\n\n対象: ${target.id}「${target.title}」(${fmtRange(target)}) ${target.detail || ''}\n\n` +
    '対象と他の出来事との関係を分析し、次のJSONのみを返してください。\n' +
    `{"summary":"対象の歴史的な位置づけと因果の流れ(140字以内)","relations":[{"id":"登録済みのID","kind":"原因|影響|並行","note":"関係の説明(60字以内)"}],"suggestions":[{"year":数値(紀元前は負),"month":数値またはnull,"title":"年表に未登録の関連出来事","cat":"${cats.map(c => c.id).join('|')}","reason":"対象との関係(50字以内)"}]}\n` +
    'relationsは最大5件、kindは対象から見た相手の役割(原因=相手が対象を引き起こした、影響=対象が相手を引き起こした)。suggestionsは未登録のものを3件。';
}
export const ANALYSIS_SYSTEM = 'あなたは科学技術史の専門家です。事実に基づき、日本語で、JSONのみを返します。';

// Gemini の構造化出力に渡すスキーマ
export function analysisSchema(cats) {
  return {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      relations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, kind: { type: 'STRING', enum: ['原因', '影響', '並行'] }, note: { type: 'STRING' } }, required: ['id', 'kind', 'note'] } },
      suggestions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { year: { type: 'INTEGER' }, month: { type: 'INTEGER', nullable: true }, title: { type: 'STRING' }, cat: { type: 'STRING', enum: cats.map(c => c.id) }, reason: { type: 'STRING' } }, required: ['year', 'title', 'cat', 'reason'] } },
    },
    required: ['summary', 'relations', 'suggestions'],
  };
}

export function parseJSON(t) {
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('JSONがありません');
  return JSON.parse(t.slice(a, b + 1));
}

// AIの解析結果を、新しい関係と解説に変える。存在しないIDと既存のペアは無視する。
export function applyAnalysis(sel, res, events, links, cats) {
  const ids = new Set(events.map(x => x.id));
  const catIds = new Set(cats.map(c => c.id));
  const all = [...links];
  const has = (a, b) => all.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  const added = [];
  for (const r of (res.relations || []).slice(0, 5)) {
    if (!r || !ids.has(r.id) || r.id === sel || has(r.id, sel)) continue;
    const l = r.kind === '原因'
      ? { id: linkId(r.id, sel), from: r.id, to: sel, note: r.note || '', src: 'ai' }
      : { id: linkId(sel, r.id), from: sel, to: r.id, note: r.note || '', src: 'ai', ...(r.kind === '並行' ? { para: true } : {}) };
    all.push(l); added.push(l);
  }
  const suggestions = (res.suggestions || [])
    .filter(x => x && x.title && Number.isFinite(+x.year) && +x.year !== 0 && catIds.has(x.cat))
    .map(x => ({ year: Math.round(+x.year), month: x.month ? Math.round(+x.month) : null, title: String(x.title), cat: x.cat, reason: String(x.reason || '') }));
  return { added, ai: { id: sel, summary: String(res.summary || ''), suggestions } };
}

// AIの提案を出来事にし、対象との関係(年代順で向きを決める)を作る
export function suggestionToEvent(s, target, id) {
  const y = Math.max(TMIN, Math.min(MAX_YEAR, Math.round(+s.year)));
  const m = s.month >= 1 && s.month <= 12 ? Math.round(+s.month) : 0;
  const ev = { id, y, m, d: 0, cat: s.cat, title: s.title, detail: s.reason || '' };
  const link = tOf(ev) < tOf(target)
    ? { id: linkId(id, target.id), from: id, to: target.id, note: s.reason || '', src: 'ai' }
    : { id: linkId(target.id, id), from: target.id, to: id, note: s.reason || '', src: 'ai' };
  return { ev, link };
}

export function chatSystem(ea, eb, cats) {
  const name = Object.fromEntries(cats.map(c => [c.id, c.name]));
  return 'あなたは科学技術史の専門家として、年表アプリの利用者に2つの出来事の関係を解説します。日本語で、300字以内で簡潔に答えてください。推測は推測と明示し、マークダウン記号は使わないでください。\n' +
    `出来事A: ${fmtRange(ea)} ${ea.title}（${name[ea.cat] || ''}）${ea.detail || ''}\n` +
    `出来事B: ${fmtRange(eb)} ${eb.title}（${name[eb.cat] || ''}）${eb.detail || ''}`;
}
export const firstQuestion = (ea, eb) => `「${ea.title}」と「${eb.title}」の関係を、因果のつながり、共通する技術や人物、時代背景の観点から説明してください。`;
export const QUICK = ['間をつなぐ出来事は？', 'どちらか一方がなかったら？', '同時代の他分野では？'];

// ---- ピンチ ----
// 指の間隔の比をそのまま倍率にする(連続)。
export const pinchPpy = (ppy0, ratio) => clampPpy(ppy0 * ratio);

// カテゴリ削除の可否
export function catDeleteBlock(cat, cats, events) {
  const n = events.filter(e => e.cat === cat.id).length;
  if (n) return `「${cat.name}」には${n}件の出来事があるため削除できません。先に出来事を移すか削除してください。`;
  if (cats.length <= 1) return 'カテゴリは1件以上必要です。';
  return '';
}

// サンプル(初期データ)を消すときの対象。初期データのidの出来事と、それに触れる関係・AIの解説、初期データの関係。
// カテゴリはレーンとして使い続けるので残す。
export function sampleTargets(events, links, ai, seedEventIds, seedLinkIds) {
  const seedEv = new Set(seedEventIds), seedLn = new Set(seedLinkIds);
  const eventIds = events.filter(e => seedEv.has(e.id)).map(e => e.id);
  const gone = new Set(eventIds);
  const linkIds = links.filter(l => seedLn.has(l.id) || gone.has(l.from) || gone.has(l.to)).map(l => l.id);
  const aiIds = Object.keys(ai).filter(id => gone.has(id));
  return { eventIds, linkIds, aiIds };
}

// ---- 検索 ----
// 全角半角・大小文字・ひらがなカタカナの違いを無視して比べる
export function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s+/g, ' ').trim();
}
// 年として読める語: 1969 / 1969年 / 前300 / 紀元前300年 / BC300 / -300
function yearOf(term) {
  const m = term.match(/^(?:(紀元前|前|bc|-)\s*)?(\d{1,4})年?$/);
  if (!m) return null;
  return m[1] ? -Number(m[2]) : Number(m[2]);
}
// 空白区切りの語をすべて含む出来事を、年代順に返す。年の語は、その年に当たる出来事(期間なら範囲内)にも当たる。
export function searchEvents(events, cats, query) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const catName = Object.fromEntries(cats.map(c => [c.id, c.name]));
  const out = [];
  for (const e of events) {
    const fields = [
      ['title', e.title], ['cat', catName[e.cat]], ['detail', e.detail], ['memo', e.memo],
      ['sources', (e.sources || []).map(x => `${x.title} ${x.quote || ''}`).join(' ')], ['by', e.by], ['date', fmtRange(e)],
    ].map(([k, v]) => [k, normalize(v)]);
    let ok = true, score = 0, hitField = null;
    for (const t of terms) {
      const y = yearOf(t);
      const inYear = y !== null && (e.ey ? (y >= e.y && y <= e.ey) : y === e.y);
      const f = fields.find(([, v]) => v.includes(t));
      if (!f && !inYear) { ok = false; break; }
      if (f) { score += f[0] === 'title' ? 3 : 1; if (!hitField || hitField === 'title' || hitField === 'cat' || hitField === 'date') hitField = f[0]; }
      else score += 2;
    }
    if (!ok) continue;
    const src = { detail: e.detail, memo: e.memo, sources: (e.sources || []).map(x => x.title).join(' / '), by: e.by }[hitField];
    out.push({ id: e.id, score, t: tOf(e), snippet: src ? snippet(src, terms) : '' });
  }
  return out.sort((a, b) => a.t - b.t);
}
// 当たった語のまわり(前後30字ほど)を切り出す
export function snippet(text, terms, span = 30) {
  const s = String(text || ''), n = normalize(s);
  let at = -1;
  for (const t of terms) { at = n.indexOf(t); if (at >= 0) break; }
  if (at < 0 || s.length <= span * 2) return s.slice(0, span * 2);
  const a = Math.max(0, at - span), b = Math.min(s.length, at + span);
  return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '');
}
