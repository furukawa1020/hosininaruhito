# 星にされる人 — Human Constellation Runtime

一人の身体を時間方向に展開して星座を作る作品。現在は、実APIから星座を取得する観測画面と、撮影への個別同意によるローカルカメラプレビュー・手首のローカル推定を実装しています。

## 起動

Node 22.12以上。

1. `npm ci`
2. `.env.example`を`.env`へコピーし、まず`HCR_ACCESS_TOKEN`と`HOSHIMIRU_API_TOKEN`を設定
3. `npm run dev`
4. 表示されたローカルURLを開き、観測地点と開発アクセストークンを入力
5. 位置情報の外部送信に同意し、「この場所の星座を探す」を押す

既存の`.env`は上書きしないでください。環境変数を変更したらサーバーを再起動します。
APIキーはサーバー環境変数のみ。VITE_変数やGit、チャットへ貼らないこと。
画面に入力するのは`HCR_ACCESS_TOKEN`です。星APIのキーを画面へ入力しないでください。
Jev・Codexは任意の別設定で、星APIの観測だけなら不要です。`CODEX_MODEL`には利用可能モデルを明示します。

## 現在できること

- サービス別に設定済み／未設定を確認（設定済みは疎通成功を意味しません）
- 同意後に入力座標を星APIへ送信し、星座一覧を高度順に表示
- 星座の代表方位・高度、説明、物語を確認。地平線下は明示
- 停止ボタン・Esc・画面非表示による通信中断、古い応答の破棄
- 個別同意後のカメラプレビュー。停止・Esc・非表示・同意撤回で映像を解放し、明示操作で再開
- 認証、16KiBの入力制限、同時実行1件、タイムアウト、応答のサイズ・型・範囲検証
- Jevの助言API、Codex SDKの振付計画API、決定論的な保持/captureの基盤

星APIの日時はprovider-defaultです。日時・タイムゾーン、`drowing`のID体系と線分の意味は未確認。
星座の代表方位・高度から恒星位置は生成しません。恒星カタログ接続・星座への身体誘導・Three.js残像描画は未実装です。身体推定の実機精度は未確認です。
fixturesはテスト専用で、実APIの失敗時にモックへ切り替えません。

カメラはAPI設定なしでも利用できます。HTTPSまたはlocalhostで撮影に同意し、「カメラを開始する」を押します。音声は取得せず、映像の送信・保存は行いません。[停止仕様と実機確認手順](docs/CAMERA.md)を参照してください。

手首の推定はカメラ開始後に別ボタンで開始します。SDK・WASM・モデルはアプリから配信し、映像はWorker内で処理します。ローカル推定の仕様・配布条件・未確認事項は[POSE.md](docs/POSE.md)。初回ビルド前にモデルを手動取得する必要はありません。

## 検証

- `npm run check`：Nodeテストと本番ビルド。外部APIを呼びません。
- `npm run test:browser`：Playwrightによる画面試験。API成功応答はテスト内のfixture、カメラは合成映像の疑似デバイスです。実カメラは使用しません。
  - 初回は`npx playwright install chromium`で試験用ブラウザーを用意できます。
  - インストール済みEdgeを使うWindows環境では、PowerShellで`$env:HCR_BROWSER_CHANNEL='msedge'`を設定します。
- `npm run smoke:sky`：星APIへの実リクエスト。以下をローカルの`.env`に設定した場合だけ実行します。
  - `HCR_ACCESS_TOKEN`、`HOSHIMIRU_API_TOKEN`
  - `HCR_SMOKE_LAT`、`HCR_SMOKE_LNG`：送信してよい観測地点
  - `HCR_SMOKE_SEND_LOCATION=yes`：上記の位置の送信に同意

ライブ試験は未設定・エラーを終了コード1で報告し、座標・トークン・応答本文をログへ出しません。
テストやビルド成功は、外部APIの接続成功や作品全体の完成を意味しません。

CIはNode 22とlockfile固定のPlaywright/Chromiumで試験します。スクリーンショットはActionsのbrowser-screenshots成果物に7日間保存します。保存対象はtest-results内のPNGのみで、実APIキー・実映像を使う試験はCIへ混ぜません。失敗時も画像を保存し、ログはActionsのジョブログで確認できます。Windowsでのローカル試験はインストール済みEdgeを使用できます。

## 開発・デプロイ

[AGENTS.md](AGENTS.md)と[docs/PLAN.md](docs/PLAN.md)に沿ってP0から進めます。
Firebase Hosting + Cloud Runの設定ファイルは用意済みですが未デプロイです。
Firebase/Google Cloudの接続済み連携を優先し、CLIによる認証・デプロイへ自動的に切り替えません。

## 一次資料

- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/codex-sdk
- https://hoshimiru.apidog.io/
- https://hoshimiru.apidog.io/llms.txt
- https://docs.typesafe.ai/introduction/quickstart
- https://firebase.google.com/docs/hosting/cloud-run
