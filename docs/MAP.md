# 地図（ひらがなバランス）

遊ぶ人が開くのは `index.html`（1ファイルで動く・場所と名前は変えない）。
**index.html は自動で作るファイル。読まない・手で直さない。** 直すのは `src/` で、直したら `node tools/build.mjs`。

## ビルドと確かめ
- `node tools/build.mjs`：`src/shell.html` の「`@@include <場所>@@`」だけの行を、`src/<場所>` の中身にそのまま入れかえて `index.html` を作る（1文字も足さない・変えない）
- `node tools/build.mjs --check`（`npm test`）：いまの `index.html` が src から作ったものと1バイトも違わないか。違えば終了コード1
- 遊んで確かめるのは、手元の `index.html` をブラウザ（Playwright）で開く
- main の `index.html` が変わると itch.io に自動で公開（`.github/workflows/itch-deploy.yml`）

## つなぐ順（src/shell.html の上から）
| 順 | ファイル | 役目 | 行の目安 |
|---|---|---|---|
| 1 | `src/shell.html` | HTML のわく（head・画面の部品・`<script>` のつつみ）。ほかのファイルを入れる場所 | 196 |
| 2 | `src/vendor/matter.min.js` | Matter.js 0.20.0（minified・そのまま。読まない） | 7 |
| 3 | `src/vendor/poly-decomp.min.js` | poly-decomp（minified・そのまま。読まない） | 2 |
| 4 | `src/style.css` | スタイル（方眼紙・カード・ボタン・言語ごとの字体・スキン・iOS の全画面） | 220 |
| 5 | `src/data/char-data.js` | `CHAR_DATA`（文字の形と当たり判定。1行が長いので読まない）と、ポリゴンのデコード | 2 |
| 6 | `src/js/setup.js` | Matter の別名・キャンバスの大きさ（`ZOOM`）・スキン（`?skin=`・`APP_SKIN`）・言語（`I18N`・`KANA`） | 263 |
| 7 | `src/js/glyph.js` | 体の作りおき・墨の絵と影（`glyphSprites`）・アウトライン → 物理のパーツ | 216 |
| 8 | `src/js/physics.js` | 物理エンジン（ソルバー・スリープ・`preSolvePosition` のラッパー）・花丸 | 333 |
| 9 | `src/js/state.js` | ゲームの状態（`PHYS` の数字もここ）・接触と支えの判定・`markInternalEdges`・持っている文字・手番・iOS の `APP_*` | 361 |
| 10 | `src/js/input.js` | 入力（指で狙う・はなして落とす・`swallowTap`）・カメラ・回転ボタン | 178 |
| 11 | `src/js/audio.js` | 効果音・BGM（`bgmCompose`・`bgmRender`） | 331 |
| 12 | `src/js/loop.js` | 設定（最高記録・ミュート）・音のロック解除・メインループ `frame`・描画 `render`（机・定規） | 241 |

- 6〜12 は1つの `<script>` の中の1つの関数（`(function(){ 'use strict'; … })()`）を、節の切れ目で切っただけ。ファイルをまたいで同じ変数を使う
- セーブのキー（`hiraganaTowerBattle.*`）は `src/js/setup.js`・`state.js`・`audio.js` にある。変えない

## そのほか
- `skins/`：スキンの絵と `skin.json`（`?skin=<名前>`）
- `assets/`：アイコン・itch.io の絵
- `fonts/`：文字の形のもと（Yuji Syuku）
- `ios/`：旧版（Swift Playground）。iOS アプリは juice0402/ios-kobo で組み立てる
