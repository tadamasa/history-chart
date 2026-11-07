// 年表ハブ(自分のGoogleスプレッドシート + Apps Script)との自動同期。
// 端末内のIndexedDBが正で、変わったものだけを送り、ハブで変わったものだけを受け取る。
// 同じものを二つの端末で直したときは、mtime(最後に書いた時刻)が新しい方を残す。
// 下敷き: github.com/tadamasa/reading-memo の js/sync.js(ストアを4つに一般化)。
import * as db from './db.js';

const STORES = db.SYNCED_STORES; // cats, events, links, ai
const BATCH = 300; // 1回に送る件数
const empty = () => Object.fromEntries(STORES.map(n => [n, {}]));
let dirty = empty(); // 未送信: { store: { id: { mtime, deleted } } }
let cfg = { url: '', token: '' };
let timer = null;
let running = null;
let saveTimer = null;
let onRemoteChange = () => {};
const listeners = new Set();
export const status = { state: 'off', lastAt: null, error: '', pending: 0 };

const pendingCount = () => STORES.reduce((n, s) => n + Object.keys(dirty[s]).length, 0);
function emit() {
  status.pending = pendingCount();
  listeners.forEach(fn => fn(status));
}
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function saveDirty() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.setMeta('syncDirty', dirty), 300);
}

function mark(name, changes) {
  for (const c of changes) dirty[name][c.id] = { mtime: c.mtime || Date.now(), deleted: !!c.deleted };
  saveDirty();
  emit();
  schedule();
}

export async function initSync(opts = {}) {
  if (opts.onRemoteChange) onRemoteChange = opts.onRemoteChange;
  const [url, token, saved, lastAt] = await Promise.all([db.getMeta('syncUrl', ''), db.getMeta('syncToken', ''), db.getMeta('syncDirty'), db.getMeta('syncLastAt')]);
  cfg = { url: url || '', token: token || '' };
  if (saved) for (const s of STORES) dirty[s] = saved[s] || {};
  status.state = cfg.url ? 'idle' : 'off';
  status.lastAt = lastAt;
  db.onChange(mark);
  emit();
}

export function enabled() { return !!(cfg.url && cfg.token); }
export function config() { return { ...cfg }; }

// 書いてから少し待ってまとめて送る
export function schedule(delay = 4000) {
  if (!enabled()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

async function post(body) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    // text/plain にすると事前確認(CORS preflight)が要らず、Apps Scriptで受けられる
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`年表ハブ HTTP ${res.status}`);
  let data;
  try { data = await res.json(); } catch { throw new Error('年表ハブの応答を読めませんでした(URLが正しいか、デプロイのアクセスが「全員」か確かめてください)'); }
  if (!data.ok) throw new Error(data.error === 'unauthorized' ? '合言葉が違います' : `年表ハブ: ${data.error}`);
  return data;
}

function takeBatch() {
  const out = empty();
  let n = 0;
  for (const name of STORES) {
    for (const [id, d] of Object.entries(dirty[name])) {
      if (n >= BATCH) return out;
      out[name][id] = d;
      n++;
    }
  }
  return out;
}

async function apply(name, items) {
  let changed = 0;
  for (const it of items) {
    const pending = dirty[name][it.id];
    if (pending && pending.mtime >= it.mtime) continue; // 手元の未送信のほうが新しい
    const local = await db.get(name, it.id);
    if (local && (local.mtime || 0) > it.mtime) continue;
    if (it.deleted) { if (local) { await db.del(name, it.id, { silent: true }); changed++; } continue; }
    if (!it.data) continue;
    if (local && (local.mtime || 0) === it.mtime) continue; // 同じもの
    it.data.mtime = it.mtime;
    await db.put(name, it.data, { silent: true });
    changed++;
  }
  return changed;
}

export function syncNow() {
  if (!enabled()) return Promise.resolve(0);
  if (running) return running;
  running = (async () => {
    status.state = 'syncing'; status.error = ''; emit();
    let changed = 0;
    try {
      let cursor = Number(await db.getMeta('syncCursor', 0)) || 0;
      for (let guard = 0; guard < 100; guard++) {
        const batch = takeBatch();
        const body = { token: cfg.token, since: cursor };
        for (const name of STORES) {
          body[name] = [];
          for (const [id, d] of Object.entries(batch[name])) {
            const rec = d.deleted ? null : await db.get(name, id);
            body[name].push(rec ? { id, mtime: rec.mtime || d.mtime, data: rec } : { id, mtime: d.mtime, deleted: true });
          }
        }
        const res = await post(body);
        for (const name of STORES) {
          // 送っている間に書き直されたものは、次の回に送る
          for (const item of body[name]) if (dirty[name][item.id] && dirty[name][item.id].mtime <= item.mtime) delete dirty[name][item.id];
        }
        for (const name of STORES) changed += await apply(name, res[name] || []);
        cursor = res.rev;
        await db.setMeta('syncCursor', cursor);
        saveDirty();
        if (!res.more && !pendingCount()) break;
      }
      status.lastAt = new Date().toISOString();
      await db.setMeta('syncLastAt', status.lastAt);
      status.state = 'idle';
    } catch (e) {
      status.state = 'error';
      status.error = navigator.onLine === false ? 'オフラインです' : e.message;
    } finally {
      running = null;
      emit();
    }
    if (changed) await onRemoteChange(changed);
    return changed;
  })();
  return running;
}

// 接続: 手元のデータをすべて未送信にして、最初から同期する
export async function connect(url, token) {
  cfg = { url: url.trim(), token: token.trim() };
  await db.setMeta('syncUrl', cfg.url);
  await db.setMeta('syncToken', cfg.token);
  await db.setMeta('syncCursor', 0);
  for (const name of STORES) {
    for (const r of await db.getAll(name)) dirty[name][r.id] = { mtime: r.mtime || 1, deleted: false };
  }
  await db.setMeta('syncDirty', dirty);
  status.state = 'idle';
  emit();
  return syncNow();
}

export async function disconnect() {
  cfg = { url: '', token: '' };
  clearTimeout(timer);
  await Promise.all(['syncUrl', 'syncToken', 'syncCursor', 'syncLastAt'].map(k => db.setMeta(k, null)));
  dirty = empty();
  await db.setMeta('syncDirty', dirty);
  status.state = 'off'; status.lastAt = null; status.error = '';
  emit();
}
