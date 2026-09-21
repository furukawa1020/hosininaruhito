# Architecture and next tasks

Browser → Firebase Hosting /api rewrite → Cloud Run Hono → 星API / Jev / Codex SDK。
公開環境の振付AIはVertex AIを選択。以下の履歴は当時の状態で、最新の検証記録を優先する。
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
POST /api/sky {lat,lng}: 星APIの実呼出。サーバー現在時刻をJST date/hour/minで送信。追加日時入力は拒否。提供者側のタイムゾーンは未確定。
POST /api/project {id,lat,lng,at}: 明示UTCでカタログを方向・画像形へ変換。星API時刻とは別契約。
POST /api/catalog {id}: 出典付き恒星・線分。J2000赤経/赤緯（度）、HIP番号、固定版と出典を返す。
POST /api/reflex {dx,dy,tracked}: Jevの実呼出。助言のみ。
POST /api/program {program:ProgramV1}: Codexで順序だけを計画。座標・関節・保持条件の不変を検証。旧constellation入力も互換対応。
POSTは本番ではFirebase ID token + App Check + 招待claim、開発のみBearer HCR_ACCESS_TOKEN。16KiB、外部呼出1件/instanceまで。本番はFirestoreによる日次上限と全revision共通leaseも必要。
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
カタログの画面統合、身体推定の実機確認、Three.js残像、Cloud Run sandbox確認、認証基盤、デプロイは未完了。

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

## 2026-09-21 恒星カタログ（#5 / #6）

- [x] 実カタログd3-celestial/XHIPの固定版、原データのSHA-256、J2000・度単位・BSD-3-Clauseと表示条件を記録
- [x] API公式の1〜88 ID表をIAU略号へ明示対応。全線分端点を元の恒星座標へ完全一致で照合
- [x] Serpensの2部分を同じ星座IDへ統合し、原資料にない接続線を作らない
- [x] 認証付きPOST /api/catalog、ファイル/版/型の検証、再生成可能なビルド、コンテナへのデータ・ライセンス同梱
- [x] 追加10試験で全88星座の往復照合、欠損・曖昧・重複・未知ID・不正値・認証・容量制限を確認
- [ ] 星APIライブ観測から画面・投影・振付への統合（#3/#7/#15）

詳細は[CATALOG.md](CATALOG.md)。drowingのID体系は引き続き未確定で、推測変換しない。
依存パッケージは追加せず、既存lockfileを維持。実API・実カメラ・デプロイを実施済みと扱わない。

## 2026-09-21 デプロイ先と接続状況

ユーザーの「環境や連携先から作成」の指示を受け、既存認証済み環境で専用GCPプロジェクト
`hosininaruhito-20260920`（project number `766405647874`）を作成し、ACTIVEを確認。
既存の別用途プロジェクトはデプロイ先に使用しない。課金リンク・Firebase初期化・サービス配備は未実施。
接続済みFirebase/Cloud Run操作ツールは見つかっていない。CLIでの新規ログインは行っていない。
公式トークン取得先はhttps://livlog.xyz/sso/login。ブラウザー操作は実行環境のACLエラーで起動できず、星APIトークン取得は未完了。

カタログ追加後のnpm run check：84件＋本番ビルド成功。差分レビューで版固定・コンテナ同梱・改行によるハッシュ変化を確認し修正。CIはPRで確認する。

## 2026-09-21 恒星の方向計算・投影（#7）

カタログPR #25をマージ済み。CI run 35535071478で84件＋ビルド＋既存35ブラウザー試験が成功。

- [x] Astronomy Engine 2.1.19の一次資料・インストール済み型を確認し、providers内のJ2000→水平座標アダプターを追加
- [x] 純粋な心射投影、地平線・天頂・広角特異点・縮退の明示エラー、元の線分の保持
- [x] 同一倍率・平行移動・非ミラーの画像形と、倍率/除外理由/UTC計算時刻/出典を明示
- [x] 認証付きPOST /api/project、厳密なUTC・地点入力、ライセンス同梱とlockfile固定
- [x] 追加10試験。極・日付境界の別SDK経路照合と実カタログ正常系、入力異常系
- [ ] 星APIの観測時刻との整合（#4）、画面・振付への接続（#15）、実空との照合

詳細は[PROJECTION.md](PROJECTION.md)。星APIの日時省略の仕様を推測していない。計算時刻はexplicit-utc-catalog-calculation。

投影追加後のnpm run check：94件＋本番ビルド成功。セルフレビューで座標系・単位・特異点・日時の区別・線分維持を確認。CIはPRで確認する。

## 2026-09-21 Three.jsの残像・確定星（#12）

- [x] ローカル手首から描画を本人の操作で開始。最大4秒・120点の軌跡を鏡像表示
- [x] HumanRuntimeの保持判定による実測captureと時刻を維持し、両端が確定した元の星座線だけを描画
- [x] 目標・現在点・軌跡・確定点の分離。停止時は静止、再開で軌跡を描き直し、同意撤回/消去で全記録を破棄
- [x] 5個の固定容量GPUバッファ、DPR最大2・長辺2048px、リサイズ・WebGL失敗・context loss・リソース解放
- [x] 追加10単体試験、104件＋本番ビルド成功。追加9ブラウザー試験がEdgeで成功
- [x] PC/スマートフォンの合成軌跡と、保持から確定した3点の実WebGL表示を目視確認
- [ ] 実星APIの選択・投影・到達範囲・振付を画面へ統合（#15）
- [ ] 実カメラ/実人体/GPU負荷下の体験・遅延を検証（#20）

詳細は[TRACE.md](TRACE.md)。画面は実推定からの軌跡を表示し、星座の保持確定はe2e専用ハーネスで検証。
fixturesを本番へ混入させない。Three.jsは既存lockfileの0.180.0を使い、追加依存なし。MITライセンスを配布物へ追加。

## 2026-09-21 星座セッションの接続（#15）

- [x] 星APIの選択IDと同じ地点→明示UTCでの恒星投影→計測範囲への配置→本人による開始→800ms保持→全対象captureでの完了
- [x] 倍率・対象外星数・計算時刻と星API時刻の未整合、配置拒否理由を画面表示
- [x] 条件変更・同意撤回・停止で要求世代を破棄。古い投影が復元しない。目標/保持進捗/確定点を表示
- [x] 追加単体4件とfixtureブラウザー12件。実API/実人体の確認とは区別
- [x] セルフレビューで旧星座描画の残留を修正。カタログ版/ライセンス照合を追加
- [ ] Codex/Jevの振付・助言統合（#13/#14）、実APIと実人体による受入（#3/#20）

詳細は[SESSION.md](SESSION.md)。独立レビューは未実施。既存lockfileの依存関係を維持し追加なし。公開認証・Cloud Run検証・デプロイは未完了。

## 合成UI試験の時刻制御（#28）

星座接続後のWindows/Edge全体試験は55/56成功。既存poseのno_person試験で、明示再開後に映像が150ms以内に届かずframe_gapへ遷移した。試験再実行だけで済ませず、pose/reachの合成Worker試験に共通の制御時計・33msフレーム・合成bitmapを導入した。
実SDK/実合成動画を使う起動・人物不在・モデル失敗の3試験は変更せず、リトライや製品の150ms条件も変更しない。合成フレームを止め、200msの経過でframe_gapになるブラウザー試験を追加した。逆行・古い応答・欠落の単体試験も維持する。

ローカル検証結果: npm run check（108件＋本番ビルド）成功。Windows/Edgeの全57ブラウザー試験が成功し、#28の再発ケースも解消した。PC完成図とスマートフォンの目標・常設停止を目視確認。目視で左手実行中の手選択欄が右手のままになる点を見つけ、表示と消去時の準備状態を同期した。最終差分の画面試験とLinux CIをPRで確認する。

## 2026-09-21 Codexの上限付き順序計画（#13 / #15）

- [x] 配置済みProgramの順序だけを構造化出力で提案。関節・座標・保持条件は固定
- [x] validate→合成simulate→critic→最大1回replan、全体40秒、応答/イベント容量制限
- [x] 一時CODEX_HOME、OS起動環境のみ継承、read-only、shell/web search無効、ツールイベント拒否
- [x] 個別送信同意、ブラウザーでの制約再検証、同意撤回後の古いAI応答破棄、失敗表示
- [x] 追加15単体試験、追加5fixture画面試験を用意。セルフレビューでSDK設定隔離と終了時削除を確認
- [ ] 生成中の厳密なトークン/請求上限。現在はターン完了後のusage 12,000超過を拒否する条件
- [ ] 有料API生成正常系。モデル一覧取得は成功したが、実SDK呼出はAPI残高ゼロで失敗
- [ ] Jevのセッション統合、実カメラ、Cloud Run sandbox、公開認証、デプロイ

詳細は[AI-PLANNER.md](AI-PLANNER.md)。SDK/依存の変更はなく既存lockfileを維持。
フルアクセスへの変更後はブラウザー連携自体が0件で、公式ログイン画面は開けない。
星API/Jevトークンの取得は未完了。専用GCP projectはACTIVE、課金未接続、Dockerエンジン停止中を再確認。

検証結果: npm run checkは123件＋本番ビルド成功。Windows/Edgeの全62ブラウザー試験成功。追加AI試験の描画モジュール読み込み待ちを明示し、製品の停止条件や計測時刻条件は緩和していない。

## 2026-09-21 コンテナ検証（#16 / #19）

PR #30をマージ。CI run 35570206607で123単体試験＋ビルド＋62ブラウザー試験が成功。
Docker Desktop起動後、デプロイ用イメージをビルドし、UID 1000でstatus 200/未認証401/認証catalog 200を確認した。
.envの同梱はなし。再現可能な `npm run smoke:container` を追加した。

Codexのread-onlyコマンドsandboxは名前空間作成権限不足で失敗し、試験は終了コード1を返す。
capability追加やsandbox無効化は行わない。ツール無効のSDK生成正常系とは別試験で、そちらはAPI残高ゼロのため未確認。
詳細は[DEPLOYMENT.md](DEPLOYMENT.md)。専用projectを.firebasercへ固定。課金接続・実配備は未完了。

コンテナ内で実際のserver/index.jsをPORT=18080で起動し、SIGTERM正常終了も確認。npm run check（123件＋ビルド）成功。smoke:containerはAPI試験成功、sandbox試験失敗を区別して全体を終了コード1とする。

## 2026-09-21 Jevの助言接続（#14 / #15）

- [x] 撮影/位置/Codexとは別の送信同意。丸めたdx/dy/tracked以外は送信せず、サーバーも未知項目を拒否
- [x] 最大2Hz・同時1件、実行ごと60件、1秒期限、失敗時2秒backoff・3回で助言停止
- [x] 中断を無視する通信も完了まで所有、実行/目標変更・古い応答を破棄
- [x] 現在の幾何方向と一致するコメントだけ表示。保持・capture・停止判定をAIへ委譲しない
- [x] 仮想時計の14単体試験と5fixture画面試験を追加。セルフレビューで同意再選択による回数リセットを防止
- [ ] Jev実トークン取得、ライブ遅延・失敗率・実人体の確認

仕様と未確認事項は[JEV.md](JEV.md)。依存追加なし、既存lockfileを維持。

検証: npm run check（137件＋本番ビルド）成功。追加Jev画面5件がWindows/Edgeで成功。smoke:jevはnot_configuredを返し、実API成功とは扱わない。


## 2026-09-21 Vertex AIクラウド経路と星APIライブ確認（#33 / #34）

- [x] Cloud Runサービスアカウント/ADCでVertex AIのGeminiへ接続するproviderを実装。個人のCodexログインは配備しない
- [x] プロバイダー明示選択、Google/OpenAI別の送信同意、ヘッダーで送信先を固定、出典をクライアントでも照合
- [x] 星順序のみ変更、共通の決定論的検証、40秒・2試行・1024出力token、応答量/usage制限
- [x] google-auth-library 11.1.0固定、インストール済み型と一次資料を確認、lockfile更新
- [x] 星APIの必須日時/空errors配列を修正し、実アプリ経由のライブスモークで31星座取得
- [x] 非root/read-only/通信なしコンテナの実APIサーバー起動・SIGTERMと、Vertex ADC未設定時の明示失敗
- [x] 専用project向けCloud Run定義・秘密/IAM・非公開配備手順を作成
- [ ] 課金接続・aiplatform API有効化・Cloud Run実配備・Vertex生成正常系

npm run checkは155試験＋本番ビルド成功。画面試験でAI未使用時まで接続再確認で配置を消す回帰を発見し、同意済みAI計画だけを破棄するよう修正。修正後の画面検証とCI結果はPRへ記録する。

実Vertex要求はADC認証後にHTTP403。専用projectはbillingEnabled=false、aiplatform APIも未有効。モデル利用可能性・正常生成は未確認。接続済み操作連携の検索ではCloud Run/Firebaseを操作できるものがなく、AGENTS.mdに従いCLI配備は確認待ち。

星APIの日時は明示JST送信へ変更したが、提供側のタイムゾーンは未確認。fixtures/合成身体の試験とライブ疎通・実人体の試験は混同しない。Jev実トークン、実カメラ、Firebase Auth/App Check/利用者別上限、公開デプロイは残る。

## 2026-09-21 公開認証と非公開クラウド実API試験（#17 / #19）

- [x] CLI配備・課金接続の確認に対し、利用者から「デプロイまでして完成させて全部任せる」と委任を受けた
- [x] 専用projectのみ課金接続、Firebase/Firestore/App Check/Secret Manager/専用SAを準備。個人の秘密鍵を配備しない
- [x] Firebase ID tokenの失効・招待claim・projectとApp CheckのappIdを確認。Cloud Runで開発認証を拒否
- [x] Firestoreの利用者/全体日次上限・全revision共通lease・緊急停止。クライアント全拒否ルールを配備
- [x] 非公開Cloud Runへ配備。未認証403、IAM通過後のアプリ未認証401、招待利用者catalog 200
- [x] 実Cloud Runから星をみるひとAPIで31星座、Vertex gemini-3.5-flashで実生成成功（1試行、751 tokens）
- [x] 実Firebaseログイン・実App Check token検証・実Firestore競合制限。管理者署名tokenの試験で、ブラウザーreCAPTCHAとは別
- [x] npm run check 163件＋ビルド、既存Edge 71件、追加ログイン2件＋観測回帰8件が成功
- [x] セルフレビューでApp Check SDKの返値appIdと再ログイン時の既存体験停止を修正。uuid間接依存も修正しaudit 0件
- [ ] Hosting公開、公開ブラウザーの実reCAPTCHA・星API正常系、CI/PRマージ
- [ ] 実カメラ・実人体受入、API側timezone、Jev実トークン（任意助言）

認証と運用手順は[AUTH.md](AUTH.md)。Firebase SDKをlockfileに固定。今回の公開経路はVertexで、Codex sandboxの未解決を成功扱いにしない。

公開追試: Firebase Hosting配備が完了。公開URL経由の星API31星座/Vertex生成、通常EdgeのFirebaseログイン/実reCAPTCHA Enterprise/App Check/星API32星座/ログアウト時消去が成功した。
ブラウザーで発見したCSPの交換ホスト不足を修正し、許可ホストと無関係な外部通信拒否の回帰試験を追加。
npm run check 163件＋ビルド、ログイン関連3件が成功。署名試験用の一時IAM権限は削除済み。PR #36で最終CIとレビュー記録を確認してマージする。

CI run 35588993248（コードhead e8bd591）で163単体＋ビルド＋74画面試験が成功。Cloud Run revision hcr-api-00002-dpzと公開Hostingを確認。
運用試験でFirestore緊急停止503/復帰200を確認。旧Hosting tag欠落を発見して復元し、旧versionへの実ロールバック/最新versionへの復帰と認証付きcatalog 200を確認した。更新手順をservices updateによるtag維持へ修正。最終差分はこの運用記録と配備定義コメントのみで、製品コード変更はない。
