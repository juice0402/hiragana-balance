// ---------- audio: short SFX tones + embedded background music ----------
var audioCtx = null;
function getAudioCtx(){
  if (!audioCtx) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(removeUnlockListeners);
  }
  return audioCtx;
}
function playTone(freqStart, freqEnd, duration, volume, waveType){
  var ctx = getAudioCtx();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = waveType || 'sine';
  var now = ctx.currentTime;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}
function sfxGrab(){ playTone(520, 720, 0.11, 0.16, 'sine'); }
function sfxRotate(){ playTone(650, 520, 0.09, 0.11, 'triangle'); }
function sfxButton(){ playTone(480, 380, 0.08, 0.13, 'sine'); }
// メダルの音（あそびトークがメダルを記録したとき、外のページから知らせが来る。外のページは音を出す許可がないことがあるので、ここで鳴らす）
function sfxCoin(k){ playTone(988 * k, 988 * k, 0.07, 0.07, 'square'); setTimeout(function(){ playTone(1319 * k, 1319 * k, 0.34, 0.06, 'square'); }, 70); }
function sfxMedals(n){
  n = Math.max(1, Math.min(10, Math.floor(+n) || 1));
  var gap = n >= 6 ? 95 : 120; // 外のページの数えあげと同じ間かく
  for (var i = 0; i < n; i++) (function(i){ setTimeout(function(){ sfxCoin(1 + i * 0.03); }, i * gap); })(i);
  var end = n * gap + 120;
  if (n >= 3) [1046, 1318, 1568, 2093].forEach(function(f, k){ setTimeout(function(){ playTone(f, f, 0.24, 0.08, 'triangle'); }, end + k * 70); });
  if (n >= 10) [1568, 2093, 2637, 3136].forEach(function(f, k){ setTimeout(function(){ playTone(f, f * 1.01, 0.45, 0.07, 'triangle'); }, end + 420 + k * 90); });
}
window.addEventListener('message', function(e){
  var d = e.data;
  if (window.parent === window || e.source !== window.parent || e.origin !== location.origin) return;
  if (d && d.source === 'asobi-talk' && d.type === 'medals') sfxMedals(d.n);
});
function sfxHanamaru(){ playTone(784, 1046, 0.12, 0.10, 'sine'); setTimeout(function(){ playTone(1046, 1318, 0.16, 0.09, 'sine'); }, 110); }

// ---------- background music (made inside the game with Web Audio — no audio file) ----------
// D major, 62 BPM, 24 bars (A B A'): soft marimba melody, electric piano, bass, plucked arpeggio,
// shaker and pencil taps. Rendered once into an AudioBuffer by an OfflineAudioContext (off the main
// thread), then looped. The same seed gives the same music every time.
var MUTE_KEY = 'hiraganaTowerBattle.muted';
function loadMuted(){
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
}
function saveMuted(v){
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
}
var isMuted = loadMuted();

var bgmStarted = false;

var bgmBuffer = null;
var bgmSource = null;
var bgmGain = null;
var bgmLoading = false;
var bgmLoadCallbacks = []; // callers who arrived while the music was still being made

var BGM_BPM = 62, BGM_RATE = 32000, BGM_TAIL = 3;
var BGM_TARGET_RMS = 0.092; // loudness of the old file, so the 0.09 gain in startBgm stays right

function bgmCompose(){
  var spb = 60 / BGM_BPM;
  var seed = 20261106;
  function rnd(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  var VOICE = { D:[54,57,62], Em:[55,59,64], Em7:[55,59,62,64], A:[52,57,61], G:[55,59,62], Gmaj7:[55,59,62,66],
                Bm:[54,59,62], Fsm:[54,57,61] };
  var ROOT = { D:50, Em:40, Em7:40, A:45, G:43, Gmaj7:43, Bm:47, Fsm:42 };
  var A_CH  = ['D','D','Em','A','D','G',['Em','A'],'D'];
  var B_CH  = ['Gmaj7','A','Fsm','Bm','Gmaj7','A','Em7','A'];
  var A2_CH = ['D','Bm','G','A','D','G',['Em','A'],'D'];
  var MEL_A = [
    [[0,1,69],[1,.5,66],[1.5,.5,69],[2,1.5,74],[3.5,.5,73]],
    [[0,1,71],[1,1,69],[2,2,66]],
    [[0,1,67],[1,.5,66],[1.5,.5,67],[2,1,71],[3,1,76]],
    [[0,1.5,73],[1.5,.5,71],[2,2,69]],
    [[0,1,66],[1,.5,69],[1.5,.5,74],[2,1,78],[3,1,76]],
    [[0,1,74],[1,1,71],[2,1.5,67],[3.5,.5,69]],
    [[0,1,71],[1,1,67],[2,1,69],[3,.5,71],[3.5,.5,73]],
    [[0,3,74]]
  ];
  var MEL_B = [
    [[0,2,71],[2,1,69],[3,1,67]],
    [[0,2,69],[2,1,73],[3,1,76]],
    [[0,2,73],[2,1,69],[3,1,66]],
    [[0,1.5,66],[1.5,.5,69],[2,2,71]],
    [[0,1,74],[1,1,71],[2,1,67],[3,1,71]],
    [[0,1,73],[1,1,76],[2,2,69]],
    [[0,1,67],[1,1,71],[2,1,76],[3,1,74]],
    [[0,2,73],[2,1,71],[3,1,69]]
  ];
  var MEL_A2 = MEL_A.slice();
  MEL_A2[1] = [[0,1,71],[1,1,74],[2,2,66]];
  MEL_A2[2] = [[0,1,67],[1,.5,69],[1.5,.5,71],[2,1,74],[3,1,71]];
  MEL_A2[7] = [[0,2,74],[2,1,73],[3,1,71]];
  var SECTIONS = [
    { ch:A_CH,  mel:MEL_A,  vol:1.0,  ep:'half',  arp:0.5, arpFrom:4, perc:4 },
    { ch:B_CH,  mel:MEL_B,  vol:0.95, ep:'whole', arp:1,   perc:0 },
    { ch:A2_CH, mel:MEL_A2, vol:1.05, ep:'half',  arp:0.6, perc:0 }
  ];
  var ev = [];
  function add(inst, beat, dur, midi, vel, jitter){
    var t = beat * spb + (jitter ? (rnd() - 0.5) * jitter : 0);
    ev.push({ inst:inst, t:Math.max(0, t), dur:dur * spb, midi:midi, vel:vel * (0.9 + rnd() * 0.2) });
  }
  var bar = 0;
  SECTIONS.forEach(function(sec){
    for (var i = 0; i < 8; i++, bar++){
      var b0 = bar * 4, v = sec.vol;
      var segs = Array.isArray(sec.ch[i]) ? [[sec.ch[i][0],0,2],[sec.ch[i][1],2,2]] : [[sec.ch[i],0,4]];
      segs.forEach(function(sg){
        var name = sg[0], s = b0 + sg[1], L = sg[2], vc = VOICE[name], r = ROOT[name];
        // electric piano
        if (sec.ep === 'whole') vc.forEach(function(m){ add('ep', s, L, m, 0.34 * v, 0.006); });
        else {
          vc.forEach(function(m){ add('ep', s, Math.min(L, 2), m, 0.5 * v, 0.006); });
          if (L === 4) vc.forEach(function(m){ add('ep', s + 2, 2, m, 0.36 * v, 0.006); });
        }
        // bass: root, then a lower fifth (or upper fifth when that would go too low)
        add('bass', s, Math.min(L, 2) - 0.2, r, 0.85 * v, 0.004);
        if (L === 4) add('bass', s + 2.5, 1.3, r - 5 >= 40 ? r - 5 : r + 7, 0.55 * v, 0.004);
        // plucked arpeggio in eighths
        if (sec.arp && i >= (sec.arpFrom || 0)){
          var tones = vc.slice(0, 3).concat([vc[0] + 12]), pat = [0,1,2,3,2,1,2,1];
          for (var k = 0; k < L * 2; k++) add('pluck', s + k * 0.5, 0.5, tones[pat[k % 8]], (k % 2 ? 0.7 : 1) * sec.arp * v, 0.01);
        }
      });
      // melody
      sec.mel[i].forEach(function(n){ add('mar', b0 + n[0], n[1], n[2], (n[0] % 1 ? 0.8 : 1) * v, 0.008); });
      // shaker and pencil taps (the first bars of the loop stay quiet)
      if (i >= sec.perc){
        var sv = [.55,.9,.65,.95,.55,.9,.65,1];
        for (var e = 0; e < 8; e++) add('shk', b0 + e * 0.5, 0.25, 0, sv[e] * v, 0.012);
        add('tap', b0 + 1, 0.1, 0, 0.8 * v, 0.006);
        add('tap', b0 + 3, 0.1, 0, 0.8 * v, 0.006);
        if (i % 4 === 3) add('tap', b0 + 3.5, 0.1, 0, 0.55 * v, 0.006);
      }
    }
  });
  ev.sort(function(a, b){ return a.t - b.t; });
  return { events:ev, length:bar * 4 * spb };
}

function bgmRender(done){
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) { done(null); return; }
  var song = bgmCompose(), sr = BGM_RATE;
  var loopN = Math.round(song.length * sr), totalN = loopN + BGM_TAIL * sr;
  var oc;
  try { oc = new OAC(1, totalN, sr); } catch (e) { done(null); return; }

  // mix: voices -> dry + reverb -> warm lowpass -> gentle compressor
  var master = oc.createGain(); master.gain.value = 1;
  var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = 0.5;
  var comp = oc.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master.connect(lp); lp.connect(comp); comp.connect(oc.destination);
  var verb = oc.createConvolver(), irN = Math.round(2.2 * sr), ir = oc.createBuffer(1, irN, sr), d = ir.getChannelData(0);
  var s2 = 7, prev = 0;
  for (var i = 0; i < irN; i++){
    s2 = (s2 * 16807) % 2147483647;
    var n = (s2 / 2147483647) * 2 - 1;
    prev = prev * 0.6 + n * 0.4; // a little darker than white noise
    d[i] = i < 0.015 * sr ? 0 : prev * Math.exp(-i / sr / 0.55);
  }
  verb.buffer = ir;
  var wet = oc.createGain(); wet.gain.value = 0.25;
  verb.connect(wet); wet.connect(master);
  var noise = oc.createBuffer(1, Math.round(0.25 * sr), sr), nd = noise.getChannelData(0), s3 = 11;
  for (var j = 0; j < nd.length; j++){ s3 = (s3 * 16807) % 2147483647; nd[j] = (s3 / 2147483647) * 2 - 1; }
  var shkBus = oc.createBiquadFilter(); shkBus.type = 'bandpass'; shkBus.frequency.value = 6500; shkBus.Q.value = 1.1;
  var tapBus = oc.createBiquadFilter(); tapBus.type = 'bandpass'; tapBus.frequency.value = 2400; tapBus.Q.value = 2.5;
  shkBus.connect(master); tapBus.connect(master);
  var shkSend = oc.createGain(); shkSend.gain.value = 0.15; shkBus.connect(shkSend); shkSend.connect(verb);

  function hz(m){ return 440 * Math.pow(2, (m - 69) / 12); }
  function out(node, send){
    node.connect(master);
    if (send){ var g = oc.createGain(); g.gain.value = send; node.connect(g); g.connect(verb); }
  }
  function osc(type, f, t, stop, dest){
    var o = oc.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(t); o.stop(stop); return o;
  }
  var play = {
    mar: function(e){ // soft marimba: round fundamental + a quick wooden overtone
      var f = hz(e.midi), t = e.t, tau = 0.25 + Math.min(e.dur, 2) * 0.35, end = t + tau * 6;
      var g = oc.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.38 * e.vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, tau);
      osc('sine', f, t, end, g);
      var g1 = oc.createGain(); g1.gain.value = 0.12; osc('sine', f * 2, t, end, g1); g1.connect(g);
      var g2 = oc.createGain(); g2.gain.setValueAtTime(0.32 * e.vel, t); g2.gain.setTargetAtTime(0, t, 0.09);
      osc('sine', f * 3.93, t, t + 0.5, g2); g2.connect(g);
      out(g, 0.35);
    },
    ep: function(e){ // electric piano: two-operator FM, brightness fading after the hit
      var f = hz(e.midi), t = e.t, off = t + e.dur, end = off + 1.6;
      var g = oc.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * e.vel, t + 0.012);
      g.gain.setTargetAtTime(0.07 * e.vel, t + 0.012, 0.6);
      g.gain.setTargetAtTime(0, off, 0.3);
      var car = osc('sine', f, t, end, g);
      var mg = oc.createGain(); mg.gain.setValueAtTime(f * 2.0, t); mg.gain.setTargetAtTime(f * 0.6, t, 0.4);
      var mod = osc('sine', f, t, end, mg); mg.connect(car.frequency);
      out(g, 0.3);
    },
    bass: function(e){
      var f = hz(e.midi), t = e.t, off = t + e.dur, end = off + 0.8;
      var g = oc.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.085 * e.vel, t + 0.01);
      g.gain.setTargetAtTime(0.055 * e.vel, t + 0.01, 0.5); g.gain.setTargetAtTime(0, off, 0.12);
      osc('sine', f, t, end, g);
      var h = oc.createGain(); h.gain.value = 0.7; osc('sine', f * 2, t, end, h); h.connect(g);
      var h3 = oc.createGain(); h3.gain.value = 0.3; osc('sine', f * 3, t, end, h3); h3.connect(g);
      out(g, 0);
    },
    pluck: function(e){
      var f = hz(e.midi), t = e.t, end = t + 1.4;
      var flt = oc.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.7;
      flt.frequency.setValueAtTime(2600, t); flt.frequency.setTargetAtTime(700, t, 0.12);
      var g = oc.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09 * e.vel, t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, 0.32);
      osc('triangle', f, t, end, flt); flt.connect(g);
      out(g, 0.4);
    },
    shk: function(e){
      var t = e.t, src = oc.createBufferSource(); src.buffer = noise;
      var g = oc.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4 * e.vel, t + 0.006); g.gain.setTargetAtTime(0, t + 0.006, 0.03);
      src.connect(g); g.connect(shkBus); src.start(t); src.stop(t + 0.2);
    },
    tap: function(e){ // a pencil tapping the desk
      var t = e.t, src = oc.createBufferSource(); src.buffer = noise;
      var g = oc.createGain(); g.gain.setValueAtTime(0.3 * e.vel, t); g.gain.setTargetAtTime(0, t, 0.012);
      src.connect(g); g.connect(tapBus); src.start(t); src.stop(t + 0.1);
      var tg = oc.createGain(); tg.gain.setValueAtTime(0.1 * e.vel, t); tg.gain.setTargetAtTime(0, t, 0.02);
      osc('sine', 900, t, t + 0.12, tg); out(tg, 0.1);
    }
  };

  // Feed the notes a few seconds ahead while rendering, so the graph stays small.
  var evs = song.events, idx = 0, CH = 2;
  function feed(upTo){ while (idx < evs.length && evs[idx].t < upTo){ play[evs[idx].inst](evs[idx]); idx++; } }
  if (typeof oc.suspend === 'function'){
    feed(CH * 1.5);
    var q = 128 / sr;
    for (var st = CH; st < song.length; st += CH){
      (function(at){
        oc.suspend(at).then(function(){ feed(at + CH * 1.5); oc.resume(); });
      })(Math.floor(st / q) * q);
    }
  } else feed(Infinity);

  var finish = function(rendered){
    try {
      var src = rendered.getChannelData(0), loop = new Float32Array(loopN), sum = 0, peak = 0;
      for (var a = 0; a < loopN; a++){
        var x = src[a] + (a < totalN - loopN ? src[loopN + a] : 0); // fold the reverb tail into the start: seamless loop
        loop[a] = x; sum += x * x; var ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
      }
      var gain = BGM_TARGET_RMS / Math.sqrt(sum / loopN || 1);
      if (peak * gain > 0.95) gain = 0.95 / peak;
      for (var b = 0; b < loopN; b++) loop[b] *= gain;
      var buf = oc.createBuffer(1, loopN, sr);
      if (buf.copyToChannel) buf.copyToChannel(loop, 0); else buf.getChannelData(0).set(loop);
      done(buf);
    } catch (e) { done(null); }
  };
  try {
    var p = oc.startRendering();
    if (p && typeof p.then === 'function') p.then(finish, function(){ done(null); });
    else oc.oncomplete = function(ev){ finish(ev.renderedBuffer); };
  } catch (e) { done(null); }
}

function ensureBgmLoaded(cb){
  if (bgmBuffer) { cb(); return; }
  bgmLoadCallbacks.push(cb);
  if (bgmLoading) return; // already being made — cb will fire when it is ready
  bgmLoading = true;
  bgmRender(function(buf){
    bgmLoading = false;
    var pending = bgmLoadCallbacks;
    bgmLoadCallbacks = [];
    if (!buf) return;
    bgmBuffer = buf;
    pending.forEach(function(fn){ fn(); });
  });
}
// make the music while the title screen is showing, so it is ready when play starts
setTimeout(function(){ ensureBgmLoaded(function(){}); }, 500);

function startBgm(){
  if (bgmStarted || isMuted) return;
  var ctx = getAudioCtx();
  if (!ctx) return;
  bgmStarted = true;
  ensureBgmLoaded(function(){
    if (isMuted || bgmSource) return; // may have been toggled off while decoding
    bgmSource = ctx.createBufferSource();
    bgmSource.buffer = bgmBuffer;
    bgmSource.loop = true;
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.09;
    bgmSource.connect(bgmGain);
    bgmGain.connect(ctx.destination);
    bgmSource.start(0);
  });
}
function stopBgm(){
  if (bgmSource) {
    try { bgmSource.stop(0); } catch (e) { /* already stopped */ }
    bgmSource.disconnect();
    bgmSource = null;
  }
  bgmStarted = false;
}

