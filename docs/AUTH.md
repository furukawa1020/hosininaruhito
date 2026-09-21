# 公開環境の認証・利用上限

Cloud Runは `HCR_AUTH_MODE=firebase` を必須とする。開発共有トークンへの切替は拒否する。
Firebase Authenticationのメール/パスワードと、reCAPTCHA EnterpriseによるApp Checkを使用する。
管理者が `hcrAccess: true` のcustom claimを付けた利用者、または明示的に許可したゲストがAPIを利用できる。
ゲストはFirebaseの署名済みID tokenに `firebase.sign_in_provider=anonymous` がある場合だけ許可する。
本番設定 `HCR_GUEST_ENABLED=true` が必要。省略/false時はゲストを拒否する。未招待のメールアカウントやcustom tokenをゲストと扱わない。

ID tokenの署名/期限/失効/無効化に加え、project、issuer、招待claimを検証する。
App Checkは署名/期限と対象appIdを確認する。失敗は401、設定不足は503で、秘密やSDK例外は返さない。
アカウントのID tokenとパスワードは永続ストレージに保存しない。ゲストの認証だけはFirebase SDKのsessionStorageでタブ内に保持する。App CheckはSDKが端末内へ保存する場合がある。
Googleへの認証・不正利用対策の通信はログイン操作後に開始する。撮影・位置送信・振付AIの同意は独立。
ログインの変更/ログアウト時は体験を停止し、古い応答を破棄する。

## ゲストの体験

「ゲストとしてはじめる」で実App Checkを確認した後、Firebase匿名認証を実行する。
メール・パスワード・共有キーの入力は不要。全て既存のAPI/画面/AI/計測/captureへ接続し、ゲスト用fixtureや機能削減は設けない。
未設定の任意Jevはアカウント利用時と同様に無効。
タブを再読み込みして再び開始ボタンを押すと同じ匿名UIDを再利用する。カメラ・観測・AIの同意と身体データは復元しない。
終了操作でSDKの認証を解除し、sessionStorageから消去する。タブを閉じてもセッションは消える。Firebase側の匿名アカウントは30日経過後の自動削除を有効化する。
開始待ちの停止/Esc/非表示/取消では遅い認証結果も破棄する。SDKのログアウトが終わる前に次の認証を始めない。

上限はアカウントと同じUID別・全体別の値。別タブ・終了後の再作成は別UIDになるため「同一人物」の識別ではないが、全体上限は新しいUIDでもリセットしない。
ゲストだけ止める場合はCloud Runの `HCR_GUEST_ENABLED=false`、全員を止める場合は下記Firestoreスイッチを使う。
Firebaseの匿名provider設定は専用projectの `signIn.anonymous.enabled=true`。`autodeleteAnonymousUsers=true` も設定する。

一次資料: [匿名認証](https://firebase.google.com/docs/auth/web/anonymous-auth)、[タブ内の認証保持](https://firebase.google.com/docs/auth/web/auth-state-persistence)。インストール済み12.19.0のsignInAnonymouslyのUID再利用・browserSessionPersistence・authStateReadyを照合した。

## 永続的な制限

Firestoreのトランザクションで、UTC日付ごとの利用者別/全体の回数を同時に加算する。
失敗した外部API呼出も回数を消費する。インスタンスやrevisionの変更でリセットしない。

| 操作 | 利用者/日 | 全体/日 |
| --- | ---: | ---: |
| 星API | 50 | 200 |
| AI振付 | 10 | 50 |
| Jev助言 | 300 | 1500 |
| 投影 | 100 | 500 |
| カタログ | 100 | 500 |

60秒の共通leaseで複数revision間も同時1件に制限する。古い所有者は新しいleaseを削除できない。
Cloud Runはtimeout 50秒、AI処理は40秒で終了する。quota障害時には外部APIを呼ばない。
これはAPI回数の上限であり、Google Cloud全サービスの請求額のハード上限ではない。

緊急停止はFirestoreの `hcrControl/runtime` の `enabled` をfalseにする。
文書がない場合も停止。再開は管理者がtrueに戻す。全日次カウントを消して再開しない。
環境変数 `HCR_API_ENABLED=false` でも停止できる。
Firestoreのクライアントルールは全拒否。専用サービスアカウントのIAMだけでアクセスする。
保存するのはUIDのSHA-256、日付、操作別回数、lease所有ID/期限のみ。座標・トークン・映像を記録しない。

## 管理・設定

専用project: `hosininaruhito-20260920`。
Cloud Runには `FIREBASE_PROJECT_ID` / `FIREBASE_APP_ID` / `FIREBASE_WEB_API_KEY` / `RECAPTCHA_SITE_KEY` を設定する。
web API keyとsite keyはブラウザーへ返す公開設定で、星APIの秘密キーとは別物。
星APIキーはSecret Manager `hoshimiru-api-token` からサーバーだけへ注入する。
本番に `HCR_ACCESS_TOKEN` やサービスアカウント秘密鍵を配備しない。

所有者のログイン情報はGit管理外のローカル `.env` の `HCR_OWNER_EMAIL` / `HCR_OWNER_PASSWORD` に用意する。
チャット・Issue・リポジトリへ値を書かない。追加利用者はFirebase Adminで作成し、招待claimを付与する。
利用停止はユーザーのdisableとrefresh tokenのrevokeを行う。APIは毎回失効状態を確認する。

## 検証

単体試験はトークン失効・他project/app・未招待・未設定・quota競合/日付境界/障害/緊急停止を確認する。
画面のSDK fixture試験はログイン・認証ヘッダー・失敗・ログアウト後の破棄を確認する。
2026-09-21、実Firebaseログイン/実App Check検証/実Firestoreの競合予約と後片付けが成功。
このサーバー側試験のApp Check tokenは管理者署名で発行し、ブラウザーのreCAPTCHA成功とは区別する。
続いて公開HostingのEdgeで、実reCAPTCHA Enterpriseによるログイン・App Check・星API32星座・ログアウト時消去が成功した。
debug tokenやfixtureは使っていない。CSPの実交換先不足を修正し、違反/ブラウザー例外0を確認した。
サーバー試験のための期限付きIAM署名権限は試験後に削除した。
通常CIは実APIを呼ばない。

firebase 12.19.0 / firebase-admin 14.4.0を固定。
間接依存gaxios 6.7.1のuuidを11.1.1へ固定し、旧版の脆弱性を除去した。
呼出は互換なv4のみであることを実装で照合。npm auditは0件。

一次資料: [ID token](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、
[App Check](https://firebase.google.com/docs/app-check/custom-resource-backend)、
[reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)、
[トランザクション](https://firebase.google.com/docs/firestore/manage-data/transactions)。
