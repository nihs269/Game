(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái đầy đủ (gửi khi có thay đổi)
  let conn = null;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true };
  try { ui.sound = localStorage.getItem('chienbinh_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
  const colorOf = (id) => { const p = player(id); return (p && p.color) || '#cfd8ff'; };
  const isTeams = () => S && (S.mode === 'team' || S.mode === 'ctf');
  let cast = null;
  function anchorEl(pid) {
    const a = cast && !$('#cast').hidden && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);

  // ---------------------------------------------------------------- âm thanh
  let actx = null;
  let noiseBuf = null;
  function audio() {
    if (!ui.sound) return null;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      if (!noiseBuf) {
        noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return actx;
    } catch (e) { return null; }
  }
  function beep(notes) {
    const a = audio();
    if (!a) return;
    let t = a.currentTime;
    notes.forEach(([freq, dur, type = 'sine', vol = 0.08]) => {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur);
      t += dur * 0.8;
    });
  }
  // Tiếng súng / nổ: tiếng ồn trắng qua bộ lọc, to nhỏ theo khoảng cách.
  function boom(dur, freq, vol) {
    const a = audio();
    if (!a || vol < 0.004) return;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = a.createGain();
    const t = a.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t); src.stop(t + dur);
  }
  const SHOT_SND = { pistol: [0.09, 2600, 0.12], smg: [0.06, 3200, 0.07], shotgun: [0.22, 1500, 0.2], sniper: [0.3, 1800, 0.22], rocket: [0.35, 700, 0.16], laser: [0.12, 6000, 0.08] };
  function shotSound(kind, x, y) {
    const s = SHOT_SND[kind] || SHOT_SND.pistol;
    const v = s[2] * hearing(x, y);
    boom(s[0], s[1], v);
    if (kind === 'laser') beep([[1400, 0.1, 'sawtooth', 0.03 * hearing(x, y)]]);
  }
  function hearing(x, y) {
    const c = cam();
    const d = Math.hypot(x - (c.x + c.w / 2), y - (c.y + c.h / 2));
    return clamp(1 - d / 1600, 0.05, 1);
  }
  const SOUNDS = {
    tick: () => [[880, 0.05, 'square', 0.03]],
    go: () => [[523, 0.1, 'square', 0.05], [784, 0.18, 'square', 0.05]],
    pick: () => [[660, 0.06, 'triangle', 0.06], [990, 0.1, 'triangle', 0.06]],
    hurt: () => [[180, 0.08, 'square', 0.05]],
    die: () => [[300, 0.12, 'sawtooth', 0.05], [150, 0.3, 'sawtooth', 0.05]],
    kill: () => [[880, 0.06, 'square', 0.04], [1320, 0.12, 'square', 0.04]],
    flag: () => [[523, 0.08], [659, 0.08], [784, 0.16]],
    cap: () => [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
    empty: () => [[200, 0.05, 'square', 0.04]],
  };
  const play = (k) => beep(SOUNDS[k]());

  // ---------------------------------------------------------------- đồng hồ chung với máy chủ
  const clockSamples = [];
  let clockOff = null;
  function clockSample(serverTs) {
    clockSamples.push(serverTs - performance.now() / 1000);
    if (clockSamples.length > 120) clockSamples.shift();
    clockOff = Math.max(...clockSamples);
  }
  const serverNow = () => performance.now() / 1000 + (clockOff || 0);

  // ---------------------------------------------------------------- vật lý (giống hệt world.py)
  function stepBody(b, move, jump, drop, dt, mp, now) {
    const Ph = S.phys;
    const kx = b.kx || 0;
    b.vx = move * Ph.RUN + kx;
    b.kx = Math.abs(kx) > 5 ? kx * Math.max(0, 1 - 7 * dt) : 0;
    if (jump && b.ground) { b.vy = -Ph.JUMP; b.ground = false; }
    if (drop && b.ground && b.y < mp.ground - 1) { b.dropUntil = now + Ph.DROP; b.ground = false; b.y += 2; }
    b.vy = Math.min(Ph.MAXFALL, b.vy + Ph.G * dt);
    const ox = b.x; const oy = b.y;
    const nx = clamp(ox + b.vx * dt, Ph.HW, mp.w - Ph.HW);
    let ny = oy + b.vy * dt;
    b.ground = false;
    if (b.vy >= 0) {
      let top = ny >= mp.ground ? mp.ground : null;
      if (now >= (b.dropUntil || 0)) {
        for (const [px, py, pw] of mp.plats) {
          if (oy <= py + 0.5 && ny >= py && nx >= px - 6 && nx <= px + pw + 6 && (top === null || py < top)) top = py;
        }
      }
      if (top !== null) { ny = top; b.vy = 0; b.ground = true; }
    }
    b.x = nx; b.y = ny;
  }

  // ---------------------------------------------------------------- toàn cảnh từ máy chủ (30 lần/giây)
  let snap = null;                // gói cw mới nhất
  const remote = new Map();       // pid → [{t, x, y, aim, s, alive, life, ...}]
  const fxq = [];                 // hiệu ứng đang chạy (nổ, số sát thương, hạt…)
  const feed = [];                // bảng hạ gục góc phải
  let lastNadeId = 0;
  const F = { x: 0, y: 1, vx: 2, vy: 3, aim: 4, s: 5, hp: 6, armor: 7, wpn: 8, ammo: 9, gren: 10, alive: 11, life: 12, inv: 13, t: 14, resp: 15, flag: 16 };
  function onWorld(m) {
    if (!S || m.g !== S.gameNo) return;
    clockSample(m.ts);
    snap = m;
    for (const [pid, v] of Object.entries(m.p)) {
      let buf = remote.get(pid);
      if (!buf) { buf = []; remote.set(pid, buf); }
      if (buf.length && m.ts <= buf[buf.length - 1].t) continue;
      buf.push({ t: m.ts, x: v[F.x], y: v[F.y], aim: v[F.aim], s: v[F.s], alive: v[F.alive], life: v[F.life], inv: v[F.inv], vx: v[F.vx] });
      if (buf.length > 30) buf.shift();
    }
    const mine = m.p[S.me.id];
    if (mine && me && mine[F.life] !== me.life) me = null;     // vừa hồi sinh → đặt lại nhân vật của mình
    m.fx.forEach(onFxEvent);
  }
  function remoteAt(pid, rt) {
    const buf = remote.get(pid);
    if (!buf || !buf.length) return null;
    let a = buf[0];
    if (rt <= a.t) return a;
    for (let i = 1; i < buf.length; i++) {
      const b = buf[i];
      if (rt <= b.t) {
        if (a.life !== b.life || a.alive !== b.alive) return b;
        const f = (rt - a.t) / (b.t - a.t || 1);
        let da = b.aim - a.aim;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        return { ...b, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, aim: a.aim + da * f };
      }
      a = b;
    }
    return buf[buf.length - 1];
  }
  const pv = (pid) => (snap && snap.p[pid]) || null;

  // ---------------------------------------------------------------- nhân vật của mình
  const keys = { left: false, right: false };
  const input = { jump: false, drop: false, firing: false, px: null, py: null };
  let me = null;
  let lastFire = 0;
  let lastSent = 0;
  const playing = () => S && S.phase === 'play' && S.me.playing;
  function resetMe() {
    const v = pv(S.me.id);
    const life = v ? v[F.life] : S.me.life;
    const sx = v ? v[F.x] : (S.me.spawn ? S.me.spawn[0] : 100);
    const sy = v ? v[F.y] : (S.me.spawn ? S.me.spawn[1] : 0);
    me = { life, x: sx, y: sy, vx: 0, vy: 0, kx: 0, ground: true, dropUntil: 0, aim: v ? v[F.aim] : 0, s: 'idle', walk: 0 };
  }
  function myAlive() { const v = pv(S.me.id); return v ? !!v[F.alive] : S.stage !== 'over'; }
  function stepMe(dt) {
    const mp = S.map;
    const now = performance.now() / 1000;
    const frozen = S.stage !== 'fight';
    const move = frozen ? 0 : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    stepBody(me, move, !frozen && input.jump, !frozen && input.drop, dt, mp, now);
    input.jump = false; input.drop = false;
    me.s = me.vy < 0 ? 'jump' : !me.ground ? 'fall' : move ? 'run' : 'idle';
    if (move && me.ground) me.walk += dt * 12;
    // Ngắm theo con trỏ
    if (input.px !== null) {
      const w = screenToWorld(input.px, input.py);
      me.aim = Math.atan2(w.y - (me.y - SHOULDER), w.x - me.x);
    }
    const t = performance.now();
    if (t - lastSent > 33) {
      lastSent = t;
      send('pos', {
        l: me.life, ts: serverNow(), x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10,
        vx: Math.round(me.vx), vy: Math.round(me.vy), a: Math.round(me.aim * 1000) / 1000, s: me.s,
      });
    }
    // Bắn: giữ chuột / chạm
    if (input.firing && S.stage === 'fight') {
      const v = pv(S.me.id);
      const wpn = v ? v[F.wpn] : 'pistol';
      const cd = (S.weapons[wpn] || S.weapons.pistol).cd;
      if (t - lastFire >= cd * 1000) {
        lastFire = t;
        send('fire', { l: me.life, x: Math.round(me.x), y: Math.round(me.y), a: Math.round(me.aim * 1000) / 1000 });
        muzzle.at = t; muzzle.kind = wpn;
      }
    }
  }
  const muzzle = { at: 0, kind: 'pistol' };
  function throwNade() {
    if (!playing() || !me || !myAlive() || S.stage !== 'fight') return;
    send('nade', { l: me.life, a: Math.round(me.aim * 1000) / 1000 });
  }

  // ---------------------------------------------------------------- hiệu ứng từ máy chủ
  const SHOULDER = 37;          // tâm xoay của súng (cao hơn bàn chân) — khớp game.py
  const GUN_LEN = 36;
  const anims = new Map();      // pid → trạng thái hoạt hình (bước chân, tiếp đất, giật súng, chớp trắng)
  function anim(pid) {
    let a = anims.get(pid);
    if (!a) { a = { walk: 0, lastX: null, air: false, landAt: 0, recoilAt: 0, kind: 'pistol', flashAt: 0, dustAt: 0 }; anims.set(pid, a); }
    return a;
  }
  function onFxEvent(e) {
    const k = e[0];
    const wall = performance.now();
    if (k === 'shot') {
      const pid = e[1];
      const st = pid === S.me.id && me ? me : remoteAt(pid, serverNow() - 0.1);
      if (st) {
        shotSound(e[2], st.x, st.y);
        if (e[2] !== 'laser' && e[2] !== 'rocket') {
          const face = Math.cos(st.aim) >= 0 ? 1 : -1;
          const n = e[2] === 'shotgun' ? 1 : 1;
          for (let i = 0; i < n; i++) {
            parts.push({ type: 'shell', x: st.x + Math.cos(st.aim) * 12, y: st.y - SHOULDER + Math.sin(st.aim) * 12, vx: -face * (60 + Math.random() * 90), vy: -(220 + Math.random() * 140), floor: st.y, at: wall, life: 1.3, red: e[2] === 'shotgun', rot: Math.random() * 6 });
          }
        }
      }
      if (pid !== S.me.id) { const a = anim(pid); a.recoilAt = wall; a.kind = e[2]; }
    } else if (k === 'hit') {
      const [, pid, amount, hx, hy, kx, ky] = e;
      anim(pid).flashAt = wall;
      parts.push({ type: 'num', x: hx, y: hy - 14, text: `-${amount}`, at: wall, life: 0.9, color: pid === S.me.id ? '#ff6b6b' : amount >= 40 ? '#ffa94d' : '#ffe66d', size: amount >= 40 ? 24 : 18 });
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2; const sp = 120 + Math.random() * 260;
        parts.push({ type: 'spark', x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, at: wall, life: 0.35, color: i % 2 ? '#fff3b0' : '#ffd166', g: 600 });
      }
      if (pid === S.me.id) {
        hurt.at = wall;
        play('hurt');
        if (me) { me.kx += kx; me.vy += ky; if (ky < -100) me.ground = false; }
      }
    } else if (k === 'ex') {
      const [, x, y, r] = e;
      parts.push({ type: 'flash', x, y, r: r * 1.4, at: wall, life: 0.18 });
      parts.push({ type: 'fire', x, y, r, at: wall, life: 0.5 });
      parts.push({ type: 'ring', x, y, r: r * 1.3, at: wall, life: 0.4 });
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2; const d = Math.random() * r * 0.5;
        parts.push({ type: 'smoke', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * 40, vy: -30 - Math.random() * 50, r: 14 + Math.random() * 18, at: wall + 80, life: 1.1 + Math.random() * 0.6, dark: true });
      }
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2; const sp = 200 + Math.random() * 520;
        parts.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, at: wall, life: 0.5 + Math.random() * 0.4, color: i % 3 ? '#ffb347' : '#fff3b0', g: 1400, big: true });
      }
      boom(0.7, 500, 0.35 * hearing(x, y));
      const c = cam();
      if (Math.abs(x - (c.x + c.w / 2)) < c.w) shake.at = wall;
    } else if (k === 'die') {
      const st = (me && e[1] === S.me.id) ? me : remoteAt(e[1], serverNow() - 0.1);
      if (st) {
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          parts.push({ type: 'smoke', x: st.x + Math.cos(a) * 14, y: st.y - 36 + Math.sin(a) * 18, vx: Math.cos(a) * 70, vy: Math.sin(a) * 50 - 20, r: 12 + Math.random() * 10, at: wall, life: 0.7 });
        }
        parts.push({ type: 'ghost', x: st.x, y: st.y - 40, at: wall, life: 1.6, color: colorOf(e[1]) });
      }
      if (e[1] === S.me.id) play('die');
    } else if (k === 'spawn') {
      const v = pv(e[1]);
      if (v) parts.push({ type: 'beam', x: v[F.x], y: v[F.y], at: wall, life: 0.7, color: colorOf(e[1]) });
    } else if (k === 'pick') {
      if (e[1] === S.me.id) {
        play('pick');
        const it = S.items[e[2]];
        if (it && me) parts.push({ type: 'num', x: me.x, y: me.y - 100, text: `+ ${it.name}`, at: wall, life: 1.3, color: '#9be15d', size: 17 });
      }
    } else if (k === 'empty') {
      if (e[1] === S.me.id) { play('empty'); if (me) parts.push({ type: 'num', x: me.x, y: me.y - 100, text: 'Hết đạn!', at: wall, life: 1.2, color: '#ffb547', size: 17 }); }
    } else if (k === 'toss') {
      beep([[500, 0.06, 'triangle', 0.04 * hearing(...posOf(e[1]))]]);
    } else if (k === 'dust') {
      parts.push({ type: 'smoke', x: e[1], y: e[2] - 4, vx: (Math.random() - 0.5) * 40, vy: -30, r: 5, at: wall, life: 0.4 });
    }
  }
  function posOf(pid) {
    if (pid === S.me.id && me) return [me.x, me.y];
    const st = remoteAt(pid, serverNow() - 0.1);
    return st ? [st.x, st.y] : [0, 0];
  }
  const parts = fxq;
  const hurt = { at: 0 };
  const shake = { at: 0 };

  // ---------------------------------------------------------------- canvas & camera
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let view = { dpr: 1, cssW: 0, cssH: 0 };
  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    view = { dpr, cssW: r.width, cssH: r.height };
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
  window.addEventListener('resize', resize);

  const camState = { x: 0, y: 0, ok: false };
  let camCache = { x: 0, y: 0, w: 1150, h: 650, s: 1 };
  function cam() { return camCache; }
  function updateCam(dt) {
    const mp = S.map;
    const spectating = !playing();
    const w = spectating ? mp.w : Math.min(mp.w, view.cssW < 700 ? 950 : 1150);
    const s = view.cssW / w;
    const h = view.cssH / s;
    let fx = mp.w / 2; let fy = mp.ground - h / 2 + 60;
    if (!spectating && me) { fx = me.x + Math.cos(me.aim) * 90; fy = me.y - 70; }
    const edge = touchDevice && !spectating ? 170 : 0;     // điện thoại: chừa chỗ cho nút bấm ở hai mép
    const tx = clamp(fx - w / 2, -edge, Math.max(0, mp.w - w) + edge);
    let ty = clamp(fy - h / 2, Math.min(0, mp.h - h) - 40, Math.max(0, mp.h - h));
    if (h > mp.h) ty = mp.h - h;
    if (!camState.ok) { camState.x = tx; camState.y = ty; camState.ok = true; }
    const k = Math.min(1, dt * 7);
    camState.x += (tx - camState.x) * k;
    camState.y += (ty - camState.y) * k;
    camCache = { x: camState.x, y: camState.y, w, h, s };
  }
  function screenToWorld(px, py) {
    const c = cam();
    return { x: c.x + px / c.s, y: c.y + py / c.s };
  }

  // ---------------------------------------------------------------- công cụ vẽ
  const FONT = '"Baloo 2", "Be Vietnam Pro", system-ui, sans-serif';
  if (document.fonts) document.fonts.load('800 20px "Baloo 2"').catch(() => {});
  const INK = '#1a1626';        // màu viền (kiểu hoạt hình)
  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fillStroke(fill, lw = 1.6) {
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke();
  }
  function box(x, y, w, h, r, fill, lw) { roundRect(x, y, w, h, r); fillStroke(fill, lw); }
  function shadeHex(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * (pct < 0 ? c : 255 - c))));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---------------------------------------------------------------- nhân vật (dựng từ hình chibi của người chơi)
  // Ảnh nhân vật được vẽ sẵn ra canvas (bỏ ghế ngồi, bóng, hai tay); chân cắt riêng để đánh tay chân khi chạy.
  const K = 0.6;                // 1 đơn vị trong hình nhân vật = 0.6 px thế giới
  const sprites = new Map();
  function sprite(p) {
    const key = p.id + JSON.stringify(p.look || {});
    let sp = sprites.get(key);
    if (sp) return sp;
    const L = window.Avatar.sanitize(p.look, p.id);
    sp = { ready: false, skin: L.skin, sleeve: L.outfitColor };
    const img = new Image();
    img.onload = () => {
      const R = 2.4;
      const c = document.createElement('canvas');
      c.width = 100 * R; c.height = 166 * R;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const w = document.createElement('canvas');
      w.width = c.width; w.height = c.height;
      const g = w.getContext('2d');
      g.drawImage(c, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#fff'; g.fillRect(0, 0, w.width, w.height);
      Object.assign(sp, { body: c, white: w, R, ready: true });
    };
    // ảnh bộ phận phải nhúng thẳng vào SVG thì mới vẽ được lên canvas
    window.Avatar.svgInline(p.look, { seed: p.id }).then((s) => {
      s = s.replace(/<svg /, '<svg width="100" height="166" ')
        .replace(/(<svg[^>]*>)/, '$1<style>.av-seat,.av-shadow,.av-arm,.av-tears,.av-ec,.av-ew,.av-mo,.av-md{display:none}</style>');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    });
    sprites.set(key, sp);
    return sp;
  }
  // Vẽ một vùng (u0..u1, v0..v1 theo toạ độ hình nhân vật) — gốc toạ độ hiện tại là bàn chân.
  function part(src, R, u0, v0, u1, v1) {
    ctx.drawImage(src, u0 * R, (v0 + 16) * R, (u1 - u0) * R, (v1 - v0) * R, (u0 - 50) * K, (v0 - 140) * K, (u1 - u0) * K, (v1 - v0) * K);
  }

  // Súng vẽ theo trục x (0 = vai, hướng nòng sang phải).
  function drawGun(kind) {
    switch (kind) {
      case 'smg':
        box(-6, -3, 10, 6, 2, '#3a3f4b');
        box(2, -6, 24, 10, 3, '#2f3b52');
        box(13, 3, 6, 11, 2, '#1f2733');
        box(25, -3.5, 10, 5, 1.5, '#4b5563');
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(5, -5, 18, 2);
        return 36;
      case 'shotgun':
        box(-10, -4, 16, 8, 3, '#8d5524');
        box(4, -6, 12, 9, 2, '#3d3d46');
        box(14, -6, 32, 4.5, 1.5, '#55555f');
        box(20, -1.5, 13, 6, 2, '#a0673a');
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(16, -5.5, 28, 1.5);
        return 46;
      case 'sniper':
        box(-12, -4, 15, 9, 3, '#5d4630');
        box(2, -5, 22, 8, 2, '#3b4b2f');
        box(22, -2.5, 36, 4, 1.5, '#2b3324');
        box(6, -12, 17, 5.5, 2, '#15161c');
        ctx.fillStyle = '#5ec8ff'; ctx.beginPath(); ctx.arc(23, -9.2, 2.2, 0, Math.PI * 2); ctx.fill();
        box(9, 3, 4, 8, 1.5, '#2b3324');
        return 58;
      case 'rocket':
        box(-14, -7, 54, 13, 5, '#5b6b34');
        ctx.fillStyle = '#3f4a24'; ctx.fillRect(-4, -7, 3, 13); ctx.fillRect(26, -7, 3, 13);
        ctx.beginPath(); ctx.moveTo(40, -7); ctx.lineTo(48, -3.5); ctx.lineTo(48, 2.5); ctx.lineTo(40, 6); ctx.closePath(); fillStroke('#c0392b');
        box(6, 5, 5, 8, 1.5, '#2d2d33');
        box(12, -12, 6, 5, 1.5, '#2d2d33');
        return 48;
      case 'laser':
        box(-4, -5, 12, 9, 3, '#d9dcf2');
        box(6, -7, 22, 12, 5, '#eef0ff');
        box(26, -3.5, 10, 6, 2, '#b8bde0');
        ctx.save(); ctx.shadowColor = '#e040fb'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#e040fb'; ctx.fillRect(9, -2, 24, 3);
        ctx.restore();
        box(13, 4, 5, 8, 1.5, '#7b61ff');
        return 37;
      default:
        box(4, -5, 20, 7, 2, '#4a4f5c');
        ctx.beginPath(); ctx.moveTo(6, 1); ctx.lineTo(13, 1); ctx.lineTo(11, 11); ctx.lineTo(5, 11); ctx.closePath(); fillStroke('#2c2f38');
        ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(6, -4, 16, 1.5);
        return 24;
    }
  }
  function muzzleFlash(len, kind, t) {
    const k = 1 - t;
    ctx.save();
    ctx.translate(len + 4, 0);
    ctx.globalCompositeOperation = 'lighter';
    const big = kind === 'shotgun' || kind === 'rocket' || kind === 'sniper';
    const r1 = (big ? 20 : 13) * (0.7 + 0.3 * k); const r2 = r1 * 0.38;
    ctx.fillStyle = kind === 'laser' ? 'rgba(224,64,251,.9)' : 'rgba(255,214,90,.95)';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 ? r2 : (i === 0 ? r1 * 1.5 : r1);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.75);
    }
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function limb(x0, y0, x1, y1, color, w) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = w + 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function hand(x, y, skin) {
    ctx.beginPath(); ctx.arc(x, y, 3.8, 0, Math.PI * 2); fillStroke(skin, 1.5);
  }

  // Màu theo góc nhìn của mình: xanh lá = mình, xanh dương = đồng đội, đỏ = địch.
  const REL = { me: '#3ecf8e', ally: '#4d8df7', enemy: '#ff5a5f' };
  function relOf(pid, isMe) {
    if (isMe) return 'me';
    if (!isTeams()) return 'enemy';
    const mine = playing() ? (player(S.me.id) || {}).team : null;
    if (mine === null || mine === undefined) return (player(pid) || {}).team === 1 ? 'ally' : 'enemy';   // người xem: đội Xanh / Đỏ
    return (player(pid) || {}).team === mine ? 'ally' : 'enemy';
  }
  // Đồng phục đội: khăn buộc đầu (đuôi khăn bay phía sau) + đai chéo trước ngực. Toạ độ theo hình nhân vật.
  function drawUniform(col, wall, speed) {
    const U = (u) => (u - 50) * K; const V = (v) => (v - 140) * K;
    // đai chéo
    ctx.beginPath();
    ctx.moveTo(U(36), V(75)); ctx.lineTo(U(44), V(75)); ctx.lineTo(U(66), V(101)); ctx.lineTo(U(58), V(101)); ctx.closePath();
    fillStroke(col, 1.2);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.arc(U(51), V(88), 2.2, 0, Math.PI * 2); ctx.fill();
    // đuôi khăn
    const wv = Math.sin(wall / 110) * (1.5 + speed * 2.5);
    for (const [dy, len] of [[0, 1], [3.2, 0.8]]) {
      ctx.beginPath();
      ctx.moveTo(U(21), V(21) + dy);
      ctx.quadraticCurveTo(U(21) - 8 * len, V(21) + dy + 2 + wv, U(21) - 15 * len - speed * 4, V(21) + dy + 6 + wv * 1.6 - speed * 5);
      ctx.lineTo(U(21) - 13 * len - speed * 4, V(21) + dy + 10 + wv * 1.6 - speed * 5);
      ctx.quadraticCurveTo(U(21) - 6 * len, V(21) + dy + 6 + wv, U(22), V(25) + dy);
      ctx.closePath();
      fillStroke(dy ? shadeHex(col, -20) : col, 1.2);
    }
    // khăn quanh trán
    ctx.beginPath();
    ctx.moveTo(U(20.5), V(18)); ctx.quadraticCurveTo(U(50), V(12), U(79.5), V(18));
    ctx.lineTo(U(80), V(25)); ctx.quadraticCurveTo(U(50), V(19), U(20), V(25)); ctx.closePath();
    fillStroke(col, 1.4);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.beginPath(); ctx.moveTo(U(27), V(18.5)); ctx.quadraticCurveTo(U(50), V(13.5), U(73), V(18.5)); ctx.lineTo(U(73), V(20)); ctx.quadraticCurveTo(U(50), V(15), U(27), V(20)); ctx.closePath(); ctx.fill();
  }

  function drawFighter(p, st, info, wall, isMe) {
    const sp = sprite(p);
    const a = anim(p.id);
    const face = Math.cos(st.aim) >= 0 ? 1 : -1;
    const color = colorOf(p.id);
    const rel = relOf(p.id, isMe);
    const rc = REL[rel];
    const uni = rel === 'enemy' ? REL.enemy : REL.ally;     // đồng phục: phe mình xanh dương, phe địch đỏ
    // hoạt hình: bước chân, tiếp đất
    const air = st.s === 'jump' || st.s === 'fall';
    if (a.lastX !== null) a.walk += Math.abs(st.x - a.lastX) / 22;
    a.lastX = st.x;
    if (a.air && !air) {
      a.landAt = wall;
      for (let i = 0; i < 4; i++) parts.push({ type: 'smoke', x: st.x + (i - 1.5) * 10, y: st.y - 3, vx: (i - 1.5) * 50, vy: -20, r: 5 + Math.random() * 4, at: wall, life: 0.45 });
    }
    a.air = air;
    if (st.s === 'run' && !air && wall - a.dustAt > 180) {
      a.dustAt = wall;
      parts.push({ type: 'smoke', x: st.x - face * 10, y: st.y - 3, vx: -face * 30, vy: -15, r: 3.5 + Math.random() * 3, at: wall, life: 0.35 });
    }
    const running = st.s === 'run' && !air;
    const land = clamp(1 - (wall - a.landAt) / 140, 0, 1);
    const sy = 1 - land * 0.12; const sx = 1 + land * 0.1;
    const bob = running ? -Math.abs(Math.sin(a.walk)) * 3 : Math.sin(wall / 400) * 0.8;
    const recoil = clamp(1 - (wall - (isMe ? muzzle.at : a.recoilAt)) / 110, 0, 1);
    const kind = info.wpn;

    ctx.save();
    ctx.translate(st.x, st.y);
    // bóng dưới chân + vòng màu đội
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(0, 1, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rc; ctx.globalAlpha = 0.9; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 1, 23, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.scale(sx, sy);
    const px = 0; const py = -SHOULDER + bob;
    const aimL = st.aim;
    const fl = face;
    const gp = (d, o) => [px + Math.cos(aimL) * d - Math.sin(aimL) * o * fl, py + Math.sin(aimL) * d + Math.cos(aimL) * o * fl];
    const back = -recoil * 5;
    const fore = gp(26 + back, 3);
    const grip = gp(11 + back, 6);
    const sleeve = sp.sleeve || color;
    // tay sau (phía xa) — vẽ trước thân
    limb(-fl * 5, -39 + bob, fore[0], fore[1], sleeve, 7);
    if (info.flag !== null && info.flag !== undefined) drawFlagCloth(-fl * 12, -14 + bob, S.teamColors[info.flag], wall / 160, 0.55, -fl);
    // thân (ảnh nhân vật)
    ctx.save();
    ctx.scale(fl, 1);
    if (sp.ready) {
      const leg = running ? Math.sin(a.walk) * 0.55 : air ? 0.45 : 0;
      for (const [u0, u1, hx, ang] of [[28, 50, 41, air ? -leg : leg], [50, 72, 59, air ? leg * 0.4 : -leg]]) {
        ctx.save();
        const hpx = (hx - 50) * K; const hpy = (106 - 140) * K;
        ctx.translate(hpx, hpy); ctx.rotate(ang); ctx.translate(-hpx, -hpy);
        part(sp.body, sp.R, u0, 100, u1, 143);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(0, bob);
      ctx.rotate(clamp((st.vx || 0) / 340, -1, 1) * 0.05 * fl);
      part(sp.body, sp.R, 0, -16, 100, 108);
      if (isTeams()) drawUniform(uni, wall, clamp(Math.abs(st.vx || 0) / 340, 0, 1));
      const fa = clamp(1 - (wall - a.flashAt) / 120, 0, 1);
      if (fa > 0) { ctx.globalAlpha = fa * 0.85; part(sp.white, sp.R, 0, -16, 100, 143); ctx.globalAlpha = 1; }
      ctx.restore();
    } else {
      box(-14, -60, 28, 50, 12, color);
    }
    ctx.restore();
    // súng
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(aimL - recoil * 0.12 * fl);
    if (fl < 0) ctx.scale(1, -1);
    ctx.translate(back, 0);
    ctx.scale(1.3, 1.3);           // súng to hơn chút cho dễ nhìn
    const len = drawGun(kind);
    const fa = clamp((wall - (isMe ? muzzle.at : a.recoilAt)) / 70, 0, 1);
    if (fa < 1) muzzleFlash(len, kind, fa);
    ctx.restore();
    // tay trước + băng tay màu đội
    limb(fl * 6, -39 + bob, grip[0], grip[1], sleeve, 7.5);
    if (isTeams()) {
      const mx = fl * 6 + (grip[0] - fl * 6) * 0.35; const my = -39 + bob + (grip[1] + 39 - bob) * 0.35;
      ctx.fillStyle = uni; ctx.beginPath(); ctx.arc(mx, my, 4.4, 0, Math.PI * 2); ctx.fill();
    }
    hand(grip[0], grip[1], sp.skin || '#f2c9a0');
    hand(fore[0], fore[1], sp.skin || '#f2c9a0');
    ctx.restore();

    // khiên bất tử (vừa hồi sinh)
    if (info.inv) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(wall / 90) * 0.15;
      const g = ctx.createRadialGradient(st.x, st.y - 40, 10, st.x, st.y - 40, 52);
      g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(0.8, 'rgba(120,200,255,.35)'); g.addColorStop(1, 'rgba(200,240,255,.9)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(st.x, st.y - 40, 52, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // bảng tên + máu
    const name = isMe ? 'Bạn' : p.name;
    const ty = st.y - 112;
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = Math.min(110, ctx.measureText(name).width + 14);
    ctx.fillStyle = 'rgba(14,16,34,.75)';
    roundRect(st.x - tw / 2, ty - 9, tw, 18, 9); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rc; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(name.length > 14 ? name.slice(0, 13) + '…' : name, st.x, ty + 1);
    // thanh máu: xanh lá = mình, xanh dương = đồng đội, đỏ = địch
    const hp = clamp(info.hp / S.maxHp, 0, 1);
    const bw = 62; const bh = 8; const by = ty + 12;
    ctx.fillStyle = 'rgba(14,16,34,.85)'; roundRect(st.x - bw / 2 - 2, by, bw + 4, bh + 4, 5); ctx.fill();
    if (hp > 0) {
      const hg = ctx.createLinearGradient(0, by + 2, 0, by + 2 + bh);
      hg.addColorStop(0, shadeHex(rc, 25)); hg.addColorStop(1, shadeHex(rc, -12));
      ctx.fillStyle = hg; roundRect(st.x - bw / 2, by + 2, Math.max(bh, bw * hp), bh, 4); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    for (let i = 1; i < 4; i++) ctx.fillRect(st.x - bw / 2 + (bw * i) / 4 - 0.5, by + 2, 1, bh);   // vạch chia 25 máu
    if (info.armor > 0) {
      ctx.fillStyle = 'rgba(14,16,34,.85)'; roundRect(st.x - bw / 2 - 2, by + bh + 3, bw + 4, 5, 2.5); ctx.fill();
      ctx.fillStyle = '#e4e8f5'; roundRect(st.x - bw / 2, by + bh + 4, bw * clamp(info.armor / S.maxArmor, 0, 1), 3, 1.5); ctx.fill();
    }
    if (isMe) {     // mũi tên nhỏ chỉ vào nhân vật của mình
      const ay = ty - 16 + Math.sin(wall / 220) * 2;
      ctx.beginPath(); ctx.moveTo(st.x - 7, ay - 6); ctx.lineTo(st.x + 7, ay - 6); ctx.lineTo(st.x, ay + 2); ctx.closePath();
      fillStroke(REL.me, 1.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------- cờ
  function drawFlagCloth(x, y, color, wave, s = 1, dir = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * dir, s);
    // cột
    const pg = ctx.createLinearGradient(-3, 0, 3, 0);
    pg.addColorStop(0, '#9aa3b5'); pg.addColorStop(0.5, '#f2f4fa'); pg.addColorStop(1, '#7b8396');
    ctx.fillStyle = pg; ctx.fillRect(-2.5, -96, 5, 96);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.strokeRect(-2.5, -96, 5, 96);
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(0, -98, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // lá cờ gợn sóng
    const W = 50; const H = 32; const N = 10;
    const top = []; const bot = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const off = Math.sin(wave * 2 + u * 4) * 5 * u;
      top.push([2.5 + u * W, -92 + off]);
      bot.push([2.5 + u * W, -92 + H + off * 0.9]);
    }
    ctx.beginPath();
    top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -92, W, -60);
    g.addColorStop(0, shadeHex(color, -15)); g.addColorStop(0.5, color); g.addColorStop(1, shadeHex(color, 15));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
    // ngôi sao trên cờ
    const cx = 2.5 + W * 0.45; const cy = -92 + H / 2 + Math.sin(wave * 2 + 1.8) * 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 3.4 : 8;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawBases(wall) {
    if (!isTeams()) return;
    S.map.bases.forEach(([bx, by], t) => {
      const c = S.teamColors[t];
      // cột sáng của căn cứ
      const g = ctx.createLinearGradient(0, by - 260, 0, by);
      g.addColorStop(0, c + '00'); g.addColorStop(1, c + '40');
      ctx.fillStyle = g;
      ctx.fillRect(bx - 80, by - 260, 160, 260);
      // bệ
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(bx, by + 2, 60, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx, by, 52, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadeHex(c, -35); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = c; ctx.stroke();
      ctx.globalAlpha = 0.5 + Math.sin(wall / 300 + t) * 0.3;
      ctx.beginPath(); ctx.ellipse(bx, by, 36, 6, 0, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  function drawFlags(wall) {
    if (!snap || !snap.fl || !snap.fl.length) return;
    snap.fl.forEach(([state, x, y], t) => {
      if (state === 'carried') return;     // vẽ trên lưng người cầm
      drawFlagCloth(x - (state === 'home' ? 0 : 0), y, S.teamColors[t], wall / 260 + t, 1, 1);
      if (state === 'dropped') {
        ctx.font = `900 18px ${FONT}`; ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText('!', x + 25, y - 108);
        ctx.fillStyle = '#ffe66d'; ctx.fillText('!', x + 25, y - 108);
      }
    });
  }

  // ---------------------------------------------------------------- cảnh nền (vẽ sẵn từng lớp, cuộn chậm hơn)
  let bgKey = null;
  let layers = [];
  function buildBg(mp) {
    const city = mp.theme === 'city';
    const SC = 0.6;           // độ phân giải lớp nền (nền hơi mờ cho có chiều sâu)
    const W = mp.w + 600; const H = mp.h + 300;
    const mk = (par, draw) => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(W * SC); c.height = Math.ceil(H * SC);
      const g = c.getContext('2d');
      g.scale(SC, SC);
      draw(g, W, H);
      return { c, par, SC };
    };
    const base = mp.ground + 300;     // đáy lớp nền (theo toạ độ lớp)
    layers = [];
    if (city) {
      layers.push(mk(0.15, (g, W) => {
        g.fillStyle = 'rgba(92,72,140,.75)';
        for (let i = 0, x = -50; x < W; i++) {
          const w = 60 + hash(i) * 90; const h = 160 + hash(i + 50) * 260;
          g.fillRect(x, base - 300 - h, w, h + 300);
          if (hash(i + 7) > 0.6) g.fillRect(x + w / 2 - 2, base - 300 - h - 40, 4, 40);
          x += w - 6;
        }
        g.fillStyle = 'rgba(255,220,160,.25)';
        for (let i = 0; i < 500; i++) g.fillRect(hash(i + 900) * W, base - 320 - hash(i + 1200) * 380, 4, 6);
      }));
      layers.push(mk(0.4, (g, W) => {
        for (let i = 0, x = -40; x < W; i++) {
          const w = 90 + hash(i + 300) * 120; const h = 180 + hash(i + 400) * 330;
          const top = base - 300 - h;
          g.fillStyle = '#2b2350';
          g.fillRect(x, top, w, h + 300);
          g.fillStyle = '#3a3168'; g.fillRect(x, top, 5, h + 300);
          // cửa sổ
          for (let yy = top + 18; yy < base - 330; yy += 30) {
            for (let xx = x + 12; xx < x + w - 16; xx += 20) {
              const on = hash(xx * 0.37 + yy * 1.7) > 0.62;
              g.fillStyle = on ? 'rgba(255,205,110,.85)' : 'rgba(10,8,30,.55)';
              g.fillRect(xx, yy, 10, 14);
            }
          }
          if (hash(i + 77) > 0.7) {      // bồn nước trên mái
            g.fillStyle = '#231c42';
            g.fillRect(x + w * 0.3, top - 34, 30, 26); g.fillRect(x + w * 0.3 + 4, top - 8, 3, 8); g.fillRect(x + w * 0.3 + 23, top - 8, 3, 8);
          }
          x += w + 14 + hash(i + 600) * 40;
        }
        // cần cẩu
        for (let k = 0; k < 3; k++) {
          const cx = 300 + k * (W / 3) + hash(k + 88) * 200; const top = base - 300 - 620;
          g.strokeStyle = '#231c42'; g.lineWidth = 5;
          g.strokeRect(cx, top, 22, 620);
          for (let yy = top; yy < base - 300; yy += 22) { g.beginPath(); g.moveTo(cx, yy); g.lineTo(cx + 22, yy + 22); g.stroke(); }
          g.fillStyle = '#231c42'; g.fillRect(cx - 120, top - 10, 360, 12);
          g.fillRect(cx - 120, top - 2, 40, 30);
          g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 180, top); g.lineTo(cx + 180, top + 160); g.stroke();
          g.fillRect(cx + 170, top + 160, 22, 16);
        }
      }));
    } else {
      layers.push(mk(0.12, (g, W) => {
        for (let r = 0; r < 2; r++) {
          g.fillStyle = r ? 'rgba(120,170,150,.85)' : 'rgba(160,200,185,.8)';
          g.beginPath(); g.moveTo(-50, base);
          for (let x = -50; x <= W + 50; x += 40) {
            const h = 380 - r * 120 + Math.sin(x / 260 + r * 2) * 110 + Math.sin(x / 90 + r) * 30;
            g.lineTo(x, base - 300 - h);
          }
          g.lineTo(W + 50, base); g.closePath(); g.fill();
        }
      }));
      layers.push(mk(0.45, (g, W) => {
        for (let i = 0, x = -30; x < W; i++) {
          const w = 10 + hash(i + 5) * 9; const h = 380 + hash(i + 9) * 520; const lean = (hash(i + 13) - 0.5) * 0.1;
          g.save(); g.translate(x, base - 300); g.rotate(lean);
          g.fillStyle = hash(i) > 0.5 ? 'rgba(86,150,110,.55)' : 'rgba(74,135,100,.55)';
          g.fillRect(0, -h, w, h + 300);
          g.fillStyle = 'rgba(50,100,70,.5)';
          for (let yy = -h + 30; yy < 0; yy += 55 + hash(i + yy) * 20) g.fillRect(-1, yy, w + 2, 4);
          g.fillStyle = 'rgba(90,160,110,.45)';
          for (let yy = -h + 20; yy < -120; yy += 70) {
            g.beginPath(); g.ellipse(w + 16, yy, 22, 5, 0.4, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.ellipse(-14, yy + 30, 20, 5, -0.4, 0, Math.PI * 2); g.fill();
          }
          g.restore();
          x += 70 + hash(i + 21) * 110;
        }
      }));
    }
    bgKey = mp.id;
  }
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: hash(i + 40) * 3000, y: 60 + hash(i + 41) * 260, s: 0.6 + hash(i + 42) * 0.8, v: 6 + hash(i + 43) * 10 }));
  function drawSky(c, wall) {
    const mp = S.map;
    const city = mp.theme === 'city';
    const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
    if (city) { g.addColorStop(0, '#1b2350'); g.addColorStop(0.5, '#6d4a8e'); g.addColorStop(1, '#f7a46d'); } else { g.addColorStop(0, '#5fb3dd'); g.addColorStop(0.6, '#bfe3e8'); g.addColorStop(1, '#f6f1d0'); }
    ctx.fillStyle = g;
    ctx.fillRect(c.x - 20, c.y - 20, c.w + 40, c.h + 40);
    // mặt trời
    const sx = c.x * 0.95 + c.w * 0.72; const sy = c.y + c.h * (city ? 0.55 : 0.2);
    const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, 170);
    sg.addColorStop(0, city ? 'rgba(255,214,150,1)' : 'rgba(255,255,230,1)');
    sg.addColorStop(0.3, city ? 'rgba(255,170,110,.55)' : 'rgba(255,250,200,.5)');
    sg.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 170, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = city ? '#ffd9a0' : '#fffbe6';
    ctx.beginPath(); ctx.arc(sx, sy, 42, 0, Math.PI * 2); ctx.fill();
    // mây
    ctx.fillStyle = city ? 'rgba(255,190,200,.25)' : 'rgba(255,255,255,.8)';
    for (const cl of clouds) {
      const x = ((cl.x + wall / 1000 * cl.v) % 3200) - 300 + c.x * 0.85;
      const y = c.y * 0.9 + cl.y;
      ctx.save(); ctx.translate(x, y); ctx.scale(cl.s, cl.s);
      ctx.beginPath();
      ctx.ellipse(0, 0, 70, 22, 0, 0, Math.PI * 2); ctx.ellipse(-35, -10, 34, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(25, -16, 40, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (bgKey !== mp.id) buildBg(mp);
    for (const L of layers) {
      const ox = c.x * (1 - L.par) - 300;
      const oy = c.y * (1 - L.par) * 0.3 - 300 + (mp.h - c.h) * 0 + 0;
      ctx.drawImage(L.c, ox, oy + 300 - 300, L.c.width / L.SC, L.c.height / L.SC);
    }
    // sương mờ gần mặt đất
    const hz = ctx.createLinearGradient(0, mp.ground - 260, 0, mp.ground);
    hz.addColorStop(0, city ? 'rgba(247,164,109,0)' : 'rgba(246,241,208,0)');
    hz.addColorStop(1, city ? 'rgba(247,164,109,.35)' : 'rgba(246,241,208,.45)');
    ctx.fillStyle = hz; ctx.fillRect(c.x - 20, mp.ground - 260, c.w + 40, 260);
  }

  // ---------------------------------------------------------------- mặt đất, bục, đồ trang trí
  function drawLevel(c, wall) {
    const mp = S.map;
    const city = mp.theme === 'city';
    const x0 = Math.max(-400, c.x - 40); const x1 = Math.min(mp.w + 400, c.x + c.w + 40);
    // cột chống dưới bục
    for (const [px, py, pw] of mp.plats) {
      if (px + pw < x0 || px > x1) continue;
      const legs = pw > 260 ? [px + 24, px + pw / 2, px + pw - 24] : [px + 20, px + pw - 20];
      for (const lx of legs) {
        if (city) {
          ctx.fillStyle = '#3d3552';
          ctx.fillRect(lx - 5, py + 12, 10, mp.ground - py - 12);
          ctx.strokeStyle = '#2b2540'; ctx.lineWidth = 2;
          for (let yy = py + 20; yy < mp.ground - 10; yy += 26) { ctx.beginPath(); ctx.moveTo(lx - 5, yy); ctx.lineTo(lx + 5, yy + 13); ctx.stroke(); }
        } else {
          ctx.fillStyle = '#6d8f3c';
          ctx.fillRect(lx - 4, py + 10, 8, mp.ground - py - 10);
          ctx.fillStyle = '#56742d';
          for (let yy = py + 40; yy < mp.ground; yy += 50) ctx.fillRect(lx - 5, yy, 10, 3);
        }
      }
    }
    // đồ trang trí trên mặt đất
    for (let i = 0; i < mp.w / 140; i++) {
      const x = 60 + i * 140 + hash(i + 3) * 80;
      if (x < x0 - 80 || x > x1 + 80) continue;
      const r = hash(i + 17);
      const y = mp.ground;
      if (city) {
        if (r < 0.3) { box(x - 22, y - 40, 44, 40, 3, '#b07a3c'); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 20, y - 38); ctx.lineTo(x + 20, y - 2); ctx.moveTo(x + 20, y - 38); ctx.lineTo(x - 20, y - 2); ctx.stroke(); } else if (r < 0.5) {
          ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 3, y - 28); ctx.lineTo(x + 3, y - 28); ctx.lineTo(x + 10, y); ctx.closePath(); fillStroke('#ff7a2f');
          ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, y - 16, 12, 4);
        } else if (r < 0.68) {
          box(x - 14, y - 36, 28, 36, 5, '#3f7fbf'); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x - 14, y - 26, 28, 3); ctx.fillRect(x - 14, y - 12, 28, 3);
        }
      } else {
        if (r < 0.35) {
          ctx.fillStyle = '#3f8a3e';
          ctx.beginPath(); ctx.arc(x - 14, y - 10, 16, 0, Math.PI * 2); ctx.arc(x + 6, y - 16, 20, 0, Math.PI * 2); ctx.arc(x + 24, y - 8, 13, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(x + 2, y - 24, 8, 0, Math.PI * 2); ctx.fill();
        } else if (r < 0.55) {
          ctx.beginPath(); ctx.ellipse(x, y - 9, 22, 13, 0, Math.PI, 0); fillStroke('#8d8f99');
        } else if (r < 0.7) {
          ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 50); ctx.stroke();
          ctx.fillStyle = '#e53935'; roundRect(x - 9, y - 70, 18, 22, 7); fillStroke('#e53935');
          ctx.globalAlpha = 0.25 + Math.sin(wall / 500 + i) * 0.1; ctx.fillStyle = '#ffcf6b';
          ctx.beginPath(); ctx.arc(x, y - 59, 26, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    }
    // mặt đất
    const gy = mp.ground;
    if (city) {
      const g = ctx.createLinearGradient(0, gy, 0, gy + 160);
      g.addColorStop(0, '#5b5568'); g.addColorStop(1, '#2e2a3a');
      ctx.fillStyle = g; ctx.fillRect(x0, gy, x1 - x0, 400);
      ctx.fillStyle = '#7d7790'; ctx.fillRect(x0, gy, x1 - x0, 8);
      ctx.fillStyle = '#ffd34d';
      for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) ctx.fillRect(x, gy + 26, 46, 6);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let x = Math.floor(x0 / 60) * 60; x < x1; x += 60) for (let k = 0; k < 3; k++) ctx.fillRect(x + ((k % 2) * 30), gy + 50 + k * 26, 56, 2);
    } else {
      const g = ctx.createLinearGradient(0, gy, 0, gy + 160);
      g.addColorStop(0, '#7a5530'); g.addColorStop(1, '#3f2a16');
      ctx.fillStyle = g; ctx.fillRect(x0, gy, x1 - x0, 400);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let x = Math.floor(x0 / 70) * 70; x < x1; x += 70) {
        ctx.beginPath(); ctx.ellipse(x + hash(x) * 40, gy + 40 + hash(x + 1) * 60, 8 + hash(x + 2) * 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#5cb85c'; ctx.fillRect(x0, gy - 2, x1 - x0, 12);
      ctx.fillStyle = '#4a9e4a';
      for (let x = Math.floor(x0 / 12) * 12; x < x1; x += 12) {
        const h = 5 + hash(x) * 8;
        ctx.beginPath(); ctx.moveTo(x, gy + 2); ctx.lineTo(x + 3, gy - h); ctx.lineTo(x + 6, gy + 2); ctx.fill();
      }
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
    // bục
    for (const [px, py, pw] of mp.plats) {
      if (px + pw < x0 || px > x1) continue;
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(px + 6, py + 16, pw - 6, 8);
      if (city) {
        const g = ctx.createLinearGradient(0, py, 0, py + 16);
        g.addColorStop(0, '#ffa04d'); g.addColorStop(1, '#d9661f');
        roundRect(px, py, pw, 16, 3); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(px + 3, py + 2, pw - 6, 2.5);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        for (let x = px + 10; x < px + pw - 6; x += 24) { ctx.beginPath(); ctx.arc(x, py + 10, 2, 0, Math.PI * 2); ctx.fill(); }
      } else {
        for (let x = px, i = 0; x < px + pw; x += 26, i++) {
          const w = Math.min(26, px + pw - x);
          roundRect(x, py + (i % 2 ? 1 : 0), w, 14, 3);
          ctx.fillStyle = i % 2 ? '#c9934a' : '#b9833c'; ctx.fill();
          ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(x + 4, py + 7, 1.5, 0, Math.PI * 2); ctx.arc(x + w - 4, py + 7, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        // dây leo rủ xuống
        ctx.strokeStyle = '#3f8a3e'; ctx.lineWidth = 2.5;
        for (let x = px + 18; x < px + pw - 10; x += 46) {
          const h = 14 + hash(x + py) * 26;
          ctx.beginPath(); ctx.moveTo(x, py + 13); ctx.quadraticCurveTo(x + 6, py + 13 + h / 2, x + 2 + Math.sin(wall / 700 + x) * 3, py + 13 + h); ctx.stroke();
        }
        ctx.fillStyle = '#5cb85c'; roundRect(px + 2, py - 4, pw - 4, 5, 2.5); ctx.fill();
      }
    }
    // tường hai mép bản đồ
    ctx.fillStyle = 'rgba(10,8,24,.55)';
    ctx.fillRect(-500, -2000, 500, 4000); ctx.fillRect(mp.w, -2000, 500, 4000);
  }

  // ---------------------------------------------------------------- đạn, lựu đạn, vật phẩm
  const BULLET_C = { pistol: '255,226,110', smg: '255,206,90', shotgun: '255,170,80', sniper: '200,240,255', laser: '224,64,251' };
  function drawProjectiles(now, wall) {
    if (!snap) return;
    const dt = clamp(now - snap.ts, 0, 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [, x, y, vx, vy, kind] of snap.b) {
      if (kind === 'rocket') continue;
      const bx = x + vx * dt; const by = y + vy * dt;
      const sp = Math.hypot(vx, vy) || 1;
      const tail = kind === 'laser' ? 110 : kind === 'sniper' ? 90 : kind === 'shotgun' ? 18 : 34;
      const tx = bx - vx / sp * tail; const ty = by - vy / sp * tail;
      const col = BULLET_C[kind] || '255,255,255';
      const g = ctx.createLinearGradient(tx, ty, bx, by);
      g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},.95)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = kind === 'laser' ? 7 : kind === 'sniper' ? 4 : 4;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(bx, by, kind === 'laser' ? 3.5 : 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    for (const [, x, y, vx, vy, kind] of snap.b) {
      if (kind !== 'rocket') continue;
      const bx = x + vx * dt; const by = y + vy * dt;
      const sp = Math.hypot(vx, vy) || 1;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(vy, vx));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fl = 10 + Math.random() * 8;
      const g = ctx.createRadialGradient(-16, 0, 0, -16, 0, fl);
      g.addColorStop(0, 'rgba(255,255,200,1)'); g.addColorStop(0.5, 'rgba(255,150,40,.8)'); g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-16, 0, fl, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      box(-14, -5, 22, 10, 3, '#6b7b3e');
      ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(16, 0); ctx.lineTo(8, 5); ctx.closePath(); fillStroke('#c0392b');
      ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-19, -10); ctx.lineTo(-9, -5); ctx.closePath(); fillStroke('#4a5527', 1.2);
      ctx.beginPath(); ctx.moveTo(-14, 5); ctx.lineTo(-19, 10); ctx.lineTo(-9, 5); ctx.closePath(); fillStroke('#4a5527', 1.2);
      ctx.restore();
      if (Math.random() < 0.6) parts.push({ type: 'smoke', x: bx - vx / sp * 22, y: by - vy / sp * 22, vx: (Math.random() - 0.5) * 30, vy: -20, r: 5 + Math.random() * 4, at: wall, life: 0.7 });
    }
    for (const [, x, y, vx, vy] of snap.gr) {
      const gx = x + vx * dt; const gy = y + vy * dt + 0.5 * S.grenade.g * dt * dt;
      ctx.save(); ctx.translate(gx, gy - 8); ctx.rotate(wall / 120 * Math.sign(vx || 1) * (Math.abs(vx) > 20 ? 1 : 0));
      ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 9, 0, 0, Math.PI * 2); fillStroke('#4a6b2a');
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
      box(-3, -13, 6, 4, 1, '#a0a4ad', 1.2);
      ctx.restore();
      if (Math.floor(wall / 110) % 2) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,60,60,.9)'; ctx.beginPath(); ctx.arc(gx, gy - 22, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,60,60,.25)'; ctx.beginPath(); ctx.arc(gx, gy - 22, 9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
  function drawItemIcon(kind, x, y, s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (kind === 'medkit') {
      box(-15, -11, 30, 23, 5, '#ffffff');
      box(-5, -7, 10, 4, 1, '#e53935', 0); ctx.fillStyle = '#e53935'; ctx.fillRect(-3.5, -8, 7, 17); ctx.fillRect(-9, -3, 18, 7);
      box(-6, -15, 12, 5, 2, '#d0d4dc', 1.2);
    } else if (kind === 'armor') {
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(13, -9); ctx.quadraticCurveTo(12, 9, 0, 16); ctx.quadraticCurveTo(-12, 9, -13, -9); ctx.closePath();
      const g = ctx.createLinearGradient(-13, -15, 13, 16); g.addColorStop(0, '#9cc6ff'); g.addColorStop(1, '#2f6fd6');
      fillStroke(g, 1.8);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, -7); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
    } else if (kind === 'grenade') {
      for (const dx of [-7, 7]) {
        ctx.beginPath(); ctx.ellipse(dx, 3, 7, 8.5, 0, 0, Math.PI * 2); fillStroke('#4a6b2a');
        box(dx - 3, -9, 6, 4, 1, '#a0a4ad', 1.2);
      }
    } else {
      ctx.rotate(-0.2);
      const len = { pistol: 24, smg: 36, shotgun: 46, sniper: 58, rocket: 48, laser: 37 }[kind] || 30;
      const k = Math.min(1, 40 / (len + 12));
      ctx.scale(k, k);
      ctx.translate(-len / 2 + 4, 0);
      drawGun(kind);
    }
    ctx.restore();
  }
  function drawItems(wall) {
    if (!snap) return;
    for (const [, x, y, kind] of snap.it) {
      const bob = Math.sin(wall / 320 + x) * 4;
      const isGun = !!S.weapons[kind];
      const col = isGun ? '255,214,90' : '130,230,110';
      // bệ + tia sáng
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y - 26 + bob, 2, x, y - 26 + bob, 30);
      g.addColorStop(0, `rgba(${col},.55)`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 26 + bob, 30, 0, Math.PI * 2); ctx.fill();
      ctx.translate(x, y - 26 + bob);
      ctx.rotate(wall / 900);
      ctx.fillStyle = `rgba(${col},.18)`;
      for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -34); ctx.lineTo(6, -34); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      drawItemIcon(kind, x, y - 26 + bob, 1);
    }
  }

  // ---------------------------------------------------------------- hạt hiệu ứng
  function drawParts(wall) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const f = parts[i];
      const age = (wall - f.at) / 1000;
      if (age < 0) continue;
      if (age > f.life) { parts.splice(i, 1); continue; }
      const k = age / f.life;
      switch (f.type) {
        case 'spark': {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = f.color; ctx.globalAlpha = 1 - k;
          const x = f.x + f.vx * age; const y = f.y + f.vy * age + 0.5 * (f.g || 700) * age * age;
          const s = f.big ? 4 : 3;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          ctx.restore();
          break;
        }
        case 'shell': {
          let y = f.y + f.vy * age + 900 * age * age;
          let x = f.x + f.vx * age;
          if (y > f.floor) { y = f.floor; x = f.x + f.vx * Math.min(age, 0.4); }
          ctx.save(); ctx.translate(x, y - 2); ctx.rotate(f.rot + age * 14);
          ctx.globalAlpha = 1 - Math.max(0, k - 0.7) / 0.3;
          ctx.fillStyle = f.red ? '#d64545' : '#e9b949'; ctx.fillRect(-3, -1.5, 6, 3);
          ctx.restore();
          break;
        }
        case 'smoke': {
          const r = f.r * (1 + k * 1.6);
          ctx.fillStyle = f.dark ? `rgba(70,64,80,${0.55 * (1 - k)})` : `rgba(235,230,220,${0.5 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(f.x + (f.vx || 0) * age, f.y + (f.vy || 0) * age, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'flash': {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
          g.addColorStop(0, `rgba(255,255,230,${1 - k})`); g.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          break;
        }
        case 'fire': {
          const r = f.r * (0.45 + k * 0.6);
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, `rgba(255,250,200,${1 - k})`);
          g.addColorStop(0.35, `rgba(255,170,60,${0.95 * (1 - k)})`);
          g.addColorStop(0.75, `rgba(220,70,30,${0.7 * (1 - k)})`);
          g.addColorStop(1, 'rgba(120,30,10,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ring': {
          ctx.strokeStyle = `rgba(255,240,200,${0.8 * (1 - k)})`; ctx.lineWidth = 6 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.3 + k * 0.9), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'ghost': {
          const x = f.x + Math.sin(age * 6) * 8; const y = f.y - age * 70;
          ctx.save(); ctx.globalAlpha = 0.85 * (1 - k);
          ctx.translate(x, y);
          ctx.beginPath();
          ctx.arc(0, -6, 13, Math.PI, 0);
          ctx.lineTo(13, 10);
          for (let j = 0; j < 4; j++) ctx.quadraticCurveTo(13 - j * 6.5 - 3.25, 14 + (j % 2 ? -4 : 4), 13 - (j + 1) * 6.5, 10);
          ctx.closePath();
          fillStroke('#ffffff', 1.5);
          ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-4.5, -6, 2, 0, Math.PI * 2); ctx.arc(4.5, -6, 2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, -24, 9, 3, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'beam': {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createLinearGradient(f.x - 26, 0, f.x + 26, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.7 * (1 - k)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(f.x - 26, f.y - 400, 52, 400);
          ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 20 + k * 30, 5 + k * 6, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'num': {
          const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 1.5);
          ctx.save();
          ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
          ctx.translate(f.x, f.y - age * 45);
          ctx.scale(pop, pop);
          ctx.font = `900 ${f.size || 18}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
          ctx.strokeText(f.text, 0, 0);
          ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
          ctx.restore();
          break;
        }
        default:
      }
    }
    if (parts.length > 600) parts.splice(0, parts.length - 600);
  }

  // ---------------------------------------------------------------- HUD
  function hudText(text, x, y, size, align = 'center', color = '#fff') {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = 'rgba(10,8,24,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  function panel(x, y, w, h, r = 12) {
    roundRect(x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(30,32,64,.82)'); g.addColorStop(1, 'rgba(14,14,34,.82)');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.stroke();
  }
  const fmtClock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function drawHud(now, wall) {
    const w = view.cssW; const h = view.cssH;
    const small = w < 620;
    // viền tối quanh màn hình
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    if (wall - hurt.at < 350) {
      const k = 1 - (wall - hurt.at) / 350;
      const rg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      rg.addColorStop(0, 'rgba(255,40,40,0)'); rg.addColorStop(1, `rgba(255,40,40,${0.5 * k})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    }
    // Điểm số + đồng hồ
    const tl = snap ? snap.tl : S.timeLeft;
    const clock = fmtClock(Math.max(0, Math.ceil(tl)));
    const cy = 12;
    if (isTeams()) {
      const bw = small ? 50 : 62;
      panel(w / 2 - bw - 46, cy, bw * 2 + 92, small ? 40 : 46, 12);
      for (const t of [0, 1]) {
        const bx = t ? w / 2 + 46 : w / 2 - 46 - bw;
        roundRect(bx + 4, cy + 4, bw - 8, (small ? 40 : 46) - 8, 9);
        ctx.fillStyle = S.teamColors[t]; ctx.fill();
        hudText(String(S.score[t]), bx + bw / 2, cy + (small ? 29 : 33), small ? 22 : 26);
      }
      hudText(clock, w / 2, cy + (small ? 22 : 25), small ? 15 : 17, 'center', tl <= 15 ? '#ffe66d' : '#fff');
      hudText(`${S.mode === 'ctf' ? '🚩' : '💀'} ${S.config.limit}`, w / 2, cy + (small ? 36 : 41), 11, 'center', '#b9c2ea');
    } else {
      const ranked = S.players.filter((p) => p.playing).sort((a, b) => b.k - a.k);
      const top = ranked[0];
      const mine = player(S.me.id);
      panel(w / 2 - 90, cy, 180, 46, 12);
      hudText(clock, w / 2, cy + 22, 17, 'center', tl <= 15 ? '#ffe66d' : '#fff');
      if (top) hudText(`👑 ${top.id === S.me.id ? 'Bạn' : top.name.slice(0, 10)} ${top.k}/${S.config.limit}`, w / 2, cy + 39, 12, 'center', colorOf(top.id));
      if (mine && mine.playing && !small) hudText(`Bạn: ${mine.k} hạ`, w / 2 + 100, cy + 30, 14, 'left', '#fff');
    }
    // Bảng hạ gục
    let fy = touchDevice ? 58 : 76;
    for (let k = feed.length - 1, shown = 0; k >= 0 && shown < (small || touchDevice ? 3 : 5); k--) {
      const f = feed[k];
      const age = (wall - f.at) / 1000;
      if (age > 5) continue;
      ctx.globalAlpha = clamp(5 - age, 0, 1);
      const fs = small ? 11 : 13;
      ctx.font = `800 ${fs}px ${FONT}`;
      const tw = ctx.measureText(f.text).width;
      roundRect(w - tw - 26, fy - fs - 3, tw + 16, fs + 10, 8);
      ctx.fillStyle = f.mine ? 'rgba(245,197,66,.5)' : 'rgba(12,12,30,.6)'; ctx.fill();
      hudText(f.text, w - 18, fy, fs, 'right', '#fff');
      ctx.globalAlpha = 1;
      fy += fs + 14; shown++;
    }
    // Máu / giáp / súng của mình
    const v = pv(S.me.id);
    if (playing() && v) {
      const pw = small ? 190 : 236; const ph = small ? 58 : 66;
      const x0 = 12; const y0 = touchDevice ? 10 : h - ph - 12;
      panel(x0, y0, pw, ph, 14);
      const bx = x0 + 12; const bw = pw - 24;
      const hp = clamp(v[F.hp] / S.maxHp, 0, 1);
      roundRect(bx, y0 + 10, bw, 14, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
      const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (hp > 0.5) { hg.addColorStop(0, '#2fbf71'); hg.addColorStop(1, '#7ef0a8'); } else if (hp > 0.25) { hg.addColorStop(0, '#f59f00'); hg.addColorStop(1, '#ffd43b'); } else { hg.addColorStop(0, '#e03131'); hg.addColorStop(1, '#ff8787'); }
      if (hp > 0) { roundRect(bx, y0 + 10, Math.max(14, bw * hp), 14, 7); ctx.fillStyle = hg; ctx.fill(); }
      hudText(`${v[F.hp]}`, bx + 8, y0 + 22, 12, 'left');
      if (v[F.armor] > 0) { roundRect(bx, y0 + 27, bw * clamp(v[F.armor] / S.maxArmor, 0, 1), 4, 2); ctx.fillStyle = '#74a9ff'; ctx.fill(); }
      const wp = S.weapons[v[F.wpn]] || S.weapons.pistol;
      drawItemIcon(v[F.wpn], bx + 18, y0 + ph - 18, 0.85);
      const ammo = wp.ammo === null ? '∞' : v[F.ammo];
      hudText(wp.name, bx + 42, y0 + ph - 20, small ? 12 : 14, 'left', '#ffe08a');
      hudText(String(ammo), bx + 42, y0 + ph - 6, small ? 11 : 12, 'left', '#cfd6f5');
      for (let i = 0; i < Math.min(4, v[F.gren]); i++) drawItemIcon('grenade', bx + bw - 12 - i * 14, y0 + ph - 16, 0.42);
      // Đứng trên súng khác → gợi ý đổi
      if (me && v[F.alive] && snap) {
        const near = snap.it.find(([, x, y, kind]) => S.weapons[kind] && kind !== v[F.wpn] && v[F.wpn] !== 'pistol' && Math.abs(x - me.x) < 48 && me.y - y > -70 && me.y - y < 30);
        if (near) {
          const txt = `${touchDevice ? '🔄' : 'E'} · Đổi sang ${S.items[near[3]].name}`;
          ctx.font = `800 15px ${FONT}`;
          const tw = ctx.measureText(txt).width + 26;
          const hy = h - (touchDevice ? 34 : small ? 120 : 96);
          panel(w / 2 - tw / 2, hy - 20, tw, 30, 15);
          hudText(txt, w / 2, hy, 15, 'center', '#ffe66d');
        }
      }
      if (!v[F.alive] && S.stage === 'fight') {
        ctx.fillStyle = 'rgba(10,8,24,.35)'; ctx.fillRect(0, 0, w, h);
        hudText('💀 Bạn bị hạ!', w / 2, h * 0.4, small ? 30 : 44, 'center', '#ff6b6b');
        hudText(`Hồi sinh sau ${Math.max(0, v[F.resp]).toFixed(1)}s`, w / 2, h * 0.4 + 38, small ? 16 : 19, 'center', '#fff');
      }
      if (v[F.flag] !== null && v[F.flag] !== undefined && v[F.alive]) {
        hudText('🚩 Đang cầm cờ — chạy về căn cứ!', w / 2, touchDevice ? h - 20 : 88, small ? 15 : 18, 'center', '#ffe66d');
      }
    }
    // Giới thiệu / kết thúc
    if (S.stage === 'intro') {
      const left = Math.max(0, S.stageUntil - now);
      ctx.fillStyle = 'rgba(10,8,24,.3)'; ctx.fillRect(0, 0, w, h);
      hudText(S.modeNames[S.mode].toUpperCase(), w / 2, h * 0.36, small ? 34 : 52, 'center', '#ffe66d');
      if (isTeams() && S.me.playing) {
        const t = (player(S.me.id) || {}).team;
        hudText(`Bạn ở đội ${S.teamNames[t]}`, w / 2, h * 0.36 + 38, small ? 17 : 22, 'center', S.teamColors[t] || '#fff');
      }
      const n = Math.ceil(left);
      const pop = 1 + (n - left) * 0.4;
      ctx.save(); ctx.translate(w / 2, h * 0.36 + 100); ctx.scale(pop, pop);
      hudText(left > 0.2 ? String(n) : 'BẮN!', 0, 0, small ? 46 : 64, 'center', '#fff');
      ctx.restore();
    } else if (S.stage === 'over') {
      ctx.fillStyle = 'rgba(10,8,24,.35)'; ctx.fillRect(0, 0, w, h);
      let text = '🤝 HOÀ!';
      let col = '#ffe66d';
      if (typeof S.winner === 'number') { text = `🏆 ĐỘI ${S.teamNames[S.winner].toUpperCase()} THẮNG!`; col = S.teamColors[S.winner]; } else if (S.winner) text = `🏆 ${S.winner === S.me.id ? 'BẠN' : nm(S.winner)} THẮNG!`;
      hudText(text, w / 2, h * 0.42, small ? 30 : 48, 'center', col);
    }
    if (!S.me.playing) hudText('👀 Đang xem — ván sau sẽ được vào chơi', w / 2, h - 18, 14);
    drawMinimap(w, h, small);
  }
  function drawMinimap(w, h, small) {
    if (!playing() || small || touchDevice) return;
    const mp = S.map;
    const mw = 170; const mh = mw * (mp.h / mp.w);
    const x0 = 12; const y0 = 12;
    const k = mw / mp.w;
    panel(x0 - 5, y0 - 5, mw + 10, mh + 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    for (const [px, py, pw] of mp.plats) ctx.fillRect(x0 + px * k, y0 + py * k, Math.max(2, pw * k), 2);
    ctx.fillRect(x0, y0 + mp.ground * k, mw, 2);
    if (snap) {
      snap.fl.forEach(([, x, y], t) => { ctx.fillStyle = S.teamColors[t]; ctx.fillRect(x0 + x * k - 1, y0 + y * k - 10, 2, 10); ctx.fillRect(x0 + x * k, y0 + y * k - 10, 6, 5); });
      for (const [pid, v] of Object.entries(snap.p)) {
        if (!v[F.alive]) continue;
        const mine = pid === S.me.id;
        if (!mine && isTeams() && (player(pid) || {}).team !== (player(S.me.id) || {}).team) continue;   // chỉ thấy đồng đội
        const x = mine && me ? me.x : v[F.x]; const y = mine && me ? me.y : v[F.y];
        ctx.fillStyle = mine ? '#fff' : colorOf(pid);
        ctx.beginPath(); ctx.arc(x0 + x * k, y0 + (y - 30) * k, mine ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- vòng vẽ
  let lastFrame = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const wall = performance.now();
    const dt = Math.min(0.05, (wall - lastFrame) / 1000);
    lastFrame = wall;
    if (!S || S.phase !== 'play' || !S.map || $('#arena').hidden) return;
    if (!view.cssW) resize();
    if (!view.cssW) return;
    const now = serverNow();
    if (playing()) {
      const v = pv(S.me.id);
      if (!me || (v && v[F.life] !== me.life)) resetMe();
      if (myAlive()) stepMe(dt);
    }
    updateCam(dt);
    const c = cam();
    ctx.setTransform(view.dpr * c.s, 0, 0, view.dpr * c.s, -c.x * view.dpr * c.s, -c.y * view.dpr * c.s);
    if (wall - shake.at < 280) {
      const k = (1 - (wall - shake.at) / 280) * 9;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    drawSky(c, wall);
    drawBases(wall);
    drawLevel(c, wall);
    drawFlags(wall);
    drawItems(wall);
    // người chơi (mình vẽ sau cùng để luôn nổi lên trên)
    const rt = now - 0.1;
    if (snap) {
      const list = Object.entries(snap.p).sort(([a], [b]) => (a === S.me.id) - (b === S.me.id));
      for (const [pid, v] of list) {
        const p = player(pid) || { id: pid, name: '?', look: null };
        const isMe = pid === S.me.id && playing() && me;
        if (!v[F.alive]) { anims.delete(pid); continue; }
        const st = isMe ? me : remoteAt(pid, rt);
        if (!st || (!st.alive && !isMe)) continue;
        drawFighter(p, st, { hp: v[F.hp], armor: v[F.armor], wpn: v[F.wpn], inv: v[F.inv], flag: v[F.flag] }, wall, !!isMe);
      }
    }
    drawProjectiles(now, wall);
    drawParts(wall);
    // tâm ngắm
    if (playing() && me && input.px !== null && !touchDevice) {
      const t = screenToWorld(input.px, input.py);
      const r = 11 / c.s;
      ctx.lineWidth = 4 / c.s; ctx.strokeStyle = 'rgba(10,8,24,.6)';
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2 / c.s; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(t.x + dx * r * 0.5, t.y + dy * r * 0.5); ctx.lineTo(t.x + dx * r * 1.6, t.y + dy * r * 1.6); }
      ctx.stroke();
      ctx.fillStyle = '#ff5a5f'; ctx.beginPath(); ctx.arc(t.x, t.y, 2 / c.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawHud(now, wall);
  }
  requestAnimationFrame(frame);


  // ---------------------------------------------------------------- điều khiển
  const touchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const KEYMAP = {
    a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right',
    w: 'jump', W: 'jump', ArrowUp: 'jump', ' ': 'jump',
    s: 'drop', S: 'drop', ArrowDown: 'drop',
    g: 'nade', G: 'nade', e: 'swap', E: 'swap',
  };
  function press(act, down) {
    if (act === 'left' || act === 'right') { keys[act] = down; return; }
    if (!down) return;
    if (act === 'jump') input.jump = true;
    else if (act === 'drop') input.drop = true;
    else if (act === 'nade') throwNade();
    else if (act === 'swap') send('swap');
  }
  document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || !S || S.phase !== 'play') return;
    const act = KEYMAP[e.key];
    if (!act) return;
    e.preventDefault();
    if (e.repeat && act !== 'left' && act !== 'right') return;
    press(act, true);
  });
  document.addEventListener('keyup', (e) => {
    const act = KEYMAP[e.key];
    if (act === 'left' || act === 'right') keys[act] = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; input.firing = false; });
  // Chuột / chạm trên bản đồ: ngắm + bắn
  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  cv.addEventListener('pointermove', (e) => { [input.px, input.py] = canvasPos(e); });
  cv.addEventListener('pointerdown', (e) => {
    if (!playing()) return;
    e.preventDefault();
    [input.px, input.py] = canvasPos(e);
    if (e.button === 2) { throwNade(); return; }
    input.firing = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
    audio();
  });
  const stopFire = () => { input.firing = false; };
  cv.addEventListener('pointerup', stopFire);
  cv.addEventListener('pointercancel', stopFire);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  document.querySelectorAll('#pad [data-key]').forEach((b) => {
    const act = b.dataset.key;
    const on = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); press(act, true); };
    const off = (e) => { e.preventDefault(); b.classList.remove('on'); press(act, false); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
  $('#btn-full').addEventListener('click', () => {
    const a = $('#arena');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (a.requestFullscreen) a.requestFullscreen().then(() => { try { screen.orientation.lock('landscape'); } catch (e) { /* bỏ qua */ } }).catch(() => {});
  });

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage: (m) => { if (m.type === 'cw') onWorld(m); },
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  let gameSeen = null;
  function onState(state) {
    const prevGame = S && S.gameNo;
    S = state;
    if (clockOff === null) clockSample(S.now);
    if (S.gameNo !== prevGame || S.phase !== 'play') {
      if (S.gameNo !== gameSeen) { gameSeen = S.gameNo; snap = null; remote.clear(); me = null; camState.ok = false; feed.length = 0; }
    }
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    render();
    fresh.forEach(playEvent);
  }

  const W_ICON = { pistol: '🔫', smg: '💨', shotgun: '💥', sniper: '🎯', rocket: '🚀', laser: '⚡', grenade: '💣' };
  function playEvent(e) {
    const wall = performance.now();
    const short = (id) => { const t = id === S.me.id ? 'Bạn' : nm(id); return t.length > 12 ? t.slice(0, 11) + '…' : t; };
    switch (e.type) {
      case 'fight': play('go'); break;
      case 'kill': {
        const self = !e.pid || e.pid === e.v;
        const text = self ? `💀 ${short(e.v)} tự hạ mình` : `${short(e.pid)} ${W_ICON[e.w] || '🔫'} ${short(e.v)}${e.streak >= 3 ? ` 🔥${e.streak}` : ''}`;
        feed.push({ text, at: wall, mine: e.pid === S.me.id || e.v === S.me.id });
        if (feed.length > 20) feed.shift();
        if (e.pid === S.me.id && !self) {
          play('kill');
          if (me) fxq.push({ type: 'num', x: me.x, y: me.y - 120, text: e.streak >= 3 ? `🔥 Liên hoàn ${e.streak}!` : '💀 Hạ gục!', at: wall, life: 1.4, color: '#ffe66d', size: 22 });
        }
        break;
      }
      case 'take': feed.push({ text: `🚩 ${short(e.pid)} cướp cờ ${S.teamNames[e.team]}!`, at: wall, mine: e.pid === S.me.id }); play('flag'); break;
      case 'drop': feed.push({ text: `🏳️ Cờ ${S.teamNames[e.team]} rơi!`, at: wall }); break;
      case 'return': feed.push({ text: `↩️ Cờ ${S.teamNames[e.team]} về căn cứ`, at: wall }); break;
      case 'cap': feed.push({ text: `🏁 ${short(e.pid)} ghi điểm cho đội ${S.teamNames[e.team]}!`, at: wall, mine: e.pid === S.me.id }); play('cap'); break;
      case 'over': play('win'); break;
      case 'win':
        if (e.pid) { bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- hiệu ứng tương tác (biểu cảm)
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

  // ---------------------------------------------------------------- giao diện ngoài bản đồ
  function renderBanner() {
    const el = $('#banner');
    let big = '🔫';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    const mode = S.modeNames[S.mode];
    if (S.phase === 'lobby') {
      title = `Phòng chờ — ${mode}`;
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật, thêm bot rồi bấm Bắt đầu' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = typeof S.winner === 'number' ? `Đội ${S.teamNames[S.winner]} thắng!` : S.winner ? `${who(S.winner)} thắng!` : 'Hoà!';
      sub = `Ván ${S.gameNo} (${mode}) kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      title = `${mode} · ${esc(S.map.name)}`;
      sub = touchDevice ? 'Chạm giữ vào bản đồ để bắn · nút bên dưới để chạy, nhảy, ném lựu đạn' : 'A/D chạy · W/Space nhảy · S xuống · chuột ngắm & bắn · G lựu đạn · E đổi súng';
      cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = '👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.';
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }
  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    $('#cast').hidden = S.phase === 'play';
    if (S.phase === 'play') return;
    cast.update(S.players.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color || undefined,
      dim: !p.connected,
      sub: S.phase === 'end' && p.playing ? `💀 ${p.k} · ☠️ ${p.d}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && (S.winner === p.id || (typeof S.winner === 'number' && p.playing && p.team === S.winner)) ? '🏆' : '',
    })));
  }
  function renderArena() {
    const arena = $('#arena');
    const show = S.phase === 'play';
    if (arena.hidden === show) { arena.hidden = !show; if (show) requestAnimationFrame(() => { resize(); arena.scrollIntoView({ block: touchDevice ? 'start' : 'center', behavior: 'smooth' }); }); }
    $('#pad').hidden = !(show && S.me.playing && touchDevice);
  }
  function renderPlayers() {
    const inGame = S.phase !== 'lobby';
    const ranked = !inGame ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.k + 3 * b.caps - a.k - 3 * a.caps) || (a.d - b.d));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const team = isTeams() && p.team >= 0 ? `<span style="color:${S.teamColors[p.team]}">● ${S.teamNames[p.team]}</span> · ` : '';
      const sub = inGame && p.playing ? `${team}💀 ${p.k} hạ · ☠️ ${p.d} chết${p.caps ? ` · 🚩 ${p.caps}` : ''}` : (inGame ? '👀 Đang xem' : `${team}Sẵn sàng`);
      return `<div class="pcard" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${inGame && p.playing ? `<div class="sc" style="color:${p.color}">${p.k}<small>hạ gục</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  const inviteLink = () => `${ui.lanBase || location.origin}/g/chienbinh/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Bot tự chạy nhảy, nhặt súng, bắn nhau và cướp cờ.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 6 người', 'small primary', n >= 6 ? 'disabled' : '')}
        ${btn('fill-bots-max', `Lấp đủ ${S.maxPlayers}`, 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function teamPanel() {
    if (!isTeams()) return '';
    const col = (t) => {
      const list = S.players.filter((p) => p.team === t);
      const mine = (player(S.me.id) || {}).team === t;
      return `<div class="tcol" style="--tc:${S.teamColors[t]}"><div class="thead">● Đội ${S.teamNames[t]} <small>${list.length} người</small></div>
        ${list.map((p) => `<div class="tm">${p.id === S.me.id ? '<b>Bạn</b>' : esc(p.name)}${p.bot ? ' 🤖' : ''}${p.bot && S.me.host ? `<button class="swapt" data-team-bot="${esc(p.id)}" data-to="${1 - t}" title="Chuyển đội">⇄</button>` : ''}</div>`).join('')}
        ${mine ? '<div class="gh-muted" style="font-size:12px">✔ Bạn ở đội này</div>' : btn('team', `Vào đội ${S.teamNames[t]}`, 'small', `data-team="${t}"`)}</div>`;
    };
    return `<div class="panel"><h3>👥 Chia đội</h3><div class="teams">${col(0)}${col(1)}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const limLabel = S.mode === 'ctf' ? '🚩 Số lần cướp cờ để thắng' : S.mode === 'team' ? '💀 Số mạng cả đội để thắng' : '💀 Số mạng để thắng';
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('mode', '🎮 Chế độ', S.choices.mode.map((v) => [v, S.modeNames[v]]))}
      ${sel('map', '🗺️ Bản đồ', S.choices.map)}
      ${sel('time', '⏱️ Thời gian', S.choices.time.map((v) => [v, `${v / 60} phút`]))}
      ${sel('limit', limLabel, S.choices.limit.map((v) => [v, String(v)]))}
      ${sel('bot_level', '🤖 Độ khó của bot', S.choices.bot_level.map((v) => [v, LEVEL_NAMES[v]]))}
    </div></div>`;
  }
  function keysPanel() {
    return `<div class="panel"><h3>🕹️ Điều khiển</h3><div class="keys">
      <span><kbd>A</kbd> <kbd>D</kbd> chạy</span><span><kbd>W</kbd> / <kbd>Space</kbd> nhảy</span><span><kbd>S</kbd> rơi xuống khỏi bục</span>
      <span>🖱️ di chuột ngắm, <b>giữ chuột trái</b> bắn</span><span><kbd>G</kbd> / chuột phải: lựu đạn</span><span><kbd>E</kbd> đổi súng dưới chân</span>
      <span>📱 Điện thoại: chạm giữ bản đồ để bắn</span></div></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const rows = S.ranking.map((pid, i) => {
        const p = player(pid);
        if (!p) return '';
        const win = S.winner === pid || (typeof S.winner === 'number' && p.team === S.winner);
        return `<div class="res-row ${win ? 'win' : ''}" style="--pc:${p.color}"><span class="rank">${i === 0 && win ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">${isTeams() ? `<span style="color:${S.teamColors[p.team]}">● ${S.teamNames[p.team]}</span> · ` : ''}☠️ ${p.d} chết${p.best >= 3 ? ` · 🔥 liên hoàn ${p.best}` : ''}${p.caps ? ` · 🚩 ${p.caps} cờ` : ''}</span></div>
          <span class="rpts" style="color:${p.color}">${p.k} hạ<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      const head = typeof S.winner === 'number' ? `Đội ${S.teamNames[S.winner]} thắng ${Math.max(...S.score)}–${Math.min(...S.score)}!`
        : S.winner ? `${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!` : 'Hoà!';
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${head}</h2><p>Ván ${S.gameNo} — ${S.modeNames[S.mode]} · ${esc(S.map.name)}${S.endReason === 'time' ? ' · hết giờ' : ''}</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>
        ${teamPanel()}${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🔫 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
        ${teamPanel()}${host ? botPanel() : ''}${settingsPanel()}${keysPanel()}<div class="panel">${start}</div>`;
    }
    setHTML(el, html);
  }

  // ---------------------------------------------------------------- biểu cảm & menu người chơi
  const SELF_FX = [['laugh', 'Cười'], ['angry', 'Tức'], ['cry', 'Khóc'], ['shock', 'Sốc'], ['think', 'Nghĩ'], ['clap', 'Vỗ tay'], ['dance', 'Nhảy']];
  const OTHER_FX = [['wave', 'Vẫy tay'], ['heart', 'Thả tim'], ['flower', 'Tặng hoa'], ['tomato', 'Ném cà chua'], ['highfive', 'Đập tay'], ['poke', 'Chọc']];
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function renderEmotes() {
    setHTML($('#emotes'), SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('')
      + btn('edit-look', '👗 Nhân vật', 'small')
      + (S && S.me.host && S.phase === 'play' ? btn('stop', '🏁 Kết thúc ván', 'small ghost') : '')
      + '<span class="hint">Nhấn vào người chơi trong danh sách để vẫy tay, ném cà chua…</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const meSelf = id === S.me.id;
    let html = `<div class="pmenu-head">${meSelf ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(meSelf ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (meSelf) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!meSelf && S.me.host && S.phase !== 'play') html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
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
    menuEl.dataset.target = meSelf ? '' : id;
  }
  function openLookEditor() {
    closeMenu();
    const body = document.createElement('div');
    let look = window.Avatar.get();
    window.Avatar.editor(body, { look, onChange: (l) => { look = l; } });
    const m = P.modal({
      title: '👗 Nhân vật của bạn', body,
      actions: [{ label: 'Huỷ', kind: 'ghost' },
        { label: '💾 Lưu', kind: 'primary', onClick: () => { window.Avatar.set(look); avaCache.clear(); send('set_look', { look: window.Avatar.get() }); } }],
    });
    m.el.querySelector('.gh-modal').classList.add('wide');
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
      : '<div class="empty-note">Diễn biến ván chơi sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🔫 ${S.modeNames[S.mode]}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Chiến Binh ${ROOM}`;
    renderBanner();
    renderCast();
    renderArena();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
  }

  // ---------------------------------------------------------------- sự kiện giao diện
  document.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-team-bot]');
    if (tb) { send('team', { pid: tb.dataset.teamBot, team: Number(tb.dataset.to) }); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'team': send('team', { team: Number(actEl.dataset.team) }); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay và xếp hạng theo điểm hiện tại.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: Math.max(1, 6 - S.players.length) }); break;
        case 'fill-bots-max': send('add_bot', { count: Math.max(1, S.maxPlayers - S.players.length) }); break;
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link': if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); break;
        default:
      }
      return;
    }
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
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    send('config', { [key]: key === 'time' || key === 'limit' ? Number(el.value) : el.value });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#chat-input');
    const text = inp.value.trim();
    if (text && send('chat', { text })) inp.value = '';
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
    try { localStorage.setItem('chienbinh_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('pick');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván chơi?',
        body: '<p>Ván đang diễn ra — vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
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
