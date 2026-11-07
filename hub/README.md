# 年表ハブ(スプレッドシートとの同期)

年表アプリのカテゴリ・出来事・関係・AIの解説を、自分のGoogleスプレッドシートに置いて、iPhoneとiPadで同じ年表を使うための受け口です。費用はかかりません。

- データは今まで通り各端末の中にあり、開いたとき・アプリに戻ったとき・書いてから4秒後に、変わった分だけをやり取りします。
- 同じものを二つの端末で直したときは、後から直したほうが残ります。削除も伝わります。
- 初期データ(科学技術史の43件)は各端末で最初に入りますが、どの編集よりも古い扱いなので、片方で消した出来事が同期で生き返ることはありません。

## 準備(最初の1回、パソコンで行うのが楽です)

1. Googleドライブで新しいスプレッドシートを作ります(名前の例: 年表ハブ)。
2. メニューの「拡張機能」→「Apps Script」を開きます。
3. 最初からある `コード.gs` の中身を全部消して、[Code.gs](https://raw.githubusercontent.com/tadamasa/history-chart/main/hub/Code.gs) の中身を貼り、保存します。
4. 関数の選択欄で `setup` を選び、「実行」を押します。
   - 権限の確認が出たら、自分のアカウントを選び、「詳細」→「(安全ではないページ)に移動」→「許可」と進みます。自分で作ったスクリプトなので問題ありません。
   - 実行ログに「合言葉: …」が出ます。これを控えます。
5. 「デプロイ」→「新しいデプロイ」→ 種類の歯車から「ウェブアプリ」。
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
   - 「デプロイ」を押し、「ウェブアプリのURL」(`…/exec` で終わるもの)をコピーします。
6. 年表アプリの左上「年表」を押して設定を開き、「年表ハブ」にURLと合言葉を入れて「接続して同期する」。
7. iPadでも同じアプリ(https://tadamasa.github.io/history-chart/)をホーム画面に追加し、同じURLと合言葉で接続します。

URLと合言葉を知っている人は読み書きできるので、他の人には教えないでください。

## スクリプトを新しくするとき

Code.gs を貼り替えて保存したら、「デプロイ」→「デプロイを管理」→ 鉛筆の印 → バージョン「新バージョン」→「デプロイ」。URLは変わりません。

## シートの中身

| シート | 主な列 |
|---|---|
| cats | id, name(カテゴリ名), glyph(記号), order(レーンの順) |
| events | id, year(紀元前は負), month, day, endYear/endMonth/endDay(期間のとき), cat(カテゴリのid), title, detail |
| links | id(`from>to`), from, to(因果の向き), kind(因果/並行), note, src(seed/ai) |
| ai | id(出来事のid), summary(AIの解説), suggestions(提案の題名) |

- `deleted` が `true` の行は削除済みです。
- 最後の `json` 列がアプリの元データです。表を手で書き換えても、アプリには反映されません。
- 列は見出しの名前で探してください(列番号で読むと、列が増えたときに壊れます)。

## 外部から登録するAPI(出来事と因果関係)

ほかのプログラム(スクリプト、ショートカット、AIエージェントなど)から、出来事と関係をまとめて年表に入れるための口です。AIに渡す仕様書は [docs/API_FOR_AI.md](../docs/API_FOR_AI.md)、機械可読の定義は [docs/openapi.yaml](../docs/openapi.yaml) です。アプリの同期と同じウェブアプリのURLに、**同期の合言葉とは別の「APIキー」**を `?key=` で付けて呼びます。登録したものは、各端末が次に同期したとき(開いたとき・戻ったとき)に届きます。

### 準備

1. Code.gs を最新に貼り替えて保存し、`setup` をもう一度実行します。実行ログに「APIキー(外部からの登録用): hc_…」が出ます。すでにある合言葉は変わりません。権限は増えていないので、承認のやり直しは要りません。
2. 「デプロイを管理」→ 鉛筆 →「新バージョン」→「デプロイ」。URLは変わりません。
3. 先にアプリを一度ハブに接続しておくと、初期データの出来事(`e26` など)やカテゴリを、id や題名で関係の端点に使えます。

APIキーが漏れたかもしれないときは、`rotateApiKey` を実行すると新しいキーに替わり、古いキーは使えなくなります(アプリの同期はそのまま)。URLに入れたキーは、呼び出し側の履歴やログに残りやすいので、他の人と共有する場所には書かないでください。

### 登録する: POST `…/exec?key=APIキー`

```json
{
  "events": [
    { "id": "moore", "year": 1965, "month": 4, "day": 19, "cat": "info", "title": "ムーアの法則", "detail": "集積度は約2年で倍になる" },
    { "year": -221, "cat": "工学・エネルギー", "title": "始皇帝の度量衡統一" },
    { "year": 1961, "month": 5, "endYear": 1972, "endMonth": 12, "cat": "eng", "title": "アポロ計画(別資料)" }
  ],
  "links": [
    { "from": "e26", "to": "moore", "kind": "cause", "note": "トランジスタの微細化が前提",
      "confidence": "likely", "memo": "論文に直接の言及はなく、時期と技術の連続から判断",
      "sources": [{ "title": "Moore, G. E. (1965) Cramming more components onto integrated circuits", "url": "https://…", "quote": "…roughly a factor of two per year." }] },
    { "from": "ムーアの法則", "to": "マイクロプロセッサ 4004" },
    { "from": "moore", "to": "e33", "kind": "parallel" }
  ],
  "by": "claude-agent"
}
```

| 欄 | 意味 |
|---|---|
| `events[].year` | 必須。紀元前は負の数(紀元前300年 = `-300`)。0年はない。範囲は紀元前3300年〜今年 |
| `month`, `day` | 任意。日を入れるなら月も必須 |
| `endYear`, `endMonth`, `endDay` | 期間の終わり。入れると期間を持つ出来事になる。終わりは始まりより後 |
| `cat` | 必須。カテゴリの id(`phys` `life` `info` `eng` など)か名前 |
| `title`, `detail` | 題名(必須)と詳細 |
| `id` | 任意。英数字と `_.:-` の64文字以内。付けると、同じ id の出来事を上書きする(送り直しても重複しない)。省くと `api-…` が振られる |
| `links[].from`, `to` | 出来事の id か題名(完全一致で1件だけのとき)。同じ本文の `events` も指せる |
| `links[].kind` | `cause`(因果。from が原因、to が結果。省略時)か `parallel`(並行)。`因果` `原因` `並行` でもよい |
| `links[].note` | 関係の説明(500字まで)。アプリでは関係の一行目に出る |
| `links[].confidence` | 確からしさ。`certain`(確実)・`likely`(有力)・`speculative`(推測)。日本語でもよい。推測の関係はアプリで点線になる |
| `memo` | 備考・根拠(出来事にも関係にも。2000字まで)。判断の理由、異説、未確認の点など |
| `sources` | 出典(出来事にも関係にも。10件まで)。`[{ "title": "書名や論文名", "url": "https://…", "quote": "根拠になる一文(500字まで)" }]`。`url` と `quote` は任意。URLだけの文字列でもよい |
| `by` | 登録元(100字まで。例: `claude-agent`)。本文の一番外に書くと全件の既定になり、各項目に書けばそちらが優先 |

- 入力の規則はアプリの追加フォームと同じです(同じ文言のエラーが返ります)。
- **すべて検証してから書きます。** 1件でも誤りがあれば何も書かず、`{ ok:false, error:"invalid", errors:[{ at:"events[1]", message:"月は1〜12で入力してください" }] }` を返します。
- 既にある組み合わせの関係は `status: "exists"` で飛ばします(向きが逆でも同じとみなす)。ただし `memo`・`sources`・`confidence` を付けて送ると、向きと説明はそのままで根拠だけを足し、`status: "updated"` を返します(出典は重ならないように追加、備考は改行して追記)。初期データの関係に、あとから出典を付けるときに使えます。
- `&dryRun=1` を付けると、検証だけして書きません。
- 1回に出来事200件・関係400件まで。アプリでは、APIから入った関係に「API」の印が付きます。

成功すると次のように返ります。

```json
{ "ok": true, "dryRun": false,
  "events": [{ "index": 0, "id": "moore", "title": "ムーアの法則", "status": "added" }, …],
  "links":  [{ "index": 0, "id": "e26>moore", "status": "added" }, …] }
```

### 調べる: GET

- `…/exec?key=APIキー&action=cats` … カテゴリの id と名前
- `…/exec?key=APIキー&action=events` … 出来事の id・年・題名の一覧(関係の端点を探すのに使う)

### 呼び方の例

Apps Script は応答の前に一度リダイレクトするので、curl では `-L` を付けます(本文の形式は `text/plain` でも `application/json` でも受け付けます)。

```sh
URL='https://script.google.com/macros/s/…/exec'
KEY='hc_…'
curl -sL "$URL?key=$KEY&action=cats"
curl -sL -H 'Content-Type: application/json' -d @events.json "$URL?key=$KEY&dryRun=1"   # まず検証
curl -sL -H 'Content-Type: application/json' -d @events.json "$URL?key=$KEY"            # 登録
```

JavaScript(Node など)なら:

```js
const res = await fetch(`${URL}?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ events, links }), redirect: 'follow' });
console.log(await res.json());
```

ブラウザのページから呼ぶときは、事前確認(CORS)を避けるため `text/plain` で送ってください。

### 他のAIに登録させるときのコツ

- 関係には `confidence` と `sources` を必ず付けさせると、あとで「推測」の点線だけを見直す、という使い方ができます。
- `quote` には出典の中の根拠となる一文をそのまま入れさせます。要約ではなく引用にしておくと、AIの思い違いを見つけやすくなります。
- 先に `action=events` で今の出来事を渡し、重複を避けさせてから、`dryRun=1` で検証、問題なければ本番、の順にすると安全です。
