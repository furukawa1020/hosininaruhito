# コンテナ・デプロイ確認

配備先はユーザーの作成指示に基づく専用project `hosininaruhito-20260920`（766405647874）のみ。
`.firebaserc` のdefaultもこのprojectに固定する。課金接続・Firebase初期化・非公開Cloud Run配備が完了。
2026-09-21の配備環境で星API31星座取得、Vertex実生成、未認証拒否を確認した。
公開環境の認証・利用上限・緊急停止は[AUTH.md](AUTH.md)。以下のsandbox履歴はCodex経路の記録。

クラウドの振付AIはVertex AI / ADCを選べる。Codex CLIのインストール・個人ログインを要求しない。
非公開Cloud Run用サービス定義を `deploy/cloudrun.vertex.yaml` に用意した。[設定と適用順序](VERTEX.md)。
Vertex経路ではコマンドsandboxを使用しない。従来Codex sandboxの失敗を成功に読み替えるものではない。

## 再現手順

```text
docker build --tag hcr-api:verification .
npm run smoke:container
```

この試験は実APIキーを渡さず、実映像や観測地点も使わない。
root以外のUID 1000、読み取り専用root filesystem、書込み可能な一時/tmp、ネットワークなし、
512MiB/1CPU/128PID以内で実行する。コンテナ名は呼出ごとのUUIDで、終了・タイムアウト時にそのコンテナだけを削除する。

1. 実際のsrc/server/index.jsをPORT=18080で起動し、status 200、未認証catalog 401、試験用認証でcatalog 200を照合。
2. SIGTERMで正常終了することと、イメージ内に.envがないことを確認。
3. インストール済みCodex CLIのread-only sandboxで読取りと/tmpへの書込み拒否を試す。

外側のコンテナでは/tmpは書込み可能なので、3番はroot filesystemのread-onlyだけでは成功しない。
外向き通信は外側のnetwork=noneで停止している。これをCodex自身のネットワーク隔離確認とは扱わない。

## 2026-09-21の結果

Docker Desktopを起動し、既存Dockerfileからイメージのビルドが成功。
API試験はUID 1000、status=200、unauthorized=401、catalog=200、secretFile=false、SIGTERM正常終了で成功。
Codexのコマンドsandbox試験は `namespace_unavailable` で失敗。
bwrapが非特権の名前空間を作れないためで、capability追加・privileged化・sandbox無効化は行わない。

これはローカルDockerでの再現結果。Cloud Runの実環境検証ではない。
ツールを無効化したSDKの生成正常系も、OpenAI API残高ゼロにより未確認。
APIサーバー起動成功だけを作品全体やデプロイ成功とは扱わない。

## 配備前の残条件

- #3: 星API実トークン設定・ライブ観測は2026-09-21に成功。配備先Secret Managerへの登録が残る
- #13/#14: Codex生成正常系・厳密な費用上限、Jevトークンと統合・実測
- #16: 選択するAI経路のCloud Run実環境試験（Codex選択時はread-only sandboxも必要）
- #17: Firebase Auth/App Check/ユーザー別上限
- #20: 個別同意のもとで実カメラ・実人体を確認

Cloud Runの初回は非公開、hcr-api/asia-east1、max instances=1、concurrency=1、timeout=50秒を予定。
秘密はSecret Manager、サービス専用SAに必要な秘密だけの参照権限を付ける。
公開Hosting rewriteは認証・利用上限を確認してから有効化する。

接続済みFirebase/Cloud Runの操作連携は見つかっていない。
CLI配備と課金接続の確認に対して、利用者から「デプロイまでして完成させて全部任せる」と委任を受けて配備を実施。
フルアクセスへの環境変更は、この配備経路の選択や課金接続の完了とは区別する。
