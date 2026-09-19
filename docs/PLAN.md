# Architecture and next tasks

Browser → Firebase Hosting /api rewrite → Cloud Run Hono → 星API / Jev / Codex SDK。
カメラの毎フレームはローカル処理。AIは提案し、決定論的な検証器が実行権限を持つ。

## Contract
ProgramV1: version=1, constellationId, source, steps[1..12]。
Step: starId（unique）,joint（leftWrist/rightWrist）,target{x,y},holdMs,tolerance。
座標：非ミラーの画像正規化値。左上原点、x右、y下。メートル値ではない。
PoseSample: joint,x,y,at,confidence。atとtickは同一単調時計のミリ秒。
Captureは実測値・誤差・時刻を保存。目標値で上書きしない。

## API routes
GET /api/status: 設定の有無。接続成功を意味しない。
POST /api/sky {lat,lng}: 星APIの実呼出。日時省略のprovider-default。タイムゾーンは追加確認。
POST /api/reflex {dx,dy,tracked}: Jevの実呼出。助言のみ。
POST /api/program {constellation:{id,stars:[{id,x,y}]}}: Codexで順序を計画。座標と保持条件の不変を検証。
POSTはBearer HCR_ACCESS_TOKENが必要。16KiB、外部呼出1件/instanceまで。

## P0
- [ ] APIキー設定後のライブスモーク。失敗時は代替fixtureで成功と扱わない
- [ ] Cloud Run相当のコンテナでCodex read-only sandbox確認。失敗時に無効化しない
- [ ] 星カタログ・ライセンス・drowingのID体系と線分の解釈確認
- [ ] 星APIの日時書式とタイムゾーンの確認

星APIのdirectionNum/altitudeNumは星座代表値で恒星座標ではない。drowingを座標として解釈しない。
現在の振付APIはカタログ由来の正規化座標を受け取る契約だけで、星API→振付の自動接続は未完了。

## P1
- [ ] 恒星座標→投影→到達領域調整→Program。地平線下・投影特異点を扱う
- [ ] MediaPipe Poseのローカル推論。撮影同意、拒否、停止、鏡像、追跡ロストのテスト
- [ ] Three.js残像。時刻付き実測点の蓄積、常設停止、Esc、非表示時停止
- [ ] Codex plan→validate→simulate→critic→replanを上限付きツールループにする
- [ ] Jev最大2Hz、古い応答破棄、同時1リクエスト、実測遅延評価
- [ ] Firebase Auth + App Check + ユーザー別quota。開発共有トークンを廃止

## Deployment via connected integrations
対象project IDと課金設定を確認。連携でCloud Run/Build/Artifact Registry/Secret Managerを準備。
Firebase Hostingはdist、Cloud RunはDockerfile。hcr-api / asia-east1をfirebase.jsonと一致させる。
OPENAI_API_KEY / TYPESAFE_API_KEY / HOSHIMIRU_API_TOKEN / HCR_ACCESS_TOKENはSecret Managerに保存。
専用SAには必要な秘密だけの参照権限。CODEX_MODELは環境変数。
Cloud Run: PORT待受、max instances=1、concurrency=1、timeout=50秒を初期設定。
最初は非公開。Hosting rewriteで外部公開する前に認証・課金上限・公開範囲を確認する。
Hosting rewriteは60秒制限。Codexは40秒で中断。長い処理は非同期ジョブへ分離。
予算アラートは課金上限ではない。提供者側の利用上限と緊急停止を設ける。
CLIへ自動フォールバック禁止。接続済み連携が見えなければユーザーに有効化を依頼。
