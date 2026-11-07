import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHub } from './gas-mock.mjs';
import * as core from '../js/core.js';
import { SEED_CATS, SEED_EVENTS, SEED_LINKS } from '../js/seed.js';

// アプリが一度同期した状態のハブ
function syncedHub() {
  const hub = loadHub();
  hub.post({ token: hub.token, since: 0,
    cats: SEED_CATS.map(c => ({ id: c.id, mtime: 1, data: c })),
    events: SEED_EVENTS.map(e => ({ id: e.id, mtime: 1, data: e })),
    links: SEED_LINKS.map(l => ({ id: l.id, mtime: 1, data: l })) });
  return hub;
}
const key = hub => hub.props.API_KEY;

test('APIキーは同期の合言葉とは別で、違えば断る', () => {
  const hub = syncedHub();
  assert.ok(key(hub) && key(hub) !== hub.token);
  assert.deepEqual(hub.api({ key: 'x' }, { events: [] }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(hub.api({ key: hub.token }, { events: [{ year: 1, cat: 'phys', title: 't' }] }), { ok: false, error: 'unauthorized' });
  assert.equal(hub.apiGet({ key: 'x', action: 'cats' }).ok, false);
  assert.equal(hub.apiGet({}).app, 'history-chart-hub'); // キーなしのGETは今まで通り
});

test('出来事と因果関係をまとめて登録し、同期でアプリに届く', () => {
  const hub = syncedHub();
  const before = hub.post({ token: hub.token, since: 0 }).rev;
  const r = hub.api({ key: key(hub) }, {
    events: [
      { id: 'moore', year: 1965, month: 4, day: 19, cat: 'info', title: 'ムーアの法則', detail: '集積度は約2年で倍になる' },
      { year: -221, cat: '工学・エネルギー', title: '始皇帝の度量衡統一' },
      { year: 1961, month: 5, endYear: 1972, endMonth: 12, cat: 'eng', title: '別のアポロ' },
    ],
    links: [
      { from: 'e26', to: 'moore', kind: 'cause', note: 'トランジスタの微細化' },     // 既存id → 本文id
      { from: 'ムーアの法則', to: 'マイクロプロセッサ 4004' },                       // 題名どうし、kind省略=因果
      { from: 'moore', to: 'e33', kind: '並行' },
      { from: 'e26', to: 'e31' },                                                   // 既にある
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.events.map(e => e.status), ['added', 'added', 'added']);
  assert.match(r.events[1].id, /^api-/);
  assert.deepEqual(r.links.map(l => l.status), ['added', 'added', 'added', 'exists']);
  assert.equal(r.links[1].id, 'moore>e31');
  // アプリの同期で受け取る
  const s = hub.post({ token: hub.token, since: before });
  assert.equal(s.events.length, 3);
  const bc = s.events.find(e => e.data.title === '始皇帝の度量衡統一').data;
  assert.deepEqual([bc.y, bc.m, bc.d, bc.cat], [-221, 0, 0, 'eng']);
  assert.equal(s.links.length, 3);
  assert.ok(s.links.every(l => l.data.src === 'api'));
  assert.equal(s.links.find(l => l.id === 'moore>e33').data.para, true);
  // 同じ id で送り直すと上書き(重複しない)
  const r2 = hub.api({ key: key(hub) }, { events: [{ id: 'moore', year: 1965, cat: 'info', title: 'ムーアの法則(改)' }] });
  assert.equal(r2.events[0].status, 'updated');
  assert.equal(hub.apiGet({ key: key(hub), action: 'events' }).events.filter(e => e.id === 'moore').length, 1);
});

test('1件でも誤りがあれば何も書かない。dryRun は検証だけ', () => {
  const hub = syncedHub();
  const rev0 = hub.props.REV;
  const bad = hub.api({ key: key(hub) }, {
    events: [{ year: 1999, cat: 'info', title: 'OK' }, { year: 1999, month: 13, cat: 'info', title: 'NG' }, { year: 1, cat: 'nope', title: 'x' }, { year: 0, cat: 'info', title: 'zero' }],
    links: [{ from: '存在しない', to: 'e1' }, { from: 'e1', to: 'e1' }, { from: 'e1', to: 'e2', kind: 'maybe' }],
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map(e => e.at), ['events[1]', 'events[2].cat', 'events[3].year', 'links[0].from', 'links[1]', 'links[2].kind']);
  assert.equal(bad.errors[0].message, '月は1〜12で入力してください');
  assert.equal(hub.props.REV, rev0);
  const dry = hub.api({ key: key(hub), dryRun: '1' }, { events: [{ year: 1999, cat: 'info', title: 'OK' }] });
  assert.equal(dry.ok, true); assert.equal(dry.dryRun, true);
  assert.equal(hub.props.REV, rev0);
  assert.equal(hub.api({ key: key(hub) }, 'not json').error, 'bad json');
  assert.equal(hub.api({ key: key(hub) }, {}).ok, false);
});

test('同じ題名が2件あれば id で指定するよう求める', () => {
  const hub = syncedHub();
  hub.api({ key: key(hub) }, { events: [{ id: 'a1', year: 1900, cat: 'phys', title: '同名' }, { id: 'a2', year: 1901, cat: 'phys', title: '同名' }] });
  const r = hub.api({ key: key(hub) }, { links: [{ from: '同名', to: 'e1' }] });
  assert.match(r.errors[0].message, /同じ題名の出来事が2件/);
});

test('アプリ未同期でも初期カテゴリで登録できる。カテゴリ一覧を返す', () => {
  const hub = loadHub();
  const r = hub.api({ key: hub.props.API_KEY }, { events: [{ year: 1687, cat: 'phys', title: 'プリンキピア' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(hub.apiGet({ key: hub.props.API_KEY, action: 'cats' }).cats.map(c => c.id), ['phys', 'life', 'info', 'eng']);
});

test('rotateApiKey で古いキーは使えなくなり、同期の合言葉は変わらない', () => {
  const hub = syncedHub();
  const old = key(hub), tok = hub.token;
  hub.ctx.rotateApiKey();
  assert.notEqual(key(hub), old);
  assert.equal(hub.api({ key: old }, { events: [{ year: 1, cat: 'phys', title: 't' }] }).error, 'unauthorized');
  assert.equal(hub.post({ token: tok, since: 0 }).ok, true);
});

// ハブの検証がアプリ(js/core.js)と同じ答えを返すことを、多数の入力で突き合わせる
test('ハブの入力検証はアプリと同じ規則・同じ文言', () => {
  const hub = loadHub();
  const vals = ['', '0', '1', '12', '13', '31', '32', '1.5', 'abc', '3300', '3301', '2026', '9999', ' 7 '];
  let n = 0;
  for (const era of ['AD', 'BC']) for (const year of vals) for (const month of ['', '1', '12', '13']) for (const day of ['', '5', '32']) for (const end of [null, ['AD', '2000', '', ''], ['BC', '100', '3', ''], ['AD', '', '', ''], ['AD', '1999', '', '4']]) {
    const f = { era, year, month, day, title: n % 7 ? 't' : ' ', cat: 'phys', detail: 'd', hasEnd: !!end, eEra: end?.[0] || 'AD', eYear: end?.[1] || '', eMonth: end?.[2] || '', eDay: end?.[3] || '' };
    const a = core.validateForm(f, 2026), b = JSON.parse(JSON.stringify(hub.ctx.validateForm_(f, 2026)));
    assert.deepEqual(b, JSON.parse(JSON.stringify(a)), JSON.stringify(f));
    n++;
  }
  assert.equal(n, 1680);
});

test('根拠の欄: 備考・出典・確からしさ・登録元を受け取り、表にも読める形で残す', () => {
  const hub = syncedHub();
  const before = Number(hub.props.REV);
  const r = hub.api({ key: key(hub) }, {
    by: 'claude-agent',
    events: [{ id: 'moore', year: 1965, cat: 'info', title: 'ムーアの法則', memo: '論文の図から', sources: ['https://example.org/moore1965.pdf', { title: 'Electronics誌 1965年4月号', quote: 'The complexity for minimum component costs has increased…' }] }],
    links: [{ from: 'e26', to: 'moore', confidence: '有力', memo: '直接の言及はない', sources: [{ title: 'Moore 1965', url: 'https://example.org/moore1965.pdf' }], by: 'gpt-x' }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = hub.post({ token: hub.token, since: before });
  const ev = s.events[0].data, ln = s.links[0].data;
  assert.equal(ev.memo, '論文の図から');
  assert.deepEqual(ev.sources[0], { title: 'https://example.org/moore1965.pdf', url: 'https://example.org/moore1965.pdf' });
  assert.equal(ev.sources[1].quote.startsWith('The complexity'), true);
  assert.equal(ev.by, 'claude-agent');           // 本文の by が既定
  assert.deepEqual([ln.confidence, ln.by], ['likely', 'gpt-x']); // 関係ごとの by が優先
  const head = hub.sheets.get('links').rows[0];
  const row = hub.sheets.get('links').rows.find(x => x[0] === 'e26>moore');
  assert.equal(row[head.indexOf('confidence')], '有力');
  assert.equal(row[head.indexOf('sources')], 'Moore 1965 <https://example.org/moore1965.pdf>');
  assert.equal(head[head.length - 1], 'json');
});

test('根拠の欄の誤りは書かずに返す', () => {
  const hub = syncedHub();
  const r = hub.api({ key: key(hub) }, {
    events: [{ year: 1900, cat: 'phys', title: 'x', sources: [{ url: 'https://a' }] }, { year: 1900, cat: 'phys', title: 'y', memo: 'm'.repeat(2001) }],
    links: [{ from: 'e1', to: 'e2', confidence: 'たぶん' }, { from: 'e1', to: 'e3', sources: [{ title: 't', url: 'javascript:alert(1)' }] }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map(e => e.at), ['events[0].sources[0]', 'events[1].memo', 'links[0].confidence', 'links[1].sources[0].url']);
});

test('既にある関係に根拠だけ足せる(向きと説明は変えない)', () => {
  const hub = syncedHub();
  const r = hub.api({ key: key(hub) }, { links: [{ from: 'e31', to: 'e26', confidence: 'certain', sources: [{ title: 'Intel 4004 資料' }] }] });
  assert.equal(r.links[0].status, 'updated');
  assert.equal(r.links[0].id, 'e26>e31');
  const l = hub.post({ token: hub.token, since: 0 }).links.find(x => x.id === 'e26>e31').data;
  assert.deepEqual([l.from, l.to, l.src, l.confidence], ['e26', 'e31', 'seed', 'certain']);
  assert.equal(l.note, 'トランジスタの集積がマイクロプロセッサに到達した。');
  // 根拠のない再送は今まで通り exists
  assert.equal(hub.api({ key: key(hub) }, { links: [{ from: 'e26', to: 'e31' }] }).links[0].status, 'exists');
});

test('古い列の並びのシートは、見出しの名前で新しい並びに移す', () => {
  const hub = loadHub();
  const sh = hub.sheets.get('links');
  const oldCols = ['id', 'rev', 'mtime', 'deleted', 'from', 'to', 'kind', 'note', 'src', 'json'];
  sh.rows = [oldCols, ['a>b', '1', '5', 'false', 'a', 'b', '因果', 'n', 'seed', JSON.stringify({ id: 'a>b', from: 'a', to: 'b', note: 'n', src: 'seed' })]];
  const r = hub.post({ token: hub.token, since: 0 });
  assert.equal(r.links[0].data.from, 'a');
  assert.equal(sh.rows[0][sh.rows[0].length - 1], 'json');
  assert.equal(sh.rows[0].length, 14);
});
