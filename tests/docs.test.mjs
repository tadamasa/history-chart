// docs/API_FOR_AI.md の例が、実際のハブでそのまま通ることを確かめる(仕様書と実装のずれを防ぐ)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { loadHub } from './gas-mock.mjs';
import { SEED_CATS, SEED_EVENTS, SEED_LINKS } from '../js/seed.js';

const md = fs.readFileSync(new URL('../docs/API_FOR_AI.md', import.meta.url), 'utf8');
const sec6 = md.slice(md.indexOf('## 6. 例'), md.indexOf('### 6.4'));
const examples = [...sec6.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));

test('仕様書の登録例はすべて検証を通り、本番でも書ける', () => {
  assert.equal(examples.length, 3);
  const hub = loadHub();
  hub.post({ token: hub.token, since: 0, cats: SEED_CATS.map(c => ({ id: c.id, mtime: 1, data: c })), events: SEED_EVENTS.map(e => ({ id: e.id, mtime: 1, data: e })), links: SEED_LINKS.map(l => ({ id: l.id, mtime: 1, data: l })) });
  const key = hub.props.API_KEY;
  for (const body of examples) {
    const dry = hub.api({ key, dryRun: '1' }, body);
    assert.equal(dry.ok, true, JSON.stringify(dry));
    const r = hub.api({ key }, body);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  // 6.2 は既存の関係への出典追加
  assert.equal(hub.api({ key }, examples[1]).links[0].status, 'updated');
});

test('仕様書の初期データ表のidと題名は初期データと一致する', () => {
  const rows = [...md.slice(md.indexOf('## 7.')).matchAll(/^\| (e\d+|p\d+) \| [^|]+ \| (.+?) \|$/gm)];
  assert.ok(rows.length >= 20);
  for (const [, id, title] of rows) assert.equal(SEED_EVENTS.find(e => e.id === id)?.title, title, id);
});
