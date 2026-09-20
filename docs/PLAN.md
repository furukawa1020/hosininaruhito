# Architecture and next tasks

Browser → Firebase Hosting /api rewrite → Cloud Run Hono → 星API / Jev / Codex SDK。
カメラの毎フレームはローカル処理。AIは提案し、決定論的な検証器が実行権限を持つ。

## Contract

ProgramV1: version=1, constellationId, source, steps[1..12]。
constellationId/source/starIdは空白のみを許さない200文字以内の文字列。
Step: starId（unique）, joint（leftWrist/rightWrist）, target{x,y}, holdMs, tolerance。
座標：非ミラーの画像正規化値。左上原点、x右、y下。メートル値ではない。
PoseSample: joint,x,y,at,confidence。atとtickは同一単調時計のミリ秒。カメラのatはcaptureTime、未提供ならpresentationTimeであり、常に露光時刻が得られるわけではない（POSE.md参照）。
Capture: starId,joint,x,y,at,capturedAt,error。atはセンサーの実測時刻、capturedAtは確定処理時刻。
保持時間は新しいsample.atでのみ進む。Captureの座標は実測値で、目標値に上書きしない。

無効な計測、追跡ロスト、古い/重複/逆行した計測、時計逆行、150msを超える間隔でpausedへ遷移する。
再開にはstart()が必要で、保持時間は最初から計測する。完了後はreset()なしに再captureしない。
これは計測上の判定であり、画像内の境界値だけで身体の到達可能性や安全性を保証しない。

## API routes

GET /api/status: 設定の有無。services.access/sky/reflex/plannerでサービス別に返す。接続成功を意味しない。
POST /api/sky {lat,lng}: 星APIの実呼出。日時省略のprovider-default。日時の追加指定は未対応のため拒否。
POST /api/reflex {dx,dy,tracked}: Jevの実呼出。助言のみ。
POST /api/program {constellation:{id,stars:[{id,x,y}]}}: Codexで順序を計画。座標と保持条件の不変を検証。
POSTはBearer HCR_ACCESS_TOKENが必要。16KiB、外部呼出1件/instanceまで。
API応答はno-store。HTTP通信は12秒・1MiB以内、Codexは40秒で中断。クライアント切断を伝播する。

## P0

- [ ] APIキー設定後のライブスモーク。失敗時は代替fixtureで成功と扱わない
- [ ] Cloud Run相当のコンテナでCodex read-only sandbox確認。失敗時に無効化しない
- [ ] 星カタログ・ライセンス・drowingのID体系と線分の解釈確認
- [ ] 星APIの日時書式とタイムゾーンの確認

星APIのdirectionNum/altitudeNumは星座代表値で恒星座標ではない。drowingを座標として解釈しない。
振付APIはカタログ由来の正規化座標を受け取る契約だけで、星API→振付の自動接続は未完了。

## P1

- [ ] 恒星座標→投影→到達領域調整→Program。地平線下・投影特異点を扱う
- [x] MediaPipe Poseのローカル推論。撮影同意、拒否、停止、鏡像、追跡ロストのテスト（実機精度・遅延は未確認）
- [ ] Three.js残像。時刻付き実測点の蓄積、常設停止、Esc、非表示時停止
- [ ] Codex plan→validate→simulate→critic→replanを上限付き処理にする
- [ ] Jev最大2Hz、古い応答破棄、同時1リクエスト、実測遅延評価
- [ ] Firebase Auth + App Check + ユーザー別quota。開発共有トークンを廃止

## Deployment via connected integrations

対象project IDと課金設定を確認。連携でCloud Run/Build/Artifact Registry/Secret Managerを準備。
Firebase Hostingはdist、Cloud RunはDockerfile。hcr-api / asia-east1をfirebase.jsonと一致させる。
OPENAI_API_KEY / TYPESAFE_API_KEY / HOSHIMIRU_API_TOKEN / HCR_ACCESS_TOKENはSecret Managerに保存。
専用SAには必要な秘密だけの参照権限。CODEX_MODELは環境変数。
Cloud Run: PORT待受、max instances=1、concurrency=1、timeout=50秒を初期設定。
最初は非公開。Hosting rewriteで外部公開する前に認証・課金上限・公開範囲を確認する。
Hosting rewriteは60秒制限。長い処理は非同期ジョブへ分離。
予算アラートは課金上限ではない。提供者側の利用上限と緊急停止を設ける。
CLIへ自動フォールバック禁止。接続済み連携が見えなければユーザーに有効化を依頼。

## 2026-09-20 進捗

- [x] 観測地点・送信同意・星座一覧・説明・物語・地平線下表示
- [x] 星APIのみの設定で観測可能。Jev/Codexの設定状態は別表示
- [x] 停止ボタン・Esc・非表示で通信中断、古い応答破棄、切断のサーバー伝播
- [x] 応答の型・ID重複・角度・サイズ検証、HTTPエラーの区別
- [x] ライブスモークコマンド追加。未設定時は失敗終了しfixtureで代用しない
- [x] HumanRuntimeの追跡ロスト・古い計測・時計逆行で明示再開まで停止
- [x] センサー時刻で保持時間を計測し、実測時刻と確定時刻を別々に保存
- [x] npm run check成功（74テスト＋ビルド）、Edgeで35ブラウザー試験成功
- [x] PC・スマートフォン幅の画像を確認。lockfileにPlaywright開発依存を反映
- [x] 日本語Issueを全体管理1件＋機能/検証19件に分割

詳細な確認根拠と未確認点は[API-VERIFICATION.md](API-VERIFICATION.md)。
星APIトークン未設定のためP0の実APIライブスモークは未完了。
恒星カタログ接続、身体推定の実機確認、Three.js残像、Cloud Run sandbox確認、認証基盤、デプロイは未完了。

## GitHub Issueと依存関係

全体管理：[完成までのロードマップ #1](https://github.com/furukawa1020/hosininaruhito/issues/1)。
各Issueに目的・範囲・完了条件・依存関係・検証方法を記載する。
実装済みと統合済みを区別し、PRと検証証拠を確認してから完了にする。

| Issue | 成果物 | 依存 |
| --- | --- | --- |
| [#2](https://github.com/furukawa1020/hosininaruhito/issues/2) | 実APIの観測画面と停止・エラー表示を仕上げる | なし |
| [#3](https://github.com/furukawa1020/hosininaruhito/issues/3) | 星APIの実トークンで疎通と失敗時の挙動を確認する | #2 |
| [#4](https://github.com/furukawa1020/hosininaruhito/issues/4) | 星APIの日時書式・タイムゾーン・省略時の基準を確定する | なし |
| [#5](https://github.com/furukawa1020/hosininaruhito/issues/5) | 恒星カタログ・星座線のID対応と利用条件を確定する | なし |
| [#6](https://github.com/furukawa1020/hosininaruhito/issues/6) | 出典付き恒星データの取り込みと星座ID変換を実装する | #5 |
| [#7](https://github.com/furukawa1020/hosininaruhito/issues/7) | 恒星座標から観測方向・画面座標への投影を実装する | #4, #6 |
| [#8](https://github.com/furukawa1020/hosininaruhito/issues/8) | 追跡ロスト・古い計測・時計逆行で実行を確実に停止する | なし |
| [#9](https://github.com/furukawa1020/hosininaruhito/issues/9) | 撮影同意とカメラの開始・拒否・解放を実装する | #2, #8 |
| [#10](https://github.com/furukawa1020/hosininaruhito/issues/10) | MediaPipe Poseで手首をローカル推定し計測契約へ変換する | #9 |
| [#11](https://github.com/furukawa1020/hosininaruhito/issues/11) | 無理のない到達範囲を計測し振付目標を調整する | #7, #10, #8 |
| [#12](https://github.com/furukawa1020/hosininaruhito/issues/12) | Three.jsで時刻付き実測点の星座と残像を描画する | #6, #8 |
| [#13](https://github.com/furukawa1020/hosininaruhito/issues/13) | Codexの振付計画を検証・シミュレーション・再計画の上限付き処理にする | #6, #11, #8 |
| [#14](https://github.com/furukawa1020/hosininaruhito/issues/14) | Jevの助言を最大2Hz・同時1件に制御する | #10, #8 |
| [#15](https://github.com/furukawa1020/hosininaruhito/issues/15) | 観測・準備・身体誘導・完成を一つの体験につなぐ | #3, #7, #10, #11, #12, #13, #14 |
| [#16](https://github.com/furukawa1020/hosininaruhito/issues/16) | Cloud Run相当のコンテナでCodex sandboxと中断を検証する | なし |
| [#17](https://github.com/furukawa1020/hosininaruhito/issues/17) | Firebase認証・App Check・ユーザー別上限で公開APIを保護する | #2 |
| [#18](https://github.com/furukawa1020/hosininaruhito/issues/18) | 単体・ブラウザー試験をCI化し検証結果を再現可能にする | #2, #8 |
| [#19](https://github.com/furukawa1020/hosininaruhito/issues/19) | 指定プロジェクトにFirebase HostingとCloud Runを段階公開する | #3, #16, #17, #15, #18 |
| [#20](https://github.com/furukawa1020/hosininaruhito/issues/20) | 実API・実カメラによる作品全体の受入試験を完了する | #15, #19 |

観測基盤 #2 と安全停止 #8 を先に固める。外部キー等を必要とする #3/#4/#5/#16 と、
独立して進められる実装を区別する。最終的な完成判定は #20 の実API・実機受入試験による。

## カメラとCI成果物（#9 / #18）

- [x] 位置送信とは別の撮影同意、ローカルプレビュー、音声取得なし
- [x] 停止・Esc・非表示・同意撤回・pagehideで全トラックを解放
- [x] 許可待ちの停止、遅延ストリームの破棄、切断時停止、明示的な再開
- [x] CameraSessionの正常系/異常系18件を追加。npm run checkは合計48件とビルド成功
- [x] Edgeでカメラ9件＋観測8件、合計17件のブラウザー回帰試験成功。PC・スマートフォン幅の表示確認
- [x] Linux CIで48件＋ビルド＋17件成功。合成画像5枚の7日保存とダウンロードを確認（#18）
- [ ] 実機での許可表示・カメラ解放を確認（#9の残条件）

仕様と手動確認手順は[CAMERA.md](CAMERA.md)。身体推定はPR #23で統合済み。作品の振付セッションへの接続は未実装。
ブラウザー試験の映像はコードで生成する合成パターン。実カメラや映像ファイルを持ち込まない。
依存パッケージの追加・変更はなく、既存lockfileを維持。CIのnpm ciで再現性を確認する。

## ローカル身体推定（#10）

- [x] MediaPipe Tasks Vision 1.0.1とLiteモデルfloat16/1を固定。モデルのサイズ・SHA-256検証と同一オリジン配信
- [x] Module Workerで同時1枚の推論。左右手首の画像座標・可視性・Window単調時刻へ変換
- [x] 150msを超えた結果、人物不在・複数検出・遮蔽・不正値、モデル失敗で推定停止。明示操作で再開
- [x] カメラ停止・Esc・非表示・同意撤回で推論と手首表示も停止
- [x] 外部通信を制限するCSPをHono・Vite・Hosting設定へ追加。映像・関節座標を送信/保存しない
- [x] 計測契約とWorker所有権の14試験、合成入力での実SDK起動・人物不在・404を含む10ブラウザー試験
- [x] Edgeで全27件の回帰試験成功。PC・スマートフォン幅の手首表示を目視確認
- [x] Linux CIでも62件＋ビルド＋27件成功（run 35494900076）
- [ ] 実カメラ・実人体の左右/遮蔽/遅延確認（#10の残条件）

詳細は[POSE.md](POSE.md)。実モデルの人体検出正常系と身体誘導・captureへの統合は未検証/未実装。
SDK追加と固定版をpackage-lock.jsonに反映。モデルとライセンスを同梱し、通常CIでモデルの外部取得は行わない。

## 動かせる範囲の計測（#11）

- [x] 座位/立位と左右の手を選び、本人の開始・確定操作で計測。中断・やり直し
- [x] 3秒以上・30点以上、最大30秒・601点。確定後は記録時間と点を固定
- [x] ロスト・遅延・停止・非表示・同意撤回・姿勢/手/映像寸法の変更で記録を消去
- [x] 形と星IDを保つ縮小・平行移動。各目標の近くに複数時刻の観測点を要求し、重なりと未観測点を拒否
- [x] 単体12件を追加。計測UIに合成入力のブラウザー8件を追加
- [x] npm run checkは74件＋ビルド成功。Edgeで全35件成功、PC/スマートフォン幅を目視確認
- [ ] カタログ投影と実セッションへ接続し、配置の縮小・拒否理由を画面に表示（#7/#15）
- [ ] 実カメラ・参加者で計測手順と負担を確認

詳細と境界値は[REACH.md](REACH.md)。配置関数は合成入力で検証し、星APIの代表値から星を作らない。
片手を動かす操作に対応するが、現行推定では両手首が映る必要がある。片手のみの検出は未対応。
依存パッケージの変更はなく、既存lockfileを維持。
