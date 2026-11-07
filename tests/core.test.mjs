import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';
import { SEED_CATS, SEED_EVENTS, SEED_LINKS } from '../js/seed.js';

test('初期データは43件(期間5)・関係27件・カテゴリ4件', () => {
  assert.equal(SEED_EVENTS.length, 43);
  assert.equal(SEED_EVENTS.filter(e => e.ey).length, 5);
  assert.equal(SEED_LINKS.length, 27);
  assert.equal(SEED_CATS.length, 4);
  const ids = new Set(SEED_EVENTS.map(e => e.id));
  for (const l of SEED_LINKS) assert.ok(ids.has(l.from) && ids.has(l.to), l.id);
});

test('小数年: 年のみは中央、月日つきはその位置', () => {
  assert.equal(core.tOf({ y: 1969, m: 0, d: 0 }), 1969.5);
  assert.equal(core.tOf({ y: 1969, m: 7, d: 0 }), 1969 + 6 / 12 + 0.04);
  assert.equal(core.tOf({ y: 1969, m: 7, d: 20 }), 1969 + 6 / 12 + 19 / 365);
  assert.equal(core.tEnd({ ey: 1840, em: 0, ed: 0 }), 1841);
});

test('日付の書き方: 紀元前、期間、年数', () => {
  assert.equal(core.fmtDate({ y: -300, m: 0, d: 0 }), '紀元前300年');
  assert.equal(core.fmtRange({ y: 1760, m: 0, d: 0, ey: 1840 }), '1760年〜1840年');
  assert.equal(core.fmtRange({ y: 1760, m: 0, d: 0, ey: 1840 }, true), '1760年 〜 1840年（80年間）');
  assert.equal(core.fmtRange({ y: -10, m: 0, d: 0, ey: 10 }, true), '紀元前10年 〜 10年（19年間）');
  assert.equal(core.tickLabel(-500), '前500');
});

test('目盛り間隔は 間隔×px/年 ≥ 56 の最小値', () => {
  assert.equal(core.tickStep(2), 50); // 2px/年
  assert.equal(core.tickStep(0), 500); // 0.14px/年
  assert.equal(core.tickStep(4), 2); // 32px/年
  const { ticks, bands } = core.ticksIn(core.yAt(1800, 2), core.yAt(2000, 2), 2);
  assert.deepEqual(ticks.map(t => t.label), ['1800', '1850', '1900', '1950', '2000']);
  assert.ok(bands.length >= 2);
});

test('yAt と tAt は逆関数', () => {
  for (let z = 0; z < core.LIN.length; z++) assert.ok(Math.abs(core.tAt(core.yAt(1234.5, z), z) - 1234.5) < 1e-9);
});

test('カード配置: 重ならず、間隔6px以上', () => {
  const items = [{ id: 'a', y: 100 }, { id: 'b', y: 105 }, { id: 'c', y: 110 }, { id: 'd', y: 400 }];
  const tops = core.place(items, 50, 6);
  const ys = ['a', 'b', 'c'].map(k => tops[k]);
  assert.ok(ys[1] - ys[0] >= 56 - 1e-9 && ys[2] - ys[1] >= 56 - 1e-9);
  assert.equal(tops.d, 375); // 離れたものは理想位置
  // 平均に置く: (100-25 + 105-25-56 + 110-25-112)/3
  assert.ok(Math.abs(tops.a - (75 + 24 - 27) / 3) < 1e-9);
});

test('layout: レーン等分、期間バー、関係線、減光', () => {
  const L = core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, width: 402 });
  assert.equal(L.lanes.length, 4);
  assert.equal(L.LW, (402 - 8 - 60) / 4);
  assert.equal(L.bars.length, 5);
  assert.equal(L.rels.length, 27);
  assert.equal(L.visibleCount, 43);
  // カテゴリを1つ隠すとレーンが3つに
  const L2 = core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, hidden: { info: true }, width: 402 });
  assert.equal(L2.lanes.length, 3);
  assert.ok(L2.cards.every(c => c.cat !== 'info'));
  // 選択すると、その出来事の関係線だけ・関係のないものは減光
  const L3 = core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, sel: 'e27', width: 402 });
  assert.equal(L3.rels.length, 4);
  assert.ok(L3.rels.every(r => r.strong));
  assert.equal(L3.cards.find(c => c.id === 'e33').dim, false);
  assert.equal(L3.cards.find(c => c.id === 'e1').dim, true);
  // 関係線トグルOFFで未選択なら線なし
  assert.equal(core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, showLinks: false, width: 402 }).rels.length, 0);
});

test('画面外の件数バッジ', () => {
  const L = core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, width: 402 });
  const st = core.yAt(1890, 2) - 350;
  const { above, below } = core.offscreen(L.cards, L.lanes, st, 700);
  assert.ok(above.length > 0 && below.length > 0);
  const total = [...above, ...below].reduce((n, b) => n + b.n, 0);
  assert.ok(total < 43);
});

test('入力検証', () => {
  const base = { era: 'AD', year: '1969', month: '7', day: '20', title: 'アポロ11号', cat: 'eng', detail: '', hasEnd: false };
  assert.deepEqual(core.validateForm(base).ev, { y: 1969, m: 7, d: 20, cat: 'eng', title: 'アポロ11号', detail: '' });
  assert.equal(core.validateForm({ ...base, year: '' }).err.date, '年を入力してください');
  assert.equal(core.validateForm({ ...base, year: '3301', era: 'BC' }).err.date.includes('範囲'), true);
  assert.equal(core.validateForm({ ...base, year: '300', era: 'BC' }).ev.y, -300);
  assert.equal(core.validateForm({ ...base, month: '', day: '3' }).err.date, '日を入れる場合は月も入力してください');
  assert.equal(core.validateForm({ ...base, month: '13' }).err.date, '月は1〜12で入力してください');
  assert.equal(core.validateForm({ ...base, title: '  ' }).err.title, '出来事を入力してください');
  const per = { ...base, hasEnd: true, eEra: 'AD', eYear: '1972', eMonth: '12', eDay: '19' };
  assert.deepEqual(core.validateForm(per).ev.ey, 1972);
  assert.equal(core.validateForm({ ...per, eYear: '1969', eMonth: '7', eDay: '1' }).err.date, '終了は開始より後にしてください');
  assert.equal(core.validateForm({ ...per, eYear: '' }).err.date, '終了年を入力してください');
  assert.equal(core.validateForm({ ...base, year: '1.5' }).err.date, '年を入力してください');
});

test('formOf → validateForm で同じ出来事に戻る', () => {
  for (const e of SEED_EVENTS) {
    const { ev } = core.validateForm(core.formOf(e));
    const want = { y: e.y, m: e.m, d: e.d, ...(e.ey ? { ey: e.ey, em: e.em, ed: e.ed } : {}), cat: e.cat, title: e.title, detail: e.detail };
    assert.deepEqual(ev, want, e.id);
  }
});

test('AI解析の反映: 存在しないID・既存ペア・自分自身は無視、向きと並行', () => {
  const res = {
    summary: 'まとめ',
    relations: [
      { id: 'e26', kind: '原因', note: 'a' },   // 既存ペア(e26>e31)
      { id: 'e25', kind: '原因', note: 'b' },   // e25 → e31
      { id: 'e34', kind: '影響', note: 'c' },   // 既存ペア(e31>e34)
      { id: 'e36', kind: '並行', note: 'd' },   // e31 → e36 para
      { id: 'zzz', kind: '影響', note: 'x' },
      { id: 'e31', kind: '影響', note: 'self' },
    ],
    suggestions: [{ year: 1965, month: 4, title: 'ムーアの法則', cat: 'info', reason: 'r' }, { year: 1, title: 'bad cat', cat: 'nope' }],
  };
  const { added, ai } = core.applyAnalysis('e31', res, SEED_EVENTS, SEED_LINKS, SEED_CATS);
  assert.deepEqual(added.map(l => [l.from, l.to, !!l.para]), [['e25', 'e31', false], ['e31', 'e36', true]]);
  assert.ok(added.every(l => l.src === 'ai' && l.id === core.linkId(l.from, l.to)));
  assert.equal(ai.summary, 'まとめ');
  assert.equal(ai.suggestions.length, 1);
});

test('提案の追加: 年代順で関係の向きを決める', () => {
  const t = SEED_EVENTS.find(e => e.id === 'e31');
  const before = core.suggestionToEvent({ year: 1965, month: 4, title: 'ムーアの法則', cat: 'info', reason: 'r' }, t, 'n1');
  assert.equal(before.link.from, 'n1');
  const after = core.suggestionToEvent({ year: 1981, month: null, title: 'IBM PC', cat: 'info', reason: 'r' }, t, 'n2');
  assert.equal(after.link.to, 'n2');
  assert.equal(after.ev.m, 0);
});

test('parseJSON は前後の文字を除いて読む', () => {
  assert.deepEqual(core.parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => core.parseJSON('なし'));
});

test('ピンチの段階とカテゴリ削除の可否', () => {
  assert.equal(core.pinchStep(1.4), 1);
  assert.equal(core.pinchStep(0.7), -1);
  assert.equal(core.pinchStep(1.1), 0);
  assert.match(core.catDeleteBlock(SEED_CATS[0], SEED_CATS, SEED_EVENTS), /件の出来事があるため削除できません/);
  assert.equal(core.catDeleteBlock({ id: 'x', name: 'x' }, SEED_CATS, SEED_EVENTS), '');
  assert.equal(core.catDeleteBlock({ id: 'x', name: 'x' }, [{ id: 'x' }], []), 'カテゴリは1件以上必要です。');
});

test('記号は8種を順に回る', () => {
  let g = 'circle';
  for (let i = 0; i < 8; i++) g = core.nextGlyph(g);
  assert.equal(g, 'circle');
  for (const k of core.GLYPHS) assert.match(core.glyphD(k, 6, 6, 3), /^M/);
});
