# 恒星・星座線カタログ

星をみるひとAPIの観測結果に含まれる星座ID（1〜88）を、実在する恒星と星座線へ対応させる。観測結果の代用品ではなく、恒星単位の座標を補うデータである。API未設定・失敗をカタログで成功に変えない。

## 採用した原資料

- [d3-celestial 固定版](https://github.com/ofrohn/d3-celestial/tree/7e720a3de062059d4c5400a379146a601d9010e0)
- [データ定義](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/data/readme.md)
- [READMEのデータ源と座標定義](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/readme.md)
- [BSD-3-Clauseライセンス](https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/LICENSE)
- [星をみるひとAPIの星座ID表](https://hoshimiru.apidog.io/星座一覧を取得-32979472e0)

版はコミット7e720a3de062059d4c5400a379146a601d9010e0に固定。stars.8.jsonのHIP番号、赤経・赤緯・等級と、constellations.lines.jsonの線分を使用する。カタログREADMEの恒星データ出典はXHIP（Anderson & Francis, 2012）。

原データの赤経は度単位の[-180,180]、赤緯は度単位の[-90,90]、赤道座標J2000。赤経のみ[0,360)に正規化する。これらは観測地点の方位・高度でも、画面座標でもない。固有運動の時刻補正は未実装。

## 対応の根拠

公式の星座ID表をIAU略号へ明示対応する。配列の並び順は一致しないため、カタログ配列の番号を流用しない。例：4=Aql、5=Aqr、20=CMa、30=CVn、60=Ori、74=Ser、88=Vul。

原資料の線分端点の赤経・赤緯と、恒星カタログ内の座標が完全一致する場合だけHIP番号へ対応させる。最近傍への丸めや代表方位からの生成は行わない。0件一致・複数一致はいずれも失敗する。6等級までのファイルでは端点が3個欠けるため、全端点を一意に照合できる8等級までのファイルを採用した。

Serpensは原資料でCaput/Caudaの2項目になっている。同じ星座ID 74へまとめるが、独立した線分列を保持し、両部分を結ぶ線を追加しない。他星座の重複は拒否する。

星APIのdrowingはID体系・区切り・ライセンスが未確定のため不透明な文字列のまま保持する。drowingをHIP番号と推定せず、別途出典を確認した星座線を採用する。APIが提供する画像や星座線の複製ではない。

## 再現・配布

data/catalog/sources.jsonに原資料のURL、版、非圧縮サイズ、SHA-256、元期、ライセンス、著者を記録する。stars.8.jsonは内容を変えずgzip圧縮して保存する。ビルドは同梱データのハッシュを確認してpublic/catalog/constellations.jsonを生成し、ネットワーク取得しない。生成物もGitで管理し、テストで再生成結果と照合する。

BSD-3-Clauseの著作権表示、条件、免責条項をpublic/third-party/D3-CELESTIAL-LICENSE.txtに同梱し、NOTICE.txtに出典と変換内容を記載する。Hostingでは両方を配信する。Cloud Runには同じライセンス・NOTICEと生成物を含める。作者による推奨を表示しない。

POST /api/catalog {"id":"60"}は開発Bearer認証後、HIP ID・赤経・赤緯・等級・線分列・元期・単位・版・出典を返す。ファイル欠損、不正データ、版不一致は503で失敗し、fixtureへ切り替えない。

## 検証と残作業

全88星座・全線分端点を原資料の座標とHIP番号へ往復して検証する。欠損・曖昧対応・重複・未知ID・不正値・異なる元期/単位・壊れたファイル・認証なし・過大入力の試験を含む。

投影・身体誘導・画面での星座選択との統合は後続Issue #7/#15。星APIライブ疎通、drowingの解釈、実カメラ、Cloud Runデプロイはこの検証に含まない。
