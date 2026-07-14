# Vercel Live Word Cloud

Vercel にデプロイして、スマホや PC から同じ URL にアクセスしてワードを集めるための最小構成です。

## できること

- 参加者がスマホからワードを送信
- 会場スクリーンが `/screen?room=xxx` で表示
- 6 秒ごとに投稿を再取得して自動更新
- ルームコードでイベントを分離
- リセットでそのルームの表示対象を初期化
- `/issuer` で期限付きの司会者URLを発行

## 構成

- フロント: 静的 HTML / CSS / JavaScript
- API: Vercel Serverless Functions
- 保存先: Supabase REST API

Vercel 上ではサーバーメモリ保持が安定しないため、外部ストレージに保存して画面側は定期更新する構成にしています。

## 1. Supabase を用意

1. Supabase プロジェクトを作成
2. SQL Editor で [schema.sql](/Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud/supabase/schema.sql) を実行
3. `Project URL` とサーバー用キーを控える

使えるキーは次のどちらかです。

- `Legacy anon, service_role API keys` の `service_role`
- 新UIの `Secret keys` の `default`

## 2. Vercel 環境変数

以下を設定します。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- または `SUPABASE_SECRET_KEY`
- `SUPABASE_TABLE`
- `RESET_PASSWORD`
- `ISSUER_PASSWORD`

サンプルは [.env.example](/Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud/.env.example) にあります。

## 3. ローカル実行

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm install
npm run local
```

起動後、以下を開きます。

- 司会者設定: `http://localhost:4000/admin`
- 管理URL発行: `http://localhost:4000/issuer`
- 参加者入力: `http://localhost:4000/`
- 表示専用: `http://localhost:4000/screen?room=main`

## 4. デプロイ

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm run deploy
```

## 5. 使い方

- 司会者設定: `/admin`
- 管理URL発行: `/issuer`
- 参加者入力: `/`
- 表示専用: `/screen?room=main`

司会者設定でタイトルを適用すると、その時点以降の投稿だけが表示対象になり、表示専用画面にも反映されます。
タイトル適用には `RESET_PASSWORD` に一致する固定パスワードが必要です。
`/issuer` で発行した司会者URLでは、URL内のtokenが管理権限になります。
管理URL発行画面の発行パスワードは `ISSUER_PASSWORD` で、タイトル変更用の `RESET_PASSWORD` とは別です。

司会者画面の「CSVデータを出力」から、現在の表示対象投稿を `タイトル,ワード,時間` の3列で出力できます。
CSVはShift-JIS形式です。
期限付き司会者URLのCSV出力は、URLの終了期限から3日後まで利用できます。

## 補足

- 今は単語集計を API 側で 2000 件まで読んで集約しています
- リセットは物理削除ではなく `resetAt` 以降だけを表示するsoft resetです
- 件数が大きくなったら DB 側集計やキャッシュに切り替えるのがよいです
- 現状はSSEではなく6秒ポーリングです。本格的なリアルタイム化をしたければ Supabase Realtime / SSE / Ably / Pusher に拡張できます
