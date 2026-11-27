(function(){
'use strict';

// ---- Matter.js module aliases ----
var Engine = Matter.Engine, World = Matter.World, Bodies = Matter.Bodies,
    Body = Matter.Body, Composite = Matter.Composite, Events = Matter.Events,
    Vector = Matter.Vector, Sleeping = Matter.Sleeping, Vertices = Matter.Vertices;

if (typeof decomp !== 'undefined') { Matter.Common.setDecomp(decomp); }

// ---- canvas / responsive sizing (mirrors the original game's layout) ----
var canvas = document.getElementById('gameCanvas');
var ctx = canvas.getContext('2d');
var BASE_DPR = Math.min(window.devicePixelRatio || 1, 2);
var ZOOM = 1;            // > 1 only in the iOS app on a wide screen (iPad): the whole stage is scaled up with a CSS transform
var DPR = BASE_DPR;      // canvas pixels per CSS px (times ZOOM so the enlarged canvas stays sharp)
// iOS アプリで画面が広いとき（iPad）だけ、ゲームを画面いっぱいまで大きくする。ブラウザ・iPhone は 1
var FULL = false, SAFE_TOP = 0, SAFE_BOTTOM = 0;
if (window.APP_PLATFORM === 'ios') {
  document.documentElement.classList.add('ios');
  // let the page reach under the notch and the home bar, then keep the HUD and the desk out of them
  var vpMeta = document.querySelector('meta[name="viewport"]');
  if (vpMeta && vpMeta.content.indexOf('viewport-fit') < 0) vpMeta.content += ', viewport-fit=cover';
}
function readSafeArea(){
  var probe = document.getElementById('safeProbe');
  if (!probe) {
    probe = document.createElement('div'); probe.id = 'safeProbe';
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
  }
  var cs = getComputedStyle(probe);
  SAFE_TOP = parseFloat(cs.paddingTop) || 0; SAFE_BOTTOM = parseFloat(cs.paddingBottom) || 0;
  document.documentElement.style.setProperty('--sat', SAFE_TOP + 'px');
  document.documentElement.style.setProperty('--sab', SAFE_BOTTOM + 'px');
}
function appZoom(vw, vh){
  if (window.APP_PLATFORM !== 'ios') return 1;
  var z = Math.min(vw / 424, vh / 644);
  return z > 1.15 ? Math.floor(Math.min(z, 2.5) * 20) / 20 : 1;
}

// ---- skin: only when the page is opened with ?skin=<name> (used by the asobi-talk game center).
// Pictures live next to the game file (skins/<name>/); without a skin everything is drawn in code ----
var SKIN_ART = {};
(function loadSkin(){
  // the iOS app passes the skin in window.APP_SKIN = { name, cfg } (its pages are files, where fetch does not work)
  var appSkin = window.APP_SKIN && /^[a-z0-9-]{1,24}$/.test(window.APP_SKIN.name || '') ? window.APP_SKIN : null;
  var m = appSkin ? [0, appSkin.name] : /[?&]skin=([a-z0-9-]{1,24})(?:&|$)/.exec(location.search || '');
  if (!m || (!appSkin && !window.fetch)) return;
  var base = 'skins/' + m[1] + '/', root = document.documentElement;
  root.classList.add('skin-pending');
  var done = function(){ root.classList.remove('skin-pending'); };
  setTimeout(done, 2500);
  var getCfg = appSkin && appSkin.cfg ? Promise.resolve(appSkin.cfg)
    : fetch(base + 'skin.json').then(function(r){ return r.ok ? r.json() : null; });
  getCfg.then(function(cfg){
    if (!cfg) { done(); return; }
    root.classList.add('skin', 'skin-' + m[1]);
    document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    if (cfg.css) {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = base + cfg.css; link.onload = link.onerror = done;
      document.head.appendChild(link);
    } else done();
    ['desk', 'ruler'].forEach(function(k){
      if (!cfg[k] || !cfg[k].src) return;
      var img = new Image();
      img.onload = function(){ var o = {}; for (var p in cfg[k]) o[p] = cfg[k][p]; o.img = img; SKIN_ART[k] = o; };
      img.src = base + cfg[k].src;
    });
  }).catch(done);
})();

var W, H, groundY, platformW, platformCX, platformLeft, platformRight, VOID_Y;
var platformBody = null; // declared early so layout() can sync it on resize, once it exists
var pieces = []; // { body, ch, r } — declared early so layout() can shift settled pieces on resize
var currentPiece = null; // { ch, x, y, angle } — declared early so layout() can shift it on resize

function layout(){
  var vv = window.visualViewport;
  var vw = vv ? vv.width : window.innerWidth, vh = vv ? vv.height : window.innerHeight;
  ZOOM = appZoom(vw, vh);
  DPR = BASE_DPR * ZOOM;
  FULL = window.APP_PLATFORM === 'ios' && ZOOM === 1;   // the iOS app on a phone: the game fills the screen
  var rootEl = document.documentElement;
  rootEl.classList.toggle('full', FULL);
  if (FULL) readSafeArea();
  var wrapEl = document.getElementById('stage-wrap');
  if (ZOOM !== 1) { wrapEl.style.setProperty('--z', ZOOM); wrapEl.classList.add('zoomed'); }
  else { wrapEl.style.removeProperty('--z'); wrapEl.classList.remove('zoomed'); }
  var availW = vw / ZOOM - 24;
  var availH = vh / ZOOM - 24;
  var newW = FULL ? Math.round(vw) : Math.max(260, Math.min(400, Math.round(availW)));
  var newH = FULL ? Math.max(340, Math.round(vh)) : Math.max(340, Math.min(620, Math.round(availH))); // lowered ceiling from 760: a tall canvas in a shorter preview pane was very likely the cause of "the floor seems to be way down / off-screen"
  var prevGroundY = groundY, prevPlatformCX = platformCX;

  W = newW; H = newH;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  groundY = H - 46 - (FULL ? SAFE_BOTTOM : 0);
  platformW = 128;
  platformCX = W / 2;
  platformLeft = platformCX - platformW / 2;
  platformRight = platformCX + platformW / 2;
  VOID_Y = H + 120;

  if (platformBody) {
    var dx = platformCX - prevPlatformCX, dy = groundY - prevGroundY;
    if (dx !== 0 || dy !== 0) {
      Body.setPosition(platformBody, { x: platformCX, y: groundY + 14 });
      for (var i = 0; i < pieces.length; i++) {
        Body.translate(pieces[i].body, { x: dx, y: dy });
      }
      if (currentPiece) { currentPiece.x += dx; currentPiece.y += dy; }
    }
  }
}
layout();
window.addEventListener('resize', layout);
if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);

// ---- KANA order (must match char_data_embed.js index order) ----
// ---- languages: picked from the saved choice, ?lang=, the app (window.HB_LANGS) or the browser ----
var LANG_KEY = 'hiraganaTowerBattle.lang';
var LANGS = [
  ['en', 'English'], ['ja', '日本語'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ko', '한국어'],
  ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
  ['ru', 'Русский'], ['id', 'Bahasa Indonesia'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['th', 'ไทย']
];
var I18N = {
  en: { doc:'Hiragana Balance', title:'Hiragana Balance', kicker:'ひらがなバランス', tagline:'Drop the letters and stack them high!', start:'Start',
        score:'SCORE', next:'NEXT', settings:'Settings', best:'Best', sound:'Sound', soundToggle:'Sound on/off', credits:'Credits', view:'View', language:'Language',
        rotCW:'Rotate clockwise', rotCCW:'Rotate counterclockwise',
        crTitle:'Credits', crLetters:'Letter shapes', crUi:'Interface font', crPhysics:'Physics engine', oflNote:' (full text below)', close:'Close',
        overTitle:'Oops, it toppled!', overSub:'Letters stacked', bestLine:'Best: {n}', again:'Play again',
        ranking:'Ranking', share:'Share', shareText:'I stacked {n} letters in Hiragana Balance!' },
  ja: { doc:'ひらがなバランス', title:'ひらがなバランス', kicker:'', tagline:'もじを おとして たかく つみあげよう！', start:'はじめる',
        score:'スコア', next:'つぎ', settings:'せってい', best:'さいこうきろく', sound:'おと', soundToggle:'おとのオンオフ', credits:'クレジット', view:'みる', language:'ことば',
        rotCW:'とけいまわりにまわす', rotCCW:'はんとけいまわりにまわす',
        crTitle:'クレジット', crLetters:'もじの かたち', crUi:'がめんの もじ', crPhysics:'ぶつり エンジン', oflNote:'(ぜんぶん は した)', close:'とじる',
        overTitle:'くずれちゃった！', overSub:'つみあげた もじ', bestLine:'さいこうきろく {n}', again:'もういちど あそぶ',
        ranking:'ランキング', share:'シェア', shareText:'ひらがなバランスで {n}もじ つんだよ！' },
  'zh-CN': { tagline:'让文字落下，堆得高高的！', start:'开始', score:'得分', next:'下一个', settings:'设置', best:'最高纪录', sound:'声音', soundToggle:'声音开关',
        credits:'制作信息', view:'查看', language:'语言', rotCW:'顺时针旋转', rotCCW:'逆时针旋转',
        crTitle:'制作信息', crLetters:'文字字形', crUi:'界面字体', crPhysics:'物理引擎', oflNote:'（全文见下方）', close:'关闭',
        overTitle:'哎呀，倒了！', overSub:'堆起的文字', bestLine:'最高纪录：{n}', again:'再玩一次',
        ranking:'排行榜', share:'分享', shareText:'我在 Hiragana Balance 里堆了 {n} 个字！' },
  'zh-TW': { tagline:'讓文字落下，堆得高高的！', start:'開始', score:'分數', next:'下一個', settings:'設定', best:'最高紀錄', sound:'聲音', soundToggle:'聲音開關',
        credits:'製作資訊', view:'查看', language:'語言', rotCW:'順時針旋轉', rotCCW:'逆時針旋轉',
        crTitle:'製作資訊', crLetters:'文字字形', crUi:'介面字體', crPhysics:'物理引擎', oflNote:'（全文見下方）', close:'關閉',
        overTitle:'哎呀，倒了！', overSub:'堆起的文字', bestLine:'最高紀錄：{n}', again:'再玩一次',
        ranking:'排行榜', share:'分享', shareText:'我在 Hiragana Balance 裡疊了 {n} 個字！' },
  ko: { tagline:'글자를 떨어뜨려 높이 쌓아 보세요!', start:'시작', score:'점수', next:'다음', settings:'설정', best:'최고 기록', sound:'소리', soundToggle:'소리 켜기/끄기',
        credits:'크레딧', view:'보기', language:'언어', rotCW:'시계 방향으로 회전', rotCCW:'시계 반대 방향으로 회전',
        crTitle:'크레딧', crLetters:'글자 모양', crUi:'화면 글꼴', crPhysics:'물리 엔진', oflNote:' (전문은 아래에)', close:'닫기',
        overTitle:'앗, 무너졌어요!', overSub:'쌓은 글자', bestLine:'최고 기록: {n}', again:'다시 하기',
        ranking:'랭킹', share:'공유', shareText:'Hiragana Balance에서 글자를 {n}개 쌓았어요!' },
  es: { tagline:'¡Suelta las letras y apílalas bien alto!', start:'Empezar', score:'PUNTOS', next:'SIGUIENTE', settings:'Ajustes', best:'Récord', sound:'Sonido', soundToggle:'Activar/desactivar sonido',
        credits:'Créditos', view:'Ver', language:'Idioma', rotCW:'Girar en sentido horario', rotCCW:'Girar en sentido antihorario',
        crTitle:'Créditos', crLetters:'Forma de las letras', crUi:'Fuente de la interfaz', crPhysics:'Motor de física', oflNote:' (texto completo abajo)', close:'Cerrar',
        overTitle:'¡Uy, se derrumbó!', overSub:'Letras apiladas', bestLine:'Récord: {n}', again:'Jugar otra vez',
        ranking:'Ranking', share:'Compartir', shareText:'¡Apilé {n} letras en Hiragana Balance!' },
  pt: { tagline:'Solte as letras e empilhe bem alto!', start:'Começar', score:'PONTOS', next:'PRÓXIMA', settings:'Configurações', best:'Recorde', sound:'Som', soundToggle:'Ligar/desligar som',
        credits:'Créditos', view:'Ver', language:'Idioma', rotCW:'Girar no sentido horário', rotCCW:'Girar no sentido anti-horário',
        crTitle:'Créditos', crLetters:'Formato das letras', crUi:'Fonte da interface', crPhysics:'Motor de física', oflNote:' (texto completo abaixo)', close:'Fechar',
        overTitle:'Ops, desabou!', overSub:'Letras empilhadas', bestLine:'Recorde: {n}', again:'Jogar de novo',
        ranking:'Ranking', share:'Compartilhar', shareText:'Empilhei {n} letras no Hiragana Balance!' },
  fr: { tagline:'Lâchez les lettres et empilez-les le plus haut possible !', start:'Jouer', score:'SCORE', next:'SUIVANTE', settings:'Paramètres', best:'Record', sound:'Son', soundToggle:'Activer/désactiver le son',
        credits:'Crédits', view:'Voir', language:'Langue', rotCW:'Tourner dans le sens horaire', rotCCW:'Tourner dans le sens antihoraire',
        crTitle:'Crédits', crLetters:'Forme des lettres', crUi:'Police de l’interface', crPhysics:'Moteur physique', oflNote:' (texte intégral ci-dessous)', close:'Fermer',
        overTitle:'Oups, tout s’est effondré !', overSub:'Lettres empilées', bestLine:'Record : {n}', again:'Rejouer',
        ranking:'Classement', share:'Partager', shareText:'J’ai empilé {n} lettres dans Hiragana Balance !' },
  de: { tagline:'Lass die Buchstaben fallen und staple sie ganz hoch!', start:'Spielen', score:'PUNKTE', next:'NÄCHSTER', settings:'Einstellungen', best:'Rekord', sound:'Ton', soundToggle:'Ton an/aus',
        credits:'Credits', view:'Ansehen', language:'Sprache', rotCW:'Im Uhrzeigersinn drehen', rotCCW:'Gegen den Uhrzeigersinn drehen',
        crTitle:'Credits', crLetters:'Buchstabenformen', crUi:'Schrift der Oberfläche', crPhysics:'Physik-Engine', oflNote:' (vollständiger Text unten)', close:'Schließen',
        overTitle:'Hoppla, umgefallen!', overSub:'Gestapelte Buchstaben', bestLine:'Rekord: {n}', again:'Nochmal spielen',
        ranking:'Rangliste', share:'Teilen', shareText:'Ich habe {n} Buchstaben in Hiragana Balance gestapelt!' },
  it: { tagline:'Lascia cadere le lettere e impilale più in alto che puoi!', start:'Inizia', score:'PUNTI', next:'PROSSIMA', settings:'Impostazioni', best:'Record', sound:'Suono', soundToggle:'Attiva/disattiva suono',
        credits:'Crediti', view:'Vedi', language:'Lingua', rotCW:'Ruota in senso orario', rotCCW:'Ruota in senso antiorario',
        crTitle:'Crediti', crLetters:'Forma delle lettere', crUi:'Font dell’interfaccia', crPhysics:'Motore fisico', oflNote:' (testo completo qui sotto)', close:'Chiudi',
        overTitle:'Ops, è crollata!', overSub:'Lettere impilate', bestLine:'Record: {n}', again:'Gioca ancora',
        ranking:'Classifica', share:'Condividi', shareText:'Ho impilato {n} lettere in Hiragana Balance!' },
  ru: { tagline:'Роняй буквы и строй башню повыше!', start:'Играть', score:'ОЧКИ', next:'ДАЛЕЕ', settings:'Настройки', best:'Рекорд', sound:'Звук', soundToggle:'Включить/выключить звук',
        credits:'Авторы', view:'Открыть', language:'Язык', rotCW:'Повернуть по часовой стрелке', rotCCW:'Повернуть против часовой стрелки',
        crTitle:'Авторы', crLetters:'Форма букв', crUi:'Шрифт интерфейса', crPhysics:'Физический движок', oflNote:' (полный текст ниже)', close:'Закрыть',
        overTitle:'Ой, всё рухнуло!', overSub:'Букв в башне', bestLine:'Рекорд: {n}', again:'Ещё раз',
        ranking:'Рейтинг', share:'Поделиться', shareText:'Букв в моей башне в Hiragana Balance: {n}!' },
  id: { tagline:'Jatuhkan hurufnya dan tumpuk setinggi mungkin!', start:'Mulai', score:'SKOR', next:'BERIKUTNYA', settings:'Pengaturan', best:'Rekor', sound:'Suara', soundToggle:'Nyalakan/matikan suara',
        credits:'Kredit', view:'Lihat', language:'Bahasa', rotCW:'Putar searah jarum jam', rotCCW:'Putar berlawanan arah jarum jam',
        crTitle:'Kredit', crLetters:'Bentuk huruf', crUi:'Font antarmuka', crPhysics:'Mesin fisika', oflNote:' (teks lengkap di bawah)', close:'Tutup',
        overTitle:'Yah, roboh!', overSub:'Huruf yang ditumpuk', bestLine:'Rekor: {n}', again:'Main lagi',
        ranking:'Peringkat', share:'Bagikan', shareText:'Aku menumpuk {n} huruf di Hiragana Balance!' },
  tr: { tagline:'Harfleri bırak, olabildiğince yükseğe yığ!', start:'Başla', score:'SKOR', next:'SIRADAKİ', settings:'Ayarlar', best:'Rekor', sound:'Ses', soundToggle:'Sesi aç/kapat',
        credits:'Emeği geçenler', view:'Gör', language:'Dil', rotCW:'Saat yönünde döndür', rotCCW:'Saat yönünün tersine döndür',
        crTitle:'Emeği geçenler', crLetters:'Harf şekilleri', crUi:'Arayüz yazı tipi', crPhysics:'Fizik motoru', oflNote:' (tam metin aşağıda)', close:'Kapat',
        overTitle:'Eyvah, yıkıldı!', overSub:'Yığılan harf', bestLine:'Rekor: {n}', again:'Tekrar oyna',
        ranking:'Sıralama', share:'Paylaş', shareText:'Hiragana Balance’ta {n} harf yığdım!' },
  vi: { tagline:'Thả chữ xuống và xếp thật cao nào!', start:'Bắt đầu', score:'ĐIỂM', next:'TIẾP THEO', settings:'Cài đặt', best:'Kỷ lục', sound:'Âm thanh', soundToggle:'Bật/tắt âm thanh',
        credits:'Ghi công', view:'Xem', language:'Ngôn ngữ', rotCW:'Xoay theo chiều kim đồng hồ', rotCCW:'Xoay ngược chiều kim đồng hồ',
        crTitle:'Ghi công', crLetters:'Hình dạng chữ', crUi:'Phông chữ giao diện', crPhysics:'Công cụ vật lý', oflNote:' (toàn văn bên dưới)', close:'Đóng',
        overTitle:'Ối, đổ mất rồi!', overSub:'Số chữ đã xếp', bestLine:'Kỷ lục: {n}', again:'Chơi lại',
        ranking:'Xếp hạng', share:'Chia sẻ', shareText:'Mình đã xếp được {n} chữ trong Hiragana Balance!' },
  th: { tagline:'ปล่อยตัวอักษรลงมา แล้วซ้อนให้สูงที่สุด!', start:'เริ่ม', score:'คะแนน', next:'ถัดไป', settings:'การตั้งค่า', best:'สถิติสูงสุด', sound:'เสียง', soundToggle:'เปิด/ปิดเสียง',
        credits:'เครดิต', view:'ดู', language:'ภาษา', rotCW:'หมุนตามเข็มนาฬิกา', rotCCW:'หมุนทวนเข็มนาฬิกา',
        crTitle:'เครดิต', crLetters:'รูปร่างตัวอักษร', crUi:'ฟอนต์หน้าจอ', crPhysics:'เอนจินฟิสิกส์', oflNote:' (ข้อความเต็มอยู่ด้านล่าง)', close:'ปิด',
        overTitle:'อุ๊ย พังซะแล้ว!', overSub:'ตัวอักษรที่ซ้อนได้', bestLine:'สถิติสูงสุด: {n}', again:'เล่นอีกครั้ง',
        ranking:'อันดับ', share:'แชร์', shareText:'ฉันซ้อนตัวอักษรได้ {n} ตัวใน Hiragana Balance!' }
};
function langFromTag(tag){
  tag = String(tag || '').toLowerCase().replace(/_/g, '-');
  if (!tag) return null;
  if (tag.indexOf('zh') === 0) return /-(tw|hk|mo|hant)\b/.test(tag) ? 'zh-TW' : 'zh-CN';
  var base = tag.split('-')[0];
  if (base === 'in') base = 'id';
  return I18N[base] ? base : null;
}
function detectLang(){
  var saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* ignore */ }
  if (saved && I18N[saved]) return saved;
  var q = /[?&]lang=([a-zA-Z_-]+)/.exec(location.search);
  if (q && langFromTag(q[1])) return langFromTag(q[1]);
  var list = [].concat(window.HB_LANGS || [], navigator.languages || [], navigator.language || []);
  for (var i = 0; i < list.length; i++) { var l = langFromTag(list[i]); if (l) return l; }
  return 'en';
}
var LANG = detectLang();
function t(key){ var d = I18N[LANG] || I18N.en; return (key in d) ? d[key] : I18N.en[key]; }
function bestLineText(n){ return t('bestLine').replace('{n}', n); }
function applyLang(code){
  LANG = I18N[code] ? code : 'en';
  document.documentElement.lang = LANG;
  document.title = t('doc');
  var txt = { scoreLabel:'score', nextLabel:'next', lblBest:'best', lblSound:'sound', lblCredits:'credits', creditsBtn:'view', lblLang:'language',
              titleText:'title', kickerText:'kicker', tagline:'tagline', startBtn:'start', creditsTitle:'crTitle', crLetters:'crLetters', crUi:'crUi',
              crPhysics:'crPhysics', oflNote:'oflNote', creditsClose:'close', overTitle:'overTitle', overSub:'overSub', retryBtn:'again',
              rankBtn:'ranking', shareBtn:'share' };
  Object.keys(txt).forEach(function(id){ var el = document.getElementById(id); if (el) el.textContent = t(txt[id]); });
  var kick = document.getElementById('kickerText'); if (kick) kick.style.display = t('kicker') ? '' : 'none';
  var aria = { settingsBtn:'settings', 'toggle-switch':'soundToggle', rotateLeftBtn:'rotCW', rotateRightBtn:'rotCCW', langSelect:'language' };
  Object.keys(aria).forEach(function(id){ var el = document.getElementById(id); if (el) el.setAttribute('aria-label', t(aria[id])); });
  var hl = document.getElementById('highScoreLine'); if (hl) hl.textContent = bestLineText(typeof GAME !== 'undefined' ? GAME.highScore : 0);
  var sel = document.getElementById('langSelect'); if (sel) sel.value = LANG;
}
(function(){
  var sel = document.getElementById('langSelect');
  LANGS.forEach(function(l){ var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1]; sel.appendChild(o); });
  sel.addEventListener('change', function(){
    try { localStorage.setItem(LANG_KEY, sel.value); } catch (e) { /* ignore */ }
    applyLang(sel.value);
  });
  applyLang(LANG);
})();
var KANA = CHAR_DATA.map(function(d){ return d.ch; });
var ROMAJI = {}; // Hepburn reading shown under the held letter (を = wo so it differs from お)
('a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ' +
 'ma mi mu me mo ya yu yo ra ri ru re ro wa wo n').split(' ').forEach(function(r, i){ ROMAJI['あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'[i]] = r; });

