# 開発メモ（ひらがなバランス）

このリポジトリを編集するときの前提と、これまでに決まったことのまとめ。

## 基本
- ゲームは `index.html` 1 枚で完結（Matter.js・文字データを埋め込み。BGM はコードで作る）。外部読み込みは Google Fonts の Klee One だけ。
- `index.html` はリリース版（デバッグ用フック・計測コードは削除済み）。変更はこのファイルに直接入れる。
- 個人情報（本名・住所・電話番号・生年月日・メールアドレスなど）はリポジトリに絶対に入れない。
- `main` の `index.html` が更新されると、GitHub Actions（`.github/workflows/itch-deploy.yml`）が itch.io に自動でアップロードする（Secrets の `BUTLER_API_KEY` が必要）。つまり **main に push = 世界に公開**。作業は別ブランチで進め、プレビューでユーザーの OK をもらってから main に入れる。
- iOS 版は juice0402/ios-kobo で組み立てる（`apps/hiragana-balance/app.json` の `game.ref` にこのリポジトリのコミットを書いて Actions を動かす）。自動では更新されないので、変更したらユーザーに伝える。`ios/ContentView.swift` は旧版（Swift Playground）。
- iOS アプリは iPad で画面を拡大するとき `window.APP_ZOOM` を入れる（キャンバスの解像度に掛けている）。

## ファイル内の構成（index.html）
- `<script>` 1 つ目: Matter.js 0.20.0（minified）。2 つ目: poly-decomp。
- `var CHAR_DATA = [...]`: 文字ごとのアウトライン（描画用 path）と当たり判定用ポリゴン（数値の平坦配列、実行時にデコード）。
- BGM はゲームの中で作る（`bgmCompose` が楽譜・`bgmRender` が OfflineAudioContext で1回だけ合成してループ）。音のファイルは持たない（前の曲は出どころが分からず 11/6 に差しかえ）。ニ長調・62 BPM・24 小節

## 物理まわりで決まっていること（安易に変えない）
- 接触ソルバーは Box2D（Erin Catto）流の Gauss-Seidel に差し替え済み: 摩擦を先に解く → 法線。クーロン上限は静止/動摩擦とも `mu * 法線インパルス`。
- 合成ボディの内部エッジ（パーツの継ぎ目）は `markInternalEdges` で印を付け、ゴースト衝突を防ぐ `Collision.collides` の移植版で外側の軸だけを使う。
- 継ぎ目に挟まる問題は `Matter.Resolver.preSolvePosition` のラッパーで解消（`beforeSolve` は衝突検出より前なので使えない）。
- `PHYS`: friction 0.6 / frictionStatic 0.8 / frictionAir 0.15（並進のみ） / restitution 0.05 / slop 0.15。角速度の減衰は別に `ANGULAR_DAMPING = 0.03`。
- 慣性モーメントは `part.inertia / Matter.Body._inertiaScale` で補正済み。
- スリープ判定は Box2D 準拠: `SLEEP_LIN_TOL = 0.01`（px/step）、`SLEEP_ANG_TOL = 2°/60`。
- ゲームオーバー: 文字の上端が机の上面より下（`bounds.min.y > groundY + 2`）に落ちたとき。

## 文字（グリフ）
- 形は Yuji Syuku（`fonts/YujiSyuku-Regular.ttf`、OFL）から fontTools で抽出。曲線の平坦化 4 font units + Douglas-Peucker 8 units。
- 太字化: 片側 0.75px（`GLYPH_BOLD = 0.025`）。当たり判定は太字化したアウトラインをラスタ化 → marching squares でトレースしたもの。
- サイズは大小 2 種類: `PIECE_SIZES = { L: 1.15, S: 0.8 }`。
- 小さすぎる輪郭（面積 2e-3 以下）は除外（「ほ」で NaN が出た対策）。
- 文字を増やす（例: 小 1 漢字 80 字）ときは、同じ手順で CHAR_DATA を作り直す必要がある。生成スクリプトはコンテナのリセットで消えているので作り直しが必要。

## ほかのページへの埋め込み
- iframe の中で遊んでいるときは、ゲームオーバーで `parent.postMessage({ source: 'hiragana-balance', type: 'gameover', score, best }, '*')` を送る。あそびトークのゲームセンター（`juice0402/asobi-talk` の `public/games-static/balance.html`）がこれを受けてメダルを記録する。
- ゲームを直したら、あそびトークの `public/games-static/balance.html` にも同じファイルを入れる（自動ではコピーされない）。
- 逆向き: 同じオリジンの親から `{ source: 'asobi-talk', type: 'medals', n }` が来たら、メダルのチャリーンの音（`sfxMedals`）。画面の演出は親（あそびトークの `public/game/medal-fx.js`）が出す。

## 見た目の演出（全部の版）
- 文字は 1 文字×大きさごとに「墨の絵」と「ぼかした影」を小さな canvas に作って使い回す（`glyphSprites`）。影は全部の文字を先に描いてから本体。
- 落とした文字が最初にふれたとき墨のしずくが飛ぶ（`collisionStart` を見るだけ。物理は変えない）。10 文字ごとにスコアに赤ペンの花丸（`#hanamaru`）。ゲームオーバーは画面がゆれてから 0.65 秒後にカード。

## スキン（あそびトークのゲーム工房だけ）
- `?skin=<名前>` のときだけ、ゲームのファイルと同じ場所の `skins/<名前>/skin.json` を読む（`css`・`desk`（机の絵と天板の位置 `x0`/`x1`/`top`）・`ruler`）。ないときは今までどおりコードで描く。
- Canva の絵はライセンス上、itch.io と iOS のファイルには入れない。絵はあそびトークの `public/games-static/skins/kobo/` に置く（1 枚 48 万ピクセル以下・保存やダウンロードの機能は付けない）。

## 保存データ
- 最高記録の localStorage キーは `hiraganaTowerBattle.highScore`、ミュートは `hiraganaTowerBattle.muted`。旧名のままだが、既存プレイヤーの記録が消えるので変更しないこと。

## UI のテーマ
- 画面の文字は 15 言語（en, ja, zh-CN, zh-TW, ko, es, pt, fr, de, it, ru, id, tr, vi, th）。`I18N` の辞書にあり、足りないキーは英語。言語の決め方は「設定で選んだもの（`hiraganaTowerBattle.lang`）→ URL の `?lang=` → iOS アプリが入れる `window.HB_LANGS` → ブラウザの言語 → 英語」。
- 日本語のときは元の日本語の文（はじめる・くずれちゃった！など）で、タイトル下の小さな「ひらがなバランス」とローマ字の読みは出さない。ほかの言語ではタイトルは「Hiragana Balance」のまま。
- 持っている文字の下にヘボン式ローマ字の読み（を = wo）を表示し、つかんでいる間とゲームオーバー中は消す。
- Klee One にない文字の言語（中国語・韓国語・タイ語・ベトナム語・トルコ語）は、`html[lang]` ごとに端末のフォントを使う。
- 「手書き・文房具・紙」: 方眼紙の背景、手書き風の二重枠、マスキングテープ風カード、透明な定規（置ける高さの上限ライン）、学校の机の台。
- 回転ボタンは文字の左右にバナナ型の括弧矢印（左 = 時計回り、右 = 反時計回り）。文字を持っている間は非表示。
