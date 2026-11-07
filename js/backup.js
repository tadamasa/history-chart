// バックアップ: 全データをJSONにして、iPhoneの共有シート(「ファイル」に保存→iCloud Drive等)へ渡す。
import * as db from './db.js';

const APP = 'history-chart';
// キーと、端末ごとの同期の状態は書き出さない
const SECRET_KEYS = new Set(['geminiKey', 'syncUrl', 'syncToken', 'syncCursor', 'syncDirty', 'syncLastAt']);

export async function exportData() {
  const [cats, events, links, ai, meta] = await Promise.all(['cats', 'events', 'links', 'ai', 'meta'].map(n => db.getAll(n)));
  const payload = { app: APP, version: 1, exportedAt: new Date().toISOString(), cats, events, links, ai, meta: meta.filter(m => !SECRET_KEYS.has(m.key)) };
  const name = `${APP}-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await db.setMeta('lastBackupAt', new Date().toISOString());
  return true;
}

// 取り込み: id が同じものは mtime が新しい方を残す(上書きで消さない)
export async function importData(text) {
  const data = JSON.parse(text);
  if (data.app !== APP) throw new Error('このアプリのバックアップファイルではありません');
  let added = 0;
  for (const name of db.SYNCED_STORES) {
    const current = new Map((await db.getAll(name)).map(x => [x.id, x]));
    const toPut = (data[name] || []).filter(x => x && x.id && (!current.has(x.id) || (x.mtime || 0) > (current.get(x.id).mtime || 0)));
    added += toPut.length;
    if (toPut.length) await db.putMany(name, toPut);
  }
  return added;
}
