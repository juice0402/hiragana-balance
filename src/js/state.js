// ---- game state ----
var HIGH_SCORE_KEY = 'hiraganaTowerBattle.highScore';
function loadHighScore(){
  try { return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveHighScore(v){
  try { localStorage.setItem(HIGH_SCORE_KEY, String(v)); } catch (e) { /* ignore */ }
}
// 遊んだ回数（ゲームオーバーの回数）。iOS アプリのレビューのお願いを3回目から出すのに使う
var PLAY_COUNT_KEY = 'hiraganaTowerBattle.playCount';
function bumpPlayCount(){
  var n = 0;
  try { n = parseInt(localStorage.getItem(PLAY_COUNT_KEY), 10) || 0; } catch (e) { n = 0; }
  n += 1;
  try { localStorage.setItem(PLAY_COUNT_KEY, String(n)); } catch (e) { /* ignore */ }
  return n;
}
var GAME = { score: 0, highScore: loadHighScore(), gameOver: false, currentChar: null, nextChar: null };
var pointerDown = false;

function randomChar(){ return KANA[Math.floor(Math.random() * KANA.length)]; }

// ---- resting-contact detection ----
var CONTACT_TOL = 0.8;
function vertexNearPart(v, part, tol){
  var verts = part.vertices, n = verts.length, inside = true, best = Infinity, bn = null;
  var area = 0;
  for (var i = 0; i < n; i++) { var a = verts[i], b = verts[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  var sgn = area > 0 ? 1 : -1;
  for (var i2 = 0; i2 < n; i2++) {
    var p = verts[i2], q = verts[(i2 + 1) % n];
    var ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    var nx = sgn * ey / len, ny = -sgn * ex / len;
    var dist = (v.x - p.x) * nx + (v.y - p.y) * ny; // > 0 outside this edge
    if (dist > tol) return null;
    if (dist > 0) inside = false;
    var t = ((v.x - p.x) * ex + (v.y - p.y) * ey) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var sx = p.x + ex * t - v.x, sy = p.y + ey * t - v.y, d2 = sx * sx + sy * sy;
    if (d2 < best) { best = d2; bn = { x: nx, y: ny }; }
  }
  return bn;
}
function partsNear(a, b, tol){
  return !(a.bounds.min.x > b.bounds.max.x + tol || a.bounds.max.x < b.bounds.min.x - tol ||
           a.bounds.min.y > b.bounds.max.y + tol || a.bounds.max.y < b.bounds.min.y - tol);
}

// ---- static support test ----
var SUPPORT_MU = 0.8; // = the Coulomb bound used in the velocity solver (pair.frictionStatic)
function contactList(body, allBodies){
  var bodyParts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  var out = [], tol = CONTACT_TOL;
  for (var k = 0; k < allBodies.length; k++) {
    var ob = allBodies[k];
    if (ob === body || !partsNear(body, ob, tol)) continue;
    var obParts = ob.parts.length > 1 ? ob.parts.slice(1) : [ob];
    for (var bi = 0; bi < bodyParts.length; bi++) {
      var bp = bodyParts[bi];
      for (var oi = 0; oi < obParts.length; oi++) {
        var op = obParts[oi];
        if (!partsNear(bp, op, tol)) continue;
        for (var vi = 0; vi < bp.vertices.length; vi++) {
          var v = bp.vertices[vi], n1 = vertexNearPart(v, op, tol);
          if (n1) out.push({ x: v.x, y: v.y, nx: n1.x, ny: n1.y });
        }
        for (var wi = 0; wi < op.vertices.length; wi++) {
          var w = op.vertices[wi], n2 = vertexNearPart(w, bp, tol);
          if (n2) out.push({ x: w.x, y: w.y, nx: -n2.x, ny: -n2.y });
        }
      }
    }
  }
  return out;
}
function canHoldStill(body, contacts){
  if (!contacts.length) return false;
  var L = 30, G = [];
  contacts.forEach(function(c){
    var tx = -c.ny, ty = c.nx, rx = (c.x - body.position.x) / L, ry = (c.y - body.position.y) / L;
    [1, -1].forEach(function(sg){
      var fx = c.nx + sg * SUPPORT_MU * tx, fy = c.ny + sg * SUPPORT_MU * ty;
      G.push([fx, fy, rx * fy - ry * fx]);
    });
  });
  var target = [0, -1, 0]; // cancel gravity (screen y points down), no net torque
  var eps = 1e-7;
  for (var i = 0; i < G.length; i++) {
    for (var j = i + 1; j < G.length; j++) {
      var a = G[i], b = G[j];
      var c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      var cl = Math.hypot(c[0], c[1], c[2]);
      if (cl < 1e-9) continue;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        var ok = true;
        for (var k = 0; k < G.length; k++) {
          if (sgn * (c[0] * G[k][0] + c[1] * G[k][1] + c[2] * G[k][2]) < -eps * cl) { ok = false; break; }
        }
        if (ok && sgn * (c[0] * target[0] + c[1] * target[1] + c[2] * target[2]) < -1e-6 * cl) return false;
      }
    }
  }
  return G.length >= 2;
}
function isBodySupported(body, allBodies){
  return canHoldStill(body, contactList(body, allBodies));
}

var SLEEP_LIN_TOL = 0.01;                   // px per step (60 steps/s)
var SLEEP_ANG_TOL = 2 / 180 * Math.PI / 60; // rad per step
function isMoving(b){ return b.speed > SLEEP_LIN_TOL || Math.abs(b.angularVelocity) > SLEEP_ANG_TOL; }
function touchingBodies(body, allBodies){
  var out = [];
  var bodyParts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  for (var k = 0; k < allBodies.length; k++) {
    var ob = allBodies[k];
    if (ob === body || ob.isStatic) continue;
    if (ob.bounds.min.x > body.bounds.max.x + 1 || ob.bounds.max.x < body.bounds.min.x - 1 ||
        ob.bounds.min.y > body.bounds.max.y + 1 || ob.bounds.max.y < body.bounds.min.y - 1) continue;
    var obParts = ob.parts.length > 1 ? ob.parts.slice(1) : [ob];
    var hit = false;
    for (var bi = 0; bi < bodyParts.length && !hit; bi++) {
      for (var oi = 0; oi < obParts.length && !hit; oi++) {
        var bp = bodyParts[bi], op = obParts[oi];
        if (!partsNear(bp, op, CONTACT_TOL)) continue;
        for (var vi = 0; vi < bp.vertices.length; vi++) if (vertexNearPart(bp.vertices[vi], op, CONTACT_TOL)) { hit = true; break; }
        for (var wi = 0; wi < op.vertices.length && !hit; wi++) if (vertexNearPart(op.vertices[wi], bp, CONTACT_TOL)) { hit = true; break; }
      }
    }
    if (hit) out.push(ob);
  }
  return out;
}
function hasMovingNeighbour(body, allBodies){
  var nb = touchingBodies(body, allBodies);
  for (var i = 0; i < nb.length; i++) {
    if (!nb[i].isSleeping && isMoving(nb[i])) return true;
  }
  return false;
}

var PHYS = {
  friction: 0.6,
  frictionStatic: 0.8,
  frictionAir: 0.15,
  restitution: 0.05,
  density: 0.0015,
  sleepThreshold: 40,
  slop: 0.15
};

// ---- internal edges of a compound piece ----
function markInternalEdges(parts){
  var tol = 0.05;
  parts.forEach(function(P, pi){
    var vs = P.vertices, n = vs.length, keys = [], keyInternal = {};
    for (var i = 0; i < n; i++) {
      var a = vs[i], b = vs[(i + 1) % n];
      var nx = b.y - a.y, ny = a.x - b.x, l = Math.hypot(nx, ny);
      if (l === 0) continue;
      nx /= l; ny /= l;
      var key = (ny === 0 ? Infinity : nx / ny).toFixed(3).toString(); // same key as Matter.Axes.fromVertices
      var internal = false;
      for (var qj = 0; qj < parts.length && !internal; qj++) {
        if (qj === pi) continue;
        var ws = parts[qj].vertices;
        for (var k = 0; k < ws.length; k++) {
          var c = ws[k], d = ws[(k + 1) % ws.length];
          if (Math.abs(c.x - b.x) < tol && Math.abs(c.y - b.y) < tol && Math.abs(d.x - a.x) < tol && Math.abs(d.y - a.y) < tol) {
            internal = true;
            (P.__adj || (P.__adj = [])).indexOf(parts[qj]) < 0 && P.__adj.push(parts[qj]);
            break;
          }
        }
      }
      if (!(key in keyInternal)) { keys.push(key); keyInternal[key] = internal; }
      else if (!internal) keyInternal[key] = false;
    }
    P.__axisInternal = keys.length === P.axes.length ? keys.map(function(k){ return keyInternal[k]; }) : null;
  });
}

function makePieceBody(ch, x, y, angle, radius){
  var cache = charCache[ch];
  var r = radius || PIECE_TARGET_R;
  var vertexSets = cache.decomposedParts.map(function(poly){
    return poly.map(function(p){ return { x: p.x * r, y: p.y * r }; });
  });
  var bodyOptions = {
    friction: PHYS.friction,
    frictionStatic: PHYS.frictionStatic,
    frictionAir: PHYS.frictionAir,
    restitution: PHYS.restitution,
    density: PHYS.density,
    sleepThreshold: PHYS.sleepThreshold,
    slop: PHYS.slop
  };
  var body;
  try {
    var partBodies = vertexSets.map(function(verts){
      var opts = { position: Vertices.centre(verts), vertices: verts };
      for (var k in bodyOptions) opts[k] = bodyOptions[k];
      return Body.create(opts);
    });
    markInternalEdges(partBodies);
    if (partBodies.length > 1) {
      var compoundOpts = { parts: partBodies };
      for (var k2 in bodyOptions) compoundOpts[k2] = bodyOptions[k2];
      body = Body.create(compoundOpts);
      Body.setPosition(body, { x: x, y: y });
    } else {
      body = partBodies[0];
      Body.setPosition(body, { x: x, y: y });
    }
  } catch (e) {
    body = null;
  }
  if (!body) {
    body = Bodies.circle(x, y, r * 0.6, { friction: 0.6, restitution: 0.05, density: 0.0015 });
    Body.setPosition(body, { x: x, y: y });
  }
  if (body.parts.length > 1) {
    var totalInertia = 0;
    for (var pi = 1; pi < body.parts.length; pi++) {
      var part = body.parts[pi];
      var dx = part.position.x - body.position.x, dy = part.position.y - body.position.y;
      var ownI = part.inertia / Matter.Body._inertiaScale;
      totalInertia += ownI + part.mass * (dx * dx + dy * dy);
    }
    Body.setInertia(body, totalInertia);
  }
  Body.setAngle(body, angle || 0);
  body.render.fillStyle = '#3a332c';
  Events.on(body, 'sleepStart', function(){
    var allBodies = Composite.allBodies(world);
    if (!isBodySupported(body, allBodies) || hasMovingNeighbour(body, allBodies)) { body.__wakeReason = 'backstop'; Sleeping.set(body, false); }
  });
  return { body: body, ch: ch, r: r };
}

// ---- current (not yet dropped) piece: purely kinematic, follows the
var SPAWN_Y = 60;

function updateNextGlyphDisplay(){
  var box = document.getElementById('nextGlyph'), cv = box.querySelector('canvas');
  if (!cv) { box.textContent = ''; cv = document.createElement('canvas'); box.appendChild(cv); }
  var S = 40; cv.width = S * DPR; cv.height = S * DPR; cv.style.width = S + 'px'; cv.style.height = S + 'px';
  var c2 = cv.getContext('2d'); c2.setTransform(DPR, 0, 0, DPR, 0, 0); c2.clearRect(0, 0, S, S);
  var cache = GAME.nextChar ? charCache[GAME.nextChar] : null;
  if (!cache) return;
  var sc = (GAME.nextSize === 'S' ? 9.7 : 14) / cache.pathScale; // big or small, like the piece that will come
  c2.translate(S / 2, S / 2); c2.scale(sc, -sc); c2.translate(-cache.pathCx, -cache.pathCy);
  fillGlyph(c2, cache, '#fdf6ea');
}

function spawnCurrentPiece(){
  var ch = GAME.nextChar || randomChar(), sz = GAME.nextSize || randomSize();
  GAME.nextChar = randomChar(); GAME.nextSize = randomSize();
  updateNextGlyphDisplay();
  currentPiece = { ch: ch, size: sz, r: PIECE_TARGET_R * PIECE_SIZES[sz], x: platformCX, y: SPAWN_Y, angle: 0 };
  if (HOLD_GAP > 0) currentPiece.y = Math.max(SPAWN_Y, dragYRange().max - HOLD_GAP);
  clampHeldPiece();
}
var HOLD_GAP = 90; // px between a newly held piece and the regulation line
function clampHeldPiece(){
  if (!currentPiece) return;
  var yr = dragYRange();
  if (currentPiece.y > yr.max) currentPiece.y = yr.max;
  if (currentPiece.y < yr.min) currentPiece.y = yr.min;
}

function dropCurrentPiece(x){
  if (!currentPiece || GAME.gameOver) return;
  sfxGrab();
  var clampedX = Math.max(20, Math.min(W - 20, x));
  clampHeldPiece();
  var pieceObj = makePieceBody(currentPiece.ch, clampedX, currentPiece.y - camY, currentPiece.angle, currentPiece.r); // held piece: screen space -> physics: world space
  World.add(world, pieceObj.body);
  pieces.push(pieceObj);
  activePieceObj = pieceObj;
  activeFrames = 0;
  currentPiece = null;
}

// ---- turn tracking: wait for the just-dropped piece to sleep (or a
var activePieceObj = null, activeFrames = 0;
var ACTIVE_TIMEOUT = 700;
var SETTLE_FRAMES = 30;
var frameCounter = 0;

function checkGameOver(){
    for (var i = 0; i < pieces.length; i++) {
    var gb = pieces[i].body;
    if (gb.position.y > VOID_Y || gb.bounds.min.y > groundY + 2) return true;
  }
  return false;
}

// ---- iOS アプリの中だけ：アプリが入れる window.APP_* があるときだけ使う（ブラウザ・itch.io・あそびトークでは何もしない） ----
function appHaptic(kind){ try { if (typeof window.APP_HAPTIC === 'function') window.APP_HAPTIC(kind); } catch (e) { /* ignore */ } }
function updateOverExtra(){
  var row = document.getElementById('overExtra'), rk = document.getElementById('rankBtn'), sh = document.getElementById('shareBtn');
  if (!row || !rk || !sh) return;
  var showRank = typeof window.APP_RANKING === 'function' && window.APP_GAMECENTER === true;
  var showShare = typeof window.APP_SHARE === 'function';
  rk.hidden = !showRank; sh.hidden = !showShare; row.hidden = !(showRank || showShare);
}
updateOverExtra();
window.addEventListener('app-gamecenter', updateOverExtra);

function showGameOver(){
  GAME.gameOver = true;
  var newBest = GAME.score > GAME.highScore;
  if (newBest) { GAME.highScore = GAME.score; saveHighScore(GAME.highScore); }
  var plays = bumpPlayCount();
  // iOS アプリだけ：3回目から・新記録・5文字以上のとき、カードが出るときにレビューのお願い（待つのと回数の制限は shell）
  var askReview = plays >= 3 && newBest && GAME.score >= 5;
  document.getElementById('finalScore').textContent = GAME.score;
  document.getElementById('highScoreLine').textContent = bestLineText(GAME.highScore);
  updatePanelBestScore();
  updateOverExtra();
  appHaptic('heavy');
  try { if (typeof window.APP_SCORE === 'function') window.APP_SCORE(GAME.score | 0); } catch (e) { /* ignore */ }
  achieveOnGameOver(plays);
  var wrap = document.getElementById('stage-wrap');
  wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
  clearTimeout(overTimer);
  overTimer = setTimeout(function(){
    document.getElementById('overOverlay').classList.remove('hidden');
    if (newBest) appHaptic('success');
    if (askReview) { try { if (typeof window.APP_REVIEW === 'function') window.APP_REVIEW(); } catch (e) { /* ignore */ } }
  }, 650);
  // 別のページの中（あそびトークのゲームセンターなど）で遊んでいるときは、外のページにスコアを知らせる
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'hiragana-balance', type: 'gameover', score: GAME.score, best: GAME.highScore }, '*');
    }
  } catch (e) { /* ignore */ }
}
var overTimer = null;
function updatePanelBestScore(){
  var el = document.getElementById('panel-best-score');
  if (el) el.textContent = GAME.highScore;
}

function resetGame(){
  pieces.forEach(function(p){ Composite.remove(world, p.body); });
  pieces = [];
  GAME.score = 0;
  GAME.gameOver = false;
  clearTimeout(overTimer);
  document.getElementById('stage-wrap').classList.remove('shake');
  FX.drops = []; FX.puffs = [];
  document.getElementById('scoreVal').textContent = '0';
  document.getElementById('overOverlay').classList.add('hidden');
  GAME.nextChar = randomChar(); GAME.nextSize = randomSize();
  activePieceObj = null; activeFrames = 0;
  camY = 0; camTargetY = 0;
  spawnCurrentPiece();
}

