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

## カメラとCIの確認（2026-09-20 / PR #22）

- Windows / Node 24.12.0 / Edge 153.0.4234.32 / Playwright 1.63.0で、単体48件＋ビルドとブラウザー17件が成功。
- [Linux CI](https://github.com/furukawa1020/hosininaruhito/actions/runs/35456831800)でもNode 22 / Chromium 153.0.8010.12（Playwright build 1243）で同じ48件＋ビルド＋17件が成功。
- [browser-screenshots成果物](https://github.com/furukawa1020/hosininaruhito/actions/runs/35456831800/artifacts/10588603015)を取得し、カメラ2枚と観測画面3枚のPNGのみであることを確認。保持7日。
- Windowsの内蔵仮想動画は途中終了が再現したため、入力をコードで生成するYUVファイルへ固定。アプリの切断時停止は維持。
- Windows向け固定版Chromiumの取得は接続タイムアウト。ローカルは既存Edge、固定版ChromiumはLinux CIで検証した。
- 画像を保存するのは試験ハーネスのみ。実行中のアプリに録画・映像保存機能はない。
- 実カメラの許可表示・機器解放は未確認。#9は手動確認待ち。
- 実APIスモークは未設定によりLIVE SKY NOT RUN・終了コード1。送信とfixtureによる代用は行っていない。

## ローカル身体推定の確認（2026-09-20 / PR #23）

- npm run check：62件＋本番ビルド成功。Edge 153.0.4234.32でブラウザー27件成功。
- [Linux CI](https://github.com/furukawa1020/hosininaruhito/actions/runs/35494900076)でも62件＋ビルド＋27件成功。
- 固定SDK 1.0.1と同梱モデルの実推論で、合成画像/合成カメラの人物不在を検出。モデル404も正常に失敗表示する。
- 実SDK起動・推論中の通信先は同一オリジンのみ。モデル・WASMの配布と外部送信制限を確認。
- 正常な左右手首、遮蔽・複数人等は合成座標による契約/画面試験。実人体の検出精度を示すものではない。
- PC・スマートフォン幅の手首表示を目視確認。CI成果物browser-screenshots（ID 10599663895）を生成。
- 実カメラ・実人体の左右、遮蔽、処理遅延は未確認。#9/#10の実機確認と#15の振付セッション統合が残る。
- 星APIのライブ疎通とデプロイは未実施。

## 動かせる範囲の計測（2026-09-20）

- npm run check：74件＋本番ビルド成功。Edgeで全35ブラウザー試験成功。
- 追加分は単体12件、合成カメラ/合成手首座標によるブラウザー8件。
- 正常系：左/右の選択、座位/立位、明示的な計測と確定、やり直し、形と星IDを保持する縮小・平行移動。
- 異常系：短い/狭い/直線状の記録、古い/重複/逆行した計測、不正値、追跡ロスト、映像寸法、容量制限、未観測点、星の重なり、境界の丸め誤差。
- 停止、同意撤回、非表示、姿勢/手の変更時にSVG上の点とメモリの記録を消去し、自動復元しない。
- PCとスマートフォンの画面を目視確認。スマートフォンの計測操作中もプレビューと常設停止が見えることを試験。
- 実カメラ・参加者の操作や負担は未確認。恒星の投影と実振付セッションへの接続・配置結果の画面表示は未実装。
- 外部API・依存パッケージは変更せず、lockfileを維持。星APIライブ疎通・デプロイは未実施。

- 追加のモバイルUI単独実行で、合成カメラの新しいフレーム通知が届かず150ms監視による停止を確認。
  UI契約試験では合成座標に加えてフレーム通知をテスト専用タイマーへ固定した。製品の停止条件は変更していない。
  実カメラ通知を使う合成映像/実SDK試験は従来のcamera.spec.js / pose.spec.jsで別途維持する。
