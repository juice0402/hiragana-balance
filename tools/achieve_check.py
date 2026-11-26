# ひらがなバランスの実績の確かめ（にせの APP_ACHIEVE で呼ばれた id を記録）
#   node tools/build.mjs のあと：python3 tools/achieve_check.py "$PWD/index.html" <スクショの場所>（Playwright・chromium）
import sys, json, time
from playwright.sync_api import sync_playwright
URL = 'file://' + sys.argv[1]
INIT = """
window.__calls = [];
window.APP_PLATFORM = 'web-test';
window.APP_ACHIEVE = function(id){ __calls.push(['ach', id]); };
window.APP_SCORE = function(n){ __calls.push(['score', n]); };
window.APP_RANKING = function(){ __calls.push(['rank']); };
window.APP_SHARE = function(){ __calls.push(['share']); };
window.APP_GAMECENTER = true;
"""
fails = []
def check(name, cond):
    print(('ok   ' if cond else 'FAIL ') + name)
    if not cond: fails.append(name)
def achs(page): return [c[1] for c in page.evaluate('__calls') if c[0] == 'ach']

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) 開いたとき：前からの最高記録・遊んだ回数の分を取り、取ってある実績と最高記録を送る
    ctx = b.new_context(viewport={'width': 390, 'height': 760})
    ctx.add_init_script("""
if (!sessionStorage.getItem('seeded')) {
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('hiraganaTowerBattle.highScore', '12');
  localStorage.setItem('hiraganaTowerBattle.playCount', '49');
  localStorage.setItem('hiraganaTowerBattle.achieve', JSON.stringify({got: ['hiragana_share'], total: 99, kana: ''}));
}
""" + INIT)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(800)
    a = achs(page)
    check('open: score_5/score_10/plays_10 を取る', all(x in a for x in ['hiragana_score_5', 'hiragana_score_10', 'hiragana_plays_10']))
    check('open: 前に取った share を送りなおす', 'hiragana_share' in a)
    check('open: score_20・plays_50・total_100 はまだ', not any(x in a for x in ['hiragana_score_20', 'hiragana_plays_50', 'hiragana_total_100']))
    check('open: 最高記録 12 を APP_SCORE', ['score', 12] in page.evaluate('__calls'))
    # 2) app-gamecenter で全部送りなおす
    page.evaluate("__calls = []; window.dispatchEvent(new Event('app-gamecenter'))")
    a = achs(page)
    check('app-gamecenter: 取ってある4つを送りなおす', sorted(set(a)) == sorted(['hiragana_score_5', 'hiragana_score_10', 'hiragana_plays_10', 'hiragana_share']))
    # 3) 文字を1つ積む → 合計100文字
    page.click('#startBtn'); page.wait_for_timeout(600)
    page.evaluate("__calls = []")
    box = page.locator('#gameCanvas').bounding_box()
    cx = box['x'] + box['width'] / 2
    page.mouse.click(cx, box['y'] + 120)
    for _ in range(40):
        page.wait_for_timeout(250)
        if page.locator('#scoreVal').inner_text() != '0': break
    check('積んだ：スコアが1', page.locator('#scoreVal').inner_text() == '1')
    check('積んだ：total_100 を APP_ACHIEVE', 'hiragana_total_100' in achs(page))
    st = json.loads(page.evaluate("localStorage.getItem('hiraganaTowerBattle.achieve')"))
    check('積んだ：セーブに合計100と字1つ', st['total'] == 100 and len(st['kana']) == 1 and 'hiragana_total_100' in st['got'])
    # 4) 机の外に落としてゲームオーバー → 遊んだ回数50
    page.mouse.click(box['x'] + 8, box['y'] + 120)
    page.wait_for_selector('#overOverlay:not(.hidden)', timeout=15000)
    check('ゲームオーバー：plays_50', 'hiragana_plays_50' in achs(page))
    check('ゲームオーバー：APP_SCORE はこの回のスコア', ['score', 1] in page.evaluate('__calls'))
    # 5) ランキング・シェアのボタン
    page.click('#rankBtn'); page.click('#shareBtn')
    a = achs(page)
    check('ボタン：ranking と share', 'hiragana_ranking' in a and 'hiragana_share' in a)
    check('ページのエラーなし', not errs)
    page.screenshot(path=sys.argv[2])
    ctx.close()
    # 6) APP_* がないページ（ブラウザ・itch.io）でもエラーなし
    ctx = b.new_context(viewport={'width': 390, 'height': 760})
    page = ctx.new_page(); errs2 = []
    page.on('pageerror', lambda e: errs2.append(str(e)))
    page.goto(URL); page.wait_for_timeout(500); page.click('#startBtn'); page.wait_for_timeout(600)
    box = page.locator('#gameCanvas').bounding_box()
    page.mouse.click(box['x'] + box['width'] / 2, box['y'] + 120)
    page.wait_for_timeout(8000)
    check('APP_* なし：エラーなし・数えて覚える', not errs2 and json.loads(page.evaluate("localStorage.getItem('hiraganaTowerBattle.achieve') || '{}'")).get('total', 0) >= 1)
    b.close()
print('FAILS', len(fails))
