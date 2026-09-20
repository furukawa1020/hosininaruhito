# ローカル身体推定（Issue #10）

## 実装した範囲

撮影に同意してカメラを開始した後、「手首の推定を開始・再開する」で開始する。
映像はModule Worker内のMediaPipeへ渡し、左・右の手首を鏡像プレビュー上に表示する。
動かせる範囲の計測へ接続済み（[REACH.md](REACH.md)）。星座への身体誘導・capture・残像描画とは未統合。

- SDKは`@mediapipe/tasks-vision@1.0.1`。package-lock.jsonで配布物のintegrityも固定。
- モデルはPose Landmarker Lite float16/1、5,777,746 bytes。
- SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- モデルをリポジトリへ同梱。ビルド・開発開始時にサイズとハッシュ、SDKの版を検証する。
- SDKのModule用WASM/loaderをnpm配布物からpublic/pose/wasmへコピーする。生成物はGitに含めない。
- SDK・モデルはApache-2.0。配布時のライセンスと出典はpublic/third-partyに同梱。
- 初期化時だけモデルを読み込み、推論はCPU delegate、VIDEO mode、numPoses=2。分割マスクは取得しない。
- 同時に処理する画像は1枚。取り込み待ちに停止した場合も、返ってきたImageBitmapを閉じる。
- 各結果のマスク資源と画像をcloseし、停止時はフレーム予約・タイマーを解除してWorkerを終了する。

## 計測契約

`normalizePose`はSDKのimage landmarksの15番（左手首）と16番（右手首）だけを変換する。
worldLandmarks、z、推定されたメートル値は使わない。非ミラーの画像正規化座標を保持する。
表示時だけxを1-xへ変換する。SVGのviewBoxとobject-fit:containの余白を合わせる。

人物不在・複数検出・不正座標・両手首のvisibility不足（0.8未満）は有効なサンプルを返さない。
visibilityは計測を採用しないための条件であり、身体の安全・到達可能性・captureの判断ではない。
一人という検出結果も、実際に一人しかいないことの保証にはならない。

時刻はWindow側のperformance時計を使う。requestVideoFrameCallbackのcaptureTimeがあれば採用し、
なければpresentationTimeを使う。後者はブラウザのフレーム提示時刻で、カメラの露光時刻ではない。
Workerの別時計や推論終了時刻で付け替えない。150msを超えた結果、未来・重複・逆行時刻は破棄する。
結果が来なくても150msの監視で停止する。モデル初期化は20秒で中断する。

追跡ロストや遅延では手首表示と推論を停止し、自動復帰しない。カメラのプレビューは映り方を直すため継続する。
常設停止・Esc・非表示・同意撤回・ページ離脱ではカメラも停止する。
実行側にはonSampleのnullを停止信号として渡せる。HumanRuntimeの計測契約との接続は単体試験で確認済み。
実際の振付セッションへの入力は#15で統合する。

## 外部通信

実行時のSDK・WASM・モデルは同一オリジンから取得し、映像・関節座標・利用統計を外部へ送信しない。
SDK READMEには統計送信の一般的な記載があるため、Hono・Vite・Firebase Hostingの
Content-Security-Policyでconnect-src/worker-src/script-srcを同一オリジンに制限する。
WebAssembly用のwasm-unsafe-evalだけを許可し、JavaScript evalは許可しない。
初期化と合成画像の実推論で外部リクエストがないことをブラウザー試験で確認する。

星API等のリクエストは従来どおり同一オリジンの認証済みサーバー経由。撮影と位置送信の同意は独立。

## 検証と限界

- 単体試験：SDK出力の型・左右・座標・遮蔽・複数人、HumanRuntimeの保持、Worker所有権、
  多重起動、遅延結果・遅延ImageBitmap、時計、タイムアウト、停止・再開。
- 実SDK試験：同梱モデルとWASMで合成画像/合成カメラの人物不在を処理。モデル取得404も確認。
- UIの正常な手首表示・複数人・遮蔽等は、合成座標を返すテスト専用Workerで確認。
  これは実モデルの人体検出精度を検証するものではない。
- 実カメラ・実際の人体による左右、精度、遮蔽、処理遅延は未確認。実機を使わず成功扱いにしない。
- 非表示タブと履歴移動はイベント経路の試験。実機ブラウザーの停止表示は#9/#20で確認する。
- HTTPS/localhost、Module Worker、OffscreenCanvas、WASM SIMD、requestVideoFrameCallbackが必要。
  利用できない環境はエラーを表示し、別モデルやfixtureへ自動切り替えしない。

実機では本人が撮影同意後に開始し、左右を一方ずつ動かす、片手を隠す、画面外へ出る、
タブ切り替え・停止・再開を確認する。遅延が150msを超える端末で停止条件を緩めない。
記録はブラウザー/OS・成否・遅延値のみ。顔や映像・関節座標をIssueへ添付しない。

## 一次資料

- [Web実装ガイド](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [関節番号とモデル](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- [モデルカードとライセンス](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- インストール済みSDKのvision.d.ts：forVisionTasks(basePath, useModule)、NormalizedLandmark、
  PoseLandmarkerOptions、PoseLandmarkerResult.close、TaskRunner.closeを確認。
