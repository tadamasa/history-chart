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
 */

const KINDS = ['cats', 'events', 'links', 'ai'];
const COLS = {
  cats: ['id', 'rev', 'mtime', 'deleted', 'name', 'glyph', 'order', 'json'],
  events: ['id', 'rev', 'mtime', 'deleted', 'year', 'month', 'day', 'endYear', 'endMonth', 'endDay', 'cat', 'title', 'detail', 'json'],
  links: ['id', 'rev', 'mtime', 'deleted', 'from', 'to', 'kind', 'note', 'src', 'json'],
  ai: ['id', 'rev', 'mtime', 'deleted', 'summary', 'suggestions', 'json'],
};
const PAGE = 400; // 1回の応答で返す最大件数

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  KINDS.forEach(k => sheet_(k));
  Logger.log('合言葉: ' + props.getProperty('TOKEN'));
}

function doGet() {
  return json_({ ok: true, app: 'history-chart-hub' });
}

// 受け取る: { token, since, cats: [{id, mtime, deleted, data}], events: [...], links: [...], ai: [...] }
// 返す:     { ok, rev, more, cats: [...], events: [...], links: [...], ai: [...] }  (rev が since より新しいもの)
function doPost(e) {
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
  if (name === 'events') return head.concat([d.y ?? '', d.m || '', d.d || '', d.ey || '', d.em || '', d.ed || '', d.cat || '', d.title || '', d.detail || '', tail]);
  if (name === 'links') return head.concat([d.from || '', d.to || '', d.para ? '並行' : (d.from ? '因果' : ''), d.note || '', d.src || '', tail]);
  return head.concat([d.summary || '', d.suggestions ? d.suggestions.map(s => s.title).join(' / ') : '', tail]);
}

// 1セルは5万字まで
function cell_(obj) {
  const s = JSON.stringify(obj);
  return s.length < 49000 ? s : JSON.stringify(Object.assign({}, obj, { detail: String(obj.detail || '').slice(0, 20000) }));
}

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
  }
  return sh;
}

function parse_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
