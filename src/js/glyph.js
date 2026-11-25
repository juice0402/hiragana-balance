// ---- per-character body-creation cache: build Matter.js vertex sets once,
var PIECE_TARGET_R = 30;
var PIECE_SIZES = { L: 1.15, S: 0.8 };
var GLYPH_BOLD = 0.025;
function fillGlyph(c, cache, color){
  c.fillStyle = color; c.fill(cache.path2d);
  c.strokeStyle = color; c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = 2 * GLYPH_BOLD * cache.pathScale; c.stroke(cache.path2d);
}
// ---- ink look: each letter (per size) is drawn once into a small picture with a soft edge, a light paper
// grain and a separate blurred shadow, then the pictures are reused every frame (cheaper than path fills) ----
var INK = '#2d2722';
var spriteCache = {};
var grainCanvas = null;
function grain(){
  if (grainCanvas) return grainCanvas;
  var g = document.createElement('canvas'); g.width = g.height = 96;
  var c = g.getContext('2d'), img = c.createImageData(96, 96), seed = 12345;
  for (var i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647; var v = seed / 2147483647;
    img.data[i] = 250; img.data[i + 1] = 244; img.data[i + 2] = 232;
    img.data[i + 3] = v > 0.94 ? Math.round((v - 0.94) / 0.06 * 26) : 0;
  }
  c.putImageData(img, 0, 0);
  return (grainCanvas = g);
}
function glyphSprites(ch, r){
  var key = ch + '|' + r + '|' + DPR;
  if (spriteCache[key]) return spriteCache[key];
  var cache = charCache[ch];
  var E = Math.ceil(glyphRadius(ch) * r + 10); // half size in css px (glyph + bleed + blur room)
  var px = Math.ceil(2 * E * DPR), s = r / cache.pathScale;
  function place(c, dx){ c.setTransform(DPR, 0, 0, DPR, (E + dx) * DPR, E * DPR); c.scale(s, -s); c.translate(-cache.pathCx, -cache.pathCy); }
  // body: ink with a slightly soft edge and a faint dry-brush grain
  var body = document.createElement('canvas'); body.width = body.height = px;
  var b = body.getContext('2d');
  place(b, 0);
  b.shadowColor = 'rgba(45,39,34,0.55)'; b.shadowBlur = 1.4 * DPR;
  fillGlyph(b, cache, INK);
  b.shadowColor = 'transparent'; b.shadowBlur = 0;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = 'source-atop';
  b.fillStyle = b.createPattern(grain(), 'repeat'); b.fillRect(0, 0, px, px);
  var sheen = b.createLinearGradient(0, 0, px, px);
  sheen.addColorStop(0, 'rgba(255,248,236,0.10)'); sheen.addColorStop(0.5, 'rgba(255,248,236,0)'); sheen.addColorStop(1, 'rgba(0,0,0,0.10)');
  b.fillStyle = sheen; b.fillRect(0, 0, px, px);
  // shadow: drawn far to the left, only its blurred shadow lands inside the picture
  var sh = document.createElement('canvas'); sh.width = sh.height = px;
  var c2 = sh.getContext('2d');
  place(c2, -4000);
  c2.shadowColor = 'rgba(60,40,22,1)'; c2.shadowBlur = 5 * DPR; c2.shadowOffsetX = 4000 * DPR;
  fillGlyph(c2, cache, '#000');
  return (spriteCache[key] = { body: body, shadow: sh, E: E });
}
function drawSprite(img, x, y, angle, E){
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.drawImage(img, -E, -E, 2 * E, 2 * E); ctx.restore();
}
function randomSize(){ return Math.random() < 0.5 ? 'L' : 'S'; } // nominal "radius" (half of on-screen size) for a freshly spawned piece, matching the original game's feel

var charCache = {}; // ch -> { normVerts: [[{x,y},...], ...], normPathScale, pathCx, pathCy, path2d }

// ---- glyph outline -> physics parts ----
function polySignedArea(poly){
  var a = 0;
  for (var i = 0, n = poly.length; i < n; i++) { var p = poly[i], q = poly[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
function pointInPoly(pt, poly){
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if (((a.y > pt.y) !== (b.y > pt.y)) && (pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}
function segmentsCross(a, b, c, d){
  function orient(p, q, r){ return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); }
  var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
var FILL_TEST_CTX = document.createElement('canvas').getContext('2d');
function cleanContour(poly){
  var P = poly.map(function(p){ return [p.x, p.y]; });
  decomp.removeCollinearPoints(P, 0.01);
  if (decomp.removeDuplicatePoints) decomp.removeDuplicatePoints(P, 0.01);
  return P.map(function(q){ return { x: q[0], y: q[1] }; });
}
function bridgeHole(outer, hole, obstacles){
  var mi = 0;
  for (var i = 1; i < hole.length; i++) if (hole[i].x > hole[mi].x) mi = i;
  var M = hole[mi];
  var order = outer.map(function(v, i){ return i; }).sort(function(a, b){
    var da = (outer[a].x - M.x) * (outer[a].x - M.x) + (outer[a].y - M.y) * (outer[a].y - M.y);
    var db = (outer[b].x - M.x) * (outer[b].x - M.x) + (outer[b].y - M.y) * (outer[b].y - M.y);
    return da - db;
  });
  var polys = [outer, hole].concat(obstacles);
  for (var oi = 0; oi < order.length; oi++) {
    var vi = order[oi], V = outer[vi], ok = true;
    for (var pi = 0; pi < polys.length && ok; pi++) {
      var pl = polys[pi];
      for (var e = 0; e < pl.length; e++) {
        var a = pl[e], b = pl[(e + 1) % pl.length];
        if (a === V || b === V || a === M || b === M) continue;
        if (segmentsCross(M, V, a, b)) { ok = false; break; }
      }
    }
    if (!ok) continue;
    var mid = { x: (M.x + V.x) / 2, y: (M.y + V.y) / 2 };
    if (!pointInPoly(mid, outer)) continue;
    var dx = V.x - M.x, dy = V.y - M.y, len = Math.hypot(dx, dy) || 1, eps = 1e-3;
    var nx = -dy / len * eps, ny = dx / len * eps;
    var holeLoop = hole.slice(mi).concat(hole.slice(0, mi)); // starts at M
    var merged = outer.slice(0, vi + 1)
      .concat(holeLoop.map(function(p){ return { x: p.x, y: p.y }; }))
      .concat([{ x: M.x + nx, y: M.y + ny }, { x: V.x + nx, y: V.y + ny }])
      .concat(outer.slice(vi + 1));
    return merged;
  }
  return null;
}
function decomposeSolid(poly, expectedArea){
  var P = poly.map(function(p){ return [p.x, p.y]; });
  decomp.makeCCW(P);
  var B = decomp.quickDecomp(P);
  var sumArea = B.reduce(function(s, part){ return s + Math.abs(polySignedArea(part.map(function(pt){ return { x: pt[0], y: pt[1] }; }))); }, 0);
  if (B.length > 0 && B.length <= 40 && Math.abs(sumArea - expectedArea) < expectedArea * 0.05) {
    return B.map(function(part){ return part.map(function(pt){ return { x: pt[0], y: pt[1] }; }); });
  }
  return null;
}

function buildCharCache(d){
  var cx = d.cx, cy = d.cy, scale = d.scale;
  var normPolys = d.polygons.map(function(poly){
    return poly.map(function(pt){
      return { x: (pt.x - cx) / scale, y: -(pt.y - cy) / scale }; // flip y: font space is y-up, our world is y-down
    });
  }).filter(function(poly){ return poly.length >= 3 && Math.abs(polySignedArea(poly)) > 2e-3; }); // drops specks under ~2px^2, which decompose into degenerate (zero-mass) parts
  var path2d = new Path2D(d.path);
  FILL_TEST_CTX.lineWidth = 2 * GLYPH_BOLD * scale; FILL_TEST_CTX.lineJoin = 'round'; FILL_TEST_CTX.lineCap = 'round';
  var holeFlag = normPolys.map(function(poly){
    var A = polySignedArea(poly), n = poly.length, filled = 0, empty = 0;
    var stepN = Math.max(1, Math.floor(n / 24));
    for (var i = 0; i < n; i += stepN) {
      var a = poly[i], b = poly[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      var dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      var nx = A > 0 ? -dy : dy, ny = A > 0 ? dx : -dx, eps = 0.04;
      var pt = { x: (a.x + b.x) / 2 + nx * eps, y: (a.y + b.y) / 2 + ny * eps };
      if (!pointInPoly(pt, poly)) continue;
      var fx = pt.x * scale + cx, fy = cy - pt.y * scale;
      if (FILL_TEST_CTX.isPointInPath(path2d, fx, fy, 'nonzero') || FILL_TEST_CTX.isPointInStroke(path2d, fx, fy)) filled++; else empty++;
    }
    return empty > filled;
  });
  var outers = [], holesOf = {};
  normPolys.forEach(function(poly, i){ if (!holeFlag[i]) { outers.push(i); holesOf[i] = []; } });
  normPolys.forEach(function(poly, i){
    if (!holeFlag[i]) return;
    var best = -1, bestA = Infinity;
    outers.forEach(function(o){
      if (pointInPoly(poly[0], normPolys[o])) {
        var A = Math.abs(polySignedArea(normPolys[o]));
        if (A < bestA) { bestA = A; best = o; }
      }
    });
    if (best >= 0) holesOf[best].push(i);
  });
  var parts = [], stats = { holes: 0, bridged: 0, fallback: 0 };
  outers.forEach(function(o){
    var outer = cleanContour(normPolys[o]);
    if (polySignedArea(outer) < 0) outer.reverse();
    var holes = holesOf[o].map(function(h){
      var hp = cleanContour(normPolys[h]);
      if (polySignedArea(hp) > 0) hp.reverse(); // opposite winding to the outer
      return hp;
    });
    stats.holes += holes.length;
    var solidArea = Math.abs(polySignedArea(outer)) - holes.reduce(function(s, h){ return s + Math.abs(polySignedArea(h)); }, 0);
    var merged = outer, allBridged = true;
    holes.slice().sort(function(a, b){
      return Math.max.apply(null, b.map(function(p){ return p.x; })) - Math.max.apply(null, a.map(function(p){ return p.x; }));
    }).forEach(function(h, k, arr){
      if (!allBridged) return;
      var others = arr.filter(function(x){ return x !== h; });
      var m = bridgeHole(merged, h, others);
      if (m) merged = m; else allBridged = false;
    });
    var res = null;
    if (allBridged) { res = decomposeSolid(merged, solidArea); if (res && holes.length) stats.bridged += holes.length; }
    if (!res) {
      if (holes.length) stats.fallback++;
      res = decomposeSolid(outer, Math.abs(polySignedArea(outer)));
      if (!res) res = [Vertices.hull(outer.map(function(p){ return { x: p.x, y: p.y }; }))];
    }
    parts = parts.concat(res);
  });
  var A = 0, gx = 0, gy = 0;
  parts.forEach(function(pt){
    var a = polySignedArea(pt), c = Vertices.centre(pt);
    a = Math.abs(a); A += a; gx += c.x * a; gy += c.y * a;
  });
  var G = { x: gx / A, y: gy / A };
  var shift = function(p){ return { x: p.x - G.x, y: p.y - G.y }; };
  return {
    ch: d.ch,
    normPolys: normPolys.map(function(poly){ return poly.map(shift); }),
    decomposedParts: parts.map(function(pt){ return pt.map(shift); }),
    stats: stats,
    path2d: new Path2D(d.path),
    pathCx: cx + G.x * scale, pathCy: cy - G.y * scale, pathScale: scale
  };
}
CHAR_DATA.forEach(function(d){ charCache[d.ch] = buildCharCache(d); });

