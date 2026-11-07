/**
 * 年表ハブ: 年表アプリ(https://tadamasa.github.io/history-chart/)のカテゴリ・出来事・関係・AIの解説を、
 * このスプレッドシートに同期する受け口。読書メモ(reading-memo)のハブを4種類に一般化したもの。
 *
 * 使い方は hub/README.md を参照。
 *  1. 新しいスプレッドシート → 拡張機能 → Apps Script に、このファイルを貼る
 *  2. setup を一度実行(合言葉が実行ログに出る)
 *  3. デプロイ → 新しいデプロイ → ウェブアプリ(実行ユーザー: 自分、アクセス: 全員)
 *  4. 出たURLと合言葉を、年表アプリの設定に入れる
 *
 * 各シートは人やほかのApps Scriptが読める表になっている。最後の列 json がアプリの元データ(json が正)。
 *
 * 外部からの登録API(出来事と因果関係): 同期の合言葉とは別の「APIキー」を URL の ?key= で渡す。
 *   POST  …/exec?key=APIキー        本文 { events: [...], links: [...] }  → 登録(すべて検証してから書く)
 *   POST  …/exec?key=APIキー&dryRun=1                                     → 検証だけ
 *   GET   …/exec?key=APIキー&action=cats | events                        → カテゴリ / 出来事の一覧
 * 書いた行には新しい rev を振るので、アプリは次の同期で受け取る。詳しくは hub/README.md。
 */

const KINDS = ['cats', 'events', 'links', 'ai'];
const COLS = {
  cats: ['id', 'rev', 'mtime', 'deleted', 'name', 'glyph', 'order', 'json'],
  events: ['id', 'rev', 'mtime', 'deleted', 'year', 'month', 'day', 'endYear', 'endMonth', 'endDay', 'cat', 'title', 'detail', 'memo', 'sources', 'by', 'json'],
  links: ['id', 'rev', 'mtime', 'deleted', 'from', 'to', 'kind', 'note', 'src', 'confidence', 'memo', 'sources', 'by', 'json'],
  ai: ['id', 'rev', 'mtime', 'deleted', 'summary', 'suggestions', 'json'],
};
const PAGE = 400; // 1回の応答で返す最大件数

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', newKey_());
  KINDS.forEach(k => sheet_(k));
  Logger.log('合言葉(アプリの同期用): ' + props.getProperty('TOKEN'));
  Logger.log('APIキー(外部からの登録用): ' + props.getProperty('API_KEY'));
}

// APIキーが漏れたかもしれないときに実行する。古いキーは使えなくなる。同期の合言葉は変わらない。
function rotateApiKey() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('API_KEY', newKey_());
  Logger.log('新しいAPIキー: ' + props.getProperty('API_KEY'));
}

function newKey_() { return 'hc_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== undefined) return json_(apiGet_(p));
  return json_({ ok: true, app: 'history-chart-hub' });
}

// 受け取る: { token, since, cats: [{id, mtime, deleted, data}], events: [...], links: [...], ai: [...] }
// 返す:     { ok, rev, more, cats: [...], events: [...], links: [...], ai: [...] }  (rev が since より新しいもの)
function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== undefined) return json_(apiPost_(p, e.postData ? e.postData.contents : ''));
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    let rev = Number(props.getProperty('REV') || 0);
    const since = Number(req.since || 0);
    const fresh = [];
    for (const name of KINDS) {
      const cols = COLS[name];
      const sh = sheet_(name);
      const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues() : [];
      const index = {};
      values.forEach((r, i) => { index[r[0]] = i; });
      let changed = false;
      for (const item of req[name] || []) {
        if (!item || !item.id) continue;
        const i = index[item.id];
        if (i !== undefined && Number(values[i][2]) > Number(item.mtime || 0)) continue; // 表のほうが新しい
        rev += 1;
        const row = row_(name, item, rev);
        if (i === undefined) { index[item.id] = values.length; values.push(row); } else values[i] = row;
        changed = true;
      }
      if (changed) {
        const need = values.length + 1 - sh.getMaxRows();
        if (need > 0) { sh.insertRowsAfter(sh.getMaxRows(), need); sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); }
        sh.getRange(2, 1, values.length, cols.length).setValues(values);
      }
      for (const r of values) if (Number(r[1]) > since) fresh.push({ name, rev: Number(r[1]), r, last: cols.length - 1 });
    }
    props.setProperty('REV', String(rev));
    fresh.sort((x, y) => x.rev - y.rev);
    const page = fresh.slice(0, PAGE);
    const out = { ok: true, more: fresh.length > PAGE, rev: fresh.length > PAGE ? page[page.length - 1].rev : rev };
    KINDS.forEach(k => { out[k] = []; });
    for (const f of page) {
      const deleted = String(f.r[3]) === 'true';
      out[f.name].push({ id: String(f.r[0]), mtime: Number(f.r[2]), deleted, data: deleted ? null : parse_(f.r[f.last]) });
    }
    return json_(out);
  } finally {
    lock.releaseLock();
  }
}

function row_(name, item, rev) {
  const d = item.deleted ? {} : (item.data || {});
  const head = [item.id, String(rev), String(Number(item.mtime || 0)), String(!!item.deleted)];
  const tail = item.deleted ? '' : cell_(d);
  if (name === 'cats') return head.concat([d.name || '', d.glyph || '', d.order ?? '', tail]);
  if (name === 'events') return head.concat([d.y ?? '', d.m || '', d.d || '', d.ey || '', d.em || '', d.ed || '', d.cat || '', d.title || '', d.detail || '', d.memo || '', srcText_(d.sources), d.by || '', tail]);
  if (name === 'links') return head.concat([d.from || '', d.to || '', d.para ? '並行' : (d.from ? '因果' : ''), d.note || '', d.src || '', CONF_LABEL[d.confidence] || '', d.memo || '', srcText_(d.sources), d.by || '', tail]);
  return head.concat([d.summary || '', d.suggestions ? d.suggestions.map(s => s.title).join(' / ') : '', tail]);
}

// 1セルは5万字まで
function cell_(obj) {
  const s = JSON.stringify(obj);
  return s.length < 49000 ? s : JSON.stringify(Object.assign({}, obj, { detail: String(obj.detail || '').slice(0, 20000) }));
}

const CONF_LABEL = { certain: '確実', likely: '有力', speculative: '推測' };
// 出典を表で読める1行に: 題名 <URL> / …
function srcText_(list) { return (list || []).map(x => x.title + (x.url ? ' <' + x.url + '>' : '')).join(' / '); }

function sheet_(name) {
  const cols = COLS[name];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // 年や日付が勝手に変換されないよう、すべて書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  migrate_(sh, cols);
  return sh;
}

// 版が上がって列が増えたシートを、見出しの名前で新しい並びに移す(json が最後の列であり続けるように)
function migrate_(sh, cols) {
  const width = Math.max(sh.getLastColumn ? sh.getLastColumn() : cols.length, 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  if (head.slice(0, cols.length).join('\t') === cols.join('\t')) return;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const at = {};
  head.forEach((h, i) => { at[h] = i; });
  const moved = rows.map(r => cols.map(c => (at[c] === undefined ? '' : r[at[c]])));
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(width, cols.length)).setNumberFormat('@');
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  if (moved.length) sh.getRange(2, 1, moved.length, cols.length).setValues(moved);
  if (width > cols.length) sh.getRange(1, cols.length + 1, rows.length + 1, width - cols.length).setValues(Array.from({ length: rows.length + 1 }, () => Array(width - cols.length).fill('')));
}

function parse_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────── 外部からの登録API ─────────────────────────

const API_MAX_EVENTS = 200;
const DEFAULT_CATS = [{ id: 'phys', name: '数理・物理' }, { id: 'life', name: '生命・化学' }, { id: 'info', name: '情報・通信' }, { id: 'eng', name: '工学・エネルギー' }];
const API_MAX_LINKS = 400;
const TMIN = -3300;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function apiAuth_(p) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!key && typeof p.key === 'string' && p.key === key;
}

// 表の行(削除済みを除く)を json 列から読む
function liveRows_(name) {
  const cols = COLS[name], sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues()
    .filter(r => r[0] && String(r[3]) !== 'true')
    .map(r => parse_(r[cols.length - 1])).filter(Boolean);
}

function apiGet_(p) {
  if (!apiAuth_(p)) return { ok: false, error: 'unauthorized' };
  if (p.action === 'cats') return { ok: true, cats: (liveRows_('cats').length ? liveRows_('cats') : DEFAULT_CATS).sort((a, b) => (a.order || 0) - (b.order || 0)).map(c => ({ id: c.id, name: c.name })) };
  if (p.action === 'events') return { ok: true, events: liveRows_('events').map(ev => ({ id: ev.id, year: ev.y, month: ev.m || null, day: ev.d || null, endYear: ev.ey || null, cat: ev.cat, title: ev.title })) };
  return { ok: false, error: 'action は cats か events を指定してください' };
}

// アプリの入力検証(js/core.js の validateForm)と同じ規則・同じ文言。変えるときは両方を直す(tests/hub.test.mjs が突き合わせる)。
function validateForm_(f, maxYear) {
  const err = {};
  const int = s => (String(s == null ? '' : s).trim() === '' ? NaN : Number(String(s).trim()));
  const y = int(f.year), m = f.month ? int(f.month) : 0, d = f.day ? int(f.day) : 0;
  const range = '紀元前' + (-TMIN) + '年〜' + maxYear + '年の範囲で入力してください';
  if (!String(f.year == null ? '' : f.year).trim() || !Number.isInteger(y) || y < 1) err.date = '年を入力してください';
  else if (f.era === 'BC' ? y > -TMIN : y > maxYear) err.date = range;
  else if (f.month && !(Number.isInteger(m) && m >= 1 && m <= 12)) err.date = '月は1〜12で入力してください';
  else if (f.day && !(Number.isInteger(d) && d >= 1 && d <= 31)) err.date = '日は1〜31で入力してください';
  else if (f.day && !f.month) err.date = '日を入れる場合は月も入力してください';
  const sy = f.era === 'BC' ? -y : y;
  let end = null;
  if (!err.date && f.hasEnd) {
    const y2 = int(f.eYear), em = f.eMonth ? int(f.eMonth) : 0, ed = f.eDay ? int(f.eDay) : 0;
    const ey = f.eEra === 'BC' ? -y2 : y2;
    if (!String(f.eYear == null ? '' : f.eYear).trim() || !Number.isInteger(y2) || y2 < 1) err.date = '終了年を入力してください';
    else if (f.eEra === 'BC' ? y2 > -TMIN : y2 > maxYear) err.date = '終了は' + range;
    else if (f.eMonth && !(Number.isInteger(em) && em >= 1 && em <= 12)) err.date = '終了月は1〜12で入力してください';
    else if (f.eDay && !(Number.isInteger(ed) && ed >= 1 && ed <= 31)) err.date = '終了日は1〜31で入力してください';
    else if (f.eDay && !f.eMonth) err.date = '終了日を入れる場合は終了月も入力してください';
    else if (tEnd_({ ey: ey, em: em, ed: ed }) <= tOf_({ y: sy, m: m, d: d })) err.date = '終了は開始より後にしてください';
    else end = { ey: ey, em: em, ed: ed };
  }
  if (!String(f.title == null ? '' : f.title).trim()) err.title = '出来事を入力してください';
  if (Object.keys(err).length) return { err: err };
  const ev = { y: sy, m: m, d: d };
  if (end) Object.assign(ev, end);
  return { err: err, ev: Object.assign(ev, { cat: f.cat, title: String(f.title).trim(), detail: String(f.detail || '').trim() }) };
}
function tOf_(e) { return e.y + (e.m ? (e.m - 1) / 12 + (e.d ? (e.d - 1) / 365 : 0.04) : 0.5); }
function tEnd_(e) { return e.ey + (e.em ? (e.em - 1) / 12 + (e.ed ? (e.ed - 1) / 365 : 1 / 12) : 1); }

// API の出来事(年は紀元前を負の数) → アプリのフォームの形
function apiToForm_(x) {
  const has = v => v !== undefined && v !== null && v !== '' && v !== 0;
  const yr = Number(x.year), ey = Number(x.endYear);
  return {
    era: yr < 0 ? 'BC' : 'AD', year: has(x.year) && Number.isFinite(yr) ? String(Math.abs(yr)) : String(x.year == null ? '' : x.year),
    month: has(x.month) ? String(x.month) : '', day: has(x.day) ? String(x.day) : '',
    hasEnd: has(x.endYear), eEra: ey < 0 ? 'BC' : 'AD', eYear: has(x.endYear) && Number.isFinite(ey) ? String(Math.abs(ey)) : String(x.endYear == null ? '' : x.endYear),
    eMonth: has(x.endMonth) ? String(x.endMonth) : '', eDay: has(x.endDay) ? String(x.endDay) : '',
    title: x.title == null ? '' : String(x.title), detail: x.detail == null ? '' : String(x.detail), cat: '',
  };
}

const CONF_WORDS = { certain: 'certain', '確実': 'certain', likely: 'likely', '有力': 'likely', speculative: 'speculative', '推測': 'speculative' };

// 根拠の欄(出来事・関係で共通): memo(備考), sources(出典), by(登録元)。関係だけ confidence(確からしさ)。
// 誤りは errors に積み、正しければアプリに入れる形を返す。
function provenance_(x, at, errors, defaultBy, isLink) {
  const out = {};
  if (x.memo !== undefined && x.memo !== null && x.memo !== '') {
    if (typeof x.memo !== 'string' || x.memo.length > 2000) errors.push({ at: at + '.memo', message: 'memo(備考)は2000字以内の文字列です' });
    else out.memo = x.memo.trim();
  }
  if (x.sources !== undefined && x.sources !== null) {
    const list = Array.isArray(x.sources) ? x.sources : [x.sources];
    if (list.length > 10) errors.push({ at: at + '.sources', message: 'sources(出典)は10件までです' });
    const clean = [];
    list.slice(0, 10).forEach((src, k) => {
      const one = typeof src === 'string' ? (/^https?:\/\//.test(src) ? { title: src, url: src } : { title: src }) : src;
      const a = at + '.sources[' + k + ']';
      if (!one || typeof one !== 'object' || typeof one.title !== 'string' || !one.title.trim() || one.title.length > 300) { errors.push({ at: a, message: '出典には title(300字以内)が要ります' }); return; }
      if (one.url !== undefined && one.url !== '' && !(typeof one.url === 'string' && /^https?:\/\/\S+$/.test(one.url) && one.url.length <= 1000)) { errors.push({ at: a + '.url', message: 'url は http(s):// で始まるURLです' }); return; }
      if (one.quote !== undefined && one.quote !== '' && !(typeof one.quote === 'string' && one.quote.length <= 500)) { errors.push({ at: a + '.quote', message: 'quote(引用)は500字以内です' }); return; }
      const c = { title: one.title.trim() };
      if (one.url) c.url = one.url;
      if (one.quote) c.quote = one.quote.trim();
      clean.push(c);
    });
    if (clean.length) out.sources = clean;
  }
  if (isLink && x.confidence !== undefined && x.confidence !== null && x.confidence !== '') {
    const c = CONF_WORDS[String(x.confidence).toLowerCase()] || CONF_WORDS[x.confidence];
    if (!c) errors.push({ at: at + '.confidence', message: 'confidence は certain(確実)・likely(有力)・speculative(推測)のどれかです' });
    else out.confidence = c;
  }
  const by = x.by !== undefined ? x.by : defaultBy;
  if (by !== undefined && by !== null && by !== '') {
    if (typeof by !== 'string' || by.length > 100) errors.push({ at: at + '.by', message: 'by(登録元)は100字以内の文字列です' });
    else out.by = by.trim();
  }
  return out;
}

const CAUSE_WORDS = { cause: 'cause', causal: 'cause', '因果': 'cause', '原因': 'cause', parallel: 'parallel', '並行': 'parallel' };

// 受け取る: { events: [{ id?, year, month?, day?, endYear?, endMonth?, endDay?, cat, title, detail? }],
//            links:  [{ from, to, kind?: 'cause'|'parallel', note?, confidence? }],
//            by?: '登録元(全件の既定)' }
//   - 出来事にも関係にも memo(備考), sources(出典 [{title, url?, quote?}]), by(登録元)を付けられる。
//   - year は紀元前を負の数(紀元前300年 = -300)。0年はない。
//   - cat はカテゴリの id か名前。
//   - id を付けると、その id の出来事を上書きする(再送しても重複しない)。省けば新しく作る。
//   - links の from/to は、出来事の id か、題名(完全一致・1件だけのとき)。同じ本文の events の id/題名も使える。
//     cause は from が原因で to が結果。parallel は向きなし。
// すべて検証してから書く。1件でも誤りがあれば何も書かず、errors を返す。
function apiPost_(p, body) {
  if (!apiAuth_(p)) return { ok: false, error: 'unauthorized' };
  let req;
  try { req = JSON.parse(body || '{}'); } catch (err) { return { ok: false, error: 'bad json' }; }
  const inEvents = Array.isArray(req.events) ? req.events : [];
  const inLinks = Array.isArray(req.links) ? req.links : [];
  if (!inEvents.length && !inLinks.length) return { ok: false, error: 'events か links を1件以上入れてください' };
  if (inEvents.length > API_MAX_EVENTS || inLinks.length > API_MAX_LINKS) return { ok: false, error: '1回に送れるのは出来事' + API_MAX_EVENTS + '件・関係' + API_MAX_LINKS + '件までです' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const maxYear = Math.max(2026, new Date().getFullYear());
    // アプリがまだ一度も同期していなければ、表にカテゴリがない。そのときは初期のカテゴリを使う
    const cats = liveRows_('cats').length ? liveRows_('cats') : DEFAULT_CATS;
    const catOf = v => cats.find(c => c.id === v) || cats.filter(c => c.name === v).length === 1 && cats.find(c => c.name === v);
    const existing = liveRows_('events');
    const byId = {};
    existing.forEach(ev => { byId[ev.id] = ev; });
    const errors = [];
    const now = Date.now();

    // 出来事
    const outEvents = [];
    const seenIds = {};
    inEvents.forEach((x, i) => {
      if (!x || typeof x !== 'object') { errors.push({ at: 'events[' + i + ']', message: '出来事はオブジェクトで送ってください' }); return; }
      if (x.id !== undefined && !(typeof x.id === 'string' && ID_RE.test(x.id))) { errors.push({ at: 'events[' + i + '].id', message: 'id は英数字と _.:- の64文字以内です' }); return; }
      if (x.id && seenIds[x.id]) { errors.push({ at: 'events[' + i + '].id', message: '同じ id が本文に2回あります: ' + x.id }); return; }
      if (Number(x.year) === 0) { errors.push({ at: 'events[' + i + '].year', message: '0年はありません(紀元前1年は -1、西暦1年は 1)' }); return; }
      const cat = catOf(x.cat);
      if (!cat) { errors.push({ at: 'events[' + i + '].cat', message: 'カテゴリが見つかりません: ' + x.cat + '(使えるもの: ' + cats.map(c => c.id + '=' + c.name).join(', ') + ')' }); return; }
      const f = apiToForm_(x); f.cat = cat.id;
      const r = validateForm_(f, maxYear);
      if (!r.ev) { Object.keys(r.err).forEach(k => errors.push({ at: 'events[' + i + ']', message: r.err[k] })); return; }
      const n0 = errors.length;
      const prov = provenance_(x, 'events[' + i + ']', errors, req.by, false);
      if (errors.length > n0) return;
      const id = x.id || ('api-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12));
      seenIds[id] = true;
      outEvents.push({ i: i, status: byId[id] ? 'updated' : 'added', data: Object.assign({ id: id }, r.ev, prov) });
    });

    // 関係の端点: 本文の出来事 → 既存の出来事、id → 題名の順で探す
    const pool = existing.filter(ev => !seenIds[ev.id]).concat(outEvents.map(o => o.data));
    const resolve = v => {
      if (typeof v !== 'string' || !v.trim()) return { err: '出来事の id か題名を入れてください' };
      const s = v.trim();
      const hit = pool.find(ev => ev.id === s);
      if (hit) return { id: hit.id };
      const byTitle = pool.filter(ev => ev.title === s);
      if (byTitle.length === 1) return { id: byTitle[0].id };
      return { err: byTitle.length ? '同じ題名の出来事が' + byTitle.length + '件あります。id で指定してください: ' + s : '出来事が見つかりません: ' + s };
    };
    const links = liveRows_('links');
    const pairs = {};
    links.forEach(l => { pairs[l.from + '\n' + l.to] = l; pairs[l.to + '\n' + l.from] = l; });
    const outLinks = [];
    inLinks.forEach((x, i) => {
      if (!x || typeof x !== 'object') { errors.push({ at: 'links[' + i + ']', message: '関係はオブジェクトで送ってください' }); return; }
      const a = resolve(x.from), b = resolve(x.to);
      if (a.err) { errors.push({ at: 'links[' + i + '].from', message: a.err }); return; }
      if (b.err) { errors.push({ at: 'links[' + i + '].to', message: b.err }); return; }
      if (a.id === b.id) { errors.push({ at: 'links[' + i + ']', message: '同じ出来事どうしは結べません' }); return; }
      const kind = x.kind === undefined ? 'cause' : CAUSE_WORDS[String(x.kind).toLowerCase()] || CAUSE_WORDS[x.kind];
      if (!kind) { errors.push({ at: 'links[' + i + '].kind', message: 'kind は cause(因果)か parallel(並行)です' }); return; }
      const n0 = errors.length;
      const prov = provenance_(x, 'links[' + i + ']', errors, req.by, true);
      if (errors.length > n0) return;
      const id = a.id + '>' + b.id;
      const prev = pairs[a.id + '\n' + b.id];
      if (prev) {
        // 既にある関係: 向きと説明はそのまま。根拠の欄が送られていれば足す(出典は重ならないように加える)
        const hasProv = prov.memo || prov.sources || prov.confidence;
        if (!hasProv || prev === true) { outLinks.push({ i: i, status: 'exists', id: prev.id || id }); return; }
        const merged = Object.assign({}, prev, prov);
        if (prev.memo && prov.memo && prev.memo !== prov.memo) merged.memo = prev.memo + '\n' + prov.memo;
        if (prev.sources && prov.sources) {
          const seen = {};
          merged.sources = prev.sources.concat(prov.sources).filter(x => { const k = x.url || x.title; if (seen[k]) return false; seen[k] = true; return true; }).slice(0, 20);
        }
        outLinks.push({ i: i, status: 'updated', id: prev.id, data: merged });
        return;
      }
      pairs[a.id + '\n' + b.id] = true; pairs[b.id + '\n' + a.id] = true;
      const data = Object.assign({ id: id, from: a.id, to: b.id, note: String(x.note || '').slice(0, 500), src: 'api' }, prov);
      if (kind === 'parallel') data.para = true;
      outLinks.push({ i: i, status: 'added', id: id, data: data });
    });

    if (errors.length) return { ok: false, error: 'invalid', errors: errors };
    const result = {
      ok: true, dryRun: !!p.dryRun && p.dryRun !== '0',
      events: outEvents.map(o => ({ index: o.i, id: o.data.id, title: o.data.title, status: o.status })),
      links: outLinks.map(o => ({ index: o.i, id: o.id, status: o.status })),
    };
    if (result.dryRun) return result;
    const props = PropertiesService.getScriptProperties();
    let rev = Number(props.getProperty('REV') || 0);
    rev = writeRows_('events', outEvents.map(o => ({ id: o.data.id, mtime: now, data: o.data })), rev);
    rev = writeRows_('links', outLinks.filter(o => o.data).map(o => ({ id: o.id, mtime: now, data: o.data })), rev);
    props.setProperty('REV', String(rev));
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 行を追加・上書きして rev を振る(同期の doPost と同じ書き方)
function writeRows_(name, items, rev) {
  if (!items.length) return rev;
  const cols = COLS[name], sh = sheet_(name);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues() : [];
  const index = {};
  values.forEach((r, i) => { index[r[0]] = i; });
  for (const item of items) {
    rev += 1;
    const row = row_(name, item, rev);
    if (index[item.id] === undefined) { index[item.id] = values.length; values.push(row); } else values[index[item.id]] = row;
  }
  const need = values.length + 1 - sh.getMaxRows();
  if (need > 0) { sh.insertRowsAfter(sh.getMaxRows(), need); sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); }
  sh.getRange(2, 1, values.length, cols.length).setValues(values);
  return rev;
}
