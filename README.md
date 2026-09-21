# 星にされる人 — Human Constellation Runtime

一人の身体を時間方向に展開して星座を作る作品。現在は、実APIから星座を取得する観測画面と、撮影への個別同意によるローカルカメラプレビュー・手首のローカル推定を実装しています。

公開サイト: https://hosininaruhito-20260920.web.app
実ブラウザーのログイン・App Check・星をみるひとAPIの32星座取得を確認済み。Cloud Run上のVertex AI生成も成功しました。実カメラ・実人体の受入確認は残っています。

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
Jev・振付AIは任意の別設定で、星APIの観測だけなら不要です。クラウドでは `HCR_PLANNER_PROVIDER=vertex` を選び、Cloud Runサービスアカウントで認証できます。[Vertex AIの設定・配備準備](docs/VERTEX.md)。Codexを選ぶ場合は `CODEX_MODEL` に利用可能モデルを明示します。

公開環境は「ゲストとしてはじめる」で登録・入力なしに開始できます。星API、カメラ、手首推定、配置、保持による星座完成、Vertex AIはアカウント利用時と同じ機能です。撮影・位置送信・AI利用にはそれぞれ同意が必要です。ゲストも同じ日次上限を使います。

## あそび方

1. 「ゲストとしてはじめる」を押し、現在地を入力するか緯度・経度を指定します。位置の送信に同意して星座を探し、名前を押して選びます。
2. 顔と両手首が映る位置に端末を置きます。撮影に同意してカメラを開始し、手首の推定を始めます。動かす手を選び、楽な範囲で上下・左右に3秒以上動かして「ここまでを使う」を押します。
3. 「配置を準備する」→「配置した星座を開始する」と進みます。画面の輪に手の光を重ね、楽なら0.8秒止めると星が残ります。すべての星をつなぐと完成です。AIの順序計画は任意です。

「次にすること」と各段階の案内は実際の進行状態に合わせて変わります。停止・追跡ロスト時はカメラや計測の準備へ戻ります。位置取得はボタンを押したときだけで、小数第2位へ丸めます。取得と星APIへの送信は別操作です。現在地が使えなくても手入力で進めます。

「アカウントでログイン」から従来の招待済みFirebaseアカウントも使えます。開発トークンは使用しません。[認証・日次上限・緊急停止](docs/AUTH.md)。所有者のログイン情報はGit管理外の `.env` の `HCR_OWNER_EMAIL` / `HCR_OWNER_PASSWORD` にあり、チャットへ転記しないでください。

## 現在できること

- サービス別に設定済み／未設定を確認（設定済みは疎通成功を意味しません）
- 同意後に入力座標を星APIへ送信し、星座一覧を高度順に表示
- 星座の代表方位・高度、説明、物語を確認。地平線下は明示
- 停止ボタン・Esc・画面非表示による通信中断、古い応答の破棄
- 個別同意後のカメラプレビュー。停止・Esc・非表示・同意撤回で映像を解放し、明示操作で再開
- 左右の手首を端末内で推定。座位/立位と使う手を選び、楽に動かせる範囲を一時的に記録
- 選択した星座を記録した範囲へ配置し、0.8秒の保持で実測点を確定。完了・配置失敗・条件変更による中断を表示
- 手首の動きを光の軌跡として表示。停止時は静止し、撮影同意の撤回で消去
- 認証、16KiBの入力制限、同時実行1件、タイムアウト、応答のサイズ・型・範囲検証
- Jevの助言API、Codex SDKの振付計画API、決定論的な保持/captureの基盤

星APIへサーバーの現在時刻をJSTのdate/hour/minとして明示送信します。API側のタイムゾーン、`drowing`のID体系と線分の意味は未確認。
星座の代表方位・高度から恒星位置は生成しません。恒星カタログの読み込みAPIは実装済み（[出典とID対応](docs/CATALOG.md)）。星座選択→投影→計測範囲への配置→保持確定を接続しました（[セッション仕様](docs/SESSION.md)）。Codexの順序計画を個別同意で選べます（[仕様と実API確認](docs/AI-PLANNER.md)）。Jevの補助コメントも別同意で選べます（[送信内容と制限](docs/JEV.md)）。Three.jsによる手首の軌跡表示を追加しました（[表示・停止仕様](docs/TRACE.md)）。身体推定の実機精度は未確認です。
fixturesはテスト専用で、実APIの失敗時にモックへ切り替えません。

カメラはAPI設定なしでも利用できます。HTTPSまたはlocalhostで撮影に同意し、「カメラを開始する」を押します。音声は取得せず、映像の送信・保存は行いません。[停止仕様と実機確認手順](docs/CAMERA.md)を参照してください。

手首の推定はカメラ開始後に別ボタンで開始します。SDK・WASM・モデルはアプリから配信し、映像はWorker内で処理します。ローカル推定の仕様・配布条件・未確認事項は[POSE.md](docs/POSE.md)。初回ビルド前にモデルを手動取得する必要はありません。

動かせる範囲の計測は、手首推定の開始後に利用できます。姿勢・使う手を選び、本人の操作で開始・確定します。追跡が止まると記録を消去します。[REACH.md](docs/REACH.md)を参照。星APIで選んだ星座の投影と接続できます。カタログ順またはCodexが提案して検証済みの順序で実行します。

## 検証

- `npm run check`：Nodeテストと本番ビルド。外部APIを呼びません。
- `npm run test:browser`：Playwrightによる画面試験。API成功応答はテスト内のfixture、カメラは合成映像の疑似デバイスです。実カメラは使用しません。
  - 初回は`npx playwright install chromium`で試験用ブラウザーを用意できます。
  - インストール済みEdgeを使うWindows環境では、PowerShellで`$env:HCR_BROWSER_CHANNEL='msedge'`を設定します。
- `npm run smoke:jev`：固定の合成入力を1回だけ実Jevへ送る有料API試験。TYPESAFE_API_KEYが必要。
- `npm run smoke:ai`：合成3目標を選択した実AIへ送る有料API試験。VertexはADCと専用project/location/model、CodexはOPENAI_API_KEYとCODEX_MODELが必要。Vertexの実生成は確認済み。実人体の試験とは別です。
- `npm run smoke:sky`：星APIへの実リクエスト。以下をローカルの`.env`に設定した場合だけ実行します。
  - `HCR_ACCESS_TOKEN`、`HOSHIMIRU_API_TOKEN`
  - `HCR_SMOKE_LAT`、`HCR_SMOKE_LNG`：送信してよい観測地点
  - `HCR_SMOKE_SEND_LOCATION=yes`：上記の位置の送信に同意

ライブ試験は未設定・エラーを終了コード1で報告し、座標・トークン・応答本文をログへ出しません。
テストやビルド成功は、外部APIの接続成功や作品全体の完成を意味しません。

CIはNode 22とlockfile固定のPlaywright/Chromiumで試験します。スクリーンショットはActionsのbrowser-screenshots成果物に7日間保存します。保存対象はtest-results内のPNGのみで、実APIキー・実映像を使う試験はCIへ混ぜません。失敗時も画像を保存し、ログはActionsのジョブログで確認できます。Windowsでのローカル試験はインストール済みEdgeを使用できます。

## 開発・デプロイ

[AGENTS.md](AGENTS.md)と[docs/PLAN.md](docs/PLAN.md)に沿ってP0から進めます。
Firebase Hosting + Cloud Runへデプロイ済みです。対象は専用project `hosininaruhito-20260920`。
接続済み連携が利用できなかったため、利用者の委任を受けてCLI配備を実施しました。[配備記録](docs/DEPLOYMENT.md)。

## 一次資料

- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/codex-sdk
- https://hoshimiru.apidog.io/
- https://hoshimiru.apidog.io/llms.txt
- https://docs.typesafe.ai/introduction/quickstart
- https://firebase.google.com/docs/hosting/cloud-run
