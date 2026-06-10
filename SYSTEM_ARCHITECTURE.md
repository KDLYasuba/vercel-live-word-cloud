# Vercel Live Word Cloud システム構成図

## 全体構成

```mermaid
flowchart LR
  MC["司会者<br/>/admin"] -->|タイトル適用<br/>管理者パスワード| TitleAPI["/api/title"]
  P["参加者<br/>/"] -->|ワード投稿| WordsAPI["/api/words"]
  S["表示専用画面<br/>/screen"] -->|投稿一覧を定期取得| WordsAPI

  P -->|現在タイトルを定期取得| TitleAPI
  S -->|現在タイトルを定期取得| TitleAPI

  TitleAPI --> Store["保存層"]
  WordsAPI --> Store
  ResetAPI["/api/reset"] --> Store

  Store -->|本番| Supabase["Supabase<br/>word_entries"]
  Store -->|ローカルSupabase未設定時| LocalJson[".local-word-entries.json"]
```

## 画面構成

```mermaid
flowchart TB
  Admin["/admin<br/>司会者設定画面"] --> Apply["タイトルを適用"]
  Apply --> Password["管理者パスワード入力"]
  Password --> ResetAndSave["該当タイトルの投稿をリセット<br/>現在タイトルとして保存"]

  Participant["/<br/>参加者入力画面"] --> Submit["ワード送信"]
  Screen["/screen<br/>表示専用画面"] --> Display["ワードクラウド表示"]

  ResetAndSave --> Sync["現在タイトル同期"]
  Sync --> Participant
  Sync --> Screen
```

## API構成

| API | Method | 役割 |
| --- | --- | --- |
| `/api/title` | `GET` | 現在のタイトルを取得 |
| `/api/title` | `POST` | 管理者パスワードを検証し、タイトルを適用。同時にそのタイトルの投稿をリセット |
| `/api/words?room=...` | `GET` | 指定タイトルの投稿を集計して取得 |
| `/api/words?room=...` | `POST` | 指定タイトルへワードを投稿 |
| `/api/reset?room=...` | `POST` | 指定タイトルの投稿をリセット |

## データ保存

本番環境ではSupabaseの `word_entries` テーブルを使います。

```mermaid
erDiagram
  word_entries {
    bigint id PK
    text room
    text word
    timestamptz created_at
  }
```

通常投稿は以下のように保存されます。

| room | word |
| --- | --- |
| `今日の学び` | `発見` |
| `今日の学び` | `安心` |

現在タイトルは、追加テーブルを作らず、同じ `word_entries` の特殊roomに保存します。

| room | word |
| --- | --- |
| `__live_word_cloud_state__` | `今日の学び` |

ローカルでSupabase環境変数がない場合は、同じ形式のデータを `.local-word-entries.json` に保存します。

## タイトル適用フロー

```mermaid
sequenceDiagram
  participant MC as 司会者画面 /admin
  participant API as /api/title
  participant DB as Supabase or Local JSON
  participant SC as 表示専用画面 /screen
  participant PT as 参加者画面 /

  MC->>MC: タイトル入力
  MC->>MC: 管理者パスワード入力
  MC->>API: POST room, password
  API->>API: RESET_PASSWORDを検証
  API->>DB: 新タイトルの投稿を削除
  API->>DB: 現在タイトルを保存
  API-->>MC: ok, room
  MC->>MC: 画面内状態を更新
  SC->>API: GET /api/title
  API-->>SC: 現在タイトル
  SC->>SC: 表示タイトルと集計対象を更新
  PT->>API: GET /api/title
  API-->>PT: 現在タイトル
  PT->>PT: 投稿先タイトルを更新
```

## ワード投稿フロー

```mermaid
sequenceDiagram
  participant PT as 参加者画面 /
  participant API as /api/words
  participant DB as Supabase or Local JSON
  participant SC as 表示専用画面 /screen

  PT->>API: POST word, room=current title
  API->>DB: 投稿を保存
  API->>DB: 最新500件を取得
  API-->>PT: 集計済みwords
  SC->>API: GET words every 6 sec
  API->>DB: 最新500件を取得
  API-->>SC: 集計済みwords
  SC->>SC: ワードクラウドを再描画
```

## 環境変数

| 変数名 | 用途 |
| --- | --- |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase REST APIへアクセスするサーバー用キー |
| `SUPABASE_SECRET_KEY` | `SUPABASE_SERVICE_ROLE_KEY` の代替 |
| `SUPABASE_TABLE` | 保存テーブル名。未設定時は `word_entries` |
| `RESET_PASSWORD` | タイトル適用・リセット用の管理者パスワード |

## デプロイ構成

```mermaid
flowchart LR
  Local["Local Repository"] -->|git push| GitHub["GitHub<br/>KDLYasuba/vercel-live-word-cloud"]
  GitHub -->|Git連携デプロイ| Vercel["Vercel<br/>vercel-live-word-cloud"]
  Vercel -->|Serverless Functions| APIs["/api/title<br/>/api/words<br/>/api/reset"]
  APIs --> Supabase["Supabase"]
```

## ローカル実行

```bash
cd /Users/yasuba/Library/CloudStorage/Dropbox/workspace/AI/Codex/vercel-live-word-cloud
npm run local
```

ローカルURL:

| 画面 | URL |
| --- | --- |
| 司会者設定 | `http://localhost:4000/admin` |
| 参加者入力 | `http://localhost:4000/` |
| 表示専用 | `http://localhost:4000/screen` |

ローカルでSupabase環境変数が未設定の場合、管理者パスワードは以下です。

```text
local-reset
```

