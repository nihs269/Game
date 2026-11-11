(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true };
  try { ui.sound = localStorage.getItem('flappy_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };

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
  const colorOf = (id) => { const p = player(id); return (p && p.color) || '#ffd23f'; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let cast = null;
  function anchorEl(pid) {
    const a = cast && S && S.phase !== 'play' && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);

  // ---------------------------------------------------------------- âm thanh
  let actx = null;
  function beep(notes) {
    if (!ui.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      let t = actx.currentTime;
      notes.forEach(([freq, dur, type = 'sine', vol = 0.08, slide]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (e) { /* bỏ qua */ }
  }
  const SOUNDS = {
    flap: [[520, 0.07, 'triangle', 0.05, 820]],
    point: [[988, 0.06, 'square', 0.035], [1319, 0.12, 'square', 0.035]],
    hit: [[180, 0.18, 'sawtooth', 0.09, 60]],
    pick: [[660, 0.06], [880, 0.06], [1175, 0.12]],
    use: [[300, 0.16, 'sawtooth', 0.05, 900]],
    bad: [[440, 0.1, 'square', 0.05, 220], [330, 0.16, 'square', 0.05, 160]],
    zap: [[1400, 0.05, 'square', 0.06, 200], [900, 0.12, 'sawtooth', 0.06, 80]],
    shield: [[700, 0.08, 'triangle', 0.07], [500, 0.14, 'triangle', 0.07]],
    splat: [[200, 0.14, 'sawtooth', 0.06, 70]],
    tick: [[880, 0.06, 'square', 0.04]],
    go: [[1046, 0.18, 'square', 0.06]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]);

  // ---------------------------------------------------------------- thế giới (hằng số do máy chủ gửi)
  let W = null;
  let T_MAX = 0;
  function dist(t) {
    if (t <= 0) return 0;
    if (t <= T_MAX) return W.V0 * t + W.VA * t * t / 2;
    return W.V0 * T_MAX + W.VA * T_MAX * T_MAX / 2 + W.VMAX * (t - T_MAX);
  }
  const pipeX = (i) => W.FIRST + i * W.SPACING;
  const boxX = (i) => pipeX(i) + W.PW + (W.SPACING - W.PW) / 2;
  function passedAt(t) {
    const bx = dist(t) + W.BIRD_X - W.R;
    return clamp(Math.floor((bx - W.FIRST - W.PW) / W.SPACING) + 1, 0, course ? course.pipes.length : 0);
  }
  function hits(t, y, narrow) {
    const r = W.R;
    if (y + r >= W.GROUND) return true;
    const bx = dist(t) + W.BIRD_X;
    const i0 = Math.max(0, Math.floor((bx - r - W.FIRST - W.PW) / W.SPACING));
    for (const i of [i0, i0 + 1]) {
      if (i >= course.pipes.length) continue;
      const x0 = pipeX(i); const x1 = x0 + W.PW;
      if (bx + r <= x0 || bx - r >= x1) continue;
      const [c, g0] = course.pipes[i];
      const gap = narrow ? g0 - W.NARROW : g0;
      const top = c - gap / 2; const bot = c + gap / 2;
      const nx = clamp(bx, x0, x1);
      if (y - r < top && (y < top || (bx - nx) ** 2 + (y - top) ** 2 < r * r)) return true;
      if (y + r > bot && (y > bot || (bx - nx) ** 2 + (y - bot) ** 2 < r * r)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- đồng hồ ván chơi
  // localStart: mốc performance.now() (ms) ứng với t = 0 (lúc xuất phát) của ván hiện tại.
  let course = null;          // { g, pipes, boxes: Map(i → y) }
  let clock = { g: null, localStart: 0 };
  const worldT = () => (performance.now() - clock.localStart) / 1000;
  function syncClock(g, localStart) {
    if (clock.g !== g || Math.abs(localStart - clock.localStart) > 200) clock = { g, localStart };
  }

  // ---------------------------------------------------------------- con chim của mình
  const DT = 1 / 60;
  let me = null;              // { g, t, y, vy, alive, invUntil, lastSent, score }
  const usedShield = new Set();
  const appliedZap = new Set();
  const localTaken = new Set();
  let claimPending = 0;
  function resetMe() {
    me = { g: S.gameNo, t: 0, y: W.GROUND / 2, vy: 0, alive: true, started: false, invUntil: -1, lastSent: 0, score: 0, flapAt: -1 };
    usedShield.clear(); appliedZap.clear(); localTaken.clear(); claimPending = 0;
    remote.clear(); corpses.length = 0; feed.length = 0; splats.length = 0;
  }
  const myEffects = () => (S && S.effects ? S.effects.filter((e) => e.pid === S.me.id) : []);
  function active(kind, t) {
    return myEffects().find((e) => e.kind === kind && e.at <= t && t < e.until && !(kind === 'shield' && usedShield.has(e.id))) || null;
  }
  const flying = () => S && S.phase === 'play' && me && me.alive && S.me.playing && S.me.alive && course && course.g === S.gameNo;

  function flap() {
    if (!flying()) return;
    const now = worldT();
    if (now < 0) return;
    simulate(now);
    if (!me.alive) return;
    me.vy = active('flip', now) ? -W.FLAP : W.FLAP;
    me.flapAt = now;
    play('flap');
  }

  function simulate(tTo) {
    if (!me.started) {
      if (tTo < 0) return;
      me.started = true; me.t = 0; me.vy = W.FLAP; me.flapAt = 0;
    }
    let steps = 0;
    while (me.alive && me.t + DT <= tTo && steps++ < 3600) {
      me.t += DT;
      const t = me.t;
      const flip = !!active('flip', t);
      let g = W.G * (active('heavy', t) ? W.HEAVY : 1);
      if (flip) g = -g;
      // ⚡ Sét: hất xuống một lần.
      for (const e of myEffects()) {
        if (e.kind === 'zap' && !appliedZap.has(e.id) && e.at <= t) {
          appliedZap.add(e.id);
          if (t - e.at < 1.2) { me.vy = flip ? -W.ZAP : W.ZAP; fx.flash = performance.now(); fx.shake = performance.now(); play('zap'); }
        }
      }
      me.vy = clamp(me.vy + g * DT, -W.MAXFALL, W.MAXFALL);
      me.y += me.vy * DT;
      if (me.y < -60) { me.y = -60; me.vy = Math.max(0, me.vy); }
      if (t < me.invUntil) {
        if (me.y + W.R >= W.GROUND) { me.y = W.GROUND - W.R - 1; me.vy = W.FLAP; }
        continue;
      }
      if (hits(t, me.y, !!active('narrow', t))) {
        const sh = active('shield', t);
        if (sh) {
          usedShield.add(sh.id);
          send('shield_pop');
          me.invUntil = t + 1.0;
          me.vy = W.FLAP;
          if (me.y + W.R >= W.GROUND) me.y = W.GROUND - W.R - 1;
          fx.shieldPop = performance.now();
          play('shield');
          continue;
        }
        me.alive = false;
        corpses.push({ pid: S.me.id, wx: dist(t) + W.BIRD_X, y: me.y, vy: Math.min(me.vy, -200), born: performance.now(), color: colorOf(S.me.id) });
        fx.flash = performance.now(); fx.shake = performance.now();
        play('hit');
        send('die', { t });
        return;
      }
      // Hộp vật phẩm
      if (!S.me.held && performance.now() > claimPending) {
        const n = passedAt(t);
        for (const i of [n - 1, n]) {
          const y = course.boxes.get(i);
          if (y === undefined || localTaken.has(i) || S.taken.includes(i)) continue;
          const reach = W.R + W.BOX_R;
          if (Math.abs(dist(t) + W.BIRD_X - boxX(i)) < reach && Math.abs(me.y - y) < reach) {
            localTaken.add(i);
            claimPending = performance.now() + 600;
            send('claim', { i });
          }
        }
      }
    }
    const sc = passedAt(me.t);
    if (sc > me.score) { me.score = sc; play('point'); }
  }

  function useItem() {
    if (!flying() || !S.me.held) return;
    send('use');
  }

  // ---------------------------------------------------------------- chim của người khác
  const remote = new Map();   // pid → [{t, y, vy}]
  const corpses = [];
  const feed = [];            // dòng thông báo góc phải trên canvas
  const splats = [];          // vết cà chua trên màn hình mình
  const fx = { flash: 0, shake: 0, shieldPop: 0 };

  function onBirds(m) {
    if (!S || m.g !== S.gameNo) return;
    syncClock(m.g, performance.now() - m.t * 1000);
    for (const [pid, v] of Object.entries(m.b)) {
      if (pid === S.me.id && S.me.playing) continue;
      let buf = remote.get(pid);
      if (!buf) { buf = []; remote.set(pid, buf); }
      const [t, y, vy] = v;
      if (buf.length && t <= buf[buf.length - 1].t) continue;
      buf.push({ t, y, vy });
      if (buf.length > 24) buf.shift();
    }
  }

  // Vị trí hiển thị của chim khác: lùi lại ~0.12 s để nội suy cho mượt (chim hơi đi sau mình một chút, đúng với ống).
  function remotePos(pid, now) {
    const buf = remote.get(pid);
    if (!buf || !buf.length) return null;
    const rt = now - 0.12;
    let a = buf[0];
    if (rt <= a.t) return { t: a.t, y: a.y, vy: a.vy };
    for (let k = 1; k < buf.length; k++) {
      const b = buf[k];
      if (rt <= b.t) {
        const f = (rt - a.t) / (b.t - a.t || 1);
        return { t: rt, y: a.y + (b.y - a.y) * f, vy: a.vy + (b.vy - a.vy) * f };
      }
      a = b;
    }
    const dt = Math.min(0.25, rt - a.t);
    return { t: a.t + dt, y: a.y + a.vy * dt + 0.5 * W.G * dt * dt * (a.vy < 0 ? 1 : 0.5), vy: a.vy };
  }

  // ---------------------------------------------------------------- vẽ
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let view = { w: 800, h: 600, s: 1, dpr: 1 };
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width || !r.height) return;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const s = r.height / 600;
    view = { w: r.width / s, h: 600, s, dpr, cssW: r.width, cssH: r.height };
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
  window.addEventListener('resize', resize);

  // ---- Phong cách chibi: nét viền dày bo tròn, màu pastel, mặt cười dễ thương
  const FONT = '"Baloo 2", "Be Vietnam Pro", system-ui, sans-serif';
  if (document.fonts) document.fonts.load('800 20px "Baloo 2"').catch(() => {});
  const HOUSE_COLORS = ['#ffd6e0', '#fff1b8', '#d4f0ff', '#e3d7ff', '#d8f7d0'];
  const ROOF_COLORS = ['#ff8fa3', '#7ec8ff', '#b39bff', '#ffb26b', '#6fd6a8'];
  const CLOUDS = Array.from({ length: 8 }, (_, i) => ({ x: i * 300 + (i * 97) % 140, y: 55 + (i * 53) % 150, s: 0.7 + ((i * 37) % 10) / 16, face: i % 3 === 0 }));
  const HILLS = Array.from({ length: 10 }, (_, i) => ({ w: 260 + (i * 83) % 160, h: 95 + (i * 47) % 70, tree: i % 2 === 0 }));
  const HOUSES = Array.from({ length: 12 }, (_, i) => ({
    w: 46 + (i * 29) % 26, h: 40 + (i * 41) % 34, gap: 60 + (i * 67) % 150,
    c: HOUSE_COLORS[i % HOUSE_COLORS.length], roof: ROOF_COLORS[(i * 3) % ROOF_COLORS.length],
  }));
  const FLOWERS = Array.from({ length: 16 }, (_, i) => ({ x: i * 67 + (i * 31) % 40, c: ['#ff8fb1', '#ffd166', '#ffffff', '#b9a2ff'][i % 4], dy: (i * 13) % 8 }));
  const HILLS_LEN = HILLS.reduce((s, h) => s + h.w * 0.8, 0);
  const HOUSES_LEN = HOUSES.reduce((s, h) => s + h.w + h.gap, 0);

  // Pha màu về phía trắng (to = 255) hoặc đen (to = 0).
  function mix(hex, k, to = 255) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (to - v) * k), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const shade = (hex, k) => mix(hex, 1 - k, 0);

  // Viền kiểu hoạt hình: vẽ nét dày trước rồi tô đè lên → chỉ còn viền ngoài của cả cụm hình.
  function blob(path, fill, line, lw) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(); ctx.lineWidth = lw * 2; ctx.strokeStyle = line; ctx.stroke();
    path(); ctx.fillStyle = fill; ctx.fill();
  }

  function drawBackground(cam, now) {
    const sky = ctx.createLinearGradient(0, 0, 0, W.GROUND);
    sky.addColorStop(0, '#8ad4ff'); sky.addColorStop(0.6, '#c9eeff'); sky.addColorStop(1, '#fff3d9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, W.GROUND);
    drawSun(view.w - 95, 88, now);
    // Mây (trôi rất chậm), vài đám có mặt cười
    const cw = 300 * CLOUDS.length;
    CLOUDS.forEach((c) => {
      const x = ((c.x - cam * 0.1) % cw + cw) % cw - 140;
      if (x < view.w + 120) cloud(x, c.y, c.s, c.face);
    });
    // Đồi + cây tròn
    let x = -((cam * 0.22) % HILLS_LEN);
    for (let k = 0; x < view.w + 200; k++) {
      const h = HILLS[k % HILLS.length];
      const cx = x + h.w / 2;
      if (h.tree) tree(cx - h.w * 0.12, W.GROUND - h.h + 12, 0.9);
      blob(() => { ctx.beginPath(); ctx.ellipse(cx, W.GROUND + 10, h.w / 2, h.h + 10, 0, Math.PI, 0); ctx.closePath(); }, '#aee79f', '#7cc46e', 1.5);
      x += h.w * 0.8;
    }
    // Nhà nhỏ
    x = -((cam * 0.4) % HOUSES_LEN);
    for (let k = 0; x < view.w + 100; k++) {
      const hs = HOUSES[k % HOUSES.length];
      house(x, W.GROUND - 4, hs);
      x += hs.w + hs.gap;
    }
    // Bụi cây
    for (let bx = -((cam * 0.6) % 90) - 45; bx < view.w + 90; bx += 90) {
      blob(() => {
        ctx.beginPath();
        ctx.arc(bx + 20, W.GROUND + 2, 22, 0, 7); ctx.arc(bx + 45, W.GROUND - 6, 28, 0, 7); ctx.arc(bx + 72, W.GROUND + 2, 22, 0, 7);
      }, '#86dc79', '#55a956', 1.5);
    }
  }

  // Mặt đất vẽ sau ống để chân ống “cắm” xuống dưới cỏ: đất chấm bi + cỏ viền gợn sóng + hoa.
  function drawGround(cam) {
    const H = 600;
    ctx.fillStyle = '#f7dfae';
    ctx.fillRect(0, W.GROUND, view.w, H - W.GROUND);
    ctx.fillStyle = '#efc98c';
    for (let gx = -(cam % 46); gx < view.w + 46; gx += 46) {
      ctx.beginPath(); ctx.arc(gx + 12, W.GROUND + 34, 4, 0, 7); ctx.arc(gx + 35, W.GROUND + 50, 3, 0, 7); ctx.fill();
    }
    const off = cam % 24;
    blob(() => {
      ctx.beginPath();
      ctx.moveTo(-30, W.GROUND - 2); ctx.lineTo(view.w + 30, W.GROUND - 2);
      for (let gx = view.w + 24 - ((view.w + 24 + off) % 24); gx > -48; gx -= 24) ctx.arc(gx, W.GROUND + 10, 12, 0, Math.PI);
      ctx.closePath();
    }, '#8ee36b', '#5aa845', 1.5);
    const fl = 67 * FLOWERS.length;
    FLOWERS.forEach((f) => {
      const fx2 = ((f.x - cam) % fl + fl) % fl - 20;
      if (fx2 < view.w + 20) flower(fx2, W.GROUND + 8 + f.dy, f.c);
    });
  }

  function drawSun(x, y, now) {
    ctx.save();
    ctx.translate(x, y);
    ctx.save();
    ctx.rotate(now * 0.25);
    ctx.fillStyle = 'rgba(255,226,140,.75)';
    for (let k = 0; k < 12; k++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath(); ctx.moveTo(-7, -44); ctx.quadraticCurveTo(0, -66, 7, -44); ctx.fill();
    }
    ctx.restore();
    blob(() => { ctx.beginPath(); ctx.arc(0, 0, 38, 0, 7); }, '#ffdc5e', '#f2a93b', 1.5);
    ctx.strokeStyle = '#8a5a1a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-12, 0, 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(12, 0, 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 8, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(255,130,130,.55)';
    ctx.beginPath(); ctx.ellipse(-21, 8, 6, 3.5, 0, 0, 7); ctx.ellipse(21, 8, 6, 3.5, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function cloud(x, y, s, face) {
    blob(() => {
      ctx.beginPath();
      ctx.arc(x, y, 20 * s, 0, 7); ctx.arc(x + 24 * s, y - 13 * s, 26 * s, 0, 7);
      ctx.arc(x + 54 * s, y - 6 * s, 22 * s, 0, 7); ctx.arc(x + 72 * s, y + 6 * s, 15 * s, 0, 7);
      ctx.rect(x, y, 72 * s, 20 * s);
    }, '#ffffff', '#b7dcf5', 1.5);
    if (!face) return;
    ctx.fillStyle = '#6b7fa3';
    ctx.beginPath(); ctx.arc(x + 26 * s, y + 2 * s, 2.4 * s, 0, 7); ctx.arc(x + 44 * s, y + 2 * s, 2.4 * s, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,150,170,.6)';
    ctx.beginPath(); ctx.ellipse(x + 19 * s, y + 9 * s, 4 * s, 2.4 * s, 0, 0, 7); ctx.ellipse(x + 51 * s, y + 9 * s, 4 * s, 2.4 * s, 0, 0, 7); ctx.fill();
  }

  function tree(x, y, s) {
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#a0704a'; ctx.strokeStyle = '#6e4a2c'; ctx.lineWidth = 2;
    roundRect(x - 3 * s, y - 4, 6 * s, 30 * s, 3); ctx.fill(); ctx.stroke();
    blob(() => {
      ctx.beginPath(); ctx.arc(x, y - 12 * s, 17 * s, 0, 7); ctx.arc(x - 11 * s, y - 2 * s, 11 * s, 0, 7); ctx.arc(x + 11 * s, y - 2 * s, 11 * s, 0, 7);
    }, '#6fd36a', '#46a043', 1.5);
  }

  function house(x, base, h) {
    const top = base - h.h;
    ctx.lineJoin = 'round';
    ctx.fillStyle = h.c; ctx.strokeStyle = '#7a6a8a'; ctx.lineWidth = 2.5;
    roundRect(x, top, h.w, h.h + 4, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = h.roof;
    ctx.beginPath(); ctx.moveTo(x - 7, top + 4); ctx.quadraticCurveTo(x + h.w / 2, top - h.w * 0.75, x + h.w + 7, top + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff6c9';
    roundRect(x + h.w * 0.2, top + 10, 11, 11, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = shade(h.roof, 0.8);
    roundRect(x + h.w * 0.58, base - 18, 12, 20, 6); ctx.fill(); ctx.stroke();
  }

  function flower(x, y, c) {
    ctx.strokeStyle = '#5aa845'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = c;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 3.6, y - 2 + Math.sin(a) * 3.6, 2.8, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(x, y - 2, 2.2, 0, 7); ctx.fill();
  }

  function drawPipes(cam, narrow) {
    if (!course) return;
    const first = Math.max(0, Math.floor((cam - W.FIRST - W.PW) / W.SPACING));
    const last = Math.min(course.pipes.length - 1, Math.ceil((cam + view.w - W.FIRST) / W.SPACING));
    for (let i = first; i <= last; i++) {
      const x = pipeX(i) - cam;
      const [c, g0] = course.pipes[i];
      const gap = narrow ? g0 - W.NARROW : g0;
      pipe(x, c - gap / 2, true, narrow, i);
      pipe(x, c + gap / 2, false, narrow, i);
    }
  }
  const PIPE_OK = { a: '#5fd46b', b: '#b4f5a6', c: '#3fae4f', line: '#2f7d3a', dot: 'rgba(255,255,255,.22)' };
  const PIPE_WARN = { a: '#ff7f8f', b: '#ffc4cc', c: '#e0566a', line: '#a8324a', dot: 'rgba(255,255,255,.3)' };
  function pipe(x, edge, top, warn, i) {
    const p = warn ? PIPE_WARN : PIPE_OK;
    const w = W.PW;
    const capH = 28;
    const grad = (x0, x1) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, p.a); g.addColorStop(0.3, p.b); g.addColorStop(0.55, p.a); g.addColorStop(1, p.c);
      return g;
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5; ctx.strokeStyle = p.line;
    // thân ống
    const by0 = top ? -20 : edge + capH - 8;
    const by1 = top ? edge - capH + 8 : W.GROUND + 20;
    ctx.fillStyle = grad(x + 5, x + w - 5);
    roundRect(x + 5, by0, w - 10, by1 - by0, 10); ctx.fill(); ctx.stroke();
    // chấm bi trên thân (bám theo miệng ống)
    ctx.fillStyle = p.dot;
    const step = top ? -46 : 46;
    for (let yy = top ? by1 - 30 : by0 + 30; top ? yy > by0 : yy < by1; yy += step) {
      ctx.beginPath(); ctx.arc(x + w * 0.62, yy, 5, 0, 7); ctx.arc(x + w * 0.4, yy + step / 2, 3.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    roundRect(x + 12, by0 + 6, 6, by1 - by0 - 12, 3); ctx.fill();
    // miệng ống
    const cy = top ? edge - capH : edge;
    ctx.fillStyle = grad(x - 4, x + w + 4);
    roundRect(x - 4, cy, w + 8, capH, 11); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    roundRect(x + 4, cy + 5, 8, capH - 10, 4); ctx.fill();
    // mầm lá / hoa nhỏ trên vài miệng ống dưới
    if (!top && i % 3 === 0) {
      ctx.fillStyle = '#7be36a'; ctx.strokeStyle = '#3f9a3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x + w * 0.62, cy - 5, 8, 4, -0.6, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + w * 0.78, cy - 6, 7, 3.5, 0.6, 0, 7); ctx.fill(); ctx.stroke();
    } else if (!top && i % 3 === 1) {
      flower(x + w * 0.3, cy - 8, i % 2 ? '#ff8fb1' : '#ffd166');
    }
  }

  function drawBoxes(cam, now) {
    if (!course) return;
    course.boxes.forEach((y, i) => {
      const x = boxX(i) - cam;
      if (x < -40 || x > view.w + 40 || localTaken.has(i) || S.taken.includes(i)) return;
      const ph = now * 4 + i;
      const sq = 1 + Math.sin(ph * 2) * 0.05;
      const r = W.BOX_R + 1;
      ctx.save();
      ctx.translate(x, y + Math.sin(ph) * 4);
      // lấp lánh xung quanh
      for (let k = 0; k < 3; k++) {
        const a = now * 1.5 + k * 2.1;
        const tw = (Math.sin(now * 5 + k * 2) + 1) / 2;
        sparkle(Math.cos(a) * (r + 12), Math.sin(a) * (r + 10), 3 + tw * 3, `rgba(255,250,200,${0.4 + tw * 0.6})`);
      }
      ctx.rotate(Math.sin(now * 2 + i) * 0.12);
      ctx.scale(sq, 2 - sq);
      ctx.shadowColor = 'rgba(255,170,230,.9)'; ctx.shadowBlur = 16;
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#ffb8e8'); g.addColorStop(1, '#a98bff');
      ctx.fillStyle = g;
      roundRect(-r, -r, r * 2, r * 2, 9); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = '#7a4fc4'; ctx.lineJoin = 'round'; ctx.stroke();
      // ruy băng + nơ
      ctx.fillStyle = '#fff1a6';
      ctx.fillRect(-4, -r + 1.5, 8, r * 2 - 3);
      ctx.fillRect(-r + 1.5, -4, r * 2 - 3, 8);
      ctx.strokeStyle = '#d19a2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(-7, -r - 3, 7, 4.5, 0.4, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(7, -r - 3, 7, 4.5, -0.4, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -r - 2, 3.2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.font = `800 21px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = '#7a4fc4'; ctx.strokeText('?', 0, 2);
      ctx.fillStyle = '#fff'; ctx.fillText('?', 0, 2);
      ctx.restore();
    });
  }
  function sparkle(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.6); ctx.quadraticCurveTo(x, y, x + s * 1.6, y); ctx.quadraticCurveTo(x, y, x, y + s * 1.6);
    ctx.quadraticCurveTo(x, y, x - s * 1.6, y); ctx.quadraticCurveTo(x, y, x, y - s * 1.6);
    ctx.fill();
  }
  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Chim chibi: tròn ủm, mắt to long lanh, má hồng, chỏm lông trên đầu.
  function drawBird(x, y, vy, color, { alpha = 1, wing = 0, dead = false, flip = false, spin = 0, worried = false, now = 0 } = {}) {
    const line = shade(color, 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    let rot = clamp(vy / 900, -0.35, 0.9);
    if (flip) rot = -rot;
    ctx.rotate(rot + spin);
    if (flip) ctx.scale(1, -1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 2.5; ctx.strokeStyle = line;
    // đuôi
    ctx.fillStyle = shade(color, 0.85);
    ctx.beginPath(); ctx.ellipse(-17, -3, 7, 3.6, -0.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-17, 3, 6, 3.2, 0.3, 0, 7); ctx.fill(); ctx.stroke();
    // chỏm lông
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(-1, -17, 3.4, 6, -0.35, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(4, -17, 3, 5.4, 0.3, 0, 7); ctx.fill(); ctx.stroke();
    // thân tròn
    const g = ctx.createRadialGradient(-5, -7, 3, 0, 0, 19);
    g.addColorStop(0, mix(color, 0.45)); g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 16.5, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath(); ctx.ellipse(3, 8, 10.5, 6, 0, 0, 7); ctx.fill();
    // cánh nhỏ
    ctx.lineWidth = 2.5;
    ctx.fillStyle = mix(color, 0.2);
    ctx.beginPath(); ctx.ellipse(-6, 4 + wing * 4, 8, 5.5, -0.5 + wing * 0.6, 0, 7); ctx.fill(); ctx.stroke();
    // má hồng
    ctx.fillStyle = 'rgba(255,120,150,.55)';
    ctx.beginPath(); ctx.ellipse(0, 4, 3.6, 2.2, 0, 0, 7); ctx.ellipse(15, 3, 3, 2, 0, 0, 7); ctx.fill();
    // mắt
    if (dead) {
      ctx.strokeStyle = '#2b1d3a'; ctx.lineWidth = 2.2;
      [[3, -4, 3.2], [11, -4, 3.6]].forEach(([ex, ey, s]) => {
        ctx.beginPath(); ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s); ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s); ctx.stroke();
      });
    } else {
      [[3, -4, 3.9, 4.6], [11, -4, 4.4, 5.3]].forEach(([ex, ey, rx, ry]) => {
        ctx.fillStyle = '#2b1d3a';
        ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex - rx * 0.3, ey - ry * 0.35, rx * 0.42, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + rx * 0.35, ey + ry * 0.35, rx * 0.2, 0, 7); ctx.fill();
      });
    }
    // mỏ nhỏ
    ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#c56d12'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(24, 2.5, 16, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (dead) {
      ctx.fillStyle = '#ff7f9a';
      ctx.beginPath(); ctx.ellipse(17, 8, 2.4, 3.2, 0.3, 0, 7); ctx.fill();
    }
    // giọt mồ hôi khi đang dính vật phẩm của đối thủ
    if (worried) {
      ctx.fillStyle = '#9fdcff'; ctx.strokeStyle = '#4a9fd8'; ctx.lineWidth = 1.5;
      const dy = Math.sin(now * 6) * 1.5;
      ctx.beginPath(); ctx.moveTo(19, -16 + dy); ctx.quadraticCurveTo(24, -8 + dy, 19, -6 + dy); ctx.quadraticCurveTo(14, -8 + dy, 19, -16 + dy); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // Sao xoay vòng trên đầu chim vừa rơi.
  function dizzy(x, y, now) {
    for (let k = 0; k < 3; k++) {
      const a = now * 5 + k * 2.09;
      sparkle(x + Math.cos(a) * 16, y + Math.sin(a) * 5, 3.4, '#ffd84d');
    }
  }

  function label(x, y, text, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = '#fffaf2';
    roundRect(x - w / 2, y - 10, w, 20, 10); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#3a2f55';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  function effectIcons(pid, t) {
    if (!S.effects) return '';
    return S.effects.filter((e) => e.pid === pid && e.at <= t && t < e.until && e.kind !== 'zap' && !(e.kind === 'shield' && pid === S.me.id && usedShield.has(e.id)))
      .map((e) => (e.kind === 'splat' ? '🍅' : S.items[e.kind] ? S.items[e.kind].icon : '')).join('');
  }

  function drawShield(x, y, now) {
    const r = 28 + Math.sin(now * 6) * 1.5;
    ctx.save();
    const g = ctx.createRadialGradient(x - 6, y - 8, 4, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.05)'); g.addColorStop(0.75, 'rgba(160,220,255,.22)'); g.addColorStop(1, 'rgba(120,200,255,.5)');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(120,200,255,.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r - 6, Math.PI * 1.1, Math.PI * 1.4); ctx.stroke();
    ctx.restore();
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!S || S.phase !== 'play' || !W || !course || course.g !== S.gameNo || $('#arena').hidden) return;
    if (!view.cssW) resize();
    const now = worldT();
    const tc = Math.max(0, now);
    if (me && me.g === S.gameNo && S.me.playing) {
      if (me.alive) simulate(now);
      if (me.alive && performance.now() - me.lastSent > 66) {
        me.lastSent = performance.now();
        send('pos', { t: Math.max(0, me.t), y: Math.round(me.y * 10) / 10, vy: Math.round(me.vy) });
      }
    }
    const cam = dist(now);
    const wallMs = performance.now();
    ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, 0, 0);
    if (wallMs - fx.shake < 350) {
      const k = (1 - (wallMs - fx.shake) / 350) * 7;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    const mine = me && me.alive && S.me.playing;
    const narrow = mine && !!active('narrow', now);
    drawBackground(cam, wallMs / 1000);
    drawPipes(cam, narrow);
    drawGround(cam);
    drawBoxes(cam, wallMs / 1000);

    // Xác chim rơi
    for (let k = corpses.length - 1; k >= 0; k--) {
      const c = corpses[k];
      const age = (wallMs - c.born) / 1000;
      const y = Math.min(W.GROUND - 12, c.y + c.vy * age + 0.5 * W.G * age * age);
      const x = c.wx - cam;
      if (x < -60 || age > 6) { corpses.splice(k, 1); continue; }
      drawBird(x, y, 600, c.color, { alpha: c.pid === S.me.id ? 1 : 0.6, dead: true, spin: Math.min(age * 6, 1.4) });
      dizzy(x, y - 24, wallMs / 1000);
    }

    // Chim người khác
    const alive = S.players.filter((p) => p.alive && !(p.id === S.me.id && S.me.playing));
    alive.forEach((p) => {
      const rp = remotePos(p.id, now);
      if (!rp) return;
      const x = W.BIRD_X - (cam - dist(rp.t));
      const fxIcons = effectIcons(p.id, tc);
      const flip = fxIcons.includes('🔄');
      drawBird(x, rp.y, rp.vy, p.color || '#ffd23f', { alpha: 0.65, wing: Math.sin(wallMs / 60 + x) * (rp.vy < 0 ? 1 : 0.3), flip,
        worried: !!fxIcons.replace('🛡️', ''), now: wallMs / 1000 });
      if (S.effects.some((e) => e.pid === p.id && e.kind === 'shield' && e.at <= tc && tc < e.until)) drawShield(x, rp.y, wallMs / 1000);
      const icons = effectIcons(p.id, tc).replace('🛡️', '');
      label(x, rp.y - 30, `${p.name}${icons ? ' ' + icons : ''}`, p.color || '#fff', 0.85);
      p._sx = x; p._sy = rp.y;
    });

    // Chim của mình
    if (mine) {
      const flip = !!active('flip', me.t);
      const y = me.started ? me.y : W.GROUND / 2 + Math.sin(wallMs / 220) * 8;
      const flapAge = me.t - me.flapAt;
      const wing = flapAge < 0.25 ? Math.cos(flapAge * 40) : Math.sin(wallMs / 120) * 0.3;
      const blink = me.t < me.invUntil && Math.floor(wallMs / 80) % 2;
      const worried = myEffects().some((e) => e.kind !== 'shield' && e.kind !== 'zap' && e.at <= me.t && me.t < e.until);
      drawBird(W.BIRD_X, y, me.started ? me.vy : 0, colorOf(S.me.id), { wing, flip, alpha: blink ? 0.4 : 1, worried, now: wallMs / 1000 });
      if (active('shield', me.t)) drawShield(W.BIRD_X, y, wallMs / 1000);
      if (active('heavy', me.t)) { ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🪨', W.BIRD_X - 2, y + 30); }
      if (wallMs - fx.shieldPop < 400) {
        const k = (wallMs - fx.shieldPop) / 400;
        ctx.strokeStyle = `rgba(120,200,255,${1 - k})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(W.BIRD_X, y, 26 + k * 40, 0, 7); ctx.stroke();
      }
      // Hiệu ứng che mắt
      if (active('fog', me.t)) {
        const g = ctx.createRadialGradient(W.BIRD_X + 40, y, 50, W.BIRD_X + 40, y, 175);
        g.addColorStop(0, 'rgba(60,40,100,0)'); g.addColorStop(1, 'rgba(45,32,80,.97)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, 600);
      }
      if (flip) { ctx.fillStyle = 'rgba(150,60,220,.16)'; ctx.fillRect(0, 0, view.w, 600); }
    }
    drawSplats(tc);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawHud(now, wallMs);
  }
  requestAnimationFrame(frame);

  function drawSplats(t) {
    const live = new Set(myEffects().filter((e) => e.kind === 'splat' && e.at <= t && t < e.until).map((e) => e.id));
    for (let k = splats.length - 1; k >= 0; k--) if (!live.has(splats[k].id)) splats.splice(k, 1);
    myEffects().forEach((e) => {
      if (!live.has(e.id) || splats.some((s) => s.id === e.id)) return;
      const blobs = Array.from({ length: 3 }, () => ({
        x: W.BIRD_X + 40 + Math.random() * Math.min(500, view.w - 200), y: 80 + Math.random() * 380, r: 55 + Math.random() * 40,
        drops: Array.from({ length: 7 }, () => ({ a: Math.random() * 6.28, d: 0.9 + Math.random() * 0.6, r: 8 + Math.random() * 12 })),
      }));
      splats.push({ id: e.id, until: e.until, blobs });
    });
    splats.forEach((s) => {
      const fade = clamp((s.until - t) / 0.8, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.9 * fade;
      s.blobs.forEach((b) => {
        ctx.fillStyle = '#d7261e';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
        b.drops.forEach((d) => { ctx.beginPath(); ctx.arc(b.x + Math.cos(d.a) * b.r * d.d, b.y + Math.sin(d.a) * b.r * d.d, d.r, 0, 7); ctx.fill(); });
        ctx.fillStyle = 'rgba(255,140,120,.5)';
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.35, 0, 7); ctx.fill();
      });
      ctx.restore();
    });
  }

  function hudText(text, x, y, size, align = 'center', color = '#fff') {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 4.5); ctx.strokeStyle = '#3b2a63';
    ctx.strokeText(text, x, y + Math.max(2, size / 16));  // bóng đổ dày phía dưới
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function drawHud(now, wallMs) {
    const w = view.cssW; const h = view.cssH;
    if (wallMs - fx.flash < 220) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - (wallMs - fx.flash) / 220)})`;
      ctx.fillRect(0, 0, w, h);
    }
    // Đếm ngược
    if (now < 0) {
      const n = Math.ceil(-now);
      if (n !== ui.lastCd) { ui.lastCd = n; if (n <= 3) play('tick'); }
      hudText(n > 3 ? 'Chuẩn bị…' : String(n), w / 2, h * 0.38, n > 3 ? 40 : 90);
      if (S.me.playing) hudText('Bấm / chạm / Space để vỗ cánh', w / 2, h * 0.38 + 70, 17);
    } else if (ui.lastCd !== 0 && ui.lastCd !== undefined) {
      ui.lastCd = 0; play('go');
    }
    if (now >= 0 && now < 0.8) hudText('BAY!', w / 2, h * 0.38, 80, 'center', '#ffe66d');
    // Điểm
    const score = me && S.me.playing ? (me.alive ? me.score : (player(S.me.id) || {}).score || me.score) : passedAt(Math.max(0, now));
    hudText(String(score), w / 2, 46, 52);
    // Số chim còn bay + hiệu ứng đang dính
    const alive = S.players.filter((p) => p.alive).length;
    const total = S.players.filter((p) => p.playing).length;
    hudText(`🐦 ${alive}/${total}`, 14, 26, 18, 'left');
    let y = 54;
    if (me && me.alive && S.me.playing) {
      myEffects().filter((e) => e.kind !== 'zap' && e.at <= me.t && me.t < e.until && !usedShield.has(e.id)).forEach((e) => {
        const it = e.kind === 'splat' ? { icon: '🍅', name: 'Cà chua' } : S.items[e.kind];
        hudText(`${it.icon} ${it.name} ${(e.until - me.t).toFixed(1)}s`, 14, y, 15, 'left', e.kind === 'shield' ? '#9be7ff' : '#ffb3b3');
        y += 22;
      });
    }
    // Thông báo
    const tw = wallMs;
    let fy = 22;
    for (let k = feed.length - 1, shown = 0; k >= 0 && shown < 5; k--) {
      const f = feed[k];
      const age = (tw - f.at) / 1000;
      if (age > 5) continue;
      ctx.globalAlpha = clamp(5 - age, 0, 1);
      hudText(f.text, w - 12, fy, 14, 'right', f.color || '#fff');
      ctx.globalAlpha = 1;
      fy += 22; shown++;
    }
    // Người xem / đã rơi
    if (S.me.playing && me && !me.alive && !S.ending) {
      hudText('💥 Bạn đã rơi!', w / 2, h * 0.4, 34);
      if (S.config.tomato) hudText('Bấm vào chim đang bay để ném 🍅', w / 2, h * 0.4 + 40, 16, 'center', '#ffe66d');
    } else if (!S.me.playing) {
      hudText(`👀 Đang xem${S.config.tomato ? ' — bấm vào chim để ném 🍅' : ''}`, w / 2, h - 24, 15);
    }
    if (S.ending) hudText('🏁 Kết thúc!', w / 2, h * 0.4, 44, 'center', '#ffe66d');
    // Cà chua đang bay
    for (let k = flyingTomatoes.length - 1; k >= 0; k--) {
      const ft = flyingTomatoes[k];
      const p = clamp((tw - ft.at) / 450, 0, 1);
      const tp = player(ft.target);
      const tx = tp && tp._sx !== undefined ? tp._sx * view.s : (ft.target === S.me.id ? W.BIRD_X * view.s : w / 2);
      const ty = tp && tp._sy !== undefined && ft.target !== S.me.id ? tp._sy * view.s : (me ? me.y * view.s : h / 2);
      const x = ft.x0 + (tx - ft.x0) * p; const yy = ft.y0 + (ty - ft.y0) * p - Math.sin(p * Math.PI) * 80;
      ctx.font = '26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p < 1 ? '🍅' : '💥', x, yy);
      if (tw - ft.at > 700) flyingTomatoes.splice(k, 1);
    }
  }
  const flyingTomatoes = [];

  // ---------------------------------------------------------------- điều khiển
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!S || S.phase !== 'play') return;
    if (flying()) { flap(); return; }
    // Đã rơi / đang xem: ném cà chua vào chim gần chỗ bấm nhất
    if (!S.config.tomato) return;
    const r = cv.getBoundingClientRect();
    const wx = (e.clientX - r.left) / view.s; const wy = (e.clientY - r.top) / view.s;
    let best = null; let bd = 70 * 70;
    S.players.forEach((p) => {
      if (!p.alive || p._sx === undefined || (p.id === S.me.id && S.me.playing)) return;
      const d = (p._sx - wx) ** 2 + (p._sy - wy) ** 2;
      if (d < bd) { bd = d; best = p; }
    });
    if (best) throwTomato(best.id);
  });
  function throwTomato(target) {
    const wait = S.me.tomatoReady - (Date.now() / 1000 + (S.now - ui.recvAt));
    if (wait > 0) { P.toast(`Chờ ${Math.ceil(wait)} giây nữa mới ném tiếp được.`, 'error'); return; }
    send('tomato', { target });
  }
  $('#btn-item').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); useItem(); });

  document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || !S || S.phase !== 'play') return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (!e.repeat) flap();
    } else if (e.key === 'e' || e.key === 'E' || e.key === 'Shift') {
      e.preventDefault();
      if (!e.repeat) useItem();
    }
  });

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
    if (m.type === 'birds') onBirds(m);
    else if (m.type === 'course') {
      course = { g: m.g, pipes: m.pipes, boxes: new Map(m.boxes.map(([i, y]) => [i, y])) };
    }
  }

  function onState(state) {
    S = state;
    ui.recvAt = Date.now() / 1000;
    if (!W && S.world) { W = S.world; T_MAX = (W.VMAX - W.V0) / W.VA; }
    if (S.phase === 'play' && S.startAt) {
      syncClock(S.gameNo, performance.now() + (S.startAt - S.now) * 1000);
      if (!me || me.g !== S.gameNo) resetMe();
      // Máy chủ đã tính mình rơi (vào lại giữa ván, rớt mạng…).
      if (S.me.playing && !S.me.alive) me.alive = false;
    }
    if (S.me.held) claimPending = 0;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    render();
    fresh.forEach(playEvent);
  }

  function pushFeed(text, color) {
    feed.push({ text, color, at: performance.now() });
    if (feed.length > 20) feed.shift();
  }
  const short = (id) => (S && id === S.me.id ? 'Bạn' : nm(id));

  function playEvent(e) {
    switch (e.type) {
      case 'start': ui.lastCd = undefined; break;
      case 'die': {
        if (e.pid !== S.me.id || !S.me.playing) {
          const now = worldT();
          const rp = W && remotePos(e.pid, now);
          if (rp) corpses.push({ pid: e.pid, wx: dist(rp.t) + W.BIRD_X, y: rp.y, vy: -150, born: performance.now(), color: colorOf(e.pid) });
          if (S.phase === 'play') play('bad');
        }
        pushFeed(`💥 ${short(e.pid)} rơi · ${e.score} ống`, '#ffb3b3');
        break;
      }
      case 'pick':
        if (course) localTaken.add(e.box);
        if (e.pid === S.me.id) { play('pick'); pushFeed(`🎁 Bạn nhặt được ${S.items[e.item].icon} ${S.items[e.item].name}!`, '#ffe66d'); }
        break;
      case 'use': {
        const it = S.items[e.item];
        const hitMe = e.victims.includes(S.me.id) && e.pid !== S.me.id;
        if (e.pid === S.me.id) play('use');
        if (hitMe && e.item !== 'zap') play('bad');
        const whom = it.target === 'self' ? '' : it.target === 'all' ? ' → tất cả' : ` → ${short(e.victims[0])}`;
        pushFeed(`${it.icon} ${short(e.pid)}${whom}`, hitMe ? '#ff8080' : '#fff');
        break;
      }
      case 'shield':
        if (e.pid !== S.me.id) pushFeed(`🛡️ Khiên của ${short(e.pid)} vỡ!`, '#9be7ff');
        break;
      case 'tomato': {
        const r = cv.getBoundingClientRect();
        flyingTomatoes.push({ target: e.target, at: performance.now(), x0: r.width * (0.3 + Math.random() * 0.6), y0: r.height });
        if (e.target === S.me.id) play('splat');
        pushFeed(`🍅 ${short(e.pid)} → ${short(e.target)}`, '#ffb3b3');
        break;
      }
      case 'win':
        play('win');
        if (e.pid) { bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        break;
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
    let big = '🐦';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Cất cánh bên dưới (bay một mình cũng được)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = S.winner ? '🏆' : '🏁'; cls += ' win';
      title = S.winner ? `${who(S.winner)} thắng!` : `Bay được ${(player(S.ranking[0]) || {}).score || 0} ống`;
      sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const alive = S.players.filter((p) => p.alive).length;
      title = `Ván ${S.gameNo} · còn ${alive} chú chim`;
      if (!S.me.playing) sub = '👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.';
      else if (S.me.alive) sub = 'Bấm / chạm / Space để vỗ cánh · E để dùng vật phẩm';
      else sub = 'Bạn đã rơi — xem tiếp và ném cà chua nào! 🍅';
      if (S.me.alive) cls += ' mine';
    }
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    $('#cast').hidden = S.phase === 'play';
    if (S.phase === 'play') return;
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: false, dim: !p.connected,
      sub: p.playing ? `🐦 ${p.score} ống` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : '',
    })));
  }

  // Số ống của người còn bay tính theo đồng hồ chung (máy chủ chỉ gửi lại trạng thái khi có chuyện xảy ra).
  const liveScore = (p) => (S.phase === 'play' && p.alive && W && course && course.g === S.gameNo ? passedAt(Math.max(0, worldT())) : p.score);
  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.alive - a.alive)
      || ((b.deathT || 0) - (a.deathT || 0)));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      let sub;
      if (S.phase === 'lobby') sub = p.best ? `Kỷ lục ${p.best} ống` : 'Sẵn sàng';
      else if (!p.playing) sub = '👀 Đang xem';
      else if (S.phase === 'play') sub = p.alive ? `🐦 Đang bay${p.held ? ` · giữ ${S.items[p.held].icon}` : ''}` : `💥 Rơi ở ống ${p.score}`;
      else sub = `${p.score} ống · 🎯 ${p.hits} lần phá · kỷ lục ${p.best}`;
      const canTomato = S.phase === 'play' && S.config.tomato && p.alive && !(S.me.playing && S.me.alive) && p.id !== S.me.id;
      return `<div class="pcard ${p.playing && S.phase === 'play' && !p.alive ? 'out' : ''}" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${canTomato ? `<button class="gh-btn small" data-tomato="${esc(p.id)}" title="Ném cà chua">🍅</button>` : ''}
        ${p.playing && S.phase !== 'lobby' ? `<div class="sc">${liveScore(p)}<small>ống</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/flappy/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thêm bot để có đối thủ cùng bay — bot cũng nhặt và dùng vật phẩm!</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= 4 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const items = Object.values(S.items).map((t) => `<span class="itm" title="${esc(t.desc)}">${t.icon} ${esc(t.name)}</span>`).join('');
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      <label class="switch"><input type="checkbox" data-cfg="items" ${cfg.items ? 'checked' : ''} ${dis}><span>🎁 Vật phẩm<small>Hộp ? giữa các ống</small></span></label>
      <label class="switch"><input type="checkbox" data-cfg="tomato" ${cfg.tomato ? 'checked' : ''} ${dis}><span>🍅 Cà chua<small>Người đã rơi ném vào người còn bay</small></span></label>
      <div class="setting"><label>🤖 Độ khó của bot</label><select data-cfg="bot_level" ${dis}>
        ${S.botLevels.map((v) => `<option value="${v}" ${v === cfg.bot_level ? 'selected' : ''}>${LEVEL_NAMES[v]}</option>`).join('')}</select></div>
    </div><div class="items-list">${items}</div></div>`;
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
        return `<div class="res-row ${pid === S.winner ? 'win' : ''}"><span class="rank">${pid === S.winner ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">🎯 ${p.hits} lần phá · kỷ lục ${p.best} ống</span></div>
          <span class="rpts">${p.score} ống<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      const head = S.winner ? `${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!` : 'Ván luyện tập kết thúc';
      html = `<div class="panel"><div class="result-head"><div class="trophy">${S.winner ? '🏆' : '🏁'}</div><div>
          <h2>${head}</h2><p>Ván ${S.gameNo} kết thúc.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '🐦 Bay ván mới', 'primary')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div><span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span></div>
           ${btn('start', '🐦 Cất cánh', 'primary')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
        ${host ? botPanel() : ''}${settingsPanel()}<div class="panel">${start}</div>`;
    }
    setHTML(el, html);
  }

  function renderArena() {
    const arena = $('#arena');
    const show = S.phase === 'play';
    if (arena.hidden === show) { arena.hidden = !show; if (show) requestAnimationFrame(resize); }
    const b = $('#btn-item');
    const held = S.phase === 'play' && S.me.alive && S.me.held;
    b.hidden = !held;
    if (held) setHTML(b, `<span>${S.items[held].icon}</span><small>${esc(S.items[held].name)} · E</small>`);
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
      + '<span class="hint">Nhấn vào người chơi khác để vẫy tay, ném cà chua…</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const mine = id === S.me.id;
    let html = `<div class="pmenu-head">${mine ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(mine ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (mine) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!mine && S.me.host && S.phase !== 'play') html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
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
  function openLookEditor() {
    closeMenu();
    const body = document.createElement('div');
    let look = window.Avatar.get();
    window.Avatar.editor(body, { look, onChange: (l) => { look = l; } });
    const m = P.modal({
      title: '👗 Nhân vật của bạn', body,
      actions: [{ label: 'Huỷ', kind: 'ghost' },
        { label: '💾 Lưu', kind: 'primary', onClick: () => { window.Avatar.set(look); send('set_look', { look: window.Avatar.get() }); } }],
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

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🐦 Ván ${S.gameNo}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Flappy ${ROOM}`;
    renderBanner();
    renderCast();
    renderArena();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
    tick();
  }

  function tick() {
    const timer = $('#timer');
    if (!S || S.phase !== 'play' || !clock.g) { timer.hidden = true; return; }
    const t = Math.max(0, Math.floor(worldT()));
    renderPlayers();
    timer.hidden = false;
    timer.textContent = `⏱ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện giao diện
  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay; người còn bay xếp trên cùng.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: Math.max(1, 4 - S.players.length) }); break;
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link': if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); break;
        default:
      }
      return;
    }
    const tomatoEl = e.target.closest('[data-tomato]');
    if (tomatoEl) { throwTomato(tomatoEl.dataset.tomato); return; }
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
    send('config', { [key]: el.type === 'checkbox' ? el.checked : el.value });
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
    try { localStorage.setItem('flappy_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('point');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing && S.me.alive) {
      P.modal({
        title: 'Rời ván chơi?',
        body: '<p>Chim của bạn đang bay — rời phòng là bị tính <b>rơi</b> luôn.</p>',
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
