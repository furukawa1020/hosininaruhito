# 公開環境の認証・利用上限

Cloud Runは `HCR_AUTH_MODE=firebase` を必須とする。開発共有トークンへの切替は拒否する。
Firebase Authenticationのメール/パスワードと、reCAPTCHA EnterpriseによるApp Checkを使用する。
管理者が `hcrAccess: true` のcustom claimを付けた利用者だけがAPIを利用できる。
自己作成したアカウントだけでは有料APIを呼べない。

ID tokenの署名/期限/失効/無効化に加え、project、issuer、招待claimを検証する。
App Checkは署名/期限と対象appIdを確認する。失敗は401、設定不足は503で、秘密やSDK例外は返さない。
ID tokenとパスワードはブラウザーの永続ストレージに保存しない。App CheckはSDKが端末内へ保存する場合がある。
Googleへの認証・不正利用対策の通信はログイン操作後に開始する。撮影・位置送信・振付AIの同意は独立。
ログインの変更/ログアウト時は体験を停止し、古い応答を破棄する。

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
