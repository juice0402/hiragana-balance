// src/ の中身をつないで、遊ぶ人が開く index.html を作る（Node の標準だけ）
//   node tools/build.mjs          … index.html を作る
//   node tools/build.mjs --check  … いまの index.html とビルドしたものが1バイトも違わないか確かめる（違えば終了コード1）
// つなぎ方：src/shell.html の「@@include <src からの場所>@@」だけの行を、そのファイルの中身にそのまま入れかえる。
// 中身は1文字も変えない（改行も足さない）。つなぐ順は src/shell.html の上から（docs/MAP.md）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'index.html');

export function build() {
  const shell = readFileSync(join(SRC, 'shell.html'));
  const parts = [];
  let used = 0;
  // 行ごとに見る（改行コードはそのまま残す）
  let start = 0;
  while (start < shell.length) {
    let end = shell.indexOf(0x0a, start);
    end = end === -1 ? shell.length : end + 1;
    const line = shell.subarray(start, end);
    const m = /^@@include ([^@\n]+)@@\n$/.exec(line.toString('utf8'));
    if (m) {
      const file = join(SRC, m[1]);
      if (!existsSync(file)) throw new Error('src にないファイル：' + m[1]);
      parts.push(readFileSync(file));
      used++;
    } else {
      parts.push(line);
    }
    start = end;
  }
  if (!used) throw new Error('src/shell.html に @@include の行がない');
  return Buffer.concat(parts);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = build();
  if (process.argv.includes('--check')) {
    const now = existsSync(OUT) ? readFileSync(OUT) : Buffer.alloc(0);
    if (!now.equals(out)) {
      console.error('index.html が src とずれている。node tools/build.mjs で作りなおす（index.html は手で直さない）');
      process.exit(1);
    }
    console.log('index.html は src から作ったものと同じ（' + out.length + ' バイト）');
  } else {
    writeFileSync(OUT, out);
    console.log('index.html を作った（' + out.length + ' バイト）');
  }
}
