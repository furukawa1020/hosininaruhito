# AIによる順序計画

クラウド用にVertex AIの経路を追加した。[ADC認証・設定・配備準備](VERTEX.md)を参照。
以下のSDK隔離の説明はCodex選択時に適用する。両経路で順序検証・保持条件は共通。
API呼出には同意した送信先の `X-HCR-Planner: codex` または `vertex` が必要。

配置済みProgramV1を `POST /api/program {program}` に渡し、Codexは星IDの順序だけを構造化JSONで提案する。
既存の `{constellation}` 入力も互換経路として受け付ける。両方の同時指定・未知のトップレベル項目は拒否する。

## 契約と制限

- 画像内目標座標・使う手・保持時間・許容誤差・星IDは元のProgramから再構成し、AIの値で上書きしない。
- 順序の全単射、元より長くない画像内移動距離、HumanRuntimeの合成保持試験を通過した場合だけ採用する。
- 合成試験はプロトコルの整合確認であり、身体の到達・安全・実際のcaptureの証明ではない。
- 最大2回、全体40秒。応答4KiB、ストリームのアプリ側受信イベント128件/64KiB。
- 各ターン終了時のinput/output usage合計が12,000を超えたら拒否し、次の計画を行わない。
  **これは観測済みusageの打切り条件で、生成中の厳密なトークン上限・請求上限ではない。**
  SDK内部のHTTP再試行回数もアプリの2回とは別。提供者側の支出制限と公開前のユーザー別quotaは未完了。
- JSON不正・重複/欠損ID・長い経路は固定のcriticで一度だけ再計画。上流障害・未設定・中断はそのまま失敗し、カタログ順への自動切替はしない。

## 隔離

インストール済み `@openai/codex-sdk 0.155.1` の型・実装と公式資料を確認した。
各ターンで一時的なCODEX_HOME/作業ディレクトリを作り、終了時に削除する。
子プロセスの環境変数はOS起動に必要なものだけ許可し、SDK経由でOpenAIキーを渡す。
星/Jev/開発アクセストークン、開発用Codex設定、プロジェクト文書は引き継がない。

read-only、approval=never、networkAccessEnabled=false、web search無効、shell tool/snapshot無効。
ツール実行イベントを検出したら失敗として中断する。権限緩和による再試行はしない。
この設定確認・stub試験を、Cloud RunでのOS sandbox検証済みとは扱わない。

## 画面

ステータスの送信先に合わせて「OpenAI / Codex」または「Google Cloud / Vertex AI」を表示し、個別同意があるときだけ呼ぶ。
送信内容は星IDと配置後の画像内目標座標。映像・実測手首・観測地点はAIへ送らない。
ブラウザー→自サーバーには元のProgramの保持条件等も渡し、サーバーがAIへのペイロードを限定する。
配置目標は計測範囲に合わせた値なので、一般カタログそのものと同一ではない。

応答をブラウザーでも元のProgramと照合する。同意撤回・計測変更・停止後の応答は破棄。
準備完了後も本人の開始操作が必要。毎フレームの保持・停止はローカルの決定論的処理で行う。

## 実API確認（2026-09-21）

既存OpenAIキーでモデル一覧の取得は成功。利用一覧にあるgpt-5.6-lunaをローカルCODEX_MODELに設定した。
`npm run smoke:ai` は合成3目標を実Codexへ送信する専用コマンド。
星API・実人体の試験ではなく、通常のnpm run check/CIでは実行しない。
秘密・位置・応答本文は保存/ログ出力せず、成功時は出典/回数/usage/所要時間だけを出す。

実呼出は「You have no credits remaining」のため失敗。アプリはupstream_quotaで明示し、モック成功にしない。
生成正常系、Cloud Run sandbox、実カメラ、星APIライブ、Jevライブ、デプロイは未確認。

## 一次資料

- https://learn.chatgpt.com/docs/codex-sdk
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://learn.chatgpt.com/docs/models
