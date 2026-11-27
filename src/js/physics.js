// ---- physics engine ----
var engine = Engine.create({ enableSleeping: true });
engine.positionIterations = 12; // enableSleeping defaults to FALSE in Matter.js — confirmed by testing, without this no piece ever reports isSleeping and the game's turn-advance logic (which waits on body.isSleeping) would hang forever. constraintIterations raised from the default 2 per Matter's own official guidance ("if the constraint is unstable, try lowering stiffness and/or increasing engine.constraintIterations") for the pivot Constraint used for natural toppling physics.
engine.gravity.y = 1.0; // Matter's gravity is applied as acceleration-per-substep-squared scaling internally; 1.0 is Matter's own default "1g" feel, tuned visually below via velocity/impulse rather than fighting the default
var world = engine.world;

(function(){
  var Collision = Matter.Collision, Pair = Matter.Pair, Vertices = Matter.Vertices;
  var rA = {}, rB = {};
  function overlapAxes(res, vertsA, vertsB, axes, internal){
    var minAll = Number.MAX_VALUE, axAll = null, minExt = Number.MAX_VALUE, axExt = null;
    for (var k = 0; k < axes.length; k++) {
      var ax = axes[k], x = ax.x, y = ax.y;
      var minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity, i, d;
      for (i = 0; i < vertsA.length; i++) { d = vertsA[i].x * x + vertsA[i].y * y; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (i = 0; i < vertsB.length; i++) { d = vertsB[i].x * x + vertsB[i].y * y; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      var o1 = maxA - minB, o2 = maxB - minA, o = o1 < o2 ? o1 : o2;
      if (o < minAll) { minAll = o; axAll = ax; if (o <= 0) break; }
      if (!(internal && internal[k]) && o < minExt) { minExt = o; axExt = ax; }
    }
    res.overlap = minAll; res.axis = axAll; res.extOverlap = minExt; res.extAxis = axExt;
  }
  Collision.collides = function(bodyA, bodyB, pairs){
    var ghostFix = true;
    overlapAxes(rA, bodyA.vertices, bodyB.vertices, bodyA.axes, ghostFix ? bodyA.__axisInternal : null);
    if (rA.overlap <= 0) return null;
    overlapAxes(rB, bodyB.vertices, bodyA.vertices, bodyB.axes, ghostFix ? bodyB.__axisInternal : null);
    if (rB.overlap <= 0) return null;
    var pair = pairs && pairs.table[Pair.id(bodyA, bodyB)], collision;
    if (!pair) {
      collision = Collision.create(bodyA, bodyB);
      collision.collided = true;
      collision.bodyA = bodyA.id < bodyB.id ? bodyA : bodyB;
      collision.bodyB = bodyA.id < bodyB.id ? bodyB : bodyA;
      collision.parentA = collision.bodyA.parent;
      collision.parentB = collision.bodyB.parent;
    } else {
      collision = pair.collision;
    }
    var axis, depth;
    if (ghostFix && (rA.extAxis || rB.extAxis)) {
      if (rA.extAxis && (!rB.extAxis || rA.extOverlap < rB.extOverlap)) { axis = rA.extAxis; depth = rA.extOverlap; }
      else { axis = rB.extAxis; depth = rB.extOverlap; }
    } else {
      if (rA.overlap < rB.overlap) { axis = rA.axis; depth = rA.overlap; } else { axis = rB.axis; depth = rB.overlap; }
    }
    var A = collision.bodyA, B = collision.bodyB, nx = axis.x, ny = axis.y;
    if (ghostFix) {
      var aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity, i2, d2;
      for (i2 = 0; i2 < A.vertices.length; i2++) { d2 = A.vertices[i2].x * nx + A.vertices[i2].y * ny; if (d2 < aMin) aMin = d2; if (d2 > aMax) aMax = d2; }
      for (i2 = 0; i2 < B.vertices.length; i2++) { d2 = B.vertices[i2].x * nx + B.vertices[i2].y * ny; if (d2 < bMin) bMin = d2; if (d2 > bMax) bMax = d2; }
      if (aMax - bMin < bMax - aMin) { nx = -nx; ny = -ny; } // normal points from B towards A
    } else if (nx * (B.position.x - A.position.x) + ny * (B.position.y - A.position.y) >= 0) { nx = -nx; ny = -ny; }
    var normal = collision.normal, tangent = collision.tangent, penetration = collision.penetration, supports = collision.supports;
    normal.x = nx; normal.y = ny;
    tangent.x = -ny; tangent.y = nx;
    penetration.x = nx * depth; penetration.y = ny * depth;
    collision.depth = depth;
    var supportsB = Collision._findSupports(A, B, normal, 1), supportCount = 0;
    if (Vertices.contains(A.vertices, supportsB[0])) supports[supportCount++] = supportsB[0];
    if (Vertices.contains(A.vertices, supportsB[1])) supports[supportCount++] = supportsB[1];
    if (supportCount < 2) {
      var supportsA = Collision._findSupports(B, A, normal, -1);
      if (Vertices.contains(B.vertices, supportsA[0])) supports[supportCount++] = supportsA[0];
      if (supportCount < 2 && Vertices.contains(B.vertices, supportsA[1])) supports[supportCount++] = supportsA[1];
    }
    if (supportCount === 0) supports[supportCount++] = supportsB[0];
    collision.supportCount = supportCount;
    return collision;
  };
})();

(function(){
  var Resolver = Matter.Resolver, Common = Matter.Common;
  function contactVelocity(A, B, ox, oy, px, py){
    return {
      x: (A.position.x - A.positionPrev.x) - oy * (A.angle - A.anglePrev) - ((B.position.x - B.positionPrev.x) - py * (B.angle - B.anglePrev)),
      y: (A.position.y - A.positionPrev.y) + ox * (A.angle - A.anglePrev) - ((B.position.y - B.positionPrev.y) + px * (B.angle - B.anglePrev))
    };
  }
  function applyImpulse(A, B, ix, iy, ox, oy, px, py){
    if (!(A.isStatic || A.isSleeping)) { A.positionPrev.x += ix * A.inverseMass; A.positionPrev.y += iy * A.inverseMass; A.anglePrev += (ox * iy - oy * ix) * A.inverseInertia; }
    if (!(B.isStatic || B.isSleeping)) { B.positionPrev.x -= ix * B.inverseMass; B.positionPrev.y -= iy * B.inverseMass; B.anglePrev -= (px * iy - py * ix) * B.inverseInertia; }
  }
  function solveContactGS(pair, contact, A, B, ox, oy, px, py, nx, ny, tx, ty, invMassTotal, friction, contactShare, timeScaleCubed, restingThresh, restingThreshTangent, frictionMaxStatic, mu){
    var rv = contactVelocity(A, B, ox, oy, px, py);
    var normalVelocity = nx * rv.x + ny * rv.y, tangentVelocity = tx * rv.x + ty * rv.y;
    var normalOverlap = pair.separation + normalVelocity;
    var normalForce = normalOverlap < 0 ? 0 : Math.min(normalOverlap, 1);
    var frictionLimit = normalForce * friction, tImp, maxFriction, isStatic;
    if (tangentVelocity < -frictionLimit || tangentVelocity > frictionLimit) {
      maxFriction = Math.abs(tangentVelocity);
      tImp = pair.friction * (tangentVelocity > 0 ? 1 : -1) * timeScaleCubed;
      if (tImp < -maxFriction) tImp = -maxFriction; else if (tImp > maxFriction) tImp = maxFriction;
      isStatic = false;
    } else { tImp = tangentVelocity; maxFriction = frictionMaxStatic; isStatic = true; }
    var oAcT = ox * ty - oy * tx, oBcT = px * ty - py * tx;
    var tShare = contactShare / (invMassTotal + A.inverseInertia * oAcT * oAcT + B.inverseInertia * oBcT * oBcT);
    tImp *= tShare;
    var coulombMax = (isStatic ? mu : pair.friction) * -contact.normalImpulse;
    maxFriction = Math.min(maxFriction, coulombMax);
    if (tangentVelocity < -restingThreshTangent || tangentVelocity > restingThreshTangent) {
      contact.tangentImpulse = 0;
      if (tImp > coulombMax) tImp = coulombMax; else if (tImp < -coulombMax) tImp = -coulombMax;
    } else {
      var t0 = contact.tangentImpulse;
      contact.tangentImpulse += tImp;
      if (contact.tangentImpulse < -maxFriction) contact.tangentImpulse = -maxFriction;
      if (contact.tangentImpulse > maxFriction) contact.tangentImpulse = maxFriction;
      tImp = contact.tangentImpulse - t0;
    }
    applyImpulse(A, B, tx * tImp, ty * tImp, ox, oy, px, py);
    rv = contactVelocity(A, B, ox, oy, px, py);
    normalVelocity = nx * rv.x + ny * rv.y;
    var oAcN = ox * ny - oy * nx, oBcN = px * ny - py * nx;
    var nShare = contactShare / (invMassTotal + A.inverseInertia * oAcN * oAcN + B.inverseInertia * oBcN * oBcN);
    var nImp = (1 + pair.restitution) * normalVelocity * nShare;
    if (normalVelocity < restingThresh) {
      contact.normalImpulse = 0;
    } else {
      var n0 = contact.normalImpulse;
      contact.normalImpulse += nImp;
      if (contact.normalImpulse > 0) contact.normalImpulse = 0;
      nImp = contact.normalImpulse - n0;
    }
    applyImpulse(A, B, nx * nImp, ny * nImp, ox, oy, px, py);
  }
  Resolver.solveVelocity = function(pairs, delta){
    var timeScale = delta / Common._baseDelta,
        timeScaleSquared = timeScale * timeScale,
        timeScaleCubed = timeScaleSquared * timeScale,
        restingThresh = -Resolver._restingThresh * timeScale,
        restingThreshTangent = Resolver._restingThreshTangent,
        frictionNormalMultiplier = Resolver._frictionNormalMultiplier * timeScale,
        frictionMaxStatic = Resolver._frictionMaxStatic,
        pairsLength = pairs.length, i, j;
    for (i = 0; i < pairsLength; i++) {
      var pair = pairs[i];
      if (!pair.isActive || pair.isSensor) continue;
      var collision = pair.collision, bodyA = collision.parentA, bodyB = collision.parentB,
          normalX = collision.normal.x, normalY = collision.normal.y,
          tangentX = collision.tangent.x, tangentY = collision.tangent.y,
          inverseMassTotal = pair.inverseMass,
          friction = pair.friction * pair.frictionStatic * frictionNormalMultiplier,
          contacts = pair.contacts, contactCount = pair.contactCount, contactShare = 1 / contactCount;
      var mu = pair.frictionStatic;
      for (j = 0; j < contactCount; j++) {
        var contact = contacts[j], contactVertex = contact.vertex;
        var offsetAX = contactVertex.x - bodyA.position.x, offsetAY = contactVertex.y - bodyA.position.y,
            offsetBX = contactVertex.x - bodyB.position.x, offsetBY = contactVertex.y - bodyB.position.y;
        solveContactGS(pair, contact, bodyA, bodyB, offsetAX, offsetAY, offsetBX, offsetBY, normalX, normalY, tangentX, tangentY, inverseMassTotal, friction, contactShare, timeScaleCubed, restingThresh, restingThreshTangent, frictionMaxStatic, mu);
      }
    }
  };
})();

var _preSolvePosition = Matter.Resolver.preSolvePosition;
Matter.Resolver.preSolvePosition = function(pairsList){
  resolveSeamJams(pairsList);
  return _preSolvePosition.apply(this, arguments);
};
function resolveSeamJams(list){
  var byPart = {};
  for (var i = 0; i < list.length; i++) {
    var pr = list[i];
    if (!pr.isActive || pr.isSensor) continue;
    var c = pr.collision, pA = c.parentA, pB = c.parentB;
    if (pA.isStatic || pB.isStatic || pA === pB) continue;
    [[c.bodyA, c.bodyB, 1], [c.bodyB, c.bodyA, -1]].forEach(function(t){
      var victim = t[0], pusher = t[1], sg = t[2];
      var key = victim.id + '>' + pusher.parent.id;
      (byPart[key] || (byPart[key] = [])).push({ pr: pr, pusher: pusher, nx: sg * c.normal.x, ny: sg * c.normal.y, d: c.depth });
    });
  }
  for (var key in byPart) {
    var g = byPart[key];
    if (g.length < 2) continue;
    var sx = 0, sy = 0;
    g.forEach(function(e){ sx += e.nx * e.d; sy += e.ny * e.d; });
    for (var a = 0; a < g.length; a++) {
      var e = g[a];
      if (e.nx * sx + e.ny * sy >= 0) continue; // agrees with the majority
      for (var b2 = 0; b2 < g.length; b2++) {
        var f = g[b2];
        if (f === e || !e.pusher.__adj || e.pusher.__adj.indexOf(f.pusher) < 0) continue;
        if (e.nx * f.nx + e.ny * f.ny < -0.3) { e.pr.isActive = false; break; }
      }
    }
  }
}
var sweepIndex = 0;
var ANGULAR_DAMPING = 0.03;
// little ink drops where a dropped letter first lands (looks only; does not touch the physics)
var FX = { drops: [], puffs: [] };
var lastLandHaptic = -1e9;
Events.on(engine, 'collisionStart', function(ev){
  if (!activePieceObj || activePieceObj.__landed) return;
  var ap = activePieceObj.body;
  for (var i = 0; i < ev.pairs.length; i++) {
    var p = ev.pairs[i];
    if (p.bodyA.parent !== ap && p.bodyB.parent !== ap) continue;
    activePieceObj.__landed = true;
    var nowMs = performance.now();
    if (nowMs - lastLandHaptic >= 150) { lastLandHaptic = nowMs; appHaptic('light'); }
    var speed = Math.hypot(ap.velocity.x, ap.velocity.y);
    if (speed < 0.6) return;
    var col = p.collision, x = ap.position.x, y = ap.bounds.max.y;
    if (col && col.supportCount > 0) {
      x = 0; y = 0;
      for (var k = 0; k < col.supportCount; k++) { x += col.supports[k].x; y += col.supports[k].y; }
      x /= col.supportCount; y /= col.supportCount;
    }
    spawnSplash(x, y, Math.min(1, speed / 2.2));
    return;
  }
});
function spawnSplash(x, y, power){
  var n = 6 + Math.round(power * 8);
  for (var i = 0; i < n; i++) {
    var dir = (Math.random() < 0.5 ? -1 : 1);
    FX.drops.push({ x: x + (Math.random() - 0.5) * 10, y: y - 1, vx: dir * (0.5 + Math.random() * 1.6) * (0.6 + power),
      vy: -(0.8 + Math.random() * 2.4) * (0.5 + power), r: 0.9 + Math.random() * 1.9, life: 1 });
  }
  FX.puffs.push({ x: x, y: y, t: 0, w: 14 + power * 18 });
}
function updateFx(){
  for (var i = FX.drops.length - 1; i >= 0; i--) {
    var d = FX.drops[i];
    d.vy += 0.2; d.x += d.vx; d.y += d.vy; d.life -= 0.035;
    if (d.life <= 0) FX.drops.splice(i, 1);
  }
  for (var j = FX.puffs.length - 1; j >= 0; j--) { FX.puffs[j].t += 1 / 22; if (FX.puffs[j].t >= 1) FX.puffs.splice(j, 1); }
}
function drawFx(){
  ctx.save();
  FX.puffs.forEach(function(p){
    ctx.globalAlpha = 0.28 * (1 - p.t);
    ctx.strokeStyle = '#8a7a66'; ctx.lineWidth = 1.2;
    var w = p.w * (0.5 + p.t);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, w, w * 0.22, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  });
  ctx.fillStyle = INK;
  FX.drops.forEach(function(d){
    ctx.globalAlpha = Math.min(1, 1.6 * d.life);
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r * (0.6 + 0.4 * d.life), 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

// ---- hanamaru (red-pen flower circle) on the score every 10 letters ----
(function buildHanamaru(){
  var pts = [], cx = 50, cy = 50, R = 34, a = 8, k = 7, start = -Math.PI / 2 - 0.25, t;
  for (t = 0; t <= Math.PI * 2.12; t += 0.02) {
    var u = start + t;
    pts.push([cx + R * Math.cos(u) + a * Math.cos(k * u + Math.PI * 0.5), cy + R * Math.sin(u) + a * Math.sin(k * u + Math.PI * 0.5)]);
  }
  var d = 'M' + pts.map(function(p){ return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
  var path = document.querySelector('#hanamaru path');
  if (path) {
    path.setAttribute('d', d);
    var len = 0; for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    path.style.setProperty('--len', Math.ceil(len));
    path.style.strokeDasharray = Math.ceil(len); path.style.strokeDashoffset = Math.ceil(len);
  }
})();
function celebrateScore(score){
  var sv = document.getElementById('scoreVal');
  sv.classList.remove('pop'); void sv.offsetWidth; sv.classList.add('pop');
  if (score > 0 && score % 10 === 0) {
    var h = document.getElementById('hanamaru');
    if (h) { h.classList.remove('show'); void h.getBoundingClientRect(); h.classList.add('show'); }
    sfxHanamaru();
    appHaptic('success');
  }
}

Events.on(engine, 'beforeUpdate', function(){
  var bodies = Composite.allBodies(world);
  var angD = ANGULAR_DAMPING;
  for (var ai = 0; ai < bodies.length; ai++) {
    var ab = bodies[ai];
    if (ab.isStatic || ab.isSleeping || ab.frictionAir >= 1) continue;
    var k = (1 - angD) / (1 - ab.frictionAir);
    ab.anglePrev = ab.angle - (ab.angle - ab.anglePrev) * k;
  }
  for (var i = 0; i < bodies.length; i++) {
    var b = bodies[i];
    if (b.isStatic || b.isSleeping || b.sleepThreshold <= 0) continue;
    if (isMoving(b)) { b.sleepCounter = 0; continue; }
    if (b.sleepCounter + 1 < b.sleepThreshold) continue;
    if (!isBodySupported(b, bodies) || hasMovingNeighbour(b, bodies)) b.sleepCounter = 0;
  }
  for (var m0 = 0; m0 < bodies.length; m0++) {
    var ab = bodies[m0];
    if (!ab.isStatic && !ab.isSleeping && ab.motion > 1e-4) ab.__activeAt = frameCounter;
  }
  if (frameCounter % 8 === 0) {
    var movers = [];
    for (var m = 0; m < bodies.length; m++) {
      var mb = bodies[m];
      if (!mb.isStatic && mb.__activeAt !== undefined && frameCounter - mb.__activeAt <= 24) movers.push(mb);
    }
    if (movers.length) {
      for (var j = 0; j < bodies.length; j++) {
        var sb = bodies[j];
        if (sb.isStatic || !sb.isSleeping) continue;
        var near = false;
        for (var q = 0; q < movers.length; q++) { if (partsNear(sb, movers[q], 2)) { near = true; break; } }
        if (!near) continue;
        if (!isBodySupported(sb, bodies)) { sb.__wakeReason = 'recheckUnsupported'; Sleeping.set(sb, false); }
        else if (hasMovingNeighbour(sb, bodies)) { sb.__wakeReason = 'recheckMovingNb'; Sleeping.set(sb, false); }
      }
    }
    var sleepers = [];
    for (var r0 = 0; r0 < bodies.length; r0++) if (!bodies[r0].isStatic && bodies[r0].isSleeping) sleepers.push(bodies[r0]);
    if (sleepers.length) {
      var rb = sleepers[sweepIndex++ % sleepers.length];
      if (!isBodySupported(rb, bodies)) { rb.__wakeReason = 'sweep'; Sleeping.set(rb, false); }
    }
  }
  frameCounter++;
});

function buildPlatform(){
  Composite.clear(world, false);
  var platform = Bodies.rectangle(platformCX, groundY + 14, platformW, 28, {
    isStatic: true, friction: 0.6, restitution: 0.05
  });
  World.add(world, platform);
  return platform;
}
platformBody = buildPlatform();

