# Vercel Live Word Cloud 仕様・操作ガイド

## 概要

Vercel Live Word Cloud は、参加者がスマホやPCから送信したワードを、会場スクリーン上のワードクラウドとして集計・表示するツールです。

Vercel の Serverless Functions と Supabase を使う構成になっており、Vercel にデプロイして同じURLを参加者へ共有する運用を想定しています。

## 主な用途

- イベントやワークショップで参加者の意見を集める
- 授業や研修で印象語・感想を可視化する
- 会議や発表でリアルタイムな反応を集める
- ルームコードごとに別イベントとして使い分ける

## 主な機能

- ワード投稿
- 同じワードの自動カウントアップ
- 投稿数に応じた文字サイズ変更
- ルームコードによるイベント分離
- 表示専用スクリーン
- 数秒ごとの自動更新
- ルーム単位のリセット
- リセット操作のパスワード保護
- 投稿ワード数とユニークワード数の表示

## 技術構成

| 項目 | 内容 |
| --- | --- |
| ホスティング | Vercel |
| フロントエンド | 静的 HTML / CSS / JavaScript |
| API | Vercel Serverless Functions |
| データ保存 | Supabase REST API |
| ローカル開発 | Vercel CLI |
| リアルタイム更新 | ポーリング |
| 更新間隔 | 表示専用画面で6秒ごと |

## ファイル構成

```text
vercel-live-word-cloud/
├── README.md
├── TOOL_SPEC.md
├── package.json
├── package-lock.json
├── vercel.json
├── .env.example
├── index.html
├── screen.html
├── app.js
├── styles.css
├── api/
│   ├── _supabase.js
│   ├── words.js
│   └── reset.js
└── supabase/
    └── schema.sql
```

## 画面URL

| URL | 用途 |
| --- | --- |
| `/` | 参加者入力画面 |
| `/screen?room=main` | 表示専用画面 |

Vercelにデプロイ後は、以下のようなURLになります。

```text
https://vercel-live-word-cloud.vercel.app/
https://vercel-live-word-cloud.vercel.app/screen?room=main
```

## 画面構成

### 参加者入力画面

`/` で表示される画面です。

できること:

- ルームコードの入力・切り替え
- ワード投稿
- 表示専用画面を別タブで開く
- 現在のルーム確認
- 管理者パスワードによるルームリセット
- ワードクラウドの確認

### 表示専用画面

`/screen?room=main` で表示される画面です。

できること:

- 指定ルームのワードクラウド表示
- 投稿ワード数の表示
- ユニーク数の表示
- 最終更新ステータスの表示
- 6秒ごとの自動更新

プロジェクターや大型ディスプレイに表示する用途を想定しています。

## 基本操作

### 1. ルームを決める

参加者入力画面で「ルームコード」に任意の文字列を入力します。

例:

```text
workshop2026
meeting-a
main
```

ルームコードを変えると、投稿データが別々に管理されます。

### 2. 表示専用画面を開く

参加者入力画面の「表示専用を開く」を押します。

現在のルームに合わせて、以下のようなURLが開きます。

```text
/screen?room=workshop2026
```

### 3. 参加者にURLを共有する

参加者には入力画面のURLを共有します。

同じルームを使ってもらうには、以下のどちらかで案内します。

- 入力画面でルームコードを入力してもらう
- `/?room=xxxx` のようにルーム付きURLを共有する

現在の実装では、画面初期表示時にURLの `room` パラメータを読み取ります。

### 4. ワードを投稿する

「ワード」入力欄に投稿したい言葉を入力し、「送信」を押します。

同じワードが複数回投稿された場合は、ワードごとに集計され、投稿数に応じて大きく表示されます。

### 5. ルームをリセットする

「このルームをリセット」を押すと、管理者パスワードの入力ダイアログが表示されます。

Vercel環境変数 `RESET_PASSWORD` と一致した場合のみ、そのルームの `resetAt` が更新されます。投稿データは物理削除されず、以後は `resetAt` より後の投稿だけが表示対象になります。

## ローカル実行

Vercel Functions をローカルで動かすため、通常の `node server.js` ではなく Vercel CLI を使います。

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm install
npm run local
```

`npm run local` は `vercel dev --local --listen 4000` を実行します。

起動後、表示されたローカルURLをブラウザで開きます。一般的には以下のようなURLになります。

```text
http://localhost:4000/
```

別ポートで起動している場合は、ターミナルに表示されたURLを使ってください。

## ローカル環境変数

ローカルでは、Supabase接続用の環境変数が無い場合に `.local-word-entries.json` へ保存します。

そのため、画面表示や投稿テストだけなら環境変数なしで実行できます。

本番と同じSupabase保存で確認したい場合は、Supabase接続用の環境変数を設定します。

`.env.example` を参考にして、Vercel CLI が読める環境変数を設定します。

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY=YOUR_SECRET_KEY
SUPABASE_TABLE=word_entries
RESET_PASSWORD=YOUR_ADMIN_PASSWORD
```

`SUPABASE_SERVICE_ROLE_KEY` または `SUPABASE_SECRET_KEY` のどちらかが必要です。

ローカル保存ファイル `.local-word-entries.json` はGit管理対象外です。

## Supabaseセットアップ

### 1. Supabaseプロジェクトを作成する

Supabaseで新しいプロジェクトを作成します。

### 2. テーブルを作成する

Supabaseの SQL Editor で [schema.sql](/Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud/supabase/schema.sql) を実行します。

作成されるテーブル:

```sql
public.word_entries
```

カラム:

| カラム | 型 | 内容 |
| --- | --- | --- |
| `id` | `bigint` | 主キー |
| `room` | `text` | ルームコード |
| `word` | `text` | 投稿ワード |
| `created_at` | `timestamptz` | 投稿日時 |

### 3. APIキーを用意する

サーバー側からSupabase REST APIへアクセスするため、以下のどちらかを使用します。

- Legacy anon, service_role API keys の `service_role`
- 新UIの Secret keys の `default`

このキーはサーバー用の秘密情報です。ブラウザ側に直接埋め込まないでください。

## Vercel環境変数

VercelのProject Settingsで以下を設定します。

| 変数名 | 必須 | 内容 |
| --- | --- | --- |
| `SUPABASE_URL` | 必須 | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 条件付き必須 | Supabaseのservice roleキー |
| `SUPABASE_SECRET_KEY` | 条件付き必須 | SupabaseのSecret key |
| `SUPABASE_TABLE` | 任意 | テーブル名。未設定時は `word_entries` |
| `RESET_PASSWORD` | 必須 | ルームリセット用パスワード |

`SUPABASE_SERVICE_ROLE_KEY` と `SUPABASE_SECRET_KEY` は、どちらか一方が設定されていれば動作します。

## デプロイ手順

### GitHub連携でデプロイする場合

1. このフォルダをGitHubリポジトリへpushします。
2. Vercelのプロジェクト設定でGit Repositoryを接続します。
3. Vercelの環境変数を設定します。
4. デプロイを実行します。

### Vercel CLIでデプロイする場合

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm run deploy
```

`npm run deploy` は `vercel` を実行します。

## API仕様

### `GET /api/words?room=main`

指定ルームの投稿を取得し、ワードごとに集計して返します。

#### レスポンス例

```json
{
  "room": "main",
  "words": [
    {
      "word": "安心",
      "count": 3
    },
    {
      "word": "挑戦",
      "count": 1
    }
  ]
}
```

### `POST /api/words?room=main`

指定ルームにワードを投稿します。

#### リクエスト例

```json
{
  "word": "安心"
}
```

#### 成功レスポンス例

```json
{
  "ok": true,
  "room": "main",
  "words": [
    {
      "word": "安心",
      "count": 1
    }
  ]
}
```

#### エラーレスポンス例

```json
{
  "error": "Word is required."
}
```

### `POST /api/reset?room=main`

指定ルームの表示対象をsoft resetします。投稿データは物理削除されません。

#### リクエスト例

```json
{
  "password": "YOUR_ADMIN_PASSWORD"
}
```

#### 成功レスポンス例

```json
{
  "ok": true,
  "room": "main"
}
```

#### エラーレスポンス例

`RESET_PASSWORD` が未設定の場合:

```json
{
  "error": "RESET_PASSWORD is not configured."
}
```

パスワードが不正な場合:

```json
{
  "error": "Invalid reset password."
}
```

## 入力仕様

### ワード

投稿されたワードはAPI側で以下のように正規化されます。

| 処理 | 内容 |
| --- | --- |
| 文字列化 | `word` を文字列として扱う |
| 前後空白削除 | 先頭と末尾の空白を削除 |
| 連続空白の圧縮 | 複数の空白を半角スペース1つへ変換 |
| 最大文字数 | 30文字までに切り詰め |
| 空文字チェック | 空の場合はエラー |

ブラウザ側の入力欄にも `maxlength="30"` が設定されています。

### ルームコード

ルームコードは以下のように正規化されます。

| 処理 | 内容 |
| --- | --- |
| 未指定時 | `main` |
| 前後空白削除 | 先頭と末尾の空白を削除 |
| 使用可能文字 | 英数字、ハイフン、アンダースコア |
| 最大文字数 | 32文字 |
| 空になった場合 | `main` |

## 集計仕様

APIはSupabaseから指定ルームの最新2000件を取得し、Node.js側でワードごとに集計します。

並び順:

1. カウントが多い順
2. カウントが同じ場合は、日本語ロケールでの文字列順

現在の実装では、2000件を超える投稿がある場合、最新2000件の範囲で集計されます。

## 表示仕様

### 文字サイズ

投稿回数に応じて段階的に文字サイズが変わります。

通常画面:

```text
12, 18, 26, 36, 48, 62, 78, 96px
```

表示専用画面:

```text
15, 35, 55, 75, 95, 115, 135, 155px
```

8回以上投稿されたワードは最大サイズになります。

### 色

ワードごとの文字色は、単語から計算したハッシュにより決まります。

同じワードは基本的に同じ色になります。

### 配置

ワードはグリッド状の基準位置をもとに配置されます。

大きいワードほど中央に寄りやすく、重なりを避けるために候補位置を探索します。

## 更新仕様

参加者入力画面:

- 画面読み込み時に一度取得
- 投稿成功時に再描画
- ルーム切り替え時に再取得
- 常時ポーリングはしない

表示専用画面:

- 画面読み込み時に一度取得
- 表示中は6秒ごとに `/api/words` を取得
- タブが非表示になると更新停止
- 再表示時に再取得して更新再開

## データ保存仕様

投稿データはSupabaseの `word_entries` テーブルに1投稿1行として保存されます。

ローカル環境でSupabase環境変数が未設定の場合は、代わりにプロジェクト直下の `.local-word-entries.json` に保存されます。

例:

| room | word |
| --- | --- |
| `main` | `安心` |
| `main` | `安心` |
| `main` | `挑戦` |
| `workshop2026` | `成長` |

集計結果を保存するのではなく、投稿履歴から都度集計します。

## セキュリティ・運用上の注意

- Supabaseのservice role keyやsecret keyは必ずVercel環境変数に設定し、フロントエンドには埋め込まないでください。
- リセット機能は固定パスワードのみで保護されています。
- 投稿機能に認証はありません。
- NGワード除外は未実装です。
- 同一ルームのURLを知っている人は誰でも投稿できます。
- 本番イベントでは、ルームコードを推測されにくい名前にすることを推奨します。

## トラブルシュート

### `Missing Supabase environment variables.`

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` または `SUPABASE_SECRET_KEY` が設定されていません。

Vercelまたはローカル環境に必要な環境変数を設定してください。

### `RESET_PASSWORD is not configured.`

`RESET_PASSWORD` が設定されていない状態でリセットを実行しています。

Vercel環境変数に `RESET_PASSWORD` を設定してください。

### 投稿しても表示専用画面にすぐ出ない

表示専用画面は6秒ごとに更新されます。

数秒待っても反映されない場合は、以下を確認してください。

- 参加者入力画面と表示専用画面のルームコードが一致しているか
- Supabase環境変数が正しいか
- VercelのFunctionsログにエラーが出ていないか

### 2000件以上の投稿が集計されない

現在のAPIは最新2000件を取得して集計します。

大量投稿を扱う場合は、Supabase側のSQL集計やRPC関数、キャッシュ機構への変更を検討してください。

## 現在未実装の機能

- Supabase Realtime による完全リアルタイム更新
- NGワード除外
- 投稿受付の開始・停止
- 管理者ログイン
- 投稿者識別
- 投稿履歴の画面表示
- ルーム一覧
- DB側での集計
- CSVエクスポート

## 拡張案

### Supabase Realtime対応

ポーリングではなくSupabase Realtimeを使うと、投稿直後に表示専用画面へ反映できます。

### 管理者画面

ルーム作成、リセット、NGワード管理、投稿停止などをまとめた管理画面を追加できます。

### DB側集計

投稿数が増える場合は、Supabase RPCやViewを使ってDB側で集計すると効率が上がります。

### 表記ゆれ吸収

ひらがな・カタカナ・全角半角・大文字小文字などを正規化すると、集計精度が上がります。

### データ出力

イベント終了後に投稿一覧や集計結果をCSVで出力できるようにすると、振り返りやレポート作成に使いやすくなります。
