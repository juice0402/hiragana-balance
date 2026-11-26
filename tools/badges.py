#!/usr/bin/env python3
# Game Center の実績のバッジの絵を描く（コードで描く絵＝game-art-rule の C）
#   python3 tools/badges.py   … docs/kobo/gamecenter.json の実績ごとに docs/kobo/achievements/<id>.png を作る
# 見た目はゲームと同じ：方眼紙・墨のにじみのひらがな1字・赤ペンの花丸。説明の文字は入れない
# 難しさ（points）で赤ペンが変わる：10＝まる・25＝花丸・50＝二重の花丸・100＝花丸に茎と葉
# 1024×1024・RGB（透明なし）。字の形は fonts/YujiSyuku-Regular.ttf（OFL）。乱数は id から決めるので、何度作っても同じ絵
import json, math, random, zlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parent.parent
GC = ROOT / 'docs' / 'kobo' / 'gamecenter.json'
OUT = ROOT / 'docs' / 'kobo' / 'achievements'
FONT = ROOT / 'fonts' / 'YujiSyuku-Regular.ttf'

S = 1024          # できあがりの大きさ
SS = 2            # なめらかにするため、2倍で描いて縮める
PAPER = (255, 250, 241)
GRID = (74, 111, 165)
SUMI = (58, 51, 44)
RED = (210, 67, 58)

# 実績ごとのひらがな1字（46字の中から）
KANA = {
    'hiragana_score_5': 'つ', 'hiragana_score_10': 'は', 'hiragana_score_20': 'た',
    'hiragana_score_30': 'か', 'hiragana_score_50': 'や',
    'hiragana_total_100': 'も', 'hiragana_total_500': 'ち', 'hiragana_total_1000': 'ん',
    'hiragana_all_kana': 'あ',
    'hiragana_plays_10': 'い', 'hiragana_plays_50': 'ろ', 'hiragana_plays_100': 'わ',
    'hiragana_share': 'み', 'hiragana_ranking': 'よ',
}


def noise(rng, n, sigma, W):
    # id から決まる乱数のざらざら（n×n を W×W に広げる）
    im = Image.new('L', (n, n))
    im.putdata([max(0, min(255, int(rng.gauss(128, sigma)))) for _ in range(n * n)])
    return im.resize((W, W), Image.BICUBIC)


def paper(rng):
    W = S * SS
    im = Image.new('RGB', (W, W), PAPER)
    d = ImageDraw.Draw(im, 'RGBA')
    step = 48 * SS
    off = step // 2
    for i in range(-1, W // step + 2):
        p = off + i * step
        a = 46 if i % 4 == 0 else 26   # 4マスごとに少し濃い線
        d.line([(p, 0), (p, W)], fill=GRID + (a,), width=2 * SS)
        d.line([(0, p), (W, p)], fill=GRID + (a,), width=2 * SS)
    # 紙のむら
    nz = noise(rng, 64, 18, W)
    im = ImageChops.multiply(im, Image.merge('RGB', [nz.point(lambda v: 235 + (v - 128) * 0.12)] * 3))
    return im


def ink(im, ch, rng, size=560, dy=0):
    W = S * SS
    font = ImageFont.truetype(str(FONT), int(size * SS))
    mask = Image.new('L', (W, W), 0)
    md = ImageDraw.Draw(mask)
    l, t, r, b = md.textbbox((0, 0), ch, font=font)
    x = (W - (r - l)) / 2 - l + rng.uniform(-10, 10) * SS
    y = (W - (b - t)) / 2 - t + dy * SS + rng.uniform(-10, 10) * SS
    md.text((x, y), ch, fill=255, font=font, stroke_width=int(5 * SS), stroke_fill=255)
    # にじみ：太らせてぼかした薄い墨を下に
    bleed = mask.filter(ImageFilter.MaxFilter(int(9 * SS) | 1)).filter(ImageFilter.GaussianBlur(14 * SS))
    rough = noise(rng, 96, 60, W)
    bleed = ImageChops.multiply(bleed, rough.point(lambda v: min(255, int(v * 0.9))))
    im.paste(Image.new('RGB', (W, W), SUMI), (0, 0), bleed.point(lambda v: int(v * 0.42)))
    # 本体：ふちを少しやわらかく、中にかすれ
    body = mask.filter(ImageFilter.GaussianBlur(1.6 * SS))
    kasure = noise(rng, 48, 30, W).point(lambda v: 225 + max(-45, min(30, (v - 128) // 2)))
    body = ImageChops.multiply(body, kasure)
    im.paste(Image.new('RGB', (W, W), SUMI), (0, 0), body)


def pen(m, pts, w):
    # 赤ペン：太さが少しゆれる線（m は線の形だけを描く白黒の絵。重なっても濃くならない）
    d = ImageDraw.Draw(m)
    for i in range(1, len(pts)):
        ww = w * (0.85 + 0.15 * math.sin(i * 0.05))
        d.line([pts[i - 1], pts[i]], fill=255, width=max(1, int(ww)))
        r = ww / 2
        d.ellipse([pts[i][0] - r, pts[i][1] - r, pts[i][0] + r, pts[i][1] + r], fill=255)


def flower(cx, cy, R, a, k, rng, turns=2.12):
    # ゲームの花丸と同じ式（src/js/physics.js の buildHanamaru）
    pts, start, t = [], -math.pi / 2 - 0.25 + rng.uniform(-0.2, 0.2), 0.0
    while t <= math.pi * turns:
        u = start + t
        pts.append((cx + R * math.cos(u) + a * math.cos(k * u + math.pi * 0.5),
                    cy + R * math.sin(u) + a * math.sin(k * u + math.pi * 0.5)))
        t += 0.004
    return pts


def leaf(x0, y0, x1, y1, bulge):
    # 2点のあいだの葉（両がわにふくらむ形をひと筆で）
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    pts = []
    for i in range(161):
        s = i / 80
        t = s if s <= 1 else 2 - s
        side = 1 if s <= 1 else -1
        h = bulge * math.sin(math.pi * t) * side
        pts.append((x0 + dx * t + nx * h, y0 + dy * t + ny * h))
    return pts


def red_pen(im, points, rng):
    W = S * SS
    m = Image.new('L', (W, W), 0)
    c = W / 2
    w = 22 * SS
    if points <= 10:      # まる
        pen(m, flower(c, c, 400 * SS, 0, 0, rng, 2.08), w)
    elif points <= 25:    # 花丸
        pen(m, flower(c, c, 350 * SS, 82 * SS, 7, rng), w)
    elif points <= 50:    # 二重の花丸
        pen(m, flower(c, c, 330 * SS, 78 * SS, 7, rng), w)
        pen(m, flower(c, c, 468 * SS, 0, 0, rng, 2.06), w * 0.8)
    else:                 # 花丸に茎と葉
        fx, fy, R = c, c - 80 * SS, 300 * SS
        pen(m, flower(fx, fy, R, 0.235 * R, 7, rng), w)
        top = fy + R + 0.235 * R - 10 * SS
        stem = [(fx + 26 * SS * math.sin(t * 2.2), top + t * (W - 40 * SS - top)) for t in [i / 80 for i in range(81)]]
        pen(m, stem, w * 0.9)
        for side, k in ((-1, 30), (1, 52)):
            sx, sy = stem[k]
            pen(m, leaf(sx, sy, sx + side * 190 * SS, sy - 70 * SS, 42 * SS), w * 0.8)
    im.paste(Image.new('RGB', (W, W), RED), (0, 0), m.point(lambda v: int(v * 0.93)))


def badge(a):
    rng = random.Random(zlib.crc32(a['id'].encode()))
    im = paper(rng)
    big = a['points'] > 50  # 茎と葉の花丸は花が小さいので、字も小さく上に
    ink(im, KANA[a['id']], rng, 470 if big else 560, -80 if big else 0)
    red_pen(im, a['points'], rng)
    return im.resize((S, S), Image.LANCZOS).convert('RGB')


def main():
    gc = json.loads(GC.read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    for a in gc['achievements']:
        badge(a).save(OUT / (a['id'] + '.png'), optimize=True, dpi=(72, 72))
        print(a['id'])


if __name__ == '__main__':
    main()
