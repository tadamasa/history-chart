import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHub } from './gas-mock.mjs';

test('合言葉が違えば断る', () => {
  const hub = loadHub();
  assert.deepEqual(hub.post({ token: 'x', since: 0 }), { ok: false, error: 'unauthorized' });
});

test('4種類を受け取り、rev より新しい分だけ返す。古い書き込みは捨てる', () => {
  const hub = loadHub();
  const ev = { id: 'e1', y: -3200, m: 0, d: 0, cat: 'info', title: '楔形文字', detail: '' };
  let r = hub.post({ token: hub.token, since: 0, cats: [{ id: 'info', mtime: 1, data: { id: 'info', name: '情報', glyph: 'square', order: 0 } }], events: [{ id: 'e1', mtime: 10, data: ev }], links: [{ id: 'a>b', mtime: 5, data: { id: 'a>b', from: 'a', to: 'b', note: 'n', src: 'ai', para: true } }], ai: [{ id: 'e1', mtime: 7, data: { id: 'e1', summary: 's', suggestions: [{ title: 't' }] } }] });
  assert.equal(r.ok, true);
  assert.equal(r.rev, 4);
  assert.equal(r.events[0].data.title, '楔形文字');
  const row = hub.sheets.get('events').rows[1];
  assert.equal(row[4], -3200);
  assert.equal(hub.sheets.get('links').rows[1][6], '並行');
  // 2台目: 古い mtime の更新は捨てられ、削除(墓標)は通る
  r = hub.post({ token: hub.token, since: 4, events: [{ id: 'e1', mtime: 3, data: { ...ev, title: '古い' } }] });
  assert.equal(r.events.length, 0);
  r = hub.post({ token: hub.token, since: 4, events: [{ id: 'e1', mtime: 20, deleted: true }] });
  assert.deepEqual(r.events, [{ id: 'e1', mtime: 20, deleted: true, data: null }]);
  r = hub.post({ token: hub.token, since: 0 });
  assert.equal(r.cats.length + r.events.length + r.links.length + r.ai.length, 4);
});

test('400件を超えたら more を立てて続きを返す。1000行を超えても書ける', () => {
  const hub = loadHub();
  const events = Array.from({ length: 1100 }, (_, i) => ({ id: 'x' + i, mtime: 1, data: { id: 'x' + i, y: 1900, title: 't' + i } }));
  let r = hub.post({ token: hub.token, since: 0, events });
  assert.equal(r.more, true);
  assert.equal(r.events.length, 400);
  let n = 400, since = r.rev;
  while (r.more) { r = hub.post({ token: hub.token, since }); n += r.events.length; since = r.rev; }
  assert.equal(n, 1100);
});
