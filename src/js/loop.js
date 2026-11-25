// ---------- settings panel: best score + mute toggle ----------
var settingsBtn = document.getElementById('settingsBtn');
var settingsPanel = document.getElementById('settings-panel');
var muteToggleBtn = document.getElementById('toggle-switch');
function updateMuteBtnVisual(){
  if (isMuted) muteToggleBtn.classList.remove('is-on');
  else muteToggleBtn.classList.add('is-on');
}
function toggleMute(){
  isMuted = !isMuted;
  saveMuted(isMuted);
  updateMuteBtnVisual();
  if (isMuted) stopBgm();
  else startBgm();
}
updateMuteBtnVisual();
updatePanelBestScore();
settingsBtn.addEventListener('click', function(e){
  e.stopPropagation();
  sfxButton();
  settingsPanel.classList.toggle('show');
});
muteToggleBtn.addEventListener('click', function(e){
  e.stopPropagation();
  toggleMute();
});
document.addEventListener('click', function(e){
  if (!settingsPanel.classList.contains('show')) return;
  if (settingsPanel.contains(e.target) || settingsBtn.contains(e.target)) return;
  settingsPanel.classList.remove('show');
});

var UNLOCK_EVENTS = ['pointerdown','pointerup','touchstart','touchend','mousedown','click','keydown'];
function removeUnlockListeners(){
  UNLOCK_EVENTS.forEach(function(evt){ document.removeEventListener(evt, tryUnlockAudio); });
}
function tryUnlockAudio(){
  getAudioCtx();
  startBgm();
}
UNLOCK_EVENTS.forEach(function(evt){ document.addEventListener(evt, tryUnlockAudio, { passive: true }); });

// ---- main loop ----
var lastTime = null;
function frame(ts){
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = ts;
  var dt = Math.min(ts - lastTime, 33); // clamp to avoid huge jumps on tab-return
  lastTime = ts;

  if (currentPiece && rotateDirection !== 0) {
    currentPiece.angle += rotateDirection * 2.6 * (dt / 1000);
  }

  if (!GAME.gameOver && pieces.length >= 0 && document.getElementById('startOverlay').classList.contains('hidden')) {
    Engine.update(engine, 1000 / 60);
    updateCamera(1000 / 60);
    clampHeldPiece(); // fixed step for determinism; exact value matches Matter's own internal baseline (avoids the recurring "delta should be <= 16.667ms" warning that the literal 16.6667 triggered on every frame, since it was a hair larger than Matter's own 1000/60 threshold)

    if (activePieceObj) {
      activeFrames++;
      var apBody = activePieceObj.body;
      activePieceObj.__visWindow = activePieceObj.__visWindow || [];
      activePieceObj.__visWindow.push({ x: apBody.position.x, y: apBody.position.y, angle: apBody.angle });
      if (activePieceObj.__visWindow.length > SETTLE_FRAMES) activePieceObj.__visWindow.shift();
      var visuallySettled = false;
      if (activePieceObj.__visWindow.length === SETTLE_FRAMES) {
        var xs = activePieceObj.__visWindow.map(function(w){ return w.x; });
        var ys = activePieceObj.__visWindow.map(function(w){ return w.y; });
        var angs = activePieceObj.__visWindow.map(function(w){ return w.angle; });
        var xRange = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var yRange = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        var angRange = Math.max.apply(null, angs) - Math.min.apply(null, angs);
        visuallySettled = xRange < 0.5 && yRange < 0.5 && angRange < 0.025;
      }
      if (apBody.isSleeping || (activeFrames > ACTIVE_TIMEOUT || visuallySettled)) {
        activePieceObj = null;
        GAME.score++;
        document.getElementById('scoreVal').textContent = GAME.score;
        celebrateScore(GAME.score);
        spawnCurrentPiece();
      }
    }

    if (checkGameOver()) {
      showGameOver();
    }
  }

  positionRotateButtons();
  render();
}

function drawGlyphShadow(pieceObj){
  var sp = glyphSprites(pieceObj.ch, pieceObj.r), b = pieceObj.body;
  ctx.globalAlpha = 0.24;
  drawSprite(sp.shadow, b.position.x + 2, b.position.y + 4, b.angle, sp.E);
  ctx.globalAlpha = 1;
}
function drawGlyphBody(pieceObj){
  var sp = glyphSprites(pieceObj.ch, pieceObj.r), b = pieceObj.body;
  drawSprite(sp.body, b.position.x, b.position.y, b.angle, sp.E);
}

function roundRectPath(c, x, y, w, h, r){
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function drawRuler(y0){
  var x0 = 7, x1 = W - 7, rh = 14, w = x1 - x0;
  ctx.save();
  ctx.fillStyle = 'rgba(58,51,44,0.05)';
  roundRectPath(ctx, x0 + 1.5, y0 + 2.5, w, rh, 3); ctx.fill();
  var g = ctx.createLinearGradient(0, y0, 0, y0 + rh);
  g.addColorStop(0, 'rgba(236,245,250,0.32)'); g.addColorStop(1, 'rgba(208,226,238,0.20)');
  ctx.fillStyle = g; roundRectPath(ctx, x0, y0, w, rh, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(58,51,44,0.26)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0 + 5, y0 + rh - 2.5); ctx.lineTo(x1 - 5, y0 + rh - 2.5); ctx.stroke();
  ctx.strokeStyle = 'rgba(58,51,44,0.45)'; ctx.lineWidth = 0.8;
  ctx.fillStyle = 'rgba(58,51,44,0.45)';
  ctx.font = '600 7px "Klee One", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (var i = 0, x = x0 + 6; x < x1 - 4; i++, x += 4) {
    var len = i % 10 === 0 ? 7 : (i % 5 === 0 ? 5 : 3);
    ctx.beginPath(); ctx.moveTo(x + 0.5, y0 + 0.5); ctx.lineTo(x + 0.5, y0 + len); ctx.stroke();
    if (i % 10 === 0 && i > 0 && x < x1 - 10) ctx.fillText(String(i / 10), x + 0.5, y0 + rh - 3.5);
  }
  ctx.restore();
}
function drawSkinDesk(x, y, w){
  var d = SKIN_ART.desk, sc = w / (d.x1 - d.x0);
  ctx.drawImage(d.img, x - d.x0 * sc, y - d.top * sc, d.img.width * sc, d.img.height * sc);
}
function drawSkinRuler(y0){
  var x0 = 7, x1 = W - 7, rh = SKIN_ART.ruler.h || 15, w = x1 - x0;
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#3a2a1a';
  roundRectPath(ctx, x0 + 1.5, y0 + 3, w, rh, 3); ctx.fill();
  ctx.globalAlpha = SKIN_ART.ruler.alpha || 0.9;
  ctx.drawImage(SKIN_ART.ruler.img, x0, y0, w, rh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(58,40,24,0.55)'; ctx.lineWidth = 0.8; ctx.fillStyle = 'rgba(58,40,24,0.62)';
  ctx.font = '600 7px "Klee One", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (var i = 0, x = x0 + 6; x < x1 - 4; i++, x += 4) {
    var len = i % 10 === 0 ? 7 : (i % 5 === 0 ? 5 : 3);
    ctx.beginPath(); ctx.moveTo(x + 0.5, y0 + 1); ctx.lineTo(x + 0.5, y0 + 1 + len); ctx.stroke();
    if (i % 10 === 0 && i > 0 && x < x1 - 10) ctx.fillText(String(i / 10), x + 0.5, y0 + rh - 3);
  }
  ctx.restore();
}
function drawDesk(x, y, w, h){
  var ink = '#3a332c';
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  [x + 13, x + w - 13].forEach(function(lx){
    ctx.strokeStyle = ink; ctx.lineWidth = 7.5;
    ctx.beginPath(); ctx.moveTo(lx, y + h - 2); ctx.lineTo(lx, y + h + 260); ctx.stroke();
    ctx.strokeStyle = '#a3aaaf'; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(lx - 1, y + h); ctx.lineTo(lx - 1, y + h + 260); ctx.stroke();
  });
  var ty = y + 9, th = h - 9;
  roundRectPath(ctx, x + 5, ty, w - 10, th, 3);
  ctx.fillStyle = '#7f8b79'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
  roundRectPath(ctx, x + 13, ty + 5, w - 26, th - 10, 2);
  ctx.fillStyle = '#434b41'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 8, ty + 2.5); ctx.lineTo(x + w - 8, ty + 2.5); ctx.stroke();
  var g = ctx.createLinearGradient(0, y, 0, y + 10);
  g.addColorStop(0, '#e6c28c'); g.addColorStop(1, '#cf9f62');
  roundRectPath(ctx, x, y, w, 10, 3);
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(122,78,34,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 3, y + 7.3); ctx.lineTo(x + w - 3, y + 7.3); ctx.stroke();
  ctx.strokeStyle = 'rgba(140,92,44,0.38)'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 3.4); ctx.quadraticCurveTo(x + w * 0.3, y + 2.2, x + w * 0.52, y + 3.6);
  ctx.moveTo(x + w * 0.58, y + 2.6); ctx.quadraticCurveTo(x + w * 0.78, y + 4.2, x + w - 8, y + 2.9);
  ctx.moveTo(x + w * 0.22, y + 5.4); ctx.quadraticCurveTo(x + w * 0.4, y + 4.6, x + w * 0.6, y + 5.6);
  ctx.stroke();
  ctx.restore();
}
function render(){
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, camY); // world layer (platform + pieces) scrolls with the camera

  if (SKIN_ART.desk) drawSkinDesk(platformLeft, groundY, platformW);
  else drawDesk(platformLeft, groundY, platformW, 28); // looks like a school desk; physics is the plain 28px-tall slab

  pieces.forEach(drawGlyphShadow);
  pieces.forEach(drawGlyphBody);
  updateFx();
  drawFx();

  ctx.restore(); // back to screen space: regulation line + held piece

  if (currentPiece && pieces.length > 0) {
    var edgeY = dragYRange().max + pieceLowestOffset(currentPiece.ch, currentPiece.angle, currentPiece.r);
    if (SKIN_ART.ruler) drawSkinRuler(edgeY); else drawRuler(edgeY);
  }

  if (currentPiece) {
    var hsp = glyphSprites(currentPiece.ch, currentPiece.r);
    ctx.globalAlpha = 0.13; // held up: a faint shadow further away
    drawSprite(hsp.shadow, currentPiece.x + 5, currentPiece.y + 10, currentPiece.angle, hsp.E);
    ctx.globalAlpha = 0.92;
    drawSprite(hsp.body, currentPiece.x, currentPiece.y, currentPiece.angle, hsp.E);
    ctx.globalAlpha = 1;
    if (!pointerDown && !GAME.gameOver && LANG !== 'ja' && ROMAJI[currentPiece.ch]) {
      ctx.save();
      ctx.font = '600 14px "Klee One", "Hiragino Mincho ProN", "Yu Mincho", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,252,244,.9)';
      var ry = currentPiece.y + glyphRadius(currentPiece.ch) * currentPiece.r + 6;
      ctx.strokeText(ROMAJI[currentPiece.ch], currentPiece.x, ry);
      ctx.fillStyle = '#7a6750';
      ctx.fillText(ROMAJI[currentPiece.ch], currentPiece.x, ry);
      ctx.restore();
    }
  }
}

// ===== TEST-ONLY: per-physics-step anomaly monitor + real-play autopilot =====

document.getElementById('creditsBtn').addEventListener('click', function(ev){
  ev.stopPropagation();
  document.getElementById('creditsOverlay').classList.remove('hidden');
});
document.getElementById('creditsClose').addEventListener('click', function(ev){
  ev.stopPropagation();
  document.getElementById('creditsOverlay').classList.add('hidden');
});
requestAnimationFrame(frame);

})();
