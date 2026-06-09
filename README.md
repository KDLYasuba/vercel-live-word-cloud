# Vercel Live Word Cloud

Vercel にデプロイして、スマホや PC から同じ URL にアクセスしてワードを集めるための最小構成です。

## できること

- 参加者がスマホからワードを送信
- 会場スクリーンが `/screen?room=xxx` で表示
- 6 秒ごとに投稿を再取得して自動更新
- ルームコードでイベントを分離
- リセットでそのルームだけ初期化

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

サンプルは [.env.example](/Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud/.env.example) にあります。

## 3. ローカル実行

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm install
npm run local
```

起動後、以下を開きます。

- 入力ページ: `http://localhost:4000/`
- 表示専用: `http://localhost:4000/screen?room=main`

## 4. デプロイ

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm run deploy
```

## 5. 使い方

- 入力ページ: `/`
- 表示専用: `/screen?room=main`

ルームコードを変えると、イベントごとに別のワードクラウドとして使えます。
`このルームをリセット` は `RESET_PASSWORD` に一致する固定パスワード入力時のみ実行されます。

## 補足

- 今は単語集計を API 側で 500 件まで読んで集約しています
- 件数が大きくなったら DB 側集計やキャッシュに切り替えるのがよいです
- 本格的なリアルタイム化をしたければ Supabase Realtime / Ably / Pusher に拡張できます
