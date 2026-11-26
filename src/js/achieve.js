// ---- 実績（Game Center）：iOS アプリが入れる window.APP_ACHIEVE があるときだけ送る（ブラウザ・itch.io・あそびトークでは数えて覚えるだけ） ----
// id と条件は docs/kobo/gamecenter.json と同じ。id は一度アプリに出したら変えない・消して使い回さない
var ACHIEVE_KEY = 'hiraganaTowerBattle.achieve'; // { got: [id…], total: 積んだ文字の合計, kana: 積んだことのある文字 }
var ACHIEVE_LIST = [
  { id: 'hiragana_score_5',   score: 5 },
  { id: 'hiragana_score_10',  score: 10 },
  { id: 'hiragana_score_20',  score: 20 },
  { id: 'hiragana_score_30',  score: 30 },
  { id: 'hiragana_score_50',  score: 50 },
  { id: 'hiragana_total_100',  total: 100 },
  { id: 'hiragana_total_500',  total: 500 },
  { id: 'hiragana_total_1000', total: 1000 },
  { id: 'hiragana_all_kana',  allKana: true },
  { id: 'hiragana_plays_10',  plays: 10 },
  { id: 'hiragana_plays_50',  plays: 50 },
  { id: 'hiragana_plays_100', plays: 100 },
  { id: 'hiragana_share',     on: 'share' },
  { id: 'hiragana_ranking',   on: 'ranking' }
];
function loadAchieve(){
  var s = null;
  try { s = JSON.parse(localStorage.getItem(ACHIEVE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') s = {};
  return {
    got: Array.isArray(s.got) ? s.got.filter(function(id){ return typeof id === 'string'; }) : [],
    total: Math.max(0, parseInt(s.total, 10) || 0),
    kana: typeof s.kana === 'string' ? s.kana : ''
  };
}
var ACH = loadAchieve();
function saveAchieve(){
  try { localStorage.setItem(ACHIEVE_KEY, JSON.stringify(ACH)); } catch (e) { /* ignore */ }
}
function sendAchieve(id){
  try { if (typeof window.APP_ACHIEVE === 'function') window.APP_ACHIEVE(id); } catch (e) { /* ignore */ }
}
function unlockAchieve(id){
  if (ACH.got.indexOf(id) === -1) { ACH.got.push(id); saveAchieve(); }
  sendAchieve(id); // 何回送ってもよい（Game Center が1回だけ数える）
}
function readPlayCount(){
  try { return parseInt(localStorage.getItem(PLAY_COUNT_KEY), 10) || 0; } catch (e) { return 0; }
}
// いまの数で取れる実績を全部取る（score はこの回のスコア。開いたときは最高記録）
function checkAchieve(score, plays){
  ACHIEVE_LIST.forEach(function(a){
    var ok = (a.score && score >= a.score) || (a.total && ACH.total >= a.total) ||
             (a.allKana && KANA.every(function(ch){ return ACH.kana.indexOf(ch) !== -1; })) ||
             (a.plays && plays >= a.plays);
    if (ok && ACH.got.indexOf(a.id) === -1) unlockAchieve(a.id);
  });
}
// 文字が1つ落ち着いたとき（スコアが1ふえたとき）
function achieveOnSettle(ch){
  ACH.total += 1;
  if (ch && ACH.kana.indexOf(ch) === -1) ACH.kana += ch;
  saveAchieve();
  checkAchieve(GAME.score, 0);
}
function achieveOnGameOver(plays){ checkAchieve(GAME.score, plays); }
// 開いたときと Game Center にサインインしたとき：取ってある実績と最高記録を全部送りなおす（あとからサインインした人の分も入るように）
function resendGameCenter(){
  checkAchieve(GAME.highScore, readPlayCount()); // 前から遊んでいる人の最高記録・遊んだ回数の分も取る
  ACH.got.forEach(sendAchieve);
  if (GAME.highScore > 0) { try { if (typeof window.APP_SCORE === 'function') window.APP_SCORE(GAME.highScore | 0); } catch (e) { /* ignore */ } }
}
resendGameCenter();
window.addEventListener('app-gamecenter', resendGameCenter);
