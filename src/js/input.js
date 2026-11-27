// ---- input: pointer follows to aim (both x and y), release/tap drops ----
function topOfStackY(){
  var top = groundY;
  for (var i = 0; i < pieces.length; i++) {
    var b = pieces[i].body;
    if (b.bounds.min.y < top) top = b.bounds.min.y;
  }
  return top;
}

// ---- camera ----
var camY = 0, camTargetY = 0;
function camAnchor(){ return Math.max(170, Math.round(H * 0.42)); }
function settledTopY(){
  var top = groundY;
  for (var i = 0; i < pieces.length; i++) {
    if (pieces[i] === activePieceObj) continue;
    var b = pieces[i].body;
    if (b.position.y > VOID_Y) continue;
    if (b.bounds.min.y < top) top = b.bounds.min.y;
  }
  return top;
}
function updateCamera(dtMs){
  camTargetY = Math.max(0, camAnchor() - settledTopY());
  var k = 1 - Math.exp(-Math.max(0, dtMs) / 200);
  camY += (camTargetY - camY) * k;
  if (Math.abs(camTargetY - camY) < 0.05) camY = camTargetY;
}

function pieceLowestOffset(ch, angle, radius){
  var cache = charCache[ch];
  var cos = Math.cos(angle), sin = Math.sin(angle);
  var lowest = -Infinity;
  for (var pi = 0; pi < cache.normPolys.length; pi++) {
    var poly = cache.normPolys[pi];
    for (var vi = 0; vi < poly.length; vi++) {
      var v = poly[vi];
      var ry = v.x * sin + v.y * cos; // rotated y (normalized units)
      if (ry > lowest) lowest = ry;
    }
  }
  return lowest * (radius || PIECE_TARGET_R);
}

function dragYRange(){
  var minY = 40;
  var lowestPointOffset = currentPiece ? pieceLowestOffset(currentPiece.ch, currentPiece.angle, currentPiece.r) : PIECE_TARGET_R;
  var maxY = Math.min(groundY + camY - lowestPointOffset, topOfStackY() + camY - lowestPointOffset - 6);
  if (maxY < minY) maxY = minY;
  return { min: minY, max: maxY };
}

function pointerXYFromEvent(e){
  var rect = canvas.getBoundingClientRect();
  var scaleX = W / rect.width, scaleY = H / rect.height;
  var clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
  var clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
// 設定を開いているときに机をタップしたら、設定を閉じるだけにする（文字は動かさない・落とさない）。
// 1回のタップで pointerdown・touchstart・mousedown が続けて来るので、指をはなすまで全部むしする
var swallowTap = false;
function handleDragStart(e){
  if (swallowTap) return;
  var sp = document.getElementById('settings-panel');
  if (sp && sp.classList.contains('show')) {
    sp.classList.remove('show');
    swallowTap = true;
    return;
  }
  if (GAME.gameOver || !currentPiece) return;
  pointerDown = true;
  var p = pointerXYFromEvent(e);
  currentPiece.x = Math.max(20, Math.min(W - 20, p.x));
  var yr = dragYRange();
  currentPiece.y = Math.max(yr.min, Math.min(yr.max, p.y));
}
function handleDragMove(e){
  if (!pointerDown || !currentPiece) return;
  var p = pointerXYFromEvent(e);
  currentPiece.x = Math.max(20, Math.min(W - 20, p.x));
  var yr = dragYRange();
  currentPiece.y = Math.max(yr.min, Math.min(yr.max, p.y));
}
function handleDragEnd(){
  if (!pointerDown) return;
  pointerDown = false;
  if (currentPiece) dropCurrentPiece(currentPiece.x);
}
canvas.addEventListener('pointerdown', handleDragStart);
canvas.addEventListener('pointermove', handleDragMove);
window.addEventListener('pointerup', handleDragEnd);
['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(function(t){
  window.addEventListener(t, function(){ swallowTap = false; });
});
canvas.addEventListener('touchstart', function(e){ e.preventDefault(); handleDragStart(e); }, { passive: false });
canvas.addEventListener('touchmove', function(e){ e.preventDefault(); handleDragMove(e); }, { passive: false });
window.addEventListener('touchend', handleDragEnd);
canvas.addEventListener('mousedown', handleDragStart);
canvas.addEventListener('mousemove', handleDragMove);
window.addEventListener('mouseup', handleDragEnd);

var rotateDirection = 0; // -1 CCW, +1 CW, 0 idle
function bindRotateButton(el, dir){
  var start = function(ev){ ev.preventDefault(); ev.stopPropagation(); if (ev.pointerId !== undefined && el.setPointerCapture) { try { el.setPointerCapture(ev.pointerId); } catch (e) {} } sfxRotate(); if (rotateDirection !== dir) appHaptic('select'); rotateDirection = dir; };
  var stop = function(ev){ if (ev) ev.stopPropagation(); rotateDirection = 0; };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', stop);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', stop);
  el.addEventListener('mouseleave', stop);
}
var rotBtnL = document.getElementById('rotateLeftBtn'), rotBtnR = document.getElementById('rotateRightBtn');
var rotBtnState = '';
function glyphRadius(ch){
  var c = charCache[ch];
  if (c.__rMax === undefined) {
    var m = 0;
    c.normPolys.forEach(function(poly){ poly.forEach(function(p){ var d = Math.hypot(p.x, p.y); if (d > m) m = d; }); });
    c.__rMax = m;
  }
  return c.__rMax;
}
function positionRotateButtons(){
  if (!currentPiece || GAME.gameOver || pointerDown) {
    if (rotBtnState !== 'hidden') { rotBtnState = 'hidden'; rotBtnL.style.visibility = 'hidden'; rotBtnR.style.visibility = 'hidden'; }
    return;
  }
  var par = rotBtnL.offsetParent || document.body;
  var cr = canvas.getBoundingClientRect(), pr = par.getBoundingClientRect();
  // rects are on screen (scaled by ZOOM); the buttons are placed inside the stage, so work in unscaled px
  var crW = cr.width / ZOOM, crH = cr.height / ZOOM;
  var sc = crW / W, left0 = (cr.left - pr.left) / ZOOM - par.clientLeft, top0 = (cr.top - pr.top) / ZOOM - par.clientTop;
  var bw = rotBtnL.offsetWidth, bh = rotBtnL.offsetHeight;
  var reach = glyphRadius(currentPiece.ch) * currentPiece.r + 14;         // canvas px from the piece centre to the button's inner edge
  var cx = currentPiece.x, cy = currentPiece.y;
  var lx = left0 + (cx - reach) * sc - bw, rx = left0 + (cx + reach) * sc;
  var minX = left0 + 2, maxX = left0 + crW - bw - 2;
  var y = top0 + cy * sc - bh / 2, ly = y, ry = y;
  var above = top0 + (cy - reach * 0.75) * sc - bh;
  if (lx < minX) { lx = minX; ly = above; }
  if (rx > maxX) { rx = maxX; ry = above; }
  var yMin = top0 + 2, yMax = top0 + crH - bh - 2;
  ly = Math.max(yMin, Math.min(yMax, ly)); ry = Math.max(yMin, Math.min(yMax, ry));
  var st = Math.round(lx) + ',' + Math.round(ly) + ',' + Math.round(rx) + ',' + Math.round(ry);
  if (st !== rotBtnState) {
    rotBtnState = st;
    rotBtnL.style.transform = 'translate(' + Math.round(lx) + 'px,' + Math.round(ly) + 'px)';
    rotBtnR.style.transform = 'translate(' + Math.round(rx) + 'px,' + Math.round(ry) + 'px)';
    rotBtnL.style.visibility = 'visible'; rotBtnR.style.visibility = 'visible';
  }
}
bindRotateButton(document.getElementById('rotateLeftBtn'), 1);
bindRotateButton(document.getElementById('rotateRightBtn'), -1);

document.getElementById('startBtn').addEventListener('click', function(){
  sfxButton();
  document.getElementById('startOverlay').classList.add('hidden');
  resetGame();
});
document.getElementById('retryBtn').addEventListener('click', function(){
  sfxButton();
  resetGame();
});
document.getElementById('rankBtn').addEventListener('click', function(){
  sfxButton();
  try { if (typeof window.APP_RANKING === 'function') window.APP_RANKING(); } catch (e) { /* ignore */ }
});
document.getElementById('shareBtn').addEventListener('click', function(){
  sfxButton();
  try { if (typeof window.APP_SHARE === 'function') window.APP_SHARE(t('shareText').replace('{n}', GAME.score)); } catch (e) { /* ignore */ }
});

