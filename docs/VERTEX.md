# クラウドでのAI振付計画

Cloud RunのサービスアカウントからVertex AIのGeminiへHTTPSで接続する。
利用者の端末にはCodex CLIやOpenAIキーは不要。個人のChatGPT認証ファイルも配備しない。
Google Cloud以外では、Google Auth LibraryのADC / Workload Identity Federationで認証できる構成。
2026-09-21、専用Cloud Run上でgemini-3.5-flashの実生成に成功。合成3目標による契約確認で、実人体の試験とは別。

## 設定

```text
HCR_PLANNER_PROVIDER=vertex
VERTEX_PROJECT_ID=hosininaruhito-20260920
VERTEX_LOCATION=global
VERTEX_MODEL=<利用可能なGeminiモデルID>
```

モデルの既定値や自動切替は設けない。公式の構造化出力例はgemini-3.5-flashを掲載しているが、
実配備時の対象プロジェクトで利用可能か確認して指定する。globalはデータの地域固定を保証しない。
Cloud Runには専用サービスアカウント `hcr-runtime@hosininaruhito-20260920.iam.gserviceaccount.com` を付与し、
同プロジェクトで `roles/aiplatform.user`、利用する秘密ごとにSecret Accessorを付ける。
サービスアカウントの秘密鍵をファイルにして配備する必要はない。

`HCR_PLANNER_PROVIDER=codex` は従来のSDK経路。省略時も互換性のためcodex。
不明な値やVertexの設定不備からCodexへフォールバックしない。
ステータスのconfiguredは設定形式の確認だけで、ADC・課金・モデル利用権・実疎通の成功ではない。

## 契約と認証

- 認証済みの `POST /api/program` に `X-HCR-Planner: vertex` と `{program}` を送る。
- ステータスで判明した送信先を画面に表示し、Googleへの送信同意を個別に得る。
- 接続の再確認・送信先変更は同意を解除し、保留中の計画を破棄する。
- サーバーとヘッダーの送信先が異なる場合は409。旧画面のOpenAI向け同意でGoogleへ送らない。
- AIへ渡すのは星IDと配置目標xyだけ。カメラ映像・現在位置・実測手首は渡さない。
- responseMimeType + responseSchemaを指定。追加ツール・コード実行・検索は要求しない。
- 1候補、maxOutputTokens=1024、全体40秒、最大2回。生成HTTPの自動再試行はしない。
- 認証待ちも全体期限・停止対象。ADCの更新処理自体が残っても、遅れて生成を開始しない。
- HTTP応答は1MiB、提案JSONは4KiB。STOP以外・ツール応答・欠損usageを拒否する。
- totalTokenCountから思考分も含めてusageを集計し、12,000超で打ち切る。
  これは請求額のハード上限ではない。プロジェクト側quota、公開利用者別制限は別途必要（#17）。
- 星の順序以外は元の配置から再構成。保持・関節・座標・誤差を変更できない。
- 出典はvertex-live。クライアントでも同意したプロバイダー・元の制約・距離を照合する。

共通の合成保持シミュレーションは身体の安全・到達を保証しない。
毎フレームの停止やcaptureは引き続き端末内の実測値で決定する。

## 非公開配備の準備

`deploy/cloudrun.vertex.yaml` はサービス定義。IMAGE_DIGESTとVERTEX_MODELを確定して使う。
専用project以外には適用しない。maxScale=1、concurrency=1、timeout=50秒、CPU=1、512MiB。
公開invoker権限は追加しない。既存サービスへ再適用するときはIAMも別途検査する。
HOSHIMIRU_API_TOKENをSecret Managerの指定バージョンから注入する。公開認証はFirebase ID token + App Checkで、HCR_ACCESS_TOKENは配備しない。[設定](AUTH.md)。
ブラウザーのHosting公開はFirebase Auth/App Check/利用者別制限の確認後。

適用順序は、専用projectの課金接続 → 必要API有効化（aiplatform/run/artifactregistry/cloudbuild/secretmanager）
→ 専用SAと限定IAM → Secret Manager登録 → イメージビルドとdigest固定 → サービス定義適用
→ IAMで非公開を照合 → 認証付き実API試験。秘密を引数や出力へ出さない。

接続済みのCloud Run/Firebase操作連携を検索したが利用できるものは見つからなかった。
CLIへの切替・課金接続について利用者の委任を受け、専用projectだけで配備を実施した。

## 検証

- `npm run check`：実HTTP/ADCをstubに置換した契約試験と本番ビルド。
- `npm run test:browser`：合成映像・API fixtureで送信同意・出典・古い応答を確認。
- `docker build --tag hcr-api:verification .` → `npm run smoke:container -- --vertex`：
  非root、read-only filesystem、通信なしの実サーバー起動・終了と、ADC未設定時の失敗。
  Vertexの実生成成功を示す試験ではない。Codex sandbox試験は従来コマンドで別に維持する。
- `npm run smoke:ai`：選択したプロバイダーへ合成3目標を送るライブ試験。通常CIでは呼ばない。

## 一次資料

- [ADCとCloud Run等の認証](https://github.com/googleapis/google-auth-library-nodejs)
- [構造化出力の対応スキーマ](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)
- [生成応答・usageの定義](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse)

google-auth-library 11.1.0のインストール済み型・getAccessToken実装を照合し、lockfileへ固定。
