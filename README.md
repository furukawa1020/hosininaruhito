# 星にされる人 — Human Constellation Runtime

一人の身体を時間方向に展開して星座を作る。これは完成品ではなく開発基盤です。

## 起動
Node 22.12以上。npm ci → .env.exampleを.envへコピーして設定 → npm run dev。
APIキーはサーバー環境変数のみ。VITE_変数やGit、チャットへ貼らないこと。
HCR_ACCESS_TOKENは開発コンソールの認証用。CODEX_MODELは利用可能モデルを明示。
npm run checkでテストとビルド。配布時点では実APIの有料呼出・デプロイは未実施。

## 含まれるもの
実接続コード：星をみるひとAPI、Jev System One、Codex SDKの振付計画。
APIコンソール、入力・出力検証、決定論的な保持/capture、Firebase rewrite、Cloud Run Dockerfile。
Three.jsは依存に用意済み。身体推定・残像描画・恒星カタログ接続は未実装。
fixturesはテスト専用。本番APIは失敗時にモックへ切り替えません。

## 次のCodexへ
AGENTS.mdとdocs/PLAN.mdを読み、P0から進めてください。
Firebase/Google Cloudの接続済み連携を優先。CLIによる認証・デプロイは行わない。

## 一次資料
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/codex-sdk
- https://hoshimiru.apidog.io/
- https://docs.typesafe.ai/introduction/quickstart
- https://firebase.google.com/docs/hosting/cloud-run
