# API仕様の確認記録

## 2026-09-20: 星をみるひとAPI

一次資料：
- [公式ドキュメント](https://hoshimiru.apidog.io/)
- [星座一覧](https://hoshimiru.apidog.io/星座一覧を取得-32979472e0)
- [ドキュメント一覧](https://hoshimiru.apidog.io/llms.txt)

公開ドキュメントの取得内容で確認できたもの：

- GET https://app.livlog.xyz/hoshimiru/constellation
- Authorization: Bearer token
- クエリ例に lat / lng / date / hour / min / id / disp
- 星座ID一覧は1〜88
- 応答例に results、errors、metadata.status、id、jpName、directionNum、altitudeNum、drowing
- 説明等の任意項目に enName、season、roughly、content、origin

未確認：

- dateの受理書式、日時省略時の基準・タイムゾーン
- drowingが参照するカタログのID体系と、区切りや線分の構文
- カタログ・線分・提供画像等の再配布条件
- トークンの実使用時の応答、エラー形式、利用上限

HTML取得結果ではクエリの詳細スキーマを読めず、公開Markdownリンクも取得できなかったため、日時仕様を確定済みとは扱わない。
現在はlat/lngだけを送信し、対応していない日時等のフィールドは400で拒否する。
drowingは不透明な文字列として保持し、恒星座標や線分に変換しない。画像URLも表示・再配布しない。
空配列は正常な0件として扱う。形式不正・重複ID・範囲外角度・過大応答は502。

## Jev / Codex

- [Jev Quick start](https://docs.typesafe.ai/introduction/quickstart)でsystemoneのPOST、Bearer認証、Choiceの応答形式を確認。
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)とインストール済み0.155.1の型定義でThreadOptions・TurnOptions.signalを確認。
- Hono Node adapter 1.19.17の実装で、クライアント切断時にRequest.signalをabortすることを確認。
- クライアントの中断を外部呼出へ伝播する。中断は課金取消しを保証しない。
- Codexのread-only sandboxは維持。Cloud Run相当環境での実行検証は未完了。

## 検証の区分

- 単体・サーバー試験：30件成功。通信はテスト内のstubであり外部APIは呼ばない。
- ブラウザー試験：Edge headlessで8件成功。未設定表示は実ローカルサーバー、正常応答等はfixture。
- 非表示時停止のブラウザー試験ではvisibilitychangeを模擬。実際のタブ切替の手動確認とは区別する。
- npm run check：成功。
- ライブスモーク：星APIトークン未設定のため未実行。終了コード1でNOT RUNを確認。
- デプロイ：未実施。

ローカル実行環境ではサンドボックス起動時にACLエラーが発生したため、明示的な権限確認を経てシェル処理を実行。
ブラウザー連携は2回起動クラッシュし、Playwright + インストール済みEdgeへ切り替えて試験した。
これらは作品内Codex sandboxの実行成功を示すものではない。
