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
  assert.equal(core.tickStep(0.14), 500);
  assert.equal(core.tickStep(32), 2);
  assert.equal(core.tickStep(0.02), 5000);
  const { ticks, bands } = core.ticksIn(core.yAt(1800, 2), core.yAt(2000, 2), 2);
  assert.deepEqual(ticks.map(t => t.label), ['1800', '1850', '1900', '1950', '2000']);
  assert.ok(bands.length >= 2);
});

test('yAt と tAt は逆関数', () => {
  for (const z of [0.02, 0.14, 0.7, 2, 33.3, 128]) assert.ok(Math.abs(core.tAt(core.yAt(1234.5, z), z) - 1234.5) < 1e-9);
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
  assert.equal(core.pinchPpy(2, 1.5), 3);
  assert.equal(core.pinchPpy(2, 1000), core.PPY_MAX);
  assert.equal(core.pinchPpy(2, 0.0001), core.PPY_MIN);
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

test('サンプルを消す対象: 初期データの出来事・関係と、それに触れるAPIの関係・AIの解説。ほかは残す', () => {
  const events = [...SEED_EVENTS, { id: 'mine', y: 1965, cat: 'info', title: '自分の' }, { id: 'mine2', y: 1970, cat: 'info', title: '自分の2' }];
  const links = [...SEED_LINKS, { id: 'e26>mine', from: 'e26', to: 'mine' }, { id: 'mine>mine2', from: 'mine', to: 'mine2' }];
  const ai = { e27: { id: 'e27' }, mine: { id: 'mine' } };
  const t = core.sampleTargets(events, links, ai, SEED_EVENTS.map(e => e.id), SEED_LINKS.map(l => l.id));
  assert.equal(t.eventIds.length, 43);
  assert.equal(t.linkIds.length, 28);
  assert.ok(!t.linkIds.includes('mine>mine2'));
  assert.deepEqual(t.aiIds, ['e27']);
});

test('検索: 語のAND、かなの違いを無視、年と期間、年代順', () => {
  const ev = [...SEED_EVENTS, { id: 'x', y: 1900, m: 0, d: 0, cat: 'info', title: 'テスト', detail: '', memo: 'ひらがなのメモ', sources: [{ title: 'Moore 1965' }] }];
  const ids = q => core.searchEvents(ev, SEED_CATS, q).map(h => h.id);
  assert.deepEqual(ids('電信'), ['e15']);
  assert.deepEqual(ids('電気信号'), ['e15', 'e19']);       // 詳細の中
  assert.deepEqual(ids('ヒラガナ'), ['x']);               // ひらがな ⇔ カタカナ
  assert.deepEqual(ids('ｍｏｏｒｅ'), ['x']);             // 全角・大小文字
  assert.deepEqual(ids('1769'), ['p2', 'e12']);           // その年の出来事と、その年を含む期間
  assert.deepEqual(ids('前300'), ['e3']);
  assert.deepEqual(ids('紀元前300年'), ['e3']);
  assert.deepEqual(ids('DNA 構造'), ['e27']);             // AND
  assert.deepEqual(ids('情報・通信 1971'), ['e31']);      // カテゴリ名
  assert.deepEqual(ids(''), []);
  const t = core.searchEvents(ev, SEED_CATS, '蒸気').map(h => h.t);
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
  assert.match(core.searchEvents(ev, SEED_CATS, 'メモ')[0].snippet, /メモ/);
});

test('検索中は当たらない出来事を薄くする', () => {
  const L = core.layout({ events: SEED_EVENTS, cats: SEED_CATS, links: SEED_LINKS, match: new Set(['e1']) });
  assert.equal(L.cards.find(c => c.id === 'e1').dim, false);
  assert.equal(L.cards.find(c => c.id === 'e2').dim, true);
});

test('表示幅の表記と合わせ込み', () => {
  assert.equal(core.zoomLabel(702, 2), '350年');
  assert.equal(core.zoomLabel(702, 0.14), '5000年');
  assert.equal(core.zoomLabel(702, 128), '5年');
  assert.equal(core.zoomLabel(702, 1000), '8か月');
  const all = core.fitView(SEED_EVENTS, 702);
  // 全件(前3200〜2022)が余白を残して収まる
  const top = core.yAt(-3200, all.ppy), bot = core.yAt(2022.9, all.ppy), mid = core.yAt(all.center, all.ppy);
  assert.ok(bot - top <= 702 - 180 - 50 + 1);
  assert.ok(Math.abs((top + bot) / 2 - mid) < 1);
  // 2件なら、その間だけ
  const two = core.fitView(SEED_EVENTS.filter(e => ['e14', 'e20'].includes(e.id)), 702);
  assert.ok(two.ppy > all.ppy * 20);
  // 1件は前後10年
  const one = core.fitView([SEED_EVENTS[0]], 702);
  assert.ok(Math.abs(one.ppy - (702 - 230) / 20) < 1e-9);
  assert.equal(core.fitView([], 702), null);
});

test('積み上がりを見て合わせ込みを詰める', () => {
  // 同じ年代に12件。時間だけで決めると縦に積まれたカードがはみ出す
  const evs = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, y: 1900 + i, cat: 'c' }));
  const cats = [{ id: 'c', name: 'C', glyph: 'circle', order: 0 }];
  const ids = new Set(evs.map(e => e.id));
  const at = ppy => core.layout({ events: evs, cats, links: [], zoom: ppy, width: 402 });
  const viewH = 700;
  const f0 = core.fitView(evs, viewH, { margin: 30 });
  const f = core.refineFit(f0, ids, viewH, at);
  assert.ok(f.ppy <= f0.ppy);
  const cs = at(f.ppy).cards, top = Math.min(...cs.map(c => c.top)), bot = Math.max(...cs.map(c => c.top + c.h));
  // 積み上がり(12×(50+隙間))が画面に収まらないときは先頭を上端近くに置く
  const y0 = core.yAt(f.center, f.ppy) - viewH / 2;
  assert.ok(top - y0 >= 0 && top - y0 <= 40, `top offset ${top - y0}`);
  // 少数なら全部が中に収まる
  const few = evs.slice(0, 3), fs = core.refineFit(core.fitView(few, viewH), new Set(few.map(e => e.id)), viewH, ppy => core.layout({ events: few, cats, links: [], zoom: ppy, width: 402 }));
  const c2 = core.layout({ events: few, cats, links: [], zoom: fs.ppy, width: 402 }).cards, s0 = core.yAt(fs.center, fs.ppy) - viewH / 2;
  assert.ok(c2.every(c => c.top >= s0 && c.top + c.h <= s0 + viewH));
});

test('文字の大きさでカードの高さと軸が変わる', () => {
  assert.equal(core.geom(1).cardH, core.CARD_H);
  assert.equal(core.geom(1).AX, core.AX);
  assert.ok(core.geom(1.3).cardH > core.geom(1.15).cardH && core.geom(1.15).AX > core.AX);
  assert.equal(core.tsOf('xx'), core.tsOf(core.TS_DEFAULT));
  const cats = [{ id: 'c', name: 'C', glyph: 'circle', order: 0 }];
  const evs = [{ id: 'a', y: 1900, cat: 'c' }, { id: 'b', y: 1900, cat: 'c' }];
  const L = core.layout({ events: evs, cats, links: [], zoom: 2, width: 402, ts: 1.3 });
  const [p, q] = L.cards.sort((x, y) => x.top - y.top);
  assert.equal(p.h, core.geom(1.3).cardH);
  assert.ok(q.top - p.top >= p.h); // 大きくしても重ならない
  assert.ok(L.lanes[0].x > core.L0);
});

test('狭いカードの年表記', () => {
  assert.equal(core.fmtShort({ y: 1969, m: 7, d: 20 }), '1969');
  assert.equal(core.fmtShort({ y: -300 }), '前300');
  assert.equal(core.fmtShort({ y: 1543, ey: 1687 }), '1543–1687');
});
