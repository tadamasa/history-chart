# 年表ハブ 登録API 仕様(AIエージェント向け)

この文書は、AIエージェントが「年表」アプリに歴史上の出来事と因果関係を登録するための完全な仕様です。この文書だけを読めば呼び出せるように書いています。機械可読の定義は同じフォルダの `openapi.yaml` にあります。

## 0. あなた(AI)の役割と守ること

- あなたは、利用者の年表(科学技術史など)に、**出来事(events)**と、出来事どうしの**関係(links)**を登録します。
- 事実は確かめられるものだけを登録します。関係には必ず **`confidence`(確からしさ)** と **`sources`(出典)** を付け、出典の `quote` には根拠となる一文を**原文のまま**入れてください。要約や創作の引用は入れないでください。
- 確かめられない因果は、登録しないか、`confidence: "speculative"` にして `memo` に理由を書きます。
- 登録の前に必ず `dryRun=1` で検証し、エラーがなくなってから本番で送ります。
- 既存の出来事と重ならないよう、最初に `action=events` で一覧を取得し、同じ出来事は既存の `id` を使ってください。

## 1. エンドポイントと認証

- ベースURL: 利用者から渡される Google Apps Script のウェブアプリURL(`https://script.google.com/macros/s/…/exec`)。以下 `{BASE}`。
- 認証: URLのクエリ `key` に **APIキー**(`hc_` で始まる文字列)を付けます。ヘッダーでは送りません。
- APIキーは利用者から渡されます。応答や記録、他者に見える場所に書き出さないでください。
- 応答は常に HTTP 200 の JSON です。成否は本文の `ok` で判断します(HTTPステータスでは判断できません)。
- Apps Script は応答の前に 302 リダイレクトします。HTTPクライアントはリダイレクトに従う設定にしてください(curl なら `-L`、fetch なら `redirect: "follow"`)。
- POST の本文は JSON 文字列です。`Content-Type` は `application/json` でも `text/plain` でも受け付けます(ブラウザから呼ぶときは CORS の事前確認を避けるため `text/plain`)。

| 目的 | メソッド | URL |
|---|---|---|
| カテゴリ一覧 | GET | `{BASE}?key={KEY}&action=cats` |
| 出来事一覧 | GET | `{BASE}?key={KEY}&action=events` |
| 検証だけ | POST | `{BASE}?key={KEY}&dryRun=1` |
| 登録 | POST | `{BASE}?key={KEY}` |

## 2. 推奨する手順

1. `GET action=cats` でカテゴリの `id` と名前を取得する。
2. `GET action=events` で既存の出来事(`id`, 年, 題名)を取得する。
3. 登録したい出来事と関係を組み立てる。既存の出来事は `id` で指し、新しい出来事には自分で決めた安定した `id`(例: `moore-law-1965`)を付ける。
4. `POST …&dryRun=1` で検証する。`ok:false` なら `errors` を読んで直し、もう一度検証する。
5. `ok:true` になったら、同じ本文を `dryRun` なしで POST する。
6. 応答の `status`(`added` / `updated` / `exists`)を利用者に報告する。

登録した内容は、利用者の各端末がアプリを開いたとき(またはアプリに戻ったとき)の同期で表示されます。

## 3. 登録リクエストの本文

```json
{
  "by": "登録元の名前(任意。全件の既定)",
  "events": [ Event, ... ],
  "links":  [ Link, ... ]
}
```

`events` と `links` はどちらか一方だけでもかまいません(両方とも空はエラー)。1回に出来事200件・関係400件まで。

### 3.1 Event(出来事)

| 欄 | 型 | 必須 | 規則 |
|---|---|---|---|
| `id` | string | 任意 | 英数字と `_ . : -` の1〜64文字。同じ `id` の出来事があれば**上書き**(送り直しても重複しない)。省くとサーバーが `api-…` を振る。**再送に備えて付けることを強く推奨** |
| `year` | integer | 必須 | 紀元前は**負の数**(紀元前300年 → `-300`)。**0年は存在しない**(紀元前1年 = `-1`、西暦1年 = `1`)。範囲は `-3300` 〜 今年 |
| `month` | integer | 任意 | 1〜12。不明なら省く |
| `day` | integer | 任意 | 1〜31。入れるなら `month` も必須 |
| `endYear` | integer | 任意 | 入れると「期間を持つ出来事」になる。規則は `year` と同じ |
| `endMonth` | integer | 任意 | 1〜12 |
| `endDay` | integer | 任意 | 1〜31。入れるなら `endMonth` も必須 |
| `cat` | string | 必須 | カテゴリの `id`(例 `phys`)か名前(例 `数理・物理`)。`action=cats` で確認 |
| `title` | string | 必須 | 題名。短く(20字前後が見やすい) |
| `detail` | string | 任意 | 何が起きたか・意義(2〜3文) |
| `memo` | string | 任意 | 備考・根拠。2000字まで |
| `sources` | Source[] | 任意 | 出典。10件まで |
| `by` | string | 任意 | 登録元。100字まで。本文の `by` より優先 |

期間の終わりは、始まりより後でなければなりません。日付の比較は「年のみ=その年の中央、月まで=その月の初め付近、終わりの年のみ=その年の末」で行います。

### 3.2 Link(関係)

| 欄 | 型 | 必須 | 規則 |
|---|---|---|---|
| `from` | string | 必須 | 出来事の `id`、または題名(完全一致で1件だけのとき)。同じ本文の `events` も指せる |
| `to` | string | 必須 | 同上。`from` と同じ出来事は不可 |
| `kind` | string | 任意 | `cause`(因果。**from が原因、to が結果**。省略時の値)か `parallel`(並行。向きなし)。`因果` `原因` `並行` も可 |
| `note` | string | 任意 | 関係の説明。60字前後が読みやすい(500字で切る) |
| `confidence` | string | 推奨 | `certain`(確実)・`likely`(有力)・`speculative`(推測)。`確実` `有力` `推測` も可。推測はアプリで点線表示 |
| `memo` | string | 任意 | 判断の理由、異説、未確認の点。2000字まで |
| `sources` | Source[] | 推奨 | 出典。10件まで |
| `by` | string | 任意 | 登録元。100字まで |

- 同じ2つの出来事の関係は1本だけです(向きが逆でも同じとみなします)。
- 既にある関係を送ると `status: "exists"` で飛ばします。ただし `memo`・`sources`・`confidence` のいずれかを付けて送ると、向きと `note` はそのままで根拠だけ追加し、`status: "updated"` になります(出典は url または title が同じものを除いて追加、memo は改行して追記)。

### 3.3 Source(出典)

| 欄 | 型 | 必須 | 規則 |
|---|---|---|---|
| `title` | string | 必須 | 書名・論文名・ページ名(著者と年を含めると良い)。300字まで |
| `url` | string | 任意 | `http://` か `https://` で始まるURL。1000字まで |
| `quote` | string | 任意 | 出典中の根拠となる一文を原文のまま。500字まで |

URLだけの文字列(`"https://…"`)や題名だけの文字列も受け付けます。

## 4. 応答

### 成功

```json
{
  "ok": true,
  "dryRun": false,
  "events": [{ "index": 0, "id": "moore-law-1965", "title": "ムーアの法則", "status": "added" }],
  "links":  [{ "index": 0, "id": "e26>moore-law-1965", "status": "added" }]
}
```

- `index` は送った配列での位置。`status` は `added`(新規)・`updated`(上書き/根拠の追加)・`exists`(既にあるので何もしない)。
- 関係の `id` は `from>to` の形です。
- `dryRun: true` のときは何も書かれていません。

### 失敗(検証エラー)

**1件でも誤りがあれば、何も書かれません。** すべての誤りがまとめて返ります。

```json
{
  "ok": false,
  "error": "invalid",
  "errors": [
    { "at": "events[1]", "message": "月は1〜12で入力してください" },
    { "at": "links[0].from", "message": "出来事が見つかりません: 存在しない題名" }
  ]
}
```

`at` は本文の中の場所です。`message` は日本語です。主なもの:

| message | 直し方 |
|---|---|
| 年を入力してください | `year` を0以外の整数に |
| 紀元前3300年〜{今年}年の範囲で入力してください | 範囲内の年に |
| 0年はありません(紀元前1年は -1、西暦1年は 1) | `year` を -1 か 1 に |
| 月は1〜12で入力してください / 日は1〜31で入力してください | 値を直す |
| 日を入れる場合は月も入力してください | `month` を足すか `day` を消す |
| 終了は開始より後にしてください | `endYear` などを直す |
| 出来事を入力してください | `title` を入れる |
| カテゴリが見つかりません: … (使えるもの: …) | 示された `id` を使う |
| 出来事が見つかりません: … | `action=events` で `id` を確かめる。新しい出来事なら同じ本文の `events` に入れる |
| 同じ題名の出来事がN件あります。id で指定してください | `id` で指す |
| 同じ出来事どうしは結べません | `from` と `to` を別にする |
| kind は cause(因果)か parallel(並行)です | 値を直す |
| confidence は certain(確実)・likely(有力)・speculative(推測)のどれかです | 値を直す |
| 出典には title(300字以内)が要ります / url は http(s):// で始まるURLです | 出典を直す |
| id は英数字と _.:- の64文字以内です / 同じ id が本文に2回あります | `id` を直す |

### 失敗(そのほか)

| 応答 | 意味 |
|---|---|
| `{ "ok": false, "error": "unauthorized" }` | APIキーが違う。利用者に確認する(推測で再試行しない) |
| `{ "ok": false, "error": "bad json" }` | 本文がJSONでない |
| `{ "ok": false, "error": "events か links を1件以上入れてください" }` | 本文が空 |
| `{ "ok": false, "error": "1回に送れるのは出来事200件・関係400件までです" }` | 分けて送る |
| HTMLが返る | URLの誤りか、ウェブアプリの公開範囲が「全員」でない。利用者に伝える |

## 5. 一覧の応答

`GET action=cats`:

```json
{ "ok": true, "cats": [ { "id": "phys", "name": "数理・物理" }, { "id": "life", "name": "生命・化学" }, { "id": "info", "name": "情報・通信" }, { "id": "eng", "name": "工学・エネルギー" } ] }
```

`GET action=events`:

```json
{ "ok": true, "events": [ { "id": "e26", "year": 1947, "month": 12, "day": 23, "endYear": null, "cat": "info", "title": "トランジスタの発明" } ] }
```

利用者がアプリでカテゴリを足したり名前を変えたりしていることがあるので、`cat` は毎回 `action=cats` で確かめてください。

## 6. 例

### 6.1 新しい出来事2件と、既存の出来事との因果

```json
{
  "by": "research-agent",
  "events": [
    {
      "id": "moore-law-1965", "year": 1965, "month": 4, "day": 19, "cat": "info",
      "title": "ムーアの法則",
      "detail": "集積回路の部品数が一定期間ごとに倍増するという経験則が示された。",
      "sources": [{ "title": "Moore, G. E. (1965) Cramming more components onto integrated circuits, Electronics 38(8)", "quote": "The complexity for minimum component costs has increased at a rate of roughly a factor of two per year." }]
    },
    {
      "id": "planar-process-1959", "year": 1959, "cat": "info",
      "title": "プレーナ技術",
      "detail": "シリコン表面の酸化膜を使う製造法で、集積回路の量産が可能になった。"
    }
  ],
  "links": [
    { "from": "e26", "to": "planar-process-1959", "kind": "cause", "note": "トランジスタの製造技術の改良としてプレーナ技術が生まれた。", "confidence": "certain" },
    { "from": "planar-process-1959", "to": "moore-law-1965", "kind": "cause", "note": "量産技術の確立が集積度の指数的向上の前提となった。", "confidence": "likely", "memo": "Mooreの論文はプレーナ技術に直接言及していない。時期と技術の連続から判断。" },
    { "from": "moore-law-1965", "to": "e31", "kind": "cause", "note": "集積度向上の見通しが1チップCPUの構想を後押しした。", "confidence": "speculative" }
  ]
}
```

### 6.2 既存の関係に出典だけを足す

```json
{
  "links": [
    { "from": "e28", "to": "e30", "confidence": "certain", "sources": [{ "title": "Abbate, J. (1999) Inventing the Internet. MIT Press" }] }
  ]
}
```

### 6.3 紀元前と期間

```json
{
  "events": [
    { "id": "qin-standard-221bc", "year": -221, "cat": "eng", "title": "度量衡と文字の統一", "detail": "秦の始皇帝が度量衡・貨幣・文字を統一した。" },
    { "id": "silk-road-han", "year": -130, "endYear": 220, "cat": "info", "title": "シルクロード交易(漢代)" }
  ]
}
```

### 6.4 呼び出し(curl)

```sh
curl -sL "$BASE?key=$KEY&action=cats"
curl -sL "$BASE?key=$KEY&action=events"
curl -sL -H 'Content-Type: application/json' -d @body.json "$BASE?key=$KEY&dryRun=1"
curl -sL -H 'Content-Type: application/json' -d @body.json "$BASE?key=$KEY"
```

## 7. 初期データのID(参考)

利用者の年表には最初から次の出来事があります(利用者が消している場合もあるので、`action=events` が正です)。

| id | 年 | 題名 |
|---|---|---|
| e1 | 前3200 | 楔形文字の成立 |
| e3 | 前300 | ユークリッド『原論』 |
| e6 | 1450 | グーテンベルクの活版印刷 |
| e7 | 1543 | コペルニクス『天球回転論』 |
| e10 | 1687 | ニュートン『プリンキピア』 |
| e12 | 1769 | ワットの蒸気機関改良 |
| e14 | 1831 | ファラデーの電磁誘導 |
| e16 | 1859 | ダーウィン『種の起源』 |
| e22 | 1905 | 特殊相対性理論 |
| e24 | 1938 | 核分裂の発見 |
| e26 | 1947 | トランジスタの発明 |
| e27 | 1953 | DNA二重らせん構造 |
| e28 | 1957 | スプートニク1号 |
| e30 | 1969 | ARPANET 初接続 |
| e31 | 1971 | マイクロプロセッサ 4004 |
| e32 | 1991 | World Wide Web 公開 |
| e36 | 2017 | Transformer 論文 |
| e37 | 2022 | ChatGPT 公開 |
| p1 | 1543〜1687 | 科学革命 |
| p2 | 1760〜1840 | 産業革命 |
| p4 | 1961〜1972 | アポロ計画 |
