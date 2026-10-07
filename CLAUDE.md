# 開発メモ（ひらがなバランス）

このリポジトリを編集するときの前提と、これまでに決まったことのまとめ。

## 基本
- ゲームは `index.html` 1 枚で完結（Matter.js・文字データ・BGM をすべて埋め込み）。外部読み込みは Google Fonts の Klee One だけ。
- `index.html` はリリース版（デバッグ用フック・計測コードは削除済み）。変更はこのファイルに直接入れる。
- 個人情報（本名・住所・電話番号・生年月日・メールアドレスなど）はリポジトリに絶対に入れない。
- `main` の `index.html` が更新されると、GitHub Actions（`.github/workflows/itch-deploy.yml`）が itch.io に自動でアップロードする（Secrets の `BUTLER_API_KEY` が必要）。つまり **main に push = 世界に公開**。作業は別ブランチで進め、プレビューでユーザーの OK をもらってから main に入れる。
- iOS（`hiragana-balance.html` にリネームして同梱）は自動では更新されないので、変更したらユーザーに伝える。

## ファイル内の構成（index.html）
- `<script>` 1 つ目: Matter.js 0.20.0（minified）。2 つ目: poly-decomp。
- `var CHAR_DATA = [...]`: 文字ごとのアウトライン（描画用 path）と当たり判定用ポリゴン（数値の平坦配列、実行時にデコード）。
- 末尾の `<script>`: BGM の data URI（`BGM_DATA_URI`）。ゲーム本体より後に読み込まれる。

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

## 保存データ
- 最高記録の localStorage キーは `hiraganaTowerBattle.highScore`、ミュートは `hiraganaTowerBattle.muted`。旧名のままだが、既存プレイヤーの記録が消えるので変更しないこと。

## UI のテーマ
- 画面の文字は英語（2026-10 に英語化）。スタート画面のタイトル下にだけ小さく「ひらがなバランス」。持っている文字の下にヘボン式ローマ字の読み（を = wo）を表示し、つかんでいる間とゲームオーバー中は消す。
- 「手書き・文房具・紙」: 方眼紙の背景、手書き風の二重枠、マスキングテープ風カード、透明な定規（置ける高さの上限ライン）、学校の机の台。
- 回転ボタンは文字の左右にバナナ型の括弧矢印（左 = 時計回り、右 = 反時計回り）。文字を持っている間は非表示。
