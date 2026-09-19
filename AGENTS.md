# 星にされる人 / Human Constellation Runtime

一人の身体の関節を時間方向に蓄積して星座を構成する作品。
Hono + Vite + vanilla Three.js。Next.js/Reactは使わない。
Firebase Hosting + Google Cloud Run。操作は接続済み連携を優先し、使えない場合はユーザーへ確認。CLIでの認証・デプロイへ勝手に切り替えない。

## Work loop
README.mdとdocs/PLAN.mdを読む。範囲を宣言し、小さな縦切り→テスト→検証→進捗更新。
既存差分を保護。API変更前に一次資料・インストール済みSDK型を確認。
実APIが標準。fixturesはテストのみ。未設定・失敗をモック成功で隠さない。

## Boundaries
- core: 決定論的な純粋ロジック。DOM・ネットワーク・SDK禁止。
- providers: 外部API、タイムアウト、応答検証。秘密はサーバーのみ。
- server: 認証、入力サイズ制限、同時実行制限。
- client: センサー、描画、即時停止。映像は原則ローカル推論。
- Codex: 遅い振付計画。Jev: 低頻度の助言。毎フレームはローカル幾何制御。
- 開発用Codexと作品内Codexハーネスを区別。

## Invariants
AI確率で到達・安全・captureを判定しない。計測誤差と保持時間で確定する。
追跡ロスト・古い応答・非表示タブは停止。常設停止ボタンとEscを用意。
無理な姿勢・走行・閉眼歩行を誘導しない。撮影と外部送信は個別同意。
画面座標と世界座標を混同しない。GPSでcm精度を主張しない。
星座代表方位から各恒星位置を捏造しない。生成コードのevalは禁止。
トークン・位置情報・映像をログへ記録しない。有料APIを認証なしで公開しない。

## Completion gate
npm run check。変更点の正常系・異常系テスト。ライブ試験とfixture試験を区別。
未実装・未実API確認・未デプロイを明記。lockfileとdocs/PLAN.mdを更新。
指定されたGCPプロジェクト以外にはデプロイしない。sandbox失敗を権限緩和で隠さない。
