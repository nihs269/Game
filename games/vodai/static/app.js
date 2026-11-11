(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true, touch: false };
  try { ui.sound = localStorage.getItem('vodai_sound') !== '0'; } catch (e) { /* bỏ qua */ }
  try { ui.touch = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const FATAL_NAMES = { uppercut: '💥 Móc hàm lên trời!', lightning: '⚡ Sét đánh thành tro!', inferno: '🔥 Thiêu rụi!' };

  // ---------------------------------------------------------------- tiện ích
  const bubbles = new window.ChatBubbles({ anchor: (pid) => anchorEl(pid) });
  const htmlCache = new Map();
  function setHTML(el, html) {
    if (!el || htmlCache.get(el) === html) return false;
    htmlCache.set(el, html);
    el.innerHTML = html;
    return true;
  }
  const player = (id) => (S && S.players.find((p) => p.id === id)) || null;
  const nm = (id) => { const p = player(id); return p ? p.name : '?'; };
  const who = (id) => (S && id === S.me.id ? 'Bạn' : esc(nm(id)));
  const send = (action, data) => conn && conn.send(action, data);
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const r1 = (v) => Math.round(v * 10) / 10;
  const sideOf = (pid) => (S ? S.fighters.indexOf(pid) : -1);
  const colorOf = (pid) => (S && sideOf(pid) >= 0 ? S.colors[sideOf(pid)] : '#f5c542');
  function anchorEl(pid) {
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);

  // ---------------------------------------------------------------- âm thanh
  let actx = null;
  function audio() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(notes) {
    if (!ui.sound) return;
    try {
      const a = audio();
      let t = a.currentTime;
      notes.forEach(([freq, dur, type = 'sine', vol = 0.08, slide]) => {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(a.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (e) { /* bỏ qua */ }
  }
  let noiseBuf = null;
  function noise(dur, vol, freq, type = 'lowpass') {
    if (!ui.sound) return;
    try {
      const a = audio();
      if (!noiseBuf) {
        noiseBuf = a.createBuffer(1, a.sampleRate * 0.6, a.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = a.createBufferSource(); src.buffer = noiseBuf;
      const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = a.createGain(); const t = a.currentTime;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(a.destination);
      src.start(t); src.stop(t + dur);
    } catch (e) { /* bỏ qua */ }
  }
  const SOUNDS = {
    swing: () => noise(0.12, 0.05, 2200, 'bandpass'),
    hit: () => { noise(0.16, 0.22, 800); beep([[160, 0.12, 'sine', 0.15, 60]]); },
    heavy: () => { noise(0.3, 0.3, 500); beep([[120, 0.25, 'sine', 0.2, 40]]); },
    block: () => { beep([[1400, 0.05, 'square', 0.035], [900, 0.08, 'triangle', 0.04]]); noise(0.06, 0.06, 3000, 'highpass'); },
    fire: () => { beep([[200, 0.25, 'sawtooth', 0.05, 600]]); noise(0.3, 0.06, 1200, 'bandpass'); },
    spear: () => { beep([[900, 0.12, 'sawtooth', 0.04, 300]]); noise(0.1, 0.05, 4000, 'highpass'); },
    jump: () => beep([[380, 0.08, 'triangle', 0.035, 700]]),
    land: () => noise(0.07, 0.06, 300),
    ko: () => { noise(0.5, 0.3, 300); beep([[220, 0.3, 'sawtooth', 0.08, 55]]); },
    tick: () => beep([[880, 0.06, 'square', 0.04]]),
    bell: () => beep([[1320, 0.6, 'triangle', 0.09], [1320, 0.6, 'triangle', 0.05]]),
    fatal: () => beep([[110, 0.5, 'sawtooth', 0.08, 55], [82, 0.8, 'sawtooth', 0.08, 41]]),
    thunder: () => { noise(0.9, 0.4, 700); beep([[90, 0.6, 'sawtooth', 0.08, 40]]); },
    burn: () => noise(1.5, 0.14, 900, 'bandpass'),
    win: () => beep([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]),
  };
  const play = (k) => { if (ui.sound && SOUNDS[k]) SOUNDS[k](); };
  // Giọng xướng ngôn kiểu Mortal Kombat (đọc tiếng Anh, trầm).
  function say(text, delayMs = 0) {
    if (!ui.sound || !window.speechSynthesis) return;
    setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const v = voices.find((x) => /^en[-_](US|GB)/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
        if (v) u.voice = v;
        u.lang = v ? v.lang : 'en-US'; u.pitch = 0.3; u.rate = 0.85; u.volume = 1;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch (e) { /* bỏ qua */ }
    }, delayMs);
  }

  // ---------------------------------------------------------------- hằng số & đồng hồ
  let W = null;   // thế giới (máy chủ gửi)
  let MV = null;  // bảng đòn
  const perf = () => performance.now() / 1000;
  const clk = { off: null };
  // Lệch giờ máy chủ: lấy mẫu có độ trễ thấp nhất, trôi chậm theo mẫu mới.
  function clockSample(serverT) {
    const s = serverT - perf();
    if (clk.off === null || s > clk.off) clk.off = s;
    else clk.off += (s - clk.off) * 0.02;
  }
  const srv = () => perf() + (clk.off || 0);
  const INTERP = 0.05;   // hiển thị đối thủ trễ 50 ms để nội suy mượt (máy chủ phát 60 lần/giây)

  // ---------------------------------------------------------------- điều khiển
  const keys = { left: false, right: false, up: false, down: false, block: false };
  const hist = [];   // lịch sử hướng bấm để nhận tuyệt chiêu: { d: 'down' | 'fwd' | 'back', t }
  const KEYMAP = {
    a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'up', arrowup: 'up', ' ': 'up',
    s: 'down', arrowdown: 'down', l: 'block', c: 'block', shift: 'block',
  };
  const ACTMAP = { j: 'P', z: 'P', k: 'K', x: 'K', u: 'sp0', i: 'sp1', o: 'sp2', f: 'fatal' };
  const mySpecials = () => { const c = S && charInfo(charOf(S.me.id)); return c ? c.moves : ['fireball', 'spear', 'fkick']; };

  function dirPress(d) {
    if (!me) return;
    const t = perf();
    if (d === 'left' || d === 'right') hist.push({ d: (d === 'right' ? 1 : -1) === me.face ? 'fwd' : 'back', t });
    else if (d === 'down') hist.push({ d: 'down', t });
    else if (d === 'up') me.jumpAt = t;
    while (hist.length > 8) hist.shift();
  }
  function action(a) {
    if (!S || S.phase !== 'play' || !S.me.fighter || !me) return;
    if (a === 'fatal') { tryFatal(); return; }
    me.req = { a, t: perf() };
  }
  function tryFatal() {
    if (S.rstate !== 'finish' || S.winner !== S.me.id) return;
    const o = view.disp[S.loser];
    if (o && Math.abs(o.x - me.x) > S.fatalRange) { P.toast('Lại gần đối thủ hơn chút nữa rồi bấm F!', 'error'); return; }
    send('fatality');
  }

  // ---------------------------------------------------------------- võ sĩ của mình (trình duyệt tự mô phỏng)
  const DT = 1 / 120;
  let me = null;
  function resetMe(fromServer) {
    const side = S.me.side;
    me = {
      g: S.matchNo, r: S.round, lt: perf(), x: W.START[side], y: 0, vx: 0, vy: 0, face: side === 0 ? 1 : -1,
      move: null, n: me && me.g === S.matchNo ? me.n : 0, block: false, crouch: false, walk: 0,
      stunUntil: 0, blockedUntil: 0, down: null, downUntil: 0, dizzy: false, ko: false, cd: {}, req: null, jumpAt: -9,
      lastSent: 0, needSync: !!fromServer,
    };
    hist.length = 0;
  }
  const canControl = () => S.rstate === 'fight' || (S.rstate === 'finish' && S.winner === S.me.id);

  function seq(h, pat) {
    let i = 0;
    for (const d of h) { if (d === pat[i]) i++; if (i === pat.length) return true; }
    return false;
  }
  function resolveAttack(a, t) {
    const ready = (k) => t >= (me.cd[k] || 0);
    if (a === 'P' || a === 'K') {
      if (me.y > 0) return a === 'P' ? 'apunch' : 'akick';
      const h = hist.filter((x) => perf() - x.t < 0.5).map((x) => x.d);
      const sp = mySpecials();
      if (a === 'P' && seq(h, ['down', 'fwd']) && ready(sp[0])) return sp[0];
      if (a === 'P' && seq(h, ['back', 'fwd']) && ready(sp[1])) return sp[1];
      if (a === 'K' && seq(h, ['fwd', 'fwd']) && ready(sp[2])) return sp[2];
      if (keys.down) return a === 'P' ? 'upper' : 'sweep';
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const o = oppDisp();
      if (a === 'K' && dir === -me.face) return 'round';
      if (a === 'P' && o && Math.abs(o.x - me.x) < 78 && o.y <= 2 && !['down', 'ko', 'rise', 'fall'].includes(o.s)
          && (dir === me.face || h.slice(-1)[0] === 'fwd')) return 'throw';
      return a === 'P' ? 'jab' : 'kick';
    }
    const slot = ['sp0', 'sp1', 'sp2'].indexOf(a);
    if (slot < 0 || me.y > 0) return null;
    const mv = mySpecials()[slot];
    if (!ready(mv)) {
      const c = charInfo(charOf(S.me.id));
      P.toast(`${c ? c.sp[slot].join(' ') : MV[mv].name} đang hồi chiêu…`, 'info', 900);
      return null;
    }
    return mv;
  }
  function startMove(mv, t) {
    const m = MV[mv];
    me.n = Math.max(me.n + 1, Date.now());   // tăng dần kể cả khi tải lại trang giữa trận
    me.move = { mv, t0: t, n: me.n, hitSent: false, spawned: false };
    me.block = me.crouch = false;
    me.walk = 0;
    if (m.hop) me.vy = m.hop;
    if (m.cd) me.cd[mv] = t + m.cd;
    if (m.special) hist.length = 0;
    if (!m.proj) play('swing');
  }

  function myState(t) {
    if (me.ko && me.down !== 'fall') return 'ko';
    if (me.dizzy) return 'dizzy';
    if (me.down) return me.down;
    if (t < me.blockedUntil) return me.crouch ? 'cblock' : 'block';
    if (t < me.stunUntil) return 'hurt';
    if (me.move) return 'atk';
    if (me.y > 0) return 'jump';
    if (me.block) return me.crouch ? 'cblock' : 'block';
    if (me.crouch) return 'crouch';
    if (me.walk) return 'walk';
    return 'idle';
  }

  function simulate(tTo) {
    if (tTo - me.lt > 0.5) me.lt = tTo - 0.5;
    while (me.lt + DT <= tTo) { me.lt += DT; sub(me.lt); }
  }

  function sub(t) {
    if (me.down === 'down' && t >= me.downUntil) { me.down = 'rise'; me.downUntil = t + W.RISE; }
    else if (me.down === 'rise' && t >= me.downUntil) me.down = null;
    const free = !me.down && !me.ko && !me.dizzy && t >= me.stunUntil && t >= me.blockedUntil;
    const fight = S.rstate === 'fight';
    const grounded = me.y <= 0;
    me.walk = 0;
    if (free && canControl()) {
      if (!me.move) {
        me.block = fight && keys.block && grounded;
        me.crouch = fight && keys.down && grounded;
        const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        if (me.req && fight && t - me.req.t < 0.25) {
          const mv = resolveAttack(me.req.a, t);
          me.req = null;
          if (mv) startMove(mv, t);
        } else if (t - me.jumpAt < 0.15 && grounded && !me.block && !me.crouch) {
          me.jumpAt = -9;
          me.vy = W.JUMP; me.vx = dir * W.JUMP_VX;
          play('jump');
        } else if (grounded && !me.block && !me.crouch) {
          me.walk = dir;
        }
      }
    } else if (t >= me.blockedUntil) {
      me.block = false;
      if (!free) me.crouch = false;
    }
    if (me.req && t - me.req.t >= 0.25) me.req = null;
    // đòn đang ra
    if (me.move) {
      const m = MV[me.move.mv];
      const e = t - me.move.t0;
      if (m.dash && e >= m.st && e < m.st + m.ac) me.vx = me.face * m.dash;
      if (m.proj && !me.move.spawned && e >= m.st) {
        me.move.spawned = true;
        send('special', { k: me.move.mv, x: r1(me.x), f: me.face });
        play(me.move.mv === 'spear' ? 'spear' : 'fire');
      }
      if (m.teleport && !me.move.spawned && e >= m.st) {
        me.move.spawned = true;
        teleportMe();
      }
      if (!m.proj && !m.teleport && !me.move.hitSent && e >= m.st && e < m.st + m.ac) checkMyHit(me.move);
      if (e >= m.st + m.ac + m.rc || (m.air && grounded && e > m.st)) me.move = null;
    }
    // vật lý
    if (grounded && me.vy <= 0) {
      if (me.walk && !me.move) me.vx = me.walk * (me.walk === me.face ? W.WALK : W.BACK);
      else if (!(me.move && MV[me.move.mv].dash)) me.vx *= Math.exp(-W.FRICTION * DT);
    }
    me.vy -= W.G * DT;
    me.y += me.vy * DT;
    me.x += me.vx * DT;
    if (me.y <= 0) {
      me.y = 0;
      if (me.vy < 0) {
        if (me.vy < -500) { play('land'); dust(me.x, 4); }
        me.vy = 0;
        if (me.down === 'fall') {
          me.down = 'down';
          me.downUntil = me.ko ? Infinity : t + W.DOWN;
          me.vx *= 0.3;
          dust(me.x, 10); fx.shake = perf(); fx.shakeK = 5;
        }
      }
    }
    me.x = clamp(me.x, W.LEFT, W.RIGHT);
    const o = oppDisp();
    if (o) me.x = clamp(me.x, o.x - W.MAXSEP, o.x + W.MAXSEP);
    if (o) {
      if (Math.abs(me.x - o.x) < W.PUSH && Math.abs(me.y - o.y) < 100 && !me.down && !['down', 'ko', 'fall'].includes(o.s)) {
        const side = me.x !== o.x ? Math.sign(me.x - o.x) : -me.face;
        me.x = clamp(o.x + side * W.PUSH, W.LEFT, W.RIGHT);
      }
      if (me.y <= 0 && !me.move && !me.down && free) me.face = o.x >= me.x ? 1 : -1;
    }
  }

  function oppDisp() {
    if (!S || !S.me.fighter) return null;
    const opp = S.fighters.find((p) => p !== S.me.id);
    return opp ? view.disp[opp] : null;
  }

  function height(s) {
    if (s === 'down' || s === 'ko' || s === 'fall') return W.H_DOWN;
    if (s === 'crouch' || s === 'cblock') return W.H_CROUCH;
    return W.H;
  }
  function reaches(ax, ay, face, mv, o) {
    const m = MV[mv];
    const lo = face > 0 ? ax + 8 : ax - m.reach;
    const hi = face > 0 ? ax + m.reach : ax - 8;
    if (hi < o.x - W.HALF || lo > o.x + W.HALF) return false;
    return ay + m.y0 < o.y + height(o.s) && ay + m.y1 > o.y;
  }
  // Dịch chuyển: hiện ra sau lưng đối thủ (bị tường chặn thì hiện ra phía trước).
  function teleportMe() {
    const o = oppDisp();
    if (!o) return;
    smoke(me.x, me.y);
    const side = Math.sign(o.x - me.x) || me.face;
    let x = o.x + side * 75;
    if (x < W.LEFT || x > W.RIGHT) x = o.x - side * 75;
    me.x = clamp(x, W.LEFT, W.RIGHT); me.y = 0; me.vx = 0; me.vy = 0;
    me.face = o.x >= me.x ? 1 : -1;
    smoke(me.x, 0);
    play('spear');
  }

  function checkMyHit(mv) {
    const o = oppDisp();
    if (!o || ['down', 'ko', 'rise'].includes(o.s)) return;
    if (reaches(me.x, me.y, me.face, mv.mv, o)) {
      mv.hitSent = true;
      send('hit', { mv: mv.mv, n: mv.n });
      // phản hồi ngay (không chờ máy chủ): tiếng + tia lửa; khi máy chủ xác nhận thì không phát lại
      const blk = o.s === 'block' || o.s === 'cblock';
      const x = o.x - me.face * 18;
      sparks(x, me.y + (MV[mv.mv].y0 + MV[mv.mv].y1) / 2, blk ? '#9fe3ff' : '#fff3a0', 8, 380);
      play(blk ? 'block' : MV[mv.mv].down ? 'heavy' : 'hit');
      fx.shake = perf(); fx.shakeK = blk ? 2 : 4;
      predictedAt = perf();
    }
  }

  // Bị đánh trúng (máy chủ báo).
  function applyHitToMe(h) {
    const t = me.lt;
    me.move = null; me.req = null; me.walk = 0;
    if (h.blk) {
      me.blockedUntil = t + h.stun; me.block = true;
      me.vx = h.dir * h.kb;
      return;
    }
    me.block = me.crouch = false;
    if (h.pull !== undefined) { me.x = h.pull; me.vx = 0; }
    me.stunUntil = t + h.stun;
    if (h.finish) { me.dizzy = true; me.vx = h.dir * 220; return; }
    if (h.down || h.ko || me.y > 0) {
      me.down = 'fall';
      me.ko = !!h.ko;
      me.vy = Math.max(h.up, W.FALL_UP);
      me.vx = h.dir * Math.max(h.kb, 200);
    } else {
      me.vx = h.dir * h.kb;
      if (h.up) me.vy = h.up;
    }
  }

  // ---------------------------------------------------------------- võ sĩ khác (nội suy từ máy chủ)
  const remote = new Map();   // pid → [{t, r, x, y, vx, vy, face, s, m, e, b}]
  const hp = {};
  const ghost = {};           // thanh máu "bóng" trôi chậm
  const flashAt = {};
  let projs = [];
  let projT = 0;

  function onFight(m) {
    if (!S || m.g !== S.matchNo) return;
    clockSample(m.ts);
    for (const [pid, v] of Object.entries(m.f)) {
      hp[pid] = v[9];
      if (S.me.fighter && pid === S.me.id) {
        if (me && me.needSync && m.r === me.r) { me.needSync = false; me.x = v[0]; me.y = v[1]; me.face = v[4]; }
        continue;
      }
      let buf = remote.get(pid);
      if (!buf) { buf = []; remote.set(pid, buf); }
      const last = buf[buf.length - 1];
      const st = v[10] || m.ts;   // thời điểm mẫu vị trí được ghi
      if (last && last.r !== m.r) buf.length = 0;
      else if (last && st <= last.t) continue;
      else if (last && Math.abs(v[0] - last.x) > 140 && v[6] === 'teleport') { smoke(last.x, last.y); smoke(v[0], 0); buf.length = 0; }
      buf.push({ t: st, r: m.r, x: v[0], y: v[1], vx: v[2], vy: v[3], face: v[4], s: v[5], m: v[6], e: v[7], b: v[8] });
      if (buf.length > 60) buf.shift();
    }
    projs = m.p;
    projT = m.ts;
  }

  function remoteView(pid, at) {
    const buf = remote.get(pid);
    if (!buf || !buf.length) return null;
    const rt = at - INTERP;
    const snap = (a, x, y, extra = 0) => ({ x, y, face: a.face, s: a.s, m: a.m, e: a.m ? Math.max(0, a.e + extra) : 0, vy: a.vy, vx: a.vx });
    let a = buf[0];
    if (rt <= a.t) return snap(a, a.x, a.y);
    for (let k = 1; k < buf.length; k++) {
      const b = buf[k];
      if (rt <= b.t) {
        const f = (rt - a.t) / (b.t - a.t || 1);
        const d = f < 0.5 ? a : b;
        return snap(d, lerp(a.x, b.x, f), lerp(a.y, b.y, f), rt - d.t);
      }
      a = b;
    }
    const dt = Math.min(0.2, rt - a.t);
    const y = a.y > 0 ? Math.max(0, a.y + a.vy * dt - W.G * dt * dt / 2) : 0;
    return snap(a, clamp(a.x + a.vx * dt, W.LEFT, W.RIGHT), y, dt);
  }

  // ---------------------------------------------------------------- hiệu ứng
  const fx = { shake: 0, shakeK: 0, flash: 0 };
  const parts = [];           // hạt: tia lửa, bụi, số sát thương…
  let combo = null;           // { pid, n, at }
  function addPart(p) { parts.push({ born: perf(), ...p }); if (parts.length > 220) parts.shift(); }
  const frozenUntil = {};     // pid → lúc tan băng (trúng Cầu băng)
  const stains = [];          // vết máu đọng trên sàn (xoá khi sang hiệp mới) — vẽ bằng 3D
  function dust(x, n) {
    for (let k = 0; k < n; k++) addPart({ kind: 'dust', x: x + (Math.random() - 0.5) * 40, y: 2, vx: (Math.random() - 0.5) * 160, vy: 40 + Math.random() * 80, life: 0.5, r: 6 + Math.random() * 6 });
  }
  function sparks(x, y, color, n, spd = 420) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.4 + Math.random() * 0.8);
      addPart({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.28 + Math.random() * 0.2, color });
    }
    addPart({ kind: 'ring', x, y, life: 0.25, color });
  }
  function stars(x, y, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      addPart({ kind: 'star', x, y, vx: Math.cos(a) * 220, vy: 120 + Math.sin(a) * 200, life: 0.7, color: ['#ffe066', '#ff9ecb', '#9ee7ff'][k % 3] });
    }
  }

  const trainCombo = { n: 0, dmg: 0 };
  let predictedAt = -9;       // lúc mình tự phát hiệu ứng trúng đòn (chờ máy chủ xác nhận)
  function onHit(h) {
    if (!S || h.g !== S.matchNo) return;
    if (S.practice && h.a === S.me.id) {
      if (h.combo <= 1) { trainCombo.n = 0; trainCombo.dmg = 0; }
      if (!h.blk) trainCombo.n += 1;
      trainCombo.dmg += h.dmg;
    }
    hp[h.v] = h.hp;
    flashAt[h.v] = perf();
    const x = h.x - h.dir * 18;
    // đòn tay chân của chính mình đã tự phát tiếng + tia lửa lúc chạm (xem checkMyHit) → không phát lại
    const predicted = h.a === S.me.id && !(MV[h.mv] && MV[h.mv].proj) && perf() - predictedAt < 0.5;
    if (predicted) predictedAt = -9;
    if (h.blk) {
      if (!predicted) { sparks(x, h.y, '#9fe3ff', 8, 300); play('block'); }
    } else {
      const big = h.ko || h.down || h.dmg >= 10;
      const ice = MV[h.mv] && MV[h.mv].freeze;
      if (ice) frozenUntil[h.v] = perf() + h.stun;
      if (!predicted || big) sparks(x, h.y, ice ? '#bfe8ff' : MV[h.mv] && MV[h.mv].proj ? '#ff9a3c' : '#fff3a0', big ? 16 : 10, big ? 560 : 420);
      for (let k = 0; k < (big ? 18 : 8); k++) {
        addPart({ kind: 'blood', x, y: h.y, vx: h.dir * (40 + Math.random() * 340), vy: 40 + Math.random() * 320, life: 1.3, r: 1.8 + Math.random() * 3.4 });
      }
      if (h.ko) play('ko'); else if (!predicted) play(big ? 'heavy' : 'hit');
      fx.shake = perf(); fx.shakeK = h.ko ? 12 : big ? 7 : 3;
      if (h.ko) fx.flash = perf();
      if (h.combo >= 2) combo = { pid: h.a, n: h.combo, at: perf() };
      if (h.combo === 3) say('Excellent!'); else if (h.combo === 5) say('Outstanding!');
      if (h.mv === 'spear' && charOf(h.a) === 'scorpion') say('Get over here!');
    }
    if (S.me.fighter && h.v === S.me.id && me && me.g === h.g && me.r === h.r) applyHitToMe(h);
  }
  function onClash(m) {
    if (!S || m.g !== S.matchNo) return;
    sparks(m.x, m.y, '#ffb347', 18, 500);
    play('heavy');
  }

  // ---------------------------------------------------------------- vẽ: khung hình
  const cv = $('#cv');
  let ctx = cv.getContext('2d');   // đổi tạm sang canvas khác khi vẽ ảnh chân dung
  const view = { s: 1, dpr: 1, ox: 0, oy: 0, cssW: 0, cssH: 0, disp: {}, cam: { z: 1, x: 0 } };
  // Toạ độ sân đấu → điểm ảnh CSS trên canvas (đã tính camera).
  const toScreen = (x, y) => [((x - view.cam.x) * view.cam.z + view.ox) * view.s, ((y - W.FLOOR) * view.cam.z + W.FLOOR + view.oy) * view.s];
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width || !r.height || !W) return;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const s = Math.min(r.width / W.W, r.height / W.H_VIEW);
    Object.assign(view, { s, dpr, cssW: r.width, cssH: r.height, ox: (r.width / s - W.W) / 2, oy: (r.height / s - W.H_VIEW) / 2 });
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
  window.addEventListener('resize', resize);

  const FONT = '"Oswald", "Baloo 2", system-ui, sans-serif';
  if (document.fonts) document.fonts.load('700 20px "Oswald"').catch(() => {});
  const LINE = '#120a0e';
  function mixc(hex, k, to = 255) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (to - v) * k), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const dark = (hex, k) => mixc(hex, k, 0);
  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function blob(path, fill, line, lw) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(); ctx.lineWidth = lw * 2; ctx.strokeStyle = line; ctx.stroke();
    path(); ctx.fillStyle = fill; ctx.fill();
  }
  function sparkle(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.6); ctx.quadraticCurveTo(x, y, x + s * 1.6, y); ctx.quadraticCurveTo(x, y, x, y + s * 1.6);
    ctx.quadraticCurveTo(x, y, x - s * 1.6, y); ctx.quadraticCurveTo(x, y, x, y - s * 1.6);
    ctx.fill();
  }

  // ---------------------------------------------------------------- vẽ: sàn đấu (3 cảnh)
  const EMBERS = Array.from({ length: 34 }, (_, i) => ({ x: (i * 137) % 1100 - 50, y: (i * 89) % 600, s: 0.6 + (i % 5) / 5, sp: 25 + (i * 7) % 35, ph: i * 1.7 }));
  const STARS = Array.from({ length: 50 }, (_, i) => ({ x: (i * 211) % 1200 - 100, y: (i * 97) % 300 - 60, r: 0.6 + (i % 3) * 0.5, ph: i }));
  const STAGES = [
    { sky: ['#140306', '#5a0d10', '#c43d1a'], far: '#2b0a10', near: '#14050a', floor: ['#3a2b28', '#271d1b', '#120d0c'], line: 'rgba(0,0,0,.5)' },
    { sky: ['#02040a', '#0a1822', '#1c3540'], far: '#0b181d', near: '#060e11', floor: ['#3a291c', '#291c13', '#130d09'], line: 'rgba(0,0,0,.55)' },
    { sky: ['#070404', '#1a0b07', '#3d150a'], far: '#1d0e0a', near: '#110705', floor: ['#2d2521', '#201a17', '#110d0b'], line: 'rgba(0,0,0,.6)' },
    { sky: ['#05040c', '#1a1430', '#3a2a4a'], far: '#120c1c', near: '#0a0710', floor: ['#5a5552', '#45403d', '#2a2624'], line: 'rgba(0,0,0,.5)' },
  ];

  function drawStage(now, bgOnly) {
    const st = STAGES[S.stage] || STAGES[0];
    const x0 = -view.ox; const x1 = W.W + view.ox; const y0 = -view.oy; const y1 = W.H_VIEW + view.oy;
    const F = W.FLOOR;
    const sky = ctx.createLinearGradient(0, y0, 0, F);
    sky.addColorStop(0, st.sky[0]); sky.addColorStop(0.6, st.sky[1]); sky.addColorStop(1, st.sky[2]);
    ctx.fillStyle = sky; ctx.fillRect(x0, y0, x1 - x0, F - y0);
    if (S.stage === 0) {
      // mặt trời đỏ thẫm lặn sau đền
      const g = ctx.createRadialGradient(500, F - 120, 20, 500, F - 120, 330);
      g.addColorStop(0, 'rgba(255,140,60,.55)'); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, F - y0);
      ctx.fillStyle = '#ff7a3a'; ctx.beginPath(); ctx.arc(500, F - 130, 95, 0, 7); ctx.fill();
      mountains(x0, x1, F - 40, 190, st.far, 3);
      pagoda(500, F - 30);
      mountains(x0, x1, F - 20, 90, st.near, 7);
      deadTree(95, F - 26, 1); deadTree(915, F - 26, -1);
    } else if (S.stage === 1) {
      STARS.forEach((s) => { ctx.fillStyle = `rgba(220,235,255,${0.3 + 0.35 * Math.sin(now * 2 + s.ph)})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); });
      const g = ctx.createRadialGradient(760, 105, 30, 760, 105, 170);
      g.addColorStop(0, 'rgba(200,225,255,.35)'); g.addColorStop(1, 'rgba(200,225,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(760, 105, 170, 0, 7); ctx.fill();
      ctx.fillStyle = '#dfe8f0'; ctx.beginPath(); ctx.arc(760, 105, 46, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(150,170,190,.5)';
      ctx.beginPath(); ctx.arc(744, 92, 9, 0, 7); ctx.arc(778, 118, 7, 0, 7); ctx.arc(770, 88, 4, 0, 7); ctx.fill();
      mountains(x0, x1, F - 30, 150, st.far, 5);
      bamboo(now, x0, x1, F);
      mist(now, x0, x1, F);
      lanterns(now);
    } else if (S.stage === 2) {
      cave(now, x0, x1, y0, F, st);
    } else {
      pit(now, x0, x1, y0, y1, F, st, bgOnly);
      return;
    }
    if (bgOnly) return;
    // sàn đá
    const fl = ctx.createLinearGradient(0, F - 28, 0, y1);
    fl.addColorStop(0, st.floor[0]); fl.addColorStop(0.35, st.floor[1]); fl.addColorStop(1, st.floor[2]);
    ctx.fillStyle = fl; ctx.fillRect(x0, F - 28, x1 - x0, y1 - F + 28);
    ctx.strokeStyle = st.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, F - 28); ctx.lineTo(x1, F - 28); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let k = 0, y = F - 28; y < y1; k++) { y += 10 + k * 9; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    for (let x = -400; x <= 1400; x += 90) {
      ctx.beginPath(); ctx.moveTo(500 + (x - 500) * 0.55, F - 28); ctx.lineTo(500 + (x - 500) * 2.2, y1 + 40); ctx.stroke();
    }
    // vết nứt trên sàn
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
    [[180, F + 20], [640, F + 45], [820, F + 12]].forEach(([cx, cy]) => {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 18, cy + 6); ctx.lineTo(cx + 26, cy + 2); ctx.moveTo(cx + 18, cy + 6); ctx.lineTo(cx + 22, cy + 16); ctx.stroke();
    });
    // ánh sáng dồn vào giữa sàn, viền tối
    const v = ctx.createRadialGradient(500, F - 80, 120, 500, F - 80, 700);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = v; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  // The Pit: cầu đá bắc qua hố chông, trăng tròn sau các tháp canh.
  function pit(now, x0, x1, y0, y1, F, st, bgOnly) {
    const g = ctx.createRadialGradient(560, 120, 20, 560, 120, 260);
    g.addColorStop(0, 'rgba(230,220,255,.35)'); g.addColorStop(1, 'rgba(200,180,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(560, 120, 260, 0, 7); ctx.fill();
    ctx.fillStyle = '#ece6f2'; ctx.beginPath(); ctx.arc(560, 120, 62, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(160,150,180,.45)'; ctx.beginPath(); ctx.arc(540, 105, 12, 0, 7); ctx.arc(585, 138, 9, 0, 7); ctx.fill();
    // mây trôi qua trăng
    ctx.fillStyle = 'rgba(20,14,30,.75)';
    for (let k = 0; k < 4; k++) {
      const cx = ((k * 330 + now * (10 + k * 4)) % 1500) - 250;
      ctx.beginPath(); ctx.ellipse(cx, 70 + k * 38, 120, 14, 0, 0, 7); ctx.ellipse(cx + 60, 62 + k * 38, 70, 12, 0, 0, 7); ctx.fill();
    }
    // tháp canh xa
    ctx.fillStyle = st.far;
    [[120, 260, 60], [300, 200, 44], [780, 240, 54], [920, 300, 70]].forEach(([x, h, w]) => {
      ctx.fillRect(x - w / 2, F - h, w, h);
      for (let k = 0; k < 4; k++) ctx.fillRect(x - w / 2 + k * (w / 3.5), F - h - 12, w / 7, 12);
    });
    ctx.fillStyle = 'rgba(255,170,80,.6)';
    [[120, 200], [780, 180], [920, 230]].forEach(([x, y]) => ctx.fillRect(x - 4, F - y, 8, 12));
    if (bgOnly) return;
    // hố sâu dưới cầu
    const pg = ctx.createLinearGradient(0, F + 20, 0, y1);
    pg.addColorStop(0, '#16121a'); pg.addColorStop(1, '#000');
    ctx.fillStyle = pg; ctx.fillRect(x0, F + 20, x1 - x0, y1 - F);
    // chông nhọn + xương
    for (let row = 0; row < 2; row++) {
      const by = y1 + 10 - row * 26; const sh = 44 - row * 12;
      ctx.fillStyle = row ? '#3a3a40' : '#56565e';
      for (let x = x0 - 20 + row * 14; x < x1 + 30; x += 28) {
        ctx.beginPath(); ctx.moveTo(x - 8, by); ctx.lineTo(x, by - sh); ctx.lineTo(x + 8, by); ctx.closePath(); ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(220,210,190,.6)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    [[180, 0.4], [520, -0.3], [760, 0.2]].forEach(([x, a]) => {
      const yy = y1 - 30;
      ctx.beginPath(); ctx.moveTo(x - 14 * Math.cos(a), yy - 14 * Math.sin(a)); ctx.lineTo(x + 14 * Math.cos(a), yy + 14 * Math.sin(a)); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 20, yy - 4, 6, 0, 7); ctx.stroke();
    });
    // mặt cầu đá + lan can
    const deck = ctx.createLinearGradient(0, F - 24, 0, F + 22);
    deck.addColorStop(0, st.floor[0]); deck.addColorStop(1, st.floor[2]);
    ctx.fillStyle = deck; ctx.fillRect(x0, F - 24, x1 - x0, 46);
    ctx.strokeStyle = st.line; ctx.lineWidth = 1.5;
    for (let x = x0 - (x0 % 60); x < x1; x += 60) { ctx.beginPath(); ctx.moveTo(x, F - 24); ctx.lineTo(x - 8, F + 22); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x0, F - 2); ctx.lineTo(x1, F - 2); ctx.stroke();
    ctx.fillStyle = '#2a2624'; ctx.fillRect(x0, F + 18, x1 - x0, 8);
    ctx.fillStyle = '#4a4542';
    for (let x = x0 - (x0 % 120) + 20; x < x1; x += 120) { ctx.fillRect(x - 6, F - 70, 12, 48); ctx.fillRect(x - 9, F - 76, 18, 8); }
    ctx.fillRect(x0, F - 66, x1 - x0, 6);
    const v = ctx.createRadialGradient(500, F - 80, 120, 500, F - 80, 700);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = v; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  function mountains(x0, x1, base, h, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x0, base);
    for (let x = x0, k = 0; x <= x1 + 60; x += 60, k++) {
      const n = Math.sin(k * 1.7 + seed) * 0.5 + Math.sin(k * 0.6 + seed * 2) * 0.5;
      ctx.lineTo(x + 30, base - h * (0.45 + 0.4 * n) - (k % 2) * h * 0.15);
      ctx.lineTo(x + 60, base - h * (0.3 + 0.25 * Math.cos(k + seed)));
    }
    ctx.lineTo(x1, W.FLOOR); ctx.lineTo(x0, W.FLOOR); ctx.closePath(); ctx.fill();
  }
  function pagoda(x, base) {
    ctx.save();
    ctx.fillStyle = '#0c0306';
    const tiers = [[130, 56], [104, 46], [80, 40]];
    let y = base;
    tiers.forEach(([w, h]) => {
      ctx.fillRect(x - w / 2 + 16, y - h, w - 32, h);
      ctx.fillStyle = 'rgba(255,120,40,.75)';
      ctx.fillRect(x - 7, y - h + 14, 14, h - 22);
      ctx.fillStyle = '#0c0306';
      y -= h;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 - 26, y + 8); ctx.quadraticCurveTo(x - w / 2, y + 2, x - w / 2 + 12, y - 16);
      ctx.lineTo(x + w / 2 - 12, y - 16); ctx.quadraticCurveTo(x + w / 2, y + 2, x + w / 2 + 26, y + 8);
      ctx.closePath(); ctx.fill();
      y -= 16;
    });
    ctx.beginPath(); ctx.moveTo(x, y - 40); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function deadTree(x, base, dir) {
    ctx.save(); ctx.translate(x, base); ctx.scale(dir, 1);
    ctx.strokeStyle = '#0a0204'; ctx.lineCap = 'round';
    ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(14, -90, -6, -190); ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(4, -110); ctx.quadraticCurveTo(50, -140, 70, -200); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, -150); ctx.quadraticCurveTo(-40, -170, -60, -215); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(48, -160); ctx.lineTo(80, -170); ctx.moveTo(-6, -190); ctx.lineTo(10, -240); ctx.moveTo(-40, -175); ctx.lineTo(-75, -180); ctx.stroke();
    ctx.restore();
  }
  function bamboo(now, x0, x1, F) {
    for (let x = x0 + 20, k = 0; x < x1; x += 70, k++) {
      if (x > 260 && x < 740) continue;
      const sw = Math.sin(now * 0.9 + k) * 4;
      ctx.strokeStyle = k % 2 ? '#0f2a1a' : '#143322'; ctx.lineWidth = 12; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(x, F); ctx.quadraticCurveTo(x + sw / 2, F - 250, x + sw, F - 520); ctx.stroke();
      ctx.strokeStyle = '#08170e'; ctx.lineWidth = 2;
      for (let y = F - 60; y > F - 520; y -= 70) { ctx.beginPath(); ctx.moveTo(x - 7 + sw * (F - y) / 520, y); ctx.lineTo(x + 7 + sw * (F - y) / 520, y); ctx.stroke(); }
      ctx.fillStyle = '#16402a';
      for (let y = F - 120; y > F - 480; y -= 110) {
        const lx = x + sw * (F - y) / 520;
        ctx.beginPath(); ctx.ellipse(lx + 18, y - 6, 18, 4, -0.4, 0, 7); ctx.ellipse(lx - 16, y + 4, 16, 3.5, 0.5, 0, 7); ctx.fill();
      }
    }
    for (let k = 0; k < 10; k++) {
      const fx2 = (k * 173 + Math.sin(now * 0.7 + k) * 40) % 1000;
      const fy = F - 60 - ((k * 61) % 260) + Math.cos(now * 1.3 + k) * 20;
      ctx.fillStyle = `rgba(190,255,170,${0.25 + 0.5 * Math.abs(Math.sin(now * 2 + k))})`;
      ctx.beginPath(); ctx.arc(fx2, fy, 2.2, 0, 7); ctx.fill();
    }
  }
  function mist(now, x0, x1, F) {
    for (let k = 0; k < 3; k++) {
      const y = F - 40 - k * 35;
      const off = (now * (8 + k * 5)) % 400;
      ctx.fillStyle = `rgba(150,180,190,${0.07 + k * 0.02})`;
      for (let x = x0 - 400 + off; x < x1 + 200; x += 400) { ctx.beginPath(); ctx.ellipse(x, y, 260, 26, 0, 0, 7); ctx.fill(); }
    }
  }
  function lanterns(now) {
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(240, 40); ctx.quadraticCurveTo(500, 110, 760, 40); ctx.stroke();
    [330, 420, 500, 580, 670].forEach((x, i) => {
      const y = 40 + 70 * (1 - ((x - 500) / 260) ** 2) * 0.95;
      const sw = Math.sin(now * 2 + i) * 0.1;
      ctx.save(); ctx.translate(x, y); ctx.rotate(sw);
      ctx.fillStyle = 'rgba(255,90,40,.18)'; ctx.beginPath(); ctx.arc(0, 26, 34, 0, 7); ctx.fill();
      ctx.fillStyle = '#9a1c1c'; ctx.beginPath(); ctx.ellipse(0, 26, 15, 20, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,170,90,.55)'; ctx.beginPath(); ctx.ellipse(0, 26, 7, 16, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a0a05'; ctx.fillRect(-7, 4, 14, 4); ctx.fillRect(-7, 44, 14, 4);
      ctx.restore();
    });
  }
  function flame(x, y, w, h, now, seed, alpha = 1) {
    const layers = [['255,70,0', 1], ['255,150,20', 0.7], ['255,235,150', 0.4]];
    layers.forEach(([c, s], i) => {
      const fh = h * s * (0.85 + 0.15 * Math.sin(now * 14 + seed + i));
      const fw = w * s;
      const sway = Math.sin(now * 9 + seed * 3 + i) * fw * 0.25;
      ctx.fillStyle = `rgba(${c},${alpha * (0.85 - i * 0.1)})`;
      ctx.beginPath();
      ctx.moveTo(x - fw / 2, y);
      ctx.quadraticCurveTo(x - fw / 2, y - fh * 0.55, x + sway, y - fh);
      ctx.quadraticCurveTo(x + fw / 2, y - fh * 0.55, x + fw / 2, y);
      ctx.closePath(); ctx.fill();
    });
  }
  function cave(now, x0, x1, y0, F, st) {
    // dung nham phát sáng phía xa
    const lava = ctx.createLinearGradient(0, F - 160, 0, F - 20);
    lava.addColorStop(0, 'rgba(255,80,10,0)'); lava.addColorStop(1, `rgba(255,90,20,${0.45 + 0.1 * Math.sin(now * 2)})`);
    ctx.fillStyle = lava; ctx.fillRect(x0, F - 160, x1 - x0, 140);
    mountains(x0, x1, F - 25, 110, st.far, 9);
    // vách hang + thạch nhũ
    ctx.fillStyle = st.near;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let x = x0, k = 0; x <= x1 + 50; x += 50, k++) {
      ctx.lineTo(x + 25, y0 + 60 + ((k * 37) % 70) + (k % 3 === 0 ? 50 : 0));
      ctx.lineTo(x + 50, y0 + 40 + ((k * 23) % 30));
    }
    ctx.lineTo(x1, y0); ctx.closePath(); ctx.fill();
    // cột đá + chậu lửa
    [[150, 1], [850, -1]].forEach(([x], i) => {
      ctx.fillStyle = '#1b120e';
      ctx.fillRect(x - 26, F - 300, 52, 280);
      ctx.fillStyle = '#261a14'; ctx.fillRect(x - 34, F - 312, 68, 18); ctx.fillRect(x - 34, F - 40, 68, 20);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 6, F - 294, 20, 254);
      const g = ctx.createRadialGradient(x, F - 340, 10, x, F - 340, 170);
      g.addColorStop(0, 'rgba(255,140,40,.45)'); g.addColorStop(1, 'rgba(255,100,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, F - 340, 170, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a2a20';
      ctx.beginPath(); ctx.moveTo(x - 30, F - 330); ctx.lineTo(x + 30, F - 330); ctx.lineTo(x + 18, F - 312); ctx.lineTo(x - 18, F - 312); ctx.closePath(); ctx.fill();
      flame(x, F - 328, 46, 70, now, i * 5);
    });
  }
  function ambient(now) {
    if (S.stage === 1 || S.stage === 3) return;
    EMBERS.forEach((p) => {
      const y = 600 - ((p.y + now * p.sp) % 640);
      const x = ((p.x + Math.sin(now * 1.3 + p.ph) * 25) % 1100 + 1100) % 1100 - 50;
      ctx.fillStyle = `rgba(255,${120 + (p.ph * 20) % 100},40,${0.35 + 0.4 * Math.abs(Math.sin(now * 3 + p.ph))})`;
      ctx.beginPath(); ctx.arc(x, y, 1.6 * p.s, 0, 7); ctx.fill();
    });
  }

  // ---------------------------------------------------------------- vẽ: võ sĩ
  // Góc chân tay đo từ hướng thẳng xuống, quay về phía trước là dương. Chi gồm 2 đoạn: [góc đoạn 1, góc gập đoạn 2].
  const GUARD = { lean: 0.12, armF: [1.0, 1.95], armB: [0.7, 2.15], legF: [0.5, -0.55], legB: [-0.38, -0.3], eyes: 'angry', mouth: 'flat',
    twist: 0.25, hipTwist: 0.35 };
  const L1 = 28; const L2 = 28; const A1 = 22; const A2 = 22;   // độ dài xương (khớp với render3d.js)
  function basePose() {
    return { lean: GUARD.lean, armF: [...GUARD.armF], armB: [...GUARD.armB], legF: [...GUARD.legF], legB: [...GUARD.legB],
      eyes: GUARD.eyes, mouth: GUARD.mouth, rot: 0, lift: 0, tilt: 0, twist: GUARD.twist, hipTwist: GUARD.hipTwist };
  }
  function crouchPose(p) { p.legF = [1.45, -1.8]; p.legB = [0.75, -2.1]; p.lean = 0.42; return p; }
  function blendPose(a, b, k) {
    const o = { ...b };
    ['lean', 'lift', 'rot', 'tilt', 'twist', 'hipTwist'].forEach((n) => { o[n] = lerp(a[n] || 0, b[n] || 0, k); });
    if (a.spinX !== undefined || b.spinX !== undefined) o.spinX = lerp(a.spinX ?? 1, b.spinX ?? 1, k);
    ['armF', 'armB', 'legF', 'legB'].forEach((n) => { o[n] = [lerp(a[n][0], b[n][0], k), lerp(a[n][1], b[n][1], k)]; });
    return o;
  }

  function poseFor(st, mv, e, t, seed) {
    const p = basePose();
    const bob = Math.sin(t * 5 + seed);
    switch (st) {
      case 'idle': {
        const b2 = Math.sin(t * 7 + seed);
        p.lift = b2 * 3 - 2; p.legF[1] -= b2 * 0.12; p.legB[1] -= b2 * 0.08;
        p.armF[0] += b2 * 0.06; p.armB[0] -= b2 * 0.06; p.lean += b2 * 0.02;
        break;
      }
      case 'walk': {
        // bước lướt giữ thế thủ: chân trước / sau thay nhau, người nhún nhẹ
        const s = Math.sin(t * 9 + seed);
        p.legF = [0.3 + s * 0.38, -0.45 - Math.max(0, -s) * 0.6];
        p.legB = [-0.2 - s * 0.38, -0.35 - Math.max(0, s) * 0.6];
        p.lift = Math.abs(Math.cos(t * 9 + seed)) * 2.5;
        p.twist += s * 0.08;
        break;
      }
      case 'crouch': crouchPose(p); break;
      case 'block': case 'cblock':
        if (st === 'cblock') crouchPose(p); else p.lean = -0.08;
        p.armF = [2.15, 1.25]; p.armB = [1.9, 1.45]; p.twist = 0.05; p.eyes = 'squint'; p.mouth = 'grit';
        break;
      case 'jump': p.legF = [1.0, -1.9]; p.legB = [0.45, -1.7]; p.armF = [1.3, 1.6]; p.armB = [0.9, 1.8]; break;
      case 'hurt':
        p.lean = -0.38; p.tilt = -0.2; p.armF = [-0.5, 0.7]; p.armB = [-0.9, 0.5];
        p.legF = [0.3, -0.2]; p.legB = [-0.45, -0.05]; p.eyes = 'hurt'; p.mouth = 'o';
        break;
      case 'fall':
        p.lean = -0.3; p.armF = [-1.4, 0.4]; p.armB = [-1.9, 0.3]; p.legF = [0.9, -0.4]; p.legB = [0.5, -0.3];
        p.rot = -1.0; p.eyes = 'hurt'; p.mouth = 'o';
        break;
      case 'down': case 'ko':
        p.rot = -Math.PI / 2; p.lean = 0; p.armF = [1.3, 0.3]; p.armB = [-0.5, 0.3]; p.legF = [0.2, -0.15]; p.legB = [-0.1, -0.1];
        p.eyes = st === 'ko' ? 'x' : 'hurt'; p.mouth = 'wavy';
        break;
      case 'rise': crouchPose(p); p.eyes = 'squint'; break;
      case 'dizzy':
        p.lean = Math.sin(t * 3) * 0.22; p.tilt = Math.sin(t * 3 + 1) * 0.25; p.twist = Math.sin(t * 2.2) * 0.4; p.hipTwist = 0;
        p.armF = [-0.15 + Math.sin(t * 3) * 0.3, 0.3]; p.armB = [0.15 - Math.sin(t * 3) * 0.3, 0.3];
        p.legF = [0.2, -0.3]; p.legB = [-0.2, -0.3]; p.eyes = 'dizzy'; p.mouth = 'wavy';
        break;
      case 'win':
        // giơ nắm đấm ăn mừng, ưỡn ngực
        p.armF = [3.05 + Math.sin(t * 5) * 0.08, 0.2]; p.armB = [0.55, 2.4]; p.eyes = 'angry'; p.mouth = 'open';
        p.lift = Math.abs(Math.sin(t * 5)) * 4; p.lean = -0.12; p.legF = [0.28, -0.12]; p.legB = [-0.28, -0.12]; p.twist = 0.5; p.hipTwist = 0.2;
        break;
      case 'sad': p.lean = 0.25; p.tilt = 0.25; p.armF = [0.1, 0.2]; p.armB = [-0.1, 0.2]; p.legF = [0.15, -0.1]; p.legB = [-0.15, -0.1]; p.eyes = 'hurt'; p.mouth = 'wavy'; break;
      case 'atk': { const a = attackPose(p, mv, e); a.st = 'atk'; return a; }
      default:
    }
    p.st = st;
    return p;
  }

  const ease = (x) => x * x * (3 - 2 * x);
  // Nội suy giữa các nhịp [thời điểm, tư thế] của một đòn.
  function keyPose(frames, e) {
    if (e <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      if (e <= frames[i][0]) {
        const [t0, a] = frames[i - 1]; const [t1, b] = frames[i];
        return blendPose(a, b, ease((e - t0) / ((t1 - t0) || 1)));
      }
    }
    return frames[frames.length - 1][1];
  }
  function attackPose(p, mv, e) {
    const m = MV[mv];
    if (!m) return p;
    const S = m.st; const A = m.st + m.ac; const E = A + m.rc;
    const P = (o) => ({ ...p, armF: [...p.armF], armB: [...p.armB], legF: [...p.legF], legB: [...p.legB], ...o, mouth: 'grit' });
    const crouch = (o) => P({ legF: [1.45, -1.8], legB: [0.75, -2.1], lean: 0.42, ...o });
    const air = (o) => P({ legF: [1.0, -1.9], legB: [0.45, -1.7], ...o });
    let f;
    switch (mv) {
      case 'jab':      // đấm thẳng: vai xoay theo cú đấm
        f = [[0, p], [S, P({ armF: [1.57, 0.02], lean: 0.2, twist: -0.25, hipTwist: 0.15 })], [A, P({ armF: [1.6, 0], lean: 0.22, twist: -0.3 })], [E, p]];
        break;
      case 'kick': {    // đá cao: co gối lên trước rồi bật chân, hông xoay theo
        const chamber = P({ legF: [1.95, -2.4], legB: [-0.15, -0.15], lean: -0.15, hipTwist: 0.15, armF: [0.9, 1.9], armB: [-0.3, 1.4] });
        const strike = P({ legF: [2.3, 0.02], legB: [-0.08, -0.05], lean: -0.5, hipTwist: 0.6, twist: 0.2, armF: [0.5, 1.7], armB: [-0.7, 1.0] });
        f = [[0, p], [S * 0.6, chamber], [S, strike], [A, strike], [A + m.rc * 0.4, chamber], [E, p]];
        break;
      }
      case 'round': {   // đá xoay: xoay người một vòng rồi quét chân cao
        const chamber = P({ legF: [1.7, -2.2], legB: [-0.1, -0.1], lean: -0.2, spinX: -1, armF: [-0.6, 1.0], armB: [1.2, 0.6] });
        const strike = P({ legF: [2.35, 0], legB: [0, -0.05], lean: -0.6, spinX: 1, hipTwist: 0.8, twist: 0.4, armF: [-0.9, 0.9], armB: [1.4, 0.4] });
        f = [[0, { ...p, spinX: -1 }], [S, strike], [A, strike], [E, { ...p, spinX: 1 }]];
        break;
      }
      case 'upper': {   // móc hàm: hạ thấp người rồi bật lên
        const dip = crouch({ armF: [0.2, 2.4], armB: [0.8, 2.0], twist: 0.45 });
        const strike = P({ armF: [3.05, 0.08], armB: [0.3, 1.4], legF: [0.2, -0.05], legB: [-0.35, -0.05], lift: 14, lean: -0.15, twist: -0.55 });
        f = [[0, p], [S, dip], [A, strike], [A + m.rc * 0.5, strike], [E, p]];
        break;
      }
      case 'sweep': {   // quét chân: ngồi thấp, xoay lưng một vòng, chân duỗi sát sàn
        const low = crouch({ legF: [1.55, 0], lean: 0.65, armF: [0.4, 0.6], armB: [-0.6, 0.4], spinX: -1 });
        const swept = crouch({ legF: [1.58, 0], lean: 0.7, armF: [0.4, 0.6], armB: [-0.6, 0.4], spinX: 1, hipTwist: 0.5 });
        f = [[0, { ...p, spinX: -1 }], [S, low], [A, swept], [E, { ...crouch({}), spinX: 1 }]];
        break;
      }
      case 'apunch':
        f = [[0, air({})], [S, air({ armF: [1.2, 0], twist: -0.3, lean: 0.2 })], [A, air({ armF: [1.25, 0], twist: -0.3 })], [E, air({})]];
        break;
      case 'akick': {
        const strike = air({ legF: [1.1, -0.02], legB: [0.5, -1.9], lean: -0.2, armF: [2.2, 0.5], armB: [-0.6, 0.6], hipTwist: 0.4 });
        f = [[0, air({})], [S, strike], [A, strike], [E, air({})]];
        break;
      }
      case 'fkick': {
        const strike = P({ legF: [1.7, 0], legB: [0.85, -1.9], armF: [-0.8, 0.6], armB: [-1.1, 0.5], lean: -0.45, hipTwist: 0.5 });
        f = [[0, p], [S, strike], [A, strike], [E, p]];
        break;
      }
      case 'bicycle': {   // đá xe đạp: hai chân thay nhau đạp liên tục
        const k = Math.sin(e * 40);
        const strike = P({ legF: [1.5 + k * 0.5, -0.6 - Math.max(0, -k)], legB: [1.5 - k * 0.5, -0.6 - Math.max(0, k)], lean: -0.5, armF: [-0.6, 0.6], armB: [-0.9, 0.5] });
        f = [[0, p], [S, strike], [A, strike], [E, p]];
        break;
      }
      case 'slide': {
        const strike = crouch({ legF: [1.62, 0], legB: [1.2, -2.3], lean: -0.6, armF: [-0.4, 0.3], armB: [-0.9, 0.3] });
        f = [[0, p], [S, strike], [A, strike], [E, p]];
        break;
      }
      case 'shoulder': {
        const strike = P({ lean: 0.55, twist: 0.6, armF: [1.2, 1.8], armB: [0.4, 2.2], legF: [0.8, -0.4], legB: [-0.7, -0.1] });
        f = [[0, p], [S, strike], [A, strike], [E, p]];
        break;
      }
      case 'throw': {   // túm lấy rồi quật qua đầu ra sau lưng
        const grab = P({ armF: [1.5, 0.3], armB: [1.4, 0.4], lean: 0.2, twist: 0 });
        const over = P({ armF: [3.1, 0.1], armB: [2.9, 0.2], lean: -0.5, twist: -0.3, mouth: 'open' });
        f = [[0, p], [A, grab], [A + 0.25, over], [E, p]];
        break;
      }
      case 'fireball': case 'iceball': {   // vận chưởng sau lưng rồi đẩy hai tay ra
        const charge = P({ armF: [-0.4, 1.7], armB: [-0.6, 1.6], lean: -0.05, twist: 0.6 });
        const push = P({ armF: [1.5, 0.08], armB: [1.38, 0.25], lean: 0.18, twist: -0.3 });
        if (e < S) return { ...blendPose(p, charge, ease(e / S)), charge: e / S };
        f = [[S, charge], [S + 0.06, push], [E, p]];
        break;
      }
      case 'spear': {
        const wind = P({ armF: [-0.7, 1.3], lean: -0.1, twist: 0.5 });
        const thrust = P({ armF: [1.57, 0], armB: [-0.5, 0.4], lean: 0.18, twist: -0.4 });
        f = [[0, p], [S, wind], [S + 0.06, thrust], [E - m.rc * 0.3, thrust], [E, p]];
        break;
      }
      case 'teleport':
        f = [[0, p], [S, P({ armF: [2.6, 0.3], armB: [2.4, 0.3], lean: -0.1 })], [E, p]];
        break;
      default:
        return p;
    }
    return keyPose(f, e);
  }

  const pt = (x, y, a, l) => [x + Math.sin(a) * l, y + Math.cos(a) * l];
  const legDrop = (g) => L1 * Math.cos(g[0]) + L2 * Math.cos(g[0] + g[1]);

  // Ngoại hình dàn võ sĩ MK4 (vẽ lại bằng hình khối, không dùng hình gốc).
  // chest: vest (áo ninja) | bare (cởi trần) | tank (áo ba lỗ) | robe (áo choàng) | armor (giáp);
  // sleeve/glove = màu bắp tay / cẳng tay + nắm đấm ('skin' = da); hood/mask = mũ trùm / khăn che mặt;
  // eyes: glow (trắng phát sáng) | yellow | red; build: f (nữ) | big (vạm vỡ).
  const CHAR_LOOKS = {
    scorpion: { skin: '#c88a5a', chest: 'vest', top: '#f2c20f', trim: '#151515', sleeve: '#151515', glove: '#151515', pants: '#151515', boots: '#f2c20f', belt: '#151515', sash: '#f2c20f', hood: '#f2c20f', mask: '#151515', eyes: 'glow' },
    subzero: { skin: '#e3b58c', chest: 'vest', top: '#2e7de0', trim: '#111', sleeve: '#111', glove: '#111', pants: '#111', boots: '#2e7de0', belt: '#111', sash: '#2e7de0', mask: '#2e7de0', hair: 'short', hairColor: '#151515' },
    raiden: { skin: '#f0d2b0', chest: 'robe', top: '#f2f2f6', trim: '#2b5ccf', sleeve: '#f2f2f6', glove: 'skin', pants: '#f2f2f6', boots: '#2b5ccf', belt: '#2b5ccf', sash: '#2b5ccf', hat: 'straw', hair: 'long', hairColor: '#f4f4f4', eyes: 'glow' },
    liukang: { skin: '#d9a066', chest: 'bare', sleeve: 'skin', glove: '#151515', pants: '#151515', boots: '#151515', belt: '#c0281f', sash: '#c0281f', band: '#c0281f', hair: 'long', hairColor: '#111' },
    reptile: { skin: '#9bbf5a', chest: 'vest', top: '#3fae3a', trim: '#151515', sleeve: '#151515', glove: '#151515', pants: '#151515', boots: '#3fae3a', belt: '#151515', sash: '#3fae3a', hood: '#3fae3a', mask: '#2a7a27', eyes: 'yellow' },
    sonya: { build: 'f', skin: '#f1c9a5', chest: 'tank', top: '#5d7a2e', trim: '#3d5420', sleeve: 'skin', glove: '#2a2a2a', pants: '#5d7a2e', boots: '#2a2a2a', belt: '#2a2a2a', hair: 'ponytail', hairColor: '#f0d070' },
    jax: { build: 'big', skin: '#6b4429', chest: 'bare', sleeve: 'skin', glove: '#b9c2cc', metal: true, pants: '#2f3f2a', boots: '#1a1a1a', belt: '#1a1a1a', hair: 'flattop', hairColor: '#111' },
    johnny: { skin: '#efc8a0', chest: 'bare', sleeve: 'skin', glove: '#1a1a1a', pants: '#1e2a4a', boots: '#1a1a1a', belt: '#7a4a2a', shades: true, hair: 'spiky', hairColor: '#5a3825' },
    kai: { skin: '#7a4a2a', chest: 'bare', sleeve: 'skin', glove: '#c0281f', pants: '#1a1a1a', boots: '#1a1a1a', belt: '#c0281f', sash: '#c0281f', band: '#c0281f', hair: 'spiky', hairColor: '#111' },
    tanya: { build: 'f', skin: '#c68652', chest: 'vest', top: '#e8c22a', trim: '#1a1a1a', sleeve: '#1a1a1a', glove: '#1a1a1a', pants: '#1a1a1a', boots: '#e8c22a', belt: '#e8c22a', hair: 'long', hairColor: '#111' },
    jarek: { skin: '#e3b58c', chest: 'vest', top: '#5a4630', trim: '#2a2a2a', sleeve: 'skin', glove: '#2a2a2a', pants: '#2a2a2a', boots: '#3a2a1a', belt: '#3a2a1a', hair: 'short', hairColor: '#2a1a10', stubble: true },
    reiko: { skin: '#e3b58c', chest: 'armor', top: '#3a2a4a', pads: '#a01818', sleeve: '#3a2a4a', glove: '#1a1a1a', pants: '#1a1a1a', boots: '#3a2a4a', belt: '#a01818', hair: 'spiky', hairColor: '#111' },
    fujin: { skin: '#ecd2bc', chest: 'robe', top: '#c8d6e6', trim: '#4a6a9a', sleeve: '#c8d6e6', glove: 'skin', pants: '#4a6a9a', boots: '#2a3a5a', belt: '#d4af37', sash: '#4a6a9a', pads: '#d4af37', hair: 'ponytail', hairColor: '#f2f2f2' },
    quanchi: { skin: '#d8d0bc', chest: 'armor', top: '#2a3a28', pads: '#6a6a6a', sleeve: 'skin', glove: '#2a3a28', pants: '#151515', boots: '#2a3a28', belt: '#6a6a6a', hair: 'bald', marks: true },
    shinnok: { skin: '#d8c0a8', chest: 'robe', top: '#5a2a1a', trim: '#c9a227', sleeve: '#5a2a1a', glove: 'skin', pants: '#3a1a10', boots: '#2a1208', belt: '#c9a227', hair: 'long', hairColor: '#bdbdbd', beard: '#bdbdbd', eyes: 'red' },
    noob: { skin: '#141414', chest: 'vest', top: '#141414', trim: '#2c2c34', sleeve: '#141414', glove: '#141414', pants: '#141414', boots: '#1e1e24', belt: '#2c2c34', hood: '#141414', mask: '#141414', eyes: 'glow' },
  };
  const charOf = (pid) => { const p = player(pid); return (p && p.char) || 'scorpion'; };
  const charInfo = (id) => (S && S.chars.find((c) => c.id === id)) || null;
  const charName = (pid) => { const c = charInfo(charOf(pid)); return c ? c.name : '?'; };
  const lookOf = (pid) => CHAR_LOOKS[charOf(pid)] || CHAR_LOOKS.scorpion;
  // Bảng màu thay thế cho trận gương (xoay sắc độ 150°), tính một lần cho mỗi võ sĩ.
  function hueShift(hex, deg) {
    if (typeof hex !== 'string' || hex[0] !== '#') return hex;
    let n = hex.slice(1);
    if (n.length === 3) n = n.split('').map((c) => c + c).join('');
    let r = parseInt(n.slice(0, 2), 16) / 255; let g = parseInt(n.slice(2, 4), 16) / 255; let b = parseInt(n.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2; const d = mx - mn;
    let h = 0; const sa = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + deg + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sa; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m0 = l - c / 2;
    [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v) => Math.round((v + m0) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  const altCache = new Map();
  function altLook(L) {
    if (!altCache.has(L)) {
      const o = {};
      Object.entries(L).forEach(([k, v]) => { o[k] = k === 'skin' ? v : hueShift(v, 150); });
      altCache.set(L, o);
    }
    return altCache.get(L);
  }

  function energyBall(x, y, k, t) {
    const r = 6 + k * 12 + Math.sin(t * 30) * 1.5;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r * 1.8);
    g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(0.4, 'rgba(255,150,40,.9)'); g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, 7); ctx.fill();
  }

  // ---------------------------------------------------------------- vẽ: chưởng & hiệu ứng
  // Màu quả cầu năng lượng theo kiểu chưởng: [lõi, giữa, viền mờ, vệt đuôi]
  const ORB = {
    hellfire: ['#fff3c0', '#ff7a12', 'rgba(220,30,0,0)', '255,90,20'],
    dragon: ['#fff6d0', '#ff9a1e', 'rgba(230,40,0,0)', '255,120,30'],
    ice: ['#ffffff', '#9fdcff', 'rgba(40,120,255,0)', '150,210,255'],
    bolt: ['#ffffff', '#b8d0ff', 'rgba(80,120,255,0)', '170,200,255'],
    acid: ['#eaffc0', '#6ee04a', 'rgba(40,160,20,0)', '110,220,70'],
    green: ['#eaffea', '#4cff6a', 'rgba(0,200,60,0)', '80,255,110'],
    sky: ['#ffffff', '#5fb0ff', 'rgba(30,80,255,0)', '100,170,255'],
    pinkfire: ['#fff0f8', '#ff6ab0', 'rgba(220,30,120,0)', '255,110,180'],
    skull: ['#eaffd8', '#5cff7a', 'rgba(0,160,40,0)', '90,255,120'],
    dark: ['#f0d8ff', '#9a4dff', 'rgba(60,0,120,0)', '150,80,255'],
    shadow: ['#d8c8ff', '#2a1838', 'rgba(90,40,150,0)', '90,50,140'],
  };
  function projStyle(owner, k) {
    const c = charInfo(charOf(owner));
    if (!c) return k === 'spear' ? 'kunai' : 'hellfire';
    const i = c.moves.indexOf(k);
    return (c.fx && c.fx[i]) || (k === 'spear' ? 'kunai' : k === 'iceball' ? 'ice' : 'hellfire');
  }
  function orb(style, x, y, dir, now, r = 24) {
    const c = ORB[style] || ORB.hellfire;
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = `rgba(${c[3]},${0.16 * (5 - i)})`;
      ctx.beginPath(); ctx.arc(x - dir * i * 12, y + Math.sin(now * 30 + i) * 3, r * 0.75 - i * 2.5, 0, 7); ctx.fill();
    }
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, c[0]); g.addColorStop(0.45, c[1]); g.addColorStop(1, c[2]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  function blades(x, y, n, r, color, now) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 22);
    ctx.fillStyle = color; ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
    for (let k = 0; k < n; k++) {
      ctx.rotate((Math.PI * 2) / n);
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(r * 0.6, -r * 0.4, r, 0); ctx.quadraticCurveTo(r * 0.4, 1, 0, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawBall(style, x, y, dir, now, freeze) {
    switch (style) {
      case 'ring':
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = `rgba(255,110,210,${0.9 - k * 0.25})`; ctx.lineWidth = 4 - k;
          ctx.beginPath(); ctx.ellipse(x - dir * k * 14, y, 9 + k * 2, 20 - k * 3, 0, 0, 7); ctx.stroke();
        }
        break;
      case 'missile':
        flame(x - dir * 26, y + 4, 12, 26, now, 1);
        ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
        ctx.fillStyle = '#9aa3ad'; ctx.strokeStyle = LINE; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(8, -6); ctx.quadraticCurveTo(22, 0, 8, 6); ctx.lineTo(-22, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c0281f'; ctx.beginPath(); ctx.moveTo(8, -6); ctx.quadraticCurveTo(22, 0, 8, 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5a636d'; ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(-28, -12); ctx.lineTo(-16, -6); ctx.moveTo(-22, 6); ctx.lineTo(-28, 12); ctx.lineTo(-16, 6); ctx.fill();
        ctx.restore();
        break;
      case 'blade': blades(x, y, 3, 18, '#d4dbe2', now); break;
      case 'star': blades(x, y, 4, 15, '#5a6470', now); break;
      case 'wind':
        ctx.strokeStyle = 'rgba(235,245,255,.85)'; ctx.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          ctx.lineWidth = 3 - k * 0.5;
          ctx.beginPath(); ctx.ellipse(x, y + k * 6 - 10, 20 - k * 4, 6, 0, now * 18 + k, now * 18 + k + 4.5); ctx.stroke();
        }
        break;
      case 'skull':
        orb('skull', x, y, dir, now, 24);
        ctx.fillStyle = 'rgba(20,60,20,.85)';
        ctx.beginPath(); ctx.arc(x, y - 2, 9, 0, 7); ctx.fill(); ctx.fillRect(x - 6, y + 4, 12, 6);
        ctx.fillStyle = '#b8ffb0'; ctx.beginPath(); ctx.arc(x - 3.5, y - 2, 2.5, 0, 7); ctx.arc(x + 3.5, y - 2, 2.5, 0, 7); ctx.fill();
        break;
      case 'bolt':
        orb('bolt', x, y, dir, now, 22);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const a = now * 40 + k * 2.1;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); ctx.lineTo(x + Math.cos(a + 0.5) * 26, y + Math.sin(a + 0.5) * 26); ctx.stroke();
        }
        break;
      default:
        orb(style, x, y, dir, now, style === 'dragon' ? 30 : 24);
        if (freeze || style === 'ice') {
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          for (let k = 0; k < 4; k++) { const a = now * 6 + k * 1.57; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); ctx.lineTo(x + Math.cos(a + 0.2) * 8, y + Math.sin(a + 0.2) * 8); ctx.lineTo(x + Math.cos(a - 0.2) * 8, y + Math.sin(a - 0.2) * 8); ctx.fill(); }
        }
    }
  }
  // Dây móc / lưỡi / gió hút / bàn tay ma nối từ tay người ném tới đầu móc.
  function drawGrab(style, hx, hy, x, y, dir, now) {
    if (style === 'tongue') {
      ctx.strokeStyle = '#c2456a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hy - 10); ctx.quadraticCurveTo((hx + x) / 2, y + Math.sin(now * 30) * 6, x, y); ctx.stroke();
      ctx.fillStyle = '#e0688c'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
      return;
    }
    if (style === 'wind') {
      ctx.strokeStyle = 'rgba(230,240,255,.7)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        ctx.beginPath(); ctx.moveTo(hx, hy + (k - 1.5) * 8);
        ctx.bezierCurveTo((hx + x) / 2, hy + (k - 1.5) * 20 + Math.sin(now * 20 + k) * 10, (hx + x) / 2, y - (k - 1.5) * 16, x, y); ctx.stroke();
      }
      drawBall('wind', x, y, dir, now);
      return;
    }
    if (style === 'hand') {
      ctx.strokeStyle = 'rgba(120,255,140,.45)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(x, y); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
      ctx.fillStyle = 'rgba(140,255,150,.85)'; ctx.shadowColor = '#5f5'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, 7); ctx.fill();
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(10, -6 + k * 4, 7, 2, 0, 0, 7); ctx.fill(); }
      ctx.restore();
      return;
    }
    // xích + kunai (Scorpion)
    ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 3; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + x) / 2, (hy + y) / 2 + 10, x, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.fillStyle = '#d7dde8'; ctx.strokeStyle = LINE; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(0, -8); ctx.lineTo(4, 0); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(-3, 0, 4, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawProjs(now) {
    const dt = clamp(srv() - projT, 0, 0.3);
    projs.forEach(([, k, x0, py, vx, o]) => {
      const x = x0 + vx * dt;
      const y = W.FLOOR - py;
      const dir = Math.sign(vx);
      const style = projStyle(o, k);
      if (k === 'spear') {
        const od = view.disp[o];
        const hx = od ? od.x + od.face * 34 : x; const hy = od ? W.FLOOR - od.y - 78 : y;
        drawGrab(style, hx, hy, x, y, dir, now);
      } else drawBall(style, x, y, dir, now, MV[k] && MV[k].freeze);
    });
  }

  function drawParts(now) {
    const t = perf();
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      const age = t - p.born;
      if (age > p.life) { parts.splice(k, 1); continue; }
      const f = age / p.life;
      const x = p.x + (p.vx || 0) * age;
      const yh = p.y + (p.vy || 0) * age - (p.kind === 'star' || p.kind === 'dust' ? 300 * age * age : 0);
      const y = W.FLOOR - yh;
      ctx.globalAlpha = 1 - f;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3.5 * (1 - f) + 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.04, y + p.vy * 0.04); ctx.stroke();
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 4 * (1 - f);
        ctx.beginPath(); ctx.arc(x, y, 10 + f * 40, 0, 7); ctx.stroke();
      } else if (p.kind === 'blood') {
        const by = Math.max(0, p.y + p.vy * age - 900 * age * age);
        ctx.fillStyle = '#9a0a0a';
        ctx.beginPath();
        if (by > 0) ctx.arc(x, W.FLOOR - by, p.r, 0, 7);
        else {
          ctx.ellipse(x, W.FLOOR + 2, p.r * 2.2, p.r * 0.7, 0, 0, 7);
          if (!p.landed) { p.landed = true; stains.push({ x, z: (Math.random() - 0.5) * 40, r: p.r * (1.6 + Math.random()) }); if (stains.length > 80) stains.shift(); }
        }
        ctx.fill();
      } else if (p.kind === 'star') {
        sparkle(x, y, 5, p.color);
      } else if (p.kind === 'dust') {
        ctx.fillStyle = 'rgba(240,225,205,.8)';
        ctx.beginPath(); ctx.arc(x, y, p.r * (1 + f), 0, 7); ctx.fill();
      } else if (p.kind === 'smoke') {
        ctx.fillStyle = p.color || '#fff';
        ctx.beginPath(); ctx.arc(x, y, p.r * (0.6 + f * 0.8), 0, 7); ctx.fill();
      } else if (p.kind === 'num') {
        ctx.font = `800 24px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 5; ctx.strokeStyle = '#3b1a3a'; ctx.strokeText(p.text, x, y);
        ctx.fillStyle = '#ffe066'; ctx.fillText(p.text, x, y);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- vẽ: kết liễu
  function bolt(x, now, seed) {
    const pts = [[x + Math.sin(seed * 7) * 60, -view.oy - 20]];
    let y = pts[0][1];
    while (y < W.FLOOR - 70) {
      y += 30 + ((seed * 13 + y) % 25);
      pts.push([x + Math.sin(y * 0.11 + seed + now * 40) * 22, Math.min(y, W.FLOOR - 70)]);
    }
    ctx.save();
    ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
    [[16, 'rgba(120,170,255,.35)'], [7, 'rgba(170,210,255,.9)'], [3, '#ffffff']].forEach(([lw, c]) => {
      ctx.strokeStyle = c; ctx.lineWidth = lw;
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    });
    ctx.restore();
  }
  function flames(x, k, now) {
    for (let i = 0; i < 7; i++) {
      const dx = (i - 3) * 13 + Math.sin(i * 2.3) * 5;
      const h = (60 + ((i * 37) % 50)) * k * (1 - Math.abs(i - 3) * 0.12);
      if (h > 4) flame(x + dx, W.FLOOR + 2, 26, h * 1.6, now, i, Math.min(1, k * 2));
    }
  }
  // Đống tro tàn còn bốc khói.
  function ashPile(x, k, now) {
    ctx.save();
    ctx.fillStyle = '#2a2624'; ctx.strokeStyle = '#0c0a09'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, W.FLOOR + 2, 36 * k, 15 * k, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3d3734';
    ctx.beginPath(); ctx.ellipse(x - 10, W.FLOOR - 4 * k, 12 * k, 5 * k, 0, 0, 7); ctx.ellipse(x + 12, W.FLOOR - 2, 9 * k, 4 * k, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,110,30,${0.5 + 0.4 * Math.sin(now * 6)})`;
    ctx.beginPath(); ctx.arc(x - 6, W.FLOOR - 3, 2.2 * k, 0, 7); ctx.arc(x + 15, W.FLOOR - 1, 1.6 * k, 0, 7); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (now * 0.5 + i * 0.2) % 1;
      ctx.fillStyle = `rgba(90,85,80,${0.35 * (1 - a)})`;
      ctx.beginPath(); ctx.arc(x + Math.sin(now * 2 + i * 1.7) * 14 + (i - 2) * 8, W.FLOOR - 10 - a * 140, 8 + a * 22, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- vẽ: chữ & HUD
  function hudText(text, x, y, size, align = 'center', color = '#fff', stroke = '#000') {
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  const METAL = {
    gold: [['#fffbe0', 0], ['#ffd54a', 0.45], ['#b86e00', 0.55], ['#ffcf40', 1]],
    red: [['#ffc2b0', 0], ['#ff3a22', 0.45], ['#8a0000', 0.55], ['#ff4a2a', 1]],
    steel: [['#ffffff', 0], ['#d4dae0', 0.45], ['#6b7580', 0.55], ['#c9d0d6', 1]],
  };
  // Chữ ánh kim, nghiêng, viền đen dày — kiểu chữ xướng ngôn của game đối kháng.
  function metalText(text, x, y, size, kind = 'gold', align = 'center', glow = size >= 50) {
    ctx.save();
    ctx.translate(x, y); ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'miter';
    if (glow) { ctx.shadowColor = kind === 'red' ? 'rgba(255,0,0,.55)' : 'rgba(0,0,0,.6)'; ctx.shadowBlur = size / 4; }
    ctx.lineWidth = Math.max(4, size / 6); ctx.strokeStyle = '#000';
    ctx.strokeText(text, 0, 0);
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    METAL[kind].forEach(([c, s]) => g.addColorStop(s, c));
    ctx.fillStyle = g; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function bigText(text, y, size, kind, age) {
    const w = view.cssW;
    const pop = age < 0.12 ? 1.6 - (age / 0.12) * 0.6 : 1;
    ctx.save(); ctx.translate(w / 2, y); ctx.scale(pop, pop);
    ctx.globalAlpha = clamp(age / 0.08, 0, 1);
    metalText(text, 0, 0, Math.min(size, w / Math.max(4, text.length * 0.5)), kind);
    ctx.restore();
  }

  // Thanh máu kiểu MK4: thanh xanh dài, tên võ sĩ in ngay trong thanh, nền đỏ, phần vừa mất trôi chậm.
  function drawBar(x, w, y, h, pid, flip, now) {
    const v = clamp((hp[pid] ?? W.HP) / W.HP, 0, 1);
    const g = ghost[pid] ?? v;
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    const fr = ctx.createLinearGradient(0, y - 3, 0, y + h + 3);
    fr.addColorStop(0, '#d9b45a'); fr.addColorStop(0.5, '#6b4a10'); fr.addColorStop(1, '#c79a3a');
    ctx.strokeStyle = fr; ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#7a0000'; ctx.fillRect(x, y, w, h);
    const seg = (frac, fill) => {
      if (frac <= 0) return;
      const fw = w * frac;
      ctx.fillStyle = fill; ctx.fillRect(flip ? x + w - fw : x, y, fw, h);
    };
    seg(g, '#ffd21f');
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#7dff6a'); grad.addColorStop(0.45, '#1fbf2a'); grad.addColorStop(1, '#0a6614');
    if (v < 0.25 && Math.sin(now * 12) > 0.4) ctx.globalAlpha = 0.7;
    seg(v, grad);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x, y + 1, w, h * 0.28);
    // tên võ sĩ trong thanh máu
    ctx.font = `700 ${Math.round(h * 0.78)}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'right' : 'left';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    const tx = flip ? x + w - 8 : x + 8;
    const label = charName(pid).toUpperCase();
    ctx.strokeText(label, tx, y + h / 2 + 1); ctx.fillStyle = '#fff'; ctx.fillText(label, tx, y + h / 2 + 1);
    ctx.restore();
  }

  // Huy hiệu rồng MK: đồng tiền vàng có hình rồng đỏ cách điệu.
  function dragonMedal(x, y, r, on) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = on ? '#e8b923' : 'rgba(0,0,0,.55)';
    ctx.strokeStyle = on ? '#5a3a00' : 'rgba(220,180,90,.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
    if (on) {
      ctx.fillStyle = '#9a0f0f';
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, r * 0.35); ctx.quadraticCurveTo(-r * 0.7, -r * 0.6, r * 0.1, -r * 0.6);
      ctx.quadraticCurveTo(r * 0.75, -r * 0.55, r * 0.5, -r * 0.05); ctx.lineTo(r * 0.15, -r * 0.2);
      ctx.quadraticCurveTo(r * 0.25, r * 0.2, -r * 0.1, r * 0.1); ctx.quadraticCurveTo(-r * 0.25, r * 0.55, -r * 0.55, r * 0.35);
      ctx.fill();
      ctx.strokeStyle = '#ffe58a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r - 2.5, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHud(now) {
    const w = view.cssW; const h = view.cssH;
    if (!S.fighters.length) return;
    if (S.phase === 'play' && S.rstate === 'intro' && S.round === 1 && srv() < S.fightAt - W.INTRO) return;   // màn VS
    const small = w < 560;
    const barH = small ? 15 : 24;
    const gap = small ? 30 : 52;
    const barW = Math.min(420, (w - gap * 2 - 24) / 2);
    const top = small ? 12 : 18;
    S.fighters.forEach((pid, i) => {
      const flip = i === 1;
      const bx = flip ? w / 2 + gap : w / 2 - gap - barW;
      const target = clamp((hp[pid] ?? W.HP) / W.HP, 0, 1);
      if (ghost[pid] === undefined || target > ghost[pid]) ghost[pid] = target;
      else if (perf() - (flashAt[pid] || 0) > 0.45) ghost[pid] = Math.max(target, ghost[pid] - 0.006);
      drawBar(bx, barW, top, barH, pid, flip, now);
      const pn = (pid === S.me.id ? '★ ' : '') + nm(pid);
      hudText(pn.length > 18 ? pn.slice(0, 17) + '…' : pn, flip ? bx + barW : bx, top + barH + 13, small ? 10 : 13, flip ? 'right' : 'left', '#d8c9a8');
      const wins = (S.roundWins && S.roundWins[pid]) || 0;
      const mr = small ? 7 : 10;
      for (let k = 0; k < S.config.rounds; k++) {
        const mx = flip ? bx + barW - mr - k * (mr * 2.5) : bx + mr + k * (mr * 2.5);
        dragonMedal(mx, top + barH + 16 + mr + (small ? 6 : 10), mr, k < wins);
      }
    });
    // đồng hồ: chỉ có con số lớn ở giữa
    let left = S.config.time;
    const t = srv();
    if (S.rstate === 'fight') left = Math.max(0, Math.ceil(S.roundEnd - t));
    else if (S.rstate !== 'intro') left = Math.max(0, Math.ceil(S.roundEnd - S.rAt));
    if (S.rstate === 'fight' && !S.practice && left <= 10 && left !== ui.lastTick) { ui.lastTick = left; if (left > 0) play('tick'); }
    if (S.practice) metalText('∞', w / 2, top + barH / 2 + 2, small ? 28 : 44, 'gold');
    else metalText(String(left), w / 2, top + barH / 2 + 2, small ? 26 : 40, left <= 10 && S.rstate === 'fight' ? 'red' : 'gold');
    if (S.practice && S.me.fighter && trainCombo.n) {
      hudText(`COMBO GẦN NHẤT: ${trainCombo.n} ĐÒN · ${trainCombo.dmg} SÁT THƯƠNG`, w / 2, top + barH + (small ? 44 : 58), small ? 11 : 14, 'center', '#ffd84a');
    }
    // combo
    if (combo && perf() - combo.at < 1.3) {
      const flip = sideOf(combo.pid) === 1;
      const age = perf() - combo.at;
      ctx.globalAlpha = clamp(1.3 - age, 0, 1);
      metalText(`${combo.n} HIT COMBO`, flip ? w - 24 : 24, h * 0.32, small ? 20 : 30, 'red', flip ? 'right' : 'left');
      ctx.globalAlpha = 1;
    }
    // hồi chiêu của mình
    if (S.me.fighter && me && S.phase === 'play') {
      const items = mySpecials();
      const ci = charInfo(charOf(S.me.id));
      const by = ui.touch ? top + barH + 62 : h - 26;   // cảm ứng: đặt dưới thanh máu cho khỏi vướng nút
      items.forEach((k, i) => {
        const x = 24 + i * 40;
        const left2 = Math.max(0, (me.cd[k] || 0) - me.lt);
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 16, by - 16, 32, 32);
        ctx.strokeStyle = left2 > 0 ? 'rgba(200,160,80,.4)' : '#c99a3a'; ctx.lineWidth = 2; ctx.strokeRect(x - 16, by - 16, 32, 32);
        if (left2 > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 16, by - 16, 32, 32 * (left2 / MV[k].cd)); }
        ctx.globalAlpha = left2 > 0 ? 0.45 : 1;
        ctx.font = '17px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ci ? ci.sp[i][0] : MV[k].icon, x, by + 1);
        ctx.globalAlpha = 1;
      });
    }
    drawAnnouncer(now);
  }

  const isHer = (pid) => { const c = charInfo(charOf(pid)); return !!(c && c.her); };
  function drawAnnouncer(now) {
    const h = view.cssH; const w = view.cssW;
    const t = srv();
    const age = t - S.rAt;
    const small = w < 560;
    const Y = h * 0.38;
    const big = small ? 52 : 96;
    const sub = (text, dy, size = small ? 13 : 18) => hudText(text, w / 2, Y + dy, size, 'center', '#e8dcc0');
    if (S.phase === 'end') {
      if (S.winner) { bigText(`${charName(S.winner).toUpperCase()} WINS`, Y, big * 0.8, 'gold', 1); sub(nm(S.winner).toUpperCase(), big * 0.55); }
      else bigText('DRAW', Y, big, 'steel', 1);
      return;
    }
    switch (S.rstate) {
      case 'intro': {
        const ft = S.fightAt;
        if (S.round === 1 && t < ft - W.INTRO) return;   // màn VS đang chiếu
        const last = S.config.rounds > 1 && S.fighters.every((p) => (S.roundWins[p] || 0) === S.config.rounds - 1);
        if (t < ft - 0.75) bigText(S.practice ? 'PRACTICE' : last ? 'FINAL ROUND' : `ROUND ${S.round}`, Y, big, 'gold', t - (ft - (S.practice ? 1.2 : W.INTRO)));
        else bigText('FIGHT!', Y, big * 1.25, 'red', t - (ft - 0.75));
        if (S.me.fighter && me) {
          const [x, y] = toScreen(me.x, W.FLOOR - 165);
          hudText('▼ BẠN', x, y + Math.sin(now * 6) * 4, small ? 11 : 14, 'center', '#ffcc33');
        }
        break;
      }
      case 'fight':
        if (t - S.fightAt < 0.7) bigText('FIGHT!', Y, big * 1.25, 'red', 1);
        break;
      case 'ko': case 'over':
        if (S.roundReason === 'time') {
          if (age < 1.3) bigText('TIME', Y, big, 'gold', age);
          else bigText(S.roundWinner ? `${charName(S.roundWinner).toUpperCase()} WINS` : 'DRAW', Y, big * 0.7, 'gold', age - 1.3);
        } else if (S.roundReason === 'forfeit') {
          bigText(`${charName(S.winner).toUpperCase()} WINS`, Y, big * 0.75, 'gold', age);
        } else if (S.perfect && age < 2.6) {
          bigText('FLAWLESS VICTORY', Y, big * 0.62, 'gold', age);
        } else {
          bigText(`${charName(S.rstate === 'over' ? S.winner : S.roundWinner).toUpperCase()} WINS`, Y, big * 0.7, 'gold', age - (S.perfect ? 2.6 : 0));
        }
        break;
      case 'finish': {
        bigText(isHer(S.loser) ? 'FINISH HER!' : 'FINISH HIM!', Y, big, 'red', age);
        const line = S.winner === S.me.id ? (ui.touch ? 'Lại gần rồi bấm 💀' : 'Lại gần rồi bấm F') : `${charName(S.winner)} sắp kết liễu…`;
        sub(line, big * 0.6);
        hudText(Math.max(0, S.rUntil - t).toFixed(1), w / 2, Y + big * 0.6 + (small ? 20 : 28), small ? 14 : 19, 'center', '#ff5a3a');
        break;
      }
      case 'fatality': {
        if (age > 1.6) {
          const a2 = age - 1.6;
          const sz = big * 1.05;
          ctx.fillStyle = '#7a0000';
          for (let k = 0; k < 9; k++) {
            const dx = (k - 4) * sz * 0.38 + Math.sin(k * 3.1) * 8;
            const len = Math.min(70, a2 * 30 * (1 + (k % 3) * 0.6));
            ctx.fillRect(w / 2 + dx - 2, Y + sz * 0.22, 4, len);
            ctx.beginPath(); ctx.arc(w / 2 + dx, Y + sz * 0.22 + len, 4, 0, 7); ctx.fill();
          }
          bigText('FATALITY', Y - 10, sz, 'red', a2);
          if (age > 2.6) sub(`${charName(S.winner).toUpperCase()} WINS`, big * 0.95, small ? 18 : 28);
        }
        break;
      }
      default:
    }
  }

  // Màn VS trước hiệp 1: hai võ sĩ đứng hai bên, chữ VS ở giữa.
  function drawVS(now) {
    const t = srv();
    const start = S.fightAt - W.INTRO - W.VS;
    const age = t - start;
    const w = view.cssW; const h = view.cssH;
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    // tia sét chéo ở giữa
    ctx.save();
    ctx.strokeStyle = 'rgba(255,200,120,.35)'; ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath(); let x = w / 2 - 30 + k * 30; ctx.moveTo(x, 0);
      for (let y = 0; y < h; y += 40) { x += Math.sin(y * 0.07 + now * 30 + k) * 18; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.restore();
    S.fighters.forEach((pid, i) => {
      metalText(charName(pid).toUpperCase(), i === 0 ? w * 0.25 : w * 0.75, h * 0.12, w < 560 ? 20 : 36, 'gold');
      hudText(nm(pid), i === 0 ? w * 0.25 : w * 0.75, h * 0.12 + (w < 560 ? 20 : 32), w < 560 ? 11 : 15, 'center', '#e8dcc0');
    });
    const pop = age < 0.5 ? 0 : age < 0.62 ? (age - 0.5) / 0.12 * 1.4 : 1;
    if (pop > 0) {
      ctx.save(); ctx.translate(w / 2, h * 0.5); ctx.scale(pop, pop);
      metalText('VS', 0, 0, w < 560 ? 60 : 120, 'red');
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- khung hình chính
  function poseOf(pid, d, now) {
    const t = srv();
    const after = ['ko', 'over', 'finish', 'fatality'].includes(S.rstate) || S.phase === 'end';
    const age = t - S.rAt;
    let st = d.s;
    if (after && d.y <= 0 && !d.m) {
      const winner = S.phase === 'end' ? S.winner : S.rstate === 'ko' ? S.roundWinner : S.winner;
      if (pid === winner && (age > 0.7 || S.phase === 'end') && S.rstate !== 'finish') st = 'win';
      else if (S.rstate === 'finish' && pid === S.loser) st = 'dizzy';
      else if (S.roundReason === 'time' && pid !== winner && st !== 'down' && st !== 'ko') st = 'sad';
      else if (S.phase === 'end' && pid === S.loser && !S.fatality) st = 'ko';
    }
    const p = poseFor(st, d.m, d.e, now, sideOf(pid) * 2.1);
    if (st === 'jump' && Math.abs(d.vx || 0) > 60) {
      const frac = clamp((W.JUMP - (d.vy || 0)) / (2 * W.JUMP), 0, 1);
      p.spin = (Math.sign(d.vx) === d.face ? 1 : -1) * frac * Math.PI * 2;
      p.legF = [1.6, -2.4]; p.legB = [1.3, -2.3]; p.armF = [1.6, 1.4]; p.armB = [1.4, 1.6];
    }
    return p;
  }

  // ---------------------------------------------------------------- dựng hình 3D
  let R3 = null;
  let r3fail = false;
  function r3() {
    if (!R3 && !r3fail) {
      try { R3 = window.MK3D.create($('#gl')); } catch (e) {
        r3fail = true;
        P.toast('Trình duyệt không hỗ trợ WebGL — không vẽ được võ đài 3D.', 'error', 8000);
      }
    }
    return R3;
  }
  // Phông nền xa (trời, núi, đền…) vẽ bằng các hàm 2D vào canvas riêng rồi dán lên 3D. Chân trời = hàng FLOOR.
  const BG = { x0: -500, x1: 1500, top: -340, below: 260 };
  const bgCanvas = document.createElement('canvas');
  let bgStage = -1;
  function bakeBackground(now) {
    const R = r3();
    if (!R || bgStage === S.stage) return;
    bgStage = S.stage;
    const sc = 2048 / (BG.x1 - BG.x0);
    bgCanvas.width = 2048;
    bgCanvas.height = Math.round((W.FLOOR - BG.top + BG.below) * sc);
    const saved = ctx; const so = [view.ox, view.oy];
    ctx = bgCanvas.getContext('2d');
    try {
      view.ox = -BG.x0; view.oy = -BG.top;
      ctx.setTransform(sc, 0, 0, sc, -BG.x0 * sc, -BG.top * sc);
      drawStage(now, true);
      // dưới chân trời: mặt đất xa chìm vào sương
      const st = STAGES[S.stage] || STAGES[0];
      const g = ctx.createLinearGradient(0, W.FLOOR - 4, 0, W.FLOOR + BG.below);
      g.addColorStop(0, st.near); g.addColorStop(1, st.floor[2]);
      ctx.fillStyle = g; ctx.fillRect(BG.x0, W.FLOOR - 4, BG.x1 - BG.x0, BG.below + 4);
    } finally { ctx = saved; [view.ox, view.oy] = so; }
    R.setStage(S.stage);
    R.setBackground(bgCanvas, (W.FLOOR - BG.top) / (W.FLOOR - BG.top + BG.below));
  }

  // Vị trí nắm tay trước (để vẽ quả cầu năng lượng lúc vận chưởng) — cùng phép tính khớp với bản 3D.
  function handPos(d, p) {
    const hip = Math.max(legDrop(p.legF), legDrop(p.legB)) + (p.lift || 0);
    const lean = p.lean || 0;
    const sx = Math.cos(lean) + 38 * Math.sin(lean); const sy = -Math.sin(lean) * 1 + 38 * Math.cos(lean);
    const k = Math.cos(0.42);   // võ sĩ đứng nghiêng ¾
    const a1 = p.armF[0] + lean; const a2 = a1 + p.armF[1];
    const x = d.x + d.face * k * (sx + Math.sin(a1) * A1 + Math.sin(a2) * (A2 + 2));
    const y = d.y + hip + sy - Math.cos(a1) * A1 - Math.cos(a2) * (A2 + 2);
    return [x, W.FLOOR - y];
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!S || !W || !S.fighters.length || $('#arena').hidden) return;
    if (!view.cssW) resize();
    if (!view.cssW) return;
    const R = r3();
    const now = perf();
    const t = srv();
    // vị trí hiển thị của 2 võ sĩ
    const disp = {};
    S.fighters.forEach((pid, i) => {
      if (S.me.fighter && pid === S.me.id && me) return;
      disp[pid] = remoteView(pid, t) || view.disp[pid] || { x: W.START[i], y: 0, face: i === 0 ? 1 : -1, s: 'idle', m: '', e: 0, vy: 0 };
    });
    view.disp = disp;
    if (S.me.fighter && me && S.phase === 'play') {
      simulate(now);
      if (performance.now() - me.lastSent > 15) {
        me.lastSent = performance.now();
        send('pos', {
          ts: Math.round(srv() * 1000) / 1000, r: me.r, x: r1(me.x), y: r1(me.y), vx: Math.round(me.vx), vy: Math.round(me.vy), f: me.face, s: myState(me.lt),
          m: me.move ? me.move.mv : '', e: me.move ? Math.round((me.lt - me.move.t0) * 1000) / 1000 : 0, b: me.block ? 1 : 0,
        });
      }
    }
    if (S.me.fighter && me) {
      disp[S.me.id] = { x: me.x, y: me.y, face: me.face, s: myState(me.lt), m: me.move ? me.move.mv : '', e: me.move ? me.lt - me.move.t0 : 0, vy: me.vy, vx: me.vx };
    }
    const mirror = charOf(S.fighters[0]) === charOf(S.fighters[1]);
    const lookFor = (pid) => (mirror && sideOf(pid) === 1 ? altLook(lookOf(pid)) : lookOf(pid));
    // dữ liệu chọn animation cho model 3D thật: trạng thái, đòn, tiến độ đòn, đi lùi, lộn vòng, tiến độ cú nhảy
    const animInfo = (pid, d, pose) => {
      const m = d.m && MV[d.m];
      return {
        char: charOf(pid), alt: mirror && sideOf(pid) === 1, st: pose.st || d.s, mv: d.m || '',
        prog: m ? d.e / (m.st + m.ac + m.rc) : undefined,
        back: d.s === 'walk' && Math.sign(d.vx || 0) === -d.face,
        flip: (pose.st || d.s) === 'jump' && Math.abs(d.vx || 0) > 60,
        jumpProg: clamp((W.JUMP - (d.vy || 0)) / (2 * W.JUMP), 0, 1),
      };
    };
    const keyFor = (pid) => pid + (mirror && sideOf(pid) === 1 ? ':alt' : '');
    if (R) bakeBackground(now);

    // màn VS trước hiệp 1
    if (S.phase === 'play' && S.rstate === 'intro' && S.round === 1 && t < S.fightAt - W.INTRO) {
      const age = t - (S.fightAt - W.INTRO - W.VS);
      const slide = clamp(age / 0.35, 0, 1);
      const zoom = 2.5;
      if (R) {
        R.renderVS({ cssW: view.cssW, cssH: view.cssH, dpr: view.dpr, s: view.s, ox: view.ox, oy: view.oy, floorY: W.FLOOR,
          zoom, camX: 500 - (view.cssW / (2 * view.s) - view.ox) / zoom },
        S.fighters.map((pid, i) => ({ key: keyFor(pid), look: lookFor(pid), y: 0, face: i === 0 ? 1 : -1, char: charOf(pid),
          alt: mirror && i === 1, st: 'idle', x: 500 + (i === 0 ? -1 : 1) * (95 + (1 - slide) * 260), pose: poseFor('idle', '', 0, now, i * 2.1) })));
      }
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.clearRect(0, 0, view.cssW, view.cssH);
      drawVS(now);
      return;
    }
    // Camera kiểu Mortal Kombat: hai võ sĩ càng gần thì càng zoom vào, luôn bám theo điểm giữa.
    const cam = view.cam;
    const xs = S.fighters.map((p) => disp[p].x);
    const tz = clamp(1000 / (Math.abs(xs[0] - xs[1]) + 270), 1.05, 1.75);
    cam.z += (tz - cam.z) * 0.06;
    const vw = W.W / cam.z;
    cam.x += (clamp((xs[0] + xs[1]) / 2 - vw / 2, 0, W.W - vw) - cam.x) * 0.12;
    cam.x = clamp(cam.x, 0, W.W - vw);
    let shx = 0; let shy = 0;
    if (now - fx.shake < 0.3) {
      const k = (1 - (now - fx.shake) / 0.3) * fx.shakeK;
      shx = (Math.random() - 0.5) * k; shy = (Math.random() - 0.5) * k;
    }
    const fat = S.fatality && (S.rstate === 'fatality' || S.phase === 'end') ? S.fatality : null;
    const fage = fat ? (S.phase === 'end' ? 9 : t - fat.at) : 0;
    const overlays = [];    // hiệu ứng 2D vẽ đè lên võ sĩ (khối băng, sét, lửa, tro…)
    const list = S.fighters.map((pid) => {
      const d = disp[pid];
      const o = { key: keyFor(pid), look: lookFor(pid), x: d.x, y: d.y, face: d.face, tint: '', tintK: 1 };
      const fl = now - (flashAt[pid] || 0);
      if (fl < 0.12) { o.tint = 'flash'; o.tintK = 1 - fl / 0.12; }
      const frozen = (frozenUntil[pid] || 0) > now && S.phase === 'play';
      let pose = frozen ? poseFor('hurt', '', 0, 0, 0) : poseOf(pid, d, now);
      if (frozen) { o.tint = 'ice'; overlays.push(() => iceBlock(d)); }
      if (fat && pid === fat.by) {
        if (fat.kind === 'uppercut' && fage < 0.9) pose = attackPose(basePose(), 'upper', 0.1 + fage * 0.35);
        else if (fat.kind === 'lightning' && fage < 1.5) { pose.armF = [2.95, 0.1]; pose.armB = [2.6, 0.3]; }
        else if (fat.kind === 'inferno' && fage < 1.8) { pose.armF = [1.5, 0.08]; pose.armB = [1.38, 0.25]; pose.lean = 0.16; }
      }
      o.pose = pose;
      Object.assign(o, animInfo(pid, d, pose));
      if (fat && pid === fat.by) {
        if (fat.kind === 'uppercut' && fage < 0.9) Object.assign(o, { st: 'atk', mv: 'upper', prog: clamp(fage / 0.65, 0, 1) });
        else if (fat.kind !== 'uppercut' && fage < 1.6) Object.assign(o, { st: 'atk', mv: 'fireball', prog: clamp(fage / 1.2, 0, 1) });
      }
      if (pose.charge !== undefined) {
        const hp3 = R && R.handPos(o.key);
        const [hx, hy] = hp3 ? [hp3[0], W.FLOOR - hp3[1]] : handPos(d, pose);
        overlays.push(() => energyBall(hx, hy, pose.charge, now));
      }
      if (fat && pid === fat.on) {
        Object.assign(o, victimSpec(fat, d, fage, now, overlays));
        Object.assign(o, { st: o.pose.st || 'hurt', mv: '', prog: undefined });
      }
      return o;
    });
    if (R) {
      R.render({ cssW: view.cssW, cssH: view.cssH, dpr: view.dpr, s: view.s, ox: view.ox, oy: view.oy, floorY: W.FLOOR,
        zoom: cam.z, camX: cam.x - shx / (cam.z * view.s) }, list, stains);
    }
    // lớp 2D phía trên: cùng phép chiếu với mặt phẳng giao đấu
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, view.dpr * view.s * view.ox, view.dpr * view.s * view.oy);
    ctx.translate(shx / view.s, shy / view.s);
    ctx.translate(0, W.FLOOR); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -W.FLOOR);
    if (fat) {
      ctx.fillStyle = `rgba(40,0,10,${Math.min(0.5, fage * 0.8)})`;
      ctx.fillRect(cam.x - 200, -600, W.W / cam.z + 400, 1600);
    }
    overlays.forEach((fn) => fn());
    drawProjs(now);
    drawParts(now);
    ambient(now);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    // viền tối kiểu điện ảnh
    const vg = ctx.createRadialGradient(view.cssW / 2, view.cssH * 0.55, view.cssH * 0.35, view.cssW / 2, view.cssH * 0.55, view.cssW * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, view.cssW, view.cssH);
    if (now - fx.flash < 0.25) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - (now - fx.flash) / 0.25)})`;
      ctx.fillRect(0, 0, view.cssW, view.cssH);
    }
    drawHud(now);
    if (!S.me.fighter && S.phase === 'play') {
      const next = S.queue.filter((p) => !S.fighters.includes(p));
      const pos = next.indexOf(S.me.id);
      hudText(`👀 Đang xem${pos >= 0 ? ` · bạn xếp hàng thứ ${pos + 1}` : ''}`, view.cssW / 2, view.cssH - 18, 14);
    }
    const fb = document.querySelector('#pad .fatal');
    const showF = S.rstate === 'finish' && S.winner === S.me.id;
    if (fb.hidden === showF) fb.hidden = !showF;
  }
  requestAnimationFrame(frame);

  function iceBlock(d) {
    ctx.fillStyle = 'rgba(170,220,255,.28)'; ctx.strokeStyle = 'rgba(230,250,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(d.x - 36, W.FLOOR - d.y + 2); ctx.lineTo(d.x - 40, W.FLOOR - d.y - 110); ctx.lineTo(d.x - 14, W.FLOOR - d.y - 140);
    ctx.lineTo(d.x + 30, W.FLOOR - d.y - 132); ctx.lineTo(d.x + 40, W.FLOOR - d.y - 40); ctx.lineTo(d.x + 34, W.FLOOR - d.y + 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.moveTo(d.x - 26, W.FLOOR - d.y - 100); ctx.lineTo(d.x - 16, W.FLOOR - d.y - 60); ctx.stroke();
  }

  const fatalDone = new Set();   // hiệu ứng một lần (bụi, rung) của đòn kết liễu đã chạy
  function once(key, fn) { if (!fatalDone.has(key)) { fatalDone.add(key); fn(); } }

  // Nạn nhân của đòn kết liễu: trả về thông số cho bản 3D (tư thế, độ cao, co giãn, đổi màu) và thêm hiệu ứng 2D vào overlays.
  function victimSpec(fat, d, age, now, overlays) {
    const live = S.phase === 'play';
    const pose = (st) => poseFor(st, '', 0, now, 0);
    if (fat.kind === 'uppercut') {
      // móc hàm hất văng lên trời, lát sau rơi cắm xuống sàn
      if (age < 0.45) return { pose: pose('dizzy') };
      if (age < 1.5) {
        const p = pose('fall'); p.rot = -(age - 0.45) * 10;
        if (live) once(`${fat.at}:up`, () => { sparks(d.x + d.face * 10, 120, '#fff3a0', 22, 700); fx.shake = perf(); fx.shakeK = 14; fx.flash = perf(); });
        return { pose: p, y: (age - 0.45) * 1600 };
      }
      if (age < 2.1) return { pose: pose('fall'), hidden: true };
      if (age < 2.35) { const k = (age - 2.1) / 0.25; return { pose: pose('fall'), y: (1 - k * k) * 650 }; }
      if (live) once(`${fat.at}:crash`, () => { dust(d.x, 18); fx.shake = perf(); fx.shakeK = 16; });
      return { pose: pose('ko'), y: 0 };
    }
    if (fat.kind === 'lightning') {
      // ba tia sét, người cháy đen rồi sụp thành tro
      const strikes = [0.4, 0.75, 1.1];
      const lit = strikes.some((s) => age > s && age < s + 0.1);
      strikes.forEach((s, i) => {
        if (age > s && age < s + 0.16) {
          overlays.push(() => bolt(d.x, now, i + fat.at));
          if (live) once(`${fat.at}:b${i}`, () => { fx.flash = perf(); fx.shake = perf(); fx.shakeK = 10; });
        }
      });
      if (age < 1.5) {
        const burnt = clamp((age - 0.4) / 1.1, 0, 1);
        return { pose: pose(age > 0.4 ? 'hurt' : 'dizzy'), y: 0, tint: lit ? 'white' : burnt ? 'burn' : '', tintK: burnt };
      }
      if (age < 1.8) {
        const k = (age - 1.5) / 0.3;
        overlays.push(() => ashPile(d.x, k, now));
        return { pose: pose('hurt'), y: 0, sy: 1 - k * 0.85, sx: 1 + k * 0.3, tint: 'burn', tintK: 1 };
      }
      overlays.push(() => ashPile(d.x, 1, now));
      return { pose: pose('hurt'), hidden: true };
    }
    // biển lửa bốc lên thiêu rụi
    const k = clamp((age - 0.3) / 1.3, 0, 1);
    if (age > 0.25 && age < 2.8) overlays.push(() => flames(d.x, age < 1.6 ? clamp((age - 0.25) * 1.5, 0, 1) : clamp(1 - (age - 1.6) / 1.2, 0, 1), now));
    if (age < 1.6) return { pose: pose(age > 0.3 ? 'hurt' : 'dizzy'), y: 0, tint: k ? 'burn' : '', tintK: k };
    if (age < 1.9) {
      const q = (age - 1.6) / 0.3;
      overlays.unshift(() => ashPile(d.x, q, now));
      return { pose: pose('hurt'), y: 0, sy: 1 - q * 0.85, sx: 1 + q * 0.3, tint: 'burn', tintK: 1 };
    }
    overlays.unshift(() => ashPile(d.x, 1, now));
    return { pose: pose('hurt'), hidden: true };
  }

  // ---------------------------------------------------------------- bàn phím & nút cảm ứng
  document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || !S || S.phase !== 'play' || !S.me.fighter) return;
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) {
      e.preventDefault();
      const d = KEYMAP[k];
      if (!e.repeat) dirPress(d);
      keys[d] = true;
    } else if (ACTMAP[k]) {
      e.preventDefault();
      if (!e.repeat) action(ACTMAP[k]);
    }
  });
  document.addEventListener('keyup', (e) => {
    const d = KEYMAP[e.key.toLowerCase()];
    if (d) keys[d] = false;
  });
  window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); });

  const pad = $('#pad');
  pad.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pb');
    if (!b) return;
    e.preventDefault();
    ui.touch = true;
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
    b.classList.add('on');
    if (b.dataset.k) { keys[b.dataset.k] = true; dirPress(b.dataset.k); }
    else if (b.dataset.a) action(b.dataset.a);
  });
  const padUp = (e) => {
    const b = e.target.closest('.pb');
    if (!b) return;
    b.classList.remove('on');
    if (b.dataset.k) keys[b.dataset.k] = false;
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => pad.addEventListener(ev, padUp));
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('touchstart', () => { if (!ui.touch) { ui.touch = true; if (S) renderArena(); } }, { passive: true, once: true });

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage,
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onMessage(m) {
    if (m.type === 'fight') onFight(m);
    else if (m.type === 'hit') onHit(m);
    else if (m.type === 'clash') onClash(m);
  }

  function onState(state) {
    const prev = S;
    S = state;
    clockSample(S.now);
    if (!W && S.world) { W = S.world; MV = S.moves; requestAnimationFrame(resize); }
    if (S.phase === 'play') {
      const newMatch = !prev || prev.matchNo !== S.matchNo;
      if (newMatch) { stains.length = 0; remote.clear(); Object.keys(hp).forEach((k) => delete hp[k]); Object.keys(ghost).forEach((k) => delete ghost[k]); parts.length = 0; projs = []; combo = null; }
      if (prev && prev.round !== S.round) { remote.clear(); projs = []; stains.length = 0; S.fighters.forEach((p) => { hp[p] = W.HP; ghost[p] = 1; }); }
      if (S.me.fighter) {
        if (!me || me.g !== S.matchNo) resetMe(!(S.rstate === 'intro'));
        else if (me.r !== S.round) { resetMe(false); }
      }
    }
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    render();
    fresh.forEach(playEvent);
  }

  function playEvent(e) {
    switch (e.type) {
      case 'round': play('bell'); say(e.n === 1 ? 'Round one' : `Round ${e.n}`, 150); break;
      case 'fight': say('Fight!'); break;
      case 'ko':
        if (e.finish) say('Finish them!', 900);
        else if (e.perfect) say('Flawless victory', 1300);
        else say('K. O.', 200);
        break;
      case 'time': say('Time!'); break;
      case 'fatality': {
        const k = e.style;
        if (k === 'uppercut') { setTimeout(() => play('heavy'), 450); setTimeout(() => play('ko'), 2350); }
        else if (k === 'lightning') [400, 750, 1100].forEach((ms) => setTimeout(() => play('thunder'), ms));
        else { setTimeout(() => play('fire'), 300); setTimeout(() => play('burn'), 450); }
        setTimeout(() => play('fatal'), 1600);
        say('Fatality', 1650);
        break;
      }
      case 'win':
        if (e.pid) { play('win'); say(`${charName(e.pid)} wins`, 400); }
        break;
      case 'forfeit': P.toast(`📴 ${nm(e.pid)} mất kết nối quá lâu — xử thua.`, 'info'); break;
      default:
    }
  }

  // ---------------------------------------------------------------- hiệu ứng tương tác
  function bubble(pid, text, cls = '') {
    const r = rectOf(anchorEl(pid));
    if (!r) return;
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + 2) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
  function fly(html, from, to, { dur = 550 } = {}) {
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    el.style.left = '0px'; el.style.top = '0px'; el.style.opacity = '0';
    document.body.appendChild(el);
    const w = el.offsetWidth; const h = el.offsetHeight;
    const anim = el.animate([
      { transform: `translate(${from.left + from.width / 2 - w / 2}px, ${from.top + from.height / 2 - h / 2}px) scale(.7)`, opacity: 1 },
      { transform: `translate(${to.left + to.width / 2 - w / 2}px, ${to.top + to.height / 2 - h / 2}px) scale(1)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
  }
  function onFx(m) {
    const emoji = FX_EMOJI[m.kind] || '✨';
    if (m.to && m.to !== m.from) {
      fly(`<span style="font-size:30px">${emoji}</span>`, rectOf(anchorEl(m.from)), rectOf(anchorEl(m.to)));
      setTimeout(() => bubble(m.to, emoji, 'emoji'), 520);
    } else {
      bubble(m.from, emoji, 'emoji');
    }
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '🐉';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Vào trận bên dưới (thêm bot nếu chưa đủ 2 người)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = S.winner ? '🏆' : '🤝'; cls += ' win';
      title = S.winner ? `${who(S.winner)} thắng trận!` : 'Trận đấu không phân thắng bại';
      sub = `Trận ${S.matchLabel} kết thúc — người thắng giữ võ đài.`;
    } else {
      const [a, b] = S.fighters;
      title = S.practice ? `Luyện tập · ${esc(charName(a))} vs ${esc(charName(b))} (đối thủ tập)` : `Trận ${S.matchLabel} · ${esc(nm(a))} ⚔️ ${esc(nm(b))}`;
      if (!S.me.fighter) sub = S.practice ? `👀 ${esc(nm(a))} đang luyện tập.` : '👀 Bạn đang xem trận này — người thắng giữ võ đài, hàng chờ lên lần lượt.';
      else {
        const c = charInfo(charOf(S.me.id));
        const sp = c ? c.sp : [['🔥', ''], ['🪝', ''], ['💨', '']];
        sub = ui.touch
          ? `Bạn là ${esc(c ? c.name : '')} · ↓→👊 = ${sp[0][0]} ${esc(sp[0][1])} · ←→👊 = ${sp[1][0]} ${esc(sp[1][1])} · →→🦶 = ${sp[2][0]} ${esc(sp[2][1])}`
          : `A/D đi · W nhảy · S ngồi · J đấm · K đá · L đỡ · U ${sp[0][0]} ${esc(sp[0][1])} · I ${sp[1][0]} ${esc(sp[1][1])} · O ${sp[2][0]} ${esc(sp[2][1])} · F kết liễu`;
      }
      if (S.me.fighter) cls += ' mine';
    }
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      let sub;
      const waiting = S.queue.filter((q) => !(S.phase === 'play' && S.fighters.includes(q)));
      const wi = waiting.indexOf(p.id);
      if (p.fighter && S.phase === 'play') sub = `🥊 Đang đấu · phe ${p.side === 0 ? 'đỏ' : 'xanh'}`;
      else if (S.phase === 'play') sub = wi >= 0 ? `⏳ Hàng chờ #${wi + 1}` : '👀 Đang xem';
      else if (wi === 0 && S.phase === 'end' && S.winner === p.id) sub = '👑 Giữ võ đài · lên đài trận tới';
      else if (wi >= 0 && wi < 2) sub = '⚔️ Lên đài trận tới';
      else sub = wi >= 0 ? `⏳ Hàng chờ #${wi - 1}` : '👀 Đang xem';
      const color = p.fighter && S.phase !== 'lobby' ? S.colors[p.side] : 'transparent';
      return `<div class="pcard ${p.fighter && S.phase === 'play' ? 'fighting' : ''}" style="--pc:${color}" data-pid="${esc(p.id)}">
        <div class="ava"><img src="${charPortrait(p.char)}" alt=""></div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${esc(charName(p.id))} · ${sub}</span></div>
        <div class="sc">${p.w}–${p.l}<small>${p.streak >= 2 ? `🔥 chuỗi ${p.streak}` : p.fat ? `💀 ${p.fat}` : 'thắng–thua'}</small></div></div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // Ảnh chân dung võ sĩ: dựng đầu 3D một lần ra canvas phụ rồi dùng lại.
  const portraitCache = new Map();
  let studio = null;
  if (window.MK3D) window.MK3D.onModels(() => { portraitCache.clear(); if (S) render(); });
  const studioCanvas = document.createElement('canvas');
  function charPortrait(id) {
    if (portraitCache.has(id)) return portraitCache.get(id);
    if (!W) return '';
    try {
      studio = studio || window.MK3D.createStudio(studioCanvas, { snapshot: true, bg: '#2a0606' });
      const p = basePose();
      p.armF = [0.25, 0.4]; p.armB = [-0.15, 0.4]; p.lean = 0;   // hạ tay cho khỏi che mặt
      // model chưa tải xong thì chưa chụp (sẽ chụp lại khi MK3D.onModels báo)
      if (!studio.show(CHAR_LOOKS[id] || CHAR_LOOKS.scorpion, p, 1, { char: id, st: 'idle' }) || !studio.render(96, 96, 1, 'head')) return '';
      const url = studioCanvas.toDataURL();
      portraitCache.set(id, url);
      return url;
    } catch (e) { return ''; }
  }
  function charPanel() {
    const mine = charOf(S.me.id);
    const locked = S.phase === 'play' && S.me.fighter;
    const c = charInfo(mine);
    const grid = S.chars.map((ch) => {
      const others = S.players.filter((p) => p.char === ch.id && p.id !== S.me.id).map((p) => p.name);
      return `<button class="ch ${ch.id === mine ? 'on' : ''}" data-char="${ch.id}" ${locked ? 'disabled' : ''}
        title="${esc(ch.name + (others.length ? ` — ${others.join(', ')} cũng chọn` : ''))}">
        <img src="${charPortrait(ch.id)}" alt=""><span>${esc(ch.name)}</span>${others.length ? `<i>${others.length}</i>` : ''}</button>`;
    }).join('');
    const keys = ['↓→ J · U', '←→ J · I', '→→ K · O'];
    const sp = c ? c.sp.map((x, i) => `<div class="mk-sp">${x[0]} <b>${keys[i]}</b><span>${esc(x[1])}</span></div>`).join('') : '';
    return `<div class="panel mk-select"><div class="mk-title">CHOOSE YOUR FIGHTER</div>
      <div class="mk-sel-body">
        <div class="mk-preview"><div id="preview-slot"></div><div class="mk-pname">${esc(c ? c.name : '')}</div>${sp}</div>
        <div class="chgrid">${grid}</div>
      </div></div>`;
  }
  // Võ sĩ xem trước trong màn chọn: đứng thủ thế, thỉnh thoảng múa vài đòn.
  const DEMO = [['idle', ''], ['atk', 'jab'], ['idle', ''], ['atk', 'kick'], ['idle', ''], ['atk', 'upper'], ['win', '']];
  const previewCanvas = document.createElement('canvas');
  previewCanvas.id = 'preview';
  let previewStudio = null;
  function previewLoop() {
    requestAnimationFrame(previewLoop);
    const slot = document.getElementById('preview-slot');
    if (!slot || !S || !W || !MV) return;
    if (previewCanvas.parentNode !== slot) slot.appendChild(previewCanvas);
    const r = previewCanvas.getBoundingClientRect();
    if (!r.width) return;
    try {
      previewStudio = previewStudio || window.MK3D.createStudio(previewCanvas, { bg: '#1c0404' });
    } catch (e) { return; }
    const now = perf();
    const slotNo = Math.floor(now / 1.3) % DEMO.length;
    const [st, mv] = DEMO[slotNo];
    const e = now % 1.3;
    const m = mv && MV[mv];
    if (!previewStudio.show(CHAR_LOOKS[charOf(S.me.id)] || CHAR_LOOKS.scorpion, poseFor(st, mv, e, now, 0), 1,
      { char: charOf(S.me.id), st, mv, prog: m ? Math.min(1, e / (m.st + m.ac + m.rc)) : undefined })) return;
    previewStudio.render(r.width, r.height, Math.min(2, window.devicePixelRatio || 1), 'body');
  }
  requestAnimationFrame(previewLoop);

  // ---------------------------------------------------------------- luyện tập
  const DUMMY_NAMES = { stand: '🧍 Đứng yên', crouch: '🧎 Ngồi', block: '🛡️ Luôn đỡ', jump: '🦘 Nhảy liên tục', cpu: '🤖 Đánh trả' };
  function dummyControls(dis) {
    const d = S.dummy || {};
    return `<div class="settings">
      <div class="setting"><label>🎯 Đối thủ tập làm gì</label><select data-dummy="mode" ${dis}>
        ${S.dummyModes.map((m) => `<option value="${m}" ${m === d.mode ? 'selected' : ''}>${DUMMY_NAMES[m]}${m === 'cpu' ? ` (bot ${LEVEL_NAMES[S.config.bot_level]})` : ''}</option>`).join('')}</select></div>
      <div class="setting"><label>🐉 Võ sĩ của đối thủ tập</label><select data-dummy="char" ${dis}>
        <option value="" ${!d.char ? 'selected' : ''}>🎲 Ngẫu nhiên</option>
        ${S.chars.map((c) => `<option value="${c.id}" ${c.id === d.char ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    </div>`;
  }
  function moveList() {
    const c = charInfo(charOf(S.me.id));
    const rows = [
      ['👊', 'J', 'Đấm'], ['🦶', 'K', 'Đá cao (người đang ngồi né được)'], ['🛡️', 'giữ L', 'Đỡ (đứng hoặc ngồi)'],
      ['💥', '↓ + J', 'Móc hàm — hất tung'], ['🌀', '↓ + K', 'Quét chân — làm ngã'], ['🌪️', '← + K (lùi + đá)', 'Roundhouse — đá xoay hạ gục'],
      ['🤼', 'sát người: → + J', 'Quật — không đỡ được'], ['🦵', 'trên không: J / K', 'Đấm / đá trên không'],
      ['🔁', 'W + ← / →', 'Nhảy lộn vòng'],
    ];
    if (c) ['↓ → J  ·  U', '← → J  ·  I', '→ → K  ·  O'].forEach((k, i) => rows.push([c.sp[i][0], k, `${c.sp[i][1]} (tuyệt chiêu)`]));
    rows.push(['💀', 'F (khi FINISH HIM)', 'Kết liễu — lại gần đối thủ']);
    return `<div class="movelist">${rows.map(([i, k, n]) => `<div class="ml-row"><span class="ml-i">${i}</span><b>${esc(k)}</b><span>${esc(n)}</span></div>`).join('')}</div>`;
  }
  function practicePanel() {
    if (!S.me.host) return '';
    return `<div class="panel"><h3>🥋 Luyện tập<span class="grow"></span><span class="gh-muted" style="font-size:13px">một mình, không tính thắng thua</span></h3>
      ${dummyControls('')}
      <div class="start-row" style="margin-top:12px"><span class="gh-muted">Máu vô hạn · không giới hạn giờ · thử FATALITY thoải mái</span>
        ${btn('practice', '🥋 Vào luyện tập', 'primary')}</div></div>`;
  }
  function trainingPanel() {
    const mine = S.me.fighter;
    return `<div class="panel"><h3>🥋 Luyện tập — ${esc(charName(S.fighters[0]))}<span class="grow"></span>
        ${mine ? btn('practice-finish', '💀 Thử kết liễu', 'small', S.rstate === 'fight' ? '' : 'disabled') + ' ' + btn('stop', '🛑 Thoát', 'small ghost') : ''}</h3>
      ${mine ? dummyControls('') : `<p class="gh-muted" style="margin:0">${esc(nm(S.fighters[0]))} đang luyện tập.</p>`}
      ${mine ? `<h3 style="margin-top:14px">📜 Danh sách chiêu</h3>${moveList()}` : ''}</div>`;
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/vodai/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Võ sĩ ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Chưa có ai đấu cùng? Thêm bot — bot biết đỡ đòn, né chưởng, tung tuyệt chiêu và cả kết liễu!</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= 4 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const moves = [['↓ + J', 'upper'], ['↓ + K', 'sweep'], ['Trên không + K', 'akick']]
      .map(([k, mv]) => `<span class="mv">${MV ? MV[mv].icon : ''} <b>${k}</b> ${MV ? esc(MV[mv].name) : ''}</span>`).join('');
    return `<div class="panel"><h3>⚙️ Luật đấu</h3><div class="settings">
      <div class="setting"><label>🏅 Thắng mấy hiệp</label><select data-cfg="rounds" ${dis}>
        ${S.roundWinsOpt.map((v) => `<option value="${v}" ${v === cfg.rounds ? 'selected' : ''}>${v} hiệp${v > 1 ? ` (đấu tối đa ${v * 2 - 1})` : ''}</option>`).join('')}</select></div>
      <div class="setting"><label>⏱ Thời gian mỗi hiệp</label><select data-cfg="time" ${dis}>
        ${S.roundTimes.map((v) => `<option value="${v}" ${v === cfg.time ? 'selected' : ''}>${v} giây</option>`).join('')}</select></div>
      <div class="setting"><label>🤖 Độ khó của bot</label><select data-cfg="bot_level" ${dis}>
        ${S.botLevels.map((v) => `<option value="${v}" ${v === cfg.bot_level ? 'selected' : ''}>${LEVEL_NAMES[v]}</option>`).join('')}</select></div>
      <label class="switch"><input type="checkbox" data-cfg="fatality" ${cfg.fatality ? 'checked' : ''} ${dis}><span>💀 Kết liễu<small>“KẾT LIỄU ĐI!” sau hiệp quyết định</small></span></label>
    </div><div class="moves-list">${moves}</div></div>`;
  }
  function nextPair() {
    const q = S.queue.filter((p) => player(p));
    return q.length >= 2 ? q.slice(0, 2) : null;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, S.practice ? trainingPanel() : ''); return; }
    const host = S.me.host;
    const pair = nextPair();
    const pairHtml = pair ? `<div class="vs-next">⚔️ Trận tới: <b>${who(pair[0])}</b> đấu <b>${who(pair[1])}</b></div>` : '';
    let html;
    if (S.phase === 'end') {
      const L = S.last || {};
      const rows = [L.a, L.b].filter(Boolean).map((pid) => {
        const p = player(pid);
        const name = p ? p.name : nm(pid);
        const won = pid === L.winner;
        return `<div class="res-row ${won ? 'win' : ''}"><span class="rank">${won ? '🏆' : '🥊'}</span>
          <span class="rname">${esc(name)}${p && p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">👊 ${(L.hits || {})[pid] || 0} đòn trúng${p && p.streak >= 2 ? ` · 🔥 chuỗi ${p.streak} trận` : ''}</span></div>
          <span class="rpts">${(L.rounds || {})[pid] || 0} hiệp<small>${p ? `${p.w} thắng · ${p.l} thua` : ''}</small></span></div>`;
      }).join('');
      const head = L.winner ? `${esc(nm(L.winner))}${L.winner === S.me.id ? ' (bạn)' : ''} thắng!` : 'Không phân thắng bại';
      html = `<div class="panel"><div class="result-head"><div class="trophy">${L.winner ? '🏆' : '🤝'}</div><div>
          <h2>${head}</h2><p>Trận ${L.no || S.matchLabel}${L.fatality ? ` · 💀 ${FATAL_NAMES[L.fatality]}` : ''}</p></div></div>
        <div class="results">${rows}</div>${pairHtml}
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '⚔️ Trận tiếp', 'primary', pair ? '' : 'disabled')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu trận tiếp…</span>'}</div></div>${charPanel()}${practicePanel()}${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div><span class="gh-muted">${S.players.length < 2 ? 'Cần ít nhất 2 người — thêm bot nhé!' : `${S.players.length}/${S.maxPlayers} người — sẵn sàng!`}</span></div>
           ${btn('start', '⚔️ Vào trận', 'primary', S.players.length < 2 ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `${charPanel()}${practicePanel()}<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')}</div></div>
        ${host ? botPanel() : ''}${settingsPanel()}<div class="panel">${pairHtml}${start}</div>`;
    }
    setHTML(el, html);
  }

  function renderArena() {
    const arena = $('#arena');
    const show = S.phase === 'play' || (S.phase === 'end' && S.fighters.length > 0);
    if (arena.hidden === show) { arena.hidden = !show; if (show) requestAnimationFrame(resize); }
    const padOn = ui.touch && S.phase === 'play' && S.me.fighter;
    if (pad.hidden === padOn) pad.hidden = !padOn;
    const c = charInfo(charOf(S.me.id));
    if (c) pad.querySelectorAll('.sp').forEach((b, i) => { if (b.textContent !== c.sp[i][0]) { b.textContent = c.sp[i][0]; b.title = c.sp[i][1]; } });
  }

  // ---------------------------------------------------------------- biểu cảm & menu người chơi
  const SELF_FX = [['laugh', 'Cười'], ['angry', 'Tức'], ['cry', 'Khóc'], ['shock', 'Sốc'], ['think', 'Nghĩ'], ['clap', 'Vỗ tay'], ['dance', 'Nhảy']];
  const OTHER_FX = [['wave', 'Vẫy tay'], ['heart', 'Thả tim'], ['flower', 'Tặng hoa'], ['tomato', 'Ném cà chua'], ['highfive', 'Đập tay'], ['poke', 'Chọc']];
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function renderEmotes() {
    setHTML($('#emotes'), SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('')
      + (S && S.me.host && S.phase === 'play' ? btn('stop', S.practice ? '🛑 Thoát luyện tập' : '🛑 Dừng trận', 'small ghost') : '')
      + '<span class="hint">Nhấn vào người chơi khác để vẫy tay, ném cà chua…</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const mine = id === S.me.id;
    let html = `<div class="pmenu-head">${mine ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(mine ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (!mine && S.me.host && !(S.phase === 'play' && p.fighter)) html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
    menuEl = document.createElement('div');
    menuEl.className = 'pmenu';
    menuEl.innerHTML = html;
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    const mw = menuEl.offsetWidth;
    const x = Math.min(window.innerWidth - mw / 2 - 8, Math.max(mw / 2 + 8, r.left + r.width / 2));
    let y = r.top + 4;
    if (y - menuEl.offsetHeight < 8) y = menuEl.offsetHeight + 8;
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.dataset.target = mine ? '' : id;
  }


  // ---------------------------------------------------------------- thanh bên
  function renderChat() {
    bubbles.update(S.chat);
    const list = $('#chat-list');
    const msgs = S.chat;
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const html = msgs.length ? msgs.map((m) => (m.channel === 'system'
      ? `<div class="msg system">${esc(m.text)}</div>`
      : `<div class="msg"><span class="who" style="color:hsl(${P.hue(m.name || '')},80%,72%)">${esc(m.name)}</span>${esc(m.text)}</div>`)).join('')
      : '<div class="empty-note">Chưa có tin nhắn nào. Chào mọi người đi! 👋</div>';
    if (setHTML(list, html)) {
      if (nearBottom || (msgs.length && msgs[msgs.length - 1].pid === S.me.id)) list.scrollTop = list.scrollHeight;
      if (ui.lastChatId !== null && lastId > ui.lastChatId && ui.tab !== 'chat') {
        ui.unread += msgs.filter((m) => m.id > ui.lastChatId && m.channel !== 'system').length;
      }
      ui.lastChatId = lastId;
    }
    const unread = $('#unread');
    unread.hidden = !ui.unread;
    unread.textContent = ui.unread;
  }
  function renderLog() {
    const html = S.log.length
      ? S.log.map((l) => `<div class="log-item ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${esc(l.text)}</div>`).join('')
      : '<div class="empty-note">Diễn biến các trận đấu sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết trận ${S.matchLabel}` : S.practice ? '🥋 Luyện tập' : `🐉 Trận ${S.matchLabel} · hiệp ${S.round}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Võ Đài Sinh Tử ${ROOM}`;
    renderBanner();
    renderArena();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
  }

  // ---------------------------------------------------------------- sự kiện giao diện
  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': try { audio(); } catch (err) { /* bỏ qua */ } send('start'); break;
        case 'next': try { audio(); } catch (err) { /* bỏ qua */ } send('next_match'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          if (S.practice) { send('stop'); break; }
          P.modal({
            title: 'Dừng trận đấu?', body: '<p>Trận dừng ngay, không tính thắng thua.</p>',
            actions: [{ label: 'Đấu tiếp', kind: 'ghost' }, { label: '🛑 Dừng', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'practice': try { audio(); } catch (err) { /* bỏ qua */ } send('practice', {}); break;
        case 'practice-finish': send('practice_finish'); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: Math.max(1, 4 - S.players.length) }); break;
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link': if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); break;
        default:
      }
      return;
    }
    const chEl = e.target.closest('[data-char]');
    if (chEl && !chEl.disabled) { send('pick_char', { id: chEl.dataset.char }); return; }
    const kickEl = e.target.closest('[data-kick]');
    if (kickEl) {
      closeMenu();
      const id = kickEl.dataset.kick;
      if (player(id) && player(id).bot) { send('kick', { pid: id }); return; }
      P.modal({
        title: 'Mời ra khỏi phòng?', body: `<p>Bạn muốn mời <b>${esc(nm(id))}</b> ra khỏi phòng?</p>`,
        actions: [{ label: 'Huỷ', kind: 'ghost' }, { label: 'Mời ra', kind: 'danger', onClick: () => send('kick', { pid: id }) }],
      });
      return;
    }
    const fxEl = e.target.closest('[data-fx]');
    if (fxEl) {
      send('fx', { kind: fxEl.dataset.fx, target: fxEl.dataset.self ? null : (menuEl && menuEl.dataset.target) || null });
      closeMenu();
      return;
    }
    const pc = e.target.closest('.pcard');
    if (pc && pc.dataset.pid) { openMenu(pc.dataset.pid, pc); return; }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('change', (e) => {
    const dm = e.target.closest('[data-dummy]');
    if (dm) { send('dummy', { [dm.dataset.dummy]: dm.value }); return; }
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'rounds' || key === 'time') v = Number(v);
    send('config', { [key]: v });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (text && send('chat', { text })) input.value = '';
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-body').forEach((x) => { x.hidden = x.dataset.body !== ui.tab; });
    if (ui.tab === 'chat') { ui.unread = 0; $('#unread').hidden = true; const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
    if (ui.tab === 'log') { const l = $('#log-list'); l.scrollTop = l.scrollHeight; }
  }));

  $('#btn-sound').addEventListener('click', () => {
    ui.sound = !ui.sound;
    try { localStorage.setItem('vodai_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('bell'); else if (window.speechSynthesis) speechSynthesis.cancel();
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.fighter && !S.practice) {
      P.modal({
        title: 'Rời trận đấu?',
        body: '<p>Bạn đang đấu — rời phòng quá 10 giây sẽ bị <b>xử thua</b>.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
